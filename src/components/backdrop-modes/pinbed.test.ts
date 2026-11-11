import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import type { BackdropInput } from "./mode";
import { pinbed } from "./pinbed";

const size = 80;
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
    visible: { left: 0, top: 17.5, right: 80, bottom: 62.5 },
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
  press(40, 40);
  run(5);

  expect(field[40 * size + 40]).toBeGreaterThan(0);
  expect(field[0]).toBe(0);
});

test("a longer hold dents deeper", () => {
  const brief = setup();
  brief.press(40, 40);
  brief.run(10);

  const long = setup();
  long.press(40, 40);
  long.run(60);

  expect(long.field[40 * size + 40]).toBeGreaterThan(
    brief.field[40 * size + 40],
  );
});

test("hover alone presses lighter than a hold", () => {
  const hover = setup();
  hover.run(60, (i) => {
    hover.input.pointer = { x: 20 + i * 0.5, y: 40 };
  });

  const hold = setup();
  hold.press(40, 40);
  hold.run(60);

  expect(hover.deepest()).toBeGreaterThan(0);
  expect(hover.deepest()).toBeLessThan(hold.deepest());
});

test("a pointer that rests springs back instead of pressing forever", () => {
  const { input, run, mode } = setup();
  run(30, (i) => {
    input.pointer = { x: 20 + i, y: 40 };
  });
  run(600);

  expect(mode.pace()).toBe("still");
});

test("pins spring back at different times until the mode is still", () => {
  const { mode, field, input, run, press, deepest } = setup();
  press(40, 40);
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
  for (let second = 0; second < 25; second += 1) {
    run(60);
    if (field.some((v) => v > 0)) rolled = true;
  }
  expect(rolled).toBe(true);
  expect(mode.pace()).toBe("still");
});
