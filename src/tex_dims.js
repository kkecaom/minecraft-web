/* tex_dims.js - procedural textures of the dimensions update: Nether, End, village blocks and their items.
 * Extends TexBlocks (names / tiles / animated) and TexItems in place. Deterministic, DOM free; load after tex_extra.js.
 * Same toolbox as tex_blocks.js: seeded tileable value noise ranked into vanilla-like palettes, plus hand-placed structure. */
(function (G) {
  'use strict';
  var TB = G.TexBlocks, TI = G.TexItems;
  if (!TB) return;
  var N = 256;
  function hashStr(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15; return h >>> 0; }
  function mulberry32(a) { return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function R(name) { return mulberry32(hashStr(name)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function C(h) { var s = h.charAt(0) === '#' ? h.slice(1) : h, v = parseInt(s.slice(0, 6), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255, s.length > 6 ? parseInt(s.slice(6, 8), 16) : 255]; }
  function pal(str) { return str.trim().split(/\s+/).map(function (tok) { var p = tok.split(':'); return [C(p[0]), p.length > 1 ? +p[1] : 1]; }); }
  function T() { return new Uint8ClampedArray(N * 4); }
  function px(t, x, y, c, a) { if (x < 0 || y < 0 || x > 15 || y > 15) return; var i = (y * 16 + x) * 4; t[i] = c[0]; t[i + 1] = c[1]; t[i + 2] = c[2]; t[i + 3] = a === undefined ? (c[3] === undefined ? 255 : c[3]) : a; }
  function getc(t, x, y) { var i = (((y & 15) << 4) | (x & 15)) << 2; return [t[i], t[i + 1], t[i + 2], t[i + 3]]; }
  function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, 255]; }
  function shade(c, k) { return [clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255), c[3] === undefined ? 255 : c[3]]; }
  function rect(t, x0, y0, x1, y1, c) { for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) px(t, x, y, c); }
  function line(t, x0, y0, x1, y1, c) { var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, err = dx + dy; for (;;) { px(t, x0, y0, c); if (x0 === x1 && y0 === y1) break; var e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } } }
  function clone(t) { return new Uint8ClampedArray(t); }
  // periodic value noise
  function vnoise(r, nx, ny) {
    var g = new Float32Array(nx * ny), out = new Float32Array(N), x, y; for (var i = 0; i < g.length; i++) g[i] = r();
    for (y = 0; y < 16; y++) { var fy = (y + 0.5) * ny / 16 - 0.5, y0 = Math.floor(fy), ty = fy - y0; ty = ty * ty * (3 - 2 * ty); var ya = ((y0 % ny) + ny) % ny, yb = (ya + 1) % ny;
      for (x = 0; x < 16; x++) { var fx = (x + 0.5) * nx / 16 - 0.5, x0 = Math.floor(fx), tx = fx - x0; tx = tx * tx * (3 - 2 * tx); var xa = ((x0 % nx) + nx) % nx, xb = (xa + 1) % nx;
        var a = g[ya * nx + xa] + (g[ya * nx + xb] - g[ya * nx + xa]) * tx, b = g[yb * nx + xa] + (g[yb * nx + xb] - g[yb * nx + xa]) * tx; out[y * 16 + x] = a + (b - a) * ty; } }
    return out;
  }
  function field(r, octs, white) { var f = new Float32Array(N), i, k; for (k = 0; k < octs.length; k++) { var o = octs[k], n = vnoise(r, o[0], o[1]); for (i = 0; i < N; i++) f[i] += n[i] * o[2]; } if (white) for (i = 0; i < N; i++) f[i] += (r() - 0.5) * white; return f; }
  function rankIdx(f, counts, mask) {
    var list = [], i; for (i = 0; i < N; i++) if (!mask || mask[i]) list.push(i);
    list.sort(function (a, b) { return f[a] - f[b] || a - b; });
    var total = 0; for (i = 0; i < counts.length; i++) total += counts[i];
    var out = new Int16Array(N).fill(-1), acc = 0, k = 0;
    for (var p = 0; p < counts.length; p++) { acc += counts[p]; var end = Math.round(acc / total * list.length); for (; k < end; k++) out[list[k]] = p; }
    return out;
  }
  function rankPaint(t, f, P, mask, alphaV) { var ix = rankIdx(f, P.map(function (e) { return e[1]; }), mask); for (var i = 0; i < N; i++) if (ix[i] >= 0) px(t, i & 15, i >> 4, P[ix[i]][0], alphaV); return ix; }
  function noiseTile(seed, octs, white, P) { var t = T(); rankPaint(t, field(R(seed), octs, white), P); return t; }
  function wrapD(a, b) { var d = Math.abs(a - b) % 16; return d > 8 ? 16 - d : d; }
  function scatter(r, n, minD) { var pts = [], tries = 0; while (pts.length < n && tries++ < 4000) { var p = [r() * 16, r() * 16], ok = true; for (var i = 0; i < pts.length; i++) { var dx = wrapD(p[0], pts[i][0]), dy = wrapD(p[1], pts[i][1]); if (dx * dx + dy * dy < minD * minD) { ok = false; break; } } if (ok) pts.push(p); } return pts; }
  function voronoi(pts) {
    var own = new Int16Array(N), d1 = new Float32Array(N), d2 = new Float32Array(N);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { var b1 = 1e9, b2 = 1e9, o = -1; for (var i = 0; i < pts.length; i++) { var dx = wrapD(x + 0.5, pts[i][0]), dy = wrapD(y + 0.5, pts[i][1]), d = Math.sqrt(dx * dx + dy * dy); if (d < b1) { b2 = b1; b1 = d; o = i; } else if (d < b2) b2 = d; } own[y * 16 + x] = o; d1[y * 16 + x] = b1; d2[y * 16 + x] = b2; }
    return { own: own, d1: d1, d2: d2, pts: pts };
  }
  function add(name, tile) { if (TB.tiles[name]) return; TB.names.push(name); TB.tiles[name] = tile; }
  function addAnim(name, frameTime, frames) { if (TB.tiles[name]) return; TB.names.push(name); TB.tiles[name] = frames[0]; TB.animated[name] = { frameTime: frameTime, frames: frames }; }
  function addItem(name, tile) { if (!TI || !TI.tiles || TI.tiles[name]) return; TI.names.push(name); TI.tiles[name] = tile; }
  // planks in the vanilla layout: four boards, seams at y 3/7/11/15, staggered butt joints
  function planks(seed, P, seam) {
    var r = R(seed), t = T(), f = field(r, [[2, 8, 0.6], [4, 16, 0.6]], 0.45);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) f[y * 16 + x] += Math.sin((x * 0.9 + (y >> 2) * 3.1)) * 0.25;
    rankPaint(t, f, P);
    for (var b = 0; b < 4; b++) { var y0 = b * 4 + 3; for (var x2 = 0; x2 < 16; x2++) px(t, x2, y0, seam); var cut = (b * 7 + 3) & 15; px(t, cut, b * 4, seam); px(t, cut, b * 4 + 1, seam); px(t, cut, b * 4 + 2, seam); }
    return t;
  }
  // bricks: courses of height bh, brick length bw, alternate offset, light top/left edges
  function bricks(seed, P, mortar, bw, bh, hi) {
    var r = R(seed), t = T(); rankPaint(t, field(r, [[4, 4, 0.5], [16, 16, 0.6]], 0.5), P);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var row = Math.floor(y / bh), off = (row & 1) ? (bw >> 1) : 0;
      if (y % bh === bh - 1 || (x + off) % bw === bw - 1) px(t, x, y, mortar);
      else if (hi && (y % bh === 0 || (x + off) % bw === 0) && r() < 0.6) px(t, x, y, mix(getc(t, x, y), hi, 0.45));
    }
    return t;
  }

  /* =============================================================== THE NETHER */
  var RACK_P = pal('451414:20 5a1d1d:52 6c2424:70 7d2c2c:62 8f3939:36 a54848:16');
  (function () {
    var r = R('netherrack'), t = T(), f = field(r, [[4, 4, 0.55], [8, 8, 0.8], [16, 16, 0.65]], 0.45);
    for (var i = 0; i < N; i++) f[i] = f[i] - Math.abs(f[i] - 0.95) * 0.6;   // ridged: light clusters, dark crevices
    rankPaint(t, f, RACK_P);
    add('netherrack', t);
  })();
  function oreOn(base, seed, cols, n, len) {
    var t = clone(base), r = R(seed);
    for (var k = 0; k < n; k++) {
      var x = 1 + (r() * 13 | 0), y = 1 + (r() * 13 | 0), dx = r() < 0.5 ? 1 : -1, dy = r() < 0.6 ? 1 : 0, L = len + (r() * 2 | 0);
      for (var s = 0; s < L; s++) {
        var cx = x + dx * s, cy = y + (dy ? (s >> 1) : 0);
        px(t, cx, cy, cols[s === 0 ? 2 : (s % 2 ? 1 : 0)]); if (r() < 0.55) px(t, cx, cy + 1, cols[2]); if (r() < 0.25) px(t, cx + 1, cy, cols[0]);
      }
    }
    return t;
  }
  add('nether_quartz_ore', oreOn(TB.tiles.netherrack, 'nqo', [C('#efe9df'), C('#d6cdc0'), C('#a99a8a')], 6, 3));
  add('nether_gold_ore', oreOn(TB.tiles.netherrack, 'ngo', [C('#fde16a'), C('#f2b632'), C('#b47a14')], 9, 2));
  // soul sand: sandy brown with ghostly faces
  (function () {
    var r = R('soul_sand'), t = T(); rankPaint(t, field(r, [[4, 4, 0.5], [8, 8, 0.6], [16, 16, 0.7]], 0.5), pal('3b2a20:30 4a372b:60 574234:80 655042:56 77604f:30'));
    var faces = [[2, 3], [9, 2], [4, 10], [11, 10]], dark = C('#2a1d16'), mid = C('#3a2a20');
    for (var k = 0; k < faces.length; k++) {
      var fx = faces[k][0], fy = faces[k][1];
      rect(t, fx - 1, fy - 1, fx + 4, fy + 4, C('#66503f'));
      px(t, fx, fy, dark); px(t, fx + 3, fy, dark); px(t, fx, fy + 1, mid); px(t, fx + 3, fy + 1, mid);
      px(t, fx + 1, fy + 3, dark); px(t, fx + 2, fy + 3, dark); px(t, fx + 1, fy + 2, mid); px(t, fx + 2, fy + 2, mid);
    }
    add('soul_sand', t);
  })();
  add('soul_soil', noiseTile('soul_soil', [[4, 4, 0.4], [8, 8, 0.7], [16, 16, 0.8]], 0.6, pal('2f231b:30 3c2d23:66 4b392c:80 5a4637:50 6c5645:30')));
  add('nether_bricks', bricks('nether_bricks', pal('3a1a20:40 451f26:90 52262e:80 5e2c35:46'), C('#24100f'), 8, 4, C('#6e3640')));
  // magma: dark rock with glowing cracks along voronoi borders, slow pulse
  (function () {
    var r = R('magma'), V = voronoi(scatter(r, 9, 4)), base = field(r, [[4, 4, 0.5], [16, 16, 0.5]], 0.4), frames = [];
    for (var fr = 0; fr < 3; fr++) {
      var t = T(), k = [0, 0.22, 0.1][fr];
      for (var i = 0; i < N; i++) {
        var edge = V.d2[i] - V.d1[i], x = i & 15, y = i >> 4, v = base[i];
        var c = v < 0.45 ? C('#2e140d') : v < 0.6 ? C('#3d1a10') : C('#4f2213');
        if (edge < 0.9) c = mix(C('#c24a12'), C('#ffb341'), clamp(1 - edge + k, 0, 1));
        else if (edge < 1.5) c = mix(c, C('#8a2c0e'), 0.6 + k);
        if (edge < 0.35) c = mix(c, C('#ffe27a'), 0.5 + k);
        px(t, x, y, c);
      }
      frames.push(t);
    }
    addAnim('magma', 12, [frames[0], frames[1], frames[2], frames[1]]);
  })();
  // basalt: vertical grain on the sides, cut rings on the ends
  (function () {
    var r = R('basalt_side'), t = T(), f = field(r, [[16, 2, 0.8], [16, 4, 0.5], [16, 16, 0.25]], 0.25);
    rankPaint(t, f, pal('34343a:30 41414a:60 4f4f58:80 5c5c66:56 6c6c76:30'));
    add('basalt_side', t);
    var r2 = R('basalt_top'), t2 = T(), f2 = new Float32Array(N), n2 = field(r2, [[4, 4, 0.4], [16, 16, 0.4]], 0.3);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { var d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); f2[y * 16 + x] = Math.sin(d * 1.3) * 0.6 + n2[y * 16 + x]; }
    rankPaint(t2, f2, pal('34343a:40 41414a:60 4f4f58:80 5c5c66:50 6c6c76:26'));
    add('basalt_top', t2);
  })();
  add('blackstone', noiseTile('blackstone', [[4, 4, 0.5], [8, 8, 0.7], [16, 16, 0.6]], 0.45, pal('17131a:24 201b23:70 2a242e:90 35303a:52 433d48:20')));
  (function () { var t = clone(TB.tiles.blackstone), r = R('blackstone_top'); for (var k = 0; k < 4; k++) { var x = r() * 16 | 0, y = r() * 16 | 0; line(t, x, y, Math.min(15, x + 3), Math.min(15, y + (r() * 3 | 0)), C('#3d3742')); } add('blackstone_top', t); })();
  // nylium: fuzzy coloured carpet over netherrack, with a dripping fringe on the sides
  function nylium(name, P, fringe) {
    var r = R(name), t = T(); rankPaint(t, field(r, [[4, 4, 0.4], [8, 8, 0.6], [16, 16, 0.9]], 0.7), P);
    add(name, t);
    var s = clone(TB.tiles.netherrack), r2 = R(name + '_side');
    for (var x = 0; x < 16; x++) {
      var d = 2 + (r2() * 3 | 0) + (r2() < 0.2 ? 2 : 0);
      for (var y = 0; y < d; y++) px(s, x, y, P[Math.min(P.length - 1, (r2() * P.length) | 0)][0]);
      px(s, x, d, fringe);
    }
    add(name + '_side', s);
  }
  nylium('crimson_nylium', pal('5e1010:24 7a1717:60 911e1e:80 a82727:60 c23838:32'), C('#4a0f0f'));
  nylium('warped_nylium', pal('0e4a42:24 156158:60 1b7a6c:80 229180:60 33ad97:32'), C('#0b3a34'));
  // nether stems: streaky bark with glowing specks; rings on the cut ends
  function stem(name, P, speck, ring) {
    var r = R(name), t = T(), f = field(r, [[16, 2, 0.9], [16, 4, 0.4]], 0.35); rankPaint(t, f, P);
    for (var k = 0; k < 9; k++) { var x = r() * 16 | 0, y = r() * 15 | 0; px(t, x, y, speck); if (r() < 0.5) px(t, x, y + 1, mix(speck, P[2][0], 0.5)); }
    add(name, t);
    var t2 = T(), r2 = R(name + '_top');
    for (var y2 = 0; y2 < 16; y2++) for (var x2 = 0; x2 < 16; x2++) {
      var d = Math.max(Math.abs(x2 - 7.5), Math.abs(y2 - 7.5)), c;
      if (d > 6.5) c = P[1 + ((x2 + y2) & 1)][0];
      else c = (Math.floor(d) % 2 === 0) ? ring[0] : ring[1];
      if (r2() < 0.08) c = shade(c, 0.85);
      px(t2, x2, y2, c);
    }
    add(name + '_top', t2);
  }
  stem('crimson_stem', pal('3f1020:30 5a1a2e:70 712339:80 86304a:50'), C('#ff7a4a'), [C('#7a2840'), C('#9b3654')]);
  stem('warped_stem', pal('1c1f38:30 26294a:70 2e3a5a:60 2a5f5d:50'), C('#2fe0c2'), [C('#2a6e66'), C('#38877d')]);
  // wart blocks: fleshy lumps
  function wartBlock(name, P) {
    var r = R(name), V = voronoi(scatter(r, 12, 3.4)), t = T(), f = new Float32Array(N), n = field(r, [[16, 16, 0.4]], 0.3);
    for (var i = 0; i < N; i++) f[i] = -V.d1[i] * 0.55 + n[i] + (V.d2[i] - V.d1[i] < 0.7 ? -0.6 : 0);
    rankPaint(t, f, P); add(name, t);
  }
  wartBlock('nether_wart_block', pal('4a0b0b:26 610f0f:56 771515:80 8f1c1c:60 a82626:34'));
  wartBlock('warped_wart_block', pal('0b4846:26 0f5f5c:56 157671:80 1b8b85:60 25a39b:34'));
  (function () {
    var r = R('shroomlight'), V = voronoi(scatter(r, 10, 3.6)), t = T(), f = new Float32Array(N), n = field(r, [[8, 8, 0.4], [16, 16, 0.4]], 0.3);
    for (var i = 0; i < N; i++) f[i] = n[i] - (V.d2[i] - V.d1[i] < 0.8 ? 0.8 : 0) + V.d1[i] * 0.1;
    rankPaint(t, f, pal('b8521f:30 d26b2c:50 eb8b3a:70 f6a54b:60 ffc56a:36 ffe08f:10')); add('shroomlight', t);
  })();
  // fungi / roots / vines (cross sprites on transparent)
  function fungus(name, cap, dots, stemC) {
    var t = T();
    for (var y = 9; y <= 15; y++) { px(t, 7, y, stemC[0]); px(t, 8, y, stemC[1]); }
    var rows = [[5, 10, 3], [3, 12, 4], [2, 13, 5], [2, 13, 6], [3, 12, 7]];
    for (var k = 0; k < rows.length; k++) for (var x = rows[k][0]; x <= rows[k][1]; x++) px(t, x, rows[k][2], k < 2 ? cap[0] : k === 4 ? cap[2] : cap[1]);
    var dd = [[5, 4], [9, 5], [7, 3], [11, 6], [4, 6]]; for (var j = 0; j < dd.length; j++) px(t, dd[j][0], dd[j][1], dots);
    px(t, 6, 15, stemC[1]); px(t, 9, 15, stemC[0]); px(t, 5, 14, stemC[0]); px(t, 10, 14, stemC[1]);
    add(name, t);
  }
  fungus('crimson_fungus', [C('#b72424'), C('#951c1c'), C('#6e1515')], C('#ffbe4f'), [C('#d8b19e'), C('#b98b77')]);
  fungus('warped_fungus', [C('#1fa591'), C('#178575'), C('#10624f')], C('#ff9a3d'), [C('#d8b19e'), C('#b98b77')]);
  function roots(name, cols) {
    var r = R(name), t = T();
    for (var k = 0; k < 7; k++) { var x = 2 + (r() * 12 | 0), h = 5 + (r() * 9 | 0), drift = 0; for (var y = 15; y > 15 - h; y--) { if (r() < 0.25) drift += r() < 0.5 ? -1 : 1; px(t, x + drift, y, cols[(y + k) % cols.length]); } }
    add(name, t);
  }
  roots('crimson_roots', [C('#8e1f2f'), C('#b0324a'), C('#6d1622')]);
  roots('warped_roots', [C('#1a9b8a'), C('#14796c'), C('#28b8a3')]);
  function vines(name, cols, up) {
    var r = R(name), t = T();
    for (var k = 0; k < 4; k++) { var x = 3 + k * 3 + (r() * 2 | 0), drift = 0; for (var s = 0; s < 16; s++) { var y = up ? 15 - s : s; if (r() < 0.2) drift += r() < 0.5 ? -1 : 1; px(t, x + drift, y, cols[(s + k) % 2]); if (r() < 0.25) px(t, x + drift + (r() < 0.5 ? 1 : -1), y, cols[2]); } }
    add(name, t);
  }
  vines('weeping_vines', [C('#9e1c2a'), C('#c23443'), C('#7a1420')], false);
  vines('twisting_vines', [C('#1d9e8f'), C('#14796d'), C('#3cc6b1')], true);
  // soul fire: the fire animation recoloured cyan
  (function () {
    var src0 = TB.animated.fire_layer_0, src1 = TB.animated.fire_layer_1; if (!src0 || !src1) return;
    function recol(fr) {
      var t = clone(fr);
      for (var i = 0; i < N; i++) { if (!t[i * 4 + 3]) continue; var l = (t[i * 4] * 0.3 + t[i * 4 + 1] * 0.59 + t[i * 4 + 2] * 0.11) / 255; var c = l > 0.82 ? C('#d4fbff') : l > 0.62 ? C('#71e3f4') : l > 0.45 ? C('#2fb8d6') : C('#16749c'); t[i * 4] = c[0]; t[i * 4 + 1] = c[1]; t[i * 4 + 2] = c[2]; }
      return t;
    }
    addAnim('soul_fire_0', src0.frameTime, src0.frames.map(recol));
    addAnim('soul_fire_1', src1.frameTime, src1.frames.map(recol));
  })();
  add('crimson_planks', planks('crimson_planks', pal('4f2234:40 64304a:80 763a57:80 8a4766:56'), C('#3a1827')));
  add('warped_planks', planks('warped_planks', pal('1d4c48:40 2a6460:80 337571:80 3f8a84:56'), C('#163a37')));
  (function () {
    var P = pal('d9d1c6:30 e2dbd1:80 e9e3da:90 f0ebe4:46 f7f3ee:10');
    var side = noiseTile('quartz_side', [[2, 16, 0.6], [16, 16, 0.3]], 0.25, P), top = noiseTile('quartz_top', [[4, 4, 0.4], [16, 16, 0.3]], 0.2, P), bot = noiseTile('quartz_bottom', [[8, 8, 0.4], [16, 16, 0.4]], 0.3, P);
    for (var i = 0; i < 16; i++) { px(top, i, 0, C('#d4ccc0')); px(top, 0, i, C('#d4ccc0')); px(top, i, 15, C('#c7beb1')); px(top, 15, i, C('#c7beb1')); }
    add('quartz_block_side', side); add('quartz_block_top', top); add('quartz_block_bottom', bot);
  })();
  // nether portal: swirling violet translucent sheet, 32 frames
  (function () {
    var r = R('nether_portal'), F = 32, frames = [], L = [];
    for (var k = 0; k < 2; k++) { var g = new Float32Array(8 * 8 * (F / 4)); for (var i = 0; i < g.length; i++) g[i] = r(); L.push(g); }
    function n3(g, x, y, t) {
      var nx = 8, ny = 8, nt = F / 4, x0 = Math.floor(x), y0 = Math.floor(y), t0 = Math.floor(t), fx = x - x0, fy = y - y0, ft = t - t0;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); ft = ft * ft * (3 - 2 * ft);
      function at(a, b, c) { return g[((((c % nt) + nt) % nt) * ny + (((b % ny) + ny) % ny)) * nx + (((a % nx) + nx) % nx)]; }
      function l(c) { return (at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy) + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy; }
      return l(t0) * (1 - ft) + l(t0 + 1) * ft;
    }
    for (var f = 0; f < F; f++) {
      var t = T(), tt = f / F;
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        // two counter-rotating spirals blended with drifting noise
        var dx = x - 7.5, dy = y - 7.5, ang = Math.atan2(dy, dx), d = Math.sqrt(dx * dx + dy * dy) / 8;
        var s1 = Math.sin(ang + d * 10 - tt * Math.PI * 2) * 0.5 + 0.5, s2 = Math.sin(-ang + d * 8 + tt * Math.PI * 2 + 1.3) * 0.5 + 0.5;
        var n = n3(L[0], x / 2, y / 2, tt * F / 4) * 0.6 + n3(L[1], x / 4, y / 4, tt * F / 4) * 0.4;
        var v = clamp((s1 * 0.45 + s2 * 0.35 + n * 0.55) - 0.25, 0, 1);
        var c = v > 0.78 ? [212, 120, 255] : v > 0.6 ? [160, 60, 240] : v > 0.42 ? [116, 30, 205] : v > 0.26 ? [88, 14, 170] : [62, 6, 130];
        px(t, x, y, c, 170 + v * 70);
      }
      frames.push(t);
    }
    addAnim('nether_portal', 1, frames);
  })();
  // nether wart crop stages
  (function () {
    function wart(stage) {
      var t = T(), stemc = C('#8a2c24'), bulb = [C('#a52121'), C('#c73232'), C('#7d1414')];
      var tops = stage === 0 ? [[5, 12], [10, 13]] : stage === 1 ? [[4, 9], [9, 8], [12, 11]] : [[3, 5], [8, 4], [12, 6], [6, 9]];
      for (var k = 0; k < tops.length; k++) {
        var tx = tops[k][0], ty = tops[k][1];
        for (var y = ty + 1; y <= 15; y++) px(t, tx + ((y + k) % 3 === 0 ? 1 : 0), y, stemc);
        var rr = stage === 2 ? 2 : 1;
        for (var dy = -rr; dy <= rr; dy++) for (var dx = -rr; dx <= rr; dx++) if (dx * dx + dy * dy <= rr * rr + 0.5) px(t, tx + dx, ty + dy, bulb[(dx + dy + 6) % 3]);
        if (stage === 2) px(t, tx - 1, ty - 1, C('#e24848'));
      }
      return t;
    }
    add('nether_wart_stage0', wart(0)); add('nether_wart_stage1', wart(1)); add('nether_wart_stage2', wart(2));
  })();

  /* =============================================================== THE END */
  (function () {
    var r = R('end_stone'), t = T(); rankPaint(t, field(r, [[4, 4, 0.5], [8, 8, 0.6], [16, 16, 0.6]], 0.45), pal('c4c587:24 d1d395:60 dcde9f:90 e5e7a9:60 eef0b4:22'));
    var pits = scatter(r, 9, 3.2); for (var k = 0; k < pits.length; k++) { var x = pits[k][0] | 0, y = pits[k][1] | 0; px(t, x, y, C('#aaab70')); if (k % 2) px(t, Math.min(15, x + 1), y, C('#b9ba7d')); else px(t, x, Math.min(15, y + 1), C('#babb7e')); }
    add('end_stone', t);
  })();
  add('end_stone_bricks', bricks('end_stone_bricks', pal('cfd092:40 dadb9c:90 e3e5a7:70 eceeb2:30'), C('#a8a96f'), 8, 4, C('#f2f4bd')));
  (function () {
    var PP = pal('8a5e8a:30 9a6c9a:70 a77ba7:90 b48ab4:50 c29cc2:16'), dk = C('#7a527a'), lt = C('#bf99bf');
    var t = noiseTile('purpur', [[4, 4, 0.4], [16, 16, 0.5]], 0.35, PP);
    for (var i = 0; i < 16; i++) { px(t, i, 7, dk); px(t, i, 15, dk); px(t, 7, i, dk); px(t, 15, i, dk); px(t, i, 8, lt); px(t, 8, i, lt); px(t, i, 0, lt); px(t, 0, i, lt); }
    add('purpur_block', t);
    var s = noiseTile('purpur_pillar', [[16, 2, 0.6], [16, 16, 0.3]], 0.3, PP);
    for (var y = 0; y < 16; y++) { px(s, 0, y, dk); px(s, 15, y, dk); px(s, 5, y, C('#8a5e8a')); px(s, 10, y, C('#8a5e8a')); px(s, 1, y, lt); }
    add('purpur_pillar', s);
    var tp = noiseTile('purpur_pillar_top', [[4, 4, 0.4], [16, 16, 0.4]], 0.3, PP);
    for (var k = 0; k < 16; k++) { px(tp, k, 0, dk); px(tp, k, 15, dk); px(tp, 0, k, dk); px(tp, 15, k, dk); }
    for (var k2 = 4; k2 < 12; k2++) { px(tp, k2, 4, dk); px(tp, k2, 11, dk); px(tp, 4, k2, dk); px(tp, 11, k2, dk); }
    add('purpur_pillar_top', tp);
  })();
  (function () {
    var r = R('chorus_plant'), V = voronoi(scatter(r, 10, 3.5)), t = T(), f = new Float32Array(N), n = field(r, [[16, 16, 0.5]], 0.4);
    for (var i = 0; i < N; i++) f[i] = n[i] - V.d1[i] * 0.4 - (V.d2[i] - V.d1[i] < 0.6 ? 0.5 : 0);
    rankPaint(t, f, pal('3e2541:26 553357:60 6c4670:80 845c86:56 a07ca2:30')); add('chorus_plant', t);
    var fl = T(), fr = R('chorus_flower');
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var edge = x < 2 || y < 2 || x > 13 || y > 13, petal = ((x - 7.5) * (x - 7.5) + (y - 7.5) * (y - 7.5)) < 26;
      px(fl, x, y, edge ? C('#7d567f') : petal ? (fr() < 0.5 ? C('#d8b4d8') : C('#c69ec8')) : C('#a77ca9'));
    }
    rect(fl, 6, 6, 9, 9, C('#f0daf0')); add('chorus_flower', fl);
    var dead = clone(fl); for (var i2 = 0; i2 < N; i2++) { var c0 = getc(dead, i2 & 15, i2 >> 4), g = (c0[0] + c0[1] + c0[2]) / 3; px(dead, i2 & 15, i2 >> 4, [g * 0.6 + 30, g * 0.48 + 20, g * 0.6 + 30]); } add('chorus_flower_dead', dead);
  })();
  (function () { var t = noiseTile('dragon_egg', [[4, 4, 0.5], [16, 16, 0.6]], 0.6, pal('07050a:60 0f0b14:90 18121f:70 241a2e:30')); var r = R('egg'); for (var k = 0; k < 14; k++) px(t, r() * 16 | 0, r() * 16 | 0, r() < 0.5 ? C('#4a2a6a') : C('#2f1d45')); add('dragon_egg', t); })();
  (function () {
    var t = T(), w1 = C('#f9f7ff'), w2 = C('#ded4ea'), w3 = C('#bfb0d2');
    for (var i = 0; i < 16; i++) { px(t, 7, i, w1); px(t, 8, i, w2); px(t, i, 7, w1); px(t, i, 8, w2); }
    rect(t, 6, 6, 9, 9, w3); px(t, 7, 7, w1); px(t, 8, 8, w1);
    for (var k = 0; k < 16; k += 5) { px(t, 7, k, w3); px(t, k, 8, w3); }
    add('end_rod', t);
  })();
  (function () {
    // end portal frame: pale stone border with a dark teal inlay; the eye is a green orb
    var top = clone(TB.tiles.end_stone), side = clone(TB.tiles.end_stone);
    var inlay = [C('#1d4a40'), C('#2b6656'), C('#3d846d')];
    rect(top, 3, 3, 12, 12, inlay[1]); rect(top, 4, 4, 11, 11, inlay[0]);
    for (var i = 3; i <= 12; i++) { px(top, i, 3, inlay[2]); px(top, 3, i, inlay[2]); }
    rect(top, 5, 5, 10, 10, C('#0f2a24'));
    for (var x = 0; x < 16; x++) px(side, x, 3, C('#a7a86c'));
    for (var x2 = 2; x2 < 14; x2++) { px(side, x2, 6, inlay[1]); px(side, x2, 7, inlay[0]); px(side, x2, 10, inlay[0]); }
    for (var y = 6; y <= 10; y++) { px(side, 2, y, inlay[2]); px(side, 13, y, inlay[1]); px(side, 7, y, inlay[1]); px(side, 8, y, inlay[0]); }
    add('end_portal_frame_top', top); add('end_portal_frame_side', side);
    var eye = T();
    for (var yy = 0; yy < 16; yy++) for (var xx = 0; xx < 16; xx++) {
      var d = Math.hypot(xx - 7.5, yy - 7.5);
      var c = d < 1.6 ? C('#0a1410') : d < 3.2 ? C('#1f6b47') : C('#3aa66f');
      if (yy < 3) c = (xx + yy) % 2 ? C('#2f8f5d') : C('#46b77c');
      if (d >= 2.4 && d < 3.2 && xx < 7 && yy < 7) c = C('#9cefc4');
      px(eye, xx, yy, c);
    }
    add('end_portal_frame_eye', eye);
    var ep = T(), r = R('end_portal'); for (var i2 = 0; i2 < N; i2++) { var v = r(); px(ep, i2 & 15, i2 >> 4, v > 0.93 ? C('#5fe0c6') : v > 0.86 ? C('#2a5a6a') : C('#050a10')); }
    add('end_portal', ep); add('end_gateway', clone(ep));
  })();

  /* =============================================================== VILLAGES */
  (function () {
    var r = R('dirt_path'), t = T(); rankPaint(t, field(r, [[4, 4, 0.4], [8, 8, 0.6], [16, 16, 0.8]], 0.6), pal('6d5636:26 7f643f:60 8f7149:80 9d7d52:60 ae8c5f:30'));
    add('dirt_path_top', t);
    var s = clone(TB.tiles.dirt || t);
    for (var x = 0; x < 16; x++) { px(s, x, 0, [0, 0, 0], 0); px(s, x, 1, getc(t, x, 1)); px(s, x, 2, getc(t, x, 2)); if (r() < 0.5) px(s, x, 3, getc(t, x, 3)); }
    add('dirt_path_side', s);
  })();
  (function () {
    var t = noiseTile('bell_body', [[4, 4, 0.4], [16, 16, 0.4]], 0.3, pal('b88a1b:20 d5a92b:60 e8c03a:80 f6d64e:60 fde97a:20'));
    for (var i = 0; i < 16; i++) { px(t, i, 0, C('#fff2a0')); px(t, 0, i, C('#f0d660')); px(t, 15, i, C('#a87a14')); }
    add('bell_body', t);
  })();
  var OAK = pal('6e4f2a:30 85633a:80 99723f:80 a6804b:50');
  (function () {
    var side = planks('composter_side', OAK, C('#4b351c'));
    for (var y = 0; y < 16; y++) { px(side, 0, y, C('#4b351c')); px(side, 15, y, C('#4b351c')); }
    add('composter_side', side);
    var top = clone(side); rect(top, 2, 2, 13, 13, C('#3a2914')); for (var i = 2; i < 14; i++) { px(top, i, 2, C('#2a1d0e')); px(top, 2, i, C('#2a1d0e')); } add('composter_top', top);
    add('composter_bottom', planks('composter_bottom', OAK, C('#4b351c')));
    add('composter_compost', noiseTile('compost', [[8, 8, 0.5], [16, 16, 0.6]], 0.6, pal('2f2213:30 3e2d19:60 4f3a20:70 5f4628:40')));
    var ready = clone(TB.tiles.composter_compost), rr = R('compost_ready'); for (var k = 0; k < 40; k++) px(ready, rr() * 16 | 0, rr() * 16 | 0, rr() < 0.5 ? C('#e7e4d4') : C('#cfcab2')); add('composter_ready', ready);
  })();
  (function () {
    var lt = planks('lectern_top', OAK, C('#4b351c')); rect(lt, 2, 3, 13, 12, C('#e8e0c8')); for (var y = 4; y < 12; y += 2) for (var x = 3; x < 13; x++) if (x !== 7 && x !== 8) px(lt, x, y, C('#b7ad95')); rect(lt, 7, 3, 8, 12, C('#6b3b1a'));
    add('lectern_top', lt);
    add('lectern_base', planks('lectern_base', OAK, C('#4b351c')));
    var ls = T(); rankPaint(ls, field(R('lectern_sides'), [[2, 16, 0.6], [4, 16, 0.4]], 0.4), OAK); for (var y2 = 0; y2 < 16; y2++) { px(ls, 0, y2, C('#4b351c')); px(ls, 15, y2, C('#4b351c')); }
    add('lectern_sides', ls);
  })();
  // furnace family: smoker (logs + stone, dark grate) and blast furnace (iron)
  (function () {
    var stone = TB.tiles.smooth_stone || TB.tiles.stone, log = TB.tiles.oak_log || stone;
    function ring(t, x0, y0, x1, y1, c) { for (var x = x0; x <= x1; x++) { px(t, x, y0, c); px(t, x, y1, c); } for (var y = y0; y <= y1; y++) { px(t, x0, y, c); px(t, x1, y, c); } }
    var sSide = clone(log); for (var x = 0; x < 16; x++) for (var y = 0; y < 4; y++) px(sSide, x, y, getc(stone, x, y)); for (var x3 = 0; x3 < 16; x3++) for (var y3 = 12; y3 < 16; y3++) px(sSide, x3, y3, getc(stone, x3, y3));
    add('smoker_side', sSide);
    var sTop = clone(stone); for (var k = 3; k <= 12; k += 3) for (var j = 3; j <= 12; j++) px(sTop, j, k, C('#3a3a3a')); add('smoker_top', sTop); add('smoker_bottom', clone(stone));
    function front(lit, base, grate, glow) {
      var t = clone(base); rect(t, 3, 6, 12, 13, C('#1b1b1b')); ring(t, 3, 6, 12, 13, grate);
      for (var gx = 5; gx <= 11; gx += 2) for (var gy = 7; gy <= 12; gy++) px(t, gx, gy, grate);
      if (lit) for (var fx = 4; fx <= 11; fx++) for (var fy = 10; fy <= 12; fy++) if ((fx + fy) % 2 === 0 || fy === 12) px(t, fx, fy, fy === 12 ? glow[0] : glow[1]);
      return t;
    }
    add('smoker_front', front(false, sSide, C('#4a4a4a'), null)); add('smoker_front_on', front(true, sSide, C('#4a4a4a'), [C('#ffd35a'), C('#f08a1e')]));
    var iron = noiseTile('blast_iron', [[4, 4, 0.4], [16, 16, 0.4]], 0.3, pal('4e4e52:30 5e5e63:70 6e6e74:80 808087:40'));
    var bSide = clone(iron); ring(bSide, 0, 0, 15, 15, C('#3a3a3e')); for (var y4 = 3; y4 < 13; y4 += 3) for (var x4 = 2; x4 < 14; x4++) px(bSide, x4, y4, C('#2e2e32')); add('blast_furnace_side', bSide);
    var bTop = clone(iron); ring(bTop, 0, 0, 15, 15, C('#3a3a3e')); rect(bTop, 5, 5, 10, 10, C('#262629')); add('blast_furnace_top', bTop);
    add('blast_furnace_front', front(false, bSide, C('#6e6e74'), null)); add('blast_furnace_front_on', front(true, bSide, C('#6e6e74'), [C('#ffe07a'), C('#ff9a2a')]));
  })();
  (function () {
    var SP = pal('4a3420:30 5c4128:80 6a4b2f:80 7a5838:50');
    var side = T(), r = R('barrel_side'); rankPaint(side, field(r, [[2, 16, 0.7], [16, 16, 0.3]], 0.4), SP);
    for (var y = 0; y < 16; y++) { px(side, 3, y, C('#3a2817')); px(side, 8, y, C('#3a2817')); px(side, 13, y, C('#3a2817')); }
    for (var x = 0; x < 16; x++) { px(side, x, 2, C('#2e2e2e')); px(side, x, 3, C('#4a4a4a')); px(side, x, 12, C('#2e2e2e')); px(side, x, 13, C('#4a4a4a')); }
    add('barrel_side', side);
    var top = planks('barrel_top', SP, C('#3a2817')); for (var i = 0; i < 16; i++) { px(top, i, 0, C('#2e2e2e')); px(top, 0, i, C('#2e2e2e')); px(top, i, 15, C('#2e2e2e')); px(top, 15, i, C('#2e2e2e')); }
    rect(top, 6, 6, 9, 9, C('#2b1d10')); add('barrel_top', top); add('barrel_bottom', planks('barrel_bottom', SP, C('#3a2817')));
  })();
  (function () {
    var BIRCH = pal('b9a573:30 c7b47f:80 d3c08b:80 dfcd99:50'), DARK = pal('2e1f10:30 3a2814:80 47321a:70 553d21:40');
    var ft = planks('fletching_top', BIRCH, C('#8e7a4c'));
    line(ft, 2, 13, 13, 2, C('#6b4a2a')); line(ft, 11, 2, 13, 2, C('#d0d0d0')); line(ft, 13, 2, 13, 4, C('#d0d0d0')); px(ft, 3, 12, C('#f0f0f0')); px(ft, 2, 11, C('#f0f0f0')); px(ft, 4, 13, C('#f0f0f0'));
    add('fletching_table_top', ft);
    var ff = planks('fletching_front', BIRCH, C('#8e7a4c')); for (var k = 0; k < 3; k++) { line(ff, 3 + k * 4, 3, 3 + k * 4, 9, C('#f2f2f2')); px(ff, 2 + k * 4, 4, C('#d8d8d8')); px(ff, 4 + k * 4, 4, C('#d8d8d8')); } add('fletching_table_front', ff);
    add('fletching_table_side', planks('fletching_side', BIRCH, C('#8e7a4c')));
    var ct = planks('carto_top', DARK, C('#1e140a')); rect(ct, 2, 2, 13, 13, C('#e3d8b4')); for (var i = 3; i < 13; i += 3) line(ct, 3, i, 12, i + 1, C('#9c8c65')); px(ct, 7, 7, C('#b03030')); px(ct, 8, 7, C('#b03030')); add('cartography_table_top', ct);
    for (var s = 1; s <= 3; s++) { var cs = planks('carto_side' + s, DARK, C('#1e140a')); if (s !== 2) { rect(cs, 3, 2, 12, 9, C('#d8cca6')); line(cs, 4, 4, 11, 4, C('#8c7c58')); line(cs, 4, 7, 9, 7, C('#8c7c58')); } add('cartography_table_side' + s, cs); }
    var ironP = pal('2a2a2e:30 34343a:70 3f3f46:70 4b4b53:30');
    var st = noiseTile('smith_top', [[4, 4, 0.4], [16, 16, 0.4]], 0.3, ironP); for (var j = 0; j < 16; j++) { px(st, j, 0, C('#1c1c20')); px(st, 0, j, C('#1c1c20')); px(st, j, 15, C('#55555d')); px(st, 15, j, C('#55555d')); } add('smithing_table_top', st);
    add('smithing_table_bottom', planks('smith_bottom', DARK, C('#1e140a')));
    var sf = planks('smith_front', DARK, C('#1e140a')); rect(sf, 0, 0, 15, 2, C('#34343a')); line(sf, 4, 5, 4, 12, C('#7a7a80')); rect(sf, 3, 5, 5, 6, C('#a0a0a6')); line(sf, 10, 6, 12, 12, C('#7a7a80')); add('smithing_table_front', sf);
    var ss = planks('smith_side', DARK, C('#1e140a')); rect(ss, 0, 0, 15, 2, C('#34343a')); add('smithing_table_side', ss);
  })();
  (function () {
    var stone = TB.tiles.stone, t = clone(stone);
    rect(t, 0, 7, 15, 8, C('#3c3c3c')); for (var x = 0; x < 16; x++) px(t, x, 6, C('#9a9a9a'));
    add('stonecutter_top', t);
    var s = clone(TB.tiles.smooth_stone || stone); for (var x2 = 0; x2 < 16; x2++) { px(s, x2, 7, C('#5a5a5a')); px(s, x2, 8, C('#7a7a7a')); px(s, x2, 0, C('#4a4a4a')); } add('stonecutter_side', s);
    add('stonecutter_bottom', clone(stone));
    var saw = T(); for (var y = 0; y < 16; y++) for (var x3 = 0; x3 < 16; x3++) { var d = Math.hypot(x3 - 7.5, y - 15); if (d < 7.5) px(saw, x3, y, d > 6.4 ? ((x3 + y) % 2 ? C('#c8c8c8') : C('#8e8e8e')) : C('#a9a9a9')); } add('stonecutter_saw', saw);
  })();
  (function () {
    var t = planks('loom_top', OAK, C('#4b351c')); rect(t, 2, 4, 13, 11, C('#d9d9d9')); for (var y = 5; y < 11; y++) for (var x = 3; x < 13; x += 2) px(t, x, y, C('#b0b0b0')); add('loom_top', t);
    var f = planks('loom_front', OAK, C('#4b351c')); for (var x2 = 2; x2 < 14; x2 += 2) line(f, x2, 2, x2, 13, C('#e2e2e2')); rect(f, 2, 7, 13, 8, C('#c03a3a')); add('loom_front', f);
    add('loom_side', planks('loom_side', OAK, C('#4b351c'))); add('loom_bottom', planks('loom_bottom', OAK, C('#4b351c')));
  })();
  (function () {
    var GP = pal('6e6e6e:30 828282:70 939393:80 a6a6a6:40');
    var round = noiseTile('grind_round', [[4, 4, 0.4], [16, 16, 0.5]], 0.4, GP); add('grindstone_round', round);
    var side = T(); for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { var d = Math.hypot(x - 7.5, y - 7.5); if (d < 8.2) px(side, x, y, d < 2 ? C('#5c3d22') : d < 6.5 ? getc(round, x, y) : C('#5f5f5f')); } add('grindstone_side', side);
    add('grindstone_pivot', noiseTile('grind_pivot', [[2, 16, 0.6]], 0.3, pal('3a2814:40 47321a:80 553d21:50')));
  })();
  (function () {
    var IP = pal('2e2e31:30 3a3a3e:70 46464b:80 54545a:40');
    var side = noiseTile('cauldron_side', [[4, 4, 0.4], [16, 16, 0.4]], 0.3, IP); for (var x = 0; x < 16; x++) { px(side, x, 0, C('#5e5e64')); px(side, x, 1, C('#4b4b50')); } for (var x2 = 4; x2 < 12; x2++) for (var y = 13; y < 16; y++) px(side, x2, y, [0, 0, 0], 0);
    add('cauldron_side', side);
    var top = noiseTile('cauldron_top', [[4, 4, 0.4]], 0.3, IP); rect(top, 2, 2, 13, 13, C('#1c1c1e')); add('cauldron_top', top);
    add('cauldron_bottom', noiseTile('cauldron_bottom', [[4, 4, 0.4]], 0.3, IP)); add('cauldron_inner', noiseTile('cauldron_inner', [[4, 4, 0.4]], 0.3, pal('1a1a1c:40 232326:80 2c2c30:40')));
    var water = TB.animated.water_still ? clone(TB.animated.water_still.frames[0]) : T(); for (var i = 0; i < N; i++) { var v = water[i * 4] / 255; water[i * 4] = 0x3f * (0.6 + v * 0.6); water[i * 4 + 1] = 0x76 * (0.6 + v * 0.6); water[i * 4 + 2] = 0xe4 * (0.6 + v * 0.6); water[i * 4 + 3] = 220; }
    add('cauldron_water', water);
  })();
  (function () {
    var t = T(); for (var y = 0; y < 16; y++) { px(t, 7, y, C('#e8c36a')); px(t, 8, y, C('#b88e3a')); } for (var x = 0; x < 16; x++) { px(t, x, 7, C('#e8c36a')); px(t, x, 8, C('#b88e3a')); } add('brewing_stand', t);
    add('brewing_stand_base', noiseTile('brew_base', [[4, 4, 0.5], [16, 16, 0.5]], 0.4, pal('5a5a5a:30 6e6e6e:70 808080:70 939393:30')));
  })();
  // crops: carrots and potatoes, four visible stages each
  (function () {
    function crop(seed, stage, top) {
      var t = T(), r = R(seed + stage), leaf = [C('#3f8f2a'), C('#52a836'), C('#2f6e1f')];
      var stems = [[3, 0], [7, 0], [11, 0], [5, 1], [9, 1], [13, 1]], h = [4, 7, 10, 12][stage];
      for (var k = 0; k < stems.length; k++) {
        var x = stems[k][0] + (r() * 2 | 0), hh = h - (r() * 3 | 0);
        for (var y = 15; y > 15 - hh; y--) { px(t, x, y, leaf[(y + k) % 3]); if (y < 15 - hh + 3 && r() < 0.6) px(t, x + (r() < 0.5 ? 1 : -1), y, leaf[1]); }
        if (stage === 3 && top) top(t, x, 15 - hh, k);
      }
      return t;
    }
    for (var s = 0; s < 4; s++) {
      add('carrots_stage' + s, crop('carrots', s, function (t, x, y, k) { px(t, x, 15, C('#f08a24')); px(t, x, 14, C('#d26d14')); if (k % 2) px(t, x + 1, 15, C('#f8a347')); }));
      add('potatoes_stage' + s, crop('potatoes', s, function (t, x, y, k) { px(t, x, 15, C('#c79a4d')); px(t, x + 1, 15, C('#a77b37')); px(t, x, 14, C('#b68940')); if (k === 2) px(t, x, y - 1, C('#ffffff')); }));
    }
  })();
  (function () {
    var t = T(), fr = [C('#3b3b40'), C('#55555c'), C('#2a2a2e')], glow = [C('#ffe08f'), C('#ffc25a'), C('#fff3c4')];
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(t, x, y, fr[(x + y) % 3 === 0 ? 2 : 0]);
    rect(t, 2, 2, 13, 13, glow[1]); rect(t, 4, 4, 11, 11, glow[0]); rect(t, 6, 6, 9, 9, glow[2]);
    for (var i = 0; i < 16; i++) { px(t, i, 0, fr[1]); px(t, 0, i, fr[1]); px(t, 7, i, fr[0]); px(t, 8, i, fr[2]); }
    add('lantern', t);
    var ch = T(); for (var y2 = 0; y2 < 16; y2++) for (var x2 = 0; x2 < 16; x2++) px(ch, x2, y2, (y2 >> 1) % 2 ? C('#3a3a40') : C('#55555e')); add('lantern_chain', ch);
  })();
  (function () {
    if (!TB.tiles.stone_bricks) return;
    var m = clone(TB.tiles.stone_bricks), r = R('mossy_sb'), moss = TB.tiles.mossy_cobblestone;
    for (var i = 0; i < N; i++) { var x = i & 15, y = i >> 4, v = Math.sin(x * 0.7 + y * 0.3) + Math.sin(y * 0.9) + r() * 1.3; if (v > 1.2) { var c = moss ? getc(moss, x, y) : [0, 0, 0]; if (moss && c[1] > c[0] + 8) px(m, x, y, c); else px(m, x, y, mix(getc(m, x, y), C('#5a7a3a'), 0.6)); } }
    add('mossy_stone_bricks', m);
    var c2 = clone(TB.tiles.stone_bricks), r2 = R('cracked_sb'), dark = C('#4e4e4e');
    var cracks = [[2, 1, 6, 6], [6, 6, 4, 11], [10, 9, 14, 13], [11, 2, 13, 5]];
    for (var k = 0; k < cracks.length; k++) line(c2, cracks[k][0], cracks[k][1], cracks[k][2], cracks[k][3], dark);
    for (var j = 0; j < 10; j++) px(c2, r2() * 16 | 0, r2() * 16 | 0, C('#5e5e5e'));
    add('cracked_stone_bricks', c2);
  })();

  /* =============================================================== ITEMS */
  if (TI && TI.tiles) {
    var IT = function () { return new Uint8ClampedArray(1024); };
    var put = function (t, x, y, c) { if (x < 0 || y < 0 || x > 15 || y > 15) return; var i = (y * 16 + x) * 4; t[i] = c[0]; t[i + 1] = c[1]; t[i + 2] = c[2]; t[i + 3] = 255; };
    var orb = function (cx, cy, R0, ramp, outline) {
      var t = IT();
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { var dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy); if (d > R0 + 1) continue; if (d > R0) { put(t, x, y, outline); continue; } var l = clamp(1 - (dx * 0.5 + dy * 0.7 + R0) / (2 * R0), 0, 0.999); put(t, x, y, ramp[Math.min(ramp.length - 1, Math.floor((1 - l) * ramp.length))]); }
      return t;
    };
    var outlineIt = function (t, c) { var o = new Uint8ClampedArray(t); for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { if (t[(y * 16 + x) * 4 + 3]) continue; var nb = false; for (var k = 0; k < 4; k++) { var nx = x + [1, -1, 0, 0][k], ny = y + [0, 0, 1, -1][k]; if (nx >= 0 && ny >= 0 && nx < 16 && ny < 16 && t[(ny * 16 + nx) * 4 + 3]) nb = true; } if (nb) put(o, x, y, c); } return o; };
    (function () { var t = IT(), cs = [C('#ffffff'), C('#ece6dc'), C('#d3c9bb'), C('#b3a594')]; var rows = [[7, 8, 2], [6, 9, 3], [5, 10, 4], [5, 10, 5], [4, 11, 6], [4, 11, 7], [4, 10, 8], [5, 10, 9], [5, 9, 10], [6, 9, 11], [6, 8, 12], [7, 8, 13]]; for (var k = 0; k < rows.length; k++) for (var x = rows[k][0]; x <= rows[k][1]; x++) put(t, x, rows[k][2], cs[clamp((x - rows[k][0] + (k > 6 ? 1 : 0)), 0, 3)]); addItem('quartz', outlineIt(t, C('#6e6255'))); })();
    var nugget = function (name, ramp, out) { var t = IT(); var cells = [[6, 7], [7, 7], [8, 7], [9, 7], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [6, 9], [7, 9], [8, 9], [9, 9], [10, 9], [7, 10], [8, 10], [9, 10]]; for (var k = 0; k < cells.length; k++) put(t, cells[k][0], cells[k][1], ramp[(cells[k][0] + cells[k][1] * 2) % ramp.length]); put(t, 6, 7, ramp[0]); addItem(name, outlineIt(t, out)); };
    nugget('gold_nugget', [C('#fffbb0'), C('#fde05a'), C('#e8b42a'), C('#c08414')], C('#7a4f0a'));
    nugget('iron_nugget', [C('#ffffff'), C('#dcdcdc'), C('#b5b5b5'), C('#8c8c8c')], C('#4a4a4a'));
    (function () { var t = IT(); for (var k = 0; k < 12; k++) { put(t, 3 + k, 12 - k, k % 3 === 0 ? C('#fff3a0') : C('#ffc338')); put(t, 4 + k, 12 - k, C('#e88a12')); put(t, 3 + k, 13 - k, C('#c96a0e')); } addItem('blaze_rod', outlineIt(t, C('#6a3504'))); })();
    (function () { var t = IT(), r = R('blaze_powder'); for (var y = 8; y < 14; y++) for (var x = 3; x < 13; x++) { var dx = x - 7.5, dy = (y - 13) * 1.6; if (dx * dx + dy * dy > 18) continue; var v = r(); put(t, x, y, v > 0.7 ? C('#fff08a') : v > 0.35 ? C('#ffb52e') : C('#e2700d')); } for (var k = 0; k < 5; k++) put(t, 4 + (r() * 8 | 0), 6 + (r() * 3 | 0), C('#ffd35a')); addItem('blaze_powder', t); })();
    (function () { var t = IT(); var rows = [[7, 8, 3], [7, 8, 4], [6, 9, 5], [6, 9, 6], [5, 10, 7], [5, 10, 8], [5, 10, 9], [5, 10, 10], [6, 9, 11], [7, 8, 12]]; for (var k = 0; k < rows.length; k++) for (var x = rows[k][0]; x <= rows[k][1]; x++) put(t, x, rows[k][2], x === rows[k][0] ? C('#ffffff') : k > 6 ? C('#8fc9cf') : C('#c9eef0')); addItem('ghast_tear', outlineIt(t, C('#5b8a8f'))); })();
    (function () { var t = orb(7.5, 8.5, 4.6, [C('#ffd36a'), C('#f7a23a'), C('#e2711c'), C('#b9480f'), C('#8a2f08')], C('#3a1404')); for (var a = 0; a < 20; a++) { var ang = a / 20 * Math.PI * 2; put(t, Math.round(7.5 + Math.cos(ang) * 3), Math.round(8.5 + Math.sin(ang) * 2), C('#ffef8a')); } addItem('magma_cream', t); })();
    (function () { var t = IT(), r = R('nw_item'); var blobs = [[6, 7, 2.6], [10, 8, 2.2], [7, 11, 2.4], [10, 12, 1.8]]; for (var k = 0; k < blobs.length; k++) for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { var d = Math.hypot(x - blobs[k][0], y - blobs[k][1]); if (d < blobs[k][2]) put(t, x, y, d < blobs[k][2] - 1.2 ? (r() < 0.3 ? C('#d23a3a') : C('#b52626')) : C('#7e1616')); } addItem('nether_wart', outlineIt(t, C('#3e0a0a'))); })();
    (function () { var t = IT(); for (var y = 5; y <= 10; y++) for (var x = 2; x <= 13; x++) put(t, x, y, y === 5 ? C('#7a3a44') : x === 2 || y === 10 ? C('#3a1a20') : C('#58262e')); for (var x2 = 3; x2 < 13; x2++) put(t, x2, 6, C('#6c323b')); addItem('nether_brick', outlineIt(t, C('#1e0c0f'))); })();
    (function () { var t = orb(7.5, 8.5, 5.4, [C('#b8f5c8'), C('#5fd486'), C('#2f9e5c'), C('#1d6f3f'), C('#0e4325')], C('#062012')); for (var x = 6; x <= 9; x++) for (var y = 7; y <= 10; y++) put(t, x, y, (x === 6 || x === 9) && (y === 7 || y === 10) ? C('#2f9e5c') : C('#0b2a18')); put(t, 7, 8, C('#c7ffd8')); addItem('ender_eye', t); })();
    (function () { var t = orb(7.5, 8.5, 5.2, [C('#5a3a2a'), C('#3e2618'), C('#2c1a10'), C('#1e120a'), C('#120a05')], C('#000000')), r = R('firecharge'); for (var k = 0; k < 18; k++) { var a = r() * 6.28, d = r() * 4.5; put(t, Math.round(7.5 + Math.cos(a) * d), Math.round(8.5 + Math.sin(a) * d), r() < 0.5 ? C('#ff9a1e') : C('#ffd34a')); } addItem('fire_charge', t); })();
    (function () {
      var t = IT(), r = R('chorus_fruit');
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { var d = Math.hypot(x - 7.5, y - 8.5); if (d < 5) put(t, x, y, d < 3.6 ? (r() < 0.4 ? C('#a77ba9') : C('#8c5f8e')) : C('#6b4570')); }
      for (var k = 0; k < 7; k++) put(t, 5 + (r() * 6 | 0), 6 + (r() * 6 | 0), C('#c9a3cb'));
      var cf = outlineIt(t, C('#3a2440')); addItem('chorus_fruit', cf);
      var p = new Uint8ClampedArray(cf); for (var i = 0; i < 256; i++) if (p[i * 4 + 3]) { p[i * 4] = Math.min(255, p[i * 4] * 1.35 + 30); p[i * 4 + 1] = Math.min(255, p[i * 4 + 1] * 1.25 + 24); p[i * 4 + 2] = Math.min(255, p[i * 4 + 2] * 1.3 + 30); }
      addItem('popped_chorus_fruit', p);
    })();
    (function () { var t = IT(); for (var y = 3; y <= 12; y++) for (var x = 3; x <= 12; x++) { var edge = x === 3 || x === 12 || y === 3 || y === 12; put(t, x, y, edge ? C('#d8eef4') : C('#9fc3cf')); } for (var y2 = 6; y2 <= 9; y2++) for (var x2 = 6; x2 <= 9; x2++) put(t, x2, y2, (x2 + y2) % 2 ? C('#e85fc9') : C('#c43aa8')); put(t, 4, 4, C('#ffffff')); for (var x3 = 2; x3 <= 13; x3++) { put(t, x3, 13, C('#2a2a2e')); put(t, x3, 14, C('#16161a')); } addItem('end_crystal', t); })();
    // block items that are sprites in vanilla
    (function () { var t = IT(), fr = [C('#3b3b40'), C('#5a5a62')]; for (var y = 6; y <= 13; y++) for (var x = 5; x <= 10; x++) put(t, x, y, fr[0]); for (var y1 = 7; y1 <= 12; y1++) for (var x1 = 6; x1 <= 9; x1++) put(t, x1, y1, C('#ffc25a')); for (var y2 = 8; y2 <= 11; y2++) for (var x2 = 7; x2 <= 8; x2++) put(t, x2, y2, C('#fff0b8')); for (var x3 = 6; x3 <= 9; x3++) { put(t, x3, 4, fr[1]); put(t, x3, 5, fr[1]); } put(t, 7, 2, fr[0]); put(t, 8, 2, fr[0]); put(t, 7, 3, fr[1]); put(t, 8, 3, fr[1]); addItem('lantern_item', outlineIt(t, C('#18181c'))); })();
    (function () { var t = IT(); for (var y = 3; y <= 12; y++) { var w = y < 5 ? 2 : y < 11 ? 3 + ((y - 5) >> 1) : 6; for (var x = 8 - w; x <= 7 + w; x++) put(t, x, y, x < 7 ? C('#fff08a') : x < 9 ? C('#f6d64e') : C('#c9991e')); } for (var x2 = 3; x2 <= 12; x2++) { put(t, x2, 12, C('#b88a1b')); put(t, x2, 13, C('#b88a1b')); } put(t, 7, 14, C('#8a6410')); put(t, 8, 14, C('#8a6410')); addItem('bell_item', outlineIt(t, C('#5a3e06'))); })();
    (function () { var t = IT(); for (var y = 1; y <= 12; y++) { put(t, 7, y, C('#e8c36a')); put(t, 8, y, C('#b88e3a')); } for (var x = 3; x <= 12; x++) { put(t, x, 13, C('#7a7a7a')); put(t, x, 14, C('#5a5a5a')); } var b = [[3, 8], [11, 8], [7, 10]]; for (var k = 0; k < 3; k++) { for (var yy = b[k][1]; yy <= b[k][1] + 2; yy++) for (var xx = b[k][0] - 1; xx <= b[k][0] + 1; xx++) put(t, xx, yy, C('#b8d2e8')); put(t, b[k][0], b[k][1] - 1, C('#8aa6bc')); } addItem('brewing_stand_item', outlineIt(t, C('#2a2a2a'))); })();
    (function () { var t = IT(); for (var y = 3; y <= 13; y++) for (var x = 2; x <= 13; x++) { var inside = x > 3 && x < 12 && y < 12; put(t, x, y, inside ? (y < 5 ? C('#3f76e4') : C('#1c1c1e')) : (y === 3 ? C('#5e5e64') : C('#3a3a3e'))); } put(t, 2, 14, C('#2e2e31')); put(t, 13, 14, C('#2e2e31')); addItem('cauldron_item', outlineIt(t, C('#121214'))); })();
    (function () { var t = IT(); for (var k = 0; k < 11; k++) { put(t, 4 + k, 11 - k, C('#fbf8ff')); put(t, 5 + k, 11 - k, C('#d6cce4')); } for (var y = 11; y <= 13; y++) for (var x = 2; x <= 4; x++) put(t, x, y, C('#b9aacc')); addItem('end_rod_item', outlineIt(t, C('#5a4a6e'))); })();
  }
})(typeof window !== 'undefined' ? window : globalThis);
