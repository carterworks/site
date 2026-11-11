import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import { type BackdropInput, type CellRect, GRID_SIZE } from "./mode";
import { mote } from "./mote";

/** The grid the sprite is drawn for; finer grids draw each sprite pixel as a block. */
const DESIGN_SIZE = 80;
const STEP = 1000 / 60;
/** Lit cells of the standing sprite once its two eyes are cut out. */
const STAND_PIXELS = 38;

const scale = GRID_SIZE / DESIGN_SIZE;
const VISIBLE: CellRect = {
  left: 0,
  top: 17.5 * scale,
  right: GRID_SIZE,
  bottom: 62.5 * scale,
};
/** `floor(visible.bottom)` minus the three-cell inset, in sprite pixels. */
const GROUND = 59 * scale;
const SLEEPING_TOP = GROUND - 4 * scale;
const STANDING_TOP = GROUND - 7 * scale;

function setup(visible = VISIBLE, size = GRID_SIZE) {
  const columns = size;
  const rows = size;
  const blockArea = (size / DESIGN_SIZE) ** 2;
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
  const crumbs = () =>
    cells((value) => Math.abs(value - 0.85) < 1e-3).length / blockArea;
  const hearts = () =>
    cells((value, y) => value <= 0.65 && y < bodyTop() - 1).length;
  const wake = () => {
    tap(bodyX(), GROUND - 2 * scale);
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
    bodyCells: () => body().length,
    crumbs,
    hearts,
  };
}

test("it starts curled up asleep on the visible bottom edge", () => {
  const toy = setup();
  toy.run(1);
  expect(toy.bodyTop()).toBe(SLEEPING_TOP);
});

test("each sprite pixel is drawn as a block as wide as the grid is fine", () => {
  const coarse = setup(
    { left: 0, top: 17.5, right: DESIGN_SIZE, bottom: 62.5 },
    DESIGN_SIZE,
  );
  const fine = setup();
  coarse.run(1);
  fine.run(1);
  coarse.wake();
  fine.wake();
  expect(coarse.bodyCells()).toBe(STAND_PIXELS);
  expect(fine.bodyCells()).toBe(STAND_PIXELS * scale ** 2);
});

test("a tap on the sleeping critter wakes it", () => {
  const toy = setup();
  toy.run(1);
  toy.tap(toy.bodyX(), GROUND - 2 * scale);
  toy.run(150);
  expect(toy.bodyTop()).toBe(STANDING_TOP);
});

test("a tap in empty space wakes it as well as tossing a crumb", () => {
  const toy = setup();
  toy.run(1);
  toy.tap(10 * scale, 30 * scale);
  toy.run(10);
  expect(toy.crumbs()).toBe(1);
  toy.run(200);
  expect(toy.bodyTop()).toBeLessThanOrEqual(STANDING_TOP);
});

test("it walks toward the pointer", () => {
  const toy = setup();
  toy.run(1);
  toy.wake();
  toy.input.pointer = { x: 15 * scale, y: 40 * scale };
  toy.input.lastInputAt = toy.now();
  toy.run(400);
  expect(Math.abs(toy.bodyX() - 15 * scale)).toBeLessThan(2 * scale);
});

test("rubbing back and forth over it makes it happy", () => {
  const toy = setup();
  toy.run(1);
  toy.wake();
  expect(toy.hearts()).toBe(0);

  const x = toy.bodyX();
  for (let i = 0; i < 6; i += 1) {
    toy.input.pointer = {
      x: x + (i % 2 ? 2 : -2) * scale,
      y: GROUND - 3 * scale,
    };
    toy.run(8);
  }
  toy.run(40);
  expect(toy.hearts()).toBeGreaterThan(0);
});

test("a crumb in reach is walked to and eaten", () => {
  const toy = setup();
  toy.run(1);
  toy.tap(20 * scale, 30 * scale);
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
    toy.tap(x, 30 * scale);
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
  toy.input.visible = {
    left: 20 * scale,
    top: 0,
    right: 60 * scale,
    bottom: 50 * scale,
  };
  toy.run(5);
  expect(toy.bodyTop()).toBe((47 - 7) * scale);
  expect(toy.bodyX()).toBeGreaterThanOrEqual(20 * scale);
  expect(toy.bodyX()).toBeLessThanOrEqual(60 * scale);
});

function highestWhile(toy: ReturnType<typeof setup>, steps: number) {
  let highest = Infinity;
  for (let i = 0; i < steps; i += 1) {
    toy.run(1);
    highest = Math.min(highest, toy.bodyTop());
  }
  return highest;
}

test("rapid treats and taps never stack hops into flight", () => {
  const solo = setup();
  solo.run(1);
  solo.tap(solo.bodyX(), GROUND - 2 * scale);
  const singleHop = highestWhile(solo, 150);
  expect(singleHop).toBeLessThan(STANDING_TOP);

  const toy = setup();
  toy.run(1);
  toy.wake();
  let highest = Infinity;
  for (let i = 0; i < 40; i += 1) {
    const x = toy.bodyX();
    toy.tap(i % 2 ? x : x + 3 * scale, i % 3 ? GROUND - 3 * scale : 30 * scale);
    highest = Math.min(highest, highestWhile(toy, 4));
  }
  expect(highest).toBeGreaterThanOrEqual(singleHop);

  toy.run(60 * 4);
  expect(toy.bodyTop()).toBeGreaterThanOrEqual(STANDING_TOP);
});
