import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  place,
  type SoftBitmap,
} from "../../test/toy-canvas";
import { mulberry32 } from "../../lib/backdrop-noise";
import { crags, horizon, peaks } from "./landscape";
import type { Toy } from "./toy";

const SIZE = 160;

let viewport: DOMRect;
const stops: (() => void)[] = [];

beforeEach(() => {
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLDivElement ? viewport : measure.call(this);
    },
  );
  vi.spyOn(Math, "random").mockImplementation(mulberry32(1));
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Starts `toy` on a square canvas whose middle half of rows is on screen. */
function start(toy: Toy): SoftBitmap {
  const { plain } = installSoftCanvas();
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: SIZE, height: SIZE });
  canvas.dataset.fit = "viewport";
  place(canvas, new DOMRect(0, -SIZE, SIZE * 4, SIZE * 4));
  viewport = new DOMRect(0, 0, SIZE * 4, SIZE * 2);
  document.body.append(canvas);
  stops.push(toy.start(canvas));
  return plain[0];
}

const alphaAt = ({ pixels, width }: SoftBitmap, x: number, y: number) =>
  pixels[(y * width + x) * 4 + 3];

/** The highest lit row, from the top of the canvas. */
function skyline(bitmap: SoftBitmap) {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) if (alphaAt(bitmap, x, y) > 0) return y;
  }
  return SIZE;
}

test.each([peaks, horizon, crags])(
  "$id lays its ground along the bottom of the visible cells",
  (toy) => {
    const bitmap = start(toy);
    const bottom = (3 * SIZE) / 4 - 1;

    for (let x = 0; x < SIZE; x += 1) {
      expect(alphaAt(bitmap, x, bottom)).toBeGreaterThan(0);
      expect(alphaAt(bitmap, x, bottom + 1)).toBe(0);
    }
    expect(skyline(bitmap)).toBeGreaterThan(SIZE / 4);
  },
);

test("a resize redraws the same range", () => {
  const bitmap = start(peaks);
  const before = bitmap.pixels.slice();

  window.dispatchEvent(new Event("resize"));

  expect(bitmap.pixels).toEqual(before);
});

test("peaks rise higher than the horizon", () => {
  expect(skyline(start(peaks))).toBeLessThan(skyline(start(horizon)));
});

test("crags shades its rock in more than one level", () => {
  const { pixels } = start(crags);
  const shades = new Set(pixels.filter((_, i) => i % 4 === 3 && _ > 0));

  expect(shades.size).toBeGreaterThan(10);
});
