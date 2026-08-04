import { describe, expect, test } from "vitest";
import { rankSearchResults } from "./search";

describe("rankSearchResults", () => {
  const items = [
    { name: "Settings", search: "settings appearance theme light dark" },
    { name: "Article", search: "article /blog/post/" },
    { name: "Dark mode", search: "toggle appearance theme light dark" },
  ];

  test("matches every whitespace-separated term without case sensitivity", () => {
    expect(
      rankSearchResults(items, "  APPEARANCE   dark ", (item) => item.search),
    ).toEqual([items[0], items[2]]);
  });

  test("keeps the input order and does not mutate the input", () => {
    const input = [items[2], items[0], items[1]];

    expect(rankSearchResults(input, "theme", (item) => item.search)).toEqual([
      items[2],
      items[0],
    ]);
    expect(input).toEqual([items[2], items[0], items[1]]);
  });

  test("returns every item for an empty query", () => {
    expect(rankSearchResults(items, "", (item) => item.search)).toEqual(items);
  });
});
