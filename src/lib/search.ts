export function rankSearchResults<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
) {
  const terms = query.toLowerCase().match(/\S+/g) ?? [];
  return items.filter((item) => {
    const text = getText(item).toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
