import { getBlogFeed } from "../../lib/feed";

export async function GET(context: { site: string }) {
  const feed = await getBlogFeed(context.site);

  return new Response(feed.atom1(), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
    },
  });
}
