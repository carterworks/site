import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string().nullable().optional(),
    draft: z.boolean().default(false),
    pubDate: z.coerce.date(),
  }),
});
export const collections = { blog };
