# Asset module spec (shared by all asset agents)

Project: a single-file browser Minecraft clone (`D:\sonnet 5.5\minecraft.html`, built by concatenating `src/*.js`).
You are writing ONE self-contained asset module. All modules are later inlined into one HTML page, so:

* **Plain ES2020, no imports, no DOM access at generation time** (tile painters operate on typed arrays so they can be tested under Node).
* Wrap everything in an IIFE and publish exactly one global: `(function (G) { ... })(typeof window !== 'undefined' ? window : globalThis);`
* Never touch another module's global. Keep helper names private inside your IIFE (all modules end up in the same page).
* Deterministic: use your own seeded PRNG (e.g. mulberry32 seeded from a hash of the tile name). Same output every run.
* Fast: whole module must generate in < 400 ms in a browser. No per-pixel expensive stuff.
* Pixel data layout everywhere: `Uint8ClampedArray`, RGBA, row-major, origin top-left, non-premultiplied alpha.

## Goal: look like *vanilla Minecraft Java 1.20*, as close as you can

The user's #1 requirement is that the game looks as similar to real Minecraft as possible. Vanilla textures are hand-painted
pixel art with **tight palettes (3-8 colours per texture)** and *clustered* ("blotchy") variation - never per-pixel white noise.

Reference material (use it! read the images with the Read tool):

* `D:\sonnet 5.5\_ref\out\*.txt` - **exact palettes of the real textures**: per texture `mean colour`, number of transparent / semi-transparent pixels, and the top colours as `#rrggbb x pixelcount` (`@alpha` suffix when alpha<255).
  Files: `blocks_a.txt` (terrain/ores/liquids), `blocks_b.txt` (wood/plants/etc), `blocks_c.txt` (wool/metal blocks/functional/destroy stages), `items_a.txt` (materials/food/misc), `items_tools.txt` (tools+armor), `entities.txt` (mob skins), `env.txt` (sun/moon).
* `D:\sonnet 5.5\_ref\shots\*.jpg` - screenshots of the real textures magnified ~6x with labels (checkerboard = transparent):
  `blocks1_terrain_ores.jpg`, `blocks2_wood_plants.jpg`, `blocks3_crafted_wool_functional.jpg`, `items1_materials_food.jpg`, `items2_tools.jpg`, `items3_armor.jpg`, `entities_overview.jpg`.

**Use the palettes numerically** (the colours you paint with should be the real ones or extremely close) and study the screenshots for the *structure*
(where the dark/light clusters are, brick rows, plank seams, ore blob shapes, outline treatment...). Then re-create each texture **procedurally in your own code**
(seeded noise + hand-placed structure + palette quantisation). Do NOT paste transcribed 16x16 pixel dumps of the originals; write painters.
Where a texture is simple (dirt, stone, sand, gravel...) a good clustered-noise painter with the exact palette is nearly indistinguishable from the real thing.
Where it is structural (bricks, cobblestone, planks, bookshelf, crafting table, furnace, TNT, tools, food...) paint the structure deliberately with small helper functions
(rect, line, pixel, outline, dither) and then add subtle noise.

## Verification loop (mandatory)

1. Write a small Node script (put it in `D:\sonnet 5.5\tools\`, e.g. `tools/dump_<yourmodule>.js`) that loads your module (`vm` module or `globalThis` trick) and writes a contact-sheet PNG
   (8x nearest-neighbour upscale, grid layout, checkerboard behind transparency) using only Node built-ins (`zlib` for the PNG encoder; write your own 30-line PNG writer).
2. Write sheets to `D:\sonnet 5.5\_ref\agent_out\` and open them with the Read tool to LOOK at them. Compare side by side with the reference screenshots.
3. Iterate at least 3 times, fixing everything that does not look like vanilla (wrong hue, too noisy, no structure, muddy, outlines wrong...). Check the tinted (gray) textures too.
4. Run your module under `node --check` and execute it once to make sure there are no exceptions and that every required name exists.

## Rules

* Only create/modify: your module file, your `tools/dump_*.js` script, and files under `_ref/agent_out/`. Do not edit anything else.
* Do not use the browser tools (another agent owns the shared browser pane). Node + Read-the-PNG is your visual feedback loop.
* When done, reply with a SHORT summary (what is in the file, the exported global, anything the engine author must know). Do not paste code in the reply.

---------------------------------------------------------------------------------------------------------

# Module A - `src/tex_blocks.js`  (global `TexBlocks`)

```js
G.TexBlocks = {
  size: 16,
  names: [ ... ],                // every tile name below, in the order listed here
  tiles: { name: Uint8ClampedArray(16*16*4), ... },
  animated: {                    // only for animated tiles
    water_still: { frameTime: 2, frames: [Uint8ClampedArray(1024), ...] },  // frameTime in game ticks (50 ms). tiles[name] === frames[0]
    ...
  }
};
```
Generate everything eagerly at load time inside the IIFE.

### Tinted textures (IMPORTANT)
In vanilla these textures are **grayscale** and the game multiplies them at render time by a biome colour. Paint them as neutral grays (R=G=B) exactly like vanilla
(see palette: `grass_block_top` mean `#939393`). Tint colours the engine will apply (so you can sanity-check how it will look; multiply the gray by them):
grass `#91bd59`, foliage(oak) `#77ab2f`, spruce leaves `#619961`, birch leaves `#80a755`, lily pad `#208030`, water `#3f76e4`.
Gray tinted tiles: `grass_block_top`, `grass_block_side_overlay`, `short_grass`, `fern`, `sugar_cane`, `oak_leaves`, `spruce_leaves`, `birch_leaves`, `lily_pad`, `water_still`, `water_flow`.
(`grass_block_side` is NOT gray: it is the dirt side with its own untinted green fringe; the engine draws the tinted `grass_block_side_overlay` on top.)
Transparent pixels must have alpha 0 (leaves have real holes; see the `oak_leaves` palette line for `transparent=`). Fully transparent pixels should carry the RGB of a
nearby opaque colour (not 0,0,0) to avoid dark fringes when mip-mapped.
Water tiles are semi-transparent gray-white (alpha 180). Ice is semi-transparent (alpha 190). Glass has a light-blue frame and transparent centre.

### Tile list (all names, exact spelling)
Terrain: `stone granite diorite andesite dirt grass_block_top grass_block_side grass_block_side_overlay grass_block_snow podzol_top podzol_side gravel sand sandstone sandstone_top sandstone_bottom clay snow ice bedrock obsidian cobblestone mossy_cobblestone stone_bricks bricks smooth_stone smooth_stone_slab_side coal_ore iron_ore gold_ore diamond_ore redstone_ore lapis_ore emerald_ore`
Liquids (**animated**): `water_still water_flow lava_still lava_flow`
 - `water_still`: 32 frames, frameTime 2 - slowly drifting bright/dim wavelets, tileable in both axes, gray (tinted), alpha 180.
 - `water_flow`: 32 frames, frameTime 2 - same look but streaks that scroll DOWN the tile (tileable vertically) - used on water side faces.
 - `lava_still`: 24 frames, frameTime 4 - orange/yellow bubbling blotches (see palette `lava_still`: #d14f0c ... #dc711d, brighter yellow-orange highlights), fully opaque, tileable.
 - `lava_flow`: 24 frames, frameTime 3 - same with downward drift.
Wood/plants: `oak_planks spruce_planks birch_planks oak_log oak_log_top spruce_log spruce_log_top birch_log birch_log_top oak_leaves spruce_leaves birch_leaves oak_sapling spruce_sapling birch_sapling short_grass fern dandelion poppy blue_orchid allium azure_bluet red_tulip oxeye_daisy cornflower brown_mushroom red_mushroom dead_bush lily_pad sugar_cane cactus_top cactus_side cactus_bottom pumpkin_top pumpkin_side carved_pumpkin jack_o_lantern melon_side melon_top wheat_stage0 wheat_stage1 wheat_stage2 wheat_stage3 wheat_stage4 wheat_stage5 wheat_stage6 wheat_stage7 farmland farmland_moist hay_block_side hay_block_top glass glass_pane_top`
 (cross-plane plants - saplings, flowers, mushrooms, grass, fern, dead_bush, sugar_cane, wheat stages - are drawn on a transparent background exactly like vanilla; `glass_pane_top` is the narrow 2px-wide edge strip used on top of panes.)
Crafted: `white_wool orange_wool magenta_wool light_blue_wool yellow_wool lime_wool pink_wool gray_wool light_gray_wool cyan_wool purple_wool blue_wool brown_wool green_wool red_wool black_wool iron_block gold_block diamond_block emerald_block lapis_block coal_block redstone_block glowstone tnt_side tnt_top tnt_bottom bookshelf crafting_table_top crafting_table_front crafting_table_side furnace_front furnace_front_on furnace_side furnace_top torch ladder oak_door_top oak_door_bottom`
 (`torch` is a 16x16 tile with the 2px-wide stick centred, orange/yellow flame head, transparent elsewhere; `ladder` transparent with two rails + rungs; doors are opaque planks with panel + a tiny handle.)
Chest (vanilla draws it from an entity texture; we need 3 flat tiles): `chest_top chest_side chest_front` - brown planks with dark outline bands; `chest_front` has the iron latch. (Painted to look like the vanilla chest faces: lid seam line at row ~5, latch in the middle.)
Bed (simplified faces of the bed slab): `bed_top_head bed_top_foot bed_side_head bed_side_foot bed_end_head bed_end_foot bed_bottom` (red wool blanket on wooden frame; head top has a white pillow; side views show the wooden frame at the bottom and red blanket above).
Destroy overlay: `destroy_stage_0 ... destroy_stage_9` - dark crack lines (near-black, alpha ~200) on transparent; each stage strictly adds more cracks than the previous. Cracks should look like vanilla (see `blocks3` screenshot).

Total ~210 tiles. Every name above MUST exist in `tiles` and `names`.

---------------------------------------------------------------------------------------------------------

# Module B - `src/tex_items.js`  (global `TexItems`)

```js
G.TexItems = { size: 16, names: [...], tiles: { name: Uint8ClampedArray(1024) } };
```
Item sprites: transparent background, vanilla-style 1px dark outlines and 3-4 tone shading, held diagonally like vanilla (tools point up-right, handle at lower-left).
Study `items1/2/3` screenshots and the palettes in `items_a.txt` / `items_tools.txt` carefully - the material palettes (wood/stone/iron/gold/diamond) are given exactly.
Build tools from shared silhouettes (sword, pickaxe, axe, shovel, hoe) parameterised by a 4-5 colour material palette + the wooden-stick handle palette, exactly like vanilla
(vanilla tools of every material share the same shapes; only head colours differ). Same idea for armor. Paint `leather_*` armor already in the default leather brown (#a06540 family) - the vanilla file is gray because the game tints it, we do not.

Names:
Materials: `stick coal charcoal iron_ingot gold_ingot diamond emerald redstone lapis_lazuli flint clay_ball brick paper book string feather leather bone bone_meal gunpowder sugar egg snowball glowstone_dust`
Food & seeds: `wheat_seeds wheat bread apple golden_apple melon_slice melon_seeds pumpkin_seeds cookie carrot potato baked_potato porkchop cooked_porkchop beef cooked_beef chicken cooked_chicken mutton cooked_mutton rotten_flesh spider_eye`
Misc: `bucket water_bucket lava_bucket milk_bucket flint_and_steel shears bow arrow oak_door red_bed spawn_egg spawn_egg_overlay`
 (`spawn_egg` = grayscale-white egg shape, `spawn_egg_overlay` = grayscale-white spots; the engine multiplies them by two mob colours and composites - keep both neutral gray/white.)
Tools (prefixes `wooden stone iron golden diamond` x kinds `sword pickaxe axe shovel hoe`): `wooden_sword wooden_pickaxe wooden_axe wooden_shovel wooden_hoe stone_sword ... diamond_hoe` (25 names)
Armor (prefixes `leather iron golden diamond` x `helmet chestplate leggings boots`): 16 names.

---------------------------------------------------------------------------------------------------------

# Module C - `src/tex_entities.js`  (global `TexEntities`)

```js
G.TexEntities = {
  skins: { steve:{w:64,h:64,data}, zombie:{w:64,h:64,data}, skeleton:{w:64,h:32,data}, creeper:{w:64,h:32,data}, pig:{w:64,h:32,data}, cow:{w:64,h:32,data},
           sheep:{w:64,h:32,data}, sheep_fur:{w:64,h:32,data}, chicken:{w:64,h:32,data}, spider:{w:64,h:32,data}, spider_eyes:{w:64,h:32,data} },
  env:   { sun:{w:32,h:32,data}, moon:{w:128,h:64,data} },   // moon = 4x2 grid of 32x32 phases
  gui:   { name:{w,h,data}, ... }                            // small HUD icons, see below
};
```
**Skins must use the exact vanilla UV layouts** (the engine maps boxes with the standard Minecraft box-unwrap: for a box of size w x h x d at texture offset (u,v):
top = (u+d, v, w, d); bottom = (u+d+w, v, w, d); right/east side = (u, v+d, d, h); front = (u+d, v+d, w, h); left/west side = (u+d+w, v+d, d, h); back = (u+2d+w, v+d, w, h).)
Vanilla box offsets you must respect (u,v = texture offset, sizes w x h x d):
* Player/zombie 64x64: head(0,0) 8x8x8; hat overlay(32,0); body(16,16) 8x12x4; jacket overlay (16,32); right arm(40,16) 4x12x4; right sleeve overlay (40,32);
  left arm (32,48) 4x12x4; left sleeve overlay (48,48); right leg (0,16) 4x12x4; right pants overlay (0,32); left leg (16,48) 4x12x4; left pants overlay (0,48). Overlays may be left transparent.
* `steve`: classic Steve - brown hair (#2b1e0d/#332411), skin (#aa7259 / #9b6349 / #90593f), cyan shirt (#00afaf, #00a4a4, #049595, #058888, #007f7f), blue-purple jeans (#41359b, #3a3189, #463aa5), dark-gray shoes (#4a4a4a #373737), face with white/blue-violet eyes and mouth like the classic Steve face (see entities.txt palette + `entities_overview.jpg`).
* `zombie`: same layout; green skin (#3e692d/#3b622f/#497135/#4e7b36), cyan shirt, dark blue pants (#302872/#463aa5/#3a3189), classic zombie face (dark eyes, slightly darker mouth).
* Skeleton 64x32: head(0,0) 8x8x8, body(16,16) 8x12x4, arm(40,16) 2x12x2, leg(0,16) 2x12x2 (left limbs mirror right ones in the engine). Bone grays from `entities.txt`, dark eye sockets, ribs on body.
* Creeper 64x32: head(0,0) 8x8x8, body(16,16) 8x12x4, leg(0,16) 4x6x4. The mottled creeper green camouflage (use the top colours in entities.txt) and the iconic face (two black square eyes, mouth) on the head front face (x 8..15, y 8..15).
* Pig 64x32: head(0,0) 8x8x8 (snout box (16,16) 4x3x1 sits on the head-front); body(28,8) 10x16x8; leg(0,16) 4x6x4. Pink `#e6918b`-family, snout, two dark-eye front face.
* Cow 64x32: head(0,0) 8x8x6; horns (22,0) 1x3x1; body(18,4) 12x18x10; udder(52,0) 4x6x1; leg(0,16) 4x12x4. Brown-black with white patches; head face with eyes + pale muzzle.
* Sheep 64x32: head(0,0) 6x6x8; body(28,8) 8x16x6; leg(0,16) 4x12x4 (skin is the pinkish/beige bare sheep); `sheep_fur` (wool overlay): head wool(0,0) 6x6x6, body wool (28,8) 8x16x6 (engine inflates it), leg wool (0,16) 4x6x4 - white fluffy wool tones (#f8f8f8 #efefef #dfdfdf #d4d4d4); it is multiplied by the sheep color by the engine, so keep it neutral white/gray.
* Chicken 64x32: head(0,0) 4x6x3; body(0,9) 6x6x8; bill(14,0) 4x2x2; chin/wattle(14,4) 2x2x2; leg(26,0) 3x5x3; wing(24,13) 1x4x6. White with red comb/wattle, yellow-orange beak & feet.
* Spider 64x32: head(32,4) 8x8x8; neck(0,0) 6x6x6; body(0,12) 10x8x12; leg(18,0) 16x2x2. Dark brown-black fur with the red eyes (see palette #a80e0e etc.) and lighter marks. `spider_eyes`: transparent everywhere except the glowing red eye pixels on the head front.
Look at `entities_overview.jpg` for the general layout of the real ones and paint richly (clustered shading, not flat).

**env.sun** 32x32: vanilla sun = bright white-yellow square core with soft glow; drawn with additive blending, so background pixels are pure black `#000000` and the sun is pale yellow/white (`#ffd54a` / `#ffffb0` / white).
**env.moon** 128x64: 8 phases in a 4x2 grid of 32x32 frames, black background (additive), pale gray-white disc with a few darker crater patches; frame order like vanilla: top row full moon, waning gibbous, last quarter, waning crescent; bottom row new moon, waxing crescent, first quarter, waxing gibbous. Phase shading = darken part of the disc (blocky/pixelated like vanilla, discs are ~24px across).

**gui icons** (9x9 unless noted; transparent background; vanilla HUD look - 1px black outlines):
`heart_container` (dark-outlined empty heart background), `heart_container_blink` (white-outlined variant shown when damaged), `heart_full`, `heart_half`, `heart_full_blink`, `heart_half_blink` (same but highlighted lighter/white for the damage flash),
`food_container` (dark outlined empty drumstick), `food_full`, `food_half`, `armor_empty`, `armor_half`, `armor_full`, `bubble` (blue air bubble), `bubble_pop`,
`xp_bar_bg` (182x5), `xp_bar_fg` (182x5, green with bright top row - vanilla xp bar), `crosshair` (15x15 white plus, solid, 1px arms; the engine draws it with an inverted-colour blend).
Hearts are the vanilla shape (2-bump heart, highlight pixel near top-left, dark red outline, red fill `#ff1313` family). Drumsticks are vanilla brown/tan with bone end. Armor icon is a gray chestplate outline.

---------------------------------------------------------------------------------------------------------

# Module D - `src/audio.js`  (global `MCAudio`) - see `src/SPEC_AUDIO.md`
