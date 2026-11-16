import type { PixelBackdrop } from "@carterworks/pixel-backdrop";
import {
  displayAttribute,
  shownDisplay,
  shownScheme,
} from "./backdrop-displays";

/**
 * The theme follows these on `<html>`. The theme toggle and the display
 * setting emit no event, and ClientRouter navigations reset `<html>`'s
 * attributes, so the attributes are the one reliable signal.
 */
const WATCHED = ["style", displayAttribute("light"), displayAttribute("dark")];

/** Shows the backdrop the theme on `<html>`, now and whenever it changes. */
export function followDisplay(backdrop: PixelBackdrop) {
  const root = document.documentElement;
  const show = () => {
    backdrop.display = shownDisplay(root, shownScheme(root));
  };
  show();
  new MutationObserver(show).observe(root, { attributeFilter: WATCHED });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", show);
}

// Runs as the module loads, before the element is defined, so the element
// upgrades already holding the theme and its first frame is in it.
const backdrop = document.querySelector("pixel-backdrop");
if (backdrop !== null) followDisplay(backdrop);
