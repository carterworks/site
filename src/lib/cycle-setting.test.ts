import { beforeEach, describe, expect, test, vi } from "vitest";
import { nextInRotation, storedChoice, storeChoice } from "./cycle-setting";

const values = ["a", "b", "c"];

test("advances through the values and wraps", () => {
  expect(nextInRotation(values, "a")).toBe("b");
  expect(nextInRotation(values, "c")).toBe("a");
});

test("a current value outside the rotation starts at the first value", () => {
  expect(nextInRotation(values, "elsewhere")).toBe("a");
});

describe("a stored choice", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("is returned only while it is one of the known ids", () => {
    expect(storedChoice("key", values)).toBeUndefined();

    storeChoice("key", "b");
    expect(storedChoice("key", values)).toBe("b");

    storeChoice("key", "gone");
    expect(storedChoice("key", values)).toBeUndefined();
  });

  test("is cleared by storing nothing", () => {
    storeChoice("key", "b");
    storeChoice("key");

    expect(localStorage.getItem("key")).toBeNull();
  });

  test("survives blocked storage as no choice", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", {
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
    });

    expect(storedChoice("key", values)).toBeUndefined();
    expect(() => storeChoice("key", "a")).not.toThrow();
    expect(() => storeChoice("key")).not.toThrow();
  });
});
