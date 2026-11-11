import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import { culture } from "./culture";
import { GRID_SIZE, type BackdropInput } from "./mode";

const columns = GRID_SIZE;
const rows = GRID_SIZE;
const STEP = 1000 / 60;
const NO_JITTER = () => 0.99;
/** Steps between generations on the site's grid: the gallery's 6, stretched for smaller cells. */
const GENERATION = 9;

function setup(random: () => number = NO_JITTER) {
  const mode = culture.create({
    columns,
    rows,
    random,
    options: {} as never,
  });
  const input: BackdropInput = {
    lastInputAt: 0,
    visible: { left: 0, top: 0, right: columns, bottom: rows },
  };
  const field = new Float32Array(columns * rows);
  let now = 0;
  const frame = () => {
    now += STEP;
    mode.step(input, now);
    const pace = mode.pace();
    field.fill(0);
    mode.render(field);
    return pace;
  };
  const frames = (count: number) => {
    for (let i = 0; i < count; i += 1) frame();
  };
  const alive = (x: number, y: number) => field[y * columns + x] === 1;
  const population = () => field.filter((value) => value === 1).length;
  /** Presses off the dish, so only the path that follows seeds cells. */
  const drawAcross = (y: number, from: number, to: number) => {
    input.pointer = { x: from + 0.5, y: y + 0.5 };
    frame();
    input.press = { x: 0.5, y: 0.5, at: now, held: true };
    input.pointer = { x: to + 0.5, y: y + 0.5 };
    input.lastInputAt = now;
    frame();
  };
  return { input, field, frame, frames, alive, population, drawAcross };
}

test("a drawn blinker flips between a row and a column", () => {
  const { input, alive, frames, drawAcross } = setup();
  drawAcross(40, 39, 41);
  input.press!.held = false;
  expect([39, 40, 41].map((x) => alive(x, 40))).toEqual([true, true, true]);

  frames(GENERATION);
  expect([39, 41].map((x) => alive(x, 40))).toEqual([false, false]);
  expect([39, 40, 41].map((y) => alive(40, y))).toEqual([true, true, true]);

  frames(GENERATION);
  expect([39, 40, 41].map((x) => alive(x, 40))).toEqual([true, true, true]);
});

test("generations crawl while a press is held", () => {
  const held = setup();
  held.drawAcross(40, 39, 41);
  held.frames(GENERATION);
  expect(held.alive(39, 40)).toBe(true);

  const released = setup();
  released.drawAcross(40, 39, 41);
  released.input.press!.held = false;
  released.frames(GENERATION);
  expect(released.alive(39, 40)).toBe(false);
});

test("drawing seeds only cells inside the dish", () => {
  const { alive, drawAcross, population } = setup();
  drawAcross(1, 0, columns - 1);
  expect(population()).toBe(0);

  drawAcross(40, 0, columns - 1);
  expect(alive(40, 40)).toBe(true);
  expect(alive(0, 40)).toBe(false);
  expect(alive(columns - 1, 40)).toBe(false);
});

test("a tap seeds a small cluster", () => {
  const { input, frame, alive } = setup();
  input.press = { x: 40.5, y: 40.5, at: 0, held: false };
  frame();
  expect([alive(40, 40), alive(41, 40), alive(40, 41)]).toEqual([
    true,
    true,
    true,
  ]);
});

test("a spore lands once the colony has died and the visitor has been idle", () => {
  let value = NO_JITTER;
  const { frames, population } = setup(() => value());
  value = () => 0.1;
  frames(Math.floor(2000 / STEP));
  expect(population()).toBe(0);

  frames(Math.ceil(1500 / STEP));
  expect(population()).toBeGreaterThan(0);
});

test("an untouched tab freezes and stops asking for frames", () => {
  const { input, field, frame, frames } = setup(mulberry32(1));
  frames(Math.ceil(40_000 / STEP));
  expect(frame()).toBe("still");

  const frozen = field.slice();
  frames(120);
  expect(field).toEqual(frozen);

  input.lastInputAt = 40_000;
  expect(frame()).toBe("active");
});

test("the dish follows the visible rect", () => {
  const { input, frames, field } = setup();
  input.visible = { left: 0, top: 17.5, right: columns, bottom: rows - 17.5 };
  frames(2);
  const rim = [...field].filter((value) => value === Math.fround(0.4)).length;
  expect(rim).toBeGreaterThan(0);
  expect(field[5 * columns + 40]).toBe(0);
});

test("the rim is one solid ring of edge-connected cells", () => {
  const { frames, field } = setup();
  frames(2);
  const rim = new Set<number>();
  field.forEach((value, i) => {
    if (value === Math.fround(0.4)) rim.add(i);
  });
  const [start] = rim;
  const seen = new Set([start]);
  const queue = [start];
  for (const i of queue) {
    for (const j of [i - 1, i + 1, i - columns, i + columns]) {
      if (rim.has(j) && !seen.has(j)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  expect(seen.size).toBe(rim.size);
});

test("a held drag lays a stroke bolder than one cell", () => {
  const { drawAcross, field } = setup(mulberry32(3));
  drawAcross(80, 50, 110);
  let lit = 0;
  for (let x = 55; x < 105; x += 1) {
    for (let y = 70; y < 90; y += 1) {
      if (field[y * columns + x] === 1) lit += 1;
    }
  }
  expect(lit / 50).toBeGreaterThanOrEqual(1.4);
});

test("a dish created a minute into the clock with stale input is not frozen empty", () => {
  const mode = culture.create({
    columns,
    rows,
    random: mulberry32(1),
    options: {} as never,
  });
  const input: BackdropInput = {
    lastInputAt: 0,
    visible: { left: 0, top: 0, right: columns, bottom: rows },
  };
  const field = new Float32Array(columns * rows);
  let now = 60_000;
  for (let i = 0; i < 600; i += 1) {
    now += STEP;
    mode.step(input, now);
  }
  mode.render(field);
  expect(field.some((value) => value === 1)).toBe(true);
});

const GOLDEN = -32487818;

/**
 * Recorded from the full-grid passes on a grid size where the tunables equal
 * their original 80-cell values, so bounding the work must not change a frame.
 */
test("a scripted session renders exactly as the full-grid passes did", () => {
  const size = 240;
  const mode = culture.create({
    columns: size,
    rows: size,
    random: mulberry32(7),
    options: {} as never,
  });
  const input: BackdropInput = {
    lastInputAt: 0,
    visible: { left: 0, top: 0, right: size, bottom: size },
  };
  const field = new Float32Array(size * size);
  let now = 0;
  let hash = 0;
  const run = (count: number) => {
    for (let i = 0; i < count; i += 1) {
      now += STEP;
      mode.step(input, now);
      field.fill(0);
      mode.render(field);
      for (let j = 0; j < field.length; j += 7) {
        hash = (Math.imul(hash, 31) + Math.round(field[j] * 1000) + j) | 0;
      }
    }
  };
  const draw = (x: number, y: number, held: boolean) => {
    input.pointer = { x, y };
    input.press = { x, y, at: now, held };
    input.lastInputAt = now;
  };
  run(120);
  draw(100.5, 120.5, true);
  run(1);
  for (let i = 0; i < 40; i += 1) {
    draw(100.5 + i * 1.5, 120.5 + Math.sin(i / 4) * 12, true);
    run(2);
  }
  input.press!.held = false;
  run(900);
  input.visible = { left: 0, top: 40, right: size, bottom: 200 };
  run(600);
  draw(50.5, 60.5, false);
  run(1500);
  run(Math.ceil(30_000 / STEP));
  expect(hash).toBe(GOLDEN);
});
