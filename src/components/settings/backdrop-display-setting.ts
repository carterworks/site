import { nextInRotation, storeChoice } from "../../lib/cycle-setting";
import { DISPLAYS, DISPLAY_KEY, storedDisplay } from "../backdrop-displays";

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

  return {
    label() {
      return DISPLAYS.find((display) => display.id === current())!.label;
    },
    cycle() {
      const next = nextInRotation(IDS, current());
      storeChoice(DISPLAY_KEY, next === SITE.id ? undefined : next);
      last = next;
      document.querySelector("pixel-backdrop")?.setDisplay(next);
    },
  };
}
