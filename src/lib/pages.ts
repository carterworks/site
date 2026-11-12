export type PageMetadata = {
  description?: string;
  id: string;
  /** For a card whose text is not the og:title; defaults to it. */
  ogImageAlt?: string;
  ogType?: "article" | "website";
  ogTitle: string;
  title: string;
};

export const pages: Record<string, PageMetadata> = {
  "/": {
    description: "A developer from Utah.",
    id: "index",
    ogImageAlt: "Carter McBride, over a range of pixel peaks",
    ogTitle: "carter.works",
    ogType: "website",
    title: "Carter McBride | carter.works",
  },
  "/blog/": {
    description: "A software engineer's blog? How original.",
    id: "blog",
    ogTitle: "Blog",
    ogType: "website",
    title: "Blog | carter.works",
  },
  "/play/": {
    description: "The pixel backdrop, full-screen.",
    id: "play",
    ogTitle: "Playground",
    title: "Playground | carter.works",
  },
};

export function getPageMetadata(path: string): PageMetadata | undefined {
  return pages[path] ?? pages[path.endsWith("/") ? path : `${path}/`];
}
