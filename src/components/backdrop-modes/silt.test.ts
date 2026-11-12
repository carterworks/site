import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import { type BackdropInput, GRID_SIZE } from "./mode";
import { silt } from "./silt";

const COLUMNS = GRID_SIZE;
const ROWS = GRID_SIZE;
const STEP = 1000 / 60;
const VISIBLE = {
  left: 0,
  top: ROWS * 0.21875,
  right: COLUMNS,
  bottom: ROWS * 0.78125,
};
const TOP_ROW = Math.ceil(VISIBLE.top);
const BOTTOM_ROW = Math.floor(VISIBLE.bottom) - 1;
const MID = COLUMNS / 2;
const POUR_Y = ROWS * 0.375;
const CAPACITY = COLUMNS * (BOTTOM_ROW - TOP_ROW + 1);

function setup() {
  const seeded = mulberry32(1);
  let draws = 0;
  const mode = silt.create({
    columns: COLUMNS,
    rows: ROWS,
    random: () => {
      draws += 1;
      return seeded();
    },
    options: {} as never,
  });
  const input: BackdropInput = { lastInputAt: -Infinity, visible: VISIBLE };
  const field = new Float32Array(COLUMNS * ROWS);
  let now = 0;
  const run = (steps: number) => {
    for (let i = 0; i < steps; i += 1) {
      now += STEP;
      mode.step(input, now);
    }
    field.fill(0);
    mode.render(field);
  };
  const press = (x: number, y: number) => {
    input.press = { x, y, at: now, held: true };
    input.lastInputAt = now;
  };
  const release = () => {
    input.press!.held = false;
  };
  const cells = () => field.reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0);
  const rowCells = (y: number) =>
    field.slice(y * COLUMNS, (y + 1) * COLUMNS).filter((v) => v > 0).length;
  const meanRow = () => {
    let sum = 0;
    field.forEach((v, i) => {
      if (v > 0) sum += Math.floor(i / COLUMNS);
    });
    return sum / cells();
  };
  const fillTray = () => {
    press(MID, POUR_Y);
    for (let i = 0; i < 1800; i += 1) {
      input.pointer = { x: 1 + ((i * 3) % (COLUMNS - 2)), y: ROWS * 0.3125 };
      run(1);
    }
    release();
    input.pointer = undefined;
    run(1);
  };
  return {
    input,
    run,
    press,
    release,
    cells,
    cellAt: (x: number, y: number) => field[y * COLUMNS + x] > 0,
    rowCells,
    meanRow,
    fillTray,
    pace: mode.pace,
    draws: () => draws,
    now: () => now,
  };
}

test("a held press pours grains that pile on the bottom of the visible rect", () => {
  const sim = setup();
  sim.press(MID, POUR_Y);
  sim.run(30);
  sim.release();
  sim.run(60);

  expect(sim.cells()).toBeGreaterThan(30);
  expect(sim.rowCells(BOTTOM_ROW)).toBeGreaterThan(0);
  expect(sim.rowCells(BOTTOM_ROW + 1)).toBe(0);
});

test("a released press stops pouring", () => {
  const sim = setup();
  sim.press(MID, POUR_Y);
  sim.run(30);
  sim.release();
  sim.run(1);
  const poured = sim.cells();
  sim.run(60);

  expect(sim.cells()).toBeLessThanOrEqual(poured);
});

test("dragging while held lays grains along the path", () => {
  const sim = setup();
  sim.press(COLUMNS / 8, POUR_Y);
  sim.input.pointer = { x: COLUMNS / 8, y: POUR_Y };
  sim.run(1);
  sim.input.pointer = { x: COLUMNS * 0.875, y: POUR_Y };
  sim.run(1);
  sim.release();
  sim.run(80);

  expect(sim.rowCells(BOTTOM_ROW)).toBeGreaterThan(COLUMNS * 0.4);
});

test("a double-tap turns the tray over so grains fall to the top", () => {
  const sim = setup();
  sim.press(MID, POUR_Y);
  sim.run(40);
  sim.release();
  sim.run(60);
  const before = sim.meanRow();

  sim.press(MID, POUR_Y);
  sim.release();
  sim.run(10);
  sim.press(MID + 1, POUR_Y);
  sim.release();
  sim.run(30);

  expect(sim.meanRow()).toBeLessThan(before);
});

test("two taps too far apart do not flip", () => {
  const sim = setup();
  sim.press(MID, POUR_Y);
  sim.run(40);
  sim.release();
  sim.run(60);
  const before = sim.meanRow();

  sim.press(MID, POUR_Y);
  sim.release();
  sim.run(60);
  sim.press(MID + 1, POUR_Y);
  sim.release();
  sim.run(30);

  expect(sim.meanRow()).toBeGreaterThanOrEqual(before - 1);
});

test("a full tray drains to empty on its own within 30 s", () => {
  const sim = setup();
  sim.fillTray();
  expect(sim.cells()).toBeGreaterThan(CAPACITY * 0.8);

  sim.run(Math.ceil(30_000 / STEP));

  expect(sim.cells()).toBe(0);
  expect(sim.pace()).toBe("still");
});

test("a double-tap tips a full tray out within a few seconds", () => {
  const sim = setup();
  sim.fillTray();

  sim.press(MID, POUR_Y);
  sim.release();
  sim.run(10);
  sim.press(MID, POUR_Y);
  sim.release();
  sim.run(Math.ceil(8_000 / STEP));
  expect(sim.cells()).toBeLessThan(CAPACITY * 0.02);
});

test("a tray tipped out turns right way up again", () => {
  const sim = setup();
  sim.press(MID, POUR_Y);
  sim.run(40);
  sim.release();
  sim.press(MID, POUR_Y);
  sim.release();
  sim.run(10);
  sim.press(MID, POUR_Y);
  sim.release();
  sim.run(Math.ceil(30_000 / STEP));
  expect(sim.cells()).toBe(0);

  sim.press(MID, POUR_Y);
  sim.run(30);
  sim.release();
  sim.run(60);

  expect(sim.rowCells(BOTTOM_ROW)).toBeGreaterThan(0);
});

test("an untouched tab shows a settled dune on the tray floor and stays still", () => {
  const sim = setup();
  sim.run(1);

  expect(sim.rowCells(BOTTOM_ROW)).toBeGreaterThan(0);
  expect(sim.rowCells(TOP_ROW)).toBe(0);
  expect(sim.pace()).toBe("still");
});

test("the starting dune sits inside the visible rect and survives a minute untouched", () => {
  const sim = setup();
  sim.run(1);
  const before = sim.cells();
  const floor = sim.rowCells(BOTTOM_ROW);

  sim.run(60 * 60);

  expect(sim.cells()).toBe(before);
  expect(sim.rowCells(BOTTOM_ROW)).toBe(floor);
  expect(sim.pace()).toBe("still");
});

test("the starting dune is re-seeded in the new rect when the visible rect changes untouched", () => {
  const sim = setup();
  sim.run(1);

  sim.input.visible = {
    left: 0,
    top: VISIBLE.top,
    right: COLUMNS,
    bottom: ROWS * 0.59375,
  };
  sim.run(1);

  expect(sim.rowCells(Math.floor(ROWS * 0.59375) - 1)).toBeGreaterThan(0);
  expect(sim.rowCells(BOTTOM_ROW)).toBe(0);
});

test("the first interaction ends the dune's protection and everything drains", () => {
  const sim = setup();
  sim.run(1);
  expect(sim.cells()).toBeGreaterThan(0);

  sim.press(MID, POUR_Y);
  sim.release();
  sim.run(Math.ceil(30_000 / STEP));

  expect(sim.cells()).toBe(0);
  expect(sim.pace()).toBe("still");
});

test("input with no sand left waits idle for the trickle instead of running flat out", () => {
  const sim = setup();
  sim.input.lastInputAt = STEP;
  sim.run(1);

  expect(sim.pace()).toBe("idle");
});

test("a thin stream trickles in after a pause in input, then stops", () => {
  const sim = setup();
  sim.input.lastInputAt = 0;
  sim.run(Math.ceil(5_000 / STEP));
  expect(sim.cells()).toBeGreaterThan(0);

  sim.run(Math.ceil(30_000 / STEP));
  expect(sim.cells()).toBe(0);
  expect(sim.pace()).toBe("still");
});

test.each([
  [
    "vertical",
    { left: 0, top: VISIBLE.top, right: COLUMNS, bottom: ROWS * 0.59375 },
  ],
  ["horizontal", { ...VISIBLE, right: COLUMNS * 0.625 }],
])(
  "a full tray still drains to still after a %s shrink of the visible rect",
  (_, shrunk) => {
    const sim = setup();
    sim.fillTray();

    sim.input.visible = shrunk;
    sim.run(Math.ceil(30_000 / STEP));

    expect(sim.cells()).toBe(0);
    expect(sim.pace()).toBe("still");
  },
);

test("a heap at rest costs no sweep, and still drains once released", () => {
  const holdOutside = (sim: ReturnType<typeof setup>) => {
    sim.input.pointer = { x: MID, y: -10 };
    sim.run(Math.ceil(12_000 / STEP));
    const drawn = sim.draws();
    sim.run(60);
    return sim.draws() - drawn;
  };
  const heap = setup();
  heap.press(MID, POUR_Y);
  heap.run(60);
  const empty = setup();
  empty.press(MID, -10);

  const heapDraws = holdOutside(heap);

  expect(heap.cells()).toBeGreaterThan(0);
  expect(heapDraws).toBe(holdOutside(empty));

  heap.release();
  heap.run(Math.ceil(30_000 / STEP));
  expect(heap.cells()).toBe(0);
});

test("a scripted pour builds a wide heap with gentle flanks, not a spike", () => {
  const sim = setup();
  sim.press(MID, POUR_Y);
  sim.run(240);
  sim.release();
  sim.run(40);

  const heights = Array.from(
    { length: COLUMNS },
    (_, x) =>
      Array.from({ length: ROWS }, (_, y) => sim.cellAt(x, y)).filter(Boolean)
        .length,
  );
  const steps = heights
    .slice(1)
    .map((h, x) => Math.abs(h - heights[x]))
    .filter((_, x) => heights[x] + heights[x + 1] > 0);

  expect(heights.filter((h) => h > 0).length).toBeGreaterThan(COLUMNS * 0.45);
  expect(Math.max(...steps)).toBeLessThanOrEqual(8);
  expect(steps.reduce((a, b) => a + b, 0) / steps.length).toBeLessThan(1.2);
});

test("a full tray keeps every grain inside a visible rect that lost its top and bottom rows", () => {
  const sim = setup();
  sim.fillTray();

  const top = ROWS * 0.375;
  const bottom = ROWS * 0.625;
  sim.input.visible = { left: 0, top, right: COLUMNS, bottom };
  sim.run(Math.ceil(5_000 / STEP));

  for (let y = 0; y < ROWS; y += 1) {
    if (y < Math.ceil(top) || y >= Math.floor(bottom)) {
      expect(sim.rowCells(y)).toBe(0);
    }
  }
});
