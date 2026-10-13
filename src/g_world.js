// ===== g_world.js : chunk storage, workers, lighting, ticks, fluids, raycast =====
const ckey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
const AIRB = 0;

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = null; this.meta = null; this.light = null; this.biome = null;
    this.height = new Uint16Array(256);
    this.secCount = new Int32Array(16);
    this.state = 0;            // 0 = requested, 1 = data, 2 = lit
    this.dirty = 0; this.pending = 0;
    this.meshes = new Array(16).fill(null);
    this.modified = false; this.unloaded = false;
    this.be = new Map();       // block entities: (y<<8|z<<4|x) -> object
    this.spawns = null; this.fromSave = false;
    this.minH = 0; this.maxH = 0;
  }
}

// ---------------------------------------------------------------- worker pool (with synchronous fallback)
const WORKER_BOOT = `
const S = MCShared(); let seed = 0;
self.onmessage = function (e) {
  const m = e.data;
  if (m.t === 'init') { seed = m.seed; S.initAll(m.tiles); self.postMessage({ t: 'ready' }); }
  else if (m.t === 'gen') {
    const r = S.generateChunk(seed, m.cx, m.cz, m.dim | 0);
    self.postMessage({ t: 'gen', id: m.id, cx: m.cx, cz: m.cz, blocks: r.blocks.buffer, meta: r.meta.buffer, biome: r.biome.buffer, spawns: r.spawns, be: r.be }, [r.blocks.buffer, r.meta.buffer, r.biome.buffer]);
  } else if (m.t === 'mesh') {
    const r = S.meshSection({ B: new Uint8Array(m.B), M: new Uint8Array(m.M), L: new Uint8Array(m.L), BIO: new Uint8Array(m.BIO), wx0: m.wx0, wy0: m.wy0, wz0: m.wz0 });
    const tr = []; if (r.solid) tr.push(r.solid); if (r.trans) tr.push(r.trans);
    self.postMessage({ t: 'mesh', id: m.id, solid: r.solid, solidVerts: r.solidVerts, trans: r.trans, transVerts: r.transVerts }, tr);
  }
};`;

class WorkerPool {
  constructor(seed, tiles, n) {
    this.workers = []; this.load = []; this.cbs = new Map(); this.nextId = 1; this.ok = false; this.local = [];
    this.seed = seed; this.tiles = tiles;
    let url = null;
    try {
      const src = MCShared.toString() + '\n' + WORKER_BOOT;
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      for (let i = 0; i < n; i++) {
        const w = new Worker(url);
        w.onmessage = e => this._msg(i, e.data);
        w.onerror = e => { console.warn('worker error', e.message); if (!this._failed) { this._failed = true; this._fallback(); } };
        w.postMessage({ t: 'init', seed, tiles });
        this.workers.push(w); this.load.push(0);
      }
      this.ok = true;
    } catch (err) { console.warn('workers unavailable, using main thread', err); this.ok = false; this.workers = []; }
    if (url) setTimeout(() => URL.revokeObjectURL(url), 5000);
    if (!this.ok) this._fallback();
  }
  _fallback() {
    this.ok = false; for (const w of this.workers) { try { w.terminate(); } catch (e) { } }
    this.workers = [];
    SH.initAll(this.tiles);
    // re-run jobs that were in flight on dead workers
    const pend = Array.from(this.cbs.entries()); this.cbs.clear();
    for (const [id, p] of pend) { if (p.msg) this.local.push({ id, msg: p.msg, cb: p.cb }); else p.cb(null); }
  }
  // stop the worker threads of a world that is being dropped (each pool boots a full copy of the generator)
  terminate() {
    this.dead = true; this.ok = false;
    for (const w of this.workers) { try { w.terminate(); } catch (e) { } }
    this.workers = []; this.load = []; this.cbs.clear(); this.local = [];
  }
  submit(msg, transfer, cb) {
    const id = this.nextId++; msg.id = id;
    if (this.dead) return id;
    if (this.ok) {
      let bi = 0; for (let i = 1; i < this.load.length; i++) if (this.load[i] < this.load[bi]) bi = i;
      this.cbs.set(id, { cb, w: bi, msg: transfer && transfer.length ? null : msg }); this.load[bi]++;
      this.workers[bi].postMessage(msg, transfer || []);
    } else this.local.push({ id, msg, cb });
    return id;
  }
  _msg(wi, m) {
    if (m.t === 'ready') return;
    const p = this.cbs.get(m.id); if (!p) return;
    this.cbs.delete(m.id); this.load[p.w]--;
    p.cb(m);
  }
  get inflight() { return this.ok ? this.cbs.size : this.local.length; }
  // run queued jobs on the main thread (fallback mode), within a time budget
  pump(budgetMs) {
    if (this.ok || !this.local.length) return;
    const t0 = now();
    while (this.local.length && now() - t0 < budgetMs) {
      const j = this.local.shift(), m = j.msg;
      if (m.t === 'gen') {
        const r = SH.generateChunk(this.seed, m.cx, m.cz, m.dim | 0);
        j.cb({ t: 'gen', id: j.id, cx: m.cx, cz: m.cz, blocks: r.blocks.buffer, meta: r.meta.buffer, biome: r.biome.buffer, spawns: r.spawns, be: r.be });
      } else if (m.t === 'mesh') {
        const r = SH.meshSection({ B: new Uint8Array(m.B), M: new Uint8Array(m.M), L: new Uint8Array(m.L), BIO: new Uint8Array(m.BIO), wx0: m.wx0, wy0: m.wy0, wz0: m.wz0 });
        j.cb({ t: 'mesh', id: j.id, solid: r.solid, solidVerts: r.solidVerts, trans: r.trans, transVerts: r.transVerts });
      }
    }
  }
}

// ---------------------------------------------------------------- lighting queues
class IntQueue {
  constructor(n) { this.a = new Int32Array(n); this.h = 0; this.t = 0; }
  push(v) { if (this.t >= this.a.length) { const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.t++] = v; }
  get size() { return this.t - this.h; }
  reset() { this.h = 0; this.t = 0; }
}

const DIRS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

class World {
  constructor(opts) {
    this.seed = opts.seed | 0;
    this.dim = opts.dim || 'overworld';                     // 'overworld' | 'nether' | 'end'
    this.preset = opts.preset || null;                      // 'medoh' = the Divine Beast world (its own overworld generator, code 3)
    this.dimCode = this.dim === 'nether' ? 1 : this.dim === 'end' ? 2 : this.preset === 'medoh' ? 3 : 0;
    this.lavaFast = this.dim === 'nether';                 // the Nether: lava flows 8 blocks, every 10 ticks
    this.chunks = new Map();
    this.renderer = null;           // set by game
    this.game = null;
    this.tickCount = 0;
    this.sched = new Map();         // tick -> array of packed positions ; fluids, growth...
    this.schedSet = new Set();
    this.store = opts.store || null;
    this.savedKeys = opts.savedKeys || new Set();
    this.viewDist = opts.viewDist || 8;
    this.tileIndex = opts.tileIndex;
    const nw = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.pool = new WorkerPool(this.seed, this.tileIndex, nw);
    this.lightQueue = [];           // chunks waiting for initial lighting
    this.qx = new IntQueue(1 << 16); this.qy = new IntQueue(1 << 16); this.qz = new IntQueue(1 << 16);
    this.rx = new IntQueue(1 << 14); this.ry = new IntQueue(1 << 14); this.rz = new IntQueue(1 << 14); this.rl = new IntQueue(1 << 14);
    this.order = []; this.orderKey = null;
    this.genInflight = 0; this.meshInflight = 0;
    this.playerCX = 0; this.playerCZ = 0;
    this.stats = { gen: 0, meshed: 0, lit: 0 };
    this._lc = null; this._lcx = 1e9; this._lcz = 1e9;   // last-chunk cache
    this.urgent = [];
  }

  // ------------------------------------------------ chunk / block access
  getChunk(cx, cz) { return this.chunks.get(ckey(cx, cz)); }
  chunkAt(x, z) {
    const cx = x >> 4, cz = z >> 4;
    if (cx === this._lcx && cz === this._lcz && this._lc && !this._lc.unloaded) return this._lc;
    const c = this.chunks.get(ckey(cx, cz));
    if (c) { this._lc = c; this._lcx = cx; this._lcz = cz; }
    return c;
  }
  getBlock(x, y, z) {
    if (y < 0 || y > 255) return 0;
    const c = this.chunkAt(x, z);
    return c && c.blocks ? c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0;
  }
  getMeta(x, y, z) {
    if (y < 0 || y > 255) return 0;
    const c = this.chunkAt(x, z);
    return c && c.meta ? c.meta[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0;
  }
  isLoaded(x, z) { const c = this.chunkAt(x, z); return !!(c && c.blocks); }
  getSky(x, y, z) { if (y > 255) return 15; if (y < 0) return 0; const c = this.chunkAt(x, z); return c && c.light ? c.light[(y << 8) | ((z & 15) << 4) | (x & 15)] >> 4 : 15; }
  getBlk(x, y, z) { if (y < 0 || y > 255) return 0; const c = this.chunkAt(x, z); return c && c.light ? c.light[(y << 8) | ((z & 15) << 4) | (x & 15)] & 15 : 0; }
  getBiome(x, z) { const c = this.chunkAt(x, z); return c && c.biome ? c.biome[((z & 15) << 4) | (x & 15)] : BIO.plains; }
  heightAt(x, z) { const c = this.chunkAt(x, z); return c ? c.height[((z & 15) << 4) | (x & 15)] : 0; }
  topSolidY(x, z) { // highest solid (collidable) block y, or -1
    for (let y = 255; y >= 0; y--) { const b = this.getBlock(x, y, z); if (b && T_SOLID[b]) return y; }
    return -1;
  }
  isSolid(x, y, z) { const b = this.getBlock(x, y, z); return b !== 0 && T_SOLID[b] === 1; }
  isOpaqueCube(x, y, z) { return T_OPAQUE[this.getBlock(x, y, z)] === 1; }

  blockEntity(x, y, z, create) {
    const c = this.chunkAt(x, z); if (!c) return null;
    const k = (y << 8) | ((z & 15) << 4) | (x & 15);
    let be = c.be.get(k);
    if (!be && create) { be = create(); c.be.set(k, be); c.modified = true; }
    return be || null;
  }

  // ------------------------------------------------ dirty marking
  markDirty(x, y, z) {
    const lx = x & 15, lz = z & 15, ly = y & 15, sy = y >> 4, cx = x >> 4, cz = z >> 4;
    for (let dz = (lz === 0 ? -1 : 0); dz <= (lz === 15 ? 1 : 0); dz++) for (let dx = (lx === 0 ? -1 : 0); dx <= (lx === 15 ? 1 : 0); dx++) {
      const c = this.getChunk(cx + dx, cz + dz); if (!c) continue;
      for (let dy = (ly === 0 ? -1 : 0); dy <= (ly === 15 ? 1 : 0); dy++) {
        const s = sy + dy; if (s < 0 || s > 15) continue;
        c.dirty |= 1 << s;
      }
    }
  }

  // ------------------------------------------------ block modification
  // flags: noLight, noUpdate, noSave, urgent(remesh immediately)
  setBlock(x, y, z, id, meta, flags) {
    if (y < 0 || y > 255) return false;
    const c = this.chunkAt(x, z);
    if (!c || !c.blocks) return false;
    meta = meta | 0; flags = flags || 0;
    const li = (z & 15) << 4 | (x & 15), idx = (y << 8) | li;
    const old = c.blocks[idx], oldMeta = c.meta[idx];
    if (old === id && oldMeta === meta) return false;
    c.blocks[idx] = id; c.meta[idx] = meta;
    if (!(flags & 4)) c.modified = true;
    const sy = y >> 4;
    if ((old !== 0) !== (id !== 0)) c.secCount[sy] += id !== 0 ? 1 : -1;
    if (old !== id && c.be.size) { const k = idx; if (c.be.has(k) && !BLOCKS[id].hasEntity) c.be.delete(k); }
    // heightmap
    const oldOp = T_OPACITY[old], newOp = T_OPACITY[id];
    if (newOp > 0) { if (y >= c.height[li]) c.height[li] = y + 1; }
    else if (oldOp > 0 && y === c.height[li] - 1) { let yy = y - 1; while (yy >= 0 && T_OPACITY[c.blocks[(yy << 8) | li]] === 0) yy--; c.height[li] = yy + 1; }
    if (!(flags & 1) && c.light) this.updateLight(x, y, z, old, id);
    this.markDirty(x, y, z);
    if (id === BID.fire && old !== id) this.schedule(x, y, z, 30 + ((Math.random() * 10) | 0));
    if (flags & 8) this.urgent.push(x, y, z);
    if (!(flags & 2)) this.notifyAround(x, y, z, old, id);
    // BaseFireBlock.onPlace: fire inside an obsidian frame opens a nether portal (not in the End)
    if ((id === BID.fire || id === BID.soul_fire) && old !== id && this.game && this.dim !== 'end' && this.game.tryLightPortal) this.game.tryLightPortal(x, y, z);
    return true;
  }
  chorusMaskAt(x, y, z) { return chorusMask(this.getBlock(x, y - 1, z), this.getBlock(x, y + 1, z), this.getBlock(x, y, z - 1), this.getBlock(x, y, z + 1), this.getBlock(x - 1, y, z), this.getBlock(x + 1, y, z)); }
  // meta used for collision / selection boxes (connection masks are derived from the neighbours)
  shapeMeta(x, y, z, id, meta) { const d = BLOCKS[id]; return d.conn ? this.connMaskAt(x, y, z) : d.chorus === 'plant' ? this.chorusMaskAt(x, y, z) : meta; }

  notifyAround(x, y, z, old, id) {
    this.blockUpdate(x, y, z);
    for (let d = 0; d < 6; d++) this.blockUpdate(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2]);
  }

  // ------------------------------------------------ light propagation
  lightAdd(kind) {
    // spread from the cells currently in qx/qy/qz. kind 0 = sky, 1 = block
    const qx = this.qx, qy = this.qy, qz = this.qz;
    while (qx.h < qx.t) {
      const x = qx.a[qx.h], y = qy.a[qy.h], z = qz.a[qz.h]; qx.h++; qy.h++; qz.h++;
      const c = this.chunkAt(x, z); if (!c || !c.light) continue;
      const li = ((z & 15) << 4) | (x & 15);
      const lv = c.light[(y << 8) | li];
      const l = kind === 0 ? lv >> 4 : lv & 15;
      if (l <= 1 && !(kind === 0 && l === 1)) { if (l <= 1) continue; }
      for (let d = 0; d < 6; d++) {
        const dd = DIRS[d], nx = x + dd[0], ny = y + dd[1], nz = z + dd[2];
        if (ny < 0 || ny > 255) continue;
        const nc = (nx >> 4 === c.cx && nz >> 4 === c.cz) ? c : this.chunkAt(nx, nz);
        if (!nc || !nc.light) continue;
        const nli = ((nz & 15) << 4) | (nx & 15), nidx = (ny << 8) | nli;
        const op = T_OPACITY[nc.blocks[nidx]];
        if (op >= 15) continue;
        const nv = nc.light[nidx];
        const nl = kind === 0 ? nv >> 4 : nv & 15;
        let want;
        if (kind === 0 && d === 0 && l === 15 && op === 0) want = 15; else want = l - (op > 1 ? op : 1);
        if (want > nl) {
          nc.light[nidx] = kind === 0 ? (nv & 15) | (want << 4) : (nv & 240) | want;
          this.markDirty(nx, ny, nz);
          qx.push(nx); qy.push(ny); qz.push(nz);
        }
      }
    }
    qx.reset(); qy.reset(); qz.reset();
  }

  lightRemove(x0, y0, z0, kind) {
    const rx = this.rx, ry = this.ry, rz = this.rz, rl = this.rl, qx = this.qx, qy = this.qy, qz = this.qz;
    const c0 = this.chunkAt(x0, z0); if (!c0 || !c0.light) return;
    const i0 = (y0 << 8) | ((z0 & 15) << 4) | (x0 & 15), v0 = c0.light[i0];
    const l0 = kind === 0 ? v0 >> 4 : v0 & 15;
    c0.light[i0] = kind === 0 ? v0 & 15 : v0 & 240;
    this.markDirty(x0, y0, z0);
    rx.push(x0); ry.push(y0); rz.push(z0); rl.push(l0);
    const emit = [];   // weaker emitters (torch next to glowstone) cleared by the wave are restored afterwards
    while (rx.h < rx.t) {
      const x = rx.a[rx.h], y = ry.a[ry.h], z = rz.a[rz.h], val = rl.a[rl.h]; rx.h++; ry.h++; rz.h++; rl.h++;
      for (let d = 0; d < 6; d++) {
        const dd = DIRS[d], nx = x + dd[0], ny = y + dd[1], nz = z + dd[2];
        if (ny < 0 || ny > 255) continue;
        const nc = this.chunkAt(nx, nz); if (!nc || !nc.light) continue;
        const nidx = (ny << 8) | ((nz & 15) << 4) | (nx & 15), nv = nc.light[nidx];
        const nl = kind === 0 ? nv >> 4 : nv & 15;
        if (nl === 0) continue;
        if (nl < val || (kind === 0 && d === 0 && val === 15 && nl === 15)) {
          if (kind === 1) { const eb = T_EMIT[nc.blocks[nidx]]; if (eb > 0) emit.push(nx, ny, nz, eb); }
          nc.light[nidx] = kind === 0 ? nv & 15 : nv & 240;
          this.markDirty(nx, ny, nz);
          rx.push(nx); ry.push(ny); rz.push(nz); rl.push(nl);
        } else { qx.push(nx); qy.push(ny); qz.push(nz); }
      }
    }
    for (let i = 0; i < emit.length; i += 4) {
      const ec = this.chunkAt(emit[i], emit[i + 2]); if (!ec || !ec.light) continue;
      const eidx = (emit[i + 1] << 8) | ((emit[i + 2] & 15) << 4) | (emit[i] & 15), ev = ec.light[eidx];
      if ((ev & 15) < emit[i + 3]) ec.light[eidx] = (ev & 240) | emit[i + 3];
      qx.push(emit[i]); qy.push(emit[i + 1]); qz.push(emit[i + 2]);
    }
    rx.reset(); ry.reset(); rz.reset(); rl.reset();
  }

  updateLight(x, y, z, oldId, newId) {
    const opO = T_OPACITY[oldId], opN = T_OPACITY[newId], emO = T_EMIT[oldId], emN = T_EMIT[newId];
    const c = this.chunkAt(x, z); if (!c || !c.light) return;
    const qx = this.qx, qy = this.qy, qz = this.qz;
    if (opO !== opN) {
      this.lightRemove(x, y, z, 0);
      // re-add: neighbours already queued by lightRemove; also the cell above (vertical sky chain) and all neighbours
      for (let d = 0; d < 6; d++) { qx.push(x + DIRS[d][0]); qy.push(y + DIRS[d][1]); qz.push(z + DIRS[d][2]); }
      this.lightAdd(0);
    }
    if (emO !== emN || opO !== opN) {
      this.lightRemove(x, y, z, 1);
      if (emN > 0) {
        const idx = (y << 8) | ((z & 15) << 4) | (x & 15), v = c.light[idx];
        c.light[idx] = (v & 240) | emN; qx.push(x); qy.push(y); qz.push(z);
      }
      for (let d = 0; d < 6; d++) { qx.push(x + DIRS[d][0]); qy.push(y + DIRS[d][1]); qz.push(z + DIRS[d][2]); }
      this.lightAdd(1);
    }
  }

  // full initial lighting of a freshly generated/loaded chunk
  lightChunk(c) {
    const B = c.blocks, L = c.light = new Uint8Array(CHUNK_VOL_M);
    const H = c.height;
    let minH = 256, maxH = 0;
    // the Divine Beast hangs 60 blocks over Rito Village: its shadow is not carried below y 149, so the village and the lake keep their daylight
    const skyReset = this.preset === 'medoh' ? 149 : -1;
    // heights + vertical sky pass
    for (let i = 0; i < 256; i++) {
      let h = 0;
      for (let y = 255; y >= 0; y--) if (T_OPACITY[B[(y << 8) | i]] > 0) { h = y + 1; break; }
      H[i] = h; if (h < minH) minH = h; if (h > maxH) maxH = h;
      let s = 15;
      for (let y = 255; y >= 0; y--) {
        const idx = (y << 8) | i, op = T_OPACITY[B[idx]];
        if (s === 15 && op === 0) { L[idx] = 0xF0; continue; }
        s -= op > 1 ? op : 1; if (s < 0) s = 0;
        if (op >= 15) s = 0;
        L[idx] = s << 4;
        if (s === 0) { const stop = y > skyReset ? skyReset + 1 : 0; for (let yy = y - 1; yy >= stop; yy--) L[(yy << 8) | i] = 0; if (stop === 0) break; y = stop; s = 15; }
      }
      // emitters
      for (let y = 0; y <= h + 1 && y < 256; y++) { /* placeholder to keep loop structure simple */ break; }
    }
    c.minH = minH; c.maxH = maxH;
    const qx = this.qx, qy = this.qy, qz = this.qz, X0 = c.cx << 4, Z0 = c.cz << 4;
    // block-light emitters (scan whole column range up to maxH+16 is enough for natural content, but player content may exceed: scan all)
    for (let idx = 0; idx < CHUNK_VOL_M; idx++) {
      const e = T_EMIT[B[idx]];
      if (e) { L[idx] = (L[idx] & 240) | e; qx.push(X0 + (idx & 15)); qy.push(idx >> 8); qz.push(Z0 + ((idx >> 4) & 15)); }
    }
    this.lightAdd(1);
    // sky seeds inside the height band
    const y0 = Math.max(0, minH - 1), y1 = Math.min(255, maxH + 1);
    for (let y = y0; y <= y1; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const idx = (y << 8) | (z << 4) | x, s = L[idx] >> 4;
      if (s < 2) continue;
      let need = false;
      const check = (nidx) => { const nb = B[nidx]; if (T_OPACITY[nb] < 15 && (L[nidx] >> 4) < s - 1) need = true; };
      if (x > 0) check(idx - 1); if (x < 15) check(idx + 1); if (z > 0) check(idx - 16); if (z < 15) check(idx + 16);
      if (y > 0) check(idx - 256);
      if (need) { qx.push(X0 + x); qy.push(y); qz.push(Z0 + z); }
    }
    this.lightAdd(0);
    c.state = 2;
    c.dirty = 0xFFFF;
    // exchange light with already-lit neighbours
    this.syncBorders(c);
  }

  syncBorders(c) {
    const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const qx = this.qx, qy = this.qy, qz = this.qz;
    let pushed0 = 0, pushed1 = 0;
    for (const [dx, dz] of sides) {
      const nb = this.getChunk(c.cx + dx, c.cz + dz);
      if (!nb || nb.state < 2) continue;
      const y0 = Math.max(0, Math.min(c.minH, nb.minH) - 2), y1 = Math.min(255, Math.max(c.maxH, nb.maxH) + 1);
      for (let t = 0; t < 16; t++) {
        // border cell in c and matching cell in nb
        let ax, az, bx, bz;
        if (dx !== 0) { ax = dx < 0 ? 0 : 15; bx = dx < 0 ? 15 : 0; az = bz = t; } else { az = dz < 0 ? 0 : 15; bz = dz < 0 ? 15 : 0; ax = bx = t; }
        for (let y = y0; y <= y1; y++) {
          const ai = (y << 8) | (az << 4) | ax, bi = (y << 8) | (bz << 4) | bx;
          const la = c.light[ai], lb = nb.light[bi];
          const sa = la >> 4, sb = lb >> 4, ba = la & 15, bb = lb & 15;
          if (sa > sb + 1 && T_OPACITY[nb.blocks[bi]] < 15) { qx.push((c.cx << 4) + ax); qy.push(y); qz.push((c.cz << 4) + az); pushed0++; }
          else if (sb > sa + 1 && T_OPACITY[c.blocks[ai]] < 15) { qx.push((nb.cx << 4) + bx); qy.push(y); qz.push((nb.cz << 4) + bz); pushed0++; }
        }
      }
    }
    if (pushed0) this.lightAdd(0);
    // block light exchange
    for (const [dx, dz] of sides) {
      const nb = this.getChunk(c.cx + dx, c.cz + dz);
      if (!nb || nb.state < 2) continue;
      for (let t = 0; t < 16; t++) {
        let ax, az, bx, bz;
        if (dx !== 0) { ax = dx < 0 ? 0 : 15; bx = dx < 0 ? 15 : 0; az = bz = t; } else { az = dz < 0 ? 0 : 15; bz = dz < 0 ? 15 : 0; ax = bx = t; }
        for (let y = 0; y < 256; y++) {
          const ai = (y << 8) | (az << 4) | ax, bi = (y << 8) | (bz << 4) | bx;
          const ba = c.light[ai] & 15, bb = nb.light[bi] & 15;
          if (ba === 0 && bb === 0) continue;
          if (ba > bb + 1 && T_OPACITY[nb.blocks[bi]] < 15) { qx.push((c.cx << 4) + ax); qy.push(y); qz.push((c.cz << 4) + az); pushed1++; }
          else if (bb > ba + 1 && T_OPACITY[c.blocks[ai]] < 15) { qx.push((nb.cx << 4) + bx); qy.push(y); qz.push((nb.cz << 4) + bz); pushed1++; }
        }
      }
    }
    if (pushed1) this.lightAdd(1);
    // neighbours got new light near the border: refresh their meshes
    for (const [dx, dz] of sides) { const nb = this.getChunk(c.cx + dx, c.cz + dz); if (nb && nb.state >= 2) nb.dirty |= 0xFFFF; }
  }

  // ------------------------------------------------ chunk lifecycle
  requestChunk(cx, cz) {
    const k = ckey(cx, cz);
    if (this.chunks.has(k)) return;
    const c = new Chunk(cx, cz); this.chunks.set(k, c);
    this.genInflight++;
    if (this.store && this.savedKeys.has(k)) {
      this.store.getChunk(k).then(rec => {
        if (c.unloaded) { this.genInflight--; return; }
        if (rec) {
          this.genInflight--;
          c.blocks = rleDecode(rec.b, CHUNK_VOL_M); c.meta = rleDecode(rec.m, CHUNK_VOL_M); c.biome = rec.bio ? new Uint8Array(rec.bio) : new Uint8Array(256).fill(BIO.plains);
          c.fromSave = true; c.modified = false;
          if (rec.be) for (const [kk, v] of rec.be) c.be.set(kk, v);
          c.ents = rec.ents || null;
          this.initChunkData(c);
        } else this._genRemote(c);
      }).catch(() => this._genRemote(c));
    } else this._genRemote(c);
  }
  _genRemote(c) {
    this.pool.submit({ t: 'gen', cx: c.cx, cz: c.cz, dim: this.dimCode }, [], res => {
      this.genInflight--;
      if (c.unloaded) return;
      c.blocks = new Uint8Array(res.blocks); c.meta = new Uint8Array(res.meta); c.biome = new Uint8Array(res.biome); c.spawns = res.spawns;
      if (res.be) for (const b of res.be) {
        const o = { type: b.type };
        if (b.type === 'spawner') { o.mob = b.mob; o.delay = 100 + ((Math.random() * 200) | 0); }
        else if (b.type === 'chest') { o.items = new Array(27).fill(null); o.loot = b.loot; if (b.table) o.table = b.table; }
        else if (b.type === 'furnace') { o.input = o.fuel = o.output = null; o.burn = 0; o.cook = 0; if (b.kind) o.kind = b.kind; }
        else if (b.type === 'sign') { o.lines = (b.lines || []).slice(0, 4); while (o.lines.length < 4) o.lines.push(''); }
        c.be.set((b.y << 8) | ((b.z & 15) << 4) | (b.x & 15), o);
      }
      this.initChunkData(c);
    });
  }
  initChunkData(c) {
    c.state = 1;
    for (let sy = 0; sy < 16; sy++) { let n = 0; const o = sy << 12; for (let i = 0; i < 4096; i++) if (c.blocks[o + i] !== 0) n++; c.secCount[sy] = n; }
    this.lightQueue.push(c);
    this.stats.gen++;
    this.orderKey = null;
  }
  unloadChunk(c) {
    if (this.game && c.blocks && c.state >= 2) this.game.captureChunkEntities(c, true);   // villagers and golems go to sleep with their chunk
    c.unloaded = true;
    if (c.modified && this.store && c.blocks) this.saveChunk(c);
    if (this.renderer) this.renderer.freeChunk(c);
    this.chunks.delete(ckey(c.cx, c.cz));
    if (this._lc === c) this._lc = null;
    this.orderKey = null;
  }
  saveChunk(c) {
    const k = ckey(c.cx, c.cz);
    const rec = { b: rleEncode(c.blocks), m: rleEncode(c.meta), bio: c.biome, be: c.be.size ? Array.from(c.be.entries()) : null, ents: c.ents && c.ents.length ? c.ents : null };
    this.store.putChunk(k, rec); this.savedKeys.add(k); c.modified = false;
  }
  saveAll() { for (const c of this.chunks.values()) if (c.modified && c.blocks) this.saveChunk(c); }

  // ------------------------------------------------ per-frame streaming update
  update(px, pz, budgetMs) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    const R = this.viewDist;
    if (!this.orderKey || pcx !== this.playerCX || pcz !== this.playerCZ) { this.playerCX = pcx; this.playerCZ = pcz; this.rebuildOrder(); }
    const t0 = now();
    this.pool.pump(2.5);
    // request generation (radius R+1), nearest first
    const maxInflight = Math.max(4, this.pool.ok ? this.pool.workers.length * 3 : 1);
    for (const o of this.order) {
      if (this.genInflight >= maxInflight) break;
      if (o.d > R + 1.5) break;
      if (!this.chunks.has(o.k)) this.requestChunk(o.cx, o.cz);
    }
    // lighting (time-sliced)
    while (this.lightQueue.length && now() - t0 < budgetMs) {
      // nearest first
      let bi = 0, bd = 1e9;
      for (let i = 0; i < this.lightQueue.length && i < 12; i++) { const c = this.lightQueue[i]; const d = (c.cx - pcx) ** 2 + (c.cz - pcz) ** 2; if (d < bd) { bd = d; bi = i; } }
      const c = this.lightQueue.splice(bi, 1)[0];
      if (c.unloaded) continue;
      this.lightChunk(c); this.stats.lit++;
    }
    // urgent (player edit) remeshes done synchronously
    this.flushUrgent();
    // mesh jobs
    this.scheduleMeshes(R);
    // unload far chunks
    if (this.tickCount % 20 === 0 || this.chunks.size > (2 * R + 5) * (2 * R + 5)) {
      const lim = R + 2.5;
      for (const c of Array.from(this.chunks.values())) {
        const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
        if (d > lim && c.state !== 0) this.unloadChunk(c);
      }
    }
  }
  rebuildOrder() {
    const R = this.viewDist + 2, pcx = this.playerCX, pcz = this.playerCZ, arr = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > R) continue;
      arr.push({ cx: pcx + dx, cz: pcz + dz, d, k: ckey(pcx + dx, pcz + dz) });
    }
    arr.sort((a, b) => a.d - b.d);
    this.order = arr; this.orderKey = pcx + ',' + pcz;
  }
  chunkReadyForMesh(c) {
    if (c.state < 2) return false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const n = this.getChunk(c.cx + dx, c.cz + dz);
      if (!n || n.state < 2) return false;
    }
    return true;
  }
  scheduleMeshes(R) {
    let posted = 0;
    const maxInFlight = this.pool.ok ? this.pool.workers.length * 3 : 2;
    const maxPost = this.pool.ok ? 6 : 1;
    for (const o of this.order) {
      if (o.d > R + 0.5) break;
      if (this.meshInflight >= maxInFlight || posted >= maxPost) break;
      const c = this.chunks.get(o.k);
      if (!c || c.state < 2) continue;
      let want = c.dirty & ~c.pending;
      if (!want) continue;
      if (!this.chunkReadyForMesh(c)) continue;
      for (let sy = 0; sy < 16 && this.meshInflight < maxInFlight && posted < maxPost; sy++) {
        if (!(want & (1 << sy))) continue;
        c.dirty &= ~(1 << sy);
        if (c.secCount[sy] === 0) { if (c.meshes[sy]) this.renderer.setSectionMesh(c, sy, null, 0, null, 0); continue; }
        this.postMesh(c, sy);
        posted++;
      }
    }
  }
  // build the padded 18^3 neighbourhood of a section
  buildPadded(c, sy) {
    const B = new Uint8Array(5832), M = new Uint8Array(5832), L = new Uint8Array(5832), BIOA = new Uint8Array(324);
    const cx = c.cx, cz = c.cz;
    const nbs = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nbs.push(this.getChunk(cx + dx, cz + dz));
    const y0 = (sy << 4) - 1;
    for (let z = 0; z < 18; z++) {
      const dz = z === 0 ? 0 : z === 17 ? 2 : 1, lz = z === 0 ? 15 : z === 17 ? 0 : z - 1;
      for (let x = 0; x < 18; x++) {
        const dx = x === 0 ? 0 : x === 17 ? 2 : 1, lx = x === 0 ? 15 : x === 17 ? 0 : x - 1;
        const ch = nbs[dz * 3 + dx];
        const li = (lz << 4) | lx;
        if (!ch || !ch.blocks || !ch.light) { for (let y = 0; y < 18; y++) L[(y * 18 + z) * 18 + x] = 0xF0; BIOA[z * 18 + x] = BIO.plains; continue; }
        BIOA[z * 18 + x] = ch.biome[li];
        const bl = ch.blocks, mt = ch.meta, lt = ch.light;
        for (let y = 0; y < 18; y++) {
          const wy = y0 + y, o = (y * 18 + z) * 18 + x;
          if (wy < 0) { B[o] = BID.bedrock; L[o] = 0; continue; }
          if (wy > 255) { L[o] = 0xF0; continue; }
          const ci = (wy << 8) | li;
          B[o] = bl[ci]; M[o] = mt[ci]; L[o] = lt[ci];
        }
      }
    }
    return { B, M, L, BIO: BIOA, wx0: cx << 4, wy0: sy << 4, wz0: cz << 4 };
  }
  postMesh(c, sy) {
    const p = this.buildPadded(c, sy);
    c.pending |= 1 << sy; this.meshInflight++;
    this.pool.submit({ t: 'mesh', B: p.B.buffer, M: p.M.buffer, L: p.L.buffer, BIO: p.BIO.buffer, wx0: p.wx0, wy0: p.wy0, wz0: p.wz0 }, [p.B.buffer, p.M.buffer, p.L.buffer, p.BIO.buffer], res => {
      this.meshInflight--; c.pending &= ~(1 << sy);
      if (c.unloaded) return;
      if (!res) { c.dirty |= 1 << sy; return; }   // job lost with a failed worker: mesh it again
      this.renderer.setSectionMesh(c, sy, res.solid, res.solidVerts, res.trans, res.transVerts);
      this.stats.meshed++;
    });
  }
  flushUrgent() {
    if (!this.urgent.length) return;
    const seen = new Set();
    for (let i = 0; i < this.urgent.length; i += 3) {
      const x = this.urgent[i], y = this.urgent[i + 1], z = this.urgent[i + 2];
      const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15, ly = y & 15, sy = y >> 4;
      for (let dz = (lz === 0 ? -1 : 0); dz <= (lz === 15 ? 1 : 0); dz++) for (let dx = (lx === 0 ? -1 : 0); dx <= (lx === 15 ? 1 : 0); dx++) for (let dy = (ly === 0 ? -1 : 0); dy <= (ly === 15 ? 1 : 0); dy++) {
        const s = sy + dy; if (s < 0 || s > 15) continue;
        const c = this.getChunk(cx + dx, cz + dz); if (!c || c.state < 2) continue;
        const key = ckey(c.cx, c.cz) * 16 + s;
        if (seen.has(key)) continue; seen.add(key);
        if (c.pending & (1 << s)) continue;   // a worker job is in flight; it will be re-queued by the dirty bit
        c.dirty &= ~(1 << s);
        if (c.secCount[s] === 0) { if (c.meshes[s]) this.renderer.setSectionMesh(c, s, null, 0, null, 0); continue; }
        const p = this.buildPadded(c, s);
        const r = SH.meshSection(p);
        this.renderer.setSectionMesh(c, s, r.solid, r.solidVerts, r.trans, r.transVerts);
      }
    }
    this.urgent.length = 0;
  }

  // ------------------------------------------------ scheduled ticks
  schedule(x, y, z, delay) {
    const k = x + ',' + y + ',' + z;
    if (this.schedSet.has(k)) return;
    this.schedSet.add(k);
    const t = this.tickCount + Math.max(1, delay | 0);
    let a = this.sched.get(t); if (!a) { a = []; this.sched.set(t, a); }
    a.push(x, y, z);
  }
  runScheduled() {
    const a = this.sched.get(this.tickCount);
    if (!a) return;
    this.sched.delete(this.tickCount);
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i], y = a[i + 1], z = a[i + 2];
      this.schedSet.delete(x + ',' + y + ',' + z);
      if (!this.isLoaded(x, z)) continue;
      const id = this.getBlock(x, y, z);
      if (T_FLUID[id]) this.fluidTick(x, y, z);
      else if (id === BID.fire) this.fireTick(x, y, z);
      else if (BLOCKS[id].falling) this.fallCheck(x, y, z);
      else if (BLOCKS[id].composter && (this.getMeta(x, y, z) & 15) === 7) { this.setBlock(x, y, z, id, 8); if (this.game) this.game.sound('block.composter.ready', x + 0.5, y + 0.5, z + 0.5, 1, 1, 'dig.gravel'); }
    }
  }

  // ------------------------------------------------ neighbour updates (support checks, falling blocks, fluids)
  supportOK(x, y, z, id, meta) {
    const d = BLOCKS[id], below = this.getBlock(x, y - 1, z), bd = BLOCKS[below];
    if (d.web) return true;
    if (d.soulFire) return below === BID.soul_sand || below === BID.soul_soil;
    if (d.fire) return T_SOLID[below] === 1 || this.canNeighborBurn(x, y, z);
    if (d.carpet) return below !== 0 && !T_FLUID[below];
    if (d.wart) return below === BID.soul_sand;
    if (d.crop) return below === BID.farmland;
    if (d.hangVine) { const a = this.getBlock(x, y + 1, z); return a === id || T_SOLID[a] === 1 && T_OPAQUE[a] === 1 || BLOCKS[a].wartBlock === true; }
    if (d.upVine) return below === id || T_SOLID[below] === 1 && T_OPAQUE[below] === 1;
    if (d.netherPlant) return below === BID.crimson_nylium || below === BID.warped_nylium || below === BID.soul_soil || below === BID.netherrack || below === BID.grass_block || below === BID.dirt || below === BID.podzol || below === BID.farmland || below === BID.coarse_dirt;
    if (d.chorus === 'plant') {
      // a chorus stem needs end stone or chorus below, or a chorus neighbour that itself stands on something
      if (below === BID.end_stone || BLOCKS[below].chorus) return true;
      if (this.getBlock(x, y + 1, z) !== 0 && !BLOCKS[this.getBlock(x, y + 1, z)].chorus) return false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = this.getBlock(x + dx, y, z + dz); if (n === BID.chorus_plant) { const nb = this.getBlock(x + dx, y - 1, z + dz); if (nb === BID.chorus_plant || nb === BID.end_stone) return true; } }
      return false;
    }
    if (d.chorus === 'flower') { if (below === BID.end_stone || below === BID.chorus_plant) return true; let n = 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = this.getBlock(x + dx, y, z + dz); if (b === BID.chorus_plant) n++; else if (b !== 0) return false; } return n === 1 && below === 0; }
    if (d.endRod) { const o = [[0, -1, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]][meta] || [0, -1, 0]; const s = this.getBlock(x + o[0], y + o[1], z + o[2]); return s !== 0 && (T_SOLID[s] === 1 || BLOCKS[s].endRod === true); }
    if (d.lantern) { if (meta & 1) { const a = this.getBlock(x, y + 1, z); return a !== 0 && (T_SOLID[a] === 1 || BLOCKS[a].fence === true || BLOCKS[a].wall === true); } return below !== 0 && (T_SOLID[below] === 1); }
    if (d.model === M_CROSS) {
      if (d.cane) {
        if (below === BID.sugar_cane) return true;
        if (!(below === BID.sand || below === BID.red_sand || below === BID.dirt || below === BID.coarse_dirt || below === BID.grass_block || below === BID.podzol)) return false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (T_FLUID[this.getBlock(x + dx, y - 1, z + dz)] === 1) return true;
        return false;
      }
      if (d.mushroom) return T_OPAQUE[below] === 1;
      if (d.sapling || d.flower || d.name === 'short_grass' || d.name === 'fern') return below === BID.grass_block || below === BID.dirt || below === BID.coarse_dirt || below === BID.podzol || below === BID.farmland || below === BID.grass_block_snowy;
      if (d.name === 'dead_bush') return below === BID.sand || below === BID.red_sand || below === BID.dirt || below === BID.coarse_dirt || below === BID.grass_block || below === BID.podzol || below === BID.sandstone || below === BID.red_sandstone || bd.name.endsWith('terracotta');
      return T_SOLID[below] === 1;
    }
    if (d.torch) {
      if (meta === 0) return T_OPAQUE[below] === 1 || bd.fence === true || bd.slab === true || bd.wall === true || below === BID.glass;
      const o = [null, [-1, 0], [1, 0], [0, -1], [0, 1]][meta]; return o ? T_OPAQUE[this.getBlock(x + o[0], y, z + o[1])] === 1 : false;
    }
    if (d.climbable) {
      const o = { 2: [0, 1], 3: [0, -1], 4: [1, 0], 5: [-1, 0] }[meta]; return o ? T_OPAQUE[this.getBlock(x + o[0], y, z + o[1])] === 1 : false;
    }
    if (d.sign) {
      if (d.wallSign) { const o = { 2: [0, 1], 3: [0, -1], 4: [1, 0], 5: [-1, 0] }[meta]; return o ? T_SOLID[this.getBlock(x + o[0], y, z + o[1])] === 1 : false; }
      return T_SOLID[below] === 1;
    }
    if (d.door) {
      if (meta & 8) { const lo = this.getBlock(x, y - 1, z); return lo === id; }
      return T_SOLID[below] === 1 && !bd.door && (this.getBlock(x, y + 1, z) === id || true);
    }
    if (d.layer) return T_OPAQUE[below] === 1 || (below === BID.snow_layer && this.getMeta(x, y - 1, z) === 7) || below === BID.ice;
    if (d.lily) return below === BID.water && (this.getMeta(x, y - 1, z) & 7) === 0 || below === BID.ice;
    if (d.cactus) return below === BID.sand || below === BID.red_sand || below === BID.cactus;
    if (d.bed) {
      // pair check
      const f = meta & 3, head = (meta & 4) !== 0, dv = [[0, 1], [-1, 0], [0, -1], [1, 0]][f];
      const ox = head ? x - dv[0] : x + dv[0], oz = head ? z - dv[1] : z + dv[1];
      return this.getBlock(ox, y, oz) === id;
    }
    return true;
  }
  blockUpdate(x, y, z) {
    if (y < 0 || y > 255) return;
    const c = this.chunkAt(x, z); if (!c || !c.blocks) return;
    const idx = (y << 8) | ((z & 15) << 4) | (x & 15), id = c.blocks[idx];
    if (id === 0) return;
    const d = BLOCKS[id], meta = c.meta[idx];
    if (T_FLUID[id]) { this.schedule(x, y, z, this.fluidDelay(T_FLUID[id])); return; }
    if (d.falling) { this.schedule(x, y, z, 2); return; }
    if (d.vine) { this.vineUpdate(x, y, z, meta); return; }
    if (d.portal === 'nether') { if (!this.portalCellOK(x, y, z, meta)) this.setBlock(x, y, z, 0, 0); return; }
    if (d.model === M_CROSS || d.model === M_CROP || d.torch || d.climbable || d.door || d.layer || d.lily || d.cactus || d.bed || d.fire || d.carpet || d.sign || d.chorus || d.endRod || d.lantern) {
      if (!this.supportOK(x, y, z, id, meta)) {
        if (d.door && !(meta & 8)) { /* lower half lost support */ }
        this.breakBlock(x, y, z, { drops: true });
        return;
      }
    }
    if (id === BID.grass_block_snowy) { if (this.getBlock(x, y + 1, z) !== BID.snow_layer && this.getBlock(x, y + 1, z) !== BID.snow_block) this.setBlock(x, y, z, BID.grass_block, 0, 2); }
    else if (id === BID.grass_block && this.getBlock(x, y + 1, z) === BID.snow_layer) this.setBlock(x, y, z, BID.grass_block_snowy, 0, 2);
    else if (id === BID.farmland && T_SOLID[this.getBlock(x, y + 1, z)] && T_OPAQUE[this.getBlock(x, y + 1, z)]) this.setBlock(x, y, z, BID.dirt, 0, 2);
    else if (d.door && (meta & 8) === 0) { if (this.getBlock(x, y + 1, z) !== id) this.breakBlock(x, y, z, { drops: true }); }
  }
  // NetherPortalBlock.updateShape: a portal cell survives while its in-plane neighbours (up, down, both sides along the axis) are portal or obsidian
  portalCellOK(x, y, z, meta) {
    const ax = (meta & 1) ? [0, 1] : [1, 0], ok = b => b === BID.nether_portal || b === BID.obsidian;
    return ok(this.getBlock(x, y + 1, z)) && ok(this.getBlock(x, y - 1, z)) && ok(this.getBlock(x + ax[0], y, z + ax[1])) && ok(this.getBlock(x - ax[0], y, z - ax[1]));
  }
  // fire burns forever on netherrack and magma (and on bedrock in the End)
  infiniburn(id) { return BLOCKS[id].infiniburn === true || (id === BID.bedrock && this.dim === 'end'); }
  // ------------------------------------------------ fire (BlockFire) and vines
  canNeighborBurn(x, y, z) {
    for (let d = 0; d < 6; d++) if (T_FLAM[this.getBlock(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2])] > 0) return true;
    return false;
  }
  neighborEncouragement(x, y, z) {
    if (this.getBlock(x, y, z) !== 0) return 0;
    let e = 0;
    for (let d = 0; d < 6; d++) { const v = T_ENC[this.getBlock(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2])]; if (v > e) e = v; }
    return e;
  }
  rainingAt(x, y, z) {
    const g = this.game; if (!g || g.weather.rain < 0.5 || this.dim !== 'overworld') return false;
    const b = BIOMES[this.getBiome(x, z)]; if (b && b.name === 'desert') return false;
    return this.heightAt(x, z) <= y;
  }
  igniteAt(x, y, z, age) { const b = this.getBlock(x, y - 1, z); if (b === BID.soul_sand || b === BID.soul_soil) this.setBlock(x, y, z, BID.soul_fire, 0); else this.setBlock(x, y, z, BID.fire, Math.min(15, age | 0)); }
  tryCatchFire(x, y, z, chance, age) {
    const id = this.getBlock(x, y, z), fl = T_FLAM[id];
    if (fl <= 0 || Math.random() * chance >= fl) return;
    if (Math.random() * (age + 10) < 5 && !this.rainingAt(x, y, z)) {
      this.igniteAt(x, y, z, age + ((Math.random() * 5) | 0) / 4);
    } else {
      this.setBlock(x, y, z, 0, 0);
    }
    if (id === BID.tnt && this.game) this.game.igniteTnt(x, y, z, 80);
  }
  fireTick(x, y, z) {
    if (this.getBlock(x, y, z) !== BID.fire) return;
    let age = this.getMeta(x, y, z);
    const below = this.getBlock(x, y - 1, z), difficulty = this.game ? this.game.difficulty : 2, forever = this.infiniburn(below);
    if (!forever && this.rainingAt(x, y, z) && Math.random() < 0.2 + age * 0.03) { this.setBlock(x, y, z, 0, 0); return; }
    if (age < 15) { age += ((Math.random() * 3) | 0) >> 1; this.setBlock(x, y, z, BID.fire, age, 2); }
    this.schedule(x, y, z, 30 + ((Math.random() * 10) | 0));
    const nb = this.canNeighborBurn(x, y, z);
    if (!forever && !nb) {
      if (T_SOLID[below] !== 1 || age > 3) { this.setBlock(x, y, z, 0, 0); return; }
    }
    if (!forever && T_FLAM[below] <= 0 && age === 15 && ((Math.random() * 4) | 0) === 0) { this.setBlock(x, y, z, 0, 0); return; }
    this.tryCatchFire(x + 1, y, z, 300, age); this.tryCatchFire(x - 1, y, z, 300, age);
    this.tryCatchFire(x, y - 1, z, 250, age); this.tryCatchFire(x, y + 1, z, 250, age);
    this.tryCatchFire(x, y, z - 1, 300, age); this.tryCatchFire(x, y, z + 1, 300, age);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 4; k++) {
      if (i === 0 && k === 0 && j === 0) continue;
      let chance = 100; if (k > 1) chance += (k - 1) * 100;
      const px = x + i, py = y + k, pz = z + j;
      if (this.getBlock(px, py, pz) !== 0) continue;
      const enc = this.neighborEncouragement(px, py, pz);
      if (enc <= 0) continue;
      const j1 = (enc + 40 + difficulty * 7) / (age + 30);
      if (j1 > 0 && Math.random() * chance <= j1 && !this.rainingAt(px, py, pz)) this.igniteAt(px, py, pz, age + ((Math.random() * 5) | 0) / 4);
    }
  }
  // vines keep only the faces that still have a supporting block (or a matching vine above); none left -> the vine breaks
  vineUpdate(x, y, z, meta) {
    const above = this.getBlock(x, y + 1, z), aboveMeta = above === BID.vine ? this.getMeta(x, y + 1, z) : 0;
    const solidAt = (px, py, pz) => { const b = this.getBlock(px, py, pz); return T_OPAQUE[b] === 1 || (b !== 0 && BLOCKS[b].model === M_CUTOUT && (BLOCKS[b].leaves || T_SOLID[b]) && !T_FLUID[b]); };
    const sides = [[1, 0, 0, 1], [2, -1, 0, 0], [4, 0, 0, -1], [8, 1, 0, 0]];
    let m = 0;
    for (const [bit, dx, , dz] of sides) if ((meta & bit) && (solidAt(x + dx, y, z + dz) || (aboveMeta & bit))) m |= bit;
    if ((meta & 16) && solidAt(x, y + 1, z)) m |= 16;
    if (m === 0 && above === BID.vine) m = 0;
    if (m === 0) { this.breakBlock(x, y, z, { drops: false }); return; }
    if (m !== meta) this.setBlock(x, y, z, BID.vine, m, 2);
  }
  // ChorusFlowerBlock.randomTick: grow up (turning into a stem), branch sideways, or die (age 5)
  chorusFlowerTick(x, y, z) {
    const age = this.getMeta(x, y, z); if (age >= 5 || y >= 250 || this.getBlock(x, y + 1, z) !== 0) return;
    const P = BID.chorus_plant, F = BID.chorus_flower, H = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const emptyAround = (px, py, pz, ex, ez) => { for (const [dx, dz] of H) { if (dx === ex && dz === ez) continue; if (this.getBlock(px + dx, py, pz + dz) !== 0) return false; } return true; };
    const below = this.getBlock(x, y - 1, z);
    let up = false, onStone = false;
    if (below === BID.end_stone) up = true;
    else if (below === P) {
      let j = 1;
      for (let k = 0; k < 4; k++) { const b = this.getBlock(x, y - j - 1, z); if (b !== P) { if (b === BID.end_stone) onStone = true; break; } j++; }
      if (j < 2 || j <= ((Math.random() * (onStone ? 5 : 4)) | 0)) up = true;
    } else if (below === 0) up = true;
    if (up && emptyAround(x, y + 1, z, 9, 9) && this.getBlock(x, y + 2, z) === 0) { this.setBlock(x, y, z, P, 0, 2); this.setBlock(x, y + 1, z, F, age); this.notifyAround(x, y, z); return; }
    if (age < 4) {
      let l = (Math.random() * 4) | 0; if (onStone) l++;
      let grew = false;
      for (let i = 0; i < l; i++) {
        const [dx, dz] = H[(Math.random() * 4) | 0], nx = x + dx, nz = z + dz;
        if (this.getBlock(nx, y, nz) === 0 && this.getBlock(nx, y - 1, nz) === 0 && emptyAround(nx, y, nz, -dx, -dz)) { this.setBlock(nx, y, nz, F, age + 1, 2); grew = true; }
      }
      if (grew) { this.setBlock(x, y, z, P, 0, 2); this.notifyAround(x, y, z); return; }
    }
    this.setBlock(x, y, z, F, 5);
    if (this.game) this.game.sound('block.chorus_flower.death', x + 0.5, y + 0.5, z + 0.5, 1, 1, 'dig.wood');
  }
  fallCheck(x, y, z) {
    const id = this.getBlock(x, y, z); if (!BLOCKS[id].falling) return;
    const below = this.getBlock(x, y - 1, z);
    if (y > 0 && (below === 0 || (T_REPL[below] && !T_SOLID[below]) || T_FLUID[below] || !T_SOLID[below])) {
      if (this.game && this.game.canSpawnFalling()) { const meta = this.getMeta(x, y, z); this.setBlock(x, y, z, 0, 0); this.game.spawnFalling(x, y, z, id, meta); }
    }
  }

  // ------------------------------------------------ fluids
  fluidTick(x, y, z) {
    const id = this.getBlock(x, y, z), kind = T_FLUID[id];
    if (!kind) return;
    let meta = this.getMeta(x, y, z);
    const decay = kind === 1 || this.lavaFast ? 1 : 2, maxStrength = 8;
    const isSource = (meta & 15) === 0;
    let strength = isSource ? 8 : (meta & 8) ? 8 : 8 - (meta & 7);
    const dist = (meta & 7);
    // 1) recompute flowing cells
    if (!isSource) {
      let best = 0, srcNeighbours = 0;
      for (let d = 2; d < 6; d++) {
        const dd = DIRS[d], nid = this.getBlock(x + dd[0], y, z + dd[2]);
        if (T_FLUID[nid] !== kind) continue;
        const nm = this.getMeta(x + dd[0], y, z + dd[2]);
        const ns = (nm & 15) === 0 ? 8 : (nm & 8) ? 8 : 8 - (nm & 7);
        if ((nm & 15) === 0) srcNeighbours++;
        // lateral flow from a falling column only spreads if it stands on something (handled by neighbour's own tick)
        if (ns - decay > best) best = ns - decay;
      }
      const above = this.getBlock(x, y + 1, z);
      let newStrength = best, falling = false;
      if (T_FLUID[above] === kind) { newStrength = 8; falling = true; }
      // infinite water: two sources next to it and solid/source below
      if (kind === 1 && srcNeighbours >= 2 && !falling) {
        const bl = this.getBlock(x, y - 1, z);
        if (T_SOLID[bl] || (T_FLUID[bl] === 1 && (this.getMeta(x, y - 1, z) & 15) === 0)) { this.setBlock(x, y, z, id, 0); this.scheduleAround(x, y, z, kind); return; }
      }
      if (newStrength <= 0) { this.setBlock(x, y, z, 0, 0); this.scheduleAround(x, y, z, kind); return; }
      const nm = falling ? 8 : (8 - newStrength);
      if (nm !== meta) { this.setBlock(x, y, z, id, nm); meta = nm; strength = newStrength; this.scheduleAround(x, y, z, kind); }
      else strength = newStrength;
    }
    // 2) spread
    const below = this.getBlock(x, y - 1, z);
    if (y > 0 && this.canFluidEnter(below, kind)) {
      this.fluidInto(x, y - 1, z, kind, 8);
    } else if ((strength > 1 || (meta & 8)) && ((meta & 15) === 0 || T_FLUID[below] !== kind)) {
      const ns = (meta & 8) ? (kind === 1 ? 7 : 6) : strength - decay;
      if (ns > 0 && !(y > 0 && this.canFluidEnter(below, kind) )) {
        // if standing on a same-kind fluid that is not full, still spread (MC spreads on source)
        for (let d = 2; d < 6; d++) {
          const dd = DIRS[d], nx = x + dd[0], nz = z + dd[2], nid = this.getBlock(nx, y, nz);
          if (this.canFluidEnter(nid, kind)) this.fluidInto(nx, y, nz, kind, 8 - ns);
          else if (T_FLUID[nid] === kind) { const nm = this.getMeta(nx, y, nz); if ((nm & 15) !== 0 && !(nm & 8) && (8 - (nm & 7)) < ns) this.fluidInto(nx, y, nz, kind, 8 - ns); }
        }
      }
    }
  }
  canFluidEnter(id, kind) {
    if (id === 0) return true;
    if (T_FLUID[id]) return T_FLUID[id] !== kind ? true : false;
    return T_REPL[id] === 1 && !BLOCKS[id].solid;
  }
  fluidDelay(kind) { return kind === 1 ? 5 : this.lavaFast ? 10 : 30; }
  scheduleAround(x, y, z, kind) {
    this.schedule(x, y, z, this.fluidDelay(kind));
    for (let d = 0; d < 6; d++) { const dd = DIRS[d]; const nid = this.getBlock(x + dd[0], y + dd[1], z + dd[2]); if (T_FLUID[nid]) this.schedule(x + dd[0], y + dd[1], z + dd[2], this.fluidDelay(T_FLUID[nid])); }
  }
  fluidInto(x, y, z, kind, meta) {
    const cur = this.getBlock(x, y, z);
    const fid = kind === 1 ? BID.water : BID.lava;
    if (T_FLUID[cur] && T_FLUID[cur] !== kind) {
      // water meets lava
      const cm = this.getMeta(x, y, z);
      if (kind === 1) { this.setBlock(x, y, z, (cm & 15) === 0 ? BID.obsidian : BID.cobblestone, 0); }
      else { this.setBlock(x, y, z, BID.stone, 0); }
      if (this.game) this.game.fizz(x, y, z);
      return;
    }
    if (cur !== 0 && !T_FLUID[cur]) { if (this.game && BLOCKS[cur].replaceable) this.breakBlock(x, y, z, { drops: true, noSound: true }); }
    // lava next to water turns into cobblestone / stone
    if (kind === 2) {
      for (let d = 0; d < 6; d++) { if (d === 1) continue; const dd = DIRS[d]; if (T_FLUID[this.getBlock(x + dd[0], y + dd[1], z + dd[2])] === 1) { this.setBlock(x, y, z, meta === 8 || d === 0 ? BID.stone : BID.cobblestone, 0); if (this.game) this.game.fizz(x, y, z); return; } }
    }
    this.setBlock(x, y, z, fid, meta & 15);
    this.schedule(x, y, z, this.fluidDelay(kind));
  }

  // ------------------------------------------------ breaking / drops
  dropsFor(id, meta, stack, rand) {
    const d = BLOCKS[id], out = [];
    let dr = d.drops;
    const sh = stack && ITEMS[stack.id] && ITEMS[stack.id].tool && ITEMS[stack.id].tool.kind === 'shears';
    if (d.shearsDrop && sh) { out.push(newStack(IID[d.shearsDrop], 1)); return out; }
    if (dr === null) return out;
    if (d.needTool) { const [, can] = toolSpeedFor(stack, id); if (!can) return out; }
    if (d.leaves && sh) { out.push(newStack(id, 1)); return out; }
    if (dr === undefined) { const it = ITEMS[id]; if (it) out.push(newStack(it.id, 1)); return out; }
    if (typeof dr === 'string') {
      if (dr.startsWith('special:')) {
        const s = dr.slice(8);
        if (s === 'gravel') out.push(newStack(rand() < 0.1 ? IID.flint : id, 1));
        else if (s === 'door') out.push(newStack(IID.oak_door, 1));   // either half drops the door once (the other half is removed without drops)
        else if (s === 'bed') out.push(newStack(IID.red_bed, 1));
        else if (s === 'snow') out.push(newStack(IID.snowball, (meta & 7) + 1));
        else if (s === 'wheat') { if ((meta & 7) >= 7) { out.push(newStack(IID.wheat, 1)); out.push(newStack(IID.wheat_seeds, 1 + Math.floor(rand() * 3))); } else out.push(newStack(IID.wheat_seeds, 1)); }
        else if (s === 'nether_wart') out.push(newStack(IID.nether_wart, (meta & 7) >= 7 ? 2 + Math.floor(rand() * 3) : 1));
        else if (s === 'carrots' || s === 'potatoes') {
          const item = s === 'carrots' ? IID.carrot : IID.potato;
          out.push(newStack(item, (meta & 7) >= 7 ? 2 + Math.floor(rand() * 4) : 1));
          if (s === 'potatoes' && (meta & 7) >= 7 && rand() < 0.02 && IID.poisonous_potato !== undefined) out.push(newStack(IID.poisonous_potato, 1));
        }
        return out;
      }
      out.push(newStack(IID[dr], 1)); return out;
    }
    for (const e of dr) {
      const ch = e[3] === undefined ? 1 : e[3];
      if (rand() > ch) continue;
      const n = e[1] + Math.floor(rand() * (e[2] - e[1] + 1));
      if (n > 0 && IID[e[0]] !== undefined) out.push(newStack(IID[e[0]], n));
    }
    return out;
  }
  breakBlock(x, y, z, o) {
    o = o || {};
    const id = this.getBlock(x, y, z); if (id === 0) return false;
    const meta = this.getMeta(x, y, z), d = BLOCKS[id];
    if (T_FLUID[id]) return false;
    if (d.hasEntity) this.spillEntity(x, y, z);
    // multi-block structures
    let other = null;
    if (d.door) other = (meta & 8) ? [x, y - 1, z] : [x, y + 1, z];
    if (d.bed) { const f = meta & 3, dv = [[0, 1], [-1, 0], [0, -1], [1, 0]][f]; other = (meta & 4) ? [x - dv[0], y, z - dv[1]] : [x + dv[0], y, z + dv[1]]; }
    if (this.game) this.game.onBlockBroken(x, y, z, id, meta, o);
    const otherGone = other && this.getBlock(other[0], other[1], other[2]) === id;
    if (otherGone) this.setBlock(other[0], other[1], other[2], 0, 0, (o.urgent ? 8 : 0) | 2);
    const replacement = (id === BID.ice && !o.noWater && T_SOLID[this.getBlock(x, y - 1, z)]) ? BID.water : 0;
    this.setBlock(x, y, z, replacement, 0, o.urgent ? 8 : 0);
    if (o.drops && this.game) {
      const list = this.dropsFor(id, meta, o.tool || null, Math.random);
      for (const s of list) this.game.spawnItem(x + 0.5, y + 0.5, z + 0.5, s, null);
    }
    if (otherGone) this.notifyAround(other[0], other[1], other[2]);
    return true;
  }
  // hand the contents of a container block entity (chest, furnace) to the world as item entities and empty it
  spillEntity(x, y, z) {
    const be = this.blockEntity(x, y, z); if (!be || !this.game) return;
    const at = s => { if (s) this.game.spawnItem(x + 0.5, y + 0.5, z + 0.5, s, null); };
    if (be.loot !== undefined) this.game.fillChestLoot(be);
    if (be.items) { for (const it of be.items) at(it); be.items.fill(null); }
    if (be.type === 'furnace') for (const k of ['input', 'fuel', 'output']) { at(be[k]); be[k] = null; }
  }

  // ------------------------------------------------ random ticks
  randomTicks(px, pz, radiusChunks) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    for (let dz = -radiusChunks; dz <= radiusChunks; dz++) for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
      const c = this.getChunk(pcx + dx, pcz + dz); if (!c || c.state < 2) continue;
      if (this.dim !== 'overworld') {
        // no sky-facing surface here: 3 random blocks in every non-empty 16^3 section (randomTickSpeed 3)
        for (let sy = 0; sy < 16; sy++) {
          if (!c.secCount[sy]) continue;
          for (let n = 0; n < 3; n++) {
            const lx = (Math.random() * 16) | 0, lz = (Math.random() * 16) | 0, y = (sy << 4) + ((Math.random() * 16) | 0);
            const id = c.blocks[(y << 8) | (lz << 4) | lx];
            if (id) this.randomTickBlock((c.cx << 4) + lx, y, (c.cz << 4) + lz, id);
          }
        }
        continue;
      }
      for (let n = 0; n < 4; n++) {
        const lx = (Math.random() * 16) | 0, lz = (Math.random() * 16) | 0, h = c.height[(lz << 4) | lx];
        const y = Math.max(1, Math.min(255, h - 10 + ((Math.random() * 30) | 0)));
        const id = c.blocks[(y << 8) | (lz << 4) | lx];
        if (id) this.randomTickBlock((c.cx << 4) + lx, y, (c.cz << 4) + lz, id);
      }
    }
  }
  randomTickBlock(x, y, z, id) {
    const d = BLOCKS[id];
    if (id === BID.grass_block) {
      const above = this.getBlock(x, y + 1, z);
      if (T_OPACITY[above] >= 2 && T_OPAQUE[above]) { this.setBlock(x, y, z, BID.dirt, 0); return; }
      const sk = this.getSky(x, y + 1, z), bk = this.getBlk(x, y + 1, z);
      if (Math.max(sk, bk) >= 9) {
        const tx = x + ((Math.random() * 3) | 0) - 1, ty = y + ((Math.random() * 5) | 0) - 3, tz = z + ((Math.random() * 3) | 0) - 1;
        if (this.getBlock(tx, ty, tz) === BID.dirt) {
          const a2 = this.getBlock(tx, ty + 1, tz);
          if (T_OPACITY[a2] < 2 && Math.max(this.getSky(tx, ty + 1, tz), this.getBlk(tx, ty + 1, tz)) >= 4) this.setBlock(tx, ty, tz, BID.grass_block, 0);
        }
      }
    } else if (d.leaves) {
      const m = this.getMeta(x, y, z);
      if (m & 8) return;            // player placed / persistent
      if (!this.leafConnected(x, y, z)) {
        if (this.game) { for (const s of this.dropsFor(id, m, null, Math.random)) this.game.spawnItem(x + 0.5, y + 0.5, z + 0.5, s, null); }
        this.setBlock(x, y, z, 0, 0);
      }
    } else if (d.sapling) {
      if (Math.max(this.getSky(x, y + 1, z), this.getBlk(x, y + 1, z)) >= 9 && Math.random() < 0.14) {
        const m = this.getMeta(x, y, z);
        if (m === 0) this.setBlock(x, y, z, id, 1); else this.growTree(x, y, z, d.sapling);
      }
    } else if (d.wart) {
      // NetherWartBlock: 1 in 10 random ticks advances an age (0 -> 1 -> 2 -> 3, stored as meta 0, 1, 3, 7), no light needed
      const m = this.getMeta(x, y, z) & 7;
      if (m < 7 && Math.random() < 0.1) this.setBlock(x, y, z, id, m < 1 ? 1 : m < 3 ? 3 : 7);
    } else if (d.nylium) {
      const a = this.getBlock(x, y + 1, z);
      if (a !== 0 && T_OPAQUE[a] === 1) this.setBlock(x, y, z, BID.netherrack, 0);
    } else if (d.hangVine || d.upVine) {
      // weeping vines grow down, twisting vines up, from the tip (10% per random tick, at most 25 long)
      const dy = d.hangVine ? -1 : 1;
      if (this.getBlock(x, y + dy, z) === 0 && Math.random() < 0.1) {
        let len = 1; while (this.getBlock(x, y - dy * len, z) === id && len < 26) len++;
        if (len < 25) this.setBlock(x, y + dy, z, id, 0, 2);
      }
    } else if (d.chorus === 'flower') this.chorusFlowerTick(x, y, z);
    else if (d.crop) {
      const m = this.getMeta(x, y, z) & 7;
      if (m < 7 && Math.max(this.getSky(x, y, z), this.getBlk(x, y, z)) >= 9) {
        const moist = this.getMeta(x, y - 1, z) >= 7;
        if (Math.random() < (moist ? 0.35 : 0.18)) this.setBlock(x, y, z, id, m + 1);
      }
    } else if (d.farmland) {
      let water = false;
      for (let dx = -4; dx <= 4 && !water; dx++) for (let dz = -4; dz <= 4 && !water; dz++) for (let dy = 0; dy <= 1; dy++) if (T_FLUID[this.getBlock(x + dx, y + dy, z + dz)] === 1) { water = true; break; }
      const m = this.getMeta(x, y, z);
      if (water) { if (m < 7) this.setBlock(x, y, z, id, 7); }
      else if (m > 0) this.setBlock(x, y, z, id, m - 1);
      else if (this.getBlock(x, y + 1, z) === 0 || !BLOCKS[this.getBlock(x, y + 1, z)].crop) this.setBlock(x, y, z, BID.dirt, 0);
    } else if (d.cane || d.cactus) {
      if (this.getBlock(x, y + 1, z) === 0) {
        let h = 1; while (this.getBlock(x, y - h, z) === id) h++;
        if (h < 3 && Math.random() < 0.2) this.setBlock(x, y + 1, z, id, 0);
      }
    } else if (d.vine) {
      const m = this.getMeta(x, y, z) & 15;
      if (Math.random() < 0.35 && this.getBlock(x, y - 1, z) === 0 && m) {
        let len = 1; while (this.getBlock(x, y + len, z) === BID.vine && len < 24) len++;
        if (len < 20) this.setBlock(x, y - 1, z, BID.vine, m, 2);
      }
    } else if (id === BID.lava) {
      const n = (Math.random() * 3) | 0;
      if (n > 0) {
        let px = x, py = y, pz = z;
        for (let i = 0; i < n; i++) {
          px += ((Math.random() * 3) | 0) - 1; py += 1; pz += ((Math.random() * 3) | 0) - 1;
          const b = this.getBlock(px, py, pz);
          if (b === 0) { if (this.canNeighborBurn(px, py, pz)) { this.igniteAt(px, py, pz, 0); return; } }
          else if (T_SOLID[b]) return;
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const px = x + ((Math.random() * 3) | 0) - 1, pz = z + ((Math.random() * 3) | 0) - 1;
          if (this.getBlock(px, y + 1, pz) === 0 && T_FLAM[this.getBlock(px, y, pz)] > 0) this.igniteAt(px, y + 1, pz, 0);
        }
      }
    } else if (id === BID.ice) {
      if (this.getBlk(x, y, z) > 11) { this.setBlock(x, y, z, BID.water, 0); }
    } else if (id === BID.dirt) {
      // dirt under sunlight next to grass handled by grass; nothing
    }
  }
  leafConnected(x, y, z) {
    // BFS through leaves (distance <= 4) looking for a log
    const seen = new Set([x + ',' + y + ',' + z]); let frontier = [[x, y, z]];
    for (let dist = 0; dist < 7; dist++) {
      const next = [];
      for (const [px, py, pz] of frontier) for (let d = 0; d < 6; d++) {
        const nx = px + DIRS[d][0], ny = py + DIRS[d][1], nz = pz + DIRS[d][2], k = nx + ',' + ny + ',' + nz;
        if (seen.has(k)) continue; seen.add(k);
        const b = this.getBlock(nx, ny, nz), bd = BLOCKS[b];
        if (bd.log) return true;
        if (bd.leaves) next.push([nx, ny, nz]);
      }
      frontier = next; if (!frontier.length) break;
    }
    return false;
  }
  growTree(x, y, z, kind) {
    const rnd = mulberry32(hash3(x, y, z, this.tickCount));
    const putList = [];
    const put = (wx, wy, wz, id, isLog, pm) => putList.push([wx, wy, wz, id, isLog, pm | 0]);
    this.setBlock(x, y, z, 0, 0);
    SH.growTree(this.seed, kind, x, y, z, rnd, put);
    for (const [wx, wy, wz, id, isLog, pm] of putList) {
      const cur = this.getBlock(wx, wy, wz);
      if (isLog) { if (cur === 0 || T_REPL[cur] || BLOCKS[cur].leaves) this.setBlock(wx, wy, wz, id, pm); }
      else if (cur === 0 || (T_REPL[cur] && !T_FLUID[cur])) this.setBlock(wx, wy, wz, id, pm);
    }
    if (!this.getBlock(x, y, z)) this.setBlock(x, y, z, BID[kind + '_log'], 0);
  }

  // ------------------------------------------------ queries: collision, raycast
  collect(x0, y0, z0, x1, y1, z1, out) {
    // out: flat array of boxes [x0,y0,z0,x1,y1,z1,...] in world coords
    const ix0 = Math.floor(x0), iy0 = Math.max(0, Math.floor(y0)), iz0 = Math.floor(z0), ix1 = Math.floor(x1), iy1 = Math.min(255, Math.floor(y1)), iz1 = Math.floor(z1);
    for (let y = iy0; y <= iy1; y++) for (let z = iz0; z <= iz1; z++) for (let x = ix0; x <= ix1; x++) {
      const id = this.getBlock(x, y, z);
      if (id === 0) continue;
      if (T_FLUID[id]) continue;
      const meta = this.shapeMeta(x, y, z, id, this.getMeta(x, y, z));
      const bs = SH.getCollision(id, meta);
      if (!bs) continue;
      for (const b of bs) out.push(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
    }
    return out;
  }
  connMaskAt(x, y, z) {
    const d = BLOCKS[this.getBlock(x, y, z)]; if (!d.conn) return 0;
    return connMask(d.conn, this.getBlock(x, y, z - 1), this.getBlock(x, y, z + 1), this.getBlock(x - 1, y, z), this.getBlock(x + 1, y, z));
  }
  // voxel ray traversal. returns {x,y,z,face,t,id,meta,hx,hy,hz} or null. fluids: hit liquids too when true
  raycast(ox, oy, oz, dx, dy, dz, maxDist, fluids, solidOnly) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : 1e30, tdy = dy !== 0 ? Math.abs(1 / dy) : 1e30, tdz = dz !== 0 ? Math.abs(1 / dz) : 1e30;
    let tmx = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) * tdx) : 1e30, tmy = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) * tdy) : 1e30, tmz = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) * tdz) : 1e30;
    let t = 0, lastFace = -1;
    for (let i = 0; i < 200; i++) {
      const id = this.getBlock(x, y, z);
      if (id !== 0 && (fluids || !T_FLUID[id])) {
        const meta = this.getMeta(x, y, z);
        const sm = this.shapeMeta(x, y, z, id, meta);
        const boxes = T_FLUID[id] ? [[0, 0, 0, 1, 1, 1]] : solidOnly ? SH.getCollision(id, sm) : SH.getSelection(id, sm);
        let best = null;
        for (const b of boxes || []) {
          const r = rayBox(ox - x, oy - y, oz - z, dx, dy, dz, b[0], b[1], b[2], b[3], b[4], b[5]);
          if (r && r.t <= maxDist && (!best || r.t < best.t)) best = r;
        }
        if (best) return { x, y, z, face: best.face < 0 ? 1 : best.face, t: best.t, id, meta, hx: ox + dx * best.t, hy: oy + dy * best.t, hz: oz + dz * best.t };
      }
      if (tmx < tmy && tmx < tmz) { t = tmx; if (t > maxDist) return null; x += sx; tmx += tdx; lastFace = sx > 0 ? 4 : 5; }
      else if (tmy < tmz) { t = tmy; if (t > maxDist) return null; y += sy; tmy += tdy; lastFace = sy > 0 ? 0 : 1; }
      else { t = tmz; if (t > maxDist) return null; z += sz; tmz += tdz; lastFace = sz > 0 ? 2 : 3; }
    }
    return null;
  }

  // ------------------------------------------------ explosions
  explode(cx, cy, cz, power, opts) {
    const destroyed = new Set();
    const N = 16;
    const rand = Math.random;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      if (!(i === 0 || i === N - 1 || j === 0 || j === N - 1 || k === 0 || k === N - 1)) continue;
      let dx = i / (N - 1) * 2 - 1, dy = j / (N - 1) * 2 - 1, dz = k / (N - 1) * 2 - 1;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= len; dy /= len; dz /= len;
      let inten = power * (0.7 + rand() * 0.6), px = cx, py = cy, pz = cz;
      for (; inten > 0; inten -= 0.225) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz), id = this.getBlock(bx, by, bz);
        if (id !== 0) {
          const d = BLOCKS[id];
          let res = d.hard < 0 ? 3600000 : (id === BID.obsidian ? 1200 : T_FLUID[id] ? 100 : d.blast !== undefined ? d.blast * 5 : d.hard * 5);
          inten -= (res / 5 + 0.3) * 0.3;
          if (inten > 0 && d.hard >= 0 && !T_FLUID[id]) destroyed.add(bx + ',' + by + ',' + bz);
        }
        px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
      }
    }
    return destroyed;
  }
}
const CHUNK_VOL_M = 65536;

// ray vs box in local coordinates; returns {t, face} where face is the face index hit (0 down,1 up,2 north,3 south,4 west,5 east)
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -1e30, tmax = 1e30, face = -1;
  // x
  if (dx !== 0) { let t1 = (x0 - ox) / dx, t2 = (x1 - ox) / dx, f1 = 4, f2 = 5; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; f1 = 5; f2 = 4; } if (t1 > tmin) { tmin = t1; face = f1; } if (t2 < tmax) tmax = t2; }
  else if (ox < x0 || ox > x1) return null;
  if (dy !== 0) { let t1 = (y0 - oy) / dy, t2 = (y1 - oy) / dy, f1 = 0, f2 = 1; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; f1 = 1; f2 = 0; } if (t1 > tmin) { tmin = t1; face = f1; } if (t2 < tmax) tmax = t2; }
  else if (oy < y0 || oy > y1) return null;
  if (dz !== 0) { let t1 = (z0 - oz) / dz, t2 = (z1 - oz) / dz, f1 = 2, f2 = 3; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; f1 = 3; f2 = 2; } if (t1 > tmin) { tmin = t1; face = f1; } if (t2 < tmax) tmax = t2; }
  else if (oz < z0 || oz > z1) return null;
  if (tmax < tmin || tmax < 0) return null;
  if (tmin < 0) return { t: 0, face: -1 };   // origin inside the box
  return { t: tmin, face };
}
