import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The `--backdrop-*` declarations in global.css's `:root` block, the knobs'
 * defaults, as `[property, value]` in file order. A `--backdrop-display-*`
 * property is never among them: the element sets those on itself at runtime,
 * and the stylesheets only read them through `var()`.
 */
export function backdropDefaults(): [string, string][] {
  const css = readFileSync(
    join(import.meta.dirname, "../layouts/global.css"),
    "utf8",
  );
  const root = css.match(/^:root \{$([\s\S]*?)^\}$/m)?.[1] ?? "";
  return [...root.matchAll(/^\s*(--backdrop-[\w-]+)\s*:\s*([^;]+);/gm)].map(
    ([, property, value]) => [property, value.trim()],
  );
}

/**
 * Puts the real defaults on `:root`, so tests run with the knobs the site
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
