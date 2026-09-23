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

export const PIXEL_BACKDROP_DEFAULTS: PixelBackdropOptions = {
  enabled: true,
  autoFit: true,
  scale: 20,
  gap: 5,
  shape: "square",
  ghost: 70,
  trail: 1000,
  rippleSize: 25,
  rippleSpeed: 900,
  panelOpacity: 40,
  panelBlur: 5,
  noise: 25,
  noiseScale: 15,
  noiseSpeed: 5,
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
  // The CSS minifier rewrites durations to their shortest form (`900ms` ->
  // `.9s`), so the unit must be honoured, not stripped.
  const duration = (name: string, fallback: number) => {
    const value = text(name);
    const ms = Number.parseFloat(value) * (/\ds$/.test(value) ? 1000 : 1);
    return Number.isFinite(ms) ? ms : fallback;
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
    trail: duration("--backdrop-trail", PIXEL_BACKDROP_DEFAULTS.trail),
    rippleSize: number(
      "--backdrop-ripple-size",
      PIXEL_BACKDROP_DEFAULTS.rippleSize,
    ),
    rippleSpeed: duration(
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
    noise: number("--backdrop-noise", PIXEL_BACKDROP_DEFAULTS.noise),
    noiseScale: number(
      "--backdrop-noise-scale",
      PIXEL_BACKDROP_DEFAULTS.noiseScale,
    ),
    noiseSpeed: number(
      "--backdrop-noise-speed",
      PIXEL_BACKDROP_DEFAULTS.noiseSpeed,
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

/**
 * A small 2D simplex noise, after Stefan Gustavson's public-domain reference.
 * Simplex is preferred over Perlin here: it has no axis-aligned directional
 * artifacts, so the field reads as organic rather than gridded.
 */
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
/** Twelve gradients, flattened to two components each. */
const GRADIENTS = [
  1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0,
  -1,
];
const NOISE_SEED = 0x9e3779b9;
/**
 * Simplex is exactly zero on integer lattice points, so sample off-lattice:
 * without this a 1-cell feature size would flatten to a constant.
 */
const NOISE_OFFSET_X = 12.9898;
const NOISE_OFFSET_Y = 78.233;

/** A tiny deterministic PRNG, so the noise field is stable across reloads. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a seeded 2D simplex field, returning values in [-1, 1]. */
function makeNoise2D(seed: number): (x: number, y: number) => number {
  const random = mulberry32(seed);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) source[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = source[i];
    source[i] = source[j];
    source[j] = swap;
  }
  const permutation = new Uint8Array(512);
  const mod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) {
    permutation[i] = source[i & 255];
    mod12[i] = permutation[i] % 12;
  }

  return (x, y) => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = mod12[ii + permutation[jj]] * 2;
      t0 *= t0;
      n0 = t0 * t0 * (GRADIENTS[g] * x0 + GRADIENTS[g + 1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = mod12[ii + i1 + permutation[jj + j1]] * 2;
      t1 *= t1;
      n1 = t1 * t1 * (GRADIENTS[g] * x1 + GRADIENTS[g + 1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = mod12[ii + 1 + permutation[jj + 1]] * 2;
      t2 *= t2;
      n2 = t2 * t2 * (GRADIENTS[g] * x2 + GRADIENTS[g + 1] * y2);
    }

    return 70 * (n0 + n1 + n2);
  };
}

const rgbCache = new Map<string, [number, number, number]>();
let rgbContext: CanvasRenderingContext2D | null | undefined;

/** Resolve any CSS colour to `[r, g, b]`, caching per string. */
function colourRgb(value: string): [number, number, number] {
  const cached = rgbCache.get(value);
  if (cached !== undefined) return cached;

  let rgb: [number, number, number];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex !== null) {
    const digits =
      hex[1].length === 3
        ? hex[1].replace(/./g, (digit) => digit + digit)
        : hex[1];
    rgb = [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ];
  } else {
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
    rgb = [r, g, b];
  }

  rgbCache.set(value, rgb);
  return rgb;
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
  #noise = makeNoise2D(NOISE_SEED);
  #noiseImage?: ImageData;
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

    if (this.#options.noise > 0) {
      this.#paintNoise(context, now, base, ink);
    } else {
      context.fillStyle = base;
      context.fillRect(0, 0, this.#columns, this.#rows);
    }

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

  /**
   * Fills the bitmap with the base colour lifted toward the ink by a drifting
   * simplex field, so the "off" pixels shimmer. Built as one `ImageData` and
   * blitted in a single call — far cheaper than a `fillRect` per cell.
   */
  #paintNoise(
    context: CanvasRenderingContext2D,
    now: number,
    base: string,
    ink: string,
  ) {
    const columns = this.#columns;
    const rows = this.#rows;
    let image = this.#noiseImage;
    if (
      image === undefined ||
      image.width !== columns ||
      image.height !== rows
    ) {
      image = context.createImageData(columns, rows);
      this.#noiseImage = image;
    }

    const data = image.data;
    const [baseR, baseG, baseB] = colourRgb(base);
    const [inkR, inkG, inkB] = colourRgb(ink);
    const amount = this.#options.noise / 100;
    const frequency = 1 / Math.max(1, this.#options.noiseScale);
    const drift = now * this.#options.noiseSpeed * 0.00005;

    let offset = 0;
    for (let y = 0; y < rows; y += 1) {
      const ny = y * frequency + drift * 0.5 + NOISE_OFFSET_Y;
      for (let x = 0; x < columns; x += 1) {
        const value = this.#noise(x * frequency + drift + NOISE_OFFSET_X, ny);
        const mix = amount * (value * 0.5 + 0.5);
        data[offset] = baseR + (inkR - baseR) * mix;
        data[offset + 1] = baseG + (inkG - baseG) * mix;
        data[offset + 2] = baseB + (inkB - baseB) * mix;
        data[offset + 3] = 255;
        offset += 4;
      }
    }

    context.putImageData(image, 0, 0);
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
