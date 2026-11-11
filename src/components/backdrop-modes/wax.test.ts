import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import type { BackdropInput, Point } from "./mode";
import { wax } from "./wax";

const columns = 80;
const rows = 80;
const visible = { left: 0, top: 17.5, right: 80, bottom: 62.5 };
const STEP = 1000 / 60;

function setup() {
  const mode = wax.create({
    columns,
    rows,
    random: mulberry32(3),
    options: {} as never,
  });
  const input: BackdropInput = { lastInputAt: 0, visible };
  const field = new Float32Array(columns * rows);
  let now = 0;
  const frame = () => {
    now += STEP;
    mode.step(input, now);
    field.fill(0);
    mode.render(field);
    return mode.pace();
  };
  const run = (steps: number) => {
    for (let i = 0; i < steps; i += 1) {
      input.lastInputAt = now;
      frame();
    }
  };
  return { mode, input, field, frame, run, jump: (ms: number) => (now += ms) };
}

/** Centre of the solid wax connected to the solid cell nearest `near`. */
function blobNear(field: Float32Array, near: Point): Point {
  let seed = -1;
  let best = Infinity;
  field.forEach((value, i) => {
    if (value < 1) return;
    const distance = Math.hypot(
      (i % columns) - near.x,
      Math.floor(i / columns) - near.y,
    );
    if (distance < best) [best, seed] = [distance, i];
  });
  const seen = new Set([seed]);
  const queue = [seed];
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const x = queue[i] % columns;
    const y = Math.floor(queue[i] / columns);
    sx += x + 0.5;
    sy += y + 0.5;
    for (const next of [
      queue[i] - 1,
      queue[i] + 1,
      queue[i] - columns,
      queue[i] + columns,
    ]) {
      if (field[next] === 1 && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return { x: sx / queue.length, y: sy / queue.length };
}

function centroidY(field: Float32Array, from: number, to: number) {
  let sum = 0;
  let mass = 0;
  for (let y = from; y < to; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      sum += field[y * columns + x] * y;
      mass += field[y * columns + x];
    }
  }
  return sum / mass;
}

const middle = (visible.top + visible.bottom) / 2;

test("hot wax at the bottom rises while cool wax at the top sinks", () => {
  const { field, run } = setup();
  run(1);
  const bottom = centroidY(field, middle, visible.bottom);
  const top = centroidY(field, visible.top, middle);
  run(40);

  expect(centroidY(field, middle, visible.bottom)).toBeLessThan(bottom);
  expect(centroidY(field, visible.top, middle)).toBeGreaterThan(top);
});

const lit = (field: Float32Array, { x, y }: Point) =>
  field[Math.floor(y) * columns + Math.floor(x)] === 1;

/** Drags the blob nearest the middle across the glass, or just hovers there. */
function sweep(held: boolean) {
  const { input, field, run } = setup();
  run(1);
  const start = blobNear(field, { x: 40, y: 40 });
  const direction = start.x < 40 ? 1 : -1;
  if (held) input.press = { ...start, at: 0, held: true };
  for (let step = 1; step <= 60; step += 1) {
    input.pointer = { x: start.x + direction * 0.25 * step, y: start.y };
    run(1);
  }
  return { input, field, run, direction };
}

test("a press near a blob grabs it and the blob follows the pointer while held", () => {
  const dragged = sweep(true);
  expect(lit(dragged.field, dragged.input.pointer!)).toBe(true);

  const hovered = sweep(false);
  expect(lit(hovered.field, hovered.input.pointer!)).toBe(false);
});

test("letting go mid-drag flings the blob on with its momentum", () => {
  const flung = (pause: boolean) => {
    const { input, field, run, direction } = sweep(true);
    if (pause) run(30);
    const ahead = {
      x: input.pointer!.x + direction * 10,
      y: input.pointer!.y,
    };
    input.press!.held = false;
    input.pointer = undefined;
    let reached = false;
    for (let step = 0; step < 40; step += 1) {
      run(1);
      reached ||= lit(field, ahead);
    }
    return reached;
  };

  expect(flung(false)).toBe(true);
  expect(flung(true)).toBe(false);
});

test("a tap on empty glass pushes the nearby wax away", () => {
  const { input, field, run } = setup();
  run(1);
  const before = blobNear(field, { x: 40, y: 40 });
  const tap = { x: before.x + (before.x < 40 ? -17 : 17), y: before.y };
  input.press = { ...tap, at: 0, held: false };
  run(30);

  const after = blobNear(field, before);
  expect(Math.hypot(after.x - tap.x, after.y - tap.y)).toBeGreaterThan(
    Math.hypot(before.x - tap.x, before.y - tap.y) + 2,
  );
});

test("an untouched lamp cools to a stop and a touch warms it again", () => {
  const { input, field, frame, jump } = setup();
  for (let i = 0; i < 60; i += 1) frame();
  expect(frame()).toBe("active");

  const idle = 60 * 60 * 1000;
  jump(idle);
  let pace = frame();
  for (let i = 0; i < 600 && pace !== "still"; i += 1) pace = frame();
  expect(pace).toBe("still");

  const resting = field.slice();
  frame();
  expect(field).toEqual(resting);

  input.lastInputAt = jump(1);
  expect(frame()).toBe("active");
});
