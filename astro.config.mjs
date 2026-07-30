import { defineConfig, fontProviders } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

/**
 * Canonical origin. Change this and the CNAME together if the domain changes;
 * it feeds the sitemap, robots.txt and every canonical/OG URL.
 */
const SITE = process.env.SITE_URL ?? 'https://akshatvalse.com';

export default defineConfig({
  site: SITE,
  trailingSlash: 'never',
  build: { format: 'file' },

  integrations: [
    mdx(),
    // /cv redirects, so it does not belong in a sitemap of indexable pages.
    sitemap({ filter: (page) => !page.endsWith('/cv') }),
  ],

  markdown: {
    remarkPlugins: [remarkMath],
    // `output: 'html'` — no MathML duplicate. KaTeX's HTML output is what the
    // CSS styles, and shipping both doubles the DOM for screen readers.
    rehypePlugins: [[rehypeKatex, { output: 'html', strict: 'ignore' }]],
    shikiConfig: { theme: 'github-light', wrap: true },
  },

  experimental: {
    fonts: [
      {
        // Display: wide low-contrast grotesque. The width axis has to be asked
        // for explicitly — a plain `weights` request returns a weight-only
        // instance and `font-variation-settings: 'wdth'` then does nothing.
        // Range requested rather than a pinned value so the axis survives into
        // the shipped file and CSS stays in control of the width.
        provider: fontProviders.google(),
        name: 'Archivo',
        cssVariable: '--font-display',
        weights: [600],
        styles: ['normal'],
        subsets: ['latin'],
        fallbacks: ['Helvetica Neue', 'Arial', 'sans-serif'],
        optimizedFallbacks: true,
        // Only the extra axis goes here; `weights` above already contributes
        // wght, and naming it twice produces a malformed Google Fonts request.
        options: {
          experimental: {
            variableAxis: { wdth: [['100', '125']] },
          },
        },
      },
      {
        // Body: transitional serif drawn for screen text. Shares Computer
        // Modern's skeleton with hairlines that survive at 16px.
        provider: fontProviders.google(),
        name: 'Source Serif 4',
        cssVariable: '--font-body',
        weights: ['400 700'],
        styles: ['normal'],
        subsets: ['latin'],
        fallbacks: ['Georgia', 'Times New Roman', 'serif'],
        optimizedFallbacks: true,
      },
      {
        // Italic is its own family purely so it is not preloaded: <Font preload>
        // covers every face of a family, and the italic is 51KB on the critical
        // path for pages that never set a word in it. Declared here, it is
        // fetched lazily by the pages that actually use italics.
        provider: fontProviders.google(),
        name: 'Source Serif 4',
        cssVariable: '--font-body-italic',
        weights: ['400 700'],
        styles: ['italic'],
        subsets: ['latin'],
        fallbacks: ['Georgia', 'Times New Roman', 'serif'],
        optimizedFallbacks: true,
      },
      {
        // Mono: metadata rail, code, and the numeric simulation readouts.
        provider: fontProviders.google(),
        name: 'IBM Plex Mono',
        cssVariable: '--font-mono',
        weights: [400, 500],
        styles: ['normal'],
        subsets: ['latin'],
        fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        optimizedFallbacks: true,
      },
    ],
  },

  vite: {
    build: {
      // The simulation islands are the only JS on the site. Keep them as
      // separate chunks so a page that has no figure downloads no physics.
      assetsInlineLimit: 2048,
    },
  },
});
