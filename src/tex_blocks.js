/* =============================================================================
 * tex_blocks.js  -  Module A: procedural, vanilla-1.20-style block textures.
 * Publishes exactly one global:  TexBlocks = { size, names, tiles, animated }
 *   tiles[name]    : Uint8ClampedArray(16*16*4)  RGBA, row-major, top-left origin, straight alpha
 *   animated[name] : { frameTime (ticks), frames:[Uint8ClampedArray...] }, tiles[name] === frames[0]
 * Every painter is procedural: seeded clustered noise + deliberately placed structure,
 * quantised to the real vanilla palettes (rank / histogram matching). Deterministic.
 * No DOM access, plain ES2020, runs under Node and in the browser.
 * ===========================================================================*/
(function (G) {
  'use strict';

  var S = 16, N = 256;

  /* ------------------------------------------------------------------ PRNG */
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function R(name) { return mulberry32(hashStr(name)); }
  function ri(r, a, b) { return a + Math.floor(r() * (b - a + 1)); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  /* --------------------------------------------------------------- colours */
  var HC = Object.create(null);
  function C(h) {
    var c = HC[h];
    if (c) return c;
    var s = h.charAt(0) === '#' ? h.slice(1) : h;
    var v = parseInt(s.slice(0, 6), 16);
    c = [(v >> 16) & 255, (v >> 8) & 255, v & 255, s.length > 6 ? parseInt(s.slice(6, 8), 16) : 255];
    HC[h] = c;
    return c;
  }
  // "rrggbb:count rrggbb:count ..."  (ordered low -> high field value)
  function pal(str) {
    return str.trim().split(/\s+/).map(function (tok) {
      var p = tok.split(':');
      return [C(p[0]), p.length > 1 ? +p[1] : 1];
    });
  }
  function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
  function byLum(p) { return p.slice().sort(function (a, b) { return lum(a[0]) - lum(b[0]); }); }
  function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 255]; }
  function gray(v) { v = clamp(Math.round(v), 0, 255); return [v, v, v, 255]; }

  /* ------------------------------------------------------------ tile basics */
  function T() { return new Uint8ClampedArray(N * 4); }
  function idx(x, y) { return (((y & 15) << 4) | (x & 15)) << 2; }
  function px(t, x, y, c, a) {
    var i = idx(x, y);
    t[i] = c[0]; t[i + 1] = c[1]; t[i + 2] = c[2];
    t[i + 3] = a === undefined ? (c[3] === undefined ? 255 : c[3]) : a;
  }
  function pxIn(t, x, y, c, a) { if (x >= 0 && y >= 0 && x < 16 && y < 16) px(t, x, y, c, a); }
  function getc(t, x, y) { var i = idx(x, y); return [t[i], t[i + 1], t[i + 2], t[i + 3]]; }
  function fillT(t, c) { for (var i = 0; i < N; i++) px(t, i & 15, i >> 4, c); }
  function hline(t, x0, x1, y, c) { for (var x = x0; x <= x1; x++) pxIn(t, x, y, c); }
  function vline(t, x, y0, y1, c) { for (var y = y0; y <= y1; y++) pxIn(t, x, y, c); }
  function line(t, x0, y0, x1, y1, c) {
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, err = dx + dy, out = [];
    for (;;) {
      pxIn(t, x0, y0, c); out.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return out;
  }
  function clone(t) { return new Uint8ClampedArray(t); }
  // Transparent pixels get the averaged RGB of nearby opaque pixels (alpha stays 0) -> no dark mip fringes.
  function bleed(t) {
    var filled = new Uint8Array(N), any = false, i;
    for (i = 0; i < N; i++) { filled[i] = t[i * 4 + 3] > 0 ? 1 : 0; if (filled[i]) any = true; }
    if (!any) return t;
    for (var pass = 0; pass < 20; pass++) {
      var nf = filled.slice(), changed = false;
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var k = y * 16 + x;
        if (filled[k]) continue;
        var rr = 0, gg = 0, bb = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx > 15 || yy > 15) continue;
          var kk = yy * 16 + xx;
          if (!filled[kk]) continue;
          rr += t[kk * 4]; gg += t[kk * 4 + 1]; bb += t[kk * 4 + 2]; n++;
        }
        if (n) { t[k * 4] = rr / n; t[k * 4 + 1] = gg / n; t[k * 4 + 2] = bb / n; t[k * 4 + 3] = 0; nf[k] = 1; changed = true; }
      }
      filled = nf;
      if (!changed) break;
    }
    return t;
  }

  /* ------------------------------------------------------------------ noise */
  // periodic value noise with nx*ny lattice cells over the 16x16 tile (tileable)
  function vnoise(r, nx, ny) {
    var g = new Float32Array(nx * ny), out = new Float32Array(N), x, y;
    for (var i = 0; i < g.length; i++) g[i] = r();
    for (y = 0; y < 16; y++) {
      var fy = (y + 0.5) * ny / 16 - 0.5, y0 = Math.floor(fy), ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);
      var ya = ((y0 % ny) + ny) % ny, yb = (ya + 1) % ny;
      for (x = 0; x < 16; x++) {
        var fx = (x + 0.5) * nx / 16 - 0.5, x0 = Math.floor(fx), tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        var xa = ((x0 % nx) + nx) % nx, xb = (xa + 1) % nx;
        var a = g[ya * nx + xa] + (g[ya * nx + xb] - g[ya * nx + xa]) * tx;
        var b = g[yb * nx + xa] + (g[yb * nx + xb] - g[yb * nx + xa]) * tx;
        out[y * 16 + x] = a + (b - a) * ty;
      }
    }
    return out;
  }
  // octs: [[nx, ny, weight], ...]; white: amplitude of per-pixel noise
  function field(r, octs, white) {
    var f = new Float32Array(N), i, k;
    for (k = 0; k < octs.length; k++) {
      var o = octs[k], n = vnoise(r, o[0], o[1]);
      for (i = 0; i < N; i++) f[i] += n[i] * o[2];
    }
    if (white) for (i = 0; i < N; i++) f[i] += (r() - 0.5) * white;
    return f;
  }
  function normz(f) {
    var m = 0, s = 0, i, n = f.length;
    for (i = 0; i < n; i++) m += f[i];
    m /= n;
    for (i = 0; i < n; i++) s += (f[i] - m) * (f[i] - m);
    s = Math.sqrt(s / n) || 1;
    for (i = 0; i < n; i++) f[i] = (f[i] - m) / s;
    return f;
  }
  function fv(f, x, y) { return f[((y & 15) << 4) | (x & 15)]; }
  // periodic 3D lattice for animations (x,y in lattice units, t in lattice units)
  function lattice3(r, nx, ny, nt) {
    var g = new Float32Array(nx * ny * nt);
    for (var i = 0; i < g.length; i++) g[i] = r();
    return { g: g, nx: nx, ny: ny, nt: nt };
  }
  function sample3(L, x, y, t) {
    var nx = L.nx, ny = L.ny, nt = L.nt, g = L.g;
    var x0 = Math.floor(x), y0 = Math.floor(y), t0 = Math.floor(t);
    var fx = x - x0, fy = y - y0, ft = t - t0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); ft = ft * ft * (3 - 2 * ft);
    var xa = ((x0 % nx) + nx) % nx, xb = xa + 1 === nx ? 0 : xa + 1, ya = ((y0 % ny) + ny) % ny, yb = ya + 1 === ny ? 0 : ya + 1;
    var ta = ((t0 % nt) + nt) % nt, tb = ta + 1 === nt ? 0 : ta + 1;
    var pa = ta * ny, pb = tb * ny;
    var r0 = (pa + ya) * nx, r1 = (pa + yb) * nx, r2 = (pb + ya) * nx, r3 = (pb + yb) * nx;
    var a = g[r0 + xa] + (g[r0 + xb] - g[r0 + xa]) * fx, b = g[r1 + xa] + (g[r1 + xb] - g[r1 + xa]) * fx;
    var c = g[r2 + xa] + (g[r2 + xb] - g[r2 + xa]) * fx, d = g[r3 + xa] + (g[r3 + xb] - g[r3 + xa]) * fx;
    var p = a + (b - a) * fy, q = c + (d - c) * fy;
    return p + (q - p) * ft;
  }

  /* ------------------------------------------------ rank (histogram) quantise */
  function rankIdx(f, counts, mask) {
    var list = [], i;
    for (i = 0; i < N; i++) if (!mask || mask[i]) list.push(i);
    list.sort(function (a, b) { return f[a] - f[b] || a - b; });
    var total = 0;
    for (i = 0; i < counts.length; i++) total += counts[i];
    var out = new Int16Array(N).fill(-1), acc = 0, k = 0;
    for (var p = 0; p < counts.length; p++) {
      acc += counts[p];
      var end = Math.round(acc / total * list.length);
      for (; k < end; k++) out[list[k]] = p;
    }
    return out;
  }
  function rankPaint(t, f, P, mask, alphaV) {
    var ix = rankIdx(f, P.map(function (e) { return e[1]; }), mask);
    for (var i = 0; i < N; i++) if (ix[i] >= 0) px(t, i & 15, i >> 4, P[ix[i]][0], alphaV);
    return ix;
  }
  // rank a list of [x,y] cells by score into palette P
  function rankCells(t, cells, score, P) {
    var order = cells.map(function (c, i) { return i; });
    order.sort(function (a, b) { return score[a] - score[b] || a - b; });
    var total = 0, i;
    for (i = 0; i < P.length; i++) total += P[i][1];
    var acc = 0, k = 0;
    for (var p = 0; p < P.length; p++) {
      acc += P[p][1];
      var end = Math.round(acc / total * cells.length);
      for (; k < end; k++) px(t, cells[order[k]][0], cells[order[k]][1], P[p][0]);
    }
  }

  /* ------------------------------------------------ point sets / voronoi */
  function wrapD(a, b) {   // toroidal distance on a 16-period axis (inputs within a few periods)
    var d = a - b;
    if (d < 0) d = -d;
    while (d >= 16) d -= 16;
    return d > 8 ? 16 - d : d;
  }
  function scatter(r, n, minD, tries) {
    var pts = [], t = 0, lim = tries || 4000;
    while (pts.length < n && t < lim) {
      t++;
      var p = [r() * 16, r() * 16], ok = true;
      for (var i = 0; i < pts.length; i++) {
        var dx = wrapD(p[0], pts[i][0]), dy = wrapD(p[1], pts[i][1]);
        if (dx * dx + dy * dy < minD * minD) { ok = false; break; }
      }
      if (ok) pts.push(p);
    }
    return pts;
  }
  function voronoi(pts, sx, sy) {
    var own = new Int16Array(N), d1 = new Float32Array(N), d2 = new Float32Array(N), d3 = new Float32Array(N);
    sx = sx || 1; sy = sy || 1;
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var b1 = 1e9, b2 = 1e9, b3 = 1e9, o = -1;
      for (var i = 0; i < pts.length; i++) {
        var dx = wrapD(x + 0.5, pts[i][0]) * sx, dy = wrapD(y + 0.5, pts[i][1]) * sy;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < b1) { b3 = b2; b2 = b1; b1 = d; o = i; } else if (d < b2) { b3 = b2; b2 = d; } else if (d < b3) b3 = d;
      }
      var k = y * 16 + x;
      own[k] = o; d1[k] = b1; d2[k] = b2; d3[k] = b3;
    }
    return { own: own, d1: d1, d2: d2, d3: d3, pts: pts };
  }

  /* ------------------------------------------------ sprite helpers */
  // shaded ellipse: cols dark -> light; light comes from the top-left
  function shadedBlob(t, r, cx, cy, rx, ry, cols, jit, bias) {
    var out = [];
    for (var y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
      for (var x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (x < 0 || y < 0 || x > 15 || y > 15) continue;
        var dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy;
        if (jit) d += (r() - 0.5) * jit;
        if (d > 1) continue;
        var l = -(dx + dy) * 0.62 + (1 - d) * 0.35 + (bias || 0) + (jit ? (r() - 0.5) * 0.35 : 0);
        var n = cols.length, ci = Math.floor((l + 0.75) / 1.6 * n);
        ci = clamp(ci, 0, n - 1);
        px(t, x, y, C(cols[ci]));
        out.push([x, y]);
      }
    return out;
  }

  var tiles = {}, animated = {};

  /* =========================================================================
   * TERRAIN
   * =======================================================================*/
  var STONE_P = pal('686868:17 747474:71 7f7f7f:118 8f8f8f:50');
  function paintStone(seed) {
    var r = R(seed), t = T();
    var f0 = field(r, [[4, 8, 1.0], [8, 16, 0.6], [16, 16, 0.25]], 0.3), f = new Float32Array(N);
    // vertical sharpening -> thin horizontal ledges (light streak above a darker one) like vanilla stone
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) f[y * 16 + x] = f0[y * 16 + x] * 1.8 - fv(f0, x, y - 1) * 0.4 - fv(f0, x, y + 1) * 0.4;
    rankPaint(t, f, STONE_P);
    return t;
  }
  function paintNoise(seed, octs, white, P, alphaV) {
    var r = R(seed), t = T();
    rankPaint(t, field(r, octs, white), P, null, alphaV);
    return t;
  }

  function paintDirt() {
    var r = R('dirt'), t = T();
    var f = field(r, [[4, 4, 0.3], [8, 8, 0.9], [16, 16, 0.85]], 0.25);
    rankPaint(t, f, pal('593d29:34 79553a:108 966c4a:68 b9855c:39'));
    var spots = scatter(r, 3, 5.5);
    for (var k = 0; k < spots.length; k++) {
      var x = spots[k][0] | 0, y = spots[k][1] | 0;
      px(t, x, y, C('#878787'));
      if (k === 1) px(t, x, y + 1, C('#6c6c6c')); else px(t, x + 1, y, C('#6c6c6c'));
      if (k === 0) { px(t, x + 1, y + 1, C('#6c6c6c')); px(t, x - 1, y, C('#745844')); }
      if (k === 2) px(t, x, y - 1, C('#878787'));
    }
    return t;
  }

  function grassTopValues(seed) {
    var r = R(seed);
    return normz(field(r, [[4, 4, 0.3], [8, 8, 0.75], [16, 16, 1.0]], 0.35));
  }
  function paintGrassTop() {
    var t = T(), f = grassTopValues('grass_block_top');
    for (var i = 0; i < N; i++) px(t, i & 15, i >> 4, gray(clamp(147 + f[i] * 15.5, 104, 196)));
    return t;
  }
  function fringe(r, base, probs) {
    var d = [];
    for (var x = 0; x < 16; x++) {
      var v = base;
      for (var k = 0; k < probs.length && r() < probs[k]; k++) v++;
      d.push(v);
    }
    return d;
  }
  var GRASS_D = fringe(R('grass_fringe'), 2, [0.5, 0.32, 0.22]);
  function grassGreen(g) { return [0.6 * g + 11, 0.6 * g + 75, 0.6 * g - 31, 255]; }
  function paintGrassSide() {
    var t = clone(tiles.dirt), f = grassTopValues('grass_side_fringe');
    for (var x = 0; x < 16; x++) for (var y = 0; y < GRASS_D[x]; y++) {
      var g = clamp(157 + f[y * 16 + x] * 12 - (y === GRASS_D[x] - 1 && y > 1 ? 9 : 0), 128, 182);
      px(t, x, y, grassGreen(g));
    }
    return t;
  }
  function paintGrassOverlay() {
    var t = T(), f = grassTopValues('grass_side_fringe');
    for (var x = 0; x < 16; x++) for (var y = 0; y < GRASS_D[x]; y++) {
      var g = clamp(157 + f[y * 16 + x] * 12 - (y === GRASS_D[x] - 1 && y > 1 ? 9 : 0), 128, 182);
      px(t, x, y, gray(g));
    }
    return bleed(t);
  }
  var SNOW_D = fringe(R('snow_fringe'), 4, [0.78, 0.55, 0.32]);
  function paintGrassSnow() {
    var t = clone(tiles.dirt), r = R('grass_block_snow');
    var f = field(r, [[8, 8, 1], [16, 16, 0.7]], 0.3), mask = new Uint8Array(N), x, y;
    for (x = 0; x < 16; x++) for (y = 0; y < SNOW_D[x] - 1; y++) mask[y * 16 + x] = 1;
    rankPaint(t, f, pal('d7efef:9 f0fdfd:24 f7fefe:24 ffffff:17'), mask);
    for (x = 0; x < 16; x++) {
      var yb = SNOW_D[x] - 1;
      px(t, x, yb, C(r() < 0.5 ? '#b2d5d5' : '#d7efef'));
      if (r() < 0.3) px(t, x, yb + 1, C('#78554d'));
    }
    return t;
  }

  function paintPodzolTop() {
    var r = R('podzol_top'), t = T();
    var f = field(r, [[4, 4, 0.5], [8, 8, 1], [16, 16, 0.7]], 0.3);
    rankPaint(t, f, pal('4a3018:60 523c18:100 6a4418:70'));
    var i, k;
    for (i = 0; i < 9; i++) { // needles
      var x = ri(r, 0, 15), y = ri(r, 0, 15), dir = pick(r, [[1, 0], [1, 1], [1, -1], [0, 1]]), len = ri(r, 2, 3);
      for (k = 0; k < len; k++) px(t, x + dir[0] * k, y + dir[1] * k, C(k === 0 && r() < 0.6 ? '#ac6520' : '#8b5920'));
    }
    for (i = 0; i < 6; i++) { // olive moss bits
      var mx = ri(r, 0, 15), my = ri(r, 0, 15);
      px(t, mx, my, C('#524c10')); px(t, mx + 1, my, C('#524c10'));
      if (r() < 0.6) px(t, mx, my + 1, C('#524c10'));
    }
    return t;
  }
  var POD_D = fringe(R('podzol_fringe'), 3, [0.72, 0.45, 0.25]);
  function paintPodzolSide() {
    var t = clone(tiles.dirt), r = R('podzol_side'), top = tiles.podzol_top;
    for (var x = 0; x < 16; x++) {
      for (var y = 0; y < POD_D[x]; y++) {
        var c = getc(top, x, y + 5);
        if (y === POD_D[x] - 1) c = C(pick(r, ['#442e1c', '#4e341c', '#4d3e1c', '#694a1f', '#75481f']));
        px(t, x, y, c);
      }
    }
    return t;
  }

  function paintGravel() {
    var r = R('gravel'), t = T();
    var pts = scatter(r, 34, 2.55), V = voronoi(pts);
    var tone = pts.map(function () { return r(); }), warm = pts.map(function () { return r() < 0.4; });
    var f = new Float32Array(N), x, y;
    function same(xx, yy, o) { var k = ((yy & 15) << 4) | (xx & 15); return V.own[k] === o && V.d2[k] - V.d1[k] >= 0.5; }
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var k = y * 16 + x, o = V.own[k], e = V.d2[k] - V.d1[k];
      var h = tone[o] * 0.9 + (r() - 0.5) * 0.35;
      if (e < 0.5) h -= 1.4 - e;
      else {
        if (!same(x, y - 1, o)) h += 0.55;
        if (!same(x - 1, y, o)) h += 0.3;
        if (!same(x, y + 1, o)) h -= 0.5;
        if (!same(x + 1, y, o)) h -= 0.25;
      }
      f[k] = h;
    }
    var lv = rankIdx(f, [13, 49, 136, 50, 8]);
    var NEU = ['#645b5b', '#726b69', '#817f7f', '#979797', '#b0aeae'], WRM = ['#645b5b', '#726b69', '#89817e', '#968e8e', '#b1a2a2'];
    for (var i = 0; i < N; i++) {
      var w = warm[V.own[i]];
      if (lv[i] === 3) w = w && tone[V.own[i]] < 0.55;
      px(t, i & 15, i >> 4, C((w ? WRM : NEU)[lv[i]]));
    }
    return t;
  }

  // sandstone: a broken network of rounded cells (squashed voronoi, lines partly interrupted)
  function strataMask(r, n, keep) {
    var V = voronoi(scatter(r, n, 3.3), 1, 1.35), brk = field(r, [[4, 4, 1], [8, 8, 0.6]], 0.35), m = new Uint8Array(N);
    var list = [];
    for (var k = 0; k < N; k++) if (V.d2[k] - V.d1[k] < 0.8) list.push(k);
    list.sort(function (a, b) { return brk[b] - brk[a] || a - b; });
    for (var i = 0; i < Math.round(list.length * keep); i++) m[list[i]] = 1;
    return m;
  }
  function sandstoneBody(t, r, m, y0, cnt) {
    var f = field(r, [[4, 8, 0.7], [8, 16, 0.6]], 0.35), rest = new Uint8Array(N), x, y, k;
    for (y = y0; y < 16; y++) for (x = 0; x < 16; x++) {
      k = y * 16 + x;
      if (m[k]) px(t, x, y, C('#c6ae71'));
      else if (y < 15 && m[k + 16] && r() < 0.85) px(t, x, y, C('#d1ba8a'));
      else if (y > y0 && m[k - 16]) px(t, x, y, C(r() < 0.22 ? '#edebcb' : '#e7e4bb'));
      else rest[k] = 1;
    }
    rankPaint(t, f, [[C('#d5c496'), cnt[0]], [C('#dad2a3'), cnt[1]], [C('#e3dbb0'), cnt[2]]], rest);
  }
  function paintSandstone() {
    var r = R('sandstone'), t = T(), x;
    for (x = 0; x < 16; x++) {
      px(t, x, 0, C(r() < 0.3 ? '#edebcb' : r() < 0.5 ? '#e3dbb0' : '#e7e4bb'));
      px(t, x, 1, C(r() < 0.72 ? '#c6ae71' : '#d1ba8a'));
    }
    var m = strataMask(r, 13, 0.55);
    for (x = 0; x < 16; x++) m[2 * 16 + x] = 0;      // keep the row under the top band clean
    sandstoneBody(t, r, m, 2, [23, 66, 32]);
    return t;
  }
  function paintSandstoneBottom() {
    var r = R('sandstone_bottom'), t = T();
    sandstoneBody(t, r, strataMask(r, 17, 0.62), 0, [20, 76, 41]);
    return t;
  }

  function paintIce() {
    var r = R('ice'), t = T();
    var f = field(r, [[4, 4, 0.6], [8, 8, 0.6], [16, 16, 0.3]], 0.2);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var u = (x + y) & 15;
      f[y * 16 + x] += (u === 4 ? 0.55 : u === 5 ? 0.3 : u === 12 ? 0.35 : 0) * (0.6 + 0.4 * Math.sin((x - y) * 0.4));
    }
    rankPaint(t, f, pal('86aefe:47 8cb3fe:60 92b9fe:109 a1c3ff:32 bcd4ff:5 c8dcff:3'), null, 190);
    return t;
  }

  function paintObsidian() {
    var r = R('obsidian'), t = T();
    var f0 = field(r, [[4, 8, 0.8], [8, 8, 0.8], [16, 16, 0.5]], 0.25), f = new Float32Array(N);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) f[y * 16 + x] = fv(f0, x + (y >> 1), y); // sheared -> diagonal veins
    rankPaint(t, f, pal('000001:64 06030b:75 100c1c:66 271e3d:32 3b2754:19'));
    return t;
  }

  // cobblestone layout shared by cobblestone + mossy cobblestone (+ furnace stones use their own)
  var COBBLE_V = (function () { var r = R('cobble_layout'); return voronoi(scatter(r, 13, 3.7)); })();
  function cobbleShade(V, r, gapW) {
    var stone = [], sScore = [], gap = [], gScore = [], x, y;
    var tone = V.pts.map(function () { return r(); });
    var gw = field(r, [[4, 4, 1], [8, 8, 0.5]], 0.2), bl = field(r, [[4, 4, 0.7], [8, 8, 1]], 0.3);
    var isGap = new Uint8Array(N), k;
    for (k = 0; k < N; k++) isGap[k] = V.d2[k] - V.d1[k] < gapW * (0.62 + gw[k] * 0.55) ? 1 : 0;
    function isS(xx, yy, o) { var kk = ((yy & 15) << 4) | (xx & 15); return V.own[kk] === o && !isGap[kk]; }
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      k = y * 16 + x;
      var o = V.own[k], e = V.d2[k] - V.d1[k];
      if (isGap[k]) { gap.push([x, y]); gScore.push(e + (V.d3[k] - V.d1[k]) * 0.3 + r() * 0.3); continue; }
      var s = tone[o] * 1.0 + bl[k] * 0.55 + (r() - 0.5) * 0.3;
      var up = isS(x, y - 1, o), lf = isS(x - 1, y, o), dn = isS(x, y + 1, o), rt = isS(x + 1, y, o);
      if (!up) s += 0.95;
      if (!lf) s += 0.6;
      if (!up && !lf) s += 0.35;
      if (!dn) s -= 0.75;
      if (!rt) s -= 0.5;
      s -= (y + 0.5 - V.pts[o][1]) * 0.05;
      stone.push([x, y]); sScore.push(s);
    }
    return { stone: stone, sScore: sScore, gap: gap, gScore: gScore };
  }
  function paintCobble() {
    var t = T(), r = R('cobblestone'), sh = cobbleShade(COBBLE_V, r, 1.0);
    rankCells(t, sh.stone, sh.sScore, pal('6e6d6d:49 888788:75 a6a6a6:37 b5b5b5:23'));
    rankCells(t, sh.gap, sh.gScore, pal('525252:11 616161:61'));
    return t;
  }
  function paintMossyCobble() {
    var t = clone(tiles.cobblestone), r = R('mossy_cobblestone'), V = COBBLE_V;
    var f = field(r, [[2, 2, 0.6], [4, 4, 1.0], [8, 8, 0.5]], 0.3), x, y, k, i;
    for (k = 0; k < N; k++) {
      var e = V.d2[k] - V.d1[k], c = getc(t, k & 15, k >> 4), L = lum(c);
      if (e < 1.0) f[k] += 0.45;           // moss likes the cracks
      if (L > 150) f[k] += 0.25;           // and the stone tops
    }
    var ix = rankIdx(f, [122, 134]);
    var cells = [], score = [];
    var g = field(r, [[8, 8, 1], [16, 16, 0.6]], 0.4);
    for (k = 0; k < N; k++) if (ix[k] === 1) {
      x = k & 15; y = k >> 4;
      cells.push([x, y]);
      var above = ix[((y - 1) & 15) * 16 + x] === 1, below = ix[((y + 1) & 15) * 16 + x] === 1;
      score.push(g[k] + (above ? 0 : 0.5) - (below ? 0 : 0.35));
    }
    rankCells(t, cells, score, pal('525d39:54 5a6d41:21 627941:30 738552:21 7a8f55:8'));
    return t;
  }

  function paintStoneBricks() {
    var r = R('stone_bricks'), t = T();
    var f = field(r, [[4, 8, 0.8], [8, 16, 0.6]], 0.45), body = new Uint8Array(N), x, y;
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var top = y < 7, ly = top ? y : y - 8;
      var joint = top ? x === 15 : x === 7;
      if (y === 7 || y === 15 || joint) { px(t, x, y, C(r() < 0.5 ? '#5a595a' : '#636363')); continue; }
      var lx = top ? x : (x - 8) & 15;       // position along the brick (0 = left end)
      if (ly === 0) px(t, x, y, C('#9c999c'));
      else if (ly === 6 || lx === 14) px(t, x, y, C('#6a6d6a'));
      else if (lx === 0) px(t, x, y, C(r() < 0.7 ? '#8b898b' : '#9c999c'));
      else body[y * 16 + x] = 1;
    }
    rankPaint(t, f, pal('6a6d6a:8 787678:39 7f7f7f:60 8b898b:40'), body);
    return t;
  }

  function paintBricks() {
    var r = R('bricks'), t = T(), x, y;
    var f = field(r, [[4, 16, 0.6], [16, 16, 0.5]], 0.3);
    for (var c = 0; c < 4; c++) {
      var y0 = c * 4, off = (c & 1) ? 4 : 0;
      // mortar row
      for (x = 0; x < 16; x++) {
        var v = r();
        px(t, x, y0 + 3, C(v < 0.18 ? '#a9948d' : v < 0.58 ? '#a2867d' : '#8b6e67'));
      }
      for (var b = 0; b < 2; b++) {
        var jx = (3 + off + b * 8) & 15;           // joint column
        px(t, jx, y0, C('#a9948d')); px(t, jx, y0 + 1, C('#a2867d')); px(t, jx, y0 + 2, C('#8b6e67'));
        var tone = r() * 0.5 - 0.25, cells = [], sc = [];
        for (var i = 1; i < 8; i++) {
          x = (jx + i) & 15;
          for (y = y0; y < y0 + 3; y++) {
            cells.push([x, y]);
            var s = tone + f[y * 16 + x] * 0.6 + (y === y0 ? 0.55 : y === y0 + 2 ? -0.55 : 0) + (i === 1 ? 0.15 : i === 7 ? -0.3 : 0);
            sc.push(s);
          }
        }
        rankCells(t, cells, sc, pal('733f31:3 7c4536:4 8f503f:3 9b5643:6 b1624d:4 c66851:1.5'));
      }
    }
    return t;
  }

  function paintSmoothStone() {
    var r = R('smooth_stone'), t = T(), mask = new Uint8Array(N), x, y;
    var f = field(r, [[2, 8, 0.8], [4, 16, 0.6]], 0.35);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      if (y === 15) px(t, x, y, C(x === 0 ? '#747474' : r() < 0.8 ? '#747474' : '#7f7f7f'));
      else if (x === 15) px(t, x, y, C(r() < 0.85 ? '#7f7f7f' : '#747474'));
      else if (x === 0) px(t, x, y, C('#8f8f8f'));
      else if (y === 0) px(t, x, y, C(r() < 0.8 ? '#9d9d9d' : '#a3a3a3'));
      else mask[y * 16 + x] = 1;
    }
    rankPaint(t, f, pal('8f8f8f:6 a3a3a3:50 a8a8a8:73 b0b0b0:47'), mask);
    return t;
  }
  function paintSmoothSlabSide() {
    var r = R('smooth_stone_slab_side'), t = T(), mask = new Uint8Array(N), x, y;
    var f = field(r, [[2, 8, 0.8], [4, 16, 0.6]], 0.35);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var ly = y & 7;
      if (ly === 7) px(t, x, y, C(x === 0 ? '#747474' : r() < 0.45 ? '#7f7f7f' : r() < 0.5 ? '#8f8f8f' : '#747474'));
      else if (x === 15) px(t, x, y, C(ly === 0 ? '#9d9d9d' : r() < 0.6 ? '#8f8f8f' : '#9d9d9d'));
      else if (ly === 0) px(t, x, y, C('#cdcdcd'));
      else if (x === 0) px(t, x, y, C('#c1c1c1'));
      else mask[y * 16 + x] = 1;
    }
    rankPaint(t, f, pal('a3a3a3:48 a8a8a8:70 b0b0b0:43'), mask);
    return t;
  }

  /* ----------------------------------------------------------------- ores */
  var ORES = {
    coal_ore: { n: 5, minD: 5.6, rx: [1.3, 1.8], ry: [1.0, 1.4], lobes: 2, jit: 0.5, ore: '252525:14 2e2e2e:9 363636:9 393c36:10 494b3f:5', haloL: '5c5c5c', haloD: '5c5c5c', hp: 0.6 },
    iron_ore: { n: 5, minD: 5.6, rx: [1.6, 2.2], ry: [0.9, 1.3], lobes: 2, jit: 0.5, ore: '77674f:8 887455:19 af8e77:20 d8af93:13 e2c0aa:3' },
    gold_ore: { n: 5, minD: 5.6, rx: [1.4, 1.9], ry: [1.1, 1.5], lobes: 2, jit: 0.5, ore: '9c7020:23 eb9d0e:22 fcee4b:11 ffffb5:3', haloL: 'a2a2a2', haloD: '5c5c5c', hp: 0.5 },
    diamond_ore: { n: 7, minD: 4.4, rx: [1.1, 1.5], ry: [1.0, 1.3], lobes: 0, jit: 0.35, ore: '239698:10 1ed0d6:10 77e7d1:12 d5fff6:5', haloL: '8dadb1', haloD: '8dadb1', hp: 0.55, halo2: 'a2a2a2' },
    redstone_ore: { n: 5, minD: 5.2, rx: [1.8, 2.4], ry: [0.75, 1.05], lobes: 1, jit: 0.4, ore: '960606:10 ca0707:7 f71c1c:8 fd5e5e:5', haloL: 'bf9393', haloD: '695c5c', hp: 0.62, ring2: '938c8c' },
    lapis_ore: { n: 8, minD: 4.2, rx: [1.0, 1.5], ry: [0.8, 1.2], lobes: 2, jit: 0.9, ore: '10306e:4 16448d:10 1044ac:7 1855bd:7 2a62cc:8 446fdc:17 7194ec:3', haloL: 'a2a2a2', haloD: '5c5c5c', hp: 0.55 },
    emerald_ore: { n: 7, minD: 4.4, rx: [1.1, 1.45], ry: [1.1, 1.45], lobes: 0, jit: 0.3, ore: '007b18:11 17dd62:10 41f384:7 d9ffeb:7', haloL: '526b50', haloD: '526b50', hp: 0.7, halo2: '375b3e' }
  };
  function touchesOther(occ, x, y, id) {
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var o = occ[(((y + dy) & 15) << 4) | ((x + dx) & 15)];
      if (o !== -1 && o !== id) return true;
    }
    return false;
  }
  function ellipseBlob(r, occ, id, cx, cy, rx, ry, jit, cells) {
    cells = cells || [];
    for (var y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
      for (var x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        var dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy > 1 + (r() - 0.5) * jit) continue;
        var k = ((y & 15) << 4) | (x & 15);
        if (occ[k] !== -1 || touchesOther(occ, x, y, id)) continue;
        occ[k] = id; cells.push([x, y]);
      }
    return cells;
  }
  function paintOre(name) {
    var sp = ORES[name], r = R(name), t = clone(tiles.stone);
    var occ = new Int16Array(N).fill(-1), blobs = [];
    var centers = scatter(r, sp.n, sp.minD);
    centers.forEach(function (c, bi) {
      var rx = sp.rx[0] + r() * (sp.rx[1] - sp.rx[0]), ry = sp.ry[0] + r() * (sp.ry[1] - sp.ry[0]);
      var cells = ellipseBlob(r, occ, bi, c[0], c[1], rx, ry, sp.jit);
      for (var l = 0; l < sp.lobes; l++) {      // attached lobes -> irregular clumps instead of pills
        var a = r() * Math.PI * 2;
        ellipseBlob(r, occ, bi, c[0] + Math.cos(a) * rx * 0.95, c[1] + Math.sin(a) * ry * 0.95, 0.75 + r() * 0.35, 0.7 + r() * 0.3, 0.4, cells);
      }
      if (cells.length >= 2) blobs.push(cells);
    });
    var P = pal(sp.ore);
    blobs.forEach(function (cells, bi) {
      var id = occ[(cells[0][1] & 15) * 16 + (cells[0][0] & 15)];
      var mx = 0, my = 0;
      cells.forEach(function (c) { mx += c[0]; my += c[1]; });
      mx /= cells.length; my /= cells.length;
      function inB(x, y) { return occ[((y & 15) << 4) | (x & 15)] === id; }
      var sc = cells.map(function (c) {
        var x = c[0], y = c[1];
        return -(x - mx) * 0.55 - (y - my) * 0.75 + (inB(x, y - 1) ? 0 : 0.8) + (inB(x - 1, y) ? 0 : 0.45) - (inB(x, y + 1) ? 0 : 0.8) - (inB(x + 1, y) ? 0 : 0.45) + (r() - 0.5) * 0.5;
      });
      rankCells(t, cells.map(function (c) { return [c[0] & 15, c[1] & 15]; }), sc, P);
    });
    // halos: stone pixels touching ore take tinted stone colours
    var hal = new Uint8Array(N), x, y, k;
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      k = y * 16 + x;
      if (occ[k] !== -1) continue;
      var up = occ[((y - 1) & 15) * 16 + x] !== -1, lf = occ[y * 16 + ((x - 1) & 15)] !== -1;
      var dn = occ[((y + 1) & 15) * 16 + x] !== -1, rt = occ[y * 16 + ((x + 1) & 15)] !== -1;
      if (!(up || lf || dn || rt)) continue;
      hal[k] = 1;
      if (!sp.haloL || r() > sp.hp) continue;
      // halo below/right of ore -> shadow colour, above/left -> light colour
      var c = (up || lf) ? sp.haloD : sp.haloL;
      if (sp.halo2 && r() < 0.22) c = sp.halo2;
      px(t, x, y, C('#' + c));
    }
    if (sp.ring2) {
      for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
        k = y * 16 + x;
        if (occ[k] !== -1 || hal[k]) continue;
        var near = false;
        for (var dy = -2; dy <= 2 && !near; dy++) for (var dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > 2) continue;
          if (occ[((y + dy) & 15) * 16 + ((x + dx) & 15)] !== -1) { near = true; break; }
        }
        if (near && r() < 0.8) { var L = lum(getc(t, x, y)); if (L > 120) px(t, x, y, C('#' + sp.ring2)); }
      }
    }
    return t;
  }

  /* =========================================================================
   * LIQUIDS (animated, seamless loops)
   * =======================================================================*/
  var WATER_P = pal('a4a4a4:105 aeaeae:100 c2c2c2:29 cfcfcf:6 d3d3d3:8 f9f9f9:2 ffffff:6');
  var WATERF_P = pal('9f9f9f:8 a2a2a2:81 a4a4a4:52 a6a6a6:30 a9a9a9:26 ababab:11 aeaeae:7 b8b8b8:12 c4c4c4:5 cdcdcd:6 d5d5d5:8 ececec:3');
  // Water: thin bright wavelets = ridges (|a-0.5| small) of an anisotropic periodic 3D noise; every
  // lattice is periodic in x, y and time, drifts are whole periods per loop -> seamless in space and time.
  function waterFrames(seed, F, flow) {
    var r = R(seed), frames = [];
    var A = flow ? lattice3(r, 8, 2, 4) : lattice3(r, 2, 8, 4);
    var A2 = flow ? lattice3(r, 4, 2, 4) : lattice3(r, 2, 4, 4);
    var B = flow ? lattice3(r, 16, 4, 8) : lattice3(r, 4, 16, 8);
    var D = lattice3(r, 4, 4, 4);
    for (var f = 0; f < F; f++) {
      var ph = f / F, fld = new Float32Array(N);
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var u = (x + 0.5) / 16, v = (y + 0.5) / 16, a, a2, b, d;
        if (flow) {   // streaks elongated vertically, scrolling down 32px per loop
          a = sample3(A, u * 8 + Math.sin((v - ph * 2) * Math.PI * 2) * 0.35, v * 2 - ph * 4, ph * 4);
          a2 = sample3(A2, u * 4, v * 2 - ph * 4, ph * 4);
          b = sample3(B, u * 16, v * 4 - ph * 8, ph * 8);
          d = sample3(D, u * 4, v * 4 - ph * 8, ph * 4);
        } else {      // horizontal wavelets drifting slowly
          a = sample3(A, u * 2 + ph * 2, v * 8 + Math.sin((u + ph) * Math.PI * 2) * 0.6, ph * 4);
          a2 = sample3(A2, u * 2 - ph * 2, v * 4 + ph * 4, ph * 4);
          b = sample3(B, u * 4, v * 16 - ph * 16, ph * 8);
          d = sample3(D, u * 4 + ph * 4, v * 4, ph * 4);
        }
        var ridge = Math.max(1 - Math.abs(a - 0.5) * 3.4, 1 - Math.abs(a2 - 0.5) * 3.8 - 0.12);
        fld[y * 16 + x] = ridge * 0.7 + b * 0.24 + d * 0.13;
      }
      var t = T();
      rankPaint(t, fld, flow ? WATERF_P : WATER_P, null, 180);
      frames.push(t);
    }
    return frames;
  }
  function lavaColor(h) { h = clamp(h, 0, 1); return [155 + 100 * h, 255 * h * h, 128 * h * h * h * h, 255]; }
  // Lava: blotchy cells (2-4px) of a warped periodic 3D noise, rank-mapped onto the classic lava heat ramp
  // r=155+100h, g=255h^2, b=128h^4 which reproduces the vanilla palette (#d14f0c .. #dc711d .. yellow highlights).
  function lavaFrames(seed, F, flow) {
    var r = R(seed), frames = [];
    var B = flow ? lattice3(r, 8, 4, 4) : lattice3(r, 8, 8, 4);
    var D = flow ? lattice3(r, 16, 4, 6) : lattice3(r, 16, 16, 6);
    // bubbles: cell centres circling on small orbits (integer revolutions per loop) -> periodic animation
    var cells = scatter(r, flow ? 9 : 11, 3.6).map(function (p) {
      return { x: p[0], y: p[1], rad: 0.6 + r() * 1.1, ph: r() * Math.PI * 2, dir: r() < 0.5 ? -1 : 1, hot: r() };
    });
    for (var f = 0; f < F; f++) {
      var ph = f / F, fld = new Float32Array(N), i;
      var pts = cells.map(function (c) {
        var a = c.ph + c.dir * ph * Math.PI * 2;
        var yy = c.y + Math.sin(a) * c.rad + (flow ? ph * 16 : 0);
        return [c.x + Math.cos(a) * c.rad, ((yy % 16) + 16) % 16];
      });
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var u = (x + 0.5) / 16, v = (y + 0.5) / 16, b, d;
        var b1 = 1e9, b2 = 1e9, bi = 0;
        for (i = 0; i < pts.length; i++) {
          var dx = wrapD(x + 0.5, pts[i][0]), dy = wrapD(y + 0.5, pts[i][1]) * (flow ? 0.6 : 1);
          var dd = Math.sqrt(dx * dx + dy * dy);
          if (dd < b1) { b2 = b1; b1 = dd; bi = i; } else if (dd < b2) b2 = dd;
        }
        var cellv = Math.min(1, (b2 - b1) / 2.0) * 0.75 + cells[bi].hot * 0.25;
        if (flow) {
          b = sample3(B, u * 8, (v - ph) * 4, ph * 4);
          d = sample3(D, u * 16, (v - ph) * 4, ph * 6);
        } else {
          b = sample3(B, u * 8, v * 8, ph * 4);
          d = sample3(D, u * 16, v * 16, ph * 6);
        }
        fld[y * 16 + x] = cellv * 0.55 + b * 0.3 + d * 0.22;
      }
      var list = [];
      for (i = 0; i < N; i++) list.push(i);
      list.sort(function (p, q) { return fld[p] - fld[q] || p - q; });
      var t = T();
      for (i = 0; i < N; i++) {
        var q = i / (N - 1), h = flow ? 0.45 + 0.19 * q + 0.2 * sstep(0.78, 1, q) : 0.5 + 0.2 * q + 0.21 * sstep(0.74, 1, q);
        var k = list[i];
        px(t, k & 15, k >> 4, lavaColor(h));
      }
      frames.push(t);
    }
    return frames;
  }

  /* =========================================================================
   * WOOD
   * =======================================================================*/
  var WOOD = {
    oak: { D: '#c29d62', A: '#b8945f', B: '#af8f55', C: '#9f844d', G: '#967441', F: '#7e6237', E: '#67502c' },
    spruce: { D: '#886539', A: '#82613a', B: '#7a5a34', C: '#70522e', G: '#614b2e', F: '#5a4424', E: '#553a1f' },
    birch: { D: '#d7cb8d', A: '#d7c185', B: '#c8b77a', C: '#b8a875', G: '#ae9f76', F: '#a59467', E: '#9e8b61' }
  };
  function paintPlanks(seed, W, seams) {
    var r = R(seed), t = T(), mask = new Uint8Array(N), x, y, b;
    seams = seams || [11, 3, 13, 6];
    var f = field(r, [[2, 16, 1.0], [4, 16, 0.5]], 0.3);
    for (b = 0; b < 4; b++) for (y = b * 4; y < b * 4 + 3; y++) {
      var ro = (r() - 0.5) * 0.55;                 // each grain row gets its own tone -> long streaks
      for (x = 0; x < 16; x++) {
        mask[y * 16 + x] = 1;
        f[y * 16 + x] += ro + (y === b * 4 ? 0.3 : y === b * 4 + 2 ? -0.25 : 0);
      }
    }
    rankPaint(t, f, [[C(W.C), 47], [C(W.B), 48], [C(W.A), 52], [C(W.D), 38]], mask);
    for (b = 0; b < 4; b++) {
      var y0 = b * 4, sx = seams[b];
      for (x = 0; x < 16; x++) { var v = r(); px(t, x, y0 + 3, C(v < 0.45 ? W.E : v < 0.82 ? W.F : W.G)); }
      for (y = y0; y < y0 + 3; y++) px(t, sx, y, C(W.G));
      px(t, sx, y0 + 3, C(W.E));
      px(t, sx + 1, y0, C(W.D));
      px(t, sx - 1, y0 + 2, C(W.C));
      // nail heads at the board end
      px(t, sx + 2, y0 + 1, C(W.F));
      if (b & 1) px(t, sx - 3, y0 + 1, C(W.F));
    }
    return t;
  }
  function logSideField(seed) {
    var r = R(seed);
    var f = field(r, [[8, 2, 1.0], [16, 4, 0.55]], 0.3);
    for (var k = 0; k < 8; k++) { // crevices
      var x = ri(r, 0, 15), y = ri(r, 0, 15), len = ri(r, 3, 10);
      for (var j = 0; j < len; j++) { f[((y + j) & 15) * 16 + (x & 15)] -= 0.55; if (r() < 0.18) x += r() < 0.5 ? -1 : 1; }
    }
    for (k = 0; k < 5; k++) { // ridges
      var rx = ri(r, 0, 15), ry = ri(r, 0, 15), rl = ri(r, 2, 6);
      for (j = 0; j < rl; j++) f[((ry + j) & 15) * 16 + rx] += 0.35;
    }
    return f;
  }
  var LOG_F = logSideField('log_bark');
  function paintLogSide(P) { var t = T(); rankPaint(t, LOG_F, P); return t; }
  function paintLogTop(seed, W, bark) {
    var r = R(seed), t = T(), x, y;
    var ringCol = [null, W.A, W.B, W.G, W.B, W.C, W.B, W.C];
    var bf = field(r, [[4, 4, 1], [16, 16, 0.6]], 0.3);
    var bix = rankIdx(bf, bark.map(function (e) { return e[1]; }));
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var d = Math.min(x, y, 15 - x, 15 - y), c;
      if (d === 0) { c = bark[bix[y * 16 + x]][0]; px(t, x, y, c); continue; }
      var dd = d, v = r();
      if (v < 0.06 && d > 1 && d < 7) dd = d + (r() < 0.5 ? -1 : 1);
      c = C(ringCol[dd]);
      if (dd === 6 && r() < 0.35) c = C(W.D);
      if (dd === 7 && r() < 0.4) c = C(W.F);
      if (dd === 1 && r() < 0.08) c = C(W.D);
      px(t, x, y, c);
    }
    return t;
  }
  function paintBirchLog() {
    var r = R('birch_log'), t = T(), x, y;
    var f = field(r, [[2, 16, 1], [4, 16, 0.5], [8, 8, 0.3]], 0.25);
    rankPaint(t, f, pal('bebeae:8 d8d8ce:56 ded3d5:23 eef1ea:12 f0eeeb:60 ffffff:67'));
    // lenticel marks: wide dark horizontal patches (2 rows), wrapping around the log
    var marks = [[4, 2, 5], [13, 6, 3], [0, 12, 4], [9, 10, 2], [11, 14, 5]];
    marks.forEach(function (m) {
      var mx = m[0] + ri(r, -1, 1), my = m[1], L = m[2];
      for (var i = 0; i < L; i++) px(t, mx + i, my, C(i === 0 || i === L - 1 ? '#605e54' : '#36342a'));
      var a = ri(r, 0, 1), b2 = L - ri(r, 1, 2);
      for (i = a; i < b2; i++) px(t, mx + i, my + 1, C(i === a || i === b2 - 1 ? '#605e54' : '#36342a'));
      if (L > 3) px(t, mx + 1 + ri(r, 0, L - 3), my - 1, C('#605e54'));
    });
    return t;
  }
  function paintBirchLogTop() {
    var r = R('birch_log_top'), t = paintLogTop('birch_log_top', WOOD.birch, pal('999682:1'));
    // white bark ring with dark spots
    for (var i = 0; i < 60; i++) {
      var x, y;
      if (i < 16) { x = i; y = 0; } else if (i < 32) { x = 31 - i; y = 15; } else if (i < 46) { x = 0; y = i - 31; } else { x = 15; y = i - 45; }
      var v = (Math.sin(i * 0.9) + Math.sin(i * 2.3 + 1) + (r() - 0.5) * 1.2);
      px(t, x, y, C(v > 1.1 ? '#514f47' : v > 0.4 ? '#999682' : v > -0.6 ? '#ebebe7' : '#ffffff'));
    }
    return t;
  }

  function wrapS(a, b) { var d = a - b; return d - Math.round(d / 16) * 16; }
  // Leaves: many small overlapping leaf clumps (tileable); holes where no clump reaches; every clump is lit
  // from the top-left. Hole count and colour counts follow the vanilla histograms exactly.
  function paintLeaves(seed, holes, P, o) {
    var r = R(seed), t = T(), x, y, k, i;
    var pts = scatter(r, o.n, o.minD), rad = pts.map(function () { return o.r0 + r() * o.r1; });
    var hv = new Float32Array(N), s0 = new Float32Array(N);
    var g = field(r, [[8, 8, 0.6], [16, 16, 1]], 0.3);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var best = -1e9, bdx = 0, bdy = 0, bi = 0;
      for (i = 0; i < pts.length; i++) {
        var dx = wrapS(x + 0.5, pts[i][0]), dy = wrapS(y + 0.5, pts[i][1]);
        var v = 1 - Math.sqrt(dx * dx + dy * dy) / rad[i];
        if (v > best) { best = v; bdx = dx; bdy = dy; bi = i; }
      }
      k = y * 16 + x;
      hv[k] = best + (r() - 0.5) * o.hn;
      s0[k] = -(bdx + bdy * 1.2) / rad[bi] * 0.9 + best * 0.5 + g[k] * o.gn;
    }
    var ix = rankIdx(hv, [holes, N - holes]), cells = [], sc = [];
    for (k = 0; k < N; k++) {
      if (ix[k] === 0) continue;
      x = k & 15; y = k >> 4;
      cells.push([x, y]);
      var s = s0[k];
      if (ix[((y - 1) & 15) * 16 + x] === 0) s += o.edge;
      if (ix[((y + 1) & 15) * 16 + x] === 0) s -= o.edge * 0.9;
      sc.push(s);
    }
    rankCells(t, cells, sc, P);
    return bleed(t);
  }

  /* =========================================================================
   * PLANTS (cross sprites on transparent background)
   * =======================================================================*/
  function paintOakSapling() {
    var r = R('oak_sapling'), t = T();
    var Wd = ['#4c3214', '#5a3f1e', '#70532e', '#7f6139'];
    var L = ['#105210', '#1f6519', '#408f2f', '#57ad3f'];
    function limb(x0, y0, x1, y1, thick) {
      line(t, x0, y0, x1, y1, C(Wd[2]));
      if (thick) line(t, x0 + 1, y0, x1 + 1, y1, C(Wd[1]));
    }
    // branches first (leaves partly cover them, wood stays readable)
    limb(7, 15, 7, 10, true);
    limb(7, 10, 4, 6, true); limb(4, 6, 3, 3, false);
    limb(8, 10, 11, 5, true); limb(11, 5, 12, 2, false);
    limb(7, 10, 7, 4, false); limb(5, 8, 2, 8, false); limb(10, 7, 13, 8, false); limb(8, 12, 11, 11, false);
    [[3, 3.2, 1.7, 1.4], [7.4, 2.4, 1.6, 1.4], [12.2, 2.6, 1.7, 1.5], [1.9, 7.4, 1.5, 1.6], [13.6, 7.8, 1.6, 1.6], [9, 7.6, 1.4, 1.3], [5.2, 10.6, 1.4, 1.2], [11.6, 11, 1.4, 1.2]].forEach(function (c) {
      shadedBlob(t, r, c[0], c[1], c[2], c[3], L, 0.55);
    });
    line(t, 7, 15, 7, 11, C(Wd[3])); line(t, 8, 15, 8, 11, C(Wd[1]));
    px(t, 7, 15, C(Wd[2])); px(t, 8, 15, C(Wd[0])); px(t, 6, 9, C(Wd[3])); px(t, 5, 8, C(Wd[2]));
    px(t, 9, 9, C(Wd[2])); px(t, 10, 7, C(Wd[1])); px(t, 7, 6, C(Wd[2])); px(t, 4, 6, C(Wd[3]));
    return bleed(t);
  }
  function paintSpruceSapling() {
    var r = R('spruce_sapling'), t = T(), x, y;
    var L = ['#223522', '#2e492e', '#395a39'];
    var tiers = [[1, 4, 1.9], [3, 8, 3.6], [6, 12, 5.2]];
    tiers.forEach(function (tr) {
      for (y = tr[0]; y <= tr[1]; y++) {
        var hw = (y - tr[0] + 1) / (tr[1] - tr[0] + 1) * tr[2];
        var jag = (y & 1) ? 0.7 : -0.5;              // droopy, jagged tier edges
        for (x = 0; x < 16; x++) {
          var dx = x + 0.5 - 8;
          if (Math.abs(dx) > hw + jag + (r() - 0.5) * 0.9) continue;
          var l = -dx / 4 - (y - tr[0]) / (tr[1] - tr[0] + 1) * 0.9 + (r() - 0.5) * 0.9 + 0.15;
          px(t, x, y, C(L[l > 0.55 ? 2 : l > -0.25 ? 1 : 0]));
        }
      }
    });
    for (y = 2; y <= 12; y++) if (r() < 0.45) px(t, 7 + (y & 1), y, C(y > 8 ? '#2e1d0a' : '#50361a'));
    vline(t, 7, 12, 15, C('#2e1d0a')); vline(t, 8, 12, 15, C('#130803'));
    px(t, 7, 12, C('#50361a')); px(t, 7, 1, C('#395a39'));
    return bleed(t);
  }
  function paintBirchSapling() {
    var r = R('birch_sapling'), t = T();
    var L = ['#51742d', '#5a7e33', '#6c9e38', '#acbf62'];
    [[7.5, 4, 2.9, 3.5], [5.8, 8.5, 3.1, 3.1], [9.8, 8, 2.9, 3.1], [7.8, 11.4, 3.1, 2.3], [8, 1.8, 1.7, 1.7]].forEach(function (c) {
      shadedBlob(t, r, c[0], c[1], c[2], c[3], L, 0.55);
    });
    var trunk = [[7, 15], [7, 14], [8, 13], [7, 12], [7, 11], [8, 10], [7, 7], [8, 6], [7, 4], [7, 3]];
    trunk.forEach(function (p, i) { px(t, p[0], p[1], C(i % 3 === 1 ? '#c9d7a5' : '#e3ddba')); });
    px(t, 8, 15, C('#c9d7a5'));
    return bleed(t);
  }
  var GRASS_SH = ['#6c6c6c', '#767776', '#838183', '#919191', '#a0a0a0', '#b8b7b8'];
  function paintShortGrass() {
    var r = R('short_grass'), t = T();
    var n = 17;
    for (var i = 0; i < n; i++) {
      var bx0 = Math.round((i + 0.5) * 16 / n + (r() - 0.5) * 1.2), h = ri(r, 5, 14), lean = (r() - 0.5) * 3.5, tone = r();
      for (var j = 0; j < h; j++) {
        var y = 15 - j, x = bx0 + Math.round(lean * j * j / (h * h));
        if (x < 0 || x > 15) continue;
        var v = tone * 0.45 + (j / h) * 0.55 + (r() - 0.5) * 0.25;
        px(t, x, y, C(GRASS_SH[clamp(Math.floor(v * 6), 0, 5)]));
        if (j < 3 && r() < 0.4 && x < 15) px(t, x + 1, y, C(GRASS_SH[clamp(Math.floor(v * 5), 0, 5)]));
      }
    }
    return bleed(t);
  }
  function paintFern() {
    var r = R('fern'), t = T();
    var S6 = ['#585958', '#6b6e6b', '#7c7e7c', '#8c8a8c', '#949194', '#a5a2a5'];
    function bez(p0, p1, p2, s) { var a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, c = s * s; return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]]; }
    function frond(p0, p1, p2, leafLen, lift) {
      var prev = null, step = 0;
      for (var i = 0; i <= 40; i++) {
        var s = i / 40, p = bez(p0, p1, p2, s), q = bez(p0, p1, p2, Math.min(1, s + 0.03));
        var x = Math.round(p[0] - 0.5), y = Math.round(p[1] - 0.5);
        if (prev && prev[0] === x && prev[1] === y) continue;
        prev = [x, y]; step++;
        var tone = clamp(Math.round(0.6 + s * 2.6 + lift), 0, 5);
        pxIn(t, x, y, C(S6[tone]));
        if (step % 2 === 0 && s > 0.1 && s < 0.97) {
          var dx = q[0] - p[0], dy = q[1] - p[1], L = Math.sqrt(dx * dx + dy * dy) || 1;
          dx /= L; dy /= L;
          var len = Math.max(1, Math.round(leafLen * (1 - s * 0.65)));
          for (var k = 1; k <= len; k++) {
            pxIn(t, Math.round(x + dy * k + dx * k * 0.45), Math.round(y - dx * k + dy * k * 0.45), C(S6[clamp(tone + 2 - k, 0, 5)]));
            pxIn(t, Math.round(x - dy * k + dx * k * 0.45), Math.round(y + dx * k + dy * k * 0.45), C(S6[clamp(tone - k + (r() < 0.5 ? 1 : 0), 0, 5)]));
          }
        }
      }
    }
    frond([8, 16], [5.5, 8], [8.5, 1], 1.8, 0.4);
    frond([7.5, 16], [3, 11], [1.5, 4.5], 1.6, 0);
    frond([8.5, 16], [13, 11], [14.5, 5], 1.6, 0);
    frond([7.5, 16], [4.5, 14.5], [2, 14], 0.9, -0.5);
    frond([8.5, 16], [11.5, 14.5], [14, 13.5], 0.9, -0.5);
    return bleed(t);
  }
  var STEM = { d: '#177c04', m: '#4a8f28', l: '#55ab2d', m2: '#529a2e' };
  function paintDandelion() {
    var r = R('dandelion'), t = T();
    vline(t, 7, 11, 15, C(STEM.m)); px(t, 7, 15, C(STEM.d));
    line(t, 6, 13, 5, 12, C(STEM.d)); px(t, 6, 14, C(STEM.l));
    line(t, 8, 12, 9, 11, C(STEM.d)); px(t, 8, 13, C(STEM.l)); px(t, 10, 12, C(STEM.d));
    shadedBlob(t, r, 7.5, 8.6, 2.6, 1.9, ['#fed639', '#fed639', '#ffec4f', '#ffec4f'], 0.2);
    px(t, 7, 8, C('#f19d25')); px(t, 8, 8, C('#bd6a22')); px(t, 7, 9, C('#bd6a22')); px(t, 8, 9, C('#f19d25'));
    return bleed(t);
  }
  function paintPoppy() {
    var r = R('poppy'), t = T();
    vline(t, 7, 8, 13, C('#4a8f28')); vline(t, 7, 14, 15, C('#204626'));
    line(t, 6, 13, 4, 12, C('#204626')); px(t, 5, 13, C('#265a25')); px(t, 6, 14, C('#265a25'));
    line(t, 8, 13, 10, 12, C('#265a25')); px(t, 9, 13, C('#204626')); px(t, 8, 12, C('#2b702a'));
    shadedBlob(t, r, 7, 6, 3.1, 1.9, ['#9b221a', '#bf2529', '#ed302c', '#ed302c'], 0.25);
    px(t, 6, 6, C('#742303')); px(t, 7, 5, C('#9b221a')); px(t, 8, 4, C('#ed302c')); px(t, 7, 4, C('#bf2529'));
    return bleed(t);
  }
  function paintBlueOrchid() {
    var r = R('blue_orchid'), t = T();
    line(t, 7, 15, 7, 10, C(STEM.m)); line(t, 7, 10, 5, 6, C(STEM.l)); line(t, 7, 11, 11, 7, C(STEM.m));
    line(t, 7, 12, 4, 10, C(STEM.m)); line(t, 8, 13, 9, 11, C(STEM.l)); px(t, 7, 15, C(STEM.d)); px(t, 6, 15, C(STEM.d));
    function fl(cx, cy) {
      px(t, cx, cy, C('#1c92d6'));
      pxIn(t, cx - 1, cy, C('#27a9f4')); pxIn(t, cx + 1, cy, C('#27a9f4')); pxIn(t, cx, cy - 1, C('#2abffd')); pxIn(t, cx, cy + 1, C('#1c92d6'));
      pxIn(t, cx - 1, cy - 1, C('#2fcefd'));
    }
    fl(5, 4); fl(12, 5); fl(3, 9); fl(9, 9);
    px(t, 13, 5, C('#27a9f4')); px(t, 6, 5, C('#1c92d6'));
    return bleed(t);
  }
  function paintAllium() {
    var r = R('allium'), t = T();
    vline(t, 7, 7, 13, C(STEM.m2)); vline(t, 7, 14, 15, C(STEM.d)); px(t, 7, 10, C(STEM.l)); px(t, 7, 8, C(STEM.m));
    px(t, 8, 12, C(STEM.l)); px(t, 6, 13, C(STEM.m));
    shadedBlob(t, r, 7.5, 4, 3.3, 2.9, ['#7b4ea0', '#a65ee1', '#b878ed', '#d2a6f6', '#e8cffe'], 0.3);
    return bleed(t);
  }
  function paintAzureBluet() {
    var r = R('azure_bluet'), t = T();
    line(t, 7, 15, 6, 11, C(STEM.l)); line(t, 8, 15, 10, 10, C(STEM.m2)); line(t, 7, 14, 4, 12, C(STEM.m));
    px(t, 7, 15, C(STEM.m)); px(t, 9, 14, C(STEM.l)); px(t, 5, 14, C(STEM.m2)); px(t, 11, 13, C(STEM.m));
    function fl(cx, cy) {
      px(t, cx, cy, C('#ffec4f'));
      pxIn(t, cx - 1, cy, C('#f7f7f7')); pxIn(t, cx + 1, cy, C('#d6e8e8')); pxIn(t, cx, cy - 1, C('#f7f7f7')); pxIn(t, cx, cy + 1, C('#d6e8e8'));
    }
    fl(6, 8); fl(10, 7); fl(3, 11); fl(12, 10); fl(8, 11); fl(5, 13); fl(11, 13);
    return bleed(t);
  }
  function paintRedTulip() {
    var r = R('red_tulip'), t = T();
    vline(t, 7, 6, 15, C(STEM.m2)); px(t, 7, 15, C(STEM.d));
    // left leaf
    line(t, 6, 14, 4, 8, C(STEM.l)); line(t, 6, 13, 5, 9, C(STEM.m)); line(t, 5, 14, 4, 11, C(STEM.d)); px(t, 6, 12, C(STEM.l));
    // right leaf
    line(t, 8, 13, 10, 9, C(STEM.l)); line(t, 8, 14, 9, 11, C(STEM.m)); px(t, 11, 9, C(STEM.d)); px(t, 9, 13, C(STEM.d)); px(t, 8, 15, C(STEM.d));
    // cup
    px(t, 6, 2, C('#ed302c')); px(t, 8, 2, C('#ff4540'));
    hline(t, 6, 8, 3, C('#ed302c')); px(t, 7, 3, C('#ff4540'));
    px(t, 6, 4, C('#bf2529')); px(t, 7, 4, C('#ed302c')); px(t, 8, 4, C('#9b221a'));
    px(t, 7, 5, C('#9b221a')); px(t, 6, 5, C('#bf2529'));
    return bleed(t);
  }
  function paintOxeyeDaisy() {
    var r = R('oxeye_daisy'), t = T();
    vline(t, 7, 9, 15, C(STEM.m2)); px(t, 7, 15, C(STEM.d));
    line(t, 6, 13, 5, 12, C(STEM.d)); px(t, 6, 12, C(STEM.l)); line(t, 8, 12, 9, 11, C(STEM.l)); px(t, 8, 14, C(STEM.d)); px(t, 9, 13, C(STEM.d));
    var cells = shadedBlob(t, r, 7.5, 5.5, 3.4, 3.2, ['#9bbdbd', '#d6e8e8', '#f7f7f7', '#f7f7f7'], 0.35);
    px(t, 6, 4, C('#ffec4f')); px(t, 7, 4, C('#fed639')); px(t, 8, 4, C('#fed639'));
    px(t, 6, 5, C('#fed639')); px(t, 7, 5, C('#fed639')); px(t, 8, 5, C('#f5ba27'));
    px(t, 6, 6, C('#f5ba27')); px(t, 7, 6, C('#f19d25')); px(t, 8, 6, C('#f5ba27'));
    return bleed(t);
  }
  function paintCornflower() {
    var r = R('cornflower'), t = T();
    vline(t, 7, 6, 15, C('#578c4d')); px(t, 7, 9, C('#5b9c51')); px(t, 7, 14, C('#3f7935')); px(t, 7, 15, C('#2e6924'));
    line(t, 6, 11, 4, 9, C('#3f7935')); px(t, 5, 11, C('#2e6924')); px(t, 6, 12, C('#578c4d'));
    line(t, 8, 12, 9, 11, C('#5b9c51')); px(t, 10, 10, C('#3f7935'));
    shadedBlob(t, r, 7.5, 4.2, 3.3, 1.6, ['#2a4cc7', '#466aeb', '#6281e8', '#728ff1'], 0.3);
    px(t, 7, 5, C('#432e99')); px(t, 8, 5, C('#2a4cc7')); px(t, 7, 6, C('#8e6cc3'));
    return bleed(t);
  }
  function paintBrownMushroom() {
    var r = R('brown_mushroom'), t = T();
    // stem
    vline(t, 7, 10, 13, C('#b5947d')); vline(t, 8, 10, 13, C('#916d55'));
    px(t, 7, 13, C('#65554a')); px(t, 8, 13, C('#4c3d33')); px(t, 8, 12, C('#725643'));
    // cap
    hline(t, 6, 9, 6, C('#cc9978'));
    hline(t, 5, 10, 7, C('#cc9978')); px(t, 10, 7, C('#b5947d'));
    hline(t, 4, 11, 8, C('#916d55')); px(t, 4, 8, C('#b5947d')); px(t, 5, 8, C('#cc9978'));
    hline(t, 5, 10, 9, C('#725643')); px(t, 5, 9, C('#6a4e3b')); px(t, 10, 9, C('#6a4e3b')); px(t, 6, 9, C('#6a4e3b'));
    return bleed(t);
  }
  function paintRedMushroom() {
    var r = R('red_mushroom'), t = T();
    vline(t, 7, 12, 15, C('#ede8ca')); vline(t, 8, 12, 15, C('#d6d0ac'));
    px(t, 8, 15, C('#cfc47f')); px(t, 8, 12, C('#a9a065')); px(t, 7, 12, C('#cfc47f'));
    hline(t, 6, 9, 9, C('#fe2a2a'));
    hline(t, 4, 11, 10, C('#e21212')); px(t, 5, 10, C('#fe2a2a')); px(t, 6, 10, C('#fe2a2a'));
    hline(t, 4, 11, 11, C('#e21212')); px(t, 10, 11, C('#c41d26')); px(t, 11, 11, C('#a9121a')); px(t, 11, 10, C('#c41d26')); px(t, 4, 11, C('#c41d26'));
    px(t, 6, 9, C('#96adaf')); px(t, 10, 10, C('#9accd0')); px(t, 5, 11, C('#96adaf'));
    return bleed(t);
  }
  function paintDeadBush() {
    var r = R('dead_bush'), t = T();
    var cols = ['#513d24', '#67502c', '#946428', '#b17a36'];
    // recursive twiggy shrub: upward-biased forks, thick lit/shaded trunk
    function br(x, y, ang, len, depth) {
      var cx = x, cy = y;
      for (var i = 0; i < len; i++) {
        cx += Math.cos(ang); cy += Math.sin(ang);
        var ix = Math.round(cx - 0.5), iy = Math.round(cy - 0.5);
        if (ix < 0 || ix > 15 || iy < 0 || iy > 15) return;
        px(t, ix, iy, C(cols[depth === 0 ? (i & 1 ? 3 : 2) : depth === 1 ? (r() < 0.65 ? 2 : 3) : (r() < 0.55 ? 1 : 2)]));
        if (depth === 0 || (depth === 1 && i < 2)) pxIn(t, ix + 1, iy, C(cols[depth === 0 ? 1 : 0]));
        ang += (r() - 0.5) * 0.3 + (-Math.PI / 2 - ang) * 0.08;   // bias upward
      }
      if (depth < 3) {
        var k = depth === 0 ? 3 : 2;
        for (var j = 0; j < k; j++) br(cx, cy, ang + (j - (k - 1) / 2) * (depth === 0 ? 0.85 : 0.75) + (r() - 0.5) * 0.35, Math.max(2, len * (0.55 + r() * 0.18)), depth + 1);
      }
    }
    br(8, 16.2, -Math.PI / 2 + 0.05, 6, 0);
    br(8, 13.5, -Math.PI / 2 - 0.75, 4, 1);
    br(9, 12.5, -Math.PI / 2 + 0.8, 4, 1);
    return bleed(t);
  }
  function paintLilyPad() {
    var r = R('lily_pad'), t = T(), x, y;
    var f = field(r, [[8, 8, 1], [16, 16, 0.5]], 0.3);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var dx = x + 0.5 - 8, dy = y + 0.5 - 8.4, d = Math.sqrt(dx * dx + dy * dy);
      var ang = Math.atan2(dx, -dy);                       // 0 = up
      if (d > 7.3 + Math.sin(ang * 5 + 1) * 0.35) continue;
      if (Math.abs(ang) < 0.22 && d > 1.0) continue;        // notch
      var c;
      if (d > 6.5 || (Math.abs(ang) < 0.42 && d > 1.0)) c = '#5c5c5c';
      else if (d > 5.7) c = dy > 0 ? '#686868' : '#7f7f7f';
      else if ((Math.abs(ang - 1.9) < 0.07 || Math.abs(ang + 1.9) < 0.07 || Math.abs(Math.abs(ang) - 3.14) < 0.06) && d > 2) c = '#7f7f7f';
      else { var v = f[y * 16 + x] - dy * 0.035 - dx * 0.02; c = v > 0.8 ? '#a3a3a3' : v > 0.2 ? '#969696' : '#7f7f7f'; }
      px(t, x, y, C(c));
    }
    return bleed(t);
  }
  function paintSugarCane() {
    var r = R('sugar_cane'), t = T();
    var G1 = gray(148), GL = gray(193), GD = gray(119), GH = gray(234), GM = gray(170), LF = gray(186), LF2 = gray(160);
    [1, 5, 9, 13].forEach(function (sx, si) {
      var off = ri(r, 0, 5);
      for (var y = 0; y < 16; y++) {
        var node = ((y + off) % 6) === 0;
        px(t, sx, y, node ? GH : GL);
        px(t, sx + 1, y, node ? GD : G1);
        if (((y + off) % 6) === 1) px(t, sx + 1, y, GM);
      }
      for (var k = 0; k < 2; k++) {
        var ly = (ri(r, 0, 15)), side = r() < 0.5 ? -1 : 2;
        pxIn(t, sx + side, ly, LF); pxIn(t, sx + side + (side < 0 ? -1 : 1), ly - 1, LF2);
      }
    });
    return bleed(t);
  }
  function paintCactusSide() {
    var r = R('cactus_side'), t = T(), x, y;
    var cols = [null, '#39581a', '#649832', '#5b8c2b', '#527d26', '#527d26', '#649832', '#5b8c2b', '#527d26', '#649832', '#649832', '#5b8c2b', '#527d26', '#5b8c2b', '#39581a'];
    for (y = 0; y < 16; y++) for (x = 1; x < 15; x++) {
      var c = cols[x];
      if (x > 1 && x < 14 && r() < 0.12) c = cols[x + (r() < 0.5 ? -1 : 1)] || c;
      if ((x === 4 || x === 8 || x === 12) && r() < 0.25) c = '#426520';
      px(t, x, y, C(c));
    }
    var spikes = [[0, 2], [15, 5], [0, 10], [15, 13], [4, 1], [8, 6], [12, 3], [4, 12], [8, 14], [12, 9], [3, 8]];
    spikes.forEach(function (s, i) {
      px(t, s[0], s[1], C('#babf95'));
      if (s[0] > 0 && s[0] < 15) pxIn(t, s[0], s[1] + 1, C('#9fa76d'));
    });
    return bleed(t);
  }
  function paintCactusTop() {
    var r = R('cactus_top'), t = T(), mask = new Uint8Array(N), x, y;
    var f = field(r, [[4, 4, 1], [8, 8, 0.6]], 0.4);
    for (y = 1; y < 15; y++) for (x = 1; x < 15; x++) {
      if (x === 1 || y === 1 || x === 14 || y === 14) px(t, x, y, C(r() < 0.25 ? '#39581a' : '#426520'));
      else if (x === 2 || y === 2 || x === 13 || y === 13) px(t, x, y, C(r() < 0.5 ? '#527d26' : '#426520'));
      else mask[y * 16 + x] = 1;
    }
    rankPaint(t, f, pal('527d26:30 5b8c2b:37 649832:37'), mask);
    [[4, 3], [9, 4], [12, 7], [6, 7], [3, 10], [8, 11], [11, 12], [6, 13]].forEach(function (s, i) { px(t, s[0], s[1], C(i & 1 ? '#9fa76d' : '#babf95')); });
    return bleed(t);
  }
  function paintCactusBottom() {
    var t = T(), x, y;
    var ring = [null, null, '#d1d37a', '#cacc70', '#a0bf64', '#cacc70', '#cacc70', '#d1d37a'];
    for (y = 1; y < 15; y++) for (x = 1; x < 15; x++) {
      var d = Math.min(x, y, 15 - x, 15 - y), e = Math.sqrt((x - 7.5) * (x - 7.5) + (y - 7.5) * (y - 7.5));
      if (d === 1) px(t, x, y, C((x === 1 || y === 1) ? '#0d6118' : (x + y) & 1 ? '#094210' : '#0d6118'));
      else if (e > 1.2 && e < 2.3) px(t, x, y, C((x + y) & 1 ? '#8db04b' : '#a0bf64'));     // round core ring
      else px(t, x, y, C(ring[d]));
    }
    return bleed(t);
  }
  var PUMP = { hi: '#e3a64b', l: '#e38a1d', m: '#c46f14', m2: '#ab6112', d: '#a0560b', dd: '#7e3d0e' };
  function paintPumpkinSide(seed) {
    var r = R(seed || 'pumpkin_side'), t = T(), x, y;
    var groove = { 0: 1, 4: 1, 9: 1, 13: 1 };
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var c;
      if (groove[x]) c = y > 11 && r() < 0.6 ? PUMP.dd : PUMP.d;
      else if (groove[(x - 1) & 15]) c = r() < 0.7 ? PUMP.m : PUMP.l;
      else if (groove[(x + 1) & 15]) c = r() < 0.55 ? PUMP.m : PUMP.l;
      else c = PUMP.l;
      if (!groove[x] && y < 6 && r() < 0.16) c = PUMP.hi;
      if (!groove[x] && y > 12 && r() < 0.35) c = PUMP.m;
      if (y === 15) c = r() < 0.5 ? PUMP.d : PUMP.dd;
      if (y === 0 && r() < 0.4) c = PUMP.m;
      px(t, x, y, C(c));
    }
    return t;
  }
  function paintPumpkinTop() {
    var r = R('pumpkin_top'), t = T(), x, y;
    var f = field(r, [[8, 8, 0.6], [16, 16, 0.5]], 0.4);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var dx = x + 0.5 - 8, dy = y + 0.5 - 8, a = Math.atan2(dy, dx), d = Math.sqrt(dx * dx + dy * dy);
      var rib = Math.cos(a * 8 + d * 0.15);
      var v = f[y * 16 + x] * 0.6 + rib * 0.35 - d * 0.02;
      var c = rib < -0.72 ? (d > 5 ? PUMP.m2 : PUMP.d) : v > 0.75 ? PUMP.hi : v > 0.35 ? PUMP.l : v > 0.05 ? PUMP.m : PUMP.m2;
      px(t, x, y, C(c));
    }
    // stem
    px(t, 7, 7, C('#e3aa00')); px(t, 8, 7, C('#b78600')); px(t, 7, 8, C('#b78600')); px(t, 8, 8, C('#603607'));
    px(t, 6, 7, C('#b78600')); px(t, 9, 8, C('#603607')); px(t, 8, 9, C('#603607')); px(t, 7, 6, C('#e3aa00')); px(t, 6, 8, C('#603607'));
    return t;
  }
  // carved face: 1 = hole, 2 = inner rim (lit edge)
  function faceMask() {
    var m = new Uint8Array(N), x, y;
    function eye(x0) {
      for (y = 2; y <= 6; y++) for (x = x0; x < x0 + 4; x++) {
        if (y === 2 && (x === x0 || x === x0 + 3)) continue;   // rounded top
        if (y === 6 && x === (x0 < 8 ? x0 + 3 : x0)) continue;  // slanted inner bottom corner
        m[y * 16 + x] = 1;
      }
    }
    eye(3); eye(9);
    for (y = 8; y <= 11; y++) for (x = 2; x <= 13; x++) {
      if (y === 8 && (x === 2 || x === 13)) continue;
      if (y === 8 && (x === 5 || x === 6 || x === 9 || x === 10)) continue;   // upper teeth
      if (y === 11 && (x === 2 || x === 3 || x === 7 || x === 8 || x === 12 || x === 13)) continue;   // lower teeth / corners
      m[y * 16 + x] = 1;
    }
    return m;
  }
  var FACE = faceMask();
  function paintCarved(lit) {
    var t = paintPumpkinSide('pumpkin_side'), r = R(lit ? 'jack_o_lantern' : 'carved_pumpkin'), x, y;   // same ribs as the plain side
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var k = y * 16 + x;
      if (FACE[k]) {
        var edge = !FACE[k - 16] || !FACE[k - 1] || !FACE[k + 1] || !FACE[k + 16];
        var top = !FACE[k - 16];
        if (lit) px(t, x, y, C(edge ? (top ? '#ffc264' : '#ffe156') : r() < 0.7 ? '#feffa1' : '#ffe156'));
        else px(t, x, y, C(top ? '#2d0003' : r() < 0.62 ? '#441300' : '#2d0003'));
      } else {
        var near = FACE[((y + 1) & 15) * 16 + x] || FACE[((y - 1) & 15) * 16 + x] || FACE[y * 16 + ((x + 1) & 15)] || FACE[y * 16 + ((x - 1) & 15)];
        if (near) px(t, x, y, C(lit ? (r() < 0.5 ? '#e3a64b' : '#d4aa37') : (r() < 0.5 ? PUMP.dd : PUMP.d)));
      }
    }
    return t;
  }
  function paintMelonSide() {
    var r = R('melon_side'), t = T(), x, y;
    var pat = [], x0 = 0;
    while (pat.length < 16) {
      var w = pick(r, [1, 2, 2]), c = pat.length % 3;
      for (var i = 0; i < w && pat.length < 16; i++) pat.push(['#a7ac1d', '#6f9323', '#52811c', '#a7ac1d', '#34791e', '#52811c'][(pat.length + x0) % 6]);
      x0++;
    }
    for (x = 0; x < 16; x++) {
      var sh = 0;
      for (y = 0; y < 16; y++) {
        if (r() < 0.1) sh = sh ? 0 : (r() < 0.5 ? -1 : 1);
        var c2 = pat[(x + sh) & 15];
        if (c2 === '#34791e' && r() < 0.45) c2 = '#32691c';
        if (c2 === '#52811c' && r() < 0.15) c2 = '#6f9323';
        px(t, x, y, C(c2));
      }
    }
    return t;
  }
  function paintMelonTop() {
    var r = R('melon_top'), t = T(), x, y;
    var f = field(r, [[8, 8, 1], [16, 16, 0.6]], 0.4);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var dx = x + 0.5 - 8, dy = y + 0.5 - 8, a = Math.atan2(dy, dx), d = Math.sqrt(dx * dx + dy * dy);
      var s = Math.sin(a * 9 + d * 0.3 + f[y * 16 + x] * 1.8);
      var c = d < 1.3 ? '#2c5d19' : s > 0.5 ? '#a7ac1d' : s > -0.15 ? '#6f9323' : s > -0.65 ? '#52811c' : '#31731c';
      if (d < 2.6 && s > 0.5) c = '#6f9323';
      if (d < 2 && s < -0.15) c = '#2c5d19';
      px(t, x, y, C(c));
    }
    return t;
  }
  // wheat: shared stalk layout, 8 growth stages
  var WHEAT_STALKS = (function () {
    var r = R('wheat_layout'), out = [];
    var xs = [0, 2, 4, 6, 8, 10, 12, 14];
    for (var i = 0; i < xs.length; i++) out.push({ x: xs[i] + ri(r, 0, 1), lean: pick(r, [-1, 0, 1, 1, -1]), hf: [0.95, 0.72, 1.0, 0.8, 0.9, 0.68, 1.0, 0.85][i], leaf: (i & 1) ? 1 : -1, lf1: 0.2 + r() * 0.25, lf2: 0.5 + r() * 0.2 });
    return out;
  })();
  function paintWheat(stage) {
    var t = T();
    var H = [2, 3, 4, 6, 9, 11, 13, 15][stage];
    var G = ['#056a05', '#088806', '#00ae19', '#11761f', '#15cd2f'];
    var stalkC, leafC, earC = null;
    if (stage <= 3) { stalkC = [G[0], G[1], G[2]]; leafC = [G[1], G[2], G[4]]; }
    else if (stage === 4) { stalkC = [G[0], G[1], G[2]]; leafC = [G[1], G[2], G[3]]; earC = ['#4b7613', '#5b6b0f', '#8d773d', '#9f9908']; }
    else if (stage === 5) { stalkC = [G[0], '#4b7613', G[2]]; leafC = [G[1], G[2], G[3]]; earC = ['#5b6b0f', '#4b7613', '#9f9908', '#8d773d']; }
    else if (stage === 6) { stalkC = ['#5b6b0f', '#7f6a33', '#8d773d']; leafC = ['#5b6b0f', '#7f6a33', '#9f9908']; earC = ['#7f6a33', '#8d773d', '#cdb159', '#dcbb65']; }
    else { stalkC = ['#5b6b0f', '#75772f', '#8a8636']; leafC = ['#75772f', '#8a8636', '#a69553']; earC = ['#75772f', '#8a8636', '#cdb159', '#dcbb65']; }
    var order = stage === 0 ? [1, 3, 4, 6] : stage === 1 ? [0, 2, 3, 5, 6] : [0, 1, 2, 3, 4, 5, 6, 7];
    order.forEach(function (i) {
      var s = WHEAT_STALKS[i], h = Math.max(1, Math.round(H * s.hf));
      if (stage === 0 && (i & 1)) h = 1;
      var ear = earC ? Math.min(h - 2, [0, 0, 0, 0, 2, 3, 5, 7][stage]) : 0;
      for (var j = 0; j < h; j++) {
        var y = 15 - j, x = s.x + (j >= h * 0.55 ? s.lean : 0);
        if (j >= h - ear) {                      // ear: two-pixel braid of grains
          var e = j - (h - ear), side = ((j + i) & 1) ? 1 : -1;
          pxIn(t, x, y, C(earC[e === ear - 1 ? 3 : 2 + (e & 1)]));
          if (e < ear - 1) pxIn(t, x + side, y, C(earC[(e & 1) ? 0 : 1]));
        } else pxIn(t, x, y, C(stalkC[j < 2 ? 0 : (j % 3 === 2 ? 2 : 1)]));
      }
      if (stage >= 1 && h >= 3) {                // diagonal leaves, drooping at the tip
        var nl = stage >= 3 ? 2 : 1, len = stage >= 5 ? 3 : 2;
        for (var l = 0; l < nl; l++) {
          var ly = 15 - Math.max(1, Math.floor(h * (l === 0 ? s.lf1 : s.lf2))), dir = l === 0 ? s.leaf : -s.leaf;
          for (var k = 1; k <= len; k++) pxIn(t, s.x + dir * k, ly - k + 1 + (k === 3 ? 1 : 0), C(leafC[Math.min(2, k - 1)]));
        }
      }
    });
    return bleed(t);
  }
  function paintFarmland(seed, P) {
    var r = R(seed), t = T(), x, y;
    var f = field(r, [[4, 2, 0.5], [8, 8, 0.6], [16, 16, 0.5]], 0.3);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var wob = Math.sin(y * 0.8 + 1.3) * 0.6;
      f[y * 16 + x] += Math.cos((x + 0.5 + wob) / 8 * Math.PI * 2 + 2.1) * 0.55;
    }
    rankPaint(t, f, P);
    var peb = [[3, 5], [12, 12], [9, 2]];
    peb.forEach(function (p, i) { px(t, p[0], p[1], C('#555555')); if (i === 0) px(t, p[0] + 1, p[1], C('#6f6f6f')); });
    return t;
  }
  function paintHaySide() {
    var r = R('hay_block_side'), t = T(), x, y;
    var col = [];
    for (x = 0; x < 16; x++) col.push(r());
    var f = field(r, [[16, 4, 0.45], [16, 8, 0.25]], 0.3), mask = new Uint8Array(N);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      if (y === 3 || y === 11) continue;
      mask[y * 16 + x] = 1;
      f[y * 16 + x] += col[x] * 0.8 + (y === 2 || y === 10 ? -0.2 : 0);
    }
    rankPaint(t, f, pal('8a7320:38 94801e:54 ab9225:65 bfab31:34 cbb630:33'), mask);
    var bm = new Uint8Array(N);
    for (x = 0; x < 16; x++) { bm[3 * 16 + x] = 1; bm[11 * 16 + x] = 1; }
    rankPaint(t, field(r, [[8, 16, 1]], 0.5), pal('87351c:1 924123:12 a5492c:4 a4512b:15'), bm);
    return t;
  }

  function paintGlass() {
    var t = T(), x, y;
    for (x = 0; x < 16; x++) { px(t, x, 0, C('#d0eae9')); px(t, x, 15, C(x === 0 ? '#a8d0d9' : x % 5 === 2 ? '#7baeb7' : '#8bc1cd')); }
    for (y = 1; y < 15; y++) { px(t, 0, y, C('#d0eae9')); px(t, 15, y, C(y % 4 === 1 ? '#a8d0d9' : '#8bc1cd')); }
    px(t, 15, 0, C('#a8d0d9'));
    px(t, 2, 4, C('#a8d0d9')); px(t, 3, 3, C('#d0eae9')); px(t, 4, 2, C('#a8d0d9'));
    px(t, 12, 13, C('#a8d0d9')); px(t, 13, 12, C('#d0eae9'));
    return bleed(t);
  }
  function paintPaneTop() {
    var t = T();
    for (var y = 0; y < 16; y++) {
      px(t, 7, y, C((y >> 1) & 1 ? '#a8d0d9' : '#d0eae9'));
      px(t, 8, y, C(y === 9 ? '#7baeb7' : (y % 3 === 0 ? '#a8d0d9' : '#8bc1cd')));
    }
    return bleed(t);
  }

  /* =========================================================================
   * CRAFTED
   * =======================================================================*/
  var WOOL_C = {
    white: ['#d3d9da', '#eaeced', '#fefefe'], orange: ['#e36507', '#f17614', '#f9932b'], magenta: ['#a93399', '#be45b4', '#d660d1'],
    light_blue: ['#2891c8', '#3aafd9', '#4ec5e7'], yellow: ['#f2b018', '#f9c628', '#fed93f'], lime: ['#61a917', '#70b91a', '#86cc26'],
    pink: ['#df6d93', '#ee8dac', '#f4b2c9'], gray: ['#33373b', '#3f4448', '#474f52'], light_gray: ['#7d7e75', '#8e8e87', '#9d9d97'],
    cyan: ['#15778a', '#158a91', '#169b9c'], purple: ['#651f9b', '#7a2aad', '#9743cd'], blue: ['#2b2e8f', '#35399d', '#3e4db2'],
    brown: ['#623b1f', '#724829', '#835432'], green: ['#495c22', '#556e1c', '#658619'], red: ['#8d1f1f', '#a12723', '#b8342c'],
    black: ['#07090d', '#15151a', '#252529']
  };
  // knitted wool: every row is a chain of 2-4px horizontal stitches (lit left end, shaded right end),
  // neighbouring rows staggered like bricks, plus a soft large-scale variation
  var WOOL_V = (function () {
    var r = R('wool_weave'), v = new Float32Array(N), x, y;
    var big = normz(field(r, [[4, 4, 1], [8, 8, 0.6]], 0));
    var off = 0;
    for (y = 0; y < 16; y++) {
      off = (off + 2 + ri(r, 0, 1)) & 15;
      var cov = 0;
      while (cov < 16) {
        var len = pick(r, [3, 3, 4, 2, 3]);
        if (cov + len > 16) len = 16 - cov;
        var base = (r() - 0.5) * 0.55;
        for (var j = 0; j < len; j++) {
          x = (off + cov + j) & 15;
          v[y * 16 + x] = base + (j === 0 ? 0.55 : j === len - 1 ? -0.45 : 0.1) + big[y * 16 + x] * 0.18 + (r() - 0.5) * 0.12;
        }
        cov += len;
      }
    }
    return v;
  })();
  function paintWool(name) {
    var cs = WOOL_C[name], dark = C(cs[0]), mid = C(cs[1]), light = C(cs[2]), t = T();
    var hi = mixc(mid, light, 0.72);
    var list = [], i;
    for (i = 0; i < N; i++) list.push(i);
    list.sort(function (a, b) { return WOOL_V[a] - WOOL_V[b] || a - b; });
    for (i = 0; i < N; i++) {
      var q = i / (N - 1), k = list[i], c;
      if (q > 0.918) c = light;
      else {
        var s = q / 0.918;
        c = s < 0.5 ? mixc(dark, mid, Math.pow(s * 2, 0.8)) : mixc(mid, hi, (s - 0.5) * 2);
      }
      px(t, k & 15, k >> 4, [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 255]);
    }
    return t;
  }
  function paintIronBlock() {
    var r = R('iron_block'), t = T(), x, y;
    for (x = 0; x < 16; x++) { px(t, x, 0, C('#dcdcdc')); px(t, x, 15, C(x === 0 || x === 15 ? '#b1b0b0' : x % 3 === 0 ? '#b9b9b9' : x % 3 === 1 ? '#d1cfcf' : '#c1c1c1')); }
    for (y = 1; y < 15; y++) { px(t, 0, y, C('#c1c1c1')); px(t, 15, y, C(y % 5 === 2 ? '#b1b0b0' : '#b9b9b9')); }
    for (y = 1; y < 15; y++) {
      var streak = (y % 2 === 1), L = streak ? ri(r, 3, 9) : ri(r, 1, 3);
      for (x = 1; x < 15; x++) {
        var c = '#e6e6e6';
        if (x <= L) c = streak ? (x <= L - 2 ? '#f2f2f2' : '#ececec') : '#ececec';
        else if (x > 10 + ri(r, 0, 2)) c = r() < 0.5 ? '#e0e0e0' : '#dcdcdc';
        if (y === 14) c = r() < 0.6 ? '#d6d6d6' : '#dcdcdc';
        if (x === 14 && r() < 0.6) c = '#d6d6d6';
        if (r() < 0.05) c = '#d1cfcf';
        px(t, x, y, C(c));
      }
    }
    return t;
  }
  // gold/diamond: shiny diagonal bands inside a bevelled square
  function paintGem(seed, P) { // P: [darkEdge2, darkEdge, darker, dark, base, light, lighter, bright, white]
    var r = R(seed), t = T(), mask = new Uint8Array(N), x, y;
    var f = field(r, [[4, 4, 0.35], [16, 16, 0.3]], 0.25);
    var band = [];
    for (var i = 0; i < 32; i++) band.push(0);
    var bands = [[4, 2.2], [11, 1.4], [17, 2.6], [24, 1.2], [28, 1.6]];
    for (i = 0; i < 32; i++) bands.forEach(function (b) { var d = Math.abs(i - b[0]); band[i] += Math.max(0, 1 - d / b[1]); });
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      if (x === 15 || y === 15) { px(t, x, y, C((x + y) % 3 === 0 ? P[0] : P[1])); continue; }
      if (y === 0 || x === 0) { px(t, x, y, C(x + y < 6 ? P[8] : (x + y) % 4 === 1 ? P[6] : P[7])); continue; }
      mask[y * 16 + x] = 1;
      f[y * 16 + x] += band[x + y] * 0.55 - (x + y) * 0.012;
    }
    rankPaint(t, f, [[C(P[2]), 29], [C(P[3]), 52], [C(P[4]), 55], [C(P[5]), 37], [C(P[6]), 37], [C(P[7]), 5]], mask);
    return t;
  }
  function paintEmeraldBlock() {
    var t = T(), x, y;
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var d = Math.min(x, y, 15 - x, 15 - y), tl = (y === d || x === d) && !(x === 15 - d && y !== d) && !(y === 15 - d && x !== d);
      var c;
      switch (d) {
        case 0: c = tl ? '#17c544' : '#1c9829'; break;     // outer edge, shaded bottom/right
        case 1: c = tl ? '#82f6ad' : '#17c544'; break;     // bright inner bevel
        case 2: c = '#1aae35'; break;
        case 3: c = '#41f384'; break;
        case 4: c = '#17dd62'; break;
        case 5: c = tl ? '#1aae35' : '#17c544'; break;
        case 6: c = '#17dd62'; break;
        default: c = '#41f384';
      }
      px(t, x, y, C(c));
    }
    return t;
  }
  function paintRedstoneBlock() {
    var r = R('redstone_block'), t = T(), mask = new Uint8Array(N), x, y;
    var f = field(r, [[4, 4, 0.6], [8, 8, 0.5], [16, 16, 0.4]], 0.3);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var d = Math.min(x, y, 15 - x, 15 - y);
      if (d === 0) { px(t, x, y, C('#e62008')); continue; }
      mask[y * 16 + x] = 1;
      f[y * 16 + x] += d * 0.16;
    }
    rankPaint(t, f, pal('e62008:6 bd2008:44 a41808:46 941400:45 730c00:47'), mask);
    [[4, 6], [10, 4], [7, 10], [12, 11], [3, 12], [11, 7]].forEach(function (p) { px(t, p[0], p[1], C('#e62008')); });
    return t;
  }
  function paintGlowstone() {
    var r = R('glowstone'), t = T();
    var f = field(r, [[4, 4, 0.8], [8, 8, 0.7], [16, 16, 0.5]], 0.3);
    rankPaint(t, f, pal('6f4522:50 734e26:28 855029:33 886839:33'));
    var occ = new Int16Array(N).fill(-1);
    scatter(r, 12, 3.6).forEach(function (c, i) {
      var cells = ellipseBlob(r, occ, i, c[0], c[1], 1.35 + r() * 0.6, 1.2 + r() * 0.5, 0.7);
      if (!cells.length) return;
      var sc = cells.map(function (p) {
        var dx = p[0] + 0.5 - c[0], dy = p[1] + 0.5 - c[1];
        return -Math.sqrt(dx * dx + dy * dy) - (dx + dy) * 0.35 + (r() - 0.5) * 0.6;
      });
      rankCells(t, cells.map(function (p) { return [p[0] & 15, p[1] & 15]; }), sc, pal('cc8654:41 fbda74:36 fff0da:26 ffffff:9'));
    });
    return t;
  }
  function paintTntSide() {
    var r = R('tnt_side'), t = T(), x, y;
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      if (y >= 5 && y <= 10) continue;
      var m = x & 3, c;
      if (m === 0) c = r() < 0.18 ? '#ea4318' : '#db2f1a';
      else if (m === 1) c = r() < 0.5 ? '#db2f1a' : '#b11527';
      else if (m === 2) c = '#b11527';
      else c = '#912d11';
      if ((y === 4 || y === 11) && m !== 3 && r() < 0.5) c = '#912d11';
      px(t, x, y, C(c));
    }
    for (x = 0; x < 16; x++) {
      px(t, x, 5, C(r() < 0.35 ? '#ffffff' : '#ddd9d9'));
      for (y = 6; y <= 9; y++) px(t, x, y, C(r() < 0.55 ? '#ddd9d9' : '#cecece'));
      px(t, x, 10, C('#beb2b3'));
    }
    // "TNT": T = 3x4, N = 4x4 (22 letter pixels)
    function T3(x0) { hline(t, x0, x0 + 2, 6, C('#373656')); vline(t, x0 + 1, 7, 9, C('#373656')); px(t, x0 + 1, 9, C('#1b1a3c')); px(t, x0 + 2, 6, C('#1b1a3c')); }
    T3(2); T3(11);
    vline(t, 6, 6, 9, C('#373656')); vline(t, 9, 6, 9, C('#373656'));
    px(t, 7, 7, C('#373656')); px(t, 8, 8, C('#373656'));
    px(t, 6, 9, C('#1b1a3c')); px(t, 9, 9, C('#1b1a3c')); px(t, 9, 6, C('#1b1a3c')); px(t, 8, 8, C('#1b1a3c'));
    return t;
  }
  function tntCells(t, bright) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var i = x & 3, j = y & 3, c;
      if (j === 0) c = bright && (i === 1 || i === 2) ? '#ea4318' : '#db2f1a';
      else if (j === 3) c = '#912d11';
      else if (i === 0) c = '#b11527';
      else if (i === 3) c = '#912d11';
      else c = bright && i === 2 && j === 2 ? '#565656' : '#8e8e8e';
      px(t, x, y, C(c));
    }
  }
  function paintTntBottom() { var t = T(); tntCells(t, false); return t; }
  function paintTntTop() {
    var r = R('tnt_top'), t = T(), x, y;
    tntCells(t, true);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var dx = x + 0.5 - 8, dy = y + 0.5 - 8, d = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx);
      var ray = Math.pow(Math.max(0, Math.cos(a * 4 + 0.4)), 4) * 2.6 + Math.pow(Math.max(0, Math.cos(a * 4 + 1.2)), 8) * 1.4;
      var lim = 2.9 + ray + (r() - 0.5) * 1.3;
      if (d < lim && !(d > 2.4 && r() < 0.14)) px(t, x, y, C((d > lim - 0.8 && d > 3.3 && r() < 0.6) || (d > 1.2 && r() < 0.08) ? '#565656' : '#11111e'));
    }
    return t;
  }
  function paintBookshelf() {
    var r = R('bookshelf'), t = T(), x, y;
    var BOOKS = [
      ['#6b0c0c', '#911111', '#b31d1d'], ['#56230a', '#773007', '#94400f'], ['#46560a', '#5e720d', '#7a9112'], ['#1f2f6b', '#2d4491', '#3f5eb8'],
      ['#0d5448', '#137565', '#1c9c86'], ['#6e6614', '#968a1d', '#b8ab2b'], ['#4a4a4a', '#6e6e6e', '#8e8e8e'], ['#3f1f4a', '#5a2d6b', '#78409a']
    ];
    // frame
    for (x = 0; x < 16; x++) {
      px(t, x, 0, C(x % 5 === 3 ? '#b38c51' : '#bc9862')); px(t, x, 7, C(x % 4 === 1 ? '#bc9862' : '#b38c51'));
      px(t, x, 8, C(x % 3 === 0 ? '#9f844d' : '#9b7742')); px(t, x, 15, C(x % 4 === 2 ? '#7e6237' : '#9b7742'));
    }
    for (y = 1; y < 15; y++) if (y !== 7 && y !== 8) { px(t, 0, y, C('#b38c51')); px(t, 15, y, C(y % 3 ? '#9f844d' : '#9b7742')); }
    // back wall
    for (y = 1; y < 15; y++) for (x = 1; x < 15; x++) if (y !== 7 && y !== 8) px(t, x, y, C(y === 1 || y === 9 ? '#2c2213' : (x + y) % 3 ? '#362a15' : '#41311a'));
    [[1, 6], [9, 14]].forEach(function (sec, si) {
      var x0 = 1, last = -1;
      while (x0 < 15) {
        if (r() < 0.12 && x0 > 1 && x0 < 14) { x0++; continue; }
        var w = r() < 0.22 ? 3 : r() < 0.72 ? 2 : 1;
        if (x0 + w > 15) w = 15 - x0;
        var ci; do { ci = ri(r, 0, BOOKS.length - 1); } while (ci === last);
        last = ci;
        var bc = BOOKS[ci], h = 6 - (r() < 0.4 ? 1 : 0) - (r() < 0.2 ? 1 : 0), top = sec[1] - h + 1, band = r() < 0.5 ? top + 1 + ri(r, 0, 1) : -1;
        for (var bx = x0; bx < x0 + w; bx++) for (y = top; y <= sec[1]; y++) {
          var c = w === 1 ? bc[1] : bx === x0 ? bc[2] : bx === x0 + w - 1 ? bc[0] : bc[1];
          if (w === 1 && y === top) c = bc[2];
          if (y === band) c = w === 2 && bx === x0 ? '#d8c68c' : '#a89660';
          if (y === sec[1] && bx !== x0) c = bc[0];
          px(t, bx, y, C(c));
        }
        x0 += w;
      }
    });
    return t;
  }
  function paintCraftingTop() {
    var r = R('crafting_table_top'), t = T(), x, y;
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var d = Math.min(x, y, 15 - x, 15 - y), cx = Math.min(x, 15 - x), cy = Math.min(y, 15 - y);
      var c;
      if (cx <= 2 && cy <= 2) { // corner posts
        c = (cx === 0 || cy === 0) ? (cx + cy <= 1 ? '#0e0b06' : '#19140c') : (cx === 2 && cy === 2 ? '#41230e' : '#bc9862');
        if (cx === 2 && cy === 1 || cx === 1 && cy === 2) c = '#1a150d';
      } else if (d === 0) c = '#41230e';
      else if (d === 1) c = (x < 8 && y < 8) || y <= 1 || x <= 1 ? '#733920' : '#553824';
      else if (x >= 3 && x <= 12 && y >= 3 && y <= 12) {
        var gx = (x - 3) % 3, gy = (y - 3) % 3;
        if (x === 3 || x === 12 || y === 3 || y === 12) c = '#4b2b18';
        else if (gx === 0 || gy === 0) c = '#553824';
        else c = (gx === 1 && gy === 1) ? (r() < 0.8 ? '#ae693c' : '#bc7a45') : '#9e5932';
      } else c = r() < 0.75 ? '#ae693c' : '#9e5932';
      px(t, x, y, C(c));
    }
    return t;
  }
  function craftBase(seed) {
    var t = paintPlanks(seed, WOOD.oak, [12, 3, 10, 5]);
    for (var y = 0; y < 16; y++) { px(t, 0, y, C('#19140c')); px(t, 15, y, C('#19140c')); }
    for (var x = 5; x <= 10; x++) px(t, x, 0, C(x === 5 || x === 10 ? '#4b2b18' : '#382116'));
    for (y = 1; y < 16; y++) { px(t, 7, y, C(y % 5 === 0 ? '#4b2b18' : '#382116')); px(t, 8, y, C(y % 4 === 2 ? '#19140c' : '#4b2b18')); }
    return t;
  }
  function paintCraftingFront() {
    var t = craftBase('crafting_table_front');
    // hammer (left): handle + head
    vline(t, 3, 5, 10, C('#382116')); px(t, 3, 4, C('#19140c'));
    px(t, 2, 10, C('#d8d8d8')); px(t, 3, 10, C('#d8d8d8')); px(t, 4, 10, C('#a8a8a8')); px(t, 2, 11, C('#d8d8d8')); px(t, 3, 11, C('#a8a8a8'));
    // saw (right): handle + blade
    px(t, 11, 4, C('#19140c')); px(t, 12, 4, C('#382116')); px(t, 13, 4, C('#19140c')); px(t, 11, 5, C('#382116')); px(t, 13, 5, C('#382116')); px(t, 12, 5, C('#19140c'));
    for (var y = 6; y <= 13; y++) { px(t, 11, y, C('#d8d8d8')); if (y < 12) px(t, 12, y, C(y & 1 ? '#a8a8a8' : '#d8d8d8')); }
    px(t, 12, 6, C('#ffffff'));
    return t;
  }
  function paintCraftingSide() {
    var t = craftBase('crafting_table_side');
    // tongs / shears hanging on the left
    vline(t, 3, 4, 7, C('#382116')); vline(t, 5, 4, 7, C('#382116')); px(t, 4, 4, C('#19140c'));
    px(t, 3, 8, C('#d8d8d8')); px(t, 5, 8, C('#d8d8d8')); px(t, 4, 9, C('#a8a8a8')); px(t, 3, 9, C('#a8a8a8'));
    // small hook (right)
    px(t, 12, 4, C('#382116')); px(t, 12, 5, C('#382116')); px(t, 11, 6, C('#382116'));
    return t;
  }
  // furnace stones: bevelled rounded cobbles in gray furnace palette
  function furnaceStones(t, seed, y0, y1, n) {
    var r = R(seed), V = voronoi(scatter(r, n, 5.2)), x, y;
    function isS(xx, yy, o) { var k = ((yy & 15) << 4) | (xx & 15); return V.own[k] === o && V.d2[k] - V.d1[k] >= 1; }
    var cells = [], sc = [];
    for (y = y0; y <= y1; y++) for (x = 1; x < 15; x++) {
      var k = y * 16 + x, o = V.own[k];
      if (V.d2[k] - V.d1[k] < 1) { px(t, x, y, C(r() < 0.6 ? '#5d5b5b' : '#504e4e')); continue; }
      var s = (r() - 0.5) * 0.4;
      if (!isS(x, y - 1, o)) s += 1.1;
      if (!isS(x - 1, y, o)) s += 0.6;
      if (!isS(x, y + 1, o)) s -= 0.9;
      if (!isS(x + 1, y, o)) s -= 0.6;
      cells.push([x, y]); sc.push(s);
    }
    rankCells(t, cells, sc, pal('686868:30 777777:34 858585:36 919191:30'));
  }
  function furnaceFrame(t) {
    for (var i = 0; i < 16; i++) {
      px(t, i, 0, C('#504e4e')); px(t, i, 15, C('#3c3b3b')); px(t, 0, i, C(i === 15 ? '#3c3b3b' : '#504e4e')); px(t, 15, i, C('#3c3b3b'));
    }
  }
  function paintFurnaceTop() {
    var t = T();
    furnaceStones(t, 'furnace_top', 1, 14, 6);
    furnaceFrame(t);
    return t;
  }
  function paintFurnaceSide() {
    var t = T(), x;
    furnaceStones(t, 'furnace_side', 1, 9, 5);
    for (x = 1; x < 15; x++) {
      px(t, x, 10, C(x < 14 ? '#c5c5c5' : '#a8a8a8'));
      px(t, x, 11, C(x % 4 === 3 ? '#9d9d9d' : '#a8a8a8'));
      px(t, x, 12, C('#9d9d9d')); px(t, x, 13, C(x % 3 ? '#858585' : '#919191')); px(t, x, 14, C(x % 2 ? '#777777' : '#686868'));
    }
    px(t, 1, 11, C('#c5c5c5')); px(t, 1, 12, C('#a8a8a8'));
    furnaceFrame(t);
    return t;
  }
  function furnaceArch(t, rows) {  // rows: [y, x0, x1] of the black opening, top row first
    rows.forEach(function (rw, i) {
      for (var x = rw[1]; x <= rw[2]; x++) px(t, x, rw[0], C(i === 0 || x === rw[1] || x === rw[2] ? '#212121' : '#111111'));
      px(t, rw[1] - 1, rw[0], C('#504e4e')); px(t, rw[2] + 1, rw[0], C('#3c3b3b'));
      if (i > 0) {   // arch shoulders
        for (x = rw[1]; x < rows[i - 1][1]; x++) px(t, x, rows[i - 1][0], C('#504e4e'));
        for (x = rows[i - 1][2] + 1; x <= rw[2]; x++) px(t, x, rows[i - 1][0], C('#3c3b3b'));
      }
    });
    hline(t, rows[0][1], rows[0][2], rows[0][0] - 1, C('#504e4e'));
  }
  function paintFurnaceFront(lit) {
    var r = R(lit ? 'furnace_front_on' : 'furnace_front'), t = T(), x, y;
    for (y = 1; y < 15; y++) for (x = 1; x < 15; x++) {   // stone body, pillars shaded left->right
      var c = x === 1 ? '#a8a8a8' : x === 2 ? '#919191' : x === 13 ? '#777777' : x === 14 ? '#686868' : (r() < 0.55 ? '#858585' : '#777777');
      if (y === 1 && x < 14) c = x === 1 ? '#a8a8a8' : '#919191';
      px(t, x, y, C(c));
    }
    furnaceArch(t, [[3, 5, 10], [4, 4, 11], [5, 3, 12], [6, 3, 12]]);
    for (x = 3; x <= 12; x++) px(t, x, 7, C(x === 3 ? '#919191' : x === 12 ? '#858585' : '#a8a8a8'));   // lip
    for (x = 1; x <= 14; x++) { px(t, x, 8, C(x === 14 ? '#a8a8a8' : '#c5c5c5')); px(t, x, 9, C(x === 1 ? '#c5c5c5' : x === 14 ? '#919191' : '#a8a8a8')); }
    furnaceArch(t, [[11, 5, 10], [12, 4, 11], [13, 3, 12], [14, 3, 12]]);
    if (lit) {
      var FL = { o: '#ff8f00', y: '#ffd800', p: '#ffff97', w: '#ffffff', r: '#fe6d00', d: '#b33c00' };
      var hts = [0, 0, 0, 1, 2, 3, 2, 4, 3, 2, 3, 1, 0];
      for (x = 3; x <= 12; x++) {
        var h = hts[x] + 1;
        for (y = 14; y >= 14 - h && y >= 11; y--) {
          var hg = 14 - y, cx = Math.abs(x - 7.5), cc;
          if (hg === h) cc = r() < 0.5 ? FL.r : FL.d;
          else if (hg === 0) cc = cx < 1 ? FL.w : cx < 2.5 ? FL.p : cx < 4 ? FL.y : FL.o;
          else if (hg === 1) cc = cx < 1.5 ? FL.p : cx < 3 ? FL.y : FL.o;
          else cc = cx < 2 ? FL.y : FL.o;
          px(t, x, y, C(cc));
        }
      }
    }
    furnaceFrame(t);
    return t;
  }
  function paintTorch() {
    var t = T();
    for (var y = 8; y < 16; y++) {
      px(t, 7, y, C(y === 8 ? '#957546' : y >= 14 ? '#55452e' : '#9f7f50'));
      px(t, 8, y, C(y >= 14 ? (y === 15 ? '#3d301d' : '#423522') : y === 8 ? '#55452e' : '#6d5736'));
    }
    px(t, 7, 11, C('#957546'));
    px(t, 7, 6, C('#ffd800')); px(t, 8, 6, C('#ff8f00')); px(t, 7, 7, C('#ffffff')); px(t, 8, 7, C('#ffff97'));
    return bleed(t);
  }
  function paintLadder() {
    var r = R('ladder'), t = T(), x, y;
    for (y = 0; y < 16; y++) {
      px(t, 1, y, C(r() < 0.6 ? '#7e6237' : '#967441')); px(t, 2, y, C('#67502c'));
      px(t, 13, y, C(r() < 0.6 ? '#7e6237' : '#967441')); px(t, 14, y, C('#67502c'));
    }
    [1, 5, 9, 13].forEach(function (ry) {
      for (x = 3; x <= 12; x++) {
        px(t, x, ry, C(r() < 0.85 ? '#b58d50' : '#967441'));
        px(t, x, ry + 1, C(x === 3 || x === 12 ? '#3a2f1e' : r() < 0.72 ? '#513d24' : '#67502c'));
      }
      px(t, 2, ry, C('#967441')); px(t, 14, ry + 1, C('#3a2f1e'));
    });
    return bleed(t);
  }
  function doorPanels(t, r, panels) {
    var W = WOOD.oak;
    panels.forEach(function (p) {
      var x0 = p[0], y0 = p[1], x1 = p[2], y1 = p[3];
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
        var c;
        if (y === y0 || x === x0) c = y === y0 && x === x0 ? '#513d24' : '#67502c';   // recessed: shadow on top/left
        else if (y === y1 || x === x1) c = '#b58d50';                                    // lit bottom/right lip
        else c = r() < 0.55 ? '#7e6237' : '#967441';
        px(t, x, y, C(c));
      }
    });
  }
  function paintDoor(top) {
    var r = R(top ? 'oak_door_top' : 'oak_door_bottom'), t = T(), x, y;
    var f = field(r, [[16, 2, 1], [16, 8, 0.5]], 0.35);   // vertical grain
    rankPaint(t, f, pal('7e6237:10 967441:60 a6824d:30 b58d50:12'));
    for (y = 0; y < 16; y++) { px(t, 0, y, C(y % 5 === 0 ? '#b8945f' : '#a6824d')); px(t, 15, y, C(y % 4 === 1 ? '#513d24' : '#67502c')); }
    if (top) { for (x = 0; x < 16; x++) px(t, x, 0, C(x < 15 ? '#b8945f' : '#a6824d')); }
    else { for (x = 0; x < 16; x++) px(t, x, 15, C(x % 3 ? '#513d24' : '#67502c')); }
    doorPanels(t, r, top ? [[2, 2, 6, 6], [9, 2, 13, 6], [2, 9, 6, 13], [9, 9, 13, 13]] : [[2, 2, 6, 6], [9, 2, 13, 6], [2, 9, 6, 13], [9, 9, 13, 13]]);
    if (top) { px(t, 12, 15, C('#808b95')); px(t, 13, 15, C('#6b6f7a')); px(t, 12, 14, C('#808b95')); }
    else { px(t, 12, 0, C('#808b95')); px(t, 13, 0, C('#6b6f7a')); px(t, 12, 1, C('#6b6f7a')); }
    return t;
  }

  /* ---------------------------------------------------------------- chest */
  var CH = { o: '#261709', dk: '#4e3014', d: '#6b4219', m2: '#80521f', m: '#9a652d', l: '#b27a3b', hi: '#c48c48' };
  function chestPlanks(t, r, x0, y0, x1, y1) {
    var f = field(r, [[2, 16, 1], [8, 16, 0.4]], 0.3), mask = new Uint8Array(N);
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) { mask[y * 16 + x] = 1; if ((y - y0) % 4 === 3) f[y * 16 + x] -= 0.6; }
    rankPaint(t, f, pal(CH.d.slice(1) + ':8 ' + CH.m2.slice(1) + ':22 ' + CH.m.slice(1) + ':40 ' + CH.l.slice(1) + ':22 ' + CH.hi.slice(1) + ':8'), mask);
  }
  function chestFace(seed, front) {
    var r = R(seed), t = T(), x, y;
    fillT(t, C(CH.o));
    chestPlanks(t, r, 2, 3, 13, 5);
    chestPlanks(t, r, 2, 8, 13, 14);
    for (x = 1; x <= 14; x++) { px(t, x, 2, C(CH.dk)); px(t, x, 6, C(CH.dk)); px(t, x, 7, C(CH.o)); px(t, x, 15, C(CH.dk)); }
    for (y = 2; y <= 15; y++) { px(t, 1, y, C(y === 7 ? CH.o : CH.dk)); px(t, 14, y, C(y === 7 ? CH.o : CH.dk)); }
    for (x = 2; x <= 13; x++) { px(t, x, 3, C(x % 5 === 1 ? CH.l : CH.hi)); px(t, x, 8, C(x % 4 === 2 ? CH.l : CH.hi)); }
    for (y = 3; y <= 14; y++) if (y !== 6 && y !== 7) px(t, 2, y, C(CH.l));
    if (front) {
      // iron latch (2x4) crossing the lid seam
      var L = [['#e8e8e8', '#b9b9b9'], ['#c7c7c7', '#8d8d8d'], ['#a3a3a3', '#6d6d6d'], ['#7d7d7d', '#4b4b4b']];
      for (y = 0; y < 4; y++) { px(t, 7, 5 + y, C(L[y][0])); px(t, 8, 5 + y, C(L[y][1])); }
      vline(t, 6, 5, 8, C('#1c1c1c')); vline(t, 9, 5, 8, C('#1c1c1c')); hline(t, 7, 8, 9, C('#1c1c1c'));
    }
    return t;
  }
  function paintChestTop() {
    var r = R('chest_top'), t = T(), x, y;
    fillT(t, C(CH.o));
    chestPlanks(t, r, 2, 2, 13, 13);
    for (x = 1; x <= 14; x++) { px(t, x, 1, C(CH.dk)); px(t, x, 14, C(CH.dk)); }
    for (y = 1; y <= 14; y++) { px(t, 1, y, C(CH.dk)); px(t, 14, y, C(CH.dk)); }
    for (x = 2; x <= 13; x++) px(t, x, 2, C(x % 5 === 1 ? CH.l : CH.hi));
    for (y = 2; y <= 13; y++) px(t, 2, y, C(CH.l));
    return t;
  }

  /* ------------------------------------------------------------------ bed */
  var BED_RED = ['#721a18', '#8a1f1d', '#992421', '#a12723', '#ac2c24', '#b8342c'];
  var BED_W = ['#c4c8c8', '#d9dcdc', '#eceeee', '#fefefe'];
  function bedWood(t, r, y0, y1) {
    var W = WOOD.oak;
    for (var y = y0; y <= y1; y++) for (var x = 0; x < 16; x++) {
      var c = y === y0 ? (r() < 0.7 ? W.A : W.D) : y === y1 ? (r() < 0.6 ? W.E : W.F) : (r() < 0.5 ? W.B : r() < 0.6 ? W.C : W.G);
      px(t, x, y, C(c));
    }
  }
  function redCloth(t, r, x0, y0, x1, y1, lift) {
    var f = field(r, [[4, 4, 0.6], [16, 16, 0.5]], 0.4);
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var v = f[y * 16 + x] + (lift || 0);
      px(t, x, y, C(BED_RED[clamp(Math.floor(v * 3.2), 1, 5)]));
    }
  }
  function paintBedTop(head) {
    var r = R(head ? 'bed_top_head' : 'bed_top_foot'), t = T(), x, y;
    if (head) {
      // sheet + pillow
      for (y = 0; y <= 6; y++) for (x = 0; x < 16; x++) px(t, x, y, C(BED_W[r() < 0.5 ? 1 : 2]));
      for (y = 1; y <= 5; y++) for (x = 2; x <= 13; x++) {
        var c = BED_W[3];
        if (y === 5 || x === 13) c = BED_W[1];
        else if (y === 1 || x === 2) c = BED_W[3];
        else c = r() < 0.75 ? BED_W[3] : BED_W[2];
        px(t, x, y, C(c));
      }
      hline(t, 3, 13, 6, C(BED_W[0]));
      redCloth(t, r, 0, 7, 15, 15, 0.1);
      for (x = 0; x < 16; x++) px(t, x, 7, C(x % 3 ? BED_RED[5] : BED_RED[4]));   // folded blanket edge
      for (x = 0; x < 16; x++) px(t, x, 8, C(BED_RED[1]));
    } else {
      redCloth(t, r, 0, 0, 15, 15, 0.1);
      for (x = 0; x < 16; x++) px(t, x, 15, C(BED_RED[1]));
    }
    for (y = head ? 7 : 0; y < 16; y++) { px(t, 0, y, C(BED_RED[2])); px(t, 15, y, C(BED_RED[1])); }
    return t;
  }
  // side/end faces: the engine samples rows 7..12 (box y 3..9); keep the whole tile meaningful anyway
  function paintBedSide(seed, headEnd) {
    var r = R(seed), t = T(), x, y;
    if (headEnd) {
      for (y = 0; y <= 9; y++) for (x = 0; x < 16; x++) px(t, x, y, C(BED_W[y === 9 ? 0 : r() < 0.6 ? 2 : 1]));
      for (x = 0; x < 16; x++) px(t, x, 7, C(BED_W[3]));
    } else {
      redCloth(t, r, 0, 0, 15, 9, 0.15);
      for (x = 0; x < 16; x++) { px(t, x, 7, C(x % 4 === 1 ? BED_RED[4] : BED_RED[5])); px(t, x, 9, C(BED_RED[0])); }
    }
    bedWood(t, r, 10, 12);
    for (y = 13; y < 16; y++) for (x = 0; x < 16; x++) px(t, x, y, C(x < 3 || x > 12 ? (x === 0 || x === 13 ? '#7e6237' : '#67502c') : '#4c3d26'));
    return t;
  }
  function paintBedBottom() {
    var t = paintPlanks('bed_bottom', WOOD.oak, [9, 2, 12, 5]);
    for (var i = 0; i < N * 4; i += 4) { t[i] *= 0.82; t[i + 1] *= 0.82; t[i + 2] *= 0.82; }
    return t;
  }

  /* ------------------------------------------------------- destroy stages */
  // Crack web growing out of the centre: main rays -> side branches -> twigs -> connecting arcs.
  // Every pixel gets a "time"; stage k shows the earliest n_k pixels, so each stage strictly contains the previous one.
  function crackSequence() {
    var r = R('destroy_cracks'), time = new Float32Array(N).fill(1e9);
    function put(x, y, tm) {
      var ix = Math.round(x - 0.5), iy = Math.round(y - 0.5);
      if (ix < 0 || iy < 0 || ix > 15 || iy > 15) return false;
      var k = iy * 16 + ix;
      if (tm < time[k]) time[k] = tm;
      return true;
    }
    function walk(x, y, ang, len, t0, speed, wob, onStep) {
      for (var i = 1; i <= len; i++) {
        x += Math.cos(ang); y += Math.sin(ang);
        ang += (r() - 0.5) * wob;
        if (!put(x, y, t0 + i * speed)) return;
        if (onStep) onStep(x, y, ang, t0 + i * speed, i);
      }
    }
    put(7.5, 7.5, 0); put(8.5, 8.5, 0.4);
    var nr = 5, a0 = r() * Math.PI * 2, rays = [];
    for (var i = 0; i < nr; i++) {
      var ang = a0 + i * Math.PI * 2 / nr + (r() - 0.5) * 0.7;
      rays.push(ang);
      walk(8 + Math.cos(ang) * 0.6, 8 + Math.sin(ang) * 0.6, ang, 12, 0.6 + i * 1.1, 1.0, 0.75, function (x, y, a, tm, step) {
        if ((step === 3 || step === 6 || step === 9) && r() < 0.75) {
          var side = r() < 0.5 ? -1 : 1;
          walk(x, y, a + side * (0.7 + r() * 0.5), ri(r, 3, 6), tm + 1.5, 1.25, 0.5, function (x2, y2, a2, tm2, st2) {
            if (st2 === 2 && r() < 0.5) walk(x2, y2, a2 - side * (0.8 + r() * 0.4), ri(r, 2, 3), tm2 + 1.2, 1.3, 0.3);
          });
        }
      });
    }
    // arcs between neighbouring rays (later stages -> closed cells)
    [4.6, 7.2].forEach(function (rad, ri2) {
      for (var j = 0; j < nr; j++) {
        if (r() < 0.35) continue;
        var s = rays[j], e = rays[(j + 1) % nr];
        if (e < s) e += Math.PI * 2;
        var steps = Math.ceil((e - s) * rad);
        var start = r() * 0.3, stop = 0.7 + r() * 0.3;
        for (var q = Math.floor(steps * start); q <= steps * stop; q++) {
          var aa = s + (e - s) * q / steps, rr = rad + (r() - 0.5) * 0.9;
          put(8 + Math.cos(aa) * rr, 8 + Math.sin(aa) * rr, rad * 1.5 + 5 + ri2 * 3 + q * 0.35);
        }
      }
    });
    var seq = [];
    for (var k = 0; k < N; k++) if (time[k] < 1e8) seq.push(k);
    seq.sort(function (a, b) { return time[a] - time[b] || a - b; });
    return seq.map(function (k) { return [k & 15, k >> 4]; });
  }
  var CRACKS = crackSequence();
  function paintDestroy(stage) {
    var t = T(), n = [2, 6, 11, 16, 23, 31, 40, 56, 73, 83][stage], dark = new Uint8Array(N), i;
    n = Math.min(n, CRACKS.length);
    for (i = 0; i < n; i++) dark[CRACKS[i][1] * 16 + CRACKS[i][0]] = 1;
    for (i = 0; i < n; i++) {
      var x = CRACKS[i][0], y = CRACKS[i][1];
      if (y < 15 && !dark[(y + 1) * 16 + x] && (i % 4 !== 3)) px(t, x, y + 1, [255, 255, 255, 56]);
      else if (x < 15 && !dark[y * 16 + x + 1] && (i % 4 !== 3)) px(t, x + 1, y, [255, 255, 255, 56]);
    }
    for (i = 0; i < n; i++) px(t, CRACKS[i][0], CRACKS[i][1], [28, 28, 28, 200]);
    return bleed(t);
  }

  /* =========================================================================
   * NAMES + GENERATION
   * =======================================================================*/
  var NAMES = ('stone granite diorite andesite dirt grass_block_top grass_block_side grass_block_side_overlay grass_block_snow podzol_top podzol_side ' +
    'gravel sand sandstone sandstone_top sandstone_bottom clay snow ice bedrock obsidian cobblestone mossy_cobblestone stone_bricks bricks smooth_stone ' +
    'smooth_stone_slab_side coal_ore iron_ore gold_ore diamond_ore redstone_ore lapis_ore emerald_ore ' +
    'water_still water_flow lava_still lava_flow ' +
    'oak_planks spruce_planks birch_planks oak_log oak_log_top spruce_log spruce_log_top birch_log birch_log_top oak_leaves spruce_leaves birch_leaves ' +
    'oak_sapling spruce_sapling birch_sapling short_grass fern dandelion poppy blue_orchid allium azure_bluet red_tulip oxeye_daisy cornflower ' +
    'brown_mushroom red_mushroom dead_bush lily_pad sugar_cane cactus_top cactus_side cactus_bottom pumpkin_top pumpkin_side carved_pumpkin jack_o_lantern ' +
    'melon_side melon_top wheat_stage0 wheat_stage1 wheat_stage2 wheat_stage3 wheat_stage4 wheat_stage5 wheat_stage6 wheat_stage7 farmland farmland_moist ' +
    'hay_block_side hay_block_top glass glass_pane_top ' +
    'white_wool orange_wool magenta_wool light_blue_wool yellow_wool lime_wool pink_wool gray_wool light_gray_wool cyan_wool purple_wool blue_wool ' +
    'brown_wool green_wool red_wool black_wool iron_block gold_block diamond_block emerald_block lapis_block coal_block redstone_block glowstone ' +
    'tnt_side tnt_top tnt_bottom bookshelf crafting_table_top crafting_table_front crafting_table_side furnace_front furnace_front_on furnace_side ' +
    'furnace_top torch ladder oak_door_top oak_door_bottom ' +
    'chest_top chest_side chest_front ' +
    'bed_top_head bed_top_foot bed_side_head bed_side_foot bed_end_head bed_end_foot bed_bottom ' +
    'destroy_stage_0 destroy_stage_1 destroy_stage_2 destroy_stage_3 destroy_stage_4 destroy_stage_5 destroy_stage_6 destroy_stage_7 destroy_stage_8 destroy_stage_9').split(' ');

  function anim(name, frameTime, frames) { animated[name] = { frameTime: frameTime, frames: frames }; tiles[name] = frames[0]; }

  function build() {
    var P = pal;
    // terrain
    tiles.stone = paintStone('stone');
    tiles.granite = paintNoise('granite', [[4, 4, 0.5], [8, 8, 1.0], [16, 16, 0.75]], 0.3, byLum(P('9f6b58:88 7f5646:49 a97764:43 926251:40 5f4034:14 b49b91:7 4d352c:5 b48877:5 c99781:3 e3c0af:2')));
    tiles.diorite = paintNoise('diorite', [[4, 4, 1.0], [8, 8, 0.8], [16, 16, 0.4]], 0.25, P('7b7b7b:8 8b8b8b:35 a4a2a2:59 bebfc1:50 cececf:35 e9e9e9:69'));
    tiles.andesite = paintNoise('andesite', [[4, 8, 0.8], [8, 8, 0.8], [16, 16, 0.55]], 0.35, P('686868:11 747474:37 7f7f7f:55 8a8a8e:89 9c9c9c:50 a8aa9a:14'));
    tiles.dirt = paintDirt();
    tiles.grass_block_top = paintGrassTop();
    tiles.grass_block_side = paintGrassSide();
    tiles.grass_block_side_overlay = paintGrassOverlay();
    tiles.grass_block_snow = paintGrassSnow();
    tiles.podzol_top = paintPodzolTop();
    tiles.podzol_side = paintPodzolSide();
    tiles.gravel = paintGravel();
    tiles.sand = paintNoise('sand', [[4, 4, 0.4], [8, 8, 1.0], [16, 16, 0.9]], 0.3, P('d1ba8a:10 d5c496:67 dacfa3:108 e3dbb0:58 e7e4bb:8 edebcb:5'));
    tiles.sandstone = paintSandstone();
    tiles.sandstone_top = paintNoise('sandstone_top', [[4, 4, 0.8], [8, 8, 1.0], [16, 16, 0.5]], 0.25, P('d5c496:10 dacfa3:41 dfd4a7:84 e3dbb0:112 e7e4bb:9'));
    tiles.sandstone_bottom = paintSandstoneBottom();
    tiles.clay = paintNoise('clay', [[4, 4, 0.4], [8, 8, 1.0], [16, 16, 0.7]], 0.3, byLum(P('9499a4:14 9ca1ac:42 9aa3b3:48 a1a7b1:96 acaebd:46 afb9d6:10')));
    tiles.snow = paintNoise('snow', [[4, 4, 0.8], [8, 8, 1.0], [16, 16, 0.4]], 0.3, P('f0fdfd:61 f7fefe:77 ffffff:118'));
    tiles.ice = paintIce();
    tiles.bedrock = paintNoise('bedrock', [[4, 16, 0.6], [8, 16, 0.9], [16, 16, 0.6]], 0.5, P('222222:18 333333:88 575757:59 636363:42 979797:49'));
    tiles.obsidian = paintObsidian();
    tiles.cobblestone = paintCobble();
    tiles.mossy_cobblestone = paintMossyCobble();
    tiles.stone_bricks = paintStoneBricks();
    tiles.bricks = paintBricks();
    tiles.smooth_stone = paintSmoothStone();
    tiles.smooth_stone_slab_side = paintSmoothSlabSide();
    ['coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore'].forEach(function (n) { tiles[n] = paintOre(n); });
    // liquids
    anim('water_still', 2, waterFrames('water_still', 32, false));
    anim('water_flow', 2, waterFrames('water_flow', 32, true));
    anim('lava_still', 4, lavaFrames('lava_still', 24, false));
    anim('lava_flow', 3, lavaFrames('lava_flow', 24, true));
    // wood
    tiles.oak_planks = paintPlanks('oak_planks', WOOD.oak);
    tiles.spruce_planks = paintPlanks('spruce_planks', WOOD.spruce);
    tiles.birch_planks = paintPlanks('birch_planks', WOOD.birch);
    tiles.oak_log = paintLogSide(P('382b18:19 4c3d26:37 5f4a2b:38 745a36:108 917142:42 987849:12'));
    tiles.oak_log_top = paintLogTop('oak_log_top', WOOD.oak, P('4c3d26:16 5f4a2b:40 745a36:4'));
    tiles.spruce_log = paintLogSide(P('2e1608:19 2e1c0a:37 311e0b:38 3b2713:108 4d3317:42 553a1f:12'));
    tiles.spruce_log_top = paintLogTop('spruce_log_top', WOOD.spruce, P('443321:16 553a1f:40 5a4424:4'));
    tiles.birch_log = paintBirchLog();
    tiles.birch_log_top = paintBirchLogTop();
    tiles.oak_leaves = paintLeaves('oak_leaves', 84, P('686468:34 777577:36 989998:57 b9bcb9:45'), { n: 34, minD: 2.2, r0: 1.3, r1: 0.8, hn: 0.3, gn: 0.35, edge: 0.3 });
    tiles.spruce_leaves = paintLeaves('spruce_leaves', 96, P('424242:22 4f4f4f:8 555555:16 8a8a8a:48 989898:28 9a9a9a:38'), { n: 42, minD: 2.0, r0: 1.1, r1: 0.6, hn: 0.25, gn: 0.3, edge: 0.45 });
    tiles.birch_leaves = paintLeaves('birch_leaves', 112, P('706d70:66 888787:43 989998:27 b7b9b7:8'), { n: 30, minD: 2.3, r0: 1.3, r1: 0.7, hn: 0.35, gn: 0.35, edge: 0.3 });
    // plants
    tiles.oak_sapling = paintOakSapling();
    tiles.spruce_sapling = paintSpruceSapling();
    tiles.birch_sapling = paintBirchSapling();
    tiles.short_grass = paintShortGrass();
    tiles.fern = paintFern();
    tiles.dandelion = paintDandelion();
    tiles.poppy = paintPoppy();
    tiles.blue_orchid = paintBlueOrchid();
    tiles.allium = paintAllium();
    tiles.azure_bluet = paintAzureBluet();
    tiles.red_tulip = paintRedTulip();
    tiles.oxeye_daisy = paintOxeyeDaisy();
    tiles.cornflower = paintCornflower();
    tiles.brown_mushroom = paintBrownMushroom();
    tiles.red_mushroom = paintRedMushroom();
    tiles.dead_bush = paintDeadBush();
    tiles.lily_pad = paintLilyPad();
    tiles.sugar_cane = paintSugarCane();
    tiles.cactus_top = paintCactusTop();
    tiles.cactus_side = paintCactusSide();
    tiles.cactus_bottom = paintCactusBottom();
    tiles.pumpkin_top = paintPumpkinTop();
    tiles.pumpkin_side = paintPumpkinSide();
    tiles.carved_pumpkin = paintCarved(false);
    tiles.jack_o_lantern = paintCarved(true);
    tiles.melon_side = paintMelonSide();
    tiles.melon_top = paintMelonTop();
    for (var s = 0; s < 8; s++) tiles['wheat_stage' + s] = paintWheat(s);
    tiles.farmland = paintFarmland('farmland', P('593d29:31 79553a:63 966c4a:95 b9855c:63'));
    tiles.farmland_moist = paintFarmland('farmland', P('341907:31 3f210a:63 552e0f:94 6e3c15:64'));
    tiles.hay_block_side = paintHaySide();
    tiles.hay_block_top = paintNoise('hay_block_top', [[8, 8, 0.8], [16, 16, 1.0]], 0.35, P('8b7110:36 947d10:68 ac8d08:95 bda510:38 cdb208:19'));
    tiles.glass = paintGlass();
    tiles.glass_pane_top = paintPaneTop();
    // crafted
    Object.keys(WOOL_C).forEach(function (w) { tiles[w + '_wool'] = paintWool(w); });
    tiles.iron_block = paintIronBlock();
    tiles.gold_block = paintGem('gold_block', ['#cc8e27', '#d39632', '#f9bd23', '#f5cc27', '#ffd83e', '#fee048', '#ffec4f', '#fffd90', '#feffbd']);
    tiles.diamond_block = paintGem('diamond_block', ['#0ebabd', '#15c2c6', '#3de0e5', '#4bede6', '#65f5e3', '#70fbf0', '#9efeeb', '#d5fff6', '#ffffff']);
    tiles.emerald_block = paintEmeraldBlock();
    tiles.lapis_block = paintNoise('lapis_block', [[4, 4, 0.6], [8, 8, 1.0], [16, 16, 0.6]], 0.3, byLum(P('143271:7 193584:13 1b3588:16 1c3890:51 1e407c:6 1e4285:61 204a8a:53 20509c:20 2659ab:14 2b568d:5')));
    tiles.coal_block = paintNoise('coal_block', [[4, 8, 0.8], [8, 8, 0.8], [16, 16, 0.5]], 0.3, P('050505:71 0d0d0d:56 151515:102 1f1e1e:23 292828:4'));
    tiles.redstone_block = paintRedstoneBlock();
    tiles.glowstone = paintGlowstone();
    tiles.tnt_side = paintTntSide();
    tiles.tnt_top = paintTntTop();
    tiles.tnt_bottom = paintTntBottom();
    tiles.bookshelf = paintBookshelf();
    tiles.crafting_table_top = paintCraftingTop();
    tiles.crafting_table_front = paintCraftingFront();
    tiles.crafting_table_side = paintCraftingSide();
    tiles.furnace_front = paintFurnaceFront(false);
    tiles.furnace_front_on = paintFurnaceFront(true);
    tiles.furnace_side = paintFurnaceSide();
    tiles.furnace_top = paintFurnaceTop();
    tiles.torch = paintTorch();
    tiles.ladder = paintLadder();
    tiles.oak_door_top = paintDoor(true);
    tiles.oak_door_bottom = paintDoor(false);
    tiles.chest_top = paintChestTop();
    tiles.chest_side = chestFace('chest_side', false);
    tiles.chest_front = chestFace('chest_front', true);
    tiles.bed_top_head = paintBedTop(true);
    tiles.bed_top_foot = paintBedTop(false);
    tiles.bed_side_head = paintBedSide('bed_side_head', false);
    tiles.bed_side_foot = paintBedSide('bed_side_foot', false);
    tiles.bed_end_head = paintBedSide('bed_end_head', true);
    tiles.bed_end_foot = paintBedSide('bed_end_foot', false);
    tiles.bed_bottom = paintBedBottom();
    for (var d = 0; d < 10; d++) tiles['destroy_stage_' + d] = paintDestroy(d);
  }

  build();

  // biome-tinted tiles must be exactly neutral (R=G=B); the engine multiplies them by the biome colour
  function neutral(t) { for (var i = 0; i < N * 4; i += 4) { var v = Math.round((t[i] + t[i + 1] + t[i + 2]) / 3); t[i] = v; t[i + 1] = v; t[i + 2] = v; } }
  ['grass_block_top', 'grass_block_side_overlay', 'short_grass', 'fern', 'sugar_cane', 'oak_leaves', 'spruce_leaves', 'birch_leaves', 'lily_pad'].forEach(function (n) { neutral(tiles[n]); });
  ['water_still', 'water_flow'].forEach(function (n) { animated[n].frames.forEach(neutral); });

  var out = {};
  for (var i = 0; i < NAMES.length; i++) {
    var nm = NAMES[i];
    if (!tiles[nm]) { var ph = T(); fillT(ph, C('#ff00ff')); tiles[nm] = ph; }  // safety net (should never trigger)
    out[nm] = tiles[nm];
  }

  G.TexBlocks = { size: S, names: NAMES.slice(), tiles: out, animated: animated };
})(typeof window !== 'undefined' ? window : globalThis);
