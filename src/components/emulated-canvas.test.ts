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

type TestCanvas = HTMLElement & {
  getContext(id: "2d"): unknown;
  present(): void;
};

test.each([
  [1, 0],
  [8, 5],
])(
  "at scale %i and gap %i the display stays bitmap-sized and takes one copy",
  (scale, gap) => {
    const displays: HTMLCanvasElement[] = [];
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(
      function (this: HTMLCanvasElement) {
        displays.push(this);
        return display as unknown as CanvasRenderingContext2D;
      },
    );
    const canvas = document.createElement("emulated-canvas") as TestCanvas;
    Object.assign(canvas.dataset, {
      width: "80",
      height: "80",
      scale: String(scale),
      gap: String(gap),
      manual: "",
    });
    document.body.replaceChildren(canvas);

    canvas.present();

    expect(displays[0]).toMatchObject({ width: 80, height: 80 });
    expect(display.drawImage).toHaveBeenCalledTimes(1);
    expect(display.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0);
    expect(display.clearRect).not.toHaveBeenCalled();
  },
);

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
