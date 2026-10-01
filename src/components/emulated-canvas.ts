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

/**
 * Cell geometry for one frame. The same numbers drive the outer canvas's size
 * and every shader, so the display and its contents can never disagree.
 */
type Grid = {
  /** Logical dimensions, in source pixels. */
  columns: number;
  rows: number;
  /** Cell size and the gap between cells, in display pixels. */
  scale: number;
  gap: number;
  /** Distance between one cell's origin and the next. */
  stride: number;
  /** Display dimensions, in pixels. */
  width: number;
  height: number;
};

function gridOf(
  columns: number,
  rows: number,
  scale: number,
  gap: number,
): Grid {
  return {
    columns,
    rows,
    scale,
    gap,
    stride: scale + gap,
    width: columns * scale + Math.max(0, columns - 1) * gap,
    height: rows * scale + Math.max(0, rows - 1) * gap,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Everything a shader is handed when it paints a frame. */
type ShaderFrame = {
  /**
   * The bitmap to display. A shader may replace it — `ghost` swaps in the
   * panel buffer it maintains.
   */
  source: OffscreenCanvas;
  /** The display context, already holding whatever earlier shaders painted. */
  context: CanvasRenderingContext2D;
  /** Cell geometry for this frame. */
  grid: Grid;
  /** Cell form. */
  shape: PixelShape;
  /** How much of the previous frame the panel keeps, 0–1. */
  ghost: number;
};

/**
 * One stage of the display pipeline. Shaders run in order against the same
 * display context, so each sees — and may paint over — what came before.
 * Write one and add it to `SHADERS`; that is the whole contract.
 */
type Shader = (frame: ShaderFrame) => void;

/** One panel buffer per source bitmap, so its state survives between frames. */
const panels = new WeakMap<OffscreenCanvas, OffscreenCanvas>();

/** Retention is capped below 1 so the panel can never freeze on one frame. */
const MAX_GHOST = 0.98;

/**
 * Emulates an LCD's slow pixel response: each frame the panel keeps `ghost` of
 * its previous state and moves the rest of the way toward the new frame, so
 * fast motion leaves a fading trail. Runs before `magnify` and hands the later
 * shaders a persistent buffer holding the smeared image.
 */
const ghost: Shader = (frame) => {
  const retention = frame.ghost;
  if (retention <= 0) return;

  const source = frame.source;
  let panel = panels.get(source);
  if (
    panel === undefined ||
    panel.width !== source.width ||
    panel.height !== source.height
  ) {
    panel = new OffscreenCanvas(source.width, source.height);
    panels.set(source, panel);
    // Seed the panel with this frame so it starts opaque; otherwise a high
    // retention would fade in from transparent over many frames.
    panel.getContext("2d")?.drawImage(source, 0, 0);
    frame.source = panel;
    return;
  }

  const context = panel.getContext("2d");
  if (context === null) return;

  // `source-over` with `1 - retention` opacity: the new frame fills that
  // fraction of the panel and the previous one supplies the rest.
  context.globalAlpha = 1 - retention;
  context.drawImage(source, 0, 0);
  context.globalAlpha = 1;

  frame.source = panel;
};

/** Paints the logical bitmap, magnifying each pixel into a `scale`-sized cell. */
const magnify: Shader = ({ source, context, grid }) => {
  // Identity: the display surface is the bitmap, so a straight copy suffices.
  if (grid.scale === 1 && grid.gap === 0) {
    context.drawImage(source, 0, 0);
    return;
  }

  context.imageSmoothingEnabled = false;
  // Scale each source pixel to a full stride, then clear the gap strips. The
  // display bounds clip the trailing gap. This preserves cell geometry while
  // replacing columns × rows bitmap draws with one draw and columns + rows
  // cheap clears (6,400 draws -> one for the site's 80×80 backdrop).
  context.drawImage(
    source,
    0,
    0,
    grid.columns * grid.stride,
    grid.rows * grid.stride,
  );
  if (grid.gap === 0) return;
  for (let x = 0; x < grid.columns - 1; x += 1) {
    context.clearRect(x * grid.stride + grid.scale, 0, grid.gap, grid.height);
  }
  for (let y = 0; y < grid.rows - 1; y += 1) {
    context.clearRect(0, y * grid.stride + grid.scale, grid.width, grid.gap);
  }
};

/** Masks the frame to the circle inscribed in every cell. */
const circles: Shader = ({ context, grid, shape }) => {
  if (shape !== "circle") return;

  context.fillStyle = "#000";
  context.globalCompositeOperation = "destination-in";
  context.fill(circleMask(grid));
  context.globalCompositeOperation = "source-over";
};

/** Circle masks are built once per geometry and reused across frames. */
const circleMasks = new WeakMap<Grid, Path2D>();

function circleMask(grid: Grid): Path2D {
  const cached = circleMasks.get(grid);
  if (cached !== undefined) return cached;

  const radius = grid.scale / 2;
  const path = new Path2D();
  for (let y = 0; y < grid.rows; y += 1) {
    for (let x = 0; x < grid.columns; x += 1) {
      const cx = x * grid.stride + radius;
      const cy = y * grid.stride + radius;
      path.moveTo(cx + radius, cy);
      path.arc(cx, cy, radius, 0, Math.PI * 2);
    }
  }
  circleMasks.set(grid, path);
  return path;
}

/**
 * The display pipeline, top to bottom. To add an effect, write a `Shader` and
 * add it to this list.
 */
const SHADERS: Shader[] = [ghost, magnify, circles];

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
  /** Cell size, in display pixels. Defaults to 1. */
  scale?: number;
  /** Space between cells, in display pixels. Defaults to 0. */
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
 * cell size in canvas pixels (default 1), `data-gap` the space between cells
 * (default 0), and `data-shape` the cell form — `"square"` (default) or
 * `"circle"`, a circle inscribed in the cell. With the defaults the outer
 * canvas is a straight 1:1 mirror.
 *
 * `data-ghost` (0–100, default 0) emulates an LCD's slow pixel response: it is
 * the percentage of the previous frame the panel keeps each frame, so moving
 * content smears into a fading trail. It is capped just below 100 so the panel
 * can never freeze. The knobs are live: changing them re-renders on the spot.
 *
 * Painting goes through `SHADERS`, an ordered list of whole-frame passes. The
 * gap and scale are themselves a shader (`magnify`), and every pass shares the
 * frame's `Grid`, so a new effect is just another function in that list.
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
  #grid?: Grid;
  #gridKey = "";
  #scale = EmulatedCanvas.DEFAULT_SCALE;
  #gap = EmulatedCanvas.DEFAULT_GAP;
  #shape: PixelShape = EmulatedCanvas.DEFAULT_SHAPE;
  #ghost = EmulatedCanvas.DEFAULT_GHOST / 100;
  #mirrorFrame?: number;
  #mirrorRequested = false;

  connectedCallback() {
    this.#initialize();
    if (this.#mirrorRequested) this.#startMirroring();
  }

  /** Re-read the render knobs and repaint when they change at runtime. */
  attributeChangedCallback() {
    if (this.#innerCanvas === undefined) return;
    this.#configure();
    this.#resizeOuter();
    // While mirroring, the rAF loop repaints every frame anyway, so blitting
    // here would only duplicate work — and a live slider fires many changes.
    if (this.#mirrorFrame === undefined) this.#blit();
  }

  disconnectedCallback() {
    this.#stopMirroring();
  }

  getContext(contextId: OffscreenRenderingContextId, options?: unknown) {
    const innerCanvas = this.#innerCanvas;
    if (innerCanvas === undefined) return null;

    this.#mirrorRequested = true;
    if (this.isConnected) this.#startMirroring();

    return getInnerContext(innerCanvas, contextId, options);
  }

  #initialize() {
    if (this.#innerCanvas !== undefined) return;

    const width = this.#integer("width", EmulatedCanvas.DEFAULT_WIDTH);
    const height = this.#integer("height", EmulatedCanvas.DEFAULT_HEIGHT);
    this.#configure();

    this.#innerCanvas = new OffscreenCanvas(width, height);

    const outerCanvas = document.createElement("canvas");
    this.#outerCanvas = outerCanvas;
    this.#resizeOuter();

    const shadow = this.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent =
      ":host { display: inline-block; line-height: 0; } canvas { display: block; image-rendering: pixelated; inline-size: 100%; block-size: auto; }";
    shadow.append(style, outerCanvas);
  }

  #configure() {
    this.#scale = this.#integer("scale", EmulatedCanvas.DEFAULT_SCALE);
    this.#gap = this.#integer("gap", EmulatedCanvas.DEFAULT_GAP);
    this.#shape =
      this.dataset.shape === "circle" ? "circle" : EmulatedCanvas.DEFAULT_SHAPE;
    this.#ghost = clamp(
      this.#integer("ghost", EmulatedCanvas.DEFAULT_GHOST) / 100,
      0,
      MAX_GHOST,
    );
    // The grid is rebuilt lazily in #gridFor, keyed by the numbers that size
    // it. Leaving the cache alone here lets a non-geometric knob (shape,
    // ghost) reuse the same Grid — and with it the cached circle mask.
  }

  #integer(
    name: "width" | "height" | "scale" | "gap" | "ghost",
    fallback: number,
  ) {
    const value = this.dataset[name];
    return value !== undefined ? Number.parseInt(value) : fallback;
  }

  /** The current cell geometry, rebuilt only when its numbers change. */
  #gridFor() {
    const innerCanvas = this.#innerCanvas;
    if (innerCanvas === undefined) return undefined;
    const key = `${innerCanvas.width}x${innerCanvas.height}:${this.#scale}:${this.#gap}`;
    if (this.#grid === undefined || this.#gridKey !== key) {
      this.#grid = gridOf(
        innerCanvas.width,
        innerCanvas.height,
        this.#scale,
        this.#gap,
      );
      this.#gridKey = key;
    }
    return this.#grid;
  }

  #resizeOuter() {
    const outerCanvas = this.#outerCanvas;
    const grid = this.#gridFor();
    if (outerCanvas === undefined || grid === undefined) return;
    // Assigning width/height resets the canvas, so only do it on a real change.
    if (
      outerCanvas.width === grid.width &&
      outerCanvas.height === grid.height
    ) {
      return;
    }

    outerCanvas.width = grid.width;
    outerCanvas.height = grid.height;
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

    const context = this.#outerContext ?? outerCanvas.getContext("2d");
    if (context === null) return;
    this.#outerContext = context;

    const grid = this.#gridFor();
    if (grid === undefined) return;

    context.clearRect(0, 0, outerCanvas.width, outerCanvas.height);

    const frame: ShaderFrame = {
      source: innerCanvas,
      context,
      grid,
      shape: this.#shape,
      ghost: this.#ghost,
    };
    for (const shader of SHADERS) shader(frame);
  }
}

customElements.define("emulated-canvas", EmulatedCanvas);
