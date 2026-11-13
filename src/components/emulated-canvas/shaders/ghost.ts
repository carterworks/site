import { clamp } from "../../../lib/clamp";
import { MAX_GHOST } from "../limits";
import type { Shader } from "../shader";

const SIXTY_HZ_FRAME_MS = 1000 / 60;

/** A `data-ghost` percentage as the share of the previous frame kept per 60 Hz frame. */
function retention(ghost: string | undefined) {
  const percent = Number.parseInt(ghost ?? "");
  return Number.isFinite(percent) ? clamp(percent / 100, 0, MAX_GHOST) : 0;
}

/** Retention r per 60 Hz frame is the same curve as τ = -frame / ln r. */
function timeConstant(retained: number) {
  return SIXTY_HZ_FRAME_MS / -Math.log(retained);
}

/** The share of the way to its target a channel moves in `elapsedMs`. */
function response(tau: number, elapsedMs: number) {
  // No retention gives τ = 0, and 0 / 0 at no elapsed time would be NaN.
  return tau > 0 ? 1 - Math.exp(-elapsedMs / tau) : 1;
}

/**
 * A channel within one 8-bit level of its target snaps to it. The step is
 * invisible and ends the fade instead of approaching it forever, and a slowly
 * drifting frame, whose pixels creep a level at a time, then counts as settled
 * instead of keeping its owner presenting at full rate.
 */
const SETTLED_LEVELS = 1;

/**
 * Emulates an LCD's slow pixel response: every channel moves toward the new
 * frame along an exponential with time constant τ, so fast motion leaves a
 * fading trail. Driving it by elapsed time rather than per frame keeps the
 * trail the same length at any refresh rate, and keeping the state in floats
 * lets it land on the frame exactly instead of stalling a few 8-bit steps
 * short.
 *
 * Real panels brighten and darken at different speeds, so a pixel getting
 * brighter overall follows the rise curve in every channel and one getting
 * darker the fall curve. Choosing per pixel rather than per channel keeps a
 * colour change from splitting into a fast and a slow channel.
 *
 * `data-ghost` (0–100, default 0) is the percentage of the previous frame the
 * panel keeps per 60 Hz frame, capped just below 100 so the panel can never
 * freeze. `data-ghost-rise` and `data-ghost-fall` (same range, each defaulting
 * to `data-ghost`) set it apart for pixels getting brighter and darker.
 */
export const ghost: Shader = {
  attributes: ["data-ghost", "data-ghost-rise", "data-ghost-fall"],
  create() {
    let panel: Float32Array | undefined;
    let riseTau = 0;
    let fallTau = 0;
    let active = false;
    return {
      configure(data) {
        const rise = retention(data.ghostRise ?? data.ghost);
        const fall = retention(data.ghostFall ?? data.ghost);
        riseTau = timeConstant(rise);
        fallTau = timeConstant(fall);
        active = rise > 0 || fall > 0;
      },
      active: () => active,
      apply(pixels, { elapsedMs }) {
        if (panel?.length !== pixels.length) {
          // Seed the panel with this frame so it starts opaque; otherwise a high
          // retention would fade in from transparent.
          panel = Float32Array.from(pixels);
          return "still";
        }
        const rise = response(riseTau, elapsedMs);
        const fall = response(fallTau, elapsedMs);
        let changing = false;
        for (let pixel = 0; pixel < pixels.length; pixel += 4) {
          const brightening =
            pixels[pixel] + pixels[pixel + 1] + pixels[pixel + 2] >
            panel[pixel] + panel[pixel + 1] + panel[pixel + 2];
          const share = brightening ? rise : fall;
          for (let i = pixel; i < pixel + 4; i += 1) {
            const target = pixels[i];
            const level = panel[i] + (target - panel[i]) * share;
            if (Math.abs(target - level) < SETTLED_LEVELS) {
              panel[i] = target;
            } else {
              panel[i] = level;
              pixels[i] = level;
              changing = true;
            }
          }
        }
        return changing ? "active" : "still";
      },
    };
  },
};
