// @vitest-environment node
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { expect, test } from "vitest";

/**
 * The pixel backdrop's layers. Every production file under these directories
 * must match a layer (first match wins), and may import only files in the
 * layers its `imports` names. Package imports are not checked.
 */
const layers = {
  lib: { files: ["src/lib/*.ts"], imports: ["lib"] },
  canvas: {
    files: [
      "src/components/{emulated-canvas,emulated-canvas-limits,backdrop-noise}.ts",
    ],
    imports: ["canvas", "lib"],
  },
  "toy kit": {
    files: ["src/components/backdrop-modes/{toy,line}.ts"],
    imports: ["toy kit", "lib"],
  },
  "toy registry": {
    files: ["src/components/backdrop-modes/index.ts"],
    imports: ["toys", "toy kit"],
  },
  toys: {
    files: ["src/components/backdrop-modes/*.ts"],
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
      "src/components/{site-settings,backdrop-mode-setting,backdrop-display-setting,theme-setting}.ts",
      "src/components/{play-toolbar,command-bar,frame-rate}.ts",
    ],
    imports: ["controls", "toy registry", "displays", "lib"],
  },
  "dev toolbar": {
    files: ["src/dev-toolbar/*.ts"],
    imports: ["toy registry", "canvas"],
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
    to: "src/components/backdrop-modes/image.ts",
    why: "a dropped image becomes a toy that is not in the registry",
  },
  {
    from: "src/dev-toolbar/pixel-backdrop.ts",
    to: "src/components/pixel-backdrop.ts",
    why: "reads the element's defaults from its module, not through the DOM",
  },
];

const production = globSync(
  ["src/lib/**/*.ts", "src/components/**/*.ts", "src/dev-toolbar/**/*.ts"],
  { exclude: (path) => path.endsWith(".test.ts") },
).sort();

const layerOf = (file: string) =>
  Object.entries(layers).find(([, { files }]) =>
    files.some((glob) => matchesGlob(file, glob)),
  )?.[0];

const resolve = (from: string, specifier: string) => {
  const base = join(dirname(from), specifier);
  return [`${base}.ts`, join(base, "index.ts")].find(existsSync) ?? base;
};

const importsOf = (file: string) =>
  [
    ...readFileSync(file, "utf8").matchAll(
      /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']*)["']/g,
    ),
  ].map(([, specifier]) => resolve(file, specifier));

const edges = production.flatMap((from) =>
  importsOf(from).map((to) => ({ from, to })),
);

const isException = ({ from, to }: { from: string; to: string }) =>
  exceptions.some((e) => e.from === from && e.to === to);

test("every production file belongs to a layer", () => {
  const unclassified = production.filter((file) => !layerOf(file));
  expect(unclassified, "add these files to a layer").toEqual([]);
});

test("each file imports only what its layer allows", () => {
  const broken = edges
    .filter((edge) => !isException(edge))
    .flatMap(({ from, to }) => {
      const fromLayer = layerOf(from);
      const toLayer = layerOf(to);
      if (!fromLayer) return [];
      const allowed = layers[fromLayer as keyof typeof layers].imports;
      return toLayer && allowed.includes(toLayer)
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
