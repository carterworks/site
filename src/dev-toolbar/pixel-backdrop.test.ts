import { afterEach, beforeEach, expect, test } from "vitest";
import {
  type PixelBackdropOptions,
  readDefaults,
} from "../components/pixel-backdrop";
import { MAX_GHOST } from "../components/pixel-backdrop-pacing";
import {
  CONTROLS,
  STORAGE_KEY,
  loadSaved,
  persistChanges,
} from "./pixel-backdrop";

const range = (key: string) =>
  CONTROLS.find((control) => control.kind === "range" && control.key === key);

const options = { gap: 2, shape: "square", enabled: true };

beforeEach(() => {
  localStorage.clear();
  const style = document.createElement("style");
  style.textContent = `:root {
    --backdrop-enabled: true; --backdrop-auto-fit: false; --backdrop-scale: 8;
    --backdrop-gap: 1; --backdrop-shape: square; --backdrop-ghost: 0;
    --backdrop-trail: 100ms; --backdrop-ripple-size: 10; --backdrop-ripple-speed: 100ms;
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

test("trail slider reaches past the 1000ms default", () => {
  expect(range("trail")).toMatchObject({
    max: expect.toSatisfy((n: number) => n > 1000),
  });
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
  const backdrop = document.createElement("pixel-backdrop") as HTMLElement & {
    options: PixelBackdropOptions;
    configure(options: object): void;
  };
  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);
  const defaults = readDefaults();

  backdrop.configure({ ghost: defaults.ghost + 15 });
  persistChanges(backdrop.options);

  expect(stored()).toEqual({ ghost: defaults.ghost + 15 });
  backdrop.remove();
});
