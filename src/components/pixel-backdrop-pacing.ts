import { MAX_GHOST } from "./emulated-canvas-limits";

/** The noise drifts ~0.06 cells per frame, so a slow redraw is imperceptible. */
export const IDLE_FRAME_INTERVAL = 1000 / 8;

/**
 * Presented frames until the LCD smear of a change has decayed below one 8-bit
 * colour step. The ghost shader blends per presented frame, so dropping to the
 * idle rate earlier would stretch the fade out in wall-clock time.
 */
export function settleFrames(ghostPercent: number) {
  const retention = Math.min(ghostPercent / 100, MAX_GHOST);
  if (retention <= 0) return 0;
  return Math.ceil(Math.log(1 / 255) / Math.log(retention));
}
