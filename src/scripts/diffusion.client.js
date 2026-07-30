/**
 * Diffusion-model island: ancestral sampling from a continuous-time VP-SDE
 * with the exact score of a known Gaussian mixture.
 *
 * Each pass runs the reverse SDE from t = 1 to t ~ 0, then grades itself on
 * the recovered mixture weights before restarting from a fresh prior sample.
 * The restart is a real event — a new independent sampling run — not a loop
 * animation.
 */

import { DiffusionSampler, DIFFUSION_DEFAULTS } from '../sim/diffusion.js';
import { BOX, energy, energyGrad, WEIGHTS } from '../sim/mixture.js';
import { contourFieldRGBA, rampTable } from '../sim/render.js';
import { cividis } from '../sim/cividis.js';

/** Reverse steps per wall-clock second. A full pass takes about 7 s. */
const STEPS_PER_SEC = 46;
/** Energy range the colormap spans, above the global minimum of phi. */
const ENERGY_SPAN = 9;
const RAMP_STEPS = 96;
const TRAIL_FADE = 0.16;
const HOLD_MS = 1600;

/** Global minimum of phi over the frame, found once and cached. */
let phiMin = null;
function minEnergy() {
  if (phiMin !== null) return phiMin;
  let m = Infinity;
  for (let i = 0; i <= 240; i++) {
    for (let j = 0; j <= 120; j++) {
      const v = energy(
        BOX.x0 + ((BOX.x1 - BOX.x0) * i) / 240,
        BOX.y0 + ((BOX.y1 - BOX.y0) * j) / 120
      );
      if (v < m) m = v;
    }
  }
  return (phiMin = m);
}

function parseRGB(str) {
  const m = str.trim().match(/^#?([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const nums = str.match(/[\d.]+/g);
  return nums ? nums.slice(0, 3).map(Number) : [128, 128, 128];
}

export function mountDiffusion(root) {
  const contourCanvas = root.querySelector('canvas[data-layer="contours"]');
  const partCanvas = root.querySelector('canvas[data-layer="particles"]');
  const poster = root.querySelector('[data-poster]');
  const readout = root.querySelector('[data-readout]');
  if (!contourCanvas || !partCanvas) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;

  const cctx = contourCanvas.getContext('2d', { alpha: true });
  const pctx = partCanvas.getContext('2d', { alpha: true });
  if (!cctx || !pctx) return;

  let sim = null, ramp = null, raf = 0, last = 0, holdUntil = 0, passes = 0;
  let width = 0, height = 0, dpr = 1;
  let running = false, visible = false, started = false, built = false;

  function layout() {
    const rect = root.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.round(rect.width * dpr);
    height = Math.round(rect.height * dpr);
    for (const c of [contourCanvas, partCanvas]) {
      c.width = width; c.height = height;
      c.style.width = rect.width + 'px';
      c.style.height = rect.height + 'px';
    }
    return true;
  }

  let buildToken = 0;

  function build() {
    if (!layout()) return false;
    buildToken++;
    const myToken = buildToken;
    const cs = getComputedStyle(root);
    const contour = parseRGB(cs.getPropertyValue('--sim-contour') || '#7d878c');
    const reverse = (cs.getPropertyValue('--sim-reverse') || '0').trim() === '1';

    if (!sim) sim = new DiffusionSampler(DIFFUSION_DEFAULTS);

    ramp = new Array(RAMP_STEPS);
    for (let i = 0; i < RAMP_STEPS; i++) {
      const u = i / (RAMP_STEPS - 1);
      const [r, g, b] = cividis(reverse ? 1 - u : u);
      ramp[i] = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    }

    pctx.clearRect(0, 0, width, height);
    contourCanvas.hidden = false;
    partCanvas.hidden = false;

    // Sliced across frames, same reason as the hero: one pass over the whole
    // canvas is a long task, and long tasks are what blocking time measures.
    const cutoff = minEnergy() + ENERGY_SPAN;
    const CHUNKS = 6;
    let i = 0;
    const step = () => {
      if (buildToken !== myToken) return;
      const y0 = Math.floor((height * i) / CHUNKS);
      const y1 = Math.floor((height * (i + 1)) / CHUNKS);
      if (y1 > y0) {
        const data = contourFieldRGBA(width, height, BOX, energyGrad, contour, {
          alpha: 0.34, halfWidthPx: 0.6 * dpr, spacing: 1.0, cutoff, yStart: y0, yEnd: y1,
        });
        cctx.putImageData(new ImageData(data, width, y1 - y0), 0, y0);
      }
      if (++i < CHUNKS) requestAnimationFrame(step);
      else { built = true; sync(); }
    };
    requestAnimationFrame(step);
    return true;
  }

  function draw() {
    const sx = width / (BOX.x1 - BOX.x0);
    const sy = height / (BOX.y1 - BOX.y0);
    const r = Math.max(1.2, 1.6 * dpr);

    pctx.globalCompositeOperation = 'destination-out';
    pctx.fillStyle = `rgba(0,0,0,${TRAIL_FADE})`;
    pctx.fillRect(0, 0, width, height);
    pctx.globalCompositeOperation = 'source-over';

    const buckets = new Array(RAMP_STEPS);
    for (let i = 0; i < sim.n; i++) {
      const u = (energy(sim.x[i], sim.y[i]) - phiMin) / ENERGY_SPAN;
      let k = ((u < 0 ? 0 : u > 1 ? 1 : u) * (RAMP_STEPS - 1) + 0.5) | 0;
      (buckets[k] || (buckets[k] = [])).push(i);
    }
    for (let k = 0; k < RAMP_STEPS; k++) {
      const b = buckets[k];
      if (!b) continue;
      pctx.fillStyle = ramp[k];
      pctx.beginPath();
      for (let j = 0; j < b.length; j++) {
        const i = b[j];
        const px = (sim.x[i] - BOX.x0) * sx;
        const py = (BOX.y1 - sim.y[i]) * sy;
        pctx.moveTo(px + r, py);
        pctx.arc(px, py, r, 0, Math.PI * 2);
      }
      pctx.fill();
    }
  }

  function updateReadout(final) {
    if (!readout) return;
    readout.querySelector('[data-t]').textContent = sim.t.toFixed(2);
    readout.querySelector('[data-step]').textContent = `${sim.k}/${sim.steps}`;
    const g = readout.querySelector('[data-grade]');
    if (final) {
      const { maxDev } = sim.coverage();
      g.textContent = maxDev.toFixed(3);
      readout.dataset.state = 'graded';
    } else if (!readout.dataset.state) {
      g.textContent = '—';
    }
  }

  let acc = 0;
  function frame(now) {
    if (!running) return;
    const dtWall = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (sim.done) {
      if (!holdUntil) {
        updateReadout(true);
        holdUntil = now + HOLD_MS;
      } else if (now >= holdUntil) {
        holdUntil = 0;
        passes++;
        delete readout?.dataset.state;
        sim.restart();
        pctx.clearRect(0, 0, width, height);
      }
    } else {
      acc += dtWall * STEPS_PER_SEC;
      const m = Math.min(12, Math.floor(acc));
      if (m > 0) { acc -= m; sim.advance(m); }
      updateReadout(false);
    }

    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || !built) return;
    if (!started) {
      started = true;
      if (poster) poster.style.display = 'none';
    }
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const sync = () => (visible && !document.hidden ? start() : stop());

  new IntersectionObserver((e) => {
    visible = e[0].isIntersecting;
    if (visible && !built) build();
    sync();
  }, { rootMargin: '80px' }).observe(root);
  document.addEventListener('visibilitychange', sync);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!started) return;
    stop(); built = false; build();
  });

  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!started) return;
      stop(); built = false; build();
    }, 180);
  }).observe(root);
}

for (const el of document.querySelectorAll('[data-sim="diffusion"]')) mountDiffusion(el);
