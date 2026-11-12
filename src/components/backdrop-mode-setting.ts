import {
  nextInRotation,
  storedChoice,
  storeChoice,
} from "../lib/cycle-setting";
import { MODES } from "./backdrop-modes";

export const MODE_KEY = "backdrop-mode";

const RANDOM = "random";
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

  return {
    label() {
      const id = current();
      return MODES.find((mode) => mode.id === id)?.label ?? "Random";
    },
    cycle() {
      const next = nextInRotation(
        IDS,
        current(),
        offerRandom ? RANDOM : undefined,
      );
      if (next === RANDOM) {
        storeChoice(MODE_KEY);
        showRandom();
        return;
      }
      storeChoice(MODE_KEY, next);
      offerRandom = true;
      show(next);
    },
  };
}
