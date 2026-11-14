import {
  nextInRotation,
  storedChoice,
  storeChoice,
} from "../../lib/cycle-setting";

export const SHAPE_KEY = "backdrop-shape";

/** The canvas's shapes, default first; a test holds it to the canvas's own list. */
export const SHAPES = [
  "square",
  "circle",
  "ring",
  "diamond",
  "hex",
  "triangle",
  "dash",
  "slash",
  "cross",
] as const;

/**
 * Each visit draws a random shape, kept in session storage so reloads and
 * navigations keep it until the tab closes. A stored shape overrides it, and
 * a choice that lands on the visit's shape clears the store instead, so the
 * random default stays reachable without a Random entry, as the theme
 * toggle's OS scheme does.
 */
export function createBackdropShape(
  random = Math.random,
  events: EventTarget = document,
) {
  let visits = storedChoice(SHAPE_KEY, SHAPES, "sessionStorage");
  if (visits === undefined) {
    visits = SHAPES[Math.floor(random() * SHAPES.length)];
    storeChoice(SHAPE_KEY, visits, "sessionStorage");
  }

  let chosen = storedChoice(SHAPE_KEY, SHAPES);
  const current = () => chosen ?? visits;

  const show = () =>
    document.querySelector("pixel-backdrop")?.configure({ shape: current() });

  events.addEventListener("astro:page-load", show);

  const choose = (id: string) => {
    const shape = SHAPES.find((known) => known === id);
    if (shape === undefined) return;
    chosen = shape === visits ? undefined : shape;
    storeChoice(SHAPE_KEY, chosen);
    show();
  };

  return {
    value: current,
    label() {
      const id = current();
      return id[0].toUpperCase() + id.slice(1);
    },
    choose,
    cycle() {
      choose(nextInRotation(SHAPES, current()));
    },
  };
}
