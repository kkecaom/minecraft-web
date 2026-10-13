// ===== shared_blocks.js : block registry, lookup tables, box models, biomes =====
// Face order everywhere: 0 down(-y) 1 up(+y) 2 north(-z) 3 south(+z) 4 west(-x) 5 east(+x)
const M_NONE = 0, M_CUBE = 1, M_CUTOUT = 2, M_TRANS = 3, M_LIQUID = 4, M_CROSS = 5, M_CROP = 6, M_BOX = 7, M_FIRE = 8, M_PORTAL = 9;
const BLOCKS = [];      // id -> definition
const BID = {};         // name -> id

function faces6(t) {
  if (!t) return null;
  if (typeof t === 'string') return [t, t, t, t, t, t];
  if (Array.isArray(t)) return t;
  const s = t.side !== undefined ? t.side : t.all;
  const top = t.top !== undefined ? t.top : (t.all !== undefined ? t.all : s);
  const bot = t.bottom !== undefined ? t.bottom : (t.all !== undefined ? t.all : s);
  return [bot, top, t.north || s, t.south || s, t.west || s, t.east || s];
}

function reg(name, o) {
  const d = Object.assign({
    name, model: M_CUBE, solid: true, opaque: true, opacity: 15, light: 0, hard: 1, tool: null, tier: 0, needTool: false,
    sound: 'stone', drops: undefined, tint: null, replaceable: false, tiles: name,
  }, o || {});
  if (d.model !== M_CUBE || d.opacity !== 15) { /* keep explicit */ }
  d.id = BLOCKS.length;
  d.faceNames = faces6(d.tiles);
  if (BID[name] !== undefined) throw new Error('duplicate block ' + name);
  BLOCKS.push(d);
  BID[name] = d.id;
  return d;
}
const cutout = { model: M_CUTOUT, opaque: false, opacity: 0 };
const nonSolid = { solid: false, opaque: false, opacity: 0 };
const plant = Object.assign({ model: M_CROSS, hard: 0, sound: 'plant', replaceable: false }, nonSolid);

// ---------------------------------------------------------------- definitions
reg('air', { model: M_NONE, solid: false, opaque: false, opacity: 0, hard: 0, replaceable: true, tiles: null, sound: '' });

// terrain
reg('stone', { hard: 1.5, tool: 'pickaxe', needTool: true, drops: 'cobblestone' });
reg('granite', { hard: 1.5, tool: 'pickaxe', needTool: true });
reg('diorite', { hard: 1.5, tool: 'pickaxe', needTool: true });
reg('andesite', { hard: 1.5, tool: 'pickaxe', needTool: true });
reg('grass_block', { tiles: { top: 'grass_block_top', bottom: 'dirt', side: 'grass_block_side' }, overlay: 'grass_block_side_overlay', tint: 'grass', tintTopOnly: true, hard: 0.6, tool: 'shovel', drops: 'dirt', sound: 'grass' });
reg('grass_block_snowy', { tiles: { top: 'snow', bottom: 'dirt', side: 'grass_block_snow' }, hard: 0.6, tool: 'shovel', drops: 'dirt', sound: 'grass' });
reg('dirt', { hard: 0.5, tool: 'shovel', sound: 'gravel' });
reg('podzol', { tiles: { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' }, hard: 0.5, tool: 'shovel', sound: 'gravel' });
reg('cobblestone', { hard: 2, tool: 'pickaxe', needTool: true });
reg('mossy_cobblestone', { hard: 2, tool: 'pickaxe', needTool: true });
reg('stone_bricks', { hard: 1.5, tool: 'pickaxe', needTool: true });
reg('bricks', { hard: 2, tool: 'pickaxe', needTool: true });
reg('smooth_stone', { hard: 2, tool: 'pickaxe', needTool: true });
reg('bedrock', { hard: -1 });
reg('sand', { hard: 0.5, tool: 'shovel', sound: 'sand', falling: true });
reg('gravel', { hard: 0.6, tool: 'shovel', sound: 'gravel', falling: true, drops: 'special:gravel' });
reg('sandstone', { tiles: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, hard: 0.8, tool: 'pickaxe', needTool: true });
reg('clay', { hard: 0.6, tool: 'shovel', sound: 'gravel', drops: [['clay_ball', 4, 4]] });
reg('snow_block', { tiles: 'snow', hard: 0.2, tool: 'shovel', sound: 'snow', drops: [['snowball', 4, 4]] });
reg('ice', { model: M_TRANS, opaque: false, opacity: 1, hard: 0.5, tool: 'pickaxe', sound: 'glass', drops: null, cullSame: true, slip: true });
reg('obsidian', { hard: 50, tool: 'pickaxe', needTool: true, tier: 3 });
reg('glass', Object.assign({ hard: 0.3, sound: 'glass', drops: null, cullSame: true }, cutout));

// liquids (meta: bits0-2 = distance from source (0 = source), bit3 = falling)
reg('water', { model: M_LIQUID, solid: false, opaque: false, opacity: 1, hard: -1, replaceable: true, tiles: 'water_still', fluid: 1, tint: 'water', drops: null, sound: '' });
reg('lava', { model: M_LIQUID, solid: false, opaque: false, opacity: 1, light: 15, hard: -1, replaceable: true, tiles: 'lava_still', fluid: 2, drops: null, sound: '' });

// ores
reg('coal_ore', { hard: 3, tool: 'pickaxe', needTool: true, drops: [['coal', 1, 1]] });
reg('iron_ore', { hard: 3, tool: 'pickaxe', needTool: true, tier: 1 });
reg('gold_ore', { hard: 3, tool: 'pickaxe', needTool: true, tier: 2 });
reg('diamond_ore', { hard: 3, tool: 'pickaxe', needTool: true, tier: 2, drops: [['diamond', 1, 1]] });
reg('redstone_ore', { hard: 3, tool: 'pickaxe', needTool: true, tier: 2, drops: [['redstone', 4, 5]] });
reg('lapis_ore', { hard: 3, tool: 'pickaxe', needTool: true, tier: 1, drops: [['lapis_lazuli', 4, 8]] });
reg('emerald_ore', { hard: 3, tool: 'pickaxe', needTool: true, tier: 2, drops: [['emerald', 1, 1]] });

// wood
const WOODS = ['oak', 'spruce', 'birch'];
for (const w of WOODS) reg(w + '_planks', { hard: 2, tool: 'axe', sound: 'wood' });
for (const w of WOODS) reg(w + '_log', { tiles: { top: w + '_log_top', bottom: w + '_log_top', side: w + '_log' }, hard: 2, tool: 'axe', sound: 'wood', log: true });
const leafTint = { oak: 'foliage', spruce: 'spruce', birch: 'birch' };
for (const w of WOODS) reg(w + '_leaves', Object.assign({
  hard: 0.2, sound: 'plant', tint: leafTint[w], leaves: true, tool: 'shears',
  drops: [[w + '_sapling', 1, 1, 0.05], ['stick', 1, 2, 0.02]].concat(w === 'oak' ? [['apple', 1, 1, 0.005]] : []),
}, { model: M_CUTOUT, opaque: false, opacity: 1 }));
for (const w of WOODS) reg(w + '_sapling', Object.assign({}, plant, { sapling: w }));

// wool
const WOOL = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
for (const c of WOOL) reg(c + '_wool', { hard: 0.8, tool: 'shears', sound: 'cloth' });

// storage blocks
reg('iron_block', { hard: 5, tool: 'pickaxe', needTool: true, tier: 1, sound: 'metal' });
reg('gold_block', { hard: 3, tool: 'pickaxe', needTool: true, tier: 2, sound: 'metal' });
reg('diamond_block', { hard: 5, tool: 'pickaxe', needTool: true, tier: 2, sound: 'metal' });
reg('emerald_block', { hard: 5, tool: 'pickaxe', needTool: true, tier: 2, sound: 'metal' });
reg('lapis_block', { hard: 3, tool: 'pickaxe', needTool: true, tier: 1, sound: 'stone' });
reg('coal_block', { hard: 5, tool: 'pickaxe', needTool: true, sound: 'stone' });
reg('redstone_block', { hard: 5, tool: 'pickaxe', needTool: true, sound: 'metal' });

// functional / decorative cubes
reg('glowstone', { light: 15, hard: 0.3, sound: 'glass', drops: [['glowstone_dust', 2, 4]] });
reg('tnt', { tiles: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hard: 0, sound: 'grass' });
reg('bookshelf', { tiles: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, hard: 1.5, tool: 'axe', sound: 'wood', drops: [['book', 3, 3]] });
reg('crafting_table', { tiles: { top: 'crafting_table_top', bottom: 'oak_planks', north: 'crafting_table_front', south: 'crafting_table_front', west: 'crafting_table_side', east: 'crafting_table_side' }, hard: 2.5, tool: 'axe', sound: 'wood' });
reg('furnace', { tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, orient: true, hard: 3.5, tool: 'pickaxe', needTool: true, tile: 'furnace', hasEntity: 'furnace' });
reg('furnace_lit', { tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on' }, orient: true, light: 13, hard: 3.5, tool: 'pickaxe', needTool: true, drops: [['furnace', 1, 1]], hasEntity: 'furnace' });
reg('pumpkin', { tiles: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' }, hard: 1, tool: 'axe', sound: 'wood' });
reg('carved_pumpkin', { tiles: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'carved_pumpkin' }, orient: true, hard: 1, tool: 'axe', sound: 'wood' });
reg('jack_o_lantern', { tiles: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, orient: true, light: 15, hard: 1, tool: 'axe', sound: 'wood' });
reg('melon', { tiles: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' }, hard: 1, tool: 'axe', sound: 'wood', drops: [['melon_slice', 3, 7]] });
reg('hay_block', { tiles: { top: 'hay_block_top', bottom: 'hay_block_top', side: 'hay_block_side' }, hard: 0.5, sound: 'grass' });

// non-cube models -------------------------------------------------------
reg('torch', Object.assign({ model: M_BOX, hard: 0, sound: 'wood', light: 14, tiles: 'torch', torch: true }, nonSolid, { sel: [6, 0, 6, 10, 10, 10] }));
reg('ladder', Object.assign({ model: M_BOX, hard: 0.4, tool: 'axe', sound: 'wood', tiles: 'ladder', climbable: true }, nonSolid));
reg('oak_door', Object.assign({ model: M_BOX, hard: 3, tool: 'axe', sound: 'wood', tiles: 'oak_door_bottom', door: true, drops: 'special:door' }, nonSolid));
reg('oak_fence', { model: M_BOX, hard: 2, tool: 'axe', sound: 'wood', tiles: 'oak_planks', opaque: false, opacity: 0, solid: true, fence: true, conn: 1 });
reg('chest', { model: M_BOX, orient: true, hard: 2.5, tool: 'axe', sound: 'wood', tiles: 'chest_side', opaque: false, opacity: 0, solid: true, hasEntity: 'chest' });
reg('bed', { model: M_BOX, hard: 0.2, sound: 'wood', tiles: 'bed_bottom', opaque: false, opacity: 0, solid: true, drops: 'special:bed', bed: true });
reg('cactus', { model: M_BOX, hard: 0.4, sound: 'cloth', tiles: 'cactus_side', opaque: false, opacity: 0, solid: true, cactus: true });
reg('farmland', { model: M_BOX, hard: 0.6, tool: 'shovel', sound: 'gravel', tiles: 'dirt', opaque: false, opacity: 0, solid: true, drops: 'dirt', farmland: true });
reg('snow_layer', { model: M_BOX, hard: 0.1, tool: 'shovel', sound: 'snow', tiles: 'snow', opaque: false, opacity: 0, solid: true, drops: 'special:snow', layer: true });
reg('lily_pad', Object.assign({ model: M_BOX, hard: 0, sound: 'plant', tiles: 'lily_pad', tint: 'lily', lily: true }, nonSolid));

// slabs and stairs (opacity 15: they block skylight like real MC, sampled specially by the mesher)
const SLAB_DEFS = [['oak', 'oak_planks', 'wood', 2, 'axe'], ['spruce', 'spruce_planks', 'wood', 2, 'axe'], ['birch', 'birch_planks', 'wood', 2, 'axe'], ['cobblestone', 'cobblestone', 'stone', 2, 'pickaxe'],
  ['stone', 'smooth_stone', 'stone', 2, 'pickaxe'], ['stone_brick', 'stone_bricks', 'stone', 2, 'pickaxe'], ['brick', 'bricks', 'stone', 2, 'pickaxe'], ['sandstone', 'sandstone', 'stone', 2, 'pickaxe']];
for (const [n, base, snd, h, tl] of SLAB_DEFS) {
  reg(n + '_slab', { model: M_BOX, hard: h, tool: tl, needTool: tl === 'pickaxe', sound: snd, base, slab: true, opaque: false, opacity: 15, solid: true, tiles: base });
}
const STAIR_DEFS = [['oak', 'oak_planks', 'wood', 2, 'axe'], ['spruce', 'spruce_planks', 'wood', 2, 'axe'], ['birch', 'birch_planks', 'wood', 2, 'axe'], ['cobblestone', 'cobblestone', 'stone', 2, 'pickaxe'],
  ['stone', 'stone', 'stone', 1.5, 'pickaxe'], ['stone_brick', 'stone_bricks', 'stone', 1.5, 'pickaxe'], ['brick', 'bricks', 'stone', 2, 'pickaxe'], ['sandstone', 'sandstone', 'stone', 0.8, 'pickaxe']];
for (const [n, base, snd, h, tl] of STAIR_DEFS) {
  reg(n + '_stairs', { model: M_BOX, hard: h, tool: tl, needTool: tl === 'pickaxe', sound: snd, base, stairs: true, opaque: false, opacity: 15, solid: true, tiles: base });
}

// plants (cross models)
reg('short_grass', Object.assign({}, plant, { tint: 'grass', replaceable: true, offset: true, drops: [['wheat_seeds', 1, 1, 0.125]], shearsDrop: 'short_grass' }));
reg('fern', Object.assign({}, plant, { tint: 'grass', replaceable: true, offset: true, drops: [['wheat_seeds', 1, 1, 0.125]], shearsDrop: 'fern' }));
for (const f of ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'oxeye_daisy', 'cornflower']) reg(f, Object.assign({}, plant, { offset: true, flower: true }));
reg('brown_mushroom', Object.assign({}, plant, { light: 1, mushroom: true }));
reg('red_mushroom', Object.assign({}, plant, { mushroom: true }));
reg('dead_bush', Object.assign({}, plant, { replaceable: true, offset: true, drops: [['stick', 0, 2]] }));
reg('sugar_cane', Object.assign({}, plant, { tint: 'grass', cane: true }));
reg('wheat', Object.assign({}, plant, { model: M_CROP, crop: true, drops: 'special:wheat', stageTiles: ['wheat_stage0', 'wheat_stage1', 'wheat_stage2', 'wheat_stage3', 'wheat_stage4', 'wheat_stage5', 'wheat_stage6', 'wheat_stage7'], tiles: 'wheat_stage0' }));

// ---- content update: fire, panes, bars, gates, trapdoors, walls, vines, webs, spawners, carpets
// conn: connection rule (1 fence, 2 pane/bars, 3 wall); enc/flam: fire encouragement and flammability (BlockFire)
reg('fire', { model: M_FIRE, solid: false, opaque: false, opacity: 0, light: 15, hard: 0, replaceable: true, tiles: 'fire_layer_0', drops: null, sound: '', fire: true });
reg('glass_pane', { model: M_BOX, hard: 0.3, sound: 'glass', tiles: 'glass', opaque: false, opacity: 0, solid: true, drops: null, conn: 2, pane: true });
reg('iron_bars', { model: M_BOX, hard: 5, tool: 'pickaxe', needTool: true, tier: 1, sound: 'metal', tiles: 'iron_bars', opaque: false, opacity: 0, solid: true, conn: 2, pane: true, bars: true });
reg('oak_fence_gate', { model: M_BOX, hard: 2, tool: 'axe', sound: 'wood', tiles: 'oak_planks', opaque: false, opacity: 0, solid: true, gate: true, enc: 5, flam: 20 });
reg('oak_trapdoor', { model: M_BOX, hard: 3, tool: 'axe', sound: 'wood', tiles: 'oak_trapdoor', opaque: false, opacity: 0, solid: true, trapdoor: true });
reg('cobblestone_wall', { model: M_BOX, hard: 2, tool: 'pickaxe', needTool: true, sound: 'stone', tiles: 'cobblestone', opaque: false, opacity: 0, solid: true, conn: 3, wall: true });
reg('mossy_cobblestone_wall', { model: M_BOX, hard: 2, tool: 'pickaxe', needTool: true, sound: 'stone', tiles: 'mossy_cobblestone', opaque: false, opacity: 0, solid: true, conn: 3, wall: true });
reg('vine', { model: M_BOX, hard: 0.2, tool: 'axe', sound: 'plant', tiles: 'vine', tint: 'foliage', opaque: false, opacity: 0, solid: false, replaceable: true, drops: null, shearsDrop: 'vine', vine: true, climbable: true, enc: 15, flam: 100 });
reg('cobweb', Object.assign({}, plant, { hard: 4, sound: 'cloth', tiles: 'cobweb', opacity: 1, needTool: true, tool: 'sword', drops: [['string', 1, 1]], shearsDrop: 'cobweb', web: true }));
reg('spawner', { model: M_CUTOUT, opaque: false, opacity: 0, hard: 5, tool: 'pickaxe', needTool: true, sound: 'metal', tiles: 'spawner', drops: null, hasEntity: 'spawner', spawner: true });
for (const c of WOOL) reg(c + '_carpet', { model: M_BOX, hard: 0.1, sound: 'cloth', tiles: c + '_wool', opaque: false, opacity: 0, solid: true, carpet: true, enc: 60, flam: 20 });

// ---- new biome blocks: acacia / jungle / dark oak wood families, terracotta, red sand, coarse dirt
const NEW_WOODS = ['acacia', 'jungle', 'dark_oak'];
for (const w of NEW_WOODS) reg(w + '_planks', { hard: 2, tool: 'axe', sound: 'wood' });
for (const w of NEW_WOODS) reg(w + '_log', { tiles: { top: w + '_log_top', bottom: w + '_log_top', side: w + '_log' }, hard: 2, tool: 'axe', sound: 'wood', log: true });
for (const w of NEW_WOODS) reg(w + '_leaves', Object.assign({ hard: 0.2, sound: 'plant', tint: 'foliage', leaves: true, tool: 'shears', drops: [[w + '_sapling', 1, 1, w === 'jungle' ? 0.025 : 0.05], ['stick', 1, 2, 0.02]] }, { model: M_CUTOUT, opaque: false, opacity: 1 }));
for (const w of NEW_WOODS) reg(w + '_sapling', Object.assign({}, plant, { sapling: w }));
for (const w of NEW_WOODS) {
  reg(w + '_slab', { model: M_BOX, hard: 2, tool: 'axe', sound: 'wood', base: w + '_planks', slab: true, opaque: false, opacity: 15, solid: true, tiles: w + '_planks' });
  reg(w + '_stairs', { model: M_BOX, hard: 2, tool: 'axe', sound: 'wood', base: w + '_planks', stairs: true, opaque: false, opacity: 15, solid: true, tiles: w + '_planks' });
}
reg('terracotta', { hard: 1.25, tool: 'pickaxe', needTool: true, sound: 'stone' });
for (const c of ['orange', 'yellow', 'red', 'brown', 'white', 'light_gray']) reg(c + '_terracotta', { hard: 1.25, tool: 'pickaxe', needTool: true, sound: 'stone' });
reg('red_sand', { hard: 0.5, tool: 'shovel', sound: 'sand', falling: true });
reg('red_sandstone', { tiles: { top: 'red_sandstone_top', bottom: 'red_sandstone_bottom', side: 'red_sandstone' }, hard: 0.8, tool: 'pickaxe', needTool: true });
reg('coarse_dirt', { hard: 0.5, tool: 'shovel', sound: 'gravel' });

// ---- signs: standing (meta = quarter turns, front toward +z at 0) and wall-mounted (meta 2..5 = direction the board faces); text is drawn by g_signs.js
reg('oak_sign', Object.assign({ model: M_BOX, hard: 1, tool: 'axe', sound: 'wood', tiles: 'oak_planks', sign: true, hasEntity: 'sign', drops: [['oak_sign', 1, 1]], enc: 5, flam: 20 }, nonSolid));
reg('oak_wall_sign', Object.assign({ model: M_BOX, hard: 1, tool: 'axe', sound: 'wood', tiles: 'oak_planks', sign: true, wallSign: true, hasEntity: 'sign', drops: [['oak_sign', 1, 1]], enc: 5, flam: 20 }, nonSolid));

// =============================================================== dimensions update: the Nether, the End, villages, strongholds
// ---- the Nether
reg('netherrack', { hard: 0.4, tool: 'pickaxe', needTool: true, sound: 'stone', infiniburn: true, blast: 0.4 });
reg('nether_portal', { model: M_PORTAL, solid: false, opaque: false, opacity: 0, light: 11, hard: -1, tiles: 'nether_portal', drops: null, sound: 'glass', portal: 'nether' });
reg('soul_sand', { hard: 0.5, tool: 'shovel', sound: 'sand', slow: 0.4, collH: 14 / 16 });
reg('soul_soil', { hard: 0.5, tool: 'shovel', sound: 'sand' });
reg('nether_quartz_ore', { hard: 3, tool: 'pickaxe', needTool: true, drops: [['quartz', 1, 1]], xpDrop: [2, 5] });
reg('nether_gold_ore', { tiles: 'nether_gold_ore', hard: 3, tool: 'pickaxe', needTool: true, drops: [['gold_nugget', 2, 6]], xpDrop: [0, 1] });
reg('nether_bricks', { hard: 2, tool: 'pickaxe', needTool: true, blast: 6 });
reg('nether_brick_fence', { model: M_BOX, hard: 2, tool: 'pickaxe', needTool: true, sound: 'stone', tiles: 'nether_bricks', fenceTile: 'nether_bricks', opaque: false, opacity: 0, solid: true, fence: true, conn: 4, blast: 6 });
reg('nether_brick_stairs', { model: M_BOX, hard: 2, tool: 'pickaxe', needTool: true, sound: 'stone', base: 'nether_bricks', stairs: true, opaque: false, opacity: 15, solid: true, tiles: 'nether_bricks', blast: 6 });
reg('nether_brick_slab', { model: M_BOX, hard: 2, tool: 'pickaxe', needTool: true, sound: 'stone', base: 'nether_bricks', slab: true, opaque: false, opacity: 15, solid: true, tiles: 'nether_bricks', blast: 6 });
reg('nether_wart', Object.assign({}, plant, { model: M_CROP, crop: true, wart: true, drops: 'special:nether_wart', tiles: 'nether_wart_stage0',
  stageTiles: ['nether_wart_stage0', 'nether_wart_stage1', 'nether_wart_stage1', 'nether_wart_stage2', 'nether_wart_stage2', 'nether_wart_stage2', 'nether_wart_stage2', 'nether_wart_stage2'] }));
reg('magma_block', { hard: 0.5, tool: 'pickaxe', needTool: true, light: 3, hot: true, infiniburn: true, tiles: 'magma' });
reg('basalt', { tiles: { top: 'basalt_top', bottom: 'basalt_top', side: 'basalt_side' }, hard: 1.25, tool: 'pickaxe', needTool: true, axis: true, blast: 4.2 });
reg('blackstone', { tiles: { top: 'blackstone_top', bottom: 'blackstone_top', side: 'blackstone' }, hard: 1.5, tool: 'pickaxe', needTool: true, blast: 6 });
reg('crimson_nylium', { tiles: { top: 'crimson_nylium', bottom: 'netherrack', side: 'crimson_nylium_side' }, hard: 0.4, tool: 'pickaxe', needTool: true, nylium: 'crimson', drops: 'netherrack' });
reg('warped_nylium', { tiles: { top: 'warped_nylium', bottom: 'netherrack', side: 'warped_nylium_side' }, hard: 0.4, tool: 'pickaxe', needTool: true, nylium: 'warped', drops: 'netherrack' });
reg('crimson_stem', { tiles: { top: 'crimson_stem_top', bottom: 'crimson_stem_top', side: 'crimson_stem' }, hard: 2, tool: 'axe', sound: 'wood', axis: true, stem: true });
reg('warped_stem', { tiles: { top: 'warped_stem_top', bottom: 'warped_stem_top', side: 'warped_stem' }, hard: 2, tool: 'axe', sound: 'wood', axis: true, stem: true });
reg('nether_wart_block', { hard: 1, sound: 'cloth', wartBlock: true });
reg('warped_wart_block', { hard: 1, sound: 'cloth', wartBlock: true });
reg('shroomlight', { hard: 1, sound: 'cloth', light: 15 });
reg('crimson_fungus', Object.assign({}, plant, { fungus: 'crimson', netherPlant: true }));
reg('warped_fungus', Object.assign({}, plant, { fungus: 'warped', netherPlant: true }));
reg('crimson_roots', Object.assign({}, plant, { replaceable: true, netherPlant: true }));
reg('warped_roots', Object.assign({}, plant, { replaceable: true, netherPlant: true }));
reg('weeping_vines', Object.assign({}, plant, { climbable: true, hangVine: true, drops: [['weeping_vines', 1, 1, 0.33]] }));
reg('twisting_vines', Object.assign({}, plant, { climbable: true, upVine: true, drops: [['twisting_vines', 1, 1, 0.33]] }));
reg('soul_fire', { model: M_FIRE, solid: false, opaque: false, opacity: 0, light: 10, hard: 0, replaceable: true, tiles: 'soul_fire_0', drops: null, sound: '', fire: true, soulFire: true });
reg('crimson_planks', { hard: 2, tool: 'axe', sound: 'wood' });
reg('warped_planks', { hard: 2, tool: 'axe', sound: 'wood' });
reg('quartz_block', { tiles: { top: 'quartz_block_top', bottom: 'quartz_block_bottom', side: 'quartz_block_side' }, hard: 0.8, tool: 'pickaxe', needTool: true });
// ---- the End
reg('end_stone', { hard: 3, tool: 'pickaxe', needTool: true, blast: 9 });
reg('end_portal_frame', { model: M_BOX, hard: -1, light: 1, sound: 'glass', tiles: { top: 'end_portal_frame_top', bottom: 'end_stone', side: 'end_portal_frame_side' }, opaque: false, opacity: 0, solid: true, endFrame: true, drops: null, blast: 3600000 });
reg('end_portal', { model: M_BOX, solid: false, opaque: false, opacity: 0, light: 15, hard: -1, tiles: 'end_portal', drops: null, sound: '', portal: 'end', cullSame: true, sel: [0, 6, 0, 16, 12, 16] });
reg('end_stone_bricks', { hard: 3, tool: 'pickaxe', needTool: true, blast: 9 });
reg('purpur_block', { hard: 1.5, tool: 'pickaxe', needTool: true, blast: 6 });
reg('purpur_pillar', { tiles: { top: 'purpur_pillar_top', bottom: 'purpur_pillar_top', side: 'purpur_pillar' }, hard: 1.5, tool: 'pickaxe', needTool: true, axis: true, blast: 6 });
reg('purpur_stairs', { model: M_BOX, hard: 1.5, tool: 'pickaxe', needTool: true, sound: 'stone', base: 'purpur_block', stairs: true, opaque: false, opacity: 15, solid: true, tiles: 'purpur_block', blast: 6 });
reg('purpur_slab', { model: M_BOX, hard: 2, tool: 'pickaxe', needTool: true, sound: 'stone', base: 'purpur_block', slab: true, opaque: false, opacity: 15, solid: true, tiles: 'purpur_block', blast: 6 });
reg('chorus_plant', { model: M_BOX, hard: 0.4, tool: 'axe', sound: 'wood', tiles: 'chorus_plant', opaque: false, opacity: 0, solid: true, chorus: 'plant', drops: [['chorus_fruit', 0, 1]] });
reg('chorus_flower', { model: M_BOX, hard: 0.4, tool: 'axe', sound: 'wood', tiles: 'chorus_flower', opaque: false, opacity: 0, solid: true, chorus: 'flower', drops: [['chorus_flower', 1, 1]] });
reg('dragon_egg', { model: M_BOX, hard: 3, sound: 'stone', tiles: 'dragon_egg', opaque: false, opacity: 0, solid: true, light: 1, dragonEgg: true, falling: true, blast: 9 });
reg('end_rod', { model: M_BOX, hard: 0, sound: 'wood', tiles: 'end_rod', opaque: false, opacity: 0, solid: true, light: 14, endRod: true });
reg('end_gateway', { model: M_BOX, solid: false, opaque: false, opacity: 0, light: 15, hard: -1, tiles: 'end_gateway', drops: null, sound: '', portal: 'gateway', cullSame: true });
// ---- villages
reg('dirt_path', { model: M_BOX, tiles: { top: 'dirt_path_top', bottom: 'dirt', side: 'dirt_path_side' }, hard: 0.65, tool: 'shovel', sound: 'gravel', opaque: false, opacity: 15, solid: true, drops: 'dirt', path: true });
reg('bell', { model: M_BOX, hard: 5, tool: 'pickaxe', sound: 'metal', tiles: 'bell_body', opaque: false, opacity: 0, solid: true, bell: true });
reg('composter', { model: M_BOX, hard: 0.6, tool: 'axe', sound: 'wood', tiles: { top: 'composter_top', bottom: 'composter_bottom', side: 'composter_side' }, opaque: false, opacity: 0, solid: true, composter: true, workstation: 'farmer', enc: 5, flam: 20 });
reg('lectern', { model: M_BOX, hard: 2.5, tool: 'axe', sound: 'wood', tiles: 'lectern_top', opaque: false, opacity: 0, solid: true, lectern: true, workstation: 'librarian', enc: 30, flam: 20 });
reg('smoker', { tiles: { top: 'smoker_top', bottom: 'smoker_bottom', side: 'smoker_side', front: 'smoker_front' }, orient: true, hard: 3.5, tool: 'pickaxe', needTool: true, hasEntity: 'furnace', furnaceKind: 'smoker', workstation: 'butcher' });
reg('smoker_lit', { tiles: { top: 'smoker_top', bottom: 'smoker_bottom', side: 'smoker_side', front: 'smoker_front_on' }, orient: true, light: 13, hard: 3.5, tool: 'pickaxe', needTool: true, drops: [['smoker', 1, 1]], hasEntity: 'furnace', furnaceKind: 'smoker', workstation: 'butcher' });
reg('blast_furnace', { tiles: { top: 'blast_furnace_top', bottom: 'blast_furnace_top', side: 'blast_furnace_side', front: 'blast_furnace_front' }, orient: true, hard: 3.5, tool: 'pickaxe', needTool: true, hasEntity: 'furnace', furnaceKind: 'blast', workstation: 'armorer' });
reg('blast_furnace_lit', { tiles: { top: 'blast_furnace_top', bottom: 'blast_furnace_top', side: 'blast_furnace_side', front: 'blast_furnace_front_on' }, orient: true, light: 13, hard: 3.5, tool: 'pickaxe', needTool: true, drops: [['blast_furnace', 1, 1]], hasEntity: 'furnace', furnaceKind: 'blast', workstation: 'armorer' });
reg('barrel', { tiles: { top: 'barrel_top', bottom: 'barrel_bottom', side: 'barrel_side' }, hard: 2.5, tool: 'axe', sound: 'wood', hasEntity: 'chest', barrel: true, workstation: 'fisherman', enc: 5, flam: 20 });
reg('fletching_table', { tiles: { top: 'fletching_table_top', bottom: 'birch_planks', north: 'fletching_table_front', south: 'fletching_table_front', west: 'fletching_table_side', east: 'fletching_table_side' }, hard: 2.5, tool: 'axe', sound: 'wood', workstation: 'fletcher', enc: 5, flam: 20 });
reg('cartography_table', { tiles: { top: 'cartography_table_top', bottom: 'dark_oak_planks', north: 'cartography_table_side3', south: 'cartography_table_side1', west: 'cartography_table_side2', east: 'cartography_table_side2' }, hard: 2.5, tool: 'axe', sound: 'wood', workstation: 'cartographer', enc: 5, flam: 20 });
reg('smithing_table', { tiles: { top: 'smithing_table_top', bottom: 'smithing_table_bottom', north: 'smithing_table_front', south: 'smithing_table_front', west: 'smithing_table_side', east: 'smithing_table_side' }, hard: 2.5, tool: 'axe', sound: 'wood', workstation: 'toolsmith', enc: 5, flam: 20 });
reg('stonecutter', { model: M_BOX, hard: 3.5, tool: 'pickaxe', needTool: true, sound: 'stone', tiles: { top: 'stonecutter_top', bottom: 'stonecutter_bottom', side: 'stonecutter_side' }, opaque: false, opacity: 0, solid: true, stonecutter: true, workstation: 'mason' });
reg('loom', { tiles: { top: 'loom_top', bottom: 'loom_bottom', side: 'loom_side', front: 'loom_front' }, orient: true, hard: 2.5, tool: 'axe', sound: 'wood', workstation: 'shepherd', enc: 5, flam: 20 });
reg('grindstone', { model: M_BOX, hard: 2, tool: 'pickaxe', needTool: true, sound: 'stone', tiles: 'grindstone_side', opaque: false, opacity: 0, solid: true, grindstone: true, workstation: 'weaponsmith' });
reg('cauldron', { model: M_BOX, hard: 2, tool: 'pickaxe', needTool: true, sound: 'metal', tiles: { top: 'cauldron_top', bottom: 'cauldron_bottom', side: 'cauldron_side' }, opaque: false, opacity: 0, solid: true, cauldron: true, workstation: 'leatherworker' });
reg('brewing_stand', { model: M_BOX, hard: 0.5, tool: 'pickaxe', needTool: true, sound: 'metal', tiles: 'brewing_stand', opaque: false, opacity: 0, solid: true, light: 1, brewing: true, workstation: 'cleric', sel: [1, 0, 1, 15, 14, 15] });
reg('carrots', Object.assign({}, plant, { model: M_CROP, crop: true, drops: 'special:carrots', tiles: 'carrots_stage0', stageTiles: ['carrots_stage0', 'carrots_stage0', 'carrots_stage1', 'carrots_stage1', 'carrots_stage2', 'carrots_stage2', 'carrots_stage2', 'carrots_stage3'] }));
reg('potatoes', Object.assign({}, plant, { model: M_CROP, crop: true, drops: 'special:potatoes', tiles: 'potatoes_stage0', stageTiles: ['potatoes_stage0', 'potatoes_stage0', 'potatoes_stage1', 'potatoes_stage1', 'potatoes_stage2', 'potatoes_stage2', 'potatoes_stage2', 'potatoes_stage3'] }));
reg('lantern', { model: M_BOX, hard: 3.5, tool: 'pickaxe', sound: 'metal', tiles: 'lantern', opaque: false, opacity: 0, solid: true, light: 15, lantern: true });
// ---- strongholds
reg('mossy_stone_bricks', { hard: 1.5, tool: 'pickaxe', needTool: true });
reg('cracked_stone_bricks', { hard: 1.5, tool: 'pickaxe', needTool: true });
// ---- Divine Beast Vah Medoh: Sheikah "ancient" materials. glow = the mesher draws the block at full brightness (energy lines)
const ANCIENT = { hard: 3, tool: 'pickaxe', needTool: true };
reg('ancient_stone', ANCIENT);
reg('ancient_stone_mid', ANCIENT);
reg('ancient_stone_dark', ANCIENT);
reg('ancient_gold', Object.assign({ tiles: { top: 'ancient_gold_top', bottom: 'ancient_gold_top', side: 'ancient_gold' } }, ANCIENT));
reg('ancient_carved', Object.assign({ tiles: { top: 'ancient_carved_top', bottom: 'ancient_carved_top', side: 'ancient_carved' } }, ANCIENT));
reg('ancient_carved_dark', Object.assign({ tiles: { top: 'ancient_carved_dark_top', bottom: 'ancient_carved_dark_top', side: 'ancient_carved_dark' } }, ANCIENT));
reg('ancient_moss', Object.assign({ tiles: { top: 'ancient_moss_top', bottom: 'ancient_stone', side: 'ancient_moss_side' }, sound: 'grass' }, ANCIENT));
reg('ancient_moss_carved', Object.assign({ tiles: { top: 'ancient_moss_carved_top', bottom: 'ancient_carved_top', side: 'ancient_moss_carved_side' }, sound: 'grass' }, ANCIENT));
reg('ancient_pillar', Object.assign({ tiles: { top: 'ancient_pillar_top', bottom: 'ancient_pillar_top', side: 'ancient_pillar' } }, ANCIENT));
reg('ancient_glow_blue', { light: 12, glow: true, hard: 3, sound: 'glass' });
reg('ancient_glow_orange', { light: 14, glow: true, hard: 3, sound: 'glass' });
// the targeting laser: a thin non-solid rod; meta = axis (0 x, 1 z, 2 y)
reg('ancient_beam', { model: M_BOX, solid: false, opaque: false, opacity: 0, light: 7, glow: true, beam: true, hard: 0, drops: null, sound: 'glass', sel: [5, 5, 5, 11, 11, 11] });

// flammability of pre-existing blocks (BlockFire.setFireInfo)
const setFire = (names, enc, flam) => { for (const n of names) { const d = BLOCKS[BID[n]]; if (d) { d.enc = enc; d.flam = flam; } } };
setFire(['oak_planks', 'spruce_planks', 'birch_planks', 'oak_slab', 'spruce_slab', 'birch_slab', 'oak_stairs', 'spruce_stairs', 'birch_stairs', 'oak_fence', 'oak_door'].concat(NEW_WOODS.flatMap(w => [w + '_planks', w + '_slab', w + '_stairs'])), 5, 20);
setFire(['oak_log', 'spruce_log', 'birch_log', 'coal_block'].concat(NEW_WOODS.map(w => w + '_log')), 5, 5);
setFire(['oak_leaves', 'spruce_leaves', 'birch_leaves'].concat(NEW_WOODS.map(w => w + '_leaves')), 30, 60);
setFire(WOOL.map(c => c + '_wool'), 30, 60);
setFire(['bookshelf'], 30, 20);
setFire(['tnt'], 15, 100);
setFire(['short_grass', 'fern', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'oxeye_daisy', 'cornflower', 'dead_bush', 'oak_sapling', 'spruce_sapling', 'birch_sapling', 'wheat', 'sugar_cane'].concat(NEW_WOODS.map(w => w + '_sapling')), 60, 100);
setFire(['hay_block'], 60, 20);

if (BLOCKS.length > 255) throw new Error('too many blocks for Uint8 storage: ' + BLOCKS.length);
const NB = BLOCKS.length;

// ---------------------------------------------------------------- lookup tables (Uint8Array indexed by block id)
const T_OPAQUE = new Uint8Array(256), T_OPACITY = new Uint8Array(256), T_EMIT = new Uint8Array(256), T_MODEL = new Uint8Array(256),
  T_SOLID = new Uint8Array(256), T_FLUID = new Uint8Array(256), T_REPL = new Uint8Array(256), T_CULLSAME = new Uint8Array(256),
  T_ORIENT = new Uint8Array(256), T_LIGHTFIX = new Uint8Array(256), T_LOG = new Uint8Array(256), T_TINT = new Uint8Array(256), T_OFFSET = new Uint8Array(256),
  T_CONN = new Uint8Array(256), T_ENC = new Uint8Array(256), T_FLAM = new Uint8Array(256), T_GLOW = new Uint8Array(256);
const TINT_ID = { grass: 1, foliage: 2, water: 3, spruce: 4, birch: 5, lily: 6 };
for (const d of BLOCKS) {
  T_OPAQUE[d.id] = (d.model === M_CUBE && d.opacity === 15) ? 1 : 0;
  T_OPACITY[d.id] = d.opacity;
  T_EMIT[d.id] = d.light;
  T_MODEL[d.id] = d.model;
  T_SOLID[d.id] = d.solid ? 1 : 0;
  T_FLUID[d.id] = d.fluid || 0;
  T_REPL[d.id] = d.replaceable ? 1 : 0;
  T_CULLSAME[d.id] = d.cullSame ? 1 : 0;
  T_ORIENT[d.id] = d.orient ? 1 : 0;
  T_LIGHTFIX[d.id] = (d.opacity === 15 && d.model === M_BOX) ? 1 : 0;
  T_LOG[d.id] = d.log || d.axis ? 1 : 0;
  T_TINT[d.id] = d.tint ? TINT_ID[d.tint] : 0;
  T_OFFSET[d.id] = d.offset ? 1 : 0;
  T_CONN[d.id] = d.conn || 0;
  T_ENC[d.id] = d.enc || 0;
  T_FLAM[d.id] = d.flam || 0;
  T_GLOW[d.id] = d.glow ? 1 : 0;
}
// does a connecting block of rule `kind` (1 fence, 2 pane/bars, 3 wall) attach to neighbour block `n`?
function connects(kind, n) {
  if (n === 0) return false;
  const d = BLOCKS[n];
  const full = T_OPAQUE[n] === 1 && d.model === M_CUBE;
  if (kind === 1) return d.conn === 1 || !!d.gate || full;
  if (kind === 4) return d.conn === 4 || !!d.gate || full;   // nether brick fences only join each other (and solid blocks)
  if (kind === 2) return d.conn === 2 || d.conn === 3 || n === BID.glass || full;
  return d.conn === 3 || d.conn === 2 || !!d.gate || full;
}
// mask bits: 1 north(-z) 2 south(+z) 4 west(-x) 8 east(+x)
function connMask(kind, nN, nS, nW, nE) { return (connects(kind, nN) ? 1 : 0) | (connects(kind, nS) ? 2 : 0) | (connects(kind, nW) ? 4 : 0) | (connects(kind, nE) ? 8 : 0); }
// chorus plants join other chorus parts on all six sides and end stone below; bits 1 N 2 S 4 W 8 E 16 down 32 up
function chorusMask(nD, nU, nN, nS, nW, nE) {
  const c = n => n !== 0 && !!BLOCKS[n].chorus;
  return (c(nN) ? 1 : 0) | (c(nS) ? 2 : 0) | (c(nW) ? 4 : 0) | (c(nE) ? 8 : 0) | (c(nD) || nD === BID.end_stone ? 16 : 0) | (BLOCKS[nU] && BLOCKS[nU].chorus ? 32 : 0);
}
T_OPAQUE[0] = 0;

// ---------------------------------------------------------------- biomes
const hexRGB = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const BIOME_LIST = [
  ['ocean', 0x8eb971, 0x71a74d, 0x3f76e4], ['deep_ocean', 0x8eb971, 0x71a74d, 0x3f76e4], ['plains', 0x91bd59, 0x77ab2f, 0x3f76e4],
  ['forest', 0x79c05a, 0x59ae30, 0x3f76e4], ['birch_forest', 0x88bb67, 0x6ba941, 0x3f76e4], ['taiga', 0x86b783, 0x68a464, 0x3d57d6],
  ['snowy_plains', 0x80b497, 0x60a17b, 0x3d57d6], ['snowy_taiga', 0x80b497, 0x60a17b, 0x3d57d6], ['desert', 0xbfb755, 0xaea42a, 0x3f76e4],
  ['windswept_hills', 0x8ab689, 0x6da36b, 0x3f76e4], ['snowy_peaks', 0x80b497, 0x60a17b, 0x3d57d6], ['beach', 0x91bd59, 0x77ab2f, 0x3f76e4],
  ['river', 0x91bd59, 0x77ab2f, 0x3f76e4], ['frozen_river', 0x80b497, 0x60a17b, 0x3938c9], ['swamp', 0x6a7039, 0x6a7039, 0x617b64],
  ['snowy_beach', 0x83b593, 0x64a278, 0x3d57d6], ['frozen_ocean', 0x80b497, 0x60a17b, 0x3938c9],
  ['jungle', 0x59c93c, 0x30bb0b, 0x3f76e4], ['savanna', 0xbfb755, 0xaea42a, 0x3f76e4], ['dark_forest', 0x507a32, 0x59ae30, 0x3f76e4], ['badlands', 0x90814d, 0x9e814d, 0x4e7f81],
  // the Nether (fog colours used by the renderer) and the End
  ['nether_wastes', 0xbfb755, 0xaea42a, 0x3f76e4, 0x330808], ['soul_sand_valley', 0xbfb755, 0xaea42a, 0x3f76e4, 0x1b4745], ['crimson_forest', 0xbfb755, 0xaea42a, 0x3f76e4, 0x330303],
  ['warped_forest', 0xbfb755, 0xaea42a, 0x3f76e4, 0x1a051a], ['basalt_deltas', 0xbfb755, 0xaea42a, 0x3f76e4, 0x685f70],
  ['the_end', 0x8eb971, 0x71a74d, 0x3f76e4, 0xa080a0], ['end_highlands', 0x8eb971, 0x71a74d, 0x3f76e4, 0xa080a0], ['small_end_islands', 0x8eb971, 0x71a74d, 0x3f76e4, 0xa080a0],
];
const BIO = {};
const BIOMES = BIOME_LIST.map((b, i) => { BIO[b[0]] = i; const nether = i >= 21 && i <= 25, end = i >= 26; return { id: i, name: b[0], grass: hexRGB(b[1]), foliage: hexRGB(b[2]), water: hexRGB(b[3]), fog: b[4] !== undefined ? hexRGB(b[4]) : null, nether, end, dry: b[0] === 'desert' || b[0] === 'savanna' || b[0] === 'badlands' || nether || end, snowy: /snowy|frozen|peaks/.test(b[0]) }; });
const SPRUCE_RGB = hexRGB(0x619961), BIRCH_RGB = hexRGB(0x80a755), LILY_RGB = hexRGB(0x208030);

// ---------------------------------------------------------------- box models
// A box: x0,y0,z0,x1,y1,z1 in 1/16 block units; t = 6 tile names [down,up,north,south,west,east]; optional uv[6] = [u0,v0,u1,v1] in tile pixels,
// rot[6] quarter-turn uv rotations, shear=[dx,dz] (top vertices shifted, 1/16 units), noCull bitmask.
function bx(x0, y0, z0, x1, y1, z1, t, extra) {
  const b = { x0, y0, z0, x1, y1, z1, t: typeof t === 'string' ? [t, t, t, t, t, t] : t };
  if (extra) Object.assign(b, extra);
  return b;
}
const FULL_BOX = [0, 0, 0, 1, 1, 1];
const boxCache = new Map();
let TI = {};                 // tile name -> index, set by init()

function slabTiles(d) { const s = d.faceNames; return [s[0], s[1], s[2], s[3], s[4], s[5]]; }

// rotate uniform-material boxes by dir quarter turns about the block centre (dir 0 = as authored, 2 = 180 degrees)
function rotBoxes(list, dir) {
  if (!dir) return list;
  return list.map(b => {
    let x0 = b.x0, z0 = b.z0, x1 = b.x1, z1 = b.z1;
    for (let q = 0; q < dir; q++) { const nx0 = 16 - z1, nx1 = 16 - z0, nz0 = x0, nz1 = x1; x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1; }
    return bx(x0, b.y0, z0, x1, b.y1, z1, b.t);
  });
}
function computeBoxes(id, meta) {
  const d = BLOCKS[id];
  if (d.torch) {
    const uvSide = [7, 6, 9, 16], uv = [[7, 14, 9, 16], [7, 6, 9, 8], uvSide, uvSide, uvSide, uvSide];
    if (meta === 0) return [bx(7, 0, 7, 9, 10, 9, 'torch', { uv })];
    // wall torches: 1 support west, 2 support east, 3 support north, 4 support south (leans away from the wall)
    const s = 3.5;
    if (meta === 1) return [bx(1, 3.5, 7, 3, 13.5, 9, 'torch', { uv, shear: [4, 0] })];
    if (meta === 2) return [bx(13, 3.5, 7, 15, 13.5, 9, 'torch', { uv, shear: [-4, 0] })];
    if (meta === 3) return [bx(7, 3.5, 1, 9, 13.5, 3, 'torch', { uv, shear: [0, 4] })];
    return [bx(7, 3.5, 13, 9, 13.5, 15, 'torch', { uv, shear: [0, -4] })];
  }
  if (d.slab) { const t = slabTiles(d); return (meta & 1) ? [bx(0, 8, 0, 16, 16, 16, t)] : [bx(0, 0, 0, 16, 8, 16, t)]; }
  if (d.stairs) {
    const t = slabTiles(d), dir = meta & 3, flip = (meta & 4) !== 0;
    const base = flip ? bx(0, 8, 0, 16, 16, 16, t) : bx(0, 0, 0, 16, 8, 16, t);
    const y0 = flip ? 0 : 8, y1 = flip ? 8 : 16;
    const step = dir === 0 ? bx(8, y0, 0, 16, y1, 16, t) : dir === 1 ? bx(0, y0, 0, 8, y1, 16, t) : dir === 2 ? bx(0, y0, 8, 16, y1, 16, t) : bx(0, y0, 0, 16, y1, 8, t);
    return [base, step];
  }
  if (d.pane) {
    // meta = connection mask (1 N, 2 S, 4 W, 8 E). The centre post hides the faces that touch an arm.
    const bars = !!d.bars, side = bars ? 'iron_bars' : 'glass', top = bars ? 'iron_bars' : 'glass_pane_top';
    const T = [top, top, side, side, side, side], m = meta, out = [];
    out.push(bx(7, 0, 7, 9, 16, 9, T, { skip: ((m & 1) ? 4 : 0) | ((m & 2) ? 8 : 0) | ((m & 4) ? 16 : 0) | ((m & 8) ? 32 : 0) }));
    if (m & 1) out.push(bx(7, 0, 0, 9, 16, 7, T, { skip: 8 }));
    if (m & 2) out.push(bx(7, 0, 9, 9, 16, 16, T, { skip: 4 }));
    const ewUV = { rot: [1, 1, 0, 0, 0, 0], uv: [[7, 0, 9, 7], [7, 0, 9, 7], null, null, null, null] };   // top/bottom of east-west arms sample the pane edge strip
    if (m & 4) out.push(bx(0, 0, 7, 7, 16, 9, T, Object.assign({ skip: 32 }, ewUV)));
    if (m & 8) out.push(bx(9, 0, 7, 16, 16, 9, T, Object.assign({ skip: 16 }, ewUV)));
    return out;
  }
  if (d.wall) {
    const t = d.faceNames[2], m = meta, out = [];
    const straight = m === 3 || m === 12;
    if (!straight) out.push(bx(4, 0, 4, 12, 16, 12, t));
    const e0 = straight ? 0 : 0, hN = straight ? 16 : 4;
    if (m & 1) out.push(bx(5, 0, 0, 11, 14, straight ? 8 : 4, t));
    if (m & 2) out.push(bx(5, 0, straight ? 8 : 12, 11, 14, 16, t));
    if (m & 4) out.push(bx(0, 0, 5, straight ? 8 : 4, 14, 11, t));
    if (m & 8) out.push(bx(straight ? 8 : 12, 0, 5, 16, 14, 11, t));
    if (!out.length) out.push(bx(4, 0, 4, 12, 16, 12, t));
    return out;
  }
  if (d.gate) {
    // meta: bits0-1 facing (0 south/+z, 1 west/-x, 2 north/-z, 3 east/+x), bit2 open. Laid out spanning x, then rotated for dir 1/3.
    const t = 'oak_planks', open = (meta & 4) !== 0, dir = meta & 3;
    const base = open
      ? [bx(0, 5, 7, 2, 16, 9, t), bx(14, 5, 7, 16, 16, 9, t), bx(0, 6, 9, 2, 9, 15, t), bx(0, 12, 9, 2, 15, 15, t), bx(0, 9, 13, 2, 12, 15, t), bx(14, 6, 9, 16, 9, 15, t), bx(14, 12, 9, 16, 15, 15, t), bx(14, 9, 13, 16, 12, 15, t)]
      : [bx(0, 5, 7, 2, 16, 9, t), bx(14, 5, 7, 16, 16, 9, t), bx(2, 6, 7, 6, 9, 9, t), bx(10, 6, 7, 14, 9, 9, t), bx(2, 12, 7, 6, 15, 9, t), bx(10, 12, 7, 14, 15, 9, t), bx(6, 9, 7, 10, 12, 9, t)];
    return rotBoxes(base, dir);
  }
  if (d.trapdoor) {
    const open = (meta & 4) !== 0, top = (meta & 8) !== 0, dir = meta & 3, t = 'oak_trapdoor';
    if (!open) return [top ? bx(0, 13, 0, 16, 16, 16, t) : bx(0, 0, 0, 16, 3, 16, t)];
    return [dir === 0 ? bx(0, 0, 13, 16, 16, 16, t) : dir === 1 ? bx(0, 0, 0, 3, 16, 16, t) : dir === 2 ? bx(0, 0, 0, 16, 16, 3, t) : bx(13, 0, 0, 16, 16, 16, t)];
  }
  if (d.vine) {
    // meta bits: 1 attached to +z block, 2 to -x, 4 to -z, 8 to +x, 16 to the block above; one visible face per plane
    const t = 'vine', out = [], ALL = 63;
    if (meta & 1) out.push(bx(0, 0, 15.2, 16, 16, 16, t, { skip: ALL & ~(1 << 2) }));
    if (meta & 2) out.push(bx(0, 0, 0, 0.8, 16, 16, t, { skip: ALL & ~(1 << 5) }));
    if (meta & 4) out.push(bx(0, 0, 0, 16, 16, 0.8, t, { skip: ALL & ~(1 << 3) }));
    if (meta & 8) out.push(bx(15.2, 0, 0, 16, 16, 16, t, { skip: ALL & ~(1 << 4) }));
    if (meta & 16) out.push(bx(0, 15.2, 0, 16, 16, 16, t, { skip: ALL & ~(1 << 0) }));
    return out.length ? out : null;
  }
  if (d.carpet) return [bx(0, 0, 0, 16, 1, 16, slabTiles(d))];
  const nb = computeBoxesNew(d, meta);
  if (nb !== undefined) return nb;
  if (d.fence) {
    const t = d.fenceTile || 'oak_planks', out = [bx(6, 0, 6, 10, 16, 10, t)];
    if (meta & 1) out.push(bx(7, 6, 0, 9, 9, 6, t), bx(7, 12, 0, 9, 15, 6, t));
    if (meta & 2) out.push(bx(7, 6, 10, 9, 9, 16, t), bx(7, 12, 10, 9, 15, 16, t));
    if (meta & 4) out.push(bx(0, 6, 7, 6, 9, 9, t), bx(0, 12, 7, 6, 15, 9, t));
    if (meta & 8) out.push(bx(10, 6, 7, 16, 9, 9, t), bx(10, 12, 7, 16, 15, 9, t));
    return out;
  }
  if (d.sign) {
    const t = 'oak_planks';
    if (d.wallSign) return [meta === 2 ? bx(0, 4.5, 14, 16, 12.5, 16, t) : meta === 3 ? bx(0, 4.5, 0, 16, 12.5, 2, t) : meta === 4 ? bx(14, 4.5, 0, 16, 12.5, 16, t) : bx(0, 4.5, 0, 2, 12.5, 16, t)];
    return rotBoxes([bx(0, 8, 7, 16, 16, 9, t), bx(7, 0, 7, 9, 8, 9, ['oak_log_top', 'oak_log_top', 'oak_log', 'oak_log', 'oak_log', 'oak_log'])], meta & 3);
  }
  if (d.door) {
    const t = (meta & 8) ? 'oak_door_top' : 'oak_door_bottom', e = ((meta & 3) + ((meta & 4) ? 1 : 0)) & 3;
    return [e === 0 ? bx(0, 0, 0, 3, 16, 16, t) : e === 1 ? bx(0, 0, 0, 16, 16, 3, t) : e === 2 ? bx(13, 0, 0, 16, 16, 16, t) : bx(0, 0, 13, 16, 16, 16, t)];
  }
  if (d.climbable) {
    const t = 'ladder';
    return [meta === 2 ? bx(0, 0, 15, 16, 16, 16, t) : meta === 3 ? bx(0, 0, 0, 16, 16, 1, t) : meta === 4 ? bx(15, 0, 0, 16, 16, 16, t) : bx(0, 0, 0, 1, 16, 16, t)];
  }
  if (d.name === 'chest') {
    const t = ['oak_planks', 'chest_top', 'chest_side', 'chest_side', 'chest_side', 'chest_side'];
    t[meta >= 2 && meta <= 5 ? meta : 3] = 'chest_front';
    return [bx(1, 0, 1, 15, 14, 15, t)];
  }
  if (d.cactus) return [bx(1, 0, 1, 15, 16, 15, ['cactus_bottom', 'cactus_top', 'cactus_side', 'cactus_side', 'cactus_side', 'cactus_side'], { uv: [null, null, [0, 0, 16, 16], [0, 0, 16, 16], [0, 0, 16, 16], [0, 0, 16, 16]] })];
  if (d.farmland) return [bx(0, 0, 0, 16, 15, 16, ['dirt', meta >= 7 ? 'farmland_moist' : 'farmland', 'dirt', 'dirt', 'dirt', 'dirt'])];
  if (d.layer) return [bx(0, 0, 0, 16, (meta + 1) * 2, 16, 'snow')];
  if (d.lily) return [bx(0, 0, 0, 16, 0.5, 16, ['lily_pad', 'lily_pad', 'lily_pad', 'lily_pad', 'lily_pad', 'lily_pad'])];
  if (d.bed) {
    // meta: bits0-1 = facing (direction foot->head): 0 south(+z) 1 west(-x) 2 north(-z) 3 east(+x); bit2 = head part
    const head = (meta & 4) !== 0, face = meta & 3, k = head ? 'head' : 'foot';
    // tile "up" edge of the top texture points toward the head end
    const rotFor = [2, 3, 0, 1];   // quarter turns so texture-up points to facing direction (default up = north)
    const t = ['bed_bottom', 'bed_top_' + k, 'bed_side_' + k, 'bed_side_' + k, 'bed_side_' + k, 'bed_side_' + k];
    const endFace = [3, 4, 2, 5][face] ; // the face at the far end of this half (head end for head, foot end for foot)
    const farFace = head ? endFace : [2, 5, 3, 4][face];
    t[farFace] = 'bed_end_' + k;
    return [bx(0, 3, 0, 16, 9, 16, t, { rot: [0, rotFor[face], 0, 0, 0, 0] }),
      bx(0, 0, 0, 3, 3, 3, 'oak_planks'), bx(13, 0, 0, 16, 3, 3, 'oak_planks'), bx(0, 0, 13, 3, 3, 16, 'oak_planks'), bx(13, 0, 13, 16, 3, 16, 'oak_planks')].slice(0, 1);
  }
  return null;
}
// box models of the dimensions update (undefined = not one of these blocks)
function computeBoxesNew(d, meta) {
  if (d.portal === 'nether') return [(meta & 1) ? bx(6, 0, 0, 10, 16, 16, 'nether_portal') : bx(0, 0, 6, 16, 16, 10, 'nether_portal')];
  if (d.portal === 'end') return [bx(0, 6, 0, 16, 12, 16, 'end_portal')];
  if (d.portal === 'gateway') return [bx(0, 0, 0, 16, 16, 16, 'end_gateway')];
  if (d.endFrame) {
    const out = [bx(0, 0, 0, 16, 13, 16, ['end_stone', 'end_portal_frame_top', 'end_portal_frame_side', 'end_portal_frame_side', 'end_portal_frame_side', 'end_portal_frame_side'])];
    if (meta & 4) out.push(bx(4, 13, 4, 12, 16, 12, 'end_portal_frame_eye'));
    return out;
  }
  if (d.chorus === 'plant') {
    const t = 'chorus_plant', out = [bx(4, 4, 4, 12, 12, 12, t)];
    if (meta & 1) out.push(bx(4, 4, 0, 12, 12, 4, t)); if (meta & 2) out.push(bx(4, 4, 12, 12, 12, 16, t));
    if (meta & 4) out.push(bx(0, 4, 4, 4, 12, 12, t)); if (meta & 8) out.push(bx(12, 4, 4, 16, 12, 12, t));
    if (meta & 16) out.push(bx(4, 0, 4, 12, 4, 12, t)); if (meta & 32) out.push(bx(4, 12, 4, 12, 16, 12, t));
    return out;
  }
  if (d.chorus === 'flower') return [bx(0, 0, 0, 16, 16, 16, meta >= 5 ? 'chorus_flower_dead' : 'chorus_flower')];
  if (d.dragonEgg) return [[6, 15, 6, 10, 16, 10], [5, 14, 5, 11, 15, 11], [4, 13, 4, 12, 14, 12], [3, 11, 3, 13, 13, 13], [2, 8, 2, 14, 11, 14], [1, 3, 1, 15, 8, 15], [2, 1, 2, 14, 3, 14], [3, 0, 3, 13, 1, 13]].map(b => bx(b[0], b[1], b[2], b[3], b[4], b[5], 'dragon_egg'));
  if (d.endRod) {
    // meta = direction the rod points: 0 up 1 down 2 north 3 south 4 west 5 east (the base sits against the supporting block)
    const t = 'end_rod';
    switch (meta) {
      case 1: return [bx(6, 15, 6, 10, 16, 10, t), bx(7, 0, 7, 9, 15, 9, t)];
      case 2: return [bx(6, 6, 15, 10, 10, 16, t), bx(7, 7, 0, 9, 9, 15, t)];
      case 3: return [bx(6, 6, 0, 10, 10, 1, t), bx(7, 7, 1, 9, 9, 16, t)];
      case 4: return [bx(15, 6, 6, 16, 10, 10, t), bx(0, 7, 7, 15, 9, 9, t)];
      case 5: return [bx(0, 6, 6, 1, 10, 10, t), bx(1, 7, 7, 16, 9, 9, t)];
      default: return [bx(6, 0, 6, 10, 1, 10, t), bx(7, 1, 7, 9, 16, 9, t)];
    }
  }
  if (d.path) return [bx(0, 0, 0, 16, 15, 16, slabTiles(d))];
  if (d.bell) {
    const post = 'smooth_stone', bar = 'dark_oak_planks', b = 'bell_body';
    const list = [bx(1, 0, 7, 3, 15, 9, post), bx(13, 0, 7, 15, 15, 9, post), bx(3, 13, 7.5, 13, 14.5, 8.5, bar),
      bx(5, 6, 5, 11, 13, 11, b), bx(4, 4, 4, 12, 6, 12, [b, b, b, b, b, b])];
    return rotBoxes(list, meta & 1);
  }
  if (d.composter) {
    const T = d.faceNames, lvl = meta & 15, out = [bx(0, 0, 0, 16, 2, 16, T), bx(0, 2, 0, 2, 16, 16, T), bx(14, 2, 0, 16, 16, 16, T), bx(2, 2, 0, 14, 16, 2, T), bx(2, 2, 14, 14, 16, 16, T)];
    if (lvl > 0) out.push(bx(2, 2, 2, 14, lvl >= 8 ? 15 : 2 + lvl * 1.8, 14, lvl >= 8 ? 'composter_ready' : 'composter_compost'));
    return out;
  }
  if (d.lectern) return rotBoxes([bx(0, 0, 0, 16, 2, 16, 'lectern_base'), bx(4, 2, 4, 12, 13, 12, 'lectern_sides'), bx(0, 13, 0, 16, 15, 16, 'lectern_top')], meta & 3);
  if (d.grindstone) {
    const leg = 'dark_oak_log', pv = 'grindstone_pivot', wr = 'grindstone_round', ws = 'grindstone_side';
    return rotBoxes([bx(2, 0, 6, 4, 7, 10, leg), bx(12, 0, 6, 14, 7, 10, leg), bx(2, 7, 5, 4, 13, 11, pv), bx(12, 7, 5, 14, 13, 11, pv), bx(4, 4, 2, 12, 16, 14, [wr, wr, wr, wr, ws, ws])], meta & 3);
  }
  if (d.stonecutter) return [bx(0, 0, 0, 16, 9, 16, d.faceNames), bx(1, 9, 8, 15, 16, 8, 'stonecutter_saw', { skip: 1 | 2 | 16 | 32 })];
  if (d.cauldron) {
    const T = d.faceNames, I = 'cauldron_inner', lvl = meta & 3;
    const out = [bx(2, 3, 2, 14, 4, 14, [T[0], I, I, I, I, I]), bx(0, 3, 0, 2, 16, 16, T), bx(14, 3, 0, 16, 16, 16, T), bx(2, 3, 0, 14, 16, 2, T), bx(2, 3, 14, 14, 16, 16, T),
      bx(0, 0, 0, 4, 3, 2, T), bx(0, 0, 2, 2, 3, 4, T), bx(12, 0, 0, 16, 3, 2, T), bx(14, 0, 2, 16, 3, 4, T), bx(0, 0, 14, 4, 3, 16, T), bx(0, 0, 12, 2, 3, 14, T), bx(12, 0, 14, 16, 3, 16, T), bx(14, 0, 12, 16, 3, 14, T)];
    if (lvl > 0) { const yw = [0, 9, 12, 15][lvl]; out.push(bx(2, yw, 2, 14, yw, 14, 'cauldron_water', { skip: 1 | 4 | 8 | 16 | 32 })); }
    return out;
  }
  if (d.brewing) return [bx(9, 0, 5, 15, 2, 11, 'brewing_stand_base'), bx(2, 0, 1, 8, 2, 7, 'brewing_stand_base'), bx(2, 0, 9, 8, 2, 15, 'brewing_stand_base'), bx(7, 0, 7, 9, 14, 9, 'brewing_stand')];
  if (d.beam) { const t = 'ancient_beam'; return meta === 1 ? [bx(6, 6, 0, 10, 10, 16, t)] : meta === 2 ? [bx(6, 0, 6, 10, 16, 10, t)] : [bx(0, 6, 6, 16, 10, 10, t)]; }
  if (d.lantern) {
    const t = 'lantern';
    if (meta & 1) return [bx(5, 1, 5, 11, 8, 11, t), bx(6, 8, 6, 10, 10, 10, t), bx(7.5, 10, 7.5, 8.5, 16, 8.5, 'lantern_chain')];
    return [bx(5, 0, 5, 11, 7, 11, t), bx(6, 7, 6, 10, 9, 10, t), bx(7.5, 9, 7.5, 8.5, 11, 8.5, 'lantern_chain')];
  }
  return undefined;
}
// per (id, meta) boxes (render). Fence uses meta = connection mask (1 N, 2 S, 4 W, 8 E) supplied by the caller.
function getBoxes(id, meta) {
  const k = id * 256 + meta;
  let b = boxCache.get(k);
  if (b === undefined) { b = computeBoxes(id, meta); boxCache.set(k, b); }
  return b;
}
// collision boxes in block units [x0,y0,z0,x1,y1,z1] (0..1); null = no collision
const collCache = new Map();
function getCollision(id, meta) {
  if (id === 0) return null;
  const d = BLOCKS[id];
  if (!d.solid) {
    if (d.door) { const b = getBoxes(id, meta)[0]; return [[b.x0 / 16, b.y0 / 16, b.z0 / 16, b.x1 / 16, b.y1 / 16, b.z1 / 16]]; }
    if (d.layer && meta >= 1) return [[0, 0, 0, 1, meta * 2 / 16, 1]];
    return null;
  }
  if (d.collH) return [[0, 0, 0, 1, d.collH, 1]];
  if (d.model !== M_BOX) return [FULL_BOX];
  if (d.gate) return (meta & 4) ? null : ((meta & 1) ? [[6 / 16, 0, 0, 10 / 16, 1.5, 1]] : [[0, 0, 6 / 16, 1, 1.5, 10 / 16]]);
  const k = id * 256 + meta;
  let c = collCache.get(k);
  if (c !== undefined) return c;
  const bs = getBoxes(id, meta);
  if (d.fence) {
    c = [[6 / 16, 0, 6 / 16, 10 / 16, 1.5, 10 / 16]];
    if (meta & 1) c.push([6 / 16, 0, 0, 10 / 16, 1.5, 6 / 16]);
    if (meta & 2) c.push([6 / 16, 0, 10 / 16, 10 / 16, 1.5, 1]);
    if (meta & 4) c.push([0, 0, 6 / 16, 6 / 16, 1.5, 10 / 16]);
    if (meta & 8) c.push([10 / 16, 0, 6 / 16, 1, 1.5, 10 / 16]);
  } else if (d.wall) {
    c = bs ? bs.map(b => [b.x0 / 16, 0, b.z0 / 16, b.x1 / 16, 1.5, b.z1 / 16]) : [[4 / 16, 0, 4 / 16, 12 / 16, 1.5, 12 / 16]];
  } else if (d.cactus) c = [[1 / 16, 0, 1 / 16, 15 / 16, 15 / 16, 15 / 16]];
  else c = bs ? bs.map(b => [b.x0 / 16, b.y0 / 16, b.z0 / 16, b.x1 / 16, b.y1 / 16, b.z1 / 16]) : [FULL_BOX];
  collCache.set(k, c);
  return c;
}
// selection (outline) boxes
function getSelection(id, meta) {
  const d = BLOCKS[id];
  if (d.sel) return [d.sel.map(v => v / 16)];
  if (d.portal === 'nether') { const b = getBoxes(id, meta)[0]; return [[b.x0 / 16, b.y0 / 16, b.z0 / 16, b.x1 / 16, b.y1 / 16, b.z1 / 16]]; }
  if (d.model === M_CROSS) return [[2 / 16, 0, 2 / 16, 14 / 16, 13 / 16, 14 / 16]];
  if (d.model === M_CROP) return [[0, 0, 0, 1, Math.min(1, (2 + (meta & 7) * 2) / 16 + 0.05), 1]];
  if (d.model === M_BOX) {
    const bs = getBoxes(id, meta);
    if (d.fence) return [[6 / 16, 0, 6 / 16, 10 / 16, 1, 10 / 16]].concat(bs.slice(1).map(b => [b.x0 / 16, 0, b.z0 / 16, b.x1 / 16, 1, b.z1 / 16]));
    if (d.gate && !(meta & 4)) return [(meta & 1) ? [6 / 16, 5 / 16, 0, 10 / 16, 1, 1] : [0, 5 / 16, 6 / 16, 1, 1, 10 / 16]];
    if (!bs) return [FULL_BOX];
    return bs ? bs.map(b => [b.x0 / 16, b.y0 / 16, b.z0 / 16, b.x1 / 16, b.y1 / 16, b.z1 / 16]) : [FULL_BOX];
  }
  return [FULL_BOX];
}

// resolved per-face tile tables, built by init(tileIndex)
let FT = new Int16Array(256 * 6), FRONT_T = new Int16Array(256), OVERLAY_T = new Int16Array(256).fill(-1), STAGE_T = new Int16Array(256 * 8), MISSING_TILES = [];
function tileOf(name) {
  if (name === undefined || name === null) return 0;
  const v = TI[name];
  if (v === undefined) { if (MISSING_TILES.indexOf(name) < 0) MISSING_TILES.push(name); return 0; }
  return v;
}
function initTables(tileIndex) {
  TI = tileIndex; boxCache.clear(); collCache.clear(); MISSING_TILES.length = 0;
  for (const d of BLOCKS) {
    if (d.faceNames) for (let f = 0; f < 6; f++) FT[d.id * 6 + f] = tileOf(d.faceNames[f]);
    if (d.tiles && d.tiles.front) FRONT_T[d.id] = tileOf(d.tiles.front);
    if (d.overlay) OVERLAY_T[d.id] = tileOf(d.overlay);
    if (d.stageTiles) for (let i = 0; i < 8; i++) STAGE_T[d.id * 8 + i] = tileOf(d.stageTiles[i]);
  }
}
// names of all tiles referenced by blocks (used by the main thread to synthesise placeholders for missing textures)
function usedTileNames() {
  const s = new Set();
  for (const d of BLOCKS) {
    if (d.faceNames) d.faceNames.forEach(n => n && s.add(n));
    if (d.tiles && d.tiles.front) s.add(d.tiles.front);
    if (d.overlay) s.add(d.overlay);
    if (d.stageTiles) d.stageTiles.forEach(n => s.add(n));
  }
  for (const n of ['torch', 'ladder', 'oak_door_top', 'oak_door_bottom', 'chest_top', 'chest_side', 'chest_front', 'cactus_top', 'cactus_side', 'cactus_bottom', 'farmland', 'farmland_moist',
    'bed_top_head', 'bed_top_foot', 'bed_side_head', 'bed_side_foot', 'bed_end_head', 'bed_end_foot', 'bed_bottom', 'lily_pad', 'snow', 'water_flow', 'lava_flow', 'oak_planks',
    'fire_layer_0', 'fire_layer_1', 'glass_pane_top', 'iron_bars', 'oak_trapdoor', 'vine', 'cobweb', 'spawner',
    'soul_fire_0', 'soul_fire_1', 'nether_portal', 'end_portal', 'end_gateway', 'end_portal_frame_eye', 'chorus_flower_dead', 'composter_compost', 'composter_ready', 'lectern_base', 'lectern_sides',
    'grindstone_pivot', 'grindstone_round', 'stonecutter_saw', 'cauldron_inner', 'cauldron_water', 'brewing_stand_base', 'lantern_chain', 'dark_oak_log', 'dark_oak_planks', 'smooth_stone', 'bell_body']) s.add(n);
  for (let i = 0; i < 10; i++) s.add('destroy_stage_' + i);
  return Array.from(s);
}
