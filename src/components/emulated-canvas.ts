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

/** Everything a shader is handed when it paints a frame. */
type ShaderFrame = {
  /** The bitmap the consumer drew into. */
  source: OffscreenCanvas;
  /** The display context, already holding whatever earlier shaders painted. */
  context: CanvasRenderingContext2D;
  /** Cell geometry for this frame. */
  grid: Grid;
  /** Cell form. */
  shape: PixelShape;
};

/**
 * One stage of the display pipeline. Shaders run in order against the same
 * display context, so each sees — and may paint over — what came before.
 * Write one and add it to `SHADERS`; that is the whole contract.
 */
type Shader = (frame: ShaderFrame) => void;

/** Paints the logical bitmap, magnifying each pixel into a `scale`-sized cell. */
const magnify: Shader = ({ source, context, grid }) => {
  // Identity: the display surface is the bitmap, so a straight copy suffices.
  if (grid.scale === 1 && grid.gap === 0) {
    context.drawImage(source, 0, 0);
    return;
  }

  context.imageSmoothingEnabled = false;
  for (let y = 0; y < grid.rows; y += 1) {
    for (let x = 0; x < grid.columns; x += 1) {
      context.drawImage(
        source,
        x,
        y,
        1,
        1,
        x * grid.stride,
        y * grid.stride,
        grid.scale,
        grid.scale,
      );
    }
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
const SHADERS: Shader[] = [magnify, circles];

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
 * canvas is a straight 1:1 mirror. The magnification knobs are live: changing
 * them re-renders on the spot.
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
  static observedAttributes = ["data-scale", "data-gap", "data-shape"];

  #innerCanvas?: OffscreenCanvas;
  #outerCanvas?: HTMLCanvasElement;
  #outerContext?: CanvasRenderingContext2D;
  #grid?: Grid;
  #scale = EmulatedCanvas.DEFAULT_SCALE;
  #gap = EmulatedCanvas.DEFAULT_GAP;
  #shape: PixelShape = EmulatedCanvas.DEFAULT_SHAPE;
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
    this.#blit();
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

    const width = this.#dimension("width", EmulatedCanvas.DEFAULT_WIDTH);
    const height = this.#dimension("height", EmulatedCanvas.DEFAULT_HEIGHT);
    this.#configure();

    this.#innerCanvas = new OffscreenCanvas(width, height);

    const outerCanvas = document.createElement("canvas");
    this.#outerCanvas = outerCanvas;
    this.#resizeOuter();

    const shadow = this.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent =
      ":host { display: inline-block; line-height: 0; } canvas { display: block; inline-size: 100%; block-size: auto; }";
    shadow.append(style, outerCanvas);
  }

  #configure() {
    this.#scale = this.#dimension("scale", EmulatedCanvas.DEFAULT_SCALE);
    this.#gap = this.#dimension("gap", EmulatedCanvas.DEFAULT_GAP);
    this.#shape =
      this.dataset.shape === "circle" ? "circle" : EmulatedCanvas.DEFAULT_SHAPE;
    this.#grid = undefined;
  }

  #dimension(name: "width" | "height" | "scale" | "gap", fallback: number) {
    const value = this.dataset[name];
    return value !== undefined ? Number.parseInt(value) : fallback;
  }

  /** The current cell geometry, rebuilt only when a knob changes. */
  #gridFor() {
    const innerCanvas = this.#innerCanvas;
    if (innerCanvas === undefined) return undefined;
    this.#grid ??= gridOf(
      innerCanvas.width,
      innerCanvas.height,
      this.#scale,
      this.#gap,
    );
    return this.#grid;
  }

  #resizeOuter() {
    const outerCanvas = this.#outerCanvas;
    const grid = this.#gridFor();
    if (outerCanvas === undefined || grid === undefined) return;

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
    };
    for (const shader of SHADERS) shader(frame);
  }
}

customElements.define("emulated-canvas", EmulatedCanvas);
