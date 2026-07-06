import { getBlogFeed } from "../../lib/feed";

export async function GET(context: { site: string }) {
  const feed = await getBlogFeed(context.site, "rss");

  return new Response(feed.rss2(), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
