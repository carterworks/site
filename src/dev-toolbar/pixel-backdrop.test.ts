import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readDefaults } from "../components/pixel-backdrop";
import { MAX_GHOST } from "../components/emulated-canvas-limits";
import { TOYS } from "../components/backdrop-toys";
import { TOY_KEY } from "../components/backdrop-toy-setting";
import {
  CONTROLS,
  STORAGE_KEY,
  loadSaved,
  persistChanges,
  default as app,
} from "./pixel-backdrop";

vi.mock("../components/backdrop-toys", () => {
  const toy = (id: string, look?: { ghost: number; noise: number }) => ({
    id,
    label: id.toUpperCase(),
    look,
    start: () => () => {},
  });
  return {
    TOYS: [
      toy("plain"),
      toy("silty", { ghost: 55, noise: 12 }),
      toy("cultured", { ghost: 70, noise: 0 }),
    ],
  };
});

const range = (key: string) =>
  CONTROLS.find((control) => control.kind === "range" && control.key === key);

const options = { gap: 2, shape: "square", enabled: true };

beforeEach(() => {
  localStorage.clear();
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
});

afterEach(() => document.head.replaceChildren());

test("keeps stored keys whose type matches the current options", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ gap: 4, shape: "circle" }),
  );
  expect(loadSaved(options)).toEqual({ gap: 4, shape: "circle" });
});

test("drops unknown keys and mismatched types", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ gap: "4", enabled: 1, legacy: 3, shape: "circle" }),
  );
  expect(loadSaved(options)).toEqual({ shape: "circle" });
});

test.each(["{not json", "null", "[1]", '"str"'])(
  "ignores unusable storage %s",
  (raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadSaved(options)).toEqual({});
  },
);

test("ghost slider stops at the emulated canvas's retention cap", () => {
  expect(range("ghost")).toMatchObject({ max: Math.round(MAX_GHOST * 100) });
});

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");

test("persists only the keys that differ from the defaults", () => {
  const defaults = readDefaults();
  persistChanges({ ...defaults, gap: defaults.gap + 1 });
  expect(stored()).toEqual({ gap: defaults.gap + 1 });
});

test("drops a key set back to its default", () => {
  const defaults = readDefaults();
  persistChanges({ ...defaults, gap: defaults.gap + 1 });
  persistChanges(defaults);
  expect(stored()).toEqual({});
});

test("persists a knob the live backdrop has tweaked", () => {
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);
  const defaults = readDefaults();

  backdrop.configure({ ghost: defaults.ghost + 15 });
  persistChanges(backdrop.options);

  expect(stored()).toEqual({ ghost: defaults.ghost + 15 });
  backdrop.remove();
});

class StubToggle extends HTMLElement {
  input = document.createElement("input");
}
class StubSelect extends HTMLElement {
  element = document.createElement("select");
}
customElements.define("astro-dev-toolbar-toggle", StubToggle);
customElements.define("astro-dev-toolbar-select", StubSelect);

function mountBackdrop() {
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);
  return backdrop;
}

const init = (canvas: HTMLElement) =>
  app.init?.(canvas as never, { onToggled: vi.fn() } as never, {} as never);

test("init restores saved options onto the backdrop", () => {
  const backdrop = mountBackdrop();
  const defaults = readDefaults();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ghost: defaults.ghost + 15 }),
  );

  init(document.createElement("div"));

  expect(backdrop.options.ghost).toBe(defaults.ghost + 15);
  backdrop.remove();
});

test("Reset restores the defaults and clears storage", () => {
  const backdrop = mountBackdrop();
  const defaults = readDefaults();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ghost: defaults.ghost + 15 }),
  );
  const canvas = document.createElement("div");
  init(canvas);

  canvas.querySelector<HTMLElement>("astro-dev-toolbar-button")!.click();

  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(backdrop.options.ghost).toBe(defaults.ghost);
  backdrop.remove();
});

test("mode select lists every backdrop mode by label, in registry order", () => {
  const canvas = document.createElement("div");
  init(canvas);

  const select = canvas.querySelector<StubSelect>(
    'astro-dev-toolbar-select[aria-label="Toy"]',
  )!;
  expect(
    [...select.element.options].map((option) => option.textContent),
  ).toEqual(TOYS.map((toy) => toy.label));
});

test("choosing a mode calls setToy without saving a user preference", () => {
  const backdrop = mountBackdrop();
  const setToy = vi.fn();
  Object.assign(backdrop, { setToy });
  const canvas = document.createElement("div");
  init(canvas);

  const select = canvas.querySelector<StubSelect>(
    'astro-dev-toolbar-select[aria-label="Toy"]',
  )!;
  select.element.value = TOYS[2].id;
  select.element.dispatchEvent(new Event("change"));

  expect(setToy).toHaveBeenCalledWith(TOYS[2].id);
  expect(localStorage.getItem(TOY_KEY)).toBeNull();
  backdrop.remove();
});

function toySelect(canvas: HTMLElement) {
  return canvas.querySelector<StubSelect>(
    'astro-dev-toolbar-select[aria-label="Toy"]',
  )!;
}

test("mode select opens on the backdrop's current mode", () => {
  const backdrop = mountBackdrop();
  backdrop.setToy(TOYS[2].id);
  const canvas = document.createElement("div");
  init(canvas);

  expect(toySelect(canvas).element.value).toBe(TOYS[2].id);
  backdrop.remove();
});

test("mode select follows the backdrop's mode after a navigation", () => {
  const backdrop = mountBackdrop();
  const canvas = document.createElement("div");
  init(canvas);

  backdrop.setToy(TOYS[2].id);
  document.dispatchEvent(new Event("astro:page-load"));

  expect(toySelect(canvas).element.value).toBe(TOYS[2].id);
  backdrop.remove();
});

const slider = (canvas: HTMLElement, key: string) =>
  canvas.querySelector<HTMLInputElement>(`#pixel-backdrop-${key}`)!;

test("the ghost and noise sliders open on the shown mode's look", () => {
  const backdrop = mountBackdrop();
  backdrop.setToy("silty");
  const canvas = document.createElement("div");
  init(canvas);

  expect(slider(canvas, "ghost").value).toBe("55");
  expect(slider(canvas, "noise").value).toBe("12");
  backdrop.remove();
});

test("choosing a mode moves the ghost and noise sliders to its look", () => {
  const backdrop = mountBackdrop();
  const canvas = document.createElement("div");
  init(canvas);

  const select = toySelect(canvas);
  select.element.value = "cultured";
  select.element.dispatchEvent(new Event("change"));

  expect(slider(canvas, "ghost").value).toBe("70");
  expect(slider(canvas, "noise").value).toBe("0");
  backdrop.remove();
});

test("a slider tweak overrides the look, and is what persists", async () => {
  const backdrop = mountBackdrop();
  backdrop.setToy("silty");
  const canvas = document.createElement("div");
  init(canvas);

  const ghost = slider(canvas, "ghost");
  ghost.value = "30";
  ghost.dispatchEvent(new Event("input"));
  await new Promise(requestAnimationFrame);

  expect(backdrop.look.ghost).toBe(30);
  persistChanges(backdrop.options);
  expect(stored()).toEqual({ ghost: 30 });
  backdrop.remove();
});
