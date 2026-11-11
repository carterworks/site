import { beforeEach, expect, test } from "vitest";
import { saveScheme } from "./color-scheme";

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
