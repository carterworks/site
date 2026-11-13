import { colourRgb } from "./colour";

/** How the display draws its cells and their shadow, as the element's `data-*` attributes set it. */
export type Geometry = {
  /** Cell size and the space between cells, in CSS pixels. */
  scale: number;
  gap: number;
  shape: "square" | "circle";
  /**
   * The echo's opacity (0–100, 0 for none), its offset in CSS pixels and, when
   * a palette sets one, the colour of an unlit pixel, which casts no shadow.
   */
  shadow: { opacity: number; x: number; y: number; unlit?: string };
};

/**
 * The echo is a copy of the display, offset and multiplied over it, like the
 * shadow each lit pixel casts on an LCD's backplate. It sits above the gap
 * overlay so the shadow falls across the gaps too, and the host isolates the
 * blend so it darkens only the display, never the page behind it.
 */
function echoStyle({ opacity, x, y }: Geometry["shadow"]) {
  if (opacity === 0) return "";
  return `
    :host {
      isolation: isolate;
    }
    .echo {
      inset: 0 auto auto 0;
      mix-blend-mode: multiply;
      opacity: ${opacity / 100};
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
  #echoContext?: CanvasRenderingContext2D;
  #echoDodge?: string;

  constructor(root: ShadowRoot, columns: number, rows: number) {
    this.#columns = columns;
    this.#rows = rows;
    this.#display = document.createElement("canvas");
    this.#display.width = columns;
    this.#display.height = rows;
    this.#style = document.createElement("style");
    root.append(this.#style, this.#display);
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
    if (frame instanceof ImageData) context.putImageData(frame, 0, 0);
    else context.drawImage(frame, 0, 0);
    this.#copyToEcho();
  }

  /** Created only once a shadow is wanted, so a canvas without one pays nothing. */
  #showEcho({ opacity, unlit }: Geometry["shadow"]) {
    if (opacity === 0) {
      this.#echoContext?.canvas.remove();
      this.#echoContext = undefined;
      return;
    }
    const created = this.#echoContext === undefined;
    const context = (this.#echoContext ??= this.#createEcho());
    if (context === undefined) return;
    this.#echoDodge = dodgeColour(unlit);
    if (this.#echoDodge !== undefined) context.fillStyle = this.#echoDodge;
    if (created && this.#context !== undefined) this.#copyToEcho();
  }

  #createEcho() {
    const echo = document.createElement("canvas");
    echo.className = "echo";
    echo.width = this.#columns;
    echo.height = this.#rows;
    const context = echo.getContext("2d");
    if (context !== null) this.#display.after(echo);
    return context ?? undefined;
  }

  /**
   * One GPU-side copy of what the display just showed, with no read-back. The
   * multiply blend composites at display resolution, but only when this runs.
   */
  #copyToEcho() {
    const echo = this.#echoContext;
    if (echo === undefined) return;
    const display = this.#display;
    echo.globalCompositeOperation = "copy";
    echo.drawImage(display, 0, 0);
    if (this.#echoDodge === undefined) return;
    echo.globalCompositeOperation = "color-dodge";
    echo.fillRect(0, 0, display.width, display.height);
  }
}

/**
 * A colour-dodge by the unlit colour's inverse divides the echo by it, so an
 * unlit pixel multiplies by white and casts nothing. Without a palette the
 * unlit colour is unknown, and a plain multiply is the same rule with white as
 * unlit.
 */
function dodgeColour(unlit: string | undefined) {
  if (unlit === undefined) return undefined;
  const [r, g, b] = colourRgb(unlit);
  return `rgb(${255 - r} ${255 - g} ${255 - b})`;
}
