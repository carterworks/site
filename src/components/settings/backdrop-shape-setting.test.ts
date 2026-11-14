import { beforeEach, expect, test, vi } from "vitest";
import { createBackdropShape, SHAPE_KEY } from "./backdrop-shape-setting";
import { SHAPES } from "../emulated-canvas/presenter";

const configure = vi.fn();

const fixedRandom =
  (...values: number[]) =>
  () =>
    values.shift() ?? 0;

const shown = () => configure.mock.lastCall?.[0].shape;

const load = (events: EventTarget) =>
  events.dispatchEvent(new Event("astro:page-load"));

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  configure.mockClear();
  document.body.innerHTML = "<pixel-backdrop></pixel-backdrop>";
  Object.assign(document.querySelector("pixel-backdrop")!, { configure });
});

test("picks a random shape for the visit, and keeps nothing past it", () => {
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0.5), events);

  load(events);

  expect(shown()).toBe(SHAPES[4]);
  expect(shape.value()).toBe(SHAPES[4]);
  expect(sessionStorage.getItem(SHAPE_KEY)).toBe(SHAPES[4]);
  expect(localStorage.getItem(SHAPE_KEY)).toBeNull();
});

test("the visit's shape survives reloads and navigations", () => {
  const events = new EventTarget();
  createBackdropShape(fixedRandom(0.5), events);
  load(events);

  const reloaded = new EventTarget();
  createBackdropShape(fixedRandom(0), reloaded);
  load(reloaded);
  load(reloaded);

  expect(configure.mock.calls.map(([knobs]) => knobs.shape)).toEqual(
    Array(3).fill(SHAPES[4]),
  );
});

test("a stored shape replaces the visit's", () => {
  sessionStorage.setItem(SHAPE_KEY, SHAPES[4]);
  localStorage.setItem(SHAPE_KEY, SHAPES[2]);
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0), events);

  load(events);

  expect(shown()).toBe(SHAPES[2]);
  expect(shape.value()).toBe(SHAPES[2]);
});

test("activating stores the next shape and draws it", () => {
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0), events);
  load(events);

  shape.cycle();

  expect(localStorage.getItem(SHAPE_KEY)).toBe(SHAPES[1]);
  expect(shown()).toBe(SHAPES[1]);
  expect(shape.label()).toBe("Circle");
});

test("cycling onto the visit's shape clears storage instead of storing it", () => {
  sessionStorage.setItem(SHAPE_KEY, SHAPES[1]);
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0), events);
  load(events);

  for (let step = 0; step < SHAPES.length - 1; step++) shape.cycle();
  expect(shape.value()).toBe(SHAPES[0]);
  expect(localStorage.getItem(SHAPE_KEY)).toBe(SHAPES[0]);

  shape.cycle();

  expect(shape.value()).toBe(SHAPES[1]);
  expect(shown()).toBe(SHAPES[1]);
  expect(localStorage.getItem(SHAPE_KEY)).toBeNull();
});

test("a stored shape still leaves a visit's shape to return to", () => {
  localStorage.setItem(SHAPE_KEY, SHAPES[0]);
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0.5), events);
  load(events);

  expect(sessionStorage.getItem(SHAPE_KEY)).toBe(SHAPES[4]);
  shape.choose(SHAPES[4]);

  expect(localStorage.getItem(SHAPE_KEY)).toBeNull();
  expect(shape.label()).toBe("Hex");
});

test("offers only shapes, never a Random entry", () => {
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0), events);
  load(events);

  const labels = Array.from({ length: SHAPES.length * 2 }, () => {
    shape.cycle();
    return shape.label();
  });

  expect(labels).not.toContain("Random");
  shape.choose("random");
  expect(shape.value()).toBe(SHAPES[0]);
});

test("ignores a stored id that is no longer a shape", () => {
  localStorage.setItem(SHAPE_KEY, "star");
  sessionStorage.setItem(SHAPE_KEY, "star");
  const events = new EventTarget();
  createBackdropShape(fixedRandom(0), events);

  load(events);

  expect(shown()).toBe(SHAPES[0]);
});

test("still draws a shape when storage is blocked", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  const storage = { getItem: blocked, setItem: blocked, removeItem: blocked };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0), events);

  load(events);
  shape.cycle();

  expect(shown()).toBe(SHAPES[1]);
});
