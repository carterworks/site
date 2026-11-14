import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { planet } from "./planet";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const SIZE = 160;
const FRAME = 16;
/** The visible rows, as on a 16:9 viewport over the square grid. */
const TOP = 35;
const BOTTOM = 125;
/** Past the drift and its ease-out, inside the contract's 30 s. */
const SETTLED_MS = 25_000;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

beforeEach(() => {
  useFakeFrames();
  const { plain } = installSoftCanvas();
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, TOP, SIZE, BOTTOM - TOP),
  );
  bitmap = () => plain[plain.length - 1];
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, 0, SIZE, SIZE));
  document.body.append(canvas);
  stop = planet.start(canvas);
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const run = (frames: number) => vi.advanceTimersByTimeAsync(frames * FRAME);
const settle = () => vi.advanceTimersByTimeAsync(SETTLED_MS);

const alpha = (x: number, y: number) => bitmap().pixels[(y * SIZE + x) * 4 + 3];

function lit(left: number, top: number, right: number, bottom: number) {
  let count = 0;
  for (let y = top; y < bottom; y += 1)
    for (let x = left; x < right; x += 1) if (alpha(x, y) > 0) count += 1;
  return count;
}

function brightest() {
  let peak = 0;
  for (let i = 3; i < bitmap().pixels.length; i += 4)
    peak = Math.max(peak, bitmap().pixels[i]);
  return peak;
}

/** How many pixels change over `frames` frames. */
async function motion(frames: number) {
  const before = bitmap().pixels.slice();
  await run(frames);
  return bitmap().pixels.filter((value, i) => value !== before[i]).length;
}

const still = () => vi.getTimerCount() === 0;
const at = (type: string, x: number, init: PointerEventInit = {}) =>
  pointerAt(canvas, type, x, 100, init);

/** Presses at `from` and moves a pixel a frame to `to`, still held. */
async function drag(from: number, to: number, init: PointerEventInit = {}) {
  at("pointerdown", from, { buttons: 1, ...init });
  for (let x = from; x !== to; x += Math.sign(to - from)) {
    at("pointermove", x, { buttons: 1, ...init });
    await run(1);
  }
  at("pointermove", to, { buttons: 1, ...init });
  await run(1);
}

test("rises dimly from the lower right of the visible cells", async () => {
  await run(2);

  const middle = (TOP + BOTTOM) / 2;
  expect(lit(SIZE / 2, middle, SIZE, BOTTOM)).toBeGreaterThan(200);
  expect(lit(0, TOP, SIZE / 3, middle)).toBe(0);
  expect(lit(0, 0, SIZE, TOP)).toBe(0);
  expect(brightest()).toBeLessThanOrEqual(0.45 * 255);
});

test("in portrait, shows most of the globe above the bottom edge", async () => {
  stop();
  const [left, top, right, bottom] = [55, 20, 105, 140];
  vi.mocked(HTMLDivElement.prototype.getBoundingClientRect).mockReturnValue(
    new DOMRect(left, top, right - left, bottom - top),
  );
  stop = planet.start(canvas);
  await run(2);

  const columns: number[] = [];
  const rows: number[] = [];
  for (let y = 0; y < SIZE; y += 1)
    for (let x = 0; x < SIZE; x += 1)
      if (alpha(x, y) > 0) (columns.push(x), rows.push(y));
  const diameter = Math.max(...columns) - Math.min(...columns);
  const shown = (bottom - Math.min(...rows)) / diameter;

  expect(shown).toBeGreaterThan(0.65);
  expect(shown).toBeLessThan(0.75);
  expect(Math.min(...columns)).toBeGreaterThanOrEqual(left);
});

test("drifts on its own from the start, then settles and sleeps", async () => {
  await run(1);
  expect(await motion(120)).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(still()).toBe(false);

  await settle();
  expect(await motion(120)).toBe(0);
  expect(still()).toBe(true);
});

test("a hovering pointer does not restart the drift", async () => {
  await settle();

  for (let x = 40; x < 140; x += 2) at("pointermove", x);
  await run(1);

  expect(still()).toBe(true);
});

test("turns with a drag, and back again when it returns", async () => {
  await settle();
  const before = bitmap().pixels.slice();

  await drag(60, 90);
  const turned = bitmap().pixels.slice();
  await drag(90, 60);
  await run(30);

  expect(turned).not.toEqual(before);
  expect(bitmap().pixels).toEqual(before);
});

test("a fling slows to the drift, not to a stop, then settles", async () => {
  await settle();
  await drag(60, 120);
  at("pointerup", 120);
  const flung = await motion(10);

  await vi.advanceTimersByTimeAsync(5000);
  const drifting = await motion(10);
  expect(drifting).toBeGreaterThan(0);
  expect(drifting).toBeLessThan(flung);

  await settle();
  expect(still()).toBe(true);
});

test("a held press catches it, and the release restarts the drift", async () => {
  await settle();
  await drag(60, 120);
  at("pointerup", 120);
  await run(5);

  at("pointerdown", 80, { buttons: 1 });
  await run(2);
  at("pointerup", 80);
  await run(1);
  expect(still()).toBe(false);

  at("pointerdown", 80, { buttons: 1 });
  await run(10);
  expect(await motion(10)).toBe(0);

  at("pointerup", 80);
  expect(await motion(120)).toBeGreaterThan(0);
  await settle();
  expect(still()).toBe(true);
});

test("a touch turns it only by dragging", async () => {
  await settle();
  const before = bitmap().pixels.slice();
  at("pointermove", 60, { pointerType: "touch" });
  at("pointermove", 90, { pointerType: "touch" });
  await run(2);
  expect(bitmap().pixels).toEqual(before);

  await drag(60, 90, { pointerType: "touch" });
  at("pointercancel", 90, { pointerType: "touch" });
  await settle();

  expect(bitmap().pixels).not.toEqual(before);
  expect(still()).toBe(true);
});
