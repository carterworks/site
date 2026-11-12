import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installBackdropDefaults } from "../test/backdrop-defaults";
import { installSoftCanvas, useFakeFrames } from "../test/toy-canvas";
import type { Toy } from "./backdrop-modes/toy";
import { EmulatedCanvas } from "./emulated-canvas";
import { DISPLAYS } from "./backdrop-displays";
import { readDefaults, type PixelBackdrop } from "./pixel-backdrop";

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

/** What the probe toys saw: each event the canvas passed them, and each start and stop. */
const seen = vi.hoisted(() => ({
  events: [] as { toy: string; event: PointerEvent }[],
  log: [] as string[],
}));

vi.mock("./backdrop-modes", () => {
  const probe = (id: string, look?: Toy["look"]): Toy => ({
    id,
    label: id,
    look,
    start(canvas) {
      seen.log.push(`start ${id}`);
      const record = (event: Event) =>
        seen.events.push({ toy: id, event: event as PointerEvent });
      const types = [
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
        "pointerleave",
      ];
      for (const type of types) canvas.addEventListener(type, record);
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return () => {
        seen.log.push(`stop ${id}`);
        for (const type of types) canvas.removeEventListener(type, record);
      };
    },
  });
  return { MODES: [probe("probe"), probe("tuned", { ghost: 55, noise: 12 })] };
});

beforeEach(() => {
  useFakeFrames();
  installSoftCanvas();
  installBackdropDefaults();
  seen.events = [];
  seen.log = [];
});

afterEach(() => {
  motion.set(false);
  getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  document.head.replaceChildren();
  document.documentElement.removeAttribute("style");
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const backdrop = document.createElement("pixel-backdrop");
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, { width: "160", height: "160" });
  backdrop.append(canvas);
  document.body.append(backdrop);
  return backdrop;
}

const canvasOf = (backdrop: PixelBackdrop) =>
  backdrop.querySelector("emulated-canvas")!;

const types = () => seen.events.map(({ event }) => event.type);

const press = (target: EventTarget, init: PointerEventInit = {}) =>
  target.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      isPrimary: true,
      pointerType: "mouse",
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      ...init,
    }),
  );

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

const holding = () =>
  document.documentElement.hasAttribute("data-backdrop-holding");

test("a hover is passed to the toy on the canvas with what a plain canvas's event carries", () => {
  mount();

  window.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 12,
      clientY: 34,
      pointerId: 3,
      pointerType: "pen",
      buttons: 0,
      isPrimary: true,
    }),
  );

  expect(seen.events).toHaveLength(1);
  expect(seen.events[0].event).toMatchObject({
    type: "pointermove",
    clientX: 12,
    clientY: 34,
    pointerId: 3,
    pointerType: "pen",
    buttons: 0,
    isPrimary: true,
    bubbles: false,
  });
});

test("touch has no hover: a finger's moves reach the toy only while it holds a grab", () => {
  mount();
  finger("pointermove");
  expect(seen.events).toEqual([]);

  fingerDown();
  finger("pointermove", { clientX: 200 });
  finger("pointermove", { clientX: 220, pointerId: FINGER + 1 });

  expect(types()).toEqual(["pointerdown", "pointermove"]);
  expect(seen.events[1].event.clientX).toBe(200);
});

test("a press in the open reaches the toy, suppresses selection and clears one already begun", () => {
  mount();
  const paragraph = document.createElement("p");
  paragraph.textContent = "words";
  document.body.append(paragraph);
  getSelection()!.selectAllChildren(paragraph);

  press(document.body);

  expect(types()).toEqual(["pointerdown"]);
  expect(holding()).toBe(true);
  expect(getSelection()!.isCollapsed).toBe(true);
});

test.each(["a", "main", "header", "button"])(
  "a press on %s never reaches the toy, grabs or suppresses selection",
  (tag) => {
    mount();
    const content = document.createElement(tag);
    document.body.append(content);

    press(content);
    fingerDown(content);

    expect(seen.events).toEqual([]);
    expect(holding()).toBe(false);
    expect(scrollBlocked()).toBe(false);
  },
);

test("the hold's own pointerup reaches the toy and ends it, and another pointer's does not", () => {
  mount();
  press(document.body, { pointerId: 1 });

  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2 }));
  expect(holding()).toBe(true);

  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
  expect(types()).toEqual(["pointerdown", "pointerup"]);
  expect(holding()).toBe(false);
});

test("a grabbed touch blocks the page's scroll from its first move until it lifts", () => {
  mount();
  fingerDown();
  expect(scrollBlocked()).toBe(true);

  finger("pointerup");

  expect(scrollBlocked()).toBe(false);
  expect(types()).toEqual(["pointerdown", "pointerup"]);
});

const backdropElement = () => document.querySelector("pixel-backdrop")!;

test.each<[string, () => void]>([
  ["pointercancel", () => finger("pointercancel")],
  [
    "touchend",
    () =>
      document.body.dispatchEvent(
        new TouchEvent("touchend", { bubbles: true }),
      ),
  ],
  [
    "touchcancel",
    () =>
      document.body.dispatchEvent(
        new TouchEvent("touchcancel", { bubbles: true }),
      ),
  ],
  ["window blur", () => window.dispatchEvent(new Event("blur"))],
  [
    "a navigation",
    () => document.dispatchEvent(new Event("astro:before-swap")),
  ],
  ["a toy change", () => backdropElement().setMode("tuned")],
  ["disconnect", () => backdropElement().remove()],
  ["disable", () => backdropElement().configure({ enabled: false })],
  ["reduced motion", () => motion.set(true)],
])(
  "%s lets go of a grabbed touch, and the toy hears it as a pointercancel",
  (_, end) => {
    mount();
    fingerDown();

    end();

    expect(scrollBlocked()).toBe(false);
    expect(holding()).toBe(false);
    expect(types()).toEqual(["pointerdown", "pointercancel"]);
    expect(seen.events[1].event).toMatchObject({
      pointerId: FINGER,
      pointerType: "touch",
    });
  },
);

test("a second finger lifting does not let go of a grabbed touch", () => {
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

test("the pointer leaving the page reaches the toy as a pointerleave", () => {
  mount();

  document.dispatchEvent(new MouseEvent("mouseleave"));

  expect(types()).toEqual(["pointerleave"]);
});

test.each<[string, (backdrop: PixelBackdrop) => void]>([
  ["disabled", (backdrop) => backdrop.configure({ enabled: false })],
  ["under reduced motion", () => motion.set(true)],
])(
  "a backdrop %s passes nothing on and grabs nothing, so the page scrolls",
  (_, stop) => {
    stop(mount());

    window.dispatchEvent(new PointerEvent("pointermove"));
    press(document.body);
    fingerDown();
    document.dispatchEvent(new MouseEvent("mouseleave"));

    expect(seen.events).toEqual([]);
    expect(scrollBlocked()).toBe(false);
    expect(holding()).toBe(false);
  },
);

test("the chosen toy runs while the backdrop is connected, enabled and in motion", () => {
  const backdrop = mount();
  backdrop.configure({ enabled: false });
  backdrop.configure({ enabled: true });
  motion.set(true);
  motion.set(false);
  backdrop.remove();
  document.body.append(backdrop);

  expect(seen.log).toEqual([
    "start probe",
    "stop probe",
    "start probe",
    "stop probe",
    "start probe",
    "stop probe",
    "start probe",
  ]);
});

test("setMode stops the toy, dissolves the canvas and starts the next, and ignores an unknown or the same id", () => {
  const transition = vi.spyOn(EmulatedCanvas.prototype, "transition");
  const backdrop = mount();

  backdrop.setMode("tuned");
  backdrop.setMode("tuned");
  backdrop.setMode("missing");

  expect(backdrop.mode).toBe("tuned");
  expect(seen.log).toEqual(["start probe", "stop probe", "start tuned"]);
  expect(transition).toHaveBeenCalledTimes(1);
});

const unlisted: Toy = {
  id: "unlisted",
  label: "Unlisted",
  start(canvas) {
    seen.log.push("start unlisted");
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    return () => seen.log.push("stop unlisted");
  },
};

test("play dissolves into a toy outside the registry, and setMode swaps back", () => {
  const transition = vi.spyOn(EmulatedCanvas.prototype, "transition");
  const backdrop = mount();

  backdrop.play(unlisted);

  expect(backdrop.mode).toBe("unlisted");
  expect(transition).toHaveBeenCalledTimes(1);

  backdrop.setMode("tuned");

  expect(backdrop.mode).toBe("tuned");
  expect(seen.log).toEqual([
    "start probe",
    "stop probe",
    "start unlisted",
    "stop unlisted",
    "start tuned",
  ]);
});

test("a toy played under reduced motion starts once motion resumes", () => {
  motion.set(true);
  const backdrop = mount();

  backdrop.play(unlisted);
  expect(seen.log).toEqual([]);

  motion.set(false);

  expect(seen.log).toEqual(["start unlisted"]);
});

test("a toy chosen while none runs starts once one can, with no dissolve", async () => {
  const transition = vi.spyOn(EmulatedCanvas.prototype, "transition");
  const backdrop = document.createElement("pixel-backdrop");
  document.body.append(backdrop);
  backdrop.setMode("tuned");

  const canvas = document.createElement("emulated-canvas");
  backdrop.append(canvas);
  await Promise.resolve();

  expect(backdrop.mode).toBe("tuned");
  expect(seen.log).toEqual(["start tuned"]);
  expect(transition).not.toHaveBeenCalled();
});

test("a toy chosen under reduced motion shows its own look once motion resumes", () => {
  motion.set(true);
  const backdrop = mount();
  backdrop.setMode("tuned");

  motion.set(false);

  expect(canvasOf(backdrop).dataset).toMatchObject({
    ghost: "55",
    noise: "12",
  });
});

test("a stopped backdrop leaves its canvas manual, so no fade or drift keeps presenting", () => {
  const backdrop = mount();
  const canvas = canvasOf(backdrop);
  expect(canvas.dataset.manual).toBeUndefined();

  backdrop.configure({ enabled: false });

  expect(canvas.dataset.manual).toBe("");
  expect(backdrop.hasAttribute("data-disabled")).toBe(true);
});

test("the canvas is coloured in the scheme's palette, and a manual flip restarts its passes once", async () => {
  const reset = vi.spyOn(EmulatedCanvas.prototype, "reset");
  const backdrop = mount();
  const canvas = canvasOf(backdrop);
  const { lightBase, lightInk, darkBase, darkInk } = backdrop.options;
  expect(canvas.dataset).toMatchObject({
    paletteBase: lightBase,
    paletteInk: lightInk,
  });

  document.documentElement.style.colorScheme = "dark";
  await Promise.resolve();
  document.documentElement.style.setProperty("--unrelated", "1");
  await Promise.resolve();

  expect(canvas.dataset).toMatchObject({
    paletteBase: darkBase,
    paletteInk: darkInk,
  });
  expect(reset).toHaveBeenCalledTimes(1);
});

test("a toy's look sets the canvas's ghost and noise, and a configured knob wins in every toy until reset", () => {
  const backdrop = mount();
  const canvas = canvasOf(backdrop);
  const defaults = readDefaults();
  expect(canvas.dataset.ghost).toBe(String(defaults.ghost));

  backdrop.setMode("tuned");
  expect(canvas.dataset).toMatchObject({ ghost: "55", noise: "12" });
  expect(backdrop.look).toEqual({ ghost: 55, noise: 12 });

  backdrop.configure({ ghost: 30 });
  expect(canvas.dataset.ghost).toBe("30");
  expect(backdrop.look.ghost).toBe(30);

  backdrop.reset();
  expect(canvas.dataset.ghost).toBe("55");
});

test("the noise's feature size reaches the canvas in its own pixels, scaled from the tuned width", () => {
  const backdrop = mount();
  backdrop.configure({ noiseScale: 15, noiseSpeed: 7 });

  expect(canvasOf(backdrop).dataset).toMatchObject({
    noiseScale: "30",
    noiseSpeed: "7",
  });
});

test("a tweaked knob is set on the canvas as its custom property, for a toy to read, until reset", () => {
  const backdrop = mount();
  const canvas = canvasOf(backdrop);

  backdrop.configure({ rippleSize: 9 });
  expect(canvas.style.getPropertyValue("--backdrop-ripple-size")).toBe("9");

  backdrop.reset();
  expect(canvas.style.getPropertyValue("--backdrop-ripple-size")).toBe("");
});

test("reset restores the stylesheet defaults after a knob was tweaked", () => {
  const style = document.createElement("style");
  style.textContent = ":root { --backdrop-ghost: 40%; }";
  document.head.append(style);
  const backdrop = mount();

  backdrop.configure({ ghost: 70 });
  backdrop.reset();

  expect(backdrop.options).toMatchObject({ ghost: 40 });
});

test("a reconnected backdrop keeps its tweaks", () => {
  const backdrop = mount();
  backdrop.configure({ ghost: 20 });

  backdrop.remove();
  document.body.append(backdrop);

  expect(backdrop.options.ghost).toBe(20);
});

test("auto-fit tiles the viewport's larger side with whole strides of the grid, the gap taken out of each", () => {
  const backdrop = mount();
  backdrop.configure({ autoFit: true, gap: 2 });

  expect(
    canvasOf(backdrop).style.getPropertyValue("--emulated-canvas-scale"),
  ).toBe("max(1px, round(up, max(100lvw, 100lvh) / 160, 1px) - 2px)");
});

const pocket = DISPLAYS[1].look!;

test("a display colours the canvas and the screen behind it in its own palette, and Site restores the scheme's", () => {
  const backdrop = mount();
  const canvas = canvasOf(backdrop);
  const { lightBase, lightInk } = backdrop.options;

  backdrop.setDisplay("pocket-lcd");

  expect(backdrop.display).toBe("pocket-lcd");
  expect(backdrop.dataset.display).toBe("pocket-lcd");
  expect(canvas.dataset).toMatchObject({
    paletteBase: pocket.base,
    paletteInk: pocket.ink,
    paletteLevels: String(pocket.levels),
  });
  expect(backdrop.style.getPropertyValue("--backdrop-display-screen")).toBe(
    pocket.screen,
  );

  backdrop.setDisplay("site");

  expect(backdrop.display).toBe("site");
  expect(canvas.dataset).toMatchObject({
    paletteBase: lightBase,
    paletteInk: lightInk,
  });
  expect(canvas.dataset.paletteLevels).toBeUndefined();
  expect(backdrop.style.getPropertyValue("--backdrop-display-screen")).toBe("");
});

test("a display paints its grid in its own colour, and one without a grid or Site leaves the gaps the screen's", () => {
  const backdrop = mount();
  const grid = () => backdrop.style.getPropertyValue("--backdrop-display-grid");

  backdrop.setDisplay("pocket-lcd");
  expect(grid()).toBe(pocket.grid);
  expect(pocket.grid).toBeDefined();

  backdrop.setDisplay("amber-lcd");
  expect(grid()).toBe("");

  backdrop.setDisplay("pocket-lcd");
  backdrop.setDisplay("site");
  expect(grid()).toBe("");
});

test("an unknown display is ignored", () => {
  const backdrop = mount();

  backdrop.setDisplay("missing");

  expect(backdrop.display).toBe("site");
});

test("a display restarts the canvas's passes once when its palette changes, and a scheme flip does not", async () => {
  const reset = vi.spyOn(EmulatedCanvas.prototype, "reset");
  const backdrop = mount();

  backdrop.setDisplay("pocket-lcd");
  expect(reset).toHaveBeenCalledTimes(1);

  document.documentElement.style.colorScheme = "dark";
  await Promise.resolve();

  expect(reset).toHaveBeenCalledTimes(1);
  expect(canvasOf(backdrop).dataset.paletteBase).toBe(pocket.base);
});

test("a palette knob set through configure outranks the display's", () => {
  const backdrop = mount();
  backdrop.setDisplay("pocket-lcd");

  backdrop.configure({ lightBase: "#123456" });

  expect(canvasOf(backdrop).dataset).toMatchObject({
    paletteBase: "#123456",
    paletteInk: pocket.ink,
  });
});

test("a display's look reaches the canvas, and Site gives back the look it had", () => {
  const backdrop = mount();
  backdrop.setMode("tuned");
  const canvas = canvasOf(backdrop);
  const defaults = readDefaults();

  backdrop.setDisplay("pocket-lcd");

  expect(canvas.dataset).toMatchObject({
    gap: String(pocket.gap),
    shape: pocket.shape,
    ghost: "55",
    ghostRise: String(pocket.ghostRise),
    ghostFall: String(pocket.ghostFall),
    noise: String(pocket.noise),
    shadow: String(pocket.shadow.opacity),
    shadowX: String(pocket.shadow.x),
    shadowY: String(pocket.shadow.y),
  });
  expect(backdrop.look.noise).toBe(pocket.noise);

  backdrop.setDisplay("site");

  expect(canvas.dataset).toMatchObject({
    gap: String(defaults.gap),
    shape: defaults.shape,
    ghost: "55",
    noise: "12",
  });
  for (const key of [
    "ghostRise",
    "ghostFall",
    "shadow",
    "shadowX",
    "shadowY",
  ]) {
    expect(canvas.dataset[key]).toBeUndefined();
  }
});

test("a knob set through configure outranks the display's", () => {
  const backdrop = mount();
  const canvas = canvasOf(backdrop);
  backdrop.setDisplay("pocket-lcd");

  backdrop.configure({ gap: 5, shape: "circle", noise: 30 });
  expect(canvas.dataset).toMatchObject({
    gap: "5",
    shape: "circle",
    noise: "30",
  });

  backdrop.configure({ ghost: 20 });
  expect(canvas.dataset.ghost).toBe("20");
  expect(canvas.dataset.ghostRise).toBeUndefined();
  expect(canvas.dataset.ghostFall).toBeUndefined();
});

test("auto-fit takes the effective gap out of each stride", () => {
  const backdrop = mount();
  const scale = () =>
    canvasOf(backdrop).style.getPropertyValue("--emulated-canvas-scale");
  backdrop.configure({ autoFit: true });
  backdrop.setDisplay("pocket-lcd");
  expect(scale()).toContain(`) - ${pocket.gap}px)`);

  backdrop.configure({ gap: 5 });
  expect(scale()).toContain(") - 5px)");
});

test("a stored display is on the canvas before the toy first draws, without a restart", () => {
  localStorage.setItem("backdrop-display", "pocket-lcd");
  const reset = vi.spyOn(EmulatedCanvas.prototype, "reset");
  const canvas = document.createElement("emulated-canvas");
  const getContext = canvas.getContext.bind(canvas);
  let paletteAtDraw: string | undefined;
  vi.spyOn(canvas, "getContext").mockImplementation(((id: "2d") => {
    paletteAtDraw = canvas.dataset.paletteBase;
    return getContext(id);
  }) as typeof canvas.getContext);
  const backdrop = document.createElement("pixel-backdrop");

  backdrop.append(canvas);
  document.body.append(backdrop);

  expect(backdrop.display).toBe("pocket-lcd");
  expect(paletteAtDraw).toBe(pocket.base);
  expect(reset).not.toHaveBeenCalled();
});

test("a display chosen before the backdrop attaches outranks the stored one", () => {
  localStorage.setItem("backdrop-display", "pocket-lcd");
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.setDisplay("site");

  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);

  expect(backdrop.display).toBe("site");
});
