import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BackdropInput, Mode, Pace } from "./backdrop-modes/mode";
import type { PixelBackdrop } from "./pixel-backdrop";
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
  const solid: Mode = {
    id: "solid",
    label: "Solid",
    create: () => ({
      step() {},
      render: (field) => field.fill(1),
      pace: () => "still",
    }),
  };
  const watched = MODES.map((mode): Mode => ({
    ...mode,
    create(setup) {
      const instance = mode.create(setup);
      return {
        ...instance,
        step(input, now) {
          probe.input = input;
          instance.step(input, now);
        },
        pace: () => probe.pace ?? instance.pace(),
      };
    },
  }));
  return { MODES: [...watched, solid] };
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
  Object.defineProperty(document, "caretPositionFromPoint", {
    value: () => null,
    configurable: true,
  });
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
  motion.set(false);
  Reflect.deleteProperty(document, "caretPositionFromPoint");
  getSelection()?.removeAllRanges();
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

test("setMode switches to another mode, and ignores an unknown id", async () => {
  const backdrop = mount();
  await vi.advanceTimersByTimeAsync(100);
  expect(shownAt(40, 40)).toBe(255);

  backdrop.setMode("solid");
  await vi.advanceTimersByTimeAsync(1000);
  expect(shownAt(40, 40)).toBe(0);

  backdrop.setMode("missing");
  await vi.advanceTimersByTimeAsync(20);
  expect(shownAt(40, 40)).toBe(0);
});

const press = (target: EventTarget, init: PointerEventInit = {}) =>
  target.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      isPrimary: true,
      pointerType: "mouse",
      clientX: 100,
      clientY: 100,
      ...init,
    }),
  );

async function latestInput() {
  await vi.advanceTimersByTimeAsync(50);
  return probe.input!;
}

test("a press in empty space reaches the mode as held", async () => {
  mount();
  press(document.body);

  expect((await latestInput()).press).toMatchObject({ held: true });
});

test("a press on a link or on text never reaches the mode", async () => {
  mount();
  const link = document.createElement("a");
  document.body.append(link);
  press(link);
  expect((await latestInput()).press).toBeUndefined();

  const text = document.createTextNode("words");
  Object.defineProperty(document, "caretPositionFromPoint", {
    value: () => ({ offsetNode: text, offset: 0 }),
    configurable: true,
  });
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([
    new DOMRect(0, 0, 200, 200),
  ] as unknown as DOMRectList);
  press(document.body);
  expect((await latestInput()).press).toBeUndefined();
});

test.each([
  ["pointerup", () => window.dispatchEvent(new PointerEvent("pointerup"))],
  [
    "pointercancel",
    () => window.dispatchEvent(new PointerEvent("pointercancel")),
  ],
  ["window blur", () => window.dispatchEvent(new Event("blur"))],
])("the hold ends on %s", async (_, end) => {
  mount();
  press(document.body);
  expect((await latestInput()).press?.held).toBe(true);

  end();

  expect((await latestInput()).press?.held).toBe(false);
});

const NO_SELECT = "data-backdrop-holding";
const holding = () => document.documentElement.hasAttribute(NO_SELECT);
const backdropElement = () => document.querySelector("pixel-backdrop")!;

test("a touch tap is a press already released, so a toy sees one burst", async () => {
  mount();
  press(document.body, { pointerType: "touch" });
  window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch" }));

  expect((await latestInput()).press).toMatchObject({ held: false });
  expect(holding()).toBe(false);
});

test("a press in empty space suppresses text selection", () => {
  mount();

  press(document.body);

  expect(holding()).toBe(true);
});

test.each([
  ["pointerup", () => window.dispatchEvent(new PointerEvent("pointerup"))],
  [
    "pointercancel",
    () => window.dispatchEvent(new PointerEvent("pointercancel")),
  ],
  ["window blur", () => window.dispatchEvent(new Event("blur"))],
  ["a mode switch", () => backdropElement().setMode("solid")],
  ["disconnect", () => backdropElement().remove()],
  ["disable", () => backdropElement().configure({ enabled: false })],
])("selection is restored on %s", (_, end) => {
  mount();
  press(document.body);

  end();

  expect(holding()).toBe(false);
});

test("a press in empty space clears a selection already begun", () => {
  mount();
  const paragraph = document.createElement("p");
  paragraph.textContent = "words";
  document.body.append(paragraph);
  getSelection()!.selectAllChildren(paragraph);

  press(document.body);

  expect(getSelection()!.isCollapsed).toBe(true);
});

test("a selection appearing does not end the hold", async () => {
  mount();
  press(document.body);
  const paragraph = document.createElement("p");
  paragraph.textContent = "words";
  document.body.append(paragraph);
  getSelection()!.selectAllChildren(paragraph);
  document.dispatchEvent(new Event("selectionchange"));

  expect((await latestInput()).press?.held).toBe(true);
});

test("a press on a link never suppresses selection", () => {
  mount();
  const link = document.createElement("a");
  document.body.append(link);

  press(link);

  expect(holding()).toBe(false);
});

const FINGER = 7;

const fingerDown = (target: EventTarget = document.body) =>
  press(target, { pointerType: "touch", pointerId: FINGER });

const finger = (type: string, init: PointerEventInit = {}) =>
  window.dispatchEvent(
    new PointerEvent(type, {
      pointerType: "touch",
      pointerId: FINGER,
      clientX: 100,
      clientY: 100,
      ...init,
    }),
  );

/** Whether the page's scroll for a touchmove would be blocked. */
function scrollBlocked() {
  const move = new TouchEvent("touchmove", { bubbles: true, cancelable: true });
  document.body.dispatchEvent(move);
  return move.defaultPrevented;
}

const touchEnd = (type: string) =>
  document.body.dispatchEvent(new TouchEvent(type, { bubbles: true }));

test("a touch in empty space grabs at once: its first move is blocked and its drag reaches the mode as the pointer", async () => {
  mount();
  fingerDown();

  expect(scrollBlocked()).toBe(true);
  finger("pointermove", { clientX: 200, clientY: 300 });

  const input = await latestInput();
  expect(input.press).toMatchObject({ held: true });
  expect(input.pointer).toEqual({
    x: expect.closeTo(20, 0),
    y: expect.closeTo(30, 0),
  });
  expect(holding()).toBe(true);
});

test("a grabbed touch blocks the page's scroll until it is released", () => {
  mount();
  fingerDown();
  expect(scrollBlocked()).toBe(true);

  finger("pointerup");

  expect(scrollBlocked()).toBe(false);
});

test("a touch on a link or on text never grabs, so the page scrolls", async () => {
  mount();
  const link = document.createElement("a");
  document.body.append(link);
  fingerDown(link);
  expect(scrollBlocked()).toBe(false);
  finger("pointerup");

  const text = document.createTextNode("words");
  Object.defineProperty(document, "caretPositionFromPoint", {
    value: () => ({ offsetNode: text, offset: 0 }),
    configurable: true,
  });
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([
    new DOMRect(0, 0, 200, 200),
  ] as unknown as DOMRectList);
  fingerDown();

  expect(scrollBlocked()).toBe(false);
  expect((await latestInput()).press).toBeUndefined();
});

const touchHoldEnds: [string, () => void][] = [
  ["pointerup", () => finger("pointerup")],
  ["pointercancel", () => finger("pointercancel")],
  ["touchend", () => touchEnd("touchend")],
  ["touchcancel", () => touchEnd("touchcancel")],
  ["window blur", () => window.dispatchEvent(new Event("blur"))],
  ["a mode switch", () => backdropElement().setMode("pond")],
  ["disconnect", () => backdropElement().remove()],
  ["disable", () => backdropElement().configure({ enabled: false })],
  [
    "a navigation",
    () => document.dispatchEvent(new Event("astro:before-swap")),
  ],
];

test.each(touchHoldEnds)("%s lets go of a grabbed touch", async (_, end) => {
  mount();
  fingerDown();
  await latestInput();

  end();

  expect(scrollBlocked()).toBe(false);
  expect(holding()).toBe(false);
  expect(probe.input!.press?.held).not.toBe(true);
});

test.each([
  [
    "disabled",
    (backdrop: PixelBackdrop) => backdrop.configure({ enabled: false }),
  ],
  ["under reduced motion", () => motion.set(true)],
])("a backdrop %s grabs nothing, so the page scrolls", async (_, stop) => {
  const backdrop = mount();
  stop(backdrop);

  press(document.body);
  fingerDown();

  expect(scrollBlocked()).toBe(false);
  expect(holding()).toBe(false);
});

test("reduced motion turning on lets go of a grabbed touch", async () => {
  mount();
  fingerDown();

  motion.set(true);

  expect(scrollBlocked()).toBe(false);
  expect(holding()).toBe(false);
});

test("a second finger lifting does not let go of a grabbed touch", async () => {
  mount();
  fingerDown();

  document.body.dispatchEvent(
    new TouchEvent("touchend", {
      bubbles: true,
      touches: [new Touch({ identifier: 0, target: document.body })],
    }),
  );
  finger("pointerup", { pointerId: FINGER + 1 });

  expect(scrollBlocked()).toBe(true);
});

test("a mode requested before the canvas exists applies once it arrives", async () => {
  const backdrop = document.createElement("pixel-backdrop");
  document.body.append(backdrop);
  backdrop.setMode("solid");

  backdrop.append(document.createElement("emulated-canvas"));
  await vi.advanceTimersByTimeAsync(100);

  expect(shownAt(40, 40)).toBe(0);
});

test("a press from before a mode switch never reaches the new mode", async () => {
  const backdrop = mount();
  press(document.body);
  await latestInput();

  backdrop.setMode("pond");

  expect((await latestInput()).press).toBeUndefined();
});

test("a second finger lifting does not end the first finger's hold", async () => {
  mount();
  press(document.body, { pointerId: 1 });

  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2 }));
  expect((await latestInput()).press?.held).toBe(true);

  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
  expect((await latestInput()).press?.held).toBe(false);
});

test.each([
  ["a resize", () => window.dispatchEvent(new Event("resize"))],
  [
    "the pointer leaving",
    () => document.dispatchEvent(new Event("mouseleave")),
  ],
])("%s wakes a settled loop", async (_, trigger) => {
  mount();
  await vi.advanceTimersByTimeAsync(1000);
  expect(vi.getTimerCount()).toBe(0);

  trigger();

  expect(vi.getTimerCount()).toBeGreaterThan(0);
});

/** Mounts a backdrop with the markup's small-viewport probe, measuring `rect`. */
function mountWithSmallViewport(rect: DOMRect) {
  vi.spyOn(StubCanvas.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1280, 1280),
  );
  const shown = document.createElement("div");
  shown.className = "small-viewport";
  const measure = vi
    .spyOn(shown, "getBoundingClientRect")
    .mockReturnValue(rect);
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.append(document.createElement("emulated-canvas"), shown);
  document.body.append(backdrop);
  return measure;
}

const cells = (offset: number) => (offset * 64) / 1281;

test("the mode is told the cells the small viewport shows, not the whole layer", async () => {
  mountWithSmallViewport(new DOMRect(0, 47, 390, 600));
  await vi.advanceTimersByTimeAsync(20);

  expect(probe.input?.visible).toEqual({
    left: 0,
    top: cells(47),
    right: cells(390 + 1),
    bottom: cells(647 + 1),
  });
});

test("the visual viewport resizing or scrolling, as toolbars and pinch-zoom do, never refits the toys", async () => {
  const viewport = new EventTarget();
  vi.stubGlobal("visualViewport", viewport);
  const measure = mountWithSmallViewport(new DOMRect(0, 0, 390, 600));
  await vi.advanceTimersByTimeAsync(20);
  const before = probe.input?.visible;

  viewport.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("scroll"));
  await vi.advanceTimersByTimeAsync(20);

  expect(measure).toHaveBeenCalledTimes(1);
  expect(probe.input?.visible).toEqual(before);
  vi.unstubAllGlobals();
});

test("a window resize refits the toys to the new small viewport", async () => {
  const measure = mountWithSmallViewport(new DOMRect(0, 0, 390, 600));
  await vi.advanceTimersByTimeAsync(20);

  measure.mockReturnValue(new DOMRect(0, 0, 600, 390));
  window.dispatchEvent(new Event("resize"));
  await vi.advanceTimersByTimeAsync(20);

  expect(probe.input?.visible.right).toBeCloseTo(cells(600 + 1));
  expect(probe.input?.visible.bottom).toBeCloseTo(cells(390 + 1));
});
