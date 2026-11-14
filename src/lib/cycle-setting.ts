/** The value a cycle row moves to next. */
export function nextInRotation<T>(values: readonly T[], current: T): T {
  return values[(values.indexOf(current) + 1) % values.length];
}

type Store = "localStorage" | "sessionStorage";

export function storedChoice<T extends string>(
  key: string,
  ids: readonly T[],
  store: Store = "localStorage",
) {
  try {
    const id = globalThis[store].getItem(key);
    return ids.find((known) => known === id);
  } catch {
    return undefined;
  }
}

export function storeChoice(
  key: string,
  id?: string,
  store: Store = "localStorage",
) {
  try {
    if (id) globalThis[store].setItem(key, id);
    else globalThis[store].removeItem(key);
  } catch {}
}
