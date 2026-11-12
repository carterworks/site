import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installSoftCanvas, SoftContext } from "../../test/toy-canvas";
import { imageToy } from "./image";

const calls: string[] = [];
const stops: (() => void)[] = [];

beforeEach(() => {
  calls.length = 0;
  installSoftCanvas();
  vi.spyOn(SoftContext.prototype, "clearRect").mockImplementation(() => {
    calls.push("clear");
  });
  vi.spyOn(SoftContext.prototype, "drawImage").mockImplementation(
    (_, ...rect) => {
      calls.push(`draw ${rect.join(" ")}`);
    },
  );
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
});

const startWith = (image: { width: number; height: number }) => {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: 160, height: 160 });
  const stop = imageToy(image as ImageBitmap).start(canvas);
  stops.push(stop);
  return { canvas, stop };
};

test("a landscape picture is contained and centred in whole cells", () => {
  startWith({ width: 200, height: 100 });

  expect(calls).toEqual(["clear", "draw 0 40 160 80"]);
});

test("a portrait picture is contained and centred in whole cells", () => {
  startWith({ width: 100, height: 200 });

  expect(calls).toEqual(["clear", "draw 40 0 80 160"]);
});

test("a resize redraws the picture, and stopping ends that", () => {
  const { stop } = startWith({ width: 200, height: 100 });
  calls.length = 0;

  window.dispatchEvent(new Event("resize"));
  expect(calls).toEqual(["clear", "draw 0 40 160 80"]);

  stop();
  calls.length = 0;
  window.dispatchEvent(new Event("resize"));
  expect(calls).toEqual([]);
});

test("the toy has its own id and label and no look", () => {
  const toy = imageToy({ width: 1, height: 1 } as ImageBitmap);

  expect([toy.id, toy.label, toy.look]).toEqual(["image", "Image", undefined]);
});
