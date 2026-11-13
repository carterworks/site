import { colourRgb } from "../colour";
import type { Shader } from "../shader";

/**
 * Recolours the frame in two colours: each pixel's luma, over black, picks its
 * place on the scale from `data-palette-base` (dark) to `data-palette-ink`
 * (light), so a consumer can draw in any colour and still show in the palette.
 * `data-palette-levels` (2 or more) snaps each pixel to the nearest of that
 * many evenly spaced shades, like a panel with few grey levels. The scale is a
 * 256-entry table, rebuilt only when a knob changes.
 */
export const palette: Shader = () => {
  let base: string | undefined;
  let ink: string | undefined;
  let steps = 0;
  let stale = true;
  const table = new Uint8ClampedArray(256 * 3);
  return {
    configure(data) {
      const levels = Number.parseInt(data.paletteLevels ?? "");
      const nextSteps = levels >= 2 ? levels - 1 : 0;
      if (
        base !== data.paletteBase ||
        ink !== data.paletteInk ||
        steps !== nextSteps
      ) {
        stale = true;
      }
      base = data.paletteBase;
      ink = data.paletteInk;
      steps = nextSteps;
    },
    active: () => base !== undefined && ink !== undefined,
    apply(pixels) {
      if (stale) {
        stale = false;
        const from = colourRgb(base!);
        const to = colourRgb(ink!);
        for (let level = 0; level < 256; level += 1) {
          const shade =
            steps > 0
              ? (Math.round((level * steps) / 255) * 255) / steps
              : level;
          for (let channel = 0; channel < 3; channel += 1) {
            table[level * 3 + channel] =
              from[channel] + ((to[channel] - from[channel]) * shade) / 255;
          }
        }
      }
      for (let i = 0; i < pixels.length; i += 4) {
        // Rec. 709 weights in 256ths, which sum to 256.
        const luma =
          (pixels[i] * 54 + pixels[i + 1] * 183 + pixels[i + 2] * 19) >> 8;
        const entry = (((luma * pixels[i + 3]) / 255) | 0) * 3;
        pixels[i] = table[entry];
        pixels[i + 1] = table[entry + 1];
        pixels[i + 2] = table[entry + 2];
        pixels[i + 3] = 255;
      }
      return "still";
    },
  };
};
