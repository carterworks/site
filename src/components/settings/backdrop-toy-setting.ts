import {
  nextInRotation,
  storedChoice,
  storeChoice,
} from "../../lib/cycle-setting";
import { TOYS } from "../backdrop-toys";

export const TOY_KEY = "backdrop-mode";

export const RANDOM = "random";
const IDS = TOYS.map((toy) => toy.id);

/**
 * Every page load and navigation draws a random toy, never the one on show;
 * `astro:page-load` fires for both, and the backdrop is persisted across swaps
 * so its toy would otherwise stay put. The row marks a drawn toy as random,
 * and the first activation stores it as it is; then each one stores the next,
 * and Random, offered only while one is stored, clears the store and draws
 * afresh.
 */
export function createBackdropToy(
  random = Math.random,
  events: EventTarget = document,
) {
  let chosen = storedChoice(TOY_KEY, IDS);
  let drawn: string | undefined;

  const current = () => chosen ?? drawn ?? IDS[0];
  const show = () =>
    document.querySelector("pixel-backdrop")?.setToy(current());

  const others = () => {
    const rest = IDS.filter((id) => id !== current());
    return rest.length > 0 ? rest : IDS;
  };
  const draw = (from: string[]) => {
    drawn = from[Math.floor(random() * from.length)];
  };

  events.addEventListener("astro:page-load", () => {
    draw(drawn === undefined ? IDS : others());
    show();
  });

  const choices = () => (chosen ? [...IDS, RANDOM] : IDS);

  const choose = (id: string) => {
    if (id === RANDOM) {
      draw(others());
      chosen = undefined;
    } else if (IDS.includes(id)) {
      chosen = id;
    } else return;
    storeChoice(TOY_KEY, chosen);
    show();
  };

  return {
    value: current,
    label() {
      const id = current();
      const label = TOYS.find((toy) => toy.id === id)?.label ?? id;
      return chosen ? label : `${label} (random)`;
    },
    /** The toys in rotation order, and Random while a toy is stored. */
    choices,
    choose,
    cycle() {
      if (!chosen) return choose(current());
      choose(nextInRotation(choices(), current()));
    },
  };
}
