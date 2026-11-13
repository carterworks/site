import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { countAllocations } from "../../test/toy-canvas";
import { EmulatedCanvas } from "./element";
import type { Shader } from "./shader";
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

/** Recolours each pixel dark or light, from its own `data-two-colour` knob. */
function twoColour(sizes: number[][]): Shader {
  return {
    attributes: ["data-two-colour"],
    create() {
      let dark = 0;
      let light = 255;
      return {
        configure(data) {
          [dark, light] = (data.twoColour ?? "0,255").split(",").map(Number);
        },
        active: () => true,
        apply(pixels, frame) {
          sizes.push([pixels.length, frame.width, frame.height]);
          for (let i = 0; i < pixels.length; i += 4) {
            pixels.fill(pixels[i] < 128 ? dark : light, i, i + 3);
          }
          return "still";
        },
      };
    },
  };
}

test("a subclass running its own shader recolours the logical bitmap, reading the knob it declares", () => {
  const sizes: number[][] = [];
  class TwoColourCanvas extends EmulatedCanvas {
    static override readonly shaders = [twoColour(sizes)];
  }
  customElements.define("two-colour-canvas", TwoColourCanvas);
  expect(TwoColourCanvas.observedAttributes).toContain("data-two-colour");

  const canvas = new TwoColourCanvas();
  Object.assign(canvas.dataset, {
    width: "4",
    height: "2",
    scale: "8",
    manual: "",
  });
  document.body.replaceChildren(canvas);
  draw(canvas, 100);
  canvas.present();

  expect(sizes).toEqual([[4 * 2 * 4, 4, 2]]);
  expect([...shown().slice(0, 4)]).toEqual([0, 0, 0, 255]);

  canvas.dataset.twoColour = "30,200";
  canvas.present();

  expect([...shown().slice(0, 4)]).toEqual([30, 30, 30, 255]);
});

test("the element observes its own attributes and every shader's", () => {
  const observed = EmulatedCanvas.observedAttributes;

  expect(observed).toEqual(
    expect.arrayContaining(["data-scale", "data-manual"]),
  );
  for (const shader of EmulatedCanvas.shaders) {
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

/** Opens every closed shadow root attached from now on, in attach order. */
function openShadowRoots() {
  const roots: ShadowRoot[] = [];
  const attachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = attachShadow.call(this, { ...init, mode: "open" });
    roots.push(root);
    return root;
  });
  return roots;
}

/** The display style a canvas with these data attributes renders with. */
function displayStyleFor(data: Record<string, string>) {
  const roots = openShadowRoots();
  const canvas = document.createElement("emulated-canvas");
  Object.assign(canvas.dataset, data);
  document.body.replaceChildren(canvas);
  return roots[0]?.querySelector("style")?.textContent ?? "";
}

type PlainContext = typeof display & {
  canvas: HTMLCanvasElement;
  fillRect: ReturnType<typeof vi.fn>;
};

/** Gives each plain canvas a context of its own, so the display and its echo can be told apart. */
function contextPerCanvas() {
  const contexts = new Map<HTMLCanvasElement, PlainContext>();
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(
    function (this: HTMLCanvasElement) {
      let context = contexts.get(this);
      if (context === undefined) {
        context = {
          canvas: this,
          drawImage: vi.fn(),
          putImageData: vi.fn(),
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          imageSmoothingEnabled: true,
        };
        contexts.set(this, context);
      }
      return context as unknown as CanvasRenderingContext2D;
    },
  );
  return contexts;
}

/** A canvas with these data attributes, its open shadow root and each plain canvas's context. */
function mountEchoed(data: Record<string, string>) {
  const roots = openShadowRoots();
  const contexts = contextPerCanvas();
  const canvas = mountCanvas(data);
  const root = roots[0];
  const displays = () => [...root.querySelectorAll("canvas")];
  const style = () => root.querySelector("style")?.textContent ?? "";
  return { canvas, contexts, displays, style };
}

test("data-shadow layers a multiplied copy of the display over it, offset by data-shadow-x and data-shadow-y", () => {
  const { canvas, contexts, displays, style } = mountEchoed({
    shadow: "40",
    shadowX: "2",
    shadowY: "-3",
  });
  draw(canvas, 100);

  canvas.present();

  const [screen, echo] = displays();
  expect(displays()).toHaveLength(2);
  expect(echo).toMatchObject({ width: screen.width, height: screen.height });
  const echoContext = contexts.get(echo)!;
  expect(echoContext.drawImage).toHaveBeenCalledExactlyOnceWith(screen, 0, 0);
  expect(echoContext).toMatchObject({ globalCompositeOperation: "copy" });
  expect(
    contexts.get(screen)!.drawImage.mock.invocationCallOrder[0],
  ).toBeLessThan(echoContext.drawImage.mock.invocationCallOrder[0]);
  expect(style()).toContain("isolation: isolate");
  expect(style()).toContain("mix-blend-mode: multiply");
  expect(style()).toContain("opacity: 0.4");
  expect(style()).toContain("translate: 2px -3px");
});

test("the echo copies the display once per present, reading nothing back and allocating nothing", () => {
  const { canvas, contexts, displays } = mountEchoed({
    shadow: "40",
    ghost: "70",
    paletteBase: "#889d58",
    paletteInk: "#1f3326",
  });
  const context = canvas.getContext("2d")!;
  context.putImageData(pixels(255), 0, 0);
  canvas.present();
  context.putImageData(pixels(0), 0, 0);
  presentFor(canvas, 100, 60);
  const echo = contexts.get(displays()[1])!;
  echo.drawImage.mockClear();

  const allocations = countAllocations();
  try {
    presentFor(canvas, 100, 60);
  } finally {
    allocations.restore();
  }

  expect(echo.drawImage).toHaveBeenCalledTimes(6);
  expect(fake.reads).toBe(0);
  expect(allocations.count()).toBe(0);
});

test("without data-shadow there is no echo and the style has none of its rules", () => {
  const { canvas, displays, style } = mountEchoed({});
  canvas.present();

  expect(displays()).toHaveLength(1);
  expect(style()).not.toContain("isolation");
  expect(style()).not.toContain("mix-blend-mode");
});

test("turning data-shadow off removes the echo, and turning it on again brings it back", () => {
  const { canvas, contexts, displays } = mountEchoed({ shadow: "40" });
  draw(canvas, 100);
  canvas.present();
  const echo = contexts.get(displays()[1])!;

  canvas.dataset.shadow = "0";
  canvas.present();
  expect(displays()).toHaveLength(1);
  expect(echo.drawImage).toHaveBeenCalledTimes(1);

  canvas.dataset.shadow = "40";
  canvas.present();
  expect(displays()).toHaveLength(2);
});

test("turning data-shadow on for a drawn manual canvas copies the display into the echo at once", () => {
  const { canvas, contexts, displays } = mountEchoed({});
  draw(canvas, 100);
  canvas.present();

  canvas.dataset.shadow = "40";

  const [screen, echo] = displays();
  expect(contexts.get(echo)!.drawImage).toHaveBeenCalledExactlyOnceWith(
    screen,
    0,
    0,
  );
});

test("the echo is stacked above the display at its corner and shares the canvas's size and margin", () => {
  const { style } = mountEchoed({ shadow: "40" });
  const echoRule = /\.echo \{[^}]*\}/.exec(style())![0];
  const canvasRule = /(?:^|\s)canvas \{[^}]*\}/.exec(style())![0];

  expect(echoRule).toContain("z-index: 1");
  expect(echoRule).toContain("inset: 0 auto auto 0");
  expect(echoRule).toContain("position: absolute");
  expect(echoRule).not.toContain("inline-size");
  expect(canvasRule).toContain("inline-size");
  expect(canvasRule).toContain("margin");
});

test("a gap and scale lay out with the echo exactly as without it", () => {
  const { canvas, style } = mountEchoed({
    gap: "5",
    scale: "8",
    shape: "circle",
  });
  const without = style();
  canvas.dataset.shadow = "40";
  const withEcho = style();

  expect(withEcho).toContain("var(--emulated-canvas-scale, 8px)");
  expect(withEcho).toContain("calc(var(--scale) + 5px)");
  expect(withEcho.startsWith(without.trimEnd())).toBe(true);
});

test("changing data-shadow-x and data-shadow-y moves the same echo", () => {
  const { canvas, displays, style } = mountEchoed({
    shadow: "40",
    shadowX: "2",
    shadowY: "-3",
  });
  const echo = displays()[1];

  canvas.dataset.shadowX = "7";
  canvas.dataset.shadowY = "0";
  canvas.dataset.shadow = "60";

  expect(displays()[1]).toBe(echo);
  expect(style()).toContain("translate: 7px 0px");
  expect(style()).toContain("opacity: 0.6");
});

test.each([
  ["x", false, ""],
  ["-5", false, ""],
  ["0", false, ""],
  ["150", true, "opacity: 1;"],
])("data-shadow=%j gives an echo: %s", (shadow, echoed, opacity) => {
  const { displays, style } = mountEchoed({ shadow });

  expect(displays()).toHaveLength(echoed ? 2 : 1);
  expect(style()).toContain(opacity);
  if (!echoed) expect(style()).not.toContain("mix-blend-mode");
});

test("an invalid data-shadow-x or data-shadow-y offsets by nothing", () => {
  const { style } = mountEchoed({ shadow: "40", shadowX: "x", shadowY: "" });

  expect(style()).toContain("translate: 0px 0px");
});

test("a manual canvas copies to the echo on present, and reset and transition keep it copying", () => {
  const { canvas, contexts, displays } = mountEchoed({ shadow: "40" });
  const echo = contexts.get(displays()[1])!;
  draw(canvas, 100);
  canvas.present();
  expect(echo.drawImage).toHaveBeenCalledTimes(1);

  canvas.reset();
  canvas.present();
  expect(echo.drawImage).toHaveBeenCalledTimes(2);

  canvas.transition();
  canvas.present();
  canvas.present();
  expect(echo.drawImage).toHaveBeenCalledTimes(4);
});

/** Each draw and fill on the echo, with the composite operation and fill in effect at the time. */
function echoCalls(echo: PlainContext) {
  const state = echo as unknown as CanvasRenderingContext2D;
  const calls: string[] = [];
  echo.drawImage.mockImplementation(() =>
    calls.push(`drawImage ${state.globalCompositeOperation}`),
  );
  echo.fillRect.mockImplementation(() =>
    calls.push(
      `fillRect ${state.globalCompositeOperation} ${String(state.fillStyle)}`,
    ),
  );
  return calls;
}

const POCKET = { paletteBase: "#889d58", paletteInk: "#1f3326" };

test("with a palette the echo divides its copy by the base, so off pixels cast no shadow", () => {
  const { canvas, contexts, displays } = mountEchoed({
    shadow: "40",
    ...POCKET,
  });
  const echo = contexts.get(displays()[1])!;
  const calls = echoCalls(echo);
  draw(canvas, 100);

  canvas.present();

  expect(calls).toEqual([
    "drawImage copy",
    "fillRect color-dodge rgb(119 98 167)",
  ]);
  expect(echo.fillRect).toHaveBeenCalledWith(0, 0, 1, 1);
});

test("without a palette the echo stays a plain copy, so dropping the palette stops the dodge", () => {
  const { canvas, contexts, displays } = mountEchoed({
    shadow: "40",
    ...POCKET,
  });
  const calls = echoCalls(contexts.get(displays()[1])!);
  draw(canvas, 100);

  delete canvas.dataset.paletteBase;
  canvas.present();

  expect(calls).toEqual(["drawImage copy"]);
});

test("changing the palette base changes the echo's fill", () => {
  const { canvas, contexts, displays } = mountEchoed({
    shadow: "40",
    ...POCKET,
  });
  const calls = echoCalls(contexts.get(displays()[1])!);
  draw(canvas, 100);

  canvas.dataset.paletteBase = "#e8a33a";
  canvas.present();

  expect(calls.at(-1)).toBe("fillRect color-dodge rgb(23 92 197)");
});

test("turning data-shadow on for a drawn manual canvas with a palette dodges the echo at once", () => {
  const { canvas, contexts, displays } = mountEchoed(POCKET);
  draw(canvas, 100);
  canvas.present();

  canvas.dataset.shadow = "40";

  const echo = contexts.get(displays()[1])!;
  expect(echo.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 1, 1);
  expect(echo.drawImage.mock.invocationCallOrder[0]).toBeLessThan(
    echo.fillRect.mock.invocationCallOrder[0],
  );
  expect(echo).toMatchObject({
    globalCompositeOperation: "color-dodge",
    fillStyle: "rgb(119 98 167)",
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
