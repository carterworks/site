import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
} from "../../test/toy-canvas";
import { mulberry32 } from "../backdrop-noise";
import { culture } from "./culture";

const SIZE = 160;
const STEP = 1000 / 60;
const NO_JITTER = () => 0.99;
const RIM = Math.round(0.4 * 255);
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
const rimCells = () => {
  const found = new Set<number>();
  const { pixels } = bitmap();
  for (let i = 0; i < pixels.length / 4; i += 1) {
    if (pixels[i * 4 + 3] === RIM) found.add(i);
  }
  return found;
};

/** Presses off the dish, so only the path that follows seeds cells. */
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

test("drawing seeds only cells inside the dish", async () => {
  begin();
  await drawAcross(1, 0, SIZE - 1);
  expect(population()).toBe(0);

  await drawAcross(40, 0, SIZE - 1);
  expect(alive(40, 40)).toBe(true);
  expect(alive(0, 40)).toBe(false);
  expect(alive(SIZE - 1, 40)).toBe(false);
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

test("the dish follows the visible rect when the window resizes", async () => {
  begin();
  await frames(2);
  expect(alphaAt(40, 5)).toBe(RIM * 0);
  const before = rimCells().size;
  expect(before).toBeGreaterThan(0);

  viewport = new DOMRect(0, 4 * 17.5, SIZE * 4, 4 * (SIZE - 35));
  window.dispatchEvent(new Event("resize"));
  await frames(2);

  expect(rimCells().size).toBeGreaterThan(0);
  expect(rimCells().has(5 * SIZE + 40)).toBe(false);
  expect(alphaAt(40, 5)).toBe(0);
  expect(alphaAt(40, 17)).toBe(0);
});

test("the rim is one solid ring of edge-connected cells", async () => {
  begin();
  await frames(2);
  const rim = rimCells();
  const [start] = rim;
  const seen = new Set([start]);
  const queue = [start];
  for (const i of queue) {
    for (const j of [i - 1, i + 1, i - SIZE, i + SIZE]) {
      if (rim.has(j) && !seen.has(j)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  expect(rim.size).toBeGreaterThan(0);
  expect(seen.size).toBe(rim.size);
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

test("a dish started a minute into the clock is not frozen empty", async () => {
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

const GOLDEN = 697224690;

test("a scripted session renders exactly as the full-grid passes would", async () => {
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
