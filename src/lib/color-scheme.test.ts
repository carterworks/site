import { beforeEach, describe, expect, test } from "vitest";
import { nextScheme, saveScheme } from "./color-scheme";

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

describe("nextScheme", () => {
  test("first press stores the opposite of the system scheme", () => {
    expect(nextScheme("dark", "dark")).toBe("light");
    expect(nextScheme("light", "light")).toBe("dark");
  });

  test("returns to system when the opposite is the system scheme", () => {
    expect(nextScheme("light", "dark")).toBeNull();
    expect(nextScheme("dark", "light")).toBeNull();
  });
});
