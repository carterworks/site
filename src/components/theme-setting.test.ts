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

test("a stored value rotates Light, Dark, System", () => {
  osPrefers("dark");
  const theme = createThemeSetting();

  theme.cycle();
  expect(theme.label()).toBe("Light");
  theme.cycle();
  expect(theme.label()).toBe("Dark");
  theme.cycle();
  expect(theme.label()).toBe("System");
  expect(localStorage.getItem("color-scheme")).toBeNull();
  expect(root.style.colorScheme).toBe("");
  theme.cycle();
  expect(theme.label()).toBe("Light");
});

test("System stays in the rotation until a reload with nothing stored", () => {
  osPrefers("dark");
  const theme = createThemeSetting();
  theme.cycle();
  theme.cycle();
  theme.cycle();
  expect(theme.label()).toBe("System");

  expect(createThemeSetting().label()).toBe("Dark");
});

test("a value stored before load offers System", () => {
  osPrefers("light");
  root.style.colorScheme = "dark";
  const theme = createThemeSetting();

  theme.cycle();

  expect(theme.label()).toBe("System");
});

test("an OS change never touches storage", () => {
  osPrefers("dark");
  const theme = createThemeSetting();
  theme.cycle();

  osPrefers("light");

  expect(localStorage.getItem("color-scheme")).toBe("light");
  expect(theme.label()).toBe("Light");
});
