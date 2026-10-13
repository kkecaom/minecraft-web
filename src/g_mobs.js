// ===== g_mobs.js : skin-mapped box models, mob AI =====
// Models are authored in Minecraft's model space (y down, front = -z, pivots in pixels, origin 24px above the feet) and converted:
//   mine = (x, 24 - y, -z)  (a proper rotation), rotations become (rx, -ry, -rz).
const SKIN_ATLAS = { w: 256, h: 256 };    // size of the packed skin atlas (set by Renderer.buildSkinAtlas)
class ModelPart {
  // box=[x,y,z,w,h,d] MC coords ; pivot=[x,y,z] MC coords ; uv=[u,v]
  constructor(name, uv, box, pivot, o) {
    o = o || {};
    this.name = name; this.u = uv[0]; this.v = uv[1];
    const inf = o.inflate || 0;
    this.w = box[3]; this.h = box[4]; this.d = box[5];
    this.x0 = box[0] - inf; this.x1 = box[0] + box[3] + inf;
    this.y0 = -(box[1] + box[4]) - inf; this.y1 = -box[1] + inf;      // y-up relative to pivot
    this.z0 = -(box[2] + box[5]) - inf; this.z1 = -box[2] + inf;
    this.px = pivot[0]; this.py = 24 - pivot[1]; this.pz = -pivot[2];
    this.rx0 = (o.rot ? o.rot[0] : 0); this.ry0 = (o.rot ? -o.rot[1] : 0); this.rz0 = (o.rot ? -o.rot[2] : 0);
    this.mirror = !!o.mirror; this.follow = o.follow || null; this.skin = o.skin || null; this.hide = o.hide || null; this.trans = !!o.trans;
    this.tw = o.tw || 64; this.th = o.th || 32;
  }
}
const _pm = new Float32Array(16), _pt = new Float32Array(16), _pr = new Float32Array(16), _pa = new Float32Array(16), _pb = new Float32Array(16);
// emit one part into the skin batch. M = entity matrix (camera relative, model units in blocks)
function emitPart(batch, part, rx, ry, rz, ox, oy, oz, M, skinRect, r, g, b, a, sky, blk, sx, sy, sz) {
  // matrix = M * T(pivot/16 + offset) * Rz * Ry * Rx
  m4TranslateM(_pt, (part.px + ox) / 16, (part.py + oy) / 16, (part.pz + oz) / 16);
  m4Mul(_pm, M, _pt);
  if (rz) { m4Mul(_pa, _pm, m4RotZ(_pb, rz)); _pm.set(_pa); }
  if (ry) { m4Mul(_pa, _pm, m4RotY(_pb, ry)); _pm.set(_pa); }
  if (rx) { m4Mul(_pa, _pm, m4RotX(_pb, rx)); _pm.set(_pa); }
  if (sx !== undefined && (sx !== 1 || sy !== 1 || sz !== 1)) { m4Mul(_pa, _pm, m4Scale(_pb, sx, sy, sz)); _pm.set(_pa); }
  const x0 = part.x0 / 16, x1 = part.x1 / 16, y0 = part.y0 / 16, y1 = part.y1 / 16, z0 = part.z0 / 16, z1 = part.z1 / 16;
  const u = part.u, v = part.v, w = part.w, h = part.h, d = part.d, ox2 = skinRect.x, oy2 = skinRect.y, TU = 1 / SKIN_ATLAS.w, TV = 1 / SKIN_ATLAS.h;
  // per face: [ (u0,v0,u1,v1) region ]
  const reg = [
    [u + d + w, v, u + d + 2 * w, v + d],          // down
    [u + d, v, u + d + w, v + d],                  // up
    [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],   // north (back, -z)
    [u + d, v + d, u + d + w, v + d + h],          // south (front, +z)
    [u, v + d, u + d, v + d + h],                  // west (entity's right, -x)
    [u + d + w, v + d, u + 2 * d + w, v + d + h],  // east (entity's left, +x)
  ];
  if (part.mirror) { const t = reg[4]; reg[4] = reg[5]; reg[5] = t; }
  const P = [
    [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]],
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    [[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]],
    [[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]],
    [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
    [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]],
  ];
  const N = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  const o = [0, 0, 0];
  for (let f = 0; f < 6; f++) {
    const R = reg[f], ua = (ox2 + R[0]) * TU, va = (oy2 + R[1]) * TV, ub = (ox2 + R[2]) * TU, vb = (oy2 + R[3]) * TV;
    let U0 = ua, U1 = ub;
    if (part.mirror) { U0 = ub; U1 = ua; }
    // shade from the transformed normal
    const n = N[f], nx = _pm[0] * n[0] + _pm[4] * n[1] + _pm[8] * n[2], ny = _pm[1] * n[0] + _pm[5] * n[1] + _pm[9] * n[2], nz = _pm[2] * n[0] + _pm[6] * n[1] + _pm[10] * n[2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    const sh = Math.abs(nx / nl) * 0.6 + Math.abs(nz / nl) * 0.8 + (ny > 0 ? ny / nl * 1.0 : -ny / nl * 0.5);
    // uv corner order a,b,c,d : (U0,va) (U0,vb) (U1,vb) (U1,va) ; down face has flipped v
    let uv;
    if (f === 0) uv = [[U0, va], [U0, vb], [U1, vb], [U1, va]];
    else uv = [[U0, va], [U0, vb], [U1, vb], [U1, va]];
    for (let k = 0; k < 4; k++) {
      const p = P[f][k]; m4Transform(_pm, p[0], p[1], p[2], o);
      batch.v(o[0], o[1], o[2], uv[k][0], uv[k][1], 0, r * sh, g * sh, b * sh, a, sky, blk);
    }
  }
}

// ---------------------------------------------------------------- model definitions
const MODELS = {};
function humanoid(sk, w, h, arm) {
  // arm: [armW]. sk 64x64 layout (steve/zombie) or 64x32 (skeleton mirrored limbs)
  const parts = [];
  const big = h === 64;
  parts.push(new ModelPart('head', [0, 0], [-4, -8, -4, 8, 8, 8], [0, 0, 0], { tw: w, th: h }));
  parts.push(new ModelPart('hat', [32, 0], [-4, -8, -4, 8, 8, 8], [0, 0, 0], { inflate: 0.5, follow: 'head', tw: w, th: h }));
  parts.push(new ModelPart('body', [16, 16], [-4, 0, -2, 8, 12, 4], [0, 0, 0], { tw: w, th: h }));
  if (big) parts.push(new ModelPart('jacket', [16, 32], [-4, 0, -2, 8, 12, 4], [0, 0, 0], { inflate: 0.25, follow: 'body', tw: w, th: h }));
  const aw = arm; // arm width
  parts.push(new ModelPart('rarm', [40, 16], [-aw + (aw === 4 ? 1 : 0), -2, -aw / 2, aw, 12, aw], [-5, aw === 4 ? 2 : 2, 0], { tw: w, th: h }));
  parts.push(new ModelPart('larm', big ? [32, 48] : [40, 16], [aw === 4 ? -1 : 0, -2, -aw / 2, aw, 12, aw], [5, 2, 0], { mirror: !big, tw: w, th: h }));
  if (big) {
    parts.push(new ModelPart('rsleeve', [40, 32], [-3, -2, -2, 4, 12, 4], [-5, 2, 0], { inflate: 0.25, follow: 'rarm', tw: w, th: h }));
    parts.push(new ModelPart('lsleeve', [48, 48], [-1, -2, -2, 4, 12, 4], [5, 2, 0], { inflate: 0.25, follow: 'larm', tw: w, th: h }));
  }
  const lw = aw;
  parts.push(new ModelPart('rleg', [0, 16], [-lw / 2, 0, -lw / 2, lw, 12, lw], [-1.9, 12, 0], { tw: w, th: h }));
  parts.push(new ModelPart('lleg', big ? [16, 48] : [0, 16], [-lw / 2, 0, -lw / 2, lw, 12, lw], [1.9, 12, 0], { mirror: !big, tw: w, th: h }));
  if (big) {
    parts.push(new ModelPart('rpants', [0, 32], [-2, 0, -2, 4, 12, 4], [-1.9, 12, 0], { inflate: 0.25, follow: 'rleg', tw: w, th: h }));
    parts.push(new ModelPart('lpants', [0, 48], [-2, 0, -2, 4, 12, 4], [1.9, 12, 0], { inflate: 0.25, follow: 'lleg', tw: w, th: h }));
  }
  return parts;
}
function skeletonParts() {
  const p = [];
  p.push(new ModelPart('head', [0, 0], [-4, -8, -4, 8, 8, 8], [0, 0, 0]));
  p.push(new ModelPart('body', [16, 16], [-4, 0, -2, 8, 12, 4], [0, 0, 0]));
  p.push(new ModelPart('rarm', [40, 16], [-1, -2, -1, 2, 12, 2], [-5, 2, 0]));
  p.push(new ModelPart('larm', [40, 16], [-1, -2, -1, 2, 12, 2], [5, 2, 0], { mirror: true }));
  p.push(new ModelPart('rleg', [0, 16], [-1, 0, -1, 2, 12, 2], [-2, 12, 0]));
  p.push(new ModelPart('lleg', [0, 16], [-1, 0, -1, 2, 12, 2], [2, 12, 0], { mirror: true }));
  return p;
}
MODELS.steve = { skin: 'steve', parts: humanoid('steve', 64, 64, 4) };
MODELS.zombie = { skin: 'zombie', parts: humanoid('zombie', 64, 64, 4) };
MODELS.skeleton = { skin: 'skeleton', parts: skeletonParts() };
MODELS.creeper = {
  skin: 'creeper', parts: [
    new ModelPart('head', [0, 0], [-4, -8, -4, 8, 8, 8], [0, 6, 0]),
    new ModelPart('body', [16, 16], [-4, 0, -2, 8, 12, 4], [0, 6, 0]),
    new ModelPart('leg0', [0, 16], [-2, 0, -2, 4, 6, 4], [-2, 18, 4]),
    new ModelPart('leg1', [0, 16], [-2, 0, -2, 4, 6, 4], [2, 18, 4], { mirror: true }),
    new ModelPart('leg2', [0, 16], [-2, 0, -2, 4, 6, 4], [-2, 18, -4]),
    new ModelPart('leg3', [0, 16], [-2, 0, -2, 4, 6, 4], [2, 18, -4], { mirror: true }),
  ]
};
const HALF_PI = Math.PI / 2;
MODELS.pig = {
  skin: 'pig', parts: [
    new ModelPart('head', [0, 0], [-4, -4, -8, 8, 8, 8], [0, 12, -6]),
    new ModelPart('snout', [16, 16], [-2, 0, -9, 4, 3, 1], [0, 12, -6], { follow: 'head' }),
    new ModelPart('body', [28, 8], [-5, -10, -7, 10, 16, 8], [0, 11, 2], { rot: [HALF_PI, 0, 0] }),
    new ModelPart('leg0', [0, 16], [-2, 0, -2, 4, 6, 4], [-3, 18, 7]),
    new ModelPart('leg1', [0, 16], [-2, 0, -2, 4, 6, 4], [3, 18, 7], { mirror: true }),
    new ModelPart('leg2', [0, 16], [-2, 0, -2, 4, 6, 4], [-3, 18, -5]),
    new ModelPart('leg3', [0, 16], [-2, 0, -2, 4, 6, 4], [3, 18, -5], { mirror: true }),
  ]
};
MODELS.cow = {
  skin: 'cow', parts: [
    new ModelPart('head', [0, 0], [-4, -4, -6, 8, 8, 6], [0, 4, -8]),
    new ModelPart('horn0', [22, 0], [-5, -5, -5, 1, 3, 1], [0, 4, -8], { follow: 'head' }),
    new ModelPart('horn1', [22, 0], [4, -5, -5, 1, 3, 1], [0, 4, -8], { follow: 'head' }),
    new ModelPart('body', [18, 4], [-6, -10, -7, 12, 18, 10], [0, 5, 2], { rot: [HALF_PI, 0, 0] }),
    new ModelPart('udder', [52, 0], [-2, 2, -8, 4, 6, 1], [0, 5, 2], { rot: [HALF_PI, 0, 0], follow: 'body' }),
    new ModelPart('leg0', [0, 16], [-2, 0, -2, 4, 12, 4], [-4, 12, 7]),
    new ModelPart('leg1', [0, 16], [-2, 0, -2, 4, 12, 4], [4, 12, 7], { mirror: true }),
    new ModelPart('leg2', [0, 16], [-2, 0, -2, 4, 12, 4], [-4, 12, -6]),
    new ModelPart('leg3', [0, 16], [-2, 0, -2, 4, 12, 4], [4, 12, -6], { mirror: true }),
  ]
};
MODELS.sheep = {
  skin: 'sheep', fur: 'sheep_fur', parts: [
    new ModelPart('head', [0, 0], [-3, -4, -6, 6, 6, 8], [0, 6, -8]),
    new ModelPart('body', [28, 8], [-4, -10, -7, 8, 16, 6], [0, 5, 2], { rot: [HALF_PI, 0, 0] }),
    new ModelPart('leg0', [0, 16], [-2, 0, -2, 4, 12, 4], [-3, 12, 7]),
    new ModelPart('leg1', [0, 16], [-2, 0, -2, 4, 12, 4], [3, 12, 7], { mirror: true }),
    new ModelPart('leg2', [0, 16], [-2, 0, -2, 4, 12, 4], [-3, 12, -5]),
    new ModelPart('leg3', [0, 16], [-2, 0, -2, 4, 12, 4], [3, 12, -5], { mirror: true }),
    new ModelPart('fhead', [0, 0], [-3, -4, -4, 6, 6, 6], [0, 6, -8], { inflate: 0.6, follow: 'head', skin: 'sheep_fur' }),
    new ModelPart('fbody', [28, 8], [-4, -10, -7, 8, 16, 6], [0, 5, 2], { inflate: 1.75, rot: [HALF_PI, 0, 0], follow: 'body', skin: 'sheep_fur' }),
    new ModelPart('fleg0', [0, 16], [-2, 0, -2, 4, 6, 4], [-3, 12, 7], { inflate: 0.5, follow: 'leg0', skin: 'sheep_fur' }),
    new ModelPart('fleg1', [0, 16], [-2, 0, -2, 4, 6, 4], [3, 12, 7], { inflate: 0.5, follow: 'leg1', skin: 'sheep_fur', mirror: true }),
    new ModelPart('fleg2', [0, 16], [-2, 0, -2, 4, 6, 4], [-3, 12, -5], { inflate: 0.5, follow: 'leg2', skin: 'sheep_fur' }),
    new ModelPart('fleg3', [0, 16], [-2, 0, -2, 4, 6, 4], [3, 12, -5], { inflate: 0.5, follow: 'leg3', skin: 'sheep_fur', mirror: true }),
  ]
};
MODELS.chicken = {
  skin: 'chicken', parts: [
    new ModelPart('head', [0, 0], [-2, -6, -2, 4, 6, 3], [0, 15, -4]),
    new ModelPart('bill', [14, 0], [-2, -4, -4, 4, 2, 2], [0, 15, -4], { follow: 'head' }),
    new ModelPart('chin', [14, 4], [-1, -2, -3, 2, 2, 2], [0, 15, -4], { follow: 'head' }),
    new ModelPart('body', [0, 9], [-3, -4, -3, 6, 8, 6], [0, 16, 0], { rot: [HALF_PI, 0, 0] }),
    new ModelPart('rleg', [26, 0], [-1, 0, -3, 3, 5, 3], [-2, 19, 1]),
    new ModelPart('lleg', [26, 0], [-1, 0, -3, 3, 5, 3], [1, 19, 1]),
    new ModelPart('rwing', [24, 13], [0, 0, -3, 1, 4, 6], [-4, 13, 0]),
    new ModelPart('lwing', [24, 13], [-1, 0, -3, 1, 4, 6], [4, 13, 0]),
  ]
};
MODELS.spider = {
  skin: 'spider', eyes: 'spider_eyes', parts: (() => {
    const p = [
      new ModelPart('head', [32, 4], [-4, -4, -8, 8, 8, 8], [0, 15, -3]),
      new ModelPart('neck', [0, 0], [-3, -3, -3, 6, 6, 6], [0, 15, 0]),
      new ModelPart('body', [0, 12], [-5, -4, -6, 10, 8, 12], [0, 15, 9]),
    ];
    const pv = [[-4, 15, 2], [4, 15, 2], [-4, 15, 1], [4, 15, 1], [-4, 15, 0], [4, 15, 0], [-4, 15, -1], [4, 15, -1]];
    for (let i = 0; i < 8; i++) {
      const right = i % 2 === 0;
      p.push(new ModelPart('leg' + i, [18, 0], right ? [-15, -1, -1, 16, 2, 2] : [-1, -1, -1, 16, 2, 2], pv[i], { mirror: false }));
    }
    return p;
  })()
};

// ---------------------------------------------------------------- pose / animation (MC formulas)
function poseFor(kind, mob, partial, P) {
  // P: map name -> [rx,ry,rz,ox,oy,oz] in MC convention (angles), starting from base
  const A = mob.limbAmt, L = mob.limbPos, age = mob.age + partial;
  const hy = mob.headYawRel || 0, hp = mob.headPitchRel || 0;
  const S = (n, rx, ry, rz) => { P[n] = [rx, ry, rz, 0, 0, 0]; };
  if (kind === 'steve' || kind === 'zombie' || kind === 'skeleton') {
    S('head', hp, hy, 0); S('body', 0, 0, 0);
    S('rarm', Math.cos(L * 0.6662 + Math.PI) * 2 * A * 0.5, 0, 0); S('larm', Math.cos(L * 0.6662) * 2 * A * 0.5, 0, 0);
    S('rleg', Math.cos(L * 0.6662) * 1.4 * A, 0, 0); S('lleg', Math.cos(L * 0.6662 + Math.PI) * 1.4 * A, 0, 0);
    if (kind === 'zombie' || (kind === 'skeleton' && mob.aiming)) {
      const up = kind === 'zombie' ? -1.5 : -1.35;
      const sw = mob.swingProgress || 0, f = Math.sin(sw * Math.PI), f2 = Math.sin((1 - (1 - sw) * (1 - sw)) * Math.PI) * -(hp - 0.7) * 0.75;
      P.rarm[0] = up - f * 1.2 - f2 * 0.5 + (kind === 'zombie' ? hp * 0.3 : hp); P.larm[0] = up + (kind === 'zombie' ? 0 : -0.1) - f * 1.2 + (kind === 'zombie' ? hp * 0.3 : hp);
      P.rarm[1] = kind === 'zombie' ? 0 : -0.1 + hy; P.larm[1] = kind === 'zombie' ? 0 : 0.6 + hy;
      P.rarm[2] = Math.cos(age * 0.09) * 0.05 + 0.05; P.larm[2] = -Math.cos(age * 0.09) * 0.05 - 0.05;
    } else {
      P.rarm[2] = Math.cos(age * 0.09) * 0.05 + 0.05; P.larm[2] = -(Math.cos(age * 0.09) * 0.05 + 0.05);
      P.rarm[0] += Math.sin(age * 0.067) * 0.05; P.larm[0] -= Math.sin(age * 0.067) * 0.05;
    }
    // swing (punch)
    const sw = mob.swingProgress || 0;
    if (sw > 0 && kind !== 'zombie') {
      const by = Math.sin(Math.sqrt(sw) * Math.PI * 2) * 0.2;
      P.body[1] = by; P.rarm[1] += by; P.larm[1] += by; P.larm[0] += by;
      const f = 1 - sw, f4 = 1 - f * f * f * f, s2 = Math.sin(f4 * Math.PI), s3 = Math.sin(sw * Math.PI) * -(hp - 0.7) * 0.75;
      P.rarm[0] -= s2 * 1.2 + s3; P.rarm[1] += by * 2; P.rarm[2] += Math.sin(sw * Math.PI) * -0.4;
    }
    if (mob.sneaking) { P.body[0] = 0.5; P.rarm[0] += 0.4; P.larm[0] += 0.4; P.head[3] = 0; P.head[4] = 1; P.rleg[5] = 4; P.lleg[5] = 4; P.rleg[4] = -0.0; P.body[4] = 0; }
    for (const n of ['hat', 'jacket', 'rsleeve', 'lsleeve', 'rpants', 'lpants']) { const src = { hat: 'head', jacket: 'body', rsleeve: 'rarm', lsleeve: 'larm', rpants: 'rleg', lpants: 'lleg' }[n]; if (P[src]) P[n] = P[src].slice(); }
  } else if (kind === 'creeper') {
    S('head', hp, hy, 0); S('body', 0, 0, 0);
    S('leg0', Math.cos(L * 0.6662) * 1.4 * A, 0, 0); S('leg1', Math.cos(L * 0.6662 + Math.PI) * 1.4 * A, 0, 0);
    S('leg2', Math.cos(L * 0.6662 + Math.PI) * 1.4 * A, 0, 0); S('leg3', Math.cos(L * 0.6662) * 1.4 * A, 0, 0);
  } else if (kind === 'pig' || kind === 'cow' || kind === 'sheep') {
    S('head', hp, hy, 0);
    S('leg0', Math.cos(L * 0.6662) * 1.4 * A, 0, 0); S('leg1', Math.cos(L * 0.6662 + Math.PI) * 1.4 * A, 0, 0);
    S('leg2', Math.cos(L * 0.6662 + Math.PI) * 1.4 * A, 0, 0); S('leg3', Math.cos(L * 0.6662) * 1.4 * A, 0, 0);
    if (kind === 'sheep' && mob.eatTimer > 0) { const t = mob.eatTimer, k = t > 4 && t < 36 ? 1 : t <= 4 ? t / 4 : (40 - t) / 4; P.head[0] = 0.9 * k + Math.sin(age * 0.7) * 0.1 * (t > 4 && t < 36 ? 1 : 0); P.head[3] = 0; P.head[4] = k * 3; }
    P.snout = P.head; P.horn0 = P.head; P.horn1 = P.head; P.udder = null; P.fhead = P.head; P.fleg0 = P.leg0; P.fleg1 = P.leg1; P.fleg2 = P.leg2; P.fleg3 = P.leg3;
  } else if (kind === 'enderman') {
    S('head', hp, hy, 0); S('body', 0, 0, 0);
    const c4 = v => Math.max(-0.4, Math.min(0.4, v));
    S('rarm', c4(Math.cos(L * 0.6662 + Math.PI) * A), 0, 0); S('larm', c4(Math.cos(L * 0.6662) * A), 0, 0);
    S('rleg', c4(Math.cos(L * 0.6662) * 0.7 * A), 0, 0); S('lleg', c4(Math.cos(L * 0.6662 + Math.PI) * 0.7 * A), 0, 0);
    if (mob.screaming) { P.head[4] = -5; P.rarm[0] = -0.3; P.larm[0] = -0.3; }
  } else if (kind === 'wolf') {
    S('head', hp, hy, 0); P.ear1 = P.head; P.ear2 = P.head; P.snout = P.head;
    const tail = mob.tamed ? 0.55 - (20 - mob.hp) * 0.02 * Math.PI : Math.PI / 5;
    if (mob.sitting) {
      S('leg1', Math.PI * 1.5, 0, 0); P.leg1[4] = 6; P.leg1[5] = -5; S('leg2', Math.PI * 1.5, 0, 0); P.leg2[4] = 6; P.leg2[5] = -5;
      S('leg3', 5.811947, 0, 0); P.leg3[4] = 1; S('leg4', 5.811947, 0, 0); P.leg4[4] = 1;
      S('mane', Math.PI * 0.4 - HALF_PI, 0, 0); P.mane[4] = 2; S('body', Math.PI * 0.25 - HALF_PI, 0, 0); P.body[4] = 4; P.body[5] = -2;
      S('tail', tail, 0, 0); P.tail[4] = 9; P.tail[5] = -2;
    } else {
      S('leg1', Math.cos(L * 0.6662) * 1.4 * A, 0, 0); S('leg2', Math.cos(L * 0.6662 + Math.PI) * 1.4 * A, 0, 0);
      S('leg3', Math.cos(L * 0.6662 + Math.PI) * 1.4 * A, 0, 0); S('leg4', Math.cos(L * 0.6662) * 1.4 * A, 0, 0);
      S('tail', tail, Math.cos(L * 0.6662) * 1.4 * A, 0);
    }
    P.collar = P.mane;
  } else if (kind === 'squid') {
    const moving = mob.sqMove || 0;
    for (let j = 0; j < 8; j++) S('t' + j, 0.15 + Math.sin(age * 0.25 + j * 0.9) * (0.25 + moving * 0.6), 0, 0);
    S('body', 0, 0, 0);
  } else if (kind === 'bat') {
    const tilt = mob.batTilt || 0.785, th = Math.cos(age * 1.3) * Math.PI * 0.25, c = Math.cos(th), sn = Math.sin(th);
    S('head', hp - tilt, hy, 0); P.ear1 = P.head; P.ear2 = P.head; S('body', 0, 0, 0); P.fur = P.body;
    S('rwing', 0, th, 0); S('lwing', 0, -th, 0);
    // outer wings hang from the inner wing tips: rotation adds up, pivot orbits the shoulder
    P.rwing2 = [0, th * 1.5, 0, -12 * (c - 1) + 1.5 * sn, 0, 12 * sn + 1.5 * (c - 1)];
    P.lwing2 = [0, -th * 1.5, 0, 12 * (c - 1) - 1.5 * sn, 0, 12 * sn + 1.5 * (c - 1)];
  } else if (kind === 'chicken') {
    S('head', hp, hy, 0); P.bill = P.head; P.chin = P.head;
    S('rleg', Math.cos(L * 0.6662) * 1.4 * A, 0, 0); S('lleg', Math.cos(L * 0.6662 + Math.PI) * 1.4 * A, 0, 0);
    const flap = mob.onGround ? 0 : (Math.sin(age * 1.5) + 1) * 0.5 + 0.5;
    S('rwing', 0, 0, mob.onGround ? 0 : Math.abs(Math.sin(age * 1.2)) * 1.2 + 0.4); S('lwing', 0, 0, mob.onGround ? 0 : -(Math.abs(Math.sin(age * 1.2)) * 1.2 + 0.4));
  } else if (kind === 'spider') {
    S('head', hp, hy, 0);
    const a = Math.PI / 4, t = [[-a, a * 2], [a, -a * 2], [-a * 0.74, a], [a * 0.74, -a], [-a * 0.74, -a], [a * 0.74, a], [-a, -a * 2], [a, a * 2]];
    for (let i = 0; i < 8; i++) {
      let ry = t[i][1], rz = t[i][0];
      const ph = [0, Math.PI, Math.PI / 2, Math.PI * 1.5][i >> 1] ;
      const sgn = i % 2 === 0 ? 1 : -1;
      ry += -(Math.cos(L * 0.6662 * 2 + ph) * 0.4) * A * sgn;
      rz += Math.abs(Math.sin(L * 0.6662 + ph)) * 0.4 * A * sgn;
      S('leg' + i, 0, ry, rz);
    }
  }
}

// draw a model for an entity. ent has x,y,z,px..; opts: skinName override etc.
function drawModel(r, ent, model, partial, camx, camy, camz, opts) {
  opts = opts || {};
  if (model.draw) { model.draw(r, ent, partial, camx, camy, camz, opts); return; }   // hierarchical models of g_mobs2 / g_dragon
  const batch = r.bSkin;
  const x = ent.px + (ent.x - ent.px) * partial - camx, y = ent.py + (ent.y - ent.py) * partial - camy, z = ent.pz + (ent.z - ent.pz) * partial - camz;
  const yaw = lerpAngle(ent.pbodyYaw === undefined ? ent.yaw : ent.pbodyYaw, ent.bodyYaw === undefined ? ent.yaw : ent.bodyYaw, partial);
  const M = drawModel._M || (drawModel._M = m4()), Ry = drawModel._R || (drawModel._R = m4()), T = drawModel._T || (drawModel._T = m4());
  m4TranslateM(T, x, y, z); m4RotY(Ry, -yaw); m4Mul(M, T, Ry);
  if (ent.deathTime > 0 && !opts.noDeathRot) { const d = Math.min(1, Math.sqrt((ent.deathTime + partial - 1) / 20 * 1.6)); const Rz = drawModel._Z || (drawModel._Z = m4()); m4RotZ(Rz, d * HALF_PI); m4Mul(T, M, Rz); M.set(T); }
  const sc = opts.scale || 1; if (sc !== 1) { m4Mul(T, M, m4Scale(Ry, sc, sc, sc)); M.set(T); }
  if (model.yoff) { const Ty = drawModel._Ty || (drawModel._Ty = m4()); m4TranslateM(Ty, 0, model.yoff / 16, 0); m4Mul(T, M, Ty); M.set(T); }
  if (opts.sxyz) { m4Mul(T, M, m4Scale(Ry, opts.sxyz[0], opts.sxyz[1], opts.sxyz[2])); M.set(T); }
  if (opts.tilt) { const Tt = drawModel._Tt || (drawModel._Tt = m4()), Rt = drawModel._Rt || (drawModel._Rt = m4()); m4TranslateM(Tt, 0, 1.5, 0); m4Mul(T, M, Tt); m4RotX(Rt, -opts.tilt); m4Mul(M, T, Rt); m4TranslateM(Tt, 0, -1.5, 0); m4Mul(T, M, Tt); M.set(T); }
  const lt = ent.lightAt ? ent.lightAt() : [15, 0];
  let sky = lt[0] / 15, blk = lt[1] / 15;
  if (opts.fullbright) { sky = 1; blk = 1; }
  const flash = ent.hurtTime > 0 || ent.deathTime > 0;
  let cr = 1, cg = 1, cb = 1;
  if (flash) { cr = 1; cg = 0.45; cb = 0.45; }
  if (ent.whiteFlash) { cr = cg = cb = 2.2; }
  const P = {};
  poseFor(model.kind || opts.kind, ent, partial, P);
  const skinRect = r.skinRect[opts.skin || model.skin];
  for (const part of model.parts) {
    if (part.skin) continue;
    if (ent.hidden && ent.hidden[part.name]) continue;
    let pp = P[part.follow || part.name];
    if (part.name === 'udder' || part.name === 'body' && !pp) pp = null;
    const rx = (pp ? pp[0] : 0) + (pp ? 0 : part.rx0), ry = pp ? -pp[1] : part.ry0, rz = pp ? -pp[2] : part.rz0;
    // parts with a base rotation keep it unless animated
    const useBase = part.rx0 !== 0 || part.ry0 !== 0 || part.rz0 !== 0;
    let ax = rx, ay = ry, az = rz;
    if (useBase && (!pp || part.follow === 'body')) { ax = part.rx0; ay = part.ry0; az = part.rz0; }
    else if (useBase && pp) { ax = pp[0] + part.rx0; ay = -pp[1] + part.ry0; az = -pp[2] + part.rz0; }
    // offsets (MC y down => mine y up)
    const ox = pp ? pp[3] : 0, oy = pp ? -pp[4] : 0, oz = pp ? -pp[5] : 0;
    let s1 = 1;
    if (ent.isBaby && (part.name === 'head' || part.follow === 'head')) s1 = 1.75;
    emitPart(part.trans ? r.bSkinT : batch, part, ax, ay, az, ox, oy, oz, M, skinRect, cr, cg, cb, 1, sky, blk, s1, s1, s1);
  }
  // wolf collar (tame wolves): tinted overlay on the mane
  if (model.collar && ent.tamed) {
    const cr2 = r.skinRect[model.collar], cc = ent.collarColor || [0.72, 0.16, 0.14];
    for (const part of model.parts) {
      if (part.skin !== model.collar) continue;
      const pp = P.mane; const ax = (pp ? pp[0] : 0) + part.rx0;
      emitPart(batch, part, ax, pp ? -pp[1] : 0, pp ? -pp[2] : 0, pp ? pp[3] : 0, pp ? -pp[4] : 0, pp ? -pp[5] : 0, M, cr2, cc[0] * cr, cc[1] * cg, cc[2] * cb, 1, sky, blk);
    }
  }
  // sheep wool layer (tinted)
  if (model.fur && !ent.sheared) {
    const fr = r.skinRect[model.fur], col = ent.woolColor || [1, 1, 1];
    for (const part of model.parts) {
      if (!part.skin) continue;
      const pp = P[part.follow]; const useBase = part.rx0 !== 0;
      const ax = (pp ? pp[0] : 0) + (useBase ? part.rx0 : 0), ay = pp ? -pp[1] : 0, az = pp ? -pp[2] : 0;
      const sf = ent.isBaby && part.follow === 'head' ? 1.75 : 1;
      emitPart(batch, part, ax, ay, az, pp ? pp[3] : 0, pp ? -pp[4] : 0, pp ? -pp[5] : 0, M, fr, col[0] * cr, col[1] * cg, col[2] * cb, 1, sky, blk, sf, sf, sf);
    }
  }
  if (model.eyes) {
    const er = r.skinRect[model.eyes], part = model.parts[0], pp = P.head;
    emitPart(batch, part, pp[0], -pp[1], -pp[2], pp[3] || 0, -(pp[4] || 0), -(pp[5] || 0), M, er, 1, 1, 1, 1, 1, 1);
  }
}

// ---------------------------------------------------------------- mobs
const SHEEP_COLORS = [[1, 1, 1], [0.85, 0.5, 0.2], [0.7, 0.3, 0.85], [0.4, 0.6, 0.85], [0.9, 0.9, 0.2], [0.5, 0.8, 0.1], [0.95, 0.5, 0.65], [0.3, 0.3, 0.3], [0.6, 0.6, 0.6], [0.3, 0.5, 0.6], [0.5, 0.25, 0.7], [0.2, 0.3, 0.7], [0.4, 0.3, 0.2], [0.4, 0.5, 0.2], [0.6, 0.2, 0.2], [0.1, 0.1, 0.1]];
const SHEEP_WOOL_NAMES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const MOB_DEFS = {
  wolf: { w: 0.6, h: 0.85, hp: 8, speed: 0.194, model: 'wolf', wolf: true, snd: 'wolf', xp: [1, 3], dmg: 2, hurtSnd: 'mob.wolf.whine', deathSnd: 'mob.wolf.death' },
  squid: { w: 0.95, h: 0.95, hp: 10, speed: 0, model: 'squid', squid: true, snd: 'squid', xp: [1, 3], say: null, hurtSnd: 'mob.squid.hurt', deathSnd: 'mob.squid.hurt' },
  enderman: { w: 0.6, h: 2.9, hp: 40, speed: 0.194, model: 'enderman', hostile: true, neutral: true, snd: 'enderman', xp: [5, 5], dmg: 7, follow: 64, say: 'mob.enderman.idle', hurtSnd: 'mob.enderman.hit', deathSnd: 'mob.enderman.death' },
  slime: { w: 0.51, h: 0.51, hp: 1, speed: 0, model: 'slime', hostile: true, slime: true, snd: 'slime', xp: [1, 1], dmg: 2, follow: 16, say: null, hurtSnd: 'mob.slime.small', deathSnd: 'mob.slime.small' },
  bat: { w: 0.5, h: 0.9, hp: 6, speed: 0, model: 'bat', ambient: true, snd: 'bat', xp: [0, 0], say: 'mob.bat.idle', hurtSnd: null, deathSnd: null },
  pig: { w: 0.9, h: 0.9, hp: 10, speed: 0.13, model: 'pig', passive: true, snd: 'pig', xp: [1, 3], food: ['carrot', 'potato'], breed: ['carrot', 'potato'] },
  cow: { w: 0.9, h: 1.4, hp: 10, speed: 0.09, model: 'cow', passive: true, snd: 'cow', xp: [1, 3], breed: ['wheat'] },
  sheep: { w: 0.9, h: 1.3, hp: 8, speed: 0.115, model: 'sheep', passive: true, snd: 'sheep', xp: [1, 3], breed: ['wheat'] },
  chicken: { w: 0.4, h: 0.7, hp: 4, speed: 0.13, model: 'chicken', passive: true, snd: 'chicken', xp: [1, 3], breed: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds'] },
  zombie: { w: 0.6, h: 1.95, hp: 20, speed: 0.115, model: 'zombie', hostile: true, snd: 'zombie', xp: [5, 5], dmg: 3, burns: true, follow: 32 },
  skeleton: { w: 0.6, h: 1.99, hp: 20, speed: 0.135, model: 'skeleton', hostile: true, snd: 'skeleton', xp: [5, 5], burns: true, ranged: true, follow: 24 },
  creeper: { w: 0.6, h: 1.7, hp: 20, speed: 0.135, model: 'creeper', hostile: true, snd: 'creeper', xp: [5, 5], creeper: true, follow: 16 },
  spider: { w: 1.4, h: 0.9, hp: 16, speed: 0.195, model: 'spider', hostile: true, snd: 'spider', xp: [5, 5], dmg: 2, spider: true, follow: 16 },
};
// enderman (ModelEnderman): 30px legs and arms, head floats at y=-13, glowing eyes layer
MODELS.enderman = {
  skin: 'enderman', eyes: 'enderman_eyes', kind: 'enderman', parts: [
    new ModelPart('head', [0, 0], [-4, -8, -4, 8, 8, 8], [0, -13, 0]),
    new ModelPart('body', [32, 16], [-4, 0, -2, 8, 12, 4], [0, -14, 0]),
    new ModelPart('rarm', [56, 0], [-1, -2, -1, 2, 30, 2], [-3, -12, 0]),
    new ModelPart('larm', [56, 0], [-1, -2, -1, 2, 30, 2], [5, -12, 0], { mirror: true }),
    new ModelPart('rleg', [56, 0], [-1, 0, -1, 2, 30, 2], [-2, -5, 0]),
    new ModelPart('lleg', [56, 0], [-1, 0, -1, 2, 30, 2], [2, -5, 0], { mirror: true }),
  ]
};
// slime (ModelSlime): opaque core with eyes + mouth, translucent gel shell drawn afterwards
MODELS.slime = {
  skin: 'slime', kind: 'slime', parts: [
    new ModelPart('inner', [0, 16], [-3, 17, -3, 6, 6, 6], [0, 0, 0]),
    new ModelPart('reye', [32, 0], [-3.25, 18, -3.5, 2, 2, 2], [0, 0, 0]),
    new ModelPart('leye', [32, 4], [1.25, 18, -3.5, 2, 2, 2], [0, 0, 0]),
    new ModelPart('mouth', [32, 8], [0, 21, -3.5, 1, 1, 1], [0, 0, 0]),
    new ModelPart('outer', [0, 0], [-4, 16, -4, 8, 8, 8], [0, 0, 0], { trans: true }),
  ]
};
// bat (ModelBat, 64x64): flight pose = body tilted forward, wings flap about Y
MODELS.bat = {
  skin: 'bat', kind: 'bat', parts: [
    new ModelPart('head', [0, 0], [-3, -3, -3, 6, 6, 6], [0, 0, 0], { tw: 64, th: 64 }),
    new ModelPart('ear1', [24, 0], [-4, -6, -2, 3, 4, 1], [0, 0, 0], { follow: 'head', tw: 64, th: 64 }),
    new ModelPart('ear2', [24, 0], [1, -6, -2, 3, 4, 1], [0, 0, 0], { follow: 'head', mirror: true, tw: 64, th: 64 }),
    new ModelPart('body', [0, 16], [-3, 4, -3, 6, 12, 6], [0, 0, 0], { tw: 64, th: 64 }),
    new ModelPart('fur', [0, 34], [-5, 16, 0, 10, 6, 1], [0, 0, 0], { follow: 'body', tw: 64, th: 64 }),
    new ModelPart('rwing', [42, 0], [-12, 1, 1.5, 10, 16, 1], [0, 0, 0], { tw: 64, th: 64 }),
    new ModelPart('rwing2', [24, 16], [-8, 1, 0, 8, 12, 1], [-12, 1, 1.5], { tw: 64, th: 64 }),
    new ModelPart('lwing', [42, 0], [2, 1, 1.5, 10, 16, 1], [0, 0, 0], { mirror: true, tw: 64, th: 64 }),
    new ModelPart('lwing2', [24, 16], [0, 1, 0, 8, 12, 1], [12, 1, 1.5], { mirror: true, tw: 64, th: 64 }),
  ]
};
// wolf (ModelWolf, 64x32); x shifted by +1 so the model is centred; sitting pose handled in poseFor
MODELS.wolf = {
  skin: 'wolf', collar: 'wolf_collar', kind: 'wolf', parts: [
    new ModelPart('head', [0, 0], [-3, -3, -2, 6, 6, 4], [0, 13.5, -7]),
    new ModelPart('ear1', [16, 14], [-3, -5, 0, 2, 2, 1], [0, 13.5, -7], { follow: 'head' }),
    new ModelPart('ear2', [16, 14], [1, -5, 0, 2, 2, 1], [0, 13.5, -7], { follow: 'head', mirror: true }),
    new ModelPart('snout', [0, 10], [-1.5, 0, -5, 3, 3, 4], [0, 13.5, -7], { follow: 'head' }),
    new ModelPart('body', [18, 14], [-3, -2, -3, 6, 9, 6], [0, 14, 2], { rot: [HALF_PI, 0, 0] }),
    new ModelPart('mane', [21, 0], [-4, -3, -3, 8, 6, 7], [0, 14, -3], { rot: [HALF_PI, 0, 0] }),
    new ModelPart('leg1', [0, 18], [-1, 0, -1, 2, 8, 2], [-1.5, 16, 7]),
    new ModelPart('leg2', [0, 18], [-1, 0, -1, 2, 8, 2], [1.5, 16, 7], { mirror: true }),
    new ModelPart('leg3', [0, 18], [-1, 0, -1, 2, 8, 2], [-1.5, 16, -4]),
    new ModelPart('leg4', [0, 18], [-1, 0, -1, 2, 8, 2], [1.5, 16, -4], { mirror: true }),
    new ModelPart('tail', [9, 18], [-1, 0, -1, 2, 8, 2], [0, 12, 8]),
    new ModelPart('collar', [21, 0], [-4, -3, -3, 8, 6, 7], [0, 14, -3], { rot: [HALF_PI, 0, 0], inflate: 0.04, follow: 'mane', skin: 'wolf_collar', tw: 64, th: 32 }),
  ]
};
// squid (ModelSquid, 64x32): mantle + 8 tentacles ring; model is lowered so its centre matches the hit box centre
MODELS.squid = {
  skin: 'squid', kind: 'squid', yoff: -8.4, parts: (() => {
    const p = [new ModelPart('body', [0, 0], [-6, -8, -6, 12, 16, 12], [0, 8, 0])];
    for (let j = 0; j < 8; j++) { const a = j * Math.PI * 2 / 8; p.push(new ModelPart('t' + j, [48, 0], [-1, 0, -1, 2, 18, 2], [Math.cos(a) * 5, 15, Math.sin(a) * 5], { rot: [0, -(j * Math.PI * -2 / 8 + Math.PI / 2), 0] })); }
    return p;
  })()
};
MODELS.pig.kind = 'pig'; MODELS.cow.kind = 'cow'; MODELS.sheep.kind = 'sheep'; MODELS.chicken.kind = 'chicken'; MODELS.zombie.kind = 'zombie'; MODELS.skeleton.kind = 'skeleton'; MODELS.creeper.kind = 'creeper'; MODELS.spider.kind = 'spider'; MODELS.steve.kind = 'steve';

class Mob extends Entity {
  constructor(game, x, y, z, type) {
    const d = MOB_DEFS[type];
    super(game, x, y, z, d.w, d.h);
    this.type = type; this.def = d; this.hp = d.hp; this.maxHp = d.hp; this.eyeH = d.h * 0.85;
    this.bodyYaw = this.pbodyYaw = this.yaw = Math.random() * TAU;
    this.headYawRel = 0; this.headPitchRel = 0; this.limbPos = 0; this.limbAmt = 0; this.plimbAmt = 0;
    this.hurtTime = 0; this.invuln = 0; this.deathTime = 0; this.target = null;
    this.wanderT = 40 + (Math.random() * 60 | 0); this.wdx = 0; this.wdz = 0; this.moving = false; this.panic = 0;
    this.attackT = 0; this.swingProgress = 0; this.swingT = 0; this.sayT = 40 + (Math.random() * 200 | 0);
    this.phase = (Math.random() * 8) | 0; this.persist = false; this.despawnT = 0; this.jumpCd = 0; this.aiming = false;
    if (type === 'sheep') { const r = Math.random(); this.woolColor = SHEEP_COLORS[r < 0.8 ? 0 : r < 0.85 ? 15 : r < 0.9 ? 7 : r < 0.95 ? 8 : r < 0.998 ? 12 : 6]; this.woolIdx = SHEEP_COLORS.indexOf(this.woolColor); this.sheared = false; this.eatTimer = 0; }
    this.fuse = -1; this.swell = 0; this.pswell = 0; this.shootT = 40 + (Math.random() * 40 | 0);
    this.fireTicks = 0; this.isBaby = false; this.love = 0; this.bredCd = 0; this.growT = 0; this.breedT = 0;
    this.knock = 0;
    if (type === 'slime') { this.setSize(1 << ((Math.random() * 3) | 0)); this.hopT = 20; this.squish = this.psquish = this.squishAmt = 0; this.wasGround = false; }
    if (type === 'enderman') { this.screaming = false; this.aggroT = 0; }
    if (type === 'wolf') { this.tamed = false; this.sitting = false; this.owner = null; this.angryT = 0; this.collarColor = [0.72, 0.16, 0.14]; }
    if (type === 'squid') { this.sqDir = [0, 0, 0]; this.sqT = 0; this.sqMove = 0; this.sqSpeed = 0; }
    if (type === 'bat') { this.tgtPt = null; this.batTilt = 0.785; this.vy = 0; }
  }
  setSize(n) { this.size = n; this.w = this.h = 0.51 * n; this.hp = this.maxHp = n * n; this.eyeH = this.h * 0.5; }
  renderOpts(partial) {
    if (this.type === 'slime') {
      const sq = this.psquish + (this.squish - this.psquish) * partial, f = this.size, f1 = sq / (f * 0.5 + 1), f2 = 1 / (f1 + 1);
      return { sxyz: [f2 * f, f / f2, f2 * f], noDeathRot: true };
    }
    if (this.type === 'bat') return { scale: 0.35, tilt: this.batTilt };
    if (this.type === 'squid') return { tilt: Math.max(-0.7, Math.min(0.7, -this.vy * 6)) };
    return this.isBaby ? { scale: 0.5 } : {};
  }
  // ---- enderman: neutral until stared at, then a fast teleporting melee brute
  playerStaring(p) {
    const vx = this.x - p.x, vy = this.y + 2.55 - (p.y + p.eyeH), vz = this.z - p.z, len = Math.hypot(vx, vy, vz) || 1;
    const dir = [0, 0, 0]; lookDir(p.yaw, p.pitch, dir);
    return (dir[0] * vx + dir[1] * vy + dir[2] * vz) / len > 1 - 0.025 / len && this.canSee(p);
  }
  teleportTo(x, y, z) {
    const g = this.game;
    g.sound('mob.enderman.teleport', this.x, this.y, this.z, 1, 1);
    for (let i = 0; i < 24; i++) g.particles.sprite('flame', this.x, this.y + 1.4, this.z, 1, { size: 0.09, up: 0, vel: 0.35, life: 16, shrink: true, spread: 0.7, spreadY: 2.4, r: 0.75, g: 0.25, b: 1 });
    this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0; this.fallDist = 0;
    for (let i = 0; i < 24; i++) g.particles.sprite('flame', x, y + 1.4, z, 1, { size: 0.09, up: 0, vel: 0.35, life: 16, shrink: true, spread: 0.7, spreadY: 2.4, r: 0.75, g: 0.25, b: 1 });
    g.sound('mob.enderman.teleport', x, y, z, 1, 1);
  }
  teleportRandom() {
    const w = this.world;
    for (let i = 0; i < 24; i++) {
      const nx = Math.floor(this.x + (Math.random() - 0.5) * 64), nz = Math.floor(this.z + (Math.random() - 0.5) * 64); if (!w.isLoaded(nx, nz)) continue;
      const y0 = Math.floor(this.y) + 8;
      for (let y = y0; y > y0 - 20 && y > 1; y--) {
        if (T_SOLID[w.getBlock(nx, y - 1, nz)] && !T_FLUID[w.getBlock(nx, y - 1, nz)] && w.getBlock(nx, y, nz) === 0 && w.getBlock(nx, y + 1, nz) === 0 && w.getBlock(nx, y + 2, nz) === 0) { this.teleportTo(nx + 0.5, y, nz + 0.5); return true; }
      }
    }
    return false;
  }
  endermanAI(dp2) {
    const g = this.game, p = g.player, w = this.world;
    if (this.inWater || w.rainingAt(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z))) { if (this.age % 10 === 0) this.hurt(1, null, 'drown'); if (Math.random() < 0.04) this.teleportRandom(); }
    if (!this.target && !p.dead && p.gameMode === 0 && dp2 < 64 * 64 && this.age % 4 === 0 && this.playerStaring(p)) { this.target = p; this.screaming = true; this.aggroT = 0; g.sound('mob.enderman.scream', this.x, this.y + 2, this.z, 1, 1); }
    if (this.target && (this.target.dead || (this.target === p && p.gameMode === 1) || dp2 > 70 * 70)) { this.target = null; this.screaming = false; }
    const t = this.target;
    if (!t) { this.wander(); if (Math.random() < 1 / 600) this.teleportRandom(); this.screaming = false; return; }
    this.aggroT++;
    const dx = t.x - this.x, dz = t.z - this.z, dist = Math.hypot(dx, dz), dy = t.y - this.y;
    this.wdx = dx / (dist || 1); this.wdz = dz / (dist || 1);
    if (dist > 18 && Math.random() < 0.02) { const a = Math.random() * TAU; const ux = Math.floor(t.x + Math.cos(a) * 4), uz = Math.floor(t.z + Math.sin(a) * 4); let y = Math.floor(t.y) + 3; while (y > 1 && !T_SOLID[w.getBlock(ux, y - 1, uz)]) y--; if (w.getBlock(ux, y, uz) === 0) this.teleportTo(ux + 0.5, y, uz + 0.5); return; }
    this.moving = dist > 1.2;
    if (this.attackT > 0) this.attackT--;
    if (dist < 1.7 && Math.abs(dy) < 2.6 && this.attackT <= 0) {
      this.attackT = 20; this.swingT = 6;
      const dmg = this.def.dmg * (g.difficulty === 1 ? 0.6 : g.difficulty === 3 ? 1.4 : 1);
      if (t.hurt) t.hurt(Math.round(dmg), this, 'mob', [dx, dz]);
    }
  }
  // ---- slime: hops, splits when killed
  slimeAI(dp2) {
    const g = this.game, p = g.player;
    this.moving = false;
    this.target = (!p.dead && p.gameMode === 0 && dp2 < 16 * 16) ? p : null;
    if (this.onGround && !this.inWater) {
      if (--this.hopT <= 0) {
        this.hopT = ((Math.random() * 20) | 0) + 10; if (this.target) this.hopT = Math.max(3, Math.floor(this.hopT / 3));
        let ang = Math.random() * TAU;
        if (this.target) ang = Math.atan2(-(this.target.x - this.x), this.target.z - this.z);
        const sp = 0.13 + this.size * 0.018;
        this.vx = -Math.sin(ang) * sp; this.vz = Math.cos(ang) * sp; this.vy = 0.42; this.bodyYaw = ang;
        g.sound(this.size > 1 ? 'mob.slime.big' : 'mob.slime.small', this.x, this.y, this.z, 0.6 * Math.min(2, this.size), ((Math.random() - Math.random()) * 0.2 + 1) / (this.size > 2 ? 1.4 : 1));
      }
    } else if (this.inWater) { this.vy = Math.max(this.vy, 0.1); }
    const t = this.target;
    if (t && this.attackT-- <= 0) {
      const dx = t.x - this.x, dz = t.z - this.z, r = this.w / 2 + 0.3;
      if (Math.abs(dx) < r + 0.3 && Math.abs(dz) < r + 0.3 && t.y < this.y + this.h && t.y + 1.7 > this.y && this.size > 1) {
        this.attackT = 20; const dmg = this.size * (g.difficulty === 1 ? 0.5 : g.difficulty === 3 ? 1.5 : 1); if (t.hurt) t.hurt(Math.max(1, Math.round(dmg)), this, 'mob', [dx, dz]);
      } else this.attackT = 0;
    }
  }
  slimeSquish() {
    this.psquish = this.squish;
    this.squish += (this.squishAmt - this.squish) * 0.5;
    if (this.onGround && !this.wasGround) { this.squishAmt = -0.5; for (let i = 0; i < this.size * 4; i++) { const a = Math.random() * TAU; this.game.particles.sprite('splash', this.x + Math.cos(a) * this.w * 0.5, this.y + 0.05, this.z + Math.sin(a) * this.w * 0.5, 1, { size: 0.08, up: 0.12, vel: 0.1, life: 12, grav: 0.05, spread: 0, spreadY: 0, r: 0.45, g: 0.85, b: 0.35 }); } }
    else if (!this.onGround && this.wasGround) this.squishAmt = 1;
    this.wasGround = this.onGround; this.squishAmt *= 0.6;
  }
  // ---- wolf: neutral, tameable with bones, follows and defends its owner
  wolfSound() {
    if (this.angryT > 0 && this.target) return 'mob.wolf.growl';
    if (Math.random() < 1 / 3) return this.tamed && this.hp < 10 ? 'mob.wolf.whine' : 'mob.wolf.pant';
    return 'mob.wolf.bark';
  }
  wolfAI(dp2) {
    const g = this.game, p = g.player, w = this.world;
    if (this.angryT > 0) this.angryT--;
    if (this.tamed && !this.owner) this.owner = p;
    const bite = (t) => {
      const dx = t.x - this.x, dz = t.z - this.z, dist = Math.hypot(dx, dz);
      this.wdx = dx / (dist || 1); this.wdz = dz / (dist || 1); this.moving = dist > 1.0;
      if (this.attackT > 0) this.attackT--;
      if (dist < 1.6 && Math.abs(t.y - this.y) < 1.6 && this.attackT <= 0) { this.attackT = 20; this.swingT = 6; if (t.hurt) t.hurt(this.tamed ? 4 : 2, this, 'mob', [dx, dz]); }
      return dist;
    };
    if (this.tamed) {
      if (this.sitting) { this.moving = false; this.target = null; return; }
      if (!this.target || this.target.dead) {
        this.target = null;
        const la = p.lastAttacked, lh = p.lastHurtBy;
        if (la && !la.dead && la.isMob && la !== this && la.type !== 'wolf' && g.tick - p.lastAttackT < 120) this.target = la;
        else if (lh && !lh.dead && lh.isMob && lh !== this && lh.type !== 'wolf' && g.tick - p.lastHurtT < 120) this.target = lh;
      }
      if (this.target) { const d = bite(this.target); if (d > 24) this.target = null; return; }
      const dx = p.x - this.x, dz = p.z - this.z, dist = Math.hypot(dx, dz);
      if (dist > 12 && !p.dead) {   // teleport next to the owner
        for (let i = 0; i < 10; i++) { const nx = Math.floor(p.x + (Math.random() - 0.5) * 6), nz = Math.floor(p.z + (Math.random() - 0.5) * 6); let ny = Math.floor(p.y) + 1; while (ny > 1 && !T_SOLID[w.getBlock(nx, ny - 1, nz)]) ny--; if (w.getBlock(nx, ny, nz) === 0 && w.getBlock(nx, ny + 1, nz) === 0 && (nx + 0.5 - p.x) ** 2 + (nz + 0.5 - p.z) ** 2 > 4) { this.x = this.px = nx + 0.5; this.y = this.py = ny; this.z = this.pz = nz + 0.5; this.vx = this.vy = this.vz = 0; break; } }
      } else if (dist > 3.5) { this.wdx = dx / dist; this.wdz = dz / dist; this.moving = this.safeAhead(this.wdx, this.wdz); }
      else this.wander();
      return;
    }
    if (this.angryT > 0 && this.target && !this.target.dead) { const d = bite(this.target); if (d > 30) { this.target = null; this.angryT = 0; } return; }
    this.target = null; this.wander();
  }
  // ---- squid: pulsing swim in water
  squidAI() {
    const w = this.world;
    if (!this.inWater) { this.vy -= 0.08; this.sqMove = 0; this.moving = false; return; }
    if (--this.sqT <= 0) {
      this.sqT = 50 + ((Math.random() * 80) | 0); const a = Math.random() * TAU, up = (Math.random() - 0.5) * 0.9;
      this.sqDir = [-Math.sin(a), up, Math.cos(a)]; this.sqSpeed = 0.06 + Math.random() * 0.08;
      if (this.hurtTime > 0) this.sqSpeed *= 2.5;
    }
    const nx = Math.floor(this.x + this.sqDir[0] * 1.2), ny = Math.floor(this.y + 0.5 + this.sqDir[1] * 1.2), nz = Math.floor(this.z + this.sqDir[2] * 1.2);
    if (T_FLUID[w.getBlock(nx, ny, nz)] !== 1 || T_FLUID[w.getBlock(nx, ny + 1, nz)] !== 1) { this.sqDir = [-this.sqDir[0], -this.sqDir[1] * 0.5, -this.sqDir[2]]; this.sqT = Math.min(this.sqT, 20); }
    const pulse = Math.max(0, Math.sin(this.age * 0.12)) * this.sqSpeed;
    this.sqMove += (Math.min(1, pulse * 8) - this.sqMove) * 0.2;
    this.vx = this.sqDir[0] * pulse; this.vy = this.sqDir[1] * pulse - 0.002; this.vz = this.sqDir[2] * pulse;
    if (Math.abs(this.sqDir[0]) + Math.abs(this.sqDir[2]) > 0.05) this.bodyYaw = lerpAngle(this.bodyYaw, Math.atan2(-this.sqDir[0], this.sqDir[2]), 0.1);
  }
  // ---- bat: erratic flight
  batAI(dp2) {
    const g = this.game, w = this.world;
    if (!this.tgtPt || this.hcol || this.age % 60 === 0 || Math.hypot(this.tgtPt[0] - this.x, this.tgtPt[2] - this.z) < 1.2 && Math.abs(this.tgtPt[1] - this.y) < 1) {
      if (this.homeY === undefined) this.homeY = this.y;
      let ty = this.y + (Math.random() - 0.5) * 4 - (this.y - this.homeY) * 0.15;
      this.tgtPt = [this.x + (Math.random() - 0.5) * 12, ty, this.z + (Math.random() - 0.5) * 12];
    }
    const t = this.tgtPt, d0 = t[0] - this.x, d1 = t[1] - this.y, d2 = t[2] - this.z;
    this.vx += (Math.sign(d0) * 0.5 - this.vx) * 0.1; this.vy += (Math.sign(d1) * 0.7 - this.vy) * 0.1; this.vz += (Math.sign(d2) * 0.5 - this.vz) * 0.1;
    this.batTilt = 0.785 + Math.cos((this.age) * 0.1) * 0.15;
    if (this.inWater) this.vy = 0.1;
  }
  flightPhysics() {
    const s = 0.5;
    this.move(this.vx * 0.5, this.vy * 0.5, this.vz * 0.5);
    this.vx *= 0.91; this.vy *= 0.91; this.vz *= 0.91;
    if (this.y < 2) this.dead = true;
  }
  get isMob() { return true; }
  setBaby() { this.isBaby = true; this.growT = 0; this.w = this.def.w * 0.5; this.h = this.def.h * 0.5; this.eyeH = this.h * 0.85; }
  grow() { this.isBaby = false; this.w = this.def.w; this.h = this.def.h; this.eyeH = this.h * 0.85; }
  // breeding: animals in love walk to each other; after a moment a baby appears
  breedAI() {
    const g = this.game;
    if (this.isBaby) { if (++this.growT >= 24000) this.grow(); }
    if (this.bredCd > 0) this.bredCd--;
    if (this.love <= 0) return false;
    this.love--;
    if (this.age % 10 === 0) g.addParticles('heart', this.x, this.y + this.h + 0.3, this.z, 1);
    let mate = null, best = 256;
    for (const o of g.entities) { if (o === this || !o.isMob || o.type !== this.type || o.dead || o.isBaby || o.love <= 0) continue; const d = (o.x - this.x) ** 2 + (o.z - this.z) ** 2; if (d < best) { best = d; mate = o; } }
    if (!mate) return false;
    const dx = mate.x - this.x, dz = mate.z - this.z, dist = Math.hypot(dx, dz);
    if (dist > 1.4) { this.wdx = dx / dist; this.wdz = dz / dist; this.moving = true; this.breedT = 0; return true; }
    this.moving = false;
    if (++this.breedT >= 60 && this.age < mate.age + 1e9) {
      this.breedT = 0; this.love = 0; mate.love = 0; this.bredCd = mate.bredCd = 6000;
      const b = makeMob(g, this.type, (this.x + mate.x) / 2, this.y, (this.z + mate.z) / 2); b.setBaby(); g.entities.push(b); g.stat('bred');
      g.addParticles('heart', b.x, b.y + 0.6, b.z, 7);
      g.entities.push(new XPOrb(g, this.x, this.y + 0.4, this.z, 1 + ((Math.random() * 7) | 0)));
    }
    return true;
  }
  // EntityAITempt: follow a player who holds the species' favourite food
  temptAI() {
    const g = this.game, p = g.player, s = p.held(), b = this.def.breed;
    if (!b || !s || p.dead) return false;
    const it = ITEMS[s.id]; if (!it || b.indexOf(it.name) < 0) return false;
    const dx = p.x - this.x, dz = p.z - this.z, dist = Math.hypot(dx, dz);
    if (dist > 10 || dist < 2.2) { if (dist < 2.2) this.moving = false; return dist < 10; }
    this.wdx = dx / dist; this.wdz = dz / dist; this.moving = this.safeAhead(this.wdx, this.wdz); return true;
  }
  hurt(amount, src, kind, kb) {
    if (this.dead || this.deathTime > 0) return false;
    if (this.def.fireImmune && (kind === 'fire' || kind === 'lava')) return false;
    if (this.type === 'enderman' && kind === 'projectile') { this.teleportRandom(); return false; }
    if (this.invuln > 10) { if (amount <= (this.lastDmg || 0)) return false; const full = amount; amount -= this.lastDmg || 0; this.lastDmg = full; }
    else { this.invuln = 20; this.lastDmg = amount; }
    this.hp -= amount; this.hurtTime = 10;
    if (this.def.hurtSnd !== null) this.game.sound(this.def.hurtSnd || ('mob.' + this.def.snd + '.hurt'), this.x, this.y, this.z, 1, 1 + (Math.random() - 0.5) * 0.2, 'mob.generic.hurt');
    if (kb) { const d = Math.hypot(kb[0], kb[1]) || 1; this.vx = this.vx / 2 + kb[0] / d * 0.4; this.vz = this.vz / 2 + kb[1] / d * 0.4; this.vy = Math.min(0.4, this.vy / 2 + 0.4); }
    if (this.def.passive) { this.panic = 100; if (src && src.x !== undefined) { this.wdx = this.x - src.x; this.wdz = this.z - src.z; const l = Math.hypot(this.wdx, this.wdz) || 1; this.wdx /= l; this.wdz /= l; } }
    else if (this.type === 'wolf') { if (src && src.isMob && src !== this) { this.target = src; if (!this.tamed) this.angryT = 600; } else if (src === this.game.player && !this.tamed) { this.target = src; this.angryT = 600; } }
    else if (src && src === this.game.player) this.target = src;
    else if (src && src.isMob && src !== this && this.def.hostile && !src.def.hostile) this.target = src;   // fight back against golems and wolves
    if (this.hp <= 0) this.die(src, kind);
    return true;
  }
  die(src, kind) {
    if (this.deathTime > 0) return;
    this.deathTime = 1; if (this.def.deathSnd !== null) this.game.sound(this.def.deathSnd || ('mob.' + this.def.snd + '.death'), this.x, this.y, this.z, 1, 1, 'mob.generic.death');
    if (this.type === 'slime' && this.size > 1) {
      const n = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) { const a = (i / n + Math.random() * 0.3) * TAU, c = makeMob(this.game, 'slime', this.x + Math.cos(a) * this.size / 4, this.y + 0.5, this.z + Math.sin(a) * this.size / 4); c.setSize(this.size >> 1); c.vx = Math.cos(a) * 0.15; c.vz = Math.sin(a) * 0.15; c.vy = 0.3; this.game.entities.push(c); }
    }
    if (src === this.game.player || (src && src.owner === this.game.player) || kind === 'player') {
      this.game.stat('kills'); this.game.stat('killed', this.type);
      this.game.dropMobLoot(this);
      const xp = this.type === 'slime' ? [this.size, this.size] : this.def.xp; const n = xp[0] + ((Math.random() * (xp[1] - xp[0] + 1)) | 0);
      if (n > 0) for (let i = 0; i < Math.min(n, 5); i++) this.game.entities.push(new XPOrb(this.game, this.x, this.y + 0.5, this.z, Math.ceil(n / Math.min(n, 5))));
    }
  }
  setTarget(e) { this.target = e; }
  canSeeSky() { return this.world.getSky(Math.floor(this.x), Math.floor(this.y + this.h), Math.floor(this.z)) >= 15; }
  // EntitySenses.canSee: no solid block between the eyes
  canSee(t) {
    const w = this.world, ex = this.x, ey = this.y + this.eyeH, ez = this.z;
    const tx = t.x - ex, ty = t.y + 1.5 - ey, tz = t.z - ez, d = Math.hypot(tx, ty, tz), n = Math.ceil(d / 0.4);
    for (let i = 1; i < n; i++) {
      const f = i / n, b = w.getBlock(Math.floor(ex + tx * f), Math.floor(ey + ty * f), Math.floor(ez + tz * f));
      if (b !== 0 && T_SOLID[b]) return false;
    }
    return true;
  }
  // Entity.applyEntityCollision: overlapping living entities shove each other apart
  pushAway(o) {
    if (Math.abs(o.y - this.y) > 1.9 || o.y + o.h < this.y) return;
    let d0 = o.x - this.x, d1 = o.z - this.z;
    const rr = (this.w + o.w) / 2 + 0.2;
    if (Math.abs(d0) >= rr || Math.abs(d1) >= rr) return;
    let d2 = Math.max(Math.abs(d0), Math.abs(d1)); if (d2 < 0.01) { d0 = (Math.random() - 0.5) * 0.02; d1 = (Math.random() - 0.5) * 0.02; d2 = 0.01; }
    d2 = Math.sqrt(d2); d0 /= d2; d1 /= d2;
    const d3 = Math.min(1, 1 / d2) * 0.05; d0 *= d3; d1 *= d3;
    this.vx -= d0; this.vz -= d1;
    if (o.vx !== undefined && !o.flying) { o.vx += d0; o.vz += d1; }
  }
  tick() {
    this.savePrev(); this.pbodyYaw = this.bodyYaw; this.plimbAmt = this.limbAmt; this.pswell = this.swell;
    this.age++;
    const g = this.game, w = this.world;
    if (this.deathTime > 0) {
      this.deathTime++; this.vy -= 0.08; this.vx *= 0.9; this.vz *= 0.9; this.move(this.vx, this.vy, this.vz);
      this.vy *= 0.98; if (this.deathTime >= 20) this.dead = true; return;
    }
    if (this.invuln > 0) this.invuln--;
    if (this.hurtTime > 0) this.hurtTime--;
    this.updateFluids();
    // despawn (also for mobs stranded in unloaded chunks, which would otherwise count against the spawn caps forever)
    const p = g.player, dp2 = (p.x - this.x) ** 2 + (p.z - this.z) ** 2;
    if (!this.persist) {
      if (dp2 > 128 * 128 && !this.def.passive) this.dead = true;
      else if (dp2 > 64 * 64 && this.def.hostile && Math.random() < 0.02) this.dead = true;
      else if (this.def.passive && dp2 > 128 * 128) this.dead = true;
    }
    if (this.dead || !w.isLoaded(Math.floor(this.x), Math.floor(this.z))) return;
    if (this.def.hostile && this.def.burns && g.isDay && g.dim === 'overworld' && this.canSeeSky() && !this.inWater && this.fireTicks <= 0 && g.difficulty > 0) this.fireTicks = 160;
    if (!this.def.fireImmune) {
      if (this.touching('fire')) { this.fireTicks = Math.max(this.fireTicks, 160); if (this.age % 10 === 0) this.hurt(1, null, 'fire'); }
      if (this.fireTicks > 0) { this.fireTicks--; if (this.inWater) this.fireTicks = 0; if (this.fireTicks % 20 === 0) this.hurt(1, null, 'fire'); if (Math.random() < 0.3) g.addParticles('flame', this.x, this.y + this.h * 0.6, this.z, 1); }
      if (this.inLava) { this.fireTicks = 300; if (this.age % 10 === 0) this.hurt(4, null, 'lava'); }
    } else this.fireTicks = 0;
    if (this.witherT > 0) { this.witherT--; if (this.witherT % 40 === 0 && this.type !== 'wither_skeleton') this.hurt(1, null, 'magic'); }
    if (this.def.hostile && g.difficulty === 0) { this.dead = true; return; }
    this.ai(dp2);
    if (this.type === 'bat') this.flightPhysics();
    else if (this.type === 'squid' && this.inWater) { this.move(this.vx, this.vy, this.vz); this.fallDist = 0; }
    else this.physics();
    if (this.type === 'slime') this.slimeSquish();
    for (const o of g.entities) if (o !== this && o.isMob && !o.dead && !(o.deathTime > 0)) this.pushAway(o);
    if (!p.dead && !p.flying) this.pushAway(p);
    // ambient sounds
    if (--this.sayT <= 0) { this.sayT = 80 + (Math.random() * 160 | 0); if (this.def.say !== null && (!this.def.hostile || this.target || Math.random() < 0.5)) g.sound(this.type === 'wolf' ? this.wolfSound() : this.def.say || ('mob.' + this.def.snd + '.say'), this.x, this.y, this.z, 0.8, 1 + (Math.random() - 0.5) * 0.3, 'mob.generic.hurt'); }
    // body yaw follows movement
    const dx = this.x - this.px, dz = this.z - this.pz, sp = Math.hypot(dx, dz);
    if (sp > 0.004) { const want = Math.atan2(-dx, dz); this.bodyYaw = lerpAngle(this.bodyYaw, want, 0.35); }
    if (this.swingT > 0) { this.swingT--; this.swingProgress = 1 - this.swingT / 6; } else this.swingProgress = 0;
    this.limbAmt += (Math.min(1, sp * 4) - this.limbAmt) * 0.4; this.limbPos += sp * 3.0;
    // head look
    let ty = 0, tp = 0;
    const tgt = this.target || (dp2 < 36 ? p : null);
    if (tgt && !tgt.dead) { const ex = tgt.x - this.x, ez = tgt.z - this.z, ey = (tgt.y + 1.4) - (this.y + this.eyeH); ty = wrapAngle(Math.atan2(-ex, ez) - this.bodyYaw); tp = -Math.atan2(ey, Math.hypot(ex, ez)); ty = clamp(ty, -1, 1); tp = clamp(tp, -0.7, 0.7); }
    this.headYawRel += (ty - this.headYawRel) * 0.3; this.headPitchRel += (tp - this.headPitchRel) * 0.3;
    this.yaw = this.bodyYaw;
  }
  // basic steering: desired direction (wdx,wdz) unit vector, this.moving
  physics() {
    const w = this.world;
    let ax = 0, az = 0;
    if (this.moving) {
      const sp = this.def.speed * (this.panic > 0 ? 1.5 : 1) * (this.inWater ? 0.6 : 1) * (this.type === 'enderman' && this.target ? 2.2 : 1);
      const a = sp * 0.454;
      if (this.onGround || this.inWater) { ax = this.wdx * a; az = this.wdz * a; }
      else { ax = this.wdx * 0.02; az = this.wdz * 0.02; }
    }
    this.vx += ax; this.vz += az;
    if (this.inWater) {
      if (this.moving || Math.random() < 0.8) this.vy += 0.04;
      this.move(this.vx, this.vy, this.vz); this.vx *= 0.8; this.vz *= 0.8; this.vy *= 0.8; this.vy -= 0.02;
    } else if (this.inLava) {
      this.vy += 0.04; this.move(this.vx, this.vy, this.vz); this.vx *= 0.5; this.vy *= 0.5; this.vz *= 0.5; this.vy -= 0.02;
    } else {
      if (this.jumpCd > 0) this.jumpCd--;
      if (this.moving && this.hcol && this.onGround && this.jumpCd === 0) { this.vy = 0.42; this.jumpCd = 10; }
      if (this.def.spider && this.moving && this.hcol) this.vy = 0.2;
      const sx = this.vx, sz = this.vz;
      this.move(this.vx, this.vy, this.vz);
      let fr = 0.91; if (this.onGround) { const b = w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z)); fr = (BLOCKS[b] && BLOCKS[b].slip ? 0.98 : 0.6) * 0.91; }
      this.vy -= 0.08; this.vy *= 0.98; this.vx *= fr; this.vz *= fr;
    }
    // fall damage
    if (this.py > this.y && !this.onGround) this.fallDist += this.py - this.y;
    if (this.onGround) { if (this.fallDist > 3 && !this.inWater) this.hurt(Math.ceil(this.fallDist - 3), null, 'fall'); this.fallDist = 0; }
    if (this.inWater) this.fallDist = 0;
    if (this.y < -20) this.dead = true;
  }
  safeAhead(dx, dz) {
    const w = this.world, nx = Math.floor(this.x + dx * 0.9), nz = Math.floor(this.z + dz * 0.9), by = Math.floor(this.y);
    for (let d = 0; d <= 3; d++) {
      const b = w.getBlock(nx, by - d, nz);
      if (T_FLUID[b] === 2) return false;
      if (T_FLUID[b] === 1) return d === 0 ? true : false;
      if (b !== 0 && T_SOLID[b]) return true;
    }
    return false;
  }
  wander() {
    if (--this.wanderT <= 0) {
      if (Math.random() < 0.45 || this.moving) { this.moving = false; this.wanderT = 30 + (Math.random() * 80 | 0); }
      else { const a = Math.random() * TAU; this.wdx = -Math.sin(a); this.wdz = Math.cos(a); this.moving = true; this.wanderT = 30 + (Math.random() * 70 | 0); }
    }
    if (this.moving && !this.safeAhead(this.wdx, this.wdz)) { this.moving = false; this.wanderT = 10; }
  }
  ai(dp2) {
    if (this.type === 'enderman') { this.endermanAI(dp2); return; }
    if (this.type === 'slime') { this.slimeAI(dp2); return; }
    if (this.type === 'bat') { this.batAI(dp2); return; }
    if (this.type === 'wolf') { this.wolfAI(dp2); return; }
    if (this.type === 'squid') { this.squidAI(); return; }
    if (this.def.passive) {
      if (this.panic <= 0 && (this.breedAI() || this.temptAI())) { if (!this.safeAhead(this.wdx, this.wdz)) this.moving = false; return; }
      if (this.panic > 0) { this.panic--; this.moving = true; if (this.age % 20 === 0 && Math.random() < 0.3) { const a = Math.atan2(this.wdx, this.wdz) + (Math.random() - 0.5) * 0.8; this.wdx = Math.sin(a); this.wdz = Math.cos(a); } if (!this.safeAhead(this.wdx, this.wdz)) { this.wdx = -this.wdx; this.wdz = -this.wdz; } }
      else this.wander();
      if (this.type === 'sheep') { if (this.eatTimer > 0) { this.eatTimer--; this.moving = false; if (this.eatTimer === 20) { const bx = Math.floor(this.x), by = Math.floor(this.y) - 1, bz = Math.floor(this.z); if (this.world.getBlock(bx, by, bz) === BID.grass_block) { this.world.setBlock(bx, by, bz, BID.dirt, 0); this.sheared = false; } } } else if (Math.random() < 0.002) this.eatTimer = 40; }
      if (this.type === 'chicken' && !this.onGround && this.vy < -0.1) this.vy = -0.1 + this.vy * 0.5 * 0 - 0.02, this.fallDist = 0;
      return;
    }
    this.hostileAI(dp2);
  }
  hostileAI(dp2) {
    const g = this.game, p = g.player, d = this.def;
    // target acquisition
    const range = d.spider && g.isDay && !this.target ? 0 : (d.follow || 20);
    if (!this.target && !p.dead && p.gameMode === 0 && dp2 < range * range && (this.age + this.phase) % 8 === 0 && this.canSee(p)) this.target = p;
    // zombies go after villagers too (and every hostile picks a fight with a nearby iron golem that attacked it)
    if (!this.target && d.huntsVillagers && (this.age + this.phase) % 20 === 0) {
      let best = null, bd = 16 * 16;
      for (const e of g.entities) { if (e.type !== 'villager' || e.dead || e.deathTime > 0) continue; const dd = (e.x - this.x) ** 2 + (e.z - this.z) ** 2; if (dd < bd && this.canSee(e)) { bd = dd; best = e; } }
      if (best) this.target = best;
    }
    if (this.target && (this.target.dead || this.target.deathTime > 0 || (this.target === p && p.gameMode === 1) || dp2 > 35 * 35 || (this.target !== p && (this.target.x - this.x) ** 2 + (this.target.z - this.z) ** 2 > 32 * 32))) this.target = null;
    const t = this.target;
    if (!t) { this.aiming = false; this.wander(); if (d.creeper) { this.fuse = -1; this.swell = Math.max(0, this.swell - 1); this.whiteFlash = false; } return; }
    const dx = t.x - this.x, dz = t.z - this.z, dist = Math.hypot(dx, dz), dy = t.y - this.y;
    if (d.creeper) {
      // EntityAICreeperSwell: start hissing within 3 blocks; keep swelling while the target is within 7 blocks and visible, otherwise deflate
      this.wdx = dx / (dist || 1); this.wdz = dz / (dist || 1);
      const d3 = Math.hypot(dx, dy, dz);
      if ((this.age & 3) === 0 || this.losT === undefined) this.losT = this.canSee(t);
      if (this.fuse < 0 && d3 < 3 && this.losT) { this.fuse = 0; g.sound('random.fuse', this.x, this.y, this.z, 1, 0.5); }
      if (this.fuse >= 0) {
        this.moving = false;
        if (d3 <= 7 && this.losT) this.fuse++; else { this.fuse--; if (this.fuse < 0) this.fuse = -1; }
        this.swell = Math.max(0, this.fuse);
        if (this.fuse >= 30) { this.dead = true; g.explode(this.x, this.y + 0.85, this.z, 3, this); return; }
      } else { this.swell = 0; this.moving = dist > 1.5; }
      this.whiteFlash = this.swell > 0 && ((this.swell / 2) | 0) % 2 === 0;
      return;
    }
    if (d.ranged) {
      // keep distance and shoot
      this.wdx = dx / (dist || 1); this.wdz = dz / (dist || 1);
      this.aiming = dist < 22;
      if (dist < 6) { this.wdx = -this.wdx; this.wdz = -this.wdz; this.moving = true; }
      else if (dist > 12) this.moving = true;
      else { this.moving = false; }
      if (!this.safeAhead(this.wdx, this.wdz)) this.moving = false;
      if (--this.shootT <= 0 && dist < 22 && this.canSee(t)) {
        this.shootT = 20 + Math.floor(Math.min(1, dist / 15) * 40);   // EntityAIArrowAttack(1.0, 20, 60, 15)
        const ex = this.x, ey = this.y + 1.5, ez = this.z, tx = t.x - ex, ty = t.y + 1.0 - ey, tz = t.z - ez, dd = Math.hypot(tx, ty, tz);
        const a = new Projectile(g, ex, ey, ez, 'arrow', this);
        const sp = 1.6, inacc = 0.026 * Math.max(0.5, 14 - 4 * g.difficulty);
        a.vx = tx / dd * sp + (Math.random() - 0.5) * inacc; a.vy = ty / dd * sp + dd * 0.012 + (Math.random() - 0.5) * inacc; a.vz = tz / dd * sp + (Math.random() - 0.5) * inacc;
        a.dmg = 2; g.entities.push(a); g.sound('random.bow', this.x, this.y, this.z, 1, 1 / (Math.random() * 0.4 + 0.8)); this.swingT = 6;
      }
      return;
    }
    // melee (zombie, spider)
    this.wdx = dx / (dist || 1); this.wdz = dz / (dist || 1);
    this.moving = dist > 0.9;
    if (d.spider) {
      if (dist < 4 && dist > 1.5 && this.onGround && this.jumpCd === 0 && Math.random() < 0.1) { this.vy = 0.4; this.vx = this.wdx * 0.5; this.vz = this.wdz * 0.5; this.jumpCd = 20; }
      if (g.isDay && !this.wasAttacked && dist > 6) { this.target = null; }
    }
    if (this.attackT > 0) this.attackT--;
    const reach = this.w / 2 + 0.3 + 0.6;
    if (dist < reach + 0.4 && Math.abs(dy) < 1.9 && this.attackT <= 0) {
      this.attackT = 20; this.swingT = 6;
      const dmg = (d.dmg || 3) * (g.difficulty === 1 ? 0.5 : g.difficulty === 3 ? 1.5 : 1);
      if (t.hurt && t.hurt(Math.round(dmg), this, 'mob', [dx, dz]) && this.onMeleeHit) this.onMeleeHit(t);
    }
  }
}

// mob types with their own class (registered by g_mobs2 / g_dragon / g_village)
const MOB_CLASSES = {};
function makeMob(game, type, x, y, z) { const C = MOB_CLASSES[type]; return C ? new C(game, x, y, z, type) : new Mob(game, x, y, z, type); }
