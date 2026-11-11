import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import { GRID_SIZE, type BackdropInput, type Point } from "./mode";
import { renderBlobs, wax } from "./wax";

const columns = GRID_SIZE;
const rows = GRID_SIZE;
/** About one gallery tile of glass, so the lamp is as sparse as the prototype's. */
const span = 54;
const edge = (columns - span) / 2;
const visible = {
  left: edge,
  top: edge,
  right: edge + span,
  bottom: edge + span,
};
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

const centre = { x: columns / 2, y: columns / 2 };
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
  const start = blobNear(field, centre);
  const direction = start.x < centre.x ? 1 : -1;
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
      x: input.pointer!.x + direction * 6,
      y: input.pointer!.y,
    };
    input.press!.held = false;
    input.pointer = undefined;
    let reached = false;
    for (let step = 0; step < 60; step += 1) {
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
  const before = blobNear(field, centre);
  const tap = { x: before.x + (before.x < centre.x ? -12 : 12), y: before.y };
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

test("the bounded render matches summing every blob over every cell but for cells on a band edge", () => {
  const random = mulberry32(11);
  const blobs = Array.from({ length: 7 }, () => ({
    x: visible.left + random() * span,
    y: visible.top + random() * span,
    r: 2.5 + random() * 2.5,
  }));
  const bands = (sum: number) =>
    sum >= 1 ? 1 : sum > 0.72 ? 0.55 : sum > 0.5 ? 0.22 : 0;
  const full = new Float32Array(columns * rows);
  for (let y = Math.floor(visible.top); y < visible.bottom; y += 1) {
    for (let x = Math.floor(visible.left); x < visible.right; x += 1) {
      let sum = 0;
      for (const { x: bx, y: by, r } of blobs) {
        const dx = x + 0.5 - bx;
        const dy = y + 0.5 - by;
        sum += (r * r) / (dx * dx + dy * dy + 0.5);
      }
      full[y * columns + x] = bands(sum);
    }
  }

  const bounded = new Float32Array(columns * rows);
  renderBlobs(
    blobs,
    visible,
    columns,
    {
      near: new Float64Array(columns * rows),
      far: new Float64Array(columns * rows),
    },
    bounded,
  );

  const differing = bounded.filter((value, i) => value !== full[i]).length;
  expect(differing).toBeLessThan(span * span * 0.005);
});

test("the lamp holds the same few blobs however much glass is visible", () => {
  const wax_ = (rect: typeof visible) => {
    const mode = wax.create({
      columns,
      rows,
      random: mulberry32(3),
      options: {} as never,
    });
    const field = new Float32Array(columns * rows);
    mode.step({ lastInputAt: 0, visible: rect }, 0);
    mode.render(field);
    return field.reduce((sum, value) => sum + value, 0);
  };
  const viewport = { left: 0, top: 30, right: columns, bottom: 130 };

  expect(wax_(viewport) / wax_(visible)).toBeLessThan(1.5);
});
