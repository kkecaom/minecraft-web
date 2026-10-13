// ===== g_game.js : game state, input, main loop, interaction, save/load =====
const DEFAULT_OPTIONS = { fov: 70, renderDistance: 8, guiScale: 0, sensitivity: 0.5, master: 1, music: 0.5, sfx: 1, gamma: 0, clouds: 2, bobbing: true, maxFps: 260, particles: 2, invertY: false, fancy: true, autoJump: false, showFps: false, difficulty: 2 };
const DEFAULT_BINDS = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft', inventory: 'KeyE', drop: 'KeyQ', chat: 'KeyT', command: 'Slash', perspective: 'F5', debug: 'F3', screenshot: 'F2', hud: 'F1' };

// ---------------------------------------------------------------- IndexedDB storage
class Store {
  constructor() { this.db = null; this.memW = new Map(); this.memC = new Map(); }
  open() {
    return new Promise((res) => {
      if (!window.indexedDB) { res(false); return; }
      const rq = indexedDB.open('minecraft-web', 1);
      rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore('worlds', { keyPath: 'id' }); db.createObjectStore('chunks'); };
      rq.onsuccess = () => { this.db = rq.result; res(true); };
      rq.onerror = () => res(false);
    });
  }
  _tx(store, mode) { return this.db.transaction(store, mode).objectStore(store); }
  _p(rq) { return new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }
  async listWorlds() { if (!this.db) return Array.from(this.memW.values()).sort((a, b) => b.lastPlayed - a.lastPlayed); return (await this._p(this._tx('worlds', 'readonly').getAll())).sort((a, b) => b.lastPlayed - a.lastPlayed); }
  async putWorld(rec) { if (!this.db) { this.memW.set(rec.id, JSON.parse(JSON.stringify(rec))); return; } await this._p(this._tx('worlds', 'readwrite').put(rec)); }
  async deleteWorld(id) {
    if (!this.db) { this.memW.delete(id); for (const k of Array.from(this.memC.keys())) if (k.startsWith(id + ':') || k.startsWith(id + '~')) this.memC.delete(k); return; }
    await this._p(this._tx('worlds', 'readwrite').delete(id));
    for (const sid of [id, id + '~nether', id + '~end']) {   // every dimension keeps its chunks under its own prefix
      const os = this._tx('chunks', 'readwrite'); const rq = os.openCursor(IDBKeyRange.bound(sid + ':', sid + ':￿'));
      await new Promise(res => { rq.onsuccess = () => { const c = rq.result; if (c) { c.delete(); c.continue(); } else res(); }; rq.onerror = () => res(); });
    }
  }
  async chunkKeys(wid) {
    const set = new Set(); if (!this.db) { for (const k of this.memC.keys()) if (k.startsWith(wid + ':')) set.add(Number(k.slice(wid.length + 1))); return set; }
    const os = this._tx('chunks', 'readonly'); const rq = os.openKeyCursor(IDBKeyRange.bound(wid + ':', wid + ':￿'));
    await new Promise(res => { rq.onsuccess = () => { const c = rq.result; if (c) { set.add(Number(String(c.key).slice(wid.length + 1))); c.continue(); } else res(); }; rq.onerror = () => res(); });
    return set;
  }
  bind(wid) {
    const self = this;
    return { getChunk: k => self.db ? self._p(self._tx('chunks', 'readonly').get(wid + ':' + k)) : Promise.resolve(self.memC.get(wid + ':' + k) || null), putChunk: (k, rec) => { if (self.db) { try { self._tx('chunks', 'readwrite').put(rec, wid + ':' + k); } catch (e) { console.warn('save failed', e); } } else self.memC.set(wid + ':' + k, rec); } };
  }
}

const ORE_XP = { coal_ore: [0, 2], diamond_ore: [3, 7], emerald_ore: [3, 7], lapis_ore: [2, 5], redstone_ore: [1, 5], nether_quartz_ore: [2, 5], nether_gold_ore: [0, 1] };
// furnace-like blocks swap between their unlit and lit block while burning
const FURNACE_LIT = { [BID.furnace]: BID.furnace_lit, [BID.smoker]: BID.smoker_lit, [BID.blast_furnace]: BID.blast_furnace_lit };
const FURNACE_UNLIT = { [BID.furnace_lit]: BID.furnace, [BID.smoker_lit]: BID.smoker, [BID.blast_furnace_lit]: BID.blast_furnace };
// structure chest loot (vanilla loot tables, trimmed to the items that exist here): [item, min, max, weight]; missing items are skipped
const LOOT_TABLES = {
  // the chest in Vah Medoh's main hall: Revali's legacy (fixed contents)
  medoh_champion: { rolls: [0, 0], items: [['feather', 1, 1, 1]], fixed: [['bow', 1], ['arrow', 64], ['arrow', 64], ['feather', 16], ['diamond', 5], ['emerald', 20], ['golden_apple', 3], ['ender_pearl', 8]] },
  village_house: { rolls: [3, 8], items: [['bread', 1, 4, 15], ['apple', 1, 5, 10], ['potato', 1, 7, 10], ['carrot', 1, 7, 10], ['wheat', 1, 7, 10], ['wheat_seeds', 1, 5, 10], ['gold_nugget', 1, 3, 2], ['dandelion', 1, 1, 2], ['poppy', 1, 1, 2], ['feather', 1, 1, 5], ['book', 1, 1, 1], ['oak_sapling', 1, 2, 5], ['paper', 1, 3, 3]] },
  village_smith: { rolls: [3, 8], items: [['diamond', 1, 3, 3], ['iron_ingot', 1, 5, 10], ['gold_ingot', 1, 3, 5], ['bread', 1, 3, 15], ['apple', 1, 3, 15], ['iron_pickaxe', 1, 1, 5], ['iron_sword', 1, 1, 5], ['iron_chestplate', 1, 1, 5], ['iron_helmet', 1, 1, 5], ['iron_leggings', 1, 1, 5], ['iron_boots', 1, 1, 5], ['obsidian', 3, 7, 5], ['oak_sapling', 3, 7, 5]] },
  stronghold_corridor: { rolls: [2, 3], items: [['ender_pearl', 1, 1, 10], ['diamond', 1, 3, 3], ['iron_ingot', 1, 5, 10], ['gold_ingot', 1, 3, 5], ['redstone', 4, 9, 5], ['bread', 1, 3, 15], ['apple', 1, 3, 15], ['iron_pickaxe', 1, 1, 5], ['iron_sword', 1, 1, 5], ['iron_chestplate', 1, 1, 5], ['iron_helmet', 1, 1, 5], ['iron_leggings', 1, 1, 5], ['iron_boots', 1, 1, 5], ['golden_apple', 1, 1, 1]] },
  stronghold_library: { rolls: [2, 10], items: [['book', 1, 3, 20], ['paper', 2, 7, 20], ['bookshelf', 1, 1, 2], ['ender_pearl', 1, 1, 2]] },
  fortress: { rolls: [2, 4], items: [['diamond', 1, 3, 5], ['iron_ingot', 1, 5, 5], ['gold_ingot', 1, 3, 15], ['golden_sword', 1, 1, 5], ['golden_chestplate', 1, 1, 5], ['flint_and_steel', 1, 1, 5], ['nether_wart', 3, 7, 5], ['obsidian', 2, 4, 2], ['golden_helmet', 1, 1, 3], ['gold_nugget', 2, 8, 6]] },
};
// ComposterBlock.COMPOSTABLES: chance that one item raises the compost level
const COMPOST_CHANCE = (() => {
  const T = {};
  const set = (c, names) => { for (const n of names) T[n] = c; };
  set(0.3, ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'short_grass', 'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling']);
  set(0.5, ['cactus', 'sugar_cane', 'vine', 'weeping_vines', 'twisting_vines', 'melon_slice']);
  set(0.65, ['apple', 'carrot', 'potato', 'fern', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_pad', 'melon', 'brown_mushroom', 'red_mushroom', 'nether_wart', 'pumpkin', 'carved_pumpkin', 'wheat', 'crimson_fungus', 'warped_fungus', 'crimson_roots', 'warped_roots', 'shroomlight']);
  set(0.85, ['baked_potato', 'bread', 'cookie', 'hay_block', 'nether_wart_block', 'warped_wart_block']);
  set(1, ['cake', 'pumpkin_pie']);
  return T;
})();

const SPLASHES = ['Also try Terraria... no wait!', 'Made with WebGL!', 'Single file!', 'Now with 100% more voxels!', 'Not a Creeper!', 'Sssss...', 'Hello, world!', 'Punch a tree!', 'Watch out for lava!', 'Mine diamonds!', 'Don\'t dig straight down!',
  'Craft a pickaxe!', 'Beware the night!', 'Infinite worlds!', 'Have you tried sleeping?', 'Aw man!', 'Pigs can\'t fly!', 'Try the F3 screen!', '20 ticks per second!', 'Cubes everywhere!', 'Zombies burn in daylight!', 'Sheep are fluffy!',
  'Torches keep monsters away!', 'Built with JavaScript!', 'Cows say moo!', 'Explore the caves!', 'Bring a bucket!', 'Sky\'s the limit!', 'It\'s a block game!', 'Watch your step!', 'Redstone not included!', 'Mind the gap!', 'Minecraft!', 'As seen on TV!', 'Awesome!', '100% pure!', 'May contain nuts!', 'More polygons!', 'Moderately attractive!', 'Limited edition!', 'Flashing letters!', 'It\'s here!', 'Best in class!', 'It\'s finished!', 'Kind of dragon free!', 'Excitement!', 'More than 500 sold!', 'One of a kind!', 'Heaps of hits on YouTube!', 'Spiders everywhere!', 'Check it out!', 'Holy cow, man!', 'It\'s a game!', 'Reticulating splines!', 'Yaaay!', 'Singleplayer!', 'Keyboard compatible!', 'Ingots!', 'Exploding creepers!', 'That\'s no moon!', 'l33t!', 'Create!', 'Survive!', 'Dungeon!', 'Exclusive!', 'The bee\'s knees!', 'Classy!', 'Wow!', 'Oh man!', 'Awesome community!', 'Pixels!', 'Now with difficulty!', 'Enhanced!', '90% bug free!', 'Pretty!', '12 herbs and spices!', 'Fat free!', 'Absolutely no memes!', 'Free dental!', 'Ask your doctor!', 'Minors welcome!', 'Cloud computing!', 'Hard to label!', 'Technically good!', 'Bringing home the bacon!', 'Indie!', 'GOTY!', 'Euclidian!', 'Now in 3D!', 'Inspirational!', 'Complex cellular automata!', 'Yes, sir!', 'Played by cowboys!', 'Thousands of colors!', 'Try it!', 'Try the mushroom stew!', 'Sensational!', 'Hot tamale, hot hot tamale!', 'Guaranteed!', 'Macroscopic!', 'Bring it on!', 'Call your mother!', 'Monster infighting!', 'Loved by millions!', 'Ultimate edition!', 'Freaky!', 'Water proof!', 'Uninflammable!', 'Whoa, dude!', 'All inclusive!', 'Tell your friends!', 'Music by C418!', 'Livestreamed!', 'Haunted!', 'Polynomial!', 'Terrestrial!', 'All is full of love!', 'Full of stars!', 'Scientific!', 'Not as cool as Spock!', 'Collaborate and listen!', 'Never dig down!', 'Take frequent breaks!', 'Not linear!', 'Han shot first!', 'Nice to meet you!', 'Buckets of lava!', 'Ride the pig!', 'Larger than Earth!', 'Punching wood!', 'Falling off cliffs!', '0% sugar!', '150% hyperbole!', 'Kiss the sky!', '20 GOTO 10!', 'Do not distribute!', 'Cooler than Spock!', 'Try to spot the difference!', 'Don\'t tell your mom!'];

class Game {
  constructor(glCanvas, uiCanvas) {
    this.glCanvas = glCanvas; this.uiCanvas = uiCanvas;
    this.options = Object.assign({}, DEFAULT_OPTIONS); this.binds = Object.assign({}, DEFAULT_BINDS);
    try { const o = JSON.parse(localStorage.getItem('mcweb.options') || '{}'); Object.assign(this.options, o.options || {}); Object.assign(this.binds, o.binds || {}); } catch (e) { }
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new Renderer(glCanvas);
    try { const gl = this.renderer.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); this.renderer.gpu = e ? (() => { let s = String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)).replace(/^ANGLE \(/, '').replace(/\)$/, ''); const pp = s.split(', '); s = pp.length > 1 ? pp[1] : pp[0]; return s.replace(/\(0x[0-9a-f]+\)/i, '').replace(/(Direct3D|OpenGL|Vulkan|Metal).*/i, '').trim() || 'GPU'; })() : 'GPU'; } catch (e) { }
    this.ui = new UI(uiCanvas, this);
    this.ui.userScale = this.options.guiScale;
    this.resize();
    this.store = new Store();
    this.world = null; this.player = null; this.entities = []; this.particles = new ParticleSystem(this);
    this.keys = {}; this.mouse = { x: 0, y: 0, buttons: 0, dx: 0, dy: 0, locked: false, vx: 0, vy: 0 };
    this.input = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };
    this.screen = null; this.state = 'title'; this.tick = 0; this.time = 1000; this.day = 0; this.difficulty = this.options.difficulty;
    this.weather = { rain: 0, target: 0, timer: 6000 + Math.random() * 12000, thunder: false, thunderLevel: 0, flash: 0 }; this.bolts = []; this.rainLoop = 0; this.lavaLoop = 0; this.lavaWant = 0;
    this.chat = []; this.fps = 60; this.acc = 0; this.last = now(); this.frames = 0; this.fpsT = now();
    this.cameraMode = 0; this.hideHud = false; this.showDebug = false; this.itemName = ''; this.itemNameT = 0; this.actionBar = ''; this.actionBarT = 0;
    this.breaking = null; this.target = null; this.entityTarget = null; this.useCd = 0; this.eyeInWater = false; this.eyeInLava = false;
    this.splash = (() => { const d = new Date(), m = d.getMonth() + 1, dd = d.getDate(); return m === 12 && dd >= 24 && dd <= 26 ? 'Merry X-mas!' : m === 1 && dd === 1 ? 'Happy new year!' : m === 10 && dd === 31 ? 'OOoooOOOoooo! Spooky!' : SPLASHES[(Math.random() * SPLASHES.length) | 0]; })(); this.isDay = true; this.sunAngle = 0; this.lastRaf = 0;
    this.spawnPoint = null; this.worldInfo = null; this.autosaveT = 0; this.icons = null; this.musicT = 600 + Math.random() * 1200;
    this.uiHit = []; this.paused = false; this.fadeOverlay = 0; this.sleepFade = 0; this.mouseMoved = 0; this.lastSpaceTap = -100; this.sprintTap = -100;
    this.bgWorld = null; this.panoT = 0; this.panoYaw = 0;
    this.stats = {}; this.advDone = new Set(); this.toasts = []; this.advSilent = false;
    this.buildIcons();
    this.bindEvents();
  }
  saveOptions() { try { localStorage.setItem('mcweb.options', JSON.stringify({ options: this.options, binds: this.binds })); } catch (e) { } }
  buildIcons() {
    // HUD icons from the entity module (canvases), if present
    const src = (typeof TexEntities !== 'undefined' && TexEntities.gui) || null;
    if (!src) return;
    this.icons = {};
    for (const k in src) { const s = src[k]; const c = document.createElement('canvas'); c.width = s.w; c.height = s.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(s.data), s.w, s.h), 0, 0); this.icons[k] = c; }
  }
  resize() {
    let w = Math.max(320, Math.floor(innerWidth * this.dpr)), h = Math.max(240, Math.floor(innerHeight * this.dpr));
    if (this.devSize) { w = this.devSize[0]; h = this.devSize[1]; }
    this.uiCanvas.width = w; this.uiCanvas.height = h;
    this.renderer.resize(w, h);
    if (this.ui) { this.ui.cache.clear(); this.renderer.clearIcons(); }
  }
  //@dev-begin developer helper (stripped by `node tools/build.js --release`): render one frame and POST a composite PNG to the local research helper (127.0.0.1:8124)
  async devShot(name) {
    this.renderFrame(0);
    const c = document.createElement('canvas'); c.width = this.glCanvas.width; c.height = this.glCanvas.height; const g = c.getContext('2d');
    g.drawImage(this.glCanvas, 0, 0); g.drawImage(this.uiCanvas, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await fetch('http://127.0.0.1:8124/img?f=' + encodeURIComponent(name), { method: 'POST', body: blob });
    return c.width + 'x' + c.height;
  } //@dev-end
  // ------------------------------------------------------------ audio wrappers
  sound(name, x, y, z, vol, pitch, fallback) {
    if (typeof MCAudio === 'undefined' || !MCAudio.ready) return;
    let n = name;
    if (MCAudio.names && MCAudio.names.indexOf(n) < 0) { if (fallback && MCAudio.names.indexOf(fallback) >= 0) n = fallback; else return; }
    try { if (x === undefined) MCAudio.play(n, { vol: vol === undefined ? 1 : vol, pitch: pitch || 1 }); else MCAudio.playAt(n, x, y, z, { vol: vol === undefined ? 1 : vol, pitch: pitch || 1 }); } catch (e) { }
  }
  uiClick() { this.sound('random.click', undefined, 0, 0, 0.6, 1); }
  // ------------------------------------------------------------ events
  bindEvents() {
    const cv = this.uiCanvas;
    addEventListener('resize', () => this.resize());
    addEventListener('keydown', e => this.onKey(e, true));
    addEventListener('keyup', e => this.onKey(e, false));
    cv.addEventListener('mousedown', e => { this.onMouseDown(e); });
    addEventListener('mouseup', e => this.onMouseUp(e));
    addEventListener('mousemove', e => this.onMouseMove(e));
    cv.addEventListener('wheel', e => { e.preventDefault(); this.onWheel(e); }, { passive: false });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === cv;
      if (this.mouse.locked && !locked) this.onLockLost();
      this.mouse.locked = locked;
      if (locked) {
        this.everLocked = true; this.lockErrs = 0; this.lockFailed = false;
        if (this.resuming && this.screen instanceof PauseScreen) this.closeScreen();
        this.resuming = false;
      }
    });
    document.addEventListener('pointerlockerror', () => this.onLockError());
    window.addEventListener('blur', () => { for (const k in this.keys) this.keys[k] = false; this.mouse.buttons = 0; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play' && !this.screen && !this.noAutoPause) this.openScreen(new PauseScreen(this)); });
    // save on the way out, and ask first while playing so a stray Ctrl+W (W is "forward") does not close the world by accident
    window.addEventListener('beforeunload', e => { if (this.state === 'play') { try { this.saveGame(true); } catch (er) { } if (!this.noAutoPause) { e.preventDefault(); e.returnValue = ''; } } });
  }
  lockPointer() {
    const cv = this.uiCanvas;
    if (this.noLock) return;
    if (!cv.requestPointerLock) { this.noLock = true; return; }
    const quiet = () => { };   // failures also arrive as pointerlockerror events (onLockError)
    try {
      const p = cv.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const q = cv.requestPointerLock(); if (q && q.catch) q.catch(quiet); } catch (e) { } });
    } catch (e) { try { const q = cv.requestPointerLock(); if (q && q.catch) q.catch(quiet); } catch (e2) { } }
  }
  onLockError() {
    this.lockErrs = (this.lockErrs || 0) + 1; this.resuming = false;
    // never locked yet (sandboxed frame / embedded preview): give up and play unlocked (arrow keys look, mouse buttons act)
    if (!this.everLocked) { if (this.lockErrs >= 3) this.noLock = true; return; }
    if (this.state !== 'play') return;
    // a browser that normally locks refused: the request came from a key press (Esc is no user gesture) or right after Esc, so wait for a click
    this.lockFailed = true;
    if (!this.screen && !this.noAutoPause) this.openScreen(new PauseScreen(this));
  }
  // leave the game menu: only closes once the mouse is captured again (immediately when there is no pointer lock to wait for)
  resumeGame() {
    if (this.noLock || this.mouse.locked) { this.closeScreen(); return; }
    this.resuming = true; this.lockPointer();
  }
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }
  onLockLost() {
    if (this.state !== 'play') return;
    const s = this.screen;
    if (s && !s.passive && s.needsCursor === false && !(s instanceof PauseScreen)) { this.openScreen(new PauseScreen(this)); return; }
    if (!s && !this.noAutoPause) this.openScreen(new PauseScreen(this));
  }
  guiPos(e) { const r = this.uiCanvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * this.uiCanvas.width / this.ui.scale, (e.clientY - r.top) / r.height * this.uiCanvas.height / this.ui.scale]; }
  onMouseMove(e) {
    if (this.mouse.locked) {
      if (this.screen && !this.screen.passive) {
        // virtual cursor inside inventories
        this.mouse.x = clamp(this.mouse.x + e.movementX * this.dpr / this.ui.scale, 0, this.ui.w - 1); this.mouse.y = clamp(this.mouse.y + e.movementY * this.dpr / this.ui.scale, 0, this.ui.h - 1);
      } else if (this.state === 'play' && !this.paused && this.player && !this.player.dead) {
        const s = this.options.sensitivity * 0.6 + 0.2, f = s * s * s * 8 * 0.15 * 0.0174533;   // MC: (sens*0.6+0.2)^3*8 degrees per pixel*0.15
        this.player.yaw += e.movementX * f * (1); this.player.pitch = clamp(this.player.pitch + e.movementY * f * (this.options.invertY ? -1 : 1), -Math.PI / 2, Math.PI / 2);
      }
    } else { const p = this.guiPos(e); this.mouse.x = p[0]; this.mouse.y = p[1]; }
  }
  onMouseDown(e) {
    e.preventDefault();
    if (typeof MCAudio !== 'undefined' && !MCAudio.ready) { try { MCAudio.init(); } catch (er) { } }
    this.mouse.buttons |= 1 << e.button;
    if (!this.mouse.locked) { const p = this.guiPos(e); this.mouse.x = p[0]; this.mouse.y = p[1]; }
    if (this.screen) { this.screen.mouseDown(this.mouse.x, this.mouse.y, e.button); return; }
    if (this.state === 'play' && !this.mouse.locked && !this.noLock) { this.lockPointer(); return; }
    if (this.state === 'play' && this.player && !this.player.dead) {
      if (e.button === 0) this.onLeftDown();
      else if (e.button === 2) { this.useCd = 0; this.onRightDown(true); }
      else if (e.button === 1) this.pickBlock();
    }
  }
  onMouseUp(e) {
    this.mouse.buttons &= ~(1 << e.button);
    if (this.screen) this.screen.mouseUp(this.mouse.x, this.mouse.y, e.button);
    if (e.button === 0) { this.breaking = null; }
    if (e.button === 2 && this.player) this.releaseUse();
  }
  onWheel(e) {
    if (this.screen) { if (this.screen.wheel) this.screen.wheel(e.deltaY); return; }
    if (this.state !== 'play' || !this.player) return;
    const d = Math.sign(e.deltaY); if (!d) return;
    this.player.sel = (this.player.sel + d + 9) % 9; this.onHotbarChange();
  }
  onHotbarChange() { const s = this.player.held(); this.itemName = s ? this.stackName(s) : ''; this.itemNameT = 40; this.breaking = null; this.player.eating = 0; this.player.usingBow = 0; }
  stackName(s) { const it = ITEMS[s.id]; return it ? it.disp : ''; }
  onKey(e, down) {
    const code = e.code;
    if (down && (code === 'F5' || code === 'F3' || code === 'F1' || code === 'F2' || code === 'Tab' || code === 'F6' || code === 'F7' || code === 'F8' || code === 'F9' || code === 'F10' || code === 'F12' || (code === 'Slash' && this.state === 'play' && !this.screen) || code === 'Space' && this.state === 'play')) e.preventDefault();
    if (e.ctrlKey && (code === 'KeyW' || code === 'KeyT' || code === 'KeyN')) { /* can't be prevented in most browsers */ }
    if (down && this.keys[code] && this.screen === null) { /* repeat */ }
    const wasDown = this.keys[code];
    this.keys[code] = down;
    if (typeof MCAudio !== 'undefined' && down && !MCAudio.ready) { try { MCAudio.init(); } catch (er) { } }
    const scr = this.screen;   // keyDown may close it (this.screen becomes null)
    if (scr) { if (down) scr.keyDown(e); else if (scr.keyUp) scr.keyUp(e); if (!scr.passive) return; }
    if (this.state !== 'play' || !this.player) return;
    const b = this.binds;
    if (down && !wasDown) {
      if (code === b.debug) this.showDebug = !this.showDebug;
      else if (code === b.hud) this.hideHud = !this.hideHud;
      else if (code === b.perspective) this.cameraMode = (this.cameraMode + 1) % 3;
      else if (code === b.screenshot) this.takeScreenshot();
      else if (code === b.inventory && !this.player.dead) { this.openScreen(this.player.gameMode === 1 ? new CreativeScreen(this) : new InventoryScreen(this)); }
      else if (code === b.chat && !this.player.dead) this.openScreen(new ChatScreen(this, ''));
      else if (code === b.command && !this.player.dead) this.openScreen(new ChatScreen(this, '/'));
      else if (code === b.drop && !this.player.dead) this.dropHeld(e.ctrlKey);
      else if (code.startsWith('Digit') && code !== 'Digit0') { this.player.sel = parseInt(code.slice(5)) - 1; this.onHotbarChange(); }
      else if (code === 'Escape') this.openScreen(new PauseScreen(this));   // browsers that capture Esc to release the mouse drop the lock instead (onLockLost opens the same menu)
      // double-tap forward to sprint
      if (code === b.forward) { const t = now(); if (t - this.sprintTap < 300) this.player.sprintToggle = true; this.sprintTap = t; }
      // double-tap jump toggles flight in creative
      if (code === b.jump && this.player.gameMode === 1) {
        const t = now(); if (t - this.lastSpaceTap < 300) { this.player.flying = !this.player.flying; this.player.vy = 0; } this.lastSpaceTap = t;
      }
    }
    if (!down && code === b.forward) this.player.sprintToggle = false;
  }
  updateInput() {
    const k = this.keys, b = this.binds, i = this.input;
    i.forward = !!k[b.forward]; i.back = !!k[b.back]; i.left = !!k[b.left]; i.right = !!k[b.right]; i.jump = !!k[b.jump]; i.sneak = !!k[b.sneak]; i.sprint = !!k[b.sprint];
  }
  takeScreenshot() {
    try {
      const c = document.createElement('canvas'); c.width = this.glCanvas.width; c.height = this.glCanvas.height; const g = c.getContext('2d');
      this.renderFrame(0.0); g.drawImage(this.glCanvas, 0, 0); g.drawImage(this.uiCanvas, 0, 0);
      c.toBlob(bl => { const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = 'screenshot_' + new Date().toISOString().replace(/[:.]/g, '-') + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
      this.addChat('Saved screenshot as ' + 'screenshot.png');
    } catch (e) { }
  }
  addChat(s) { this.chat.push({ s, t: this.tick }); if (this.chat.length > 100) this.chat.shift(); }
  openScreen(s) {
    if (this.screen && this.screen.onClose) this.screen.onClose(true);
    if (s instanceof InventoryScreen || s instanceof CreativeScreen) this.stats.invOpened = 1;
    this.screen = s; if (s.init) s.init();
    if (this.state === 'play') {
      if (!s.passive) { this.mouse.x = this.ui.w / 2; this.mouse.y = this.ui.h / 2; }
      if (s.needsCursor && this.mouse.locked) this.unlockPointer();
      this.breaking = null;
    }
  }
  closeScreen() {
    const s = this.screen; this.screen = null;
    if (s && s.onClose) s.onClose(false);
    if (this.state === 'play' && !this.mouse.locked) this.lockPointer();
  }
  // ------------------------------------------------------------ world lifecycle
  async initStore() { await this.store.open(); }
  async createWorld(name, seedStr, mode, difficulty, preset) {
    const id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const seed = SH.seedToInt(seedStr === '' || seedStr === undefined ? String((Math.random() * 4294967296) | 0) : seedStr);
    const rec = { id, name: name || 'New World', seed, seedStr: seedStr || String(seed), mode, difficulty, created: Date.now(), lastPlayed: Date.now(), time: 1000, player: null, spawn: null, version: 1 };
    if (preset === 'medoh') { rec.preset = 'medoh'; rec.time = 22900; }   // the Divine Beast world opens just before sunrise, while the energy lines still glow
    await this.store.putWorld(rec);
    return rec;
  }
  // the world this build was made for: put "Divine Beast Vah Medoh" into the world list once (deleting it is respected)
  async ensureFeaturedWorlds() {
    try {
      const list = await this.store.listWorlds();
      let done = false; try { done = localStorage.getItem('mcw_medoh_world') === '1'; } catch (e) { }
      if (!this.store.db) done = false;
      if (list.some(w => w.preset === 'medoh')) done = true;
      if (!done) await this.createWorld('Divine Beast Vah Medoh', 'Vah Medoh', 'creative', 0, 'medoh');
      try { localStorage.setItem('mcw_medoh_world', '1'); } catch (e) { }
    } catch (e) { console.warn(e); }
  }
  async startWorld(rec) {
    if (this.state === 'loading') return;   // a second click on Play / Create must not start another world
    this.state = 'loading';
    this.worldInfo = rec;
    this.stopBackgroundWorld();
    this.dim = rec.dim === 'nether' || rec.dim === 'end' ? rec.dim : 'overworld';
    this.arrival = null; this.gatewayArrival = null; this.respawnSeq = null; this.gatewayBeams = null;
    const w = await this.makeWorld(rec, this.dim);
    this.world = w; this.entities = []; this.particles.list.length = 0; this.tick = 0; this.chat = [];
    this.difficulty = rec.difficulty === undefined ? 2 : rec.difficulty;
    this.time = rec.time || 1000; this.day = Math.floor(this.time / 24000);
    let sp = rec.spawn;
    if (!sp) sp = rec.preset === 'medoh' ? SH.medohSpawn() : SH.findSpawn(rec.seed);
    this.spawnPoint = { x: sp.x, y: sp.y, z: sp.z };
    const pl = new Player(this, sp.x, sp.y, sp.z); pl.spawn = { x: sp.x, y: sp.y, z: sp.z };
    this.player = pl;
    pl.gameMode = rec.mode === 'creative' ? 1 : 0;
    if (rec.player) this.loadPlayer(rec.player);
    else if (pl.gameMode === 0) { /* fresh survival start: empty inventory */ }
    if (rec.weather) { this.weather.rain = rec.weather.rain || 0; this.weather.target = rec.weather.target || 0; this.weather.timer = rec.weather.timer || 6000; this.weather.thunder = !!rec.weather.thunder; this.weather.thunderLevel = this.weather.thunder ? this.weather.rain : 0; }
    else { const W = this.weather; W.rain = 0; W.target = 0; W.timer = 6000; W.thunder = false; W.thunderLevel = 0; W.flash = 0; }
    this.stats = rec.stats || {}; this.advDone = new Set(rec.adv || []); this.advSilent = !rec.adv; this.toasts = [];   // worlds saved before advancements existed complete what they already have silently
    pl.savePrev();
    this.loadStart = now(); this.loadingSpawnY = false;
    this.openScreen(new LoadingScreen(this));
    // the player must not fall while the world loads: hold until chunks exist
    this.paused = true;
  }
  worldReady() {
    const w = this.world, p = this.player; if (!w) return 0;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4, R = w.preset === 'medoh' ? Math.min(w.viewDist - 2, 14) : 3; let need = 0, have = 0;   // the Divine Beast must be whole when the curtain rises
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R + 1) continue; need++;
      const c = w.getChunk(pcx + dx, pcz + dz);
      if (c && c.state >= 2 && c.dirty === 0 && c.pending === 0) have++;
    }
    return have / need;
  }
  finishLoading() {
    const p = this.player, w = this.world;
    if (this.arrival) this.completeArrival();   // arriving through a portal: the destination decides where we stand
    // place the player on the ground if we spawned in the air/inside blocks
    else if (!this.worldInfo.player) {
      const spot = (() => {
        const bx0 = Math.floor(p.x), bz0 = Math.floor(p.z);
        for (let r = 0; r <= 10; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = bx0 + dx, z = bz0 + dz; if (!w.isLoaded(x, z)) continue;
          for (let yy = 250; yy > 1; yy--) {
            const b = w.getBlock(x, yy - 1, z);
            if (!b || !T_SOLID[b] || T_FLUID[b] || BLOCKS[b].leaves || BLOCKS[b].log) continue;   // look through canopies and trunks for the real ground
            if (!T_SOLID[w.getBlock(x, yy, z)] && !T_SOLID[w.getBlock(x, yy + 1, z)] && !T_FLUID[w.getBlock(x, yy, z)] && !T_FLUID[w.getBlock(x, yy + 1, z)]) return [x + 0.5, yy, z + 0.5];
            break;
          }
        }
        return null;
      })();
      if (spot) { p.x = p.px = spot[0]; p.y = p.py = spot[1]; p.z = p.pz = spot[2]; this.spawnPoint.x = p.spawn.x = spot[0]; this.spawnPoint.z = p.spawn.z = spot[2]; }
      else { let y = Math.floor(p.y); for (let yy = 250; yy > 0; yy--) { const b = w.getBlock(Math.floor(p.x), yy, Math.floor(p.z)); if (b && T_SOLID[b] && !BLOCKS[b].leaves) { y = yy + 1; break; } } p.y = y; p.py = y; }
      this.spawnPoint.y = p.spawn.y = p.y;
    }
    this.paused = false; this.state = 'play';
    this.screen = null; this.lockPointer();
    p.equipProg = 1; p.heldId = p.held() ? p.held().id : 0;
    // tamed wolves come back with their owner (the ones left in this dimension)
    if (this.worldInfo.pets) for (const s of this.worldInfo.pets) { if ((s.dim || 'overworld') !== this.dim || !MOB_DEFS[s.type]) continue; const m = this.spawnMob(s.type, s.x, s.y, s.z); m.tamed = true; m.owner = p; m.persist = true; m.sitting = !!s.sitting; m.hp = s.hp; m.maxHp = 20; if (s.collar) m.collarColor = s.collar; }
    // welcome
    if (!this.worldInfo.player && this.worldInfo.preset === 'medoh') {
      // first arrival: face the beast
      const tx = 23 - p.x, ty = 196 - (p.y + 1.62), tz = 0 - p.z, tl = Math.hypot(tx, ty, tz) || 1;
      p.yaw = Math.atan2(-tx, tz); p.pitch = -Math.asin(ty / tl) * 0.78; p.savePrev();
      this.addChat('§bDivine Beast Vah Medoh §fhas come to rest above Rito Village.');
      this.addChat('§7Cross the bridges and climb the boardwalk - or double-tap Space to fly up to the deck.');
    } else if (!this.worldInfo.player) { this.addChat('§eWelcome to Minecraft Web Edition!'); this.addChat('§7WASD move, Space jump, E inventory, T chat, Esc menu'); }
    if (this.worldInfo.preset === 'medoh' && this.dim === 'overworld') { this.banner = { title: 'Divine Beast Vah Medoh', sub: 'Rito Village  -  Lake Totori', t0: now() }; setTimeout(() => { if (this.state === 'play' && this.banner) this.sound('medoh.cry', undefined, 0, 0, 0.9, 1); }, 1100); }   // the beast calls out over the lake
    this.worldInfo.player = this.worldInfo.player || this.savePlayer();
    this.onDimensionReady();
    // creative inventory starter
    this.itemName = ''; this.autosaveT = 0;
  }
  // a location title that fades in and out (shown on arriving in the Divine Beast world)
  drawBanner(ui) {
    const b = this.banner, t = (now() - b.t0) / 1000, g = ui.g; if (t > 9 || this.hideHud) { if (t > 9) this.banner = null; return; }
    if (this.screen) return;
    const a = Math.max(0, Math.min(1, (t - 0.8) / 1.4, (9 - t) / 1.6)); if (a <= 0) return;
    const cx = ui.w / 2, y = Math.round(ui.h * 0.2), wl = Math.min(150, ui.w * 0.36) * Math.min(1, (t - 0.8) / 1.8);
    g.save(); g.globalAlpha = a;
    ui.textBig(b.title, cx, y, 2, '#ffffff', true);
    g.fillStyle = 'rgba(120,235,255,0.95)'; g.fillRect(Math.round(cx - wl), y + 21, Math.round(wl * 2), 1);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(Math.round(cx - wl * 0.6), y + 23, Math.round(wl * 1.2), 1);
    ui.textC(b.sub, cx, y + 29, '#8fe9ff', true);
    g.restore();
  }
  loadPlayer(d) {
    const p = this.player;
    p.x = p.px = d.x; p.y = p.py = d.y; p.z = p.pz = d.z; p.yaw = d.yaw || 0; p.pitch = d.pitch || 0;
    p.health = d.health === undefined ? 20 : d.health; p.food = d.food === undefined ? 20 : d.food; p.sat = d.sat || 0; p.xp = d.xp || 0; p.level = d.level || 0; p.xpProg = d.xpProg || 0; p.score = d.score || 0;
    p.inv = (d.inv || []).map(s => s ? { id: s.id, n: s.n, d: s.d || 0 } : null); while (p.inv.length < 36) p.inv.push(null);
    p.armor = (d.armor || [null, null, null, null]).map(s => s ? { id: s.id, n: 1, d: s.d || 0 } : null);
    p.sel = d.sel || 0; p.gameMode = d.mode === undefined ? p.gameMode : d.mode; p.flying = !!d.flying;
    if (d.spawn) p.spawn = d.spawn;
    if (p.health <= 0) { p.health = 20; p.food = 20; p.sat = 5; const sp = p.spawn || this.spawnPoint; p.x = p.px = sp.x; p.y = p.py = sp.y; p.z = p.pz = sp.z; }   // saved while dead: come back at the spawn point
  }
  savePlayer() {
    const p = this.player, cl = s => s ? { id: s.id, n: s.n, d: s.d || 0 } : null;
    return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food, sat: p.sat, xp: p.xp, level: p.level, xpProg: p.xpProg, score: p.score, inv: p.inv.map(cl), armor: p.armor.map(cl), sel: p.sel, mode: p.gameMode, flying: p.flying, spawn: p.spawn };
  }
  async saveGame(sync) {
    if (!this.world || !this.worldInfo || this.state !== 'play') return;
    const rec = this.worldInfo; rec.lastPlayed = Date.now(); rec.time = this.time; rec.player = this.savePlayer(); rec.spawn = this.spawnPoint; rec.dim = this.dim;
    this.savePets(); rec.weather = { rain: this.weather.rain, target: this.weather.target, timer: this.weather.timer, thunder: this.weather.thunder }; rec.mode = this.player.gameMode === 1 ? 'creative' : 'survival'; rec.difficulty = this.difficulty;
    rec.stats = this.stats; rec.adv = Array.from(this.advDone);
    if (this.dim === 'end' && rec.end) { const d = this.entities.find(e => e.type === 'ender_dragon' && !e.dead); if (d) rec.end.dragonHp = d.hp; }
    this.captureAllEntities(false);
    this.world.saveAll();
    try { await this.store.putWorld(rec); } catch (e) { console.warn(e); }
  }
  async quitToTitle() {
    await this.saveGame();
    if (this.world) { for (const c of Array.from(this.world.chunks.values())) this.renderer.freeChunk(c); this.world.pool.terminate(); this.world = null; }
    this.stopLoops(); this.bolts = [];
    this.entities = []; this.player = null; this.state = 'title'; this.screen = null; this.unlockPointer(); this.mouse.locked = false;
    this.startBackgroundWorld();
    this.openScreen(new TitleScreen(this));
  }
  // ------------------------------------------------------------ title-screen panorama world
  startBackgroundWorld() {
    if (this.bgWorld) return;
    const seed = 2718281;
    const w = new World({ seed, tileIndex: this.renderer.TILE, viewDist: 5, store: null, savedKeys: new Set() });
    w.renderer = this.renderer; w.game = null; w.bg = true; this.bgWorld = w;
    const sp = SH.findSpawn(seed); this.bgPos = { x: sp.x + 0.5, y: Math.max(sp.y + 6, 72), z: sp.z + 0.5 };
    this.panoYaw = 0.6;
  }
  stopBackgroundWorld() {
    if (!this.bgWorld) return;
    for (const c of Array.from(this.bgWorld.chunks.values())) { c.unloaded = true; this.renderer.freeChunk(c); }
    this.bgWorld.pool.terminate();
    this.bgWorld = null;
  }
  // ------------------------------------------------------------ main loop
  start() {
    const loop = () => { this.lastRaf = now(); try { this.frame(); } catch (e) { if (!this._frameErr) { this._frameErr = true; console.error(e); } } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    setInterval(() => { if (now() - this.lastRaf > 120) this.frame(); }, 25);
  }
  frame() {
    const t = now(); let dt = t - this.last; this.last = t;
    if (dt > 250) dt = 250;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= 50 && steps < 5) { this.acc -= 50; steps++; this.gameTick(); }
    if (steps === 5) this.acc = 0;
    const cap = this.options.maxFps;   // Max Framerate option: requestAnimationFrame runs at the display rate, so skip frames above the cap
    if (cap < 260 && t - (this.lastRender || 0) < 1000 / cap - 2) return;
    this.lastRender = t;
    this.frames++; if (t - this.fpsT >= 500) { this.fps = this.frames * 1000 / (t - this.fpsT); this.frames = 0; this.fpsT = t; }
    if (this.state === 'loading' && this.world && this.player) this.world.update(this.player.x, this.player.z, 7);   // build the world every frame while the loading screen is up
    this.renderFrame(this.acc / 50);
  }
  gameTick() {
    this.updateInput();
    if (this.state === 'play' || this.state === 'loading') {
      const w = this.world;
      if (!w || !this.player) return;
      if (this.state === 'loading') { w.update(this.player.x, this.player.z, 5); w.tickCount++; return; }
      if (this.screen && this.screen.pausesGame) { w.update(this.player.x, this.player.z, 4); return; }
      this.tick++;
      w.tickCount++;
      w.update(this.player.x, this.player.z, 3);
      w.runScheduled();
      w.randomTicks(this.player.x, this.player.z, 3);
      this.updateTime();
      this.updateWeather();
      if (this.itemNameT > 0) this.itemNameT--;
      if (this.actionBarT > 0) this.actionBarT--;
      const p = this.player;
      // eye in fluid
      const ey = p.y + p.eyeH, eb = w.getBlock(Math.floor(p.x), Math.floor(ey), Math.floor(p.z));
      this.eyeInWater = T_FLUID[eb] === 1 && ey < Math.floor(ey) + fluidSurface(eb, w.getMeta(Math.floor(p.x), Math.floor(ey), Math.floor(p.z))) + (T_FLUID[w.getBlock(Math.floor(p.x), Math.floor(ey) + 1, Math.floor(p.z))] ? 1 : 0);
      this.eyeInLava = T_FLUID[eb] === 2;
      if (this.screen && this.screen.tick) this.screen.tick();
      if (!(this.screen && !this.screen.passive) && !p.dead) {
        const k = this.keys, sp = 0.055;
        if (k.ArrowLeft) p.yaw -= sp; if (k.ArrowRight) p.yaw += sp; if (k.ArrowUp) p.pitch = clamp(p.pitch - sp, -1.5707, 1.5707); if (k.ArrowDown) p.pitch = clamp(p.pitch + sp, -1.5707, 1.5707);
      }
      if (!w.isLoaded(Math.floor(p.x), Math.floor(p.z)) || this.holdPlayer()) { p.savePrev(); p.vx = p.vy = p.vz = 0; p.fallDist = 0; }   // wait for the terrain instead of falling through it
      else p.tick();
      this.dimTick();
      if (this.world !== w) return;   // went through a portal: the old world is gone
      this.stat('play');
      { const md = Math.hypot(p.x - p.px, p.z - p.pz); if (md < 5 && md > 0) this.stat(p.flying ? 'fly' : 'walk', undefined, md); }
      if (this.tick % 20 === 0) this.progressTick();
      this.handleInteraction();
      for (let i = this.entities.length - 1; i >= 0; i--) {
        const e = this.entities[i];
        try { e.tick(); } catch (err) { console.error(err); e.dead = true; }
        if (e.dead) this.entities.splice(i, 1);
      }
      this.particles.tick();
      this.spawnTick();
      this.tickFurnaces();
      this.tickSpawners();
      this.ambientTick();
      if (MCAudio && MCAudio.ready) { MCAudio.setListener(p.x, p.y + p.eyeH, p.z, Math.PI - p.yaw); }
      if (++this.autosaveT >= 1200) { this.autosaveT = 0; this.saveGame(); }
      if (this.sleepFade > 0 && this.player.sleeping) { }
    } else if (this.state === 'title') {
      if (this.bgWorld) { this.bgWorld.tickCount++; this.bgWorld.update(this.bgPos.x, this.bgPos.z, 6); }
      this.panoT++;
      if (this.screen && this.screen.tick) this.screen.tick();
    }
  }
  updateTime() {
    this.time++; this.day = Math.floor(this.time / 24000);
    const tod = this.time % 24000; this.isDay = tod < 12542 || tod > 23460;
    this.sunAngle = (tod / 24000 - 0.25) * TAU;
    if (this.player.sleeping) { this.player.sleepTimer++; if (this.player.sleepTimer >= 100) { this.player.sleeping = false; this.player.sleepTimer = 0; this.time = (this.day + 1) * 24000 + 0; this.sleepFade = 0; this.weather.target = 0; this.weather.rain = 0; this.player.spawn = { x: this.player.x, y: this.player.y, z: this.player.z }; this.actionBar = 'Spawn point set'; this.actionBarT = 40; } }
  }
  updateWeather() {
    const W = this.weather, p = this.player, w = this.world;
    for (let i = this.bolts.length - 1; i >= 0; i--) if (--this.bolts[i].life <= 0) this.bolts.splice(i, 1);
    if (this.dim !== 'overworld') { if (W.flash > 0) W.flash--; return; }   // the weather cycle belongs to the Overworld
    if (--W.timer <= 0) {
      if (W.target > 0) { W.target = 0; W.thunder = false; W.timer = 12000 + Math.random() * 168000; }
      else { W.target = 1; W.thunder = Math.random() < 0.2; W.timer = 12000 + Math.random() * 12000; }
    }
    W.rain += (W.target - W.rain) * 0.01;
    if (Math.abs(W.target - W.rain) < 0.002) W.rain = W.target;
    const tt = W.thunder && W.target > 0 ? 1 : 0;
    W.thunderLevel += (tt - W.thunderLevel) * 0.01;
    if (Math.abs(tt - W.thunderLevel) < 0.002) W.thunderLevel = tt;
    if (W.flash > 0) W.flash--;
    if (W.thunderLevel * W.rain > 0.9 && Math.random() < 1 / 380) {
      const a = Math.random() * TAU, d = 8 + Math.random() * 56;
      this.strikeLightning(Math.floor(p.x + Math.cos(a) * d), Math.floor(p.z + Math.sin(a) * d));
    }
    // rain splashes on the ground around the player
    if (W.rain > 0.3 && this.options.particles !== 0 && this.particles) {
      const bio = BIOMES[w.getBiome(Math.floor(p.x), Math.floor(p.z))];
      if (!(bio && /snowy|peaks/.test(bio.name))) {
        const n = Math.floor(W.rain * 4);
        for (let i = 0; i < n; i++) {
          const x = Math.floor(p.x + (Math.random() - 0.5) * 20), z = Math.floor(p.z + (Math.random() - 0.5) * 20);
          if (!w.isLoaded(x, z)) continue;
          const top = w.heightAt(x, z), b = w.getBlock(x, top - 1, z);
          if (b === 0 || T_FLUID[b] === 2 || top < p.y - 8 || top > p.y + 12) continue;
          this.particles.sprite('splash', x + Math.random(), top + (T_FLUID[b] === 1 ? 0.85 : 0.05), z + Math.random(), 1, { size: 0.045, up: 0.03, vel: 0.02, life: 7, grav: 0.02, spread: 0, spreadY: 0, r: 0.75, g: 0.85, b: 1, drag: 0.9 });
        }
      }
    }
  }
  strikeLightning(x, z) {
    const w = this.world, p = this.player; if (!w.isLoaded(x, z)) return;
    const y = w.heightAt(x, z);
    this.bolts.push({ x: x + 0.5, y, z: z + 0.5, life: 9, seed: (Math.random() * 1e9) | 0 });
    this.weather.flash = 3;
    const d = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z);
    this.sound('ambient.thunder', x + 0.5, y, z + 0.5, Math.min(1, 0.6 + 60 / (d + 40)), 0.7 + Math.random() * 0.5);
    this.sound('random.explode', x + 0.5, y, z + 0.5, 0.9, 0.5 + Math.random() * 0.2);
    for (const e of this.entities) {
      if (e.dead || !e.hurt || !e.isMob) continue;
      if (Math.abs(e.x - x - 0.5) < 3.5 && Math.abs(e.z - z - 0.5) < 3.5 && e.y > y - 3 && e.y < y + 6) { e.hurt(5, null, 'lightning', null); e.fireTicks = Math.max(e.fireTicks || 0, 160); }
    }
    if (!p.dead && Math.abs(p.x - x - 0.5) < 3.5 && Math.abs(p.z - z - 0.5) < 3.5 && p.y > y - 3 && p.y < y + 6 && p.gameMode === 0) { p.hurt(5, null, 'lightning'); p.fireTicks = Math.max(p.fireTicks || 0, 160); }
  }
  stopLoops() {
    if (typeof MCAudio === 'undefined' || !MCAudio.ready) { this.rainLoop = this.lavaLoop = this.ambLoop = 0; this.ambName = null; return; }
    if (this.rainLoop) { MCAudio.stopLoop(this.rainLoop, 0.3); this.rainLoop = 0; }
    if (this.lavaLoop) { MCAudio.stopLoop(this.lavaLoop, 0.3); this.lavaLoop = 0; }
    if (this.ambLoop) { MCAudio.stopLoop(this.ambLoop, 0.5); this.ambLoop = 0; } this.ambName = null;
  }
  // Block.randomDisplayTick: torch flames / smoke, lit furnace fire, lava embers around the player
  displayTicks() {
    if (this.options.particles === 0) return;
    const p = this.player, w = this.world, P = this.particles;
    // the Nether's air is never empty: spores, ash and white ash drift around (AmbientParticleSettings)
    if (this.dim === 'nether') {
      const b = BIOMES[w.getBiome(Math.floor(p.x), Math.floor(p.z))].name;
      const A = b === 'crimson_forest' ? [8, 0.75, 0.15, 0.15, 0.03] : b === 'warped_forest' ? [8, 0.35, 0.75, 0.85, 0.03] : b === 'soul_sand_valley' ? [6, 0.85, 0.85, 0.85, -0.01] : b === 'basalt_deltas' ? [14, 0.4, 0.4, 0.42, -0.02] : null;
      if (A) for (let i = 0; i < A[0]; i++) P.sprite('splash', p.x + (Math.random() - 0.5) * 24, p.y + (Math.random() - 0.3) * 14, p.z + (Math.random() - 0.5) * 24, 1, { size: 0.035, up: A[4], vel: 0.01, life: 60, grav: 0, spread: 0, spreadY: 0, r: A[1], g: A[2], b: A[3], drag: 0.98 });
    }
    for (let i = 0; i < 24; i++) {
      const x = Math.floor(p.x) + ((Math.random() * 17) | 0) - 8, y = Math.floor(p.y) + ((Math.random() * 13) | 0) - 5, z = Math.floor(p.z) + ((Math.random() * 17) | 0) - 8;
      const id = w.getBlock(x, y, z); if (id === 0) continue;
      if (id === BID.torch) {
        const m = w.getMeta(x, y, z), o = m === 0 ? [0, 0] : [[0, 0], [0.27, 0], [-0.27, 0], [0, 0.27], [0, -0.27]][m] || [0, 0], dy = m === 0 ? 0.7 : 0.9;
        P.sprite('smoke', x + 0.5 + o[0], y + dy, z + 0.5 + o[1], 1, { size: 0.05, up: 0.01, life: 16, shrink: true, spread: 0, spreadY: 0, vel: 0.004, r: 0.3, g: 0.3, b: 0.3 });
        P.sprite('flame', x + 0.5 + o[0], y + dy, z + 0.5 + o[1], 1, { size: 0.035, up: 0.0, life: 7, shrink: true, spread: 0, spreadY: 0, vel: 0.002 });
      } else if (id === BID.fire) {
        if (Math.random() < 0.06) this.sound('fire.fire', x + 0.5, y + 0.5, z + 0.5, 0.5 + Math.random() * 0.5, 0.75 + Math.random() * 0.5);
        for (let k = 0; k < 2; k++) P.sprite('smoke', x + Math.random(), y + 0.5 + Math.random() * 0.5, z + Math.random(), 1, { size: 0.09, up: 0.03, life: 22, shrink: true, spread: 0, spreadY: 0, vel: 0.006, r: 0.25, g: 0.25, b: 0.25 });
        if (Math.random() < 0.5) P.sprite('flame', x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6, 1, { size: 0.05, up: 0.03, life: 9, shrink: true, spread: 0, spreadY: 0, vel: 0.004 });
      } else if (id === BID.furnace_lit && Math.random() < 0.4) {
        const m = w.getMeta(x, y, z), fx = m === 4 ? -0.52 : m === 5 ? 0.52 : 0, fz = m === 2 ? -0.52 : m === 3 ? 0.52 : 0;
        P.sprite('flame', x + 0.5 + fx + (fz ? (Math.random() - 0.5) * 0.6 : 0), y + Math.random() * 0.4, z + 0.5 + fz + (fx ? (Math.random() - 0.5) * 0.6 : 0), 1, { size: 0.06, up: 0.01, life: 10, shrink: true, spread: 0, spreadY: 0, vel: 0.004 });
        if (Math.random() < 0.3) P.sprite('smoke', x + 0.5 + fx, y + Math.random() * 0.6, z + 0.5 + fz, 1, { size: 0.07, up: 0.02, life: 20, shrink: true, spread: 0, spreadY: 0, vel: 0.004, r: 0.3, g: 0.3, b: 0.3 });
      } else if (id === BID.nether_portal) {
        // NetherPortalBlock.animateTick: the hum and purple motes drifting toward the sheet
        if (Math.random() < 0.08) this.sound('portal.portal', x + 0.5, y + 0.5, z + 0.5, 0.5, 0.8 + Math.random() * 0.4);
        for (let k = 0; k < 3; k++) { const ax = (w.getMeta(x, y, z) & 1) === 0, ox = ax ? Math.random() : 0.5 + (Math.random() < 0.5 ? -1 : 1) * 0.6, oz = ax ? 0.5 + (Math.random() < 0.5 ? -1 : 1) * 0.6 : Math.random(); P.sprite('portal', x + ox, y + Math.random(), z + oz, 1, { size: 0.05, up: 0.02, life: 26, shrink: true, spread: 0, spreadY: 0, vel: 0.02, r: 0.55 + Math.random() * 0.3, g: 0.2, b: 0.85 }); }
      } else if (id === BID.soul_fire && Math.random() < 0.5) {
        P.sprite('flame', x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6, 1, { size: 0.05, up: 0.03, life: 9, shrink: true, spread: 0, spreadY: 0, vel: 0.004, r: 0.35, g: 0.9, b: 1 });
        if (Math.random() < 0.06) this.sound('fire.fire', x + 0.5, y + 0.5, z + 0.5, 0.5 + Math.random() * 0.5, 0.75 + Math.random() * 0.5);
      } else if (id === BID.end_rod && Math.random() < 0.3) {
        P.sprite('flame', x + 0.5 + (Math.random() - 0.5) * 0.3, y + 0.5 + (Math.random() - 0.5) * 0.3, z + 0.5 + (Math.random() - 0.5) * 0.3, 1, { size: 0.04, up: 0.01, life: 40, shrink: true, spread: 0, spreadY: 0, vel: 0.01, r: 1, g: 1, b: 1 });
      } else if (id === BID.end_portal || id === BID.end_gateway) {
        P.sprite('smoke', x + Math.random(), y + 0.8, z + Math.random(), 1, { size: 0.06, up: 0.0, life: 20, shrink: true, spread: 0, spreadY: 0, vel: 0.004, r: 0.08, g: 0.06, b: 0.1 });
        if (id === BID.end_gateway) P.sprite('portal', x + Math.random(), y + Math.random(), z + Math.random(), 1, { size: 0.06, up: 0.02, life: 24, shrink: true, spread: 0.4, spreadY: 0.4, vel: 0.03, r: 0.75, g: 0.35, b: 0.95 });
      } else if (id === BID.dragon_egg && Math.random() < 0.2) {
        P.sprite('portal', x + 0.5 + (Math.random() - 0.5) * 2, y + Math.random() * 2, z + 0.5 + (Math.random() - 0.5) * 2, 1, { size: 0.05, up: -0.02, life: 24, shrink: true, spread: 0, spreadY: 0, vel: 0.02, r: 0.8, g: 0.35, b: 0.95 });
      } else if ((id === BID.smoker_lit || id === BID.blast_furnace_lit) && Math.random() < 0.4) {
        const m = w.getMeta(x, y, z), fx = m === 4 ? -0.52 : m === 5 ? 0.52 : 0, fz = m === 2 ? -0.52 : m === 3 ? 0.52 : 0;
        P.sprite('flame', x + 0.5 + fx + (fz ? (Math.random() - 0.5) * 0.6 : 0), y + Math.random() * 0.4, z + 0.5 + fz + (fx ? (Math.random() - 0.5) * 0.6 : 0), 1, { size: 0.06, up: 0.01, life: 10, shrink: true, spread: 0, spreadY: 0, vel: 0.004 });
        if (id === BID.smoker_lit) P.sprite('smoke', x + 0.5, y + 1.05, z + 0.5, 1, { size: 0.09, up: 0.03, life: 30, shrink: true, spread: 0.2, spreadY: 0, vel: 0.004, r: 0.35, g: 0.35, b: 0.35 });
      } else if (T_FLUID[id] === 2 && w.getBlock(x, y + 1, z) === 0 && Math.random() < 0.15) {
        P.sprite('flame', x + Math.random(), y + 1.02, z + Math.random(), 1, { size: 0.05, up: 0.06, life: 14, grav: 0.02, spread: 0, spreadY: 0, vel: 0.02, r: 1, g: 0.5, b: 0.1 });
        if (Math.random() < 0.08) this.sound('liquid.lavapop', x + 0.5, y + 1, z + 0.5, 0.4, 0.9 + Math.random() * 0.3);
      }
    }
  }
  ambientTick() {
    const p = this.player;
    if ((this.tick & 1) === 0) this.displayTicks();
    // looping ambience: rain (quieter under a roof) and lava nearby
    if (typeof MCAudio !== 'undefined' && MCAudio.ready) {
      const W = this.weather, w = this.world, px = Math.floor(p.x), pz = Math.floor(p.z);
      let want = 0;
      if (W.rain > 0.05 && this.dim === 'overworld') { const under = w.heightAt(px, pz) > Math.floor(p.y + p.eyeH); const bio = BIOMES[w.getBiome(px, pz)]; want = W.rain * (under ? 0.3 : 1) * (bio && /snowy|peaks/.test(bio.name) ? 0.35 : 1); }
      // biome ambience loops of the Nether (and the hollow wind of the End)
      const amb = this.dim === 'nether' ? 'loop.nether' : this.dim === 'end' ? 'loop.end' : null;
      if (amb !== this.ambName) { if (this.ambLoop) MCAudio.stopLoop(this.ambLoop, 1.5); this.ambLoop = amb && MCAudio.names && MCAudio.names.indexOf(amb) >= 0 ? MCAudio.startLoop(amb, { vol: 0.5 }) || 0 : 0; this.ambName = amb; }
      if (want > 0.03) { if (!this.rainLoop) this.rainLoop = MCAudio.startLoop('loop.rain', { vol: want }) || 0; else MCAudio.setLoopVolume(this.rainLoop, want); }
      else if (this.rainLoop) { MCAudio.stopLoop(this.rainLoop, 0.6); this.rainLoop = 0; }
      if (this.tick % 10 === 0) {
        let near = 1e9; const by = Math.floor(p.y);
        for (let dx = -5; dx <= 5; dx += 2) for (let dz = -5; dz <= 5; dz += 2) for (let dy = -3; dy <= 3; dy += 2) if (T_FLUID[w.getBlock(px + dx, by + dy, pz + dz)] === 2) near = Math.min(near, dx * dx + dy * dy + dz * dz);
        this.lavaWant = near < 1e9 ? Math.max(0.1, 1 - Math.sqrt(near) / 7) : 0;
      }
      if (this.lavaWant > 0.02) { if (!this.lavaLoop) this.lavaLoop = MCAudio.startLoop('loop.lava', { vol: this.lavaWant }) || 0; else MCAudio.setLoopVolume(this.lavaLoop, this.lavaWant); }
      else if (this.lavaLoop) { MCAudio.stopLoop(this.lavaLoop, 0.5); this.lavaLoop = 0; }
    }
    // nether mood additions: distant groans and crackles (AmbientAdditionsSettings)
    if (this.dim === 'nether' && Math.random() < 0.0111) {
      const b = BIOMES[this.world.getBiome(Math.floor(p.x), Math.floor(p.z))].name;
      this.sound(b === 'soul_sand_valley' ? 'ambient.soul_sand_valley.additions' : b === 'basalt_deltas' ? 'ambient.basalt_deltas.additions' : b === 'warped_forest' ? 'ambient.warped_forest.additions' : b === 'crimson_forest' ? 'ambient.crimson_forest.additions' : 'ambient.nether_wastes.additions', p.x + (Math.random() - 0.5) * 16, p.y + (Math.random() - 0.5) * 8, p.z + (Math.random() - 0.5) * 16, 0.5, 0.8 + Math.random() * 0.4, 'ambient.cave');
    }
    // cave sounds in the dark, occasionally
    if (this.dim === 'overworld' && this.tick % 20 === 0 && Math.random() < 0.02) {
      const sk = this.world.getSky(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z)), bk = this.world.getBlk(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
      if (sk < 4 && bk < 4 && p.y < 50) this.sound('ambient.cave', p.x + (Math.random() - 0.5) * 8, p.y, p.z + (Math.random() - 0.5) * 8, 0.7, 0.8 + Math.random() * 0.4);
    }
    // music
    if (typeof MCAudio !== 'undefined' && MCAudio.ready && MCAudio.music) {
      if (--this.musicT <= 0) {
        if (!MCAudio.music.isPlaying()) { try { MCAudio.music.setMood(this.dim === 'nether' ? 'nether' : this.dim === 'end' ? (this.entities.some(e => e.type === 'ender_dragon' && !e.dead) ? 'boss' : 'end') : p.y < 45 ? 'cave' : 'calm'); MCAudio.music.play(); } catch (e) { } }
        this.musicT = 2400 + Math.random() * 6000;
      }
    }
  }
  // ------------------------------------------------------------ interaction
  reach() { return this.player.gameMode === 1 ? 5.0 : 4.5; }
  updateTarget(cam) {
    const w = this.world, p = this.player; if (!w) return;
    const dir = [0, 0, 0]; lookDir(cam.yaw, cam.pitch, dir);
    const ox = cam.x, oy = cam.y, oz = cam.z, reach = this.reach();
    const hit = w.raycast(ox, oy, oz, dir[0], dir[1], dir[2], reach, false);
    this.target = hit && !p.dead ? hit : null;
    // entities
    let best = null, bestPart = null, bt = (hit ? hit.t : reach) + 1e-6;
    const er = p.gameMode === 1 ? 5 : 3;
    for (const e of this.entities) {
      if ((!e.isMob && !e.targetable) || e.dead || e.deathTime > 0) continue;
      if (e.parts) { for (const pt of e.parts) { const r = rayAABB(ox, oy, oz, dir[0], dir[1], dir[2], pt.x0, pt.y0, pt.z0, pt.x1, pt.y1, pt.z1); if (r !== null && r < er && r < bt) { bt = r; best = e; bestPart = pt; } } continue; }
      const r = rayAABB(ox, oy, oz, dir[0], dir[1], dir[2], e.x - e.w / 2, e.y, e.z - e.w / 2, e.x + e.w / 2, e.y + e.h, e.z + e.w / 2);
      if (r !== null && r < er && r < bt) { bt = r; best = e; bestPart = null; }
    }
    this.entityTarget = best; this.entityPart = bestPart;
    if (best) this.target = null;
  }
  handleInteraction() {
    const p = this.player, m = this.mouse;
    if (p.dead || this.screen && !this.screen.passive) { this.breaking = null; return; }
    if (!this.mouse.locked && !this.noLock) return;
    // hold left: mine
    if (m.buttons & 1) this.continueMining();
    else this.breaking = null;
    // hold right: repeat use
    if (this.useCd > 0) this.useCd--;
    if ((m.buttons & 4) && this.useCd === 0) { this.useCd = 4; this.onRightDown(false); }
    if (p.eating > 0) {
      if (!(m.buttons & 4)) { p.eating = 0; } else {
        p.eating++;
        const s = p.held(), it = s && ITEMS[s.id];
        if (p.eating % 4 === 0 && it && it.food) { this.sound('random.eat', p.x, p.y + 1, p.z, 0.5, 0.8 + Math.random() * 0.4); this.addParticles('item', p.x - Math.sin(p.yaw) * 0.4, p.y + 1.4, p.z + Math.cos(p.yaw) * 0.4, 3, s.id); }
        if (p.eating >= 32 && it && it.food) this.finishEating(s, it);
      }
    }
    if (p.usingBow > 0) { if (!(m.buttons & 4)) this.shootBow(); else p.usingBow++; }
    if (this.swingAttackCd > 0) this.swingAttackCd--;
  }
  onLeftDown() {
    const p = this.player;
    p.swingArm();
    if (this.entityTarget) { this.attackEntity(this.entityTarget); return; }
    if (!this.target && p.gameMode === 0) { /* air swing */ }
    if (this.target) { this.breaking = null; this.continueMining(true); }
  }
  attackEntity(e) {
    const p = this.player, s = p.held(), it = s && ITEMS[s.id];
    if (p.attackCd > 0 && false) return;
    let dmg = it && it.dmg && it.cat !== 'block' ? it.dmg : 1;
    const crit = p.fallDist > 0.1 && !p.onGround && !p.inWater && p.vy < 0 && !p.sprinting;
    if (crit) dmg *= 1.5;
    const kbScale = p.sprinting ? 1.5 : 1;
    const dx = e.x - p.x, dz = e.z - p.z;
    if (e.parts && e.hurtPart) { if (e.hurtPart(this.entityPart || e.parts[0], dmg, p, 'player')) { this.stat('dmgDealt', undefined, dmg); p.exhaust(0.1); if (crit) this.addParticles('crit', this.entityPart ? (this.entityPart.x0 + this.entityPart.x1) / 2 : e.x, this.entityPart ? this.entityPart.y1 : e.y + 2, this.entityPart ? (this.entityPart.z0 + this.entityPart.z1) / 2 : e.z, 8); if (s && it && it.dur && p.gameMode === 0) this.damageTool(s, it.cat === 'combat' ? 1 : 2); } return; }
    if (e.hurt(dmg, p, 'player', [dx, dz])) {
      if (e.isMob) { p.lastAttacked = e; p.lastAttackT = this.tick; }   // tamed wolves join in
      this.stat('dmgDealt', undefined, dmg);
      if (kbScale > 1) { const d = Math.hypot(dx, dz) || 1; e.vx += dx / d * 0.4; e.vz += dz / d * 0.4; p.sprinting = false; }
      if (crit) this.addParticles('crit', e.x, e.y + e.h * 0.6, e.z, 8);
      p.exhaust(0.1);
      if (s && it && it.dur && p.gameMode === 0) this.damageTool(s, it.cat === 'combat' ? 1 : 2);
      if (e.fireTicks !== undefined && false) e.fireTicks = 0;
    }
  }
  damageTool(s, n) {
    if (!s || this.player.gameMode === 1) return;
    s.d = (s.d || 0) + (n || 1);
    const it = ITEMS[s.id];
    if (s.d >= it.dur) { const p = this.player, i = p.inv.indexOf(s); if (i >= 0) p.inv[i] = null; this.sound('random.break', p.x, p.y, p.z, 0.8, 1); }
  }
  continueMining(first) {
    const p = this.player, w = this.world, t = this.target;
    if (!t) { this.breaking = null; return; }
    if (T_FLUID[t.id]) { this.breaking = null; return; }
    const d = BLOCKS[t.id];
    if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z) {
      if (p.gameMode === 1) { this.breaking = { x: t.x, y: t.y, z: t.z, ticks: 0, total: 1, cd: 0 }; }
      else this.breaking = { x: t.x, y: t.y, z: t.z, ticks: 0, total: breakTicks(p.held(), t.id, p.onGround, p.inWater), cd: 0 };
    }
    const b = this.breaking;
    if (p.gameMode === 1) {
      if (b.cd > 0) { b.cd--; return; }
      if (first || b.ticks === 0) { this.destroyBlock(t.x, t.y, t.z); b.cd = 5; b.ticks = 1; return; }
      this.destroyBlock(t.x, t.y, t.z); b.cd = 5; return;
    }
    if (d.hard < 0) return;
    b.ticks++;
    if (b.ticks % 4 === 1) { p.swingArm(); this.sound('dig.' + (d.sound || 'stone'), t.x + 0.5, t.y + 0.5, t.z + 0.5, 0.25, 0.5); this.particles.block(t.x, t.y, t.z, t.id, 2, 0.6); }
    if (b.ticks >= b.total) { this.destroyBlock(t.x, t.y, t.z); this.breaking = null; this.mineCd = 5; }
  }
  destroyBlock(x, y, z) {
    const p = this.player, w = this.world, id = w.getBlock(x, y, z); if (!id) return;
    const d = BLOCKS[id], s = p.held();
    const drops = p.gameMode === 0;
    this.stat('mined', id);
    w.breakBlock(x, y, z, { drops, tool: s, urgent: true });
    p.swingArm();
    if (p.gameMode === 0) {
      p.exhaust(0.005);
      const it = s && ITEMS[s.id];
      if (it && it.dur && d.hard > 0) this.damageTool(s, it.cat === 'tool' ? 1 : 2);
      // ore experience (Block.popExperience), only when the right tool actually dropped the ore
      const xr = d.xpDrop || ORE_XP[d.name];
      if (xr && (!d.needTool || toolSpeedFor(s, id)[1])) { const n = xr[0] + ((Math.random() * (xr[1] - xr[0] + 1)) | 0); if (n > 0) this.entities.push(new XPOrb(this, x + 0.5, y + 0.5, z + 0.5, n)); }
    }
  }
  // called by World.breakBlock before the block is removed (sound + particles)
  onBlockBroken(x, y, z, id, meta, o) {
    const d = BLOCKS[id];
    if (id === BID.fire) { this.sound('random.fizz', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6 + Math.random() * 0.8); return; }
    if (!o.noSound && d.sound) this.sound('dig.' + d.sound, x + 0.5, y + 0.5, z + 0.5, 0.9, 0.8 + Math.random() * 0.2);
    this.particles.block(x, y, z, id, id === BID.glass ? 12 : 16, 1);
    if (id === BID.tnt && o.prime !== false && o.drops === undefined) { }
  }
  spawnItem(x, y, z, stack, vel) {
    if (!stack || stack.n <= 0) return;
    const e = new ItemEntity(this, x, y, z, cloneStack(stack), vel);
    if (this.entities.length < 600) this.entities.push(e);
    return e;
  }
  canSpawnFalling() { if (this._fbT !== this.tick) { this._fbT = this.tick; let n = 0; for (const e of this.entities) if (e instanceof FallingBlock && !e.dead) n++; this._fbN = n; } return this._fbN < 300; }
  spawnFalling(x, y, z, id, meta) { this._fbN = (this._fbN || 0) + 1; this.entities.push(new FallingBlock(this, x, y, z, id, meta)); }
  fizz(x, y, z) { this.sound('random.fizz', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6 + Math.random() * 0.8); this.addParticles('smoke', x + 0.5, y + 0.8, z + 0.5, 6); }
  dropHeld(all) {
    const p = this.player, s = p.held(); if (!s) return;
    const n = all ? s.n : 1; const drop = cloneStack(s); drop.n = n;
    s.n -= n; if (s.n <= 0) p.inv[p.sel] = null;
    const dir = [0, 0, 0]; lookDir(p.yaw, p.pitch, dir);
    const e = this.spawnItem(p.x, p.y + p.eyeH - 0.3, p.z, drop, [dir[0] * 0.3, dir[1] * 0.3 + 0.1, dir[2] * 0.3]);
    if (e) e.pickupDelay = 40;
    p.swingArm();
  }
  dropStackFromInventory(stack) {
    const p = this.player, dir = [0, 0, 0]; lookDir(p.yaw, p.pitch, dir);
    const e = this.spawnItem(p.x, p.y + p.eyeH - 0.3, p.z, stack, [dir[0] * 0.3, dir[1] * 0.3 + 0.1, dir[2] * 0.3]); if (e) e.pickupDelay = 40;
  }
  pickBlock() {
    const p = this.player, t = this.target; if (!t || p.gameMode !== 1) return;
    let id = t.id; if (id === BID.furnace_lit) id = BID.furnace; else if (BLOCKS[id].sign) id = IID.oak_sign;
    const it = ITEMS[id]; if (!it) return;
    for (let i = 0; i < 9; i++) if (p.inv[i] && p.inv[i].id === id) { p.sel = i; this.onHotbarChange(); return; }
    let slot = p.inv.findIndex((s, i) => i < 9 && !s); if (slot < 0) slot = p.sel;
    p.inv[slot] = newStack(id, 1); p.sel = slot; this.onHotbarChange();
  }
  // ---- right click: interact / place / use item
  onRightDown(first) {
    const p = this.player, w = this.world, s = p.held(), it = s && ITEMS[s.id], t = this.target;
    if (this.entityTarget && first) {
      if (this.interactEntity(this.entityTarget, s, it)) return;
    }
    if (t) {
      const id = t.id, d = BLOCKS[id];
      if (!p.sneaking || !s) { if (first && this.interactBlock(t, d)) return; }
      else if (first && this.interactBlock(t, d) && false) return;
    }
    if (!s || !it) return;
    // seeds that are also food (carrot, potato) plant first when aimed at farmland
    if (it.plant && it.food && t && t.id === BID.farmland && t.face === 1 && first) { this.placeBlock(t, s, it); return; }
    if (it.enderEye && first) { this.useEnderEye(s, t); return; }
    // food
    if (it.food && (p.food < 20 || p.gameMode === 1 || it.alwaysEdible) && first) { if (p.food < 20 || it.alwaysEdible) { p.eating = 1; } return; }
    if (it.spawn && first) { if (t) this.useSpawnEgg(s, it, t); return; }
    if (it.bow && first) { if (p.gameMode === 1 || p.inv.some(x => x && x.id === IID.arrow)) p.usingBow = 1; return; }
    if (it.throwable && first) { this.throwItem(s, it); return; }
    if (it.bucket) { this.useBucket(s, it, t); return; }
    if (!t) return;
    if (it.igniter && first) { this.useFlint(s, t); return; }
    if (it.endCrystal && first) { this.useEndCrystal(s, t); return; }
    if (it.tool && it.tool.kind === 'hoe' && first) { this.useHoe(s, t); return; }
    if (it.tool && it.tool.kind === 'shovel' && first && t.face !== 0 && (t.id === BID.grass_block || t.id === BID.dirt || t.id === BID.coarse_dirt || t.id === BID.podzol || t.id === BID.grass_block_snowy) && w.getBlock(t.x, t.y + 1, t.z) === 0) {
      w.setBlock(t.x, t.y, t.z, BID.dirt_path, 0, 8); this.sound('step.grass', t.x + 0.5, t.y + 1, t.z + 0.5, 1, 1); this.damageTool(s, 1); p.swingArm(); return;
    }
    if (it.name === 'bone_meal' && first) { this.useBoneMeal(s, t); return; }
    if (it.tool && it.tool.kind === 'shears' && first) { if (t.id === BID.pumpkin) { w.setBlock(t.x, t.y, t.z, BID.carved_pumpkin, this.facingMeta(t)); this.sound('random.click', t.x, t.y, t.z, 1, 1); this.damageTool(s, 1); return; } }
    if (it.blk >= 0 && it.blk !== undefined && it.blk !== -1) this.placeBlock(t, s, it);
  }
  useSpawnEgg(s, it, t) {
    const w = this.world, p = this.player, mob = it.spawn;
    if (t.id === BID.spawner) {
      const be = w.blockEntity(t.x, t.y, t.z, () => ({ type: 'spawner', mob: 'pig', delay: 200 })); be.mob = mob;
      const c = w.chunkAt(t.x, t.z); if (c) c.modified = true;
      this.addParticles('smoke', t.x + 0.5, t.y + 0.5, t.z + 0.5, 8);
    } else {
      let x = t.x, y = t.y, z = t.z;
      if (!(BLOCKS[t.id].replaceable && !T_FLUID[t.id])) { x += DIRS[t.face][0]; y += DIRS[t.face][1]; z += DIRS[t.face][2]; }
      if (T_SOLID[w.getBlock(x, y, z)]) return;
      this.spawnMob(mob, x + 0.5, y + (T_FLUID[w.getBlock(x, y - 1, z)] ? 0.1 : 0), z + 0.5);
    }
    p.swingArm();
    if (p.gameMode === 0) { s.n--; if (s.n <= 0) p.inv[p.sel] = null; }
  }
  facingMeta(t) { const p = this.player; const a = ((p.yaw / DEG) % 360 + 360) % 360; return a >= 315 || a < 45 ? 2 : a < 135 ? 5 : a < 225 ? 3 : 4; } // front faces the player (opposite of look direction)
  interactBlock(t, d) {
    const p = this.player, w = this.world;
    if (d.name === 'crafting_table') { this.openScreen(new CraftingScreen(this, t)); return true; }
    if (d.name === 'furnace' || d.name === 'furnace_lit' || d.furnaceKind) { this.openScreen(new FurnaceScreen(this, t)); return true; }
    if (d.name === 'chest' || d.barrel) { this.openScreen(new ChestScreen(this, t)); return true; }
    if (d.bell) { this.ringBell(t); return true; }
    if (d.composter) return this.useComposter(t);
    if (d.cauldron) return this.useCauldron(t);
    if (d.dragonEgg) { this.teleportDragonEgg(t.x, t.y, t.z); return true; }
    if (d.stonecutter && typeof StonecutterScreen !== 'undefined') { this.openScreen(new StonecutterScreen(this, t)); return true; }
    if (d.sign) { this.openScreen(new SignScreen(this, t)); p.swingArm(); return true; }
    if (d.door) {
      const lower = (t.meta & 8) ? t.y - 1 : t.y, m = w.getMeta(t.x, lower, t.z) ^ 4;
      w.setBlock(t.x, lower, t.z, t.id, m); w.setBlock(t.x, lower + 1, t.z, t.id, m | 8);
      this.sound((m & 4) ? 'random.door_open' : 'random.door_close', t.x + 0.5, t.y, t.z + 0.5, 1, 0.9 + Math.random() * 0.1);
      p.swingArm(); return true;
    }
    if (d.bed) { this.useBed(t); return true; }
    if (d.gate) {
      let m = t.meta ^ 4;
      if (m & 4) { const yd = ((p.yaw / DEG) % 360 + 360) % 360, look = yd >= 315 || yd < 45 ? 0 : yd < 135 ? 1 : yd < 225 ? 2 : 3; m = (m & ~3) | ((m & 1) ? (look === 3 ? 3 : 1) : (look === 0 ? 0 : 2)); }
      w.setBlock(t.x, t.y, t.z, t.id, m);
      this.sound((m & 4) ? 'random.door_open' : 'random.door_close', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 0.9 + Math.random() * 0.1);
      p.swingArm(); return true;
    }
    if (d.trapdoor) {
      const m = t.meta ^ 4; w.setBlock(t.x, t.y, t.z, t.id, m);
      this.sound((m & 4) ? 'random.door_open' : 'random.door_close', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 1.0 + Math.random() * 0.1);
      p.swingArm(); return true;
    }
    if (d.name === 'tnt' && false) return true;
    if (d.name === 'grass_block' && false) return true;
    return false;
  }
  useBed(t) {
    const p = this.player, w = this.world, tod = this.time % 24000;
    if (this.dim !== 'overworld') {   // BedBlock: beds do not work here - they explode (power 5, with fire)
      const f = t.meta & 3, dv = [[0, 1], [-1, 0], [0, -1], [1, 0]][f], hx = (t.meta & 4) ? t.x : t.x + dv[0], hz = (t.meta & 4) ? t.z : t.z + dv[1];
      w.setBlock(t.x, t.y, t.z, 0, 0, 8); if (w.getBlock(hx, t.y, hz) === BID.bed) w.setBlock(hx, t.y, hz, 0, 0, 8);
      for (let i = 0; i < 4; i++) { const ox = hx + ((Math.random() * 5) | 0) - 2, oz = hz + ((Math.random() * 5) | 0) - 2; if (!w.getBlock(ox, t.y, oz) && T_SOLID[w.getBlock(ox, t.y - 1, oz)]) w.setBlock(ox, t.y, oz, BID.fire, 0); }
      this.explode(hx + 0.5, t.y + 0.5, hz + 0.5, 5, null, { fire: true });
      this.stat('bed_exploded');
      return;
    }
    if (this.isDay && !(this.weather.thunder && this.weather.rain > 0.9)) { this.actionBar = 'You can only sleep at night'; this.actionBarT = 60; return; }
    for (const e of this.entities) if (e.isMob && e.def.hostile && !e.dead && Math.abs(e.x - p.x) < 8 && Math.abs(e.y - p.y) < 5 && Math.abs(e.z - p.z) < 8) { this.actionBar = 'You may not rest now, there are monsters nearby'; this.actionBarT = 60; return; }
    p.sleeping = true; p.sleepTimer = 0; this.sleepFade = 1; this.stat('slept');
    this.openScreen(new SleepScreen(this));
  }
  interactEntity(e, s, it) {
    if (e.interact && e.interact(s, it)) return true;   // villagers trade, etc.
    // iron golems are patched up with iron ingots (+25 health)
    if (e.type === 'iron_golem' && it && it.name === 'iron_ingot' && e.hp < e.maxHp) { e.hp = Math.min(e.maxHp, e.hp + 25); this.sound('mob.irongolem.repair', e.x, e.y, e.z, 1, 1, 'random.anvil_land'); if (this.player.gameMode === 0) { s.n--; if (s.n <= 0) this.player.inv[this.player.sel] = null; } this.player.swingArm(); return true; }
    // piglins take a gold ingot and barter
    if (e.type === 'piglin' && it && it.name === 'gold_ingot' && !(e.admireT > 0) && e.startAdmire) { e.startAdmire(); if (this.player.gameMode === 0) { s.n--; if (s.n <= 0) this.player.inv[this.player.sel] = null; } this.player.swingArm(); return true; }
    if (e.type === 'sheep' && it && it.tool && it.tool.kind === 'shears' && !e.sheared) {
      e.sheared = true; const n = 1 + ((Math.random() * 3) | 0);
      this.spawnItem(e.x, e.y + 0.8, e.z, newStack(IID[SHEEP_WOOL_NAMES[e.woolIdx || 0] + '_wool'], n), [(Math.random() - 0.5) * 0.1, 0.2, (Math.random() - 0.5) * 0.1]);
      this.sound('mob.sheep.say', e.x, e.y, e.z, 0.5, 1.3, 'random.click'); this.damageTool(s, 1); this.player.swingArm(); return true;
    }
    if (e.type === 'cow' && it && it.bucket === 'empty') {
      const p = this.player; s.n--; if (s.n <= 0) p.inv[p.sel] = null; const m = newStack(IID.milk_bucket, 1); if (!p.giveItem(m)) this.dropStackFromInventory(m);
      this.sound('mob.cow.say', e.x, e.y, e.z, 1, 1.2); return true;
    }
    if (e.type === 'wolf') return this.interactWolf(e, s, it);
    if (e.def.passive && e.def.breed && it && e.def.breed.indexOf(it.name) >= 0) {
      const p = this.player;
      if (e.isBaby) { e.growT += (24000 - e.growT) * 0.1; this.addParticles('heart', e.x, e.y + e.h + 0.3, e.z, 3); }
      else if (e.love <= 0 && e.bredCd <= 0) { e.love = 600; this.addParticles('heart', e.x, e.y + e.h + 0.3, e.z, 5); }
      else return false;
      this.sound('random.eat', e.x, e.y, e.z, 0.6, 1); p.swingArm();
      if (p.gameMode === 0) { s.n--; if (s.n <= 0) p.inv[p.sel] = null; }
      return true;
    }
    return false;
  }
  // wolves: a bone tames a wild one (1 in 3), the owner toggles sitting, meat heals a tame wolf
  interactWolf(e, s, it) {
    const p = this.player, use = () => { if (p.gameMode === 0 && s) { s.n--; if (s.n <= 0) p.inv[p.sel] = null; } };
    const meat = !!(it && it.food && /porkchop|beef|chicken|mutton|rotten_flesh/.test(it.name));
    if (!e.tamed) {
      if (!(it && it.name === 'bone') || e.angryT > 0) return false;
      use();
      if (Math.random() < 1 / 3) { e.tamed = true; e.owner = p; e.persist = true; e.sitting = true; e.hp = e.maxHp = 20; e.target = null; e.angryT = 0; this.addParticles('heart', e.x, e.y + e.h + 0.3, e.z, 7); }
      else this.addParticles('smoke', e.x, e.y + e.h + 0.3, e.z, 7);
      p.swingArm(); return true;
    }
    if (meat && e.hp < e.maxHp) { use(); e.hp = Math.min(e.maxHp, e.hp + it.food.h); this.addParticles('heart', e.x, e.y + e.h + 0.3, e.z, 3); this.sound('random.eat', e.x, e.y, e.z, 0.6, 1); p.swingArm(); return true; }
    if (e.owner === p) { e.sitting = !e.sitting; e.moving = false; e.target = null; p.swingArm(); return true; }
    return false;
  }
  blockCollidesPlayer(x, y, z, id, meta) {
    const p = this.player; if (p.dead) return false;
    const bs = SH.getCollision(id, meta); if (!bs) return false;
    const hw = p.w / 2, x0 = p.x - hw, x1 = p.x + hw, y0 = p.y, y1 = p.y + p.h, z0 = p.z - hw, z1 = p.z + hw;
    for (const b of bs) if (x1 > x + b[0] + 1e-4 && x0 < x + b[3] - 1e-4 && y1 > y + b[1] + 1e-4 && y0 < y + b[4] - 1e-4 && z1 > z + b[2] + 1e-4 && z0 < z + b[5] - 1e-4) return true;
    return false;
  }
  placeBlock(t, s, it) {
    const p = this.player, w = this.world, id0 = it.blk, d0 = BLOCKS[id0];
    let x = t.x, y = t.y, z = t.z, meta = 0, id = id0;
    const face = t.face, fx = t.hx - t.x, fy = t.hy - t.y, fz = t.hz - t.z;
    const tb = BLOCKS[t.id];
    // replace replaceable target block (grass, snow layer...) else go to the adjacent cell
    let replaceTarget = tb.replaceable && !T_FLUID[t.id];
    if (d0.slab && tb.slab && tb.base === d0.base) {
      // merge into a double slab when clicking the exposed half
      const top = (t.meta & 1) !== 0;
      if ((face === 1 && !top) || (face === 0 && top)) {
        const full = BID[BLOCKS[t.id].base]; if (this.blockCollidesPlayer(t.x, t.y, t.z, full, 0)) return; w.setBlock(t.x, t.y, t.z, full, 0, 8); this.finishPlace(s, t.x, t.y, t.z, full); return;
      }
    }
    if (d0.vine) { this.placeVine(t, s); return; }
    if (d0.sign) { this.placeSign(t, s, it); return; }
    if (d0.layer && t.id === BID.snow_layer) {
      if (t.meta < 7 && face === 1) { w.setBlock(t.x, t.y, t.z, t.id, t.meta + 1, 8); this.finishPlace(s, t.x, t.y, t.z, t.id); return; }
    }
    if (!replaceTarget) { x += DIRS[face][0]; y += DIRS[face][1]; z += DIRS[face][2]; }
    if (y < 0 || y > 255) return;
    const cur = w.getBlock(x, y, z);
    if (cur !== 0 && !(T_REPL[cur] === 1)) { return; }
    if (T_FLUID[cur] && !T_REPL[cur]) return;
    // orientation / variants
    const yawDeg = ((p.yaw / DEG) % 360 + 360) % 360;
    const facingDir = yawDeg >= 315 || yawDeg < 45 ? 0 : yawDeg < 135 ? 1 : yawDeg < 225 ? 2 : 3;   // 0 looking south(+z) 1 west 2 north 3 east
    if (d0.slab) { meta = (face === 0 || (face >= 2 && fy > 0.5)) ? 1 : 0; if (face === 1) meta = 0; }
    else if (d0.stairs) {
      const asc = [3, 0, 2, 1][facingDir];   // stairs ascend away from the player: looking south(+z) -> high side south(+z)=2
      const dirMap = [2, 1, 3, 0];            // facingDir -> ascending side index (0 east,1 west,2 south,3 north)
      meta = dirMap[facingDir] | ((face === 0 || (face >= 2 && fy > 0.5)) ? 4 : 0);
    } else if (d0.torch) {
      if (face === 0) return;
      if (face === 1) { if (!(T_OPAQUE[w.getBlock(x, y - 1, z)] || BLOCKS[w.getBlock(x, y - 1, z)].fence || BLOCKS[w.getBlock(x, y - 1, z)].slab || BLOCKS[w.getBlock(x, y - 1, z)].wall)) return; meta = 0; }
      else meta = { 2: 4, 3: 3, 4: 2, 5: 1 }[face];   // face north(-z) => support at +z (4) etc.
    } else if (d0.climbable) { if (face < 2) return; meta = face; }
    else if (d0.gate) meta = facingDir;
    else if (d0.trapdoor) {
      if (face >= 2) meta = { 2: 0, 3: 2, 4: 3, 5: 1 }[face] | (fy > 0.5 ? 8 : 0);
      else meta = facingDir | (face === 0 ? 8 : 0);
    }
    else if (d0.log || d0.axis) meta = face <= 1 ? 0 : face <= 3 ? 2 : 1;
    else if (d0.orient) meta = [2, 5, 3, 4][facingDir];   // the front looks back at the player
    else if (d0.endFrame) meta = { 3: 0, 4: 1, 2: 2, 5: 3 }[[2, 5, 3, 4][facingDir]];
    else if (d0.lectern || d0.grindstone) meta = (facingDir + 2) & 3;
    else if (d0.bell) meta = facingDir & 1;
    else if (d0.endRod) meta = face === 1 ? 0 : face === 0 ? 1 : face;
    else if (d0.lantern) meta = face === 0 ? 1 : 0;
    else if (d0.leaves) meta = 8;
    else if (d0.name === 'snow_layer') meta = 0;
    // supports for plants
    if (!this.plantSupportOK(d0, x, y, z, meta)) return;
    // multi-block
    if (it.doorItem) { this.placeDoor(s, x, y, z, facingDir, it); return; }
    if (it.bedItem) { this.placeBed(s, x, y, z, facingDir); return; }
    if (d0.door) return;
    // entity collision
    if (T_SOLID[id] && this.blockCollidesPlayer(x, y, z, id, meta)) return;
    for (const e of this.entities) { if (!e.isMob || e.dead) continue; if (Math.abs(e.x - x - 0.5) < e.w / 2 + 0.5 && Math.abs(e.z - z - 0.5) < e.w / 2 + 0.5 && e.y < y + 1 && e.y + e.h > y && T_SOLID[id]) return; }
    w.setBlock(x, y, z, id, meta, 8);
    if (d0.spawner) w.blockEntity(x, y, z, () => ({ type: 'spawner', mob: 'pig', delay: 200 }));
    this.finishPlace(s, x, y, z, id);
    if (id === BID.carved_pumpkin || id === BID.jack_o_lantern) this.checkGolemBuild(x, y, z);
    if (d0.name === 'tnt') { }
  }
  plantSupportOK(d, x, y, z, meta) {
    const w = this.world;
    if (d.model === M_CROSS || d.cactus || d.lily || d.crop || d.layer || d.carpet || d.fire || d.chorus || d.endRod || d.lantern) return w.supportOK(x, y, z, d.id, meta);
    return true;
  }
  // vines attach to the clicked wall (or hang from a ceiling block); clicking an existing vine does nothing
  placeVine(t, s) {
    const w = this.world, tb = BLOCKS[t.id], face = t.face;
    if (tb.vine || face === 1) return;
    if (T_OPAQUE[t.id] !== 1 && !tb.leaves) return;
    const bit = { 0: 16, 2: 1, 3: 4, 4: 8, 5: 2 }[face];
    const x = t.x + DIRS[face][0], y = t.y + DIRS[face][1], z = t.z + DIRS[face][2];
    const cur = w.getBlock(x, y, z);
    let meta = bit;
    if (cur === BID.vine) meta |= w.getMeta(x, y, z);
    else if (cur !== 0 && !(T_REPL[cur] === 1 && !T_FLUID[cur])) return;
    if (meta === w.getMeta(x, y, z) && cur === BID.vine) return;
    w.setBlock(x, y, z, BID.vine, meta, 8);
    this.finishPlace(s, x, y, z, BID.vine);
  }
  finishPlace(s, x, y, z, id) {
    const p = this.player, d = BLOCKS[id];
    this.stat('placed', id);
    this.sound('dig.' + (d.sound || 'stone'), x + 0.5, y + 0.5, z + 0.5, 0.8, 0.8);
    p.swingArm();
    if (p.gameMode === 0) { s.n--; if (s.n <= 0) p.inv[p.sel] = null; }
  }
  placeDoor(s, x, y, z, facingDir, it) {
    const w = this.world;
    if (y > 253) return;
    if (!T_SOLID[w.getBlock(x, y - 1, z)] || (w.getBlock(x, y + 1, z) !== 0 && !T_REPL[w.getBlock(x, y + 1, z)])) return;
    if (w.getBlock(x, y, z) !== 0 && !T_REPL[w.getBlock(x, y, z)]) return;
    const dir = [1, 0, 3, 2][facingDir];   // closed door plane opposite the look direction; 0 west edge,1 north,2 east,3 south
    const meta = [1, 2, 3, 0][facingDir] & 3;
    w.setBlock(x, y, z, BID.oak_door, meta, 10); w.setBlock(x, y + 1, z, BID.oak_door, meta | 8, 10);   // 2 = defer neighbour updates until both halves exist
    w.notifyAround(x, y, z); w.notifyAround(x, y + 1, z);
    this.finishPlace(s, x, y, z, BID.oak_door);
  }
  placeBed(s, x, y, z, facingDir) {
    const w = this.world, dv = [[0, 1], [-1, 0], [0, -1], [1, 0]][facingDir], hx = x + dv[0], hz = z + dv[1];
    const okCell = (cx, cz) => { const b = w.getBlock(cx, y, cz); return (b === 0 || T_REPL[b]) && T_SOLID[w.getBlock(cx, y - 1, cz)]; };
    if (!okCell(x, z) || !okCell(hx, hz)) return;
    w.setBlock(x, y, z, BID.bed, facingDir, 10); w.setBlock(hx, y, hz, BID.bed, facingDir | 4, 10);
    w.notifyAround(x, y, z); w.notifyAround(hx, y, hz);
    this.finishPlace(s, x, y, z, BID.bed);
  }
  useBucket(s, it, t) {
    const p = this.player, w = this.world;
    const dir = [0, 0, 0]; lookDir(p.yaw, p.pitch, dir);
    const hit = w.raycast(p.x, p.y + p.eyeH, p.z, dir[0], dir[1], dir[2], this.reach(), true);
    if (!hit) return;
    if (it.bucket === 'empty') {
      if (T_FLUID[hit.id] && (hit.meta & 15) === 0) {
        const full = T_FLUID[hit.id] === 1 ? IID.water_bucket : IID.lava_bucket;
        w.setBlock(hit.x, hit.y, hit.z, 0, 0, 8); this.sound(T_FLUID[hit.id] === 1 ? 'liquid.water' : 'liquid.lava', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 1, 1, 'random.pop');
        if (p.gameMode === 0) { s.n--; const f = newStack(full, 1); if (s.n <= 0) p.inv[p.sel] = f; else if (!p.giveItem(f)) this.dropStackFromInventory(f); }
        p.swingArm();
      }
    } else if (it.bucket === 'water' || it.bucket === 'lava') {
      let x = hit.x, y = hit.y, z = hit.z;
      if (!(BLOCKS[hit.id].replaceable && !T_FLUID[hit.id]) && !T_FLUID[hit.id]) { x += DIRS[hit.face][0]; y += DIRS[hit.face][1]; z += DIRS[hit.face][2]; }
      const cur = w.getBlock(x, y, z);
      if (cur !== 0 && !T_REPL[cur] && !T_FLUID[cur]) return;
      const kind = it.bucket === 'water' ? 1 : 2;
      if (kind === 1 && p.y < 0) return;
      if (kind === 1 && this.dim === 'nether') {   // ultrawarm: water boils away
        this.sound('random.fizz', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6 + Math.random() * 0.8);
        for (let i = 0; i < 8; i++) this.particles.sprite('smoke', x + Math.random(), y + Math.random(), z + Math.random(), 1, { size: 0.16, up: 0.04, life: 24, shrink: true, r: 0.6, g: 0.6, b: 0.6 });
        if (p.gameMode === 0) p.inv[p.sel] = newStack(IID.bucket, 1);
        p.swingArm(); return;
      }
      w.fluidInto(x, y, z, kind, 0);
      this.sound(kind === 1 ? 'liquid.water' : 'liquid.lava', x + 0.5, y + 0.5, z + 0.5, 1, 1, 'liquid.splash');
      if (p.gameMode === 0) p.inv[p.sel] = newStack(IID.bucket, 1);
      p.swingArm();
    }
  }
  igniteTnt(x, y, z, fuse) {
    this.world.setBlock(x, y, z, 0, 0, 8); this.entities.push(new PrimedTnt(this, x, y, z, fuse || 80)); this.sound('random.fuse', x + 0.5, y + 0.5, z + 0.5, 1, 1);
  }
  useFlint(s, t) {
    const w = this.world, p = this.player, charge = !!ITEMS[s.id].charge;
    // flint and steel wears down; a fire charge is used up
    const spend = () => { if (charge) { if (p.gameMode === 0) { s.n--; if (s.n <= 0) p.inv[p.sel] = null; } this.sound('mob.ghast.fireball', p.x, p.y, p.z, 1, (Math.random() - Math.random()) * 0.2 + 1, 'fire.ignite'); } else { this.sound('fire.ignite', p.x, p.y, p.z, 1, 0.9 + Math.random() * 0.2); this.damageTool(s, 1); } p.swingArm(); };
    if (t.id === BID.tnt) { this.igniteTnt(t.x, t.y, t.z, 80); spend(); return; }
    // otherwise light the cell next to the clicked face (or the clicked cell if replaceable)
    let x = t.x, y = t.y, z = t.z;
    if (!(BLOCKS[t.id].replaceable && !T_FLUID[t.id])) { x += DIRS[t.face][0]; y += DIRS[t.face][1]; z += DIRS[t.face][2]; }
    const cur = w.getBlock(x, y, z);
    if (cur !== 0 && !(T_REPL[cur] && !T_FLUID[cur] && cur !== BID.fire && cur !== BID.soul_fire)) return;
    if (this.tryLightPortal(x, y, z)) { spend(); return; }      // anywhere inside an empty obsidian frame
    if (T_SOLID[w.getBlock(x, y - 1, z)] || w.canNeighborBurn(x, y, z)) {
      const below = w.getBlock(x, y - 1, z);
      w.setBlock(x, y, z, below === BID.soul_sand || below === BID.soul_soil ? BID.soul_fire : BID.fire, 0, 8);
      spend();
    }
  }
  // EndCrystalItem: on obsidian or bedrock with two free blocks above
  useEndCrystal(s, t) {
    const w = this.world, p = this.player;
    if ((t.id !== BID.obsidian && t.id !== BID.bedrock) || t.face !== 1) return;
    if (w.getBlock(t.x, t.y + 1, t.z) !== 0 || w.getBlock(t.x, t.y + 2, t.z) !== 0) return;
    for (const e of this.entities) if (e.isMob && !e.dead && Math.abs(e.x - t.x - 0.5) < 1 && Math.abs(e.z - t.z - 0.5) < 1 && e.y < t.y + 3 && e.y + e.h > t.y + 1) return;
    const c = this.spawnMob('end_crystal', t.x + 0.5, t.y + 1, t.z + 0.5); c.showBottom = false; c.persist = true;
    if (p.gameMode === 0) { s.n--; if (s.n <= 0) p.inv[p.sel] = null; }
    p.swingArm();
    if (this.dim === 'end') this.tryRespawnDragon();
  }
  // BellBlock: ring, swing the bell, send villagers home
  ringBell(t) {
    const w = this.world, be = w.blockEntity(t.x, t.y, t.z, () => ({ type: 'bell' }));
    be.ring = 50; be.ringDir = this.player.yaw;
    this.sound('block.bell.use', t.x + 0.5, t.y + 0.5, t.z + 0.5, 2, 1, 'random.anvil_land');
    this.player.swingArm(); this.stat('bell_rung');
    for (const e of this.entities) if (e.type === 'villager' && !e.dead && (e.x - t.x) ** 2 + (e.z - t.z) ** 2 < 48 * 48 && e.hearBell) e.hearBell();
  }
  // ComposterBlock: compostables raise the level by chance, level 8 gives bone meal
  useComposter(t) {
    const w = this.world, p = this.player, s = p.held(), lvl = t.meta & 15;
    if (lvl >= 8) {
      w.setBlock(t.x, t.y, t.z, BID.composter, 0, 8); this.spawnItem(t.x + 0.5, t.y + 1.1, t.z + 0.5, newStack(IID.bone_meal, 1), [0, 0.15, 0]);
      this.sound('block.composter.empty', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 1, 'dig.gravel'); p.swingArm(); return true;
    }
    if (lvl >= 7 || !s) return false;
    const n = ITEMS[s.id].name, ch = COMPOST_CHANCE[n]; if (ch === undefined) return false;
    if (p.gameMode === 0) { s.n--; if (s.n <= 0) p.inv[p.sel] = null; }
    const up = lvl === 0 || Math.random() < ch;
    if (up) { const nl = lvl + 1; w.setBlock(t.x, t.y, t.z, BID.composter, nl, 8); if (nl === 7) w.schedule(t.x, t.y, t.z, 20); }
    this.sound(up ? 'block.composter.fill_success' : 'block.composter.fill', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 1, 'dig.grass');
    for (let i = 0; i < 6; i++) this.particles.sprite('splash', t.x + 0.2 + Math.random() * 0.6, t.y + 0.4 + lvl * 0.07, t.z + 0.2 + Math.random() * 0.6, 1, { size: 0.05, up: 0.05, vel: 0.03, life: 10, grav: 0.02, spread: 0, spreadY: 0, r: 0.4, g: 0.75, b: 0.25 });
    p.swingArm(); return true;
  }
  // cauldron with buckets: fill it, or scoop it back out
  useCauldron(t) {
    const w = this.world, p = this.player, s = p.held(), it = s && ITEMS[s.id], lvl = t.meta & 3;
    if (it && it.bucket === 'water' && lvl < 3) { w.setBlock(t.x, t.y, t.z, BID.cauldron, 3, 8); if (p.gameMode === 0) p.inv[p.sel] = newStack(IID.bucket, 1); this.sound('liquid.water', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 1, 'liquid.splash'); p.swingArm(); return true; }
    if (it && it.bucket === 'empty' && lvl === 3) { w.setBlock(t.x, t.y, t.z, BID.cauldron, 0, 8); if (p.gameMode === 0) { s.n--; const f = newStack(IID.water_bucket, 1); if (s.n <= 0) p.inv[p.sel] = f; else if (!p.giveItem(f)) this.dropStackFromInventory(f); } this.sound('liquid.water', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 1, 'liquid.splash'); p.swingArm(); return true; }
    return false;
  }
  // DragonEggBlock.teleport: up to 1000 tries within 15 blocks sideways and 7 up/down
  teleportDragonEgg(x, y, z) {
    const w = this.world;
    for (let i = 0; i < 1000; i++) {
      const nx = x + ((Math.random() * 16) | 0) - ((Math.random() * 16) | 0), ny = y + ((Math.random() * 8) | 0) - ((Math.random() * 8) | 0), nz = z + ((Math.random() * 16) | 0) - ((Math.random() * 16) | 0);
      if (ny < 1 || ny > 250 || !w.isLoaded(nx, nz) || w.getBlock(nx, ny, nz) !== 0) continue;
      for (let k = 0; k < 64; k++) { const f = Math.random(); this.particles.sprite('portal', x + 0.5 + (nx - x) * f + (Math.random() - 0.5), y + 0.5 + (ny - y) * f + Math.random() - 0.5, z + 0.5 + (nz - z) * f + (Math.random() - 0.5), 1, { size: 0.07, up: 0, vel: 0.05, life: 20, shrink: true, spread: 0, spreadY: 0, r: 0.8, g: 0.35, b: 0.95 }); }
      w.setBlock(x, y, z, 0, 0, 8); w.setBlock(nx, ny, nz, BID.dragon_egg, 0, 8);
      return;
    }
  }
  // ChorusFruitItem: up to 16 tries to land within 8 blocks
  chorusTeleport() {
    const p = this.player, w = this.world;
    for (let i = 0; i < 16; i++) {
      const nx = p.x + (Math.random() - 0.5) * 16, nz = p.z + (Math.random() - 0.5) * 16; let ny = clamp(Math.floor(p.y + ((Math.random() * 16) | 0) - 8), 1, 250);
      const bx = Math.floor(nx), bz = Math.floor(nz); if (!w.isLoaded(bx, bz)) continue;
      while (ny > 1 && !T_SOLID[w.getBlock(bx, ny - 1, bz)]) ny--;
      if (!T_SOLID[w.getBlock(bx, ny - 1, bz)] || T_SOLID[w.getBlock(bx, ny, bz)] || T_SOLID[w.getBlock(bx, ny + 1, bz)] || T_FLUID[w.getBlock(bx, ny, bz)]) continue;
      this.sound('item.chorus_fruit.teleport', p.x, p.y, p.z, 1, 1, 'mob.enderman.teleport');
      p.x = p.px = bx + 0.5; p.y = p.py = ny; p.z = p.pz = bz + 0.5; p.vx = p.vy = p.vz = 0; p.fallDist = 0;
      this.sound('item.chorus_fruit.teleport', p.x, p.y, p.z, 1, 1, 'mob.enderman.teleport');
      return;
    }
  }
  useHoe(s, t) {
    const w = this.world;
    if ((t.id === BID.grass_block || t.id === BID.dirt || t.id === BID.grass_block_snowy) && w.getBlock(t.x, t.y + 1, t.z) === 0 && t.face !== 0) {
      w.setBlock(t.x, t.y, t.z, BID.farmland, 0, 8); this.sound('dig.gravel', t.x + 0.5, t.y + 1, t.z + 0.5, 0.8, 0.8); this.damageTool(s, 1); this.player.swingArm();
    }
  }
  useBoneMeal(s, t) {
    const w = this.world, d = BLOCKS[t.id];
    let used = false;
    if (d.sapling) { if (Math.random() < 0.45) w.growTree(t.x, t.y, t.z, d.sapling); used = true; }
    else if (d.wart) return;   // bone meal does nothing to nether wart
    else if (d.crop) { const m = Math.min(7, (t.meta & 7) + 2 + ((Math.random() * 3) | 0)); w.setBlock(t.x, t.y, t.z, t.id, m); used = true; }
    else if (d.fungus) {
      // FungusBlock: 40% per use, only on its own nylium
      const ny = w.getBlock(t.x, t.y - 1, t.z);
      if (ny !== (d.fungus === 'crimson' ? BID.crimson_nylium : BID.warped_nylium)) return;
      if (Math.random() < 0.4) {
        const list = []; SH.growFungus(w.seed, d.fungus, t.x, t.y, t.z, mulberry32(hash3(t.x, t.y, t.z, this.tick)), (x, y, z, id, m) => list.push([x, y, z, id, m | 0]));
        w.setBlock(t.x, t.y, t.z, 0, 0);
        for (const [x, y, z, id, m] of list) { const cur = w.getBlock(x, y, z); if (cur === 0 || T_REPL[cur] && !T_FLUID[cur]) w.setBlock(x, y, z, id, m); }
      }
      used = true;
    } else if (d.nylium) {
      // NyliumBlock: scatter roots and fungi over nearby nylium
      for (let i = 0; i < 24; i++) {
        const gx = t.x + ((Math.random() * 7) | 0) - 3, gz = t.z + ((Math.random() * 7) | 0) - 3, gy = t.y + ((Math.random() * 3) | 0) - 1;
        const b = w.getBlock(gx, gy, gz); if (!BLOCKS[b].nylium || w.getBlock(gx, gy + 1, gz) !== 0) continue;
        const crimson = b === BID.crimson_nylium, r = Math.random();
        w.setBlock(gx, gy + 1, gz, r < 0.1 ? (crimson ? BID.crimson_fungus : BID.warped_fungus) : crimson ? BID.crimson_roots : (r < 0.2 ? BID.warped_fungus : BID.warped_roots), 0);
      }
      used = true;
    }
    else if (t.id === BID.grass_block) {
      for (let i = 0; i < 18; i++) {
        const gx = t.x + ((Math.random() * 7) | 0) - 3, gz = t.z + ((Math.random() * 7) | 0) - 3;
        if (w.getBlock(gx, t.y, gz) === BID.grass_block && w.getBlock(gx, t.y + 1, gz) === 0) w.setBlock(gx, t.y + 1, gz, Math.random() < 0.08 ? [BID.dandelion, BID.poppy, BID.azure_bluet][(Math.random() * 3) | 0] : BID.short_grass, 0);
      }
      used = true;
    }
    if (used) { this.addParticles('heart', t.x + 0.5, t.y + 1.2, t.z + 0.5, 5); this.sound('random.pop', t.x, t.y, t.z, 0.5, 1.5); if (this.player.gameMode === 0) { s.n--; if (s.n <= 0) this.player.inv[this.player.sel] = null; } this.player.swingArm(); }
  }
  finishEating(s, it) {
    const p = this.player;
    p.eating = 0;
    if (p.gameMode === 0) { p.food = Math.min(20, p.food + it.food.h); p.sat = Math.min(p.food, p.sat + it.food.s); s.n--; if (s.n <= 0) p.inv[p.sel] = null; }
    if (it.name === 'rotten_flesh' && Math.random() < 0.8) { p.food = Math.max(0, p.food - 2); }
    if (it.name === 'golden_apple') { p.heal(4); }
    if (it.chorusFruit) this.chorusTeleport();
    this.sound('random.burp', p.x, p.y, p.z, 0.5, 0.9 + Math.random() * 0.2);
  }
  releaseUse() {
    const p = this.player;
    p.eating = 0;
    if (p.usingBow > 0) this.shootBow();
  }
  shootBow() {
    const p = this.player, s = p.held(); const t = p.usingBow; p.usingBow = 0;
    if (!s || !ITEMS[s.id].bow || t < 3) return;
    let ai = p.inv.findIndex(x => x && x.id === IID.arrow);
    if (ai < 0 && p.gameMode === 0) return;
    let power = t / 20; power = (power * power + power * 2) / 3; if (power > 1) power = 1; if (power < 0.1) return;
    const dir = [0, 0, 0]; lookDir(p.yaw, p.pitch, dir);
    const a = new Projectile(this, p.x, p.y + p.eyeH - 0.1, p.z, 'arrow', p);
    const sp = power * 3; a.vx = dir[0] * sp; a.vy = dir[1] * sp; a.vz = dir[2] * sp; a.dmg = 2; a.crit = power >= 1; a.pickable = p.gameMode === 0;
    this.entities.push(a); this.sound('random.bow', p.x, p.y, p.z, 1, 1 / (Math.random() * 0.4 + 1.2) + power * 0.5);
    if (p.gameMode === 0) { p.inv[ai].n--; if (p.inv[ai].n <= 0) p.inv[ai] = null; this.damageTool(s, 1); }
    p.swingArm();
  }
  throwItem(s, it) {
    const p = this.player; const dir = [0, 0, 0]; lookDir(p.yaw, p.pitch, dir);
    const b = new Projectile(this, p.x, p.y + p.eyeH - 0.1, p.z, it.throwable, p); b.vx = dir[0] * 1.5; b.vy = dir[1] * 1.5; b.vz = dir[2] * 1.5;
    this.entities.push(b); this.sound('random.bow', p.x, p.y, p.z, 0.5, 0.4 / (Math.random() * 0.4 + 0.8));
    if (p.gameMode === 0) { s.n--; if (s.n <= 0) p.inv[p.sel] = null; }
    p.swingArm();
  }
  // ------------------------------------------------------------ explosions
  explode(x, y, z, power, src, opts) {
    opts = opts || {};
    const w = this.world, set = opts.noBlocks ? new Set() : w.explode(x, y, z, power);
    this.sound('random.explode', x, y, z, 4, (1 + (Math.random() - Math.random()) * 0.2) * 0.7);
    this.addParticles('explosion', x, y, z, 6);
    this.addParticles('smoke', x, y, z, 20);
    // entities
    const r = power * 2;
    for (const e of [this.player, ...this.entities]) {
      if (!e || e.dead || e === src) continue;
      const dx = e.x - x, dy = (e.y + e.h / 2) - y, dz = e.z - z, d = Math.hypot(dx, dy, dz);
      if (d > r || d === 0) continue;
      if (e instanceof ItemEntity || e instanceof XPOrb) { if (d < r) e.dead = true; continue; }
      const imp = (1 - d / r) * this.exposure(x, y, z, e);
      const dmg = Math.floor((imp * imp + imp) / 2 * 7 * r + 1);
      if (e === this.player) { if (e.gameMode === 1) continue; e.hurt(dmg * (this.difficulty === 1 ? 0.5 : this.difficulty === 3 ? 1.5 : 1), null, 'explosion'); }
      else if (e.hurt) e.hurt(dmg, src, 'explosion');
      if (e instanceof PrimedTnt || e instanceof FallingBlock) {}
      const k = imp; e.vx += dx / d * k; e.vy += dy / d * k; e.vz += dz / d * k;
    }
    // blocks
    const tnts = [];
    for (const key of set) {
      const [bx, by, bz] = key.split(',').map(Number), id = w.getBlock(bx, by, bz);
      if (id === BID.tnt) { tnts.push([bx, by, bz]); w.setBlock(bx, by, bz, 0, 0, 2); continue; }
      const list = w.dropsFor(id, w.getMeta(bx, by, bz), null, Math.random);
      if (Math.random() < 1 / power * 1.0 || power < 1) for (const s of list) this.spawnItem(bx + 0.5, by + 0.5, bz + 0.5, s, null);
      if (BLOCKS[id].hasEntity) w.spillEntity(bx, by, bz);
      w.setBlock(bx, by, bz, 0, 0, 2 | 8);
    }
    // neighbours updates after mass removal
    for (const key of set) { const [bx, by, bz] = key.split(',').map(Number); w.notifyAround(bx, by, bz); }
    // Explosion.finalizeExplosion with fire: a third of the cleared cells above solid ground catch fire
    if (opts.fire) for (const key of set) { const [bx, by, bz] = key.split(',').map(Number); if (Math.random() < 1 / 3 && w.getBlock(bx, by, bz) === 0 && T_OPAQUE[w.getBlock(bx, by - 1, bz)]) w.igniteAt(bx, by, bz, 0); }
    for (const [bx, by, bz] of tnts) this.entities.push(new PrimedTnt(this, bx, by, bz, 10 + ((Math.random() * 20) | 0)));
    if (this.player && !this.player.dead) { const d = Math.hypot(this.player.x - x, this.player.z - z); if (d < 30) this.cameraShake = Math.max(this.cameraShake || 0, 8 * (1 - d / 30)); }
  }
  exposure(x, y, z, e) {
    let hit = 0, total = 0;
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) {
      const px = e.x - e.w / 2 + e.w * i / 2, py = e.y + e.h * j / 2, pz = e.z - e.w / 2 + e.w * k / 2, dx = px - x, dy = py - y, dz = pz - z, d = Math.hypot(dx, dy, dz);
      total++; if (!this.world.raycast(x, y, z, dx / d, dy / d, dz / d, d - 0.05, false)) hit++;
    }
    return hit / total;
  }
  // ------------------------------------------------------------ particles helper
  addParticles(kind, x, y, z, n, extra) {
    if (this.options.particles === 0) return;
    const P = this.particles;
    if (kind === 'smoke') P.sprite('smoke', x, y, z, n, { size: 0.16, up: 0.03, life: 30, shrink: true, r: 0.35, g: 0.35, b: 0.35 });
    else if (kind === 'flame') P.sprite('flame', x, y, z, n, { size: 0.1, up: 0.02, life: 12, shrink: true });
    else if (kind === 'splash') P.sprite('splash', x, y, z, n, { size: 0.09, up: 0.15, vel: 0.15, grav: 0.05, life: 14, drag: 0.9 });
    else if (kind === 'bubble') P.sprite('bubble', x, y, z, n, { size: 0.08, up: 0.06, life: 30, spread: 0.5 });
    else if (kind === 'crit') P.sprite('crit', x, y, z, n, { size: 0.12, up: 0.1, vel: 0.3, life: 14, grav: 0.02, spread: 0.4, r: 1, g: 0.9, b: 0.6 });
    else if (kind === 'heart') P.sprite('heart', x, y, z, n, { size: 0.14, up: 0.04, life: 22, spread: 0.6 });
    else if (kind === 'explosion') P.sprite('explosion', x, y, z, n, { size: 1.2, up: 0, vel: 0.08, life: 12, spread: 4, spreadY: 3, fade: true });
    else if (kind === 'item' && extra) { const it = ITEMS[extra]; if (it && it.blk > 0) this.particles.block(Math.floor(x), Math.floor(y), Math.floor(z), it.blk, n, 0.3); }
  }
  // ------------------------------------------------------------ mob loot & spawning
  dropMobLoot(m) {
    const t = m.type, r = Math.random, N = (a, b) => a + Math.floor(r() * (b - a + 1)), L = [];
    const burning = m.fireTicks > 0;
    // loot tables declared on the mob definition: [item, min, max, chance, cooked variant]
    if (m.def.loot) for (const e of m.def.loot) { if (e[3] !== undefined && r() > e[3]) continue; L.push([burning && e[4] ? e[4] : e[0], N(e[1], e[2])]); }
    if (t === 'pig') L.push([burning ? 'cooked_porkchop' : 'porkchop', N(1, 3)]);
    else if (t === 'cow') { L.push([burning ? 'cooked_beef' : 'beef', N(1, 3)]); L.push(['leather', N(0, 2)]); }
    else if (t === 'sheep') { if (!m.sheared) L.push([SHEEP_WOOL_NAMES[m.woolIdx || 0] + '_wool', 1]); L.push([burning ? 'cooked_mutton' : 'mutton', N(1, 2)]); }
    else if (t === 'chicken') { L.push(['feather', N(0, 2)]); L.push([burning ? 'cooked_chicken' : 'chicken', 1]); }
    else if (t === 'zombie') { L.push(['rotten_flesh', N(0, 2)]); if (r() < 0.025) L.push([['iron_ingot', 'carrot', 'potato'][N(0, 2)], 1]); }
    else if (t === 'skeleton') { L.push(['bone', N(0, 2)]); L.push(['arrow', N(0, 2)]); }
    else if (t === 'creeper') L.push(['gunpowder', N(0, 2)]);
    else if (t === 'spider') { L.push(['string', N(0, 2)]); if (r() < 0.33) L.push(['spider_eye', 1]); }
    else if (t === 'enderman') L.push(['ender_pearl', N(0, 1)]);
    else if (t === 'slime') { if (m.size === 1) L.push(['slime_ball', N(0, 2)]); }
    else if (t === 'squid') L.push(['ink_sac', N(1, 3)]);
    for (const [n, c] of L) if (c > 0 && IID[n]) this.spawnItem(m.x, m.y + 0.4, m.z, newStack(IID[n], c), null);
  }
  spawnMob(type, x, y, z) { const m = makeMob(this, type, x, y, z); this.entities.push(m); return m; }
  spawnTick() {
    const w = this.world, p = this.player;
    // mobs from freshly generated chunks (animals, villagers, golems) and persistent mobs saved with a chunk
    for (const c of w.chunks.values()) {
      if (c.state < 2 || c.spawnDone) continue;
      c.spawnDone = true;
      if (c.spawns && !c.fromSave) for (const s of c.spawns) {
        if (!MOB_DEFS[s[0]]) continue;
        const bx = Math.floor(s[1]), sy = s[2], bz = Math.floor(s[3]), gb = w.getBlock(bx, sy - 1, bz), fb = w.getBlock(bx, sy, bz);
        if (T_SOLID[fb] || T_FLUID[fb] || !T_SOLID[gb] || BLOCKS[gb].leaves) continue;
        const m = this.spawnMob(s[0], s[1], sy, s[3]);
        if (s[4] && m.applySpawnData) m.applySpawnData(s[4]);
      }
      c.spawns = null;
      if (c.ents) this.restoreChunkEntities(c);
    }
    if (this.tick % 20 !== 0) return;
    if (this.dim === 'nether') { this.spawnNether(); return; }
    if (this.dim === 'end') { this.spawnEnd(); return; }
    const hostiles = this.entities.filter(e => e.isMob && e.def.hostile && !e.dead).length;
    if (this.difficulty > 0 && hostiles < 24) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const a = Math.random() * TAU, d = 24 + Math.random() * 40, x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
        if (!w.isLoaded(x, z)) continue;
        const ymin = Math.max(1, Math.floor(p.y) - 16), ymax = Math.min(250, Math.floor(p.y) + 16);
        const y = ymin + Math.floor(Math.random() * (ymax - ymin));
        if (!(T_SOLID[w.getBlock(x, y - 1, z)] && !BLOCKS[w.getBlock(x, y - 1, z)].leaves) || w.getBlock(x, y, z) !== 0 || w.getBlock(x, y + 1, z) !== 0 || T_FLUID[w.getBlock(x, y - 1, z)]) continue;
        const sk = w.getSky(x, y, z), bk = w.getBlk(x, y, z);
        const night = !this.isDay;
        const dark = (night ? Math.max(0, sk - 11) : sk) <= 7 && bk === 0 || (sk <= 7 && bk === 0);
        const skyDarkOK = sk <= 7 || (night && sk - 11 <= 7);
        if (!(skyDarkOK && bk === 0)) continue;
        if ((x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2 < 24 * 24) continue;
        const r = Math.random(); let type = r < 0.42 ? 'zombie' : r < 0.72 ? 'skeleton' : r < 0.9 ? 'creeper' : 'spider';
        if (Math.random() < 0.03) type = 'enderman';
        if (y < 40 && hash3(x >> 4, z >> 4, 987234911, w.seed) % 10 === 0 && Math.random() < 0.3) type = 'slime';
        else if (w.getBiome(x, z) === BIO.swamp && this.isDay === false && y >= SEA - 12 && y <= SEA + 6 && Math.random() < 0.35) type = 'slime';
        this.spawnMob(type, x + 0.5, y, z + 0.5);
        break;
      }
    }
    // bats fill dark caves
    if (p.y < 60 && Math.random() < 0.15) {
      let bats = 0; for (const e of this.entities) if (e.isMob && e.type === 'bat' && !e.dead) bats++;
      if (bats < 6) {
        const bx = Math.floor(p.x + (Math.random() - 0.5) * 24), bz = Math.floor(p.z + (Math.random() - 0.5) * 24), by = Math.floor(p.y + (Math.random() - 0.5) * 10);
        if (w.isLoaded(bx, bz) && w.getBlock(bx, by, bz) === 0 && w.getBlock(bx, by + 1, bz) === 0 && w.getSky(bx, by, bz) === 0 && w.getBlk(bx, by, bz) <= 4 && (bx + 0.5 - p.x) ** 2 + (bz + 0.5 - p.z) ** 2 > 100) this.spawnMob('bat', bx + 0.5, by, bz + 0.5);
      }
    }
    // squid drift in water between sea level -17 and -1 (oceans, rivers, lakes)
    if (Math.random() < 0.08) {
      let squids = 0; for (const e of this.entities) if (e.isMob && e.type === 'squid' && !e.dead) squids++;
      if (squids < 8) {
        const a = Math.random() * TAU, d = 14 + Math.random() * 40, x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d), y = SEA - 2 - ((Math.random() * 14) | 0);
        if (w.isLoaded(x, z) && T_FLUID[w.getBlock(x, y, z)] === 1 && T_FLUID[w.getBlock(x, y + 1, z)] === 1 && T_FLUID[w.getBlock(x, y - 1, z)] === 1) {
          const n = 1 + ((Math.random() * 3) | 0);
          for (let i = 0; i < n; i++) { const sx = x + ((Math.random() * 3) | 0) - 1, sz = z + ((Math.random() * 3) | 0) - 1; if (w.isLoaded(sx, sz) && T_FLUID[w.getBlock(sx, y, sz)] === 1 && T_FLUID[w.getBlock(sx, y + 1, sz)] === 1) this.spawnMob('squid', sx + 0.5, y, sz + 0.5); }
        }
      }
    }
    // passive respawn during the day near the player on grass
    const passives = this.entities.filter(e => e.isMob && e.def.passive && !e.dead).length;
    if (passives < 16 && this.isDay && Math.random() < 0.05) {
      const a = Math.random() * TAU, d = 24 + Math.random() * 30, x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
      if (w.isLoaded(x, z)) { const h = w.topSolidY(x, z); if (h >= SEA && w.getBlock(x, h, z) === BID.grass_block && w.getSky(x, h + 1, z) >= 12) this.spawnMob(['pig', 'cow', 'sheep', 'chicken'][(Math.random() * 4) | 0], x + 0.5, h + 1, z + 0.5); }
    }
  }
  // ------------------------------------------------------------ dungeon loot and monster spawners
  fillChestLoot(be) {
    if (be.loot === undefined) return;
    const rnd = mulberry32(be.loot | 0), LT = be.table && LOOT_TABLES[be.table];
    const T = LT ? LT.items : [['iron_ingot', 1, 4, 10], ['bread', 1, 1, 10], ['wheat', 1, 4, 10], ['gunpowder', 1, 4, 10], ['string', 1, 4, 10], ['bucket', 1, 1, 10], ['golden_apple', 1, 1, 1], ['redstone', 1, 4, 10],
      ['melon_seeds', 2, 4, 10], ['pumpkin_seeds', 2, 4, 10], ['bone', 1, 4, 10], ['coal', 1, 4, 10], ['gold_ingot', 1, 2, 5], ['iron_pickaxe', 1, 1, 2], ['iron_sword', 1, 1, 2], ['apple', 1, 3, 5]];
    let tot = 0; for (const e of T) tot += e[3];
    if (!be.items) be.items = new Array(27).fill(null);
    if (LT && LT.fixed) { const SLOTS = [13, 12, 14, 4, 22, 3, 5, 21]; LT.fixed.forEach((e, i) => { const id = IID[e[0]]; if (id !== undefined) be.items[i < SLOTS.length ? SLOTS[i] : i] = newStack(id, e[1]); }); delete be.loot; return; }
    const rolls = LT ? LT.rolls[0] + ((rnd() * (LT.rolls[1] - LT.rolls[0] + 1)) | 0) : 8;
    for (let i = 0; i < rolls; i++) {
      let r = rnd() * tot, e = T[0]; for (const t of T) { r -= t[3]; if (r <= 0) { e = t; break; } }
      const id = IID[e[0]]; if (id === undefined) continue;
      be.items[(rnd() * 27) | 0] = newStack(id, e[1] + ((rnd() * (e[2] - e[1] + 1)) | 0));
    }
    delete be.loot;
  }
  tickSpawners() {
    const w = this.world, p = this.player; if (p.dead) return;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = w.getChunk(pcx + dx, pcz + dz); if (!c || !c.be.size || c.state < 2) continue;
      for (const [k, be] of c.be) {
        if (be.type !== 'spawner') continue;
        const y = k >> 8, x = (c.cx << 4) + (k & 15), z = (c.cz << 4) + ((k >> 4) & 15);
        if ((p.x - x - 0.5) ** 2 + (p.y - y - 0.5) ** 2 + (p.z - z - 0.5) ** 2 > 256) continue;
        if (w.getBlock(x, y, z) !== BID.spawner) continue;
        if ((this.tick & 1) === 0 && this.options.particles !== 0) {
          const q = this.particles;
          q.sprite('smoke', x + Math.random(), y + Math.random(), z + Math.random(), 1, { size: 0.09, up: 0.02, life: 18, shrink: true, spread: 0, spreadY: 0, vel: 0.004, r: 0.25, g: 0.25, b: 0.25 });
          q.sprite('flame', x + Math.random(), y + Math.random(), z + Math.random(), 1, { size: 0.06, up: 0.01, life: 10, shrink: true, spread: 0, spreadY: 0, vel: 0.004 });
        }
        be.spin = (be.spin || 0); be.pspin = be.spin; be.spin += 1000 / ((be.delay || 200) + 200);
        if (be.delay === undefined) be.delay = 200;
        if (--be.delay > 0) continue;
        be.delay = 200 + ((Math.random() * 600) | 0);
        if (this.difficulty === 0 && MOB_DEFS[be.mob] && MOB_DEFS[be.mob].hostile) continue;
        let near = 0;
        for (const e of this.entities) if (e.isMob && e.type === be.mob && !e.dead && Math.abs(e.x - x) < 8 && Math.abs(e.z - z) < 8 && Math.abs(e.y - y) < 4) near++;
        if (near >= 6) continue;
        for (let i = 0; i < 4; i++) {
          const sx = x + 0.5 + (Math.random() - 0.5) * 8, sy = y + ((Math.random() * 3) | 0) - 1, sz = z + 0.5 + (Math.random() - 0.5) * 8;
          const bx = Math.floor(sx), bz = Math.floor(sz);
          if (T_SOLID[w.getBlock(bx, sy, bz)] || T_SOLID[w.getBlock(bx, sy + 1, bz)] || T_FLUID[w.getBlock(bx, sy, bz)] || !T_SOLID[w.getBlock(bx, sy - 1, bz)]) continue;
          const lk = Math.max(w.getBlk(bx, sy, bz), this.isDay ? w.getSky(bx, sy, bz) : Math.max(0, w.getSky(bx, sy, bz) - 11));
          if (MOB_DEFS[be.mob] && MOB_DEFS[be.mob].hostile && lk > ((Math.random() * 8) | 0)) continue;
          this.spawnMob(be.mob, sx, sy, sz);
          this.addParticles('smoke', sx, sy + 0.5, sz, 8); this.addParticles('flame', sx, sy + 0.5, sz, 6);
        }
        c.modified = true;
      }
    }
  }
  // the little mob spinning inside each nearby spawner cage
  renderSpawners(partial, cx, cy, cz) {
    const r = this.renderer, w = this.world, p = this.player;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = w.getChunk(pcx + dx, pcz + dz); if (!c || !c.be.size) continue;
      for (const [k, be] of c.be) {
        if (be.type !== 'spawner' || !MOB_DEFS[be.mob]) continue;
        const y = k >> 8, x = (c.cx << 4) + (k & 15), z = (c.cz << 4) + ((k >> 4) & 15);
        if ((cx - x - 0.5) ** 2 + (cy - y - 0.5) ** 2 + (cz - z - 0.5) ** 2 > 256) continue;
        const proxy = this._spawnProxy || (this._spawnProxy = { limbAmt: 0, limbPos: 0, age: 0, headYawRel: 0, headPitchRel: 0, hurtTime: 0, deathTime: 0, swingProgress: 0 });
        const sp = (be.pspin || 0) + ((be.spin || 0) - (be.pspin || 0)) * partial;
        proxy.x = proxy.px = x + 0.5; proxy.y = proxy.py = y + 0.2; proxy.z = proxy.pz = z + 0.5;
        proxy.bodyYaw = proxy.pbodyYaw = sp * DEG; proxy.age = this.tick;
        proxy.lightAt = () => [w.getSky(x, y + 1, z), w.getBlk(x, y, z)];
        drawModel(r, proxy, MODELS[MOB_DEFS[be.mob].model], partial, cx, cy, cz, { scale: 0.4375, fullbright: false });
      }
    }
  }
  // ------------------------------------------------------------ furnaces
  tickFurnaces() {
    const w = this.world, p = this.player;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      const c = w.getChunk(pcx + dx, pcz + dz); if (!c || !c.be.size) continue;
      for (const [k, be] of c.be) {
        if (be.type !== 'furnace') continue;
        const x = (c.cx << 4) + (k & 15), z = (c.cz << 4) + ((k >> 4) & 15), y = k >> 8;
        const inp = be.input, out = be.output, bid0 = w.getBlock(x, y, z), kind = BLOCKS[bid0].furnaceKind || be.kind || null;
        // smokers only cook food, blast furnaces only smelt ores and metal; both work twice as fast
        const fits = !inp ? false : kind === 'smoker' ? !!ITEMS[inp.id].food : kind === 'blast' ? /_ore$|^raw_|^iron_|^golden_|^gold_/.test(ITEMS[inp.id].name) && !ITEMS[inp.id].food : true;
        const res = inp && fits ? SMELT[inp.id] : 0, cookTime = kind ? 100 : 200; be.cookTime = cookTime;
        const canSmelt = !!(inp && res && (!out || (out.id === res && out.n < stackMax(res))));
        let dirty = false;
        if (be.burn > 0) { be.burn--; }
        if (be.burn <= 0 && canSmelt && be.fuel) {
          const ft = FUEL[be.fuel.id]; if (ft) { be.burn = be.burnMax = ft; be.fuel.n--; if (be.fuel.n <= 0) { if (ITEMS[be.fuel.id].name === 'lava_bucket') be.fuel = newStack(IID.bucket, 1); else be.fuel = null; } dirty = true; }
        }
        if (be.burn > 0 && canSmelt) { be.cook = (be.cook || 0) + 1; if (be.cook >= cookTime) { be.cook = 0; be.xp = (be.xp || 0) + (SMELT_XP[res] || 0.1); if (out) out.n++; else be.output = newStack(res, 1); inp.n--; if (inp.n <= 0) be.input = null; dirty = true; this.player.addXP && 0; } }
        else if (be.cook > 0) be.cook = Math.max(0, be.cook - 2);
        const bid = bid0, lit = be.burn > 0, LIT = FURNACE_LIT[bid], UNLIT = FURNACE_UNLIT[bid];
        if (LIT !== undefined && lit) w.setBlock(x, y, z, LIT, w.getMeta(x, y, z));
        else if (UNLIT !== undefined && !lit) w.setBlock(x, y, z, UNLIT, w.getMeta(x, y, z));
        if (lit && this.tick % 40 === 0) this.sound('fire.fire', x + 0.5, y + 0.5, z + 0.5, 0.4, 1);
        c.modified = true;
      }
    }
  }
  // ------------------------------------------------------------ death / respawn
  onPlayerDeath(src, kind) {
    const p = this.player;
    this.stat('deaths'); if (src && src.type) this.stat('killedBy', src.type);
    // an open container gives its cursor stack / crafting grid back first, so those items drop with the rest of the inventory
    if (this.screen && this.screen.onClose) { this.screen.onClose(true); this.screen = null; }
    if (p.gameMode === 0) {
      for (let i = 0; i < 36; i++) if (p.inv[i]) { this.spawnItem(p.x, p.y + 0.5, p.z, p.inv[i], [(Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4]); p.inv[i] = null; }
      for (let i = 0; i < 4; i++) if (p.armor[i]) { this.spawnItem(p.x, p.y + 0.5, p.z, p.armor[i], null); p.armor[i] = null; }
      const xp = Math.min(p.level * 7, 100); if (xp > 0) this.entities.push(new XPOrb(this, p.x, p.y + 0.5, p.z, xp));
    }
    p.eating = 0; p.usingBow = 0; this.breaking = null;
    this.openScreen(new DeathScreen(this, p.score));
    this.unlockPointer();
  }
  respawn() {
    const p = this.player, w = this.world;
    const sp = p.spawn || this.spawnPoint;
    if (this.dim !== 'overworld') {   // death in the Nether or the End: back to the Overworld spawn
      p.dead = false; p.health = 20; p.food = 20; p.sat = 5; p.air = 300; p.fireTicks = 0; p.invuln = 20; p.hurtTime = 0;
      p.xp = 0; p.level = 0; p.xpProg = 0; p.score = 0; p.witherT = 0;
      this.screen = null; this.changeDimension('overworld', { kind: 'respawn', x: sp.x, y: sp.y, z: sp.z });
      return;
    }
    // find a safe height: keep the spawn height when there is room, climb out of blocks otherwise, else use the surface
    let y = sp.y; const bx = Math.floor(sp.x), bz = Math.floor(sp.z);
    if (w.isLoaded(bx, bz)) {
      let yy = Math.max(1, Math.floor(sp.y)); const y0 = yy;
      while (yy < 250 && (T_SOLID[w.getBlock(bx, yy, bz)] || T_SOLID[w.getBlock(bx, yy + 1, bz)])) yy++;
      while (yy > 1 && !T_SOLID[w.getBlock(bx, yy - 1, bz)]) yy--;
      if (yy - y0 <= 24 && yy < 250) y = yy;
      else for (let sy2 = 250; sy2 > 0; sy2--) { const b = w.getBlock(bx, sy2, bz); if (b && T_SOLID[b] && !BLOCKS[b].leaves) { y = sy2 + 1; break; } }
    }
    p.dead = false; p.health = 20; p.food = 20; p.sat = 5; p.air = 300; p.x = p.px = sp.x; p.y = p.py = y; p.z = p.pz = sp.z; p.vx = p.vy = p.vz = 0; p.fallDist = 0; p.fireTicks = 0; p.invuln = 20;
    p.xp = 0; p.level = 0; p.xpProg = 0; p.score = 0; p.hurtTime = 0;
    this.closeScreen();
  }
  // ------------------------------------------------------------ commands
  runCommand(line) {
    const args = line.trim().replace(/^\//, '').split(/\s+/), cmd = args.shift().toLowerCase(), p = this.player, w = this.world;
    const say = s => this.addChat(s);
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const num = (s, cur) => { if (s === undefined) return NaN; if (s[0] === '~') return cur + (s.length > 1 ? parseFloat(s.slice(1)) : 0); return parseFloat(s); };
    switch (cmd) {
      case 'help': case '?': say('§eCommands: /gamemode /time /tp /give /summon /kill /weather /difficulty /seed /setblock /clear /xp /heal /spawnpoint /fill /locate /dimension'); break;
      case 'locate': {
        const kind = (args[0] === 'structure' ? args[1] : args[0] || '').replace('minecraft:', '').toLowerCase();
        const K = { village: 'village', stronghold: 'stronghold', fortress: 'fortress', nether_fortress: 'fortress' }[kind];
        if (!K) { say('§cUsage: /locate <village|stronghold|fortress>'); break; }
        if ((K === 'fortress') !== (this.dim === 'nether') || this.dim === 'end') { say('§cCould not find a structure of type "' + kind + '" nearby'); break; }
        const s = SH.locateStructure(w.seed, K, p.x, p.z, 4000);
        if (!s) { say('§cCould not find a structure of type "' + kind + '" nearby'); break; }
        say('The nearest ' + kind + ' is at [' + s.x + ', ' + (s.y !== undefined ? '~' : '~') + ', ' + s.z + '] (' + Math.round(Math.hypot(s.x - p.x, s.z - p.z)) + ' blocks away)'); break;
      }
      case 'dimension': case 'dim': {
        const D = { overworld: 'overworld', nether: 'nether', the_nether: 'nether', end: 'end', the_end: 'end' }, to = D[(args[0] || '').replace('minecraft:', '').toLowerCase()];
        if (!to) { say('§cUsage: /dimension <overworld|the_nether|the_end>'); break; }
        if (to === this.dim) { say('Already in ' + DIM_NAME[to]); break; }
        if (to === 'end') this.changeDimension('end', { kind: 'end_platform', x: END_SPAWN.x + 0.5, y: END_SPAWN.y, z: END_SPAWN.z + 0.5, yaw: Math.PI / 2 });
        else { const sc = to === 'nether' ? 0.125 : this.dim === 'nether' ? 8 : 1; this.changeDimension(to, { kind: 'command', x: Math.floor(p.x * sc) + 0.5, y: to === 'nether' ? 64 : 80, z: Math.floor(p.z * sc) + 0.5 }); }
        say('Travelling to ' + DIM_NAME[to]); break;
      }
      case 'gamemode': case 'gm': {
        const m = (args[0] || '').toLowerCase(); const mode = m === 'creative' || m === 'c' || m === '1' ? 1 : m === 'survival' || m === 's' || m === '0' ? 0 : -1;
        if (mode < 0) { say('§cUsage: /gamemode <survival|creative>'); break; }
        p.gameMode = mode; if (mode === 0) { p.flying = false; } say('Set own game mode to ' + (mode ? 'Creative Mode' : 'Survival Mode')); break;
      }
      case 'time': {
        if (args[0] === 'set') { const v = args[1]; let t = v === 'day' ? 1000 : v === 'noon' ? 6000 : v === 'night' ? 13000 : v === 'midnight' ? 18000 : parseInt(v); if (isNaN(t)) { say('§cInvalid time'); break; } this.time = Math.floor(this.time / 24000) * 24000 + (t % 24000); say('Set the time to ' + t); }
        else if (args[0] === 'add') { const t = parseInt(args[1]); if (Number.isFinite(t)) { this.time += clamp(t, -1e7, 1e7); say('Added ' + t + ' to the time'); } }
        else say('§cUsage: /time set <value>'); break;
      }
      case 'tp': case 'teleport': {
        const x = num(args[0], p.x), y = num(args[1], p.y), z = num(args[2], p.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { say('§cUsage: /tp <x> <y> <z>'); break; }
        if (Math.abs(x) > 3e7 || Math.abs(z) > 3e7 || y < -64 || y > 1000) { say('§cThat position is out of bounds'); break; }
        p.x = p.px = x; p.y = p.py = y; p.z = p.pz = z; p.vx = p.vy = p.vz = 0; p.fallDist = 0; say('Teleported to ' + x.toFixed(2) + ', ' + y.toFixed(2) + ', ' + z.toFixed(2)); break;
      }
      case 'give': {
        let name = (args[0] || '').replace('minecraft:', ''), n = parseInt(args[1] || '1');
        if (name === '@s' || name === '@p') { name = (args[1] || '').replace('minecraft:', ''); n = parseInt(args[2] || '1'); }
        if (!own(IID, name)) { say('§cUnknown item: ' + name); break; }
        n = clamp(n || 1, 1, 2304); let left = n; while (left > 0) { const c = Math.min(left, stackMax(IID[name])); const s = newStack(IID[name], c); if (!p.giveItem(s)) this.dropStackFromInventory(s); left -= c; }
        say('Gave ' + n + ' [' + ITEMS[IID[name]].disp + ']'); break;
      }
      case 'summon': {
        const t = (args[0] || '').replace('minecraft:', ''); if (!own(MOB_DEFS, t)) { say('§cUnknown entity: ' + t); break; }
        const dir = [0, 0, 0]; lookDir(p.yaw, 0, dir); this.spawnMob(t, p.x + dir[0] * 2, p.y, p.z + dir[2] * 2); say('Summoned ' + t); break;
      }
      case 'kill': { let n = 0; for (const e of this.entities) if (e.isMob && !e.dead) { e.hp = 0; e.die(p, 'player'); n++; } say('Killed ' + n + ' entities'); break; }
      case 'weather': { const v = args[0]; if (v === 'clear') { this.weather.target = 0; this.weather.timer = 100000; } else if (v === 'rain' || v === 'thunder') { this.weather.target = 1; this.weather.thunder = v === 'thunder'; this.weather.timer = 12000; } else { say('§cUsage: /weather <clear|rain|thunder>'); break; } say('Changed the weather to ' + v); break; }
      case 'difficulty': { const D = { peaceful: 0, easy: 1, normal: 2, hard: 3 }, key = (args[0] || '').toLowerCase(); if (!own(D, key)) { say('§cUsage: /difficulty <peaceful|easy|normal|hard>'); break; } this.difficulty = D[key]; say('The difficulty has been set to ' + args[0]); break; }
      case 'seed': say('Seed: [' + (this.worldInfo ? this.worldInfo.seedStr : w.seed) + ']'); break;
      case 'setblock': { const x = num(args[0], Math.floor(p.x)), y = num(args[1], Math.floor(p.y)), z = num(args[2], Math.floor(p.z)); const b = (args[3] || '').replace('minecraft:', ''); if (!own(BID, b)) { say('§cUnknown block: ' + b); break; } if (![x, y, z].every(Number.isFinite) || Math.abs(x) > 3e7 || Math.abs(z) > 3e7) { say('§cInvalid position'); break; } w.setBlock(Math.floor(x), Math.floor(y), Math.floor(z), BID[b], 0, 8); say('Changed the block'); break; }
      case 'fill': {
        const c = [0, 1, 2, 3, 4, 5].map(i => num(args[i], [p.x, p.y, p.z][i % 3])), b = (args[6] || '').replace('minecraft:', '');
        if (!c.every(Number.isFinite) || !own(BID, b) || c.some(v => Math.abs(v) > 3e7)) { say('§cUsage: /fill x1 y1 z1 x2 y2 z2 block'); break; }
        const [x0, y0, z0, x1, y1, z1] = [Math.min(c[0], c[3]), Math.min(c[1], c[4]), Math.min(c[2], c[5]), Math.max(c[0], c[3]), Math.max(c[1], c[4]), Math.max(c[2], c[5])].map(Math.floor);
        if (!((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) <= 32768)) { say('§cToo many blocks'); break; }
        let n = 0; for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (w.setBlock(x, y, z, BID[b], 0, 8)) n++;
        say(n + ' blocks filled'); break;
      }
      case 'clear': for (let i = 0; i < 36; i++) p.inv[i] = null; say('Cleared inventory'); break;
      case 'xp': { const n = parseInt(args[0]); if (Number.isFinite(n)) { const v = clamp(n, 0, 100000); p.addXP(v); say('Gave ' + v + ' experience points'); } else say('§cUsage: /xp <amount>'); break; }
      case 'heal': p.health = 20; p.food = 20; say('Healed'); break;
      case 'spawnpoint': p.spawn = { x: p.x, y: p.y, z: p.z }; this.spawnPoint = { x: p.x, y: p.y, z: p.z }; say('Set spawn point to ' + Math.floor(p.x) + ', ' + Math.floor(p.y) + ', ' + Math.floor(p.z)); break;
      default: say('§cUnknown command. Type /help for a list of commands.');
    }
  }

  // ------------------------------------------------------------ rendering
  computeEnv() {
    const r = this.renderer, e = r.env, W = this.weather, tod = ((this.state === 'play' || this.state === 'loading') ? this.time : this.panoT * 2 + 3000) % 24000;
    const ang = (tod / 24000 - 0.25) * TAU;
    const c = Math.cos(ang);
    const bright = clamp(c * 2 + 0.5, 0, 1);
    const rain = W.rain;
    const zen = [0.47, 0.65, 1.0], hor = [0.75, 0.85, 1.0];
    const gray = 0.62 + 0.38 * (1 - rain * 0.75);
    e.zenith = zen.map((v, i) => { const base = v * bright * (1 - rain * 0.55) + [0.35, 0.37, 0.43][i] * rain * bright * 0.7; return base; });
    e.horizon = hor.map((v, i) => { const base = (v * bright) * (1 - rain * 0.4) + [0.5, 0.52, 0.56][i] * rain * bright * 0.6; return Math.max(base, [0.01, 0.012, 0.03][i]); });
    // night colours never fully black
    for (let i = 0; i < 3; i++) { e.zenith[i] = Math.max(e.zenith[i], [0.004, 0.005, 0.012][i]); }
    e.sunDir = [-Math.sin(ang), Math.cos(ang), 0.0];
    e.rot = ang; e.starAlpha = clamp(1 - bright * 2.2, 0, 1) * (1 - rain);
    // sunrise/sunset glow
    const g = 1 - Math.abs(c) / 0.4;
    e.glow = g > 0 ? g * g * 0.95 * (1 - rain * 0.7) : 0;
    e.glowColor = [0.7 + 0.3 * Math.max(g, 0), 0.2 + 0.5 * Math.max(g, 0) ** 2, 0.2];
    // light
    const sl = 0.15 + 0.85 * clamp(c * 1.6 + 0.55, 0, 1) ** 1.2;
    e.skyLight = sl * (1 - rain * 0.25);
    const nb = 1 - clamp(c * 1.6 + 0.55, 0, 1);
    e.skyTint = [1 - nb * 0.42, 1 - nb * 0.4, 1 - nb * 0.08];
    e.gamma = this.options.gamma;
    e.moonPhase = ((this.day % 8) + 8) % 8;
    e.rain = rain;
    const cl = 0.32 + 0.68 * bright;
    e.cloudColor = [cl * (1 - rain * 0.3) * (1 + 0.0 * g), cl * (1 - rain * 0.3), cl * (1 - rain * 0.25)];
    if (g > 0 && bright > 0.05) { e.cloudColor[0] *= 1 + g * 0.2; e.cloudColor[1] *= 1 - g * 0.25; e.cloudColor[2] *= 1 - g * 0.4; }
    const th = W.thunderLevel * rain;
    if (th > 0.001) {
      const k = 1 - th * 0.5; for (let i = 0; i < 3; i++) { e.zenith[i] *= k; e.horizon[i] *= k; e.cloudColor[i] *= 1 - th * 0.4; }
      e.skyLight *= 1 - th * 0.3; e.glow *= 1 - th;
    }
    if (W.flash > 0) {
      const f = W.flash / 3; for (let i = 0; i < 3; i++) { e.zenith[i] += (0.95 - e.zenith[i]) * 0.75 * f; e.horizon[i] += (0.95 - e.horizon[i]) * 0.75 * f; }
      e.skyLight = 1; e.starAlpha = 0;
    }
    const world = this.state === 'title' ? this.bgWorld : this.world;
    const R = (world ? world.viewDist : 8) * 16;
    r.fog.color = e.horizon.slice(); r.fog.skyHorizon = null;
    r.fog.start = R * 0.55; r.fog.end = Math.max(R - 6, 40);
    if (world && world.preset === 'medoh') { r.fog.start = R * 0.9; r.fog.end = R + 26; }   // clear air around the Divine Beast: it is 230 blocks across
    // LightTexture: block light brightness is scaled by (flicker + 1.5) in every dimension
    e.dim = (this.state === 'play' || this.state === 'loading') && this.world ? this.dim : 'overworld'; e.ambient = 0; e.force = 0; e.blkMul = 1.5;
    if (e.dim === 'nether') {
      // DimensionSpecialEffects.NetherEffects: no sky, ambient light 0.1, thick fog in the biome's fog colour
      const p = this.player, bio = BIOMES[world.getBiome(Math.floor(p.x), Math.floor(p.z))], fc = (bio && bio.fog) || [51, 8, 8];
      const cur = this._netherFog || (this._netherFog = fc.map(v => v / 255));
      for (let i = 0; i < 3; i++) cur[i] += (fc[i] / 255 - cur[i]) * 0.02;
      // LightTexture in a fixed-night dimension: block brightness x1.5, and a faint blue "sky" term (darken 0.2 -> 0.24) even under the roof
      e.skyLight = 0.24; e.ambient = 0.1; e.blkMul = 1.5; e.skyTint = [0.48, 0.48, 1]; e.starAlpha = 0; e.glow = 0; e.rain = 0;
      r.fog.color = cur.slice(); r.fog.start = R * 0.05; r.fog.end = Math.min(R, 192) * 0.5; r.fog.skyHorizon = r.fog.color;
    } else if (e.dim === 'end') {
      // EndEffects: forced bright lightmap, dark purple fog (0xA080A0 * 0.15), the end sky box
      e.skyLight = 0; e.force = 0.25; e.blkMul = 1.5; e.skyTint = [1, 1, 1]; e.starAlpha = 0; e.glow = 0; e.rain = 0;
      r.fog.color = [0.094, 0.075, 0.094]; r.fog.start = R * 0.75; r.fog.end = R; r.fog.skyHorizon = r.fog.color;
      // the dragon's boss event thickens the fog while the fight is on
      const fk = this._fightFog = (this._fightFog || 0) + ((this.dragonFighting() ? 1 : 0) - (this._fightFog || 0)) * 0.02;
      if (fk > 0.01) { r.fog.start = r.fog.start + (R * 0.05 - r.fog.start) * fk; r.fog.end = r.fog.end + (Math.min(R, 192) * 0.5 - r.fog.end) * fk; }
    }
    if (this.eyeInWater && this.state === 'play') {
      const wc = [0.1, 0.16, 0.42]; const b = e.dim === 'overworld' ? 0.25 + 0.75 * bright * 0.6 : 0.4;
      r.fog.color = [wc[0] * b, wc[1] * b, wc[2] * b]; r.fog.start = 0; r.fog.end = 22 + (this.options.fov > 0 ? 0 : 0);
      r.fog.skyHorizon = r.fog.color;
    } else if (this.eyeInLava && this.state === 'play') { r.fog.color = [0.6, 0.1, 0.0]; r.fog.start = 0; r.fog.end = 2.5; r.fog.skyHorizon = r.fog.color; }
  }
  cameraState(partial) {
    const p = this.player, cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: this.options.fov * DEG };
    const ix = p.px + (p.x - p.px) * partial, iy = p.py + (p.y - p.py) * partial, iz = p.pz + (p.z - p.pz) * partial;
    cam.x = ix; cam.y = iy + (p.sneaking ? 1.27 : 1.62) + 0; cam.z = iz;
    cam.yaw = p.yaw; cam.pitch = p.pitch;
    if (p.sleeping) { cam.y = iy + 0.2; cam.pitch = 0.4; }
    if (p.dead) { cam.roll = 0.6; cam.y = iy + 0.3; }
    const hurt = p.hurtTime > 0 ? (p.hurtTime - partial) / p.hurtDur : 0;
    if (hurt > 0) { const f = Math.sin(hurt * hurt * hurt * hurt * Math.PI); cam.roll = -f * 14 * DEG * 0.5; }
    if (this.cameraShake > 0) { const sh = this.cameraShake; cam.yaw += (Math.random() - 0.5) * 0.02 * sh; cam.pitch += (Math.random() - 0.5) * 0.02 * sh; this.cameraShake = Math.max(0, this.cameraShake - 0.4); }
    cam.fov *= p.pfovMod + (p.fovMod - p.pfovMod) * partial;
    if (this.eyeInWater) cam.fov *= 0.94;
    cam.bx = 0; cam.by = 0; cam.broll = 0; cam.bpitch = 0;
    if (this.options.bobbing && this.cameraMode === 0 && !p.flying && !p.dead) {
      const wd = p.walkDist - p.pwalkDist, w = p.pwalkDist + wd * partial, amt = p.pbob + (p.bob - p.pbob) * partial;
      cam.bx = Math.sin(w * Math.PI) * amt * 0.5; cam.by = -Math.abs(Math.cos(w * Math.PI) * amt); cam.broll = Math.sin(w * Math.PI) * amt * 3 * DEG; cam.bpitch = Math.abs(Math.cos(w * Math.PI - 0.2) * amt) * 5 * DEG;
    }
    return cam;
  }
  renderFrame(partial) {
    const r = this.renderer, gl = r.gl, ui = this.ui;
    ui.begin();
    r.stats.sections = 0; r.stats.verts = 0; r.stats.draws = 0;
    this.computeEnv();
    let world = null;
    if (this.state === 'play' || this.state === 'loading') world = this.world; else if (this.state === 'title') world = this.bgWorld;
    gl.viewport(0, 0, r.width, r.height);
    gl.clearColor(r.fog.color[0], r.fog.color[1], r.fog.color[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (world) {
      r.updateAnimated(world.tickCount + partial);
      if (this.state === 'title') this.renderPanorama(world, partial);
      else if (this.state === 'play' || this.state === 'loading') this.renderWorld(partial);
    }
    // ---- UI
    if (this.state === 'play') {
      const sleepA = this.player && this.player.sleeping ? Math.min(0.9, this.player.sleepTimer / 40) : 0;
      if (this.player) this.drawOverlays(ui, partial);
      drawHUD(this, ui, partial);
      if (this.banner) this.drawBanner(ui);
      if (this.dim === 'end') this.drawBossBar(ui);
      if (!this.screen && !this.mouse.locked && !this.noLock && this.player && !this.player.dead && !this.hideHud) ui.textC('Click to play', ui.w / 2, ui.h / 2 - 34, '#ffffff');
      if (this.showDebug) drawDebug(this, ui);
      else if (this.options.showFps) { ui.text(this.fps.toFixed(0) + ' fps', 2, 2, '#ffffff'); }
      if (sleepA > 0) { ui.rect(0, 0, ui.w, ui.h, 'rgba(0,0,10,' + sleepA + ')'); }
      // screens dim the world and the HUD behind them (vanilla draws its background gradient over the HUD too)
      if (this.screen && this.screen.dimWorld) { ui.gradient(0, 0, ui.w, ui.h, 'rgba(16,16,16,0.75)', 'rgba(16,16,16,0.82)'); }
    }
    if (this.screen) this.screen.draw(ui, partial);
    if (this.state === 'play') this.drawToasts(ui, partial);
    // custom cursor is the OS cursor except in locked inventory mode
    if (this.screen && !this.screen.passive && this.mouse.locked) this.drawCursor(ui);
  }
  drawCursor(ui) {
    const g = ui.g, x = Math.round(this.mouse.x), y = Math.round(this.mouse.y);
    g.fillStyle = '#000'; g.fillRect(x - 1, y - 1, 1, 11); g.fillRect(x - 1, y - 1, 7, 1);
    const pts = [[0, 0, 1, 9], [1, 1, 1, 8], [2, 2, 1, 7], [3, 3, 1, 6], [4, 4, 1, 5], [5, 5, 1, 2]];
    g.fillStyle = '#fff'; for (let i = 0; i < 9; i++) g.fillRect(x, y + i, 1, 1); for (let i = 0; i < 5; i++) g.fillRect(x + i, y, 1, 1);
    g.fillRect(x + 1, y + 1, 1, 7); g.fillRect(x + 2, y + 2, 1, 5); g.fillRect(x + 3, y + 3, 1, 3); g.fillRect(x + 4, y + 4, 1, 1);
    g.fillStyle = '#000'; for (let i = 0; i < 7; i++) g.fillRect(x + 1 + i, y + 1 + i, 1, 1);
  }
  renderPanorama(world, partial) {
    const r = this.renderer, gl = r.gl;
    const yaw = this.panoYaw + (this.panoT + partial) * 0.0035, pitch = 0.12;
    const b = this.bgPos;
    r.setCamera(b.x, b.y, b.z, yaw, pitch, 85 * DEG, world.viewDist * 16 + 32);
    r.drawSky();
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW); gl.depthMask(true);
    r.drawTerrain(world, 0);
    if (this.options.clouds > 0) r.drawClouds((this.panoT + partial) * 0.05, this.options.clouds === 2);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE); gl.depthMask(true);
    r.drawTerrain(world, 1);
    gl.disable(gl.BLEND);
  }
  renderWorld(partial) {
    const r = this.renderer, gl = r.gl, w = this.world, p = this.player, ui = this.ui;
    const cam = this.cameraState(partial);
    let cx = cam.x + cam.bx * Math.cos(p.yaw), cz = cam.z + cam.bx * Math.sin(p.yaw), cy = cam.y + cam.by;
    let yaw = cam.yaw, pitch = cam.pitch + cam.bpitch * 0;
    // third person
    let camPos = { x: cam.x, y: cam.y, z: cam.z };
    if (this.cameraMode > 0) {
      const dir = [0, 0, 0]; lookDir(yaw, pitch, dir); const sgn = this.cameraMode === 1 ? -1 : 1;
      let d = 4;
      const hit = w.raycast(cam.x, cam.y, cam.z, dir[0] * sgn, dir[1] * sgn, dir[2] * sgn, d, false);
      if (hit) d = Math.max(0.3, hit.t - 0.2);
      cx = cam.x + dir[0] * sgn * d; cy = cam.y + dir[1] * sgn * d; cz = cam.z + dir[2] * sgn * d;
      if (this.cameraMode === 2) { yaw += Math.PI; pitch = -pitch; }
    }
    this.updateTarget({ x: camPos.x, y: camPos.y, z: camPos.z, yaw: cam.yaw, pitch: cam.pitch });
    const far = w.viewDist * 16 + 32;
    r.setCamera(cx, cy, cz, yaw, pitch, cam.fov, far);
    // view roll (hurt / bob)
    if (cam.roll || cam.broll) {
      const Rz = m4(); m4RotZ(Rz, (cam.roll || 0) + (cam.broll || 0)); const v2 = m4(); m4Mul(v2, Rz, r.view); r.view.set(v2); m4Mul(r.vp, r.proj, r.view); frustumPlanes(r.vp, r.planes);
    }
    if (p.portalSpin > 0 || p.pPortalSpin > 0) this.applySpinWobble(r, partial);
    r.drawSky();
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW); gl.depthMask(true); gl.disable(gl.BLEND);
    r.drawTerrain(w, 0);
    // entities
    this.renderEntities(partial, cx, cy, cz);
    this.renderSpawners(partial, cx, cy, cz);
    this.renderSigns(partial, cx, cy, cz);
    // target outline and crack
    this.renderTargetOverlay(partial, cx, cy, cz);
    // batches
    gl.disable(gl.CULL_FACE);
    r.flushBatch(r.bSkin, true, { alphaTest: 0.1 });
    if (r.bSign && r.bSign.n) r.flushBatch(r.bSign, true, { alphaTest: 0.1, tex: r.signTex });
    gl.enable(gl.CULL_FACE);
    r.flushBatch(r.bTile, false, { alphaTest: 0.1 });
    if (this.options.clouds > 0 && this.dim === 'overworld') r.drawClouds((this.tick + partial) * 0.0125 * 3, this.options.clouds === 2);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE); gl.depthMask(true);
    r.drawTerrain(w, 1);
    gl.depthMask(false);
    if (this.dim === 'overworld') this.renderWeather(partial, cx, cy, cz);
    if (this.bolts.length) this.renderBolts(partial, cx, cy, cz);
    this.renderDimBeams(partial, cx, cy, cz);
    r.flushBatch(r.bAlpha, false, { alphaTest: 0.01 });
    if (r.bSkinT.n) r.flushBatch(r.bSkinT, true, { alphaTest: 0.01 });
    gl.depthMask(true); gl.disable(gl.BLEND);
    // hand
    if (this.cameraMode === 0 && !p.dead && !p.sleeping && !this.hideHud) this.renderHand(partial);
  }
  renderEntities(partial, cx, cy, cz) {
    const r = this.renderer, p = this.player;
    const planes = r.planes;
    for (const e of this.entities) {
      if (e.dead) continue;
      const ex = e.px + (e.x - e.px) * partial - cx, ey = e.py + (e.y - e.py) * partial - cy, ez = e.pz + (e.z - e.pz) * partial - cz;
      const d2 = ex * ex + ey * ey + ez * ez, rd = e.renderDist || 96; if (d2 > rd * rd) continue;
      const rr = e.renderRadius || Math.max(1, (e.w || 1) * 0.75);
      if (!aabbVisible(planes, ex - rr, ey - 0.5 - (rr > 2 ? rr : 0), ez - rr, ex + rr, ey + Math.max(2.5, (e.h || 2) + 0.5) + (rr > 2 ? rr : 0), ez + rr)) continue;
      if (e.renderSelfExtra) e.renderSelfExtra(this, partial, cx, cy, cz);
      if (e.isMob) { drawModel(r, e, MODELS[e.def.model], partial, cx, cy, cz, e.renderOpts(partial)); }
      else if (e instanceof ItemEntity) this.drawItemEntity(e, partial, ex, ey, ez);
      else if (e instanceof FallingBlock) this.drawBlockEntity(e.bid, e.bmeta, ex, ey + 0.49, ez, 1, 0, e.whiteFlash);
      else if (e instanceof PrimedTnt) { const f = e.fuse; const wf = (Math.floor(f / 5) % 2 === 0); this.drawBlockEntity(BID.tnt, 0, ex, ey + 0.49, ez, 1 + (f < 10 ? (1 - f / 10) * 0.2 : 0) , 0, wf); }
      else if (e instanceof XPOrb) { const s = 0.08 + 0.02 * Math.sin((e.age + partial) * 0.2); r.bAlpha.billboard(ex, ey + 0.1, ez, ...this.camRight(s), ...this.camUp(s), r.TILE.particle_orb, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1); }
      else if (e instanceof Projectile) this.drawProjectile(e, partial, ex, ey, ez);
      else if (e.renderSelf) e.renderSelf(this, partial, ex, ey, ez);
    }
    // player model in third person
    if (this.cameraMode > 0 && !p.dead) {
      p.bodyYaw = p.yaw; p.pbodyYaw = p.pyaw; p.headYawRel = 0; p.headPitchRel = p.pitch;
      const sp = Math.hypot(p.x - p.px, p.z - p.pz); p.limbAmt += (Math.min(1, sp * 4) - p.limbAmt) * 0.3; p.limbPos += sp * 3.0;
      p.swingProgress = p.swing; p.sneaking = p.sneaking;
      drawModel(r, p, MODELS.steve, partial, cx, cy, cz, {});
    }
    // particles
    const ri = this.camRight(1), up = this.camUp(1);
    this.particles.render(r, r.bAlpha, r.bTile, cx, cy, cz, ri[0], ri[1], ri[2], up[0], up[1], up[2], partial);
  }
  camRight(s) { const y = this.renderer.cam.yaw; let rx = -Math.cos(y), rz = -Math.sin(y); rx = -Math.cos(y); rz = -Math.sin(y); return [rx * s * 1.0, 0, rz * s * 1.0]; }
  camUp(s) {
    const c = this.renderer.cam, cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    // up vector of the camera: right x forward
    const fx = -sy * cp, fy = -sp, fz = cy * cp; let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    return [ux * s, uy * s, uz * s];
  }
  drawItemEntity(e, partial, x, y, z) {
    const r = this.renderer, s = e.stack, it = ITEMS[s.id]; if (!it) return;
    const t = e.age + partial, bob = Math.sin(t / 10 + e.spin) * 0.1 + 0.1;
    const count = s.n > 32 ? 4 : s.n > 16 ? 3 : s.n > 1 ? 2 : 1;
    const mesh = r.itemMesh(s.id);
    const M = this._im || (this._im = m4()), T = this._it || (this._it = m4()), R = this._ir || (this._ir = m4()), MV = this._imv || (this._imv = m4());
    const sc = mesh.sprite ? 0.5 : 0.28;
    const lt = e.lightAt(); const sky = lt[0] / 15, blk = lt[1] / 15;
    for (let i = 0; i < count; i++) {
      m4Compose(M, x + (i ? (i * 0.07) : 0) * (i % 2 ? 1 : -1), y + 0.25 + bob * 0.5 + (mesh.sprite ? 0.02 : 0.1), z + (i ? i * 0.05 : 0), 0, t / 20 + e.spin + i * 0.3, 0, sc, sc, sc);
      m4Mul(MV, r.view, M);
      r.drawMesh(mesh, MV, r.proj, sky, blk, 0.1);
    }
  }
  drawBlockEntity(bid, meta, x, y, z, scale, rot, flash) {
    const r = this.renderer; const it = ITEMS[bid]; if (!it) return;
    const key = 'b' + bid + ':' + meta;
    let mesh = r.meshCache.get(key); if (!mesh) { mesh = r.makeMesh(r.blockVerts(bid, meta)); r.meshCache.set(key, mesh); }
    const M = this._bm || (this._bm = m4()), MV = this._bmv || (this._bmv = m4());
    m4Compose(M, x, y, z, 0, 0, 0, scale, scale, scale); m4Mul(MV, r.view, M);
    const gl = r.gl;
    r.drawMesh(mesh, MV, r.proj, flash ? 3 : 1, flash ? 3 : 0.2, 0.1);
  }
  drawProjectile(e, partial, x, y, z) {
    const r = this.renderer, M = this._pm || (this._pm = m4()), MV = this._pmv || (this._pmv = m4());
    let id = e.kind === 'arrow' ? IID.arrow : e.kind === 'egg' ? IID.egg : e.kind === 'ender_pearl' ? IID.ender_pearl : IID.snowball;
    const mesh = r.itemMesh(id);
    const yaw = e.pyaw + (e.yaw - e.pyaw) * partial, pit = e.ppitch + (e.pitch - e.ppitch) * partial;
    if (e.kind === 'arrow') { m4Compose(M, x, y, z, 0, yaw - Math.PI / 2, pit - Math.PI * 0.25, 0.7, 0.7, 0.7); }
    else m4Compose(M, x, y, z, 0, this.renderer.cam.yaw, 0, e.kind === 'ender_pearl' ? 0.28 : 0.35, e.kind === 'ender_pearl' ? 0.28 : 0.35, e.kind === 'ender_pearl' ? 0.28 : 0.35);
    m4Mul(MV, r.view, M);
    const lt = e.lightAt();
    r.drawMesh(mesh, MV, r.proj, lt[0] / 15, lt[1] / 15, 0.1);
  }
  renderTargetOverlay(partial, cx, cy, cz) {
    const r = this.renderer, t = this.target, w = this.world; if (!t || this.hideHud) return;
    const tsel = w.shapeMeta(t.x, t.y, t.z, t.id, t.meta);
    const boxes = t.id === BID.fire ? [] : SH.getSelection(t.id, tsel);
    const segs = [], e = 0.002;
    for (const b of boxes) {
      const x0 = t.x + b[0] - e - cx, y0 = t.y + b[1] - e - cy, z0 = t.z + b[2] - e - cz, x1 = t.x + b[3] + e - cx, y1 = t.y + b[4] + e - cy, z1 = t.z + b[5] + e - cz;
      const P = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      for (const [a, c] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) segs.push(P[a][0], P[a][1], P[a][2], P[c][0], P[c][1], P[c][2]);
    }
    r.drawLines3D(segs, Math.max(1.5, r.height / 540), 0, 0, 0, 0.4);
    // crack overlay
    const b = this.breaking;
    if (b && b.total > 1 && b.ticks > 0) {
      const stage = Math.min(9, Math.floor(b.ticks / b.total * 10)), tile = r.TILE['destroy_stage_' + stage];
      if (tile !== undefined) {
        const bs = SH.getSelection(t.id, tsel), q = r.bTile;
        for (const bb of bs) {
          const x0 = b.x + bb[0] - 0.002 - cx, y0 = b.y + bb[1] - 0.002 - cy, z0 = b.z + bb[2] - 0.002 - cz, x1 = b.x + bb[3] + 0.002 - cx, y1 = b.y + bb[4] + 0.002 - cy, z1 = b.z + bb[5] + 0.002 - cz;
          const F = [
            [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]],
            [[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]], [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]]];
          const uv = [[0, 0], [0, 1], [1, 1], [1, 0]];
          for (const f of F) for (let k = 0; k < 4; k++) q.v(f[k][0], f[k][1], f[k][2], uv[k][0], uv[k][1], tile, 1, 1, 1, 1, 1, 1);
        }
      }
    }
  }
  // lightning bolts: a jagged random walk from the cloud layer to the ground, drawn as camera-facing ribbons (white core + blue glow)
  renderBolts(partial, cx, cy, cz) {
    const r = this.renderer, b = r.bAlpha, tile = r.TILE.white;
    for (const bo of this.bolts) {
      const rng = mulberry32(bo.seed), n = 16, top = bo.y + 110, pts = [];
      let ox = 0, oz = 0;
      for (let i = 0; i <= n; i++) { const t = i / n; if (i) { ox += (rng() - 0.5) * 9 * (0.35 + 0.65 * (1 - t)); oz += (rng() - 0.5) * 9 * (0.35 + 0.65 * (1 - t)); } pts.push([ox, top - (top - bo.y) * t, oz]); }
      const ex = pts[n][0], ez = pts[n][2];
      for (let i = 0; i <= n; i++) { const t = i / n; pts[i][0] = bo.x + pts[i][0] - ex * t; pts[i][2] = bo.z + pts[i][2] - ez * t; }
      const flick = bo.life > 6 ? 1 : 0.35 + 0.65 * ((bo.life * 7 + bo.seed) % 3) / 2;
      const strip = (P, wd, R, G, B, A) => {
        for (let i = 0; i < P.length - 1; i++) {
          const a = P[i], c = P[i + 1];
          const sx = c[0] - a[0], sy = c[1] - a[1], sz = c[2] - a[2];
          const mx = (a[0] + c[0]) / 2 - cx, my = (a[1] + c[1]) / 2 - cy, mz = (a[2] + c[2]) / 2 - cz;
          let rx = sy * mz - sz * my, ry = sz * mx - sx * mz, rz = sx * my - sy * mx;
          const l = Math.hypot(rx, ry, rz) || 1; rx = rx / l * wd; ry = ry / l * wd; rz = rz / l * wd;
          b.billboard(mx, my, mz, rx, ry, rz, sx / 2, sy / 2, sz / 2, tile, 0, 0, 1, 1, R, G, B, A * flick, 1, 1);
        }
      };
      strip(pts, 0.55, 0.55, 0.65, 1, 0.28);
      strip(pts, 0.25, 0.8, 0.85, 1, 0.55);
      strip(pts, 0.09, 1, 1, 1, 1);
      for (let f = 0; f < 3; f++) {
        const si = 3 + ((rng() * (n - 7)) | 0), P = [pts[si].slice()];
        let dx = (rng() - 0.5) * 3, dz = (rng() - 0.5) * 3, yy = pts[si][1];
        for (let k = 0; k < 5; k++) { yy -= 3 + rng() * 5; P.push([P[k][0] + dx + (rng() - 0.5) * 3, yy, P[k][2] + dz + (rng() - 0.5) * 3]); }
        strip(P, 0.3, 0.7, 0.75, 1, 0.35); strip(P, 0.06, 1, 1, 1, 0.9);
      }
    }
  }
  renderWeather(partial, cx, cy, cz) {
    const W = this.weather, r = this.renderer, w = this.world; if (W.rain < 0.05) return;
    const bio = w.getBiome(Math.floor(this.player.x), Math.floor(this.player.z)), snowy = BIOMES[bio] && /snowy|peaks/.test(BIOMES[bio].name);
    const p = this.player, N = Math.floor((snowy ? 1800 : 2600) * W.rain), t = this.tick + partial, b = r.bAlpha;   // vanilla draws a curtain of streaks in every column within ~10 blocks
    const rng = mulberry32(12345), tile = r.TILE.white;
    const R = r.cam.yaw, ux = Math.cos(R), uz = Math.sin(R);
    for (let i = 0; i < N; i++) {
      const ox = (rng() - 0.5) * 22, oz = (rng() - 0.5) * 22, off = rng() * 30, sp = snowy ? 2 + rng() * 1.5 : 22 + rng() * 6;
      const wx = Math.floor(p.x + ox), wz = Math.floor(p.z + oz);
      if (!w.isLoaded(wx, wz)) continue;
      const top = w.heightAt(wx, wz);
      const y = p.y + 12 - ((t * sp * 0.05 + off) % 24);
      if (y < top || y > p.y + 14) continue;
      if (snowy) { const dr = Math.sin(t * 0.06 + off * 3) * 0.5, dz = Math.cos(t * 0.05 + off * 5) * 0.5; b.billboard(p.x + ox + dr - cx, y - cy, p.z + oz + dz - cz, ux * 0.02, 0, uz * 0.02, 0, 0.02, 0, tile, 0, 0, 1, 1, 1, 1, 1, 0.85, 1, 1); }
      else { const dd = Math.hypot(p.x + ox - cx, y - cy, p.z + oz - cz), k = Math.min(1, 0.3 + dd / 4); b.billboard(p.x + ox - cx, y - cy, p.z + oz - cz, ux * 0.02 * k, 0, uz * 0.02 * k, 0, 0.5, 0, tile, 0, 0, 1, 1, 0.7, 0.75, 1, 0.42 * Math.min(1, 0.35 + dd / 3), 1, 1); }
    }
  }
  drawFireOverlay(ui, partial) {
    if (typeof TexBlocks === 'undefined' || !TexBlocks.animated || !TexBlocks.animated.fire_layer_1) return;
    if (!this.fireCanvases) this.fireCanvases = TexBlocks.animated.fire_layer_1.frames.map(f => { const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f), 16, 16), 0, 0); return c; });
    const g = ui.g, W = ui.w, H = ui.h, sz = Math.round(H * 0.55), fr = this.fireCanvases, n = fr.length, t = this.tick + partial;
    const prevSmooth = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.globalAlpha = 0.9;
    for (const layer of [0, 1]) {
      const cv = fr[(Math.floor(t) + layer * 11) % n];
      g.drawImage(cv, -Math.round(sz * 0.12), H - Math.round(sz * 0.92), sz, sz);
      g.save(); g.translate(W, 0); g.scale(-1, 1); g.drawImage(fr[(Math.floor(t) + layer * 11 + 5) % n], -Math.round(sz * 0.12), H - Math.round(sz * 0.92), sz, sz); g.restore();
    }
    g.globalAlpha = 1; g.imageSmoothingEnabled = prevSmooth;
  }
  drawOverlays(ui, partial) {
    const p = this.player, g = ui.g;
    if (this.eyeInWater) ui.rect(0, 0, ui.w, ui.h, 'rgba(20,50,180,0.22)');
    if (this.eyeInLava) ui.rect(0, 0, ui.w, ui.h, 'rgba(240,80,0,0.55)');
    if (p.hurtTime > 0 && p.health > 0) { const a = (p.hurtTime - partial) / p.hurtDur * 0.4; ui.rect(0, 0, ui.w, ui.h, 'rgba(200,0,0,' + a.toFixed(3) + ')'); }
    if (p.fireTicks > 0 && this.cameraMode === 0) this.drawFireOverlay(ui, partial);
    this.drawPortalOverlay(ui, partial);
    // inside a solid block
    const w = this.world, hb = w.getBlock(Math.floor(p.x), Math.floor(p.y + p.eyeH), Math.floor(p.z));
    if (T_OPAQUE[hb] && !p.noClip) ui.rect(0, 0, ui.w, ui.h, 'rgba(0,0,0,0.9)');
    if (this.weather.rain > 0.5) { }
  }
  // ------------------------------------------------------------ first person hand
  renderHand(partial) {
    const r = this.renderer, gl = r.gl, p = this.player;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const proj = this._handProj || (this._handProj = m4());
    m4Perspective(proj, 70 * DEG * (p.pfovMod + (p.fovMod - p.pfovMod) * partial > 1.001 ? 1 : 1), r.width / r.height, 0.02, 20);
    const sw = p.pswing + (p.swing - p.pswing) * partial, eq = p.pequip + (p.equipProg - p.pequip) * partial;
    const eqOff = -0.6 * (1 - eq), s = p.held();
    const lt = this.world.getSky(Math.floor(p.x), Math.floor(p.y + 1.2), Math.floor(p.z)) / 15, lb = this.world.getBlk(Math.floor(p.x), Math.floor(p.y + 1.2), Math.floor(p.z)) / 15;
    const M = this._hm || (this._hm = m4()), T = this._ht || (this._ht = m4()), A = this._ha || (this._ha = m4()), B = this._hb || (this._hb = m4());
    const sq = Math.sqrt(sw), swp = Math.sin(sw * sw * Math.PI), sqs = Math.sin(sq * Math.PI);
    let use = 0; if (p.eating > 0) { use = Math.abs(Math.cos((p.eating + partial) / 4 * Math.PI)) * 0.1; }
    const bowPull = p.usingBow > 0 ? Math.min(1, (p.usingBow + partial) / 20) : 0;
    const mul = (a, b2) => { m4Mul(B, a, b2); a.set(B); };
    m4Identity(M);
    const app = (m) => { m4Mul(B, M, m); M.set(B); };
    const tr = (x, y, z) => app(m4TranslateM(T, x, y, z));
    const rx = a => app(m4RotX(T, a * DEG)), ry = a => app(m4RotY(T, a * DEG)), rz = a => app(m4RotZ(T, a * DEG)), sc = (x, y, z) => app(m4Scale(T, x, y, z));
    if (!s) {
      // bare arm: hand points forward, shoulder off-screen at the lower right
      const T = this.handArm || (this.handArm = { x: 0.55, y: -0.62, z: -0.75, rx: 105, ry: -12, rz: 8, sc: 1.0 });
      const f1 = -0.3 * sqs, f2 = 0.4 * Math.sin(sq * TAU), f3 = -0.4 * sqs;
      tr(T.x + f1 * 0.6, T.y + f2 * 0.5 + eqOff, T.z + f3 * 0.6);
      ry(T.ry - sqs * 30); rz(T.rz + swp * -20); rx(T.rx - sqs * 40);
      sc(T.sc, T.sc, T.sc);
      const skinRect = r.skinRect.steve, part = MODELS.steve.parts.find(pp => pp.name === 'rarm');
      emitPart(r.bSkin, part, 0, 0, 0, -part.px, -part.py, -part.pz, M, skinRect, 1, 1, 1, 1, Math.max(lt, 0.2), lb);
      gl.disable(gl.CULL_FACE);
      r.flushBatch(r.bSkin, true, { mv: m4Identity(this._id || (this._id = m4())), proj, alphaTest: 0.1 });
      return;
    }
    const it = ITEMS[s.id];
    const mesh = r.itemMesh(s.id);
    // MC: translate(0.56,-0.52+equip,-0.72) with attack transforms
    tr(-0.4 * sqs, 0.2 * Math.sin(sq * TAU), -0.2 * Math.sin(sw * Math.PI));
    tr(0.56, -0.52 + eqOff + use * 0, -0.72);
    if (p.eating > 0) { tr(0, use, 0); }
    ry(45 - swp * 20); rz(sqs * -20); rx(sqs * -80); ry(-45);
    if (bowPull > 0) tr(0, 0, 0.02 * bowPull);
    if (mesh.sprite) {
      // MC item display transform (first person, right hand): translate(1.13,3.2,1.13)/16 ; rotation XYZ(0,-90,25) ; scale .68
      tr(1.13 / 16, 3.2 / 16, 1.13 / 16);
      rz(25); ry(-90);
      sc(0.68, 0.68, 0.68);
    } else {
      // block display: rotY 45, scale .4
      ry(45); sc(0.4, 0.4, 0.4);
    }
    r.drawMesh(mesh, M, proj, Math.max(lt, 0.15), lb, 0.1);
  }
  _armM(M) {
    // arm box is 4x12x4 px in MC space; wrap in a matrix that scales to blocks and orients the arm (pivot at the shoulder)
    const out = this._am || (this._am = m4()); const S = this._as || (this._as = m4());
    m4Scale(S, 1, 1, 1); m4Mul(out, M, S); return out;
  }
}
