import { beforeEach, expect, test, vi } from "vitest";
import { createBackdropDisplay } from "./backdrop-display-setting";
import { DISPLAYS, DISPLAY_KEY } from "../pixel-backdrop/backdrop-displays";

const [site, pocket] = DISPLAYS;
const last = DISPLAYS.at(-1)!;
const cycleToLast = (display: { cycle(): void }) =>
  DISPLAYS.slice(1).forEach(() => display.cycle());
const setDisplay = vi.fn();

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setDisplay.mockClear();
  document.body.innerHTML = "<pixel-backdrop></pixel-backdrop>";
  Object.assign(document.querySelector("pixel-backdrop")!, { setDisplay });
});

test("shows the site's own look and stores nothing by default", () => {
  const display = createBackdropDisplay();

  expect(display.label()).toBe(site.label);
  expect(localStorage.getItem(DISPLAY_KEY)).toBeNull();
});

test("the first activation stores and applies the first screen", () => {
  const display = createBackdropDisplay();

  display.cycle();

  expect(localStorage.getItem(DISPLAY_KEY)).toBe(pocket.id);
  expect(setDisplay).toHaveBeenLastCalledWith(pocket.id);
  expect(display.label()).toBe(pocket.label);
});

test("rotates through the screens, then back to the site's look", () => {
  const display = createBackdropDisplay();

  cycleToLast(display);
  expect(display.label()).toBe(last.label);
  expect(localStorage.getItem(DISPLAY_KEY)).toBe(last.id);

  display.cycle();
  expect(display.label()).toBe(site.label);
  expect(setDisplay).toHaveBeenLastCalledWith(site.id);
  expect(localStorage.getItem(DISPLAY_KEY)).toBeNull();
});

test("a display stored before load is shown and offers the reset", () => {
  localStorage.setItem(DISPLAY_KEY, last.id);
  const display = createBackdropDisplay();

  expect(display.label()).toBe(last.label);
  display.cycle();
  expect(display.label()).toBe(site.label);
  expect(localStorage.getItem(DISPLAY_KEY)).toBeNull();
});

test("ignores a stored id that is no longer a display", () => {
  localStorage.setItem(DISPLAY_KEY, "gone");
  const display = createBackdropDisplay();

  expect(display.label()).toBe(site.label);
  display.cycle();
  expect(display.label()).toBe(pocket.label);
});

test("keeps cycling when storage is blocked", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal("localStorage", {
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
  });
  const display = createBackdropDisplay();

  cycleToLast(display);
  expect(display.label()).toBe(last.label);
  display.cycle();
  expect(display.label()).toBe(site.label);
});
