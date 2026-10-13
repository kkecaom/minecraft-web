// ===== g_village.js : villagers (schedule, pathfinding, beds, work, farming), trading (MerchantScreen), golem building =====
const PROF_NAMES = { farmer: 'Farmer', fisherman: 'Fisherman', shepherd: 'Shepherd', fletcher: 'Fletcher', librarian: 'Librarian', cartographer: 'Cartographer', cleric: 'Cleric', armorer: 'Armorer', weaponsmith: 'Weaponsmith', toolsmith: 'Toolsmith', butcher: 'Butcher', leatherworker: 'Leatherworker', mason: 'Mason', nitwit: 'Nitwit', none: 'Villager' };
const VLEVEL_NAMES = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];
const VLEVEL_XP = [0, 10, 70, 150, 250];
// VillagerTrades (1.16), trimmed to the items of this game: [costA, nA, costB, nB, result, nR, maxUses, villagerXp]
const E = 'emerald';
const VTRADES = {
  farmer: [[['wheat', 20, 0, 0, E, 1, 16, 2], ['potato', 26, 0, 0, E, 1, 16, 2], ['carrot', 22, 0, 0, E, 1, 16, 2], [E, 1, 0, 0, 'bread', 6, 16, 1]],
    [['pumpkin', 6, 0, 0, E, 1, 12, 10], [E, 1, 0, 0, 'apple', 4, 16, 5]], [['melon', 4, 0, 0, E, 1, 12, 20], [E, 3, 0, 0, 'cookie', 18, 12, 10]],
    [[E, 1, 0, 0, 'baked_potato', 6, 12, 15], [E, 1, 0, 0, 'pumpkin_pie', 4, 12, 15]], [[E, 4, 0, 0, 'golden_apple', 1, 12, 30]]],
  fisherman: [[['string', 20, 0, 0, E, 1, 16, 2], ['coal', 10, 0, 0, E, 1, 16, 2]], [[E, 2, 0, 0, 'water_bucket', 1, 12, 5], [E, 1, 0, 0, 'cooked_chicken', 6, 16, 5]],
    [['bucket', 1, 0, 0, E, 1, 12, 20], [E, 1, 0, 0, 'ink_sac', 4, 12, 10]], [[E, 1, 0, 0, 'lily_pad', 4, 12, 15]], [[E, 3, 0, 0, 'bow', 1, 3, 30]]],
  shepherd: [[['white_wool', 18, 0, 0, E, 1, 16, 2], ['brown_wool', 18, 0, 0, E, 1, 16, 2], ['black_wool', 18, 0, 0, E, 1, 16, 2], ['gray_wool', 18, 0, 0, E, 1, 16, 2], [E, 2, 0, 0, 'shears', 1, 12, 1]],
    [[E, 1, 0, 0, 'white_wool', 1, 16, 5], [E, 1, 0, 0, 'red_wool', 1, 16, 5], [E, 1, 0, 0, 'blue_wool', 1, 16, 5], [E, 1, 0, 0, 'yellow_wool', 1, 16, 5]],
    [[E, 3, 0, 0, 'red_bed', 1, 12, 10], [E, 1, 0, 0, 'white_carpet', 4, 16, 10]], [[E, 2, 0, 0, 'lime_wool', 2, 12, 15], [E, 2, 0, 0, 'purple_wool', 2, 12, 15]], [[E, 2, 0, 0, 'black_wool', 3, 12, 30]]],
  fletcher: [[['stick', 32, 0, 0, E, 1, 16, 2], [E, 1, 0, 0, 'arrow', 16, 12, 1], [E, 1, 'gravel', 10, 'flint', 10, 12, 1]],
    [['flint', 26, 0, 0, E, 1, 12, 10], [E, 2, 0, 0, 'bow', 1, 12, 5]], [['string', 14, 0, 0, E, 1, 16, 20], [E, 3, 0, 0, 'arrow', 32, 12, 10]],
    [['feather', 24, 0, 0, E, 1, 16, 30], [E, 2, 0, 0, 'bow', 1, 3, 15]], [[E, 2, 'arrow', 5, 'arrow', 5, 12, 30]]],
  librarian: [[['paper', 24, 0, 0, E, 1, 16, 2], [E, 9, 0, 0, 'bookshelf', 1, 12, 1]], [['book', 4, 0, 0, E, 1, 12, 10], [E, 1, 0, 0, 'lantern', 1, 12, 5]],
    [['ink_sac', 5, 0, 0, E, 1, 12, 20], [E, 1, 0, 0, 'glass', 4, 12, 10]], [[E, 5, 0, 0, 'book', 3, 12, 15]], [[E, 20, 0, 0, 'ender_pearl', 2, 12, 30]]],
  cartographer: [[['paper', 24, 0, 0, E, 1, 16, 2], [E, 1, 0, 0, 'paper', 12, 12, 1]], [['glass_pane', 11, 0, 0, E, 1, 16, 10], [E, 3, 0, 0, 'compass', 1, 12, 5]],
    [['ink_sac', 6, 0, 0, E, 1, 12, 20], [E, 2, 0, 0, 'glass_pane', 8, 12, 10]], [[E, 3, 0, 0, 'white_wool', 6, 12, 15]], [[E, 8, 0, 0, 'ender_eye', 1, 12, 30]]],
  cleric: [[['rotten_flesh', 32, 0, 0, E, 1, 16, 2], [E, 1, 0, 0, 'redstone', 2, 12, 1]], [['gold_ingot', 3, 0, 0, E, 1, 12, 10], [E, 1, 0, 0, 'lapis_lazuli', 1, 12, 5]],
    [['spider_eye', 2, 0, 0, E, 1, 12, 20], [E, 4, 0, 0, 'glowstone', 1, 12, 10]], [['bone', 16, 0, 0, E, 1, 12, 30], [E, 5, 0, 0, 'ender_pearl', 1, 12, 15]], [['nether_wart', 22, 0, 0, E, 1, 12, 30], [E, 3, 0, 0, 'glowstone_dust', 8, 12, 30]]],
  armorer: [[['coal', 15, 0, 0, E, 1, 16, 2], [E, 7, 0, 0, 'iron_leggings', 1, 12, 1], [E, 4, 0, 0, 'iron_boots', 1, 12, 1], [E, 5, 0, 0, 'iron_helmet', 1, 12, 1], [E, 9, 0, 0, 'iron_chestplate', 1, 12, 1]],
    [['iron_ingot', 4, 0, 0, E, 1, 12, 10], [E, 36, 0, 0, 'bell', 1, 12, 5]], [['lava_bucket', 1, 0, 0, E, 1, 12, 20], ['diamond', 1, 0, 0, E, 1, 12, 20]],
    [[E, 13, 0, 0, 'diamond_boots', 1, 3, 15], [E, 13, 0, 0, 'diamond_helmet', 1, 3, 15]], [[E, 21, 0, 0, 'diamond_chestplate', 1, 3, 30], [E, 21, 0, 0, 'diamond_leggings', 1, 3, 30]]],
  weaponsmith: [[['coal', 15, 0, 0, E, 1, 16, 2], [E, 3, 0, 0, 'iron_axe', 1, 12, 1], [E, 7, 0, 0, 'iron_sword', 1, 3, 1]], [['iron_ingot', 4, 0, 0, E, 1, 12, 10], [E, 36, 0, 0, 'bell', 1, 12, 5]],
    [['flint', 24, 0, 0, E, 1, 12, 20]], [['diamond', 1, 0, 0, E, 1, 12, 30], [E, 17, 0, 0, 'diamond_axe', 1, 3, 15]], [[E, 13, 0, 0, 'diamond_sword', 1, 3, 30]]],
  toolsmith: [[['coal', 15, 0, 0, E, 1, 16, 2], [E, 1, 0, 0, 'stone_axe', 1, 12, 1], [E, 1, 0, 0, 'stone_shovel', 1, 12, 1], [E, 1, 0, 0, 'stone_pickaxe', 1, 12, 1], [E, 1, 0, 0, 'stone_hoe', 1, 12, 1]],
    [['iron_ingot', 4, 0, 0, E, 1, 12, 10], [E, 36, 0, 0, 'bell', 1, 12, 5]], [['flint', 30, 0, 0, E, 1, 12, 20], [E, 2, 0, 0, 'iron_shovel', 1, 3, 10], [E, 3, 0, 0, 'iron_pickaxe', 1, 3, 10], [E, 4, 0, 0, 'diamond_hoe', 1, 3, 10]],
    [['diamond', 1, 0, 0, E, 1, 12, 30], [E, 12, 0, 0, 'diamond_axe', 1, 3, 15], [E, 5, 0, 0, 'diamond_shovel', 1, 3, 15]], [[E, 13, 0, 0, 'diamond_pickaxe', 1, 3, 30]]],
  butcher: [[['chicken', 14, 0, 0, E, 1, 16, 2], ['porkchop', 7, 0, 0, E, 1, 16, 2], [E, 1, 0, 0, 'cooked_porkchop', 5, 16, 1]], [['coal', 15, 0, 0, E, 1, 16, 2], [E, 1, 0, 0, 'cooked_chicken', 8, 16, 5]],
    [['mutton', 7, 0, 0, E, 1, 16, 20], ['beef', 10, 0, 0, E, 1, 16, 20]], [[E, 1, 0, 0, 'cooked_beef', 5, 12, 15]], [[E, 2, 0, 0, 'cooked_mutton', 8, 12, 30]]],
  leatherworker: [[['leather', 6, 0, 0, E, 1, 16, 2], [E, 3, 0, 0, 'leather_leggings', 1, 12, 1], [E, 7, 0, 0, 'leather_chestplate', 1, 12, 1]],
    [['flint', 26, 0, 0, E, 1, 12, 10], [E, 5, 0, 0, 'leather_helmet', 1, 12, 5], [E, 4, 0, 0, 'leather_boots', 1, 12, 5]], [['string', 16, 0, 0, E, 1, 12, 20], [E, 7, 0, 0, 'leather_chestplate', 1, 12, 10]],
    [['feather', 16, 0, 0, E, 1, 12, 30], [E, 6, 0, 0, 'leather_leggings', 1, 12, 15]], [[E, 5, 0, 0, 'leather_helmet', 1, 12, 30]]],
  mason: [[['clay_ball', 10, 0, 0, E, 1, 16, 2], [E, 1, 0, 0, 'bricks', 10, 16, 1]], [['stone', 20, 0, 0, E, 1, 16, 10], [E, 1, 0, 0, 'stone_bricks', 4, 16, 5]],
    [['granite', 16, 0, 0, E, 1, 16, 20], ['andesite', 16, 0, 0, E, 1, 16, 20], ['diorite', 16, 0, 0, E, 1, 16, 20], [E, 1, 0, 0, 'mossy_stone_bricks', 4, 16, 10]],
    [['quartz', 12, 0, 0, E, 1, 12, 30], [E, 1, 0, 0, 'white_terracotta', 1, 12, 15], [E, 1, 0, 0, 'orange_terracotta', 1, 12, 15]], [[E, 1, 0, 0, 'quartz_block', 1, 12, 30]]],
};
const PROF_WORK_SOUND = { farmer: 'dig.grass', fisherman: 'random.splash', shepherd: 'dig.cloth', fletcher: 'dig.wood', librarian: 'random.click', cartographer: 'random.click', cleric: 'random.pop', armorer: 'random.anvil_land', weaponsmith: 'random.anvil_land', toolsmith: 'random.anvil_land', butcher: 'dig.wood', leatherworker: 'dig.cloth', mason: 'dig.stone' };

class Villager extends Mob {
  constructor(game, x, y, z, type) {
    super(game, x, y, z, type);
    const r = Math.random(), styles = ['plains', 'desert', 'savanna', 'taiga', 'snowy'];
    this.vtype = 'plains'; this.prof = 'none'; this.level = 1; this.vxp = 0; this.trades = []; this.home = null; this.job = null; this.village = null;
    this.path = null; this.pi = 0; this.goal = null; this.repathT = 0; this.stuckT = 0; this.lastD = 1e9; this.openDoors = [];
    this.sleeping = false; this.unhappyT = 0; this.panicT = 0; this.levelUpT = 0; this.restockDay = -1; this.restocks = 0; this.workT = 0; this.tradingWith = null; this.task = null; this.bellT = 0;
    this.persist = true; this.eyeH = 1.62; this.speedMul = 1; this.jobPhase = (Math.random() * 100) | 0;
  }
  applySpawnData(d) {
    if (d.type) this.vtype = d.type; this.prof = d.prof || 'none'; this.home = d.home || null; this.job = d.job || null; this.village = d.village || null; this.persist = true;
    if (this.prof === 'none' && !this.job && Math.random() < 0.05) this.prof = 'nitwit';
    this.genTrades();
  }
  saveData() { return { prof: this.prof, lvl: this.level, xp: this.vxp, tr: this.trades, home: this.home, job: this.job, vil: this.village, vt: this.vtype, rd: this.restockDay, rs: this.restocks }; }
  loadData(d) { this.prof = d.prof || 'none'; this.level = d.lvl || 1; this.vxp = d.xp || 0; this.trades = d.tr || []; this.home = d.home || null; this.job = d.job || null; this.village = d.vil || null; this.vtype = d.vt || 'plains'; this.restockDay = d.rd === undefined ? -1 : d.rd; this.restocks = d.rs || 0; if (!this.trades.length) this.genTrades(); }
  // VillagerTrades: two random offers per level (fewer when the pool is smaller)
  genTrades() {
    const T = VTRADES[this.prof]; if (!T) return;
    for (let L = (this.trades.length ? this.trades[this.trades.length - 1].lvl : 0); L < this.level; L++) {
      const pool = (T[L] || []).filter(t => IID[t[0]] !== undefined && IID[t[4]] !== undefined && (!t[2] || IID[t[2]] !== undefined)).slice();
      for (let k = 0; k < 2 && pool.length; k++) {
        const t = pool.splice((Math.random() * pool.length) | 0, 1)[0];
        this.trades.push({ a: [IID[t[0]], t[1]], b: t[2] ? [IID[t[2]], t[3]] : null, r: [IID[t[4]], t[5]], uses: 0, max: t[6], xp: t[7], lvl: L + 1 });
      }
    }
  }
  get displayName() { return (PROF_NAMES[this.prof] || 'Villager') + (this.prof !== 'none' && this.prof !== 'nitwit' ? ' - ' + VLEVEL_NAMES[this.level - 1] : ''); }
  // right click: trade (or shake the head when there is nothing to offer)
  interact(s, it) {
    const g = this.game;
    if (this.deathTime > 0 || this.isBaby) return false;
    if (this.sleeping) return false;
    if (!this.trades.length || this.prof === 'nitwit' || this.prof === 'none') { this.unhappyT = 40; g.sound('mob.villager.no', this.x, this.y, this.z, 1, 1, 'mob.villager.idle'); return true; }
    g.sound('mob.villager.trade', this.x, this.y, this.z, 1, 1, 'mob.villager.idle');
    this.tradingWith = g.player; this.moving = false; this.path = null;
    g.openScreen(new TradeScreen(g, this));
    g.stat('villager_talked');
    return true;
  }
  hearBell() { this.bellT = 300 + ((Math.random() * 200) | 0); this.path = null; }
  hurt(amount, src, kind, kb) {
    const ok = super.hurt(amount, src, kind, kb);
    if (ok) {
      this.sleeping = false; this.panicT = 120; this.path = null;
      if (src && src.x !== undefined) { const dx = this.x - src.x, dz = this.z - src.z, l = Math.hypot(dx, dz) || 1; this.fleeFrom = [src.x, src.z]; this.wdx = dx / l; this.wdz = dz / l; }
      if (src === this.game.player) for (const e of this.game.entities) if (e.type === 'iron_golem' && !e.dead && !e.playerMade && (e.x - this.x) ** 2 + (e.z - this.z) ** 2 < 32 * 32) { e.angryAtPlayer = 600; e.target = src; e.hitByPlayer = true; }
    }
    return ok;
  }
  die(src, kind) { if (this.deathTime > 0) return; this.sleeping = false; super.die(src, kind); }
  // ---------------------------------------------------------------- pathfinding (bounded A* over walkable cells, doors count as open)
  cellFree(x, y, z) { const b = this.world.getBlock(x, y, z); if (!b) return true; const d = BLOCKS[b]; if (d.door || (d.gate && true)) return true; if (T_FLUID[b] === 2 || d.fire) return false; return !T_SOLID[b]; }
  floorOK(x, y, z) { const b = this.world.getBlock(x, y, z); if (!b) return false; const d = BLOCKS[b]; return T_SOLID[b] === 1 && !d.fence && !d.wall && !d.door && !d.gate || T_FLUID[b] === 1; }
  canStand(x, y, z) { return this.cellFree(x, y, z) && this.cellFree(x, y + 1, z) && this.floorOK(x, y - 1, z); }
  findPath(tx, ty, tz, maxN) {
    const sx = Math.floor(this.x), sy = Math.floor(this.y + 0.2), sz = Math.floor(this.z);
    const K = (x, y, z) => ((x - sx + 1024) * 2048 + (z - sz + 1024)) * 256 + y;
    const open = [], nodes = new Map(), H = (x, y, z) => Math.abs(x - tx) + Math.abs(y - ty) + Math.abs(z - tz);
    const push = n => { open.push(n); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p].f <= n.f) break; open[i] = open[p]; i = p; } open[i] = n; };
    const pop = () => { const top = open[0], last = open.pop(); if (open.length) { let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < open.length && open[l].f < (m === i ? last.f : open[m].f)) m = l; if (r < open.length && open[r].f < (m === i ? last.f : open[m].f)) m = r; if (m === i) break; open[i] = open[m]; i = m; } open[i] = last; } return top; };
    const start = { x: sx, y: sy, z: sz, g: 0, f: H(sx, sy, sz), p: null, closed: false }; nodes.set(K(sx, sy, sz), start); push(start);
    let best = start, n = 0;
    while (open.length && n++ < (maxN || 600)) {
      const c = pop(); if (c.closed) continue; c.closed = true;
      const h = H(c.x, c.y, c.z); if (h < H(best.x, best.y, best.z)) best = c;
      if (Math.abs(c.x - tx) <= 1 && Math.abs(c.z - tz) <= 1 && Math.abs(c.y - ty) <= 1) { best = c; break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, nz = c.z + dz; let ny = null, cost = 1;
        if (this.canStand(nx, c.y, nz)) ny = c.y;
        else if (this.canStand(nx, c.y + 1, nz) && this.cellFree(c.x, c.y + 2, c.z)) { ny = c.y + 1; cost = 2; }
        else if (this.cellFree(nx, c.y, nz) && this.cellFree(nx, c.y + 1, nz)) { for (let d = 1; d <= 3; d++) { if (!this.cellFree(nx, c.y - d, nz)) break; if (this.floorOK(nx, c.y - d - 1, nz)) { ny = c.y - d; cost = 1 + d; break; } } }
        if (ny === null) continue;
        if (T_FLUID[this.world.getBlock(nx, ny, nz)] === 1) cost += 6;
        if (BLOCKS[this.world.getBlock(nx, ny, nz)].door) cost += 1;
        const k = K(nx, ny, nz); let o = nodes.get(k);
        const gg = c.g + cost;
        if (o && (o.closed || o.g <= gg)) continue;
        if (!o) { o = { x: nx, y: ny, z: nz }; nodes.set(k, o); }
        o.g = gg; o.f = gg + H(nx, ny, nz) * 1.2; o.p = c; o.closed = false; push(o);
      }
    }
    const out = []; for (let c = best; c && c !== start; c = c.p) out.push([c.x, c.y, c.z]);
    return out.reverse();
  }
  goTo(x, y, z, near) {
    this.goal = [x, y, z, near || 1.5]; this.path = this.findPath(x, y, z, 700); this.pi = 0; this.stuckT = 0; this.lastD = 1e9;
  }
  atGoal() { const g = this.goal; return g && Math.hypot(g[0] + 0.5 - this.x, g[2] + 0.5 - this.z) <= g[3] && Math.abs(g[1] - this.y) < 2.5; }
  // walk along the path: open doors on the way and close them behind (InteractWithDoor)
  followPath() {
    const w = this.world;
    if (!this.path || this.pi >= this.path.length) { this.moving = false; return true; }
    const n = this.path[this.pi], cx = n[0] + 0.5, cz = n[2] + 0.5, dx = cx - this.x, dz = cz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.4 && Math.abs(this.y - n[1]) < 1.2) { this.pi++; this.stuckT = 0; this.lastD = 1e9; return false; }
    for (const [ox, oy, oz] of [[n[0], n[1], n[2]], [n[0], n[1] + 1, n[2]]]) {
      const b = w.getBlock(ox, oy, oz), bd = BLOCKS[b];
      if (bd.door && d < 1.6) { const lower = (w.getMeta(ox, oy, oz) & 8) ? oy - 1 : oy, m = w.getMeta(ox, lower, oz); if (!(m & 4)) { w.setBlock(ox, lower, oz, b, m | 4); w.setBlock(ox, lower + 1, oz, b, m | 4 | 8); this.game.sound('random.door_open', ox + 0.5, lower + 0.5, oz + 0.5, 1, 0.9 + Math.random() * 0.1); this.openDoors.push([ox, lower, oz, b]); } break; }
    }
    this.wdx = dx / (d || 1); this.wdz = dz / (d || 1); this.moving = true;
    if (d < this.lastD - 0.02) { this.lastD = d; this.stuckT = 0; } else if (++this.stuckT > 60) { this.path = null; this.moving = false; return true; }
    return false;
  }
  closeDoorsBehind() {
    const w = this.world;
    for (let i = this.openDoors.length - 1; i >= 0; i--) {
      const [x, y, z, b] = this.openDoors[i];
      if ((x + 0.5 - this.x) ** 2 + (z + 0.5 - this.z) ** 2 < 2.5 * 2.5) continue;
      this.openDoors.splice(i, 1);
      if (w.getBlock(x, y, z) !== b) continue;
      const m = w.getMeta(x, y, z); if (m & 4) { w.setBlock(x, y, z, b, m & ~4); w.setBlock(x, y + 1, z, b, (m & ~4) | 8); this.game.sound('random.door_close', x + 0.5, y + 0.5, z + 0.5, 1, 0.9 + Math.random() * 0.1); }
    }
  }
  // ---------------------------------------------------------------- brain: panic > sleep > work > meet > wander
  ai(dp2) {
    const g = this.game, w = this.world, tod = g.time % 24000;
    if (this.unhappyT > 0) this.unhappyT--;
    if (this.levelUpT > 0 && --this.levelUpT === 0) this.levelUp();
    this.closeDoorsBehind();
    if (this.tradingWith) {
      this.moving = false; const p = this.tradingWith;
      if (!(g.screen instanceof TradeScreen) || p.dead || (p.x - this.x) ** 2 + (p.z - this.z) ** 2 > 64) { this.tradingWith = null; if (g.screen instanceof TradeScreen && g.screen.v === this) g.closeScreen(); }
      else this.bodyYaw = Math.atan2(-(p.x - this.x), p.z - this.z);
      return;
    }
    // zombies (and anything that just hurt us) send villagers running
    if (this.age % 10 === 0) { for (const e of g.entities) if ((e.type === 'zombie' || e.type === 'zombified_piglin' && e.angerT > 0) && !e.dead && (e.x - this.x) ** 2 + (e.z - this.z) ** 2 < 64) { this.panicT = Math.max(this.panicT, 60); this.fleeFrom = [e.x, e.z]; this.sleeping = false; break; } }
    if (this.panicT > 0) {
      this.panicT--; this.sleeping = false; this.path = null;
      if (this.fleeFrom) { const dx = this.x - this.fleeFrom[0], dz = this.z - this.fleeFrom[1], l = Math.hypot(dx, dz) || 1; this.wdx = dx / l; this.wdz = dz / l; }
      this.moving = this.safeAhead(this.wdx, this.wdz); if (!this.moving) { const a = Math.random() * TAU; this.wdx = Math.cos(a); this.wdz = Math.sin(a); }
      this.speedMul = 1.6;
      // golem summoning: frightened villagers call for help when no golem is around
      if (this.age % 20 === 0 && Math.random() < 0.05 && !g.entities.some(e => e.type === 'iron_golem' && !e.dead && (e.x - this.x) ** 2 + (e.z - this.z) ** 2 < 32 * 32)) {
        const n = g.entities.filter(e => e.type === 'villager' && !e.dead && (e.x - this.x) ** 2 + (e.z - this.z) ** 2 < 100).length;
        if (n >= 3) this.summonGolem();
      }
      return;
    }
    this.speedMul = 1;
    if ((this.age + this.jobPhase) % 100 === 0) this.jobTick();
    const night = tod >= 12500;
    // sleep in our own bed at night (bed foot = home)
    if (night && this.home && this.bellT <= 0) {
      const [hx, hy, hz] = this.home, bb = w.getBlock(hx, hy, hz);
      if (!w.isLoaded(hx, hz)) { this.moving = false; return; }
      if (bb !== BID.bed) { this.home = null; return; }
      if (this.sleeping) { this.moving = false; this.vx = this.vz = 0; return; }
      if (Math.hypot(hx + 0.5 - this.x, hz + 0.5 - this.z) < 1.6 && Math.abs(hy - this.y) < 1.5) {
        const m = w.getMeta(hx, hy, hz), f = m & 3, dv = [[0, 1], [-1, 0], [0, -1], [1, 0]][f], s = (m & 4) ? -0.5 : 0.5;   // lie across both halves of the bed
        this.sleeping = true; this.x = hx + 0.5 + dv[0] * s; this.z = hz + 0.5 + dv[1] * s; this.y = hy + 0.5625; this.vx = this.vy = this.vz = 0;
        this.bodyYaw = this.pbodyYaw = Math.atan2(dv[0], -dv[1]); this.moving = false; this.path = null; return;
      }
      if (!this.path || this.goalKind !== 'home') { this.goalKind = 'home'; this.goTo(hx, hy, hz, 1.2); }
      if (this.followPath()) this.path = null;
      return;
    }
    if (this.sleeping) { this.sleeping = false; this.y = Math.floor(this.y) + 0.6; this.goalKind = null; }
    // the bell sends everybody indoors for a while
    if (this.bellT > 0) {
      this.bellT--;
      if (this.home) { if (!this.path || this.goalKind !== 'hide') { this.goalKind = 'hide'; this.goTo(this.home[0], this.home[1], this.home[2], 2); } if (this.followPath()) { this.moving = false; } return; }
    }
    const work = tod >= 2000 && tod < 9000, meet = tod >= 9000 && tod < 11000;
    if (work && this.job && this.prof !== 'none' && this.prof !== 'nitwit') { this.doWork(); return; }
    if (meet && this.village) {
      if (this.goalKind !== 'meet' || (!this.path && Math.random() < 0.01)) { this.goalKind = 'meet'; const a = Math.random() * TAU; this.goTo(Math.floor(this.village[0] + 3 + Math.cos(a) * 4), Math.floor(this.y), Math.floor(this.village[1] + Math.sin(a) * 4), 2); }
      if (this.path && this.followPath()) this.path = null;
      if (!this.path) this.moving = false;
      return;
    }
    // wander around home / the village
    if (!this.path || this.goalKind !== 'wander') {
      if (this.goalKind !== 'wander' || Math.random() < 0.02) {
        this.goalKind = 'wander';
        const cx = this.village ? this.village[0] : this.x, cz = this.village ? this.village[1] : this.z, far = (this.x - cx) ** 2 + (this.z - cz) ** 2 > 48 * 48;
        const bx = far ? cx : this.x, bz = far ? cz : this.z;
        this.goTo(Math.floor(bx + (Math.random() - 0.5) * 20), Math.floor(this.y), Math.floor(bz + (Math.random() - 0.5) * 20), 1.5);
      } else { this.moving = false; return; }
    }
    if (this.followPath()) this.path = null;
  }
  // AcquirePoi / ResetProfession: the unemployed claim the nearest free workstation (and take its trade);
  // a villager nobody has traded with yet forgets its trade when the workstation is gone
  jobTick() {
    const g = this.game, w = this.world;
    if (this.prof === 'nitwit' || this.isBaby) return;
    if (this.job) {
      if (!w.isLoaded(this.job[0], this.job[2])) return;
      const b = BLOCKS[w.getBlock(this.job[0], this.job[1], this.job[2])];
      if (b && b.workstation === this.prof) return;
      this.job = null;
    }
    if (this.prof !== 'none' && this.level === 1 && this.vxp === 0) { this.prof = 'none'; this.trades = []; }
    const taken = new Set(); for (const e of g.entities) if (e !== this && e.type === 'villager' && e.job && !e.dead) taken.add(e.job.join(','));
    const x0 = Math.floor(this.x), y0 = Math.floor(this.y), z0 = Math.floor(this.z); let best = null, bd = 1e9;
    for (let dy = -4; dy <= 4; dy++) for (let dz = -12; dz <= 12; dz++) for (let dx = -12; dx <= 12; dx++) {
      const id = w.getBlock(x0 + dx, y0 + dy, z0 + dz); if (!id) continue;
      const ws = BLOCKS[id].workstation; if (!ws || (this.prof !== 'none' && ws !== this.prof)) continue;
      const d = dx * dx + dy * dy + dz * dz; if (d >= bd || taken.has((x0 + dx) + ',' + (y0 + dy) + ',' + (z0 + dz))) continue;
      bd = d; best = [x0 + dx, y0 + dy, z0 + dz, ws];
    }
    if (!best) return;
    this.job = best.slice(0, 3);
    if (this.prof === 'none') { this.prof = best[3]; this.trades = []; this.genTrades(); }
    g.sound('mob.villager.yes', this.x, this.y, this.z, 0.8, 1, 'mob.villager.idle');
    for (let i = 0; i < 8; i++) g.particles.sprite('happy', this.x + (Math.random() - 0.5), this.y + 1.2 + Math.random() * 0.8, this.z + (Math.random() - 0.5), 1, { size: 0.08, up: 0.01, life: 25, spread: 0.8, spreadY: 0.6, vel: 0.01 });
  }
  physics() {
    if (this.sleeping) { this.vx = this.vz = 0; this.vy = 0; return; }
    this.panic = this.panicT > 0 ? 1 : 0;   // Mob.physics runs 1.5x faster while panicking
    super.physics();
  }
  doWork() {
    const g = this.game, w = this.world, [jx, jy, jz] = this.job;
    if (!w.isLoaded(jx, jz)) { this.moving = false; return; }
    const jb = BLOCKS[w.getBlock(jx, jy, jz)];
    if (!jb.workstation) { this.job = null; return; }   // the workstation was broken
    // farmers tend the crops around their composter
    if (this.prof === 'farmer') { if (this.farm()) return; }
    const near = Math.hypot(jx + 0.5 - this.x, jz + 0.5 - this.z) < 2.2 && Math.abs(jy - this.y) < 2;
    if (!near) { if (!this.path || this.goalKind !== 'work') { this.goalKind = 'work'; this.goTo(jx, jy, jz, 1.8); } if (this.followPath()) this.path = null; return; }
    this.moving = false; this.path = null; this.goalKind = 'work';
    this.bodyYaw = Math.atan2(-(jx + 0.5 - this.x), jz + 0.5 - this.z);
    // WorkAtPoi: work sounds and twice-a-day restocking
    if (++this.workT % 100 === 0) {
      g.sound('mob.villager.work_' + this.prof, jx + 0.5, jy + 0.5, jz + 0.5, 0.7, 1, PROF_WORK_SOUND[this.prof] || 'random.click');
      const day = Math.floor(g.time / 24000); if (day !== this.restockDay) { this.restockDay = day; this.restocks = 0; }
      if (this.restocks < 2 && this.trades.some(t => t.uses > 0)) { for (const t of this.trades) t.uses = 0; this.restocks++; for (let i = 0; i < 5; i++) g.particles.sprite('happy', this.x + (Math.random() - 0.5), this.y + 1.8 + Math.random() * 0.4, this.z + (Math.random() - 0.5), 1, { size: 0.08, up: 0.01, life: 20, spread: 0.6, spreadY: 0.3, vel: 0.01 }); }
    }
  }
  // HarvestFarmland: find ripe crops near the job site, harvest and replant
  farm() {
    const g = this.game, w = this.world;
    if (!this.task || this.age % 200 === 0) {
      this.task = null;
      const [jx, jy, jz] = this.job;
      for (let i = 0; i < 40 && !this.task; i++) {
        const x = jx + ((Math.random() * 17) | 0) - 8, z = jz + ((Math.random() * 17) | 0) - 8;
        for (let y = jy - 2; y <= jy + 2; y++) { const b = w.getBlock(x, y, z); if (BLOCKS[b].crop && !BLOCKS[b].wart && (w.getMeta(x, y, z) & 7) >= 7) { this.task = [x, y, z]; break; } }
      }
      if (!this.task) return false;
      this.goalKind = 'farm'; this.goTo(this.task[0], this.task[1], this.task[2], 1.6);
    }
    const [x, y, z] = this.task, b = w.getBlock(x, y, z);
    if (!BLOCKS[b].crop || (w.getMeta(x, y, z) & 7) < 7) { this.task = null; return false; }
    if (Math.hypot(x + 0.5 - this.x, z + 0.5 - this.z) < 1.8) {
      g.particles.block(x, y, z, b, 10, 0.6); g.sound('dig.grass', x + 0.5, y + 0.5, z + 0.5, 0.7, 1);
      w.setBlock(x, y, z, b, 0); this.task = null; this.moving = false; this.swingT = 6;
      return true;
    }
    if (this.followPath()) { this.task = null; return false; }
    return true;
  }
  summonGolem() {
    const g = this.game, w = this.world;
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(this.x) + ((Math.random() * 17) | 0) - 8, z = Math.floor(this.z) + ((Math.random() * 17) | 0) - 8;
      for (let y = Math.floor(this.y) + 6; y > Math.floor(this.y) - 6; y--) {
        if (T_SOLID[w.getBlock(x, y - 1, z)] && !w.getBlock(x, y, z) && !w.getBlock(x, y + 1, z) && !w.getBlock(x, y + 2, z) && !w.getBlock(x + 1, y, z) && !w.getBlock(x - 1, y, z)) {
          const m = g.spawnMob('iron_golem', x + 0.5, y, z + 0.5); m.village = this.village; m.persist = true; return;
        }
      }
    }
  }
  levelUp() {
    if (this.level >= 5) return;
    this.level++; this.genTrades();
    const g = this.game;
    g.sound('mob.villager.yes', this.x, this.y, this.z, 1, 1, 'mob.villager.idle');
    for (let i = 0; i < 12; i++) g.particles.sprite('happy', this.x + (Math.random() - 0.5), this.y + 1 + Math.random() * 1.2, this.z + (Math.random() - 0.5), 1, { size: 0.08, up: 0.01, life: 25, spread: 0.8, spreadY: 0.6, vel: 0.01 });
    this.hp = Math.min(this.maxHp, this.hp + 4);
  }
  // MerchantOffer used: villager experience, maybe a level up shortly after
  onTrade(t) {
    t.uses++; this.vxp += t.xp;
    const g = this.game, p = g.player;
    g.sound('mob.villager.yes', this.x, this.y, this.z, 1, 1, 'mob.villager.idle');
    p.addXP(3 + ((Math.random() * 4) | 0));
    if (this.level < 5 && this.vxp >= VLEVEL_XP[this.level]) this.levelUpT = 40;
    g.stat('traded');
  }
  renderOpts() { return this.isBaby ? { scale: 0.5 } : {}; }
  lightAt() { const w = this.world, x = Math.floor(this.x), y = Math.floor(this.y + (this.sleeping ? 0.5 : this.h * 0.6)), z = Math.floor(this.z); return [w.getSky(x, y, z), w.getBlk(x, y, z)]; }
}
MOB_CLASSES.villager = Villager;

// ---------------------------------------------------------------- trading screen (MerchantScreen 276x166)
class TradeScreen extends ContainerScreen {
  constructor(game, v) {
    super(game, 276, 166);
    this.v = v; this.pay = [null, null]; this.sel = -1; this.scroll = 0;
    this.slots.push(new Slot(136, 37, () => this.pay[0], s => { this.pay[0] = s; }, { kind: 'pay' }));
    this.slots.push(new Slot(162, 37, () => this.pay[1], s => { this.pay[1] = s; }, { kind: 'pay' }));
    this.slots.push(new Slot(220, 37, () => this.result(), () => { }, { output: true, kind: 'out', take: () => this.take() }));
    this.addPlayerSlots(84, 142);
    for (const s of this.slots) if (s.kind === 'inv' || s.kind === 'hot') s.x += 100;
  }
  // the offer matching the current payment (the selected one first)
  offer() {
    const T = this.v.trades, order = this.sel >= 0 ? [this.sel].concat(T.map((_, i) => i).filter(i => i !== this.sel)) : T.map((_, i) => i);
    for (const i of order) { const t = T[i]; if (t.uses >= t.max) continue; if (this.pays(t)) return t; }
    return null;
  }
  // MerchantOffer.satisfiedBy: slot A pays the first price, slot B the second (and must be empty when there is none)
  pays(t) {
    const A = this.pay[0], B = this.pay[1];
    return !!(A && A.id === t.a[0] && A.n >= t.a[1]) && (t.b ? !!(B && B.id === t.b[0] && B.n >= t.b[1]) : !B);
  }
  result() { const t = this.offer(); return t ? newStack(t.r[0], t.r[1]) : null; }
  take() {
    const t = this.offer(); if (!t) return;
    this.pay[0].n -= t.a[1]; if (this.pay[0].n <= 0) this.pay[0] = null;
    if (t.b) { this.pay[1].n -= t.b[1]; if (this.pay[1].n <= 0) this.pay[1] = null; }
    this.v.onTrade(t);
  }
  onChange() { }
  // clicking an offer moves its price from the inventory into the payment slots (MerchantMenu.tryMoveItems)
  selectOffer(i) {
    const p = this.game.player, t = this.v.trades[i]; if (!t) return;
    this.sel = i;
    for (let k = 0; k < 2; k++) if (this.pay[k]) { if (!p.giveItem(this.pay[k])) this.game.dropStackFromInventory(this.pay[k]); this.pay[k] = null; }
    const pull = (c, k) => {
      if (!c) return; let need = stackMax(c[0]);
      for (let j = 0; j < 36 && need > 0; j++) { const s = p.inv[j]; if (!s || s.id !== c[0]) continue; const n = Math.min(need, s.n); s.n -= n; need -= n; if (s.n <= 0) p.inv[j] = null; if (this.pay[k]) this.pay[k].n += n; else this.pay[k] = newStack(c[0], n); }
    };
    pull(t.a, 0); pull(t.b, 1);
  }
  quickTargets(from, stack) {
    const inv = this.slots.filter(s => s.kind === 'inv'), hot = this.slots.filter(s => s.kind === 'hot'), pay = this.slots.filter(s => s.kind === 'pay');
    if (from.kind === 'pay' || from.kind === 'out') return hot.slice().reverse().concat(inv.slice().reverse());
    return pay;
  }
  returnItems() { const p = this.game.player; for (let k = 0; k < 2; k++) if (this.pay[k]) { if (!p.giveItem(this.pay[k])) this.game.dropStackFromInventory(this.pay[k]); this.pay[k] = null; } this.v.tradingWith = null; }
  mouseDown(x, y, b) {
    const ox = this.ox, oy = this.oy, T = this.v.trades;
    if (b === 0 && x >= ox + 5 && x < ox + 93 && y >= oy + 18 && y < oy + 18 + 7 * 20) {
      const i = this.scroll + Math.floor((y - oy - 18) / 20);
      if (i < T.length) { this.game.uiClick(); this.selectOffer(i); }
      return;
    }
    super.mouseDown(x, y, b);
  }
  wheel(d) { this.scroll = clamp(this.scroll + Math.sign(d), 0, Math.max(0, this.v.trades.length - 7)); }
  draw(ui) {
    this.beginFrame();
    const g = this.game, ox = this.ox, oy = this.oy, m = g.mouse, gg = ui.g, v = this.v, T = v.trades;
    ui.panel(ox, oy, 276, 166);
    // offer list background
    gg.fillStyle = '#8b8b8b'; gg.fillRect(ox + 4, oy + 17, 90, 142); gg.fillStyle = '#373737'; gg.fillRect(ox + 4, oy + 17, 90, 1); gg.fillRect(ox + 4, oy + 17, 1, 142); gg.fillStyle = '#ffffff'; gg.fillRect(ox + 4, oy + 158, 90, 1); gg.fillRect(ox + 93, oy + 17, 1, 142);
    this.drawPanelSlots(ui); this.bigSlot(ui, 220, 37);
    ui.textC('Trades', ox + 53, oy + 6, '#404040', false);
    const title = v.displayName; ui.text(title, ox + 99 + 88 - Math.round(textWidth(title) / 2), oy + 6, '#404040', false);
    this.drawTitle(ui, 'Inventory', 107, 72);
    // villager experience bar (green, to the next level)
    if (v.prof !== 'nitwit' && v.prof !== 'none') {
      const bx = ox + 136, by = oy + 16; gg.fillStyle = '#2b2b2b'; gg.fillRect(bx, by, 102, 5); gg.fillStyle = '#5a5a5a'; gg.fillRect(bx + 1, by + 1, 100, 3);
      if (v.level < 5) { const lo = VLEVEL_XP[v.level - 1], hi = VLEVEL_XP[v.level], f = clamp((v.vxp - lo) / (hi - lo), 0, 1); gg.fillStyle = '#7efc20'; gg.fillRect(bx + 1, by + 1, Math.round(100 * f), 3); }
    }
    // trade arrow (red cross when the offer is used up)
    const cur = this.sel >= 0 ? T[this.sel] : null;
    guiArrow(gg, ox + 186, oy + 40, 22, 15, 0);
    if (cur && cur.uses >= cur.max) { gg.fillStyle = '#c80000'; for (let k = 0; k < 9; k++) { gg.fillRect(ox + 192 + k, oy + 41 + k, 2, 1); gg.fillRect(ox + 200 - k, oy + 41 + k, 2, 1); } }
    // offers
    let hoverOffer = null;
    for (let row = 0; row < 7; row++) {
      const i = this.scroll + row, t = T[i]; if (!t) break;
      const bx = ox + 5, by = oy + 18 + row * 20, hov = m.x >= bx && m.x < bx + 88 && m.y >= by && m.y < by + 20;
      ui.button(bx, by, 88, 20, '', true, hov || i === this.sel);
      ui.item(newStack(t.a[0], t.a[1]), bx + 5, by + 2);
      if (t.b) ui.item(newStack(t.b[0], t.b[1]), bx + 35, by + 2);
      guiArrow(gg, bx + 57, by + 6, 10, 9, 0);
      ui.item(newStack(t.r[0], t.r[1]), bx + 68, by + 2);
      if (t.uses >= t.max) { gg.fillStyle = 'rgba(200,0,0,0.85)'; for (let k = 0; k < 7; k++) { gg.fillRect(bx + 58 + k, by + 6 + k, 1, 1); gg.fillRect(bx + 64 - k, by + 6 + k, 1, 1); } }
      if (hov) hoverOffer = t;
    }
    if (T.length > 7) { const h = Math.max(10, Math.round(140 * 7 / T.length)), y = Math.round((140 - h) * this.scroll / (T.length - 7)); gg.fillStyle = '#c6c6c6'; gg.fillRect(ox + 94, oy + 18 + y, 6, h); }
    const hover = this.slotAt(m.x, m.y); this.drawSlots(ui, hover);
    if (!this.cursor && hoverOffer && !hover) {
      const L = [ITEMS[hoverOffer.r[0]].disp + (hoverOffer.r[1] > 1 ? ' x' + hoverOffer.r[1] : ''), '§7Price: ' + hoverOffer.a[1] + ' ' + ITEMS[hoverOffer.a[0]].disp + (hoverOffer.b ? ' + ' + hoverOffer.b[1] + ' ' + ITEMS[hoverOffer.b[0]].disp : '')];
      if (hoverOffer.uses >= hoverOffer.max) L.push('§cOut of stock - the villager restocks at work');
      ui.tooltip(L, Math.round(m.x), Math.round(m.y));
    } else this.drawCursorAndTooltip(ui, hover);
  }
}

// ---------------------------------------------------------------- golems built from blocks (CarvedPumpkinBlock.trySpawnGolem)
Object.assign(Game.prototype, {
  checkGolemBuild(x, y, z) {
    const w = this.world, g = (dx, dy, dz) => w.getBlock(x + dx, y + dy, z + dz), clear = list => { for (const [dx, dy, dz] of list) { this.particles.block(x + dx, y + dy, z + dz, g(dx, dy, dz), 10, 0.8); w.setBlock(x + dx, y + dy, z + dz, 0, 0); } };
    if (g(0, -1, 0) === BID.snow_block && g(0, -2, 0) === BID.snow_block) {
      clear([[0, 0, 0], [0, -1, 0], [0, -2, 0]]);
      const m = this.spawnMob('snow_golem', x + 0.5, y - 2, z + 0.5); m.persist = true; this.stat('snow_golem_built');
      return true;
    }
    if (g(0, -1, 0) === BID.iron_block && g(0, -2, 0) === BID.iron_block) {
      for (const [ax, az] of [[1, 0], [0, 1]]) {
        if (g(ax, -1, az) !== BID.iron_block || g(-ax, -1, -az) !== BID.iron_block) continue;
        const air = b => b === 0 || T_REPL[b] === 1 && !T_FLUID[b];
        if (!air(g(ax, -2, az)) || !air(g(-ax, -2, -az))) continue;
        clear([[0, 0, 0], [0, -1, 0], [0, -2, 0], [ax, -1, az], [-ax, -1, -az]]);
        const m = this.spawnMob('iron_golem', x + 0.5, y - 2, z + 0.5); m.playerMade = true; m.persist = true; this.stat('golem_built');
        return true;
      }
    }
    return false;
  },
});
