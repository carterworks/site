const defaultTheme = require("tailwindcss/defaultTheme");

module.exports = {
	content: ["./src/**/*.{astro,html,js,jsx,svelte,ts,tsx,vue}"],
	theme: {
		extend: {
			fontFamily: {
				serif: ["EB Garamond", ...defaultTheme.fontFamily.serif],
			},
		},
	},
	plugins: [],
};
