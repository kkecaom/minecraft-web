// Voxel sculpting toolkit for the Divine Beast build: sparse-free dense grid, SDF-ish shape fills, a software preview renderer
// (textured with the game's own procedural tiles) and a PNG writer. Offline tool only - nothing here ships in minecraft.html.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');

// ---- load the game's block registry + textures straight from src (same concatenation as tools/build.js)
function loadGame() {
  const S = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  let js = '';
  for (const f of ['tex_blocks.js', 'tex_items.js', 'tex_extra.js', 'tex_entities.js', 'tex_mobs.js', 'tex_dims.js', 'tex_dims_mobs.js', 'tex_medoh.js']) js += S(f) + '\n';
  js += 'function MCShared(){"use strict";\n';
  for (const f of ['shared_core.js', 'shared_blocks.js', 'shared_gen.js', 'shared_struct.js', 'shared_dims.js', 'shared_medoh_bp.js', 'shared_medoh.js', 'shared_mesh.js']) { if (fs.existsSync(path.join(ROOT, 'src', f))) js += S(f) + '\n'; }
  js += 'return API;}\n;globalThis.__mc = { TexBlocks: TexBlocks, SH: MCShared() };';
  vm.runInThisContext(js, { filename: 'game.js' });
  return globalThis.__mc;
}

class Vox {
  constructor(x0, y0, z0, x1, y1, z1) {
    this.x0 = x0; this.y0 = y0; this.z0 = z0; this.x1 = x1; this.y1 = y1; this.z1 = z1;
    this.sx = x1 - x0 + 1; this.sy = y1 - y0 + 1; this.sz = z1 - z0 + 1;
    this.b = new Uint8Array(this.sx * this.sy * this.sz); this.m = new Uint8Array(this.b.length);
  }
  inb(x, y, z) { return x >= this.x0 && x <= this.x1 && y >= this.y0 && y <= this.y1 && z >= this.z0 && z <= this.z1; }
  idx(x, y, z) { return ((y - this.y0) * this.sz + (z - this.z0)) * this.sx + (x - this.x0); }
  get(x, y, z) { return this.inb(x, y, z) ? this.b[this.idx(x, y, z)] : 0; }
  meta(x, y, z) { return this.inb(x, y, z) ? this.m[this.idx(x, y, z)] : 0; }
  set(x, y, z, id, meta) { if (!this.inb(x, y, z)) return; const i = this.idx(x, y, z); this.b[i] = id; this.m[i] = meta || 0; }
  // fill every voxel in bbox passing test(x,y,z). mat: id | (x,y,z)=>id|[id,meta]|null(undefined = skip). mode: 'set' | 'air' (only into air) | 'paint' (only solid) | 'carve'
  fill(bb, test, mat, mode) {
    const x0 = Math.max(this.x0, Math.floor(bb[0])), y0 = Math.max(this.y0, Math.floor(bb[1])), z0 = Math.max(this.z0, Math.floor(bb[2]));
    const x1 = Math.min(this.x1, Math.ceil(bb[3])), y1 = Math.min(this.y1, Math.ceil(bb[4])), z1 = Math.min(this.z1, Math.ceil(bb[5]));
    const fn = typeof mat === 'function' ? mat : null; let n = 0;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (test && !test(x, y, z)) continue;
      const i = this.idx(x, y, z), cur = this.b[i];
      if (mode === 'air' && cur !== 0) continue;
      if (mode === 'paint' && cur === 0) continue;
      if (mode === 'carve') { this.b[i] = 0; this.m[i] = 0; n++; continue; }
      let v = fn ? fn(x, y, z, cur) : mat;
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) { this.b[i] = v[0]; this.m[i] = v[1]; } else { this.b[i] = v; this.m[i] = 0; }
      n++;
    }
    return n;
  }
  // copy another grid in at an offset (air in src is skipped unless overwriteAir)
  blit(src, ox, oy, oz) {
    for (let y = src.y0; y <= src.y1; y++) for (let z = src.z0; z <= src.z1; z++) for (let x = src.x0; x <= src.x1; x++) {
      const i = src.idx(x, y, z); if (!src.b[i]) continue; this.set(x + ox, y + oy, z + oz, src.b[i], src.m[i]);
    }
  }
  count() { let n = 0; for (let i = 0; i < this.b.length; i++) if (this.b[i]) n++; return n; }
  bounds() {
    let a = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (let y = this.y0; y <= this.y1; y++) for (let z = this.z0; z <= this.z1; z++) for (let x = this.x0; x <= this.x1; x++) if (this.b[this.idx(x, y, z)]) { if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (z < a[2]) a[2] = z; if (x > a[3]) a[3] = x; if (y > a[4]) a[4] = y; if (z > a[5]) a[5] = z; }
    return a;
  }
}

// ---- shapes: each returns { bb:[x0,y0,z0,x1,y1,z1], t:(x,y,z)=>bool }
const sh = {
  box: (x0, y0, z0, x1, y1, z1) => ({ bb: [x0, y0, z0, x1, y1, z1], t: null }),
  ell: (cx, cy, cz, rx, ry, rz) => ({ bb: [cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz], t: (x, y, z) => { const a = (x - cx) / rx, b = (y - cy) / ry, c = (z - cz) / rz; return a * a + b * b + c * c <= 1; } }),
  // capsule / cone between two points with radii ra -> rb (flat = no rounded caps)
  cap: (a, b, ra, rb, flat) => {
    if (rb === undefined) rb = ra; const R = Math.max(ra, rb);
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L2 = dx * dx + dy * dy + dz * dz || 1e-9;
    return { bb: [Math.min(a[0], b[0]) - R, Math.min(a[1], b[1]) - R, Math.min(a[2], b[2]) - R, Math.max(a[0], b[0]) + R, Math.max(a[1], b[1]) + R, Math.max(a[2], b[2]) + R],
      t: (x, y, z) => { let k = ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / L2; if (flat && (k < 0 || k > 1)) return false; k = k < 0 ? 0 : k > 1 ? 1 : k; const px = a[0] + dx * k - x, py = a[1] + dy * k - y, pz = a[2] + dz * k - z, r = ra + (rb - ra) * k; return px * px + py * py + pz * pz <= r * r; } };
  },
  // vertical cylinder / disc
  cylY: (cx, cz, r, y0, y1) => ({ bb: [cx - r, y0, cz - r, cx + r, y1, cz + r], t: (x, y, z) => (x - cx) * (x - cx) + (z - cz) * (z - cz) <= r * r }),
  ringY: (cx, cz, r0, r1, y0, y1) => ({ bb: [cx - r1, y0, cz - r1, cx + r1, y1, cz + r1], t: (x, y, z) => { const d = (x - cx) * (x - cx) + (z - cz) * (z - cz); return d <= r1 * r1 && d >= r0 * r0; } }),
  cylX: (cy, cz, r, x0, x1) => ({ bb: [x0, cy - r, cz - r, x1, cy + r, cz + r], t: (x, y, z) => (y - cy) * (y - cy) + (z - cz) * (z - cz) <= r * r }),
  cylZ: (cx, cy, r, z0, z1) => ({ bb: [cx - r, cy - r, z0, cx + r, cy + r, z1], t: (x, y, z) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r }),
  // rectangle rotated in the XZ plane: centre line from (ax,az) to (bx,bz), half width hw, y range
  slab: (ax, az, bx, bz, hw, y0, y1, round) => {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9, ux = dx / L, uz = dz / L, R = hw + 1;
    return { bb: [Math.min(ax, bx) - R, y0, Math.min(az, bz) - R, Math.max(ax, bx) + R, y1, Math.max(az, bz) + R],
      t: (x, y, z) => { const px = x - ax, pz = z - az, u = px * ux + pz * uz, v = Math.abs(-px * uz + pz * ux); if (u < 0 || v > hw) return false; if (u <= L - (round || 0)) return true; if (u > L) return false; const e = u - (L - round); return v <= hw - e * e / (round * 1.15) ; } };
  },
  and: (a, f) => ({ bb: a.bb, t: a.t ? (x, y, z) => a.t(x, y, z) && f(x, y, z) : f }),
};
function put(v, s, mat, mode) { return v.fill(s.bb, s.t, mat, mode); }

// ---- preview renderer: DDA ray march, faces textured with the game's tiles ------------------------------------------------
function makeRenderer(mc) {
  const { SH, TexBlocks } = mc, BLOCKS = SH.BLOCKS;
  const tileOf = name => { const a = TexBlocks.animated && TexBlocks.animated[name]; return a ? a.frames[0] : TexBlocks.tiles[name]; };
  const FACE = BLOCKS.map(b => b.faceNames ? b.faceNames.map(tileOf) : null);
  const TINT = { grass: [0x79 / 255, 0xc0 / 255, 0x5a / 255], foliage: [0x59 / 255, 0xae / 255, 0x30 / 255], spruce: [0x61 / 255, 0x99 / 255, 0x61 / 255], birch: [0x80 / 255, 0xa7 / 255, 0x55 / 255], water: [0.25, 0.46, 0.9], lily: [0.13, 0.5, 0.19] };
  const SHADE = [0.5, 1, 0.8, 0.8, 0.62, 0.62];
  // opts: { pos:[x,y,z], look:[x,y,z], fov (deg), ortho (world units across), w, h, sky }
  function render(vox, o) {
    const W = o.w || 900, H = o.h || 600, out = Buffer.alloc(W * H * 3);
    const f = [o.look[0] - o.pos[0], o.look[1] - o.pos[1], o.look[2] - o.pos[2]]; let l = Math.hypot(f[0], f[1], f[2]); f[0] /= l; f[1] /= l; f[2] /= l;
    let r = [-f[2], 0, f[0]]; l = Math.hypot(r[0], r[2]) || 1; if (l < 1e-6) r = [1, 0, 0]; else { r[0] /= l; r[2] /= l; }
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const tanH = Math.tan((o.fov || 60) * Math.PI / 360), asp = W / H;
    const b0 = [vox.x0 - 0.5, vox.y0 - 0.5, vox.z0 - 0.5], b1 = [vox.x1 + 0.5, vox.y1 + 0.5, vox.z1 + 0.5];
    const skyTop = o.skyTop || [96, 150, 235], skyBot = o.skyBot || [196, 222, 250];
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const sx = ((px + 0.5) / W * 2 - 1) * asp, sy = 1 - (py + 0.5) / H * 2;
      let ox, oy, oz, dx, dy, dz;
      if (o.ortho) { const k = o.ortho / 2; ox = o.pos[0] + r[0] * sx * k / asp * asp + u[0] * sy * k / asp; oy = o.pos[1] + r[1] * sx * k + u[1] * sy * k / asp; oz = o.pos[2] + r[2] * sx * k + u[2] * sy * k / asp; ox = o.pos[0] + r[0] * sx * k / asp + u[0] * sy * k / asp; oy = o.pos[1] + u[1] * sy * k / asp; oz = o.pos[2] + r[2] * sx * k / asp + u[2] * sy * k / asp; dx = f[0]; dy = f[1]; dz = f[2]; }
      else { ox = o.pos[0]; oy = o.pos[1]; oz = o.pos[2]; dx = f[0] + r[0] * sx * tanH + u[0] * sy * tanH; dy = f[1] + r[1] * sx * tanH + u[1] * sy * tanH; dz = f[2] + r[2] * sx * tanH + u[2] * sy * tanH; const n = Math.hypot(dx, dy, dz); dx /= n; dy /= n; dz /= n; }
      const k0 = (py * W + px) * 3, g = py / H;
      let cr = skyTop[0] + (skyBot[0] - skyTop[0]) * g, cg = skyTop[1] + (skyBot[1] - skyTop[1]) * g, cb = skyTop[2] + (skyBot[2] - skyTop[2]) * g;
      // slab test against the grid bounds
      let t0 = 0, t1 = 1e9, ok = true;
      const O = [ox, oy, oz], D = [dx, dy, dz];
      for (let a = 0; a < 3; a++) { if (Math.abs(D[a]) < 1e-9) { if (O[a] < b0[a] || O[a] > b1[a]) { ok = false; break; } } else { let ta = (b0[a] - O[a]) / D[a], tb = (b1[a] - O[a]) / D[a]; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) { ok = false; break; } } }
      if (ok) {
        const ts = t0 + 1e-4; let x = Math.floor(ox + dx * ts + 0.5), y = Math.floor(oy + dy * ts + 0.5), z = Math.floor(oz + dz * ts + 0.5);
        const stx = dx > 0 ? 1 : -1, sty = dy > 0 ? 1 : -1, stz = dz > 0 ? 1 : -1;
        const tdx = Math.abs(1 / (dx || 1e-12)), tdy = Math.abs(1 / (dy || 1e-12)), tdz = Math.abs(1 / (dz || 1e-12));
        let tmx = ((x + stx * 0.5) - ox) / (dx || 1e-12), tmy = ((y + sty * 0.5) - oy) / (dy || 1e-12), tmz = ((z + stz * 0.5) - oz) / (dz || 1e-12);
        let face = -1, t = ts;
        for (let it = 0; it < 2000; it++) {
          if (!vox.inb(x, y, z)) { if (it > 2) break; }
          else {
            const i = vox.idx(x, y, z), id = vox.b[i];
            if (id !== 0 && SH.T_MODEL[id] !== SH.M_CROSS && SH.T_MODEL[id] !== SH.M_CROP && FACE[id]) {
              const fc = face < 0 ? 1 : face, hx = ox + dx * t - (x - 0.5), hy = oy + dy * t - (y - 0.5), hz = oz + dz * t - (z - 0.5);
              let tu, tv; if (fc < 2) { tu = hx; tv = hz; } else if (fc < 4) { tu = hx; tv = 1 - hy; } else { tu = hz; tv = 1 - hy; }
              const tile = FACE[id][fc], ti = ((Math.min(15, Math.max(0, Math.floor(tv * 16))) << 4) | Math.min(15, Math.max(0, Math.floor(tu * 16)))) << 2;
              let R = tile ? tile[ti] : 255, G = tile ? tile[ti + 1] : 0, B = tile ? tile[ti + 2] : 255;
              const d = BLOCKS[id]; if (d.tint && TINT[d.tint] && !(d.tintTopOnly && fc !== 1)) { const tn = TINT[d.tint]; R *= tn[0]; G *= tn[1]; B *= tn[2]; }
              const s = SH.BLOCKS[id].glow ? 1.1 : SHADE[fc], fog = o.nofog ? 0 : Math.min(0.55, t / (o.fogDist || 900));
              cr = R * s * (1 - fog) + cr * fog; cg = G * s * (1 - fog) + cg * fog; cb = B * s * (1 - fog) + cb * fog;
              break;
            }
          }
          if (tmx < tmy && tmx < tmz) { t = tmx; tmx += tdx; x += stx; face = stx > 0 ? 4 : 5; }
          else if (tmy < tmz) { t = tmy; tmy += tdy; y += sty; face = sty > 0 ? 0 : 1; }
          else { t = tmz; tmz += tdz; z += stz; face = stz > 0 ? 2 : 3; }
          if (t > t1 + 1) break;
        }
      }
      out[k0] = Math.min(255, cr); out[k0 + 1] = Math.min(255, cg); out[k0 + 2] = Math.min(255, cb);
    }
    return { w: W, h: H, rgb: out };
  }
  return render;
}

// ---- PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function writePNG(file, img) {
  const { w, h, rgb } = img, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}
// several views side by side / stacked into one sheet
function sheet(imgs, cols) {
  const w = imgs[0].w, h = imgs[0].h, rows = Math.ceil(imgs.length / cols), out = Buffer.alloc(w * cols * h * rows * 3, 30);
  imgs.forEach((im, i) => { const cx = (i % cols) * w, cy = Math.floor(i / cols) * h; for (let y = 0; y < h; y++) im.rgb.copy(out, ((cy + y) * w * cols + cx) * 3, y * w * 3, (y + 1) * w * 3); });
  return { w: w * cols, h: h * rows, rgb: out };
}

module.exports = { Vox, sh, put, loadGame, makeRenderer, writePNG, sheet, ROOT };
