import typography from "@tailwindcss/typography";

const fontEmoji = [
	"'Apple Color Emoji'",
	"'Segoe UI Emoji'",
	"'Segoe UI Symbol'",
	"'Noto Color Emoji'",
];

/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
	theme: {
		extend: {
			backgroundImage: {
				noise: "url('/noise.svg')",
			},
			colors: {
				sepia: "oklch(97.35% 0.026 90.1 / <alpha-value>)",
				blackish: "oklch(25% 0.029 221.9 / <alpha-value>)",
			},
			fontFamily: {
				// from https://github.com/system-fonts/modern-font-stacks
				/* System UI fonts are those native to the operating system interface.
				 * They are highly legible and easy to read at small sizes, contains
				 * many font weights, and is ideal for UI elements.
				 */
				system: ["system-ui", "sans-serif"],
				/* Transitional typefaces are a mix between Old Style and Modern
				 * typefaces that was developed during The Enlightenment. One of the
				 * most famous examples of a Transitional typeface is Times New Roman,
				 * which was developed for the Times of London newspaper.
				 */
				transitional: [
					"Charter",
					"'Bitstream Charter'",
					"'Sitka Text'",
					"Cambria",
					"serif",
					...fontEmoji,
				],
				/* Old Style typefaces are characterized by diagonal stress, low
				 * contrast between thick and thin strokes, and rounded serifs, and
				 * were developed in the Renaissance period. One of the most famous
				 * examples of an Old Style typeface is Garamond.
				 */
				"old-style": [
					"'Iowan Old Style'",
					"'Palatino Linotype'",
					"'URW Palladio L'",
					"P052",
					"serif",
					...fontEmoji,
				],
				/* Humanist typefaces are characterized by their organic, calligraphic
				 * forms and low contrast between thick and thin strokes. These
				 * typefaces are inspired by the handwriting of the Renaissance period
				 * and are often considered to be more legible and easier to read than
				 * other sans-serif typefaces.
				 */
				humanist: [
					"Seravek",
					"'Gill Sans Nova'",
					"Ubuntu",
					"Calibri",
					"'DejaVu Sans'",
					"source-sans-pro",
					"sans-serif",
					...fontEmoji,
				],
				/* Geometric Humanist typefaces are characterized by their clean,
				 * geometric forms and uniform stroke widths. These typefaces are often
				 * considered to be modern and sleek in appearance, and are often used
				 * for headlines and other display purposes. Futura is a famous example
				 * of this classification.
				 */
				"gemoetric-humanist": [
					"Avenir",
					"Montserrat",
					"Corbel",
					"'URW Gothic'",
					"source-sans-pro",
					"sans-serif",
					...fontEmoji,
				],
				/* Classical Humanist typefaces are characterized by how the strokes
				 * subtly widen as they reach the stroke terminals without ending in a
				 * serif. These typefaces are inspired by classical Roman capitals and
				 * the stone-carving on Renaissance-period tombstones.
				 */
				"classical-humanist": [
					"Optima",
					"Candara",
					"'Noto Sans'",
					"source-sans-pro",
					"sans-serif",
					...fontEmoji,
				],
				/* Neo-Grotesque typefaces are a style of sans-serif that was developed
				 * in the late 19th and early 20th centuries and is characterized by its
				 * clean, geometric forms and uniform stroke widths. One of the most
				 * famous examples of a Neo-Grotesque typeface is Helvetica.
				 */
				"neo-grotesque": [
					"Inter",
					"Roboto",
					"'Helvetica Neue'",
					"'Arial Nova'",
					"'Nimbus Sans'",
					"Arial",
					"sans-serif",
					...fontEmoji,
				],
				/* Monospace Slab Serif typefaces are characterized by their fixed-width
				 * letters, which have the same width regardless of their shape, and its
				 * simple, geometric forms. Used to emulate typewriter output for
				 * reports, tabular work and technical documentation.
				 */
				"monospace-slab-serif": [
					"'Nimbus Mono PS'",
					"'Courier New'",
					"monospace",
					...fontEmoji,
				],
				/* Monospace Code typefaces are specifically designed for use in
				 * programming and other technical applications. These typefaces are
				 * characterized by their monospaced design, which means that all
				 * letters and characters have the same width, and their clear, legible
				 * forms.
				 */
				"monospace-code": [
					"ui-monospace",
					"'Cascadia Code'",
					"'Source Code Pro'",
					"Menlo",
					"Consolas",
					"'DejaVu Sans Mono'",
					"monospace",
					...fontEmoji,
				],
				/* Industrial typefaces originated in the late 19th century and was
				 * heavily influenced by the advancements in technology and industry
				 * during that time. Industrial typefaces are characterized by their
				 * bold, sans-serif letterforms, simple and straightforward appearance,
				 * and the use of straight lines and geometric shapes.
				 */
				industrial: [
					"Bahnschrift",
					"'DIN Alternate'",
					"'Franklin Gothic Medium'",
					"'Nimbus Sans Narrow'",
					"sans-serif-condensed",
					"sans-serif",
					...fontEmoji,
				],
				/* Rounded typefaces are characterized by the rounded curved letterforms
				 * and give a softer, friendlier  appearance. The rounded edges give the
				 * typeface a more organic and
				 * playful feel, making it suitable for use in informal or child-friendly
				 * designs. The rounded sans-serif style has been popular since the 1950s,
				 * and it continues to be widely used in advertising, branding, and
				 * other forms of graphic design.
				 */
				"rounded-sans": [
					"ui-rounded",
					"'Hiragino Maru Gothic ProN'",
					"Quicksand",
					"Comfortaa",
					"Manjari",
					"'Arial Rounded MT'",
					"'Arial Rounded MT Bold'",
					"Calibri",
					"source-sans-pro",
					"sans-serif",
					...fontEmoji,
				],
				/* Slab Serif typefaces are characterized by the presence of thick,
				 * block-like serifs on the ends of each letterform. These serifs are
				 * usually unbracketed, meaning they do not have any curved or tapered
				 * transitions to the main stroke of the letter.
				 */
				"slab-serif": [
					"Rockwell",
					"'Rockwell Nova'",
					"'Roboto Slab'",
					"'DejaVu Serif'",
					"'Sitka Small'",
					"serif",
					...fontEmoji,
				],
				/* Antique typefaces, also known as Egyptians, are a subset of serif
				 * typefaces that were popular in the 19th century. They are
				 * characterized by their block-like serifs and thick uniform stroke
				 * weight.
				 */
				antique: [
					"Superclarendon",
					"'Bookman Old Style'",
					"'URW Bookman'",
					"'URW Bookman L'",
					"'Georgia Pro'",
					"Georgia",
					"serif",
					...fontEmoji,
				],
				/* Didone typefaces, also known as Modern typefaces, are characterized
				 * by the high contrast between thick and thin strokes, vertical stress,
				 * and hairline serifs with no bracketing. The Didone style emerged in
				 * the late 18th century and gained popularity during the 19th century.
				 */
				didone: [
					"Didot",
					"'Bodoni MT'",
					"'Noto Serif Display'",
					"'URW Palladio L'",
					"P052",
					"Sylfaen",
					"serif",
					...fontEmoji,
				],
				/* Handwritten typefaces are designed to mimic the look and feel of
				 * handwriting. Despite the vast array of handwriting styles, this font
				 * stack tend to adopt a more informal and everyday style of handwriting.
				 */
				handwritten: [
					"'Segoe Print'",
					"'Bradley Hand'",
					"Chilanka",
					"TSCu_Comic",
					"casual",
					"cursive",
					...fontEmoji,
				],
				emoji: fontEmoji,
			},
			gridTemplateColumns: {
				"auto-fill": "repeat(auto-fill, minmax(0, 1fr))",
				"auto-fill-min-200px": "repeat(auto-fill, minmax(200px, 1fr))",
			},
			gridTemplateRows: {
				masonry: "masonry",
			},
			typography: ({ theme }) => ({
				DEFAULT: {
					css: {
						"p:has(img)": {
							img: {
								margin: "0 auto",
							},
							em: {
								fontSize: theme("fontSize.sm"),
								paddingInline: theme("padding.4"),
								marginBlockStart: theme("margin.1"),
								marginInline: "auto",
								display: "block",
								width: "fit-content",
							},
						},
						"--tw-prose-body": theme("colors.blackish"),
						"--tw-prose-headings": theme("colors.blackish"),
						"--tw-prose-lead": theme("colors.blackish"),
						"--tw-prose-links": theme("colors.blackish"),
						"--tw-prose-bold": theme("colors.blackish"),
						"--tw-prose-counters": theme("colors.blackish"),
						"--tw-prose-bullets": theme("colors.blackish"),
						"--tw-prose-hr": theme("colors.blackish"),
						"--tw-prose-quotes": theme("colors.blackish"),
						"--tw-prose-quote-borders": theme("colors.blackish"),
						"--tw-prose-captions": theme("colors.blackish"),
						"--tw-prose-code": theme("colors.blackish"),
						"--tw-prose-pre-code": theme("colors.blackish"),
						"--tw-prose-pre-bg": theme("colors.blackish"),
						"--tw-prose-th-borders": theme("colors.blackish"),
						"--tw-prose-td-borders": theme("colors.blackish"),
						"--tw-prose-invert-body": theme("colors.sepia"),
						"--tw-prose-invert-headings": theme("colors.sepia"),
						"--tw-prose-invert-lead": theme("colors.sepia"),
						"--tw-prose-invert-links": theme("colors.sepia"),
						"--tw-prose-invert-bold": theme("colors.sepia"),
						"--tw-prose-invert-counters": theme("colors.sepia"),
						"--tw-prose-invert-bullets": theme("colors.sepia"),
						"--tw-prose-invert-hr": theme("colors.sepia"),
						"--tw-prose-invert-quotes": theme("colors.sepia"),
						"--tw-prose-invert-quote-borders": theme("colors.sepia"),
						"--tw-prose-invert-captions": theme("colors.sepia"),
						"--tw-prose-invert-code": theme("colors.sepia"),
						"--tw-prose-invert-pre-code": theme("colors.sepia"),
						"--tw-prose-invert-pre-bg": "rgb(0 0 0 / 50%)",
						"--tw-prose-invert-th-borders": theme("colors.sepia"),
						"--tw-prose-invert-td-borders": theme("colors.sepia"),
					},
				},
			}),
		},
	},
	plugins: [typography()],
};
