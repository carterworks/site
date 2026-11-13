import { expect, test } from "vitest";
import {
  fake,
  useFakeCanvas,
  mountCanvas,
  draw,
  shown,
  presentFor,
  fadingFromWhite,
  drawRow,
  pixelsShown,
} from "../../../test/emulated-canvas";

useFakeCanvas();

test("at 60 Hz each ghost frame keeps data-ghost of the previous one", () => {
  const canvas = fadingFromWhite("70");

  presentFor(canvas, 1000 / 60, 60);

  expect(Math.abs(shown()[0] - 255 * 0.7)).toBeLessThanOrEqual(1);
});

test("the ghost trail fades by elapsed time, so a faster display does not shorten it", () => {
  const trailAfter = (hz: number) => {
    presentFor(fadingFromWhite("70"), 100, hz);
    return shown()[0];
  };

  expect(trailAfter(60)).toBeGreaterThan(10);
  expect(Math.abs(trailAfter(120) - trailAfter(60))).toBeLessThanOrEqual(1);
});

test("even at the maximum ghost the panel lands exactly on a new frame, with no residual", () => {
  const canvas = fadingFromWhite("100");
  draw(canvas, 3);

  presentFor(canvas, 10_000, 60);

  expect([...shown()]).toEqual([3, 3, 3, 255]);
});

test("turning the ghost off and on again starts the panel from the current frame", () => {
  const canvas = fadingFromWhite("70");
  canvas.dataset.ghost = "0";
  presentFor(canvas, 1000 / 60, 60);

  canvas.dataset.ghost = "70";
  presentFor(canvas, 1000 / 60, 60);

  expect([...shown()]).toEqual([0, 0, 0, 255]);
});

test("data-ghost-rise and data-ghost-fall set the brightening and darkening response apart", () => {
  const canvas = mountCanvas({ ghostRise: "0", ghostFall: "70" });
  draw(canvas, 0);
  canvas.present();

  draw(canvas, 255);
  presentFor(canvas, 1000 / 60, 60);
  expect(shown()[0]).toBe(255);

  draw(canvas, 0);
  presentFor(canvas, 1000 / 60, 60);
  expect(Math.abs(shown()[0] - 255 * 0.7)).toBeLessThanOrEqual(1);
});

test("data-ghost-rise alone brightens through a partial value while darkening stays instant", () => {
  const canvas = mountCanvas({ ghostRise: "70" });
  draw(canvas, 0);
  canvas.present();

  draw(canvas, 255);
  presentFor(canvas, 1000 / 60, 60);
  expect(Math.abs(shown()[0] - 255 * 0.3)).toBeLessThanOrEqual(1);

  draw(canvas, 0);
  presentFor(canvas, 1000 / 60, 60);
  expect(shown()[0]).toBe(0);
});

test("data-ghost-rise and data-ghost-fall each default to data-ghost", () => {
  const canvas = mountCanvas({ ghost: "70", ghostRise: "0" });
  draw(canvas, 255);
  canvas.present();

  draw(canvas, 0);
  presentFor(canvas, 1000 / 60, 60);

  expect(Math.abs(shown()[0] - 255 * 0.7)).toBeLessThanOrEqual(1);
});

test("a pixel brightening overall rises in every channel, even one that darkens", () => {
  const canvas = mountCanvas({ ghostRise: "0", ghostFall: "90" });
  drawRow(canvas, [200, 0, 0, 255]);
  canvas.present();

  drawRow(canvas, [0, 255, 0, 255]);
  presentFor(canvas, 1000 / 60, 60);

  expect(pixelsShown()).toBe("0 255 0 255");
});

test("an instant response with no time elapsed lands on the frame, not NaN", () => {
  const canvas = mountCanvas({ ghostRise: "0", ghostFall: "70" });
  draw(canvas, 0);
  canvas.present();

  draw(canvas, 255);
  canvas.present();

  expect([...shown()]).toEqual([255, 255, 255, 255]);
});

test("present reports a ghost fade as changing until it lands on the frame", () => {
  const canvas = mountCanvas({ ghost: "70" });
  draw(canvas, 255);
  expect(canvas.present()).toBe(false);

  draw(canvas, 0);
  fake.clock += 1000 / 60;
  expect(canvas.present()).toBe(true);

  presentFor(canvas, 1000, 60);
  expect(shown()[0]).toBe(0);
  fake.clock += 1000 / 60;
  expect(canvas.present()).toBe(false);
});

test("present reports settled once the ghost is turned off mid-fade", () => {
  const canvas = fadingFromWhite("90");
  fake.clock += 1000 / 60;
  expect(canvas.present()).toBe(true);

  canvas.dataset.ghost = "0";
  fake.clock += 1000 / 60;
  expect(canvas.present()).toBe(false);
});

test("a one-level step settles at once, so a slowly drifting frame lets its owner idle", () => {
  const canvas = mountCanvas({ ghost: "100" });
  draw(canvas, 100);
  canvas.present();
  draw(canvas, 101);
  fake.clock += 1000 / 60;

  expect(canvas.present()).toBe(false);
  expect(shown()[0]).toBe(101);
});
