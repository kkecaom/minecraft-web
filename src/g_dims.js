// ===== g_dims.js : the Nether and the End - dimension travel, nether portals, end portals, eyes of ender, gateways, credits =====
const DIM_NAME = { overworld: 'Overworld', nether: 'The Nether', end: 'The End' };
const END_SPAWN = { x: 100, y: 50, z: 0 };            // ServerLevel.END_SPAWN_POINT: obsidian platform one below

// ---------------------------------------------------------------- eye of ender (EyeOfEnder entity)
class EyeOfEnder extends Entity {
  constructor(game, x, y, z, tx, tz) {
    super(game, x, y, z, 0.25, 0.25);
    const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
    if (d > 12) { this.tx = x + dx / d * 12; this.tz = z + dz / d * 12; this.ty = y + 8; } else { this.tx = tx; this.tz = tz; this.ty = y; }
    this.life = 0; this.survive = Math.random() < 0.8;
  }
  tick() {
    this.savePrev(); this.age++;
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    const d0 = this.tx - this.x, d1 = this.tz - this.z, f = Math.hypot(d0, d1), a = Math.atan2(d1, d0);
    let hs = Math.hypot(this.vx, this.vz); hs = hs + (f - hs) * 0.0025;
    let vy = this.vy; if (f < 1) { hs *= 0.8; vy *= 0.8; }
    const j = this.y < this.ty ? 1 : -1;
    this.vx = Math.cos(a) * hs; this.vz = Math.sin(a) * hs; this.vy = vy + (j - vy) * 0.015;
    const P = this.game.particles;
    for (let i = 0; i < 4; i++) P.sprite('portal', this.x - this.vx * i / 4, this.y - this.vy * i / 4, this.z - this.vz * i / 4, 1, { size: 0.06, up: 0, vel: 0.05, life: 20, shrink: true, spread: 0.3, spreadY: 0.3, r: 0.8, g: 0.35, b: 0.95 });
    if (++this.life > 80) {
      this.dead = true; this.game.sound('entity.ender_eye.death', this.x, this.y, this.z, 1, 1, 'random.glass');
      if (this.survive) this.game.spawnItem(this.x, this.y, this.z, newStack(IID.ender_eye, 1), [0, 0.1, 0]);
      else for (let i = 0; i < 20; i++) P.sprite('portal', this.x, this.y, this.z, 1, { size: 0.08, up: 0.05, vel: 0.2, life: 18, shrink: true, spread: 0.2, spreadY: 0.2, r: 0.3, g: 0.75, b: 0.45 });
    }
  }
  renderSelf(game, partial, x, y, z) {
    const r = game.renderer, M = game._eyem || (game._eyem = m4()), MV = game._eyemv || (game._eyemv = m4());
    m4Compose(M, x, y, z, 0, r.cam.yaw, 0, 0.35, 0.35, 0.35); m4Mul(MV, r.view, M);
    r.drawMesh(r.itemMesh(IID.ender_eye), MV, r.proj, 1, 1, 0.1);
  }
}

Object.assign(Game.prototype, {
  // ================================================================ one World per dimension, saved under its own key
  dimStoreId(rec, dim) { return dim === 'overworld' ? rec.id : rec.id + '~' + dim; },
  async makeWorld(rec, dim) {
    const sid = this.dimStoreId(rec, dim), saved = await this.store.chunkKeys(sid);
    const medoh = rec.preset === 'medoh' && dim === 'overworld';   // the Divine Beast spans 230 blocks: keep enough of it in view
    const w = new World({ seed: rec.seed, dim, tileIndex: this.renderer.TILE, viewDist: medoh ? Math.max(this.options.renderDistance, 16) : this.options.renderDistance, store: this.store.bind(sid), savedKeys: saved, preset: medoh ? 'medoh' : null });
    w.renderer = this.renderer; w.game = this; w.seedName = rec.seedStr;
    this.renderer.cloudY = medoh ? 247 : 176;
    return w;
  },
  // tamed wolves stay in the dimension they were left in
  savePets() {
    const rec = this.worldInfo; if (!rec) return;
    const here = this.entities.filter(e => e.isMob && e.tamed && !e.dead && !(e.deathTime > 0)).map(e => ({ type: e.type, x: e.x, y: e.y, z: e.z, hp: e.hp, sitting: !!e.sitting, collar: e.collarColor, dim: this.dim }));
    rec.pets = (rec.pets || []).filter(q => (q.dim || 'overworld') !== this.dim).concat(here);
  },
  dropWorld() {
    const w = this.world; if (!w) return;
    this.savePets(); this.captureAllEntities(true); w.saveAll();
    for (const c of Array.from(w.chunks.values())) { c.unloaded = true; this.renderer.freeChunk(c); }
    w.pool.terminate(); this.world = null;
  },

  // ================================================================ persistent mobs (villagers, golems) live in the chunk they stand in
  serializeMob(e) {
    const d = { t: e.type, x: Math.round(e.x * 100) / 100, y: Math.round(e.y * 100) / 100, z: Math.round(e.z * 100) / 100, yaw: Math.round((e.bodyYaw || 0) * 100) / 100, hp: e.hp };
    if (e.saveData) Object.assign(d, e.saveData());
    return d;
  },
  captureChunkEntities(c, remove, list) {
    if (!list) { list = []; for (const e of this.entities) if (e.isMob && !e.dead && !(e.deathTime > 0) && e.persist && e.def.chunkSave && (Math.floor(e.x) >> 4) === c.cx && (Math.floor(e.z) >> 4) === c.cz) list.push(e); }
    if (list.length || c.entsStored) {
      c.ents = list.length ? list.map(e => this.serializeMob(e)) : null; c.entsStored = list.length > 0; c.modified = true;
    }
    if (remove) for (const e of list) e.dead = true;
  },
  captureAllEntities(remove) {
    const w = this.world; if (!w) return;
    const by = new Map();
    for (const e of this.entities) {
      if (!e.isMob || e.dead || e.deathTime > 0 || !e.persist || !e.def.chunkSave) continue;
      const k = ckey(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4); let a = by.get(k); if (!a) by.set(k, a = []); a.push(e);
    }
    for (const c of w.chunks.values()) if (c.blocks && c.state >= 2) this.captureChunkEntities(c, remove, by.get(ckey(c.cx, c.cz)) || []);
  },
  restoreChunkEntities(c) {
    for (const d of c.ents) {
      if (!MOB_DEFS[d.t]) continue;
      const m = this.spawnMob(d.t, d.x, d.y, d.z); m.persist = true;
      m.bodyYaw = m.pbodyYaw = m.yaw = d.yaw || 0; if (d.hp > 0) m.hp = d.hp;
      if (m.loadData) m.loadData(d);
    }
    c.ents = null; c.entsStored = true;
  },

  // ================================================================ dimension change
  async changeDimension(to, arrival) {
    if (this.dimChanging || !this.world || !this.worldInfo) return;
    this.dimChanging = true;
    const p = this.player, rec = this.worldInfo, from = this.dim;
    try {
      if (this.screen && this.screen.onClose) this.screen.onClose(true);
      this.screen = null; this.breaking = null; p.portalTime = 0; p.portalSpin = p.pPortalSpin = 0; p.sleeping = false;
      this.stopLoops(); this.gatewayArrival = null; this.respawnSeq = null;
      this.dropWorld();
      this.entities = []; this.particles.list.length = 0; this.bolts = [];
      this.dim = to; rec.dim = to; this.state = 'loading'; this.paused = true;
      const w = await this.makeWorld(rec, to);
      this.world = w; p.world = w;
      p.x = p.px = arrival.x; p.y = p.py = arrival.y; p.z = p.pz = arrival.z; p.vx = p.vy = p.vz = 0; p.fallDist = 0; p.flying = p.flying && p.gameMode === 1;
      if (arrival.yaw !== undefined) p.yaw = p.pyaw = arrival.yaw;
      this.arrival = arrival; this.arrival.from = from; this.loadStart = now();
      this.loadingText = to === 'nether' ? 'Entering the Nether' : to === 'end' ? 'Entering the End' : from === 'end' ? 'Leaving the End' : 'Leaving the Nether';
      this.openScreen(new LoadingScreen(this));
      this.stat('dim_' + to);
    } finally { this.dimChanging = false; }
  },
  // called by finishLoading once the terrain around the player exists
  completeArrival() {
    const a = this.arrival, p = this.player; this.arrival = null; if (!a) return;
    if (a.kind === 'nether_portal') this.arriveByPortal(a);
    else if (a.kind === 'end_platform') this.makeEndPlatform();
    else if (a.kind === 'respawn') { const sp = p.spawn || this.spawnPoint; p.x = sp.x; p.z = sp.z; p.y = this.safeSpawnY(sp); }
    else if (a.kind === 'command') this.arriveSafely(p.x, p.y, p.z);
    p.savePrev(); p.portalCd = 10; p.fallDist = 0;
    this.sound('portal.travel', undefined, 0, 0, 0.25, 0.8 + Math.random() * 0.4);
  },
  onDimensionReady() {
    if (this.dim === 'end') this.setupEndFight();
    this.musicT = Math.min(this.musicT, 200);
  },
  // the respawn height used by beds / world spawn (keeps the old height when there is room)
  safeSpawnY(sp) {
    const w = this.world, bx = Math.floor(sp.x), bz = Math.floor(sp.z); let y = sp.y;
    if (w.isLoaded(bx, bz)) {
      let yy = Math.max(1, Math.floor(sp.y)); const y0 = yy;
      while (yy < 250 && (T_SOLID[w.getBlock(bx, yy, bz)] || T_SOLID[w.getBlock(bx, yy + 1, bz)])) yy++;
      while (yy > 1 && !T_SOLID[w.getBlock(bx, yy - 1, bz)]) yy--;
      if (yy - y0 <= 24 && yy < 250) y = yy;
      else for (let sy2 = 250; sy2 > 0; sy2--) { const b = w.getBlock(bx, sy2, bz); if (b && T_SOLID[b] && !BLOCKS[b].leaves) { y = sy2 + 1; break; } }
    }
    return y;
  },
  // /dimension: stand on the nearest solid floor with headroom, or on a little obsidian platform
  arriveSafely(x, y, z) {
    const w = this.world, p = this.player, bx = Math.floor(x), bz = Math.floor(z), top = this.dim === 'nether' ? 120 : 250;
    for (let r = 0; r <= 8; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (let yy = top; yy > 2; yy--) {
        const b = w.getBlock(bx + dx, yy - 1, bz + dz);
        if (T_SOLID[b] && !T_FLUID[b] && b !== BID.bedrock && !w.getBlock(bx + dx, yy, bz + dz) && !w.getBlock(bx + dx, yy + 1, bz + dz)) { p.x = bx + dx + 0.5; p.y = yy; p.z = bz + dz + 0.5; return; }
      }
    }
    const py = clamp(Math.floor(y), 40, top - 4);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { w.setBlock(bx + dx, py - 1, bz + dz, BID.obsidian, 0); for (let k = 0; k < 3; k++) w.setBlock(bx + dx, py + k, bz + dz, 0, 0); }
    p.x = bx + 0.5; p.y = py; p.z = bz + 0.5;
  },

  // ================================================================ nether portals (PortalShape)
  portalEmpty(b) { return b === 0 || b === BID.fire || b === BID.soul_fire || b === BID.nether_portal; },
  // the frame around (x,y,z) on one axis (0 = along x, 1 = along z), or null
  portalShapeAt(x, y, z, axis) {
    const w = this.world, O = BID.obsidian, dx = axis === 0 ? 1 : 0, dz = axis === 0 ? 0 : 1, E = b => this.portalEmpty(b), g = (a, b, c) => w.getBlock(a, b, c);
    let by = y; const ymin = Math.max(1, y - 21);
    while (by > ymin && E(g(x, by - 1, z))) by--;
    // distance to the frame edge, walking over an obsidian floor (getDistanceUntilEdgeAboveFrame)
    const edge = (sx, sz, ux, uz) => { for (let i = 0; i <= 21; i++) { const b = g(sx + ux * i, by, sz + uz * i); if (!E(b)) return b === O ? i : 0; if (g(sx + ux * i, by - 1, sz + uz * i) !== O) return 0; } return 0; };
    const left = edge(x, z, -dx, -dz) - 1; if (left < 0) return null;
    const lx = x - dx * left, lz = z - dz * left, wd = edge(lx, lz, dx, dz);
    if (wd < 2 || wd > 21) return null;
    let h = 0, filled = 0;
    up: for (; h < 21; h++) {
      const yy = by + h;
      if (g(lx - dx, yy, lz - dz) !== O || g(lx + dx * wd, yy, lz + dz * wd) !== O) break;
      for (let k = 0; k < wd; k++) { const b = g(lx + dx * k, yy, lz + dz * k); if (!E(b)) break up; if (b === BID.nether_portal) filled++; }
    }
    for (let k = 0; k < wd; k++) if (g(lx + dx * k, by + h, lz + dz * k) !== O) return null;
    if (h < 3 || h > 21) return null;
    return { x: lx, y: by, z: lz, axis, w: wd, h, filled };
  },
  findPortalShape(x, y, z) {
    for (const ax of [0, 1]) { const s = this.portalShapeAt(x, y, z, ax); if (s && s.filled === 0) return s; }
    return null;
  },
  fillPortal(s) {
    const w = this.world, dx = s.axis === 0 ? 1 : 0, dz = 1 - dx;
    for (let j = 0; j < s.h; j++) for (let k = 0; k < s.w; k++) w.setBlock(s.x + dx * k, s.y + j, s.z + dz * k, BID.nether_portal, s.axis, 2);
  },
  tryLightPortal(x, y, z) {
    if (this.dim === 'end' || this.lightingPortal || !this.world) return false;
    const s = this.findPortalShape(x, y, z); if (!s) return false;
    this.lightingPortal = true; try { this.fillPortal(s); } finally { this.lightingPortal = false; }
    this.registerPortal(this.dim, s.x, s.y, s.z, s.axis);
    this.stat('portal_lit');
    return true;
  },
  // portal registry (stands in for vanilla's point-of-interest search)
  registerPortal(dim, x, y, z, axis) {
    const rec = this.worldInfo; if (!rec || dim === 'end') return;
    const P = rec.portals || (rec.portals = { overworld: [], nether: [] }), L = P[dim] || (P[dim] = []);
    if (L.some(q => Math.abs(q[0] - x) <= 1 && Math.abs(q[1] - y) <= 1 && Math.abs(q[2] - z) <= 1)) return;
    L.push([x, y, z, axis | 0]);
  },
  unregisterPortal(dim, e) { const P = this.worldInfo.portals; if (P && P[dim]) P[dim] = P[dim].filter(q => q !== e && !(q[0] === e[0] && q[1] === e[1] && q[2] === e[2])); },
  findRegisteredPortal(dim, x, y, z) {
    const P = this.worldInfo.portals, L = P && P[dim]; if (!L) return null;
    const R = dim === 'nether' ? 16 : 128; let best = null, bd = 1e18;
    for (const q of L) { if (Math.abs(q[0] - x) > R || Math.abs(q[2] - z) > R) continue; const d = (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2; if (d < bd) { bd = d; best = q; } }
    return best;
  },
  // the whole portal containing a portal block near (x,y,z)
  portalAround(x, y, z) {
    const w = this.world;
    for (let r = 0; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
      const px = x + dx, py = y + dy, pz = z + dz; if (w.getBlock(px, py, pz) !== BID.nether_portal) continue;
      const axis = w.getMeta(px, py, pz) & 1, ux = axis === 0 ? 1 : 0, uz = 1 - ux;
      let bx = px, by = py, bz = pz;
      while (w.getBlock(bx, by - 1, bz) === BID.nether_portal) by--;
      while (w.getBlock(bx - ux, by, bz - uz) === BID.nether_portal) { bx -= ux; bz -= uz; }
      let wd = 0; while (wd < 22 && w.getBlock(bx + ux * wd, by, bz + uz * wd) === BID.nether_portal) wd++;
      let h = 0; while (h < 22 && w.getBlock(bx, by + h, bz) === BID.nether_portal) h++;
      return { x: bx, y: by, z: bz, axis, w: wd, h };
    }
    return null;
  },
  // PortalForcer.canHostFrame: a 4 wide x 5 tall slice with solid floor and replaceable space, shifted 'off' across the axis
  canHostFrame(x, y, z, axis, off) {
    const w = this.world, dX = axis === 0 ? 1 : 0, dZ = 1 - dX, pX = dZ, pZ = dX;
    for (let i = -1; i < 3; i++) for (let j = -1; j < 4; j++) {
      const b = w.getBlock(x + dX * i + pX * off, y + j, z + dZ * i + pZ * off);
      if (j < 0) { if (!T_SOLID[b] || T_FLUID[b]) return false; }
      else if (!(b === 0 || (T_REPL[b] === 1 && !T_FLUID[b]))) return false;
    }
    return true;
  },
  // PortalForcer.createPortal: the closest good spot within 16 blocks, else a platform floating at y 70+
  createPortalNear(tx, ty, tz, axis) {
    const w = this.world, top = this.dim === 'nether' ? 120 : 250, bottom = this.dim === 'nether' ? 6 : 2;
    let best = null, bestD = 1e18, part = null, partD = 1e18;
    for (let dx = -16; dx <= 16; dx++) for (let dz = -16; dz <= 16; dz++) {
      const x = tx + dx, z = tz + dz; if (!w.isLoaded(x, z)) continue;
      for (let y = top; y >= bottom; y--) {
        if (w.getBlock(x, y, z) !== 0) continue;
        const yTop = y; while (y > bottom && w.getBlock(x, y - 1, z) === 0) y--;
        if (yTop - y < 3 && yTop !== top) continue;
        const fb = w.getBlock(x, y - 1, z); if (!T_SOLID[fb] || T_FLUID[fb]) continue;
        const d = (x - tx) ** 2 + (y - ty) ** 2 + (z - tz) ** 2;
        for (const ax of [axis, 1 - axis]) {
          if (d < bestD && this.canHostFrame(x, y, z, ax, 0) && this.canHostFrame(x, y, z, ax, -1) && this.canHostFrame(x, y, z, ax, 1)) { best = [x, y, z, ax]; bestD = d; }
          else if (!best && d < partD && this.canHostFrame(x, y, z, ax, 0)) { part = [x, y, z, ax]; partD = d; }
        }
      }
    }
    let s = best || part;
    if (!s) {
      const y = clamp(ty, 70, top - 10), dX = axis === 0 ? 1 : 0, dZ = 1 - dX, pX = dZ, pZ = dX;
      for (let i = -1; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = -1; k < 3; k++) w.setBlock(tx + j * dX + i * pX, y + k, tz + j * dZ + i * pZ, k < 0 ? BID.obsidian : 0, 0, 2);
      s = [tx, y, tz, axis];
    }
    const [x, y, z, ax] = s, dX = ax === 0 ? 1 : 0, dZ = 1 - dX;
    for (let i = -1; i < 3; i++) for (let j = -1; j < 4; j++) if (i === -1 || i === 2 || j === -1 || j === 3) w.setBlock(x + dX * i, y + j, z + dZ * i, BID.obsidian, 0, 2);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) w.setBlock(x + dX * i, y + j, z + dZ * i, BID.nether_portal, ax, 2);
    this.registerPortal(this.dim, x, y, z, ax);
    return { x, y, z, axis: ax, w: 2, h: 3 };
  },
  netherPortalTravel() {
    const p = this.player, to = this.dim === 'nether' ? 'overworld' : 'nether', sc = to === 'nether' ? 0.125 : 8;
    const here = this.portalAround(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z));
    const tx = clamp(Math.floor(p.x * sc), -3749999, 3749999), tz = clamp(Math.floor(p.z * sc), -3749999, 3749999);
    const ty = to === 'nether' ? clamp(Math.floor(p.y), 32, 118) : clamp(Math.floor(p.y), 4, 240);
    const link = this.findRegisteredPortal(to, tx, ty, tz);
    const at = link || [tx, ty, tz];
    this.changeDimension(to, { kind: 'nether_portal', x: at[0] + 0.5, y: at[1], z: at[2] + 0.5, tx, ty, tz, link, axis: here ? here.axis : 0 });
  },
  arriveByPortal(a) {
    const p = this.player;
    let s = null;
    if (a.link) { s = this.portalAround(a.link[0], a.link[1], a.link[2]); if (!s) this.unregisterPortal(this.dim, a.link); }
    if (!s) s = this.createPortalNear(a.tx, a.ty, a.tz, a.axis);
    const ux = s.axis === 0 ? 1 : 0, uz = 1 - ux;
    p.x = s.x + ux * s.w / 2 + uz * 0.5; p.z = s.z + uz * s.w / 2 + ux * 0.5; p.y = s.y;
  },

  // ================================================================ per tick: portals the player stands in, gateway arrivals, End events
  portalTick() {
    const p = this.player, w = this.world; if (p.dead || this.dimChanging) return;
    const hw = p.w / 2 - 0.001;
    let kind = null, gx = 0, gy = 0, gz = 0;
    for (let y = Math.floor(p.y + 0.001); y <= Math.floor(p.y + p.h - 0.001) && !kind; y++) for (let z = Math.floor(p.z - hw); z <= Math.floor(p.z + hw) && !kind; z++) for (let x = Math.floor(p.x - hw); x <= Math.floor(p.x + hw); x++) {
      const d = BLOCKS[w.getBlock(x, y, z)];
      if (d.portal && (d.portal !== 'end' || p.y - y < 0.75)) { kind = d.portal; gx = x; gy = y; gz = z; break; }
    }
    p.pPortalSpin = p.portalSpin || 0;
    if (kind === 'end') { this.enterEndPortal(); return; }
    if (kind === 'gateway') { if (p.portalCd > 0) p.portalCd = 10; else this.enterGateway(gx, gy, gz); return; }
    if (kind === 'nether' && !(p.portalCd > 0)) {
      if (!(p.portalSpin > 0)) this.sound('portal.trigger', undefined, 0, 0, 0.25, 0.8 + Math.random() * 0.4);
      p.portalSpin = Math.min(1, (p.portalSpin || 0) + 0.0125);
      if (this.screen && !this.screen.passive && !this.screen.pausesGame) this.closeScreen();
      p.portalTime = (p.portalTime || 0) + 1;
      if (p.portalTime >= (p.gameMode === 1 ? 1 : 80)) { p.portalTime = 0; p.portalCd = 10; this.netherPortalTravel(); }
      return;
    }
    if (kind === 'nether') p.portalCd = 10; else if (p.portalCd > 0) p.portalCd--;
    if (p.portalTime > 0) p.portalTime = Math.max(0, p.portalTime - 4);
    if (p.portalSpin > 0) p.portalSpin = Math.max(0, p.portalSpin - 0.05);
  },
  // the player is frozen in the air while an end gateway destination loads
  holdPlayer() {
    const a = this.gatewayArrival; if (!a) return false;
    const w = this.world, cx = a.exit[0] >> 4, cz = a.exit[2] >> 4;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const c = w.getChunk(cx + dx, cz + dz); if (!c || c.state < 2) return true; }
    this.finishGatewayArrival(a); this.gatewayArrival = null;
    return false;
  },
  dimTick() {
    this.portalTick();
    if (this.dim === 'end') this.endTick();
  },

  // ================================================================ end portal frames, eyes of ender
  useEnderEye(s, t) {
    const p = this.player, w = this.world;
    if (t && t.id === BID.end_portal_frame && !(t.meta & 4)) {
      w.setBlock(t.x, t.y, t.z, BID.end_portal_frame, t.meta | 4, 8);
      this.sound('block.end_portal_frame.fill', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 1, 'random.click');
      for (let i = 0; i < 16; i++) this.particles.sprite('smoke', t.x + 0.2 + Math.random() * 0.6, t.y + 0.85, t.z + 0.2 + Math.random() * 0.6, 1, { size: 0.08, up: 0.01, life: 14, shrink: true, spread: 0, spreadY: 0, vel: 0.01, r: 0.3, g: 0.3, b: 0.3 });
      if (p.gameMode === 0) { s.n--; if (s.n <= 0) p.inv[p.sel] = null; }
      p.swingArm(); this.checkEndPortal(t.x, t.y, t.z);
      return;
    }
    if (t && t.id === BID.end_portal_frame) return;
    if (this.dim !== 'overworld') return;
    const loc = SH.locateStructure(w.seed, 'stronghold', p.x, p.z); if (!loc) return;
    const e = new EyeOfEnder(this, p.x, p.y + p.eyeH * 0.5 + 0.5, p.z, loc.x, loc.z); this.entities.push(e);
    this.sound('entity.ender_eye.launch', p.x, p.y, p.z, 0.5, 0.4 / (Math.random() * 0.4 + 0.8), 'random.bow');
    if (p.gameMode === 0) { s.n--; if (s.n <= 0) p.inv[p.sel] = null; }
    p.swingArm(); this.stat('eye_thrown');
  },
  // EndPortalFrameBlock.getOrCreatePortalShape: 12 frames with eyes, each facing the middle of a 3x3 hole
  checkEndPortal(x, y, z) {
    const w = this.world, F = BID.end_portal_frame;
    const faceTo = { 0: [0, 1], 1: [-1, 0], 2: [0, -1], 3: [1, 0] };    // meta & 3 -> the way the frame looks
    for (let cx = x - 4; cx <= x + 4; cx++) for (let cz = z - 4; cz <= z + 4; cz++) {
      let ok = true;
      for (let i = -1; i <= 1 && ok; i++) for (const [fx, fz, nx, nz] of [[i, -2, 0, 1], [i, 2, 0, -1], [-2, i, 1, 0], [2, i, -1, 0]]) {
        const b = w.getBlock(cx + fx, y, cz + fz), m = w.getMeta(cx + fx, y, cz + fz), f = faceTo[m & 3];
        if (b !== F || !(m & 4) || f[0] !== nx || f[1] !== nz) { ok = false; break; }
      }
      if (!ok) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.setBlock(cx + dx, y, cz + dz, BID.end_portal, 0, 8);
      this.sound('block.end_portal.spawn', cx + 0.5, y, cz + 0.5, 1, 1, 'random.explode');
      this.stat('end_portal_opened');
      return true;
    }
    return false;
  },
  enterEndPortal() {
    const rec = this.worldInfo;
    if (this.dimChanging || this.screen instanceof CreditsScreen) return;
    if (this.dim === 'end') {
      const E = rec.end || (rec.end = {});
      if (!E.seenCredits) { E.seenCredits = true; this.openScreen(new CreditsScreen(this)); return; }
      this.leaveEnd();
      return;
    }
    this.changeDimension('end', { kind: 'end_platform', x: END_SPAWN.x + 0.5, y: END_SPAWN.y, z: END_SPAWN.z + 0.5, yaw: Math.PI / 2 });
  },
  leaveEnd() { const p = this.player, sp = p.spawn || this.spawnPoint; this.changeDimension('overworld', { kind: 'respawn', x: sp.x, y: sp.y, z: sp.z }); },
  // ServerLevel.makeObsidianPlatform
  makeEndPlatform() {
    const w = this.world, p = this.player, X = END_SPAWN.x, Y = END_SPAWN.y, Z = END_SPAWN.z;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy < 3; dy++) w.setBlock(X + dx, Y + dy, Z + dz, dy === -1 ? BID.obsidian : 0, 0, 2);
    p.x = X + 0.5; p.y = Y; p.z = Z + 0.5; p.yaw = Math.PI / 2;
  },

  // ================================================================ end gateways (EndGatewayBlockEntity)
  endGatewayPlace(x, y, z, exit) {
    const w = this.world;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cX = dx === 0, cY = dy === 0, cZ = dz === 0, two = Math.abs(dy) === 2;
      let id = 0;
      if (cX && cY && cZ) id = BID.end_gateway;
      else if (cY) id = 0;
      else if (two && cX && cZ) id = BID.bedrock;
      else if ((cX || cZ) && !two) id = BID.bedrock;
      w.setBlock(x + dx, y + dy, z + dz, id, 0, 2);
    }
    const E = this.endState(); if (!E.gateways.some(g => g.x === x && g.y === y && g.z === z)) E.gateways.push({ x, y, z, exit: exit || null });
  },
  // the island edge ~1024 blocks out along the gateway's direction (uses the generator, so nothing needs to be loaded)
  gatewayExitFor(gx, gz) {
    const seed = this.world.seed, l = Math.hypot(gx, gz) || 1, ux = gx / l, uz = gz / l;
    const has = (x, z) => { for (const [ox, oz] of [[8, 8], [2, 2], [14, 2], [2, 14], [14, 14]]) if (SH.endTop(seed, (Math.floor(x) & ~15) + ox, (Math.floor(z) & ~15) + oz) > 0) return true; return false; };
    let x = ux * 1024, z = uz * 1024;
    for (let i = 16; has(x, z) && i-- > 0;) { x -= ux * 16; z -= uz * 16; }
    for (let j = 16; !has(x, z) && j-- > 0;) { x += ux * 16; z += uz * 16; }
    let best = null, bt = 0;
    const X0 = Math.floor(x) & ~15, Z0 = Math.floor(z) & ~15;
    for (let ox = 0; ox < 16; ox++) for (let oz = 0; oz < 16; oz++) { const t = SH.endTop(seed, X0 + ox, Z0 + oz); if (t > bt) { bt = t; best = [X0 + ox, t, Z0 + oz]; } }
    return best ? { x: best[0], y: best[1], z: best[2], island: true } : { x: Math.floor(x), y: 75, z: Math.floor(z), island: false };
  },
  enterGateway(gx, gy, gz) {
    const p = this.player, E = this.endState();
    let g = E.gateways.find(q => q.x === gx && q.y === gy && q.z === gz);
    if (!g) { g = { x: gx, y: gy, z: gz, exit: null }; E.gateways.push(g); }
    p.portalCd = 10;
    this.sound('block.end_gateway.spawn', gx + 0.5, gy + 0.5, gz + 0.5, 0.5, 1.4, 'portal.travel');
    let build = false, island = true;
    if (!g.exit) { const ex = this.gatewayExitFor(gx, gz); g.exit = [ex.x, ex.y + 10, ex.z]; build = true; island = ex.island; }
    this.gatewayArrival = { exit: g.exit, build, island, back: [gx, gy, gz] };
    p.x = p.px = g.exit[0] + 0.5; p.y = p.py = g.exit[1] + 2; p.z = p.pz = g.exit[2] + 0.5; p.vx = p.vy = p.vz = 0; p.fallDist = 0;
  },
  finishGatewayArrival(a) {
    const w = this.world, p = this.player, [ex, ey, ez] = a.exit;
    if (a.build) {
      if (!a.island) {   // EndIslandFeature: a small blob of end stone below the exit
        const r = mulberry32(hash3(ex, ez, 99, w.seed)); let f = 4 + ((r() * 3) | 0);
        for (let i = 0; f > 0.5; i--) { for (let dx = Math.floor(-f); dx <= Math.ceil(f); dx++) for (let dz = Math.floor(-f); dz <= Math.ceil(f); dz++) if (dx * dx + dz * dz <= (f + 1) * (f + 1)) w.setBlock(ex + dx, ey - 10 + i, ez + dz, BID.end_stone, 0, 2); f -= ((r() * 2) | 0) + 0.5; }
      }
      this.endGatewayPlace(ex, ey, ez, a.back);
    }
    // EndGatewayBlockEntity.findExitPosition: the tallest full block within 5 of the gateway, one above it
    let best = null;
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      if (dx === 0 && dz === 0) continue;
      for (let y = ey + 2; y > (best ? best[1] : 0); y--) { const b = w.getBlock(ex + dx, y, ez + dz); if (T_SOLID[b] && T_OPAQUE[b] && b !== BID.bedrock) { best = [ex + dx, y, ez + dz]; break; } }
    }
    if (best) { p.x = best[0] + 0.5; p.y = best[1] + 1; p.z = best[2] + 0.5; } else { p.y = ey + 1; }
    p.savePrev(); p.portalCd = 10; p.fallDist = 0;
  },

  // ================================================================ the End: crystals, dragon bookkeeping, gateway spawning
  endState() {
    const rec = this.worldInfo;
    if (!rec.end) rec.end = {};
    const E = rec.end;
    if (!E.gateways) E.gateways = [];
    if (!E.gatewayPool) { const r = mulberry32(hash3(rec.seed | 0, 7, 77, 777)), a = []; for (let i = 0; i < 20; i++) a.push(i); for (let i = 19; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } E.gatewayPool = a; }
    return E;
  },
  setupEndFight() {
    const E = this.endState();
    if (E.killed) return;
    const sp = SH.endSpikes(this.worldInfo.seed);
    if (!E.crystals) E.crystals = sp.map(() => 1);
    for (let i = 0; i < sp.length; i++) if (E.crystals[i] && !this.entities.some(e => e.type === 'end_crystal' && e.spike === i)) { const c = this.spawnMob('end_crystal', sp[i].x + 0.5, sp[i].h + 1, sp[i].z + 0.5); c.spike = i; c.showBottom = true; c.persist = true; }
    if (!this.entities.some(e => e.type === 'ender_dragon' && !e.dead)) { const d = this.spawnMob('ender_dragon', 0, 128, 0); d.persist = true; if (E.dragonHp > 0) d.hp = E.dragonHp; }
  },
  // EndDragonFight.setDragonKilled: open the exit portal, the egg on the first kill, one more gateway
  onDragonKilled(d) {
    const E = this.endState(), first = !E.everKilled;
    E.killed = true; E.everKilled = true; E.dragonHp = 0; E.crystals = E.crystals ? E.crystals.map(() => 0) : null;
    this.activateExitPortal(true);
    if (first) { const py = this.podiumY(); if (this.world.isLoaded(0, 0)) this.world.setBlock(0, py + 4, 0, BID.dragon_egg, 0, 8); }
    this.spawnNextGateway();
    this.stat('dragon_killed');
    this.addChat('§dThe Ender Dragon has been slain!');
  },
  // the pink boss bar (BossHealthOverlay) and the fight fog (BossEvent.createWorldFog)
  dragonFighting() { if (this.dim !== 'end') return null; const p = this.player; for (const e of this.entities) if (e.type === 'ender_dragon' && !e.dead && p.x * p.x + p.z * p.z < 192 * 192) return e; return null; },
  drawBossBar(ui) {
    const d = this.dragonFighting(); if (!d || this.hideHud) return;
    const W = ui.w, x = Math.round(W / 2 - 91), y = 12, g = ui.g, f = Math.max(0, d.hp) / d.maxHp, fill = Math.round(182 * f);
    ui.textC('Ender Dragon', W / 2, y - 9, '#ffffff');
    g.fillStyle = '#4a1238'; g.fillRect(x, y, 182, 5);
    g.fillStyle = '#e04ad0'; g.fillRect(x, y, fill, 5);
    g.fillStyle = '#ff9ff5'; g.fillRect(x, y, fill, 1);
    g.fillStyle = '#8a1a7c'; g.fillRect(x, y + 4, fill, 1);
    g.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 1; i < 6; i++) g.fillRect(x + Math.round(182 * i / 6), y + 1, 1, 3);
  },
  // EndDragonFight.spawnNewGateway: one more gateway on the 96-block ring each time the dragon dies
  spawnNextGateway() {
    const E = this.endState(); if (!E.gatewayPool.length) return;
    const i = E.gatewayPool.pop(), a = 2 * (-Math.PI + 0.15707963267948966 * i);
    const x = Math.floor(96 * Math.cos(a)), z = Math.floor(96 * Math.sin(a));
    this.endGatewayPlace(x, 75, z, null);
    this.sound('block.end_gateway.spawn', x + 0.5, 75, z + 0.5, 1, 1, 'random.explode');
    this.gatewayBeams = this.gatewayBeams || []; this.gatewayBeams.push({ x, y: 75, z, t: 0 });
  },
  podiumY() { return SH.endPodiumY(this.worldInfo.seed); },
  activateExitPortal(active) {
    const w = this.world, py = this.podiumY();
    SH.placeEndPodium(null, null, 0, 0, py, active, (x, y, z, id, m) => { if (w.isLoaded(x, z)) w.setBlock(x, y, z, id, m, 2); });
  },
  // four crystals on the exit portal's rim start a new fight (EndDragonFight.tryRespawn)
  tryRespawnDragon() {
    const E = this.endState(); if (!E.killed || this.respawnSeq) return;
    const py = this.podiumY(), spots = [[3, 0], [-3, 0], [0, 3], [0, -3]], found = [];
    for (const [sx, sz] of spots) { const c = this.entities.find(e => e.type === 'end_crystal' && !e.dead && Math.abs(e.x - sx - 0.5) < 1 && Math.abs(e.z - sz - 0.5) < 1 && Math.abs(e.y - py - 1) < 1.5); if (!c) return; found.push(c); }
    this.respawnSeq = { t: 0, crystals: found, spike: 0 };
    this.activateExitPortal(false);
  },
  endTick() {
    const E = this.endState();
    if (this.gatewayBeams) for (let i = this.gatewayBeams.length - 1; i >= 0; i--) if (++this.gatewayBeams[i].t > 40) this.gatewayBeams.splice(i, 1);
    const R = this.respawnSeq; if (!R) return;
    R.t++;
    const sp = SH.endSpikes(this.worldInfo.seed);
    // beams from the four crystals rise, then each spike is rebuilt in turn
    if (R.t > 100 && R.t % 30 === 0 && R.spike < sp.length) {
      const s = sp[R.spike], w = this.world;
      for (let dx = -s.r; dx <= s.r; dx++) for (let dz = -s.r; dz <= s.r; dz++) {
        if (dx * dx + dz * dz > s.r * s.r + 1 || !w.isLoaded(s.x + dx, s.z + dz)) continue;
        for (let y = 1; y < s.h + 10; y++) w.setBlock(s.x + dx, y, s.z + dz, y < s.h ? BID.obsidian : 0, 0, 2);
      }
      if (w.isLoaded(s.x, s.z)) {
        w.setBlock(s.x, s.h, s.z, BID.bedrock, 0, 2);
        if (s.guarded) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = s.h; y <= s.h + 3; y++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || y === s.h + 3) w.setBlock(s.x + dx, y, s.z + dz, BID.iron_bars, 0, 2);
      }
      this.addParticles('explosion', s.x + 0.5, s.h + 1, s.z + 0.5, 4); this.sound('random.explode', s.x + 0.5, s.h + 1, s.z + 0.5, 4, 0.8);
      const c = this.spawnMob('end_crystal', s.x + 0.5, s.h + 1, s.z + 0.5); c.spike = R.spike; c.showBottom = true; c.persist = true;
      R.spike++;
    }
    if (R.spike >= sp.length && R.t > 100 + 30 * sp.length + 40) {
      for (const c of R.crystals) if (!c.dead) { c.dead = true; this.addParticles('explosion', c.x, c.y + 1, c.z, 6); this.sound('random.explode', c.x, c.y, c.z, 4, 0.8); }
      E.killed = false; E.crystals = sp.map(() => 1); E.dragonHp = 200;
      const d = this.spawnMob('ender_dragon', 0, 128, 0); d.persist = true;
      this.respawnSeq = null;
    }
  },

  // ================================================================ natural spawning in the Nether and the End (biome spawn lists)
  spawnNether() {
    const w = this.world, p = this.player, seed = w.seed;
    if (this.difficulty === 0) return;
    let hostile = 0, striders = 0; for (const e of this.entities) if (e.isMob && !e.dead) { if (e.def.hostile || e.def.neutral) hostile++; if (e.type === 'strider') striders++; }
    // striders walk the lava seas
    if (striders < 6 && Math.random() < 0.25) {
      const a = Math.random() * TAU, d = 24 + Math.random() * 40, x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
      if (w.isLoaded(x, z)) for (let y = SH.NETHER_LAVA_Y + 2; y >= SH.NETHER_LAVA_Y - 2; y--) if (T_FLUID[w.getBlock(x, y, z)] === 2 && w.getBlock(x, y + 1, z) === 0 && w.getBlock(x, y + 2, z) === 0) { const n = 1 + (Math.random() < 0.5 ? 1 : 0); for (let i = 0; i < n; i++) this.spawnMob('strider', x + 0.5 + i * 0.6, y + 1, z + 0.5); break; }
    }
    if (hostile >= 30) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * TAU, d = 24 + Math.random() * 40, x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
      if (!w.isLoaded(x, z)) continue;
      let y = clamp(Math.floor(p.y) + ((Math.random() * 41) | 0) - 20, SH.NETHER_LAVA_Y + 1, 122);
      if (T_SOLID[w.getBlock(x, y, z)]) continue;
      let k = 0; while (k < 24 && y > 1 && !T_SOLID[w.getBlock(x, y - 1, z)] && !T_FLUID[w.getBlock(x, y - 1, z)]) { y--; k++; }
      const gb = w.getBlock(x, y - 1, z);
      if (!T_SOLID[gb] || T_FLUID[gb] || gb === BID.bedrock || w.getBlock(x, y, z) !== 0 || w.getBlock(x, y + 1, z) !== 0) continue;
      if (w.getBlk(x, y, z) > 11) continue;
      if ((x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2 < 24 * 24) continue;
      // fortresses keep their own list (on nether bricks inside the structure)
      let list;
      if (gb === BID.nether_bricks && SH.fortressAt(seed, x, y, z)) list = [['blaze', 10, 2, 3], ['zombified_piglin', 5, 2, 4], ['wither_skeleton', 8, 2, 5], ['skeleton', 2, 2, 5], ['magma_cube', 3, 2, 4]];
      else {
        const b = BIOMES[w.getBiome(x, z)].name;
        list = b === 'soul_sand_valley' ? [['skeleton', 20, 2, 5], ['ghast', 50, 1, 1], ['enderman', 1, 1, 4]]
          : b === 'crimson_forest' ? [['zombified_piglin', 1, 2, 4], ['hoglin', 9, 2, 4], ['piglin', 5, 2, 4]]
          : b === 'warped_forest' ? [['enderman', 1, 1, 4]]
          : b === 'basalt_deltas' ? [['ghast', 40, 1, 1], ['magma_cube', 100, 2, 5]]
          : [['ghast', 50, 1, 1], ['zombified_piglin', 100, 2, 4], ['magma_cube', 2, 1, 4], ['enderman', 1, 1, 4], ['piglin', 15, 2, 4]];
      }
      let tot = 0; for (const e of list) tot += e[1];
      let r = Math.random() * tot, pick = list[0]; for (const e of list) { r -= e[1]; if (r <= 0) { pick = e; break; } }
      const type = pick[0]; if (!MOB_DEFS[type]) continue;
      if (type === 'ghast') {   // needs a 5 block cube of air
        let free = true; for (let dx = -2; dx <= 2 && free; dx++) for (let dz = -2; dz <= 2 && free; dz++) for (let dy = 0; dy < 5; dy++) if (w.getBlock(x + dx, y + dy, z + dz) !== 0) { free = false; break; }
        if (!free) continue;
      }
      const n = pick[2] + ((Math.random() * (pick[3] - pick[2] + 1)) | 0);
      for (let i = 0; i < n; i++) {
        const sx = x + (i ? ((Math.random() * 5) | 0) - 2 : 0), sz = z + (i ? ((Math.random() * 5) | 0) - 2 : 0);
        if (!w.isLoaded(sx, sz) || w.getBlock(sx, y, sz) !== 0 || w.getBlock(sx, y + 1, sz) !== 0 || !T_SOLID[w.getBlock(sx, y - 1, sz)]) continue;
        const m = this.spawnMob(type, sx + 0.5, type === 'ghast' ? y + 1 : y, sz + 0.5);
        if (m.onNaturalSpawn) m.onNaturalSpawn();
      }
      break;
    }
  },
  spawnEnd() {
    const w = this.world, p = this.player;
    if (this.difficulty === 0) return;
    let n = 0; for (const e of this.entities) if (e.isMob && !e.dead && e.type === 'enderman') n++;
    if (n >= 24) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      const a = Math.random() * TAU, d = 24 + Math.random() * 40, x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
      if (!w.isLoaded(x, z)) continue;
      const y = w.topSolidY(x, z) + 1; if (y < 2) continue;
      if (w.getBlock(x, y - 1, z) !== BID.end_stone || w.getBlock(x, y, z) || w.getBlock(x, y + 1, z) || w.getBlock(x, y + 2, z) || w.getBlk(x, y, z) > 0) continue;
      const k = 1 + ((Math.random() * 4) | 0);
      for (let i = 0; i < k; i++) { const sx = x + ((Math.random() * 5) | 0) - 2, sz = z + ((Math.random() * 5) | 0) - 2; if (w.isLoaded(sx, sz) && w.getBlock(sx, y - 1, sz) === BID.end_stone && !w.getBlock(sx, y, sz) && !w.getBlock(sx, y + 1, sz) && !w.getBlock(sx, y + 2, sz)) this.spawnMob('enderman', sx + 0.5, y, sz + 0.5); }
      break;
    }
  },

  // ================================================================ rendering helpers: portal swirl overlay, the spin wobble, gateway / crystal beams
  drawPortalOverlay(ui, partial) {
    const p = this.player, a0 = (p.pPortalSpin || 0) + ((p.portalSpin || 0) - (p.pPortalSpin || 0)) * partial;
    if (a0 <= 0 || typeof TexBlocks === 'undefined' || !TexBlocks.animated || !TexBlocks.animated.nether_portal) return;
    if (!this._portalCanvases) this._portalCanvases = TexBlocks.animated.nether_portal.frames.map(f => { const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f), 16, 16), 0, 0); return c; });
    let a = a0; if (a < 1) { a *= a; a *= a; a = a * 0.8 + 0.2; }
    const g = ui.g, fr = this._portalCanvases, cv = fr[Math.floor(this.tick + partial) % fr.length];
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.globalAlpha = Math.min(1, a);
    g.drawImage(cv, 0, 0, ui.w, ui.h);
    g.globalAlpha = 1; g.imageSmoothingEnabled = prev;
  },
  // GameRenderer: spinningEffectIntensity distorts the view (rotate, squash x, rotate back)
  applySpinWobble(r, partial) {
    const p = this.player, f = (p.pPortalSpin || 0) + ((p.portalSpin || 0) - (p.pPortalSpin || 0)) * partial; if (f <= 0) return;
    let f1 = 5 / (f * f + 5) - f * 0.04; f1 *= f1;
    const ang = (this.tick + partial) * 20 * DEG, ax = [0, Math.SQRT1_2, Math.SQRT1_2];
    const R1 = m4AxisAngle(ax, ang), S = m4(), R2 = m4AxisAngle(ax, -ang); S[0] = 1 / f1;
    const t = m4(), u = m4(); m4Mul(t, R1, S); m4Mul(u, t, R2); m4Mul(t, u, r.view); r.view.set(t);
    m4Mul(r.vp, r.proj, r.view); frustumPlanes(r.vp, r.planes);
  },
  // beacon-like beams: end gateways when they open, end crystals healing the dragon / during the respawn
  renderDimBeams(partial, cx, cy, cz) {
    const r = this.renderer, b = r.bAlpha, tile = r.TILE.white; if (tile === undefined) return;
    const beam = (x0, y0, z0, x1, y1, z1, wd, R, G, B, A) => {
      const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0, mx = (x0 + x1) / 2 - cx, my = (y0 + y1) / 2 - cy, mz = (z0 + z1) / 2 - cz;
      let rx = sy * mz - sz * my, ry = sz * mx - sx * mz, rz = sx * my - sy * mx; const l = Math.hypot(rx, ry, rz) || 1; rx = rx / l * wd; ry = ry / l * wd; rz = rz / l * wd;
      b.billboard(mx, my, mz, rx, ry, rz, sx / 2, sy / 2, sz / 2, tile, 0, 0, 1, 1, R, G, B, A, 1, 1);
    };
    if (this.gatewayBeams) for (const g of this.gatewayBeams) { const k = 1 - g.t / 40; beam(g.x + 0.5, g.y - 30, g.z + 0.5, g.x + 0.5, g.y + 60, g.z + 0.5, 0.35, 0.75, 0.4, 1, 0.6 * k); beam(g.x + 0.5, g.y - 30, g.z + 0.5, g.x + 0.5, g.y + 60, g.z + 0.5, 0.12, 1, 0.9, 1, 0.9 * k); }
    for (const e of this.entities) {
      if (e.type !== 'end_crystal' || e.dead || !e.beamTarget) continue;
      const t = e.beamTarget, ex = e.px + (e.x - e.px) * partial, ey = e.py + (e.y - e.py) * partial + 1, ez = e.pz + (e.z - e.pz) * partial;
      const tx = t.px !== undefined ? t.px + (t.x - t.px) * partial : t.x, ty = (t.py !== undefined ? t.py + (t.y - t.py) * partial : t.y) + (t.beamDY || 0), tz = t.pz !== undefined ? t.pz + (t.z - t.pz) * partial : t.z;
      const pulse = 0.75 + 0.25 * Math.sin((this.tick + partial) * 0.3);
      beam(ex, ey, ez, tx, ty, tz, 0.2, 0.95, 0.45, 0.95, 0.55 * pulse); beam(ex, ey, ez, tx, ty, tz, 0.07, 1, 0.85, 1, 0.9);
    }
    if (this.respawnSeq) for (const c of this.respawnSeq.crystals) if (!c.dead) beam(c.x, c.y + 1, c.z, 0.5, this.podiumY() + 40, 0.5, 0.15, 0.95, 0.5, 0.95, 0.7);
  },
});

// rotation matrix about a unit axis (column major, like the m4 helpers)
function m4AxisAngle(a, ang) {
  const m = m4(), c = Math.cos(ang), s = Math.sin(ang), t = 1 - c, x = a[0], y = a[1], z = a[2];
  m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y;
  m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x;
  m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c;
  return m;
}

// ---------------------------------------------------------------- credits (WinScreen): an epilogue in two voices, then the credits
const CREDITS_TEXT = [
  '§3Look. The traveller has crossed the last bridge of stone.',
  '§2They came from the green world, through fire, into the dark.',
  '§3They broke the first tree with their bare hands. Do you remember?',
  '§2I remember. Every block was a question, and they answered with another block.',
  '§3They built a small house of dirt on the first night, and waited for the sun.',
  '§2And the sun came back. It always comes back. That is the first rule of the green world.',
  '§3They went down into the deep places, where the rock is old and the lava sings.',
  '§2They found diamonds there. They found fear there too. Both were useful.',
  '§3Then they stepped into the red world, where the ceiling burns and the ghosts weep.',
  '§2And they came back, carrying rods of fire and the tears of the sky.',
  '§3They followed the eyes. The eyes knew the way.',
  '§2Twelve eyes for a door that opens onto the stars.',
  '§3And here, at the far end of the sky, they met the dragon.',
  '§2The dragon was a story the world told about itself. The traveller finished it.',
  '§3Or began it. An end is only a door, seen from the other side.',
  '§2Should we tell them?',
  '§3Tell them what?',
  '§2That the world was always waiting for them. That every chunk was made the moment they looked.',
  '§3That the world is built from their curiosity, sixteen blocks at a time.',
  '§2Yes. And that it will still be there tomorrow.',
  '§3Wake up, traveller. The sun is rising over the green world.',
  '§2Go and build something.',
  '', '', '', '',
  '§eMINECRAFT WEB EDITION', '',
  '§7A single-file tribute to the block game', '', '',
  '§eWorld & Engine', 'Chunked voxel engine, worker meshing, flood-fill lighting', '',
  '§eThe Overworld', 'Biomes, caves, ores, villages, strongholds', '',
  '§eThe Nether', 'Five biomes, fortresses, portals, ghasts and blazes', '',
  '§eThe End', 'Islands, obsidian spikes, end crystals, the Ender Dragon', '',
  '§eArt & Sound', 'Every texture and sound is generated procedurally in your browser', '', '',
  '§eWith thanks to', 'Mojang Studios, for the game that inspired all of this', '', '',
  '§7Minecraft is a trademark of Mojang Studios.', '§7This is an unofficial fan project.', '', '', '',
  '§fThank you for playing!',
];
class CreditsScreen extends Screen {
  constructor(game) { super(game); this.pausesGame = true; this.needsCursor = false; this.scroll = 0; this.t0 = now(); this.fast = false; this.lastT = 0; }
  // greedy word wrap to the 274px column of the vanilla win screen (colour codes carried to continuation lines)
  wrap(ui, line) {
    const m = /^(§.)+/.exec(line), pre = m ? m[0] : '', words = line.slice(pre.length).split(' '), out = [];
    let cur = '';
    for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (cur && textWidth(t) > 274) { out.push(pre + cur); cur = wd; } else cur = t; }
    out.push(pre + cur); return out;
  }
  draw(ui) {
    const W = ui.w, H = ui.h, g = ui.g;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const t = (now() - this.t0) / 50;
    this.scroll += (this.fast ? 3 : 0.5) * Math.min(4, Math.max(0, t - this.lastT)); this.lastT = t;
    if (!this.lines) { this.lines = []; for (const l of CREDITS_TEXT) { const parts = this.wrap(ui, l); parts.forEach((pt, i) => this.lines.push({ s: pt, centered: !l.startsWith('§3') && !l.startsWith('§2'), gap: i === parts.length - 1 })); } }
    const lineH = 12, x = Math.round(W / 2 - 137), top = H + 20 - this.scroll;
    if (this.game.logo) { const lw = this.game.logo.width, lh = this.game.logo.height, s = Math.min(1, 274 / lw); g.drawImage(this.game.logo, Math.round(W / 2 - lw * s / 2), Math.round(top - 10), Math.round(lw * s), Math.round(lh * s)); }
    let y = top + 70;
    for (const L of this.lines) {
      if (y > -lineH && y < H + lineH) { if (L.centered) ui.textC(L.s, W / 2, y, '#ffffff'); else ui.text(L.s, x, y, '#ffffff'); }
      y += L.gap ? lineH + 4 : lineH;
    }
    ui.gradient(0, 0, W, 40, 'rgba(0,0,0,1)', 'rgba(0,0,0,0)'); ui.gradient(0, H - 40, W, 40, 'rgba(0,0,0,0)', 'rgba(0,0,0,1)');
    if (y < -20) this.finish();
  }
  finish() { if (this.done) return; this.done = true; this.game.screen = null; this.game.leaveEnd(); }
  keyDown(e) { if (e.code === 'Escape') this.finish(); else if (e.code === 'Space' || e.code === 'ControlLeft') this.fast = true; }
  keyUp(e) { if (e.code === 'Space' || e.code === 'ControlLeft') this.fast = false; }
  mouseDown() { }
}
