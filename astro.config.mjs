import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	site: "https://carter.works",
	integrations: [sitemap()],
	output: "static",
});
