import { makeNoise2D } from "./backdrop-noise";

export type Grid = { columns: number; rows: number; cells: Float32Array };

/** Rows of ground from the bottom edge, and how far the skyline wanders from it. */
export type Terrain = { level: number; relief: number };

export const HORIZON: Terrain = { level: 12, relief: 5 };
export const PEAKS: Terrain = { level: 19, relief: 9 };

/** The backdrop's mottle: broad blotches with a finer grain over them. */
export function texture(seed: number) {
  const noise = makeNoise2D(seed);
  return (x: number, y: number) =>
    (noise(x / 15, y / 15) + 0.5 * noise(x / 6 + 99, y / 6)) / 1.5;
}

/**
 * A seeded skyline over mottled ground that darkens with depth, in 0–1 cell
 * values. Its sizes were tuned in cells of an 80-column grid; `scale` is how
 * many cells of this grid span one of those.
 */
export function landscape(
  seed: number,
  { level, relief }: Terrain,
  columns: number,
  rows: number,
  scale: number,
): Grid {
  const cells = new Float32Array(columns * rows);
  const ridge = makeNoise2D(seed ^ 7);
  const mottle = texture(seed);
  for (let x = 0; x < columns; x += 1) {
    const top =
      rows -
      level * scale -
      relief *
        scale *
        (ridge(x / (18 * scale), 0.5) + 0.3 * ridge(x / (5 * scale), 9));
    for (let y = Math.max(0, Math.ceil(top)); y < rows; y += 1) {
      const value =
        0.35 +
        mottle(x / scale, y / scale) * 0.5 +
        Math.min(0.3, (y - top) / (30 * scale));
      cells[y * columns + x] = Math.min(1, Math.max(0.15, value));
    }
  }
  return { columns, rows, cells };
}
