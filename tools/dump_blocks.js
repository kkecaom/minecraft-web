// tools/dump_blocks.js - loads src/tex_blocks.js under Node, verifies it and writes contact sheets
// to _ref/agent_out/blocks_*.png (8x nearest upscale, checkerboard behind transparency, labels).
// Usage: node tools/dump_blocks.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'tex_blocks.js');
const OUT = path.join(ROOT, '_ref', 'agent_out');
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ PNG writer
const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

// ------------------------------------------------------------------ canvas
class Img {
  constructor(w, h, bg) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); if (bg) this.fill(bg); }
  fill(c) { for (let i = 0; i < this.w * this.h; i++) { this.d[i * 4] = c[0]; this.d[i * 4 + 1] = c[1]; this.d[i * 4 + 2] = c[2]; this.d[i * 4 + 3] = 255; } }
  set(x, y, c) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 4; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  // draw a 16x16 RGBA tile scaled by s, composited over checkerboard
  tile(t, x0, y0, s, opts) {
    opts = opts || {};
    const tint = opts.tint, under = opts.under;
    for (let y = 0; y < 16 * s; y++) for (let x = 0; x < 16 * s; x++) {
      const tx = Math.floor(x / s), ty = Math.floor(y / s), i = (ty * 16 + tx) * 4;
      let bg;
      if (under) { const j = i; bg = [under[j], under[j + 1], under[j + 2]]; }
      else { const ck = ((x >> 3) + (y >> 3)) & 1; bg = ck ? [102, 102, 102] : [138, 138, 138]; }
      let r = t[i], g = t[i + 1], b = t[i + 2];
      const a = t[i + 3] / 255;
      if (tint) { r = r * tint[0] / 255; g = g * tint[1] / 255; b = b * tint[2] / 255; }
      this.set(x0 + x, y0 + y, [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]);
    }
  }
  save(file) { writePNG(file, this.w, this.h, this.d); }
}

// 3x5 font
const GLYPH = {
  a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111', f: '111100110100100',
  g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010', k: '101101110101101', l: '100100100100111',
  m: '101111111101101', n: '110101101101101', o: '010101101101010', p: '110101110100100', q: '010101101110011', r: '110101110101101',
  s: '011100010001110', t: '111010010010010', u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101',
  y: '101101010010010', z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110',
  _: '000000000000111', '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', ' ': '000000000000000', '#': '101111101111101', '%': '101001010100101', '/': '001001010100100'
};
function text(img, x, y, s, str, col, sc) {
  sc = sc || 2;
  let cx = x;
  for (const ch of str.toLowerCase()) {
    const g = GLYPH[ch] || GLYPH[' '];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') img.rect(cx + i * sc, y + j * sc, sc, sc, col);
    cx += 4 * sc;
  }
}

// ------------------------------------------------------------------ load module
const code = fs.readFileSync(SRC, 'utf8');
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const t0 = process.hrtime.bigint();
vm.runInContext(code, sandbox, { filename: 'tex_blocks.js' });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const TB = sandbox.TexBlocks;
if (!TB) { console.error('TexBlocks global missing'); process.exit(1); }
const leaked = Object.keys(sandbox).filter(k => k !== 'globalThis' && k !== 'TexBlocks');
if (leaked.length) console.log('PROBLEM: leaked globals:', leaked.join(', '));
// determinism: a second evaluation must produce identical bytes
{
  const sb2 = {}; sb2.globalThis = sb2; vm.createContext(sb2); vm.runInContext(code, sb2);
  let diff = 0;
  for (const n of sb2.TexBlocks.names) { const a = TB.tiles[n], b = sb2.TexBlocks.tiles[n]; for (let k = 0; k < 1024; k++) if (a[k] !== b[k]) { diff++; break; } }
  console.log(diff ? 'PROBLEM: non-deterministic tiles: ' + diff : 'deterministic: yes');
}
console.log('generated in', ms.toFixed(1), 'ms; names:', TB.names.length, 'size:', TB.size);

// ------------------------------------------------------------------ checks
const SPEC = ('stone granite diorite andesite dirt grass_block_top grass_block_side grass_block_side_overlay grass_block_snow podzol_top podzol_side gravel sand sandstone sandstone_top sandstone_bottom clay snow ice bedrock obsidian cobblestone mossy_cobblestone stone_bricks bricks smooth_stone smooth_stone_slab_side coal_ore iron_ore gold_ore diamond_ore redstone_ore lapis_ore emerald_ore ' +
  'water_still water_flow lava_still lava_flow ' +
  'oak_planks spruce_planks birch_planks oak_log oak_log_top spruce_log spruce_log_top birch_log birch_log_top oak_leaves spruce_leaves birch_leaves oak_sapling spruce_sapling birch_sapling short_grass fern dandelion poppy blue_orchid allium azure_bluet red_tulip oxeye_daisy cornflower brown_mushroom red_mushroom dead_bush lily_pad sugar_cane cactus_top cactus_side cactus_bottom pumpkin_top pumpkin_side carved_pumpkin jack_o_lantern melon_side melon_top wheat_stage0 wheat_stage1 wheat_stage2 wheat_stage3 wheat_stage4 wheat_stage5 wheat_stage6 wheat_stage7 farmland farmland_moist hay_block_side hay_block_top glass glass_pane_top ' +
  'white_wool orange_wool magenta_wool light_blue_wool yellow_wool lime_wool pink_wool gray_wool light_gray_wool cyan_wool purple_wool blue_wool brown_wool green_wool red_wool black_wool iron_block gold_block diamond_block emerald_block lapis_block coal_block redstone_block glowstone tnt_side tnt_top tnt_bottom bookshelf crafting_table_top crafting_table_front crafting_table_side furnace_front furnace_front_on furnace_side furnace_top torch ladder oak_door_top oak_door_bottom ' +
  'chest_top chest_side chest_front bed_top_head bed_top_foot bed_side_head bed_side_foot bed_end_head bed_end_foot bed_bottom ' +
  'destroy_stage_0 destroy_stage_1 destroy_stage_2 destroy_stage_3 destroy_stage_4 destroy_stage_5 destroy_stage_6 destroy_stage_7 destroy_stage_8 destroy_stage_9').split(' ');
let problems = 0;
function bad(msg) { problems++; console.log('PROBLEM:', msg); }
if (TB.size !== 16) bad('size != 16');
SPEC.forEach((n, i) => {
  if (TB.names[i] !== n) bad('names[' + i + '] = ' + TB.names[i] + ' expected ' + n);
  const t = TB.tiles[n];
  if (!t) return bad('missing tile ' + n);
  if (Object.prototype.toString.call(t) !== '[object Uint8ClampedArray]') bad(n + ' not Uint8ClampedArray');
  if (t.length !== 1024) bad(n + ' length ' + t.length);
  let magenta = 0, blackTransparent = 0;
  for (let k = 0; k < 256; k++) {
    if (t[k * 4] === 255 && t[k * 4 + 1] === 0 && t[k * 4 + 2] === 255) magenta++;
    if (t[k * 4 + 3] === 0 && t[k * 4] === 0 && t[k * 4 + 1] === 0 && t[k * 4 + 2] === 0) blackTransparent++;
  }
  if (magenta > 200) bad(n + ' is the magenta placeholder');
  if (blackTransparent) bad(n + ' has ' + blackTransparent + ' transparent pixels with RGB 0');
});
if (TB.names.length !== SPEC.length) bad('names length ' + TB.names.length + ' vs spec ' + SPEC.length);
const ANIM = { water_still: [32, 2], water_flow: [32, 2], lava_still: [24, 4], lava_flow: [24, 3] };
for (const n in ANIM) {
  const a = TB.animated[n];
  if (!a) { bad('animated missing ' + n); continue; }
  if (a.frames.length !== ANIM[n][0]) bad(n + ' frames ' + a.frames.length);
  if (a.frameTime !== ANIM[n][1]) bad(n + ' frameTime ' + a.frameTime);
  if (TB.tiles[n] !== a.frames[0]) bad(n + ' tiles[] !== frames[0]');
  // loop continuity: mean abs diff consecutive vs wrap-around
  const diff = (p, q) => { let s = 0; for (let k = 0; k < 1024; k += 4) s += Math.abs(p[k] - q[k]) + Math.abs(p[k + 1] - q[k + 1]) + Math.abs(p[k + 2] - q[k + 2]); return s / 768; };
  let mx = 0, sum = 0;
  for (let f = 0; f < a.frames.length - 1; f++) { const d = diff(a.frames[f], a.frames[f + 1]); mx = Math.max(mx, d); sum += d; }
  const wrap = diff(a.frames[a.frames.length - 1], a.frames[0]);
  // spatial seam: compare column 15->0 difference to interior column differences
  let seam = 0, inner = 0;
  for (const fr of a.frames) for (let y = 0; y < 16; y++) {
    const e = (x) => (y * 16 + x) * 4;
    seam += Math.abs(fr[e(15)] - fr[e(0)]) + Math.abs(fr[(15 * 16 + y) * 4 + 1] - fr[(0 * 16 + y) * 4 + 1]);
    for (let x = 0; x < 15; x++) inner += (Math.abs(fr[e(x)] - fr[e(x + 1)]) + Math.abs(fr[(x * 16 + y) * 4 + 1] - fr[((x + 1) * 16 + y) * 4 + 1])) / 15;
  }
  console.log(`anim ${n}: frames=${a.frames.length} ft=${a.frameTime} consecutive mean=${(sum / (a.frames.length - 1)).toFixed(2)} max=${mx.toFixed(2)} wrap=${wrap.toFixed(2)} | edge seam=${(seam / inner).toFixed(2)}x interior`);
  if (wrap > mx * 1.5 + 0.5) bad(n + ' loop seam too strong');
}
// monotonic destroy stages
let prevD = -1, prevAll = -1, prevSet = null;
for (let s = 0; s < 10; s++) {
  const t = TB.tiles['destroy_stage_' + s];
  let d = 0, all = 0; const set = new Uint8Array(256);
  for (let k = 0; k < 256; k++) { if (t[k * 4 + 3] >= 150) d++; if (t[k * 4 + 3] > 0) { all++; set[k] = 1; } }
  if (d <= prevD || all <= prevAll) bad('destroy stage ' + s + ' not strictly increasing (' + d + '/' + all + ')');
  if (prevSet) for (let k = 0; k < 256; k++) if (prevSet[k] && !set[k]) { bad('destroy stage ' + s + ' drops a pixel of stage ' + (s - 1)); break; }
  prevD = d; prevAll = all; prevSet = set;
}
console.log(problems ? problems + ' problem(s)' : 'all checks passed');

// ------------------------------------------------------------------ stats (colour counts) for comparison with _ref/out
const statLines = [];
for (const n of TB.names) {
  const t = TB.tiles[n], cnt = new Map(); let tr = 0, sr = 0, sg = 0, sb = 0, no = 0;
  for (let k = 0; k < 256; k++) {
    const a = t[k * 4 + 3];
    if (a === 0) { tr++; continue; }
    const key = '#' + [t[k * 4], t[k * 4 + 1], t[k * 4 + 2]].map(v => v.toString(16).padStart(2, '0')).join('') + (a < 255 ? '@' + a : '');
    cnt.set(key, (cnt.get(key) || 0) + 1); sr += t[k * 4]; sg += t[k * 4 + 1]; sb += t[k * 4 + 2]; no++;
  }
  const mean = no ? '#' + [sr, sg, sb].map(v => Math.round(v / no).toString(16).padStart(2, '0')).join('') : 'none';
  const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0] + 'x' + e[1]).join(' ');
  statLines.push(`${n} mean=${mean} transparent=${tr} colors=${cnt.size}\n   ${top}`);
}
fs.writeFileSync(path.join(OUT, 'blocks_stats.txt'), statLines.join('\n'));

// ------------------------------------------------------------------ contact sheets
const S = 8, COLS = 7, CW = 16 * S + 8, CH = 16 * S + 30, PER = COLS * 6;
const names = TB.names;
for (let sheet = 0; sheet * PER < names.length; sheet++) {
  const list = names.slice(sheet * PER, (sheet + 1) * PER);
  const rows = Math.ceil(list.length / COLS);
  const img = new Img(COLS * CW + 4, rows * CH + 4, [40, 40, 44]);
  list.forEach((n, i) => {
    const cx = 4 + (i % COLS) * CW, cy = 4 + Math.floor(i / COLS) * CH;
    img.tile(TB.tiles[n], cx, cy, S);
    const l1 = n.slice(0, 16), l2 = n.slice(16, 32);
    text(img, cx, cy + 16 * S + 3, 2, l1, [230, 230, 230]);
    if (l2) text(img, cx, cy + 16 * S + 15, 2, l2, [230, 230, 230]);
  });
  img.save(path.join(OUT, 'blocks_' + (sheet + 1) + '.png'));
}

// tinted preview (how the engine will show gray tiles)
const TINTS = {
  grass_block_top: [0x91, 0xbd, 0x59], short_grass: [0x91, 0xbd, 0x59], fern: [0x91, 0xbd, 0x59], sugar_cane: [0x91, 0xbd, 0x59],
  oak_leaves: [0x77, 0xab, 0x2f], spruce_leaves: [0x61, 0x99, 0x61], birch_leaves: [0x80, 0xa7, 0x55], lily_pad: [0x20, 0x80, 0x30],
  water_still: [0x3f, 0x76, 0xe4], water_flow: [0x3f, 0x76, 0xe4]
};
{
  const list = Object.keys(TINTS).concat(['grass_block_side+overlay', 'grass_block_top(forest)', 'oak_leaves(forest)', 'water_still(swamp)']);
  const img = new Img(COLS * CW + 4, Math.ceil(list.length / COLS) * CH + 4, [40, 40, 44]);
  list.forEach((n, i) => {
    const cx = 4 + (i % COLS) * CW, cy = 4 + Math.floor(i / COLS) * CH;
    if (n === 'grass_block_side+overlay') {
      const base = TB.tiles.grass_block_side, ov = TB.tiles.grass_block_side_overlay, comp = new Uint8ClampedArray(1024), tt = TINTS.grass_block_top;
      for (let k = 0; k < 256; k++) {
        const a = ov[k * 4 + 3] / 255;
        for (let c = 0; c < 3; c++) comp[k * 4 + c] = base[k * 4 + c] * (1 - a) + ov[k * 4 + c] * tt[c] / 255 * a;
        comp[k * 4 + 3] = 255;
      }
      img.tile(comp, cx, cy, S);
    } else if (n === 'grass_block_top(forest)') img.tile(TB.tiles.grass_block_top, cx, cy, S, { tint: [0x79, 0xc0, 0x5a] });
    else if (n === 'oak_leaves(forest)') img.tile(TB.tiles.oak_leaves, cx, cy, S, { tint: [0x59, 0xae, 0x30] });
    else if (n === 'water_still(swamp)') img.tile(TB.tiles.water_still, cx, cy, S, { tint: [0x61, 0x7b, 0x64] });
    else img.tile(TB.tiles[n], cx, cy, S, { tint: TINTS[n] });
    text(img, cx, cy + 16 * S + 3, 2, n.slice(0, 16), [230, 230, 230]);
    if (n.length > 16) text(img, cx, cy + 16 * S + 15, 2, n.slice(16, 32), [230, 230, 230]);
  });
  img.save(path.join(OUT, 'blocks_tinted.png'));
}

// tiled 3x3 previews at 3x (seams + how they read at game scale)
{
  const list = ['stone', 'granite', 'diorite', 'andesite', 'dirt', 'grass_block_top', 'gravel', 'sand', 'sandstone', 'cobblestone', 'mossy_cobblestone', 'stone_bricks', 'bricks',
    'oak_planks', 'spruce_planks', 'birch_planks', 'oak_log', 'birch_log', 'oak_leaves', 'bedrock', 'obsidian', 'clay', 'coal_ore', 'diamond_ore', 'white_wool', 'red_wool', 'glowstone', 'hay_block_side',
    'melon_side', 'pumpkin_side', 'podzol_top', 'snow', 'ice', 'lapis_block', 'bookshelf', 'water_still', 'water_flow', 'lava_still', 'lava_flow', 'sandstone_bottom', 'farmland'];
  const s = 3, cw = 48 * s + 6, chh = 48 * s + 18, cols = 6;
  const img = new Img(cols * cw + 4, Math.ceil(list.length / cols) * chh + 4, [40, 40, 44]);
  list.forEach((n, i) => {
    const cx = 4 + (i % cols) * cw, cy = 4 + Math.floor(i / cols) * chh;
    const tint = n === 'grass_block_top' ? TINTS.grass_block_top : n === 'oak_leaves' ? TINTS.oak_leaves : n.startsWith('water') ? TINTS.water_still : null;
    const under = n.startsWith('water') ? new Uint8ClampedArray(1024).map((v, k) => (k & 3) === 3 ? 255 : [34, 40, 52][k & 3]) : null;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) img.tile(TB.tiles[n], cx + a * 16 * s, cy + b * 16 * s, s, { tint, under });
    text(img, cx, cy + 48 * s + 3, 2, n.slice(0, 18), [230, 230, 230]);
  });
  img.save(path.join(OUT, 'blocks_tiled.png'));
}

// animation strips: 8 sampled frames per animation (+ last and first to judge the loop)
{
  const anims = ['water_still', 'water_flow', 'lava_still', 'lava_flow'];
  const s = 5, cw = 16 * s + 4, n = 12;
  const img = new Img(n * cw + 4, anims.length * (16 * s + 18) + 4, [40, 40, 44]);
  anims.forEach((a, r) => {
    const fr = TB.animated[a].frames, F = fr.length;
    const pickF = [F - 2, F - 1, 0, 1, 2, 3, Math.floor(F / 4), Math.floor(F / 2) - 1, Math.floor(F / 2), Math.floor(F / 2) + 1, Math.floor(3 * F / 4), F - 3];
    const under = new Uint8ClampedArray(1024);
    for (let k = 0; k < 256; k++) { under[k * 4] = 34; under[k * 4 + 1] = 40; under[k * 4 + 2] = 52; under[k * 4 + 3] = 255; }
    pickF.forEach((f, i) => {
      img.tile(fr[f], 4 + i * cw, 4 + r * (16 * s + 18), s, { tint: a.startsWith('water') ? TINTS.water_still : null, under: a.startsWith('water') ? under : null });
      text(img, 4 + i * cw, 4 + r * (16 * s + 18) + 16 * s + 3, 1, String(f), [230, 230, 230], 2);
    });
  });
  img.save(path.join(OUT, 'blocks_anim.png'));
}

// engine crops: what the mesher's vanilla-style box UVs actually sample (chest 14x14 box, bed 6px-tall box, torch 2px column)
{
  const crops = [
    ['chest_front', 1, 2, 14, 14], ['chest_side', 1, 2, 14, 14], ['chest_top', 1, 1, 14, 14],
    ['bed_side_head', 0, 7, 16, 6], ['bed_side_foot', 0, 7, 16, 6], ['bed_end_head', 0, 7, 16, 6], ['bed_end_foot', 0, 7, 16, 6],
    ['torch', 7, 6, 2, 10], ['cactus_top', 1, 1, 14, 14]
  ];
  const s = 8, cw = 16 * s + 8, chh = 16 * s + 18;
  const img = new Img(crops.length * cw + 4, chh + 4, [40, 40, 44]);
  crops.forEach((c, i) => {
    const t = TB.tiles[c[0]], sub = new Uint8ClampedArray(1024);
    for (let y = 0; y < c[4]; y++) for (let x = 0; x < c[3]; x++) {
      const k = ((c[2] + y) * 16 + c[1] + x) * 4, j = (y * 16 + x) * 4;
      sub[j] = t[k]; sub[j + 1] = t[k + 1]; sub[j + 2] = t[k + 2]; sub[j + 3] = t[k + 3];
    }
    img.tile(sub, 4 + i * cw, 4, s);
    text(img, 4 + i * cw, 4 + 16 * s + 3, 2, c[0].slice(0, 16), [230, 230, 230]);
  });
  img.save(path.join(OUT, 'blocks_crops.png'));
}

// destroy stages alpha-composited over real blocks (how the engine will show them)
{
  const bases = ['stone', 'oak_planks', 'dirt'];
  const s = 5, cw = 16 * s + 4;
  const img = new Img(10 * cw + 4, bases.length * (16 * s + 4) + 4, [40, 40, 44]);
  bases.forEach((b, row) => {
    for (let st = 0; st < 10; st++) {
      const base = TB.tiles[b], ov = TB.tiles['destroy_stage_' + st], comp = new Uint8ClampedArray(1024);
      for (let k = 0; k < 256; k++) {
        const a = ov[k * 4 + 3] / 255;
        for (let c = 0; c < 3; c++) comp[k * 4 + c] = base[k * 4 + c] * (1 - a) + ov[k * 4 + c] * a;
        comp[k * 4 + 3] = 255;
      }
      img.tile(comp, 4 + st * cw, 4 + row * (16 * s + 4), s);
    }
  });
  img.save(path.join(OUT, 'blocks_destroy.png'));
}

// 1x atlas (16 per row, names order) for side-by-side comparison with the reference screenshots
{
  const cols = 16, rows = Math.ceil(names.length / cols);
  const img = new Img(cols * 16, rows * 16);
  img.d.fill(0);
  names.forEach((n, i) => {
    const t = TB.tiles[n], ox = (i % cols) * 16, oy = Math.floor(i / cols) * 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const k = (y * 16 + x) * 4, j = ((oy + y) * img.w + ox + x) * 4;
      img.d[j] = t[k]; img.d[j + 1] = t[k + 1]; img.d[j + 2] = t[k + 2]; img.d[j + 3] = t[k + 3];
    }
  });
  writePNG(path.join(OUT, 'blocks_atlas.png'), img.w, img.h, img.d);
  fs.writeFileSync(path.join(OUT, 'blocks_atlas.txt'), names.join('\n'));
}
console.log('sheets written to', OUT);
