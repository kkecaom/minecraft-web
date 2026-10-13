// tools/dump_items.js - loads src/tex_items.js under Node, verifies the required names and writes contact sheets
// (8x nearest-neighbour, checkerboard behind transparency, labelled) to _ref/agent_out/items_*.png.
// Usage: node tools/dump_items.js            (writes sheets)
//        node tools/dump_items.js --json     (also writes _ref/agent_out/items_raw.json for side-by-side comparisons)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'tex_items.js');
const OUT = path.join(ROOT, '_ref', 'agent_out');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- load module in a sandbox
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const t0 = process.hrtime.bigint();
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'tex_items.js' });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const TI = sandbox.TexItems;
if (!TI) throw new Error('TexItems global missing');
console.log('generated ' + TI.names.length + ' tiles in ' + ms.toFixed(1) + ' ms');

// ---------------------------------------------------------------- required names (spec, Module B)
const MATERIALS = 'stick coal charcoal iron_ingot gold_ingot diamond emerald redstone lapis_lazuli flint clay_ball brick paper book string feather leather bone bone_meal gunpowder sugar egg snowball glowstone_dust'.split(' ');
const FOOD = 'wheat_seeds wheat bread apple golden_apple melon_slice melon_seeds pumpkin_seeds cookie carrot potato baked_potato porkchop cooked_porkchop beef cooked_beef chicken cooked_chicken mutton cooked_mutton rotten_flesh spider_eye'.split(' ');
const MISC = 'bucket water_bucket lava_bucket milk_bucket flint_and_steel shears bow arrow oak_door red_bed spawn_egg spawn_egg_overlay'.split(' ');
const TOOLS = [], ARMOR = [];
for (const m of ['wooden', 'stone', 'iron', 'golden', 'diamond']) for (const k of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) TOOLS.push(m + '_' + k);
for (const m of ['leather', 'iron', 'golden', 'diamond']) for (const k of ['helmet', 'chestplate', 'leggings', 'boots']) ARMOR.push(m + '_' + k);
const REQUIRED = [...MATERIALS, ...FOOD, ...MISC, ...TOOLS, ...ARMOR];
let bad = 0;
for (const n of REQUIRED) {
  const t = TI.tiles[n];
  if (!t) { console.log('MISSING tile: ' + n); bad++; continue; }
  if (Object.prototype.toString.call(t) !== '[object Uint8ClampedArray]' || t.length !== 1024) { console.log('BAD tile: ' + n); bad++; }
  if (TI.names.indexOf(n) < 0) { console.log('not in names: ' + n); bad++; }
  let opaque = 0; for (let i = 3; i < 1024; i += 4) if (t[i]) opaque++;
  if (opaque < 8) { console.log('nearly empty tile: ' + n + ' (' + opaque + ' px)'); bad++; }
}
for (const n of TI.names) if (REQUIRED.indexOf(n) < 0) console.log('extra tile (ok): ' + n);
if (TI.size !== 16) { console.log('size != 16'); bad++; }
console.log(bad ? bad + ' PROBLEMS' : 'all ' + REQUIRED.length + ' required names present');

// ---------------------------------------------------------------- PNG writer
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---------------------------------------------------------------- tiny 3x5 font for labels
const FONT = {
  a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111', f: '111100110100100', g: '011100101101011',
  h: '101101111101101', i: '111010010010111', j: '001001001101010', k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101',
  o: '010101101101010', p: '110101110100100', q: '010101101110011', r: '110101110101101', s: '011100010001110', t: '111010010010010', u: '101101101101111',
  v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010', z: '111001010100111', _: '000000000000111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110',
  6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110', ' ': '000000000000000',
};

// ---------------------------------------------------------------- contact sheet
function sheet(file, names, cols, Z) {
  Z = Z || 8;
  const cw = 16 * Z + 8, ch = 16 * Z + 20;
  const rows = Math.ceil(names.length / cols);
  const W = cols * cw + 8, H = rows * ch + 8;
  const img = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { img[i * 4] = 43; img[i * 4 + 1] = 43; img[i * 4 + 2] = 43; img[i * 4 + 3] = 255; }
  function px(x, y, r, g, b) { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = 255; }
  names.forEach((n, k) => {
    const ox = 8 + (k % cols) * cw, oy = 8 + Math.floor(k / cols) * ch;
    const t = TI.tiles[n];
    for (let y = 0; y < 16 * Z; y++) for (let x = 0; x < 16 * Z; x++) {
      const board = ((x >> 3) + (y >> 3)) & 1 ? 136 : 102;
      let r = board, g = board, b = board;
      if (t) { const i = ((y / Z | 0) * 16 + (x / Z | 0)) * 4, a = t[i + 3] / 255; r = t[i] * a + board * (1 - a); g = t[i + 1] * a + board * (1 - a); b = t[i + 2] * a + board * (1 - a); }
      px(ox + x, oy + y, r, g, b);
    }
    const label = n.slice(0, Math.floor(16 * Z / 4));
    for (let ci = 0; ci < label.length; ci++) {
      const f = FONT[label[ci]] || FONT[' '];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (f[j * 3 + i] === '1') { px(ox + ci * 4 + i, oy + 16 * Z + 5 + j, 230, 230, 230); }
    }
  });
  writePNG(file, W, H, img);
  console.log('wrote ' + path.relative(ROOT, file));
}
// preview: spawn eggs tinted like the engine will (base * colour1, overlay * colour2, composited)
const EGG = { pig: [0xf0a5a2, 0xdb635f], creeper: [0x0da70b, 0x000000], zombie: [0x00afaf, 0x799c65], spider: [0x342d27, 0xa80e0e], skeleton: [0xc1c1c1, 0x494949], cow: [0x443626, 0xa1a1a1] };
for (const mob in EGG) {
  const base = TI.tiles.spawn_egg, ov = TI.tiles.spawn_egg_overlay, out = new Uint8ClampedArray(1024);
  const [c1, c2] = EGG[mob];
  for (let i = 0; i < 256; i++) {
    const a = base[i * 4 + 3] / 255, b = ov[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) {
      const t1 = (c1 >> (16 - 8 * k)) & 255, t2 = (c2 >> (16 - 8 * k)) & 255;
      const v1 = base[i * 4 + k] * t1 / 255, v2 = ov[i * 4 + k] * t2 / 255;
      out[i * 4 + k] = v2 * b + v1 * (1 - b);
    }
    out[i * 4 + 3] = Math.max(a, b) * 255;
  }
  TI.tiles['egg_' + mob] = out;
}
MISC.push(...Object.keys(EGG).map(m => 'egg_' + m));
const arg = process.argv.slice(2);
const only = arg.filter(a => !a.startsWith('--'));
const sets = { materials: MATERIALS, food: FOOD, misc: MISC, tools: TOOLS, armor: ARMOR };
for (const k in sets) if (!only.length || only.includes(k)) sheet(path.join(OUT, 'items_' + k + '.png'), sets[k], k === 'tools' ? 5 : k === 'armor' ? 4 : 6, 8);
if (arg.includes('--json')) {
  const o = {}; for (const n of TI.names) o[n] = Array.from(TI.tiles[n]);
  fs.writeFileSync(path.join(OUT, 'items_raw.json'), JSON.stringify(o));
  console.log('wrote _ref/agent_out/items_raw.json');
}
