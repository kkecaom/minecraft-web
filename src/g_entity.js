// ===== g_entity.js : entities, player physics, particles =====
const CLIP_E = 1e-7;
function clipX(b, i, x0, x1, y0, y1, z0, z1, dx) {
  if (y1 <= b[i + 1] + CLIP_E || y0 >= b[i + 4] - CLIP_E || z1 <= b[i + 2] + CLIP_E || z0 >= b[i + 5] - CLIP_E) return dx;
  if (dx > 0 && x1 <= b[i] + CLIP_E) { const d = Math.max(0, b[i] - x1); if (d < dx) dx = d; }
  else if (dx < 0 && x0 >= b[i + 3] - CLIP_E) { const d = Math.min(0, b[i + 3] - x0); if (d > dx) dx = d; }
  return dx;
}
function clipY(b, i, x0, x1, y0, y1, z0, z1, dy) {
  if (x1 <= b[i] + CLIP_E || x0 >= b[i + 3] - CLIP_E || z1 <= b[i + 2] + CLIP_E || z0 >= b[i + 5] - CLIP_E) return dy;
  if (dy > 0 && y1 <= b[i + 1] + CLIP_E) { const d = Math.max(0, b[i + 1] - y1); if (d < dy) dy = d; }
  else if (dy < 0 && y0 >= b[i + 4] - CLIP_E) { const d = Math.min(0, b[i + 4] - y0); if (d > dy) dy = d; }
  return dy;
}
function clipZ(b, i, x0, x1, y0, y1, z0, z1, dz) {
  if (x1 <= b[i] + CLIP_E || x0 >= b[i + 3] - CLIP_E || y1 <= b[i + 1] + CLIP_E || y0 >= b[i + 4] - CLIP_E) return dz;
  if (dz > 0 && z1 <= b[i + 2] + CLIP_E) { const d = Math.max(0, b[i + 2] - z1); if (d < dz) dz = d; }
  else if (dz < 0 && z0 >= b[i + 5] - CLIP_E) { const d = Math.min(0, b[i + 5] - z0); if (d > dz) dz = d; }
  return dz;
}

class Entity {
  constructor(game, x, y, z, w, h) {
    this.game = game; this.world = game.world;
    this.x = this.px = x; this.y = this.py = y; this.z = this.pz = z;
    this.vx = this.vy = this.vz = 0;
    this.w = w; this.h = h; this.yaw = this.pyaw = 0; this.pitch = this.ppitch = 0;
    this.onGround = false; this.dead = false; this.age = 0; this.hcol = false; this.vcol = false;
    this.inWater = false; this.inLava = false; this.fallDist = 0; this.stepH = 0.6; this.noClip = false;
    this._boxes = []; this.id = Entity.nextId++;
    this.eyeH = h * 0.85; this.burn = 0; this.fireImmune = false;
  }
  hasGround(x0, y0, z0, x1, y1, z1) { const b = this._b2 || (this._b2 = []); b.length = 0; this.world.collect(x0, y0, z0, x1, y1, z1, b); for (let i = 0; i < b.length; i += 6) if (x1 > b[i] && x0 < b[i + 3] && y1 > b[i + 1] && y0 < b[i + 4] && z1 > b[i + 2] && z0 < b[i + 5]) return true; return false; }
  // any block with the given definition flag inside the (slightly shrunk) bounding box
  touching(flag) {
    const w = this.world, hw = this.w / 2 - 0.001, x0 = Math.floor(this.x - hw), x1 = Math.floor(this.x + hw), y0 = Math.floor(this.y + 0.001), y1 = Math.floor(this.y + this.h - 0.001), z0 = Math.floor(this.z - hw), z1 = Math.floor(this.z + hw);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const id = w.getBlock(x, y, z); if (id && BLOCKS[id][flag]) return true; }
    return false;
  }
  move(dx, dy, dz, sneakEdge) {
    if (this.noClip) { this.x += dx; this.y += dy; this.z += dz; this.onGround = false; return; }
    if (this.touching('web')) { dx *= 0.25; dy *= 0.05; dz *= 0.25; this.vx = this.vy = this.vz = 0; this.fallDist = 0; }
    const hw = this.w / 2;
    let x0 = this.x - hw, y0 = this.y, z0 = this.z - hw, x1 = this.x + hw, y1 = this.y + this.h, z1 = this.z + hw;
    const wasGround = this.onGround;
    if (sneakEdge && wasGround) {
      const st = 0.05;
      while (dx !== 0 && !this.hasGround(x0 + dx, y0 - this.stepH, z0, x1 + dx, y0, z1)) { if (dx < st && dx >= -st) dx = 0; else if (dx > 0) dx -= st; else dx += st; }
      while (dz !== 0 && !this.hasGround(x0, y0 - this.stepH, z0 + dz, x1, y0, z1 + dz)) { if (dz < st && dz >= -st) dz = 0; else if (dz > 0) dz -= st; else dz += st; }
      while (dx !== 0 && dz !== 0 && !this.hasGround(x0 + dx, y0 - this.stepH, z0 + dz, x1 + dx, y0, z1 + dz)) {
        if (dx < st && dx >= -st) dx = 0; else if (dx > 0) dx -= st; else dx += st;
        if (dz < st && dz >= -st) dz = 0; else if (dz > 0) dz -= st; else dz += st;
      }
    }
    const odx = dx, ody = dy, odz = dz;
    const boxes = this._boxes; boxes.length = 0;
    this.world.collect(x0 + Math.min(0, dx), y0 + Math.min(0, dy), z0 + Math.min(0, dz), x1 + Math.max(0, dx), y1 + Math.max(0, dy), z1 + Math.max(0, dz), boxes);
    const n = boxes.length;
    for (let i = 0; i < n; i += 6) dy = clipY(boxes, i, x0, x1, y0, y1, z0, z1, dy);
    y0 += dy; y1 += dy;
    for (let i = 0; i < n; i += 6) dx = clipX(boxes, i, x0, x1, y0, y1, z0, z1, dx);
    x0 += dx; x1 += dx;
    for (let i = 0; i < n; i += 6) dz = clipZ(boxes, i, x0, x1, y0, y1, z0, z1, dz);
    z0 += dz; z1 += dz;
    // step up
    if (this.stepH > 0 && (this.onGround || (ody < 0 && dy !== ody)) && (dx !== odx || dz !== odz)) {
      const sdx = dx, sdy = dy, sdz = dz, sx0 = x0, sy0 = y0, sz0 = z0;
      let ax0 = this.x - hw, ay0 = this.y, az0 = this.z - hw, ax1 = this.x + hw, ay1 = this.y + this.h, az1 = this.z + hw;
      let sdy2 = this.stepH;
      boxes.length = 0;
      this.world.collect(ax0 + Math.min(0, odx), ay0, az0 + Math.min(0, odz), ax1 + Math.max(0, odx), ay1 + this.stepH, az1 + Math.max(0, odz), boxes);
      const m = boxes.length;
      for (let i = 0; i < m; i += 6) sdy2 = clipY(boxes, i, ax0, ax1, ay0, ay1, az0, az1, sdy2);
      ay0 += sdy2; ay1 += sdy2;
      let ddx = odx, ddz = odz;
      for (let i = 0; i < m; i += 6) ddx = clipX(boxes, i, ax0, ax1, ay0, ay1, az0, az1, ddx);
      ax0 += ddx; ax1 += ddx;
      for (let i = 0; i < m; i += 6) ddz = clipZ(boxes, i, ax0, ax1, ay0, ay1, az0, az1, ddz);
      az0 += ddz; az1 += ddz;
      let back = -sdy2;
      for (let i = 0; i < m; i += 6) back = clipY(boxes, i, ax0, ax1, ay0, ay1, az0, az1, back);
      ay0 += back; ay1 += back;
      if (sdx * sdx + sdz * sdz >= ddx * ddx + ddz * ddz) { dx = sdx; dy = sdy; dz = sdz; x0 = sx0; y0 = sy0; z0 = sz0; x1 = x0 + this.w; y1 = y0 + this.h; z1 = z0 + this.w; }
      else { dx = ddx; dz = ddz; dy = sdy2 + back; x0 = ax0; y0 = ay0; z0 = az0; x1 = ax1; y1 = ay1; z1 = az1; }
    }
    this.x = (x0 + x1) / 2; this.y = y0; this.z = (z0 + z1) / 2;
    this.hcol = dx !== odx || dz !== odz;
    this.vcol = dy !== ody;
    this.onGround = this.vcol && ody < 0;
    if (dx !== odx) this.vx = 0;
    if (dz !== odz) this.vz = 0;
    if (this.vcol) this.vy = 0;
  }
  fluidAt(x, y, z) { return T_FLUID[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]; }
  updateFluids() {
    const w = this.world, hw = this.w * 0.4;
    let water = false, lava = false;
    const yA = Math.floor(this.y + 0.4), yB = Math.floor(this.y + Math.max(0.5, this.h - 0.4));
    for (let y = yA; y <= yB; y++) {
      for (const [ox, oz] of [[0, 0], [hw, hw], [-hw, -hw], [hw, -hw], [-hw, hw]]) {
        const bx = Math.floor(this.x + ox), bz = Math.floor(this.z + oz), id = w.getBlock(bx, y, bz), f = T_FLUID[id];
        if (!f) continue;
        const above = T_FLUID[w.getBlock(bx, y + 1, bz)];
        const top = above ? 1 : fluidSurface(id, w.getMeta(bx, y, bz));
        if (y + top > this.y + 0.4) { if (f === 1) water = true; else lava = true; }
      }
    }
    this.inWater = water; this.inLava = lava;
  }
  // any fluid block overlapping the box (MC: containsAnyLiquid)
  anyLiquid(x0, y0, z0, x1, y1, z1) {
    const w = this.world;
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) if (T_FLUID[w.getBlock(x, y, z)]) return true;
    return false;
  }
  eyeY() { return this.y + this.eyeH; }
  dist2(o) { const dx = this.x - o.x, dy = this.y - o.y, dz = this.z - o.z; return dx * dx + dy * dy + dz * dz; }
  savePrev() { this.px = this.x; this.py = this.y; this.pz = this.z; this.pyaw = this.yaw; this.ppitch = this.pitch; }
  lerpPos(t) { return [this.px + (this.x - this.px) * t, this.py + (this.y - this.py) * t, this.pz + (this.z - this.pz) * t]; }
  tick() { this.savePrev(); this.age++; }
  lightAt() { const w = this.world, x = Math.floor(this.x), y = Math.floor(this.y + this.h * 0.6), z = Math.floor(this.z); return [w.getSky(x, y, z), w.getBlk(x, y, z)]; }
}
Entity.nextId = 1;
function fluidSurface(id, meta) { if (meta & 8) return 1; const d = meta & 7; return id === BID.lava ? Math.max(0.15, (8 - d * 2) / 9) : (8 - d) / 9; }

// ------------------------------------------------------------------------------- dropped items
class ItemEntity extends Entity {
  constructor(game, x, y, z, stack, vel) {
    super(game, x, y, z, 0.25, 0.25);
    this.stack = stack; this.pickupDelay = 10; this.life = 0; this.spin = Math.random() * TAU; this.eyeH = 0.125;
    if (vel) { this.vx = vel[0]; this.vy = vel[1]; this.vz = vel[2]; }
    else { this.vx = (Math.random() - 0.5) * 0.2; this.vy = 0.2; this.vz = (Math.random() - 0.5) * 0.2; }
  }
  tick() {
    this.savePrev(); this.age++; this.life++;
    if (this.pickupDelay > 0) this.pickupDelay--;
    this.updateFluids();
    if (this.inWater) { this.vy += 0.02 * (this.vy < 0.06 ? 1 : 0); this.vx *= 0.95; this.vz *= 0.95; this.vy *= 0.95; this.vy = Math.min(this.vy, 0.1); }
    else if (this.inLava) { this.vy += 0.02; this.vx *= 0.95; this.vz *= 0.95; if (this.age % 10 === 0) this.game.addParticles('smoke', this.x, this.y + 0.2, this.z, 1); if (this.life > 20 && Math.random() < 0.05) { this.dead = true; this.game.sound('random.fizz', this.x, this.y, this.z, 0.4, 2); } }
    else this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    let f = 0.98;
    if (this.onGround) { const b = this.world.getBlock(Math.floor(this.x), Math.floor(this.y) - 1, Math.floor(this.z)); f = (b && BLOCKS[b].slip ? 0.98 : 0.6) * 0.98; }
    this.vx *= f; this.vy *= 0.98; this.vz *= f;
    if (this.onGround) this.vy *= -0.5;
    if (this.life >= 6000) this.dead = true;
    if (this.y < -20) this.dead = true;
    // merge with nearby stacks
    if (this.age % 10 === 0 && this.stack.n < stackMax(this.stack.id)) {
      for (const e of this.game.entities) {
        if (e === this || e.dead || !(e instanceof ItemEntity)) continue;
        if (Math.abs(e.x - this.x) < 0.5 && Math.abs(e.y - this.y) < 0.5 && Math.abs(e.z - this.z) < 0.5 && canMerge(e.stack, this.stack)) {
          const can = Math.min(stackMax(this.stack.id) - this.stack.n, e.stack.n);
          if (e.stack.n >= this.stack.n) { e.stack.n += 0; }
          if (this.stack.n <= e.stack.n) { const c = Math.min(stackMax(e.stack.id) - e.stack.n, this.stack.n); if (c > 0) { e.stack.n += c; this.stack.n -= c; e.life = Math.min(e.life, this.life); if (this.stack.n <= 0) { this.dead = true; break; } } }
        }
      }
    }
  }
}

// ------------------------------------------------------------------------------- falling sand/gravel
class FallingBlock extends Entity {
  constructor(game, x, y, z, id, meta) { super(game, x + 0.5, y, z + 0.5, 0.98, 0.98); this.bid = id; this.bmeta = meta; this.time = 0; }
  tick() {
    this.savePrev(); this.age++; this.time++;
    this.vy -= 0.04; this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) {
      const bx = Math.floor(this.x), by = Math.floor(this.y + 0.001), bz = Math.floor(this.z), cur = this.world.getBlock(bx, by, bz);
      this.dead = true;
      if (cur === 0 || T_REPL[cur]) { this.world.setBlock(bx, by, bz, this.bid, this.bmeta); this.game.sound('dig.' + BLOCKS[this.bid].sound, bx + 0.5, by, bz + 0.5, 0.6, 0.9); }
      else this.game.spawnItem(this.x, this.y + 0.3, this.z, newStack(this.bid, 1), null);
    } else if (this.time > 600 || this.y < -10) { this.dead = true; this.game.spawnItem(this.x, Math.max(this.y, 1), this.z, newStack(this.bid, 1), null); }
  }
}

// ------------------------------------------------------------------------------- primed TNT
class PrimedTnt extends Entity {
  constructor(game, x, y, z, fuse) { super(game, x + 0.5, y, z + 0.5, 0.98, 0.98); this.fuse = fuse || 80; this.vy = 0.2; this.vx = (Math.random() - 0.5) * 0.04; this.vz = (Math.random() - 0.5) * 0.04; }
  tick() {
    this.savePrev(); this.age++;
    this.vy -= 0.04; this.updateFluids(); if (this.inWater) { this.vx *= 0.8; this.vy *= 0.8; this.vz *= 0.8; }
    this.move(this.vx, this.vy, this.vz); this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) { this.vx *= 0.7; this.vz *= 0.7; this.vy *= -0.5; }
    if (--this.fuse <= 0) { this.dead = true; this.game.explode(this.x, this.y + 0.5, this.z, 4, this); }
    else if (this.age % 3 === 0) this.game.addParticles('smoke', this.x, this.y + 1.0, this.z, 1);
  }
}

// ------------------------------------------------------------------------------- experience orbs
class XPOrb extends Entity {
  constructor(game, x, y, z, value) { super(game, x, y, z, 0.25, 0.25); this.value = value; this.vx = (Math.random() - 0.5) * 0.2; this.vy = 0.2; this.vz = (Math.random() - 0.5) * 0.2; this.eyeH = 0.1; }
  tick() {
    this.savePrev(); this.age++;
    const p = this.game.player;
    this.vy -= 0.03;
    const dx = p.x - this.x, dy = p.y + 0.9 - this.y, dz = p.z - this.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 64 && !p.dead) { const d = Math.sqrt(d2), s = 1 - d / 8; this.vx += dx / d * s * s * 0.1; this.vy += dy / d * s * s * 0.1; this.vz += dz / d * s * s * 0.1; }
    this.move(this.vx, this.vy, this.vz); this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) { this.vx *= 0.6; this.vz *= 0.6; this.vy *= -0.9; }
    if (d2 < 1.0 && !p.dead) { this.dead = true; p.addXP(this.value); this.game.sound('random.orb', this.x, this.y, this.z, 0.1, 0.5 + Math.random() * 0.5); }
    if (this.age > 6000) this.dead = true;
  }
}

// ------------------------------------------------------------------------------- arrows / thrown items
class Projectile extends Entity {
  constructor(game, x, y, z, kind, owner) { super(game, x, y, z, 0.25, 0.25); this.kind = kind; this.owner = owner; this.stuck = false; this.stuckTime = 0; this.dmg = 2; this.eyeH = 0.125; this.pickable = false; this.crit = false; }
  tick() {
    this.savePrev(); this.age++;
    if (this.stuck) { this.stuckTime++; if (this.stuckTime > 1200) this.dead = true; this.checkPickup(); return; }
    const gravity = this.kind === 'arrow' ? 0.05 : 0.03;
    // ray to the next position
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    const len = Math.hypot(this.vx, this.vy, this.vz) || 1;
    const hit = this.world.raycast(this.x, this.y, this.z, this.vx / len, this.vy / len, this.vz / len, len, false, true);
    let ent = null, entT = 1e9;
    for (const e of this.game.entities) {
      if (e === this || e.dead || !(e instanceof Mob) || e === this.owner) continue;
      if (e.parts) {   // multipart mobs (the ender dragon) are hit part by part
        for (const pt of e.parts) { const r = rayAABB(this.x, this.y, this.z, this.vx / len, this.vy / len, this.vz / len, pt.x0 - 0.15, pt.y0 - 0.15, pt.z0 - 0.15, pt.x1 + 0.15, pt.y1 + 0.15, pt.z1 + 0.15); if (r !== null && r < len && r < entT) { ent = e; entT = r; this.hitPart = pt; } }
        continue;
      }
      const r = rayAABB(this.x, this.y, this.z, this.vx / len, this.vy / len, this.vz / len, e.x - e.w / 2 - 0.15, e.y - 0.15, e.z - e.w / 2 - 0.15, e.x + e.w / 2 + 0.15, e.y + e.h + 0.15, e.z + e.w / 2 + 0.15);
      if (r !== null && r < len && r < entT) { ent = e; entT = r; this.hitPart = null; }
    }
    const p = this.game.player;
    if (this.owner !== p && !p.dead && p.gameMode === 0) {
      const r = rayAABB(this.x, this.y, this.z, this.vx / len, this.vy / len, this.vz / len, p.x - 0.45, p.y - 0.1, p.z - 0.45, p.x + 0.45, p.y + 1.9, p.z + 0.45);
      if (r !== null && r < len && r < entT) { ent = p; entT = r; }
    }
    if (ent && (!hit || entT < hit.t)) {
      const dmg = this.kind === 'arrow' ? Math.ceil(len * this.dmg * (this.crit ? 1.5 : 1)) : (this.kind === 'egg' || this.kind === 'snowball' ? (ent.type === 'blaze' ? 3 : 0) : 0);
      if (ent.parts && ent.hurtPart) { if (dmg > 0) ent.hurtPart(this.hitPart || ent.parts[0], dmg, this.owner || this, 'projectile'); }
      else if (dmg > 0 || this.kind === 'snowball') ent.hurt(Math.max(dmg, 0.001), this.owner || this, 'projectile', [this.vx, this.vz]);
      if (this.kind === 'ender_pearl') { this.pearlLand(); return; }
      this.game.sound(this.kind === 'arrow' ? 'random.bowhit' : 'random.pop', this.x, this.y, this.z, 0.6, 1.2);
      this.dead = true; return;
    }
    if (hit) {
      this.x += this.vx / len * hit.t; this.y += this.vy / len * hit.t; this.z += this.vz / len * hit.t;
      if (this.kind === 'ender_pearl') { this.pearlLand(); return; }
      if (this.kind === 'arrow') { this.stuck = true; this.vx = this.vy = this.vz = 0; this.game.sound('random.bowhit', this.x, this.y, this.z, 0.6, 1.2); this.pickable = this.owner === p; }
      else { this.dead = true; this.game.addParticles('splash', this.x, this.y, this.z, 4); }
      return;
    }
    this.x = nx; this.y = ny; this.z = nz;
    this.updateFluids();
    const drag = this.inWater ? 0.6 : 0.99;
    this.vx *= drag; this.vy *= drag; this.vz *= drag; this.vy -= gravity;
    this.yaw = Math.atan2(-this.vx, this.vz); this.pitch = Math.atan2(-this.vy, Math.hypot(this.vx, this.vz));
    if (this.kind === 'arrow' && this.crit && this.age % 1 === 0) this.game.addParticles('crit', this.x, this.y, this.z, 1);
    if (this.y < -30) this.dead = true;
  }
  // ender pearl: teleport the thrower to the impact point (5 fall damage in survival)
  pearlLand() {
    const g = this.game, p = g.player, w = this.world; this.dead = true;
    if (this.owner === p && !p.dead) {
      let x = this.x, y = this.y, z = this.z;
      const vl = Math.hypot(this.vx, this.vy, this.vz) || 1, bx = -this.vx / vl * 0.25, by = -this.vy / vl * 0.25, bz = -this.vz / vl * 0.25;
      for (let i = 0; i < 16 && p.hasGround(x - 0.3, y, z - 0.3, x + 0.3, y + p.h, z + 0.3); i++) { x += bx; y += by; z += bz; }
      for (let i = 0; i < 24; i++) g.particles.sprite('flame', p.x, p.y + 1, p.z, 1, { size: 0.09, up: 0, vel: 0.3, life: 16, shrink: true, spread: 0.6, spreadY: 1.8, r: 0.75, g: 0.25, b: 1 });
      p.x = p.px = x; p.y = p.py = y; p.z = p.pz = z; p.vx = p.vy = p.vz = 0; p.fallDist = 0;
      g.sound('mob.enderman.teleport', x, y, z, 1, 1);
      for (let i = 0; i < 24; i++) g.particles.sprite('flame', x, y + 1, z, 1, { size: 0.09, up: 0, vel: 0.3, life: 16, shrink: true, spread: 0.6, spreadY: 1.8, r: 0.75, g: 0.25, b: 1 });
      if (p.gameMode === 0) p.hurt(5, null, 'fall');
    }
  }
  checkPickup() {
    const p = this.game.player;
    if (!this.pickable || this.stuckTime < 5 || p.dead || p.gameMode !== 0) return;
    if (Math.abs(p.x - this.x) < 1 && Math.abs(p.y + 0.9 - this.y) < 1.2 && Math.abs(p.z - this.z) < 1) {
      if (p.giveItem(newStack(IID.arrow, 1))) { this.dead = true; this.game.sound('random.pop', this.x, this.y, this.z, 0.2, 1.5); }
    }
  }
}
function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = 1e9;
  const ax = [ox, oy, oz], ad = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ad[i]) < 1e-9) { if (ax[i] < lo[i] || ax[i] > hi[i]) return null; }
    else { let t1 = (lo[i] - ax[i]) / ad[i], t2 = (hi[i] - ax[i]) / ad[i]; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return null; }
  }
  return tmin;
}

// ------------------------------------------------------------------------------- player
class Player extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z, 0.6, 1.8);
    this.eyeH = 1.62;
    this.inv = new Array(36).fill(null);     // 0..8 hotbar
    this.armor = [null, null, null, null];   // helmet, chest, legs, boots
    this.sel = 0;
    this.health = 20; this.maxHealth = 20; this.food = 20; this.sat = 5; this.exh = 0; this.foodTimer = 0; this.air = 300;
    this.xp = 0; this.level = 0; this.xpProg = 0; this.score = 0;
    this.gameMode = 0; this.flying = false; this.canFly = false;
    this.sprinting = false; this.sneaking = false; this.jumpDelay = 0; this.sprintTimer = 0; this.lastForwardTap = -100;
    this.invuln = 0; this.hurtTime = 0; this.hurtDur = 10; this.lastDmg = 0; this.dead = false;
    this.walkDist = 0; this.pwalkDist = 0; this.bob = 0; this.pbob = 0; this.stepDist = 0; this.nextStep = 1;
    this.swing = 0; this.swingTicks = 0; this.swinging = false; this.pswing = 0;
    this.eating = 0; this.usingBow = 0; this.attackCd = 0;
    this.spawn = null; this.equipProg = 1; this.pequip = 1; this.heldSlot = 0; this.heldId = 0;
    this.fovMod = 1; this.pfovMod = 1; this.flySpeed = 0.05; this.vehicle = null;
    this.sleeping = false; this.sleepTimer = 0; this.fireTicks = 0;
    this.airGasp = 0;
    this.limbAmt = 0; this.plimbAmt = 0; this.limbPos = 0; this.bodyYaw = 0; this.pbodyYaw = 0; this.headYawRel = 0; this.headPitchRel = 0;
  }
  held() { return this.inv[this.sel]; }
  armorPoints() { let a = 0; for (const s of this.armor) if (s) a += ITEMS[s.id].armor.pts; return a; }
  giveItem(stack) {
    // returns true if fully stored
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 36; i++) {
        const s = this.inv[i];
        if (pass === 0) { if (s && canMerge(s, stack) && s.n < stackMax(s.id)) { const c = Math.min(stackMax(s.id) - s.n, stack.n); s.n += c; stack.n -= c; if (stack.n <= 0) return true; } }
        else if (!s) { this.inv[i] = cloneStack(stack); stack.n = 0; return true; }
      }
    }
    return stack.n <= 0;
  }
  addXP(v) {
    this.score += v; this.xp += v;
    const need = l => l >= 30 ? 112 + (l - 30) * 9 : l >= 15 ? 37 + (l - 15) * 5 : 7 + l * 2;
    let prog = this.xpProg * need(this.level) + v;
    const l0 = this.level;
    while (prog >= need(this.level)) { prog -= need(this.level); this.level++; }
    if (this.level > l0) this.game.sound('random.levelup', this.x, this.y, this.z, 0.5, 1);
    this.xpProg = prog / need(this.level);
  }
  exhaust(v) { if (this.gameMode === 0) this.exh += v; }
  heal(v) { this.health = Math.min(this.maxHealth, this.health + v); }
  hurt(amount, src, kind, kb) {
    if (this.dead || this.gameMode === 1 && kind !== 'void') return false;
    if (this.invuln > 10) { if (amount <= this.lastDmg) return false; const full = amount; amount -= this.lastDmg; this.lastDmg = full; }
    else { this.invuln = 20; this.lastDmg = amount; }
    if (kind !== 'fall' && kind !== 'drown' && kind !== 'starve' && kind !== 'void' && kind !== 'magic') {
      const a = this.armorPoints();
      amount *= 1 - Math.min(20, Math.max(a / 5, a - amount / 2)) / 25;
      // damage armor
      for (const s of this.armor) if (s) { s.d = (s.d || 0) + Math.max(1, Math.floor(amount / 4)); if (s.d >= ITEMS[s.id].dur) { const i = this.armor.indexOf(s); this.armor[i] = null; this.game.sound('random.break', this.x, this.y, this.z, 0.8, 1); } }
    }
    this.health -= amount; this.hurtTime = this.hurtDur; this.exhaust(0.1); this.game.stat('dmgTaken', undefined, amount);
    if (src && src.isMob) { this.lastHurtBy = src; this.lastHurtT = this.game.tick; }   // tamed wolves defend their owner
    this.game.sound('damage.hurt', this.x, this.y, this.z, 1, 1);
    if (kb) { const d = Math.hypot(kb[0], kb[1]) || 1; this.vx += kb[0] / d * 0.4 * 0.5; this.vz += kb[1] / d * 0.4 * 0.5; this.vy = Math.min(0.4, this.vy + 0.4); }
    if (this.health <= 0) { this.health = 0; this.die(src, kind); }
    return true;
  }
  // room to hop out of a fluid: the player's box moved up 0.6 (and forward) is clear of blocks and fluid (MC: isFree)
  ledgeFree() {
    const x0 = this.x - 0.3 + this.vx, x1 = this.x + 0.3 + this.vx, y0 = this.y + 0.6, y1 = this.y + 0.6 + this.h, z0 = this.z - 0.3 + this.vz, z1 = this.z + 0.3 + this.vz;
    return !this.hasGround(x0, y0, z0, x1, y1, z1) && !this.anyLiquid(x0, y0 + 1e-4, z0, x1, y1 - 1e-4, z1);
  }
  die(src, kind) {
    if (this.dead) return;
    this.dead = true; this.game.sound('damage.death', this.x, this.y, this.z, 1, 1);
    this.game.onPlayerDeath(src, kind);
  }
  tick() {
    const g = this.game, inp = g.input;
    this.savePrev(); this.pwalkDist = this.walkDist; this.pbob = this.bob; this.pswing = this.swing; this.pfovMod = this.fovMod;
    this.age++;
    if (this.invuln > 0) this.invuln--;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.attackCd > 0) this.attackCd--;
    if (this.dead) { this.vy -= 0.08; this.vy *= 0.98; this.vx *= 0.9; this.vz *= 0.9; this.move(this.vx, this.vy, this.vz); return; }
    // held item change animation
    this.pequip = this.equipProg;
    const hs = this.held(), hid = hs ? hs.id : 0;
    if (hid !== this.heldId || this.sel !== this.heldSlot) { this.equipProg -= 0.4; if (this.equipProg <= 0) { this.equipProg = 0; this.heldId = hid; this.heldSlot = this.sel; } }
    else this.equipProg = Math.min(1, this.equipProg + 0.4);
    // swing
    if (this.swinging) { this.swingTicks++; if (this.swingTicks >= 6) { this.swingTicks = 0; this.swinging = false; } this.swing = this.swingTicks / 6; } else { this.swingTicks = 0; this.swing = 0; }
    // input
    let fwd = (inp.forward ? 1 : 0) - (inp.back ? 1 : 0), str = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    if (g.screen && !g.screen.passive) { fwd = 0; str = 0; }
    const wantSneak = !!inp.sneak && !(g.screen && !g.screen.passive);
    this.sneaking = wantSneak && !this.flying;
    if (!this.sneaking && this.h < 1.8 && !this.flying && this.hasGround(this.x - 0.3, this.y + this.h, this.z - 0.3, this.x + 0.3, this.y + 1.8, this.z + 0.3)) this.sneaking = true;   // low ceiling above: keep crouching
    if (this.sleeping) { fwd = 0; str = 0; }
    this.h = this.sneaking ? 1.5 : 1.8; this.eyeH = this.sneaking ? 1.27 : 1.62;
    // sprint
    const canSprint = this.food > 6 || this.gameMode === 1 || this.flying;
    if (fwd > 0 && (inp.sprint || this.sprintToggle) && canSprint && !this.sneaking && !this.eating) this.sprinting = true;
    if (fwd <= 0 || this.hcol && !this.flying || !canSprint || this.sneaking) { if (!(fwd > 0 && inp.sprint && canSprint && !this.sneaking)) this.sprinting = false; }
    if (this.sprinting && this.inWater && false) this.sprinting = false;
    fwd *= 0.98; str *= 0.98;
    if (this.sneaking) { fwd *= 0.3; str *= 0.3; }
    if (this.eating > 0 || this.usingBow > 0) { fwd *= 0.2; str *= 0.2; if (this.sprinting) this.sprinting = false; }
    this.updateFluids();
    const speedAttr = 0.1 * (this.sprinting ? 1.3 : 1);
    const jump = inp.jump && !(g.screen && !g.screen.passive);
    const yawc = Math.cos(this.yaw), yaws = Math.sin(this.yaw);
    const moveRel = (s, f, fr) => {
      let d = s * s + f * f;
      if (d >= 1e-4) { d = Math.max(Math.sqrt(d), 1); d = fr / d; s *= d; f *= d; this.vx += s * yawc - f * yaws; this.vz += f * yawc + s * yaws; }
    };
    if (this.gameMode === 1 || this.canFly) {
      if (jump && this.jumpTapTimer > 0 && !this.flying && false) { /* handled at key event */ }
    }
    if (this.flying) {
      const fs = this.flySpeed * (this.sprinting ? 2 : 1);
      moveRel(str, fwd, fs * 1.0);
      let up = 0; if (jump) up += 1; if (wantSneak) up -= 1;
      this.vy += up * fs * 3;
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.91; this.vz *= 0.91; this.vy *= 0.6;
      if (this.onGround) { this.flying = false; }
      this.fallDist = 0;
    } else if (this.inWater) {
      moveRel(str, fwd, 0.02 * (this.sprinting ? 1.6 : 1) + 0.0);
      if (jump) this.vy += 0.04;
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.8; this.vy *= 0.8; this.vz *= 0.8; this.vy -= 0.02;
      if (this.hcol && this.ledgeFree()) this.vy = 0.3;
      this.fallDist = 0;
    } else if (this.inLava) {
      moveRel(str, fwd, 0.02);
      if (jump) this.vy += 0.04;
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.5; this.vy *= 0.5; this.vz *= 0.5; this.vy -= 0.02;
      if (this.hcol && this.ledgeFree()) this.vy = 0.3;
      this.fallDist *= 0.5;
    } else {
      // ladders
      const cb = g.world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z)), onLadder = BLOCKS[cb] && BLOCKS[cb].climbable;
      let fr = 0.91;
      if (this.onGround) { const b = g.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z)); fr = (BLOCKS[b] && BLOCKS[b].slip ? 0.98 : 0.6) * 0.91; }
      const f1 = 0.16277136 / (fr * fr * fr);
      moveRel(str, fwd, this.onGround ? speedAttr * f1 : (this.sprinting ? 0.026 : 0.02));
      if (this.jumpDelay > 0) this.jumpDelay--;
      if (jump && this.onGround && this.jumpDelay === 0) {
        this.vy = 0.42; this.jumpDelay = 10; g.stat('jumps');
        if (this.sprinting) { this.vx -= Math.sin(this.yaw) * 0.2; this.vz += Math.cos(this.yaw) * 0.2; this.exhaust(0.2); } else this.exhaust(0.05);
      }
      if (!jump) this.jumpDelay = 0;
      if (onLadder) {
        this.vx = clamp(this.vx, -0.15, 0.15); this.vz = clamp(this.vz, -0.15, 0.15); this.fallDist = 0;
        if (this.vy < -0.15) this.vy = -0.15;
        if (this.sneaking && this.vy < 0) this.vy = 0;
        if (this.hcol) this.vy = 0.2;
      }
      this.move(this.vx, this.vy, this.vz, this.sneaking);
      if (onLadder && jump) this.vy = 0.2;
      this.vy -= 0.08; this.vy *= 0.98; this.vx *= fr; this.vz *= fr;
      if (onLadder && this.sneaking && this.vy < 0) this.vy = 0;
    }
    // fall damage
    if (!this.flying) {
      if (this.vy < 0 || !this.onGround) { if (this.py > this.y) this.fallDist += this.py - this.y; }
      if (this.onGround) {
        if (this.fallDist > 3 && this.gameMode === 0) {
          const bl = this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
          if (!(T_FLUID[bl])) { const dmg = Math.ceil(this.fallDist - 3); this.hurt(dmg, null, 'fall'); g.sound(dmg > 4 ? 'damage.fall_big' : 'damage.fall_small', this.x, this.y, this.z, 1, 1); }
        }
        this.fallDist = 0;
      }
    } else this.fallDist = 0;
    if (this.inWater) this.fallDist = 0;
    // water surface splash & swimming sounds
    if (this.inWater !== this.wasInWater) { if (this.inWater) g.sound('liquid.splash', this.x, this.y, this.z, 0.6, 1); this.wasInWater = this.inWater; }
    // walk distance / bob / footsteps
    const hd = Math.hypot(this.x - this.px, this.z - this.pz);
    this.walkDist += hd * 0.6;
    const wantBob = this.onGround && !this.dead ? Math.min(0.1, hd) : 0;
    this.bob += (wantBob - this.bob) * 0.4;
    if (this.onGround && !this.flying && !this.inWater && hd > 0.0) {
      this.stepDist += hd * 0.6;
      if (this.stepDist > this.nextStep) {
        this.nextStep = this.stepDist + 1;
        const bx = Math.floor(this.x), by = Math.floor(this.y - 0.2), bz = Math.floor(this.z), bl = this.world.getBlock(bx, by, bz);
        if (bl && BLOCKS[bl].sound) g.sound('step.' + (BLOCKS[bl].sound === 'glass' || BLOCKS[bl].sound === 'metal' ? 'stone' : BLOCKS[bl].sound), this.x, this.y, this.z, this.sneaking ? 0.15 : 0.35, 1);
      }
    }
    if (this.inWater && hd > 0.02 && this.age % 8 === 0) g.sound('liquid.swim', this.x, this.y, this.z, 0.3, 1 + Math.random() * 0.3);
    // exhaustion from movement
    if (this.gameMode === 0) {
      if (this.sprinting && hd > 0) this.exh += hd * 0.1;
      else if (this.inWater && hd > 0) this.exh += hd * 0.01;
    }
    // fov modifier
    const targetFov = 1 + (this.sprinting ? 0.15 : 0) + (this.flying && this.sprinting ? 0.1 : 0);
    this.fovMod += (targetFov - this.fovMod) * 0.5;
    // hunger / regeneration / air
    if (this.gameMode === 0) this.foodTick();
    this.updateAir();
    if (this.y < -30 && !this.dead) this.hurt(4, null, 'void');
    if (this.inLava && this.gameMode === 0) { this.fireTicks = 300; if (this.age % 10 === 0) this.hurt(4, null, 'lava'); }
    if (this.gameMode === 0 && this.touching('fire')) { this.fireTicks = Math.max(this.fireTicks, 160); if (this.age % 10 === 0) this.hurt(1, null, 'fire'); }
    if (this.fireTicks > 0) { this.fireTicks--; if (this.inWater) this.fireTicks = 0; else if (this.gameMode === 0 && this.fireTicks % 20 === 0) this.hurt(1, null, 'fire'); }
    // wither (wither skeleton hits): 1 damage every 2 seconds, armour does not help
    if (this.witherT > 0) { this.witherT--; if (this.gameMode === 0 && this.witherT % 40 === 0 && this.health > 0) this.hurt(1, null, 'magic'); }
    // magma blocks burn feet unless sneaking; soul sand drags (MagmaBlock.stepOn, Block.getSpeedFactor)
    if (this.onGround && !this.flying) {
      const fb = BLOCKS[this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.1), Math.floor(this.z))];
      if (fb.hot && !this.sneaking && this.gameMode === 0 && this.age % 10 === 0) this.hurt(1, null, 'fire');
      if (fb.slow) { this.vx *= fb.slow; this.vz *= fb.slow; }
    }
    const bl = this.world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z));
    if (BLOCKS[bl] && BLOCKS[bl].cactus && this.gameMode === 0 && this.age % 10 === 0) this.hurt(1, null, 'cactus');
    for (const [ox, oz] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) { const b2 = this.world.getBlock(Math.floor(this.x + ox), Math.floor(this.y + 0.5), Math.floor(this.z + oz)); if (BLOCKS[b2] && BLOCKS[b2].cactus && this.gameMode === 0 && this.age % 10 === 0) { this.hurt(1, null, 'cactus'); break; } }
    this.collectItems();
  }
  foodTick() {
    if (this.exh >= 4) { this.exh -= 4; if (this.sat > 0) this.sat = Math.max(0, this.sat - 1); else if (this.food > 0) this.food--; }
    if (this.food >= 18 && this.health < this.maxHealth) {
      if (this.food >= 20 && this.sat > 0) { this.foodTimer++; if (this.foodTimer >= 10) { const a = Math.min(this.sat, 6); this.heal(a / 6); this.exhaust(a); this.foodTimer = 0; } }
      else { this.foodTimer++; if (this.foodTimer >= 80) { this.heal(1); this.exhaust(6); this.foodTimer = 0; } }
    } else if (this.food <= 0) {
      this.foodTimer++;
      if (this.foodTimer >= 80) { if (this.health > 10 || this.game.difficulty === 3 || (this.game.difficulty === 2 && this.health > 1)) this.hurt(1, null, 'starve'); this.foodTimer = 0; }
    } else this.foodTimer = 0;
  }
  updateAir() {
    const eyeIn = this.game.eyeInWater;
    if (eyeIn && this.gameMode === 0) {
      this.air--;
      if (this.air <= -20) { this.air = 0; this.hurt(2, null, 'drown'); this.game.addParticles('bubble', this.x, this.eyeY(), this.z, 6); }
    } else if (this.air < 300) this.air = Math.min(300, this.air + 4);
  }
  collectItems() {
    const g = this.game;
    if (this.dead) return;
    for (const e of g.entities) {
      if (!(e instanceof ItemEntity) || e.dead || e.pickupDelay > 0) continue;
      if (Math.abs(e.x - this.x) < 1.0 && Math.abs(e.y - (this.y + 0.5)) < 1.2 && Math.abs(e.z - this.z) < 1.0) {
        const before = e.stack.n;
        this.giveItem(e.stack);
        if (e.stack.n < before) g.sound('random.pop', this.x, this.y, this.z, 0.2, 1 + (Math.random() - 0.5) * 0.4 + 0.6);
        if (e.stack.n <= 0) e.dead = true;
      }
    }
  }
  swingArm() { if (!this.swinging || this.swingTicks >= 3) { this.swinging = true; this.swingTicks = -1; } }
}

// ------------------------------------------------------------------------------- particles
class ParticleSystem {
  constructor(game) { this.game = game; this.list = []; this.max = 2500; }
  add(p) { if (this.list.length >= this.max) this.list.shift(); this.list.push(p); return p; }
  block(x, y, z, id, n, speed) {
    const d = BLOCKS[id]; if (!d || !d.faceNames) return;
    const r = this.game.renderer;
    for (let i = 0; i < n; i++) {
      const face = d.faceNames[(Math.random() * 6) | 0]; let tile = r.TILE[face]; if (tile === undefined) continue;
      const u = Math.floor(Math.random() * 3) / 4, v = Math.floor(Math.random() * 3) / 4;
      let col = [1, 1, 1];
      if (d.tint === 'grass') col = [0.57, 0.74, 0.35]; else if (d.tint === 'foliage') col = [0.47, 0.67, 0.18];
      this.add({ x: x + Math.random(), y: y + Math.random(), z: z + Math.random(), vx: (Math.random() - 0.5) * 0.3 * (speed || 1), vy: Math.random() * 0.2 * (speed || 1) + 0.05, vz: (Math.random() - 0.5) * 0.3 * (speed || 1),
        life: 20 + (Math.random() * 20) | 0, age: 0, size: 0.05 + Math.random() * 0.03, tile, u0: u, v0: v, u1: u + 0.25, v1: v + 0.25, r: col[0] * 0.6, g: col[1] * 0.6, b: col[2] * 0.6, a: 1, grav: 0.06, collide: true, light: true, kind: 'block' });
    }
  }
  sprite(name, x, y, z, n, o) {
    const r = this.game.renderer, tile = r.TILE['particle_' + name]; if (tile === undefined) return;
    o = o || {};
    for (let i = 0; i < n; i++) {
      this.add({ x: x + (Math.random() - 0.5) * (o.spread || 0.3), y: y + (Math.random() - 0.5) * (o.spreadY === undefined ? 0.3 : o.spreadY), z: z + (Math.random() - 0.5) * (o.spread || 0.3),
        vx: (Math.random() - 0.5) * (o.vel || 0.05), vy: o.up === undefined ? 0.03 + Math.random() * 0.03 : o.up + Math.random() * 0.02, vz: (Math.random() - 0.5) * (o.vel || 0.05),
        life: o.life || 20 + (Math.random() * 20) | 0, age: 0, size: o.size || 0.12, tile, u0: 0, v0: 0, u1: 1, v1: 1, r: o.r === undefined ? 1 : o.r, g: o.g === undefined ? 1 : o.g, b: o.b === undefined ? 1 : o.b, a: 1, grav: o.grav || 0, collide: false, light: false, fade: o.fade, kind: name, shrink: o.shrink, drag: o.drag || 0.96 });
    }
  }
  tick() {
    const w = this.game.world, L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.age++;
      if (p.age >= p.life) { L[i] = L[L.length - 1]; L.pop(); continue; }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.vy -= p.grav;
      let nx = p.x + p.vx, ny = p.y + p.vy, nz = p.z + p.vz;
      if (p.collide) {
        const b = w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (b && T_SOLID[b]) { if (!(w.getBlock(Math.floor(p.x), Math.floor(ny), Math.floor(p.z)) && T_SOLID[w.getBlock(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))])) { nx = p.x; nz = p.z; p.vx *= 0.5; p.vz *= 0.5; } else { ny = p.y; p.vy = 0; p.vx *= 0.7; p.vz *= 0.7; } if (T_SOLID[w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))]) { nx = p.x; ny = p.y; nz = p.z; } }
      }
      p.x = nx; p.y = ny; p.z = nz;
      const d = p.drag || 0.98; p.vx *= d; p.vy *= d; p.vz *= d;
      if (p.kind === 'smoke' || p.kind === 'flame') { p.size *= 0.985; }
    }
  }
  render(r, alphaBatch, tileBatch, camx, camy, camz, rx, ry, rz, ux, uy, uz, partial) {
    const w = this.game.world;
    for (const p of this.list) {
      const x = (p.px === undefined ? p.x : p.px + (p.x - p.px) * partial) - camx, y = (p.py === undefined ? p.y : p.py + (p.y - p.py) * partial) - camy, z = (p.pz === undefined ? p.z : p.pz + (p.z - p.pz) * partial) - camz;
      if (x * x + y * y + z * z > 4096) continue;
      let sky = 1, blk = 1;
      if (p.light) { sky = w.getSky(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) / 15; blk = w.getBlk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) / 15; }
      const s = p.size * (p.shrink ? (1 - p.age / p.life) : 1);
      let a = p.a; if (p.fade) a *= 1 - p.age / p.life; else if (p.age > p.life - 6) a *= (p.life - p.age) / 6;
      const b = p.kind === 'block' ? tileBatch : alphaBatch;
      b.billboard(x, y, z, rx * s, ry * s, rz * s, ux * s, uy * s, uz * s, p.tile, p.u0, p.v0, p.u1, p.v1, p.r, p.g, p.b, a, sky, blk);
    }
  }
}
