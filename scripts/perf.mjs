/**
 * Measures every toy on every display of the built /play page in headless
 * Chromium, while a scripted pointer plays with it.
 *
 *   pnpm perf [--toy pond] [--display pocket] [--throttle 4] [--seconds 2]
 *             [--against ../base/dist] [--dist dist] [--gpu]
 *
 * Chromium renders in software unless `--gpu` asks for the machine's GPU,
 * which fails rather than fall back. The first line printed says which.
 *
 * Per combination, each averaged over the frames played:
 *   fps, low   frame rate and its 1% low, as the /play meter shows them
 *   cpu        ms of CPU a frame costs: renderer + gpu
 *   renderer   CPU ms across the page's process: script, paint and, in
 *              software, raster
 *   gpu        CPU ms in the GPU process: in software, rastering and
 *              compositing every pixel, so the LCD displays cost several
 *              times what Site does; with `--gpu`, only issuing the GPU's
 *              work, as time on the GPU itself is not counted
 *   script     wall-clock ms the main thread spends in script
 *
 * The frame rate sits at the display's 60 until a frame overruns, so compare
 * `cpu` and use `--throttle`, DevTools' CPU slowdown, to see the frame rate
 * give way. The slowdown also inflates `renderer`, so read the CPU columns
 * unthrottled.
 *
 * A powersave governor would clock the CPU by how hard each display loads it,
 * skewing one display against another, so a spinning core holds the clock
 * high throughout. The machine is still shared: three runs of one build moved
 * `cpu` by up to a sixth and `script` by up to half. `--against` takes another
 * build and measures both back to back for each combination, so drift between
 * runs hits both alike. Pages render at a device pixel ratio of 1: the numbers
 * rank changes on one machine, and are not what a real screen costs.
 */
import { parseArgs } from "node:util";
import { onePercentLow } from "../src/components/frame-rate.ts";
import { holdClockHigh, launch, play, playControls } from "./play-page.mjs";

const { values: options } = parseArgs({
  options: {
    toy: { type: "string" },
    display: { type: "string" },
    throttle: { type: "string", default: "1" },
    seconds: { type: "string", default: "2" },
    against: { type: "string" },
    dist: { type: "string", default: "dist" },
    gpu: { type: "boolean" },
  },
});

const WARM_UP_MS = 500;

const builds = { head: options.dist };
if (options.against) builds.base = options.against;

// A powersave governor clocks the CPU by load, and the displays load it
// differently, so the same script looked 2.5 times slower on one display than
// another. A spinning core holds the clock high for every combination.
holdClockHigh();

const { browser, system, renderer, page, devtools } = await launch(builds, {
  gpu: options.gpu,
});
console.log(`Rendering: ${renderer ?? "software"}`);
await devtools.send("Emulation.setCPUThrottlingRate", {
  rate: Number(options.throttle),
});
const controls = playControls(page);

await controls.open("head");
const toys = await controls.toys();
if (toys.length === 0) {
  throw new Error(`The /play page in ${options.dist} has no toy menu.`);
}
const displays = await controls.displays();

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

/** A fresh page load per measurement, so one toy's leftovers never cost the next. */
const measure = async (host, toy, display) => {
  await controls.open(host);
  if (!(await controls.hasToy(toy))) return undefined;
  if (!(await controls.chooseDisplay(display, displays.length))) {
    return undefined;
  }
  await controls.chooseToy(toy);
  await page.evaluate(play, { ms: WARM_UP_MS });
  const before = await spent();
  const gaps = await page.evaluate(play, {
    ms: Number(options.seconds) * 1000,
  });
  const after = await spent();
  const perFrame = (key) => (after[key] - before[key]) / gaps.length;
  return {
    fps: (gaps.length * 1000) / gaps.reduce((sum, gap) => sum + gap, 0),
    low: onePercentLow(gaps),
    cpu: perFrame("renderer") + perFrame("gpu"),
    renderer: perFrame("renderer"),
    gpu: perFrame("gpu"),
    script: perFrame("script"),
  };
};

const matches = (name, filter) =>
  !filter || name.toLowerCase().includes(filter.toLowerCase());
const round = (value) => Math.round(value * 100) / 100;

const rows = [];
for (const display of displays.filter((name) =>
  matches(name, options.display),
)) {
  for (const toy of toys.filter((id) => matches(id, options.toy))) {
    const base = builds.base && (await measure("base", toy, display));
    const head = await measure("head", toy, display);
    rows.push({
      toy,
      display,
      ...Object.fromEntries(
        Object.entries(head).map(([key, value]) => [key, round(value)]),
      ),
      ...(base && {
        "base cpu": round(base.cpu),
        "cpu Δ%": Math.round((head.cpu / base.cpu - 1) * 100),
      }),
    });
  }
}
await browser.close();

console.table(rows);
