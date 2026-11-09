/**
 * Poster geometry for Fig. 1, shared by the page (src/components/TrapFigure.astro)
 * and the link-preview card (scripts/gen-og.mjs), so the two cannot drift.
 *
 * Each lane is drawn in a viewBox of (bins x 100) stretched to its box with
 * preserveAspectRatio="none": height is sessions on a square-root scale up to
 * ymax, and the fill is a horizontal gradient with hard stops wherever the
 * bin's follow-up hit fraction changes level. Levels match the live canvas
 * (src/scripts/trap.client.js): 33 of them on cividis, no hits = navy and
 * all hits = yellow.
 */

import { hitFraction } from './trap.js';
import { cividis } from './cividis.js';

export const LEVELS = 32;

export const hex = (t) => '#' + cividis(t).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Paths and gradient stops for one lane's bins. Null colors mean "no follow-up turns in the bin". */
export function laneGeometry(bins, ymax) {
  const nBins = bins.length;
  const yOf = (n) => 100 * (1 - Math.sqrt(Math.min(1, n / ymax)));
  let line = `M0 ${yOf(bins[0].n).toFixed(2)}`;
  bins.forEach((b, i) => { line += `V${yOf(b.n).toFixed(2)}H${i + 1}`; });
  const runs = [];
  bins.forEach((b, i) => {
    const hf = hitFraction(b);
    const lv = hf === null ? null : Math.round(hf * LEVELS);
    const r = runs[runs.length - 1];
    if (r && r[2] === lv) r[1] = i + 1; else runs.push([i, i + 1, lv]);
  });
  const stops = runs.flatMap(([a, b, lv]) => {
    const c = lv === null ? null : hex(lv / LEVELS);
    return [{ o: a / nBins, c }, { o: b / nBins, c }];
  });
  return { nBins, line, area: `${line}V100H0Z`, stops };
}

/** A standalone SVG of one lane, for the link-preview card. */
export function laneSVG(bins, ymax, { contour, line: stroke, id = 'g' }) {
  const g = laneGeometry(bins, ymax);
  const stops = g.stops.map((s) => `<stop offset="${s.o.toFixed(5)}" stop-color="${s.c ?? contour}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.nBins} 100" preserveAspectRatio="none" width="100%" height="100%">` +
    `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${g.nBins}" y2="0">${stops}</linearGradient></defs>` +
    `<path d="${g.area}" fill="url(#${id})"/>` +
    `<path d="${g.line}" fill="none" stroke="${stroke}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
}
