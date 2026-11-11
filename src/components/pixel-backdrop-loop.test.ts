import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "./pixel-backdrop";

vi.mock("./emulated-canvas", () => ({}));

const context = {
  fillRect: vi.fn(),
  fillStyle: "",
  createImageData: (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }),
  putImageData: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  stroke: vi.fn(),
};

class StubCanvas extends HTMLElement {
  width = 64;
  height = 64;
  getContext() {
    return context;
  }
  present() {}
  reset = vi.fn();
  getBoundingClientRect() {
    return new DOMRect(0, 0, 640, 640);
  }
}
customElements.define("emulated-canvas", StubCanvas);

type Backdrop = HTMLElement & { configure(options: object): void };

function mount() {
  const backdrop = document.createElement("pixel-backdrop") as Backdrop;
  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);
  return backdrop;
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
    --backdrop-trail: 100ms; --backdrop-ripple-size: 10; --backdrop-ripple-speed: 100ms;
    --backdrop-panel-opacity: 50; --backdrop-panel-blur: 5; --backdrop-noise: 0;
    --backdrop-noise-scale: 4; --backdrop-noise-speed: 0;
    --backdrop-light-base: #fff; --backdrop-light-ink: #000;
    --backdrop-dark-base: #000; --backdrop-dark-ink: #fff;
  }`;
  document.head.append(style);
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.useRealTimers();
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
  const { reset } = backdrop.querySelector("emulated-canvas") as StubCanvas;
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
