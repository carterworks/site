import { type EmulatedCanvas } from "./emulated-canvas";
import "./emulated-canvas";
import { MODES } from "./backdrop-modes";
import type {
  BackdropInput,
  CellRect,
  ModeInstance,
} from "./backdrop-modes/mode";
import { isToyPress } from "./backdrop-press";
import { makeNoise2D, mulberry32 } from "./backdrop-noise";
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
 * live. Every knob is mirrored onto the inner `<emulated-canvas>`'s `data-*`
 * attributes — the component's public API.
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
  /** Feature size of the noise field, in cells. Larger is softer. */
  noiseScale: number;
  /** Drift speed of the noise field, 0–100. */
  noiseSpeed: number;
  /** Colour of the "off" pixels in light mode. */
  lightBase: string;
  /** Colour of the trail and ripples in light mode. */
  lightInk: string;
  /** Colour of the "off" pixels in dark mode. */
  darkBase: string;
  /** Colour of the trail and ripples in dark mode. */
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

/** Set on `<html>` for the length of a hold; the stylesheet turns it into `user-select: none`. */
const HOLDING = "data-backdrop-holding";

const STEP = 1000 / 60;

/** Time a mode may catch up after a stall, so a long pause doesn't replay in a burst. */
const MAX_CATCH_UP = 250;

/** At the default speed the noise drifts ~0.06 cells per frame, so a slow redraw is imperceptible. */
const IDLE_FRAME_INTERVAL = 1000 / 8;

/**
 * How long after input a drifting frame may stay at full rate for a fade. A
 * fast drift can leave the ghost more than one level behind the noise on every
 * redraw, so it never reports settled, and "still changing" alone would hold
 * full rate indefinitely.
 */
const DRIFTING_FADE_WINDOW = 1000;

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
  #canvas?: EmulatedCanvas;
  #context?: OffscreenCanvasRenderingContext2D;
  #frame?: number;
  #idleTimer?: number;
  #busyAt = -Infinity;
  #wasDark?: boolean;
  #schemeObserver = new MutationObserver(() => this.#wake());
  #columns = 0;
  #rows = 0;
  #chosen = MODES[0];
  #mode?: ModeInstance;
  /** The mode clock, advanced in whole steps. */
  #time = 0;
  #lastTick?: number;
  #accumulated = 0;
  /**
   * Set by input and cleared by a step, so a tick too short for a whole step
   * keeps the loop running until the mode has seen the input.
   */
  #inputPending = false;
  #input: BackdropInput = {
    lastInputAt: -Infinity,
    visible: { left: 0, top: 0, right: 0, bottom: 0 },
  };
  #noise = makeNoise2D(NOISE_SEED);
  #field = new Float32Array(0);
  #image?: ImageData;
  #shades?: { key: string; table: Uint8ClampedArray };
  #rect?: DOMRect;

  /** A copy of the current knobs, for the dev toolbar to read. */
  get options(): PixelBackdropOptions {
    return { ...this.#options };
  }

  connectedCallback() {
    const canvas = this.querySelector("emulated-canvas");
    if (canvas === null) return;
    // Parents upgrade before children, so the child may still be a bare element.
    customElements.upgrade(canvas);
    this.#canvas = canvas;
    canvas.dataset.manual = "";
    this.#columns = canvas.width;
    this.#rows = canvas.height;
    this.#field = new Float32Array(this.#columns * this.#rows);
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
    window.addEventListener("pointerup", this.#endHold, { passive: true });
    window.addEventListener("pointercancel", this.#endHold, { passive: true });
    window.addEventListener("blur", this.#endHold, { passive: true });
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
    this.#stop();
    window.removeEventListener("pointermove", this.#onPointerMove);
    window.removeEventListener("pointerdown", this.#onPointerDown);
    window.removeEventListener("pointerup", this.#endHold);
    window.removeEventListener("pointercancel", this.#endHold);
    window.removeEventListener("blur", this.#endHold);
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
  }

  /**
   * Switch to a registered mode at once, starting it fresh. An unknown id is
   * ignored.
   */
  setMode(id: string) {
    const mode = MODES.find((candidate) => candidate.id === id);
    if (mode === undefined) return;
    this.#chosen = mode;
    if (this.#canvas === undefined) return;
    this.#endHold();
    this.#mode = this.#createMode();
    this.#wake();
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
  }

  /** Mirror every knob onto the component. */
  #apply() {
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    const { autoFit, enabled, gap, ghost, scale, shape } = this.#options;

    this.#rect = undefined;
    canvas.dataset.gap = String(gap);
    canvas.dataset.shape = shape;
    canvas.dataset.ghost = String(ghost);
    canvas.dataset.scale = String(scale);
    if (autoFit)
      canvas.style.setProperty("--emulated-canvas-scale", this.#fit());
    else canvas.style.removeProperty("--emulated-canvas-scale");

    this.toggleAttribute("data-disabled", !enabled);
  }

  /**
   * The cell size that makes the square grid cover the viewport, as CSS so it
   * tracks resizes without script. It measures the large viewport: mobile
   * toolbars sliding in and out would otherwise change the cell size, and the
   * grid would jump while scrolling.
   */
  #fit() {
    const gaps = (this.#columns - 1) * this.#options.gap;
    return `max(1px, round(up, (max(100lvw, 100lvh) - ${gaps}px) / ${this.#columns}, 1px))`;
  }

  #tick = (now: number) => {
    this.#frame = undefined;
    this.#measure();
    this.#advance(now);
    // Asked before render, which may consume what made the mode busy: the
    // frame after it must still be drawn, to clear it.
    const pace = this.#inputPending
      ? "active"
      : (this.#mode?.pace() ?? "still");
    if (pace === "active") this.#busyAt = now;

    this.#draw(now);
    // A fade in flight keeps full rate: at the idle rate it would visibly step,
    // and a static frame that stopped would freeze it half-faded.
    const changing = this.#canvas?.present() ?? false;
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
      this.#inputPending = false;
    }
  }

  /** Static noise has nothing left to redraw until input or `configure`. */
  #noiseDrifts() {
    return this.#options.noise > 0 && this.#options.noiseSpeed > 0;
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
    const key = `${base} ${ink}`;
    if (this.#shades?.key !== key) {
      this.#shades = {
        key,
        table: shadeTable(colourRgb(base), colourRgb(ink)),
      };
    }

    field.fill(0);
    this.#mode?.render(field);
    if (this.#options.noise > 0) {
      const amount = this.#options.noise / 100;
      const frequency = 1 / Math.max(1, this.#options.noiseScale);
      const drift = now * this.#options.noiseSpeed * 0.00005;
      for (let y = 0, i = 0; y < rows; y += 1) {
        const ny = y * frequency + drift * 0.5 + NOISE_OFFSET_Y;
        for (let x = 0; x < columns; x += 1, i += 1) {
          const value = this.#noise(x * frequency + drift + NOISE_OFFSET_X, ny);
          field[i] = Math.max(field[i], amount * (value * 0.5 + 0.5));
        }
      }
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
    // Touch has no hover; taps alone are presses.
    if (event.pointerType === "touch") return;
    const point = this.#logical(event.clientX, event.clientY);
    if (point === undefined) return;
    this.#input.pointer = point;
    this.#touched();
  };

  /** The host is fixed, so only a resize moves its box. */
  #onResize = () => {
    this.#rect = undefined;
  };

  #onPointerLeave = () => {
    this.#input.pointer = undefined;
  };

  /** A new object per press, so a mode tells presses apart by identity. */
  #onPointerDown = (event: PointerEvent) => {
    if (!isToyPress(event)) return;
    const point = this.#logical(event.clientX, event.clientY);
    if (point === undefined) return;
    this.#input.press = { ...point, at: this.#time, held: true };
    if (this.#chosen.holds) this.#suppressSelection();
    this.#touched();
  };

  /**
   * Also run on `pointercancel`, which is how a touch scroll starts, and on
   * blur, where the release would never arrive.
   */
  #endHold = () => {
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
