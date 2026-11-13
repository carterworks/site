import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import type { Point } from "./toy";
import { farCells, renderBlobs, wax } from "./wax";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const columns = 160;
const rows = 160;
/** About one gallery tile of glass, so the lamp is as sparse as the prototype's. */
const span = 54;
const edge = (columns - span) / 2;
const visible = {
  left: edge,
  top: edge,
  right: edge + span,
  bottom: edge + span,
};

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;
let view: DOMRect;

/** Measures the small viewport probe as `view`, which `visibleCells` fits the lamp to. */
function measureViewAs(rect: DOMRect) {
  view = rect;
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLDivElement ? view : measure.call(this);
    },
  );
}

function mount() {
  const { plain } = installSoftCanvas();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: columns, height: rows });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, 0, columns, rows));
  document.body.append(canvas);
  stop = wax.start(canvas);
  bitmap = () => plain[0];
}

beforeEach(() => {
  useFakeFrames();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(3));
  measureViewAs(new DOMRect(edge, edge, span, span));
  mount();
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const run = async (frames: number) => {
  for (let i = 0; i < frames; i += 1) await vi.advanceTimersByTimeAsync(16);
};

/** What the lamp has drawn, as the band (alpha over 255) of each cell. */
function field() {
  const { pixels } = bitmap();
  const bands = new Float32Array(columns * rows);
  for (let i = 0; i < bands.length; i += 1) bands[i] = pixels[i * 4 + 3] / 255;
  return bands;
}

const mass = () => field().reduce((sum, value) => sum + value, 0);

/** Centre of the solid wax connected to the solid cell nearest `near`. */
function blobNear(near: Point): Point {
  const bands = field();
  let seed = -1;
  let best = Infinity;
  bands.forEach((value, i) => {
    if (value < 1) return;
    const distance = Math.hypot(
      (i % columns) - near.x,
      Math.floor(i / columns) - near.y,
    );
    if (distance < best) [best, seed] = [distance, i];
  });
  const seen = new Set([seed]);
  const queue = [seed];
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const x = queue[i] % columns;
    const y = Math.floor(queue[i] / columns);
    sx += x + 0.5;
    sy += y + 0.5;
    for (const next of [
      queue[i] - 1,
      queue[i] + 1,
      queue[i] - columns,
      queue[i] + columns,
    ]) {
      if (bands[next] === 1 && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return { x: sx / queue.length, y: sy / queue.length };
}

function centroidY(from: number, to: number) {
  const bands = field();
  let sum = 0;
  let total = 0;
  for (let y = from; y < to; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      sum += bands[y * columns + x] * y;
      total += bands[y * columns + x];
    }
  }
  return sum / total;
}

const centre = { x: columns / 2, y: columns / 2 };
const middle = (visible.top + visible.bottom) / 2;

test("hot wax at the bottom rises while cool wax at the top sinks", async () => {
  await run(1);
  const bottom = centroidY(middle, visible.bottom);
  const top = centroidY(visible.top, middle);
  await run(40);

  expect(centroidY(middle, visible.bottom)).toBeLessThan(bottom);
  expect(centroidY(visible.top, middle)).toBeGreaterThan(top);
});

const lit = ({ x, y }: Point) =>
  field()[Math.floor(y) * columns + Math.floor(x)] === 1;

/** Drags the blob nearest the middle across the glass, or just hovers there. */
async function sweep(held: boolean) {
  await run(1);
  const start = blobNear(centre);
  const direction = start.x < centre.x ? 1 : -1;
  if (held) pointerAt(canvas, "pointerdown", start.x, start.y);
  let pointer = start;
  for (let step = 1; step <= 60; step += 1) {
    pointer = { x: start.x + direction * 0.25 * step, y: start.y };
    pointerAt(canvas, "pointermove", pointer.x, pointer.y);
    await run(1);
  }
  return { pointer, direction };
}

test("a press near a blob grabs it and the blob follows the pointer while held", async () => {
  const dragged = await sweep(true);
  expect(lit(dragged.pointer)).toBe(true);
  stop();
  canvas.remove();

  mount();
  const hovered = await sweep(false);
  expect(lit(hovered.pointer)).toBe(false);
});

test("letting go mid-drag flings the blob on with its momentum", async () => {
  const flung = async (pause: boolean) => {
    const { pointer, direction } = await sweep(true);
    if (pause) await run(30);
    const ahead = { x: pointer.x + direction * 6, y: pointer.y };
    pointerAt(canvas, "pointerup", pointer.x, pointer.y);
    canvas.dispatchEvent(new PointerEvent("pointerleave"));
    let reached = false;
    for (let step = 0; step < 60; step += 1) {
      await run(1);
      reached ||= lit(ahead);
    }
    return reached;
  };

  expect(await flung(false)).toBe(true);
  stop();
  canvas.remove();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(3));
  mount();
  expect(await flung(true)).toBe(false);
});

test("a tap on empty glass pushes the nearby wax away", async () => {
  await run(1);
  const before = blobNear(centre);
  const tap = { x: before.x + (before.x < centre.x ? -12 : 12), y: before.y };
  pointerAt(canvas, "pointerdown", tap.x, tap.y);
  pointerAt(canvas, "pointerup", tap.x, tap.y);
  await run(30);

  const after = blobNear(before);
  expect(Math.hypot(after.x - tap.x, after.y - tap.y)).toBeGreaterThan(
    Math.hypot(before.x - tap.x, before.y - tap.y) + 2,
  );
});

test("a finger that has not pressed leaves the wax alone", async () => {
  await run(1);
  const before = blobNear(centre);
  pointerAt(canvas, "pointermove", before.x, before.y, {
    pointerType: "touch",
  });
  await run(1);

  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(vi.getTimerCount()).toBe(0);
});

test("an untouched lamp cools to a stop and a touch warms it again", async () => {
  await run(60);
  expect(vi.getTimerCount()).toBe(1);

  await vi.advanceTimersByTimeAsync(60_000);
  expect(vi.getTimerCount()).toBe(0);

  const resting = bitmap().pixels.slice();
  await vi.advanceTimersByTimeAsync(1000);
  expect(bitmap().pixels).toEqual(resting);

  pointerAt(canvas, "pointermove", 10, 10);
  expect(vi.getTimerCount()).toBe(1);
});

test("a resize refits the lamp to the glass on screen", async () => {
  measureViewAs(new DOMRect(edge + 10, edge, 20, span));
  window.dispatchEvent(new Event("resize"));
  await run(60);

  const bands = field();
  const outside = bands.some(
    (value, i) =>
      value > 0 && (i % columns < edge + 10 || i % columns >= edge + 30),
  );
  expect(outside).toBe(false);
  expect(mass()).toBeGreaterThan(0);
});

test("the bounded render matches summing every blob over every cell but for cells on a band edge", () => {
  const random = mulberry32(11);
  const blobs = Array.from({ length: 7 }, () => ({
    x: visible.left + random() * span,
    y: visible.top + random() * span,
    r: 2.5 + random() * 2.5,
  }));
  const bands = (sum: number) =>
    sum >= 1 ? 1 : sum > 0.72 ? 0.55 : sum > 0.5 ? 0.22 : 0;
  const full = new Float32Array(columns * rows);
  for (let y = Math.floor(visible.top); y < visible.bottom; y += 1) {
    for (let x = Math.floor(visible.left); x < visible.right; x += 1) {
      let sum = 0;
      for (const { x: bx, y: by, r } of blobs) {
        const dx = x + 0.5 - bx;
        const dy = y + 0.5 - by;
        sum += (r * r) / (dx * dx + dy * dy + 0.5);
      }
      full[y * columns + x] = bands(sum);
    }
  }

  const bounded = new Float32Array(columns * rows);
  renderBlobs(
    blobs,
    visible,
    columns,
    {
      near: new Float64Array(columns * rows),
      far: new Float64Array(farCells(columns, rows)),
    },
    bounded,
  );

  const differing = bounded.filter((value, i) => value !== full[i]).length;
  expect(differing).toBeLessThan(span * span * 0.005);
});

test("the lamp holds the same few blobs however much glass is visible", async () => {
  const massOver = async (rect: DOMRect) => {
    stop();
    canvas.remove();
    vi.spyOn(Math, "random").mockImplementation(mulberry32(3));
    measureViewAs(rect);
    mount();
    await run(1);
    return mass();
  };
  const tile = await massOver(new DOMRect(edge, edge, span, span));
  const viewport = await massOver(new DOMRect(0, 30, columns, 100));

  expect(viewport / tile).toBeLessThan(1.5);
});

test("stop cancels its frame and stops listening", () => {
  pointerAt(canvas, "pointerdown", 80, 80);
  stop();

  expect(vi.getTimerCount()).toBe(0);
  pointerAt(canvas, "pointermove", 80, 80);
  window.dispatchEvent(new Event("resize"));
  expect(vi.getTimerCount()).toBe(0);
});

setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc") as () => void;

/** Frames of the lamp, kept awake past its cooling by a nudge every 50. */
async function runAwake(frames: number) {
  for (let i = 0; i < frames; i += 50) {
    pointerAt(canvas, "pointermove", 80, 80);
    await run(50);
  }
}

test("a frame of the lamp allocates next to nothing beyond the canvas it draws on", async () => {
  const perFrame = async (frames: number) => {
    collect();
    const before = process.memoryUsage().heapUsed;
    await runAwake(frames);
    return (process.memoryUsage().heapUsed - before) / frames;
  };
  // A spy keeps every call it sees, which would read as the lamp leaking.
  vi.mocked(Math.random).mockRestore();
  stop();
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(columns, rows);
  let drawing = true;
  requestAnimationFrame(function again() {
    if (!drawing) return;
    context.putImageData(image, 0, 0);
    requestAnimationFrame(again);
  });
  await runAwake(1000);
  const floor = await perFrame(500);
  drawing = false;
  await run(1);
  canvas.remove();
  mount();
  await runAwake(1000);

  expect(await perFrame(500)).toBeLessThan(floor + 900);
});

test("shrinking the glass wipes the wax drawn where it used to be", async () => {
  await run(2);
  const smaller = new DOMRect(edge, edge, span / 2, span / 2);
  expect(mass()).toBeGreaterThan(0);

  view = smaller;
  window.dispatchEvent(new Event("resize"));
  await run(1);

  const bands = field();
  const outside = bands.filter(
    (value, i) =>
      value > 0 &&
      (i % columns >= smaller.right ||
        Math.floor(i / columns) >= smaller.bottom),
  );
  expect(outside).toHaveLength(0);
});
