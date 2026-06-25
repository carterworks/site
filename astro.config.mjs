import sitemap from "@astrojs/sitemap";
import remarkEleventyImage from "astro-remark-eleventy-image";
import { defineConfig, envField } from "astro/config";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const publicDir = fileURLToPath(new URL("./public", import.meta.url));
const publicAssetsDir = fileURLToPath(
  new URL("./public/assets", import.meta.url),
);
const distAssetsDir = fileURLToPath(new URL("./dist/assets", import.meta.url));

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const withRootSlash = (value) =>
  value
    .replaceAll('srcset="assets/', 'srcset="/assets/')
    .replaceAll(", assets/", ", /assets/");

const markdownImageMarkup = ({ src, sources, width, height, alt }) => `<picture>
  ${withRootSlash(sources)}
  <img src="/${src.replace(/^\/+/, "")}" width="${width}" height="${height}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">
</picture>`;

const copyGeneratedBlogImages = () => ({
  name: "copy-generated-blog-images",
  hooks: {
    "astro:build:done": async () => {
      await mkdir(distAssetsDir, { recursive: true });

      for (const file of await readdir(publicAssetsDir)) {
        if (/-\d+\.(jpe?g|png|webp)$/.test(file)) {
          await copyFile(
            `${publicAssetsDir}/${file}`,
            `${distAssetsDir}/${file}`,
          );
        }
      }
    },
  },
});

// https://astro.build/config
export default defineConfig({
  site: "https://carter.works",
  integrations: [
    sitemap(),
    remarkEleventyImage({
      outDir: publicDir,
      customMarkup: markdownImageMarkup,
      eleventyImageConfig: {
        formats: ["webp", "auto"],
        widths: [600, 1000, 1400, "auto"],
        sharpOptions: {
          animated: true,
        },
      },
    }),
    copyGeneratedBlogImages(),
  ],
  output: "static",
  env: {
    schema: {
      DEV: envField.boolean({
        context: "client",
        access: "public",
        optional: true,
        default: false,
        description: "Whether the site is running in development mode",
      }),
    },
  },
});
