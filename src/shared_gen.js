// ===== shared_gen.js : terrain generation (pure function of seed + chunk coords) =====
let GEN = null;
function getGen(seed) {
  if (GEN && GEN.seed === (seed | 0)) return GEN;
  GEN = makeGen(seed | 0);
  return GEN;
}

function makeGen(seed) {
  const nCont = new Perlin(seed + 101), nEro = new Perlin(seed + 202), nRidge = new Perlin(seed + 303), nDet = new Perlin(seed + 404),
    nTemp = new Perlin(seed + 505), nHum = new Perlin(seed + 606), nRiver = new Perlin(seed + 707), nBio = new Perlin(seed + 808),
    nCaveA = new Perlin(seed + 909), nCaveB = new Perlin(seed + 1010), nCheese = new Perlin(seed + 1111), nEntr = new Perlin(seed + 1212),
    nSurf = new Perlin(seed + 1313), nPatch = new Perlin(seed + 1414), nMtn = new Perlin(seed + 1515);

  // block ids
  const AIR = 0, STONE = BID.stone, DIRT = BID.dirt, GRASS = BID.grass_block, GRASS_SNOWY = BID.grass_block_snowy, PODZOL = BID.podzol, SAND = BID.sand, GRAVEL = BID.gravel,
    SANDSTONE = BID.sandstone, CLAY = BID.clay, SNOWB = BID.snow_block, SNOWL = BID.snow_layer, ICE = BID.ice, WATER = BID.water, LAVA = BID.lava, BEDROCK = BID.bedrock,
    GRANITE = BID.granite, DIORITE = BID.diorite, ANDESITE = BID.andesite;
  const LOG = { oak: BID.oak_log, spruce: BID.spruce_log, birch: BID.birch_log, acacia: BID.acacia_log, jungle: BID.jungle_log, dark_oak: BID.dark_oak_log },
    LEAF = { oak: BID.oak_leaves, spruce: BID.spruce_leaves, birch: BID.birch_leaves, acacia: BID.acacia_leaves, jungle: BID.jungle_leaves, dark_oak: BID.dark_oak_leaves };
  // terracotta strata for badlands (repeats every 64 blocks; thickness 1-3)
  const BAND = new Uint8Array(64);
  (function () {
    const r = mulberry32(seed + 4242), cols = [BID.terracotta, BID.terracotta, BID.terracotta, BID.orange_terracotta, BID.orange_terracotta, BID.yellow_terracotta, BID.red_terracotta, BID.brown_terracotta, BID.white_terracotta, BID.light_gray_terracotta];
    let i = 0; while (i < 64) { const c = cols[(r() * cols.length) | 0], len = 1 + ((r() * 3) | 0); for (let k = 0; k < len && i < 64; k++) BAND[i++] = c; }
  })();

  // ---- terrain shape --------------------------------------------------------------------------
  // continentalness -> base height spline (thresholds follow MC's continentalness categories)
  const SPL_C = [-1.2, -0.6, -0.455, -0.19, -0.12, -0.085, 0.03, 0.3, 0.6, 1.2];
  const SPL_H = [28, 38, 45, 57, 62.2, 65.4, 68, 74, 84, 98];
  function spline(c) {
    if (c <= SPL_C[0]) return SPL_H[0];
    for (let i = 1; i < SPL_C.length; i++) {
      if (c <= SPL_C[i]) { const t = (c - SPL_C[i - 1]) / (SPL_C[i] - SPL_C[i - 1]); return SPL_H[i - 1] + (SPL_H[i] - SPL_H[i - 1]) * t; }
    }
    return SPL_H[SPL_H.length - 1];
  }

  const ci = { h: 64, biome: 2, cont: 0, temp: 0, hum: 0, river: 0, mtn: 0, ero: 0, det: 0 };
  function column(wx, wz) {
    const c = clamp(fbm2(nCont, wx * 0.0010, wz * 0.0010, 5) * 2.1, -1.3, 1.3);
    const ero = clamp(fbm2(nEro, wx * 0.0021 + 31.7, wz * 0.0021 - 12.3, 3) * 2.2, -1.2, 1.2);
    const ridgeRaw = 1 - Math.abs(fbm2(nRidge, wx * 0.0042 - 77.1, wz * 0.0042 + 41.9, 4) * 2.4);
    const ridge = clamp(ridgeRaw, 0, 1);
    const temp = clamp(fbm2(nTemp, wx * 0.0010 + 500.5, wz * 0.0010 - 250.2, 3) * 2.3, -1.2, 1.2);
    const hum = clamp(fbm2(nHum, wx * 0.0011 - 900.1, wz * 0.0011 + 120.4, 3) * 2.3, -1.2, 1.2);
    let h = spline(c);
    const rough = 1 - smoothstep(-0.35, 0.6, ero);
    const det = fbm2(nDet, wx * 0.011, wz * 0.011, 4);
    h += det * (1.6 + 7.5 * rough) + fbm2(nDet, wx * 0.07 + 9.1, wz * 0.07 - 3.3, 2) * (0.8 + 1.4 * rough);
    const mtn = smoothstep(0.02, 0.5, c) * smoothstep(0.25, -0.5, ero);
    h += mtn * (Math.pow(ridge, 1.5) * 75 + 6 + fbm2(nMtn, wx * 0.02, wz * 0.02, 3) * 12);
    // rivers
    let river = 0;
    if (c > -0.2) {
      const rv = Math.abs(fbm2(nRiver, wx * 0.0034 + 5.5, wz * 0.0034 - 9.9, 3) * 2.0);
      const wide = 0.05 + Math.min(0.14, Math.max(0, h - SEA) * 0.004);
      river = 1 - smoothstep(0.012, wide, rv);
      river *= 1 - 0.55 * mtn;
      if (river > 0) h = h + (Math.min(h, SEA - 2.8) - h) * river;
    }
    ci.cont = c; ci.ero = ero; ci.temp = temp; ci.hum = hum; ci.river = river; ci.mtn = mtn; ci.det = det;
    const hi = Math.floor(h);
    ci.h = hi < 2 ? 2 : hi > 250 ? 250 : hi;
    // biome
    let b;
    const hh = ci.h;
    if (c < -0.19 && !(river > 0.5 && c > -0.3)) b = c < -0.455 ? BIO.deep_ocean : (temp < -0.55 ? BIO.frozen_ocean : BIO.ocean);
    else if (river > 0.55) b = temp < -0.4 ? BIO.frozen_river : BIO.river;
    else if (hh <= SEA + 1 && hh >= SEA - 2 && c < 0.0 && mtn < 0.3) b = temp < -0.5 ? BIO.snowy_beach : BIO.beach;
    else if (mtn > 0.42 || hh > 104) b = (hh > 128 || temp < -0.3) ? BIO.snowy_peaks : BIO.windswept_hills;
    else if (temp < -0.5) b = hum > 0.0 ? BIO.snowy_taiga : BIO.snowy_plains;
    else if (temp < -0.28) b = BIO.taiga;
    else if (temp < 0.34) {
      const bv = nBio.n2(wx * 0.004, wz * 0.004);
      if (hum > 0.52 && hh <= SEA + 3) b = BIO.swamp;
      else if (hum > 0.34 && bv < -0.1) b = BIO.dark_forest;
      else if (hum > 0.22) b = bv > 0.1 && hum > 0.3 ? BIO.birch_forest : BIO.forest;
      else if (hum > 0.0 && bv > 0.12) b = BIO.forest;
      else b = BIO.plains;
    } else {
      const bv = nBio.n2(wx * 0.004 + 40.5, wz * 0.004 - 17.2);
      if (hum < 0.0) b = (bv > 0.02 && hh > SEA + 1) ? BIO.badlands : BIO.desert;
      else if (hum < 0.28) b = BIO.savanna;
      else b = BIO.jungle;
    }
    if (b === BIO.badlands) {
      // mesas: flat terraces stepped every 7 blocks with steep sides
      const pl = clamp(nBio.n2(wx * 0.011 + 8.8, wz * 0.011 + 3.1) * 1.4 + 0.45, 0, 1), step = Math.floor(pl * 3.0 + 0.5);
      const th = SEA + 2 + step * 7 + (fbm2(nDet, wx * 0.05, wz * 0.05, 2) * 1.2);
      ci.h = Math.max(SEA + 1, Math.floor(th));
    }
    ci.biome = b;
    return ci;
  }

  // 2D cave-entrance mask (sinkholes where tunnels may break the surface)
  const entrance = (wx, wz) => nEntr.n2(wx * 0.021 + 3.3, wz * 0.021 - 8.8) * 0.7 + nEntr.n2(wx * 0.06, wz * 0.06) * 0.3 > 0.55;

  // ---- per-biome surface materials -------------------------------------------------------------
  function surfaceFor(b, wx, wz, h) {
    // returns [top, filler, fillerDepth, sub]
    const p = nSurf.n2(wx * 0.06, wz * 0.06);
    if (b === BIO.desert) return [SAND, SAND, 4 + ((p > 0.2) | 0), SANDSTONE];
    if (b === BIO.beach || b === BIO.snowy_beach) return [SAND, SAND, 4, SANDSTONE];
    if (b === BIO.ocean || b === BIO.deep_ocean || b === BIO.frozen_ocean) {
      const q = nPatch.n2(wx * 0.045 + 7, wz * 0.045 - 3);
      if (b === BIO.deep_ocean) return [q > 0.25 ? CLAY : GRAVEL, GRAVEL, 3, STONE];
      if (q > 0.35) return [CLAY, CLAY, 2, STONE];
      return [q < -0.2 ? GRAVEL : SAND, q < -0.2 ? GRAVEL : SAND, 3, STONE];
    }
    if (b === BIO.river || b === BIO.frozen_river) return [nPatch.n2(wx * 0.05, wz * 0.05) > 0.3 ? CLAY : (p > 0 ? SAND : GRAVEL), SAND, 3, STONE];
    if (b === BIO.windswept_hills) {
      if (h > 100 - p * 6) return [STONE, STONE, 0, STONE];
      return [GRASS, DIRT, 3, STONE];
    }
    if (b === BIO.snowy_peaks) {
      if (h > 132 + p * 6) return [SNOWB, SNOWB, 2, STONE];
      if (h > 110) return [STONE, STONE, 0, STONE];
      return [GRASS_SNOWY, DIRT, 3, STONE];
    }
    if (b === BIO.taiga || b === BIO.snowy_taiga) {
      const q = nPatch.n2(wx * 0.05, wz * 0.05);
      if (b === BIO.snowy_taiga) return [GRASS_SNOWY, DIRT, 3, STONE];
      return [q > 0.32 ? PODZOL : GRASS, DIRT, 3, STONE];
    }
    if (b === BIO.snowy_plains) return [GRASS_SNOWY, DIRT, 3 + ((p > 0.3) | 0), STONE];
    if (b === BIO.badlands) return [nPatch.n2(wx * 0.07, wz * 0.07) > 0.05 ? BID.red_sand : BAND[h & 63], BID.red_sand, 2, STONE];
    if (b === BIO.savanna) return [nPatch.n2(wx * 0.06 + 20, wz * 0.06) > 0.5 ? BID.coarse_dirt : GRASS, DIRT, 3, STONE];
    return [GRASS, DIRT, 3 + ((p > 0.25) | 0), STONE];
  }

  // ---- ore / blob veins -------------------------------------------------------------------------
  const ORES = [
    // [block, attempts, size, minY, maxY, kind]  kind 0 = ore (uniform y), 1 = ore triangular-ish, 2 = blob
    [BID.coal_ore, 16, 13, 5, 127, 0],
    [BID.iron_ore, 14, 8, 1, 63, 0],
    [BID.gold_ore, 2, 8, 1, 32, 0],
    [BID.redstone_ore, 6, 7, 1, 16, 0],
    [BID.diamond_ore, 2, 7, 1, 16, 0],
    [BID.lapis_ore, 1, 6, 1, 30, 1],
    [DIRT, 5, 26, 5, 128, 2],
    [GRAVEL, 4, 24, 5, 100, 2],
    [GRANITE, 4, 26, 5, 90, 2],
    [DIORITE, 4, 26, 5, 90, 2],
    [ANDESITE, 4, 26, 5, 90, 2],
  ];
  function placeVein(blocks, cx, cz, id, x, y, z, size, rnd) {
    const ang = rnd() * Math.PI, sn = Math.sin(ang) * size / 8, cs = Math.cos(ang) * size / 8;
    const x1 = x + sn, x2 = x - sn, z1 = z + cs, z2 = z - cs, y1 = y + (rnd() * 3 | 0) - 2, y2 = y + (rnd() * 3 | 0) - 2;
    const X0 = cx << 4, Z0 = cz << 4;
    for (let i = 0; i <= size; i++) {
      const t = i / size;
      const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t, pz = z1 + (z2 - z1) * t;
      const r = ((Math.sin(Math.PI * t) + 1) * rnd() * size / 16 + 1) / 2;
      const xs = Math.floor(px - r), xe = Math.floor(px + r), ys = Math.floor(py - r), ye = Math.floor(py + r), zs = Math.floor(pz - r), ze = Math.floor(pz + r);
      for (let bx_ = xs; bx_ <= xe; bx_++) {
        const lx = bx_ - X0; if (lx < 0 || lx > 15) continue;
        const dx = (bx_ + 0.5 - px) / r; if (dx * dx >= 1) continue;
        for (let bz_ = zs; bz_ <= ze; bz_++) {
          const lz = bz_ - Z0; if (lz < 0 || lz > 15) continue;
          const dz = (bz_ + 0.5 - pz) / r; if (dx * dx + dz * dz >= 1) continue;
          for (let by = ys; by <= ye; by++) {
            if (by < 1 || by > 250) continue;
            const dy = (by + 0.5 - py) / r;
            if (dx * dx + dy * dy + dz * dz >= 1) continue;
            const idx = (by << 8) | (lz << 4) | lx;
            const cur = blocks[idx];
            if (cur === STONE || (id >= BID.coal_ore && id <= BID.emerald_ore && (cur === GRANITE || cur === DIORITE || cur === ANDESITE))) blocks[idx] = id;
          }
        }
      }
    }
  }

  // ---- trees ------------------------------------------------------------------------------------
  function treeAt(kind, x, y, z, rnd, put) {
    // put(wx,wy,wz,id,isLog)
    if (kind === 'oak' || kind === 'birch') {
      const th = kind === 'birch' ? 5 + (rnd() * 3 | 0) : 4 + (rnd() * 3 | 0);
      const top = y + th;
      for (let yy = top - 3; yy <= top; yy++) {
        const dy = yy - top, r = 1 - ((dy / 2) | 0);
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && (rnd() < 0.5 || dy === 0)) continue;
          put(x + dx, yy, z + dz, LEAF[kind], false);
        }
      }
      for (let yy = y; yy < top; yy++) put(x, yy, z, LOG[kind], true);
      put(x, top, z, LEAF[kind], false);
    } else if (kind === 'jungle') {
      const th = 5 + (rnd() * 7 | 0), top = y + th;
      for (let yy = top - 2; yy <= top + 1; yy++) {
        const dy = yy - top, r = dy >= 1 ? 1 : dy === 0 ? 2 : 3;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && r > 1 && rnd() < 0.5) continue;
          put(x + dx, yy, z + dz, LEAF.jungle, false);
        }
      }
      for (let yy = y; yy <= top; yy++) put(x, yy, z, LOG.jungle, true);
      for (let yy = y + 2; yy <= top; yy++) for (const [dx, dz, bit] of [[1, 0, 2], [-1, 0, 8], [0, 1, 4], [0, -1, 1]]) if (rnd() < 0.3) put(x + dx, yy, z + dz, BID.vine, false, bit);
      for (let k = 0; k < 7; k++) {   // vines hanging from the canopy edge
        const a = (rnd() * 4) | 0, off = ((rnd() * 5) | 0) - 2, yy = top - 2 + ((rnd() * 2) | 0);
        const [ox, oz, bit] = [[1, 0, 2], [-1, 0, 8], [0, 1, 4], [0, -1, 1]][a];
        const vx = x + (ox ? 4 * ox : off), vz = z + (oz ? 4 * oz : off);
        const len = 1 + ((rnd() * 4) | 0);
        for (let l = 0; l < len; l++) put(vx, yy - l, vz, BID.vine, false, bit);
      }
    } else if (kind === 'jungle_giant') {
      const th = 14 + (rnd() * 12 | 0), top = y + th;
      for (let yy = y; yy <= top; yy++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(x + dx, yy, z + dz, LOG.jungle, true);
      const cxm = x + 0.5, czm = z + 0.5, radii = [3.4, 4.8, 5.2, 4.2, 2.6];
      for (let li = 0; li < radii.length; li++) {
        const yy = top - 2 + li, rr = radii[li];
        for (let dx = -6; dx <= 7; dx++) for (let dz = -6; dz <= 7; dz++) {
          const d = Math.hypot(x + dx - cxm, z + dz - czm);
          if (d <= rr && !(d > rr - 1 && rnd() < 0.35)) put(x + dx, yy, z + dz, LEAF.jungle, false);
        }
      }
      for (let k = 0; k < 4; k++) {   // side branches with leaf clusters
        const sx = k & 1 ? 1 : -1, sz = k & 2 ? 1 : -1, by = y + Math.floor(th * (0.45 + rnd() * 0.25));
        for (let s = 1; s <= 3; s++) put(x + (sx > 0 ? 1 + s : -s), by + (s >> 1), z + (sz > 0 ? 1 + s : -s), LOG.jungle, true);
        const bx0 = x + (sx > 0 ? 5 : -4), bz0 = z + (sz > 0 ? 5 : -4);
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 2; dy++) if (dx * dx + dz * dz + dy * dy * 2 <= 6) put(bx0 + dx, by + 1 + dy, bz0 + dz, LEAF.jungle, false);
      }
      for (let yy = y + 3; yy <= top - 2; yy++) for (let k = 0; k < 4; k++) if (rnd() < 0.25) {
        const [ox, oz, bit] = [[2, 0, 2], [-1, 0, 8], [0, 2, 4], [0, -1, 1]][k], jx = x + ox + (oz ? (rnd() < 0.5 ? 0 : 1) : 0), jz = z + oz + (ox ? (rnd() < 0.5 ? 0 : 1) : 0);
        put(jx, yy, jz, BID.vine, false, bit);
      }
    } else if (kind === 'acacia') {
      const th = 5 + (rnd() * 3 | 0), dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], d = dirs[(rnd() * 4) | 0], straight = th - 2 - ((rnd() * 2) | 0);
      let px = x, pz = z, py = y, bendX = x, bendZ = z, bendY = y;
      for (let i = 0; i < th; i++) {
        put(px, py, pz, LOG.acacia, true);
        if (i === straight) { bendX = px; bendZ = pz; bendY = py; }
        if (i >= straight) { px += d[0]; pz += d[1]; }
        py++;
      }
      const ty = py - 1;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (dx * dx + dz * dz <= 9 && !(dx * dx + dz * dz > 6 && rnd() < 0.4)) put(px + dx, ty, pz + dz, LEAF.acacia, false);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx * dx + dz * dz <= 5) put(px + dx, ty + 1, pz + dz, LEAF.acacia, false);
      if (rnd() < 0.6) {   // second short branch in the opposite direction
        const d2 = [-d[0], -d[1]]; let qx = bendX, qz = bendZ, qy = bendY;
        for (let i = 0; i < 3; i++) { qx += d2[0]; qz += d2[1]; qy++; put(qx, qy, qz, LOG.acacia, true); }
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx * dx + dz * dz <= 4) put(qx + dx, qy + 1, qz + dz, LEAF.acacia, false);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(qx + dx, qy + 2, qz + dz, LEAF.acacia, false);
      }
    } else if (kind === 'dark_oak') {
      const th = 6 + (rnd() * 3 | 0), top = y + th, cxm = x + 0.5, czm = z + 0.5;
      for (let yy = y; yy <= top; yy++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(x + dx, yy, z + dz, LOG.dark_oak, true);
      for (let li = 0; li < 4; li++) {
        const yy = top - 1 + li, rr = li === 3 ? 1.6 : li === 2 ? 3.2 : 3.9;
        for (let dx = -4; dx <= 5; dx++) for (let dz = -4; dz <= 5; dz++) {
          const dd = Math.hypot(x + dx - cxm, z + dz - czm);
          if (dd <= rr && !(dd > rr - 1 && rnd() < 0.3)) put(x + dx, yy, z + dz, LEAF.dark_oak, false);
        }
      }
      for (let k = 0; k < 3; k++) { const a = rnd() * Math.PI * 2, bx1 = x + Math.round(Math.cos(a) * 2.2), bz1 = z + Math.round(Math.sin(a) * 2.2); put(bx1, top - 2, bz1, LOG.dark_oak, true); }
    } else { // spruce
      const th = 6 + (rnd() * 4 | 0), top = y + th;
      let r = rnd() < 0.5 ? 0 : 1, maxR = 2 + (rnd() * 2 | 0), cur = r;
      for (let yy = top + 1; yy >= y + 2; yy--) {
        for (let dx = -cur; dx <= cur; dx++) for (let dz = -cur; dz <= cur; dz++) {
          if (Math.abs(dx) === cur && Math.abs(dz) === cur && cur > 0) continue;
          put(x + dx, yy, z + dz, LEAF.spruce, false);
        }
        if (cur >= maxR) { cur = 1; maxR = Math.min(3, maxR + 1); } else cur++;
        if (yy === top + 1 - 1) cur = Math.max(cur, 1);
      }
      for (let yy = y; yy <= top; yy++) put(x, yy, z, LOG.spruce, true);
    }
  }

  const TREE_DENSITY = {};
  TREE_DENSITY[BIO.plains] = 0.0016; TREE_DENSITY[BIO.forest] = 0.055; TREE_DENSITY[BIO.birch_forest] = 0.05; TREE_DENSITY[BIO.taiga] = 0.05;
  TREE_DENSITY[BIO.snowy_taiga] = 0.035; TREE_DENSITY[BIO.snowy_plains] = 0.0012; TREE_DENSITY[BIO.windswept_hills] = 0.008; TREE_DENSITY[BIO.swamp] = 0.028;
  TREE_DENSITY[BIO.snowy_peaks] = 0.002; TREE_DENSITY[BIO.river] = 0.004;
  TREE_DENSITY[BIO.jungle] = 0.11; TREE_DENSITY[BIO.savanna] = 0.009; TREE_DENSITY[BIO.dark_forest] = 0.07; TREE_DENSITY[BIO.badlands] = 0.0008;

  function treeKindFor(b, rnd) {
    if (b === BIO.taiga || b === BIO.snowy_taiga || b === BIO.snowy_peaks || b === BIO.windswept_hills) return 'spruce';
    if (b === BIO.birch_forest) return rnd() < 0.85 ? 'birch' : 'oak';
    if (b === BIO.forest) return rnd() < 0.14 ? 'birch' : 'oak';
    if (b === BIO.jungle) return rnd() < 0.16 ? 'jungle_giant' : 'jungle';
    if (b === BIO.savanna) return 'acacia';
    if (b === BIO.dark_forest) return rnd() < 0.8 ? 'dark_oak' : 'oak';
    return 'oak';
  }

  // ---- chunk generation -------------------------------------------------------------------------
  const FLOWERS = [BID.dandelion, BID.poppy, BID.azure_bluet, BID.oxeye_daisy, BID.cornflower, BID.red_tulip, BID.allium, BID.blue_orchid];
  function generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOL), meta = new Uint8Array(CHUNK_VOL), biome = new Uint8Array(256);
    const hts = new Int16Array(256);
    const X0 = cx << 4, Z0 = cz << 4;
    const colTemp = new Float32Array(256);
    let maxH = 0;
    // pass 1: columns + solid fill + surface
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const wx = X0 + lx, wz = Z0 + lz, i = (lz << 4) | lx;
      column(wx, wz);
      const h = ci.h, b = ci.biome;
      hts[i] = h; biome[i] = b; colTemp[i] = ci.temp;
      if (h > maxH) maxH = h;
      const under = h < SEA - 1;
      let sf = surfaceFor(b, wx, wz, h);
      let top = sf[0], fill = sf[1], fd = sf[2], sub = sf[3];
      if (under && (b !== BIO.ocean && b !== BIO.deep_ocean && b !== BIO.frozen_ocean && b !== BIO.river && b !== BIO.frozen_river && b !== BIO.beach && b !== BIO.snowy_beach)) {
        // land biome column below sea level (lake/swamp bed)
        const q = nPatch.n2(wx * 0.06, wz * 0.06);
        top = q > 0.3 ? CLAY : (q < -0.25 ? GRAVEL : DIRT); fill = DIRT; fd = 3; sub = STONE;
      } else if (under && top === GRASS) { top = DIRT; }
      else if (under && (top === GRASS_SNOWY)) { top = DIRT; }
      const stoneTop = top === STONE;
      for (let y = 1; y <= h; y++) blocks[(y << 8) | i] = STONE;
      if (!stoneTop || fd > 0) {
        blocks[(h << 8) | i] = top;
        for (let d = 1; d <= fd && h - d >= 1; d++) blocks[((h - d) << 8) | i] = fill;
        if (sub !== STONE) for (let d = fd + 1; d <= fd + 3 && h - d >= 1; d++) blocks[((h - d) << 8) | i] = sub;
      }
      if (b === BIO.badlands && !under) {
        const y0 = Math.max(SEA - 6, 30);
        for (let y = y0; y <= h; y++) blocks[(y << 8) | i] = BAND[y & 63];
        blocks[(h << 8) | i] = top;
        if (top === BID.red_sand) for (let d = 1; d <= 2 && h - d >= y0; d++) blocks[((h - d) << 8) | i] = BID.red_sand;
      }
      // bedrock
      blocks[i] = BEDROCK;
      for (let y = 1; y < 5; y++) if (hashf(wx, y, wz, seed) < (5 - y) / 5) blocks[(y << 8) | i] = BEDROCK;
    }

    // ravines (canyons): every chunk within 8 chunks may start one winding, tall and narrow cut (2% of chunks, like vanilla). The path is simulated from a
    // per-chunk seeded RNG, so every chunk that can see it computes the same steps; only the cells inside this chunk are carved (pass 2b) and trees
    // rooted on a cut column are skipped (pass 6) so no canopy floats over a ravine
    const rvSteps = [];
    for (let sz = cz - 8; sz <= cz + 8; sz++) for (let sx = cx - 8; sx <= cx + 8; sx++) {
      const rr = mulberry32(hash3(sx, sz, 8675309, seed));
      if (rr() > 0.02) continue;
      let x = (sx << 4) + rr() * 16, z = (sz << 4) + rr() * 16, y = 20 + rr() * (rr() * 40 + 8);
      let yaw = rr() * Math.PI * 2, pitch = (rr() - 0.5) * 0.25, yawD = 0, pitchD = 0;
      const thick = (rr() * 2 + rr()) * 2, len = 70 + ((rr() * 46) | 0);
      const rs = new Float32Array(128); let f = 1;
      for (let yy = 0; yy < 128; yy++) { if (yy === 0 || rr() < 0.33) f = 1 + rr() * rr(); rs[yy] = f * f; }
      for (let s = 0; s < len; s++) {
        const rH = 1.6 + Math.sin(s * Math.PI / len) * thick, cP = Math.cos(pitch);
        x += Math.cos(yaw) * cP; z += Math.sin(yaw) * cP; y += Math.sin(pitch);
        pitch *= 0.7; pitch += pitchD * 0.05; yaw += yawD * 0.05; pitchD *= 0.8; yawD *= 0.5; pitchD += (rr() - rr()) * rr() * 2; yawD += (rr() - rr()) * rr() * 4;
        if (x > X0 - 24 - rH && x < X0 + 40 + rH && z > Z0 - 24 - rH && z < Z0 + 40 + rH) rvSteps.push({ x, y, z, rH, rs });
      }
    }
    // is the cell (wx,wy,wz) inside any ravine ellipsoid (geometry only)?
    const ravineCuts = (wx, wy, wz) => {
      if (!rvSteps.length || wy < 6 || wy > 120) return false;
      for (let k = 0; k < rvSteps.length; k++) {
        const t = rvSteps[k], dx = (wx + 0.5 - t.x) / t.rH, dz = (wz + 0.5 - t.z) / t.rH, d2 = dx * dx + dz * dz;
        if (d2 >= 1) continue;
        const dy = (wy + 0.5 - t.y) / (t.rH * 3);
        if (d2 * t.rs[wy] + dy * dy / 6 < 1) return true;
      }
      return false;
    };

    // pass 2: caves (low-res 3D noise, trilinear interpolation)
    const NY = 17; // lattice layers for y = 0..128 step 8
    if (maxH > 12) {
      const A = new Float32Array(25 * NY), Bn = new Float32Array(25 * NY), Cc = new Float32Array(25 * NY);
      for (let k = 0; k < 5; k++) for (let ii = 0; ii < 5; ii++) for (let j = 0; j < NY; j++) {
        const wx = X0 + ii * 4, wz = Z0 + k * 4, y = j * 8, o = (k * 5 + ii) * NY + j;
        A[o] = nCaveA.n3(wx * 0.021, y * 0.031, wz * 0.021);
        Bn[o] = nCaveB.n3(wx * 0.021 + 100.7, y * 0.031 + 33.3, wz * 0.021 - 71.2);
        Cc[o] = nCheese.n3(wx * 0.0105, y * 0.0155, wz * 0.0105) + nCheese.n3(wx * 0.03, y * 0.05, wz * 0.03) * 0.25;
      }
      const colA = new Float32Array(NY), colB = new Float32Array(NY), colC = new Float32Array(NY);
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const i = (lz << 4) | lx, h = hts[i];
        if (h < 8) continue;
        const ii = lx >> 2, k = lz >> 2, fx = (lx & 3) / 4, fz = (lz & 3) / 4;
        const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
        const o00 = (k * 5 + ii) * NY, o10 = (k * 5 + ii + 1) * NY, o01 = ((k + 1) * 5 + ii) * NY, o11 = ((k + 1) * 5 + ii + 1) * NY;
        for (let j = 0; j < NY; j++) {
          colA[j] = A[o00 + j] * w00 + A[o10 + j] * w10 + A[o01 + j] * w01 + A[o11 + j] * w11;
          colB[j] = Bn[o00 + j] * w00 + Bn[o10 + j] * w10 + Bn[o01 + j] * w01 + Bn[o11 + j] * w11;
          colC[j] = Cc[o00 + j] * w00 + Cc[o10 + j] * w10 + Cc[o01 + j] * w01 + Cc[o11 + j] * w11;
        }
        const wx = X0 + lx, wz = Z0 + lz;
        const uw = h < SEA - 1;                       // underwater column: keep a thick crust
        const ent = !uw && entrance(wx, wz);
        const yMax = Math.min(h + (ent ? 0 : -2), 127);
        for (let y = 5; y <= yMax; y++) {
          if (uw && y > h - 7) break;
          const j = y >> 3, f = (y & 7) / 8;
          const a = colA[j] + (colA[j + 1] - colA[j]) * f, b = colB[j] + (colB[j + 1] - colB[j]) * f;
          let carve = false;
          const ry = y > 100 ? 0.003 : 0.0062;         // thinner tunnels near the top
          if (a * a + b * b < ry) carve = true;
          else if (y < 58 && y > 8) {
            const c = colC[j] + (colC[j + 1] - colC[j]) * f;
            if (c > 0.62 + Math.max(0, y - 40) * 0.008) carve = true;
          }
          if (carve) {
            const idx = (y << 8) | i, cur = blocks[idx];
            if (cur !== BEDROCK && cur !== WATER && cur !== AIR) blocks[idx] = y <= 10 ? LAVA : AIR;
          }
        }
      }
    }

    // pass 2b: carve the ravines (never under or beside water: heights of this chunk plus a one-column border decide)
    if (rvSteps.length) {
      const padH = new Int16Array(324);
      for (let pz = 0; pz < 18; pz++) for (let px = 0; px < 18; px++) { column(X0 + px - 1, Z0 + pz - 1); padH[pz * 18 + px] = ci.h; }
      const dry = (lx, lz) => padH[(lz + 1) * 18 + lx + 1] >= SEA + 1;
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        if (!(dry(lx, lz) && dry(lx + 1, lz) && dry(lx - 1, lz) && dry(lx, lz + 1) && dry(lx, lz - 1))) continue;
        const i = (lz << 4) | lx, wx = X0 + lx, wz = Z0 + lz;
        for (let k = 0; k < rvSteps.length; k++) {
          const t = rvSteps[k], dx = (wx + 0.5 - t.x) / t.rH, dz = (wz + 0.5 - t.z) / t.rH, d2 = dx * dx + dz * dz;
          if (d2 >= 1) continue;
          const rV = t.rH * 3, ya = Math.max(6, Math.floor(t.y - rV * 2.45)), yb = Math.min(120, Math.ceil(t.y + rV * 2.45));
          for (let yy = ya; yy <= yb; yy++) {
            const dy = (yy + 0.5 - t.y) / rV;
            if (d2 * t.rs[yy] + dy * dy / 6 >= 1) continue;
            const idx = (yy << 8) | i, cur = blocks[idx];
            if (cur === BEDROCK || cur === AIR || cur === WATER || cur === LAVA) continue;
            blocks[idx] = yy <= 10 ? LAVA : AIR;
          }
        }
      }
    }

    // pass 3: veins (from the 3x3 neighbourhood so veins cross chunk borders)
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ncx = cx + dx, ncz = cz + dz;
      const rnd = mulberry32(hash3(ncx, ncz, 4242, seed));
      for (const o of ORES) {
        for (let a = 0; a < o[1]; a++) {
          const x = (ncx << 4) + (rnd() * 16 | 0), z = (ncz << 4) + (rnd() * 16 | 0);
          let y;
          if (o[5] === 1) y = o[3] + Math.floor((rnd() + rnd()) * 0.5 * (o[4] - o[3])); else y = o[3] + Math.floor(rnd() * (o[4] - o[3]));
          placeVein(blocks, cx, cz, o[0], x, y, z, o[2], rnd);
        }
      }
    }
    // emeralds in mountain biomes
    for (let a = 0; a < 6; a++) {
      const rnd = mulberry32(hash3(cx, cz, 999 + a, seed));
      const lx = rnd() * 16 | 0, lz = rnd() * 16 | 0, b = biome[(lz << 4) | lx];
      if (b !== BIO.windswept_hills && b !== BIO.snowy_peaks) continue;
      const y = 6 + (rnd() * 90 | 0), idx = (y << 8) | (lz << 4) | lx;
      if (blocks[idx] === STONE) blocks[idx] = BID.emerald_ore;
    }

    // pass 4: water, ice
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const i = (lz << 4) | lx, h = hts[i];
      if (h < SEA - 1) {
        for (let y = h + 1; y <= SEA - 1; y++) blocks[(y << 8) | i] = WATER;
        const b = biome[i];
        if (b === BIO.frozen_ocean || b === BIO.frozen_river) blocks[((SEA - 1) << 8) | i] = ICE;
      } else if (h === SEA - 1 && biome[i] === BIO.swamp) { /* shore */ }
    }

    // pass 4b: dungeons - mossy cobblestone rooms with a monster spawner and two loot chests (from the 3x3 neighbourhood so rooms cross chunk borders)
    const beList = [];
    for (let ddz = -1; ddz <= 1; ddz++) for (let ddx = -1; ddx <= 1; ddx++) {
      const dcx = cx + ddx, dcz = cz + ddz, dr = mulberry32(hash3(dcx, dcz, 90210, seed));
      if (dr() > 0.075) continue;
      const rx = 2 + ((dr() * 2) | 0), rz = 2 + ((dr() * 2) | 0);
      const px = (dcx << 4) + 5 + ((dr() * 6) | 0), pz = (dcz << 4) + 5 + ((dr() * 6) | 0);
      column(px, pz);
      const sh = ci.h; if (sh < SEA - 2) continue;
      const hiMax = Math.min(sh - 8, 48); if (hiMax < 12) continue;
      const py = 8 + ((dr() * (hiMax - 8)) | 0), kr = dr(), mob = kr < 0.5 ? 'zombie' : kr < 0.75 ? 'skeleton' : 'spider';
      const offA = ((dr() * (2 * rz + 1)) | 0) - rz, offB = ((dr() * (2 * rx + 1)) | 0) - rx, wallB = dr() < 0.5;
      const chests = [[px - rx, py, pz + offA, 5], wallB ? [px + rx, py, pz - offA, 4] : [px + offB, py, pz - rz, 3]];
      for (let xx = Math.max(px - rx - 1, X0); xx <= Math.min(px + rx + 1, X0 + 15); xx++) for (let zz = Math.max(pz - rz - 1, Z0); zz <= Math.min(pz + rz + 1, Z0 + 15); zz++) {
        for (let yy = py - 1; yy <= py + 3; yy++) {
          const idx = (yy << 8) | ((zz - Z0) << 4) | (xx - X0), cur = blocks[idx];
          const wall = xx === px - rx - 1 || xx === px + rx + 1 || zz === pz - rz - 1 || zz === pz + rz + 1 || yy === py - 1 || yy === py + 3;
          if (wall) {
            if (cur === AIR || cur === WATER || cur === LAVA || cur === BEDROCK) continue;
            blocks[idx] = (yy === py - 1 && hashf(xx, yy, zz, seed + 77) >= 0.25) ? BID.mossy_cobblestone : BID.cobblestone; meta[idx] = 0;
          } else { blocks[idx] = AIR; meta[idx] = 0; }
        }
      }
      if (px >= X0 && px < X0 + 16 && pz >= Z0 && pz < Z0 + 16) { blocks[(py << 8) | ((pz - Z0) << 4) | (px - X0)] = BID.spawner; meta[(py << 8) | ((pz - Z0) << 4) | (px - X0)] = 0; beList.push({ x: px, y: py, z: pz, type: 'spawner', mob }); }
      for (const [cxp, cyp, czp, fm] of chests) {
        if (cxp < X0 || cxp >= X0 + 16 || czp < Z0 || czp >= Z0 + 16) continue;
        const idx = (cyp << 8) | ((czp - Z0) << 4) | (cxp - X0);
        blocks[idx] = BID.chest; meta[idx] = fm;
        beList.push({ x: cxp, y: cyp, z: czp, type: 'chest', loot: (hash3(cxp, cyp, czp, seed + 5) >>> 0) });
      }
    }

    // pass 5: vegetation on the surface (own columns only)
    const put = (wx, wy, wz, id, isLog, pm) => {
      const lx = wx - X0, lz = wz - Z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 1 || wy > 254) return;
      const idx = (wy << 8) | (lz << 4) | lx, cur = blocks[idx];
      if (isLog) { if (cur === AIR || T_REPL[cur] || BLOCKS[cur].leaves || cur === BID.snow_layer) { blocks[idx] = id; meta[idx] = pm | 0; } }
      else if (cur === AIR || (T_REPL[cur] && !T_FLUID[cur]) || cur === BID.snow_layer) { blocks[idx] = id; meta[idx] = pm | 0; }
    };
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const i = (lz << 4) | lx, h = hts[i], wx = X0 + lx, wz = Z0 + lz, b = biome[i];
      if (h < SEA - 1 || h > 240) {
        // underwater: lily pads in swamp
        if (b === BIO.swamp && h < SEA - 1 && h > SEA - 6 && hashf(wx, 5, wz, seed) < 0.06) {
          const y = SEA; if (blocks[(y << 8) | i] === AIR && blocks[((y - 1) << 8) | i] === WATER) blocks[(y << 8) | i] = BID.lily_pad;
        }
        continue;
      }
      const idx1 = ((h + 1) << 8) | i, topId = blocks[(h << 8) | i];
      if (blocks[idx1] !== AIR) continue;
      const r = hashf(wx, 11, wz, seed), r2 = hashf(wx, 12, wz, seed);
      let plantId = 0;
      if (topId === GRASS || topId === PODZOL || topId === GRASS_SNOWY) {
        if (b === BIO.plains) {
          if (r < 0.2) plantId = BID.short_grass;
          else if (r < 0.215) plantId = FLOWERS[(r2 * 5.99) | 0];
          else if (r < 0.2158 ) plantId = BID.pumpkin;
        } else if (b === BIO.forest || b === BIO.birch_forest) {
          if (r < 0.13) plantId = BID.short_grass; else if (r < 0.155) plantId = BID.fern; else if (r < 0.163) plantId = FLOWERS[(r2 * 3.99) | 0];
          else if (r < 0.1655) plantId = r2 < 0.5 ? BID.brown_mushroom : BID.red_mushroom;
        } else if (b === BIO.taiga) {
          if (r < 0.06) plantId = BID.short_grass; else if (r < 0.19) plantId = BID.fern; else if (r < 0.1925) plantId = r2 < 0.5 ? BID.brown_mushroom : BID.red_mushroom;
        } else if (b === BIO.swamp) {
          if (r < 0.15) plantId = BID.short_grass; else if (r < 0.165) plantId = BID.blue_orchid;
        } else if (b === BIO.windswept_hills) {
          if (r < 0.05) plantId = BID.short_grass;
        } else if (b === BIO.savanna) {
          if (r < 0.3) plantId = BID.short_grass;
        } else if (b === BIO.jungle) {
          if (r < 0.33) plantId = BID.short_grass; else if (r < 0.5) plantId = BID.fern; else if (r < 0.503) plantId = BID.melon; else if (r < 0.512) plantId = FLOWERS[(r2 * 5.99) | 0];
        } else if (b === BIO.dark_forest) {
          if (r < 0.08) plantId = BID.short_grass; else if (r < 0.11) plantId = BID.fern; else if (r < 0.125) plantId = r2 < 0.5 ? BID.brown_mushroom : BID.red_mushroom;
        } else if (b === BIO.snowy_plains || b === BIO.snowy_taiga) {
          // snow layer on top handled below
        }
        if (plantId && topId !== GRASS_SNOWY) blocks[idx1] = plantId;
        if (topId === GRASS_SNOWY) { blocks[idx1] = SNOWL; meta[idx1] = 0; }
      } else if (b === BIO.badlands && (topId === BID.red_sand || topId === BID.terracotta || BLOCKS[topId].name.endsWith('_terracotta'))) {
        if (r < 0.013) blocks[idx1] = BID.dead_bush;
        else if (r < 0.017 && topId === BID.red_sand) { const ch = 1 + ((r2 * 3) | 0); for (let k = 0; k < ch; k++) blocks[((h + 1 + k) << 8) | i] = BID.cactus; }
      } else if (topId === SAND && b === BIO.desert) {
        if (r < 0.0045) { const ch = 1 + ((r2 * 3) | 0); let ok = true; for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = lx + ax, nz = lz + az; if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && blocks[((h + 1) << 8) | (nz << 4) | nx] !== AIR) ok = false; }
          if (ok) for (let k = 0; k < ch; k++) blocks[((h + 1 + k) << 8) | i] = BID.cactus; }
        else if (r < 0.011) blocks[idx1] = BID.dead_bush;
      }
      if (topId === SNOWB || (topId === STONE && b === BIO.snowy_peaks && h > 118)) { blocks[idx1] = SNOWL; meta[idx1] = (h > 150) ? 2 : 0; }
      // sugar cane next to water
      if ((topId === SAND || topId === GRASS || topId === DIRT) && (h === SEA - 1 || h === SEA) && r < 0.11 && blocks[idx1] === AIR && (b === BIO.beach || b === BIO.river || b === BIO.plains || b === BIO.swamp || b === BIO.forest)) {
        let water = false;
        for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = lx + ax, nz = lz + az;
          if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) { if (blocks[((h) << 8) | (nz << 4) | nx] === WATER) water = true; }
          else { column(wx + ax, wz + az); if (ci.h < SEA - 1 && h <= SEA - 1) water = true; } }
        if (water) { const ch = 1 + ((r2 * 3) | 0); for (let k = 0; k < ch; k++) blocks[((h + 1 + k) << 8) | i] = BID.sugar_cane; }
      }
    }

    // pass 6: trees from the 3x3 neighbourhood (canopies cross chunk borders)
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ncx = cx + dx, ncz = cz + dz;
      const rnd = mulberry32(hash3(ncx, ncz, 777, seed));
      const attempts = 14;
      for (let a = 0; a < attempts; a++) {
        const lx = rnd() * 16 | 0, lz = rnd() * 16 | 0, pr = rnd(), pk = rnd();
        const wx = (ncx << 4) + lx, wz = (ncz << 4) + lz;
        // cheap pre-filter: only evaluate the column when the tree may be near this chunk
        if (wx < X0 - 4 || wx > X0 + 19 || wz < Z0 - 4 || wz > Z0 + 19) continue;
        column(wx, wz);
        const b = ci.biome, dens = TREE_DENSITY[b];
        if (!dens) continue;
        if (pr > dens * 256 / attempts) continue;
        const h = ci.h;
        if (h < SEA || h > 200 || entrance(wx, wz) || ravineCuts(wx, h, wz)) continue;
        if (villageZoneAt(seed, wx, wz)) continue;   // villages keep their ground clear (note: clobbers ci; b/h are already read)
        { const g0 = surfaceFor(b, wx, wz, h)[0]; if (g0 !== GRASS && g0 !== DIRT && g0 !== PODZOL && g0 !== GRASS_SNOWY) continue; }
        const kind = treeKindFor(b, () => pk);
        // exact ground block check for our own columns
        const ilx = wx - X0, ilz = wz - Z0;
        if (ilx >= 0 && ilx < 16 && ilz >= 0 && ilz < 16) {
          const gb = blocks[(h << 8) | (ilz << 4) | ilx];
          if (gb !== GRASS && gb !== DIRT && gb !== PODZOL && gb !== GRASS_SNOWY) continue;
          const ai = ((h + 1) << 8) | (ilz << 4) | ilx, ab = blocks[ai];
          if (ab !== AIR && !T_REPL[ab] && ab !== SNOWL) { if (BLOCKS[ab].model === M_CROSS || ab === BID.pumpkin || ab === BID.melon) blocks[ai] = AIR; else continue; }   // trees replace plants
        }
        const trnd = mulberry32(hash3(wx, wz, 31337, seed));
        treeAt(kind, wx, h + 1, wz, trnd, put);
        // dirt under the trunk in our chunk
        if (ilx >= 0 && ilx < 16 && ilz >= 0 && ilz < 16) { const gi = (h << 8) | (ilz << 4) | ilx; if (blocks[gi] === GRASS || blocks[gi] === GRASS_SNOWY) blocks[gi] = DIRT; }
        // snow on top of leaves in cold biomes is skipped for simplicity
      }
    }

    // passive mob spawn points (used once by the game when the chunk is first created)
    const spawns = [];
    const srnd = mulberry32(hash3(cx, cz, 555, seed));
    const cb = biome[(8 << 4) | 8];
    const wolfPack = (cb === BIO.taiga || cb === BIO.snowy_taiga) && srnd() < 0.3;   // taigas are wolf country
    if (wolfPack || (srnd() < 0.25 && (cb === BIO.plains || cb === BIO.forest || cb === BIO.birch_forest || cb === BIO.taiga || cb === BIO.snowy_plains || cb === BIO.swamp || cb === BIO.windswept_hills || cb === BIO.savanna || cb === BIO.jungle || cb === BIO.dark_forest))) {
      const kinds = cb === BIO.snowy_plains ? ['sheep', 'cow', 'pig'] : cb === BIO.jungle ? ['chicken'] : ['pig', 'cow', 'sheep', 'chicken'];
      const kind = wolfPack ? 'wolf' : kinds[(srnd() * kinds.length) | 0], n = 2 + (srnd() * 3 | 0);
      const bx0 = 2 + (srnd() * 12 | 0), bz0 = 2 + (srnd() * 12 | 0);
      for (let k = 0; k < n; k++) {
        const lx = clamp(bx0 + ((srnd() * 5 - 2) | 0), 0, 15), lz = clamp(bz0 + ((srnd() * 5 - 2) | 0), 0, 15), i = (lz << 4) | lx, h = hts[i];
        const g = blocks[(h << 8) | i];
        if (h >= SEA && (g === GRASS || g === GRASS_SNOWY || g === PODZOL || g === DIRT)) spawns.push([kind, X0 + lx + 0.5, h + 1, Z0 + lz + 0.5]);
      }
    }
    // pass 7: structures (villages, strongholds)
    applyOverworldStructures(seed, cx, cz, blocks, meta, beList, spawns);
    return { blocks, meta, biome, spawns, be: beList };
  }

  // spiral search for a nice spawn position near (0,0)
  function findSpawn() {
    let best = null;
    for (let r = 0; r < 200; r += 4) {
      for (let a = 0; a < (r === 0 ? 1 : 8 + r / 2); a++) {
        const ang = (a / (r === 0 ? 1 : 8 + r / 2)) * Math.PI * 2, x = Math.round(Math.cos(ang) * r * 3), z = Math.round(Math.sin(ang) * r * 3);
        column(x, z);
        const b = ci.biome, h = ci.h;
        if (h < SEA + 1 || h > 85) continue;
        if (b === BIO.ocean || b === BIO.deep_ocean || b === BIO.river || b === BIO.frozen_ocean || b === BIO.frozen_river || b === BIO.desert || b === BIO.snowy_peaks || b === BIO.beach) continue;
        if (entrance(x, z)) continue;
        return { x: x + 0.5, y: h + 1, z: z + 0.5 };
      }
    }
    column(0, 0);
    return { x: 0.5, y: Math.max(SEA + 2, ci.h + 1), z: 0.5 };
  }

  return { seed, column, generateChunk, findSpawn, ci, entrance, treeAt };
}
