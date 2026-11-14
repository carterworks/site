import { beforeEach, expect, test, vi } from "vitest";
import { createBackdropToy, TOY_KEY } from "./backdrop-toy-setting";
import { TOYS } from "../backdrop-toys";

vi.mock("../backdrop-toys", () => ({
  TOYS: ["one", "two", "three"].map((id) => ({ id, label: id.toUpperCase() })),
}));

const setToy = vi.fn();

function fixedRandom(...values: number[]) {
  const queue = [...values];
  return () => queue.shift() ?? 0;
}

beforeEach(() => {
  localStorage.clear();
  setToy.mockClear();
  document.body.innerHTML = "<pixel-backdrop></pixel-backdrop>";
  Object.assign(document.querySelector("pixel-backdrop")!, { setToy });
});

test("the storage key keeps its old name, so a saved choice survives", () => {
  expect(TOY_KEY).toBe("backdrop-mode");
});

test("applies a random toy on each page load with nothing stored", () => {
  const events = new EventTarget();
  createBackdropToy(fixedRandom(0, 0.99), events);

  events.dispatchEvent(new Event("astro:page-load"));

  expect(setToy).toHaveBeenLastCalledWith(TOYS[0].id);
  expect(localStorage.getItem("backdrop-mode")).toBeNull();
});

test("a navigation never repeats the previous toy", () => {
  const events = new EventTarget();
  const backdrop = createBackdropToy(fixedRandom(0, 0, 0), events);

  events.dispatchEvent(new Event("astro:page-load"));
  events.dispatchEvent(new Event("astro:page-load"));
  events.dispatchEvent(new Event("astro:page-load"));

  expect(setToy.mock.calls.map(([id]) => id)).toEqual([
    TOYS[0].id,
    TOYS[1].id,
    TOYS[0].id,
  ]);
  expect(backdrop.label()).toBe(TOYS[0].label);
});

test("activating stores the next toy and applies it", () => {
  const events = new EventTarget();
  const backdrop = createBackdropToy(fixedRandom(0), events);
  events.dispatchEvent(new Event("astro:page-load"));

  backdrop.cycle();

  expect(localStorage.getItem("backdrop-mode")).toBe(TOYS[1].id);
  expect(setToy).toHaveBeenLastCalledWith(TOYS[1].id);
  expect(backdrop.label()).toBe(TOYS[1].label);
});

test("a stored toy replaces random on load and navigation", () => {
  localStorage.setItem("backdrop-mode", TOYS[2].id);
  const events = new EventTarget();
  const backdrop = createBackdropToy(fixedRandom(0), events);

  events.dispatchEvent(new Event("astro:page-load"));
  events.dispatchEvent(new Event("astro:page-load"));

  expect(setToy.mock.calls.map(([id]) => id)).toEqual([TOYS[2].id, TOYS[2].id]);
  expect(backdrop.label()).toBe(TOYS[2].label);
});

test("cycling onto the page's random toy clears storage instead of storing it", () => {
  const events = new EventTarget();
  const backdrop = createBackdropToy(fixedRandom(0.5), events);
  events.dispatchEvent(new Event("astro:page-load"));
  expect(backdrop.value()).toBe(TOYS[1].id);

  backdrop.cycle();
  backdrop.cycle();
  expect(localStorage.getItem("backdrop-mode")).toBe(TOYS[0].id);

  backdrop.cycle();

  expect(backdrop.label()).toBe(TOYS[1].label);
  expect(setToy).toHaveBeenLastCalledWith(TOYS[1].id);
  expect(localStorage.getItem("backdrop-mode")).toBeNull();
  events.dispatchEvent(new Event("astro:page-load"));
  expect(setToy).not.toHaveBeenLastCalledWith(TOYS[1].id);
});

test("a stored toy still leaves the page's random toy to return to", () => {
  localStorage.setItem("backdrop-mode", TOYS[2].id);
  const events = new EventTarget();
  const backdrop = createBackdropToy(fixedRandom(0), events);
  events.dispatchEvent(new Event("astro:page-load"));

  backdrop.choose(TOYS[0].id);

  expect(localStorage.getItem("backdrop-mode")).toBeNull();
  expect(setToy).toHaveBeenLastCalledWith(TOYS[0].id);
});

test("offers only toys, never a Random entry", () => {
  const events = new EventTarget();
  const backdrop = createBackdropToy(fixedRandom(0), events);
  events.dispatchEvent(new Event("astro:page-load"));

  const labels = Array.from({ length: TOYS.length * 2 }, () => {
    backdrop.cycle();
    return backdrop.label();
  });

  expect(labels).not.toContain("Random");
  backdrop.choose("random");
  expect(backdrop.value()).toBe(TOYS[0].id);
});

test("keeps cycling when storage is blocked", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal("localStorage", {
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
  });
  const events = new EventTarget();
  const backdrop = createBackdropToy(fixedRandom(0), events);
  events.dispatchEvent(new Event("astro:page-load"));

  backdrop.cycle();

  expect(setToy).toHaveBeenLastCalledWith(TOYS[1].id);
  vi.unstubAllGlobals();
});

test("ignores a stored id that is no longer a toy", () => {
  localStorage.setItem("backdrop-mode", "fireflies");
  const events = new EventTarget();
  createBackdropToy(fixedRandom(0), events);

  events.dispatchEvent(new Event("astro:page-load"));

  expect(setToy).toHaveBeenLastCalledWith(TOYS[0].id);
});

test("with a single toy, every navigation shows it", async () => {
  vi.resetModules();
  vi.doMock("../backdrop-toys", () => ({
    TOYS: [{ id: "only", label: "Only" }],
  }));
  const { createBackdropToy } = await import("./backdrop-toy-setting");
  const events = new EventTarget();
  createBackdropToy(fixedRandom(0, 0), events);

  events.dispatchEvent(new Event("astro:page-load"));
  events.dispatchEvent(new Event("astro:page-load"));

  expect(setToy.mock.calls.map(([id]) => id)).toEqual(["only", "only"]);
  vi.doUnmock("../backdrop-toys");
});

test("choosing a toy stores and applies it", () => {
  const events = new EventTarget();
  const backdrop = createBackdropToy(fixedRandom(0), events);
  events.dispatchEvent(new Event("astro:page-load"));

  backdrop.choose(TOYS[2].id);

  expect(localStorage.getItem("backdrop-mode")).toBe(TOYS[2].id);
  expect(setToy).toHaveBeenLastCalledWith(TOYS[2].id);
  expect(backdrop.value()).toBe(TOYS[2].id);
});

test("with nothing stored, the value is the toy on show", () => {
  const events = new EventTarget();
  const backdrop = createBackdropToy(fixedRandom(0.5), events);

  events.dispatchEvent(new Event("astro:page-load"));

  expect(backdrop.value()).toBe(TOYS[1].id);
});
