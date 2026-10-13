// ===== shared_medoh.js : the "Divine Beast Vah Medoh" world preset (generator code 3) =====
// A hand-shaped landscape - Lake Totori ringed by the Tabantha canyon walls, open to the east - generated procedurally,
// plus the sculpted diorama (Rito Village's spire with Vah Medoh perched on it) baked into MEDOH_BP by tools/medoh/sculpt.js.
let _medohBP = null, _medohGen = null;

function medohB64(s) {
  const T = new Uint8Array(128), A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < 64; i++) T[A.charCodeAt(i)] = i;
  let n = s.length; while (n && s.charCodeAt(n - 1) === 61) n--;
  const out = new Uint8Array(Math.floor(n * 3 / 4)); let o = 0, acc = 0, nb = 0;
  for (let i = 0; i < n; i++) { acc = ((acc << 6) | T[s.charCodeAt(i)]) & 0xffff; nb += 6; if (nb >= 8) { nb -= 8; out[o++] = (acc >> nb) & 255; } }
  return out;
}
// minimal raw-DEFLATE decoder (RFC 1951), canonical Huffman decoding as in zlib's puff.c
function medohInflate(src, size) {
  const out = new Uint8Array(size); let pos = 0, op = 0, bitBuf = 0, bitCnt = 0;
  const bits = n => { while (bitCnt < n) { bitBuf |= src[pos++] << bitCnt; bitCnt += 8; } const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v; };
  const build = lens => { const count = new Uint16Array(16), sym = new Uint16Array(lens.length), offs = new Uint16Array(16); for (let i = 0; i < lens.length; i++) count[lens[i]]++; count[0] = 0; for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1]; for (let s = 0; s < lens.length; s++) if (lens[s]) sym[offs[lens[s]]++] = s; return { count, sym }; };
  const decode = h => { let code = 0, first = 0, index = 0; for (let len = 1; len < 16; len++) { code |= bits(1); const c = h.count[len]; if (code - c < first) return h.sym[index + (code - first)]; index += c; first += c; first <<= 1; code <<= 1; } throw new Error('medoh blueprint: bad code'); };
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258], LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577], DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  let last = 0;
  while (!last) {
    last = bits(1); const type = bits(2);
    if (type === 0) { bitBuf = 0; bitCnt = 0; const len = src[pos] | (src[pos + 1] << 8); pos += 4; out.set(src.subarray(pos, pos + len), op); op += len; pos += len; continue; }
    let lh, dh;
    if (type === 1) { const l = new Uint8Array(288); l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288); lh = build(l); dh = build(new Uint8Array(30).fill(5)); }
    else {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4, cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[ORDER[i]] = bits(3);
      const ch = build(cl), lens = new Uint8Array(hlit + hdist); let i = 0;
      while (i < hlit + hdist) { const s = decode(ch); if (s < 16) lens[i++] = s; else { let rep, val = 0; if (s === 16) { val = lens[i - 1]; rep = 3 + bits(2); } else if (s === 17) rep = 3 + bits(3); else rep = 11 + bits(7); while (rep--) lens[i++] = val; } }
      lh = build(lens.subarray(0, hlit)); dh = build(lens.subarray(hlit));
    }
    for (;;) {
      const s = decode(lh);
      if (s < 256) out[op++] = s; else if (s === 256) break;
      else { const k = s - 257, len = LBASE[k] + bits(LEXT[k]), ds = decode(dh), dist = DBASE[ds] + bits(DEXT[ds]); for (let j = 0; j < len; j++) { out[op] = out[op - dist]; op++; } }
    }
  }
  return out;
}
// decoded blueprint: palette of (id, meta), chunk directory, column runs (y0, length, palette index)
function medohBlueprint() {
  if (_medohBP) return _medohBP;
  const raw = medohInflate(medohB64(MEDOH_BP.data), MEDOH_BP.raw), u16 = o => raw[o] | (raw[o + 1] << 8), i16 = o => (u16(o) << 16) >> 16;
  const nPal = u16(4), pal = raw.subarray(6, 6 + nPal * 2); let o = 6 + nPal * 2; const nCh = u16(o); o += 2;
  const dir = new Map();
  for (let i = 0; i < nCh; i++, o += 8) dir.set((i16(o) + 2048) * 4096 + i16(o + 2) + 2048, (raw[o + 4] | (raw[o + 5] << 8) | (raw[o + 6] << 16) | (raw[o + 7] << 24)) >>> 0);
  return (_medohBP = { raw, pal, dir, base: o });
}

const MEDOH_SPAWN = { x: 197.5, y: 67, z: 40.5 };
const MEDOH_HAS_BP = typeof MEDOH_BP !== 'undefined';   // absent only while the blueprint is being generated
const MEDOH_BEAM = MEDOH_HAS_BP ? { x0: MEDOH_BP.mx + 102, x1: MEDOH_BP.mx + 102 + 400, y: MEDOH_BP.deckY - 11, z: 0 } : { x0: 1, x1: 0, y: 0, z: 0 };

function getMedohGen(seed) {
  if (_medohGen && _medohGen.seed === seed) return _medohGen;
  const nA = new Perlin(seed ^ 0x3c6ef372), nB = new Perlin(seed ^ 0x1f83d9ab), nC = new Perlin(seed ^ 0x5be0cd19), nD = new Perlin(seed ^ 0x6a09e667);
  const STONE = BID.stone, DIRT = BID.dirt, GRASS = BID.grass_block, GRASS_SNOWY = BID.grass_block_snowy, SAND = BID.sand, GRAVEL = BID.gravel, CLAY = BID.clay, WATER = BID.water, ICE = BID.ice;
  const ROCK = [BID.stone, BID.stone, BID.light_gray_terracotta, BID.stone, BID.andesite, BID.terracotta, BID.stone, BID.white_terracotta, BID.stone, BID.andesite, BID.light_gray_terracotta, BID.stone, BID.terracotta, BID.stone];
  const FLOWERS = [BID.cornflower, BID.oxeye_daisy, BID.azure_bluet, BID.blue_orchid, BID.allium, BID.poppy];

  // terrain height of a column
  function hAt(x, z) {
    const d = Math.sqrt(x * x + z * z), ux = d > 0 ? x / d : 1, uz = d > 0 ? z / d : 0;
    const lakeR = 152 + 26 * fbm2(nA, ux * 1.6 + 9.1, uz * 1.6 - 4.3, 3);
    const bed = 50 + 5 * fbm2(nC, x * 0.035, z * 0.035, 2) - 6 * (1 - Math.min(1, d / lakeR));
    const land = 71 + 15 * fbm2(nB, x * 0.007 + 40, z * 0.007 - 17, 4) + 3.5 * fbm2(nC, x * 0.03 + 7, z * 0.03, 3);
    // canyon walls: flat-topped mesas standing around the lake, opening to the east where the beast is aiming
    const open = 1 - smoothstep(0.5, 0.93, ux);
    let mesa = smoothstep(196, 250, d + fbm2(nD, x * 0.0055 + 3, z * 0.0055 + 8, 3) * 80) * open;
    mesa = mesa * mesa * (3 - 2 * mesa); mesa = mesa * mesa * (3 - 2 * mesa);
    const top = 112 + 34 * fbm2(nA, x * 0.004 - 20, z * 0.004 + 6, 2) + (z < 0 ? Math.min(26, -z * 0.06) : 0);
    let hh = land + (top - land) * mesa;
    if (mesa > 0.04) { const q = hh / 11, f = q - Math.floor(q); hh = (Math.floor(q) + smoothstep(0.3, 0.7, f)) * 11 + 2 * fbm2(nC, x * 0.05, z * 0.05, 2); }   // terraces
    hh = Math.max(65.2, hh);
    let h = bed + (hh - bed) * smoothstep(lakeR - 16, lakeR + 12, d);
    const ds = Math.sqrt((x - 176) * (x - 176) + (z - 34) * (z - 34));                                       // the clearing where the last bridge lands
    h += (66 - h) * (1 - smoothstep(27, 52, ds));
    return h;
  }

  function generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOL), meta = new Uint8Array(CHUNK_VOL), biome = new Uint8Array(256), spawns = [], be = [];
    const X0 = cx << 4, Z0 = cz << 4;
    const H = new Int16Array(324);
    for (let lz = -1; lz <= 16; lz++) for (let lx = -1; lx <= 16; lx++) H[(lz + 1) * 18 + lx + 1] = Math.round(hAt(X0 + lx, Z0 + lz));
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const wx = X0 + lx, wz = Z0 + lz, i = (lz << 4) | lx, k = (lz + 1) * 18 + lx + 1, h = H[k];
      const lo = Math.min(H[k - 1], H[k + 1], H[k - 18], H[k + 18]), hi = Math.max(H[k - 1], H[k + 1], H[k - 18], H[k + 18]);
      const snowy = wz < -120 && h > 100 + 10 * hashf(wx >> 2, 3, wz >> 2, seed);
      biome[i] = snowy ? BIO.snowy_taiga : BIO.taiga;
      blocks[i] = BID.bedrock;
      for (let y = 1; y <= h; y++) blocks[(y << 8) | i] = STONE;
      if (h < SEA - 1) {                                                   // lake bed
        const q = nC.n2(wx * 0.06, wz * 0.06); blocks[(h << 8) | i] = q > 0.28 ? CLAY : q < -0.2 ? GRAVEL : SAND; blocks[((h - 1) << 8) | i] = SAND; blocks[((h - 2) << 8) | i] = DIRT;
      } else if (h <= SEA + 1) { for (let y = h - 2; y <= h; y++) blocks[(y << 8) | i] = SAND; }
      else {
        if (h - lo >= 3) { const wob = Math.round(fbm2(nB, wx * 0.02, wz * 0.02, 2) * 8); for (let y = Math.max(1, lo - 2); y <= h; y++) blocks[(y << 8) | i] = ROCK[(((y + wob) >> 1) % 14 + 14) % 14]; }   // exposed cliff strata
        if (hi - h <= 2 || h - lo < 3) { blocks[(h << 8) | i] = snowy ? GRASS_SNOWY : GRASS; if (h - lo < 3) for (let y = h - 3; y < h; y++) blocks[(y << 8) | i] = DIRT; if (snowy) { blocks[((h + 1) << 8) | i] = BID.snow_layer; meta[((h + 1) << 8) | i] = 1; } }
      }
      for (let y = h + 1; y <= SEA; y++) blocks[(y << 8) | i] = WATER;
    }
    // spruce woods (trees may straddle chunk borders: every chunk grows the trees rooted within 4 blocks of it and keeps its own part)
    const g = getGen(seed);
    const put = (wx, wy, wz, id, isLog, pm) => { const lx = wx - X0, lz = wz - Z0; if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 1 || wy > 254) return; const idx = (wy << 8) | (lz << 4) | lx; if (blocks[idx] === 0 || (isLog && blocks[idx] === BID.snow_layer)) { blocks[idx] = id; meta[idx] = pm | 0; } };
    for (let tz = Z0 - 4; tz < Z0 + 20; tz++) for (let tx = X0 - 4; tx < X0 + 20; tx++) {
      const r = hashf(tx, 77, tz, seed); if (r > 0.05) continue;
      const d = Math.sqrt(tx * tx + tz * tz); if (d < 150) continue;
      if (r > 0.006 + 0.055 * Math.max(0, fbm2(nC, tx * 0.011 + 90, tz * 0.011, 2) + 0.12)) continue;
      const ds = Math.sqrt((tx - 176) * (tx - 176) + (tz - 34) * (tz - 34)); if (ds < 50 || (tx > 120 && Math.abs(tz) < 70 && tx < 300)) continue;   // keep the view from the landing open
      const h = Math.round(hAt(tx, tz)); if (h <= SEA + 1) continue;
      if (Math.abs(Math.round(hAt(tx + 1, tz)) - h) > 1 || Math.abs(Math.round(hAt(tx, tz + 1)) - h) > 1 || Math.abs(Math.round(hAt(tx - 1, tz)) - h) > 1 || Math.abs(Math.round(hAt(tx, tz - 1)) - h) > 1) continue;
      g.treeAt('spruce', tx, h + 1, tz, mulberry32(hash3(tx, 5, tz, seed)), put);
    }
    // undergrowth
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const i = (lz << 4) | lx, h = H[(lz + 1) * 18 + lx + 1]; if (blocks[(h << 8) | i] !== GRASS || blocks[((h + 1) << 8) | i] !== 0) continue;
      const r = hashf(X0 + lx, 9, Z0 + lz, seed);
      if (r < 0.16) blocks[((h + 1) << 8) | i] = BID.short_grass; else if (r < 0.19) blocks[((h + 1) << 8) | i] = BID.fern; else if (r < 0.2) blocks[((h + 1) << 8) | i] = FLOWERS[(r * 6000 | 0) % 6];
    }
    // the diorama
    const bp = MEDOH_HAS_BP ? medohBlueprint() : null, off = bp ? bp.dir.get((cx + 2048) * 4096 + cz + 2048) : undefined;
    if (off !== undefined) {
      const raw = bp.raw, pal = bp.pal; let p = bp.base + off;
      for (let col = 0; col < 256; col++) { const n = raw[p++]; for (let r = 0; r < n; r++, p += 3) { const y0 = raw[p], y1 = y0 + raw[p + 1], pi = raw[p + 2] * 2, id = pal[pi], m = pal[pi + 1]; for (let y = y0; y < y1; y++) { const idx = (y << 8) | col; blocks[idx] = id; meta[idx] = m; } } }
    }
    // the targeting beam: a red line from the beak to the horizon
    if (Z0 <= MEDOH_BEAM.z && MEDOH_BEAM.z < Z0 + 16 && X0 + 15 >= MEDOH_BEAM.x0 && X0 <= MEDOH_BEAM.x1) {
      for (let lx = 0; lx < 16; lx++) { const wx = X0 + lx; if (wx < MEDOH_BEAM.x0 || wx > MEDOH_BEAM.x1) continue; const idx = (MEDOH_BEAM.y << 8) | ((MEDOH_BEAM.z - Z0) << 4) | lx; if (blocks[idx] === 0) blocks[idx] = BID.ancient_beam; }
    }
    for (const [bx, by, bz] of (MEDOH_HAS_BP && MEDOH_BP.chests) || []) if (bx >= X0 && bx < X0 + 16 && bz >= Z0 && bz < Z0 + 16) be.push({ x: bx, y: by, z: bz, type: 'chest', loot: 20170303, table: 'medoh_champion' });
    // a few cuccos scratching around the landing
    for (const [sx, sz] of [[181, 47], [186, 29], [168, 50], [174, 22]]) if (sx >= X0 && sx < X0 + 16 && sz >= Z0 && sz < Z0 + 16) spawns.push(['chicken', sx + 0.5, 67, sz + 0.5]);
    return { blocks, meta, biome, spawns, be };
  }
  return (_medohGen = { seed, generateChunk, hAt, findSpawn: () => ({ x: MEDOH_SPAWN.x, y: MEDOH_SPAWN.y, z: MEDOH_SPAWN.z }) });
}
