import sitemap from "@astrojs/sitemap";
import { defineConfig, envField } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://carter.works",
  compressHTML: true,
  // Small shared styles should arrive with the document, not block its paint.
  build: { inlineStylesheets: "always" },
  integrations: [sitemap({ filter: (page) => !page.endsWith("/play/") })],
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
