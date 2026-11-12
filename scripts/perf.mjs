/**
 * Measures every toy on every display of the built /play page in headless
 * Chromium, while a scripted pointer plays with it.
 *
 *   pnpm perf [--toy pond] [--display pocket] [--throttle 4] [--seconds 2]
 *             [--json out.json] [--baseline base.json] [--dist dist]
 *
 * Per combination, each averaged over the frames played:
 *   fps, low   frame rate and its 1% low, as the /play meter shows them
 *   cpu        ms of CPU a frame costs: renderer + gpu
 *   renderer   CPU ms across the page's process: script, paint and raster
 *   gpu        CPU ms in the GPU process, where headless Chromium composites
 *              in software
 *   script     ms the main thread spends in script, waits included
 *
 * The frame rate sits at the display's 60 until a frame overruns, so compare
 * `cpu` between runs and use `--throttle`, DevTools' CPU slowdown, to see the
 * frame rate give way. The slowdown also inflates `renderer`, so read the CPU
 * columns unthrottled. Headless Chromium has no GPU and ignores the device
 * pixel ratio: the numbers rank changes on one machine, and are not what a
 * real screen costs.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { onePercentLow } from "../src/components/frame-rate.ts";

const { values: options } = parseArgs({
  options: {
    toy: { type: "string" },
    display: { type: "string" },
    throttle: { type: "string", default: "1" },
    seconds: { type: "string", default: "2" },
    json: { type: "string" },
    baseline: { type: "string" },
    dist: { type: "string", default: "dist" },
  },
});

const WARM_UP_MS = 500;
const dist = pathToFileURL(`${resolve(options.dist)}/`);
if (!existsSync(new URL("play/index.html", dist))) {
  throw new Error(
    `No /play page in ${options.dist}: run \`pnpm build\` first.`,
  );
}

const browser = await chromium.launch({ channel: "chromium" });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
});
await context.route("**/*", (route) => {
  const { pathname } = new URL(route.request().url());
  const file = new URL(
    `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`,
    dist,
  );
  return existsSync(file)
    ? route.fulfill({ path: file.pathname })
    : route.fulfill({ status: 404 });
});
const page = await context.newPage();
await page.goto("http://localhost/play/");
const devtools = await context.newCDPSession(page);
const system = await browser.newBrowserCDPSession();
await devtools.send("Performance.enable");
await devtools.send("Emulation.setCPUThrottlingRate", {
  rate: Number(options.throttle),
});

const toys = await page
  .locator("[data-toy] option:not([hidden])")
  .evaluateAll((all) =>
    all.map((option) => option.value).filter((id) => id !== "random"),
  );
if (toys.length === 0) {
  throw new Error(`The /play page in ${options.dist} has no toy menu.`);
}
const displayButton = page.locator("[data-display]");
const shownDisplay = async () =>
  (await displayButton.textContent()).replace("Display: ", "");
const displays = [];
while (!displays.includes(await shownDisplay())) {
  displays.push(await shownDisplay());
  await displayButton.click();
}

/**
 * Runs in the page. Sweeps the pointer down the viewport's diagonal, then
 * drags it back up, placing it by the clock so a slow frame samples the same
 * path more coarsely. Resolves with the ms between frames.
 */
const play = (ms) =>
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
        point("pointerup", 0, 0);
        resolve(gaps);
        return;
      }
      if (share >= 0.5 && !held) {
        point("pointerdown", 1, 1);
        held = true;
      }
      point("pointermove", held ? 2 - share * 2 : share * 2, held ? 1 : 0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

/** Cumulative ms: CPU across each kind of process, and the page's time in script. */
const spent = async () => {
  const [{ metrics }, { processInfo }] = await Promise.all([
    devtools.send("Performance.getMetrics"),
    system.send("SystemInfo.getProcessInfo"),
  ]);
  const cpu = (kind) =>
    processInfo
      .filter(({ type }) => type === kind)
      .reduce((sum, { cpuTime }) => sum + cpuTime * 1000, 0);
  return {
    renderer: cpu("renderer"),
    gpu: cpu("GPU"),
    script: metrics.find(({ name }) => name === "ScriptDuration").value * 1000,
  };
};

const matches = (name, filter) =>
  !filter || name.toLowerCase().includes(filter.toLowerCase());
const baseline = options.baseline
  ? JSON.parse(readFileSync(options.baseline, "utf8"))
  : [];

const results = [];
for (const display of displays) {
  while ((await shownDisplay()) !== display) await displayButton.click();
  if (!matches(display, options.display)) continue;
  for (const toy of toys.filter((id) => matches(id, options.toy))) {
    await page.selectOption("[data-toy]", toy);
    await page.evaluate(play, WARM_UP_MS);
    const before = await spent();
    const gaps = await page.evaluate(play, Number(options.seconds) * 1000);
    const after = await spent();
    const perFrame = (key) => (after[key] - before[key]) / gaps.length;
    results.push({
      toy,
      display,
      fps: (gaps.length * 1000) / gaps.reduce((sum, gap) => sum + gap, 0),
      low: onePercentLow(gaps),
      cpu: perFrame("renderer") + perFrame("gpu"),
      renderer: perFrame("renderer"),
      gpu: perFrame("gpu"),
      script: perFrame("script"),
    });
  }
}
await browser.close();

if (options.json) writeFileSync(options.json, JSON.stringify(results, null, 2));

const round = (value) => Math.round(value * 100) / 100;
console.table(
  results.map(({ toy, display, ...numbers }) => {
    const base = baseline.find(
      (row) => row.toy === toy && row.display === display,
    );
    return {
      toy,
      display,
      ...Object.fromEntries(
        Object.entries(numbers).map(([key, value]) => [key, round(value)]),
      ),
      ...(base && { "cpu Δ%": Math.round((numbers.cpu / base.cpu - 1) * 100) }),
    };
  }),
);
