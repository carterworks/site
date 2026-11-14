import { colourRgb } from "../colour";
import type { Shader } from "../shader";
import { clamp } from "../../../lib/clamp";

/**
 * A 4 x 4 Bayer matrix, row by row, as offsets of up to half a step either
 * way: added before the table rounds to the nearest shade, rank r of 16 tips
 * a pixel up once its luma is past (r + 0.5) / 16 of the way to the next.
 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (rank) => 0.5 - (rank + 0.5) / 16,
);

/**
 * Recolours the frame: each pixel's luma, over black, picks its place on the
 * scale from `data-palette-base` (dark) to `data-palette-ink` (light), CSS
 * colours that are both set or the pass is off, so a consumer can draw in any
 * colour and still show in the palette. `data-palette-stops`, colours
 * separated by spaces, spaces more colours evenly between them, so the scale
 * runs through each.
 * `data-palette-levels` (2 or more) snaps each pixel to the nearest of that
 * many evenly spaced shades, like a panel with few grey levels; as many as the
 * colours lands each shade on one. `data-palette-dither`, with levels, mixes
 * the two shades either side of a pixel's luma in a 4 x 4 ordered pattern in
 * proportion, so detail fainter than a step still shows, as a panel shows grey
 * on its few levels. The pattern is fixed to the bitmap, so moving shapes do
 * not shimmer. The scale is a 256-entry table, rebuilt only when a knob
 * changes.
 */
export const palette: Shader = {
  attributes: [
    "data-palette-base",
    "data-palette-ink",
    "data-palette-stops",
    "data-palette-levels",
    "data-palette-dither",
  ],
  create() {
    let base: string | undefined;
    let ink: string | undefined;
    let stops: string | undefined;
    let steps = 0;
    let dither = false;
    let stale = true;
    const table = new Uint8ClampedArray(256 * 3);
    return {
      configure(data) {
        const levels = Number.parseInt(data.paletteLevels ?? "");
        const nextSteps = levels >= 2 ? levels - 1 : 0;
        if (
          base !== data.paletteBase ||
          ink !== data.paletteInk ||
          stops !== data.paletteStops ||
          steps !== nextSteps
        ) {
          stale = true;
        }
        base = data.paletteBase;
        ink = data.paletteInk;
        stops = data.paletteStops;
        steps = nextSteps;
        dither = data.paletteDither !== undefined;
      },
      active: () => base !== undefined && ink !== undefined,
      apply(pixels, { width }) {
        if (stale) {
          stale = false;
          const colours = [
            base!,
            ...(stops?.split(" ").filter(Boolean) ?? []),
            ink!,
          ].map(colourRgb);
          const segments = colours.length - 1;
          for (let level = 0; level < 256; level += 1) {
            const shade =
              steps > 0
                ? (Math.round((level * steps) / 255) * 255) / steps
                : level;
            const place = (shade * segments) / 255;
            const segment = Math.min(Math.floor(place), segments - 1);
            const from = colours[segment];
            const to = colours[segment + 1];
            for (let channel = 0; channel < 3; channel += 1) {
              table[level * 3 + channel] =
                from[channel] +
                (to[channel] - from[channel]) * (place - segment);
            }
          }
        }
        const step = dither && steps > 0 ? 255 / steps : 0;
        for (let i = 0; i < pixels.length; i += 4) {
          // Rec. 709 weights in 256ths, which sum to 256.
          const luma =
            (pixels[i] * 54 + pixels[i + 1] * 183 + pixels[i + 2] * 19) >> 8;
          let level = ((luma * pixels[i + 3]) / 255) | 0;
          if (step > 0) {
            const pixel = i >> 2;
            const threshold =
              BAYER[(((pixel / width) & 3) << 2) | ((pixel % width) & 3)];
            level = clamp(Math.round(level + threshold * step), 0, 255);
          }
          const entry = level * 3;
          pixels[i] = table[entry];
          pixels[i + 1] = table[entry + 1];
          pixels[i + 2] = table[entry + 2];
          pixels[i + 3] = 255;
        }
        return "still";
      },
    };
  },
};
