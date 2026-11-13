/**
 * The backdrop's knobs, each with how its default parses. The defaults live
 * only as `--backdrop-*` custom properties on `:root` in global.css, so there
 * is a single source of truth for them. A knob's value type is its kind; the
 * dev toolbar pairs each with a control of its own, so none of the panel's
 * presentation ships to every page.
 */

const numeric = Number.parseFloat;
const flag = (css: string) => css === "true";
const choice =
  <T extends string>() =>
  (css: string) =>
    css as T;
const color = (css: string) => css;

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
  /** Colour of the "off" pixels in light mode. */
  lightBase: color,
  /** Colour of the lit pixels in light mode, across every toy and the noise. */
  lightInk: color,
  /** Colour of the "off" pixels in dark mode. */
  darkBase: color,
  /** Colour of the lit pixels in dark mode, across every toy and the noise. */
  darkInk: color,
} satisfies Record<string, (css: string) => unknown>;

export type BackdropKnobs = {
  [K in keyof typeof KNOBS]: ReturnType<(typeof KNOBS)[K]>;
};

/** `--backdrop-*`, the custom property each knob's default is read from. */
export const property = (key: string) =>
  `--backdrop-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export function readDefaults(): BackdropKnobs {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(KNOBS).map(([key, parse]) => [
      key,
      parse(styles.getPropertyValue(property(key)).trim()),
    ]),
  ) as BackdropKnobs;
}
