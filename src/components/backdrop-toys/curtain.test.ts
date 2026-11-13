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
import { curtain } from "./curtain";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const SIZE = 160;
/** What the viewport probe below shows of the canvas: 120 by 90 cells. */
const visible = { left: 20, top: 35, right: 140, bottom: 125 };
const middle = { x: 80, y: 80 };

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

beforeEach(() => {
  useFakeFrames();
  const { plain } = installSoftCanvas();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(160, 0, 960, 720),
  );
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, -280, 1280, 1280));
  document.body.append(canvas);
  stop = curtain.start(canvas);
  bitmap = () => plain[0];
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const frames = (count: number) => vi.advanceTimersByTimeAsync(count * 16);
const alphaAt = (x: number, y: number) =>
  bitmap().pixels[(Math.floor(y) * SIZE + Math.floor(x)) * 4 + 3];
const snapshot = () => bitmap().pixels.slice();

test("hangs still across most of the visible rect and asks for no more frames", async () => {
  await frames(2);

  const area = (visible.right - visible.left) * (visible.bottom - visible.top);
  expect(litPixels(bitmap())).toBeGreaterThan(area * 0.6);
  expect(vi.getTimerCount()).toBe(0);
});

test("draws nothing outside the visible rect", async () => {
  await frames(2);

  const { pixels } = bitmap();
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    if (pixels[i * 4 + 3] === 0) continue;
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    expect(x).toBeGreaterThanOrEqual(visible.left);
    expect(x).toBeLessThan(visible.right);
    expect(y).toBeGreaterThanOrEqual(visible.top);
    expect(y).toBeLessThan(visible.bottom);
  }
});

test("shades its folds in several tones of white", async () => {
  await frames(2);

  const { pixels } = bitmap();
  const tones = new Set<number>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    expect(pixels[i]).toBe(255);
    tones.add(pixels[i + 3]);
  }
  expect(tones.size).toBeGreaterThanOrEqual(3);
});

test("a hovering pointer brushes the cloth, which settles again within 10 s", async () => {
  await frames(2);
  const before = snapshot();
  for (let x = 40; x <= 120; x += 4) {
    pointerAt(canvas, "pointermove", x, middle.y);
    await frames(1);
  }

  expect(snapshot()).not.toEqual(before);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(vi.getTimerCount()).toBe(0);
});

test("a pointer moving where there is no cloth leaves it be", async () => {
  await frames(2);
  for (let x = 0; x <= SIZE; x += 4) {
    pointerAt(canvas, "pointermove", x, 2);
    await frames(1);
  }

  expect(vi.getTimerCount()).toBe(0);
});

test("a press grabs the nearest point and drags it, and letting go swings it back to rest", async () => {
  await frames(2);
  const target = { x: 130, y: 122 };
  expect(alphaAt(target.x, target.y)).toBe(0);

  pointerAt(canvas, "pointerdown", middle.x, middle.y, { buttons: 1 });
  for (let step = 1; step <= 20; step += 1) {
    pointerAt(
      canvas,
      "pointermove",
      middle.x + ((target.x - middle.x) * step) / 20,
      middle.y + ((target.y - middle.y) * step) / 20,
      { buttons: 1 },
    );
    await frames(1);
  }
  await frames(30);
  expect(alphaAt(target.x, target.y)).toBeGreaterThan(0);
  expect(vi.getTimerCount()).toBeGreaterThan(0);

  pointerAt(canvas, "pointerup", target.x, target.y);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(alphaAt(target.x, target.y)).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("stop cancels its frame and ignores the pointer from then on", async () => {
  pointerAt(canvas, "pointermove", middle.x, middle.y);
  pointerAt(canvas, "pointermove", middle.x + 10, middle.y);
  stop();

  expect(vi.getTimerCount()).toBe(0);
  pointerAt(canvas, "pointerdown", middle.x, middle.y);
  pointerAt(canvas, "pointermove", middle.x + 20, middle.y);
  expect(vi.getTimerCount()).toBe(0);
});
