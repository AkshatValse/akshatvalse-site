/**
 * Facts about the person and the links that appear site-wide. Every value here
 * is taken from the CV (cv/cv.tex) or the public GitHub profile; edit there and
 * here together.
 */
/**
 * Revision of the social cards in public/og/ (scripts/gen-og.mjs names the files
 * <slug>-r<OG_REV>.png). Bump it whenever the cards are regenerated: Cloudflare
 * and the social sites cache /og/* by URL for days, so a changed card needs a new name.
 */
export const OG_REV = 2;

export const PROFILE = {
  name: 'Akshat Valse',
  fullName: 'Akshat Sachin Valse',
  role: 'Undergraduate researcher',
  affiliation: 'Iowa State University, Honors Program',
  tagline: 'Applied probability for the systems that run machine learning',
  degrees: 'B.S. Statistics · B.S. Mathematics · B.A. Computer Science · B.S. Data Science',
  status: 'Applying to PhD programs for Fall 2028 admission',
  graduation: 'B.S. expected May 2028',
  email: 'avalse@iastate.edu',
  github: 'https://github.com/AkshatValse',
  linkedin: 'https://linkedin.com/in/akshat-sachin-valse',
  cvPdf: '/akshat-valse-cv-2026-11.pdf',
  portrait: { src: '/img/portrait-960.webp', srcSmall: '/img/portrait-480.webp', width: 960, height: 1200 },
} as const;

export const ARXIV_TRAP = 'https://arxiv.org/abs/2611.08902';
export const REPO_TRAP = 'https://github.com/AkshatValse/surviving-llm-stampede';

/** Home · About · Research · CV (the owner moved About up, next to Home). */
export const NAV = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
  { href: '/research', label: 'Research' },
  { href: '/cv', label: 'CV' },
] as const;
