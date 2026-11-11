import { afterEach, expect, test } from "vitest";
import { gridCoordinate } from "./pixel-backdrop";

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

test("reset restores the stylesheet defaults after the panel knobs were tweaked", () => {
  const style = document.createElement("style");
  style.textContent =
    ":root { --backdrop-panel-opacity: 40%; --backdrop-panel-blur: 5px; }";
  document.head.append(style);
  const backdrop = document.createElement("pixel-backdrop") as HTMLElement & {
    options: { panelBlur: number; panelOpacity: number };
    configure(options: object): void;
    reset(): void;
  };
  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);

  backdrop.configure({ panelBlur: 9, panelOpacity: 70 });
  backdrop.reset();

  expect(backdrop.options).toMatchObject({ panelBlur: 5, panelOpacity: 40 });
});

test("a reconnected backdrop keeps its tweaks and restores the body panel properties", () => {
  const backdrop = document.createElement("pixel-backdrop") as HTMLElement & {
    options: { ghost: number; panelBlur: number };
    configure(options: object): void;
  };
  backdrop.append(document.createElement("emulated-canvas"));
  document.body.append(backdrop);
  backdrop.configure({ ghost: 20, panelBlur: 9 });

  document.body.removeAttribute("style");
  backdrop.remove();
  document.body.append(backdrop);

  expect(backdrop.options.ghost).toBe(20);
  expect(
    document.body.style.getPropertyValue("--backdrop-panel-blur"),
  ).toBe("9px");
});

test("the grid reads the same whole-number size the canvas bitmap uses", () => {
  const canvas = document.createElement("emulated-canvas");
  canvas.dataset.width = "80.5";
  const backdrop = document.createElement("pixel-backdrop") as HTMLElement & {
    configure(options: object): void;
  };
  backdrop.append(canvas);
  document.body.append(backdrop);
  backdrop.configure({ autoFit: true });

  expect(canvas.width).toBe(80);
});
