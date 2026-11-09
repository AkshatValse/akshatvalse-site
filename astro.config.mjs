import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

/**
 * Canonical origin. Change this if the domain changes; it feeds the sitemap and
 * every canonical/OG URL. public/robots.txt hard-codes the domain separately.
 */
const SITE = process.env.SITE_URL ?? 'https://akshatvalse.com';

export default defineConfig({
  site: SITE,
  trailingSlash: 'never',
  build: { format: 'file' },

  integrations: [mdx(), sitemap()],

  markdown: {
    remarkPlugins: [remarkMath],
    // KaTeX's default 'htmlAndMathml': the HTML copy is aria-hidden and the
    // MathML copy (visually clipped by katex.css) is what screen readers read.
    rehypePlugins: [[rehypeKatex, { output: 'htmlAndMathml', strict: 'ignore' }]],
    shikiConfig: { theme: 'github-light', wrap: true },
  },

  // Fonts come from the Clarity template's own stylesheet (Poppins and Fira
  // Code from Google Fonts, Charter self-hosted under public/clarity/).

  vite: {
    build: {
      // The simulation islands are the only JS on the site. Keep them as
      // separate chunks so a page that has no figure downloads no physics.
      // 0: never inline. Small component scripts (Slides, Selector) would
      // otherwise be inlined and blocked by the CSP in public/_headers, which
      // allows scripts only from 'self' and cdnjs.
      assetsInlineLimit: 0,
    },
  },
});
