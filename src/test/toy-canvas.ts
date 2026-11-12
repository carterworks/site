import { vi } from "vitest";

/**
 * A software stand-in for a 2D canvas, so toys run under happy-dom, which
 * has none. It draws the calls toys and the emulated canvas make (rectangles,
 * image data, copies) into plain straight-alpha RGBA bytes, honouring
 * `globalAlpha` and the composite modes in `BLENDS` plus `copy`, and throws on
 * any other mode rather than draw it wrong. It counts what a test checks:
 * drawing that reaches past the bitmap's edges, and pixel read-backs.
 */
export const softStats = { outOfBounds: 0, reads: 0 };

export class SoftBitmap {
  pixels: Uint8ClampedArray;
  #context?: SoftContext;
  constructor(
    public width: number,
    public height: number,
    private readonly element?: HTMLCanvasElement,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return (this.#context ??= new SoftContext(this, this.element));
  }
}

type Rgba = [number, number, number, number];

/** The colours toys fill with: `#rgb`, `#rrggbb` and `rgb()`/`rgba()`. */
function parseColour(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const digits =
      hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1];
    const channel = (at: number) =>
      Number.parseInt(digits.slice(at, at + 2), 16);
    return [channel(0), channel(2), channel(4), 255];
  }
  const rgb = /^rgba?\(\s*([^)]*?)\s*\)$/.exec(value);
  if (rgb === null) throw new Error(`unsupported colour ${value}`);
  // No array copies, which `countAllocations` would charge to the toy.
  const [r, g, b, a = "1"] = rgb[1].split(/[\s,/]+/);
  return [Number(r), Number(g), Number(b), Math.round(Number(a) * 255)];
}

/** A blend mode's function of backdrop and source channels, each 0–1. */
type Blend = (backdrop: number, source: number) => number;

const sourceOver: Blend = (_, source) => source;

/** The modes the canvas draws with, from Compositing and Blending Level 1. */
const BLENDS: Partial<Record<string, Blend>> = {
  "source-over": sourceOver,
  "color-dodge": (backdrop, source) =>
    backdrop === 0
      ? 0
      : source === 1
        ? 1
        : Math.min(1, backdrop / (1 - source)),
};

export class SoftContext {
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  imageSmoothingEnabled = true;
  #style = "#000";
  #colour: Rgba = [0, 0, 0, 255];

  constructor(
    readonly bitmap: SoftBitmap,
    readonly canvas?: HTMLCanvasElement,
  ) {}

  get fillStyle() {
    return this.#style;
  }
  set fillStyle(value: string) {
    if (value === this.#style) return;
    this.#style = value;
    this.#colour = parseColour(value);
  }

  fillRect(x: number, y: number, width: number, height: number) {
    const blend = this.#blend();
    const colour = this.#colour;
    this.#each(x, y, width, height, (i) =>
      this.#composite(i, colour, 0, blend),
    );
  }

  clearRect(x: number, y: number, width: number, height: number) {
    this.#each(x, y, width, height, (i) =>
      this.bitmap.pixels.fill(0, i, i + 4),
    );
  }

  createImageData(width: number, height: number) {
    return new ImageData(width, height);
  }

  putImageData(image: ImageData, dx: number, dy: number) {
    const { pixels } = this.bitmap;
    const { data } = image;
    this.#each(dx, dy, image.width, image.height, (i, x, y) => {
      const from = ((y - dy) * image.width + (x - dx)) * 4;
      pixels[i] = data[from];
      pixels[i + 1] = data[from + 1];
      pixels[i + 2] = data[from + 2];
      pixels[i + 3] = data[from + 3];
    });
  }

  getImageData(x: number, y: number, width: number, height: number) {
    softStats.reads += 1;
    const image = new ImageData(width, height);
    const { pixels, width: columns } = this.bitmap;
    for (let row = 0; row < height; row += 1) {
      const from = ((y + row) * columns + x) * 4;
      image.data.set(pixels.subarray(from, from + width * 4), row * width * 4);
    }
    return image;
  }

  /** Draws a whole bitmap unscaled, which is all the canvas and its tests draw. */
  drawImage(source: SoftBitmap | HTMLCanvasElement, dx: number, dy: number) {
    const bitmap =
      source instanceof SoftBitmap ? source : softCanvases.get(source);
    if (bitmap === undefined) return;
    const blend = this.#blend();
    this.#each(dx, dy, bitmap.width, bitmap.height, (i, x, y) =>
      this.#composite(
        i,
        bitmap.pixels,
        ((y - dy) * bitmap.width + (x - dx)) * 4,
        blend,
      ),
    );
  }

  /**
   * A shape is composited over the whole bitmap, transparent outside itself,
   * so `copy` clears what it does not cover; over transparent black it is then
   * the same as `source-over`.
   */
  #blend() {
    const mode = this.globalCompositeOperation;
    if (mode === "copy") {
      this.bitmap.pixels.fill(0);
      return sourceOver;
    }
    const blend = BLENDS[mode];
    if (blend === undefined) {
      throw new Error(`SoftContext cannot composite with ${mode}`);
    }
    return blend;
  }

  /**
   * Draws the straight RGBA source pixel at `source[from]` over pixel `i` by
   * the compositing spec's general formula (blend, then source-over), in
   * floats rounded to the nearest byte. A browser keeps premultiplied bytes,
   * so a translucent result can differ from it by a level or so; an opaque
   * one matches.
   */
  #composite(i: number, source: ArrayLike<number>, from: number, blend: Blend) {
    const { pixels } = this.bitmap;
    const alpha = (source[from + 3] / 255) * this.globalAlpha;
    // What the formula gives, minus its float work on the hot full-frame copies.
    if (alpha === 1 && blend === sourceOver) {
      for (let channel = 0; channel < 4; channel += 1) {
        pixels[i + channel] = source[from + channel];
      }
      return;
    }
    const below = pixels[i + 3] / 255;
    const shown = alpha + below * (1 - alpha);
    for (let channel = 0; channel < 3; channel += 1) {
      const backdrop = pixels[i + channel] / 255;
      const colour = source[from + channel] / 255;
      const mixed = (1 - below) * colour + below * blend(backdrop, colour);
      const premultiplied = alpha * mixed + (1 - alpha) * below * backdrop;
      pixels[i + channel] =
        shown === 0 ? 0 : Math.round((premultiplied / shown) * 255);
    }
    pixels[i + 3] = Math.round(shown * 255);
  }

  #each(
    x: number,
    y: number,
    width: number,
    height: number,
    visit: (index: number, x: number, y: number) => void,
  ) {
    const { width: columns, height: rows } = this.bitmap;
    if (x < 0 || y < 0 || x + width > columns || y + height > rows) {
      softStats.outOfBounds += 1;
    }
    const right = Math.min(columns, Math.ceil(x + width));
    const bottom = Math.min(rows, Math.ceil(y + height));
    for (let row = Math.max(0, Math.floor(y)); row < bottom; row += 1) {
      for (
        let column = Math.max(0, Math.floor(x));
        column < right;
        column += 1
      ) {
        visit((row * columns + column) * 4, column, row);
      }
    }
  }
}

/** Each plain `<canvas>`'s bitmap, made on its first `getContext`. */
const softCanvases = new WeakMap<HTMLCanvasElement, SoftBitmap>();

/**
 * Backs every `OffscreenCanvas` and plain `<canvas>` with a soft bitmap. The
 * returned lists hold them in creation order: an `<emulated-canvas>`'s first
 * offscreen bitmap is the one its consumer draws on.
 */
export function installSoftCanvas() {
  softStats.outOfBounds = 0;
  softStats.reads = 0;
  const offscreen: SoftBitmap[] = [];
  const plain: SoftBitmap[] = [];
  vi.stubGlobal(
    "OffscreenCanvas",
    class extends SoftBitmap {
      constructor(width: number, height: number) {
        super(width, height);
        offscreen.push(this);
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      let bitmap = softCanvases.get(this);
      if (bitmap === undefined) {
        bitmap = new SoftBitmap(this.width, this.height, this);
        softCanvases.set(this, bitmap);
        plain.push(bitmap);
      }
      return bitmap.getContext() as unknown as RenderingContext;
    },
  );
  return { offscreen, plain };
}

/**
 * Timeout for tests that step a soft canvas through tens of simulated seconds,
 * where the pixel work alone takes seconds and 5 s flakes on slow CI runners.
 */
export const SLOW_TEST_MS = 30_000;

/**
 * Fakes animation frames, timers and the clock, so a toy's loop runs on demand.
 * `frameMs` sets the display's frame gap, 16 ms by default.
 */
export function useFakeFrames(frameMs?: number) {
  vi.useFakeTimers({
    toFake: [
      ...(frameMs === undefined
        ? (["requestAnimationFrame", "cancelAnimationFrame"] as const)
        : []),
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "performance",
    ],
  });
  if (frameMs !== undefined) {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), frameMs),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  }
}

/**
 * Puts the fake frames on the display's exact grid, for a gap that is not a
 * whole number of ms. Fake timers drop the fraction of a delay, so
 * `useFakeFrames(1000 / 60)` really ticks every 16 ms; here each frame
 * carries its grid time instead. Call it after `useFakeFrames`.
 */
export function useExactFrames(frameMs: number) {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const vsync = (Math.floor(performance.now() / frameMs) + 1) * frameMs;
    return setTimeout(
      () => callback(vsync),
      Math.ceil(vsync - performance.now()),
    );
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
}

/** Lays `canvas` out at `rect`, as happy-dom lays out nothing. */
export function place(canvas: HTMLElement, rect: DOMRect) {
  canvas.getBoundingClientRect = () => rect;
}

/**
 * Dispatches a pointer event on `canvas` at its pixel (`x`, `y`), as a mouse
 * unless `init` says otherwise.
 */
export function pointerAt(
  canvas: HTMLElement & { width: number; height: number },
  type: string,
  x: number,
  y: number,
  init: PointerEventInit = {},
) {
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new PointerEvent(type, {
      clientX: rect.left + (x * rect.width) / canvas.width,
      clientY: rect.top + (y * rect.height) / canvas.height,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      ...init,
    }),
  );
}

/** Red channel of pixel (`x`, `y`): the grey level a toy drew there. */
export function levelAt(bitmap: SoftBitmap, x: number, y: number) {
  return bitmap.pixels[(y * bitmap.width + x) * 4];
}

/** How many pixels are visible: opaque enough to show, whatever their colour. */
export function litPixels(bitmap: SoftBitmap) {
  let count = 0;
  for (let at = 3; at < bitmap.pixels.length; at += 4) {
    if (bitmap.pixels[at] > 0) count += 1;
  }
  return count;
}

const BUFFERS = [
  "ArrayBuffer",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "ImageData",
  "Path2D",
  "OffscreenCanvas",
] as const;

/** Arrays this long are buffers, not a handful of bookkeeping values. */
const LARGE_ARRAY = 64;

/**
 * Whether the code that called the counted function is a dependency's,
 * like happy-dom copying its listener list on every dispatch: that is the
 * test environment's cost, not the toy's. Frames: this, the counter, its caller.
 */
const fromDependency = () =>
  (new Error().stack?.split("\n")[3] ?? "").includes("node_modules");

/**
 * Counts buffers, canvases, large arrays and array copies made until
 * `restore`. Small objects are left alone: they are cheap, and toys make them
 * freely.
 */
export function countAllocations() {
  let count = 0;
  const large = (length: unknown) =>
    typeof length === "number" && length > LARGE_ARRAY;

  const globals = globalThis as unknown as Record<string, object | undefined>;
  const stubbed = BUFFERS.map((name) => [name, globals[name]] as const);

  // Array literals and spreads are invisible, but the copying methods are not: any call, however small, is a per-frame allocation.
  type Copier = (this: unknown, ...args: unknown[]) => unknown;
  const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
  type Owned = [Record<string, Copier>, string];
  const copiers: Owned[] = [
    ...["slice", "map", "filter"].map((name): Owned => [typedArray, name]),
    ...["slice", "map", "filter", "concat", "flat", "flatMap", "toSorted"].map(
      (name): Owned => [Array.prototype as never, name],
    ),
    [Array as never, "from"],
  ];
  const originals = copiers.map(([owner, name]) => owner[name]);
  copiers.forEach(([owner, name], index) => {
    const original = originals[index];
    owner[name] = function (...args) {
      const result = original.apply(this, args);
      if (!fromDependency()) count += 1;
      return result;
    };
  });

  const counted = (target: object, counts = (_args: unknown[]) => true) =>
    new Proxy(target as new (...args: unknown[]) => object, {
      apply(target, self, args) {
        if (counts(args) && !fromDependency()) count += 1;
        return Reflect.apply(target, self, args);
      },
      construct(target, args, newTarget) {
        if (counts(args) && !fromDependency()) count += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });
  for (const [name, original] of stubbed) {
    globals[name] = counted(original ?? class {});
  }
  const array = Array;
  globals.Array = counted(Array, (args) => args.length === 1 && large(args[0]));

  return {
    count: () => count,
    restore() {
      for (const [name, original] of stubbed) globals[name] = original;
      globals.Array = array;
      copiers.forEach(([owner, name], index) => {
        owner[name] = originals[index];
      });
    },
  };
}
