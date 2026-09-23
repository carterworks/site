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
 * A canvas stand-in that hides its display surface. Consumers draw into an
 * `OffscreenCanvas` through `getContext`, and a real `<canvas>` in a closed
 * shadow root is blitted from that bitmap.
 *
 * `data-width` and `data-height` size the inner (logical) canvas. The outer
 * canvas can magnify each logical pixel into a cell: `data-scale` sets the
 * cell size in canvas pixels (default 1), `data-gap` the space between cells
 * (default 0), and `data-shape` the cell form — `"square"` (default) or
 * `"circle"`, a circle inscribed in the cell. With the defaults the outer
 * canvas is a straight 1:1 mirror. The three magnification knobs are live:
 * changing them re-renders on the spot.
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
  #mask?: Path2D;
  #scale = EmulatedCanvas.DEFAULT_SCALE;
  #gap = EmulatedCanvas.DEFAULT_GAP;
  #shape: PixelShape = EmulatedCanvas.DEFAULT_SHAPE;
  #frame?: number;
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
    this.#mask = undefined;
  }

  #dimension(name: "width" | "height" | "scale" | "gap", fallback: number) {
    const value = this.dataset[name];
    return value !== undefined ? Number.parseInt(value) : fallback;
  }

  /** The onscreen size of `count` cells laid end to end, gaps included. */
  #footprint(count: number) {
    return count * this.#scale + Math.max(0, count - 1) * this.#gap;
  }

  #resizeOuter() {
    const innerCanvas = this.#innerCanvas;
    const outerCanvas = this.#outerCanvas;
    if (innerCanvas === undefined || outerCanvas === undefined) return;

    outerCanvas.width = this.#footprint(innerCanvas.width);
    outerCanvas.height = this.#footprint(innerCanvas.height);
  }

  /** A single path covering every cell's inscribed circle, built once. */
  #circleMask() {
    if (this.#mask !== undefined) return this.#mask;
    const innerCanvas = this.#innerCanvas;
    if (innerCanvas === undefined) return undefined;

    const radius = this.#scale / 2;
    const stride = this.#scale + this.#gap;
    const path = new Path2D();
    for (let y = 0; y < innerCanvas.height; y += 1) {
      for (let x = 0; x < innerCanvas.width; x += 1) {
        const cx = x * stride + radius;
        const cy = y * stride + radius;
        path.moveTo(cx + radius, cy);
        path.arc(cx, cy, radius, 0, Math.PI * 2);
      }
    }
    this.#mask = path;
    return path;
  }

  #startMirroring() {
    if (this.#frame !== undefined) return;
    const step = () => {
      this.#blit();
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  #stopMirroring() {
    if (this.#frame === undefined) return;
    cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
  }

  #blit() {
    const innerCanvas = this.#innerCanvas;
    const outerCanvas = this.#outerCanvas;
    if (innerCanvas === undefined || outerCanvas === undefined) return;

    const context = this.#outerContext ?? outerCanvas.getContext("2d");
    if (context === null) return;
    this.#outerContext = context;

    context.clearRect(0, 0, outerCanvas.width, outerCanvas.height);

    // Identity: the display surface is the bitmap, so a straight copy suffices.
    if (this.#scale === 1 && this.#gap === 0 && this.#shape === "square") {
      context.drawImage(innerCanvas, 0, 0);
      return;
    }

    context.imageSmoothingEnabled = false;
    const stride = this.#scale + this.#gap;
    for (let y = 0; y < innerCanvas.height; y += 1) {
      for (let x = 0; x < innerCanvas.width; x += 1) {
        context.drawImage(
          innerCanvas,
          x,
          y,
          1,
          1,
          x * stride,
          y * stride,
          this.#scale,
          this.#scale,
        );
      }
    }

    if (this.#shape === "circle") {
      const mask = this.#circleMask();
      if (mask !== undefined) {
        context.fillStyle = "#000";
        context.globalCompositeOperation = "destination-in";
        context.fill(mask);
        context.globalCompositeOperation = "source-over";
      }
    }
  }
}

customElements.define("emulated-canvas", EmulatedCanvas);
