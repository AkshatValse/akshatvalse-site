/**
 * Home-page lists. Every item is taken from the public CV (src/pages/cv.astro,
 * cv/cv.tex) or the public GitHub profile README, and was checked line by line
 * against them; dates are the ones stated there. Undated awards are not news.
 */
export const NEWS: { date: string; html: string }[] = [
  { date: 'Nov. 2026', html: 'Preprint with Ali Jannesari (SwAPP Lab) posted: <a href="/research/inside-the-trap"><em>Inside the Trap: A Renewal Law for Prefix-Cache Collapse in LLM Agent Serving</em></a>, <a href="https://arxiv.org/abs/2611.08902">arXiv:2611.08902</a>. The code, all real-engine data and every registration are public.' },
  { date: 'Fall 2026', html: 'Taking four PhD-level (6000-series) courses: measure-theoretic probability (STAT 6541) and advanced topics in machine learning (COMS 6730), artificial intelligence (COMS 6720) and high-performance computing (COMS 6250).' },
  { date: 'Aug. 2026', html: 'Started three projects: <a href="/research/inside-the-trap">metastable failures in prefix-cached LLM agent serving</a> with Ali Jannesari, <a href="/research/online-calibration">early-feedback calibration of volatility forecasts</a> with Hongyang Gao, and <a href="/research/agent-reliability">reliability of tool-using LLM agents</a> with Yang Li.' },
  { date: '2026', html: "Dean's High Impact Undergraduate Research Award, Iowa State University." },
  { date: 'May 2026', html: 'Joined David Herzog on <a href="/research/langevin">Langevin sampling and diffusion estimation</a> (funded by NSF award DMS-2246491) and Jue Yan on the <a href="/research/neural-pde-stability">stability of cell-average neural networks for PDEs</a> (funded by the NSF D4 NRT; joint with Mengyuan Yang).' },
  { date: 'Nov. 2024', html: 'Undergraduate Research Fellow with Ruoyu Wu on <a href="/research/large-deviations">large deviations and rare events in queueing systems</a>.' },
  { date: 'Aug. 2024', html: "Entered Iowa State University's Honors Program, working toward four degrees." },
];

/** Manuscripts and their stage. The calibration project is in experiments, so it has none yet. */
export const MANUSCRIPTS: { title: string; authors: string; status: string; href?: string }[] = [
  { title: 'Langevin Dynamics and Transport-Coefficient Estimation for Molecular Systems', authors: 'With D. Herzog, O. Smith and D. Wu', status: 'Draft in advisor review', href: '/research/langevin' },
  { title: 'Stability Certificates for Cell-Average-Based Neural Network Solvers: von Neumann Analysis of Trained Flux Networks', authors: 'With M. Yang and J. Yan', status: 'In preparation', href: '/research/neural-pde-stability' },
  { title: 'Large-Deviation-Guided Importance Sampling for Rare Events in the Mean-Field Join-the-Shortest-Queue Model', authors: 'With R. Wu', status: "Paused during the advisor's sabbatical", href: '/research/large-deviations' },
];

export const AWARDS: string[] = [
  "Dean's High Impact Undergraduate Research Award, 2026",
  'Schillmoeller Family Scholarship in Statistics',
  'Mead Fund Award in Statistics',
  'James L. Cornette Mathematics and Interdisciplinary Studies Award',
  "Dean's List, every semester",
];
