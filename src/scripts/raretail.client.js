/**
 * Rare-event island: crude Monte Carlo against importance sampling on the
 * Gaussian tail, both accumulating live against the exact curve.
 *
 * The sample count grows geometrically so the estimates visibly sharpen and the
 * crude estimator visibly runs out of road: past a certain threshold it has no
 * hits at all and simply stops having points to plot.
 */

import { RareTailSim, normalTail, THRESHOLDS } from '../sim/raretail.js';
import { cividis } from '../sim/cividis.js';

const A_MIN = 1, A_MAX = 7;
const P_MIN = 1e-13, P_MAX = 1;
const N_MAX = 8_000_000;
/** Colour maps relative standard error over three decades. */
const RSE_MIN = 1e-3, RSE_MAX = 1;

export function mountRareTail(root) {
  const canvas = root.querySelector('canvas[data-layer="plot"]');
  const poster = root.querySelector('[data-poster]');
  const readout = root.querySelector('[data-readout]');
  if (!canvas) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  let sim = null, dpr = 1, w = 0, h = 0, raf = 0;
  let running = false, visible = false, started = false, done = false;

  const css = () => {
    const cs = getComputedStyle(root);
    return {
      ink: cs.color,
      muted: cs.getPropertyValue('--ink-2').trim() || '#59636a',
      rule: cs.getPropertyValue('--rule').trim() || '#cfd6d7',
      reverse: (cs.getPropertyValue('--sim-reverse') || '0').trim() === '1',
      mono: `${(cs.getPropertyValue('--font-mono') || '').trim()}, monospace`,
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

  const pad = () => ({ l: 54 * dpr, r: 16 * dpr, t: 14 * dpr, b: 46 * dpr });
  const xOf = (a) => {
    const p = pad();
    return p.l + ((a - A_MIN) / (A_MAX - A_MIN)) * (w - p.l - p.r);
  };
  const yOf = (v) => {
    const p = pad();
    const u = (Math.log10(v) - Math.log10(P_MIN)) / (Math.log10(P_MAX) - Math.log10(P_MIN));
    return h - p.b - u * (h - p.t - p.b);
  };

  /** cividis position for a relative standard error. */
  function rseColour(rse, reverse) {
    const u = (Math.log10(Math.max(rse, 1e-9)) - Math.log10(RSE_MIN)) /
      (Math.log10(RSE_MAX) - Math.log10(RSE_MIN));
    const t = u < 0 ? 0 : u > 1 ? 1 : u;
    const [r, g, b] = cividis(reverse ? 1 - t : t);
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  }

  function drawAxes(c) {
    const p = pad();
    ctx.lineWidth = Math.max(1, dpr);
    ctx.font = `${11 * dpr}px ${c.mono}`;

    // Decade gridlines and labels.
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let e = 0; e >= -13; e -= 2) {
      const y = Math.round(yOf(Math.pow(10, e))) + 0.5;
      ctx.strokeStyle = c.rule;
      ctx.beginPath();
      ctx.moveTo(p.l, y); ctx.lineTo(w - p.r, y); ctx.stroke();
      ctx.fillStyle = c.muted;
      ctx.fillText(e === 0 ? '1' : `1e${e}`, p.l - 7 * dpr, y);
    }

    // Threshold ticks.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = c.muted;
    for (let a = A_MIN; a <= A_MAX + 1e-9; a += 1) {
      const x = Math.round(xOf(a)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, h - p.b); ctx.lineTo(x, h - p.b + 5 * dpr); ctx.stroke();
      ctx.fillStyle = c.muted;
      ctx.fillText(String(a), x, h - p.b + 8 * dpr);
    }
    ctx.beginPath();
    ctx.moveTo(p.l, h - p.b + 0.5); ctx.lineTo(w - p.r, h - p.b + 0.5);
    ctx.stroke();

    ctx.fillStyle = c.muted;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('threshold a', (p.l + w - p.r) / 2, h - p.b + 24 * dpr);
    ctx.save();
    ctx.translate(13 * dpr, (h - p.b + p.t) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('P(Z > a)', 0, 0);
    ctx.restore();
  }

  function drawExact(c) {
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    const steps = 160;
    for (let i = 0; i <= steps; i++) {
      const a = A_MIN + ((A_MAX - A_MIN) * i) / steps;
      const x = xOf(a), y = yOf(normalTail(a));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** One estimate: a vertical +/- 1 s.e. bar and a marker. */
  function drawPoint(x, est, filled, c) {
    const lo = Math.max(P_MIN, est.p - est.se);
    const hi = Math.min(P_MAX, est.p + est.se);
    const colour = rseColour(est.se / est.p, c.reverse);

    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(x, yOf(hi)); ctx.lineTo(x, yOf(lo));
    ctx.stroke();

    const r = 3.1 * dpr;
    ctx.beginPath();
    ctx.arc(x, yOf(est.p), r, 0, Math.PI * 2);
    if (filled) {
      ctx.fillStyle = colour;
      ctx.fill();
    } else {
      ctx.lineWidth = Math.max(1.2, 1.4 * dpr);
      ctx.strokeStyle = colour;
      ctx.stroke();
    }
  }

  function render() {
    const c = css();
    ctx.clearRect(0, 0, w, h);
    drawAxes(c);
    drawExact(c);

    for (const e of sim.est) {
      const x = xOf(e.a);
      const crude = e.crude();
      // Crude first so importance sampling sits on top where they overlap.
      if (crude) drawPoint(x - 2.2 * dpr, crude, false, c);
      const is = e.is();
      if (is) drawPoint(x + 2.2 * dpr, is, true, c);
    }
  }

  function updateReadout() {
    if (!readout) return;
    const { crude, is } = sim.reach();
    readout.querySelector('[data-n]').textContent =
      sim.n >= 1e6 ? `${(sim.n / 1e6).toFixed(1)}M` : sim.n.toLocaleString();
    readout.querySelector('[data-crude]').textContent = crude ? crude.toExponential(0) : '—';
    readout.querySelector('[data-is]').textContent = is ? is.toExponential(0) : '—';
  }

  function frame() {
    if (!running) return;
    // Geometric growth: the estimates sharpen quickly at first and the run
    // still reaches millions of samples without a long tail of tiny updates.
    const m = Math.max(500, Math.min(12000, Math.round(sim.n * 0.05)));
    sim.advance(m);
    render();
    updateReadout();
    if (sim.n >= N_MAX) { running = false; done = true; return; }
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

  const sync = () => (visible && !document.hidden && !done ? start() : stop());

  if (!layout()) return;
  sim = new RareTailSim();

  new IntersectionObserver((e) => { visible = e[0].isIntersecting; sync(); }, { rootMargin: '64px' })
    .observe(root);
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

for (const el of document.querySelectorAll('[data-sim="raretail"]')) mountRareTail(el);
