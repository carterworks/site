import { nextInRotation, storeChoice } from "../../lib/cycle-setting";
import {
  DISPLAYS,
  DISPLAY_KEY,
  storedDisplay,
} from "../pixel-backdrop/backdrop-displays";

const [SITE] = DISPLAYS;
const IDS = DISPLAYS.map((display) => display.id);

/**
 * The backdrop applies a stored display itself when it attaches. Nothing
 * stored means the site's own look, which is also the reset: choosing it
 * clears the store.
 */
export function createBackdropDisplay() {
  let last: string | undefined;

  const current = () => storedDisplay() ?? last ?? SITE.id;

  const choose = (id: string) => {
    storeChoice(DISPLAY_KEY, id === SITE.id ? undefined : id);
    last = id;
    document.querySelector("pixel-backdrop")?.setDisplay(id);
  };

  return {
    /** The id of the display on show. */
    value: current,
    label() {
      return DISPLAYS.find((display) => display.id === current())!.label;
    },
    choose,
    cycle() {
      choose(nextInRotation(IDS, current()));
    },
  };
}
