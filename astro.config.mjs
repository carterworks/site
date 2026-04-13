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
    },
  },
});
