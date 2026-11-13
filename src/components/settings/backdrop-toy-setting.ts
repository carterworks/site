import {
  nextInRotation,
  storedChoice,
  storeChoice,
} from "../../lib/cycle-setting";
import { TOYS } from "../backdrop-toys";

export const TOY_KEY = "backdrop-mode";

export const RANDOM = "random";
const IDS = TOYS.map((toy) => toy.id);

const stored = () => storedChoice(TOY_KEY, IDS);

/**
 * Picks a random toy on every page load and navigation unless one is stored.
 * `astro:page-load` fires for both; the backdrop is persisted across swaps so
 * its toy would otherwise stay put. Random is offered once a toy is stored,
 * and stays offered after choosing it until the next full load.
 */
export function createBackdropToy(
  random = Math.random,
  events: EventTarget = document,
) {
  let offerRandom = stored() !== undefined;
  let last: string | undefined;

  const show = (id: string) => {
    last = id;
    document.querySelector("pixel-backdrop")?.setToy(id);
  };

  const showRandom = () => {
    const others = IDS.filter((id) => id !== last);
    const options = others.length > 0 ? others : IDS;
    show(options[Math.floor(random() * options.length)]);
  };

  const current = () => stored() ?? (offerRandom ? RANDOM : (last ?? IDS[0]));

  events.addEventListener("astro:page-load", () => {
    const id = stored();
    if (id) show(id);
    else showRandom();
  });

  const choose = (id: string) => {
    if (id === RANDOM) {
      storeChoice(TOY_KEY);
      showRandom();
    } else {
      storeChoice(TOY_KEY, id);
      show(id);
    }
    offerRandom = true;
  };

  return {
    /** The stored toy's id, `RANDOM`, or the toy on show. */
    value: current,
    label() {
      const id = current();
      return TOYS.find((toy) => toy.id === id)?.label ?? "Random";
    },
    choose,
    cycle() {
      choose(nextInRotation(IDS, current(), offerRandom ? RANDOM : undefined));
    },
  };
}
