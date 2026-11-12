import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  litPixels,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
} from "../../test/toy-canvas";
import { dominoes } from "./dominoes";

const size = 160;
const FRAME = 16;
const STANDING = 255;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

const viewAs = (rect: DOMRect) =>
  vi
    .spyOn(HTMLDivElement.prototype, "getBoundingClientRect")
    .mockReturnValue(rect);

beforeEach(() => {
  useFakeFrames();
  const { plain } = installSoftCanvas();
  viewAs(new DOMRect(0, 0, size, size));
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: size, height: size });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, 0, size, size));
  document.body.append(canvas);
  stop = dominoes.start(canvas);
  bitmap = () => plain[0];
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const level = (x: number, y: number) => bitmap().pixels[(y * size + x) * 4 + 3];
const still = () => vi.getTimerCount() === 0;
const fallen = (x: number, y: number) =>
  level(x, y) > 0 && level(x, y) < STANDING;

const litRows = () => {
  let top = size;
  let bottom = -1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (level(x, y) === 0) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { top, bottom };
};

async function drag(fromX: number, fromY: number, toX: number, toY: number) {
  pointerAt(canvas, "pointerdown", fromX, fromY, { buttons: 1 });
  const steps = Math.ceil(Math.hypot(toX - fromX, toY - fromY));
  for (let i = 1; i <= steps; i += 1) {
    const share = i / steps;
    pointerAt(
      canvas,
      "pointermove",
      fromX + (toX - fromX) * share,
      fromY + (toY - fromY) * share,
      { buttons: 1 },
    );
  }
  pointerAt(canvas, "pointerup", toX, toY);
  await run(FRAME);
}

async function tap(x: number, y: number) {
  pointerAt(canvas, "pointerdown", x, y, { buttons: 1 });
  pointerAt(canvas, "pointerup", x, y);
  await run(FRAME);
}

test("starts on an S-curve of standing dominoes and stays still", async () => {
  await run(FRAME);

  expect(litPixels(bitmap())).toBeGreaterThan(100);
  expect(
    bitmap().pixels.filter((v, i) => i % 4 === 3 && v > 0 && v < STANDING)
      .length,
  ).toBe(0);
  expect(still()).toBe(true);
});

test("the curve fits the visible part, and follows it until first touched", async () => {
  viewAs(new DOMRect(0, 35, size, 90));
  window.dispatchEvent(new Event("resize"));
  await run(FRAME);
  const fitted = litRows();

  expect(fitted.top).toBeGreaterThanOrEqual(35);
  expect(fitted.bottom).toBeLessThan(125);

  await tap(80, 5);
  viewAs(new DOMRect(0, 35, size, 60));
  window.dispatchEvent(new Event("resize"));
  await run(FRAME);

  expect(litRows()).toEqual(fitted);
});

test("hovering lays nothing", async () => {
  for (let x = 20; x <= 140; x += 2) pointerAt(canvas, "pointermove", x, 20);
  await run(FRAME);

  expect(level(40, 20)).toBe(0);
});

test("a drag lays standing dominoes along its path, then the toy goes still", async () => {
  await drag(20, 20, 140, 20);

  expect(level(20, 20)).toBe(STANDING);
  expect(level(135, 20)).toBe(STANDING);
  expect(still()).toBe(true);
});

test.each([
  ["left", 38, 45, 35],
  ["right", 42, 35, 45],
])(
  "a tap on a domino's %s side pushes it over away from the tap",
  async (_, tapX, ahead, behind) => {
    await drag(40, 20, 44, 20);
    await tap(tapX, 20);
    await run(1000);

    expect(fallen(ahead, 20)).toBe(true);
    expect(level(behind, 20)).toBe(0);
    expect(still()).toBe(true);
  },
);

test("each falling domino topples the next along the line", async () => {
  await drag(20, 140, 140, 140);
  await tap(18, 140);
  await run(800);

  expect(fallen(20, 140)).toBe(true);
  expect(level(135, 140)).toBe(STANDING);
  expect(still()).toBe(false);

  await run(4000);
  expect(fallen(135, 140)).toBe(true);
  expect(still()).toBe(true);
});

test("a line's fall carries into another line within its reach", async () => {
  await drag(20, 140, 80, 140);
  await drag(84, 140, 100, 156);
  expect(level(97, 153)).toBe(STANDING);

  await tap(18, 140);
  await run(4000);

  expect(fallen(97, 153)).toBe(true);
});

test("a double tap on empty space stands every domino back up", async () => {
  await drag(20, 140, 140, 140);
  await tap(18, 140);
  await run(5000);

  await tap(80, 5);
  await run(1000);
  expect(fallen(135, 140)).toBe(true);

  await tap(80, 5);
  await run(100);
  await tap(80, 5);
  await run(1000);
  expect(level(20, 140)).toBe(STANDING);
  expect(level(135, 140)).toBe(STANDING);
  expect(still()).toBe(true);
});
