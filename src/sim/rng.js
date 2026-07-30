/**
 * Seeded PRNG + exact normal generator.
 *
 * sfc32 (Small Fast Counting, 32-bit) — passes PractRand, period >= 2^32,
 * and is four lines of integer arithmetic. Seeded so that the opening
 * seconds of every simulation on this site are byte-identical across loads.
 *
 * Normals come from Box-Muller, which is exact. Summing uniforms and
 * appealing to the CLT is not: it truncates the tails, and for Langevin
 * dynamics the tails are exactly what drives barrier crossing.
 */

export function sfc32(a, b, c, d) {
  return function () {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Derive four 32-bit words from a string seed (FNV-1a variants). */
export function seedWords(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ k, 0x01000193);
    h2 = Math.imul(h2 + k, 0x85ebca6b);
    h3 = Math.imul(h3 ^ (k + i), 0xc2b2ae35);
    h4 = Math.imul(h4 + (k * (i + 1)), 0x27d4eb2f);
  }
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Box-Muller normal generator with the second variate cached, so the
 * amortized cost is one uniform pair and one sqrt/log per two normals.
 */
export function makeNormal(rand) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u1 = rand();
    // log(0) guard; the probability is ~2^-32 but the NaN would be permanent.
    if (u1 < 1e-12) u1 = 1e-12;
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * rand();
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

export function makeRng(seed) {
  const [a, b, c, d] = seedWords(seed);
  const rand = sfc32(a, b, c, d);
  // Discard the first draws; sfc32 needs a short warm-up from a raw seed.
  for (let i = 0; i < 16; i++) rand();
  return { rand, normal: makeNormal(rand) };
}
