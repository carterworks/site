import { expect, test } from "vitest";
import { multiplyOverlay, type Rgb } from "./rgb";

const BASE: Rgb = [136, 157, 88];

/** `under` with the overlay painted over it as ordinary source-over paint. */
function painted(under: Rgb, base: Rgb, factor: Rgb) {
  const colour: Rgb = [0, 0, 0];
  const alpha = multiplyOverlay(base, factor, colour);
  return under.map((value, c) => value * (1 - alpha) + colour[c] * alpha);
}

const multiplied = (under: Rgb, factor: Rgb) =>
  under.map((value, c) => value * factor[c]);

test.each<[string, Rgb]>([
  ["each channel by its own factor", [0.28, 0.38, 0.49]],
  ["the strongest factor in green", [0.9, 0.2, 0.6]],
  ["one channel left alone", [1, 0.5, 0.7]],
  ["every channel alike", [0.4, 0.4, 0.4]],
])("over the base it paints exactly what multiplying %s does", (_, factor) => {
  const shown = painted(BASE, BASE, factor);
  multiplied(BASE, factor).forEach((value, c) => {
    expect(shown[c]).toBeCloseTo(value, 9);
  });
});

test("over any other colour each channel is off by its factor's excess over the strongest, times its distance from the base", () => {
  const factor: Rgb = [0.28, 0.38, 0.49];
  const under: Rgb = [38, 60, 43];
  const strongest = Math.min(...factor);

  const shown = painted(under, BASE, factor);
  const exact = multiplied(under, factor);

  for (let c = 0; c < 3; c += 1) {
    expect(shown[c] - exact[c]).toBeCloseTo(
      (factor[c] - strongest) * (BASE[c] - under[c]),
      9,
    );
  }
  expect(shown[0]).toBeCloseTo(exact[0], 9);
});

test("every channel alike is plain black at the darkening's strength, exact over any colour", () => {
  const colour: Rgb = [9, 9, 9];

  expect(multiplyOverlay(BASE, [0.75, 0.75, 0.75], colour)).toBeCloseTo(0.25);
  expect(colour).toEqual([0, 0, 0]);
});

test("a channel left alone keeps the base's own value in the colour", () => {
  const colour: Rgb = [0, 0, 0];

  multiplyOverlay(BASE, [1, 0.5, 0.5], colour);

  expect(colour[0]).toBeCloseTo(BASE[0]);
});

test("multiplying by white paints nothing", () => {
  const colour: Rgb = [9, 9, 9];

  expect(multiplyOverlay(BASE, [1, 1, 1], colour)).toBe(0);
  expect(colour).toEqual([0, 0, 0]);
});

test("a base channel of zero stays zero in the colour", () => {
  const colour: Rgb = [9, 9, 9];

  multiplyOverlay([0, 157, 88], [1, 0.5, 0.7], colour);

  expect(colour[0]).toBe(0);
});
