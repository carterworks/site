import { afterEach, expect, test } from "vitest";
import { gridCoordinate, shade, shadeTable } from "./pixel-backdrop";

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
});

// 80 cells of 14px with 5px gaps: cells start every 19px, and the box ends at
// the last cell.
const box = 80 * 19 - 5;

test.each([
  [0, 0],
  [16.4, 0],
  [16.5, 1],
  [79 * 19 - 3, 78],
  [79 * 19 - 2, 79],
  [box, 79],
])("offset %d lands in cell %i", (offset, cell) => {
  expect(Math.floor(gridCoordinate(offset, box, 80, 5))).toBe(cell);
});

test("a cell's centre maps to its pixel's centre", () => {
  expect(gridCoordinate(40 * 19 + 7, box, 80, 5)).toBeCloseTo(40.5);
});

test("reset restores the stylesheet defaults after a knob was tweaked", () => {
  const style = document.createElement("style");
  style.textContent = ":root { --backdrop-ghost: 40%; }";
  document.head.append(style);
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);

  backdrop.configure({ ghost: 70 });
  backdrop.reset();

  expect(backdrop.options).toMatchObject({ ghost: 40 });
});

test("a reconnected backdrop keeps its tweaks", () => {
  const backdrop = document.createElement("pixel-backdrop");
  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);
  backdrop.configure({ ghost: 20 });

  backdrop.remove();
  document.body.append(backdrop);

  expect(backdrop.options.ghost).toBe(20);
});

test("the shade table steps evenly from base to ink", () => {
  const table = shadeTable([0, 100, 200], [255, 0, 200]);
  expect([...table.slice(0, 3)]).toEqual([0, 100, 200]);
  expect([...table.slice(128 * 3, 128 * 3 + 3)]).toEqual([128, 50, 200]);
  expect([...table.slice(255 * 3)]).toEqual([255, 0, 200]);
});

test("shading maps each field cell through the table to an opaque pixel, clamping out-of-range intensities", () => {
  const table = shadeTable([0, 0, 0], [255, 255, 255]);
  const pixels = new Uint8ClampedArray(4 * 4);

  shade(Float32Array.of(0, 0.5, 1, 7), table, pixels);

  expect([...pixels]).toEqual([
    0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  ]);
});
