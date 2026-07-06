export type PageMetadata = {
  description?: string;
  id: string;
  ogImage?: string | URL;
  ogType?: "article" | "website";
  ogTitle: string;
  title: string;
};

const pages: Record<string, PageMetadata> = {
  "/": {
    description: "A developer from Utah.",
    id: "index",
    ogImage: "/og/index.webp",
    ogTitle: "A developer from Utah.",
    ogType: "website",
    title: "Carter | A developer from Utah.",
  },
  "/blog/": {
    description: "A software engineer's blog? How original.",
    id: "blog",
    ogImage: "/og/blog.webp",
    ogTitle: "All blog posts",
    ogType: "website",
    title: "All blog posts | carter.works",
  },
};

export function getPageMetadata(path: string): PageMetadata | undefined {
  return pages[path] ?? pages[path.endsWith("/") ? path : `${path}/`];
}
