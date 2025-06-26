import { defineCollection, z } from "astro:content";
const blog = defineCollection({
	type: "content",
	schema: z.object({
		title: z.string().optional(),
		pubDate: z.date(),
		description: z.string().optional(),
		tags: z.array(z.string()).optional(),
	}),
});
export const collections = { blog };
