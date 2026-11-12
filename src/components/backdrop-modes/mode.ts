import type { PixelBackdropOptions } from "../pixel-backdrop";

/** Cells along each side of the square grid every mode runs on. */
export const GRID_SIZE = 160;

/**
 * The grid the modes' and the host's feature sizes were tuned on. Sizes in
 * cells scale by `columns / TUNED_GRID`, so a finer grid keeps them the same
 * size on screen.
 */
export const TUNED_GRID = 80;

const REFERENCE_WIDTH_PX = 1440;

/**
 * How many site cells span one design cell of `designCellPx` pixels, with the
 * grid's `columns` drawn across the reference viewport. Multiply a size
 * authored in design cells by it to keep the same size on screen.
 */
export const cellScale = (designCellPx: number, columns: number) =>
  (designCellPx * columns) / REFERENCE_WIDTH_PX;

export type Point = { x: number; y: number };

/** A span of the grid in logical cells; `right` and `bottom` are exclusive. */
export type CellRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** Everything a mode learns about the outside world, refreshed every step. */
export type BackdropInput = {
  /** Where a mouse or pen hovers, in logical cells; absent once it leaves. */
  pointer?: Point;
  /** The latest press: where, at what mode-clock time, and whether it is held. */
  press?: Point & { at: number; held: boolean };
  /** Mode-clock time of the latest pointer input. */
  lastInputAt: number;
  /**
   * The part of the grid inside the viewport, in logical cells. The square grid
   * is sized by the larger viewport side, so one axis overhangs the screen.
   */
  visible: CellRect;
};

export type Look = Pick<PixelBackdropOptions, "ghost" | "noise">;

/** Full frame rate, the ~8 fps idle timer, or no frames at all. */
export type Pace = "active" | "idle" | "still";

export type ModeSetup = {
  columns: number;
  rows: number;
  /**
   * The mode's only source of randomness, seeded by the host, so a run is
   * reproducible. Modes never call `Math.random` or read a clock: time comes
   * only through `step`.
   */
  random: () => number;
  /** The host's live knobs: read them on use, as `configure` changes them. */
  options: Readonly<PixelBackdropOptions>;
};

export type ModeInstance = {
  /** Advances one fixed timestep; `now` is the mode clock, in milliseconds. */
  step(input: BackdropInput, now: number): void;
  /** Writes 0–1 intensities, row-major, into a field the host has cleared. */
  render(field: Float32Array): void;
  pace(): Pace;
};

/**
 * A backdrop toy. It only simulates and reports intensities: the host owns
 * input, scheduling, colour and the noise drawn under it.
 */
export type Mode = {
  id: string;
  label: string;
  /**
   * Whether the mode uses press-and-hold. The host then blocks text selection
   * for the hold, as a drag from the page margin would otherwise select text
   * and cut the hold short.
   */
  holds?: boolean;
  /**
   * The canvas ghost and the background noise's intensity that suit the mode,
   * both 0–100, as tuned in the prototype gallery. Without one the mode shows
   * the host's `ghost` and `noise`.
   */
  look?: Look;
  create(setup: ModeSetup): ModeInstance;
};
