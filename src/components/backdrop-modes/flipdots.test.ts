import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
} from "../../test/toy-canvas";
import { flipdots } from "./flipdots";

const SIZE = 160;
// At 160 px wide a disc is 5 px inside a 6 px cell, and the board is inset 2 px.
const PITCH = 6;
const INSET = 2;
const FLIP_MS = 300;
const DARK = 60;
const LIGHT = 255;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

beforeEach(() => {
  useFakeFrames();
  const { plain } = installSoftCanvas();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  place(canvas, new DOMRect(0, 0, SIZE, SIZE));
  document.body.append(canvas);
  stop = flipdots.start(canvas);
  bitmap = () => plain[0];
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const centre = (column: number, row: number) => ({
  x: INSET + column * PITCH + 2.5,
  y: INSET + row * PITCH + 2.5,
});

const alphaAt = (x: number, y: number) =>
  bitmap().pixels[(Math.floor(y) * SIZE + Math.floor(x)) * 4 + 3];

const disc = (column: number, row: number) => {
  const { x, y } = centre(column, row);
  return alphaAt(x, y);
};

const touch = (type: string, column: number, row: number) => {
  const { x, y } = centre(column, row);
  pointerAt(canvas, type, x, y, { pointerType: "touch" });
};

const hover = (column: number, row: number) => {
  const { x, y } = centre(column, row);
  pointerAt(canvas, "pointermove", x, y);
};

const settle = (ms = FLIP_MS) => vi.advanceTimersByTimeAsync(ms);

test("starts as a board of dim discs with gaps between them", async () => {
  await settle(20);
  expect(disc(3, 3)).toBe(DARK);
  expect(disc(20, 10)).toBe(DARK);
  expect(alphaAt(INSET + 3 * PITCH + 5, INSET + 3 * PITCH + 2)).toBe(0);
});

test("hovering a disc flips it to its light face, squashing through a line", async () => {
  hover(5, 5);
  const { x, y } = centre(5, 5);
  const top = INSET + 5 * PITCH;
  await settle(20);
  expect(alphaAt(x, top)).toBe(0);
  expect(alphaAt(x, y)).toBe(DARK);

  await settle(FLIP_MS);
  expect(disc(5, 5)).toBe(LIGHT);
  expect(alphaAt(x, top)).toBe(LIGHT);
  expect(disc(6, 5)).toBe(DARK);
});

test("a stroke flips a disc once however long it stays, and again after leaving and returning", async () => {
  hover(5, 5);
  await settle();
  hover(5, 5);
  hover(5, 5);
  await settle();
  expect(disc(5, 5)).toBe(LIGHT);

  hover(6, 5);
  hover(5, 5);
  await settle();
  expect(disc(5, 5)).toBe(DARK);
});

test("a fast stroke flips every disc it crosses", async () => {
  hover(2, 4);
  hover(9, 4);
  await settle();

  for (let column = 2; column <= 9; column += 1) {
    expect(disc(column, 4)).toBe(LIGHT);
  }
});

test("a tap flips a plus of five discs", async () => {
  touch("pointerdown", 8, 8);
  await settle();

  for (const [column, row] of [
    [8, 8],
    [7, 8],
    [9, 8],
    [8, 7],
    [8, 9],
  ]) {
    expect(disc(column, row)).toBe(LIGHT);
  }
  expect(disc(7, 7)).toBe(DARK);
});

test("a double tap wipes the board back to dark, column by column", async () => {
  hover(2, 4);
  hover(20, 4);
  await settle();
  touch("pointerdown", 10, 10);
  await settle(100);
  touch("pointerdown", 10, 10);
  await settle(100);

  expect(disc(20, 4)).toBe(LIGHT);

  await settle(2000);
  expect(disc(2, 4)).toBe(DARK);
  expect(disc(20, 4)).toBe(DARK);
  expect(disc(10, 10)).toBe(DARK);
});

test("a few seconds after the last input one diagonal band flips, then it goes still", async () => {
  hover(0, 0);
  await settle();
  expect(vi.getTimerCount()).toBe(1);

  await settle(2000);
  const lit = () => {
    let count = 0;
    for (let row = 0; row < 26; row += 1)
      for (let column = 0; column < 26; column += 1)
        if (disc(column, row) === LIGHT) count += 1;
    return count;
  };
  expect(lit()).toBe(1);

  await settle(10_000);
  expect(lit()).toBeGreaterThan(20);
  expect(vi.getTimerCount()).toBe(0);
});

test("asks for no frames while no disc is mid-flip", async () => {
  hover(5, 5);
  await settle();
  const frames = vi.spyOn(window, "requestAnimationFrame");

  await settle(2000);

  expect(frames).not.toHaveBeenCalled();
});

test("stop cancels frames and the idle wave and ignores the pointer", async () => {
  hover(5, 5);
  stop();

  expect(vi.getTimerCount()).toBe(0);
  hover(7, 7);
  touch("pointerdown", 9, 9);
  expect(vi.getTimerCount()).toBe(0);
});
