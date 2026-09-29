import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
	// Serves Astro's static build output.
	assetsDirectory: "./dist",
	// Keep the existing `wrangler types` flow until type generation
	// moves to the new config.
	types: {
		generate: false,
	},
});
