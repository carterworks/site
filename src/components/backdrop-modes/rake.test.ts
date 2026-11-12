import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import {
  installSoftCanvas,
  levelAt,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
} from "../../test/toy-canvas";
import { rake } from "./rake";

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;
let gravel: Uint8ClampedArray;

beforeEach(async () => {
  useFakeFrames();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(5));
  const { plain } = installSoftCanvas();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: 160, height: 160 });
  place(canvas, new DOMRect(0, 0, 160, 160));
  document.body.append(canvas);
  stop = rake.start(canvas);
  bitmap = () => plain[0];
  await frame();
  gravel = bitmap().pixels.slice();
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const frame = () => vi.advanceTimersByTimeAsync(17);

const changed = () =>
  bitmap().pixels.reduce((n, value, i) => n + (value === gravel[i] ? 0 : 1), 0);

const was = (x: number, y: number) => gravel[(y * 160 + x) * 4];

async function drag(fromX: number, fromY: number, toX: number, toY: number) {
  pointerAt(canvas, "pointerdown", fromX, fromY);
  const steps = 20;
  for (let i = 1; i <= steps; i += 1) {
    pointerAt(
      canvas,
      "pointermove",
      fromX + ((toX - fromX) * i) / steps,
      fromY + ((toY - fromY) * i) / steps,
    );
    await vi.advanceTimersByTimeAsync(16);
  }
  pointerAt(canvas, "pointerup", toX, toY);
  await vi.advanceTimersByTimeAsync(400);
}

async function tap(x: number, y: number) {
  pointerAt(canvas, "pointerdown", x, y);
  await vi.advanceTimersByTimeAsync(60);
  pointerAt(canvas, "pointerup", x, y);
  await frame();
}

const settle = () => vi.advanceTimersByTimeAsync(900);

test("starts as opaque, faintly speckled gravel", () => {
  const levels = new Set<number>();
  for (let i = 0; i < gravel.length; i += 4) {
    expect(gravel[i + 3]).toBe(255);
    levels.add(gravel[i]);
  }
  expect(levels.size).toBeGreaterThan(3);
  expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(90);
});

test("hovering shows the tine tips for as long as the pointer is there, and rakes nothing", async () => {
  for (let x = 10; x < 150; x += 5) {
    pointerAt(canvas, "pointermove", x, 80);
    await frame();
  }
  expect(changed()).toBeGreaterThan(0);
  expect(changed()).toBeLessThan(80);

  canvas.dispatchEvent(new PointerEvent("pointerleave"));
  await frame();
  expect(changed()).toBe(0);
});

test("dragging rakes four parallel grooves darker than the gravel", async () => {
  await drag(20, 80, 140, 80);

  const grooved = [71, 77, 83, 89].map((row) => {
    let drop = 0;
    for (let x = 40; x < 120; x += 1)
      drop += was(x, row) - levelAt(bitmap(), x, row);
    return drop / 80;
  });
  for (const drop of grooved) expect(drop).toBeGreaterThan(15);
  expect(levelAt(bitmap(), 80, 30)).toBe(was(80, 30));
});

test("a drag turns its tines with the direction it takes", async () => {
  await drag(80, 20, 80, 140);

  let drop = 0;
  for (let y = 40; y < 120; y += 1)
    drop += was(77, y) - levelAt(bitmap(), 77, y);
  expect(drop / 80).toBeGreaterThan(15);
  expect(levelAt(bitmap(), 40, 80)).toBe(was(40, 80));
});

test("a tap sets a solid stone ringed by grooves", async () => {
  await tap(80, 80);
  await settle();

  expect(levelAt(bitmap(), 80, 80)).not.toBe(was(80, 80));
  expect(bitmap().pixels[(80 * 160 + 80) * 4 + 3]).toBe(255);
  let ringed = 0;
  for (let x = 80 + 7; x < 80 + 30; x += 1)
    if (levelAt(bitmap(), x, 80) < was(x, 80) - 15) ringed += 1;
  expect(ringed).toBeGreaterThanOrEqual(3);
  expect(levelAt(bitmap(), 80, 80 + 60)).toBe(was(80, 80 + 60));
});

test("grooves raked later go around a stone", async () => {
  await tap(80, 80);
  await settle();
  const stone = [-6, -3, 0, 3, 6].map((dx) => levelAt(bitmap(), 80 + dx, 80));

  await drag(20, 80, 140, 80);

  expect([-6, -3, 0, 3, 6].map((dx) => levelAt(bitmap(), 80 + dx, 80))).toEqual(
    stone,
  );
});

test("a press that moves is a rake, not a stone", async () => {
  await drag(20, 20, 30, 20);
  expect(levelAt(bitmap(), 43, 20)).toBe(was(43, 20));
});

test("a double tap smooths the whole garden back to fresh gravel", async () => {
  await drag(20, 40, 140, 40);
  await tap(80, 100);
  expect(changed()).toBeGreaterThan(0);

  await tap(80, 100);

  expect(changed()).toBe(0);
});

test("two taps far apart in time or place each keep their stone", async () => {
  await tap(40, 100);
  await vi.advanceTimersByTimeAsync(1000);
  await tap(120, 100);
  await tap(40, 40);

  expect(levelAt(bitmap(), 40, 100)).not.toBe(was(40, 100));
  expect(levelAt(bitmap(), 120, 100)).not.toBe(was(120, 100));
  expect(levelAt(bitmap(), 40, 40)).not.toBe(was(40, 40));
});

test("stops asking for frames once the input stops", async () => {
  await drag(20, 80, 140, 80);
  await tap(80, 120);
  await settle();
  expect(vi.getTimerCount()).toBe(0);
});

test("stop cancels its frame and ignores the pointer from then on", async () => {
  pointerAt(canvas, "pointerdown", 20, 80);
  pointerAt(canvas, "pointermove", 60, 80);
  stop();

  expect(vi.getTimerCount()).toBe(0);
  pointerAt(canvas, "pointermove", 90, 80);
  pointerAt(canvas, "pointerup", 90, 80);
  expect(vi.getTimerCount()).toBe(0);
});
