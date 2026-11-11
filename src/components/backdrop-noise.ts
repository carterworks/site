/**
 * A small 2D simplex noise, after Stefan Gustavson's public-domain reference.
 * Simplex is preferred over Perlin here: it has no axis-aligned directional
 * artifacts, so the field reads as organic rather than gridded.
 */
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
/** Twelve gradients, flattened to two components each. */
const GRADIENTS = [
  1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0,
  -1,
];

/** A tiny deterministic PRNG, so the noise field is stable across reloads. */
export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a seeded 2D simplex field, returning values in [-1, 1]. */
export function makeNoise2D(seed: number): (x: number, y: number) => number {
  const random = mulberry32(seed);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) source[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = source[i];
    source[i] = source[j];
    source[j] = swap;
  }
  const permutation = new Uint8Array(512);
  const mod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) {
    permutation[i] = source[i & 255];
    mod12[i] = permutation[i] % 12;
  }

  return (x, y) => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = mod12[ii + permutation[jj]] * 2;
      t0 *= t0;
      n0 = t0 * t0 * (GRADIENTS[g] * x0 + GRADIENTS[g + 1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = mod12[ii + i1 + permutation[jj + j1]] * 2;
      t1 *= t1;
      n1 = t1 * t1 * (GRADIENTS[g] * x1 + GRADIENTS[g + 1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = mod12[ii + 1 + permutation[jj + 1]] * 2;
      t2 *= t2;
      n2 = t2 * t2 * (GRADIENTS[g] * x2 + GRADIENTS[g + 1] * y2);
    }

    return 70 * (n0 + n1 + n2);
  };
}

/**
 * A noise layer over a `columns` × `rows` field that samples `noise` only every
 * `step` cells along each axis and fills between bilinearly. Smooth noise
 * barely bends over a few cells, so this costs about 1/step² of sampling every
 * cell for a near-identical layer. Each call raises every cell to `amount`
 * times the noise mapped to 0–1, where that is brighter; cell (x, y) samples
 * the noise at `(x * frequency + offsetX, y * frequency + offsetY)`.
 */
export function makeCoarseNoise(
  noise: (x: number, y: number) => number,
  columns: number,
  rows: number,
) {
  let lattice = new Float32Array(0);
  let line = new Float32Array(0);
  return (
    field: Float32Array,
    step: number,
    frequency: number,
    offsetX: number,
    offsetY: number,
    amount: number,
  ) => {
    const width = Math.ceil((columns - 1) / step) + 1;
    const height = Math.ceil((rows - 1) / step) + 1;
    if (lattice.length < width * height) {
      lattice = new Float32Array(width * height);
      line = new Float32Array(width);
    }
    const half = amount * 0.5;
    const spacing = step * frequency;
    for (let ly = 0, k = 0; ly < height; ly += 1) {
      const y = ly * spacing + offsetY;
      for (let lx = 0; lx < width; lx += 1, k += 1) {
        lattice[k] = half + half * noise(lx * spacing + offsetX, y);
      }
    }

    // The last row and column land on a sample exactly, so they reuse it
    // rather than read past the lattice.
    for (let y = 0, i = 0; y < rows; y += 1) {
      const ly = Math.floor(y / step);
      const fy = y / step - ly;
      const above = ly * width;
      const below = ly + 1 < height ? above + width : above;
      for (let lx = 0; lx < width; lx += 1) {
        const top = lattice[above + lx];
        line[lx] = top + (lattice[below + lx] - top) * fy;
      }
      for (let lx = 0, x = 0; x < columns; lx += 1) {
        const left = line[lx];
        const slope = ((lx + 1 < width ? line[lx + 1] : left) - left) / step;
        const end = Math.min(columns, x + step);
        for (let value = left; x < end; x += 1, i += 1, value += slope) {
          if (value > field[i]) field[i] = value;
        }
      }
    }
  };
}
