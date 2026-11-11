import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import type { BackdropInput } from "./mode";
import { pond } from "./pond";

const size = 80;
const visible = { left: 10, top: 20, right: 70, bottom: 60 };
const STEP = 1000 / 60;

function setup() {
  const mode = pond.create({
    columns: size,
    rows: size,
    random: mulberry32(1),
    options: {} as never,
  });
  const input: BackdropInput = { lastInputAt: -Infinity, visible };
  const field = new Float32Array(size * size);
  let now = 0;
  const frame = () => {
    now += STEP;
    mode.step(input, now);
    const pace = mode.pace();
    field.fill(0);
    mode.render(field);
    return pace;
  };
  const press = (x: number, y: number) => {
    input.lastInputAt = now;
    input.press = { x, y, at: now, held: true };
  };
  const frames = (count: number, touching = true) => {
    for (let i = 0; i < count; i += 1) {
      if (touching) input.lastInputAt = now;
      frame();
    }
  };
  const energy = () => field.reduce((sum, value) => sum + value, 0);
  return { input, field, frame, frames, press, energy };
}

test("a press raises the surface and keeps the loop active", () => {
  const { press, frame, energy } = setup();
  press(40, 40);

  expect(frame()).toBe("active");
  expect(energy()).toBeGreaterThan(0);
});

test("a press with no further input damps back to a flat surface", () => {
  const { press, frames, frame, field, energy } = setup();
  press(40, 40);
  frames(60 * 20);

  expect(frame()).not.toBe("active");
  expect(energy()).toBe(0);
  expect(field.every((value) => value === 0)).toBe(true);
});

test("the same press is dropped only once", () => {
  const { press, frames, energy } = setup();
  press(40, 40);
  frames(60 * 20);
  frames(1);

  expect(energy()).toBe(0);
});

test("dragging with a press held leaves a wake that hovering does not", () => {
  const wake = (held: boolean) => {
    const { input, press, frames, energy } = setup();
    input.pointer = { x: 20, y: 40 };
    if (held) press(20, 40);
    frames(1);
    input.press = held ? { ...input.press!, at: 0, held: true } : undefined;
    for (let x = 21; x <= 50; x += 1) {
      input.pointer = { x, y: 40 };
      frames(1);
    }
    return energy();
  };

  expect(wake(false)).toBeGreaterThan(0);
  expect(wake(true)).toBeGreaterThan(wake(false));
});

test("idle rain lands inside the visible rect and rests between drops", () => {
  const { frame, field } = setup();
  let drops = 0;
  let last = frame();
  for (let i = 0; i < 60 * 60; i += 1) {
    const pace = frame();
    if (last !== "active" && pace === "active") {
      drops += 1;
      for (let j = 0; j < field.length; j += 1) {
        if (field[j] === 0) continue;
        const x = (j % size) + 0.5;
        const y = Math.floor(j / size) + 0.5;
        expect(x).toBeGreaterThanOrEqual(visible.left);
        expect(x).toBeLessThanOrEqual(visible.right);
        expect(y).toBeGreaterThanOrEqual(visible.top);
        expect(y).toBeLessThanOrEqual(visible.bottom);
      }
    }
    last = pace;
  }

  expect(drops).toBeGreaterThanOrEqual(3);
});

test("rain stops after a while so an untouched pond lets the loop sleep", () => {
  const { frames, frame } = setup();
  frames(60 * 40, false);

  expect(frame()).toBe("still");
});

test("a pond that is about to rain idles between drops instead of stopping", () => {
  const { frames, frame, press } = setup();
  press(40, 40);
  frames(60 * 8, false);

  expect(["idle", "active"]).toContain(frame());
  expect(frame()).not.toBe("still");
});
