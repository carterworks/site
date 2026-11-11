import { expect, test } from "vitest";
import { MODES } from ".";

test("mode ids are unique, and shimmer is the default", () => {
  const ids = MODES.map((mode) => mode.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids[0]).toBe("shimmer");
});
