import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  countAllocations,
  installSoftCanvas,
  SoftContext,
  softStats,
} from "../../test/toy-canvas";
import { EmulatedCanvas } from "./element";
import { Presenter, SHAPES } from "./presenter";
import { SHADERS } from "./shaders";
import { noise } from "./shaders/noise";
import {
  display,
  FILLED,
  pixels,
  fake,
  useFakeCanvas,
  mountCanvas,
  draw,
  shown,
  presentFor,
  fadingFromWhite,
  square,
  drawRow,
} from "../../test/emulated-canvas";

useFakeCanvas();

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

test("the passes run on the logical bitmap, however large its cells are drawn", () => {
  const frames: number[][] = [];
  const create = noise.create;
  vi.spyOn(noise, "create").mockImplementation(() => {
    const pass = create();
    return {
      ...pass,
      apply(pixels, frame) {
        frames.push([pixels.length, frame.width, frame.height]);
        return pass.apply(pixels, frame);
      },
    };
  });
  const canvas = mountCanvas({
    width: "4",
    height: "2",
    scale: "8",
    noise: "50",
  });
  draw(canvas, 100);

  canvas.present();

  expect(frames).toEqual([[4 * 2 * 4, 4, 2]]);
});

test("the element observes its own attributes and every shader's", () => {
  const observed = EmulatedCanvas.observedAttributes;

  expect(observed).toEqual(
    expect.arrayContaining(["data-scale", "data-manual"]),
  );
  for (const shader of SHADERS) {
    expect(observed).toEqual(expect.arrayContaining([...shader.attributes]));
  }
  expect(new Set(observed).size).toBe(observed.length);
});

test("after a reset the next present shows the new frame opaque, not blended", () => {
  const canvas = fadingFromWhite("70");
  presentFor(canvas, 1000 / 60, 60);
  expect(shown()[0]).toBeGreaterThan(0);

  canvas.reset();
  presentFor(canvas, 1000 / 60, 60);

  expect([...shown()]).toEqual([0, 0, 0, 255]);
});

/** A canvas with these data attributes, and the geometry it last handed its presenter. */
function geometryFor(data: Record<string, string>) {
  const configure = vi.spyOn(Presenter.prototype, "configure");
  const canvas = mountCanvas(data);
  return { canvas, configure, geometry: () => configure.mock.lastCall![0] };
}

test.each([
  ["scale", "x", { scale: 1 }],
  ["scale", "0", { scale: 1 }],
  ["scale", "8", { scale: 8 }],
  ["gap", "", { gap: 0 }],
  ["gap", "-4", { gap: 0 }],
  ["gap", "5", { gap: 5 }],
  ["shape", "oval", { shape: "square" }],
])("a data-%s of %j draws cells of %j", (name, value, expected) => {
  expect(geometryFor({ [name]: value }).geometry()).toMatchObject(expected);
});

test.each(SHAPES)("a data-shape of %j draws cells of that shape", (shape) => {
  expect(geometryFor({ shape }).geometry()).toMatchObject({ shape });
});

test.each([
  [{}, { opacity: 0, x: 0, y: 0 }],
  [
    { shadow: "40", shadowX: "2", shadowY: "-3" },
    { opacity: 40, x: 2, y: -3 },
  ],
  [{ shadow: "x" }, { opacity: 0 }],
  [{ shadow: "-5" }, { opacity: 0 }],
  [{ shadow: "0" }, { opacity: 0 }],
  [{ shadow: "150" }, { opacity: 100 }],
  [
    { shadow: "40", shadowX: "x", shadowY: "" },
    { x: 0, y: 0 },
  ],
])("%j casts a shadow of %j", (data, expected) => {
  expect(geometryFor(data).geometry().shadow).toMatchObject(expected);
});

const POCKET = { paletteBase: "#889d58", paletteInk: "#1f3326" };

test("with a palette the shadow's unlit colour is the palette's base, and without one there is none", () => {
  const { canvas, geometry } = geometryFor({ shadow: "40", ...POCKET });
  expect(geometry().shadow.unlit).toBe("#889d58");

  canvas.dataset.paletteBase = "#e8a33a";
  expect(geometry().shadow.unlit).toBe("#e8a33a");

  delete canvas.dataset.paletteInk;
  expect(geometry().shadow.unlit).toBeUndefined();

  canvas.dataset.paletteInk = "#1f3326";
  delete canvas.dataset.paletteBase;
  expect(geometry().shadow.unlit).toBeUndefined();
});

test("a drawn manual canvas reconfigures its shadow as soon as an attribute changes", () => {
  const { canvas, geometry } = geometryFor({});
  draw(canvas, 100);
  canvas.present();

  canvas.dataset.shadow = "40";
  expect(geometry().shadow).toMatchObject({ opacity: 40, x: 0 });

  canvas.dataset.shadowX = "7";
  expect(geometry().shadow).toMatchObject({ opacity: 40, x: 7 });
});

test("presents never reconfigure, so the stylesheet changes only with an attribute", () => {
  const { canvas, configure } = geometryFor({ shadow: "40", ghost: "70" });
  const configured = configure.mock.calls.length;

  draw(canvas, 0);
  presentFor(canvas, 100, 60);
  canvas.reset();
  canvas.transition();
  presentFor(canvas, 100, 60);

  expect(configure).toHaveBeenCalledTimes(configured);
});

test("with a shadow, each present shows one frame, reading nothing back and allocating nothing", () => {
  const canvas = mountCanvas({ shadow: "40", ghost: "70", ...POCKET });
  const context = canvas.getContext("2d")!;
  context.putImageData(pixels(255), 0, 0);
  canvas.present();
  context.putImageData(pixels(0), 0, 0);
  presentFor(canvas, 100, 60);
  const show = vi.spyOn(Presenter.prototype, "show");

  const allocations = countAllocations();
  try {
    presentFor(canvas, 100, 60);
  } finally {
    allocations.restore();
  }

  expect(show).toHaveBeenCalledTimes(6);
  expect(fake.reads).toBe(0);
  expect(allocations.count()).toBe(0);
});

test("a manual canvas with a shadow shows a frame on each present, and reset and transition keep it showing", () => {
  const canvas = mountCanvas({ shadow: "40" });
  const show = vi.spyOn(Presenter.prototype, "show");
  draw(canvas, 100);
  canvas.present();
  expect(show).toHaveBeenCalledTimes(1);

  canvas.reset();
  canvas.present();
  expect(show).toHaveBeenCalledTimes(2);

  canvas.transition();
  canvas.present();
  canvas.present();
  expect(show).toHaveBeenCalledTimes(4);
});

describe("with no pass active", () => {
  let bitmaps: ReturnType<typeof installSoftCanvas>;
  beforeEach(() => {
    bitmaps = installSoftCanvas();
  });

  /** The display's pixels: the one plain canvas, as nothing else here makes one. */
  function screen() {
    expect(bitmaps.plain).toHaveLength(1);
    return [...bitmaps.plain[0].pixels];
  }

  test("a whole-bitmap putImageData shows exactly its pixels, as the bitmap itself", () => {
    const canvas = mountCanvas({ width: "2", height: "1" });
    const show = vi.spyOn(Presenter.prototype, "show");
    const drawn = Uint8ClampedArray.of(10, 200, 30, 255, 40, 50, 60, 128);

    canvas.getContext("2d")!.putImageData(new ImageData(drawn, 2, 1), 0, 0);
    canvas.present();

    expect(screen()).toEqual([...drawn]);
    expect(show.mock.lastCall?.[0]).not.toBeInstanceOf(ImageData);
    expect(softStats.reads).toBe(0);
  });

  test("a shadow is cast from a whole-bitmap putImageData's own pixels, reading nothing back", () => {
    const canvas = mountCanvas({ width: "2", height: "1", shadow: "25" });
    const show = vi.spyOn(Presenter.prototype, "show");
    const drawn = Uint8ClampedArray.of(255, 255, 255, 255, 64, 64, 64, 255);

    canvas.getContext("2d")!.putImageData(new ImageData(drawn, 2, 1), 0, 0);
    canvas.present();

    const isEcho = (bitmap: (typeof bitmaps.plain)[number]) =>
      bitmap.getContext().canvas?.className === "echo";
    const display = bitmaps.plain.find((bitmap) => !isEcho(bitmap))!;
    const echo = bitmaps.plain.find(isEcho)!;
    expect([...display.pixels]).toEqual([...drawn]);
    expect([...echo.pixels]).toEqual([0, 0, 0, 0, 0, 0, 0, 48]);
    expect(show.mock.lastCall?.[0]).toBeInstanceOf(ImageData);
    expect(softStats.reads).toBe(0);
  });

  test("drawing with fillRect shows exactly what was filled, reading nothing back", () => {
    const canvas = mountCanvas({ width: "3", height: "1" });
    const context = canvas.getContext("2d")!;

    context.fillStyle = "#336699";
    context.fillRect(1, 0, 1, 1);
    canvas.present();

    expect(screen()).toEqual([0, 0, 0, 0, 0x33, 0x66, 0x99, 255, 0, 0, 0, 0]);
    expect(softStats.reads).toBe(0);
  });
});

describe("the shadow's cast", () => {
  let bitmaps: ReturnType<typeof installSoftCanvas>;
  beforeEach(() => {
    bitmaps = installSoftCanvas();
  });

  /** Counts the images put on the shadow's canvas from now on. */
  function countCasts() {
    const put = SoftContext.prototype.putImageData;
    let casts = 0;
    vi.spyOn(SoftContext.prototype, "putImageData").mockImplementation(
      function (this: SoftContext, ...args: Parameters<typeof put>) {
        if (this.canvas?.className === "echo") casts += 1;
        put.apply(this, args);
      },
    );
    return () => casts;
  }

  function shownWithShadow() {
    const canvas = mountCanvas({
      width: "2",
      height: "1",
      shadow: "25",
      ...POCKET,
    });
    drawRow(canvas, [0x88, 0x9d, 0x58, 255], [0x26, 0x3c, 0x2b, 255]);
    canvas.present();
    return canvas;
  }

  test("is untouched by a burst of writes to attributes it does not depend on", () => {
    const canvas = shownWithShadow();
    const casts = countCasts();

    Object.assign(canvas.dataset, {
      scale: "4",
      gap: "2",
      shape: "circle",
      shadowX: "4",
      shadowY: "4",
      paletteInk: "#263c2b",
      paletteLevels: "4",
      ghost: "50",
      ghostRise: "45",
      noise: "10",
      noiseSpeed: "20",
    });

    expect(casts()).toBe(0);
  });

  test("is recast once when its opacity or the unlit colour changes, and once per present", () => {
    const canvas = shownWithShadow();
    const casts = countCasts();

    canvas.dataset.shadow = "40";
    expect(casts()).toBe(1);

    canvas.dataset.paletteBase = "#e8a33a";
    expect(casts()).toBe(2);

    canvas.present();
    expect(casts()).toBe(3);
  });

  test("turned on after a frame was shown casts once", () => {
    const canvas = shownWithShadow();
    canvas.dataset.shadow = "0";
    const casts = countCasts();

    canvas.dataset.shadow = "25";

    expect(casts()).toBe(1);
  });

  test("turned on for a drawn manual canvas shown as its bitmap casts what is shown at once", () => {
    const canvas = mountCanvas({ width: "2", height: "1" });
    drawRow(canvas, [255, 255, 255, 255], [64, 64, 64, 255]);
    canvas.present();
    drawRow(canvas, [0, 0, 0, 255], [0, 0, 0, 255]);
    const echo = () =>
      bitmaps.plain.find(
        (bitmap) => bitmap.getContext().canvas?.className === "echo",
      );

    canvas.dataset.shadow = "25";

    expect([...echo()!.pixels]).toEqual([0, 0, 0, 0, 0, 0, 0, 48]);
  });
});

test("importing the module again does not redefine the element", async () => {
  vi.resetModules();
  await expect(import("./element")).resolves.toBeDefined();
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

  fake.clock += 400;
  expect(canvas.present()).toBe(true);
  const halfway = census();
  expect(halfway.white).toBeGreaterThan(100);
  expect(halfway.black).toBeGreaterThan(100);
  expect(halfway.white + halfway.black).toBe(1024);

  fake.clock += 400;
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
  fake.clock += 400;
  canvas.present();
  const mix = [...shown()];

  canvas.transition();
  context.putImageData(square(32, 128), 0, 0);
  canvas.present();

  expect([...shown()]).toEqual(mix);
});

test("a reset ends the dissolve, so the frozen frame does not outlive the palette it was drawn in", () => {
  const canvas = mountCanvas({ width: "32", height: "32" });
  const context = canvas.getContext("2d")!;
  context.putImageData(square(32, 255), 0, 0);
  canvas.present();
  canvas.transition();
  context.putImageData(square(32, 0), 0, 0);
  display.drawImage.mockClear();

  canvas.reset();

  expect(canvas.present()).toBe(false);
  expect(display.drawImage).toHaveBeenCalledTimes(1);
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

  test("a toy waking in the frame a fade presents in does not present a second time", async () => {
    const canvas = mountLive({ ghost: "70" });
    const context = canvas.getContext("2d")!;
    context.putImageData(pixels(255), 0, 0);
    await vi.advanceTimersByTimeAsync(100);
    context.putImageData(pixels(0), 0, 0);
    await Promise.resolve();
    requestAnimationFrame(() => context.putImageData(pixels(128), 0, 0));
    display.putImageData.mockClear();

    await vi.advanceTimersByTimeAsync(20);

    expect(presents()).toBe(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(presents()).toBe(2);
  });

  test("a whole-bitmap putImageData is presented from the consumer's pixels, without reading the bitmap back", async () => {
    const canvas = mountLive({ ghost: "70" });
    const context = canvas.getContext("2d")!;
    for (const level of [255, 0, 128]) {
      context.putImageData(pixels(level), 0, 0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(shown()[0]).toBe(level);
    }

    expect(fake.reads).toBe(0);
  });

  test("a toy editing its image after putImageData, in the same task, does not change what is shown", async () => {
    const canvas = mountLive({ ghost: "70" });
    const image = pixels(100);

    canvas.getContext("2d")!.putImageData(image, 0, 0);
    image.data.fill(200);
    await Promise.resolve();

    expect(shown()[0]).toBe(100);
  });

  test("other drawing is read back once on the present after it, and a present with nothing new drawn reads nothing", async () => {
    const canvas = mountLive({ ghost: "70" });
    const context = canvas.getContext("2d")!;
    context.putImageData(pixels(255), 0, 0);
    await vi.advanceTimersByTimeAsync(100);

    context.fillRect(0, 0, 1, 1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fake.reads).toBe(1);
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

  test("a display with no 2D context schedules nothing, even mid-fade", async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const canvas = mountLive({ ghost: "70" });
    const context = canvas.getContext("2d")!;
    context.putImageData(pixels(255), 0, 0);
    await vi.advanceTimersByTimeAsync(100);

    context.putImageData(pixels(0), 0, 0);
    await Promise.resolve();

    expect(vi.getTimerCount()).toBe(0);
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

  test("an idle present registers no animation frame", async () => {
    mountDrifting();
    await vi.advanceTimersByTimeAsync(500);
    const request = vi.spyOn(globalThis, "requestAnimationFrame");

    expect(await presentsOver(1000)).toBeGreaterThan(5);
    expect(request).not.toHaveBeenCalled();
  });

  test("a toy drawing right after an idle present is shown at once", async () => {
    const canvas = mountDrifting();
    await vi.advanceTimersByTimeAsync(500);
    const before = display.putImageData.mock.calls.length;
    while (display.putImageData.mock.calls.length === before) {
      await vi.advanceTimersByTimeAsync(1);
    }
    const idle = display.putImageData.mock.calls.length;

    canvas.getContext("2d")!.putImageData(square(16, 255), 0, 0);
    await Promise.resolve();

    expect(display.putImageData.mock.calls.length).toBe(idle + 1);
  });

  test("frames with unchanged attributes parse no knobs", async () => {
    const canvas = mountDrifting({
      ghost: "50",
      paletteBase: "#000000",
      paletteInk: "#ffffff",
    });
    await vi.advanceTimersByTimeAsync(500);
    const parseFloat = vi.spyOn(Number, "parseFloat");
    const parseInt = vi.spyOn(Number, "parseInt");

    expect(await presentsOver(1000)).toBeGreaterThan(5);
    expect(parseFloat).not.toHaveBeenCalled();
    expect(parseInt).not.toHaveBeenCalled();

    canvas.dataset.noiseSpeed = "100";
    await Promise.resolve();
    expect(parseFloat).toHaveBeenCalled();
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
    fake.clock += 400;
    canvas.present();
  } finally {
    allocations.restore();
  }

  expect(allocations.count()).toBe(0);
});
