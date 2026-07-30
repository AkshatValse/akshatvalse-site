/**
 * Hero island: overdamped Langevin dynamics in V(x,y) = cos x + cos y,
 * drawn live on a canvas.
 *
 * Everything the brief calls for on the runtime side lives here:
 *   - the loop never starts under prefers-reduced-motion; the poster stays
 *   - IntersectionObserver stops it when the band scrolls out of view
 *   - visibilitychange stops it when the tab is hidden
 *   - the physics timestep is fixed and decoupled from the frame rate, so a
 *     30Hz display runs the same dynamics as a 120Hz one
 *   - colors are read from the stylesheet, so CSS stays the single source
 *     of truth and an OS scheme change rebuilds the layers
 */

import { HeroSim, HERO_DEFAULTS, tilesForAspect } from '../sim/hero.js';
import { contourRGBA, rampTable, rampIndex } from '../sim/render.js';

/** Simulated time per wall-clock second. Sets how fast hopping reads. */
const SIM_SPEED = 0.8;
/** Simulated time the poster frame was rendered at; the live loop starts here
 *  so the swap from poster to canvas is continuous rather than a reset. */
const START_TIME = 2.0;
const TRAIL_FADE = 0.085;
const RAMP_STEPS = 96;
const MAX_STEPS_PER_FRAME = 24;
/**
 * Render at most 30 fps. The physics accumulator keeps `last` untouched until a
 * frame is actually drawn, so the integrator sees the full elapsed time and the
 * dynamics are identical on a 60 Hz and a 120 Hz display. On the latter this
 * halves the work for no visible difference in an ensemble of hundreds.
 */
const MIN_FRAME_MS = 1000 / 30;


function parseRGB(str) {
  const m = str.trim().match(/^#?([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const nums = str.match(/[\d.]+/g);
  return nums ? nums.slice(0, 3).map(Number) : [128, 128, 128];
}

/**
 * If a simulation throws, stop the loop and put the poster back rather than
 * leaving a half-drawn or frozen canvas. A reader should never be able to tell
 * that anything failed; the console should always be able to.
 */
function failSafe(root, label, err) {
  console.error(`[${label}] simulation stopped:`, err);
  for (const c of root.querySelectorAll('canvas')) c.hidden = true;
  const poster = root.querySelector('[data-poster]');
  if (poster) poster.style.display = '';
  const readout = root.querySelector('[data-readout]');
  if (readout) readout.hidden = true;
}

export function mountHero(root) {
  const contourCanvas = root.querySelector('canvas[data-layer="contours"]');
  const partCanvas = root.querySelector('canvas[data-layer="particles"]');
  const poster = root.querySelector('[data-poster]');
  const readout = root.querySelector('[data-readout]');
  if (!contourCanvas || !partCanvas) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return; // hard requirement: poster only, no loop

  const cctx = contourCanvas.getContext('2d', { alpha: true });
  const pctx = partCanvas.getContext('2d', { alpha: true });
  if (!cctx || !pctx) return;

  let sim = null, ramp = null, raf = 0, last = 0;
  let width = 0, height = 0, dpr = 1;
  let running = false, visible = false, disposed = false, built = false;

  const styles = () => {
    const cs = getComputedStyle(root);
    return {
      contour: parseRGB(cs.getPropertyValue('--sim-contour') || '#7d878c'),
      reverse: (cs.getPropertyValue('--sim-reverse') || '0').trim() === '1',
    };
  };

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

  /**
   * Rasterizing the contour field over a full-bleed canvas at 2x is several
   * million transcendental evaluations — one long task, and directly visible
   * as blocking time. Slice it by rows across frames instead; no single chunk
   * runs long enough to be a long task.
   */
  function paintContours(onDone) {
    const { contour } = styles();
    const CHUNKS = 10;
    let i = 0;
    const step = () => {
      if (buildToken !== myToken) return;
      const y0 = Math.floor((height * i) / CHUNKS);
      const y1 = Math.floor((height * (i + 1)) / CHUNKS);
      if (y1 > y0) {
        const data = contourRGBA(
          width, height, sim.spanX, sim.spanY, contour, 0.24, 0.6 * dpr, y0, y1
        );
        cctx.putImageData(new ImageData(data, width, y1 - y0), 0, y0);
      }
      if (++i < CHUNKS) requestAnimationFrame(step);
      else onDone();
    };
    const myToken = buildToken;
    requestAnimationFrame(step);
  }

  let buildToken = 0;

  function build() {
    if (!layout()) return false;
    buildToken++;
    const { reverse } = styles();
    const { tilesX, tilesY } = tilesForAspect(width / height);

    sim = new HeroSim({ ...HERO_DEFAULTS, tilesX, tilesY });
    sim.advance(Math.round(START_TIME / sim.dt));

    ramp = rampTable(RAMP_STEPS, reverse).map(
      ([r, g, b]) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
    );

    pctx.clearRect(0, 0, width, height);
    contourCanvas.hidden = false;
    partCanvas.hidden = false;

    // The poster stays up until the contour layer is complete, so the reader
    // never sees a half-drawn field.
    paintContours(() => {
      if (poster) poster.style.display = 'none';
      built = true;
      sync();
    });
    return true;
  }

  function draw() {
    const sx = width / sim.spanX, sy = height / sim.spanY;
    const r = Math.max(1.15, 1.5 * dpr);

    // Fade the previous frame toward transparency rather than toward a color,
    // so the static contour layer underneath is never painted over.
    pctx.globalCompositeOperation = 'destination-out';
    pctx.fillStyle = `rgba(0,0,0,${TRAIL_FADE})`;
    pctx.fillRect(0, 0, width, height);
    pctx.globalCompositeOperation = 'source-over';

    const { x, y, n } = sim;
    // Batch by color: 96 fillStyle changes per frame instead of one per particle.
    const buckets = new Array(RAMP_STEPS);
    for (let i = 0; i < n; i++) {
      const k = rampIndex(x[i], y[i], RAMP_STEPS);
      (buckets[k] || (buckets[k] = [])).push(i);
    }
    for (let k = 0; k < RAMP_STEPS; k++) {
      const b = buckets[k];
      if (!b) continue;
      pctx.fillStyle = ramp[k];
      pctx.beginPath();
      for (let j = 0; j < b.length; j++) {
        const i = b[j];
        const px = x[i] * sx, py = height - y[i] * sy;
        pctx.moveTo(px + r, py);
        pctx.arc(px, py, r, 0, Math.PI * 2);
      }
      pctx.fill();
    }
  }

  let readoutAt = 0;
  function updateReadout(now) {
    if (!readout || now - readoutAt < 250) return;
    readoutAt = now;
    readout.querySelector('[data-t]').textContent = sim.t.toFixed(1);
    readout.querySelector('[data-n]').textContent = String(sim.n);
    readout.querySelector('[data-beta]').textContent = sim.beta.toFixed(1);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (now - last < MIN_FRAME_MS) return;
    // Clamp the wall-clock delta: after a stall, catch up a little, never
    // replay the whole gap. The timestep itself never changes.
    const dtWall = Math.min(0.05, (now - last) / 1000);
    last = now;
    const steps = Math.min(MAX_STEPS_PER_FRAME, Math.round((SIM_SPEED * dtWall) / sim.dt));
    if (steps > 0) sim.advance(steps);
    draw();
    updateReadout(now);
  }

  function start() {
    if (running || disposed || !sim || !built) return;
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
    if (visible && !document.hidden && !reduced.matches) start();
    else stop();
  }

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      if (visible && !built && !sim) build();
      sync();
    },
    { rootMargin: '96px' }
  );

  io.observe(root);
  document.addEventListener('visibilitychange', sync);

  // Rebuild on a scheme change: the ramp direction and the contour color both
  // depend on it. Rebuild on resize too, since the cell tiling follows aspect.
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => { stop(); built = false; build(); };
  dark.addEventListener('change', onScheme);

  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { stop(); built = false; build(); }, 180);
  });
  ro.observe(root);

  reduced.addEventListener('change', () => {
    if (reduced.matches) {
      stop();
      disposed = true;
      contourCanvas.hidden = true;
      partCanvas.hidden = true;
      if (poster) poster.style.display = '';
    }
  });
}

for (const el of document.querySelectorAll('[data-sim="hero"]')) {
  try {
    mountHero(el);
  } catch (err) {
    failSafe(el, 'hero', err);
  }
}
