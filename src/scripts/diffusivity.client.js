/**
 * Effective-diffusivity island.
 *
 * Runs 1D overdamped Langevin dynamics in V(x) = cos x at beta = 1 across
 * independent replicas and plots the mean-squared-displacement estimator
 *
 *     D_hat(t) = E[(X_t - X_0)^2] / 2t
 *
 * against the Lifson-Jackson value 1/I_0(1)^2 = 0.6238603604..., drawn as a
 * horizontal reference. The shaded band is +/- one standard error taken from
 * four disjoint replica groups, so the reader can see how much of the residual
 * is Monte Carlo noise and how much is the transient.
 *
 * The trace is not smoothed. The estimator's systematic part decays on the
 * barrier-crossing timescale, and hiding that would misrepresent it.
 */

import { DiffusivitySim, D_EFF_EXACT } from '../sim/diffusivity.js';

const GROUPS = 4;
const REPLICAS = 1024;
const T_MIN = 0.2;
const T_MAX = 1000;
const SAMPLES = 260;
const STEPS_PER_FRAME = 90;
const Y_LO = 0.4, Y_HI = 1.2;

/** Log-spaced sampling schedule. */
const schedule = Array.from({ length: SAMPLES }, (_, i) =>
  Math.exp(Math.log(T_MIN) + ((Math.log(T_MAX) - Math.log(T_MIN)) * i) / (SAMPLES - 1))
);

export function mountDiffusivity(root) {
  const canvas = root.querySelector('canvas[data-layer="plot"]');
  const poster = root.querySelector('[data-poster]');
  const readout = root.querySelector('[data-readout]');
  if (!canvas) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  let sim, points, next, dpr = 1, w = 0, h = 0;
  let running = false, visible = false, started = false, done = false, raf = 0;

  const css = () => {
    const cs = getComputedStyle(root);
    return {
      ink: cs.color,
      muted: cs.getPropertyValue('--ink-2').trim() || '#59636a',
      rule: cs.getPropertyValue('--rule').trim() || '#cfd6d7',
      mono: cs.getPropertyValue('--font-mono')
        ? `${cs.getPropertyValue('--font-mono').trim()}, monospace`
        : 'monospace',
    };
  };

  function layout() {
    const rect = root.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.round(rect.width * dpr);
    h = Math.round(rect.height * dpr);
    canvas.width = w; canvas.height = h;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    return true;
  }

  function reset() {
    sim = new DiffusivitySim({ replicas: REPLICAS });
    points = [];
    next = 0;
    done = false;
  }

  // --- geometry -------------------------------------------------------------
  const pad = () => ({
    l: 48 * dpr, r: 16 * dpr, t: 26 * dpr, b: 32 * dpr,
  });
  const xOf = (t) => {
    const p = pad();
    const u = (Math.log(t) - Math.log(T_MIN)) / (Math.log(T_MAX) - Math.log(T_MIN));
    return p.l + u * (w - p.l - p.r);
  };
  const yOf = (d) => {
    const p = pad();
    const u = (d - Y_LO) / (Y_HI - Y_LO);
    return h - p.b - u * (h - p.t - p.b);
  };

  function drawAxes(c) {
    const p = pad();
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = c.rule;
    ctx.fillStyle = c.muted;
    ctx.font = `${11 * dpr}px ${c.mono}`;

    // y ticks
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const d of [0.4, 0.6, 0.8, 1.0, 1.2]) {
      const y = Math.round(yOf(d)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p.l, y); ctx.lineTo(w - p.r, y); ctx.stroke();
      ctx.fillText(d.toFixed(1), p.l - 7 * dpr, y);
    }

    // x ticks: decades, with minor ticks between
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let e = -1; e <= 3; e++) {
      for (let m = 1; m <= 9; m++) {
        const t = m * Math.pow(10, e);
        if (t < T_MIN || t > T_MAX) continue;
        const x = Math.round(xOf(t)) + 0.5;
        const major = m === 1;
        ctx.beginPath();
        ctx.moveTo(x, h - p.b);
        ctx.lineTo(x, h - p.b + (major ? 6 : 3) * dpr);
        ctx.stroke();
        if (major) ctx.fillText(String(t), x, h - p.b + 9 * dpr);
      }
    }

    ctx.beginPath();
    ctx.moveTo(p.l, h - p.b + 0.5); ctx.lineTo(w - p.r, h - p.b + 0.5);
    ctx.strokeStyle = c.muted;
    ctx.stroke();

    // axis titles
    ctx.save();
    ctx.translate(11 * dpr, (h - p.b + p.t) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('D_hat(t)', 0, 0);
    ctx.restore();
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('t', w - p.r, h - p.b - 4 * dpr);
  }

  function drawReference(c) {
    const y = yOf(D_EFF_EXACT);
    const p = pad();
    ctx.save();
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(p.l, y); ctx.lineTo(w - p.r, y);
    ctx.stroke();
    ctx.restore();
    // Left-aligned: at small t the trace sits near 1.0, so the space just
    // above the reference line is empty there and occupied on the right.
    ctx.fillStyle = c.ink;
    ctx.font = `${11 * dpr}px ${c.mono}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('D_eff = 1/I₀(1)² = 0.62386', p.l + 5 * dpr, y - 5 * dpr);
  }

  function drawTrace(c) {
    if (points.length < 2) return;

    // +/- 1 s.e. band from the disjoint replica groups
    ctx.fillStyle = c.muted;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p0 = points[i];
      const x = xOf(p0.t), y = yOf(Math.min(Y_HI, p0.d + p0.se));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let i = points.length - 1; i >= 0; i--) {
      const p0 = points[i];
      ctx.lineTo(xOf(p0.t), yOf(Math.max(Y_LO, p0.d - p0.se)));
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = c.ink;
    ctx.lineWidth = Math.max(1.1, 1.25 * dpr);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p0 = points[i];
      const x = xOf(p0.t), y = yOf(Math.max(Y_LO, Math.min(Y_HI, p0.d)));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function render() {
    const c = css();
    ctx.clearRect(0, 0, w, h);
    drawAxes(c);
    drawTrace(c);
    drawReference(c);
  }

  function sample() {
    const g = REPLICAS / GROUPS;
    const per = [];
    for (let k = 0; k < GROUPS; k++) per.push(sim.estimate(k * g, (k + 1) * g));
    const d = sim.estimate();
    const m = per.reduce((a, v) => a + v, 0) / GROUPS;
    const sd = Math.sqrt(per.reduce((a, v) => a + (v - m) ** 2, 0) / (GROUPS - 1));
    points.push({ t: sim.t, d, se: sd / Math.sqrt(GROUPS) });
    if (readout) {
      readout.querySelector('[data-t]').textContent = sim.t < 10 ? sim.t.toFixed(1) : sim.t.toFixed(0);
      readout.querySelector('[data-d]').textContent = d.toFixed(4);
    }
  }

  function frame() {
    if (!running) return;
    // Advance only as far as the next scheduled sample, capped. The schedule is
    // log-spaced, so early intervals are a couple of steps and late ones are
    // hundreds; stepping a fixed 90 would collapse the whole left half of the
    // axis onto a single point.
    const target = next < schedule.length ? schedule[next] : T_MAX;
    const need = Math.max(1, Math.ceil((target - sim.t) / sim.dt));
    sim.advance(Math.min(STEPS_PER_FRAME, need));
    while (next < schedule.length && sim.t >= schedule[next]) {
      sample();
      next++;
    }
    render();
    if (sim.t >= T_MAX) { running = false; done = true; return; }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || done) return;
    if (!started) {
      started = true;
      if (poster) poster.style.display = 'none';
      canvas.hidden = false;
    }
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function sync() {
    if (visible && !document.hidden && !done) start(); else stop();
  }

  if (!layout()) return;
  reset();

  const io = new IntersectionObserver(
    (e) => { visible = e[0].isIntersecting; sync(); },
    { rootMargin: '64px' }
  );
  io.observe(root);
  document.addEventListener('visibilitychange', sync);

  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (layout() && started) render(); }, 180);
  }).observe(root);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (started) render();
  });
}

for (const el of document.querySelectorAll('[data-sim="diffusivity"]')) mountDiffusivity(el);
