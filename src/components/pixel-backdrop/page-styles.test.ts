import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

test("no site stylesheet blends over the backdrop, as a blend over a changing canvas is re-blended on every present", () => {
  const src = join(import.meta.dirname, "../..");
  const sheets = globSync("**/*.{css,astro}", { cwd: src });
  const blending = sheets.filter((file) =>
    readFileSync(join(src, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, "")
      .includes("mix-blend-mode"),
  );

  expect(sheets).not.toHaveLength(0);
  expect(blending).toEqual([]);
});
