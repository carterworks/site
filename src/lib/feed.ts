import { getPostTitle, getPublishedPosts, type BlogPost } from "./blog";
import { createSatteriMarkdownProcessor } from "@astrojs/markdown-satteri";
import { Feed } from "feed";
import sanitizeHtml from "sanitize-html";

const feeds = new Map<string, Promise<Feed>>();
const markdownProcessor = createSatteriMarkdownProcessor();
type FeedFormat = "atom" | "rss";

function absolutizeUrl(url: string, site: string) {
  if (/^(#|[a-z][a-z\d+.-]*:)/i.test(url)) {
    return url;
  }

  return new URL(url, site).href;
}

function absolutizeSrcset(srcset: string, site: string) {
  return srcset
    .split(",")
    .map((candidate) => {
      const [url, ...descriptors] = candidate.trim().split(/\s+/);
      return [absolutizeUrl(url, site), ...descriptors].join(" ");
    })
    .join(", ");
}

function absolutizeHtmlUrls(html: string, site: string) {
  return html.replace(
    /(srcset|src|href)=["']([^"']+)["']/g,
    (_, attribute, url) => {
      if (attribute === "srcset") {
        return `${attribute}="${absolutizeSrcset(url, site)}"`;
      }

      return `${attribute}="${absolutizeUrl(url, site)}"`;
    },
  );
}

async function renderPostContent(post: BlogPost, site: string) {
  const processor = await markdownProcessor;
  const { code } = await processor.render(post.body ?? "", {
    frontmatter: post.data,
  });

  return sanitizeHtml(absolutizeHtmlUrls(code, site), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      h1: ["id"],
      h2: ["id"],
      h3: ["id"],
      h4: ["id"],
      h5: ["id"],
      h6: ["id"],
      img: [
        "src",
        "srcset",
        "sizes",
        "alt",
        "title",
        "width",
        "height",
        "loading",
        "decoding",
      ],
    },
  });
}

export async function createBlogFeed(
  posts: BlogPost[],
  site: string,
  format: FeedFormat = "atom",
) {
  const siteUrl = new URL("/blog/", site).href;
  const atomUrl = new URL("/blog/atom.xml", site).href;
  const rssUrl = new URL("/blog/rss.xml", site).href;
  const feed = new Feed({
    title: "Carter's Blog",
    description: "A software engineer's blog? How original.",
    id: siteUrl,
    link: siteUrl,
    language: "en-us",
    updated: posts[0]?.data.pubDate,
    copyright: `©️ Carter McBride ${new Date().getFullYear()}`,
    author: {
      name: "Carter McBride",
    },
    feedLinks: {
      atom: atomUrl,
      rss: rssUrl,
    },
    feed: format === "atom" ? atomUrl : rssUrl,
  });

  for (const post of posts) {
    if (!post.body) continue;

    const link = new URL(`/blog/${post.id}/`, site).href;

    feed.addItem({
      title: getPostTitle(post),
      id: link,
      link,
      date: post.data.pubDate,
      content: await renderPostContent(post, site),
    });
  }

  return feed;
}

export function getBlogFeed(site: string, format: FeedFormat = "atom") {
  const cacheKey = `${format}:${new URL(site).href}`;
  const feed = feeds.get(cacheKey) ?? createCachedBlogFeed(site, format);
  feeds.set(cacheKey, feed);
  return feed;
}

async function createCachedBlogFeed(site: string, format: FeedFormat) {
  return createBlogFeed(await getPublishedPosts(), site, format);
}
