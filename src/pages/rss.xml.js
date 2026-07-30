import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

/**
 * Feed for the notes.
 *
 * The readers most likely to matter here still use feed readers, and a feed
 * costs nothing to keep correct. Summaries only: the notes are heavy with
 * KaTeX markup that no reader renders well, and a truncated derivation is
 * worse than a pointer to the real one.
 */
export async function GET(context) {
  const notes = (await getCollection('notes'))
    .filter((n) => !n.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: 'Notes — Akshat Sachin Valse',
    description:
      'Short expository notes on Langevin sampling, diffusion models, rare-event ' +
      'estimation, and the numerical analysis of learned PDE solvers. Every note ' +
      'compares a computed quantity against a closed form.',
    site: context.site,
    trailingSlash: false,
    items: notes.map((n) => ({
      title: n.data.title,
      description: n.data.summary,
      pubDate: n.data.date,
      link: `/notes/${n.id}`,
      author: 'avalse@iastate.edu (Akshat Sachin Valse)',
    })),
    customData: '<language>en-us</language>',
  });
}
