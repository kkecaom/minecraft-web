// ===== g_progress.js : statistics, advancements (achievement toasts + screen) =====
// Loaded after g_signs.js. Game.stats = counters saved in the world record (rec.stats); Game.advDone = ids of completed advancements (rec.adv).
// Numbers: play (ticks), walk / fly (blocks), jumps, deaths, kills, bred, slept, dmgDealt, dmgTaken. Maps by item id: mined, placed, crafted; by mob type: killed, killedBy.

const ADVANCEMENTS = [
  // col/row = position in the tree (28 x 27 px cells); test(game) is polled once a second
  { id: 'root', title: 'Minecraft', desc: 'The heart and story of the game', icon: 'grass_block', col: 0, row: 1, test: () => true },
  { id: 'inventory', title: 'Taking Inventory', desc: "Press 'E' to open your inventory", icon: 'book', parent: 'root', col: 1, row: 1, test: g => !!g.stats.invOpened },
  { id: 'wood', title: 'Getting Wood', desc: 'Attack a tree until a block of wood pops out', icon: 'oak_log', parent: 'inventory', col: 2, row: 0, test: g => g.hasItemWhere(n => /_log$/.test(n)) },
  { id: 'cow', title: 'Cow Tipper', desc: 'Harvest some leather', icon: 'leather', parent: 'inventory', col: 2, row: 2, test: g => g.got('leather') },
  { id: 'bench', title: 'Benchmarking', desc: 'Craft a workbench with four blocks of planks', icon: 'crafting_table', parent: 'wood', col: 3, row: 0, test: g => g.got('crafting_table') },
  { id: 'pickaxe', title: 'Time to Mine!', desc: 'Use planks and sticks to make a pickaxe', icon: 'wooden_pickaxe', parent: 'bench', col: 4, row: 0, test: g => g.got('wooden_pickaxe') },
  { id: 'sword', title: 'Time to Strike!', desc: 'Use planks and sticks to make a sword', icon: 'wooden_sword', parent: 'bench', col: 4, row: 1, test: g => g.got('wooden_sword') },
  { id: 'bread', title: 'Bake Bread', desc: 'Turn wheat into bread', icon: 'bread', parent: 'bench', col: 4, row: 2, test: g => g.got('bread') },
  { id: 'bed', title: 'Sweet Dreams', desc: 'Sleep in a bed to change your respawn point', icon: 'red_bed', parent: 'bench', col: 4, row: 3, test: g => !!g.stats.slept },
  { id: 'upgrade', title: 'Getting an Upgrade', desc: 'Construct a better pickaxe', icon: 'stone_pickaxe', parent: 'pickaxe', col: 5, row: 0, test: g => g.got('stone_pickaxe') },
  { id: 'furnace', title: 'Hot Topic', desc: 'Construct a furnace out of eight cobblestone blocks', icon: 'furnace', parent: 'pickaxe', col: 5, row: 1, test: g => g.got('furnace') },
  { id: 'monster', title: 'Monster Hunter', desc: 'Attack and destroy a monster', icon: 'iron_sword', parent: 'sword', col: 5, row: 2, test: g => Object.keys(g.stats.killed || {}).some(t => MOB_DEFS[t] && MOB_DEFS[t].hostile) },
  { id: 'iron', title: 'Acquire Hardware', desc: 'Smelt an iron ingot', icon: 'iron_ingot', parent: 'furnace', col: 6, row: 1, test: g => g.got('iron_ingot') },
  { id: 'diamonds', title: 'Diamonds!', desc: 'Acquire diamonds with your iron tools', icon: 'diamond', parent: 'iron', col: 7, row: 0, test: g => g.got('diamond') },
  { id: 'suit', title: 'Suit Up', desc: 'Protect yourself with a piece of iron armor', icon: 'iron_chestplate', parent: 'iron', col: 7, row: 1, test: g => g.hasItemWhere(n => /^iron_(helmet|chestplate|leggings|boots)$/.test(n)) },
  { id: 'lava', title: 'Hot Stuff', desc: 'Fill a bucket with lava', icon: 'lava_bucket', parent: 'iron', col: 7, row: 2, test: g => g.got('lava_bucket') },
  { id: 'obsidian', title: 'Ice Bucket Challenge', desc: 'Obtain a block of Obsidian', icon: 'obsidian', parent: 'lava', col: 8, row: 2, test: g => g.got('obsidian') || !!(g.stats.mined && g.stats.mined[IID.obsidian]) },
  { id: 'deeper', title: 'We Need to Go Deeper', desc: 'Build, light and enter a Nether Portal', icon: 'flint_and_steel', parent: 'obsidian', col: 9, row: 2, test: g => !!g.stats.dim_nether },
  { id: 'eyespy', title: 'Eye Spy', desc: 'Follow an Eye of Ender', icon: 'ender_eye', parent: 'deeper', col: 10, row: 2, test: g => g.dim === 'overworld' && !!SH.strongholdAt(g.world.seed, Math.floor(g.player.x), Math.floor(g.player.y), Math.floor(g.player.z)) },
  { id: 'enterend', title: 'The End?', desc: 'Enter the End Portal', icon: 'end_stone', parent: 'eyespy', col: 11, row: 2, test: g => !!g.stats.dim_end },
  // ---- Adventure tab
  { id: 'adv_root', tab: 'adventure', title: 'Adventure', desc: 'Adventure, exploration and combat', icon: 'emerald', col: 0, row: 1, test: g => (g.stats.kills || 0) > 0 || (g.stats.deaths || 0) > 0 || !!g.stats.villager_talked },
  { id: 'deal', tab: 'adventure', title: 'What a Deal!', desc: 'Successfully trade with a Villager', icon: 'emerald', parent: 'adv_root', col: 1, row: 0, test: g => !!g.stats.traded },
  { id: 'golem', tab: 'adventure', title: 'Hired Help', desc: 'Summon an Iron Golem to help defend a village', icon: 'iron_block', parent: 'adv_root', col: 1, row: 2, test: g => !!g.stats.golem_built },
  // ---- Nether tab
  { id: 'nether_root', tab: 'nether', title: 'Nether', desc: 'Bring summer clothes', icon: 'nether_bricks', col: 0, row: 2, test: g => !!g.stats.dim_nether },
  { id: 'ghast_back', tab: 'nether', title: 'Return to Sender', desc: 'Destroy a Ghast with a fireball', icon: 'fire_charge', parent: 'nether_root', col: 1, row: 0, test: g => !!g.stats.return_to_sender },
  {
    id: 'subspace', tab: 'nether', title: 'Subspace Bubble', desc: 'Use the Nether to travel 7 km in the Overworld', icon: 'obsidian', parent: 'nether_root', col: 1, row: 1,
    // remember where the trip started (first second in the Nether, scaled x8) and measure on the way out
    test: g => {
      const p = g.player, S = g.stats;
      if (g.dim === 'nether') { if (!S.netherFrom) S.netherFrom = [p.x * 8, p.z * 8]; return false; }
      if (!S.netherFrom) return false;
      const d = g.dim === 'overworld' ? Math.hypot(p.x - S.netherFrom[0], p.z - S.netherFrom[1]) : 0; delete S.netherFrom;
      return d >= 7000;
    },
  },
  { id: 'fortress', tab: 'nether', title: 'A Terrible Fortress', desc: 'Break your way into a Nether Fortress', icon: 'nether_bricks', parent: 'nether_root', col: 1, row: 2, test: g => g.dim === 'nether' && !!SH.fortressAt(g.world.seed, Math.floor(g.player.x), Math.floor(g.player.y), Math.floor(g.player.z)) },
  { id: 'blaze_rod', tab: 'nether', title: 'Into Fire', desc: 'Relieve a Blaze of its rod', icon: 'blaze_rod', parent: 'fortress', col: 2, row: 2, test: g => g.got('blaze_rod') },
  { id: 'shiny', tab: 'nether', title: 'Oh Shiny', desc: 'Distract Piglins with gold', icon: 'gold_ingot', parent: 'nether_root', col: 1, row: 3, test: g => !!g.stats.bartered },
  {
    id: 'tourist', tab: 'nether', title: 'Hot Tourist Destinations', desc: 'Explore all Nether biomes', icon: 'netherrack', parent: 'nether_root', col: 1, row: 4,
    test: g => {
      const S = g.stats;
      if (g.dim === 'nether') { const b = BIOMES[g.world.getBiome(Math.floor(g.player.x), Math.floor(g.player.z))]; if (b) (S.netherBiomes || (S.netherBiomes = {}))[b.name] = 1; }
      return ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas'].every(n => S.netherBiomes && S.netherBiomes[n]);
    },
  },
  // ---- End tab
  { id: 'end_root', tab: 'end', title: 'The End', desc: 'Or the beginning?', icon: 'end_stone', col: 0, row: 1, test: g => !!g.stats.dim_end },
  { id: 'free_end', tab: 'end', title: 'Free the End', desc: 'Good luck', icon: 'dragon_egg', parent: 'end_root', col: 1, row: 1, test: g => !!g.stats.dragon_killed },
  { id: 'egg', tab: 'end', title: 'The Next Generation', desc: 'Hold the Dragon Egg', icon: 'dragon_egg', parent: 'free_end', col: 2, row: 0, test: g => g.hasItemWhere(n => n === 'dragon_egg') },
  { id: 'gateway', tab: 'end', title: 'Remote Getaway', desc: 'Escape the island', icon: 'ender_pearl', parent: 'free_end', col: 2, row: 1, test: g => g.dim === 'end' && g.player.x * g.player.x + g.player.z * g.player.z > 600 * 600 },
  { id: 'again', tab: 'end', title: 'The End... Again...', desc: 'Respawn the Ender Dragon', icon: 'end_crystal', parent: 'free_end', col: 2, row: 2, test: g => !!g.respawnSeq },
];
const ADV_BY_ID = {}; for (const a of ADVANCEMENTS) { if (!a.tab) a.tab = 'story'; ADV_BY_ID[a.id] = a; }
const ADV_TABS = [{ id: 'story', name: 'Minecraft', icon: 'grass_block' }, { id: 'adventure', name: 'Adventure', icon: 'emerald' }, { id: 'nether', name: 'Nether', icon: 'nether_bricks' }, { id: 'end', name: 'The End', icon: 'end_stone' }];

Object.assign(Game.prototype, {
  // ---- counters
  stat(key, id, n) {
    const S = this.stats; n = n === undefined ? 1 : n;
    if (id === undefined) S[key] = (S[key] || 0) + n;
    else { const m = S[key] || (S[key] = {}); m[id] = (m[id] || 0) + n; }
  },
  hasItemWhere(fn) {
    const p = this.player; if (!p) return false;
    for (const s of p.inv) if (s && ITEMS[s.id] && fn(ITEMS[s.id].name)) return true;
    for (const s of p.armor) if (s && ITEMS[s.id] && fn(ITEMS[s.id].name)) return true;
    return false;
  },
  // carries the item now or has crafted / smelted it before
  got(name) { const id = IID[name]; return this.hasItemWhere(n => n === name) || !!(this.stats.crafted && this.stats.crafted[id] > 0); },
  // ---- advancements
  progressTick() {
    const silent = this.advSilent; this.advSilent = false;
    for (const a of ADVANCEMENTS) {
      if (this.advDone.has(a.id)) continue;
      let ok = false; try { ok = !!a.test(this); } catch (e) { }
      if (ok) this.grantAdvancement(a, silent || a.id === 'root');
    }
  },
  grantAdvancement(a, silent) {
    this.advDone.add(a.id);
    if (silent) return;
    this.toasts.push({ adv: a, t0: this.tick });
    this.addChat('Player has made the advancement §a[' + a.title + ']');
    this.sound('random.orb', undefined, 0, 0, 0.5, 1.3);
  },
  // toasts slide in from the top-right corner, stay for five seconds and slide out again
  drawToasts(ui, partial) {
    const ts = this.toasts; if (!ts.length) return;
    const g = ui.g, W = ui.w, t = this.tick + partial;
    for (let i = ts.length - 1; i >= 0; i--) if (t - ts[i].t0 > 112) ts.splice(i, 1);
    for (let i = 0; i < Math.min(ts.length, 3); i++) {
      const T = ts[i], age = t - T.t0, inn = Math.min(1, age / 6), out = age > 106 ? Math.min(1, (age - 106) / 6) : 0;
      const x = Math.round(W - 160 * (inn * (1 - out))), y = i * 32;
      g.fillStyle = 'rgba(20,20,20,0.92)'; g.fillRect(x, y, 160, 32);
      g.fillStyle = '#5c5c5c'; g.fillRect(x, y, 160, 1); g.fillRect(x, y + 31, 160, 1); g.fillRect(x, y, 1, 32);
      g.fillStyle = '#2f2f2f'; g.fillRect(x + 1, y + 1, 158, 1); g.fillRect(x + 1, y + 30, 158, 1); g.fillRect(x + 1, y + 1, 1, 30);
      const st = IID[T.adv.icon] !== undefined ? newStack(IID[T.adv.icon], 1) : null; if (st) ui.item(st, x + 8, y + 8);
      ui.text('Advancement Made!', x + 30, y + 7, '#ffff00');
      ui.text(T.adv.title, x + 30, y + 18, '#ffffff');
    }
  },
});

// ---------------------------------------------------------------- advancements screen
class AdvancementsScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.dimWorld = game.state === 'play'; this.pausesGame = game.state === 'play'; this.needsCursor = true; this.tab = 'story'; this.panX = 0; this.drag = null; }
  mouseDown(x, y, b) {
    // tabs along the top of the window, dragging pans the tree
    const W = this.game.ui.w, H = this.game.ui.h, ox = Math.round((W - 252) / 2), oy = Math.round((H - 140) / 2);
    for (let i = 0; i < ADV_TABS.length; i++) { const tx = ox + i * 29, ty = oy - 28; if (x >= tx && x < tx + 28 && y >= ty && y < ty + 30) { this.tab = ADV_TABS[i].id; this.panX = this.panY = 0; this.game.uiClick(); return; } }
    if (b === 0 && x >= ox + 9 && x < ox + 243 && y >= oy + 18 && y < oy + 131) this.drag = { x, y, px: this.panX, py: this.panY };
    super.mouseDown(x, y, b);
  }
  mouseUp() { this.drag = null; }
  draw(ui) {
    this.beginFrame(); const g = ui.g, G = this.game, W = ui.w, H = ui.h, m = G.mouse;
    const ww = 252, wh = 140, ox = Math.round((W - ww) / 2), oy = Math.round((H - wh) / 2);
    const list = ADVANCEMENTS.filter(a => a.tab === this.tab), tabInfo = ADV_TABS.find(t => t.id === this.tab);
    // tabs (vanilla draws them as raised buttons along the window top)
    // (the selected one is drawn after the window so it merges into the frame)
    const drawTab = (t, i, sel) => {
      const tx = ox + i * 29, ty = oy - 28;
      g.fillStyle = '#000'; g.fillRect(tx, ty, 28, sel ? 32 : 31); g.fillStyle = sel ? '#c6c6c6' : '#8b8b8b'; g.fillRect(tx + 1, ty + 1, 26, sel ? 32 : 29);
      g.fillStyle = sel ? '#ffffff' : '#a5a5a5'; g.fillRect(tx + 1, ty + 1, 26, 2); g.fillRect(tx + 1, ty + 1, 2, sel ? 31 : 29);
      g.fillStyle = sel ? '#555555' : '#6b6b6b'; g.fillRect(tx + 25, ty + 3, 2, sel ? 29 : 27);
      if (IID[t.icon] !== undefined) ui.item(newStack(IID[t.icon], 1), tx + 6, ty + (sel ? 7 : 8));
    };
    ADV_TABS.forEach((t, i) => { if (t.id !== this.tab) drawTab(t, i, false); });
    ui.panel(ox, oy, ww, wh);
    ADV_TABS.forEach((t, i) => { if (t.id === this.tab) drawTab(t, i, true); });
    ui.text(tabInfo ? tabInfo.name : 'Advancements', ox + 8, oy + 6, '#404040', false);
    const ax = ox + 9, ay = oy + 18, aw = 234, ah = 113;
    // trees wider / taller than the viewport pan by dragging (like vanilla's AdvancementTab)
    const maxCol = list.reduce((s, a) => Math.max(s, a.col), 0), maxRow = list.reduce((s, a) => Math.max(s, a.row), 0);
    const maxX = Math.max(0, (maxCol + 1) * 28 + 6 - aw), maxY = Math.max(0, (maxRow + 1) * 27 + 6 - ah);
    if (this.drag && (m.buttons & 1)) { this.panX = this.drag.px + (this.drag.x - m.x); this.panY = this.drag.py + (this.drag.y - m.y); } else this.drag = null;
    this.panX = clamp(this.panX || 0, 0, maxX); this.panY = clamp(this.panY || 0, 0, maxY);
    const px = Math.round(this.panX), py = Math.round(this.panY);
    g.save(); g.beginPath(); g.rect(ax, ay, aw, ah); g.clip();
    const bg = this.tab === 'nether' ? 'netherrack' : this.tab === 'end' ? 'end_stone' : this.tab === 'adventure' ? 'oak_planks' : 'stone';
    for (let yy = ay - (py % 16); yy < ay + ah; yy += 16) for (let xx = ax - (px % 16); xx < ax + aw; xx += 16) ui.tile(bg, xx, yy, 16);
    g.fillStyle = 'rgba(0,0,0,0.66)'; g.fillRect(ax, ay, aw, ah);
    // small trees sit centred in the viewport
    const cx = maxX ? 0 : Math.floor((aw - 8 - ((maxCol + 1) * 28 - 2)) / 2), cy = maxY ? 0 : Math.floor((ah - 8 - ((maxRow + 1) * 27 - 1)) / 2);
    const nx = a => ax + 4 + cx + a.col * 28 - px, ny = a => ay + 4 + cy + a.row * 27 - py;
    const done = a => G.advDone.has(a.id);
    // connectors (drawn first so the frames sit on top)
    for (const a of list) {
      if (!a.parent) continue;
      const p = ADV_BY_ID[a.parent], x0 = nx(p) + 26, y0 = ny(p) + 13, x1 = nx(a), y1 = ny(a) + 13, xm = x0 + 1;
      const seg = (col, w) => { g.fillStyle = col; g.fillRect(x0 - 2, y0 - (w >> 1), xm - x0 + 3, w); g.fillRect(xm - (w >> 1), Math.min(y0, y1) - (w >> 1), w, Math.abs(y1 - y0) + w); g.fillRect(xm, y1 - (w >> 1), x1 - xm + 2, w); };
      seg('#000000', 3); seg(done(a) ? '#ffffff' : '#7d7d7d', 1);
    }
    let hover = null;
    for (const a of list) {
      const x = nx(a), y = ny(a), d = done(a);
      g.fillStyle = '#000'; g.fillRect(x, y, 26, 26);
      g.fillStyle = d ? '#c8d3e6' : '#525a6b'; g.fillRect(x + 1, y + 1, 24, 24);
      g.fillStyle = d ? '#f2f6ff' : '#3a3f4c'; g.fillRect(x + 1, y + 1, 24, 1); g.fillRect(x + 1, y + 1, 1, 24);
      g.fillStyle = d ? '#8a97b3' : '#2a2d36'; g.fillRect(x + 1, y + 24, 24, 1); g.fillRect(x + 24, y + 1, 1, 24);
      g.fillStyle = d ? '#7b88a6' : '#22252d'; g.fillRect(x + 3, y + 3, 20, 20);
      const st = IID[a.icon] !== undefined ? newStack(IID[a.icon], 1) : null; if (st) { if (!d) g.globalAlpha = 0.55; ui.item(st, x + 5, y + 5); g.globalAlpha = 1; }
      if (m.x >= x && m.x < x + 26 && m.y >= y && m.y < y + 26 && m.x >= ax && m.x < ax + aw && m.y >= ay && m.y < ay + ah) hover = a;
    }
    g.restore();
    const n = list.filter(a => G.advDone.has(a.id)).length;
    ui.textR(n + '/' + list.length, ox + ww - 10, oy + 6, '#404040', false);
    if (hover) ui.tooltip([hover.title, '§7' + hover.desc], Math.round(m.x), Math.round(m.y));
    else { for (let i = 0; i < ADV_TABS.length; i++) { const tx = ox + i * 29, ty = oy - 28; if (m.x >= tx && m.x < tx + 28 && m.y >= ty && m.y < ty + 28) ui.tooltip([ADV_TABS[i].name], Math.round(m.x), Math.round(m.y)); } }
  }
  keyDown(e) { if (e.code === 'Escape' || e.code === 'KeyL') this.game.openScreen(this.parent); }
}

// ---------------------------------------------------------------- statistics screen
class StatsScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.dimWorld = false; this.pausesGame = game.state === 'play'; this.needsCursor = true; this.tab = 0; this.scroll = 0; }
  rows() {
    const S = this.game.stats, sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0), nm = id => (ITEMS[id] ? ITEMS[id].disp : '?');
    const dist = b => (b || 0) < 1000 ? Math.round(b || 0) + ' m' : ((b || 0) / 1000).toFixed(2) + ' km';
    const secs = Math.floor((S.play || 0) / 20), time = Math.floor(secs / 3600) + ' h ' + Math.floor(secs % 3600 / 60) + ' min ' + (secs % 60) + ' s';
    if (this.tab === 0) return [
      ['Time Played', time], ['Distance Walked', dist(S.walk)], ['Distance Flown', dist(S.fly)], ['Jumps', String(S.jumps || 0)], ['Deaths', String(S.deaths || 0)], ['Mob Kills', String(S.kills || 0)],
      ['Animals Bred', String(S.bred || 0)], ['Damage Dealt', ((S.dmgDealt || 0) / 2).toFixed(1) + ' hearts'], ['Damage Taken', ((S.dmgTaken || 0) / 2).toFixed(1) + ' hearts'],
      ['Blocks Mined', String(sum(S.mined))], ['Blocks Placed', String(sum(S.placed))], ['Items Crafted', String(sum(S.crafted))], ['Times Slept in a Bed', String(S.slept || 0)],
    ];
    if (this.tab === 1) {
      const ids = new Set([...Object.keys(S.mined || {}), ...Object.keys(S.placed || {}), ...Object.keys(S.crafted || {})].map(Number));
      return Array.from(ids).sort((a, b) => nm(a).localeCompare(nm(b))).map(id => {
        const parts = []; if (S.mined && S.mined[id]) parts.push('Mined ' + S.mined[id]); if (S.placed && S.placed[id]) parts.push('Placed ' + S.placed[id]); if (S.crafted && S.crafted[id]) parts.push('Crafted ' + S.crafted[id]);
        return [nm(id), parts.join(', ')];
      });
    }
    const types = new Set([...Object.keys(S.killed || {}), ...Object.keys(S.killedBy || {})]);
    return Array.from(types).sort().map(t => { const nice = t.charAt(0).toUpperCase() + t.slice(1), parts = []; if (S.killed && S.killed[t]) parts.push('Killed ' + S.killed[t]); if (S.killedBy && S.killedBy[t]) parts.push('Killed by ' + S.killedBy[t]); return [nice, parts.join(', ')]; });
  }
  draw(ui) {
    this.beginFrame(); const g = ui.g, W = ui.w, H = ui.h, G = this.game;
    ui.dirtBackground(0, 0, W, H);
    ui.textC('Statistics', W / 2, 14, '#ffffff');
    const tabs = ['General', 'Items', 'Mobs'];
    for (let i = 0; i < 3; i++) this.btn(ui, Math.round(W / 2 - 154 + i * 104), 26, 100, 20, tabs[i], () => { this.tab = i; this.scroll = 0; }, this.tab !== i);
    const lx = Math.round(W / 2 - 150), ly = 52, lw = 300, lh = H - 52 - 34, rows = this.rows(), rh = 14;
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(lx, ly, lw, lh);
    this.max = Math.max(0, rows.length * rh - lh + 4); this.scroll = clamp(this.scroll, 0, this.max);
    g.save(); g.beginPath(); g.rect(lx, ly, lw, lh); g.clip();
    rows.forEach((r, i) => {
      const y = ly + 2 + i * rh - this.scroll; if (y < ly - rh || y > ly + lh) return;
      if (i % 2 === 0) { g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(lx, y, lw, rh); }
      ui.text(r[0], lx + 6, y + 3, '#ffffff'); ui.textR(r[1], lx + lw - 6, y + 3, '#a0a0a0');
    });
    g.restore();
    if (!rows.length) ui.textC('Nothing here yet', W / 2, ly + 20, '#808080');
    this.btn(ui, Math.round(W / 2 - 100), H - 28, 200, 20, 'Done', () => G.openScreen(this.parent));
  }
  wheel(d) { this.scroll += Math.sign(d) * 14; }
  keyDown(e) { if (e.code === 'Escape') this.game.openScreen(this.parent); }
}
