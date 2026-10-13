/* tex_mobs.js - skins for the extra mobs (enderman, slime, bat) and the item icons they drop.
 * Extends TexEntities.skins ({w,h,data}) and TexItems (names/tiles). Box unwrap layout as in tex_entities.js:
 *   top=(u+d,v,w,d) bottom=(u+d+w,v,w,d) right=(u,v+d,d,h) front=(u+d,v+d,w,h) left=(u+d+w,v+d,d,h) back=(u+2d+w,v+d,w,h)
 * Deterministic, DOM free. Load after tex_items.js and tex_entities.js. */
(function (G) {
  'use strict';
  var TE = G.TexEntities, TI = G.TexItems;

  function mulberry(a) { return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function Img(w, h) { return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) }; }
  function put(im, x, y, c, a) {
    if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
    var i = (y * im.w + x) * 4; im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = a === undefined ? (c.length > 3 ? c[3] : 255) : a;
  }
  function faces(u, v, w, h, d) {
    return { top: [u + d, v, w, d], bottom: [u + d + w, v, w, d], right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h] };
  }
  function fillRect(im, r, fn) { for (var y = 0; y < r[3]; y++) for (var x = 0; x < r[2]; x++) { var c = fn(x, y, r[2], r[3]); if (c) put(im, r[0] + x, r[1] + y, c); } }
  function jitter(c, k) { return [Math.max(0, Math.min(255, c[0] * k)), Math.max(0, Math.min(255, c[1] * k)), Math.max(0, Math.min(255, c[2] * k))]; }

  /* ---------------- enderman: near-black body, glowing lilac eyes */
  function endermanSkin(eyesOnly) {
    var im = Img(64, 32), r = mulberry(4711);
    var base = [21, 17, 28];
    function paintBox(F) {
      for (var k in F) fillRect(im, F[k], function () { if (eyesOnly) return null; var n = 0.85 + r() * 0.3; return jitter(r() < 0.06 ? [34, 28, 44] : base, n); });
    }
    paintBox(faces(0, 0, 8, 8, 8));                    // head
    paintBox(faces(0, 16, 8, 8, 8));                   // jaw layer
    paintBox(faces(32, 16, 8, 12, 4));                 // body
    paintBox(faces(56, 0, 2, 30, 2));                  // arms + legs
    // eyes on the front of the head (y 12..13): 3px wide, brighter lower row
    var top = [173, 60, 232], bot = [231, 126, 252], hi = [255, 210, 255];
    [[9, 11], [12, 14]].forEach(function (e) {
      for (var x = e[0]; x <= e[1]; x++) { put(im, x, 12, top); put(im, x, 13, x === e[0] || x === e[1] ? bot : hi); }
    });
    if (!eyesOnly) for (var x2 = 9; x2 <= 14; x2++) put(im, x2, 21, [120, 30, 150]);
    return im;
  }

  /* ---------------- slime: translucent gel shell, dark green core, dark eyes and mouth */
  function slimeSkin() {
    var im = Img(64, 32), r = mulberry(9001);
    var outer = faces(0, 0, 8, 8, 8);
    for (var k in outer) fillRect(im, outer[k], function (x, y, w, h) {
      var edge = x === 0 || y === 0 || x === w - 1 || y === h - 1, n = r();
      var c = jitter(edge ? [84, 168, 66] : [118, 200, 96], 0.9 + n * 0.2), a = edge ? 175 : (n < 0.12 ? 190 : 95 + n * 40);
      return [c[0], c[1], c[2], a];
    });
    var inner = faces(0, 16, 6, 6, 6);
    for (var k2 in inner) fillRect(im, inner[k2], function () { var n = r(); var c = jitter(n < 0.2 ? [78, 168, 70] : [48, 122, 48], 0.9 + r() * 0.2); return [c[0], c[1], c[2], 255]; });
    [faces(32, 0, 2, 2, 2), faces(32, 4, 2, 2, 2), faces(32, 8, 1, 1, 1)].forEach(function (F) { for (var k3 in F) fillRect(im, F[k3], function () { return [22, 58, 24, 255]; }); });
    return im;
  }

  /* ---------------- bat: brown fur, darker wing membranes */
  function batSkin() {
    var im = Img(64, 64), r = mulberry(1212);
    function fur(F, base) { for (var k in F) fillRect(im, F[k], function () { var c = jitter(base, 0.86 + r() * 0.28); return [c[0], c[1], c[2], 255]; }); }
    fur(faces(0, 0, 6, 6, 6), [104, 84, 66]);
    fur(faces(24, 0, 3, 4, 1), [92, 74, 58]);
    fur(faces(0, 16, 6, 12, 6), [92, 74, 58]);
    fur(faces(0, 34, 10, 6, 1), [118, 98, 78]);
    var wing = faces(42, 0, 10, 16, 1), outer = faces(24, 16, 8, 12, 1);
    [wing, outer].forEach(function (F) { for (var k in F) fillRect(im, F[k], function (x, y) { var bone = (x % 3 === 0) || y === 0; var c = jitter(bone ? [78, 62, 50] : [58, 46, 38], 0.9 + r() * 0.2); return [c[0], c[1], c[2], 255]; }); });
    var f = faces(0, 0, 6, 6, 6).front; put(im, f[0] + 1, f[1] + 2, [30, 20, 18]); put(im, f[0] + 4, f[1] + 2, [30, 20, 18]); put(im, f[0] + 2, f[1] + 4, [150, 100, 100]); put(im, f[0] + 3, f[1] + 4, [150, 100, 100]);
    return im;
  }

  /* ---------------- wolf (64x32): grey fur, pale muzzle; separate collar overlay */
  function wolfSkin(collarOnly) {
    var im = Img(64, 32), r = mulberry(707);
    function fur(F, base, alt) { if (collarOnly) return; for (var k in F) fillRect(im, F[k], function () { var c = jitter(r() < 0.12 ? alt : base, 0.92 + r() * 0.16); return [c[0], c[1], c[2], 255]; }); }
    var gray = [196, 190, 182], dark = [140, 132, 122], light = [226, 222, 214];
    fur(faces(0, 0, 6, 6, 4), gray, dark);                                   // head
    fur(faces(16, 14, 2, 2, 1), [96, 84, 78], [60, 52, 48]);                 // ears
    fur(faces(0, 10, 3, 3, 4), light, gray);                                 // snout
    fur(faces(18, 14, 6, 9, 6), gray, dark);                                 // body
    fur(faces(21, 0, 8, 6, 7), light, gray);                                 // mane
    fur(faces(0, 18, 2, 8, 2), gray, dark);                                  // legs
    fur(faces(9, 18, 2, 8, 2), dark, gray);                                  // tail
    if (!collarOnly) {
      var hf = faces(0, 0, 6, 6, 4).front; put(im, hf[0] + 1, hf[1] + 2, [34, 28, 26]); put(im, hf[0] + 4, hf[1] + 2, [34, 28, 26]);
      var sf = faces(0, 10, 3, 3, 4).front; put(im, sf[0] + 1, sf[1], [22, 20, 20]); put(im, sf[0] + 1, sf[1] + 1, [22, 20, 20]);
      var ef = faces(16, 14, 2, 2, 1).front; put(im, ef[0], ef[1] + 1, [190, 128, 130]); put(im, ef[0] + 1, ef[1] + 1, [190, 128, 130]);
      var tf = faces(9, 18, 2, 8, 2); for (var k2 in tf) for (var yy = 5; yy < 8; yy++) for (var xx = 0; xx < tf[k2][2]; xx++) put(im, tf[k2][0] + xx, tf[k2][1] + yy, [232, 228, 220]);
    } else {
      var m = faces(21, 0, 8, 6, 7);
      ['left', 'right', 'front', 'back'].forEach(function (k) { var q = m[k]; for (var yy2 = 2; yy2 < 4; yy2++) for (var xx2 = 0; xx2 < q[2]; xx2++) put(im, q[0] + xx2, q[1] + yy2, [230, 230, 230, 255]); });
    }
    return im;
  }
  /* ---------------- squid (64x32): dark blue mantle with pale belly, big eyes, thin tentacles */
  function squidSkin() {
    var im = Img(64, 32), r = mulberry(818);
    var body = faces(0, 0, 12, 16, 12);
    for (var k in body) fillRect(im, body[k], function (x, y, w, h) { var t = y / h, c = jitter(k === 'bottom' ? [70, 98, 128] : [26 + t * 30, 42 + t * 34, 66 + t * 40], 0.9 + r() * 0.2); if (r() < 0.06) c = jitter(c, 1.4); return [c[0], c[1], c[2], 255]; });
    var f = body.front;
    [[1, 8], [8, 8]].forEach(function (e) { for (var yy = 0; yy < 3; yy++) for (var xx = 0; xx < 3; xx++) put(im, f[0] + e[0] + xx, f[1] + e[1] + yy, yy === 1 && xx === 1 ? [10, 12, 18] : [190, 208, 224]); });
    var ten = faces(48, 0, 2, 18, 2);
    for (var k2 in ten) fillRect(im, ten[k2], function (x, y, w, h) { var c = jitter([50 + y * 1.2, 74 + y * 1.4, 100 + y * 1.4], 0.92 + r() * 0.16); return [c[0], c[1], c[2], 255]; });
    return im;
  }

  if (TE && TE.skins) {
    TE.skins.wolf = wolfSkin(false); TE.skins.wolf_collar = wolfSkin(true); TE.skins.squid = squidSkin();
    TE.skins.enderman = endermanSkin(false); TE.skins.enderman_eyes = endermanSkin(true); TE.skins.slime = slimeSkin(); TE.skins.bat = batSkin();
  }

  /* ---------------- item icons */
  if (TI && TI.tiles) {
    var tile = function () { return new Uint8ClampedArray(1024); };
    var px = function (t, x, y, c) { if (x < 0 || y < 0 || x > 15 || y > 15) return; var i = (y * 16 + x) * 4; t[i] = c[0]; t[i + 1] = c[1]; t[i + 2] = c[2]; t[i + 3] = 255; };
    var ball = function (name, ramp, outline, swirl) {
      var t = tile(), cx = 7.5, cy = 8.5, R = 5.4;
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
        if (d > R + 1.1) continue;
        if (d > R) { px(t, x, y, outline); continue; }
        var l = 1 - (dx * 0.5 + dy * 0.7 + 6) / 12; l = Math.max(0, Math.min(0.999, l));
        var k = Math.floor((1 - l) * ramp.length); px(t, x, y, ramp[Math.min(ramp.length - 1, k)]);
        if (swirl && ((x * 3 + y * 5) % 7 === 0) && d < R - 1) px(t, x, y, swirl);
      }
      px(t, 5, 6, [255, 255, 255]);
      TI.names.push(name); TI.tiles[name] = t;
    };
    if (!TI.tiles.ink_sac) ball('ink_sac', [[74, 84, 122], [46, 54, 88], [26, 32, 58], [14, 18, 36], [8, 10, 22]], [4, 4, 12], [96, 108, 150]);
    if (!TI.tiles.slime_ball) ball('slime_ball', [[176, 234, 160], [128, 208, 108], [98, 178, 84], [70, 142, 62], [48, 110, 48]], [36, 80, 36], null);
    if (!TI.tiles.ender_pearl) ball('ender_pearl', [[150, 236, 206], [86, 190, 160], [40, 130, 112], [20, 84, 84], [12, 52, 62]], [8, 30, 40], [190, 250, 224]);
  }
})(typeof window !== 'undefined' ? window : globalThis);
