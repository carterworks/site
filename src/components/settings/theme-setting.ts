import { osScheme, saveScheme } from "../../lib/color-scheme";
import { shownScheme } from "../pixel-backdrop/backdrop-displays";

/**
 * A two-state toggle over three states, per
 * https://lea.verou.me/blog/2026/dark-mode-toggles/. The inline colorScheme
 * (set from storage by the head script before paint) is the stored override;
 * empty follows the OS. A press flips what is shown, and a flip that lands on
 * the OS scheme clears the override instead of pinning it. OS changes never
 * touch storage; only a press does.
 */
export function createThemeSetting(root = document.documentElement) {
  const current = () => shownScheme(root);

  return {
    label() {
      return current() === "dark" ? "Dark" : "Light";
    },
    cycle() {
      const next = current() === "dark" ? "light" : "dark";
      saveScheme(root, next === osScheme() ? null : next);
    },
  };
}
