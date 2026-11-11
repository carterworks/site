import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Mode, Pace } from "./backdrop-modes/mode";
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

vi.mock("./emulated-canvas", () => ({}));

/** Rises with x, so a cell's dissolve threshold is its column's rank. */
vi.mock("./backdrop-noise", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./backdrop-noise")>()),
  makeNoise2D: () => (x: number) => x / 1000,
}));

/** What each fake mode has done, and the pace it reports. */
const log = vi.hoisted(() => ({
  created: [] as string[],
  steps: {} as Record<string, number>,
  renders: {} as Record<string, number>,
  pace: {} as Record<string, Pace>,
}));

vi.mock("./backdrop-modes", () => {
  const fill = (id: string, value: number): Mode => ({
    id,
    label: id,
    create() {
      log.created.push(id);
      return {
        step: () => (log.steps[id] = (log.steps[id] ?? 0) + 1),
        render(field) {
          log.renders[id] = (log.renders[id] ?? 0) + 1;
          field.fill(value);
        },
        pace: () => log.pace[id] ?? "still",
      };
    },
  });
  return { MODES: [fill("blank", 0), fill("solid", 1), fill("half", 0.5)] };
});

const context = {
  createImageData: (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }),
  putImageData: vi.fn((_image: ImageData) => {}),
};

/** A cell's red channel in the latest frame: 255 is the light base, 0 the ink. */
function shownAt(x: number, y = 10) {
  const [image] = context.putImageData.mock.lastCall!;
  return image.data[(y * 64 + x) * 4];
}

class StubCanvas extends HTMLElement {
  width = 64;
  height = 64;
  getContext() {
    return context;
  }
  present() {
    return false;
  }
  reset() {}
  getBoundingClientRect() {
    return new DOMRect(0, 0, 640, 640);
  }
}
customElements.define("emulated-canvas", StubCanvas);

function mount() {
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);
  return backdrop;
}

const INK = 0;
const BASE = 255;

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
  const style = document.createElement("style");
  style.textContent = `:root {
    --backdrop-enabled: true; --backdrop-auto-fit: false; --backdrop-scale: 8;
    --backdrop-gap: 1; --backdrop-shape: square; --backdrop-ghost: 0;
    --backdrop-ripple-size: 10; --backdrop-ripple-speed: 100ms;
    --backdrop-noise: 0;
    --backdrop-noise-scale: 4; --backdrop-noise-speed: 0;
    --backdrop-light-base: #fff; --backdrop-light-ink: #000;
    --backdrop-dark-base: #000; --backdrop-dark-ink: #fff;
  }`;
  document.head.append(style);
  log.created = [];
  log.steps = {};
  log.renders = {};
  log.pace = {};
  context.putImageData.mockClear();
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  motion.set(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a mode change", () => {
  test("flips low-threshold cells to the new mode first, leaving the rest on the old", async () => {
    mount().setMode("solid");
    await vi.advanceTimersByTimeAsync(400);

    expect(shownAt(4)).toBe(INK);
    expect(shownAt(60)).toBe(BASE);
  });

  test("ends with only the new mode, releasing the old", async () => {
    mount().setMode("solid");
    await vi.advanceTimersByTimeAsync(900);

    for (const x of [0, 30, 63]) expect(shownAt(x)).toBe(INK);
    const { steps, renders } = log;
    await vi.advanceTimersByTimeAsync(500);
    expect(log.steps.blank).toBe(steps.blank);
    expect(log.renders.blank).toBe(renders.blank);
  });

  test("steps both modes while it runs", async () => {
    mount().setMode("solid");
    await vi.advanceTimersByTimeAsync(400);

    expect(log.steps.blank).toBeGreaterThan(10);
    expect(log.steps.solid).toBeGreaterThan(10);
  });

  test("holds full rate for its length, then follows the new mode's pace", async () => {
    const backdrop = mount();
    await vi.advanceTimersByTimeAsync(100);
    const present = vi.spyOn(StubCanvas.prototype, "present");

    backdrop.setMode("solid");
    await vi.advanceTimersByTimeAsync(700);
    expect(present.mock.calls.length).toBeGreaterThan(35);

    await vi.advanceTimersByTimeAsync(400);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("resumes an idle new mode at the idle rate", async () => {
    log.pace.solid = "idle";
    const backdrop = mount();
    await vi.advanceTimersByTimeAsync(100);
    backdrop.setMode("solid");
    await vi.advanceTimersByTimeAsync(1500);
    const present = vi.spyOn(StubCanvas.prototype, "present");

    await vi.advanceTimersByTimeAsync(1000);

    expect(present.mock.calls.length).toBeLessThanOrEqual(8);
  });

  test("requested mid-dissolve, starts from the mode on its way in and drops the one on its way out", async () => {
    const backdrop = mount();
    backdrop.setMode("solid");
    await vi.advanceTimersByTimeAsync(400);

    backdrop.setMode("half");
    await vi.advanceTimersByTimeAsync(20);

    expect(shownAt(60)).toBe(INK);
    const { steps } = log;
    await vi.advanceTimersByTimeAsync(200);
    expect(log.steps.blank).toBe(steps.blank);

    await vi.advanceTimersByTimeAsync(900);
    expect(shownAt(30)).toBe(127);
  });

  test("to the mode already showing does nothing", async () => {
    const backdrop = mount();
    await vi.advanceTimersByTimeAsync(100);

    backdrop.setMode("blank");

    expect(log.created).toEqual(["blank"]);
    await vi.advanceTimersByTimeAsync(20);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([
    ["under reduced motion", () => motion.set(true)],
    [
      "while disabled",
      (backdrop: HTMLElementTagNameMap["pixel-backdrop"]) =>
        backdrop.configure({ enabled: false }),
    ],
  ])("is instant %s", async (_, disable) => {
    const backdrop = mount();
    await vi.advanceTimersByTimeAsync(100);
    disable(backdrop);

    backdrop.setMode("solid");
    motion.set(false);
    backdrop.configure({ enabled: true });
    await vi.advanceTimersByTimeAsync(20);

    expect(shownAt(60)).toBe(INK);
    expect(log.steps.blank ?? 0).toBeLessThan(10);
  });
});
