import { makeCoarseNoise, makeNoise2D } from "./backdrop-noise";
import { clamp } from "../lib/clamp";
import { MAX_GHOST } from "./emulated-canvas-limits";

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
 * How soon a pass needs the next present: never, at the ~8 fps idle rate (for
 * a slow drift, whose steps don't show), or on the next animation frame.
 */
export type Pace = "still" | "idle" | "active";

/**
 * One element's instance of a shader. `apply` edits the logical bitmap's RGBA
 * bytes in place and returns how soon its output changes again, so the canvas
 * knows when to present next. A pass whose knobs leave it off reports so
 * through `active`, a pure query checked first: when no pass is active the
 * bitmap skips the pixel read-back and goes to the display in one copy. A pass
 * that goes inactive and active again is rebuilt, so it starts from the
 * current frame, not a stale one.
 *
 * `configure` is how a pass reads its knobs: it is called with the element's
 * `dataset` when the pass is built and whenever a `data-*` attribute changes,
 * so a pass parses its knobs once instead of on every frame. A pass that
 * reads `frame.data` instead pays for that on each frame. The attribute a
 * pass reads must be in `EmulatedCanvas.observedAttributes`.
 */
export type ShaderPass = {
  configure?(data: DOMStringMap): void;
  active(frame: ShaderFrame): boolean;
  apply(pixels: Uint8ClampedArray, frame: ShaderFrame): Pace;
};

/**
 * Builds a pass for one element, so any state it keeps between frames belongs
 * to that element. A pass reading its knobs from `frame.data` needs no change
 * to the element: write one, add it to `SHADERS` and document its `data-*`
 * attribute. One that parses them in `configure` must also list them in
 * `EmulatedCanvas.observedAttributes`. For example, an inverter:
 *
 * ```ts
 * const invert: Shader = () => ({
 *   active: ({ data }) => data.invert !== undefined,
 *   apply(pixels) {
 *     for (let i = 0; i < pixels.length; i += 4)
 *       for (let c = i; c < i + 3; c += 1) pixels[c] = 255 - pixels[c];
 *     return "still";
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
  let tau = 0;
  let retained = 0;
  return {
    configure(data) {
      retained = retention(data);
      // Retention r per 60 Hz frame is the same curve as τ = -frame / ln r.
      tau = SIXTY_HZ_FRAME_MS / -Math.log(retained);
    },
    active: () => retained > 0,
    apply(pixels, { elapsedMs }) {
      if (panel?.length !== pixels.length) {
        // Seed the panel with this frame so it starts opaque; otherwise a high
        // retention would fade in from transparent.
        panel = Float32Array.from(pixels);
        return "still";
      }
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
      return changing ? "active" : "still";
    },
  };
};

type Rgb = [number, number, number];

let rgbContext: CanvasRenderingContext2D | null | undefined;

/** Resolve any CSS colour to `[r, g, b]`. */
function colourRgb(value: string): Rgb {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex !== null) {
    const digits =
      hex[1].length === 3
        ? hex[1].replace(/./g, (digit) => digit + digit)
        : hex[1];
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ];
  }
  if (rgbContext === undefined) {
    rgbContext = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true });
  }
  if (rgbContext === null) return [0, 0, 0];
  rgbContext.clearRect(0, 0, 1, 1);
  rgbContext.fillStyle = value;
  rgbContext.fillRect(0, 0, 1, 1);
  const [r, g, b] = rgbContext.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/**
 * Recolours the frame in two colours: each pixel's luma, over black, picks its
 * place on the scale from `data-palette-base` (dark) to `data-palette-ink`
 * (light), so a consumer can draw in any colour and still show in the theme's.
 * The scale is a 256-entry table, rebuilt only when a colour changes.
 */
const palette: Shader = () => {
  let base: string | undefined;
  let ink: string | undefined;
  let stale = true;
  const table = new Uint8ClampedArray(256 * 3);
  return {
    configure(data) {
      if (base !== data.paletteBase || ink !== data.paletteInk) stale = true;
      base = data.paletteBase;
      ink = data.paletteInk;
    },
    active: () => base !== undefined && ink !== undefined,
    apply(pixels) {
      if (stale) {
        stale = false;
        const from = colourRgb(base!);
        const to = colourRgb(ink!);
        for (let level = 0; level < 256; level += 1) {
          for (let channel = 0; channel < 3; channel += 1) {
            table[level * 3 + channel] =
              from[channel] + ((to[channel] - from[channel]) * level) / 255;
          }
        }
      }
      for (let i = 0; i < pixels.length; i += 4) {
        // Rec. 709 weights in 256ths, which sum to 256.
        const luma =
          (pixels[i] * 54 + pixels[i + 1] * 183 + pixels[i + 2] * 19) >> 8;
        const entry = (((luma * pixels[i + 3]) / 255) | 0) * 3;
        pixels[i] = table[entry];
        pixels[i + 1] = table[entry + 1];
        pixels[i + 2] = table[entry + 2];
        pixels[i + 3] = 255;
      }
      return "still";
    },
  };
};

const NOISE_SEED = 0x9e3779b9;

/**
 * Simplex is exactly zero on integer lattice points, so sample off-lattice:
 * without this a 1-pixel feature size would flatten to a constant.
 */
const NOISE_OFFSET_X = 12.9898;
const NOISE_OFFSET_Y = 78.233;

/**
 * The noise is sampled at most this many pixels apart and filled in between.
 * At the backdrop's feature size that is a quarter of the samples per axis,
 * within 0.02 RMS (0.075 at worst) of sampling every pixel.
 */
const MAX_NOISE_STEP = 4;

/** Fewer samples than this per feature visibly flatten its peaks. */
const NOISE_SAMPLES_PER_FEATURE = 7.5;

function knob(value: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * A drifting simplex field under the frame, so its dark pixels shimmer: each
 * channel is lifted to the noise where that is brighter, like a `lighten`
 * blend, and the drawing shows on top. `data-noise` is its intensity (0–100),
 * `data-noise-scale` its feature size in pixels (default 8) and
 * `data-noise-speed` how fast it drifts (0–100, default 0). At the speeds the
 * backdrop uses the drift moves about a pixel per 60 Hz frame on a desktop
 * screen, so it redraws at the idle rate.
 */
const noise: Shader = () => {
  const sample = makeNoise2D(NOISE_SEED);
  let layer: ReturnType<typeof makeCoarseNoise> | undefined;
  let field = new Float32Array(0);
  let clock = 0;
  let intensity = 0;
  let speed = 0;
  let feature = 8;
  let step = 1;
  return {
    configure(data) {
      intensity = clamp(knob(data.noise, 0), 0, 100) / 100;
      speed = knob(data.noiseSpeed, 0);
      feature = Math.max(1, knob(data.noiseScale, 8));
      step = clamp(
        Math.floor(feature / NOISE_SAMPLES_PER_FEATURE),
        1,
        MAX_NOISE_STEP,
      );
    },
    active: () => intensity > 0,
    apply(pixels, { width, height, elapsedMs }) {
      if (layer === undefined || field.length !== width * height) {
        layer = makeCoarseNoise(sample, width, height);
        field = new Float32Array(width * height);
      }
      clock += elapsedMs;
      const drift = clock * speed * 0.00005;
      field.fill(0);
      layer(
        field,
        step,
        1 / feature,
        drift + NOISE_OFFSET_X,
        drift * 0.5 + NOISE_OFFSET_Y,
        intensity,
      );
      for (let i = 0, cell = 0; i < pixels.length; i += 4, cell += 1) {
        const level = field[cell] * 255;
        // Over black, so a transparent pixel takes the noise rather than hiding it.
        const opacity = pixels[i + 3] / 255;
        for (let channel = i; channel < i + 3; channel += 1) {
          const value = pixels[channel] * opacity;
          pixels[channel] = value > level ? value : level;
        }
        pixels[i + 3] = 255;
      }
      return speed > 0 ? "idle" : "still";
    },
  };
};

/**
 * Per-pixel passes over the logical bitmap, in order. To add an effect, write a
 * `Shader` and add it to this list.
 */
export const SHADERS: Shader[] = [noise, palette, ghost];

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
 * rate. It is capped just below 100 so the panel can never freeze.
 *
 * `data-palette-base` and `data-palette-ink` (CSS colours, both or neither)
 * recolour the frame in two colours, by each pixel's luma: black shows as the
 * base and white as the ink.
 *
 * `data-noise` (0–100) lifts the frame to a drifting noise field, so its dark
 * pixels shimmer; `data-noise-scale` and `data-noise-speed` set its feature
 * size in pixels and its drift. The knobs are live.
 *
 * Effects like the ghost are `SHADERS`, an ordered list of per-pixel passes
 * that run on the logical bitmap, never at display resolution, so each costs
 * the same however large the cells are drawn.
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
  static observedAttributes = [
    "data-scale",
    "data-gap",
    "data-shape",
    "data-ghost",
    "data-palette-base",
    "data-palette-ink",
    "data-noise",
    "data-noise-scale",
    "data-noise-speed",
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
  #presentQueued = false;
  /** When the animation frame of the last frame-driven present began; timer presents leave it. */
  #presentedFrameAt = -Infinity;
  #drewAt = -Infinity;
  #passes = SHADERS.map((_, index) => this.#build(index));
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
      for (const pass of this.#passes) pass.configure?.(this.dataset);
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

  /** Drops every pass's state, so the next present shows the bitmap opaque. */
  reset() {
    this.#passes = SHADERS.map((_, index) => this.#build(index));
    this.#wasActive.clear();
  }

  #build(index: number) {
    const pass = SHADERS[index]();
    pass.configure?.(this.dataset);
    return pass;
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

  #blit(): Pace {
    const outerCanvas = this.#outerCanvas;
    if (outerCanvas === undefined) return "still";
    const innerCanvas = this.#bitmap();

    let context = this.#outerContext;
    if (context === undefined) {
      const created = outerCanvas.getContext("2d");
      if (created === null) return "still";
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

    let image: ImageData | undefined;
    let active = false;
    let idle = false;
    for (let index = 0; index < this.#passes.length; index += 1) {
      const pass = this.#passes[index];
      if (!pass.active(frame)) {
        if (this.#wasActive.delete(pass))
          this.#passes[index] = this.#build(index);
        continue;
      }
      this.#wasActive.add(pass);
      image ??= this.#pixels(innerCanvas);
      if (image === undefined) break;
      const pace = pass.apply(image.data, frame);
      active ||= pace === "active";
      idle ||= pace === "idle";
    }

    const dissolving =
      this.#dissolving &&
      (image ??= this.#pixels(innerCanvas)) !== undefined &&
      this.#dissolve(image.data, now);

    this.#shownImage = image !== undefined;
    if (image === undefined) context.drawImage(innerCanvas, 0, 0);
    else context.putImageData(image, 0, 0);
    if (dissolving) return "active";
    // A drifting frame can keep a fade more than a level behind on every
    // present, so it never reports settled and would hold full rate for good.
    if (active && (!idle || now - this.#drewAt < DRIFTING_FADE_MS)) {
      return "active";
    }
    return active || idle ? "idle" : "still";
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

/** How long after a draw a fade over a drifting pass may keep full rate. */
const DRIFTING_FADE_MS = 1000;

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
