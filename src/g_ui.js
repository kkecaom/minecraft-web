// ===== g_ui.js : bitmap font, GUI drawing helpers, HUD =====
// ---------------------------------------------------------------- font (5x7 glyphs, Minecraft-style proportions; 9 rows with descenders)
const FONT_DEF = {
  ' ': ['...'], '!': ['#', '#', '#', '#', '#', '.', '#'], '"': ['#.#', '#.#'], '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'], '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'], "'": ['#', '#'], '(': ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  ')': ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'], '*': ['...', '#.#', '.#.', '#.#'], '+': ['.....', '.....', '..#..', '..#..', '#####', '..#..', '..#..'],
  ',': ['.', '.', '.', '.', '.', '.', '#', '#'], '-': ['.....', '.....', '.....', '#####'], '.': ['.', '.', '.', '.', '.', '.', '#'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], '1': ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'], '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'], '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'], '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.', '.', '#', '.', '.', '#'], ';': ['.', '.', '#', '.', '.', '#', '#', '#'], '<': ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '=': ['.....', '.....', '#####', '.....', '#####'], '>': ['#...', '.#..', '..#.', '...#', '..#.', '.#..', '#...'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'], '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.####'],
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], 'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], 'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], 'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'], 'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'I': ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'], 'J': ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'], 'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'], 'N': ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], 'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'], 'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  'S': ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.'], 'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], 'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'], 'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'], 'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '[': ['###', '#..', '#..', '#..', '#..', '#..', '###'], '\\': ['#....', '.#...', '.#...', '..#..', '...#.', '...#.', '....#'], ']': ['###', '..#', '..#', '..#', '..#', '..#', '###'],
  '^': ['.#.', '#.#'], '_': ['.....', '.....', '.....', '.....', '.....', '.....', '.....', '.....', '#####'], '`': ['#.', '.#'],
  'a': ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'], 'b': ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
  'c': ['.....', '.....', '.###.', '#...#', '#....', '#...#', '.###.'], 'd': ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  'e': ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'], 'f': ['..##', '.#..', '###.', '.#..', '.#..', '.#..', '.#..'],
  'g': ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#', '#...#', '.###.'], 'h': ['#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'],
  'i': ['#', '.', '#', '#', '#', '#', '#'], 'j': ['..#', '...', '..#', '..#', '..#', '..#', '..#', '#.#', '.#.'],
  'k': ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'], 'l': ['##', '.#', '.#', '.#', '.#', '.#', '.#'],
  'm': ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'], 'n': ['.....', '.....', '####.', '#...#', '#...#', '#...#', '#...#'],
  'o': ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'], 'p': ['.....', '.....', '####.', '#...#', '#...#', '####.', '#....', '#....'],
  'q': ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#', '....#'], 'r': ['....', '....', '#.##', '##..', '#...', '#...', '#...'],
  's': ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'], 't': ['...', '.#.', '###', '.#.', '.#.', '.#.', '..#'],
  'u': ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'], 'v': ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'w': ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'], 'x': ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  'y': ['.....', '.....', '#...#', '#...#', '#...#', '.####', '....#', '#...#', '.###.'], 'z': ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],
  '{': ['..##', '.#..', '.#..', '#...', '.#..', '.#..', '..##'], '|': ['#', '#', '#', '#', '#', '#', '#', '#', '#'], '}': ['##..', '..#.', '..#.', '...#', '..#.', '..#.', '##..'],
  '~': ['.....', '.....', '.....', '.##.#', '#.##.'],
  '×': ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  '•': ['...', '.#.', '###', '.#.'],
};
const FONT = { glyphs: {}, cellW: 8, cellH: 10, atlases: {}, cols: 16 };
(function buildFont() {
  const keys = Object.keys(FONT_DEF);
  FONT.keys = keys;
  for (let i = 0; i < keys.length; i++) {
    const rows = FONT_DEF[keys[i]];
    let w = 0;
    for (const r of rows) { const l = r.lastIndexOf('#'); if (l + 1 > w) w = l + 1; }
    if (keys[i] === ' ') w = 3;
    FONT.glyphs[keys[i]] = { rows, w: w || 3, i };
  }
})();
function fontAtlas(color) {
  let a = FONT.atlases[color];
  if (a) return a;
  const cols = FONT.cols, n = FONT.keys.length, rows = Math.ceil(n / cols);
  const cv = document.createElement('canvas'); cv.width = cols * FONT.cellW; cv.height = rows * FONT.cellH;
  const g = cv.getContext('2d'); g.fillStyle = color;
  for (const k of FONT.keys) {
    const gl = FONT.glyphs[k], cx = (gl.i % cols) * FONT.cellW, cy = ((gl.i / cols) | 0) * FONT.cellH;
    for (let y = 0; y < gl.rows.length; y++) for (let x = 0; x < gl.rows[y].length; x++) if (gl.rows[y][x] === '#') g.fillRect(cx + x, cy + y, 1, 1);
  }
  FONT.atlases[color] = cv;
  return cv;
}
const MC_COLORS = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#ffaa00', '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'];
const MC_SHADOWS = MC_COLORS.map(c => { const v = parseInt(c.slice(1), 16); return cssRGB(((v >> 16) & 255) >> 2, ((v >> 8) & 255) >> 2, (v & 255) >> 2); });
function shadowOf(col) {
  if (col[0] === '#') { const v = parseInt(col.slice(1), 16); return cssRGB(((v >> 16) & 255) >> 2, ((v >> 8) & 255) >> 2, (v & 255) >> 2); }
  return '#000';
}
function textWidth(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '§') { i++; continue; }
    const g = FONT.glyphs[ch] || FONT.glyphs['?'];
    w += g.w + 1;
  }
  return Math.max(0, w - 1) + (s.length ? 0 : 0);
}

// ---------------------------------------------------------------- UI helper (draws in GUI units)
class UI {
  constructor(canvas, game) {
    this.canvas = canvas; this.g = canvas.getContext('2d'); this.game = game;
    this.scale = 2; this.w = 0; this.h = 0; this.mx = 0; this.my = 0; this.cache = new Map();
    this.autoScale = true; this.userScale = 0;
  }
  computeScale() {
    const W = this.canvas.width, H = this.canvas.height;
    let max = Math.max(1, Math.min(Math.floor(W / 320), Math.floor(H / 240)));
    let s = this.userScale > 0 ? Math.min(this.userScale, max) : max;
    return Math.max(1, s);
  }
  begin() {
    const g = this.g;
    this.scale = this.computeScale();
    this.w = this.canvas.width / this.scale; this.h = this.canvas.height / this.scale;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.imageSmoothingEnabled = false; g.textBaseline = 'top';
  }
  // ---- text
  text(s, x, y, color, shadow) {
    const g = this.g; color = color || '#ffffff';
    if (shadow === undefined) shadow = true;
    let cx = x;
    let cur = color;
    const drawRun = (col, ox, oy) => {
      const atlas = fontAtlas(col); let px = x;
      let c2 = col;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '§' && i + 1 < s.length) { const ci = '0123456789abcdef'.indexOf(s[i + 1].toLowerCase()); if (ci >= 0) { c2 = ox ? MC_SHADOWS[ci] : MC_COLORS[ci]; } else if (s[i + 1] === 'r') c2 = col; i++; continue; }
        const gl = FONT.glyphs[ch] || FONT.glyphs['?'];
        const at = c2 === col ? atlas : fontAtlas(c2);
        g.drawImage(at, (gl.i % FONT.cols) * FONT.cellW, ((gl.i / FONT.cols) | 0) * FONT.cellH, FONT.cellW, FONT.cellH, px + ox, y + oy - 1 + 1, FONT.cellW, FONT.cellH);
        px += gl.w + 1;
      }
    };
    if (shadow) drawRun(shadowOf(color), 1, 1);
    drawRun(color, 0, 0);
    return textWidth(s);
  }
  textC(s, cx, y, color, shadow) { const w = textWidth(s); this.text(s, Math.round(cx - w / 2), y, color, shadow); }
  textR(s, rx, y, color, shadow) { const w = textWidth(s); this.text(s, rx - w, y, color, shadow); }
  textBig(s, cx, y, scale, color, shadow) { const g = this.g; g.save(); g.translate(cx, y); g.scale(scale, scale); this.textC(s, 0, 0, color, shadow); g.restore(); }
  wrap(s, maxW) {
    const words = s.split(' '), lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (textWidth(t) > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  }
  // ---- primitives
  rect(x, y, w, h, color) { this.g.fillStyle = color; this.g.fillRect(x, y, w, h); }
  gradient(x, y, w, h, c1, c2) { const g = this.g, gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(x, y, w, h); }
  // tile sprite from the atlas (16x16) at GUI size s
  tile(name, x, y, s, tint) {
    const r = this.game.renderer, rc = r.tileRect(name); if (!rc) return false;
    this.g.drawImage(r.atlasCanvas, rc.x, rc.y, 16, 16, x, y, s || 16, s || 16);
    return true;
  }
  // tiled dirt background (options screen look)
  dirtBackground(x, y, w, h, dark) {
    const r = this.game.renderer, g = this.g;
    let pat = this.cache.get('dirtpat');
    if (!pat) {
      const c = document.createElement('canvas'); c.width = 32; c.height = 32; const cg = c.getContext('2d'); cg.imageSmoothingEnabled = false;
      const rc = r.tileRect('dirt'); if (rc) cg.drawImage(r.atlasCanvas, rc.x, rc.y, 16, 16, 0, 0, 32, 32); else { cg.fillStyle = '#866043'; cg.fillRect(0, 0, 32, 32); }
      cg.fillStyle = 'rgba(0,0,0,0.75)'; cg.fillRect(0, 0, 32, 32);
      pat = c; this.cache.set('dirtpat', c);
    }
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    for (let yy = Math.floor(y / 32) * 32; yy < y + h; yy += 32) for (let xx = Math.floor(x / 32) * 32; xx < x + w; xx += 32) g.drawImage(pat, xx, yy);
    g.restore();
  }
  // container panel (inventory look)
  panel(x, y, w, h) {
    const g = this.g;
    g.fillStyle = '#c6c6c6'; g.fillRect(x, y, w, h);
    g.fillStyle = '#ffffff'; g.fillRect(x + 3, y + 3, w - 6, 1); g.fillRect(x + 3, y + 3, 1, h - 6);   // inner highlight
    g.fillRect(x + 2, y + 2, w - 4, 1); g.fillRect(x + 2, y + 2, 1, h - 4);
    g.fillStyle = '#555555'; g.fillRect(x + w - 4, y + 3, 2, h - 5); g.fillRect(x + 3, y + h - 4, w - 5, 2);
    g.fillStyle = '#c6c6c6'; g.fillRect(x + 3, y + 3, w - 7, h - 7);
    g.fillStyle = '#ffffff'; g.fillRect(x + 3, y + 3, w - 7, 1); g.fillRect(x + 3, y + 3, 1, h - 7);
    g.fillStyle = '#555555'; g.fillRect(x + w - 5, y + 4, 1, h - 8); g.fillRect(x + 4, y + h - 5, w - 8, 1);
    g.fillStyle = '#c6c6c6'; g.fillRect(x + 4, y + 4, w - 9, h - 9);
    // black outline with cut corners
    g.fillStyle = '#000'; g.fillRect(x + 2, y, w - 4, 2); g.fillRect(x + 2, y + h - 2, w - 4, 2); g.fillRect(x, y + 2, 2, h - 4); g.fillRect(x + w - 2, y + 2, 2, h - 4);
    g.fillRect(x + 2, y + 2, 1, 1); g.fillRect(x + w - 3, y + 2, 1, 1); g.fillRect(x + 2, y + h - 3, 1, 1); g.fillRect(x + w - 3, y + h - 3, 1, 1);
    g.fillStyle = '#c6c6c6'; g.fillRect(x + 1, y + 1, 1, 1); g.fillRect(x + w - 2, y + 1, 1, 1); g.fillRect(x + 1, y + h - 2, 1, 1); g.fillRect(x + w - 2, y + h - 2, 1, 1);
    g.fillStyle = '#000'; g.fillRect(x + 1, y + 1, 1, 1); g.fillRect(x + w - 2, y + 1, 1, 1); g.fillRect(x + 1, y + h - 2, 1, 1); g.fillRect(x + w - 2, y + h - 2, 1, 1);
    g.fillStyle = '#c6c6c6'; g.fillRect(x + 2, y + 2, 1, 1); g.fillStyle = '#fff'; g.fillRect(x + 2, y + 2, 1, 1);
    g.fillStyle = '#c6c6c6'; g.fillRect(x + w - 3, y + h - 3, 1, 1);
  }
  slot(x, y) { const g = this.g; g.fillStyle = '#373737'; g.fillRect(x, y, 18, 18); g.fillStyle = '#ffffff'; g.fillRect(x + 1, y + 1, 17, 17); g.fillStyle = '#8b8b8b'; g.fillRect(x + 1, y + 1, 16, 16); g.fillStyle = '#c6c6c6'; g.fillRect(x + 17, y, 1, 1); g.fillRect(x, y + 17, 1, 1); }
  // button (normal/hover/disabled) drawn from cached bitmaps
  buttonImage(w, h, state) {
    const key = 'btn' + w + 'x' + h + ':' + state;
    let c = this.cache.get(key); if (c) return c;
    c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    const rnd = mulberry32(w * 31 + h * 17 + state);
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
    const gray = (v) => { const n = (rnd() * 6 - 3) | 0; v = clamp(v + n, 0, 255); return cssRGB(v, v, v); };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let col;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (state === 2) { // disabled
        col = edge ? '#000' : gray(0x2c);
      } else if (edge) col = state === 1 ? '#ffffff' : '#000000';
      else if (y === 1 || x === 1) col = gray(state === 1 ? 0xaf : 0xaa);
      else if (y >= h - 3 || x >= w - 2) col = gray(state === 1 ? 0x5c : 0x56);
      else col = gray(state === 1 ? 0x76 : 0x6f);
      px(x, y, col);
    }
    if (state !== 2) { px(1, h - 2, state === 1 ? '#afafaf' : '#aaaaaa'); }
    this.cache.set(key, c);
    return c;
  }
  button(x, y, w, h, label, enabled, hover) {
    const state = !enabled ? 2 : hover ? 1 : 0;
    this.g.drawImage(this.buttonImage(w, h, state), x, y);
    this.textC(label, x + w / 2, y + (h - 8) / 2 + 0, enabled ? (hover ? '#ffffa0' : '#ffffff') : '#a0a0a0');
  }
  // 9-slice-free simple text field
  field(x, y, w, h, text, focused, placeholder) {
    const g = this.g;
    g.fillStyle = focused ? '#ffffff' : '#a0a0a0'; g.fillRect(x, y, w, h);
    g.fillStyle = '#000'; g.fillRect(x + 1, y + 1, w - 2, h - 2);
    const show = text || (focused ? '' : placeholder || '');
    this.text(show, x + 4, y + (h - 8) / 2 + 0, text ? '#e0e0e0' : '#707070');
    if (focused && ((now() / 500) | 0) % 2 === 0) this.text('_', x + 4 + textWidth(text), y + (h - 8) / 2, '#e0e0e0');
  }
  // item stack (icon + count + durability bar)
  item(stack, x, y, opts) {
    if (!stack) return;
    const it = ITEMS[stack.id]; if (!it) return;
    const g = this.g, r = this.game.renderer;
    const size = 16;
    if (it.tile && (it.flat || it.blk < 0 || !it.blk || it.tile)) {
      const rc = r.tileRect(it.tile);
      if (rc) {
        if (it.iconTint) {
          let c = this.cache.get('tint:' + it.tile); if (!c) { c = document.createElement('canvas'); c.width = 16; c.height = 16; const cg = c.getContext('2d'); cg.drawImage(r.atlasCanvas, rc.x, rc.y, 16, 16, 0, 0, 16, 16); cg.globalCompositeOperation = 'multiply'; cg.fillStyle = cssRGB(it.iconTint[0], it.iconTint[1], it.iconTint[2]); cg.fillRect(0, 0, 16, 16); cg.globalCompositeOperation = 'destination-in'; cg.drawImage(r.atlasCanvas, rc.x, rc.y, 16, 16, 0, 0, 16, 16); this.cache.set('tint:' + it.tile, c); }
          g.drawImage(c, x, y, 16, 16);
        } else g.drawImage(r.atlasCanvas, rc.x, rc.y, 16, 16, x, y, 16, 16);
      }
    } else {
      const px = Math.round(16 * this.scale);
      const ic = r.iconCanvas(stack.id, px);
      if (ic) { g.drawImage(ic, x, y, 16, 16); }
    }
    if (it.dur && stack.d > 0) {
      const f = 1 - stack.d / it.dur, w = Math.round(13 * f), hue = f * 120;
      g.fillStyle = '#000'; g.fillRect(x + 2, y + 13, 13, 2);
      g.fillStyle = 'hsl(' + hue + ',100%,50%)'; g.fillRect(x + 2, y + 13, w, 1);
    }
    if (stack.n > 1 || (opts && opts.count)) {
      const s = String(stack.n);
      this.text(s, x + 17 - textWidth(s), y + 9, '#ffffff', true);
    }
  }
  // tooltip box near the cursor
  tooltip(lines, x, y) {
    const g = this.g;
    let w = 0; for (const l of lines) w = Math.max(w, textWidth(l.replace(/§./g, '')));
    const h = lines.length > 1 ? 8 + (lines.length - 1) * 10 + 2 : 8;
    let tx = x + 12, ty = y - 12;
    if (tx + w + 8 > this.w) tx = x - 12 - w - 8;
    if (ty + h + 6 > this.h) ty = this.h - h - 6;
    if (ty < 4) ty = 4;
    g.fillStyle = '#100010f0'; g.fillRect(tx - 3, ty - 4, w + 6, h + 8);
    g.fillRect(tx - 4, ty - 3, w + 8, h + 6);
    g.fillStyle = '#5000ffff'; g.fillStyle = 'rgba(80,0,255,0.31)';
    g.fillRect(tx - 3, ty - 3, w + 6, 1); g.fillRect(tx - 3, ty + h + 2, w + 6, 1); g.fillRect(tx - 3, ty - 3, 1, h + 6); g.fillRect(tx + w + 2, ty - 3, 1, h + 6);
    g.fillStyle = 'rgba(40,0,127,0.31)'; g.fillRect(tx - 3, ty + h + 2, w + 6, 1);
    lines.forEach((l, i) => this.text(l, tx, ty + (i === 0 ? 0 : 2 + i * 10), i === 0 ? undefined : '#aaaaaa'));
  }
}

// ---------------------------------------------------------------- HUD
function drawHeart(ui, x, y, type, half, blink) {
  // type: 0 container only ; 1 full/half filled ; drawn with the entity icon module when available
  const g = ui.g, icons = ui.game.icons;
  if (icons) {
    const cont = blink ? icons.heart_container_blink || icons.heart_container : icons.heart_container;
    if (cont) g.drawImage(cont, x, y);
    if (type) { const im = half ? (blink ? icons.heart_half_blink || icons.heart_half : icons.heart_half) : (blink ? icons.heart_full_blink || icons.heart_full : icons.heart_full); if (im) g.drawImage(im, x, y); }
    return;
  }
  const P = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  g.fillStyle = blink ? '#fff' : '#000'; g.fillRect(x, y, 9, 9);
  g.fillStyle = '#3a0000'; g.fillRect(x + 1, y + 1, 7, 6);
  if (type) { g.fillStyle = '#ff1313'; g.fillRect(x + 1, y + 1, half ? 3 : 7, 6); g.fillStyle = '#ff9a9a'; g.fillRect(x + 2, y + 2, 1, 1); }
}
function drawFood(ui, x, y, type, half) {
  const g = ui.g, icons = ui.game.icons;
  if (icons && icons.food_container) {
    g.drawImage(icons.food_container, x, y);
    if (type) { const im = half ? icons.food_half : icons.food_full; if (im) g.drawImage(im, x, y); }
    return;
  }
  g.fillStyle = '#000'; g.fillRect(x, y, 9, 9); g.fillStyle = '#3a2410'; g.fillRect(x + 1, y + 1, 7, 7);
  if (type) { g.fillStyle = '#b87a3e'; g.fillRect(x + 1, y + 1, half ? 3 : 7, 7); }
}
function drawArmorIcon(ui, x, y, kind) {
  const g = ui.g, icons = ui.game.icons;
  const im = icons && (kind === 2 ? icons.armor_full : kind === 1 ? icons.armor_half : icons.armor_empty);
  if (im) { g.drawImage(im, x, y); return; }
  g.fillStyle = kind ? '#c8c8c8' : '#444'; g.fillRect(x + 1, y + 1, 7, 7);
}

function drawHUD(game, ui, partial) {
  const g = ui.g, p = game.player, W = ui.w, H = ui.h;
  if (game.hideHud) return;
  const cx = W / 2;
  // crosshair (inverted colours)
  if (game.cameraMode === 0 && !(game.screen && !game.screen.passive)) {
    g.save(); g.globalCompositeOperation = 'difference'; g.fillStyle = '#ffffff';
    const ch = game.icons && game.icons.crosshair;
    if (ch) g.drawImage(ch, Math.round(cx - 7.5), Math.round(H / 2 - 7.5));
    else { g.fillRect(Math.round(cx) - 1, Math.round(H / 2) - 8, 2, 16); g.fillRect(Math.round(cx) - 8, Math.round(H / 2) - 1, 16, 2); }
    g.restore();
  }
  // hotbar
  const hx = Math.round(cx - 91), hy = H - 22;
  drawHotbarBackground(ui, hx, hy);
  for (let i = 0; i < 9; i++) ui.item(p.inv[i], hx + 3 + i * 20, hy + 3);
  // selection
  drawHotbarSelection(ui, hx - 1 + p.sel * 20, hy - 1);
  if (p.gameMode === 0) {
    // health, armor, food, air, xp
    const shake = p.health <= 4 && game.tick % 2 === 0;
    const hp = Math.ceil(p.health), blink = p.hurtTime > 0 && (p.hurtTime / 3 | 0) % 2 === 1;
    const rowY = H - 39;
    const rng = mulberry32(game.tick * 13 + 7);
    for (let i = 0; i < 10; i++) {
      let yy = rowY; if (p.health <= 4 || (p.food >= 18 && p.sat > 0 && game.tick % 25 === i * 3 && false)) yy += (rng() * 3 | 0) - 1;
      if (p.health < p.maxHealth && p.sat > 0 && p.food >= 18 && game.tick % 20 === 0 && false) yy -= 2;
      const v = hp - i * 2;
      drawHeart(ui, hx + i * 8, yy, v > 0, v === 1, blink);
    }
    const ap = p.armorPoints();
    if (ap > 0) for (let i = 0; i < 10; i++) { const v = ap - i * 2; drawArmorIcon(ui, hx + i * 8, rowY - 10, v >= 2 ? 2 : v === 1 ? 1 : 0); }
    for (let i = 0; i < 10; i++) {
      const v = p.food - i * 2; let yy = rowY;
      if (p.sat <= 0 && game.tick % (p.food * 3 + 1) === 0) yy += (rng() * 3 | 0) - 1;
      drawFood(ui, hx + 182 - 9 - i * 8, yy, v > 0, v === 1);
    }
    if (game.eyeInWater || p.air < 300) {
      const n = Math.ceil((p.air + 0) * 10 / 300), bub = game.icons && game.icons.bubble, pop = game.icons && game.icons.bubble_pop;
      const full = Math.ceil(Math.max(p.air, 0) / 30);
      for (let i = 0; i < 10; i++) { const x = hx + 182 - 9 - i * 8, y = rowY - 10; if (i < full) { if (bub) g.drawImage(bub, x, y); else { g.fillStyle = '#5fa8ff'; g.fillRect(x + 1, y + 1, 7, 7); } } else if (i === full && p.air < 300 && p.air > -1) { if (pop) g.drawImage(pop, x, y); } }
    }
    // xp bar
    const xb = game.icons && game.icons.xp_bar_bg, xf = game.icons && game.icons.xp_bar_fg;
    if (xb) g.drawImage(xb, hx, H - 29); else { g.fillStyle = '#000'; g.fillRect(hx, H - 29, 182, 5); g.fillStyle = '#404040'; g.fillRect(hx + 1, H - 28, 180, 3); }
    const wpx = Math.floor(182 * p.xpProg);
    if (wpx > 0) { if (xf) g.drawImage(xf, 0, 0, wpx, 5, hx, H - 29, wpx, 5); else { g.fillStyle = '#80ff20'; g.fillRect(hx + 1, H - 28, Math.max(0, wpx - 2), 3); } }
    if (p.level > 0) {
      const s = String(p.level), w = textWidth(s), x = Math.round(cx - w / 2), y = H - 35;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ui.text(s, x + ox, y + oy, '#000000', false);
      ui.text(s, x, y, '#80ff20', false);
    }
  }
  // held item name
  if (game.itemNameT > 0 && game.itemName) {
    const a = Math.min(1, game.itemNameT / 10);
    g.globalAlpha = a; ui.textC(game.itemName, cx, H - (p.gameMode === 0 ? 59 : 46), '#ffffff'); g.globalAlpha = 1;
  }
  // chat
  drawChatLines(game, ui);
  // toast (creative/survival mode change etc.)
  if (game.actionBar && game.actionBarT > 0) { g.globalAlpha = Math.min(1, game.actionBarT / 10); ui.textC(game.actionBar, cx, H - 72, '#ffffff'); g.globalAlpha = 1; }
}
function drawHotbarBackground(ui, x, y) {
  let c = ui.cache.get('hotbar');
  if (!c) {
    c = document.createElement('canvas'); c.width = 182; c.height = 22; const g = c.getContext('2d'); const rnd = mulberry32(1234);
    g.fillStyle = '#000'; g.fillRect(0, 0, 182, 22);
    // beveled frame
    g.fillStyle = '#5d5d5d'; g.fillRect(1, 1, 180, 20);
    const gr = g.createLinearGradient(0, 0, 182, 0); gr.addColorStop(0, '#cecece'); gr.addColorStop(0.5, '#ababab'); gr.addColorStop(1, '#939393');
    g.fillStyle = gr; g.fillRect(1, 1, 180, 1); g.fillStyle = '#a3a3a3'; g.fillRect(1, 1, 1, 20);
    g.fillStyle = '#7e7e7e'; g.fillRect(1, 19, 180, 1); g.fillStyle = '#5d5d5d'; g.fillRect(1, 20, 180, 1); g.fillStyle = '#616161'; g.fillRect(2, 2, 179, 1);
    for (let i = 0; i < 9; i++) {
      const x0 = 3 + i * 20;
      g.fillStyle = 'rgba(4,4,4,0.73)'; g.fillRect(x0, 3, 16, 1); g.fillRect(x0, 3, 1, 16);
      for (let yy = 4; yy < 19; yy++) for (let xx = 0; xx < 16; xx++) { if (xx === 0) continue; const n = (rnd() * 12) | 0; g.fillStyle = 'rgba(' + (30 + n) + ',' + (30 + n) + ',' + (4 + (n >> 1)) + ',0.73)'; g.fillRect(x0 + xx, yy, 1, 1); }
      // separator ridge on the right of each slot except the last
      if (i < 8) { g.fillStyle = '#7e7e7e'; g.fillRect(x0 + 16, 2, 1, 18); g.fillStyle = '#565656'; g.fillRect(x0 + 17, 2, 1, 18); g.fillStyle = '#7e7e7e'; g.fillRect(x0 + 18, 2, 1, 18); g.fillStyle = '#626262'; g.fillRect(x0 + 19, 2, 1, 18); }
    }
    ui.cache.set('hotbar', c);
  }
  ui.g.drawImage(c, x, y);
}
function drawHotbarSelection(ui, x, y) {
  const g = ui.g;
  g.fillStyle = 'rgba(4,4,4,0.7)';
  g.fillRect(x, y, 24, 1); g.fillRect(x, y + 23, 24, 1); g.fillRect(x, y, 1, 24); g.fillRect(x + 23, y, 1, 24);
  g.fillStyle = '#fdfdfd';
  g.fillRect(x + 1, y + 1, 22, 2); g.fillRect(x + 1, y + 21, 22, 2); g.fillRect(x + 1, y + 3, 2, 18); g.fillRect(x + 21, y + 3, 2, 18);
  g.fillStyle = '#a1b29d';
  g.fillRect(x + 3, y + 3, 18, 1); g.fillRect(x + 3, y + 20, 18, 1); g.fillRect(x + 3, y + 4, 1, 16); g.fillRect(x + 20, y + 4, 1, 16);
}
function drawChatLines(game, ui) {
  const g = ui.g, H = ui.h, lines = game.chat;
  const open = game.screen && game.screen.isChat;
  const y0 = H - 40;
  let n = 0;
  for (let i = lines.length - 1; i >= 0 && n < (open ? 20 : 10); i--) {
    const L = lines[i], age = game.tick - L.t;
    if (!open && age > 200) continue;
    let a = 1; if (!open && age > 160) a = 1 - (age - 160) / 40;
    const w = Math.min(324, ui.w);
    g.globalAlpha = a; g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, y0 - n * 9 - 9, w, 9);
    ui.text(L.s, 2, y0 - n * 9 - 8, '#ffffff'); g.globalAlpha = 1; n++;
  }
}

// ---------------------------------------------------------------- debug (F3) screen
function drawDebug(game, ui) {
  const g = ui.g, p = game.player, w = game.world, r = game.renderer;
  const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
  const yawDeg = ((p.yaw / DEG) % 360 + 360) % 360, dirs = ['south (Towards positive Z)', 'west (Towards negative X)', 'north (Towards negative Z)', 'east (Towards positive X)'];
  const facing = dirs[Math.round(yawDeg / 90) % 4];
  const bio = BIOMES[w.getBiome(bx, bz)];
  const sky = w.getSky(bx, by, bz), blk = w.getBlk(bx, by, bz);
  let yw = ((p.yaw / DEG + 180) % 360 + 360) % 360 - 180;
  const L = [
    'Minecraft Web Edition',
    game.fps.toFixed(0) + ' fps T: ' + (game.options.maxFps >= 260 ? 'inf' : game.options.maxFps) + ' vsync ' + (game.options.fancy ? 'fancy' : 'fast') + '-clouds B:' + 2,
    'Client pool @ ' + (w.pool.ok ? w.pool.workers.length + ' workers' : 'main thread') + ', ' + w.pool.inflight + ' jobs',
    'C: ' + r.stats.sections + '/' + countSections(w) + ' (s) D: ' + w.viewDist + ', pC: ' + w.genInflight + ', pU: ' + w.lightQueue.length + ', aB: ' + w.meshInflight,
    'E: ' + game.entities.filter(e => !e.dead).length + '/' + game.entities.length + ', SD: 8',
    'P: ' + game.particles.list.length + '. T: ' + game.entities.length,
    'Chunks: ' + w.chunks.size + ' loaded, ' + w.stats.lit + ' lit, ' + w.stats.meshed + ' meshed',
    game.world.seedName ? 'minecraft:overworld  (seed ' + game.world.seed + ')' : 'minecraft:overworld',
    '',
    'XYZ: ' + p.x.toFixed(3) + ' / ' + p.y.toFixed(5) + ' / ' + p.z.toFixed(3),
    'Block: ' + bx + ' ' + by + ' ' + bz,
    'Chunk: ' + (bx & 15) + ' ' + (by & 15) + ' ' + (bz & 15) + ' in ' + (bx >> 4) + ' ' + (by >> 4) + ' ' + (bz >> 4),
    'Facing: ' + facing + ' (' + yw.toFixed(1) + ' / ' + (p.pitch / DEG).toFixed(1) + ')',
    'Client Light: ' + Math.max(sky, blk) + ' (' + sky + ' sky, ' + blk + ' block)',
    'CH S: ' + w.heightAt(bx, bz) + ' M: ' + w.heightAt(bx, bz),
    'Biome: minecraft:' + (bio ? bio.name : 'plains'),
    'Local Difficulty: ' + (game.difficulty === 0 ? '0.00' : '1.50') + ' // 0.00 (Day ' + game.day + ')',
    'Mode: ' + (p.gameMode === 1 ? 'Creative' : 'Survival') + ', time ' + ((game.time % 24000) | 0),
  ];
  const t = game.target;
  const R = [
    ((gp) => { let t = 'WebGL 2.0, ' + gp; const room = (ui.w - 4 - textWidth(L[0])) - 6; while (t.length > 12 && textWidth(t) > room) t = t.slice(0, -2); return t === 'WebGL 2.0, ' + gp ? t : t + '..'; })(String(r.gpu || 'GPU')),
    'Display: ' + r.width + 'x' + r.height + ' (GUI scale ' + ui.scale + ')',
    'Mem: ' + (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + '/' + Math.round(performance.memory.jsHeapSizeLimit / 1048576) + 'MB' : 'n/a'),
    '',
  ];
  if (t) {
    R.push('Targeted Block: ' + t.x + ', ' + t.y + ', ' + t.z);
    R.push('minecraft:' + BLOCKS[t.id].name);
    if (t.meta) R.push('meta: ' + t.meta);
  }
  const drawCol = (lines, right) => {
    let y = 2;
    for (const s of lines) {
      if (!s) { y += 5; continue; }
      const wdt = textWidth(s);
      const x = right ? ui.w - 2 - wdt : 2;
      g.fillStyle = 'rgba(80,80,80,0.56)'; g.fillRect(x - 1, y - 1, wdt + 2, 10);
      ui.text(s, x, y, '#e0e0e0'); y += 10;
    }
  };
  drawCol(L, false); drawCol(R, true);
}
function countSections(w) { let n = 0; for (const c of w.chunks.values()) for (const m of c.meshes) if (m) n++; return n; }
