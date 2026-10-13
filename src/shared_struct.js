// ===== shared_struct.js : structures (villages, strongholds, nether fortresses) =====
// Every structure is laid out once from its own seed (cached, deterministic) as a list of pieces with world bounding boxes;
// each chunk that intersects a piece writes only its own cells, so structures cross chunk borders seamlessly in the workers.

const SCACHE = new Map();
function scached(key, make) {
  if (SCACHE.has(key)) return SCACHE.get(key);
  const v = make(); SCACHE.set(key, v);
  if (SCACHE.size > 160) SCACHE.delete(SCACHE.keys().next().value);
  return v;
}

// ---- frames: origin + facing. dir 0 = forward +z (south), 1 = -x (west), 2 = -z (north), 3 = +x (east); "right" of dir d = forward of d+1
const FDX = [0, -1, 0, 1], FDZ = [1, 0, -1, 0], FACE_F = [3, 4, 2, 5];
const frm = (ox, oy, oz, dir) => ({ ox, oy, oz, dir: dir & 3 });
const fwx = (f, lx, lz) => f.ox + lx * FDX[(f.dir + 1) & 3] + lz * FDX[f.dir];
const fwz = (f, lx, lz) => f.oz + lx * FDZ[(f.dir + 1) & 3] + lz * FDZ[f.dir];
const lface = (f, ld) => FACE_F[(f.dir + ld) & 3];             // world face index of a local direction: 0 forward, 1 right, 2 back, 3 left
// block metas from world faces (2 north, 3 south, 4 west, 5 east)
const SM_STAIR = { 5: 0, 4: 1, 3: 2, 2: 3 }, SM_TORCH = { 4: 1, 5: 2, 2: 3, 3: 4 }, SM_DOOR = { 2: 1, 3: 3, 4: 0, 5: 2 }, SM_BED = { 3: 0, 4: 1, 2: 2, 5: 3 }, SM_GATE = { 3: 0, 4: 1, 2: 2, 5: 3 }, S_OPP = { 2: 3, 3: 2, 4: 5, 5: 4 };
const axisOfFace = fc => (fc === 2 || fc === 3) ? 2 : 1;      // log axis along a horizontal face direction
// world bounding box [x0,z0,x1,z1] of a local rectangle in a frame
function fRect(f, lx0, lz0, lx1, lz1) {
  const xa = fwx(f, lx0, lz0), xb = fwx(f, lx1, lz1), za = fwz(f, lx0, lz0), zb = fwz(f, lx1, lz1);
  return [Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb)];
}
const rectsHit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

// ---- writer clipped to one chunk
function SWriter(blocks, meta, cx, cz, be, spawns) {
  const X0 = cx << 4, Z0 = cz << 4;
  const w = {
    X0, Z0, be, spawns,
    inChunk: (x, z) => x >= X0 && x < X0 + 16 && z >= Z0 && z < Z0 + 16,
    set(x, y, z, id, m) { if (y < 1 || y > 254 || x < X0 || x >= X0 + 16 || z < Z0 || z >= Z0 + 16) return; const i = (y << 8) | ((z - Z0) << 4) | (x - X0); blocks[i] = id; meta[i] = m | 0; },
    get(x, y, z) { if (y < 0 || y > 255 || x < X0 || x >= X0 + 16 || z < Z0 || z >= Z0 + 16) return -1; return blocks[(y << 8) | ((z - Z0) << 4) | (x - X0)]; },
    ent(x, y, z, o) { if (w.inChunk(x, z)) be.push(Object.assign({ x, y, z }, o)); },
    spawn(kind, x, y, z, data) { if (w.inChunk(Math.floor(x), Math.floor(z))) spawns.push([kind, x, y, z, data || null]); },
    hits: (r) => r[0] <= X0 + 15 && r[2] >= X0 && r[1] <= Z0 + 15 && r[3] >= Z0,
  };
  return w;
}
const fset = (w, f, lx, ly, lz, id, m) => w.set(fwx(f, lx, lz), f.oy + ly, fwz(f, lx, lz), id, m);
const fget = (w, f, lx, ly, lz) => w.get(fwx(f, lx, lz), f.oy + ly, fwz(f, lx, lz));
function ffill(w, f, x0, y0, z0, x1, y1, z1, id, m) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) fset(w, f, x, y, z, id, m); }
// natural terrain blocks that structures may dig into / cover
const isNatural = id => id === 0 || T_REPL[id] === 1 || id === BID.grass_block || id === BID.dirt || id === BID.stone || id === BID.sand || id === BID.gravel || id === BID.grass_block_snowy || id === BID.snow_layer || id === BID.podzol || id === BID.coarse_dirt || BLOCKS[id].leaves || BLOCKS[id].log || BLOCKS[id].model === M_CROSS || id === BID.red_sand || id === BID.clay || id === BID.sandstone || id === BID.snow_block || id === BID.ice || id === BID.water;

// ======================================================================================= villages
const VREG = 28;            // region size in chunks (one village candidate per region)
const VSTYLE = {}; VSTYLE[BIO.plains] = 'plains'; VSTYLE[BIO.desert] = 'desert'; VSTYLE[BIO.savanna] = 'savanna'; VSTYLE[BIO.taiga] = 'taiga'; VSTYLE[BIO.snowy_plains] = 'snowy';
const VPAL = {
  plains: { base: 'cobblestone', wall: 'oak_planks', log: 'oak_log', stairs: 'oak_stairs', slab: 'oak_slab', fence: 'oak_fence', path: 'dirt_path', crops: ['wheat', 'wheat', 'carrots', 'potatoes'] },
  desert: { base: 'sandstone', wall: 'sandstone', log: 'sandstone', stairs: 'sandstone_stairs', slab: 'sandstone_slab', fence: 'oak_fence', path: 'sandstone', flat: true, crops: ['wheat'] },
  savanna: { base: 'cobblestone', wall: 'acacia_planks', log: 'acacia_log', stairs: 'acacia_stairs', slab: 'acacia_slab', fence: 'oak_fence', path: 'dirt_path', crops: ['wheat', 'wheat', 'potatoes'] },
  taiga: { base: 'cobblestone', wall: 'spruce_planks', log: 'spruce_log', stairs: 'spruce_stairs', slab: 'spruce_slab', fence: 'oak_fence', path: 'dirt_path', crops: ['potatoes', 'wheat', 'carrots'] },
  snowy: { base: 'cobblestone', wall: 'spruce_planks', log: 'spruce_log', stairs: 'spruce_stairs', slab: 'spruce_slab', fence: 'oak_fence', path: 'dirt_path', crops: ['wheat', 'potatoes'] },
};
for (const k in VPAL) { const P = VPAL[k]; for (const n of ['base', 'wall', 'log', 'stairs', 'slab', 'fence', 'path']) P[n] = BID[P[n]]; P.crops = P.crops.map(c => BID[c]); }
// building types: [kind, weight, W, D, workstation, beds, variant]
const VBUILD = [
  ['house', 30, 5, 5, null, 1], ['house', 16, 7, 6, null, 2], ['farm', 16, 7, 9], ['farm', 6, 9, 11], ['house', 6, 7, 7, 'lectern', 1, 'library'], ['house', 7, 7, 6, 'blast_furnace', 1, 'smith'],
  ['house', 4, 7, 6, 'smithing_table', 1, 'smith'], ['house', 4, 7, 6, 'grindstone', 1, 'smith'], ['house', 5, 5, 6, 'smoker', 1], ['church', 4, 5, 9, 'brewing_stand', 1], ['house', 5, 7, 6, 'loom', 1],
  ['house', 5, 5, 6, 'fletching_table', 1], ['house', 4, 7, 6, 'cartography_table', 1], ['house', 5, 5, 6, 'stonecutter', 1], ['house', 4, 5, 6, 'cauldron', 1], ['house', 3, 5, 6, 'composter', 1],
  ['pen', 7, 7, 7], ['hay', 3, 3, 3],
];
const VB_TOTAL = VBUILD.reduce((a, b) => a + b[1], 0);

function villageCandidate(seed, rx, rz) {
  const r = mulberry32(hash3(rx, rz, 10387312, seed | 0));
  const cx = rx * VREG + 3 + (r() * (VREG - 9) | 0), cz = rz * VREG + 3 + (r() * (VREG - 9) | 0);
  return { x: cx * 16 + 8, z: cz * 16 + 8, seed: hash3(cx, cz, 777123, seed | 0) };
}
// validated + laid out village of a region (cached), or null
function villageAt(seed, rx, rz) {
  return scached('v' + seed + ':' + rx + ':' + rz, () => {
    const c = villageCandidate(seed, rx, rz), g = getGen(seed);
    const cc = g.column(c.x, c.z), b = cc.biome, h0 = cc.h, river = cc.river, style = VSTYLE[b];
    if (!style || h0 < SEA + 1 || h0 > 120 || river > 0.2) return null;
    let mn = h0, mx = h0;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, q = g.column(c.x + Math.round(Math.cos(a) * 14), c.z + Math.round(Math.sin(a) * 14)); if (q.h < SEA) return null; mn = Math.min(mn, q.h); mx = Math.max(mx, q.h); }
    if (mx - mn > 6) return null;
    return layoutVillage(seed, c, style, h0);
  });
}
function layoutVillage(seed, c, style, h0) {
  const r = mulberry32(c.seed), g = getGen(seed);
  const V = { x: c.x, z: c.z, y: h0, style, pieces: [], roads: [], bbox: null };
  const occ = [];
  const free = rc => { for (const q of occ) if (rectsHit(rc, q)) return false; return true; };
  occ.push([c.x - 4, c.z - 4, c.x + 4, c.z + 4]);
  V.pieces.push({ kind: 'well', x: c.x, z: c.z, y: h0, rect: [c.x - 3, c.z - 3, c.x + 4, c.z + 3] });
  let buildings = 0;
  const pickBuilding = () => { let t = r() * VB_TOTAL; for (const b of VBUILD) { t -= b[1]; if (t <= 0) return b; } return VBUILD[0]; };
  const tryBuilding = (rcx, rcz, side) => {
    // side: world dir (0..3) pointing away from the road; the door sits 3 cells from the road centre line
    const B = pickBuilding(), W = B[2], D = B[3], hw = W >> 1;
    const ox = rcx + FDX[side] * 3, oz = rcz + FDZ[side] * 3, f = frm(ox, 0, oz, side);
    const rc = fRect(f, -hw - 1, -1, W - 1 - hw + 1, D);
    if (!free(rc) || Math.hypot(ox - c.x, oz - c.z) > 92) return false;
    const pts = [[-hw, 0], [W - 1 - hw, 0], [-hw, D - 1], [W - 1 - hw, D - 1], [0, D >> 1]];
    const hs = [];
    for (const [lx, lz] of pts) { const q = g.column(fwx(f, lx, lz), fwz(f, lx, lz)); if (q.h < SEA || q.river > 0.3) return false; hs.push(q.h); }
    hs.sort((a, b) => a - b);
    if (hs[4] - hs[0] > 5) return false;
    f.oy = hs[2];
    occ.push(rc);
    V.pieces.push({ kind: B[0], fr: f, W, D, ws: B[4] || null, beds: B[5] || 0, variant: B[6] || null, seed: hash3(ox, oz, 4441, seed | 0), rect: fRect(f, -hw - 1, -1, W - 1 - hw + 1, D + 1) });
    if (B[0] !== 'farm' && B[0] !== 'pen' && B[0] !== 'hay') V.roads.push({ path: true, rect: fRect(f, 0, -2, 0, -1) });   // little path from the door to the road
    buildings++;
    return true;
  };
  const addRoad = (sx, sz, dir, len, depth) => {
    // road cells: centre line from (sx,sz) along dir for len cells, 3 wide
    const f = frm(sx, 0, sz, dir);
    while (len > 6 && !free(fRect(f, -1, 0, 1, len - 1))) len -= 2;
    if (len <= 6) return;
    const rr = fRect(f, -1, 0, 1, len - 1); occ.push(rr); V.roads.push({ rect: rr });
    for (let t = 3 + (r() * 3 | 0); t < len - 2; t += 7 + (r() * 4 | 0)) {
      const px = fwx(f, 0, t), pz = fwz(f, 0, t);
      for (const sd of [1, 3]) {     // right and left of the road
        if (r() < 0.82) tryBuilding(px, pz, (dir + sd) & 3);
        else if (r() < 0.5) { const nd = (dir + sd) & 3, lx2 = px + FDX[nd] * 2, lz2 = pz + FDZ[nd] * 2, lr = [lx2, lz2, lx2, lz2]; if (free(lr)) { occ.push(lr); V.pieces.push({ kind: 'lamp', x: lx2, z: lz2, rect: [lx2 - 1, lz2 - 1, lx2 + 1, lz2 + 1] }); } }
      }
    }
    if (depth < 2 && len > 14) {
      const nb = 1 + (r() < 0.4 ? 1 : 0);
      for (let k = 0; k < nb; k++) {
        const t = 6 + (r() * (len - 12) | 0), sd = r() < 0.5 ? 1 : 3, nd = (dir + sd) & 3;
        addRoad(fwx(f, 0, t) + FDX[nd] * 2, fwz(f, 0, t) + FDZ[nd] * 2, nd, 12 + (r() * 14 | 0), depth + 1);
      }
    }
  };
  const dirs = [0, 1, 2, 3].map(d => [d, r()]).sort((a, b) => a[1] - b[1]).map(a => a[0]);
  dirs.forEach((d, i) => { if (i < 2 || r() < 0.75) addRoad(c.x + FDX[d] * 5 + (d === 3 ? 1 : 0), c.z + FDZ[d] * 5, d, 20 + (r() * 22 | 0), 0); });
  if (buildings < 3) return null;   // too cramped (water / slopes): no village here
  V.golem = [c.x + 4.5, h0 + 1, c.z + 4.5];
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const q of occ) { x0 = Math.min(x0, q[0]); z0 = Math.min(z0, q[1]); x1 = Math.max(x1, q[2]); z1 = Math.max(z1, q[3]); }
  V.bbox = [x0 - 2, z0 - 2, x1 + 2, z1 + 2];
  return V;
}
// the village whose area contains (x,z) (used to keep trees off village ground), or null
function villageZoneAt(seed, x, z) {
  const rx = Math.floor((x >> 4) / VREG), rz = Math.floor((z >> 4) / VREG);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const V = villageAt(seed, rx + dx, rz + dz);
    if (V && x >= V.bbox[0] - 3 && x <= V.bbox[2] + 3 && z >= V.bbox[1] - 3 && z <= V.bbox[3] + 3) return V;
  }
  return null;
}

// ---- village drawing
function drawVillage(w, V, seed) {
  const P = VPAL[V.style], g = getGen(seed);
  // roads first (buildings may overwrite their ends)
  for (const rd of V.roads) {
    if (!w.hits(rd.rect)) continue;
    for (let z = rd.rect[1]; z <= rd.rect[3]; z++) for (let x = rd.rect[0]; x <= rd.rect[2]; x++) {
      if (!w.inChunk(x, z)) continue;
      const y = g.column(x, z).h;
      if (y < SEA - 1) { w.set(x, SEA - 1, z, P.wall === BID.sandstone ? BID.oak_planks : P.wall, 0); continue; }   // plank bridge over water
      const cur = w.get(x, y, z);
      if (cur === BID.water) { w.set(x, y, z, BID.oak_planks, 0); continue; }
      if (cur !== 0 && isNatural(cur)) w.set(x, y, z, P.path, 0);
      for (let k = 1; k <= 3; k++) { const a = w.get(x, y + k, z); if (a > 0 && (T_REPL[a] || BLOCKS[a].model === M_CROSS || BLOCKS[a].leaves || BLOCKS[a].log || a === BID.snow_layer || a === BID.cactus)) w.set(x, y + k, z, 0, 0); }
    }
  }
  for (const pc of V.pieces) {
    if (!w.hits(pc.rect)) continue;
    if (pc.kind === 'well') buildWell(w, V, P, pc);
    else if (pc.kind === 'lamp') buildLamp(w, g, P, pc);
    else if (pc.kind === 'house') buildHouse(w, V, P, pc);
    else if (pc.kind === 'church') buildChurch(w, V, P, pc);
    else if (pc.kind === 'farm') buildFarm(w, V, P, pc);
    else if (pc.kind === 'pen') buildPen(w, V, P, pc);
    else if (pc.kind === 'hay') buildHay(w, V, P, pc);
  }
  if (V.golem) w.spawn('iron_golem', V.golem[0], V.golem[1], V.golem[2], { village: [V.x, V.z], villageGolem: true });
}
// clear the footprint (and the roof overhang ring) and build a foundation down to the ground
function prepSite(w, f, L0, L1, D, topY, overhangFrom, base) {
  for (let lz = -1; lz <= D; lz++) for (let lx = L0 - 1; lx <= L1 + 1; lx++) {
    const inside = lz >= 0 && lz < D && lx >= L0 && lx <= L1, x = fwx(f, lx, lz), z = fwz(f, lx, lz);
    if (!w.inChunk(x, z)) continue;
    for (let y = f.oy + (inside ? 1 : overhangFrom); y <= f.oy + topY; y++) w.set(x, y, z, 0, 0);
    if (inside) {
      for (let y = f.oy - 1, n = 0; y > 1 && n < 12; y--, n++) { const cur = w.get(x, y, z); if (cur > 0 && T_SOLID[cur] && !BLOCKS[cur].leaves && !BLOCKS[cur].log) break; w.set(x, y, z, n < 1 ? base : BID.dirt, 0); }
    }
  }
}
function vSpawnVillager(w, f, lx, lz, home, prof, V, ws) {
  w.spawn('villager', fwx(f, lx, lz) + 0.5, f.oy + 1, fwz(f, lx, lz) + 0.5, { prof, home, job: ws, village: [V.x, V.z], type: V.style });
}
const WS_PROF = { lectern: 'librarian', blast_furnace: 'armorer', smithing_table: 'toolsmith', grindstone: 'weaponsmith', smoker: 'butcher', brewing_stand: 'cleric', loom: 'shepherd', fletching_table: 'fletcher', cartography_table: 'cartographer', stonecutter: 'mason', cauldron: 'leatherworker', composter: 'farmer', barrel: 'fisherman' };
function buildHouse(w, V, P, pc) {
  const f = pc.fr, W = pc.W, D = pc.D, hw = W >> 1, L0 = -hw, L1 = W - 1 - hw, H = pc.variant === 'library' ? 4 : 3;
  const r = mulberry32(pc.seed), smith = pc.variant === 'smith';
  const wall = smith ? BID.cobblestone : P.wall, log = smith ? BID.cobblestone : P.log;
  const nL = hw + 2, topY = P.flat ? H + 2 : H + nL + 1;
  prepSite(w, f, L0, L1, D, topY, H + 1, P.base);
  ffill(w, f, L0, 0, 0, L1, 0, D - 1, P.base);
  // walls with log corners (and log posts every 3 blocks on long walls)
  for (let ly = 1; ly <= H; ly++) for (let lz = 0; lz < D; lz++) for (let lx = L0; lx <= L1; lx++) {
    const edgeX = lx === L0 || lx === L1, edgeZ = lz === 0 || lz === D - 1;
    if (!edgeX && !edgeZ) continue;
    const post = (edgeX && edgeZ) || (edgeZ && W >= 7 && (lx - L0) % 3 === 0) || (edgeX && D >= 7 && lz % 3 === 0);
    fset(w, f, lx, ly, lz, post ? log : wall, 0);
  }
  // windows
  for (let lz = 1; lz < D - 1; lz++) if (lz % 2 === 1 || D <= 5) { fset(w, f, L0, 2, lz, BID.glass_pane, 0); fset(w, f, L1, 2, lz, BID.glass_pane, 0); if (H >= 4) { fset(w, f, L0, 3, lz, BID.glass_pane, 0); fset(w, f, L1, 3, lz, BID.glass_pane, 0); } }
  for (let lx = L0 + 1; lx < L1; lx++) if ((lx - L0) % 2 === 1) fset(w, f, lx, 2, D - 1, BID.glass_pane, 0);
  if (W >= 7) { fset(w, f, -2, 2, 0, BID.glass_pane, 0); fset(w, f, 2, 2, 0, BID.glass_pane, 0); }
  // door (its slab sits on the road side of the cell), a step in front and a torch beside it
  const dm = SM_DOOR[lface(f, 2)];
  fset(w, f, 0, 1, 0, BID.oak_door, dm); fset(w, f, 0, 2, 0, BID.oak_door, dm | 8);
  fset(w, f, 1, 3, -1, BID.torch, SM_TORCH[lface(f, 0)]);
  if (fget(w, f, 0, 0, -1) === 0) fset(w, f, 0, 0, -1, P.base, 0);
  // roof
  if (P.flat) {
    ffill(w, f, L0, H + 1, 0, L1, H + 1, D - 1, P.wall);
    for (let lz = 0; lz < D; lz++) for (let lx = L0; lx <= L1; lx++) if (lx === L0 || lx === L1 || lz === 0 || lz === D - 1) fset(w, f, lx, H + 2, lz, P.slab, 0);
  } else {
    for (let k = 0; k < nL; k++) {
      const y = H + 1 + k, xl = L0 - 1 + k, xr = L1 + 1 - k;
      for (let lz = -1; lz <= D; lz++) {
        if (xl < xr) { fset(w, f, xl, y, lz, P.stairs, SM_STAIR[lface(f, 1)]); fset(w, f, xr, y, lz, P.stairs, SM_STAIR[lface(f, 3)]); }
        else if (xl === xr) fset(w, f, xl, y, lz, P.wall, 0);
      }
      for (let lx = xl + 1; lx <= xr - 1; lx++) { fset(w, f, lx, y, 0, wall, 0); fset(w, f, lx, y, D - 1, wall, 0); }
    }
  }
  // furniture: beds against the back wall, the workstation by the door, a torch, a table / chest
  const home = [];
  for (let b = 0; b < pc.beds; b++) {
    const lx = L0 + 1 + b * 2; if (lx > L1 - 1 || (lx === 0 && D < 6)) continue;
    const bm = SM_BED[lface(f, 0)], hx = fwx(f, lx, D - 2), hz = fwz(f, lx, D - 2);
    fset(w, f, lx, 1, D - 3, BID.bed, bm); fset(w, f, lx, 1, D - 2, BID.bed, bm | 4);
    home.push([lx, Math.max(1, D - 4), [hx, f.oy + 1, hz]]);
  }
  let wsPos = null;
  if (pc.ws) {
    const id = BID[pc.ws], wx = L1 - 1, wz = 1;
    let m = 0; if (BLOCKS[id].orient) m = lface(f, 2); else if (BLOCKS[id].lectern || BLOCKS[id].grindstone) m = (f.dir + 2) & 3; else if (BLOCKS[id].cauldron) m = 3;
    fset(w, f, wx, 1, wz, id, m); wsPos = [fwx(f, wx, wz), f.oy + 1, fwz(f, wx, wz)];
    if (BLOCKS[id].hasEntity === 'furnace') w.ent(wsPos[0], wsPos[1], wsPos[2], { type: 'furnace', kind: BLOCKS[id].furnaceKind });
  }
  if (pc.variant === 'library') {
    for (let lz = 2; lz <= D - 4; lz++) for (let ly = 1; ly <= 2; ly++) { fset(w, f, L0 + 1, ly, lz, BID.bookshelf, 0); fset(w, f, L1 - 1, ly, lz, BID.bookshelf, 0); }
  }
  if (W >= 7 && !pc.variant) fset(w, f, L1 - 1, 1, D - 2, BID.crafting_table, 0);
  if (smith || r() < 0.35) {
    const left = W >= 7, cx = left ? L0 + 1 : L1 - 1, cz = left ? 1 : D - 2;
    if (!w.inChunk(fwx(f, cx, cz), fwz(f, cx, cz)) || fget(w, f, cx, 1, cz) === 0) {
      fset(w, f, cx, 1, cz, BID.chest, lface(f, left ? 1 : 3));
      w.ent(fwx(f, cx, cz), f.oy + 1, fwz(f, cx, cz), { type: 'chest', loot: hash3(fwx(f, cx, cz), f.oy, fwz(f, cx, cz), pc.seed), table: smith ? 'village_smith' : 'village_house' });
    }
  }
  fset(w, f, L0 + 1, H, D - 2, BID.torch, SM_TORCH[lface(f, 0)]);
  // inhabitants: one per bed; the first takes the house's job
  const prof = pc.ws ? WS_PROF[pc.ws] : null;
  home.forEach((h, i) => vSpawnVillager(w, f, h[0], h[1], h[2], i === 0 && prof ? prof : (r() < 0.08 ? 'nitwit' : 'none'), V, i === 0 && prof ? wsPos : null));
}
function buildChurch(w, V, P, pc) {
  const f = pc.fr, W = pc.W, D = pc.D, hw = W >> 1, L0 = -hw, L1 = W - 1 - hw, H = 7, T = 12;
  prepSite(w, f, L0, L1, D, T + 2, H + 1, BID.cobblestone);
  ffill(w, f, L0, 0, 0, L1, 0, D - 1, BID.cobblestone);
  for (let lz = 0; lz < D; lz++) for (let lx = L0; lx <= L1; lx++) {
    const edge = lx === L0 || lx === L1 || lz === 0 || lz === D - 1, tower = lz >= D - 4, top = tower ? T : H;
    if (edge) for (let ly = 1; ly <= top; ly++) fset(w, f, lx, ly, lz, BID.cobblestone, 0);
    fset(w, f, lx, top + 1, lz, BID.cobblestone_slab, 0);
    if (tower) fset(w, f, lx, H, lz, edge ? BID.cobblestone : BID.oak_planks, 0);
  }
  for (let lz = 2; lz < D - 1; lz += 2) for (const ly of [3, 4]) { fset(w, f, L0, ly, lz, BID.glass_pane, 0); fset(w, f, L1, ly, lz, BID.glass_pane, 0); }
  for (const ly of [9, 10]) { fset(w, f, 0, ly, D - 1, BID.glass_pane, 0); fset(w, f, L0, ly, D - 3, BID.glass_pane, 0); fset(w, f, L1, ly, D - 3, BID.glass_pane, 0); }
  ffill(w, f, L0 + 1, H + 1, 1, L1 - 1, H + 1, D - 5, BID.cobblestone);
  const dm = SM_DOOR[lface(f, 2)]; fset(w, f, 0, 1, 0, BID.oak_door, dm); fset(w, f, 0, 2, 0, BID.oak_door, dm | 8);
  fset(w, f, 1, 3, -1, BID.torch, SM_TORCH[lface(f, 0)]);
  for (let ly = 1; ly <= H; ly++) fset(w, f, L1 - 1, ly, D - 2, BID.ladder, lface(f, 2));
  fset(w, f, 0, 1, D - 3, BID.brewing_stand, 0);
  const ws = [fwx(f, 0, D - 3), f.oy + 1, fwz(f, 0, D - 3)];
  fset(w, f, L0 + 1, 3, 1, BID.torch, SM_TORCH[lface(f, 3)]); fset(w, f, L1 - 1, 3, 1, BID.torch, SM_TORCH[lface(f, 1)]);
  const bm = SM_BED[lface(f, 1)]; fset(w, f, L0 + 1, 1, 2, BID.bed, bm); fset(w, f, L0 + 2, 1, 2, BID.bed, bm | 4);
  vSpawnVillager(w, f, 0, 1, [fwx(f, L0 + 2, 2), f.oy + 1, fwz(f, L0 + 2, 2)], 'cleric', V, ws);
}
function buildFarm(w, V, P, pc) {
  const f = pc.fr, W = pc.W, D = pc.D, hw = W >> 1, L0 = -hw, L1 = W - 1 - hw, r = mulberry32(pc.seed);
  prepSite(w, f, L0, L1, D, 3, 9, BID.dirt);
  const crop = P.crops[(r() * P.crops.length) | 0], crop2 = P.crops[(r() * P.crops.length) | 0];
  const sideAxis = axisOfFace(lface(f, 0)), endAxis = axisOfFace(lface(f, 1));
  for (let lz = 0; lz < D; lz++) for (let lx = L0; lx <= L1; lx++) {
    const sideEdge = lx === L0 || lx === L1, endEdge = lz === 0 || lz === D - 1;
    if (sideEdge || endEdge) { fset(w, f, lx, 0, lz, P.log, P.log === BID.sandstone ? 0 : (sideEdge ? sideAxis : endAxis)); continue; }
    if (lx === 0) { fset(w, f, lx, 0, lz, BID.water, 0); fset(w, f, lx, -1, lz, BID.dirt, 0); continue; }
    fset(w, f, lx, 0, lz, BID.farmland, 7);
    fset(w, f, lx, 1, lz, lx < 0 ? crop : crop2, 2 + (r() * 6 | 0));
  }
  fset(w, f, L0, 1, 0, BID.composter, 2 + (r() * 4 | 0));
  w.spawn('villager', fwx(f, 1, 1) + 0.5, f.oy + 1, fwz(f, 1, 1) + 0.5, { prof: 'farmer', home: null, job: [fwx(f, L0, 0), f.oy + 1, fwz(f, L0, 0)], village: [V.x, V.z], type: V.style });
}
function buildPen(w, V, P, pc) {
  const f = pc.fr, W = pc.W, D = pc.D, hw = W >> 1, L0 = -hw, L1 = W - 1 - hw, r = mulberry32(pc.seed);
  prepSite(w, f, L0, L1, D, 3, 9, BID.dirt);
  for (let lz = 0; lz < D; lz++) for (let lx = L0; lx <= L1; lx++) {
    const cur = fget(w, f, lx, 0, lz); if (cur === 0 || cur === BID.dirt || cur === BID.water) fset(w, f, lx, 0, lz, V.style === 'desert' ? BID.sand : BID.grass_block, 0);
    if (lx === L0 || lx === L1 || lz === 0 || lz === D - 1) fset(w, f, lx, 1, lz, P.fence, 0);
  }
  fset(w, f, 0, 1, 0, BID.oak_fence_gate, SM_GATE[lface(f, 0)]);
  fset(w, f, L0 + 1, 1, D - 2, BID.hay_block, 0);
  const kind = ['cow', 'sheep', 'pig'][(r() * 3) | 0], n = 2 + (r() * 2 | 0);
  for (let i = 0; i < n; i++) { const lx = -1 + (r() * 3 | 0), lz = 2 + (r() * (D - 4) | 0); w.spawn(kind, fwx(f, lx, lz) + 0.5, f.oy + 1, fwz(f, lx, lz) + 0.5, null); }
}
function buildHay(w, V, P, pc) {
  const f = pc.fr, r = mulberry32(pc.seed);
  prepSite(w, f, -1, 1, 3, 3, 9, BID.dirt);
  for (let lz = 0; lz < 3; lz++) for (let lx = -1; lx <= 1; lx++) { fset(w, f, lx, 1, lz, BID.hay_block, 0); if (r() < 0.4) fset(w, f, lx, 2, lz, BID.hay_block, 0); }
}
function buildLamp(w, g, P, pc) {
  const y = g.column(pc.x, pc.z).h;
  w.set(pc.x, y + 1, pc.z, P.fence, 0); w.set(pc.x, y + 2, pc.z, P.fence, 0); w.set(pc.x, y + 3, pc.z, BID.black_wool, 0);
  w.set(pc.x + 1, y + 3, pc.z, BID.torch, 1); w.set(pc.x - 1, y + 3, pc.z, BID.torch, 2); w.set(pc.x, y + 3, pc.z + 1, BID.torch, 3); w.set(pc.x, y + 3, pc.z - 1, BID.torch, 4);
}
function buildWell(w, V, P, pc) {
  const cx = pc.x, cz = pc.z, y = pc.y;
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 4; dx++) {
    const x = cx + dx, z = cz + dz;
    if (!w.inChunk(x, z)) continue;
    for (let k = 1; k <= 6; k++) w.set(x, y + k, z, 0, 0);
    const ring = dx >= -2 && dx <= 1 && dz >= -2 && dz <= 1;
    if (!ring) { const cur = w.get(x, y, z); if (cur >= 0 && isNatural(cur)) w.set(x, y, z, P.path, 0); for (let k = y - 1, n = 0; n < 6; k--, n++) { const c2 = w.get(x, k, z); if (c2 > 0 && T_SOLID[c2]) break; w.set(x, k, z, BID.dirt, 0); } continue; }
    const rim = dx === -2 || dx === 1 || dz === -2 || dz === 1;
    if (rim) { for (let k = y - 5; k <= y + 1; k++) w.set(x, k, z, P.base, 0); }
    else { for (let k = y - 4; k <= y; k++) w.set(x, k, z, BID.water, 0); w.set(x, y - 5, z, P.base, 0); }
  }
  for (const [dx, dz] of [[-2, -2], [1, -2], [-2, 1], [1, 1]]) { w.set(cx + dx, y + 2, cz + dz, P.fence, 0); w.set(cx + dx, y + 3, cz + dz, P.fence, 0); }
  for (let dz = -2; dz <= 1; dz++) for (let dx = -2; dx <= 1; dx++) w.set(cx + dx, y + 4, cz + dz, P.slab === BID.sandstone_slab ? BID.sandstone_slab : BID.cobblestone_slab, 0);
  // the meeting point bell on its post
  w.set(cx + 3, y, cz, P.base, 0); w.set(cx + 3, y + 1, cz, BID.bell, 0);
}

// ======================================================================================= strongholds
function strongholdPositions(seed) {
  return scached('shpos' + seed, () => {
    const r = mulberry32(hash3(seed | 0, 17, 29, 0xC0FFEE)), out = [];
    for (const [n, dist] of [[3, 128], [6, 320]]) {
      const a0 = r() * Math.PI * 2;
      for (let i = 0; i < n; i++) { const a = a0 + i * Math.PI * 2 / n, d = dist + (r() - 0.5) * 80; out.push({ x: Math.round(Math.cos(a) * d) * 16 + 8, z: Math.round(Math.sin(a) * d) * 16 + 8 }); }
    }
    return out;
  });
}
// stronghold piece sizes in a frame whose origin is the entrance centre at floor level: [left, right, depth, height]
const SH_SIZE = { corridor: [2, 2, 7, 5], stairs: [2, 2, 9, 6], room: [5, 5, 11, 7], library: [6, 6, 15, 8], prison: [4, 4, 11, 5], chest: [3, 2, 7, 5], portal: [5, 5, 16, 8], start: [2, 2, 5, 11] };
function strongholdLayout(seed, sx, sz) {
  return scached('sh' + seed + ':' + sx + ':' + sz, () => {
    const r = mulberry32(hash3(sx, sz, 5551, seed | 0)), pieces = [];
    const top = 40 + (r() * 10 | 0);
    const mkBox = (kind, f, len) => {
      const s = SH_SIZE[kind], D = len || s[2];
      return { kind, fr: f, D, H: s[3], rect: fRect(f, -s[0], 0, s[1], D - 1), y0: f.oy + (kind === 'stairs' ? -8 : 0), y1: f.oy + s[3] };
    };
    const overlaps = p => { for (const q of pieces) { if (rectsHit([p.rect[0] + 1, p.rect[1] + 1, p.rect[2] - 1, p.rect[3] - 1], q.rect) && p.y0 <= q.y1 && p.y1 >= q.y0) return true; } return false; };
    const start = mkBox('start', frm(sx, top, sz, (r() * 4) | 0)); start.y0 = top - 11; start.y1 = top + 11; start.seed = r() * 1e9 | 0; pieces.push(start);
    const exits = [{ f: frm(fwx(start.fr, 0, 5), top - 10, fwz(start.fr, 0, 5), start.fr.dir), depth: 1 }];
    let portal = false, library = 0;
    const exitsOf = (p) => {
      const f = p.fr, d = p.D, out = [];
      if (p.kind === 'corridor' || p.kind === 'prison' || p.kind === 'chest') out.push(frm(fwx(f, 0, d), f.oy, fwz(f, 0, d), f.dir));
      if (p.kind === 'corridor' && p.side) { const m = d >> 1; out.push(p.side < 0 ? frm(fwx(f, -3, m), f.oy, fwz(f, -3, m), (f.dir + 3) & 3) : frm(fwx(f, 3, m), f.oy, fwz(f, 3, m), (f.dir + 1) & 3)); }
      else if (p.kind === 'stairs') out.push(frm(fwx(f, 0, d), f.oy - 7, fwz(f, 0, d), f.dir));
      else if (p.kind === 'room') { out.push(frm(fwx(f, 0, d), f.oy, fwz(f, 0, d), f.dir)); out.push(frm(fwx(f, -6, 5), f.oy, fwz(f, -6, 5), (f.dir + 3) & 3)); out.push(frm(fwx(f, 6, 5), f.oy, fwz(f, 6, 5), (f.dir + 1) & 3)); }
      return out;
    };
    const kinds = [['corridor', 30], ['room', 20], ['stairs', 8], ['chest', 9], ['prison', 7], ['library', 6]];
    let guard = 0;
    while (exits.length && pieces.length < 40 && guard++ < 400) {
      const e = exits.shift();
      for (let attempt = 0; attempt < 5; attempt++) {
        let kind;
        const others = exits.length > 0 || pieces.length >= 16;     // dead ends (portal room, library) only while other branches stay open
        if (!portal && e.depth >= 4 && others && r() < 0.4) kind = 'portal';
        else { let t = r() * 80; kind = 'corridor'; for (const k of kinds) { t -= k[1]; if (t <= 0) { kind = k[0]; break; } } }
        if (kind === 'library' && (library >= 1 || !others || e.depth < 3)) kind = 'room';
        if (e.depth <= 1 && attempt < 2) kind = 'room';
        if (kind === 'stairs' && e.f.oy < 22) kind = 'corridor';
        if (attempt >= 3) kind = 'corridor';
        const p = mkBox(kind, e.f, kind === 'corridor' ? (attempt >= 3 ? 5 : 5 + (r() * 3 | 0) * 2) : 0);
        if (p.y0 < 6 || overlaps(p) || Math.abs(fwx(e.f, 0, 0) - sx) > 72 || Math.abs(fwz(e.f, 0, 0) - sz) > 72) continue;
        p.seed = r() * 1e9 | 0; p.door = r(); if (kind === 'corridor' && p.D >= 7 && r() < 0.35) p.side = r() < 0.5 ? -1 : 1;
        pieces.push(p);
        if (kind === 'portal') portal = true; if (kind === 'library') library++;
        for (const nf of exitsOf(p)) if (r() < (p.kind === 'room' ? 0.85 : 1)) exits.push({ f: nf, depth: e.depth + 1 });
        break;
      }
    }
    if (!portal) {   // force the portal room onto any free exit (or straight off the start)
      const tryAt = (f) => { const p = mkBox('portal', f); if (p.y0 < 6 || overlaps(p)) return false; p.seed = r() * 1e9 | 0; pieces.push(p); return true; };
      let ok = false;
      for (const pc of pieces.slice().reverse()) { for (const nf of exitsOf(pc)) if (tryAt(nf)) { ok = true; break; } if (ok) break; }
      for (let d = 0; d < 4 && !ok; d++) ok = tryAt(frm(sx + FDX[d] * 12, top - 10, sz + FDZ[d] * 12, d));
    }
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const p of pieces) { x0 = Math.min(x0, p.rect[0]); z0 = Math.min(z0, p.rect[1]); x1 = Math.max(x1, p.rect[2]); z1 = Math.max(z1, p.rect[3]); }
    return { x: sx, z: sz, pieces, bbox: [x0, z0, x1, z1] };
  });
}
function shStone(x, y, z, salt) { const v = hashf(x, y, z, salt); return v < 0.12 ? BID.cracked_stone_bricks : v < 0.36 ? BID.mossy_stone_bricks : BID.stone_bricks; }
function drawStronghold(w, S) {
  for (const p of S.pieces) {
    if (!w.hits(p.rect)) continue;
    const f = p.fr, s = SH_SIZE[p.kind], L0 = -s[0], L1 = s[1], D = p.D, H = p.H, r = mulberry32(p.seed), salt = p.seed;
    const stoneAt = (lx, ly, lz) => shStone(fwx(f, lx, lz), f.oy + ly, fwz(f, lx, lz), salt);
    const shell = (lx0, y0, lz0, lx1, y1, lz1) => {
      for (let ly = y0; ly <= y1; ly++) for (let lz = lz0; lz <= lz1; lz++) for (let lx = lx0; lx <= lx1; lx++) {
        const edge = lx === lx0 || lx === lx1 || ly === y0 || ly === y1 || lz === lz0 || lz === lz1;
        fset(w, f, lx, ly, lz, edge ? stoneAt(lx, ly, lz) : 0, 0);
      }
    };
    const openEnd = (lz, ly0) => { for (let a = -1; a <= 1; a++) for (let ly = ly0; ly < ly0 + 3; ly++) fset(w, f, a, ly, lz, 0, 0); };
    const openSide = (lx, ly0) => { for (let lz = 4; lz <= 6; lz++) for (let ly = ly0; ly < ly0 + 3; ly++) fset(w, f, lx, ly, lz, 0, 0); };
    if (p.kind === 'start') {
      // a square spiral staircase leading down 10 blocks, exiting forward at the bottom
      shell(-2, -11, 0, 2, 11, 4);
      for (let k = 0; k < 20; k++) { const ring = [[-1, 1], [-1, 2], [-1, 3], [0, 3], [1, 3], [1, 2], [1, 1], [0, 1]][k % 8], ly = 10 - k; fset(w, f, ring[0], ly, ring[1], BID.stone_brick_slab, 0); }
      for (let ly = -10; ly <= 10; ly++) fset(w, f, 0, ly, 2, stoneAt(0, ly, 2), 0);
      openEnd(4, -10);
      continue;
    }
    if (p.kind === 'corridor' || p.kind === 'chest' || p.kind === 'prison') {
      shell(L0, 0, 0, L1, H - 1, D - 1);
      openEnd(0, 1); openEnd(D - 1, 1);
      if (p.kind === 'corridor') {
        if (p.door < 0.3) {
          const dm = SM_DOOR[lface(f, 2)]; fset(w, f, 0, 1, 0, BID.oak_door, dm); fset(w, f, 0, 2, 0, BID.oak_door, dm | 8);
          for (const a of [-1, 1]) for (let ly = 1; ly <= 3; ly++) fset(w, f, a, ly, 0, stoneAt(a, ly, 0), 0);
          fset(w, f, 0, 3, 0, stoneAt(0, 3, 0), 0);
        } else if (p.door < 0.42) for (let a = -1; a <= 1; a++) for (let ly = 1; ly <= 3; ly++) if (a !== 0 || ly === 3) fset(w, f, a, ly, 0, BID.iron_bars, 0);
        if (p.side) { const m = D >> 1, lx = p.side < 0 ? L0 : L1; for (let lz = m - 1; lz <= m + 1; lz++) for (let ly = 1; ly <= 3; ly++) fset(w, f, lx, ly, lz, 0, 0); }
        if (r() < 0.6) fset(w, f, p.side < 0 ? L1 - 1 : L0 + 1, 2, (D >> 1) + 1, BID.torch, SM_TORCH[lface(f, p.side < 0 ? 1 : 3)]);
      } else if (p.kind === 'chest') {
        fset(w, f, L0 + 1, 1, 3, BID.chest, lface(f, 1));
        const cxw = fwx(f, L0 + 1, 3), czw = fwz(f, L0 + 1, 3); w.ent(cxw, f.oy + 1, czw, { type: 'chest', loot: hash3(cxw, f.oy, czw, salt), table: 'stronghold_corridor' });
        fset(w, f, L0 + 1, 2, 1, BID.torch, SM_TORCH[lface(f, 3)]);
      } else {
        // prison: iron-bar cells (with doors) on both sides of the central corridor
        for (const side of [-1, 1]) for (let lz = 1; lz < D - 1; lz++) {
          if (lz % 4 === 2) { const dm = SM_DOOR[lface(f, side > 0 ? 3 : 1)]; fset(w, f, side * 2, 1, lz, BID.oak_door, dm); fset(w, f, side * 2, 2, lz, BID.oak_door, dm | 8); fset(w, f, side * 2, 3, lz, BID.iron_bars, 0); }
          else for (let ly = 1; ly <= 3; ly++) fset(w, f, side * 2, ly, lz, BID.iron_bars, 0);
          if (lz % 4 === 0) for (let ly = 1; ly <= 3; ly++) fset(w, f, side * 3, ly, lz, stoneAt(side * 3, ly, lz), 0);
        }
      }
      continue;
    }
    if (p.kind === 'stairs') {
      // the floor drops one block per step for 7 steps; stair blocks keep it walkable
      for (let lz = 0; lz < D; lz++) {
        const fy = lz === 0 ? -1 : lz <= 7 ? -lz - 1 : -8;
        for (let ly = fy; ly <= fy + 5; ly++) for (let lx = L0; lx <= L1; lx++) {
          const edge = lx === L0 || lx === L1 || ly === fy || ly === fy + 5;
          fset(w, f, lx, ly, lz, edge ? stoneAt(lx, ly, lz) : 0, 0);
        }
        if (lz >= 1 && lz <= 7) for (let lx = -1; lx <= 1; lx++) fset(w, f, lx, fy + 1, lz, BID.stone_brick_stairs, SM_STAIR[lface(f, 2)]);
      }
      continue;
    }
    if (p.kind === 'room') {
      shell(L0, 0, 0, L1, H - 1, D - 1);
      openEnd(0, 1); openEnd(D - 1, 1); openSide(L0, 1); openSide(L1, 1);
      if (r() < 0.5) {   // central pillar with torches
        for (let ly = 1; ly < H - 1; ly++) fset(w, f, 0, ly, 5, stoneAt(0, ly, 5), 0);
        fset(w, f, 1, 3, 5, BID.torch, SM_TORCH[lface(f, 3)]); fset(w, f, -1, 3, 5, BID.torch, SM_TORCH[lface(f, 1)]); fset(w, f, 0, 3, 4, BID.torch, SM_TORCH[lface(f, 0)]); fset(w, f, 0, 3, 6, BID.torch, SM_TORCH[lface(f, 2)]);
      } else {           // fountain
        for (let lz = 3; lz <= 7; lz++) for (let lx = -2; lx <= 2; lx++) { const edge = Math.abs(lx) === 2 || lz === 3 || lz === 7; fset(w, f, lx, 1, lz, edge ? BID.stone_brick_slab : BID.water, 0); }
        for (let ly = 1; ly <= 4; ly++) fset(w, f, 0, ly, 5, stoneAt(0, ly, 5), 0);
        fset(w, f, 0, 5, 5, BID.water, 0);
        fset(w, f, L0 + 1, 3, 1, BID.torch, SM_TORCH[lface(f, 3)]); fset(w, f, L1 - 1, 3, D - 2, BID.torch, SM_TORCH[lface(f, 1)]);
      }
      continue;
    }
    if (p.kind === 'library') {
      shell(L0, 0, 0, L1, H - 1, D - 1);
      openEnd(0, 1);
      for (let lz = 1; lz < D - 1; lz++) for (let ly = 1; ly <= 5; ly++) {
        const id = lz % 4 !== 0 ? BID.bookshelf : BID.oak_planks; fset(w, f, L0 + 1, ly, lz, id, 0); fset(w, f, L1 - 1, ly, lz, id, 0);
      }
      for (const lx of [-3, 3]) for (let lz = 3; lz < D - 3; lz++) for (let ly = 1; ly <= 3; ly++) if (lz % 4 !== 0) fset(w, f, lx, ly, lz, BID.bookshelf, 0);
      for (let k = 0; k < 14; k++) { const lx = L0 + 2 + (r() * (L1 - L0 - 3) | 0), ly = 1 + (r() * 6 | 0), lz = 1 + (r() * (D - 2) | 0); if (fget(w, f, lx, ly, lz) === 0) fset(w, f, lx, ly, lz, BID.cobweb, 0); }
      fset(w, f, 0, 1, D - 2, BID.chest, lface(f, 2));
      { const x = fwx(f, 0, D - 2), z = fwz(f, 0, D - 2); w.ent(x, f.oy + 1, z, { type: 'chest', loot: hash3(x, f.oy, z, salt), table: 'stronghold_library' }); }
      for (let lz = 2; lz < D - 2; lz += 5) { fset(w, f, 0, 1, lz, BID.oak_fence, 0); fset(w, f, 0, 2, lz, BID.oak_fence, 0); fset(w, f, 0, 3, lz, BID.torch, 0); }
      continue;
    }
    if (p.kind === 'portal') {
      // the End portal room: a lava pool under a ring of twelve frames, stairs up to it with a silverfish spawner
      shell(L0, 0, 0, L1, H - 1, D - 1);
      openEnd(0, 1);
      for (let lz = 2; lz < D - 1; lz += 2) for (const ly of [3, 4]) { fset(w, f, L0, ly, lz, BID.iron_bars, 0); fset(w, f, L1, ly, lz, BID.iron_bars, 0); }
      for (let lz = 8; lz <= 14; lz++) for (let lx = -4; lx <= 4; lx++) { fset(w, f, lx, 1, lz, BID.lava, 0); for (let ly = 2; ly < H - 1; ly++) fset(w, f, lx, ly, lz, 0, 0); }
      for (let lz = 4; lz <= 7; lz++) for (let lx = -2; lx <= 2; lx++) { const h = Math.min(3, lz - 3); for (let ly = 1; ly < h; ly++) fset(w, f, lx, ly, lz, stoneAt(lx, ly, lz), 0); fset(w, f, lx, h, lz, BID.stone_brick_stairs, SM_STAIR[lface(f, 0)]); }
      for (let lz = 8; lz <= 14; lz++) for (let lx = -3; lx <= 3; lx++) if (Math.abs(lx) === 3 || lz === 8 || lz === 14) { fset(w, f, lx, 1, lz, stoneAt(lx, 1, lz), 0); fset(w, f, lx, 2, lz, stoneAt(lx, 2, lz), 0); }
      // twelve frames at height 3 around the 3x3 portal (lz 10..12, lx -1..1); facing = towards the portal centre
      const eyes = [];
      const frame = (lx, lz, inward) => { const eye = r() < 0.1; eyes.push(eye); fset(w, f, lx, 2, lz, stoneAt(lx, 2, lz), 0); fset(w, f, lx, 3, lz, BID.end_portal_frame, ({ 3: 0, 4: 1, 2: 2, 5: 3 })[lface(f, inward)] | (eye ? 4 : 0)); };
      for (let lx = -1; lx <= 1; lx++) { frame(lx, 9, 0); frame(lx, 13, 2); }
      for (let lz = 10; lz <= 12; lz++) { frame(-2, lz, 1); frame(2, lz, 3); }
      for (let lz = 10; lz <= 12; lz++) for (let lx = -1; lx <= 1; lx++) { fset(w, f, lx, 3, lz, eyes.every(e => e) ? BID.end_portal : 0, 0); fset(w, f, lx, 2, lz, BID.lava, 0); }
      fset(w, f, 0, 4, 6, BID.spawner, 0);
      { const x = fwx(f, 0, 6), z = fwz(f, 0, 6); w.ent(x, f.oy + 4, z, { type: 'spawner', mob: 'silverfish' }); }
      continue;
    }
  }
}
function strongholdsNear(seed, cx, cz) {
  const out = [];
  for (const s of strongholdPositions(seed)) { if (Math.abs((s.x >> 4) - cx) > 8 || Math.abs((s.z >> 4) - cz) > 8) continue; out.push(strongholdLayout(seed, s.x, s.z)); }
  return out;
}
function strongholdAt(seed, x, y, z) {
  for (const S of strongholdsNear(seed, x >> 4, z >> 4)) for (const p of S.pieces) if (x >= p.rect[0] && x <= p.rect[2] && z >= p.rect[1] && z <= p.rect[3] && y >= p.y0 && y <= p.y1) return S;
  return null;
}

// ======================================================================================= nether fortresses
const FREG = 24;
function fortressCandidate(seed, rx, rz) {
  const r = mulberry32(hash3(rx, rz, 30084232, seed | 0));
  if (r() > 0.55) return null;
  const cx = rx * FREG + 3 + (r() * (FREG - 8) | 0), cz = rz * FREG + 3 + (r() * (FREG - 8) | 0);
  return { x: cx * 16 + 8, z: cz * 16 + 8, seed: hash3(cx, cz, 4512, seed | 0) };
}
// piece extents in a frame (origin = entrance centre on the deck): [left, right, depth, top]
const FT_SIZE = { bridge: [2, 2, 0, 4], crossing: [3, 3, 7, 4], blaze: [3, 3, 9, 6], corridor: [2, 2, 0, 4], turn: [2, 2, 5, 4], cross: [2, 2, 5, 4], wart: [6, 6, 13, 6], chest: [3, 2, 5, 4] };
function fortressLayout(seed, rx, rz) {
  return scached('ft' + seed + ':' + rx + ':' + rz, () => {
    const c = fortressCandidate(seed, rx, rz); if (!c) return null;
    const r = mulberry32(c.seed), pieces = [], deck = 58 + (r() * 12 | 0);
    const mk = (kind, f, len) => { const s = FT_SIZE[kind], D = len || s[2]; return { kind, fr: f, D, rect: fRect(f, -s[0], 0, s[1], D - 1), y0: f.oy - 1, y1: f.oy + s[3] }; };
    const overlaps = p => { for (const q of pieces) if (rectsHit([p.rect[0] + 1, p.rect[1] + 1, p.rect[2] - 1, p.rect[3] - 1], q.rect) && p.y0 <= q.y1 && p.y1 >= q.y0) return true; return false; };
    const exitsOf = p => {
      const f = p.fr, d = p.D, out = [];
      if (p.kind === 'bridge' || p.kind === 'corridor' || p.kind === 'chest') out.push(frm(fwx(f, 0, d), f.oy, fwz(f, 0, d), f.dir));
      if (p.kind === 'crossing') { out.push(frm(fwx(f, 0, d), f.oy, fwz(f, 0, d), f.dir)); out.push(frm(fwx(f, -4, 3), f.oy, fwz(f, -4, 3), (f.dir + 3) & 3)); out.push(frm(fwx(f, 4, 3), f.oy, fwz(f, 4, 3), (f.dir + 1) & 3)); }
      if (p.kind === 'turn') out.push(p.left ? frm(fwx(f, -3, 2), f.oy, fwz(f, -3, 2), (f.dir + 3) & 3) : frm(fwx(f, 3, 2), f.oy, fwz(f, 3, 2), (f.dir + 1) & 3));
      if (p.kind === 'cross') { out.push(frm(fwx(f, 0, d), f.oy, fwz(f, 0, d), f.dir)); out.push(frm(fwx(f, -3, 2), f.oy, fwz(f, -3, 2), (f.dir + 3) & 3)); out.push(frm(fwx(f, 3, 2), f.oy, fwz(f, 3, 2), (f.dir + 1) & 3)); }
      return out;
    };
    const start = mk('crossing', frm(c.x, deck, c.z - 3, 0)); pieces.push(start);
    const queue = [];
    for (const nf of exitsOf(start)) queue.push({ f: nf, depth: 1, from: 'crossing' });
    queue.push({ f: frm(c.x, deck, c.z - 4, 2), depth: 1, from: 'crossing' });
    let blaze = 0, wart = 0, guard = 0;
    while (queue.length && pieces.length < 44 && guard++ < 260) {
      const e = queue.shift();
      const inside = e.from === 'corridor' || e.from === 'turn' || e.from === 'cross' || e.from === 'chest';
      let kind;
      if (e.from === 'bridge') { const t = r(); kind = t < 0.42 ? 'crossing' : t < 0.62 && blaze < 3 ? 'blaze' : 'corridor'; }
      else if (inside) { const t = r(); kind = t < 0.38 ? 'corridor' : t < 0.58 ? 'turn' : t < 0.72 ? 'cross' : t < 0.84 && wart < 2 ? 'wart' : t < 0.94 ? 'chest' : 'corridor'; }
      else kind = 'bridge';
      if (e.depth > 7) kind = inside ? 'chest' : 'blaze';
      const len = kind === 'bridge' ? 11 + (r() * 3 | 0) * 4 : kind === 'corridor' ? 5 + (r() * 3 | 0) * 2 : 0;
      const p = mk(kind, e.f, len);
      if (kind === 'turn') p.left = r() < 0.5;
      if (overlaps(p) || Math.abs(fwx(e.f, 0, 0) - c.x) > 92 || Math.abs(fwz(e.f, 0, 0) - c.z) > 92) continue;
      p.seed = r() * 1e9 | 0; pieces.push(p);
      if (kind === 'blaze') blaze++; if (kind === 'wart') wart++;
      if (kind !== 'blaze' && kind !== 'wart') for (const nf of exitsOf(p)) queue.push({ f: nf, depth: e.depth + 1, from: kind });
    }
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const p of pieces) { x0 = Math.min(x0, p.rect[0]); z0 = Math.min(z0, p.rect[1]); x1 = Math.max(x1, p.rect[2]); z1 = Math.max(z1, p.rect[3]); }
    return { x: c.x, z: c.z, deck, pieces, bbox: [x0, z0, x1, z1] };
  });
}
function drawFortress(w, F) {
  const NB = BID.nether_bricks, NF = BID.nether_brick_fence, NS = BID.nether_brick_stairs, LAVA = BID.lava;
  const support = (x, y, z) => { if (!w.inChunk(x, z)) return; for (let yy = y, n = 0; yy > 1 && n < 70; yy--, n++) { const cur = w.get(x, yy, z); if (cur !== 0 && cur !== LAVA && !T_REPL[cur]) break; w.set(x, yy, z, NB, 0); } };
  for (const p of F.pieces) {
    if (!w.hits([p.rect[0] - 1, p.rect[1] - 1, p.rect[2] + 1, p.rect[3] + 1])) continue;
    const f = p.fr, s = FT_SIZE[p.kind], L0 = -s[0], L1 = s[1], D = p.D, r = mulberry32(p.seed);
    if (p.kind === 'bridge') {
      for (let lz = 0; lz < D; lz++) {
        for (let lx = L0; lx <= L1; lx++) { fset(w, f, lx, 0, lz, NB, 0); for (let ly = 1; ly <= 4; ly++) fset(w, f, lx, ly, lz, 0, 0); }
        fset(w, f, L0, 1, lz, NF, 0); fset(w, f, L1, 1, lz, NF, 0);
        if (lz % 6 === 3) {   // arch with two pillars down to the ground / lava floor
          for (let lx = L0; lx <= L1; lx++) fset(w, f, lx, -1, lz, NB, 0);
          fset(w, f, L0 + 1, -2, lz, NB, 0); fset(w, f, L1 - 1, -2, lz, NB, 0);
          support(fwx(f, L0, lz), f.oy - 1, fwz(f, L0, lz)); support(fwx(f, L1, lz), f.oy - 1, fwz(f, L1, lz));
        }
      }
      continue;
    }
    if (p.kind === 'crossing') {
      for (let lz = 0; lz < 7; lz++) for (let lx = -3; lx <= 3; lx++) {
        fset(w, f, lx, 0, lz, NB, 0); for (let ly = 1; ly <= 4; ly++) fset(w, f, lx, ly, lz, 0, 0);
        const edge = Math.abs(lx) === 3 || lz === 0 || lz === 6, gap = (Math.abs(lx) <= 1 && (lz === 0 || lz === 6)) || ((lz >= 2 && lz <= 4) && Math.abs(lx) === 3);
        if (edge && !gap) fset(w, f, lx, 1, lz, NF, 0);
      }
      for (const [lx, lz] of [[-3, 0], [3, 0], [-3, 6], [3, 6]]) { fset(w, f, lx, 1, lz, NB, 0); fset(w, f, lx, 2, lz, NB, 0); support(fwx(f, lx, lz), f.oy - 1, fwz(f, lx, lz)); }
      continue;
    }
    if (p.kind === 'blaze') {
      for (let lz = 0; lz < 9; lz++) for (let lx = -3; lx <= 3; lx++) { fset(w, f, lx, 0, lz, NB, 0); for (let ly = 1; ly <= 6; ly++) fset(w, f, lx, ly, lz, 0, 0); if ((Math.abs(lx) === 3 || lz === 8) && !(lz <= 1 && Math.abs(lx) <= 1)) fset(w, f, lx, 1, lz, NF, 0); }
      for (let k = 0; k < 3; k++) for (let lx = -1; lx <= 1; lx++) { for (let ly = 1; ly <= k; ly++) fset(w, f, lx, ly, 2 + k, NB, 0); fset(w, f, lx, k + 1, 2 + k, NS, SM_STAIR[lface(f, 0)]); }
      for (let lz = 5; lz <= 7; lz++) for (let lx = -2; lx <= 2; lx++) { for (let ly = 1; ly <= 3; ly++) fset(w, f, lx, ly, lz, NB, 0); if (Math.abs(lx) === 2 || lz === 7) fset(w, f, lx, 4, lz, NF, 0); }
      fset(w, f, 0, 4, 6, BID.spawner, 0);
      { const x = fwx(f, 0, 6), z = fwz(f, 0, 6); w.ent(x, f.oy + 4, z, { type: 'spawner', mob: 'blaze' }); }
      for (const [lx, lz] of [[-3, 0], [3, 0], [-3, 8], [3, 8]]) support(fwx(f, lx, lz), f.oy - 1, fwz(f, lx, lz));
      continue;
    }
    // enclosed pieces: corridor, turn, cross, chest, wart
    const encl = (lx0, lz0, lx1, lz1, H) => {
      for (let lz = lz0; lz <= lz1; lz++) for (let lx = lx0; lx <= lx1; lx++) for (let ly = 0; ly <= H; ly++) {
        const edge = lx === lx0 || lx === lx1 || ly === 0 || ly === H || lz === lz0 || lz === lz1;
        fset(w, f, lx, ly, lz, edge ? NB : 0, 0);
      }
    };
    const openEnd = (lz) => { for (let a = -1; a <= 1; a++) for (let ly = 1; ly <= 3; ly++) fset(w, f, a, ly, lz, 0, 0); };
    if (p.kind === 'corridor' || p.kind === 'chest') {
      encl(L0, 0, L1, D - 1, 4); openEnd(0); openEnd(D - 1);
      for (let lz = 1; lz < D - 1; lz += 2) { fset(w, f, L0, 2, lz, NF, 0); fset(w, f, L1, 2, lz, NF, 0); }
      if (p.kind === 'chest') { fset(w, f, L0 + 1, 1, 2, BID.chest, lface(f, 1)); const x = fwx(f, L0 + 1, 2), z = fwz(f, L0 + 1, 2); w.ent(x, f.oy + 1, z, { type: 'chest', loot: hash3(x, f.oy, z, p.seed), table: 'fortress' }); }
      support(fwx(f, L0, 0), f.oy - 1, fwz(f, L0, 0)); support(fwx(f, L1, D - 1), f.oy - 1, fwz(f, L1, D - 1));
      continue;
    }
    if (p.kind === 'turn' || p.kind === 'cross') {
      encl(-2, 0, 2, 4, 4); openEnd(0);
      const openSide = (side) => { for (let lz = 1; lz <= 3; lz++) for (let ly = 1; ly <= 3; ly++) fset(w, f, side * 2, ly, lz, 0, 0); };
      if (p.kind === 'turn') openSide(p.left ? -1 : 1);
      else { openSide(-1); openSide(1); openEnd(4); }
      support(fwx(f, -2, 0), f.oy - 1, fwz(f, -2, 0)); support(fwx(f, 2, 4), f.oy - 1, fwz(f, 2, 4));
      continue;
    }
    if (p.kind === 'wart') {
      encl(-6, 0, 6, 12, 6); openEnd(0);
      for (const lx0 of [-5, 3]) for (let lz = 3; lz <= 10; lz++) for (let lx = lx0; lx <= lx0 + 2; lx++) { fset(w, f, lx, 1, lz, BID.soul_sand, 0); fset(w, f, lx, 2, lz, BID.nether_wart, (r() * 4) | 0); }
      for (let lz = 2; lz <= 11; lz += 3) { fset(w, f, -6, 3, lz, NF, 0); fset(w, f, 6, 3, lz, NF, 0); }
      fset(w, f, 0, 1, 11, BID.chest, lface(f, 2));
      { const x = fwx(f, 0, 11), z = fwz(f, 0, 11); w.ent(x, f.oy + 1, z, { type: 'chest', loot: hash3(x, f.oy, z, p.seed), table: 'fortress' }); }
      for (const [lx, lz] of [[-6, 0], [6, 0], [-6, 12], [6, 12]]) support(fwx(f, lx, lz), f.oy - 1, fwz(f, lx, lz));
    }
  }
}
function fortressesNear(seed, cx, cz) {
  const out = [], rx = Math.floor(cx / FREG), rz = Math.floor(cz / FREG);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const F = fortressLayout(seed, rx + dx, rz + dz); if (F) out.push(F); }
  return out;
}
// is (x,y,z) inside a fortress piece? (mob spawning)
function fortressAt(seed, x, y, z) {
  for (const F of fortressesNear(seed, x >> 4, z >> 4)) {
    if (x < F.bbox[0] || x > F.bbox[2] || z < F.bbox[1] || z > F.bbox[3]) continue;
    for (const p of F.pieces) if (x >= p.rect[0] && x <= p.rect[2] && z >= p.rect[1] && z <= p.rect[3] && y >= p.y0 - 2 && y <= p.y1 + 2) return F;
  }
  return null;
}

// ======================================================================================= per-chunk application
function applyOverworldStructures(seed, cx, cz, blocks, meta, be, spawns) {
  const w = SWriter(blocks, meta, cx, cz, be, spawns), rx = Math.floor(cx / VREG), rz = Math.floor(cz / VREG);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const V = villageAt(seed, rx + dx, rz + dz);
    if (V && w.hits(V.bbox)) drawVillage(w, V, seed);
  }
  for (const S of strongholdsNear(seed, cx, cz)) if (w.hits([S.bbox[0] - 2, S.bbox[1] - 2, S.bbox[2] + 2, S.bbox[3] + 2])) drawStronghold(w, S);
}
function applyNetherStructures(seed, cx, cz, blocks, meta, be, spawns) {
  const w = SWriter(blocks, meta, cx, cz, be, spawns);
  for (const F of fortressesNear(seed, cx, cz)) if (w.hits([F.bbox[0] - 2, F.bbox[1] - 2, F.bbox[2] + 2, F.bbox[3] + 2])) drawFortress(w, F);
}
function applyEndStructures(seed, cx, cz, blocks, meta, be, spawns) { /* end cities: reserved */ }

// nearest structure of a kind to (x,z): {x, z, y} or null (searches up to maxR chunks)
function locateStructure(seed, kind, x, z, maxR) {
  maxR = maxR || 200;
  if (kind === 'stronghold') {
    let best = null, bd = 1e18; for (const s of strongholdPositions(seed)) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    return best ? { x: best.x, z: best.z, y: 30 } : null;
  }
  const REG = kind === 'village' ? VREG : FREG, crx = Math.floor((x >> 4) / REG), crz = Math.floor((z >> 4) / REG), RR = Math.ceil(maxR / REG);
  let best = null, bd = 1e18;
  for (let ring = 0; ring <= RR; ring++) {
    for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
      const S = kind === 'village' ? villageAt(seed, crx + dx, crz + dz) : fortressLayout(seed, crx + dx, crz + dz);
      if (!S) continue;
      const d = (S.x - x) ** 2 + (S.z - z) ** 2; if (d < bd) { bd = d; best = S; }
    }
    if (best && ring >= 1 && Math.sqrt(bd) < (ring - 0.5) * REG * 16) break;
  }
  return best ? { x: best.x, z: best.z, y: kind === 'fortress' ? best.deck : best.y } : null;
}
