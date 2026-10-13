// ===== g_dragon.js : the Ender Dragon - EnderDragon flight (phase manager), multipart hitbox, crystal healing, death sequence =====
MOB_DEFS.ender_dragon = { w: 16, h: 8, hp: 200, speed: 0, model: 'ender_dragon', boss: true, flying: true, fireImmune: true, snd: 'enderdragon', xp: [0, 0], say: null, hurtSnd: 'mob.enderdragon.hit', deathSnd: null };
const DRAGON_IMMUNE = new Set(['obsidian', 'end_stone', 'bedrock', 'iron_bars', 'end_portal_frame', 'end_portal', 'end_gateway', 'fire']);
const rotWrap = d => { d %= 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };

// ---------------------------------------------------------------- model (EnderDragonModel 1.16, 256x256), both sides built explicitly
const DRM = {
  upperlip: bp(176, 44, [-6, -1, -24, 12, 5, 16]), upperhead: bp(112, 30, [-8, -8, -10, 16, 16, 16]),
  scaleL: bp(0, 0, [-5, -12, -4, 2, 4, 6], { mirror: true }), nostrilL: bp(112, 0, [-5, -3, -22, 2, 2, 4], { mirror: true }),
  scaleR: bp(0, 0, [3, -12, -4, 2, 4, 6]), nostrilR: bp(112, 0, [3, -3, -22, 2, 2, 4]),
  jaw: bp(176, 65, [-6, 0, -16, 12, 4, 16]),
  neck: bp(192, 104, [-5, -5, -5, 10, 10, 10]), neckScale: bp(48, 0, [-1, -9, -3, 2, 4, 6]),
  body: bp(0, 0, [-12, 0, -16, 24, 24, 64]), bs1: bp(220, 53, [-1, -6, -10, 2, 6, 12]), bs2: bp(220, 53, [-1, -6, 10, 2, 6, 12]), bs3: bp(220, 53, [-1, -6, 30, 2, 6, 12]),
  wingL: bp(112, 88, [0, -4, -4, 56, 8, 8], { mirror: true }), wingSkinL: bp(-56, 88, [0, 0, 2, 56, 0, 56], { mirror: true }),
  tipL: bp(112, 136, [0, -2, -2, 56, 4, 4], { mirror: true }), tipSkinL: bp(-56, 144, [0, 0, 2, 56, 0, 56], { mirror: true }),
  wingR: bp(112, 88, [-56, -4, -4, 56, 8, 8]), wingSkinR: bp(-56, 88, [-56, 0, 2, 56, 0, 56]),
  tipR: bp(112, 136, [-56, -2, -2, 56, 4, 4]), tipSkinR: bp(-56, 144, [-56, 0, 2, 56, 0, 56]),
  fLeg: bp(112, 104, [-4, -4, -4, 8, 24, 8]), fTip: bp(226, 138, [-3, -1, -3, 6, 24, 6]), fFoot: bp(144, 104, [-4, 0, -12, 8, 4, 16]),
  rLeg: bp(0, 0, [-8, -4, -8, 16, 32, 16]), rTip: bp(196, 0, [-6, -2, 0, 12, 32, 12]), rFoot: bp(112, 0, [-9, 0, -20, 18, 6, 24]),
};
function drawDragon(r, e, partial, camx, camy, camz, opts) {
  const sk = r.skinRect.ender_dragon; if (!sk) return;
  const a = e.deathTime > 0 ? 0 : partial, LP = o => e.latencyPos(o, a);
  const x = e.px + (e.x - e.px) * partial - camx, y = e.py + (e.y - e.py) * partial - camy, z = e.pz + (e.z - e.pz) * partial - camz;
  const S = _S; m4TranslateM(S.m, x, y, z); S.st.length = 0;
  // EnderDragonRenderer: yaw from the latency buffer, pitch from the recent climb; then the usual model flip (folded into the conversion)
  const f = LP(7)[0], fp = LP(5)[1] - LP(10)[1];
  S.mul(m4RotY(_q1, -f * DEG)).mul(m4RotX(_q1, fp * 10 * DEG)).tb(0, 0, 1).mul(m4RotY(_q1, Math.PI)).tb(0, 1.501, 0);
  const lt = e.lightAt(), flash = e.hurtTime > 0;
  const R = { S, sky: lt[0] / 15, blk: lt[1] / 15, cr: 1, cg: flash ? 0.45 : 1, cb: flash ? 0.45 : 1 };
  if (e.deathTime > 0) { const k = Math.min(1, e.deathTime / 200); R.cr = R.cg = R.cb = 1 + k * 1.5; }
  const flap = e.pflap + (e.flap - e.pflap) * partial;
  const jawX = (Math.sin(flap * TAU) + 1) * 0.2;
  let f1 = Math.sin(flap * TAU - 1) + 1; f1 = (f1 * f1 + f1 * 2) * 0.05;
  S.tb(0, -(f1 - 2), 3).rx(f1 * 2 * DEG);
  // the neck: five segments trailing the head through the latency buffer
  let px = 0, py = 20, pz = -12;
  const ad = LP(6), f6 = rotWrap(LP(5)[0] - LP(10)[0]), f7 = rotWrap(LP(5)[0] + f6 / 2), f8 = flap * TAU;
  for (let i = 0; i < 5; i++) {
    const ad1 = LP(5 - i), f9 = Math.cos(i * 0.45 + f8) * 0.15;
    const ry = rotWrap(ad1[0] - ad[0]) * DEG * 1.5, rx = f9 + e.headPartY(i, ad, ad1) * DEG * 1.5 * 5, rz = -rotWrap(ad1[0] - f7) * DEG * 1.5;
    S.push().part(px, py, pz, rx, ry, rz); boxOut(r, R, DRM.neck, sk); boxOut(r, R, DRM.neckScale, sk); S.pop();
    py += Math.sin(rx) * 10; pz -= Math.cos(ry) * Math.cos(rx) * 10; px -= Math.sin(ry) * Math.cos(rx) * 10;
  }
  const ad2 = LP(0);
  S.push().part(px, py, pz, rotWrap(e.headPartY(6, ad, ad2)) * DEG * 1.5 * 5, rotWrap(ad2[0] - ad[0]) * DEG, -rotWrap(ad2[0] - f7) * DEG);
  for (const b of [DRM.upperlip, DRM.upperhead, DRM.scaleL, DRM.nostrilL, DRM.scaleR, DRM.nostrilR]) boxOut(r, R, b, sk);
  S.push().part(0, 4, -8, jawX); boxOut(r, R, DRM.jaw, sk); S.pop();
  S.pop();
  // body, wings and legs (rolled with the turn)
  S.push().tb(0, -1, 0).rz(-f6 * 1.5 * DEG).tb(0, 1, 0);
  S.push().t(0, 4, 8); boxOut(r, R, DRM.body, sk); boxOut(r, R, DRM.bs1, sk); boxOut(r, R, DRM.bs2, sk); boxOut(r, R, DRM.bs3, sk); S.pop();
  const f10 = flap * TAU, wx = 0.125 - Math.cos(f10) * 0.2, wy = -0.25, wz = -(Math.sin(f10) + 0.125) * 0.8, tz = (Math.sin(f10 + 2) + 0.5) * 0.75;
  const side = (L) => {
    const sgn = L ? 1 : -1;
    S.push().part(12 * sgn, 5, 2, wx, L ? wy : -wy, L ? wz : -wz); boxOut(r, R, L ? DRM.wingL : DRM.wingR, sk); boxOut(r, R, L ? DRM.wingSkinL : DRM.wingSkinR, sk);
    S.push().part(56 * sgn, 0, 0, 0, 0, L ? tz : -tz); boxOut(r, R, L ? DRM.tipL : DRM.tipR, sk); boxOut(r, R, L ? DRM.tipSkinL : DRM.tipSkinR, sk); S.pop(); S.pop();
    S.push().part(12 * sgn, 20, 2, 1.3 + f1 * 0.1); boxOut(r, R, DRM.fLeg, sk); S.push().part(0, 20, -1, -0.5 - f1 * 0.1); boxOut(r, R, DRM.fTip, sk); S.push().part(0, 23, 0, 0.75 + f1 * 0.1); boxOut(r, R, DRM.fFoot, sk); S.pop(); S.pop(); S.pop();
    S.push().part(16 * sgn, 16, 42, 1 + f1 * 0.1); boxOut(r, R, DRM.rLeg, sk); S.push().part(0, 32, -4, 0.5 + f1 * 0.1); boxOut(r, R, DRM.rTip, sk); S.push().part(0, 31, 4, 0.75 + f1 * 0.1); boxOut(r, R, DRM.rFoot, sk); S.pop(); S.pop(); S.pop();
  };
  side(true); side(false);
  S.pop();
  // the tail: twelve segments
  let f11 = 0; px = 0; py = 10; pz = 60;
  const at = LP(11);
  for (let j = 0; j < 12; j++) {
    const a2 = LP(12 + j); f11 += Math.sin(j * 0.45 + f8) * 0.05;
    const ry = (rotWrap(a2[0] - at[0]) * 1.5 + 180) * DEG, rx = f11 + (a2[1] - at[1]) * DEG * 1.5 * 5, rz = rotWrap(a2[0] - f7) * DEG * 1.5;
    S.push().part(px, py, pz, rx, ry, rz); boxOut(r, R, DRM.neck, sk); boxOut(r, R, DRM.neckScale, sk); S.pop();
    py += Math.sin(rx) * 10; pz -= Math.cos(ry) * Math.cos(rx) * 10; px -= Math.sin(ry) * Math.cos(rx) * 10;
  }
}
MODELS.ender_dragon = { skin: 'ender_dragon', draw: drawDragon };

// ---------------------------------------------------------------- the dragon
class EnderDragon extends Mob {
  constructor(game, x, y, z, type) {
    super(game, x, y, z, type);
    this.myaw = 0; this.yRotA = 0; this.flap = 0; this.pflap = 0; this.ptr = -1; this.hist = []; for (let i = 0; i < 64; i++) this.hist.push([0, 0]);
    this.phase = 'holding'; this.ph = {}; this.target3 = null; this.inWall = false; this.growlT = 100; this.nearestCrystal = null; this.persist = true;
    this.sitDmg = 0; this.parts = []; this.beamDY = 1.5; this.clockwise = Math.random() < 0.5; this.node = -1; this.renderRadius = 20; this.renderDist = 256; this.flames = 0;
    for (const [n, w, h] of [['head', 1, 1], ['neck', 3, 3], ['body', 5, 3], ['tail1', 2, 2], ['tail2', 2, 2], ['tail3', 2, 2], ['wing1', 4, 2], ['wing2', 4, 2]]) this.parts.push({ name: n, w, h, x, y, z, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 });
    this.podY = game.podiumY ? game.podiumY() : 64;
    this.nodes = this.makeNodes();
    this.setPhase('holding');
    this.updateParts();
  }
  // DragonFight path nodes: 12 outer (r 60), 8 middle (r 40), 4 inner (r 20), above the terrain and the spikes
  makeNodes() {
    const g = this.game, seed = g.worldInfo ? g.worldInfo.seed : 0, sp = SH.endSpikes(seed), N = [];
    const top = (x, z) => { let t = SH.endTop(seed, x, z); for (const s of sp) if ((x - s.x) ** 2 + (z - s.z) ** 2 <= (s.r + 1) ** 2) t = Math.max(t, s.h + 1); return t; };
    for (let i = 0; i < 24; i++) {
      let j = 5, l, m;
      if (i < 12) { l = Math.floor(60 * Math.cos(2 * (-Math.PI + 0.2617994 * i))); m = Math.floor(60 * Math.sin(2 * (-Math.PI + 0.2617994 * i))); }
      else if (i < 20) { const k = i - 12; l = Math.floor(40 * Math.cos(2 * (-Math.PI + 0.3926991 * k))); m = Math.floor(40 * Math.sin(2 * (-Math.PI + 0.3926991 * k))); j += 10; }
      else { const k = i - 20; l = Math.floor(20 * Math.cos(2 * (-Math.PI + Math.PI / 4 * k))); m = Math.floor(20 * Math.sin(2 * (-Math.PI + Math.PI / 4 * k))); }
      N.push([l, Math.max(73, top(l, m) + j), m]);
    }
    return N;
  }
  closestNode(x, y, z, from, to) { let b = from || 0, bd = 1e18; for (let i = from || 0; i < (to || 24); i++) { const n = this.nodes[i], d = (n[0] - x) ** 2 + (n[1] - y) ** 2 + (n[2] - z) ** 2; if (d < bd) { bd = d; b = i; } } return b; }
  // getLatencyPos: [yaw, y] from the 64-tick history ring
  latencyPos(off, partial) {
    if (this.ptr < 0) return [this.myaw, this.y];
    const p = 1 - partial, i = (this.ptr - off) & 63, j = (this.ptr - off - 1) & 63;
    const d0 = this.hist[i][0], d1 = rotWrap(this.hist[j][0] - d0), d2 = this.hist[i][1], d3 = this.hist[j][1] - d2;
    return [d0 + d1 * p, d2 + d3 * p];
  }
  isSitting() { return this.phase === 'scanning' || this.phase === 'roar' || this.phase === 'flaming'; }
  headPartY(i, a, b) {
    if (this.phase === 'landing' || this.phase === 'takeoff') { const d = Math.max(Math.hypot(this.x, this.y - (this.podY + 4), this.z) / 4, 1); return i / d; }
    if (this.isSitting()) return i;
    return i === 6 ? 0 : b[1] - a[1];
  }
  setPhase(ph) {
    this.phase = ph; this.ph = { t: 0 }; this.target3 = null;
    const p = this.game.player;
    if (ph === 'holding') { this.node = this.closestNode(this.x, this.y, this.z, 0, 12); this.pickHoldingTarget(); }
    else if (ph === 'strafe') this.ph.charge = 0;
    else if (ph === 'approach') { this.node = this.closestNode(this.x, this.y, this.z, 20, 24); const n = this.nodes[this.node]; this.target3 = [n[0], n[1] + 4, n[2]]; }
    else if (ph === 'landing') this.target3 = [0.5, this.podY + 4, 0.5];
    else if (ph === 'takeoff') { const lx = Math.sin(this.myaw * DEG), lz = -Math.cos(this.myaw * DEG), k = this.closestNode(-lx * 40, 105, -lz * 40, 0, 12), n = this.nodes[k]; this.target3 = [n[0], n[1] + 10, n[2]]; }
    else if (ph === 'charge') { this.target3 = [p.x, p.y, p.z]; this.ph.since = 0; }
    else if (ph === 'dying') this.target3 = [0.5, this.podY + 4, 0.5];
  }
  pickHoldingTarget() { const n = this.nodes[this.node]; this.target3 = [n[0], n[1] + Math.random() * 20, n[2]]; }
  flySpeed() { return this.phase === 'landing' ? 1.5 : this.phase === 'charge' || this.phase === 'dying' ? 3 : 0.6; }
  turnSpeed() { const f = Math.hypot(this.vx, this.vz) + 1, f1 = Math.min(f, 40); return this.phase === 'landing' ? f1 / f : 0.7 / f1 / f; }
  // per-phase server tick (DragonPhaseInstance.doServerTick)
  phaseTick() {
    const g = this.game, p = g.player, E = g.worldInfo.end || {};
    const ph = this.ph; ph.t++;
    const playerOk = !p.dead && p.gameMode === 0;
    const d2t = this.target3 ? (this.target3[0] - this.x) ** 2 + (this.target3[1] - this.y) ** 2 + (this.target3[2] - this.z) ** 2 : 0;
    switch (this.phase) {
      case 'holding': {
        if (!this.target3 || d2t < 100 || d2t > 22500) {
          const alive = (E.crystals || []).reduce((s, v) => s + (v ? 1 : 0), 0);
          // DragonHoldingPatternPhase.findNewTarget: land, strafe the player, or keep circling
          if (Math.random() < 1 / (alive + 3)) { this.setPhase('approach'); return; }
          const dp = playerOk ? (p.x * p.x + p.z * p.z) / 512 : 64;
          if (playerOk && (Math.random() < 1 / (Math.abs(Math.floor(dp)) + 2) || Math.random() < 1 / (alive + 2))) { this.setPhase('strafe'); return; }
          this.node = (this.node + (this.clockwise ? 1 : 11)) % 12;
          if (Math.random() < 0.15) this.node = 12 + ((Math.random() * 8) | 0);
          this.pickHoldingTarget();
        }
        break;
      }
      case 'strafe': {
        if (!playerOk) { this.setPhase('holding'); return; }
        const dx = p.x - this.x, dz = p.z - this.z, d4 = Math.hypot(dx, dz), d5 = Math.min(0.4 + d4 / 80 - 1, 10);
        this.target3 = [p.x, p.y + d5, p.z];
        if ((p.x - this.x) ** 2 + (p.y - this.y) ** 2 + (p.z - this.z) ** 2 < 4096 && this.canSee(p)) {
          ph.charge++;
          const fx = Math.sin(this.myaw * DEG), fz = -Math.cos(this.myaw * DEG), l = d4 || 1, dot = (fx * dx + fz * dz) / l, ang = Math.acos(clamp(dot, -1, 1)) / DEG + 0.5;
          if (ph.charge >= 5 && ang < 10) {
            const hd = this.parts[0], sx = hd.x - fx, sy = hd.y + 1, sz = hd.z - fz;
            g.entities.push(new Fireball(g, sx, sy, sz, 'dragon', this, p.x - sx, p.y + 0.9 - sy, p.z - sz));
            g.sound('mob.enderdragon.shoot', this.x, this.y, this.z, 4, 1, 'mob.ghast.fireball');
            this.setPhase('holding'); return;
          }
        } else if (ph.charge > 0) ph.charge--;
        if (ph.t > 300) this.setPhase('holding');
        break;
      }
      case 'approach': if (d2t < 100 || ph.t > 400) this.setPhase('landing'); break;
      case 'landing':
        if (d2t < 1 || ph.t > 400) { if (ph.t > 400) { this.x = 0.5; this.z = 0.5; this.y = this.podY + 4; } this.vx = this.vy = this.vz = 0; this.setPhase('scanning'); }
        break;
      case 'scanning': {   // DragonSittingScanningPhase
        this.vx = this.vy = this.vz = 0;
        const near = playerOk && (p.x - this.x) ** 2 + (p.y - this.y) ** 2 + (p.z - this.z) ** 2 < 20 * 20;
        if (near) {
          if (ph.t > 25) { this.setPhase('roar'); return; }
          const hd = this.parts[0], d0 = p.x - hd.x, d1 = p.z - hd.z, dd = clamp(rotWrap(180 - Math.atan2(d0, d1) / DEG - this.myaw), -100, 100);
          this.yRotA *= 0.8; let f2 = Math.hypot(d0, d1) + 1; const f3 = f2; if (f2 > 40) f2 = 40;
          this.yRotA += dd * (0.7 / f2 / f3); this.myaw += this.yRotA;
        } else if (ph.t >= 100) {
          const far = playerOk && (p.x - this.x) ** 2 + (p.y - this.y) ** 2 + (p.z - this.z) ** 2 < 150 * 150;
          this.setPhase(far ? 'charge' : 'takeoff');
        }
        break;
      }
      case 'roar':   // DragonSittingAttackingPhase
        this.vx = this.vy = this.vz = 0;
        if (ph.t === 1) g.sound('mob.enderdragon.growl', this.x, this.y, this.z, 2.5, 0.8 + Math.random() * 0.3, 'mob.ghast.scream');
        if (ph.t >= 40) this.setPhase('flaming');
        break;
      case 'flaming': {   // DragonSittingFlamingPhase: breath on the ground in front of the head
        this.vx = this.vy = this.vz = 0;
        const hd = this.parts[0], vx = hd.x - this.x, vz = hd.z - this.z, l = Math.hypot(vx, vz) || 1;
        if (ph.t === 10) {
          const cx = hd.x + vx / l * 2.5, cz = hd.z + vz / l * 2.5; let cy = hd.y + 0.5;
          const w = this.world; while (cy > 1 && !T_SOLID[w.getBlock(Math.floor(cx), Math.floor(cy - 1), Math.floor(cz))]) cy--;
          g.entities.push(new BreathCloud(g, cx, cy, cz, 5, 200, this));
          g.sound('mob.enderdragon.growl', this.x, this.y, this.z, 2.5, 1, 'mob.ghast.scream');
        }
        if (ph.t >= 10 && ph.t < 200 && g.options.particles !== 0) for (let k = 0; k < 6; k++) g.particles.sprite('breath', hd.x + vx / l * 0.8, hd.y + 0.3, hd.z + vz / l * 0.8, 1, { size: 0.15, up: -0.05, vel: 0.1, life: 30, shrink: true, spread: 0.4, spreadY: 0.2, r: 0.75, g: 0.3, b: 0.9 });
        if (ph.t >= 200) { this.flames++; if (this.flames >= 4) { this.flames = 0; this.setPhase('takeoff'); } else this.setPhase('scanning'); }
        break;
      }
      case 'takeoff':
        if ((Math.hypot(this.x - 0.5, this.z - 0.5) > 10 && this.y > this.podY + 10) || ph.t > 300) this.setPhase('holding');
        break;
      case 'charge':
        if (ph.since > 0 && ph.since++ >= 10) { this.setPhase('holding'); return; }
        if (d2t < 100 || d2t > 22500) ph.since++;
        if (ph.t > 200) this.setPhase('holding');
        break;
      case 'dying':
        if (d2t < 100 || d2t > 22500 || ph.t > 400) this.startDeath();
        break;
    }
  }
  tick() {
    this.savePrev(); this.age++;
    const g = this.game;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invuln > 0) this.invuln--;
    this.pflap = this.flap;
    if (this.deathTime > 0) { this.deathTick(); this.updateParts(); return; }
    this.checkCrystals();
    // wing beat speed falls with speed and rises when climbing (EnderDragon.aiStep)
    const hs = Math.hypot(this.vx, this.vz);
    let f = 0.2 / (hs * 10 + 1); f *= Math.pow(2, this.vy);
    this.flap += this.isSitting() ? 0.1 : this.inWall ? f * 0.5 : f;
    const c1 = Math.cos(this.flap * TAU), c0 = Math.cos(this.pflap * TAU);
    if (c0 <= -0.3 && c1 >= -0.3) g.sound('mob.enderdragon.wings', this.x, this.y, this.z, 5, 0.8 + Math.random() * 0.3, 'mob.bat.takeoff');
    if (!this.isSitting() && --this.growlT < 0) { g.sound('mob.enderdragon.growl', this.x, this.y, this.z, 2.5, 0.8 + Math.random() * 0.3, 'mob.ghast.moan'); this.growlT = 200 + ((Math.random() * 200) | 0); }
    this.myaw = rotWrap(this.myaw);
    if (this.ptr < 0) for (const h of this.hist) { h[0] = this.myaw; h[1] = this.y; }
    if (++this.ptr === 64) this.ptr = 0;
    this.hist[this.ptr][0] = this.myaw; this.hist[this.ptr][1] = this.y;
    this.phaseTick();
    const T = this.target3;
    if (T && !this.isSitting()) {
      const d6 = T[0] - this.x, d8 = T[2] - this.z; let d7 = T[1] - this.y;
      const d3 = d6 * d6 + d7 * d7 + d8 * d8, f5 = this.flySpeed(), d4 = Math.hypot(d6, d8);
      if (d4 > 0) d7 = clamp(d7 / d4, -f5, f5);
      this.vy += d7 * 0.01;
      const d5 = clamp(rotWrap(180 - Math.atan2(d6, d8) / DEG - this.myaw), -50, 50);
      const tl = Math.sqrt(d3) || 1, tx = d6 / tl, ty = (T[1] - this.y) / tl, tz = d8 / tl;
      let fx = Math.sin(this.myaw * DEG), fy = this.vy, fz = -Math.cos(this.myaw * DEG); const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      const f6 = Math.max((fx * tx + fy * ty + fz * tz + 0.5) / 1.5, 0);
      this.yRotA *= 0.8; this.yRotA += d5 * this.turnSpeed(); this.myaw += this.yRotA * 0.1;
      const f7 = 2 / (d3 + 1), sp = 0.06 * (f6 * f7 + (1 - f7));
      this.vx += sp * Math.sin(this.myaw * DEG); this.vz += -sp * Math.cos(this.myaw * DEG);
      const k = this.inWall ? 0.8 : 1;
      this.x += this.vx * k; this.y += this.vy * k; this.z += this.vz * k;
      const ml = Math.hypot(this.vx, this.vy, this.vz) || 1, d9 = 0.8 + 0.15 * ((this.vx / ml * fx + this.vy / ml * fy + this.vz / ml * fz) + 1) / 2;
      this.vx *= d9; this.vy *= 0.91; this.vz *= d9;
    }
    if (this.y < 0) this.y = 0;
    this.bodyYaw = this.myaw * DEG + Math.PI;
    this.updateParts();
    // wings shove, head and neck bite (only in flight)
    if (this.hurtTime === 0 && !this.isSitting()) {
      for (const wi of [6, 7]) { const b = this.parts[wi]; this.shove(b.x0 - 4, b.y0 - 4, b.z0 - 4, b.x1 + 4, b.y1, b.z1 + 4, b); }
      for (const hi of [0, 1]) { const b = this.parts[hi]; this.bite(b.x0 - 1, b.y0 - 1, b.z0 - 1, b.x1 + 1, b.y1 + 1, b.z1 + 1); }
    }
    this.inWall = this.checkWalls(this.parts[0]) | this.checkWalls(this.parts[1]) | this.checkWalls(this.parts[2]);
    if (g.worldInfo.end) g.worldInfo.end.dragonHp = this.hp;
  }
  // part positions around the body (EnderDragon.aiStep tickPart calls)
  updateParts() {
    const P = this.parts, set = (pt, dx, dy, dz) => { pt.x = this.x + dx; pt.y = this.y + dy; pt.z = this.z + dz; pt.x0 = pt.x - pt.w / 2; pt.x1 = pt.x + pt.w / 2; pt.z0 = pt.z - pt.w / 2; pt.z1 = pt.z + pt.w / 2; pt.y0 = pt.y; pt.y1 = pt.y + pt.h; };
    const f12 = (this.latencyPos(5, 1)[1] - this.latencyPos(10, 1)[1]) * 10 * DEG, f13 = Math.cos(f12), f1 = Math.sin(f12);
    const f14 = this.myaw * DEG, f2 = Math.sin(f14), f15 = Math.cos(f14);
    set(P[2], f2 * 0.5, 0, -f15 * 0.5);
    set(P[6], f15 * 4.5, 2, f2 * 4.5); set(P[7], f15 * -4.5, 2, f2 * -4.5);
    const f3 = Math.sin(this.myaw * DEG - this.yRotA * 0.01), f16 = Math.cos(this.myaw * DEG - this.yRotA * 0.01), f4 = this.isSitting() ? -1 : this.latencyPos(5, 1)[1] - this.latencyPos(0, 1)[1];
    set(P[0], f3 * 6.5 * f13, f4 + f1 * 6.5, -f16 * 6.5 * f13);
    set(P[1], f3 * 5.5 * f13, f4 + f1 * 5.5, -f16 * 5.5 * f13);
    const a = this.latencyPos(5, 1);
    for (let k = 0; k < 3; k++) {
      const a1 = this.latencyPos(12 + k * 2, 1), f17 = this.myaw * DEG + rotWrap(a1[0] - a[0]) * DEG, f18 = Math.sin(f17), f20 = Math.cos(f17), f22 = (k + 1) * 2;
      set(P[3 + k], -(f2 * 1.5 + f18 * f22) * f13, a1[1] - a[1] - (f22 + 1.5) * f1 + 1.5, (f15 * 1.5 + f20 * f22) * f13);
    }
  }
  shove(x0, y0, z0, x1, y1, z1, wing) {
    const g = this.game, p = g.player;
    for (const e of [p].concat(g.entities.filter(q => q.isMob && q !== this && !q.dead && q.type !== 'end_crystal'))) {
      if (!e || e.dead || (e === p && p.gameMode !== 0)) continue;
      if (e.x < x0 || e.x > x1 || e.z < z0 || e.z > z1 || e.y + e.h < y0 || e.y > y1) continue;
      const d0 = e.x - (wing.x0 + wing.x1) / 2, d1 = e.z - (wing.z0 + wing.z1) / 2, d2 = Math.max(d0 * d0 + d1 * d1, 0.1);
      e.vx += d0 / d2 * 4; e.vy += 0.2; e.vz += d1 / d2 * 4;
      if (!(e.lastDragonHit > this.age - 2)) { e.lastDragonHit = this.age; e.hurt(5, this, 'mob', null); }
    }
  }
  bite(x0, y0, z0, x1, y1, z1) {
    const g = this.game, p = g.player;
    for (const e of [p].concat(g.entities.filter(q => q.isMob && q !== this && !q.dead && q.type !== 'end_crystal'))) {
      if (!e || e.dead || (e === p && p.gameMode !== 0)) continue;
      if (e.x + e.w / 2 < x0 || e.x - e.w / 2 > x1 || e.z + e.w / 2 < z0 || e.z - e.w / 2 > z1 || e.y + e.h < y0 || e.y > y1) continue;
      e.hurt(10, this, 'mob', null);
    }
  }
  // EnderDragon.checkWalls: plough through anything that is not dragon-proof
  checkWalls(b) {
    const w = this.world; let blocked = false, broke = false;
    for (let x = Math.floor(b.x0); x <= Math.floor(b.x1); x++) for (let y = Math.floor(b.y0); y <= Math.floor(b.y1); y++) for (let z = Math.floor(b.z0); z <= Math.floor(b.z1); z++) {
      const id = w.getBlock(x, y, z); if (!id || T_FLUID[id]) continue;
      if (DRAGON_IMMUNE.has(BLOCKS[id].name) || id === BID.soul_fire) { if (id !== BID.fire) blocked = true; continue; }
      if (w.isLoaded(x, z)) { w.setBlock(x, y, z, 0, 0, 2); broke = true; }
    }
    if (broke) this.game.addParticles('explosion', b.x0 + Math.random() * (b.x1 - b.x0), b.y0 + Math.random() * (b.y1 - b.y0), b.z0 + Math.random() * (b.z1 - b.z0), 1);
    return blocked;
  }
  checkCrystals() {
    const c = this.nearestCrystal;
    if (c) { if (c.dead) { this.nearestCrystal = null; c.beamTarget = null; } else if (this.age % 10 === 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 1); }
    if (Math.random() < 0.1) {
      let best = null, bd = 1e18;
      for (const e of this.game.entities) { if (e.type !== 'end_crystal' || e.dead) continue; if (Math.abs(e.x - this.x) > 40 || Math.abs(e.y - this.y) > 36 || Math.abs(e.z - this.z) > 40) continue; const d = (e.x - this.x) ** 2 + (e.y - this.y) ** 2 + (e.z - this.z) ** 2; if (d < bd) { bd = d; best = e; } }
      if (this.nearestCrystal && this.nearestCrystal !== best) this.nearestCrystal.beamTarget = null;
      this.nearestCrystal = best; if (best) best.beamTarget = this;
    }
  }
  onCrystalDestroyed(crystal, src) {
    if (crystal === this.nearestCrystal) { this.nearestCrystal = null; this.invuln = 0; this.hurtPart(this.parts[0], 10, src && src === this.game.player ? src : null, 'explosion'); }
    if (this.phase === 'holding') this.clockwise = !this.clockwise;
  }
  hurt(amount, src, kind) { if (kind === 'fire' || kind === 'lava') return false; return this.hurtPart(this.parts[2], amount, src, kind); }
  // EnderDragon.hurt(part, ...): the head takes full damage, everything else a quarter (+1)
  hurtPart(part, amount, src, kind) {
    if (this.deathTime > 0 || this.phase === 'dying' || this.dead) return false;
    if (this.isSitting() && kind === 'projectile') return false;   // arrows bounce off a perched dragon
    if (part !== this.parts[0]) amount = amount / 4 + Math.min(amount, 1);
    if (amount < 0.01) return false;
    if (this.invuln > 10) { if (amount <= (this.lastDmg || 0)) return false; const full = amount; amount -= this.lastDmg || 0; this.lastDmg = full; } else { this.invuln = 20; this.lastDmg = amount; }
    const before = this.hp;
    this.hp -= amount; this.hurtTime = 10;
    this.game.sound('mob.enderdragon.hit', this.x, this.y, this.z, 5, 0.8 + Math.random() * 0.4, 'mob.generic.hurt');
    if (this.hp <= 0) { this.hp = 1; this.setPhase('dying'); this.killer = src; return true; }
    if (this.isSitting()) { this.sitDmg += before - this.hp; if (this.sitDmg > 0.25 * this.maxHp) { this.sitDmg = 0; this.setPhase('takeoff'); } }
    return true;
  }
  startDeath() {
    if (this.deathTime > 0) return;
    this.deathTime = 1; this.vx = this.vy = this.vz = 0; this.hp = 0;
    this.game.sound('mob.enderdragon.end', this.x, this.y, this.z, 5, 1, 'mob.enderdragon.growl');
    if (this.nearestCrystal) this.nearestCrystal.beamTarget = null;
  }
  // EnderDragon.tickDeath: 200 ticks of rising, spinning, exploding light; XP rains down; then the exit portal opens
  deathTick() {
    const g = this.game, E = g.endState(), total = E.everKilled ? 500 : 12000;
    this.deathTime++;
    if (this.deathTime >= 180 && this.deathTime <= 200) for (let i = 0; i < 2; i++) g.addParticles('explosion', this.x + (Math.random() - 0.5) * 8, this.y + 2 + (Math.random() - 0.5) * 4, this.z + (Math.random() - 0.5) * 8, 1);
    if (this.deathTime > 150 && this.deathTime % 5 === 0) this.dropXP(Math.floor(total * 0.08));
    this.y += 0.1; this.myaw += 20; this.bodyYaw = this.myaw * DEG + Math.PI;
    if (++this.ptr === 64) this.ptr = 0; this.hist[this.ptr][0] = this.myaw; this.hist[this.ptr][1] = this.y;
    if (this.deathTime >= 200) { this.dropXP(Math.floor(total * 0.2)); this.dead = true; g.onDragonKilled(this); }
  }
  dropXP(n) {
    const g = this.game, p = g.player;
    while (n > 0) { const v = n > 2477 ? 2477 : n > 1237 ? 1237 : n > 617 ? 617 : n > 307 ? 307 : n > 149 ? 149 : n > 73 ? 73 : n > 37 ? 37 : n > 17 ? 17 : n > 7 ? 7 : n > 3 ? 3 : 1; n -= v; const o = new XPOrb(g, this.x, this.y, this.z, v); o.vx = (Math.random() - 0.5) * 0.6; o.vz = (Math.random() - 0.5) * 0.6; g.entities.push(o); }
  }
  lightAt() { const w = this.world, x = Math.floor(this.x), y = Math.floor(this.y + 2), z = Math.floor(this.z); return [w.getSky(x, y, z), w.getBlk(x, y, z)]; }
  die() { }
  physics() { }
  // light rays of the death animation (EnderDragonRenderer)
  renderSelfExtra(game, partial, cx, cy, cz) {
    if (this.deathTime <= 0) return;
    const r = game.renderer, b = r.bAlpha, tile = r.TILE.white, f5 = (this.deathTime + partial) / 200, f7 = Math.min(f5 > 0.8 ? (f5 - 0.8) / 0.2 : 0, 1);
    const rng = mulberry32(432), n = Math.floor((f5 + f5 * f5) / 2 * 60), ox = this.px + (this.x - this.px) * partial - cx, oy = this.py + (this.y - this.py) * partial - cy + 2, oz = this.pz + (this.z - this.pz) * partial - cz;
    for (let i = 0; i < n; i++) {
      const a1 = rng() * TAU, a2 = rng() * TAU, a3 = rng() * TAU, len = (rng() * 20 + 5 + f7 * 10) * 0.6, wd = (rng() * 2 + 1 + f7 * 2) * 0.3;
      const dx = Math.cos(a1) * Math.sin(a2 + f5 * 0.9), dy = Math.cos(a2 + a3 * 0.3), dz = Math.sin(a1) * Math.sin(a2 + f5 * 0.9), l = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / l, uy = dy / l, uz = dz / l, mx = ox + ux * len / 2, my = oy + uy * len / 2, mz = oz + uz * len / 2;
      let rx = uy * mz - uz * my, ry = uz * mx - ux * mz, rz = ux * my - uy * mx; const rl = Math.hypot(rx, ry, rz) || 1; rx = rx / rl * wd; ry = ry / rl * wd; rz = rz / rl * wd;
      b.billboard(mx, my, mz, rx, ry, rz, ux * len / 2, uy * len / 2, uz * len / 2, tile, 0, 0, 1, 1, 1, 0.55, 1, 0.45 * (1 - f7), 1, 1);
    }
  }
}
MOB_CLASSES.ender_dragon = EnderDragon;
