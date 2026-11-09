/**
 * Home-page lists. Every item is taken from the public CV (src/pages/cv.astro,
 * cv/cv.tex) or the paper's arXiv metadata; dates are the ones stated there.
 */
export const NEWS: { date: string; html: string }[] = [
  { date: 'Nov. 2026', html: 'Preprint with Ali Jannesari posted: <a href="/research/inside-the-trap"><em>Inside the Trap</em></a>, a renewal law for prefix-cache collapse in LLM agent serving (<a href="https://arxiv.org/abs/2611.08902">arXiv:2611.08902</a>).' },
  { date: 'Fall 2026', html: 'Taking four PhD-level courses: measure-theoretic probability (STAT 6541) and advanced topics in machine learning, AI and high-performance computing.' },
  { date: 'Aug. 2026', html: 'Started projects with <a href="/research/online-calibration">Hongyang Gao</a> on early-feedback calibration and with <a href="/research/agent-reliability">Yang Li</a> on agent reliability.' },
  { date: '2026', html: "Dean's High Impact Undergraduate Research Award, Iowa State University, for the <a href=\"/research/large-deviations\">rare-event work</a> with Ruoyu Wu." },
  { date: 'May 2026', html: 'Joined David Herzog\'s group on <a href="/research/langevin">Langevin sampling</a> (NSF DMS-2246491) and Jue Yan\'s on <a href="/research/neural-pde-stability">stability of learned PDE solvers</a> (NSF D4 NRT).' },
];

export const MANUSCRIPTS: { title: string; authors: string; href?: string }[] = [
  { title: 'Large-Deviation-Guided Importance Sampling for Rare Events in the Mean-Field Join-the-Shortest-Queue Model', authors: 'With R. Wu', href: '/research/large-deviations' },
  { title: 'Langevin Dynamics and Transport-Coefficient Estimation for Molecular Systems', authors: 'With D. Herzog, O. Smith and D. Wu', href: '/research/langevin' },
  { title: 'Stability Certificates for Cell-Average-Based Neural Network Solvers: von Neumann Analysis of Trained Flux Networks', authors: 'With M. Yang and J. Yan', href: '/research/neural-pde-stability' },
  { title: 'Online Calibration of Neural Volatility Forecasts with Early, One-Sided Feedback', authors: 'In preparation', href: '/research/online-calibration' },
];

export const AWARDS: string[] = [
  "Dean's High Impact Undergraduate Research Award, 2026",
  'Schillmoeller Family Scholarship in Statistics',
  'Mead Fund Award in Statistics',
  'James L. Cornette Mathematics and Interdisciplinary Studies Award',
  "Dean's List, every semester",
];
