import { beforeEach, expect, test, vi } from "vitest";
import { restoreScript, saveScheme } from "./color-scheme";

beforeEach(() => localStorage.clear());

test("saveScheme stores the choice and applies it", () => {
  saveScheme(document.documentElement, "light");

  expect(localStorage.getItem("color-scheme")).toBe("light");
  expect(document.documentElement.style.colorScheme).toBe("light");
});

test("saveScheme does not throw when storage is denied", () => {
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = () => {
    throw new DOMException("denied", "SecurityError");
  };
  try {
    expect(() => saveScheme(document.documentElement, "dark")).not.toThrow();
    expect(document.documentElement.style.colorScheme).toBe("dark");
  } finally {
    Storage.prototype.setItem = setItem;
  }
});

test("saveScheme(null) clears the stored override and returns to system", () => {
  saveScheme(document.documentElement, "light");

  saveScheme(document.documentElement, null);

  expect(localStorage.getItem("color-scheme")).toBeNull();
  expect(document.documentElement.style.colorScheme).toBe("");
});

const DISPLAYS: [string, string, string[]][] = [
  [
    "data-display-light",
    "backdrop-display-light",
    ["site-light", "pocket-lcd", "amber-lcd"],
  ],
  ["data-display-dark", "backdrop-display-dark", ["site-dark", "grid"]],
];

/** Runs the head script as the page does, from its inlined source. */
const runHeadScript = () => new Function(restoreScript(DISPLAYS))();

function clearRoot() {
  const root = document.documentElement;
  root.removeAttribute("style");
  for (const [attribute] of DISPLAYS) root.removeAttribute(attribute);
}

test("the head script puts the stored scheme and each scheme's display on <html>", () => {
  clearRoot();
  localStorage.setItem("color-scheme", "dark");
  localStorage.setItem("backdrop-display-light", "pocket-lcd");
  localStorage.setItem("backdrop-display-dark", "grid");

  runHeadScript();

  const root = document.documentElement;
  expect(root.style.colorScheme).toBe("dark");
  expect(root.getAttribute("data-display-light")).toBe("pocket-lcd");
  expect(root.getAttribute("data-display-dark")).toBe("grid");
  clearRoot();
});

test("with nothing stored, the head script leaves the scheme to the OS and draws each scheme's display for the visit", () => {
  clearRoot();
  sessionStorage.clear();
  const random = vi.spyOn(Math, "random").mockReturnValue(0.99);

  runHeadScript();

  const root = document.documentElement;
  expect(root.style.colorScheme).toBe("");
  expect(root.getAttribute("data-display-light")).toBe("amber-lcd");
  expect(root.getAttribute("data-display-dark")).toBe("grid");
  expect(sessionStorage.getItem("backdrop-display-light")).toBe("amber-lcd");
  expect(localStorage.getItem("backdrop-display-light")).toBeNull();
  random.mockRestore();
  clearRoot();
});

test("the visit's display lasts the session, and a stored one overrides it", () => {
  clearRoot();
  sessionStorage.setItem("backdrop-display-light", "amber-lcd");
  sessionStorage.setItem("backdrop-display-dark", "grid");
  localStorage.setItem("backdrop-display-dark", "site-dark");

  runHeadScript();

  const root = document.documentElement;
  expect(root.getAttribute("data-display-light")).toBe("amber-lcd");
  expect(root.getAttribute("data-display-dark")).toBe("site-dark");
  sessionStorage.clear();
  clearRoot();
});

test("the head script does not throw when storage is denied", () => {
  clearRoot();
  const getItem = Storage.prototype.getItem;
  Storage.prototype.getItem = () => {
    throw new DOMException("denied", "SecurityError");
  };
  try {
    expect(runHeadScript).not.toThrow();
  } finally {
    Storage.prototype.getItem = getItem;
  }
});
