import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./content/blog" }),
  schema: z.object({
    title: z.string().nullable().optional(),
    draft: z.boolean().default(false),
    pubDate: z.coerce.date(),
  }),
});

const data = defineCollection({
  loader: glob({ pattern: "*.yml", base: "./content/data" }),
  schema: z.object({
    home: z.object({
      title: z.string(),
      description: z.string(),
      subtitles: z.array(z.string()).min(1),
      intro: z.object({
        heading: z.string(),
        body: z.string(),
      }),
      projects: z.object({
        heading: z.string(),
        items: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            description: z.string(),
          }),
        ),
      }),
      socialFeed: z.object({
        heading: z.string(),
        url: z.string(),
        feedUrl: z.string(),
        count: z.number().int().positive(),
      }),
    }),
  }),
});

export const collections = { blog, data };
