import { DEV } from "astro:env/client";
import { sanity } from "./sanity";

export interface BlogPost {
  id: string;
  slug: string;
  title: string | null;
  draft: boolean;
  pubDate: Date;
  body: string | null;
  articleClass?: string;
}

interface SanityBlogPost extends Omit<BlogPost, "pubDate"> {
  pubDate: string;
}

const blogPostFields = `
  "id": _id,
  "slug": slug.current,
  title,
  "draft": coalesce(draft, false),
  pubDate,
  body,
  articleClass
`;

/**
 * Filters out draft posts in production.
 * In development mode (DEV=true), all posts are shown.
 */
export function filterPublishedPosts(posts: BlogPost[]): BlogPost[] {
  return posts.filter((post) => (DEV ? true : post.draft !== true));
}

/**
 * Sorts posts by publication date, newest first.
 */
export function sortPostsByDate(posts: BlogPost[]): BlogPost[] {
  return posts.toSorted(
    (a, b) => b.pubDate.getTime() - a.pubDate.getTime(),
  );
}

/**
 * Gets all published blog posts, sorted by date (newest first).
 * Filters out drafts in production.
 */
export async function getPublishedPosts(): Promise<BlogPost[]> {
  const allPosts = await sanity.fetch<SanityBlogPost[]>(
    `*[_type == "post" && defined(slug.current)] | order(pubDate desc) {
      ${blogPostFields}
    }`,
  );

  return sortPostsByDate(
    filterPublishedPosts(
      allPosts.map((post) => ({
        ...post,
        pubDate: new Date(post.pubDate),
      })),
    ),
  );
}
