/* tex_medoh.js - procedural textures of the Divine Beast blocks ("ancient" Sheikah stone, carved relief, moss decks, energy lines).
 * Extends TexBlocks in place like tex_dims.js. Deterministic, DOM free. */
(function (G) {
  'use strict';
  var TB = G.TexBlocks;
  if (!TB) return;
  function rng(a) { return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function C(h) { var v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  function mul(c, k) { return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)]; }
  function T() { return new Uint8ClampedArray(1024); }
  function px(t, x, y, c) { var i = (((y & 15) << 4) | (x & 15)) << 2; t[i] = c[0]; t[i + 1] = c[1]; t[i + 2] = c[2]; t[i + 3] = 255; }
  function get(t, x, y) { var i = (((y & 15) << 4) | (x & 15)) << 2; return [t[i], t[i + 1], t[i + 2]]; }
  function add(name, tile) { if (TB.tiles[name]) return; TB.names.push(name); TB.tiles[name] = tile; }
  function addAnim(name, frameTime, frames) { if (TB.tiles[name]) return; TB.names.push(name); TB.tiles[name] = frames[0]; TB.animated[name] = { frameTime: frameTime, frames: frames }; }
  // tileable smooth noise 0..1 (two octaves of periodic value noise)
  function noise(seed) {
    var r = rng(seed), out = new Float32Array(256), o, n, g, x, y;
    var octs = [[4, 0.6], [8, 0.3]];
    for (o = 0; o < octs.length; o++) {
      n = octs[o][0]; g = new Float32Array(n * n); for (x = 0; x < g.length; x++) g[x] = r();
      for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
        var fx = x * n / 16, fy = y * n / 16, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        var a = g[(y0 % n) * n + (x0 % n)], b = g[(y0 % n) * n + ((x0 + 1) % n)], c = g[((y0 + 1) % n) * n + (x0 % n)], d = g[((y0 + 1) % n) * n + ((x0 + 1) % n)];
        out[y * 16 + x] += (a + (b - a) * tx + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty) * octs[o][1];
      }
    }
    for (x = 0; x < 256; x++) out[x] = out[x] / 0.9 + (r() - 0.5) * 0.16;
    return out;
  }
  // stone body: palette ramp (dark -> light) picked by noise
  function stone(seed, ramp, grain) {
    var t = T(), f = noise(seed), r = rng(seed * 7 + 3), i, k;
    for (i = 0; i < 256; i++) { k = Math.max(0, Math.min(0.999, f[i] + (r() - 0.5) * (grain || 0.12))); px(t, i & 15, i >> 4, ramp[Math.floor(k * ramp.length)]); }
    return t;
  }
  function ramp(list) { return list.map(C); }
  var TAN = ramp(['#9c7f4c', '#a88a54', '#b3955d', '#b99b62', '#c0a268', '#c9ac72']);
  var MID = ramp(['#6f5a37', '#78623c', '#826b42', '#8a7247', '#927a4d']);
  var DARK = ramp(['#3a3024', '#41362a', '#483c2e', '#4f4232', '#584a38']);
  var GOLD = ramp(['#c29d4c', '#cfab58', '#d8b663', '#e0c070', '#e8ca7e']);
  var MOSS = ramp(['#3f7a28', '#4a8a2e', '#569a35', '#62a83c', '#70b645', '#7fc24f']);
  var GREY = ramp(['#4a443a', '#544d42', '#5d564a', '#676052', '#72695a']);
  var RELIEF = C('#d9bf82'), RELIEF_HI = C('#efdca6'), RELIEF_LO = C('#8f7443');

  // relief bitmaps ('#' raised). SPIRAL = one squared Sheikah swirl per tile, FRIEZE = a running key band with border rails.
  var SPIRAL = ['................', '.##############.', '.##############.', '.##.............', '.##.............', '.##..##########.', '.##..##########.', '.##..##......##.',
    '.##..##......##.', '.##..##..##..##.', '.##..##..##..##.', '.##..######..##.', '.##..######..##.', '.##..........##.', '.##############.', '................'];
  var FRIEZE = ['################', '................', '.#############..', '.#############..', '.##.........##..', '.##.........##..', '.##..#####..##..', '.##..#####..##..',
    '.##..##.##..##..', '.##..##.##..##..', '.##..##.....##..', '.##..##.....##..', '.##..#########..', '.##..#########..', '................', '################'];
  var KEY = ['################', '................', '..##########..##', '..##########..##', '..##......##..##', '..##......##..##', '..##..##..##..##', '..##..##..##..##',
    '..##..##..##..##', '..##..##..##..##', '..##..##......##', '..##..##......##', '####..##########', '####..##########', '................', '################'];
  function relief(base, bits, col, hi, lo) {
    var t = new Uint8ClampedArray(base), x, y, on = function (x, y) { return bits[y & 15].charAt(x & 15) === '#'; };
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      if (on(x, y)) { var c = col; if (!on(x, y - 1) || !on(x - 1, y)) c = hi; else if (!on(x, y + 1) || !on(x + 1, y)) c = mix(col, lo, 0.45); px(t, x, y, mix(c, get(base, x, y), 0.12)); }
      else if (on(x, y - 1) || on(x - 1, y)) px(t, x, y, mul(get(base, x, y), 0.72));   // cast shadow below / right of the raised line
    }
    return t;
  }
  // mossy rim hanging over the top of a side face
  function mossRim(base, seed) {
    var t = new Uint8ClampedArray(base), r = rng(seed), x, y;
    for (x = 0; x < 16; x++) { var d = 2 + Math.floor(r() * 3) + (r() < 0.2 ? 2 : 0); for (y = 0; y < d; y++) px(t, x, y, MOSS[Math.min(5, Math.max(0, 4 - y + Math.floor(r() * 2)))]); px(t, x, d, mul(get(base, x, d), 0.75)); }
    return t;
  }

  var sTan = stone(101, TAN), sMid = stone(202, MID), sDark = stone(303, DARK), sGold = stone(404, GOLD, 0.06), sMoss = stone(505, MOSS, 0.3), sGrey = stone(606, GREY);
  // masonry seams: a soft joint on the bottom/right edge, a light bevel on the top/left edge
  function seams(base, k1, k2) { var t = new Uint8ClampedArray(base), i; for (i = 0; i < 16; i++) { px(t, i, 15, mul(get(base, i, 15), k1)); px(t, 15, i, mul(get(base, 15, i), k1)); px(t, i, 0, mul(get(base, i, 0), k2)); px(t, 0, i, mul(get(base, 0, i), k2)); } return t; }
  add('ancient_stone', seams(sTan, 0.8, 1.07));
  add('ancient_stone_mid', seams(sMid, 0.82, 1.06));
  add('ancient_stone_dark', seams(sDark, 0.8, 1.1));
  // gold trim: smooth, two engraved rails
  (function () { var t = new Uint8ClampedArray(sGold), x; for (x = 0; x < 16; x++) { px(t, x, 3, C('#a98440')); px(t, x, 4, C('#f1d892')); px(t, x, 11, C('#a98440')); px(t, x, 12, C('#f1d892')); } add('ancient_gold', t);
    var u = new Uint8ClampedArray(sGold); for (x = 0; x < 16; x++) { px(u, x, 0, C('#f1d892')); px(u, 0, x, C('#f1d892')); px(u, x, 15, C('#a98440')); px(u, 15, x, C('#a98440')); } for (x = 5; x < 11; x++) { px(u, x, 5, C('#a98440')); px(u, x, 10, C('#f1d892')); px(u, 5, x, C('#a98440')); px(u, 10, x, C('#f1d892')); } add('ancient_gold_top', u); })();
  add('ancient_carved', relief(sMid, FRIEZE, RELIEF, RELIEF_HI, RELIEF_LO));
  add('ancient_carved_top', relief(sMid, SPIRAL, RELIEF, RELIEF_HI, RELIEF_LO));
  add('ancient_carved_dark', relief(sDark, KEY, C('#c4a86e'), C('#e2cc94'), C('#7d6439')));
  add('ancient_carved_dark_top', relief(sDark, SPIRAL, C('#c4a86e'), C('#e2cc94'), C('#7d6439')));
  // moss deck
  (function () { var t = new Uint8ClampedArray(sMoss), r = rng(77), i; for (i = 0; i < 7; i++) px(t, Math.floor(r() * 16), Math.floor(r() * 16), C('#a9b860')); for (i = 0; i < 5; i++) px(t, Math.floor(r() * 16), Math.floor(r() * 16), C('#356a22')); add('ancient_moss_top', t); })();
  add('ancient_moss_side', mossRim(TB.tiles.ancient_stone, 31));
  add('ancient_moss_carved_top', relief(sMoss, SPIRAL, C('#d6b872'), C('#ecd598'), C('#8a7a3c')));
  add('ancient_moss_carved_side', mossRim(TB.tiles.ancient_carved, 47));
  // weathered monolith
  (function () { var t = new Uint8ClampedArray(sGrey), x, y; for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) { var m = x % 4; if (m === 3) px(t, x, y, mul(get(sGrey, x, y), 0.68)); else if (m === 0) px(t, x, y, mul(get(sGrey, x, y), 1.14)); }
    for (x = 0; x < 16; x++) { px(t, x, 0, C('#8a8070')); px(t, x, 1, C('#3c372f')); px(t, x, 14, C('#3c372f')); px(t, x, 15, C('#7a7163')); } add('ancient_pillar', t);
    var u = seams(sGrey, 0.7, 1.2); for (x = 4; x < 12; x++) { px(u, x, 4, C('#3c372f')); px(u, x, 11, C('#8a8070')); px(u, 4, x, C('#3c372f')); px(u, 11, x, C('#8a8070')); } add('ancient_pillar_top', u); })();
  // energy: a shimmering plasma, brightest along drifting veins
  function energy(name, core, mid, edge, seed) {
    var f = noise(seed), g = noise(seed + 9), frames = [], n = 12, k, i;
    for (k = 0; k < n; k++) {
      var t = T(), ph = k / n * Math.PI * 2;
      for (i = 0; i < 256; i++) { var v = 0.5 + 0.5 * Math.sin(f[i] * 9 + ph) * 0.6 + (g[i] - 0.5) * 0.5 + 0.12 * Math.sin(ph + (i >> 4) * 0.8); v = Math.max(0, Math.min(1, v)); px(t, i & 15, i >> 4, v > 0.62 ? mix(mid, core, (v - 0.62) / 0.38) : mix(edge, mid, v / 0.62)); }
      frames.push(t);
    }
    addAnim(name, 3, frames);
  }
  energy('ancient_glow_blue', C('#e6feff'), C('#58e2ff'), C('#1c9ff0'), 808);
  energy('ancient_glow_orange', C('#fff0c0'), C('#ffb347'), C('#f47a1c'), 909);
  energy('ancient_beam', C('#ffe0e0'), C('#ff4a55'), C('#e01228'), 1010);
})(typeof globalThis !== 'undefined' ? globalThis : this);
