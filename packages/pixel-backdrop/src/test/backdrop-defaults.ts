import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");

/** The source as the browser applies it: a commented-out declaration is none. */
const readStyles = (file: string) =>
  readFileSync(join(root, file), "utf8").replace(
    /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g,
    "",
  );

/**
 * The `--backdrop-*` declarations in pixel-backdrop.css's `:root` block, the
 * knobs' defaults, as `[property, value]` in file order.
 */
export function backdropDefaults(): [string, string][] {
  const css = readStyles("pixel-backdrop.css");
  const block = css.match(/^:where\(:root\) \{$([\s\S]*?)^\}$/m)?.[1] ?? "";
  return [...block.matchAll(/^\s*(--backdrop-[\w-]+)\s*:\s*([^;]+);/gm)].map(
    ([, property, value]) => [property, value.trim()],
  );
}

/**
 * Every `--backdrop-*` declaration in the package's stylesheets, as
 * `file: property`. A `var(--backdrop-*)` reads one, so isn't among them.
 */
export function backdropDeclarations(): string[] {
  return globSync("**/*.css", { cwd: root }).flatMap((file) =>
    [...readStyles(file).matchAll(/(--backdrop-[\w-]+)\s*:/g)].map(
      ([, property]) => `${file}: ${property}`,
    ),
  );
}

/**
 * Puts the real defaults on `:root`, so tests run with the knobs the package
 * ships. Only those declarations are copied, as happy-dom can't parse the
 * whole stylesheet.
 */
export function installBackdropDefaults() {
  const declarations = backdropDefaults().map(
    ([property, value]) => `${property}: ${value};`,
  );
  const style = document.createElement("style");
  style.textContent = `:root { ${declarations.join(" ")} }`;
  document.head.append(style);
}
