import {
  nextInRotation,
  storedChoice,
  storeChoice,
} from "../../lib/cycle-setting";
import { RANDOM } from "./backdrop-toy-setting";

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
 * navigations keep it until the tab closes, and the row marks it as random.
 * The first activation stores that shape as it is; then each one stores the
 * next, and Random, after the last, clears the store and draws afresh.
 */
export function createBackdropShape(
  random = Math.random,
  events: EventTarget = document,
) {
  let chosen = storedChoice(SHAPE_KEY, SHAPES);
  let visits = storedChoice(SHAPE_KEY, SHAPES, "sessionStorage");
  const current = () => chosen ?? visits ?? SHAPES[0];

  const draw = (from: readonly (typeof SHAPES)[number][]) => {
    visits = from[Math.floor(random() * from.length)];
    storeChoice(SHAPE_KEY, visits, "sessionStorage");
  };
  if (visits === undefined) draw(SHAPES);

  const show = () =>
    document.querySelector("pixel-backdrop")?.configure({ shape: current() });

  events.addEventListener("astro:page-load", show);

  const choose = (id: string) => {
    if (id === RANDOM) {
      draw(SHAPES.filter((shape) => shape !== current()));
      chosen = undefined;
    } else {
      const shape = SHAPES.find((known) => known === id);
      if (shape === undefined) return;
      chosen = shape;
    }
    storeChoice(SHAPE_KEY, chosen);
    show();
  };

  return {
    value: current,
    label() {
      const id = current();
      const name = id[0].toUpperCase() + id.slice(1);
      return chosen ? name : `${name} (random)`;
    },
    choose,
    cycle() {
      if (!chosen) return choose(current());
      choose(nextInRotation<string>([...SHAPES, RANDOM], current()));
    },
  };
}
