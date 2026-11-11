import { beforeEach, expect, test } from "vitest";
import { restoreScheme, saveScheme } from "./color-scheme";

beforeEach(() => localStorage.clear());

test("saveScheme stores the choice and applies it", () => {
  saveScheme(document.documentElement, "light");

  expect(localStorage.getItem("color-scheme")).toBe("light");
  expect(document.documentElement.style.colorScheme).toBe("light");
});

test("saveScheme with no choice clears the stored value", () => {
  saveScheme(document.documentElement, "dark");
  saveScheme(document.documentElement, "");

  expect(localStorage.getItem("color-scheme")).toBeNull();
  expect(document.documentElement.style.colorScheme).toBe("");
});

test("restoreScheme applies the stored choice to another document's root", () => {
  localStorage.setItem("color-scheme", "light");
  const incoming = document.implementation.createHTMLDocument();

  restoreScheme(incoming.documentElement);

  expect(incoming.documentElement.style.colorScheme).toBe("light");
});

test("restoreScheme leaves the root alone when nothing is stored", () => {
  const incoming = document.implementation.createHTMLDocument();

  restoreScheme(incoming.documentElement);

  expect(incoming.documentElement.style.colorScheme).toBe("");
});

test("storage failures do not throw", () => {
  const getItem = Storage.prototype.getItem;
  Storage.prototype.getItem = () => {
    throw new DOMException("denied", "SecurityError");
  };
  try {
    expect(() => restoreScheme(document.documentElement)).not.toThrow();
  } finally {
    Storage.prototype.getItem = getItem;
  }
});
