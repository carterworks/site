import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  countAllocations,
  installSoftCanvas,
  litPixels,
  place,
  pointerAt,
  recordListeners,
  softStats,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { mulberry32 } from "../../lib/backdrop-noise";
import { MAX_GHOST } from "../emulated-canvas/limits";
import "../emulated-canvas/element";
import { TOYS } from ".";
import type { Toy, ToyCanvas } from "./toy";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

const SIZE = 160;

/**
 * Every toy must stop asking for frames once input stops, so an untouched tab
 * costs nothing. These may outlive SETTLE_MS while they animate in short
 * bursts, each with the reason beside it. They must average at most
 * `maxPerSecond` presents past SETTLE_MS and fully stop within `stopMs` of the
 * last input.
 */
const SLOW_DRAIN: Record<
  string,
  { maxPerSecond: number; stopMs: number; reason: string }
> = {
  silt: {
    maxPerSecond: 8,
    stopMs: 180_000,
    reason: "the sieve drips once a second so a full tray empties over minutes",
  },
};

/** How long after the last input a toy may keep animating. */
const SETTLE_MS = 30_000;

/** Few enough that a toy drawing a handful of stray pixels fails; a visible scene lights far more. */
const MIN_LIT = 100;

/** The canvases a toy must run on unchanged, each with the bitmap it draws on. */
const KINDS = {
  plain(bitmaps: ReturnType<typeof installSoftCanvas>) {
    const canvas = document.createElement("canvas");
    Object.assign(canvas, { width: SIZE, height: SIZE });
    return { canvas, bitmap: () => bitmaps.plain[0] };
  },
  emulated(bitmaps: ReturnType<typeof installSoftCanvas>) {
    const canvas = document.createElement("emulated-canvas");
    Object.assign(canvas.dataset, {
      width: String(SIZE),
      height: String(SIZE),
      ghost: "70",
    });
    return { canvas, bitmap: () => bitmaps.offscreen[0] };
  },
};

let bitmaps: ReturnType<typeof installSoftCanvas>;
const stops: (() => void)[] = [];

beforeEach(() => {
  useFakeFrames();
  bitmaps = installSoftCanvas();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Mounts `kind` as a 16:9 viewport over the square canvas, and runs `toy` on it until the test ends. */
function run(toy: Toy, kind: keyof typeof KINDS) {
  const { canvas, bitmap } = KINDS[kind](bitmaps);
  place(canvas, new DOMRect(0, -280, 1280, 1280));
  document.body.append(canvas);
  const stop = toy.start(canvas as ToyCanvas);
  stops.push(stop);
  return { canvas: canvas as ToyCanvas, bitmap, stop };
}

/** A point `share` of the way down the visible part's diagonal. */
const across = (share: number) => [share * SIZE, (0.22 + 0.56 * share) * SIZE];

/**
 * About 3 s of input: a hover sweep down the diagonal, a press-and-hold
 * dragged back up it, a tap in the middle, then the pointer leaves.
 */
async function play(canvas: ToyCanvas) {
  const at = (type: string, share: number, init?: PointerEventInit) =>
    pointerAt(canvas, type, ...(across(share) as [number, number]), init);
  for (let ms = 0; ms < 1000; ms += 16) {
    at("pointermove", ms / 1000);
    await vi.advanceTimersByTimeAsync(16);
  }
  at("pointerdown", 1, { buttons: 1 });
  for (let ms = 0; ms < 1000; ms += 16) {
    at("pointermove", 1 - ms / 1000, { buttons: 1 });
    await vi.advanceTimersByTimeAsync(16);
  }
  at("pointerup", 0);
  await vi.advanceTimersByTimeAsync(250);
  at("pointerdown", 0.5, { buttons: 1 });
  await vi.advanceTimersByTimeAsync(50);
  at("pointerup", 0.5);
  canvas.dispatchEvent(new PointerEvent("pointerleave"));
  await vi.advanceTimersByTimeAsync(700);
}

test("the allocation count catches a toy that copies a buffer every frame", async () => {
  const leaky: Toy = {
    id: "leaky",
    label: "Leaky",
    start(canvas) {
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(canvas.width, canvas.height);
      const draw = () => {
        context.putImageData(new ImageData(image.data.slice(), SIZE), 0, 0);
        frame = requestAnimationFrame(draw);
      };
      let frame = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(frame);
    },
  };
  const { stop } = run(leaky, "plain");
  const allocations = countAllocations();
  try {
    await vi.advanceTimersByTimeAsync(160);
  } finally {
    allocations.restore();
  }
  stop();
  expect(allocations.count()).toBeGreaterThanOrEqual(18);
});

/**
 * Starts `toy`, gives it input and stops it, and lists each listener it added
 * without a signal or whose signal its stop left unaborted.
 */
function listenersLeftBy(toy: Toy, kind: keyof typeof KINDS) {
  const listeners = recordListeners();
  let canvas: ToyCanvas;
  try {
    const started = run(toy, kind);
    canvas = started.canvas;
    pointerAt(canvas, "pointermove", 10, 60);
    pointerAt(canvas, "pointerdown", 20, 60);
    started.stop();
  } finally {
    listeners.restore();
  }
  const name = (target: EventTarget) =>
    target === window
      ? "window"
      : target === document
        ? "document"
        : target === canvas
          ? "canvas"
          : target.constructor.name;
  return listeners.added.flatMap(({ target, type, signal }) =>
    signal === undefined
      ? [
          `${toy.id} listens for ${type} on the ${name(target)} without a signal`,
        ]
      : signal.aborted
        ? []
        : [
            `${toy.id} still listens for ${type} on the ${name(target)} once stopped`,
          ],
  );
}

test("the listener check catches a toy that listens without a signal", () => {
  const deaf: Toy = {
    id: "deaf",
    label: "Deaf",
    start() {
      const onResize = () => {};
      window.addEventListener("resize", onResize);
      return () => {};
    },
  };

  expect(listenersLeftBy(deaf, "plain")).toEqual([
    "deaf listens for resize on the window without a signal",
  ]);
});

test("only registered toys are allowed to drain slowly", () => {
  const ids = TOYS.map((toy) => toy.id);
  expect(ids).toEqual(expect.arrayContaining(Object.keys(SLOW_DRAIN)));
});

describe.each(TOYS.map((toy) => [toy.id, toy] as const))("%s", (id, toy) => {
  test("has a look, if any, within 0–100 and under the canvas's ghost cap", () => {
    const { ghost = 0, noise = 0 } = toy.look ?? {};
    expect(ghost).toBeGreaterThanOrEqual(0);
    expect(ghost).toBeLessThanOrEqual(MAX_GHOST * 100);
    expect(noise).toBeGreaterThanOrEqual(0);
    expect(noise).toBeLessThanOrEqual(100);
  });

  test(`lights at least ${MIN_LIT} pixels during a session`, async () => {
    const { canvas, bitmap, stop } = run(toy, "plain");
    await vi.advanceTimersByTimeAsync(16);
    let peak = 0;
    const sample = setInterval(
      () => (peak = Math.max(peak, litPixels(bitmap()))),
      16,
    );
    await play(canvas);
    clearInterval(sample);
    expect(peak).toBeGreaterThanOrEqual(MIN_LIT);
    stop();
  });

  test("draws the same pixels on a plain canvas as on an emulated one", async () => {
    const shown: Record<string, Uint8ClampedArray> = {};
    for (const kind of ["plain", "emulated"] as const) {
      vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
      const { canvas, bitmap, stop } = run(toy, kind);
      let drew = 0;
      await vi.advanceTimersByTimeAsync(16);
      for (let ms = 0; ms < 500; ms += 16) {
        pointerAt(
          canvas,
          "pointermove",
          ...(across(ms / 500) as [number, number]),
        );
        await vi.advanceTimersByTimeAsync(16);
        drew = Math.max(drew, litPixels(bitmap()));
      }
      expect(drew).toBeGreaterThan(0);
      shown[kind] = bitmap().pixels.slice();
      stop();
      canvas.remove();
      bitmaps.plain.length = bitmaps.offscreen.length = 0;
    }
    expect(shown.emulated).toEqual(shown.plain);
  });

  describe.each(Object.keys(KINDS) as (keyof typeof KINDS)[])(
    "on a %s canvas",
    (kind) => {
      test("keeps its drawing inside the canvas", async () => {
        const { canvas } = run(toy, kind);
        await play(canvas);
        await vi.advanceTimersByTimeAsync(SETTLE_MS);

        expect(softStats.outOfBounds).toBe(0);
      });

      test(`stops asking for frames within ${SETTLE_MS / 1000} s of the last input`, async () => {
        const { canvas } = run(toy, kind);
        await play(canvas);
        await vi.advanceTimersByTimeAsync(SETTLE_MS);

        if (id in SLOW_DRAIN) {
          const { maxPerSecond, stopMs } = SLOW_DRAIN[id];
          const frames = vi.spyOn(window, "requestAnimationFrame");
          await vi.advanceTimersByTimeAsync(stopMs - SETTLE_MS);
          expect(frames.mock.calls.length).toBeLessThanOrEqual(
            (maxPerSecond * (stopMs - SETTLE_MS)) / 1000,
          );
          expect(vi.getTimerCount()).toBe(0);
        } else {
          expect(vi.getTimerCount()).toBe(0);
        }
      });

      test("allocates no buffers, large arrays or array copies per frame once warmed up", async () => {
        const { canvas } = run(toy, kind);
        await play(canvas);

        const allocations = countAllocations();
        try {
          await play(canvas);
        } finally {
          allocations.restore();
        }
        expect(allocations.count()).toBe(0);
      });

      test("listens only with a signal, which its stop aborts", () => {
        expect(listenersLeftBy(toy, kind)).toEqual([]);
      });

      test("stop cancels its frames and stops listening", async () => {
        const { canvas, stop } = run(toy, kind);
        pointerAt(canvas, "pointermove", 10, 60);
        pointerAt(canvas, "pointerdown", 20, 60);
        stop();
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        const frames = vi.spyOn(window, "requestAnimationFrame");

        await play(canvas);
        window.dispatchEvent(new Event("resize"));

        expect(frames).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      });
    },
  );
});
