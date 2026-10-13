// Divine Beast Vah Medoh, sculpted block by block (procedurally) in local coordinates:
//   +x = forward (beak), +y = up, z = along the wings. y = 0 is the top deck of the wing beam.
// Freed state: blue energy, wings spread, talons lowered to grip the Rito spire.
'use strict';
const { Vox, sh, put } = require('./vox');
const PI = Math.PI, RAD = PI / 180;
function h3(x, y, z) { let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
const HUB_Z = 64, HUB_R = 13, CHORD0 = -11, CHORD1 = 10;

function buildMedoh(mc) {
  const B = mc.SH.BID;
  const ST = B.ancient_stone, SM = B.ancient_stone_mid, SD = B.ancient_stone_dark, GO = B.ancient_gold, CA = B.ancient_carved, CD = B.ancient_carved_dark,
    MO = B.ancient_moss, MC = B.ancient_moss_carved, PL = B.ancient_pillar, GB = B.ancient_glow_blue, GR = B.ancient_glow_orange, QZ = B.quartz_block;
  const v = new Vox(-136, -64, -116, 108, 34, 116);
  const air = (x, y, z) => v.get(x, y, z) === 0;
  const sym = fn => { fn(1); fn(-1); };
  // thick polyline
  const tube = (pts, r, mat, mode) => { for (let i = 0; i + 1 < pts.length; i++) put(v, sh.cap(pts[i], pts[i + 1], Array.isArray(r) ? r[i] : r, Array.isArray(r) ? r[i + 1] : r), mat, mode); };
  // visit solid voxels of a region with their exposure: cb(x,y,z,id,{up,down,side})
  const surf = (bb, cb) => {
    for (let y = bb[1]; y <= bb[4]; y++) for (let z = bb[2]; z <= bb[5]; z++) for (let x = bb[0]; x <= bb[3]; x++) {
      const id = v.get(x, y, z); if (!id) continue;
      const up = air(x, y + 1, z), down = air(x, y - 1, z), side = air(x + 1, y, z) || air(x - 1, y, z) || air(x, y, z + 1) || air(x, y, z - 1);
      if (!up && !down && !side) continue;
      const r = cb(x, y, z, id, up, down, side); if (r !== undefined && r !== null) v.set(x, y, z, r);
    }
  };

  // ============================================================== BODY (fuselage under the wing beam)
  const body = sh.ell(-6, -17, 0, 31, 12, 13.5);
  put(v, body, (x, y, z) => y < -20 ? SM : ST);
  // flank dressing: carved belt, energy dashes, darker keel
  surf([-40, -30, -15, 28, -6, 15], (x, y, z, id, up, down, side) => {
    if (!side && !down) return;
    if (y === -12 || y === -13) return CA;
    if (y === -15 && Math.abs(z) > 8) return ((x + 400) % 8) < 5 ? GB : SD;
    if (y === -14 || y === -16) return Math.abs(z) > 8 ? SD : undefined;
    if (y <= -24) return SD;
  });
  // rib cage: an oval frame on the belly with ivory slats over a dark, softly lit hollow
  for (let x = -26; x <= 12; x++) for (let z = -10; z <= 10; z++) {
    const d = Math.pow((x + 7) / 18, 2) + Math.pow(z / 9, 2); if (d > 1.0) continue;
    let yb = -40; for (let y = -31; y <= -18; y++) if (v.get(x, y, z)) { yb = y; break; }
    if (yb === -40) continue;
    if (d > 0.78) { v.set(x, yb, z, GO); v.set(x, yb - 1, z, GO); continue; }              // frame, one block proud
    const slat = (((x + Math.round(z * 0.45) + 400) % 5) < 2);
    if (slat) { v.set(x, yb, z, QZ); }
    else { v.set(x, yb, z, 0); v.set(x, yb + 1, z, 0); v.set(x, yb + 2, z, h3(x, 7, z) < 0.22 ? GB : SD); }
  }
  // collar where the neck leaves the chest
  put(v, sh.and(sh.cylX(-14, 0, 9.2, 21, 23), (x, y, z) => (y + 14) * (y + 14) + z * z >= 36), GO);
  put(v, sh.cylX(-14, 0, 7.4, 20, 24), (x, y, z, cur) => cur ? undefined : SM, 'air');

  // ============================================================== WING BEAM
  sym(s => {
    put(v, { bb: [CHORD0, -7, s > 0 ? 13 : -HUB_Z, CHORD1, 0, s > 0 ? HUB_Z : -13], t: (x, y, z) => y >= -(3 + Math.min(Math.min(x - CHORD0, CHORD1 - x), 4)) }, ST);
  });
  put(v, sh.box(-13, -7, -14, 12, 0, 14), ST);                                              // centre block (the plaza)
  // dress the beam: gold parapet, moss deck with inlaid tracks, dark carved frieze on the edges, energy dashes on the leading edge
  sym(s => {
    const z0 = s > 0 ? 15 : -(HUB_Z - 9), z1 = s > 0 ? HUB_Z - 9 : -15;
    for (let z = z0; z <= z1; z++) for (let x = CHORD0; x <= CHORD1; x++) {
      const e = Math.min(x - CHORD0, CHORD1 - x), az = Math.abs(z), joint = az === 16 || az === 17 || az === 37 || az === 38;
      // top
      let top = MO;
      if (e === 0) top = GO; else if (e === 1) top = joint ? GO : CA; else if (joint) top = GO; else if (x === -7 || x === 6) top = CA; else if (h3(x, 0, z) < 0.07) top = ST;
      v.set(x, 0, z, top); if (e === 0) v.set(x, 1, z, joint ? CA : GO);                    // parapet
      // edges (first two layers under the deck)
      if (e === 0) { v.set(x, -1, z, CD); v.set(x, -2, z, x === CHORD1 && (az % 9) < 6 ? GB : CD); v.set(x, -3, z, GO); }
      // underside
      for (let y = -8; y <= -1; y++) { if (!v.get(x, y, z) || !air(x, y - 1, z)) continue; const keel = x >= -3 && x <= 2;
        v.set(x, y, z, joint ? GO : keel ? ((az % 6) === 0 ? CA : SD) : (e <= 1 ? undefined : SM) || v.get(x, y, z)); }
    }
    // standing monoliths: two rows of weathered pillars, a few toppled, two bridged by lintels
    const rows = [-5, 3];
    for (const px of rows) for (let k = 0; k < 5; k++) {
      const pz = s * (21 + k * 7), hh = h3(px, k, s), h = hh < 0.16 ? 1 : 3 + Math.floor(hh * 4);
      for (let dy = 1; dy <= h; dy++) for (let ax = 0; ax < 2; ax++) for (let az2 = 0; az2 < 2; az2++) v.set(px + ax, dy, pz + az2 * s, PL);
      if (h >= 4) for (let ax = -1; ax <= 2; ax++) for (let az2 = -1; az2 <= 2; az2++) if ((ax >= 0 && ax <= 1) || (az2 >= 0 && az2 <= 1)) v.set(px + ax, h + 1, pz + az2 * s, GO);   // capital
      if (h === 1) { v.set(px + 2, 1, pz, PL); v.set(px + 3, 1, pz, PL); v.set(px + 2, 1, pz + s, PL); }   // fallen drum
    }
    for (const k of [1, 3]) { const pz = s * (21 + k * 7); for (let x = -5; x <= 4; x++) for (let a = 0; a < 2; a++) { v.set(x, 7, pz + a * s, PL); } for (const px of rows) for (let dy = 1; dy <= 6; dy++) for (let ax = 0; ax < 2; ax++) for (let a = 0; a < 2; a++) v.set(px + ax, dy, pz + a * s, PL); for (let x = -6; x <= 5; x++) for (let a = -1; a <= 2; a++) if (x === -6 || x === 5 || a === -1 || a === 2) v.set(x, 8, pz + a * s, GO); else v.set(x, 8, pz + a * s, CA); }
    // under-wing domes along the leading edge: amber lamps alternating with ivory grilles, each in a gold collar
    for (let k = 0; k < 4; k++) {
      const cz = s * (22 + k * 8.5), cx = 5;
      put(v, sh.cylY(cx, cz, 4.6, -7, -6), GO);
      put(v, sh.ell(cx, -7, cz, 3.8, 3.8, 3.8), (x, y, z) => y > -7 ? undefined : (k % 2 === 0 ? ((y === -8 || ((x + Math.round(z)) & 3) === 0) ? SD : GR) : ((x + y + Math.round(z)) & 1 ? QZ : SM)));
    }
    // glowing rosette under the trailing half
    const rz = s * 44; put(v, sh.ringY(-5, rz, 2.2, 3.4, -8, -7), (x, y, z) => v.get(x, y + 1, z) ? GB : undefined, 'air'); put(v, sh.cylY(-5, rz, 1.2, -8, -7), (x, y, z) => v.get(x, y + 1, z) ? GO : undefined, 'air');
  });

  // ============================================================== WING HUBS + FEATHERS + PROPELLERS
  const prop = (cx, cy, cz, R, a0) => {
    for (let k = 0; k < 3; k++) { const a = a0 + k * 120 * RAD, ex = cx + Math.cos(a) * R, ez = cz + Math.sin(a) * R;
      put(v, sh.and(sh.cap([cx, cy, cz], [ex, cy, ez], 0.75, 1.25), (x, y, z) => y === cy), QZ); }
    v.set(cx, cy, cz, GB); v.set(cx, cy - 1, cz, GO);
  };
  sym(s => {
    const hz = s * HUB_Z;
    // feathers first (the hub overlaps their roots)
    const ANG = [-17, 5, 27, 49, 71, 93], LEN = [47, 58, 57, 51, 43, 34], HW = [4.5, 5, 5, 4.6, 4.4, 4];
    for (let i = 5; i >= 0; i--) {
      const a = ANG[i] * RAD, ux = -Math.sin(a), uz = Math.cos(a) * s, L = LEN[i], hw = HW[i], yt = -1 - (i % 2), r0 = 8;
      const half = u => u > L - 7 ? hw * Math.sqrt(Math.max(0, 1 - Math.pow((u - (L - 7)) / 7, 2) * 0.82)) : (u < r0 + 3 ? hw - 0.6 : hw);
      const R = L + 2;
      v.fill([Math.min(0, ux * R) - hw - 1, yt - 2, Math.min(hz, hz + uz * R) - hw - 1, Math.max(0, ux * R) + hw + 1, yt, Math.max(hz, hz + uz * R) + hw + 1], null, (x, y, z, cur) => {
        const px = x, pz = z - hz, u = px * ux + pz * uz, w = -px * uz + pz * ux, aw = Math.abs(w);
        if (u < r0 || u > L) return undefined; const hwu = half(u); if (aw > hwu) return undefined;
        const edge = aw > hwu - 1.25 || u > L - 1.4, band = u > r0 + 6 && (Math.round(u) % 13) === 0;
        if (y === yt) return edge || band ? GO : (aw < 0.8 ? CA : MC);
        if (y === yt - 1) return edge ? CD : ST;
        return edge ? GO : (aw < 1.6 ? SD : (band ? CA : SM));
      });
      // feather-root pod with a three-bladed propeller (every other feather)
      if (i % 2 === 1) {
        const pu = 15, cx = Math.round(ux * pu), cz = Math.round(hz + uz * pu), py = yt - 3;
        put(v, sh.cylY(cx, cz, 3.3, py, py), GO);
        put(v, sh.ell(cx, py - 1, cz, 2.9, 3, 2.9), (x, y, z) => y === py - 2 ? GB : SD);
        prop(cx, py - 5, cz, 6.2, (i * 37 + (s > 0 ? 0 : 60)) * RAD);
      }
    }
    // hub disc
    put(v, sh.cylY(0, hz, HUB_R, -8, 0), ST);
    put(v, sh.ringY(0, hz, HUB_R - 1.3, HUB_R, 1, 1), GO);
    for (let z = hz - HUB_R; z <= hz + HUB_R; z++) for (let x = -HUB_R; x <= HUB_R; x++) {
      const r = Math.hypot(x, z - hz); if (r > HUB_R) continue;
      // top: concentric rings around a small energy lens
      let t = MO; if (r > HUB_R - 1.3) t = GO; else if (r > 9.6) t = MO; else if (r > 7.6) t = CA; else if (r > 5.4) t = MO; else if (r > 4.2) t = GO; else if (r > 2.4) t = GB; else t = SD;
      v.set(x, 0, z, t);
      // rim wall + underside
      if (r > HUB_R - 1.3) { for (let y = -7; y <= -1; y++) v.set(x, y, z, y === -4 ? (((Math.atan2(z - hz, x) / PI * 180 + 360) % 30) < 20 ? GB : CD) : (y === -1 || y === -7 ? GO : CD)); }
      v.set(x, -8, z, r > HUB_R - 1.3 ? GO : (r > 9.4 && r < 10.9 ? GB : SM));
    }
    put(v, sh.cylY(0, hz, 1.5, 1, 3), PL); v.set(0, 4, hz, GB); v.set(-1, 4, hz, 0);                    // lens pedestal
    put(v, sh.and(sh.cylY(0, hz, 1.5, 4, 4), (x, y, z) => true), GB);
    // the great turbine dome under the hub
    put(v, sh.ell(0, -8, hz, 8.6, 7.5, 8.6), (x, y, z) => { if (y > -9) return undefined; const r = Math.hypot(x, z - hz); return y === -11 ? CA : (y <= -15 && r < 2.6 ? GR : (y === -13 ? GB : SD)); });
    // the root of the hub is wrapped by a carved joint collar
    for (let x = CHORD0; x <= CHORD1; x++) for (let k = 0; k < 2; k++) { const z = s * (HUB_Z - 13 - k); for (let y = -8; y <= 1; y++) if (v.get(x, y, z) || y === 1) { if (y === 1 && Math.min(x - CHORD0, CHORD1 - x) > 0) continue; v.set(x, y, z, GO); } }
  });

  // ============================================================== CENTRAL PLAZA + MAIN CONTROL UNIT
  for (let z = -14; z <= 14; z++) for (let x = -13; x <= 12; x++) {
    const r = Math.hypot(x + 0.5, z), edge = x === -13 || x === 12;
    let t = MO;
    if (r <= 4.6) t = ST; else if (r <= 6) t = GO; else if (r <= 9.8) { const a = (Math.atan2(z, x + 0.5) / PI * 180 + 360) % 90; t = a > 39 && a < 51 ? GB : ((Math.round(r) + Math.floor(a / 15)) & 1 ? CD : SD); } else if (r <= 11.3) t = GO;
    else if (edge) t = GO; else if (Math.abs(z) === 14 || Math.abs(z) === 13) t = GO; else if (h3(x, 1, z) < 0.1) t = ST;
    v.set(x, 0, z, t);
    if (edge) { v.set(x, 1, z, Math.abs(z) < 4 && x === 12 ? 0 : GO); v.set(x, -1, z, CD); v.set(x, -2, z, x === 12 && (Math.abs(z) % 7) < 4 ? GB : CD); v.set(x, -3, z, GO); }
  }
  put(v, sh.cylY(-0.5, 0, 4.6, 1, 1), (x, y, z) => { const r = Math.hypot(x + 0.5, z); return r > 3.6 ? GO : r > 2.4 ? GB : CA; });
  put(v, sh.cylY(-0.5, 0, 2, 2, 4), (x, y, z) => y === 3 ? CA : GO);
  // the control unit: an energy core held in a gold cage, crowned by a finial
  put(v, sh.ell(-0.5, 9, 0, 3.6, 3.6, 3.6), GB);
  for (let a = 0; a < 360; a += 4) { const c = Math.cos(a * RAD) * 4.7, d = Math.sin(a * RAD) * 4.7; v.set(Math.round(-0.5 + c), Math.round(9 + d), 0, GO); v.set(Math.round(-0.5), Math.round(9 + d), Math.round(c), GO); v.set(-1, Math.round(9 + d), Math.round(c), GO); v.set(Math.round(-0.5 + c), Math.round(9 + d), -0, GO); }
  put(v, sh.ringY(-0.5, 0, 4.2, 5.3, 9, 9), GO);
  for (let y = 5; y <= 5; y++) put(v, sh.cylY(-0.5, 0, 1.6, y, y), GO);
  for (let y = 14; y <= 17; y++) { v.set(0, y, 0, GO); v.set(-1, y, 0, GO); } v.set(0, 18, 0, GB); v.set(-1, 18, 0, GB);

  // ============================================================== CARAPACE (the great ribbed hood behind the wings)
  const hoodW = x => x >= -26 ? 15 : 15 - (-26 - x) / 22 * 9.5;                                 // half width
  const hoodH = x => x >= -17 ? 15 + (x + 10) * (-2 / 7) * -1 * 0 + (2 - Math.abs(x + 17) * 0.28) : 17 - Math.pow((-17 - x) / 31, 1.25) * 12;   // crest height
  const inHood = (x, y, z, sw) => { const W = hoodW(x) - sw, H = hoodH(x) - sw; if (W <= 0 || H <= 0 || y < 0) return false; return Math.pow(Math.abs(z) / W, 2.4) + Math.pow(y / H, 2.4) <= 1; };
  v.fill([-48, 1, -16, -10, 20, 16], (x, y, z) => inHood(x, y, z, 0), ST);
  v.fill([-48, 1, -14, -13, 18, 14], (x, y, z) => inHood(x, y, z, 2.2) && x < -13, null, 'carve');   // hollow shell, open at the rear
  // ribs, spine and flank spirals
  surf([-48, 1, -16, -10, 20, 16], (x, y, z, id, up, down, side) => {
    if (x >= -11) return undefined; if (!up && !side) return undefined;
    if (!inHood(x, y, z, 0) || inHood(x, y, z, 1.01)) return undefined;                           // outer skin only
    const rib = ((x + 100) % 5) === 0;
    if (Math.abs(z) <= 1) return GO;
    if (rib) return GO;
    const d = Math.hypot(x + 24, y - 6), fl = Math.abs(z) > hoodW(x) - 3;
    if (fl && ((d > 4.2 && d < 5.6) || (d > 1.6 && d < 2.8))) return GO;
    return CA;
  });
  for (let x = -46; x <= -12; x += 5) { const H = Math.round(hoodH(x)); v.set(x, H + 1, 0, GO); v.set(x, H + 2, 0, GO); if (x > -40) v.set(x, H + 3, 0, GO); }   // spine crest
  for (let x = -47; x <= -11; x++) if (((x + 100) % 5) === 0) for (let z = -16; z <= 16; z++) for (let y = 19; y >= 1; y--) if (inHood(x, y, z, 0)) { const W = hoodW(x) + 1, H = hoodH(x) + 1; for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) { const zz = z + dz, yy = y + dy; if (!v.get(x, yy, zz) && !inHood(x, yy, zz, 0) && Math.pow(Math.abs(zz) / W, 2.4) + Math.pow(yy / H, 2.4) <= 1) v.set(x, yy, zz, GO); } }
  // the gate: a flat ornamental facade facing the plaza, with the door into the beast and two glowing ports
  for (let z = -15; z <= 15; z++) for (let y = 1; y <= 19; y++) {
    if (!inHood(-11, y, z, 0)) continue;
    const band = !inHood(-11, y, z, 2), inner = inHood(-11, y, z, 4) && !inHood(-11, y, z, 5.4), door = Math.abs(z) <= 1 && y <= 7, frame = Math.abs(z) <= 3 && y <= 9;
    const port = Math.hypot(Math.abs(z) - 8, y - 6);
    let t = band ? GO : inner ? GO : SD;
    if (port < 1.6) t = GB; else if (port < 2.7) t = GO; else if (!band && !inner && ((y + Math.abs(z)) % 4) === 0) t = CD;
    if (frame) t = GO; if (door) t = 0;
    v.set(-10, y, z, t); v.set(-11, y, z, door ? 0 : (band || frame ? GO : SD)); if (door) v.set(-12, y, z, 0);
  }
  for (let z = -1; z <= 1; z++) { v.set(-10, 8, z, GB); }
  // twin curled horns over the gate
  sym(s => { const P = [[2, 16], [2.2, 20], [3.5, 23], [6, 24], [8, 22.5], [8.2, 20], [6.5, 18.8], [5.2, 20]]; tube(P.map(p => [-10.5, p[1], p[0] * s]), [1.3, 1.25, 1.2, 1.1, 1.05, 1, 0.9, 0.8], GO); });
  put(v, sh.box(-11, 16, -1, -10, 19, 1), GO); v.set(-10, 18, 0, GB); v.set(-10, 17, 0, GB);

  // ============================================================== NECK + HEAD
  put(v, sh.cap([20, -14, 0], [50, -12, 0], 5.6, 5.2, true), (x, y, z) => { const k = (x - 20) % 8; return k === 3 ? GB : (k === 2 || k === 4) ? GO : ((x + y) & 1 && Math.abs(z) > 3 ? CA : ST); });
  put(v, sh.cap([24, -19, 0], [44, -17, 0], 2.2, 2, true), SD, 'air');                                   // throat line
  // eye housing
  put(v, sh.ell(56, -11, 0, 8.4, 8, 8.2), (x, y, z) => y < -15 ? SM : ST);
  sym(s => {
    for (let y = -19; y <= -3; y++) for (let x = 48; x <= 64; x++) { const r = Math.hypot(x - 56, y + 11); if (r > 6.6) continue;
      const t = r > 5.4 ? GO : r > 4.2 ? SD : r > 3 ? (((Math.atan2(y + 11, x - 56) / PI * 180 + 360) % 45) < 34 ? GB : SD) : r > 1.6 ? SD : GB;
      v.set(x, y, s * 8, r > 5.4 || r <= 4.2 ? t : t); v.set(x, y, s * 9, r > 5.4 ? GO : (r > 4.2 ? 0 : (r > 3 ? 0 : (r > 1.6 ? 0 : GB)))); if (r <= 5.4) v.set(x, y, s * 7, SD); if (r > 5.4) v.set(x, y, s * 8, GO); }
  });
  // upper beak: three stepped segments tapering to a blunt, flared tip, crossed by two energy bands
  const beak = (x0, x1, h0, h1, w0, w1, yTop0, yTop1) => { for (let x = x0; x <= x1; x++) { const k = (x - x0) / Math.max(1, x1 - x0), hh = h0 + (h1 - h0) * k, ww = w0 + (w1 - w0) * k, yt = yTop0 + (yTop1 - yTop0) * k;
    for (let y = Math.round(yt - hh); y <= Math.round(yt); y++) for (let z = -Math.round(ww); z <= Math.round(ww); z++) { const top = y === Math.round(yt), edge = Math.abs(z) === Math.round(ww), bot = y === Math.round(yt - hh);
      v.set(x, y, z, (x === 72 || x === 73 || x === 84 || x === 85) ? (top || edge || bot ? GB : SD) : top ? (Math.abs(z) <= 0 ? GO : CA) : edge ? (bot ? GO : ((x & 3) === 0 ? CA : ST)) : bot ? SM : ST); } } };
  beak(60, 71, 8.5, 7, 4.2, 3.6, -6.5, -7.5); beak(72, 85, 6.5, 5, 3.2, 2.4, -8, -9); beak(86, 97, 4, 2.6, 2, 1.2, -9.5, -10.5);
  for (const x of [60, 72, 86]) for (let y = -17; y <= -5; y++) for (let z = -5; z <= 5; z++) if (v.get(x, y, z) && (air(x, y + 1, z) || air(x, y, z + 1) || air(x, y, z - 1) || air(x, y - 1, z))) v.set(x, y, z, GO);
  put(v, sh.box(98, -13, -1, 100, -10, 1), GO); for (const z of [-2, 2]) { v.set(98, -11, z, GO); v.set(98, -12, z, GO); } v.set(101, -11, 0, GB); v.set(101, -12, 0, GO);
  // lower jaw: a hooked crescent
  tube([[55, -18, 0], [60, -21, 0], [66, -22.5, 0], [72, -22, 0], [77, -19.5, 0]], [3.4, 3, 2.6, 2, 1.1], (x, y, z) => Math.abs(z) >= 2 && y > -22 ? GO : SM, 'air');
  // crest: a swept dorsal fin, two horns and the plumes behind the eye
  for (let x = 44; x <= 61; x++) { const k = (61 - x) / 17, top = Math.round(-3 + k * 10 - Math.pow(k, 3) * 4); for (let y = -4; y <= top; y++) if (y > top - 4 - (1 - k) * 3) for (let z = -1; z <= 1; z++) v.set(x, y, z, Math.abs(z) === 1 && y < top ? CA : GO); }
  sym(s => { tube([[58, -5, 3 * s], [59, 0, 4 * s], [61, 4, 4.5 * s], [64, 7, 4 * s]], [1.5, 1.3, 1.1, 0.8], GO); tube([[50, -6, 5 * s], [44, -2, 8 * s], [38, 1, 9 * s], [33, 2, 8 * s]], [1.6, 1.4, 1.1, 0.8], (x, y, z) => (x & 1) ? GO : CA); tube([[50, -16, 6 * s], [44, -19, 9 * s], [39, -20, 9.5 * s]], [1.5, 1.2, 0.8], GO); });
  for (let x = 66; x <= 70; x++) for (let y = -6; y <= -6 + (70 - x); y++) v.set(x, y, 0, GO);                 // small fin on the beak

  // ============================================================== SHOULDERS (gear trains) + their propellers
  sym(s => {
    const cz = s * 15;
    for (let y = -16; y <= -2; y++) for (let x = 6; x <= 20; x++) { const r = Math.hypot(x - 13, y + 9); if (r > 6.9) continue; const a = (Math.atan2(y + 9, x - 13) / PI * 180 + 360) % 45;
      if (r > 5.6 && a > 22) continue; for (let k = 0; k < 3; k++) v.set(x, y, cz + s * k, k === 2 ? (r < 1.6 ? GB : r < 3 ? GO : r < 4.4 ? SD : GO) : (r > 4.4 ? GO : SD)); }
    const px = 4, pz = s * 21; put(v, sh.ell(px, -9, pz, 3, 3, 3), (x, y, z) => y === -10 ? GB : SD); put(v, sh.cylY(px, pz, 3.3, -8, -7), GO, 'air'); prop(px, -13, pz, 6.2, s > 0 ? 0.4 : 1.4);
  });

  // ============================================================== TAIL: landing deck, three layered lobes and the long spear
  put(v, sh.box(-52, -7, -9, -34, -4, 9), (x, y, z) => y === -4 ? (Math.abs(z) === 9 ? GO : MO) : (Math.abs(z) === 9 ? CD : SM));
  put(v, sh.ringY(-45, 0, 2.6, 3.8, -4, -4), GO); put(v, sh.cylY(-45, 0, 1.4, -4, -4), GB);
  for (let x = -37; x <= -33; x++) for (let z = -3; z <= 3; z++) v.set(x, -3 + Math.min(3, (x + 37)), z, GO);                // steps up into the hood
  const lobe = (cx, hl, hw, yt, tip) => {
    v.fill([cx - hl - 1, yt - 2, -hw - 1, cx + hl + 1, yt, hw + 1], null, (x, y, z) => {
      const u = (x - cx) / hl, w = Math.abs(z) / hw; let lim = u > 0 ? Math.sqrt(Math.max(0, 1 - u * u * 0.55)) : Math.sqrt(Math.max(0, 1 - Math.pow(-u, tip || 2.2)));
      lim *= 1 - 0.07 * Math.cos(u * 9);                                                                 // scalloped outline
      if (Math.abs(u) > 1 || w > lim) return undefined;
      const edge = w > lim - 1.3 / hw || u < -1 + 1.6 / hl, spine = Math.abs(z) <= 1;
      if (y === yt) return edge || spine ? GO : ((Math.abs(z) % 6) === 5 ? CA : MC);
      if (y === yt - 1) return edge ? CD : ST;
      return edge ? GO : (spine ? SD : SM);
    });
  };
  lobe(-93, 15, 12, -9, 1.6); lobe(-78, 16, 18, -7); lobe(-62, 14, 15, -5);
  for (let x = -128; x <= -100; x++) { const k = (-100 - x) / 28, hw = Math.round(5 - k * 4), yt = Math.round(-10 - k * 3);
    for (let z = -hw; z <= hw; z++) for (let y = yt - (k < 0.6 ? 2 : 1); y <= yt; y++) v.set(x, y, z, y === yt ? (Math.abs(z) === hw || (x % 6) === 0 ? GO : CA) : (Math.abs(z) === hw ? GO : SM)); }
  v.set(-129, -13, 0, GO); v.set(-130, -13, 0, GB);
  sym(s => { for (const [x, zz] of [[-70, 19], [-86, 17], [-99, 11]]) { tube([[x, -8, zz * s], [x - 6, -9, (zz + 5) * s], [x - 12, -11, (zz + 6) * s]], [1.6, 1.3, 0.8], GO, 'air'); } });   // side plumes

  // ============================================================== HIPS + LEGS (perched: talons lowered onto the rock)
  sym(s => {
    const hip = [-27, -21, 12 * s];
    put(v, sh.ell(hip[0], hip[1], hip[2], 7.6, 7.6, 7), (x, y, z) => { const r = Math.hypot(x - hip[0], y - hip[1]); return Math.abs(z) >= 17 ? (r < 2 ? GB : r < 3.4 ? GO : SD) : (Math.abs(r - 5.4) < 0.7 && Math.abs(z) > 14 ? GB : SM); });
    const knee = [-17, -37, 14 * s], ankle = [-23, -49, 11 * s];
    const seg = (a, b, ra, rb) => put(v, sh.cap(a, b, ra, rb), (x, y, z) => { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz), k = ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / L; const m = Math.round(k) % 5; return m === 2 ? GB : (m === 1 || m === 3) ? GO : ST; }, 'air');
    seg(hip, knee, 5, 4.3); put(v, sh.ell(knee[0], knee[1], knee[2], 5.2, 5.2, 5.2), (x, y, z) => Math.abs(z - knee[2]) > 3.4 ? GB : GO); seg(knee, ankle, 4.1, 3.4);
    put(v, sh.ell(ankle[0], ankle[1] - 1, ankle[2], 4.8, 3.2, 4.8), GO);
    // three fore talons and one hind talon, each curling down around the perch
    const toe = (dx, dz, len) => { const a = [ankle[0], ankle[1] - 2, ankle[2]], m = [ankle[0] + dx * len * 0.55, ankle[1] - 1.5, ankle[2] + dz * len * 0.55], e = [ankle[0] + dx * len, ankle[1] - 5, ankle[2] + dz * len], c = [ankle[0] + dx * (len + 0.5), ankle[1] - 10, ankle[2] + dz * (len + 0.5)];
      tube([a, m, e], [2.4, 2.1, 1.8], (x, y, z) => (Math.round(Math.hypot(x - a[0], z - a[2])) % 4) === 2 ? GO : ST, 'air'); tube([e, c], [1.7, 0.7], SD, 'air'); };
    toe(1, 0.05 * s, 10); toe(0.86, 0.5 * s, 9); toe(0.8, -0.6 * s, 9); toe(-1, 0.1 * s, 9);
  });

  // ============================================================== INTERIOR (enterable: gate on the plaza / the opening over the tail deck)
  const GLASS = B.glass, STAIR = B.sandstone_stairs, CHEST = B.chest;
  // a saddle joins the hood to the body, so the upper hall under the hood has a floor (y = 0) and walls down to the tail deck
  for (let x = -34; x <= -13; x++) for (let z = -15; z <= 15; z++) {
    if (Math.abs(z) > hoodW(x) - 0.4) continue;
    let yb = -99; for (let y = 0; y >= -14; y--) if (v.get(x, y, z)) { yb = y; break; }
    for (let y = (yb === -99 ? -3 : yb + 1); y <= 0; y++) if (!v.get(x, y, z)) v.set(x, y, z, y === 0 ? ((x + z) & 1 ? CA : ST) : (yb === -99 && y === -3 ? SM : ST));
    if (Math.abs(z) > hoodW(x) - 2.4) v.set(x, 0, z, GO);
  }
  for (let x = -47; x <= -34; x++) for (const s of [-1, 1]) { const W = Math.round(hoodW(x) - 0.6); for (let y = -7; y <= 1; y++) for (let k = 0; k < 2; k++) { const z = s * (W - k); if (!v.get(x, y, z)) v.set(x, y, z, y === -7 || y === 1 ? GO : ((x & 3) === 0 ? GO : CA)); } }
  for (let y = 1; y <= 7; y++) for (let z = -1; z <= 1; z++) v.set(-13, y, z, 0);                                  // the gate opens into the upper hall
  for (let x = -30; x <= -16; x += 7) for (const s of [-1, 1]) { const z = s * Math.round(hoodW(x) - 4); for (let y = 1; y <= 5; y++) v.set(x, y, z, PL); v.set(x, 6, z, GR); }   // lamp pillars
  // the main hall: a long vaulted chamber inside the body
  const hall = (x, y, z) => Math.pow((x + 6) / 25, 4) + Math.pow((y + 17) / 7.8, 4) + Math.pow(z / 9.6, 4) <= 1 && y >= -23;
  v.fill([-32, -23, -10, 20, -9, 10], hall, null, 'carve');
  for (let x = -32; x <= 20; x++) for (let z = -10; z <= 10; z++) {
    if (!hall(x, -23, z)) continue;
    const d = Math.pow((x + 7) / 18, 2) + Math.pow(z / 9, 2), win = d <= 0.74;
    if (win) { v.set(x, -24, z, GLASS); for (let y = -27; y <= -25; y++) { const c = v.get(x, y, z); if (c === SD || c === GB || c === ST || c === SM) v.set(x, y, z, 0); } }   // look down through the ribs
    else v.set(x, -24, z, d < 0.9 ? GO : ((x + z) & 1 ? CA : SM));
    // walls: an energy band and carved wainscot where the vault meets the hull
  }
  for (let x = -32; x <= 20; x++) for (let z = -10; z <= 10; z++) for (let y = -23; y <= -9; y++) { if (!hall(x, y, z)) continue;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) { const nx = x + dx, ny = y + dy, nz = z + dz; if (hall(nx, ny, nz) || !v.get(nx, ny, nz) || v.get(nx, ny, nz) === GLASS) continue;
      v.set(nx, ny, nz, dy ? (nz === 0 ? ((nx + 60) % 6 < 4 ? GB : GO) : (Math.abs(nz) === 4 ? GO : ((nx + nz) & 1 ? CA : ST))) : y === -19 ? GB : y === -18 || y === -20 ? GO : y <= -21 ? CD : y === -13 ? CA : ST); } }
  for (let x = -24; x <= 15; x += 6) for (const s of [-1, 1]) { let yc = -9; while (yc > -16 && !v.get(x, yc, s * 4)) yc--; if (hall(x, yc - 1, s * 4)) v.set(x, yc, s * 4, GR); }   // ceiling lamps either side of the energy spine
  // portholes
  for (const x of [-22, -14, -6, 2, 10]) for (const s of [-1, 1]) for (let y = -18; y <= -16; y++) { let z = s * 8; while (Math.abs(z) < 16 && !v.get(x, y, z)) z += s; let last = null; while (Math.abs(z) < 16 && v.get(x, y, z)) { v.set(x, y, z, 0); last = z; z += s; } if (last !== null) v.set(x, y, last, GLASS); }
  // the grand staircase from the upper hall down to the main hall
  for (let i = 0; i <= 23; i++) { const x = -31 + i, y = -i;
    for (let z = -2; z <= 2; z++) { for (let yy = y + 1; yy <= Math.min(i < 2 ? 4 : 0, y + 5); yy++) v.set(x, yy, z, 0); if (Math.abs(z) === 2) { v.set(x, y + 1, z, GO); v.set(x, y, z, GO); } else v.set(x, y, z, STAIR, 1); for (let yy = y - 1; yy >= Math.max(-23, y - 2); yy--) v.set(x, yy, z, Math.abs(z) === 2 ? GO : ST); } }
  // five activated terminals, the guidance stone, and the champion's chest at the prow
  const terminal = (x, z) => { v.set(x, -23, z, GO); v.set(x, -22, z, CD); v.set(x, -21, z, GB); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (v.get(x + dx, -24, z + dz) !== GLASS) v.set(x + dx, -24, z + dz, GB); };
  terminal(-18, 6); terminal(-18, -6); terminal(4, 7); terminal(4, -7); terminal(11, 0);
  for (let y = -23; y <= -20; y++) v.set(-3, y, 0, y === -20 ? GB : SD); v.set(-3, -24, 0, GO);
  { let yc = -9; while (yc > -16 && !v.get(-3, yc, 0)) yc--; for (let y = yc; y >= yc - 4; y--) v.set(-3, y, 0, y === yc - 4 ? GB : (y === yc ? GO : SD)); }   // the stone's pendant
  for (let z = -1; z <= 1; z++) v.set(16, -23, z, GO); v.set(16, -22, 0, CHEST, 4); for (let y = -23; y <= -20; y++) v.set(17, y, 0, y === -20 ? GB : GO);

  // ============================================================== life on the decks: grass tufts, ferns and a few wild flowers in the moss
  for (let z = v.z0; z <= v.z1; z++) for (let x = v.x0; x <= v.x1; x++) for (let y = 4; y >= -14; y--) { const id = v.get(x, y, z); if (id !== MO && id !== MC) continue; if (v.get(x, y + 1, z)) break;
    const r = h3(x, 11, z); if (id === MO ? r < 0.2 : r < 0.05) v.set(x, y + 1, z, r < 0.012 ? B.cornflower : r < 0.024 ? B.oxeye_daisy : r < 0.034 ? B.blue_orchid : r < 0.06 ? B.fern : B.short_grass); break; }

  return v;
}
// block-entity positions (local coordinates) the generator must attach: the champion's chest
const MEDOH_CHESTS = [[16, -22, 0]];

module.exports = { buildMedoh, h3, MEDOH_CHESTS };
