import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Puts the real `--backdrop-*` defaults from global.css on `:root`, so tests
 * run with the knobs the site ships. Only those declarations are copied, as
 * happy-dom can't parse the whole stylesheet.
 */
export function installBackdropDefaults() {
  const css = readFileSync(
    join(import.meta.dirname, "../layouts/global.css"),
    "utf8",
  );
  const declarations = css.match(/--backdrop-[\w-]+:[^;]+;/g) ?? [];
  const style = document.createElement("style");
  style.textContent = `:root { ${declarations.join(" ")} }`;
  document.head.append(style);
}
