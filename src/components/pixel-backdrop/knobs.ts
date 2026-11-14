/**
 * The backdrop's knobs, each with how its default parses. The defaults live
 * only as `--backdrop-*` custom properties on `:root` in global.css, so there
 * is a single source of truth for them. A knob's value type is its kind.
 */

const numeric = Number.parseFloat;
const flag = (css: string) => css === "true";
const choice =
  <T extends string>() =>
  (css: string) =>
    css as T;

export const KNOBS = {
  /** Whether the backdrop renders at all. */
  enabled: flag,
  /** Size the cells to cover the viewport; when off, `scale` is used as-is. */
  autoFit: flag,
  /** Cell size in display pixels, when `autoFit` is off. */
  scale: numeric,
  /** Space between cells, in display pixels. */
  gap: numeric,
  /** Cell form. */
  shape: choice<
    | "square"
    | "circle"
    | "ring"
    | "diamond"
    | "hex"
    | "triangle"
    | "dash"
    | "slash"
    | "cross"
  >(),
  /** Share of each previous frame the panel keeps, in percent. */
  ghost: numeric,
  /** Opacity of the drifting background noise field, in percent. */
  noise: numeric,
  /** Feature size of the noise field, in pixels at the tuned width; it scales with the real one. Larger is softer. */
  noiseScale: numeric,
  /** Drift speed of the noise field, 0–100. */
  noiseSpeed: numeric,
} satisfies Record<string, (css: string) => unknown>;

export type KnobDefaults = {
  [K in keyof typeof KNOBS]: ReturnType<(typeof KNOBS)[K]>;
};

/**
 * Every knob in effect. The palette has no default of its own: it is the
 * shown display's `base` and `ink`, which `configure()` can still override.
 */
export type BackdropKnobs = KnobDefaults & { base: string; ink: string };

/** `--backdrop-*`, the custom property each knob's default is read from. */
export const property = (key: string) =>
  `--backdrop-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export function readDefaults(): KnobDefaults {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(KNOBS).map(([key, parse]) => [
      key,
      parse(styles.getPropertyValue(property(key)).trim()),
    ]),
  ) as KnobDefaults;
}
