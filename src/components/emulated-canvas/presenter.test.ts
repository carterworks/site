import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  countAllocations,
  installSoftCanvas,
  SoftContext,
} from "../../test/toy-canvas";
import { type Geometry, Presenter } from "./presenter";

const PLAIN: Geometry = {
  scale: 1,
  gap: 0,
  shape: "square",
  shadow: { opacity: 0, x: 0, y: 0 },
};

const SHADOW = { opacity: 40, x: 2, y: -3 };

const BASE = "#889d58";

beforeEach(() => {
  installSoftCanvas();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A presenter of a `columns` x 1 bitmap on a shadow root of its own, open so the test can look in. */
function mount(geometry: Partial<Geometry> = {}, columns = 2) {
  const root = document.createElement("div").attachShadow({ mode: "open" });
  const presenter = new Presenter(root, columns, 1);
  presenter.configure({ ...PLAIN, ...geometry });
  const canvases = () => [...root.querySelectorAll("canvas")];
  const style = () => root.querySelector("style")?.textContent ?? "";
  return { presenter, root, canvases, style };
}

const contextOf = (canvas: HTMLCanvasElement) =>
  canvas.getContext("2d") as unknown as SoftContext;

const pixelsOf = (canvas: HTMLCanvasElement) => [
  ...contextOf(canvas).bitmap.pixels,
];

/** A one-row image of these RGBA pixels. */
function row(...rgba: number[][]) {
  return new ImageData(Uint8ClampedArray.from(rgba.flat()), rgba.length, 1);
}

/** An offscreen bitmap holding these RGBA pixels, in a row. */
function bitmap(...rgba: number[][]) {
  const canvas = new OffscreenCanvas(rgba.length, 1);
  contextOf(canvas as unknown as HTMLCanvasElement).putImageData(
    row(...rgba),
    0,
    0,
  );
  return canvas;
}

const GREEN = [0, 200, 0, 255];
const BLUE = [0, 0, 200, 255];

describe("the display", () => {
  test("is a bitmap-sized canvas after the stylesheet", () => {
    const { root } = mount({ scale: 8, gap: 5 }, 80);

    expect([...root.children].map((child) => child.nodeName)).toEqual([
      "STYLE",
      "CANVAS",
    ]);
    expect(root.querySelector("canvas")).toMatchObject({
      width: 80,
      height: 1,
    });
  });

  test("shows image data as its pixels", () => {
    const { presenter, canvases } = mount();

    presenter.show(row(GREEN, BLUE));

    expect(pixelsOf(canvases()[0])).toEqual([...GREEN, ...BLUE]);
  });

  test("shows an offscreen bitmap as its pixels", () => {
    const { presenter, canvases } = mount();

    presenter.show(bitmap(GREEN, BLUE));

    expect(pixelsOf(canvases()[0])).toEqual([...GREEN, ...BLUE]);
  });

  test("replaces what it showed outright, in one copy and with no clear", () => {
    const { presenter, canvases } = mount();
    presenter.show(row(GREEN, BLUE));
    const clear = vi.spyOn(SoftContext.prototype, "clearRect");
    const draws = vi.spyOn(SoftContext.prototype, "drawImage");

    presenter.show(bitmap([0, 0, 0, 0], [9, 9, 9, 128]));

    expect(pixelsOf(canvases()[0])).toEqual([0, 0, 0, 0, 9, 9, 9, 128]);
    expect(draws).toHaveBeenCalledOnce();
    expect(draws.mock.lastCall?.slice(1)).toEqual([0, 0]);
    expect(clear).not.toHaveBeenCalled();
  });
});

describe("the stylesheet", () => {
  test("enlarges each pixel into a cell of the scale, with cells spaced by the gap", () => {
    const { style } = mount({ scale: 8, gap: 5 }, 80);

    expect(style()).toContain("var(--emulated-canvas-scale, 8px)");
    expect(style()).toContain("calc(var(--scale) + 5px)");
    expect(style()).toContain("inline-size: calc(80 * var(--stride))");
    expect(style()).toContain("image-rendering: pixelated");
  });

  test.each([
    ["square", 5],
    ["circle", 0],
    ["circle", 5],
  ] as const)(
    "a %s cell with gap %i is cut by painting over the canvas, never by masking it",
    (shape, gap) => {
      const { style } = mount({ shape, gap });

      expect(style()).not.toContain("mask");
      expect(style()).toContain("var(--emulated-canvas-gap-color, Canvas)");
    },
  );

  test("an ungapped square grid paints nothing over the canvas", () => {
    expect(mount({ shape: "square", gap: 0 }).style()).not.toContain(
      "--emulated-canvas-gap-color",
    );
  });

  test("is rewritten by configure", () => {
    const { presenter, style } = mount({ scale: 3 });

    presenter.configure({ ...PLAIN, scale: 4 });

    expect(style()).toContain("var(--emulated-canvas-scale, 4px)");
    expect(style()).not.toContain("3px");
  });
});

describe("a pixel shadow", () => {
  test("layers one echo of the display's size over it, multiplied and offset", () => {
    const { canvases, style } = mount({ shadow: SHADOW });

    const [display, echo] = canvases();
    expect(canvases()).toHaveLength(2);
    expect(echo.className).toBe("echo");
    expect(echo).toMatchObject({
      width: display.width,
      height: display.height,
    });
    expect(style()).toContain("isolation: isolate");
    expect(style()).toContain("mix-blend-mode: multiply");
    expect(style()).toContain("opacity: 0.4");
    expect(style()).toContain("translate: 2px -3px");
  });

  test("stacks the echo above the display at its corner, sharing the canvas's size and margin", () => {
    const { style } = mount({ shadow: SHADOW });
    const echoRule = /\.echo \{[^}]*\}/.exec(style())![0];
    const canvasRule = /(?:^|\s)canvas \{[^}]*\}/.exec(style())![0];

    expect(echoRule).toContain("z-index: 1");
    expect(echoRule).toContain("inset: 0 auto auto 0");
    expect(echoRule).toContain("position: absolute");
    expect(echoRule).not.toContain("inline-size");
    expect(canvasRule).toContain("inline-size");
    expect(canvasRule).toContain("margin");
  });

  test("lays a gap and scale out exactly as without it", () => {
    const cells = { gap: 5, scale: 8, shape: "circle" } as const;
    const { presenter, style } = mount(cells);
    const without = style();

    presenter.configure({ ...PLAIN, ...cells, shadow: SHADOW });

    expect(style().startsWith(without.trimEnd())).toBe(true);
  });

  test("at full opacity is opaque", () => {
    const { style } = mount({ shadow: { opacity: 100, x: 0, y: 0 } });

    expect(style()).toContain("opacity: 1;");
    expect(style()).toContain("translate: 0px 0px");
  });

  test("is absent at zero opacity, with none of its rules", () => {
    const { canvases, style } = mount();

    expect(canvases()).toHaveLength(1);
    expect(style()).not.toContain("isolation");
    expect(style()).not.toContain("mix-blend-mode");
  });

  test("moving it or changing its opacity keeps the same echo", () => {
    const { presenter, canvases, style } = mount({ shadow: SHADOW });
    const echo = canvases()[1];

    presenter.configure({ ...PLAIN, shadow: { opacity: 60, x: 7, y: 0 } });

    expect(canvases()[1]).toBe(echo);
    expect(style()).toContain("translate: 7px 0px");
    expect(style()).toContain("opacity: 0.6");
  });

  test("turning it off removes the echo, and turning it on again brings one back", () => {
    const { presenter, canvases } = mount({ shadow: SHADOW });

    presenter.configure(PLAIN);
    expect(canvases()).toHaveLength(1);

    presenter.configure({ ...PLAIN, shadow: SHADOW });
    expect(canvases()).toHaveLength(2);
  });
});

/** Each draw and fill on an echo, with the composite operation and fill in effect at the time. */
function echoCalls() {
  const calls: string[] = [];
  const isEcho = (context: SoftContext) => context.canvas?.className === "echo";
  const { drawImage, fillRect } = SoftContext.prototype;
  vi.spyOn(SoftContext.prototype, "drawImage").mockImplementation(function (
    this: SoftContext,
    ...args
  ) {
    if (isEcho(this)) calls.push(`drawImage ${this.globalCompositeOperation}`);
    drawImage.apply(this, args);
  });
  vi.spyOn(SoftContext.prototype, "fillRect").mockImplementation(function (
    this: SoftContext,
    ...args
  ) {
    if (isEcho(this)) {
      calls.push(
        `fillRect ${this.globalCompositeOperation} ${this.fillStyle} ${args.join(" ")}`,
      );
    }
    fillRect.apply(this, args);
  });
  return calls;
}

const DODGE = "fillRect color-dodge rgb(119 98 167) 0 0 2 1";

describe("the echo", () => {
  test("copies the display once per show, after the display is drawn, allocating nothing", () => {
    const { presenter, canvases } = mount({ shadow: SHADOW });
    const [display, echo] = canvases();
    presenter.show(row(GREEN, BLUE));
    const image = row(BLUE, GREEN);
    const frames = [image, bitmap(GREEN, GREEN), image, bitmap(GREEN, GREEN)];
    const calls: string[] = [];
    for (const name of ["putImageData", "drawImage"] as const) {
      const write = SoftContext.prototype[name] as (...args: unknown[]) => void;
      vi.spyOn(SoftContext.prototype, name).mockImplementation(function (
        this: SoftContext,
        ...args: unknown[]
      ) {
        const target = this === contextOf(echo) ? "echo" : "display";
        const source =
          args[0] === display
            ? ` from the display at ${args[1]} ${args[2]}`
            : "";
        calls.push(`${target} ${name}${source}`);
        write.apply(this, args);
      });
    }

    const allocations = countAllocations();
    try {
      for (const frame of frames) presenter.show(frame);
    } finally {
      allocations.restore();
    }

    const echoCopy = "echo drawImage from the display at 0 0";
    expect(calls).toEqual([
      ...["display putImageData", echoCopy, "display drawImage", echoCopy],
      ...["display putImageData", echoCopy, "display drawImage", echoCopy],
    ]);
    expect(pixelsOf(echo)).toEqual([...GREEN, ...GREEN]);
    expect(allocations.count()).toBe(0);
  });

  test("without a palette is a plain copy of the display", () => {
    const { presenter, canvases } = mount({ shadow: SHADOW });
    const calls = echoCalls();

    presenter.show(row(GREEN, BLUE));

    expect(calls).toEqual(["drawImage copy"]);
    expect(pixelsOf(canvases()[1])).toEqual([...GREEN, ...BLUE]);
  });

  test("with a palette divides its copy by the base, so only pixels darker than the base cast a shadow", () => {
    const { presenter, canvases } = mount({
      shadow: { ...SHADOW, unlit: BASE },
    });
    const calls = echoCalls();

    presenter.show(row([0x88, 0x9d, 0x58, 255], [0x1f, 0x33, 0x26, 255]));

    expect(calls).toEqual(["drawImage copy", DODGE]);
    const shadow = pixelsOf(canvases()[1]);
    expect(shadow.slice(0, 4)).toEqual([255, 255, 255, 255]);
    expect(shadow.slice(4)).not.toEqual([255, 255, 255, 255]);
  });

  test("dropping the palette stops the dodge, and changing its base changes the fill", () => {
    const { presenter } = mount({ shadow: { ...SHADOW, unlit: BASE } });
    const calls = echoCalls();

    presenter.configure({ ...PLAIN, shadow: SHADOW });
    presenter.show(row(GREEN, BLUE));
    expect(calls).toEqual(["drawImage copy"]);

    presenter.configure({ ...PLAIN, shadow: { ...SHADOW, unlit: "#e8a33a" } });
    presenter.show(row(GREEN, BLUE));
    expect(calls.at(-1)).toBe("fillRect color-dodge rgb(23 92 197) 0 0 2 1");
  });

  test.each([
    ["without a palette", undefined, ["drawImage copy"]],
    ["with a palette", BASE, ["drawImage copy", DODGE]],
  ])(
    "turned on %s after a show copies the display at once",
    (_, unlit, expected) => {
      const { presenter, canvases } = mount();
      presenter.show(row(GREEN, BLUE));
      const calls = echoCalls();

      presenter.configure({ ...PLAIN, shadow: { ...SHADOW, unlit } });

      expect(calls).toEqual(expected);
      expect(canvases()).toHaveLength(2);
    },
  );

  test("turned on before anything is shown copies nothing", () => {
    const { presenter } = mount();
    const calls = echoCalls();

    presenter.configure({ ...PLAIN, shadow: { ...SHADOW, unlit: BASE } });

    expect(calls).toEqual([]);
  });
});
