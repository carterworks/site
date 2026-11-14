import {
  nextInRotation,
  storedChoice,
  storeChoice,
} from "../../lib/cycle-setting";
import { TOYS } from "../backdrop-toys";

export const TOY_KEY = "backdrop-mode";

const IDS = TOYS.map((toy) => toy.id);

/**
 * Every page load and navigation draws a random toy, never the one on show;
 * `astro:page-load` fires for both, and the backdrop is persisted across swaps
 * so its toy would otherwise stay put. A stored toy overrides it, and a choice
 * that lands on the page's random toy clears the store instead, so the random
 * default stays reachable without a Random entry, as the theme toggle's OS
 * scheme does.
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

  events.addEventListener("astro:page-load", () => {
    const others = IDS.filter((id) => id !== current());
    const options = drawn === undefined || others.length === 0 ? IDS : others;
    drawn = options[Math.floor(random() * options.length)];
    show();
  });

  const choose = (id: string) => {
    if (!IDS.includes(id)) return;
    chosen = id === drawn ? undefined : id;
    storeChoice(TOY_KEY, chosen);
    show();
  };

  return {
    value: current,
    label() {
      const id = current();
      return TOYS.find((toy) => toy.id === id)?.label ?? id;
    },
    choose,
    cycle() {
      choose(nextInRotation(IDS, current()));
    },
  };
}
