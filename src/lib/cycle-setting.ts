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
