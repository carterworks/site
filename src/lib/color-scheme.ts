export const SCHEME_KEY = "color-scheme";

export type Scheme = "light" | "dark";

export const osScheme = (): Scheme =>
  matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export function saveScheme(root: HTMLElement, scheme: Scheme | null) {
  root.style.colorScheme = scheme ?? "";
  try {
    if (scheme) localStorage.setItem(SCHEME_KEY, scheme);
    else localStorage.removeItem(SCHEME_KEY);
  } catch {}
}
