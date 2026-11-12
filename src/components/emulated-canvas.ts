import { clamp, MAX_GHOST } from "./emulated-canvas-limits";

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

/** What every shader is told about the frame it is processing. */
export type ShaderFrame = {
  /** Logical dimensions, in source pixels. */
  width: number;
  height: number;
  /** Time since the previous present, in milliseconds. */
  elapsedMs: number;
  /** The element's `dataset`, where each pass reads its own `data-*` knobs. */
  data: DOMStringMap;
};

/**
 * One element's instance of a shader. `apply` edits the logical bitmap's RGBA
 * bytes in place and returns true while its output is still changing, so the
 * owner knows to keep presenting. A pass whose knobs leave it off reports so
 * through `active`, a pure query checked first: when no pass is active the
 * bitmap skips the pixel read-back and goes to the display in one copy. A pass
 * that goes inactive and active again is rebuilt, so it starts from the
 * current frame, not a stale one.
 */
export type ShaderPass = {
  active(frame: ShaderFrame): boolean;
  apply(pixels: Uint8ClampedArray, frame: ShaderFrame): boolean;
};

/**
 * Builds a pass for one element, so any state it keeps between frames belongs
 * to that element. A pass reads its own knobs from `frame.data`, so a new
 * effect never touches the element: write one, add it to `SHADERS` and
 * document its `data-*` attribute. For example, a two-colour palette:
 *
 * ```ts
 * const palette: Shader = () => ({
 *   active: ({ data }) => data.palette !== undefined,
 *   apply(pixels, { data }) {
 *     const [dark, light] = data.palette!.split(",").map(Number);
 *     for (let i = 0; i < pixels.length; i += 4)
 *       pixels.fill(pixels[i] < 128 ? dark : light, i, i + 3);
 *     return false;
 *   },
 * });
 * ```
 */
export type Shader = () => ShaderPass;

const SIXTY_HZ_FRAME_MS = 1000 / 60;

/** `data-ghost` as the share of the previous frame kept per 60 Hz frame. */
function retention({ ghost }: DOMStringMap) {
  const percent = Number.parseInt(ghost ?? "");
  return Number.isFinite(percent) ? clamp(percent / 100, 0, MAX_GHOST) : 0;
}

/**
 * A channel within one 8-bit level of its target snaps to it. The step is
 * invisible and ends the fade instead of approaching it forever, and a slowly
 * drifting frame, whose pixels creep a level at a time, then counts as settled
 * instead of keeping its owner presenting at full rate.
 */
const SETTLED_LEVELS = 1;

/**
 * Emulates an LCD's slow pixel response: every channel moves toward the new
 * frame along an exponential with time constant τ, so fast motion leaves a
 * fading trail. Driving it by elapsed time rather than per frame keeps the
 * trail the same length at any refresh rate, and keeping the state in floats
 * lets it land on the frame exactly instead of stalling a few 8-bit steps
 * short.
 */
const ghost: Shader = () => {
  let panel: Float32Array | undefined;
  return {
    active: ({ data }) => retention(data) > 0,
    apply(pixels, { elapsedMs, data }) {
      const ghost = retention(data);
      if (panel?.length !== pixels.length) {
        // Seed the panel with this frame so it starts opaque; otherwise a high
        // retention would fade in from transparent.
        panel = Float32Array.from(pixels);
        return false;
      }
      // Retention r per 60 Hz frame is the same curve as τ = -frame / ln r.
      const tau = SIXTY_HZ_FRAME_MS / -Math.log(ghost);
      const response = 1 - Math.exp(-elapsedMs / tau);
      let changing = false;
      for (let i = 0; i < pixels.length; i += 1) {
        const target = pixels[i];
        const level = panel[i] + (target - panel[i]) * response;
        if (Math.abs(target - level) < SETTLED_LEVELS) {
          panel[i] = target;
        } else {
          panel[i] = level;
          pixels[i] = level;
          changing = true;
        }
      }
      return changing;
    },
  };
};

/**
 * Per-pixel passes over the logical bitmap, in order. To add an effect, write a
 * `Shader` and add it to this list.
 */
export const SHADERS: Shader[] = [ghost];

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
 * the percentage of the previous frame the panel keeps per 60 Hz frame, so
 * moving content smears into a fading trail that lasts as long at any refresh
 * rate. It is capped just below 100 so the panel can never freeze. The knobs
 * are live.
 *
 * Effects like the ghost are `SHADERS`, an ordered list of per-pixel passes
 * that run on the logical bitmap, never at display resolution, so each costs
 * the same however large the cells are drawn.
 *
 * The canvas presents on its own, the way a plain `<canvas>` shows what is
 * drawn on it: drawing through the 2D context queues a present for when the
 * drawing code returns, so a frame drawn in an animation frame shows in that
 * same frame, and several calls cost one present. While a pass is still
 * changing the display, the canvas keeps presenting every animation frame,
 * then stops. `data-manual` opts out: the owner calls `present()` itself.
 *
 * The context is the inner canvas's own, with only its pixel-writing methods
 * wrapped to note that the bitmap changed: nothing is proxied or replayed, so
 * drawing costs what it costs on any canvas. A `putImageData` of the whole
 * bitmap hands the passes those pixels, sparing them a read-back; any other
 * drawing is read back once, on the present after it.
 */
export class EmulatedCanvas extends HTMLElement {
  static DEFAULT_WIDTH = 64;
  static DEFAULT_HEIGHT = 64;
  static DEFAULT_SCALE = 1;
  static DEFAULT_GAP = 0;
  static DEFAULT_SHAPE: PixelShape = "square";
  static observedAttributes = [
    "data-scale",
    "data-gap",
    "data-shape",
    "data-ghost",
    "data-manual",
  ];

  #innerCanvas?: OffscreenCanvas;
  #outerCanvas?: HTMLCanvasElement;
  #outerContext?: CanvasRenderingContext2D;
  #readback?: OffscreenCanvasRenderingContext2D | null;
  #watched?: OffscreenCanvasRenderingContext2D;
  /** The consumer's pixels as last drawn, kept for presents with nothing new drawn. */
  #source?: ImageData;
  /** What the passes edit and the display shows. */
  #output?: ImageData;
  /** Drawn on since the last present, so `#source` is out of date. */
  #drawn = false;
  /** The image a whole-bitmap `putImageData` drew, if nothing was drawn after it. */
  #handed?: ImageData;
  #presentQueued = false;
  #passes = SHADERS.map((shader) => shader());
  #wasActive = new Set<ShaderPass>();
  #frame: ShaderFrame = {
    width: 0,
    height: 0,
    elapsedMs: 0,
    data: this.dataset,
  };
  #presentedAt?: number;
  #style?: HTMLStyleElement;
  #nextFrame?: number;

  connectedCallback() {
    this.#initialize();
    this.#requestPresent();
  }

  attributeChangedCallback(name: string) {
    if (name === "data-manual") this.#cancelNext();
    else this.#configure();
    this.#requestPresent();
  }

  disconnectedCallback() {
    this.#cancelNext();
  }

  getContext(contextId: "2d"): OffscreenCanvasRenderingContext2D | null;
  getContext(
    contextId: OffscreenRenderingContextId,
    options?: unknown,
  ): object | null;
  getContext(contextId: OffscreenRenderingContextId, options?: unknown) {
    const context = getInnerContext(this.#bitmap(), contextId, options);
    if (contextId === "2d" && context !== null) {
      this.#watch(context as OffscreenCanvasRenderingContext2D);
    }
    return context;
  }

  /** The bitmap's real width, readable before the element is connected. */
  get width() {
    return (
      this.#innerCanvas?.width ??
      this.#integer("width", EmulatedCanvas.DEFAULT_WIDTH, 1)
    );
  }

  get height() {
    return (
      this.#innerCanvas?.height ??
      this.#integer("height", EmulatedCanvas.DEFAULT_HEIGHT, 1)
    );
  }

  /**
   * Paints the current bitmap now; the owner of a `data-manual` canvas calls
   * this. Returns whether the shaders are still changing the display, so an
   * owner whose bitmap is static knows when it can stop presenting.
   */
  present() {
    return this.#blit();
  }

  /** Drops every pass's state, so the next present shows the bitmap opaque. */
  reset() {
    this.#passes = SHADERS.map((shader) => shader());
    this.#wasActive.clear();
  }

  /** Created on demand: a consumer may ask for the context before connection. */
  #bitmap() {
    return (this.#innerCanvas ??= new OffscreenCanvas(this.width, this.height));
  }

  /**
   * Wraps the methods that write pixels as own properties of the context, so
   * the context stays the native object, with its prototype, getters and
   * setters intact. `arguments` keeps each call's arity, which `drawImage`
   * and `putImageData` overload on.
   */
  #watch(context: OffscreenCanvasRenderingContext2D) {
    if (this.#watched === context) return;
    this.#watched = context;
    const owner = context as unknown as Record<string, unknown>;
    const changed = this.#changed;
    for (const name of PIXEL_WRITERS) {
      const write = owner[name];
      if (typeof write !== "function") continue;
      Object.defineProperty(owner, name, {
        configurable: true,
        value: function (this: unknown) {
          const result = write.apply(context, arguments);
          changed(name, arguments);
          return result;
        },
      });
    }
  }

  #changed = (name: string, args: IArguments) => {
    const image = args[0] as ImageData;
    const whole =
      name === "putImageData" &&
      args.length === 3 &&
      args[1] === 0 &&
      args[2] === 0 &&
      image.width === this.width &&
      image.height === this.height;
    this.#handed = whole ? image : undefined;
    this.#drawn = true;
    this.#requestPresent();
  };

  /** Presents once the code drawing now returns, however many calls it makes. */
  #requestPresent() {
    if (this.#presentQueued || !this.#presents()) return;
    this.#presentQueued = true;
    queueMicrotask(() => {
      this.#presentQueued = false;
      if (this.#presents()) this.#follow(this.#blit());
    });
  }

  /** Only once a consumer draws, and never for a manual or detached canvas. */
  #presents() {
    return (
      this.#watched !== undefined &&
      this.isConnected &&
      this.dataset.manual === undefined
    );
  }

  /**
   * A present cancels the one scheduled before it, so a consumer drawing every
   * frame never gets a second present in the same frame.
   */
  #follow(changing: boolean) {
    this.#cancelNext();
    if (!changing) return;
    this.#nextFrame = requestAnimationFrame(() => {
      this.#nextFrame = undefined;
      this.#follow(this.#blit());
    });
  }

  #cancelNext() {
    if (this.#nextFrame === undefined) return;
    cancelAnimationFrame(this.#nextFrame);
    this.#nextFrame = undefined;
  }

  #initialize() {
    if (this.#outerCanvas !== undefined) return;

    const { width, height } = this;

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
    const style = this.#style;
    if (style === undefined) return;
    const innerCanvas = this.#bitmap();

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
  }

  #integer(
    name: "width" | "height" | "scale" | "gap",
    fallback: number,
    min: number,
  ) {
    const parsed = Number.parseInt(this.dataset[name] ?? "");
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
  }

  #blit() {
    const outerCanvas = this.#outerCanvas;
    if (outerCanvas === undefined) return false;
    const innerCanvas = this.#bitmap();

    let context = this.#outerContext;
    if (context === undefined) {
      const created = outerCanvas.getContext("2d");
      if (created === null) return false;
      // `copy` replaces the display outright, so no clear is needed first.
      created.globalCompositeOperation = "copy";
      context = this.#outerContext = created;
    }

    const frame = this.#frame;
    const now = performance.now();
    frame.width = innerCanvas.width;
    frame.height = innerCanvas.height;
    frame.elapsedMs = now - (this.#presentedAt ?? now);
    this.#presentedAt = now;

    const handed = this.#handed;
    this.#handed = undefined;
    let image: ImageData | undefined;
    let changing = false;
    for (let index = 0; index < this.#passes.length; index += 1) {
      const pass = this.#passes[index];
      if (!pass.active(frame)) {
        if (this.#wasActive.delete(pass))
          this.#passes[index] = SHADERS[index]();
        continue;
      }
      this.#wasActive.add(pass);
      image ??= this.#pixels(innerCanvas, handed);
      if (image === undefined) break;
      changing = pass.apply(image.data, frame) || changing;
    }

    if (image === undefined) context.drawImage(innerCanvas, 0, 0);
    else context.putImageData(image, 0, 0);
    return changing;
  }

  /**
   * A copy of the consumer's pixels for the passes to edit: they must stay the
   * consumer's to draw over, and the next present starts from them again.
   */
  #pixels(innerCanvas: OffscreenCanvas, handed?: ImageData) {
    if (this.#drawn || this.#source === undefined) {
      this.#drawn = false;
      if (handed === undefined) {
        this.#source = this.#read(innerCanvas);
      } else {
        this.#source = this.#fit(this.#source, handed);
        this.#source.data.set(handed.data);
      }
    }
    const source = this.#source;
    if (source === undefined) return undefined;
    const output = (this.#output = this.#fit(this.#output, source));
    output.data.set(source.data);
    return output;
  }

  #fit(image: ImageData | undefined, like: ImageData) {
    return image?.width === like.width && image.height === like.height
      ? image
      : new ImageData(like.width, like.height);
  }

  /**
   * The bitmap's pixels, copied through a 2D canvas kept on the CPU: the
   * consumer's context may not be 2D, so it has no `getImageData` to read, and
   * reading back a GPU-backed one could force it off the GPU.
   */
  #read(source: OffscreenCanvas) {
    if (this.#readback === undefined) {
      this.#readback = new OffscreenCanvas(
        source.width,
        source.height,
      ).getContext("2d", { willReadFrequently: true });
      if (this.#readback !== null) {
        this.#readback.globalCompositeOperation = "copy";
      }
    }
    const readback = this.#readback;
    if (readback === null) return undefined;
    readback.drawImage(source, 0, 0);
    return readback.getImageData(0, 0, source.width, source.height);
  }
}

/** The 2D context's methods that change pixels; every other call leaves them be. */
const PIXEL_WRITERS = [
  "clearRect",
  "fillRect",
  "strokeRect",
  "fill",
  "stroke",
  "fillText",
  "strokeText",
  "drawImage",
  "putImageData",
  "reset",
];

if (!customElements.get("emulated-canvas")) {
  customElements.define("emulated-canvas", EmulatedCanvas);
}

declare global {
  interface HTMLElementTagNameMap {
    "emulated-canvas": EmulatedCanvas;
  }
}
