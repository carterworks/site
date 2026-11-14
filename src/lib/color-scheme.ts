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

/**
 * Puts the stored scheme and each scheme's display on `<html>`: the stored
 * display, else the one this visit drew, else a fresh draw from `ids` kept in
 * session storage so the visit keeps it. It must run before first paint,
 * which a bundled module can't, so the layout inlines its source: it may use
 * nothing but its arguments and the page's globals.
 */
function restoreBeforePaint(
  schemeKey: string,
  displays: [attribute: string, key: string, ids: string[]][],
) {
  try {
    const root = document.documentElement;
    root.style.colorScheme = localStorage.getItem(schemeKey) ?? "";
    for (const [attribute, key, ids] of displays) {
      let id = localStorage.getItem(key) ?? sessionStorage.getItem(key);
      if (!id) {
        id = ids[Math.floor(Math.random() * ids.length)];
        sessionStorage.setItem(key, id);
      }
      root.setAttribute(attribute, id);
    }
  } catch {}
}

/** The head script, with the keys the settings write baked in so they can't drift. */
export const restoreScript = (
  displays: [attribute: string, key: string, ids: string[]][],
) =>
  `(${restoreBeforePaint})(${JSON.stringify(SCHEME_KEY)}, ${JSON.stringify(displays)});`;
