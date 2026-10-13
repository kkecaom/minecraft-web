// The diorama around the Divine Beast, in WORLD coordinates (spire axis at x=0,z=0): Rito Village's rock spire rising from Lake Totori,
// the spiral boardwalk with its huts, the chain of rock stacks and rope bridges to the shore, and Vah Medoh perched on top.
'use strict';
const zlib = require('zlib');
const { Vox, sh, put } = require('./vox');
const { h3 } = require('./medoh');
const PI = Math.PI;
const DECK_Y = 207, MX = 23, WATER = 63;
const TOP_Y = 153;                       // top of the perch (the talons close around it)
const WALK_Y0 = 66, WALK_Y1 = 136, WALK_TURNS = 3.3;
const STACKS = [[52, -7, 10, 70], [88, 9, 9, 68], [123, 24, 11, 67]];   // x, z, radius, top y
const SHORE = [150, 30, 66];             // where the last bridge lands (the terrain generator keeps this flat)

function buildScene(mc, medoh) {
  const SH = mc.SH, B = SH.BID;
  const v = new Vox(-140, 44, -124, 200, 250, 124);
  const P = new SH.Perlin(4711), fb = (a, b, o) => SH.fbm2(P, a, b, o || 3);
  const air = (x, y, z) => v.get(x, y, z) === 0;
  const ROCKS = new Set([B.stone, B.andesite, B.light_gray_terracotta, B.white_terracotta, B.cobblestone, B.mossy_cobblestone, B.terracotta]);
  const rockMat = (x, y, z) => {
    const n = fb(x * 0.045 + 3, z * 0.045 - 2, 2) * 9 + fb(x * 0.2, y * 0.2 + z * 0.13, 2) * 2.2;
    const m = (((Math.floor(y + n)) % 15) + 15) % 15, r = h3(x, y, z);
    if (y <= WATER + 1 && r < 0.4) return B.mossy_cobblestone;
    if (m < 3) return B.light_gray_terracotta; if (m === 5) return B.white_terracotta; if (m === 6) return r < 0.5 ? B.white_terracotta : B.stone;
    if (m === 9 || m === 10) return B.andesite; if (m === 13) return r < 0.55 ? B.terracotta : B.light_gray_terracotta;
    return r < 0.08 ? B.cobblestone : B.stone;
  };

  // ---------------------------------------------------------------- the spire
  const win = y => Math.sin(PI * Math.max(0, Math.min(1, (y - 60) / (134 - 60))));
  const axis = y => { const t = (y - 60) / 95, w = win(y); return [(5.5 * Math.sin(t * 5.2) + 2.5 * Math.sin(t * 11.3 + 1)) * w, (5 * Math.sin(t * 4.4 + 2.1) + 2 * Math.sin(t * 9.1)) * w]; };
  const baseR = y => y < 66 ? 20 + (66 - y) * 1.3 : y < 80 ? 20 - (y - 66) * 0.5 : y < 104 ? 13 - (y - 80) * 0.14 : 9.6 - (y - 104) * 0.05 + 1.3 * Math.sin((y - 104) * 0.33);
  // radius of the rock at height y in direction th (the cap widens into a ridge lying along z, under the talons)
  const rockR = (th, y) => {
    let rx, rz;
    if (y < 131) { rx = rz = baseR(y); }
    else { const s = Math.min(1, (y - 131) / 16), k = s * s * (3 - 2 * s), b = baseR(131); rx = b + (11 - b) * k; rz = b + (19.5 - b) * k; if (y > 149) { const q = 1 - Math.pow((y - 149) / 5.2, 2) * 0.32; rx *= q; rz *= q; } }
    const c = Math.cos(th), s2 = Math.sin(th), r = 1 / Math.sqrt(c * c / (rx * rx) + s2 * s2 / (rz * rz));
    return r * (1 + 0.15 * fb(th * 1.4 + 7, y * 0.06, 3)) + 1.3 * fb(th * 4.2, y * 0.19 + 3, 2);
  };
  for (let y = 46; y <= TOP_Y; y++) { const a = axis(y), R = 46;
    for (let z = Math.floor(a[1] - R); z <= a[1] + R; z++) for (let x = Math.floor(a[0] - R); x <= a[0] + R; x++) { const dx = x - a[0], dz = z - a[1], d = Math.hypot(dx, dz); if (d <= rockR(Math.atan2(dz, dx), y)) v.set(x, y, z, rockMat(x, y, z)); } }
  // base island: a low grassy shelf around the foot of the spire
  for (let z = -34; z <= 34; z++) for (let x = -36; x <= 38; x++) { const th = Math.atan2(z, x - 2), lim = 1 + 0.2 * fb(th * 1.6 + 1, 0.5, 3), d = Math.hypot((x - 2) / 30, z / 26) / lim; if (d > 1) continue;
    const top = d > 0.86 ? 64 : 65; for (let y = 46 + Math.floor(d * d * 10); y <= top; y++) if (air(x, y, z)) v.set(x, y, z, rockMat(x, y, z)); }
  // rock stacks toward the shore
  for (const [sx, sz, sr, sy] of STACKS) for (let y = 46; y <= sy; y++) { const k = (y - 46) / (sy - 46), r0 = sr * (0.72 + 0.34 * Math.pow(k, 3)) + (y < 56 ? (56 - y) * 0.8 : 0);
    for (let z = sz - sr - 12; z <= sz + sr + 12; z++) for (let x = sx - sr - 12; x <= sx + sr + 12; x++) { const th = Math.atan2(z - sz, x - sx); if (Math.hypot(x - sx, z - sz) <= r0 * (1 + 0.18 * fb(th * 1.5 + sx, y * 0.08, 3))) v.set(x, y, z, rockMat(x, y, z)); } }

  // ---------------------------------------------------------------- grass, soil, snow dusting on the flat tops
  const isRock = id => ROCKS.has(id);
  for (let z = v.z0; z <= v.z1; z++) for (let x = v.x0; x <= v.x1; x++) for (let y = TOP_Y; y >= WATER + 1; y--) {
    if (!isRock(v.get(x, y, z)) || !air(x, y + 1, z)) continue;
    let flat = 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (v.get(x + dx, y, z + dz) && air(x + dx, y + 1, z + dz)) flat++;
    const onSpire = y > 67;
    if (flat >= (onSpire ? 3 : 2) && (!onSpire || h3(x, y, z) < 0.8 || y > 148)) { v.set(x, y, z, B.grass_block); if (isRock(v.get(x, y - 1, z))) v.set(x, y - 1, z, B.dirt); }
  }

  // ---------------------------------------------------------------- the boardwalk: a wooden ramp spiralling up the spire
  const PL = B.spruce_planks, SL = B.spruce_slab, LOG = B.spruce_log, FEN = B.oak_fence, DPL = B.dark_oak_planks, DSL = B.dark_oak_slab;
  const TH_MAX = WALK_TURNS * 2 * PI, pathY = TH => WALK_Y0 + (WALK_Y1 - WALK_Y0) * TH / TH_MAX;
  const deck = [];   // [x, z, surface height (multiples of 0.5), total angle]
  const unwrap = (ang, ref) => ang + 2 * PI * Math.round((ref - ang) / (2 * PI)), dseen = new Set();
  for (let z = -40; z <= 40; z++) for (let x = -40; x <= 40; x++) for (let n = -1; n <= Math.ceil(WALK_TURNS) + 1; n++) {
    // the axis wanders with height, so solve for the total angle TH by fixed-point iteration (angles unwrapped next to the previous estimate)
    let TH = Math.atan2(z, x) + 2 * PI * n;
    for (let k = 0; k < 4; k++) { const a = axis(pathY(TH)); TH = unwrap(Math.atan2(z - a[1], x - a[0]), TH); }
    if (TH < 0.15 || TH > TH_MAX) continue;
    const y = pathY(TH), a = axis(y), d = Math.hypot(x - a[0], z - a[1]), r = rockR(Math.atan2(z - a[1], x - a[0]), Math.round(y));
    const ro = d - r; if (ro < -1.2 || ro >= 3.6) continue;
    const dk = x + ',' + z + ',' + Math.round(y / 4); if (dseen.has(dk)) continue; dseen.add(dk);
    deck.push([x, z, Math.round(y * 2) / 2, TH, ro]);
  }
  for (const [x, z, hs, TH, ro] of deck) {
    const full = Number.isInteger(hs), by = full ? hs - 1 : Math.floor(hs), rail = ro >= 2.6;
    for (let y = by + 1; y <= by + 4; y++) if (isRock(v.get(x, y, z)) || v.get(x, y, z) === B.grass_block || v.get(x, y, z) === B.dirt) v.set(x, y, z, 0);   // headroom
    if (rail) { v.set(x, Math.ceil(hs) - 1, z, PL); v.set(x, Math.ceil(hs), z, FEN); if ((Math.round(TH * 9) % 7) === 0) { v.set(x, Math.ceil(hs) + 1, z, FEN); v.set(x, Math.ceil(hs) + 2, z, B.lantern); for (let y = Math.ceil(hs) - 2; y >= Math.ceil(hs) - 5; y--) if (air(x, y, z)) v.set(x, y, z, LOG); } }
    else if (ro >= 0) { if (full) v.set(x, by, z, PL); else { v.set(x, by, z, SL, 0); } if (air(x, by - 1, z) && ro < 1) v.set(x, by - 1, z, LOG); }
    else if (air(x, by, z)) v.set(x, by, z, full ? PL : SL);
  }

  // ---------------------------------------------------------------- Rito huts: round open pavilions cantilevered off the boardwalk
  const WOOLS = [B.red_wool, B.light_blue_wool, B.yellow_wool, B.white_wool, B.cyan_wool, B.orange_wool, B.magenta_wool, B.lime_wool];
  const hut = (TH, k, big) => {
    const y = Math.round(pathY(TH)), a = axis(y), th = TH % (2 * PI), r = rockR(th, y), R = big ? 7.5 : 4.8, cx = Math.round(a[0] + Math.cos(th) * (r + R + 4.6)), cz = Math.round(a[1] + Math.sin(th) * (r + R + 4.6)), fy = y - 1;
    // a gangway from the boardwalk (which runs on behind the hut) across to the pavilion
    for (let ro = 1.5; ro <= R + 5.5; ro += 0.5) for (const w of [-1, 0, 1]) { const gx = Math.round(a[0] + Math.cos(th) * (r + ro) - Math.sin(th) * w), gz = Math.round(a[1] + Math.sin(th) * (r + ro) + Math.cos(th) * w); if (ro > 2.4) v.set(gx, fy, gz, PL); for (let yy = fy + 1; yy <= fy + 3; yy++) { const c = v.get(gx, yy, gz); if (c === FEN || c === B.lantern || (ro > 2.4 && c === PL) || c === SL) v.set(gx, yy, gz, 0); } }
    // floor
    for (let dz = -9; dz <= 9; dz++) for (let dx = -9; dx <= 9; dx++) { const d = Math.hypot(dx, dz); if (d > R) continue; const x = cx + dx, z = cz + dz;
      for (let yy = fy + 1; yy <= fy + 5; yy++) { const c = v.get(x, yy, z); if (c && (isRock(c) || c === B.grass_block || c === B.dirt || c === FEN || c === B.lantern)) v.set(x, yy, z, 0); }
      v.set(x, fy, z, d > R - 1.1 ? DPL : ((Math.round(dx) + Math.round(dz)) & 1 ? PL : (big ? B.birch_planks : PL))); }
    // braces down to the rock
    for (let i = 0; i < 3; i++) { const ba = th + (i - 1) * 0.5, bx = cx + Math.cos(ba) * (R - 1), bz = cz + Math.sin(ba) * (R - 1); put(v, sh.cap([bx, fy - 1, bz], [a[0] + Math.cos(th) * (r - 1), fy - 3 - R * 0.9, a[1] + Math.sin(th) * (r - 1)], 0.7), LOG, 'air'); }
    if (big) {   // Revali's Landing: an open flight deck with a painted target
      for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) { const d = Math.hypot(dx, dz), x = cx + dx, z = cz + dz; if (d > R) continue;
        if (d < 4.6) v.set(x, fy + 1, z, d < 1.2 ? B.red_carpet : d < 2.6 ? B.white_carpet : d < 3.8 ? B.light_blue_carpet : B.white_carpet);
        else if (d > R - 1.1) { const out = Math.cos(Math.atan2(dz, dx) - th); if (out < 0.55 && out > -0.6) v.set(x, fy + 1, z, FEN); } }
      for (const s of [-1, 1]) { const px = Math.round(cx + Math.cos(th + s * 1.05) * (R - 0.6)), pz = Math.round(cz + Math.sin(th + s * 1.05) * (R - 0.6)); for (let yy = 1; yy <= 4; yy++) v.set(px, fy + yy, pz, FEN); v.set(px, fy + 5, pz, B.lantern); v.set(px, fy + 3, pz, WOOLS[1]); v.set(px, fy + 2, pz, WOOLS[3]); }
      return;
    }
    // posts + ring beam
    const posts = []; for (let i = 0; i < 6; i++) { const pa = th + PI / 6 + i * PI / 3, px = Math.round(cx + Math.cos(pa) * (R - 0.7)), pz = Math.round(cz + Math.sin(pa) * (R - 0.7)); posts.push([px, pz]); for (let yy = 1; yy <= 4; yy++) v.set(px, fy + yy, pz, yy === 4 ? LOG : FEN); }
    // conical roof with cloth stripes and a finial
    const wool = WOOLS[k % WOOLS.length], wool2 = WOOLS[(k + 3) % WOOLS.length];
    for (let lay = 0; lay < 6; lay++) { const rr = R + 1.2 - lay * 1.15, yy = fy + 5 + lay; if (rr < 0.4) { v.set(cx, yy, cz, DPL); continue; }
      for (let dz = -Math.ceil(rr); dz <= Math.ceil(rr); dz++) for (let dx = -Math.ceil(rr); dx <= Math.ceil(rr); dx++) { const d = Math.hypot(dx, dz); if (d > rr || d < rr - 1.9) continue; v.set(cx + dx, yy, cz + dz, lay === 0 ? (d > rr - 0.95 ? DSL : DPL) : lay === 2 ? wool : lay === 4 ? wool2 : DPL, 0); } }
    v.set(cx, fy + 11, cz, FEN); v.set(cx, fy + 12, cz, FEN); v.set(cx, fy + 13, cz, wool);
    v.set(cx, fy + 9, cz, DPL); v.set(cx, fy + 8, cz, B.lantern, 1);                                   // lamp hanging under the roof
    // banners on the rim, furniture inside
    for (let i = 0; i < 6; i += 2) { const [px, pz] = posts[i]; const ox = Math.sign(px - cx), oz = Math.sign(pz - cz); if (air(px + ox, fy + 4, pz + oz)) { v.set(px + ox, fy + 4, pz + oz, wool); v.set(px + ox, fy + 3, pz + oz, wool2); } }
    const fx = Math.round(cx - Math.cos(th) * (R - 2)), fz = Math.round(cz - Math.sin(th) * (R - 2)), side = [Math.round(-Math.sin(th) * 2), Math.round(Math.cos(th) * 2)];
    const FURN = [[B.barrel, B.crafting_table], [B.loom, B.bookshelf], [B.cartography_table, B.barrel], [B.fletching_table, B.hay_block], [B.smoker, B.barrel], [B.bookshelf, B.lectern], [B.fletching_table, B.loom]][k % 7];
    v.set(fx + side[0], fy + 1, fz + side[1], FURN[0]); v.set(fx - side[0], fy + 1, fz - side[1], FURN[1]); v.set(cx, fy + 1, cz, [B.red_carpet, B.light_blue_carpet, B.yellow_carpet, B.cyan_carpet][k % 4]);
    // rail on the outer half
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) { const d = Math.hypot(dx, dz); if (d > R || d < R - 1.1) continue; const out = Math.cos(Math.atan2(dz, dx) - th); if (out > 0.1 && air(cx + dx, fy + 1, cz + dz)) v.set(cx + dx, fy + 1, cz + dz, FEN); }
  };
  const HUTS = [0.55, 0.98, 1.4, 1.83, 2.25, 2.95]; HUTS.forEach((t, k) => hut(t * 2 * PI, k, false));
  hut(2.62 * 2 * PI, 7, true);

  // ---------------------------------------------------------------- bridges: base island -> three rock stacks -> the shore
  const bridge = (a, b) => { const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.ceil(L * 2), ux = (b[0] - a[0]) / L, uz = (b[2] - a[2]) / L;
    for (let i = 0; i <= n; i++) { const k = i / n, x = a[0] + (b[0] - a[0]) * k, z = a[2] + (b[2] - a[2]) * k, y = Math.round(a[1] + (b[1] - a[1]) * k - Math.sin(k * PI) * 1.6);
      for (let w = -2; w <= 2; w++) { const px = Math.round(x - uz * w), pz = Math.round(z + ux * w); for (let yy = y + 1; yy <= y + 4; yy++) { const c = v.get(px, yy, pz); if (c && (isRock(c) || c === B.grass_block || c === B.dirt)) v.set(px, yy, pz, 0); }
        if (Math.abs(w) === 2) { if (!v.get(px, y, pz) || v.get(px, y, pz) === PL) { v.set(px, y, pz, DPL); if (air(px, y + 1, pz)) v.set(px, y + 1, pz, FEN); } }
        else { v.set(px, y, pz, (i % 6) < 3 ? PL : B.oak_planks); if (v.get(px, y + 1, pz) === FEN) v.set(px, y + 1, pz, 0); } } }
    for (const e of [a, b]) for (const w of [-2, 2]) { const px = Math.round(e[0] - uz * w), pz = Math.round(e[2] + ux * w); for (let yy = e[1] - 3; yy <= e[1] + 3; yy++) v.set(px, yy, pz, yy <= e[1] + 2 ? LOG : B.lantern); } };
  const P0 = [30, 65, -3]; let prev = P0;
  for (const [sx, sz, sr, sy] of STACKS) { const ang = Math.atan2(sz - prev[2], sx - prev[0]); bridge(prev, [Math.round(sx - Math.cos(ang) * (sr - 3)), sy, Math.round(sz - Math.sin(ang) * (sr - 3))]); prev = [Math.round(sx + (sr - 3)), sy, sz + 2]; }
  bridge(prev, [SHORE[0], SHORE[2], SHORE[1]]);
  // a path of planks from the first bridge to the foot of the boardwalk
  for (let x = 16; x <= 31; x++) for (let z = -5; z <= -1; z++) if (v.get(x, 65, z) && air(x, 66, z)) v.set(x, 65, z, (x + z) & 1 ? PL : B.oak_planks);

  // ---------------------------------------------------------------- trees and undergrowth
  const rnd = SH.mulberry32(99);
  const tput = (x, y, z, id, isLog, pm) => { if (v.inb(x, y, z) && v.get(x, y, z) === 0) v.set(x, y, z, id, pm | 0); };
  const tree = (x, z) => { for (let y = 80; y >= WATER + 1; y--) if (v.get(x, y, z) === B.grass_block) { if (air(x, y + 1, z) && air(x, y + 6, z)) SH.growTree(1, 'spruce', x, y + 1, z, rnd, tput); return; } };
  for (const [x, z] of [[-22, 10], [-25, -8], [-12, 22], [-14, -21], [6, 23], [10, -24], [-31, 2], [24, 15], [50, -12], [56, -3], [86, 13], [126, 19], [119, 29], [-4, -26]]) tree(x, z);
  for (let z = v.z0; z <= v.z1; z++) for (let x = v.x0; x <= v.x1; x++) for (let y = TOP_Y + 1; y >= WATER + 2; y--) { if (v.get(x, y - 1, z) !== B.grass_block || !air(x, y, z)) continue; const r = h3(x, 5, z);
    if (r < 0.28) v.set(x, y, z, B.short_grass); else if (r < 0.34) v.set(x, y, z, B.fern); else if (r < 0.37) v.set(x, y, z, [B.cornflower, B.oxeye_daisy, B.azure_bluet, B.blue_orchid][Math.floor(r * 1000) % 4]); }

  // ---------------------------------------------------------------- a Sheikah shrine (already cleared: blue) beside the landing on the shore
  {
    const A = B.ancient_stone_dark, AC = B.ancient_carved_dark, AG = B.ancient_gold, GL = B.ancient_glow_blue, AP = B.ancient_pillar, sx = 173, sz = 10, sy = 67;
    put(v, sh.cylY(sx, sz, 7.2, sy - 3, sy - 1), A);                                                             // footing (sunk into the turf)
    put(v, sh.cylY(sx, sz, 6.4, sy, sy + 1), (x, y, z) => Math.hypot(x - sx, z - sz) > 5.3 ? (y === sy + 1 ? GL : AG) : A);
    put(v, sh.ell(sx, sy + 2, sz, 5.6, 8.5, 5.6), (x, y, z) => { if (y < sy + 2) return undefined; const h = y - sy; return h === 5 ? GL : (h === 4 || h === 6) ? AG : ((x + z + y) % 3 === 0 ? AC : A); });
    for (let y = sy + 10; y <= sy + 13; y++) v.set(sx, y, sz, y === sy + 13 ? GL : AG);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) v.set(sx + dx, sy + 10, sz + dz, AG);
    // doorway facing the lake, with the eye above it
    for (let x = sx - 7; x <= sx - 2; x++) for (let z = sz - 1; z <= sz + 1; z++) for (let y = sy + 2; y <= sy + 5; y++) v.set(x, y, z, 0);
    for (let y = sy + 2; y <= sy + 6; y++) for (const dz of [-2, 2]) for (let x = sx - 6; x <= sx - 5; x++) if (v.get(x, y, sz + dz) || x === sx - 6) v.set(x, y, sz + dz, AG);
    for (let z = sz - 2; z <= sz + 2; z++) v.set(sx - 6, sy + 6, z, AG); v.set(sx - 6, sy + 7, sz, GL); v.set(sx - 6, sy + 6, sz, GL);
    v.set(sx - 1, sy + 2, sz, AP); v.set(sx - 1, sy + 3, sz, GL);                                                 // the altar inside
    // the round travel pad in front
    put(v, sh.cylY(sx - 11, sz, 3.4, sy - 1, sy), (x, y, z) => { const r = Math.hypot(x - sx + 11, z - sz); return y < sy ? A : r > 2.5 ? AG : r > 1.3 ? GL : A; });
    for (let x = sx - 8; x <= sx - 7; x++) for (let z = sz - 1; z <= sz + 1; z++) { v.set(x, sy, z, AG); v.set(x, sy + 1, z, x === sx - 7 ? AG : 0); }
    v.set(sx - 8, sy + 1, sz - 2, AP); v.set(sx - 8, sy + 2, sz - 2, GL); v.set(sx - 8, sy + 1, sz + 2, AP); v.set(sx - 8, sy + 2, sz + 2, GL);
  }

  // ---------------------------------------------------------------- Vah Medoh
  v.blit(medoh, MX, DECK_Y, 0);
  return v;
}

// ---- blueprint: palette + per-chunk column runs, raw-deflated. Layout (LE): 'MDH1', u16 nPal, nPal*(id,meta), u16 nChunks, nChunks*(i16 cx, i16 cz, u32 offset), data
function encodeBlueprint(v) {
  const pal = [], palIdx = new Map(), chunks = new Map();
  for (let z = v.z0; z <= v.z1; z++) for (let x = v.x0; x <= v.x1; x++) {
    let runs = null, cur = -1, y0 = 0;
    for (let y = v.y0; y <= v.y1 + 1; y++) {
      let p = -1; if (y <= v.y1) { const i = v.idx(x, y, z), id = v.b[i]; if (id) { const key = id * 256 + v.m[i]; p = palIdx.get(key); if (p === undefined) { p = pal.length; pal.push([id, v.m[i]]); palIdx.set(key, p); } } }
      if (p !== cur || (cur >= 0 && y - y0 === 255)) { if (cur >= 0) (runs = runs || []).push(y0, y - y0, cur); cur = p; y0 = y; }
    }
    if (!runs) continue;
    const ck = (x >> 4) + ',' + (z >> 4); let c = chunks.get(ck); if (!c) { c = { cx: x >> 4, cz: z >> 4, cols: new Array(256).fill(null) }; chunks.set(ck, c); }
    c.cols[((z & 15) << 4) | (x & 15)] = runs;
  }
  if (pal.length > 256) throw new Error('blueprint palette too large: ' + pal.length);
  const list = Array.from(chunks.values()), parts = [], dir = Buffer.alloc(list.length * 8); let off = 0;
  list.forEach((c, i) => { const bytes = []; for (const r of c.cols) { if (!r) { bytes.push(0); continue; } if (r.length / 3 > 255) throw new Error('too many runs'); bytes.push(r.length / 3, ...r); }
    dir.writeInt16LE(c.cx, i * 8); dir.writeInt16LE(c.cz, i * 8 + 2); dir.writeUInt32LE(off, i * 8 + 4); parts.push(Buffer.from(bytes)); off += bytes.length; });
  const head = Buffer.alloc(6 + pal.length * 2 + 2); head.write('MDH1', 0, 'latin1'); head.writeUInt16LE(pal.length, 4); pal.forEach((p, i) => { head[6 + i * 2] = p[0]; head[7 + i * 2] = p[1]; }); head.writeUInt16LE(list.length, 6 + pal.length * 2);
  const raw = Buffer.concat([head, dir, ...parts]);
  return { raw, packed: zlib.deflateRawSync(raw, { level: 9 }), chunks: list.length, palette: pal.length };
}

module.exports = { buildScene, encodeBlueprint, DECK_Y, MX, WATER, TOP_Y, STACKS, SHORE };
