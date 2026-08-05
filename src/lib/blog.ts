import { DEV } from "astro:env/client";
import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

const DERIVED_TITLE_MAX_WORDS = 15;

function markdownToText(markdown: string): string {
  return (
    markdown
      // Remove inline HTML tags.
      .replace(/<[^>]*>/g, "")
      // Keep link text, discard link URLs.
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove common Markdown formatting and heading/quote markers.
      .replace(/[`*_~#>]/g, "")
      .trim()
  );
}

export function getPostTitle(post: BlogPost): string {
  const title = post.data.title?.trim();
  if (title) return title;

  const firstLine = post.body
    ?.split(/\r?\n/)
    .find((line) => line.trim());

  if (!firstLine)
    return `Post from ${post.data.pubDate.toISOString().slice(0, 10)}`;

  const derivedTitle = markdownToText(firstLine);

  const words = derivedTitle.split(/\s+/);
  return words.length > DERIVED_TITLE_MAX_WORDS
    ? `${words.slice(0, DERIVED_TITLE_MAX_WORDS).join(" ")}…`
    : derivedTitle;
}

export function getPostDescription(post: BlogPost): string | undefined {
  return post.data.description?.trim() || undefined;
}

export async function getPublishedPosts(): Promise<BlogPost[]> {
  return (await getCollection("blog"))
    .filter((post) => DEV || post.data.draft !== true)
    .toSorted(
      (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
    );
}
