import { expect, test, vi } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import { GRID_SIZE, type BackdropInput } from "./mode";
import { pond } from "./pond";

const size = GRID_SIZE;
const middle = size / 2;
const visible = {
  left: size / 8,
  top: size / 4,
  right: (size * 7) / 8,
  bottom: (size * 3) / 4,
};
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
  press(middle, middle);

  expect(frame()).toBe("active");
  expect(energy()).toBeGreaterThan(0);
});

test("a press with no further input damps back to a flat surface", () => {
  const { press, frames, frame, field, energy } = setup();
  press(middle, middle);
  frames(60 * 20);

  expect(frame()).not.toBe("active");
  expect(energy()).toBe(0);
  expect(field.every((value) => value === 0)).toBe(true);
});

test("the same press is dropped only once", () => {
  const { press, frames, energy } = setup();
  press(middle, middle);
  frames(60 * 20);
  frames(1);

  expect(energy()).toBe(0);
});

test("dragging with a press held leaves a wake that hovering does not", () => {
  const wake = (held: boolean) => {
    const { input, press, frames, energy } = setup();
    input.pointer = { x: size / 4, y: middle };
    if (held) press(size / 4, middle);
    frames(1);
    input.press = held ? { ...input.press!, at: 0, held: true } : undefined;
    for (let x = size / 4 + 1; x <= size * 0.625; x += 1) {
      input.pointer = { x, y: middle };
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
  press(middle, middle);
  frames(60 * 8, false);

  expect(["idle", "active"]).toContain(frame());
  expect(frame()).not.toBe("still");
});

test("a lone ripple costs far less to step than one that fills the pond", () => {
  const { press: warmPress, frames } = setup();
  warmPress(middle, middle);
  frames(300);

  const { input, press, frame } = setup();
  // Each swept cell costs one Math.abs; counting them is load-independent, unlike wall-clock time.
  const abs = Math.abs;
  let calls = 0;
  Math.abs = (value) => {
    calls += 1;
    return abs(value);
  };
  const countWork = (count: number) => {
    calls = 0;
    for (let i = 0; i < count; i += 1) frame();
    return calls;
  };
  let lone = 0;
  let filled = 0;
  try {
    press(size / 16, size / 16);
    lone = countWork(6);
    for (let x = 0; x < size; x += 1) {
      input.pointer = { x, y: middle };
      input.lastInputAt = 1;
      frame();
    }
    input.press = undefined;
    filled = countWork(6);
  } finally {
    Math.abs = abs;
  }

  expect(lone * 4).toBeLessThan(filled);
});

test("a scripted session paints the same frames as the unbounded pond", () => {
  const { input, press, frame, field } = setup();
  let digest = 0;
  const fold = () => {
    for (let j = 0; j < field.length; j += 1)
      digest += field[j] * ((j % 251) + 1);
  };
  press(size / 5, size / 3);
  for (let f = 0; f < 60 * 30; f += 1) {
    if (f < 200) {
      input.lastInputAt = f * STEP;
      input.pointer = {
        x: size / 5 + f * 0.4,
        y: size / 3 + Math.sin(f / 9) * 20,
      };
    } else if (f === 200) {
      input.pointer = undefined;
      input.press = { x: size * 0.8, y: size * 0.7, at: f * STEP, held: true };
      input.lastInputAt = f * STEP;
    }
    frame();
    if (f % 7 === 0) fold();
  }

  expect(digest).toBe(40637979.74715558);
});

test("an untouched pond never clears its buffers", () => {
  const { input } = setup();
  const mode = pond.create({
    columns: size,
    rows: size,
    random: mulberry32(1),
    options: {} as never,
  });
  const fill = vi.spyOn(Float32Array.prototype, "fill");
  for (let f = 1; f <= 60; f += 1) mode.step(input, f * STEP);
  const calls = fill.mock.calls.length;
  fill.mockRestore();

  expect(calls).toBe(0);
});
