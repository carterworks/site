/**
 * Drives the built /play page in Playwright's headless Chromium, for
 * `scripts/perf.mjs` and `scripts/budget-check.mjs`. Each build is served
 * straight from its `dist/` at its own host, `http://<host>.localhost/`, so
 * no web server runs and no build sees another's storage.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { chromium } from "playwright";

const VIEWPORT = { width: 1280, height: 800 };

/**
 * Launches Chromium for `builds`, `{ host: distPath }`, rendering in software
 * unless `gpu`, which fails rather than fall back. `renderer` names the GPU,
 * or is undefined in software.
 */
export async function launch(builds, { gpu = false } = {}) {
  const roots = {};
  for (const [host, path] of Object.entries(builds)) {
    roots[host] = pathToFileURL(`${resolve(path)}/`);
    if (!existsSync(new URL("play/index.html", roots[host]))) {
      throw new Error(`No /play page in ${path}: run \`pnpm build\` first.`);
    }
  }
  const browser = await chromium.launch({
    channel: "chromium",
    // Without `--disable-gpu`, a machine whose GPU, or SwiftShader, starts
    // would composite on it, and its compositor would not count as software's.
    args: gpu ? ["--enable-gpu", "--ignore-gpu-blocklist"] : ["--disable-gpu"],
  });
  const system = await browser.newBrowserCDPSession();
  const { gpu: info } = await system.send("SystemInfo.getInfo");
  const renderer =
    info.featureStatus.gpu_compositing === "enabled"
      ? info.devices[0].deviceString
      : undefined;
  if (gpu && !renderer) {
    await browser.close();
    throw new Error(
      "--gpu found no usable GPU driver, so Chromium composites in software. On NixOS, run it with `nix-shell --run`.",
    );
  }
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.route("**/*", (route) => {
    const { hostname, pathname } = new URL(route.request().url());
    const root = roots[hostname.split(".")[0]];
    const file =
      root &&
      new URL(
        `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`,
        root,
      );
    return file && existsSync(file)
      ? route.fulfill({ path: file.pathname })
      : route.fulfill({ status: 404 });
  });
  const page = await context.newPage();
  const devtools = await context.newCDPSession(page);
  await devtools.send("Performance.enable");
  return { browser, system, renderer, page, devtools };
}

/** The /play page's controls, and what they offer. */
export function playControls(page) {
  const toyOptions = page.locator("[data-toy] option:not([hidden])");
  const displayControl = page.locator("[data-display]");
  const displayOptions = page.locator("select[data-display] option");
  const shownDisplay = async () =>
    (await displayControl.textContent()).replace("Display: ", "");
  const themeControl = page.locator("[data-theme]");
  /** Flips the theme with its button, as someone would, so the choice carries across reloads. */
  const showScheme = async (scheme) => {
    const shown = /dark/i.test(await themeControl.textContent())
      ? "dark"
      : "light";
    if (shown !== scheme) await themeControl.click();
  };
  /** Display names, to where each is offered: `{ scheme, label }`. */
  const offered = new Map();
  return {
    open: (host) => page.goto(`http://${host}.localhost/play/`),
    toys: () =>
      toyOptions.evaluateAll((all) =>
        all.map((option) => option.value).filter((id) => id !== "random"),
      ),
    /**
     * Every display's name, light's menu then dark's. A label both menus offer
     * is named for its scheme, as the golden tests name them, unless the menus
     * match, as on a base build from before displays had a scheme.
     */
    async displays() {
      const menus = {};
      for (const scheme of ["light", "dark"]) {
        await showScheme(scheme);
        menus[scheme] = await displayOptions.allTextContents();
      }
      const split = menus.light.join() !== menus.dark.join();
      offered.clear();
      for (const scheme of split ? ["light", "dark"] : ["light"]) {
        for (const label of menus[scheme]) {
          const both =
            split && menus.light.includes(label) && menus.dark.includes(label);
          offered.set(both ? `${label} in ${scheme}` : label, {
            scheme,
            label,
          });
        }
      }
      return [...offered.keys()];
    },
    hasToy: async (toy) =>
      (await toyOptions.and(page.locator(`[value="${toy}"]`)).count()) > 0,
    chooseToy: (toy) => page.selectOption("[data-toy]", toy),
    /**
     * Chooses `display` by a name `displays` gave, in its scheme; false if the
     * page does not offer it.
     */
    async chooseDisplay(display, displayCount) {
      if ((await displayOptions.count()) > 0) {
        const where = offered.get(display);
        if (where === undefined) return false;
        await showScheme(where.scheme);
        if (!(await displayOptions.allTextContents()).includes(where.label)) {
          return false;
        }
        await displayControl.selectOption({ label: where.label });
        return true;
      }
      // A base build from before the menu, which `perf --against` compares
      // with, has a button that steps through the displays.
      for (let presses = 0; (await shownDisplay()) !== display; presses += 1) {
        if (presses === displayCount) return false;
        await displayControl.click();
      }
      return true;
    },
  };
}

/**
 * An init script, `context.addInitScript(virtualClock, { paused })`, that
 * makes a page do the same work on every run however fast the machine draws.
 * It seeds `Math.random`, and runs `performance.now()`, animation frames and
 * timeouts on virtual time that moves exactly 1/60 s per frame. Timeouts are
 * virtual too because toys and the canvas wait on them, and a real one would
 * fire after however many frames the machine drew meanwhile. `paused` holds
 * every frame and timeout until `__clock.run(true)`, so the time between two
 * measurements, which the machine decides, never reaches the page.
 * `__clock.frame` counts frames.
 */
export function virtualClock({ paused }) {
  let seed = 1;
  Math.random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const realFrame = window.requestAnimationFrame.bind(window);
  const frames = new Map();
  const timeouts = new Map();
  let id = 0;
  let ticking = false;
  const clock = { now: 0, frame: 0, running: !paused };
  const call = (callback, ...args) => {
    try {
      callback(...args);
    } catch (error) {
      reportError(error);
    }
  };
  const schedule = () => {
    if (ticking || !clock.running || frames.size + timeouts.size === 0) return;
    ticking = true;
    realFrame(tick);
  };
  const tick = () => {
    ticking = false;
    if (!clock.running) return;
    clock.now += 1000 / 60;
    clock.frame += 1;
    const due = [...timeouts]
      .filter(([, { at }]) => at <= clock.now)
      .sort(([, a], [, b]) => a.at - b.at);
    for (const [key, { callback, args }] of due) {
      timeouts.delete(key);
      call(callback, ...args);
    }
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) call(callback, clock.now);
    schedule();
  };
  clock.run = (running) => {
    clock.running = running;
    schedule();
  };
  window.__clock = clock;
  performance.now = () => clock.now;
  window.requestAnimationFrame = (callback) => {
    frames.set(++id, callback);
    schedule();
    return id;
  };
  window.cancelAnimationFrame = (key) => frames.delete(key);
  window.setTimeout = (callback, ms, ...args) => {
    timeouts.set(++id, { callback, args, at: clock.now + (Number(ms) || 0) });
    schedule();
    return id;
  };
  window.clearTimeout = (key) => timeouts.delete(key);
}

/** Holds every CPU core's clock high while it runs; see the callers for why. */
export const holdClockHigh = () =>
  new Worker("for (;;);", { eval: true }).unref();

/**
 * Runs in the page, as `page.evaluate(play, { ms, press })`. Sweeps the
 * pointer down the viewport's diagonal, then, if `press`, drags it back up;
 * otherwise hovers back up. Places it by the clock, so a slow frame samples
 * the same path more coarsely. Resolves with the ms between frames.
 */
export const play = ({ ms, press = true }) =>
  new Promise((resolve) => {
    const gaps = [];
    let start;
    let last;
    let held = false;
    const point = (type, share, buttons) =>
      window.dispatchEvent(
        new PointerEvent(type, {
          clientX: share * innerWidth,
          clientY: share * innerHeight,
          pointerType: "mouse",
          pointerId: 1,
          isPrimary: true,
          buttons,
        }),
      );
    const frame = (now) => {
      start ??= now;
      if (last !== undefined) gaps.push(now - last);
      last = now;
      const share = (now - start) / ms;
      if (share >= 1) {
        if (held) point("pointerup", 0, 0);
        resolve(gaps);
        return;
      }
      if (press && share >= 0.5 && !held) {
        point("pointerdown", 1, 1);
        held = true;
      }
      const along = share < 0.5 ? share * 2 : 2 - share * 2;
      point("pointermove", along, held ? 1 : 0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

/** Plays as `play` does on a page with a paused `virtualClock`, running it only meanwhile. */
export const playOnClock = (page, options) =>
  page.evaluate(
    `__clock.run(true), (${play})(${JSON.stringify(options)}).finally(() => __clock.run(false))`,
  );
