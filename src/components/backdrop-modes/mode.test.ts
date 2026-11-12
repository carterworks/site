import { expect, test } from "vitest";
import { cellScale, GRID_SIZE, sameRect } from "./mode";

test("a design cell as wide as the site's cell scales by 1", () => {
  expect(cellScale(1440 / GRID_SIZE, GRID_SIZE)).toBe(1);
});

test("halving the cell width doubles the cells a design size spans", () => {
  expect(cellScale(6, 240)).toBe(1);
  expect(cellScale(6, 480)).toBe(2);
});

test("sameRect compares every edge", () => {
  const rect = { left: 0, top: 1, right: 2, bottom: 3 };
  expect(sameRect(rect, { ...rect })).toBe(true);
  expect(sameRect(rect, { ...rect, bottom: 4 })).toBe(false);
});
