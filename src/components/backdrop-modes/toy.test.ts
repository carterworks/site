import { afterEach, expect, test, vi } from "vitest";
import { pointOn, visibleCells } from "./toy";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function canvasAt(rect: DOMRect, width = 100, height = 50) {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width, height });
  canvas.getBoundingClientRect = () => rect;
  return canvas;
}

test("a pointer maps onto the canvas's own pixels however large it is drawn", () => {
  const canvas = canvasAt(new DOMRect(10, 20, 400, 200));

  expect(pointOn(canvas, { clientX: 10, clientY: 20 })).toEqual({ x: 0, y: 0 });
  expect(pointOn(canvas, { clientX: 212, clientY: 70 })).toEqual({
    x: 50.5,
    y: 12.5,
  });
});

/** Measures the small viewport probe as `rect`. */
function smallViewport(rect: DOMRect) {
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLDivElement ? rect : measure.call(this);
    },
  );
}

test("the visible cells are the canvas's overlap with the small viewport", () => {
  smallViewport(new DOMRect(0, 40, 390, 600));
  const canvas = canvasAt(new DOMRect(-100, 0, 1000, 1000), 100, 100);

  expect(visibleCells(canvas)).toEqual({
    left: 10,
    top: 4,
    right: 49,
    bottom: 64,
  });
});

test("a canvas wholly on screen is visible whole", () => {
  smallViewport(new DOMRect(0, 0, 1000, 1000));
  const canvas = canvasAt(new DOMRect(100, 100, 200, 100));

  expect(visibleCells(canvas)).toEqual({
    left: 0,
    top: 0,
    right: 100,
    bottom: 50,
  });
});

test("an unmeasured canvas counts as visible whole", () => {
  const canvas = canvasAt(new DOMRect(0, 0, 0, 0));

  expect(visibleCells(canvas)).toEqual({
    left: 0,
    top: 0,
    right: 100,
    bottom: 50,
  });
});

test("the viewport probe is made once, and again only once a page swap drops it", () => {
  const canvas = canvasAt(new DOMRect(0, 0, 100, 50));
  visibleCells(canvas);
  visibleCells(canvas);
  expect(document.body.children).toHaveLength(1);

  document.body.replaceChildren();
  visibleCells(canvas);
  expect(document.body.children).toHaveLength(1);
});
