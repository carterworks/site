import { expect, test } from "vitest";
import { TOYS } from ".";

test("mode ids are unique, and shimmer is the default", () => {
  const ids = TOYS.map((toy) => toy.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids[0]).toBe("shimmer");
});
