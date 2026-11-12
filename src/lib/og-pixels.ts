import { makeNoise2D } from "../components/backdrop-noise";

/**
 * Still pixel scenes for the Open Graph cards, drawn in the backdrop's grid
 * from its own noise. A scene is a grid of 0–1 cell values; `paint` turns it
 * into card-sized RGBA that takumi draws without decoding, so a card costs no
 * image encode.
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** The backdrop's tuned width, so a card shows as many cells as the screen does. */
const COLUMNS = 80;

export type Grid = { columns: number; rows: number; cells: Float32Array };

/** Rows of ground from the bottom edge, and how far the skyline wanders from it. */
export type Terrain = { level: number; relief: number };

export const HORIZON: Terrain = { level: 12, relief: 5 };
export const PEAKS: Terrain = { level: 19, relief: 9 };

export type Look = {
  ink: string;
  /** Space between cells, in card pixels. */
  gap: number;
  /** Distinct shades a cell snaps to, counting unlit. */
  levels: number;
  /** Paints the gaps, as a display's grid does. */
  grid?: string;
};

/** FNV-1a, so each page's scene is its own and stays put between builds. */
export function seedOf(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function emptyGrid(columns: number): Grid {
  const rows = OG_HEIGHT / (OG_WIDTH / columns);
  return { columns, rows, cells: new Float32Array(columns * rows) };
}

/** The backdrop's mottle: broad blotches with a finer grain over them. */
function texture(seed: number) {
  const noise = makeNoise2D(seed);
  return (x: number, y: number) =>
    (noise(x / 15, y / 15) + 0.5 * noise(x / 6 + 99, y / 6)) / 1.5;
}

/** A seeded skyline over mottled ground that darkens with depth. */
export function landscape(seed: number, { level, relief }: Terrain): Grid {
  const grid = emptyGrid(COLUMNS);
  const { columns, rows, cells } = grid;
  const ridge = makeNoise2D(seed ^ 7);
  const mottle = texture(seed);
  for (let x = 0; x < columns; x += 1) {
    const top =
      rows - level - relief * (ridge(x / 18, 0.5) + 0.3 * ridge(x / 5, 9));
    for (let y = Math.max(0, Math.ceil(top)); y < rows; y += 1) {
      const value = 0.35 + mottle(x, y) * 0.5 + Math.min(0.3, (y - top) / 30);
      cells[y * columns + x] = Math.min(1, Math.max(0.15, value));
    }
  }
  return grid;
}

/**
 * Lights the cells a card-sized RGBA `mask` mostly covers, over faint specks
 * of noise, so text rendered into the mask reads as lit pixels.
 */
export function litText(mask: Uint8Array, seed: number, columns: number): Grid {
  const grid = emptyGrid(columns);
  const { rows, cells } = grid;
  const cell = OG_WIDTH / columns;
  const mottle = texture(seed);
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < columns; cx += 1) {
      let coverage = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y += 1) {
        for (let x = cx * cell; x < (cx + 1) * cell; x += 1) {
          coverage += mask[(y * OG_WIDTH + x) * 4];
        }
      }
      cells[cy * columns + cx] =
        coverage > 0.4 * 255 * cell * cell
          ? 1
          : Math.max(0, mottle(cx, cy) * 0.25);
    }
  }
  return grid;
}

/** `#rrggbb` or `#rrggbbaa`, as the displays write them. */
function rgba(hex: string): [number, number, number, number] {
  const channel = (at: number) =>
    Number.parseInt(hex.slice(at, at + 2) || "ff", 16);
  return [channel(1), channel(3), channel(5), channel(7)];
}

/** Each cell in ink at its value's opacity, so the card's background is the unlit screen. */
export function paint(
  { columns, cells }: Grid,
  { ink, gap, levels, grid }: Look,
): { width: number; height: number; data: Uint8Array } {
  const [r, g, b] = rgba(ink);
  const gapColour = grid ? rgba(grid) : [0, 0, 0, 0];
  const cell = OG_WIDTH / columns;
  const steps = levels - 1;
  const data = new Uint8Array(OG_WIDTH * OG_HEIGHT * 4);
  for (let y = 0, i = 0; y < OG_HEIGHT; y += 1) {
    const row = Math.floor(y / cell) * columns;
    const inGapRow = y % cell >= cell - gap;
    for (let x = 0; x < OG_WIDTH; x += 1, i += 4) {
      if (inGapRow || x % cell >= cell - gap) {
        data.set(gapColour, i);
        continue;
      }
      const alpha = Math.round(cells[row + Math.floor(x / cell)] * steps);
      if (alpha === 0) continue;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round((alpha / steps) * 255);
    }
  }
  return { width: OG_WIDTH, height: OG_HEIGHT, data };
}
