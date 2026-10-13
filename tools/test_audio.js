#!/usr/bin/env node
/* test_audio.js - offline verification of src/audio.js (MCAudio).
 *  1. loads the module in fresh vm sandboxes (no AudioContext / fake AudioContext / fake timers)
 *  2. renders every sound variant with the pure DSP, writes WAVs to _ref/agent_out/audio/, checks numerically:
 *     duration, peak, RMS, DC, NaN/Inf, clipping, fades, loop seams, spectral centroid ordering, render time
 *  3. exercises the playback layer + music scheduler against a fake Web Audio implementation (leaks, voice cap,
 *     look-ahead, piece end + fade, stop/restart, suspended context, idempotent init)
 *  4. renders an offline preview of generated music pieces.
 * Usage: node tools/test_audio.js [--no-wav]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'audio.js');
const OUT = path.join(ROOT, '_ref', 'agent_out', 'audio');
const WRITE_WAV = !process.argv.includes('--no-wav');
const CODE = fs.readFileSync(SRC, 'utf8');

// ------------------------------------------------------------------ assertions
let passCount = 0, failCount = 0;
const failures = [];
function check(cond, msg) {
  if (cond) passCount++;
  else { failCount++; failures.push(msg); console.log('  FAIL: ' + msg); }
  return !!cond;
}
function section(t) { console.log('\n=== ' + t + ' ==='); }
const fmt = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : String(v));

// ------------------------------------------------------------------ WAV writer (16-bit PCM)
function writeWav(file, data, sr, channels) {
  channels = channels || 1;
  const n = data.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * channels * 2, 28); buf.writeUInt16LE(channels * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

// ------------------------------------------------------------------ analysis helpers
function fft(re, im) { // in-place radix-2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// magnitude-weighted centroid of the frame-averaged power spectrum
function centroid(x, sr) {
  const N = 1024, hop = 512, P = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  let frames = 0;
  for (let s = 0; s + N <= Math.max(x.length, N); s += hop) {
    for (let i = 0; i < N; i++) { const v = x[s + i] || 0; re[i] = v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k++) { const m = Math.sqrt(P[k] / frames); num += m * k * sr / N; den += m; }
  return den > 0 ? num / den : 0;
}
function stats(x, sr) {
  let peak = 0, sum = 0, sq = 0, bad = 0, clip = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) { bad++; continue; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) clip++;
    sum += v; sq += v * v;
  }
  const n = x.length;
  const head = Math.max(1, Math.round(0.0005 * sr)), tail = Math.max(1, Math.round(0.001 * sr));
  let headMax = 0, tailMax = 0;
  for (let i = 0; i < head; i++) headMax = Math.max(headMax, Math.abs(x[i]));
  for (let i = n - tail; i < n; i++) tailMax = Math.max(tailMax, Math.abs(x[i]));
  return { dur: n / sr, peak, rms: Math.sqrt(sq / n), dc: sum / n, bad, clip, first: Math.abs(x[0]), last: Math.abs(x[n - 1]), headMax, tailMax };
}
function seam(x) { // loop join discontinuity vs typical sample-to-sample step
  const d = [];
  for (let i = 1; i < x.length; i++) d.push(Math.abs(x[i] - x[i - 1]));
  d.sort((a, b) => a - b);
  return { jump: Math.abs(x[0] - x[x.length - 1]), p99: d[Math.floor(d.length * 0.99)], med: d[d.length >> 1] };
}
function rmsRange(x, sr, t0, t1) {
  let s = 0, n = 0;
  for (let i = Math.round(t0 * sr); i < Math.min(x.length, Math.round(t1 * sr)); i++) { s += x[i] * x[i]; n++; }
  return Math.sqrt(s / Math.max(1, n));
}

// ------------------------------------------------------------------ fake Web Audio
function makeFakeAudio(cfg) {
  cfg = cfg || {};
  const log = { contexts: 0, nodes: [], sources: [], resumeCalls: 0, errors: [], panners: [], gains: [], convolvers: [], nonFinite: 0 };
  function fin(...a) { for (const v of a) if (typeof v !== 'number' || !Number.isFinite(v)) { log.nonFinite++; throw new TypeError('non-finite AudioParam argument: ' + v); } }
  class FakeParam {
    constructor(ctx, v) { this.ctx = ctx; this.def = v; this.events = []; }
    valueAt(T) {
      let v = this.def, tPrev = 0, vPrev = this.def;
      const ev = this.events.slice().sort((a, b) => a.t - b.t || a.seq - b.seq);
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i];
        if (e.type === 'lin') {
          if (T >= e.t) { v = e.v; } else { if (T > tPrev) v = vPrev + (e.v - vPrev) * (T - tPrev) / Math.max(1e-9, e.t - tPrev); return v; }
        } else if (e.type === 'exp') {
          if (T >= e.t) v = e.v; else { if (T > tPrev) v = vPrev * Math.pow(e.v / vPrev, (T - tPrev) / Math.max(1e-9, e.t - tPrev)); return v; }
        } else if (e.t > T) return v;
        else if (e.type === 'set') v = e.v;
        else if (e.type === 'target') {
          const next = ev[i + 1], tEnd = next ? Math.min(T, next.t) : T;
          v = e.v + (v - e.v) * Math.exp(-(tEnd - e.t) / Math.max(1e-9, e.tc));
        }
        tPrev = e.t; vPrev = v;
      }
      return v;
    }
    get value() { return this.valueAt(this.ctx.currentTime); }
    set value(v) { fin(v); this.def = v; this.events = this.events.filter(e => e.t > this.ctx.currentTime); this.events.push({ type: 'set', v, t: this.ctx.currentTime, seq: seqN++ }); }
    setValueAtTime(v, t) { fin(v, t); this.events.push({ type: 'set', v, t, seq: seqN++ }); return this; }
    linearRampToValueAtTime(v, t) { fin(v, t); this.events.push({ type: 'lin', v, t, seq: seqN++ }); return this; }
    exponentialRampToValueAtTime(v, t) { fin(v, t); if (v <= 0) throw new RangeError('exponential ramp to <= 0'); this.events.push({ type: 'exp', v, t, seq: seqN++ }); return this; }
    setTargetAtTime(v, t, tc) { fin(v, t, tc); if (tc < 0) throw new RangeError('negative time constant'); this.events.push({ type: 'target', v, t, tc, seq: seqN++ }); return this; }
    cancelScheduledValues(t) { fin(t); this.events = this.events.filter(e => e.t < t); return this; }
  }
  let seqN = 0;
  class FakeNode {
    constructor(ctx, kind) { this.context = ctx; this.kind = kind; this.outs = new Set(); log.nodes.push(this); }
    connect(dest) {
      if (!dest || !(dest instanceof FakeNode)) throw new TypeError('connect: invalid destination');
      if (dest.context !== this.context) throw new Error('connect: cross-context');
      this.outs.add(dest); return dest;
    }
    disconnect() { this.outs.clear(); }
  }
  class FakeBuffer {
    constructor(ch, len, sr) {
      if (!(ch >= 1 && ch <= 32) || !(len >= 1) || !(sr >= 3000 && sr <= 768000)) throw new Error('NotSupportedError: createBuffer(' + ch + ',' + len + ',' + sr + ')');
      this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.duration = len / sr;
      this._d = []; for (let c = 0; c < ch; c++) this._d.push(new Float32Array(len));
    }
    getChannelData(c) { return this._d[c]; }
    copyToChannel(src, c, off) { this._d[c].set(src.subarray(0, this.length - (off || 0)), off || 0); }
  }
  class FakeSource extends FakeNode {
    constructor(ctx) { super(ctx, 'source'); this.buffer = null; this.loop = false; this.onended = null; this.playbackRate = new FakeParam(ctx, 1); this.startT = null; this.stopT = null; this.ended = false; this.calledAt = null; log.sources.push(this); }
    start(when, offset) {
      when = when === undefined ? 0 : when; offset = offset || 0; fin(when, offset);
      if (this.startT !== null) throw new Error('InvalidStateError: start() called twice');
      this.startT = Math.max(when, this.context.currentTime); this.when = when; this.calledAt = this.context.currentTime; this.rate0 = this.playbackRate.value;
    }
    stop(when) {
      when = when === undefined ? 0 : when; fin(when);
      if (this.startT === null) throw new Error('InvalidStateError: stop() before start()');
      this.stopT = when;
    }
    endTime() {
      let e = Infinity;
      if (!this.loop && this.buffer) e = this.startT + this.buffer.duration / Math.max(1e-6, this.rate0);
      if (this.stopT !== null) e = Math.min(e, Math.max(this.stopT, this.startT));
      return e;
    }
  }
  class FakeCtx {
    constructor(opts) {
      if (cfg.throwOnCreate) throw new Error('NotAllowedError: blocked');
      log.contexts++; log.ctx = this;
      this.sampleRate = cfg.sampleRate || 48000; this.currentTime = 0; this.state = cfg.initialState || 'suspended';
      this.destination = new FakeNode(this, 'destination'); this.onstatechange = null; this.opts = opts;
    }
    resume() {
      log.resumeCalls++;
      if (cfg.blockResume) return Promise.reject(new Error('NotAllowedError'));
      return Promise.resolve().then(() => { this.state = 'running'; if (typeof this.onstatechange === 'function') this.onstatechange(); });
    }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { const n = new FakeNode(this, 'gain'); n.gain = new FakeParam(this, 1); log.gains.push(n); return n; }
    createStereoPanner() { const n = new FakeNode(this, 'panner'); n.pan = new FakeParam(this, 0); log.panners.push(n); return n; }
    createDynamicsCompressor() { const n = new FakeNode(this, 'compressor'); for (const p of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[p] = new FakeParam(this, 0); return n; }
    createBiquadFilter() { const n = new FakeNode(this, 'biquad'); n.frequency = new FakeParam(this, 350); n.Q = new FakeParam(this, 1); n.gain = new FakeParam(this, 0); return n; }
    createConvolver() {
      const n = new FakeNode(this, 'convolver'), ctx = this; let b = null; n.normalize = true;
      Object.defineProperty(n, 'buffer', { get: () => b, set: (v) => { if (v && v.sampleRate !== ctx.sampleRate) throw new Error('NotSupportedError: IR sample-rate mismatch'); if (v && [1, 2, 4].indexOf(v.numberOfChannels) < 0) throw new Error('NotSupportedError: IR channels'); b = v; } });
      log.convolvers.push(n); return n;
    }
    createBuffer(ch, len, sr) { return new FakeBuffer(ch, len, sr); }
    createBufferSource() { return new FakeSource(this); }
    advance(dt) {
      if (this.state === 'running') this.currentTime += dt;
      for (const s of log.sources) {
        if (s.context !== this || s.ended || s.startT === null) continue;
        if (s.endTime() <= this.currentTime) {
          s.ended = true;
          if (typeof s.onended === 'function') { try { s.onended({ target: s }); } catch (e) { log.errors.push(e); } }
        }
      }
    }
  }
  function sounding(ctx) { // sources started, not yet ended, whose output still reaches something
    return log.sources.filter(s => s.context === ctx && s.startT !== null && !s.ended && s.endTime() > ctx.currentTime && s.startT <= ctx.currentTime + 1e-9);
  }
  function connectedNodes(ctx) { return log.nodes.filter(n => n.context === ctx && n.outs.size > 0); }
  return { FakeCtx, log, sounding, connectedNodes };
}

// ------------------------------------------------------------------ fake timers + sandbox loader
function makeTimers() {
  const T = { now: 0, seq: 1, list: new Map() };
  T.setTimeout = (fn, ms) => { const id = T.seq++; T.list.set(id, { fn, at: T.now + Math.max(0, +ms || 0), iv: 0 }); return id; };
  T.clearTimeout = id => { T.list.delete(id); };
  T.setInterval = (fn, ms) => { const iv = Math.max(1, +ms || 0), id = T.seq++; T.list.set(id, { fn, at: T.now + iv, iv }); return id; };
  T.clearInterval = id => { T.list.delete(id); };
  T.run = (ms) => {
    const end = T.now + ms;
    for (;;) {
      let bestId = null, best = null;
      for (const [id, t] of T.list) if (t.at <= end && (!best || t.at < best.at)) { best = t; bestId = id; }
      if (!best) break;
      T.now = best.at;
      if (best.iv) best.at += best.iv; else T.list.delete(bestId);
      best.fn();
    }
    T.now = end;
  };
  T.intervals = () => [...T.list.values()].filter(t => t.iv).length;
  return T;
}
function loadModule(extra) {
  const sb = Object.assign({ console, performance, setTimeout, clearTimeout, setInterval, clearInterval }, extra || {});
  vm.createContext(sb);
  vm.runInContext(CODE, sb, { filename: 'audio.js' });
  return sb;
}
const tick = () => new Promise(r => setImmediate(r));
async function settle(promise, timers, maxIter) { // pump fake timers + microtasks until the promise settles
  let done = false, val, err;
  promise.then(v => { done = true; val = v; }, e => { done = true; err = e; });
  for (let i = 0; i < (maxIter || 100000) && !done; i++) { if (timers) timers.run(5); await tick(); }
  if (err) throw err;
  return { done, val };
}

// ------------------------------------------------------------------ expectations
const SPEC_NAMES = ('dig.stone dig.grass dig.gravel dig.sand dig.wood dig.glass dig.cloth dig.snow dig.plant dig.metal ' +
  'step.stone step.grass step.gravel step.sand step.wood step.cloth step.snow step.plant ' +
  'damage.hurt damage.fall_small damage.fall_big damage.death random.eat random.burp random.drink random.pop random.click random.levelup ' +
  'random.orb random.break random.bow random.bowhit random.door_open random.door_close random.chestopen random.chestclosed ' +
  'random.explode random.fuse random.fizz liquid.splash liquid.swim liquid.water liquid.lava liquid.lavapop fire.ignite fire.fire ' +
  'mob.pig.say mob.pig.death mob.cow.say mob.cow.hurt mob.sheep.say mob.chicken.say mob.chicken.hurt mob.chicken.plop ' +
  'mob.zombie.say mob.zombie.hurt mob.zombie.death mob.skeleton.say mob.skeleton.hurt mob.skeleton.death mob.creeper.say mob.creeper.death ' +
  'mob.spider.say mob.spider.death mob.generic.hurt mob.generic.death mob.generic.swing ambient.cave ambient.thunder ' +
  'loop.rain loop.fire loop.wind loop.lava').split(/\s+/);
function durRange(name) {
  if (name.startsWith('loop.')) return [4, 10];
  if (name.startsWith('step.')) return [0.05, 0.2];
  if (name === 'dig.glass' || name === 'dig.metal') return [0.25, 1.0];
  if (name.startsWith('dig.')) return [0.08, 0.4];
  if (name === 'ambient.cave') return [2, 5.5];
  if (name === 'ambient.thunder') return [2.5, 4];
  if (name === 'random.explode') return [0.9, 1.6];
  if (name === 'random.fuse') return [1.2, 1.8];
  if (name === 'random.levelup') return [0.8, 1.6];
  if (/mob\.(cow\.say|zombie\.say|zombie\.death|spider\.death)|fire\.fire/.test(name)) return [0.6, 1.7];
  return [0.03, 1.2];
}
const CENTROID_RATIOS = [ // [a, b, min ratio centroid(a)/centroid(b)]
  ['dig.stone', 'dig.cloth', 1.8], ['dig.glass', 'dig.wood', 1.5], ['dig.gravel', 'dig.cloth', 1.3], ['dig.snow', 'dig.cloth', 1.3],
  ['dig.sand', 'dig.cloth', 1.3], ['dig.grass', 'dig.cloth', 1.3], ['dig.stone', 'dig.wood', 1.1], ['step.stone', 'step.cloth', 1.8],
  ['step.grass', 'step.cloth', 1.3], ['step.sand', 'step.cloth', 1.3], ['mob.chicken.say', 'mob.cow.say', 1.3],
  ['mob.sheep.say', 'mob.zombie.say', 1.2], ['loop.rain', 'loop.lava', 1.5], ['random.click', 'damage.fall_big', 1.5]
];
const CENTROID_ABS = [['random.fuse', '>', 2500], ['random.explode', '<', 900], ['ambient.thunder', '<', 700], ['random.click', '>', 1500],
  ['dig.cloth', '<', 1200], ['dig.glass', '>', 2500], ['loop.lava', '<', 1000], ['step.cloth', '<', 1000]];

// ------------------------------------------------------------------ 1. no AudioContext
async function testNoAudio() {
  section('1. No AudioContext: safe no-ops, API shape, single global');
  const sb = { console, performance, setTimeout, clearTimeout, setInterval, clearInterval };
  vm.createContext(sb);
  const keys0 = Object.keys(sb);
  vm.runInContext(CODE, sb, { filename: 'audio.js' });
  const added = Object.keys(sb).filter(k => keys0.indexOf(k) < 0);
  check(added.length === 1 && added[0] === 'MCAudio', 'exactly one global published (MCAudio), got: ' + added.join(','));
  const A = sb.MCAudio;
  for (const f of ['init', 'play', 'playAt', 'setListener', 'setVolume', 'getVolume', 'startLoop', 'stopLoop', 'setLoopVolume']) check(typeof A[f] === 'function', 'API function ' + f);
  for (const f of ['play', 'stop', 'isPlaying', 'setMood']) check(typeof A.music[f] === 'function', 'API music.' + f);
  check(A.ready === false, 'ready is false before init');
  check(Array.isArray(A.names) && A.names.length === SPEC_NAMES.length, 'names has ' + SPEC_NAMES.length + ' entries (got ' + A.names.length + ')');
  const missing = SPEC_NAMES.filter(n => A.names.indexOf(n) < 0), extra = A.names.filter(n => SPEC_NAMES.indexOf(n) < 0);
  check(!missing.length && !extra.length, 'names match the spec exactly (missing: ' + missing.join(',') + ' extra: ' + extra.join(',') + ')');
  let threw = null;
  try {
    A.play('dig.stone'); A.play('nope', null); A.play(undefined, { vol: NaN });
    A.playAt('dig.stone', 1, 2, 3); A.playAt('dig.stone', NaN, undefined, null, { range: -5 });
    A.setListener(1, 2, 3, 0.5); A.setListener('a', {}, null, NaN);
    A.setVolume('music', 0.3); A.setVolume('bogus', 1); A.setVolume('sfx', NaN);
    const id = A.startLoop('loop.rain', { vol: 1 }); check(!id, 'startLoop returns a falsy id before init');
    A.stopLoop(id); A.stopLoop(42); A.setLoopVolume(42, 0.5);
    A.music.play(); A.music.setMood('cave'); A.music.setMood('bogus'); A.music.stop(); A.music.stop(NaN);
    check(A.music.isPlaying() === false, 'music.isPlaying() false before init');
  } catch (e) { threw = e; }
  check(!threw, 'no API call throws without AudioContext' + (threw ? ': ' + threw.stack : ''));
  check(A.getVolume('music') === 0.3 && A.getVolume('sfx') === 1 && A.getVolume('master') === 1 && A.getVolume('bogus') === 0, 'volumes stored before init / defaults');
  const r1 = await A.init(), r2 = await A.init();
  check(r1 === false && r2 === false && A.ready === false, 'init() resolves false without AudioContext (repeatable)');

  const fk = makeFakeAudio({ throwOnCreate: true });
  const sb2 = loadModule({ AudioContext: fk.FakeCtx });
  let r3; try { r3 = await sb2.MCAudio.init(); } catch (e) { r3 = e; }
  check(r3 === false && sb2.MCAudio.ready === false, 'init() resolves false when AudioContext construction throws');
}

// ------------------------------------------------------------------ 2. render every sound
function testRender(I) {
  section('2. Offline render of every sound variant (pure DSP)');
  if (WRITE_WAV) fs.mkdirSync(OUT, { recursive: true });
  const t0 = performance.now(), all = {}, times = [];
  for (const name of I.ORDER) {
    const s = performance.now(), r = I.RECIPES[name];
    all[name] = [];
    for (let v = 0; v < (r.v || 1); v++) all[name].push(I.renderVariant(name, v));
    times.push([name, performance.now() - s]);
  }
  const total = performance.now() - t0;
  let samples = 0, bytes = 0;
  const rows = [], cent = {};
  for (const name of I.ORDER) {
    const r = I.RECIPES[name], vars = all[name], isLoop = !!r.loop, [dmin, dmax] = durRange(name);
    check(isLoop ? vars.length >= 1 : (vars.length >= 2 && vars.length <= 8), name + ': variant count ' + vars.length);
    let cSum = 0, pk = [], du = [], rm = [];
    vars.forEach((res, v) => {
      const x = res.data, sr = res.sampleRate, st = stats(x, sr), tag = name + '#' + v;
      samples += x.length; bytes += x.length * 4;
      check(res.bad === 0 && st.bad === 0, tag + ': no NaN/Infinity');
      check(st.peak >= 0.7 && st.peak <= 0.9, tag + ': peak ' + fmt(st.peak) + ' in [0.7,0.9]');
      check(st.clip === 0, tag + ': no clipped samples');
      check(Math.abs(st.dc) < 0.01, tag + ': DC offset ' + fmt(st.dc, 4));
      check(st.rms > 0.015 && st.rms < 0.5, tag + ': RMS ' + fmt(st.rms));
      check(st.dur >= dmin && st.dur <= dmax, tag + ': duration ' + fmt(st.dur) + 's in [' + dmin + ',' + dmax + ']');
      check(res.gain > 0 && res.gain <= 1, tag + ': loudness gain ' + fmt(res.gain));
      if (!isLoop) {
        check(st.first < 1e-6 && st.last < 1e-6, tag + ': starts and ends at zero');
        check(st.headMax <= 0.4 * st.peak, tag + ': fade-in present (first 0.5 ms max ' + fmt(st.headMax / st.peak) + ' of peak)');
        check(st.tailMax <= 0.25 * st.peak, tag + ': fade-out present (last 1 ms max ' + fmt(st.tailMax / st.peak) + ' of peak)');
      } else {
        const sm = seam(x);
        check(sm.jump <= Math.max(sm.p99, 4 * sm.med), tag + ': seamless loop join (jump ' + fmt(sm.jump, 4) + ' vs p99 step ' + fmt(sm.p99, 4) + ')');
        const a = rmsRange(x, sr, 0, 0.5), b = rmsRange(x, sr, st.dur - 0.5, st.dur);
        check(a / b > 0.6 && a / b < 1.67, tag + ': loop level constant at both ends (' + fmt(a) + ' vs ' + fmt(b) + ')');
      }
      if (v > 0) {
        const y = vars[0].data, n = Math.min(x.length, y.length, 4000);
        let md = 0; for (let i = 0; i < n; i++) md = Math.max(md, Math.abs(x[i] - y[i]));
        check(md > 0.05, tag + ': differs from variant 0');
      }
      const c = centroid(x, sr); cSum += c; pk.push(st.peak); du.push(st.dur); rm.push(st.rms);
      if (WRITE_WAV) writeWav(path.join(OUT, name.replace(/\./g, '_') + '_' + (v + 1) + '.wav'), x, sr, 1);
    });
    cent[name] = cSum / vars.length;
    rows.push([name, vars.length, vars[0].sampleRate, Math.min(...du), Math.max(...du), Math.max(...pk), rm.reduce((a, b) => a + b) / rm.length, cent[name], r.vol || 1]);
  }
  console.log('\n  name                   var  rate   dur(min-max)   peak   rms    centroid  vol');
  for (const r of rows) console.log('  ' + r[0].padEnd(22) + String(r[1]).padStart(3) + String(r[2]).padStart(7) + '  ' + fmt(r[3], 2).padStart(5) + '-' + fmt(r[4], 2).padEnd(6) +
    '  ' + fmt(r[5], 2) + '  ' + fmt(r[6], 3) + '  ' + fmt(r[7], 0).padStart(7) + '  ' + fmt(r[8], 2));
  section('2b. Spectral centroid sanity (per material / character)');
  for (const [a, b, k] of CENTROID_RATIOS) check(cent[a] >= k * cent[b], 'centroid ' + a + ' (' + fmt(cent[a], 0) + ' Hz) >= ' + k + ' x ' + b + ' (' + fmt(cent[b], 0) + ' Hz)');
  for (const [a, op, v] of CENTROID_ABS) check(op === '>' ? cent[a] > v : cent[a] < v, 'centroid ' + a + ' ' + fmt(cent[a], 0) + ' Hz ' + op + ' ' + v);
  times.sort((a, b) => b[1] - a[1]);
  console.log('\n  sync render of all ' + I.ORDER.length + ' sounds: ' + fmt(total, 0) + ' ms, ' + samples + ' samples (' + fmt(bytes / 1048576, 1) + ' MB as Float32)');
  console.log('  slowest: ' + times.slice(0, 6).map(t => t[0] + ' ' + fmt(t[1], 0) + 'ms').join(', '));
  check(total < 1200, 'total SFX render time ' + fmt(total, 0) + ' ms < 1200 ms');
  return { total, samples, all };
}

// ------------------------------------------------------------------ 3/4. playback + music against fake Web Audio
async function testPlayback() {
  section('3. Playback layer (fake AudioContext, fake timers)');
  const fake = makeFakeAudio({ initialState: 'suspended' }), timers = makeTimers(), listeners = [];
  const sb = loadModule({ AudioContext: fake.FakeCtx, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    addEventListener: (t, h) => listeners.push([t, h]), removeEventListener: (t, h) => { const i = listeners.findIndex(l => l[0] === t && l[1] === h); if (i >= 0) listeners.splice(i, 1); } });
  const A = sb.MCAudio, I = A._internal;
  const p1 = A.init(), p2 = A.init();
  check(p1 === p2, 'init() returns the same promise while pending');
  const r = await settle(p1, timers);
  check(r.done && r.val === true && A.ready === true, 'init() resolves true, ready === true');
  check(fake.log.contexts === 1, 'exactly one AudioContext created');
  const ctx = fake.log.ctx;
  check(fake.log.resumeCalls >= 1 && ctx.state === 'running', 'suspended context was resumed');
  check(ctx.opts && ctx.opts.latencyHint === 'interactive', 'AudioContext created with latencyHint interactive');
  const p3 = A.init(); await settle(p3, timers);
  check(p3 === p1 && fake.log.contexts === 1, 'init() idempotent after success');
  const base = fake.connectedNodes(ctx).length;
  check(base === 4, 'permanent graph: sfx -> master -> compressor -> destination (+music bus) = 4 connected nodes (got ' + base + ')');
  const pump = (sec, dt) => { dt = dt || 0.05; for (let t = 0; t < sec - 1e-9; t += dt) { ctx.advance(dt); timers.run(dt * 1000); } };

  let n0 = fake.log.sources.length, threw = null;
  try { for (const n of A.names) A.play(n, { vol: 0.8, pitch: 1.1, pan: 0.2 }); } catch (e) { threw = e; }
  check(!threw, 'play() of every name does not throw');
  check(fake.log.sources.length - n0 === A.names.length, 'every name produced exactly one source (' + (fake.log.sources.length - n0) + ')');
  const created = fake.log.sources.slice(n0);
  check(created.every(s => s.rate0 >= 1.1 * 0.93 && s.rate0 <= 1.1 * 1.07), 'playbackRate = pitch x jitter within +-6%');
  const g = fake.log.gains.slice(-A.names.length).map(x => x.gain.value);
  check(g.every(v => v > 0 && v <= 1.5), 'per-voice gains in (0, 1.5]');
  check(I.state().voices <= I.MAX_VOICES, 'voice list capped at ' + I.MAX_VOICES + ' (' + I.state().voices + ')');
  pump(6);
  check(fake.log.errors.length === 0, 'no errors thrown from onended handlers');
  check(fake.connectedNodes(ctx).length === base && I.state().voices === 0, 'all one-shot nodes disconnected after playback (connected ' + fake.connectedNodes(ctx).length + ')');

  for (let i = 0; i < 80; i++) A.play(A.names[i % 40], { vol: 0.5 + (i % 5) / 10 });
  pump(0.05, 0.025);
  check(fake.sounding(ctx).length <= I.MAX_VOICES, 'polyphony limited: ' + fake.sounding(ctx).length + ' <= ' + I.MAX_VOICES + ' sounding');
  pump(6);
  for (let i = 0; i < 20; i++) A.play('step.stone');
  pump(0.05, 0.025);
  check(fake.sounding(ctx).length <= 6, 'same sound capped at 6 simultaneous instances (' + fake.sounding(ctx).length + ')');
  pump(2);

  A.setListener(0, 0, 0, 0);
  const lastPan = () => fake.log.panners[fake.log.panners.length - 1].pan.value;
  let np = fake.log.panners.length; A.playAt('dig.stone', 5, 0, 0);
  check(fake.log.panners.length === np + 1 && lastPan() > 0.3, 'yaw 0: source at +X panned right (' + fmt(lastPan()) + ')');
  np = fake.log.panners.length; A.playAt('dig.stone', -5, 0, 0);
  check(fake.log.panners.length === np + 1 && lastPan() < -0.3, 'yaw 0: source at -X panned left');
  np = fake.log.panners.length; n0 = fake.log.sources.length; A.playAt('dig.stone', 0, 0, -5);
  check(fake.log.sources.length === n0 + 1 && fake.log.panners.length === np, 'source straight ahead (-Z) is centred');
  n0 = fake.log.sources.length; A.playAt('dig.stone', 0, 0, 17);
  check(fake.log.sources.length === n0, 'source beyond 16 blocks is silent (not played)');
  A.setListener(0, 0, 0, Math.PI / 2);
  np = fake.log.panners.length; A.playAt('dig.stone', 0, 0, -5);
  check(fake.log.panners.length === np + 1 && lastPan() > 0.3, 'yaw +90deg (looking -X): source at -Z is on the right');
  A.setListener(0, 0, 0, 0);
  A.playAt('random.explode', 0, 0, -4); const gNear = fake.log.gains[fake.log.gains.length - 1].gain.value;
  A.playAt('random.explode', 0, 0, -36); const gFar = fake.log.gains[fake.log.gains.length - 1].gain.value;
  check(gFar > 0 && gFar < gNear * 0.45, 'explosion audible at 36 blocks (range 48) and attenuated linearly (' + fmt(gNear) + ' -> ' + fmt(gFar) + ')');
  n0 = fake.log.sources.length; A.playAt('dig.stone', 0, 0, -30, { range: 48 });
  check(fake.log.sources.length === n0 + 1, 'opts.range extends audibility');
  pump(3);

  const [gMaster, gSfx, gMusic] = fake.log.gains.slice(0, 3);
  A.setVolume('sfx', 0.3); A.setVolume('music', 5); A.setVolume('master', 0.5); A.setVolume('bogus', 1); A.setVolume('sfx', NaN);
  pump(0.5);
  check(Math.abs(gSfx.gain.value - 0.3) < 0.01 && A.getVolume('sfx') === 0.3, 'setVolume(sfx) ramps the sfx bus (' + fmt(gSfx.gain.value) + ')');
  check(A.getVolume('music') === 1 && Math.abs(gMusic.gain.value - 1) < 0.01, 'setVolume clamps to 1');
  check(Math.abs(gMaster.gain.value - 0.5 * 0.75) < 0.01, 'master volume applied (with headroom scale)');
  A.setVolume('sfx', 1); A.setVolume('music', 0.5); A.setVolume('master', 1);

  n0 = fake.log.sources.length;
  const id = A.startLoop('loop.rain', { vol: 0.5 });
  const ls = fake.log.sources[fake.log.sources.length - 1];
  check(id > 0 && fake.log.sources.length === n0 + 1 && ls.loop === true, 'startLoop returns an id and starts a looping source');
  const lg = fake.log.gains[fake.log.gains.length - 1];
  pump(1);
  const lv = lg.gain.value; A.setLoopVolume(id, 1); pump(1);
  check(lg.gain.value > lv * 1.8, 'setLoopVolume ramps the loop gain (' + fmt(lv) + ' -> ' + fmt(lg.gain.value) + ')');
  const id2 = A.startLoop('loop.fire');
  A.stopLoop(id); pump(1);
  check(ls.ended && fake.connectedNodes(ctx).length === base + 2, 'stopLoop fades, stops and disconnects the loop (other loop still running)');
  A.stopLoop(id2); pump(1);
  check(fake.connectedNodes(ctx).length === base, 'all loops cleaned up');
  const id3 = A.startLoop('fire.fire'), fs3 = fake.log.sources[fake.log.sources.length - 1];
  check(id3 > 0 && fs3.loop && fs3.loopStart > 0 && fs3.loopEnd > fs3.loopStart && fs3.loopEnd < fs3.buffer.duration, 'startLoop on a one-shot loops its sustained middle (loopStart/loopEnd)');
  A.stopLoop(id3); pump(1);
  let t2 = null; try { A.stopLoop(id); A.stopLoop(12345); A.setLoopVolume(12345, 1); t2 = A.startLoop('nope'); } catch (e) { t2 = e; }
  check(t2 === 0, 'unknown loop ids / names are harmless no-ops');

  // fuzz: garbage arguments must never throw, never reach an AudioParam as non-finite, never exceed the voice cap
  const garbage = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 0.5, 2, 1e9, 'x', {}, [], true];
  let seedF = 12345; const rnd = () => (seedF = (seedF * 1103515245 + 12345) >>> 0) / 4294967296;
  const gb = () => garbage[Math.floor(rnd() * garbage.length)];
  let fz = null, maxV = 0;
  try {
    for (let i = 0; i < 3000; i++) {
      const nm = rnd() < 0.85 ? A.names[i % A.names.length] : gb();
      A.play(nm, rnd() < 0.6 ? { vol: gb(), pitch: gb(), pan: gb() } : gb());
      A.playAt(nm, gb(), gb(), gb(), rnd() < 0.5 ? { vol: gb(), range: gb(), pitch: gb(), pan: gb() } : gb());
      if (i % 40 === 0) {
        A.setListener(gb(), gb(), gb(), gb()); A.setVolume(gb(), gb()); A.getVolume(gb());
        const lid = A.startLoop(nm, rnd() < 0.5 ? { vol: gb(), pitch: gb() } : gb()); A.setLoopVolume(lid, gb()); A.stopLoop(lid, gb());
        A.music.setMood(gb());
      }
      maxV = Math.max(maxV, I.state().voices);
      if (i % 7 === 0) pump(0.01, 0.01);
    }
  } catch (e) { fz = e; }
  check(!fz, 'fuzzed API calls never throw' + (fz ? ': ' + fz.stack : ''));
  check(fake.log.nonFinite === 0, 'no non-finite value ever reached an AudioParam (' + fake.log.nonFinite + ' attempts)');
  check(maxV <= I.MAX_VOICES, 'voice cap held during fuzzing (max ' + maxV + ')');
  A.setListener(0, 0, 0, 0); A.music.setMood('calm');
  pump(35); // longest possible one-shot: 8 s loop buffer at pitch 0.25
  if (fake.connectedNodes(ctx).length !== base) console.log('  DEBUG connected:', fake.connectedNodes(ctx).map(n => n.kind + (n.kind === 'source' ? '(loop=' + n.loop + ',start=' + n.startT + ',stop=' + n.stopT + ',ended=' + n.ended + ')' : '')).join(' '), 'state', JSON.stringify(I.state()), 'now', ctx.currentTime.toFixed(2));
  check(fake.connectedNodes(ctx).length === base && I.state().voices === 0 && I.state().loops === 0, 'everything cleaned up after fuzzing (' + fake.connectedNodes(ctx).length + ' connected)');

  ctx.state = 'suspended';
  const rc = fake.log.resumeCalls; n0 = fake.log.sources.length;
  A.play('dig.stone'); A.play('dig.wood');
  check(fake.log.sources.length === n0, 'no sounds queued while the context is suspended (avoids bursts on resume)');
  check(fake.log.resumeCalls > rc, 'play() on a suspended context attempts resume()');
  await tick(); await tick();
  check(ctx.state === 'running', 'context running again after resume');
  const hooked = listeners.length;
  check(hooked === 0, 'gesture listeners removed once the context runs (' + hooked + ' left)');
  return { A, I, fake, ctx, timers, base, pump };
}

async function testMusic(env) {
  section('4. Music scheduler (fake clock)');
  const { A, I, fake, ctx, timers, base, pump } = env;
  A.music.setMood('calm');
  const s0 = fake.log.sources.length, t0 = ctx.currentTime;
  A.music.play();
  const P = I.piece();
  check(A.music.isPlaying() && P && P.state === 'playing', 'music.play() starts a piece');
  A.music.play();
  check(I.piece() === P, 'music.play() while playing is a no-op');
  check(timers.intervals() === 1, 'one scheduler interval running');
  const fe = P.fade.gain.events;
  check(fe.some(e => e.type === 'set' && e.v === 0) && fe.some(e => e.type === 'lin' && e.v === 1 && Math.abs(e.t - t0 - I.MUSIC_FADE_IN) < 0.01), 'piece fades in over ~4 s');
  let endAt = null, maxQueued = 0, maxLiveNotes = 0;
  for (let t = 0; t < 400; t += 0.05) {
    ctx.advance(0.05); timers.run(50);
    const st = I.state(); maxLiveNotes = Math.max(maxLiveNotes, st.pieceNotes);
    if (I.piece()) maxQueued = Math.max(maxQueued, I.piece().queue.length);
    if (!A.music.isPlaying()) { endAt = ctx.currentTime - t0; break; }
  }
  const ms = fake.log.sources.slice(s0);
  const ahead = ms.map(s => s.when - s.calledAt);
  const maxAhead = Math.max(...ahead), minAhead = Math.min(...ahead);
  console.log('  piece: ' + ms.length + ' notes, length ' + fmt(endAt, 1) + ' s, scheduled ' + fmt(minAhead) + '..' + fmt(maxAhead) + ' s ahead, max live notes ' + maxLiveNotes + ', dropped ' + P.dropped);
  check(endAt !== null && endAt >= 88 && endAt <= 190, 'piece ends by itself after ' + fmt(endAt, 1) + ' s (90-180 s target)');
  check(ms.length >= 40, 'piece has a reasonable number of notes (' + ms.length + ')');
  check(minAhead >= 0 && maxAhead <= I.LOOKAHEAD + 0.01, 'every note scheduled within the look-ahead window (<= ' + I.LOOKAHEAD + ' s)');
  check(P.dropped === 0, 'no late notes dropped at normal tick rate');
  check(maxLiveNotes < 80, 'bounded number of live note nodes (' + maxLiveNotes + ')');
  check(P.fade.gain.events.some(e => e.type === 'lin' && e.v === 0), 'piece fades out at its end');
  check(fake.log.convolvers.length >= 1 && fake.log.convolvers[0].buffer && Math.abs(fake.log.convolvers[0].buffer.duration - 3.5) < 0.01 &&
    fake.log.convolvers[0].buffer.sampleRate === ctx.sampleRate && fake.log.convolvers[0].buffer.numberOfChannels === 2, 'stereo 3.5 s reverb IR at context rate');
  pump(3);
  check(timers.intervals() === 0 && !I.state().timer, 'scheduler interval cleared after the piece ended');
  check(ms.every(s => s.ended), 'all music sources ended');
  check(fake.connectedNodes(ctx).length === base, 'no music nodes left connected after the piece (' + fake.connectedNodes(ctx).length + ' vs ' + base + ')');

  A.music.play(); pump(25);
  const P2 = I.piece(), n2 = P2.scheduled;
  check(n2 > 0, 'second piece scheduled notes (' + n2 + ')');
  check(P2.seed !== P.seed, 'each piece uses a new seed');
  A.music.stop(2);
  check(!A.music.isPlaying() && I.dyingPieces().length === 1, 'stop() -> isPlaying() false immediately, piece fading');
  A.music.play();
  const P3 = I.piece();
  check(A.music.isPlaying() && P3 && P3 !== P2, 'play() right after stop() starts a fresh piece while the old one fades');
  pump(3);
  check(I.dyingPieces().length === 0 && P2.notes.length === 0 && P2.state === 'done', 'stopped piece fully cleaned after its fade');
  A.music.setMood('cave'); pump(60);
  check(!!I.piece().buses.cave, 'setMood(cave): later notes routed through the cave voice/reverb');
  const caveConv = fake.log.convolvers.find(c => c.buffer && Math.abs(c.buffer.duration - 5.5) < 0.01);
  check(!!caveConv, 'cave mood uses the longer 5.5 s reverb tail');
  A.music.stop(0.5); pump(2);
  check(timers.intervals() === 0 && fake.connectedNodes(ctx).length === base, 'after stop(): no timers, no connected music nodes');

  A.music.setMood('calm'); A.music.play(); pump(10);
  const P4 = I.piece(), sch = P4.scheduled;
  ctx.state = 'suspended';
  timers.run(30000); // 30 s of wall time on a frozen clock
  check(P4.scheduled - sch <= 12, 'suspended clock: scheduler does not run ahead (' + (P4.scheduled - sch) + ' extra notes)');
  ctx.state = 'running'; pump(5);
  A.music.stop(0.2); pump(1);
  check(fake.connectedNodes(ctx).length === base && timers.intervals() === 0, 'clean after suspended/resumed piece');
  for (let k = 0; k < 4; k++) { A.music.setMood(k % 2 ? 'cave' : 'calm'); A.music.play(); pump(40); A.music.stop(0.2); pump(1); }
  check(I.state().noteBufs <= 72, 'note buffer cache LRU-bounded after several pieces (' + I.state().noteBufs + ' <= 72)');
  check(fake.log.errors.length === 0, 'no errors in onended handlers during music');
  A.music.setMood('calm'); A.music.play(); pump(5);
  ctx.state = 'closed'; timers.run(1000);
  check(!A.music.isPlaying() && timers.intervals() === 0 && fake.connectedNodes(ctx).length === base, 'closed context: piece dropped, interval cleared, nodes disconnected');
  let t3 = null; try { A.play('dig.stone'); A.music.play(); A.startLoop('loop.rain'); } catch (e) { t3 = e; }
  check(!t3 && timers.intervals() <= 1, 'API calls on a closed context do not throw');
  timers.run(1000);
}

// ------------------------------------------------------------------ 5. composer (pure)
function composeAll(I, seed, mood, switchAt, mood2) {
  const C = I.createComposer(seed, mood), ev = [];
  let ph, k = 0;
  while ((ph = C.next())) { if (switchAt !== undefined && k === switchAt) C.setMood(mood2); for (const e of ph.events) ev.push(e); k++; }
  return { C, ev };
}
function testComposer(I) {
  section('5. Composer (pure): structure, determinism, moods');
  const sig = new Set(), agg = { calm: { midi: 0, n: 0, dens: 0, pieces: 0 }, cave: { midi: 0, n: 0, dens: 0, pieces: 0 } };
  let allOk = true, lenOk = true, gapsOk = true, sortedOk = true, lens = [];
  for (let s = 1; s <= 24; s++) {
    for (const mood of ['calm', 'cave']) {
      const { C, ev } = composeAll(I, s * 7919, mood);
      lens.push(C.t);
      if (C.t < 88 || C.t > 185) lenOk = false;
      const piano = ev.filter(e => e.voice === 'piano');
      for (const e of ev) if (!(Number.isFinite(e.t) && Number.isFinite(e.midi) && e.midi >= 24 && e.midi <= 96 && e.vel > 0 && e.vel <= 0.9 && Math.abs(e.pan) <= 0.5)) allOk = false;
      const on = piano.map(e => e.t).sort((a, b) => a - b);
      let bigGaps = 0; for (let i = 1; i < on.length; i++) if (on[i] - on[i - 1] >= 3) bigGaps++;
      if (bigGaps < 2) gapsOk = false;
      agg[mood].midi += piano.reduce((a, e) => a + e.midi, 0); agg[mood].n += piano.length; agg[mood].dens += piano.length / (C.t / 60); agg[mood].pieces++;
      sig.add(ev.slice(0, 12).map(e => e.midi + '@' + e.t.toFixed(2)).join(','));
    }
  }
  const a = composeAll(I, 4242, 'calm').ev, b = composeAll(I, 4242, 'calm').ev;
  check(JSON.stringify(a) === JSON.stringify(b), 'composer is deterministic for a given seed');
  check(sig.size >= 46, 'different seeds give different pieces (' + sig.size + '/48 unique openings)');
  check(allOk, 'all events finite, midi 24..96, velocity (0,0.9], |pan| <= 0.5');
  check(lenOk, 'piece lengths within 88-185 s (min ' + fmt(Math.min(...lens), 1) + ', max ' + fmt(Math.max(...lens), 1) + ')');
  check(gapsOk, 'every piece has long silences (>= 2 gaps of 3 s+ between note onsets)');
  const cm = agg.calm.midi / agg.calm.n, vm2 = agg.cave.midi / agg.cave.n, cd = agg.calm.dens / agg.calm.pieces, vd = agg.cave.dens / agg.cave.pieces;
  console.log('  calm: avg midi ' + fmt(cm, 1) + ', ' + fmt(cd, 1) + ' notes/min | cave: avg midi ' + fmt(vm2, 1) + ', ' + fmt(vd, 1) + ' notes/min');
  check(vm2 < cm - 3, 'cave mood is in a lower register');
  check(vd < cd * 0.9, 'cave mood is sparser');
  check(cd > 12 && cd < 70, 'calm density is sparse but not empty (' + fmt(cd, 1) + ' notes/min)');
  const { ev } = composeAll(I, 99, 'calm', 2, 'cave');
  const early = ev.filter(e => e.timbre === 'calm' && e.voice === 'piano'), late = ev.filter(e => e.timbre === 'cave' && e.voice === 'piano');
  check(early.length > 0 && late.length > 0, 'mood switch mid-piece changes timbre for subsequent phrases');
  if (early.length && late.length) {
    const ae = early.reduce((s, e) => s + e.midi, 0) / early.length, al = late.reduce((s, e) => s + e.midi, 0) / late.length;
    check(al < ae, 'after switching to cave the register drops (' + fmt(ae, 1) + ' -> ' + fmt(al, 1) + ')');
  }
  let ordered = true; const C = I.createComposer(5, 'calm'); let ph;
  while ((ph = C.next())) for (let i = 1; i < ph.events.length; i++) if (ph.events[i].t < ph.events[i - 1].t) ordered = false;
  check(ordered && sortedOk, 'events sorted by time within each phrase');
}

// ------------------------------------------------------------------ 6. offline music preview
function renderPreview(I, seed, mood, maxSec, file) {
  const sr = I.RATE_MUSIC, { C, ev } = composeAll(I, seed, mood), total = Math.min(maxSec, C.t + 1), n = Math.round(total * sr);
  const L = new Float32Array(n), R = new Float32Array(n), cache = {};
  const t0 = performance.now();
  for (const e of ev) {
    if (e.t >= total) continue;
    const k = e.voice + e.timbre + e.midi;
    const buf = cache[k] || (cache[k] = e.voice === 'pad' ? I.renderPad(sr, e.midi, e.timbre) : I.renderPiano(sr, e.midi, e.timbre));
    const g = I.noteLevel(e);
    const pl = Math.cos((e.pan + 1) * Math.PI / 4), pr = Math.sin((e.pan + 1) * Math.PI / 4), s = Math.round(e.t * sr);
    for (let i = 0; i < buf.length && s + i < n; i++) {
      let env = 1;
      if (e.voice === 'pad' && e.dur > 0 && i / sr > e.dur) env = Math.exp(-(i / sr - e.dur) / 0.6);
      L[s + i] += buf[i] * g * env * pl; R[s + i] += buf[i] * g * env * pr;
    }
  }
  const synthMs = performance.now() - t0;
  const wl = Float32Array.from(L), wr = Float32Array.from(R), t60 = mood === 'cave' ? 5.5 : 3.5;
  I.dsp.reverb(wl, sr, t60, 0.5, 1, 0, 1.0); I.dsp.reverb(wr, sr, t60, 0.5, 1, 0, 1.07);
  const dryG = mood === 'cave' ? 0.55 : 0.75, wetG = mood === 'cave' ? 0.75 : 0.55;
  const out = new Float32Array(n * 2);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, fade = Math.min(1, t / 4) * Math.min(1, (total - t) / 3);
    const l = (L[i] * dryG + wl[i] * wetG) * fade, r = (R[i] * dryG + wr[i] * wetG) * fade;
    out[2 * i] = l; out[2 * i + 1] = r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const mono = new Float32Array(n); let sq = 0, sqn = 0;
  for (let i = 0; i < n; i++) { mono[i] = (out[2 * i] + out[2 * i + 1]) / 2; if (mono[i] !== 0) { sq += mono[i] * mono[i]; sqn++; } }
  const rmsActive = Math.sqrt(sq / Math.max(1, sqn));
  const win = Math.round(0.1 * sr); let quiet = 0, wins = 0;
  for (let s = 0; s + win <= n; s += win) { let q = 0; for (let i = s; i < s + win; i++) q += mono[i] * mono[i]; if (Math.sqrt(q / win) < peak * 0.01) quiet++; wins++; }
  if (WRITE_WAV) { const sc = peak > 0.85 ? 0.85 / peak : 1; for (let i = 0; i < out.length; i++) out[i] *= sc; writeWav(path.join(OUT, file), out, sr, 2); }
  if (process.argv.includes('--png')) sheet(path.join(OUT, 'spec_' + file.replace('.wav', '.png')), [{ label: file + ' ' + total.toFixed(0) + 'S', x: mono, sr }], { tw: 1200, sh: 160, cols: 1 });
  return { total, peak, rms: rmsActive, quietFrac: quiet / wins, notes: ev.filter(e => e.t < total).length, synthMs, cent: centroid(mono, sr), distinct: Object.keys(cache).length };
}
function testPreview(I) {
  section('6. Offline music preview (' + (WRITE_WAV ? 'WAV written' : 'no WAV') + ')');
  for (const [seed, mood, sec, file] of [[2024, 'calm', 200, 'music_calm_preview.wav'], [77, 'cave', 200, 'music_cave_preview.wav']]) {
    const r = renderPreview(I, seed, mood, sec, file);
    console.log('  ' + mood + ': ' + fmt(r.total, 1) + ' s, ' + r.notes + ' notes, ' + r.distinct + ' distinct voices, raw peak ' + fmt(r.peak) + ', rms ' + fmt(r.rms, 4) + ', quiet ' + fmt(r.quietFrac * 100, 0) + '% of 100 ms windows, centroid ' + fmt(r.cent, 0) + ' Hz, synth ' + fmt(r.synthMs, 0) + ' ms');
    check(r.peak > 0.05 && r.peak < 1.5, mood + ': music level sane (raw peak ' + fmt(r.peak) + ')');
    check(r.cent > 150 && r.cent < 2000, mood + ': warm spectrum (centroid ' + fmt(r.cent, 0) + ' Hz)');
    check(r.synthMs / Math.max(1, r.distinct) < 25, mood + ': piano/pad voice synthesis cheap enough for lazy rendering (' + fmt(r.synthMs / Math.max(1, r.distinct), 1) + ' ms/voice)');
  }
  const x = I.renderPiano(I.RATE_MUSIC, 60, 'calm'), st = stats(x, I.RATE_MUSIC);
  check(st.bad === 0 && st.peak <= 0.81 && st.dur >= 2 && st.dur <= 4.6 && st.last < 1e-3, 'piano C4: finite, normalised, 2-4.5 s with a faded tail');
  const ir = I.makeIR(48000, 3.5, 1);
  check(ir.length === 2 && ir[0].length === 168000 && stats(ir[0], 48000).bad === 0, 'IR: stereo 3.5 s, finite');
  check(rmsRange(ir[0], 48000, 3.0, 3.4) < rmsRange(ir[0], 48000, 0.05, 0.4) * 0.01, 'IR decays by > 40 dB over its length');
}

// ------------------------------------------------------------------ 7. real-timer async init timing
async function testAsyncInit() {
  section('7. Async init timing (real timers, fake AudioContext)');
  const fake = makeFakeAudio({ initialState: 'running' });
  globalThis.AudioContext = fake.FakeCtx; // fresh main-realm instance (realistic speed)
  vm.runInThisContext(CODE, { filename: 'audio.js' });
  const sb = { MCAudio: globalThis.MCAudio };
  const t0 = performance.now();
  const ok = await sb.MCAudio.init();
  const wall = performance.now() - t0;
  delete globalThis.AudioContext;
  const st = sb.MCAudio._internal.state();
  console.log('  init(): ' + fmt(wall, 0) + ' ms wall (render ' + fmt(st.renderMs, 0) + ' ms incl. yields), ' + fake.log.sources.length + ' sources, ' + fake.log.contexts + ' ctx');
  check(ok === true && sb.MCAudio.ready, 'init resolves true with real timers');
  check(wall < 1500, 'init completes in ' + fmt(wall, 0) + ' ms (< 1500 ms incl. yields)');
  return wall;
}

// ------------------------------------------------------------------ optional: spectrogram contact sheets (--png)
const zlib = require('zlib');
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function writePng(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const FONT = { // 3x5 glyphs, rows as 3-bit masks
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4],
  Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], 0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [6, 1, 2, 4, 7], 3: [6, 1, 2, 1, 6], 4: [5, 5, 7, 1, 1], 5: [7, 4, 6, 1, 6],
  6: [3, 4, 7, 5, 7], 7: [7, 1, 2, 2, 2], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 6], '.': [0, 0, 0, 0, 2], '_': [0, 0, 0, 0, 7], '-': [0, 0, 7, 0, 0], ' ': [0, 0, 0, 0, 0], S_: [0, 0, 0, 0, 0]
};
function drawText(img, W, x, y, s, col) {
  s = s.toUpperCase();
  for (let c = 0; c < s.length; c++) {
    const g = FONT[s[c]] || FONT[' '];
    for (let r = 0; r < 5; r++) for (let b = 0; b < 3; b++) if (g[r] & (4 >> b)) for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      const px = x + c * 8 + b * 2 + sx, py = y + r * 2 + sy, o = (py * W + px) * 3;
      if (o >= 0 && o < img.length - 2) { img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; }
    }
  }
}
function heat(v) { // 0..1 -> rgb
  const stops = [[0, 0, 0], [20, 0, 90], [150, 0, 90], [240, 90, 0], [255, 220, 50], [255, 255, 255]], p = Math.max(0, Math.min(1, v)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), f = p - i;
  return stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
}
function sheet(file, items, opt) { // items: [{label, x, sr}]
  opt = opt || {};
  const TW = opt.tw || 240, SH = opt.sh || 110, WH = 30, LH = 14, cols = opt.cols || 4, TH = LH + SH + WH + 4, rows = Math.ceil(items.length / cols), W = cols * (TW + 4), H = rows * TH;
  const img = Buffer.alloc(W * H * 3, 24);
  items.forEach((it, idx) => {
    const ox = (idx % cols) * (TW + 4), oy = Math.floor(idx / cols) * TH, x = it.x, sr = it.sr, N = 512;
    drawText(img, W, ox + 2, oy + 2, it.label, [220, 220, 220]);
    const hop = Math.max(1, (x.length - N) / TW), re = new Float64Array(N), im = new Float64Array(N), cols2 = [];
    let mx = 1e-12;
    for (let c = 0; c < TW; c++) {
      const s = Math.floor(c * hop);
      for (let i = 0; i < N; i++) { re[i] = (x[s + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
      fft(re, im);
      const mag = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) { mag[k] = Math.hypot(re[k], im[k]); if (mag[k] > mx) mx = mag[k]; }
      cols2.push(mag);
    }
    const fLo = 50, fHi = sr / 2;
    for (let c = 0; c < TW; c++) for (let r = 0; r < SH; r++) {
      const f = fLo * Math.pow(fHi / fLo, 1 - r / (SH - 1)), k = Math.min(N / 2 - 1, Math.round(f * N / sr));
      const db = 20 * Math.log10(cols2[c][k] / mx + 1e-9), col = heat((db + 80) / 80), o = ((oy + LH + r) * W + ox + c) * 3;
      img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2];
    }
    for (const fm of [100, 1000, 10000]) { if (fm >= fHi) continue; const r = Math.round((1 - Math.log(fm / fLo) / Math.log(fHi / fLo)) * (SH - 1)); for (let c = 0; c < TW; c += 4) { const o = ((oy + LH + r) * W + ox + c) * 3; img[o] = 90; img[o + 1] = 90; img[o + 2] = 90; } }
    const spp = x.length / TW;
    for (let c = 0; c < TW; c++) {
      let m = 0; for (let i = Math.floor(c * spp); i < Math.floor((c + 1) * spp); i++) m = Math.max(m, Math.abs(x[i] || 0));
      const hgt = Math.round(m * (WH - 2));
      for (let r = 0; r < hgt; r++) { const o = ((oy + LH + SH + WH - 1 - r) * W + ox + c) * 3; img[o] = 60; img[o + 1] = 200; img[o + 2] = 90; }
    }
  });
  writePng(file, W, H, img);
}
function makeSheets(I, all) {
  fs.mkdirSync(OUT, { recursive: true });
  const groups = { blocks: n => /^(dig|step)\./.test(n), world: n => /^(damage|random|liquid|fire)\./.test(n), mobs: n => /^mob\./.test(n), ambient: n => /^(ambient|loop)\./.test(n) };
  for (const g in groups) {
    const items = [];
    for (const n of I.ORDER) if (groups[g](n)) {
      const vs = all[n], take = g === 'ambient' ? vs.length : 1;
      for (let v = 0; v < take; v++) items.push({ label: n + (take > 1 ? '#' + (v + 1) : '') + ' ' + (vs[v].data.length / vs[v].sampleRate).toFixed(2) + 'S', x: vs[v].data, sr: vs[v].sampleRate });
    }
    sheet(path.join(OUT, 'spec_' + g + '.png'), items);
  }
  const notes = [36, 48, 60, 72, 84].map(m => ({ label: 'PIANO CALM ' + m, x: I.renderPiano(I.RATE_MUSIC, m, 'calm'), sr: I.RATE_MUSIC }))
    .concat([36, 60].map(m => ({ label: 'PIANO CAVE ' + m, x: I.renderPiano(I.RATE_MUSIC, m, 'cave'), sr: I.RATE_MUSIC })))
    .concat([{ label: 'PAD CALM 55', x: I.renderPad(I.RATE_MUSIC, 55, 'calm'), sr: I.RATE_MUSIC }]);
  sheet(path.join(OUT, 'spec_music_voices.png'), notes);
  console.log('  spectrogram sheets written to ' + OUT + ' (spec_*.png)');
}

(async function main() {
  const T0 = performance.now();
  const wall = await testAsyncInit(); // first, on a fresh heap (closest to page start-up)
  await testNoAudio();
  // main-realm instance for the DSP tests: vm sandboxes make global lookups much slower than a browser would
  vm.runInThisContext(CODE, { filename: 'audio.js' });
  const I = globalThis.MCAudio._internal;
  const rend = testRender(I);
  if (process.argv.includes('--png')) makeSheets(I, rend.all);
  const env = await testPlayback();
  await testMusic(env);
  testComposer(I);
  testPreview(I);
  section('Summary');
  console.log('  sync SFX render ' + fmt(rend.total, 0) + ' ms | async init ' + fmt(wall, 0) + ' ms | total test time ' + fmt((performance.now() - T0) / 1000, 1) + ' s');
  console.log('  ' + passCount + ' checks passed, ' + failCount + ' failed' + (WRITE_WAV ? ' | WAVs in ' + OUT : ''));
  if (failCount) { console.log('\nFailures:\n  ' + failures.slice(0, 60).join('\n  ')); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exitCode = 2; });
