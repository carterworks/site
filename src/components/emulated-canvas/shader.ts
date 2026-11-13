/** What every shader is told about the frame it is processing. */
export type ShaderFrame = {
  /** Logical dimensions, in source pixels. */
  width: number;
  height: number;
  /** Time since the previous present, in milliseconds. */
  elapsedMs: number;
};

/**
 * How soon a pass needs the next present: never, at the ~8 fps idle rate (for
 * a slow drift, whose steps don't show), or on the next animation frame.
 */
export type Pace = "still" | "idle" | "active";

/**
 * One element's instance of a shader. `configure` is how it reads its knobs:
 * it is called with the element's `dataset` when the pass is built and
 * whenever an observed attribute changes, so a pass parses its knobs once
 * instead of on every frame.
 *
 * `apply` edits the logical bitmap's RGBA bytes in place and returns how soon
 * its output changes again, so the canvas knows when to present next. A pass
 * whose knobs leave it off reports so through `active`, a pure query checked
 * first: when no pass is active the bitmap skips the pixel read-back and goes
 * to the display in one copy. A pass that goes inactive and active again is
 * rebuilt, so it starts from the current frame, not a stale one.
 */
export type ShaderPass = {
  configure(data: DOMStringMap): void;
  active(): boolean;
  apply(pixels: Uint8ClampedArray, frame: ShaderFrame): Pace;
};

/**
 * A per-pixel effect: the `data-*` attributes it reads, which the element
 * observes for it, and a builder of one element's pass, so any state the pass
 * keeps between frames belongs to that element. To add one, write it in
 * `shaders/` and add it to `SHADERS`; the element needs no change. For
 * example, an inverter:
 *
 * ```ts
 * export const invert: Shader = {
 *   attributes: ["data-invert"],
 *   create() {
 *     let on = false;
 *     return {
 *       configure(data) {
 *         on = data.invert !== undefined;
 *       },
 *       active: () => on,
 *       apply(pixels) {
 *         for (let i = 0; i < pixels.length; i += 4)
 *           for (let c = i; c < i + 3; c += 1) pixels[c] = 255 - pixels[c];
 *         return "still";
 *       },
 *     };
 *   },
 * };
 * ```
 */
export type Shader = {
  attributes: readonly string[];
  create(): ShaderPass;
};
