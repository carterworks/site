import { expect, test } from "vitest";
import {
  fake,
  useFakeCanvas,
  mountCanvas,
  shown,
  drawRow,
  square,
} from "../../../test/emulated-canvas";

useFakeCanvas();

test("data-noise lightens the frame up to a noise of that intensity, and never darkens it", () => {
  const canvas = mountCanvas({
    width: "32",
    height: "32",
    noise: "50",
    noiseScale: "4",
  });
  const image = square(32, 0);
  image.data.set([255, 255, 255, 255]);
  canvas.getContext("2d")?.putImageData(image, 0, 0);

  canvas.present();

  const reds = [...shown()].filter((_, i) => i % 4 === 0);
  expect(reds[0]).toBe(255);
  expect(Math.max(...reds.slice(1))).toBeGreaterThan(64);
  expect(Math.max(...reds.slice(1))).toBeLessThanOrEqual(128);
  expect(new Set(reds).size).toBeGreaterThan(10);
});

test("noise over a transparent pixel lightens it as though over black, and makes it opaque", () => {
  const canvas = mountCanvas({ width: "1", height: "1", noise: "100" });
  drawRow(canvas, [255, 255, 255, 0]);

  canvas.present();

  expect(shown()[3]).toBe(255);
  expect(shown()[0]).toBeLessThan(255);
});

test("noise drifts with data-noise-speed, and holds still without it", () => {
  const canvas = mountCanvas({ width: "16", height: "16", noise: "50" });
  canvas.getContext("2d")?.putImageData(square(16, 0), 0, 0);
  const presentAfter = (ms: number) => {
    fake.clock += ms;
    canvas.present();
    return [...shown()].join();
  };

  const still = presentAfter(0);
  expect(presentAfter(1000)).toBe(still);

  canvas.dataset.noiseSpeed = "50";
  expect(presentAfter(1000)).not.toBe(still);
});
