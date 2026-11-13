/** What every shader is told about the frame it is processing. */
export type ShaderFrame = {
  /** Logical dimensions, in source pixels. */
  width: number;
  height: number;
  /** Time since the previous present, in milliseconds. */
  elapsedMs: number;
  /** The element's `dataset`, where each pass reads its own `data-*` knobs. */
  data: DOMStringMap;
};

/**
 * How soon a pass needs the next present: never, at the ~8 fps idle rate (for
 * a slow drift, whose steps don't show), or on the next animation frame.
 */
export type Pace = "still" | "idle" | "active";

/**
 * One element's instance of a shader. `apply` edits the logical bitmap's RGBA
 * bytes in place and returns how soon its output changes again, so the canvas
 * knows when to present next. A pass whose knobs leave it off reports so
 * through `active`, a pure query checked first: when no pass is active the
 * bitmap skips the pixel read-back and goes to the display in one copy. A pass
 * that goes inactive and active again is rebuilt, so it starts from the
 * current frame, not a stale one.
 *
 * `configure` is how a pass reads its knobs: it is called with the element's
 * `dataset` when the pass is built and whenever a `data-*` attribute changes,
 * so a pass parses its knobs once instead of on every frame. A pass that
 * reads `frame.data` instead pays for that on each frame. The attribute a
 * pass reads must be in `EmulatedCanvas.observedAttributes`.
 */
export type ShaderPass = {
  configure?(data: DOMStringMap): void;
  active(frame: ShaderFrame): boolean;
  apply(pixels: Uint8ClampedArray, frame: ShaderFrame): Pace;
};

/**
 * Builds a pass for one element, so any state it keeps between frames belongs
 * to that element. A pass reading its knobs from `frame.data` needs no change
 * to the element: write one, add it to `SHADERS` and document its `data-*`
 * attribute. One that parses them in `configure` must also list them in
 * `EmulatedCanvas.observedAttributes`. For example, an inverter:
 *
 * ```ts
 * const invert: Shader = () => ({
 *   active: ({ data }) => data.invert !== undefined,
 *   apply(pixels) {
 *     for (let i = 0; i < pixels.length; i += 4)
 *       for (let c = i; c < i + 3; c += 1) pixels[c] = 255 - pixels[c];
 *     return "still";
 *   },
 * });
 * ```
 */
export type Shader = () => ShaderPass;
