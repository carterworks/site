import { multiplyOverlay, type Rgb } from "../../lib/rgb";
import { colourRgb } from "./colour";

/** How the display draws its cells and their shadow, as the element's `data-*` attributes set it. */
export type Geometry = {
  /** Cell size and the space between cells, in CSS pixels. */
  scale: number;
  gap: number;
  shape: "square" | "circle";
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
  const cell = "var(--scale)";
  const stride = "var(--stride)";
  const ink = "var(--emulated-canvas-gap-color, Canvas)";
  const stripes = (direction: string) =>
    `repeating-linear-gradient(${direction}, ${ink} 0 ${lead}px, transparent 0 calc(${lead}px + ${cell}), ${ink} 0 ${stride})`;
  const centre = `calc(${lead}px + ${cell} / 2)`;
  // The circle's edge fades over one CSS pixel, as a hard stop would alias.
  const circle = `radial-gradient(circle calc(${cell} / 2) at ${centre} ${centre}, transparent calc(100% - 0.5px), ${ink} calc(100% + 0.5px)) 0 0 / ${stride} ${stride}`;
  const overlay =
    shape === "circle"
      ? circle
      : gap > 0
        ? `${stripes("to right")}, ${stripes("to bottom")}`
        : "none";

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
      background: ${overlay};
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
  #echo?: { context: CanvasRenderingContext2D; shadow: ImageData };
  #opacity = 0;
  #unlit: Rgb = WHITE;
  /** The last frame shown as pixels, to recast when the shadow changes. */
  #shown?: ImageData;
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

  /** Shows the frame: image data as its pixels, a bitmap as drawn. */
  show(frame: ImageData | OffscreenCanvas) {
    let context = this.#context;
    if (context === undefined) {
      const created = this.#display.getContext("2d");
      if (created === null) return;
      // `copy` replaces the display outright, so no clear is needed first.
      created.globalCompositeOperation = "copy";
      context = this.#context = created;
    }
    if (frame instanceof ImageData) {
      context.putImageData(frame, 0, 0);
      this.#shown = frame;
    } else {
      context.drawImage(frame, 0, 0);
      this.#shown = undefined;
    }
    this.#cast();
  }

  /** Created only once a shadow is wanted, so a canvas without one pays nothing. */
  #showEcho({ opacity, unlit }: Geometry["shadow"]) {
    if (opacity === 0) {
      this.#echo?.context.canvas.remove();
      this.#echo = undefined;
      return;
    }
    this.#echo ??= this.#createEcho();
    this.#opacity = opacity / 100;
    this.#unlit = unlit === undefined ? WHITE : colourRgb(unlit);
    this.#cast();
  }

  #createEcho() {
    const echo = document.createElement("canvas");
    echo.className = "echo";
    echo.width = this.#columns;
    echo.height = this.#rows;
    const context = echo.getContext("2d");
    if (context === null) return undefined;
    this.#display.after(echo);
    return { context, shadow: new ImageData(this.#columns, this.#rows) };
  }

  /**
   * An LCD's shadow multiplies what it falls on by each pixel's darkening
   * from unlit, but a multiply blend re-blends the whole viewport on every
   * present, which costs software rendering more than all else on the page.
   * Plain paint cast here from the pixels already in hand is exact wherever
   * it falls on unlit, which is most of the screen; see `multiplyOverlay`.
   */
  #cast() {
    const echo = this.#echo;
    const frame = this.#shown;
    if (echo === undefined || frame === undefined) return;
    const pixels = frame.data;
    const shadow = echo.shadow.data;
    const unlit = this.#unlit;
    const factor = this.#factor;
    const paint = this.#paint;
    for (let i = 0; i < pixels.length; i += 4) {
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
