/**
 * cividis, sampled at 33 anchors from matplotlib's 256-entry table and
 * interpolated linearly in sRGB. Perceptually uniform in lightness and
 * designed to be readable under deuteranomaly/protanomaly, which is the
 * reason it is the only source of colour on this site: colour here encodes
 * a scalar field, so it has to survive being read by anyone.
 *
 * Max deviation from the full 256-entry table is under 1.5/255 per channel.
 */

const ANCHORS = [
  [0, 34, 78], [0, 40, 91], [0, 46, 106], [5, 51, 113], [26, 56, 111],
  [39, 62, 110], [50, 67, 109], [59, 73, 108], [67, 78, 108], [75, 84, 108],
  [83, 90, 109], [90, 95, 110], [97, 101, 111], [104, 106, 113], [111, 112, 115],
  [118, 118, 118], [125, 124, 120], [131, 129, 121], [139, 135, 120], [146, 141, 120],
  [154, 147, 118], [162, 153, 117], [170, 160, 115], [179, 166, 112], [187, 173, 109],
  [195, 179, 105], [204, 186, 100], [212, 193, 95], [221, 200, 88], [230, 208, 81],
  [239, 215, 72], [248, 223, 60], [254, 232, 56],
];

const N = ANCHORS.length - 1;

/** t in [0,1] -> [r,g,b] with components in [0,255]. */
export function cividis(t) {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const s = x * N;
  const i = Math.min(N - 1, s | 0);
  const f = s - i;
  const a = ANCHORS[i], b = ANCHORS[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

/** Precomputed lookup of `n` CSS colour strings, for per-particle fills. */
export function cividisTable(n = 128) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = cividis(i / (n - 1));
    out[i] = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  }
  return out;
}
