import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
} from "../../test/toy-canvas";
import { mulberry32 } from "../backdrop-noise";
import { silt } from "./silt";

vi.setConfig({ testTimeout: 60_000 });

const SIZE = 160;
const FRAME = 16;
const VISIBLE = { top: SIZE * 0.21875, bottom: SIZE * 0.78125 };
const TOP_ROW = Math.ceil(VISIBLE.top);
const BOTTOM_ROW = Math.floor(VISIBLE.bottom) - 1;
const MID = SIZE / 2;
const POUR_Y = SIZE * 0.375;
const CAPACITY = SIZE * (BOTTOM_ROW - TOP_ROW + 1);

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let bitmaps: SoftBitmap[];
let stop: () => void;
let viewport: DOMRect;
let draws = 0;

/** Measures the small viewport probe, the only `div` the toy lays out, as `viewport`. */
function mockViewport() {
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLDivElement ? viewport : measure.call(this);
    },
  );
}

const visibleBetween = (top: number, bottom: number, right = SIZE) =>
  new DOMRect(0, top, right, bottom - top);

beforeEach(() => {
  useFakeFrames();
  ({ plain: bitmaps } = installSoftCanvas());
  const seeded = mulberry32(1);
  draws = 0;
  // A spy would keep every call of the millions a long run makes.
  vi.stubGlobal(
    "Math",
    Object.assign(Object.create(Math), {
      random: () => {
        draws += 1;
        return seeded();
      },
    }),
  );
  viewport = visibleBetween(VISIBLE.top, VISIBLE.bottom);
  mockViewport();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  place(canvas, new DOMRect(0, 0, SIZE, SIZE));
  document.body.append(canvas);
  stop = silt.start(canvas);
  bitmap = () => bitmaps[0];
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function run(frames: number) {
  for (let i = 0; i < frames; i += 1) {
    await vi.advanceTimersByTimeAsync(FRAME);
  }
}

const seconds = (s: number) => Math.ceil((s * 1000) / FRAME);

const press = (x: number, y: number) => pointerAt(canvas, "pointerdown", x, y);
const release = () => pointerAt(canvas, "pointerup", 0, 0);
const move = (x: number, y: number) => pointerAt(canvas, "pointermove", x, y);

const cellAt = (x: number, y: number) =>
  bitmap().pixels[(y * SIZE + x) * 4 + 3] > 0;
const rowCells = (y: number) =>
  Array.from({ length: SIZE }, (_, x) => cellAt(x, y)).filter(Boolean).length;
const cells = () =>
  Array.from({ length: SIZE }, (_, y) => rowCells(y)).reduce((a, b) => a + b);
const meanRow = () => {
  let sum = 0;
  for (let y = 0; y < SIZE; y += 1) sum += y * rowCells(y);
  return sum / cells();
};

async function fillTray() {
  press(MID, POUR_Y);
  for (let i = 0; i < 1800; i += 1) {
    move(1 + ((i * 3) % (SIZE - 2)), SIZE * 0.3125);
    await run(1);
  }
  release();
  await run(1);
}

test("a held press pours grains that pile on the bottom of the visible rect", async () => {
  press(MID, POUR_Y);
  await run(30);
  release();
  await run(60);

  expect(cells()).toBeGreaterThan(30);
  expect(rowCells(BOTTOM_ROW)).toBeGreaterThan(0);
  expect(rowCells(BOTTOM_ROW + 1)).toBe(0);
});

test("a released press stops pouring", async () => {
  press(MID, POUR_Y);
  await run(30);
  release();
  await run(1);
  const poured = cells();
  await run(60);

  expect(cells()).toBeLessThanOrEqual(poured);
});

test("dragging while held lays grains along the path", async () => {
  press(SIZE / 8, POUR_Y);
  move(SIZE / 8, POUR_Y);
  await run(1);
  move(SIZE * 0.875, POUR_Y);
  await run(2);
  release();
  await run(80);

  expect(rowCells(BOTTOM_ROW)).toBeGreaterThan(SIZE * 0.4);
});

test("a double-tap turns the tray over so grains fall to the top", async () => {
  press(MID, POUR_Y);
  await run(40);
  release();
  await run(60);
  const before = meanRow();

  press(MID, POUR_Y);
  release();
  await run(10);
  press(MID + 1, POUR_Y);
  release();
  await run(30);

  expect(meanRow()).toBeLessThan(before);
});

test("two taps too far apart do not flip", async () => {
  press(MID, POUR_Y);
  await run(40);
  release();
  await run(60);
  const before = meanRow();

  press(MID, POUR_Y);
  release();
  await run(60);
  press(MID + 1, POUR_Y);
  release();
  await run(30);

  expect(meanRow()).toBeGreaterThanOrEqual(before - 1);
});

test("a full tray drains to empty on its own within 30 s", async () => {
  await fillTray();
  expect(cells()).toBeGreaterThan(CAPACITY * 0.8);

  await run(seconds(30));

  expect(cells()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("a double-tap tips a full tray out within a few seconds", async () => {
  await fillTray();

  press(MID, POUR_Y);
  release();
  await run(10);
  press(MID, POUR_Y);
  release();
  await run(seconds(8));

  expect(cells()).toBeLessThan(CAPACITY * 0.02);
});

test("a tray tipped out turns right way up again", async () => {
  press(MID, POUR_Y);
  await run(40);
  release();
  press(MID, POUR_Y);
  release();
  await run(10);
  press(MID, POUR_Y);
  release();
  await run(seconds(30));
  expect(cells()).toBe(0);

  press(MID, POUR_Y);
  await run(30);
  release();
  await run(60);

  expect(rowCells(BOTTOM_ROW)).toBeGreaterThan(0);
});

test("an untouched tab shows a settled dune on the tray floor and stops asking for frames", async () => {
  await run(1);

  expect(rowCells(BOTTOM_ROW)).toBeGreaterThan(0);
  expect(rowCells(TOP_ROW)).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("the starting dune sits inside the visible rect and survives a minute untouched", async () => {
  await run(1);
  const before = cells();
  const floor = rowCells(BOTTOM_ROW);

  await run(60 * 60);

  expect(cells()).toBe(before);
  expect(rowCells(BOTTOM_ROW)).toBe(floor);
  expect(vi.getTimerCount()).toBe(0);
});

test("the starting dune is wide and flat", async () => {
  await run(1);

  const floor = rowCells(BOTTOM_ROW);
  expect(floor).toBeGreaterThan(SIZE * 0.3);
  expect(
    Array.from({ length: SIZE }, (_, y) => rowCells(y)).filter(Boolean).length,
  ).toBeLessThan(floor / 5);
});

test("the starting dune is re-seeded in the new rect when the window resizes untouched", async () => {
  await run(1);

  viewport = visibleBetween(VISIBLE.top, SIZE * 0.59375);
  window.dispatchEvent(new Event("resize"));
  await run(1);

  expect(rowCells(Math.floor(SIZE * 0.59375) - 1)).toBeGreaterThan(0);
  expect(rowCells(BOTTOM_ROW)).toBe(0);
});

test("the first interaction ends the dune's protection and everything drains", async () => {
  await run(1);
  expect(cells()).toBeGreaterThan(0);

  press(MID, POUR_Y);
  release();
  await run(seconds(30));

  expect(cells()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("input with no sand left waits for the trickle on a timer instead of running flat out", async () => {
  move(MID, POUR_Y);
  await run(60);

  expect(vi.getTimerCount()).toBe(1);
  const frames = vi.spyOn(window, "requestAnimationFrame");
  await vi.advanceTimersByTimeAsync(500);
  expect(frames.mock.calls.length).toBeLessThanOrEqual(5);
});

test("a thin stream trickles in after a pause in input, then stops", async () => {
  move(MID, POUR_Y);
  await run(seconds(5));
  expect(cells()).toBeGreaterThan(0);

  await run(seconds(30));
  expect(cells()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  ["vertical", () => visibleBetween(VISIBLE.top, SIZE * 0.59375)],
  [
    "horizontal",
    () => visibleBetween(VISIBLE.top, VISIBLE.bottom, SIZE * 0.625),
  ],
])(
  "a full tray still drains to still after a %s shrink of the visible rect",
  async (_, shrunk) => {
    await fillTray();

    viewport = shrunk();
    window.dispatchEvent(new Event("resize"));
    await run(seconds(30));

    expect(cells()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);

test("a heap at rest costs no sweep, and still drains once released", async () => {
  const holdOutside = async () => {
    move(MID, -10);
    await run(seconds(12));
    const before = draws;
    await run(75);
    return draws - before;
  };
  press(MID, POUR_Y);
  await run(60);
  const heap = cells();
  const heapDraws = await holdOutside();

  stop();
  canvas.replaceWith((canvas = canvas.cloneNode() as HTMLCanvasElement));
  place(canvas, new DOMRect(0, 0, SIZE, SIZE));
  stop = silt.start(canvas);
  press(MID, -10);
  const emptyDraws = await holdOutside();

  expect(heap).toBeGreaterThan(0);
  expect(heapDraws).toBe(emptyDraws);
});

test("a scripted pour builds a wide heap with gentle flanks, not a spike", async () => {
  press(MID, POUR_Y);
  await run(240);
  release();
  await run(40);

  const heights = Array.from(
    { length: SIZE },
    (_, x) =>
      Array.from({ length: SIZE }, (_, y) => cellAt(x, y)).filter(Boolean)
        .length,
  );
  const steps = heights
    .slice(1)
    .map((h, x) => Math.abs(h - heights[x]))
    .filter((_, x) => heights[x] + heights[x + 1] > 0);

  expect(heights.filter((h) => h > 0).length).toBeGreaterThan(SIZE * 0.45);
  expect(Math.max(...steps)).toBeLessThanOrEqual(8);
  expect(steps.reduce((a, b) => a + b, 0) / steps.length).toBeLessThan(1.2);
});

test("a full tray keeps every grain inside a visible rect that lost its top and bottom rows", async () => {
  await fillTray();

  const top = SIZE * 0.375;
  const bottom = SIZE * 0.625;
  viewport = visibleBetween(top, bottom);
  window.dispatchEvent(new Event("resize"));
  await run(seconds(5));

  for (let y = 0; y < SIZE; y += 1) {
    if (y < Math.ceil(top) || y >= Math.floor(bottom)) {
      expect(rowCells(y)).toBe(0);
    }
  }
});

test("stop cancels its frames and stops listening", async () => {
  press(MID, POUR_Y);
  stop();

  expect(vi.getTimerCount()).toBe(0);
  press(MID, POUR_Y);
  window.dispatchEvent(new Event("resize"));
  expect(vi.getTimerCount()).toBe(0);
});

async function grainsAfter(frameMs: number) {
  stop();
  document.body.replaceChildren();
  useFakeFrames(frameMs);
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  place(canvas, new DOMRect(0, 0, SIZE, SIZE));
  document.body.append(canvas);
  vi.stubGlobal(
    "Math",
    Object.assign(Object.create(Math), { random: mulberry32(1) }),
  );
  bitmap = () => bitmaps[bitmaps.length - 1];
  stop = silt.start(canvas);
  await vi.advanceTimersByTimeAsync(frameMs);
  press(MID, POUR_Y);
  await vi.advanceTimersByTimeAsync(500);
  release();
  await vi.advanceTimersByTimeAsync(1500);
  return cells();
}

test("the tray holds as many grains after the same time at 60 and 120 Hz", async () => {
  const at60 = await grainsAfter(1000 / 60);
  const at120 = await grainsAfter(1000 / 120);

  expect(Math.abs(at120 - at60)).toBeLessThan(at60 * 0.05);
});
