import "./emulated-canvas/element";
import type { EmulatedCanvas } from "./emulated-canvas/element";
import { DISPLAYS, storedDisplay, type Display } from "./backdrop-displays";
import { TOYS } from "./backdrop-toys";
import { TUNED_GRID, type Look, type Toy } from "./backdrop-toys/toy";
import { relayPointer } from "./pixel-backdrop/pointer-relay";
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

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const darkScheme = matchMedia("(prefers-color-scheme: dark)");

/** Light/dark follows the site's manual override first, then the OS. */
function prefersDark() {
  const override = document.documentElement.style.colorScheme;
  if (override === "dark") return true;
  if (override === "light") return false;
  return darkScheme.matches;
}

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
  /** Stops the running toy and its pointer relay; set exactly while one runs. */
  #stopToy?: () => void;

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
    this.#stopToy();
    canvas.transition();
    this.#applyLook(canvas);
    this.#stopToy = run(toy, canvas);
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
    this.#stopToy = run(this.#chosen, canvas);
  }

  /** The canvas goes manual too, so its fades and drift stop with the toy. */
  #stop() {
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

  #onMotionChange = () => {
    if (reducedMotion.matches) this.#stop();
    else this.#start();
  };
}

/**
 * Starts `toy` with the pointer relayed to it. A stopped backdrop draws
 * nothing, so a hold there would only block the page's scroll and selection
 * over an empty screen. The relay stops first, so the toy hears a hold's
 * `pointercancel`.
 */
function run(toy: Toy, canvas: EmulatedCanvas) {
  const stopRelay = relayPointer(canvas);
  const stopToy = toy.start(canvas);
  return () => {
    stopRelay();
    stopToy();
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
