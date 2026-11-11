export const SCHEME_KEY = "color-scheme";

export function saveScheme(root: HTMLElement, scheme: "light" | "dark") {
  root.style.colorScheme = scheme;
  try {
    localStorage.setItem(SCHEME_KEY, scheme);
  } catch {}
}
