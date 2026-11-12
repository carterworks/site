import { type EmulatedCanvas } from "./emulated-canvas";
import "./emulated-canvas";
import { MODES } from "./backdrop-modes";
import {
  TUNED_GRID,
  type BackdropInput,
  type CellRect,
  type Look,
  type Mode,
  type ModeInstance,
  type Point,
} from "./backdrop-modes/mode";
import { isToyPress } from "./backdrop-press";
import { makeCoarseNoise, makeNoise2D, mulberry32 } from "./backdrop-noise";
import { clamp } from "./emulated-canvas-limits";

/**
 * `<pixel-backdrop>` fills the viewport with a live `<emulated-canvas>` and
 * feeds pointer input to a backdrop mode, which simulates on a fixed timestep
 * and reports a 0–1 intensity per cell. The element owns everything else: the
 * drifting noise drawn under every mode, colour, and pacing the loop. The
 * layer is fixed and non-interactive, so the page above it paints its own
 * solid panels over the result.
 *
 * The element owns its render knobs so the dev-toolbar app can tweak them
 * live. The ones the canvas draws with (gap, shape, ghost, scale) are mirrored
 * onto the inner `<emulated-canvas>`'s `data-*` attributes — its public API;
 * the rest are read by the element and the modes directly. A mode's `look`
 * stands in for `ghost` and `noise` unless they are tweaked; see `look`.
 */

export type PixelBackdropOptions = {
  /** Whether the backdrop renders at all. */
  enabled: boolean;
  /** Size the cells to cover the viewport; when off, `scale` is used as-is. */
  autoFit: boolean;
  /** Cell size in display pixels, when `autoFit` is off. */
  scale: number;
  /** Space between cells, in display pixels. */
  gap: number;
  /** Cell form. */
  shape: "square" | "circle";
  /** Share of each previous frame the panel keeps, 0–100. */
  ghost: number;
  /** Shimmer's maximum ripple radius, in logical pixels. */
  rippleSize: number;
  /** Shimmer's ripple lifetime, in milliseconds. */
  rippleSpeed: number;
  /** Opacity of the drifting background noise field, 0–100. */
  noise: number;
  /** Feature size of the noise field, in cells of an 80-cell grid; it scales with the real one. Larger is softer. */
  noiseScale: number;
  /** Drift speed of the noise field, 0–100. */
  noiseSpeed: number;
  /** Colour of the "off" pixels in light mode. */
  lightBase: string;
  /** Colour of the lit pixels in light mode, across every mode and the noise. */
  lightInk: string;
  /** Colour of the "off" pixels in dark mode. */
  darkBase: string;
  /** Colour of the lit pixels in dark mode, across every mode and the noise. */
  darkInk: string;
};

const number = Number.parseFloat;
const flag = (value: string) => value === "true";
// The CSS minifier rewrites durations to their shortest form (`900ms` ->
// `.9s`), so the unit must be honoured, not stripped.
const duration = (value: string) =>
  Number.parseFloat(value) * (/\ds$/.test(value) ? 1000 : 1);
const text = <T extends string>(value: string) => value as T;

const PARSERS: {
  [K in keyof PixelBackdropOptions]: (value: string) => PixelBackdropOptions[K];
} = {
  enabled: flag,
  autoFit: flag,
  scale: number,
  gap: number,
  shape: text,
  ghost: number,
  rippleSize: number,
  rippleSpeed: duration,
  noise: number,
  noiseScale: number,
  noiseSpeed: number,
  lightBase: text,
  lightInk: text,
  darkBase: text,
  darkInk: text,
};

/**
 * The defaults live only as `--backdrop-*` custom properties on `:root` (see
 * `global.css`), so there is a single source of truth for them.
 */
export function readDefaults(): PixelBackdropOptions {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(PARSERS).map(([key, parse]) => {
      const name = `--backdrop-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      return [key, parse(styles.getPropertyValue(name).trim())];
    }),
  ) as PixelBackdropOptions;
}

/**
 * Set on `<html>` for the length of a hold; the stylesheet turns off text
 * selection, the touch callout and overscroll for it.
 */
const HOLDING = "data-backdrop-holding";

/**
 * How long a touch on a hold mode must stay put to grab the toy. Touch is how
 * the page scrolls, so a finger only takes the toy once it is clearly not
 * scrolling, and well before iOS's own long-press.
 */
const GRAB_MS = 250;

/** How far, in CSS pixels, a waiting touch may drift before it counts as a scroll. */
const GRAB_SLOP = 10;

const STEP = 1000 / 60;

/** Time a mode may catch up after a stall, so a long pause doesn't replay in a burst. */
const MAX_CATCH_UP = 250;

/** At the default speed the noise drifts about a pixel per 60 Hz frame on a desktop screen, so a slow redraw is imperceptible. */
const IDLE_FRAME_INTERVAL = 1000 / 8;

/**
 * How long after input a drifting frame may stay at full rate for a fade. A
 * fast drift can leave the ghost more than one level behind the noise on every
 * redraw, so it never reports settled, and "still changing" alone would hold
 * full rate indefinitely.
 */
const DRIFTING_FADE_WINDOW = 1000;

/** How long a mode change dissolves, in milliseconds. */
const DISSOLVE_MS = 800;

/** Feature size of the dissolve's blobs, in cells of the tuned grid. */
const DISSOLVE_SCALE = 10;

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const darkScheme = matchMedia("(prefers-color-scheme: dark)");

/** Light/dark follows the site's manual override first, then the OS. */
function prefersDark() {
  const override = document.documentElement.style.colorScheme;
  if (override === "dark") return true;
  if (override === "light") return false;
  return darkScheme.matches;
}

/**
 * Distance into the grid along one axis, in CSS pixels -> logical position.
 * Cells sit a stride apart and each gap is split between its neighbours, so a
 * cell's centre maps to its pixel's centre. `extent` is the grid's box, which
 * ends at the last cell.
 */
export function gridCoordinate(
  offset: number,
  extent: number,
  count: number,
  gap: number,
) {
  return ((offset + gap / 2) / (extent + gap)) * count;
}

/**
 * The span of the grid inside the viewport, in logical cells: a whole stride
 * (cell + gap) per cell, so an axis the grid fits on spans every cell.
 */
export function visibleCells(
  grid: DOMRect,
  viewport: { width: number; height: number },
  columns: number,
  rows: number,
  gap: number,
): CellRect {
  const cells = (offset: number, extent: number, count: number) =>
    clamp((offset * count) / (extent + gap), 0, count);
  return {
    left: cells(-grid.left, grid.width, columns),
    top: cells(-grid.top, grid.height, rows),
    right: cells(viewport.width - grid.left + gap, grid.width, columns),
    bottom: cells(viewport.height - grid.top + gap, grid.height, rows),
  };
}

const NOISE_SEED = 0x9e3779b9;
/**
 * Simplex is exactly zero on integer lattice points, so sample off-lattice:
 * without this a 1-cell feature size would flatten to a constant.
 */
const NOISE_OFFSET_X = 12.9898;
const NOISE_OFFSET_Y = 78.233;

/**
 * The background noise is sampled at most this many cells apart and filled in
 * between. At the default feature size that is a quarter of the samples per
 * axis, keeping a 160-cell grid's noise cheaper than sampling 80 cells whole,
 * and within 0.02 RMS (0.075 at worst) of sampling every cell, on the 0-1
 * layer before its intensity scales it.
 */
const MAX_NOISE_STEP = 4;

/** Fewer samples than this per feature visibly flatten its peaks. */
const NOISE_SAMPLES_PER_FEATURE = 7.5;

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
 * The 256 colours from `base` to `ink`, three bytes each, so shading a frame is
 * a lookup per cell rather than a blend.
 */
export function shadeTable(base: Rgb, ink: Rgb) {
  const table = new Uint8ClampedArray(256 * 3);
  for (let level = 0; level < 256; level += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      table[level * 3 + channel] =
        base[channel] + ((ink[channel] - base[channel]) * level) / 255;
    }
  }
  return table;
}

/** Field intensities (0–1) -> opaque RGBA pixels, through a `shadeTable`. */
export function shade(
  field: Float32Array,
  table: Uint8ClampedArray,
  pixels: Uint8ClampedArray,
) {
  for (let i = 0, offset = 0; i < field.length; i += 1, offset += 4) {
    const entry = Math.round(clamp(field[i], 0, 1) * 255) * 3;
    pixels[offset] = table[entry];
    pixels[offset + 1] = table[entry + 1];
    pixels[offset + 2] = table[entry + 2];
    pixels[offset + 3] = 255;
  }
}

export class PixelBackdrop extends HTMLElement {
  #options!: PixelBackdropOptions;
  /** Knobs set through `configure` since the last `reset`: they outrank a mode's look. */
  #tweaked = new Set<string>();
  #canvas?: EmulatedCanvas;
  #context?: OffscreenCanvasRenderingContext2D;
  #frame?: number;
  #idleTimer?: number;
  #busyAt = -Infinity;
  #wasDark?: boolean;
  #schemeObserver = new MutationObserver(() => this.#wake());
  /** Waits for the canvas when the element is connected before its child is parsed. */
  #canvasObserver = new MutationObserver(() => this.#attach());
  #columns = 0;
  #rows = 0;
  #chosen = MODES[0];
  #mode?: ModeInstance;
  /** The mode being dissolved away; it keeps stepping until the dissolve ends. */
  #outgoing?: ModeInstance;
  #outgoingMode?: Mode;
  /** `now` of the dissolve's first frame; the dissolve runs on the frame clock. */
  #dissolveStart?: number;
  #dissolveProgress = 0;
  /** Per cell, the dissolve progress (0-1) at which it flips to the new mode. */
  #threshold = new Float32Array(0);
  #thresholdBuilt = false;
  /** Whether a frame has shown the current mode; before that a switch has nothing to dissolve from. */
  #painted = false;
  #fieldOutgoing = new Float32Array(0);
  /** The mode clock, advanced in whole steps. */
  #time = 0;
  #lastTick?: number;
  #accumulated = 0;
  /**
   * Set by input and cleared by a step, so a tick too short for a whole step
   * keeps the loop running until the mode has seen the input.
   */
  #inputPending = false;
  #holdPointer?: number;
  /** A touch on a hold mode waiting out `GRAB_MS`: where it went down. */
  #waiting?: { point: Point; clientX: number; clientY: number; timer: number };
  /** A touch that has grabbed a hold mode: its moves drive the toy and never scroll. */
  #grabbed = false;
  #input: BackdropInput = {
    lastInputAt: -Infinity,
    visible: { left: 0, top: 0, right: 0, bottom: 0 },
  };
  #noise = makeNoise2D(NOISE_SEED);
  #noiseLayer?: ReturnType<typeof makeCoarseNoise>;
  #field = new Float32Array(0);
  #image?: ImageData;
  #shades?: { base: string; ink: string; table: Uint8ClampedArray };
  #rect?: DOMRect;

  /** The id of the chosen mode, which is the incoming one mid-dissolve. */
  get mode(): string {
    return this.#chosen.id;
  }

  /**
   * The ghost and noise the chosen mode shows once any dissolve ends: its
   * look's, except that a knob set through `configure()` wins in every mode.
   * A mode's look is tuned to it, so it beats the site-wide default, while a
   * configured value is someone deliberately trying it.
   */
  get look(): Look {
    return {
      ghost: this.#lookOf(this.#chosen, "ghost"),
      noise: this.#lookOf(this.#chosen, "noise"),
    };
  }

  /** A copy of the current knobs, for the dev toolbar to read. */
  get options(): PixelBackdropOptions {
    return { ...this.#options };
  }

  connectedCallback() {
    this.#attach();
  }

  #attach() {
    const canvas = this.querySelector("emulated-canvas");
    if (canvas === null) {
      this.#canvasObserver.observe(this, { childList: true, subtree: true });
      return;
    }
    this.#canvasObserver.disconnect();
    // Parents upgrade before children, so the child may still be a bare element.
    customElements.upgrade(canvas);
    this.#canvas = canvas;
    canvas.dataset.manual = "";
    this.#columns = canvas.width;
    this.#rows = canvas.height;
    this.#field = new Float32Array(this.#columns * this.#rows);
    this.#noiseLayer = makeCoarseNoise(this.#noise, this.#columns, this.#rows);
    this.#fieldOutgoing = new Float32Array(this.#field.length);
    this.#threshold = new Float32Array(this.#field.length);
    this.#thresholdBuilt = false;
    this.#input.visible = {
      left: 0,
      top: 0,
      right: this.#columns,
      bottom: this.#rows,
    };
    this.#options ??= readDefaults();
    this.#mode ??= this.#createMode();
    this.#apply();

    window.addEventListener("pointermove", this.#onPointerMove, {
      passive: true,
    });
    window.addEventListener("pointerdown", this.#onPointerDown, {
      passive: true,
    });
    window.addEventListener("pointerup", this.#onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", this.#onPointerEnd, {
      passive: true,
    });
    window.addEventListener("blur", this.#endHold, { passive: true });
    // Not passive, as blocking a scroll is its job. Registered up front:
    // browsers decide whether a touch may block scrolling as it begins.
    window.addEventListener("touchmove", this.#onTouchMove, { passive: false });
    window.addEventListener("touchend", this.#onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", this.#onTouchEnd, { passive: true });
    document.addEventListener("selectionchange", this.#onSelectionChange, {
      passive: true,
    });
    window.addEventListener("resize", this.#onResize);
    document.addEventListener("mouseleave", this.#onPointerLeave);
    reducedMotion.addEventListener("change", this.#onMotionChange);
    darkScheme.addEventListener("change", this.#wake);
    // The theme toggle emits no event, and ClientRouter navigations reset
    // <html>'s inline style, so the style attribute is the one reliable signal.
    this.#schemeObserver.observe(document.documentElement, {
      attributeFilter: ["style"],
    });

    this.#start();
  }

  disconnectedCallback() {
    this.#canvasObserver.disconnect();
    this.#stop();
    window.removeEventListener("pointermove", this.#onPointerMove);
    window.removeEventListener("pointerdown", this.#onPointerDown);
    window.removeEventListener("pointerup", this.#onPointerEnd);
    window.removeEventListener("pointercancel", this.#onPointerEnd);
    window.removeEventListener("blur", this.#endHold);
    window.removeEventListener("touchmove", this.#onTouchMove);
    window.removeEventListener("touchend", this.#onTouchEnd);
    window.removeEventListener("touchcancel", this.#onTouchEnd);
    document.removeEventListener("selectionchange", this.#onSelectionChange);
    window.removeEventListener("resize", this.#onResize);
    document.removeEventListener("mouseleave", this.#onPointerLeave);
    reducedMotion.removeEventListener("change", this.#onMotionChange);
    darkScheme.removeEventListener("change", this.#wake);
    this.#schemeObserver.disconnect();
    this.#endHold();
  }

  /** Merge a partial set of knobs, and repaint. */
  configure(partial: Partial<PixelBackdropOptions>) {
    for (const key of Object.keys(partial)) this.#tweaked.add(key);
    // In place, as the mode holds this object to read its knobs live.
    this.#options = Object.assign(this.#options ?? readDefaults(), partial);
    this.#apply();
    if (this.#options.enabled) {
      this.#start();
      this.#wake();
    } else {
      this.#stop();
      this.#endHold();
    }
  }

  /** Restore the defaults from the `--backdrop-*` custom properties. */
  reset() {
    this.configure(readDefaults());
    this.#tweaked.clear();
  }

  #lookOf(mode: Mode, key: keyof Look) {
    const value = this.#options[key];
    const look = mode.look;
    return look === undefined || this.#tweaked.has(key) ? value : look[key];
  }

  /** Mid-dissolve, the look slides from the outgoing mode's to the chosen one's. */
  #look(key: keyof Look) {
    const incoming = this.#lookOf(this.#chosen, key);
    if (this.#outgoing === undefined || this.#outgoingMode === undefined) {
      return incoming;
    }
    const outgoing = this.#lookOf(this.#outgoingMode, key);
    return outgoing + (incoming - outgoing) * this.#dissolveProgress;
  }

  /**
   * Dissolve into a registered mode, starting it fresh; an unknown id is
   * ignored, and so is the mode already chosen. A request before the canvas
   * exists is remembered and applied when the host attaches. Before the first
   * frame, or with no running loop (reduced motion, disabled), the switch is
   * instant: nothing has been shown to dissolve from.
   *
   * A request mid-dissolve makes the mode now showing through the new outgoing
   * one and drops the old one. Snapshotting the displayed mix would freeze a
   * live toy, and a third instance would break the two-mode budget; the cost
   * is that cells not yet flipped jump to the mode they were about to leave
   * for, which the canvas's ghost pass smooths.
   */
  setMode(id: string) {
    const mode = MODES.find((candidate) => candidate.id === id);
    if (mode === undefined || mode === this.#chosen) return;
    const previous = this.#chosen;
    this.#chosen = mode;
    const outgoing = this.#mode;
    if (outgoing === undefined) return;
    this.#endHold();
    // A press from before the new mode existed is not its to see.
    this.#input.press = undefined;
    this.#mode = this.#createMode();
    this.#dissolveStart = undefined;
    this.#dissolveProgress = 0;
    if (this.#context === undefined || !this.#painted) {
      this.#outgoing = undefined;
      this.#outgoingMode = undefined;
      return;
    }
    this.#outgoing = outgoing;
    this.#outgoingMode = previous;
    this.#buildThreshold();
    this.#wake();
  }

  /**
   * Simplex noise stretched to span 0-1, so the dissolve starts and finishes
   * on time however the noise happens to fall. Built once, on the first
   * dissolve, so no frame pays for it.
   */
  #buildThreshold() {
    if (this.#thresholdBuilt) return;
    this.#thresholdBuilt = true;
    const noise = makeNoise2D(NOISE_SEED);
    const threshold = this.#threshold;
    const frequency = TUNED_GRID / (DISSOLVE_SCALE * this.#columns);
    let low = Infinity;
    let high = -Infinity;
    for (let y = 0, i = 0; y < this.#rows; y += 1) {
      for (let x = 0; x < this.#columns; x += 1, i += 1) {
        const value = noise(
          x * frequency + NOISE_OFFSET_X,
          y * frequency + NOISE_OFFSET_Y,
        );
        threshold[i] = value;
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
    const span = Math.max(high - low, Number.EPSILON);
    for (let i = 0; i < threshold.length; i += 1) {
      threshold[i] = (threshold[i] - low) / span;
    }
  }

  #createMode() {
    return this.#chosen.create({
      columns: this.#columns,
      rows: this.#rows,
      random: mulberry32(Math.random() * 2 ** 32),
      options: this.#options,
    });
  }

  #start() {
    if (this.#context !== undefined) return;
    if (reducedMotion.matches || !this.#options.enabled) return;
    const context = this.#canvas?.getContext("2d");
    if (context === null || context === undefined) return;
    this.#context = context;
    this.#frame = requestAnimationFrame(this.#tick);
  }

  #stop() {
    cancelAnimationFrame(this.#frame ?? 0);
    clearTimeout(this.#idleTimer);
    this.#frame = undefined;
    this.#idleTimer = undefined;
    this.#lastTick = undefined;
    this.#context = undefined;
    this.#outgoing = undefined;
    this.#outgoingMode = undefined;
  }

  /** Mirror the knobs the canvas draws with onto its attributes. */
  #apply() {
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    const { autoFit, enabled, gap, scale, shape } = this.#options;

    this.#rect = undefined;
    canvas.dataset.gap = String(gap);
    canvas.dataset.shape = shape;
    this.#applyGhost(canvas);
    canvas.dataset.scale = String(scale);
    if (autoFit)
      canvas.style.setProperty("--emulated-canvas-scale", this.#fit());
    else canvas.style.removeProperty("--emulated-canvas-scale");

    this.toggleAttribute("data-disabled", !enabled);
  }

  /** Written only on a change, as a dissolve recomputes it every frame. */
  #applyGhost(canvas: EmulatedCanvas) {
    const ghost = String(Math.round(this.#look("ghost")));
    if (canvas.dataset.ghost !== ghost) canvas.dataset.ghost = ghost;
  }

  /**
   * The cell size that makes the square grid cover the viewport, as CSS so it
   * tracks resizes without script. It measures the large viewport: mobile
   * toolbars sliding in and out would otherwise change the cell size, and the
   * grid would jump while scrolling.
   *
   * Whole strides tile the viewport, so the box can fall one gap short of it:
   * the edge cells' outer half gaps then land outside the box, where the page
   * shows through in the same colour the gaps are painted. Fitting cells
   * instead would make a 1440 px screen round a 9 px stride up to 10.
   */
  #fit() {
    return `max(1px, round(up, max(100lvw, 100lvh) / ${this.#columns}, 1px) - ${this.#options.gap}px)`;
  }

  #tick = (now: number) => {
    this.#frame = undefined;
    this.#measure();
    this.#advance(now);
    const dissolving = this.#dissolve(now);
    // Asked before render, which may consume what made the mode busy: the
    // frame after it must still be drawn, to clear it.
    const pace =
      dissolving || this.#inputPending
        ? "active"
        : (this.#mode?.pace() ?? "still");
    if (pace === "active") this.#busyAt = now;

    this.#draw(now);
    this.#painted = true;
    // A fade in flight keeps full rate: at the idle rate it would visibly step,
    // and a static frame that stopped would freeze it half-faded.
    const changing = this.#canvas?.present(this.#image) ?? false;
    // Like drifting noise, an idle mode changes on every redraw.
    const drifting = pace === "idle" || this.#noiseDrifts();
    const fading =
      changing && (!drifting || now - this.#busyAt < DRIFTING_FADE_WINDOW);

    if (pace === "active" || fading) {
      this.#frame = requestAnimationFrame(this.#tick);
    } else if (drifting) {
      this.#idleTimer = window.setTimeout(this.#wake, IDLE_FRAME_INTERVAL);
    } else {
      this.#lastTick = undefined;
    }
  };

  /**
   * Steps the mode in whole fixed steps for the time since the last tick, so it
   * runs at the same speed at any refresh rate. A tick after a stop counts as
   * one step.
   */
  #advance(now: number) {
    const mode = this.#mode;
    if (mode === undefined) return;
    const elapsed =
      this.#lastTick === undefined
        ? STEP
        : Math.min(now - this.#lastTick, MAX_CATCH_UP);
    this.#lastTick = now;
    this.#accumulated += elapsed;
    while (this.#accumulated >= STEP) {
      this.#accumulated -= STEP;
      this.#time += STEP;
      mode.step(this.#input, this.#time);
      this.#outgoing?.step(this.#input, this.#time);
      this.#inputPending = false;
    }
  }

  /** Advances the dissolve, and drops the outgoing mode once it is done. */
  #dissolve(now: number) {
    if (this.#outgoing === undefined) return false;
    this.#dissolveStart ??= now;
    const progress = (now - this.#dissolveStart) / DISSOLVE_MS;
    if (progress >= 1) {
      this.#outgoing = undefined;
      this.#outgoingMode = undefined;
      return false;
    }
    this.#dissolveProgress = progress;
    return true;
  }

  /** Keeps the outgoing mode's value in every cell the dissolve has not reached. */
  #mix(outgoing: ModeInstance, field: Float32Array) {
    const previous = this.#fieldOutgoing;
    previous.fill(0);
    outgoing.render(previous);
    const threshold = this.#threshold;
    const progress = this.#dissolveProgress;
    for (let i = 0; i < field.length; i += 1) {
      if (threshold[i] >= progress) field[i] = previous[i];
    }
  }

  /** Static noise has nothing left to redraw until input or `configure`. */
  #noiseDrifts() {
    return this.#look("noise") > 0 && this.#options.noiseSpeed > 0;
  }

  /** Input ends the idle wait early, so it never waits on the slow redraw. */
  #wake = () => {
    if (this.#context === undefined || this.#frame !== undefined) return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
    this.#frame = requestAnimationFrame(this.#tick);
  };

  #draw(now: number) {
    const context = this.#context;
    if (context === undefined) return;

    const dark = prefersDark();
    // The ghost pass would otherwise cross-fade the old scheme through grey
    // while the page colour changes instantly.
    if (this.#wasDark !== undefined && this.#wasDark !== dark) {
      this.#canvas?.reset();
    }
    this.#wasDark = dark;
    if (this.#canvas !== undefined) this.#applyGhost(this.#canvas);
    const base = dark ? this.#options.darkBase : this.#options.lightBase;
    const ink = dark ? this.#options.darkInk : this.#options.lightInk;

    this.#paint(context, now, base, ink);
  }

  /**
   * Fills the bitmap from the mode's intensity field, with the base lifted
   * toward the ink by a drifting simplex field under it, so the "off" pixels
   * shimmer and the mode draws on top. Built as one `ImageData` and blitted in
   * a single call — far cheaper than a `fillRect` per cell.
   */
  #paint(
    context: OffscreenCanvasRenderingContext2D,
    now: number,
    base: string,
    ink: string,
  ) {
    const columns = this.#columns;
    const rows = this.#rows;
    const field = this.#field;
    let image = this.#image;
    if (
      image === undefined ||
      image.width !== columns ||
      image.height !== rows
    ) {
      image = context.createImageData(columns, rows);
      this.#image = image;
    }
    if (this.#shades?.base !== base || this.#shades.ink !== ink) {
      this.#shades = {
        base,
        ink,
        table: shadeTable(colourRgb(base), colourRgb(ink)),
      };
    }

    field.fill(0);
    this.#mode?.render(field);
    if (this.#outgoing !== undefined) this.#mix(this.#outgoing, field);
    const noise = this.#look("noise");
    if (noise > 0) {
      const feature =
        (Math.max(1, this.#options.noiseScale) * columns) / TUNED_GRID;
      const step = clamp(
        Math.floor(feature / NOISE_SAMPLES_PER_FEATURE),
        1,
        MAX_NOISE_STEP,
      );
      const drift = now * this.#options.noiseSpeed * 0.00005;
      this.#noiseLayer?.(
        field,
        step,
        1 / feature,
        drift + NOISE_OFFSET_X,
        drift * 0.5 + NOISE_OFFSET_Y,
        noise / 100,
      );
    }

    shade(field, this.#shades.table, image.data);
    context.putImageData(image, 0, 0);
  }

  /**
   * The grid's box, measured once per resize or knob change, and the cells of
   * it the viewport shows. `innerWidth` and `innerHeight` are the viewport as
   * it is now, so a mobile toolbar covering the bottom rows counts as hiding
   * them.
   */
  #measure() {
    if (this.#rect !== undefined) return this.#rect;
    const rect = this.#canvas?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) {
      return undefined;
    }
    this.#rect = rect;
    this.#input.visible = visibleCells(
      rect,
      { width: innerWidth, height: innerHeight },
      this.#columns,
      this.#rows,
      this.#options.gap,
    );
    return rect;
  }

  /** Viewport point -> position on the grid in logical cells, if it is on it. */
  #logical(clientX: number, clientY: number) {
    const rect = this.#measure();
    if (rect === undefined) return undefined;
    const gap = this.#options.gap;
    const x = gridCoordinate(
      clientX - rect.left,
      rect.width,
      this.#columns,
      gap,
    );
    const y = gridCoordinate(clientY - rect.top, rect.height, this.#rows, gap);
    if (x < 0 || y < 0 || x > this.#columns || y > this.#rows) return undefined;
    return { x, y };
  }

  #touched() {
    this.#input.lastInputAt = this.#time;
    this.#inputPending = true;
    this.#wake();
  }

  #onPointerMove = (event: PointerEvent) => {
    // Touch has no hover: only a grabbed finger moves the pointer.
    if (event.pointerType === "touch") {
      this.#onFingerMove(event);
      return;
    }
    const point = this.#logical(event.clientX, event.clientY);
    if (point === undefined) return;
    this.#input.pointer = point;
    this.#touched();
  };

  /** The host is fixed, so only a resize moves its box. */
  #onResize = () => {
    this.#rect = undefined;
    this.#wake();
  };

  #onPointerLeave = () => {
    this.#input.pointer = undefined;
    this.#wake();
  };

  #onPointerDown = (event: PointerEvent) => {
    if (!isToyPress(event)) return;
    const point = this.#logical(event.clientX, event.clientY);
    if (point === undefined) return;
    this.#holdPointer = event.pointerId;
    if (this.#chosen.holds && event.pointerType === "touch") {
      clearTimeout(this.#waiting?.timer);
      const { clientX, clientY } = event;
      const timer = window.setTimeout(this.#grab, GRAB_MS);
      this.#waiting = { point, clientX, clientY, timer };
      return;
    }
    this.#press(point, true);
  };

  /** A new object per press, so a mode tells presses apart by identity. */
  #press(point: Point, held: boolean) {
    this.#input.press = { ...point, at: this.#time, held };
    if (held && this.#chosen.holds) this.#suppressSelection();
    this.#touched();
  }

  #grab = () => {
    const waiting = this.#waiting;
    if (waiting === undefined) return;
    this.#waiting = undefined;
    this.#grabbed = true;
    this.#press(waiting.point, true);
  };

  #onFingerMove(event: PointerEvent) {
    if (event.pointerId !== this.#holdPointer) return;
    const waiting = this.#waiting;
    if (waiting !== undefined) {
      const drift = Math.hypot(
        event.clientX - waiting.clientX,
        event.clientY - waiting.clientY,
      );
      if (drift > GRAB_SLOP) this.#endHold();
      return;
    }
    if (!this.#grabbed) return;
    const point = this.#logical(event.clientX, event.clientY);
    if (point === undefined) return;
    this.#input.pointer = point;
    this.#touched();
  }

  /** Only the pointer that began the hold may end it; another finger lifting must not. */
  #onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId === this.#holdPointer) {
      this.#release(event.type === "pointerup");
    }
  };

  /**
   * A touch hold's backstop for `pointerup` and `pointercancel`. Touches carry
   * no pointer id, so it waits for the last finger to lift.
   */
  #onTouchEnd = (event: TouchEvent) => {
    if (this.#waiting === undefined && !this.#grabbed) return;
    if (event.touches.length === 0) this.#release(event.type === "touchend");
  };

  /** A touch lifted before it could grab is a tap: a press already released. */
  #release(lifted: boolean) {
    const waiting = this.#waiting;
    this.#endHold();
    if (waiting !== undefined && lifted) this.#press(waiting.point, false);
  }

  /** In iOS Safari only this stops a touch scroll and its overscroll bounce; pointer events and `touch-action` on the page can't. */
  #onTouchMove = (event: TouchEvent) => {
    if (this.#grabbed && event.cancelable) event.preventDefault();
  };

  /**
   * Also run on `pointercancel`, which is how a touch scroll starts, and on
   * blur, where the release would never arrive.
   */
  #endHold = () => {
    clearTimeout(this.#waiting?.timer);
    this.#waiting = undefined;
    if (this.#grabbed) {
      this.#grabbed = false;
      this.#input.pointer = undefined;
    }
    if (this.#input.press !== undefined) this.#input.press.held = false;
    document.documentElement.removeAttribute(HOLDING);
  };

  /**
   * Without `preventDefault`, which would break touch scrolling: the layer
   * ignores pointer events, so a drag from the margin starts a native text
   * selection that would otherwise end the hold.
   */
  #suppressSelection() {
    document.documentElement.setAttribute(HOLDING, "");
    getSelection()?.removeAllRanges();
  }

  /** A drag that turned into a text selection is no longer a press. */
  #onSelectionChange = () => {
    if (this.#chosen.holds) return;
    if (getSelection()?.isCollapsed === false) this.#endHold();
  };

  #onMotionChange = () => {
    if (reducedMotion.matches) this.#stop();
    else this.#start();
  };
}

if (!customElements.get("pixel-backdrop")) {
  customElements.define("pixel-backdrop", PixelBackdrop);
}

declare global {
  interface HTMLElementTagNameMap {
    "pixel-backdrop": PixelBackdrop;
  }
}
