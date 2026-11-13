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
import { tray } from "./tray";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const SIZE = 160;
const FRAME = 16;
const TOP = 35;
const BOTTOM = 125;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

function mount() {
  const { plain } = installSoftCanvas();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, 0, SIZE, SIZE));
  document.body.append(canvas);
  stop = tray.start(canvas);
  bitmap = () => plain[0];
}

beforeEach(() => {
  useFakeFrames();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
  // The visible rows are 35 to 125, as on a 16:9 viewport over the square grid.
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, TOP, SIZE, BOTTOM - TOP),
  );
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

const still = () => vi.getTimerCount() === 0;
const press = (x: number, y: number) =>
  pointerAt(canvas, "pointerdown", x, y, { buttons: 1 });
const release = (x: number, y: number) => pointerAt(canvas, "pointerup", x, y);
const hover = (x: number, y: number) => pointerAt(canvas, "pointermove", x, y);

/** The mean column of everything drawn, weighted by opacity. */
function centreX() {
  const { pixels } = bitmap();
  let ink = 0;
  let sum = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    ink += pixels[i];
    sum += pixels[i] * (((i - 3) / 4) % SIZE);
  }
  return sum / ink;
}

function litOutsideRows(top: number, bottom: number) {
  const { pixels } = bitmap();
  let count = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    const row = Math.floor((i - 3) / 4 / SIZE);
    if (pixels[i] > 0 && (row < top || row >= bottom)) count += 1;
  }
  return count;
}

test("a level tray shows its bearings and stays still", async () => {
  await run(2);

  expect(litPixels(bitmap())).toBeGreaterThan(1000);
  expect(litOutsideRows(TOP, BOTTOM)).toBe(0);
  expect(still()).toBe(true);
});

test("each bearing is shaded, with a highlight brighter than its body", async () => {
  await run(2);
  const { pixels } = bitmap();
  const greys: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 255) greys.push(pixels[i]);
  }
  greys.sort((a, b) => a - b);

  expect(greys.at(-1)).toBeGreaterThan(greys[greys.length >> 1] + 60);
});

test("pressing near the right edge rolls the bearings right", async () => {
  await run(1);
  const before = centreX();
  press(150, 80);
  await run(90);

  expect(centreX()).toBeGreaterThan(before + 20);
});

test("hovering tilts the tray more gently than pressing", async () => {
  await run(1);
  const before = centreX();
  await run(45, () => hover(150, 80));
  const hovered = centreX() - before;
  stop();
  canvas.remove();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
  mount();
  await run(1);
  press(150, 80);
  await run(45);
  const pressed = centreX() - before;

  expect(hovered).toBeGreaterThan(0);
  expect(hovered).toBeLessThan(pressed / 2);
});

test("a touch that only moves leaves the tray level", async () => {
  await run(1);
  const before = bitmap().pixels.slice();
  pointerAt(canvas, "pointermove", 150, 80, { pointerType: "touch" });
  await run(30);

  expect(bitmap().pixels).toEqual(before);
});

test("bearings piled hard into a corner neither overlap nor leave the tray", async () => {
  await run(1);
  const spread = litPixels(bitmap());
  let lowest = spread;
  press(159, 159);
  await run(240, (i) => {
    if (i % 20 === 0) press(i % 40 === 0 ? 0 : 159, i % 40 === 0 ? 0 : 159);
    lowest = Math.min(lowest, litPixels(bitmap()));
  });

  expect(lowest).toBeGreaterThan(spread * 0.9);
  expect(litOutsideRows(TOP, BOTTOM)).toBe(0);
});

test("released, the tray levels and the bearings roll to rest where they are", async () => {
  press(159, 80);
  await run(120);
  release(159, 80);
  canvas.dispatchEvent(new PointerEvent("pointerleave"));
  await run(60 * 20);

  expect(still()).toBe(true);
  expect(centreX()).toBeGreaterThan(100);
});

test("a resting mouse lets the tray level, so the toy goes still", async () => {
  await run(30, (i) => hover(100 + i, 80));
  await run(60 * 20);

  expect(still()).toBe(true);
});

test("a move after resting wakes the tray", async () => {
  await run(2);
  expect(still()).toBe(true);
  press(0, 80);
  await run(1);

  expect(still()).toBe(false);
});
