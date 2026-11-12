import { afterEach, expect, test } from "vitest";
import { installBackdropDefaults } from "../test/backdrop-defaults";
import { GRID_SIZE } from "./backdrop-modes/mode";
import {
  gridCoordinate,
  shade,
  shadeTable,
  visibleCells,
} from "./pixel-backdrop";

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

test("the visible cells are the grid's overlap with the viewport, whole on the axis it fits", () => {
  const stride = (box + 5) / 80;
  const grid = new DOMRect(-358, 0, box, box);

  expect(
    visibleCells(grid, { left: 0, top: 0, width: 800, height: box }, 80, 80, 5),
  ).toEqual({
    left: 358 / stride,
    top: 0,
    right: (800 + 358 + 5) / stride,
    bottom: 80,
  });
});

test("auto-fit tiles the viewport's larger side with whole strides of the grid, the gap taken out of each", () => {
  installBackdropDefaults();
  const backdrop = document.createElement("pixel-backdrop");
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, {
    width: String(GRID_SIZE),
    height: String(GRID_SIZE),
  });
  backdrop.append(canvas);
  document.body.append(backdrop);
  backdrop.configure({ autoFit: true, gap: 2 });

  expect(canvas.style.getPropertyValue("--emulated-canvas-scale")).toBe(
    `max(1px, round(up, max(100lvw, 100lvh) / ${GRID_SIZE}, 1px) - 2px)`,
  );
});
