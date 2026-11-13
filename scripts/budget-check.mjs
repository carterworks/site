/**
 * Holds the built site to the performance budgets in `scripts/budgets.mjs`:
 * prints every measured value beside its limit, and exits non-zero if any is
 * over.
 *
 *   pnpm budgets [--dist dist]
 *
 * It drives the build in Playwright's headless Chromium, rendering in
 * software as CI does; the limits are for software, so it refuses a GPU. Each
 * page runs with `Math.random` seeded and a virtual clock: every animation
 * frame moves `performance.now()` and the frame's timestamp on by exactly
 * 1/60 s, so the same scripted pointer does the same work on every run,
 * however fast or slow the machine draws.
 *
 * Bytes, counts and render passes are exact, so any excess fails.
 *
 * Frame cost is CPU time, never wall-clock time: the main thread's own CPU
 * clock and, from /proc (so Linux only), the run time of every other
 * Chromium thread. Interference still inflates CPU time, through a busy
 * sibling hyperthread or a lower clock, but only ever inflates it, so each
 * cost is the cheapest of ROUNDS identical rounds, each from a fresh load (and
 * of more if that is over its limit; see ATTEMPTS). And it is divided by the
 * cheapest of as many rounds of a fixed reference page,
 * `scripts/budget-reference.html`, interleaved with them, so whatever slows
 * the machine slows both. On the machine the limits were set on, eight busy
 * cores and a looping build raised the absolute costs by 50-60% but moved no
 * ratio up by more than 4%; most moved down, as the reference suffered more.
 *
 * Not budgeted: frame rate and wall-clock times, which the machine's speed and
 * load decide; `pnpm perf` reports those.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import budgets from "./budgets.mjs";
import { holdClockHigh, launch, play, playControls } from "./play-page.mjs";

const { values: options } = parseArgs({
  options: { dist: { type: "string", default: "dist" } },
});

const ROUNDS = 5;
const WARM_UP_MS = 500;
const ROUND_MS = 1000;
const HOST = "site";
const ORIGIN = `http://${HOST}.localhost`;
// Same origin as the site, so both share one renderer process.
const REFERENCE = `${ORIGIN}/budget-reference/`;

const started = Date.now();
let lapped = started;
/** Logs how long a stage took, so a slow runner's log shows where the time went. */
const lap = (stage) => {
  console.log(
    `Measured ${stage} in ${Math.round((Date.now() - lapped) / 1000)} s.`,
  );
  lapped = Date.now();
};

// A powersave governor clocks the CPU by load, and the reference and the
// displays load it differently, which would skew their ratio. A VM, as on CI,
// usually exposes no governor, and there a spinning thread would only take a
// core from Chromium.
const governor = "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor";
const clockScales =
  existsSync(governor) &&
  readFileSync(governor, "utf8").trim() !== "performance";
if (clockScales) holdClockHigh();

const { browser, system, renderer, page, devtools } = await launch({
  [HOST]: options.dist,
});
if (renderer) {
  await browser.close();
  throw new Error(
    `Chromium composited with ${renderer}; the budgets are for software.`,
  );
}
const { product } = await system.send("Browser.getVersion");
console.log(
  `Rendering: software, ${product}, ${cpus().length} × ${cpus()[0].model}${clockScales ? ", clock held high" : ""}`,
);

await page.context().addInitScript(() => {
  let seed = 1;
  Math.random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  let now = 0;
  let frame;
  const request = window.requestAnimationFrame.bind(window);
  performance.now = () => now;
  window.requestAnimationFrame = (callback) =>
    request((timestamp) => {
      if (timestamp !== frame) {
        frame = timestamp;
        now += 1000 / 60;
      }
      callback(now);
    });
});
await page.context().route(REFERENCE, (route) =>
  route.fulfill({
    path: new URL("budget-reference.html", import.meta.url).pathname,
  }),
);

const results = [];
const check = (budget, measured, limit) =>
  results.push({
    budget,
    measured,
    limit,
    result: measured <= limit ? "ok" : "MISSED",
  });

const metrics = async () =>
  Object.fromEntries(
    (await devtools.send("Performance.getMetrics")).metrics.map(
      ({ name, value }) => [name, value],
    ),
  );
const sum = (values) => values.reduce((total, value) => total + value, 0);

await devtools.send("Network.enable");
await devtools.send("Network.setCacheDisabled", { cacheDisabled: true });
for (const [path, limit] of Object.entries(budgets.javascript)) {
  const scripts = new Set();
  const collect = (request) => {
    if (request.resourceType() === "script") {
      scripts.add(new URL(request.url()).pathname);
    }
  };
  page.on("request", collect);
  await page.goto(ORIGIN + path, { waitUntil: "networkidle" });
  page.off("request", collect);
  const files = [...scripts].map((script) =>
    readFileSync(join(options.dist, script)),
  );
  const brotli = sum(
    files.map(
      (file) =>
        brotliCompressSync(file, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        }).length,
    ),
  );
  const gzip = sum(files.map((file) => gzipSync(file, { level: 9 }).length));
  check(
    `JavaScript on ${path}, brotli bytes (${files.length} files, ${sum(files.map((file) => file.length))} raw, ${gzip} gzip)`,
    brotli,
    limit,
  );
}
await devtools.send("Network.disable");

for (const [path, limit] of Object.entries(budgets.font)) {
  check(`Font ${path}, bytes`, statSync(join(options.dist, path)).size, limit);
}
lap("bytes");

const controls = playControls(page);
await controls.open(HOST);
const toys = await controls.toys();
const displays = await controls.displays();

/** Shows `toy` on `display` on the homepage, choosing both on /play, which stores them. */
const showOnHomepage = async (toy, display) => {
  await controls.open(HOST);
  if (
    !(await controls.hasToy(toy)) ||
    !(await controls.chooseDisplay(display, displays.length))
  ) {
    throw new Error(`/play offers no toy "${toy}" or display "${display}".`);
  }
  await controls.chooseToy(toy);
  await page.goto(`${ORIGIN}/`);
};

/**
 * Leftovers of a first visit, such as a cache filled once, are not leaks, so
 * a warm-up tour runs first. The FPS meter's text nodes come and go between
 * collections, which only ever adds nodes, so each count is the lowest of a
 * few collections.
 */
const tour = async () => {
  for (const toy of toys) {
    await controls.chooseToy(toy);
    await page.evaluate(play, { ms: 100 });
  }
  for (const display of [...displays.slice(1), displays[0]]) {
    await controls.chooseDisplay(display, displays.length);
    await page.evaluate(play, { ms: 100 });
  }
  await controls.chooseToy(toys[0]);
};
const live = async () => {
  const samples = [];
  for (let sample = 0; sample < 3; sample += 1) {
    await page.evaluate(play, { ms: 100, press: false });
    await devtools.send("HeapProfiler.collectGarbage");
    samples.push(await metrics());
  }
  const lowest = (name) => Math.min(...samples.map((sample) => sample[name]));
  return { nodes: lowest("Nodes"), listeners: lowest("JSEventListeners") };
};
await controls.open(HOST);
await tour();
const before = await live();
await tour();
const after = await live();
check(
  `Leaks: DOM nodes gained touring every toy and display on /play (${before.nodes} before)`,
  after.nodes - before.nodes,
  budgets.leaks.nodes,
);
check(
  `Leaks: event listeners gained touring every toy and display on /play (${before.listeners} before)`,
  after.listeners - before.listeners,
  budgets.leaks.listeners,
);
lap("leaks");

/**
 * Plays while tracing the compositor, and counts the frames it drew and the
 * most render passes any one of them drew. A frame cut by the start or end of
 * the trace is not recorded, so its passes, which are, belong to no frame.
 */
const traceFrames = async (options) => {
  const frames = [];
  const passes = [];
  const collect = ({ value }) => {
    for (const event of value) {
      if (event.name === "DirectRenderer::DrawFrame") frames.push(event);
      if (event.name === "DirectRenderer::DrawRenderPass") passes.push(event);
    }
  };
  devtools.on("Tracing.dataCollected", collect);
  await devtools.send("Tracing.start", {
    traceConfig: { includedCategories: ["viz"] },
    transferMode: "ReportEvents",
  });
  const gaps = await page.evaluate(play, options);
  const complete = new Promise((resolve) =>
    devtools.once("Tracing.tracingComplete", resolve),
  );
  await devtools.send("Tracing.end");
  await complete;
  devtools.off("Tracing.dataCollected", collect);
  const passesIn = ({ tid, ts, dur }) =>
    passes.filter(
      (pass) => pass.tid === tid && ts <= pass.ts && pass.ts <= ts + dur,
    ).length;
  return {
    frames: gaps.length,
    drawn: frames.length,
    mostPasses: Math.max(...frames.map(passesIn)),
  };
};

const worst = {};
const record = (budget, value, where) => {
  if (!(budget in worst) || value > worst[budget].value) {
    worst[budget] = { value, where };
  }
};
for (const display of displays) {
  for (const toy of toys) {
    await showOnHomepage(toy, display);
    await page.evaluate(play, { ms: WARM_UP_MS, press: false });
    const start = await metrics();
    const hover = await traceFrames({ ms: 500, press: false });
    const hovered = await metrics();
    await page.evaluate(play, { ms: 500, press: true });
    const pressed = await metrics();
    const where = `${toy} on ${display}`;
    const per = (to, from, name, by) => (to[name] - from[name]) / by;
    record(
      "hover layouts",
      per(hovered, start, "LayoutCount", hover.frames),
      where,
    );
    record(
      "hover styleRecalcs",
      per(hovered, start, "RecalcStyleCount", hover.frames),
      where,
    );
    record("press layouts", per(pressed, hovered, "LayoutCount", 1), where);
    record(
      "press styleRecalcs",
      per(pressed, hovered, "RecalcStyleCount", 1),
      where,
    );
    if (hover.drawn > 0) {
      record(`passes ${display}`, hover.mostPasses, where);
    }
  }
}
for (const [kind, label] of [
  ["hover", "per frame of hover-only play"],
  ["press", "per press"],
]) {
  for (const [name, noun] of [
    ["layouts", "Layouts"],
    ["styleRecalcs", "Style recalculations"],
  ]) {
    const { value, where } = worst[`${kind} ${name}`];
    check(`${noun} ${label} (worst: ${where})`, value, budgets[kind][name]);
  }
}
for (const [display, limit] of Object.entries(budgets.renderPasses)) {
  const { value, where } = worst[`passes ${display}`];
  check(
    `Render passes in a frame on ${display} (worst: ${where})`,
    value,
    limit,
  );
}
lap("layouts, style recalculations and render passes");

/** Total ms a thread of `pid` has run, from the scheduler's nanosecond count. */
const runMs = (pid) => {
  let total = 0;
  for (const task of readdirSync(`/proc/${pid}/task`)) {
    try {
      total += Number(
        readFileSync(`/proc/${pid}/task/${task}/schedstat`, "utf8").split(
          " ",
        )[0],
      );
    } catch {}
  }
  return total / 1e6;
};
const cpuSpent = async () => {
  const [{ ThreadTime }, { processInfo }] = await Promise.all([
    metrics(),
    system.send("SystemInfo.getProcessInfo"),
  ]);
  const mainThread = ThreadTime * 1000;
  const chromium = sum(
    processInfo
      .filter(({ type }) => type === "renderer" || type === "GPU")
      .map(({ id }) => {
        try {
          return runMs(id);
        } catch {
          return 0;
        }
      }),
  );
  return { mainThread, compositor: chromium - mainThread };
};
const measureRound = async (url) => {
  await page.goto(url);
  await page.evaluate(play, { ms: WARM_UP_MS, press: false });
  const from = await cpuSpent();
  const { length: frames } = await page.evaluate(play, {
    ms: ROUND_MS,
    press: false,
  });
  const to = await cpuSpent();
  return {
    mainThread: (to.mainThread - from.mainThread) / frames,
    compositor: (to.compositor - from.compositor) / frames,
  };
};
const cheapest = (rounds, part) =>
  Math.min(...rounds.map((round) => round[part]));
const ms = (value) => `${value.toFixed(2)} ms`;
const parts = { mainThread: "main thread", compositor: "compositor" };
const shows = new Set(
  Object.keys(parts).flatMap((part) => Object.keys(budgets.frameCost[part])),
);
/**
 * A show over its limit is measured again, ROUNDS more rounds of each page,
 * up to ATTEMPTS in all, and judged on the cheapest of all its rounds: a
 * regression stays over, while interference that lasted a whole attempt,
 * such as the main thread sharing a core with a busy hyperthread, does not.
 */
const ATTEMPTS = 3;
for (const show of shows) {
  const [toy, display] = show.split(" on ");
  const owed = Object.keys(parts).filter(
    (part) => show in budgets.frameCost[part],
  );
  const reference = [];
  const measured = [];
  const ratio = (part) => cheapest(measured, part) / cheapest(reference, part);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    await showOnHomepage(toy, display);
    for (let round = 0; round < ROUNDS; round += 1) {
      reference.push(await measureRound(REFERENCE));
      measured.push(await measureRound(`${ORIGIN}/`));
    }
    const over = owed.filter(
      (part) => ratio(part) > budgets.frameCost[part][show],
    );
    if (over.length === 0 || attempt === ATTEMPTS) break;
    console.log(
      `Measuring ${show} again: ${over.map((part) => `${parts[part]} ${ratio(part).toFixed(3)}`).join(", ")} over its limit after attempt ${attempt}.`,
    );
  }
  for (const part of owed) {
    const rounds = (all) =>
      all.map((round) => round[part].toFixed(2)).join(" ");
    check(
      `Frame cost, ${parts[part]}, ${show}, × reference (${ms(cheapest(measured, part))} ÷ ${ms(cheapest(reference, part))}; rounds ${rounds(measured)} ÷ ${rounds(reference)})`,
      Math.round(ratio(part) * 1000) / 1000,
      budgets.frameCost[part][show],
    );
  }
}
lap("frame cost");
await browser.close();

console.table(
  results.map(({ budget, measured, limit, result }) => ({
    budget,
    measured: Math.round(measured * 1000) / 1000,
    limit,
    result,
  })),
);
const missed = results.filter(({ result }) => result !== "ok");
console.log(
  `${results.length - missed.length} of ${results.length} budgets met in ${Math.round((Date.now() - started) / 1000)} s.`,
);
for (const { budget, measured, limit } of missed) {
  console.error(
    `Budget missed: ${budget}: ${measured}, over its limit of ${limit}.`,
  );
}
process.exitCode = missed.length > 0 ? 1 : 0;
