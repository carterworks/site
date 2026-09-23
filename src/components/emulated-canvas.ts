class EmulatedCanvas extends HTMLElement {
  static DEFAULT_WIDTH = 64;
  static DEFAULT_HEIGHT = 64;

  #innerCanvas?: OffscreenCanvas;
  #outerCanvas?: HTMLCanvasElement;

  connectedCallback() {
    const width =
      this.dataset.width !== undefined
        ? Number.parseInt(this.dataset.width)
        : EmulatedCanvas.DEFAULT_WIDTH;
    const height =
      this.dataset.height !== undefined
        ? Number.parseInt(this.dataset.height)
        : EmulatedCanvas.DEFAULT_HEIGHT;
    this.#innerCanvas = new OffscreenCanvas(width, height);
    this.#outerCanvas = document.createElement("canvas");
    this.appendChild(this.#outerCanvas);
  }

  getContext(contextId: OffscreenRenderingContextId) {
    return this.#innerCanvas?.getContext(contextId);
  }
}

customElements.define("emulated-canvas", EmulatedCanvas);
