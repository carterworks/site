import { expect, test } from "vitest";
import { settleFrames } from "./pixel-backdrop-pacing";

test("a panel with no ghosting is settled immediately", () => {
  expect(settleFrames(0)).toBe(0);
});

test("the smear takes enough frames to fall below one 8-bit step", () => {
  const frames = settleFrames(70);
  expect(0.7 ** frames).toBeLessThan(1 / 255);
  expect(0.7 ** (frames - 1)).toBeGreaterThanOrEqual(1 / 255);
});

test("retention is capped like the component's, so it always settles", () => {
  expect(Number.isFinite(settleFrames(100))).toBe(true);
});
