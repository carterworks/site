import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import { GRID_SIZE, type BackdropInput } from "./mode";
import { pinbed } from "./pinbed";

const size = GRID_SIZE;
const STEP = 1000 / 60;

function setup() {
  const mode = pinbed.create({
    columns: size,
    rows: size,
    random: mulberry32(1),
    options: {} as never,
  });
  const input: BackdropInput = {
    lastInputAt: -Infinity,
    visible: { left: 0, top: 35, right: size, bottom: 125 },
  };
  const field = new Float32Array(size * size);
  let now = 0;
  const run = (steps: number, each?: (step: number) => void) => {
    for (let i = 0; i < steps; i += 1) {
      now += STEP;
      each?.(i);
      mode.step(input, now);
    }
    field.fill(0);
    mode.render(field);
  };
  const deepest = () => field.reduce((a, b) => Math.max(a, b));
  const press = (x: number, y: number) => {
    input.press = { x, y, at: now, held: true };
  };
  return { mode, input, field, run, deepest, press, now: () => now };
}

test("a press dents the pins under it and leaves the far corners flat", () => {
  const { field, run, press } = setup();
  press(80, 80);
  run(5);

  expect(field[80 * size + 80]).toBeGreaterThan(0);
  expect(field[0]).toBe(0);
});

test("a longer hold dents deeper", () => {
  const brief = setup();
  brief.press(80, 80);
  brief.run(10);

  const long = setup();
  long.press(80, 80);
  long.run(60);

  expect(long.field[80 * size + 80]).toBeGreaterThan(
    brief.field[80 * size + 80],
  );
});

test("hover alone presses lighter than a hold", () => {
  const hover = setup();
  hover.run(60, (i) => {
    hover.input.pointer = { x: 40 + i, y: 80 };
  });

  const hold = setup();
  hold.press(80, 80);
  hold.run(60);

  expect(hover.deepest()).toBeGreaterThan(0);
  expect(hover.deepest()).toBeLessThan(hold.deepest());
});

test("a pointer that rests springs back instead of pressing forever", () => {
  const { input, run, mode } = setup();
  run(30, (i) => {
    input.pointer = { x: 40 + i * 2, y: 80 };
  });
  run(600);

  expect(mode.pace()).toBe("still");
});

test("pins spring back at different times until the mode is still", () => {
  const { mode, field, input, run, press, deepest } = setup();
  press(80, 80);
  run(60);
  expect(mode.pace()).toBe("active");

  input.press!.held = false;
  run(120);
  const lifted = field.filter((v) => v > 0).length;
  run(60);
  const partway = field.filter((v) => v > 0).length;
  expect(partway).toBeLessThan(lifted);
  expect(partway).toBeGreaterThan(0);

  run(600);
  expect(deepest()).toBe(0);
  expect(mode.pace()).toBe("still");
});

test("a pebble rolls only after input, then everything goes still", () => {
  const quiet = setup();
  quiet.run(60 * 40);
  expect(quiet.mode.pace()).toBe("still");

  const { mode, input, run, field } = setup();
  input.lastInputAt = 0;
  run(1);
  expect(mode.pace()).toBe("idle");

  let rolled = false;
  for (let second = 0; second < 60; second += 1) {
    run(60);
    if (field.some((v) => v > 0)) rolled = true;
  }
  expect(rolled).toBe(true);
  expect(mode.pace()).toBe("still");
});

test("an untouched bed shows a faint handprint in the lower-left margin and stays still", () => {
  const { mode, field, run } = setup();
  run(1);

  const printed = field.filter((v) => v > 0).length;
  expect(printed).toBeGreaterThan(100);
  expect(field[117 * size + 8]).toBeGreaterThan(0);
  expect(field[60 * size + 140]).toBe(0);
  expect(Math.max(...field)).toBeLessThan(0.7);
  expect(mode.pace()).toBe("still");
});

test("the handprint stays put for a minute without input", () => {
  const { mode, field, run } = setup();
  run(1);
  const before = Float32Array.from(field);

  run(60 * 60);

  expect(field).toEqual(before);
  expect(mode.pace()).toBe("still");
});

test("the first input lets the handprint spring back", () => {
  const { mode, field, input, run } = setup();
  run(1);
  input.lastInputAt = 0;
  run(200);

  expect(field[117 * size + 8]).toBe(0);
  expect(mode.pace()).toBe("idle");
});

test("an untouched handprint follows the visible rect when it changes", () => {
  const { field, input, run } = setup();
  run(1);

  input.visible = { left: 0, top: 35, right: size, bottom: 95 };
  run(1);

  expect(field[117 * size + 8]).toBe(0);
  expect(field[85 * size + 8]).toBeGreaterThan(0);
});

const GOLDEN: [number, string][] = [
  [4137705614, "still"],
  [4272130193, "active"],
  [2629332019, "active"],
  [3130474220, "active"],
  [1835401642, "active"],
  [1107083285, "active"],
  [2315578821, "idle"],
  [2315578821, "idle"],
  [2315578821, "idle"],
  [2315578821, "idle"],
  [2315578821, "idle"],
  [627734265, "active"],
  [1478653331, "active"],
  [2314882880, "active"],
];

const fingerprint = (field: Float32Array) => {
  const bits = new Uint32Array(field.buffer, field.byteOffset, field.length);
  let hash = 2166136261;
  for (const word of bits) hash = Math.imul(hash ^ word, 16777619) >>> 0;
  return hash;
};

test("a scripted session relaxes exactly as it did when every pin was scanned each step", () => {
  const { mode, input, field, run, press } = setup();
  const seen: [number, string][] = [];
  const sample = () => seen.push([fingerprint(field), mode.pace()]);

  run(1);
  sample();
  input.lastInputAt = 0;
  run(40, (i) => {
    input.pointer = { x: 30 + i * 2, y: 70 + Math.sin(i / 5) * 10 };
  });
  sample();
  press(100, 90);
  run(90, (i) => {
    input.pointer = { x: 100 + i * 0.3, y: 90 };
  });
  sample();
  input.press!.held = false;
  run(1);
  sample();
  run(100);
  sample();
  run(300);
  sample();
  input.pointer = undefined;
  input.lastInputAt = 30_000;
  for (let second = 0; second < 40; second += 1) {
    run(60);
    if (second % 5 === 4) sample();
  }

  expect(seen).toEqual(GOLDEN);
});
