import { nextInRotation, storeChoice } from "../../lib/cycle-setting";
import {
  DISPLAYS,
  displayKey,
  displaysFor,
  showDisplay,
  shownDisplay,
  shownScheme,
} from "../pixel-backdrop/backdrop-displays";

/**
 * Each scheme has its own display, held on `<html>` (set from storage by the
 * head script before paint), so a light screen never shows in dark. Nothing
 * stored means the scheme's site look, which is also the reset: choosing it
 * clears the store.
 */
export function createBackdropDisplay(root = document.documentElement) {
  const choices = () => displaysFor(shownScheme(root));
  const current = () => shownDisplay(root, shownScheme(root));

  const choose = (id: string) => {
    const display = DISPLAYS.find((candidate) => candidate.id === id);
    if (display === undefined) return;
    showDisplay(root, display);
    const [site] = displaysFor(display.scheme);
    storeChoice(displayKey(display.scheme), display === site ? undefined : id);
  };

  return {
    /** The id of the display on show. */
    value: () => current().id,
    label: () => current().label,
    /** The displays the shown scheme offers, in menu order. */
    choices,
    choose,
    cycle() {
      const ids = choices().map((display) => display.id);
      choose(nextInRotation(ids, current().id));
    },
  };
}
