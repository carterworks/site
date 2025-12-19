import { DEV } from "astro:env/client";
import { getCollection } from "astro:content";
import rss from "@astrojs/rss";
import sanitizeHtml from 'sanitize-html';
import MarkdownIt from 'markdown-it';
const parser = new MarkdownIt();

export async function GET(context: { site: string }) {
  const posts = (await getCollection("blog")).filter((e) =>
    DEV ? true : e.data.draft !== true,
  ).reverse();
  return rss({
    title: "Carter's Blog",
    description: "A software engineer's blog? How original.",
    site: context.site,
    items: posts.filter((post) => !!post.body).map(
      (post) => {
        const renderedContent = parser.render(post.body!);
        const absoluteContent = renderedContent.replace(
          /src=["']\.?\/?([^"']+)["']/g,
          (match, url) => {
            if (url.startsWith('http://') || url.startsWith('https://')) {
              return match;
            }
            const absoluteUrl = new URL(url, context.site).href;
            return `src="${absoluteUrl}"`;
          }
        ).replace(
          /href=["']\.?\/?([^"']+)["']/g,
          (match, url) => {
            if (url.startsWith('#') || url.startsWith('mailto:') ||
              url.startsWith('http://') || url.startsWith('https://')) {
              return match;
            }
            const absoluteUrl = new URL(url, context.site).href;
            return `href="${absoluteUrl}"`;
          }
        );

        return {
          title: post.data.title ?? "A post from Carter's blog",
          pubDate: post.data.pubDate,
          link: `/blog/${post.id}`,
          description: post.data.description ?? "",
          categories: post.data.tags ?? [],
          content: sanitizeHtml(absoluteContent, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img'])
          }),
        };
      }
    ),
    customData: "<language>en-us</language>",
  });
}
