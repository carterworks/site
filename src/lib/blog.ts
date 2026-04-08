import { DEV } from "astro:env/client";
import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

/**
 * Filters out draft posts in production.
 * In development mode (DEV=true), all posts are shown.
 */
export function filterPublishedPosts(posts: BlogPost[]): BlogPost[] {
  return posts.filter((post) => (DEV ? true : post.data.draft !== true));
}

/**
 * Sorts posts by publication date, newest first.
 */
export function sortPostsByDate(posts: BlogPost[]): BlogPost[] {
  return posts.toSorted(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );
}

/**
 * Gets all published blog posts, sorted by date (newest first).
 * Filters out drafts in production.
 */
export async function getPublishedPosts(): Promise<BlogPost[]> {
  const allPosts = await getCollection("blog");
  return sortPostsByDate(filterPublishedPosts(allPosts));
}
