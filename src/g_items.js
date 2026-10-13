// ===== g_items.js : item registry, crafting recipes, smelting, fuel, food, tool stats =====
// Item ids: 1..255 = block items (same id as the block), 256+ = other items.
const ITEMS = [];       // id -> def
const IID = {};         // name -> id
let NEXT_ITEM = 256;
const DISPLAY_OVERRIDES = {
  tnt: 'TNT', porkchop: 'Raw Porkchop', beef: 'Raw Beef', chicken: 'Raw Chicken', mutton: 'Raw Mutton', red_bed: 'Bed', snow_layer: 'Snow', short_grass: 'Short Grass',
  jack_o_lantern: "Jack o'Lantern", lapis_lazuli: 'Lapis Lazuli', redstone: 'Redstone Dust', oak_door: 'Oak Door', wheat_seeds: 'Wheat Seeds', golden_apple: 'Golden Apple', spawner: 'Monster Spawner', cobweb: 'Cobweb', oak_fence_gate: 'Oak Fence Gate',
  bone_meal: 'Bone Meal', flint_and_steel: 'Flint and Steel', diamond_ore: 'Diamond Ore', grass_block: 'Grass Block', stone_brick_slab: 'Stone Brick Slab', smooth_stone: 'Smooth Stone',
  melon: 'Melon', hay_block: 'Hay Bale', clay: 'Clay', clay_ball: 'Clay Ball', oak_fence: 'Oak Fence', golden_sword: 'Golden Sword', golden_pickaxe: 'Golden Pickaxe',
  golden_axe: 'Golden Axe', golden_shovel: 'Golden Shovel', golden_hoe: 'Golden Hoe', golden_helmet: 'Golden Helmet', golden_chestplate: 'Golden Chestplate',
  golden_leggings: 'Golden Leggings', golden_boots: 'Golden Boots', cooked_porkchop: 'Cooked Porkchop', cooked_beef: 'Steak', cooked_chicken: 'Cooked Chicken', cooked_mutton: 'Cooked Mutton',
  water_bucket: 'Water Bucket', lava_bucket: 'Lava Bucket', milk_bucket: 'Milk Bucket', spawn_egg: 'Spawn Egg',
};
function addItem(name, o) {
  const d = Object.assign({ name, max: 64, tile: null, blk: -1, dur: 0, dmg: 1, cat: 'misc' }, o || {});
  if (d.id === undefined) d.id = NEXT_ITEM++;
  d.disp = DISPLAY_OVERRIDES[name] || titleCase(name);
  if (ITEMS[d.id]) throw new Error('item id clash ' + name);
  ITEMS[d.id] = d; IID[name] = d.id;
  return d;
}

// ---------------- block items (id == block id)
const NO_BLOCK_ITEM = new Set(['air', 'water', 'lava', 'grass_block_snowy', 'furnace_lit', 'wheat', 'oak_door', 'bed', 'farmland', 'fire', 'oak_sign', 'oak_wall_sign',
  'nether_portal', 'end_portal', 'end_gateway', 'soul_fire', 'nether_wart', 'carrots', 'potatoes', 'smoker_lit', 'blast_furnace_lit']);
const FLAT_BLOCK_ITEMS = new Set(['torch', 'ladder', 'lily_pad', 'sugar_cane', 'short_grass', 'fern', 'dead_bush', 'glass_pane', 'iron_bars', 'vine', 'lantern', 'bell', 'brewing_stand', 'cauldron', 'end_rod']);
// block items drawn with a dedicated inventory sprite (like vanilla's item models)
const ITEM_SPRITES = { lantern: 'lantern_item', bell: 'bell_item', brewing_stand: 'brewing_stand_item', cauldron: 'cauldron_item', end_rod: 'end_rod_item' };
for (const b of BLOCKS) {
  if (NO_BLOCK_ITEM.has(b.name)) continue;
  const flat = b.model === M_CROSS || FLAT_BLOCK_ITEMS.has(b.name);
  const d = addItem(b.name, { id: b.id, blk: b.id, flat, cat: 'block' });
  if (flat) {
    d.tile = b.name === 'sugar_cane' ? 'sugar_cane' : b.name === 'torch' ? 'torch' : b.name === 'ladder' ? 'ladder' : b.faceNames ? b.faceNames[2] : b.name;
    if (b.tint) d.iconTint = b.tint === 'grass' ? [0x91, 0xbd, 0x59] : b.tint === 'lily' ? [0x20, 0x80, 0x30] : [0x77, 0xab, 0x2f];
  }
}
IID.sapling = IID.oak_sapling;
for (const n in ITEM_SPRITES) if (IID[n] !== undefined) { ITEMS[IID[n]].tile = ITEM_SPRITES[n]; ITEMS[IID[n]].flat = true; delete ITEMS[IID[n]].iconTint; }

// ---------------- materials
const MATS = ['stick', 'coal', 'charcoal', 'iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'redstone', 'lapis_lazuli', 'flint', 'clay_ball', 'brick', 'paper', 'book', 'string', 'feather',
  'leather', 'bone', 'bone_meal', 'gunpowder', 'sugar', 'glowstone_dust', 'slime_ball', 'ink_sac'];
for (const m of MATS) addItem(m, { tile: m, cat: 'ingredient' });
addItem('egg', { tile: 'egg', max: 16, cat: 'ingredient', throwable: 'egg' });
addItem('snowball', { tile: 'snowball', max: 16, cat: 'ingredient', throwable: 'snowball' });
addItem('ender_pearl', { tile: 'ender_pearl', max: 16, cat: 'ingredient', throwable: 'ender_pearl' });
addItem('wheat', { tile: 'wheat', cat: 'ingredient' });
addItem('wheat_seeds', { tile: 'wheat_seeds', cat: 'ingredient', blk: BID.wheat, plant: true });
addItem('melon_seeds', { tile: 'melon_seeds', cat: 'ingredient' });
addItem('pumpkin_seeds', { tile: 'pumpkin_seeds', cat: 'ingredient' });

// ---------------- food (hunger points, saturation)
const FOODS = {
  apple: [4, 2.4], bread: [5, 6], golden_apple: [4, 9.6], melon_slice: [2, 1.2], cookie: [2, 0.4], carrot: [3, 3.6], potato: [1, 0.6], baked_potato: [5, 6],
  porkchop: [3, 1.8], cooked_porkchop: [8, 12.8], beef: [3, 1.8], cooked_beef: [8, 12.8], chicken: [2, 1.2], cooked_chicken: [6, 7.2], mutton: [2, 1.2], cooked_mutton: [6, 9.6],
  rotten_flesh: [4, 0.8], spider_eye: [2, 3.2],
};
for (const k in FOODS) addItem(k, { tile: k, cat: 'food', food: { h: FOODS[k][0], s: FOODS[k][1] } });
ITEMS[IID.carrot].blk = BID.carrots; ITEMS[IID.carrot].plant = true; ITEMS[IID.potato].blk = BID.potatoes; ITEMS[IID.potato].plant = true;

// ---------------- misc tools
addItem('bucket', { tile: 'bucket', max: 16, cat: 'tool', bucket: 'empty' });
addItem('water_bucket', { tile: 'water_bucket', max: 1, cat: 'tool', bucket: 'water' });
addItem('lava_bucket', { tile: 'lava_bucket', max: 1, cat: 'tool', bucket: 'lava' });
addItem('milk_bucket', { tile: 'milk_bucket', max: 1, cat: 'tool', bucket: 'milk' });
addItem('flint_and_steel', { tile: 'flint_and_steel', max: 1, dur: 64, cat: 'tool', igniter: true });
addItem('shears', { tile: 'shears', max: 1, dur: 238, cat: 'tool', tool: { kind: 'shears', tier: 0, speed: 5 } });
addItem('bow', { tile: 'bow', max: 1, dur: 384, cat: 'combat', bow: true });
addItem('arrow', { tile: 'arrow', cat: 'combat' });
addItem('oak_door', { tile: 'oak_door', cat: 'block', blk: BID.oak_door, doorItem: true });
addItem('red_bed', { tile: 'red_bed', max: 1, cat: 'block', blk: BID.bed, bedItem: true });
addItem('oak_sign', { tile: 'oak_sign', max: 16, cat: 'block', blk: BID.oak_sign });

// ---------------- tools & armor
const TOOL_MATS = {
  wooden: { tier: 0, speed: 2, dur: 59, dmg: 0, arm: 0 }, stone: { tier: 1, speed: 4, dur: 131, dmg: 1, arm: 0 }, iron: { tier: 2, speed: 6, dur: 250, dmg: 2, arm: 15 },
  golden: { tier: 0, speed: 12, dur: 32, dmg: 0, arm: 7 }, diamond: { tier: 3, speed: 8, dur: 1561, dmg: 3, arm: 33 },
};
const TOOL_KINDS = { sword: 4, pickaxe: 2, axe: 3, shovel: 1, hoe: 1 };
for (const m in TOOL_MATS) for (const k in TOOL_KINDS) {
  const M = TOOL_MATS[m], nm = m + '_' + k;
  addItem(nm, { tile: nm, max: 1, dur: M.dur, dmg: TOOL_KINDS[k] + (k === 'hoe' ? 0 : M.dmg), cat: k === 'sword' ? 'combat' : 'tool', tool: { kind: k, tier: M.tier, speed: M.speed } });
}
const ARMOR_PTS = { leather: [1, 3, 2, 1], golden: [2, 5, 3, 1], iron: [2, 6, 5, 2], diamond: [3, 8, 6, 3] };
const ARMOR_MULT = { leather: 5, golden: 7, iron: 15, diamond: 33 }, ARMOR_BASE = [11, 16, 15, 13], ARMOR_NAMES = ['helmet', 'chestplate', 'leggings', 'boots'];
for (const m in ARMOR_PTS) for (let s = 0; s < 4; s++) {
  const nm = m + '_' + ARMOR_NAMES[s];
  addItem(nm, { tile: nm, max: 1, dur: ARMOR_BASE[s] * ARMOR_MULT[m], cat: 'combat', armor: { slot: s, pts: ARMOR_PTS[m][s], mat: m } });
}
// spawn eggs (tile synthesised by the renderer: 'spawn_egg_<mob>')
const EGG_COLORS = { pig: [0xf0a5a2, 0xdb635f], cow: [0x443626, 0xa1a1a1], sheep: [0xe7e7e7, 0xffb5b5], chicken: [0xa1a1a1, 0xff0000], zombie: [0x00afaf, 0x799c65], skeleton: [0xc1c1c1, 0x494949], creeper: [0x0da70b, 0x000000], spider: [0x342d27, 0xa80e0e],
  enderman: [0x161616, 0x000000], slime: [0x51a03e, 0x7ebf6e], bat: [0x4c3e30, 0x0f0f0f], wolf: [0xd7d3d3, 0xceaf96], squid: [0x223b4d, 0x708899],
  villager: [0x563c33, 0xbd8b72], iron_golem: [0xdbcfbf, 0x74a332], snow_golem: [0xd9f2f2, 0x81a4a4], ghast: [0xf9f9f9, 0xbcbcbc], blaze: [0xf6b201, 0xfff87e], zombified_piglin: [0xea9393, 0x4c7129],
  piglin: [0x995f40, 0xf9f3a4], hoglin: [0xc66e55, 0x5f6464], strider: [0x9c3436, 0x4d494d], magma_cube: [0x340000, 0xfcfc00], wither_skeleton: [0x141414, 0x474d4d], silverfish: [0x6e6e6e, 0x303030], ender_dragon: [0x1c1c1c, 0xe079fa] };
for (const mob in EGG_COLORS) addItem('spawn_egg_' + mob, { tile: 'spawn_egg_' + mob, cat: 'egg', spawn: mob, eggColors: EGG_COLORS[mob] });
// ---- dimensions update items: appended after every older item so the ids stored in existing saves stay valid
for (const m of ['quartz', 'gold_nugget', 'iron_nugget', 'blaze_rod', 'blaze_powder', 'ghast_tear', 'magma_cream', 'nether_brick', 'popped_chorus_fruit']) addItem(m, { tile: m, cat: 'ingredient' });
addItem('nether_wart', { tile: 'nether_wart', cat: 'ingredient', blk: BID.nether_wart, plant: true });
addItem('ender_eye', { tile: 'ender_eye', cat: 'ingredient', enderEye: true });
addItem('fire_charge', { tile: 'fire_charge', cat: 'tool', igniter: true, charge: true });
addItem('end_crystal', { tile: 'end_crystal', cat: 'tool', endCrystal: true });
addItem('chorus_fruit', { tile: 'chorus_fruit', cat: 'food', food: { h: 4, s: 2.4 }, chorusFruit: true, alwaysEdible: true });
for (const n in DISPLAY_OVERRIDES) { /* keep */ }
Object.assign(DISPLAY_OVERRIDES, { quartz: 'Nether Quartz', ender_eye: 'Eye of Ender', nether_brick: 'Nether Brick', end_crystal: 'End Crystal', fire_charge: 'Fire Charge', dirt_path: 'Dirt Path', chorus_fruit: 'Chorus Fruit' });
for (const n of ['quartz', 'ender_eye', 'nether_brick', 'end_crystal', 'fire_charge', 'dirt_path', 'chorus_fruit']) if (IID[n] !== undefined) ITEMS[IID[n]].disp = DISPLAY_OVERRIDES[n];
for (const mob in EGG_COLORS) ITEMS[IID['spawn_egg_' + mob]].disp = titleCase(mob) + ' Spawn Egg';

// ---------------- stack helpers
// A stack is {id, n, d}: item id, count, damage (durability used)
const newStack = (id, n) => ({ id, n: n === undefined ? 1 : n, d: 0 });
const cloneStack = s => s ? { id: s.id, n: s.n, d: s.d || 0 } : null;
const stackMax = id => (ITEMS[id] ? ITEMS[id].max : 64);
const canMerge = (a, b) => a && b && a.id === b.id && (a.d || 0) === (b.d || 0);
const itemName = id => (ITEMS[id] ? ITEMS[id].name : 'unknown');

// ---------------- fuel & smelting
const FUEL = {};
const setFuel = (names, t) => names.forEach(n => { if (IID[n] !== undefined) FUEL[IID[n]] = t; });
setFuel(['coal', 'charcoal'], 1600); setFuel(['coal_block'], 16000); setFuel(['lava_bucket'], 20000);
setFuel(['oak_planks', 'spruce_planks', 'birch_planks', 'oak_log', 'spruce_log', 'birch_log', 'crafting_table', 'chest', 'bookshelf', 'oak_fence', 'oak_stairs', 'spruce_stairs', 'birch_stairs', 'ladder', 'oak_door', 'oak_fence_gate', 'oak_trapdoor'], 300);
setFuel(['acacia_planks', 'jungle_planks', 'dark_oak_planks', 'acacia_log', 'jungle_log', 'dark_oak_log', 'acacia_stairs', 'jungle_stairs', 'dark_oak_stairs'], 300);
setFuel(['acacia_slab', 'jungle_slab', 'dark_oak_slab', 'acacia_sapling', 'jungle_sapling', 'dark_oak_sapling'], 150);
setFuel(['oak_slab', 'spruce_slab', 'birch_slab', 'wooden_pickaxe', 'wooden_axe', 'wooden_shovel', 'wooden_hoe', 'wooden_sword', 'bow'], 150);
setFuel(['stick', 'oak_sapling', 'spruce_sapling', 'birch_sapling', 'dead_bush'], 100);
setFuel(['oak_sign'], 200); setFuel(['blaze_rod'], 2400); setFuel(['barrel', 'composter', 'lectern', 'fletching_table', 'cartography_table', 'smithing_table', 'loom'], 300);
for (const w of ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']) FUEL[IID[w + '_wool']] = 100;
for (const c of ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']) FUEL[IID[c + '_carpet']] = 67;
const SMELT = {};
const smelt = (a, b) => { SMELT[IID[a]] = IID[b]; };
smelt('iron_ore', 'iron_ingot'); smelt('gold_ore', 'gold_ingot'); smelt('sand', 'glass'); smelt('cobblestone', 'stone'); smelt('clay_ball', 'brick');
smelt('oak_log', 'charcoal'); smelt('spruce_log', 'charcoal'); smelt('birch_log', 'charcoal'); smelt('acacia_log', 'charcoal'); smelt('jungle_log', 'charcoal'); smelt('dark_oak_log', 'charcoal'); smelt('porkchop', 'cooked_porkchop'); smelt('beef', 'cooked_beef');
smelt('chicken', 'cooked_chicken'); smelt('mutton', 'cooked_mutton'); smelt('potato', 'baked_potato'); smelt('coal_ore', 'coal'); smelt('diamond_ore', 'diamond');
smelt('lapis_ore', 'lapis_lazuli'); smelt('redstone_ore', 'redstone'); smelt('emerald_ore', 'emerald'); smelt('stone_bricks', 'stone_bricks'); delete SMELT[IID.stone_bricks];
smelt('sandstone', 'smooth_stone'); smelt('clay', 'terracotta');
smelt('netherrack', 'nether_brick'); smelt('nether_quartz_ore', 'quartz'); smelt('nether_gold_ore', 'gold_ingot'); smelt('chorus_fruit', 'popped_chorus_fruit'); smelt('stone_bricks', 'cracked_stone_bricks');

// experience granted per smelted result (FurnaceRecipes.getSmeltingExperience)
const SMELT_XP = {};
for (const [n, v] of [['iron_ingot', 0.7], ['gold_ingot', 1.0], ['diamond', 1.0], ['emerald', 1.0], ['lapis_lazuli', 0.2], ['redstone', 0.7], ['coal', 0.1], ['glass', 0.1], ['stone', 0.1], ['brick', 0.3], ['bricks', 0.35],
  ['charcoal', 0.15], ['quartz', 0.2], ['nether_brick', 0.1], ['popped_chorus_fruit', 0.1], ['cracked_stone_bricks', 0.1], ['cooked_porkchop', 0.35], ['cooked_beef', 0.35], ['cooked_chicken', 0.35], ['cooked_mutton', 0.35], ['baked_potato', 0.35], ['smooth_stone', 0.1]]) if (IID[n] !== undefined) SMELT_XP[IID[n]] = v;

// ---------------- crafting recipes
const TAGS = {
  planks: ['oak_planks', 'spruce_planks', 'birch_planks', 'acacia_planks', 'jungle_planks', 'dark_oak_planks', 'crimson_planks', 'warped_planks'],
  wslabs: ['oak_slab', 'spruce_slab', 'birch_slab', 'acacia_slab', 'jungle_slab', 'dark_oak_slab'], logs: ['oak_log', 'spruce_log', 'birch_log', 'acacia_log', 'jungle_log', 'dark_oak_log'],
  wool: ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map(c => c + '_wool'),
  coal: ['coal', 'charcoal'], stone_tool: ['cobblestone'],
};
const RECIPES = [];
function ingIds(x) {
  if (x === undefined || x === ' ' || x === null) return null;
  if (x[0] === '#') return TAGS[x.slice(1)].map(n => IID[n]);
  if (IID[x] === undefined) throw new Error('recipe ingredient missing: ' + x);
  return [IID[x]];
}
function shaped(out, count, rows, key) {
  const h = rows.length, w = rows[0].length, pat = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pat.push(ingIds(rows[y][x] === ' ' ? null : key[rows[y][x]]));
  if (IID[out] === undefined) throw new Error('recipe output missing: ' + out);
  RECIPES.push({ shaped: true, w, h, pat, out: IID[out], count });
}
function shapeless(out, count, list) {
  if (IID[out] === undefined) throw new Error('recipe output missing: ' + out);
  RECIPES.push({ shaped: false, ing: list.map(ingIds), out: IID[out], count });
}
// wood
for (const w of ['oak', 'spruce', 'birch', 'acacia', 'jungle', 'dark_oak']) {
  shapeless(w + '_planks', 4, [w + '_log']);
  shaped(w + '_slab', 6, ['PPP'], { P: w + '_planks' });
  shaped(w + '_stairs', 4, ['P  ', 'PP ', 'PPP'], { P: w + '_planks' });
  shaped(w + '_stairs', 4, ['  P', ' PP', 'PPP'], { P: w + '_planks' });
}
shaped('stick', 4, ['P', 'P'], { P: '#planks' });
shaped('crafting_table', 1, ['PP', 'PP'], { P: '#planks' });
shaped('chest', 1, ['PPP', 'P P', 'PPP'], { P: '#planks' });
shaped('furnace', 1, ['CCC', 'C C', 'CCC'], { C: 'cobblestone' });
shaped('torch', 4, ['C', 'S'], { C: '#coal', S: 'stick' });
shaped('ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' });
shaped('oak_door', 3, ['PP', 'PP', 'PP'], { P: '#planks' });
shaped('oak_sign', 3, ['PPP', 'PPP', ' S '], { P: '#planks', S: 'stick' });
shaped('oak_fence', 3, ['PSP', 'PSP'], { P: '#planks', S: 'stick' });
shaped('bookshelf', 1, ['PPP', 'BBB', 'PPP'], { P: '#planks', B: 'book' });
shaped('red_bed', 1, ['WWW', 'PPP'], { W: '#wool', P: '#planks' });
// tools
const HEAD = { wooden: '#planks', stone: 'cobblestone', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const m in HEAD) {
  const k = { M: HEAD[m], S: 'stick' };
  shaped(m + '_pickaxe', 1, ['MMM', ' S ', ' S '], k);
  shaped(m + '_axe', 1, ['MM', 'MS', ' S'], k); shaped(m + '_axe', 1, ['MM', 'SM', 'S '], k);
  shaped(m + '_shovel', 1, ['M', 'S', 'S'], k);
  shaped(m + '_hoe', 1, ['MM', ' S', ' S'], k); shaped(m + '_hoe', 1, ['MM', 'S ', 'S '], k);
  shaped(m + '_sword', 1, ['M', 'M', 'S'], k);
}
const ARM = { leather: 'leather', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const m in ARM) {
  const k = { M: ARM[m] };
  shaped(m + '_helmet', 1, ['MMM', 'M M'], k); shaped(m + '_chestplate', 1, ['M M', 'MMM', 'MMM'], k);
  shaped(m + '_leggings', 1, ['MMM', 'M M', 'M M'], k); shaped(m + '_boots', 1, ['M M', 'M M'], k);
}
shaped('bow', 1, [' ST', 'S T', ' ST'], { S: 'stick', T: 'string' });
shaped('arrow', 4, ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' });
shaped('bucket', 1, ['I I', ' I '], { I: 'iron_ingot' });
shaped('shears', 1, [' I', 'I '], { I: 'iron_ingot' });
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);
shaped('bread', 1, ['WWW'], { W: 'wheat' });
shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' });
shaped('paper', 3, ['SSS'], { S: 'sugar_cane' });
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
shapeless('sugar', 1, ['sugar_cane']);
shapeless('bone_meal', 3, ['bone']);
// blocks
shaped('stone_bricks', 4, ['SS', 'SS'], { S: 'stone' });
shaped('bricks', 1, ['BB', 'BB'], { B: 'brick' });
shaped('sandstone', 1, ['SS', 'SS'], { S: 'sand' });
shaped('glowstone', 1, ['DD', 'DD'], { D: 'glowstone_dust' });
shaped('snow_block', 1, ['SS', 'SS'], { S: 'snowball' });
shaped('clay', 1, ['CC', 'CC'], { C: 'clay_ball' });
shaped('white_wool', 1, ['SS', 'SS'], { S: 'string' });
shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' });
shaped('hay_block', 1, ['WWW', 'WWW', 'WWW'], { W: 'wheat' });
shapeless('wheat', 9, ['hay_block']);
shaped('melon', 1, ['MMM', 'MMM', 'MMM'], { M: 'melon_slice' });
shapeless('melon_seeds', 1, ['melon_slice']);
shapeless('jack_o_lantern', 1, ['carved_pumpkin', 'torch']);
for (const [blk, it] of [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond'], ['emerald_block', 'emerald'], ['lapis_block', 'lapis_lazuli'], ['coal_block', 'coal'], ['redstone_block', 'redstone']]) {
  shaped(blk, 1, ['III', 'III', 'III'], { I: it }); shapeless(it, 9, [blk]);
}
shaped('cobblestone_slab', 6, ['CCC'], { C: 'cobblestone' }); shaped('stone_slab', 6, ['SSS'], { S: 'stone' });
shaped('stone_brick_slab', 6, ['SSS'], { S: 'stone_bricks' }); shaped('brick_slab', 6, ['BBB'], { B: 'bricks' }); shaped('sandstone_slab', 6, ['SSS'], { S: 'sandstone' });
for (const [n, b] of [['cobblestone_stairs', 'cobblestone'], ['stone_stairs', 'stone'], ['stone_brick_stairs', 'stone_bricks'], ['brick_stairs', 'bricks'], ['sandstone_stairs', 'sandstone']]) {
  shaped(n, 4, ['B  ', 'BB ', 'BBB'], { B: b }); shaped(n, 4, ['  B', ' BB', 'BBB'], { B: b });
}
shapeless('mossy_cobblestone', 1, ['cobblestone', 'oak_leaves']);
shaped('glass_pane', 16, ['GGG', 'GGG'], { G: 'glass' });
shaped('iron_bars', 16, ['III', 'III'], { I: 'iron_ingot' });
shaped('oak_fence_gate', 1, ['SPS', 'SPS'], { S: 'stick', P: '#planks' });
shaped('oak_trapdoor', 2, ['PPP', 'PPP'], { P: '#planks' });
shaped('cobblestone_wall', 6, ['CCC', 'CCC'], { C: 'cobblestone' });
shaped('red_sandstone', 1, ['SS', 'SS'], { S: 'red_sand' });
shaped('mossy_cobblestone_wall', 6, ['CCC', 'CCC'], { C: 'mossy_cobblestone' });
for (const c of ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']) shaped(c + '_carpet', 3, ['WW'], { W: c + '_wool' });
shapeless('granite', 2, ['diorite', 'cobblestone']);
// ---- the Nether and the End
shapeless('crimson_planks', 4, ['crimson_stem']); shapeless('warped_planks', 4, ['warped_stem']);
shaped('nether_bricks', 1, ['NN', 'NN'], { N: 'nether_brick' });
shaped('nether_brick_fence', 6, ['NBN', 'NBN'], { N: 'nether_bricks', B: 'nether_brick' });
shaped('nether_brick_stairs', 4, ['B  ', 'BB ', 'BBB'], { B: 'nether_bricks' }); shaped('nether_brick_stairs', 4, ['  B', ' BB', 'BBB'], { B: 'nether_bricks' });
shaped('nether_brick_slab', 6, ['BBB'], { B: 'nether_bricks' });
shaped('nether_wart_block', 1, ['NNN', 'NNN', 'NNN'], { N: 'nether_wart' });
shapeless('blaze_powder', 2, ['blaze_rod']);
shapeless('ender_eye', 1, ['ender_pearl', 'blaze_powder']);
shapeless('fire_charge', 3, ['gunpowder', 'blaze_powder', '#coal']);
shapeless('magma_cream', 1, ['slime_ball', 'blaze_powder']);
shaped('magma_block', 1, ['MM', 'MM'], { M: 'magma_cream' });
shaped('quartz_block', 1, ['QQ', 'QQ'], { Q: 'quartz' });
shaped('end_crystal', 1, ['GGG', 'GEG', 'GTG'], { G: 'glass', E: 'ender_eye', T: 'ghast_tear' });
shaped('purpur_block', 4, ['PP', 'PP'], { P: 'popped_chorus_fruit' });
shaped('purpur_slab', 6, ['PPP'], { P: 'purpur_block' }); shaped('purpur_pillar', 1, ['S', 'S'], { S: 'purpur_slab' });
shaped('purpur_stairs', 4, ['P  ', 'PP ', 'PPP'], { P: 'purpur_block' }); shaped('purpur_stairs', 4, ['  P', ' PP', 'PPP'], { P: 'purpur_block' });
shaped('end_stone_bricks', 4, ['EE', 'EE'], { E: 'end_stone' });
shaped('end_rod', 4, ['B', 'P'], { B: 'blaze_rod', P: 'popped_chorus_fruit' });
shapeless('mossy_stone_bricks', 1, ['stone_bricks', 'vine']);
// ---- nuggets and village workstations
shapeless('iron_nugget', 9, ['iron_ingot']); shaped('iron_ingot', 1, ['NNN', 'NNN', 'NNN'], { N: 'iron_nugget' });
shapeless('gold_nugget', 9, ['gold_ingot']); shaped('gold_ingot', 1, ['NNN', 'NNN', 'NNN'], { N: 'gold_nugget' });
shaped('lantern', 1, ['NNN', 'NTN', 'NNN'], { N: 'iron_nugget', T: 'torch' });
shaped('composter', 1, ['S S', 'S S', 'SSS'], { S: '#wslabs' });
shaped('barrel', 1, ['PSP', 'P P', 'PSP'], { P: '#planks', S: '#wslabs' });
shaped('smoker', 1, [' L ', 'LFL', ' L '], { L: '#logs', F: 'furnace' });
shaped('blast_furnace', 1, ['III', 'IFI', 'SSS'], { I: 'iron_ingot', F: 'furnace', S: 'smooth_stone' });
shaped('fletching_table', 1, ['FF', 'PP', 'PP'], { F: 'flint', P: '#planks' });
shaped('cartography_table', 1, ['AA', 'PP', 'PP'], { A: 'paper', P: '#planks' });
shaped('smithing_table', 1, ['II', 'PP', 'PP'], { I: 'iron_ingot', P: '#planks' });
shaped('stonecutter', 1, [' I ', 'SSS'], { I: 'iron_ingot', S: 'stone' });
shaped('loom', 1, ['SS', 'PP'], { S: 'string', P: '#planks' });
shaped('grindstone', 1, ['TST', 'P P'], { T: 'stick', S: 'stone_slab', P: '#planks' });
shaped('lectern', 1, ['SSS', ' B ', ' S '], { S: '#wslabs', B: 'bookshelf' });
shaped('cauldron', 1, ['I I', 'I I', 'III'], { I: 'iron_ingot' });
shaped('brewing_stand', 1, [' B ', 'CCC'], { B: 'blaze_rod', C: 'cobblestone' });

// Matching. grid: array of item ids (0 = empty), gw x gh. Returns {out,count,recipe} or null.
function findRecipe(grid, gw, gh) {
  let minx = gw, miny = gh, maxx = -1, maxy = -1, cnt = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (grid[y * gw + x]) { cnt++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  if (!cnt) return null;
  const bw = maxx - minx + 1, bh = maxy - miny + 1;
  for (const r of RECIPES) {
    if (r.shaped) {
      if (r.w !== bw || r.h !== bh) continue;
      for (let mirror = 0; mirror < 2; mirror++) {
        let ok = true;
        for (let y = 0; y < bh && ok; y++) for (let x = 0; x < bw; x++) {
          const g = grid[(miny + y) * gw + minx + (mirror ? bw - 1 - x : x)], p = r.pat[y * bw + x];
          if (p === null ? g !== 0 : (g === 0 || p.indexOf(g) < 0)) { ok = false; break; }
        }
        if (ok) return r;
      }
    } else {
      if (r.ing.length !== cnt) continue;
      const items = []; for (let i = 0; i < gw * gh; i++) if (grid[i]) items.push(grid[i]);
      const used = new Array(items.length).fill(false);
      const rec = (k) => {
        if (k === r.ing.length) return true;
        for (let i = 0; i < items.length; i++) if (!used[i] && r.ing[k].indexOf(items[i]) >= 0) { used[i] = true; if (rec(k + 1)) return true; used[i] = false; }
        return false;
      };
      if (rec(0)) return r;
    }
  }
  return null;
}

// ---------------- tool / breaking helpers
function toolSpeedFor(stack, blk) {
  // returns [speedMultiplier, canHarvest]
  const d = BLOCKS[blk], it = stack ? ITEMS[stack.id] : null;
  let speed = 1;
  if (it && it.tool && d.tool) {
    if (it.tool.kind === d.tool) speed = it.tool.speed;
    else if (it.tool.kind === 'sword' && (d.name.endsWith('_leaves') || d.name.endsWith('_wool'))) speed = 1.5;
  }
  let can = true;
  if (d.needTool) {
    can = !!(it && it.tool && it.tool.kind === d.tool && it.tool.tier >= d.tier);
  }
  if (d.web && it && it.tool && (it.tool.kind === 'sword' || it.tool.kind === 'shears')) { speed = 15; can = true; }   // cobwebs: swords and shears cut them 15x faster
  return [speed, can];
}
function breakTicks(stack, blk, onGround, inWater) {
  const d = BLOCKS[blk];
  if (d.hard < 0) return Infinity;
  if (d.hard === 0) return 1;
  let [speed, can] = toolSpeedFor(stack, blk);
  if (!onGround) speed /= 5;
  if (inWater) speed /= 5;
  const dmg = speed / d.hard / (can ? 30 : 100);
  return Math.max(1, Math.ceil(1 / dmg));
}
