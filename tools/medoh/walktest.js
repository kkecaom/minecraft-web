// flood-fill walk test: can a player walk (1-block jumps allowed) from the base island up the whole boardwalk and across to the shore?
const { loadGame } = require('./vox'); const mc = loadGame(); const SH = mc.SH, B = SH.BID;
const { buildMedoh } = require('./medoh'); const { buildScene } = require('./scene');
const v = buildScene(mc, buildMedoh(mc));
const solid = (x, y, z) => { const id = v.get(x, y, z); return id !== 0 && SH.T_SOLID[id] === 1; };
const pass = (x, y, z) => { const id = v.get(x, y, z); return id === 0 || SH.T_SOLID[id] === 0; };
const can = (x, y, z) => solid(x, y - 1, z) && v.get(x, y - 1, z) !== B.oak_fence && pass(x, y, z) && pass(x, y + 1, z);
const key = (x, y, z) => x + ',' + y + ',' + z, seen = new Set(), q = [];
let start = null; for (let y = 70; y >= 64 && !start; y--) for (const x of [30, 29, 28, 31]) if (can(x, y, -3)) { start = [x, y, -3]; break; }
q.push(start); seen.add(key(...start)); let maxY = 0, best = null;
while (q.length) { const [x, y, z] = q.shift(); if (y > maxY) { maxY = y; best = [x, y, z]; }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [1, 0, -1, -2, -3]) { const nx = x + dx, ny = y + dy, nz = z + dz; if (!can(nx, ny, nz)) continue; if (dy === 1 && !pass(x, y + 2, z)) continue; const k = key(nx, ny, nz); if (!seen.has(k)) { seen.add(k); q.push([nx, ny, nz]); } break; } }
const near = t => { for (let d = -3; d <= 3; d++) for (let e = -3; e <= 3; e++) for (let yy = -2; yy <= 3; yy++) if (seen.has(key(t[0] + d, t[1] + yy, t[2] + e))) return true; return false; };
console.log('start', start, 'cells', seen.size, 'max y', maxY, 'at', best, '| shore', near([150, 67, 30]));
// hut lamps (hanging lanterns) mark the pavilions: is each floor reachable?
for (let y = v.y0; y <= v.y1; y++) for (let z = v.z0; z <= v.z1; z++) for (let x = v.x0; x <= v.x1; x++) { const i = v.idx(x, y, z); if (v.b[i] === B.lantern && v.m[i] === 1) console.log('hut at', x, y - 7, z, near([x, y - 7, z]) ? 'reachable' : 'NOT reachable'); }
