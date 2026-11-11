import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installBackdropDefaults } from "../test/backdrop-defaults";
import { MODES } from "./backdrop-modes";
import type { Pace } from "./backdrop-modes/mode";
import { EmulatedCanvas } from "./emulated-canvas";
import type { PixelBackdropOptions } from "./pixel-backdrop";
import "./pixel-backdrop";

const motion = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const query = {
    matches: false,
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", (media: string) =>
    media.includes("reduced-motion")
      ? query
      : { matches: false, addEventListener() {}, removeEventListener() {} },
  );
  return {
    set(reduced: boolean) {
      query.matches = reduced;
      for (const listener of listeners) listener();
    },
  };
});

/** Every noise sampler made, with how often it has been sampled. */
const samplers = vi.hoisted(() => [] as { samples: number }[]);

vi.mock("./backdrop-noise", async (importOriginal) => {
  const noise = await importOriginal<typeof import("./backdrop-noise")>();
  return {
    ...noise,
    makeNoise2D(seed: number) {
      const sample = noise.makeNoise2D(seed);
      const counter = { samples: 0 };
      samplers.push(counter);
      return (x: number, y: number) => {
        counter.samples += 1;
        return sample(x, y);
      };
    },
  };
});

/** The pace the backdrop's mode last reported. */
const probe = vi.hoisted(() => ({ pace: undefined as Pace | undefined }));

vi.mock("./backdrop-modes", async (importOriginal) => {
  const { MODES } = await importOriginal<typeof import("./backdrop-modes")>();
  return {
    MODES: MODES.map((mode) => ({
      ...mode,
      create(setup: Parameters<typeof mode.create>[0]) {
        const instance = mode.create(setup);
        return {
          ...instance,
          pace: () => (probe.pace = instance.pace()),
        };
      },
    })),
  };
});

const SIZE = 80;

/** Calls made since the last present, by the canvas they went to. */
type Ledger = {
  bitmapPuts: number;
  displayCopies: number;
  readbackDraws: number;
  readbackReads: number;
  hostNoise: number;
};

const emptyLedger = (): Ledger => ({
  bitmapPuts: 0,
  displayCopies: 0,
  readbackDraws: 0,
  readbackReads: 0,
  hostNoise: 0,
});

let ledger = emptyLedger();
/** One ledger per presented frame. */
let frames: Ledger[] = [];
/** Samplers the backdrop made for itself rather than for its mode. */
let hostSamplers: { samples: number }[] = [];
/** Timestamps of the animation frames that have run. */
let animationFrames = new Set<number>();
let displays: HTMLCanvasElement[] = [];

/** Just enough of a 2D bitmap for pixels to flow from the backdrop to the display. */
class FakeBitmap {
  pixels: Uint8ClampedArray;
  #context?: object;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext(_id: string, options?: { willReadFrequently?: boolean }) {
    const { pixels, width, height } = this;
    // Only emulated-canvas's read-back canvas asks to be read frequently.
    const readback = options?.willReadFrequently === true;
    return (this.#context ??= {
      globalCompositeOperation: "source-over",
      createImageData: (w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData(image: ImageData) {
        ledger.bitmapPuts += 1;
        pixels.set(image.data);
      },
      drawImage(source: FakeBitmap) {
        if (readback) ledger.readbackDraws += 1;
        pixels.set(source.pixels);
      },
      getImageData() {
        if (readback) ledger.readbackReads += 1;
        return { width, height, data: pixels.slice() };
      },
    });
  }
}

const display = {
  globalCompositeOperation: "source-over",
  drawImage() {
    ledger.displayCopies += 1;
  },
  putImageData() {
    ledger.displayCopies += 1;
  },
};

function mount(id: string, knobs: Partial<PixelBackdropOptions> = {}) {
  samplers.length = 0;
  const backdrop = document.createElement("pixel-backdrop");
  hostSamplers = [...samplers];
  backdrop.setMode(id);
  backdrop.configure(knobs);
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, { width: String(SIZE), height: String(SIZE) });
  backdrop.append(canvas);
  document.body.append(backdrop);
  return backdrop;
}

const pointer = (type: string, share: number) =>
  window.dispatchEvent(
    new PointerEvent(type, {
      clientX: share * innerWidth,
      clientY: share * innerHeight,
    }),
  );

/**
 * About 3 s of input: a hover sweep down the viewport's diagonal, a
 * press-and-hold dragged back up it, a tap in the middle, then the pointer
 * leaves.
 */
async function play() {
  for (let ms = 0; ms < 1000; ms += 16) {
    pointer("pointermove", ms / 1000);
    await vi.advanceTimersByTimeAsync(16);
  }
  pointer("pointerdown", 1);
  for (let ms = 0; ms < 1000; ms += 16) {
    pointer("pointermove", 1 - ms / 1000);
    await vi.advanceTimersByTimeAsync(16);
  }
  pointer("pointerup", 0);
  await vi.advanceTimersByTimeAsync(250);
  pointer("pointerdown", 0.5);
  await vi.advanceTimersByTimeAsync(50);
  pointer("pointerup", 0.5);
  document.dispatchEvent(new MouseEvent("mouseleave"));
  await vi.advanceTimersByTimeAsync(700);
}

/** How long after the last input a mode may stay active, as the contract allows. */
const SETTLE_MS = 30_000;
/** Time for the ghost to fade out a still frame, with plenty to spare. */
const FADE_MS = 2000;

/** Presents in each of the next `seconds` seconds. */
async function presentsPerSecond(seconds: number) {
  const counts: number[] = [];
  for (let second = 0; second < seconds; second += 1) {
    const before = frames.length;
    await vi.advanceTimersByTimeAsync(1000);
    counts.push(frames.length - before);
  }
  return counts;
}

const BUFFERS = [
  "Float32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint32Array",
  "ImageData",
] as const;

/** Counts buffers constructed until `restore`. */
function countAllocations() {
  let count = 0;
  const globals = globalThis as unknown as Record<string, object>;
  const originals = BUFFERS.map((name) => globals[name]);
  BUFFERS.forEach((name, index) => {
    globals[name] = new Proxy(originals[index] as new () => object, {
      construct(target, args, newTarget) {
        count += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });
  });
  return {
    count: () => count,
    restore() {
      BUFFERS.forEach((name, index) => (globals[name] = originals[index]));
    },
  };
}

/** The mode after `id`, so a change always goes somewhere else. */
const otherThan = (id: string) =>
  MODES[(MODES.findIndex((mode) => mode.id === id) + 1) % MODES.length].id;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "setTimeout",
      "clearTimeout",
      "performance",
    ],
  });
  const requestFrame = window.requestAnimationFrame;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
    requestFrame((time) => {
      animationFrames.add(time);
      callback(time);
    }),
  );
  vi.spyOn(window, "setTimeout");
  vi.stubGlobal("OffscreenCanvas", FakeBitmap);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      displays.push(this);
      return display as unknown as CanvasRenderingContext2D;
    },
  );
  // A 4:3 viewport over the square grid, which overhangs it top and bottom.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, (innerHeight - innerWidth) / 2, innerWidth, innerWidth),
  );
  const present = EmulatedCanvas.prototype.present;
  vi.spyOn(EmulatedCanvas.prototype, "present").mockImplementation(
    function (this: EmulatedCanvas) {
      const changing = present.call(this);
      ledger.hostNoise = hostSamplers.reduce((sum, s) => sum + s.samples, 0);
      for (const sampler of hostSamplers) sampler.samples = 0;
      frames.push(ledger);
      ledger = emptyLedger();
      return changing;
    },
  );
  installBackdropDefaults();
  ledger = emptyLedger();
  frames = [];
  animationFrames = new Set();
  displays = [];
  probe.pace = undefined;
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  motion.set(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(MODES.map((mode) => [mode.id]))("%s", (id) => {
  test("each frame paints the bitmap once, copies it to the display once, and samples the noise at most once per cell", async () => {
    mount(id);
    await play();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + FADE_MS);

    expect(frames.length).toBeGreaterThan(0);
    const unbounded = frames.filter(
      (frame) =>
        frame.bitmapPuts !== 1 ||
        frame.displayCopies !== 1 ||
        frame.readbackDraws > 1 ||
        frame.readbackReads > 1 ||
        frame.hostNoise > SIZE * SIZE,
    );
    expect(unbounded).toEqual([]);
    expect(frames.some((frame) => frame.hostNoise > 0)).toBe(true);
  });

  test("a mode change keeps every frame within bounds and allocates no buffers once the first change has warmed up", async () => {
    const backdrop = mount(id);
    await vi.advanceTimersByTimeAsync(500);
    backdrop.setMode(otherThan(id));
    await vi.advanceTimersByTimeAsync(1500);

    backdrop.setMode(id);
    frames = [];
    const allocations = countAllocations();
    try {
      await vi.advanceTimersByTimeAsync(1000);
    } finally {
      allocations.restore();
    }

    expect(frames.length).toBeGreaterThan(40);
    const unbounded = frames.filter(
      (frame) =>
        frame.bitmapPuts !== 1 ||
        frame.displayCopies !== 1 ||
        frame.readbackDraws > 1 ||
        frame.readbackReads > 1 ||
        frame.hostNoise > SIZE * SIZE,
    );
    expect(unbounded).toEqual([]);
    expect(allocations.count()).toBe(0);
  });

  test("the display keeps a bitmap-sized backing store", async () => {
    mount(id);
    await play();

    expect(displays.length).toBeGreaterThan(0);
    for (const canvas of displays) {
      expect([canvas.width, canvas.height]).toEqual([SIZE, SIZE]);
    }
  });

  test("presents at most once per animation frame, and at most 8 times a second once input has settled", async () => {
    mount(id);
    await play();
    expect(frames.length).toBeLessThanOrEqual(animationFrames.size);

    await vi.advanceTimersByTimeAsync(SETTLE_MS + FADE_MS);
    const idle = await presentsPerSecond(5);
    expect(idle.filter((presents) => presents > 8)).toEqual([]);
    expect(frames.length).toBeLessThanOrEqual(animationFrames.size);
  });

  test("over static noise, stops presenting once a still mode's frame has faded", async () => {
    mount(id, { noiseSpeed: 0 });
    await play();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + FADE_MS);

    const limit = probe.pace === "still" ? 0 : 8;
    const presents = await presentsPerSecond(5);
    expect(presents.filter((count) => count > limit)).toEqual([]);
  });

  test.each([
    ["disabled", () => mount(id, { enabled: false })],
    [
      "under reduced motion",
      () => {
        motion.set(true);
        mount(id);
      },
    ],
  ])("requests no frames or timers %s", async (_, setUp) => {
    setUp();
    await play();
    await vi.advanceTimersByTimeAsync(5000);

    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(window.setTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(frames).toEqual([]);
  });
});
