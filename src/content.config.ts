import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string().nullable().optional(),
    pubDate: z.coerce.date(),
    description: z.string().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
  }),
});
export const collections = { blog };
