import { afterEach, beforeEach, vi } from "vitest";
import "../components/emulated-canvas/element";
import type { EmulatedCanvas } from "../components/emulated-canvas/element";

/**
 * Fakes for driving `<emulated-canvas>` under happy-dom: a bitmap that only
 * carries pixels, one display context whose calls a test reads, and a clock
 * the test moves.
 */
export const display = {
  drawImage: vi.fn(),
  putImageData: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  getImageData: (x: number, y: number, width: number, height: number) =>
    new ImageData(width, height),
  imageSmoothingEnabled: true,
};

/** The grey `fillRect` paints, as the fake has no fill style. */
export const FILLED = 77;

/** Just enough of a 2D bitmap for pixels to flow from the consumer to the display. */
class FakeBitmap {
  pixels: Uint8ClampedArray;
  #context?: object;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    const { pixels, width, height } = this;
    return (this.#context ??= {
      drawImage: (source: FakeBitmap) => pixels.set(source.pixels),
      fillRect: () => {
        for (let i = 0; i < pixels.length; i += 4) {
          pixels.set([FILLED, FILLED, FILLED, 255], i);
        }
      },
      getImageData: () => {
        fake.reads += 1;
        return { width, height, data: pixels.slice() };
      },
      putImageData: (image: ImageData) => pixels.set(image.data),
    });
  }
}

/** A 1 x 1 opaque grey of `level`, as whole-bitmap image data. */
export function pixels(level: number) {
  const data = Uint8ClampedArray.of(level, level, level, 255);
  return { width: 1, height: 1, data } as ImageData;
}

export const fake = { clock: 0, reads: 0 };

/** Installs the fakes before each test and removes them after. */
export function useFakeCanvas() {
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", FakeBitmap);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      display as unknown as CanvasRenderingContext2D,
    );
    fake.clock = 0;
    fake.reads = 0;
    vi.spyOn(performance, "now").mockImplementation(() => fake.clock);
    display.drawImage.mockClear();
    display.putImageData.mockClear();
    display.clearRect.mockClear();
    display.fillRect.mockClear();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}

export function mountCanvas(data: Record<string, string>) {
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, { width: "1", height: "1", manual: "" }, data);
  document.body.replaceChildren(canvas);
  return canvas;
}

/** Fills the bitmap with an opaque grey of `level`. */
export function draw(canvas: EmulatedCanvas, level: number) {
  const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set([level, level, level, 255], i);
  }
  canvas.getContext("2d")?.putImageData({ data } as ImageData, 0, 0);
}

export function shown(): Uint8ClampedArray {
  return display.putImageData.mock.lastCall?.[0].data;
}

/** Presents at `hz` for `ms` of wall-clock time. */
export function presentFor(canvas: EmulatedCanvas, ms: number, hz: number) {
  const frames = Math.round((ms * hz) / 1000);
  for (let i = 0; i < frames; i += 1) {
    fake.clock += 1000 / hz;
    canvas.present();
  }
}

/** A canvas that was showing white and has just been drawn black. */
export function fadingFromWhite(ghost: string) {
  const canvas = mountCanvas({ ghost });
  draw(canvas, 255);
  canvas.present();
  draw(canvas, 0);
  return canvas;
}

/** Puts these RGBA pixels, in a row, as the whole bitmap of `canvas`. */
export function drawRow(canvas: EmulatedCanvas, ...rgba: number[][]) {
  const data = Uint8ClampedArray.from(rgba.flat());
  canvas
    .getContext("2d")
    ?.putImageData({ width: rgba.length, height: 1, data } as ImageData, 0, 0);
}

export const pixelsShown = () => [...shown()].join(" ");

/** A `size` x `size` bitmap of one opaque grey, as whole-bitmap image data. */
export function square(size: number, level: number) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set([level, level, level, 255], i);
  }
  return { width: size, height: size, data } as ImageData;
}
