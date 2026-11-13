import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { mulberry32 } from "../backdrop-noise";
import { culture } from "./culture";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const SIZE = 160;
const STEP = 1000 / 60;
const NO_JITTER = () => 0.99;
const CURSOR = Math.round(0.6 * 255);

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: (() => void) | undefined;
let viewport: DOMRect;

/** Measures the small viewport probe, the only div the toy's canvas has to measure, as `viewport`. */
function measureViewport() {
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLDivElement ? viewport : measure.call(this);
    },
  );
}

function mount(size = SIZE) {
  const { plain } = installSoftCanvas();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: size, height: size });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, 0, size * 4, size * 4));
  viewport = new DOMRect(0, 0, size * 4, size * 4);
  document.body.append(canvas);
  bitmap = () => plain[0];
}

function begin(random: () => number = NO_JITTER, size = SIZE) {
  mount(size);
  vi.spyOn(Math, "random").mockImplementation(random);
  stop = culture.start(canvas);
}

beforeEach(() => {
  useFakeFrames();
  measureViewport();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * One 60 Hz frame. It is a hair shorter than a colony step, so a frame now and
 * then runs none: 10 frames run a generation (9 steps) and 19 run two, and an
 * input needs `settle` to be sure a step has taken it.
 */
const frame = () => vi.advanceTimersByTimeAsync(16);
const frames = async (count: number) => {
  for (let i = 0; i < count; i += 1) await frame();
};
const settle = () => frames(2);
const alphaAt = (x: number, y: number) =>
  bitmap().pixels[(y * bitmap().width + x) * 4 + 3];
const alive = (x: number, y: number) => alphaAt(x, y) === 255;
function population() {
  const { pixels } = bitmap();
  let count = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 255) count += 1;
  return count;
}
/** Presses in the far corner, so the stamp stays clear of the stroke. */
async function drawAcross(y: number, from: number, to: number) {
  pointerAt(canvas, "pointermove", from + 0.5, y + 0.5);
  await settle();
  pointerAt(canvas, "pointerdown", 0.5, 0.5, { buttons: 1 });
  pointerAt(canvas, "pointermove", to + 0.5, y + 0.5, { buttons: 1 });
  await settle();
}

const release = () => pointerAt(canvas, "pointerup", 0.5, 0.5);

test("a drawn blinker flips between a row and a column", async () => {
  begin();
  await drawAcross(40, 39, 41);
  release();
  expect([39, 40, 41].map((x) => alive(x, 40))).toEqual([true, true, true]);

  await frames(10);
  expect([39, 41].map((x) => alive(x, 40))).toEqual([false, false]);
  expect([39, 40, 41].map((y) => alive(40, y))).toEqual([true, true, true]);

  await frames(9);
  expect([39, 40, 41].map((x) => alive(x, 40))).toEqual([true, true, true]);
});

test("generations crawl while a press is held", async () => {
  begin();
  await drawAcross(40, 39, 41);
  await frames(10);
  expect(alive(39, 40)).toBe(true);
  stop!();

  begin();
  await drawAcross(40, 39, 41);
  release();
  await frames(10);
  expect(alive(39, 40)).toBe(false);
});

test("drawing seeds right up to the corners of the visible region", async () => {
  begin();
  await drawAcross(1, 2, SIZE - 1);
  expect([alive(3, 1), alive(SIZE - 1, 1)]).toEqual([true, true]);
});

test("a colony at the edge dies there instead of wrapping round", async () => {
  begin();
  pointerAt(canvas, "pointermove", 0.5, 40.5);
  await settle();
  pointerAt(canvas, "pointerdown", 0.5, 0.5, { buttons: 1 });
  pointerAt(canvas, "pointermove", 0.5, 42.5, { buttons: 1 });
  await settle();
  release();
  expect([40, 41, 42].map((y) => alive(0, y))).toEqual([true, true, true]);

  await frames(10);
  expect(alive(SIZE - 1, 41)).toBe(false);
  expect([alive(0, 41), alive(1, 41)]).toEqual([true, true]);

  await frames(20);
  expect(alive(SIZE - 1, 41)).toBe(false);
  expect(alive(0, 41)).toBe(false);
});

test("a tap seeds a small cluster", async () => {
  begin();
  pointerAt(canvas, "pointerdown", 40.5, 40.5, { buttons: 1 });
  release();
  await settle();
  expect([alive(40, 40), alive(41, 40), alive(40, 41)]).toEqual([
    true,
    true,
    true,
  ]);
});

test("a spore lands once the colony has died and the visitor has been idle", async () => {
  let value = NO_JITTER;
  begin(() => value());
  value = () => 0.1;
  await frames(Math.floor(2000 / 16));
  expect(population()).toBe(0);

  await frames(Math.ceil(1500 / 16));
  expect(population()).toBeGreaterThan(0);
});

test.each([
  ["top-left", 0.001, 0],
  ["bottom-right", 0.999, SIZE - 5],
])("a spore can land in the %s corner of the region", async (_, at, from) => {
  const picks = [at, at];
  begin(() => picks.shift() ?? 0.1);
  await frames(Math.ceil(2700 / 16));
  const corner = [0, 1, 2, 3, 4].flatMap((y) =>
    [0, 1, 2, 3, 4].map((x) => alive(from + x, from + y)),
  );
  expect(corner).toContain(true);
});

test("an untouched tab freezes and stops asking for frames", async () => {
  begin(mulberry32(1));
  await vi.advanceTimersByTimeAsync(40_000);
  expect(vi.getTimerCount()).toBe(0);

  const frozen = bitmap().pixels.slice();
  await vi.advanceTimersByTimeAsync(2000);
  expect(bitmap().pixels).toEqual(frozen);

  pointerAt(canvas, "pointermove", 5, 5);
  expect(vi.getTimerCount()).toBe(1);
});

test("nothing is drawn on an empty colony", async () => {
  begin();
  await frames(2);
  expect(bitmap().pixels.every((value, i) => i % 4 !== 3 || value === 0)).toBe(
    true,
  );
});

test("cells outside the visible region are ignored and cleared on resize", async () => {
  begin();
  viewport = new DOMRect(4 * 20, 4 * 20, 4 * (SIZE - 40), 4 * (SIZE - 40));
  window.dispatchEvent(new Event("resize"));
  await drawAcross(10, 2, 8);
  expect(population()).toBe(0);

  await drawAcross(40, 30, 36);
  expect(alive(33, 40)).toBe(true);

  viewport = new DOMRect(4 * 50, 4 * 20, 4 * (SIZE - 70), 4 * (SIZE - 40));
  window.dispatchEvent(new Event("resize"));
  await settle();
  expect(alive(33, 40)).toBe(false);
});

test("a held drag lays a stroke bolder than one cell", async () => {
  begin(mulberry32(3));
  await drawAcross(80, 50, 110);
  let lit = 0;
  for (let x = 55; x < 105; x += 1) {
    for (let y = 70; y < 90; y += 1) if (alive(x, y)) lit += 1;
  }
  expect(lit / 50).toBeGreaterThanOrEqual(1.4);
});

test("a hovering pointer shows a faint cursor cell, hidden while held", async () => {
  begin();
  pointerAt(canvas, "pointermove", 40.5, 40.5);
  await settle();
  expect(alphaAt(40, 40)).toBe(CURSOR);

  pointerAt(canvas, "pointermove", 50.5, 40.5);
  await settle();
  expect([alphaAt(40, 40), alphaAt(50, 40)]).toEqual([0, CURSOR]);

  pointerAt(canvas, "pointerdown", 0.5, 0.5, { buttons: 1 });
  await settle();
  expect(alphaAt(50, 40)).not.toBe(CURSOR);
});

test("a finger shows no cursor once it lifts", async () => {
  begin();
  const touch = { pointerType: "touch", buttons: 1 };
  pointerAt(canvas, "pointerdown", 40.5, 40.5, touch);
  pointerAt(canvas, "pointermove", 45.5, 40.5, touch);
  await settle();
  pointerAt(canvas, "pointerup", 45.5, 40.5, { pointerType: "touch" });
  await settle();

  expect(alphaAt(45, 40)).not.toBe(CURSOR);
});

test("a dead cell leaves a trail that fades out", async () => {
  begin();
  await drawAcross(40, 40, 40);
  release();
  canvas.dispatchEvent(new PointerEvent("pointerleave"));
  await frames(10);
  expect(alphaAt(40, 40)).toBeGreaterThan(0);
  expect(alphaAt(40, 40)).toBeLessThan(255);

  await frames(120);
  expect(alphaAt(40, 40)).toBe(0);
});

test("a colony started a minute into the clock is not frozen empty", async () => {
  await vi.advanceTimersByTimeAsync(60_000);
  begin(mulberry32(1));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(population()).toBeGreaterThan(0);
});

test("stop cancels its frame and ignores the pointer from then on", async () => {
  begin();
  pointerAt(canvas, "pointermove", 40.5, 40.5);
  stop!();

  expect(vi.getTimerCount()).toBe(0);
  pointerAt(canvas, "pointermove", 10, 10);
  pointerAt(canvas, "pointerdown", 10, 10);
  window.dispatchEvent(new Event("resize"));
  expect(vi.getTimerCount()).toBe(0);
});

// Recorded from the visible-area passes; it matched a full-grid run then, which
// the test cannot recheck.
const GOLDEN = -1673793001;

test("a scripted session renders as recorded", async () => {
  const size = 240;
  begin(mulberry32(7), size);
  let hash = 0;
  const run = async (count: number) => {
    for (let i = 0; i < count; i += 1) {
      await frame();
      const { pixels } = bitmap();
      for (let j = 3; j < pixels.length; j += 28) {
        hash = (Math.imul(hash, 31) + pixels[j] + j) | 0;
      }
    }
  };
  const at = (type: string, x: number, y: number) =>
    pointerAt(canvas, type, x, y, { buttons: 1 });
  await run(120);
  at("pointermove", 100.5, 120.5);
  at("pointerdown", 100.5, 120.5);
  await run(1);
  for (let i = 0; i < 40; i += 1) {
    at("pointermove", 100.5 + i * 1.5, 120.5 + Math.sin(i / 4) * 12);
    await run(2);
  }
  pointerAt(canvas, "pointerup", 160.5, 120.5);
  await run(900);
  viewport = new DOMRect(0, 4 * 40, size * 4, 4 * 160);
  window.dispatchEvent(new Event("resize"));
  await run(600);
  at("pointermove", 50.5, 60.5);
  await run(1500);
  await run(Math.ceil(30_000 / STEP));
  expect(hash).toBe(GOLDEN);
});
