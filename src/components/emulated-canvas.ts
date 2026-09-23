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

/**
 * A canvas stand-in that hides its display surface. Consumers draw into an
 * `OffscreenCanvas` through `getContext`, and a real `<canvas>` in a closed
 * shadow root is blitted from that bitmap.
 *
 * The consumer's context is returned untouched — no proxying or replaying — so
 * mirroring is just a straight copy of the finished pixels each frame.
 */
class EmulatedCanvas extends HTMLElement {
  static DEFAULT_WIDTH = 64;
  static DEFAULT_HEIGHT = 64;

  #innerCanvas?: OffscreenCanvas;
  #outerCanvas?: HTMLCanvasElement;
  #outerContext?: CanvasRenderingContext2D;
  #frame?: number;
  #mirrorRequested = false;

  connectedCallback() {
    this.#initialize();
    if (this.#mirrorRequested) this.#startMirroring();
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

    this.#innerCanvas = new OffscreenCanvas(width, height);

    const outerCanvas = document.createElement("canvas");
    outerCanvas.width = width;
    outerCanvas.height = height;
    this.#outerCanvas = outerCanvas;

    const shadow = this.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent =
      ":host { display: inline-block; line-height: 0; } canvas { display: block; inline-size: 100%; block-size: auto; }";
    shadow.append(style, outerCanvas);
  }

  #dimension(name: "width" | "height", fallback: number) {
    const value = this.dataset[name];
    return value !== undefined ? Number.parseInt(value) : fallback;
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

    context.clearRect(0, 0, innerCanvas.width, innerCanvas.height);
    context.drawImage(innerCanvas, 0, 0);
  }
}

customElements.define("emulated-canvas", EmulatedCanvas);
