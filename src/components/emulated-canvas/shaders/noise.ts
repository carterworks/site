import {
  makeCoarseNoise,
  makeNoise2D,
  NOISE_OFFSET_X,
  NOISE_OFFSET_Y,
  NOISE_SEED,
} from "../../backdrop-noise";
import { clamp } from "../../../lib/clamp";
import type { Shader } from "../shader";

/**
 * The noise is sampled at most this many pixels apart and filled in between.
 * At the backdrop's feature size that is a quarter of the samples per axis,
 * within 0.02 RMS (0.075 at worst) of sampling every pixel.
 */
const MAX_NOISE_STEP = 4;

/** Fewer samples than this per feature visibly flatten its peaks. */
const NOISE_SAMPLES_PER_FEATURE = 7.5;

function knob(value: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * A drifting simplex field under the frame, so its dark pixels shimmer: each
 * channel is lifted to the noise where that is brighter, like a `lighten`
 * blend, and the drawing shows on top. `data-noise` is its intensity (0–100),
 * `data-noise-scale` its feature size in pixels (default 8) and
 * `data-noise-speed` how fast it drifts (0–100, default 0). At the speeds the
 * backdrop uses the drift moves about a pixel per 60 Hz frame on a desktop
 * screen, so it redraws at the idle rate.
 */
export const noise: Shader = {
  attributes: ["data-noise", "data-noise-scale", "data-noise-speed"],
  create() {
    const sample = makeNoise2D(NOISE_SEED);
    let layer: ReturnType<typeof makeCoarseNoise> | undefined;
    let field = new Float32Array(0);
    let clock = 0;
    let intensity = 0;
    let speed = 0;
    let feature = 8;
    let step = 1;
    return {
      configure(data) {
        intensity = clamp(knob(data.noise, 0), 0, 100) / 100;
        speed = knob(data.noiseSpeed, 0);
        feature = Math.max(1, knob(data.noiseScale, 8));
        step = clamp(
          Math.floor(feature / NOISE_SAMPLES_PER_FEATURE),
          1,
          MAX_NOISE_STEP,
        );
      },
      active: () => intensity > 0,
      apply(pixels, { width, height, elapsedMs }) {
        if (layer === undefined || field.length !== width * height) {
          layer = makeCoarseNoise(sample, width, height);
          field = new Float32Array(width * height);
        }
        clock += elapsedMs;
        const drift = clock * speed * 0.00005;
        field.fill(0);
        layer(
          field,
          step,
          1 / feature,
          drift + NOISE_OFFSET_X,
          drift * 0.5 + NOISE_OFFSET_Y,
          intensity,
        );
        for (let i = 0, cell = 0; i < pixels.length; i += 4, cell += 1) {
          const level = field[cell] * 255;
          // Over black, so a transparent pixel takes the noise rather than hiding it.
          const opacity = pixels[i + 3] / 255;
          for (let channel = i; channel < i + 3; channel += 1) {
            const value = pixels[channel] * opacity;
            pixels[channel] = value > level ? value : level;
          }
          pixels[i + 3] = 255;
        }
        return speed > 0 ? "idle" : "still";
      },
    };
  },
};
