// ===== shared_core.js : constants, PRNG, hashing, Perlin noise =====
// Inlined into MCShared() - runs on the main thread AND inside Web Workers. Must stay pure (no DOM, no game globals).
const CHUNK = 16, WORLD_H = 256, SEA = 63, SECTIONS = 16, CHUNK_AREA = 256, CHUNK_VOL = 65536;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 32-bit integer hash of up to 4 ints -> uint32
function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(s | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
const hashf = (x, y, z, s) => hash3(x, y, z, s) / 4294967296;

// Convert an arbitrary seed string/number into a 32-bit int (Java-style string hash for strings, like MC)
function seedToInt(seed) {
  if (typeof seed === 'number') return seed | 0;
  const s = String(seed);
  if (/^-?\d+$/.test(s)) { const n = Number(s); return (n % 4294967296) | 0; }
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

const G2X = [1, -1, 1, -1, 1, -1, 0, 0], G2Y = [1, 1, -1, -1, 0, 0, 1, -1];
function grad2(h, x, y) { h &= 7; return G2X[h] * x + G2Y[h] * y; }
function grad3(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

class Perlin {
  constructor(seed) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    const r = mulberry32(seed | 0);
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
  }
  // 2D gradient noise, roughly in [-1, 1]
  n2(x, y) {
    const p = this.p;
    const fx = Math.floor(x), fy = Math.floor(y);
    x -= fx; y -= fy;
    const X = fx & 255, Y = fy & 255;
    const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10);
    const a = p[X] + Y, b = p[X + 1] + Y;
    const x1 = grad2(p[a], x, y) + u * (grad2(p[b], x - 1, y) - grad2(p[a], x, y));
    const x2 = grad2(p[a + 1], x, y - 1) + u * (grad2(p[b + 1], x - 1, y - 1) - grad2(p[a + 1], x, y - 1));
    return x1 + v * (x2 - x1);
  }
  // 3D gradient noise (improved Perlin), roughly in [-1, 1]
  n3(x, y, z) {
    const p = this.p;
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    x -= fx; y -= fy; z -= fz;
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10), w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const g000 = grad3(p[AA], x, y, z), g100 = grad3(p[BA], x - 1, y, z), g010 = grad3(p[AB], x, y - 1, z), g110 = grad3(p[BB], x - 1, y - 1, z);
    const g001 = grad3(p[AA + 1], x, y, z - 1), g101 = grad3(p[BA + 1], x - 1, y, z - 1), g011 = grad3(p[AB + 1], x, y - 1, z - 1), g111 = grad3(p[BB + 1], x - 1, y - 1, z - 1);
    const l00 = g000 + u * (g100 - g000), l10 = g010 + u * (g110 - g010), l01 = g001 + u * (g101 - g001), l11 = g011 + u * (g111 - g011);
    const m0 = l00 + v * (l10 - l00), m1 = l01 + v * (l11 - l01);
    return m0 + w * (m1 - m0);
  }
}

// fractal Brownian motion, normalised by total amplitude (result roughly in [-0.8, 0.8])
function fbm2(N, x, z, oct, lac, gain) {
  lac = lac || 2; gain = gain || 0.5;
  let a = 1, f = 1, s = 0, t = 0;
  for (let i = 0; i < oct; i++) { s += a * N.n2(x * f, z * f); t += a; a *= gain; f *= lac; }
  return s / t;
}
function fbm3(N, x, y, z, oct, lac, gain) {
  lac = lac || 2; gain = gain || 0.5;
  let a = 1, f = 1, s = 0, t = 0;
  for (let i = 0; i < oct; i++) { s += a * N.n3(x * f, y * f, z * f); t += a; a *= gain; f *= lac; }
  return s / t;
}
