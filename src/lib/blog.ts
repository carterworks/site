import { DEV } from "astro:env/client";
import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

const DERIVED_TITLE_MAX_WORDS = 15;
export function getPostTitle(post: BlogPost): string {
  const title = post.data.title?.trim();
  if (title) return title;

  const firstLine = post.body
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine)
    return `Post from ${post.data.pubDate.toISOString().slice(0, 10)}`;

  const derivedTitle = firstLine
    .replace(/^#+\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();

  const words = derivedTitle.split(/\s+/);
  return words.length > DERIVED_TITLE_MAX_WORDS
    ? `${words.slice(0, DERIVED_TITLE_MAX_WORDS).join(" ")}…`
    : derivedTitle;
}

export function filterPublishedPosts(posts: BlogPost[]): BlogPost[] {
  return posts.filter((post) => (DEV ? true : post.data.draft !== true));
}

export function sortPostsByDate(posts: BlogPost[]): BlogPost[] {
  return posts.toSorted(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );
}

export async function getPublishedPosts(): Promise<BlogPost[]> {
  const allPosts = await getCollection("blog");
  return sortPostsByDate(filterPublishedPosts(allPosts));
}
