import { MAX_GHOST } from "../emulated-canvas-limits";

/**
 * The backdrop's knobs, one entry each: how its default parses and the dev
 * toolbar's control for it. The defaults themselves live only as `--backdrop-*`
 * custom properties on `:root` in global.css, so there is a single source of
 * truth for them; the order here is the panel's.
 */

type Control = {
  label: string;
  /** Starts a new section of the panel, under this heading. */
  heading?: string;
} & (
  | { kind: "range"; min: number; max: number; step: number; suffix?: string }
  | {
      kind: "toggle";
      /** A range knob greyed out while the toggle is on. */
      disables?: string;
    }
  | { kind: "select"; choices: Record<string, string> }
  | { kind: "color" }
);

type Knob<T> = { parse(css: string): T; control: Control };

type Spec<K extends Control["kind"]> = Omit<
  Extract<Control, { kind: K }>,
  "kind"
>;

const range = (spec: Spec<"range">): Knob<number> => ({
  parse: Number.parseFloat,
  control: { kind: "range", ...spec },
});

const toggle = (spec: Spec<"toggle">): Knob<boolean> => ({
  parse: (css) => css === "true",
  control: { kind: "toggle", ...spec },
});

const select = <T extends string>(
  spec: Spec<"select"> & { choices: Record<T, string> },
): Knob<T> => ({
  parse: (css) => css as T,
  control: { kind: "select", ...spec },
});

const color = (spec: Spec<"color">): Knob<string> => ({
  parse: (css) => css,
  control: { kind: "color", ...spec },
});

export const KNOBS = {
  /** Whether the backdrop renders at all. */
  enabled: toggle({ label: "Enabled" }),
  /** Size the cells to cover the viewport; when off, `scale` is used as-is. */
  autoFit: toggle({ label: "Fit viewport", disables: "scale" }),
  /** Cell size in display pixels, when `autoFit` is off. */
  scale: range({ label: "Scale", min: 1, max: 64, step: 1 }),
  /** Space between cells, in display pixels. */
  gap: range({ label: "Gap", min: 0, max: 8, step: 1 }),
  /** Cell form. */
  shape: select({
    label: "Shape",
    choices: { square: "Square", circle: "Circle" },
  }),
  /** Share of each previous frame the panel keeps, in percent. */
  ghost: range({
    label: "Ghost",
    min: 0,
    max: Math.round(MAX_GHOST * 100),
    step: 1,
    suffix: "%",
  }),
  /** Opacity of the drifting background noise field, in percent. */
  noise: range({
    label: "Intensity",
    heading: "Background noise",
    min: 0,
    max: 100,
    step: 1,
    suffix: "%",
  }),
  /** Feature size of the noise field, in pixels at the tuned width; it scales with the real one. Larger is softer. */
  noiseScale: range({ label: "Feature size", min: 1, max: 40, step: 1 }),
  /** Drift speed of the noise field, 0–100. */
  noiseSpeed: range({ label: "Drift speed", min: 0, max: 100, step: 1 }),
  /** Colour of the "off" pixels in light mode. */
  lightBase: color({ label: "Pixel (light)", heading: "Pixel colours" }),
  /** Colour of the lit pixels in light mode, across every toy and the noise. */
  lightInk: color({ label: "Ink (light)" }),
  /** Colour of the "off" pixels in dark mode. */
  darkBase: color({ label: "Pixel (dark)" }),
  /** Colour of the lit pixels in dark mode, across every toy and the noise. */
  darkInk: color({ label: "Ink (dark)" }),
} satisfies Record<string, Knob<unknown>>;

export type BackdropKnobs = {
  [K in keyof typeof KNOBS]: ReturnType<(typeof KNOBS)[K]["parse"]>;
};

/** `--backdrop-*`, the custom property each knob's default is read from. */
export const property = (key: string) =>
  `--backdrop-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export function readDefaults(): BackdropKnobs {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(KNOBS).map(([key, { parse }]) => [
      key,
      parse(styles.getPropertyValue(property(key)).trim()),
    ]),
  ) as BackdropKnobs;
}
