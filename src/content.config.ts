import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const notes = defineCollection({
  loader: glob({ base: './src/content/notes', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    /** One sentence. Shown on the index and in the page description. */
    summary: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    /** Path under public/ to a compiled PDF of the same note, if one exists. */
    pdf: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { notes };
