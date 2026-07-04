import { getPublishedPosts } from "../../lib/blog";
import { Feed } from "feed";
import sanitizeHtml from "sanitize-html";
import MarkdownIt from "markdown-it";

const parser = new MarkdownIt();

export async function GET(context: { site: string }) {
  const publishedPosts = await getPublishedPosts();
  const posts = publishedPosts.toReversed();
  const siteUrl = new URL("/blog/", context.site).href;
  const feedUrl = new URL("/blog/feed.xml", context.site).href;
  const feed = new Feed({
    title: "Carter's Blog",
    description: "A software engineer's blog? How original.",
    id: siteUrl,
    link: siteUrl,
    language: "en-us",
    updated: publishedPosts[0]?.data.pubDate,
    copyright: "Copyright Carter McBride",
    author: {
      name: "Carter McBride",
    },
    feedLinks: {
      atom: feedUrl,
    },
    feed: feedUrl,
  });

  posts
    .filter((post) => !!post.body)
    .forEach((post) => {
      const renderedContent = parser.render(post.body!);
      const absoluteContent = renderedContent
        .replace(/src=["']\.?\/?([^"']+)["']/g, (match, url) => {
          if (url.startsWith("http://") || url.startsWith("https://")) {
            return match;
          }
          const absoluteUrl = new URL(url, context.site).href;
          return `src="${absoluteUrl}"`;
        })
        .replace(/href=["']\.?\/?([^"']+)["']/g, (match, url) => {
          if (
            url.startsWith("#") ||
            url.startsWith("mailto:") ||
            url.startsWith("http://") ||
            url.startsWith("https://")
          ) {
            return match;
          }
          const absoluteUrl = new URL(url, context.site).href;
          return `href="${absoluteUrl}"`;
        });
      const link = new URL(`/blog/${post.id}/`, context.site).href;

      feed.addItem({
        title: post.data.title ?? "A post from Carter's blog",
        id: link,
        link,
        date: post.data.pubDate,
        content: sanitizeHtml(absoluteContent, {
          allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
        }),
      });
    });

  return new Response(feed.atom1(), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
    },
  });
}
