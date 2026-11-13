import "./emulated-canvas/element";
import type { EmulatedCanvas } from "./emulated-canvas/element";
import { DISPLAYS, storedDisplay, type Display } from "./backdrop-displays";
import { TOYS } from "./backdrop-toys";
import type { Look, Toy } from "./backdrop-toys/toy";
import { relayPointer } from "./pixel-backdrop/pointer-relay";
import { readDefaults, type BackdropKnobs } from "./pixel-backdrop/knobs";
import {
  resolveKnobs,
  resolveLook,
  type ResolvedLook,
} from "./pixel-backdrop/look";

/**
 * `<pixel-backdrop>` fills the viewport with a live `<emulated-canvas>` and
 * runs a backdrop toy on it. The toy only draws on the canvas and listens to
 * it, as it would on any canvas; the element picks the toy, styles the canvas
 * (the display's palette, the drifting noise, the dissolve between toys), and
 * passes it the pointer. The layer is fixed and non-interactive, so the page
 * above it paints its own solid panels over the result.
 *
 * The element owns its render knobs so the dev-toolbar app can tweak them
 * live. `resolveLook` turns them, the toy's look, the display and the scheme
 * into the `<emulated-canvas>`'s `data-*` attributes, its public API, and the
 * properties the backdrop's stylesheet reads.
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
  #defaults?: BackdropKnobs;
  /** Knobs set through `configure` since the last `reset`; see `look`. */
  #tweaks: Partial<BackdropKnobs> = {};
  #canvas?: EmulatedCanvas;
  /** Waits for the canvas when the element is connected before its child is parsed. */
  #canvasObserver = new MutationObserver(() => this.#attach());
  #schemeObserver = new MutationObserver(() => this.#apply());
  /** What is on the canvas and the element, so a change writes only what it alters. */
  #applied?: ResolvedLook;
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
   * set through `configure()` wins for every toy. A display's own ghost rise
   * and fall are not among them.
   */
  get look(): Look {
    const { ghost, noise } = resolveKnobs(this.#state());
    return { ghost, noise };
  }

  /** A copy of the current knobs, for the dev toolbar to read. */
  get options(): BackdropKnobs {
    return { ...this.#defaults, ...this.#tweaks } as BackdropKnobs;
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
    if (canvas !== this.#canvas) this.#applied = undefined;
    this.#canvas = canvas;
    this.#defaults ??= readDefaults();
    this.#display ??= DISPLAYS.find(({ id }) => id === storedDisplay());
    this.#apply();

    reducedMotion.addEventListener("change", this.#onMotionChange);
    darkScheme.addEventListener("change", this.#apply);
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
    darkScheme.removeEventListener("change", this.#apply);
    this.#schemeObserver.disconnect();
  }

  /** Merge a partial set of knobs, and repaint. */
  configure(partial: Partial<BackdropKnobs>) {
    this.#defaults ??= readDefaults();
    this.#tweaks = { ...this.#tweaks, ...partial };
    this.#apply();
    if (this.options.enabled) this.#start();
    else this.#stop();
  }

  /** Restore the defaults from the `--backdrop-*` custom properties. */
  reset() {
    this.#defaults = readDefaults();
    this.configure(this.#defaults);
    this.#tweaks = {};
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
    this.#apply();
    this.#stopToy = run(toy, canvas);
  }

  #state() {
    return {
      defaults: this.#defaults ?? readDefaults(),
      tweaks: this.#tweaks,
      toy: this.#chosen,
      display: this.#display ?? DISPLAYS[0],
    };
  }

  #start() {
    const canvas = this.#canvas;
    if (canvas === undefined || this.#stopToy !== undefined) return;
    if (reducedMotion.matches || !this.options.enabled) return;
    this.#apply();
    delete canvas.dataset.manual;
    this.#stopToy = run(this.#chosen, canvas);
  }

  /** The canvas goes manual too, so its fades and drift stop with the toy. */
  #stop() {
    this.#stopToy?.();
    this.#stopToy = undefined;
    if (this.#canvas !== undefined) this.#canvas.dataset.manual = "";
  }

  /**
   * Writes what changed since the last look, as every write to the canvas
   * reconfigures its passes and re-presents it.
   *
   * The ghost would otherwise cross-fade the old palette through grey while
   * the page colour changes at once, so a change of palette starts the passes
   * afresh. A display's palette is the same in both schemes, so a flip under
   * one changes nothing.
   */
  #apply = () => {
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    const last = this.#applied;
    const look = resolveLook({
      ...this.#state(),
      scheme: prefersDark() ? "dark" : "light",
      columns: canvas.width,
    });
    this.#applied = look;
    for (const [key, value] of changed(look.data, last?.data)) {
      if (value === undefined) delete canvas.dataset[key];
      else canvas.dataset[key] = value;
    }
    for (const [name, value] of changed(look.canvasStyle, last?.canvasStyle)) {
      setStyle(canvas, name, value);
    }
    for (const [name, value] of changed(look.hostStyle, last?.hostStyle)) {
      setStyle(this, name, value);
    }
    for (const [name, on] of changed(look.hostFlags, last?.hostFlags)) {
      this.toggleAttribute(name, on);
    }
    if (last !== undefined && last.palette !== look.palette) canvas.reset();
  };

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

/** The entries of `next` that differ from `last`; all of them when nothing was written yet. */
const changed = <T>(next: Record<string, T>, last?: Record<string, T>) =>
  Object.entries(next).filter(
    ([key, value]) => last === undefined || last[key] !== value,
  );

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
