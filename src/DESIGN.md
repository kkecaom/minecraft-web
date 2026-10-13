# Minecraft Web Edition - architecture notes

Deliverable: `minecraft.html` (single self-contained file, no network access needed) built by `node tools/build.js` from `src/*` (order: assets -> `MCShared()` -> game parts listed in `tools/game_order.txt`).
Open it in any modern browser (Chrome / Edge / Firefox / Safari, WebGL2 required). Click the canvas to capture the mouse; audio starts on the first click.

## Layers (all in one page, top-level script scope unless noted)
* **Asset modules** (IIFE globals, procedural, deterministic): `TexBlocks` (`tex_blocks.js`) extended by `tex_extra.js` (fire, panes, bars, trapdoor, vine, cobweb, spawner, new woods/terracotta/red sand),
  `TexItems` (`tex_items.js`, extended by `tex_mobs.js`), `TexEntities` (`tex_entities.js` skins/sun/moon/HUD icons, extended by `tex_mobs.js` with enderman/slime/bat), `MCAudio` (`audio.js`, procedural SFX + generative piano music). See SPEC_ASSETS.md / SPEC_AUDIO.md.
* **MCShared()** - one big function whose source is ALSO used as Web Worker source (`MCShared.toString()`), so it must be pure (no DOM / no game globals).
  Parts (concatenated inside the function body by build.js): `shared_core.js` (constants, PRNG, Perlin noise), `shared_blocks.js` (block registry, lookup tables, box models, biome table),
  `shared_gen.js` (terrain/biomes/caves/ores/trees/dungeons/badlands strata), `shared_mesh.js` (chunk-section mesher -> packed vertices, fire planes, connection masks).
  Worker protocol: main->worker `{t:'init',tiles,seed}`, `{t:'gen',id,cx,cz}`, `{t:'mesh',id,...padded 18^3 arrays}`; worker->main results with transferred ArrayBuffers (`gen` also returns passive spawn points and block-entity descriptors).
  Fallback when Workers fail: the same functions run synchronously on the main thread, time-sliced.
* World data: chunk = 16x16x256, `blocks` Uint8Array, `meta` Uint8Array, `light` Uint8Array (sky<<4|block), `biome` Uint8Array(256), `height` Uint16Array(256), block entities in a Map. Index `(y<<8)|(z<<4)|x`.
  Sections of 16 layers meshed separately. Meshing needs the chunk + its 4 neighbours lit; generation radius = view radius + 1.
* Lighting: main-thread BFS (sky + block, vertical sky column rule "15 goes straight down", add/remove queues), border exchange when neighbours arrive.
* Terrain vertex (16 bytes): int16 pos x,y,z (1/256 block, section-local) | u8 u,v (0..16 within tile) | u16 tile | u8 r,g,b,a(unused) | u8 sky,block (level*17).
  Face order everywhere: 0 down(-y) 1 up(+y) 2 north(-z) 3 south(+z) 4 west(-x) 5 east(+x). Face shade 0.5/1/0.8/0.8/0.6/0.6, AO like MC smooth lighting (1 - 0.2*occluders, both sides -> 0.4).
* Textures: WebGL2 TEXTURE_2D_ARRAY, one 16x16 layer per tile (blocks + items + extras), custom alpha-aware mip chain, NEAREST mag / NEAREST_MIPMAP_LINEAR min. Animated tiles (water, lava, fire) re-upload level 0 each frame they change.
* Lightmap in fragment shader like MC: b(x)=x/(4-3x); sky * dayFactor + warm block light.
* Entities: skin-mapped box models authored in Minecraft model space (`g_mobs.js`), one 256x256 skin atlas, dynamic batches `bSkin` (opaque/alpha-tested), `bSkinT` (translucent slime gel), `bTile`, `bAlpha` (particles, rain, lightning).
* UI: 2D canvas overlay on top of the GL canvas, bitmap pixel font, integer GUI scale (auto like MC).
* Game loop: fixed 20 TPS logic with interpolation (rAF + a setInterval fallback for hidden tabs); MC physics constants (gravity 0.08, drag 0.98, jump 0.42, walk 0.1, sprint x1.3).
* Save: IndexedDB (modified chunks RLE + block entities + player + world meta) with an in-memory fallback.
* Block ids are assigned in registration order in shared_blocks.js - only APPEND new blocks.

## Gameplay systems (all in `g_*.js`)
survival + creative, hunger/regeneration, fall/drown/fire/lava damage, armor, XP and levels, tool tiers/durability, crafting (2x2 / 3x3), furnace with fuel + XP, chests, beds (sleep through the night), buckets, fluids, falling blocks, TNT/creeper explosions,
fire (flint & steel, spreading, burning entities), weather (rain, snow, thunderstorms with lightning), day/night with moon phases, mobs with AI (pig cow sheep chicken with breeding/babies, zombie skeleton creeper spider enderman slime bat), dungeons with monster spawners and loot chests,
21 biomes (plains forest birch forest dark forest taiga snowy plains/taiga/peaks windswept hills swamp jungle savanna desert badlands beaches rivers oceans), caves/ravine-free tunnels, ore veins, chat commands (`/gamemode /time /tp /give /summon /kill /weather /difficulty /seed /setblock /fill /clear /xp /heal /spawnpoint /locate /dimension`).

Also: signs (`g_signs.js`: block entity `{type:'sign',lines:[4]}`, vanilla-style edit screen, text drawn with the bitmap font into a 5x5 cell canvas atlas and sampled by the skin shader through the `bSign` dynamic batch), wolves (neutral, bone taming 1/3, sit toggle, meat heals, defend their owner, tamed wolves are stored in the world record `pets` and respawn with the player), squid (water swimming, ink sacs).
Mouse handling: pointer lock with click-to-resume (Esc key presses are not user gestures, so `resumeGame()` waits for the lock; `onLockError` falls back to an unlocked mode only if a lock never succeeded, where the arrow keys look and Esc opens the pause menu); `beforeunload` asks before closing while playing.

## Dimensions (Overworld / Nether / End), villages, the dragon
* One `World` at a time. `game.dim` = 'overworld' | 'nether' | 'end'; workers get a numeric code (0/1/2) in every `gen` message and call `generateChunk(seed,cx,cz,dim)`
  (`shared_dims.js`: Nether biomes / fortresses via `fortressAt`, End island + spikes + podium via `endTop`, `endSpikes`, `placeEndPodium`; `shared_struct.js`: villages, strongholds, `locateStructure`).
  Each dimension stores chunks under its own store id: `rec.id`, `rec.id+'~nether'`, `rec.id+'~end'` (deleteWorld clears all three).
* World record additions: `rec.dim`, `rec.portals {overworld:[[x,y,z,axis]], nether:[...]}` (linked Nether portals, search radius 16 / 128),
  `rec.end {killed, everKilled, crystals[], dragonHp, gateways[{x,y,z,exit}], gatewayPool[], seenCredits}`, `rec.pets[].dim`, stats `dim_nether`, `dim_end`, `traded`, `bartered`, `golem_built`, ...
* `g_dims.js` = travel: `changeDimension(to, arrival)` drops the world (entities captured into their chunks), builds the new one, then `completeArrival` places the player
  (portal linking / `createPortalNear` like PortalForcer, End platform at `END_SPAWN`, respawn, command). Nether portal frames: `PortalShape` rules (2-21 wide, 3-21 tall), 80-tick wait, 10-tick cooldown.
  End portal: 12 frames with eyes facing inward. Gateways at radius 96 / y 75 lead ~1024 blocks out (`gatewayExitFor`). Credits once per world, then back to the Overworld.
* Persistent mobs (`def.chunkSave` or `e.persist`: villagers, golems, crystals, the dragon, ...) are serialized into their chunk record `c.ents` (`serializeMob`, `saveData`/`loadData`) when the chunk unloads / the game saves, and come back in `spawnTick` (`restoreChunkEntities`).
* Lightmap per dimension (MC LightTexture): block light x1.5 everywhere (`u_blkMul`), Nether ambient 0.1 + faint blue sky term 0.24, End `force` 0.25 (forced bright tint); fog per Nether biome, End fog thickens during the fight.
* Villages (`g_village.js`): villagers have profession / level / trades (`VTRADES`, 2 offers per level), home bed, job site (claimed like AcquirePoi, reset when lost before the first trade), daily schedule (work / meet at the bell / sleep), A* paths through doors, panic + golem summoning;
  `TradeScreen` follows MerchantMenu. Iron / snow golems are also built from blocks (`checkGolemBuild`).
* Nether / End mobs: `g_mobs2.js` (models via `MStack` in MC model space, classes registered in `MOB_CLASSES`), the dragon in `g_dragon.js` (MC phase manager, 8 part hitboxes, crystal healing, death sequence -> `onDragonKilled`).
* Advancements are grouped in tabs (`tab`: story / adventure / nether / end); the screen pans by dragging.

## Development helpers
`node tools/build.js` builds; `node tools/test_shared.js [seed]` tests worldgen/mesher in Node; `node tools/preview_tex.js out.png name...` renders texture sheets.
URL params (dev only): `?dev=survival|creative&seed=&time=&tp=x,y,z&look=yaw,pitch&screen=inventory|crafting|creative|pause|options&give=0&size=1280x720`; `window.__game`, `window.__errs`, `game.devShot(name)`.

## Divine Beast Vah Medoh world (world preset `medoh`, added 2026-10-12)
A hand-sculpted diorama of Zelda BotW's wind Divine Beast (freed state: blue energy, perched on the Rito Village spire, red targeting beam), playable as its own world.
* **World record**: `rec.preset = 'medoh'` (creative, peaceful, opens at time 22900 = just before sunrise). `Game.ensureFeaturedWorlds()` (called from `g_boot.js`) puts one such world, "Divine Beast Vah Medoh",
  into the world list once (`localStorage.mcw_medoh_world = '1'` remembers it, so deleting the world is respected). The Create World screen also has a `World Type` button (Default / Divine Beast Vah Medoh).
* **Generator**: `World.preset` -> `dimCode 3` -> `API.generateChunk(seed,cx,cz,3)` -> `getMedohGen` in `shared_medoh.js`: procedural Lake Totori (radius ~150 around 0,0), terraced canyon mesas with strata, open to the east,
  spruce woods, a flat landing clearing at (176,34); then the baked blueprint is stamped in, the beam is drawn along +x at y 196 / z 0, and the champion's chest gets its block entity (`table: 'medoh_champion'`, fixed loot).
* **Blueprint**: `shared_medoh_bp.js` is GENERATED (`const MEDOH_BP = {deckY, mx, raw, chests, bounds, data}`; `data` = base64 of raw-DEFLATE of: `'MDH1'`, palette of (id,meta), chunk directory (cx, cz, offset), per-column runs (y0, len, palette index)).
  `shared_medoh.js` carries a tiny inflate + base64 decoder (works in workers and Node). World coordinates = scene coordinates; Medoh's local origin (centre of the wing deck) sits at world (23, 207, 0), head toward +x, wings along z.
* **Sculpting pipeline** (`tools/medoh/`, Node, nothing ships): `vox.js` (voxel grid, shape fills, software preview renderer textured with the game's tiles, PNG writer), `medoh.js` (the beast: body, rib cage, wing beam, hubs,
  feathers, propellers, plaza + main control unit, ribbed hood + gate, neck/eye/beak, tail lobes, perched legs, and the interior: upper hall, grand staircase, main hall with glass floor, terminals, chest),
  `scene.js` (spire, spiral boardwalk, huts on gangways, Revali's Landing, rock stacks + bridges, shrine, trees; blits Medoh; `encodeBlueprint`), `sculpt.js` (`preview|scene <outDir> <views>` renders PNGs, `export` writes the blueprint),
  `walktest.js` (flood-fill proof that the boardwalk, every hut and the shore bridge are walkable). After changing the sculpt: `node tools/medoh/sculpt.js export && node tools/medoh/walktest.js && node tools/build.js --release`.
* **Blocks** (ids 241-252, appended): `ancient_stone / _mid / _dark`, `ancient_gold`, `ancient_carved` (+`_dark`), `ancient_moss` (+`_carved`), `ancient_pillar`, `ancient_glow_blue / _orange` (`glow: true`), `ancient_beam` (thin rod, meta = axis).
  Textures in `tex_medoh.js` (energy tiles are animated). `T_GLOW`: the mesher draws glow blocks with full block light, no AO, no face shading. Only 2 block ids are left (limit 255).
* **Presentation** (all keyed on `world.preset === 'medoh'`): view distance at least 16 chunks, fog pushed out to the view edge, clouds lifted to y 247 (`renderer.cloudY`), sky light restarted below y 149 in `lightChunk`
  (the beast does not shade the village), the loading screen waits for every chunk in view (and `World.update` also runs every frame while loading - this speeds up all worlds), location banner (`Game.drawBanner`) and the
  `medoh.cry` sound on arrival.
