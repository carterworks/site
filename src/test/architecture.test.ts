// @vitest-environment node
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { expect, test } from "vitest";

/**
 * The site's layers, pixel backdrop first. Every production file must match a
 * layer (first match wins), and may import only files in the layers its
 * `imports` names. A bare import (package, builtin or virtual module) must be
 * named there too, or `imports` must name "packages" to allow any.
 */
const layers = {
  lib: { files: ["src/lib/{clamp,cycle-setting,rgb}.ts"], imports: [] },
  "canvas kit": {
    files: [
      "src/components/emulated-canvas/{shader,colour,limits}.ts",
      "src/components/backdrop-noise.ts",
    ],
    imports: ["lib"],
  },
  "shader registry": {
    files: ["src/components/emulated-canvas/shaders/index.ts"],
    imports: ["shaders", "canvas kit"],
  },
  // A pass sees only the contract and its helpers, never another pass, the
  // registry or the element.
  shaders: {
    files: ["src/components/emulated-canvas/shaders/*.ts"],
    imports: ["canvas kit", "lib"],
  },
  pipeline: {
    files: ["src/components/emulated-canvas/pipeline.ts"],
    imports: ["canvas kit"],
  },
  presenter: {
    files: ["src/components/emulated-canvas/presenter.ts"],
    imports: ["canvas kit", "lib"],
  },
  // Other layers reach the canvas through the element and the kit, never the
  // pipeline, the presenter or the passes.
  canvas: {
    files: ["src/components/emulated-canvas/element.ts"],
    imports: ["pipeline", "presenter", "shader registry", "canvas kit"],
  },
  "toy kit": {
    files: ["src/components/backdrop-toys/{toy,line}.ts"],
    imports: ["toy kit", "lib"],
  },
  "toy registry": {
    files: ["src/components/backdrop-toys/index.ts"],
    imports: ["toys", "toy kit"],
  },
  toys: {
    files: ["src/components/backdrop-toys/*.ts"],
    imports: ["toy kit", "lib"],
  },
  displays: {
    files: ["src/components/backdrop-displays.ts"],
    imports: ["lib"],
  },
  knobs: {
    files: ["src/components/pixel-backdrop/knobs.ts"],
    imports: [],
  },
  "pointer relay": {
    files: ["src/components/pixel-backdrop/{pointer-relay,press}.ts"],
    imports: ["pointer relay"],
  },
  // What the backdrop shows is decided from data alone, never the elements.
  look: {
    files: ["src/components/pixel-backdrop/look.ts"],
    imports: ["knobs", "toy kit", "displays", "lib"],
  },
  backdrop: {
    files: ["src/components/pixel-backdrop.ts"],
    imports: [
      "pointer relay",
      "look",
      "knobs",
      "canvas",
      "toy registry",
      "toy kit",
      "displays",
    ],
  },
  controls: {
    files: [
      "src/components/{site-settings,backdrop-toy-setting,backdrop-display-setting,theme-setting}.ts",
      "src/components/{play-toolbar,command-bar,frame-rate}.ts",
      // The theme setting's storage, shared with the layout's inline script.
      "src/lib/color-scheme.ts",
    ],
    imports: ["controls", "toy registry", "displays", "lib"],
  },
  "dev toolbar": {
    files: ["src/dev-toolbar/*.ts"],
    imports: ["knobs", "toy registry", "astro/toolbar"],
  },
  "site lib": {
    files: ["src/lib/*.ts"],
    imports: ["site lib", "packages"],
  },
  // Pages reach the backdrop only through its entry points, never a single
  // toy, the toy kit or the dev toolbar.
  site: {
    files: [
      "src/*.ts",
      "src/{pages,layouts,integrations}/**",
      "src/components/*.astro",
    ],
    imports: [
      "site",
      "site lib",
      "controls",
      "backdrop",
      "canvas",
      "toy registry",
      "displays",
      "packages",
    ],
  },
};

const exceptions = [
  {
    from: "src/lib/og-pixels.ts",
    to: "src/components/backdrop-noise.ts",
    why: "link previews share the backdrop's noise, which lives in components",
  },
  {
    from: "src/components/play-toolbar.ts",
    to: "src/components/backdrop-toys/image.ts",
    why: "a dropped image becomes a toy that is not in the registry",
  },
  {
    from: "src/dev-toolbar/pixel-backdrop.ts",
    to: "src/components/emulated-canvas/limits.ts",
    why: "the ghost slider stops at the canvas's retention cap",
  },
];

const production = globSync("src/**/*.{ts,js,mjs,astro}", {
  exclude: ["**/*.test.ts", "src/test/**"],
}).sort();

const layerOf = (file: string) =>
  Object.entries(layers).find(([, { files }]) =>
    files.some((glob) => matchesGlob(file, glob)),
  )?.[0];

const isBare = (specifier: string) => !specifier.startsWith(".");

const resolve = (from: string, specifier: string) => {
  const base = join(dirname(from), specifier);
  return [`${base}.ts`, join(base, "index.ts")].find(existsSync) ?? base;
};

// Strings are matched first so a `//` inside one (a URL) is kept.
const withoutComments = (source: string) =>
  source.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/.*|\/\*[\s\S]*?\*\//g,
    (_, string?: string) => string ?? "",
  );

const sources = new Map(
  production.map((file) => [file, withoutComments(readFileSync(file, "utf8"))]),
);

const importsOf = (file: string) =>
  [
    ...sources
      .get(file)!
      .matchAll(/(?:\bfrom|\bimport)\s*\(?\s*(["'])([^"'\n]*)\1/g),
  ].map(([, , specifier]) => specifier);

const edges = production.flatMap((from) =>
  importsOf(from).map((specifier) =>
    isBare(specifier)
      ? { from, to: specifier, bare: true }
      : { from, to: resolve(from, specifier), bare: false },
  ),
);

const isException = ({ from, to }: { from: string; to: string }) =>
  exceptions.some((e) => e.from === from && e.to === to);

test("every production file belongs to a layer", () => {
  const unclassified = production.filter((file) => !layerOf(file));
  expect(unclassified, "add these files to a layer").toEqual([]);
});

test("every dynamic import names its file literally", () => {
  const unchecked = production.filter((file) =>
    /\bimport\s*\((?!\s*(["'])[^"'\n]*\1\s*\))/.test(sources.get(file)!),
  );
  expect(unchecked, 'write these imports as import("./file")').toEqual([]);
});

test("each file imports only what its layer allows", () => {
  const broken = edges
    .filter((edge) => !isException(edge))
    .flatMap(({ from, to, bare }) => {
      const fromLayer = layerOf(from);
      if (!fromLayer) return [];
      const allowed: string[] =
        layers[fromLayer as keyof typeof layers].imports;
      const toLayer = bare ? "package" : layerOf(to);
      const ok = bare
        ? allowed.includes(to) || allowed.includes("packages")
        : toLayer !== undefined && allowed.includes(toLayer);
      return ok
        ? []
        : [
            `${from} (${fromLayer}) imports ${to} (${toLayer ?? "no layer"}); ${fromLayer} may import only ${allowed.join(", ")}`,
          ];
    });
  expect(broken).toEqual([]);
});

test("every import a layer allows, one of its files makes", () => {
  const uses = (layer: string, allowed: string) =>
    edges.some(
      (edge) =>
        !isException(edge) &&
        layerOf(edge.from) === layer &&
        (edge.bare
          ? allowed === "packages" || allowed === edge.to
          : layerOf(edge.to) === allowed),
    );
  const unused = Object.entries(layers).flatMap(([layer, { imports }]) =>
    imports
      .filter((allowed) => !uses(layer, allowed))
      .map((allowed) => `${layer} may import ${allowed} but does not`),
  );
  expect(unused, "remove these allowances").toEqual([]);
});

test("every exception still happens", () => {
  const stale = exceptions.filter(
    (exception) =>
      !edges.some(
        ({ from, to }) => from === exception.from && to === exception.to,
      ),
  );
  expect(stale, "remove these exceptions").toEqual([]);
});
