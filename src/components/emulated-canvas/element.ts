import {
  makeNoise2D,
  NOISE_OFFSET_X,
  NOISE_OFFSET_Y,
  NOISE_SEED,
} from "../backdrop-noise";
import { Pipeline } from "./pipeline";
import { type Geometry, Presenter } from "./presenter";
import type { Pace, ShaderFrame } from "./shader";
import { SHADERS } from "./shaders";

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

type PixelShape = Geometry["shape"];

const SIXTY_HZ_FRAME_MS = 1000 / 60;

/** The attributes the element reads itself; the shadow reads the palette's base as its unlit colour. */
const ATTRIBUTES = [
  "data-scale",
  "data-gap",
  "data-shape",
  "data-shadow",
  "data-shadow-x",
  "data-shadow-y",
  "data-palette-base",
  "data-palette-ink",
  "data-manual",
];

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
 * `data-shadow` (0–100, default 0) casts each pixel's shadow, like an LCD's
 * segments over their backplate: each pixel darkens what lies under it by how
 * much darker it is than unlit, at that opacity, offset by `data-shadow-x` and
 * `data-shadow-y` (whole CSS pixels, default 0). With a palette unlit is its
 * base, so only pixels darker than the base cast a shadow; without one it is
 * white. The shadow is cast from the frame's pixels on each present, so a
 * shadow over drawing other than a whole-bitmap `putImageData`, with no pass
 * on, reads the bitmap back.
 *
 * Effects are `SHADERS`, an ordered list of per-pixel passes (a drifting
 * noise, a two-colour palette and an LCD's ghosting), each documenting its own
 * live `data-*` knobs in `shaders/`. They run on the logical bitmap, never at
 * display resolution, so each costs the same however large the cells are
 * drawn.
 *
 * The canvas presents on its own, the way a plain `<canvas>` shows what is
 * drawn on it: drawing through the 2D context queues a present for when the
 * drawing code returns, so a frame drawn in an animation frame shows in that
 * same frame, and several calls cost one present. While a pass is still
 * changing the display, the canvas keeps presenting every animation frame, or
 * at about 8 fps for a pass that only drifts, then stops. `data-manual` opts
 * out: the owner calls `present()` itself.
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
  static readonly observedAttributes = [
    ...new Set([
      ...ATTRIBUTES,
      ...SHADERS.flatMap((shader) => shader.attributes),
    ]),
  ];

  #innerCanvas?: OffscreenCanvas;
  #presenter?: Presenter;
  #readback?: OffscreenCanvasRenderingContext2D | null;
  #watched?: OffscreenCanvasRenderingContext2D;
  /** The consumer's pixels as last drawn, kept for presents with nothing new drawn. */
  #source?: ImageData;
  /** What the passes edit and the display shows. */
  #output?: ImageData;
  /** Drawn on since the last present, so `#source` is out of date. */
  #drawn = false;
  #presentQueued = false;
  /** When the animation frame of the last frame-driven present began; timer presents leave it. */
  #presentedFrameAt = -Infinity;
  #drewAt = -Infinity;
  #pipeline = new Pipeline(SHADERS, this.dataset);
  #frame: ShaderFrame = {
    width: 0,
    height: 0,
    elapsedMs: 0,
  };
  #presentedAt?: number;
  #nextFrame?: number;
  #idleTimer?: number;
  /** Whether the last present showed `#output`, rather than the bitmap as is. */
  #shownImage = false;
  /** The frame a dissolve wipes away, while it runs. */
  #dissolveFrom?: Uint8ClampedArray;
  #dissolveStart?: number;
  /** Per pixel, the dissolve progress (0–1) at which it shows the new frame. */
  #threshold = new Float32Array(0);
  #dissolving = false;

  connectedCallback() {
    this.#initialize();
    this.#requestPresent();
  }

  attributeChangedCallback(name: string) {
    if (name === "data-manual") this.#cancelNext();
    else {
      this.#configure();
      this.#pipeline.configure();
    }
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
    return this.#blit() !== "still";
  }

  /**
   * Freezes the frame on show and wipes the frames drawn after it in over it,
   * blob by blob through a noise mask, so a change of scene dissolves rather
   * than cuts. The frozen frame is what was shown, styled and mid-dissolve
   * included, so nothing jumps. Before the first present there is nothing to
   * freeze, and the next frame shows at once.
   */
  transition() {
    if (this.#presentedAt === undefined) return;
    const shown = this.#shownImage
      ? this.#output?.data
      : this.#read(this.#bitmap())?.data;
    if (shown === undefined) return;
    if (this.#dissolveFrom?.length !== shown.length) {
      this.#dissolveFrom = new Uint8ClampedArray(shown.length);
      this.#threshold = dissolveThreshold(this.width, this.height);
    }
    this.#dissolveFrom.set(shown);
    this.#dissolveStart = undefined;
    this.#dissolving = true;
    this.#requestPresent();
  }

  /** Drops every pass's state and any dissolve, so the next present shows the bitmap as drawn. */
  reset() {
    this.#pipeline.reset();
    this.#dissolving = false;
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
    if (whole) {
      this.#source = this.#fit(this.#source, image);
      this.#source.data.set(image.data);
    }
    this.#drawn = !whole;
    this.#drewAt = performance.now();
    this.#requestPresent();
  };

  /** Presents once the code drawing now returns, however many calls it makes. */
  #requestPresent() {
    if (this.#presentQueued || !this.#presents()) return;
    this.#presentQueued = true;
    queueMicrotask(() => {
      this.#presentQueued = false;
      if (!this.#presents()) return;
      if (this.#presentedThisFrame()) {
        this.#cancelNext();
        this.#nextFrame = requestAnimationFrame(this.#next);
      } else {
        this.#follow(this.#blit());
      }
    });
  }

  /**
   * A frame-driven present ran in this animation frame, so another waits for
   * the next. The frame timestamp is the start of the frame, so the frame is
   * over once half a 60 Hz frame has passed, which a later present never beats.
   */
  #presentedThisFrame() {
    return performance.now() - this.#presentedFrameAt < SIXTY_HZ_FRAME_MS / 2;
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
  #follow(pace: Pace) {
    this.#cancelNext();
    if (pace === "active") {
      this.#nextFrame = requestAnimationFrame(this.#next);
    } else if (pace === "idle") {
      this.#idleTimer = window.setTimeout(this.#next, IDLE_FRAME_MS);
    }
  }

  #next = (frameAt?: number) => {
    this.#nextFrame = this.#idleTimer = undefined;
    if (frameAt !== undefined) this.#presentedFrameAt = frameAt;
    this.#follow(this.#blit());
  };

  #cancelNext() {
    cancelAnimationFrame(this.#nextFrame ?? 0);
    clearTimeout(this.#idleTimer);
    this.#nextFrame = this.#idleTimer = undefined;
  }

  #initialize() {
    if (this.#presenter !== undefined) return;
    const { width, height } = this.#bitmap();
    this.#presenter = new Presenter(
      this.attachShadow({ mode: "closed" }),
      width,
      height,
    );
    this.#configure();
  }

  #configure() {
    const presenter = this.#presenter;
    if (presenter === undefined) return;
    const { paletteBase, paletteInk } = this.dataset;
    const palette = paletteBase !== undefined && paletteInk !== undefined;
    presenter.configure({
      scale: this.#integer("scale", EmulatedCanvas.DEFAULT_SCALE, 1),
      gap: this.#integer("gap", EmulatedCanvas.DEFAULT_GAP, 0),
      shape:
        this.dataset.shape === "circle"
          ? "circle"
          : EmulatedCanvas.DEFAULT_SHAPE,
      shadow: {
        opacity: Math.min(this.#integer("shadow", 0, 0), 100),
        x: this.#integer("shadowX", 0, -Infinity),
        y: this.#integer("shadowY", 0, -Infinity),
        unlit: palette ? paletteBase : undefined,
      },
    });
  }

  #integer(
    name:
      | "width"
      | "height"
      | "scale"
      | "gap"
      | "shadow"
      | "shadowX"
      | "shadowY",
    fallback: number,
    min: number,
  ) {
    const parsed = Number.parseInt(this.dataset[name] ?? "");
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
  }

  #blit(): Pace {
    const presenter = this.#presenter;
    if (presenter === undefined) return "still";
    const innerCanvas = this.#bitmap();

    const frame = this.#frame;
    const now = performance.now();
    frame.width = innerCanvas.width;
    frame.height = innerCanvas.height;
    frame.elapsedMs = now - (this.#presentedAt ?? now);
    this.#presentedAt = now;

    const active = this.#pipeline.active();
    let image =
      active || presenter.needsPixels ? this.#pixels(innerCanvas) : undefined;
    const pace =
      active && image !== undefined
        ? this.#pipeline.apply(image.data, frame, now - this.#drewAt)
        : "still";

    const dissolving =
      this.#dissolving &&
      (image ??= this.#pixels(innerCanvas)) !== undefined &&
      this.#dissolve(image.data, now);

    this.#shownImage = image !== undefined;
    presenter.show(image ?? innerCanvas);
    return dissolving ? "active" : pace;
  }

  /** Shows the frozen frame wherever the dissolve has not reached; false once it is done. */
  #dissolve(pixels: Uint8ClampedArray, now: number) {
    const from = this.#dissolveFrom!;
    this.#dissolveStart ??= now;
    const progress = (now - this.#dissolveStart) / DISSOLVE_MS;
    if (progress >= 1) {
      this.#dissolving = false;
      return false;
    }
    const threshold = this.#threshold;
    for (let cell = 0, i = 0; cell < threshold.length; cell += 1, i += 4) {
      if (threshold[cell] >= progress) {
        pixels[i] = from[i];
        pixels[i + 1] = from[i + 1];
        pixels[i + 2] = from[i + 2];
        pixels[i + 3] = from[i + 3];
      }
    }
    return true;
  }

  /**
   * A copy of the consumer's pixels for the passes to edit: they must stay the
   * consumer's to draw over, and the next present starts from them again.
   */
  #pixels(innerCanvas: OffscreenCanvas) {
    if (this.#drawn || this.#source === undefined) {
      this.#drawn = false;
      this.#source = this.#read(innerCanvas);
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

const DISSOLVE_MS = 800;

/** Blobs across the dissolve's mask, along its width. */
const DISSOLVE_BLOBS = 8;

/**
 * Simplex noise stretched to span 0–1, so a dissolve starts and finishes on
 * time however the noise happens to fall.
 */
function dissolveThreshold(width: number, height: number) {
  const noise = makeNoise2D(NOISE_SEED);
  const threshold = new Float32Array(width * height);
  const frequency = DISSOLVE_BLOBS / width;
  let low = Infinity;
  let high = -Infinity;
  for (let y = 0, i = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, i += 1) {
      const value = noise(
        x * frequency + NOISE_OFFSET_X,
        y * frequency + NOISE_OFFSET_Y,
      );
      threshold[i] = value;
      low = Math.min(low, threshold[i]);
      high = Math.max(high, threshold[i]);
    }
  }
  const span = Math.max(high - low, Number.EPSILON);
  for (let i = 0; i < threshold.length; i += 1) {
    threshold[i] = (threshold[i] - low) / span;
  }
  return threshold;
}

/** The idle redraw rate, for a pass that only drifts. */
const IDLE_FRAME_MS = 1000 / 8;

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
