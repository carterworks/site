import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { pendulums } from "./pendulums";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const size = 160;
const FRAME = 16;
const BOB = 255;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

beforeEach(() => {
  useFakeFrames();
  const { plain } = installSoftCanvas();
  bitmap = () => plain[plain.length - 1];
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: size, height: size });
  place(canvas, new DOMRect(0, 0, size, size));
  document.body.append(canvas);
  stop = pendulums.start(canvas);
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const picture = () => Uint8ClampedArray.from(bitmap().pixels);
const alpha = (x: number, y: number) => bitmap().pixels[(y * size + x) * 4 + 3];

const lowestBob = () => {
  for (let y = size - 1; y >= 0; y -= 1)
    for (let x = 0; x < size; x += 1) if (alpha(x, y) === BOB) return { x, y };
  throw new Error("no bob drawn");
};

const settle = async () => {
  await run(30_000);
  return picture();
};

test("it swings from the start without any input", async () => {
  await run(FRAME);
  const first = picture();
  await run(200);

  expect(picture()).not.toEqual(first);
});

test("it comes to rest within 30 s and stops asking for frames", async () => {
  await settle();
  const frames = vi.spyOn(window, "requestAnimationFrame");
  await run(1000);

  expect(frames).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("at rest the pendulums hang straight and look the same however they got there", async () => {
  const rested = await settle();
  pointerAt(canvas, "pointerdown", 20, 100, { buttons: 1 });
  await run(100);
  pointerAt(canvas, "pointerup", 20, 100);

  expect(await settle()).toEqual(rested);
});

test("a tap pulls the bobs aside and releasing sets them swinging again", async () => {
  const rested = await settle();
  pointerAt(canvas, "pointerdown", 20, 120, { buttons: 1 });
  await run(100);
  const pulled = picture();
  expect(pulled).not.toEqual(rested);

  pointerAt(canvas, "pointerup", 20, 120);
  await run(200);
  expect(picture()).not.toEqual(pulled);
});

test("dragging a bob moves only that pendulum", async () => {
  const rested = await settle();
  const { x, y } = lowestBob();
  pointerAt(canvas, "pointerdown", x, y, { buttons: 1 });
  pointerAt(canvas, "pointermove", x + 15, y - 5, { buttons: 1 });
  await run(100);

  expect(alpha(x, y)).toBe(0);
  const now = bitmap().pixels;
  const farColumn = size - 10;
  for (let row = 0; row < size; row += 1) {
    const i = (row * size + farColumn) * 4 + 3;
    expect(now[i]).toBe(rested[i]);
  }
});

test("a released bob swings from where it was let go and settles", async () => {
  const rested = await settle();
  const { x, y } = lowestBob();
  pointerAt(canvas, "pointerdown", x, y, { buttons: 1 });
  pointerAt(canvas, "pointermove", x + 15, y - 5, { buttons: 1 });
  await run(100);
  const held = picture();
  pointerAt(canvas, "pointerup", x + 15, y - 5);
  await run(100);
  expect(picture()).not.toEqual(held);

  expect(await settle()).toEqual(rested);
});

test("stop ends the loop", async () => {
  stop();
  const frames = vi.spyOn(window, "requestAnimationFrame");
  pointerAt(canvas, "pointerdown", 20, 100, { buttons: 1 });
  await run(100);

  expect(frames).not.toHaveBeenCalled();
});
