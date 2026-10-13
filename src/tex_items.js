/* =====================================================================================
 * tex_items.js  -  Module B: procedural vanilla-style (Minecraft Java 1.20) item sprites.
 * Publishes exactly one global:  TexItems = { size: 16, names: [...], tiles: { name: Uint8ClampedArray(1024) } }
 * Pixel layout: RGBA, row-major, origin top-left, non-premultiplied. Transparent pixels have alpha 0
 * and carry the RGB of neighbouring opaque pixels (clean mip-maps).
 * Everything is painted procedurally (shapes / lines / outlines / directional shading) with the real
 * vanilla palettes. Deterministic (seeded PRNG per tile name).
 * ===================================================================================== */
(function (G) {
  'use strict';

  // ------------------------------------------------------------------ colour + PRNG utils
  const HC = Object.create(null);
  function hx(h) { let v = HC[h]; if (v === undefined) { v = parseInt(h.slice(1), 16); HC[h] = v; } return v; }
  function K(k) { return typeof k === 'string' ? hx(k) : k; }
  function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function scaleCol(h, f) { const v = K(h); return (clamp(Math.round(((v >> 16) & 255) * f[0]), 0, 255) << 16) | (clamp(Math.round(((v >> 8) & 255) * f[1]), 0, 255) << 8) | clamp(Math.round((v & 255) * f[2]), 0, 255); }

  // ------------------------------------------------------------------ canvas (Int32Array(256): -1 = transparent, else 0xRRGGBB)
  function cv() { const c = new Int32Array(256); c.fill(-1); return c; }
  function inb(x, y) { return x >= 0 && y >= 0 && x < 16 && y < 16; }
  function P(c, x, y, k) { if (inb(x, y)) c[y * 16 + x] = K(k); }
  function Q(c, x, y) { return inb(x, y) ? c[y * 16 + x] : -1; }
  function on(c, x, y) { return Q(c, x, y) !== -1; }
  function hl(c, x0, x1, y, k) { for (let x = x0; x <= x1; x++) P(c, x, y, k); }
  function vl(c, x, y0, y1, k) { for (let y = y0; y <= y1; y++) P(c, x, y, k); }
  function rect(c, x, y, w, h, k) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(c, x + i, y + j, k); }
  function pts(c, list, k) { for (let i = 0; i < list.length; i += 2) P(c, list[i], list[i + 1], k); }
  function line(c, x0, y0, x1, y1, k) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (;;) { P(c, x0, y0, k); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  function polyline(c, p, k) { for (let i = 0; i + 3 < p.length; i += 2) line(c, p[i], p[i + 1], p[i + 2], p[i + 3], k); }
  function region(c, pred, k) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (pred(x, y)) P(c, x, y, typeof k === 'function' ? k(x, y) : k); }
  function inPoly(p, x, y) { let r = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) r = !r; } return r; }
  function poly(c, p, k) { region(c, (x, y) => inPoly(p, x + 0.5, y + 0.5), k); }
  function ell(c, cx, cy, rx, ry, k) { region(c, (x, y) => { const a = (x + 0.5 - cx) / rx, b = (y + 0.5 - cy) / ry; return a * a + b * b <= 1; }, k); }
  // capsule / tapered stroke from A to B with radius ra at A and rb at B
  function capsule(c, ax, ay, bx, by, ra, rb, k) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    region(c, (x, y) => { const px = x + 0.5 - ax, py = y + 0.5 - ay; const u = clamp((px * dx + py * dy) / L2, 0, 1); const qx = px - u * dx, qy = py - u * dy; const r = ra + (rb - ra) * u; return qx * qx + qy * qy <= r * r; }, k);
  }
  function over(dst, src) { for (let i = 0; i < 256; i++) if (src[i] !== -1) dst[i] = src[i]; }
  function maskOf(c) { const m = new Uint8Array(256); for (let i = 0; i < 256; i++) m[i] = c[i] !== -1 ? 1 : 0; return m; }
  function mAt(m, x, y) { return inb(x, y) ? m[y * 16 + x] : 0; }
  function mask(pred) { const m = new Uint8Array(256); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (pred(x, y)) m[y * 16 + x] = 1; return m; }
  function mUnion(a, b) { const m = new Uint8Array(256); for (let i = 0; i < 256; i++) m[i] = a[i] | b[i]; return m; }
  function mSub(a, b) { const m = new Uint8Array(256); for (let i = 0; i < 256; i++) m[i] = a[i] & !b[i]; return m; }
  function edgeOf(m) { const e = new Uint8Array(256); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = y * 16 + x; if (m[i] && (!mAt(m, x - 1, y) || !mAt(m, x + 1, y) || !mAt(m, x, y - 1) || !mAt(m, x, y + 1))) e[i] = 1; } return e; }

  // Adds a 1px outline (4-neighbourhood) around the opaque pixels of `src`, written into `dst` where dst is empty.
  // pick(x, y, u, d, l, r): u/d/l/r tell on which side(s) the shape is (u = shape pixel above the outline pixel).
  function outlineInto(dst, src, pick, skip) {
    const m = maskOf(src);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const i = y * 16 + x; if (m[i] || dst[i] !== -1 || (skip && skip[i])) continue;
      const u = mAt(m, x, y - 1), d = mAt(m, x, y + 1), l = mAt(m, x - 1, y), r = mAt(m, x + 1, y);
      if (u || d || l || r) dst[i] = K(pick(x, y, u, d, l, r));
    }
  }
  // light-from-top-left rule: outline pixels above/left of the shape get `top`, below/right get `bot`
  function tlRule(top, bot) { return (x, y, u, d, l, r) => { const s = d + r - u - l; return s > 0 ? top : s < 0 ? bot : (d ? top : bot); }; }

  // steps needed to leave mask m in each direction (1 = pixel sits on that edge)
  function dist4(m) {
    const U = new Uint8Array(256), D = new Uint8Array(256), L = new Uint8Array(256), R = new Uint8Array(256);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = y * 16 + x; if (!m[i]) continue; U[i] = (y > 0 && m[i - 16]) ? U[i - 16] + 1 : 1; L[i] = (x > 0 && m[i - 1]) ? L[i - 1] + 1 : 1; }
    for (let y = 15; y >= 0; y--) for (let x = 15; x >= 0; x--) { const i = y * 16 + x; if (!m[i]) continue; D[i] = (y < 15 && m[i + 16]) ? D[i + 16] + 1 : 1; R[i] = (x < 15 && m[i + 1]) ? R[i + 1] + 1 : 1; }
    return { U, D, L, R };
  }
  // smooth value noise in [-1,1] with the given cell size (clustered, "blotchy" variation)
  function vnoise(rand, cell) {
    const n = Math.ceil(16 / cell) + 2, g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rand() * 2 - 1;
    return (x, y) => {
      const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const a = g[iy * n + ix], b = g[iy * n + ix + 1], c = g[(iy + 1) * n + ix], d = g[(iy + 1) * n + ix + 1];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  // Directional (top-left light) shading of the pixels in mask m with tones[] (dark -> light).
  // o: base (tone index of the flat interior), grad (strength of the diagonal gradient over the bbox), lit (+ on top/left edge),
  //    dark (- on bottom/right edge), dark2 (- one pixel further in), noise (amplitude of clustered noise), cell, rand, speck
  function shade(c, m, tones, o) {
    const { U, D, L, R } = dist4(m);
    let x0 = 16, y0 = 16, x1 = -1, y1 = -1;
    for (let i = 0; i < 256; i++) if (m[i]) { const x = i & 15, y = i >> 4; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const rand = o.rand || mulberry(1), nz = o.noise ? vnoise(rand, o.cell || 3) : null, n = tones.length;
    const lit = o.lit === undefined ? 1 : o.lit, dark = o.dark === undefined ? 1 : o.dark, dark2 = o.dark2 || 0;
    for (let i = 0; i < 256; i++) {
      if (!m[i]) continue;
      const x = i & 15, y = i >> 4;
      const a = Math.min(U[i], L[i]), b = Math.min(D[i], R[i]);
      const gx = (x - x0) / Math.max(1, x1 - x0), gy = (y - y0) / Math.max(1, y1 - y0);
      let k = (o.base === undefined ? (n - 1) / 2 : o.base) + (1 - gx - gy) * (o.grad || 0);
      if (a === 1) k += lit;
      if (b === 1) k -= dark; else if (b === 2) k -= dark2;
      if (nz) k += nz(x, y) * o.noise;
      if (o.speck && rand() < o.speck) k += rand() < 0.5 ? -1 : 1;
      c[i] = K(tones[clamp(Math.round(k), 0, n - 1)]);
    }
  }
  // Paints a solid silhouette: boundary pixels become the outline (top-left side `olT`, bottom-right side `olB`),
  // the interior is shaded with shade(). Returns the interior mask.
  function blob(c, m, olT, olB, tones, o) {
    const e = edgeOf(m), inner = mSub(m, e);
    let sx = 0, sy = 0, sn = 0; for (let i = 0; i < 256; i++) if (m[i]) { sx += i & 15; sy += i >> 4; sn++; }
    const cx = sx / Math.max(1, sn), cy = sy / Math.max(1, sn);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const i = y * 16 + x; if (!e[i]) continue;
      const s = (!mAt(m, x, y - 1)) + (!mAt(m, x - 1, y)) - (!mAt(m, x, y + 1)) - (!mAt(m, x + 1, y));
      c[i] = K(s > 0 ? olT : s < 0 ? olB : ((x - cx) + (y - cy) < 0 ? olT : olB));
    }
    if (tones) shade(c, inner, tones, o || {});
    return inner;
  }

  // ------------------------------------------------------------------ tile output (with colour bleed into alpha-0 pixels)
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function toTile(c) {
    const t = new Uint8ClampedArray(1024);
    let col = Int32Array.from(c);
    for (let pass = 0; pass < 20; pass++) {
      let changed = false; const nxt = Int32Array.from(col);
      for (let i = 0; i < 256; i++) {
        if (col[i] !== -1) continue;
        const x = i & 15, y = i >> 4; let r = 0, g = 0, b = 0, n = 0;
        for (const d of N4) { const X = x + d[0], Y = y + d[1]; if (!inb(X, Y)) continue; const v = col[Y * 16 + X]; if (v === -1) continue; r += (v >> 16) & 255; g += (v >> 8) & 255; b += v & 255; n++; }
        if (n) { nxt[i] = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n); changed = true; }
      }
      col = nxt; if (!changed) break;
    }
    for (let i = 0; i < 256; i++) {
      const v = col[i] === -1 ? 0 : col[i];
      t[i * 4] = (v >> 16) & 255; t[i * 4 + 1] = (v >> 8) & 255; t[i * 4 + 2] = v & 255; t[i * 4 + 3] = c[i] === -1 ? 0 : 255;
    }
    return t;
  }

  // =================================================================== STICK + TOOL HANDLE
  const HB = '#493615', HL = '#896727', HM = '#684e1e', HD = '#281e0b';   // stick: upper edge, light core, dark core, lower edge
  // The stick lies on the anti-diagonal x + y = 16 (3 px per row: upper edge / core / lower edge).
  function stickItem(c) {
    for (let y = 2; y <= 14; y++) {
      const x = 16 - y;
      if (y === 2) { P(c, x - 1, y, HB); P(c, x, y, HD); continue; }
      if (y === 14) { P(c, x, y, HD); P(c, x + 1, y, HD); continue; }
      P(c, x - 1, y, HB); P(c, x, y, (y === 3 || y === 13 || !(y & 1)) ? HL : HM); P(c, x + 1, y, HD);
    }
  }
  // tool handle from row yTop (top end cap) down to the knob at the lower-left corner
  function toolHandle(c, yTop) {
    for (let y = yTop; y <= 13; y++) {
      const x = 16 - y;
      if (y === yTop) { P(c, x - 1, y, HB); P(c, x, y, HM); P(c, x + 1, y, HL); continue; }
      P(c, x - 1, y, HB); P(c, x, y, (y & 1) ? HL : HM); P(c, x + 1, y, HD);
    }
    P(c, 2, 14, HD); P(c, 3, 14, HD); P(c, 1, 13, HL);
  }

  // =================================================================== TOOLS (shared silhouettes, material palettes)
  const TOOL_PAL = {
    wooden: { ol: '#372910', od: '#20180a', h: '#886626', l: '#755821', m: '#6a501e' },
    stone: { ol: '#494949', od: '#181818', h: '#9a9a9a', l: '#898989', m: '#7f7f7f' },
    iron: { ol: '#444444', od: '#181818', h: '#ffffff', l: '#d8d8d8', m: '#c1c1c1' },
    golden: { ol: '#825d16', od: '#3f2e0e', h: '#fdff76', l: '#eaee57', m: '#e9b115' },
    diamond: { ol: '#0e3f36', od: '#082520', h: '#33ebcb', l: '#2bc7ac', m: '#27b29a' },
  };
  const SWORD_PAL = {
    wooden: { ol: '#372910', od: '#20180a', t: ['#866526', '#755821', '#594319', '#473614', '#473614'], metal: false },
    stone: { ol: '#494949', od: '#212121', t: ['#b3b1af', '#95918d', '#787777', '#5a5a5a', '#5a5a5a'], metal: false },
    iron: { ol: '#444444', od: '#181818', t: ['#ffffff', '#d8d8d8', '#bebebe', '#969696', '#6b6b6b'], metal: true },
    golden: { ol: '#825d16', od: '#3f2e0e', t: ['#ffffff', '#fdff76', '#eaee57', '#e9b115', '#dc9613'], metal: true },
    diamond: { ol: '#0e3f36', od: '#082520', t: ['#a4fdf0', '#33ebcb', '#2bc7ac', '#1e8a77', '#156355'], metal: true },
  };

  // Sword: blade = band 14 <= x+y <= 16 running from the tip (top-right) to the guard; guard = short bar perpendicular to it.
  function sword(c, M) {
    const t = M.t;
    for (let y = 1; y <= 9; y++) for (let s = 14; s <= 16; s++) {
      if ((y === 1 && s === 16) || (y === 9 && s === 14)) continue;
      let k;
      if (M.metal) {
        if (s === 15) k = y === 1 ? 0 : y <= 7 ? 2 : y === 8 ? 3 : 4;
        else if (s === 14) k = y <= 5 ? 0 : 1;
        else k = y <= 3 ? 0 : 1;
      } else {
        if (s === 15) k = y <= 7 ? 0 : y === 8 ? 2 : 3;
        else k = y <= 5 ? 1 : 2;
      }
      P(c, s - y, y, t[k]);
    }
    // blade outline: lit upper edge (x+y = 13) and dark lower edge (x+y = 17)
    for (let y = 0; y <= 7; y++) P(c, 13 - y, y, M.ol);
    P(c, 14, 0, M.ol); P(c, 15, 0, M.ol); P(c, 15, 1, M.od);
    for (let y = 2; y <= 10; y++) P(c, 17 - y, y, M.od);
    // cross guard: lit upper arm, shaded lower arm (drawn with the outline tone), dark rim
    pts(c, [3, 7, 5, 10], t[4]); pts(c, [4, 8, 4, 9, 5, 9], t[3]);
    pts(c, [6, 10, 6, 11, 7, 11, 8, 12], M.ol);
    pts(c, [2, 6, 3, 6, 2, 7, 4, 7, 3, 8, 3, 9, 4, 10], M.ol);
    pts(c, [5, 8, 5, 11, 8, 11, 9, 12, 9, 13, 8, 13, 7, 12, 6, 12, 4, 12, 3, 13], M.od);
    // grip (wooden) + pommel
    pts(c, [3, 11, 2, 12], HB); pts(c, [4, 11, 3, 12, 2, 13], HM);
    pts(c, [0, 13, 1, 13, 0, 14], M.ol); P(c, 1, 14, t[4]); pts(c, [2, 14, 0, 15, 1, 15, 2, 15], M.od);
  }

  // Pickaxe: head = arc (top bar -> 2px stair -> vertical arm), tone cycle [light, mid, mid], bright tips.
  function pickaxe(c, M) {
    toolHandle(c, 3);
    const path = [];
    for (let x = 6; x <= 10; x++) path.push([x, 3]);
    path.push([10, 4], [11, 4], [11, 5], [12, 5], [12, 6], [13, 6]);
    for (let y = 7; y <= 10; y++) path.push([13, y]);
    const head = cv();
    path.forEach((p, i) => P(head, p[0], p[1], (i === 0 || i === path.length - 1) ? M.h : (i % 3 === 1 ? M.l : M.m)));
    over(c, head);
    outlineInto(c, head, (x, y) => (y <= 3 || x <= 6) ? M.ol : M.od);
  }
  // Axe: blade on the upper-left of the handle top + short back; shaded by distance to the lit (upper-left) rim.
  function axe(c, M) {
    toolHandle(c, 4);
    const head = cv();
    const rows = [[2, 9, 10], [3, 8, 10], [4, 7, 10], [5, 7, 11], [6, 10, 12], [7, 11, 12]];
    for (const r of rows) hl(head, r[1], r[2], r[0], M.m);
    const all = mUnion(maskOf(c), maskOf(head)), { U, L } = dist4(all);
    for (let i = 0; i < 256; i++) if (head[i] !== -1) { const d = Math.min(U[i], L[i]); head[i] = K(d === 1 ? M.h : d === 2 ? M.l : M.m); }
    over(c, head);
    outlineInto(c, head, (x, y) => y <= 4 ? M.ol : M.od);
  }
  // Shovel: blade = rounded rhombus 14 <= x+y <= 18, 4 <= x-y <= 10; bright rim, darker spine continuing the handle.
  function shovel(c, M) {
    toolHandle(c, 6);
    const head = cv();
    region(head, (x, y) => { const s = x + y, t = x - y; return s >= 14 && s <= 18 && t >= 4 && t <= 10 && !(t === 10 && s !== 16); },
      (x, y) => { const s = x + y, t = x - y; return (s === 14 || s === 18 || t === 9) ? M.h : s === 16 ? M.m : M.l; });
    over(c, head);
    outlineInto(c, head, (x, y) => (x + y <= 14) ? M.ol : M.od);
  }
  // Hoe: flat blade reaching to the upper-left, joined to the handle top by a 2px neck.
  function hoe(c, M) {
    toolHandle(c, 3);
    const head = cv();
    hl(head, 7, 9, 2, M.l); P(head, 7, 2, M.h);
    for (const p of [[9, 3], [10, 3], [10, 4], [11, 4], [11, 5], [12, 5]]) P(head, p[0], p[1], ((p[0] + p[1]) % 3 === 1) ? M.l : M.m);
    over(c, head);
    outlineInto(c, head, (x, y) => (y <= 2 || (y === 3 && x >= 11)) ? M.ol : M.od);
  }

  // =================================================================== ARMOR (shared silhouettes)
  const LEATHER_TINT = [0xa0 / 255 * 1.1, 0x65 / 255 * 1.1, 0x40 / 255 * 1.1];      // vanilla default leather colour, slightly lifted
  function leatherTone(g) { return scaleCol(g, LEATHER_TINT); }
  const ARMOR_PAL = {
    leather: { ol: leatherTone('#535353'), od: leatherTone('#353535'), w: leatherTone('#dcdcdc'), l: leatherTone('#cfcfcf'), m: leatherTone('#b3b3b3'), d: leatherTone('#969696'), dd: leatherTone('#737373') },
    iron: { ol: '#2d2d2d', od: '#191919', w: '#ffffff', l: '#d8d8d8', m: '#c6c6c6', d: '#969696', dd: '#6b6b6b' },
    golden: { ol: '#825d16', od: '#3f2e0e', w: '#ffffff', l: '#fdff76', m: '#eaee57', d: '#e9b115', dd: '#dc9613' },
    diamond: { ol: '#0e3f36', od: '#082520', w: '#ffffff', l: '#a1fbe8', m: '#4aedd9', d: '#20c5b5', dd: '#1aaaa7' },
  };
  function helmet(c, A) {
    const s = cv();
    hl(s, 5, 10, 4, A.m); hl(s, 4, 11, 5, A.m); hl(s, 4, 11, 6, A.m); pts(s, [4, 7, 5, 7, 10, 7, 11, 7], A.m);
    vl(s, 4, 8, 10, A.m); vl(s, 11, 8, 10, A.m);
    // shading: dark right side, lit highlight cluster top-left, darkened rounded corners
    region(s, (x, y) => on(s, x, y) && (x >= 10 || (y === 6 && x >= 9)), A.d);
    pts(s, [10, 4, 10, 7, 11, 10], A.dd); pts(s, [5, 4, 4, 5, 4, 10], A.d);
    pts(s, [5, 5, 7, 5, 5, 6, 6, 6], A.l); P(s, 6, 5, A.w);
    over(c, s);
    outlineInto(c, s, (x, y) => (x <= 4 || y <= 3) ? A.ol : A.od);
    // the dark inside of the helmet (visible through the face opening)
    region(c, (x, y) => (y === 7 && x >= 6 && x <= 9) || (y >= 8 && y <= 10 && x >= 5 && x <= 10), A.od);
    pts(c, [6, 7, 7, 7, 8, 7, 5, 8, 5, 9], A.ol);
    pts(c, [4, 11], A.ol); pts(c, [5, 11, 10, 11, 11, 11], A.od);
  }
  function chestplate(c, A) {
    const s = cv();
    rect(s, 2, 3, 3, 4, A.m); rect(s, 11, 3, 3, 4, A.m);           // shoulder pads
    pts(s, [5, 4, 5, 5, 6, 5, 10, 4, 10, 5, 9, 5], A.m);            // collar slopes
    hl(s, 2, 13, 6, A.m); rect(s, 4, 7, 8, 6, A.m); hl(s, 5, 10, 13, A.m);
    // shading
    pts(s, [2, 3, 11, 3], A.w); pts(s, [3, 3, 12, 3, 2, 4, 11, 4], A.l);
    pts(s, [5, 4, 10, 4, 6, 5, 9, 5, 2, 6, 13, 6], A.d);
    P(s, 5, 6, A.w); pts(s, [6, 6, 7, 6, 8, 6, 4, 7, 5, 7, 6, 7, 4, 8, 5, 8, 5, 9], A.l);
    hl(s, 5, 10, 12, A.d); pts(s, [11, 9, 11, 10, 11, 11, 10, 11, 4, 11, 6, 13, 7, 13, 8, 13, 9, 13], A.d);
    pts(s, [11, 12, 4, 12, 5, 13, 10, 13], A.dd);
    over(c, s);
    outlineInto(c, s, (x, y) => y <= 6 ? A.ol : A.od);
  }
  function leggings(c, A) {
    const s = cv();
    rect(s, 4, 3, 8, 3, A.m); pts(s, [4, 6, 5, 6, 6, 6, 9, 6, 10, 6, 11, 6], A.m);
    rect(s, 4, 7, 2, 6, A.m); rect(s, 10, 7, 2, 6, A.m);
    vl(s, 4, 3, 6, A.l); pts(s, [5, 3, 6, 3], A.w); pts(s, [7, 3, 8, 3, 5, 4], A.l);
    pts(s, [11, 3], A.dd); vl(s, 11, 4, 6, A.d); pts(s, [6, 5, 7, 5, 8, 5, 6, 6, 5, 11, 11, 11, 11, 12, 5, 12], A.d); P(s, 9, 6, A.dd);
    vl(s, 5, 8, 10, A.d); vl(s, 11, 7, 10, A.d); pts(s, [4, 10, 4, 11, 10, 10, 10, 11, 4, 12, 10, 12], A.d); pts(s, [5, 11, 11, 11], A.dd);
    over(c, s);
    outlineInto(c, s, (x, y, u, d, l, r) => ((r && y <= 11) || (d && x <= 10)) ? A.ol : A.od);
  }
  function boots(c, A) {
    const s = cv();
    // left boot (toe to the left) and right boot (toe to the right)
    rect(s, 4, 4, 2, 5, A.m); hl(s, 3, 5, 9, A.m); hl(s, 2, 5, 10, A.m); hl(s, 2, 3, 11, A.m);
    rect(s, 10, 4, 2, 5, A.m); hl(s, 10, 12, 9, A.m); hl(s, 10, 13, 10, A.m); hl(s, 12, 13, 11, A.m);
    pts(s, [4, 4, 10, 4], A.w); pts(s, [5, 4, 4, 5, 5, 5, 11, 4, 10, 5, 4, 6], A.l);
    pts(s, [5, 8, 5, 9, 4, 10, 2, 11, 3, 11, 10, 9, 12, 9, 11, 10, 13, 10, 12, 11, 13, 11], A.d); pts(s, [5, 10, 10, 10], A.dd);
    over(c, s);
    outlineInto(c, s, (x, y, u, d, l, r) => (r || (d && !u)) && !(y <= 3 && (x === 3 || x === 12)) ? ((x <= 3 || (x === 9) || y <= 3) ? A.ol : A.od) : A.od);
  }

  // =================================================================== REGISTRY
  const NAMES = [], TILES = {};
  function def(name, fn) {
    const c = cv(); fn(c, mulberry(hash(name)));
    NAMES.push(name); TILES[name] = toTile(c);
  }

  // =================================================================== shared painters for materials / food
  // Ingot-like prism (iron_ingot, gold_ingot, brick): top face = parallelogram with 1:3 long edges, extruded down.
  // Skew coordinates: u = x + 3y (constant along the long edges), v = x - y (constant along the short edges).
  function ingot(c, p) {
    const solid = (x, y) => { const u = x + 3 * y, v = x - y; return u >= 19 && u <= 42 && v >= -9 && v <= 8 && x >= 1 && x <= 14; };
    const s = cv();
    region(s, solid, (x, y) => {
      const u = x + 3 * y, v = x - y;
      if (v <= -6) return v === -9 ? p.f2 : p.f1;                                   // left end face
      if (u >= 33) return v >= 5 ? p.f1 : u >= 41 ? p.f2 : u <= 38 ? p.f3 : p.f2;     // long front face
      if (v === -5 || u >= 30) return v <= 7 ? p.edge : p.f1;                          // lit front edges of the top face
      if (u === 19 || v === 8) return p.f1;                                            // back edges
      return p.top;
    });
    if (p.topNoise) { const r = p.rand; for (let i = 0; i < 256; i++) if (s[i] === K(p.top) && r() < p.topNoise) s[i] = K(p.top2); }
    over(c, s);
    outlineInto(c, s, (x, y) => { const u = x + 3 * y, v = x - y; return u <= 18 ? p.ol : (u >= 43 && v >= -8) ? p.od : (x >= 15 && u >= 34) ? p.od : v >= 9 ? p.f3 : p.ol; });
  }
  // dust / powder mound (redstone, gunpowder, sugar, glowstone dust)
  function pileMask(cx, hw) {   // hw: half widths for rows 3..
    return mask((x, y) => { const k = y - 3; if (k < 0 || k >= hw.length) return false; return Math.abs(x + 0.5 - cx) <= hw[k]; });
  }
  // scattered seeds: each seed = small 2x2 / 1x2 cluster
  function seeds(c, list, pal) {
    for (const s of list) {
      const [x, y, kind] = s;
      if (kind === 0) { P(c, x, y, pal[0]); P(c, x + 1, y, pal[1]); P(c, x, y + 1, pal[1]); P(c, x + 1, y + 1, pal[2]); }
      else if (kind === 1) { P(c, x, y, pal[0]); P(c, x, y + 1, pal[2]); }
      else { P(c, x, y, pal[1]); P(c, x + 1, y, pal[2]); }
    }
  }

  // =================================================================== MATERIALS
  def('stick', (c) => stickItem(c));

  def('coal', (c, rand) => {
    const m = mask((x, y) => inPoly([5, 2, 9, 2, 12, 5, 15, 9, 15, 12, 13, 14, 10, 15, 5, 15, 2, 12, 2, 7], x + 0.5, y + 0.5));
    blob(c, m, '#1c1c1e', '#101015', ['#1f1721', '#261e24', '#252525', '#2e2e2e', '#323232', '#363636'], { rand, base: 2.2, grad: 1.7, lit: 0.8, dark: 1.2, noise: 1.4, cell: 2 });
    pts(c, [5, 4, 7, 5, 4, 7], '#393e46');
  });
  def('charcoal', (c, rand) => {
    const m = mask((x, y) => inPoly([6, 1, 10, 1, 14, 5, 15, 8, 15, 12, 12, 15, 5, 15, 2, 12, 2, 6], x + 0.5, y + 0.5));
    const inner = blob(c, m, '#1d1a14', '#13110d', ['#13110d', '#1d1a14', '#231f18', '#2b261d', '#312b22', '#423b2f', '#4e4536'], { rand, base: 2.2, grad: 2.6, lit: 1.2, dark: 1, noise: 1.8, cell: 1.8 });
    // warm ashy specks concentrated on the lit upper-left
    for (let i = 0; i < 256; i++) if (inner[i]) { const x = i & 15, y = i >> 4; const w = 1 - (x + y - 6) / 12; if (rand() < 0.28 * w) c[i] = K(rand() < 0.35 ? '#7d6f58' : rand() < 0.6 ? '#605543' : '#4e4536'); }
  });
  def('iron_ingot', (c) => ingot(c, { top: '#d8d8d8', edge: '#ffffff', f1: '#a8a8a8', f2: '#828282', f3: '#727272', ol: '#5e5e5e', od: '#353535' }));
  def('gold_ingot', (c) => ingot(c, { top: '#fdf55f', edge: '#fffde0', f1: '#fad64a', f2: '#e9b115', f3: '#dc9613', ol: '#b26411', od: '#752802' }));
  def('brick', (c, rand) => ingot(c, { top: '#b75a40', top2: '#c76245', topNoise: 0.08, rand, edge: '#c76245', f1: '#8e4631', f2: '#7f3e2c', f3: '#612f22', ol: '#492319', od: '#2d1610' }));

  def('diamond', (c) => {
    const m = mUnion(mask((x, y) => { const dx = x + 0.5 - 7.5, dy = y + 0.5 - 7.6; return dx * dx / 42 + dy * dy / 44 <= 1; }),
      mask((x, y) => { const dx = x + 0.5 - 7.5, dy = y + 0.5 - 9.6; return dx * dx / 38 + dy * dy / 26 <= 1; }));
    const inner = blob(c, m, '#11727a', '#145e53', null);
    const { U, D, L, R } = dist4(inner);
    for (let i = 0; i < 256; i++) {
      if (!inner[i]) continue;
      const x = i & 15, y = i >> 4, a = Math.min(U[i], L[i]);
      let k;
      if (y >= 10) {                                                    // pavilion: girdle line, darker facets, bottom reflection
        if (y === 10) k = L[i] <= 2 ? '#4aedd9' : R[i] <= 2 ? '#20c5b5' : '#1aaaa7';
        else if (D[i] === 1) k = x >= 8 ? '#a1fbe8' : '#4aedd9';
        else if (L[i] === 1) k = '#2ce0d8';
        else if (L[i] === 2 || R[i] === 2) k = '#1aaaa7';
        else k = '#20c5b5';
      } else {                                                          // crown: white rim, light table, dark right facets
        if (a === 1) k = (U[i] === 1 && x >= 9) || (L[i] === 1 && y >= 9) ? '#d5fff6' : '#ffffff';
        else if (R[i] === 1) k = '#1aaaa7';
        else if (R[i] === 2) k = '#20c5b5';
        else if (R[i] === 3) k = y >= 7 ? '#1c919a' : '#4aedd9';
        else if (L[i] === 2 || U[i] === 2) k = '#4aedd9';
        else k = '#a1fbe8';
      }
      c[i] = K(k);
    }
    pts(c, [6, 6], '#ffffff'); pts(c, [8, 6, 5, 8], '#d5fff6');
  });
  def('emerald', (c) => {
    const m = mask((x, y) => inPoly([6, 1, 10, 1, 13, 4.5, 13, 11, 10.5, 14, 5.5, 14, 3, 11, 3, 4.5], x + 0.5, y + 0.5));
    const inner = blob(c, m, '#005300', '#002d00', null);
    let x0 = 16, x1 = 0; for (let i = 0; i < 256; i++) if (inner[i]) { x0 = Math.min(x0, i & 15); x1 = Math.max(x1, i & 15); }
    const { U, D } = dist4(inner);
    for (let i = 0; i < 256; i++) {
      if (!inner[i]) continue;
      const x = i & 15, col = x - x0; let k;
      if (col === 0) k = U[i] <= 2 ? '#dbffeb' : '#affdcd';
      else if (col <= 2) k = '#17dd62';
      else if (col === 3) k = U[i] <= 2 ? '#41f384' : '#affdcd';
      else if (col === 4) k = U[i] <= 2 ? '#41f384' : '#82f6ad';
      else if (x === x1) k = '#00aa2c';
      else if (x === x1 - 1) k = '#007b18';
      else k = '#00aa2c';
      if (D[i] <= 2 && col > 0) k = D[i] === 1 ? '#009529' : (col <= 4 ? '#00aa2c' : '#007b18');
      c[i] = K(k);
    }
  });
  def('redstone', (c, rand) => {
    const m = mask((x, y) => inPoly([5, 2, 9, 2, 10, 4.2, 12, 5, 14, 8, 15, 10.5, 14, 12, 12.2, 13, 12, 14, 9, 15, 6, 15, 3, 12.5, 2, 11, 2, 7, 4, 5, 5.6, 4.4], x + 0.5, y + 0.5));
    const inner = blob(c, m, '#5c0700', '#2d0000', ['#340605', '#410500', '#5c0700', '#720000', '#aa0f01'], { rand, base: 2.2, grad: 1.2, lit: 1.4, dark: 1.2, noise: 2.1, cell: 1.4, speck: 0.15 });
    for (let i = 0; i < 256; i++) if (inner[i] && c[i] === K('#aa0f01') && rand() < 0.4) c[i] = K('#ff0000');
    for (let i = 0; i < 256; i++) { const x = i & 15, y = i >> 4; if (m[i] && !inner[i] && y <= 6 && x <= 9 && c[i] === K('#5c0700') && rand() < 0.5) c[i] = K('#aa0f01'); }
  });
  def('lapis_lazuli', (c, rand) => {
    const m = mUnion(mask((x, y) => { const dx = x + 0.5 - 9.6, dy = y + 0.5 - 5.2; return dx * dx / 21 + dy * dy / 16 <= 1; }),
      mUnion(mask((x, y) => { const dx = x + 0.5 - 5.8, dy = y + 0.5 - 10.2; return dx * dx / 20 + dy * dy / 13 <= 1; }),
        mask((x, y) => { const dx = x + 0.5 - 7.5, dy = y + 0.5 - 7.7; return dx * dx / 14 + dy * dy / 14 <= 1; })));
    blob(c, m, '#1a3d8f', '#052463', ['#12408b', '#1a3d8f', '#1c53a8', '#345ec3', '#5a82e2', '#7497ea'], { rand, base: 2.6, grad: 1.4, lit: 1, dark: 1.2, noise: 1.8, cell: 1.7 });
  });
  def('flint', (c, rand) => {
    const m = mask((x, y) => inPoly([8, 2, 11, 2, 14.4, 7.5, 14.5, 10.5, 12, 14, 5, 15, 2, 11.5, 2, 8.5], x + 0.5, y + 0.5));
    blob(c, m, '#222020', '#0e0e0e', ['#222020', '#2e2d2d', '#3d3c3c', '#3d3c3c'], { rand, base: 1.9, grad: 1.2, lit: 0.6, dark: 1.2, noise: 1, cell: 2.2 });
    // bright ridge running down-left from the tip
    pts(c, [10, 4, 9, 5, 8, 5, 8, 6, 7, 6, 7, 7, 6, 8], '#565656'); pts(c, [9, 6, 8, 7], '#a8a8a8'); pts(c, [7, 8, 10, 6], '#7f7f7f');
  });
  def('clay_ball', (c, rand) => {
    const m = mask((x, y) => { const dx = x + 0.5 - 7.6, dy = y + 0.5 - 8.2; return dx * dx / 34 + dy * dy / 28 <= 1; });
    blob(c, m, '#40445a', '#373944', ['#5e6c8d', '#757d90', '#9499a4', '#a1a7b1', '#acaebd', '#afb9d6'], { rand, base: 3, grad: 1.6, lit: 1, dark: 1.6, dark2: 0.7, noise: 1.6, cell: 1.6, speck: 0.12 });
  });
  def('paper', (c) => {
    // sheet (rhombus); soft grey inner rim along the lower-left edges, bright centre
    const m = mask((x, y) => inPoly([9, 1.6, 11, 1.6, 16, 7.3, 6.8, 14.2, 0.6, 8.2], x + 0.5, y + 0.5));
    const inner = blob(c, m, '#aeaeae', '#878787', null);
    const { D, L, R, U } = dist4(inner);
    for (let i = 0; i < 256; i++) if (inner[i]) {
      const b = Math.min(D[i], L[i]);
      c[i] = K(b === 1 ? (D[i] === 1 && R[i] <= 2 ? '#c1c1c1' : '#d6d6d6') : b === 2 ? '#e9eaeb' : (U[i] === 1 ? '#e9eaeb' : '#fcfcf2'));
    }
  });
  def('book', (c) => {
    // cover (parallelogram), page edges visible along the two lower sides, back cover and outline.
    // u = x + 2y (constant along the 1:2 edges), v = x - y (constant along the 1:1 edges)
    region(c, (x, y) => { const u = x + 2 * y, v = x - y; return u >= 10 && u <= 35 && v >= -9 && v <= 9; }, (x, y) => {
      const u = x + 2 * y, v = x - y;
      if (u <= 11 || v === 9) return '#312104';                                   // top outline
      if (u >= 34 || v === -9) return '#161005';                                  // bottom outline
      if (v <= -6 && u < 18) return '#312104';                                    // left end
      if (v === -8) return u >= 19 ? '#522e10' : '#312104';                       // back cover (left)
      if (u >= 32) return u === 32 ? '#312104' : '#44250a';                       // back cover (right)
      if (v >= -7 && v <= -6) return v === -7 ? '#d6d6d6' : '#b7b7b7';            // pages (left side)
      if (u >= 28) return (u === 28 || u === 31) ? '#999999' : '#b7b7b7';         // pages (right side)
      if (u >= 26) return '#44250a';                                              // cover front edge
      if (v === -5 || u === 12) return '#522e10';                                 // cover rim
      if (u === 13 || v === 8) return '#543e13';
      if ((v === 4 && u >= 15 && u <= 23) || (v === -1 && u >= 16 && u <= 21)) return '#44250a';   // creases
      return '#654b17';
    });
    pts(c, [6, 12], '#b7b7b7');
  });
  def('string', (c) => {
    const s = cv();
    polyline(s, [10, 1, 9, 2, 9, 3, 10, 4, 11, 4, 12, 5, 13, 6, 14, 7, 14, 10, 13, 11, 12, 12, 11, 13, 9, 13], '#f7f7f7');
    polyline(s, [4, 5, 3, 6, 2, 7, 2, 8, 3, 9, 4, 10, 5, 10, 6, 11, 10, 11, 11, 10, 12, 9, 11, 8, 10, 8, 9, 7, 6, 7, 5, 8, 6, 9], '#f7f7f7');
    for (let i = 0; i < 256; i++) if (s[i] !== -1 && ((i & 15) + (i >> 4)) % 3 === 0) s[i] = K('#dbdbdb');
    over(c, s);
    outlineInto(c, s, () => '#2f4547');
  });
  def('feather', (c) => {
    // quill on x+y = 17 (t = x-y along it), white upper-left vane, grey lower-right vane with barb notches; no dark outline (vanilla)
    // vane widths (in pixels along a row) per position t along the quill: jagged barbs, tapering to the tip
    const W1 = [0, 1, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 4, 4, 4, 3, 2, 1, 0], W2 = [0, 1, 2, 2, 3, 3, 4, 4, 4, 5, 4, 4, 4, 3, 3, 2, 2, 1, 0];   // index = 11 - t
    region(c, (x, y) => { const s = x + y, t = x - y; if (t < -7 || t > 11) return false; if (s === 17) return t <= 9; const k = 11 - t; return (s < 17 && 17 - s <= W1[k]) || (s > 17 && s - 17 <= W2[k]); },
      (x, y) => { const s = x + y, t = x - y; if (s === 17) return t > 4 ? '#bebebe' : '#969696'; if (s < 17) return (17 - s >= 3 || (t & 3) === 0) ? '#d3d3d3' : '#ffffff'; return s - 17 >= 3 ? '#bebebe' : ((t & 3) === 1 ? '#bebebe' : '#d3d3d3'); });
    // bare quill end at the lower-left
    pts(c, [3, 13, 2, 14], '#969696'); P(c, 4, 13, '#bebebe');
  });
  def('leather', (c, rand) => {
    const m = mask((x, y) => {
      const X = x + 0.5, Y = y + 0.5;
      return inPoly([3, 2.6, 13, 2.6, 13, 6, 12.4, 6.6, 12.4, 9.4, 13.4, 10.2, 13, 13, 3, 13, 2.6, 10.2, 4, 9.4, 4, 6.6, 3, 5.6], X, Y) ||
        inPoly([6, 1, 10, 1, 10, 3, 6, 3], X, Y) || inPoly([1, 2, 4, 2, 4, 4, 2, 4], X, Y) || inPoly([12, 2, 15, 2, 14, 4, 12, 4], X, Y) ||
        inPoly([1, 13, 6, 12, 6, 15, 1, 15], X, Y) || inPoly([10, 12, 15, 13, 15, 15, 10, 15], X, Y);
    });
    blob(c, m, '#542716', '#3d1c10', ['#893b25', '#9e492a', '#c65c35', '#d76b43'], { rand, base: 2, grad: 0.6, lit: 0.6, dark: 1.2, noise: 0.9, cell: 2 });
    for (let y = 3; y <= 9; y++) P(c, y <= 5 ? 7 : 8, y, '#d76b43');
    pts(c, [7, 4, 8, 6], '#d76b43');
  });
  def('bone', (c) => {
    const s = cv();
    for (let y = 6; y <= 10; y++) { P(s, 15 - y, y, '#fcfbed'); P(s, 16 - y, y, '#fcfbed'); }
    rect(s, 11, 1, 3, 4, '#fcfbed'); rect(s, 12, 2, 3, 3, '#fcfbed'); P(s, 10, 3, '#fcfbed'); P(s, 10, 5, '#fcfbed');
    rect(s, 2, 10, 4, 3, '#fcfbed'); rect(s, 1, 11, 3, 2, '#fcfbed'); P(s, 4, 13, '#fcfbed'); P(s, 3, 9, '#fcfbed');
    pts(s, [12, 3, 3, 11, 4, 11, 5, 11, 4, 10], '#fffffd'); pts(s, [11, 1, 13, 1, 10, 3, 1, 12, 3, 12, 2, 13], '#cbc6a5'); pts(s, [12, 1, 11, 2, 2, 10, 3, 10, 2, 12, 14, 4, 13, 4, 5, 12, 4, 13], '#e8e5d2');
    over(c, s);
    outlineInto(c, s, (x, y, u, d, l, r) => (d || r) && !(u || l) ? '#cbc6a5' : '#7b7e6b');
  });
  def('bone_meal', (c, rand) => {
    const m = mask((x, y) => {
      const X = x + 0.5, Y = y + 0.5;
      const lump = (cx, cy, r) => (X - cx) * (X - cx) + (Y - cy) * (Y - cy) <= r * r;
      return lump(7.5, 8.3, 5.9) || lump(5, 3.6, 2.4) || lump(11, 4, 2.2) || lump(3, 7.5, 2) || lump(12.7, 8.5, 2.2) || lump(12.5, 13, 1.5);
    });
    blob(c, m, '#59557f', '#444565', ['#59557f', '#7c7a9d', '#b9b9cb', '#eaeaea', '#ffffff'], { rand, base: 2.6, grad: 0.8, lit: 0.6, dark: 1.4, noise: 2.2, cell: 1.5, speck: 0.15 });
  });
  const PILE_HW = [1, 2, 3, 4, 5, 6, 6, 6, 5, 4, 2];
  def('gunpowder', (c, rand) => {
    blob(c, pileMask(8, PILE_HW), '#505050', '#2d2d2d', ['#3e3e3e', '#494949', '#505050', '#545454', '#727272', '#8a8a8a'], { rand, base: 2.2, grad: 1.3, lit: 1.2, dark: 1.2, noise: 2.3, cell: 1.2, speck: 0.22 });
  });
  def('sugar', (c, rand) => {
    blob(c, pileMask(8, [1, 2, 3, 4.5, 5, 6, 6, 6, 5, 4, 2]), '#b9b9cb', '#545468', ['#b9b9cb', '#d5d5df', '#eaeaea', '#ffffff'], { rand, base: 2.3, grad: 1.3, lit: 0.8, dark: 1.3, noise: 1.2, cell: 1.8, speck: 0.08 });
  });
  def('glowstone_dust', (c, rand) => {
    blob(c, pileMask(7.6, [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 6.5, 6.5, 5.5, 4.5, 2.5]), '#b47140', '#5a391c', ['#7e4821', '#8e562e', '#b47140', '#ebaa4e', '#ffbc5e', '#f9d49c'], { rand, base: 2.8, grad: 1.4, lit: 1, dark: 1.8, noise: 2.2, cell: 1.2, speck: 0.2 });
  });
  def('egg', (c, rand) => {
    const m = mask((x, y) => { const dx = x + 0.5 - 7.5, dy = y + 0.5 - 8.4; const rx = dy < 0 ? 4.4 + dy * 0.12 : 4.8; return (dx * dx) / (rx * rx) + (dy * dy) / (5.4 * 5.4) <= 1; });
    blob(c, m, '#746b51', '#554e3b', ['#8e825b', '#b3a57d', '#dfce9b', '#f0e6c6'], { rand, base: 2, grad: 0.9, lit: 1, dark: 1.3, dark2: 0.6 });
  });
  def('snowball', (c, rand) => {
    const m = mask((x, y) => { const dx = x + 0.5 - 7.6, dy = y + 0.5 - 7.7; return dx * dx + dy * dy <= 38; });
    blob(c, m, '#afcaca', '#7ba6a6', ['#afcaca', '#c2dada', '#d0f1f1', '#e8f8f8', '#ffffff'], { rand, base: 3, grad: 1.4, lit: 0.8, dark: 1.8, dark2: 0.8, noise: 0.9, cell: 2.2 });
  });

  // =================================================================== FOOD & SEEDS
  def('wheat_seeds', (c) => {
    // six little seeds: bright sprout tip, olive body, dark shadow side
    for (const [x, y, v] of [[4, 3, 0], [10, 3, 1], [7, 6, 0], [3, 8, 1], [11, 8, 0], [6, 11, 1]]) {
      P(c, x, y, '#00e210'); P(c, x, y + 1, '#69b038'); P(c, x + 1, y + 1, '#2e430c'); P(c, x + 1, y + 2, '#2e430c'); P(c, x, y + 2, v ? '#447224' : '#acb038');
    }
  });
  def('wheat', (c, rand) => {
    // sheaf: grain ears fanning up-right from the tie, stalk bundle towards the lower-left corner
    const m = mask((x, y) => {
      const X = x + 0.5, Y = y + 0.5;
      const cap = (ax, ay, bx, by, ra, rb) => { const dx = bx - ax, dy = by - ay, u = clamp(((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy), 0, 1), qx = X - ax - u * dx, qy = Y - ay - u * dy, r = ra + (rb - ra) * u; return qx * qx + qy * qy <= r * r; };
      const ears = (X - 10.6) * (X - 10.6) / 20 + (Y - 5) * (Y - 5) / 22 <= 1;             // dense ear mass
      return ears || cap(6.5, 9.5, 8.6, 0.8, 1.3, 1.5) || cap(7, 9, 13.5, 1.4, 1.3, 1.4) || cap(7, 9.5, 15.2, 6.6, 1.2, 1.2) ||
        cap(6.8, 9.8, 2.6, 13.6, 1.8, 1.4) || cap(5, 11, 1.3, 12.6, 0.9, 0.9) || cap(6, 11.6, 3.8, 15.2, 0.9, 0.8);
    });
    const inner = blob(c, m, '#565138', '#565138', ['#565138', '#7f6a33', '#8d773d', '#a69553', '#cdb159', '#dcbb65'], { rand, base: 3, grad: 1.2, lit: 1, dark: 1.3, noise: 0.9, cell: 1.5 });
    for (let i = 0; i < 256; i++) if (inner[i]) {
      const x = i & 15, y = i >> 4;
      if (y >= 10 || (x <= 5 && y >= 8)) { c[i] = K((x + y) & 1 ? '#8d773d' : '#7f6a33'); continue; }   // stalks
      const g = (x + 2 * y) % 3;                                                                        // kernel striation
      if (g === 0) c[i] = K(rand() < 0.6 ? '#7f6a33' : '#8d773d'); else if (g === 1 && rand() < 0.5) c[i] = K(rand() < 0.6 ? '#cdb159' : '#dcbb65');
    }
    pts(c, [1, 12, 2, 13], '#cdb159'); P(c, 3, 14, '#a69553');                                         // cut stalk ends
    pts(c, [6, 10, 5, 10, 7, 9], '#565138');                                                            // tie
  });
  def('bread', (c, rand) => {
    const ax = 4.4, ay = 11.4, bx = 11.6, by = 4.2, cx = (ax + bx) / 2, cy = (ay + by) / 2;
    const m = mask((x, y) => { const X = x + 0.5, Y = y + 0.5, dx = bx - ax, dy = by - ay; const u = clamp(((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy), 0, 1); const qx = X - ax - u * dx, qy = Y - ay - u * dy; return qx * qx + qy * qy <= 4.4 * 4.4; });
    const inner = blob(c, m, '#654b17', '#3f2e0e', null);
    const { D, R } = dist4(inner);
    for (let i = 0; i < 256; i++) if (inner[i]) {
      const x = i & 15, y = i >> 4, p = ((x + 0.5 - cx) + (y + 0.5 - cy)) / Math.SQRT2, b = Math.min(D[i], R[i]);
      let k = p < 0.2 ? '#bc8927' : p < 1.8 ? (rand() < 0.3 ? '#bc8927' : '#a27924') : '#a27924';
      if (b === 1) k = '#8c661e'; else if (b === 2 && p > 1.5) k = rand() < 0.5 ? '#8c661e' : '#a27924';
      c[i] = K(k);
    }
    // three score cuts across the top crust (dark groove + lit lower wall)
    for (const t of [-4.4, 0, 4.4]) {
      const x0 = Math.round(cx + t / 2 - 2.2), y0 = Math.round(cy - t / 2 - 2.2);
      for (let k = 0; k < 4; k++) { const x = x0 + k, y = y0 + k - 1; if (inner[y * 16 + x] && inner[y * 16 + x + 1]) { P(c, x, y, '#654b17'); P(c, x + 1, y, k < 2 ? '#8c661e' : '#a27924'); if (inner[y * 16 + x - 1]) P(c, x - 1, y, '#bc8927'); } }
    }
  });
  function apple(c, pal) {
    const m = mask((x, y) => { const dx = x + 0.5 - 7.3, dy = y + 0.5 - 9.4; if (dx * dx + dy * dy > 6.3 * 6.3) return false; return !(y <= 4 && x >= 7 && x <= 8); });
    const inner = blob(c, m, pal.olT, pal.olB, null);
    const { D, L, R } = dist4(inner);
    for (let i = 0; i < 256; i++) if (inner[i]) {
      const x = i & 15, y = i >> 4; let k = pal.main;
      if (y <= 6) k = pal.hi2; else if (y <= 8 && x <= 9) k = pal.light; else if (y <= 8) k = pal.hi2;   // lit shoulders of the apple
      if (y >= 9 && x <= 7 && L[i] > 1) k = (x + y) % 3 ? pal.main : pal.light;
      if ((L[i] === 1 && y > 5) || D[i] === 1 || R[i] === 1) k = pal.shade;                                  // shaded rim
      c[i] = K(k);
    }
    pts(c, [4, 5, 5, 5], pal.hi2); pts(c, [5, 6, 6, 6, 7, 6], pal.spec); pts(c, [4, 6, 8, 6], pal.spec2);
    // stem
    pts(c, [9, 1, 8, 3], '#752802'); pts(c, [9, 2, 8, 4], '#542409'); P(c, 10, 1, '#7e370e');
  }
  def('apple', (c) => apple(c, { olT: '#752802', olB: '#54090e', main: '#b4131e', light: '#dd1725', hi2: '#ff1c2b', shade: '#9c1017', spec: '#ff969d', spec2: '#ff5e69' }));
  def('golden_apple', (c) => apple(c, { olT: '#b26411', olB: '#752802', main: '#dba213', light: '#eccb45', hi2: '#eaee57', shade: '#b26411', spec: '#feffe6', spec2: '#f6f892' }));
  def('melon_slice', (c, rand) => {
    // half-disc wedge: straight cut along the upper-left (x+y = 10), rind layers along the curved side
    const cx = 5.2, cy = 5.2, A = 9.4, B = 10.7;
    const rho = (X, Y) => { const q = ((X - cx) - (Y - cy)) / Math.SQRT2, p = ((X - cx) + (Y - cy)) / Math.SQRT2; return Math.sqrt((q / A) ** 2 + (p / B) ** 2); };
    region(c, (x, y) => x + y >= 10 && rho(x + 0.5, y + 0.5) <= 1, (x, y) => {
      const d = (1 - rho(x + 0.5, y + 0.5)) * 10.6, e = x + y - 10;
      if (d < 1) return '#444f0e';
      if (d < 2) return (x * 3 + y) % 7 === 0 ? '#848920' : '#59661a';
      if (d < 3) return (x + 2 * y) % 5 === 0 ? '#848920' : '#a39b20';
      if (d < 4) return (e === 0 || (x * 5 + y) % 6 === 0) ? '#c69278' : '#d6b69b';
      if (e === 0) return '#7a180e';
      return '#bf3123';
    });
    for (let i = 0; i < 256; i++) if (c[i] === K('#bf3123') && rand() < 0.25) c[i] = K('#af160b');
    for (const [x, y] of [[9, 4], [6, 7], [10, 8], [4, 10], [7, 10]]) { const v = c[y * 16 + x]; if (v === K('#bf3123') || v === K('#af160b')) P(c, x, y, '#59180f'); }
  });
  def('melon_seeds', (c) => seeds(c, [[8, 3, 0], [4, 5, 0], [12, 6, 0], [8, 8, 1], [3, 10, 0], [11, 11, 0], [6, 11, 0], [8, 13, 2], [13, 13, 1]], ['#615535', '#2a220b', '#1d1705']));
  def('pumpkin_seeds', (c) => seeds(c, [[7, 3, 0], [3, 5, 1], [11, 5, 0], [6, 8, 0], [12, 9, 1], [3, 10, 0], [8, 12, 0], [12, 13, 2]], ['#c8d4aa', '#cbc68d', '#cab16e']));
  def('cookie', (c, rand) => {
    const m = mask((x, y) => { const dx = (x + 0.5 - 7.5) / 7.3, dy = (y + 0.5 - 7.7) / 6.5; return dx * dx + dy * dy <= 1; });
    blob(c, m, '#b97335', '#452a13', ['#8b4b2b', '#b97335', '#d9833e', '#e89850', '#e89850'], { rand, base: 3, grad: 0.5, lit: 0, dark: 1.6, dark2: 1, noise: 0.8, cell: 1.6 });
    for (const [x, y, k] of [[5, 4, 0], [9, 4, 1], [11, 7, 0], [3, 8, 1], [7, 7, 0], [9, 10, 1], [12, 10, 0], [5, 11, 1]]) {
      P(c, x, y, '#452a13'); P(c, x + 1, y, k ? '#4b2817' : '#572f1a'); if (k) P(c, x, y + 1, '#572f1a');
    }
  });
  def('carrot', (c, rand) => {
    const body = cv();
    capsule(body, 2.1, 14.2, 7.9, 6.9, 0.7, 3.3, '#ff8e09');
    const bm = maskOf(body), be = edgeOf(bm);
    blob(body, bm, '#ac3900', '#752802', ['#ac3900', '#d36a0d', '#ff8e09', '#ffa73f', '#ffc177'], { rand, base: 2.3, grad: 0.8, lit: 1.3, dark: 1.2, dark2: 0.7 });
    // horizontal growth rings
    for (let i = 0; i < 256; i++) { const x = i & 15, y = i >> 4; if (body[i] !== -1 && !be[i] && (y === 9 || y === 12) && x > 2) body[i] = K('#d36a0d'); }
    // bushy leaves on top and down the right side
    const lv = cv();
    capsule(lv, 8.5, 5.5, 12.5, 1.3, 1.3, 1.8, '#1f9a1c'); capsule(lv, 8, 5, 7, 1, 1, 1.4, '#1f9a1c'); capsule(lv, 9, 6, 14.3, 3.8, 1, 1.4, '#1f9a1c');
    capsule(lv, 10, 6.5, 14, 8.6, 1, 1.3, '#1f9a1c'); capsule(lv, 7, 4.5, 4.6, 3.6, 0.8, 0.9, '#1f9a1c');
    const lm = maskOf(lv);
    blob(lv, lm, '#036703', '#005000', ['#036703', '#1f9a1c', '#33be30'], { rand, base: 1.2, grad: 0.7, lit: 1, dark: 1, noise: 1, cell: 1.4 });
    over(c, lv); over(c, body);
  });
  function potatoShape(cx, cy, rx, ry, ang) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    return mask((x, y) => { const X = x + 0.5 - cx, Y = y + 0.5 - cy; const a = X * ca + Y * sa, b = -X * sa + Y * ca; return (a * a) / (rx * rx) + (b * b) / (ry * ry) <= 1; });
  }
  def('potato', (c, rand) => {
    blob(c, potatoShape(8.2, 8.6, 7, 4.6, -0.32), '#86693e', '#6d3701', ['#9a5500', '#9d772e', '#af8444', '#c8973a', '#d9aa51', '#e9ba62', '#f8d086'], { rand, base: 4, grad: 1, lit: 0.3, dark: 1.8, dark2: 0.9, noise: 0.8, cell: 2 });
    pts(c, [4, 8, 5, 8, 5, 9], '#f8d086'); pts(c, [3, 8, 6, 7, 4, 9, 6, 9, 5, 10], '#e9ba62');
    pts(c, [9, 7, 11, 10], '#9d772e');
  });
  def('baked_potato', (c, rand) => {
    blob(c, potatoShape(8.3, 8.7, 7.4, 5.2, -0.3), '#9a5500', '#6d3701', ['#86693e', '#9d772e', '#b59840', '#c8973a', '#d5ac37', '#d9aa51', '#f0cd5a'], { rand, base: 3.6, grad: 1.8, lit: 0.8, dark: 2, dark2: 0.9, noise: 1.3, cell: 1.8 });
  });
  // --- meats: shared geometry, raw/cooked palettes
  // rounded slab lying along the anti-diagonal (superellipse), used by porkchop / beef
  function slabMask(cx, cy, A, B, p) {
    return mask((x, y) => { const X = x + 0.5 - cx, Y = y + 0.5 - cy, a = (X - Y) / Math.SQRT2, b = (X + Y) / Math.SQRT2; return Math.pow(Math.abs(a / A), p) + Math.pow(Math.abs(b / B), p) <= 1; });
  }
  function slab(c, rand, pal, fat) {   // porkchop: rounded chop with a small nub at the top
    const m = mUnion(slabMask(8, 8.6, 7.8, 5.2, 3), mask((x, y) => x >= 9 && x <= 12 && y >= 1 && y <= 2 && !(x === 10 && y === 1)));
    const inner = blob(c, m, pal.olT, pal.olB, pal.tones, { rand, base: pal.base, grad: 1.2, lit: 0.8, dark: 1.2, noise: 1.1, cell: 2 });
    if (fat) {   // fat streak running along the lower half of the slab (x+y = 18..19), brightest towards the lower-left
      for (let i = 0; i < 256; i++) if (inner[i]) {
        const x = i & 15, y = i >> 4, s = x + y, t = x - y;
        if ((s === 18 || s === 19) && t <= 7 && t >= -7 && !(s === 19 && t > 3)) c[i] = K(t < -1 && s === 18 ? pal.fat1 : (rand() < 0.25 ? pal.fat1 : pal.fat2));
      }
    }
  }
  def('porkchop', (c, rand) => slab(c, rand, { olT: '#a75353', olB: '#512626', tones: ['#853e3e', '#a75353', '#ef7070', '#ff7777', '#ff8c8c', '#ffadad'], base: 3, fat1: '#ffc6c6', fat2: '#ffadad' }, true));
  def('cooked_porkchop', (c, rand) => slab(c, rand, { olT: '#8c6932', olB: '#5f4f27', tones: ['#81602b', '#8c6932', '#997942', '#bca474', '#c5ad77', '#cfba81', '#d3c088', '#dacba4'], base: 3.6, fat1: '#e2d3ac', fat2: '#dacba4' }, true));
  function steak(c, rand, pal) {
    const m = slabMask(8.4, 8.5, 7.6, 5.1, 2.6);
    blob(c, m, pal.olT, pal.olB, pal.tones, { rand, base: pal.base, grad: 1.3, lit: 0.9, dark: 1.3, dark2: 0.5, noise: pal.noise || 1.3, cell: 1.6, speck: 0.08 });
  }
  def('beef', (c, rand) => { steak(c, rand, { olT: '#7b1713', olB: '#470a06', tones: ['#7b1713', '#ad1d17', '#e03e35', '#e2534a', '#e2625a', '#e27269', '#ea8873'], base: 3 }); });
  def('cooked_beef', (c, rand) => { steak(c, rand, { olT: '#4e2719', olB: '#2a160d', tones: ['#3f2116', '#4e2719', '#522f1f', '#673728', '#713f2d', '#7c4835', '#8e523c', '#985c43'], base: 4, noise: 2 }); });
  function chicken(c, rand, pal) {
    const m = mask((x, y) => { const X = x + 0.5, Y = y + 0.5; const body = (X - 8.6) * (X - 8.6) / 38 + (Y - 7.6) * (Y - 7.6) / 44 <= 1; return body || inPoly([2, 9.5, 5.5, 10, 5.5, 14, 3.6, 15, 2, 14], X, Y); });
    const inner = blob(c, m, pal.olT, pal.olB, pal.tones, { rand, base: pal.base, grad: 1.6, lit: 0.6, dark: 1.3, noise: 1.1, cell: 2 });
    // glossy breast highlight (upper centre-right) and the thigh crease
    for (let i = 0; i < 256; i++) if (inner[i]) {
      const x = i & 15, y = i >> 4, d = Math.hypot(x + 0.5 - 9, y + 0.5 - 6);
      if (d < 1.9) c[i] = K(pal.tones[6]); else if (d < 2.9 && rand() < 0.7) c[i] = K(pal.tones[5]);
    }
    pts(c, [5, 8, 8, 8, 9, 8, 6, 9], pal.tones[1]); pts(c, [7, 9, 8, 10], pal.tones[3]);
    pts(c, [2, 11, 2, 12, 3, 12], pal.bone1); pts(c, [2, 13, 3, 13], pal.bone2);
  }
  def('chicken', (c, rand) => chicken(c, rand, { olT: '#b47b65', olB: '#865245', tones: ['#865245', '#b47b65', '#c19280', '#dfa996', '#efbcac', '#f2c9bd', '#ffe7dc'], base: 3, bone1: '#eecaac', bone2: '#deaa83' }));
  def('cooked_chicken', (c, rand) => chicken(c, rand, { olT: '#8b4420', olB: '#5a2c10', tones: ['#5a2c10', '#8b4420', '#ac5d31', '#cd7d4a', '#d28e62', '#de9d7b', '#e6bea4'], base: 3, bone1: '#eecaac', bone2: '#deaa83' }));
  function mutton(c, rand, pal) {
    const m = mask((x, y) => { const X = x + 0.5, Y = y + 0.5; return inPoly([11, 0.3, 13, 0.5, 15, 2, 14.6, 7, 14, 11, 12.4, 13.6, 10, 15.2, 3, 15.4, 1.2, 13, 1.2, 10.2, 3.6, 7.2, 6.6, 6.2, 9.4, 2.4], X, Y); });
    const inner = blob(c, m, pal.olT, pal.olB, pal.tones, { rand, base: pal.base, grad: 1.2, lit: 2.2, dark: 1.3, noise: 1.2, cell: 2 });
    const { U } = dist4(inner);
    for (let i = 0; i < 256; i++) if (inner[i] && (i >> 4) <= 2 && U[i] <= 2) c[i] = K(pal.top);
  }
  def('mutton', (c, rand) => mutton(c, rand, { olT: '#96211b', olB: '#470a06', tones: ['#96211b', '#ad332e', '#bc2922', '#d12e26', '#dd3830', '#e2625a', '#e27269', '#e88a82'], base: 3.6, top: '#e88a82' }));
  def('cooked_mutton', (c, rand) => mutton(c, rand, { olT: '#6b3a2a', olB: '#2a160d', tones: ['#522f1f', '#6b3a2a', '#7c402f', '#82483a', '#884f40', '#9d6147', '#9c6854', '#a3705a'], base: 3.8, top: '#a3705a' }));
  def('rotten_flesh', (c, rand) => {
    const m = mask((x, y) => { const X = x + 0.5, Y = y + 0.5; return inPoly([8, 1, 13, 1, 12.5, 3.6, 16, 4, 16, 6.2, 14, 7.2, 14.4, 9.8, 12.6, 12, 9.6, 13, 7.4, 14.6, 4, 15, 1.6, 13, 1.6, 10, 3.6, 7.4, 6.6, 5.6, 6.2, 3.4], X, Y); });
    blob(c, m, '#522c10', '#28140a', ['#622c10', '#834418', '#8b3418', '#b44420', '#c56541', '#c5815a'], { rand, base: 2.8, grad: 1, lit: 0.8, dark: 1.2, noise: 1.8, cell: 1.6, speck: 0.1 });
    for (let i = 0; i < 256; i++) if (c[i] !== -1 && rand() < 0.07) { const x = i & 15, y = i >> 4; if (on(c, x + 1, y) && on(c, x - 1, y) && on(c, x, y + 1) && on(c, x, y - 1)) c[i] = K(rand() < 0.5 ? '#6a5d18' : '#6f4d1b'); }
  });
  def('spider_eye', (c) => {
    const s = cv();
    ell(s, 7.6, 7.4, 3.2, 3.2, '#7b0d27');
    const sm = maskOf(s);
    blob(s, sm, '#550222', '#2a0010', ['#550222', '#65062b', '#7b0d27', '#9d1e2d'], { base: 2, grad: 1, lit: 1, dark: 1 });
    pts(s, [6, 6], '#e0c9cc'); pts(s, [6, 7], '#e0aeb4'); pts(s, [7, 7, 5, 6], '#c45f6b');
    over(c, s);
    // optic nerve tail hanging from the lower-right of the ball
    pts(c, [10, 10, 10, 11, 9, 12, 9, 13], '#65062b'); P(c, 10, 11, '#9d1e2d');
    pts(c, [11, 9, 11, 10, 11, 11, 10, 12, 10, 13, 9, 14, 8, 13, 8, 12, 9, 11], '#2a0010');
  });

  // =================================================================== MISC
  // bucket: front view, rim ellipse on top, vertical sheen stripes; `liq` paints the opening
  function bucket(c, liq) {
    // outline
    hl(c, 5, 10, 1, '#353535'); pts(c, [3, 2, 4, 2, 11, 2, 12, 2], '#353535'); vl(c, 2, 3, 10, '#353535'); vl(c, 13, 3, 10, '#353535');
    pts(c, [3, 5, 4, 5, 11, 5, 12, 5], '#353535'); hl(c, 5, 10, 6, '#353535'); vl(c, 3, 11, 12, '#353535'); vl(c, 12, 11, 12, '#353535');
    pts(c, [4, 13, 11, 13], '#353535'); hl(c, 5, 10, 14, '#353535');
    // back rim + inside
    pts(c, [5, 2], '#727272'); pts(c, [6, 2, 7, 2, 8, 2], '#969696'); pts(c, [9, 2, 10, 2], '#a8a8a8');
    pts(c, [3, 3, 4, 3, 8, 3, 9, 3, 10, 3, 12, 3], '#727272'); pts(c, [5, 3, 6, 3, 7, 3], '#5f5f5f'); P(c, 11, 3, '#969696');
    pts(c, [3, 4], '#727272'); pts(c, [4, 4, 5, 4, 6, 4], '#545454'); P(c, 7, 4, '#5f5f5f'); pts(c, [8, 4, 9, 4, 10, 4, 11, 4], '#727272'); P(c, 12, 4, '#5f5f5f');
    pts(c, [5, 5, 6, 5], '#545454'); pts(c, [7, 5, 8, 5, 9, 5], '#5f5f5f'); pts(c, [10, 5], '#727272');
    // body
    for (let y = 6; y <= 13; y++) {
      const x0 = y <= 10 ? 3 : y <= 12 ? 4 : 5, x1 = y <= 10 ? 12 : y <= 12 ? 11 : 10;
      for (let x = x0; x <= x1; x++) {
        if (y === 6 && x >= 5 && x <= 10) continue;
        let k = '#a8a8a8';
        if (x <= 4) k = (y >= 9 && x === 3) ? (y === 9 ? '#a8a8a8' : '#727272') : (y === 6 && x === 4 ? '#a8a8a8' : '#d8d8d8');
        else if (x <= 6) k = (x === 5 && y >= 8 && y <= 10) ? '#ffffff' : '#d8d8d8';
        else if (x <= 8) k = '#a8a8a8';
        else if (x === 9) k = '#969696';
        else if (x <= 11) k = '#727272';
        else k = (y === 8 || y === 9) ? '#a8a8a8' : '#969696';
        if (y >= 12 && x === x0) k = '#a8a8a8';
        if (y === 13 && x === x1) k = '#969696';
        P(c, x, y, k);
      }
    }
    if (liq) liq(c);
  }
  def('bucket', (c) => bucket(c));
  def('water_bucket', (c) => bucket(c, (c) => {
    pts(c, [5, 2, 6, 2], '#787878'); hl(c, 7, 10, 2, '#989898'); pts(c, [3, 3, 12, 3], '#787878');
    pts(c, [4, 3, 5, 3, 9, 3, 10, 3, 11, 3, 3, 4, 12, 4, 5, 5, 10, 5], '#234fcc'); pts(c, [6, 3, 4, 4, 5, 4, 6, 4, 7, 4, 9, 4, 11, 4, 7, 5, 8, 5], '#446fe9'); pts(c, [7, 3, 8, 3, 8, 4, 10, 4, 6, 5, 9, 5], '#345fda');
  }));
  def('lava_bucket', (c) => bucket(c, (c) => {
    P(c, 5, 2, '#e38c3f'); hl(c, 6, 8, 2, '#b68c7b'); pts(c, [9, 2, 10, 2], '#cc4628');
    pts(c, [3, 3, 12, 3], '#b68c7b'); pts(c, [4, 3, 11, 3, 3, 4, 12, 4, 5, 5, 8, 5, 11, 5, 9, 6], '#cc4628');
    pts(c, [5, 3, 6, 3, 9, 3, 5, 4, 7, 4, 8, 4, 10, 4, 7, 5, 9, 5, 10, 5], '#e4d25c'); pts(c, [7, 3, 8, 3, 10, 3, 4, 4, 6, 4, 9, 4, 11, 4, 6, 5, 10, 6], '#e38c3f');
    pts(c, [4, 5, 5, 6, 6, 6, 7, 6, 8, 6], '#7f3e2c'); pts(c, [10, 7, 10, 9], '#cc4628'); P(c, 10, 8, '#e38c3f');
  }));
  def('milk_bucket', (c) => bucket(c, (c) => {
    pts(c, [5, 2, 6, 2], '#787878'); hl(c, 7, 10, 2, '#989898'); pts(c, [3, 3, 12, 3], '#787878');
    pts(c, [4, 3, 11, 3, 3, 4, 12, 4, 5, 5, 10, 5], '#acccd5'); pts(c, [5, 3, 9, 3, 10, 3, 6, 5, 7, 5], '#ddf3f5');
    hl(c, 6, 8, 3, '#ffffff'); hl(c, 4, 11, 4, '#ffffff'); pts(c, [8, 5, 9, 5], '#ffffff');
  }));
  def('flint_and_steel', (c, rand) => {
    // steel striker: "C" shaped ring on the upper-left, opening to the right
    const s = cv();
    region(s, (x, y) => {
      const X = x + 0.5, Y = y + 0.5, o = ((X - 5) / 2.7) ** 2 + ((Y - 5.6) / 3.9) ** 2, i = ((X - 5.4) / 1.25) ** 2 + ((Y - 5.6) / 2.2) ** 2;
      return o <= 1 && i > 1 && !(X > 5.9 && Y > 4 && Y < 7.6);
    }, (x, y) => x + y <= 7 ? '#b9b9b9' : x + y <= 10 ? '#9e9e9e' : '#717171');
    over(c, s);
    outlineInto(c, s, (x, y, u, d, l, r) => (d || r) && !(u || l) ? '#474747' : '#323232');
    // flint shard on the lower-right
    const f = mask((x, y) => inPoly([11, 7, 12.6, 8.2, 14.8, 12.6, 13.2, 15, 9.6, 16, 7.6, 13.6, 8.2, 10.6], x + 0.5, y + 0.5));
    const fc = cv();
    blob(fc, f, '#161616', '#070707', ['#282828', '#323232', '#333333', '#474747', '#565656'], { rand, base: 1.6, grad: 1.4, lit: 1, dark: 1, noise: 0.9, cell: 1.7 });
    pts(fc, [11, 10, 10, 12], '#717171');
    over(c, fc);
  });
  def('shears', (c) => {
    // two parallel blades pointing up-right (x+y = 12..13 and 16..17), red-brown handle ring at the lower-left
    const b = cv();
    region(b, (x, y) => { const s = x + y, t = x - y; return ((s >= 11 && s <= 13 && t >= 0 && t <= 10) || (s >= 15 && s <= 17 && t >= 2 && t <= 11)) && !(s !== 12 && t === 10 && s < 14) && !(s !== 16 && t === 11); },
      (x, y) => { const s = x + y; return (s === 11 || s === 15) ? '#d5d5d5' : (s === 12 || s === 16) ? '#d5d5d5' : '#a8a8a8'; });
    for (let i = 0; i < 256; i++) if (b[i] !== -1) { const x = i & 15, y = i >> 4; if ((x + y === 11 || x + y === 15) && (x - y) % 3 === 0) b[i] = K('#a8a8a8'); }
    over(c, b);
    outlineInto(c, b, (x, y, u, d, l, r) => (d || r) && !(u || l) ? '#707070' : '#424242');
    const h = cv(), hole = mask((x, y) => ((x + 0.5 - 5.7) / 1.9) ** 2 + ((y + 0.5 - 9.4) / 1.6) ** 2 <= 1);
    region(h, (x, y) => { const X = x + 0.5, Y = y + 0.5, o = ((X - 5.6) / 3.9) ** 2 + ((Y - 9.3) / 3.5) ** 2; return o <= 1 && !hole[y * 16 + x]; },
      (x, y) => { const k = x + y; return k <= 11 ? '#a64f3f' : k <= 15 ? '#8b4336' : '#6f352b'; });
    over(c, h);
    outlineInto(c, h, (x, y, u, d, l, r) => (d || r) && !(u || l) ? '#6f352b' : '#5c2d1f', hole);
    P(c, 8, 7, '#424242');
  });
  def('bow', (c) => {
    // string: straight line x + y = 17 between the tips
    for (let x = 4; x <= 13; x++) P(c, x, 17 - x, (x === 4 || x === 13) ? '#6b6b6b' : '#444444');
    // limb: 3px arc from the top-right tip round the upper-left to the bottom-left tip
    const arc = [];
    for (let a = 0; a <= 64; a++) { const t = a / 64 * Math.PI / 2; arc.push([Math.round(15.2 - 13.6 * Math.sin(t) - 0.2), Math.round(1.8 + 13.4 * (1 - Math.cos(t)))]); }
    const limb = cv();
    for (const [x, y] of arc) P(limb, x, y, '#896727');
    const lm = maskOf(limb);
    for (let i = 0; i < 256; i++) if (lm[i]) {
      const x = i & 15, y = i >> 4;
      if (!mAt(lm, x - 1, y - 1) && !mAt(lm, x, y - 1) && x + y < 16) P(limb, x, y - 1, '#493615');
    }
    for (let i = 0; i < 256; i++) if (lm[i]) { const x = i & 15, y = i >> 4; if (!mAt(lm, x - 1, y) && x + y < 16 && y > 3) P(limb, x - 1, y, '#493615'); }
    for (let i = 0; i < 256; i++) if (lm[i]) { const x = i & 15, y = i >> 4; if (((x + y) & 1)) limb[i] = K('#684e1e'); if (!mAt(lm, x + 1, y) && !on(limb, x + 1, y) && x + y >= 10) P(limb, x + 1, y, '#281e0b'); if (!mAt(lm, x, y + 1) && !on(limb, x, y + 1) && x + y >= 10) P(limb, x, y + 1, '#281e0b'); }
    over(c, limb);
    pts(c, [6, 4, 5, 5], '#969696');
  });
  def('arrow', (c) => {
    // shaft 2px diagonal, stone head top-right, white fletching bottom-left
    for (let y = 4; y <= 10; y++) { P(c, 15 - y, y, '#896727'); P(c, 16 - y, y, '#281e0b'); }
    pts(c, [11, 3, 12, 3, 12, 4, 13, 2], '#d8d8d8'); P(c, 12, 2, '#969696'); P(c, 13, 3, '#969696'); P(c, 13, 2, '#ffffff');
    pts(c, [14, 2, 14, 3, 13, 4, 10, 4, 12, 5, 13, 5], '#444444'); pts(c, [10, 3, 11, 2], '#969696'); pts(c, [12, 6], '#3f3f3f');
    pts(c, [3, 11, 2, 12, 4, 12, 3, 13], '#e0e0e0'); pts(c, [4, 11, 3, 12], '#c6c6c6'); P(c, 5, 11, '#281e0b');
    pts(c, [2, 13, 4, 13, 3, 14, 5, 12], '#3f3f3f'); P(c, 2, 11, '#ffffff');
  });
  def('oak_door', (c) => {
    rect(c, 4, 2, 9, 13, '#9f844d');
    vl(c, 3, 2, 15, '#695433'); hl(c, 4, 12, 15, '#695433');
    // four windows (transparent) in the upper half
    for (const [wx, wy] of [[5, 3], [9, 3], [5, 6], [9, 6]]) rect(c, wx, wy, 3, 2, -1);
    // two recessed panels in the lower half
    for (const [px, py] of [[5, 9], [9, 9], [5, 12], [9, 12]]) { hl(c, px, px + 2, py, '#7e6237'); P(c, px, py + 1, '#7e6237'); pts(c, [px + 1, py + 1, px + 2, py + 1], '#967441'); }
    P(c, 10, 8, '#808b95'); P(c, 11, 8, '#6b6f7a');   // iron latch on the middle rail
  });
  def('red_bed', (c) => {
    // isometric bed (like the 3D inventory model): u = x + 2y along the long sides, v = x - y along the short sides.
    // top face (pillow at the far/right end, red blanket), front side (blanket overhang + oak frame), foot end, legs
    region(c, (x, y) => { const u = x + 2 * y, v = x - y; return u >= 14 && u <= 29 && v >= -7 && v <= 9; }, (x, y) => {
      const u = x + 2 * y, v = x - y;
      if (v >= -3 && u <= 21) {                                         // top face
        if (v >= 5) return u === 14 || v === 9 ? '#f9fffe' : (u >= 20 ? '#cfd5d6' : '#e9ecec');   // pillow
        if (v === 4) return '#8e2721';                                   // blanket hem
        return u <= 15 ? '#c63b33' : '#b02e26';
      }
      if (v >= -3) {                                                     // long front side
        if (u <= 24) return v >= 5 ? '#cfd5d6' : '#8e2721';              // blanket / sheet overhang
        return u <= 26 ? '#9f844d' : '#7e6237';                           // oak frame
      }
      if (u <= 21 + 0) return v >= -5 ? '#a12722' : '#8e2721';           // foot end: blanket
      return u <= 25 ? '#9f844d' : '#7e6237';                             // foot end: frame
    });
    // keep the silhouette tidy: clear the corners that stick out of the prism
    region(c, (x, y) => { const u = x + 2 * y, v = x - y; return on(c, x, y) && ((v < -3 && u < 17) || (u > 21 && u - 21 > (v + 3 < 0 ? 8 : 8)) || (v < -3 && u - (v + 3) * -2 > 29)); }, -1);
    outlineInto(c, c.slice(), (x, y) => { const u = x + 2 * y; return u >= 28 ? '#3d2e1a' : '#5a1512'; });
    // legs under the corners
    pts(c, [14, 8, 14, 9], '#695433'); pts(c, [3, 12, 3, 13], '#695433'); pts(c, [15, 9, 4, 13], '#3d2e1a');
  });
  def('spawn_egg', (c) => {
    const m = mask((x, y) => { const dx = x + 0.5 - 7.5, dy = y + 0.5 - 8.6; const rx = dy < 0 ? 4.6 + dy * 0.16 : 5; return (dx * dx) / (rx * rx) + (dy * dy) / (5.9 * 5.9) <= 1; });
    blob(c, m, '#6e6e6e', '#565656', ['#b4b4b4', '#cfcfcf', '#e8e8e8', '#f6f6f6', '#ffffff'], { base: 2.6, grad: 0.9, lit: 1, dark: 1.6, dark2: 0.7 });
  });
  def('spawn_egg_overlay', (c) => {
    for (const [x, y, w, h] of [[6, 4, 2, 2], [10, 6, 1, 2], [4, 8, 2, 2], [8, 9, 2, 3], [5, 12, 2, 1], [11, 11, 1, 1]]) {
      rect(c, x, y, w, h, '#ffffff');
      if (w > 1 && h > 1) P(c, x + w - 1, y + h - 1, '#d0d0d0'); else if (h > 1) P(c, x, y + h - 1, '#d0d0d0');
    }
  });

  // ---- tools
  for (const m of ['wooden', 'stone', 'iron', 'golden', 'diamond']) {
    def(m + '_sword', (c) => sword(c, SWORD_PAL[m]));
    def(m + '_pickaxe', (c) => pickaxe(c, TOOL_PAL[m]));
    def(m + '_axe', (c) => axe(c, TOOL_PAL[m]));
    def(m + '_shovel', (c) => shovel(c, TOOL_PAL[m]));
    def(m + '_hoe', (c) => hoe(c, TOOL_PAL[m]));
  }
  // ---- armor
  for (const m of ['leather', 'iron', 'golden', 'diamond']) {
    def(m + '_helmet', (c) => helmet(c, ARMOR_PAL[m]));
    def(m + '_chestplate', (c) => chestplate(c, ARMOR_PAL[m]));
    def(m + '_leggings', (c) => leggings(c, ARMOR_PAL[m]));
    def(m + '_boots', (c) => boots(c, ARMOR_PAL[m]));
  }

  // names in the order of the spec (materials, food & seeds, misc, tools, armor)
  const ORDER = ('stick coal charcoal iron_ingot gold_ingot diamond emerald redstone lapis_lazuli flint clay_ball brick paper book string feather leather bone bone_meal ' +
    'gunpowder sugar egg snowball glowstone_dust wheat_seeds wheat bread apple golden_apple melon_slice melon_seeds pumpkin_seeds cookie carrot potato baked_potato ' +
    'porkchop cooked_porkchop beef cooked_beef chicken cooked_chicken mutton cooked_mutton rotten_flesh spider_eye bucket water_bucket lava_bucket milk_bucket ' +
    'flint_and_steel shears bow arrow oak_door red_bed spawn_egg spawn_egg_overlay').split(' ');
  const rank = (n) => { const i = ORDER.indexOf(n); return i < 0 ? ORDER.length + NAMES.indexOf(n) : i; };
  NAMES.sort((a, b) => rank(a) - rank(b));

  G.TexItems = { size: 16, names: NAMES, tiles: TILES };
})(typeof window !== 'undefined' ? window : globalThis);
