import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installBackdropDefaults } from "../../test/backdrop-defaults";
import {
  motion,
  mount,
  mountWithShadow,
  play,
  pointer,
} from "../../test/backdrop-play";
import {
  countAllocations,
  installSoftCanvas,
  litPixels,
  softStats,
  useFakeFrames,
  SLOW_TEST_MS,
} from "../../test/toy-canvas";
import { DISPLAYS } from "./backdrop-displays";
import { TOYS } from "../backdrop-toys";
import { Presenter } from "../emulated-canvas/presenter";
import "./element";

vi.setConfig({ testTimeout: SLOW_TEST_MS });

/** How long after the last input a toy may keep animating, as the contract allows. */
const SETTLE_MS = 30_000;
/** The emulated canvas's idle redraw gap. */
const IDLE_FRAME_MS = 1000 / 8;
/** The play drove the toy through enough presents for its counts to mean something. */
function expectExercised(presentsDuringPlay: number) {
  expect(presentsDuringPlay).toBeGreaterThan(100);
}

/** Time for the ghost to fade out a still frame, with plenty to spare. */
const FADE_MS = 2000;
/** Presses in one `play()`: the drag, then the tap. */
const PRESSES_PER_PLAY = 2;
/** What `<pixel-backdrop>` sets on `<html>` for the length of a hold, so each press writes it twice. */
const HOLDING = "data-backdrop-holding";

let bitmaps: ReturnType<typeof installSoftCanvas>;
/** Timestamps of the animation frames that have run. */
let animationFrames: Set<number>;

/** Frames the canvas handed its presenter to show. */
const presents = () => vi.mocked(Presenter.prototype.show).mock.calls.length;

beforeEach(() => {
  useFakeFrames();
  bitmaps = installSoftCanvas();
  vi.spyOn(Presenter.prototype, "show");
  animationFrames = new Set();
  const requestFrame = window.requestAnimationFrame;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
    requestFrame((time) => {
      animationFrames.add(time);
      callback(time);
    }),
  );
  vi.spyOn(window, "setTimeout");
  // The probe `visibleCells` measures; happy-dom has no layout to size it.
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

describe.each(TOYS.map((toy) => [toy.id]))("%s", (id) => {
  test("presents at most once per animation frame while played", async () => {
    mount(id);
    await play();

    // A toy that rests through the hover sweep leaves the canvas on its idle timer, which presents outside any frame.
    const idleTicks = vi
      .mocked(window.setTimeout)
      .mock.calls.filter(([, ms]) => ms === IDLE_FRAME_MS).length;
    expectExercised(presents());
    expect(presents()).toBeLessThanOrEqual(
      animationFrames.size + idleTicks + 1,
    );
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

    expectExercised(presents() - before);
    expect(softStats.reads).toBe(0);
    expect(allocations.count()).toBe(0);
  });

  test.each(DISPLAYS.map((display) => [display.id]))(
    "on the %s display, writes nothing to the DOM but a press's hold, and reads no computed style, once warmed up",
    async (display) => {
      // A document observer can't see into the canvas's closed shadow root.
      const { shadow } = mountWithShadow(id, {}, display);
      await play();
      const writes: string[] = [];
      const note = (records: MutationRecord[]) => {
        for (const { type, target, attributeName } of records) {
          writes.push(`${type} ${target.nodeName} ${attributeName ?? ""}`);
        }
      };
      const observer = new MutationObserver(note);
      for (const root of [document, shadow]) {
        observer.observe(root, {
          subtree: true,
          attributes: true,
          childList: true,
          characterData: true,
        });
      }
      const styleReads = vi.spyOn(window, "getComputedStyle");

      await play();
      note(observer.takeRecords());
      observer.disconnect();

      const hold = `attributes HTML ${HOLDING}`;
      expect(writes, "DOM writes").toEqual(
        Array.from({ length: PRESSES_PER_PLAY * 2 }, () => hold),
      );
      expect(styleReads, "getComputedStyle calls").not.toHaveBeenCalled();
    },
  );

  // That each present copies to the echo once is the presenter's, whatever the toy draws: presenter.test.ts pins it.
  test("with a pixel shadow, presents reading and allocating nothing", async () => {
    const canvas = mount(id);
    canvas.dataset.shadow = "40";
    await play();
    softStats.reads = 0;
    const before = presents();

    const allocations = countAllocations();
    try {
      await play();
    } finally {
      allocations.restore();
    }

    expectExercised(presents() - before);
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

        expectExercised(presents() - before);
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
