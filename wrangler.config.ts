import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
	// Migrated from `pages_build_output_dir` in wrangler.toml.
	assetsDirectory: "./dist",
	dev: {
		// Keep the existing `wrangler types` flow until type generation
		// moves to the new config.
		types: {
			generate: false,
		},
	},
});
