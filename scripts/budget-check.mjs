/**
 * Holds the built site to the budgets in `scripts/budgets.mjs`: prints every
 * measured value beside its limit, and exits non-zero if any is over, or if
 * anything it measures comes back empty.
 *
 *   pnpm budgets [--dist dist]
 *
 * It drives the build in Playwright's headless Chromium, rendering in
 * software as CI does. Nothing it judges is a time: every number is a count
 * of work asked for, exact for a pinned Chromium build, because each page
 * runs on `virtualClock` from `scripts/play-page.mjs` and the same scripted
 * pointer then asks for the same work on every run, on any machine, however
 * loaded. What that work costs in CPU time is `pnpm perf --against`'s
 * concern, which compares a build against its base.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { parseArgs } from "node:util";
import { brotliCompressSync, constants } from "node:zlib";
import budgets from "./budgets.mjs";
import {
  launch,
  playControls,
  playOnClock,
  virtualClock,
} from "./play-page.mjs";

const { values: options } = parseArgs({
  options: { dist: { type: "string", default: "dist" } },
});

const HOST = "site";
const ORIGIN = `http://${HOST}.localhost`;
// Pinned, so a change of zlib's defaults cannot move the byte budget.
const BROTLI = {
  [constants.BROTLI_PARAM_QUALITY]: 11,
  [constants.BROTLI_PARAM_LGWIN]: 22,
};
// Carries the renderer's compositor frame, with its render passes and quads.
const QUADS = "disabled-by-default-viz.quads";

const started = Date.now();
/** Logs time so far, so a slow runner's log shows where the time went. */
const lap = (stage) =>
  console.log(`${stage} at ${Math.round((Date.now() - started) / 1000)} s.`);
const results = [];
const check = (budget, measured, limit) =>
  results.push({
    budget,
    measured,
    limit,
    result: measured <= limit ? "ok" : "MISSED",
  });
/** A measurement that comes back empty would pass every budget, so it fails the run. */
const need = (found, why) => {
  if (!found) throw new Error(`Cannot measure the budgets: ${why}.`);
};
const sum = (values) => values.reduce((total, value) => total + value, 0);
const most = (rows, key) => Math.max(0, ...rows.map((row) => row[key]));

const { browser, renderer, page, devtools } = await launch({
  [HOST]: options.dist,
});
if (renderer) {
  await browser.close();
  throw new Error(
    `Chromium composited with ${renderer}; budgets need software.`,
  );
}
// The compositor counts hold for one Chromium build rendering in software, so
// a first failure on a new machine starts by comparing this line.
console.log(`Chromium ${browser.version()}, compositing in software.`);
// A selector that matches nothing should fail the run now, not in 30 s.
page.setDefaultTimeout(10_000);

const metrics = async () => {
  const all = Object.fromEntries(
    (await devtools.send("Performance.getMetrics")).metrics.map(
      ({ name, value }) => [name, value],
    ),
  );
  for (const name of [
    "LayoutCount",
    "RecalcStyleCount",
    "Nodes",
    "JSEventListeners",
  ]) {
    need(name in all, `Performance.getMetrics has no ${name}`);
  }
  return all;
};

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
  need(scripts.size > 0, `${path} loaded no scripts`);
  const bytes = sum(
    [...scripts].map(
      (script) =>
        brotliCompressSync(readFileSync(join(options.dist, script)), {
          params: BROTLI,
        }).length,
    ),
  );
  check(`JavaScript on ${path}, brotli bytes`, bytes, limit);
}
await devtools.send("Network.setCacheDisabled", { cacheDisabled: false });
await page.goto(`${ORIGIN}/`);
const fonts = await page
  .locator('link[rel="preload"][as="font"]')
  .evaluateAll((links) => links.map((link) => new URL(link.href).pathname));
need(
  fonts.sort().join(", ") === Object.keys(budgets.font).sort().join(", "),
  `the homepage preloads ${fonts.join(", ") || "no font"}, but budgets.font holds ${Object.keys(budgets.font).join(", ")}`,
);
for (const [path, limit] of Object.entries(budgets.font)) {
  check(`Font ${path}, bytes`, statSync(join(options.dist, path)).size, limit);
}

lap("Measured bytes");

await page.context().addInitScript(virtualClock, { paused: true });
// Counts, per frame, the canvas pixels written and read and the calls that did.
// Areas are as asked for, before clipping to the canvas.
await page.context().addInitScript(() => {
  const work = (window.__canvasWork = []);
  let row;
  // A dirty rectangle may run negative, and is clipped to the image.
  const clip = (from, length, limit) => {
    const start = Math.min(from, from + length);
    return Math.max(
      0,
      Math.min(limit, start + Math.abs(length)) - Math.max(0, start),
    );
  };
  const areas = {
    putImageData: (
      image,
      dx,
      dy,
      x = 0,
      y = 0,
      w = image.width,
      h = image.height,
    ) => clip(x, w, image.width) * clip(y, h, image.height),
    // Only the three-argument form leaves the destination's size to the image.
    drawImage: (image, ...at) =>
      Math.abs(
        at.length === 2 ? image.width * image.height : at.at(-2) * at.at(-1),
      ),
    getImageData: (x, y, w, h) => Math.abs(w * h),
  };
  for (const Context of [
    CanvasRenderingContext2D,
    OffscreenCanvasRenderingContext2D,
  ]) {
    for (const [name, area] of Object.entries(areas)) {
      const method = Context.prototype[name];
      Context.prototype[name] = function (...args) {
        const { frame } = window.__clock;
        if (row?.frame !== frame) {
          row = { frame, written: 0, read: 0, calls: 0 };
          work.push(row);
        }
        row[name === "getImageData" ? "read" : "written"] += area(...args);
        row.calls += 1;
        return method.apply(this, args);
      };
    }
  }
});

const playFor = (options) => playOnClock(page, options);

const controls = playControls(page);
await controls.open(HOST);
const toys = await controls.toys();
const displays = await controls.displays();
need(toys.length > 0, "/play offers no toys");
for (const [name, limits] of Object.entries(budgets.perFrame)) {
  const budgeted = Object.keys(limits).sort().join(", ");
  need(
    budgeted === [...displays].sort().join(", "),
    `${name} budgets ${budgeted}, but /play offers ${displays.join(", ")}`,
  );
}

/**
 * Live DOM nodes and event listeners after garbage collection. Leftovers of a
 * first pass, such as a cache filled once, are not leaks, so each tour runs
 * once before it is measured.
 */
const live = async () => {
  await playFor({ ms: 100, press: false });
  await devtools.send("HeapProfiler.collectGarbage");
  const { Nodes, JSEventListeners } = await metrics();
  return { nodes: Nodes, listeners: JSEventListeners };
};
const leaks = async (name, tour) => {
  await tour();
  const before = await live();
  await tour();
  const after = await live();
  for (const [key, noun] of [
    ["nodes", "DOM nodes"],
    ["listeners", "event listeners"],
  ]) {
    check(
      `Leaks: ${noun} gained ${name} (${before[key]} before)`,
      after[key] - before[key],
      budgets.leaks[key],
    );
  }
};
await leaks("touring every toy and display on /play", async () => {
  for (const toy of toys) {
    await controls.chooseToy(toy);
    await playFor({ ms: 100 });
  }
  for (const display of [...displays.slice(1), displays[0]]) {
    await controls.chooseDisplay(display, displays.length);
    await playFor({ ms: 100 });
  }
  await controls.chooseToy(toys[0]);
});
/** Follows a link, or history, with the clock running for the swap's timeouts. */
const navigate = async (go) => {
  const loaded = page.evaluate(() => {
    __clock.run(true);
    return new Promise((resolve) =>
      document.addEventListener("astro:page-load", resolve, { once: true }),
    );
  });
  const from = page.url();
  await go();
  await Promise.race([
    loaded,
    wait(10_000, undefined, { ref: false }).then(() => {
      throw new Error(`Navigating away from ${from} never finished.`);
    }),
  ]);
  await playFor({ ms: 500, press: false });
};
lap("Toured /play");
await page.goto(`${ORIGIN}/`);
await leaks("navigating home, blog, a post, back, home", async () => {
  await navigate(() =>
    page.locator('a[href="/blog/"]:visible').first().click(),
  );
  await navigate(() => page.locator("main h2 a").first().click());
  await navigate(() => page.goBack());
  await navigate(() => page.locator('a[href="/"]:visible').first().click());
});

/** The renderer's compositor frames drawn during a play. */
const traceFrames = async (options) => {
  const frames = [];
  const collect = ({ value }) => {
    for (const { name, args } of value) {
      if (
        name === "LayerTreeHostImpl:snapshot" &&
        args.snapshot?.frame?.render_passes
      ) {
        frames.push(args.snapshot.frame.render_passes);
      }
    }
  };
  devtools.on("Tracing.dataCollected", collect);
  await devtools.send("Tracing.start", {
    traceConfig: { includedCategories: [QUADS] },
    transferMode: "ReportEvents",
  });
  await playFor(options);
  const complete = new Promise((resolve) =>
    devtools.once("Tracing.tracingComplete", resolve),
  );
  await devtools.send("Tracing.end");
  await complete;
  devtools.off("Tracing.dataCollected", collect);
  return frames.map(compositorWork);
};
/** Shoelace: a quad in its target space may be any quadrilateral. */
const area = (quad) =>
  Math.abs(
    sum(
      [0, 2, 4, 6].map((i) => {
        const j = (i + 2) % 8;
        return quad[i] * quad[j + 1] - quad[j] * quad[i + 1];
      }),
    ) / 2,
  );
/** The root pass draws last, onto the screen; every other is an offscreen surface. */
const compositorWork = (passes) => ({
  renderPasses: passes.length,
  offscreenPixels: sum(
    passes.slice(0, -1).map(({ output_rect: [, , w, h] }) => w * h),
  ),
  blendedPixels: sum(
    passes.flatMap(({ quad_list, shared_quad_state_list }) =>
      quad_list
        .filter(
          (quad) =>
            shared_quad_state_list[quad.shared_quad_state.index].blend_mode !==
            "SrcOver",
        )
        .map((quad) => area(quad.visible_rect_as_target_space_quad)),
    ),
  ),
});

lap("Toured pages");
const rows = [];
for (const display of displays) {
  for (const toy of toys) {
    await controls.open(HOST);
    need(
      await controls.chooseDisplay(display, displays.length),
      `/play offers no display ${display} after a reload`,
    );
    await controls.chooseToy(toy);
    await page.goto(`${ORIGIN}/`);
    await playFor({ ms: 500, press: false });
    await page.evaluate(() => __canvasWork.splice(0));
    const start = await metrics();
    const compositor = await traceFrames({ ms: 500, press: false });
    const canvas = await page.evaluate(() => __canvasWork.splice(0));
    const hovered = await metrics();
    await playFor({ ms: 500, press: true });
    const pressed = await metrics();
    const gained = (to, from, name) => to[name] - from[name];
    rows.push({
      toy,
      display,
      hoverLayouts: gained(hovered, start, "LayoutCount"),
      hoverStyleRecalcs: gained(hovered, start, "RecalcStyleCount"),
      pressLayouts: gained(pressed, hovered, "LayoutCount"),
      pressStyleRecalcs: gained(pressed, hovered, "RecalcStyleCount"),
      canvasFrames: canvas.length,
      canvasPixelsWritten: most(canvas, "written"),
      canvasPixelsRead: most(canvas, "read"),
      canvasCalls: most(canvas, "calls"),
      traced: compositor.length > 0,
      renderPasses: most(compositor, "renderPasses"),
      offscreenPixels: most(compositor, "offscreenPixels"),
      blendedPixels: most(compositor, "blendedPixels"),
    });
  }
  lap(`Measured every toy on ${display}`);
}
await browser.close();
console.table(rows);

/** The row with the highest `key`, so a failure names the toy and display. */
const worst = (key, of = rows) =>
  of.reduce((top, row) => (row[key] > top[key] ? row : top));
for (const [key, limit] of Object.entries(budgets.play)) {
  const { [key]: value, toy, display } = worst(key);
  check(`${key}, worst: ${toy} on ${display}`, value, limit);
}
for (const display of displays) {
  const shown = rows.filter((row) => row.display === display);
  need(most(shown, "canvasFrames") > 0, `no canvas drawing on ${display}`);
  need(
    shown.some((row) => row.traced),
    `no ${QUADS} frames on ${display}`,
  );
  for (const [key, limits] of Object.entries(budgets.perFrame)) {
    const { [key]: value, toy } = worst(key, shown);
    check(
      `${key} per frame on ${display}, worst: ${toy}`,
      value,
      limits[display],
    );
  }
}

console.table(results);
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
