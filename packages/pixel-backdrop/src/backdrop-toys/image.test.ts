import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  installSoftCanvas,
  recordListeners,
  SoftContext,
} from "../test/toy-canvas";
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

test("it listens only with a signal, which its stop aborts", () => {
  const listeners = recordListeners();
  try {
    startWith({ width: 200, height: 100 }).stop();
  } finally {
    listeners.restore();
  }

  expect(listeners.added).toEqual([
    {
      target: window,
      type: "resize",
      signal: expect.objectContaining({ aborted: true }),
    },
  ]);
});

test("the toy is a still picture, with no noise over it", () => {
  const toy = imageToy({ width: 1, height: 1 } as ImageBitmap);

  expect(toy).toMatchObject({
    id: "image",
    label: "Image",
    picture: true,
    look: { ghost: 0, noise: 0 },
  });
});

test("a dull picture is stretched to every shade, its darkest and lightest hundredth clipped", () => {
  vi.mocked(SoftContext.prototype.drawImage).mockImplementation(function (
    this: SoftContext,
    _,
    ...rect
  ) {
    const [x, y, width, height] = rect as number[];
    this.fillStyle = "rgb(100, 100, 100)";
    this.fillRect(x, y, width / 2, height);
    this.fillStyle = "rgb(150, 150, 150)";
    this.fillRect(x + width / 2, y, width / 2, height);
  });
  const { canvas } = startWith({ width: 200, height: 100 });
  const grey = (x: number) =>
    canvas.getContext("2d")!.getImageData(x, 80, 1, 1).data.join(" ");

  expect([grey(10), grey(150)]).toEqual(["0 0 0 255", "255 255 255 255"]);
});
