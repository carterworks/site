import "../emulated-canvas/element";
import type { EmulatedCanvas } from "../emulated-canvas/element";
import { TOYS } from "../backdrop-toys";
import type { Toy } from "../backdrop-toys/toy";
import type { BackdropDisplay } from "./display";
import { relayPointer } from "./pointer-relay";
import { readDefaults, type BackdropKnobs, type KnobDefaults } from "./knobs";
import { resolveKnobs, resolveLook } from "./look";

export type { BackdropDisplay, DisplayLook } from "./display";
export type { BackdropKnobs } from "./knobs";
export type { Toy, ToyCanvas } from "../backdrop-toys/toy";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const PLAIN: BackdropDisplay = { base: "#ffffff", ink: "#000000" };

/**
 * `<pixel-backdrop>` fills the viewport with a live `<emulated-canvas>`, its
 * child, and runs a backdrop toy on it. The toy only draws on the canvas and
 * listens to it, as it would on any canvas; the element picks the toy, styles
 * the canvas (the display's palette, the drifting noise, the dissolve between
 * toys), and passes it the pointer. The layer is fixed and non-interactive,
 * so the page above it paints its own solid panels over the result. Its
 * layout is `pixel-backdrop.css`, which also holds the knobs' defaults; a
 * page overrides them on its own `:root`.
 *
 * The element owns its render knobs, which `configure()` can tweak live.
 * `resolveLook` turns them, the toy's look and the display into the
 * `<emulated-canvas>`'s `data-*` attributes, its public API, and the
 * properties the backdrop's stylesheet reads. Under reduced motion it runs
 * no toy.
 *
 * @summary A fixed, viewport-filling pixel grid that runs an interactive canvas toy.
 * @cssprop [--backdrop-enabled=true] - Whether the backdrop renders at all.
 * @cssprop [--backdrop-auto-fit=true] - Size the cells to cover the viewport; when `false`, `--backdrop-scale` is used as is.
 * @cssprop [--backdrop-scale=7] - Cell size in CSS pixels, when auto-fit is off.
 * @cssprop [--backdrop-gap=2] - Space between cells, in CSS pixels.
 * @cssprop [--backdrop-shape=square] - Cell form, one of `<emulated-canvas>`'s `data-shape` values.
 * @cssprop [--backdrop-ghost=70%] - Share of each previous frame the panel keeps.
 * @cssprop [--backdrop-noise=18%] - Opacity of the drifting background noise.
 * @cssprop [--backdrop-noise-scale=15] - Feature size of the noise at an 80-pixel-wide canvas; it scales with the real one. Larger is softer.
 * @cssprop [--backdrop-noise-speed=5] - Drift speed of the noise, 0–100.
 * @cssprop [--backdrop-page-color=Canvas] - What shows behind the backdrop, which a plain display paints its gaps in.
 */
export class PixelBackdrop extends HTMLElement {
  #defaults?: KnobDefaults;
  #tweaks: Partial<BackdropKnobs> = {};
  #display = PLAIN;
  #canvas?: EmulatedCanvas;
  /** Waits for the canvas when the element is connected before its child is parsed. */
  #canvasObserver = new MutationObserver(() => this.#attach());
  #chosen = TOYS[0];
  /** Stops the running toy and its pointer relay; set exactly while one runs. */
  #stopToy?: () => void;

  constructor() {
    super();
    // A page may set the display before the element is defined, so its first
    // frame is already in it; that own property would hide the accessor.
    if (Object.hasOwn(this, "display")) {
      const { display } = this;
      Reflect.deleteProperty(this, "display");
      this.display = display;
    }
  }

  /**
   * The screen the toys show on: its palette and, for a physical panel, its
   * look. Set it before the element is defined, or before its canvas is
   * attached, and the first frame is already in it; a change later restarts
   * the canvas's passes when the palette differs.
   */
  get display(): BackdropDisplay {
    return this.#display;
  }

  set display(display: BackdropDisplay) {
    this.#display = display;
    this.#apply();
  }

  /** The id of the chosen toy, which is the incoming one mid-dissolve. */
  get toy(): string {
    return this.#chosen.id;
  }

  /**
   * The knobs in effect for the chosen toy on the display. A display's own
   * ghost rise and fall are not among them.
   */
  get knobs(): BackdropKnobs {
    return resolveKnobs(this.#state());
  }

  /** A copy of the knobs set through `configure` since the last `reset`. */
  get tweaks(): Partial<BackdropKnobs> {
    return { ...this.#tweaks };
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
    this.#defaults ??= readDefaults();
    this.#apply();
    reducedMotion.addEventListener("change", this.#onMotionChange);
    this.#start();
  }

  disconnectedCallback() {
    this.#canvasObserver.disconnect();
    this.#stop();
    reducedMotion.removeEventListener("change", this.#onMotionChange);
  }

  /** Merge a partial set of knobs, and repaint. */
  configure(partial: Partial<BackdropKnobs>) {
    this.#defaults ??= readDefaults();
    this.#tweaks = { ...this.#tweaks, ...partial };
    this.#repaint();
  }

  /** Restore the defaults from the `--backdrop-*` custom properties, and drop every tweak. */
  reset() {
    this.#defaults = readDefaults();
    this.#tweaks = {};
    this.#repaint();
  }

  #repaint() {
    this.#apply();
    if (this.knobs.enabled) this.#start();
    else this.#stop();
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
    if (this.#stopToy !== undefined) {
      this.#stopToy();
      this.#stopToy = undefined;
      this.#canvas?.transition();
    }
    this.#start();
  }

  #state() {
    return {
      defaults: this.#defaults ?? readDefaults(),
      tweaks: this.#tweaks,
      toy: this.#chosen,
      display: this.#display,
    };
  }

  #start() {
    const canvas = this.#canvas;
    if (canvas === undefined || this.#stopToy !== undefined) return;
    if (reducedMotion.matches || !this.knobs.enabled) return;
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
   * Writes only what differs from the markup, as every write to the canvas
   * reconfigures its passes and re-presents it. Comparing with the markup,
   * not the last look, also repairs what anything else changed.
   *
   * The ghost would otherwise cross-fade the old palette through grey while
   * the page colour changes at once, so a change of palette starts the passes
   * afresh.
   */
  #apply() {
    const canvas = this.#canvas;
    if (canvas === undefined) return;
    const look = resolveLook({ ...this.#state(), columns: canvas.width });
    const { paletteBase, paletteInk } = canvas.dataset;
    for (const [key, value] of Object.entries(look.data)) {
      if (canvas.dataset[key] === value) continue;
      if (value === undefined) delete canvas.dataset[key];
      else canvas.dataset[key] = value;
    }
    setStyles(canvas, look.canvasStyle);
    setStyles(this, look.hostStyle);
    for (const [name, on] of Object.entries(look.hostFlags)) {
      this.toggleAttribute(name, on);
    }
    const repainted =
      paletteBase !== look.data.paletteBase ||
      paletteInk !== look.data.paletteInk;
    if (paletteBase !== undefined && repainted) canvas.reset();
  }

  #onMotionChange = () => {
    if (reducedMotion.matches) this.#stop();
    else this.#start();
  };
}

/**
 * Starts `toy` with the pointer relayed to it. A stopped backdrop draws
 * nothing, so a hold there would only block the page's scroll and selection
 * over an empty screen, which is why the relay waits for the toy to start.
 * It stops first, so the toy hears a hold's `pointercancel`.
 */
function run(toy: Toy, canvas: EmulatedCanvas) {
  const stopToy = toy.start(canvas);
  const stopRelay = relayPointer(canvas);
  return () => {
    stopRelay();
    stopToy();
  };
}

function setStyles(
  element: HTMLElement,
  styles: Record<string, string | undefined>,
) {
  for (const [name, value] of Object.entries(styles)) {
    if (element.style.getPropertyValue(name) === (value ?? "")) continue;
    if (value === undefined) element.style.removeProperty(name);
    else element.style.setProperty(name, value);
  }
}

if (!customElements.get("pixel-backdrop")) {
  customElements.define("pixel-backdrop", PixelBackdrop);
}

declare global {
  interface HTMLElementTagNameMap {
    "pixel-backdrop": PixelBackdrop;
  }
}
