import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { countAllocations } from "../test/toy-canvas";
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

/** The grey `fillRect` paints, as the fake has no fill style. */
const FILLED = 77;

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
        reads += 1;
        return { width, height, data: pixels.slice() };
      },
      putImageData: (image: ImageData) => pixels.set(image.data),
    });
  }
}

/** A 1 x 1 opaque grey of `level`, as whole-bitmap image data. */
function pixels(level: number) {
  const data = Uint8ClampedArray.of(level, level, level, 255);
  return { width: 1, height: 1, data } as ImageData;
}

let clock = 0;
let reads = 0;

beforeEach(() => {
  vi.stubGlobal("OffscreenCanvas", FakeBitmap);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    display as unknown as CanvasRenderingContext2D,
  );
  clock = 0;
  reads = 0;
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

test("a shader added to SHADERS recolours the logical bitmap, reading its own data-palette knob", () => {
  const sizes: number[][] = [];
  const twoColour = (pixels: Uint8ClampedArray, frame: ShaderFrame) => {
    sizes.push([pixels.length, frame.width, frame.height]);
    const [dark, light] = (frame.data.palette ?? "0,255")
      .split(",")
      .map(Number);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels.fill(pixels[i] < 128 ? dark : light, i, i + 3);
    }
    return "still" as const;
  };
  SHADERS.push(() => ({ active: () => true, apply: twoColour }));
  try {
    const canvas = mountCanvas({ width: "4", height: "2", scale: "8" });
    draw(canvas, 100);
    canvas.present();

    expect(sizes).toEqual([[4 * 2 * 4, 4, 2]]);
    expect([...shown().slice(0, 4)]).toEqual([0, 0, 0, 255]);

    canvas.dataset.palette = "30,200";
    canvas.present();

    expect([...shown().slice(0, 4)]).toEqual([30, 30, 30, 255]);
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

test("present reports a plain copy as settled", () => {
  const canvas = mountCanvas({});
  draw(canvas, 255);

  expect(canvas.present()).toBe(false);
});

test("present reports a ghost fade as changing until it lands on the frame", () => {
  const canvas = mountCanvas({ ghost: "70" });
  draw(canvas, 255);
  expect(canvas.present()).toBe(false);

  draw(canvas, 0);
  clock += 1000 / 60;
  expect(canvas.present()).toBe(true);

  presentFor(canvas, 1000, 60);
  expect(shown()[0]).toBe(0);
  clock += 1000 / 60;
  expect(canvas.present()).toBe(false);
});

test("present reports settled once the ghost is turned off mid-fade", () => {
  const canvas = fadingFromWhite("90");
  clock += 1000 / 60;
  expect(canvas.present()).toBe(true);

  canvas.dataset.ghost = "0";
  clock += 1000 / 60;
  expect(canvas.present()).toBe(false);
});

test("a one-level step settles at once, so a slowly drifting frame lets its owner idle", () => {
  const canvas = mountCanvas({ ghost: "100" });
  draw(canvas, 100);
  canvas.present();
  draw(canvas, 101);
  clock += 1000 / 60;

  expect(canvas.present()).toBe(false);
  expect(shown()[0]).toBe(101);
});

/** Puts these RGBA pixels, in a row, as the whole bitmap of `canvas`. */
function drawRow(canvas: EmulatedCanvas, ...rgba: number[][]) {
  const data = Uint8ClampedArray.from(rgba.flat());
  canvas
    .getContext("2d")
    ?.putImageData({ width: rgba.length, height: 1, data } as ImageData, 0, 0);
}

const pixelsShown = () => [...shown()].join(" ");

test("a palette maps each pixel's luma onto the scale from data-palette-base to data-palette-ink, opaque", () => {
  const canvas = mountCanvas({
    width: "5",
    height: "1",
    paletteBase: "#102030",
    paletteInk: "#ffffff",
  });
  drawRow(
    canvas,
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    [255, 255, 255, 0],
    [128, 128, 128, 255],
    [0, 255, 0, 255],
  );

  canvas.present();

  const mix = (share: number) =>
    [0x10, 0x20, 0x30].map((base) => Math.round(base + (255 - base) * share));
  expect(pixelsShown()).toBe(
    [
      [0x10, 0x20, 0x30, 255],
      [255, 255, 255, 255],
      [0x10, 0x20, 0x30, 255],
      [...mix(128 / 255), 255],
      [...mix(182 / 255), 255],
    ]
      .flat()
      .join(" "),
  );
});

test("a palette follows its knobs, and is off without both", () => {
  const canvas = mountCanvas({
    width: "1",
    height: "1",
    paletteBase: "#000000",
    paletteInk: "#ff0000",
  });
  drawRow(canvas, [255, 255, 255, 255]);
  canvas.present();
  expect(pixelsShown()).toBe("255 0 0 255");

  canvas.dataset.paletteInk = "#00ff00";
  canvas.present();
  expect(pixelsShown()).toBe("0 255 0 255");

  delete canvas.dataset.paletteInk;
  display.drawImage.mockClear();
  canvas.present();
  expect(display.drawImage).toHaveBeenCalledTimes(1);
});

/** A `size` x `size` bitmap of one opaque grey, as whole-bitmap image data. */
function square(size: number, level: number) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set([level, level, level, 255], i);
  }
  return { width: size, height: size, data } as ImageData;
}

test("data-noise lightens the frame up to a noise of that intensity, and never darkens it", () => {
  const canvas = mountCanvas({
    width: "32",
    height: "32",
    noise: "50",
    noiseScale: "4",
  });
  const image = square(32, 0);
  image.data.set([255, 255, 255, 255]);
  canvas.getContext("2d")?.putImageData(image, 0, 0);

  canvas.present();

  const reds = [...shown()].filter((_, i) => i % 4 === 0);
  expect(reds[0]).toBe(255);
  expect(Math.max(...reds.slice(1))).toBeGreaterThan(64);
  expect(Math.max(...reds.slice(1))).toBeLessThanOrEqual(128);
  expect(new Set(reds).size).toBeGreaterThan(10);
});

test("noise over a transparent pixel lightens it as though over black, and makes it opaque", () => {
  const canvas = mountCanvas({ width: "1", height: "1", noise: "100" });
  drawRow(canvas, [255, 255, 255, 0]);

  canvas.present();

  expect(shown()[3]).toBe(255);
  expect(shown()[0]).toBeLessThan(255);
});

test("noise drifts with data-noise-speed, and holds still without it", () => {
  const canvas = mountCanvas({ width: "16", height: "16", noise: "50" });
  canvas.getContext("2d")?.putImageData(square(16, 0), 0, 0);
  const presentAfter = (ms: number) => {
    clock += ms;
    canvas.present();
    return [...shown()].join();
  };

  const still = presentAfter(0);
  expect(presentAfter(1000)).toBe(still);

  canvas.dataset.noiseSpeed = "50";
  expect(presentAfter(1000)).not.toBe(still);
});

/** How many of the shown pixels are white, and how many black. */
function census() {
  const reds = [...shown()].filter((_, i) => i % 4 === 0);
  return {
    white: reds.filter((red) => red === 255).length,
    black: reds.filter((red) => red === 0).length,
  };
}

test("a transition freezes the frame on show and wipes the frames after it in, blob by blob, over 800 ms", () => {
  const canvas = mountCanvas({ width: "32", height: "32" });
  const context = canvas.getContext("2d")!;
  context.putImageData(square(32, 255), 0, 0);
  canvas.present();

  canvas.transition();
  context.putImageData(square(32, 0), 0, 0);

  expect(canvas.present()).toBe(true);
  expect(census()).toEqual({ white: 1024, black: 0 });

  clock += 400;
  expect(canvas.present()).toBe(true);
  const halfway = census();
  expect(halfway.white).toBeGreaterThan(100);
  expect(halfway.black).toBeGreaterThan(100);
  expect(halfway.white + halfway.black).toBe(1024);

  clock += 400;
  expect(canvas.present()).toBe(false);
  expect(census()).toEqual({ white: 0, black: 1024 });
});

test("a transition before anything was shown has nothing to freeze, so the next frame shows at once", () => {
  const canvas = mountCanvas({ width: "32", height: "32" });
  canvas.transition();
  canvas.getContext("2d")!.putImageData(square(32, 0), 0, 0);

  expect(canvas.present()).toBe(false);
  expect(display.putImageData).not.toHaveBeenCalled();
  expect(display.drawImage).toHaveBeenCalledTimes(1);
});

test("a transition mid-dissolve freezes the mix on show, so nothing jumps", () => {
  const canvas = mountCanvas({ width: "32", height: "32" });
  const context = canvas.getContext("2d")!;
  context.putImageData(square(32, 255), 0, 0);
  canvas.present();
  canvas.transition();
  context.putImageData(square(32, 0), 0, 0);
  canvas.present();
  clock += 400;
  canvas.present();
  const mix = [...shown()];

  canvas.transition();
  context.putImageData(square(32, 128), 0, 0);
  canvas.present();

  expect([...shown()]).toEqual(mix);
});

describe("presenting on its own", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "setTimeout",
        "clearTimeout",
        "performance",
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  function mountLive(data: Record<string, string> = {}) {
    const canvas = document.createElement("emulated-canvas");
    Object.assign(canvas.dataset, { width: "1", height: "1" }, data);
    document.body.replaceChildren(canvas);
    return canvas;
  }

  const presents = () =>
    display.drawImage.mock.calls.length +
    display.putImageData.mock.calls.length;

  test("drawing presents once, as soon as the drawing code returns", async () => {
    const canvas = mountLive();
    const context = canvas.getContext("2d")!;

    context.putImageData(pixels(10), 0, 0);
    context.putImageData(pixels(20), 0, 0);
    expect(presents()).toBe(0);

    await Promise.resolve();
    expect(presents()).toBe(1);
  });

  test("with nothing drawn and nothing changing, it schedules nothing", async () => {
    const canvas = mountLive();
    canvas.getContext("2d")!.putImageData(pixels(10), 0, 0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(presents()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a ghost fade keeps presenting every frame until it lands, then stops", async () => {
    const canvas = mountLive({ ghost: "70" });
    const context = canvas.getContext("2d")!;
    context.putImageData(pixels(255), 0, 0);
    await vi.advanceTimersByTimeAsync(100);
    context.putImageData(pixels(0), 0, 0);

    await vi.advanceTimersByTimeAsync(200);
    expect(presents()).toBeGreaterThan(10);

    await vi.advanceTimersByTimeAsync(1000);
    expect(shown()[0]).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a consumer drawing every frame through a fade gets one present per frame", async () => {
    const canvas = mountLive({ ghost: "70" });
    const context = canvas.getContext("2d")!;
    let frames = 0;
    const draw = () => {
      frames += 1;
      context.putImageData(pixels(frames % 2 === 0 ? 0 : 255), 0, 0);
      if (frames < 60) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);

    await vi.advanceTimersByTimeAsync(3000);
    display.putImageData.mockClear();
    frames = 0;
    requestAnimationFrame(draw);
    await vi.advanceTimersByTimeAsync(500);

    expect(presents()).toBe(frames);
  });

  test("a whole-bitmap putImageData is presented from the consumer's pixels, without reading the bitmap back", async () => {
    const canvas = mountLive({ ghost: "70" });
    const context = canvas.getContext("2d")!;
    for (const level of [255, 0, 128]) {
      context.putImageData(pixels(level), 0, 0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(shown()[0]).toBe(level);
    }

    expect(reads).toBe(0);
  });

  test("other drawing is read back once on the present after it, and a present with nothing new drawn reads nothing", async () => {
    const canvas = mountLive({ ghost: "70" });
    const context = canvas.getContext("2d")!;
    context.putImageData(pixels(255), 0, 0);
    await vi.advanceTimersByTimeAsync(100);

    context.fillRect(0, 0, 1, 1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(reads).toBe(1);
    expect(presents()).toBeGreaterThan(10);
    expect(shown()[0]).toBe(FILLED);
  });

  test("a knob change re-presents a static frame", async () => {
    const canvas = mountLive();
    canvas.getContext("2d")!.putImageData(pixels(10), 0, 0);
    await vi.advanceTimersByTimeAsync(100);

    canvas.dataset.ghost = "50";
    await Promise.resolve();

    expect(presents()).toBe(2);
  });

  test("a data-manual canvas schedules nothing, even mid-fade, and presents again once it is cleared", async () => {
    const canvas = mountLive({ ghost: "70" });
    const context = canvas.getContext("2d")!;
    context.putImageData(pixels(255), 0, 0);
    await vi.advanceTimersByTimeAsync(100);
    context.putImageData(pixels(0), 0, 0);
    await Promise.resolve();

    canvas.dataset.manual = "";
    context.putImageData(pixels(10), 0, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0);

    delete canvas.dataset.manual;
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown()[0]).toBe(10);
  });

  test("a detached canvas schedules nothing", async () => {
    const canvas = mountLive({ ghost: "70" });
    const context = canvas.getContext("2d")!;
    context.putImageData(pixels(255), 0, 0);
    await vi.advanceTimersByTimeAsync(100);
    context.putImageData(pixels(0), 0, 0);
    await Promise.resolve();

    canvas.remove();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("presenting drifting noise", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "setTimeout",
        "clearTimeout",
        "performance",
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  function mountDrifting(data: Record<string, string> = {}) {
    const canvas = document.createElement("emulated-canvas");
    Object.assign(
      canvas.dataset,
      { width: "16", height: "16", noise: "50", noiseSpeed: "50" },
      data,
    );
    document.body.replaceChildren(canvas);
    canvas.getContext("2d")!.putImageData(square(16, 0), 0, 0);
    return canvas;
  }

  async function presentsOver(ms: number) {
    display.putImageData.mockClear();
    await vi.advanceTimersByTimeAsync(ms);
    return display.putImageData.mock.calls.length;
  }

  test("idles at about eight presents a second", async () => {
    mountDrifting();
    await vi.advanceTimersByTimeAsync(500);

    const presents = await presentsOver(1000);
    expect(presents).toBeGreaterThanOrEqual(7);
    expect(presents).toBeLessThanOrEqual(8);
  });

  test("static noise presents once and stops", async () => {
    mountDrifting({ noiseSpeed: "0" });
    await vi.advanceTimersByTimeAsync(100);

    expect(vi.getTimerCount()).toBe(0);
  });

  test("a ghost fade over drifting noise, which never settles, holds full rate only for a second after a draw", async () => {
    const canvas = mountDrifting({ ghost: "90", noiseSpeed: "100" });
    await vi.advanceTimersByTimeAsync(2000);

    canvas.getContext("2d")!.putImageData(square(16, 255), 0, 0);
    expect(await presentsOver(400)).toBeGreaterThan(20);

    await vi.advanceTimersByTimeAsync(1000);
    for (let second = 0; second < 3; second += 1) {
      expect(await presentsOver(1000)).toBeLessThanOrEqual(8);
    }
  });
});

test("a transition keeps the canvas presenting every frame until the dissolve ends, then stops", async () => {
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
  });
  try {
    const canvas = document.createElement("emulated-canvas");
    Object.assign(canvas.dataset, { width: "8", height: "8" });
    document.body.replaceChildren(canvas);
    canvas.getContext("2d")!.putImageData(square(8, 255), 0, 0);
    await vi.advanceTimersByTimeAsync(100);

    canvas.transition();
    canvas.getContext("2d")!.putImageData(square(8, 0), 0, 0);
    display.putImageData.mockClear();
    await vi.advanceTimersByTimeAsync(1000);

    expect(display.putImageData.mock.calls.length).toBeGreaterThan(40);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("a transition after the first allocates no buffers, styled frame or not", () => {
  const canvas = mountCanvas({
    width: "16",
    height: "16",
    paletteBase: "#000000",
    paletteInk: "#ffffff",
  });
  const context = canvas.getContext("2d")!;
  const image = square(16, 255);
  context.putImageData(image, 0, 0);
  canvas.present();
  canvas.transition();
  canvas.present();

  const allocations = countAllocations();
  try {
    canvas.transition();
    context.putImageData(image, 0, 0);
    clock += 400;
    canvas.present();
  } finally {
    allocations.restore();
  }

  expect(allocations.count()).toBe(0);
});
