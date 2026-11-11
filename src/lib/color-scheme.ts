const KEY = "color-scheme";

export function restoreScheme(root: HTMLElement) {
  try {
    root.style.colorScheme = localStorage.getItem(KEY) ?? "";
  } catch {}
}

export function saveScheme(root: HTMLElement, scheme: string) {
  root.style.colorScheme = scheme;
  try {
    if (scheme) localStorage.setItem(KEY, scheme);
    else localStorage.removeItem(KEY);
  } catch {}
}
