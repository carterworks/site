import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// Run against the production output: pnpm build && node --test scripts/first-load.test.mjs
const html = readFileSync("dist/index.html", "utf8");
const css =
  html +
  readdirSync("dist/_astro")
    .filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(`dist/_astro/${file}`, "utf8"))
    .join("\n");

test("web fonts never hide text while loading", () => {
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)];
  assert.ok(faces.length >= 2);
  for (const [, face] of faces) {
    assert.match(face, /font-display:\s*(swap|optional)/);
  }
});
