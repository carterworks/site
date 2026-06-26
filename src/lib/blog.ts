import { DEV } from "astro:env/client";
import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

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
