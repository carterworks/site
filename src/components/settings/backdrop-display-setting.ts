import {
  nextInRotation,
  storedChoice,
  storeChoice,
} from "../../lib/cycle-setting";
import {
  type Display,
  DISPLAYS,
  displayKey,
  displaysFor,
  showDisplay,
  shownDisplay,
  shownScheme,
} from "../pixel-backdrop/backdrop-displays";
import { RANDOM } from "./backdrop-toy-setting";

/**
 * Each scheme has its own display, held on `<html>` (set by the head script
 * before paint), so a light screen never shows in dark. Nothing stored means
 * the display this visit drew at random, which the head script keeps in
 * session storage. Random, offered only while a display is stored, clears the
 * store and draws afresh. Without a `scheme`, it is the shown scheme's
 * display.
 */
export function createBackdropDisplay({
  root = document.documentElement,
  scheme,
  random = Math.random,
}: {
  root?: HTMLElement;
  scheme?: Display["scheme"];
  random?: () => number;
} = {}) {
  const shown = () => scheme ?? shownScheme(root);
  const current = () => shownDisplay(root, shown());
  const stored = () =>
    storedChoice(
      displayKey(shown()),
      displaysFor(shown()).map((display) => display.id),
    );

  const choices = (): readonly Pick<Display, "id" | "label">[] =>
    stored()
      ? [...displaysFor(shown()), { id: RANDOM, label: "Random" }]
      : displaysFor(shown());

  const drawAnother = () => {
    const others = displaysFor(shown()).filter(
      (display) => display !== current(),
    );
    const drawn = others[Math.floor(random() * others.length)];
    showDisplay(root, drawn);
    storeChoice(displayKey(drawn.scheme), drawn.id, "sessionStorage");
    storeChoice(displayKey(drawn.scheme));
  };

  const choose = (id: string) => {
    if (id === RANDOM) return drawAnother();
    const display = DISPLAYS.find((candidate) => candidate.id === id);
    if (display === undefined) return;
    showDisplay(root, display);
    storeChoice(displayKey(display.scheme), id);
  };

  return {
    /** The id of the display on show. */
    value: () => current().id,
    label: () => current().label,
    /** The shown scheme's displays in menu order, and Random while one is stored. */
    choices,
    choose,
    cycle() {
      const ids = choices().map((display) => display.id);
      choose(nextInRotation(ids, current().id));
    },
  };
}
