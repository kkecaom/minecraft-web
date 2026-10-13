// ===== g_util.js : math, matrices, frustum, misc helpers (main thread) =====
const DEG = Math.PI / 180, TAU = Math.PI * 2;
const SH = MCShared();                     // shared engine (registry, worldgen, mesher) instance for the main thread
const BLOCKS = SH.BLOCKS, BID = SH.BID, BIOMES = SH.BIOMES, BIO = SH.BIO;
const { T_OPAQUE, T_OPACITY, T_EMIT, T_MODEL, T_SOLID, T_FLUID, T_REPL, T_CONN, T_ENC, T_FLAM, connMask, chorusMask } = SH;
const M_CUBE = SH.M_CUBE, M_CUTOUT = SH.M_CUTOUT, M_TRANS = SH.M_TRANS, M_LIQUID = SH.M_LIQUID, M_CROSS = SH.M_CROSS, M_CROP = SH.M_CROP, M_BOX = SH.M_BOX, M_FIRE = SH.M_FIRE, M_PORTAL = SH.M_PORTAL;
const SEA = SH.SEA, WORLD_H = SH.WORLD_H;
const clamp = SH.clamp, lerp = SH.lerp, smoothstep = SH.smoothstep, mulberry32 = SH.mulberry32, hash3 = SH.hash3, hashf = SH.hashf;
const $ = id => document.getElementById(id);
const now = () => performance.now();
const rnd = Math.random;
const rndInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const wrapAngle = a => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
const hex2rgb = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const cssRGB = (r, g, b, a) => a === undefined ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;

// --- 4x4 column-major matrices (Float32Array(16)) ---
function m4() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
function m4Perspective(o, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  o.fill(0); o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
  return o;
}
function m4Ortho(o, l, r, b, t, n, f) {
  o.fill(0); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
  return o;
}
function m4Mul(o, a, b) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
// rotation-only view matrix for yaw/pitch (MC convention: yaw 0 looks toward +Z, mouse right increases yaw; pitch > 0 looks down)
function m4View(o, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fx = -sy * cp, fy = -sp, fz = cy * cp;                 // forward
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl; // right = normalize(f x up)
  // up = right x forward
  const Ux = 0 * fz - rz * fy, Uy = rz * fx - rx * fz, Uz = rx * fy - 0 * fx;
  o[0] = rx; o[1] = Ux; o[2] = -fx; o[3] = 0;
  o[4] = 0; o[5] = Uy; o[6] = -fy; o[7] = 0;
  o[8] = rz; o[9] = Uz; o[10] = -fz; o[11] = 0;
  o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
  return o;
}
function m4Translate(o, m, x, y, z) { o.set(m); o[12] = m[0] * x + m[4] * y + m[8] * z + m[12]; o[13] = m[1] * x + m[5] * y + m[9] * z + m[13]; o[14] = m[2] * x + m[6] * y + m[10] * z + m[14]; o[15] = m[3] * x + m[7] * y + m[11] * z + m[15]; return o; }
function m4Identity(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; }
function m4RotX(o, a) { const c = Math.cos(a), s = Math.sin(a); m4Identity(o); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; }
function m4RotY(o, a) { const c = Math.cos(a), s = Math.sin(a); m4Identity(o); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; }
function m4RotZ(o, a) { const c = Math.cos(a), s = Math.sin(a); m4Identity(o); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o; }
function m4Scale(o, x, y, z) { m4Identity(o); o[0] = x; o[5] = y; o[10] = z; return o; }
function m4TranslateM(o, x, y, z) { m4Identity(o); o[12] = x; o[13] = y; o[14] = z; return o; }
const _t1 = new Float32Array(16), _t2 = new Float32Array(16);
// helper: compose a transform list into a matrix: T(x,y,z) * Rz * Ry * Rx * S
function m4Compose(o, x, y, z, rx, ry, rz, sx, sy, sz) {
  m4TranslateM(o, x, y, z);
  if (rz) { m4Mul(_t1, o, m4RotZ(_t2, rz)); o.set(_t1); }
  if (ry) { m4Mul(_t1, o, m4RotY(_t2, ry)); o.set(_t1); }
  if (rx) { m4Mul(_t1, o, m4RotX(_t2, rx)); o.set(_t1); }
  if (sx !== 1 || sy !== 1 || sz !== 1) { m4Mul(_t1, o, m4Scale(_t2, sx, sy, sz)); o.set(_t1); }
  return o;
}
function m4Transform(m, x, y, z, out) {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

// --- frustum culling: planes from a view-projection matrix, AABB test in camera-relative space ---
function frustumPlanes(m, p) {
  // p: Float32Array(24) (6 planes x [a,b,c,d])
  const set = (i, a, b, c, d) => { const l = Math.hypot(a, b, c) || 1; p[i * 4] = a / l; p[i * 4 + 1] = b / l; p[i * 4 + 2] = c / l; p[i * 4 + 3] = d / l; };
  set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
  set(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  set(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
  set(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  set(4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
  set(5, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
}
function aabbVisible(p, x0, y0, z0, x1, y1, z1) {
  for (let i = 0; i < 6; i++) {
    const a = p[i * 4], b = p[i * 4 + 1], c = p[i * 4 + 2], d = p[i * 4 + 3];
    const px = a > 0 ? x1 : x0, py = b > 0 ? y1 : y0, pz = c > 0 ? z1 : z0;
    if (a * px + b * py + c * pz + d < 0) return false;
  }
  return true;
}

// look direction from yaw/pitch
function lookDir(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp; out[1] = -Math.sin(pitch); out[2] = Math.cos(yaw) * cp;
  return out;
}

// --- tiny helpers ---
function titleCase(s) { return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); }
function fmtTime(ms) { const d = new Date(ms); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// run-length encoding for saved chunk arrays
function rleEncode(u8) {
  const out = []; let i = 0; const n = u8.length;
  while (i < n) { const v = u8[i]; let j = i + 1; while (j < n && u8[j] === v && j - i < 65535) j++; out.push(v, (j - i) & 255, (j - i) >> 8); i = j; }
  return new Uint8Array(out);
}
function rleDecode(enc, n) {
  const out = new Uint8Array(n); let o = 0;
  for (let i = 0; i < enc.length; i += 3) { const v = enc[i], c = enc[i + 1] | (enc[i + 2] << 8); out.fill(v, o, o + c); o += c; }
  return out;
}
