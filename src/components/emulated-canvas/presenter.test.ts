import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  countAllocations,
  installSoftCanvas,
  SoftContext,
  softStats,
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
  test("layers one echo of the display's size over it, offset", () => {
    const { canvases, style } = mount({ shadow: SHADOW });

    const [display, echo] = canvases();
    expect(canvases()).toHaveLength(2);
    expect(echo.className).toBe("echo");
    expect(echo).toMatchObject({
      width: display.width,
      height: display.height,
    });
    expect(style()).toContain("translate: 2px -3px");
  });

  test("stacks the echo above the display and its gaps at its corner, inside the host, sharing the canvas's size and margin", () => {
    const { style } = mount({ shadow: SHADOW });
    const echoRule = /\.echo \{[^}]*\}/.exec(style())![0];
    const canvasRule = /(?:^|\s)canvas \{[^}]*\}/.exec(style())![0];

    expect(style()).toContain("isolation: isolate");
    expect(echoRule).toContain("z-index: 1");
    expect(echoRule).toContain("inset: 0 auto auto 0");
    expect(echoRule).toContain("position: absolute");
    expect(echoRule).not.toContain("inline-size");
    expect(canvasRule).toContain("inline-size");
    expect(canvasRule).toContain("margin");
  });

  test.each([
    ["square", 5],
    ["circle", 0],
    ["circle", 5],
  ] as const)(
    "on %s cells with gap %i is plain paint, never a blend or a layer opacity",
    (shape, gap) => {
      const { style } = mount({ shape, gap, shadow: SHADOW });

      expect(style()).not.toContain("mix-blend-mode");
      expect(style()).not.toContain("opacity");
    },
  );

  test("lays a gap and scale out exactly as without it", () => {
    const cells = { gap: 5, scale: 8, shape: "circle" } as const;
    const { presenter, style } = mount(cells);
    const without = style();

    presenter.configure({ ...PLAIN, ...cells, shadow: SHADOW });

    expect(style().startsWith(without.trimEnd())).toBe(true);
  });

  test("is absent at zero opacity, with none of its rules", () => {
    const { canvases, style } = mount();

    expect(canvases()).toHaveLength(1);
    expect(style()).not.toContain("isolation");
    expect(style()).not.toContain("echo");
  });

  test("moving it or changing its opacity keeps the same echo", () => {
    const { presenter, canvases, style } = mount({ shadow: SHADOW });
    const echo = canvases()[1];

    presenter.configure({ ...PLAIN, shadow: { opacity: 60, x: 7, y: 0 } });

    expect(canvases()[1]).toBe(echo);
    expect(style()).toContain("translate: 7px 0px");
  });

  test("turning it off removes the echo, and turning it on again brings one back", () => {
    const { presenter, canvases } = mount({ shadow: SHADOW });

    presenter.configure(PLAIN);
    expect(canvases()).toHaveLength(1);

    presenter.configure({ ...PLAIN, shadow: SHADOW });
    expect(canvases()).toHaveLength(2);
  });

  test("needs the frame as pixels exactly while it is on", () => {
    const { presenter } = mount();
    expect(presenter.needsPixels).toBe(false);

    presenter.configure({ ...PLAIN, shadow: SHADOW });
    expect(presenter.needsPixels).toBe(true);

    presenter.configure(PLAIN);
    expect(presenter.needsPixels).toBe(false);
  });
});

/** Pocket LCD's shadow, its palette's base unlit. */
const POCKET = { opacity: 25, x: 4, y: 4, unlit: BASE };
const UNLIT = [0x88, 0x9d, 0x58, 255];
const INK = [0x26, 0x3c, 0x2b, 255];
/** Half way from the base to the ink, as a level or a ghost leaves it. */
const MIDWAY = [87, 109, 66, 255];

describe("the echo", () => {
  /**
   * Multiplying by the dodged echo darkens a channel by o·(1 − pixel/base);
   * red, darkened most, sets the alpha, o·(1 − 38/136), and green and blue
   * the paint that leaves them as the multiply would over the base.
   */
  test("with a palette is the paint that darkens the base as multiplying by the pixel over the base would", () => {
    const { presenter, canvases } = mount({ shadow: POCKET }, 3);

    presenter.show(row(UNLIT, INK, MIDWAY));

    const shadow = pixelsOf(canvases()[1]);
    expect(shadow.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(shadow.slice(4, 8)).toEqual([0, 22, 26, 46]);
    expect(shadow.slice(8)).toEqual([0, 24, 27, 23]);
  });

  test("without a palette takes white as unlit, so grey casts plain black by its darkness and transparency casts nothing", () => {
    const { presenter, canvases } = mount(
      { shadow: { ...POCKET, unlit: undefined } },
      4,
    );

    presenter.show(
      row(
        [255, 255, 255, 255],
        [64, 64, 64, 255],
        [64, 64, 64, 128],
        [0, 0, 0, 0],
      ),
    );

    expect(pixelsOf(canvases()[1])).toEqual([
      ...[0, 0, 0, 0],
      ...[0, 0, 0, 48],
      ...[0, 0, 0, 24],
      ...[0, 0, 0, 0],
    ]);
  });

  test("is put on its canvas once per show, after the display, with no blend or fill, allocating nothing for frames in one buffer", () => {
    const { presenter, canvases } = mount({ shadow: POCKET });
    const [, echo] = canvases();
    const frame = row(INK, UNLIT);
    presenter.show(frame);
    const calls: string[] = [];
    for (const name of ["putImageData", "drawImage", "fillRect"] as const) {
      const write = SoftContext.prototype[name] as (...args: unknown[]) => void;
      vi.spyOn(SoftContext.prototype, name).mockImplementation(function (
        this: SoftContext,
        ...args: unknown[]
      ) {
        const target = this === contextOf(echo) ? "echo" : "display";
        calls.push(`${target} ${name}`);
        write.apply(this, args);
      });
    }

    const drawn = [row(UNLIT, INK), row(INK, INK)].map(({ data }) => data);

    const allocations = countAllocations();
    try {
      for (const pixels of drawn) {
        frame.data.set(pixels);
        presenter.show(frame);
        presenter.show(frame);
      }
    } finally {
      allocations.restore();
    }

    expect(calls).toEqual(
      Array(4).fill(["display putImageData", "echo putImageData"]).flat(),
    );
    expect(pixelsOf(echo)).toEqual([0, 22, 26, 46, 0, 22, 26, 46]);
    expect(allocations.count()).toBe(0);
  });

  test("a run of one colour casts one shadow along it, wherever it starts", () => {
    const { presenter, canvases } = mount({ shadow: POCKET }, 5);

    presenter.show(row(UNLIT, INK, INK, INK, UNLIT));

    expect(pixelsOf(canvases()[1])).toEqual([
      ...[0, 0, 0, 0],
      ...[0, 22, 26, 46],
      ...[0, 22, 26, 46],
      ...[0, 22, 26, 46],
      ...[0, 0, 0, 0],
    ]);
  });

  /**
   * Under a white unlit, #889d58 darkens each channel by 0.25·(255 − v)/255, blue
   * most: the alpha is 0.25·167/255, or 41.75/255, and red and green keep
   * 255·48/167 and 255·69/167 of the paint.
   */
  test("turned on after a show casts the shown frame at once, and recolours when the unlit colour changes", () => {
    const { presenter, canvases } = mount();
    presenter.show(row(UNLIT, INK));

    presenter.configure({ ...PLAIN, shadow: POCKET });
    expect(pixelsOf(canvases()[1])).toEqual([0, 0, 0, 0, 0, 22, 26, 46]);

    presenter.configure({ ...PLAIN, shadow: { ...POCKET, unlit: "#ffffff" } });
    expect(pixelsOf(canvases()[1]).slice(0, 4)).toEqual([73, 105, 0, 42]);
  });

  test("turned on before anything is shown casts nothing", () => {
    const { presenter, canvases } = mount();

    presenter.configure({ ...PLAIN, shadow: POCKET });

    expect(pixelsOf(canvases()[1])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("turned on after a bitmap casts what the display shows at once, reading it back that once", () => {
    const { presenter, canvases } = mount();
    presenter.show(bitmap(UNLIT, INK));
    softStats.reads = 0;

    presenter.configure({ ...PLAIN, shadow: POCKET });

    expect(pixelsOf(canvases()[1])).toEqual([0, 0, 0, 0, 0, 22, 26, 46]);
    expect(softStats.reads).toBe(1);
  });

  test("shown a bitmap, whose pixels it cannot cast from, shows no shadow rather than the last one", () => {
    const { presenter, canvases } = mount({ shadow: POCKET });
    presenter.show(row(INK, INK));

    presenter.show(bitmap(UNLIT, UNLIT));

    expect(pixelsOf(canvases()[1])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
