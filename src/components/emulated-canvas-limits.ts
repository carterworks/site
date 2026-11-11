/** Retention is capped below 1 so the panel can never freeze on one frame. */
export const MAX_GHOST = 0.98;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
