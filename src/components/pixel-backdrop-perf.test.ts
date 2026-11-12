import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installBackdropDefaults } from "../test/backdrop-defaults";
import {
  countAllocations,
  installSoftCanvas,
  litPixels,
  place,
  SoftContext,
  softStats,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../test/toy-canvas";
import { DISPLAYS } from "./backdrop-displays";
import { MODES } from "./backdrop-modes";
import type { PixelBackdropOptions } from "./pixel-backdrop";
import "./pixel-backdrop";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

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

const SIZE = 160;

/** How long after the last input a toy may keep animating, as the contract allows. */
const SETTLE_MS = 30_000;

/**
 * Toys that draw only while pressed on, so the canvas idles between presses
 * and plays fewer, unevenly paced presents than a toy that moves with the
 * pointer.
 */
const PRESSURE_ONLY = new Set(["bubblewrap"]);

/** Time for the ghost to fade out a still frame, with plenty to spare. */
const FADE_MS = 2000;

let bitmaps: ReturnType<typeof installSoftCanvas>;
/** Timestamps of the animation frames that have run. */
let animationFrames: Set<number>;

const isEcho = (context: unknown) =>
  (context as SoftContext).canvas?.classList.contains("echo");

/** Copies onto the display: the plain canvas inside the closed shadow root that is not the echo. */
function presents() {
  const onDisplay = (spy: { mock: { contexts: unknown[] } }) =>
    spy.mock.contexts.filter(
      (context) =>
        bitmaps.plain.includes((context as SoftContext).bitmap) &&
        !isEcho(context),
    ).length;
  return (
    onDisplay(vi.mocked(SoftContext.prototype.putImageData)) +
    onDisplay(vi.mocked(SoftContext.prototype.drawImage))
  );
}

beforeEach(() => {
  useFakeFrames();
  bitmaps = installSoftCanvas();
  vi.spyOn(SoftContext.prototype, "putImageData");
  vi.spyOn(SoftContext.prototype, "drawImage");
  animationFrames = new Set();
  const requestFrame = window.requestAnimationFrame;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
    requestFrame((time) => {
      animationFrames.add(time);
      callback(time);
    }),
  );
  vi.spyOn(window, "setTimeout");
  // The probe `visibleCells` measures; jsdom has no layout to size it.
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, innerWidth, innerHeight),
  );
  installBackdropDefaults();
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  motion.set(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A 4:3 viewport over the square grid, which overhangs it top and bottom. */
function mount(
  id: string,
  knobs: Partial<PixelBackdropOptions> = {},
  display = "site",
) {
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.setMode(id);
  backdrop.setDisplay(display);
  backdrop.configure(knobs);
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, {
    width: String(SIZE),
    height: String(SIZE),
    fit: "viewport",
  });
  place(
    canvas,
    new DOMRect(0, (innerHeight - innerWidth) / 2, innerWidth, innerWidth),
  );
  backdrop.append(canvas);
  document.body.append(backdrop);
  return canvas;
}

const pointer = (type: string, share: number, init: PointerEventInit = {}) =>
  window.dispatchEvent(
    new PointerEvent(type, {
      clientX: share * innerWidth,
      clientY: share * innerHeight,
      pointerType: "mouse",
      pointerId: 1,
      isPrimary: true,
      ...init,
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
  pointer("pointerdown", 1, { buttons: 1 });
  for (let ms = 0; ms < 1000; ms += 16) {
    pointer("pointermove", 1 - ms / 1000, { buttons: 1 });
    await vi.advanceTimersByTimeAsync(16);
  }
  pointer("pointerup", 0);
  await vi.advanceTimersByTimeAsync(250);
  pointer("pointerdown", 0.5, { buttons: 1 });
  await vi.advanceTimersByTimeAsync(50);
  pointer("pointerup", 0.5);
  document.dispatchEvent(new MouseEvent("mouseleave"));
  await vi.advanceTimersByTimeAsync(700);
}

/** Presents in each of the next `seconds` seconds. */
async function presentsPerSecond(seconds: number) {
  const counts: number[] = [];
  for (let second = 0; second < seconds; second += 1) {
    const before = presents();
    await vi.advanceTimersByTimeAsync(1000);
    counts.push(presents() - before);
  }
  return counts;
}

describe.each(MODES.map((toy) => [toy.id]))("%s", (id) => {
  test("presents at most once per animation frame while played", async () => {
    mount(id);
    await play();

    if (!PRESSURE_ONLY.has(id)) expect(presents()).toBeGreaterThan(100);
    if (!PRESSURE_ONLY.has(id))
      expect(presents()).toBeLessThanOrEqual(animationFrames.size + 1);
  });

  test("lights visible pixels while played", async () => {
    mount(id);
    let peak = 0;
    const sample = setInterval(
      () => (peak = Math.max(peak, litPixels(bitmaps.offscreen[0]))),
      16,
    );
    await play();
    clearInterval(sample);

    expect(peak).toBeGreaterThanOrEqual(100);
  });

  test("idles at about eight presents a second over drifting noise once input settles", async () => {
    mount(id, { noise: 18, noiseSpeed: 5 });
    await play();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + FADE_MS);

    const idle = await presentsPerSecond(3);
    expect(idle.filter((count) => count < 7 || count > 8)).toEqual([]);
  });

  test("presents nothing once still over static noise", async () => {
    mount(id, { noiseSpeed: 0 });
    await play();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + FADE_MS);

    expect(await presentsPerSecond(5)).toEqual([0, 0, 0, 0, 0]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("with no style changing, presents only after the toy draws", async () => {
    mount(id, { ghost: 0, noise: 0 });
    const offscreen = bitmaps.offscreen[0].getContext();
    const draws = vi.spyOn(offscreen, "putImageData");
    await play();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(presents()).toBeGreaterThan(0);
    expect(presents()).toBeLessThanOrEqual(draws.mock.calls.length);
  });

  test("reads nothing back and allocates nothing per frame once warmed up", async () => {
    mount(id);
    await play();
    softStats.reads = 0;
    const before = presents();

    const allocations = countAllocations();
    try {
      await play();
    } finally {
      allocations.restore();
    }

    if (!PRESSURE_ONLY.has(id))
      expect(presents() - before).toBeGreaterThan(100);
    expect(softStats.reads).toBe(0);
    expect(allocations.count()).toBe(0);
  });

  test("with a pixel shadow, copies each present to the echo once, reading and allocating nothing", async () => {
    const canvas = mount(id);
    canvas.dataset.shadow = "40";
    await play();
    softStats.reads = 0;
    const before = presents();
    const echoCopies = () =>
      vi.mocked(SoftContext.prototype.drawImage).mock.contexts.filter(isEcho)
        .length;
    const echoedBefore = echoCopies();

    const allocations = countAllocations();
    try {
      await play();
    } finally {
      allocations.restore();
    }

    if (!PRESSURE_ONLY.has(id))
      expect(presents() - before).toBeGreaterThan(100);
    expect(echoCopies() - echoedBefore).toBe(presents() - before);
    expect(softStats.reads).toBe(0);
    expect(allocations.count()).toBe(0);
  });

  describe.each(DISPLAYS.filter(({ look }) => look).map(({ id }) => [id]))(
    "on the %s display",
    (display) => {
      test("presents at most once per animation frame, reading and allocating nothing once warmed up", async () => {
        mount(id, {}, display);
        await play();
        softStats.reads = 0;
        const before = presents();

        const allocations = countAllocations();
        try {
          await play();
        } finally {
          allocations.restore();
        }

        if (!PRESSURE_ONLY.has(id))
          expect(presents() - before).toBeGreaterThan(100);
        if (!PRESSURE_ONLY.has(id))
          expect(presents()).toBeLessThanOrEqual(animationFrames.size + 1);
        expect(softStats.reads).toBe(0);
        expect(allocations.count()).toBe(0);
      });

      test("presents nothing once still, as its noise is off", async () => {
        mount(id, {}, display);
        await play();
        await vi.advanceTimersByTimeAsync(SETTLE_MS + FADE_MS);

        expect(await presentsPerSecond(5)).toEqual([0, 0, 0, 0, 0]);
        expect(vi.getTimerCount()).toBe(0);
      });
    },
  );

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
    expect(presents()).toBe(0);
  });

  test("grabs a touch in the open at once: the canvas gets its press and drag, and the page's scroll is blocked", async () => {
    const canvas = mount(id);
    const heard: string[] = [];
    for (const type of ["pointerdown", "pointermove"]) {
      canvas.addEventListener(type, (event) => heard.push(event.type));
    }
    const touch = {
      pointerType: "touch",
      pointerId: 7,
      button: 0,
      isPrimary: true,
    };

    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { ...touch, bubbles: true }),
    );
    const move = new TouchEvent("touchmove", {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(move);
    pointer("pointermove", 0.5, touch);

    expect(move.defaultPrevented).toBe(true);
    expect(heard).toEqual(["pointerdown", "pointermove"]);
  });
});
