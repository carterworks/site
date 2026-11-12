import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
} from "../../test/toy-canvas";
import { mulberry32 } from "../backdrop-noise";
import { pinbed } from "./pinbed";

const size = 160;
const FRAME = 16;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

function mount() {
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: size, height: size });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, 0, size, size));
  document.body.append(canvas);
  stop = pinbed.start(canvas);
}

beforeEach(() => {
  useFakeFrames();
  const { plain } = installSoftCanvas();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
  // The visible rows are 35 to 125, as on a 16:9 viewport over the square grid.
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 35, size, 90),
  );
  bitmap = () => plain[plain.length - 1];
  mount();
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const run = async (frames: number, each?: (frame: number) => void) => {
  for (let i = 0; i < frames; i += 1) {
    each?.(i);
    await vi.advanceTimersByTimeAsync(FRAME);
  }
};

const level = (x: number, y: number) =>
  bitmap().pixels[(y * size + x) * 4 + 3] / 255;

const field = () => {
  const levels = new Float32Array(size * size);
  for (let i = 0; i < levels.length; i += 1) {
    levels[i] = bitmap().pixels[i * 4 + 3] / 255;
  }
  return levels;
};

const dents = () => field().filter((v) => v > 0).length;
const deepest = () => field().reduce((a, b) => Math.max(a, b));
const still = () => vi.getTimerCount() === 0;

const press = (x: number, y: number) =>
  pointerAt(canvas, "pointerdown", x, y, { buttons: 1 });
const release = (x: number, y: number) => pointerAt(canvas, "pointerup", x, y);

test("a press dents the pins under it and leaves the far corners flat", async () => {
  await run(1);
  press(80, 80);
  await run(5);

  expect(level(80, 80)).toBeGreaterThan(0);
  expect(level(0, 0)).toBe(0);
});

test("a longer hold dents deeper", async () => {
  press(80, 80);
  await run(10);
  const brief = level(80, 80);
  await run(50);

  expect(level(80, 80)).toBeGreaterThan(brief);
});

test("hover alone presses lighter than a hold", async () => {
  await run(60, (i) => pointerAt(canvas, "pointermove", 40 + i, 80));
  const hovered = deepest();
  stop();
  canvas.remove();
  mount();

  press(80, 80);
  await run(60);

  expect(hovered).toBeGreaterThan(0);
  expect(hovered).toBeLessThan(deepest());
});

test("a pointer that rests springs back instead of pressing forever", async () => {
  await run(30, (i) => pointerAt(canvas, "pointermove", 40 + i * 2, 80));
  await run(200);

  expect(deepest()).toBe(0);
  expect(vi.getTimerCount()).toBe(1);
});

test("touch has no hover: a move without a press leaves the bed alone", async () => {
  await run(1);
  const printed = dents();
  pointerAt(canvas, "pointermove", 80, 80, { pointerType: "touch" });
  await run(5);

  expect(level(80, 80)).toBe(0);
  expect(dents()).toBe(printed);
});

test("pins spring back at different times until the toy is still", async () => {
  press(80, 80);
  await run(60);
  expect(still()).toBe(false);

  release(80, 80);
  await run(120);
  const lifted = dents();
  await run(60);
  const partway = dents();
  expect(partway).toBeLessThan(lifted);
  expect(partway).toBeGreaterThan(0);

  await run(60 * 40);
  expect(deepest()).toBe(0);
  expect(still()).toBe(true);
});

test("a pebble rolls only after input, then everything goes still", async () => {
  await run(60 * 40);
  expect(still()).toBe(true);

  pointerAt(canvas, "pointermove", 80, 80);
  await run(60);
  expect(deepest()).toBeGreaterThan(0);
  await run(60 * 3);
  expect(deepest()).toBe(0);
  expect(vi.getTimerCount()).toBe(1);

  let rolled = false;
  for (let second = 0; second < 25; second += 1) {
    await run(60);
    if (deepest() > 0) rolled = true;
  }
  expect(rolled).toBe(true);
  expect(deepest()).toBe(0);
  expect(still()).toBe(true);
});

test("an untouched bed shows a faint handprint in the lower-left margin and stays still", async () => {
  await run(1);

  expect(dents()).toBeGreaterThan(100);
  expect(level(8, 117)).toBeGreaterThan(0);
  expect(level(140, 60)).toBe(0);
  expect(deepest()).toBeLessThan(0.7);
  expect(still()).toBe(true);
});

test("the handprint stays put for a minute without input", async () => {
  await run(1);
  const before = field();

  await run(60 * 60);

  expect(field()).toEqual(before);
  expect(still()).toBe(true);
});

test("the first input lets the handprint spring back", async () => {
  await run(1);
  pointerAt(canvas, "pointermove", 140, 60);
  await run(200);

  expect(level(8, 117)).toBe(0);
});

test("an untouched handprint follows the visible rect when it changes", async () => {
  await run(1);

  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 35, size, 60),
  );
  window.dispatchEvent(new Event("resize"));
  await run(1);

  expect(level(8, 117)).toBe(0);
  expect(level(8, 85)).toBeGreaterThan(0);
});

const GOLDEN: [number, boolean][] = [
  [4137705614, true],
  [585404283, false],
  [2247302774, false],
  [2247302774, false],
  [223029123, false],
  [3926657721, false],
  [2315578821, false],
  [3034458821, false],
  [1625206154, false],
  [2315578821, true],
  [2315578821, true],
  [2315578821, true],
  [2315578821, true],
  [2315578821, true],
];

const fingerprint = (levels: Float32Array) => {
  const bits = new Uint32Array(levels.buffer, levels.byteOffset, levels.length);
  let hash = 2166136261;
  for (const word of bits) hash = Math.imul(hash ^ word, 16777619) >>> 0;
  return hash;
};

// Recorded while it matched a scan of every pin each step, which it cannot check itself: it only detects change.
test("a scripted session relaxes as recorded", async () => {
  const seen: [number, boolean][] = [];
  const sample = () => seen.push([fingerprint(field()), still()]);

  await run(1);
  sample();
  await run(40, (i) =>
    pointerAt(canvas, "pointermove", 30 + i * 2, 70 + Math.sin(i / 5) * 10),
  );
  sample();
  press(100, 90);
  await run(90, (i) => pointerAt(canvas, "pointermove", 100 + i * 0.3, 90));
  sample();
  release(100, 90);
  await run(1);
  sample();
  await run(100);
  sample();
  await run(300);
  sample();
  canvas.dispatchEvent(new PointerEvent("pointerleave"));
  pointerAt(canvas, "pointerup", 100, 90);
  for (let second = 0; second < 40; second += 1) {
    await run(60);
    if (second % 5 === 4) sample();
  }

  expect(seen).toEqual(GOLDEN);
});

const inkAfter = async (frameMs: number, act: () => void, ms: number) => {
  stop();
  document.body.replaceChildren();
  useFakeFrames(frameMs);
  vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
  mount();
  await vi.advanceTimersByTimeAsync(frameMs);
  act();
  await vi.advanceTimersByTimeAsync(ms);
  const levels = field();
  const ink = levels.reduce((sum, v) => sum + v, 0);
  const centre = levels.reduce((sum, v, i) => sum + v * (i % size), 0) / ink;
  return [ink, centre];
};

test.each([
  ["a pin springing back", () => press(80, 80), 1300],
  ["a pebble rolling", () => pointerAt(canvas, "pointermove", 80, 80), 7500],
])("%s covers the same ground at 60 and 120 Hz", async (_, act, ms) => {
  const [ink60, centre60] = await inkAfter(1000 / 60, act, ms);
  const [ink120, centre120] = await inkAfter(1000 / 120, act, ms);

  expect(ink120).toBeCloseTo(ink60, 0);
  expect(centre120).toBeCloseTo(centre60, 0);
});
