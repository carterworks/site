/**
 * Measures every toy on every display of the built /play page in headless
 * Chromium, while a scripted pointer plays with it.
 *
 *   pnpm perf [--toy pond] [--display pocket] [--throttle 4] [--seconds 2]
 *             [--against ../base/dist] [--rounds 5] [--max-ratio 1.3]
 *             [--dist dist] [--gpu]
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
 * `--against` takes another build, the base, and compares this one, the
 * head, with it instead. Each combination is measured in `--rounds` pairs,
 * each from a fresh load, base and head taking turns to go first, on
 * `virtualClock` so both do the same work in every frame. The shared machine
 * slows a whole pair alike far more often than one half of it, so each pair
 * gives a ratio, head cpu over base cpu, and the row reports their median and
 * range. The last lines name the costliest rows and give the noise: how far
 * each row's ratios stray from its median.
 *
 * With `--max-ratio`, it also exits 1 when any row's median is over that ratio
 * and the head was slower in every round, and prints which; without it, or
 * when the base cannot be compared, it exits 0. A median ignores the odd pair
 * a busy machine throws out, which reached ×1.52 with the same build on both
 * sides, and requiring every round slower ignores a median noise pushed up.
 * CI uses ×1.3: on the i7-8700K below, 5 rounds of 1 s, the same build on both
 * sides had row medians of at most ×1.12, idle or with 12 busy loops; a pass
 * slowed to cost each frame about 1.5× failed 5 of its 7 rows, one 1.2× none,
 * its worst row ×1.26. It catches gross regressions, not small ones.
 *
 * With the same build on both sides, on an i7-8700K shared with other work,
 * 5 rounds of 1 s: idle, the LCD rows' medians stayed in 0.96–1.03 and the
 * Site rows', a third the cost, in 0.92–1.13; with eight busy loops and a
 * build looping, 0.95–1.04 for all. Ratios within a row typically strayed ±7%
 * from its median. So a threshold under about 5% on an LCD row, or 15% on a
 * Site row, would fire on noise here; a CI runner's noise is unmeasured. Two
 * seconds a round did not narrow the Site rows.
 *
 * Pages render at a device pixel ratio of 1: the numbers rank changes on one
 * machine, and are not what a real screen costs.
 */
import { parseArgs } from "node:util";
import { onePercentLow } from "../src/components/play-toolbar/frame-rate.ts";
import {
  holdClockHigh,
  launch,
  play,
  playControls,
  playOnClock,
  virtualClock,
} from "./play-page.mjs";

const { values: options } = parseArgs({
  options: {
    toy: { type: "string" },
    display: { type: "string" },
    throttle: { type: "string", default: "1" },
    seconds: { type: "string" },
    against: { type: "string" },
    rounds: { type: "string", default: "5" },
    "max-ratio": { type: "string" },
    dist: { type: "string", default: "dist" },
    gpu: { type: "boolean" },
  },
});

const WARM_UP_MS = 500;
const seconds = Number(options.seconds ?? (options.against ? 1 : 2));

const builds = { head: options.dist };
if (options.against) builds.base = options.against;

// A powersave governor clocks the CPU by load, and the displays load it
// differently: idle, without this the same Site frame cost three times the
// CPU, and paired ratios strayed ±12% rather than ±9%. Under load it made no
// difference.
holdClockHigh();

const { browser, system, renderer, page, devtools } = await launch(builds, {
  gpu: options.gpu,
});
console.log(`Rendering: ${renderer ?? "software"}`);
await devtools.send("Emulation.setCPUThrottlingRate", {
  rate: Number(options.throttle),
});
if (options.against) {
  await page.context().addInitScript(virtualClock, { paused: true });
}
const playing = (options) =>
  builds.base ? playOnClock(page, options) : page.evaluate(play, options);
const controls = playControls(page);

await controls.open("head");
const toys = await controls.toys();
if (toys.length === 0) {
  throw new Error(`The /play page in ${options.dist} has no toy menu.`);
}
const displays = await controls.displays();
if (builds.base) {
  await controls.open("base");
  if ((await controls.toys()).length === 0) {
    console.log(
      `Could not compare against the base build in ${options.against}: its /play page has no toy menu, a <select data-toy>, to choose toys from.`,
    );
    await browser.close();
    process.exit(0);
  }
}

/** Cumulative CPU ms of each renderer and GPU process, and the page's time in script. */
const spent = async () => {
  const [{ metrics }, { processInfo }] = await Promise.all([
    devtools.send("Performance.getMetrics"),
    system.send("SystemInfo.getProcessInfo"),
  ]);
  return {
    processes: new Map(
      processInfo.map(({ id, type, cpuTime }) => [
        id,
        { type, ms: cpuTime * 1000 },
      ]),
    ),
    script: metrics.find(({ name }) => name === "ScriptDuration").value * 1000,
  };
};
/** A process gone by `after` would read as negative time, so only those in `after` count. */
const cpuBetween = (before, after, kind) =>
  [...after.processes]
    .filter(([, { type }]) => type === kind)
    .reduce(
      (sum, [id, { ms }]) => sum + ms - (before.processes.get(id)?.ms ?? 0),
      0,
    );

/** A fresh page load per measurement, so one toy's leftovers never cost the next. */
const measure = async (host, toy, display) => {
  await controls.open(host);
  if (!(await controls.hasToy(toy))) return undefined;
  if (!(await controls.chooseDisplay(display, displays.length))) {
    return undefined;
  }
  await controls.chooseToy(toy);
  await playing({ ms: WARM_UP_MS });
  const before = await spent();
  const gaps = await playing({ ms: seconds * 1000 });
  const after = await spent();
  const perFrame = (ms) => ms / gaps.length;
  const rendererMs = perFrame(cpuBetween(before, after, "renderer"));
  const gpuMs = perFrame(cpuBetween(before, after, "GPU"));
  return {
    fps: (gaps.length * 1000) / gaps.reduce((sum, gap) => sum + gap, 0),
    low: onePercentLow(gaps),
    cpu: rendererMs + gpuMs,
    renderer: rendererMs,
    gpu: gpuMs,
    script: perFrame(after.script - before.script),
  };
};

const matches = (name, filter) =>
  !filter || name.toLowerCase().includes(filter.toLowerCase());
const round = (value) => Math.round(value * 100) / 100;
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle - 1)]) / 2;
};

const rows = [];
for (const display of displays.filter((name) =>
  matches(name, options.display),
)) {
  for (const toy of toys.filter((id) => matches(id, options.toy))) {
    if (!options.against) {
      const head = await measure("head", toy, display);
      rows.push({
        toy,
        display,
        ...Object.fromEntries(
          Object.entries(head).map(([key, value]) => [key, round(value)]),
        ),
      });
      continue;
    }
    const pairs = [];
    for (let pair = 0; pair < Number(options.rounds); pair += 1) {
      // Alternating which goes first cancels any cost of going first or second.
      const order = pair % 2 ? ["head", "base"] : ["base", "head"];
      const measured = {};
      for (const host of order) {
        measured[host] = await measure(host, toy, display);
      }
      if (measured.base && measured.head) {
        pairs.push({ base: measured.base.cpu, head: measured.head.cpu });
      }
    }
    if (pairs.length === 0) continue;
    const ratios = pairs.map(({ base, head }) => head / base);
    const ratio = median(ratios);
    rows.push({
      toy,
      display,
      "base cpu": round(median(pairs.map(({ base }) => base))),
      "head cpu": round(median(pairs.map(({ head }) => head))),
      ratio,
      lowest: Math.min(...ratios),
      highest: Math.max(...ratios),
      strays: Math.max(...ratios.map((each) => Math.abs(each / ratio - 1))),
    });
  }
}
await browser.close();

if (!options.against) {
  console.table(rows);
} else if (rows.length === 0) {
  console.log(
    `Could not compare against the base build in ${options.against}: no toy on any display could be measured on both builds.`,
  );
} else {
  const percent = (share) => `${Math.round(share * 100)}%`;
  console.table(
    rows.map(({ ratio, lowest, highest, strays, ...row }) => ({
      ...row,
      ratio: ratio.toFixed(2),
      range: `${lowest.toFixed(2)}–${highest.toFixed(2)}`,
      "strays ±": percent(strays),
    })),
  );
  const named = ({ toy, display, ratio, lowest, highest }) =>
    `${toy} on ${display} ×${ratio.toFixed(2)} (${lowest.toFixed(2)}–${highest.toFixed(2)})`;
  const byRatio = rows.toSorted((a, b) => b.ratio - a.ratio);
  console.log(
    `Costliest against base: ${byRatio.slice(0, 3).map(named).join("; ")}.`,
  );
  const strays = rows.map((row) => row.strays);
  const widest = rows.find((row) => row.strays === Math.max(...strays));
  console.log(
    `Noise: within a row, the paired ratios stray from its median by ±${percent(median(strays))} typically and ±${percent(widest.strays)} at most (${named(widest)}). Medians of ${rows.length} rows run ${byRatio.at(-1).ratio.toFixed(2)}–${byRatio[0].ratio.toFixed(2)}.`,
  );
  if (options["max-ratio"]) {
    const limit = Number(options["max-ratio"]);
    const over = byRatio.filter(
      ({ ratio, lowest }) => ratio > limit && lowest > 1,
    );
    if (over.length === 0) {
      console.log(
        `Passed: no row was over ×${limit} at its median and slower in every round; the costliest was ${named(byRatio[0])}.`,
      );
    } else {
      console.log(
        `Failed: ${over.length} of ${rows.length} rows were over ×${limit} at their median and slower in every round: ${over.map(named).join("; ")}.`,
      );
      process.exitCode = 1;
    }
  }
}
