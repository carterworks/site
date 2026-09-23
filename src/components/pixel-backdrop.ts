/**
 * `<pixel-backdrop>` fills the viewport with a live `<emulated-canvas>` and
 * feeds it pointer input: moving the mouse drags a smeared trail, clicking
 * drops an expanding ripple. The layer is fixed and non-interactive, so the
 * page above it supplies its own translucency and blur to frost the result.
 *
 * The element owns its render knobs so the dev-toolbar app can tweak them
 * live. Every knob is mirrored onto the inner `<emulated-canvas>`'s `data-*`
 * attributes — the component's public API — and the two panel knobs become
 * CSS custom properties on the root. In dev the current options persist to
 * localStorage, so a tweak survives reloads.
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
  /** How long, in milliseconds, a hovered cell keeps feeding the trail. */
  trail: number;
  /** Maximum ripple radius, in logical pixels. */
  rippleSize: number;
  /** Ripple lifetime, in milliseconds. */
  rippleSpeed: number;
  /** Opacity of the frosted content panel, 0–100. */
  panelOpacity: number;
  /** Gaussian blur of the frosted content panel, in pixels. */
  panelBlur: number;
  /** Colour of the "off" pixels in light mode. */
  lightBase: string;
  /** Colour of the trail and ripples in light mode. */
  lightInk: string;
  /** Colour of the "off" pixels in dark mode. */
  darkBase: string;
  /** Colour of the trail and ripples in dark mode. */
  darkInk: string;
};

export const PIXEL_BACKDROP_DEFAULTS: PixelBackdropOptions = {
  enabled: true,
  autoFit: true,
  scale: 20,
  gap: 2,
  shape: "circle",
  ghost: 90,
  trail: 1000,
  rippleSize: 25,
  rippleSpeed: 900,
  panelOpacity: 41,
  panelBlur: 4,
  lightBase: "#ffffff",
  lightInk: "#c7c7c7",
  darkBase: "#141414",
  darkInk: "#9e9e9e",
};

/**
 * The defaults live as `--backdrop-*` custom properties on `:root` (see
 * `global.css`); this reads them once, falling back to the literals above for
 * anything missing (e.g. before styles apply).
 */
export function readDefaults(): PixelBackdropOptions {
  const styles = getComputedStyle(document.documentElement);
  const text = (name: string) => styles.getPropertyValue(name).trim();
  const number = (name: string, fallback: number) => {
    const value = Number.parseFloat(text(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const flag = (name: string, fallback: boolean) => {
    const value = text(name);
    return value === "" ? fallback : value === "true";
  };
  const colour = (name: string, fallback: string) => text(name) || fallback;
  const shape = text("--backdrop-shape");

  return {
    enabled: flag("--backdrop-enabled", PIXEL_BACKDROP_DEFAULTS.enabled),
    autoFit: flag("--backdrop-auto-fit", PIXEL_BACKDROP_DEFAULTS.autoFit),
    scale: number("--backdrop-scale", PIXEL_BACKDROP_DEFAULTS.scale),
    gap: number("--backdrop-gap", PIXEL_BACKDROP_DEFAULTS.gap),
    shape:
      shape === "square" || shape === "circle"
        ? shape
        : PIXEL_BACKDROP_DEFAULTS.shape,
    ghost: number("--backdrop-ghost", PIXEL_BACKDROP_DEFAULTS.ghost),
    trail: number("--backdrop-trail", PIXEL_BACKDROP_DEFAULTS.trail),
    rippleSize: number(
      "--backdrop-ripple-size",
      PIXEL_BACKDROP_DEFAULTS.rippleSize,
    ),
    rippleSpeed: number(
      "--backdrop-ripple-speed",
      PIXEL_BACKDROP_DEFAULTS.rippleSpeed,
    ),
    panelOpacity: number(
      "--backdrop-panel-opacity",
      PIXEL_BACKDROP_DEFAULTS.panelOpacity,
    ),
    panelBlur: number(
      "--backdrop-panel-blur",
      PIXEL_BACKDROP_DEFAULTS.panelBlur,
    ),
    lightBase: colour(
      "--backdrop-light-base",
      PIXEL_BACKDROP_DEFAULTS.lightBase,
    ),
    lightInk: colour("--backdrop-light-ink", PIXEL_BACKDROP_DEFAULTS.lightInk),
    darkBase: colour("--backdrop-dark-base", PIXEL_BACKDROP_DEFAULTS.darkBase),
    darkInk: colour("--backdrop-dark-ink", PIXEL_BACKDROP_DEFAULTS.darkInk),
  };
}

const STORAGE_KEY = "pixel-backdrop";
const MAX_RIPPLES = 24;
const DEV = import.meta.env.DEV;

/** The bits of `<emulated-canvas>` this element needs. */
type EmulatedCanvasElement = HTMLElement & {
  getContext(id: "2d"): CanvasRenderingContext2D | null;
};

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const darkScheme = matchMedia("(prefers-color-scheme: dark)");

/** Light/dark follows the site's manual override first, then the OS. */
function prefersDark() {
  const override = document.documentElement.style.colorScheme;
  if (override === "dark") return true;
  if (override === "light") return false;
  return darkScheme.matches;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

class PixelBackdrop extends HTMLElement {
  #options: PixelBackdropOptions = { ...PIXEL_BACKDROP_DEFAULTS };
  #canvas?: EmulatedCanvasElement;
  #context?: CanvasRenderingContext2D;
  #frame?: number;
  #columns = 0;
  #rows = 0;
  #ripples: { x: number; y: number; born: number }[] = [];
  #saveTimeout?: number;
  #pointer = {
    x: -1,
    y: -1,
    fromX: -1,
    fromY: -1,
    moved: 0,
    active: false,
  };

  /** A copy of the current knobs, for the dev toolbar to read. */
  get options(): PixelBackdropOptions {
    return { ...this.#options };
  }

  connectedCallback() {
    const canvas = this.querySelector<EmulatedCanvasElement>("emulated-canvas");
    if (canvas === null) return;
    this.#canvas = canvas;
    this.#columns = Number(canvas.dataset.width) || 64;
    this.#rows = Number(canvas.dataset.height) || 64;
    this.#options = { ...readDefaults(), ...this.#load() };
    this.#apply();

    window.addEventListener("pointermove", this.#onPointerMove, {
      passive: true,
    });
    window.addEventListener("pointerdown", this.#onPointerDown, {
      passive: true,
    });
    document.addEventListener("mouseleave", this.#onPointerLeave);
    window.addEventListener("resize", this.#onResize, { passive: true });
    reducedMotion.addEventListener("change", this.#onMotionChange);

    this.#start();
  }

  disconnectedCallback() {
    this.#stop();
    window.removeEventListener("pointermove", this.#onPointerMove);
    window.removeEventListener("pointerdown", this.#onPointerDown);
    document.removeEventListener("mouseleave", this.#onPointerLeave);
    window.removeEventListener("resize", this.#onResize);
    reducedMotion.removeEventListener("change", this.#onMotionChange);
  }

  /** Merge a partial set of knobs, repaint, and (in dev) persist. */
  configure(partial: Partial<PixelBackdropOptions>) {
    this.#options = { ...this.#options, ...partial };
    this.#apply();
    if (this.#options.enabled) this.#start();
    else this.#stop();
    this.#save();
  }

  /** Restore the defaults from the `--backdrop-*` custom properties. */
  reset() {
    this.#options = { ...readDefaults() };
    this.#apply();
    this.#start();
    this.#save();
  }

  #start() {
    if (this.#frame !== undefined) return;
    if (reducedMotion.matches || !this.#options.enabled) return;
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    // The component may not be defined yet; wait, then take its context. The
    // first `getContext` is what starts the component mirroring each frame.
    customElements.whenDefined("emulated-canvas").then(() => {
      if (!this.isConnected || this.#frame !== undefined) return;
      if (reducedMotion.matches || !this.#options.enabled) return;
      const context = canvas.getContext("2d");
      if (context === null) return;
      this.#context = context;
      this.#frame = requestAnimationFrame(this.#tick);
    });
  }

  #stop() {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    this.#context = undefined;
  }

  /** Mirror every knob onto the component, and the panel knobs onto the root. */
  #apply() {
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    const {
      autoFit,
      enabled,
      gap,
      ghost,
      panelBlur,
      panelOpacity,
      scale,
      shape,
    } = this.#options;

    canvas.dataset.gap = String(gap);
    canvas.dataset.shape = shape;
    canvas.dataset.ghost = String(ghost);
    if (autoFit) this.#fit();
    else canvas.dataset.scale = String(scale);

    const root = document.documentElement.style;
    root.setProperty("--backdrop-panel-opacity", `${panelOpacity}%`);
    root.setProperty("--backdrop-panel-blur", `${panelBlur}px`);

    this.toggleAttribute("data-disabled", !enabled);
  }

  /** Choose a cell size that makes the square grid cover the viewport. */
  #fit() {
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    const cover = Math.max(window.innerWidth, window.innerHeight);
    const gap = (this.#columns - 1) * this.#options.gap;
    const scale = Math.max(1, Math.ceil((cover - gap) / this.#columns));
    canvas.dataset.scale = String(scale);
  }

  #tick = (now: number) => {
    this.#draw(now);
    this.#frame = requestAnimationFrame(this.#tick);
  };

  #draw(now: number) {
    const context = this.#context;
    if (context === undefined) return;

    const dark = prefersDark();
    const base = dark ? this.#options.darkBase : this.#options.lightBase;
    const ink = dark ? this.#options.darkInk : this.#options.lightInk;

    context.fillStyle = base;
    context.fillRect(0, 0, this.#columns, this.#rows);

    const pointer = this.#pointer;
    if (pointer.active && now - pointer.moved < this.#options.trail) {
      context.strokeStyle = ink;
      context.fillStyle = ink;
      context.lineWidth = 1;
      if (pointer.fromX >= 0) {
        context.beginPath();
        context.moveTo(pointer.fromX + 0.5, pointer.fromY + 0.5);
        context.lineTo(pointer.x + 0.5, pointer.y + 0.5);
        context.stroke();
      }
      context.fillRect(pointer.x, pointer.y, 1, 1);
    }

    for (let i = this.#ripples.length - 1; i >= 0; i -= 1) {
      const ripple = this.#ripples[i];
      // `born` comes from performance.now() in the event handler while `now` is
      // the rAF timestamp, which can trail it on the click's own frame; clamp
      // or `arc` throws on a negative radius and kills the loop.
      const age = Math.max(0, now - ripple.born);
      if (age >= this.#options.rippleSpeed) {
        this.#ripples.splice(i, 1);
        continue;
      }
      const progress = age / this.#options.rippleSpeed;
      context.beginPath();
      context.arc(
        ripple.x,
        ripple.y,
        progress * this.#options.rippleSize,
        0,
        Math.PI * 2,
      );
      context.lineWidth = 1;
      context.strokeStyle = ink;
      context.globalAlpha = 1 - progress;
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  /** Viewport point -> logical cell in the source bitmap. */
  #cell(clientX: number, clientY: number) {
    const canvas = this.#canvas;
    if (canvas === undefined) return undefined;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    const x = clamp(
      Math.floor(((clientX - rect.left) / rect.width) * this.#columns),
      0,
      this.#columns - 1,
    );
    const y = clamp(
      Math.floor(((clientY - rect.top) / rect.height) * this.#rows),
      0,
      this.#rows - 1,
    );
    return { x, y };
  }

  #onPointerMove = (event: PointerEvent) => {
    // Touch has no hover; taps alone drive ripples.
    if (event.pointerType === "touch") return;
    const cell = this.#cell(event.clientX, event.clientY);
    if (cell === undefined) return;

    const pointer = this.#pointer;
    if (!pointer.active || cell.x !== pointer.x || cell.y !== pointer.y) {
      pointer.fromX = pointer.active ? pointer.x : cell.x;
      pointer.fromY = pointer.active ? pointer.y : cell.y;
    }
    pointer.x = cell.x;
    pointer.y = cell.y;
    pointer.moved = performance.now();
    pointer.active = true;
  };

  #onPointerLeave = () => {
    this.#pointer.active = false;
  };

  #onPointerDown = (event: PointerEvent) => {
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * this.#columns;
    const y = ((event.clientY - rect.top) / rect.height) * this.#rows;
    if (x < 0 || y < 0 || x > this.#columns || y > this.#rows) return;

    this.#ripples.push({ x, y, born: performance.now() });
    if (this.#ripples.length > MAX_RIPPLES) this.#ripples.shift();
  };

  #onResize = () => {
    if (this.#options.autoFit) this.#fit();
  };

  #onMotionChange = () => {
    if (reducedMotion.matches) this.#stop();
    else this.#start();
  };

  #save() {
    if (!DEV) return;
    // Sliders fire on every pointer move, and a synchronous storage write on
    // each one stalls the drag; coalesce the writes instead.
    window.clearTimeout(this.#saveTimeout);
    this.#saveTimeout = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#options));
      } catch {
        // Storage may be unavailable (private mode); tweaks just won't persist.
      }
    }, 250);
  }

  #load(): Partial<PixelBackdropOptions> {
    if (!DEV) return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw === null
        ? {}
        : (JSON.parse(raw) as Partial<PixelBackdropOptions>);
    } catch {
      return {};
    }
  }
}

if (!customElements.get("pixel-backdrop")) {
  customElements.define("pixel-backdrop", PixelBackdrop);
}
