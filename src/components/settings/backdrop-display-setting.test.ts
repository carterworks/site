import { beforeEach, expect, test, vi } from "vitest";
import { createBackdropDisplay } from "./backdrop-display-setting";
import {
  displayKey,
  displaysFor,
  shownDisplay,
} from "../pixel-backdrop/backdrop-displays";

const [site, pocket] = displaysFor("light");
const lastLight = displaysFor("light").at(-1)!;
const [, grid] = displaysFor("dark");

let root: HTMLElement;

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  root = document.createElement("html");
  root.style.colorScheme = "light";
});

const cycleTimes = (display: { cycle(): void }, times: number) => {
  for (let i = 0; i < times; i += 1) display.cycle();
};

test("shows the site's own look and stores nothing by default", () => {
  const display = createBackdropDisplay(root);

  expect(display.label()).toBe(site.label);
  expect(display.value()).toBe(site.id);
  expect(localStorage.getItem(displayKey("light"))).toBeNull();
});

test("the first activation stores and shows the scheme's first screen", () => {
  const display = createBackdropDisplay(root);

  display.cycle();

  expect(localStorage.getItem(displayKey("light"))).toBe(pocket.id);
  expect(shownDisplay(root, "light")).toBe(pocket);
  expect(display.label()).toBe(pocket.label);
});

test("rotates through the shown scheme's screens only, then back to the site's look", () => {
  const display = createBackdropDisplay(root);

  cycleTimes(display, displaysFor("light").length - 1);
  expect(display.value()).toBe(lastLight.id);
  expect(localStorage.getItem(displayKey("light"))).toBe(lastLight.id);

  display.cycle();
  expect(display.value()).toBe(site.id);
  expect(shownDisplay(root, "light")).toBe(site);
  expect(localStorage.getItem(displayKey("light"))).toBeNull();
});

test("offers the shown scheme's displays, and follows a scheme flip", () => {
  const display = createBackdropDisplay(root);
  expect(display.choices()).toBe(displaysFor("light"));

  root.style.colorScheme = "dark";

  expect(display.choices()).toBe(displaysFor("dark"));
});

test("light and dark each keep their own choice", () => {
  const display = createBackdropDisplay(root);
  display.choose(pocket.id);
  root.style.colorScheme = "dark";

  display.cycle();

  expect(display.value()).toBe(grid.id);
  expect(localStorage.getItem(displayKey("dark"))).toBe(grid.id);
  expect(localStorage.getItem(displayKey("light"))).toBe(pocket.id);
  root.style.colorScheme = "light";
  expect(display.value()).toBe(pocket.id);
});

test("choosing a screen stores and shows it", () => {
  const display = createBackdropDisplay(root);

  display.choose(lastLight.id);

  expect(display.value()).toBe(lastLight.id);
  expect(localStorage.getItem(displayKey("light"))).toBe(lastLight.id);
  expect(shownDisplay(root, "light")).toBe(lastLight);
});

test("choosing the site's look shows it and clears the store", () => {
  const display = createBackdropDisplay(root);
  display.choose(lastLight.id);

  display.choose(site.id);

  expect(display.value()).toBe(site.id);
  expect(localStorage.getItem(displayKey("light"))).toBeNull();
});

test("an unknown id changes nothing", () => {
  const display = createBackdropDisplay(root);
  display.choose(pocket.id);

  display.choose("gone");

  expect(display.value()).toBe(pocket.id);
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
  const display = createBackdropDisplay(root);

  cycleTimes(display, displaysFor("light").length - 1);
  expect(display.value()).toBe(lastLight.id);
  display.cycle();
  expect(display.value()).toBe(site.id);
});
