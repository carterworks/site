import { expect, test } from "vitest";
import { nextInRotation } from "./cycle-setting";

const values = ["a", "b", "c"];

test("advances through the values and wraps without a reset entry", () => {
  expect(nextInRotation(values, "a")).toBe("b");
  expect(nextInRotation(values, "c")).toBe("a");
});

test("a reset entry follows the last value and leads back to the first", () => {
  expect(nextInRotation(values, "c", "reset")).toBe("reset");
  expect(nextInRotation(values, "reset", "reset")).toBe("a");
});

test("a current value outside the rotation starts at the first value", () => {
  expect(nextInRotation(values, "elsewhere")).toBe("a");
});
