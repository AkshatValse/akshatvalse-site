/**
 * Rendering primitives shared by the live canvas and the build-time poster
 * generator, so the static first paint and the running simulation are the
 * same picture. No DOM access here; everything works on raw RGBA buffers or
 * on plain numbers.
 */

import { V, TWO_PI } from './hero.js';
import { cividis } from './cividis.js';

/** Contour level spacing in units of V. */
export const LEVEL_SPACING = 0.5;

/**
 * Rasterize the contour lines of V(x,y) = cos x + cos y into an RGBA buffer.
 *
 * Levels are placed at LEVEL_SPACING * (k + 1/2) rather than at multiples of
 * the spacing, which keeps any level off the extrema V = ±2. A level passing
 * exactly through an extremum degenerates to a point and rasterizes as a blob,
 * because the distance-to-level estimate below divides by |grad V| -> 0 there.
 *
 * For a pixel at (x,y) the perpendicular distance to the nearest level set is
 * approximated to first order by |V - V_level| / |grad V|, converted to pixels
 * and turned into a 1px antialiased line by linear coverage. Where |grad V| is
 * small the level sets are far apart and the estimate correctly returns "no
 * line here", so no special case is needed beyond a division guard.
 */
export function contourRGBA(w, h, spanX, spanY, rgb, alpha = 0.5, halfWidthPx = 0.6, yStart = 0, yEnd = h) {
  // Returns only rows [yStart, yEnd), so callers can rasterize a large canvas
  // in slices across several frames instead of in one long task.
  const rows = yEnd - yStart;
  const buf = new Uint8ClampedArray(w * rows * 4);
  const scale = w / spanX; // pixels per unit of x; equals h/spanY by construction
  const [cr, cg, cb] = rgb;
  const inv = 1 / LEVEL_SPACING;

  for (let py = yStart; py < yEnd; py++) {
    const y = ((py + 0.5) / h) * spanY;
    const cosY = Math.cos(y), sinY = Math.sin(y);
    const rowBase = (py - yStart) * w;
    for (let px = 0; px < w; px++) {
      const x = ((px + 0.5) / w) * spanX;
      const v = Math.cos(x) + cosY;
      const sinX = Math.sin(x);

      // Distance in V to the nearest level of the offset ladder.
      const s = v * inv - 0.5;
      const dv = Math.abs(s - Math.round(s)) * LEVEL_SPACING;

      const grad = Math.sqrt(sinX * sinX + sinY * sinY);
      const dpx = (dv / Math.max(grad, 1e-4)) * scale;

      const cov = halfWidthPx + 0.5 - dpx;
      if (cov > 0) {
        const a = Math.min(1, cov) * alpha;
        const o = (rowBase + px) * 4;
        buf[o] = cr; buf[o + 1] = cg; buf[o + 2] = cb;
        buf[o + 3] = a * 255;
      }
    }
  }
  return buf;
}

/**
 * Antialiased contours of a general scalar field, same first-order distance
 * estimate as above but with the field and its gradient supplied by the
 * caller. `fieldGrad(x, y)` returns [phi, dphi/dx, dphi/dy]; levels above
 * `cutoff` are not drawn, which keeps the far tails of a log-density from
 * filling the frame with rings.
 */
export function contourFieldRGBA(w, h, box, fieldGrad, rgb, opts = {}) {
  const {
    alpha = 0.34, halfWidthPx = 0.6, spacing = 1.0, cutoff = Infinity, offset = 0.5,
    yStart = 0, yEnd = h,
  } = opts;
  const rows = yEnd - yStart;
  const buf = new Uint8ClampedArray(w * rows * 4);
  const [cr, cg, cb] = rgb;
  const sx = (box.x1 - box.x0) / w;
  const sy = (box.y1 - box.y0) / h;
  const scale = w / (box.x1 - box.x0);
  const inv = 1 / spacing;

  for (let py = yStart; py < yEnd; py++) {
    // Screen y grows downward; the field's y grows upward.
    const y = box.y1 - (py + 0.5) * sy;
    const rowBase = (py - yStart) * w;
    for (let px = 0; px < w; px++) {
      const x = box.x0 + (px + 0.5) * sx;
      const [phi, gx, gy] = fieldGrad(x, y);
      if (phi > cutoff) continue;

      const s = phi * inv - offset;
      const dphi = Math.abs(s - Math.round(s)) * spacing;
      const grad = Math.sqrt(gx * gx + gy * gy);
      const dpx = (dphi / Math.max(grad, 1e-4)) * scale;

      const cov = halfWidthPx + 0.5 - dpx;
      if (cov > 0) {
        const o = (rowBase + px) * 4;
        buf[o] = cr; buf[o + 1] = cg; buf[o + 2] = cb;
        buf[o + 3] = Math.min(1, cov) * alpha * 255;
      }
    }
  }
  return buf;
}

/**
 * Colormap position for a particle at potential v.
 *
 * `reverse` flips the ramp for dark backgrounds. The mapping stays monotone
 * in V either way — only its direction changes, so that the *populated* end
 * of the distribution (the wells, where V = -2) always lands on the end of
 * cividis that has contrast against the page. The legend states the direction.
 */
export function heroRamp(v, reverse) {
  const t = (v + 2) / 4;
  return reverse ? 1 - t : t;
}

/** Precompute `n` colors of the ramp as [r,g,b] triples. */
export function rampTable(n, reverse) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = -2 + (4 * i) / (n - 1);
    out[i] = cividis(heroRamp(v, reverse));
  }
  return out;
}

/** Index into a rampTable of length n for a particle at (x, y). */
export function rampIndex(x, y, n) {
  const t = (V(x, y) + 2) / 4;
  const i = (t * (n - 1) + 0.5) | 0;
  return i < 0 ? 0 : i > n - 1 ? n - 1 : i;
}

/**
 * Alpha-composite an antialiased disc into an RGBA buffer. Used only by the
 * poster generator; the browser path uses the 2D context's own arc filling.
 * Coverage is estimated from the signed distance to the disc boundary, which
 * is within a few percent of exact area coverage at these radii.
 */
export function splatDisc(buf, w, h, cx, cy, r, rgb, alpha = 1) {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
  const [sr, sg, sb] = rgb;

  for (let py = y0; py <= y1; py++) {
    const dy = py + 0.5 - cy;
    for (let px = x0; px <= x1; px++) {
      const dx = px + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      const cov = Math.min(1, Math.max(0, r + 0.5 - d));
      if (cov <= 0) continue;
      const a = cov * alpha;
      const o = (py * w + px) * 4;
      const da = buf[o + 3] / 255;
      const oa = a + da * (1 - a);
      if (oa <= 0) continue;
      buf[o] = (sr * a + buf[o] * da * (1 - a)) / oa;
      buf[o + 1] = (sg * a + buf[o + 1] * da * (1 - a)) / oa;
      buf[o + 2] = (sb * a + buf[o + 2] * da * (1 - a)) / oa;
      buf[o + 3] = oa * 255;
    }
  }
}

/** Flatten an RGBA buffer onto an opaque background, in place. */
export function flattenOnto(buf, bg) {
  const [br, bg_, bb] = bg;
  for (let o = 0; o < buf.length; o += 4) {
    const a = buf[o + 3] / 255;
    buf[o] = buf[o] * a + br * (1 - a);
    buf[o + 1] = buf[o + 1] * a + bg_ * (1 - a);
    buf[o + 2] = buf[o + 2] * a + bb * (1 - a);
    buf[o + 3] = 255;
  }
}

export { TWO_PI };
