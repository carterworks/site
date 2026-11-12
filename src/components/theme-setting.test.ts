import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createThemeSetting } from "./theme-setting";

const root = document.documentElement;

function osPrefers(scheme: "light" | "dark") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark") === (scheme === "dark"),
  }));
}

beforeEach(() => {
  localStorage.clear();
  root.style.colorScheme = "";
});
afterEach(() => vi.unstubAllGlobals());

test("shows the OS scheme while nothing is stored", () => {
  osPrefers("dark");

  expect(createThemeSetting().label()).toBe("Dark");
  expect(localStorage.getItem("color-scheme")).toBeNull();
});

test.each([
  ["dark", "light"],
  ["light", "dark"],
] as const)("with a %s OS the first activation stores %s", (os, stored) => {
  osPrefers(os);
  const theme = createThemeSetting();

  theme.cycle();

  expect(localStorage.getItem("color-scheme")).toBe(stored);
  expect(theme.label()).toBe(stored === "light" ? "Light" : "Dark");
});

test("flipping back to the OS scheme clears storage and never shows System", () => {
  osPrefers("dark");
  const theme = createThemeSetting();

  theme.cycle();
  theme.cycle();

  expect(theme.label()).toBe("Dark");
  expect(localStorage.getItem("color-scheme")).toBeNull();
  expect(root.style.colorScheme).toBe("");
});

test("an override that came to match the OS is kept until the next press", () => {
  osPrefers("dark");
  const theme = createThemeSetting();
  theme.cycle();

  osPrefers("light");
  expect(localStorage.getItem("color-scheme")).toBe("light");
  expect(theme.label()).toBe("Light");

  theme.cycle();
  expect(theme.label()).toBe("Dark");
  expect(localStorage.getItem("color-scheme")).toBe("dark");
});

test("a value stored before load flips to the opposite", () => {
  osPrefers("light");
  root.style.colorScheme = "dark";
  const theme = createThemeSetting();

  theme.cycle();

  expect(theme.label()).toBe("Light");
  expect(localStorage.getItem("color-scheme")).toBeNull();
});
