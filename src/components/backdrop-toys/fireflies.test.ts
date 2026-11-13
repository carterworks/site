import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import {
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { fireflies } from "./fireflies";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const SIZE = 160;
const STEP = 1000 / 60;
const visible = { left: 0, top: 35, right: SIZE, bottom: 125 };
/** Brighter than a resting firefly ever is, so only flashes count. */
const FLASHING = 128;
/** Only a flash in its first frame or two is this bright. */
const FLASH_START = 230;
/** A resting firefly one fade-in step out of sleep: 70 / 30, rounded. */
const ONE_STEP_IN = 2;

let canvas: HTMLCanvasElement;
let bitmap: () => SoftBitmap;
let stop: () => void;

function mount(seed = 1) {
  vi.spyOn(Math, "random").mockImplementation(mulberry32(seed));
  const { plain } = installSoftCanvas();
  canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, 0, SIZE, SIZE));
  document.body.append(canvas);
  stop = fireflies.start(canvas);
  bitmap = () => plain[0];
}

beforeEach(() => {
  useFakeFrames();
  const view = new DOMRect(
    visible.left,
    visible.top,
    visible.right - visible.left,
    visible.bottom - visible.top,
  );
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLDivElement ? view : measure.call(this);
    },
  );
});

afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const run = (steps: number) => vi.advanceTimersByTimeAsync(steps * STEP);

function cells(keep: (alpha: number) => boolean) {
  const { pixels } = bitmap();
  const found: { x: number; y: number }[] = [];
  for (let i = 0; i < pixels.length / 4; i += 1) {
    if (pixels[i * 4 + 3] > 0 && keep(pixels[i * 4 + 3])) {
      found.push({ x: i % SIZE, y: Math.floor(i / SIZE) });
    }
  }
  return found;
}

const flashing = () => cells((alpha) => alpha >= FLASHING).length;

/**
 * The most flash pixels any one frame shows over `steps`; only those
 * `around` a point, if given, clear of the flash a tap makes there.
 */
async function peakFlash(
  steps: number,
  {
    brightest = FLASHING,
    around,
  }: { brightest?: number; around?: { x: number; y: number } } = {},
) {
  let peak = 0;
  for (let i = 0; i < steps; i += 1) {
    await run(1);
    const lit = cells((alpha) => alpha >= brightest).filter(
      ({ x, y }) =>
        around === undefined ||
        Math.abs(Math.hypot(x - around.x, y - around.y) - 20) < 12,
    );
    peak = Math.max(peak, lit.length);
  }
  return peak;
}

test("it shows the swarm the moment it starts", async () => {
  mount();
  await run(1);
  expect(cells(() => true).length).toBeGreaterThanOrEqual(60);
});

test("the fireflies wander but stay inside the visible area", async () => {
  mount();
  for (let second = 0; second < 18; second += 1) {
    await run(60);
    for (const { x, y } of cells(() => true)) {
      expect(y).toBeGreaterThanOrEqual(visible.top);
      expect(y).toBeLessThan(visible.bottom);
      expect(x).toBeGreaterThanOrEqual(visible.left);
      expect(x).toBeLessThan(visible.right);
    }
  }
});

test("blinking out of step at first, the swarm falls into sync", async () => {
  mount();
  const early = await peakFlash(60, { brightest: FLASH_START });
  await run(60 * 14);
  const late = await peakFlash(90, { brightest: FLASH_START });
  expect(late).toBeGreaterThan(early * 3);
});

test("a tap flashes at the pointer at once", async () => {
  mount();
  await run(10);
  pointerAt(canvas, "pointerdown", 80.5, 80.5);
  await run(1);
  expect(bitmap().pixels[(80 * SIZE + 80) * 4 + 3]).toBe(255);
});

test("fireflies near a tap flash in reply soon after", async () => {
  const tapAt = { x: 80, y: 80 };
  /** Taps, or not, just after a synced swarm flashed, when none would again for a while. */
  const watch = async (tap: boolean) => {
    mount();
    await run(60 * 15);
    for (let i = 0; i < 90 && flashing() < 300; i += 1) await run(1);
    await run(12);
    if (tap) pointerAt(canvas, "pointerdown", tapAt.x, tapAt.y);
    const peak = await peakFlash(30, { around: tapAt });
    stop();
    document.body.replaceChildren();
    return peak;
  };
  expect(await watch(false)).toBe(0);
  expect(await watch(true)).toBeGreaterThan(100);
});

test("a hovering pointer draws nearby fireflies toward it", async () => {
  const hoverAt = { x: 40, y: 80 };
  const near = () =>
    cells(() => true).filter(
      ({ x, y }) => Math.hypot(x - hoverAt.x, y - hoverAt.y) < 16,
    ).length;
  mount();
  await run(1);
  const before = near();
  for (let second = 0; second < 6; second += 1) {
    pointerAt(canvas, "pointermove", hoverAt.x, hoverAt.y);
    await run(60);
  }
  expect(near()).toBeGreaterThan(before * 3);
});

test("left alone they settle, dim out and stop asking for frames", async () => {
  mount();
  await run(60 * 15);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  expect(cells(() => true).length).toBeGreaterThan(0);

  await run(60 * 10);
  expect(vi.getTimerCount()).toBe(0);
  expect(cells(() => true)).toEqual([]);
});

test("any input wakes them again", async () => {
  mount();
  await run(60 * 25);
  expect(vi.getTimerCount()).toBe(0);

  pointerAt(canvas, "pointerleave", 0, 0);
  await run(60);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  expect(cells(() => true).length).toBeGreaterThanOrEqual(60);
});

test("stop cancels its frame and ignores the pointer from then on", () => {
  mount();
  stop();
  pointerAt(canvas, "pointerdown", 80, 80);
  expect(vi.getTimerCount()).toBe(0);
  expect(flashing()).toBe(0);
});

test("woken after a long sleep, they fade in from one step, not from the pause", async () => {
  mount();
  await run(60 * 25);
  await run(60 * 60);

  pointerAt(canvas, "pointerleave", 0, 0);
  await run(1);

  const { pixels } = bitmap();
  const alphas = cells(() => true).map(
    ({ x, y }) => pixels[(y * SIZE + x) * 4 + 3],
  );
  expect(Math.max(...alphas)).toBe(ONE_STEP_IN);
});
