import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

// Run against the production output: pnpm build && node --test scripts/first-load-check.mjs
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

test("the first-load font is small and discovered in the document", () => {
  assert.ok(statSync("dist/InterVariable-latin.woff2").size < 100_000);
  assert.match(
    html,
    /<link[^>]*rel="preload"[^>]*href="\/InterVariable-latin.woff2"/,
  );
  assert.match(css, /unicode-range:/);
});

test("the homepage has no render-blocking stylesheet request", () => {
  assert.equal(/<link[^>]*rel="stylesheet"/.test(html), false);
  assert.match(html, /<style[^>]*>/);
});

test("the avatar reserves a square before the image loads", () => {
  const avatar = html.match(/<img[^>]*class="inline-avatar"[^>]*>/)?.[0];
  assert.ok(avatar);
  assert.match(avatar, /width="39"/);
  assert.match(avatar, /height="39"/);
});
