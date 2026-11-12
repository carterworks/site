import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  levelAt,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
} from "../../test/toy-canvas";
import { shimmer } from "./shimmer";

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

beforeEach(() => {
  useFakeFrames();
  const { plain } = installSoftCanvas();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: 160, height: 160 });
  place(canvas, new DOMRect(0, 0, 640, 640));
  document.body.append(canvas);
  stop = shimmer.start(canvas);
  bitmap = () => plain[0];
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const frame = () => vi.advanceTimersByTimeAsync(17);

/** The lit pixels, as "x,y" keys. */
function lit() {
  const { width, height } = bitmap();
  const keys: string[] = [];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (levelAt(bitmap(), x, y) > 0) keys.push(`${x},${y}`);
  return keys;
}

/** Every pixel of the two-pixel-thick segment from column `from` to `to`, on rows 2 and 3. */
const segment = (from: number, to: number) =>
  [2, 3].flatMap((y) =>
    Array.from({ length: to - from + 2 }, (_, i) => `${from + i},${y}`),
  );

test("a hover move draws a segment from the pixel it left to the one it entered, for one frame", async () => {
  await frame();
  pointerAt(canvas, "pointermove", 2.5, 2.5);
  await frame();
  pointerAt(canvas, "pointermove", 5.5, 2.5);
  await frame();

  expect(lit().sort()).toEqual(segment(2, 5).sort());

  await frame();
  expect(lit()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

test("a pointer that left starts afresh where it comes back", async () => {
  pointerAt(canvas, "pointermove", 2.5, 2.5);
  await frame();
  canvas.dispatchEvent(new PointerEvent("pointerleave"));
  pointerAt(canvas, "pointermove", 40.5, 2.5);
  await frame();

  expect(lit().sort()).toEqual(segment(40, 40).sort());
});

test("a held finger smears where it drags, and a new press never joins on to the last", async () => {
  const touch = { pointerType: "touch" };
  pointerAt(canvas, "pointerdown", 2.5, 2.5, touch);
  pointerAt(canvas, "pointermove", 10.5, 2.5, touch);
  pointerAt(canvas, "pointermove", 12.5, 2.5, touch);
  await vi.advanceTimersByTimeAsync(2000);
  pointerAt(canvas, "pointerup", 12.5, 2.5, touch);
  pointerAt(canvas, "pointerdown", 40.5, 2.5, touch);
  await vi.advanceTimersByTimeAsync(2000);

  pointerAt(canvas, "pointermove", 42.5, 2.5, touch);
  await frame();

  expect(lit().sort()).toEqual(segment(42, 42).sort());
});

test("a press grows a ring that fades over --backdrop-ripple-speed, then stops drawing", async () => {
  canvas.style.setProperty("--backdrop-ripple-size", "6");
  canvas.style.setProperty("--backdrop-ripple-speed", ".1s");
  pointerAt(canvas, "pointerdown", 40.5, 40.5);
  await vi.advanceTimersByTimeAsync(50);

  const distances = lit().map((key) => {
    const [x, y] = key.split(",").map(Number);
    return Math.hypot(x + 0.5 - 40.5, y + 0.5 - 40.5);
  });
  expect(distances.length).toBeGreaterThan(0);
  expect(levelAt(bitmap(), 40, 40)).toBe(0);
  expect(Math.max(...distances)).toBeLessThan(12);

  await vi.advanceTimersByTimeAsync(100);
  expect(lit()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

test("without --backdrop-ripple-* a ring lasts its default 900 ms", async () => {
  pointerAt(canvas, "pointerdown", 40.5, 40.5);

  await vi.advanceTimersByTimeAsync(800);
  expect(lit().length).toBeGreaterThan(0);

  await vi.advanceTimersByTimeAsync(200);
  expect(vi.getTimerCount()).toBe(0);
});

test("stop cancels its frame and ignores the pointer from then on", async () => {
  pointerAt(canvas, "pointerdown", 40.5, 40.5);
  stop();

  expect(vi.getTimerCount()).toBe(0);
  pointerAt(canvas, "pointermove", 10, 10);
  pointerAt(canvas, "pointerdown", 10, 10);
  expect(vi.getTimerCount()).toBe(0);
});
