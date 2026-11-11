import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import { culture } from "./culture";
import type { BackdropInput } from "./mode";

const columns = 80;
const rows = 80;
const STEP = 1000 / 60;
const NO_JITTER = () => 0.99;

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

  frames(6);
  expect([39, 41].map((x) => alive(x, 40))).toEqual([false, false]);
  expect([39, 40, 41].map((y) => alive(40, y))).toEqual([true, true, true]);

  frames(6);
  expect([39, 40, 41].map((x) => alive(x, 40))).toEqual([true, true, true]);
});

test("generations crawl while a press is held", () => {
  const held = setup();
  held.drawAcross(40, 39, 41);
  held.frames(6);
  expect(held.alive(39, 40)).toBe(true);

  const released = setup();
  released.drawAcross(40, 39, 41);
  released.input.press!.held = false;
  released.frames(6);
  expect(released.alive(39, 40)).toBe(false);
});

test("drawing seeds only cells inside the dish", () => {
  const { alive, drawAcross, population } = setup();
  drawAcross(1, 0, 79);
  expect(population()).toBe(0);

  drawAcross(40, 0, 79);
  expect(alive(40, 40)).toBe(true);
  expect(alive(0, 40)).toBe(false);
  expect(alive(79, 40)).toBe(false);
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
  input.visible = { left: 0, top: 17.5, right: 80, bottom: 62.5 };
  frames(2);
  const rim = [...field].filter((value) => value === Math.fround(0.4)).length;
  expect(rim).toBeGreaterThan(0);
  expect(field[5 * columns + 40]).toBe(0);
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
