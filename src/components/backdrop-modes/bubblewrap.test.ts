import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  litPixels,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
} from "../../test/toy-canvas";
import { bubblewrap } from "./bubblewrap";

const SIZE = 160;
/** At 160 px the sheet is 9 columns by 11 rows of 16 px bubbles, centred, odd rows shifted half a pitch. */
const COLUMNS = 9;
const ROWS = 11;
const PITCH = 16;
const FIRST = { x: 12, y: 10.72 };
const ROW_PITCH = (PITCH * Math.sqrt(3)) / 2;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

beforeEach(() => {
  useFakeFrames();
  const { plain } = installSoftCanvas();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  place(canvas, new DOMRect(0, 0, 640, 640));
  document.body.append(canvas);
  stop = bubblewrap.start(canvas);
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
  x: FIRST.x + column * PITCH + (row % 2) * (PITCH / 2),
  y: FIRST.y + row * ROW_PITCH,
});

/** Only an intact bubble's highlight dot is fully opaque. */
function intact(column: number, row: number) {
  const { x, y } = centre(column, row);
  const { pixels, width } = bitmap();
  for (let dy = -3; dy <= -1; dy += 1)
    for (let dx = -3; dx <= -1; dx += 1)
      if (
        pixels[(Math.floor(y + dy) * width + Math.floor(x + dx)) * 4 + 3] ===
        255
      )
        return true;
  return false;
}

const intactCount = () => {
  let count = 0;
  for (let row = 0; row < ROWS; row += 1)
    for (let column = 0; column < COLUMNS; column += 1)
      if (intact(column, row)) count += 1;
  return count;
};

const press = (x: number, y: number) =>
  pointerAt(canvas, "pointerdown", x, y, { buttons: 1 });
const release = () => pointerAt(canvas, "pointerup", 0, 0);

/** Drags a held pointer along each row of bubbles. */
function popEverything() {
  for (let row = 0; row < ROWS; row += 1) {
    const { y } = centre(0, row);
    press(1, y);
    pointerAt(canvas, "pointermove", SIZE - 1, y, { buttons: 1 });
    release();
  }
}

const doubleTap = async (x: number, y: number) => {
  press(x, y);
  release();
  await vi.advanceTimersByTimeAsync(100);
  press(x, y);
  release();
};

test("starts as a full sheet of intact bubbles, then stops drawing", async () => {
  await vi.advanceTimersByTimeAsync(100);

  expect(litPixels(bitmap())).toBeGreaterThan(100);
  expect(intactCount()).toBe(COLUMNS * ROWS);
  expect(vi.getTimerCount()).toBe(0);
});

test("pressing a bubble pops it into a flat ring, then goes still", async () => {
  await vi.advanceTimersByTimeAsync(100);
  const { x, y } = centre(4, 5);
  press(x, y);
  await vi.advanceTimersByTimeAsync(500);

  expect(intact(4, 5)).toBe(false);
  expect(intactCount()).toBe(COLUMNS * ROWS - 1);
  expect(vi.getTimerCount()).toBe(0);
});

test("a pop flashes bigger than the bubble before it collapses", async () => {
  await vi.advanceTimersByTimeAsync(100);
  const { x, y } = centre(4, 5);
  const before = litPixels(bitmap());
  press(x, y);
  await vi.advanceTimersByTimeAsync(17);

  expect(litPixels(bitmap())).toBeGreaterThan(before);
});

test("hovering pops nothing", async () => {
  await vi.advanceTimersByTimeAsync(100);
  for (let x = 0; x < SIZE; x += 4) {
    pointerAt(canvas, "pointermove", x, 80);
  }

  expect(vi.getTimerCount()).toBe(0);
  expect(intactCount()).toBe(COLUMNS * ROWS);
});

test("dragging while pressed pops every bubble crossed, even between sparse events", async () => {
  await vi.advanceTimersByTimeAsync(100);
  const { y } = centre(0, 2);
  press(1, y);
  pointerAt(canvas, "pointermove", SIZE - 1, y, { buttons: 1 });
  await vi.advanceTimersByTimeAsync(500);

  for (let column = 0; column < COLUMNS; column += 1)
    expect(intact(column, 2)).toBe(false);
  expect(intact(0, 1)).toBe(true);
  expect(intact(0, 3)).toBe(true);
});

test("a new press does not join on to where the last drag ended", async () => {
  await vi.advanceTimersByTimeAsync(100);
  const { y } = centre(0, 2);
  press(1, y);
  pointerAt(canvas, "pointermove", 20, y, { buttons: 1 });
  release();
  press(150, y);
  await vi.advanceTimersByTimeAsync(500);

  expect(intact(4, 2)).toBe(true);
});

test("a double tap on a fully popped sheet lays a new one that unrolls from the left", async () => {
  await vi.advanceTimersByTimeAsync(100);
  popEverything();
  await vi.advanceTimersByTimeAsync(500);
  expect(intactCount()).toBe(0);

  await doubleTap(80, 80);
  await vi.advanceTimersByTimeAsync(150);
  expect(intact(0, 0)).toBe(true);
  expect(intact(COLUMNS - 1, 0)).toBe(false);

  await vi.advanceTimersByTimeAsync(1000);
  expect(intactCount()).toBe(COLUMNS * ROWS);
  expect(vi.getTimerCount()).toBe(0);
});

test("a double tap on a mostly popped sheet also renews it", async () => {
  await vi.advanceTimersByTimeAsync(100);
  popEverything();
  const { x, y } = centre(4, 5);
  await vi.advanceTimersByTimeAsync(500);
  await doubleTap(x, y);
  await vi.advanceTimersByTimeAsync(1500);

  expect(intactCount()).toBe(COLUMNS * ROWS);
});

test("a double tap on a barely popped sheet only pops bubbles", async () => {
  await vi.advanceTimersByTimeAsync(100);
  const { x, y } = centre(4, 5);
  await doubleTap(x, y);
  await vi.advanceTimersByTimeAsync(1500);

  expect(intactCount()).toBe(COLUMNS * ROWS - 1);
});

test("two taps too far apart in time are not a double tap", async () => {
  await vi.advanceTimersByTimeAsync(100);
  popEverything();
  await vi.advanceTimersByTimeAsync(2000);
  press(80, 80);
  release();
  await vi.advanceTimersByTimeAsync(1000);
  press(80, 80);
  await vi.advanceTimersByTimeAsync(1500);

  expect(intactCount()).toBe(0);
});

test("stop cancels its frame and ignores the pointer from then on", async () => {
  const { x, y } = centre(4, 5);
  press(x, y);
  stop();

  expect(vi.getTimerCount()).toBe(0);
  press(x, y);
  expect(vi.getTimerCount()).toBe(0);
});
