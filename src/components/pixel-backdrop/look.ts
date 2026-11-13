import { hexRgb, multiplyOverlay, type Rgb } from "../../lib/rgb";
import type { Display, DisplayLook } from "../backdrop-displays";
import { TUNED_GRID, type Toy } from "../backdrop-toys/toy";
import type { BackdropKnobs } from "./knobs";

export type LookInput = {
  /** The knobs' defaults, from the `--backdrop-*` custom properties. */
  defaults: BackdropKnobs;
  /** Knobs set through `configure` since the last `reset`. */
  tweaks: Partial<BackdropKnobs>;
  toy: Toy;
  display: Display;
  scheme: "light" | "dark";
  /** The canvas bitmap's width: the noise's feature size and the fit scale with it. */
  columns: number;
};

/** Everything `<pixel-backdrop>` writes for a look; an undefined value is absent. */
export type ResolvedLook = {
  /** The canvas's `data-*` attributes, by `dataset` key. */
  data: Record<string, string | undefined>;
  /** Custom properties on the canvas. */
  canvasStyle: Record<string, string | undefined>;
  /** Custom properties on the backdrop, which its stylesheet reads. */
  hostStyle: Record<string, string | undefined>;
  /** Boolean attributes on the backdrop. */
  hostFlags: Record<string, boolean>;
};

/**
 * A display fixes the cells square and stops the noise, so a screen stays a
 * plain grid whatever toy runs on it. Its ghost is its rise and fall, which
 * `resolveLook` writes beside the knob.
 */
const displayed = (look?: DisplayLook): Partial<BackdropKnobs> | undefined =>
  look && {
    gap: look.gap,
    shape: "square",
    noise: 0,
    lightBase: look.base,
    darkBase: look.base,
    lightInk: look.ink,
    darkInk: look.ink,
  };

/**
 * The knobs in effect: a tweak, the display's, the toy's look, the default.
 * A toy's look is tuned to it, so it beats the site-wide default, while a
 * tweak is someone deliberately trying a value.
 */
export const resolveKnobs = ({
  defaults,
  tweaks,
  toy,
  display,
}: Omit<LookInput, "scheme" | "columns">): BackdropKnobs => ({
  ...defaults,
  ...toy.look,
  ...displayed(display.look),
  ...tweaks,
});

const text = (value?: number) =>
  value === undefined ? undefined : String(value);

export function resolveLook(input: LookInput): ResolvedLook {
  const knobs = resolveKnobs(input);
  const { tweaks, display, scheme, columns } = input;
  const look = display.look;
  const [base, ink] =
    scheme === "dark"
      ? [knobs.darkBase, knobs.darkInk]
      : [knobs.lightBase, knobs.lightInk];
  // A tweaked ghost sets both responses itself.
  const ghostOf = Object.hasOwn(tweaks, "ghost") ? undefined : look;
  return {
    data: {
      gap: String(knobs.gap),
      shape: knobs.shape,
      scale: String(knobs.scale),
      noiseScale: String((knobs.noiseScale * columns) / TUNED_GRID),
      noiseSpeed: String(knobs.noiseSpeed),
      ghost: String(Math.round(knobs.ghost)),
      ghostRise: text(ghostOf?.ghostRise),
      ghostFall: text(ghostOf?.ghostFall),
      noise: String(Math.round(knobs.noise)),
      shadow: text(look?.shadow?.opacity),
      shadowX: text(look?.shadow?.x),
      shadowY: text(look?.shadow?.y),
      paletteBase: base,
      paletteInk: ink,
      paletteLevels: text(look?.levels),
    },
    canvasStyle: {
      "--emulated-canvas-scale": knobs.autoFit
        ? fit(columns, knobs.gap)
        : undefined,
    },
    hostStyle: {
      "--backdrop-display-screen": look && base,
      "--backdrop-display-grid": look?.grid,
      "--backdrop-display-vignette": look && vignette({ ...look, base }),
    },
    hostFlags: {
      "data-disabled": !knobs.enabled,
      "data-vignette": look?.vignette !== undefined,
    },
  };
}

/**
 * The display's tuned vignette multiplies the screen, but a blend over the
 * canvas is re-blended on every present, which costs software rendering more
 * than all else on the page. Plain paint is exact over the screen colour,
 * which most of the screen shows; see `multiplyOverlay`. Gradients mix
 * premultiplied, so every stop between matches the multiply too.
 */
function vignette({ base, vignette }: DisplayLook) {
  if (vignette === undefined) return undefined;
  const screen = hexRgb(base);
  const edge = hexRgb(vignette.edge);
  if (screen === undefined || edge === undefined) return undefined;
  const paint: Rgb = [0, 0, 0];
  const alpha = multiplyOverlay(
    screen,
    edge.map((channel) => channel / 255) as Rgb,
    paint,
  );
  const [r, g, b] = paint.map(Math.round);
  return `radial-gradient(farthest-corner, transparent ${vignette.clear}%, rgb(${r} ${g} ${b} / ${Number(alpha.toFixed(3))}))`;
}

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
const fit = (columns: number, gap: number) =>
  `max(1px, round(up, max(100lvw, 100lvh) / ${columns}, 1px) - ${gap}px)`;
