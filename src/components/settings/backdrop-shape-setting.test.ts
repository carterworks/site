import { beforeEach, expect, test, vi } from "vitest";
import { createBackdropShape, SHAPE_KEY } from "./backdrop-shape-setting";
import { RANDOM } from "./backdrop-toy-setting";
import { SHAPES } from "../../../packages/pixel-backdrop/src/emulated-canvas/presenter";

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

test("with nothing stored, the row marks the shape on show as random", () => {
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0.5), events);
  load(events);

  expect(shape.label()).toBe("Hex (random)");
});

test("the first activation stores the random shape without changing it", () => {
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0.5), events);
  load(events);

  shape.cycle();

  expect(localStorage.getItem(SHAPE_KEY)).toBe(SHAPES[4]);
  expect(shown()).toBe(SHAPES[4]);
  expect(shape.label()).toBe("Hex");
});

test("activating a stored shape stores the next and draws it", () => {
  localStorage.setItem(SHAPE_KEY, SHAPES[0]);
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0), events);
  load(events);

  shape.cycle();

  expect(localStorage.getItem(SHAPE_KEY)).toBe(SHAPES[1]);
  expect(shown()).toBe(SHAPES[1]);
  expect(shape.label()).toBe("Circle");
});

test("after the last stored shape comes Random, which reads as random", () => {
  localStorage.setItem(SHAPE_KEY, SHAPES.at(-1)!);
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0), events);
  load(events);

  shape.cycle();

  expect(localStorage.getItem(SHAPE_KEY)).toBeNull();
  expect(shown()).toBe(SHAPES[0]);
  expect(shape.label()).toBe("Square (random)");
});

test("choosing Random clears storage and draws a different shape for the visit", () => {
  localStorage.setItem(SHAPE_KEY, SHAPES[0]);
  sessionStorage.setItem(SHAPE_KEY, SHAPES[0]);
  const events = new EventTarget();
  const shape = createBackdropShape(fixedRandom(0), events);
  load(events);

  shape.choose(RANDOM);

  expect(localStorage.getItem(SHAPE_KEY)).toBeNull();
  expect(shown()).toBe(SHAPES[1]);
  expect(sessionStorage.getItem(SHAPE_KEY)).toBe(SHAPES[1]);
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
  shape.cycle();

  expect(shown()).toBe(SHAPES[1]);
});
