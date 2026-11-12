import { beforeEach, expect, test, vi } from "vitest";
import { createBackdropMode } from "./backdrop-mode-setting";
import { MODES } from "./backdrop-modes";

vi.mock("./backdrop-modes", () => ({
  MODES: ["one", "two", "three"].map((id) => ({ id, label: id.toUpperCase() })),
}));

const setMode = vi.fn();

function fixedRandom(...values: number[]) {
  const queue = [...values];
  return () => queue.shift() ?? 0;
}

beforeEach(() => {
  localStorage.clear();
  setMode.mockClear();
  document.body.innerHTML = "<pixel-backdrop></pixel-backdrop>";
  Object.assign(document.querySelector("pixel-backdrop")!, { setMode });
});

test("applies a random mode on each page load with nothing stored", () => {
  const events = new EventTarget();
  createBackdropMode(fixedRandom(0, 0.99), events);

  events.dispatchEvent(new Event("astro:page-load"));

  expect(setMode).toHaveBeenLastCalledWith(MODES[0].id);
  expect(localStorage.getItem("backdrop-mode")).toBeNull();
});

test("a navigation never repeats the previous mode", () => {
  const events = new EventTarget();
  const backdrop = createBackdropMode(fixedRandom(0, 0, 0), events);

  events.dispatchEvent(new Event("astro:page-load"));
  events.dispatchEvent(new Event("astro:page-load"));
  events.dispatchEvent(new Event("astro:page-load"));

  expect(setMode.mock.calls.map(([id]) => id)).toEqual([
    MODES[0].id,
    MODES[1].id,
    MODES[0].id,
  ]);
  expect(backdrop.label()).toBe(MODES[0].label);
});

test("activating stores the next mode and applies it", () => {
  const events = new EventTarget();
  const backdrop = createBackdropMode(fixedRandom(0), events);
  events.dispatchEvent(new Event("astro:page-load"));

  backdrop.cycle();

  expect(localStorage.getItem("backdrop-mode")).toBe(MODES[1].id);
  expect(setMode).toHaveBeenLastCalledWith(MODES[1].id);
  expect(backdrop.label()).toBe(MODES[1].label);
});

test("a stored mode replaces random on load and navigation", () => {
  localStorage.setItem("backdrop-mode", MODES[2].id);
  const events = new EventTarget();
  const backdrop = createBackdropMode(fixedRandom(0), events);

  events.dispatchEvent(new Event("astro:page-load"));
  events.dispatchEvent(new Event("astro:page-load"));

  expect(setMode.mock.calls.map(([id]) => id)).toEqual([
    MODES[2].id,
    MODES[2].id,
  ]);
  expect(backdrop.label()).toBe(MODES[2].label);
});

test("Random follows the last mode, clears storage and applies a different mode", () => {
  const events = new EventTarget();
  const backdrop = createBackdropMode(fixedRandom(0), events);
  events.dispatchEvent(new Event("astro:page-load"));
  for (let step = 0; step < MODES.length; step++) backdrop.cycle();
  expect(backdrop.label()).toBe("Random");
  expect(localStorage.getItem("backdrop-mode")).toBeNull();

  const shown = setMode.mock.calls.at(-1)![0];
  expect(shown).not.toBe(MODES.at(-1)!.id);
  events.dispatchEvent(new Event("astro:page-load"));
  expect(backdrop.label()).toBe("Random");
});

test("Random is gone after a reload with nothing stored", () => {
  const events = new EventTarget();
  const backdrop = createBackdropMode(fixedRandom(0), events);
  events.dispatchEvent(new Event("astro:page-load"));
  for (let step = 0; step < MODES.length; step++) backdrop.cycle();

  const reloaded = createBackdropMode(fixedRandom(0), new EventTarget());

  reloaded.cycle();
  expect(reloaded.label()).not.toBe("Random");
  expect(localStorage.getItem("backdrop-mode")).not.toBeNull();
});

test("ignores a stored id that is no longer a mode", () => {
  localStorage.setItem("backdrop-mode", "gone");
  const events = new EventTarget();
  createBackdropMode(fixedRandom(0), events);

  events.dispatchEvent(new Event("astro:page-load"));

  expect(setMode).toHaveBeenLastCalledWith(MODES[0].id);
});

test("with a single mode, every navigation shows it", async () => {
  vi.resetModules();
  vi.doMock("./backdrop-modes", () => ({
    MODES: [{ id: "only", label: "Only" }],
  }));
  const { createBackdropMode } = await import("./backdrop-mode-setting");
  const events = new EventTarget();
  createBackdropMode(fixedRandom(0, 0), events);

  events.dispatchEvent(new Event("astro:page-load"));
  events.dispatchEvent(new Event("astro:page-load"));

  expect(setMode.mock.calls.map(([id]) => id)).toEqual(["only", "only"]);
  vi.doUnmock("./backdrop-modes");
});
