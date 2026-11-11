import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import type { BackdropInput, CellRect } from "./mode";
import { mote } from "./mote";

const columns = 80;
const rows = 80;
const STEP = 1000 / 60;
const VISIBLE: CellRect = { left: 0, top: 17.5, right: 80, bottom: 62.5 };
/** `floor(visible.bottom)` minus the three-cell inset the mode keeps. */
const GROUND = 59;
const SLEEPING_TOP = GROUND - 4;
const STANDING_TOP = GROUND - 7;

function setup(visible = VISIBLE) {
  const instance = mote.create({
    columns,
    rows,
    random: mulberry32(1),
    options: {} as never,
  });
  const input: BackdropInput = { lastInputAt: 0, visible };
  const field = new Float32Array(columns * rows);
  let now = 0;
  const run = (steps: number) => {
    for (let i = 0; i < steps; i += 1) {
      now += STEP;
      instance.step(input, now);
    }
    field.fill(0);
    instance.render(field);
    return instance.pace();
  };
  const tap = (x: number, y: number) => {
    input.press = { x, y, at: now, held: false };
    input.lastInputAt = now;
  };
  const cells = (keep: (value: number, y: number) => boolean) => {
    const found: { x: number; y: number }[] = [];
    field.forEach((value, i) => {
      if (value > 0 && keep(value, Math.floor(i / columns))) {
        found.push({ x: i % columns, y: Math.floor(i / columns) });
      }
    });
    return found;
  };
  /** The body is the only thing drawn at full intensity. */
  const body = () => cells((value) => value === 1);
  const bodyTop = () => Math.min(...body().map(({ y }) => y));
  const bodyX = () => {
    const xs = body().map(({ x }) => x + 0.5);
    return xs.reduce((sum, x) => sum + x) / xs.length;
  };
  const crumbs = () => cells((value) => Math.abs(value - 0.85) < 1e-3).length;
  const hearts = () =>
    cells((value, y) => value <= 0.65 && y < bodyTop() - 1).length;
  const wake = () => {
    tap(bodyX(), GROUND - 2);
    run(150);
  };
  return {
    input,
    run,
    tap,
    wake,
    now: () => now,
    bodyTop,
    bodyX,
    crumbs,
    hearts,
  };
}

test("it starts curled up asleep on the visible bottom edge", () => {
  const toy = setup();
  toy.run(1);
  expect(toy.bodyTop()).toBe(SLEEPING_TOP);
});

test("a tap on the sleeping critter wakes it", () => {
  const toy = setup();
  toy.run(1);
  toy.tap(toy.bodyX(), GROUND - 2);
  toy.run(150);
  expect(toy.bodyTop()).toBe(STANDING_TOP);
});

test("a tap in empty space wakes it as well as tossing a crumb", () => {
  const toy = setup();
  toy.run(1);
  toy.tap(10, 30);
  toy.run(10);
  expect(toy.crumbs()).toBe(1);
  toy.run(200);
  expect(toy.bodyTop()).toBeLessThanOrEqual(STANDING_TOP);
});

test("it walks toward the pointer", () => {
  const toy = setup();
  toy.run(1);
  toy.wake();
  toy.input.pointer = { x: 15, y: 40 };
  toy.input.lastInputAt = toy.now();
  toy.run(400);
  expect(Math.abs(toy.bodyX() - 15)).toBeLessThan(2);
});

test("rubbing back and forth over it makes it happy", () => {
  const toy = setup();
  toy.run(1);
  toy.wake();
  expect(toy.hearts()).toBe(0);

  const x = toy.bodyX();
  for (let i = 0; i < 6; i += 1) {
    toy.input.pointer = { x: x + (i % 2 ? 2 : -2), y: GROUND - 3 };
    toy.run(8);
  }
  toy.run(40);
  expect(toy.hearts()).toBeGreaterThan(0);
});

test("a crumb in reach is walked to and eaten", () => {
  const toy = setup();
  toy.run(1);
  toy.tap(20, 30);
  toy.run(30);
  expect(toy.crumbs()).toBe(1);
  toy.run(60 * 8);
  expect(toy.crumbs()).toBe(0);
});

test.each([
  ["left", VISIBLE.left + 0.5],
  ["right", VISIBLE.right - 0.5],
])(
  "a crumb dropped at the %s edge is eaten and the critter naps again",
  (_edge, x) => {
    const toy = setup();
    toy.run(1);
    toy.tap(x, 30);
    toy.run(60 * 12);
    expect(toy.crumbs()).toBe(0);

    toy.run(60 * 30);
    expect(toy.bodyTop()).toBe(SLEEPING_TOP);
    expect(toy.run(60 * 30)).toBe("still");
  },
);

test("it naps again after being alone a while", () => {
  const toy = setup();
  toy.run(1);
  toy.wake();
  expect(toy.bodyTop()).toBe(STANDING_TOP);
  toy.run(60 * 12);
  expect(toy.bodyTop()).toBe(SLEEPING_TOP);
});

test("asleep it breathes for a while, then stops asking for frames", () => {
  const toy = setup();
  expect(toy.run(60)).toBe("idle");
  expect(toy.run(60 * 20)).toBe("still");
});

test("it follows the visible bottom edge when the visible rect changes", () => {
  const toy = setup();
  toy.run(1);
  toy.wake();
  toy.input.visible = { left: 20, top: 0, right: 60, bottom: 50 };
  toy.run(5);
  expect(toy.bodyTop()).toBe(47 - 7);
  expect(toy.bodyX()).toBeGreaterThanOrEqual(20);
  expect(toy.bodyX()).toBeLessThanOrEqual(60);
});
