/**
 * The three project colour schemes, taken from shikun.io's own project pages
 * (the owner's choice, Nov. 2026): the title card of /projects/kaleido, and the
 * colours of /projects/multi-task-attention-network and
 * /projects/variational-shape-learner. Every project uses one of these three.
 *
 *   band   – inline style of the project page's title band (#first-content)
 *   frame  – inline style of the cover frame on the Research grid
 *   pill   – inline style of the project's pill in running text (About page)
 *   button – background of the link buttons on the band
 *   ink    – 'light' puts white text on the band and pill (Clarity's blog-title.white)
 */
export type ThemeName = 'kaleido' | 'mtan' | 'vsl';

export interface Theme {
  ink: 'dark' | 'light';
  band: string;
  frame: string;
  pill: string;
  button: string;
}

/** shikun.io/projects/kaleido, #first-content, verbatim. */
const KALEIDO_CARD =
  'background: radial-gradient(circle at 50% 50%, #9bd4e5 0%, #5fa9d4 80%), ' +
  'linear-gradient(120deg, #a8d5a2 0%, #d6eac7 50%, transparent 100%), ' +
  'linear-gradient(200deg, #f8c7d8 15%, #e1c4f4 40%, transparent 80%), ' +
  'linear-gradient(45deg, #fff4d6 0%, #fceabb 30%, transparent 70%); ' +
  'background-blend-mode: overlay, lighten, screen, normal;';

export const THEMES: Record<ThemeName, Theme> = {
  kaleido: {
    ink: 'dark',
    band: KALEIDO_CARD,
    frame: KALEIDO_CARD,
    // The card's pink, lilac and blue stops, as a gradient small enough for a word.
    pill: 'background: linear-gradient(110deg, #f8c7d8 0%, #e1c4f4 45%, #9bd4e5 100%);',
    button: 'rgba(255, 255, 255, 1)',
  },
  mtan: {
    ink: 'light',
    band: 'background-color: rgba(15, 37, 64, 1.0);',
    frame: 'background-color: rgba(15, 37, 64, 1.0);',
    pill: 'background-color: rgba(15, 37, 64, 1.0);',
    button: 'rgba(255, 255, 255, 0.1)',
  },
  vsl: {
    ink: 'dark',
    band: 'background-color: rgba(145, 152, 159, 0.15);',
    frame: 'background-color: rgba(145, 152, 159, 1.0);',
    pill: 'background-color: rgba(145, 152, 159, 0.3);',
    button: 'rgba(145, 152, 159, 0.15)',
  },
};
