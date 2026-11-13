import type { Pace, Shader, ShaderFrame, ShaderPass } from "./shader";

/** How long after a draw a fade over a drifting pass may keep full rate. */
const DRIFTING_FADE_MS = 1000;

/**
 * One element's passes, built from its shaders and configured from its
 * `dataset`. A present asks `active` first, so that with no pass on it can
 * skip reading the pixels back, then hands them to `apply`.
 */
export class Pipeline {
  readonly #shaders: readonly Shader[];
  readonly #data: DOMStringMap;
  #passes: ShaderPass[];
  readonly #wasActive = new Set<ShaderPass>();

  constructor(shaders: readonly Shader[], data: DOMStringMap) {
    this.#shaders = shaders;
    this.#data = data;
    this.#passes = this.#buildAll();
  }

  configure() {
    for (const pass of this.#passes) pass.configure(this.#data);
  }

  /** Drops every pass's state. */
  reset() {
    this.#passes = this.#buildAll();
    this.#wasActive.clear();
  }

  /**
   * Whether any pass is on. A pass found off after being on is rebuilt here,
   * so when it comes back it starts from the current frame, not a stale one.
   */
  active() {
    let any = false;
    for (let index = 0; index < this.#passes.length; index += 1) {
      const pass = this.#passes[index];
      if (pass.active()) {
        this.#wasActive.add(pass);
        any = true;
      } else if (this.#wasActive.delete(pass)) {
        this.#passes[index] = this.#build(index);
      }
    }
    return any;
  }

  /** Runs every active pass over `pixels`, in order, and returns how soon to present next. */
  apply(
    pixels: Uint8ClampedArray,
    frame: ShaderFrame,
    sinceDrawMs: number,
  ): Pace {
    let active = false;
    let idle = false;
    for (let index = 0; index < this.#passes.length; index += 1) {
      const pass = this.#passes[index];
      if (!pass.active()) continue;
      const pace = pass.apply(pixels, frame);
      active ||= pace === "active";
      idle ||= pace === "idle";
    }
    // A drifting frame can keep a fade more than a level behind on every
    // present, so it never reports settled and would hold full rate for good.
    if (active && (!idle || sinceDrawMs < DRIFTING_FADE_MS)) return "active";
    return active || idle ? "idle" : "still";
  }

  #buildAll() {
    return this.#shaders.map((_, index) => this.#build(index));
  }

  #build(index: number) {
    const pass = this.#shaders[index].create();
    pass.configure(this.#data);
    return pass;
  }
}
