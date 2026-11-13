import { afterEach, expect, test, vi } from "vitest";
import {
  cellScale,
  fixedStep,
  frameLoop,
  pointOn,
  sameRect,
  visibleCells,
} from "./toy";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function canvasAt(rect: DOMRect, width = 100, height = 50, fit?: "viewport") {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width, height });
  if (fit !== undefined) canvas.dataset.fit = fit;
  canvas.getBoundingClientRect = () => rect;
  return canvas;
}

test("a pointer maps onto the canvas's own pixels however large it is drawn", () => {
  const canvas = canvasAt(new DOMRect(10, 20, 400, 200));

  expect(pointOn(canvas, { clientX: 10, clientY: 20 })).toEqual({ x: 0, y: 0 });
  expect(pointOn(canvas, { clientX: 212, clientY: 70 })).toEqual({
    x: 50.5,
    y: 12.5,
  });
});

/** Measures the small viewport probe as `rect`. */
function smallViewport(rect: DOMRect) {
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLDivElement ? rect : measure.call(this);
    },
  );
}

test("a canvas that did not opt in is visible whole, however little of it is on screen", () => {
  smallViewport(new DOMRect(0, 0, 390, 600));
  const canvas = canvasAt(new DOMRect(0, 400, 390, 800), 100, 100);

  expect(visibleCells(canvas)).toEqual({
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
  });
});

test("the visible cells of a canvas fit to the viewport are its overlap with the small viewport", () => {
  smallViewport(new DOMRect(0, 40, 390, 600));
  const canvas = canvasAt(
    new DOMRect(-100, 0, 1000, 1000),
    100,
    100,
    "viewport",
  );

  expect(visibleCells(canvas)).toEqual({
    left: 10,
    top: 4,
    right: 49,
    bottom: 64,
  });
});

test("a canvas fit to the viewport and wholly on screen is visible whole", () => {
  smallViewport(new DOMRect(0, 0, 1000, 1000));
  const canvas = canvasAt(new DOMRect(100, 100, 200, 100), 100, 50, "viewport");

  expect(visibleCells(canvas)).toEqual({
    left: 0,
    top: 0,
    right: 100,
    bottom: 50,
  });
});

test("an unmeasured canvas fit to the viewport counts as visible whole", () => {
  const canvas = canvasAt(new DOMRect(0, 0, 0, 0), 100, 50, "viewport");

  expect(visibleCells(canvas)).toEqual({
    left: 0,
    top: 0,
    right: 100,
    bottom: 50,
  });
});

test("the viewport probe is made once, and again only once a page swap drops it", () => {
  const canvas = canvasAt(new DOMRect(0, 0, 100, 50), 100, 50, "viewport");
  visibleCells(canvas);
  visibleCells(canvas);
  expect(document.body.children).toHaveLength(1);

  document.body.replaceChildren();
  visibleCells(canvas);
  expect(document.body.children).toHaveLength(1);
});

test("a design cell as wide as the canvas's pixel scales by 1", () => {
  expect(cellScale(1440 / 160, 160)).toBe(1);
});

test("halving the cell width doubles the pixels a design size spans", () => {
  expect(cellScale(6, 240)).toBe(1);
  expect(cellScale(6, 480)).toBe(2);
});

test("sameRect compares every edge", () => {
  const rect = { left: 0, top: 1, right: 2, bottom: 3 };
  expect(sameRect(rect, { ...rect })).toBe(true);
  expect(sameRect(rect, { ...rect, bottom: 4 })).toBe(false);
});

function stepsOver(pace: ReturnType<typeof fixedStep>, frames: number[]) {
  let steps = 0;
  const count = () => (steps += 1);
  for (const now of frames) pace.advance(now, count);
  return steps;
}

test("a fixed step runs the same steps whatever the frame rate", () => {
  const frames = (gap: number) =>
    Array.from({ length: Math.round(1000 / gap) + 1 }, (_, i) => i * gap);

  const at60 = stepsOver(fixedStep(10, 100), frames(20));
  const at120 = stepsOver(fixedStep(10, 100), frames(5));

  expect(at60).toBe(at120);
});

test("a fixed step runs one step on its first frame and after a restart", () => {
  const pace = fixedStep(10, 100);

  expect(stepsOver(pace, [5000])).toBe(1);
  pace.restart();
  expect(stepsOver(pace, [9000])).toBe(1);
});

test("a fixed step catches up no more than its cap after a long pause", () => {
  const pace = fixedStep(10, 100);
  pace.advance(0, () => {});

  expect(stepsOver(pace, [60_000])).toBe(10);
});

function spyFrames() {
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
  });
  return vi.spyOn(window, "requestAnimationFrame");
}

test("a frame loop asks for frames only while its step returns true", () => {
  const frames = spyFrames();
  let left = 3;
  const loop = frameLoop(() => (left -= 1) > 0);

  loop.wake();
  vi.advanceTimersByTime(1000);

  expect(left).toBe(0);
  expect(frames).toHaveBeenCalledTimes(3);
});

test("a frame loop's step gets the frame's time", () => {
  spyFrames();
  const times: number[] = [];
  const loop = frameLoop((now) => {
    times.push(now);
    return false;
  });

  loop.wake();
  vi.advanceTimersByTime(16);

  expect(times).toEqual([16]);
});

test("waking a frame loop with a frame pending asks for no other", () => {
  const frames = spyFrames();
  const loop = frameLoop(() => false);

  loop.wake();
  loop.wake();
  expect(frames).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(16);
  loop.wake();
  expect(frames).toHaveBeenCalledTimes(2);
});

test("a step that wakes its own loop and goes on still has one frame pending", () => {
  const frames = spyFrames();
  let left = 2;
  const loop = frameLoop(() => {
    loop.wake();
    return (left -= 1) > 0;
  });

  loop.wake();
  vi.advanceTimersByTime(16);

  expect(frames).toHaveBeenCalledTimes(2);
});

test("a step that wakes its own loop and returns false still gets one more frame", () => {
  spyFrames();
  let woken = false;
  const step = vi.fn(() => {
    if (!woken) loop.wake();
    woken = true;
    return false;
  });
  const loop = frameLoop(step);

  loop.wake();
  vi.advanceTimersByTime(1000);

  expect(step).toHaveBeenCalledTimes(2);
});

test("a stop inside a step has no frame to cancel, so the step's return still decides", () => {
  spyFrames();
  let left = 3;
  const step = vi.fn(() => {
    loop.stop();
    return (left -= 1) > 0;
  });
  const loop = frameLoop(step);

  loop.wake();
  vi.advanceTimersByTime(1000);

  expect(step).toHaveBeenCalledTimes(3);
});

test("stopping a frame loop cancels its pending frame", () => {
  spyFrames();
  const step = vi.fn(() => true);
  const loop = frameLoop(step);

  loop.wake();
  loop.stop();
  vi.advanceTimersByTime(1000);

  expect(step).not.toHaveBeenCalled();
});

test("a stopped frame loop starts again when woken", () => {
  const frames = spyFrames();
  const loop = frameLoop(() => false);

  loop.wake();
  loop.stop();
  loop.wake();

  expect(frames).toHaveBeenCalledTimes(2);
});

test("a frame loop asks for every frame with the same callback, so it allocates none per frame", () => {
  const frames = spyFrames();
  let left = 3;
  const loop = frameLoop(() => (left -= 1) > 0);

  loop.wake();
  vi.advanceTimersByTime(1000);

  const callbacks = new Set(frames.mock.calls.map(([callback]) => callback));
  expect(callbacks.size).toBe(1);
});
