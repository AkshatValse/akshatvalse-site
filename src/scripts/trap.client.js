/**
 * The trap island (Fig. 1).
 *
 * Two copies of the paper's engine receive the same agent traffic: a Poisson
 * stream at 1.35 lambda_ref and a burst of 200 sessions at t = 1200 s. The top
 * lane is left alone; the bottom one gets the paper's rescue cap of 20 sessions
 * at t = 1800 s. Each lane plots the sessions in the system (gate included) on
 * a square-root scale, binned every 30 s, and fills each bin with the
 * follow-up hit fraction on the cividis scale.
 *
 * The run is deterministic (see src/sim/trap.js), so the build-time poster
 * underneath is this very run, finished. While the replay sweeps across, the
 * poster is dimmed and acts as a ghost of where it is going.
 */

import { TrapScene, displayPlan, hitFraction, BIN, PROTOCOL } from '../sim/trap.js';
import { cividis } from '../sim/cividis.js';
import { trapRampT } from '../sim/trap-poster.js';

const SIM_SPEED = 180;          // simulated seconds per wall second: the run takes about 48 s
const HOLD_MS = 4000;           // rest on the finished run before replaying
const MIN_FRAME_MS = 1000 / 30;
const LEVELS = 32;              // hit fractions are drawn at 33 levels, as in the poster

/** Put the finished poster back: no canvases, no dimming. */
function failSafe(root, err) {
  console.error('[trap] simulation stopped:', err);
  for (const c of root.querySelectorAll('canvas')) c.hidden = true;
  root.removeAttribute('data-live');
}

const fmtInt = (x) => Math.round(x).toLocaleString('en-US');

export function mountTrap(root) {
  const plots = [...root.querySelectorAll('[data-plot]')];
  const canvases = plots.map((p) => p.querySelector('canvas'));
  const ctxs = canvases.map((c) => c && c.getContext('2d', { alpha: true }));
  if (canvases.length !== 2 || ctxs.some((c) => !c)) return;
  const markers = [...root.querySelectorAll('[data-at]')];
  const readT = root.querySelector('[data-t]');
  const readHit = [...root.querySelectorAll('[data-hit]')];
  const readN = [...root.querySelectorAll('[data-n]')];
  const ymax = Number(root.dataset.ymax) || 250;
  const H = PROTOCOL.H, nBins = H / BIN;
  // The markup's readouts describe the finished run; keep them to put back.
  const initial = [readT, ...readHit, ...readN].filter(Boolean).map((el) => [el, el.textContent]);
  const dispose = () => {
    stop(); disposed = true;
    for (const c of canvases) c.hidden = true;
    root.removeAttribute('data-live');
    for (const m of markers) m.setAttribute('data-past', '');
    for (const [el, s] of initial) el.textContent = s;
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;

  const plan = displayPlan();
  let scene = null, drawn = [0, 0], dpr = 1, size = [];
  let running = false, visible = false, started = false, disposed = false;
  let raf = 0, last = 0, holdUntil = 0, lastRead = 0;
  let palette = null;

  function readPalette() {
    const cs = getComputedStyle(root);
    // --sim-reverse marks the dark scheme; the trap figure keeps its light
    // orientation there and lifts the low end instead (see trap-poster.js).
    const dark = cs.getPropertyValue('--sim-reverse').trim() === '1';
    const fills = [];
    for (let i = 0; i <= LEVELS; i++) {
      const [r, g, b] = cividis(trapRampT(i / LEVELS, dark));
      fills.push(`rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`);
    }
    palette = {
      fills,
      none: cs.getPropertyValue('--sim-contour').trim() || '#7d878c',
      line: cs.getPropertyValue('--ink-2').trim() || '#59636a',
    };
  }

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // The plot's padding box (its client size, which leaves out the bottom
    // rule) is what the absolutely positioned canvas fills; CSS sizes the
    // element, this sets its backing store.
    size = plots.map((p, j) => {
      const w = Math.max(1, Math.round(p.clientWidth * dpr)), h = Math.max(1, Math.round(p.clientHeight * dpr));
      const c = canvases[j];
      c.width = w; c.height = h;
      return { w, h };
    });
    return size.every((s) => s.w > 2 && s.h > 2);
  }

  const yOf = (n, h) => h * (1 - Math.sqrt(Math.max(0, Math.min(1, n / ymax))));

  function drawBin(j, i) {
    const { w, h } = size[j], ctx = ctxs[j], b = scene.bins[j][i];
    const x0 = Math.round((i * w) / nBins), x1 = Math.round(((i + 1) * w) / nBins);
    const y = yOf(b.n, h);
    const hf = hitFraction(b);
    ctx.fillStyle = hf === null ? palette.none : palette.fills[Math.round(hf * LEVELS)];
    ctx.fillRect(x0, y, x1 - x0, h - y);
    // outline: the top of this bin, joined to the previous one
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    const yPrev = i > 0 ? yOf(scene.bins[j][i - 1].n, h) : y;
    ctx.moveTo(x0, yPrev); ctx.lineTo(x0, y); ctx.lineTo(x1, y);
    ctx.stroke();
  }

  function redraw() {
    for (let j = 0; j < 2; j++) {
      ctxs[j].clearRect(0, 0, size[j].w, size[j].h);
      for (let i = 0; i < drawn[j]; i++) drawBin(j, i);
    }
  }

  function updateMarkers() {
    for (const m of markers) m.toggleAttribute('data-past', scene.t >= Number(m.dataset.at));
  }

  function updateReadout() {
    if (readT) readT.textContent = fmtInt(scene.t);
    for (let j = 0; j < 2; j++) {
      const bins = scene.bins[j];
      const b = bins[bins.length - 1];
      if (!b) continue;
      const hf = hitFraction(b);
      if (readHit[j]) readHit[j].textContent = hf === null ? '–' : hf.toFixed(2);
      if (readN[j]) readN[j].textContent = fmtInt(b.n);
    }
  }

  function reset() {
    scene = new TrapScene({ plan });
    drawn = [0, 0];
    for (let j = 0; j < 2; j++) ctxs[j].clearRect(0, 0, size[j].w, size[j].h);
    // Until the first bin closes there is nothing to report for either lane.
    for (const el of readHit) el.textContent = '–';
    for (const el of readN) el.textContent = '0';
    if (readT) readT.textContent = '0';
    updateMarkers();
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    try {
      if (now - last < MIN_FRAME_MS) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (scene.done) {
        if (!holdUntil) holdUntil = now + HOLD_MS;
        if (now < holdUntil) return;
        holdUntil = 0;
        reset();
      }
      scene.advanceTo(scene.t + SIM_SPEED * dt);
      for (let j = 0; j < 2; j++) {
        while (drawn[j] < scene.bins[j].length) drawBin(j, drawn[j]++);
      }
      updateMarkers();
      if (now - lastRead > 250 || scene.done) { updateReadout(); lastRead = now; }
    } catch (err) {
      console.error('[trap] simulation stopped:', err);
      dispose();
    }
  }

  function start() {
    if (running || disposed) return;
    if (!started) {
      started = true;
      if (!layout()) { started = false; return; }
      readPalette();
      reset();
      for (const c of canvases) c.hidden = false;
      root.setAttribute('data-live', '');
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

  function sync() {
    if (visible && !document.hidden && !reduced.matches && !disposed) start(); else stop();
  }

  const io = new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; sync(); }, { rootMargin: '96px' });
  io.observe(root);
  document.addEventListener('visibilitychange', sync);

  // Watch the plots as well as the band: a plot can change size on its own.
  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (started && !disposed && layout()) redraw(); }, 180);
  });
  ro.observe(root);
  for (const p of plots) ro.observe(p);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (started && !disposed) { readPalette(); redraw(); }
  });

  // Reduced motion switched on mid-visit: stop, and leave the finished poster.
  reduced.addEventListener('change', () => { if (reduced.matches) dispose(); });
}

for (const el of document.querySelectorAll('[data-sim="trap"]')) {
  try { mountTrap(el); } catch (err) { failSafe(el, err); }
}
