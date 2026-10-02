import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
	// Serves Astro's static build output.
	assetsDirectory: "./dist",
	// No bindings, so no generated types. Enable when bindings are added.
	types: {
		generate: false,
	},
});
