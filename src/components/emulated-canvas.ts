import { MAX_GHOST } from "./pixel-backdrop-pacing";

/** `OffscreenCanvas.getContext` is overloaded, so calls with a union id need help. */
function getInnerContext(
  canvas: OffscreenCanvas,
  contextId: OffscreenRenderingContextId,
  options?: unknown,
) {
  return (
    canvas.getContext as (id: string, options?: unknown) => object | null
  ).call(canvas, contextId, options);
}

type PixelShape = "square" | "circle";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type Geometry = {
  columns: number;
  rows: number;
  scale: number;
  gap: number;
  shape: PixelShape;
};

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
function displayStyle({ columns, rows, scale, gap, shape }: Geometry) {
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
  `;
}

/**
 * The render knobs `<emulated-canvas>` reads from its `data-*` attributes,
 * keyed by the `dataset` name each one comes from. Every knob is optional: an
 * omitted one falls back to the matching `EmulatedCanvas.DEFAULT_*`.
 */
export type EmulatedCanvasProps = {
  /** Logical width of the source bitmap, in pixels. Defaults to 64. */
  width?: number;
  /** Logical height of the source bitmap, in pixels. Defaults to 64. */
  height?: number;
  /** Cell size, in CSS pixels. Defaults to 1. */
  scale?: number;
  /** Space between cells, in CSS pixels. Defaults to 0. */
  gap?: number;
  /** Cell form. Defaults to "square". */
  shape?: PixelShape;
  /** Share of the previous frame the panel keeps, 0–100. Defaults to 0. */
  ghost?: number;
};

/**
 * A canvas stand-in that hides its display surface. Consumers draw into an
 * `OffscreenCanvas` through `getContext`, and a real `<canvas>` in a closed
 * shadow root is blitted from that bitmap.
 *
 * `data-width` and `data-height` size the inner (logical) canvas. The outer
 * canvas can magnify each logical pixel into a cell: `data-scale` sets the
 * cell size in CSS pixels (default 1), `data-gap` the space between cells
 * (default 0), and `data-shape` the cell form — `"square"` (default) or
 * `"circle"`, a circle inscribed in the cell. With the defaults the outer
 * canvas is a straight 1:1 mirror. A page can instead size cells from CSS by
 * setting `--emulated-canvas-scale` to a length on the element, which then
 * follows viewport changes without any script.
 *
 * Gaps and a circle's corners are painted over the cells rather than cut out,
 * in `--emulated-canvas-gap-color` (default `Canvas`, the page's default
 * background); set it to whatever shows behind the element.
 *
 * `data-ghost` (0–100, default 0) emulates an LCD's slow pixel response: it is
 * the percentage of the previous frame the panel keeps each frame, so moving
 * content smears into a fading trail. It is capped just below 100 so the panel
 * can never freeze. The knobs are live.
 *
 * By default the bitmap is mirrored every animation frame. `data-manual` opts
 * out: the consumer already runs its own loop, so a second one would only
 * present the previous draw. It calls `present()` after drawing instead.
 *
 * The consumer's context is returned untouched — no proxying or replaying — so
 * mirroring is just a copy of the finished pixels each frame.
 */
class EmulatedCanvas extends HTMLElement {
  static DEFAULT_WIDTH = 64;
  static DEFAULT_HEIGHT = 64;
  static DEFAULT_SCALE = 1;
  static DEFAULT_GAP = 0;
  static DEFAULT_SHAPE: PixelShape = "square";
  static DEFAULT_GHOST = 0;
  static observedAttributes = [
    "data-scale",
    "data-gap",
    "data-shape",
    "data-ghost",
  ];

  #innerCanvas?: OffscreenCanvas;
  #outerCanvas?: HTMLCanvasElement;
  #outerContext?: CanvasRenderingContext2D;
  #panel?: OffscreenCanvas;
  #style?: HTMLStyleElement;
  #ghost = EmulatedCanvas.DEFAULT_GHOST / 100;
  #mirrorFrame?: number;
  #mirrorRequested = false;

  connectedCallback() {
    this.#initialize();
    if (this.#mirrorRequested) this.#startMirroring();
  }

  attributeChangedCallback() {
    if (this.#innerCanvas === undefined) return;
    this.#configure();
  }

  disconnectedCallback() {
    this.#stopMirroring();
  }

  getContext(contextId: OffscreenRenderingContextId, options?: unknown) {
    const innerCanvas = this.#innerCanvas;
    if (innerCanvas === undefined) return null;

    if (this.dataset.manual === undefined) {
      this.#mirrorRequested = true;
      if (this.isConnected) this.#startMirroring();
    }

    return getInnerContext(innerCanvas, contextId, options);
  }

  /** Paints the current bitmap now; the owner of a `data-manual` canvas calls this. */
  present() {
    this.#blit();
  }

  /** Drops the ghost trail so the next present shows the bitmap opaque. */
  reset() {
    this.#panel = undefined;
  }

  #initialize() {
    if (this.#innerCanvas !== undefined) return;

    const width = this.#integer("width", EmulatedCanvas.DEFAULT_WIDTH, 1);
    const height = this.#integer("height", EmulatedCanvas.DEFAULT_HEIGHT, 1);
    this.#innerCanvas = new OffscreenCanvas(width, height);

    const outerCanvas = document.createElement("canvas");
    outerCanvas.width = width;
    outerCanvas.height = height;
    this.#outerCanvas = outerCanvas;

    this.#style = document.createElement("style");
    this.#configure();

    const shadow = this.attachShadow({ mode: "closed" });
    shadow.append(this.#style, outerCanvas);
  }

  #configure() {
    const innerCanvas = this.#innerCanvas;
    const style = this.#style;
    if (innerCanvas === undefined || style === undefined) return;

    style.textContent = displayStyle({
      columns: innerCanvas.width,
      rows: innerCanvas.height,
      scale: this.#integer("scale", EmulatedCanvas.DEFAULT_SCALE, 1),
      gap: this.#integer("gap", EmulatedCanvas.DEFAULT_GAP, 0),
      shape:
        this.dataset.shape === "circle"
          ? "circle"
          : EmulatedCanvas.DEFAULT_SHAPE,
    });
    this.#ghost = clamp(
      this.#integer("ghost", EmulatedCanvas.DEFAULT_GHOST, 0) / 100,
      0,
      MAX_GHOST,
    );
  }

  #integer(
    name: "width" | "height" | "scale" | "gap" | "ghost",
    fallback: number,
    min: number,
  ) {
    const parsed = Number.parseInt(this.dataset[name] ?? "");
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
  }

  #startMirroring() {
    if (this.#mirrorFrame !== undefined) return;
    const step = () => {
      this.#blit();
      this.#mirrorFrame = requestAnimationFrame(step);
    };
    this.#mirrorFrame = requestAnimationFrame(step);
  }

  #stopMirroring() {
    if (this.#mirrorFrame === undefined) return;
    cancelAnimationFrame(this.#mirrorFrame);
    this.#mirrorFrame = undefined;
  }

  #blit() {
    const innerCanvas = this.#innerCanvas;
    const outerCanvas = this.#outerCanvas;
    if (innerCanvas === undefined || outerCanvas === undefined) return;

    let context = this.#outerContext;
    if (context === undefined) {
      const created = outerCanvas.getContext("2d");
      if (created === null) return;
      // `copy` replaces the display outright, so no clear is needed first.
      created.globalCompositeOperation = "copy";
      context = this.#outerContext = created;
    }

    context.drawImage(this.#smear(innerCanvas), 0, 0);
  }

  /**
   * Emulates an LCD's slow pixel response: each frame the panel keeps `ghost`
   * of its previous state and moves the rest of the way toward the new frame,
   * so fast motion leaves a fading trail. Returns the bitmap to display.
   */
  #smear(source: OffscreenCanvas) {
    const retention = this.#ghost;
    if (retention <= 0) {
      this.#panel = undefined;
      return source;
    }

    let panel = this.#panel;
    if (panel === undefined) {
      panel = new OffscreenCanvas(source.width, source.height);
      this.#panel = panel;
      // Seed the panel with this frame so it starts opaque; otherwise a high
      // retention would fade in from transparent over many frames.
      panel.getContext("2d")?.drawImage(source, 0, 0);
      return panel;
    }

    const context = panel.getContext("2d");
    if (context === null) return source;

    // `source-over` with `1 - retention` opacity: the new frame fills that
    // fraction of the panel and the previous one supplies the rest.
    context.globalAlpha = 1 - retention;
    context.drawImage(source, 0, 0);
    context.globalAlpha = 1;
    return panel;
  }
}

if (!customElements.get("emulated-canvas")) {
  customElements.define("emulated-canvas", EmulatedCanvas);
}
