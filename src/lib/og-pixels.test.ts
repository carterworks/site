import { describe, expect, test } from "vitest";
import {
  cardLandscape,
  HORIZON,
  litText,
  OG_HEIGHT,
  OG_WIDTH,
  paint,
  PEAKS,
  seedOf,
  type Grid,
} from "./og-pixels";

const litCount = ({ cells }: Grid) => cells.filter((value) => value > 0).length;

const pixelAt = (data: Uint8Array, x: number, y: number) => {
  const i = (y * OG_WIDTH + x) * 4;
  return [...data.slice(i, i + 4)];
};

test("seedOf is stable for an id and differs between ids", () => {
  expect(seedOf("rules-for-naming-things")).toBe(
    seedOf("rules-for-naming-things"),
  );
  expect(seedOf("index")).not.toBe(seedOf("blog"));
});

describe("cardLandscape", () => {
  test("draws the same scene for the same seed", () => {
    expect(cardLandscape(1, HORIZON).cells).toEqual(
      cardLandscape(1, HORIZON).cells,
    );
    expect(cardLandscape(1, HORIZON).cells).not.toEqual(
      cardLandscape(2, HORIZON).cells,
    );
  });

  test("leaves the sky empty and fills the ground", () => {
    const { cells, columns, rows } = cardLandscape(1, HORIZON);
    expect(cells.slice(0, columns).every((value) => value === 0)).toBe(true);
    expect(cells.slice((rows - 1) * columns).every((value) => value > 0)).toBe(
      true,
    );
  });

  test("raises peaks above the horizon", () => {
    expect(litCount(cardLandscape(1, PEAKS))).toBeGreaterThan(
      litCount(cardLandscape(1, HORIZON)),
    );
  });

  test("fills the card with whole cells", () => {
    const { columns, rows } = cardLandscape(1, HORIZON);
    expect(OG_WIDTH % columns).toBe(0);
    expect(rows).toBe(OG_HEIGHT / (OG_WIDTH / columns));
  });
});

describe("litText", () => {
  test("lights the cells the mask covers", () => {
    const mask = new Uint8Array(OG_WIDTH * OG_HEIGHT * 4);
    for (let y = 0; y < 20; y += 1) {
      mask.fill(255, y * OG_WIDTH * 4, (y * OG_WIDTH + 20) * 4);
    }

    const { cells, columns } = litText(mask, 1, 120);

    expect([cells[0], cells[1], cells[columns], cells[columns + 1]]).toEqual([
      1, 1, 1, 1,
    ]);
    expect(cells[2]).toBeLessThan(1);
  });
});

describe("paint", () => {
  const grid = (cells: number[]): Grid => {
    const columns = 80;
    const rows = 42;
    const all = new Float32Array(columns * rows);
    all.set(cells);
    return { cells: all, columns, rows };
  };
  const look = { ink: "#8a8a99", gap: 2, levels: 2 };

  test("paints a lit cell in ink, leaving its gap and unlit cells clear", () => {
    const { data, width, height } = paint(grid([1, 0]), look);

    expect([width, height]).toEqual([OG_WIDTH, OG_HEIGHT]);
    expect(pixelAt(data, 0, 0)).toEqual([138, 138, 153, 255]);
    expect(pixelAt(data, 14, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(data, 15, 0)).toEqual([0, 0, 0, 0]);
  });

  test("snaps each cell to the look's levels", () => {
    const { data } = paint(grid([0.3, 0.6]), look);

    expect(pixelAt(data, 0, 0)[3]).toBe(0);
    expect(pixelAt(data, 15, 0)[3]).toBe(255);
  });

  test("paints the gaps in the look's grid colour", () => {
    const { data } = paint(grid([]), { ...look, grid: "#0000000a" });

    expect(pixelAt(data, 14, 0)).toEqual([0, 0, 0, 10]);
    expect(pixelAt(data, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});
