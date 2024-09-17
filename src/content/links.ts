export default [
	{
		attrs: {
			rel: "me",
			href: "https://mastodon.social/@literallyacar",
		},
		text: "Mastodon",
	},
	{
		attrs: {
			href: "https://github.com/carterworks",
		},
		text: "GitHub",
	},
	{
		attrs: {
			href: "https://www.linkedin.com/in/thatcartermcbride/",
		},
		text: "LinkedIn",
	},
	{
		attrs: {
			href: "/blog",
		},
		text: "Blog",
	},
	{
		attrs: {
			href: "/yazzy",
		},
		text: "Yazzy",
	},
]
	.map((link) => ({ ...link, isExternal: link.attrs.href.startsWith("http") }))
	.sort((a, b) => a.text.localeCompare(b.text));
