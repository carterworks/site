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
  lib: { files: ["src/lib/{clamp,cycle-setting}.ts"], imports: ["lib"] },
  "canvas kit": {
    files: [
      "src/components/emulated-canvas/{shader,colour,limits}.ts",
      "src/components/backdrop-noise.ts",
    ],
    imports: ["canvas kit", "lib"],
  },
  // A pass sees only the contract and its helpers, never the element.
  shaders: {
    files: ["src/components/emulated-canvas/shaders/*.ts"],
    imports: ["shaders", "canvas kit", "lib"],
  },
  canvas: {
    files: ["src/components/emulated-canvas/*.ts"],
    imports: ["canvas", "shaders", "canvas kit", "lib"],
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
  backdrop: {
    files: ["src/components/{pixel-backdrop,backdrop-press}.ts"],
    imports: [
      "backdrop",
      "canvas",
      "toy registry",
      "toy kit",
      "displays",
      "lib",
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
    imports: ["toy registry", "canvas", "canvas kit", "astro/toolbar"],
  },
  "site lib": {
    files: ["src/lib/*.ts"],
    imports: ["site lib", "lib", "packages"],
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
      "lib",
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
    to: "src/components/pixel-backdrop.ts",
    why: "reads the element's defaults from its module, not through the DOM",
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

test("every exception still happens", () => {
  const stale = exceptions.filter(
    (exception) =>
      !edges.some(
        ({ from, to }) => from === exception.from && to === exception.to,
      ),
  );
  expect(stale, "remove these exceptions").toEqual([]);
});
