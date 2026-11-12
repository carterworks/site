import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  countAllocations,
  installSoftCanvas,
  place,
  pointerAt,
  type SoftBitmap,
  softStats,
  useFakeFrames,
} from "../../test/toy-canvas";
import { mulberry32 } from "../backdrop-noise";
import { MAX_GHOST } from "../emulated-canvas-limits";
import "../emulated-canvas";
import { MODES } from ".";
import type { Toy, ToyCanvas } from "./toy";

const SIZE = 160;

/**
 * Toys allowed to keep an idle loop (at most ~8 frames a second) once input
 * stops, each with the reason beside it. Every other toy must stop asking for
 * frames, so an untouched tab costs nothing.
 */
const RESTING_IDLE: Record<string, string> = {};

/** How long after the last input a toy may keep animating. */
const SETTLE_MS = 30_000;

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

beforeEach(() => {
  useFakeFrames();
  bitmaps = installSoftCanvas();
  vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Mounts `kind` as a 16:9 viewport over the square canvas, and starts `toy` on it. */
function run(toy: Toy, kind: keyof typeof KINDS) {
  const { canvas, bitmap } = KINDS[kind](bitmaps);
  place(canvas, new DOMRect(0, -280, 1280, 1280));
  document.body.append(canvas);
  const stop = toy.start(canvas as ToyCanvas);
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

const lit = (bitmap: SoftBitmap) => bitmap.pixels.some((value) => value > 0);

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

test("only registered toys are allowed to rest idle", () => {
  const ids = MODES.map((toy) => toy.id);
  expect(ids).toEqual(expect.arrayContaining(Object.keys(RESTING_IDLE)));
});

describe.each(MODES.map((toy) => [toy.id, toy] as const))("%s", (id, toy) => {
  test("has a look, if any, within 0–100 and under the canvas's ghost cap", () => {
    const { ghost = 0, noise = 0 } = toy.look ?? {};
    expect(ghost).toBeGreaterThanOrEqual(0);
    expect(ghost).toBeLessThanOrEqual(MAX_GHOST * 100);
    expect(noise).toBeGreaterThanOrEqual(0);
    expect(noise).toBeLessThanOrEqual(100);
  });

  test("draws the same pixels on a plain canvas as on an emulated one", async () => {
    const shown: Record<string, Uint8ClampedArray> = {};
    for (const kind of ["plain", "emulated"] as const) {
      vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
      const { canvas, bitmap, stop } = run(toy, kind);
      let drew = false;
      for (let ms = 0; ms < 500; ms += 16) {
        pointerAt(
          canvas,
          "pointermove",
          ...(across(ms / 500) as [number, number]),
        );
        await vi.advanceTimersByTimeAsync(16);
        drew ||= lit(bitmap());
      }
      expect(drew).toBe(true);
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

        if (id in RESTING_IDLE) {
          const frames = vi.spyOn(window, "requestAnimationFrame");
          await vi.advanceTimersByTimeAsync(1000);
          expect(frames.mock.calls.length).toBeLessThanOrEqual(8);
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

      test("stop cancels its frames and stops listening", async () => {
        const { canvas, stop } = run(toy, kind);
        pointerAt(canvas, "pointermove", 10, 60);
        pointerAt(canvas, "pointerdown", 20, 60);
        stop();
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        const frames = vi.spyOn(window, "requestAnimationFrame");

        await play(canvas);

        expect(frames).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      });
    },
  );
});
