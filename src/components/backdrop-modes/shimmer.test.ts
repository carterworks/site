import { expect, test } from "vitest";
import { mulberry32 } from "../backdrop-noise";
import type { BackdropInput } from "./mode";
import { shimmer } from "./shimmer";

const columns = 16;
const rows = 16;

function setup() {
  const mode = shimmer.create({
    columns,
    rows,
    random: mulberry32(1),
    options: { rippleSize: 6, rippleSpeed: 100 } as never,
  });
  const input: BackdropInput = {
    lastInputAt: 0,
    visible: { left: 0, top: 0, right: columns, bottom: rows },
  };
  const field = new Float32Array(columns * rows);
  const frame = (now: number) => {
    mode.step(input, now);
    const pace = mode.pace();
    field.fill(0);
    mode.render(field);
    return pace;
  };
  const at = (x: number, y: number) => field[y * columns + x];
  return { mode, input, field, frame, at };
}

test("a move draws the hover segment from the previous cell once, then nothing", () => {
  const { input, field, frame, at } = setup();
  input.pointer = { x: 2.5, y: 2.5 };
  frame(0);
  input.pointer = { x: 5.5, y: 2.5 };

  expect(frame(16)).toBe("active");
  expect([2, 3, 4, 5].map((x) => at(x, 2))).toEqual([1, 1, 1, 1]);
  expect(field.reduce((sum, value) => sum + value)).toBe(4);

  expect(frame(32)).toBe("still");
  expect(field.every((value) => value === 0)).toBe(true);
});

test("a pointer that left draws nothing", () => {
  const { input, field, frame } = setup();
  input.pointer = { x: 2.5, y: 2.5 };
  frame(0);
  input.pointer = undefined;

  expect(frame(16)).toBe("still");
  expect(field.every((value) => value === 0)).toBe(true);
});

test("a press grows a fading ring that lasts the ripple speed", () => {
  const { input, frame, at } = setup();
  input.press = { x: 8.5, y: 8.5, at: 0, held: false };

  expect(frame(50)).toBe("active");
  expect(at(8 + 3, 8)).toBeCloseTo(0.5);
  expect(at(8, 8)).toBe(0);

  expect(frame(100)).toBe("still");
});

test("a later press starts its own ripple after the first has finished", () => {
  const { input, frame, at } = setup();
  input.press = { x: 8.5, y: 8.5, at: 0, held: false };
  frame(50);
  frame(60);
  input.press = { x: 8.5, y: 8.5, at: 60, held: false };

  expect(frame(110)).toBe("active");
  expect(at(8 + 3, 8)).toBeCloseTo(0.5);
});
