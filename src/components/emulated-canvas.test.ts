import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "./emulated-canvas";

const display = {
  drawImage: vi.fn(),
  clearRect: vi.fn(),
  imageSmoothingEnabled: true,
};

beforeEach(() => {
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage: vi.fn() };
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    display as unknown as CanvasRenderingContext2D,
  );
  display.drawImage.mockClear();
  display.clearRect.mockClear();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each([0, 5])("an 80×80 frame with gap %i uses one bitmap draw", (gap) => {
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, {
    width: "80",
    height: "80",
    gap: String(gap),
    ghost: "0",
  });
  document.body.replaceChildren(canvas);
  canvas.dataset.scale = "8";

  expect(display.drawImage).toHaveBeenCalledTimes(1);
  expect(display.imageSmoothingEnabled).toBe(false);
  // One frame clear plus one strip per internal row/column, never per cell.
  expect(display.clearRect).toHaveBeenCalledTimes(gap === 0 ? 1 : 159);
  if (gap > 0) {
    expect(display.clearRect).toHaveBeenCalledWith(8, 0, 5, 1035);
    expect(display.clearRect).toHaveBeenCalledWith(0, 8, 1035, 5);
  }
});

test("identity geometry copies the bitmap without adding gaps", () => {
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, {
    width: "2",
    height: "2",
    gap: "0",
    ghost: "0",
  });
  document.body.replaceChildren(canvas);
  canvas.dataset.scale = "1";
  expect(display.drawImage).toHaveBeenCalledTimes(1);
  expect(display.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0);
});

type TestCanvas = HTMLElement & {
  getContext(id: "2d"): unknown;
  present(): void;
};

test("a data-manual canvas only paints when told to present", () => {
  const canvas = document.createElement("emulated-canvas") as TestCanvas;
  Object.assign(canvas.dataset, { width: "2", height: "2", manual: "" });
  document.body.replaceChildren(canvas);
  const request = vi.spyOn(globalThis, "requestAnimationFrame");

  canvas.getContext("2d");
  expect(request).not.toHaveBeenCalled();

  display.drawImage.mockClear();
  canvas.present();
  expect(display.drawImage).toHaveBeenCalledTimes(1);
});

test("without data-manual, getContext starts mirroring on its own", () => {
  const canvas = document.createElement("emulated-canvas") as TestCanvas;
  document.body.replaceChildren(canvas);
  const request = vi.spyOn(globalThis, "requestAnimationFrame");

  canvas.getContext("2d");
  expect(request).toHaveBeenCalledTimes(1);
});
