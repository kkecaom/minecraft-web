// Node harness for the shared (worker) code: node tools/test_shared.js [seed]
const fs = require('fs'), path = require('path');
const parts = ['shared_core.js', 'shared_blocks.js', 'shared_gen.js', 'shared_struct.js', 'shared_dims.js', 'shared_medoh_bp.js', 'shared_medoh.js', 'shared_mesh.js'];
const code = parts.map(f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
const S = new Function('"use strict";\n' + code + '\nreturn API;')();
const seed = S.seedToInt(process.argv[2] || 12345);
console.log('blocks', S.NB, 'seed', seed);

// fake tile index from used names
const names = S.usedTileNames(); const TI = {}; names.forEach((n, i) => TI[n] = i);
S.initAll(TI);
console.log('missing tiles:', S.missingTiles());

// biome / height statistics over a large area
const hist = {}; let hMin = 999, hMax = 0, hs = [];
const N = 120;
for (let zi = -N; zi <= N; zi++) for (let xi = -N; xi <= N; xi++) {
  const c = S.columnInfo(seed, xi * 16 + 8, zi * 16 + 8);
  const name = S.BIOMES[c.biome].name; hist[name] = (hist[name] || 0) + 1;
  hMin = Math.min(hMin, c.h); hMax = Math.max(hMax, c.h); hs.push(c.h);
}
hs.sort((a, b) => a - b);
const tot = Object.values(hist).reduce((a, b) => a + b, 0);
console.log('biomes (%):', Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + (100 * v / tot).toFixed(1)).join(', '));
console.log('height min/p10/p50/p90/max', hMin, hs[(hs.length * 0.1) | 0], hs[(hs.length * 0.5) | 0], hs[(hs.length * 0.9) | 0], hMax);

// generate + mesh timing
let t0 = process.hrtime.bigint();
const chunks = new Map();
for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) chunks.set(cx + ',' + cz, S.generateChunk(seed, cx, cz));
let t1 = process.hrtime.bigint();
console.log('generate 25 chunks: %d ms (%d ms/chunk)', Number(t1 - t0) / 1e6 | 0, Number(t1 - t0) / 25e6 | 0);

// block statistics for centre chunk
const c0 = chunks.get('0,0'); const cnt = {};
for (let i = 0; i < c0.blocks.length; i++) { const id = c0.blocks[i]; cnt[id] = (cnt[id] || 0) + 1; }
const total = c0.blocks.length; let air = 0;
console.log('centre chunk top blocks:', Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([id, n]) => S.BLOCKS[id].name + ' ' + n).join(', '));
// cave fraction underground: cells between y=10 and 6 below the surface, land columns only, all 25 chunks
let solid = 0, cave = 0, lava = 0, ores = {};
for (const ch of chunks.values()) for (let i = 0; i < 256; i++) {
  let top = 0; for (let y = 255; y > 0; y--) { const id = ch.blocks[(y << 8) | i]; if (id !== 0 && S.T_FLUID[id] === 0 && !S.BLOCKS[id].leaves && !S.BLOCKS[id].log) { top = y; break; } }
  if (top < 64) continue;
  for (let y = 10; y < top - 6; y++) { const id = ch.blocks[(y << 8) | i]; if (id === 0) cave++; else if (id === S.BID.lava) lava++; else solid++; }
}
console.log('cave air fraction underground: %s%% (lava %s%%)', (100 * cave / (cave + solid + lava)).toFixed(1), (100 * lava / (cave + solid + lava)).toFixed(2));
for (const ch of chunks.values()) for (let k = 0; k < ch.blocks.length; k++) { const id = ch.blocks[k]; if (id >= S.BID.coal_ore && id <= S.BID.emerald_ore) ores[S.BLOCKS[id].name] = (ores[S.BLOCKS[id].name] || 0) + 1; }
console.log('ores in 25 chunks:', JSON.stringify(ores));

// mesh one section with a fake padded neighbourhood (all air light 15 above ground)
function padded(cx, cz, sy) {
  const B = new Uint8Array(5832), M = new Uint8Array(5832), L = new Uint8Array(5832), BIO = new Uint8Array(324);
  for (let y = 0; y < 18; y++) for (let z = 0; z < 18; z++) for (let x = 0; x < 18; x++) {
    const wx = cx * 16 + x - 1, wy = sy * 16 + y - 1, wz = cz * 16 + z - 1;
    const ccx = wx >> 4, ccz = wz >> 4, ch = chunks.get(ccx + ',' + ccz);
    const i = (y * 18 + z) * 18 + x;
    if (!ch || wy < 0 || wy > 255) { L[i] = 0xF0; continue; }
    const idx = (wy << 8) | ((wz & 15) << 4) | (wx & 15);
    B[i] = ch.blocks[idx]; M[i] = ch.meta[idx]; L[i] = B[i] === 0 ? 0xF0 : 0;
  }
  for (let z = 0; z < 18; z++) for (let x = 0; x < 18; x++) {
    const wx = cx * 16 + x - 1, wz = cz * 16 + z - 1, ch = chunks.get((wx >> 4) + ',' + (wz >> 4));
    BIO[z * 18 + x] = ch ? ch.biome[((wz & 15) << 4) | (wx & 15)] : 2;
  }
  return { B, M, L, BIO, wx0: cx * 16, wy0: sy * 16, wz0: cz * 16 };
}
t0 = process.hrtime.bigint();
let verts = 0, secs = 0;
for (let sy = 0; sy < 12; sy++) { const r = S.meshSection(padded(0, 0, sy)); verts += r.solidVerts + r.transVerts; secs++; }
t1 = process.hrtime.bigint();
console.log('mesh %d sections: %d verts, %s ms total, %s ms/section', secs, verts, (Number(t1 - t0) / 1e6).toFixed(1), (Number(t1 - t0) / 1e6 / secs).toFixed(2));
console.log('missing tiles after mesh:', S.missingTiles());
console.log('spawn:', JSON.stringify(S.findSpawn(seed)));
