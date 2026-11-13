/**
 * Runs in the built /play page on a device, for `scripts/perf-device.mjs`,
 * which writes it into the page's `<head>` ahead of every page script as
 * `(${probe})(options, onePercentLow, play)`: the repository's own
 * `onePercentLow`, and the scripted pointer `pnpm perf` plays with, so a toy
 * is kept as busy here as there. It runs its steps by itself, posts each
 * result to `/probe-result`, and ends on a table of them.
 *
 * Script time is the span of each animation frame's callbacks, from the first
 * one's start to the end of the microtasks the last one queued, which is
 * where the canvas presents when a frame drives it. Timers, so the canvas's
 * idle presents at 8 fps, and input events are not counted. Its hooks run
 * inside what it measures: in desktop Chromium about 1.2 µs per callback,
 * mostly two `performance.now()` calls, and 0.2 µs per toy draw, some 5 µs a
 * frame in all.
 *
 * A step is invalid if the toy stopped drawing for `quietMs`, longer than any
 * toy's frame on a struggling device and far shorter than a sleep, or if a
 * frame took `stallMs`, which only a paused page takes.
 */
export function probe(
  { seconds, toy, display, quietMs, stallMs },
  onePercentLow,
  play,
) {
  const SETTLE_MS = Math.min(1500, seconds * 1000);
  const CALIBRATE_MS = 400;
  const SAVES =
    "saves: ms of script per frame against as shipped, first and last averaged; approximate, as each pass changes the pixels the next works on";
  const SLOW_FRAMES = (ms) =>
    `frames ${round(ms)} ms idle: the display or browser paces below 60 Hz; Low Power Mode is a common cause`;
  const PALETTE_OFF = {
    lightBase: undefined,
    lightInk: undefined,
    darkBase: undefined,
    darkInk: undefined,
  };
  const PASSES_OFF = [
    [{ noise: 0 }, ["noise"]],
    [{ ghost: 0 }, ["ghost"]],
    [{ noise: 0, ghost: 0 }, ["noise", "ghost"]],
    [PALETTE_OFF, ["palette"]],
    [{ noise: 0, ghost: 0, ...PALETTE_OFF }, ["noise", "palette", "ghost"]],
  ];

  const now = () => performance.now();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const round = (value) => Math.round(value * 100) / 100;
  const median = (values) =>
    values.toSorted((a, b) => a - b)[values.length >> 1];
  /**
   * The mean of the values near the median: a stall cannot move it, and on a
   * 1 ms timer 16 and 17 ms gaps average to the true interval.
   */
  const typical = (values) => {
    const middle = median(values);
    const near = values.filter((value) => Math.abs(value / middle - 1) < 0.5);
    return near.reduce((sum, value) => sum + value, 0) / near.length;
  };
  const matches = (name, filter) =>
    !filter || name.toLowerCase().includes(filter.toLowerCase());

  const nativeFrame = window.requestAnimationFrame.bind(window);
  let script = 0;
  let frameAt;
  let frameStart = 0;
  let frameEnd = 0;
  window.requestAnimationFrame = (callback) =>
    nativeFrame((at) => {
      if (at !== frameAt) {
        script += frameEnd - frameStart;
        frameAt = at;
        frameStart = frameEnd = now();
      }
      try {
        callback(at);
      } finally {
        queueMicrotask(() => {
          frameEnd = now();
        });
      }
    });
  const scriptSoFar = () => script + frameEnd - frameStart;

  let presents = 0;
  const displayContexts = new WeakMap();
  const isDisplay = (context) => {
    if (!displayContexts.has(context)) {
      const root = context.canvas.getRootNode();
      displayContexts.set(
        context,
        root.host?.localName === "emulated-canvas" &&
          root.querySelector("canvas") === context.canvas,
      );
    }
    return displayContexts.get(context);
  };
  for (const name of ["putImageData", "drawImage"]) {
    const draw = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function () {
      if (isDisplay(this)) presents += 1;
      return draw.apply(this, arguments);
    };
  }

  // The canvas wraps the toy's context's pixel writers as its own properties,
  // so wrapping those again counts exactly the toy's drawing.
  let draws = 0;
  let lastDraw = 0;
  let quietest = 0;
  const drew = () => {
    const at = now();
    quietest = Math.max(quietest, at - lastDraw);
    lastDraw = at;
    draws += 1;
  };
  const define = customElements.define;
  customElements.define = function (name, constructor, options) {
    if (name === "emulated-canvas") {
      const { getContext } = constructor.prototype;
      const watched = new WeakSet();
      constructor.prototype.getContext = function () {
        const context = getContext.apply(this, arguments);
        if (context !== null && !watched.has(context)) {
          watched.add(context);
          for (const key of Object.getOwnPropertyNames(context)) {
            const write = context[key];
            if (typeof write !== "function") continue;
            Object.defineProperty(context, key, {
              configurable: true,
              value() {
                drew();
                return write.apply(this, arguments);
              },
            });
          }
        }
        return context;
      };
    }
    return define.call(this, name, constructor, options);
  };

  let hidden = false;
  document.addEventListener("visibilitychange", () => {
    hidden ||= document.hidden;
  });

  const measure = async (ms) => {
    hidden = document.hidden;
    const before = { script: scriptSoFar(), presents, draws };
    lastDraw = now();
    quietest = 0;
    const gaps = await play({ ms });
    quietest = Math.max(quietest, now() - lastDraw);
    const frames = gaps.length + 1;
    return {
      gaps,
      fps: (gaps.length * 1000) / gaps.reduce((sum, gap) => sum + gap, 0),
      low: onePercentLow(gaps),
      script: (scriptSoFar() - before.script) / frames,
      presents: (presents - before.presents) / frames,
      draws: draws - before.draws,
      longestQuietMs: quietest,
      longestGapMs: Math.max(...gaps),
      hidden,
    };
  };

  /** Gaps in frame intervals, to the nearest half, as a 120 Hz screen paces a 60 Hz page. */
  const ticks = (gaps, interval) => {
    const counts = {};
    for (const gap of gaps) {
      const tick = Math.min(
        4,
        Math.max(1, Math.round((gap / interval) * 2) / 2),
      );
      counts[tick] = (counts[tick] ?? 0) + 1;
    }
    return counts;
  };

  function kernelInt() {
    let sum = 0;
    for (let i = 0; i < 100_000; i += 1) {
      sum = (sum + Math.imul(i, 0x9e3779b1)) | 0;
      sum ^= sum >>> 7;
    }
    return sum;
  }
  const bytes = new Uint8ClampedArray(160 * 160 * 4).map((_, i) => i * 37);
  const floats = new Float32Array(bytes.length);
  function kernelBytes() {
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      const light =
        (bytes[i] * 54 + bytes[i + 1] * 183 + bytes[i + 2] * 19) >> 8;
      bytes[i + 1] = light;
      sum += light;
    }
    return sum;
  }
  function kernelFloat() {
    for (let i = 0; i < floats.length; i += 1) {
      const value = floats[i] + (bytes[i] - floats[i]) * 0.25;
      floats[i] = value;
      bytes[i] = value;
    }
    return floats[0];
  }
  const KERNELS = {
    int: [kernelInt, 100_000],
    bytes: [kernelBytes, bytes.length / 4],
    float: [kernelFloat, floats.length],
  };
  let sink = 0;
  /** Nanoseconds per loop iteration over `ms`. */
  const rate = (kernel, iterations, ms) => {
    const start = now();
    let calls = 0;
    let at;
    do {
      sink ^= kernel() | 0;
      calls += 1;
      at = now();
    } while (at - start < ms);
    return ((at - start) * 1e6) / (calls * iterations);
  };
  const warmRate = (kernel, iterations) => {
    rate(kernel, iterations, CALIBRATE_MS / 4);
    return Math.min(
      rate(kernel, iterations, CALIBRATE_MS),
      rate(kernel, iterations, CALIBRATE_MS),
    );
  };
  /**
   * A native scan costs the same with or without a JIT, in V8 and in
   * WebKit, whose typed array `indexOf` is C++, so the loops' cost over its
   * cost per element says which runs them, whatever the device's speed. The
   * threshold sits between the largest compiled ratio plausible, about 14 if
   * the scan is SIMD on a phone, and the smallest interpreted one seen; see
   * `REFERENCE` in perf-device.mjs. Warm against cold is no tell: V8 sometimes
   * compiles a loop inside its first 5 ms, then runs it warm slower.
   */
  const calibrate = () => {
    const loops = {};
    for (const [name, [kernel, iterations]] of Object.entries(KERNELS)) {
      loops[name] = warmRate(kernel, iterations);
    }
    const scanNs = warmRate(() => floats.indexOf(-1), floats.length);
    const slowdown = median(Object.values(loops)) / scanNs;
    return { loops, scanNs, slowdown, compiled: slowdown < 30 };
  };

  const timerResolution = () => {
    let finest = Infinity;
    let last = now();
    for (const end = last + 40; last < end;) {
      const at = now();
      if (at !== last) finest = Math.min(finest, at - last);
      last = at;
    }
    return finest;
  };

  const run = Math.random().toString(36).slice(2, 10);
  let unsent = 0;
  const post = (result) =>
    fetch("/probe-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run, ...result }),
    }).then(
      (response) => response.ok || (unsent += 1),
      () => (unsent += 1),
    );

  let box;
  const show = (text) => {
    box.textContent = text;
    box.hidden = false;
  };

  let backdrop;
  let canvas;
  let button;
  const label = () => button.textContent.replace("Display: ", "");
  /** Sorted, as an attribute or property removed and set again moves to the end. */
  const attributes = (element) =>
    [...element.attributes]
      .filter(({ name }) => name !== "style")
      .map(({ name, value }) => `${name}="${value}"`)
      .concat(
        [...element.style].map(
          (property) =>
            `${property}: ${element.style.getPropertyValue(property)}`,
        ),
      )
      .sort()
      .join(" ");
  const look = () => attributes(canvas);
  const snapshot = () =>
    `${backdrop.toy} on ${label()}: ${attributes(backdrop)} | ${look()}`;
  /** The passes the canvas's attributes switch on, read as each pass reads them. */
  const passesOn = () => {
    const { noise, ghost, paletteBase, paletteInk } = canvas.dataset;
    const { ghostRise = ghost, ghostFall = ghost } = canvas.dataset;
    return [
      Number(noise) > 0 && "noise",
      paletteBase !== undefined && paletteInk !== undefined && "palette",
      (Number(ghostRise) > 0 || Number(ghostFall) > 0) && "ghost",
    ].filter(Boolean);
  };
  let displays = [];
  const choose = (toyId, displayLabel) => {
    backdrop.setToy(toyId);
    for (let presses = 0; label() !== displayLabel; presses += 1) {
      if (presses === displays.length) return;
      button.click();
    }
  };

  const setUp = async () => {
    if (document.readyState !== "complete") {
      await new Promise((resolve) => addEventListener("load", resolve));
    }
    await customElements.whenDefined("pixel-backdrop");
    backdrop = document.querySelector("pixel-backdrop");
    canvas = backdrop?.querySelector("emulated-canvas");
    button = document.querySelector("[data-display]");
    if (!backdrop || !canvas || !button) {
      throw new Error(
        "/play has no <pixel-backdrop>, canvas or display button",
      );
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      throw new Error("the device asks for reduced motion, which pauses toys");
    }
    box = document.createElement("pre");
    box.style.cssText =
      "position:fixed;inset:max(8px,env(safe-area-inset-top)) 8px auto;z-index:2147483647;margin:0;padding:8px;max-block-size:calc(100dvh - 16px);overflow:auto;background:#000d;color:#fff;font:10px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;pointer-events:none";
    document.body.append(box);
    show(`probe ${run}: settling`);
    await wait(SETTLE_MS);
  };

  const environment = async (wakeLock) => {
    backdrop.configure({ enabled: false });
    const { gaps } = await measure(1000);
    const calibration = calibrate();
    backdrop.reset();
    return {
      type: "env",
      userAgent: navigator.userAgent,
      devicePixelRatio,
      viewport: `${innerWidth}×${innerHeight}`,
      secure: isSecureContext,
      wakeLock,
      timerMs: timerResolution(),
      frameMs: typical(gaps),
      ...calibration,
    };
  };

  const steps = (home) => {
    const shippedPasses = passesOn();
    // A display may ship with a pass off already: only those on are switched
    // off, and a step left with nothing new to switch off is dropped.
    const offSteps = [];
    for (const [knobs, passes] of PASSES_OFF) {
      const off = passes.filter((pass) => shippedPasses.includes(pass));
      if (
        off.length > 0 &&
        !offSteps.some(([, seen]) => seen.join() === off.join())
      ) {
        offSteps.push([knobs, off]);
      }
    }
    const animating = ({ longestQuietMs, draws }) =>
      draws === 0
        ? "invalid: the toy never drew"
        : longestQuietMs > quietMs
          ? `invalid: the toy stopped drawing for ${Math.round(longestQuietMs)} ms`
          : undefined;
    const idle = (name) => ({
      name,
      kind: "idle",
      apply: () => backdrop.configure({ enabled: false }),
      applied: () =>
        backdrop.hasAttribute("data-disabled")
          ? undefined
          : "the backdrop is still enabled",
      ran: (measured) =>
        measured.draws + measured.presents > 0
          ? "not applied: the backdrop kept drawing"
          : undefined,
      undo: () => backdrop.reset(),
    });
    const shipped = (name, toyId, displayLabel) => ({
      name,
      kind: "shipped",
      toy: toyId,
      display: displayLabel,
      apply: () => choose(toyId, displayLabel),
      applied: () =>
        backdrop.toy !== toyId
          ? `the toy is ${backdrop.toy}`
          : label() !== displayLabel
            ? `the display is ${label()}`
            : toyId === home.toy && look() !== home.looks.get(displayLabel)
              ? "the canvas does not look as the display did"
              : undefined,
      ran: animating,
      undo: () => choose(home.toy, home.display),
    });
    const passesOff = ([knobs, off]) => ({
      name:
        off.length === shippedPasses.length
          ? "all passes off"
          : `${off.join(", ")} off`,
      kind: "passes",
      toy: home.toy,
      display: home.display,
      apply: () => backdrop.configure(knobs),
      applied() {
        const expected = shippedPasses.filter((pass) => !off.includes(pass));
        const running = passesOn();
        return running.join() === expected.join()
          ? undefined
          : `the canvas runs ${running.join(", ") || "no pass"}, not ${expected.join(", ") || "no pass"}`;
      },
      ran: animating,
      undo: () => backdrop.reset(),
    });
    return [
      idle("idle"),
      ...home.displays.flatMap((displayLabel) =>
        home.toys.map((toyId) => shipped("as shipped", toyId, displayLabel)),
      ),
      ...offSteps.map(passesOff),
      shipped("as shipped, again", home.toy, home.display),
      idle("idle, again"),
    ];
  };

  const runStep = async (step, index, total, homeSnapshot, frameMs) => {
    show(`probe ${run}: ${index}/${total} ${step.name}`);
    step.apply();
    await play({ ms: SETTLE_MS });
    const problems = [];
    const unapplied = step.applied();
    if (unapplied) problems.push(`not applied: ${unapplied}`);
    box.hidden = true;
    const { gaps, hidden, ...measured } = await measure(seconds * 1000);
    const ran = step.ran(measured);
    if (ran) problems.push(ran);
    if (hidden) problems.push("invalid: the page was hidden");
    // A backstop for a visibilitychange the browser never sent.
    if (measured.longestGapMs > stallMs) {
      problems.push(
        `invalid: a frame took ${Math.round(measured.longestGapMs)} ms, as a paused page's does`,
      );
    }
    step.undo();
    if (snapshot() !== homeSnapshot)
      problems.push(`not restored: ${snapshot()}`);
    return {
      type: "step",
      index,
      total,
      name: step.name,
      kind: step.kind,
      toy: step.toy,
      display: step.display,
      ...measured,
      ticks: ticks(gaps, frameMs),
      problems,
      gaps: gaps.map(round),
    };
  };

  const table = (env, results) => {
    const cell = (value, width) =>
      String(typeof value === "number" ? round(value) : (value ?? "")).padStart(
        width,
      );
    return [
      `probe ${run} on ${env.userAgent}`,
      ...(env.secure
        ? []
        : ["NOT A SECURE CONTEXT: these numbers may not be the real site's"]),
      ...(env.compiled
        ? []
        : ["JAVASCRIPT INTERPRETED: these numbers are not the real site's"]),
      ...(env.frameMs > 20 ? [SLOW_FRAMES(env.frameMs)] : []),
      `secure context ${env.secure}, JavaScript ${env.compiled ? "compiled" : "interpreted"} (loops ${round(env.slowdown)}× a native scan), frame ${round(env.frameMs)} ms`,
      ...(unsent ? [`${unsent} results did not reach the server`] : []),
      "",
      `${"step".padEnd(18)}${"display".padEnd(11)}  fps   low script saves pres`,
      ...results.map(
        (step) =>
          `${step.name.padEnd(18)}${(step.display ?? "").slice(0, 10).padEnd(11)}${cell(step.fps, 5)}${cell(step.low, 6)}${cell(step.script, 7)}${cell(step.saves, 6)}${cell(step.presents, 5)}${step.problems.length ? ` ${step.problems.join("; ")}` : ""}`,
      ),
      "",
      SAVES,
    ].join("\n");
  };

  const start = async () => {
    await setUp();
    const original = { toy: backdrop.toy, display: label() };
    // A phone that locks its screen mid-run hides the page and voids the
    // step. A page that hides loses its lock, so it asks again on its return.
    let lock;
    let holding = isSecureContext && navigator.wakeLock !== undefined;
    const hold = async () => {
      lock = await navigator.wakeLock
        .request("screen")
        .catch((error) => `refused: ${error.message}`);
    };
    if (holding) {
      await hold();
      document.addEventListener("visibilitychange", () => {
        if (holding && !document.hidden) hold();
      });
    }
    const env = await environment(
      !isSecureContext
        ? "unavailable on an insecure page"
        : typeof lock === "string"
          ? lock
          : lock
            ? "held"
            : "unsupported",
    );
    await post(env);

    const toys = [
      ...document.querySelectorAll("[data-toy] option:not([hidden])"),
    ]
      .map((option) => option.value)
      .filter((id) => id !== "random");
    const home = { toys: toys.filter((id) => matches(id, toy)) };
    [home.toy] = home.toys;
    if (!home.toy)
      throw new Error(`no toy matches "${toy}" in ${toys.join(", ")}`);
    backdrop.setToy(home.toy);
    home.looks = new Map();
    while (!home.looks.has(label())) {
      home.looks.set(label(), look());
      button.click();
    }
    displays = [...home.looks.keys()];
    if (new Set(home.looks.values()).size !== displays.length) {
      throw new Error(
        `two of ${displays.join(", ")} give the canvas the same attributes`,
      );
    }
    home.displays = displays.filter((name) => matches(name, display));
    [home.display] = home.displays;
    if (!home.display) {
      throw new Error(
        `no display matches "${display}" in ${displays.join(", ")}`,
      );
    }
    choose(home.toy, home.display);
    const homeSnapshot = snapshot();

    const plan = steps(home);
    const results = [];
    for (const [at, step] of plan.entries()) {
      const result = await runStep(
        step,
        at + 1,
        plan.length,
        homeSnapshot,
        env.frameMs,
      );
      results.push(result);
      await post(result);
    }
    // Against the mean of the first and last as shipped, so drift cancels.
    const ends = [
      results.find(({ kind }) => kind === "shipped"),
      results.findLast(({ kind }) => kind === "shipped"),
    ];
    if (ends.every(({ problems }) => problems.length === 0)) {
      const shipped = (ends[0].script + ends[1].script) / 2;
      for (const result of results.filter(({ kind }) => kind === "passes")) {
        result.saves = shipped - result.script;
      }
    }
    choose(original.toy, original.display);
    holding = false;
    lock?.release?.();
    await post({ type: "done", env, steps: results });
    show(table(env, results));
    box.style.pointerEvents = "auto";
  };

  start().catch((error) => {
    post({ type: "error", message: String(error), stack: error?.stack });
    if (box) show(`probe ${run} failed: ${error?.stack ?? error}`);
    else document.documentElement.append(`probe ${run} failed: ${error}`);
  });
}
