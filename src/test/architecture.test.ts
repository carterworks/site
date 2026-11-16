// @vitest-environment node
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { expect, test } from "vitest";

/**
 * The layers of the pixel backdrop package and of the site over it. Every
 * production file must match a layer (first match wins), and may import only
 * files in the layers its `imports` names; an import of the backdrop package
 * counts as one of the file its `exports` maps it to. Any other bare import
 * (package, builtin or virtual module) must be named there too, or `imports`
 * must name "packages" to allow any.
 */
const PACKAGE = "packages/pixel-backdrop";
const kit = (glob: string) => `${PACKAGE}/src/${glob}`;

const layers = {
  lib: {
    files: [kit("lib/*.ts")],
    imports: ["lib"],
  },
  "canvas kit": {
    files: [kit("emulated-canvas/{shader,colour,limits}.ts")],
    imports: ["lib"],
  },
  "shader registry": {
    files: [kit("emulated-canvas/shaders/index.ts")],
    imports: ["shaders", "canvas kit"],
  },
  // A pass sees only the contract and its helpers, never another pass, the
  // registry or the element.
  shaders: {
    files: [kit("emulated-canvas/shaders/*.ts")],
    imports: ["canvas kit", "lib"],
  },
  pipeline: {
    files: [kit("emulated-canvas/pipeline.ts")],
    imports: ["canvas kit"],
  },
  presenter: {
    files: [kit("emulated-canvas/presenter.ts")],
    imports: ["canvas kit", "lib"],
  },
  // Other layers reach the canvas through the element and the kit, never the
  // pipeline, the presenter or the passes.
  canvas: {
    files: [kit("emulated-canvas/element.ts")],
    imports: ["pipeline", "presenter", "shader registry", "canvas kit", "lib"],
  },
  "toy kit": {
    files: [kit("backdrop-toys/{toy,line}.ts")],
    imports: ["toy kit", "lib"],
  },
  "toy registry": {
    files: [kit("backdrop-toys/index.ts")],
    imports: ["toys", "toy kit"],
  },
  toys: {
    files: [kit("backdrop-toys/*.ts")],
    imports: ["toy kit", "lib"],
  },
  display: {
    files: [kit("pixel-backdrop/display.ts")],
    imports: [],
  },
  knobs: {
    files: [kit("pixel-backdrop/knobs.ts")],
    imports: [],
  },
  "pointer relay": {
    files: [kit("pixel-backdrop/{pointer-relay,press}.ts")],
    imports: ["pointer relay"],
  },
  // What the backdrop shows is decided from data alone, never the elements.
  look: {
    files: [kit("pixel-backdrop/look.ts")],
    imports: ["knobs", "toy kit", "display", "lib"],
  },
  backdrop: {
    files: [kit("pixel-backdrop/element.ts"), `${PACKAGE}/pixel-backdrop.css`],
    imports: [
      "pointer relay",
      "look",
      "knobs",
      "canvas",
      "toy registry",
      "toy kit",
      "display",
    ],
  },
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
    imports: ["site lib", "lib", "packages"],
  },
  // Pages reach the backdrop only through its entry points, never a single
  // toy or the toy kit.
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
    to: kit("backdrop-toys/image.ts"),
    why: "a dropped image becomes a toy that is not in the registry",
  },
];

const production = globSync(`{src,${PACKAGE}/src}/**/*.{ts,js,mjs,astro}`, {
  exclude: ["**/*.test.ts", "src/test/**", `${PACKAGE}/src/test/**`],
}).sort();

const layerOf = (file: string) =>
  Object.entries(layers).find(([, { files }]) =>
    files.some((glob) => matchesGlob(file, glob)),
  )?.[0];

const { name: packageName, exports: entries } = JSON.parse(
  readFileSync(join(PACKAGE, "package.json"), "utf8"),
) as { name: string; exports: Record<string, string> };

/** The file an import of the package names, through its `exports`, as Node resolves it. */
const resolveEntry = (specifier: string) => {
  const subpath = `.${specifier.slice(packageName.length)}`;
  for (const [entry, target] of Object.entries(entries)) {
    const [head, tail] = entry.split("*");
    const match =
      tail === undefined
        ? entry === subpath
        : subpath.startsWith(head) && subpath.endsWith(tail);
    if (!match) continue;
    const star = subpath.slice(
      head.length,
      subpath.length - (tail?.length ?? 0),
    );
    return join(PACKAGE, target.replace("*", star));
  }
  return specifier;
};

const isPackage = (specifier: string) =>
  specifier === packageName || specifier.startsWith(`${packageName}/`);

const isBare = (specifier: string) =>
  !specifier.startsWith(".") && !isPackage(specifier);

const resolve = (from: string, specifier: string) => {
  if (isPackage(specifier)) return resolveEntry(specifier);
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

/**
 * What a toy could learn about the page it runs on: the canvas's attributes,
 * styles, the viewport, storage. Its only window use is the resize listener.
 */
const hostApis =
  /\b(?:dataset|getAttribute|getComputedStyle|matchMedia|localStorage|sessionStorage|document|innerWidth|innerHeight|devicePixelRatio|visualViewport|screen|window(?!\.addEventListener\("resize"))\b/g;

test("a toy reads nothing about the page it runs on", () => {
  const reads = production
    .filter((file) => layerOf(file) === "toys")
    .flatMap((file) =>
      Array.from(
        sources.get(file)!.matchAll(hostApis),
        ([api]) => `${file} reads ${api}`,
      ),
    );
  expect(
    reads,
    "a toy may read only its canvas, its events and the window resizing",
  ).toEqual([]);
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
