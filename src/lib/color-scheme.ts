export const SCHEME_KEY = "color-scheme";

export type Scheme = "light" | "dark";

export const osScheme = (): Scheme =>
  matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/** The inline colorScheme is the stored override; empty follows the OS. */
export const shownScheme = (root: HTMLElement): Scheme =>
  (root.style.colorScheme as Scheme) || osScheme();

export function saveScheme(root: HTMLElement, scheme: Scheme | null) {
  root.style.colorScheme = scheme ?? "";
  try {
    if (scheme) localStorage.setItem(SCHEME_KEY, scheme);
    else localStorage.removeItem(SCHEME_KEY);
  } catch {}
}
