import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import icon from "astro-icon";
import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";

import metaTags from "astro-meta-tags";

// https://astro.build/config
export default defineConfig({
	site: "https://carter.works",
	integrations: [sitemap(), tailwind(), icon(), metaTags()],
	output: "hybrid",
	adapter: cloudflare({
		imageService: "passthrough",
		platformProxy: {
			enabled: true,
		},
	}),
	vite: {
		ssr: {
			// for jsdom
			external: [
				"path",
				"fs",
				"vm",
				"events",
				"url",
				"util",
				"http",
				"https",
				"stream",
				"zlib",
				"buffer",
				"crypto",
				"net",
				"tls",
				"assert",
				"string_decoder",
				"child_process",
				"os",
			],
		},
	},
});
