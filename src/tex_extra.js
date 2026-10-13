/* tex_extra.js - additional procedural block/item textures for the content update
 * (fire, glass pane edge, iron bars, trapdoor, vine, cobweb, spawner, ...). Extends the TexBlocks global in place:
 *   TexBlocks.names / .tiles[name] (16x16 RGBA Uint8ClampedArray) / .animated[name] = { frameTime, frames }.
 * Deterministic, DOM free, runs under Node and in the browser. Load after tex_blocks.js. */
(function (G) {
  'use strict';
  var TB = G.TexBlocks;
  if (!TB) return;
  var N = 256;

  function mulberry32(a) { return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function T() { return new Uint8ClampedArray(N * 4); }
  function px(t, x, y, c, a) {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    var i = (y * 16 + x) * 4; t[i] = c[0]; t[i + 1] = c[1]; t[i + 2] = c[2]; t[i + 3] = a === undefined ? (c.length > 3 ? c[3] : 255) : a;
  }
  function rect(t, x0, y0, x1, y1, c) { for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) px(t, x, y, c); }
  function line(t, x0, y0, x1, y1, c) {
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (;;) { px(t, x0, y0, c); if (x0 === x1 && y0 === y1) break; var e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  }
  function add(name, tile) { if (TB.tiles[name]) return; TB.names.push(name); TB.tiles[name] = tile; }
  function addAnim(name, frameTime, frames) { if (TB.tiles[name]) return; TB.names.push(name); TB.tiles[name] = frames[0]; TB.animated[name] = { frameTime: frameTime, frames: frames }; }

  /* ---- periodic 3D value noise: lattice nx*ny*nt, sampled with wrap ---- */
  function lattice(seed, nx, ny, nt) {
    var r = mulberry32(seed), g = new Float32Array(nx * ny * nt);
    for (var i = 0; i < g.length; i++) g[i] = r();
    return function (x, y, t) {
      var x0 = Math.floor(x), y0 = Math.floor(y), t0 = Math.floor(t), fx = x - x0, fy = y - y0, ft = t - t0;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); ft = ft * ft * (3 - 2 * ft);
      function at(a, b, c) { return g[((((c % nt) + nt) % nt) * ny + (((b % ny) + ny) % ny)) * nx + (((a % nx) + nx) % nx)]; }
      function l(a, b, c) { return (at(a, b, c) * (1 - fx) + at(a + 1, b, c) * fx) * (1 - fy) + (at(a, b + 1, c) * (1 - fx) + at(a + 1, b + 1, c) * fx) * fy; }
      return l(x0, y0, t0) * (1 - ft) + l(x0, y0, t0 + 1) * ft;
    };
  }

  /* ---- fire: 32-frame loop of rising flame tongues (yellow core, orange body, red tips), transparent background ---- */
  function fireFrames(seed, phase) {
    var noise = lattice(seed, 4, 4, 8), noise2 = lattice(seed + 77, 8, 8, 8), frames = [], F = 32;
    for (var f = 0; f < F; f++) {
      var t = T(), tt = ((f + phase) % F) / F;
      for (var y = 0; y < 16; y++) {
        for (var x = 0; x < 16; x++) {
          var sy = (y + ((f + phase) % F) * 0.5) % 16;             // scroll upward one tile per loop
          var v = noise(x * 4 / 16, sy * 2 / 16, tt * 8) * 0.68 + noise2(x * 8 / 16, sy * 4 / 16, tt * 8) * 0.32;
          var e = 0.66 + 0.62 * (y / 15);                          // strongest at the bottom
          var s = v * e;
          if (s < 0.44) continue;
          var c = s > 0.98 ? [255, 244, 150] : s > 0.80 ? [255, 209, 70] : s > 0.62 ? [250, 152, 26] : [222, 84, 14];
          px(t, x, y, c, 255);
        }
      }
      frames.push(t);
    }
    return frames;
  }
  addAnim('fire_layer_0', 1, fireFrames(1337, 0));
  addAnim('fire_layer_1', 1, fireFrames(4242, 13));

  /* ---- glass pane edge: pale glass edge colour (only the central two columns are visible on the pane) ---- */
  (function () {
    var t = T(); rect(t, 0, 0, 15, 15, [199, 219, 222]);
    for (var y = 0; y < 16; y++) { px(t, 7, y, [172, 200, 206]); px(t, 8, y, [222, 238, 240]); }
    add('glass_pane_top', t);
  })();

  /* ---- iron bars: three vertical bars, rails top and bottom ---- */
  (function () {
    var t = T(), dark = [56, 58, 60], mid = [104, 108, 110], lit = [150, 154, 156];
    [[2, 2], [7, 8], [13, 13]].forEach(function (b) {
      for (var y = 0; y < 16; y++) for (var x = b[0]; x <= b[1]; x++) px(t, x, y, x === b[0] ? lit : (x === b[1] && b[1] !== b[0] ? dark : mid));
    });
    for (var x = 0; x < 16; x++) { px(t, x, 0, lit); px(t, x, 1, mid); px(t, x, 14, mid); px(t, x, 15, dark); }
    add('iron_bars', t);
  })();

  /* ---- oak trapdoor: planks with a dark frame and a 2x2 lattice ---- */
  (function () {
    var t = T(), r = mulberry32(99), plank = [[150, 118, 68], [141, 109, 62], [158, 126, 74], [132, 101, 57]];
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(t, x, y, plank[(r() * 4) | 0]);
    var frame = [90, 66, 32], edge = [112, 82, 41];
    for (var i = 0; i < 16; i++) { px(t, i, 0, frame); px(t, i, 15, frame); px(t, 0, i, frame); px(t, 15, i, frame); px(t, i, 1, edge); px(t, i, 14, edge); px(t, 1, i, edge); px(t, 14, i, edge); }
    for (var k = 2; k < 14; k++) { px(t, 7, k, frame); px(t, 8, k, edge); px(t, k, 7, frame); px(t, k, 8, edge); }
    rect(t, 2, 2, 3, 3, [70, 70, 74]); rect(t, 12, 2, 13, 3, [70, 70, 74]);
    add('oak_trapdoor', t);
  })();

  /* ---- vine: leafy strands, light grey-green so the foliage tint does the colouring ---- */
  (function () {
    var t = T(), r = mulberry32(555), a = [170, 200, 160], b = [205, 232, 195], c = [132, 160, 124];
    for (var x = 0; x < 16; x++) {
      if (r() < 0.25) continue;
      var len = 3 + ((r() * 12) | 0), drift = 0;
      for (var y = 0; y < len; y++) {
        if (r() < 0.2) drift += r() < 0.5 ? -1 : 1;
        var xx = Math.max(0, Math.min(15, x + drift)), col = r() < 0.5 ? a : (r() < 0.5 ? b : c);
        px(t, xx, y, col);
        if (r() < 0.45) px(t, xx + (r() < 0.5 ? -1 : 1), y, r() < 0.5 ? a : c);
      }
    }
    for (var x2 = 0; x2 < 16; x2++) if (r() < 0.75) { px(t, x2, 0, r() < 0.5 ? a : b); if (r() < 0.6) px(t, x2, 1, c); }
    add('vine', t);
  })();

  /* ---- cobweb: a diagonal-spoked web with rings ---- */
  (function () {
    var t = T(), w = [232, 232, 232], g = [196, 198, 200];
    line(t, 0, 0, 15, 15, w); line(t, 15, 0, 0, 15, w); line(t, 7, 0, 7, 15, g); line(t, 8, 0, 8, 15, g); line(t, 0, 7, 15, 7, g); line(t, 0, 8, 15, 8, g);
    [3, 5].forEach(function (rr) {
      for (var a = 0; a < 64; a++) {
        var ang = a / 64 * Math.PI * 2, x = Math.round(7.5 + Math.cos(ang) * rr * 1.4), y = Math.round(7.5 + Math.sin(ang) * rr * 1.4);
        px(t, x, y, g);
      }
    });
    add('cobweb', t);
  })();

  /* ---- monster spawner cage: steel lattice, hollow inside so the spinning mob shows ---- */
  (function () {
    var t = T(), dark = [38, 48, 62], mid = [78, 100, 124], lit = [128, 154, 182];
    for (var i = 0; i < 16; i++) { px(t, i, 0, dark); px(t, i, 15, dark); px(t, 0, i, dark); px(t, 15, i, dark); px(t, i, 1, mid); px(t, i, 14, mid); px(t, 1, i, mid); px(t, 14, i, mid); }
    for (var k = 2; k < 14; k++) { px(t, k, 2, lit); px(t, 2, k, lit); px(t, k, 13, dark); px(t, 13, k, dark); }
    line(t, 2, 2, 13, 13, mid); line(t, 13, 2, 2, 13, mid); line(t, 2, 3, 12, 13, dark); line(t, 3, 2, 13, 12, lit); line(t, 12, 2, 2, 12, lit); line(t, 13, 3, 3, 13, dark);
    add('spawner', t);
  })();

  /* ==== biome blocks: recoloured / re-patterned variants of the base textures ==== */
  function lumaOf(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
  // map luminance of an existing tile onto a dark->light colour ramp (keeps the structure and alpha of the source)
  function recolor(src, stops) {
    var t = T(), lo = 1e9, hi = -1e9, i, L;
    for (i = 0; i < N; i++) if (src[i * 4 + 3] > 0) { L = lumaOf(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]); if (L < lo) lo = L; if (L > hi) hi = L; }
    var span = hi - lo || 1, n = stops.length;
    for (i = 0; i < N; i++) {
      var a = src[i * 4 + 3]; t[i * 4 + 3] = a;
      L = lumaOf(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
      var u = Math.max(0, Math.min(1, (L - lo) / span)) * (n - 1), k = Math.min(n - 2, Math.floor(u)), f = u - k, c0 = stops[k], c1 = stops[k + 1];
      t[i * 4] = c0[0] + (c1[0] - c0[0]) * f; t[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * f; t[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * f;
    }
    return t;
  }
  function have(n) { return !!TB.tiles[n]; }
  function wood(name, planks, logSide, logTop) {
    if (have('oak_planks')) add(name + '_planks', recolor(TB.tiles.oak_planks, planks));
    if (have('oak_log')) add(name + '_log', recolor(TB.tiles.oak_log, logSide));
    if (have('oak_log_top')) add(name + '_log_top', recolor(TB.tiles.oak_log_top, logTop));
  }
  wood('acacia', [[124, 60, 30], [148, 74, 38], [168, 90, 50], [188, 106, 64]], [[62, 58, 50], [88, 82, 72], [106, 98, 86], [124, 114, 100]], [[100, 92, 80], [148, 78, 42], [180, 98, 56], [202, 118, 72]]);
  wood('jungle', [[120, 86, 56], [142, 104, 70], [160, 118, 84], [180, 136, 100]], [[48, 36, 14], [72, 56, 22], [96, 76, 34], [120, 96, 46]], [[74, 58, 26], [150, 114, 66], [172, 134, 84], [192, 156, 104]]);
  wood('dark_oak', [[40, 24, 10], [54, 34, 16], [66, 43, 22], [82, 55, 30]], [[24, 16, 6], [38, 26, 10], [56, 40, 18], [76, 58, 30]], [[34, 24, 10], [70, 48, 24], [92, 66, 34], [114, 82, 46]]);
  // leaves: same gray-leaf structure with more (jungle, dark oak) or differently placed (acacia) foliage; tinted by the biome at draw time
  (function () {
    var src = TB.tiles.oak_leaves; if (!src) return;
    function variant(name, fill, transpose, seed) {
      var r = mulberry32(seed), t = T();
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var sx = transpose ? y : x, sy = transpose ? x : y, si = (sy * 16 + sx) * 4, o = (y * 16 + x) * 4;
        if (src[si + 3] > 0) { t[o] = src[si]; t[o + 1] = src[si + 1]; t[o + 2] = src[si + 2]; t[o + 3] = 255; }
        else if (r() < fill) { var g = 120 + ((r() * 60) | 0); t[o] = t[o + 1] = t[o + 2] = g; t[o + 3] = 255; }
      }
      add(name, t);
    }
    variant('acacia_leaves', 0.15, true, 71); variant('jungle_leaves', 0.5, false, 72); variant('dark_oak_leaves', 0.8, true, 73);
  })();
  // saplings: recoloured oak sapling (leaf pixels vs trunk pixels get different tints)
  (function () {
    var src = TB.tiles.oak_sapling; if (!src) return;
    function sap(name, lf, tr) {
      var t = T();
      for (var i = 0; i < N; i++) {
        var a = src[i * 4 + 3]; t[i * 4 + 3] = a; if (!a) continue;
        var r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2], leaf = g > r + 18 && g > b + 18, m = leaf ? lf : tr;
        t[i * 4] = Math.min(255, r * m[0]); t[i * 4 + 1] = Math.min(255, g * m[1]); t[i * 4 + 2] = Math.min(255, b * m[2]);
      }
      add(name, t);
    }
    sap('acacia_sapling', [1.9, 1.0, 0.8], [0.85, 0.85, 0.9]); sap('jungle_sapling', [0.85, 1.12, 0.8], [1.0, 0.9, 0.8]); sap('dark_oak_sapling', [0.6, 0.75, 0.6], [0.6, 0.55, 0.5]);
  })();
  // terracotta family: nearly flat colour with a light dither, like 1.8's hardened clay
  (function () {
    function flat(name, c, seed) {
      var r = mulberry32(seed), t = T();
      for (var i = 0; i < N; i++) { var k = 0.93 + r() * 0.1 + (r() < 0.08 ? -0.05 : 0); t[i * 4] = c[0] * k; t[i * 4 + 1] = c[1] * k; t[i * 4 + 2] = c[2] * k; t[i * 4 + 3] = 255; }
      add(name, t);
    }
    flat('terracotta', [152, 94, 67], 301); flat('orange_terracotta', [161, 83, 37], 302); flat('yellow_terracotta', [186, 133, 36], 303); flat('red_terracotta', [143, 61, 46], 304);
    flat('brown_terracotta', [77, 51, 35], 305); flat('white_terracotta', [209, 178, 161], 306); flat('light_gray_terracotta', [135, 107, 98], 307);
  })();
  // red sand family from the sand tiles; coarse dirt = dirt with pale gravel speckles
  (function () {
    var ramp = [[146, 70, 22], [168, 82, 30], [184, 96, 36], [200, 112, 46]];
    if (have('sand')) add('red_sand', recolor(TB.tiles.sand, ramp));
    if (have('sandstone')) add('red_sandstone', recolor(TB.tiles.sandstone, ramp));
    if (have('sandstone_top')) add('red_sandstone_top', recolor(TB.tiles.sandstone_top, ramp));
    if (have('sandstone_bottom')) add('red_sandstone_bottom', recolor(TB.tiles.sandstone_bottom, ramp));
    if (have('dirt')) {
      var t = new Uint8ClampedArray(TB.tiles.dirt), r = mulberry32(909);
      for (var k = 0; k < 44; k++) { var x = (r() * 16) | 0, y = (r() * 16) | 0, g = 118 + ((r() * 40) | 0); px(t, x, y, [g + 14, g, g - 14]); if (r() < 0.5) px(t, x + 1, y, [g + 8, g - 4, g - 18]); }
      add('coarse_dirt', t);
    }
  })();

  /* ---- oak sign item icon (board on a stick) */
  (function () {
    var TI = G.TexItems; if (!TI || !TI.tiles || TI.tiles.oak_sign) return;
    var t = T(), p1 = [166, 132, 82], p2 = [148, 116, 70], edge = [98, 72, 40], stick = [112, 84, 48], stick2 = [88, 64, 34];
    for (var y = 2; y <= 8; y++) for (var x = 1; x <= 14; x++) px(t, x, y, ((x + y) & 1) ? p1 : p2);
    for (var x2 = 1; x2 <= 14; x2++) { px(t, x2, 2, edge); px(t, x2, 8, edge); }
    for (var y2 = 2; y2 <= 8; y2++) { px(t, 1, y2, edge); px(t, 14, y2, edge); }
    for (var y3 = 9; y3 <= 14; y3++) { px(t, 7, y3, stick); px(t, 8, y3, stick2); }
    px(t, 7, 15, stick2); px(t, 8, 15, stick2);
    TI.names.push('oak_sign'); TI.tiles.oak_sign = t;
  })();

  TB.size = TB.size || 16;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
