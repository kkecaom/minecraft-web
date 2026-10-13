// ===== shared_dims.js : terrain of the Nether and the End (pure functions of seed + chunk coords) =====
// Nether: 128-high cavern world (bedrock floor and roof), lava sea at y <= 31, five 1.16 biomes chosen by two noises.
// End: the main island (radius ~100) with obsidian spikes and the exit podium, outer islands beyond 1024 blocks.
let NGEN = null, EGEN = null;
function getNetherGen(seed) { seed |= 0; if (!NGEN || NGEN.seed !== seed) NGEN = makeNetherGen(seed); return NGEN; }
function getEndGen(seed) { seed |= 0; if (!EGEN || EGEN.seed !== seed) EGEN = makeEndGen(seed); return EGEN; }
const NETHER_LAVA_Y = 31;

// shared vein placer: like the overworld ore veins but replacing one target block (netherrack / end stone)
function placeVeinIn(blocks, cx, cz, id, x, y, z, size, rnd, target) {
  const ang = rnd() * Math.PI, sn = Math.sin(ang) * size / 8, cs = Math.cos(ang) * size / 8;
  const x1 = x + sn, x2 = x - sn, z1 = z + cs, z2 = z - cs, y1 = y + (rnd() * 3 | 0) - 2, y2 = y + (rnd() * 3 | 0) - 2;
  const X0 = cx << 4, Z0 = cz << 4;
  for (let i = 0; i <= size; i++) {
    const t = i / size, px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t, pz = z1 + (z2 - z1) * t;
    const r = ((Math.sin(Math.PI * t) + 1) * rnd() * size / 16 + 1) / 2;
    for (let bx_ = Math.floor(px - r); bx_ <= Math.floor(px + r); bx_++) {
      const lx = bx_ - X0; if (lx < 0 || lx > 15) continue;
      const dx = (bx_ + 0.5 - px) / r; if (dx * dx >= 1) continue;
      for (let bz_ = Math.floor(pz - r); bz_ <= Math.floor(pz + r); bz_++) {
        const lz = bz_ - Z0; if (lz < 0 || lz > 15) continue;
        const dz = (bz_ + 0.5 - pz) / r; if (dx * dx + dz * dz >= 1) continue;
        for (let by = Math.floor(py - r); by <= Math.floor(py + r); by++) {
          if (by < 1 || by > 126) continue;
          const dy = (by + 0.5 - py) / r; if (dx * dx + dy * dy + dz * dz >= 1) continue;
          const idx = (by << 8) | (lz << 4) | lx;
          if (blocks[idx] === target) blocks[idx] = id;
        }
      }
    }
  }
}

// ======================================================================================= the Nether
function makeNetherGen(seed) {
  const nA = new Perlin(seed + 3101), nB = new Perlin(seed + 3202), nT = new Perlin(seed + 3404), nH = new Perlin(seed + 3505), nS = new Perlin(seed + 3606);
  const AIR = 0, RACK = BID.netherrack, LAVA = BID.lava, BEDROCK = BID.bedrock, SOUL_SAND = BID.soul_sand, SOUL_SOIL = BID.soul_soil, GRAVEL = BID.gravel,
    GLOW = BID.glowstone, BASALT = BID.basalt, BLACKSTONE = BID.blackstone, MAGMA = BID.magma_block, CNYL = BID.crimson_nylium, WNYL = BID.warped_nylium;
  const LY = NETHER_LAVA_Y;
  // biome: nearest of five (temperature, humidity) points, like 1.16's multi-noise nether
  const BPTS = [[BIO.nether_wastes, 0, 0], [BIO.soul_sand_valley, 0, -0.5], [BIO.crimson_forest, 0.4, 0], [BIO.warped_forest, 0, 0.5], [BIO.basalt_deltas, -0.5, 0]];
  function biomeAt(x, z) {
    const t = fbm2(nT, x * 0.0045, z * 0.0045, 3) * 2.0 + nT.n2(x * 0.03, z * 0.03) * 0.04, h = fbm2(nH, x * 0.0045 + 31.3, z * 0.0045 - 17.7, 3) * 2.0;
    let best = BPTS[0][0], bd = 1e9;
    for (let i = 0; i < 5; i++) { const p = BPTS[i], d = (t - p[1]) * (t - p[1]) + (h - p[2]) * (h - p[2]) - (i === 0 ? 0.015 : 0); if (d < bd) { bd = d; best = p[0]; } }
    return best;
  }
  // density at a lattice point (x multiple of 4, y multiple of 8, z multiple of 4); > 0 = netherrack
  function latticeDensity(x, y, z) {
    let n = fbm3(nA, x * 0.0125, y * 0.0215, z * 0.0125, 3) * 1.25 + nB.n3(x * 0.047, y * 0.072, z * 0.047) * 0.24;
    if (y < 34) n += (34 - y) / 34 * 0.85;                  // the floor thickens toward the lava sea
    if (y > 100) n += Math.pow((y - 100) / 26, 1.6) * 1.7;  // and toward the roof
    return n - 0.17;
  }
  // full density column at any (x,z), same lattice + interpolation as the chunk generator (used for features rooted in neighbouring chunks)
  const latCache = new Map();
  function latCol(lx4, lz4) {   // lattice column at x = lx4*4, z = lz4*4
    const key = lx4 * 100003 + lz4;
    let a = latCache.get(key);
    if (!a) { a = new Float32Array(17); for (let j = 0; j < 17; j++) a[j] = latticeDensity(lx4 * 4, j * 8, lz4 * 4); latCache.set(key, a); if (latCache.size > 4096) latCache.clear(); }
    return a;
  }
  function densityAt(x, y, z) {
    const gx = Math.floor(x / 4), gz = Math.floor(z / 4), fx = (x - gx * 4) / 4, fz = (z - gz * 4) / 4, j = y >> 3, fy = (y & 7) / 8;
    const c00 = latCol(gx, gz), c10 = latCol(gx + 1, gz), c01 = latCol(gx, gz + 1), c11 = latCol(gx + 1, gz + 1);
    const lo = (c00[j] * (1 - fx) + c10[j] * fx) * (1 - fz) + (c01[j] * (1 - fx) + c11[j] * fx) * fz;
    const hi = (c00[j + 1] * (1 - fx) + c10[j + 1] * fx) * (1 - fz) + (c01[j + 1] * (1 - fx) + c11[j + 1] * fx) * fz;
    return lo + (hi - lo) * fy;
  }
  // is the cell netherrack in the raw terrain (before surfaces / features)? matches the chunk generator
  function solidAt(x, y, z) { if (y <= 0 || y >= 127) return true; return densityAt(x, y, z) > 0; }
  // first floor (solid with air above) at or below y0, above the lava sea; -1 if none
  function floorBelow(x, y0, z) {
    let prevAir = !solidAt(x, y0 + 1, z);
    for (let y = y0; y > LY; y--) { const s = solidAt(x, y, z); if (s && prevAir) return y; prevAir = !s; }
    return -1;
  }

  // ---- huge fungi (HugeFungusFeature, simplified): stem 4-13 tall, wart-block hat with shroomlights, weeping vines under crimson hats
  function hugeFungus(kind, x, y, z, rnd, put) {
    const stem = kind === 'crimson' ? BID.crimson_stem : BID.warped_stem, wart = kind === 'crimson' ? BID.nether_wart_block : BID.warped_wart_block;
    const h = 4 + (rnd() * 10 | 0), hatH = Math.min(h, 3 + (rnd() * 3 | 0)), top = y + h;
    for (let yy = y; yy < top; yy++) put(x, yy, z, stem, 0, true);
    for (let dy = 0; dy <= hatH; dy++) {
      const yy = top - hatH + dy, r = dy === hatH ? 1 : dy >= hatH - 1 ? 2 : 3;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const edge = Math.abs(dx) === r || Math.abs(dz) === r, corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (r > 1 || rnd() < 0.5)) continue;
        if (!edge && dy < hatH - 1 && !(dx === 0 && dz === 0) && rnd() < 0.6) continue;    // mostly hollow inside
        if (edge && rnd() < 0.08) continue;
        if (dx === 0 && dz === 0 && dy < hatH) { put(x, yy, z, stem, 0, true); continue; }
        put(x + dx, yy, z + dz, rnd() < (edge ? 0.04 : 0.1) ? BID.shroomlight : wart, 0, false);
        if (kind === 'crimson' && edge && dy === 0 && rnd() < 0.3) { const len = 1 + (rnd() * 4 | 0); for (let k = 1; k <= len; k++) put(x + dx, yy - k, z + dz, BID.weeping_vines, 0, false); }
      }
    }
  }

  function generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOL), meta = new Uint8Array(CHUNK_VOL), biome = new Uint8Array(256);
    const X0 = cx << 4, Z0 = cz << 4, NYL = 17;
    const L = new Float32Array(25 * NYL);
    for (let k = 0; k < 5; k++) for (let i = 0; i < 5; i++) { const c = latCol((X0 >> 2) + i, (Z0 >> 2) + k); for (let j = 0; j < NYL; j++) L[(k * 5 + i) * NYL + j] = c[j]; }
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) biome[(lz << 4) | lx] = biomeAt(X0 + lx, Z0 + lz);
    // pass 1: density -> netherrack / lava sea / bedrock
    const col = new Float32Array(NYL);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const ii = lx >> 2, kk = lz >> 2, fx = (lx & 3) / 4, fz = (lz & 3) / 4, wx = X0 + lx, wz = Z0 + lz, i = (lz << 4) | lx;
      const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
      const o00 = (kk * 5 + ii) * NYL, o10 = (kk * 5 + ii + 1) * NYL, o01 = ((kk + 1) * 5 + ii) * NYL, o11 = ((kk + 1) * 5 + ii + 1) * NYL;
      for (let j = 0; j < NYL; j++) col[j] = L[o00 + j] * w00 + L[o10 + j] * w10 + L[o01 + j] * w01 + L[o11 + j] * w11;
      for (let y = 0; y < 128; y++) {
        const idx = (y << 8) | i;
        if (y === 0 || y === 127 || (y < 5 && hashf(wx, y, wz, seed) < (5 - y) / 5) || (y > 122 && hashf(wx, y, wz, seed + 1) < (y - 122) / 5)) { blocks[idx] = BEDROCK; continue; }
        const j = y >> 3, f = (y & 7) / 8, d = col[j] + (col[j + 1] - col[j]) * f;
        blocks[idx] = d > 0 ? RACK : y <= LY ? LAVA : AIR;
      }
    }
    // pass 2: biome surfaces (floors = solid with air above, ceilings = solid with air below)
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const i = (lz << 4) | lx, b = biome[i], wx = X0 + lx, wz = Z0 + lz;
      const pn = nS.n2(wx * 0.07, wz * 0.07), pn2 = nS.n2(wx * 0.19 + 50, wz * 0.19);
      let depth = 0;   // how far below the last air cell we are
      for (let y = 126; y > 0; y--) {
        const idx = (y << 8) | i, id = blocks[idx], above = blocks[idx + 256];
        if (id !== RACK) { depth = 0; continue; }
        if (above === AIR) depth = 1; else if (depth > 0) depth++;
        if (b === BIO.nether_wastes) {
          // gravel and soul sand beaches around the lava sea
          if (depth >= 1 && depth <= 3 && y >= LY - 2 && y <= LY + 4) { if (pn > 0.25) blocks[idx] = SOUL_SAND; else if (pn < -0.3) blocks[idx] = GRAVEL; }
        } else if (b === BIO.crimson_forest || b === BIO.warped_forest) {
          if (depth === 1 && y > LY) blocks[idx] = b === BIO.crimson_forest ? CNYL : WNYL;
        } else if (b === BIO.soul_sand_valley) {
          if (depth >= 1 && depth <= 3) blocks[idx] = pn2 > 0.1 ? SOUL_SAND : SOUL_SOIL;
          else if (blocks[idx - 256] === AIR && pn > 0.2) blocks[idx] = SOUL_SOIL;          // soul soil streaks on the cavern walls
        } else if (b === BIO.basalt_deltas) {
          if (depth >= 1 && depth <= 4) blocks[idx] = pn2 > -0.1 ? BASALT : BLACKSTONE;
          else if (blocks[idx - 256] === AIR || blocks[idx - 256] === LAVA) blocks[idx] = pn > 0 ? BASALT : BLACKSTONE;
        }
      }
    }
    const rnd = mulberry32(hash3(cx, cz, 1347, seed));
    const at = (lx, y, lz) => blocks[(y << 8) | (lz << 4) | lx];
    const set = (lx, y, lz, id, m) => { const idx = (y << 8) | (lz << 4) | lx; blocks[idx] = id; meta[idx] = m | 0; };
    // pass 3: ores from the 3x3 neighbourhood (quartz everywhere, nether gold ore, magma around the lava sea)
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const vr = mulberry32(hash3(cx + dx, cz + dz, 4243, seed)), bx = (cx + dx) << 4, bz = (cz + dz) << 4;
      for (let a = 0; a < 16; a++) placeVeinIn(blocks, cx, cz, BID.nether_quartz_ore, bx + (vr() * 16 | 0), 10 + (vr() * 108 | 0), bz + (vr() * 16 | 0), 14, vr, RACK);
      for (let a = 0; a < 10; a++) placeVeinIn(blocks, cx, cz, BID.nether_gold_ore, bx + (vr() * 16 | 0), 10 + (vr() * 108 | 0), bz + (vr() * 16 | 0), 10, vr, RACK);
      for (let a = 0; a < 4; a++) placeVeinIn(blocks, cx, cz, MAGMA, bx + (vr() * 16 | 0), 27 + (vr() * 10 | 0), bz + (vr() * 16 | 0), 30, vr, RACK);
      for (let a = 0; a < 2; a++) placeVeinIn(blocks, cx, cz, GRAVEL, bx + (vr() * 16 | 0), 5 + (vr() * 36 | 0), bz + (vr() * 16 | 0), 30, vr, RACK);
    }
    // pass 4: glowstone clusters hanging from ceilings (kept inside the chunk)
    for (let a = 0; a < 14; a++) {
      const lx = 4 + (rnd() * 8 | 0), lz = 4 + (rnd() * 8 | 0), y0 = 40 + (rnd() * 82 | 0);
      let y = y0; while (y < 123 && at(lx, y, lz) === AIR) y++;
      if (y >= 123 || y === y0 || at(lx, y, lz) !== RACK || at(lx, y - 1, lz) !== AIR) continue;
      set(lx, y - 1, lz, GLOW);
      for (let k = 0; k < 420; k++) {
        const px = lx + (rnd() * 7 | 0) - 3, py = y - 1 - (rnd() * 8 | 0), pz = lz + (rnd() * 7 | 0) - 3;
        if (px < 0 || px > 15 || pz < 0 || pz > 15 || py < 2 || at(px, py, pz) !== AIR) continue;
        let n = 0;
        if (at(px, py + 1, pz) === GLOW) n++; if (py > 0 && at(px, py - 1, pz) === GLOW) n++;
        if (px > 0 && at(px - 1, py, pz) === GLOW) n++; if (px < 15 && at(px + 1, py, pz) === GLOW) n++;
        if (pz > 0 && at(px, py, pz - 1) === GLOW) n++; if (pz < 15 && at(px, py, pz + 1) === GLOW) n++;
        if (n === 1) set(px, py, pz, GLOW);
      }
    }
    // pass 5: lava falls from wall springs (pre-flowed down to the floor, inside the chunk)
    for (let a = 0; a < 7; a++) {
      const lx = 1 + (rnd() * 14 | 0), lz = 1 + (rnd() * 14 | 0), y = 34 + (rnd() * 80 | 0);
      if (at(lx, y, lz) !== RACK || at(lx, y + 1, lz) !== RACK || at(lx, y - 1, lz) !== RACK) continue;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], dd = dirs[(rnd() * 4) | 0], ox = lx + dd[0], oz = lz + dd[1];
      if (at(ox, y, oz) !== AIR) continue;
      set(lx, y, lz, LAVA, 0);
      let yy = y; set(ox, yy, oz, LAVA, 1);
      while (yy > 1 && at(ox, yy - 1, oz) === AIR && y - yy < 60) { yy--; set(ox, yy, oz, LAVA, 8); }
    }
    // pass 6: biome decoration on floors / ceilings
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const i = (lz << 4) | lx, b = biome[i], wx = X0 + lx, wz = Z0 + lz;
      for (let y = 121; y > LY; y--) {
        const id = at(lx, y, lz), above = at(lx, y + 1, lz), below = at(lx, y - 1, lz);
        const r = hashf(wx, y, wz, seed + 77);
        if (above === AIR && id !== AIR && id !== LAVA && T_SOLID[id]) {     // floor
          if (b === BIO.crimson_forest && id === CNYL) { if (r < 0.2) set(lx, y + 1, lz, BID.crimson_roots); else if (r < 0.23) set(lx, y + 1, lz, BID.crimson_fungus); else if (r < 0.235) set(lx, y + 1, lz, BID.warped_fungus); }
          else if (b === BIO.warped_forest && id === WNYL) {
            if (r < 0.18) set(lx, y + 1, lz, BID.warped_roots); else if (r < 0.21) set(lx, y + 1, lz, BID.warped_fungus); else if (r < 0.215) set(lx, y + 1, lz, BID.crimson_fungus);
            else if (r < 0.26) { const len = 1 + (hashf(wx, y, wz, seed + 78) * 7 | 0); for (let k = 1; k <= len && y + k < 122 && at(lx, y + k, lz) === AIR; k++) set(lx, y + k, lz, BID.twisting_vines); }
          } else if (b === BIO.nether_wastes && id === RACK) {
            if (r < 0.004) set(lx, y + 1, lz, BID.fire, 0); else if (r < 0.006) set(lx, y + 1, lz, r < 0.005 ? BID.brown_mushroom : BID.red_mushroom);
          } else if (b === BIO.soul_sand_valley && (id === SOUL_SOIL || id === SOUL_SAND)) {
            if (r < 0.006 && id === SOUL_SOIL) set(lx, y + 1, lz, BID.soul_fire, 0);
          } else if (b === BIO.basalt_deltas) {
            if (r < 0.03) { const hh = 1 + (hashf(wx, y, wz, seed + 79) * 4 | 0); for (let k = 1; k <= hh && at(lx, y + k, lz) === AIR; k++) set(lx, y + k, lz, BASALT); }
          }
        } else if (below === AIR && T_SOLID[id] && id !== GLOW) {            // ceiling
          if (b === BIO.crimson_forest && r < 0.06) { const len = 1 + (hashf(wx, y, wz, seed + 80) * 8 | 0); for (let k = 1; k <= len && at(lx, y - k, lz) === AIR; k++) set(lx, y - k, lz, BID.weeping_vines); }
          else if (b === BIO.basalt_deltas && r < 0.03) { const hh = 1 + (hashf(wx, y, wz, seed + 81) * 4 | 0); for (let k = 1; k <= hh && at(lx, y - k, lz) === AIR; k++) set(lx, y - k, lz, BASALT); }
        }
      }
    }
    // basalt deltas: shallow lava pools rimmed with magma on the floors
    for (let a = 0; a < 6; a++) {
      const lx = 1 + (rnd() * 14 | 0), lz = 1 + (rnd() * 14 | 0); if (biome[(lz << 4) | lx] !== BIO.basalt_deltas) continue;
      let y = 40 + (rnd() * 70 | 0); while (y > LY && at(lx, y, lz) === AIR) y--;
      if (y <= LY + 1 || at(lx, y + 1, lz) !== AIR) continue;
      const rr = 1 + (rnd() * 2 | 0);
      for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
        const px = lx + dx, pz = lz + dz; if (px < 0 || px > 15 || pz < 0 || pz > 15) continue;
        if (!T_SOLID[at(px, y, pz)] || at(px, y + 1, pz) !== AIR) continue;
        const edge = Math.abs(dx) === rr || Math.abs(dz) === rr;
        set(px, y, pz, edge ? MAGMA : LAVA, 0);
        if (!edge && T_SOLID[at(px, y - 1, pz)] === 0) set(px, y - 1, pz, BASALT);
      }
    }
    // soul sand valley: tall basalt pillars
    if (rnd() < 0.18) {
      const lx = 2 + (rnd() * 12 | 0), lz = 2 + (rnd() * 12 | 0);
      if (biome[(lz << 4) | lx] === BIO.soul_sand_valley) {
        let y = 34; while (y < 120 && at(lx, y, lz) !== AIR) y++;
        while (y < 122 && at(lx, y, lz) === AIR) { set(lx, y, lz, BASALT); if (rnd() < 0.3 && lx > 0) set(lx - 1, y, lz, BASALT); y++; }
      }
    }
    // pass 7: huge fungi rooted in this chunk or its neighbours (hats cross chunk borders)
    const put = (wx, wy, wz, id, m, isStem) => {
      const lx = wx - X0, lz = wz - Z0; if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 1 || wy > 122) return;
      const idx = (wy << 8) | (lz << 4) | lx, cur = blocks[idx];
      if (cur === AIR || cur === BID.crimson_roots || cur === BID.warped_roots || cur === BID.weeping_vines || cur === BID.twisting_vines || (isStem && (BLOCKS[cur].wartBlock || cur === BID.shroomlight))) { blocks[idx] = id; meta[idx] = m | 0; }
    };
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const fr = mulberry32(hash3(cx + dx, cz + dz, 9091, seed));
      for (let a = 0; a < 8; a++) {
        const wx = ((cx + dx) << 4) + (fr() * 16 | 0), wz = ((cz + dz) << 4) + (fr() * 16 | 0), y0 = LY + 2 + (fr() * 80 | 0), pr = fr();
        if (wx < X0 - 4 || wx > X0 + 19 || wz < Z0 - 4 || wz > Z0 + 19) continue;
        const b = biomeAt(wx, wz);
        if (b !== BIO.crimson_forest && b !== BIO.warped_forest) continue;
        if (pr > 0.6) continue;
        const fy = floorBelow(wx, y0, wz); if (fy < 0) continue;
        // room for the stem: at least 6 free cells above the floor
        let free = 0; for (let k = 1; k <= 6; k++) if (!solidAt(wx, fy + k, wz)) free++; if (free < 6) continue;
        hugeFungus(b === BIO.crimson_forest ? 'crimson' : 'warped', wx, fy + 1, wz, mulberry32(hash3(wx, wz, 2207, seed)), put);
      }
    }
    // structures (fortresses)
    const beList = [], spawns = [];
    applyNetherStructures(seed, cx, cz, blocks, meta, beList, spawns);
    return { blocks, meta, biome, spawns, be: beList };
  }
  return { seed, generateChunk, biomeAt, densityAt, solidAt, floorBelow, hugeFungus };
}

// ======================================================================================= the End
function endSpikes(seed) {
  const r = mulberry32((seed | 0) ^ 0x5eed1e), idx = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = 9; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
  return idx.map((v, i) => { const a = 2 * (-Math.PI + Math.PI / 10 * i); return { x: Math.floor(42 * Math.cos(a)), z: Math.floor(42 * Math.sin(a)), r: 2 + Math.floor(v / 3), h: 76 + v * 3, guarded: v === 1 || v === 2 }; });
}
function makeEndGen(seed) {
  const nI = new Perlin(seed + 4401), nD = new Perlin(seed + 4502), nU = new Perlin(seed + 4603);
  const islCache = new Map();
  const islNoise = (k, l) => { const key = k * 131071 + l; let v = islCache.get(key); if (v === undefined) { v = nI.n2(k * 0.731 + 0.37, l * 0.731 - 0.61) * 1.42; islCache.set(key, v); if (islCache.size > 30000) islCache.clear(); } return v; };
  // TheEndBiomeSource.getHeightValue in section units (blocks / 8): the main island plus the scattered outer islands beyond 1024 blocks
  function heightValue(sx, sz) {
    let f = 100 - Math.sqrt(sx * sx + sz * sz) * 8;
    f = f < -100 ? -100 : f > 80 ? 80 : f;
    const i = Math.floor(sx / 2), j = Math.floor(sz / 2);
    if (Math.sqrt(i * i + j * j) + 13 < 64) return f;      // no outer island can reach this close to the centre
    for (let a = -12; a <= 12; a++) for (let b = -12; b <= 12; b++) {
      const k1 = i + a, l1 = j + b;
      if (k1 * k1 + l1 * l1 > 4096 && islNoise(k1, l1) < -0.9) {
        const f1 = (Math.abs(k1) * 3439 + Math.abs(l1) * 147) % 13 + 9, f2 = sx - k1 * 2, f3 = sz - l1 * 2;
        let f4 = 100 - Math.sqrt(f2 * f2 + f3 * f3) * f1; f4 = f4 < -100 ? -100 : f4 > 80 ? 80 : f4;
        if (f4 > f) f = f4;
      }
    }
    return f;
  }
  function biomeAtChunk(cx, cz) {
    if (cx * cx + cz * cz <= 4096) return BIO.the_end;
    const h = heightValue(cx * 2 + 1, cz * 2 + 1);
    return h > 40 ? BIO.end_highlands : BIO.small_end_islands;
  }
  // column profile: [top, bottom] of the end stone (top < bottom = empty)
  function profile(x, z, s) {
    if (s <= 0) return [-1, 0];
    const top = 55 + s / 12 + nD.n2(x * 0.045, z * 0.045) * 1.6;
    const thick = s * 0.55 * (0.82 + 0.36 * (nD.n2(x * 0.021 + 7, z * 0.021) * 0.5 + 0.5));
    return [Math.floor(top), Math.floor(top - thick)];
  }
  function topAt(x, z) { const s = heightValue(x / 8, z / 8); const p = profile(x, z, s); return p[0] > p[1] ? p[0] : -1; }
  function chorusTree(x, y, z, rnd, put) {
    // ChorusFlowerBlock.generatePlant, simplified: a trunk that branches sideways and up, flowers at the tips
    const grow = (px, py, pz, depth) => {
      const h = 1 + (rnd() * (depth === 0 ? 4 : 3) | 0);
      for (let k = 0; k < h; k++) put(px, py + k, pz, BID.chorus_plant);
      const ty = py + h - 1;
      if (depth >= 4 || ty - y > 16) { put(px, ty + 1, pz, BID.chorus_flower, 5); return; }
      let n = rnd() < 0.3 ? 1 : 1 + (rnd() * 3 | 0); if (depth === 0) n = 2 + (rnd() * 2 | 0);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let grew = false;
      for (let b = 0; b < n; b++) {
        const d = dirs[(rnd() * 4) | 0], nx = px + d[0], nz = pz + d[1];
        if (Math.abs(nx - x) > 7 || Math.abs(nz - z) > 7) continue;
        put(nx, ty, nz, BID.chorus_plant); grow(nx, ty + 1, nz, depth + 1); grew = true;
      }
      if (!grew) put(px, ty + 1, pz, BID.chorus_flower, 5);
    };
    grow(x, y, z, 0);
  }
  function generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOL), meta = new Uint8Array(CHUNK_VOL), biome = new Uint8Array(256);
    const X0 = cx << 4, Z0 = cz << 4, END = BID.end_stone;
    biome.fill(biomeAtChunk(cx, cz));
    // island strength on a 4-block lattice, bilinear inside the chunk
    const S = new Float32Array(25);
    for (let k = 0; k < 5; k++) for (let i = 0; i < 5; i++) S[k * 5 + i] = heightValue((X0 + i * 4) / 8, (Z0 + k * 4) / 8);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const ii = lx >> 2, kk = lz >> 2, fx = (lx & 3) / 4, fz = (lz & 3) / 4;
      const s = (S[kk * 5 + ii] * (1 - fx) + S[kk * 5 + ii + 1] * fx) * (1 - fz) + (S[(kk + 1) * 5 + ii] * (1 - fx) + S[(kk + 1) * 5 + ii + 1] * fx) * fz;
      const wx = X0 + lx, wz = Z0 + lz, p = profile(wx, wz, s);
      if (p[0] <= p[1]) continue;
      const i = (lz << 4) | lx;
      for (let y = Math.max(1, p[1]); y <= p[0] && y < 250; y++) {
        if (y < p[0] - 3 && y < p[1] + 6 && nU.n3(wx * 0.09, y * 0.09, wz * 0.09) * 4 > y - p[1]) continue;   // ragged underside
        blocks[(y << 8) | i] = END;
      }
    }
    const beList = [], spawns = [];
    // main island features: obsidian spikes and the exit podium
    if (Math.abs(cx) <= 4 && Math.abs(cz) <= 4) {
      for (const sp of endSpikes(seed)) {
        if (sp.x + sp.r + 2 < X0 || sp.x - sp.r - 2 > X0 + 15 || sp.z + sp.r + 2 < Z0 || sp.z - sp.r - 2 > Z0 + 15) continue;
        for (let dx = -sp.r; dx <= sp.r; dx++) for (let dz = -sp.r; dz <= sp.r; dz++) {
          if (dx * dx + dz * dz > sp.r * sp.r + 1) continue;
          const lx = sp.x + dx - X0, lz = sp.z + dz - Z0; if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
          for (let y = 1; y < sp.h + 10; y++) blocks[(y << 8) | (lz << 4) | lx] = y < sp.h ? BID.obsidian : 0;
        }
        const set = (x, y, z, id, m) => { const lx = x - X0, lz = z - Z0; if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return; blocks[(y << 8) | (lz << 4) | lx] = id; meta[(y << 8) | (lz << 4) | lx] = m | 0; };
        set(sp.x, sp.h, sp.z, BID.bedrock); set(sp.x, sp.h + 1, sp.z, BID.fire);
        if (sp.guarded) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = sp.h; y <= sp.h + 3; y++) {
          if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || y === sp.h + 3) set(sp.x + dx, y, sp.z + dz, BID.iron_bars);
        }
      }
      placeEndPodium(blocks, meta, X0, Z0, endPodiumY(seed), false);
    }
    // outer islands: chorus plants on the highlands (3x3 neighbourhood so trees cross borders)
    if (cx * cx + cz * cz > 4096) {
      const put = (wx, wy, wz, id, m) => { const lx = wx - X0, lz = wz - Z0; if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 1 || wy > 250) return; const idx = (wy << 8) | (lz << 4) | lx; if (blocks[idx] === 0) { blocks[idx] = id; meta[idx] = m | 0; } };
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const ncx = cx + dx, ncz = cz + dz, rr = mulberry32(hash3(ncx, ncz, 6061, seed));
        if (biomeAtChunk(ncx, ncz) !== BIO.end_highlands) continue;
        const n = (rr() * 4) | 0;
        for (let a = 0; a < n; a++) {
          const wx = (ncx << 4) + (rr() * 16 | 0), wz = (ncz << 4) + (rr() * 16 | 0);
          const t = topAt(wx, wz); if (t < 10) continue;
          chorusTree(wx, t + 1, wz, mulberry32(hash3(wx, wz, 6062, seed)), put);
        }
      }
    }
    applyEndStructures(seed, cx, cz, blocks, meta, beList, spawns);
    return { blocks, meta, biome, spawns, be: beList };
  }
  return { seed, generateChunk, heightValue, topAt, biomeAtChunk, chorusTree };
}
// exit podium height: one above the island surface at the origin
function endPodiumY(seed) { const g = getEndGen(seed); return Math.max(40, g.topAt(0, 0) + 1); }
// EndPodiumFeature: bedrock bowl around (0,y,0), active = filled with end portal blocks; X0/Z0 = chunk origin, or pass setFn (x,y,z,id,meta) to write elsewhere
function placeEndPodium(blocks, meta, X0, Z0, py, active, setFn) {
  const set = setFn || ((x, y, z, id, m) => { const lx = x - X0, lz = z - Z0; if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 0 || y > 255) return; const idx = (y << 8) | (lz << 4) | lx; blocks[idx] = id; meta[idx] = m | 0; });
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let y = py - 1; y <= py + 32; y++) {
    const dy = y - py, d2 = x * x + dy * dy + z * z, inner = d2 < 6.25, outer = d2 < 12.25;
    if (!inner && !outer) continue;
    if (y < py) set(x, y, z, inner ? BID.bedrock : BID.end_stone, 0);
    else if (y > py) set(x, y, z, 0, 0);
    else if (!inner) set(x, y, z, BID.bedrock, 0);
    else set(x, y, z, active ? BID.end_portal : 0, 0);
  }
  for (let k = 0; k < 4; k++) set(0, py + k, 0, BID.bedrock, 0);
  set(1, py + 2, 0, BID.torch, 1); set(-1, py + 2, 0, BID.torch, 2); set(0, py + 2, 1, BID.torch, 3); set(0, py + 2, -1, BID.torch, 4);
}
