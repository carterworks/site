import { expect, test } from "vitest";
import { onePercentLow } from "./frame-rate";

const repeat = (times: number, gap: number) => Array<number>(times).fill(gap);

test("the 1% low is the rate of the slowest hundredth of frames", () => {
  expect(onePercentLow([...repeat(198, 10), 50, 30])).toBe(25);
});

test("fewer than a hundred frames still count their slowest one", () => {
  expect(onePercentLow([20, 100, 20])).toBe(10);
});
