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

type PixelShape = (typeof SHAPES)[number];

const stored = () => storedChoice(SHAPE_KEY, SHAPES);
const visits = () => storedChoice(SHAPE_KEY, SHAPES, "sessionStorage");

/**
 * Unless a shape is stored, each visit draws a random one, kept in session
 * storage so reloads and navigations keep it until the tab closes. Random is
 * offered once a shape is stored, as the toy's is.
 */
export function createBackdropShape(
  random = Math.random,
  events: EventTarget = document,
) {
  let offerRandom = stored() !== undefined;

  const pick = (from: readonly PixelShape[]) => {
    const picked = from[Math.floor(random() * from.length)];
    storeChoice(SHAPE_KEY, picked, "sessionStorage");
    return picked;
  };

  let shown = stored() ?? visits() ?? pick(SHAPES);

  const show = () =>
    document.querySelector("pixel-backdrop")?.configure({ shape: shown });

  const current = () => stored() ?? (offerRandom ? RANDOM : shown);

  events.addEventListener("astro:page-load", show);

  const choose = (id: string) => {
    if (id === RANDOM) {
      storeChoice(SHAPE_KEY);
      shown = pick(SHAPES.filter((shape) => shape !== shown));
    } else if (SHAPES.includes(id as PixelShape)) {
      storeChoice(SHAPE_KEY, id);
      shown = id as PixelShape;
    } else return;
    offerRandom = true;
    show();
  };

  return {
    /** The stored shape, `RANDOM`, or the shape on show. */
    value: current,
    label() {
      const id = current();
      return id === RANDOM ? "Random" : id[0].toUpperCase() + id.slice(1);
    },
    choose,
    cycle() {
      choose(
        nextInRotation<string>(
          SHAPES,
          current(),
          offerRandom ? RANDOM : undefined,
        ),
      );
    },
  };
}
