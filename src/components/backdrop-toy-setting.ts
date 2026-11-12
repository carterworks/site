import {
  nextInRotation,
  storedChoice,
  storeChoice,
} from "../lib/cycle-setting";
import { MODES } from "./backdrop-toys";

export const MODE_KEY = "backdrop-mode";

export const RANDOM = "random";
const IDS = MODES.map((mode) => mode.id);

const stored = () => storedChoice(MODE_KEY, IDS);

/**
 * Picks a random mode on every page load and navigation unless one is stored.
 * `astro:page-load` fires for both; the backdrop is persisted across swaps so
 * its mode would otherwise stay put. Random is offered once a mode is stored,
 * and stays offered after choosing it until the next full load.
 */
export function createBackdropMode(
  random = Math.random,
  events: EventTarget = document,
) {
  let offerRandom = stored() !== undefined;
  let last: string | undefined;

  const show = (id: string) => {
    last = id;
    document.querySelector("pixel-backdrop")?.setMode(id);
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
      storeChoice(MODE_KEY);
      showRandom();
    } else {
      storeChoice(MODE_KEY, id);
      show(id);
    }
    offerRandom = true;
  };

  return {
    /** The stored mode's id, `RANDOM`, or the mode on show. */
    value: current,
    label() {
      const id = current();
      return MODES.find((mode) => mode.id === id)?.label ?? "Random";
    },
    choose,
    cycle() {
      choose(nextInRotation(IDS, current(), offerRandom ? RANDOM : undefined));
    },
  };
}
