import { expect, test } from "vitest";
import { makeCoarseNoise, makeNoise2D } from "./backdrop-noise";
import { GRID_SIZE } from "./backdrop-modes/mode";

const SIZE = GRID_SIZE;
const STEP = 4;
const FREQUENCY = 1 / 30;
const OFFSET_X = 12.9898;
const OFFSET_Y = 78.233;

const noise = makeNoise2D(0x9e3779b9);

/** The layer sampled at every cell, which the coarse one stands in for. */
function exact(drift: number) {
  const field = new Float32Array(SIZE * SIZE);
  for (let y = 0, i = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1, i += 1) {
      const value = noise(
        x * FREQUENCY + OFFSET_X + drift,
        y * FREQUENCY + OFFSET_Y + drift / 2,
      );
      field[i] = value * 0.5 + 0.5;
    }
  }
  return field;
}

function coarse(drift: number, step = STEP) {
  const field = new Float32Array(SIZE * SIZE);
  makeCoarseNoise(noise, SIZE, SIZE)(
    field,
    step,
    FREQUENCY,
    OFFSET_X + drift,
    OFFSET_Y + drift / 2,
    1,
  );
  return field;
}

/** The largest change between horizontally or vertically adjacent cells. */
function steepest(field: Float32Array) {
  let most = 0;
  for (let y = 0, i = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1, i += 1) {
      if (x > 0) most = Math.max(most, Math.abs(field[i] - field[i - 1]));
      if (y > 0) most = Math.max(most, Math.abs(field[i] - field[i - SIZE]));
    }
  }
  return most;
}

const DRIFTS = [0, 0.37, 5.1];

test.each(DRIFTS)(
  "matches the exact layer on its sample points at drift %d",
  (drift) => {
    const want = exact(drift);
    const got = coarse(drift);
    for (let y = 0; y < SIZE; y += STEP) {
      for (let x = 0; x < SIZE; x += STEP) {
        expect(got[y * SIZE + x]).toBeCloseTo(want[y * SIZE + x], 6);
      }
    }
  },
);

test.each(DRIFTS)(
  "stays close to the exact layer between sample points at drift %d",
  (drift) => {
    const want = exact(drift);
    const got = coarse(drift);
    let worst = 0;
    let squares = 0;
    for (let i = 0; i < got.length; i += 1) {
      const error = Math.abs(got[i] - want[i]);
      worst = Math.max(worst, error);
      squares += error * error;
    }
    expect(worst).toBeLessThan(0.08);
    expect(Math.sqrt(squares / got.length)).toBeLessThan(0.02);
  },
);

test.each(DRIFTS)(
  "is continuous, never steeper between neighbours than the exact layer, at drift %d",
  (drift) => {
    expect(steepest(coarse(drift))).toBeLessThanOrEqual(
      steepest(exact(drift)) * 1.01,
    );
  },
);

test("a step of one is the exact layer", () => {
  const want = exact(0);
  const got = coarse(0, 1);
  for (let i = 0; i < got.length; i += 1) {
    expect(got[i]).toBeCloseTo(want[i], 6);
  }
});

test("only raises cells, scaled by the amount, and leaves brighter ones alone", () => {
  const field = new Float32Array(SIZE * SIZE).fill(0.3);
  field[0] = 0.9;
  makeCoarseNoise(noise, SIZE, SIZE)(
    field,
    STEP,
    FREQUENCY,
    OFFSET_X,
    OFFSET_Y,
    0.5,
  );
  expect(field[0]).toBe(Math.fround(0.9));
  expect(Math.min(...field)).toBeGreaterThanOrEqual(Math.fround(0.3));
  expect(Math.max(...field.subarray(1))).toBeLessThanOrEqual(0.5);
});
