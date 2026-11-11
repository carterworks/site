import { beforeEach, expect, test } from "vitest";
import { MAX_GHOST } from "../components/emulated-canvas";
import { CONTROLS, STORAGE_KEY, loadSaved } from "./pixel-backdrop";

const range = (key: string) =>
  CONTROLS.find((control) => control.kind === "range" && control.key === key);

const options = { gap: 2, shape: "square", enabled: true };

beforeEach(() => localStorage.clear());

test("keeps stored keys whose type matches the current options", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ gap: 4, shape: "circle" }),
  );
  expect(loadSaved(options)).toEqual({ gap: 4, shape: "circle" });
});

test("drops unknown keys and mismatched types", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ gap: "4", enabled: 1, legacy: 3, shape: "circle" }),
  );
  expect(loadSaved(options)).toEqual({ shape: "circle" });
});

test.each(["{not json", "null", "[1]", '"str"'])(
  "ignores unusable storage %s",
  (raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadSaved(options)).toEqual({});
  },
);

test("ghost slider stops at the emulated canvas's retention cap", () => {
  expect(range("ghost")).toMatchObject({ max: Math.round(MAX_GHOST * 100) });
});

test("trail slider reaches past the 1000ms default", () => {
  expect(range("trail")).toMatchObject({
    max: expect.toSatisfy((n: number) => n > 1000),
  });
});
