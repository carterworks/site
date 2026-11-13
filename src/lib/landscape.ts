import { makeNoise2D, mulberry32 } from "./backdrop-noise";

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

type Noise = ReturnType<typeof makeNoise2D>;

/** Fractal noise folded at its zeros, so it creases into ridges and gullies. */
function ridged(noise: Noise, x: number, y: number, octaves: number) {
  let sum = 0;
  let total = 0;
  for (
    let octave = 0, weight = 1, frequency = 1;
    octave < octaves;
    octave += 1
  ) {
    sum +=
      weight *
      (1 - Math.abs(noise(x * frequency + octave * 31, y * frequency)));
    total += weight;
    weight /= 2;
    frequency *= 2.1;
  }
  return sum / total;
}

/**
 * A jagged range lit from the upper left, in 0.3–1 cell values that grow with
 * shadow, after the browserbase.com hero. Each cell is jittered, so a palette
 * of few levels stipples between them as the hero's does. Sized like
 * `landscape`.
 */
export function crags(
  seed: number,
  columns: number,
  rows: number,
  scale: number,
): Grid {
  const cells = new Float32Array(columns * rows);
  const noise = makeNoise2D(seed);
  const jitter = mulberry32(seed);
  const rock = (x: number, y: number) =>
    ridged(noise, x / (25 * scale), y / (25 * scale), 5) +
    2 * ridged(noise, x / (70 * scale) + 50, y / (70 * scale), 2);
  for (let x = 0; x < columns; x += 1) {
    const top =
      rows -
      18 * scale -
      22 * scale * ridged(noise, x / (45 * scale), 0.5, 4) ** 2;
    for (let y = Math.max(0, Math.ceil(top)); y < rows; y += 1) {
      const across = rock(x + 1, y) - rock(x - 1, y);
      const down = rock(x, y + 1) - rock(x, y - 1);
      const lit = Math.tanh(3 * scale * (0.8 * across - 0.6 * down));
      const shade = 0.74 - 0.4 * lit + (jitter() - 0.5) * 0.36;
      cells[y * columns + x] = Math.min(1, Math.max(0.3, shade));
    }
  }
  return { columns, rows, cells };
}
