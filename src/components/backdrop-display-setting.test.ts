import { beforeEach, expect, test, vi } from "vitest";
import { createBackdropDisplay } from "./backdrop-display-setting";
import { DISPLAYS, DISPLAY_KEY } from "./backdrop-displays";

const [site, pocket, amber] = DISPLAYS;
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

test("the first activation stores and applies the first themed display", () => {
  const display = createBackdropDisplay();

  display.cycle();

  expect(localStorage.getItem(DISPLAY_KEY)).toBe(pocket.id);
  expect(setDisplay).toHaveBeenLastCalledWith(pocket.id);
  expect(display.label()).toBe(pocket.label);
});

test("rotates through the themed displays, then back to the site's look", () => {
  const display = createBackdropDisplay();

  display.cycle();
  display.cycle();
  expect(display.label()).toBe(amber.label);
  expect(localStorage.getItem(DISPLAY_KEY)).toBe(amber.id);

  display.cycle();
  expect(display.label()).toBe(site.label);
  expect(setDisplay).toHaveBeenLastCalledWith(site.id);
  expect(localStorage.getItem(DISPLAY_KEY)).toBeNull();
});

test("the reset entry stays offered until a reload", () => {
  const display = createBackdropDisplay();
  for (let step = 0; step < 3; step++) display.cycle();

  display.cycle();
  expect(display.label()).toBe(pocket.label);
  display.cycle();
  display.cycle();
  expect(display.label()).toBe(site.label);

  const reloaded = createBackdropDisplay();
  reloaded.cycle();
  reloaded.cycle();
  expect(reloaded.label()).toBe(amber.label);
  reloaded.cycle();
  expect(reloaded.label()).toBe(site.label);
});

test("with nothing stored after a reload, the site's look is not a rotation entry", () => {
  const reloaded = createBackdropDisplay();

  reloaded.cycle();
  reloaded.cycle();

  expect(setDisplay.mock.calls.map(([id]) => id)).toEqual([
    pocket.id,
    amber.id,
  ]);
});

test("a display stored before load is shown and offers the reset", () => {
  localStorage.setItem(DISPLAY_KEY, amber.id);
  const display = createBackdropDisplay();

  expect(display.label()).toBe(amber.label);
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

  display.cycle();
  display.cycle();
  expect(display.label()).toBe(amber.label);
  display.cycle();
  expect(display.label()).toBe(site.label);
});
