// ===== shared_mesh.js : chunk-section mesher =====
// Input arrays are a padded 18x18x18 neighbourhood of one 16^3 section: index (y*18 + z)*18 + x, interior = 1..16.
// Vertex format (16 bytes): int16 x,y,z (1/256 block, section-local) | u8 u,v (0..16) | u16 tile | u8 r,g,b,a | u8 sky,block (level*17)
const FOFF = [-324, 324, -18, 18, -1, 1];
const FSHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];
// unit-cube face vertex positions (a,b,c,d) as 0/1 bits; matches box face corner tables below
const FV = [
  [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]],
  [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
  [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
  [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]],
];
const FUV = [[[0, 16], [0, 0], [16, 0], [16, 16]], [[0, 0], [0, 16], [16, 16], [16, 0]], [[0, 0], [0, 16], [16, 16], [16, 0]], [[0, 0], [0, 16], [16, 16], [16, 0]], [[0, 0], [0, 16], [16, 16], [16, 0]], [[0, 0], [0, 16], [16, 16], [16, 0]]];
// AO sample offsets per face vertex: [side1, side2, corner] relative to the block cell index (in the padded array)
const AOT = new Int32Array(6 * 4 * 3);
(function () {
  const axisUnit = [1, 324, 18];      // x, y, z in the padded array
  const nAxis = [1, 1, 2, 2, 0, 0];   // face normal axis
  for (let f = 0; f < 6; f++) {
    const na = nAxis[f], t = [0, 1, 2].filter(a => a !== na);
    for (let v = 0; v < 4; v++) {
      const p = FV[f][v];
      const s1 = (p[t[0]] ? 1 : -1) * axisUnit[t[0]], s2 = (p[t[1]] ? 1 : -1) * axisUnit[t[1]];
      const n = FOFF[f];
      AOT[(f * 4 + v) * 3] = n + s1; AOT[(f * 4 + v) * 3 + 1] = n + s2; AOT[(f * 4 + v) * 3 + 2] = n + s1 + s2;
    }
  }
})();
// which blocks darken corners (AO): opaque cubes and leaves
const T_AOOCC = new Uint8Array(256);
for (const d of BLOCKS) T_AOOCC[d.id] = (d.model === M_CUBE && d.opacity === 15) || d.leaves ? 1 : 0;

class MeshBuf {
  constructor(maxQuads) {
    this.buf = new ArrayBuffer(maxQuads * 64);
    this.i16 = new Int16Array(this.buf); this.u8 = new Uint8Array(this.buf); this.u16 = new Uint16Array(this.buf);
    this.n = 0; this.max = maxQuads * 4;
  }
}
const MB_SOLID = new MeshBuf(24000), MB_TRANS = new MeshBuf(8000);

function vtx(mb, x, y, z, u, v, tile, r, g, b, sky, blk) {
  const o = mb.n * 8, ob = mb.n * 16;
  mb.i16[o] = x; mb.i16[o + 1] = y; mb.i16[o + 2] = z;
  mb.u8[ob + 6] = u; mb.u8[ob + 7] = v;
  mb.u16[o + 4] = tile;
  mb.u8[ob + 10] = r; mb.u8[ob + 11] = g; mb.u8[ob + 12] = b; mb.u8[ob + 13] = 255;
  mb.u8[ob + 14] = sky; mb.u8[ob + 15] = blk;
  mb.n++;
}

// per-column averaged biome tints for the 16x16 interior columns
const TINT_G = new Uint8Array(256 * 3), TINT_F = new Uint8Array(256 * 3), TINT_W = new Uint8Array(256 * 3);
function computeTints(BIOA) {
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    let gr = 0, gg = 0, gb = 0, fr = 0, fg = 0, fb = 0, wr = 0, wg = 0, wb = 0;
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
      const b = BIOMES[BIOA[(z + dz) * 18 + x + dx]] || BIOMES[2];
      gr += b.grass[0]; gg += b.grass[1]; gb += b.grass[2];
      fr += b.foliage[0]; fg += b.foliage[1]; fb += b.foliage[2];
      wr += b.water[0]; wg += b.water[1]; wb += b.water[2];
    }
    const o = (z * 16 + x) * 3;
    TINT_G[o] = gr / 9; TINT_G[o + 1] = gg / 9; TINT_G[o + 2] = gb / 9;
    TINT_F[o] = fr / 9; TINT_F[o + 1] = fg / 9; TINT_F[o + 2] = fb / 9;
    TINT_W[o] = wr / 9; TINT_W[o + 1] = wg / 9; TINT_W[o + 2] = wb / 9;
  }
}
const tintOut = [255, 255, 255];
function tintFor(kind, col) {   // col = (z*16+x)*3
  switch (kind) {
    case 1: tintOut[0] = TINT_G[col]; tintOut[1] = TINT_G[col + 1]; tintOut[2] = TINT_G[col + 2]; break;
    case 2: tintOut[0] = TINT_F[col]; tintOut[1] = TINT_F[col + 1]; tintOut[2] = TINT_F[col + 2]; break;
    case 3: tintOut[0] = TINT_W[col]; tintOut[1] = TINT_W[col + 1]; tintOut[2] = TINT_W[col + 2]; break;
    case 4: tintOut[0] = SPRUCE_RGB[0]; tintOut[1] = SPRUCE_RGB[1]; tintOut[2] = SPRUCE_RGB[2]; break;
    case 5: tintOut[0] = BIRCH_RGB[0]; tintOut[1] = BIRCH_RGB[1]; tintOut[2] = BIRCH_RGB[2]; break;
    case 6: tintOut[0] = LILY_RGB[0]; tintOut[1] = LILY_RGB[1]; tintOut[2] = LILY_RGB[2]; break;
    default: tintOut[0] = 255; tintOut[1] = 255; tintOut[2] = 255;
  }
  return tintOut;
}

let CB = null, CM = null, CL = null;   // current input arrays
// light of a cell, with special handling for light-opaque non-cube blocks (slabs/stairs): borrow from neighbours
function cellLight(i) {
  const l = CL[i];
  if (l !== 0 || !T_LIGHTFIX[CB[i]]) return l;
  let s = 0, b = 0;
  for (let f = 0; f < 6; f++) { const j = i + FOFF[f]; if (j < 0 || j >= 5832) continue; const q = CL[j]; if ((q >> 4) > s) s = q >> 4; if ((q & 15) > b) b = q & 15; }
  return (s << 4) | b;
}

// ------------------------------------------------------------------ cube faces
const aoV = [0, 0, 0, 0], skyV = [0, 0, 0, 0], blkV = [0, 0, 0, 0];
const QU = [0, 0, 0, 0], QV = [0, 0, 0, 0];
function emitCubeFace(mb, id, f, i, x, y, z, tile, tr, tg, tb, rot, uvOverride, useAO) {
  const ni = i + FOFF[f];
  const lc = cellLight(ni), cs = lc >> 4, cbk = lc & 15, glow = T_GLOW[id] === 1;   // energy blocks shine at full brightness
  const base = f * 12;
  for (let v = 0; v < 4; v++) {
    let sk = cs, bl = cbk, ao = 1;
    if (useAO) {
      const p1 = i + AOT[base + v * 3], p2 = i + AOT[base + v * 3 + 1], pc = i + AOT[base + v * 3 + 2];
      const o1 = T_AOOCC[CB[p1]], o2 = T_AOOCC[CB[p2]], oc = T_AOOCC[CB[pc]];
      let l1 = CL[p1], l2 = CL[p2], lcn = CL[pc];
      if (o1) l1 = lc; else if (T_LIGHTFIX[CB[p1]]) l1 = cellLight(p1);
      if (o2) l2 = lc; else if (T_LIGHTFIX[CB[p2]]) l2 = cellLight(p2);
      if (o1 && o2) lcn = l1; else if (oc) lcn = lc; else if (T_LIGHTFIX[CB[pc]]) lcn = cellLight(pc);
      sk = ((cs + (l1 >> 4) + (l2 >> 4) + (lcn >> 4)) * 0.25);
      bl = ((cbk + (l1 & 15) + (l2 & 15) + (lcn & 15)) * 0.25);
      ao = (o1 && o2) ? 0.4 : 1 - 0.2 * (o1 + o2 + oc);
    }
    if (glow) { ao = 1; bl = 15; }
    aoV[v] = ao; skyV[v] = sk; blkV[v] = bl;
  }
  const sh = glow ? 1 : FSHADE[f];
  const uvs = FUV[f];
  const fv = FV[f];
  // choose triangulation diagonal to reduce AO artefacts
  const flip = (aoV[0] + aoV[2] < aoV[1] + aoV[3]) ? 0 : 0;
  const ord = (aoV[0] + aoV[2] > aoV[1] + aoV[3]) ? 1 : 0;
  for (let k = 0; k < 4; k++) {
    const v = (k + ord) & 3;
    const p = fv[v];
    let uv = uvs[(v + (rot | 0)) & 3];
    let uu = uv[0], vv = uv[1];
    if (uvOverride) { uu = uv[0] === 0 ? uvOverride[0] : uvOverride[2]; vv = uv[1] === 0 ? uvOverride[1] : uvOverride[3]; }
    const c = sh * aoV[v];
    vtx(mb, (x + p[0]) * 256, (y + p[1]) * 256, (z + p[2]) * 256, uu, vv, tile, (tr * c) | 0, (tg * c) | 0, (tb * c) | 0, Math.round(skyV[v] * 17), Math.round(blkV[v] * 17));
  }
}

// ------------------------------------------------------------------ box faces (arbitrary sub-cubes)
const BOXF = [
  (b, s) => [[b.x0, b.y0, b.z1], [b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y0, b.z1]],
  (b, s) => [[b.x0, b.y1, b.z0], [b.x0, b.y1, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0]],
  (b, s) => [[b.x1, b.y1, b.z0], [b.x1, b.y0, b.z0], [b.x0, b.y0, b.z0], [b.x0, b.y1, b.z0]],
  (b, s) => [[b.x0, b.y1, b.z1], [b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1]],
  (b, s) => [[b.x0, b.y1, b.z0], [b.x0, b.y0, b.z0], [b.x0, b.y0, b.z1], [b.x0, b.y1, b.z1]],
  (b, s) => [[b.x1, b.y1, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0]],
];
function boxUV(f, b, ov) {
  let u0, v0, u1, v1;
  if (ov) { u0 = ov[0]; v0 = ov[1]; u1 = ov[2]; v1 = ov[3]; }
  else switch (f) {
    case 0: case 1: u0 = b.x0; u1 = b.x1; v0 = b.z0; v1 = b.z1; break;
    case 2: u0 = 16 - b.x1; u1 = 16 - b.x0; v0 = 16 - b.y1; v1 = 16 - b.y0; break;
    case 3: u0 = b.x0; u1 = b.x1; v0 = 16 - b.y1; v1 = 16 - b.y0; break;
    case 4: u0 = b.z0; u1 = b.z1; v0 = 16 - b.y1; v1 = 16 - b.y0; break;
    default: u0 = 16 - b.z1; u1 = 16 - b.z0; v0 = 16 - b.y1; v1 = 16 - b.y0;
  }
  if (f === 0) return [[u0, v1], [u0, v0], [u1, v0], [u1, v1]];
  return [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
}
function emitBoxFace(mb, b, f, x, y, z, sky, blk, tr, tg, tb) {
  const pos = BOXF[f](b);
  const uvs = boxUV(f, b, b.uv ? b.uv[f] : null);
  const rot = b.rot ? b.rot[f] | 0 : 0;
  const tile = b.ti[f];
  const sh = FSHADE[f];
  const sx = b.shear ? b.shear[0] : 0, sz = b.shear ? b.shear[1] : 0;
  for (let k = 0; k < 4; k++) {
    const p = pos[k], uv = uvs[(k + rot) & 3];
    const top = b.shear && p[1] === b.y1;
    vtx(mb, Math.round((x * 16 + p[0] + (top ? sx : 0)) * 16), Math.round((y * 16 + p[1]) * 16), Math.round((z * 16 + p[2] + (top ? sz : 0)) * 16),
      Math.min(16, Math.max(0, uv[0])), Math.min(16, Math.max(0, uv[1])), tile, (tr * sh) | 0, (tg * sh) | 0, (tb * sh) | 0, sky * 17, blk * 17);
  }
}

// ------------------------------------------------------------------ liquids
function fluidHeight(id, meta) {
  const d = meta & 7;
  if (meta & 8) return 1;
  return id === BID.lava ? Math.max(0.15, (8 - d * 2) / 9) : (8 - d) / 9;
}
function cornerHeight(i, id, cx, cz) {
  // cells around the corner: (0,0),(cx-1..) : self + neighbours toward the corner
  let tot = 0, wsum = 0;
  const offs = [0, cx ? 1 : -1, cz ? 18 : -18, (cx ? 1 : -1) + (cz ? 18 : -18)];
  for (let k = 0; k < 4; k++) {
    const j = i + offs[k], bj = CB[j];
    if (bj === id || (T_FLUID[bj] && T_FLUID[bj] === T_FLUID[id])) {
      if (T_FLUID[CB[j + 324]] === T_FLUID[id]) return 1;
      const m = CM[j], w = (m & 7) === 0 ? 10 : 1;
      tot += fluidHeight(bj, m) * w; wsum += w;
    } else if (!T_OPAQUE[bj] && !T_SOLID[bj]) { wsum += 1; }
  }
  return wsum ? tot / wsum : 0;
}
function emitLiquid(i, id, meta, x, y, z, col) {
  const isLava = id === BID.lava, mb = MB_TRANS === null ? MB_SOLID : (isLava ? MB_SOLID : MB_TRANS);
  const kind = T_FLUID[id];
  const flowing = (meta & 15) !== 0;
  const topTile = isLava ? (flowing ? tileOf('lava_flow') : tileOf('lava_still')) : (flowing ? tileOf('water_flow') : tileOf('water_still'));
  const sideTile = isLava ? tileOf('lava_flow') : tileOf('water_flow');
  const t = isLava ? tintFor(0, col) : tintFor(3, col);
  const tr = t[0], tg = t[1], tb = t[2];
  const own = cellLight(i);
  const above = CB[i + 324];
  const aboveFluid = T_FLUID[above] === kind;
  const h00 = aboveFluid ? 1 : cornerHeight(i, id, 0, 0), h10 = aboveFluid ? 1 : cornerHeight(i, id, 1, 0),
    h01 = aboveFluid ? 1 : cornerHeight(i, id, 0, 1), h11 = aboveFluid ? 1 : cornerHeight(i, id, 1, 1);
  const litSky = (f) => { const l = cellLight(i + FOFF[f]); const s = Math.max(own >> 4, l >> 4), b = Math.max(own & 15, l & 15); return [s, isLava ? 15 : b]; };
  // top
  if (!aboveFluid && !T_OPAQUE[above]) {
    const l = litSky(1), sh = 1;
    const c = isLava ? 1 : 1;
    const Y = (hh) => Math.round((y + hh) * 256);
    const X0 = x * 256, X1 = (x + 1) * 256, Z0 = z * 256, Z1 = (z + 1) * 256;
    // vertex order a(x0,z0) b(x0,z1) c(x1,z1) d(x1,z0) -> heights h00,h01,h11,h10
    const sky = l[0] * 17, blk = (isLava ? 15 : l[1]) * 17;
    vtx(mb, X0, Y(h00), Z0, 0, 0, topTile, tr, tg, tb, sky, blk);
    vtx(mb, X0, Y(h01), Z1, 0, 16, topTile, tr, tg, tb, sky, blk);
    vtx(mb, X1, Y(h11), Z1, 16, 16, topTile, tr, tg, tb, sky, blk);
    vtx(mb, X1, Y(h10), Z0, 16, 0, topTile, tr, tg, tb, sky, blk);
    if (!isLava && above === 0 && MB_TRANS === null) {   // back face so the surface is visible from below (the translucent pass draws both sides itself)
      vtx(mb, X0, Y(h00), Z0, 0, 0, topTile, tr, tg, tb, sky, blk);
      vtx(mb, X1, Y(h10), Z0, 16, 0, topTile, tr, tg, tb, sky, blk);
      vtx(mb, X1, Y(h11), Z1, 16, 16, topTile, tr, tg, tb, sky, blk);
      vtx(mb, X0, Y(h01), Z1, 0, 16, topTile, tr, tg, tb, sky, blk);
    }
  }
  // bottom
  const below = CB[i - 324];
  if (!T_OPAQUE[below] && T_FLUID[below] !== kind) {
    const l = litSky(0), sky = l[0] * 17, blk = (isLava ? 15 : l[1]) * 17, s = FSHADE[0];
    const X0 = x * 256, X1 = (x + 1) * 256, Z0 = z * 256, Z1 = (z + 1) * 256, Yy = y * 256;
    vtx(mb, X0, Yy, Z1, 0, 16, sideTile, (tr * s) | 0, (tg * s) | 0, (tb * s) | 0, sky, blk);
    vtx(mb, X0, Yy, Z0, 0, 0, sideTile, (tr * s) | 0, (tg * s) | 0, (tb * s) | 0, sky, blk);
    vtx(mb, X1, Yy, Z0, 16, 0, sideTile, (tr * s) | 0, (tg * s) | 0, (tb * s) | 0, sky, blk);
    vtx(mb, X1, Yy, Z1, 16, 16, sideTile, (tr * s) | 0, (tg * s) | 0, (tb * s) | 0, sky, blk);
  }
  // sides
  for (let f = 2; f < 6; f++) {
    const nid = CB[i + FOFF[f]];
    if (T_OPAQUE[nid] || T_FLUID[nid] === kind) continue;
    // corner heights on this side: f2 north(z-): a=(x1,z0) d=(x0,z0) ; f3 south: a=(x0,z1) d=(x1,z1); f4 west: a=(x0,z0) d=(x0,z1); f5 east: a=(x1,z1) d=(x1,z0)
    let hA, hD;
    if (f === 2) { hA = h10; hD = h00; } else if (f === 3) { hA = h01; hD = h11; } else if (f === 4) { hA = h00; hD = h01; } else { hA = h11; hD = h10; }
    const l = litSky(f), sky = l[0] * 17, blk = (isLava ? 15 : l[1]) * 17, s = FSHADE[f];
    const c0 = (tr * s) | 0, c1 = (tg * s) | 0, c2 = (tb * s) | 0;
    const p = FV[f];
    const vA = Math.round((16 - hA * 16)), vD = Math.round((16 - hD * 16));
    // a (top), b (bottom), c (bottom), d (top)
    const pa = p[0], pb = p[1], pc = p[2], pd = p[3];
    vtx(mb, (x + pa[0]) * 256, Math.round((y + hA) * 256), (z + pa[2]) * 256, 0, vA, sideTile, c0, c1, c2, sky, blk);
    vtx(mb, (x + pb[0]) * 256, y * 256, (z + pb[2]) * 256, 0, 16, sideTile, c0, c1, c2, sky, blk);
    vtx(mb, (x + pc[0]) * 256, y * 256, (z + pc[2]) * 256, 16, 16, sideTile, c0, c1, c2, sky, blk);
    vtx(mb, (x + pd[0]) * 256, Math.round((y + hD) * 256), (z + pd[2]) * 256, 16, vD, sideTile, c0, c1, c2, sky, blk);
    if (!isLava && (nid === 0)) { // double-sided water edges are not needed; keep single-sided
    }
  }
}

// ------------------------------------------------------------------ cross / crop plants
function emitPlane(mb, x0, z0, x1, z1, y0, y1, tile, r, g, b, sky, blk) {
  // one double-sided vertical quad from (x0,z0) to (x1,z1); coordinates in blocks (already offset)
  const X0 = Math.round(x0 * 256), X1 = Math.round(x1 * 256), Z0 = Math.round(z0 * 256), Z1 = Math.round(z1 * 256), Y0 = Math.round(y0 * 256), Y1 = Math.round(y1 * 256);
  vtx(mb, X0, Y1, Z0, 0, 0, tile, r, g, b, sky, blk); vtx(mb, X0, Y0, Z0, 0, 16, tile, r, g, b, sky, blk);
  vtx(mb, X1, Y0, Z1, 16, 16, tile, r, g, b, sky, blk); vtx(mb, X1, Y1, Z1, 16, 0, tile, r, g, b, sky, blk);
  vtx(mb, X1, Y1, Z1, 16, 0, tile, r, g, b, sky, blk); vtx(mb, X1, Y0, Z1, 16, 16, tile, r, g, b, sky, blk);
  vtx(mb, X0, Y0, Z0, 0, 16, tile, r, g, b, sky, blk); vtx(mb, X0, Y1, Z0, 0, 0, tile, r, g, b, sky, blk);
}

// ------------------------------------------------------------------ fire (BlockFire renderer: slanted flame planes, or flat flames on flammable walls)
function fireQuad(mb, lx, ly, lz, tile, sky, blk, p) {
  // p: 4 vertices [x,y,z,u,v] in block-local units (y already scaled); emitted double-sided
  for (let k = 0; k < 4; k++) { const v = p[k]; vtx(mb, Math.round((lx + v[0]) * 256), Math.round((ly + v[1]) * 256), Math.round((lz + v[2]) * 256), v[3], v[4], tile, 255, 255, 255, sky, blk); }
  for (let k = 3; k >= 0; k--) { const v = p[k]; vtx(mb, Math.round((lx + v[0]) * 256), Math.round((ly + v[1]) * 256), Math.round((lz + v[2]) * 256), v[3], v[4], tile, 255, 255, 255, sky, blk); }
}
function emitFire(mb, i, lx, ly, lz, wpar, soul) {
  const ln = cellLight(i), sky = (ln >> 4) * 17, blk = 255, f = 1.4;
  let ta = tileOf(soul ? 'soul_fire_0' : 'fire_layer_0'), tb = tileOf(soul ? 'soul_fire_1' : 'fire_layer_1');
  if (wpar) { const t = ta; ta = tb; tb = t; }
  const below = CB[i - 324];
  const nb = [CB[i - 18], CB[i + 18], CB[i - 1], CB[i + 1]];   // north south west east
  const burns = (n) => T_FLAM[n] > 0 || T_ENC[n] > 0;
  if (T_SOLID[below] || burns(below) || !(burns(nb[0]) || burns(nb[1]) || burns(nb[2]) || burns(nb[3]))) {
    // interior X planes
    fireQuad(mb, lx, ly, lz, ta, sky, blk, [[0.2, f, 1, 16, 0], [0.7, 0, 1, 16, 16], [0.7, 0, 0, 0, 16], [0.2, f, 0, 0, 0]]);
    fireQuad(mb, lx, ly, lz, ta, sky, blk, [[0.8, f, 0, 16, 0], [0.3, 0, 0, 16, 16], [0.3, 0, 1, 0, 16], [0.8, f, 1, 0, 0]]);
    fireQuad(mb, lx, ly, lz, ta, sky, blk, [[1, f, 0.2, 16, 0], [1, 0, 0.7, 16, 16], [0, 0, 0.7, 0, 16], [0, f, 0.2, 0, 0]]);
    fireQuad(mb, lx, ly, lz, ta, sky, blk, [[0, f, 0.8, 16, 0], [0, 0, 0.3, 16, 16], [1, 0, 0.3, 0, 16], [1, f, 0.8, 0, 0]]);
    // edge planes
    fireQuad(mb, lx, ly, lz, tb, sky, blk, [[0.1, 0, 0, 0, 16], [0, f, 0, 0, 0], [0, f, 1, 16, 0], [0.1, 0, 1, 16, 16]]);
    fireQuad(mb, lx, ly, lz, tb, sky, blk, [[0.9, 0, 1, 0, 16], [1, f, 1, 0, 0], [1, f, 0, 16, 0], [0.9, 0, 0, 16, 16]]);
    fireQuad(mb, lx, ly, lz, tb, sky, blk, [[0, 0, 0.1, 0, 16], [0, f, 0, 0, 0], [1, f, 0, 16, 0], [1, 0, 0.1, 16, 16]]);
    fireQuad(mb, lx, ly, lz, tb, sky, blk, [[1, 0, 0.9, 0, 16], [1, f, 1, 0, 0], [0, f, 1, 16, 0], [0, 0, 0.9, 16, 16]]);
  } else {
    if (burns(nb[2])) { fireQuad(mb, lx, ly, lz, ta, sky, blk, [[0.04, f, 1, 16, 0], [0.04, 0, 1, 16, 16], [0.04, 0, 0, 0, 16], [0.04, f, 0, 0, 0]]); fireQuad(mb, lx, ly, lz, tb, sky, blk, [[0.12, f, 1, 16, 0], [0.12, 0, 1, 16, 16], [0.12, 0, 0, 0, 16], [0.12, f, 0, 0, 0]]); }
    if (burns(nb[3])) { fireQuad(mb, lx, ly, lz, ta, sky, blk, [[0.96, f, 0, 16, 0], [0.96, 0, 0, 16, 16], [0.96, 0, 1, 0, 16], [0.96, f, 1, 0, 0]]); fireQuad(mb, lx, ly, lz, tb, sky, blk, [[0.88, f, 0, 16, 0], [0.88, 0, 0, 16, 16], [0.88, 0, 1, 0, 16], [0.88, f, 1, 0, 0]]); }
    if (burns(nb[0])) { fireQuad(mb, lx, ly, lz, ta, sky, blk, [[0, f, 0.04, 16, 0], [0, 0, 0.04, 16, 16], [1, 0, 0.04, 0, 16], [1, f, 0.04, 0, 0]]); fireQuad(mb, lx, ly, lz, tb, sky, blk, [[0, f, 0.12, 16, 0], [0, 0, 0.12, 16, 16], [1, 0, 0.12, 0, 16], [1, f, 0.12, 0, 0]]); }
    if (burns(nb[1])) { fireQuad(mb, lx, ly, lz, ta, sky, blk, [[1, f, 0.96, 16, 0], [1, 0, 0.96, 16, 16], [0, 0, 0.96, 0, 16], [0, f, 0.96, 0, 0]]); fireQuad(mb, lx, ly, lz, tb, sky, blk, [[1, f, 0.88, 16, 0], [1, 0, 0.88, 16, 16], [0, 0, 0.88, 0, 16], [0, f, 0.88, 0, 0]]); }
  }
}

// ------------------------------------------------------------------ main entry
function meshSection(inp) {
  CB = inp.B; CM = inp.M; CL = inp.L;
  const wx0 = inp.wx0, wy0 = inp.wy0, wz0 = inp.wz0;
  MB_SOLID.n = 0; MB_TRANS.n = 0;
  computeTints(inp.BIO);
  const solid = MB_SOLID;
  for (let y = 1; y <= 16; y++) for (let z = 1; z <= 16; z++) for (let x = 1; x <= 16; x++) {
    const i = (y * 18 + z) * 18 + x, id = CB[i];
    if (id === 0) continue;
    if (solid.n > solid.max - 64 || MB_TRANS.n > MB_TRANS.max - 64) break;
    const model = T_MODEL[id];
    const lx = x - 1, ly = y - 1, lz = z - 1, col = (lz * 16 + lx) * 3;
    if (model === M_CUBE || model === M_CUTOUT || model === M_TRANS) {
      const meta = CM[i];
      const d = BLOCKS[id];
      const mb = model === M_TRANS ? MB_TRANS : solid;
      const tk = T_TINT[id];
      const orient = T_ORIENT[id], isLog = T_LOG[id];
      for (let f = 0; f < 6; f++) {
        const nid = CB[i + FOFF[f]];
        if (T_OPAQUE[nid]) continue;
        if (model === M_CUTOUT) { if (nid === id && T_CULLSAME[id]) continue; }
        else if (model === M_TRANS) { if (nid === id) continue; }
        let tile = FT[id * 6 + f], rot = 0;
        if (orient) { const front = meta >= 2 && meta <= 5 ? meta : 3; if (f === front) tile = FRONT_T[id]; }
        else if (isLog) {
          const axis = meta & 3, end = FT[id * 6 + 1], bark = FT[id * 6 + 2];
          if (axis === 0) tile = (f < 2) ? end : bark;
          else if (axis === 1) { if (f >= 4) tile = end; else { tile = bark; rot = 1; } }
          else { if (f === 2 || f === 3) tile = end; else { tile = bark; rot = (f >= 4) ? 1 : 0; } }
        }
        let tr = 255, tg = 255, tb = 255;
        if (tk && (!d.tintTopOnly || f === 1)) { const t = tintFor(tk, col); tr = t[0]; tg = t[1]; tb = t[2]; }
        emitCubeFace(mb, id, f, i, lx, ly, lz, tile, tr, tg, tb, rot, null, true);
        if (f >= 2 && OVERLAY_T[id] >= 0) { const t = tintFor(tk, col); emitCubeFace(mb, id, f, i, lx, ly, lz, OVERLAY_T[id], t[0], t[1], t[2], 0, null, true); }
      }
    } else if (model === M_LIQUID) {
      emitLiquid(i, id, CM[i], lx, ly, lz, col);
    } else if (model === M_CROSS || model === M_CROP) {
      const d = BLOCKS[id], ln = cellLight(i), sky = (ln >> 4) * 17, blk = (ln & 15) * 17;
      const t = tintFor(T_TINT[id], col);
      let ox = 0, oz = 0;
      if (T_OFFSET[id]) { const h = hash3(wx0 + lx, 7, wz0 + lz, 99); ox = ((h & 255) / 255 - 0.5) * 0.5; oz = (((h >>> 8) & 255) / 255 - 0.5) * 0.5; }
      const X = lx + ox, Z = lz + oz, Y0 = ly, hgt = ly + 1;
      if (model === M_CROSS) {
        const tile = FT[id * 6 + 2];
        emitPlane(solid, X + 0.05, Z + 0.05, X + 0.95, Z + 0.95, Y0, hgt, tile, t[0], t[1], t[2], sky, blk);
        emitPlane(solid, X + 0.05, Z + 0.95, X + 0.95, Z + 0.05, Y0, hgt, tile, t[0], t[1], t[2], sky, blk);
      } else {
        const tile = STAGE_T[id * 8 + (CM[i] & 7)];
        emitPlane(solid, lx + 0.25, lz, lx + 0.25, lz + 1, Y0, hgt, tile, 255, 255, 255, sky, blk);
        emitPlane(solid, lx + 0.75, lz + 1, lx + 0.75, lz, Y0, hgt, tile, 255, 255, 255, sky, blk);
        emitPlane(solid, lx, lz + 0.25, lx + 1, lz + 0.25, Y0, hgt, tile, 255, 255, 255, sky, blk);
        emitPlane(solid, lx + 1, lz + 0.75, lx, lz + 0.75, Y0, hgt, tile, 255, 255, 255, sky, blk);
      }
    } else if (model === M_FIRE) {
      emitFire(solid, i, lx, ly, lz, (wx0 + lx + wy0 + ly + wz0 + lz) & 1, !!BLOCKS[id].soulFire);
    } else if (model === M_PORTAL) {
      // nether portal: thin glowing translucent pane; the edge faces between portal blocks are hidden
      const meta = CM[i], b = getBoxes(id, meta)[0], axisZ = (meta & 1) === 1, own = cellLight(i);
      if (!b.ti) { b.ti = new Int16Array(6); for (let f = 0; f < 6; f++) b.ti[f] = tileOf(b.t[f]); }
      for (let f = 0; f < 6; f++) {
        const nid = CB[i + FOFF[f]], big = axisZ ? (f === 4 || f === 5) : (f === 2 || f === 3);
        if (!big && (nid === id || T_OPAQUE[nid])) continue;
        emitBoxFace(MB_TRANS, b, f, lx, ly, lz, own >> 4, 14, 255, 255, 255);
      }
    } else if (model === M_BOX) {
      const d = BLOCKS[id];
      let meta = CM[i];
      if (d.conn) meta = connMask(d.conn, CB[i - 18], CB[i + 18], CB[i - 1], CB[i + 1]);
      else if (d.chorus === 'plant') meta = chorusMask(CB[i - 324], CB[i + 324], CB[i - 18], CB[i + 18], CB[i - 1], CB[i + 1]);
      const boxes = getBoxes(id, meta);
      if (!boxes) continue;
      const own = cellLight(i), tk = T_TINT[id];
      const t = tintFor(tk, col);
      for (let bi = 0; bi < boxes.length; bi++) {
        const b = boxes[bi];
        if (!b.ti) { b.ti = new Int16Array(6); for (let f = 0; f < 6; f++) b.ti[f] = tileOf(b.t[f]); }
        for (let f = 0; f < 6; f++) {
          if (b.skip && ((b.skip >> f) & 1)) continue;
          const nid = CB[i + FOFF[f]];
          if ((f === 0 && b.y0 === 0) || (f === 1 && b.y1 === 16) || (f === 2 && b.z0 === 0) || (f === 3 && b.z1 === 16) || (f === 4 && b.x0 === 0) || (f === 5 && b.x1 === 16)) {
            if (T_OPAQUE[nid]) continue;
            if (nid === id && d.cullSame) continue;
          }
          const ln = cellLight(i + FOFF[f]);
          const s = Math.max(own >> 4, ln >> 4), bk = T_GLOW[id] ? 15 : Math.max(own & 15, ln & 15);
          emitBoxFace(solid, b, f, lx, ly, lz, s, bk, t[0], t[1], t[2]);
        }
      }
    }
  }
  const out = { solid: null, solidVerts: 0, trans: null, transVerts: 0 };
  if (MB_SOLID.n > 0) { out.solid = MB_SOLID.buf.slice(0, MB_SOLID.n * 16); out.solidVerts = MB_SOLID.n; }
  if (MB_TRANS.n > 0) { out.trans = MB_TRANS.buf.slice(0, MB_TRANS.n * 16); out.transVerts = MB_TRANS.n; }
  return out;
}

function initAll(tileIndex) { initTables(tileIndex); }

const API = {
  CHUNK, WORLD_H, SEA, BLOCKS, BID, BIOMES, BIO, NB, M_NONE, M_CUBE, M_CUTOUT, M_TRANS, M_LIQUID, M_CROSS, M_CROP, M_BOX,
  T_OPAQUE, T_OPACITY, T_EMIT, T_MODEL, T_SOLID, T_FLUID, T_REPL, T_LIGHTFIX, T_LOG, T_ORIENT, T_CONN, T_ENC, T_FLAM, M_FIRE, connMask,
  getBoxes, getCollision, getSelection, usedTileNames, initAll, meshSection, missingTiles: () => MISSING_TILES.slice(),
  Perlin, mulberry32, hash3, hashf, seedToInt, fbm2, clamp, lerp, smoothstep,
  generateChunk: (seed, cx, cz, dim) => dim === 3 ? getMedohGen(seed).generateChunk(cx, cz) : dim === 1 ? getNetherGen(seed).generateChunk(cx, cz) : dim === 2 ? getEndGen(seed).generateChunk(cx, cz) : getGen(seed).generateChunk(cx, cz),
  findSpawn: (seed) => getGen(seed).findSpawn(),
  medohSpawn: () => ({ x: MEDOH_SPAWN.x, y: MEDOH_SPAWN.y, z: MEDOH_SPAWN.z }), medohHeight: (seed, x, z) => getMedohGen(seed).hAt(x, z), MEDOH_BEAM,
  M_PORTAL, chorusMask, endSpikes, endPodiumY, placeEndPodium, NETHER_LAVA_Y,
  netherBiome: (seed, x, z) => getNetherGen(seed).biomeAt(x, z), netherSolid: (seed, x, y, z) => getNetherGen(seed).solidAt(x, y, z),
  endTop: (seed, x, z) => getEndGen(seed).topAt(x, z), endBiome: (seed, cx, cz) => getEndGen(seed).biomeAtChunk(cx, cz),
  locateStructure, strongholdPositions, strongholdLayout, fortressAt, strongholdAt, villageZoneAt,
  growFungus: (seed, kind, x, y, z, rnd, put) => getNetherGen(seed).hugeFungus(kind, x, y, z, rnd, put),
  growChorus: (seed, x, y, z, rnd, put) => getEndGen(seed).chorusTree(x, y, z, rnd, put),
  columnInfo: (seed, x, z) => { const g = getGen(seed); const c = g.column(x, z); return { h: c.h, biome: c.biome, cont: c.cont, temp: c.temp, hum: c.hum, river: c.river, mtn: c.mtn }; },
  entranceAt: (seed, x, z) => getGen(seed).entrance(x, z),
  growTree: (seed, kind, x, y, z, rnd, put) => getGen(seed).treeAt(kind, x, y, z, rnd, put),
};
