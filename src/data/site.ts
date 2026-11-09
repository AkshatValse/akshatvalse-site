/**
 * Facts about the person and the links that appear site-wide. Every value here
 * is taken from the CV (cv/cv.tex) or the public GitHub profile; edit there and
 * here together.
 */
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

/** As on shikun.io: Home · Projects · Résumé · About (here Research and CV). */
export const NAV = [
  { href: '/', label: 'Home' },
  { href: '/research', label: 'Research' },
  { href: '/cv', label: 'CV' },
  { href: '/about', label: 'About' },
] as const;
