import { expect, test } from "vitest";
import {
  display,
  useFakeCanvas,
  mountCanvas,
  shown,
  drawRow,
  pixelsShown,
} from "../../../test/emulated-canvas";

useFakeCanvas();

test("a palette maps each pixel's luma onto the scale from data-palette-base to data-palette-ink, opaque", () => {
  const canvas = mountCanvas({
    width: "5",
    height: "1",
    paletteBase: "#102030",
    paletteInk: "#ffffff",
  });
  drawRow(
    canvas,
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    [255, 255, 255, 0],
    [128, 128, 128, 255],
    [0, 255, 0, 255],
  );

  canvas.present();

  const mix = (share: number) =>
    [0x10, 0x20, 0x30].map((base) => Math.round(base + (255 - base) * share));
  expect(pixelsShown()).toBe(
    [
      [0x10, 0x20, 0x30, 255],
      [255, 255, 255, 255],
      [0x10, 0x20, 0x30, 255],
      [...mix(128 / 255), 255],
      [...mix(182 / 255), 255],
    ]
      .flat()
      .join(" "),
  );
});

test("a palette follows its knobs, and is off without both", () => {
  const canvas = mountCanvas({
    width: "1",
    height: "1",
    paletteBase: "#000000",
    paletteInk: "#ff0000",
  });
  drawRow(canvas, [255, 255, 255, 255]);
  canvas.present();
  expect(pixelsShown()).toBe("255 0 0 255");

  canvas.dataset.paletteInk = "#00ff00";
  canvas.present();
  expect(pixelsShown()).toBe("0 255 0 255");

  delete canvas.dataset.paletteInk;
  display.drawImage.mockClear();
  canvas.present();
  expect(display.drawImage).toHaveBeenCalledTimes(1);
});

test("data-palette-levels snaps each pixel to the nearest of that many evenly spaced shades", () => {
  const canvas = mountCanvas({
    width: "4",
    height: "1",
    paletteBase: "#000000",
    paletteInk: "#ffffff",
    paletteLevels: "4",
  });
  const greys = [0, 100, 200, 255];
  drawRow(canvas, ...greys.map((grey) => [grey, grey, grey, 255]));
  const shades = () => [...shown()].filter((_, i) => i % 4 === 0);

  canvas.present();
  expect(shades()).toEqual([0, 85, 170, 255]);

  canvas.dataset.paletteLevels = "2";
  canvas.present();
  expect(shades()).toEqual([0, 0, 255, 255]);
});

test.each(["1", "x", ""])(
  "a data-palette-levels of %j leaves the palette smooth",
  (levels) => {
    const canvas = mountCanvas({
      paletteBase: "#000000",
      paletteInk: "#ffffff",
      paletteLevels: levels,
    });
    drawRow(canvas, [100, 100, 100, 255]);

    canvas.present();

    expect(pixelsShown()).toBe("100 100 100 255");
  },
);

test("data-palette-stops spaces its colours evenly between the base and the ink", () => {
  const canvas = mountCanvas({
    width: "5",
    height: "1",
    paletteBase: "#000000",
    paletteInk: "#ffffff",
    paletteStops: "#ff0000 #0000ff",
  });
  drawRow(
    canvas,
    ...[0, 85, 128, 170, 255].map((grey) => [grey, grey, grey, 255]),
  );

  canvas.present();

  const between = (share: number) =>
    [255 * (1 - share), 0, 255 * share].map(Math.round);
  expect(pixelsShown()).toBe(
    [[0, 0, 0], [255, 0, 0], between(43 / 85), [0, 0, 255], [255, 255, 255]]
      .map((rgb) => [...rgb, 255])
      .flat()
      .join(" "),
  );
});

test("data-palette-levels as many as the colours snaps each pixel to one of them", () => {
  const canvas = mountCanvas({
    width: "4",
    height: "1",
    paletteBase: "#000000",
    paletteInk: "#ffffff",
    paletteStops: "#ff0000 #0000ff",
    paletteLevels: "4",
  });
  drawRow(
    canvas,
    ...[30, 100, 150, 240].map((grey) => [grey, grey, grey, 255]),
  );

  canvas.present();

  expect(pixelsShown()).toBe(
    "0 0 0 255 255 0 0 255 0 0 255 255 255 255 255 255",
  );
});
