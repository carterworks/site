import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Puts the knob defaults from the package's pixel-backdrop.css on `:root`, so
 * tests run with the knobs the site ships. Only its `--backdrop-*`
 * declarations are copied, as happy-dom can't parse the whole stylesheet.
 * Read from disk, as Vitest hands a CSS import over empty, even with `?raw`.
 */
export function installBackdropDefaults() {
  const css = readFileSync(
    createRequire(import.meta.url).resolve(
      "@carterworks/pixel-backdrop/pixel-backdrop.css",
    ),
    "utf8",
  );
  const block =
    css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .match(/^:where\(:root\) \{$([\s\S]*?)^\}$/m)?.[1] ?? "";
  const declarations = [
    ...block.matchAll(/^\s*(--backdrop-[\w-]+)\s*:\s*([^;]+);/gm),
  ].map(([, property, value]) => `${property}: ${value.trim()};`);
  const style = document.createElement("style");
  style.textContent = `:root { ${declarations.join(" ")} }`;
  document.head.append(style);
}
