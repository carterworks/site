import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { defineConfig, envField } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://carter.works",
  integrations: [sitemap(), react()],
  output: "static",
  vite: {
    resolve: {
      alias: {
        react: "preact/compat",
        "react-dom": "preact/compat",
        "react-dom/client": "preact/compat/client",
        "react/jsx-runtime": "preact/jsx-runtime",
        "react/jsx-dev-runtime": "preact/jsx-dev-runtime",
      },
    },
  },
  env: {
    schema: {
      DEV: envField.boolean({
        context: "client",
        access: "public",
        optional: true,
        default: false,
        description: "Whether the site is running in development mode",
      }),
      SANITY_PROJECT_ID: envField.string({
        context: "server",
        access: "secret",
        optional: true,
        description: "Sanity project ID for blog content",
      }),
      SANITY_DATASET: envField.string({
        context: "server",
        access: "secret",
        optional: true,
        default: "production",
        description: "Sanity dataset for blog content",
      }),
      SANITY_API_VERSION: envField.string({
        context: "server",
        access: "secret",
        optional: true,
        default: "2026-04-27",
        description: "Sanity API version date",
      }),
    },
  },
});
