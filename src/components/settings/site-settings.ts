import { createBackdropDisplay } from "./backdrop-display-setting";
import { createBackdropShape } from "./backdrop-shape-setting";
import { createBackdropToy } from "./backdrop-toy-setting";
import { createThemeSetting } from "./theme-setting";
import { displayAttribute } from "../pixel-backdrop/backdrop-displays";

// Module-level so a ClientRouter swap, which recreates the element, keeps
// which reset entries are on offer; only a full reload forgets them.
export const settings = {
  theme: createThemeSetting(),
  backdrop: createBackdropToy(),
  display: createBackdropDisplay(),
  lightDisplay: createBackdropDisplay({ scheme: "light" }),
  darkDisplay: createBackdropDisplay({ scheme: "dark" }),
  shape: createBackdropShape(),
};

// ClientRouter resets <html>'s attributes (inline style included) on every
// swap; setting them on the incoming document avoids a frame of the OS scheme
// and the site's own look.
document.addEventListener("astro:before-swap", (event) => {
  const { newDocument } = event as Event & { newDocument: Document };
  const from = document.documentElement;
  const to = newDocument.documentElement;
  to.style.colorScheme = from.style.colorScheme;
  for (const name of [displayAttribute("light"), displayAttribute("dark")]) {
    const id = from.getAttribute(name);
    if (id === null) to.removeAttribute(name);
    else to.setAttribute(name, id);
  }
});
