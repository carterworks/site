import "./emulated-canvas";
import type { EmulatedCanvas } from "./emulated-canvas";
import { DISPLAYS, storedDisplay, type Display } from "./backdrop-displays";
import { TOYS } from "./backdrop-toys";
import { TUNED_GRID, type Look, type Toy } from "./backdrop-toys/toy";
import { isToyPress } from "./backdrop-press";
import { readDefaults, type BackdropKnobs } from "./pixel-backdrop/knobs";

/**
 * `<pixel-backdrop>` fills the viewport with a live `<emulated-canvas>` and
 * runs a backdrop toy on it. The toy only draws on the canvas and listens to
 * it, as it would on any canvas; the element picks the toy, styles the canvas
 * (the display's palette, the drifting noise, the dissolve between toys), and
 * passes it the pointer. The layer is fixed and non-interactive, so the page
 * above it paints its own solid panels over the result.
 *
 * The element owns its render knobs so the dev-toolbar app can tweak them
 * live. The canvas's are mirrored onto the `<emulated-canvas>`'s `data-*`
 * attributes, its public API. A toy's `look` stands in for `ghost` and
 * `noise` unless they are tweaked; see `look`.
 */

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
  #options!: BackdropKnobs;
  /** Knobs set through `configure` since the last `reset`: they outrank a toy's look. */
  #tweaked = new Set<string>();
  #canvas?: EmulatedCanvas;
  /** Waits for the canvas when the element is connected before its child is parsed. */
  #canvasObserver = new MutationObserver(() => this.#attach());
  #schemeObserver = new MutationObserver(() => this.#applyPalette());
  #shownPalette?: string;
  #display?: Display;
  #chosen = TOYS[0];
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
  get toy(): string {
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
  get options(): BackdropKnobs {
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
    this.#display ??= DISPLAYS.find(({ id }) => id === storedDisplay());
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
  configure(partial: Partial<BackdropKnobs>) {
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

  /** Show the canvas as a registered display; an unknown id is ignored. */
  setDisplay(id: string) {
    const display = DISPLAYS.find((candidate) => candidate.id === id);
    if (display === undefined || display === this.#display) return;
    this.#display = display;
    this.#apply();
  }

  /**
   * Dissolve into a registered toy, starting it fresh; an unknown id is
   * ignored, and so is the toy already chosen. A request while no toy runs
   * (before the canvas exists, disabled, reduced motion) is remembered and
   * starts when one can.
   */
  setToy(id: string) {
    const toy = TOYS.find((candidate) => candidate.id === id);
    if (toy !== undefined) this.play(toy);
  }

  /** Like `setToy` for a toy the registry does not list. */
  play(toy: Toy) {
    if (toy === this.#chosen) return;
    this.#chosen = toy;
    const canvas = this.#canvas;
    if (canvas === undefined || this.#stopToy === undefined) return;
    this.#release();
    this.#stopToy();
    canvas.transition();
    this.#applyLook(canvas);
    this.#stopToy = toy.start(canvas);
  }

  /**
   * Precedence: a configured knob, the display's, the toy's, the default. A
   * display fixes the cells square and stops the noise, so a screen stays a
   * plain grid whatever toy runs on it.
   */
  #knob<K extends keyof BackdropKnobs>(
    key: K,
    toy?: BackdropKnobs[K],
  ): BackdropKnobs[K] {
    if (this.#tweaked.has(key)) return this.#options[key];
    return this.#displayed[key] ?? toy ?? this.#options[key];
  }

  get #displayed(): Partial<BackdropKnobs> {
    const look = this.#display?.look;
    if (look === undefined) return {};
    return {
      gap: look.gap,
      shape: "square",
      noise: 0,
      lightBase: look.base,
      darkBase: look.base,
      lightInk: look.ink,
      darkInk: look.ink,
    };
  }

  #lookOf(key: keyof Look) {
    return this.#knob(key, this.#chosen.look?.[key]);
  }

  #start() {
    const canvas = this.#canvas;
    if (canvas === undefined || this.#stopToy !== undefined) return;
    if (reducedMotion.matches || !this.#options.enabled) return;
    this.#applyLook(canvas);
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
    const { autoFit, enabled, noiseScale, noiseSpeed, scale } = this.#options;

    set(canvas, "gap", String(this.#knob("gap")));
    set(canvas, "shape", this.#knob("shape"));
    set(canvas, "scale", String(scale));
    set(canvas, "noiseScale", String((noiseScale * canvas.width) / TUNED_GRID));
    set(canvas, "noiseSpeed", String(noiseSpeed));
    this.#applyLook(canvas);
    this.#applyPalette();
    if (autoFit)
      canvas.style.setProperty("--emulated-canvas-scale", this.#fit(canvas));
    else canvas.style.removeProperty("--emulated-canvas-scale");

    this.toggleAttribute("data-disabled", !enabled);
  }

  #applyLook(canvas: EmulatedCanvas) {
    set(canvas, "ghost", String(Math.round(this.#lookOf("ghost"))));
    set(canvas, "noise", String(Math.round(this.#lookOf("noise"))));
    this.#applyDisplayEffects(canvas);
  }

  /** A configured ghost sets both responses itself, so it clears the display's ghost. */
  #applyDisplayEffects(canvas: EmulatedCanvas) {
    const look = this.#display?.look;
    if (look?.shadow === undefined) {
      for (const key of ["shadow", "shadowX", "shadowY"]) {
        delete canvas.dataset[key];
      }
    } else {
      const { opacity, x, y } = look.shadow;
      set(canvas, "shadow", String(opacity));
      set(canvas, "shadowX", String(x));
      set(canvas, "shadowY", String(y));
    }
    if (look === undefined || this.#tweaked.has("ghost")) {
      delete canvas.dataset.ghostRise;
      delete canvas.dataset.ghostFall;
    } else {
      set(canvas, "ghostRise", String(look.ghostRise));
      set(canvas, "ghostFall", String(look.ghostFall));
    }
  }

  /**
   * The ghost would otherwise cross-fade the old palette through grey while
   * the page colour changes at once, so a change of palette starts the passes
   * afresh. A display's palette is the same in both schemes, so a flip under
   * one changes nothing.
   */
  #applyPalette = () => {
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    const [baseKey, inkKey] = prefersDark()
      ? (["darkBase", "darkInk"] as const)
      : (["lightBase", "lightInk"] as const);
    const look = this.#display?.look;
    const base = this.#knob(baseKey);
    const ink = this.#knob(inkKey);
    const palette = `${base} ${ink}`;
    if (this.#shownPalette !== undefined && this.#shownPalette !== palette) {
      canvas.reset();
    }
    this.#shownPalette = palette;
    set(canvas, "paletteBase", base);
    set(canvas, "paletteInk", ink);
    if (look === undefined) delete canvas.dataset.paletteLevels;
    else set(canvas, "paletteLevels", String(look.levels));
    setStyle(this, "--backdrop-display-screen", look?.base);
    setStyle(this, "--backdrop-display-grid", look?.grid);
    setStyle(this, "--backdrop-display-vignette", look?.vignette);
    this.toggleAttribute("data-vignette", look?.vignette !== undefined);
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
    return `max(1px, round(up, max(100lvw, 100lvh) / ${canvas.width}, 1px) - ${this.#knob("gap")}px)`;
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

function setStyle(element: HTMLElement, name: string, value?: string) {
  if (value === undefined) element.style.removeProperty(name);
  else element.style.setProperty(name, value);
}

if (!customElements.get("pixel-backdrop")) {
  customElements.define("pixel-backdrop", PixelBackdrop);
}

declare global {
  interface HTMLElementTagNameMap {
    "pixel-backdrop": PixelBackdrop;
  }
}
