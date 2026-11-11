export const SCHEME_KEY = "color-scheme";

export type Scheme = "light" | "dark";

export const osScheme = (): Scheme =>
  matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

// null means follow the OS; storing a value equal to the OS scheme would
// silently pin the user to it if their OS scheme later changes.
export function nextScheme(current: Scheme, os: Scheme): Scheme | null {
  const opposite = current === "dark" ? "light" : "dark";
  return opposite === os ? null : opposite;
}

export function saveScheme(root: HTMLElement, scheme: Scheme | null) {
  root.style.colorScheme = scheme ?? "";
  try {
    if (scheme) localStorage.setItem(SCHEME_KEY, scheme);
    else localStorage.removeItem(SCHEME_KEY);
  } catch {}
}
