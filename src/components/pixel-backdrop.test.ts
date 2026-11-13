import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installBackdropDefaults } from "../test/backdrop-defaults";
import { installSoftCanvas, useFakeFrames } from "../test/toy-canvas";
import type { Toy } from "./backdrop-toys/toy";
import { EmulatedCanvas } from "./emulated-canvas/element";
import { DISPLAYS } from "./backdrop-displays";
import "./pixel-backdrop";
import type { PixelBackdrop } from "./pixel-backdrop";
import { readDefaults } from "./pixel-backdrop/knobs";

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

vi.mock("./backdrop-toys", () => {
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
  return { TOYS: [probe("probe"), probe("tuned", { ghost: 55, noise: 12 })] };
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

/** Whether the page's scroll for a touchmove would be blocked. */
function scrollBlocked() {
  const move = new TouchEvent("touchmove", { bubbles: true, cancelable: true });
  document.body.dispatchEvent(move);
  return move.defaultPrevented;
}

const holding = () =>
  document.documentElement.hasAttribute("data-backdrop-holding");

const backdropElement = () => document.querySelector("pixel-backdrop")!;

test.each<[string, () => void]>([
  ["a toy change", () => backdropElement().setToy("tuned")],
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

test("a disconnected backdrop relays nothing, and relays again once reconnected", () => {
  const backdrop = mount();
  backdrop.remove();

  press(document.body);
  fingerDown();
  expect(seen.events).toEqual([]);
  expect(scrollBlocked()).toBe(false);
  expect(holding()).toBe(false);

  document.body.append(backdrop);
  press(document.body);

  expect(types()).toEqual(["pointerdown"]);
  expect(holding()).toBe(true);
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

test("setToy stops the toy, dissolves the canvas and starts the next, and ignores an unknown or the same id", () => {
  const transition = vi.spyOn(EmulatedCanvas.prototype, "transition");
  const backdrop = mount();

  backdrop.setToy("tuned");
  backdrop.setToy("tuned");
  backdrop.setToy("missing");

  expect(backdrop.toy).toBe("tuned");
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

test("play dissolves into a toy outside the registry, and setToy swaps back", () => {
  const transition = vi.spyOn(EmulatedCanvas.prototype, "transition");
  const backdrop = mount();

  backdrop.play(unlisted);

  expect(backdrop.toy).toBe("unlisted");
  expect(transition).toHaveBeenCalledTimes(1);

  backdrop.setToy("tuned");

  expect(backdrop.toy).toBe("tuned");
  expect(seen.log).toEqual([
    "start probe",
    "stop probe",
    "start unlisted",
    "stop unlisted",
    "start tuned",
  ]);
});

test("a toy whose start throws leaves nothing running, and the next toy starts as usual", () => {
  const broken: Toy = {
    id: "broken",
    label: "Broken",
    start() {
      throw new Error("broken");
    },
  };
  const backdrop = mount();

  expect(() => backdrop.play(broken)).toThrow("broken");
  fingerDown();
  expect(scrollBlocked()).toBe(false);
  expect(holding()).toBe(false);

  backdrop.setToy("tuned");
  expect(seen.log).toEqual(["start probe", "stop probe", "start tuned"]);
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
  backdrop.setToy("tuned");

  const canvas = document.createElement("emulated-canvas");
  backdrop.append(canvas);
  await Promise.resolve();

  expect(backdrop.toy).toBe("tuned");
  expect(seen.log).toEqual(["start tuned"]);
  expect(transition).not.toHaveBeenCalled();
});

test("a toy chosen under reduced motion shows its own look once motion resumes", () => {
  motion.set(true);
  const backdrop = mount();
  backdrop.setToy("tuned");

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
  const { lightBase, lightInk, darkBase, darkInk } = backdrop.knobs;
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

  backdrop.setToy("tuned");
  expect(canvas.dataset).toMatchObject({ ghost: "55", noise: "12" });
  expect(backdrop.knobs).toMatchObject({ ghost: 55, noise: 12 });

  backdrop.configure({ ghost: 30 });
  expect(canvas.dataset.ghost).toBe("30");
  expect(backdrop.knobs.ghost).toBe(30);

  backdrop.reset();
  expect(canvas.dataset.ghost).toBe("55");
});

test("reset restores the stylesheet defaults after a knob was tweaked", () => {
  const style = document.createElement("style");
  style.textContent = ":root { --backdrop-ghost: 40%; }";
  document.head.append(style);
  const backdrop = mount();

  backdrop.configure({ ghost: 70 });
  backdrop.reset();

  expect(backdrop.knobs).toMatchObject({ ghost: 40 });
  expect(backdrop.tweaks).toEqual({});
});

test("a reconnected backdrop keeps its tweaks", () => {
  const backdrop = mount();
  backdrop.configure({ ghost: 20 });

  backdrop.remove();
  document.body.append(backdrop);

  expect(backdrop.tweaks).toEqual({ ghost: 20 });
});

const pocket = DISPLAYS[1].look!;

test("on a display, the knobs in effect are the display's, with the noise stopped and the toy's own ghost", () => {
  const backdrop = mount();
  backdrop.setToy("tuned");

  backdrop.setDisplay("pocket-lcd");

  expect(backdrop.knobs).toMatchObject({
    gap: pocket.gap,
    shape: "square",
    lightBase: pocket.base,
    ghost: 55,
    noise: 0,
  });
});

test("on a display, a ghost set through configure takes its rise and fall off the canvas", () => {
  const backdrop = mount();
  const canvas = canvasOf(backdrop);
  backdrop.setDisplay("pocket-lcd");
  expect(canvas.dataset).toMatchObject({
    ghostRise: String(pocket.ghostRise),
    ghostFall: String(pocket.ghostFall),
  });

  backdrop.configure({ ghost: 20 });

  expect(canvas.dataset.ghost).toBe("20");
  expect(canvas.dataset.ghostRise).toBeUndefined();
  expect(canvas.dataset.ghostFall).toBeUndefined();
});

test("an unknown display is ignored", () => {
  const backdrop = mount();

  backdrop.setDisplay("pocket-lcd");
  backdrop.setDisplay("missing");

  expect(canvasOf(backdrop).dataset.paletteBase).toBe(pocket.base);
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

  expect(paletteAtDraw).toBe(pocket.base);
  expect(reset).not.toHaveBeenCalled();
});

test("a display chosen before the backdrop attaches outranks the stored one", () => {
  localStorage.setItem("backdrop-display", "pocket-lcd");
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.setDisplay("site");

  const canvas = document.createElement("emulated-canvas");
  backdrop.append(canvas);
  document.body.append(backdrop);

  expect(canvas.dataset.paletteBase).not.toBe(pocket.base);
});

/** The attributes written on the backdrop and its canvas while `change` runs. */
async function writesDuring(backdrop: PixelBackdrop, change: () => unknown) {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(backdrop, { attributes: true, subtree: true });
  await change();
  await Promise.resolve();
  records.push(...observer.takeRecords());
  observer.disconnect();
  return records.map(
    ({ target, attributeName }) => `${target.nodeName} ${attributeName}`,
  );
}

test.each<[string, (backdrop: PixelBackdrop) => unknown]>([
  ["an empty configure", (backdrop) => backdrop.configure({})],
  [
    "a scheme flip",
    async () => {
      document.documentElement.style.colorScheme = "dark";
      await Promise.resolve();
    },
  ],
  ["the same display again", (backdrop) => backdrop.setDisplay("pocket-lcd")],
])("on a display, %s writes nothing", async (_, change) => {
  const backdrop = mount();
  backdrop.setDisplay("pocket-lcd");

  expect(await writesDuring(backdrop, () => change(backdrop))).toEqual([]);
});

test("an apply restores an attribute someone else changed on the canvas", () => {
  const backdrop = mount();
  const canvas = canvasOf(backdrop);
  const ghost = canvas.dataset.ghost;
  canvas.dataset.ghost = "99";

  backdrop.configure({});

  expect(canvas.dataset.ghost).toBe(ghost);
});

test("a reconnect restores an attribute changed while the backdrop was away", () => {
  const backdrop = mount();
  const canvas = canvasOf(backdrop);
  const gap = canvas.dataset.gap;
  backdrop.remove();
  canvas.dataset.gap = "7";

  document.body.append(backdrop);

  expect(canvas.dataset.gap).toBe(gap);
});

test("a tweak writes only the attribute it changes", async () => {
  const backdrop = mount();

  expect(
    await writesDuring(backdrop, () => backdrop.configure({ noiseSpeed: 9 })),
  ).toEqual(["EMULATED-CANVAS data-noise-speed"]);
});

/** The attributes and inline styles on the backdrop and its canvas. */
const markupOf = (backdrop: PixelBackdrop) =>
  [backdrop, canvasOf(backdrop)].map((element) =>
    Object.fromEntries(
      Array.from(element.attributes, ({ name, value }) => [name, value]),
    ),
  );

const ids = DISPLAYS.map(({ id }) => id);

test.each(ids.flatMap((from) => ids.map((to) => [from, to])))(
  "switching from %s to %s leaves exactly the markup of a backdrop shown %s",
  (from, to) => {
    const shown = mount();
    shown.setDisplay(to);
    const expected = markupOf(shown);
    document.body.replaceChildren();
    const switched = mount();

    switched.setDisplay(from);
    switched.setDisplay(to);

    expect(markupOf(switched)).toEqual(expected);
  },
);

test.each<[string, PixelBackdrop["tweaks"], number]>([
  ["a tweaked palette", { lightBase: "#123456" }, 1],
  ["an untouched palette", { gap: 5 }, 0],
])(
  "on a display, reset with %s restarts the canvas's passes exactly when its palette changes",
  (_, tweak, restarts) => {
    const backdrop = mount();
    backdrop.setDisplay("pocket-lcd");
    backdrop.configure(tweak);
    const reset = vi.spyOn(EmulatedCanvas.prototype, "reset");

    backdrop.reset();

    expect(reset).toHaveBeenCalledTimes(restarts);
    expect(canvasOf(backdrop).dataset).toMatchObject({
      gap: String(pocket.gap),
      paletteBase: pocket.base,
    });
  },
);

test("reset writes each attribute it changes once", async () => {
  const backdrop = mount();
  backdrop.setDisplay("pocket-lcd");
  backdrop.configure({ noiseSpeed: 9 });

  expect(await writesDuring(backdrop, () => backdrop.reset())).toEqual([
    "EMULATED-CANVAS data-noise-speed",
  ]);
});

test("the backdrop's page styles blend nothing, as a blend over a changing canvas is re-blended on every present", () => {
  const page = readFileSync(
    join(import.meta.dirname, "PixelBackdrop.astro"),
    "utf8",
  );

  expect(page).not.toContain("mix-blend-mode");
});
