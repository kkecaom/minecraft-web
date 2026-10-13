/* tex_entities.js - Module C (global TexEntities)
 * Procedurally painted mob/player skins (exact vanilla box-unwrap layouts), sun + moon phases and small HUD icons.
 * Everything is generated eagerly at load time into RGBA Uint8ClampedArrays (row-major, origin top-left).
 *
 * Box unwrap used everywhere (box w x h x d at texture offset u,v):
 *   top=(u+d,v,w,d)  bottom=(u+d+w,v,w,d)  right=(u,v+d,d,h)  front=(u+d,v+d,w,h)  left=(u+d+w,v+d,d,h)  back=(u+2d+w,v+d,w,h)
 * Rotated vanilla bodies (pig/cow/sheep, rotated 90deg about X): box "top" = chest, "bottom" = rear, "front" = belly, "back" = spine.
 */
(function (G) {
  'use strict';

  /* ------------------------------------------------------------------ basic helpers */
  function hx(h) {
    var s = h.charAt(0) === '#' ? h.slice(1) : h;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  function pal(a) { return a.map(hx); }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function h3(x, y, s) { // deterministic hash -> [0,1)
    var n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  function vn(x, y, s) { // smooth value noise, lattice at integer coords
    var ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    var a = h3(ix, iy, s), b = h3(ix + 1, iy, s), c = h3(ix, iy + 1, s), d = h3(ix + 1, iy + 1, s);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  // clustered ("blotchy") noise in [-0.5,0.5]; sx/sy = blob size in pixels
  function cn(x, y, sx, sy, s) { return 0.65 * vn(x / sx, y / sy, s) + 0.35 * vn(2 * x / sx + 7.31, 2 * y / sy + 3.17, s + 11) - 0.5; }
  function rn(x, y, s) { return h3(x, y, s + 777) - 0.5; } // per-pixel white noise in [-0.5,0.5]

  function Img(w, h) { return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) }; }
  function put(im, x, y, c, a) {
    if (!c || x < 0 || y < 0 || x >= im.w || y >= im.h) return;
    var i = (y * im.w + x) << 2, d = im.data;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    d[i + 3] = a !== undefined ? a : (c.length > 3 ? c[3] : 255);
  }
  function get(im, x, y) { var i = (y * im.w + x) << 2, d = im.data; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; }
  function pick(p, t) { t = t < 0 ? 0 : t > 0.99999 ? 0.99999 : t; return p[(t * p.length) | 0]; }
  function jit(c, x, y, s, amt) { // tiny correlated brightness jitter (for very noisy vanilla textures like the creeper)
    var j = (h3(x, y, s + 4242) - 0.5) * amt;
    return [c[0] + j, c[1] + j, c[2] + j];
  }

  function box(u, v, w, h, d) {
    return {
      top: { x: u + d, y: v, w: w, h: d },
      bottom: { x: u + d + w, y: v, w: w, h: d },
      right: { x: u, y: v + d, w: d, h: h },
      front: { x: u + d, y: v + d, w: w, h: h },
      left: { x: u + d + w, y: v + d, w: d, h: h },
      back: { x: u + 2 * d + w, y: v + d, w: w, h: h }
    };
  }
  var SIDES = ['right', 'front', 'left', 'back'];
  function each(im, r, fn) { // fn(localX, localY, X, Y) -> colour or null
    for (var y = 0; y < r.h; y++) for (var x = 0; x < r.w; x++) {
      var c = fn(x, y, r.x + x, r.y + y);
      if (c) put(im, r.x + x, r.y + y, c);
    }
  }
  // paint a small authored pattern (array of strings) with a char -> colour function
  function pattern(im, x0, y0, rows, fn) {
    for (var y = 0; y < rows.length; y++) for (var x = 0; x < rows[y].length; x++) {
      var ch = rows[y].charAt(x);
      if (ch === '.' || ch === ' ') continue;
      var c = fn(ch, x0 + x, y0 + y, x, y);
      if (c) put(im, x0 + x, y0 + y, c);
    }
  }
  /* ================================================================== STEVE (64x64) */
  function steveSkin() {
    var im = Img(64, 64), sd = hashStr('steve');
    var HAIR = pal(['#241909', '#2b1e0d', '#2b1e0d', '#2b1e0d', '#332411', '#332411', '#332411', '#3a2914']);
    var SKIN = pal(['#815339', '#90593f', '#9b6349', '#aa7259', '#b4846d']);
    var SHIRT = pal(['#007f7f', '#058888', '#049595', '#00a4a4', '#00afaf', '#00afaf']);
    var JEANS = pal(['#2f2872', '#3a3189', '#3a3189', '#41359b', '#41359b', '#463aa5', '#463aa5']);
    var SHOE = pal(['#373737', '#373737', '#4a4a4a', '#4a4a4a']);
    var K = { W: hx('#ffffff'), I: hx('#523d89'), N: hx('#6e3e32'), M: hx('#693a2e'), D: hx('#4e2412'), G: hx('#3b2210') };
    function hair(X, Y, b) { return pick(HAIR, 0.5 + (b || 0) + cn(X, Y, 2, 2, sd) * 0.75 + rn(X, Y, sd) * 0.45); }
    function skin(X, Y, b) { return pick(SKIN, b + 0.1 + cn(X, Y, 2.5, 2.5, sd + 1) * 0.3 + rn(X, Y, sd + 1) * 0.2); }
    function shirt(X, Y, b) { return pick(SHIRT, b + 0.1 + cn(X, Y, 1.4, 3.5, sd + 2) * 0.5 + rn(X, Y, sd + 2) * 0.2); }
    function jeans(X, Y, b) { return pick(JEANS, b + 0.1 + cn(X, Y, 1.5, 3, sd + 3) * 0.45 + rn(X, Y, sd + 3) * 0.25); }
    function shoe(X, Y, b) { return pick(SHOE, b + rn(X, Y, sd + 4) * 0.3); }

    // ---- head (0,0) 8x8x8
    var H = box(0, 0, 8, 8, 8);
    each(im, H.top, function (x, y, X, Y) { return hair(X, Y, 0.02); });
    each(im, H.bottom, function (x, y, X, Y) { return y === 0 ? hair(X, Y, -0.1) : skin(X, Y, y >= 6 ? 0.1 : 0.26); });
    function sideHair(sx, sy) { // sx: 0 = back edge .. 7 = front edge
      if (sy <= 3) return true;
      if (sy === 4) return sx <= 4 || sx === 7;
      if (sy === 5) return sx <= 4;
      if (sy === 6) return sx <= 2;
      return false;
    }
    function side(sx, y, X, Y) { return sideHair(sx, y) ? hair(X, Y, y >= 5 ? -0.08 : 0) : skin(X, Y, y === 7 ? 0.2 : 0.46 + (sx >= 6 ? 0.1 : 0)); }
    each(im, H.right, function (x, y, X, Y) { return side(x, y, X, Y); });
    each(im, H.left, function (x, y, X, Y) { return side(7 - x, y, X, Y); });
    each(im, H.back, function (x, y, X, Y) { return hair(X, Y, y === 7 ? -0.12 : 0); });
    // the classic Steve face (digits = SKIN index)
    pattern(im, 8, 8, [
      'HHHHHHHH',
      'HHHHHHHH',
      'H344443H',
      '23344332',
      '3WI33IW3',
      '233NN332',
      '11DMMD11',
      '10GGGG01'
    ], function (ch, X, Y) {
      if (ch === 'H') return hair(X, Y, Y === 9 ? 0.06 : 0);
      if (K[ch]) return K[ch];
      return SKIN[+ch];
    });

    // ---- body (16,16) 8x12x4
    var B = box(16, 16, 8, 12, 4);
    each(im, B.top, function (x, y, X, Y) { return (x === 0 || x === 7) ? shirt(X, Y, 0.55) : skin(X, Y, 0.3); });
    each(im, B.bottom, function (x, y, X, Y) { return jeans(X, Y, 0.3); });
    each(im, B.right, function (x, y, X, Y) { return y >= 10 ? jeans(X, Y, 0.28) : shirt(X, Y, 0.22); });
    each(im, B.left, function (x, y, X, Y) { return y >= 10 ? jeans(X, Y, 0.28) : shirt(X, Y, 0.22); });
    each(im, B.front, function (x, y, X, Y) {
      if ((y === 0 && x >= 2 && x <= 5) || (y === 1 && (x === 3 || x === 4))) return skin(X, Y, y === 0 ? 0.55 : 0.32);
      if (y >= 10) return jeans(X, Y, 0.55);
      return shirt(X, Y, (x === 0 || x === 7) ? 0.4 : 0.74);
    });
    each(im, B.back, function (x, y, X, Y) { return y >= 10 ? jeans(X, Y, 0.45) : shirt(X, Y, (x === 0 || x === 7) ? 0.36 : 0.58); });

    // ---- arms: right (40,16), left (32,48) - short cyan sleeves, skin arms
    function arm(u, v, mirror) {
      var A = box(u, v, 4, 12, 4);
      var tone = { right: 0.5, front: 0.72, left: 0.28, back: 0.4 };
      if (mirror) { tone.right = 0.28; tone.left = 0.5; }
      each(im, A.top, function (x, y, X, Y) { return shirt(X, Y, 0.6); });
      each(im, A.bottom, function (x, y, X, Y) { return skin(X, Y, 0.24); });
      SIDES.forEach(function (f) {
        each(im, A[f], function (x, y, X, Y) {
          var b = tone[f];
          if (y <= 2) return shirt(X, Y, b + 0.08);
          if (y === 3) return pick(SHIRT, 0.08 + rn(X, Y, sd + 9) * 0.2);
          return skin(X, Y, 0.18 + b * 0.75 + (y === 4 ? -0.08 : 0) + (y === 11 ? -0.1 : 0));
        });
      });
    }
    arm(40, 16, false); arm(32, 48, true);

    // ---- legs: right (0,16), left (16,48) - jeans + 2 rows of grey shoes
    function leg(u, v, mirror) {
      var L = box(u, v, 4, 12, 4);
      var tone = { right: 0.55, front: 0.72, left: 0.26, back: 0.44 };
      if (mirror) { tone.right = 0.26; tone.left = 0.55; }
      each(im, L.top, function (x, y, X, Y) { return jeans(X, Y, 0.42); });
      each(im, L.bottom, function (x, y, X, Y) { return shoe(X, Y, 0.3); });
      SIDES.forEach(function (f) {
        each(im, L[f], function (x, y, X, Y) {
          var b = tone[f];
          if (y >= 10) return shoe(X, Y, y === 10 ? 0.78 : 0.36);
          if (y === 9) return jeans(X, Y, b - 0.3);
          return jeans(X, Y, b + (y === 0 ? -0.15 : 0));
        });
      });
    }
    leg(0, 16, false); leg(16, 48, true);

    // ---- outer layer: vanilla 1.20 Steve only has a 1px cuff ring on each sleeve (row 3 of the sleeve sides)
    function cuff(u, v, mirror) {
      var A = box(u, v, 4, 12, 4);
      var tone = { right: 0.55, front: 0.74, left: 0.3, back: 0.44 };
      if (mirror) { tone.right = 0.3; tone.left = 0.55; }
      SIDES.forEach(function (f) { var r = A[f]; for (var x = 0; x < r.w; x++) put(im, r.x + x, r.y + 3, shirt(r.x + x, r.y + 3, tone[f])); });
    }
    cuff(40, 32, false); cuff(48, 48, true);
    return im;
  }

  /* ================================================================== ZOMBIE (64x64) */
  function zombieSkin() {
    var im = Img(64, 64), sd = hashStr('zombie');
    var GRN = pal(['#385226', '#3b622f', '#3b622f', '#3b622f', '#3e692d', '#3e692d', '#3e692d', '#497135', '#497135', '#4e7b36', '#4e7b36']);
    var LGT = pal(['#5e8a4a', '#679056', '#698756', '#739a61']);
    var SH = pal(['#006868', '#007f7f', '#009e9e', '#00a8a8', '#00a8a8', '#00afaf', '#00afaf', '#00cccc']);
    var PA = pal(['#2a2366', '#302872', '#302872', '#3a3189', '#463aa5', '#463aa5']);
    var FT = pal(['#302e3a', '#3b3947', '#454545', '#4c4a58', '#5a576c']);
    var K = { E: hx('#0e1f06'), N: hx('#385226'), n: hx('#465a27'), m: hx('#4e7b36') };
    function g(X, Y, b) { return pick(GRN, b + 0.1 + cn(X, Y, 2.2, 2.2, sd) * 0.8 + rn(X, Y, sd) * 0.3); }
    function gl(X, Y, b) { return pick(LGT, (b || 0.5) + cn(X, Y, 2, 2, sd + 6) * 0.4 + rn(X, Y, sd + 5) * 0.45); }
    function sh(X, Y, b) {
      if (h3(X, Y, sd + 40) < 0.015 + (b > 0.5 ? 0.025 : 0)) return SH[7];   // sparse bright cyan threads like vanilla
      return pick(SH, b + cn(X, Y, 1.3, 3.5, sd + 2) * 0.6 + rn(X, Y, sd + 2) * 0.12);
    }
    function pa(X, Y, b) { return pick(PA, b + 0.18 + cn(X, Y, 1.5, 3, sd + 3) * 0.5 + rn(X, Y, sd + 3) * 0.22); }
    function ft(X, Y) { return pick(FT, 0.5 + rn(X, Y, sd + 4) * 0.9); }

    // ---- head
    var H = box(0, 0, 8, 8, 8);
    each(im, H.top, function (x, y, X, Y) { return g(X, Y, 0.52); });
    each(im, H.bottom, function (x, y, X, Y) { return (x >= 2 && x <= 5 && y >= 2 && y <= 5) ? g(X, Y, 0.06) : g(X, Y, 0.34); });
    each(im, H.right, function (x, y, X, Y) { return g(X, Y, 0.46 - y * 0.02); });
    each(im, H.left, function (x, y, X, Y) { return g(X, Y, 0.46 - y * 0.02); });
    each(im, H.back, function (x, y, X, Y) { return g(X, Y, 0.42 - y * 0.015); });
    pattern(im, 8, 8, [
      'gggggggg',
      'gggggggg',
      'ggLLLLgg',
      'gLLLLLLg',
      'mEELLEEm',
      'mLLNNLLm',
      'gggnnggg',
      'ggnnnngg'
    ], function (ch, X, Y) {
      if (ch === 'g') return g(X, Y, 0.5);
      if (ch === 'L') return gl(X, Y, 0.55);
      return K[ch];
    });

    // ---- body: torn cyan shirt, green V-neck, purple pants
    var B = box(16, 16, 8, 12, 4);
    function torn(x, y, X, Y, shirtT, pantsT) {
      if (y === 10) return h3(X, Y, sd + 21) < 0.72 ? sh(X, Y, shirtT - 0.2) : pa(X, Y, pantsT);
      if (y === 11) return h3(X, Y, sd + 22) < 0.18 ? sh(X, Y, shirtT - 0.25) : pa(X, Y, pantsT);
      return null;
    }
    each(im, B.top, function (x, y, X, Y) { return (x === 0 || x === 7) ? sh(X, Y, 0.55) : g(X, Y, 0.36); });
    each(im, B.bottom, function (x, y, X, Y) { return pa(X, Y, 0.3); });
    each(im, B.right, function (x, y, X, Y) { return torn(x, y, X, Y, 0.2, 0.2) || sh(X, Y, 0.2); });
    each(im, B.left, function (x, y, X, Y) { return torn(x, y, X, Y, 0.2, 0.2) || sh(X, Y, 0.2); });
    each(im, B.front, function (x, y, X, Y) {
      if ((y === 0 && x >= 2 && x <= 5) || (y === 1 && (x === 3 || x === 4))) return g(X, Y, 0.4);
      return torn(x, y, X, Y, 0.6, 0.62) || sh(X, Y, (x === 0 || x === 7) ? 0.42 : 0.66);
    });
    each(im, B.back, function (x, y, X, Y) { return torn(x, y, X, Y, 0.5, 0.45) || sh(X, Y, (x === 0 || x === 7) ? 0.36 : 0.55); });

    // ---- arms (sleeves + green arms)
    function arm(u, v, mirror) {
      var A = box(u, v, 4, 12, 4);
      var tone = { right: 0.5, front: 0.7, left: 0.26, back: 0.45 };
      if (mirror) { tone.right = 0.26; tone.left = 0.5; }
      each(im, A.top, function (x, y, X, Y) { return sh(X, Y, 0.6); });
      each(im, A.bottom, function (x, y, X, Y) { return g(X, Y, 0.3); });
      SIDES.forEach(function (f) {
        each(im, A[f], function (x, y, X, Y) {
          var b = tone[f];
          if (y <= 2) return sh(X, Y, b + 0.08);
          if (y === 3) return pick(SH, 0.12 + rn(X, Y, sd + 9) * 0.2);
          if (f === 'front') return gl(X, Y, 0.45);
          if (f === 'back') return h3(X, Y, sd + 30) < 0.45 ? gl(X, Y, 0.3) : g(X, Y, 0.55);
          return g(X, Y, 0.15 + b * 0.8);
        });
      });
    }
    arm(40, 16, false); arm(32, 48, true);

    // ---- legs
    function leg(u, v, mirror) {
      var L = box(u, v, 4, 12, 4);
      var tone = { right: 0.32, front: 0.8, left: 0.18, back: 0.5 };
      if (mirror) { tone.right = 0.18; tone.left = 0.32; }
      each(im, L.top, function (x, y, X, Y) { return pa(X, Y, 0.5); });
      each(im, L.bottom, function (x, y, X, Y) { return pick(FT, 0.25 + rn(X, Y, sd + 8) * 0.4); });
      SIDES.forEach(function (f) {
        each(im, L[f], function (x, y, X, Y) {
          if (y >= 10) return ft(X, Y);
          return pa(X, Y, tone[f] + (y === 0 ? -0.12 : 0) + (y === 9 ? -0.15 : 0));
        });
      });
    }
    leg(0, 16, false); leg(16, 48, true);
    return im;
  }

  /* ================================================================== SKELETON (64x32) */
  function skeletonSkin() {
    var im = Img(64, 32), sd = hashStr('skeleton');
    var BONE = pal(['#797676', '#8e8d8e', '#8e8d8e', '#8e8d8e', '#8e8d8e', '#979797', '#979797', '#979797', '#979797', '#a5a5a5', '#a5a5a5', '#a5a5a5',
      '#adabad', '#adabad', '#adabad', '#adabad', '#bcbcbc', '#bcbcbc', '#bcbcbc', '#bcbcbc', '#bcbcbc', '#cbc9c9', '#d3d3d3', '#d3d3d3']);
    var DK = hx('#494949'), NOSE = hx('#797676');
    function bone(X, Y, b) { return pick(BONE, (b - 0.5) * 1.25 + 0.4 + cn(X, Y, 2, 2, sd) * 0.8 + rn(X, Y, sd) * 0.4); }

    // ---- skull
    var H = box(0, 0, 8, 8, 8);
    each(im, H.top, function (x, y, X, Y) { return bone(X, Y, 0.74); });
    each(im, H.bottom, function (x, y, X, Y) { return bone(X, Y, 0.28); });
    function side(x, y, X, Y) { return bone(X, Y, y <= 3 ? 0.7 : 0.48 - (y - 4) * 0.03); }
    each(im, H.right, side); each(im, H.left, side); each(im, H.back, side);
    pattern(im, 8, 8, [
      'LLLLLLLL',
      'LLLLLLLL',
      'LLLLLLLL',
      'lLLLLLLl',
      'lEEllEEl',
      'lllNNlll',
      'mEEEEEEm',
      'LLLLLLLL'
    ], function (ch, X, Y) {
      if (ch === 'E') return DK;
      if (ch === 'N') return NOSE;
      if (ch === 'L') return bone(X, Y, 0.76);
      if (ch === 'l') return bone(X, Y, 0.58);
      return bone(X, Y, 0.45);
    });

    // ---- ribcage body (16,16) 8x12x4 - transparent gaps between the bones like vanilla
    var B = box(16, 16, 8, 12, 4);
    var RF = ['########', '...##...', '.######.', '...##...', '.######.', '...##...', '..####..', '...##...', '...##...', '...##...', '########', '###..###'];
    var RB = ['########', '...##...', '########', '...##...', '########', '...##...', '.######.', '...##...', '...##...', '...##...', '########', '###..###'];
    var RS = ['####', '....', '####', '....', '####', '....', '....', '....', '....', '....', '####', '####'];
    function rib(rows, r) {
      each(im, r, function (x, y, X, Y) {
        if (rows[y].charAt(x) !== '#') return null;
        var spine = rows[y] === '...##...';
        var t = spine ? (x === 3 ? 0.72 : 0.5) : 0.7;
        if (!spine && y < 11 && rows[y + 1] && rows[y + 1].charAt(x) !== '#') t -= 0.14; // underside of a bone bar
        if (y === 11) t -= 0.16;
        return bone(X, Y, t);
      });
    }
    rib(RF, B.front); rib(RB, B.back); rib(RS, B.right); rib(RS, B.left);
    var TOPM = ['########', '##....##', '##....##', '########'], BOTM = ['###..###', '#......#', '#......#', '###..###'];
    each(im, B.top, function (x, y, X, Y) { return TOPM[y].charAt(x) === '#' ? bone(X, Y, 0.66) : null; });
    each(im, B.bottom, function (x, y, X, Y) { return BOTM[y].charAt(x) === '#' ? bone(X, Y, 0.34) : null; });

    // ---- thin limbs: arm (40,16) 2x12x2 and leg (0,16) 2x12x2 (left limbs are mirrored by the engine)
    function limb(u, v) {
      var A = box(u, v, 2, 12, 2);
      each(im, A.top, function (x, y, X, Y) { return bone(X, Y, 0.7); });
      each(im, A.bottom, function (x, y, X, Y) { return bone(X, Y, 0.42); });
      SIDES.forEach(function (f, fi) {
        each(im, A[f], function (x, y, X, Y) {
          var t = (x === 0 ? 0.72 : 0.5) - fi * 0.03;
          if (y === 10) t -= 0.22;
          if (y === 0) t += 0.06;
          return bone(X, Y, t);
        });
      });
    }
    limb(40, 16); limb(0, 16);
    return im;
  }

  /* ================================================================== CREEPER (64x32) */
  function creeperSkin() {
    var im = Img(64, 32), sd = hashStr('creeper');
    var CP = pal(['#2d6e23', '#3f8f35', '#4b9a40', '#5fa156', '#68c05e', '#79c96d', '#82d077', '#82d077', '#9bd795', '#b9dfb0', '#d2d2d2']);
    var VIVID = hx('#00a500'), BLK = hx('#000000'), DG = hx('#1c4c15');
    function camo(X, Y, b) {
      if (vn(X / 2.2 + 40.5, Y / 2.2 + 3.5, sd + 3) > 0.74 && h3(X, Y, sd + 8) < 0.7) return jit(VIVID, X, Y, sd, 14);
      var t = (b === undefined ? 0.56 : b) + cn(X, Y, 2.1, 2.1, sd) * 1.05 + rn(X, Y, sd) * 0.62;
      return jit(pick(CP, t), X, Y, sd, 16);
    }
    function all(bx, fn) { ['top', 'bottom', 'right', 'front', 'left', 'back'].forEach(function (f) { each(im, bx[f], function (x, y, X, Y) { return fn(f, x, y, X, Y); }); }); }
    var H = box(0, 0, 8, 8, 8);
    all(H, function (f, x, y, X, Y) { return camo(X, Y, f === 'bottom' ? 0.4 : 0.58); });
    // the iconic face
    pattern(im, 8, 8, [
      '........',
      '........',
      '.EE..EE.',
      '.EE..EE.',
      '...dd...',
      '..dEEd..',
      '..EEEE..',
      '..d..d..'
    ], function (ch) { return ch === 'E' ? BLK : DG; });
    var B = box(16, 16, 8, 12, 4);
    all(B, function (f, x, y, X, Y) { return camo(X, Y, f === 'bottom' ? 0.4 : 0.55); });
    var L = box(0, 16, 4, 6, 4);
    all(L, function (f, x, y, X, Y) {
      if (f === 'bottom') return pick([DG, hx('#153a10'), hx('#2d6e23')], 0.3 + rn(X, Y, sd + 2) * 0.9);
      if (f === 'top') return camo(X, Y, 0.55);
      if (y === 5) return (f === 'front' || h3(X, Y, sd + 5) < 0.5) ? (h3(X, Y, sd + 6) < 0.45 ? BLK : DG) : camo(X, Y, 0.12);
      if (y === 4 && f === 'front') return h3(X, Y, sd + 7) < 0.6 ? DG : camo(X, Y, 0.15);
      return camo(X, Y, 0.55 - (y >= 4 ? 0.2 : 0));
    });
    return im;
  }

  /* ================================================================== PIG (64x32) */
  function pigSkin() {
    var im = Img(64, 32), sd = hashStr('pig');
    var PK = pal(['#c6615a', '#c6615a', '#e4686a', '#e67973', '#e67973', '#e68583', '#e6918b', '#e6918b', '#f19e98', '#f19e98', '#eea5a4']);
    var K = { K: hx('#020001'), W: hx('#ffffff'), n: hx('#894746'), t: hx('#be504d'), s: hx('#c6615a'), h: hx('#fbbebe') };
    function pk(X, Y, b) { return pick(PK, b + cn(X, Y, 2.2, 2.2, sd) * 0.45 + rn(X, Y, sd) * 0.3); }
    function pks(X, Y, b) { return pick(PK, b + cn(X, Y, 0.9, 5, sd + 1) * 0.5 + cn(X, Y, 2.5, 2.5, sd) * 0.25 + rn(X, Y, sd) * 0.2); } // lengthwise streaks

    // ---- head (0,0) 8x8x8
    var H = box(0, 0, 8, 8, 8);
    each(im, H.top, function (x, y, X, Y) { return pk(X, Y, 0.82); });
    each(im, H.bottom, function (x, y, X, Y) { return pk(X, Y, 0.06); });
    function side(sx, y, X, Y) { return pk(X, Y, 0.6 - (y >= 5 ? 0.18 : 0) - (sx <= 1 && y >= 3 ? 0.12 : 0)); }
    each(im, H.right, function (x, y, X, Y) { return side(x, y, X, Y); });
    each(im, H.left, function (x, y, X, Y) { return side(7 - x, y, X, Y); });
    each(im, H.back, function (x, y, X, Y) { return pk(X, Y, 0.52 - (y >= 6 ? 0.15 : 0)); });
    each(im, H.front, function (x, y, X, Y) {
      if (y === 3) { if (x === 0 || x === 7) return K.K; if (x === 1 || x === 6) return K.W; }
      return pk(X, Y, y <= 1 ? 0.84 : y === 2 ? 0.66 : y === 3 ? 0.56 : 0.42);
    });
    // ---- snout (16,16) 4x3x1
    var S = box(16, 16, 4, 3, 1);   // (the hidden back face stays transparent like vanilla)
    each(im, S.top, function (x, y, X, Y) { return x === 1 ? K.h : pk(X, Y, 0.88); });
    each(im, S.bottom, function (x, y, X, Y) { return pk(X, Y, 0.4); });
    each(im, S.right, function (x, y, X, Y) { return pk(X, Y, 0.6); });
    each(im, S.left, function (x, y, X, Y) { return pk(X, Y, 0.6); });
    pattern(im, S.front.x, S.front.y, ['ABBA', 'nccn', 'BAAB'], function (ch) {
      return ch === 'n' ? K.n : ch === 'c' ? hx('#e68583') : ch === 'A' ? hx('#f19e98') : hx('#eea5a4');
    });

    // ---- body (28,8) 10x16x8 (rotated: top = chest, bottom = rear, front = belly, back = spine)
    var B = box(28, 8, 10, 16, 8);
    each(im, B.top, function (x, y, X, Y) { return pk(X, Y, 0.36); });
    each(im, B.bottom, function (x, y, X, Y) { return pk(X, Y, 0.42 - (y >= 6 ? 0.12 : 0)); });
    pattern(im, B.bottom.x + 3, B.bottom.y + 2, ['.tt.', 't..t', '.t.n', '.n..'], function (ch) { return ch === 't' ? K.t : K.n; }); // curly tail
    each(im, B.right, function (x, y, X, Y) { return pks(X, Y, 0.88 - x * 0.085); });   // x=0 spine side .. x=7 belly side
    each(im, B.left, function (x, y, X, Y) { return pks(X, Y, 0.88 - (7 - x) * 0.085); });
    each(im, B.back, function (x, y, X, Y) { return pks(X, Y, 0.86); });
    each(im, B.front, function (x, y, X, Y) {
      if ((x === 3 || x === 6) && (y === 5 || y === 8 || y === 11)) return K.t;       // teats
      if ((x === 4 || x === 5) && y >= 3 && y <= 13) return pick(PK, 0.1 + rn(X, Y, sd + 3) * 0.25);
      return pks(X, Y, (x === 0 || x === 9) ? 0.36 : 0.2);
    });

    // ---- legs (0,16) 4x6x4 with split hooves
    var L = box(0, 16, 4, 6, 4);
    each(im, L.top, function (x, y, X, Y) { return pk(X, Y, 0.78); });
    each(im, L.bottom, function (x) { return x <= 1 ? K.n : K.s; });
    var tone = { right: 0.5, front: 0.62, left: 0.42, back: 0.46 };
    SIDES.forEach(function (f) {
      each(im, L[f], function (x, y, X, Y) {
        if (y === 5) return x === (f === 'front' || f === 'right' ? 1 : 2) ? K.n : K.s;
        return pk(X, Y, tone[f] - (y === 4 ? 0.14 : 0));
      });
    });
    return im;
  }

  /* ================================================================== COW (64x32) */
  function cowSkin() {
    var im = Img(64, 32), sd = hashStr('cow');
    var BR = pal(['#352a1f', '#352a1f', '#3f3024', '#3f3024', '#443626', '#443626']);
    var WH = pal(['#818181', '#818181', '#a1a1a1', '#a1a1a1', '#a1a1a1', '#b3b3b3', '#b3b3b3', '#b3b3b3', '#b3b3b3', '#b3b3b3']);
    var PNK = pal(['#966a6a', '#ce9191', '#ce9191', '#f7afaf', '#f7afaf', '#f7afaf', '#f7afaf']);
    var K = { K: hx('#171414'), W: hx('#ffffff'), l: hx('#dcdcdc'), p: hx('#c9c9c9'), g: hx('#666666'), d: hx('#444444'), e: hx('#333333') };
    function br(X, Y, b) { return pick(BR, (b === undefined ? 0.5 : b) + 0.1 + cn(X, Y, 2.4, 2.4, sd) * 0.85 + rn(X, Y, sd) * 0.5); }
    function wh(X, Y, b) { return pick(WH, (b === undefined ? 0.6 : b) + cn(X, Y, 2, 2, sd + 1) * 0.45 + rn(X, Y, sd + 1) * 0.4); }
    // white patches: hand-placed blob clusters (texture space) laid out like the vanilla hide, with ragged edges
    var BLOBS = [
      [10.8, 1.6, 1.3, 2.3], [10.8, 4.9, 2.9, 1.3],                          // blaze on the head top (widens toward the face)
      [18.9, 7.9, 1.4, 1.4], [23.9, 7.3, 1.4, 1.6], [0.9, 12.4, 1.3, 1.4],   // head sides / back
      [30.6, 5.8, 3.0, 2.3], [29.2, 8.2, 1.4, 1.3], [37.6, 11, 2.5, 2.9],    // chest
      [45, 6.6, 5.9, 3.5], [41, 9.8, 1.6, 1.2],                              // rear: mostly white on top
      [24.2, 15.1, 4.6, 1.9], [21.6, 15.8, 1.8, 1.2], [26.2, 24.2, 2.3, 2.7], // right flank
      [31.6, 21.6, 2.9, 1.9], [39, 20.6, 1.3, 3.0],                           // belly
      [44.9, 21.1, 5.3, 3.7], [41.4, 18.4, 1.9, 1.8], [48.6, 24.6, 1.4, 1.2], // left flank
      [55.6, 18.6, 3.7, 5.5], [52.4, 20.6, 1.6, 1.6], [56, 31.2, 6.6, 1.9],  // spine
      [7.5, 23, 1.2, 2.5],                                                   // small spot on the legs
      // splashy "arms" (rotated, elongated) that give the vanilla hide its ragged shapes
      [29.6, 9.6, 0.9, 2.1, 20], [34.4, 8.6, 2.6, 0.8, -35], [45.6, 10.4, 0.9, 1.7, 0], [47.4, 18.1, 2.2, 0.8, -30],
      [42.6, 24.9, 1.8, 0.8, 30], [22.9, 18.4, 0.8, 1.8, 15], [58.4, 25.4, 0.9, 2.0, -20], [51.6, 16.4, 1.4, 0.9, 40], [33.4, 19.4, 1.6, 0.8, -25]
    ];
    function field(X, Y) {
      var v = -1;
      for (var i = 0; i < BLOBS.length; i++) {
        var b = BLOBS[i], px = X + 0.5 - b[0], py = Y + 0.5 - b[1];
        if (b[4]) { var a = b[4] * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = c * px + s * py; py = -s * px + c * py; px = t; }
        var dx = px / b[2], dy = py / b[3];
        v = Math.max(v, 1 - (dx * dx + dy * dy));
      }
      return v + cn(X, Y, 1.5, 1.5, sd + 7) * 0.6 + rn(X, Y, sd + 8) * 0.35;
    }
    function coat(X, Y, b, wb) {
      var f = field(X, Y);
      if (f <= 0.12) return br(X, Y, b);
      return wh(X, Y, (wb === undefined ? 0.6 : wb) - 0.15 + Math.max(-0.38, Math.min(0.2, (f - 0.45) * 1.1)));   // patch edges are darker grey
    }

    // ---- head (0,0) 8x8x6
    var H = box(0, 0, 8, 8, 6);
    each(im, H.top, function (x, y, X, Y) { return coat(X, Y, 0.55, 0.7); });
    each(im, H.bottom, function (x, y, X, Y) { return br(X, Y, 0.18); });
    each(im, H.right, function (x, y, X, Y) { return coat(X, Y, 0.45 - (y >= 6 ? 0.1 : 0), 0.55); });
    each(im, H.left, function (x, y, X, Y) { return coat(X, Y, 0.45 - (y >= 6 ? 0.1 : 0), 0.55); });
    each(im, H.back, function (x, y, X, Y) { return coat(X, Y, 0.42, 0.55); });
    // ears painted on the head sides, 1-2px behind the front edge
    pattern(im, H.right.x + 2, H.right.y + 1, ['phh', '.hj'], function (ch) { return ch === 'p' ? K.p : ch === 'h' ? PNK[1] : PNK[0]; });
    pattern(im, H.left.x + 1, H.left.y + 1, ['hhp', 'jh.'], function (ch) { return ch === 'p' ? K.p : ch === 'h' ? PNK[1] : PNK[0]; });
    // face: blaze, eyes (black outer + white inner), pale muzzle with nostrils
    pattern(im, H.front.x, H.front.y, [
      'bbbwwwwb',
      'bbbwwwbb',
      'ppbwwbpp',
      'KWbwbbWK',
      'bbbbbbbb',
      'bblllpbb',
      'blKggKlb',
      'bpdeedpb'
    ], function (ch, X, Y) {
      if (ch === 'b') return br(X, Y, 0.55);
      if (ch === 'w') return wh(X, Y, 0.7);
      return K[ch];
    });
    // ---- horns (22,0) 1x3x1 (grey)
    var HO = box(22, 0, 1, 3, 1);
    put(im, HO.top.x, HO.top.y, hx('#818181')); put(im, HO.bottom.x, HO.bottom.y, K.d);
    SIDES.forEach(function (f, i) { var r = HO[f]; for (var y = 0; y < 3; y++) put(im, r.x, r.y + y, y === 0 ? (i % 2 ? K.g : hx('#818181')) : y === 1 ? (i % 2 ? K.d : K.g) : K.e); });

    // ---- body (18,4) 12x18x10 (rotated)
    var B = box(18, 4, 12, 18, 10);
    each(im, B.top, function (x, y, X, Y) { return coat(X, Y, 0.45, 0.6); });
    each(im, B.bottom, function (x, y, X, Y) { return (y === 9 && x >= 2 && x <= 6) ? pick(PNK, 0.5 + rn(X, Y, sd + 6) * 0.6) : coat(X, Y, 0.4, 0.62); });
    each(im, B.right, function (x, y, X, Y) { return coat(X, Y, 0.62 - x * 0.03, 0.62 - x * 0.02); });
    each(im, B.left, function (x, y, X, Y) { return coat(X, Y, 0.62 - (9 - x) * 0.03, 0.62 - (9 - x) * 0.02); });
    each(im, B.back, function (x, y, X, Y) { return coat(X, Y, 0.62, 0.66); });
    each(im, B.front, function (x, y, X, Y) {   // belly: pink skin around the udder near the rear end
      if (x >= 3 && x <= 8 && y >= 12 && y <= 17 && !((x === 3 || x === 8) && (y === 12 || y === 17))) return pick(PNK, 0.55 + cn(X, Y, 1.5, 1.5, sd + 4) * 0.6 + rn(X, Y, sd + 4) * 0.4);
      return coat(X, Y, 0.3, 0.45);
    });
    // ---- udder (52,0) 4x6x1
    var U = box(52, 0, 4, 6, 1);
    ['top', 'bottom', 'right', 'left'].forEach(function (f) { each(im, U[f], function (x, y, X, Y) { return pick(PNK, 0.45 + rn(X, Y, sd + 5) * 0.5); }); });
    pattern(im, U.front.x, U.front.y, ['gggg', 'gGGg', 'ghhg', 'gggg', 'jggj', 'nhhn'], function (ch) {
      return hx({ g: '#f7afaf', G: '#fbbcbc', h: '#ce9191', j: '#966a6a', n: '#d49797' }[ch]);
    });
    // ---- legs (0,16) 4x12x4 with black hooves
    var L = box(0, 16, 4, 12, 4);
    each(im, L.top, function (x, y, X, Y) { return coat(X, Y, 0.45, 0.6); });
    each(im, L.bottom, function (x, y, X, Y) { return (x === 0 || x === 3) ? K.K : K.g; });
    SIDES.forEach(function (f) {
      each(im, L[f], function (x, y, X, Y) {
        if (y === 11) return K.K;
        return coat(X, Y, (f === 'front' ? 0.55 : 0.42) - (y >= 9 ? 0.12 : 0), 0.55);
      });
    });
    return im;
  }

  /* ================================================================== SHEEP (64x32) + SHEEP_FUR */
  function sheepSkin() {
    var im = Img(64, 32), sd = hashStr('sheep');
    var WOOL = pal(['#d2d2d2', '#d2d2d2', '#dedede', '#dedede', '#ececec', '#ececec', '#ececec', '#f8f6f5']);
    var TAN = pal(['#af886b', '#af886b', '#b7947b', '#b7947b', '#b7947b', '#c09e86', '#c09e86', '#c09e86']);
    var K = { K: hx('#080808'), W: hx('#ffffff'), P: hx('#ffb8b8'), e: hx('#e69494'), h: hx('#57463a'), m: hx('#c09e86'), d: hx('#af886b') };
    function wool(X, Y, b) { return pick(WOOL, (b === undefined ? 0.55 : b) + cn(X, Y, 1.8, 1.8, sd) * 0.6 + rn(X, Y, sd) * 0.45); }
    function tan(X, Y, b) { return pick(TAN, (b === undefined ? 0.5 : b) + cn(X, Y, 2, 2, sd + 1) * 0.55 + rn(X, Y, sd + 1) * 0.45); }
    function speck(X, Y, b) { // sheared body: tan skin with little white/grey wool tufts left
      var r = h3(X, Y, sd + 9), n = vn(X / 1.7, Y / 1.7, sd + 10);
      if (r < 0.16 + n * 0.28) { var q = h3(X, Y, sd + 11); return q < 0.45 ? hx('#f8f6f5') : q < 0.85 ? hx('#ececec') : hx('#dedede'); }
      return tan(X, Y, b);
    }

    // ---- head (0,0) 6x6x8: woolly head, tan face, pink ears
    var H = box(0, 0, 6, 6, 8);
    each(im, H.top, function (x, y, X, Y) { return wool(X, Y, 0.62); });
    each(im, H.bottom, function (x, y, X, Y) { return wool(X, Y, 0.2); });
    each(im, H.right, function (x, y, X, Y) { return wool(X, Y, 0.5 - y * 0.05); });
    each(im, H.left, function (x, y, X, Y) { return wool(X, Y, 0.5 - y * 0.05); });
    each(im, H.back, function (x, y, X, Y) { return wool(X, Y, 0.45 - y * 0.05); });
    pattern(im, H.right.x + 5, H.right.y + 1, ['Pe', 'ee'], function (ch) { return K[ch]; });
    pattern(im, H.left.x + 1, H.left.y + 1, ['eP', 'ee'], function (ch) { return K[ch]; });
    pattern(im, H.front.x, H.front.y, [
      'oooooo',
      'tttttt',
      'KWttWK',
      'tttttd',
      'otPPto',
      'odmmdo'
    ], function (ch, X, Y) {
      if (ch === 'o') return wool(X, Y, 0.55);
      if (ch === 't') return tan(X, Y, 0.55);
      return K[ch];
    });
    // ---- body (28,8) 8x16x6 sheared
    var B = box(28, 8, 8, 16, 6);
    ['top', 'bottom', 'right', 'front', 'left', 'back'].forEach(function (f) {
      each(im, B[f], function (x, y, X, Y) { return speck(X, Y, f === 'front' ? 0.25 : f === 'back' ? 0.65 : 0.5); });
    });
    // ---- legs (0,16) 4x12x4: wool at the top, tan shins, dark hooves
    var L = box(0, 16, 4, 12, 4);
    each(im, L.top, function (x, y, X, Y) { return wool(X, Y, 0.5); });
    each(im, L.bottom, function (x, y, X, Y) { return (x === 1 || x === 3) ? K.h : K.d; });
    SIDES.forEach(function (f) {
      each(im, L[f], function (x, y, X, Y) {
        if (y === 11) return K.h;
        if (y <= 3) return wool(X, Y, 0.42 - y * 0.05);
        return tan(X, Y, (f === 'front' ? 0.6 : 0.45) - (y === 10 ? 0.15 : 0));
      });
    });
    return im;
  }
  function sheepFur() {
    var im = Img(64, 32), sd = hashStr('sheep_fur');
    var W = pal(['#d4d4d4', '#dfdfdf', '#efefef', '#f8f8f8', '#f8f8f8', '#ffffff', '#ffffff']);
    function w(X, Y, b) { return pick(W, b + cn(X, Y, 1.7, 1.7, sd) * 0.7 + rn(X, Y, sd) * 0.5); }
    var H = box(0, 0, 6, 6, 6);
    each(im, H.top, function (x, y, X, Y) { return w(X, Y, 0.66); });
    each(im, H.bottom, function (x, y, X, Y) { return pick(W, 0.08 + rn(X, Y, sd + 1) * 0.25); });
    SIDES.forEach(function (f) { each(im, H[f], function (x, y, X, Y) { return w(X, Y, (f === 'back' ? 0.45 : 0.6) - y * 0.05); }); });
    var B = box(28, 8, 8, 16, 6);
    each(im, B.top, function (x, y, X, Y) { return w(X, Y, 0.62 - (y >= 4 ? 0.15 : 0)); });
    each(im, B.bottom, function (x, y, X, Y) { return w(X, Y, 0.55 - (y >= 4 ? 0.15 : 0)); });
    each(im, B.right, function (x, y, X, Y) { return w(X, Y, 0.68 - x * 0.04 - (y === 15 ? 0.2 : 0)); });
    each(im, B.left, function (x, y, X, Y) { return w(X, Y, 0.68 - (5 - x) * 0.04 - (y === 15 ? 0.2 : 0)); });
    each(im, B.back, function (x, y, X, Y) { return w(X, Y, 0.68 - (y === 15 ? 0.2 : 0)); });
    each(im, B.front, function (x, y, X, Y) { var c = Math.abs(x - 3.5); return w(X, Y, 0.1 + c * 0.1 - (y === 15 ? 0.1 : 0)); }); // belly: greyer centre
    var L = box(0, 16, 4, 6, 4);
    each(im, L.top, function (x, y, X, Y) { return w(X, Y, 0.55); });
    each(im, L.bottom, function (x, y, X, Y) { return w(X, Y, 0.2); });
    SIDES.forEach(function (f) { each(im, L[f], function (x, y, X, Y) { return w(X, Y, (f === 'front' ? 0.6 : 0.48) - y * 0.05); }); });
    return im;
  }

  /* ================================================================== CHICKEN (64x32) */
  function chickenSkin() {
    var im = Img(64, 32), sd = hashStr('chicken');
    var WF = pal(['#c6c6c6', '#c6c6c6', '#d3d3d3', '#d3d3d3', '#d3d3d3', '#e2e2e2', '#e2e2e2', '#e2e2e2', '#ffffff', '#ffffff', '#ffffff']);
    var RED = hx('#ff0000'), BLK = hx('#000000');
    var BEAK = { t: hx('#e0bb69'), u: hx('#c19343'), l: hx('#967234'), k: hx('#635641') };
    var YEL = pal(['#d0a93f', '#e1cc62', '#e0bb69', '#fce570']);
    function f(X, Y, b) { return pick(WF, b + 0.04 + cn(X, Y, 2, 2, sd) * 1.15 + rn(X, Y, sd) * 0.35); }

    // ---- head (0,0) 4x6x3
    var H = box(0, 0, 4, 6, 3);
    each(im, H.top, function (x, y, X, Y) { return f(X, Y, 0.75); });
    each(im, H.bottom, function (x, y, X, Y) { return (y === 2 && (x === 1 || x === 2)) ? RED : f(X, Y, 0.3); });
    each(im, H.right, function (x, y, X, Y) { return f(X, Y, 0.62 - y * 0.04); });
    each(im, H.left, function (x, y, X, Y) { return f(X, Y, 0.62 - y * 0.04); });
    each(im, H.back, function (x, y, X, Y) { return f(X, Y, 0.55 - y * 0.04); });
    each(im, H.front, function (x, y, X, Y) {
      if (y === 1 && (x === 0 || x === 3)) return BLK;             // eyes
      if (y >= 4 && (x === 1 || x === 2)) return RED;              // wattle behind the red_thing
      return f(X, Y, 0.7 - y * 0.03);
    });
    // ---- beak (14,0) 4x2x2
    var BK = box(14, 0, 4, 2, 2);
    each(im, BK.top, function (x, y) { return (y === 1 && (x === 1 || x === 2)) ? BEAK.t : BEAK.u; });
    each(im, BK.bottom, function () { return BEAK.l; });
    SIDES.forEach(function (fc) { each(im, BK[fc], function (x, y) { return y === 0 ? BEAK.u : BEAK.l; }); });
    put(im, BK.front.x + 1, BK.front.y + 1, BEAK.k); put(im, BK.front.x + 2, BK.front.y + 1, BEAK.k);
    // ---- wattle (14,4) 2x2x2
    var WT = box(14, 4, 2, 2, 2);
    ['top', 'bottom', 'right', 'front', 'left', 'back'].forEach(function (fc) { each(im, WT[fc], function () { return RED; }); });
    // ---- body: vanilla (0,9) 6x8x6 rotated AND the plain (0,9) 6x6x8 unwrap - both are painted so either mapping works
    var BV = box(0, 9, 6, 8, 6), BS = box(0, 9, 6, 6, 8);
    [BV, BS].forEach(function (bx) {
      ['top', 'bottom', 'right', 'front', 'left', 'back'].forEach(function (fc) {
        each(im, bx[fc], function (x, y, X, Y) { return f(X, Y, fc === 'bottom' ? 0.3 : 0.5); });
      });
    });
    // soft grey belly/underside shading where both layouts agree
    each(im, BV.front, function (x, y, X, Y) { return f(X, Y, 0.28); });
    each(im, BS.bottom, function (x, y, X, Y) { return f(X, Y, 0.26); });
    // ---- wings (24,13) 1x4x6
    var WG = box(24, 13, 1, 4, 6);
    ['top', 'bottom', 'right', 'front', 'left', 'back'].forEach(function (fc) {
      each(im, WG[fc], function (x, y, X, Y) { return f(X, Y, fc === 'bottom' ? 0.25 : 0.55 - (y === 3 && fc !== 'top' ? 0.25 : 0)); });
    });
    // ---- legs (26,0) 3x5x3: thin yellow legs (centre column of each side) + toes, rest transparent like vanilla
    var LG = box(26, 0, 3, 5, 3);
    each(im, LG.bottom, function (x, y, X, Y) { return pick(YEL, 0.5 + rn(X, Y, sd + 3) * 0.9); });
    SIDES.forEach(function (fc) {
      each(im, LG[fc], function (x, y, X, Y) {
        if (x === 1) return pick(YEL, 0.2 + y * 0.12 + rn(X, Y, sd + 4) * 0.3);
        if (y === 4 && fc === 'front') return YEL[3];
        return null;
      });
    });
    return im;
  }

  /* ================================================================== SPIDER (64x32) + SPIDER_EYES */
  function spiderSkin() {
    var im = Img(64, 32), sd = hashStr('spider');
    var FUR = pal(['#1a140f', '#26201b', '#26201b', '#26201b', '#322b26', '#322b26', '#322b26', '#3d342d', '#3d342d', '#3d342d', '#3d342d',
      '#473e35', '#473e35', '#4f453c', '#4f453c', '#605448']);
    var K = { R: hx('#a80e0e'), r: hx('#3c0202'), q: hx('#220000'), F: hx('#92897f'), f: hx('#8c8277'), k: hx('#1a140f') };
    function fur(X, Y, b) { return pick(FUR, 0.13 + b * 0.8 + cn(X, Y, 2.2, 2.2, sd) * 0.85 + rn(X, Y, sd) * 0.5); }

    // ---- neck (0,0) 6x6x6
    var N = box(0, 0, 6, 6, 6);
    ['top', 'bottom', 'right', 'front', 'left', 'back'].forEach(function (f) { each(im, N[f], function (x, y, X, Y) { return fur(X, Y, f === 'top' ? 0.42 : 0.3); }); });
    // ---- abdomen (0,12) 10x8x12: lighter marked back, dark underside
    var B = box(0, 12, 10, 8, 12);
    each(im, B.top, function (x, y, X, Y) {
      var mark = vn(X / 2.4 + 9.5, Y / 2.4, sd + 3) > 0.6 && Math.abs(x - 4.5) < 3.8;
      return fur(X, Y, mark ? 0.82 : 0.6);
    });
    each(im, B.bottom, function (x, y, X, Y) { return fur(X, Y, 0.18); });
    SIDES.forEach(function (f) { each(im, B[f], function (x, y, X, Y) { return fur(X, Y, 0.6 - y * 0.06); }); });
    // ---- head (32,4) 8x8x8
    var H = box(32, 4, 8, 8, 8);
    each(im, H.top, function (x, y, X, Y) { return fur(X, Y, 0.58); });
    each(im, H.bottom, function (x, y, X, Y) { return (y === 7 && (x === 1 || x === 6)) ? K.f : fur(X, Y, 0.2); });   // fang tips under the head
    ['right', 'left', 'back'].forEach(function (f) { each(im, H[f], function (x, y, X, Y) { return fur(X, Y, 0.58 - y * 0.04); }); });
    pattern(im, H.front.x, H.front.y, [
      '.r....r.',
      '..q..q..',
      'r.RrRr.r',
      'r.RrRr.r',
      '..qqqq..',
      '........',
      '.Fk..kF.',
      '.Fk..kF.'
    ].map(function (s) { return s.replace(/\./g, 'x'); }), function (ch, X, Y, lx, ly) {
      if (ch === 'x') return fur(X, Y, ly >= 5 ? 0.45 : 0.55);
      return K[ch];
    });
    // ---- legs (18,0) 16x2x2
    var L = box(18, 0, 16, 2, 2);
    ['top', 'bottom', 'right', 'front', 'left', 'back'].forEach(function (f) {
      each(im, L[f], function (x, y, X, Y) {
        var joint = (f === 'top' || f === 'front' || f === 'back') && (x === 5 || x === 10);
        return fur(X, Y, (f === 'bottom' ? 0.2 : 0.42) + (joint ? 0.3 : 0));
      });
    });
    return im;
  }
  function spiderEyes() {
    var im = Img(64, 32);
    var H = box(32, 4, 8, 8, 8);
    var C = { R: hx('#ff3a3a'), r: hx('#d20000'), s: hx('#b40000'), q: hx('#7a0000') };
    pattern(im, H.front.x, H.front.y, [
      '.s....s.',
      '..s..s..',
      's.RrRr.s',
      's.RrRr.s',
      '..qqqq..'
    ], function (ch) { return C[ch]; });
    return im;
  }

  /* ================================================================== SUN / MOON */
  function sunTex() {
    var im = Img(32, 32);
    var c0 = 12, c1 = 19; // 8x8 core like vanilla (the renderer uses the vanilla quad size)
    for (var y = 0; y < 32; y++) for (var x = 0; x < 32; x++) {
      var dx = x < c0 ? c0 - x : x > c1 ? x - c1 : 0, dy = y < c0 ? c0 - y : y > c1 ? y - c1 : 0;
      var d = Math.sqrt(dx * dx + dy * dy);
      var v = d > 0 ? Math.round(21 * Math.pow(0.71, d - 1)) : 0;
      put(im, x, y, [v, v, Math.round(v * 0.36)], 255);
    }
    for (y = c0; y <= c1; y++) for (x = c0; x <= c1; x++) {
      var e = Math.min(x - c0, c1 - x, y - c0, c1 - y);
      put(im, x, y, e === 0 ? hx('#ffd54a') : e === 1 ? hx('#ffffb0') : hx('#ffffff'), 255);
    }
    return im;
  }
  function moonTex() {
    var im = Img(128, 64), sd = hashStr('moon');
    for (var i = 0; i < im.data.length; i += 4) im.data[i + 3] = 255;   // opaque black (additive)
    var LIT = pal(['#8a92a1', '#a3aab7', '#c3c9d3', '#d4d9e1', '#e3e7ed']);
    var DARKS = pal(['#090e18', '#0c121f', '#0c121f', '#0f1626']);
    // 12x12 rounded-square disc (vanilla-sized for a 32px frame)
    function inDisc(x, y) {
      if (x < 0 || y < 0 || x > 11 || y > 11) return false;
      var cx = Math.min(x, 11 - x), cy = Math.min(y, 11 - y);
      return !(cx + cy < 2);
    }
    var CR = [[3.4, 3.2, 1.5], [8.2, 4.3, 1.7], [4.6, 8.3, 1.6], [9.0, 9.0, 1.1], [6.6, 6.2, 0.9], [2.2, 6.4, 0.8]];
    function crater(x, y) {
      for (var k = 0; k < CR.length; k++) { var dx = x + 0.5 - CR[k][0], dy = y + 0.5 - CR[k][1]; if (dx * dx + dy * dy < CR[k][2] * CR[k][2]) return k + 1; }
      return 0;
    }
    var PH = [[0, -1], [45, -1], [90, -1], [135, -1], [180, 0], [135, 1], [90, 1], [45, 1]]; // [phase angle, lit side: -1 left(waning) / 1 right(waxing)]
    for (var f = 0; f < 8; f++) {
      var ox = (f % 4) * 32 + 10, oy = (f >> 2) * 32 + 10, ang = PH[f][0] * Math.PI / 180, cs = Math.cos(ang);
      var lit = [];
      for (var y = 0; y < 12; y++) {
        var x0 = 0; while (!inDisc(x0, y)) x0++;
        var hw = (12 - 2 * x0) / 2;
        for (var x = 0; x < 12; x++) {
          if (!inDisc(x, y)) continue;
          var xc = x + 0.5 - 6, isLit;
          if (PH[f][1] === 0) isLit = false;
          else if (PH[f][1] < 0) isLit = xc <= hw * cs + 1e-6;
          else isLit = xc >= -hw * cs - 1e-6;
          lit.push([x, y, isLit]);
        }
      }
      // faint glow around the lit part
      var litCount = lit.filter(function (p) { return p[2]; }).length;
      if (litCount) for (var gy = -9; gy < 21; gy++) for (var gx = -9; gx < 21; gx++) {
        var best = 99;
        for (var k = 0; k < lit.length; k++) if (lit[k][2]) { var ddx = gx - lit[k][0], ddy = gy - lit[k][1], dd = ddx * ddx + ddy * ddy; if (dd < best) best = dd; }
        if (best === 0) continue;
        var v = 13 * Math.pow(0.7, Math.sqrt(best) - 1) * (0.4 + 0.6 * litCount / 124);
        if (v < 0.5) continue;
        put(im, ox + gx, oy + gy, [Math.round(v * 0.36), Math.round(v * 0.57), Math.round(v)], 255);
      }
      for (k = 0; k < lit.length; k++) {
        var p = lit[k], X = p[0], Y = p[1], cr = crater(X, Y), c;
        var edge = !inDisc(X + 1, Y) || !inDisc(X, Y + 1);
        if (p[2]) {
          var t = cr ? 0.12 + rn(X, Y, sd + cr) * 0.25 : 0.72 + rn(X, Y, sd) * 0.35 - (edge ? 0.22 : 0);
          if (cr && crater(X - 1, Y - 1) !== cr) t += 0.25;   // lit rim of the crater
          c = pick(LIT, t);
        } else {
          c = pick(DARKS, (cr ? 0.1 : 0.5) + rn(X, Y, sd + 50) * 0.4);
        }
        put(im, ox + X, oy + Y, c, 255);
      }
    }
    return im;
  }

  /* ================================================================== HUD ICONS */
  function icon(w, h, rows, colors) {
    var im = Img(w, h);
    pattern(im, 0, 0, rows, function (ch) { return colors[ch] ? colors[ch] : null; });
    return im;
  }
  function crop(src, keep) { // keep(x) -> bool (columns)
    var im = Img(src.w, src.h);
    for (var y = 0; y < src.h; y++) for (var x = 0; x < src.w; x++) if (keep(x)) { var c = get(src, x, y); if (c[3]) put(im, x, y, c); }
    return im;
  }
  function overlay(a, b) { // b drawn over a (both same size, alpha 0/255)
    var im = Img(a.w, a.h); im.data.set(a.data);
    for (var y = 0; y < b.h; y++) for (var x = 0; x < b.w; x++) { var c = get(b, x, y); if (c[3]) put(im, x, y, c); }
    return im;
  }
  function guiIcons() {
    var gui = {};
    var OUT = hx('#000000'), WHT = hx('#ffffff');
    var HEART = [
      '.OO...OO.',
      'OwhO.OhrO',
      'OhrrOrrrO',
      'OrrrrrrdO',
      '.OrrrrdO.',
      '..OrrdO..',
      '...OdO...',
      '....O....',
      '.........'
    ];
    var EMPTY = { O: OUT, w: hx('#4a4a4a'), h: hx('#3a3a3a'), r: hx('#2c2c2c'), d: hx('#1f1f1f') };
    gui.heart_container = icon(9, 9, HEART, EMPTY);
    gui.heart_container_blink = icon(9, 9, HEART, { O: WHT, w: EMPTY.w, h: EMPTY.h, r: EMPTY.r, d: EMPTY.d });
    var FULL = { O: OUT, w: WHT, h: hx('#ff6a6a'), r: hx('#ff1313'), d: hx('#bb0000') };
    var FULLB = { O: WHT, w: WHT, h: hx('#ffb0b0'), r: hx('#ff6060'), d: hx('#e02020') };
    gui.heart_full = icon(9, 9, HEART, FULL);
    gui.heart_full_blink = icon(9, 9, HEART, FULLB);
    gui.heart_half = crop(gui.heart_full, function (x) { return x <= 4; });
    gui.heart_half_blink = crop(gui.heart_full_blink, function (x) { return x <= 4; });

    var FOOD = [
      '....OOO..',
      '...OhmmO.',
      '..OhmmmdO',
      '..OmmmmdO',
      '..OmmmdO.',
      '.OOOddO..',
      'ObwbOO...',
      'OwbO.....',
      '.OO......'
    ];
    gui.food_container = icon(9, 9, FOOD, { O: OUT, h: hx('#3a3a3a'), m: hx('#2c2c2c'), d: hx('#1f1f1f'), b: hx('#2c2c2c'), w: hx('#3a3a3a') });
    gui.food_full = icon(9, 9, FOOD, { O: OUT, h: hx('#e9a15d'), m: hx('#b8672b'), d: hx('#7a3f14'), b: hx('#d8d0b9'), w: hx('#fdf8ea') });
    gui.food_half = crop(gui.food_full, function (x) { return x >= 4; });   // hunger drains from the left: the half keeps the right part

    var ARMOR = [
      'OOO...OOO',
      'OwmO.OmdO',
      'OmmmOmmdO',
      'OmmmmmmdO',
      '.OmmmmdO.',
      '.OmmmmdO.',
      '.OmmmmdO.',
      '.OOOOOOO.',
      '.........'
    ];
    gui.armor_empty = icon(9, 9, ARMOR, { O: OUT, w: hx('#3a3a3a'), m: hx('#2c2c2c'), d: hx('#1f1f1f') });
    gui.armor_full = icon(9, 9, ARMOR, { O: OUT, w: WHT, m: hx('#cfcfcf'), d: hx('#8e8e8e') });
    gui.armor_half = overlay(gui.armor_empty, crop(gui.armor_full, function (x) { return x <= 4; }));

    var BUB = [
      '..OOOOO..',
      '.ObbbbbO.',
      'ObwwbbbbO',
      'ObwbbbbbO',
      'ObbbbbbbO',
      'ObbbbbbdO',
      'ObbbbbddO',
      '.ObbbddO.',
      '..OOOOO..'
    ];
    gui.bubble = icon(9, 9, BUB, { O: hx('#1b3f9a'), b: hx('#4f9dff'), w: WHT, d: hx('#2e6bdc') });
    gui.bubble_pop = icon(9, 9, [
      '..OO.OO..',
      '.O.....O.',
      'O.......O',
      '.........',
      '....w....',
      '.........',
      'O.......O',
      '.O.....O.',
      '..OO.OO..'
    ], { O: hx('#7cc0ff'), w: WHT });

    // xp bar (182x5)
    var bg = Img(182, 5), fg = Img(182, 5);
    var BGI = pal(['#3c3c3c', '#303030', '#262626']), FGI = pal(['#80ff20', '#6ee01a', '#58bb13']);
    for (var x = 0; x < 182; x++) for (var y = 0; y < 5; y++) {
      var border = y === 0 || y === 4 || x === 0 || x === 181;
      put(bg, x, y, border ? OUT : BGI[y - 1]);
      put(fg, x, y, border ? (y === 4 ? hx('#153d02') : hx('#1f5205')) : FGI[y - 1]);
    }
    gui.xp_bar_bg = bg; gui.xp_bar_fg = fg;
    // crosshair 15x15
    var ch = Img(15, 15);
    for (var i = 0; i < 15; i++) { put(ch, i, 7, WHT); put(ch, 7, i, WHT); }
    gui.crosshair = ch;
    return gui;
  }

  /* ================================================================== publish */
  var skins = {
    steve: steveSkin(), zombie: zombieSkin(), skeleton: skeletonSkin(), creeper: creeperSkin(), pig: pigSkin(), cow: cowSkin(),
    sheep: sheepSkin(), sheep_fur: sheepFur(), chicken: chickenSkin(), spider: spiderSkin(), spider_eyes: spiderEyes()
  };
  var env = { sun: sunTex(), moon: moonTex() };
  var gui = guiIcons();

  G.TexEntities = { skins: skins, env: env, gui: gui };
})(typeof window !== 'undefined' ? window : globalThis);
