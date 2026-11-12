import { nextInRotation, storeChoice } from "../lib/cycle-setting";
import { DISPLAYS, DISPLAY_KEY, storedDisplay } from "./backdrop-displays";

const [SITE, ...THEMED] = DISPLAYS;
const THEMED_IDS = THEMED.map((display) => display.id);

/**
 * The backdrop applies a stored display itself when it attaches. Nothing
 * stored means the site's own look, which is also the reset: it joins the
 * rotation once a display is stored, and stays until the next full load.
 */
export function createBackdropDisplay() {
  let offerSite = storedDisplay() !== undefined;
  let last: string | undefined;

  const current = () => storedDisplay() ?? last ?? SITE.id;

  return {
    label() {
      return DISPLAYS.find((display) => display.id === current())!.label;
    },
    cycle() {
      const next = nextInRotation(
        THEMED_IDS,
        current(),
        offerSite ? SITE.id : undefined,
      );
      storeChoice(DISPLAY_KEY, next === SITE.id ? undefined : next);
      offerSite = true;
      last = next;
      document.querySelector("pixel-backdrop")?.setDisplay(next);
    },
  };
}
