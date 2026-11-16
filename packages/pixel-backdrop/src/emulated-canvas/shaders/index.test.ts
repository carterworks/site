import { expect, test } from "vitest";
import { SHADERS } from ".";

const files = import.meta.glob<Record<string, unknown>>(
  ["./*.ts", "!./*.test.ts", "!./index.ts"],
  { eager: true },
);

test("every shader file is in SHADERS, and every shader in SHADERS has a file", () => {
  const registered = (exports: Record<string, unknown>) =>
    SHADERS.filter((shader) => Object.values(exports).includes(shader));
  const unregistered = Object.entries(files)
    .filter(([, exports]) => registered(exports).length === 0)
    .map(([file]) => file);
  expect(unregistered, "add these shaders to SHADERS").toEqual([]);
  expect(
    Object.values(files).flatMap(registered),
    "SHADERS holds a shader from outside a shader file",
  ).toHaveLength(SHADERS.length);
});
