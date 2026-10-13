/* tex_dims_mobs.js - entity skins of the dimensions update (villagers + profession overlays, golems, nether mobs, end crystal,
 * the ender dragon) and the End sky. Extends TexEntities.skins ({w,h,data}) and TexEntities.env. Deterministic, DOM free.
 * Box unwrap (MC): top=(u+d,v,w,d) bottom=(u+d+w,v,w,d) right=(u,v+d,d,h) front=(u+d,v+d,w,h) left=(u+d+w,v+d,d,h) back=(u+2d+w,v+d,w,h) */
(function (G) {
  'use strict';
  var TE = G.TexEntities; if (!TE || !TE.skins) return;
  function mulberry(a) { return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function Img(w, h) { return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) }; }
  function C(h) { var v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  function put(im, x, y, c, a) { if (x < 0 || y < 0 || x >= im.w || y >= im.h) return; var i = (y * im.w + x) * 4; im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = a === undefined ? 255 : a; }
  function faces(u, v, w, h, d) { return { top: [u + d, v, w, d], bottom: [u + d + w, v, w, d], right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h] }; }
  function fillR(im, r, fn) { for (var y = 0; y < r[3]; y++) for (var x = 0; x < r[2]; x++) { var c = fn(x, y, r[2], r[3]); if (c) put(im, r[0] + x, r[1] + y, c, c[3]); } }
  function jit(c, k) { return [Math.max(0, Math.min(255, c[0] * k)), Math.max(0, Math.min(255, c[1] * k)), Math.max(0, Math.min(255, c[2] * k))]; }
  // paint every face of a box with fn(face, x, y, w, h) -> colour
  function box(im, u, v, w, h, d, fn) { var F = faces(u, v, w, h, d); for (var k in F) (function (k) { fillR(im, F[k], function (x, y, ww, hh) { return fn(k, x, y, ww, hh); }); })(k); return F; }
  function noisy(base, r, amt) { return jit(base, 1 - amt / 2 + r() * amt); }

  /* ================================================================ villagers */
  var VTYPES = {
    plains: { robe: C('#6b4a2b'), robe2: C('#5a3d22'), trim: C('#3d2a18'), legs: C('#3a2a1c') },
    desert: { robe: C('#c9a66b'), robe2: C('#b8925a'), trim: C('#b04a26'), legs: C('#8a6a40') },
    savanna: { robe: C('#a0522d'), robe2: C('#8a4524'), trim: C('#e0b24a'), legs: C('#5e3018') },
    taiga: { robe: C('#4a3a28'), robe2: C('#3d3020'), trim: C('#8a7a64'), legs: C('#2e241a') },
    snowy: { robe: C('#dfe6ee'), robe2: C('#c8d3e0'), trim: C('#4a6a9c'), legs: C('#5a6a80') },
  };
  var SKIN = [C('#b8876a'), C('#a87a5e'), C('#c99a7c')];
  function villagerBase(type) {
    var T = VTYPES[type], im = Img(64, 64), r = mulberry(type.length * 97 + 13);
    box(im, 0, 0, 8, 10, 8, function () { return noisy(SKIN[(r() * 3) | 0], r, 0.08); });
    var fr = faces(0, 0, 8, 10, 8).front;    // x 8..15, y 8..17
    for (var x = 1; x <= 6; x++) put(im, fr[0] + x, fr[1] + 3, C('#4a3020'));                       // unibrow
    put(im, fr[0] + 1, fr[1] + 4, C('#e8e8e8')); put(im, fr[0] + 2, fr[1] + 4, C('#2f7a3a'));      // eyes: white + green iris
    put(im, fr[0] + 5, fr[1] + 4, C('#2f7a3a')); put(im, fr[0] + 6, fr[1] + 4, C('#e8e8e8'));
    for (var x2 = 2; x2 <= 5; x2++) put(im, fr[0] + x2, fr[1] + 8, C('#8a5a40'));
    fillR(im, faces(0, 0, 8, 10, 8).top, function () { return noisy(type === 'snowy' ? C('#9aa6b8') : C('#5a3d24'), r, 0.15); });
    box(im, 24, 0, 2, 4, 2, function (k, x, y) { return k === 'front' && y === 3 ? C('#7a4e36') : noisy(C('#a06e52'), r, 0.06); });
    box(im, 16, 20, 8, 12, 6, function (k, x, y) { return y === 10 && k !== 'top' && k !== 'bottom' ? T.trim : noisy(T.robe, r, 0.12); });
    box(im, 0, 38, 8, 18, 6, function (k, x, y, w, h) {
      if (k === 'top' || k === 'bottom') return noisy(T.robe2, r, 0.1);
      if (y >= h - 2) return T.trim;
      if (y === 10) return jit(T.trim, 0.9);
      if (type === 'desert' && (x + y) % 6 === 0 && y > 11) return T.trim;
      if (type === 'savanna' && y > 12 && (x % 4 === 1) && y % 3 === 0) return T.trim;
      if (type === 'taiga' && y < 3) return noisy(T.trim, r, 0.2);
      if (type === 'snowy' && (y === 6 || y === 14)) return T.trim;
      return noisy(y < 10 ? T.robe : T.robe2, r, 0.12);
    });
    box(im, 44, 22, 4, 8, 4, function (k, x, y) { return (k === 'right' || k === 'left' || k === 'front' || k === 'back') && y < 4 ? noisy(SKIN[1], r, 0.06) : noisy(T.robe, r, 0.12); });
    box(im, 40, 38, 8, 4, 4, function (k, x) { return (k === 'front' || k === 'top' || k === 'back') && x >= 2 && x <= 5 ? noisy(SKIN[0], r, 0.06) : noisy(T.robe, r, 0.12); });
    box(im, 0, 22, 4, 12, 4, function (k, x, y, w, h) { return y >= h - 2 ? C('#2a1e14') : noisy(T.legs, r, 0.12); });
    return im;
  }
  // profession overlays: transparent except the clothing details (drawn over the base with the same geometry)
  function profOverlay(prof) {
    var im = Img(64, 64), r = mulberry(prof.length * 131 + 7);
    var hat = faces(32, 0, 8, 10, 8), jacket = faces(0, 38, 8, 18, 6), body = faces(16, 20, 8, 12, 6), arms = faces(44, 22, 4, 8, 4), mid = faces(40, 38, 8, 4, 4);
    var rim = faces(30, 47, 16, 16, 1);   // hat brim (16x16 plate, its front face looks up once rotated)
    function fillF(F, keys, fn) { keys.forEach(function (k) { fillR(im, F[k], fn); }); }
    var ALL = ['top', 'right', 'front', 'left', 'back'], SIDES = ['right', 'front', 'left', 'back'];
    function hatBand(col, rows, band) { fillF(hat, ['top'], function () { return noisy(col, r, 0.15); }); fillF(hat, SIDES, function (x, y) { return y < rows ? noisy(col, r, 0.15) : (band && y === rows ? band : null); }); }
    function apron(col, stains) { fillR(im, jacket.front, function (x, y) { if (x < 1 || x > 6 || y < 1 || y > 17) return null; if (stains && r() < 0.08) return stains; return noisy(col, r, 0.1); }); fillR(im, body.front, function (x, y) { return x >= 1 && x <= 6 && y >= 2 ? noisy(col, r, 0.1) : null; }); }
    function robe(col, trim) { fillF(jacket, ALL, function (x, y, w, h) { return y >= h - 2 && trim ? trim : noisy(col, r, 0.12); }); fillF(body, ALL, function () { return noisy(col, r, 0.12); }); fillF(arms, ['right', 'front', 'left', 'back', 'bottom'], function (x, y) { return y >= 4 ? noisy(col, r, 0.12) : null; }); fillF(mid, ['right', 'left', 'bottom'], function () { return noisy(col, r, 0.12); }); }
    function gloves(col) { fillF(arms, SIDES, function (x, y) { return y < 3 ? col : null; }); fillF(mid, ['front', 'top', 'back'], function (x) { return x >= 2 && x <= 5 ? col : null; }); }
    var fr = hat.front;
    switch (prof) {
      case 'farmer': hatBand(C('#d6b85a'), 3, C('#8a5a2a')); apron(C('#a8875a')); fillR(im, rim.front, function (x, y) { var dx = x - 7.5, dy = y - 7.5; return dx * dx + dy * dy < 60 ? noisy(C('#d6b85a'), r, 0.15) : null; }); fillR(im, rim.back, function (x, y) { var dx = x - 7.5, dy = y - 7.5; return dx * dx + dy * dy < 60 ? noisy(C('#b89a48'), r, 0.15) : null; }); break;
      case 'fisherman': hatBand(C('#c8a868'), 3, C('#2f6a6a')); fillR(im, jacket.front, function (x, y) { return y < 9 ? noisy(C('#2f6a6a'), r, 0.1) : null; }); fillR(im, rim.front, function (x, y) { var dx = x - 7.5, dy = y - 7.5; return dx * dx + dy * dy < 50 ? noisy(C('#c8a868'), r, 0.15) : null; }); fillR(im, rim.back, function (x, y) { var dx = x - 7.5, dy = y - 7.5; return dx * dx + dy * dy < 50 ? noisy(C('#a88a50'), r, 0.15) : null; }); break;
      case 'librarian': hatBand(C('#7a1f1f'), 2, C('#d8d0b8')); fillR(im, jacket.front, function (x) { return x === 3 || x === 4 ? C('#e8e2d0') : noisy(C('#2a2a2e'), r, 0.1); }); fillF(jacket, ['right', 'left', 'back'], function () { return noisy(C('#2a2a2e'), r, 0.1); }); break;
      case 'cleric': robe(C('#6b3a8a'), C('#e0b24a')); fillF(hat, ['top'], function () { return noisy(C('#6b3a8a'), r, 0.1); }); break;
      case 'armorer': for (var x = 0; x < 8; x++) { put(im, fr[0] + x, fr[1] + 3, C('#5a5a5a')); put(im, fr[0] + x, fr[1] + 4, x === 1 || x === 2 || x === 5 || x === 6 ? C('#1c1c1c') : C('#3a3a3a')); put(im, fr[0] + x, fr[1] + 5, C('#5a5a5a')); } apron(C('#2a2a2a')); gloves(C('#4a4a4a')); break;
      case 'butcher': apron(C('#e8e8e8'), C('#a02020')); for (var x3 = 0; x3 < 8; x3++) put(im, fr[0] + x3, fr[1] + 2, C('#e8e8e8')); fillF(hat, ['right', 'left', 'back'], function (x, y) { return y === 2 ? C('#e8e8e8') : null; }); break;
      case 'cartographer': [[0, 3], [1, 3], [2, 3], [0, 5], [1, 5], [2, 5], [0, 4], [3, 4]].forEach(function (p) { put(im, fr[0] + 4 + p[0], fr[1] + p[1], C('#e8c040')); }); fillR(im, jacket.front, function (x, y) { return y < 10 ? noisy(C('#3a5a8a'), r, 0.1) : null; }); fillR(im, body.front, function () { return noisy(C('#3a5a8a'), r, 0.1); }); break;
      case 'fletcher': hatBand(C('#4a7a3a'), 3, null); fillF(hat, ['left'], function (x, y) { return y < 6 && x === 4 ? C('#f2f2f2') : null; }); fillR(im, jacket.front, function (x, y) { return y < 12 ? noisy(C('#4a7a3a'), r, 0.1) : null; }); break;
      case 'leatherworker': apron(C('#7a4a2a')); gloves(C('#6a3a1a')); break;
      case 'mason': apron(C('#3a3a3a')); gloves(C('#7a7a7a')); break;
      case 'shepherd': hatBand(C('#6a4a2a'), 3, C('#3a2a1a')); fillF(jacket, ['right', 'left', 'back', 'front'], function (x, y) { return y < 9 && (x === 0 || x >= 5) ? noisy(C('#e8e4dc'), r, 0.1) : null; }); break;
      case 'toolsmith': apron(C('#2a2a2a')); gloves(C('#5a5a5a')); break;
      case 'weaponsmith': [[1, 3], [2, 3], [1, 4], [2, 4]].forEach(function (p) { put(im, fr[0] + p[0], fr[1] + p[1], C('#121212')); }); for (var x4 = 0; x4 < 8; x4++) put(im, fr[0] + x4, fr[1] + 2, C('#2a2a2a')); apron(C('#1e1e1e')); break;
      case 'nitwit': robe(C('#3e6e3a'), C('#2a4a26')); break;
    }
    return im;
  }
  for (var vt in VTYPES) TE.skins['villager_' + vt] = villagerBase(vt);
  ['farmer', 'fisherman', 'librarian', 'cleric', 'armorer', 'butcher', 'cartographer', 'fletcher', 'leatherworker', 'mason', 'shepherd', 'toolsmith', 'weaponsmith', 'nitwit'].forEach(function (p) { TE.skins['villager_prof_' + p] = profOverlay(p); });

  /* ================================================================ iron golem (128x128) */
  (function () {
    var im = Img(128, 128), r = mulberry(7001), I = [C('#c9c4bb'), C('#b3aea5'), C('#9c978e')];
    function iron() { var c = noisy(I[(r() * 3) | 0], r, 0.1); if (r() < 0.05) c = C('#8a857c'); return c; }
    box(im, 0, 0, 8, 10, 8, iron);
    var fr = faces(0, 0, 8, 10, 8).front;
    for (var x = 0; x < 8; x++) put(im, fr[0] + x, fr[1] + 2, C('#8a857c'));
    [[1, 4], [2, 4], [5, 4], [6, 4]].forEach(function (p) { put(im, fr[0] + p[0], fr[1] + p[1], C('#3a1010')); });
    put(im, fr[0] + 2, fr[1] + 4, C('#a02020')); put(im, fr[0] + 5, fr[1] + 4, C('#a02020'));
    box(im, 24, 0, 2, 4, 2, iron);
    box(im, 0, 40, 18, 12, 11, function (k, x, y) { var c = iron(); if (k === 'front' && (y < 2 || x < 1 || x > 16)) c = jit(c, 0.85); if ((k === 'front' || k === 'right') && y > 6 && x > 3 && x < 8 && r() < 0.6) c = r() < 0.5 ? C('#4f7a2e') : C('#3d6022'); return c; });
    box(im, 0, 70, 9, 5, 6, iron);
    var arm = function (k, x, y, w, h) { var c = iron(); if (y > h - 6) c = jit(c, 0.9); if (k === 'front' && y > 8 && y < 18 && x === 1 && r() < 0.7) c = C('#4f7a2e'); return c; };
    box(im, 60, 21, 4, 30, 6, arm); box(im, 60, 58, 4, 30, 6, arm);
    var leg = function (k, x, y, w, h) { var c = iron(); if (y > h - 3) c = C('#6e6a63'); if (k === 'front' && y < 5 && x > 2 && r() < 0.5) c = C('#4f7a2e'); return c; };
    box(im, 37, 0, 6, 16, 5, leg); box(im, 60, 0, 6, 16, 5, leg);
    TE.skins.iron_golem = im;
  })();
  /* ================================================================ snow golem (64x64): carved pumpkin head, snow body, stick arms */
  (function () {
    var im = Img(64, 64), r = mulberry(7101);
    box(im, 0, 0, 8, 8, 8, function (k, x) { if (k === 'top' || k === 'bottom') return noisy(C('#c47a18'), r, 0.15); return noisy(x % 3 === 0 ? C('#b8700f') : C('#e08f1f'), r, 0.1); });
    var fr = faces(0, 0, 8, 8, 8).front;
    [[1, 2], [2, 2], [5, 2], [6, 2], [1, 3], [6, 3], [2, 5], [3, 6], [4, 6], [5, 5], [3, 5], [4, 5]].forEach(function (p) { put(im, fr[0] + p[0], fr[1] + p[1], C('#3a1e04')); });
    var snow = function () { return noisy(C('#f2f6f8'), r, 0.08); };
    box(im, 0, 16, 10, 10, 10, snow); box(im, 0, 36, 12, 12, 12, snow);
    box(im, 32, 0, 12, 2, 2, function () { return noisy(C('#6b4a24'), r, 0.15); });
    TE.skins.snow_golem = im;
  })();

  /* ================================================================ nether mobs */
  function ghast(shooting) {
    var im = Img(64, 32), r = mulberry(shooting ? 7202 : 7201);
    box(im, 0, 0, 16, 16, 16, function (k, x, y) { var c = noisy(C('#f0f0f0'), r, 0.06); if (r() < 0.05) c = C('#d8d8d8'); if (k === 'bottom' && (x + y) % 5 === 0) c = C('#cfcfcf'); return c; });
    fillR(im, [0, 0, 16, 16], function () { return noisy(C('#e6e6e6'), r, 0.08); });      // the tentacles sample this corner
    var fr = faces(0, 0, 16, 16, 16).front;
    if (!shooting) {
      [[3, 6], [4, 6], [5, 6], [10, 6], [11, 6], [12, 6], [4, 7], [11, 7]].forEach(function (p) { put(im, fr[0] + p[0], fr[1] + p[1], C('#7a7a7a')); });
      for (var x = 5; x <= 10; x++) put(im, fr[0] + x, fr[1] + 11, C('#8a8a8a')); put(im, fr[0] + 4, fr[1] + 12, C('#8a8a8a')); put(im, fr[0] + 11, fr[1] + 12, C('#8a8a8a'));
      [[3, 8], [12, 8], [4, 9]].forEach(function (p) { put(im, fr[0] + p[0], fr[1] + p[1], C('#c0c0c0')); });
    } else {
      for (var ex = 0; ex < 3; ex++) for (var ey = 0; ey < 3; ey++) { put(im, fr[0] + 3 + ex, fr[1] + 5 + ey, ey === 1 && ex === 1 ? C('#ff3a3a') : C('#7a1010')); put(im, fr[0] + 10 + ex, fr[1] + 5 + ey, ey === 1 && ex === 1 ? C('#ff3a3a') : C('#7a1010')); }
      for (var mx = 5; mx <= 10; mx++) for (var my = 10; my <= 13; my++) put(im, fr[0] + mx, fr[1] + my, my === 10 || my === 13 || mx === 5 || mx === 10 ? C('#5a0a0a') : C('#2a0000'));
    }
    return im;
  }
  TE.skins.ghast = ghast(false); TE.skins.ghast_shooting = ghast(true);
  (function () {
    var im = Img(64, 32), r = mulberry(7301), Y = [C('#f2c94c'), C('#e9a63a'), C('#ffe07a'), C('#c9861c')];
    box(im, 0, 0, 8, 8, 8, function () { return noisy(Y[(r() * 4) | 0], r, 0.1); });
    var fr = faces(0, 0, 8, 8, 8).front;
    [[1, 3], [2, 3], [5, 3], [6, 3]].forEach(function (p) { put(im, fr[0] + p[0], fr[1] + p[1], C('#3a1e04')); });
    put(im, fr[0] + 2, fr[1] + 3, C('#1a0a00')); put(im, fr[0] + 5, fr[1] + 3, C('#1a0a00'));
    for (var x = 2; x <= 5; x++) put(im, fr[0] + x, fr[1] + 6, C('#7a4a10'));
    box(im, 0, 16, 2, 8, 2, function (k, x, y) { return y % 3 === 0 ? C('#c9861c') : noisy(C('#ffcc3a'), r, 0.12); });
    TE.skins.blaze = im;
  })();
  function piglinSkin(zombified) {
    var im = Img(64, 64), r = mulberry(zombified ? 7402 : 7401);
    var flesh = zombified ? [C('#e09c94'), C('#cf8a83'), C('#6b8a4f')] : [C('#f0a3a0'), C('#e6928f'), C('#f5b4b0')];
    var fl = function () { var c = flesh[r() < (zombified ? 0.25 : 0) ? 2 : (r() * 2) | 0]; return noisy(c, r, 0.1); };
    box(im, 0, 0, 10, 8, 8, fl);
    var fr = faces(0, 0, 10, 8, 8).front;
    put(im, fr[0] + 2, fr[1] + 3, C('#ffffff')); put(im, fr[0] + 3, fr[1] + 3, C('#5a2a1a')); put(im, fr[0] + 6, fr[1] + 3, C('#5a2a1a')); put(im, fr[0] + 7, fr[1] + 3, C('#ffffff'));
    if (zombified) for (var y = 0; y < 8; y++) for (var x = 0; x < 4; x++) if (r() < 0.6) put(im, fr[0] + x, fr[1] + y, x === 1 && y > 3 ? C('#e8e4d4') : C('#c8c2b0'));
    box(im, 31, 1, 4, 4, 1, function (k, x, y) { return k === 'front' && y === 2 && (x === 1 || x === 2) ? C('#7a3a3a') : noisy(C('#e88a8a'), r, 0.08); });
    box(im, 2, 0, 1, 2, 1, function () { return C('#f0e8d0'); }); box(im, 2, 4, 1, 2, 1, function () { return C('#f0e8d0'); });
    box(im, 51, 6, 1, 5, 4, fl); box(im, 39, 6, 1, 5, 4, fl);
    box(im, 16, 16, 8, 12, 4, function (k, x, y) { if (y >= 9) return noisy(zombified ? C('#5a4a2a') : C('#6b4a2a'), r, 0.12); return fl(); });
    box(im, 40, 16, 4, 12, 4, fl); box(im, 32, 48, 4, 12, 4, fl);
    box(im, 0, 16, 4, 12, 4, function (k, x, y) { return y < 4 ? noisy(C('#6b4a2a'), r, 0.12) : y > 10 ? C('#3a2a1a') : fl(); });
    box(im, 16, 48, 4, 12, 4, function (k, x, y) { return y < 4 ? noisy(C('#6b4a2a'), r, 0.12) : y > 10 ? C('#3a2a1a') : fl(); });
    if (!zombified) { put(im, 51, 13, C('#f9d65b')); put(im, 39, 13, C('#f9d65b')); fillR(im, [20, 28, 8, 1], function () { return C('#f9d65b'); }); }
    return im;
  }
  TE.skins.piglin = piglinSkin(false); TE.skins.zombified_piglin = piglinSkin(true);
  (function () {
    var im = Img(128, 64), r = mulberry(7501), F = [C('#a76b5c'), C('#8e5547'), C('#c08374'), C('#7a463a')];
    var fur = function () { return noisy(F[(r() * 4) | 0], r, 0.1); };
    var hoof = function (k, x, y, w, h) { return y > h - 3 ? C('#4a2a1e') : fur(); };
    var horn = function (k, x, y) { return y < 2 ? C('#fffaf0') : noisy(C('#e5dcc4'), r, 0.06); };
    box(im, 1, 1, 16, 14, 26, fur);
    box(im, 90, 33, 0, 10, 19, function () { return noisy(C('#5a3a2e'), r, 0.15); });
    box(im, 61, 1, 14, 6, 19, function (k, x, y) { if (k === 'front' && y >= 2 && (x === 4 || x === 9)) return C('#3a1e14'); return fur(); });
    box(im, 1, 1, 6, 1, 4, fur); box(im, 1, 6, 6, 1, 4, fur);
    box(im, 10, 13, 2, 11, 2, horn); box(im, 1, 13, 2, 11, 2, horn);
    box(im, 66, 42, 6, 14, 6, hoof); box(im, 41, 42, 6, 14, 6, hoof); box(im, 21, 45, 5, 11, 5, hoof); box(im, 0, 45, 5, 11, 5, hoof);
    TE.skins.hoglin = im;
  })();
  (function () {
    var im = Img(64, 128), r = mulberry(7601);
    box(im, 0, 0, 16, 14, 16, function (k, x, y) { return noisy(y % 4 === 0 ? C('#7f1f2a') : C('#a32e2e'), r, 0.1); });
    var fr = faces(0, 0, 16, 14, 16).front;
    put(im, fr[0] + 4, fr[1] + 4, C('#1a0a10')); put(im, fr[0] + 11, fr[1] + 4, C('#1a0a10'));
    for (var x = 4; x <= 11; x++) put(im, fr[0] + x, fr[1] + 9, C('#4a1830'));
    var leg = function (k, x, y) { return noisy(y > 13 ? C('#3a2030') : C('#8a3a4a'), r, 0.1); };
    box(im, 0, 32, 4, 16, 4, leg); box(im, 0, 55, 4, 16, 4, leg);
    TE.skins.strider = im;
  })();
  (function () {
    var im = Img(64, 32), r = mulberry(7701);
    box(im, 0, 0, 8, 8, 8, function (k, x, y) { var crack = (x * 7 + y * 3) % 11 < 2 || (x + y * 5) % 9 === 0; return crack ? (r() < 0.5 ? C('#ff9a2a') : C('#ffd04a')) : noisy(C('#3a1a12'), r, 0.25); });
    var fr = faces(0, 0, 8, 8, 8).front;
    [[1, 2], [2, 2], [5, 2], [6, 2]].forEach(function (p) { put(im, fr[0] + p[0], fr[1] + p[1], C('#ffe27a')); }); put(im, fr[0] + 2, fr[1] + 2, C('#ff3a10')); put(im, fr[0] + 5, fr[1] + 2, C('#ff3a10'));
    box(im, 32, 0, 4, 4, 4, function () { return noisy(C('#ff8a1a'), r, 0.2); });
    TE.skins.magma_cube = im;
  })();
  (function () {
    var im = Img(64, 32), r = mulberry(7801), B = [C('#2b2b2b'), C('#1c1c1c'), C('#3a3a3a')];
    var bone = function () { return noisy(B[(r() * 3) | 0], r, 0.1); };
    box(im, 0, 0, 8, 8, 8, bone);
    var fr = faces(0, 0, 8, 8, 8).front;
    [[1, 3], [2, 3], [5, 3], [6, 3], [1, 4], [2, 4], [5, 4], [6, 4]].forEach(function (p) { put(im, fr[0] + p[0], fr[1] + p[1], C('#050505')); });
    for (var x = 2; x <= 5; x++) put(im, fr[0] + x, fr[1] + 6, x % 2 ? C('#4a4a4a') : C('#080808'));
    box(im, 16, 16, 8, 12, 4, function (k, x, y) { return y % 3 === 0 && x > 0 && x < 7 ? C('#4a4a4a') : (x === 3 || x === 4) ? bone() : (k === 'front' ? C('#0a0a0a') : bone()); });
    box(im, 40, 16, 2, 12, 2, bone); box(im, 0, 16, 2, 12, 2, bone);
    TE.skins.wither_skeleton = im;
  })();
  (function () {
    var im = Img(64, 32), r = mulberry(7901), S = [C('#8a8a8a'), C('#6e6e6e'), C('#a8a8a8')];
    var seg = function () { return noisy(S[(r() * 3) | 0], r, 0.1); };
    [[0, 0, 3, 2, 2], [0, 4, 4, 3, 2], [0, 9, 6, 4, 3], [0, 16, 3, 3, 3], [0, 22, 2, 2, 3], [11, 0, 2, 1, 2], [13, 4, 1, 1, 2]].forEach(function (b) { box(im, b[0], b[1], b[2], b[3], b[4], seg); });
    [[20, 0, 10, 8, 3], [20, 11, 6, 4, 3], [20, 18, 6, 5, 2]].forEach(function (b) { box(im, b[0], b[1], b[2], b[3], b[4], function () { return noisy(C('#5e5e5e'), r, 0.2); }); });
    TE.skins.silverfish = im;
  })();
  (function () {
    var im = Img(64, 32), r = mulberry(8001);
    box(im, 0, 0, 8, 8, 8, function (k, x, y) { var edge = x === 0 || y === 0 || x === 7 || y === 7; return edge ? [220, 240, 248, 230] : [170, 205, 220, 70]; });
    box(im, 32, 0, 8, 8, 8, function (k, x, y) { return (x + y) % 2 ? C('#e85fc9') : C('#b8329a'); });
    box(im, 0, 16, 12, 4, 12, function (k) { return noisy(k === 'top' ? C('#2a2a2e') : C('#3a3a3e'), r, 0.25); });
    TE.skins.end_crystal = im;
  })();

  /* ================================================================ the ender dragon (256x256) */
  (function () {
    var im = Img(256, 256), r = mulberry(8101);
    var scale = function (k, x, y) { var c = (x + (y >> 1)) % 4 === 0 || y % 4 === 0 ? C('#100c14') : C('#1c1622'); if (r() < 0.1) c = C('#2a2130'); if (k === 'bottom') c = jit(C('#2a2430'), 0.9 + r() * 0.2); return c; };
    var spine = function () { return noisy(C('#3a3240'), r, 0.15); };
    box(im, 0, 0, 24, 24, 64, scale);                 // body
    box(im, 0, 0, 16, 32, 16, scale);                 // rear leg
    box(im, 196, 0, 12, 32, 12, scale);               // rear leg tip
    box(im, 112, 0, 18, 6, 24, scale);                // rear foot
    box(im, 112, 30, 16, 16, 16, scale);              // upper head
    box(im, 176, 44, 12, 5, 16, scale);               // upper lip
    box(im, 176, 65, 12, 4, 16, scale);               // jaw
    box(im, 0, 0, 2, 4, 6, spine);                    // head scales (spikes)
    box(im, 112, 0, 2, 2, 4, function () { return C('#0a080c'); });   // nostrils
    box(im, 192, 104, 10, 10, 10, scale);             // neck / tail segment
    box(im, 48, 0, 2, 4, 6, spine);                   // segment spine
    box(im, 220, 53, 2, 6, 12, spine);                // body spines
    box(im, 112, 88, 56, 8, 8, scale);                // wing bone
    box(im, 112, 136, 56, 4, 4, scale);               // wing tip bone
    box(im, 112, 104, 8, 24, 8, scale);               // front leg
    box(im, 226, 138, 6, 24, 6, scale);               // front leg tip
    box(im, 144, 104, 8, 4, 16, scale);               // front foot
    // wing membranes (zero-thickness boxes: top/bottom faces 56x56 at (0,88)/(56,88) and (0,144)/(56,144))
    var memb = function (x, y) { var bone = x % 14 === 0 || y < 2; var c = bone ? C('#2a2232') : C('#3a3446'); if (y > 40 && !bone) c = jit(c, 1 - (y - 40) / 80); var n = noisy(c, r, 0.08); n.push(bone ? 255 : 235); return n; };
    fillR(im, [0, 88, 56, 56], memb); fillR(im, [56, 88, 56, 56], memb); fillR(im, [0, 144, 56, 56], memb); fillR(im, [56, 144, 56, 56], memb);
    var hf = faces(112, 30, 16, 16, 16).front;
    for (var ex = 0; ex < 3; ex++) { put(im, hf[0] + 2 + ex, hf[1] + 6, C('#e070ff')); put(im, hf[0] + 11 + ex, hf[1] + 6, C('#e070ff')); put(im, hf[0] + 2 + ex, hf[1] + 7, C('#a030d0')); put(im, hf[0] + 11 + ex, hf[1] + 7, C('#a030d0')); }
    var hs = faces(112, 30, 16, 16, 16);
    for (var k2 = 0; k2 < 3; k2++) { put(im, hs.right[0] + 3 + k2, hs.right[1] + 6, C('#e070ff')); put(im, hs.left[0] + 10 + k2, hs.left[1] + 6, C('#e070ff')); }
    TE.skins.ender_dragon = im;
  })();

  /* ================================================================ End sky (128x128 tile, sampled by the sky shader) */
  (function () {
    var im = Img(128, 128), r = mulberry(8201);
    for (var y = 0; y < 128; y++) for (var x = 0; x < 128; x++) {
      var v = r(), c = v < 0.55 ? [52, 44, 60] : v < 0.85 ? [70, 60, 80] : v < 0.97 ? [96, 84, 108] : [140, 126, 150];
      if (((x >> 3) + (y >> 3)) % 7 === 0 && r() < 0.3) c = [110, 96, 124];
      put(im, x, y, c);
    }
    TE.env = TE.env || {}; TE.env.end_sky = im;
  })();
})(typeof window !== 'undefined' ? window : globalThis);
