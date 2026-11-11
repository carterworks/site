import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  type EmulatedCanvas,
  SHADERS,
  type ShaderFrame,
} from "./emulated-canvas";

const display = {
  drawImage: vi.fn(),
  putImageData: vi.fn(),
  clearRect: vi.fn(),
  imageSmoothingEnabled: true,
};

/** Just enough of a 2D bitmap for pixels to flow from the consumer to the display. */
class FakeBitmap {
  pixels: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    const { pixels, width, height } = this;
    return {
      drawImage: (source: FakeBitmap) => pixels.set(source.pixels),
      getImageData: () => ({ width, height, data: pixels.slice() }),
      putImageData: (image: ImageData) => pixels.set(image.data),
    };
  }
}

let clock = 0;

beforeEach(() => {
  vi.stubGlobal("OffscreenCanvas", FakeBitmap);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    display as unknown as CanvasRenderingContext2D,
  );
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  display.drawImage.mockClear();
  display.putImageData.mockClear();
  display.clearRect.mockClear();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountCanvas(data: Record<string, string>) {
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, { width: "1", height: "1", manual: "" }, data);
  document.body.replaceChildren(canvas);
  return canvas;
}

/** Fills the bitmap with an opaque grey of `level`. */
function draw(canvas: EmulatedCanvas, level: number) {
  const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set([level, level, level, 255], i);
  }
  canvas.getContext("2d")?.putImageData({ data } as ImageData, 0, 0);
}

function shown(): Uint8ClampedArray {
  return display.putImageData.mock.lastCall?.[0].data;
}

/** Presents at `hz` for `ms` of wall-clock time. */
function presentFor(canvas: EmulatedCanvas, ms: number, hz: number) {
  const frames = Math.round((ms * hz) / 1000);
  for (let i = 0; i < frames; i += 1) {
    clock += 1000 / hz;
    canvas.present();
  }
}

/** A canvas that was showing white and has just been drawn black. */
function fadingFromWhite(ghost: string) {
  const canvas = mountCanvas({ ghost });
  draw(canvas, 255);
  canvas.present();
  draw(canvas, 0);
  return canvas;
}

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
    const canvas = document.createElement("emulated-canvas");
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

test.each([
  [{}, 64, 64],
  [{ width: "80.5", height: "12" }, 80, 12],
  [{ width: "0", height: "nope" }, 64, 64],
])(
  "the bitmap size of %j is %i x %i, even before connecting",
  (data, width, height) => {
    const canvas = document.createElement("emulated-canvas");
    Object.assign(canvas.dataset, data);
    expect([canvas.width, canvas.height]).toEqual([width, height]);

    document.body.append(canvas);
    expect([canvas.width, canvas.height]).toEqual([width, height]);
  },
);

test("a data-manual canvas only paints when told to present", () => {
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, { width: "2", height: "2", manual: "" });
  document.body.replaceChildren(canvas);
  const request = vi.spyOn(globalThis, "requestAnimationFrame");

  canvas.getContext("2d");
  expect(request).not.toHaveBeenCalled();

  display.drawImage.mockClear();
  canvas.present();
  expect(display.drawImage).toHaveBeenCalledTimes(1);
});

test("a shader added to SHADERS recolours the logical bitmap before it is displayed", () => {
  const sizes: number[][] = [];
  const twoColour = (pixels: Uint8ClampedArray, frame: ShaderFrame) => {
    sizes.push([pixels.length, frame.width, frame.height]);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels.fill(pixels[i] < 128 ? 0 : 255, i, i + 3);
    }
    return false;
  };
  SHADERS.push(() => ({ active: () => true, apply: twoColour }));
  try {
    const canvas = mountCanvas({ width: "4", height: "2", scale: "8" });
    draw(canvas, 100);
    canvas.present();

    expect(sizes).toEqual([[4 * 2 * 4, 4, 2]]);
    expect([...shown().slice(0, 4)]).toEqual([0, 0, 0, 255]);
  } finally {
    SHADERS.pop();
  }
});

test("at 60 Hz each ghost frame keeps data-ghost of the previous one", () => {
  const canvas = fadingFromWhite("70");

  presentFor(canvas, 1000 / 60, 60);

  expect(Math.abs(shown()[0] - 255 * 0.7)).toBeLessThanOrEqual(1);
});

test("the ghost trail fades by elapsed time, so a faster display does not shorten it", () => {
  const trailAfter = (hz: number) => {
    presentFor(fadingFromWhite("70"), 100, hz);
    return shown()[0];
  };

  expect(trailAfter(60)).toBeGreaterThan(10);
  expect(Math.abs(trailAfter(120) - trailAfter(60))).toBeLessThanOrEqual(1);
});

test("even at the maximum ghost the panel lands exactly on a new frame, with no residual", () => {
  const canvas = fadingFromWhite("100");
  draw(canvas, 3);

  presentFor(canvas, 10_000, 60);

  expect([...shown()]).toEqual([3, 3, 3, 255]);
});

test("after a reset the next present shows the new frame opaque, not blended", () => {
  const canvas = fadingFromWhite("70");
  presentFor(canvas, 1000 / 60, 60);
  expect(shown()[0]).toBeGreaterThan(0);

  canvas.reset();
  presentFor(canvas, 1000 / 60, 60);

  expect([...shown()]).toEqual([0, 0, 0, 255]);
});

test("turning the ghost off and on again starts the panel from the current frame", () => {
  const canvas = fadingFromWhite("70");
  canvas.dataset.ghost = "0";
  presentFor(canvas, 1000 / 60, 60);

  canvas.dataset.ghost = "70";
  presentFor(canvas, 1000 / 60, 60);

  expect([...shown()]).toEqual([0, 0, 0, 255]);
});

test("without data-manual, getContext starts mirroring on its own", () => {
  const canvas = document.createElement("emulated-canvas");
  document.body.replaceChildren(canvas);
  const request = vi.spyOn(globalThis, "requestAnimationFrame");

  canvas.getContext("2d");
  expect(request).toHaveBeenCalledTimes(1);
});

test.each([
  ["scale", "x", "var(--emulated-canvas-scale, 1px)"],
  ["scale", "0", "var(--emulated-canvas-scale, 1px)"],
  ["gap", "", "calc(var(--scale) + 0px)"],
  ["gap", "-4", "calc(var(--scale) + 0px)"],
])(
  "a data-%s of %j falls back to its default in the display style",
  (name, value, expected) => {
    expect(displayStyleFor({ [name]: value })).toContain(expected);
  },
);

test.each([
  ["square", "5"],
  ["circle", "0"],
  ["circle", "5"],
])(
  "a %s cell with gap %s is cut by painting over the canvas, never by masking it",
  (shape, gap) => {
    const style = displayStyleFor({ shape, gap });

    expect(style).not.toContain("mask");
    expect(style).toContain("var(--emulated-canvas-gap-color, Canvas)");
  },
);

test("an ungapped square grid paints nothing over the canvas", () => {
  expect(displayStyleFor({ shape: "square", gap: "0" })).not.toContain(
    "--emulated-canvas-gap-color",
  );
});

/** The display style a canvas with these data attributes renders with. */
function displayStyleFor(data: Record<string, string>) {
  let shadow: ShadowRoot | undefined;
  const attachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    shadow = attachShadow.call(this, { ...init, mode: "open" });
    return shadow;
  });
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, data);
  document.body.replaceChildren(canvas);
  return shadow?.querySelector("style")?.textContent ?? "";
}

test("importing the module again does not redefine the element", async () => {
  vi.resetModules();
  await expect(import("./emulated-canvas")).resolves.toBeDefined();
});

test("the context is available before the element is connected", () => {
  const canvas = document.createElement("emulated-canvas");

  expect(canvas.getContext("2d")).not.toBeNull();
});
