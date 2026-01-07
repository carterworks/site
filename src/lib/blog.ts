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

/**
 * Gets all unique tags from published posts.
 */
export async function getAllTags(): Promise<string[]> {
  const posts = await getPublishedPosts();
  const tags = new Set<string>();
  for (const post of posts) {
    if (post.data.tags) {
      for (const tag of post.data.tags) {
        tags.add(tag);
      }
    }
  }
  return [...tags];
}

/**
 * Gets published posts with a specific tag, sorted by date.
 */
export async function getPostsByTag(tag: string): Promise<BlogPost[]> {
  const posts = await getPublishedPosts();
  return posts.filter((post) => post.data.tags?.includes(tag));
}
