import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  litPixels,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { mulberry32 } from "../../lib/backdrop-noise";
import { filings } from "./filings";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const size = 160;
const FRAME = 16;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

beforeEach(() => {
  useFakeFrames();
  const { plain } = installSoftCanvas();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: size, height: size });
  place(canvas, new DOMRect(0, 0, size, size));
  document.body.append(canvas);
  bitmap = () => plain[plain.length - 1];
  stop = filings.start(canvas);
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

/** The total brightness of the filings left and right of `x`. */
const brightness = (x: number) => {
  let left = 0;
  let right = 0;
  const { pixels } = bitmap();
  for (let i = 0; i < size * size; i += 1) {
    if (i % size < x) left += pixels[i * 4 + 3];
    else right += pixels[i * 4 + 3];
  }
  return { left, right };
};

test("scatters filings over a magnet at rest from the start", async () => {
  await run(30);

  expect(litPixels(bitmap())).toBeGreaterThanOrEqual(100);
  expect(vi.getTimerCount()).toBe(0);
});

test("the north pole side is brighter, and a tap swaps the poles", async () => {
  await run(30);
  const before = brightness(size / 2);
  expect(before.right).toBeGreaterThan(before.left);

  pointerAt(canvas, "pointerdown", size / 2, size / 2, { buttons: 1 });
  pointerAt(canvas, "pointerup", size / 2, size / 2);
  await run(120);
  const after = brightness(size / 2);

  expect(after.left).toBeGreaterThan(after.right);
});

test("the pattern follows a dragged magnet", async () => {
  await run(30);
  const centred = brightness(120);
  pointerAt(canvas, "pointerdown", 30, 80, { buttons: 1 });
  await run(120, (i) =>
    pointerAt(canvas, "pointermove", 30, 80 - i * 0.1, { buttons: 1 }),
  );
  const moved = brightness(120);

  expect(moved.right).toBeLessThan(centred.right);
});

test("filings turn over several frames instead of snapping", async () => {
  await run(30);
  pointerAt(canvas, "pointermove", 20, 30);
  await run(2);
  const early = bitmap().pixels.slice();
  await run(4);
  const later = bitmap().pixels.slice();
  await run(300);
  const settled = bitmap().pixels.slice();

  expect(later).not.toEqual(early);
  expect(settled).not.toEqual(later);
});

test("stops asking for frames once the filings have settled", async () => {
  await run(30);
  pointerAt(canvas, "pointermove", 20, 30);
  await run(600);
  const frames = vi.spyOn(window, "requestAnimationFrame");
  await run(60);

  expect(frames).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("touch has no hover: a move without a press leaves the pattern alone", async () => {
  await run(30);
  const before = bitmap().pixels.slice();
  pointerAt(canvas, "pointermove", 20, 30, { pointerType: "touch" });
  await run(60);

  expect(bitmap().pixels).toEqual(before);
});
