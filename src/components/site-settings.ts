import { createBackdropMode } from "./backdrop-mode-setting";
import { createThemeSetting } from "./theme-setting";

// Module-level so a ClientRouter swap, which recreates the element, keeps
// which reset entries are on offer; only a full reload forgets them.
export const settings = {
  theme: createThemeSetting(),
  backdrop: createBackdropMode(),
};

// ClientRouter resets <html>'s attributes (inline style included) on every
// swap; setting it on the incoming document avoids a frame of the OS scheme.
document.addEventListener("astro:before-swap", (event) => {
  const { newDocument } = event as Event & { newDocument: Document };
  newDocument.documentElement.style.colorScheme =
    document.documentElement.style.colorScheme;
});
