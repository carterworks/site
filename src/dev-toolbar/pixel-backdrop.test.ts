import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "../components/pixel-backdrop/element";
import {
  KNOBS,
  property,
  readDefaults,
} from "../components/pixel-backdrop/knobs";
import { MAX_GHOST } from "../components/emulated-canvas/limits";
import { TOYS } from "../components/backdrop-toys";
import { TOY_KEY } from "../components/settings/backdrop-toy-setting";
import { DISPLAYS } from "../components/backdrop-displays";
import { backdropDefaults } from "../test/backdrop-defaults";
import {
  CONTROLS,
  type Control,
  STORAGE_KEY,
  loadSaved,
  persistTweaks,
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

const options = { gap: 2, shape: "square", enabled: true };

const declared = new Map(backdropDefaults());

test.for(Object.entries(CONTROLS))(
  "the default for %s is one its control can show",
  ([key, control]) => {
    const css = declared.get(property(key)) ?? "";
    const value = KNOBS[key as keyof typeof KNOBS](css);

    if (control.kind === "range") {
      expect(value).toBeGreaterThanOrEqual(control.min);
      expect(value).toBeLessThanOrEqual(control.max);
    } else if (control.kind === "toggle") {
      expect(["true", "false"]).toContain(css);
    } else if (control.kind === "select") {
      expect(Object.keys(control.choices)).toContain(value);
    } else {
      // The colour input accepts only this form, and shows black for any other.
      expect(value).toMatch(/^#[\da-f]{6}$/i);
    }
  },
);

/**
 * One per control, so no knob can be left out, and fixed per kind rather than
 * the shipped defaults, so tuning global.css can't move these tests. A toggle
 * starts off, for the Fit viewport test to switch on.
 */
const testDefault = (control: Control) =>
  control.kind === "range"
    ? control.min
    : control.kind === "toggle"
      ? false
      : control.kind === "select"
        ? Object.keys(control.choices)[0]
        : "#000000";

beforeEach(() => {
  localStorage.clear();
  const style = document.createElement("style");
  const declarations = Object.entries(CONTROLS).map(
    ([key, control]) => `${property(key)}: ${testDefault(control)};`,
  );
  style.textContent = `:root { ${declarations.join(" ")} }`;
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

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");

test("persists the tweaks as given, one at its default included", () => {
  const defaults = readDefaults();
  persistTweaks({ gap: defaults.gap + 1, ghost: defaults.ghost });
  expect(stored()).toEqual({ gap: defaults.gap + 1, ghost: defaults.ghost });
});

test("persists a knob the live backdrop has tweaked", () => {
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);
  const defaults = readDefaults();

  backdrop.configure({ ghost: defaults.ghost + 15 });
  persistTweaks(backdrop.tweaks);

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

  expect(backdrop.tweaks).toEqual({ ghost: defaults.ghost + 15 });
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
  expect(backdrop.tweaks).toEqual({});
  backdrop.remove();
});

test("toy select lists every backdrop toy by label, in registry order", () => {
  const canvas = document.createElement("div");
  init(canvas);

  const select = canvas.querySelector<StubSelect>(
    'astro-dev-toolbar-select[aria-label="Toy"]',
  )!;
  expect(
    [...select.element.options].map((option) => option.textContent),
  ).toEqual(TOYS.map((toy) => toy.label));
});

test("choosing a toy calls setToy without saving a user preference", () => {
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

test("toy select opens on the backdrop's current toy", () => {
  const backdrop = mountBackdrop();
  backdrop.setToy(TOYS[2].id);
  const canvas = document.createElement("div");
  init(canvas);

  expect(toySelect(canvas).element.value).toBe(TOYS[2].id);
  backdrop.remove();
});

test("toy select follows the backdrop's toy after a navigation", () => {
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

function describeRow(row: Element) {
  if (row.matches(".heading")) return `## ${row.textContent}`;
  if (row.matches(".actions")) return `[${row.textContent}]`;
  const label = row.querySelector("label")!;
  const input = row.querySelector<HTMLInputElement>(".control > input");
  const select = row.querySelector<StubSelect>("astro-dev-toolbar-select");
  const toggle = row.querySelector<StubToggle>("astro-dev-toolbar-toggle");
  const control = input
    ? `${input.type} #${input.id}` +
      (input.type === "range"
        ? ` ${input.min}..${input.max}/${input.step}`
        : "")
    : select
      ? `select ${[...select.element.options].map((option) => `${option.value}=${option.textContent}`).join(",")}`
      : `toggle ${toggle!.input.checked ? "on" : "off"}`;
  const output = row.querySelector("output");
  const disabled = row.hasAttribute("data-disabled") ? " (disabled)" : "";
  return `${label.textContent}: ${control}${output ? ` -> ${output.textContent}` : ""}${disabled}`;
}

test("the panel lists every control in order, with its label, id, range and shown value", () => {
  const canvas = document.createElement("div");
  init(canvas);

  const rows = [...canvas.querySelector(".panel")!.children].map(describeRow);

  expect(rows).toMatchInlineSnapshot(`
    [
      "Toy: select plain=PLAIN,silty=SILTY,cultured=CULTURED",
      "Enabled: toggle off",
      "Fit viewport: toggle off",
      "Scale: range #pixel-backdrop-scale 1..64/1 -> 1",
      "Gap: range #pixel-backdrop-gap 0..8/1 -> 0",
      "Shape: select square=Square,circle=Circle",
      "Ghost: range #pixel-backdrop-ghost 0..98/1 -> 0%",
      "## Background noise",
      "Intensity: range #pixel-backdrop-noise 0..100/1 -> 0%",
      "Feature size: range #pixel-backdrop-noiseScale 1..40/1 -> 1",
      "Drift speed: range #pixel-backdrop-noiseSpeed 0..100/1 -> 0",
      "## Pixel colours",
      "Pixel (light): color #pixel-backdrop-lightBase -> #000000",
      "Ink (light): color #pixel-backdrop-lightInk -> #000000",
      "Pixel (dark): color #pixel-backdrop-darkBase -> #000000",
      "Ink (dark): color #pixel-backdrop-darkInk -> #000000",
      "[Reset]",
    ]
  `);
});

test("the Fit viewport toggle greys out the scale slider", async () => {
  const canvas = document.createElement("div");
  init(canvas);
  const fit = [...canvas.querySelectorAll(".row")]
    .find((row) => row.querySelector("label")!.textContent === "Fit viewport")!
    .querySelector<StubToggle>("astro-dev-toolbar-toggle")!;

  fit.input.checked = true;
  fit.input.dispatchEvent(new Event("change"));

  expect(slider(canvas, "scale").disabled).toBe(true);
  expect(
    slider(canvas, "scale").closest(".row")!.hasAttribute("data-disabled"),
  ).toBe(true);
  // Flush the queued write, or it lands on the next test's backdrop.
  await new Promise(requestAnimationFrame);
});

test("ghost slider stops at the emulated canvas's retention cap", () => {
  const canvas = document.createElement("div");
  init(canvas);

  expect(slider(canvas, "ghost").max).toBe(String(Math.round(MAX_GHOST * 100)));
});

test("the ghost and noise sliders open on the shown toy's look", () => {
  const backdrop = mountBackdrop();
  backdrop.setToy("silty");
  const canvas = document.createElement("div");
  init(canvas);

  expect(slider(canvas, "ghost").value).toBe("55");
  expect(slider(canvas, "noise").value).toBe("12");
  backdrop.remove();
});

test("choosing a toy moves the ghost and noise sliders to its look", () => {
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

test("on a display, the controls open on what the display shows", () => {
  const backdrop = mountBackdrop();
  backdrop.setDisplay("pocket-lcd");
  const canvas = document.createElement("div");
  init(canvas);

  const pocket = DISPLAYS.find(({ id }) => id === "pocket-lcd")!.look!;
  expect(slider(canvas, "gap").value).toBe(String(pocket.gap));
  expect(slider(canvas, "lightBase").value).toBe(pocket.base);
  expect(slider(canvas, "noise").value).toBe("0");
  backdrop.remove();
});

test("a tweak set back to its default still persists, so a reload shows the same", () => {
  const backdrop = mountBackdrop();
  backdrop.setDisplay("pocket-lcd");
  const { ghost } = readDefaults();
  backdrop.configure({ ghost });
  persistTweaks(backdrop.tweaks);
  backdrop.remove();

  const reloaded = mountBackdrop();
  init(document.createElement("div"));

  expect(reloaded.tweaks).toEqual({ ghost });
  reloaded.remove();
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

  expect(backdrop.knobs.ghost).toBe(30);
  persistTweaks(backdrop.tweaks);
  expect(stored()).toEqual({ ghost: 30 });
  backdrop.remove();
});
