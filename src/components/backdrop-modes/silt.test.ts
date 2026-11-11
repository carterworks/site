import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import type { BackdropInput } from "./mode";
import { silt } from "./silt";

const COLUMNS = 80;
const ROWS = 80;
const STEP = 1000 / 60;
const VISIBLE = { left: 0, top: 17.5, right: 80, bottom: 62.5 };
const TOP_ROW = 18;
const BOTTOM_ROW = 61;
const CAPACITY = COLUMNS * (BOTTOM_ROW - TOP_ROW + 1);

function setup() {
  const mode = silt.create({
    columns: COLUMNS,
    rows: ROWS,
    random: mulberry32(1),
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
    press(40, 30);
    for (let i = 0; i < 1800; i += 1) {
      input.pointer = { x: 1 + ((i * 3) % 78), y: 25 };
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
    rowCells,
    meanRow,
    fillTray,
    pace: mode.pace,
    now: () => now,
  };
}

test("a held press pours grains that pile on the bottom of the visible rect", () => {
  const sim = setup();
  sim.press(40, 30);
  sim.run(30);
  sim.release();
  sim.run(60);

  expect(sim.cells()).toBeGreaterThan(30);
  expect(sim.rowCells(BOTTOM_ROW)).toBeGreaterThan(0);
  expect(sim.rowCells(BOTTOM_ROW + 1)).toBe(0);
});

test("a released press stops pouring", () => {
  const sim = setup();
  sim.press(40, 30);
  sim.run(30);
  sim.release();
  sim.run(1);
  const poured = sim.cells();
  sim.run(60);

  expect(sim.cells()).toBeLessThanOrEqual(poured);
});

test("dragging while held lays grains along the path", () => {
  const sim = setup();
  sim.press(10, 30);
  sim.input.pointer = { x: 10, y: 30 };
  sim.run(1);
  sim.input.pointer = { x: 70, y: 30 };
  sim.run(1);
  sim.release();
  sim.run(80);

  expect(sim.rowCells(BOTTOM_ROW)).toBeGreaterThan(30);
});

test("a double-tap turns the tray over so grains fall to the top", () => {
  const sim = setup();
  sim.press(40, 30);
  sim.run(40);
  sim.release();
  sim.run(60);
  const before = sim.meanRow();

  sim.press(40, 30);
  sim.release();
  sim.run(10);
  sim.press(41, 30);
  sim.release();
  sim.run(30);

  expect(sim.meanRow()).toBeLessThan(before);
});

test("two taps too far apart do not flip", () => {
  const sim = setup();
  sim.press(40, 30);
  sim.run(40);
  sim.release();
  sim.run(60);
  const before = sim.meanRow();

  sim.press(40, 30);
  sim.release();
  sim.run(60);
  sim.press(41, 30);
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

  sim.press(40, 30);
  sim.release();
  sim.run(10);
  sim.press(40, 30);
  sim.release();
  sim.run(Math.ceil(8_000 / STEP));
  expect(sim.cells()).toBeLessThan(CAPACITY * 0.02);
});

test("a tray tipped out turns right way up again", () => {
  const sim = setup();
  sim.press(40, 30);
  sim.run(40);
  sim.release();
  sim.press(40, 30);
  sim.release();
  sim.run(10);
  sim.press(40, 30);
  sim.release();
  sim.run(Math.ceil(30_000 / STEP));
  expect(sim.cells()).toBe(0);

  sim.press(40, 30);
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

  sim.input.visible = { left: 0, top: 17.5, right: 80, bottom: 47.5 };
  sim.run(1);

  expect(sim.rowCells(47 - 1)).toBeGreaterThan(0);
  expect(sim.rowCells(BOTTOM_ROW)).toBe(0);
});

test("the first interaction ends the dune's protection and everything drains", () => {
  const sim = setup();
  sim.run(1);
  expect(sim.cells()).toBeGreaterThan(0);

  sim.press(40, 30);
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
  ["vertical", { left: 0, top: 17.5, right: 80, bottom: 47.5 }],
  ["horizontal", { left: 0, top: 17.5, right: 50, bottom: 62.5 }],
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
