/* audio.js - MCAudio: procedural sound engine for the single-file Minecraft clone.
 * Every SFX and the generative ambient piano music are synthesised at runtime in plain JS.
 * Layering:
 *   1. DSP primitives + sound recipes  -> pure functions of (sampleRate, seeded PRNG); run under Node.
 *   2. Music composer                  -> pure, seeded, phrase-by-phrase event generator.
 *   3. Playback layer                  -> the only code touching Web Audio (init/play/loops/music player).
 * Public API: see SPEC_AUDIO.md. Internal test hooks live on the non-enumerable MCAudio._internal.
 *
 * Notes for the engine:
 *  - Call MCAudio.init() from the first user gesture and await it (~0.4-0.6 s of time-sliced rendering).
 *    Until it resolves true every call is a silent no-op. Sounds requested while the context is suspended
 *    are dropped (never queued); the context is resumed automatically on the next gesture.
 *  - Levels are pre-balanced: step.* are already quiet, ambient.cave is soft. Vanilla-like usage:
 *    break = play('dig.x', {pitch: 0.8}), place = play('dig.x', {vol: 0.8, pitch: 0.8}),
 *    mining tick = play('dig.x', {vol: 0.25, pitch: 0.5}), step = playAt('step.x', ...).
 *  - playAt ranges: 16 blocks by default, random.explode 48, ambient.thunder 256; opts.range overrides.
 *    Call setListener(x, y, z, yaw) every frame (yaw 0 = looking -Z, increasing = turning left).
 *  - Polyphony: 24 one-shot voices (quietest/most-finished stolen), max 6 of the same name.
 *  - Loops: startLoop('loop.rain'|'loop.fire'|'loop.wind'|'loop.lava', {vol}) -> id (0 = not started);
 *    stopLoop(id[, fadeSeconds=0.3]). One-shot names may be looped too (their faded edges are skipped).
 *  - Music: when !music.isPlaying(), wait a random pause (vanilla: minutes) and call music.play();
 *    pieces last ~1.5-3 min and fade out on their own. music.setMood('cave') underground, 'calm' otherwise.
 */
(function (G) {
  'use strict';
  var M = Math; // local alias: avoids slow global lookups in hot DSP loops

  // =====================================================================================
  // 0. Constants & small utilities
  // =====================================================================================
  var TAU = M.PI * 2;
  var RATE_HI = 32000;   // short / bright one-shots
  var RATE_LO = 22050;   // long, dark sounds, loops (and music notes)
  var RATE_MUSIC = 22050;
  var PEAK = 0.8;        // every rendered buffer is normalised to this peak

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function mtof(m) { return 440 * M.pow(2, (m - 69) / 12); }

  function hashStr(s) { // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = M.imul(h, 0x01000193); }
    return h >>> 0;
  }

  function makeRng(seed) { // mulberry32 + helpers
    var a = (seed >>> 0) || 0x9e3779b9;
    var r = function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = M.imul(a ^ (a >>> 15), 1 | a);
      t = (t + M.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = function (lo, hi) { return lo + (hi - lo) * r(); };
    r.int = function (lo, hi) { return lo + M.floor((hi - lo + 1) * r()); };
    r.pick = function (arr) { return arr[M.floor(r() * arr.length) % arr.length]; };
    r.chance = function (p) { return r() < p; };
    r.bi = function () { return r() * 2 - 1; };
    r.gauss = function () { var u = r() || 1e-9, v = r(); return M.sqrt(-2 * M.log(u)) * M.cos(TAU * v); };
    return r;
  }

  // =====================================================================================
  // 1. DSP primitives (all operate on Float32Array, in place where sensible)
  // =====================================================================================
  function alloc(sr, sec) { return new Float32Array(M.max(1, M.round(sr * sec))); }

  // add src into dst at sample offset (clipped to dst length)
  function mix(dst, src, off, gain) {
    off = M.round(off || 0); gain = (gain === undefined) ? 1 : gain;
    var i0 = M.max(0, -off), i1 = M.min(src.length, dst.length - off);
    for (var i = i0; i < i1; i++) dst[i + off] += src[i] * gain;
    return dst;
  }
  // circular add (for seamless loops): anything past the end wraps to the start
  function mixWrap(dst, src, off, gain) {
    var n = dst.length; off = ((M.round(off) % n) + n) % n; gain = (gain === undefined) ? 1 : gain;
    for (var i = 0; i < src.length; i++) dst[(i + off) % n] += src[i] * gain;
    return dst;
  }

  function noise(n, rng) { var b = new Float32Array(n); for (var i = 0; i < n; i++) b[i] = rng() * 2 - 1; return b; }
  function pink(n, rng) { // Paul Kellet economy pink
    var b = new Float32Array(n), b0 = 0, b1 = 0, b2 = 0;
    for (var i = 0; i < n; i++) {
      var w = rng() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      b[i] = (b0 + b1 + b2 + w * 0.1848) * 0.3;
    }
    return b;
  }
  function brown(n, rng) {
    var b = new Float32Array(n), s = 0;
    for (var i = 0; i < n; i++) { s = (s + 0.02 * (rng() * 2 - 1)) / 1.02; b[i] = s * 3.5; }
    return b;
  }

  function lp1(x, fc, sr) { // one-pole low-pass
    var a = 1 - M.exp(-TAU * clamp(fc, 1, sr * 0.49) / sr), y = 0;
    for (var i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = y; }
    return x;
  }
  function hp1(x, fc, sr) { // one-pole high-pass
    var a = 1 - M.exp(-TAU * clamp(fc, 1, sr * 0.49) / sr), y = 0;
    for (var i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = x[i] - y; }
    return x;
  }

  // RBJ biquad coefficients -> out[0..4] = b0,b1,b2,a1,a2 (normalised)
  var BQ = new Float64Array(5);
  function bqc(type, f, q, sr, gainDb, out) {
    out = out || BQ;
    var w0 = TAU * clamp(f, 5, sr * 0.47) / sr, cs = M.cos(w0), sn = M.sin(w0);
    var alpha = sn / (2 * M.max(q, 0.05)), b0, b1, b2, a0, a1, a2, A;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else if (type === 'bp') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else if (type === 'notch') { b0 = 1; b1 = -2 * cs; b2 = 1; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else { // 'peak'
      A = M.pow(10, (gainDb || 0) / 40);
      b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
    }
    out[0] = b0 / a0; out[1] = b1 / a0; out[2] = b2 / a0; out[3] = a1 / a0; out[4] = a2 / a0;
    return out;
  }
  function bq(x, type, f, q, sr, gainDb) { // static biquad, transposed DF-II
    var c = bqc(type, f, q, sr, gainDb), b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4], z1 = 0, z2 = 0;
    for (var i = 0; i < x.length; i++) {
      var xi = x[i], y = b0 * xi + z1; z1 = b1 * xi - a1 * y + z2; z2 = b2 * xi - a2 * y; x[i] = y;
    }
    return x;
  }
  // time-varying biquad: fFn(tSec) -> Hz, q number or fn(tSec); coefficients updated every 16 samples
  var BQS = new Float64Array(5);
  function bqSweep(x, type, fFn, q, sr, gainDb) {
    var n = x.length, z1 = 0, z2 = 0, qf = typeof q === 'function';
    for (var i = 0; i < n; i += 16) {
      var t = i / sr, c = bqc(type, fFn(t), qf ? q(t) : q, sr, gainDb, BQS);
      var b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4], e = M.min(n, i + 16);
      for (var j = i; j < e; j++) {
        var xi = x[j], y = b0 * xi + z1; z1 = b1 * xi - a1 * y + z2; z2 = b2 * xi - a2 * y; x[j] = y;
      }
    }
    return x;
  }

  // envelope: silent before t0, linear attack `att`, exponential decay with time-constant `tau`
  function envAD(x, sr, att, tau, t0) {
    var n = x.length, s0 = M.round((t0 || 0) * sr), na = M.max(1, M.round(att * sr));
    var k = M.exp(-1 / (M.max(tau, 1e-4) * sr)), g = 1;
    for (var i = 0; i < n; i++) {
      var j = i - s0;
      if (j < 0) x[i] = 0;
      else if (j < na) x[i] *= j / na;
      else { x[i] *= g; g *= k; }
    }
    return x;
  }
  // piecewise-linear envelope; pts = [t0,v0, t1,v1, ...] (seconds), held flat outside
  function envPts(x, sr, pts) {
    var n = x.length, k = 0, np = pts.length >> 1;
    for (var i = 0; i < n; i++) {
      var t = i / sr;
      while (k < np - 1 && t > pts[(k + 1) * 2]) k++;
      var v;
      if (t <= pts[0]) v = pts[1];
      else if (k >= np - 1) v = pts[np * 2 - 1];
      else {
        var ta = pts[k * 2], tb = pts[k * 2 + 2], va = pts[k * 2 + 1], vb = pts[k * 2 + 3];
        v = tb > ta ? va + (vb - va) * (t - ta) / (tb - ta) : vb;
      }
      x[i] *= v;
    }
    return x;
  }
  // multiply by a control signal
  function mul(x, c) { for (var i = 0; i < x.length; i++) x[i] *= c[i]; return x; }
  function scale(x, g) { for (var i = 0; i < x.length; i++) x[i] *= g; return x; }

  // smoothed random control signal in [-1,1] (cosine-interpolated random points at `rate` Hz)
  function smoothRand(rng, n, sr, rate) {
    var out = new Float32Array(n), step = M.max(1, M.round(sr / M.max(rate, 0.01)));
    var a = rng() * 2 - 1, b = rng() * 2 - 1;
    for (var i = 0; i < n; i++) {
      var ph = (i % step) / step;
      if (ph === 0 && i > 0) { a = b; b = rng() * 2 - 1; }
      var w = 0.5 - 0.5 * M.cos(M.PI * ph);
      out[i] = a + (b - a) * w;
    }
    return out;
  }

  // oscillator. f: number or fn(tSec). shape: sine | tri | saw | sq (polyBLEP for saw/sq)
  function blep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }
  function osc(sr, dur, f, shape, phase) {
    var n = M.max(1, M.round(dur * sr)), out = new Float32Array(n), ph = phase || 0, ff = typeof f === 'function';
    var fr = ff ? 0 : f;
    for (var i = 0; i < n; i++) {
      if (ff) fr = f(i / sr);
      var dt = clamp(fr / sr, 0, 0.45), v;
      if (shape === 'saw') v = 2 * ph - 1 - blep(ph, dt);
      else if (shape === 'sq') { v = (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep((ph + 0.5) % 1, dt); }
      else if (shape === 'tri') v = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
      else v = M.sin(TAU * ph);
      out[i] = v;
      ph += dt; if (ph >= 1) ph -= 1;
    }
    return out;
  }
  // pitch-swept sine "thump": f = f1 + (f0-f1)*exp(-t/sweepTau), amp exp(-t/ampTau), 1 ms attack
  function thud(sr, dur, f0, f1, sweepTau, ampTau) {
    var n = M.max(1, M.round(dur * sr)), out = new Float32Array(n), ph = 0, g = 1;
    var k = M.exp(-1 / (ampTau * sr)), ks = M.exp(-1 / (sweepTau * sr)), df = f0 - f1, na = M.round(0.001 * sr) || 1;
    for (var i = 0; i < n; i++) {
      out[i] = M.sin(ph) * g * (i < na ? i / na : 1);
      ph += TAU * (f1 + df) / sr; df *= ks; g *= k;
    }
    return out;
  }
  // add an exponentially decaying sinusoid (modal resonance) starting at t0 (damped 2nd-order recursion)
  function addMode(x, sr, t0, f, tau, amp, phase) {
    if (!(f > 0) || f >= sr * 0.47 || !(amp !== 0)) return x;
    var s = M.max(0, M.round(t0 * sr)), n = M.min(x.length - s, M.ceil(tau * sr * 8.5));
    if (n <= 0) return x;
    var w = TAU * f / sr, r = M.exp(-1 / (tau * sr)), c = 2 * r * M.cos(w), r2 = r * r, p = phase || 0;
    var y0 = amp * M.sin(p), y1 = amp * r * M.sin(w + p);
    x[s] += y0; if (n > 1) x[s + 1] += y1;
    for (var i = 2; i < n; i++) { var y = c * y1 - r2 * y0; x[s + i] += y; y0 = y1; y1 = y; }
    return x;
  }
  // modes: array of [ratioOrHz, tau, amp]; base multiplies the first entry
  function addModes(x, sr, t0, base, modes, ampScale, rng) {
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i];
      addMode(x, sr, t0, base * m[0], m[1], m[2] * (ampScale || 1), rng ? rng() * TAU : 0);
    }
    return x;
  }
  // Karplus-Strong plucked string
  function pluck(sr, dur, f, fb, rng, soft) {
    var n = M.max(1, M.round(dur * sr)), out = new Float32Array(n);
    var N = M.max(2, M.round(sr / f)), d = new Float32Array(N), s = 0, p = 0, i;
    for (i = 0; i < N; i++) { s += (1 - (soft || 0)) * ((rng() * 2 - 1) - s); d[i] = s; }
    for (i = 0; i < n; i++) {
      var q = (p + 1) % N, y = d[p];
      out[i] = y; d[p] = fb * 0.5 * (y + d[q]); p = q;
    }
    return out;
  }

  function drive(x, amt) { // tanh soft saturation (keeps peak scale)
    var k = M.tanh(amt);
    for (var i = 0; i < x.length; i++) x[i] = M.tanh(amt * x[i]) / k;
    return x;
  }

  // mono Schroeder/Freeverb-style reverb, in place (x must already contain room for the tail)
  function reverb(x, sr, t60, damp, wet, dry, size) {
    var combs = [0.0297, 0.0371, 0.0411, 0.0437, 0.0253, 0.0327], aps = [0.0051, 0.0017];
    var n = x.length, acc = new Float32Array(n), sz = size || 1, i, c;
    for (c = 0; c < combs.length; c++) {
      var D = M.max(2, M.round(combs[c] * sz * sr)), buf = new Float32Array(D), idx = 0, filt = 0;
      var fb = M.pow(10, -3 * (D / sr) / M.max(t60, 0.05)), dm = damp;
      for (i = 0; i < n; i++) {
        var y = buf[idx]; filt = y * (1 - dm) + filt * dm; buf[idx] = x[i] + filt * fb;
        acc[i] += y; if (++idx >= D) idx = 0;
      }
    }
    for (c = 0; c < aps.length; c++) {
      var D2 = M.max(2, M.round(aps[c] * sz * sr)), b2 = new Float32Array(D2), j = 0;
      for (i = 0; i < n; i++) { var bo = b2[j], inp = acc[i]; acc[i] = bo - inp; b2[j] = inp + bo * 0.5; if (++j >= D2) j = 0; }
    }
    var wg = wet / combs.length;
    for (i = 0; i < n; i++) x[i] = x[i] * dry + acc[i] * wg;
    return x;
  }
  // feedback echo with low-passed repeats, in place
  function echo(x, sr, delay, fb, lpfc, wet) {
    var D = M.max(1, M.round(delay * sr)), buf = new Float32Array(D), k = 0, s = 0;
    var a = 1 - M.exp(-TAU * lpfc / sr);
    for (var i = 0; i < x.length; i++) {
      var y = buf[k]; s += a * (y - s); buf[k] = x[i] + s * fb; x[i] += wet * s;
      if (++k >= D) k = 0;
    }
    return x;
  }

  function peakAbs(x) { var p = 0; for (var i = 0; i < x.length; i++) { var a = x[i] < 0 ? -x[i] : x[i]; if (a > p) p = a; } return p; }
  function fadeIn(x, sr, sec) { var n = M.min(x.length, M.max(1, M.round(sec * sr))); for (var i = 0; i < n; i++) x[i] *= i / n; return x; }
  function fadeOut(x, sr, sec) {
    var L = x.length, n = M.min(L, M.max(1, M.round(sec * sr)));
    for (var i = 0; i < n; i++) x[L - 1 - i] *= i / n;
    return x;
  }
  function dcBlock(x, sr, fc) { // 1st-order DC blocker
    var R = 1 - TAU * (fc || 12) / sr, x1 = 0, y1 = 0;
    for (var i = 0; i < x.length; i++) { var y = x[i] - x1 + R * y1; x1 = x[i]; y1 = y; x[i] = y; }
    return x;
  }
  function sanitize(x) { var bad = 0; for (var i = 0; i < x.length; i++) { var v = x[i]; if (v !== v || v === Infinity || v === -Infinity) { x[i] = 0; bad++; } } return bad; }
  // cut trailing near-silence (keeps minSec)
  function trimTail(x, sr, rel, minSec) {
    var p = peakAbs(x), thr = p * rel, last = x.length - 1;
    while (last > 0 && M.abs(x[last]) < thr) last--;
    var keep = M.max(last + M.round(0.004 * sr), M.round((minSec || 0) * sr));
    return keep < x.length ? x.slice(0, keep) : x;
  }
  // loudest short-term RMS (window `win` s) - used to balance perceived loudness between sounds
  function stRmsMax(x, sr, win) {
    var W = M.max(1, M.round((win || 0.05) * sr)), s = 0, best = 0, i;
    for (i = 0; i < x.length; i++) {
      s += x[i] * x[i]; if (i >= W) s -= x[i - W] * x[i - W];
      if (s > best) best = s;
    }
    return M.sqrt(best / M.min(W, x.length));
  }

  // =====================================================================================
  // 2. Higher-level building blocks
  // =====================================================================================
  function norm(x, p) { var m = peakAbs(x); if (m > 1e-12) scale(x, (p === undefined ? 1 : p) / m); return x; }
  function chunk(x, amt) { return drive(norm(x, 1), amt); }

  // filtered noise burst, normalised to peak 1 (times o.amp)
  // o: {color:'white'|'pink'|'brown', hp, lp (one-pole), hp2/lp2/bp/bp2:[f,q] (biquads), sweep:{type,f0,f1,q,dur}, att, tau}
  function burst(sr, rng, dur, o) {
    var n = M.max(1, M.round(dur * sr));
    var x = o.color === 'pink' ? pink(n, rng) : (o.color === 'brown' ? brown(n, rng) : noise(n, rng));
    if (o.hp) hp1(x, o.hp, sr);
    if (o.lp) lp1(x, o.lp, sr);
    if (o.hp2) bq(x, 'hp', o.hp2[0], o.hp2[1], sr);
    if (o.lp2) bq(x, 'lp', o.lp2[0], o.lp2[1], sr);
    if (o.bp) bq(x, 'bp', o.bp[0], o.bp[1], sr);
    if (o.bp2) bq(x, 'bp', o.bp2[0], o.bp2[1], sr);
    if (o.sweep) {
      var s = o.sweep, sd = s.dur || dur;
      bqSweep(x, s.type || 'bp', function (t) { var u = M.min(1, t / sd); return s.f0 * M.pow(s.f1 / s.f0, u); }, s.q || 1, sr);
    }
    envAD(x, sr, o.att || 0.001, o.tau || dur / 4, 0);
    norm(x, o.amp === undefined ? 1 : o.amp);
    return x;
  }

  // grain cloud: many tiny noise grains, each through a random band-pass resonator
  // o: {n, t0, t1, dist (>1 front-loaded), gl:[min,max] sec, f:[lo,hi] Hz (log-uniform), q, decay (amp tau), amp, jit}
  function grains(x, sr, rng, o) {
    var maxLen = M.ceil((o.gl[1] + 0.03) * sr), tmp = new Float32Array(maxLen), q = o.q || 4;
    for (var g = 0; g < o.n; g++) {
      var t = o.t0 + (o.t1 - o.t0) * M.pow(rng(), o.dist || 1);
      var len = M.max(2, M.round(rng.range(o.gl[0], o.gl[1]) * sr));
      var f = o.f[0] * M.pow(o.f[1] / o.f[0], rng());
      var ring = M.min(maxLen - len, M.round((3 * q / (M.PI * f) + 0.002) * sr));
      var L = len + M.max(0, ring), i;
      for (i = 0; i < L; i++) tmp[i] = i < len ? (rng() * 2 - 1) * M.sin(M.PI * i / len) : 0;
      var sub = tmp.subarray(0, L);
      bq(sub, 'bp', f, q, sr);
      var a = (o.decay ? M.exp(-(t - o.t0) / o.decay) : 1) * (1 - (o.jit === undefined ? 0.6 : o.jit) * rng());
      norm(sub, a * (o.amp === undefined ? 1 : o.amp));
      mix(x, sub, M.round(t * sr), 1);
    }
    return x;
  }

  // formant voice. o: {f0:fn(t), form:fn(t)->[[f,bw,g],...], jit, rough (0..1 subharmonic growl), breath,
  //                   vib:[rate,depth], src:'saw'|'sq', tilt (one-pole lp Hz), env:[t,v,...]}
  function vocal(sr, rng, dur, o) {
    var n = M.max(1, M.round(dur * sr)), src = new Float32Array(n), ph = 0, odd = false, i;
    var jit = smoothRand(rng, n, sr, 25), rough = o.rough || 0, br = o.breath || 0, vib = o.vib;
    var jamt = o.jit === undefined ? 0.008 : o.jit;
    for (i = 0; i < n; i++) {
      var t = i / sr, f = o.f0(t) * (1 + jamt * jit[i]);
      if (vib) f *= 1 + vib[1] * M.sin(TAU * vib[0] * t);
      var dt = clamp(f / sr, 0, 0.45), v;
      if (o.src === 'sq') v = (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep((ph + 0.5) % 1, dt);
      else v = 2 * ph - 1 - blep(ph, dt);
      if (rough && odd) v *= 1 - rough;
      src[i] = v + br * (rng() * 2 - 1);
      ph += dt; if (ph >= 1) { ph -= 1; odd = !odd; }
    }
    lp1(src, o.tilt || 2500, sr);
    var out = new Float32Array(n), band = new Float32Array(n), nf = o.form(0).length;
    for (var k = 0; k < nf; k++) {
      band.set(src);
      (function (k) {
        bqSweep(band, 'bp', function (t) { return o.form(t)[k][0]; }, function (t) { var fm = o.form(t)[k]; return fm[0] / fm[1]; }, sr);
      })(k);
      var g0 = o.form(0)[k][2];
      for (i = 0; i < n; i += 32) { // formant gain follows the (interpolated) vowel, linearly per 32-sample block
        var e = M.min(n, i + 32), g1 = o.form(e / sr)[k][2], dg = (g1 - g0) / (e - i);
        for (var j = i; j < e; j++) out[j] += band[j] * (g0 + dg * (j - i));
        g0 = g1;
      }
    }
    if (o.env) envPts(out, sr, o.env);
    return norm(out, 1);
  }
  // interpolate between formant sets: sets = [[t, [[f,bw,g],...]], ...]
  function formLerp(sets) {
    return function (t) {
      if (t <= sets[0][0]) return sets[0][1];
      for (var i = 0; i < sets.length - 1; i++) {
        var a = sets[i], b = sets[i + 1];
        if (t <= b[0]) {
          var u = (t - a[0]) / M.max(1e-6, b[0] - a[0]), r = [];
          for (var k = 0; k < a[1].length; k++) r.push([a[1][k][0] + (b[1][k][0] - a[1][k][0]) * u, a[1][k][1] + (b[1][k][1] - a[1][k][1]) * u, a[1][k][2] + (b[1][k][2] - a[1][k][2]) * u]);
          return r;
        }
      }
      return sets[sets.length - 1][1];
    };
  }
  var VOW = { // [F, bandwidth, gain] (adult male-ish; scale for animals)
    a: [[730, 90, 1], [1090, 110, 0.5], [2440, 170, 0.18]],
    o: [[570, 80, 1], [840, 100, 0.45], [2410, 170, 0.12]],
    u: [[320, 70, 1], [870, 100, 0.3], [2240, 170, 0.08]],
    e: [[530, 80, 1], [1840, 130, 0.45], [2480, 170, 0.2]],
    i: [[300, 70, 1], [2290, 150, 0.35], [3010, 200, 0.2]],
    ae: [[660, 90, 1], [1720, 130, 0.5], [2410, 170, 0.2]],
    uh: [[640, 90, 1], [1190, 110, 0.45], [2390, 170, 0.15]],
    m: [[260, 60, 1], [900, 150, 0.08], [2200, 200, 0.03]]
  };
  function vowel(name, s) { return VOW[name].map(function (f) { return [f[0] * (s || 1), f[1] * (s || 1), f[2]]; }); }
  function exps(a, b, T) { return function (t) { return a * M.pow(b / a, M.min(1, t / T)); }; } // exp glide a->b over T
  function pts(p) { var arr = p; return function (t) { // piecewise-linear value function from [t,v,...]
    if (t <= arr[0]) return arr[1];
    for (var i = 0; i < arr.length - 2; i += 2) if (t <= arr[i + 2]) return arr[i + 1] + (arr[i + 3] - arr[i + 1]) * (t - arr[i]) / M.max(1e-6, arr[i + 2] - arr[i]);
    return arr[arr.length - 1];
  }; }

  // stick-slip creak: impulse train at time-varying rate exciting resonances
  // o: {rate:fn(t) Hz, res:[[f,q,g],...], jit, env:[t,v,...]}
  function creak(sr, rng, dur, o) {
    var n = M.max(1, M.round(dur * sr)), exc = new Float32Array(n), ph = 0, i, gr = smoothRand(rng, n, sr, 30);
    for (i = 0; i < n; i++) {
      ph += o.rate(i / sr) * (1 + (o.jit || 0.15) * (rng() - 0.5)) / sr;
      if (ph >= 1) { ph -= 1; exc[i] = (0.6 + 0.4 * rng()) * (0.55 + 0.45 * gr[i]); } // grainy stick-slip intensity
    }
    var out = new Float32Array(n), tmp = new Float32Array(n);
    for (var k = 0; k < o.res.length; k++) {
      tmp.set(exc); bq(tmp, 'bp', o.res[k][0], o.res[k][1], sr); norm(tmp, o.res[k][2]);
      for (i = 0; i < n; i++) out[i] += tmp[i];
    }
    dcBlock(out, sr, 40);
    if (o.env) envPts(out, sr, o.env);
    return norm(out, 1);
  }

  // rising "bubble" blip added at t0 (f rises by factor (1+rise) over ~3 tau)
  function bubble(x, sr, t0, f0, rise, tau, amp) {
    var s = M.round(t0 * sr), n = M.min(x.length - s, M.ceil(tau * sr * 7)), ph = 0, g = amp;
    var k = M.exp(-1 / (tau * sr)), na = M.max(1, M.round(0.0015 * sr)), T3 = 3 * tau;
    for (var i = 0; i < n; i++) {
      var t = i / sr; ph += TAU * f0 * (1 + rise * M.min(1, t / T3)) / sr;
      x[s + i] += M.sin(ph) * g * (i < na ? i / na : 1); g *= k;
    }
    return x;
  }
  // short broadband click with a little resonance
  function tick(x, sr, rng, t0, f, amp, tau) {
    var c = burst(sr, rng, 0.004, { hp: 1500, att: 0.0002, tau: 0.0008 });
    mix(x, c, M.round(t0 * sr), amp);
    addMode(x, sr, t0, f, tau || 0.006, amp * 0.6, rng() * TAU);
    return x;
  }

  // =====================================================================================
  // 3. Sound recipes. def(name, opts, fn(sr, rng, variantIndex) -> Float32Array)
  //    opts: v variants, rate, vol (base playback gain), loop, fi/fo fade sec, jitter, range, noTrim
  // =====================================================================================
  var RECIPES = {}, ORDER = [];
  function def(name, o, fn) { o.fn = fn; o.name = name; RECIPES[name] = o; ORDER.push(name); }

  // ---------------------------------------------------------------- block materials
  def('dig.stone', { v: 4, vol: 0.9 }, function (sr, rng) {
    var out = alloc(sr, 0.3);
    mix(out, burst(sr, rng, 0.015, { hp: 2500, att: 0.0004, tau: 0.003 }), 0, 0.8);
    mix(out, burst(sr, rng, 0.26, { bp: [rng.range(1500, 2400), 0.9], att: 0.001, tau: rng.range(0.03, 0.045) }), 0, 1.0);
    mix(out, burst(sr, rng, 0.2, { lp2: [700, 0.8], att: 0.002, tau: 0.035 }), 0, 0.5);
    mix(out, thud(sr, 0.12, rng.range(200, 260), 90, 0.02, 0.025), 0, 0.45);
    grains(out, sr, rng, { n: rng.int(10, 16), t0: 0.004, t1: 0.17, dist: 1.8, gl: [0.001, 0.004], f: [1200, 5000], q: 5, decay: 0.05, amp: 0.55 });
    return chunk(out, 1.3);
  });
  def('step.stone', { v: 4, vol: 0.32 }, function (sr, rng) {
    var out = alloc(sr, 0.14);
    mix(out, burst(sr, rng, 0.01, { hp: 3000, att: 0.0003, tau: 0.002 }), 0, 0.7);
    mix(out, burst(sr, rng, 0.12, { bp: [rng.range(1800, 2800), 1.0], att: 0.001, tau: 0.018 }), 0, 0.9);
    mix(out, thud(sr, 0.08, rng.range(170, 210), 100, 0.015, 0.018), 0, 0.4);
    grains(out, sr, rng, { n: rng.int(3, 6), t0: 0.003, t1: 0.06, dist: 1.5, gl: [0.0008, 0.003], f: [1500, 4500], q: 5, decay: 0.04, amp: 0.4 });
    return out;
  });
  function woodKnock(out, sr, rng, t0, f1, len, amp) {
    mix(out, burst(sr, rng, 0.012, { lp: 3500, att: 0.0005, tau: 0.004 }), M.round(t0 * sr), 0.5 * amp);
    var m = new Float32Array(out.length);
    addModes(m, sr, t0, f1, [[1, 0.07 * len, 1], [rng.range(2.3, 2.7), 0.045 * len, 0.55], [rng.range(4.0, 5.0), 0.028 * len, 0.35], [rng.range(7, 9), 0.015 * len, 0.2]], 1, rng);
    mix(out, norm(m, 1), 0, 0.9 * amp);
  }
  def('dig.wood', { v: 4, vol: 0.9 }, function (sr, rng) {
    var out = alloc(sr, 0.3), f1 = rng.range(160, 230);
    woodKnock(out, sr, rng, 0, f1, 1, 1);
    mix(out, burst(sr, rng, 0.2, { bp: [rng.range(700, 1100), 1.3], att: 0.001, tau: 0.035 }), 0, 0.45);
    if (rng.chance(0.5)) woodKnock(out, sr, rng, rng.range(0.025, 0.05), f1 * rng.range(1.05, 1.2), 0.6, 0.35);
    return chunk(out, 1.4);
  });
  def('step.wood', { v: 4, vol: 0.35 }, function (sr, rng) {
    var out = alloc(sr, 0.14), f1 = rng.range(230, 320), m = new Float32Array(out.length);
    mix(out, burst(sr, rng, 0.01, { lp: 3000, att: 0.0004, tau: 0.003 }), 0, 0.5);
    addModes(m, sr, 0, f1, [[1, 0.035, 1], [rng.range(2.3, 2.7), 0.022, 0.5], [rng.range(4.2, 5), 0.012, 0.25]], 1, rng);
    mix(out, norm(m, 1), 0, 0.9);
    mix(out, burst(sr, rng, 0.08, { bp: [1200, 1.2], att: 0.001, tau: 0.015 }), 0, 0.3);
    return out;
  });
  def('dig.grass', { v: 4, vol: 0.85 }, function (sr, rng) {
    var out = alloc(sr, 0.26);
    mix(out, burst(sr, rng, 0.24, { bp: [rng.range(1300, 1900), 0.7], att: 0.004, tau: rng.range(0.05, 0.07) }), 0, 0.7);
    grains(out, sr, rng, { n: rng.int(40, 60), t0: 0, t1: 0.18, dist: 1.6, gl: [0.001, 0.004], f: [1800, 6000], q: 1.5, decay: 0.08, amp: 0.6, jit: 0.7 });
    mix(out, burst(sr, rng, 0.1, { lp2: [350, 0.7], att: 0.002, tau: 0.025 }), 0, 0.35);
    return out;
  });
  def('step.grass', { v: 4, vol: 0.32 }, function (sr, rng) {
    var out = alloc(sr, 0.12);
    mix(out, burst(sr, rng, 0.11, { bp: [rng.range(1500, 2200), 0.7], att: 0.003, tau: 0.028 }), 0, 0.7);
    grains(out, sr, rng, { n: rng.int(12, 20), t0: 0, t1: 0.075, dist: 1.4, gl: [0.001, 0.003], f: [2000, 6000], q: 1.5, decay: 0.04, amp: 0.5 });
    mix(out, burst(sr, rng, 0.05, { lp2: [320, 0.7], att: 0.002, tau: 0.015 }), 0, 0.25);
    return out;
  });
  def('dig.gravel', { v: 4, vol: 0.85 }, function (sr, rng) {
    var out = alloc(sr, 0.3);
    grains(out, sr, rng, { n: rng.int(55, 80), t0: 0, t1: 0.22, dist: 1.5, gl: [0.0005, 0.002], f: [400, 2600], q: 6, decay: 0.09, amp: 1.0, jit: 0.8 });
    mix(out, thud(sr, 0.12, 130, 70, 0.02, 0.04), 0, 0.4);
    mix(out, burst(sr, rng, 0.25, { bp: [900, 0.6], att: 0.002, tau: 0.07 }), 0, 0.35);
    return chunk(out, 1.2);
  });
  def('step.gravel', { v: 4, vol: 0.34 }, function (sr, rng) {
    var out = alloc(sr, 0.14);
    grains(out, sr, rng, { n: rng.int(15, 25), t0: 0, t1: 0.1, dist: 1.4, gl: [0.0005, 0.0018], f: [500, 2600], q: 6, decay: 0.05, amp: 1.0, jit: 0.8 });
    mix(out, thud(sr, 0.07, 140, 80, 0.015, 0.02), 0, 0.3);
    mix(out, burst(sr, rng, 0.12, { bp: [1000, 0.6], att: 0.002, tau: 0.03 }), 0, 0.3);
    return out;
  });
  def('dig.sand', { v: 4, vol: 0.85 }, function (sr, rng) {
    var out = alloc(sr, 0.28);
    mix(out, burst(sr, rng, 0.27, { bp: [rng.range(1400, 2200), 0.6], att: 0.012, tau: 0.07 }), 0, 0.8);
    grains(out, sr, rng, { n: rng.int(30, 50), t0: 0.005, t1: 0.2, dist: 1.3, gl: [0.0003, 0.001], f: [2500, 7000], q: 1, decay: 0.1, amp: 0.35 });
    mix(out, burst(sr, rng, 0.1, { lp2: [300, 0.7], att: 0.004, tau: 0.03 }), 0, 0.25);
    return out;
  });
  def('step.sand', { v: 4, vol: 0.3 }, function (sr, rng) {
    var out = alloc(sr, 0.13);
    mix(out, burst(sr, rng, 0.12, { bp: [rng.range(1700, 2400), 0.6], att: 0.008, tau: 0.03 }), 0, 0.8);
    grains(out, sr, rng, { n: rng.int(10, 15), t0: 0.003, t1: 0.08, dist: 1.2, gl: [0.0003, 0.001], f: [2500, 7000], q: 1, decay: 0.05, amp: 0.3 });
    return out;
  });
  def('dig.cloth', { v: 4, vol: 0.9 }, function (sr, rng) {
    var out = alloc(sr, 0.22);
    mix(out, burst(sr, rng, 0.21, { lp2: [rng.range(500, 800), 0.7], att: 0.006, tau: 0.05 }), 0, 1.0);
    mix(out, thud(sr, 0.15, rng.range(100, 120), 65, 0.03, 0.04), 0, 0.45);
    grains(out, sr, rng, { n: rng.int(6, 10), t0: 0, t1: 0.1, dist: 1.2, gl: [0.001, 0.004], f: [800, 2000], q: 1, decay: 0.06, amp: 0.12 });
    return out;
  });
  def('step.cloth', { v: 4, vol: 0.36 }, function (sr, rng) {
    var out = alloc(sr, 0.13);
    mix(out, burst(sr, rng, 0.12, { lp2: [rng.range(450, 650), 0.7], att: 0.005, tau: 0.03 }), 0, 1.0);
    mix(out, thud(sr, 0.1, 90, 60, 0.02, 0.03), 0, 0.4);
    return out;
  });
  function squeak(sr, rng, dur, f, res) {
    return creak(sr, rng, dur, { rate: function () { return f; }, res: [[res, 5, 1], [res * 1.9, 6, 0.4]], jit: 0.25, env: [0, 0, dur * 0.2, 1, dur, 0] });
  }
  def('dig.snow', { v: 4, vol: 0.8 }, function (sr, rng) {
    var out = alloc(sr, 0.26);
    mix(out, burst(sr, rng, 0.24, { bp: [rng.range(1000, 1500), 0.8], att: 0.01, tau: 0.06 }), 0, 0.6);
    grains(out, sr, rng, { n: rng.int(30, 45), t0: 0.004, t1: 0.18, dist: 1.4, gl: [0.0008, 0.003], f: [1500, 4500], q: 3, decay: 0.08, amp: 0.7 });
    mix(out, squeak(sr, rng, 0.06, rng.range(350, 600), rng.range(1800, 2600)), M.round(0.01 * sr), 0.22);
    return out;
  });
  def('step.snow', { v: 4, vol: 0.32 }, function (sr, rng) {
    var out = alloc(sr, 0.14);
    mix(out, burst(sr, rng, 0.12, { bp: [rng.range(1100, 1600), 0.8], att: 0.008, tau: 0.03 }), 0, 0.6);
    grains(out, sr, rng, { n: rng.int(10, 16), t0: 0.003, t1: 0.09, dist: 1.3, gl: [0.0008, 0.0025], f: [1500, 4500], q: 3, decay: 0.05, amp: 0.7 });
    mix(out, squeak(sr, rng, 0.04, rng.range(400, 650), rng.range(1800, 2600)), M.round(0.008 * sr), 0.15);
    return out;
  });
  function swish(sr, rng, dur, f0, f1, q) {
    var x = burst(sr, rng, dur, { color: 'pink', sweep: { type: 'bp', f0: f0, f1: f1, q: q, dur: dur * 0.8 }, att: dur * 0.12, tau: dur * 0.3 });
    return x;
  }
  def('dig.plant', { v: 4, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 0.19), up = rng.chance(0.6);
    var a = rng.range(1200, 1800), b = rng.range(3500, 5000);
    mix(out, swish(sr, rng, 0.18, up ? a : b, up ? b : a, 1.2), 0, 0.8);
    grains(out, sr, rng, { n: rng.int(10, 20), t0: 0.005, t1: 0.11, dist: 1.2, gl: [0.0008, 0.003], f: [3000, 7000], q: 2, decay: 0.06, amp: 0.35 });
    return out;
  });
  def('step.plant', { v: 4, vol: 0.28 }, function (sr, rng) {
    var out = alloc(sr, 0.12), a = rng.range(1500, 2200), b = rng.range(3500, 5000);
    mix(out, swish(sr, rng, 0.11, a, b, 1.2), 0, 0.8);
    grains(out, sr, rng, { n: rng.int(5, 10), t0: 0.003, t1: 0.07, dist: 1.2, gl: [0.0008, 0.0025], f: [3000, 7000], q: 2, decay: 0.04, amp: 0.3 });
    return out;
  });
  def('dig.glass', { v: 3, vol: 0.8 }, function (sr, rng) {
    var out = alloc(sr, 0.8);
    mix(out, burst(sr, rng, 0.06, { hp2: [2000, 0.7], att: 0.0003, tau: 0.018 }), 0, 1.0);
    mix(out, burst(sr, rng, 0.3, { bp: [rng.range(3500, 5000), 0.8], att: 0.001, tau: 0.06 }), 0, 0.45);
    grains(out, sr, rng, { n: 25, t0: 0, t1: 0.1, dist: 1.4, gl: [0.0005, 0.002], f: [2500, 8000], q: 8, decay: 0.06, amp: 0.6 });
    var tk = new Float32Array(out.length), nT = rng.int(14, 22);
    for (var k = 0; k < nT; k++) {
      var t = 0.01 + 0.55 * M.pow(rng(), 1.7), f = rng.range(2200, 6000), a = M.exp(-t / 0.22) * rng.range(0.3, 1);
      addModes(tk, sr, t, f, [[1, rng.range(0.03, 0.09), 1], [2.32, 0.04, 0.5], [4.25, 0.02, 0.25]], a, rng);
    }
    mix(out, norm(tk, 1), 0, 0.8);
    mix(out, thud(sr, 0.06, 400, 200, 0.01, 0.015), 0, 0.2);
    return out;
  });
  function metalHit(out, sr, rng, t0, f, amp, len) {
    var m = new Float32Array(out.length);
    addModes(m, sr, t0, f, [[1, 0.4 * len, 1], [1.004, 0.38 * len, 0.6], [1.47, 0.28 * len, 0.5], [2.76, 0.2 * len, 0.55], [3.93, 0.12 * len, 0.3], [5.4, 0.08 * len, 0.25], [8.1, 0.04 * len, 0.15]], 1, rng);
    mix(out, norm(m, 1), 0, 0.85 * amp);
    mix(out, burst(sr, rng, 0.02, { hp: 2000, att: 0.0003, tau: 0.004 }), M.round(t0 * sr), 0.6 * amp);
  }
  def('dig.metal', { v: 3, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 0.9), f = rng.range(480, 820);
    metalHit(out, sr, rng, 0, f, 1, 1);
    mix(out, thud(sr, 0.08, 300, 150, 0.01, 0.02), 0, 0.3);
    if (rng.chance(0.6)) metalHit(out, sr, rng, rng.range(0.08, 0.14), f * rng.range(0.97, 1.03), 0.35, 0.5);
    return out;
  });

  // ---------------------------------------------------------------- player / world
  def('damage.hurt', { v: 3, vol: 0.85 }, function (sr, rng) {
    var vd = rng.range(0.15, 0.18), out = alloc(sr, vd + 0.06);
    var fs = rng.range(230, 275), fe = fs * rng.range(0.6, 0.7);
    var v = vocal(sr, rng, vd, { f0: exps(fs, fe, vd), form: formLerp([[0, vowel('uh')], [vd, vowel('u')]]), jit: 0.01, rough: 0.15,
      breath: 0.08, src: rng.chance(0.5) ? 'sq' : 'saw', tilt: 3000, env: [0, 0, 0.008, 1, vd * 0.6, 0.8, vd, 0] });
    mix(out, v, 0, 1.0);
    mix(out, burst(sr, rng, 0.03, { bp: [1800, 0.7], att: 0.001, tau: 0.01 }), 0, 0.3);
    mix(out, burst(sr, rng, 0.07, { hp2: [2500, 0.7], att: 0.01, tau: 0.02 }), M.round((vd - 0.02) * sr), 0.18);
    return chunk(out, 1.6);
  });
  def('damage.fall_small', { v: 2, vol: 0.8 }, function (sr, rng) {
    var out = alloc(sr, 0.16);
    mix(out, thud(sr, 0.16, rng.range(130, 160), 60, 0.03, 0.04), 0, 1.0);
    mix(out, burst(sr, rng, 0.1, { lp2: [900, 0.7], att: 0.001, tau: 0.02 }), 0, 0.6);
    grains(out, sr, rng, { n: 6, t0: 0, t1: 0.05, dist: 1.2, gl: [0.0005, 0.002], f: [600, 2000], q: 4, decay: 0.03, amp: 0.3 });
    return chunk(out, 1.5);
  });
  def('damage.fall_big', { v: 2, vol: 0.95 }, function (sr, rng) {
    var out = alloc(sr, 0.36);
    mix(out, thud(sr, 0.3, rng.range(100, 120), 45, 0.05, 0.07), 0, 1.0);
    mix(out, burst(sr, rng, 0.2, { lp2: [1200, 0.7], att: 0.001, tau: 0.05 }), 0, 0.6);
    grains(out, sr, rng, { n: rng.int(30, 40), t0: 0.005, t1: 0.15, dist: 1.5, gl: [0.0005, 0.002], f: [800, 3000], q: 4, decay: 0.06, amp: 0.7 });
    return chunk(out, 2.0);
  });
  def('damage.death', { v: 2, vol: 0.85 }, function (sr, rng) {
    var vd = rng.range(0.42, 0.5), out = alloc(sr, vd + 0.05), fs = rng.range(210, 240);
    var v = vocal(sr, rng, vd, { f0: exps(fs, fs * 0.5, vd), form: formLerp([[0, vowel('uh')], [vd * 0.5, vowel('o')], [vd, vowel('u')]]),
      jit: 0.012, rough: 0.25, breath: 0.1, src: 'saw', tilt: 2500, env: [0, 0, 0.01, 1, vd * 0.5, 0.75, vd, 0] });
    mix(out, v, 0, 1.0);
    mix(out, burst(sr, rng, 0.04, { bp: [1500, 0.7], att: 0.001, tau: 0.012 }), 0, 0.3);
    return chunk(out, 1.5);
  });
  function crunch(out, sr, rng, t0, amp) {
    grains(out, sr, rng, { n: rng.int(8, 14), t0: t0, t1: t0 + 0.035, dist: 1.3, gl: [0.0005, 0.002], f: [1200, 3500], q: 3, decay: 0.03, amp: amp });
    mix(out, burst(sr, rng, 0.06, { bp: [rng.range(800, 1100), 0.8], att: 0.002, tau: 0.02 }), M.round(t0 * sr), 0.6 * amp);
    mix(out, thud(sr, 0.04, 200, 120, 0.01, 0.012), M.round(t0 * sr), 0.35 * amp);
  }
  def('random.eat', { v: 3, vol: 0.7 }, function (sr, rng) {
    var out = alloc(sr, 0.24), n = rng.int(2, 3), t = 0.002;
    for (var k = 0; k < n; k++) { crunch(out, sr, rng, t, k === 0 ? 1 : rng.range(0.5, 0.8)); t += rng.range(0.05, 0.075); }
    return out;
  });
  def('random.burp', { v: 2, vol: 0.7 }, function (sr, rng) {
    var d = rng.range(0.38, 0.48), out = alloc(sr, d + 0.03), f = rng.range(85, 100);
    var v = vocal(sr, rng, d, { f0: pts([0, f * 1.1, 0.08, f * 1.15, d, f * 0.85]), form: formLerp([[0, vowel('uh', 0.95)], [d, vowel('o', 0.9)]]),
      jit: 0.03, rough: 0.45, breath: 0.12, src: 'saw', tilt: 1800, env: [0, 0, 0.02, 1, d * 0.3, 0.9, d, 0] });
    mix(out, v, 0, 1);
    return chunk(out, 1.3);
  });
  def('random.drink', { v: 3, vol: 0.65 }, function (sr, rng) {
    var out = alloc(sr, 0.36), n = rng.int(2, 3), t = 0.005;
    for (var k = 0; k < n; k++) {
      bubble(out, sr, t, rng.range(220, 320), rng.range(1.2, 1.8), 0.025, 1.0);
      mix(out, burst(sr, rng, 0.05, { lp2: [600, 0.7], att: 0.004, tau: 0.018 }), M.round(t * sr), 0.5);
      mix(out, thud(sr, 0.05, 160, 90, 0.01, 0.015), M.round(t * sr), 0.4);
      t += rng.range(0.09, 0.12);
    }
    return out;
  });
  def('random.pop', { v: 3, vol: 0.6 }, function (sr, rng) {
    var out = alloc(sr, 0.09), f0 = rng.range(500, 700), f1 = rng.range(1300, 1800), ph = 0, n = out.length;
    for (var i = 0; i < n; i++) {
      var t = i / sr, f = f0 + (f1 - f0) * (1 - M.exp(-t / 0.012));
      ph += TAU * f / sr;
      out[i] = (M.sin(ph) + 0.2 * M.sin(2 * ph)) * M.exp(-t / 0.02) * M.min(1, t / 0.001);
    }
    return out;
  });
  def('random.click', { v: 3, vol: 0.55, jitter: 0.04 }, function (sr, rng) {
    var out = alloc(sr, 0.05);
    mix(out, burst(sr, rng, 0.01, { hp: 2000, att: 0.0002, tau: 0.0015 }), M.round(0.0005 * sr), 1.0);
    addMode(out, sr, 0.0008, rng.range(1800, 2600), 0.006, 0.45, 0);
    addMode(out, sr, 0.0008, rng.range(4000, 5500), 0.003, 0.15, 0);
    return out;
  });
  def('random.levelup', { v: 2, vol: 0.6, jitter: 0.03 }, function (sr, rng, vi) {
    var out = alloc(sr, 1.5), base = vi === 0 ? 523.25 : 587.33, steps = [0, 4, 7, 12, 16], t = 0.002;
    for (var k = 0; k < steps.length; k++) {
      var f = base * M.pow(2, steps[k] / 12);
      addModes(out, sr, t, f, [[1, 0.7, 1], [2.0, 0.35, 0.3], [3.01, 0.2, 0.12], [4.17, 0.1, 0.06]], 0.6 + 0.1 * k, null);
      t += 0.075;
    }
    for (var i = 0; i < out.length; i++) out[i] *= 1 + 0.08 * M.sin(TAU * 6 * i / sr);
    return out;
  });
  def('random.orb', { v: 4, vol: 0.5 }, function (sr, rng, vi) {
    var out = alloc(sr, 0.18), f = [1400, 1580, 1760, 1980][vi % 4] * rng.range(0.98, 1.02);
    addModes(out, sr, 0.001, f, [[1, 0.08, 1], [2.0, 0.04, 0.35], [3.0, 0.02, 0.15]], 1, null);
    return out;
  });
  def('random.break', { v: 3, vol: 0.8 }, function (sr, rng) {
    var out = alloc(sr, 0.4);
    mix(out, burst(sr, rng, 0.04, { hp: 1500, att: 0.0003, tau: 0.01 }), 0, 1.0);
    mix(out, burst(sr, rng, 0.12, { bp: [rng.range(600, 900), 1.0], att: 0.001, tau: 0.03 }), 0, 0.5);
    mix(out, thud(sr, 0.08, 220, 120, 0.01, 0.02), 0, 0.35);
    var m = new Float32Array(out.length), n = rng.int(3, 6);
    for (var k = 0; k < n; k++) addModes(m, sr, 0.015 + rng() * 0.2, rng.range(2800, 6000), [[1, rng.range(0.04, 0.1), 1], [2.7, 0.03, 0.4]], rng.range(0.4, 1), rng);
    mix(out, norm(m, 1), 0, 0.6);
    return chunk(out, 1.3);
  });
  def('random.bow', { v: 3, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 0.38), s = pluck(sr, 0.36, rng.range(110, 150), 0.993, rng, 0.3);
    envAD(s, sr, 0.001, 0.12, 0);
    mix(out, norm(s, 1), 0, 0.8);
    mix(out, swish(sr, rng, 0.2, 800, 2400, 1.5), 0, 0.55);
    return out;
  });
  def('random.bowhit', { v: 3, vol: 0.8 }, function (sr, rng) {
    var out = alloc(sr, 0.22), f = rng.range(300, 400), m = new Float32Array(out.length), i;
    mix(out, thud(sr, 0.12, 180, 90, 0.02, 0.03), 0, 0.8);
    addModes(m, sr, 0, f, [[1, 0.04, 1], [2.4, 0.03, 0.5], [4.5, 0.015, 0.25]], 1, rng);
    mix(out, norm(m, 1), 0, 0.7);
    mix(out, burst(sr, rng, 0.02, { lp: 2000, att: 0.0005, tau: 0.006 }), 0, 0.6);
    var r = new Float32Array(out.length); addMode(r, sr, 0.005, rng.range(800, 1000), 0.08, 1, 0);
    for (i = 0; i < r.length; i++) r[i] *= 0.5 + 0.5 * M.sin(TAU * 32 * i / sr);
    mix(out, r, 0, 0.2);
    return chunk(out, 1.3);
  });
  function latch(out, sr, rng, t0, amp) {
    tick(out, sr, rng, t0, rng.range(2500, 3500), amp, 0.008);
    var m = new Float32Array(out.length);
    addModes(m, sr, t0, rng.range(900, 1300), [[1, 0.02, 1], [2.3, 0.012, 0.4]], 1, rng);
    mix(out, norm(m, 1), 0, 0.5 * amp);
  }
  function creakRes(rng, lo) { // wood resonances for creaks (lo = lower, heavier)
    var s = lo ? 0.7 : 1;
    return [[rng.range(450, 600) * s, 8, 1], [rng.range(1100, 1400) * s, 9, 0.6], [rng.range(2300, 2800) * s, 10, 0.3]];
  }
  def('random.door_open', { v: 2, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 0.5), cd = rng.range(0.28, 0.36);
    latch(out, sr, rng, 0.003, 0.8);
    woodKnock(out, sr, rng, 0.002, rng.range(180, 220), 0.6, 0.3);
    var c = creak(sr, rng, cd, { rate: pts([0, rng.range(170, 210), cd * 0.5, rng.range(280, 340), cd, rng.range(220, 260)]), res: creakRes(rng, false),
      jit: 0.2, env: [0, 0, 0.04, 1, cd * 0.7, 0.8, cd, 0] });
    mix(out, c, M.round(0.04 * sr), 0.7);
    return out;
  });
  def('random.door_close', { v: 2, vol: 0.8 }, function (sr, rng) {
    var out = alloc(sr, 0.45), cd = rng.range(0.16, 0.22);
    var c = creak(sr, rng, cd, { rate: pts([0, rng.range(240, 280), cd, rng.range(330, 380)]), res: creakRes(rng, false),
      jit: 0.2, env: [0, 0, 0.03, 1, cd * 0.8, 0.9, cd, 0.2] });
    mix(out, c, 0, 0.55);
    woodKnock(out, sr, rng, cd, rng.range(150, 190), 1.2, 1.0);
    latch(out, sr, rng, cd + 0.01, 0.7);
    return chunk(out, 1.3);
  });
  def('random.chestopen', { v: 2, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 0.65), cd = rng.range(0.4, 0.5);
    latch(out, sr, rng, 0.003, 0.6);
    woodKnock(out, sr, rng, 0.002, rng.range(140, 170), 0.8, 0.35);
    var c = creak(sr, rng, cd, { rate: pts([0, rng.range(90, 120), cd * 0.6, rng.range(170, 210), cd, rng.range(120, 150)]), res: creakRes(rng, true),
      jit: 0.2, env: [0, 0, 0.06, 1, cd * 0.75, 0.8, cd, 0] });
    mix(out, c, M.round(0.03 * sr), 0.8);
    return out;
  });
  def('random.chestclosed', { v: 2, vol: 0.8 }, function (sr, rng) {
    var out = alloc(sr, 0.45), cd = rng.range(0.12, 0.17);
    var c = creak(sr, rng, cd, { rate: pts([0, rng.range(130, 150), cd, rng.range(180, 220)]), res: creakRes(rng, true),
      jit: 0.2, env: [0, 0, 0.03, 1, cd * 0.8, 0.9, cd, 0.2] });
    mix(out, c, 0, 0.5);
    woodKnock(out, sr, rng, cd, rng.range(110, 140), 1.4, 1.0);
    mix(out, thud(sr, 0.15, 120, 60, 0.03, 0.04), M.round(cd * sr), 0.5);
    latch(out, sr, rng, cd + 0.008, 0.5);
    return chunk(out, 1.4);
  });
  def('random.explode', { v: 3, vol: 1.0, rate: RATE_LO, range: 48, fo: 0.02 }, function (sr, rng) {
    var d = rng.range(1.25, 1.45), out = alloc(sr, d);
    mix(out, thud(sr, d, rng.range(65, 80), 30, 0.12, 0.35), 0, 1.0);
    mix(out, burst(sr, rng, 0.15, { lp2: [1800, 0.7], att: 0.0005, tau: 0.018 }), 0, 0.7);
    mix(out, burst(sr, rng, d, { color: 'brown', lp2: [rng.range(350, 500), 0.7], att: 0.004, tau: 0.42 }), 0, 1.0);
    mix(out, burst(sr, rng, d * 0.7, { bp: [550, 0.7], att: 0.002, tau: 0.16 }), 0, 0.3);
    grains(out, sr, rng, { n: rng.int(40, 60), t0: 0.03, t1: d * 0.8, dist: 1.8, gl: [0.001, 0.004], f: [300, 1600], q: 3, decay: 0.35, amp: 0.25 });
    var x = chunk(out, 2.0);
    bq(x, 'lp', 2400, 0.7, sr); // tame the saturation harmonics: big, dark boom
    envPts(x, sr, [0, 1, d * 0.6, 0.8, d, 0]);
    return x;
  });
  def('random.fuse', { v: 2, vol: 0.5, rate: RATE_LO, noTrim: true }, function (sr, rng) {
    var d = 1.5, n = M.round(d * sr), x = noise(n, rng), i;
    bq(x, 'hp', 2500, 0.7, sr); bq(x, 'bp', rng.range(4000, 5200), 0.7, sr);
    var fl = smoothRand(rng, n, sr, 30);
    for (i = 0; i < n; i++) x[i] *= 1 + 0.25 * fl[i];
    norm(x, 1);
    grains(x, sr, rng, { n: 25, t0: 0.05, t1: d - 0.1, dist: 1, gl: [0.0003, 0.001], f: [4000, 9000], q: 2, decay: 0, amp: 0.5 });
    envPts(x, sr, [0, 0, 0.07, 1, d - 0.12, 0.95, d, 0]);
    return x;
  });
  def('random.fizz', { v: 3, vol: 0.55 }, function (sr, rng) {
    var d = rng.range(0.45, 0.6), n = M.round(d * sr), x = noise(n, rng), i;
    bq(x, 'bp', rng.range(3000, 4500), 0.8, sr);
    var fl = smoothRand(rng, n, sr, rng.range(30, 60));
    for (i = 0; i < n; i++) x[i] *= 1 + 0.4 * fl[i];
    envAD(x, sr, 0.005, d * 0.3, 0); norm(x, 1);
    grains(x, sr, rng, { n: 8, t0: 0.02, t1: d * 0.7, dist: 1.3, gl: [0.0005, 0.0015], f: [1500, 4000], q: 3, decay: d * 0.4, amp: 0.4 });
    return x;
  });
  def('liquid.splash', { v: 3, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.7, 0.85), out = alloc(sr, d);
    mix(out, burst(sr, rng, d * 0.7, { sweep: { type: 'lp', f0: 6000, f1: 1200, q: 0.7, dur: 0.25 }, att: 0.002, tau: 0.12 }), 0, 1.0);
    mix(out, burst(sr, rng, d, { bp: [rng.range(600, 800), 0.7], att: 0.01, tau: 0.2 }), 0, 0.5);
    var b = new Float32Array(out.length), nb = rng.int(12, 20);
    for (var k = 0; k < nb; k++) {
      var t = 0.03 + (d - 0.15) * M.pow(rng(), 1.3);
      bubble(b, sr, t, rng.range(400, 1400), rng.range(0.3, 0.8), rng.range(0.015, 0.04), M.exp(-t / 0.3) * rng.range(0.4, 1));
    }
    mix(out, norm(b, 1), 0, 0.55);
    return out;
  });
  def('liquid.swim', { v: 4, vol: 0.55 }, function (sr, rng) {
    var d = rng.range(0.3, 0.4), out = alloc(sr, d);
    mix(out, burst(sr, rng, d, { bp: [rng.range(1100, 1700), 0.8], att: 0.02, tau: 0.08 }), 0, 0.8);
    mix(out, burst(sr, rng, d, { lp2: [500, 0.7], att: 0.015, tau: 0.08 }), 0, 0.35);
    var b = new Float32Array(out.length), nb = rng.int(3, 6);
    for (var k = 0; k < nb; k++) bubble(b, sr, 0.03 + rng() * (d - 0.1), rng.range(500, 1200), rng.range(0.3, 0.7), rng.range(0.012, 0.03), rng.range(0.4, 1));
    mix(out, norm(b, 1), 0, 0.4);
    return out;
  });
  def('liquid.water', { v: 4, vol: 0.4 }, function (sr, rng) {
    var out = alloc(sr, 0.42), nb = rng.int(1, 3), t = 0.005;
    for (var k = 0; k < nb; k++) {
      bubble(out, sr, t, rng.range(700, 1500), rng.range(0.5, 1.0), rng.range(0.018, 0.03), k === 0 ? 1 : rng.range(0.4, 0.8));
      t += rng.range(0.07, 0.14);
    }
    norm(out, 1); echo(out, sr, 0.09, 0.3, 2500, 0.25);
    return out;
  });
  def('liquid.lava', { v: 3, vol: 0.55 }, function (sr, rng) {
    var out = alloc(sr, 0.5);
    bubble(out, sr, 0.01, rng.range(90, 150), rng.range(0.6, 1.0), 0.05, 1.0);
    mix(out, burst(sr, rng, 0.3, { lp2: [500, 0.7], att: 0.02, tau: 0.08 }), 0, 0.35);
    var nc = rng.int(5, 10);
    for (var k = 0; k < nc; k++) tick(out, sr, rng, 0.02 + rng() * 0.4, rng.range(1500, 3500), rng.range(0.1, 0.35), 0.004);
    return out;
  });
  def('liquid.lavapop', { v: 3, vol: 0.6 }, function (sr, rng) {
    var out = alloc(sr, 0.26);
    mix(out, burst(sr, rng, 0.01, { hp: 1500, att: 0.0003, tau: 0.003 }), 0, 0.9);
    addMode(out, sr, 0.001, rng.range(900, 1400), 0.02, 0.8, 0);
    mix(out, burst(sr, rng, 0.2, { bp: [5000, 0.8], att: 0.004, tau: 0.05 }), 0, 0.12);
    mix(out, thud(sr, 0.06, rng.range(380, 460), 220, 0.01, 0.015), 0, 0.35);
    return out;
  });
  def('fire.ignite', { v: 2, vol: 0.7 }, function (sr, rng) {
    var out = alloc(sr, 0.55);
    mix(out, burst(sr, rng, 0.02, { hp: 3000, att: 0.0003, tau: 0.004 }), 0, 0.9);
    addModes(out, sr, 0.001, rng.range(3500, 5000), [[1, 0.02, 0.5], [1.7, 0.012, 0.3]], 1, null);
    grains(out, sr, rng, { n: 10, t0: 0, t1: 0.035, dist: 1.2, gl: [0.0003, 0.001], f: [4000, 9000], q: 3, decay: 0.02, amp: 0.5 });
    mix(out, burst(sr, rng, 0.45, { color: 'pink', sweep: { type: 'bp', f0: 400, f1: 1500, q: 0.8, dur: 0.35 }, att: 0.06, tau: 0.12 }), M.round(0.04 * sr), 0.7);
    return out;
  });
  function crackles(x, sr, rng, n, t0, t1, big) {
    var k;
    for (k = 0; k < n; k++) tick(x, sr, rng, t0 + rng() * (t1 - t0), rng.range(1500, 4500), 0.3 + 0.7 * M.pow(rng(), 2.5), rng.range(0.003, 0.008));
    for (k = 0; k < (big || 0); k++) tick(x, sr, rng, t0 + rng() * (t1 - t0), rng.range(600, 1200), 1.0, 0.015);
    return x;
  }
  def('fire.fire', { v: 3, vol: 0.55, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(1.1, 1.3), n = M.round(d * sr), out = new Float32Array(n), i;
    var bed = pink(n, rng); lp1(bed, 800, sr); bq(bed, 'hp', 120, 0.7, sr);
    var fl = smoothRand(rng, n, sr, 8); for (i = 0; i < n; i++) bed[i] *= 0.7 + 0.3 * fl[i];
    mix(out, norm(bed, 1), 0, 0.3);
    var c = new Float32Array(n); crackles(c, sr, rng, rng.int(10, 20), 0.02, d - 0.05, 2);
    mix(out, norm(c, 1), 0, 0.9);
    envPts(out, sr, [0, 0, 0.05, 1, d - 0.1, 1, d, 0]);
    return out;
  });

  // ---------------------------------------------------------------- mobs
  def('mob.pig.say', { v: 3, vol: 0.7 }, function (sr, rng, vi) {
    var syl = vi === 2 ? 2 : 1, out = alloc(sr, syl === 2 ? 0.7 : 0.36), t = 0.002;
    for (var s = 0; s < syl; s++) {
      var d = rng.range(0.22, 0.29), fb = rng.range(150, 190);
      var v = vocal(sr, rng, d, { f0: pts([0, fb, d * 0.25, fb * rng.range(1.35, 1.6), d, fb * 0.85]),
        form: formLerp([[0, vowel('u', 1.1)], [d * 0.3, vowel('uh', 1.15)], [d, vowel('o', 1.1)]]),
        jit: 0.03, rough: 0.55, breath: 0.25, src: 'sq', tilt: 2200, env: [0, 0, 0.02, 1, d * 0.6, 0.7, d, 0] });
      mix(out, v, M.round(t * sr), s === 0 ? 1 : 0.8);
      mix(out, burst(sr, rng, 0.08, { bp: [900, 1.2], att: 0.004, tau: 0.02 }), M.round(t * sr), 0.3);
      t += d + rng.range(0.05, 0.09);
    }
    return chunk(out, 1.8);
  });
  def('mob.pig.death', { v: 2, vol: 0.75 }, function (sr, rng) {
    var d = rng.range(0.55, 0.7), out = alloc(sr, d + 0.03), f = rng.range(380, 440);
    var v = vocal(sr, rng, d, { f0: pts([0, f * 0.85, d * 0.25, f * 1.25, d, f * 0.7]),
      form: formLerp([[0, vowel('ae', 1.2)], [d * 0.4, vowel('e', 1.25)], [d, vowel('uh', 1.2)]]),
      jit: 0.03, rough: 0.35, breath: 0.2, src: 'saw', tilt: 3000, env: [0, 0, 0.02, 1, d * 0.5, 0.85, d, 0] });
    mix(out, v, 0, 1);
    return chunk(out, 1.6);
  });
  def('mob.cow.say', { v: 3, vol: 0.75, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(1.0, 1.35), out = alloc(sr, d + 0.05), f = rng.range(95, 120);
    var v = vocal(sr, rng, d, { f0: pts([0, f * 0.9, d * 0.25, f * 1.2, d * 0.6, f * 1.1, d, f * 0.8]),
      form: formLerp([[0, vowel('m')], [d * 0.18, vowel('u', 0.95)], [d * 0.45, vowel('o', 0.95)], [d * 0.8, vowel('o', 0.9)], [d, vowel('u', 0.9)]]),
      jit: 0.012, rough: 0.2, breath: 0.08, vib: [4.5, 0.012], src: 'saw', tilt: 1600, env: [0, 0, 0.12, 0.8, d * 0.3, 1, d * 0.75, 0.85, d, 0] });
    mix(out, v, 0, 1);
    return chunk(out, 1.3);
  });
  def('mob.cow.hurt', { v: 2, vol: 0.75 }, function (sr, rng) {
    var d = rng.range(0.4, 0.5), out = alloc(sr, d + 0.03), f = rng.range(135, 155);
    var v = vocal(sr, rng, d, { f0: pts([0, f, d * 0.3, f * 1.2, d, f * 0.8]), form: formLerp([[0, vowel('uh', 0.95)], [d, vowel('o', 0.9)]]),
      jit: 0.02, rough: 0.35, breath: 0.12, src: 'saw', tilt: 1800, env: [0, 0, 0.02, 1, d * 0.5, 0.8, d, 0] });
    mix(out, v, 0, 1);
    return chunk(out, 1.5);
  });
  def('mob.sheep.say', { v: 3, vol: 0.7 }, function (sr, rng) {
    var d = rng.range(0.65, 0.85), out = alloc(sr, d + 0.03), f = rng.range(300, 370), trem = rng.range(18, 26);
    var bleat = [[820, 110, 1], [1950, 150, 0.75], [2900, 220, 0.4]], open = [[900, 120, 1], [1700, 150, 0.6], [2800, 220, 0.3]];
    var v = vocal(sr, rng, d, { f0: pts([0, f * 0.9, 0.08, f * 1.05, d, f * 0.9]),
      form: formLerp([[0, vowel('m', 1.15)], [0.05, bleat], [d, open]]),
      jit: 0.015, rough: 0.2, breath: 0.1, vib: [trem, 0.035], src: 'saw', tilt: 4500, env: [0, 0, 0.03, 1, d * 0.6, 0.8, d, 0] });
    for (var i = 0; i < v.length; i++) v[i] *= 0.65 + 0.35 * M.sin(TAU * trem * i / sr);
    mix(out, norm(v, 1), 0, 1);
    return out;
  });
  function cluck(sr, rng, d, f, s) {
    return vocal(sr, rng, d, { f0: pts([0, f * 1.15, d * 0.3, f, d, f * 0.8]), form: function () { return vowel('uh', s); },
      jit: 0.02, rough: 0.2, breath: 0.1, src: 'sq', tilt: 4000, env: [0, 0, 0.005, 1, d * 0.4, 0.7, d, 0] });
  }
  def('mob.chicken.say', { v: 3, vol: 0.65 }, function (sr, rng) {
    var out = alloc(sr, 0.5), n = rng.int(2, 3), t = 0.002;
    for (var k = 0; k < n; k++) {
      var last = k === n - 1 && rng.chance(0.5), d = last ? rng.range(0.12, 0.16) : rng.range(0.05, 0.08);
      mix(out, cluck(sr, rng, d, rng.range(420, 560) * (last ? 1.15 : 1), 1.7), M.round(t * sr), k === 0 ? 1 : 0.85);
      t += d + rng.range(0.03, 0.06);
    }
    return out;
  });
  def('mob.chicken.hurt', { v: 2, vol: 0.65 }, function (sr, rng) {
    var d = rng.range(0.18, 0.24), out = alloc(sr, d + 0.03), f = rng.range(800, 1000);
    var v = vocal(sr, rng, d, { f0: pts([0, f, d * 0.3, f * 1.3, d, f * 0.8]), form: function () { return vowel('ae', 1.8); },
      jit: 0.04, rough: 0.4, breath: 0.25, src: 'saw', tilt: 5000, env: [0, 0, 0.005, 1, d * 0.5, 0.8, d, 0] });
    mix(out, v, 0, 1);
    return chunk(out, 1.5);
  });
  def('mob.chicken.plop', { v: 2, vol: 0.6 }, function (sr, rng) {
    var out = alloc(sr, 0.13), f0 = rng.range(600, 750), f1 = rng.range(180, 240), ph = 0;
    for (var i = 0; i < out.length; i++) {
      var t = i / sr; ph += TAU * (f1 + (f0 - f1) * M.exp(-t / 0.015)) / sr;
      out[i] = M.sin(ph) * M.exp(-t / 0.03) * M.min(1, t / 0.001);
    }
    mix(out, burst(sr, rng, 0.01, { lp: 3000, att: 0.0003, tau: 0.002 }), 0, 0.3);
    return out;
  });
  function groan(sr, rng, d, f0fn, forms, rasp, env) {
    return vocal(sr, rng, d, { f0: f0fn, form: formLerp(forms), jit: 0.035, rough: rasp, breath: 0.35,
      vib: [rng.range(3, 5), 0.05], src: 'saw', tilt: 1500, env: env });
  }
  def('mob.zombie.say', { v: 3, vol: 0.75, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(1.1, 1.5), f = rng.range(85, 105), out = alloc(sr, d + 0.05);
    mix(out, groan(sr, rng, d, pts([0, f * 0.9, d * 0.3, f * 1.1, d * 0.7, f, d, f * 0.8]),
      [[0, vowel('uh', 0.9)], [d * 0.35, vowel('a', 0.9)], [d * 0.7, vowel('o', 0.85)], [d, vowel('u', 0.85)]], 0.5,
      [0, 0, d * 0.2, 1, d * 0.7, 0.85, d, 0]), 0, 1);
    return chunk(out, 1.8);
  });
  def('mob.zombie.hurt', { v: 2, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.35, 0.45), f = rng.range(115, 135), out = alloc(sr, d + 0.03);
    mix(out, groan(sr, rng, d, pts([0, f, d * 0.3, f * 1.1, d, f * 0.7]), [[0, vowel('a', 0.9)], [d, vowel('uh', 0.9)]], 0.6,
      [0, 0, 0.015, 1, d * 0.5, 0.8, d, 0]), 0, 1);
    return chunk(out, 2.0);
  });
  def('mob.zombie.death', { v: 2, vol: 0.8, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(1.1, 1.4), f = rng.range(105, 120), out = alloc(sr, d + 0.05);
    mix(out, groan(sr, rng, d, exps(f, f * 0.55, d), [[0, vowel('a', 0.9)], [d * 0.5, vowel('o', 0.85)], [d, vowel('u', 0.8)]], 0.65,
      [0, 0, 0.04, 1, d * 0.5, 0.8, d, 0]), 0, 1);
    return chunk(out, 1.8);
  });
  // bone rattle: n hollow clicks spread irregularly over [t0,t1]
  function rattle(out, sr, rng, t0, t1, n, fLo, fHi, amp) {
    var m = new Float32Array(out.length), step = (t1 - t0) / n, t = t0;
    for (var k = 0; k < n; k++) {
      var a = rng.range(0.4, 1);
      addModes(m, sr, t, rng.range(fLo, fHi), [[1, rng.range(0.008, 0.018), 1], [rng.range(2.1, 2.6), 0.008, 0.5], [rng.range(3.9, 4.6), 0.005, 0.3]], a, rng);
      mix(m, burst(sr, rng, 0.004, { hp: 1200, att: 0.0002, tau: 0.001 }), M.round(t * sr), 0.4 * a);
      t += step * rng.range(0.4, 1.6);
      if (t > t1) t = t0 + (t1 - t0) * rng();
    }
    mix(out, norm(m, 1), 0, amp);
  }
  def('mob.skeleton.say', { v: 3, vol: 0.7 }, function (sr, rng) {
    var out = alloc(sr, 0.5);
    rattle(out, sr, rng, 0.003, 0.4, rng.int(10, 16), 700, 1700, 1);
    return out;
  });
  def('mob.skeleton.hurt', { v: 2, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 0.36);
    mix(out, burst(sr, rng, 0.03, { hp: 1500, att: 0.0003, tau: 0.006 }), 0, 0.8);
    rattle(out, sr, rng, 0.01, 0.25, rng.int(7, 11), 900, 2200, 0.9);
    return chunk(out, 1.3);
  });
  def('mob.skeleton.death', { v: 2, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 0.95);
    rattle(out, sr, rng, 0.005, 0.75, rng.int(18, 26), 600, 1600, 1);
    rattle(out, sr, rng, 0.1, 0.8, 5, 300, 600, 0.6);
    return out;
  });
  def('mob.creeper.say', { v: 2, vol: 0.6 }, function (sr, rng) {
    var d = rng.range(0.3, 0.4), out = alloc(sr, d + 0.02);
    mix(out, burst(sr, rng, d, { hp2: [2000, 0.7], bp: [rng.range(2800, 4000), 0.6], att: 0.01, tau: d * 0.6 }), 0, 1);
    mix(out, burst(sr, rng, d, { bp: [800, 1], att: 0.02, tau: d * 0.4 }), 0, 0.2);
    envPts(out, sr, [0, 1, d * 0.7, 1, d, 0]);
    return out;
  });
  def('mob.creeper.death', { v: 2, vol: 0.65 }, function (sr, rng) {
    var d = rng.range(0.65, 0.8), out = alloc(sr, d + 0.02);
    mix(out, burst(sr, rng, d, { sweep: { type: 'bp', f0: 4000, f1: 1500, q: 0.8, dur: d }, att: 0.01, tau: d * 0.5 }), 0, 1);
    mix(out, thud(sr, 0.15, 150, 80, 0.03, 0.04), 0, 0.4);
    envPts(out, sr, [0, 1, d * 0.7, 1, d, 0]);
    return out;
  });
  function scratchy(sr, rng, d, f0, f1, rate) {
    var n = M.max(1, M.round(d * sr)), x = noise(n, rng), ph = 0, g = 0, k = M.exp(-1 / (0.008 * sr));
    bqSweep(x, 'bp', function (t) { return f0 * M.pow(f1 / f0, M.min(1, t / d)); }, 0.9, sr);
    for (var i = 0; i < n; i++) {
      ph += rate * (0.7 + 0.6 * rng()) / sr;
      if (ph >= 1) { ph -= 1; g = 0.6 + 0.4 * rng(); }
      x[i] *= 0.2 + g; g *= k;
    }
    return norm(x, 1);
  }
  function growl(sr, rng, d, f0, f1) {
    return vocal(sr, rng, d, { f0: exps(f0, f1, d), form: function () { return vowel('uh', 0.8); }, jit: 0.05, rough: 0.6, breath: 0.5,
      src: 'saw', tilt: 1200, env: [0, 0, 0.05, 1, d * 0.6, 0.8, d, 0] });
  }
  def('mob.spider.say', { v: 3, vol: 0.65 }, function (sr, rng) {
    var d = rng.range(0.5, 0.7), out = alloc(sr, d + 0.03);
    var s = scratchy(sr, rng, d, rng.range(2500, 3500), rng.range(1500, 2200), rng.range(40, 80));
    envPts(s, sr, [0, 0, 0.04, 1, d * 0.6, 0.8, d, 0]);
    mix(out, s, 0, 1);
    mix(out, growl(sr, rng, d, rng.range(62, 72), 58), 0, 0.35);
    return out;
  });
  def('mob.spider.death', { v: 2, vol: 0.65, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(0.9, 1.1), out = alloc(sr, d + 0.03);
    var s = scratchy(sr, rng, d, rng.range(3000, 3800), rng.range(900, 1300), rng.range(35, 60));
    envPts(s, sr, [0, 0, 0.03, 1, d * 0.5, 0.8, d, 0]);
    mix(out, s, 0, 1);
    mix(out, growl(sr, rng, d, rng.range(70, 80), 45), 0, 0.45);
    return out;
  });
  def('mob.generic.hurt', { v: 3, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 0.26), d = 0.16;
    mix(out, thud(sr, 0.18, rng.range(150, 180), 85, 0.03, 0.04), 0, 0.9);
    mix(out, burst(sr, rng, 0.12, { bp: [rng.range(1000, 1400), 0.8], att: 0.001, tau: 0.03 }), 0, 0.6);
    mix(out, vocal(sr, rng, d, { f0: exps(rng.range(170, 200), 130, d), form: function () { return vowel('uh'); }, jit: 0.02, rough: 0.3,
      breath: 0.15, src: 'saw', tilt: 2000, env: [0, 0, 0.01, 1, d * 0.5, 0.7, d, 0] }), M.round(0.005 * sr), 0.45);
    return chunk(out, 1.6);
  });
  def('mob.generic.death', { v: 2, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 0.65), d = 0.4, tb = rng.range(0.3, 0.36);
    mix(out, vocal(sr, rng, d, { f0: exps(rng.range(190, 220), 90, d), form: formLerp([[0, vowel('uh')], [d, vowel('o')]]), jit: 0.02,
      rough: 0.35, breath: 0.15, src: 'saw', tilt: 2000, env: [0, 0, 0.01, 1, d * 0.6, 0.7, d, 0] }), 0, 0.7);
    mix(out, thud(sr, 0.25, 110, 50, 0.04, 0.06), M.round(tb * sr), 1.0);
    mix(out, burst(sr, rng, 0.15, { lp2: [900, 0.7], att: 0.001, tau: 0.04 }), M.round(tb * sr), 0.5);
    return chunk(out, 1.5);
  });
  def('mob.generic.swing', { v: 4, vol: 0.5 }, function (sr, rng) {
    var d = rng.range(0.18, 0.26), out = alloc(sr, d + 0.02), fa = rng.range(450, 650), fb = rng.range(1800, 2600);
    var x = burst(sr, rng, d, { color: 'pink', att: 0.001, tau: 10 });
    bqSweep(x, 'bp', function (t) { return fa + (fb - fa) * M.sin(M.PI * M.min(1, t / d)); }, 1.5, sr);
    envPts(x, sr, [0, 0, d * 0.4, 1, d, 0]);
    mix(out, norm(x, 1), 0, 1);
    return out;
  });

  // ---------------------------------------------------------------- ambient one-shots
  function caveDrone(sr, rng, d) {
    var out = alloc(sr, d), f = rng.range(55, 80), e = d * 0.62;
    mix(out, osc(sr, e, function (t) { return f * (1 + 0.01 * M.sin(TAU * 0.3 * t)); }, 'sine'), 0, 1);
    mix(out, osc(sr, e, f * 1.498, 'sine'), 0, 0.5);
    var c = osc(sr, e, function (t) { return f * 2.01 * (1 - 0.03 * t / e); }, 'tri'); lp1(c, 400, sr);
    mix(out, c, 0, 0.3);
    mix(out, burst(sr, rng, e, { bp: [rng.range(180, 260), 3], att: 0.01, tau: 100 }), 0, 0.25);
    envPts(out, sr, [0, 0, e * 0.45, 1, e * 0.75, 0.7, e, 0]);
    return reverb(norm(out, 1), sr, 2.5, 0.4, 0.5, 0.8, 1.3);
  }
  function caveMetal(sr, rng, d) {
    var out = alloc(sr, d), f = rng.range(250, 420);
    addModes(out, sr, 0.02, f, [[1, 0.9, 1], [2.41, 0.6, 0.6], [3.87, 0.35, 0.4], [5.14, 0.2, 0.3], [6.9, 0.12, 0.2]], 1, rng);
    mix(out, burst(sr, rng, 0.03, { hp: 1500, att: 0.0005, tau: 0.006 }), M.round(0.02 * sr), 0.3);
    norm(out, 1); lp1(out, 1800, sr);
    echo(out, sr, rng.range(0.28, 0.42), 0.55, 1200, 0.6);
    return reverb(out, sr, 2.8, 0.5, 0.6, 0.7, 1.4);
  }
  function caveRumble(sr, rng, d) {
    var n = M.round(d * sr), x = brown(n, rng);
    bq(x, 'lp', rng.range(110, 170), 0.8, sr); hp1(x, 28, sr); norm(x, 1);
    mix(x, osc(sr, d, rng.range(38, 46), 'sine'), 0, 0.2);
    envPts(x, sr, [0, 0, d * 0.25, 1, d * 0.45, 0.5, d * 0.62, 0.8, d * 0.95, 0]);
    return reverb(x, sr, 1.8, 0.6, 0.3, 0.9, 1.2);
  }
  function caveWind(sr, rng, d) {
    var n = M.round(d * sr), x = noise(n, rng), fc = rng.range(400, 600), ph = rng() * TAU;
    var fcf = function (t) { return fc * (1 + 0.25 * M.sin(TAU * t / d * 1.5 + ph)); };
    bqSweep(x, 'bp', fcf, 12, sr); norm(x, 1);
    var s = osc(sr, d, fcf, 'sine'); mix(x, s, 0, 0.12);
    envPts(x, sr, [0, 0, d * 0.35, 1, d * 0.62, 0.6, d * 0.9, 0]);
    return reverb(x, sr, 2.5, 0.4, 0.5, 0.8, 1.3);
  }
  function caveCreak(sr, rng, d) {
    var out = alloc(sr, d), cd = rng.range(1.0, 1.5);
    mix(out, creak(sr, rng, cd, { rate: pts([0, 14, cd * 0.5, 28, cd, 18]),
      res: [[rng.range(180, 260), 6, 1], [rng.range(450, 600), 7, 0.5], [rng.range(900, 1200), 8, 0.2]], jit: 0.3,
      env: [0, 0, 0.2, 1, cd * 0.7, 0.8, cd, 0] }), M.round(0.05 * sr), 1);
    lp1(out, 1500, sr);
    echo(out, sr, 0.35, 0.45, 900, 0.5);
    return reverb(out, sr, 3.0, 0.5, 0.7, 0.6, 1.5);
  }
  function caveSwell(sr, rng, d) {
    var out = alloc(sr, d), sw = rng.range(1.6, 2.1), f = rng.range(110, 175), iv = rng.pick([6, 1, 8, 3]);
    var a = osc(sr, sw, f, 'tri'), b = osc(sr, sw, f * M.pow(2, iv / 12), 'sine'), e3 = M.exp(3) - 1, n = a.length;
    for (var i = 0; i < n; i++) {
      var t = i / sr, g = (M.exp(3 * t / sw) - 1) / e3, rel = M.min(1, (sw - t) / 0.04);
      a[i] = (a[i] + 0.7 * b[i]) * g * rel;
    }
    lp1(a, 1200, sr);
    mix(out, a, M.round(0.05 * sr), 1);
    return reverb(norm(out, 1), sr, 2.5, 0.45, 0.8, 0.8, 1.4);
  }
  function caveDrips(sr, rng, d) {
    var out = alloc(sr, d), nd = rng.int(3, 5), t = 0.05;
    for (var k = 0; k < nd && t < d * 0.55; k++) {
      bubble(out, sr, t, rng.range(900, 1800), rng.range(0.6, 1.2), rng.range(0.012, 0.025), rng.range(0.5, 1));
      t += rng.range(0.25, 0.6);
    }
    norm(out, 1);
    echo(out, sr, rng.range(0.18, 0.3), 0.5, 3000, 0.5);
    return reverb(out, sr, 3.2, 0.3, 0.8, 0.7, 1.6);
  }
  function caveMoan(sr, rng, d) {
    var n = M.round(d * sr), x = pink(n, rng), e = d * 0.65, f1 = rng.range(280, 340);
    bqSweep(x, 'bp', pts([0, f1, e * 0.5, f1 * 2.2, e, f1 * 1.3, d, f1 * 1.3]), 6, sr);
    norm(x, 1);
    mix(x, osc(sr, e, function (t) { return 70 * (1 + 0.02 * M.sin(TAU * 0.7 * t)); }, 'sine'), 0, 0.25);
    envPts(x, sr, [0, 0, e * 0.55, 1, e * 0.8, 0.5, e, 0]);
    return reverb(x, sr, 3.0, 0.5, 0.6, 0.8, 1.4);
  }
  var CAVE = [caveDrone, caveMetal, caveRumble, caveWind, caveCreak, caveSwell, caveDrips, caveMoan];
  def('ambient.cave', { v: 8, vol: 0.4, rate: RATE_LO, fi: 0.01, fo: 0.3 }, function (sr, rng, vi) {
    return CAVE[vi % CAVE.length](sr, rng, rng.range(3.6, 4.8));
  });
  def('ambient.thunder', { v: 3, vol: 0.9, rate: RATE_LO, range: 256, fo: 0.2 }, function (sr, rng, vi) {
    var d = rng.range(3.0, 3.5), n = M.round(d * sr), out = new Float32Array(n), close = vi !== 2, i, k;
    if (close) mix(out, burst(sr, rng, 0.25, { bp: [1300, 0.6], att: 0.002, tau: 0.04 }), 0, 0.35);
    var r = brown(n, rng); bq(r, 'lp', close ? 500 : 280, 0.7, sr); hp1(r, 25, sr);
    var env = new Float32Array(n), nb = rng.int(3, 6), tb = close ? 0.02 : 0.2;
    for (i = 0; i < n; i++) env[i] = 0.3 * M.exp(-i / sr / 1.2);
    for (k = 0; k < nb; k++) {
      var c = tb + rng() * d * 0.55, w = rng.range(0.15, 0.5), a = rng.range(0.4, 1) * M.exp(-c / 1.5);
      var i0 = M.max(0, M.round((c - 3 * w) * sr)), i1 = M.min(n, M.round((c + 3 * w) * sr));
      for (i = i0; i < i1; i++) { var u = (i / sr - c) / w; env[i] += a * M.exp(-u * u); }
    }
    mix(out, norm(mul(r, env), 1), 0, 1);
    mix(out, thud(sr, d, 50, 30, 0.5, 0.8), 0, 0.4);
    var x = chunk(out, 1.5);
    bq(x, 'lp', 1500, 0.7, sr);
    envPts(x, sr, [0, 1, d * 0.7, 0.8, d, 0]);
    return x;
  });

  // ---------------------------------------------------------------- seamless loops
  // colour white noise in place (same recursions as pink()/brown())
  function colorize(x, type) {
    var i, b0 = 0, b1 = 0, b2 = 0, s = 0;
    if (type === 'pink') {
      for (i = 0; i < x.length; i++) {
        var w = x[i]; b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        x[i] = (b0 + b1 + b2 + w * 0.1848) * 0.3;
      }
    } else { for (i = 0; i < x.length; i++) { s = (s + 0.02 * x[i]) / 1.02; x[i] = s * 3.5; } }
    return x;
  }
  // process a periodic signal over 2 periods and keep the 2nd -> filters reach periodic steady state (seamless)
  function circular(x, proc) {
    var L = x.length, y = new Float32Array(L * 2);
    y.set(x); y.set(x, L); proc(y);
    return y.slice(L);
  }
  // ---------------------------------------------------------------- extra mobs
  def('mob.enderman.teleport', { v: 3, vol: 0.7 }, function (sr, rng) {
    var out = alloc(sr, 0.55);
    mix(out, swish(sr, rng, 0.5, rng.range(4200, 5200), rng.range(350, 550), 2.2), 0, 0.9);
    mix(out, thud(sr, 0.5, rng.range(900, 1200), 70, 0.12, 0.2), 0, 0.35);
    grains(out, sr, rng, { n: 18, t0: 0, t1: 0.3, dist: 1.2, gl: [0.001, 0.004], f: [3000, 9000], q: 6, decay: 0.1, amp: 0.35 });
    return chunk(out, 1.2);
  });
  def('mob.enderman.idle', { v: 3, vol: 0.55, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(0.7, 1.0), out = alloc(sr, d + 0.03);
    mix(out, growl(sr, rng, d, rng.range(150, 190), rng.range(85, 110)), 0, 1);
    mix(out, swish(sr, rng, d, 1800, 700, 3), 0, 0.2);
    return chunk(out, 1.5);
  });
  def('mob.enderman.scream', { v: 2, vol: 0.85 }, function (sr, rng) {
    var d = rng.range(0.9, 1.2), out = alloc(sr, d + 0.05);
    mix(out, growl(sr, rng, d, rng.range(420, 520), rng.range(200, 260)), 0, 1);
    mix(out, growl(sr, rng, d, rng.range(210, 250), 120), 0, 0.6);
    mix(out, swish(sr, rng, d, 3500, 1500, 2), 0, 0.25);
    return chunk(out, 2.4);
  });
  def('mob.enderman.hit', { v: 2, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.35, 0.5), out = alloc(sr, d + 0.03);
    mix(out, growl(sr, rng, d, rng.range(380, 460), rng.range(180, 220)), 0, 1);
    mix(out, thud(sr, 0.12, 300, 110, 0.02, 0.05), 0, 0.5);
    return chunk(out, 2.0);
  });
  def('mob.enderman.death', { v: 2, vol: 0.85, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(0.95, 1.1), out = alloc(sr, d + 0.05);
    mix(out, growl(sr, rng, d, rng.range(420, 520), rng.range(70, 90)), 0, 1);
    mix(out, swish(sr, rng, d, 3000, 500, 2), 0, 0.3);
    return chunk(out, 2.0);
  });
  def('mob.slime.small', { v: 4, vol: 0.7 }, function (sr, rng) {
    var out = alloc(sr, 0.24);
    mix(out, burst(sr, rng, 0.16, { bp: [rng.range(350, 550), 2.5], att: 0.004, tau: 0.045 }), 0, 0.7);
    mix(out, thud(sr, 0.16, rng.range(260, 340), 110, 0.03, 0.05), 0, 0.5);
    bubble(out, sr, 0.01, rng.range(400, 700), rng.range(1.5, 2.5), 0.03, 0.5);
    return chunk(out, 1.2);
  });
  def('mob.slime.big', { v: 3, vol: 0.85, rate: RATE_LO }, function (sr, rng) {
    var out = alloc(sr, 0.4);
    mix(out, burst(sr, rng, 0.3, { bp: [rng.range(180, 300), 2.2], att: 0.006, tau: 0.09 }), 0, 0.8);
    mix(out, thud(sr, 0.3, rng.range(150, 200), 60, 0.05, 0.1), 0, 0.6);
    bubble(out, sr, 0.02, rng.range(220, 380), rng.range(1.5, 2.2), 0.05, 0.6);
    bubble(out, sr, 0.09, rng.range(300, 500), rng.range(1.5, 2.2), 0.04, 0.4);
    return chunk(out, 1.3);
  });
  def('mob.bat.idle', { v: 3, vol: 0.45 }, function (sr, rng) {
    var out = alloc(sr, 0.4), n = rng.int(2, 3);
    for (var i = 0; i < n; i++) mix(out, squeak(sr, rng, 0.07, rng.range(5000, 7500), rng.range(5500, 8000)), M.round(i * 0.11 * sr), 0.8);
    return chunk(out, 1.1);
  });
  // wolves and squid
  def('mob.wolf.bark', { v: 3, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.16, 0.22), out = alloc(sr, d + 0.04);
    mix(out, growl(sr, rng, d, rng.range(430, 520), rng.range(220, 280)), 0, 1);
    mix(out, burst(sr, rng, d, { bp: [rng.range(1200, 1800), 1.2], att: 0.003, tau: 0.05 }), 0, 0.25);
    return chunk(out, 2.0);
  });
  def('mob.wolf.growl', { v: 2, vol: 0.75, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(0.8, 1.1), out = alloc(sr, d + 0.04);
    mix(out, growl(sr, rng, d, rng.range(105, 130), rng.range(80, 95)), 0, 1);
    mix(out, burst(sr, rng, d, { bp: [rng.range(500, 800), 1.5], att: 0.05, tau: d * 0.4, color: 'pink' }), 0, 0.3);
    return chunk(out, 2.2);
  });
  def('mob.wolf.whine', { v: 2, vol: 0.7 }, function (sr, rng) {
    var d = rng.range(0.55, 0.8), out = alloc(sr, d + 0.04);
    mix(out, growl(sr, rng, d, rng.range(700, 900), rng.range(450, 560)), 0, 1);
    return chunk(out, 1.4);
  });
  def('mob.wolf.pant', { v: 2, vol: 0.5 }, function (sr, rng) {
    var out = alloc(sr, 1.1);
    for (var i = 0; i < 6; i++) mix(out, burst(sr, rng, 0.11, { bp: [rng.range(2400, 3200), 1.0], att: 0.02, tau: 0.03 }), M.round((0.05 + i * 0.16) * sr), 0.7);
    return chunk(out, 1.0);
  });
  def('mob.wolf.death', { v: 2, vol: 0.8, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(0.9, 1.2), out = alloc(sr, d + 0.05);
    mix(out, growl(sr, rng, d, rng.range(520, 600), rng.range(150, 190)), 0, 1);
    return chunk(out, 1.8);
  });
  def('mob.squid.hurt', { v: 3, vol: 0.6 }, function (sr, rng) {
    var out = alloc(sr, 0.5);
    for (var i = 0; i < 4; i++) bubble(out, sr, 0.02 + i * 0.07, rng.range(300, 700), rng.range(1.5, 2.6), 0.04, 0.6);
    mix(out, burst(sr, rng, 0.35, { bp: [rng.range(500, 900), 2], att: 0.02, tau: 0.1, color: 'pink' }), 0, 0.4);
    return chunk(out, 1.2);
  });
  def('loop.rain', { v: 1, vol: 0.45, rate: RATE_LO, loop: true }, function (sr, rng) {
    var sec = 6, L = M.round(sec * sr), i, k;
    var y = circular(noise(L, rng), function (z) { colorize(z, 'pink'); bq(z, 'hp', 300, 0.7, sr); bq(z, 'lp', 3200, 0.7, sr); });
    var drops = new Float32Array(L), nd = M.round(sec * 90);
    for (k = 0; k < nd; k++) {
      var p = M.floor(rng() * L), a = 0.3 + 0.7 * M.pow(rng(), 3), len = 1 + M.floor(rng() * 3);
      for (var j = 0; j < len; j++) drops[(p + j) % L] += a * (rng() * 2 - 1);
    }
    var dr = circular(drops, function (z) { bq(z, 'bp', 2500, 1.0, sr); });
    var roof = circular(noise(L, rng), function (z) { bq(z, 'lp', 700, 0.7, sr); });
    norm(y, 1); norm(dr, 1); norm(roof, 1);
    var out = new Float32Array(L);
    for (i = 0; i < L; i++) {
      var u = i / L, am = 1 + 0.05 * M.sin(TAU * 3 * u) + 0.04 * M.sin(TAU * 7 * u + 1.3);
      out[i] = (y[i] * 0.8 + dr[i] * 0.22 + roof[i] * 0.4) * am;
    }
    return out;
  });
  def('loop.fire', { v: 1, vol: 0.5, rate: RATE_LO, loop: true }, function (sr, rng) {
    var sec = 5, L = M.round(sec * sr), i, k;
    var bed = circular(noise(L, rng), function (z) { colorize(z, 'pink'); bq(z, 'lp', 700, 0.7, sr); bq(z, 'hp', 90, 0.7, sr); });
    norm(bed, 1);
    for (i = 0; i < L; i++) bed[i] *= 0.75 + 0.25 * M.sin(TAU * 2 * i / L) * M.sin(TAU * 5 * i / L + 0.7);
    var cr = new Float32Array(L), tmp = new Float32Array(M.round(0.08 * sr)), n = M.round(sec * rng.range(10, 14));
    for (k = 0; k < n; k++) {
      tmp.fill(0); tick(tmp, sr, rng, 0.001, rng.range(1500, 4500), 0.3 + 0.7 * M.pow(rng(), 2.5), rng.range(0.003, 0.008));
      mixWrap(cr, tmp, rng() * L, 1);
    }
    for (k = 0; k < M.round(sec * 1.2); k++) {
      tmp.fill(0); tick(tmp, sr, rng, 0.001, rng.range(600, 1200), 1, 0.015);
      mixWrap(cr, tmp, rng() * L, rng.range(0.5, 1));
    }
    norm(cr, 1);
    var out = new Float32Array(L);
    for (i = 0; i < L; i++) out[i] = bed[i] * 0.35 + cr[i] * 0.9;
    return out;
  });
  def('loop.wind', { v: 1, vol: 0.45, rate: RATE_LO, loop: true }, function (sr, rng) {
    var sec = 8, L = M.round(sec * sr), p1 = rng() * TAU, p2 = rng() * TAU, i;
    var fcf = function (t) { var u = t / sec; return 380 + 160 * M.sin(TAU * 2 * u + p1) + 90 * M.sin(TAU * 5 * u + p2); };
    var y = circular(noise(L, rng), function (z) { colorize(z, 'pink'); bqSweep(z, 'bp', fcf, 1.2, sr); bq(z, 'lp', 1400, 0.7, sr); });
    var w = circular(noise(L, rng), function (z) { bqSweep(z, 'bp', function (t) { return fcf(t) * 2.2; }, 14, sr); });
    norm(y, 1); norm(w, 1);
    var out = new Float32Array(L);
    for (i = 0; i < L; i++) out[i] = (y[i] + 0.15 * w[i]) * (0.65 + 0.35 * (0.5 + 0.5 * M.sin(TAU * 3 * i / L + p2)));
    return out;
  });
  def('loop.lava', { v: 1, vol: 0.5, rate: RATE_LO, loop: true }, function (sr, rng) {
    var sec = 6, L = M.round(sec * sr), i, k;
    var bed = circular(noise(L, rng), function (z) { colorize(z, 'brown'); bq(z, 'lp', 220, 0.7, sr); bq(z, 'hp', 30, 0.7, sr); });
    norm(bed, 1);
    for (i = 0; i < L; i++) bed[i] *= 0.8 + 0.2 * M.sin(TAU * 3 * i / L + 0.4);
    var bub = new Float32Array(L), tb = new Float32Array(M.round(0.45 * sr)), nb = M.round(sec * rng.range(3, 4.5));
    for (k = 0; k < nb; k++) {
      tb.fill(0); bubble(tb, sr, 0.001, rng.range(70, 180), rng.range(0.6, 1.2), rng.range(0.04, 0.06), rng.range(0.4, 1));
      mixWrap(bub, tb, rng() * L, 1);
    }
    var pops = new Float32Array(L), tp = new Float32Array(M.round(0.2 * sr));
    for (k = 0; k < M.round(sec * 0.8); k++) {
      tp.fill(0); tick(tp, sr, rng, 0.001, rng.range(800, 1300), 1, 0.015);
      mix(tp, burst(sr, rng, 0.15, { hp2: [3500, 0.7], att: 0.004, tau: 0.04 }), 0, 0.15);
      mixWrap(pops, tp, rng() * L, rng.range(0.3, 1));
    }
    norm(bub, 1); norm(pops, 1);
    var out = new Float32Array(L);
    for (i = 0; i < L; i++) out[i] = bed[i] * 0.45 + bub[i] * 0.8 + pops[i] * 0.25;
    return out;
  });

  // ---------------------------------------------------------------- dimensions update: portals, the Nether, the End, villages
  // formant voice with a pitch curve and a vowel path
  function voice(sr, rng, d, f0, forms, o) {
    o = o || {};
    return vocal(sr, rng, d, { f0: f0, form: formLerp(forms), jit: o.jit === undefined ? 0.02 : o.jit, rough: o.rough || 0, breath: o.breath || 0.1,
      vib: o.vib, src: o.src || 'saw', tilt: o.tilt || 2500, env: o.env || [0, 0, 0.02, 1, d * 0.6, 0.8, d, 0] });
  }
  // room for a reverb tail, then the reverb
  function hall(x, sr, t60, wet) { var y = new Float32Array(x.length + M.round(t60 * 0.8 * sr)); y.set(x); return reverb(y, sr, t60, 0.5, wet, 1, 0.9); }
  // portal hum: a slow throbbing drone with swirling air
  def('portal.portal', { v: 2, vol: 0.5, rate: RATE_LO, fo: 0.4 }, function (sr, rng) {
    var d = 3.2, n = M.round(d * sr), out = new Float32Array(n), i;
    var air = pink(n, rng); bqSweep(air, 'bp', function (t) { return 500 + 300 * M.sin(TAU * 0.9 * t) + 150 * M.sin(TAU * 2.3 * t + 1); }, 2.5, sr); norm(air, 1);
    var dr = osc(sr, d, function (t) { return 82 * (1 + 0.03 * M.sin(TAU * 0.5 * t)); }, 'saw'); lp1(dr, 300, sr); norm(dr, 1);
    var hi = osc(sr, d, function (t) { return 246 * (1 + 0.01 * M.sin(TAU * 5.3 * t)); }, 'tri'); norm(hi, 1);
    for (i = 0; i < n; i++) { var t = i / sr, th = 0.6 + 0.4 * M.sin(TAU * 1.4 * t); out[i] = air[i] * 0.55 + dr[i] * 0.5 * th + hi[i] * 0.12; }
    envPts(out, sr, [0, 0, 0.6, 1, d - 0.8, 1, d, 0]);
    return out;
  });
  def('portal.trigger', { v: 1, vol: 0.55, rate: RATE_LO }, function (sr, rng) {
    var d = 4, out = alloc(sr, d), n = out.length, i;
    var w = pink(n, rng); bqSweep(w, 'bp', exps(180, 1400, d), 2.2, sr); norm(w, 1);
    var tone = osc(sr, d, exps(70, 220, d), 'saw'); lp1(tone, 600, sr); norm(tone, 1);
    for (i = 0; i < n; i++) { var t = i / sr; out[i] = w[i] * 0.7 + tone[i] * 0.45 * (0.6 + 0.4 * M.sin(TAU * (2 + t * 2) * t)); }
    envPts(out, sr, [0, 0, 1.2, 0.7, 3.2, 1, d, 0]);
    return out;
  });
  def('portal.travel', { v: 1, vol: 0.6, rate: RATE_LO }, function (sr, rng) {
    var d = 4.5, out = alloc(sr, d), n = out.length;
    var w = pink(n, rng); bqSweep(w, 'bp', exps(1600, 120, d), 1.6, sr); norm(w, 1);
    var low = brown(n, rng); lp1(low, 150, sr); norm(low, 1);
    mix(out, w, 0, 0.8); mix(out, low, 0, 0.5);
    grains(out, sr, rng, { n: 60, t0: 0, t1: d * 0.6, dist: 1.4, gl: [0.002, 0.01], f: [2000, 7000], q: 8, decay: 1.5, amp: 0.25 });
    envPts(out, sr, [0, 0, 0.15, 1, d * 0.5, 0.8, d, 0]);
    return out;
  });
  // the Divine Beast's call: a great hollow horn that bends upward and sags, over a sub drone and high wind, in a long valley echo
  def('medoh.cry', { v: 1, vol: 0.8, rate: RATE_LO }, function (sr, rng) {
    var d = 8, out = alloc(sr, d), n = out.length;
    var glide = function (t) { var u = M.min(1, t / 0.9), f = 174 * (1 + 0.5 * u * u * (3 - 2 * u)); if (t > 2.3) f *= 1 - 0.18 * M.min(1, (t - 2.3) / 1.5); return f * (1 + 0.012 * M.sin(TAU * 5.2 * t)); };
    var a = osc(sr, 4, glide, 'saw'), b = osc(sr, 4, function (t) { return glide(t) * 1.498; }, 'tri'), c = osc(sr, 4, function (t) { return glide(t) * 0.5; }, 'sine');
    var voice = alloc(sr, 4); mix(voice, a, 0, 0.5); mix(voice, b, 0, 0.35); mix(voice, c, 0, 0.6);
    bqSweep(voice, 'bp', function (t) { return 480 + 760 * M.min(1, t / 1.2); }, 1.1, sr);
    envPts(voice, sr, [0, 0, 0.4, 1, 2.7, 0.85, 4, 0]);
    mix(out, voice, M.round(0.1 * sr), 1);
    var wind = pink(n, rng); bqSweep(wind, 'bp', function (t) { return 900 + 500 * M.sin(t * 1.3); }, 0.8, sr); norm(wind, 1); envPts(wind, sr, [0, 0, 1, 0.5, d - 1.5, 0.35, d, 0]); mix(out, wind, 0, 0.1);
    reverb(out, sr, 4.5, 0.35, 0.55, 0.75, 1.4);
    norm(out, 0.9); envPts(out, sr, [0, 1, d - 0.8, 1, d, 0]);
    return out;
  });
  // ambience loops
  def('loop.nether', { v: 1, vol: 0.5, rate: RATE_LO, loop: true }, function (sr, rng) {
    var sec = 9, L = M.round(sec * sr), i, k;
    var rumble = circular(noise(L, rng), function (z) { colorize(z, 'brown'); bq(z, 'lp', 140, 0.7, sr); bq(z, 'hp', 25, 0.7, sr); });
    var roar = circular(noise(L, rng), function (z) { colorize(z, 'pink'); bqSweep(z, 'bp', function (t) { return 260 + 120 * M.sin(TAU * t / sec * 2 + 0.4); }, 1.8, sr); });
    norm(rumble, 1); norm(roar, 1);
    var cr = new Float32Array(L), tmp = new Float32Array(M.round(0.06 * sr));
    for (k = 0; k < 14; k++) { tmp.fill(0); tick(tmp, sr, rng, 0.001, rng.range(500, 1500), 1, 0.01); mixWrap(cr, tmp, rng() * L, rng.range(0.2, 0.6)); }
    norm(cr, 1);
    var out = new Float32Array(L);
    for (i = 0; i < L; i++) { var u = i / L; out[i] = rumble[i] * (0.75 + 0.25 * M.sin(TAU * 2 * u)) + roar[i] * 0.3 * (0.5 + 0.5 * M.sin(TAU * 3 * u + 1.7)) + cr[i] * 0.12; }
    return out;
  });
  def('loop.end', { v: 1, vol: 0.4, rate: RATE_LO, loop: true }, function (sr, rng) {
    var sec = 10, L = M.round(sec * sr), i;
    var fcf = function (t) { var u = t / sec; return 600 + 260 * M.sin(TAU * u + 0.3) + 120 * M.sin(TAU * 4 * u); };
    var y = circular(noise(L, rng), function (z) { colorize(z, 'pink'); bqSweep(z, 'bp', fcf, 3, sr); });
    var hum = new Float32Array(L), ph = 0; for (i = 0; i < L; i++) { ph += 55 / sr; hum[i] = M.sin(TAU * ph) + 0.3 * M.sin(TAU * ph * 1.5); }
    norm(y, 1); norm(hum, 1);
    var out = new Float32Array(L);
    for (i = 0; i < L; i++) out[i] = y[i] * (0.6 + 0.4 * M.sin(TAU * 2 * i / L)) + hum[i] * 0.12;
    return out;
  });
  // biome mood additions of the Nether (one-shots, played now and then)
  def('ambient.nether_wastes.additions', { v: 2, vol: 0.45, rate: RATE_LO, fo: 0.3 }, function (sr, rng) {
    var d = rng.range(2.2, 3), out = alloc(sr, d);
    mix(out, groan(sr, rng, d, exps(rng.range(70, 90), rng.range(45, 55), d), [[0, vowel('o', 0.7)], [d, vowel('u', 0.7)]], 0.6, [0, 0, d * 0.3, 1, d, 0]), 0, 0.8);
    mix(out, burst(sr, rng, d, { color: 'brown', lp: 200, att: d * 0.3, tau: d * 0.4 }), 0, 0.5);
    return out;
  });
  def('ambient.soul_sand_valley.additions', { v: 2, vol: 0.4, rate: RATE_LO, fo: 0.4 }, function (sr, rng) {
    var d = rng.range(2.5, 3.2), out = alloc(sr, d), f = rng.range(380, 520);
    mix(out, voice(sr, rng, d, pts([0, f, d * 0.4, f * 1.3, d, f * 0.8]), [[0, vowel('u', 1.1)], [d * 0.5, vowel('o', 1.1)], [d, vowel('u', 1)]], { breath: 0.8, vib: [5, 0.03], tilt: 1500, env: [0, 0, d * 0.3, 1, d * 0.7, 0.6, d, 0] }), 0, 0.6);
    mix(out, burst(sr, rng, d, { color: 'pink', sweep: { type: 'bp', f0: 900, f1: 300, q: 2, dur: d }, att: d * 0.2, tau: d * 0.4 }), 0, 0.5);
    return out;
  });
  def('ambient.basalt_deltas.additions', { v: 2, vol: 0.45, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(1.5, 2.2), out = alloc(sr, d);
    crackles(out, sr, rng, rng.int(18, 30), 0.05, d - 0.1, 4);
    mix(out, burst(sr, rng, d, { color: 'brown', lp: 300, att: 0.2, tau: d * 0.3 }), 0, 0.6);
    return norm(out, 1);
  });
  def('ambient.crimson_forest.additions', { v: 2, vol: 0.4, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(1.6, 2.2), out = alloc(sr, d);
    mix(out, growl(sr, rng, d, rng.range(140, 170), rng.range(90, 110)), 0, 0.7);
    mix(out, scratchy(sr, rng, d * 0.6, 2200, 1200, 30), M.round(d * 0.3 * sr), 0.25);
    return out;
  });
  def('ambient.warped_forest.additions', { v: 2, vol: 0.4, rate: RATE_LO, fo: 0.4 }, function (sr, rng) {
    var d = rng.range(2.2, 3), out = alloc(sr, d), f = mtof(rng.int(55, 62));
    mix(out, osc(sr, d, function (t) { return f * (1 + 0.02 * M.sin(TAU * 0.7 * t)); }, 'tri'), 0, 0.5); mix(out, osc(sr, d, f * 1.498, 'sine'), 0, 0.3);
    mix(out, burst(sr, rng, d, { color: 'pink', bp: [rng.range(1500, 2500), 3], att: d * 0.3, tau: d * 0.3 }), 0, 0.3);
    envPts(out, sr, [0, 0, d * 0.4, 1, d, 0]);
    return out;
  });
  // ghast: plaintive high cries
  def('mob.ghast.moan', { v: 4, vol: 0.7, rate: RATE_LO, range: 48 }, function (sr, rng) {
    var d = rng.range(1.1, 1.8), out = alloc(sr, d + 0.05), f = rng.range(520, 700);
    mix(out, voice(sr, rng, d, pts([0, f * 0.85, d * 0.25, f * 1.15, d * 0.6, f, d, f * 0.7]), [[0, vowel('o', 1.4)], [d * 0.5, vowel('u', 1.5)], [d, vowel('o', 1.3)]], { vib: [rng.range(5, 7), 0.04], breath: 0.25, tilt: 3000, env: [0, 0, 0.15, 1, d * 0.7, 0.8, d, 0] }), 0, 1);
    mix(out, voice(sr, rng, d, pts([0, f * 0.425, d, f * 0.36]), [[0, vowel('u', 1.1)], [d, vowel('o', 1.1)]], { breath: 0.4, tilt: 1800 }), 0, 0.25);
    return hall(chunk(out, 1.2), sr, 1.2, 0.3);
  });
  def('mob.ghast.scream', { v: 3, vol: 0.8, range: 48 }, function (sr, rng) {
    var d = rng.range(0.4, 0.6), out = alloc(sr, d + 0.05), f = rng.range(900, 1150);
    mix(out, voice(sr, rng, d, pts([0, f * 0.8, d * 0.2, f * 1.2, d, f * 0.9]), [[0, vowel('e', 1.6)], [d, vowel('i', 1.6)]], { rough: 0.25, breath: 0.3, tilt: 4000 }), 0, 1);
    return chunk(out, 1.8);
  });
  def('mob.ghast.death', { v: 2, vol: 0.8, rate: RATE_LO, range: 48 }, function (sr, rng) {
    var d = rng.range(1.2, 1.5), out = alloc(sr, d + 0.05), f = rng.range(950, 1150);
    mix(out, voice(sr, rng, d, exps(f, f * 0.35, d), [[0, vowel('e', 1.6)], [d * 0.5, vowel('a', 1.5)], [d, vowel('o', 1.3)]], { rough: 0.3, breath: 0.3, tilt: 3500, vib: [8, 0.05] }), 0, 1);
    return hall(chunk(out, 1.6), sr, 1.0, 0.3);
  });
  def('mob.ghast.charge', { v: 2, vol: 0.75, range: 48 }, function (sr, rng) {
    var d = rng.range(0.6, 0.8), out = alloc(sr, d + 0.05), f = rng.range(650, 800);
    mix(out, voice(sr, rng, d, exps(f * 0.8, f * 1.5, d), [[0, vowel('u', 1.4)], [d, vowel('e', 1.5)]], { vib: [9, 0.05], breath: 0.25, tilt: 3500 }), 0, 1);
    return chunk(out, 1.4);
  });
  def('mob.ghast.fireball', { v: 2, vol: 0.8, range: 48 }, function (sr, rng) {
    var out = alloc(sr, 0.7);
    mix(out, swish(sr, rng, 0.6, 2500, 400, 1.2), 0, 0.8); mix(out, thud(sr, 0.3, 200, 60, 0.04, 0.08), 0, 0.6); crackles(out, sr, rng, 8, 0.02, 0.4, 1);
    return chunk(out, 1.4);
  });
  // blaze: hollow metallic breathing
  def('mob.blaze.breathe', { v: 3, vol: 0.55, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(1.3, 1.8), out = alloc(sr, d + 0.05);
    mix(out, burst(sr, rng, d, { color: 'pink', bp: [rng.range(700, 1000), 1.4], att: d * 0.35, tau: d * 0.3 }), 0, 0.8);
    var m = new Float32Array(out.length); addModes(m, sr, 0.05, rng.range(380, 460), [[1, 0.6, 1], [2.43, 0.4, 0.5], [3.9, 0.3, 0.3]], 0.3, rng); mix(out, norm(m, 1), 0, 0.25);
    rattle(out, sr, rng, d * 0.3, d * 0.8, 8, 1200, 2400, 0.25);
    return out;
  });
  def('mob.blaze.hit', { v: 2, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 0.6); metalHit(out, sr, rng, 0, rng.range(500, 700), 0.7, 0.6); mix(out, burst(sr, rng, 0.4, { color: 'pink', bp: [900, 1.2], att: 0.01, tau: 0.12 }), 0, 0.6);
    return chunk(out, 1.4);
  });
  def('mob.blaze.death', { v: 2, vol: 0.8, rate: RATE_LO }, function (sr, rng) {
    var d = 1.4, out = alloc(sr, d + 0.05);
    mix(out, burst(sr, rng, d, { color: 'pink', sweep: { type: 'bp', f0: 1400, f1: 250, q: 1.5, dur: d }, att: 0.02, tau: d * 0.5 }), 0, 0.8);
    metalHit(out, sr, rng, 0, rng.range(380, 460), 0.6, 1.2); rattle(out, sr, rng, 0.05, d * 0.7, 14, 900, 2200, 0.4);
    return chunk(out, 1.3);
  });
  def('mob.blaze.shoot', { v: 2, vol: 0.7 }, function (sr, rng) {
    var out = alloc(sr, 0.5); mix(out, swish(sr, rng, 0.45, 600, 3000, 1.0), 0, 0.8); crackles(out, sr, rng, 10, 0.02, 0.35, 1);
    return chunk(out, 1.3);
  });
  // piglins and hoglins: snorts and squeals
  function snort(sr, rng, d, f, rough) {
    return voice(sr, rng, d, pts([0, f, d * 0.3, f * 1.2, d, f * 0.8]), [[0, vowel('u', 1.05)], [d * 0.4, vowel('uh', 1.1)], [d, vowel('o', 1.0)]], { rough: rough, breath: 0.5, src: 'sq', tilt: 1800, jit: 0.04 });
  }
  def('mob.zpig.zpig', { v: 3, vol: 0.7, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(0.6, 0.9), out = alloc(sr, d + 0.05);
    mix(out, snort(sr, rng, d, rng.range(110, 135), 0.7), 0, 1);
    mix(out, groan(sr, rng, d, exps(rng.range(80, 95), 70, d), [[0, vowel('uh', 0.9)], [d, vowel('u', 0.85)]], 0.6, [0, 0, 0.1, 1, d, 0]), 0, 0.5);
    return chunk(out, 1.8);
  });
  def('mob.zpig.zpigangry', { v: 2, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.5, 0.7), out = alloc(sr, d + 0.05), f = rng.range(260, 320);
    mix(out, voice(sr, rng, d, pts([0, f, d * 0.3, f * 1.5, d, f]), [[0, vowel('ae', 1.2)], [d, vowel('e', 1.2)]], { rough: 0.6, breath: 0.3, src: 'sq' }), 0, 1);
    return chunk(out, 2.2);
  });
  def('mob.zpig.zpighurt', { v: 2, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.3, 0.4), out = alloc(sr, d + 0.03), f = rng.range(230, 280);
    mix(out, voice(sr, rng, d, exps(f * 1.3, f * 0.8, d), [[0, vowel('ae', 1.2)], [d, vowel('uh', 1.1)]], { rough: 0.6, breath: 0.3, src: 'sq' }), 0, 1);
    return chunk(out, 2.0);
  });
  def('mob.zpig.zpigdeath', { v: 2, vol: 0.8, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(0.9, 1.1), out = alloc(sr, d + 0.05), f = rng.range(240, 280);
    mix(out, voice(sr, rng, d, exps(f * 1.2, f * 0.4, d), [[0, vowel('ae', 1.2)], [d * 0.5, vowel('o', 1.1)], [d, vowel('u', 1)]], { rough: 0.6, breath: 0.35, src: 'sq' }), 0, 1);
    return chunk(out, 1.8);
  });
  def('mob.piglin.idle', { v: 4, vol: 0.7 }, function (sr, rng, vi) {
    var out = alloc(sr, 0.9), t = 0, k = vi % 2 ? 2 : 1;
    for (var s = 0; s < k; s++) { var d = rng.range(0.2, 0.32); mix(out, snort(sr, rng, d, rng.range(150, 190), 0.6), M.round(t * sr), 1); t += d + rng.range(0.06, 0.12); }
    return chunk(out, 1.9);
  });
  def('mob.piglin.angry', { v: 3, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.45, 0.6), out = alloc(sr, d + 0.05);
    mix(out, snort(sr, rng, d, rng.range(200, 240), 0.8), 0, 1); mix(out, burst(sr, rng, d, { bp: [rng.range(1200, 1600), 1.2], att: 0.01, tau: d * 0.4 }), 0, 0.35);
    return chunk(out, 2.4);
  });
  def('mob.piglin.hurt', { v: 2, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.25, 0.35), out = alloc(sr, d + 0.03), f = rng.range(280, 330);
    mix(out, voice(sr, rng, d, exps(f * 1.3, f, d), [[0, vowel('ae', 1.2)], [d, vowel('uh', 1.15)]], { rough: 0.5, breath: 0.3, src: 'sq' }), 0, 1);
    return chunk(out, 2.0);
  });
  def('mob.piglin.death', { v: 2, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.7, 0.9), out = alloc(sr, d + 0.05), f = rng.range(260, 300);
    mix(out, voice(sr, rng, d, exps(f * 1.3, f * 0.5, d), [[0, vowel('ae', 1.2)], [d, vowel('o', 1.1)]], { rough: 0.55, breath: 0.3, src: 'sq' }), 0, 1);
    return chunk(out, 1.8);
  });
  def('mob.piglin.admiring', { v: 2, vol: 0.65 }, function (sr, rng) {
    var d = rng.range(0.8, 1.0), out = alloc(sr, d + 0.05), f = rng.range(170, 200);
    mix(out, voice(sr, rng, d, pts([0, f, d * 0.5, f * 1.35, d, f * 1.1]), [[0, vowel('o', 1.1)], [d, vowel('u', 1.1)]], { rough: 0.3, breath: 0.35, src: 'sq', vib: [6, 0.05] }), 0, 1);
    return chunk(out, 1.5);
  });
  def('mob.piglin.celebrate', { v: 2, vol: 0.7 }, function (sr, rng) {
    var out = alloc(sr, 1.0), t = 0;
    for (var s = 0; s < 3; s++) { var d = rng.range(0.16, 0.22); mix(out, snort(sr, rng, d, rng.range(200, 260), 0.4), M.round(t * sr), 1); t += d + 0.08; }
    return chunk(out, 1.8);
  });
  def('mob.piglin.converted_to_zombified', { v: 1, vol: 0.8, rate: RATE_LO }, function (sr, rng) {
    var d = 1.3, out = alloc(sr, d + 0.05);
    mix(out, snort(sr, rng, 0.4, 220, 0.6), 0, 0.8);
    mix(out, groan(sr, rng, d - 0.35, exps(110, 70, d - 0.35), [[0, vowel('a', 0.9)], [d, vowel('u', 0.85)]], 0.6, [0, 0, 0.1, 1, d - 0.35, 0]), M.round(0.35 * sr), 1);
    return chunk(out, 1.8);
  });
  def('mob.hoglin.idle', { v: 3, vol: 0.75, rate: RATE_LO }, function (sr, rng) {
    var out = alloc(sr, 1.0), t = 0;
    for (var s = 0; s < 2; s++) { var d = rng.range(0.25, 0.4); mix(out, snort(sr, rng, d, rng.range(85, 110), 0.85), M.round(t * sr), 1); t += d + rng.range(0.1, 0.2); }
    return chunk(out, 2.2);
  });
  def('mob.hoglin.angry', { v: 2, vol: 0.85, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(0.6, 0.8), out = alloc(sr, d + 0.05);
    mix(out, snort(sr, rng, d, rng.range(110, 130), 0.9), 0, 1); mix(out, growl(sr, rng, d, 90, 70), 0, 0.5);
    return chunk(out, 2.5);
  });
  def('mob.hoglin.hurt', { v: 2, vol: 0.85 }, function (sr, rng) { var d = rng.range(0.3, 0.4), out = alloc(sr, d + 0.03); mix(out, snort(sr, rng, d, rng.range(150, 180), 0.8), 0, 1); return chunk(out, 2.3); });
  def('mob.hoglin.death', { v: 2, vol: 0.85, rate: RATE_LO }, function (sr, rng) {
    var d = rng.range(0.9, 1.2), out = alloc(sr, d + 0.05), f = rng.range(140, 160);
    mix(out, voice(sr, rng, d, exps(f, f * 0.5, d), [[0, vowel('a', 0.9)], [d, vowel('u', 0.85)]], { rough: 0.8, breath: 0.4, src: 'sq', tilt: 1600 }), 0, 1);
    return chunk(out, 2.0);
  });
  def('mob.hoglin.attack', { v: 2, vol: 0.85 }, function (sr, rng) {
    var out = alloc(sr, 0.5); mix(out, thud(sr, 0.3, 160, 60, 0.03, 0.07), 0, 0.9); mix(out, snort(sr, rng, 0.3, rng.range(120, 140), 0.9), M.round(0.02 * sr), 0.7);
    return chunk(out, 2.0);
  });
  // strider: warbling chirps
  def('mob.strider.idle', { v: 3, vol: 0.6 }, function (sr, rng) {
    var d = rng.range(0.4, 0.6), out = alloc(sr, d + 0.05), f = rng.range(420, 560);
    mix(out, voice(sr, rng, d, function (t) { return f * (1 + 0.25 * M.sin(TAU * 11 * t)); }, [[0, vowel('u', 1.3)], [d, vowel('o', 1.3)]], { breath: 0.15, src: 'sq', tilt: 2600 }), 0, 1);
    return chunk(out, 1.4);
  });
  def('mob.strider.hurt', { v: 2, vol: 0.7 }, function (sr, rng) {
    var d = 0.3, out = alloc(sr, d + 0.03), f = rng.range(600, 720);
    mix(out, voice(sr, rng, d, exps(f * 1.3, f, d), [[0, vowel('e', 1.3)], [d, vowel('u', 1.3)]], { rough: 0.3, src: 'sq' }), 0, 1);
    return chunk(out, 1.6);
  });
  def('mob.strider.death', { v: 1, vol: 0.75 }, function (sr, rng) {
    var d = 0.8, out = alloc(sr, d + 0.03), g = exps(620, 250, d);
    mix(out, voice(sr, rng, d, function (t) { return g(t) * (1 + 0.2 * M.sin(TAU * 9 * t)); }, [[0, vowel('e', 1.3)], [d, vowel('o', 1.2)]], { rough: 0.3, src: 'sq' }), 0, 1);
    return chunk(out, 1.5);
  });
  // magma cubes: wet squelch with a sizzle
  def('mob.magmacube.small', { v: 3, vol: 0.7 }, function (sr, rng) {
    var out = alloc(sr, 0.28);
    mix(out, burst(sr, rng, 0.18, { bp: [rng.range(300, 480), 2.3], att: 0.004, tau: 0.05 }), 0, 0.7); mix(out, thud(sr, 0.16, rng.range(220, 300), 90, 0.03, 0.05), 0, 0.5);
    mix(out, burst(sr, rng, 0.2, { hp2: [3500, 0.7], att: 0.005, tau: 0.05 }), 0, 0.2);
    return chunk(out, 1.3);
  });
  def('mob.magmacube.big', { v: 3, vol: 0.85, rate: RATE_LO }, function (sr, rng) {
    var out = alloc(sr, 0.45);
    mix(out, burst(sr, rng, 0.32, { bp: [rng.range(150, 260), 2.0], att: 0.006, tau: 0.1 }), 0, 0.8); mix(out, thud(sr, 0.32, rng.range(130, 170), 50, 0.05, 0.1), 0, 0.7);
    mix(out, burst(sr, rng, 0.35, { hp2: [3000, 0.7], att: 0.01, tau: 0.08 }), 0, 0.2);
    return chunk(out, 1.4);
  });
  // silverfish: dry hiss and chitter
  def('mob.silverfish.say', { v: 3, vol: 0.6 }, function (sr, rng) {
    var d = rng.range(0.4, 0.55), out = alloc(sr, d + 0.03), s = scratchy(sr, rng, d, rng.range(4500, 5500), rng.range(3000, 3800), rng.range(70, 110));
    envPts(s, sr, [0, 0, 0.03, 1, d * 0.7, 0.8, d, 0]); mix(out, s, 0, 1);
    return out;
  });
  def('mob.silverfish.hit', { v: 2, vol: 0.65 }, function (sr, rng) { var out = alloc(sr, 0.3); mix(out, scratchy(sr, rng, 0.25, 5500, 2500, 120), 0, 1); envPts(out, sr, [0, 0, 0.01, 1, 0.3, 0]); return out; });
  def('mob.silverfish.kill', { v: 2, vol: 0.65 }, function (sr, rng) { var out = alloc(sr, 0.6); mix(out, scratchy(sr, rng, 0.55, 6000, 1500, 90), 0, 1); envPts(out, sr, [0, 0, 0.01, 1, 0.6, 0]); return out; });
  // villagers: the nasal "hrmm"
  function hrmm(sr, rng, d, f0fn, nasal) {
    return voice(sr, rng, d, f0fn, [[0, vowel('m', 1.0)], [d * 0.25, vowel(nasal ? 'm' : 'uh', 1.05)], [d, vowel('m', 1.0)]], { rough: 0.15, breath: 0.12, tilt: 1800, jit: 0.015, env: [0, 0, 0.03, 1, d * 0.75, 0.8, d, 0] });
  }
  def('mob.villager.idle', { v: 4, vol: 0.7 }, function (sr, rng, vi) {
    var d = rng.range(0.45, 0.7), out = alloc(sr, d + 0.05), f = rng.range(150, 185);
    var curves = [pts([0, f, d * 0.5, f * 1.15, d, f * 0.9]), pts([0, f * 1.1, d, f * 0.85]), pts([0, f * 0.9, d * 0.6, f * 1.2, d, f * 1.05]), pts([0, f, d * 0.3, f * 0.92, d * 0.7, f * 1.12, d, f * 0.95])];
    mix(out, hrmm(sr, rng, d, curves[vi % 4], vi % 2), 0, 1);
    return chunk(out, 1.4);
  });
  def('mob.villager.yes', { v: 2, vol: 0.7 }, function (sr, rng) {
    var out = alloc(sr, 0.75), f = rng.range(160, 185);
    mix(out, hrmm(sr, rng, 0.28, pts([0, f, 0.28, f * 1.2]), true), 0, 1); mix(out, hrmm(sr, rng, 0.32, pts([0, f * 1.15, 0.32, f * 1.35]), false), M.round(0.34 * sr), 1);
    return chunk(out, 1.4);
  });
  def('mob.villager.no', { v: 2, vol: 0.7 }, function (sr, rng) {
    var d = rng.range(0.55, 0.7), out = alloc(sr, d + 0.05), f = rng.range(170, 190);
    mix(out, hrmm(sr, rng, d, pts([0, f * 1.1, d * 0.4, f * 1.15, d, f * 0.78]), true), 0, 1);
    return chunk(out, 1.4);
  });
  def('mob.villager.trade', { v: 3, vol: 0.7 }, function (sr, rng) {
    var d = rng.range(0.3, 0.45), out = alloc(sr, d + 0.05), f = rng.range(155, 180);
    mix(out, hrmm(sr, rng, d, pts([0, f, d * 0.5, f * 1.1, d, f]), false), 0, 1);
    return chunk(out, 1.4);
  });
  def('mob.villager.hurt', { v: 2, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.3, 0.4), out = alloc(sr, d + 0.03), f = rng.range(230, 270);
    mix(out, voice(sr, rng, d, exps(f * 1.25, f * 0.9, d), [[0, vowel('uh', 1.05)], [d, vowel('m', 1.0)]], { rough: 0.3, breath: 0.15, tilt: 2000 }), 0, 1);
    return chunk(out, 1.8);
  });
  def('mob.villager.death', { v: 2, vol: 0.8 }, function (sr, rng) {
    var d = rng.range(0.8, 1.0), out = alloc(sr, d + 0.05), f = rng.range(220, 250);
    mix(out, voice(sr, rng, d, exps(f * 1.2, f * 0.55, d), [[0, vowel('uh', 1.05)], [d * 0.5, vowel('o', 1.0)], [d, vowel('m', 1.0)]], { rough: 0.35, breath: 0.2, tilt: 2000 }), 0, 1);
    return chunk(out, 1.6);
  });
  // iron golem: heavy iron
  def('mob.irongolem.hit', { v: 3, vol: 0.85 }, function (sr, rng) { var out = alloc(sr, 0.9); metalHit(out, sr, rng, 0, rng.range(180, 260), 1, 1.2); mix(out, thud(sr, 0.2, 140, 60, 0.03, 0.06), 0, 0.6); return chunk(out, 1.3); });
  def('mob.irongolem.death', { v: 1, vol: 0.9, rate: RATE_LO }, function (sr, rng) {
    var out = alloc(sr, 1.8);
    metalHit(out, sr, rng, 0, 160, 1, 2); metalHit(out, sr, rng, 0.35, 120, 0.8, 2); metalHit(out, sr, rng, 0.7, 95, 0.7, 2.5); mix(out, thud(sr, 0.5, 100, 40, 0.06, 0.15), M.round(0.7 * sr), 0.8);
    return chunk(out, 1.2);
  });
  def('mob.irongolem.throw', { v: 2, vol: 0.85 }, function (sr, rng) {
    var out = alloc(sr, 0.6); mix(out, swish(sr, rng, 0.35, 500, 1800, 1), 0, 0.7); metalHit(out, sr, rng, 0.05, rng.range(200, 260), 0.8, 0.8); mix(out, thud(sr, 0.3, 120, 50, 0.04, 0.08), M.round(0.05 * sr), 0.8);
    return chunk(out, 1.5);
  });
  def('mob.irongolem.walk', { v: 4, vol: 0.55 }, function (sr, rng) { var out = alloc(sr, 0.4); mix(out, thud(sr, 0.3, rng.range(110, 140), 45, 0.03, 0.07), 0, 1); metalHit(out, sr, rng, 0.005, rng.range(250, 350), 0.25, 0.4); return chunk(out, 1.3); });
  def('mob.irongolem.repair', { v: 2, vol: 0.75 }, function (sr, rng) { var out = alloc(sr, 1.0); metalHit(out, sr, rng, 0, rng.range(900, 1200), 1, 1.0); metalHit(out, sr, rng, 0.18, rng.range(1100, 1400), 0.6, 0.8); return out; });
  def('mob.snowgolem.hurt', { v: 2, vol: 0.7 }, function (sr, rng) { var out = alloc(sr, 0.3); mix(out, burst(sr, rng, 0.25, { bp: [1300, 0.8], att: 0.005, tau: 0.06 }), 0, 0.7); grains(out, sr, rng, { n: 25, t0: 0, t1: 0.2, dist: 1.3, gl: [0.0008, 0.003], f: [1500, 4500], q: 3, decay: 0.08, amp: 0.7 }); return out; });
  def('mob.snowgolem.death', { v: 1, vol: 0.75 }, function (sr, rng) { var out = alloc(sr, 0.6); mix(out, burst(sr, rng, 0.5, { bp: [1100, 0.8], att: 0.01, tau: 0.15 }), 0, 0.7); grains(out, sr, rng, { n: 50, t0: 0, t1: 0.45, dist: 1.3, gl: [0.0008, 0.003], f: [1500, 4500], q: 3, decay: 0.2, amp: 0.7 }); return out; });
  def('mob.snowgolem.shoot', { v: 2, vol: 0.6 }, function (sr, rng) { var out = alloc(sr, 0.3); mix(out, swish(sr, rng, 0.25, 1500, 4000, 1.2), 0, 0.8); return out; });
  // the ender dragon: enormous growls, wingbeats, its death cry
  function roar(sr, rng, d, f0, f1) {
    var out = alloc(sr, d + 0.1);
    mix(out, growl(sr, rng, d, f0, f1), 0, 1); mix(out, growl(sr, rng, d, f0 * 0.5, f1 * 0.5), 0, 0.7);
    mix(out, burst(sr, rng, d, { color: 'pink', bp: [f0 * 3, 1.0], att: d * 0.15, tau: d * 0.4 }), 0, 0.4);
    return chunk(out, 2.4);
  }
  def('mob.enderdragon.growl', { v: 3, vol: 0.9, rate: RATE_LO, range: 96 }, function (sr, rng) { return hall(roar(sr, rng, rng.range(2.0, 2.8), rng.range(150, 190), rng.range(80, 100)), sr, 1.6, 0.3); });
  def('mob.enderdragon.hit', { v: 2, vol: 0.9, rate: RATE_LO, range: 96 }, function (sr, rng) { return roar(sr, rng, rng.range(0.6, 0.8), rng.range(220, 260), rng.range(140, 160)); });
  def('mob.enderdragon.end', { v: 1, vol: 1.0, rate: RATE_LO, range: 256 }, function (sr, rng) {
    var d = 5.5, out = roar(sr, rng, d, 230, 60);
    for (var i = 0; i < out.length; i++) out[i] *= 0.7 + 0.3 * M.sin(TAU * 3.5 * i / sr);
    return hall(out, sr, 2.5, 0.35);
  });
  def('mob.enderdragon.wings', { v: 3, vol: 0.85, rate: RATE_LO, range: 96 }, function (sr, rng) {
    var d = 0.6, out = alloc(sr, d + 0.05), x = burst(sr, rng, d, { color: 'brown', att: 0.08, tau: 0.18 }); bq(x, 'lp', 400, 0.7, sr); mix(out, norm(x, 1), 0, 1);
    mix(out, swish(sr, rng, d, 300, 900, 0.8), 0, 0.4);
    return chunk(out, 1.5);
  });
  def('mob.enderdragon.shoot', { v: 2, vol: 0.9, rate: RATE_LO, range: 96 }, function (sr, rng) { var out = roar(sr, rng, 0.7, 260, 180); mix(out, swish(sr, rng, 0.6, 3000, 600, 1.2), 0, 0.6); return out; });
  def('mob.enderdragon.fireball_explode', { v: 2, vol: 0.8, rate: RATE_LO }, function (sr, rng) {
    var out = alloc(sr, 1.2); mix(out, thud(sr, 0.6, 140, 40, 0.06, 0.15), 0, 0.9);
    mix(out, burst(sr, rng, 1.0, { color: 'pink', sweep: { type: 'bp', f0: 2500, f1: 400, q: 1, dur: 1 }, att: 0.005, tau: 0.3 }), 0, 0.8);
    grains(out, sr, rng, { n: 40, t0: 0, t1: 0.8, dist: 1.5, gl: [0.002, 0.008], f: [1500, 6000], q: 5, decay: 0.3, amp: 0.3 });
    return chunk(out, 1.3);
  });
  // blocks of the update
  def('block.bell.use', { v: 2, vol: 0.85, rate: RATE_LO, range: 48 }, function (sr, rng) {
    var out = alloc(sr, 3.2), f = rng.range(560, 600), m = new Float32Array(out.length);
    // a cast bell: hum, prime, tierce (minor third), quint, nominal
    addModes(m, sr, 0, f, [[0.5, 2.6, 0.6], [1, 2.0, 1], [1.183, 1.6, 0.6], [1.506, 1.2, 0.4], [2, 0.9, 0.5], [2.51, 0.6, 0.3], [3.0, 0.4, 0.2]], 1, rng);
    mix(out, norm(m, 1), 0, 1); mix(out, burst(sr, rng, 0.02, { hp: 1500, att: 0.0003, tau: 0.004 }), 0, 0.35);
    return out;
  });
  def('block.composter.fill', { v: 3, vol: 0.6 }, function (sr, rng) { var out = alloc(sr, 0.3); mix(out, burst(sr, rng, 0.25, { color: 'pink', bp: [rng.range(600, 900), 1], att: 0.01, tau: 0.07 }), 0, 1); grains(out, sr, rng, { n: 15, t0: 0, t1: 0.2, dist: 1.2, gl: [0.001, 0.004], f: [800, 3000], q: 2, decay: 0.1, amp: 0.5 }); return out; });
  def('block.composter.fill_success', { v: 2, vol: 0.7 }, function (sr, rng) { var out = alloc(sr, 0.4); mix(out, burst(sr, rng, 0.3, { color: 'pink', bp: [700, 1], att: 0.01, tau: 0.08 }), 0, 0.8); bubble(out, sr, 0.05, 500, 1.5, 0.04, 0.6); return out; });
  def('block.composter.empty', { v: 2, vol: 0.7 }, function (sr, rng) { var out = alloc(sr, 0.45); mix(out, burst(sr, rng, 0.4, { color: 'brown', lp: 900, att: 0.005, tau: 0.12 }), 0, 1); return chunk(out, 1.2); });
  def('block.composter.ready', { v: 1, vol: 0.7 }, function (sr, rng) { var out = alloc(sr, 0.6); mix(out, burst(sr, rng, 0.4, { color: 'pink', bp: [800, 1], att: 0.01, tau: 0.1 }), 0, 0.7); bubble(out, sr, 0.02, 450, 1.2, 0.05, 0.6); bubble(out, sr, 0.15, 650, 1.2, 0.04, 0.5); return out; });
  def('block.end_portal.spawn', { v: 1, vol: 1.0, rate: RATE_LO, range: 128 }, function (sr, rng) {
    var d = 4, out = alloc(sr, d);
    mix(out, thud(sr, 1.5, 90, 30, 0.2, 0.5), 0, 1); mix(out, burst(sr, rng, d, { color: 'brown', lp: 250, att: 0.01, tau: 1.0 }), 0, 0.7);
    var sh = new Float32Array(out.length); for (var k = 0; k < 24; k++) addModes(sh, sr, rng.range(0.05, 1.5), mtof(rng.int(72, 96)), [[1, rng.range(0.6, 1.5), 1]], rng.range(0.2, 0.6), rng);
    mix(out, norm(sh, 1), 0, 0.5);
    return hall(chunk(out, 1.3), sr, 2.2, 0.35);
  });
  def('block.end_portal_frame.fill', { v: 2, vol: 0.75 }, function (sr, rng) {
    var out = alloc(sr, 1.0); mix(out, burst(sr, rng, 0.03, { hp: 1000, att: 0.0005, tau: 0.008 }), 0, 0.8);
    addModes(out, sr, 0.01, mtof(rng.int(76, 84)), [[1, 0.35, 0.6], [2.01, 0.2, 0.3], [3.0, 0.1, 0.15]], 1, rng);
    return out;
  });
  def('block.end_gateway.spawn', { v: 1, vol: 0.95, rate: RATE_LO, range: 128 }, function (sr, rng) {
    var d = 3, out = alloc(sr, d); mix(out, thud(sr, 1, 120, 40, 0.1, 0.3), 0, 1);
    mix(out, burst(sr, rng, d, { color: 'pink', sweep: { type: 'bp', f0: 3000, f1: 300, q: 1.5, dur: d }, att: 0.005, tau: 0.8 }), 0, 0.7);
    grains(out, sr, rng, { n: 80, t0: 0, t1: 2, dist: 1.3, gl: [0.002, 0.01], f: [2000, 8000], q: 8, decay: 0.8, amp: 0.3 });
    return hall(chunk(out, 1.3), sr, 2, 0.3);
  });
  def('entity.ender_eye.launch', { v: 2, vol: 0.6 }, function (sr, rng) { var out = alloc(sr, 0.5); mix(out, swish(sr, rng, 0.45, 800, 4000, 1.5), 0, 1); grains(out, sr, rng, { n: 12, t0: 0, t1: 0.3, dist: 1, gl: [0.001, 0.004], f: [3000, 8000], q: 6, decay: 0.2, amp: 0.3 }); return out; });
  def('entity.ender_eye.death', { v: 2, vol: 0.7 }, function (sr, rng) {
    var out = alloc(sr, 0.7); mix(out, burst(sr, rng, 0.05, { hp2: [2500, 0.7], att: 0.0003, tau: 0.015 }), 0, 1);
    grains(out, sr, rng, { n: 30, t0: 0, t1: 0.12, dist: 1.4, gl: [0.0005, 0.002], f: [3000, 9000], q: 8, decay: 0.06, amp: 0.6 });
    var tk = new Float32Array(out.length); for (var k = 0; k < 12; k++) addModes(tk, sr, 0.01 + 0.4 * M.pow(rng(), 1.5), rng.range(3000, 7000), [[1, rng.range(0.03, 0.08), 1], [2.3, 0.03, 0.4]], rng.range(0.3, 1), rng);
    mix(out, norm(tk, 1), 0, 0.7); return out;
  });
  def('item.chorus_fruit.teleport', { v: 2, vol: 0.65 }, function (sr, rng) { var out = alloc(sr, 0.55); mix(out, swish(sr, rng, 0.5, rng.range(3500, 4500), rng.range(500, 700), 2.2), 0, 0.9); mix(out, thud(sr, 0.4, 800, 90, 0.1, 0.15), 0, 0.3); return chunk(out, 1.2); });
  def('block.chorus_flower.death', { v: 2, vol: 0.55 }, function (sr, rng) { var out = alloc(sr, 0.35); mix(out, burst(sr, rng, 0.3, { bp: [rng.range(500, 800), 2], att: 0.005, tau: 0.08 }), 0, 1); return out; });

  // =====================================================================================
  // 4. Rendering pipeline (pure): recipe -> sanitised, faded, normalised Float32Array
  // =====================================================================================
  var TARGET_LOUD = 0.2; // loudest 50 ms RMS target (balances noisy vs transient sounds)
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function renderVariant(name, vi) {
    var r = RECIPES[name]; if (!r) return null;
    var sr = r.rate || RATE_HI, rng = makeRng(hashStr(name + '#' + vi)), i;
    var x = r.fn(sr, rng, vi);
    if (!(x instanceof Float32Array)) x = Float32Array.from(x || [0]);
    if (x.length < 2) x = new Float32Array(M.round(sr * 0.01));
    var bad = sanitize(x);
    if (r.loop) {
      var mean = 0; for (i = 0; i < x.length; i++) mean += x[i];
      mean /= x.length; for (i = 0; i < x.length; i++) x[i] -= mean;
    } else {
      dcBlock(x, sr, 15);
      if (!r.noTrim) x = trimTail(x, sr, 0.0015, 0.03);
      fadeIn(x, sr, r.fi || 0.002);
      fadeOut(x, sr, r.fo || 0.005);
    }
    norm(x, PEAK);
    var loud = stRmsMax(x, sr, 0.05);
    return { data: x, sampleRate: sr, gain: loud > TARGET_LOUD ? TARGET_LOUD / loud : 1, bad: bad };
  }
  function jobList() {
    var jobs = [];
    for (var k = 0; k < ORDER.length; k++) for (var i = 0; i < (RECIPES[ORDER[k]].v || 1); i++) jobs.push([ORDER[k], i]);
    return jobs;
  }
  function renderAllSync() {
    var out = {}, jobs = jobList();
    for (var k = 0; k < jobs.length; k++) (out[jobs[k][0]] = out[jobs[k][0]] || []).push(renderVariant(jobs[k][0], jobs[k][1]));
    return out;
  }
  // time-sliced rendering; onItem(name, vi, result|null) is called for each variant; resolves when done
  // (yields between slices via MessageChannel when available - not clamped like nested setTimeout(0))
  function renderAllAsync(sliceMs, onItem) {
    var jobs = jobList(), k = 0, ch = null;
    try { if (typeof MessageChannel === 'function') ch = new MessageChannel(); } catch (e0) { ch = null; }
    return new Promise(function (resolve) {
      function step() {
        var t0 = nowMs();
        while (k < jobs.length) {
          var j = jobs[k++], res = null;
          try { res = renderVariant(j[0], j[1]); } catch (e) { res = null; }
          try { if (onItem) onItem(j[0], j[1], res); } catch (e2) { /* ignore */ }
          if (nowMs() - t0 > sliceMs) break;
        }
        if (k < jobs.length) {
          if (ch) { try { ch.port2.postMessage(0); return; } catch (e3) { ch = null; } }
          setTimeout(step, 0);
        } else {
          if (ch) { try { ch.port1.onmessage = null; ch.port1.close(); ch.port2.close(); } catch (e4) { /* ignore */ } }
          resolve(true);
        }
      }
      if (ch) ch.port1.onmessage = step;
      step();
    });
  }

  // =====================================================================================
  // 5. Music voices (pure): felt piano, soft pad, synthetic reverb impulse response
  // =====================================================================================
  var TIMBRES = { // gain balances the moods (darker, bass-heavier cave voice carries more energy)
    calm: { bright: 1.0, decay: 1.0, partials: 9, hammer: 0.1, lp: 3800, gain: 1.0 },
    cave: { bright: 0.62, decay: 1.35, partials: 6, hammer: 0.06, lp: 1900, gain: 0.6 }
  };
  var NOTE_GAIN = 0.7, PAD_GAIN = 0.35;
  // playback level of a composed note event (shared by the scheduler and the offline preview in tests)
  function noteLevel(e) {
    var T = TIMBRES[e.timbre] || TIMBRES.calm;
    return e.vel * (e.voice === 'pad' ? PAD_GAIN : NOTE_GAIN) * T.gain * (e.midi < 48 ? 0.85 : (e.midi > 76 ? 0.9 : 1));
  }
  function renderPiano(sr, midi, timbre) {
    var T = TIMBRES[timbre] || TIMBRES.calm, f0 = mtof(midi), rng = makeRng(hashStr('piano' + midi + timbre));
    var tau1 = clamp(1.0 * M.pow(2, -(midi - 60) / 24), 0.35, 1.8) * T.decay;
    var dur = clamp(6 * tau1, 1.6, 4.5), n = M.round(dur * sr), x = new Float32Array(n);
    var B = 0.00018, fmax = M.min(1500 + 4000 * T.bright, sr * 0.45);
    for (var p = 1; p <= T.partials; p++) {
      var fp = p * f0 * M.sqrt(1 + B * p * p);
      if (fp > fmax) break;
      var a = M.exp(-0.55 * (p - 1) / T.bright), taup = tau1 / (1 + 0.35 * (p - 1) * T.bright);
      if (p <= 3) { // two slightly detuned strings -> slow beating shimmer
        var dt = 0.0006 * (1 + 0.3 * rng());
        addMode(x, sr, 0, fp * (1 - dt), taup * 0.55, a * 0.38, 0);
        addMode(x, sr, 0, fp * (1 + dt), taup * 0.55, a * 0.38, 0);
        addMode(x, sr, 0, fp, taup * 1.6, a * 0.24, 0); // aftersound (slow second stage)
      } else addMode(x, sr, 0, fp, taup * 0.7, a, 0);
    }
    var ham = burst(sr, rng, 0.03, { lp: M.min(2 * f0 + 500, 3000), att: 0.0008, tau: 0.008 });
    mix(x, ham, 0, T.hammer * peakAbs(x));
    lp1(x, T.lp, sr);
    var na = M.round(0.004 * sr);
    for (var i = 0; i < na; i++) x[i] *= i / na;
    fadeOut(x, sr, M.min(1.0, dur * 0.3));
    dcBlock(x, sr, 20);
    return norm(x, PEAK);
  }
  function renderPad(sr, midi, timbre) {
    var cave = timbre === 'cave', d = 7, n = M.round(d * sr), f = mtof(midi), x = new Float32Array(n);
    var p1 = 0, p2 = 0, p3 = 0, lpf = cave ? 520 : 900;
    for (var i = 0; i < n; i++) {
      var t = i / sr, vib = 1 + 0.002 * M.sin(TAU * 0.21 * t);
      p1 += f * vib / sr; p2 += f * 1.003 / sr; p3 += 2 * f * 0.998 / sr;
      p1 -= M.floor(p1); p2 -= M.floor(p2); p3 -= M.floor(p3);
      var tri = p2 < 0.5 ? 4 * p2 - 1 : 3 - 4 * p2;
      x[i] = M.sin(TAU * p1) + 0.3 * tri + 0.2 * M.sin(TAU * p3);
    }
    lp1(x, lpf, sr); lp1(x, lpf * 1.5, sr);
    envPts(x, sr, [0, 0, 2.2, 1, 4.2, 1, d, 0]);
    return norm(x, PEAK);
  }
  // stereo decaying-noise impulse response: returns [L, R]
  function makeIR(sr, seconds, seed) {
    var n = M.max(2, M.round(seconds * sr)), L = new Float32Array(n), R = new Float32Array(n);
    var rng = makeRng(seed || 1234), pre = M.round(0.012 * sr), yl = 0, yr = 0, a = 0, i, k;
    var ers = [[0.011, 0.5], [0.019, 0.42], [0.027, 0.36], [0.041, 0.3], [0.053, 0.24], [0.067, 0.2]];
    for (k = 0; k < ers.length; k++) {
      var s = M.round(ers[k][0] * sr); if (s >= n) continue;
      if (k % 2) L[s] += ers[k][1]; else R[s] += ers[k][1];
    }
    for (i = pre; i < n; i++) {
      var t = (i - pre) / sr, u = t / seconds;
      if (((i - pre) & 63) === 0) a = 1 - M.exp(-TAU * (7000 * M.pow(1200 / 7000, u)) / sr);
      yl += a * ((rng() * 2 - 1) - yl); yr += a * ((rng() * 2 - 1) - yr);
      var e = M.exp(-6.91 * t / seconds) * M.min(1, t / 0.006) * 0.35;
      L[i] += yl * e; R[i] += yr * e;
    }
    fadeOut(L, sr, 0.05); fadeOut(R, sr, 0.05);
    return [L, R];
  }

  // =====================================================================================
  // 6. Music composer (pure, seeded). createComposer(seed, mood).next() -> phrase {events, start, end} | null
  //    event: {t (s from piece start), midi, vel 0..1, voice 'piano'|'pad', dur, pan, timbre}
  // =====================================================================================
  var SCALES = {
    ionian: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10]
  };
  var PROGS = {
    major: [[0, 3], [0, 4, 5, 3], [0, 3, 0, 4], [5, 3, 0, 4], [0, 5, 3, 4], [3, 0, 3, 4], [0, 2, 3, 3], [3, 4, 0, 0], [0, 4, 3, 3], [0, 5, 3, 0]],
    lydian: [[0, 1], [0, 1, 0, 4], [0, 1, 5, 4], [0, 4, 1, 0], [5, 1, 0, 0], [0, 2, 1, 0]],
    mixolydian: [[0, 6, 3, 0], [0, 6, 0, 3], [0, 3, 6, 0], [0, 4, 6, 3]],
    minor: [[0, 5, 3, 0], [0, 3, 0, 4], [0, 5, 6, 0], [0, 6, 5, 6], [0, 3, 5, 4], [0, 5, 2, 6], [0, 3], [0, 6, 3, 0]],
    phrygian: [[0, 1, 0, 6], [0, 1, 5, 0], [0, 6, 1, 0], [0, 5, 1, 0]]
  };
  var PENTA = { ionian: [0, 1, 2, 4, 5], lydian: [0, 1, 2, 3, 4, 5], mixolydian: [0, 1, 2, 4, 5], aeolian: [0, 2, 3, 4, 6], dorian: [0, 2, 3, 4, 6], phrygian: [0, 1, 3, 4, 5] };
  var MOOD_DEF = {
    calm: { modes: [['ionian', 4], ['lydian', 3], ['aeolian', 2], ['dorian', 1], ['mixolydian', 1]], tonics: [0, 2, 5, 7, 9, 4, 3],
      bassLo: 36, lhLo: 48, melLo: 62, melHi: 81, bpm: [60, 72], textures: [['roll', 4], ['arp', 2], ['sparse', 2], ['melody', 2]],
      bassChance: 0.7, padChance: 0.35, melChance: 0.85, rest: [1, 2], twoBar: 0.5, density: 1.0, timbre: 'calm' },
    cave: { modes: [['aeolian', 3], ['phrygian', 3], ['dorian', 1]], tonics: [0, 2, 4, 5, 7, 9],
      bassLo: 31, lhLo: 43, melLo: 55, melHi: 72, bpm: [50, 60], textures: [['sparse', 4], ['roll', 2], ['melody', 2], ['arp', 1]],
      bassChance: 0.8, padChance: 0.7, melChance: 0.5, rest: [2, 4], twoBar: 0.7, density: 0.6, timbre: 'cave' },
    // the Nether: low, dark, pad-heavy phrygian; the End: sparse, high and airy; the dragon fight: driven and dense
    nether: { modes: [['phrygian', 4], ['aeolian', 2]], tonics: [0, 1, 5, 7],
      bassLo: 28, lhLo: 40, melLo: 50, melHi: 67, bpm: [46, 56], textures: [['sparse', 3], ['roll', 3], ['arp', 1]],
      bassChance: 0.9, padChance: 0.85, melChance: 0.4, rest: [2, 4], twoBar: 0.6, density: 0.55, timbre: 'cave' },
    end: { modes: [['lydian', 3], ['aeolian', 2], ['dorian', 1]], tonics: [0, 2, 7, 9],
      bassLo: 33, lhLo: 50, melLo: 64, melHi: 86, bpm: [44, 54], textures: [['sparse', 5], ['melody', 2], ['arp', 1]],
      bassChance: 0.5, padChance: 0.9, melChance: 0.6, rest: [2, 5], twoBar: 0.6, density: 0.5, timbre: 'calm' },
    boss: { modes: [['phrygian', 3], ['aeolian', 2]], tonics: [0, 1, 3, 7],
      bassLo: 30, lhLo: 43, melLo: 55, melHi: 76, bpm: [76, 92], textures: [['arp', 4], ['roll', 3], ['melody', 2]],
      bassChance: 0.95, padChance: 0.6, melChance: 0.8, rest: [0, 1], twoBar: 0.3, density: 1.3, timbre: 'cave' }
  };
  function weighted(rng, list) {
    var s = 0, i; for (i = 0; i < list.length; i++) s += list[i][1];
    var r = rng() * s; for (i = 0; i < list.length; i++) { r -= list[i][1]; if (r <= 0) return list[i][0]; }
    return list[list.length - 1][0];
  }
  function isDimDeg(scale, d) { d = ((d % 7) + 7) % 7; return (scale[(d + 4) % 7] + (d + 4 >= 7 ? 12 : 0)) - scale[d] === 6; }
  function pickProg(rng, mode) {
    var sc = SCALES[mode], fam = mode === 'lydian' ? 'lydian' : mode === 'mixolydian' ? 'mixolydian' : mode === 'phrygian' ? 'phrygian' : (sc[2] === 3 ? 'minor' : 'major');
    var list = PROGS[fam].concat(fam === 'mixolydian' ? PROGS.major : fam === 'phrygian' ? PROGS.minor : []).filter(function (p) {
      for (var i = 0; i < p.length; i++) if (isDimDeg(sc, p[i])) return false;
      return true;
    });
    return list.length ? rng.pick(list).slice() : [0, 0];
  }
  function degPc(key, deg) { var d = ((deg % 7) + 7) % 7; return (key.pc + key.scale[d]) % 12; }
  function inReg(pc, lo) { return lo + ((pc - lo) % 12 + 12) % 12; }
  function makeMotif(rng) {
    var rhythms = [[0, 1, 2, 3], [0, 0.5, 1, 2], [0, 1, 1.5, 2, 3], [0, 1.5, 2, 3.5], [0, 2, 3], [0, 0.5, 1.5, 2, 2.5], [0, 1, 3], [0, 1, 2]];
    var r = rng.pick(rhythms), steps = [0], s = 0;
    for (var i = 1; i < r.length; i++) { s += rng.pick([-2, -1, -1, 0, 1, 1, 1, 2, -3, 3]); s = clamp(s, -4, 5); steps.push(s); }
    return { rhythm: r, steps: steps, start: rng.pick([0, 0, 0.5, 1]) };
  }
  function varyMotif(rng, m) {
    var v = { rhythm: m.rhythm.slice(), steps: m.steps.slice(), start: m.start, skip: [] };
    var L = v.steps.length;
    if (rng.chance(0.45)) v.steps[L - 1] += rng.pick([-2, -1, 1, 2]);
    if (L > 3 && rng.chance(0.3)) v.skip[1 + M.floor(rng() * (L - 2))] = true;
    if (rng.chance(0.25)) for (var i = 0; i < L; i++) v.steps[i] += 1;
    return v;
  }

  function createComposer(seed, mood) {
    var rng = makeRng((seed >>> 0) || 1);
    // target length; the real piece ends within ~[len-9, len+24] s (outro rings ~9 s)
    var C = { seed: seed >>> 0, t: 0, done: false, phrase: 0, mood: 'calm', key: null, len: rng.range(100, 155), pendingMood: null };
    function setup(m) {
      var MD = MOOD_DEF[m] || MOOD_DEF.calm, prev = C.key;
      C.mood = MOOD_DEF[m] ? m : 'calm'; C.M = MD;
      var mode = weighted(rng, MD.modes), sc = SCALES[mode], pc;
      if (prev && rng.chance(0.7)) pc = (prev.minor === (sc[2] === 3)) ? prev.pc : ((prev.pc + (sc[2] === 3 ? 9 : 3)) % 12);
      else pc = rng.pick(MD.tonics);
      C.key = { pc: pc, mode: mode, scale: sc, minor: sc[2] === 3 };
      C.bpm = rng.range(MD.bpm[0], MD.bpm[1]); C.beat = 60 / C.bpm; C.meter = rng.chance(0.25) ? 3 : 4;
      C.barsPerChord = rng.chance(MD.twoBar) ? 2 : 1;
      C.prog = pickProg(rng, mode);
      C.motif = makeMotif(rng);
      var pool = PENTA[mode], pcs = pool.map(function (d) { return degPc(C.key, d); });
      C.mel = [];
      for (var mm = MD.melLo; mm <= MD.melHi; mm++) if (pcs.indexOf(mm % 12) >= 0) C.mel.push(mm);
    }
    setup(mood);
    C.setMood = function (m) { if (MOOD_DEF[m]) C.pendingMood = (m !== C.mood) ? m : null; };

    function push(ev, t, midi, vel, voice, dur) {
      var th = t + clamp(rng.gauss() * 0.01, -0.025, 0.025);
      ev.push({ t: M.max(0, th), midi: midi, vel: clamp(vel * (1 + 0.08 * rng.gauss()), 0.05, 0.85), voice: voice || 'piano',
        dur: dur || 0, pan: clamp((midi - 60) / 40, -0.45, 0.45), timbre: C.M.timbre });
    }
    function voicing(deg) {
      var key = C.key, lo = C.M.lhLo, r = inReg(degPc(key, deg), lo);
      var third = inReg(degPc(key, deg + 2), r), fifth = inReg(degPc(key, deg + 4), r + 1), ninth = inReg(degPc(key, deg + 1), r + 12);
      var ch = weighted(rng, [['a', 35], ['b', 30], ['c', 20], ['d', 15]]);
      if (ch === 'a') return [r, fifth, ninth, third + 12];
      if (ch === 'b') return [r, fifth, third + 12];
      if (ch === 'c') return [r, fifth, r + 12, ninth];
      return [r, third, fifth, ninth];
    }
    function placeMotif(ev, mot, cs, deg, vel) {
      var tones = [degPc(C.key, deg), degPc(C.key, deg + 2), degPc(C.key, deg + 4)], mel = C.mel;
      if (!mel.length) return;
      // anchor on a chord tone near the previous melody note, chosen so the whole motif fits the range (no clamping)
      var smin = 0, smax = 0, i, hi = mel.length - 1;
      for (i = 0; i < mot.steps.length; i++) { smin = M.min(smin, mot.steps[i]); smax = M.max(smax, mot.steps[i]); }
      var aLo = M.min(hi, -smin), aHi = M.max(aLo, hi - smax), center = (C.M.melLo + C.M.melHi) / 2;
      var target = C.lastMel ? 0.6 * C.lastMel + 0.4 * center : center, best = -1, bd = 1e9;
      for (i = aLo; i <= aHi; i++) if (tones.indexOf(mel[i] % 12) >= 0) {
        var dd = M.abs(mel[i] - target) + rng() * 3; if (dd < bd) { bd = dd; best = i; }
      }
      if (best < 0) best = clamp(M.round((aLo + aHi) / 2), 0, hi);
      for (var k = 0; k < mot.rhythm.length; k++) {
        if (mot.skip && mot.skip[k]) continue;
        if (C.M.density < 1 && k > 0 && !rng.chance(C.M.density + 0.25)) continue;
        var m = mel[clamp(best + mot.steps[k], 0, mel.length - 1)];
        push(ev, cs + (mot.start + mot.rhythm[k]) * C.beat, m, vel * (k === 0 ? 1 : rng.range(0.82, 0.95)), 'piano');
        C.lastMel = m;
      }
    }
    function intro(ev) {
      var t0 = C.t + 0.3, v = voicing(0), sp = rng.range(0.12, 0.2);
      push(ev, t0, inReg(degPc(C.key, 0), C.M.bassLo), 0.42, 'piano');
      for (var i = 0; i < v.length; i++) push(ev, t0 + 0.4 + i * sp, v[i], 0.26, 'piano');
      if (rng.chance(0.5)) placeMotif(ev, C.motif, t0 + 2 * C.beat * C.meter / 2, 0, 0.34);
      C.t += (rng.chance(0.5) ? 2 : 3) * C.meter * C.beat;
    }
    function outro(ev) {
      var t0 = C.t + 0.2, v = voicing(0), sp = rng.range(0.2, 0.3);
      push(ev, t0, inReg(degPc(C.key, 0), C.M.bassLo), 0.4, 'piano');
      for (var i = 0; i < v.length; i++) push(ev, t0 + 0.25 + i * sp, v[i], 0.24, 'piano');
      if (C.mel.length) {
        var tones = [degPc(C.key, 0), degPc(C.key, 4)], target = C.lastMel || C.mel[C.mel.length >> 1], best = C.mel[0], bd = 1e9;
        for (var k = 0; k < C.mel.length; k++) if (tones.indexOf(C.mel[k] % 12) >= 0 && M.abs(C.mel[k] - target) < bd) { bd = M.abs(C.mel[k] - target); best = C.mel[k]; }
        push(ev, t0 + 0.4 + v.length * sp + rng.range(0.3, 0.8), best, 0.3, 'piano');
      }
      C.t = t0 + 9;
      C.done = true;
    }
    function phraseLen() { var bar = C.meter * C.beat; return C.prog.length * C.barsPerChord * bar * 1.03 + (C.M.rest[0] + C.M.rest[1]) * 0.5 * bar; }
    // one phrase over the chord progression (optionally truncated to maxChords, e.g. to land the piece's ending)
    function phrase(ev, maxChords, finalPhrase) {
      var MD = C.M, beat = C.beat, bar = C.meter * beat, tex = weighted(rng, MD.textures), t0 = C.t;
      var chordDur = C.barsPerChord * bar * rng.range(0.97, 1.03), usePad = rng.chance(MD.padChance);
      var melOn = rng.chance(MD.melChance) && (tex !== 'arp' || rng.chance(0.35));
      if (C.phrase % 4 === 3) { C.prog = pickProg(rng, C.key.mode); }
      if (C.phrase % 3 === 2) C.motif = rng.chance(0.5) ? makeMotif(rng) : varyMotif(rng, C.motif);
      var cs = t0, nChords = M.min(C.prog.length, maxChords || 99), segs = [];
      for (var ci = 0; ci < nChords; ci++) {
        var deg = C.prog[ci], last = ci === nChords - 1, cd = chordDur * (last ? 1.12 : 1), v = voicing(deg), i;
        segs.push([cs, cd, v]);
        if (rng.chance(MD.bassChance)) push(ev, cs, inReg(degPc(C.key, deg), MD.bassLo), rng.range(0.38, 0.5), 'piano');
        if (tex === 'roll') {
          var sp = rng.range(0.07, 0.16), st = cs + rng.range(0, 0.12);
          for (i = 0; i < v.length; i++) if (i === 0 || rng.chance(MD.density + 0.2)) push(ev, st + i * sp, v[i], rng.range(0.24, 0.34), 'piano');
        } else if (tex === 'arp') {
          var pat = rng.pick([[0, 1, 2, 1], [0, 1, 2, 3, 2, 1], [0, 2, 1, 2], [0, 1, 3, 2]]), step = C.bpm < 64 ? beat / 2 : beat, k = 0;
          for (var tt = 0; tt < cd - step * 0.5; tt += step, k++) {
            if (MD.density < 1 && k > 0 && !rng.chance(MD.density + 0.2)) continue;
            push(ev, cs + tt, v[pat[k % pat.length] % v.length], (k === 0 ? 0.3 : 0.22) * rng.range(0.9, 1.1), 'piano');
          }
        } else if (tex === 'sparse') {
          push(ev, cs + rng.range(0, 0.2), v[1 + M.floor(rng() * (v.length - 1))], rng.range(0.22, 0.3), 'piano');
          if (rng.chance(0.5)) push(ev, cs + 2 * beat, v[M.floor(rng() * v.length)], rng.range(0.18, 0.26), 'piano');
        } else if (rng.chance(0.5)) push(ev, cs, v[1], 0.22, 'piano');
        if (usePad) {
          push(ev, cs, v[0] + 12 > 64 ? v[0] : v[0] + 12, 0.2, 'pad', cd + 1.5);
          push(ev, cs, v[1], 0.16, 'pad', cd + 1.5);
        }
        if (melOn && (ci % 2 === 0 || nChords <= 2)) placeMotif(ev, ci === 0 ? C.motif : varyMotif(rng, C.motif), cs, deg, rng.range(0.32, 0.42));
        cs += cd;
      }
      fillGaps(ev, segs, cs, MD.density < 1 ? 7 : 5);
      var restBars = finalPhrase ? 1 : rng.int(MD.rest[0], MD.rest[1]) + (rng.chance(0.12) ? 2 : 0);
      C.t = cs + restBars * bar;
    }
    // keep a phrase flowing: holes longer than maxGap (inside the chords, not the rest after) get a soft chord tone
    function fillGaps(ev, segs, end, maxGap) {
      var on = [], i;
      for (i = 0; i < ev.length; i++) if (ev[i].voice === 'piano') on.push(ev[i].t);
      on.push(end - 0.5 * C.beat); on.sort(function (a, b) { return a - b; });
      for (i = 1; i < on.length; i++) {
        var gap = on[i] - on[i - 1];
        if (gap <= maxGap) continue;
        var nIns = M.floor(gap / maxGap);
        for (var j = 1; j <= nIns; j++) {
          var tm = on[i - 1] + gap * j / (nIns + 1), sg = segs[0];
          for (var s = 0; s < segs.length; s++) if (tm >= segs[s][0]) sg = segs[s];
          var v = sg[2];
          push(ev, tm, v[1 + M.floor(rng() * (v.length - 1))], rng.range(0.17, 0.24), 'piano');
        }
      }
    }
    C.next = function () {
      if (C.done) return null;
      if (C.pendingMood) { setup(C.pendingMood); C.pendingMood = null; }
      var ev = [], start = C.t, remaining = C.len - C.t, pl = phraseLen();
      if (C.phrase === 0) intro(ev);
      else if (remaining < 0.35 * pl) outro(ev);
      else if (remaining < pl) phrase(ev, M.max(1, M.ceil(remaining / (C.barsPerChord * C.meter * C.beat))), true);
      else phrase(ev);
      C.phrase++;
      ev.sort(function (a, b) { return a.t - b.t; });
      return { events: ev, start: start, end: C.t, mood: C.mood };
    };
    return C;
  }

  // =====================================================================================
  // 7. Playback layer - the only code that touches Web Audio. Every entry point is guarded.
  // =====================================================================================
  var MAX_VOICES = 24, MAX_PER_NAME = 6, DEFAULT_RANGE = 16, MASTER_SCALE = 0.75;
  var LOOKAHEAD = 1.2, TICK_MS = 200, MUSIC_FADE_IN = 4, MUSIC_FADE_OUT = 6;
  var S = {
    ctx: null, ready: false, initPromise: null, master: null, comp: null, sfx: null, musicBus: null,
    vols: { master: 1, sfx: 1, music: 0.5 }, sounds: {}, voices: [], lastVar: {}, loops: {}, loopId: 0,
    listener: { x: 0, y: 0, z: 0, yaw: 0 }, rng: makeRng(((Date.now() * 1103515245) ^ 0x5bd1e995) >>> 0),
    lastResume: 0, gestureHandler: null, noteBufs: new Map(), irs: {}, renderMs: 0, contexts: 0
  };
  var MUSIC = { mood: 'calm', piece: null, dying: [], timer: null, count: 0 };

  function setP(p, v) { try { p.value = v; } catch (e) { /* ignore */ } }
  function rampTo(p, v, tc) {
    var c = S.ctx; if (!c || !p) return;
    try { var t = c.currentTime; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.setTargetAtTime(v, t, tc); }
    catch (e) { setP(p, v); }
  }
  function isRunning() { return !!S.ctx && S.ctx.state === 'running'; }
  function tryResume(force) {
    var c = S.ctx; if (!c || c.state === 'running' || c.state === 'closed') return;
    var t = nowMs(); if (!force && t - S.lastResume < 250) return;
    S.lastResume = t;
    try {
      var p = c.resume();
      if (p && typeof p.then === 'function') p.then(function () { if (isRunning()) unhookGestures(); }, function () {});
    } catch (e) { /* ignore */ }
  }
  var GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'touchend', 'click'];
  function hookGestures() { // autoplay policy: resume on the next user gesture if still suspended
    if (S.gestureHandler || typeof G.addEventListener !== 'function') return;
    var h = S.gestureHandler = function () {
      tryResume(true);
      if (isRunning()) unhookGestures();
    };
    for (var i = 0; i < GESTURES.length; i++) try { G.addEventListener(GESTURES[i], h, true); } catch (e) { /* ignore */ }
  }
  function unhookGestures() {
    var h = S.gestureHandler; if (!h) return; S.gestureHandler = null;
    for (var i = 0; i < GESTURES.length; i++) try { G.removeEventListener(GESTURES[i], h, true); } catch (e) { /* ignore */ }
  }
  // AudioBuffer from mono Float32Array; falls back to resampling if the rate is unsupported
  function makeBuffer(data, sr) {
    var c = S.ctx, ab;
    try { ab = c.createBuffer(1, data.length, sr); }
    catch (e) {
      var r = c.sampleRate, n = M.max(1, M.round(data.length * r / sr)), out = new Float32Array(n), k = sr / r;
      for (var i = 0; i < n; i++) { var p = i * k, j = M.floor(p), f = p - j; out[i] = (data[j] || 0) * (1 - f) + (data[j + 1] || 0) * f; }
      data = out; ab = c.createBuffer(1, n, r);
    }
    if (typeof ab.copyToChannel === 'function') ab.copyToChannel(data, 0); else ab.getChannelData(0).set(data);
    return ab;
  }
  function buildGraph(c) {
    var comp = c.createDynamicsCompressor();
    setP(comp.threshold, -10); setP(comp.knee, 10); setP(comp.ratio, 3.5); setP(comp.attack, 0.004); setP(comp.release, 0.25);
    var master = c.createGain(), sfx = c.createGain(), mus = c.createGain();
    setP(master.gain, S.vols.master * MASTER_SCALE); setP(sfx.gain, S.vols.sfx); setP(mus.gain, S.vols.music);
    sfx.connect(master); mus.connect(master); master.connect(comp); comp.connect(c.destination);
    S.comp = comp; S.master = master; S.sfx = sfx; S.musicBus = mus;
  }
  function addSound(name, res) {
    var r = RECIPES[name], s = S.sounds[name];
    if (!s) s = S.sounds[name] = { vars: [], vol: r.vol || 1, jitter: r.jitter === undefined ? 0.06 : r.jitter, range: r.range || DEFAULT_RANGE, loop: !!r.loop };
    s.vars.push({ buf: makeBuffer(res.data, res.sampleRate), gain: res.gain });
  }

  function init() {
    if (S.initPromise) return S.initPromise;
    S.initPromise = new Promise(function (resolve) {
      var AC = G.AudioContext || G.webkitAudioContext, c;
      if (typeof AC !== 'function') { resolve(false); return; }
      try { c = new AC({ latencyHint: 'interactive' }); } catch (e) { try { c = new AC(); } catch (e2) { c = null; } }
      if (!c) { resolve(false); return; }
      try { buildGraph(c); } catch (e3) { try { c.close(); } catch (e4) { /* ignore */ } resolve(false); return; }
      S.ctx = c; S.contexts++;
      try {
        c.onstatechange = function () {
          if (c.state === 'running') unhookGestures();
          else if (c.state === 'suspended' || c.state === 'interrupted') hookGestures();
        };
      } catch (e5) { /* ignore */ }
      if (c.state !== 'running') { tryResume(true); hookGestures(); }
      var t0 = nowMs();
      renderAllAsync(24, function (name, vi, res) { if (res) { try { addSound(name, res); } catch (e6) { /* skip variant */ } } })
        .then(function () { S.renderMs = nowMs() - t0; S.ready = true; resolve(true); }, function () { resolve(false); });
    }).then(function (ok) {
      if (!ok) S.initPromise = null; // allow a later retry (e.g. context creation was blocked)
      return ok;
    });
    return S.initPromise;
  }

  // ---------------------------------------------------------------- one-shots
  function disconnectVoice(v) {
    try { v.src.onended = null; } catch (e) { /* ignore */ }
    try { v.src.disconnect(); } catch (e) { /* ignore */ }
    try { v.gain.disconnect(); } catch (e) { /* ignore */ }
    if (v.pan) try { v.pan.disconnect(); } catch (e) { /* ignore */ }
  }
  function killVoice(v, fade) {
    if (v.dead) return; v.dead = true;
    var i = S.voices.indexOf(v); if (i >= 0) S.voices.splice(i, 1);
    if (fade && S.ctx) {
      var t = S.ctx.currentTime;
      try { var p = v.gain.gain; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + 0.015); } catch (e) { /* ignore */ }
      try { v.src.stop(t + 0.02); } catch (e) { /* ignore */ }
      setTimeout(function () { disconnectVoice(v); }, 80);
    } else disconnectVoice(v);
  }
  function pruneVoices(now) {
    for (var i = S.voices.length - 1; i >= 0; i--) if (S.voices[i].end < now - 0.25) killVoice(S.voices[i], false);
  }
  function makeRoom(name, now) {
    var same = 0, oldest = null, i, v;
    for (i = 0; i < S.voices.length; i++) { v = S.voices[i]; if (v.name === name) { same++; if (!oldest || v.start < oldest.start) oldest = v; } }
    if (same >= MAX_PER_NAME && oldest) killVoice(oldest, true);
    while (S.voices.length >= MAX_VOICES) { // steal the quietest / most finished voice
      var worst = null, ws = Infinity;
      for (i = 0; i < S.voices.length; i++) {
        v = S.voices[i];
        var rem = clamp((v.end - now) / M.max(1e-3, v.end - v.start), 0, 1), sc = v.g * (0.25 + rem);
        if (sc < ws) { ws = sc; worst = v; }
      }
      killVoice(worst, true);
    }
  }
  function playInternal(name, opts) {
    var snd = S.sounds[name]; if (!snd || !snd.vars.length) return;
    var c = S.ctx;
    if (c.state !== 'running') { tryResume(false); return; } // never queue sounds on a suspended clock
    opts = opts || {};
    var vol = clamp(num(opts.vol, 1), 0, 4), pitch = clamp(num(opts.pitch, 1), 0.25, 4), pan = clamp(num(opts.pan, 0), -1, 1);
    var nv = snd.vars.length, vi = M.floor(S.rng() * nv) % nv;
    if (nv > 1 && vi === S.lastVar[name]) vi = (vi + 1 + M.floor(S.rng() * (nv - 1))) % nv;
    S.lastVar[name] = vi;
    var v = snd.vars[vi], g = M.min(1.5, vol * snd.vol * v.gain);
    if (!(g >= 0.0005)) return;
    var rate = pitch * (1 + snd.jitter * (S.rng() * 2 - 1)), now = c.currentTime;
    pruneVoices(now); makeRoom(name, now);
    var src = c.createBufferSource(), gn = c.createGain(), pn = null, out = gn;
    src.buffer = v.buf; setP(src.playbackRate, rate); setP(gn.gain, g);
    src.connect(gn);
    if (pan !== 0 && typeof c.createStereoPanner === 'function') { pn = c.createStereoPanner(); setP(pn.pan, pan); gn.connect(pn); out = pn; }
    out.connect(S.sfx);
    var voice = { name: name, src: src, gain: gn, pan: pn, g: g, start: now, end: now + v.buf.duration / rate, dead: false };
    src.onended = function () { killVoice(voice, false); };
    src.start(now);
    S.voices.push(voice);
  }
  function play(name, opts) {
    if (!S.ready) return;
    try { playInternal(name, opts); } catch (e) { /* never throw into the game loop */ }
  }
  function playAt(name, x, y, z, opts) {
    if (!S.ready) return;
    try {
      var snd = S.sounds[name]; if (!snd) return;
      opts = opts || {};
      var L = S.listener, dx = num(x, L.x) - L.x, dy = num(y, L.y) - L.y, dz = num(z, L.z) - L.z;
      var dist = M.sqrt(dx * dx + dy * dy + dz * dz), range = M.max(1, num(opts.range, snd.range));
      var att = 1 - dist / range;
      if (att <= 0) return;
      var hd = M.sqrt(dx * dx + dz * dz), pan = 0;
      if (hd > 1e-4) { // right vector = (cos yaw, 0, -sin yaw) for forward = (-sin yaw, 0, -cos yaw)
        pan = (dx * M.cos(L.yaw) - dz * M.sin(L.yaw)) / hd;
        pan *= M.min(1, hd / 2) * 0.8;
      }
      playInternal(name, { vol: num(opts.vol, 1) * att, pitch: opts.pitch, pan: clamp(num(opts.pan, 0) + pan, -1, 1) });
    } catch (e) { /* ignore */ }
  }
  function setListener(x, y, z, yaw) {
    var L = S.listener;
    L.x = num(x, L.x); L.y = num(y, L.y); L.z = num(z, L.z); L.yaw = num(yaw, L.yaw);
  }
  function setVolume(kind, v) {
    if (!Object.prototype.hasOwnProperty.call(S.vols, kind)) return;
    v = clamp(num(v, S.vols[kind]), 0, 1); S.vols[kind] = v;
    if (!S.ctx) return;
    var node = kind === 'master' ? S.master : (kind === 'sfx' ? S.sfx : S.musicBus);
    if (node) rampTo(node.gain, kind === 'master' ? v * MASTER_SCALE : v, 0.03);
  }
  function getVolume(kind) { return Object.prototype.hasOwnProperty.call(S.vols, kind) ? S.vols[kind] : 0; }

  // ---------------------------------------------------------------- loops
  function startLoop(name, opts) {
    if (!S.ready) return 0;
    try {
      var snd = S.sounds[name]; if (!snd || !snd.vars.length || S.ctx.state === 'closed') return 0;
      opts = opts || {};
      var c = S.ctx, v = snd.vars[M.floor(S.rng() * snd.vars.length) % snd.vars.length];
      var src = c.createBufferSource(), gn = c.createGain(), base = snd.vol * v.gain, vol = clamp(num(opts.vol, 1), 0, 2), t = c.currentTime;
      src.buffer = v.buf; src.loop = true;
      if (opts.pitch !== undefined) setP(src.playbackRate, clamp(num(opts.pitch, 1), 0.25, 4));
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(base * vol, t + 0.6);
      src.connect(gn); gn.connect(S.sfx);
      var du = v.buf.duration, off = S.rng() * du * 0.9;
      if (!snd.loop) { // one-shot used as a loop (e.g. fire.fire): loop its sustained middle, skipping the fades
        var la = M.min(0.12, du * 0.1), lb = du - M.min(0.15, du * 0.15);
        if (lb - la > 0.05) { src.loopStart = la; src.loopEnd = lb; }
        off = 0;
      }
      src.start(t, off);
      var id = ++S.loopId;
      S.loops[id] = { src: src, gain: gn, base: base, vol: vol, name: name };
      if (c.state !== 'running') tryResume(false);
      return id;
    } catch (e) { return 0; }
  }
  function stopLoop(id, fade) {
    var L = S.loops[id]; if (!L) return;
    delete S.loops[id];
    var f = clamp(num(fade, 0.3), 0.01, 10), done = false;
    var cleanup = function () { if (done) return; done = true; try { L.src.onended = null; L.src.disconnect(); } catch (e) { /* ignore */ } try { L.gain.disconnect(); } catch (e) { /* ignore */ } };
    try {
      var t = S.ctx.currentTime, p = L.gain.gain;
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + f);
      L.src.onended = cleanup; L.src.stop(t + f + 0.02);
    } catch (e) { cleanup(); return; }
    setTimeout(cleanup, (f + 0.5) * 1000); // safety net (suspended clock / onended not firing)
  }
  function setLoopVolume(id, v) {
    var L = S.loops[id]; if (!L) return;
    L.vol = clamp(num(v, L.vol), 0, 2);
    rampTo(L.gain.gain, L.base * L.vol, 0.08);
  }

  // ---------------------------------------------------------------- music player (look-ahead scheduler)
  var NOTE_CACHE_MAX = 72; // LRU bound for lazily rendered note buffers (~20 MB worst case)
  function noteBuffer(voice, midi, timbre) {
    var k = voice + ':' + timbre + ':' + midi, cache = S.noteBufs, b = cache.get(k);
    if (b) { cache.delete(k); cache.set(k, b); return b; } // refresh LRU position
    var d = voice === 'pad' ? renderPad(RATE_MUSIC, midi, timbre) : renderPiano(RATE_MUSIC, midi, timbre);
    b = makeBuffer(d, RATE_MUSIC);
    cache.set(k, b);
    while (cache.size > NOTE_CACHE_MAX) cache.delete(cache.keys().next().value); // playing sources keep their own reference
    return b;
  }
  function getIR(mood) {
    if (S.irs[mood]) return S.irs[mood];
    var c = S.ctx, sr = c.sampleRate, ch = makeIR(sr, mood === 'cave' ? 5.5 : 3.5, mood === 'cave' ? 777 : 4242);
    var b = c.createBuffer(2, ch[0].length, sr);
    if (typeof b.copyToChannel === 'function') { b.copyToChannel(ch[0], 0); b.copyToChannel(ch[1], 1); }
    else { b.getChannelData(0).set(ch[0]); b.getChannelData(1).set(ch[1]); }
    return (S.irs[mood] = b);
  }
  function pieceBus(P, mood) { // per piece & mood: input -> dry + convolver send -> piece fade
    if (P.buses[mood]) return P.buses[mood];
    var c = S.ctx, inp = c.createGain(), dry = c.createGain(), B = { inp: inp, dry: dry, send: null, conv: null };
    setP(dry.gain, mood === 'cave' ? 0.55 : 0.75);
    inp.connect(dry); dry.connect(P.fade);
    try {
      var conv = c.createConvolver(), send = c.createGain();
      conv.buffer = getIR(mood);
      setP(send.gain, mood === 'cave' ? 0.75 : 0.55);
      inp.connect(send); send.connect(conv); conv.connect(P.fade);
      B.send = send; B.conv = conv;
    } catch (e) { /* no reverb available: dry only */ }
    return (P.buses[mood] = B);
  }
  function releaseNote(P, n) {
    if (n.dead) return; n.dead = true;
    try { n.src.onended = null; } catch (e) { /* ignore */ }
    try { n.src.disconnect(); } catch (e) { /* ignore */ }
    try { n.g.disconnect(); } catch (e) { /* ignore */ }
    if (n.pn) try { n.pn.disconnect(); } catch (e) { /* ignore */ }
    var i = P.notes.indexOf(n); if (i >= 0) P.notes.splice(i, 1);
  }
  function scheduleNote(P, e) {
    var c = S.ctx, timbre = e.timbre === 'cave' ? 'cave' : 'calm', buf = noteBuffer(e.voice, e.midi, timbre);
    var bus = pieceBus(P, timbre), at = M.max(e.at, c.currentTime), end = at + buf.duration;
    var src = c.createBufferSource(), g = c.createGain(), pn = null, out = g;
    var vel = noteLevel(e);
    src.buffer = buf;
    g.gain.setValueAtTime(vel, at);
    if (e.voice === 'pad' && e.dur > 0 && e.dur < buf.duration) { g.gain.setTargetAtTime(0, at + e.dur, 0.6); end = M.min(end, at + e.dur + 3.5); }
    src.connect(g);
    if (typeof c.createStereoPanner === 'function') { pn = c.createStereoPanner(); setP(pn.pan, e.pan || 0); g.connect(pn); out = pn; }
    out.connect(bus.inp);
    var n = { src: src, g: g, pn: pn, at: at, end: end + 0.05, dead: false };
    src.onended = function () { releaseNote(P, n); };
    src.start(at); src.stop(end + 0.05);
    P.notes.push(n); P.scheduled++;
  }
  function finishPiece(P) {
    var i;
    for (i = P.notes.length - 1; i >= 0; i--) { var n = P.notes[i]; try { n.src.stop(); } catch (e) { /* ignore */ } releaseNote(P, n); }
    for (var m in P.buses) {
      var B = P.buses[m];
      try { B.inp.disconnect(); } catch (e) { /* ignore */ }
      try { B.dry.disconnect(); } catch (e) { /* ignore */ }
      if (B.send) { try { B.send.disconnect(); } catch (e) { /* ignore */ } try { B.conv.disconnect(); } catch (e) { /* ignore */ } }
    }
    P.buses = {};
    try { P.fade.disconnect(); } catch (e) { /* ignore */ }
    P.state = 'done';
  }
  function ensureTimer() {
    if (MUSIC.timer) return;
    MUSIC.timer = setInterval(musicTick, TICK_MS);
  }
  function stopTimerIfIdle() {
    if (!MUSIC.piece && !MUSIC.dying.length && MUSIC.timer) { clearInterval(MUSIC.timer); MUSIC.timer = null; }
  }
  function musicTick() {
    try { tickInner(); } catch (e) { /* a timer callback must never throw */ }
    stopTimerIfIdle();
  }
  function tickInner() {
    var c = S.ctx; if (!c) return;
    var now = c.currentTime, i, P;
    if (c.state === 'closed') { // clock will never advance again: drop everything so the interval can stop
      if (MUSIC.piece) { finishPiece(MUSIC.piece); MUSIC.piece = null; }
      for (i = 0; i < MUSIC.dying.length; i++) finishPiece(MUSIC.dying[i]);
      MUSIC.dying.length = 0;
      return;
    }
    for (i = MUSIC.dying.length - 1; i >= 0; i--) { // stopped pieces: clean up once their fade is over
      P = MUSIC.dying[i];
      for (var k = P.notes.length - 1; k >= 0; k--) if (P.notes[k].end < now - 0.5) releaseNote(P, P.notes[k]);
      if (now >= P.dieAt) { finishPiece(P); MUSIC.dying.splice(i, 1); }
    }
    P = MUSIC.piece; if (!P) return;
    for (i = P.notes.length - 1; i >= 0; i--) if (P.notes[i].end < now - 0.5) releaseNote(P, P.notes[i]);
    var hidden = typeof document !== 'undefined' && !!document.hidden, horizon = now + (hidden ? 3 : LOOKAHEAD);
    if (P.state === 'playing') {
      var added = false;
      while (!P.composer.done && P.start + P.composer.t < horizon + 0.5) {
        var ph = P.composer.next(); if (!ph) break;
        for (i = 0; i < ph.events.length; i++) { var e = ph.events[i]; e.at = P.start + e.t; P.queue.push(e); }
        added = true;
      }
      if (added) P.queue.sort(function (a, b) { return a.at - b.at; });
      while (P.queue.length && P.queue[0].at < horizon) {
        var ev = P.queue.shift();
        if (ev.at < now - 0.08) { P.dropped++; continue; } // clock jumped (throttled tab): drop late notes
        scheduleNote(P, ev);
      }
      // pre-render upcoming note buffers in small slices so scheduling never stalls
      var t0 = nowMs();
      for (i = 0; i < P.queue.length && P.queue[i].at < horizon + 8 && nowMs() - t0 < 6; i++) {
        var q = P.queue[i]; noteBuffer(q.voice, q.midi, q.timbre === 'cave' ? 'cave' : 'calm');
      }
      if (P.composer.done && !P.queue.length) { // natural end: fade out, then clean up
        var endT = P.start + P.composer.t, fs = M.max(now, endT - MUSIC_FADE_OUT);
        try { var gp = P.fade.gain; gp.cancelScheduledValues(fs); gp.setValueAtTime(1, fs); gp.linearRampToValueAtTime(0, fs + MUSIC_FADE_OUT); } catch (e2) { /* ignore */ }
        P.state = 'ending'; P.endAt = fs + MUSIC_FADE_OUT + 0.1;
      }
    }
    if (P.state === 'ending' && now >= P.endAt) { finishPiece(P); MUSIC.piece = null; }
  }
  function musicPlay() {
    if (!S.ready) return;
    try {
      if (MUSIC.piece || S.ctx.state === 'closed') return; // already playing (or fading out by itself)
      var c = S.ctx, t = c.currentTime, seed = (hashStr('piece#' + (++MUSIC.count)) ^ M.floor(S.rng() * 4294967296)) >>> 0;
      var fade = c.createGain();
      fade.gain.setValueAtTime(0, t); fade.gain.linearRampToValueAtTime(1, t + MUSIC_FADE_IN);
      fade.connect(S.musicBus);
      MUSIC.piece = { state: 'playing', composer: createComposer(seed, MUSIC.mood), seed: seed, start: t + 0.15, fade: fade,
        queue: [], notes: [], buses: {}, scheduled: 0, dropped: 0, endAt: Infinity };
      if (c.state !== 'running') tryResume(false);
      ensureTimer();
      setTimeout(musicTick, 0); // first tick (IR + first note renders) in its own task, not inside the caller's frame
    } catch (e) { /* ignore */ }
  }
  function musicStop(fadeSeconds) {
    var P = MUSIC.piece; if (!P || !S.ctx) return;
    try {
      var f = clamp(num(fadeSeconds, 3), 0, 30), t = S.ctx.currentTime, p = P.fade.gain;
      MUSIC.piece = null; P.state = 'dying'; P.dieAt = t + f + 0.1; P.queue.length = 0;
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + M.max(f, 0.02));
      for (var i = P.notes.length - 1; i >= 0; i--) if (P.notes[i].at > t + f) { try { P.notes[i].src.stop(); } catch (e) { /* ignore */ } releaseNote(P, P.notes[i]); }
      MUSIC.dying.push(P);
      ensureTimer();
    } catch (e2) { /* ignore */ }
  }
  function musicIsPlaying() { return !!MUSIC.piece; }
  function musicSetMood(name) {
    if (!Object.prototype.hasOwnProperty.call(MOOD_DEF, name)) return;
    MUSIC.mood = name;
    if (MUSIC.piece) MUSIC.piece.composer.setMood(name);
  }

  // =====================================================================================
  // 8. Public API
  // =====================================================================================
  var api = {
    init: init,
    play: play,
    playAt: playAt,
    setListener: setListener,
    setVolume: setVolume,
    getVolume: getVolume,
    names: ORDER.slice(),
    music: { play: musicPlay, stop: musicStop, isPlaying: musicIsPlaying, setMood: musicSetMood },
    startLoop: startLoop,
    stopLoop: stopLoop,
    setLoopVolume: setLoopVolume
  };
  Object.defineProperty(api, 'ready', { get: function () { return S.ready; }, enumerable: true });
  Object.defineProperty(api, '_internal', { enumerable: false, value: {
    RECIPES: RECIPES, ORDER: ORDER, RATE_HI: RATE_HI, RATE_LO: RATE_LO, RATE_MUSIC: RATE_MUSIC, PEAK: PEAK, TARGET_LOUD: TARGET_LOUD,
    MAX_VOICES: MAX_VOICES, LOOKAHEAD: LOOKAHEAD, TICK_MS: TICK_MS, MUSIC_FADE_IN: MUSIC_FADE_IN, MUSIC_FADE_OUT: MUSIC_FADE_OUT,
    renderVariant: renderVariant, renderAllSync: renderAllSync, renderAllAsync: renderAllAsync,
    renderPiano: renderPiano, renderPad: renderPad, makeIR: makeIR, createComposer: createComposer, MOOD_DEF: MOOD_DEF, SCALES: SCALES, noteLevel: noteLevel,
    dsp: { reverb: reverb, echo: echo, lp1: lp1, hp1: hp1, bq: bq, peakAbs: peakAbs, stRmsMax: stRmsMax, makeRng: makeRng, hashStr: hashStr, mtof: mtof },
    state: function () {
      var P = MUSIC.piece;
      return { ready: S.ready, contexts: S.contexts, voices: S.voices.length, loops: Object.keys(S.loops).length, renderMs: S.renderMs,
        music: P ? P.state : 'idle', pieceNotes: P ? P.notes.length : 0, queued: P ? P.queue.length : 0, dying: MUSIC.dying.length,
        timer: !!MUSIC.timer, noteBufs: S.noteBufs.size, gestureHooked: !!S.gestureHandler };
    },
    piece: function () { return MUSIC.piece; },
    dyingPieces: function () { return MUSIC.dying; }
  } });

  G.MCAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
