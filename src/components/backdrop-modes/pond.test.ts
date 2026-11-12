import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useExactFrames,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { mulberry32 } from "../backdrop-noise";
import { pond } from "./pond";
import { visibleCells } from "./toy";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const SIZE = 160;
const middle = SIZE / 2;
const STEP = 1000 / 60;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

function mount() {
  const { plain } = installSoftCanvas();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, -280, 1280, 1280));
  document.body.append(canvas);
  stop = pond.start(canvas);
  bitmap = () => plain[0];
}

beforeEach(() => {
  useFakeFrames();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
  // The probe `visibleCells` measures: a 960x720 viewport over the canvas's middle.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(160, 0, 960, 720),
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

const frames = (count: number) => vi.advanceTimersByTimeAsync(count * STEP);

/** Total alpha on the canvas, in whole pixels of full opacity. */
function energy() {
  const { pixels } = bitmap();
  let sum = 0;
  for (let i = 3; i < pixels.length; i += 4) sum += pixels[i] / 255;
  return sum;
}

const press = (x: number, y: number) =>
  pointerAt(canvas, "pointerdown", x, y, { buttons: 1 });
const lift = (x: number, y: number) => pointerAt(canvas, "pointerup", x, y);
const tap = async (x: number, y: number) => {
  press(x, y);
  lift(x, y);
  await frames(1);
};

test("a tap raises the surface and keeps the loop active", async () => {
  await tap(middle, middle);

  expect(energy()).toBeGreaterThan(0);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
});

test("a tap damps back to a flat surface and the loop stops", async () => {
  await tap(middle, middle);
  await frames(60 * 40);

  expect(energy()).toBe(0);
  expect(bitmap().pixels.every((value) => value === 0)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test("a press held down drops no stone, since a drag would start with a splash", async () => {
  press(middle, middle);
  await frames(5);

  expect(energy()).toBe(0);
});

test("a tap drops its stone when the finger lifts", async () => {
  press(middle, middle);
  await frames(1);
  expect(energy()).toBe(0);
  lift(middle, middle);
  await frames(1);

  expect(energy()).toBeGreaterThan(0);
});

test("a press held past a tap drops no stone on release", async () => {
  press(middle, middle);
  await frames(60);
  lift(middle, middle);
  await frames(1);

  expect(energy()).toBe(0);
});

test("a press that travelled before lifting is a drag, not a tap", async () => {
  const total = async (release: boolean) => {
    stop();
    mount();
    press(SIZE / 4, middle);
    pointerAt(canvas, "pointermove", SIZE / 4 + 20, middle, { buttons: 1 });
    await frames(1);
    if (release) lift(SIZE / 4 + 20, middle);
    await frames(1);
    return energy();
  };

  expect(await total(true)).toBe(await total(false));
});

test("the same press is dropped only once", async () => {
  await tap(middle, middle);
  await frames(60 * 40);
  await frames(1);

  expect(energy()).toBe(0);
});

test("a resting pointer injects nothing", async () => {
  pointerAt(canvas, "pointermove", middle, middle);
  await frames(60);
  pointerAt(canvas, "pointermove", middle, middle);
  await frames(60);

  expect(energy()).toBe(0);
});

test("dragging with a press held leaves a wake that hovering does not", async () => {
  const wake = async (held: boolean) => {
    stop();
    mount();
    const init = held ? { buttons: 1 } : {};
    pointerAt(canvas, "pointermove", SIZE / 4, middle);
    if (held) press(SIZE / 4, middle);
    await frames(1);
    for (let x = SIZE / 4 + 1; x <= SIZE * 0.625; x += 1) {
      pointerAt(canvas, "pointermove", x, middle, init);
      await frames(1);
    }
    return energy();
  };

  const hover = await wake(false);
  expect(hover).toBeGreaterThan(0);
  expect(await wake(true)).toBeGreaterThan(hover);
});

const DRAG_FRAMES = 100;

async function dragIn(events: number, distance: number) {
  stop();
  useExactFrames(STEP);
  mount();
  const startX = SIZE / 4;
  pointerAt(canvas, "pointermove", startX, middle);
  press(startX, middle);
  await frames(1);
  let total = 0;
  let peak = 0;
  for (let f = 1; f <= DRAG_FRAMES; f += 1) {
    if (f % (DRAG_FRAMES / events) === 0) {
      pointerAt(
        canvas,
        "pointermove",
        startX + (distance * f) / DRAG_FRAMES,
        middle,
        { buttons: 1 },
      );
    }
    await frames(1);
    total += energy();
    const { pixels } = bitmap();
    for (let i = 3; i < pixels.length; i += 4) {
      peak = Math.max(peak, pixels[i] / 255);
    }
  }
  return { total, peak };
}

test("a drag injects the same energy however many events deliver it", async () => {
  const coarse = (await dragIn(10, 10)).total;
  const fine = (await dragIn(100, 10)).total;

  expect(Math.abs(fine - coarse) / coarse).toBeLessThan(0.2);
});

test("a long drag never piles the water up to full strength", async () => {
  expect((await dragIn(100, 100)).peak).toBeLessThan(0.75);
});

test("idle rain lands inside the visible rect", async () => {
  const visible = visibleCells(canvas as never);
  expect(visible.left).toBeGreaterThan(0);
  expect(visible.right).toBeLessThan(SIZE);
  const random = vi.mocked(Math.random);
  let drops = 0;
  for (let i = 0; i < 60 * 60; i += 1) {
    const before = random.mock.calls.length;
    await frames(1);
    // A drop draws its x, its y and the wait for the next.
    if (random.mock.calls.length === before) continue;
    drops += 1;
    const { pixels } = bitmap();
    let lit = 0;
    for (let j = 0; j < SIZE * SIZE; j += 1) {
      if (pixels[j * 4 + 3] === 0) continue;
      lit += 1;
      const x = (j % SIZE) + 0.5;
      const y = Math.floor(j / SIZE) + 0.5;
      expect(x).toBeGreaterThanOrEqual(visible.left);
      expect(x).toBeLessThanOrEqual(visible.right);
      expect(y).toBeGreaterThanOrEqual(visible.top);
      expect(y).toBeLessThanOrEqual(visible.bottom);
    }
    expect(lit).toBeGreaterThan(0);
  }

  expect(drops).toBeGreaterThanOrEqual(3);
});

test("it clears the previous toy's frame on its first frame", async () => {
  stop();
  bitmap().pixels.fill(255);
  stop = pond.start(canvas);
  await frames(1);

  expect(energy()).toBe(0);
});

test("no rain falls before 2.5 s of quiet", async () => {
  await vi.advanceTimersByTimeAsync(2400);

  expect(energy()).toBe(0);
});

test("rain stops after a while so an untouched pond lets the loop sleep", async () => {
  await vi.advanceTimersByTimeAsync(40_000);

  expect(vi.getTimerCount()).toBe(0);
});

test("a pond that is about to rain sleeps on a timer between drops instead of stopping", async () => {
  await tap(middle, middle);
  await vi.advanceTimersByTimeAsync(8000);

  expect(vi.getTimerCount()).toBeGreaterThan(0);
});

test("a lone ripple costs far less to step than one that fills the pond", async () => {
  // Each swept cell costs one Math.abs; counting them is load-independent, unlike wall-clock time.
  const abs = Math.abs;
  let calls = 0;
  Math.abs = (value) => {
    calls += 1;
    return abs(value);
  };
  const countWork = async (count: number) => {
    calls = 0;
    await frames(count);
    return calls;
  };
  let lone = 0;
  let filled = 0;
  try {
    await tap(SIZE / 16, SIZE / 16);
    lone = await countWork(6);
    for (let x = 0; x < SIZE; x += 1) {
      pointerAt(canvas, "pointermove", x, middle);
      await frames(1);
    }
    filled = await countWork(6);
  } finally {
    Math.abs = abs;
  }

  expect(lone * 4).toBeLessThan(filled);
});

// Recorded while it matched a full-grid run, which it cannot check itself: it only detects change.
test("a scripted session paints the recorded frames", async () => {
  let digest = 0;
  const fold = () => {
    const { pixels } = bitmap();
    for (let j = 0; j < SIZE * SIZE; j += 1)
      digest += (pixels[j * 4 + 3] / 255) * ((j % 251) + 1);
  };
  press(SIZE / 5, SIZE / 3);
  for (let f = 0; f < 60 * 30; f += 1) {
    if (f < 200) {
      pointerAt(
        canvas,
        "pointermove",
        SIZE / 5 + f * 0.4,
        SIZE / 3 + Math.sin(f / 9) * 20,
        { buttons: 1 },
      );
    } else if (f === 200) {
      lift(SIZE / 5, SIZE / 3);
      canvas.dispatchEvent(new PointerEvent("pointerleave"));
      press(SIZE * 0.8, SIZE * 0.7);
    }
    await frames(1);
    if (f % 7 === 0) fold();
  }

  expect(digest).toBe(3720686.8274509);
});

test("an untouched pond never clears its buffers", async () => {
  const fill = vi.spyOn(Float32Array.prototype, "fill");
  await frames(60);

  expect(fill).not.toHaveBeenCalled();
});

test("stop cancels its frame and timer and ignores the pointer from then on", async () => {
  await tap(middle, middle);
  stop();

  expect(vi.getTimerCount()).toBe(0);
  pointerAt(canvas, "pointerdown", 10, 10);
  pointerAt(canvas, "pointermove", 20, 10);
  expect(vi.getTimerCount()).toBe(0);
});
