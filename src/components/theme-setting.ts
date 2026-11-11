import { nextInRotation } from "../lib/cycle-setting";
import { osScheme, saveScheme, type Scheme } from "../lib/color-scheme";

const SCHEMES: Scheme[] = ["light", "dark"];
const SYSTEM = "system";

/**
 * The inline colorScheme (set from storage by the head script before paint) is
 * the stored value; empty means follow the OS. System is offered once a value
 * is stored, and stays offered after choosing it until the next full load.
 */
export function createThemeSetting(root = document.documentElement) {
  let offerSystem = root.style.colorScheme !== "";

  const current = () =>
    (root.style.colorScheme || (offerSystem ? SYSTEM : osScheme())) as
      | Scheme
      | typeof SYSTEM;

  return {
    label() {
      const value = current();
      return value[0].toUpperCase() + value.slice(1);
    },
    cycle() {
      const next = nextInRotation(
        SCHEMES,
        current(),
        offerSystem ? SYSTEM : undefined,
      );
      if (next === SYSTEM) {
        saveScheme(root, null);
        return;
      }
      saveScheme(root, next);
      offerSystem = true;
    },
  };
}
