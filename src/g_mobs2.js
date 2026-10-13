// ===== g_mobs2.js : mobs of the dimensions update - hierarchical models (MC 1.16 geometry), AI, fireballs =====
// Models are drawn with a matrix stack in Minecraft model space: pixels, y down, front = -z (converted like ModelPart does).

// ---------------------------------------------------------------- matrix stack + model helpers
const _q1 = new Float32Array(16), _q2 = new Float32Array(16);
class MStack {
  constructor() { this.m = m4(); this.st = []; }
  load(M) { this.m.set(M); this.st.length = 0; return this; }
  push() { this.st.push(new Float32Array(this.m)); return this; }
  pop() { this.m = this.st.pop(); return this; }
  mul(B) { m4Mul(_q2, this.m, B); this.m.set(_q2); return this; }
  t(x, y, z) { return this.mul(m4TranslateM(_q1, x / 16, -y / 16, -z / 16)); }     // MC pixels
  tb(x, y, z) { return this.mul(m4TranslateM(_q1, x, y, z)); }                        // blocks, world axes
  rx(a) { return a ? this.mul(m4RotX(_q1, a)) : this; }
  ry(a) { return a ? this.mul(m4RotY(_q1, -a)) : this; }
  rz(a) { return a ? this.mul(m4RotZ(_q1, -a)) : this; }
  s(x, y, z) { return this.mul(m4Scale(_q1, x, y === undefined ? x : y, z === undefined ? x : z)); }
  // ModelPart.translateAndRotate: move to the pivot, then rotate Z, Y, X
  part(px, py, pz, rx, ry, rz) { return this.t(px, py, pz).rz(rz || 0).ry(ry || 0).rx(rx || 0); }
}
// a box in MC model coordinates whose pivot is the current matrix
const bp = (u, v, box, o) => new ModelPart('', [u, v], box, [0, 24, 0], o);
const _S = new MStack();
// common root: position, body yaw, death fall, scale, the 24px model origin; light and the red hurt tint
function mobRoot(ent, partial, camx, camy, camz, opts, scale) {
  const x = ent.px + (ent.x - ent.px) * partial - camx, y = ent.py + (ent.y - ent.py) * partial - camy, z = ent.pz + (ent.z - ent.pz) * partial - camz;
  const yaw = lerpAngle(ent.pbodyYaw === undefined ? ent.yaw : ent.pbodyYaw, ent.bodyYaw === undefined ? ent.yaw : ent.bodyYaw, partial);
  const S = _S; m4TranslateM(S.m, x, y, z); S.st.length = 0; S.ry(yaw);
  if (ent.deathTime > 0 && !opts.noDeathRot) { const d = Math.min(1, Math.sqrt((ent.deathTime + partial - 1) / 20 * 1.6)); S.mul(m4RotZ(_q1, d * HALF_PI)); }
  const sc = (opts.scale || 1) * (scale || 1); if (sc !== 1) S.s(sc);
  S.tb(0, 1.5, 0);
  const lt = ent.lightAt ? ent.lightAt() : [15, 0];
  let sky = lt[0] / 15, blk = lt[1] / 15; if (opts.fullbright || ent.def && ent.def.bright) { sky = 1; blk = 1; }
  const flash = ent.hurtTime > 0 || ent.deathTime > 0;
  return { S, sky, blk, cr: 1, cg: flash ? 0.45 : 1, cb: flash ? 0.45 : 1 };
}
function boxOut(r, R, part, skin, batch, tint) {
  if (!skin) return;
  const t = tint || null;
  emitPart(batch || r.bSkin, part, 0, 0, 0, 0, 0, 0, R.S.m, skin, R.cr * (t ? t[0] : 1), R.cg * (t ? t[1] : 1), R.cb * (t ? t[2] : 1), 1, R.sky, R.blk);
}
const triWave = (f, g) => (Math.abs(f % g - g * 0.5) - g * 0.25) / (g * 0.25);

// ---------------------------------------------------------------- definitions
Object.assign(MOB_DEFS, {
  villager: { w: 0.6, h: 1.95, hp: 20, speed: 0.115, model: 'villager', passive: true, villager: true, chunkSave: true, snd: 'villager', xp: [0, 0], say: 'mob.villager.idle', hurtSnd: 'mob.villager.hurt', deathSnd: 'mob.villager.death' },
  iron_golem: { w: 1.4, h: 2.7, hp: 100, speed: 0.1, model: 'iron_golem', golem: true, chunkSave: true, snd: 'irongolem', xp: [0, 0], say: null, hurtSnd: 'mob.irongolem.hit', deathSnd: 'mob.irongolem.death', loot: [['iron_ingot', 3, 5], ['poppy', 0, 2]] },
  snow_golem: { w: 0.7, h: 1.9, hp: 4, speed: 0.1, model: 'snow_golem', golem: true, snd: 'snowgolem', xp: [0, 0], say: null, hurtSnd: 'mob.snowgolem.hurt', deathSnd: 'mob.snowgolem.death', loot: [['snowball', 0, 15]] },
  ghast: { w: 4, h: 4, hp: 10, speed: 0, model: 'ghast', hostile: true, flying: true, fireImmune: true, snd: 'ghast', xp: [5, 5], say: 'mob.ghast.moan', hurtSnd: 'mob.ghast.scream', deathSnd: 'mob.ghast.death', loot: [['ghast_tear', 0, 1], ['gunpowder', 0, 2]], follow: 64 },
  blaze: { w: 0.6, h: 1.8, hp: 20, speed: 0.115, model: 'blaze', hostile: true, fireImmune: true, bright: true, snd: 'blaze', xp: [10, 10], say: 'mob.blaze.breathe', hurtSnd: 'mob.blaze.hit', deathSnd: 'mob.blaze.death', loot: [['blaze_rod', 0, 1]], follow: 48 },
  zombified_piglin: { w: 0.6, h: 1.95, hp: 20, speed: 0.115, model: 'zombified_piglin', hostile: true, neutral: true, fireImmune: true, snd: 'zpig', xp: [5, 5], say: 'mob.zpig.zpig', hurtSnd: 'mob.zpig.zpighurt', deathSnd: 'mob.zpig.zpigdeath', loot: [['rotten_flesh', 0, 1], ['gold_nugget', 0, 1], ['gold_ingot', 1, 1, 0.025]], follow: 35, dmg: 5 },
  piglin: { w: 0.6, h: 1.95, hp: 16, speed: 0.175, model: 'piglin', hostile: true, snd: 'piglin', xp: [5, 5], say: 'mob.piglin.idle', hurtSnd: 'mob.piglin.hurt', deathSnd: 'mob.piglin.death', follow: 16, dmg: 5 },
  hoglin: { w: 1.4, h: 1.4, hp: 40, speed: 0.15, model: 'hoglin', hostile: true, snd: 'hoglin', xp: [5, 5], say: 'mob.hoglin.idle', hurtSnd: 'mob.hoglin.hurt', deathSnd: 'mob.hoglin.death', loot: [['porkchop', 2, 4, 1, 'cooked_porkchop'], ['leather', 0, 1]], follow: 16, dmg: 6, breed: ['crimson_fungus'] },
  strider: { w: 0.9, h: 1.7, hp: 20, speed: 0.1, model: 'strider', passive: true, fireImmune: true, snd: 'strider', xp: [1, 3], say: 'mob.strider.idle', hurtSnd: 'mob.strider.hurt', deathSnd: 'mob.strider.death', loot: [['string', 2, 5]], breed: ['warped_fungus'] },
  magma_cube: { w: 0.51, h: 0.51, hp: 1, speed: 0, model: 'magma_cube', hostile: true, fireImmune: true, bright: true, snd: 'magmacube', xp: [1, 1], say: null, hurtSnd: 'mob.magmacube.small', deathSnd: 'mob.magmacube.small', follow: 16 },
  wither_skeleton: { w: 0.7, h: 2.4, hp: 20, speed: 0.125, model: 'wither_skeleton', hostile: true, fireImmune: true, snd: 'skeleton', xp: [5, 5], say: 'mob.skeleton.say', hurtSnd: 'mob.skeleton.hurt', deathSnd: 'mob.skeleton.death', loot: [['coal', 0, 1], ['bone', 0, 2]], follow: 16, dmg: 8 },
  silverfish: { w: 0.4, h: 0.3, hp: 8, speed: 0.25, model: 'silverfish', hostile: true, snd: 'silverfish', xp: [5, 5], say: 'mob.silverfish.say', hurtSnd: 'mob.silverfish.hit', deathSnd: 'mob.silverfish.kill', follow: 16, dmg: 1 },
  end_crystal: { w: 2, h: 2, hp: 1, speed: 0, model: 'end_crystal', crystal: true, bright: true, snd: 'crystal', xp: [0, 0], say: null, hurtSnd: null, deathSnd: null },
});
MOB_DEFS.zombie.huntsVillagers = true;
MODELS.wither_skeleton = { skin: 'wither_skeleton', parts: skeletonParts(), kind: 'skeleton' };

// ---------------------------------------------------------------- villager (VillagerModel, 64x64): biome robe + profession layer
const VM = {
  head: bp(0, 0, [-4, -10, -4, 8, 10, 8]), hat: bp(32, 0, [-4, -10, -4, 8, 10, 8], { inflate: 0.5 }), rim: bp(30, 47, [-8, -8, -6, 16, 16, 1]), nose: bp(24, 0, [-1, -1, -6, 2, 4, 2]),
  body: bp(16, 20, [-4, 0, -3, 8, 12, 6]), jacket: bp(0, 38, [-4, 0, -3, 8, 18, 6], { inflate: 0.5 }),
  armR: bp(44, 22, [-8, -2, -2, 4, 8, 4]), armL: bp(44, 22, [4, -2, -2, 4, 8, 4], { mirror: true }), armM: bp(40, 38, [-4, 2, -2, 8, 4, 4]),
  legR: bp(0, 22, [-2, 0, -2, 4, 12, 4]), legL: bp(0, 22, [-2, 0, -2, 4, 12, 4], { mirror: true }),
};
function drawVillager(r, e, partial, camx, camy, camz, opts) {
  const R = mobRoot(e, partial, camx, camy, camz, opts, e.isBaby ? 0.5 : 0.9375), S = R.S;
  const age = e.age + partial, L = e.limbPos, A = e.limbAmt;
  let hx = e.headPitchRel || 0, hy = e.headYawRel || 0, hz = 0;
  if (e.unhappyT > 0) { hz = 0.3 * Math.sin(0.45 * age); hx = 0.4; }
  const skins = [r.skinRect['villager_' + (e.vtype || 'plains')], e.prof && e.prof !== 'none' ? r.skinRect['villager_prof_' + e.prof] : null];
  const sleeping = e.sleeping;
  // lying in bed: rotate about the feet so the head points along -z, centred on the entity
  if (sleeping) S.tb(0, -1.5, 0).tb(0, 0.15, 0.95).rx(-HALF_PI).tb(0, 1.5, 0);
  for (let k = 0; k < 2; k++) {
    const sk = skins[k]; if (!sk) continue;
    S.push().part(0, 0, 0, sleeping ? 0 : hx, sleeping ? 0 : hy, hz); boxOut(r, R, VM.head, sk); if (k) { boxOut(r, R, VM.hat, sk); S.push().rx(-HALF_PI); boxOut(r, R, VM.rim, sk); S.pop(); } S.push().t(0, -2, 0); boxOut(r, R, VM.nose, sk); S.pop(); S.pop();
    boxOut(r, R, VM.body, sk); boxOut(r, R, VM.jacket, sk);
    S.push().part(0, 3, -1, -0.75, 0, 0); boxOut(r, R, VM.armR, sk); boxOut(r, R, VM.armL, sk); boxOut(r, R, VM.armM, sk); S.pop();
    const lr = Math.cos(L * 0.6662) * 1.4 * A * 0.5, ll = Math.cos(L * 0.6662 + Math.PI) * 1.4 * A * 0.5;
    S.push().part(-2, 12, 0, sleeping ? 0 : lr); boxOut(r, R, VM.legR, sk); S.pop();
    S.push().part(2, 12, 0, sleeping ? 0 : ll); boxOut(r, R, VM.legL, sk); S.pop();
  }
}
MODELS.villager = { skin: 'villager_plains', draw: drawVillager };

// ---------------------------------------------------------------- iron golem (IronGolemModel, 128x128)
const IGM = {
  head: bp(0, 0, [-4, -12, -5.5, 8, 10, 8]), nose: bp(24, 0, [-1, -5, -7.5, 2, 4, 2]), body: bp(0, 40, [-9, -2, -6, 18, 12, 11]), waist: bp(0, 70, [-4.5, 10, -3, 9, 5, 6], { inflate: 0.5 }),
  armR: bp(60, 21, [-13, -2.5, -3, 4, 30, 6]), armL: bp(60, 58, [9, -2.5, -3, 4, 30, 6]), legR: bp(37, 0, [-3.5, -3, -3, 6, 16, 5]), legL: bp(60, 0, [-3.5, -3, -3, 6, 16, 5], { mirror: true }),
};
function drawIronGolem(r, e, partial, camx, camy, camz, opts) {
  const R = mobRoot(e, partial, camx, camy, camz, opts), S = R.S, sk = r.skinRect.iron_golem, L = e.limbPos * 0.6, A = e.limbAmt;
  // cracks darken the iron as it loses health (IronGolemCrackinessLayer)
  const hpf = e.hp / e.maxHp, crack = hpf < 0.25 ? 0.72 : hpf < 0.5 ? 0.82 : hpf < 0.75 ? 0.91 : 1, tint = [crack, crack, crack];
  S.push().part(0, -7, -2, e.headPitchRel || 0, e.headYawRel || 0); boxOut(r, R, IGM.head, sk, null, tint); boxOut(r, R, IGM.nose, sk, null, tint); S.pop();
  S.push().t(0, -7, 0); boxOut(r, R, IGM.body, sk, null, tint); boxOut(r, R, IGM.waist, sk, null, tint); S.pop();
  let a0, a1;
  if (e.attackAnim > 0) { const i = e.attackAnim - partial; a0 = a1 = -2 + 1.5 * triWave(i, 10); }
  else if (e.flowerT > 0) { a0 = -0.8 + 0.025 * triWave(e.flowerT, 70); a1 = 0; }
  else { a0 = (-0.2 + 1.5 * triWave(L, 13)) * A; a1 = (-0.2 - 1.5 * triWave(L, 13)) * A; }
  S.push().part(0, -7, 0, a0); boxOut(r, R, IGM.armR, sk, null, tint);
  if (e.flowerT > 0 && typeof IID !== 'undefined' && IID.poppy !== undefined) drawHeld(r, R, S, IID.poppy, false, [-11, 27, -1]);
  S.pop();
  S.push().part(0, -7, 0, a1); boxOut(r, R, IGM.armL, sk, null, tint); S.pop();
  S.push().part(-4, 11, 0, -1.5 * triWave(L, 13) * A); boxOut(r, R, IGM.legR, sk, null, tint); S.pop();
  S.push().part(5, 11, 0, 1.5 * triWave(L, 13) * A); boxOut(r, R, IGM.legL, sk, null, tint); S.pop();
}
MODELS.iron_golem = { skin: 'iron_golem', draw: drawIronGolem };

// ---------------------------------------------------------------- snow golem (SnowGolemModel, 64x64)
const SGM = { head: bp(0, 0, [-4, -8, -4, 8, 8, 8], { inflate: -0.5 }), arm: bp(32, 0, [-1, 0, -1, 12, 2, 2], { inflate: -0.5 }), upper: bp(0, 16, [-5, -10, -5, 10, 10, 10], { inflate: -0.5 }), lower: bp(0, 36, [-6, -12, -6, 12, 12, 12], { inflate: -0.5 }) };
function drawSnowGolem(r, e, partial, camx, camy, camz, opts) {
  const R = mobRoot(e, partial, camx, camy, camz, opts), S = R.S, sk = r.skinRect.snow_golem;
  const hy = e.headYawRel || 0, ub = hy * 0.25, f = Math.sin(ub), f1 = Math.cos(ub);
  S.push().part(0, 4, 0, e.headPitchRel || 0, hy); boxOut(r, R, SGM.head, sk); S.pop();
  S.push().part(0, 13, 0, 0, ub); boxOut(r, R, SGM.upper, sk); S.pop();
  S.push().part(f1 * 5, 6, -f * 5, 0, ub, 1); boxOut(r, R, SGM.arm, sk); S.pop();
  S.push().part(-f1 * 5, 6, f * 5, 0, Math.PI + ub, -1); boxOut(r, R, SGM.arm, sk); S.pop();
  S.push().t(0, 24, 0); boxOut(r, R, SGM.lower, sk); S.pop();
}
MODELS.snow_golem = { skin: 'snow_golem', draw: drawSnowGolem };

// ---------------------------------------------------------------- ghast (GhastModel 64x32, rendered x4.5); tentacle lengths from java.util.Random(1660)
const GHM = { body: bp(0, 0, [-8, -8, -8, 16, 16, 16]), tent: [8, 13, 9, 11, 11, 10, 12, 9, 12].map(n => bp(0, 0, [-1, 0, -1, 2, n, 2])) };
function drawGhast(r, e, partial, camx, camy, camz, opts) {
  const R = mobRoot(e, partial, camx, camy, camz, opts, 4.5), S = R.S, sk = r.skinRect[e.charging ? 'ghast_shooting' : 'ghast'], age = e.age + partial;
  S.push().t(0, 17.6, 0); boxOut(r, R, GHM.body, sk); S.pop();
  for (let i = 0; i < 9; i++) {
    const fx = (((i % 3) - (Math.floor(i / 3) % 2) * 0.5 + 0.25) / 2 * 2 - 1) * 5, fz = (Math.floor(i / 3) / 2 * 2 - 1) * 5;
    S.push().part(fx, 24.6, fz, 0.2 * Math.sin(age * 0.3 + i) + 0.4); boxOut(r, R, GHM.tent[i], sk); S.pop();
  }
}
MODELS.ghast = { skin: 'ghast', draw: drawGhast };

// ---------------------------------------------------------------- blaze (BlazeModel 64x32): head and three rings of rods
const BZM = { head: bp(0, 0, [-4, -4, -4, 8, 8, 8]), rod: bp(0, 16, [0, 0, 0, 2, 8, 2]) };
function drawBlaze(r, e, partial, camx, camy, camz, opts) {
  const R = mobRoot(e, partial, camx, camy, camz, opts), S = R.S, sk = r.skinRect.blaze, a = e.age + partial;
  let f = a * Math.PI * -0.1;
  for (let i = 0; i < 4; i++) { S.push().t(Math.cos(f) * 9, -2 + Math.cos((i * 2 + a) * 0.25), Math.sin(f) * 9); boxOut(r, R, BZM.rod, sk); S.pop(); f++; }
  f = Math.PI / 4 + a * Math.PI * 0.03;
  for (let j = 4; j < 8; j++) { S.push().t(Math.cos(f) * 7, 2 + Math.cos((j * 2 + a) * 0.25), Math.sin(f) * 7); boxOut(r, R, BZM.rod, sk); S.pop(); f++; }
  f = 0.47123894 + a * Math.PI * -0.05;
  for (let k = 8; k < 12; k++) { S.push().t(Math.cos(f) * 5, 11 + Math.cos((k * 1.5 + a) * 0.5), Math.sin(f) * 5); boxOut(r, R, BZM.rod, sk); S.pop(); f++; }
  S.push().part(0, 0, 0, e.headPitchRel || 0, e.headYawRel || 0); boxOut(r, R, BZM.head, sk); S.pop();
}
MODELS.blaze = { skin: 'blaze', draw: drawBlaze };

// ---------------------------------------------------------------- piglins (PiglinModel = player model with a wide snout head and floppy ears)
const PGM = {
  head: bp(0, 0, [-5, -8, -4, 10, 8, 8]), snout: bp(31, 1, [-2, -4, -5, 4, 4, 1]), tusk1: bp(2, 4, [2, -2, -5, 1, 2, 1]), tusk2: bp(2, 0, [-3, -2, -5, 1, 2, 1]),
  earA: bp(51, 6, [0, 0, -2, 1, 5, 4]), earB: bp(39, 6, [-1, 0, -2, 1, 5, 4]),
  body: bp(16, 16, [-4, 0, -2, 8, 12, 4]), armR: bp(40, 16, [-3, -2, -2, 4, 12, 4]), armL: bp(32, 48, [-1, -2, -2, 4, 12, 4]), legR: bp(0, 16, [-2, 0, -2, 4, 12, 4]), legL: bp(16, 48, [-2, 0, -2, 4, 12, 4]),
};
function drawPiglin(r, e, partial, camx, camy, camz, opts) {
  const R = mobRoot(e, partial, camx, camy, camz, opts), S = R.S, sk = r.skinRect[e.type], age = e.age + partial, L = e.limbPos, A = e.limbAmt;
  let hx = e.headPitchRel || 0, hy = e.headYawRel || 0;
  const f1 = age * 0.1 + L * 0.5, f2 = 0.08 + A * 0.4;
  let ar = Math.cos(L * 0.6662 + Math.PI) * A, al = Math.cos(L * 0.6662) * A, ary = 0, aly = 0;
  const angry = e.type === 'zombified_piglin' ? e.angerT > 0 : !!e.target;
  if (e.admireT > 0) { al = -0.9; aly = 0.5; hx = 0.5; hy = 0; }
  else if (angry) {   // AnimationUtils.animateZombieArms / swinging a sword
    const sw = e.swingProgress || 0, s1 = Math.sin(sw * Math.PI), s2 = Math.sin((1 - (1 - sw) * (1 - sw)) * Math.PI);
    if (e.type === 'zombified_piglin') { ar = -HALF_PI - s1 * 1.2 + s2 * 0.4; al = -HALF_PI - s1 * 1.2 + s2 * 0.4; ary = -(0.1 - s1 * 0.6); aly = 0.1 - s1 * 0.6; }
    else { ar = -1.2 - s1 * 1.2; ary = -0.2; }
  }
  const bob = Math.cos(age * 0.09) * 0.05 + 0.05;
  S.push().part(0, 0, 0, hx, hy);
  boxOut(r, R, PGM.head, sk); boxOut(r, R, PGM.snout, sk); boxOut(r, R, PGM.tusk1, sk); boxOut(r, R, PGM.tusk2, sk);
  S.push().part(4.5, -6, 0, 0, 0, Math.PI / 6 + Math.cos(f1) * f2); boxOut(r, R, PGM.earA, sk); S.pop();
  S.push().part(-4.5, -6, 0, 0, 0, -Math.PI / 6 - Math.cos(f1 * 1.2) * f2); boxOut(r, R, PGM.earB, sk); S.pop();
  S.pop();
  boxOut(r, R, PGM.body, sk);
  S.push().part(-5, 2, 0, ar, ary, bob); boxOut(r, R, PGM.armR, sk); if (e.heldItem !== undefined && e.heldItem !== null) drawHeld(r, R, S, e.heldItem, false); S.pop();
  S.push().part(5, 2, 0, al, aly, -bob); boxOut(r, R, PGM.armL, sk); if (e.admireT > 0) drawHeld(r, R, S, IID.gold_ingot, true); S.pop();
  S.push().part(-1.9, 12, 0, Math.cos(L * 0.6662) * 1.4 * A); boxOut(r, R, PGM.legR, sk); S.pop();
  S.push().part(1.9, 12, 0, Math.cos(L * 0.6662 + Math.PI) * 1.4 * A); boxOut(r, R, PGM.legL, sk); S.pop();
}
// an item held at the end of the current arm matrix (ItemInHandLayer with a simplified display transform)
function drawHeld(r, R, S, id, left, at) {
  if (id === undefined || id === null || !ITEMS[id]) return;
  S.push(); if (at) S.t(at[0], at[1], at[2]); else S.t(left ? 1 : -1, 10, -1);
  const mesh = r.itemMesh(id), M = new Float32Array(S.m);
  // hand-held tools point forward and up, blocks sit small in the palm
  const T = m4();
  if (mesh.sprite) { m4Mul(_q2, M, m4RotX(_q1, -HALF_PI * 0.6)); M.set(_q2); m4Mul(_q2, M, m4RotY(_q1, left ? -HALF_PI : HALF_PI)); M.set(_q2); m4Mul(_q2, M, m4RotZ(_q1, 0.75)); M.set(_q2); m4Mul(_q2, M, m4TranslateM(_q1, 0, 0.18, 0)); M.set(_q2); m4Mul(T, M, m4Scale(_q1, 0.62, 0.62, 0.62)); }
  else m4Mul(T, M, m4Scale(_q1, 0.28, 0.28, 0.28));
  m4Mul(_q2, r.view, T); r.drawMesh(mesh, _q2, r.proj, R.sky, R.blk, 0.1);
  S.pop();
}
MODELS.piglin = { skin: 'piglin', draw: drawPiglin };
MODELS.zombified_piglin = { skin: 'zombified_piglin', draw: drawPiglin };

// ---------------------------------------------------------------- hoglin (HoglinModel 128x64)
const HGM = {
  head: bp(61, 1, [-7, -3, -19, 14, 6, 19]), earR: bp(1, 1, [-6, -1, -2, 6, 1, 4]), earL: bp(1, 6, [0, -1, -2, 6, 1, 4]), hornR: bp(10, 13, [-1, -11, -1, 2, 11, 2]), hornL: bp(1, 13, [-1, -11, -1, 2, 11, 2]),
  body: bp(1, 1, [-8, -7, -13, 16, 14, 26]), mane: bp(90, 33, [0, 0, -9, 0, 10, 19], { inflate: 0.001 }),
  legFR: bp(66, 42, [-3, 0, -3, 6, 14, 6]), legFL: bp(41, 42, [-3, 0, -3, 6, 14, 6]), legHR: bp(21, 45, [-2.5, 0, -2.5, 5, 11, 5]), legHL: bp(0, 45, [-2.5, 0, -2.5, 5, 11, 5]),
};
function drawHoglin(r, e, partial, camx, camy, camz, opts) {
  const R = mobRoot(e, partial, camx, camy, camz, opts, e.isBaby ? 0.5 : 1), S = R.S, sk = r.skinRect.hoglin, L = e.limbPos * 0.5, A = e.limbAmt;
  const i = e.attackAnim > 0 ? e.attackAnim - partial : 0, f = i > 0 ? 1 - Math.abs(10 - 2 * i) / 10 : 0;
  const hx = 0.87266463 + (-0.34906584 - 0.87266463) * f;
  S.push().part(0, 2, -12, hx, e.headYawRel || 0);
  boxOut(r, R, HGM.head, sk);
  S.push().part(-6, -2, -3, 0, 0, -0.6981317 - A * Math.sin(L)); boxOut(r, R, HGM.earR, sk); S.pop();
  S.push().part(6, -2, -3, 0, 0, 0.6981317 + A * Math.sin(L)); boxOut(r, R, HGM.earL, sk); S.pop();
  S.push().t(-7, 2, -12); boxOut(r, R, HGM.hornR, sk); S.pop(); S.push().t(7, 2, -12); boxOut(r, R, HGM.hornL, sk); S.pop();
  S.pop();
  S.push().t(0, 7, 0); boxOut(r, R, HGM.body, sk); S.push().t(0, -14, -5); boxOut(r, R, HGM.mane, sk); S.pop(); S.pop();
  const c = Math.cos(L) * 1.2 * A, c2 = Math.cos(L + Math.PI) * 1.2 * A;
  S.push().part(-4, 10, -8.5, c); boxOut(r, R, HGM.legFR, sk); S.pop();
  S.push().part(4, 10, -8.5, c2); boxOut(r, R, HGM.legFL, sk); S.pop();
  S.push().part(-5, 13, 10, c2); boxOut(r, R, HGM.legHR, sk); S.pop();
  S.push().part(5, 13, 10, c); boxOut(r, R, HGM.legHL, sk); S.pop();
}
MODELS.hoglin = { skin: 'hoglin', draw: drawHoglin };

// ---------------------------------------------------------------- strider (StriderModel 64x128)
const STM = { legR: bp(0, 32, [-2, 0, -2, 4, 16, 4]), legL: bp(0, 55, [-2, 0, -2, 4, 16, 4]), body: bp(0, 0, [-8, -6, -8, 16, 14, 16]) };
function drawStrider(r, e, partial, camx, camy, camz, opts) {
  const R = mobRoot(e, partial, camx, camy, camz, opts, e.isBaby ? 0.5 : 1), S = R.S, sk = r.skinRect.strider, L = e.limbPos * 0.5, A = Math.min(0.25, e.limbAmt), age = e.age + partial;
  const cold = e.cold ? [0.78, 0.62, 0.95] : null, shake = e.cold ? Math.sin(age * 2.5) * 0.04 : 0;
  S.push().part(-4, 8, 0, Math.sin(L * 1.5 * 0.5) * 2 * A); boxOut(r, R, STM.legR, sk, null, cold); S.pop();
  S.push().part(4, 8, 0, Math.sin(L * 1.5 * 0.5 + Math.PI) * 2 * A); boxOut(r, R, STM.legL, sk, null, cold); S.pop();
  S.push().part(0, 1 - 2 * Math.cos(L * 1.5) * 2 * A + 2 * A, 0, 0, 0, 0.1 * Math.sin(L * 1.5 * 0.5) * 4 * A + shake); boxOut(r, R, STM.body, sk, null, cold); S.pop();
}
MODELS.strider = { skin: 'strider', draw: drawStrider };

// ---------------------------------------------------------------- magma cube (LavaSlimeModel 64x32): eight slices that spread when it squishes, glowing core
const MCM = { slice: [0, 1, 2, 3, 4, 5, 6, 7].map(i => bp(0, i, [-4, 16 + i, -4, 8, 1, 8])), core: bp(32, 0, [-2, 18, -2, 4, 4, 4]) };
function drawMagmaCube(r, e, partial, camx, camy, camz, opts) {
  const sq = Math.max(0, e.psquish + (e.squish - e.psquish) * partial), n = e.size || 1, f = sq / (n * 0.5 + 1), f1 = 1 / (f + 1);
  const R = mobRoot(e, partial, camx, camy, camz, Object.assign({}, opts, { noDeathRot: true })), S = R.S, sk = r.skinRect.magma_cube;
  S.tb(0, -1.5, 0).s(f1 * n, n / f1, f1 * n).tb(0, 1.5, 0);
  for (let i = 0; i < 8; i++) { S.push().t(0, -(4 - i) * sq * 1.7, 0); boxOut(r, R, MCM.slice[i], sk); S.pop(); }
  boxOut(r, R, MCM.core, sk);
}
MODELS.magma_cube = { skin: 'magma_cube', draw: drawMagmaCube };

// ---------------------------------------------------------------- silverfish (SilverfishModel 64x32): seven wiggling segments, three bristle layers
const SF_SIZES = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]], SF_TEX = [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]];
const SFM = (() => {
  const parts = [], z = []; let f = -3.5;
  for (let i = 0; i < 7; i++) { const s = SF_SIZES[i]; parts.push({ b: bp(SF_TEX[i][0], SF_TEX[i][1], [s[0] * -0.5, 0, s[2] * -0.5, s[0], s[1], s[2]]), y: 24 - s[1], z: f }); z.push(f); if (i < 6) f += (s[2] + SF_SIZES[i + 1][2]) * 0.5; }
  const layers = [{ b: bp(20, 0, [-5, 0, SF_SIZES[2][2] * -0.5, 10, 8, SF_SIZES[2][2]]), y: 16, z: z[2], src: 2 }, { b: bp(20, 11, [-3, 0, SF_SIZES[4][2] * -0.5, 6, 4, SF_SIZES[4][2]]), y: 20, z: z[4], src: 4 }, { b: bp(20, 18, [-3, 0, SF_SIZES[4][2] * -0.5, 6, 5, SF_SIZES[1][2]]), y: 19, z: z[1], src: 1 }];
  return { parts, layers };
})();
function drawSilverfish(r, e, partial, camx, camy, camz, opts) {
  const R = mobRoot(e, partial, camx, camy, camz, opts), S = R.S, sk = r.skinRect.silverfish, a = e.age + partial, rot = [], off = [];
  for (let i = 0; i < 7; i++) { rot[i] = Math.cos(a * 0.9 + i * 0.15 * Math.PI) * Math.PI * 0.05 * (1 + Math.abs(i - 2)); off[i] = Math.sin(a * 0.9 + i * 0.15 * Math.PI) * Math.PI * 0.2 * Math.abs(i - 2); }
  SFM.parts.forEach((p, i) => { S.push().part(off[i], p.y, p.z, 0, rot[i]); boxOut(r, R, p.b, sk); S.pop(); });
  for (const l of SFM.layers) { S.push().part(off[l.src], l.y, l.z, 0, rot[l.src]); boxOut(r, R, l.b, sk); S.pop(); }
}
MODELS.silverfish = { skin: 'silverfish', draw: drawSilverfish };

// ---------------------------------------------------------------- end crystal (EndCrystalRenderer): base, two spinning glass cubes, the core
// (the crystal renderer works y-up without the usual flip, so the base box is written upside down for the converting part constructor)
const ECM = { core: bp(32, 0, [-4, -4, -4, 8, 8, 8]), glass: bp(0, 0, [-4, -4, -4, 8, 8, 8]), base: bp(0, 16, [-6, -4, -6, 12, 4, 12]) };
function m4AxisRot(a, ang) {
  const m = _q1; m.fill(0); m[15] = 1;
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c, x = a[0], y = a[1], z = a[2];
  m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y; m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x; m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c;
  return m;
}
function drawEndCrystal(r, e, partial, camx, camy, camz, opts) {
  const x = e.px + (e.x - e.px) * partial - camx, y = e.py + (e.y - e.py) * partial - camy, z = e.pz + (e.z - e.pz) * partial - camz;
  const t = e.age + partial, sk = r.skinRect.end_crystal; let bob = Math.sin(t * 0.2) / 2 + 0.5; bob = (bob * bob + bob) * 0.4 - 1.4;
  const S = _S; m4TranslateM(S.m, x, y, z); S.st.length = 0;
  const R = { S, sky: 1, blk: 1, cr: 1, cg: 1, cb: 1 }, axis = [Math.SQRT1_2, 0, Math.SQRT1_2];
  S.s(2 * (opts.scale || 1)).tb(0, -0.5, 0);
  if (e.showBottom) boxOut(r, R, ECM.base, sk);
  S.ry(t * 3 * DEG).tb(0, 1.5 + bob / 2, 0).mul(m4AxisRot(axis, 60 * DEG));
  boxOut(r, R, ECM.glass, sk, r.bSkinT);
  S.s(0.875).mul(m4AxisRot(axis, 60 * DEG)).ry(t * 3 * DEG);
  boxOut(r, R, ECM.glass, sk, r.bSkinT);
  S.s(0.875).mul(m4AxisRot(axis, 60 * DEG)).ry(t * 3 * DEG);
  boxOut(r, R, ECM.core, sk);
}
MODELS.end_crystal = { skin: 'end_crystal', draw: drawEndCrystal };

// =============================================================== projectiles
// ---- fireballs: large (ghast), small (blaze), dragon (lingering breath)
class Fireball extends Entity {
  constructor(game, x, y, z, kind, owner, dx, dy, dz) {
    const sz = kind === 'small' ? 0.3125 : 1;
    super(game, x, y - sz / 2, z, sz, sz);
    this.kind = kind; this.owner = owner; this.targetable = true; this.leftOwner = false;
    const l = Math.hypot(dx, dy, dz) || 1; this.ax = dx / l * 0.1; this.ay = dy / l * 0.1; this.az = dz / l * 0.1;
  }
  lightAt() { return [15, 15]; }
  tick() {
    this.savePrev(); this.age++;
    const g = this.game, w = this.world, p = g.player;
    if (this.age > 600 || this.y < -10 || this.y > 300 || !w.isLoaded(Math.floor(this.x), Math.floor(this.z))) { this.dead = true; return; }
    const cy = this.y + this.h / 2, len = Math.hypot(this.vx, this.vy, this.vz);
    if (this.owner && !this.leftOwner) { const o = this.owner; if (Math.abs(o.x - this.x) > o.w / 2 + 0.6 || Math.abs(o.z - this.z) > o.w / 2 + 0.6 || this.y > o.y + o.h + 0.6 || this.y + this.h < o.y - 0.6) this.leftOwner = true; }
    if (len > 1e-6) {
      const ux = this.vx / len, uy = this.vy / len, uz = this.vz / len, hw = this.w / 2;
      const hit = w.raycast(this.x, cy, this.z, ux, uy, uz, len + hw, false, true);
      let ent = null, et = 1e9;
      const test = (e, x0, y0, z0, x1, y1, z1) => { const t = rayAABB(this.x, cy, this.z, ux, uy, uz, x0 - hw, y0 - hw, z0 - hw, x1 + hw, y1 + hw, z1 + hw); if (t !== null && t < len && t < et) { ent = e; et = t; } };
      for (const e of g.entities) {
        if (e === this || e.dead || !e.isMob || e.deathTime > 0 || (e.type === 'end_crystal' && this.kind === 'dragon')) continue;
        if (e === this.owner && !this.leftOwner) continue;
        if (e.parts) { for (const pt of e.parts) test(e, pt.x0, pt.y0, pt.z0, pt.x1, pt.y1, pt.z1); continue; }
        test(e, e.x - e.w / 2, e.y, e.z - e.w / 2, e.x + e.w / 2, e.y + e.h, e.z + e.w / 2);
      }
      if (!p.dead && p.gameMode === 0 && (this.owner !== p || this.leftOwner)) test(p, p.x - 0.3, p.y, p.z - 0.3, p.x + 0.3, p.y + p.h, p.z + 0.3);
      if (ent && (!hit || et < hit.t)) { this.x += ux * et; this.y += uy * et; this.z += uz * et; this.onHit(ent, null); return; }
      if (hit) { this.x = hit.hx; this.y = hit.hy - this.h / 2; this.z = hit.hz; this.onHit(null, hit); return; }
    }
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    this.updateFluids();
    const inert = this.inWater ? 0.8 : 0.95;
    this.vx = (this.vx + this.ax) * inert; this.vy = (this.vy + this.ay) * inert; this.vz = (this.vz + this.az) * inert;
    if (g.options.particles !== 0) {
      if (this.kind === 'dragon') g.particles.sprite('breath', this.x, this.y + 0.5, this.z, 1, { size: 0.15, up: 0, vel: 0.02, life: 20, shrink: true, spread: 0.3, spreadY: 0.3, r: 0.75, g: 0.3, b: 0.9 });
      else g.particles.sprite('smoke', this.x, this.y + this.h / 2, this.z, 1, { size: this.kind === 'small' ? 0.08 : 0.2, up: 0.01, life: 12, shrink: true, spread: 0.1, spreadY: 0.1, vel: 0.01, r: 0.25, g: 0.25, b: 0.25 });
    }
  }
  onHit(ent, hit) {
    const g = this.game, w = this.world; this.dead = true;
    const cx = this.x, cy = this.y + this.h / 2, cz = this.z;
    if (this.kind === 'small') {   // SmallFireball: sets things on fire, 5 damage
      if (ent) { if (!(ent.def && ent.def.fireImmune)) { ent.fireTicks = Math.max(ent.fireTicks || 0, 100); ent.hurt(5, this.owner || this, 'fireball', [this.vx, this.vz]); } }
      else if (hit) { const fx = hit.x + DIRS[hit.face][0], fy = hit.y + DIRS[hit.face][1], fz = hit.z + DIRS[hit.face][2]; if (w.getBlock(fx, fy, fz) === 0) w.igniteAt(fx, fy, fz, 0); }
      return;
    }
    if (this.kind === 'dragon') {   // DragonFireball: a lingering cloud of dragon's breath
      g.entities.push(new BreathCloud(g, cx, ent ? ent.y : cy - 0.5, cz, 3, 600, this.owner));
      g.sound('mob.enderdragon.fireball_explode', cx, cy, cz, 1, 1, 'random.explode');
      return;
    }
    // LargeFireball: direct hit 6, then an explosion of power 1 that starts fires; a reflected fireball one-shots ghasts
    if (ent) { if (ent.type === 'ghast' && this.owner === g.player) { ent.hurt(1000, g.player, 'fireball'); g.stat('return_to_sender'); } else ent.hurt(6, this.owner || this, 'fireball', [this.vx, this.vz]); }
    g.explode(cx, cy, cz, 1, this, { fire: true });
  }
  // punching a fireball sends it back along the player's view (AbstractHurtingProjectile.hurt)
  hurt(amount, src) {
    if (!src || src.x === undefined) return false;
    const d = [0, 0, 0]; lookDir(src.yaw, src.pitch, d);
    this.vx = d[0]; this.vy = d[1]; this.vz = d[2]; this.ax = d[0] * 0.1; this.ay = d[1] * 0.1; this.az = d[2] * 0.1; this.owner = src; this.leftOwner = true;
    return true;
  }
  renderSelf(game, partial, x, y, z) {
    const r = game.renderer;
    if (this.kind === 'dragon') { const s = 1; r.bAlpha.billboard(x, y + 0.5, z, ...game.camRight(s), ...game.camUp(s), r.TILE.particle_breath, 0, 0, 1, 1, 0.8, 0.3, 0.95, 1, 1, 1); return; }
    const M = game._fbm || (game._fbm = m4()), MV = game._fbmv || (game._fbmv = m4()), sc = this.kind === 'small' ? 0.26 : 1.05;
    m4Compose(M, x, y + this.h / 2, z, 0, r.cam.yaw, 0, sc, sc, sc); m4Mul(MV, r.view, M);
    r.drawMesh(r.itemMesh(IID.fire_charge), MV, r.proj, 1, 1, 0.1);
  }
}
// AreaEffectCloud of dragon's breath: shrinks over its life and harms whoever stands in it
class BreathCloud extends Entity {
  constructor(game, x, y, z, radius, life, owner) { super(game, x, y, z, radius * 2, 0.5); this.radius = radius; this.r0 = radius; this.life = life; this.owner = owner; this.hitT = new Map(); }
  tick() {
    this.savePrev(); this.age++;
    const g = this.game, k = 1 - this.age / this.life; this.radius = this.r0 * Math.max(0.15, k);
    if (this.age >= this.life) { this.dead = true; return; }
    if (g.options.particles !== 0) for (let i = 0; i < Math.ceil(this.radius * 3); i++) { const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * this.radius; g.particles.sprite('breath', this.x + Math.cos(a) * d, this.y + 0.1, this.z + Math.sin(a) * d, 1, { size: 0.12, up: 0.01, vel: 0.01, life: 20, shrink: true, spread: 0, spreadY: 0, r: 0.75, g: 0.3, b: 0.9 }); }
    if (this.age % 5) return;
    const victims = [g.player].concat(g.entities.filter(e => e.isMob && !e.dead && e.type !== 'ender_dragon' && e.type !== 'end_crystal'));
    for (const e of victims) {
      if (!e || e.dead || (e === g.player && e.gameMode !== 0)) continue;
      if ((e.x - this.x) ** 2 + (e.z - this.z) ** 2 > this.radius * this.radius || e.y > this.y + 1.5 || e.y + e.h < this.y - 0.5) continue;
      const last = this.hitT.has(e.id) ? this.hitT.get(e.id) : -100; if (this.age - last < 20) continue;
      this.hitT.set(e.id, this.age); e.hurt(6, this.owner || null, 'magic');
    }
  }
}

// =============================================================== mob classes
function gauss() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }
// ---- ghast: drifts about, wails, spits explosive fireballs
class Ghast extends Mob {
  constructor(game, x, y, z, type) { super(game, x, y, z, type); this.charge = 0; this.charging = false; this.floatT = 0; this.wanted = null; this.eyeH = 2.6; }
  ai(dp2) {
    const g = this.game, p = g.player, w = this.world;
    const wd = this.wanted ? Math.hypot(this.wanted[0] - this.x, this.wanted[1] - this.y, this.wanted[2] - this.z) : 0;
    // GhastRandomFloatAroundGoal
    if (!this.wanted || wd < 1 || wd > 60 || Math.random() < 0.01) this.wanted = [this.x + (Math.random() * 2 - 1) * 16, clamp(this.y + (Math.random() * 2 - 1) * 16, SH.NETHER_LAVA_Y + 4, 118), this.z + (Math.random() * 2 - 1) * 16];
    if (this.floatT-- <= 0) {
      this.floatT = 2 + ((Math.random() * 5) | 0);
      let dx = this.wanted[0] - this.x, dy = this.wanted[1] - this.y, dz = this.wanted[2] - this.z; const d = Math.hypot(dx, dy, dz) || 1; dx /= d; dy /= d; dz /= d;
      let free = true;
      for (let i = 1; i < Math.ceil(d) && free && i < 12; i++) { const bx = this.x + dx * i, by = Math.floor(this.y + 2 + dy * i), bz = this.z + dz * i; for (const o of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) if (T_SOLID[w.getBlock(Math.floor(bx + o[0]), by, Math.floor(bz + o[1]))]) { free = false; break; } }
      if (free) { this.vx += dx * 0.1; this.vy += dy * 0.1; this.vz += dz * 0.1; } else this.wanted = null;
    }
    // target the player within 64 blocks, face it and shoot (GhastShootFireballGoal)
    this.target = (!p.dead && p.gameMode === 0 && dp2 < 64 * 64 && Math.abs(p.y - this.y) < 64) ? p : null;
    const t = this.target;
    if (t && this.canSee(t)) {
      this.bodyYaw = Math.atan2(-(t.x - this.x), t.z - this.z);
      this.charge++;
      if (this.charge === 10) g.sound('mob.ghast.charge', this.x, this.y, this.z, 4, (Math.random() - Math.random()) * 0.2 + 1, 'mob.ghast.moan');
      if (this.charge === 20) {
        const yaw = this.bodyYaw, fx = -Math.sin(yaw), fz = Math.cos(yaw);
        const sx = this.x + fx * 4, sy = this.y + 2, sz = this.z + fz * 4;
        g.entities.push(new Fireball(g, sx, sy, sz, 'large', this, t.x - sx, t.y + t.h / 2 - sy, t.z - sz));
        g.sound('mob.ghast.fireball', this.x, this.y, this.z, 4, (Math.random() - Math.random()) * 0.2 + 1, 'random.bow');
        this.charge = -40;
      }
    } else if (this.charge > 0) this.charge--;
    if (!t && Math.hypot(this.vx, this.vz) > 0.005) this.bodyYaw = Math.atan2(-this.vx, this.vz);
    this.charging = this.charge > 10;
    this.moving = false;
  }
  physics() { this.move(this.vx, this.vy, this.vz); this.vx *= 0.91; this.vy *= 0.91; this.vz *= 0.91; this.fallDist = 0; }
  canSee(t) { const w = this.world, ex = this.x, ey = this.y + 2, ez = this.z, tx = t.x - ex, ty = t.y + 1.5 - ey, tz = t.z - ez, d = Math.hypot(tx, ty, tz), n = Math.ceil(d / 0.5); for (let i = 3; i < n; i++) { const f = i / n, b = w.getBlock(Math.floor(ex + tx * f), Math.floor(ey + ty * f), Math.floor(ez + tz * f)); if (b !== 0 && T_SOLID[b]) return false; } return true; }
  hurt(amount, src, kind) { return super.hurt(amount, src, kind, null); }
}
// ---- blaze: hovers, bursts of three small fireballs, melee up close; water hurts it
class Blaze extends Mob {
  constructor(game, x, y, z, type) { super(game, x, y, z, type); this.attackStep = 0; this.atkT = 0; this.hoverT = 0; this.allowedOff = 0.5; this.charged = false; this.lastSeen = 0; }
  ai(dp2) {
    const g = this.game, p = g.player;
    if (--this.hoverT <= 0) { this.hoverT = 100; this.allowedOff = 0.5 + gauss() * 3; }
    if (!this.target && !p.dead && p.gameMode === 0 && dp2 < 48 * 48 && this.age % 10 === 0 && this.canSee(p)) this.target = p;
    if (this.target && (this.target.dead || (this.target === p && p.gameMode === 1) || dp2 > 60 * 60)) this.target = null;
    const t = this.target;
    if (Math.random() < 1 / 24) g.sound('fire.fire', this.x, this.y + 0.5, this.z, 1 + Math.random(), Math.random() * 0.7 + 0.3);
    if (g.options.particles !== 0 && Math.random() < 0.5) g.particles.sprite('smoke', this.x + (Math.random() - 0.5) * this.w, this.y + Math.random() * this.h, this.z + (Math.random() - 0.5) * this.w, 1, { size: 0.15, up: 0.02, life: 20, shrink: true, spread: 0, spreadY: 0, vel: 0.01, r: 0.2, g: 0.2, b: 0.2 });
    if ((this.inWater || this.world.rainingAt(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z))) && this.age % 10 === 0) this.hurt(1, null, 'drown');
    if (!t) { this.wander(); this.charged = false; this.attackStep = 0; return; }
    if (t.y + (t.eyeH || 1.6) > this.y + this.eyeH + this.allowedOff) this.vy += (0.3 - this.vy) * 0.3;
    const dx = t.x - this.x, dz = t.z - this.z, dy = t.y + t.h / 2 - (this.y + this.h / 2), d2 = dx * dx + dy * dy + dz * dz, see = this.canSee(t);
    this.lastSeen = see ? 0 : this.lastSeen + 1;
    this.bodyYaw = Math.atan2(-dx, dz);
    this.atkT--;
    if (d2 < 4) {
      if (!see) return;
      if (this.atkT <= 0) { this.atkT = 20; this.swingT = 6; t.hurt(Math.round(6 * (g.difficulty === 1 ? 0.6 : g.difficulty === 3 ? 1.5 : 1)), this, 'mob', [dx, dz]); }
      const d = Math.sqrt(d2) || 1; this.wdx = dx / d; this.wdz = dz / d; this.moving = true;
    } else if (d2 < 48 * 48 && see) {
      if (this.atkT <= 0) {
        this.attackStep++;
        if (this.attackStep === 1) { this.atkT = 60; this.charged = true; }
        else if (this.attackStep <= 4) this.atkT = 6;
        else { this.atkT = 100; this.attackStep = 0; this.charged = false; }
        if (this.attackStep > 1) {
          const f = Math.sqrt(Math.sqrt(d2)) * 0.5;
          g.sound('mob.blaze.shoot', this.x, this.y, this.z, 1, 1, 'mob.ghast.fireball');
          g.entities.push(new Fireball(g, this.x, this.y + this.h / 2 + 0.5, this.z, 'small', this, dx + gauss() * f, dy, dz + gauss() * f));
        }
      }
      this.moving = false;
    } else if (this.lastSeen < 5) { const d = Math.hypot(dx, dz) || 1; this.wdx = dx / d; this.wdz = dz / d; this.moving = true; }
  }
  physics() { super.physics(); if (!this.onGround && this.vy < 0) this.vy *= 0.6; this.fallDist = 0; }
}
// ---- zombified piglin: neutral, golden sword, the whole group joins in when one is hit
class ZombifiedPiglin extends Mob {
  constructor(game, x, y, z, type) { super(game, x, y, z, type); this.angerT = 0; this.heldItem = IID.golden_sword; }
  ai(dp2) {
    const g = this.game, p = g.player;
    if (this.angerT > 0) { this.angerT--; if (this.angerT % 40 === 0 && this.target) g.sound('mob.zpig.zpigangry', this.x, this.y, this.z, 1, (Math.random() - Math.random()) * 0.2 + 1.5, 'mob.zpig.zpig'); }
    if (this.angerT <= 0 || !this.target || this.target.dead || (this.target === p && p.gameMode === 1)) { this.target = null; this.angerT = 0; this.wander(); return; }
    this.hostileAI(dp2);
  }
  hurt(amount, src, kind, kb) {
    const ok = super.hurt(amount, src, kind, kb);
    if (ok && src && (src === this.game.player || src.isMob) && src !== this) this.anger(src, true);
    return ok;
  }
  anger(t, spread) {
    this.target = t; this.angerT = 400 + ((Math.random() * 400) | 0);
    if (spread) for (const e of this.game.entities) if (e !== this && e.type === 'zombified_piglin' && !e.dead && (e.x - this.x) ** 2 + (e.y - this.y) ** 2 + (e.z - this.z) ** 2 < 20 * 20) e.anger(t, false);
  }
}
// ---- piglin: hostile unless you wear gold; barters for gold ingots; zombifies outside the Nether
const BARTER = [['ender_pearl', 2, 4, 10], ['iron_nugget', 9, 36, 10], ['fire_charge', 1, 1, 40], ['gravel', 8, 16, 40], ['leather', 2, 4, 40], ['nether_brick', 2, 8, 40], ['obsidian', 1, 1, 40], ['soul_sand', 2, 8, 40], ['string', 3, 9, 20], ['quartz', 5, 12, 20], ['blackstone', 8, 16, 40], ['magma_cream', 2, 6, 20]];
class Piglin extends Mob {
  constructor(game, x, y, z, type) { super(game, x, y, z, type); this.admireT = 0; this.zombifyT = 0; this.heldItem = IID.golden_sword; this.calmT = 0; this.provoked = false; }
  wearsGold(p) { return p.armor.some(s => s && /^golden_/.test(ITEMS[s.id].name)); }
  ai(dp2) {
    const g = this.game, p = g.player;
    if (g.dim !== 'nether') { if (++this.zombifyT > 300) { this.convertTo('zombified_piglin'); return; } } else this.zombifyT = 0;
    if (this.admireT > 0) {
      this.moving = false; this.target = null;
      if (--this.admireT === 0) { this.barter(); g.sound('mob.piglin.celebrate', this.x, this.y, this.z, 1, 1, 'mob.piglin.idle'); }
      return;
    }
    if (this.calmT > 0) this.calmT--;
    // gold ingots lying on the ground get picked up and admired
    if (this.age % 10 === 0) for (const e of g.entities) if (e instanceof ItemEntity && !e.dead && e.stack.id === IID.gold_ingot && (e.x - this.x) ** 2 + (e.z - this.z) ** 2 < 2.25 && Math.abs(e.y - this.y) < 1.5) { e.stack.n--; if (e.stack.n <= 0) e.dead = true; this.startAdmire(); return; }
    if (this.target === p && ((this.wearsGold(p) && !this.provoked) || this.calmT > 0)) this.target = null;
    if (!this.target && !p.dead && p.gameMode === 0 && (!this.wearsGold(p) || this.provoked) && this.calmT <= 0 && dp2 < 16 * 16 && this.age % 8 === 0 && this.canSee(p)) { this.target = p; g.sound('mob.piglin.angry', this.x, this.y, this.z, 1, 1, 'mob.piglin.idle'); }
    if (!this.target) { this.wander(); return; }
    this.hostileAI(dp2);
  }
  startAdmire() { this.admireT = 120; this.target = null; this.calmT = 200; this.game.sound('mob.piglin.admiring', this.x, this.y, this.z, 1, 1, 'mob.piglin.idle'); }
  barter() {
    const g = this.game; let tot = 0; for (const e of BARTER) tot += e[3];
    let r = Math.random() * tot, pick = BARTER[0]; for (const e of BARTER) { r -= e[3]; if (r <= 0) { pick = e; break; } }
    const id = IID[pick[0]]; if (id === undefined) return;
    const n = pick[1] + ((Math.random() * (pick[2] - pick[1] + 1)) | 0), p = g.player, dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz) || 1;
    g.spawnItem(this.x, this.y + 1.2, this.z, newStack(id, n), [dx / d * 0.2, 0.25, dz / d * 0.2]);
    g.stat('bartered');
  }
  hurt(amount, src, kind, kb) { const ok = super.hurt(amount, src, kind, kb); if (ok && src === this.game.player) { this.provoked = true; this.admireT = 0; this.calmT = 0; this.target = src; } return ok; }
  convertTo(type) {
    const g = this.game, m = g.spawnMob(type, this.x, this.y, this.z); m.bodyYaw = m.pbodyYaw = this.bodyYaw;
    g.sound('mob.piglin.converted_to_zombified', this.x, this.y, this.z, 1, 1, 'mob.zombie.say');
    this.dead = true;
  }
}
// ---- hoglin: charges and tosses its target; afraid of warped fungus and portals
class Hoglin extends Mob {
  constructor(game, x, y, z, type) { super(game, x, y, z, type); this.attackAnim = 0; this.fleeT = 0; }
  ai(dp2) {
    const g = this.game, p = g.player, w = this.world;
    if (this.attackAnim > 0) this.attackAnim--;
    if (this.age % 20 === 0) {   // repellents within 8 blocks
      let rep = null;
      for (let i = 0; i < 24 && !rep; i++) { const x = Math.floor(this.x) + ((Math.random() * 17) | 0) - 8, y = Math.floor(this.y) + ((Math.random() * 5) | 0) - 2, z = Math.floor(this.z) + ((Math.random() * 17) | 0) - 8, b = w.getBlock(x, y, z); if (b === BID.warped_fungus || b === BID.nether_portal) rep = [x, z]; }
      if (rep) { this.fleeT = 60; this.target = null; const dx = this.x - rep[0], dz = this.z - rep[1], d = Math.hypot(dx, dz) || 1; this.wdx = dx / d; this.wdz = dz / d; }
    }
    if (this.fleeT > 0) { this.fleeT--; this.moving = this.safeAhead(this.wdx, this.wdz); return; }
    if (this.isBaby) { if (!this.breedAI()) this.wander(); return; }
    if (!this.target && !p.dead && p.gameMode === 0 && dp2 < 16 * 16 && this.age % 8 === 0 && this.canSee(p)) { this.target = p; g.sound('mob.hoglin.angry', this.x, this.y, this.z, 1, 1, 'mob.hoglin.idle'); }
    if (this.target && (this.target.dead || (this.target === p && p.gameMode === 1) || dp2 > 32 * 32)) this.target = null;
    const t = this.target;
    if (!t) { if (!this.breedAI()) this.wander(); return; }
    const dx = t.x - this.x, dz = t.z - this.z, dist = Math.hypot(dx, dz);
    this.wdx = dx / (dist || 1); this.wdz = dz / (dist || 1); this.moving = dist > 1.2;
    if (this.attackT > 0) this.attackT--;
    if (dist < 2.2 && Math.abs(t.y - this.y) < 2 && this.attackT <= 0) {
      this.attackT = 20; this.attackAnim = 10;
      const dmg = (3 + Math.random() * 5) * (g.difficulty === 1 ? 0.6 : g.difficulty === 3 ? 1.5 : 1);
      if (t.hurt(Math.round(dmg), this, 'mob', [dx, dz])) { t.vy = Math.min(0.9, (t.vy || 0) + 0.55); t.vx += this.wdx * 0.5; t.vz += this.wdz * 0.5; }
      g.sound('mob.hoglin.attack', this.x, this.y, this.z, 1, 1, 'mob.hoglin.angry');
    }
  }
}
// ---- strider: walks on lava, shivers on land
class Strider extends Mob {
  constructor(game, x, y, z, type) { super(game, x, y, z, type); this.cold = false; }
  ai(dp2) {
    if (this.panic > 0) { this.panic--; this.moving = true; }
    else if (!this.breedAI() && !this.temptAI()) this.wander();
    const w = this.world, below = w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
    this.cold = !(T_FLUID[below] === 2 || T_FLUID[w.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z))] === 2);
    if (this.moving) {   // keep to the lava when it can
      const nx = Math.floor(this.x + this.wdx * 1.2), nz = Math.floor(this.z + this.wdz * 1.2), ahead = w.getBlock(nx, Math.floor(this.y - 0.2), nz);
      if (!this.cold && T_FLUID[ahead] !== 2 && !T_SOLID[ahead] && Math.random() < 0.8) { this.wdx = -this.wdx; this.wdz = -this.wdz; }
    }
  }
  safeAhead() { return true; }
  physics() {
    const w = this.world, bx = Math.floor(this.x), bz = Math.floor(this.z);
    const onLava = T_FLUID[w.getBlock(bx, Math.floor(this.y - 0.05), bz)] === 2 || T_FLUID[w.getBlock(bx, Math.floor(this.y + 0.1), bz)] === 2;
    if (onLava) {
      let top = Math.floor(this.y + 0.1); while (T_FLUID[w.getBlock(bx, top, bz)] === 2 && top < this.y + 2) top++;
      const sp = this.moving ? 0.175 * (this.cold ? 0.66 : 1) * 0.454 : 0;
      this.vx += this.wdx * sp; this.vz += this.wdz * sp;
      this.vy = (top - this.y) * 0.5;
      this.move(this.vx, this.vy, this.vz); this.onGround = true;
      this.vx *= 0.546; this.vz *= 0.546; this.fallDist = 0;
      return;
    }
    super.physics();
  }
  updateFluids() { super.updateFluids(); this.inLava = false; }
}
// ---- magma cube: a fire-proof slime that jumps higher, glows, splits on death
class MagmaCube extends Mob {
  constructor(game, x, y, z, type) {
    super(game, x, y, z, type);
    this.setSize(1 << ((Math.random() * 3) | 0)); this.hopT = 20; this.squish = this.psquish = this.squishAmt = 0; this.wasGround = false;
  }
  setSize(n) { this.size = n; this.w = this.h = 0.51 * n; this.hp = this.maxHp = n * n; this.eyeH = this.h * 0.5; }
  renderOpts() { return { noDeathRot: true }; }
  ai(dp2) {
    const g = this.game, p = g.player; this.moving = false;
    this.target = (!p.dead && p.gameMode === 0 && dp2 < 16 * 16) ? p : null;
    if (this.onGround && --this.hopT <= 0) {
      this.hopT = ((Math.random() * 20) | 0) + 10; if (this.target) this.hopT = Math.max(3, Math.floor(this.hopT / 3));
      let ang = Math.random() * TAU; if (this.target) ang = Math.atan2(-(this.target.x - this.x), this.target.z - this.z);
      const sp = 0.16 + this.size * 0.02;
      this.vx = -Math.sin(ang) * sp; this.vz = Math.cos(ang) * sp; this.vy = 0.42 + this.size * 0.1; this.bodyYaw = ang;
      g.sound(this.size > 1 ? 'mob.magmacube.big' : 'mob.magmacube.small', this.x, this.y, this.z, 0.6 * Math.min(2, this.size), ((Math.random() - Math.random()) * 0.2 + 1) / (this.size > 2 ? 1.4 : 1), 'mob.slime.small');
    }
    const t = this.target;
    if (t && this.attackT-- <= 0) {
      const dx = t.x - this.x, dz = t.z - this.z, r = this.w / 2 + 0.3;
      if (Math.abs(dx) < r + 0.3 && Math.abs(dz) < r + 0.3 && t.y < this.y + this.h && t.y + 1.7 > this.y) { this.attackT = 20; const dmg = (this.size + 2) * (g.difficulty === 1 ? 0.5 : g.difficulty === 3 ? 1.5 : 1); t.hurt(Math.max(1, Math.round(dmg)), this, 'mob', [dx, dz]); }
      else this.attackT = 0;
    }
  }
  tick() {
    super.tick();
    this.psquish = this.squish; this.squish += (this.squishAmt - this.squish) * 0.5;
    if (this.onGround && !this.wasGround) { this.squishAmt = -0.5; for (let i = 0; i < this.size * 4; i++) { const a = Math.random() * TAU; this.game.particles.sprite('flame', this.x + Math.cos(a) * this.w * 0.5, this.y + 0.05, this.z + Math.sin(a) * this.w * 0.5, 1, { size: 0.06, up: 0.06, vel: 0.06, life: 12, shrink: true, spread: 0, spreadY: 0 }); } }
    else if (!this.onGround && this.wasGround) this.squishAmt = 1;
    this.wasGround = this.onGround; this.squishAmt *= 0.6;
  }
  hurt(amount, src, kind, kb) { return super.hurt(Math.max(0.5, amount - this.size * 0.75), src, kind, kb); }   // armour 3 per size
  die(src, kind) {
    if (this.deathTime > 0) return;
    super.die(src, kind);
    const g = this.game;
    if (this.size > 1) { const n = 2 + ((Math.random() * 3) | 0); for (let i = 0; i < n; i++) { const a = (i / n + Math.random() * 0.3) * TAU, c = makeMob(g, 'magma_cube', this.x + Math.cos(a) * this.size / 4, this.y + 0.5, this.z + Math.sin(a) * this.size / 4); c.setSize(this.size >> 1); c.vx = Math.cos(a) * 0.15; c.vz = Math.sin(a) * 0.15; c.vy = 0.3; g.entities.push(c); } }
    if ((src === g.player || kind === 'player') && this.size > 1 && Math.random() < 0.25) g.spawnItem(this.x, this.y + 0.3, this.z, newStack(IID.magma_cream, 1), null);
  }
}
// ---- wither skeleton: stone sword, its hits wither
class WitherSkeleton extends Mob {
  constructor(game, x, y, z, type) { super(game, x, y, z, type); this.heldItem = IID.stone_sword; }
  renderOpts() { return { scale: 1.2 }; }
  onMeleeHit(t) { t.witherT = Math.max(t.witherT || 0, 200); }
}
// ---- silverfish: small, quick, nibbling
class Silverfish extends Mob { }
// ---- end crystal: floats over its bedrock, explodes when hit, heals the dragon
class EndCrystal extends Mob {
  constructor(game, x, y, z, type) { super(game, x, y, z, type); this.showBottom = false; this.beamTarget = null; this.persist = true; this.age = (Math.random() * 100000) | 0; }
  tick() {
    this.savePrev(); this.age++;
    if (this.deathTime > 0 || this.hp <= 0) { this.dead = true; return; }
    // vanilla keeps a fire burning under every crystal in the End
    if (this.game.dim === 'end' && this.age % 20 === 0) { const w = this.world, bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z); if (w.isLoaded(bx, bz) && w.getBlock(bx, by, bz) === 0 && T_SOLID[w.getBlock(bx, by - 1, bz)]) w.setBlock(bx, by, bz, BID.fire, 0, 2); }
  }
  hurt(amount, src, kind) {
    if (this.dead || this.deathTime > 0) return false;
    this.dead = true; this.hp = 0;
    const g = this.game;
    g.explode(this.x, this.y, this.z, 6, this, {});
    if (g.dim === 'end' && this.spike !== undefined && g.worldInfo.end && g.worldInfo.end.crystals) g.worldInfo.end.crystals[this.spike] = 0;
    for (const e of g.entities) if (e.type === 'ender_dragon' && !e.dead && e.onCrystalDestroyed) e.onCrystalDestroyed(this, src);
    return true;
  }
  die() { }
  physics() { }
}

// ---- golems --------------------------------------------------------------
// IronGolem: guards its village, hits hard and throws mobs into the air, offers poppies to villagers
class IronGolem extends Mob {
  constructor(game, x, y, z, type) { super(game, x, y, z, type); this.attackAnim = 0; this.flowerT = 0; this.playerMade = false; this.village = null; this.angryAtPlayer = 0; this.persist = true; this.hitByPlayer = false; }
  saveData() { return { pm: this.playerMade ? 1 : 0, vil: this.village }; }
  loadData(d) { this.playerMade = !!d.pm; this.village = d.vil || null; }
  applySpawnData(d) { this.village = d.village || null; this.persist = true; }
  ai(dp2) {
    const g = this.game, p = g.player;
    if (this.attackAnim > 0) this.attackAnim--;
    if (this.flowerT > 0) this.flowerT--;
    if (this.angryAtPlayer > 0) this.angryAtPlayer--;
    // NearestAttackableTargetGoal(enemies except creepers); defends the village from a player who hurts villagers
    const t0 = this.target;
    if (t0 && (t0.dead || t0.deathTime > 0 || (t0 === p && (p.gameMode === 1 || (this.angryAtPlayer <= 0 && !this.hitByPlayer))) || (t0.x - this.x) ** 2 + (t0.z - this.z) ** 2 > 40 * 40)) { this.target = null; this.hitByPlayer = false; }
    if (!this.target && (this.age + this.phase) % 10 === 0) {
      let best = null, bd = 16 * 16;
      for (const e of g.entities) { if (!e.isMob || e.dead || e.deathTime > 0 || !e.def.hostile || e.def.creeper || (e.def.neutral && !e.target)) continue; const dd = (e.x - this.x) ** 2 + (e.z - this.z) ** 2; if (dd < bd && Math.abs(e.y - this.y) < 8 && this.canSee(e)) { bd = dd; best = e; } }
      if (best) this.target = best;
      else if (this.angryAtPlayer > 0 && !p.dead && p.gameMode === 0 && !this.playerMade) this.target = p;
    }
    const t = this.target;
    if (t) {
      const dx = t.x - this.x, dz = t.z - this.z, dist = Math.hypot(dx, dz);
      this.wdx = dx / (dist || 1); this.wdz = dz / (dist || 1); this.moving = dist > 1.6;
      if (this.attackT > 0) this.attackT--;
      if (dist < this.w / 2 + (t.w || 0.6) / 2 + 1.2 && Math.abs(t.y - this.y) < 2.5 && this.attackT <= 0) {
        this.attackT = 20; this.attackAnim = 10;
        const f = 15, dmg = f / 2 + ((Math.random() * f) | 0), sc = t === p ? (g.difficulty === 1 ? 0.5 : g.difficulty === 3 ? 1.5 : 1) : 1;
        if (t.hurt(Math.round(dmg * sc), this, 'mob', null)) t.vy = (t.vy || 0) + 0.4;
        g.sound('mob.irongolem.throw', this.x, this.y, this.z, 1, 1, 'random.explode');
      }
      return;
    }
    // offer a poppy to a nearby villager now and then
    if (this.flowerT <= 0 && g.isDay && Math.random() < 1 / 8000) { for (const e of g.entities) if (e.type === 'villager' && !e.dead && (e.x - this.x) ** 2 + (e.z - this.z) ** 2 < 36) { this.flowerT = 400; break; } }
    // stroll, staying within the village
    if (this.village && (this.x - this.village[0]) ** 2 + (this.z - this.village[1]) ** 2 > 40 * 40) { const dx = this.village[0] - this.x, dz = this.village[1] - this.z, d = Math.hypot(dx, dz) || 1; this.wdx = dx / d; this.wdz = dz / d; this.moving = this.safeAhead(this.wdx, this.wdz); }
    else this.wander();
  }
  hurt(amount, src, kind, kb) {
    const ok = super.hurt(amount, src, kind, null);   // knockback resistance 1
    if (ok && src) { if (src === this.game.player && !this.playerMade) { this.target = src; this.hitByPlayer = true; this.angryAtPlayer = 600; } else if (src.isMob && src !== this) this.target = src; }
    return ok;
  }
  tick() {
    super.tick();
    if (this.limbAmt > 0.3 && this.onGround && this.age % 12 === 0) this.game.sound('mob.irongolem.walk', this.x, this.y, this.z, 0.6, 1, 'step.stone');
  }
}
// SnowGolem: snowballs at monsters, snow trail in cold places, melts in warm ones
class SnowGolem extends Mob {
  constructor(game, x, y, z, type) { super(game, x, y, z, type); this.shootT = 20; this.persist = true; }
  ai(dp2) {
    const g = this.game, w = this.world, bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
    const bio = BIOMES[w.getBiome(bx, bz)], warm = g.dim === 'nether' || (bio && (bio.name === 'desert' || bio.name === 'savanna' || bio.name === 'badlands' || bio.name === 'jungle'));
    if ((warm || this.inWater || w.rainingAt(bx, by + 1, bz)) && this.age % 20 === 0) this.hurt(1, null, 'fire');
    if (!warm && bio && /snowy|frozen|taiga|peaks/.test(bio.name) && w.getBlock(bx, by, bz) === 0 && T_OPAQUE[w.getBlock(bx, by - 1, bz)]) w.setBlock(bx, by, bz, BID.snow_layer, 0);
    if (this.target && (this.target.dead || this.target.deathTime > 0 || (this.target.x - this.x) ** 2 + (this.target.z - this.z) ** 2 > 12 * 12)) this.target = null;
    if (!this.target && this.age % 10 === 0) { let best = null, bd = 10 * 10; for (const e of g.entities) { if (!e.isMob || e.dead || !e.def.hostile || (e.def.neutral && !e.target)) continue; const dd = (e.x - this.x) ** 2 + (e.z - this.z) ** 2; if (dd < bd && this.canSee(e)) { bd = dd; best = e; } } this.target = best; }
    const t = this.target;
    if (!t) { this.wander(); return; }
    this.moving = false; this.bodyYaw = Math.atan2(-(t.x - this.x), t.z - this.z);
    if (--this.shootT <= 0) {
      this.shootT = 20;
      const ex = this.x, ey = this.y + 1.5, ez = this.z, tx = t.x - ex, ty = t.y + t.h * 0.6 - ey, tz = t.z - ez, d = Math.hypot(tx, tz) || 1;
      const b = new Projectile(g, ex, ey, ez, 'snowball', this), L = Math.hypot(tx, ty + d * 0.2, tz) || 1;
      b.vx = tx / L * 1.6; b.vy = (ty + d * 0.2) / L * 1.6; b.vz = tz / L * 1.6; g.entities.push(b);
      g.sound('mob.snowgolem.shoot', ex, ey, ez, 1, 0.4 / (Math.random() * 0.4 + 0.8), 'random.bow');
    }
  }
}
Object.assign(MOB_CLASSES, { ghast: Ghast, blaze: Blaze, zombified_piglin: ZombifiedPiglin, piglin: Piglin, hoglin: Hoglin, strider: Strider, magma_cube: MagmaCube, wither_skeleton: WitherSkeleton, silverfish: Silverfish, end_crystal: EndCrystal, iron_golem: IronGolem, snow_golem: SnowGolem });
