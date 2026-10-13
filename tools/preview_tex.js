// node tools/preview_tex.js out.png name1 name2 ...   -> writes a PNG sheet (x8) of block textures (animated ones: 8 frames)
const fs = require('fs'), path = require('path'), zlib = require('zlib');
global.window = global; 
for (const f of ['tex_blocks.js', 'tex_extra.js']) new Function('window', fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8') + '\n')(global);
const TB = global.TexBlocks;
const [out, ...names] = process.argv.slice(2);
const tiles = [];
for (const n of names) {
  if (TB.animated[n]) { const fr = TB.animated[n].frames; for (let i = 0; i < 32; i += 4) tiles.push(fr[i]); } else if (TB.tiles[n]) tiles.push(TB.tiles[n]); else console.log('missing', n);
}
const S = 8, cols = Math.min(8, tiles.length), rows = Math.ceil(tiles.length / cols), W = cols * 17 * S, H = rows * 17 * S;
const img = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { const c = ((i % W) >> 3 & 1) ^ (((i / W | 0) >> 3) & 1) ? 90 : 60; img[i * 4] = c; img[i * 4 + 1] = c; img[i * 4 + 2] = c + 10; img[i * 4 + 3] = 255; }
tiles.forEach((t, k) => {
  const ox = (k % cols) * 17 * S + S / 2, oy = ((k / cols) | 0) * 17 * S + S / 2;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const a = t[(y * 16 + x) * 4 + 3] / 255; if (!a) continue;
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const o = ((oy + y * S + dy) * W + ox + x * S + dx) * 4; for (let c = 0; c < 3; c++) img[o + c] = t[(y * 16 + x) * 4 + c] * a + img[o + c] * (1 - a); }
  }
});
function crc32(buf) { let c, crc = 0xFFFFFFFF; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const raw = Buffer.alloc((W * 4 + 1) * H); for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; img.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out, W + 'x' + H);
