import { expect, test } from "vitest";
import { TOYS } from ".";

const files = import.meta.glob<Record<string, unknown>>(
  [
    "./*.ts",
    "!./*.test.ts",
    "!./{toy,line,index}.ts",
    // Not on the menu: /play starts it with a dropped picture.
    "!./image.ts",
  ],
  { eager: true },
);

test("toy ids are unique, and shimmer is the default", () => {
  const ids = TOYS.map((toy) => toy.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids[0]).toBe("shimmer");
});

test("every toy file is in TOYS, and every toy in TOYS has a file", () => {
  const registered = (exports: Record<string, unknown>) =>
    TOYS.filter((toy) => Object.values(exports).includes(toy));
  const unregistered = Object.entries(files)
    .filter(([, exports]) => registered(exports).length === 0)
    .map(([file]) => file);
  expect(unregistered, "add these toys to TOYS").toEqual([]);
  expect(
    Object.values(files).flatMap(registered),
    "TOYS holds a toy from outside a toy file",
  ).toHaveLength(TOYS.length);
});
