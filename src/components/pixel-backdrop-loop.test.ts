import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BackdropInput, ModeSetup, Pace } from "./backdrop-modes/mode";
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

/**
 * Watches the backdrop's mode: `pace`, when set, replaces Shimmer's own, and
 * `input` is the latest the mode was stepped with.
 */
const probe = vi.hoisted(() => ({
  pace: undefined as Pace | undefined,
  input: undefined as BackdropInput | undefined,
}));

vi.mock("./backdrop-modes", async (importOriginal) => {
  const { MODES } = await importOriginal<typeof import("./backdrop-modes")>();
  return {
    MODES: MODES.map((mode) => ({
      ...mode,
      create(setup: ModeSetup) {
        const instance = mode.create(setup);
        return {
          ...instance,
          step(input: BackdropInput, now: number) {
            probe.input = input;
            instance.step(input, now);
          },
          pace: () => probe.pace ?? instance.pace(),
        };
      },
    })),
  };
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
function shownAt(x: number, y: number) {
  const [image] = context.putImageData.mock.lastCall!;
  return image.data[(y * 64 + x) * 4];
}

/** What the stub's `present()` reports, like a ghost fade still in progress. */
let shadersChanging = false;

class StubCanvas extends HTMLElement {
  width = 64;
  height = 64;
  getContext() {
    return context;
  }
  present() {
    return shadersChanging;
  }
  reset = vi.fn();
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

function movePointer() {
  window.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 100, clientY: 100 }),
  );
}

async function presentsOver(ms: number) {
  const present = vi.spyOn(StubCanvas.prototype, "present");
  present.mockClear();
  await vi.advanceTimersByTimeAsync(ms);
  return present.mock.calls.length;
}

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
  shadersChanging = false;
  probe.pace = undefined;
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("a static frame stops scheduling once settled, and input restarts it", async () => {
  mount();
  await vi.advanceTimersByTimeAsync(1000);
  expect(vi.getTimerCount()).toBe(0);

  window.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 100, clientY: 100 }),
  );
  expect(vi.getTimerCount()).toBeGreaterThan(0);
});

test("a static frame keeps presenting while the canvas is still changing, then stops", async () => {
  shadersChanging = true;
  const present = vi.spyOn(StubCanvas.prototype, "present");
  mount();
  await vi.advanceTimersByTimeAsync(1000);
  expect(present.mock.calls.length).toBeGreaterThan(50);

  shadersChanging = false;
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(0);
});

test("a static frame holds full rate for a fade after input, however long, until it settles", async () => {
  mount();
  await vi.advanceTimersByTimeAsync(1000);
  shadersChanging = true;
  movePointer();
  await vi.advanceTimersByTimeAsync(3000);

  expect(await presentsOver(1000)).toBeGreaterThan(50);

  shadersChanging = false;
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(0);
});

test("with no ghost, a hover cell is drawn once after a move and not on the frames after", async () => {
  mount();
  await vi.advanceTimersByTimeAsync(100);

  movePointer();
  await vi.advanceTimersByTimeAsync(20);
  expect(shownAt(10, 10)).toBe(0);

  await vi.advanceTimersByTimeAsync(50);
  expect(shownAt(10, 10)).toBe(255);
});

test("the noise lifts the base under the mode, which draws on top of it", async () => {
  const backdrop = mount();
  backdrop.configure({ noise: 30 });
  movePointer();
  await vi.advanceTimersByTimeAsync(20);

  expect(shownAt(10, 10)).toBe(0);
  expect(shownAt(40, 40)).toBeLessThan(255);
  expect(shownAt(40, 40)).toBeGreaterThanOrEqual(178);
});

test("once the pointer stops, a static frame goes back to stopped", async () => {
  mount();
  await vi.advanceTimersByTimeAsync(100);

  movePointer();
  await vi.advanceTimersByTimeAsync(50);

  expect(vi.getTimerCount()).toBe(0);
});

test("a drifting frame the canvas never reports settled stays at the idle rate", async () => {
  shadersChanging = true;
  const backdrop = mount();
  backdrop.configure({ noise: 50, noiseSpeed: 50 });
  await vi.advanceTimersByTimeAsync(500);

  expect(await presentsOver(1000)).toBeLessThanOrEqual(8);
});

test("a drifting frame the canvas never reports settled fades at full rate after input, then returns to idle", async () => {
  shadersChanging = true;
  const backdrop = mount();
  backdrop.configure({ noise: 50, noiseSpeed: 50 });
  await vi.advanceTimersByTimeAsync(500);

  movePointer();
  expect(await presentsOver(400)).toBeGreaterThan(20);

  await vi.advanceTimersByTimeAsync(2000);
  for (let second = 0; second < 3; second += 1) {
    expect(await presentsOver(1000)).toBeLessThanOrEqual(8);
  }
});

test("a manual colour scheme change repaints a stopped static frame", async () => {
  mount();
  await vi.advanceTimersByTimeAsync(1000);
  expect(vi.getTimerCount()).toBe(0);

  document.documentElement.style.colorScheme = "dark";
  await Promise.resolve();

  expect(vi.getTimerCount()).toBeGreaterThan(0);
  document.documentElement.style.colorScheme = "";
});

test("a colour scheme flip reseeds the canvas once, and a steady scheme does not", async () => {
  const backdrop = mount();
  const { reset } = backdrop.querySelector(
    "emulated-canvas",
  ) as unknown as StubCanvas;
  await vi.advanceTimersByTimeAsync(200);
  expect(reset).not.toHaveBeenCalled();

  document.documentElement.style.colorScheme = "dark";
  await vi.advanceTimersByTimeAsync(200);
  expect(reset).toHaveBeenCalledTimes(1);
  document.documentElement.style.colorScheme = "";
});

test("configure restarts a stopped loop", async () => {
  const backdrop = mount();
  await vi.advanceTimersByTimeAsync(1000);

  backdrop.configure({ noise: 50, noiseSpeed: 50 });
  await vi.advanceTimersByTimeAsync(1000);

  expect(vi.getTimerCount()).toBeGreaterThan(0);
});

test("a drifting backdrop idles at about eight frames a second", async () => {
  const backdrop = mount();
  backdrop.configure({ noise: 50, noiseSpeed: 50 });
  await vi.advanceTimersByTimeAsync(500);
  const present = vi.spyOn(
    document.querySelector<StubCanvas>("emulated-canvas")!,
    "present",
  );

  await vi.advanceTimersByTimeAsync(1000);

  expect(present.mock.calls.length).toBeGreaterThanOrEqual(6);
  expect(present.mock.calls.length).toBeLessThanOrEqual(8);
});

test("with no ghost, a ripple keeps the loop running until it finishes", async () => {
  mount();
  await vi.advanceTimersByTimeAsync(1000);
  const present = vi.spyOn(
    document.querySelector<StubCanvas>("emulated-canvas")!,
    "present",
  );

  window.dispatchEvent(
    new PointerEvent("pointerdown", { clientX: 100, clientY: 100 }),
  );
  await vi.advanceTimersByTimeAsync(80);
  expect(present.mock.calls.length).toBeGreaterThan(2);

  await vi.advanceTimersByTimeAsync(200);
  expect(vi.getTimerCount()).toBe(0);
});

test("the canvas rect is measured once per resize, not per pointermove", () => {
  mount();
  const measure = vi.spyOn(
    document.querySelector<StubCanvas>("emulated-canvas")!,
    "getBoundingClientRect",
  );
  const move = () =>
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 100, clientY: 100 }),
    );

  move();
  move();
  expect(measure).toHaveBeenCalledTimes(1);

  window.dispatchEvent(new Event("resize"));
  move();
  expect(measure).toHaveBeenCalledTimes(2);
});

test("reduced motion stops all loop work, and turning it off resumes", async () => {
  const backdrop = mount();
  backdrop.configure({ noise: 50, noiseSpeed: 50 });
  await vi.advanceTimersByTimeAsync(500);

  expect(vi.getTimerCount()).toBeGreaterThan(0);
  motion.set(true);
  expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 100, clientY: 100 }),
  );
  expect(vi.getTimerCount()).toBe(0);

  motion.set(false);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
});

test("disabling clears pending work and marks the layer disabled, and enabling resumes", async () => {
  const backdrop = mount();
  backdrop.configure({ noise: 50, noiseSpeed: 50 });
  await vi.advanceTimersByTimeAsync(500);
  expect(vi.getTimerCount()).toBeGreaterThan(0);

  backdrop.configure({ enabled: false });
  expect(vi.getTimerCount()).toBe(0);
  expect(backdrop.hasAttribute("data-disabled")).toBe(true);

  backdrop.configure({ enabled: true });
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  expect(backdrop.hasAttribute("data-disabled")).toBe(false);
});

test("a backdrop removed and re-appended starts its loop again", async () => {
  const backdrop = mount();
  backdrop.configure({ noise: 50, noiseSpeed: 50 });
  await vi.advanceTimersByTimeAsync(500);

  expect(vi.getTimerCount()).toBeGreaterThan(0);
  backdrop.remove();
  expect(vi.getTimerCount()).toBe(0);

  document.body.append(backdrop);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
});

test("an active mode holds full rate over a static frame", async () => {
  probe.pace = "active";
  mount();
  await vi.advanceTimersByTimeAsync(100);

  expect(await presentsOver(1000)).toBeGreaterThan(50);
});

test("an idle mode runs at the idle rate over a static frame, even while the canvas is changing", async () => {
  probe.pace = "idle";
  shadersChanging = true;
  mount();
  await vi.advanceTimersByTimeAsync(1500);

  const presents = await presentsOver(1000);
  expect(presents).toBeGreaterThanOrEqual(6);
  expect(presents).toBeLessThanOrEqual(8);
});

test("a still mode over a static frame stops", async () => {
  probe.pace = "still";
  mount();
  await vi.advanceTimersByTimeAsync(100);

  expect(vi.getTimerCount()).toBe(0);
});

test("the mode is told which cells the viewport shows of the overhanging grid", async () => {
  vi.spyOn(StubCanvas.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(-128, -256, 1280, 1280),
  );
  mount();
  await vi.advanceTimersByTimeAsync(20);

  const cells = (offset: number) => (offset * 64) / 1281;
  expect(probe.input?.visible).toEqual({
    left: cells(128),
    top: cells(256),
    right: cells(window.innerWidth + 128 + 1),
    bottom: cells(window.innerHeight + 256 + 1),
  });
});
