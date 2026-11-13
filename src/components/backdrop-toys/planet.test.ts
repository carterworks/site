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

test("rises dimly from the lower right of the visible cells, and sleeps", async () => {
  await run(2);

  const middle = (TOP + BOTTOM) / 2;
  expect(lit(SIZE / 2, middle, SIZE, BOTTOM)).toBeGreaterThan(200);
  expect(lit(0, TOP, SIZE / 3, middle)).toBe(0);
  expect(lit(0, 0, SIZE, TOP)).toBe(0);
  expect(brightest()).toBeLessThanOrEqual(0.45 * 255);
  expect(still()).toBe(true);
});

test("holds still under a hovering pointer", async () => {
  await run(1);
  const before = bitmap().pixels.slice();

  for (let x = 40; x < 140; x += 2) {
    at("pointermove", x);
    await run(1);
  }

  expect(bitmap().pixels).toEqual(before);
  expect(still()).toBe(true);
});

test("turns with a drag, and back again when it returns", async () => {
  await run(1);
  const before = bitmap().pixels.slice();

  await drag(60, 90);
  const turned = bitmap().pixels.slice();
  await drag(90, 60);
  await run(30);

  expect(turned).not.toEqual(before);
  expect(bitmap().pixels).toEqual(before);
});

test("a fling keeps turning after release, slows, and sleeps", async () => {
  await run(1);
  await drag(60, 120);
  at("pointerup", 120);
  await run(1);
  const released = bitmap().pixels.slice();

  await run(10);
  expect(bitmap().pixels).not.toEqual(released);
  expect(still()).toBe(false);

  await vi.advanceTimersByTimeAsync(10_000);
  expect(still()).toBe(true);
});

test("a release after holding still does not fling", async () => {
  await run(1);
  await drag(60, 120);
  await run(20);
  at("pointerup", 120);
  await run(1);
  const released = bitmap().pixels.slice();

  await run(10);

  expect(bitmap().pixels).toEqual(released);
  expect(still()).toBe(true);
});

test("a touch turns it only by dragging", async () => {
  await run(1);
  const before = bitmap().pixels.slice();
  at("pointermove", 60, { pointerType: "touch" });
  at("pointermove", 90, { pointerType: "touch" });
  await run(2);
  expect(bitmap().pixels).toEqual(before);

  await drag(60, 90, { pointerType: "touch" });
  at("pointercancel", 90, { pointerType: "touch" });
  await vi.advanceTimersByTimeAsync(10_000);

  expect(bitmap().pixels).not.toEqual(before);
  expect(still()).toBe(true);
});

test("a tap leaves a fling turning, but a held press catches it", async () => {
  await run(1);
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
  at("pointerup", 80);
  await run(1);
  const caught = bitmap().pixels.slice();
  await run(10);

  expect(bitmap().pixels).toEqual(caught);
  expect(still()).toBe(true);
});
