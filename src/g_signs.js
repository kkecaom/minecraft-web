// ===== g_signs.js : signs. Block entity { type: 'sign', lines: [4 strings] }, edit screen, in-world text =====
// Loaded after g_game.js. Adds SignScreen and Game.prototype.{placeSign, signSetup, signCell, renderSigns}.
// Sign text lives in a small 2D canvas atlas (one 96x48 cell per board face = 96 font pixels per block, like vanilla's 1/96 text scale)
// that is drawn with the bitmap font and sampled by the skin shader through the extra `bSign` dynamic batch.
const SIGN_CW = 96, SIGN_CH = 48, SIGN_COLS = 5, SIGN_ROWS = 5;
const SIGN_NORMAL = { 0: [0, 1], 1: [-1, 0], 2: [0, -1], 3: [1, 0] };        // standing sign meta (quarter turns) -> outward normal (x,z)
const SIGN_WALL_NORMAL = { 2: [0, -1], 3: [0, 1], 4: [-1, 0], 5: [1, 0] };   // wall sign meta (clicked face) -> outward normal (x,z)

class SignScreen extends Screen {
  constructor(game, t) {
    super(game); this.t = t; this.dimWorld = true; this.needsCursor = false; this.line = 0; this.t0 = now();
    const be = game.world.blockEntity(t.x, t.y, t.z, () => ({ type: 'sign', lines: ['', '', '', ''] }));
    if (be && !be.lines) be.lines = ['', '', '', ''];
    this.be = be || { type: 'sign', lines: ['', '', '', ''] };
  }
  draw(ui) {
    this.beginFrame();
    const g = ui.g, W = ui.w, H = ui.h, L = this.be.lines, r = this.game.renderer;
    ui.textC('Edit sign message:', W / 2, 40, '#ffffff');
    // the sign model as vanilla shows it: 94x47 board on a short post, centred, board top at y=68
    const bw = 94, bh = 47, bx = Math.round(W / 2 - bw / 2), by = 68, px = Math.round(W / 2 - 4);
    const rl = r.tileRect('oak_log'), rp = r.tileRect('oak_planks');
    g.save(); g.imageSmoothingEnabled = false;
    if (rl) g.drawImage(r.atlasCanvas, rl.x + 4, rl.y, 8, 16, px, by + bh - 1, 8, 56); else { g.fillStyle = '#6b5233'; g.fillRect(px, by + bh - 1, 8, 56); }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(px + 6, by + bh - 1, 2, 56);
    if (rp) g.drawImage(r.atlasCanvas, rp.x, rp.y + 4, 16, 8, bx, by, bw, bh); else { g.fillStyle = '#a08050'; g.fillRect(bx, by, bw, bh); }
    g.fillStyle = 'rgba(52,36,16,0.8)'; g.fillRect(bx, by, bw, 2); g.fillRect(bx, by + bh - 2, bw, 2); g.fillRect(bx, by, 2, bh); g.fillRect(bx + bw - 2, by, 2, bh);
    g.restore();
    const blink = Math.floor((now() - this.t0) / 300) % 2 === 0;
    for (let i = 0; i < 4; i++) {
      const s = L[i] || '', tw = textWidth(s), sx = Math.round(W / 2 - tw / 2), y = by + 4 + Math.round(i * 9.77);
      ui.text(s, sx, y, '#000000', false);
      if (i === this.line) {
        ui.text('> ', sx - textWidth('> '), y, '#000000', false);
        if (blink) ui.text('_', sx + tw, y, '#000000', false);
        ui.text(' <', sx + tw + textWidth('_'), y, '#000000', false);
      }
    }
    this.btn(ui, Math.round(W / 2 - 100), Math.round(H / 4 + 120), 200, 20, 'Done', () => this.game.closeScreen());
  }
  keyDown(e) {
    if (e.code === 'Escape') { this.game.closeScreen(); return; }
    const L = this.be.lines, k = e.key;
    if (k === 'Enter' || k === 'ArrowDown') { this.line = (this.line + 1) & 3; e.preventDefault(); }
    else if (k === 'ArrowUp') { this.line = (this.line + 3) & 3; e.preventDefault(); }
    else if (k === 'Backspace') { L[this.line] = L[this.line].slice(0, -1); e.preventDefault(); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && textWidth(L[this.line] + k) <= 90) { L[this.line] += k; e.preventDefault(); }
  }
  onClose() { const c = this.game.world.chunkAt(this.t.x, this.t.z); if (c) c.modified = true; }
}

Object.assign(Game.prototype, {
  // sign item on a block: top face -> standing sign facing the player, side face -> wall sign; opens the editor afterwards
  placeSign(t, s, it) {
    const w = this.world, p = this.player, tb = BLOCKS[t.id], face = t.face;
    if (face === 0) return;
    const replaceTarget = tb.replaceable && !T_FLUID[t.id];
    let x = t.x, y = t.y, z = t.z;
    if (!replaceTarget) { x += DIRS[face][0]; y += DIRS[face][1]; z += DIRS[face][2]; }
    if (y < 0 || y > 255) return;
    const cur = w.getBlock(x, y, z);
    if (cur !== 0 && T_REPL[cur] !== 1) return;
    if (T_FLUID[cur] && !T_REPL[cur]) return;
    const yawDeg = ((p.yaw / DEG) % 360 + 360) % 360, facingDir = yawDeg >= 315 || yawDeg < 45 ? 0 : yawDeg < 135 ? 1 : yawDeg < 225 ? 2 : 3;
    let id, meta;
    if (face === 1) { if (T_SOLID[w.getBlock(x, y - 1, z)] !== 1) return; id = BID.oak_sign; meta = (facingDir + 2) & 3; }
    else { if (replaceTarget || T_SOLID[t.id] !== 1) return; id = BID.oak_wall_sign; meta = face; }
    w.setBlock(x, y, z, id, meta, 8);
    w.blockEntity(x, y, z, () => ({ type: 'sign', lines: ['', '', '', ''] }));
    this.finishPlace(s, x, y, z, id);
    this.openScreen(new SignScreen(this, { x, y, z, id, meta }));
  },
  signSetup() {
    if (this.signAtlas) return;
    const r = this.renderer, gl = r.gl, cv = document.createElement('canvas');
    cv.width = SIGN_COLS * SIGN_CW; cv.height = SIGN_ROWS * SIGN_CH;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.signAtlas = { cv, g, tex, slots: new Map(), free: Array.from({ length: SIGN_COLS * SIGN_ROWS }, (_, i) => SIGN_COLS * SIGN_ROWS - 1 - i) };
    r.signTex = tex; r.bSign = new DynBatch(gl, 4 * SIGN_COLS * SIGN_ROWS);
  },
  // atlas cell holding the rendered text of one sign (allocated on first use, least recently drawn cell recycled); -1 when every cell is in use this frame
  signCell(be, key, frame) {
    const A = this.signAtlas, text = be.lines.join('\n');
    let s = A.slots.get(key);
    if (!s) {
      if (!A.free.length) {
        let oldK = null, oldF = Infinity;
        for (const [k, v] of A.slots) if (v.frame !== frame && v.frame < oldF) { oldF = v.frame; oldK = k; }
        if (oldK === null) return -1;
        A.free.push(A.slots.get(oldK).i); A.slots.delete(oldK);
      }
      s = { i: A.free.pop(), text: null, frame };
      A.slots.set(key, s);
    }
    s.frame = frame;
    if (s.text !== text) {
      s.text = text;
      const cx = (s.i % SIGN_COLS) * SIGN_CW, cy = ((s.i / SIGN_COLS) | 0) * SIGN_CH, ui = this.ui, saved = ui.g, g = A.g;
      g.clearRect(cx, cy, SIGN_CW, SIGN_CH);
      ui.g = g;
      try {
        for (let l = 0; l < 4; l++) { const line = be.lines[l]; if (line) ui.text(line, cx + Math.round((SIGN_CW - textWidth(line)) / 2), cy + 4 + l * 10, '#000000', false); }
      } finally { ui.g = saved; }
      const gl = this.renderer.gl;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, cx, cy, gl.RGBA, gl.UNSIGNED_BYTE, g.getImageData(cx, cy, SIGN_CW, SIGN_CH));
    }
    return s.i;
  },
  // queue the text quad of every written sign within 16 blocks whose front faces the camera (drawn by the caller with r.bSign / r.signTex)
  renderSigns(partial, cx, cy, cz) {
    const w = this.world, p = this.player, pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4, list = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = w.getChunk(pcx + dx, pcz + dz); if (!c || !c.be.size) continue;
      for (const [k, be] of c.be) {
        if (be.type !== 'sign' || !be.lines || !(be.lines[0] || be.lines[1] || be.lines[2] || be.lines[3])) continue;
        const y = k >> 8, x = (c.cx << 4) + (k & 15), z = (c.cz << 4) + ((k >> 4) & 15);
        const mx = x + 0.5 - cx, my = y + 0.5 - cy, mz = z + 0.5 - cz, d2 = mx * mx + my * my + mz * mz;
        if (d2 <= 256) list.push({ x, y, z, be, d2 });
      }
    }
    if (!list.length) return;
    this.signSetup();
    if (list.length > SIGN_COLS * SIGN_ROWS) { list.sort((a, b) => a.d2 - b.d2); list.length = SIGN_COLS * SIGN_ROWS; }
    const b = this.renderer.bSign, frame = this.tick * 1000 + ((partial * 999) | 0);
    for (const q of list) {
      const { x, y, z, be } = q, d = BLOCKS[w.getBlock(x, y, z)];
      if (!d || !d.sign) continue;
      const meta = w.getMeta(x, y, z), n = d.wallSign ? SIGN_WALL_NORMAL[meta] : SIGN_NORMAL[meta & 3];
      if (!n) continue;
      // board centre (wall boards hug the wall), text plane a hair in front of the board face
      const bxc = x + 0.5 - (d.wallSign ? n[0] * (0.5 - 1 / 16) : 0), bzc = z + 0.5 - (d.wallSign ? n[1] * (0.5 - 1 / 16) : 0), off = 1 / 16 + 0.006;
      const fx = bxc + n[0] * off, fz = bzc + n[1] * off;
      if ((cx - fx) * n[0] + (cz - fz) * n[1] <= 0) continue;
      const i = this.signCell(be, x + ',' + y + ',' + z, frame); if (i < 0) continue;
      const y0 = y + (d.wallSign ? 4.5 : 8) / 16, y1 = y + (d.wallSign ? 12.5 : 16) / 16, rx = n[1], rz = -n[0];
      const u0 = (i % SIGN_COLS) / SIGN_COLS, v0 = ((i / SIGN_COLS) | 0) / SIGN_ROWS, u1 = u0 + 1 / SIGN_COLS, v1 = v0 + 1 / SIGN_ROWS;
      const sky = w.getSky(x, y, z) / 15, blk = w.getBlk(x, y, z) / 15;
      const lx = fx - rx * 0.5 - cx, lz = fz - rz * 0.5 - cz, ex = fx + rx * 0.5 - cx, ez = fz + rz * 0.5 - cz;
      b.v(lx, y1 - cy, lz, u0, v0, 0, 1, 1, 1, 1, sky, blk); b.v(lx, y0 - cy, lz, u0, v1, 0, 1, 1, 1, 1, sky, blk);
      b.v(ex, y0 - cy, ez, u1, v1, 0, 1, 1, 1, 1, sky, blk); b.v(ex, y1 - cy, ez, u1, v0, 0, 1, 1, 1, 1, sky, blk);
    }
  },
});
