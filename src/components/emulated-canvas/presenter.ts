import { multiplyOverlay, type Rgb } from "../../lib/rgb";
import { colourRgb } from "./colour";

/** Every cell form, the default first. */
export const SHAPES = [
  "square",
  "circle",
  "ring",
  "diamond",
  "dash",
  "slash",
  "cross",
] as const;

export type PixelShape = (typeof SHAPES)[number];

/** How the display draws its cells and their shadow, as the element's `data-*` attributes set it. */
export type Geometry = {
  /** Cell size and the space between cells, in CSS pixels. */
  scale: number;
  gap: number;
  shape: PixelShape;
  /**
   * The shadow's opacity (0–100, 0 for none), its offset in CSS pixels and, when
   * a palette sets one, the colour of an unlit pixel, which casts no shadow.
   */
  shadow: { opacity: number; x: number; y: number; unlit?: string };
};

/**
 * The echo is the shadow each pixel casts on an LCD's backplate, offset over
 * the display. It sits above the gap overlay so the shadow falls across the
 * gaps too; the host is a stacking context so that lift stays inside it, never
 * over the page or anything laid over the canvas.
 */
function echoStyle({ opacity, x, y }: Geometry["shadow"]) {
  if (opacity === 0) return "";
  return `
    :host {
      isolation: isolate;
    }
    .echo {
      inset: 0 auto auto 0;
      pointer-events: none;
      position: absolute;
      translate: ${x}px ${y}px;
      z-index: 1;
    }
  `;
}

const INK = "var(--emulated-canvas-gap-color, Canvas)";
const CELL = "var(--scale)";
const STRIDE = "var(--stride)";

/**
 * `inside` within `half` of the line through the tile's centre across
 * `angle`, `outside` beyond. Edges fade over one CSS pixel, as a hard stop
 * would alias.
 */
const band = (angle: string, half: string, inside: string, outside: string) =>
  `linear-gradient(${angle}, ${outside} calc(50% - ${half} - 0.5px), ${inside} calc(50% - ${half} + 0.5px) calc(50% + ${half} - 0.5px), ${outside} calc(50% + ${half} + 0.5px))`;

const disc = (x: string, radius: string) =>
  `radial-gradient(circle at ${x} 50%, #000 calc(${radius} - 0.5px), transparent calc(${radius} + 0.5px))`;

/** Ink beyond the corner at x, y of the tile, toward the quadrant that starts `from`. */
const corner = (from: number, x: string, y: string) =>
  `conic-gradient(from ${from}deg at calc(50% ${x}) calc(50% ${y}), ${INK} 0 90deg, transparent 0)`;

/**
 * The overlay's paint, which leaves each cell's shape clear. Shapes are sized
 * by the cell, which the page may set in CSS, so they are gradients that
 * read it, each in a tile one stride square centred on its cell. Most are
 * paint alone; a capsule has no gradients whose ink adds up to its outside,
 * so the dash masks the overlay instead, which never changes, so it costs
 * once.
 */
function cutOut(shape: PixelShape, gap: number, lead: number) {
  const stripes = (direction: string) =>
    `repeating-linear-gradient(${direction}, ${INK} 0 ${lead}px, transparent 0 calc(${lead}px + ${CELL}), ${INK} 0 ${STRIDE})`;
  const gaps = gap > 0 ? [stripes("to right"), stripes("to bottom")] : [];
  // An odd gap leaves the cell half a pixel off the tile's centre.
  const offset = lead - gap / 2;
  const tile = (image: string) =>
    `${image} ${offset}px ${offset}px / ${STRIDE} ${STRIDE}`;
  const paint = (...layers: string[]) =>
    `background: ${layers.join(", ") || "none"};`;
  const outside = (angle: string, half: string) =>
    tile(band(angle, half, "transparent", INK));
  const thin = `max(1px, ${CELL} * 0.22)`;
  switch (shape) {
    case "square":
      return paint(...gaps);
    case "circle":
      return paint(
        tile(
          `radial-gradient(circle calc(${CELL} / 2), transparent calc(100% - 0.5px), ${INK} calc(100% + 0.5px))`,
        ),
      );
    case "ring": {
      const outer = `calc(${CELL} / 2)`;
      const inner = `calc(${CELL} / 2 - max(1px, ${CELL} * 0.2))`;
      return paint(
        tile(
          `radial-gradient(circle, ${INK} calc(${inner} - 0.5px), transparent calc(${inner} + 0.5px) calc(${outer} - 0.5px), ${INK} calc(${outer} + 0.5px))`,
        ),
      );
    }
    case "diamond": {
      // Corner to corner 1.24 cells, as half diagonals of 0.62 / √2.
      const half = `calc(${CELL} * 0.4384)`;
      return paint(outside("45deg", half), outside("135deg", half));
    }
    case "slash":
      return paint(
        outside("135deg", `calc(${thin} / 2)`),
        outside("45deg", `calc(${CELL} * 0.7071)`),
      );
    case "cross": {
      const arm = `calc(${thin} / 2)`;
      return paint(
        ...gaps,
        tile(corner(0, `+ ${arm}`, `- ${arm}`)),
        tile(corner(90, `+ ${arm}`, `+ ${arm}`)),
        tile(corner(180, `- ${arm}`, `+ ${arm}`)),
        tile(corner(270, `- ${arm}`, `- ${arm}`)),
      );
    }
    case "dash": {
      const radius = `calc(${CELL} * 0.2)`;
      const reach = `calc(${CELL} * 0.3)`;
      const opaque = (angle: string, half: string) =>
        tile(band(angle, half, "#000", "transparent"));
      return `
        background: ${INK};
        mask:
          linear-gradient(#000 0 0) subtract,
          ${tile(disc(`calc(50% + ${reach})`, radius))} add,
          ${tile(disc(`calc(50% - ${reach})`, radius))} add,
          ${opaque("90deg", reach)} intersect,
          ${opaque("0deg", radius)};`;
    }
  }
}

/**
 * Cells are enlarged and cut out in CSS, so the display's backing store stays
 * the bitmap's size and a frame costs one tiny copy instead of a full-screen
 * repaint. Each logical pixel is stretched over a whole stride (cell + gap) and
 * a static overlay paints the gaps (and a circle's corners) over it in
 * `--emulated-canvas-gap-color`. A mask would cut the same shapes, but the
 * compositor re-applies a mask to content that changes every frame, while the
 * overlay never changes, so it is rasterised once and reused.
 *
 * The canvas is shifted back by half a gap so each pixel's edges fall inside
 * the gaps around its cell: at a fractional devicePixelRatio the browser rounds
 * the canvas's pixel edges and the overlay's edges differently, and an edge on
 * the cell boundary would show a sliver of the neighbouring cell. The margins
 * also take the leftover half gaps out of layout, so the box ends at the last
 * cell, and the host clips the half gaps that overhang it.
 *
 * The canvas is inline rather than block so those negative margins can't
 * collapse through a block-level host and change its height.
 */
function displayStyle(
  columns: number,
  rows: number,
  { scale, gap, shape, shadow }: Geometry,
) {
  const lead = Math.floor(gap / 2);
  const overhang = `${-lead}px ${lead - gap}px ${lead - gap}px ${-lead}px`;

  return `
    :host {
      --scale: var(--emulated-canvas-scale, ${scale}px);
      --stride: calc(var(--scale) + ${gap}px);
      display: inline-block;
      line-height: 0;
      overflow: clip;
      position: relative;
    }
    canvas {
      image-rendering: pixelated;
      inline-size: calc(${columns} * var(--stride));
      block-size: calc(${rows} * var(--stride));
      margin: ${overhang};
      vertical-align: top;
    }
    :host::after {
      ${cutOut(shape, gap, lead)}
      content: "";
      inset: ${overhang};
      pointer-events: none;
      position: absolute;
    }
    ${echoStyle(shadow)}`;
}

/**
 * Puts a bitmap-sized frame on screen: a real `<canvas>` (the display) in the
 * given shadow root, the stylesheet that draws its pixels as cells, and the
 * echo that casts their shadow.
 */
export class Presenter {
  readonly #columns: number;
  readonly #rows: number;
  readonly #style: HTMLStyleElement;
  readonly #display: HTMLCanvasElement;
  #context?: CanvasRenderingContext2D;
  #echo?: {
    context: CanvasRenderingContext2D;
    shadow: ImageData;
    words: Uint32Array;
  };
  #opacity = 0;
  /** The unlit colour as configured, so only a change of it is parsed and recast. */
  #unlitColour?: string;
  #unlit: Rgb = WHITE;
  /** The last frame shown as pixels, to recast when the shadow changes. */
  #shown?: ImageData;
  /** The same pixels a word each, kept while the frame keeps its buffer. */
  #shownWords?: Uint32Array;
  readonly #factor: Rgb = [1, 1, 1];
  readonly #paint: Rgb = [0, 0, 0];

  constructor(root: ShadowRoot, columns: number, rows: number) {
    this.#columns = columns;
    this.#rows = rows;
    this.#display = document.createElement("canvas");
    this.#display.width = columns;
    this.#display.height = rows;
    this.#style = document.createElement("style");
    root.append(this.#style, this.#display);
  }

  /** A shadow is cast from the frame's pixels, so while one is on, `show` must be given them. */
  get needsPixels() {
    return this.#echo !== undefined;
  }

  /** Rewrites the stylesheet, so it belongs to attribute changes, never to a present. */
  configure(geometry: Geometry) {
    this.#showEcho(geometry.shadow);
    this.#style.textContent = displayStyle(this.#columns, this.#rows, geometry);
  }

  /** Shows the frame: image data as its pixels, a bitmap as drawn. False when the display cannot draw. */
  show(frame: ImageData | OffscreenCanvas) {
    let context = this.#context;
    if (context === undefined) {
      const created = this.#display.getContext("2d");
      if (created === null) return false;
      // `copy` replaces the display outright, so no clear is needed first.
      created.globalCompositeOperation = "copy";
      context = this.#context = created;
    }
    if (frame instanceof ImageData) {
      context.putImageData(frame, 0, 0);
      this.#shown = frame;
      if (this.#shownWords?.buffer !== frame.data.buffer) {
        this.#shownWords = new Uint32Array(frame.data.buffer);
      }
    } else {
      context.drawImage(frame, 0, 0);
      this.#shown = undefined;
    }
    this.#cast();
    return true;
  }

  /** Created only once a shadow is wanted, so a canvas without one pays nothing. */
  #showEcho({ opacity, unlit }: Geometry["shadow"]) {
    if (opacity === 0) {
      this.#echo?.context.canvas.remove();
      this.#echo = undefined;
      return;
    }
    const created = this.#echo === undefined;
    const recast =
      created || opacity / 100 !== this.#opacity || unlit !== this.#unlitColour;
    this.#echo ??= this.#createEcho();
    if (created) this.#readShownBitmap();
    if (!recast) return;
    this.#opacity = opacity / 100;
    this.#unlitColour = unlit;
    this.#unlit = unlit === undefined ? WHITE : colourRgb(unlit);
    this.#cast();
  }

  /**
   * A bitmap shown before the shadow was on left its pixels only on the
   * display, so they are read back from it once, as the shadow turns on:
   * never per frame, as every frame after brings its own.
   */
  #readShownBitmap() {
    const context = this.#context;
    if (this.#echo === undefined || context === undefined) return;
    if (this.#shown !== undefined) return;
    const shown = context.getImageData(0, 0, this.#columns, this.#rows);
    this.#shown = shown;
    this.#shownWords = new Uint32Array(shown.data.buffer);
  }

  #createEcho() {
    const echo = document.createElement("canvas");
    echo.className = "echo";
    echo.width = this.#columns;
    echo.height = this.#rows;
    const context = echo.getContext("2d");
    if (context === null) return undefined;
    this.#display.after(echo);
    const shadow = new ImageData(this.#columns, this.#rows);
    return { context, shadow, words: new Uint32Array(shadow.data.buffer) };
  }

  /**
   * An LCD's shadow multiplies what it falls on by each pixel's darkening
   * from unlit, but a multiply blend re-blends the whole viewport on every
   * present, which costs software rendering more than all else on the page.
   * Plain paint cast here from the pixels already in hand is exact wherever
   * it falls on unlit, which is most of the screen; see `multiplyOverlay`.
   * A frame is mostly runs of one colour, so a pixel the same as the one
   * before copies its shadow, which cuts the cast to a tenth.
   */
  #cast() {
    const echo = this.#echo;
    if (echo === undefined) return;
    const frame = this.#shown;
    const words = this.#shownWords;
    if (frame === undefined || words === undefined) {
      echo.context.clearRect(0, 0, this.#columns, this.#rows);
      return;
    }
    const pixels = frame.data;
    const shadow = echo.shadow.data;
    const shadowWords = echo.words;
    const unlit = this.#unlit;
    const factor = this.#factor;
    const paint = this.#paint;
    for (let at = 0, i = 0; at < words.length; at += 1, i += 4) {
      if (at > 0 && words[at] === words[at - 1]) {
        shadowWords[at] = shadowWords[at - 1];
        continue;
      }
      const strength = (this.#opacity * pixels[i + 3]) / 255;
      for (let c = 0; c < 3; c += 1) {
        factor[c] = 1 - strength * darkening(pixels[i + c], unlit[c]);
      }
      const alpha = multiplyOverlay(unlit, factor, paint);
      shadow[i] = paint[0];
      shadow[i + 1] = paint[1];
      shadow[i + 2] = paint[2];
      shadow[i + 3] = alpha * 255;
    }
    echo.context.putImageData(echo.shadow, 0, 0);
  }
}

/** Without a palette, white is unlit, so a pixel darkens by how far it is from white. */
const WHITE: Rgb = [255, 255, 255];

/** How much darker than unlit a channel is, 0–1; nothing is darker than a channel of zero. */
const darkening = (value: number, unlit: number) =>
  unlit === 0 ? 0 : Math.max(0, 1 - value / unlit);
