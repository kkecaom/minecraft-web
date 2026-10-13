// tools/dump_entities.js - renders TexEntities (src/tex_entities.js) to PNG contact sheets in _ref/agent_out/
// usage: node tools/dump_entities.js
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_ref', 'agent_out');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- load module
const t0 = Date.now();
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'tex_entities.js'), 'utf8'), ctx, { filename: 'tex_entities.js' });
const TE = ctx.TexEntities;
console.log('generated in', Date.now() - t0, 'ms');

// ---------------------------------------------------------------- PNG writer
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, cv) {
  const { w, h, data } = cv;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
  console.log('wrote', path.relative(ROOT, file), w + 'x' + h);
}

// ---------------------------------------------------------------- canvas helpers
function canvas(w, h, bg) { const c = { w, h, data: new Uint8ClampedArray(w * h * 4) }; if (bg && (bg[3] === undefined || bg[3] > 0)) fillRect(c, 0, 0, w, h, bg); return c; }
function setPx(c, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  if (a >= 255) { c.data[i] = r; c.data[i + 1] = g; c.data[i + 2] = b; c.data[i + 3] = 255; return; }
  const k = a / 255; c.data[i] = c.data[i] * (1 - k) + r * k; c.data[i + 1] = c.data[i + 1] * (1 - k) + g * k; c.data[i + 2] = c.data[i + 2] * (1 - k) + b * k; c.data[i + 3] = 255;
}
function fillRect(c, x, y, w, h, col) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setPx(c, x + i, y + j, col[0], col[1], col[2], col[3] === undefined ? 255 : col[3]); }
function strokeRect(c, x, y, w, h, col) { for (let i = 0; i < w; i++) { setPx(c, x + i, y, ...col); setPx(c, x + i, y + h - 1, ...col); } for (let j = 0; j < h; j++) { setPx(c, x, y + j, ...col); setPx(c, x + w - 1, y + j, ...col); } }
function checker(c, x, y, w, h, s = 8) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = ((((i / s) | 0) + ((j / s) | 0)) & 1) ? 0x88 : 0x66; setPx(c, x + i, y + j, v, v, v); } }
// blit image scaled (nearest) with alpha over whatever is there; opts.add = additive
function blit(c, img, x0, y0, s, opts = {}) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * 4, a = img.data[i + 3];
    if (!a && !opts.add) continue;
    for (let j = 0; j < s; j++) for (let k = 0; k < s; k++) {
      const px = x0 + x * s + k, py = y0 + y * s + j;
      if (opts.add) { if (px < 0 || py < 0 || px >= c.w || py >= c.h) continue; const o = (py * c.w + px) * 4; c.data[o] += img.data[i]; c.data[o + 1] += img.data[i + 1]; c.data[o + 2] += img.data[i + 2]; }
      else setPx(c, px, py, img.data[i], img.data[i + 1], img.data[i + 2], a);
    }
  }
}
const FONT_ROWS = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'], G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'], J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['###', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'], S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'], '2': ['##.', '..#', '.#.', '#..', '###'], '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '##.', '..#', '##.'], '6': ['.##', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'], '9': ['###', '#.#', '###', '..#', '##.'],
  '_': ['...', '...', '...', '...', '###'], '-': ['...', '...', '###', '...', '...'], '.': ['...', '...', '...', '...', '.#.'], ' ': ['...', '...', '...', '...', '...']
};
function text(c, str, x, y, s = 2, col = [255, 255, 255]) {
  str = String(str).toUpperCase();
  for (const ch of str) {
    const g = FONT_ROWS[ch] || FONT_ROWS[' '];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j][i] === '#') fillRect(c, x + i * s, y + j * s, s, s, col);
    x += 4 * s;
  }
}

// ---------------------------------------------------------------- skin sheets with face-region outlines
function box(u, v, w, h, d) {
  return { top: [u + d, v, w, d], bottom: [u + d + w, v, w, d], right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h] };
}
const FACECOL = { top: [255, 230, 0], bottom: [150, 150, 150], right: [255, 60, 60], front: [60, 255, 60], left: [60, 140, 255], back: [255, 60, 255] };
const BOXES = {
  steve: [[0, 0, 8, 8, 8], [32, 0, 8, 8, 8], [16, 16, 8, 12, 4], [16, 32, 8, 12, 4], [40, 16, 4, 12, 4], [40, 32, 4, 12, 4], [32, 48, 4, 12, 4], [48, 48, 4, 12, 4], [0, 16, 4, 12, 4], [0, 32, 4, 12, 4], [16, 48, 4, 12, 4], [0, 48, 4, 12, 4]],
  skeleton: [[0, 0, 8, 8, 8], [16, 16, 8, 12, 4], [40, 16, 2, 12, 2], [0, 16, 2, 12, 2]],
  creeper: [[0, 0, 8, 8, 8], [16, 16, 8, 12, 4], [0, 16, 4, 6, 4]],
  pig: [[0, 0, 8, 8, 8], [16, 16, 4, 3, 1], [28, 8, 10, 16, 8], [0, 16, 4, 6, 4]],
  cow: [[0, 0, 8, 8, 6], [22, 0, 1, 3, 1], [18, 4, 12, 18, 10], [52, 0, 4, 6, 1], [0, 16, 4, 12, 4]],
  sheep: [[0, 0, 6, 6, 8], [28, 8, 8, 16, 6], [0, 16, 4, 12, 4]],
  sheep_fur: [[0, 0, 6, 6, 6], [28, 8, 8, 16, 6], [0, 16, 4, 6, 4]],
  chicken: [[0, 0, 4, 6, 3], [14, 0, 4, 2, 2], [14, 4, 2, 2, 2], [0, 9, 6, 8, 6], [26, 0, 3, 5, 3], [24, 13, 1, 4, 6]],
  spider: [[32, 4, 8, 8, 8], [0, 0, 6, 6, 6], [0, 12, 10, 8, 12], [18, 0, 16, 2, 2]],
};
BOXES.zombie = BOXES.steve; BOXES.spider_eyes = BOXES.spider;

function skinSheet(name, S = 10) {
  const sk = TE.skins[name];
  const pad = 16, c = canvas(sk.w * S + pad * 2, sk.h * S + pad * 2 + 16, [40, 40, 40]);
  checker(c, pad, pad + 16, sk.w * S, sk.h * S, S);
  blit(c, sk, pad, pad + 16, S);
  text(c, name + ' ' + sk.w + 'x' + sk.h, pad, 4, 2);
  // faint texel grid every 8
  for (let x = 0; x <= sk.w; x += 8) for (let y = 0; y < sk.h * S; y++) setPx(c, pad + x * S, pad + 16 + y, 0, 0, 0, 90);
  for (let y = 0; y <= sk.h; y += 8) for (let x = 0; x < sk.w * S; x++) setPx(c, pad + x, pad + 16 + y * S, 0, 0, 0, 90);
  for (const b of (BOXES[name] || [])) {
    const f = box(...b);
    for (const k in f) { const [x, y, w, h] = f[k]; if (w && h) strokeRect(c, pad + x * S, pad + 16 + y * S, w * S, h * S, [...FACECOL[k], 200]); }
  }
  return c;
}

// ---------------------------------------------------------------- orthographic model renderer
// coords: X toward the entity's LEFT, Y up, Z toward the entity's BACK (front = min Z)
const VIEWS = {
  front: p => [p[0], -p[1], p[2]],
  right: p => [-p[2], -p[1], p[0]],
  back: p => [-p[0], -p[1], -p[2]],
  left: p => [p[2], -p[1], -p[0]],
  top: p => [p[0], -p[2], -p[1]],
};
const VIEWDIR = { front: [0, 0, 1], right: [1, 0, 0], back: [0, 0, -1], left: [-1, 0, 0], top: [0, -1, 0] }; // camera looking direction
function modelFaces(b) {
  const [w, h, d] = b.s, inf = b.inf || 0, W = w + 2 * inf, H = h + 2 * inf, D = d + 2 * inf;
  const R = box(b.uv[0], b.uv[1], w, h, d);
  const F = {
    front: { O: [0, H, 0], U: [W / w, 0, 0], V: [0, -H / h, 0], N: [0, 0, -1], r: R.front },
    back: { O: [W, H, D], U: [-W / w, 0, 0], V: [0, -H / h, 0], N: [0, 0, 1], r: R.back },
    right: { O: [0, H, D], U: [0, 0, -D / d], V: [0, -H / h, 0], N: [-1, 0, 0], r: R.right },
    left: { O: [W, H, 0], U: [0, 0, D / d], V: [0, -H / h, 0], N: [1, 0, 0], r: R.left },
    top: { O: [0, H, D], U: [W / w, 0, 0], V: [0, 0, -D / d], N: [0, 1, 0], r: R.top },
    bottom: { O: [0, 0, D], U: [W / w, 0, 0], V: [0, 0, -D / d], N: [0, -1, 0], r: R.bottom },
  };
  if (b.mirror) { const t = F.right.r; F.right.r = F.left.r; F.left.r = t; }
  const p0 = [b.p[0] - inf, b.p[1] - inf, b.p[2] - inf];
  const xf = b.rot ? (v, isPt) => isPt ? [p0[0] + v[0], p0[1] + v[2], p0[2] + (H - v[1])] : [v[0], v[2], -v[1]]
                   : (v, isPt) => isPt ? [p0[0] + v[0], p0[1] + v[1], p0[2] + v[2]] : v;
  return Object.keys(F).map(k => { const f = F[k]; return { name: k, O: xf(f.O, true), U: xf(f.U), V: xf(f.V), N: xf(f.N), r: f.r, mirror: !!b.mirror, tex: b.tex }; });
}
function renderModel(model, skinName, view, S) {
  const faces = model.flatMap(modelFaces);
  const P = VIEWS[view], dir = VIEWDIR[view];
  const quads = [];
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const f of faces) {
    const dp = f.N[0] * dir[0] + f.N[1] * dir[1] + f.N[2] * dir[2];
    if (Math.abs(dp) < 1e-6) continue;
    const tex = TE.skins[f.tex || skinName];
    const [rx, ry, rw, rh] = f.r;
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      const si = f.mirror ? rw - 1 - i : i;
      const o = ((ry + j) * tex.w + rx + si) * 4;
      if (!tex.data[o + 3]) continue;
      const c0 = [f.O[0] + f.U[0] * i + f.V[0] * j, f.O[1] + f.U[1] * i + f.V[1] * j, f.O[2] + f.U[2] * i + f.V[2] * j];
      const c1 = [c0[0] + f.U[0] + f.V[0], c0[1] + f.U[1] + f.V[1], c0[2] + f.U[2] + f.V[2]];
      const a = P(c0), b = P(c1);
      const q = { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]), z: (a[2] + b[2]) / 2 + (dp > 0 ? 0.001 : 0), col: [tex.data[o], tex.data[o + 1], tex.data[o + 2]], back: dp > 0 };
      quads.push(q);
      minx = Math.min(minx, q.x0); miny = Math.min(miny, q.y0); maxx = Math.max(maxx, q.x1); maxy = Math.max(maxy, q.y1);
    }
  }
  const pad = 2, W = Math.ceil((maxx - minx) * S) + pad * 2, H = Math.ceil((maxy - miny) * S) + pad * 2;
  const c = canvas(W, H, [0, 0, 0, 0]); const zb = new Float32Array(W * H).fill(1e9);
  for (const q of quads) {
    const X0 = Math.round((q.x0 - minx) * S) + pad, X1 = Math.round((q.x1 - minx) * S) + pad, Y0 = Math.round((q.y0 - miny) * S) + pad, Y1 = Math.round((q.y1 - miny) * S) + pad;
    const k = q.back ? 0.55 : 1;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const zi = y * W + x; if (q.z >= zb[zi]) continue; zb[zi] = q.z;
      const o = zi * 4; c.data[o] = q.col[0] * k; c.data[o + 1] = q.col[1] * k; c.data[o + 2] = q.col[2] * k; c.data[o + 3] = 255;
    }
  }
  return c;
}
const HUMAN = [
  { p: [-4, 24, -4], s: [8, 8, 8], uv: [0, 0] }, { p: [-4, 24, -4], s: [8, 8, 8], uv: [32, 0], inf: 0.5 },
  { p: [-4, 12, -2], s: [8, 12, 4], uv: [16, 16] }, { p: [-4, 12, -2], s: [8, 12, 4], uv: [16, 32], inf: 0.25 },
  { p: [-8, 12, -2], s: [4, 12, 4], uv: [40, 16] }, { p: [-8, 12, -2], s: [4, 12, 4], uv: [40, 32], inf: 0.25 },
  { p: [4, 12, -2], s: [4, 12, 4], uv: [32, 48] }, { p: [4, 12, -2], s: [4, 12, 4], uv: [48, 48], inf: 0.25 },
  { p: [-4, 0, -2], s: [4, 12, 4], uv: [0, 16] }, { p: [-4, 0, -2], s: [4, 12, 4], uv: [0, 32], inf: 0.25 },
  { p: [0, 0, -2], s: [4, 12, 4], uv: [16, 48] }, { p: [0, 0, -2], s: [4, 12, 4], uv: [0, 48], inf: 0.25 },
];
const MODELS = {
  steve: HUMAN, zombie: HUMAN,
  skeleton: [{ p: [-4, 24, -4], s: [8, 8, 8], uv: [0, 0] }, { p: [-4, 12, -2], s: [8, 12, 4], uv: [16, 16] },
    { p: [-6, 12, -1], s: [2, 12, 2], uv: [40, 16] }, { p: [4, 12, -1], s: [2, 12, 2], uv: [40, 16], mirror: true },
    { p: [-3, 0, -1], s: [2, 12, 2], uv: [0, 16] }, { p: [1, 0, -1], s: [2, 12, 2], uv: [0, 16], mirror: true }],
  creeper: [{ p: [-4, 18, -4], s: [8, 8, 8], uv: [0, 0] }, { p: [-4, 6, -2], s: [8, 12, 4], uv: [16, 16] },
    { p: [-4, 0, 2], s: [4, 6, 4], uv: [0, 16] }, { p: [0, 0, 2], s: [4, 6, 4], uv: [0, 16] }, { p: [-4, 0, -6], s: [4, 6, 4], uv: [0, 16] }, { p: [0, 0, -6], s: [4, 6, 4], uv: [0, 16] }],
  pig: [{ p: [-4, 8, -14], s: [8, 8, 8], uv: [0, 0] }, { p: [-2, 9, -15], s: [4, 3, 1], uv: [16, 16] }, { p: [-5, 6, -8], s: [10, 16, 8], uv: [28, 8], rot: true },
    { p: [-5, 0, 5], s: [4, 6, 4], uv: [0, 16] }, { p: [1, 0, 5], s: [4, 6, 4], uv: [0, 16] }, { p: [-5, 0, -7], s: [4, 6, 4], uv: [0, 16] }, { p: [1, 0, -7], s: [4, 6, 4], uv: [0, 16] }],
  cow: [{ p: [-4, 16, -14], s: [8, 8, 6], uv: [0, 0] }, { p: [-5, 22, -12], s: [1, 3, 1], uv: [22, 0] }, { p: [4, 22, -12], s: [1, 3, 1], uv: [22, 0] },
    { p: [-6, 12, -8], s: [12, 18, 10], uv: [18, 4], rot: true }, { p: [-2, 11, 4], s: [4, 6, 1], uv: [52, 0], rot: true },
    { p: [-6, 0, 5], s: [4, 12, 4], uv: [0, 16] }, { p: [2, 0, 5], s: [4, 12, 4], uv: [0, 16] }, { p: [-6, 0, -8], s: [4, 12, 4], uv: [0, 16] }, { p: [2, 0, -8], s: [4, 12, 4], uv: [0, 16] }],
  sheep: [{ p: [-3, 16, -14], s: [6, 6, 8], uv: [0, 0] }, { p: [-4, 12, -8], s: [8, 16, 6], uv: [28, 8], rot: true },
    { p: [-5, 0, 5], s: [4, 12, 4], uv: [0, 16] }, { p: [1, 0, 5], s: [4, 12, 4], uv: [0, 16] }, { p: [-5, 0, -7], s: [4, 12, 4], uv: [0, 16] }, { p: [1, 0, -7], s: [4, 12, 4], uv: [0, 16] }],
  chicken: [{ p: [-2, 9, -6], s: [4, 6, 3], uv: [0, 0] }, { p: [-2, 11, -8], s: [4, 2, 2], uv: [14, 0] }, { p: [-1, 9, -7], s: [2, 2, 2], uv: [14, 4] },
    { p: [-3, 5, -4], s: [6, 8, 6], uv: [0, 9], rot: true }, { p: [-3, 0, -2], s: [3, 5, 3], uv: [26, 0] }, { p: [0, 0, -2], s: [3, 5, 3], uv: [26, 0] },
    { p: [-4, 7, -3], s: [1, 4, 6], uv: [24, 13] }, { p: [3, 7, -3], s: [1, 4, 6], uv: [24, 13] }],
  spider: [{ p: [-4, 5, -11], s: [8, 8, 8], uv: [32, 4] }, { p: [-3, 6, -3], s: [6, 6, 6], uv: [0, 0] }, { p: [-5, 5, 3], s: [10, 8, 12], uv: [0, 12] }].concat(
    [-3, -1, 1, 3].flatMap(z => [{ p: [-19, 8, z - 1], s: [16, 2, 2], uv: [18, 0] }, { p: [3, 8, z - 1], s: [16, 2, 2], uv: [18, 0], mirror: true }])),
};
// sheared sheep + fur on top; chicken with the plain 6x6x8 body mapping as an alternative
MODELS.sheep_wool = MODELS.sheep.concat([
  { p: [-3, 16, -12], s: [6, 6, 6], uv: [0, 0], inf: 0.6, tex: 'sheep_fur' }, { p: [-4, 12, -8], s: [8, 16, 6], uv: [28, 8], rot: true, inf: 1.75, tex: 'sheep_fur' },
  ...[[-5, 5], [1, 5], [-5, -7], [1, -7]].map(([x, z]) => ({ p: [x, 6, z], s: [4, 6, 4], uv: [0, 16], inf: 0.5, tex: 'sheep_fur' }))]);
MODELS.chicken_alt = MODELS.chicken.map(b => (b.uv[0] === 0 && b.uv[1] === 9) ? { p: [-3, 5, -4], s: [6, 6, 8], uv: [0, 9] } : b);
MODELS.spider_glow = MODELS.spider.map(b => Object.assign({}, b, { tex: 'spider_eyes' }));

function modelSheet(name, skinName, S = 8) {
  const views = ['front', 'right', 'back', 'left', 'top'].map(v => [v, renderModel(MODELS[name], skinName, v, S)]);
  const W = views.reduce((a, [, c]) => a + c.w + 12, 12), H = Math.max(...views.map(([, c]) => c.h)) + 40;
  const c = canvas(W, H, [96, 128, 170]);
  text(c, name, 8, 6, 2);
  let x = 12;
  for (const [v, img] of views) { text(c, v, x, 24, 1, [230, 230, 230]); blit(c, img, x, 34, 1); x += img.w + 12; }
  return c;
}

// ---------------------------------------------------------------- run
const names = Object.keys(TE.skins);
for (const n of names) writePNG(path.join(OUT, 'ent_skin_' + n + '.png'), skinSheet(n, n === 'steve' || n === 'zombie' ? 8 : 10));
// all skins overview at 4x
{
  const S = 4, cols = 4, cw = 64 * S + 12, ch = 64 * S + 24;
  const c = canvas(cols * cw + 12, Math.ceil(names.length / cols) * ch + 12, [40, 40, 40]);
  names.forEach((n, i) => { const sk = TE.skins[n], x = 12 + (i % cols) * cw, y = 12 + ((i / cols) | 0) * ch; text(c, n, x, y, 1); checker(c, x, y + 10, sk.w * S, sk.h * S, 8); blit(c, sk, x, y + 10, S); });
  writePNG(path.join(OUT, 'ent_overview.png'), c);
}
for (const m of ['steve', 'zombie', 'skeleton', 'creeper', 'pig', 'cow', 'sheep', 'sheep_wool', 'chicken', 'chicken_alt', 'spider']) {
  const skinName = m === 'sheep_wool' ? 'sheep' : m === 'chicken_alt' ? 'chicken' : m;
  writePNG(path.join(OUT, 'ent_model_' + m + '.png'), modelSheet(m, skinName, m === 'chicken' || m === 'chicken_alt' ? 12 : 8));
}
// env: sun + moon (raw on black, 8x) and composited additively over a night sky
{
  const { sun, moon } = TE.env, S = 6;
  const c = canvas(32 * S + 128 * S + 36, 64 * S * 2 + 60, [30, 30, 30]);
  text(c, 'sun 32x32', 12, 4, 2); text(c, 'moon 128x64', 32 * S + 24, 4, 2);
  blit(c, sun, 12, 24, S); blit(c, moon, 32 * S + 24, 24, S);
  // additive preview over sky colours
  fillRect(c, 12, 64 * S + 48, 32 * S, 32 * S, [120, 167, 255]); blit(c, sun, 12, 64 * S + 48, S, { add: true });
  fillRect(c, 32 * S + 24, 64 * S + 48, 128 * S, 64 * S, [8, 10, 22]); blit(c, moon, 32 * S + 24, 64 * S + 48, S, { add: true });
  writePNG(path.join(OUT, 'ent_env.png'), c);
}
// gui icons
{
  const g = TE.gui, keys = Object.keys(g), S = 8;
  const small = keys.filter(k => g[k].w <= 16);
  const c = canvas(Math.max(small.length * (16 * S + 8) + 16, 182 * 4 + 24), 16 * S * 2 + 150, [30, 30, 30]);
  small.forEach((k, i) => {
    const x = 12 + i * (16 * S + 8);
    fillRect(c, x, 12, 16 * S, 16 * S, [110, 110, 110]); blit(c, g[k], x, 12, S);
    fillRect(c, x, 20 + 16 * S, 16 * S, 16 * S, [20, 60, 25]); blit(c, g[k], x, 20 + 16 * S, S);
    text(c, k.replace('heart_', 'h_').replace('container', 'cont'), x, 28 + 32 * S, 1);
  });
  const by = 44 + 32 * S;
  blit(c, g.xp_bar_bg, 12, by, 4); blit(c, g.xp_bar_fg, 12, by + 28, 4);
  // HUD mock: hearts row / hunger row / partial xp bar at 3x
  const hy = by + 56; const mk = canvas(182, 22, [0, 0, 0, 0]);
  for (let i = 0; i < 10; i++) { blit(mk, g.heart_container, i * 8, 0, 1); blit(mk, i < 6 ? g.heart_full : i === 6 ? g.heart_half : g.heart_container, i * 8, 0, 1); }
  for (let i = 0; i < 10; i++) { const x = 182 - 9 - i * 8; blit(mk, g.food_container, x, 0, 1); if (i < 7) blit(mk, g.food_full, x, 0, 1); else if (i === 7) blit(mk, g.food_half, x, 0, 1); }
  blit(mk, g.xp_bar_bg, 0, 12, 1); const part = { w: 120, h: 5, data: new Uint8ClampedArray(120 * 5 * 4) };
  for (let y = 0; y < 5; y++) for (let x = 0; x < 120; x++) for (let k = 0; k < 4; k++) part.data[(y * 120 + x) * 4 + k] = g.xp_bar_fg.data[(y * 182 + x) * 4 + k];
  blit(mk, part, 0, 12, 1);
  fillRect(c, 12, hy, 182 * 3, 22 * 3, [100, 140, 90]); blit(c, mk, 12, hy, 3);
  writePNG(path.join(OUT, 'ent_gui.png'), c);
}
// sanity checks
const need = ['steve', 'zombie', 'skeleton', 'creeper', 'pig', 'cow', 'sheep', 'sheep_fur', 'chicken', 'spider', 'spider_eyes'];
const sizes = { steve: [64, 64], zombie: [64, 64] };
for (const n of need) { const s = TE.skins[n]; const [w, h] = sizes[n] || [64, 32]; if (!s || s.w !== w || s.h !== h || s.data.length !== w * h * 4) throw new Error('bad skin ' + n); }
const guiNeed = { heart_container: 9, heart_container_blink: 9, heart_full: 9, heart_half: 9, heart_full_blink: 9, heart_half_blink: 9, food_container: 9, food_full: 9, food_half: 9, armor_empty: 9, armor_half: 9, armor_full: 9, bubble: 9, bubble_pop: 9, crosshair: 15 };
for (const k in guiNeed) { const s = TE.gui[k]; if (!s || s.w !== guiNeed[k] || s.h !== guiNeed[k] || s.data.length !== s.w * s.h * 4) throw new Error('bad gui ' + k); }
for (const k of ['xp_bar_bg', 'xp_bar_fg']) { const s = TE.gui[k]; if (!s || s.w !== 182 || s.h !== 5) throw new Error('bad gui ' + k); }
if (TE.env.sun.w !== 32 || TE.env.sun.h !== 32 || TE.env.moon.w !== 128 || TE.env.moon.h !== 64) throw new Error('bad env');
console.log('all required names present; gui keys:', Object.keys(TE.gui).join(','));
