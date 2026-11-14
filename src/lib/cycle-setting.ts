/**
 * The value a cycle row moves to next. `reset` is passed only while a stored
 * value (or one stored earlier this session) makes undoing it meaningful.
 */
export function nextInRotation<T>(
  values: readonly T[],
  current: T,
  reset?: T,
): T {
  const rotation = reset === undefined ? values : [...values, reset];
  return rotation[(rotation.indexOf(current) + 1) % rotation.length];
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
