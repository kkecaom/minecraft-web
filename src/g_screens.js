// ===== g_screens.js : menus and container screens =====
class Screen {
  constructor(game) { this.game = game; this.passive = false; this.dimWorld = false; this.pausesGame = false; this.needsCursor = true; this.btns = []; this.sliderDrag = null; this.fields = []; this.focus = null; }
  init() { }
  btn(ui, x, y, w, h, label, cb, enabled) {
    if (enabled === undefined) enabled = true;
    const m = this.game.mouse, hover = enabled && m.x >= x && m.x < x + w && m.y >= y && m.y < y + h && !this.sliderDrag;
    ui.button(x, y, w, h, label, enabled, hover);
    this.btns.push({ x, y, w, h, cb, enabled });
  }
  slider(ui, x, y, w, h, label, value, onChange, fmt) {
    const g = ui.g, m = this.game.mouse, hover = m.x >= x && m.x < x + w && m.y >= y && m.y < y + h;
    // track
    g.drawImage(ui.buttonImage(w, h, 2), x, y);
    g.fillStyle = '#000'; g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
    const hx = x + Math.round(value * (w - 8));
    g.drawImage(ui.buttonImage(8, h, hover || (this.sliderDrag && this.sliderDrag.id === label) ? 1 : 0), hx, y);
    ui.textC(label + (fmt ? ': ' + fmt(value) : ''), x + w / 2, y + (h - 8) / 2, '#ffffff');
    this.btns.push({ x, y, w, h, slider: true, id: label, onChange });
  }
  drawBackground(ui) {
    if (this.game.state === 'title') { ui.gradient(0, 0, ui.w, ui.h, 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.6)'); }
    else if (this.game.state === 'play') { /* world dim handled by dimWorld */ }
    else ui.dirtBackground(0, 0, ui.w, ui.h);
  }
  mouseDown(x, y, b) {
    if (b !== 0) return;
    for (let i = this.btns.length - 1; i >= 0; i--) {
      const bt = this.btns[i];
      if (x >= bt.x && x < bt.x + bt.w && y >= bt.y && y < bt.y + bt.h) {
        if (bt.slider) { this.sliderDrag = bt; this.updateSlider(bt, x); return; }
        if (bt.enabled) { this.game.uiClick(); bt.cb(); }
        return;
      }
    }
    this.clickFields(x, y);
  }
  clickFields(x, y) { let hit = null; for (const f of this.fields) if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) hit = f; if (hit || this.fields.length) this.focus = hit; }
  mouseUp() { if (this.sliderDrag) { this.sliderDrag = null; this.game.saveOptions(); } }
  updateSlider(bt, x) { const v = clamp((x - bt.x - 4) / (bt.w - 8), 0, 1); bt.onChange(v); }
  beginFrame() {
    this.btns = []; this.fields = [];
    if (this.sliderDrag) { const m = this.game.mouse; const bt = this.sliderDrag; bt.__x = bt.x; this.updateSlider(bt, m.x); }
  }
  keyDown(e) { if (e.code === 'Escape') { this.onEscape(); return; } this.textKey(e); }
  onEscape() { this.game.closeScreen(); }
  textKey(e) {
    const f = this.focus; if (!f) return;
    if (e.key === 'Backspace') { f.set(f.get().slice(0, -1)); e.preventDefault(); }
    else if (e.key === 'Enter') { if (f.enter) f.enter(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && f.get().length < (f.max || 32)) { f.set(f.get() + e.key); e.preventDefault(); }
  }
  tickExtra() { }
}

// ---------------------------------------------------------------- logo (procedural blocky MINECRAFT)
const LOGO_GLYPHS = {
  M: ['#.....#', '##...##', '###.###', '##.#.##', '##...##', '##...##', '##...##', '##...##', '##...##'],
  I: ['####', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '####'],
  N: ['##....##', '###...##', '####..##', '##.##.##', '##..####', '##...###', '##....##', '##....##', '##....##'],
  E: ['#######', '##.....', '##.....', '######.', '##.....', '##.....', '##.....', '##.....', '#######'],
  C: ['.######', '##....#', '##.....', '##.....', '##.....', '##.....', '##.....', '##....#', '.######'],
  R: ['######.', '##...##', '##...##', '##...##', '######.', '##.##..', '##..##.', '##...##', '##...##'],
  A: ['.#####.', '##...##', '##...##', '##...##', '#######', '##...##', '##...##', '##...##', '##...##'],
  F: ['#######', '##.....', '##.....', '######.', '##.....', '##.....', '##.....', '##.....', '##.....'],
  T: ['#######', '..###..', '..###..', '..###..', '..###..', '..###..', '..###..', '..###..', '..###..'],
};
function buildLogo(text, cell) {
  const rows = 9, gap = 1;
  let wc = 0; for (const ch of text) wc += LOGO_GLYPHS[ch][0].length + gap; wc -= gap;
  const pad = 3, W = wc * cell + pad * 2, H = rows * cell + pad * 2 + 3;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const grid = []; for (let y = 0; y < rows; y++) grid.push(new Array(wc).fill(0));
  let cx = 0; for (const ch of text) { const gl = LOGO_GLYPHS[ch]; for (let y = 0; y < rows; y++) for (let x = 0; x < gl[y].length; x++) if (gl[y][x] === '#') grid[y][cx + x] = 1; cx += gl[0].length + gap; }
  const rnd = mulberry32(99);
  const on = (x, y) => x >= 0 && y >= 0 && x < wc && y < rows && grid[y][x];
  // shadow + outline
  const shadowCol = 'rgba(0,0,0,0.45)';
  for (let y = 0; y < rows; y++) for (let x = 0; x < wc; x++) if (grid[y][x]) { g.fillStyle = shadowCol; g.fillRect(pad + x * cell + 3, pad + y * cell + 3, cell, cell); }
  for (let y = -1; y <= rows; y++) for (let x = -1; x <= wc; x++) {
    let near = false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (on(x + dx, y + dy)) near = true;
    if (near) { g.fillStyle = '#000'; const ox = pad + x * cell - (on(x - 1, y) || on(x, y) ? 0 : 1), oy = pad + y * cell; g.fillRect(pad + x * cell - 2, pad + y * cell - 2, cell + 4, cell + 4); }
  }
  // cells with stone texture and bevel
  for (let y = 0; y < rows; y++) for (let x = 0; x < wc; x++) {
    if (!grid[y][x]) continue;
    const x0 = pad + x * cell, y0 = pad + y * cell;
    for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) {
      let v = 118 + ((rnd() * 22) | 0) - 6;
      if (rnd() < 0.18) v -= 14;
      if (py === 0 && !on(x, y - 1) || px === 0 && !on(x - 1, y)) v += 46;
      else if (py === 0 || px === 0) v += 14;
      if (py === cell - 1 && !on(x, y + 1) || px === cell - 1 && !on(x + 1, y)) v -= 52;
      else if (py === cell - 1 || px === cell - 1) v -= 12;
      v = clamp(v, 30, 235);
      g.fillStyle = cssRGB(v, v, v); g.fillRect(x0 + px, y0 + py, 1, 1);
    }
  }
  return cv;
}

// ---------------------------------------------------------------- title screen
class TitleScreen extends Screen {
  constructor(game) { super(game); this.passive = false; this.needsCursor = false; }
  init() { if (!this.game.logo) this.game.logo = buildLogo('MINECRAFT', 4); this.t0 = now(); }
  draw(ui) {
    const game = this.game, g = ui.g; this.beginFrame();
    const W = ui.w, H = ui.h;
    // vignette overlay
    ui.gradient(0, 0, W, H, 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.25)');
    const lg = game.logo, lw = lg.width, lx = Math.round(W / 2 - lw / 2), ly = 22;
    g.drawImage(lg, lx, ly);
    ui.textC('WEB EDITION', W / 2 + lw / 2 - 128, ly + lg.height - 4, '#ffffff');
    // splash
    const t = (now() % 1000) / 1000, sc = (1.8 - Math.abs(Math.sin(t * TAU) * 0.1)) * 100 / (textWidth(game.splash) + 32);
    g.save(); g.translate(W / 2 + lw / 2 - 30, ly + 42); g.rotate(-20 * DEG); g.scale(sc, sc); ui.textC(game.splash, 0, -4, '#ffff00'); g.restore();
    const bx = Math.round(W / 2 - 100), by = Math.round(H / 4 + 48);
    this.btn(ui, bx, by, 200, 20, 'Singleplayer', () => game.openScreen(new SelectWorldScreen(game, this)));
    this.btn(ui, bx, by + 24, 200, 20, 'Multiplayer', () => { }, false);
    this.btn(ui, bx, by + 48, 200, 20, 'Minecraft Realms', () => { }, false);
    this.btn(ui, bx, by + 84, 98, 20, 'Options...', () => game.openScreen(new OptionsScreen(game, this)));
    this.btn(ui, bx + 102, by + 84, 98, 20, 'Quit Game', () => { game.openScreen(new QuitScreen(game)); });
    ui.text('Minecraft Web Edition 1.0', 2, H - 10, '#ffffff');
    ui.textR('Not affiliated with Mojang or Microsoft', W - 2, H - 10, '#ffffff');
  }
  onEscape() { }
}
class QuitScreen extends Screen {
  constructor(game) { super(game); }
  onEscape() { this.game.openScreen(new TitleScreen(this.game)); }
  draw(ui) { this.beginFrame(); ui.rect(0, 0, ui.w, ui.h, '#000'); ui.textC('Thanks for playing!', ui.w / 2, ui.h / 2 - 12, '#ffffff'); ui.textC('You can close this tab now.', ui.w / 2, ui.h / 2 + 4, '#aaaaaa'); this.btn(ui, ui.w / 2 - 100, ui.h / 2 + 30, 200, 20, 'Back to Title Screen', () => this.game.openScreen(new TitleScreen(this.game))); try { window.close(); } catch (e) { } }
}

// ---------------------------------------------------------------- world selection
class SelectWorldScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.worlds = null; this.sel = -1; this.scroll = 0; this.loading = true; this.needsCursor = false; }
  init() { this.game.store.listWorlds().then(l => { this.worlds = l; this.loading = false; if (l.length) this.sel = 0; }); }
  draw(ui) {
    this.beginFrame(); const g = ui.g, W = ui.w, H = ui.h;
    ui.dirtBackground(0, 0, W, H);
    ui.rect(0, 32, W, H - 96, 'rgba(0,0,0,0.5)');
    ui.gradient(0, 32, W, 4, 'rgba(0,0,0,1)', 'rgba(0,0,0,0)'); ui.gradient(0, H - 68, W, 4, 'rgba(0,0,0,0)', 'rgba(0,0,0,1)');
    ui.textC('Select World', W / 2, 12, '#ffffff');
    const list = this.worlds || [];
    const lx = Math.round(W / 2 - 110), rowH = 36;
    g.save(); g.beginPath(); g.rect(0, 36, W, H - 104); g.clip();
    list.forEach((wd, i) => {
      const y = 40 + i * rowH - this.scroll;
      if (y + rowH < 36 || y > H - 64) return;
      const m = this.game.mouse, hover = m.x > lx - 4 && m.x < lx + 224 && m.y > y - 2 && m.y < y + 34 && m.y > 36 && m.y < H - 68;
      if (i === this.sel) { g.fillStyle = '#808080'; g.fillRect(lx - 4, y - 2, 228, 36); g.fillStyle = '#000'; g.fillRect(lx - 3, y - 1, 226, 34); }
      else if (hover) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(lx - 4, y - 2, 228, 36); }
      // icon
      const beast = wd.preset === 'medoh';
      g.fillStyle = '#3b3b3b'; g.fillRect(lx, y, 32, 32); ui.tile(beast ? 'ancient_carved_top' : 'grass_block_top', lx + 1, y + 1, 30);
      if (beast) { g.fillStyle = 'rgba(90,225,255,0.9)'; g.fillRect(lx + 1, y + 15, 30, 2); g.fillRect(lx + 15, y + 1, 2, 30); } else { g.fillStyle = 'rgba(70,120,40,0.35)'; g.fillRect(lx + 1, y + 1, 30, 30); }
      ui.text(wd.name, lx + 36, y + 1, '#ffffff');
      ui.text(wd.name + ' (' + fmtTime(wd.lastPlayed) + ')', lx + 36, y + 11, '#808080');
      ui.text((wd.mode === 'creative' ? 'Creative Mode' : 'Survival Mode') + (beast ? ', Divine Beast world' : ', Version: Web 1.0'), lx + 36, y + 21, beast ? '#6fd8f0' : '#808080');
      this.btns.push({ x: lx - 4, y: Math.max(y - 2, 36), w: 228, h: 36, cb: () => { if (this.sel === i && now() - (this.lastClick || 0) < 400) this.play(); this.sel = i; this.lastClick = now(); }, enabled: true, noSound: true });
    });
    g.restore();
    if (this.loading) ui.textC('Loading...', W / 2, 60, '#aaaaaa');
    else if (!list.length) ui.textC('No worlds yet. Create one!', W / 2, 60, '#aaaaaa');
    const by = H - 52;
    this.btn(ui, W / 2 - 154, by, 150, 20, 'Play Selected World', () => this.play(), this.sel >= 0 && !!list[this.sel]);
    this.btn(ui, W / 2 + 4, by, 150, 20, 'Create New World', () => this.game.openScreen(new CreateWorldScreen(this.game, this)));
    this.btn(ui, W / 2 - 154, by + 24, 72, 20, 'Delete', () => { const w = list[this.sel]; if (w) this.game.openScreen(new ConfirmScreen(this.game, 'Are you sure you want to delete this world?', "'" + w.name + "' will be lost forever! (A long time!)", 'Delete', async () => { await this.game.store.deleteWorld(w.id); this.game.openScreen(new SelectWorldScreen(this.game, this.parent)); }, () => this.game.openScreen(this))); }, this.sel >= 0 && !!list[this.sel]);
    this.btn(ui, W / 2 - 78, by + 24, 72, 20, 'Edit', () => { }, false);
    this.btn(ui, W / 2 + 4, by + 24, 72, 20, 'Re-Create', () => { }, false);
    this.btn(ui, W / 2 + 82, by + 24, 72, 20, 'Cancel', () => this.game.openScreen(this.parent));
  }
  mouseDown(x, y, b) { super.mouseDown(x, y, b); }
  wheel(d) { this.scroll = clamp(this.scroll + Math.sign(d) * 18, 0, Math.max(0, (this.worlds || []).length * 36 - (this.game.ui.h - 104))); }
  play() { const w = (this.worlds || [])[this.sel]; if (!w) return; this.game.lockPointer(); this.game.startWorld(w); }
  onEscape() { this.game.openScreen(this.parent); }
}
class ConfirmScreen extends Screen {
  constructor(game, title, msg, yes, onYes, onNo) { super(game); Object.assign(this, { title, msg, yes, onYes, onNo }); }
  draw(ui) {
    this.beginFrame(); ui.dirtBackground(0, 0, ui.w, ui.h);
    ui.textC(this.title, ui.w / 2, 70, '#ffffff'); ui.textC(this.msg, ui.w / 2, 90, '#ffffff');
    this.btn(ui, ui.w / 2 - 155, ui.h / 6 + 96, 150, 20, this.yes, this.onYes); this.btn(ui, ui.w / 2 + 5, ui.h / 6 + 96, 150, 20, 'Cancel', this.onNo);
  }
  onEscape() { this.onNo(); }
}
class CreateWorldScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.name = 'New World'; this.seed = ''; this.mode = 0; this.wtype = 0; this.diff = game.options.difficulty === undefined ? 2 : game.options.difficulty; this.fi = 0; this.needsCursor = false; }
  draw(ui) {
    this.beginFrame(); const W = ui.w, H = ui.h; ui.dirtBackground(0, 0, W, H);
    ui.textC('Create New World', W / 2, 20, '#ffffff');
    const x = Math.round(W / 2 - 100);
    ui.text('World Name', x, 44, '#a0a0a0');
    this.fields.push({ x, y: 55, w: 200, h: 20, get: () => this.name, set: v => this.name = v, max: 32, enter: () => this.create() });
    ui.field(x, 55, 200, 20, this.name, this.fi === 0, '');
    ui.text('Seed for the World Generator', x, 82, '#a0a0a0');
    this.fields.push({ x, y: 93, w: 200, h: 20, get: () => this.seed, set: v => this.seed = v, max: 40, enter: () => this.create() });
    ui.field(x, 93, 200, 20, this.seed, this.fi === 1, '');
    ui.text('Leave blank for a random seed', x, 116, '#808080');
    this.btn(ui, x, 134, 200, 20, 'Game Mode: ' + (this.mode ? 'Creative' : 'Survival'), () => this.mode ^= 1);
    this.btn(ui, x, 158, 200, 20, 'Difficulty: ' + ['Peaceful', 'Easy', 'Normal', 'Hard'][this.diff], () => this.diff = (this.diff + 1) % 4);
    this.btn(ui, x, 182, 200, 20, 'World Type: ' + (this.wtype ? 'Divine Beast Vah Medoh' : 'Default'), () => this.wtype ^= 1);
    if (H >= 262) ui.textC(this.wtype ? 'Lake Totori, Rito Village and the Divine Beast perched above it' : this.mode ? 'Players can fly, have unlimited resources and can not be hurt' : 'Search for resources, crafting, gain levels, health and hunger', W / 2, 208, '#808080');
    this.btn(ui, W / 2 - 155, H - 28, 150, 20, 'Create New World', () => this.create(), this.name.trim().length > 0);
    this.btn(ui, W / 2 + 5, H - 28, 150, 20, 'Cancel', () => this.game.openScreen(this.parent));
  }
  async create() {
    if (!this.name.trim() || this.busy) return;
    this.busy = true;
    this.game.lockPointer();
    const rec = await this.game.createWorld(this.name.trim(), this.seed.trim(), this.mode ? 'creative' : 'survival', this.diff, this.wtype ? 'medoh' : undefined);
    this.game.options.difficulty = this.diff;
    this.game.startWorld(rec);
  }
  clickFields(x, y) { for (let i = 0; i < this.fields.length; i++) { const f = this.fields[i]; if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) { this.fi = i; return; } } }
  keyDown(e) {
    if (e.code === 'Escape') { this.onEscape(); return; }
    if (e.code === 'Tab') { e.preventDefault(); const n = Math.max(1, this.fields.length); this.fi = (this.fi + (e.shiftKey ? n - 1 : 1)) % n; return; }
    this.textKeyIdx(e);
  }
  textKeyIdx(e) {
    const f = this.fields[this.fi] || this.fields[0]; if (!f) return;
    if (e.key === 'Backspace') { f.set(f.get().slice(0, -1)); e.preventDefault(); }
    else if (e.key === 'Enter') { f.enter && f.enter(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && f.get().length < f.max) { f.set(f.get() + e.key); e.preventDefault(); }
  }
  onEscape() { this.game.openScreen(this.parent); }
}

class LoadingScreen extends Screen {
  constructor(game) { super(game); this.needsCursor = false; this.t0 = now(); }
  draw(ui) {
    this.beginFrame(); const game = this.game, W = ui.w, H = ui.h;
    // travelling between dimensions shows the portal you came through (nether swirl / end starfield)
    const via = game.arrival ? game.arrival.kind : null;
    if (via === 'nether_portal' && game._portalCanvases) { const g = ui.g, prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.drawImage(game._portalCanvases[Math.floor(now() / 50) % game._portalCanvases.length], 0, 0, W, H); g.imageSmoothingEnabled = prev; ui.rect(0, 0, W, H, 'rgba(0,0,0,0.25)'); }
    else if (via === 'end_platform' || (via === 'respawn' && game.arrival.from === 'end')) { ui.rect(0, 0, W, H, '#05070a'); const r = mulberry32(7); for (let i = 0; i < 160; i++) { const x = r() * W, y = (r() * H + now() * 0.004 * (1 + i % 3)) % H; ui.rect(Math.floor(x), Math.floor(y), 1, 1, i % 4 ? 'rgba(80,200,170,0.7)' : 'rgba(170,110,230,0.8)'); } }
    else ui.dirtBackground(0, 0, W, H);
    const p = game.worldReady(), pct = Math.floor(clamp(p, 0, 1) * 100);
    if (game.loadingText && game.arrival) ui.textC(game.loadingText, W / 2, H / 2 - 36, '#ffffff');
    ui.textC('Loading terrain...', W / 2, H / 2 - 22, '#ffffff');
    ui.textC(pct + '%', W / 2, H / 2 - 8, '#ffffff');
    // chunk progress bar
    const bw = 182, bx = Math.round(W / 2 - bw / 2), by = Math.round(H / 2 + 8);
    ui.rect(bx - 1, by - 1, bw + 2, 7, '#000'); ui.rect(bx, by, Math.round(bw * p), 5, '#80ff20');
    if (p >= 1 && now() - this.t0 > 400) game.finishLoading();
    else if (now() - this.t0 > 25000 && p > 0.6) game.finishLoading();
  }
  keyDown() { }
}

// ---------------------------------------------------------------- pause & options
class PauseScreen extends Screen {
  constructor(game) { super(game); this.dimWorld = true; this.pausesGame = true; }
  draw(ui) {
    this.beginFrame(); const W = ui.w, H = ui.h, game = this.game; const bx = Math.round(W / 2 - 100), by = Math.round(H / 4 + 24);
    ui.textC('Game Menu', W / 2, 40, '#ffffff');
    this.btn(ui, bx, by, 200, 20, 'Back to Game', () => game.resumeGame());
    this.btn(ui, bx, by + 24, 98, 20, 'Advancements', () => game.openScreen(new AdvancementsScreen(game, this))); this.btn(ui, bx + 102, by + 24, 98, 20, 'Statistics', () => game.openScreen(new StatsScreen(game, this)));
    this.btn(ui, bx, by + 72, 98, 20, 'Options...', () => game.openScreen(new OptionsScreen(game, this)));
    this.btn(ui, bx + 102, by + 72, 98, 20, 'Open to LAN', () => { }, false);
    this.btn(ui, bx, by + 96, 200, 20, 'Save and Quit to Title', () => game.quitToTitle());
    if (game.lockFailed && !game.mouse.locked && !game.noLock) ui.textC("Click 'Back to Game' to capture the mouse", W / 2, by + 128, '#a0a0a0');
  }
  keyDown(e) { if (e.code === 'Escape') this.game.resumeGame(); }
  onClose() { this.game.saveGame(); }
}
class OptionsScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.dimWorld = game.state === 'play'; this.pausesGame = game.state === 'play'; this.needsCursor = true; }
  draw(ui) {
    this.beginFrame(); const g = this.game, o = g.options, W = ui.w, H = ui.h; this.drawBackground(ui);
    if (g.state !== 'play') ui.dirtBackground(0, 0, W, H);
    ui.textC('Options', W / 2, 15, '#ffffff');
    const lx = Math.round(W / 2 - 155), rx = Math.round(W / 2 + 5), y0 = 36;
    this.slider(ui, lx, y0, 150, 20, 'FOV', (o.fov - 30) / 80, v => { o.fov = Math.round(30 + v * 80); }, v => { const f = Math.round(30 + v * 80); return f === 70 ? 'Normal' : f === 110 ? 'Quake Pro' : String(f); });
    this.btn(ui, rx, y0, 150, 20, 'Difficulty: ' + ['Peaceful', 'Easy', 'Normal', 'Hard'][g.difficulty], () => { g.difficulty = (g.difficulty + 1) % 4; o.difficulty = g.difficulty; g.saveOptions(); }, g.state !== 'title' || true);
    this.btn(ui, lx, y0 + 28, 150, 20, 'Skin Customization...', () => { }, false);
    this.btn(ui, rx, y0 + 28, 150, 20, 'Music & Sounds...', () => g.openScreen(new SoundScreen(g, this)));
    this.btn(ui, lx, y0 + 52, 150, 20, 'Video Settings...', () => g.openScreen(new VideoScreen(g, this)));
    this.btn(ui, rx, y0 + 52, 150, 20, 'Controls...', () => g.openScreen(new ControlsScreen(g, this)));
    this.btn(ui, lx, y0 + 76, 150, 20, 'Language...', () => { }, false);
    this.btn(ui, rx, y0 + 76, 150, 20, 'Chat Settings...', () => { }, false);
    this.btn(ui, lx, y0 + 100, 150, 20, 'Resource Packs...', () => { }, false);
    this.btn(ui, rx, y0 + 100, 150, 20, 'Accessibility Settings...', () => { }, false);
    this.btn(ui, Math.round(W / 2 - 100), H - 27, 200, 20, 'Done', () => { g.saveOptions(); g.openScreen(this.parent); });
  }
  onEscape() { this.game.saveOptions(); this.game.openScreen(this.parent); }
}
class VideoScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.dimWorld = game.state === 'play'; this.pausesGame = true; }
  draw(ui) {
    this.beginFrame(); const g = this.game, o = g.options, W = ui.w, H = ui.h; if (g.state !== 'play') ui.dirtBackground(0, 0, W, H);
    ui.textC('Video Settings', W / 2, 15, '#ffffff');
    const lx = Math.round(W / 2 - 155), rx = Math.round(W / 2 + 5), y0 = 32, dy = 24;
    this.slider(ui, lx, y0, 150, 20, 'Render Distance', (o.renderDistance - 2) / 14, v => { o.renderDistance = Math.round(2 + v * 14); if (g.world) g.world.viewDist = o.renderDistance; if (g.bgWorld) g.bgWorld.viewDist = Math.min(o.renderDistance, 8); }, v => Math.round(2 + v * 14) + ' chunks');
    this.slider(ui, rx, y0, 150, 20, 'GUI Scale', o.guiScale / 6, v => { o.guiScale = Math.round(v * 6); ui.userScale = o.guiScale; ui.cache.clear(); g.renderer.clearIcons(); }, v => Math.round(v * 6) === 0 ? 'Auto' : String(Math.round(v * 6)));
    this.slider(ui, lx, y0 + dy, 150, 20, 'Max Framerate', (Math.min(o.maxFps, 260) - 10) / 250, v => { o.maxFps = Math.round(10 + v * 250); }, v => { const f = Math.round(10 + v * 250); return f >= 260 ? 'Unlimited' : f + ' fps'; });
    this.slider(ui, rx, y0 + dy, 150, 20, 'Brightness', o.gamma, v => { o.gamma = v; }, v => v < 0.02 ? 'Moody' : v > 0.98 ? 'Bright' : Math.round(v * 100) + '%');
    this.btn(ui, lx, y0 + dy * 2, 150, 20, 'Clouds: ' + ['OFF', 'Fast', 'Fancy'][o.clouds], () => { o.clouds = (o.clouds + 1) % 3; g.renderer.cloudCache = { key: '', verts: 0 }; });
    this.btn(ui, rx, y0 + dy * 2, 150, 20, 'View Bobbing: ' + (o.bobbing ? 'ON' : 'OFF'), () => o.bobbing = !o.bobbing);
    this.btn(ui, lx, y0 + dy * 3, 150, 20, 'Particles: ' + ['Minimal', 'Decreased', 'All'][o.particles], () => o.particles = (o.particles + 1) % 3);
    this.btn(ui, rx, y0 + dy * 3, 150, 20, 'Show FPS: ' + (o.showFps ? 'ON' : 'OFF'), () => o.showFps = !o.showFps);
    this.btn(ui, lx, y0 + dy * 4, 150, 20, 'Graphics: Fancy', () => { });
    this.btn(ui, rx, y0 + dy * 4, 150, 20, 'Fullscreen: ' + (document.fullscreenElement ? 'ON' : 'OFF'), () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); });
    this.btn(ui, Math.round(W / 2 - 100), H - 27, 200, 20, 'Done', () => { g.saveOptions(); g.openScreen(this.parent); });
  }
  onEscape() { this.game.saveOptions(); this.game.openScreen(this.parent); }
}
class SoundScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.dimWorld = game.state === 'play'; this.pausesGame = true; }
  draw(ui) {
    this.beginFrame(); const g = this.game, o = g.options, W = ui.w, H = ui.h; if (g.state !== 'play') ui.dirtBackground(0, 0, W, H);
    ui.textC('Music & Sound Options', W / 2, 15, '#ffffff');
    const x = Math.round(W / 2 - 155), y0 = 32, dy = 24;
    const setv = (k, v) => { o[k] = v; if (typeof MCAudio !== 'undefined') try { MCAudio.setVolume(k, v); } catch (e) { } };
    const pct = v => v <= 0 ? 'OFF' : Math.round(v * 100) + '%';
    this.slider(ui, x, y0, 310, 20, 'Master Volume', o.master, v => setv('master', v), pct);
    this.slider(ui, x, y0 + dy, 150, 20, 'Music', o.music, v => setv('music', v), pct);
    this.slider(ui, x + 160, y0 + dy, 150, 20, 'Sound Effects', o.sfx, v => setv('sfx', v), pct);
    this.btn(ui, Math.round(W / 2 - 100), H - 27, 200, 20, 'Done', () => { g.saveOptions(); g.openScreen(this.parent); });
  }
  onEscape() { this.game.saveOptions(); this.game.openScreen(this.parent); }
}
class ControlsScreen extends Screen {
  constructor(game, parent) { super(game); this.parent = parent; this.dimWorld = game.state === 'play'; this.pausesGame = true; this.listen = null; this.scroll = 0; }
  draw(ui) {
    this.beginFrame(); const g = this.game, o = g.options, W = ui.w, H = ui.h; if (g.state !== 'play') ui.dirtBackground(0, 0, W, H);
    ui.textC('Controls', W / 2, 12, '#ffffff');
    const x = Math.round(W / 2 - 155);
    this.slider(ui, x, 28, 150, 20, 'Mouse Sensitivity', o.sensitivity, v => o.sensitivity = v, v => v < 0.01 ? '*yawn*' : v > 0.99 ? 'HYPERSPEED!!!' : Math.round(v * 200) + '%');
    this.btn(ui, x + 160, 28, 150, 20, 'Invert Mouse: ' + (o.invertY ? 'ON' : 'OFF'), () => o.invertY = !o.invertY);
    const names = { forward: 'Walk Forwards', back: 'Walk Backwards', left: 'Strafe Left', right: 'Strafe Right', jump: 'Jump', sneak: 'Sneak', sprint: 'Sprint', inventory: 'Open/Close Inventory', drop: 'Drop Selected Item', chat: 'Open Chat', command: 'Open Command', perspective: 'Toggle Perspective', debug: 'Debug Screen', screenshot: 'Take Screenshot', hud: 'Hide GUI' };
    const keys = Object.keys(names);
    const y0 = 56, rowH = 22;
    ui.g.save(); ui.g.beginPath(); ui.g.rect(0, 52, W, H - 82); ui.g.clip();
    keys.forEach((k, i) => {
      const y = y0 + i * rowH - this.scroll; if (y < 30 || y > H - 30) return;
      ui.text(names[k], x + 2, y + 6, '#ffffff');
      const label = this.listen === k ? '> ' + '???' + ' <' : prettyKey(g.binds[k]);
      this.btn(ui, x + 160, y, 150, 20, label, () => { this.listen = k; });
    });
    ui.g.restore();
    this.btn(ui, Math.round(W / 2 - 100), H - 27, 200, 20, 'Done', () => { g.saveOptions(); g.openScreen(this.parent); });
  }
  wheel(d) { this.scroll = clamp(this.scroll + Math.sign(d) * 22, 0, 15 * 22 - (this.game.ui.h - 110)); if (this.scroll < 0) this.scroll = 0; }
  keyDown(e) {
    if (this.listen) { if (e.code !== 'Escape') this.game.binds[this.listen] = e.code; this.listen = null; e.preventDefault(); return; }
    if (e.code === 'Escape') this.onEscape();
  }
  onEscape() { this.game.saveOptions(); this.game.openScreen(this.parent); }
}
function prettyKey(c) { return c.replace('Key', '').replace('Digit', '').replace('Left', ' Left').replace('Right', ' Right').replace('Control', 'Ctrl').replace('Slash', '/').replace('Space', 'Space'); }

class SleepScreen extends Screen {
  constructor(game) { super(game); this.passive = true; this.needsCursor = false; }
  draw(ui) { const p = this.game.player; ui.textC('Sleeping...', ui.w / 2, ui.h / 2 - 4, '#ffffff'); if (!p.sleeping) this.game.closeScreen(); }
  keyDown(e) { if (e.code === 'Escape' || e.code === 'KeyW' || e.code === 'Space') { this.game.player.sleeping = false; this.game.closeScreen(); } }
}
class DeathScreen extends Screen {
  constructor(game, score) { super(game); this.score = score; this.t0 = now(); }
  draw(ui) {
    this.beginFrame(); const W = ui.w, H = ui.h, g = this.game;
    ui.gradient(0, 0, W, H, 'rgba(80,0,0,0.63)', 'rgba(160,0,0,0.78)');
    ui.textBig('You died!', W / 2, 30, 2, '#ffffff');
    ui.textC('Score: §e' + this.score, W / 2, 100, '#ffffff');
    const bx = Math.round(W / 2 - 100), by = Math.round(H / 4 + 72), en = now() - this.t0 > 1000;
    this.btn(ui, bx, by, 200, 20, 'Respawn', () => g.respawn(), en);
    this.btn(ui, bx, by + 24, 200, 20, 'Title Screen', () => g.quitToTitle(), en);
  }
  keyDown() { }
}
class ChatScreen extends Screen {
  constructor(game, initial) { super(game); this.text = initial || ''; this.isChat = true; this.passive = false; this.needsCursor = false; this.hist = -1; }
  draw(ui) {
    const W = ui.w, H = ui.h, g = ui.g;
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(2, H - 14, W - 4, 12);
    const t = this.text + (((now() / 500) | 0) % 2 ? '_' : '');
    ui.text(t, 4, H - 12, '#e0e0e0');
  }
  keyDown(e) {
    const g = this.game;
    if (e.code === 'Escape') { g.closeScreen(); return; }
    if (e.key === 'Enter') { const t = this.text.trim(); if (t) { (g.chatHistory = g.chatHistory || []).push(t); if (t[0] === '/') { try { g.runCommand(t); } catch (err) { g.addChat('§cCommand failed: ' + err.message); } } else g.addChat('<Player> ' + t); } g.closeScreen(); return; }
    if (e.key === 'Backspace') { this.text = this.text.slice(0, -1); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { const h = g.chatHistory || []; if (h.length) { this.hist = this.hist < 0 ? h.length - 1 : Math.max(0, this.hist - 1); this.text = h[this.hist]; } e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { const h = g.chatHistory || []; if (this.hist >= 0) { this.hist = Math.min(this.hist + 1, h.length); this.text = this.hist >= h.length ? '' : h[this.hist]; } e.preventDefault(); return; }
    if (e.key.length === 1 && !e.ctrlKey && this.text.length < 256) { this.text += e.key; e.preventDefault(); }
  }
  mouseDown() { }
}

// ---------------------------------------------------------------- container screens
class Slot {
  constructor(x, y, get, set, opts) { this.x = x; this.y = y; this.get = get; this.set = set; Object.assign(this, opts || {}); }
}
// GUI progress arrow (empty = gray, filled = white); prog = filled pixel columns
function guiArrow(g, x, y, W, H, prog) {
  const cy = (H - 1) / 2, sh = Math.floor(H * 0.2), hw = Math.round(H * 0.6);
  for (let xx = 0; xx < W; xx++) for (let yy = 0; yy < H; yy++) {
    const dy = Math.abs(yy - cy), k = xx - (W - hw);
    const inA = k < 0 ? dy <= sh : dy <= Math.round(cy * (1 - k / hw));
    if (!inA) continue;
    g.fillStyle = xx < prog ? '#ffffff' : '#8b8b8b'; g.fillRect(x + xx, y + yy, 1, 1);
  }
}
class ContainerScreen extends Screen {
  constructor(game, w, h) {
    super(game); this.cw = w; this.ch = h; this.slots = []; this.cursor = null; this.dimWorld = true; this.passive = false; this.needsCursor = false;
    this.drag = null; this.lastClickSlot = null; this.lastClickT = 0; this.title = '';
  }
  get ox() { return Math.round((this.game.ui.w - this.cw) / 2); }
  get oy() { return Math.round((this.game.ui.h - this.ch) / 2); }
  addPlayerSlots(invY, hotY) {
    const p = this.game.player;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) { const i = 9 + r * 9 + c; this.slots.push(new Slot(8 + c * 18, invY + r * 18, () => p.inv[i], v => { p.inv[i] = v; }, { kind: 'inv', idx: i })); }
    for (let c = 0; c < 9; c++) this.slots.push(new Slot(8 + c * 18, hotY, () => p.inv[c], v => { p.inv[c] = v; }, { kind: 'hot', idx: c }));
  }
  slotAt(mx, my) { const ox = this.ox, oy = this.oy; for (const s of this.slots) if (mx >= ox + s.x && mx < ox + s.x + 18 && my >= oy + s.y && my < oy + s.y + 18) return s; return null; }
  drawSlots(ui, hover) {
    const ox = this.ox, oy = this.oy;
    for (const s of this.slots) {
      const st = s.get();
      if (!s.hidden) { if (s.bare !== true) { /* slot background is part of the panel texture */ } }
      if (st) ui.item(st, ox + s.x + 1, oy + s.y + 1);
      if (hover === s) { ui.g.fillStyle = 'rgba(255,255,255,0.5)'; ui.g.fillRect(ox + s.x + 1, oy + s.y + 1, 16, 16); }
    }
  }
  drawPanelSlots(ui) { const ox = this.ox, oy = this.oy; for (const s of this.slots) if (!s.noBg) ui.slot(ox + s.x, oy + s.y); }
  // vanilla big output slot: 26x26 recessed frame around the 18x18 slot at (sx,sy)
  bigSlot(ui, sx, sy) {
    const g = ui.g, x = this.ox + sx - 4, y = this.oy + sy - 4;
    g.fillStyle = '#373737'; g.fillRect(x, y, 26, 26); g.fillStyle = '#fff'; g.fillRect(x + 1, y + 1, 25, 25); g.fillStyle = '#8b8b8b'; g.fillRect(x + 1, y + 1, 24, 24);
    g.fillStyle = '#373737'; g.fillRect(x + 4, y + 4, 18, 18); g.fillStyle = '#fff'; g.fillRect(x + 5, y + 5, 17, 17); g.fillStyle = '#8b8b8b'; g.fillRect(x + 5, y + 5, 16, 16);
  }
  drawCursorAndTooltip(ui, hover) {
    const m = this.game.mouse;
    if (this.cursor) ui.item(this.cursor, Math.round(m.x) - 8, Math.round(m.y) - 8);
    else if (hover && hover.get()) {
      const s = hover.get(), it = ITEMS[s.id]; const lines = [it.disp];
      if (it.dur) lines.push('§7Durability: ' + (it.dur - (s.d || 0)) + ' / ' + it.dur);
      ui.tooltip(lines, Math.round(m.x), Math.round(m.y));
    }
  }
  canPlace(slot, stack) { if (slot.filter) return slot.filter(stack); return true; }
  // ---- click semantics
  clickSlot(slot, button, shift) {
    const p = this.game.player;
    const cur = this.cursor, st = slot.get();
    if (slot.output) {
      // taking crafting / furnace results
      if (!st) return;
      if (shift) {
        let guard = 0;
        while (slot.get() && guard++ < 64) {
          const mv = cloneStack(slot.get()), cid = mv.id, cnt = mv.n;
          if (!this.quickMove(slot, mv, true)) break;                           // no room at all
          if (slot.take) slot.take(); else slot.set(null);
          this.game.stat('crafted', cid, cnt);
          if (this.onOutputTaken) this.onOutputTaken(slot);                     // furnace experience
          if (mv.n > 0) { this.game.dropStackFromInventory(mv); break; }        // only part fitted: drop the rest instead of destroying it
        }
        return;
      }
      if (cur && (!canMerge(cur, st) || cur.n + st.n > stackMax(cur.id))) return;
      if (!cur) this.cursor = cloneStack(st); else cur.n += st.n;
      this.game.stat('crafted', st.id, st.n);
      if (slot.take) slot.take(); else slot.set(null);
      if (this.onOutputTaken) this.onOutputTaken(slot);
      return;
    }
    if (shift) { if (st) this.quickMoveSlot(slot); return; }
    if (button === 0) {
      if (!cur) { if (st) { this.cursor = st; slot.set(null); } }
      else if (!st) { if (this.canPlace(slot, cur)) { slot.set(cur); this.cursor = null; } }
      else if (canMerge(st, cur)) { const can = Math.min(stackMax(st.id) - st.n, cur.n); if (can > 0 && this.canPlace(slot, cur)) { st.n += can; cur.n -= can; if (cur.n <= 0) this.cursor = null; } }
      else if (this.canPlace(slot, cur)) { slot.set(cur); this.cursor = st; }
    } else if (button === 2) {
      if (!cur) { if (st) { const half = Math.ceil(st.n / 2); this.cursor = cloneStack(st); this.cursor.n = half; st.n -= half; if (st.n <= 0) slot.set(null); } }
      else if (!st) { if (this.canPlace(slot, cur)) { const one = cloneStack(cur); one.n = 1; slot.set(one); cur.n--; if (cur.n <= 0) this.cursor = null; } }
      else if (canMerge(st, cur) && st.n < stackMax(st.id)) { st.n++; cur.n--; if (cur.n <= 0) this.cursor = null; }
      else if (this.canPlace(slot, cur)) { slot.set(cur); this.cursor = st; }
    }
    if (slot.changed) slot.changed();
    if (this.onChange) this.onChange();
  }
  quickMoveSlot(slot) {
    const st = slot.get(); if (!st) return;
    const moved = cloneStack(st);
    if (this.quickMove(slot, moved, false)) { if (moved.n <= 0) slot.set(null); else st.n = moved.n; }
    else { st.n = moved.n; if (st.n <= 0) slot.set(null); }
    if (this.onChange) this.onChange();
  }
  // try to insert `stack` (mutated) into target slots ; returns true if anything moved
  quickMove(fromSlot, stack, isOutput) {
    const targets = this.quickTargets(fromSlot, stack); let moved = false;
    for (const pass of [0, 1]) for (const t of targets) {
      if (stack.n <= 0) break;
      const cs = t.get();
      if (pass === 0) { if (cs && canMerge(cs, stack) && cs.n < stackMax(cs.id)) { const c = Math.min(stackMax(cs.id) - cs.n, stack.n); cs.n += c; stack.n -= c; moved = true; } }
      else if (!cs && (!t.filter || t.filter(stack))) { const put = cloneStack(stack); put.n = Math.min(stack.n, stackMax(stack.id)); t.set(put); stack.n -= put.n; moved = true; }
    }
    return moved;
  }
  quickTargets(fromSlot, stack) {
    // default: move between container part and player part
    const inv = this.slots.filter(s => s.kind === 'inv'), hot = this.slots.filter(s => s.kind === 'hot');
    if (fromSlot.kind === 'inv') return hot;
    if (fromSlot.kind === 'hot') return inv;
    return hot.concat(inv).reverse().length ? inv.concat(hot).slice().reverse().reverse() : [];
  }
  mouseDown(x, y, b) {
    if (b !== 0 && b !== 2) return;
    const slot = this.slotAt(x, y);
    // buttons (tabs etc.)
    if (super.mouseDown) { let hit = false; for (const bt of this.btns) if (x >= bt.x && x < bt.x + bt.w && y >= bt.y && y < bt.y + bt.h) hit = true; if (hit) { super.mouseDown(x, y, b); return; } }
    if (!slot) {
      // outside the panel: drop the cursor item
      const ox = this.ox, oy = this.oy;
      if (this.cursor && (x < ox || y < oy || x > ox + this.cw || y > oy + this.ch)) {
        if (b === 0) { this.game.dropStackFromInventory(this.cursor); this.cursor = null; }
        else { const one = cloneStack(this.cursor); one.n = 1; this.game.dropStackFromInventory(one); this.cursor.n--; if (this.cursor.n <= 0) this.cursor = null; }
      }
      return;
    }
    const shift = this.game.keys.ShiftLeft || this.game.keys.ShiftRight;
    // double click to gather
    if (b === 0 && !shift && this.cursor && this.lastClickSlot === slot && now() - this.lastClickT < 350 && !slot.output) { this.gather(); if (this.onChange) this.onChange(); this.lastClickT = 0; return; }
    this.lastClickSlot = slot; this.lastClickT = now();
    this.clickSlot(slot, b, shift);
  }
  gather() {
    const cur = this.cursor; if (!cur) return;
    for (const s of this.slots) { if (s.output) continue; const st = s.get(); if (st && canMerge(st, cur) && cur.n < stackMax(cur.id)) { const c = Math.min(stackMax(cur.id) - cur.n, st.n); cur.n += c; st.n -= c; if (st.n <= 0) s.set(null); } }
  }
  keyDown(e) {
    const g = this.game;
    if (e.code === 'Escape' || e.code === g.binds.inventory) { g.closeScreen(); return; }
    // number keys swap with hotbar
    if (e.code.startsWith('Digit') && e.code !== 'Digit0') {
      const slot = this.slotAt(g.mouse.x, g.mouse.y), hi = parseInt(e.code.slice(5)) - 1;
      if (slot && !slot.output && !this.cursor) { const p = g.player, a = slot.get(), b = p.inv[hi]; if (!a || this.canPlace(slot, a)) { if (!b || this.canPlace(slot, b)) { slot.set(b); p.inv[hi] = a; if (this.onChange) this.onChange(); } } }
    } else if (e.code === g.binds.drop) {
      const slot = this.slotAt(g.mouse.x, g.mouse.y);
      if (slot && slot.get() && !slot.output) { const st = slot.get(), d = cloneStack(st); const all = e.ctrlKey; d.n = all ? st.n : 1; st.n -= d.n; if (st.n <= 0) slot.set(null); g.dropStackFromInventory(d); if (this.onChange) this.onChange(); }
    }
  }
  onClose() {
    const g = this.game, p = g.player;
    if (this.cursor) { if (!p.giveItem(this.cursor)) g.dropStackFromInventory(this.cursor); this.cursor = null; }
    if (this.returnItems) this.returnItems();
  }
  drawTitle(ui, txt, x, y) { ui.text(txt, this.ox + x, this.oy + y, '#404040', false); }
}

// ---- player preview rendered with GL into a canvas
function renderPlayerPreview(game, w, h, mx, my) {
  const r = game.renderer, gl = r.gl;
  let F = r._prevFBO;
  if (!F || F.w !== w || F.h !== h) {
    if (F) { gl.deleteFramebuffer(F.fb); gl.deleteTexture(F.tex); gl.deleteRenderbuffer(F.rb); }
    const fb = gl.createFramebuffer(), tex = gl.createTexture(), rb = gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    F = r._prevFBO = { fb, tex, rb, w, h, cv: document.createElement('canvas') }; F.cv.width = w; F.cv.height = h;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, F.fb); gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(true);
  const proj = m4Perspective(m4(), 30 * DEG, w / h, 0.1, 40), view = m4Identity(m4());
  m4TranslateM(view, 0, -0.98, -4.2);
  const ent = { px: 0, py: 0, pz: 0, x: 0, y: 0, z: 0, yaw: 0, bodyYaw: -Math.atan(mx / 40) * 0.35 * 1, pbodyYaw: -Math.atan(mx / 40) * 0.35, limbAmt: 0, limbPos: 0, age: game.tick, headYawRel: Math.atan(mx / 40) * 0.5, headPitchRel: Math.atan(my / 40) * 0.5 * -1, hurtTime: 0, deathTime: 0, lightAt: () => [15, 0], sneaking: false, swingProgress: 0 };
  const saved = [r.env.skyLight, r.env.skyTint, r.env.gamma, r.fog.start, r.fog.end, r.env.ambient, r.env.force]; r.env.skyLight = 1; r.env.skyTint = [1, 1, 1]; r.env.gamma = 0; r.fog.start = 1e6; r.fog.end = 2e6; r.env.ambient = 0; r.env.force = 0;
  drawModel(r, ent, MODELS.steve, 1, 0, 0, 0, {});
  r.flushBatch(r.bSkin, true, { mv: view, proj, alphaTest: 0.1 });
  r.env.skyLight = saved[0]; r.env.skyTint = saved[1]; r.env.gamma = saved[2]; r.fog.start = saved[3]; r.fog.end = saved[4]; r.env.ambient = saved[5]; r.env.force = saved[6];
  const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, r.width, r.height);
  const cg = F.cv.getContext('2d'), id = cg.createImageData(w, h);
  for (let y = 0; y < h; y++) id.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  cg.putImageData(id, 0, 0);
  return F.cv;
}

class InventoryScreen extends ContainerScreen {
  constructor(game) {
    super(game, 176, 166);
    const p = game.player;
    this.grid = [null, null, null, null];
    this.result = null;
    const ARMOR_NAMES = ['helmet', 'chestplate', 'leggings', 'boots'];
    for (let i = 0; i < 4; i++) this.slots.push(new Slot(8, 8 + i * 18, () => p.armor[i], v => { p.armor[i] = v; }, { kind: 'armor', filter: s => ITEMS[s.id].armor && ITEMS[s.id].armor.slot === i }));
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) { const i = r * 2 + c; this.slots.push(new Slot(98 + c * 18, 18 + r * 18, () => this.grid[i], v => { this.grid[i] = v; this.updateResult(); }, { kind: 'craft', changed: () => this.updateResult() })); }
    this.slots.push(new Slot(154, 28, () => this.result, v => { this.result = v; }, { output: true, kind: 'out', take: () => this.takeResult() }));
    this.addPlayerSlots(84, 142);
  }
  updateResult() {
    const ids = this.grid.map(s => s ? s.id : 0), r = findRecipe(ids, 2, 2);
    this.result = r ? newStack(r.out, r.count) : null;
  }
  takeResult() { for (let i = 0; i < 4; i++) { const s = this.grid[i]; if (s) { s.n--; if (s.n <= 0) this.grid[i] = null; } } this.updateResult(); this.game.sound('random.pop', undefined, 0, 0, 0.3, 1.2); }
  onChange() { this.updateResult(); }
  quickTargets(from, stack) {
    const inv = this.slots.filter(s => s.kind === 'inv'), hot = this.slots.filter(s => s.kind === 'hot'), armor = this.slots.filter(s => s.kind === 'armor');
    const it = ITEMS[stack.id];
    if (from.kind === 'inv') return (it.armor ? armor : []).concat(hot);
    if (from.kind === 'hot') return (it.armor ? armor : []).concat(inv);
    if (from.output) return hot.slice().reverse().concat(inv.slice().reverse());
    return inv.concat(hot);
  }
  returnItems() { const g = this.game, p = g.player; for (let i = 0; i < 4; i++) if (this.grid[i]) { if (!p.giveItem(this.grid[i])) g.dropStackFromInventory(this.grid[i]); this.grid[i] = null; } }
  onOutputTaken() { }
  draw(ui) {
    this.beginFrame(); const g = this.game, ox = this.ox, oy = this.oy, m = g.mouse;
    ui.panel(ox, oy, 176, 166);
    this.drawPanelSlots(ui);
    // player preview box
    ui.rect(ox + 26, oy + 8, 49, 70, '#000000');
    const pv = renderPlayerPreview(g, 98 * 2 / 2 | 0, 140, m.x - (ox + 51), m.y - (oy + 30));
    ui.g.drawImage(pv, ox + 26, oy + 8, 49, 70);
    // arrow
    guiArrow(ui.g, ox + 134, oy + 30, 16, 11, 0);
    // armor placeholders (ghost icons)
    this.drawTitle(ui, 'Crafting', 98, 8);
    const hover = this.slotAt(m.x, m.y);
    this.drawSlots(ui, hover);
    this.drawCursorAndTooltip(ui, hover);
  }
}
class CraftingScreen extends ContainerScreen {
  constructor(game, target) {
    super(game, 176, 166);
    this.grid = new Array(9).fill(null); this.result = null; this.target = target;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const i = r * 3 + c; this.slots.push(new Slot(30 + c * 18, 17 + r * 18, () => this.grid[i], v => { this.grid[i] = v; }, { kind: 'craft', changed: () => this.updateResult() })); }
    this.slots.push(new Slot(124, 35, () => this.result, v => { this.result = v; }, { output: true, kind: 'out', take: () => this.takeResult() }));
    this.addPlayerSlots(84, 142);
  }
  updateResult() { const r = findRecipe(this.grid.map(s => s ? s.id : 0), 3, 3); this.result = r ? newStack(r.out, r.count) : null; }
  takeResult() { for (let i = 0; i < 9; i++) { const s = this.grid[i]; if (s) { s.n--; if (s.n <= 0) this.grid[i] = null; } } this.updateResult(); this.game.sound('random.pop', undefined, 0, 0, 0.3, 1.2); }
  onChange() { this.updateResult(); }
  quickTargets(from, stack) { const inv = this.slots.filter(s => s.kind === 'inv'), hot = this.slots.filter(s => s.kind === 'hot'); if (from.kind === 'inv') return hot; if (from.kind === 'hot') return inv; if (from.output) return hot.slice().reverse().concat(inv.slice().reverse()); return inv.concat(hot); }
  returnItems() { const g = this.game, p = g.player; for (let i = 0; i < 9; i++) if (this.grid[i]) { if (!p.giveItem(this.grid[i])) g.dropStackFromInventory(this.grid[i]); this.grid[i] = null; } }
  draw(ui) {
    this.beginFrame(); const g = this.game, ox = this.ox, oy = this.oy, m = g.mouse;
    ui.panel(ox, oy, 176, 166); this.drawPanelSlots(ui); this.bigSlot(ui, 124, 35);
    guiArrow(ui.g, ox + 90, oy + 35, 22, 16, 0);
    this.drawTitle(ui, 'Crafting', 28, 6); this.drawTitle(ui, 'Inventory', 8, 72);
    const hover = this.slotAt(m.x, m.y); this.drawSlots(ui, hover); this.drawCursorAndTooltip(ui, hover);
  }
}
class FurnaceScreen extends ContainerScreen {
  constructor(game, t) {
    super(game, 176, 166);
    const w = game.world; this.be = w.blockEntity(t.x, t.y, t.z, () => ({ type: 'furnace', input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 }));
    const be = this.be;
    this.slots.push(new Slot(56, 17, () => be.input, v => { be.input = v; }, { kind: 'in' }));
    this.slots.push(new Slot(56, 53, () => be.fuel, v => { be.fuel = v; }, { kind: 'fuel', filter: s => !!FUEL[s.id] }));
    this.slots.push(new Slot(116, 35, () => be.output, v => { be.output = v; }, { output: true, kind: 'out', take: () => { be.output = null; } }));
    this.addPlayerSlots(84, 142);
    this.t = t;
  }
  onOutputTaken() {
    const be = this.be, p = this.game.player; if (!be.xp) return;
    const n = Math.floor(be.xp) + (Math.random() < be.xp % 1 ? 1 : 0); be.xp = 0;
    if (n > 0 && p.gameMode === 0) { p.addXP(n); this.game.sound('random.orb', p.x, p.y, p.z, 0.15, 0.6 + Math.random() * 0.4); }
  }
  quickTargets(from, stack) {
    const inv = this.slots.filter(s => s.kind === 'inv'), hot = this.slots.filter(s => s.kind === 'hot'), inS = this.slots.find(s => s.kind === 'in'), fuelS = this.slots.find(s => s.kind === 'fuel');
    if (from.kind === 'inv' || from.kind === 'hot') { if (SMELT[stack.id]) return [inS]; if (FUEL[stack.id]) return [fuelS]; return from.kind === 'inv' ? hot : inv; }
    return hot.slice().reverse().concat(inv.slice().reverse());
  }
  draw(ui) {
    this.beginFrame(); const g = this.game, ox = this.ox, oy = this.oy, m = g.mouse, be = this.be;
    ui.panel(ox, oy, 176, 166); this.drawPanelSlots(ui);
    this.bigSlot(ui, 116, 35);
    // flame (unlit silhouette, then the lit part grows from the bottom like the vanilla texture blit)
    const lit = be.burn > 0, fh = lit ? Math.ceil(be.burn / (be.burnMax || 1) * 13) : 0;
    const FL = FurnaceScreen.FLAME, fg = ui.g;
    const fat = (xx, yy) => (xx < 0 || yy < 0 || xx > 13 || yy > 13) ? '.' : FL[yy][xx];
    for (let yy = 0; yy < 14; yy++) for (let xx = 0; xx < 14; xx++) {
      if (fat(xx, yy) === '.') continue;
      const edge = fat(xx - 1, yy) === '.' || fat(xx + 1, yy) === '.' || fat(xx, yy - 1) === '.' || fat(xx, yy + 1) === '.';
      const isLit = fh > 0 && yy >= 12 - fh;
      fg.fillStyle = isLit ? (edge ? '#c25a10' : (yy >= 7 && xx >= 4 && xx <= 10 ? (yy >= 9 ? '#ffec5a' : '#ffc02c') : '#f78a1a')) : (edge ? '#5f5f5f' : '#757575');
      fg.fillRect(ox + 56 + xx, oy + 36 + yy, 1, 1);
    }
    // progress arrow (24x17 box at 79,34); smokers and blast furnaces cook in 100 ticks
    const pw = Math.floor((be.cook || 0) / (be.cookTime || 200) * 24);
    guiArrow(fg, ox + 79, oy + 34, 24, 17, pw);
    const kind = BLOCKS[g.world.getBlock(this.t.x, this.t.y, this.t.z)].furnaceKind, ttl = kind === 'smoker' ? 'Smoker' : kind === 'blast' ? 'Blast Furnace' : 'Furnace';
    this.drawTitle(ui, ttl, 88 - textWidth(ttl) / 2, 6); this.drawTitle(ui, 'Inventory', 8, 72);
    const hover = this.slotAt(m.x, m.y); this.drawSlots(ui, hover); this.drawCursorAndTooltip(ui, hover);
  }
  tick() { }
}
FurnaceScreen.FLAME = [
  '.......oo.....', '......ooo.....', '......ooo...o.', '.....oooo...oo', '.....ooooo.ooo', '....oooooooooo', '....oooooooooo',
  '...ooooooooooo', '...ooooooooooo', '..oooooooooooo', '..oooooooooooo', '..oooooooooooo', '...ooooooooooo', '....oooooooo..'];
class ChestScreen extends ContainerScreen {
  constructor(game, t) {
    super(game, 176, 168);
    this.be = game.world.blockEntity(t.x, t.y, t.z, () => ({ type: 'chest', items: new Array(27).fill(null) })); const be = this.be; this.t = t;
    if (be.loot !== undefined) game.fillChestLoot(be);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) { const i = r * 9 + c; this.slots.push(new Slot(8 + c * 18, 18 + r * 18, () => be.items[i], v => { be.items[i] = v; }, { kind: 'chest' })); }
    this.addPlayerSlots(86, 144);
    game.sound('random.chestopen', t.x + 0.5, t.y + 0.5, t.z + 0.5, 0.6, 0.9);
  }
  quickTargets(from, stack) { const inv = this.slots.filter(s => s.kind === 'inv'), hot = this.slots.filter(s => s.kind === 'hot'), ch = this.slots.filter(s => s.kind === 'chest'); if (from.kind === 'chest') return hot.slice().reverse().concat(inv.slice().reverse()); return ch; }
  onClose() { super.onClose(); this.game.sound('random.chestclosed', this.t.x + 0.5, this.t.y + 0.5, this.t.z + 0.5, 0.6, 0.9); const c = this.game.world.chunkAt(this.t.x, this.t.z); if (c) c.modified = true; }
  draw(ui) {
    this.beginFrame(); const g = this.game, ox = this.ox, oy = this.oy, m = g.mouse;
    ui.panel(ox, oy, 176, 168); this.drawPanelSlots(ui);
    this.drawTitle(ui, BLOCKS[g.world.getBlock(this.t.x, this.t.y, this.t.z)].barrel ? 'Barrel' : 'Chest', 8, 6); this.drawTitle(ui, 'Inventory', 8, 74);
    const hover = this.slotAt(m.x, m.y); this.drawSlots(ui, hover); this.drawCursorAndTooltip(ui, hover);
  }
}

// ---------------------------------------------------------------- creative inventory
const CREATIVE_TABS = [
  { name: 'Building Blocks', icon: 'bricks', filter: it => it.cat === 'block' && /stone|brick|plank|slab|stairs|cobble|sandstone|glass|fence|granite|diorite|andesite|log|wool|_block|glowstone|bookshelf|hay|door|smooth|pane|bars|wall|carpet|trapdoor|terracotta|ancient/.test(it.name) && !/ore/.test(it.name) },
  { name: 'Natural Blocks', icon: 'grass_block', filter: it => it.cat === 'block' && /grass|dirt|podzol|sand$|gravel|clay|snow|ice|obsidian|bedrock|leaves|sapling|_log|ore$|flower|dandelion|poppy|orchid|allium|azure|tulip|daisy|cornflower|mushroom|fern|dead_bush|cactus|sugar|lily|pumpkin|melon|stone$|granite|diorite|andesite|mossy|vine|cobweb|coarse/.test(it.name) && !/wall|terracotta/.test(it.name) },
  { name: 'Functional Blocks', icon: 'crafting_table', filter: it => ['crafting_table', 'furnace', 'chest', 'torch', 'ladder', 'red_bed', 'oak_door', 'bookshelf', 'tnt', 'jack_o_lantern', 'carved_pumpkin', 'glowstone', 'farmland', 'spawner', 'oak_sign', 'smoker', 'blast_furnace', 'barrel', 'composter', 'lectern', 'fletching_table', 'cartography_table', 'smithing_table', 'stonecutter', 'loom', 'grindstone', 'cauldron', 'brewing_stand', 'bell', 'lantern', 'end_rod', 'end_portal_frame', 'dragon_egg', 'shroomlight'].includes(it.name) },
  { name: 'Nether & End', icon: 'netherrack', filter: it => it.cat === 'block' && /nether|soul|magma|basalt|blackstone|crimson|warped|shroomlight|quartz|glowstone|end_stone|purpur|chorus|obsidian|dragon|end_rod|end_portal_frame/.test(it.name) },
  { name: 'Tools & Utilities', icon: 'iron_pickaxe', filter: it => it.cat === 'tool' },
  { name: 'Combat', icon: 'iron_sword', filter: it => it.cat === 'combat' },
  { name: 'Food & Drinks', icon: 'apple', filter: it => it.cat === 'food' },
  { name: 'Ingredients', icon: 'iron_ingot', filter: it => it.cat === 'ingredient' },
  { name: 'Spawn Eggs', icon: 'spawn_egg_creeper', filter: it => it.cat === 'egg' },
];
class CreativeScreen extends ContainerScreen {
  constructor(game) {
    super(game, 195, 136);
    this.tab = 0; this.scroll = 0; this.search = ''; this.items = []; this.dimWorld = true;
    this.buildItems();
    const p = game.player;
    for (let c = 0; c < 9; c++) this.slots.push(new Slot(9 + c * 18, 112, () => p.inv[c], v => { p.inv[c] = v; }, { kind: 'hot', idx: c }));
    this.trash = new Slot(173, 112, () => null, v => { }, { kind: 'trash', noBg: false });
    this.slots.push(this.trash);
    this.gridSlots = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) { const i = r * 9 + c; const s = new Slot(9 + c * 18, 18 + r * 18, () => this.items[this.scroll * 9 + i] ? newStack(this.items[this.scroll * 9 + i], 1) : null, v => { }, { kind: 'palette', palette: true, idx: i }); this.gridSlots.push(s); this.slots.push(s); }
  }
  buildItems() {
    const tab = CREATIVE_TABS[this.tab]; const arr = [];
    for (const it of ITEMS) { if (!it) continue; if (tab.filter(it) && !(it.cat === 'block' && it.name === 'air')) arr.push(it.id); }
    // stable ordering for the block tabs: by id
    this.items = arr; this.scroll = 0;
  }
  clickSlot(slot, button, shift) {
    const p = this.game.player;
    if (slot.kind === 'palette') {
      const st = slot.get(); if (!st) return;
      if (shift) { st.n = stackMax(st.id); if (!p.giveItem(st)) { } return; }
      if (this.cursor && canMerge(this.cursor, st)) { this.cursor.n = Math.min(stackMax(st.id), this.cursor.n + (button === 0 ? stackMax(st.id) : 1)); }
      else this.cursor = newStack(st.id, button === 2 ? stackMax(st.id) : 1);
      if (button === 0) this.cursor.n = 1 + (this.cursor.n > 1 ? this.cursor.n - 1 : 0);
      return;
    }
    if (slot.kind === 'trash') { this.cursor = null; return; }
    super.clickSlot(slot, button, shift);
  }
  mouseDown(x, y, b) {
    // creative: middle-mouse-like behaviour -> left click on palette gives 1, right gives a stack? keep MC: left = stack? MC gives a full stack on click in survival-less; here: left = stack of 64 (or max), right = 1
    const slot = this.slotAt(x, y);
    if (slot && slot.kind === 'palette') {
      const st = slot.get(); if (!st) return;
      const shift = this.game.keys.ShiftLeft;
      if (b === 0) { const full = newStack(st.id, stackMax(st.id)); if (shift) { this.game.player.giveItem(full); } else this.cursor = full; }
      else if (b === 2) { this.cursor = newStack(st.id, 1); }
      return;
    }
    super.mouseDown(x, y, b);
  }
  wheel(d) { const rows = Math.ceil(this.items.length / 9); this.scroll = clamp(this.scroll + Math.sign(d), 0, Math.max(0, rows - 5)); }
  draw(ui) {
    this.beginFrame(); const g = this.game, ox = this.ox, oy = this.oy, m = g.mouse, gg = ui.g;
    // tabs (six along the top, the rest along the bottom, like the vanilla creative inventory)
    const tw = 28, th = 30;
    CREATIVE_TABS.forEach((t, i) => {
      const top = i < 6, tx = ox + (top ? i : i - 6) * (tw + 1), ty = top ? oy - th + 4 : oy + 136 - 4;
      const sel = this.tab === i;
      gg.fillStyle = '#000'; gg.fillRect(tx, ty, tw, th);
      gg.fillStyle = sel ? '#c6c6c6' : '#8b8b8b'; gg.fillRect(tx + 1, ty + (top ? 1 : 0), tw - 2, th - 1);
      gg.fillStyle = sel ? '#ffffff' : '#a5a5a5'; gg.fillRect(tx + 1, ty + (top ? 1 : 0), tw - 2, 1);
      const itm = IID[t.icon];
      if (itm !== undefined) ui.item(newStack(itm, 1), tx + 6, ty + (top ? 8 : 6));
      this.btns.push({ x: tx, y: ty, w: tw, h: th, cb: () => { this.tab = i; this.buildItems(); }, enabled: true, noSound: true });
      if (m.x >= tx && m.x < tx + tw && m.y >= ty && m.y < ty + th) this._tabHover = t.name;
    });
    ui.panel(ox, oy, 195, 136);
    // slot backgrounds
    for (const s of this.slots) ui.slot(ox + s.x, oy + s.y);
    // scrollbar
    const rows = Math.ceil(this.items.length / 9), maxS = Math.max(0, rows - 5);
    gg.fillStyle = '#373737'; gg.fillRect(ox + 174, oy + 17, 14, 92); gg.fillStyle = '#8b8b8b'; gg.fillRect(ox + 175, oy + 18, 12, 90);
    const hy = maxS ? Math.round((90 - 15) * this.scroll / maxS) : 0;
    gg.fillStyle = '#c6c6c6'; gg.fillRect(ox + 175, oy + 18 + hy, 12, 15); gg.fillStyle = '#fff'; gg.fillRect(ox + 175, oy + 18 + hy, 12, 1); gg.fillStyle = '#555'; gg.fillRect(ox + 175, oy + 32 + hy, 12, 1);
    ui.text(CREATIVE_TABS[this.tab].name, ox + 8, oy + 6, '#404040', false);
    const hover = this.slotAt(m.x, m.y); this.drawSlots(ui, hover);
    // trash icon
    ui.text('x', ox + 173 + 6, oy + 112 + 5, '#a04040', false);
    this.drawCursorAndTooltip(ui, hover);
    for (let i = 0; i < CREATIVE_TABS.length; i++) { }
    const hb = this.btns.find(b => m.x >= b.x && m.x < b.x + b.w && m.y >= b.y && m.y < b.y + b.h);
    if (hb && hb.cb && !hover) { const i = this.btns.indexOf(hb); if (CREATIVE_TABS[i]) ui.tooltip([CREATIVE_TABS[i].name], Math.round(m.x), Math.round(m.y)); }
  }
  wheelScroll() { }
}
