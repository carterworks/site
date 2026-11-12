import "./emulated-canvas";
import type { EmulatedCanvas } from "./emulated-canvas";
import { MODES } from "./backdrop-modes";
import { TUNED_GRID, type Look } from "./backdrop-modes/toy";
import { isToyPress } from "./backdrop-press";

/**
 * `<pixel-backdrop>` fills the viewport with a live `<emulated-canvas>` and
 * runs a backdrop toy on it. The toy only draws on the canvas and listens to
 * it, as it would on any canvas; the element picks the toy, styles the canvas
 * (the theme's palette, the drifting noise, the dissolve between toys), and
 * passes it the pointer. The layer is fixed and non-interactive, so the page
 * above it paints its own solid panels over the result.
 *
 * The element owns its render knobs so the dev-toolbar app can tweak them
 * live. The canvas's are mirrored onto the `<emulated-canvas>`'s `data-*`
 * attributes, its public API, and a tweaked knob is also set on it as its
 * `--backdrop-*` custom property, where a toy reads its own. A toy's `look`
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
  /** Shimmer's maximum ripple radius, in canvas pixels at the tuned width. */
  rippleSize: number;
  /** Shimmer's ripple lifetime, in milliseconds. */
  rippleSpeed: number;
  /** Opacity of the drifting background noise field, 0–100. */
  noise: number;
  /** Feature size of the noise field, in pixels at the tuned width; it scales with the real one. Larger is softer. */
  noiseScale: number;
  /** Drift speed of the noise field, 0–100. */
  noiseSpeed: number;
  /** Colour of the "off" pixels in light mode. */
  lightBase: string;
  /** Colour of the lit pixels in light mode, across every toy and the noise. */
  lightInk: string;
  /** Colour of the "off" pixels in dark mode. */
  darkBase: string;
  /** Colour of the lit pixels in dark mode, across every toy and the noise. */
  darkInk: string;
};

const number = Number.parseFloat;
const flag = (value: string) => value === "true";
// The CSS minifier rewrites durations to their shortest form (`900ms` ->
// `.9s`), so the unit must be honoured, not stripped.
const duration = (value: string) =>
  Number.parseFloat(value) * (/\ds$/.test(value) ? 1000 : 1);
const text = <T extends string>(value: string) => value as T;

/** `--backdrop-*`, the custom property each knob's default is read from. */
const property = (key: string) =>
  `--backdrop-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

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
      return [key, parse(styles.getPropertyValue(property(key)).trim())];
    }),
  ) as PixelBackdropOptions;
}

/**
 * Set on `<html>` for the length of a hold; the stylesheet turns off text
 * selection, the touch callout and overscroll for it.
 */
const HOLDING = "data-backdrop-holding";

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
 * A copy of a window pointer event for the canvas, carrying what a toy
 * written for a plain canvas reads. It does not bubble, so it never reaches
 * the window listeners that forward it.
 */
const forwarded = (type: string, event: PointerEvent) =>
  new PointerEvent(type, {
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    buttons: event.buttons,
    isPrimary: event.isPrimary,
  });

export class PixelBackdrop extends HTMLElement {
  #options!: PixelBackdropOptions;
  /** Knobs set through `configure` since the last `reset`: they outrank a toy's look. */
  #tweaked = new Set<string>();
  #canvas?: EmulatedCanvas;
  /** Waits for the canvas when the element is connected before its child is parsed. */
  #canvasObserver = new MutationObserver(() => this.#attach());
  #schemeObserver = new MutationObserver(() => this.#applyPalette());
  #wasDark?: boolean;
  #chosen = MODES[0];
  /** Stops the running toy; set exactly while one runs. */
  #stopToy?: () => void;
  /** The press a hold began with, until the hold ends. */
  #hold?: PointerEvent;
  /**
   * Whether the hold is a touch that has grabbed the toy: its moves go to the
   * toy and never scroll. Any touch in the open grabs at once, for every toy,
   * so none can fall back to scrolling under the finger. One that waited to
   * tell a hold from a swipe lost every quick drag to the scroll; the page
   * still scrolls from its content, where a press is never the toy's.
   */
  #grabbed = false;

  /** The id of the chosen toy, which is the incoming one mid-dissolve. */
  get mode(): string {
    return this.#chosen.id;
  }

  /**
   * The ghost and noise the chosen toy shows: its look's, except that a knob
   * set through `configure()` wins for every toy. A toy's look is tuned to
   * it, so it beats the site-wide default, while a configured value is
   * someone deliberately trying it.
   */
  get look(): Look {
    return { ghost: this.#lookOf("ghost"), noise: this.#lookOf("noise") };
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
    this.#options ??= readDefaults();
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
    window.addEventListener("blur", this.#release, { passive: true });
    // The swap replaces <html>'s attributes, so a hold must not outlive its
    // `HOLDING` styles into the next page.
    document.addEventListener("astro:before-swap", this.#release);
    // Not passive, as blocking a scroll is its job. Registered up front:
    // browsers decide whether a touch may block scrolling as it begins.
    window.addEventListener("touchmove", this.#onTouchMove, { passive: false });
    window.addEventListener("touchend", this.#onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", this.#onTouchEnd, { passive: true });
    document.addEventListener("mouseleave", this.#onPointerLeave);
    reducedMotion.addEventListener("change", this.#onMotionChange);
    darkScheme.addEventListener("change", this.#applyPalette);
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
    window.removeEventListener("blur", this.#release);
    document.removeEventListener("astro:before-swap", this.#release);
    window.removeEventListener("touchmove", this.#onTouchMove);
    window.removeEventListener("touchend", this.#onTouchEnd);
    window.removeEventListener("touchcancel", this.#onTouchEnd);
    document.removeEventListener("mouseleave", this.#onPointerLeave);
    reducedMotion.removeEventListener("change", this.#onMotionChange);
    darkScheme.removeEventListener("change", this.#applyPalette);
    this.#schemeObserver.disconnect();
  }

  /** Merge a partial set of knobs, and repaint. */
  configure(partial: Partial<PixelBackdropOptions>) {
    for (const key of Object.keys(partial)) this.#tweaked.add(key);
    this.#options = { ...(this.#options ?? readDefaults()), ...partial };
    this.#apply();
    if (this.#options.enabled) this.#start();
    else this.#stop();
  }

  /** Restore the defaults from the `--backdrop-*` custom properties. */
  reset() {
    this.configure(readDefaults());
    this.#tweaked.clear();
    this.#apply();
  }

  /**
   * Dissolve into a registered toy, starting it fresh; an unknown id is
   * ignored, and so is the toy already chosen. A request while no toy runs
   * (before the canvas exists, disabled, reduced motion) is remembered and
   * starts when one can.
   */
  setMode(id: string) {
    const toy = MODES.find((candidate) => candidate.id === id);
    if (toy === undefined || toy === this.#chosen) return;
    this.#chosen = toy;
    const canvas = this.#canvas;
    if (canvas === undefined || this.#stopToy === undefined) return;
    this.#release();
    this.#stopToy();
    canvas.transition();
    this.#applyLook(canvas);
    this.#stopToy = toy.start(canvas);
  }

  #lookOf(key: keyof Look) {
    const look = this.#chosen.look;
    return look === undefined || this.#tweaked.has(key)
      ? this.#options[key]
      : look[key];
  }

  #start() {
    const canvas = this.#canvas;
    if (canvas === undefined || this.#stopToy !== undefined) return;
    if (reducedMotion.matches || !this.#options.enabled) return;
    delete canvas.dataset.manual;
    this.#stopToy = this.#chosen.start(canvas);
  }

  /** The canvas goes manual too, so its fades and drift stop with the toy. */
  #stop() {
    this.#release();
    this.#stopToy?.();
    this.#stopToy = undefined;
    if (this.#canvas !== undefined) this.#canvas.dataset.manual = "";
  }

  /** Mirror the knobs onto the canvas. */
  #apply() {
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    const { autoFit, enabled, gap, noiseScale, noiseSpeed, scale, shape } =
      this.#options;

    set(canvas, "gap", String(gap));
    set(canvas, "shape", shape);
    set(canvas, "scale", String(scale));
    set(canvas, "noiseScale", String((noiseScale * canvas.width) / TUNED_GRID));
    set(canvas, "noiseSpeed", String(noiseSpeed));
    this.#applyLook(canvas);
    this.#applyPalette();
    if (autoFit)
      canvas.style.setProperty("--emulated-canvas-scale", this.#fit(canvas));
    else canvas.style.removeProperty("--emulated-canvas-scale");
    for (const [key, value] of Object.entries(this.#options)) {
      if (this.#tweaked.has(key)) {
        canvas.style.setProperty(property(key), String(value));
      } else {
        canvas.style.removeProperty(property(key));
      }
    }

    this.toggleAttribute("data-disabled", !enabled);
  }

  #applyLook(canvas: EmulatedCanvas) {
    set(canvas, "ghost", String(Math.round(this.#lookOf("ghost"))));
    set(canvas, "noise", String(Math.round(this.#lookOf("noise"))));
  }

  /**
   * The ghost would otherwise cross-fade the old scheme through grey while
   * the page colour changes at once, so a flip starts the passes afresh.
   */
  #applyPalette = () => {
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    const dark = prefersDark();
    if (this.#wasDark !== undefined && this.#wasDark !== dark) canvas.reset();
    this.#wasDark = dark;
    const { darkBase, darkInk, lightBase, lightInk } = this.#options;
    set(canvas, "paletteBase", dark ? darkBase : lightBase);
    set(canvas, "paletteInk", dark ? darkInk : lightInk);
  };

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
  #fit(canvas: EmulatedCanvas) {
    return `max(1px, round(up, max(100lvw, 100lvh) / ${canvas.width}, 1px) - ${this.#options.gap}px)`;
  }

  #forward(type: string, event: PointerEvent) {
    this.#canvas?.dispatchEvent(forwarded(type, event));
  }

  /** Touch has no hover: only a grabbed finger's moves reach the toy. */
  #onPointerMove = (event: PointerEvent) => {
    if (this.#stopToy === undefined) return;
    if (
      event.pointerType === "touch" &&
      !(this.#grabbed && event.pointerId === this.#hold?.pointerId)
    ) {
      return;
    }
    this.#forward("pointermove", event);
  };

  #onPointerLeave = () => {
    if (this.#stopToy === undefined) return;
    this.#canvas?.dispatchEvent(
      new PointerEvent("pointerleave", { pointerType: "mouse" }),
    );
  };

  /**
   * A stopped backdrop draws nothing, so a hold there would only block the
   * page's scroll and selection over an empty screen.
   */
  #onPointerDown = (event: PointerEvent) => {
    if (this.#stopToy === undefined || !isToyPress(event)) return;
    this.#release();
    this.#hold = event;
    this.#grabbed = event.pointerType === "touch";
    this.#suppressSelection();
    this.#forward("pointerdown", event);
  };

  /** Only the pointer that began the hold may end it; another finger lifting must not. */
  #onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== this.#hold?.pointerId) return;
    this.#endHold();
    this.#forward(event.type, event);
  };

  /**
   * A touch hold's backstop for `pointerup` and `pointercancel`. Touches carry
   * no pointer id, so it waits for the last finger to lift.
   */
  #onTouchEnd = (event: TouchEvent) => {
    if (this.#grabbed && event.touches.length === 0) this.#release();
  };

  /**
   * In iOS Safari only this stops a touch scroll and its overscroll bounce;
   * pointer events and `touch-action` on the page can't. iOS waits on a
   * non-passive listener before it starts scrolling, so cancelling the first
   * move is enough. `touchstart` is left alone: cancelling it would also
   * swallow the click and focus a tap synthesizes.
   */
  #onTouchMove = (event: TouchEvent) => {
    if (this.#grabbed && event.cancelable) event.preventDefault();
  };

  /**
   * Ends a hold the pointer never released: on blur, a navigation, a touch
   * backstop, a toy change or a stop. The toy is told by a `pointercancel`,
   * as a plain canvas tells it when a touch turns into a scroll.
   */
  #release = () => {
    const hold = this.#hold;
    this.#endHold();
    if (hold !== undefined && this.#stopToy !== undefined) {
      this.#forward("pointercancel", hold);
    }
  };

  #endHold() {
    this.#hold = undefined;
    this.#grabbed = false;
    document.documentElement.removeAttribute(HOLDING);
  }

  /**
   * Without `preventDefault`, which would break touch scrolling: the layer
   * ignores pointer events, so a drag from the margin starts a native text
   * selection across the page instead of dragging the toy.
   */
  #suppressSelection() {
    document.documentElement.setAttribute(HOLDING, "");
    getSelection()?.removeAllRanges();
  }

  #onMotionChange = () => {
    if (reducedMotion.matches) this.#stop();
    else this.#start();
  };
}

/** Written only on a change, as every write re-presents the canvas. */
function set(canvas: EmulatedCanvas, key: string, value: string) {
  if (canvas.dataset[key] !== value) canvas.dataset[key] = value;
}

if (!customElements.get("pixel-backdrop")) {
  customElements.define("pixel-backdrop", PixelBackdrop);
}

declare global {
  interface HTMLElementTagNameMap {
    "pixel-backdrop": PixelBackdrop;
  }
}
