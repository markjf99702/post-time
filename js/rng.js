// Seeded random numbers, so a race day comes out the same every time it's rebuilt.

export function rng(seed) {
  let a = hash(String(seed));
  const next = () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const r = () => next();
  r.range = (lo, hi) => lo + (hi - lo) * next();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
  r.pick = arr => arr[Math.floor(next() * arr.length)];
  r.chance = p => next() < p;
  // Normal distribution (Box–Muller), mean 0, sd 1.
  r.gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  r.shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  // Picks by weight: [[item, weight], ...]
  r.weighted = pairs => {
    const total = pairs.reduce((s, p) => s + p[1], 0);
    let x = next() * total;
    for (const [item, w] of pairs) { x -= w; if (x <= 0) return item; }
    return pairs[pairs.length - 1][0];
  };
  return r;
}

export function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  h = Math.imul(h ^ h >>> 16, 2246822507);
  h = Math.imul(h ^ h >>> 13, 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
