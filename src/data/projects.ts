/**
 * The six research projects, in display order. One entry per page under
 * /research/<slug>. Card text is taken from the public site and the public
 * GitHub write-ups; the page itself carries the detail and the sources.
 */
export type Cover =
  | { kind: 'trap' }
  | { kind: 'image'; src: string; dark?: string; alt: string; fit?: 'cover' | 'contain' }
  | { kind: 'svg'; name: 'raretail' | 'diffusivity' }
  | { kind: 'tex'; tex: string; label: string };

export interface Project {
  slug: string;
  title: string;
  short: string;
  advisor: string;
  dept: 'Computer Science' | 'Mathematics';
  status: 'Preprint' | 'Ongoing';
  dates: string;
  oneLiner: string;
  tags: string[];
  cover: Cover;
}

export const PROJECTS: Project[] = [
  {
    slug: 'inside-the-trap',
    title: 'Inside the Trap: a renewal law for prefix-cache collapse in LLM agent serving',
    short: 'Inside the Trap',
    advisor: 'Ali Jannesari',
    dept: 'Computer Science',
    status: 'Preprint',
    dates: 'Aug. 2026 – present',
    oneLiner:
      'Why a burst of agent traffic can leave an LLM serving engine stuck at a load it served before, a renewal law for the trapped state, and a session cap that gets it out.',
    tags: ['LLM serving', 'KV cache', 'queueing', 'registered experiments'],
    cover: { kind: 'trap' },
  },
  {
    slug: 'langevin',
    title: 'Langevin sampling: discretization bias and transport coefficients',
    short: 'Langevin sampling',
    advisor: 'David Herzog',
    dept: 'Mathematics',
    status: 'Ongoing',
    dates: 'May 2026 – present',
    oneLiner:
      'The sampler underneath SGLD, annealed Langevin and diffusion correctors, measured where its errors are computable: bias against exact stationary laws, and effective diffusivity.',
    tags: ['MCMC', 'SDEs', 'diffusion models'],
    cover: { kind: 'image', src: '/poster/hero-light-720.webp', dark: '/poster/hero-dark-720.webp', alt: 'Particles in a periodic potential under overdamped Langevin dynamics.' },
  },
  {
    slug: 'large-deviations',
    title: 'Large deviations and rare events in mean-field queueing',
    short: 'Rare events',
    advisor: 'Ruoyu Wu',
    dept: 'Mathematics',
    status: 'Ongoing',
    dates: 'Nov. 2024 – present',
    oneLiner:
      'Rate functionals for the empirical measure of a mean-field system, used to build importance samplers for events too rare for direct simulation to reach.',
    tags: ['large deviations', 'importance sampling', 'load balancing'],
    cover: { kind: 'svg', name: 'raretail' },
  },
  {
    slug: 'neural-pde-stability',
    title: 'Stability of neural approximations to evolution equations',
    short: 'Learned PDE solvers',
    advisor: 'Jue Yan',
    dept: 'Mathematics',
    status: 'Ongoing',
    dates: 'May 2026 – present',
    oneLiner:
      'Conservation in a cell-average neural network solver is architectural; stability is not. Adapting von Neumann analysis to say which trained networks survive a long rollout.',
    tags: ['numerical analysis', 'neural operators', 'stability'],
    cover: {
      kind: 'tex',
      tex: String.raw`\bar v_j^{\,n+1} = \bar v_j^{\,n} - \tfrac{\Delta t}{\Delta x}\big[\mathcal{N}(V_{j+\frac12};\Theta) - \mathcal{N}(V_{j-\frac12};\Theta)\big]`,
      label: 'The cell-average update: the same network is evaluated at both faces of a cell.',
    },
  },
  {
    slug: 'online-calibration',
    title: 'Online calibration of neural volatility forecasts with early, one-sided feedback',
    short: 'Early-feedback calibration',
    advisor: 'Hongyang Gao',
    dept: 'Computer Science',
    status: 'Ongoing',
    dates: 'Aug. 2026 – present',
    oneLiner:
      'A cumulative forecast is scored only at the horizon, but a miss is certain the moment the running sum crosses the bound. A calibration layer that learns from those early misses.',
    tags: ['conformal prediction', 'delayed feedback', 'forecasting'],
    cover: {
      kind: 'tex',
      tex: String.raw`S_t=\textstyle\sum_{s\le t}\Delta_s,\;\; \Delta_s\ge 0 \;\Rightarrow\; S_t>\hat q \text{ is final}`,
      label: 'With non-negative increments, crossing the issued bound early makes the miss certain.',
    },
  },
  {
    slug: 'agent-reliability',
    title: 'Reliability of tool-using LLM agents',
    short: 'Agent reliability',
    advisor: 'Yang Li',
    dept: 'Computer Science',
    status: 'Ongoing',
    dates: 'Aug. 2026 – present',
    oneLiner:
      'When an agent stalls, when is restarting worth more than waiting, and how do you estimate a failure probability too small for direct simulation to reach?',
    tags: ['survival analysis', 'rare events', 'agent evaluation'],
    cover: {
      kind: 'tex',
      tex: String.raw`\mathbb{E}[T_\tau]=\frac{\mathbb{E}[\min(T,\tau)]}{\mathbb{P}(T\le\tau)}`,
      label: 'Expected completion time when a run is restarted at cutoff tau.',
    },
  },
];

export const bySlug = (slug: string) => {
  const p = PROJECTS.find((x) => x.slug === slug);
  if (!p) throw new Error(`unknown project ${slug}`);
  return p;
};

export const neighbours = (slug: string) => {
  const i = PROJECTS.findIndex((x) => x.slug === slug);
  return { prev: PROJECTS[i - 1], next: PROJECTS[i + 1] };
};
