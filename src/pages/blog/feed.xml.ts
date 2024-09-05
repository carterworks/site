import { getCollection } from "astro:content";
import rss from "@astrojs/rss";
import type { RSSFeedItem } from "@astrojs/rss";

export async function GET(context: { site: string }) {
	const posts = await getCollection("blog");
	return rss({
		title: "Carter's Blog",
		description: "A software engineer's blog? How original.",
		site: context.site,
		items: posts.map(
			(post) =>
				({
					title: post.data.title,
					pubDate: post.data.pubDate,
					link: `/blog/${post.slug}`,
					description: post.data.description,
					categories: post.data.tags,
					author: "Carter McBride",
					content: `<p>${post.data.description}</p>
			<p><a href="${`${context.site}blog/${post.slug}`}">Read more</a></p>`,
				}) satisfies RSSFeedItem,
		),
		customData: "<language>en-us</language>",
	});
}
