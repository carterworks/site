// @vitest-environment node
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { expect, test } from "vitest";

/**
 * The layers of the site over the pixel backdrop package. Every production
 * file must match a layer (first match wins), and may import only files in
 * the layers its `imports` names. The package is reached only through its
 * `exports`, each the layer `ENTRIES` names; an import of any other of its
 * files, by a path into it or past its exports, is in no layer, so no layer
 * may make it. Any other bare import (package, builtin or virtual module)
 * must be named in `imports` too, or `imports` must name "packages" to allow
 * any. The package's own layers are held in its repository.
 */
const BACKDROP = "@carterworks/pixel-backdrop";

/** What each of the backdrop package's `exports` is to the site. */
const ENTRIES: Record<string, string> = {
  ".": "backdrop",
  "./pixel-backdrop.css": "backdrop",
  "./emulated-canvas": "canvas",
  "./toys": "toy registry",
  "./toys/*": "toy",
  "./landscape": "landscape",
  "./custom-elements.json": "manifest",
};

const layers = {
  // The site's themes, which only the page knows, and how it shows them.
  displays: {
    files: ["src/components/pixel-backdrop/backdrop-displays.ts"],
    imports: ["backdrop"],
  },
  "display follower": {
    files: ["src/components/pixel-backdrop/follow-display.ts"],
    imports: ["displays", "backdrop"],
  },
  "cycle setting": {
    files: ["src/lib/cycle-setting.ts"],
    imports: [],
  },
  controls: {
    files: [
      "src/components/{settings,command-bar,play-toolbar}/*.ts",
      // The theme setting's storage, shared with the layout's inline script.
      "src/lib/color-scheme.ts",
    ],
    imports: ["controls", "toy registry", "displays", "cycle setting"],
  },
  "site lib": {
    files: ["src/lib/*.ts"],
    imports: ["site lib", "landscape", "packages"],
  },
  // Pages reach the backdrop only through its entry points, never a single
  // toy.
  site: {
    files: ["src/*.ts", "src/{pages,layouts}/**", "src/components/**/*.astro"],
    imports: [
      "site",
      "site lib",
      "controls",
      "backdrop",
      "display follower",
      "toy registry",
      "displays",
      "packages",
    ],
  },
};

const exceptions = [
  {
    from: "src/components/play-toolbar/play-toolbar.ts",
    to: `${BACKDROP}/toys/image`,
    why: "a dropped image becomes a toy that is not in the registry",
  },
];

const production = globSync("src/**/*.{ts,js,mjs,astro}", {
  exclude: ["**/*.test.ts", "src/test/**"],
}).sort();

const isBackdrop = (specifier: string) =>
  specifier === BACKDROP || specifier.startsWith(`${BACKDROP}/`);

/** The layer of the entry point an import of the package names, as Node matches it to its `exports`. */
const entryLayer = (specifier: string) => {
  const subpath = `.${specifier.slice(BACKDROP.length)}`;
  return Object.entries(ENTRIES).find(([entry]) => {
    const [head, tail] = entry.split("*");
    return tail === undefined
      ? entry === subpath
      : subpath.startsWith(head) && subpath.endsWith(tail);
  })?.[1];
};

const layerOf = (file: string) =>
  isBackdrop(file)
    ? entryLayer(file)
    : Object.entries(layers).find(([, { files }]) =>
        files.some((glob) => matchesGlob(file, glob)),
      )?.[0];

const isBare = (specifier: string) =>
  !specifier.startsWith(".") && !isBackdrop(specifier);

const resolve = (from: string, specifier: string) => {
  if (isBackdrop(specifier)) return specifier;
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

test("every entry point of the backdrop package is one the site names", () => {
  const { exports } = JSON.parse(
    readFileSync(join("node_modules", BACKDROP, "package.json"), "utf8"),
  ) as { exports: Record<string, string> };
  expect(Object.keys(ENTRIES).sort()).toEqual(Object.keys(exports).sort());
});
