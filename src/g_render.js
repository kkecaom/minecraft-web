// ===== g_render.js : WebGL2 renderer core (tile array texture, terrain, sky, clouds) =====
const TILE_SIZE = 16;

function hashName(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function placeholderTile(name) {
  const d = new Uint8ClampedArray(1024), r = mulberry32(hashName(name));
  const base = [60 + (r() * 150) | 0, 60 + (r() * 150) | 0, 60 + (r() * 150) | 0];
  for (let i = 0; i < 256; i++) {
    const v = 0.8 + r() * 0.35, ch = (((i & 15) >> 2) + (i >> 6)) & 1 ? 0.85 : 1;
    d[i * 4] = base[0] * v * ch; d[i * 4 + 1] = base[1] * v * ch; d[i * 4 + 2] = base[2] * v * ch; d[i * 4 + 3] = 255;
  }
  return d;
}
function solidTile(r, g, b, a) { const d = new Uint8ClampedArray(1024); for (let i = 0; i < 256; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a === undefined ? 255 : a; } return d; }
function circleTile(fn) { // fn(dx,dy,dist)-> [r,g,b,a] in -1..1 space
  const d = new Uint8ClampedArray(1024);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const dx = (x - 7.5) / 8, dy = (y - 7.5) / 8, v = fn(dx, dy, Math.hypot(dx, dy)); const o = (y * 16 + x) * 4; d[o] = v[0]; d[o + 1] = v[1]; d[o + 2] = v[2]; d[o + 3] = v[3]; }
  return d;
}
// composite two grayscale-tinted layers into a spawn egg tile
function eggTile(base, overlay, c1, c2) {
  const d = new Uint8ClampedArray(1024);
  const mul = (src, col, o) => ({ r: src ? src[o] * col[0] / 255 : 0, g: src ? src[o + 1] * col[1] / 255 : 0, b: src ? src[o + 2] * col[2] / 255 : 0, a: src ? src[o + 3] : 0 });
  for (let i = 0; i < 256; i++) {
    const o = i * 4;
    let b = mul(base, c1, o), v = mul(overlay, c2, o);
    if (!base) { const x = i & 15, y = i >> 4, dx = (x - 7.5) / 5.5, dy = (y - 8.5) / (y < 8 ? 7 : 5.5); if (dx * dx + dy * dy < 1) b = { r: c1[0], g: c1[1], b: c1[2], a: 255 }; }
    const va = v.a / 255;
    d[o] = b.r * (1 - va) + v.r * va; d[o + 1] = b.g * (1 - va) + v.g * va; d[o + 2] = b.b * (1 - va) + v.b * va; d[o + 3] = Math.max(b.a, v.a);
  }
  return d;
}

class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL 2 is required but not available in this browser.');
    this.gl = gl; this.canvas = canvas;
    this.width = canvas.width; this.height = canvas.height;
    this.proj = m4(); this.view = m4(); this.vp = m4(); this.planes = new Float32Array(24);
    this.fov = 70 * DEG; this.near = 0.05; this.far = 512;
    this.cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.tickPartial = 0;
    this.buildTiles();
    this.buildTextures();
    this.buildPrograms();
    this.buildBuffers();
    this.stats = { sections: 0, verts: 0, draws: 0 };
    this.animClock = 0;
    this.fog = { start: 60, end: 120, color: [0.75, 0.85, 1] };
    this.env = { skyLight: 1, skyTint: [1, 1, 1], gamma: 0, zenith: [0.47, 0.65, 1], horizon: [0.75, 0.85, 1], glow: 0, glowColor: [1, 0.5, 0.2], sunDir: [0, 1, 0], starAlpha: 0, rot: 0, moonPhase: 0, rain: 0, cloudColor: [1, 1, 1] };
    this.cloudCache = { key: '', verts: 0 };
    this._sortBuf = [];
    this.initExtras();
  }

  // ------------------------------------------------------------ tiles & textures
  buildTiles() {
    const names = [], data = {};
    const add = (n, d) => { if (data[n]) return; names.push(n); data[n] = d; };
    if (typeof TexBlocks !== 'undefined') { for (const n of TexBlocks.names) add(n, TexBlocks.tiles[n]); }
    if (typeof TexItems !== 'undefined') { for (const n of TexItems.names) add(n, TexItems.tiles[n]); }
    add('white', solidTile(255, 255, 255));
    // procedural particle sprites
    add('particle_smoke', circleTile((dx, dy, d) => { const a = Math.max(0, 1 - d * d * 1.3); return [200, 200, 200, a * 230]; }));
    add('particle_flame', circleTile((dx, dy, d) => { const a = Math.max(0, 1 - d * d * 1.4); return [255, 160 + 90 * (1 - d), 40 + 40 * (1 - d), a * 255]; }));
    add('particle_bubble', circleTile((dx, dy, d) => { const ring = Math.abs(d - 0.62) < 0.2 ? 1 : 0; return [200, 225, 255, ring * 220]; }));
    add('particle_splash', circleTile((dx, dy, d) => { const a = Math.max(0, 1 - d * d * 1.2); return [190, 215, 255, a * 200]; }));
    add('particle_crit', circleTile((dx, dy, d) => { const a = (Math.abs(dx) < 0.13 || Math.abs(dy) < 0.13) && d < 0.85 ? 1 : (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.12 && d < 0.7 ? 0.8 : 0); return [255, 255, 255, a * 255]; }));
    add('particle_heart', circleTile((dx, dy, d) => { const x = dx * 1.6, y = -dy * 1.6 + 0.2; const v = Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y; return v < 0 ? [235, 30, 40, 255] : [0, 0, 0, 0]; }));
    add('particle_orb', circleTile((dx, dy, d) => { const a = Math.max(0, 1 - d * d * 1.1); return [180 + 60 * (1 - d), 255, 30, a * 255]; }));
    add('particle_explosion', circleTile((dx, dy, d) => { const a = Math.max(0, 1 - d * d); return [255, 240 - 100 * d, 200 - 150 * d, a * 255]; }));
    add('particle_drip', circleTile((dx, dy, d) => { const a = d < 0.6 ? 1 : 0; return [70, 110, 255, a * 220]; }));
    // portal motes (white, tinted purple per particle), villager emotes, dragon breath
    add('particle_portal', circleTile((dx, dy, d) => { const a = d < 0.42 ? 1 : (Math.abs(dx) < 0.18 || Math.abs(dy) < 0.18) && d < 0.8 ? 0.7 : 0; return [255, 255, 255, a * 255]; }));
    add('particle_happy', circleTile((dx, dy, d) => { const s = (Math.abs(dx) < 0.14 && Math.abs(dy) < 0.75) || (Math.abs(dy) < 0.14 && Math.abs(dx) < 0.75) || (d < 0.3); return s ? [90, 255, 90, 255] : [0, 0, 0, 0]; }));
    add('particle_angry', circleTile((dx, dy, d) => { const cloud = Math.hypot(dx + 0.3, dy + 0.15) < 0.38 || Math.hypot(dx - 0.25, dy + 0.2) < 0.42 || Math.hypot(dx, dy + 0.45) < 0.32; const bolt = Math.abs(dx - dy * 0.4) < 0.12 && dy > 0.05 && dy < 0.85; return bolt ? [255, 230, 60, 255] : cloud ? [70, 70, 80, 255] : [0, 0, 0, 0]; }));
    add('particle_breath', circleTile((dx, dy, d) => { const a = Math.max(0, 1 - d * d * 1.2); return [255, 255, 255, a * 200]; }));
    // spawn eggs
    if (typeof ITEMS !== 'undefined') {
      for (const it of ITEMS) if (it && it.spawn) {
        const c1 = hex2rgb(it.eggColors[0]), c2 = hex2rgb(it.eggColors[1]);
        add(it.tile, eggTile(typeof TexItems !== 'undefined' ? TexItems.tiles.spawn_egg : null, typeof TexItems !== 'undefined' ? TexItems.tiles.spawn_egg_overlay : null, c1, c2));
      }
    }
    // everything the registries reference but the asset modules did not provide
    this.missing = [];
    for (const n of SH.usedTileNames()) if (!data[n]) { this.missing.push(n); add(n, placeholderTile(n)); }
    for (const it of ITEMS) if (it && it.tile && !data[it.tile]) { this.missing.push(it.tile); add(it.tile, placeholderTile(it.tile)); }
    if (this.missing.length) console.warn('[renderer] placeholder tiles used for:', this.missing.join(', '));
    this.tileNames = names; this.tileData = data;
    this.TILE = {}; names.forEach((n, i) => this.TILE[n] = i);
    SH.initAll(this.TILE);
    this.animated = [];
    if (typeof TexBlocks !== 'undefined' && TexBlocks.animated) for (const n in TexBlocks.animated) if (this.TILE[n] !== undefined) this.animated.push({ layer: this.TILE[n], frames: TexBlocks.animated[n].frames, ft: TexBlocks.animated[n].frameTime || 2, cur: -1 });
  }
  buildTextures() {
    const gl = this.gl, n = this.tileNames.length, S = TILE_SIZE;
    // mip chain (alpha aware)
    const levels = [];
    let cur = new Uint8ClampedArray(S * S * 4 * n);
    for (let i = 0; i < n; i++) cur.set(this.tileData[this.tileNames[i]], i * S * S * 4);
    levels.push(cur);
    for (let sz = S / 2, lv = 1; sz >= 1; sz /= 2, lv++) {
      const prev = levels[lv - 1], psz = sz * 2, out = new Uint8ClampedArray(sz * sz * 4 * n);
      for (let l = 0; l < n; l++) {
        const po = l * psz * psz * 4, oo = l * sz * sz * 4;
        for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
          let ar = 0, ag = 0, ab = 0, aa = 0, pr = 0, pg = 0, pb = 0;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const o = po + ((y * 2 + dy) * psz + x * 2 + dx) * 4, a = prev[o + 3];
            pr += prev[o]; pg += prev[o + 1]; pb += prev[o + 2];
            ar += prev[o] * a; ag += prev[o + 1] * a; ab += prev[o + 2] * a; aa += a;
          }
          const q = oo + (y * sz + x) * 4;
          if (aa > 0) { out[q] = ar / aa; out[q + 1] = ag / aa; out[q + 2] = ab / aa; } else { out[q] = pr / 4; out[q + 1] = pg / 4; out[q + 2] = pb / 4; }
          out[q + 3] = aa / 4;
        }
      }
      levels.push(out);
    }
    const tex = gl.createTexture(); this.texArray = tex;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels.length, gl.RGBA8, S, S, n);
    for (let lv = 0; lv < levels.length; lv++) {
      const sz = Math.max(1, S >> lv);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, lv, 0, 0, 0, sz, sz, n, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(levels[lv].buffer));
    }
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // 2D atlas canvas of all tiles for GUI drawing (32 columns)
    const cols = 32, rows = Math.ceil(n / cols);
    const cv = document.createElement('canvas'); cv.width = cols * S; cv.height = rows * S;
    const cg = cv.getContext('2d'), id = cg.createImageData(cv.width, cv.height);
    for (let i = 0; i < n; i++) {
      const d = this.tileData[this.tileNames[i]], bx = (i % cols) * S, by = ((i / cols) | 0) * S;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const o = (y * S + x) * 4, q = ((by + y) * cv.width + bx + x) * 4; id.data[q] = d[o]; id.data[q + 1] = d[o + 1]; id.data[q + 2] = d[o + 2]; id.data[q + 3] = d[o + 3]; }
    }
    cg.putImageData(id, 0, 0);
    this.atlasCanvas = cv; this.atlasCols = cols;
    // skin atlas (entities), sun and moon
    this.buildSkinAtlas();
  }
  tileRect(name) { const i = this.TILE[name]; if (i === undefined) return null; return { x: (i % this.atlasCols) * TILE_SIZE, y: ((i / this.atlasCols) | 0) * TILE_SIZE }; }
  buildSkinAtlas() {
    const gl = this.gl;
    // shelf-pack every skin the asset modules provide into one atlas (1024 wide, height rounded up to a power of two)
    const skins = (typeof TexEntities !== 'undefined' && TexEntities.skins) || {};
    const list = Object.keys(skins).map(n => ({ n, s: skins[n] })).sort((a, b) => b.s.h - a.s.h || b.s.w - a.s.w || (a.n < b.n ? -1 : 1));
    const AW = 1024; let px = 0, py = 0, rowH = 0;
    for (const e of list) { if (px + e.s.w > AW) { px = 0; py += rowH; rowH = 0; } e.x = px; e.y = py; px += e.s.w; rowH = Math.max(rowH, e.s.h); }
    const AH = Math.max(64, 1 << Math.ceil(Math.log2(Math.max(1, py + rowH + 64))));
    const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
    const g = cv.getContext('2d');
    this.skinRect = {};
    for (const e of list) { g.putImageData(new ImageData(new Uint8ClampedArray(e.s.data), e.s.w, e.s.h), e.x, e.y); this.skinRect[e.n] = { x: e.x, y: e.y, w: e.s.w, h: e.s.h }; }
    // a flat placeholder in the spare bottom strip for any skin a model names but no module painted
    const ph = { x: 0, y: AH - 64, w: 64, h: 64 }; g.fillStyle = '#8a6a8a'; g.fillRect(ph.x, ph.y, 64, 64);
    if (typeof MODELS !== 'undefined') for (const k in MODELS) for (const sk of [MODELS[k].skin, MODELS[k].fur, MODELS[k].eyes, MODELS[k].collar, MODELS[k].overlay]) if (sk && !this.skinRect[sk]) this.skinRect[sk] = ph;
    if (!this.skinRect.steve) this.skinRect.steve = ph;
    if (typeof SKIN_ATLAS !== 'undefined') { SKIN_ATLAS.w = AW; SKIN_ATLAS.h = AH; }
    this.skinCanvas = cv;
    const tex = gl.createTexture(); this.skinTex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // sun & moon
    const env = (typeof TexEntities !== 'undefined' && TexEntities.env) || {};
    const mk = (e, fallback) => {
      const c = document.createElement('canvas'); c.width = e ? e.w : 32; c.height = e ? e.h : 32; const cg = c.getContext('2d');
      if (e) cg.putImageData(new ImageData(new Uint8ClampedArray(e.data), e.w, e.h), 0, 0); else fallback(cg, c.width, c.height);
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { tex: t, w: c.width, h: c.height };
    };
    this.sunTex = mk(env.sun, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff8c0'; g.fillRect(4, 4, w - 8, h - 8); g.fillStyle = '#ffffe8'; g.fillRect(8, 8, w - 16, h - 16); });
    this.moonTex = mk(env.moon, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); for (let i = 0; i < 8; i++) { const x = (i % 4) * 32, y = (i >> 2) * 32; g.fillStyle = '#c8ccd8'; g.fillRect(x + 4, y + 4, 24, 24); } });
    if (!env.moon) this.moonTex.w = 128, this.moonTex.h = 64;
  }
  updateAnimated(tick) {
    const gl = this.gl;
    for (const a of this.animated) {
      const f = Math.floor(tick / a.ft) % a.frames.length;
      if (f === a.cur) continue; a.cur = f;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, a.layer, TILE_SIZE, TILE_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(a.frames[f].buffer, a.frames[f].byteOffset, 1024));
    }
  }

  // ------------------------------------------------------------ shaders
  compile(vs, fs, name) {
    const gl = this.gl;
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader ' + name + ': ' + gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n')); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link ' + name + ': ' + gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const inf = gl.getActiveUniform(p, i); u[inf.name.replace('[0]', '')] = gl.getUniformLocation(p, inf.name); }
    return { p, u };
  }
  buildPrograms() {
    const LM = `
uniform vec3 u_skyTint; uniform float u_skyFactor; uniform float u_gamma; uniform float u_ambient; uniform float u_force; uniform float u_blkMul;
vec3 lightmap(float sky, float blk) {
  float bb = blk / (4.0 - 3.0 * blk);
  bb = mix(bb, 1.0, u_ambient) * u_blkMul;            // dimension ambient light (the Nether: 0.1), LightTexture's 1.5 block factor there
  vec3 bc = vec3(bb, bb * ((bb * 0.6 + 0.4) * 0.6 + 0.4), bb * (bb * bb * 0.6 + 0.4));
  float sb = sky / (4.0 - 3.0 * sky);
  sb = mix(sb, 1.0, u_ambient);
  vec3 c = bc + u_skyTint * (sb * u_skyFactor);
  c = mix(c, vec3(0.99, 1.12, 1.0), u_force);         // forceBrightLightmap (the End)
  c = mix(c, vec3(0.75), 0.04);
  c = clamp(c, 0.0, 1.0);
  vec3 nx = 1.0 - c; nx *= nx; nx *= nx;
  c = mix(c, 1.0 - nx, u_gamma);
  return c;
}`;
    // ---- terrain (packed static vertices)
    const tvs = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv; layout(location=2) in float a_tile; layout(location=3) in vec4 a_col; layout(location=4) in vec2 a_light;
uniform mat4 u_view; uniform mat4 u_proj; uniform vec3 u_off;
out vec2 v_uv; flat out float v_tile; out vec3 v_col; out vec2 v_light; out float v_dist;
invariant gl_Position;
void main() {
  vec4 p = u_view * vec4(a_pos * (1.0 / 256.0) + u_off, 1.0);
  gl_Position = u_proj * p;
  v_dist = length(p.xyz);
  v_uv = a_uv * (1.0 / 16.0); v_tile = a_tile; v_col = a_col.rgb; v_light = a_light;
}`;
    const tfs = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray u_tex; uniform vec3 u_fogColor; uniform vec2 u_fog; uniform float u_alphaTest;
uniform float u_endTile, u_gateTile, u_time; uniform vec2 u_res;
${LM}
in vec2 v_uv; flat in float v_tile; in vec3 v_col; in vec2 v_light; in float v_dist;
out vec4 o;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// the End portal: parallax star layers fixed to the screen, drifting slowly (like vanilla's end_portal shader)
vec3 endStars(vec2 fc) {
  vec2 uv = fc / u_res.y;
  vec3 col = vec3(0.035, 0.07, 0.085);
  for (int i = 0; i < 14; i++) {
    float fi = float(i), sc = 5.0 + fi * 3.0, a = fi * 1.93 + 0.4;
    mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 p = rot * uv * sc + vec2(u_time * 0.004 * (fi + 2.0), u_time * 0.0025 * (15.0 - fi));
    vec2 cell = floor(p), f = fract(p) - 0.5;
    float h = hash12(cell + fi * 17.3);
    if (h > 0.86) {
      vec2 off = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5;
      float d = length(f - off * 0.5), s = smoothstep(0.2, 0.0, d);
      vec3 lc = mix(vec3(0.10, 0.55, 0.45), vec3(0.45, 0.25, 0.75), fi / 13.0);
      col += lc * s * (0.55 + 0.45 * h);
    }
  }
  return col;
}
void main() {
  if (abs(v_tile - u_endTile) < 0.5 || abs(v_tile - u_gateTile) < 0.5) { o = vec4(endStars(gl_FragCoord.xy), 1.0); return; }
  vec4 t = texture(u_tex, vec3(v_uv, v_tile));
  if (t.a < u_alphaTest) discard;
  vec3 c = t.rgb * v_col * lightmap(v_light.x, v_light.y);
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  o = vec4(mix(c, u_fogColor, f), t.a);
}`;
    this.progTerrain = this.compile(tvs, tfs, 'terrain');
    // ---- dynamic geometry (float vertices) for entities, particles, held items ; SKIN variant samples a 2D atlas
    const dvs = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv; layout(location=2) in float a_tile; layout(location=3) in vec4 a_col; layout(location=4) in vec2 a_light;
uniform mat4 u_mv; uniform mat4 u_proj; uniform vec2 u_lightMul;
out vec2 v_uv; flat out float v_tile; out vec4 v_col; out vec2 v_light; out float v_dist;
void main() {
  vec4 p = u_mv * vec4(a_pos, 1.0);
  gl_Position = u_proj * p; v_dist = length(p.xyz);
  v_uv = a_uv; v_tile = a_tile; v_col = a_col; v_light = a_light * u_lightMul;
}`;
    const dfsTile = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray u_tex; uniform vec3 u_fogColor; uniform vec2 u_fog; uniform float u_alphaTest;
${LM}
in vec2 v_uv; flat in float v_tile; in vec4 v_col; in vec2 v_light; in float v_dist;
out vec4 o;
void main() {
  vec4 t = texture(u_tex, vec3(v_uv, v_tile)) * vec4(1.0, 1.0, 1.0, v_col.a);
  if (t.a < u_alphaTest) discard;
  vec3 c = t.rgb * v_col.rgb * lightmap(v_light.x, v_light.y);
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  o = vec4(mix(c, u_fogColor, f), t.a);
}`;
    const dfsSkin = `#version 300 es
precision highp float;
uniform sampler2D u_skin; uniform vec3 u_fogColor; uniform vec2 u_fog; uniform float u_alphaTest;
${LM}
in vec2 v_uv; flat in float v_tile; in vec4 v_col; in vec2 v_light; in float v_dist;
out vec4 o;
void main() {
  vec4 t = texture(u_skin, v_uv);
  if (t.a < u_alphaTest) discard;
  vec3 c = t.rgb * v_col.rgb * lightmap(v_light.x, v_light.y);
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  o = vec4(mix(c, u_fogColor, f), t.a * v_col.a);
}`;
    this.progDyn = this.compile(dvs, dfsTile, 'dyn');
    this.progSkin = this.compile(dvs, dfsSkin, 'skin');
    // ---- unlit dynamic geometry (sun, moon quads etc.) using 2D texture, additive
    const cvs = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv;
uniform mat4 u_view; uniform mat4 u_proj;
out vec2 v_uv;
void main() { gl_Position = u_proj * (u_view * vec4(a_pos, 1.0)); v_uv = a_uv; }`;
    const cfs = `#version 300 es
precision highp float; uniform sampler2D u_tex; uniform vec4 u_color; in vec2 v_uv; out vec4 o;
void main() { vec4 t = texture(u_tex, v_uv); o = vec4(t.rgb * u_color.rgb * u_color.a, 1.0); }`;
    this.progCel = this.compile(cvs, cfs, 'celestial');
    // ---- sky (fullscreen)
    const svs = `#version 300 es
precision highp float; out vec2 v_ndc;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v_ndc = p * 2.0 - 1.0; gl_Position = vec4(v_ndc, 1.0, 1.0); }`;
    const sfs = `#version 300 es
precision highp float;
in vec2 v_ndc; out vec4 o;
uniform vec3 u_right, u_up, u_fwd; uniform vec2 u_tan;
uniform vec3 u_zenith, u_horizon, u_glowColor, u_sunDir; uniform float u_glow, u_stars, u_rot;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(u_fwd + v_ndc.x * u_tan.x * u_right + v_ndc.y * u_tan.y * u_up);
  float h = d.y;
  float t = clamp(h, 0.0, 1.0);
  vec3 col = mix(u_horizon, u_zenith, pow(t, 0.6));
  if (h < 0.0) col = mix(u_horizon, u_horizon * 0.85, clamp(-h * 3.0, 0.0, 1.0));
  // sunrise / sunset glow around the sun's horizon
  vec2 sh = normalize(u_sunDir.xz + vec2(1e-5)), dh = normalize(d.xz + vec2(1e-5));
  float az = max(dot(sh, dh), 0.0);
  float g = u_glow * pow(az, 3.0) * exp(-abs(h) * 4.5);
  col = mix(col, u_glowColor, clamp(g, 0.0, 1.0));
  // stars
  if (u_stars > 0.01 && h > -0.05) {
    float c = cos(u_rot), s = sin(u_rot);
    vec3 r = vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
    vec3 p = r * 110.0; vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
    float rr = hash(ip);
    if (rr > 0.965) { float dd = length(fp); float br = smoothstep(0.34, 0.0, dd) * (0.55 + 0.45 * hash(ip + 7.0)); col += vec3(br) * u_stars; }
  }
  o = vec4(col, 1.0);
}`;
    this.progSky = this.compile(svs, sfs, 'sky');
    // the End sky: the end_sky tile repeated over the six faces of a cube around the camera, dimmed to 40/255 like vanilla
    const efs = `#version 300 es
precision highp float;
in vec2 v_ndc; out vec4 o;
uniform vec3 u_right, u_up, u_fwd; uniform vec2 u_tan; uniform sampler2D u_tex;
void main() {
  vec3 d = normalize(u_fwd + v_ndc.x * u_tan.x * u_right + v_ndc.y * u_tan.y * u_up), a = abs(d);
  vec2 uv;
  if (a.x >= a.y && a.x >= a.z) uv = d.zy / a.x; else if (a.y >= a.z) uv = d.xz / a.y; else uv = d.xy / a.z;
  vec3 c = texture(u_tex, uv * 8.0).rgb * (40.0 / 255.0) * 1.6;
  o = vec4(c, 1.0);
}`;
    this.progEndSky = this.compile(svs, efs, 'endsky');
    // ---- clouds
    const clvs = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos; layout(location=1) in float a_shade;
uniform mat4 u_view; uniform mat4 u_proj; uniform vec3 u_off; out float v_shade; out float v_dist;
void main() { vec4 p = u_view * vec4(a_pos + u_off, 1.0); gl_Position = u_proj * p; v_shade = a_shade; v_dist = length(p.xz * 1.0 + vec2(0.0, 0.0)); }`;
    const clfs = `#version 300 es
precision highp float; uniform vec3 u_color; uniform vec3 u_fogColor; uniform vec2 u_fog; uniform float u_alpha;
in float v_shade; in float v_dist; out vec4 o;
void main() { float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0); o = vec4(mix(u_color * v_shade, u_fogColor, f * 0.8), u_alpha * (1.0 - f)); }`;
    this.progCloud = this.compile(clvs, clfs, 'cloud');
    // ---- flat NDC colour (lines, overlays)
    const fvs = `#version 300 es
precision highp float; layout(location=0) in vec2 a_pos; layout(location=1) in vec4 a_col; out vec4 v_col; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); v_col = a_col; }`;
    const ffs = `#version 300 es
precision highp float; in vec4 v_col; out vec4 o; void main() { o = v_col; }`;
    this.progFlat = this.compile(fvs, ffs, 'flat');
  }

  buildBuffers() {
    const gl = this.gl;
    // shared quad index buffer (uint32)
    const maxQuads = 32768, idx = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) { const b = q * 4, o = q * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.vaoEmpty = gl.createVertexArray();
    this.cloudVAO = gl.createVertexArray(); this.cloudVBO = gl.createBuffer();
  }

  // ------------------------------------------------------------ chunk meshes
  uploadMesh(old, buf, verts) {
    const gl = this.gl;
    if (!buf || !verts) { if (old) { gl.deleteBuffer(old.vbo); gl.deleteVertexArray(old.vao); } return null; }
    let g = old;
    if (!g) {
      g = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), count: 0 };
      gl.bindVertexArray(g.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo);
      gl.vertexAttribPointer(0, 3, gl.SHORT, false, 16, 0); gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(1, 2, gl.UNSIGNED_BYTE, false, 16, 6); gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(2, 1, gl.UNSIGNED_SHORT, false, 16, 8); gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 16, 10); gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(4, 2, gl.UNSIGNED_BYTE, true, 16, 14); gl.enableVertexAttribArray(4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    } else { gl.bindVertexArray(g.vao); gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo); }
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
    g.count = (verts >> 2) * 6;
    return g;
  }
  setSectionMesh(c, sy, solid, solidVerts, trans, transVerts) {
    let m = c.meshes[sy];
    if (!solid && !trans) { if (m) { this.uploadMesh(m.solid, null, 0); this.uploadMesh(m.trans, null, 0); c.meshes[sy] = null; } return; }
    if (!m) m = c.meshes[sy] = { solid: null, trans: null };
    m.solid = this.uploadMesh(m.solid, solid, solidVerts);
    m.trans = this.uploadMesh(m.trans, trans, transVerts);
  }
  freeChunk(c) { for (let sy = 0; sy < 16; sy++) { const m = c.meshes[sy]; if (m) { this.uploadMesh(m.solid, null, 0); this.uploadMesh(m.trans, null, 0); c.meshes[sy] = null; } } }

  // ------------------------------------------------------------ camera
  resize(w, h) {
    this.width = w; this.height = h; this.canvas.width = w; this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }
  setCamera(x, y, z, yaw, pitch, fov, far) {
    const c = this.cam; c.x = x; c.y = y; c.z = z; c.yaw = yaw; c.pitch = pitch;
    this.fov = fov; this.far = far;
    m4Perspective(this.proj, fov, this.width / this.height, this.near, far);
    m4View(this.view, yaw, pitch);
    m4Mul(this.vp, this.proj, this.view);
    frustumPlanes(this.vp, this.planes);
  }

  // ------------------------------------------------------------ terrain draw
  setCommonUniforms(prog, alphaTest) {
    const gl = this.gl, u = prog.u, e = this.env, f = this.fog;
    if (u.u_fogColor) gl.uniform3fv(u.u_fogColor, f.color);
    if (u.u_fog) gl.uniform2f(u.u_fog, f.start, f.end);
    if (u.u_skyTint) gl.uniform3fv(u.u_skyTint, e.skyTint);
    if (u.u_skyFactor) gl.uniform1f(u.u_skyFactor, e.skyLight);
    if (u.u_gamma) gl.uniform1f(u.u_gamma, e.gamma);
    if (u.u_alphaTest) gl.uniform1f(u.u_alphaTest, alphaTest);
    if (u.u_ambient) gl.uniform1f(u.u_ambient, e.ambient || 0);
    if (u.u_force) gl.uniform1f(u.u_force, e.force || 0);
    if (u.u_blkMul) gl.uniform1f(u.u_blkMul, e.blkMul || 1);
    if (u.u_endTile) { gl.uniform1f(u.u_endTile, this.TILE.end_portal === undefined ? -9 : this.TILE.end_portal); gl.uniform1f(u.u_gateTile, this.TILE.end_gateway === undefined ? -9 : this.TILE.end_gateway); gl.uniform1f(u.u_time, this.animClock || 0); gl.uniform2f(u.u_res, this.width, this.height); }
  }
  drawTerrain(world, pass) {
    const gl = this.gl, cam = this.cam, R = world.viewDist;
    const list = this._sortBuf; list.length = 0;
    const p = this.planes;
    for (const c of world.chunks.values()) {
      if (c.state < 2) continue;
      const x0 = c.cx * 16 - cam.x, z0 = c.cz * 16 - cam.z;
      // cheap chunk-level frustum test first
      if (!aabbVisible(p, x0, -cam.y, z0, x0 + 16, 256 - cam.y, z0 + 16)) continue;
      for (let sy = 0; sy < 16; sy++) {
        const m = c.meshes[sy]; if (!m) continue;
        const g = pass === 0 ? m.solid : m.trans; if (!g) continue;
        const y0 = sy * 16 - cam.y;
        if (!aabbVisible(p, x0, y0, z0, x0 + 16, y0 + 16, z0 + 16)) continue;
        const dx = x0 + 8, dy = y0 + 8, dz = z0 + 8;
        list.push({ g, x: x0, y: y0, z: z0, d: dx * dx + dy * dy + dz * dz });
      }
    }
    if (pass === 0) list.sort((a, b) => a.d - b.d); else list.sort((a, b) => b.d - a.d);
    const pr = this.progTerrain;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.u_view, false, this.view); gl.uniformMatrix4fv(pr.u.u_proj, false, this.proj);
    this.setCommonUniforms(pr, pass === 0 ? 0.5 : 0.01);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray); gl.uniform1i(pr.u.u_tex, 0);
    let verts = 0;
    for (const s of list) {
      gl.uniform3f(pr.u.u_off, s.x, s.y, s.z);
      gl.bindVertexArray(s.g.vao);
      gl.drawElements(gl.TRIANGLES, s.g.count, gl.UNSIGNED_INT, 0);
      verts += s.g.count;
    }
    this.stats.sections += list.length; this.stats.verts += verts / 6 * 4; this.stats.draws += list.length;
  }

  // ------------------------------------------------------------ sky
  drawSky() {
    const gl = this.gl, e = this.env, c = this.cam;
    if (e.dim === 'nether') return;                 // no sky in the Nether: the frame was cleared to the fog colour
    if (e.dim === 'end') {
      if (!this.endSkyTex) {
        const sk = typeof TexEntities !== 'undefined' && TexEntities.env && TexEntities.env.end_sky, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        if (sk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sk.w, sk.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(sk.data.buffer, sk.data.byteOffset, sk.data.length));
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([60, 50, 70, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        this.endSkyTex = t;
      }
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
      const pe = this.progEndSky; gl.useProgram(pe.p);
      const cp = Math.cos(c.pitch), fx = -Math.sin(c.yaw) * cp, fy = -Math.sin(c.pitch), fz = Math.cos(c.yaw) * cp;
      let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      gl.uniform3f(pe.u.u_right, rx, 0, rz); gl.uniform3f(pe.u.u_up, -rz * fy, rz * fx - rx * fz, rx * fy); gl.uniform3f(pe.u.u_fwd, fx, fy, fz);
      const ty = Math.tan(this.fov / 2); gl.uniform2f(pe.u.u_tan, ty * this.width / this.height, ty);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.endSkyTex); gl.uniform1i(pe.u.u_tex, 1); gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(this.vaoEmpty); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
      return;
    }
    const pr = this.progSky;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
    gl.useProgram(pr.p);
    const cp = Math.cos(c.pitch), fx = -Math.sin(c.yaw) * cp, fy = -Math.sin(c.pitch), fz = Math.cos(c.yaw) * cp;
    let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    gl.uniform3f(pr.u.u_right, rx, 0, rz); gl.uniform3f(pr.u.u_up, ux, uy, uz); gl.uniform3f(pr.u.u_fwd, fx, fy, fz);
    const ty = Math.tan(this.fov / 2); gl.uniform2f(pr.u.u_tan, ty * this.width / this.height, ty);
    gl.uniform3fv(pr.u.u_zenith, e.zenith); gl.uniform3fv(pr.u.u_horizon, this.fog.skyHorizon || e.horizon); gl.uniform3fv(pr.u.u_glowColor, e.glowColor); gl.uniform3fv(pr.u.u_sunDir, e.sunDir);
    gl.uniform1f(pr.u.u_glow, e.glow); gl.uniform1f(pr.u.u_stars, e.starAlpha); gl.uniform1f(pr.u.u_rot, e.rot);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // sun and moon (additive)
    const cel = this.progCel;
    gl.useProgram(cel.p);
    gl.uniformMatrix4fv(cel.u.u_view, false, this.view); gl.uniformMatrix4fv(cel.u.u_proj, false, this.proj);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const sd = e.sunDir, rain = 1 - e.rain * 0.7;
    this.drawCelestial(sd[0], sd[1], sd[2], 30, this.sunTex, [0, 0, 1, 1], [1, 1, 1, rain]);
    const ph = e.moonPhase | 0, mu = (ph % 4) / 4, mv = (ph >> 2) / 2;
    this.drawCelestial(-sd[0], -sd[1], -sd[2], 20, this.moonTex, [mu, mv, mu + 0.25, mv + 0.5], [1, 1, 1, rain]);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
  drawCelestial(dx, dy, dz, size, tex, uv, color) {
    const gl = this.gl, cel = this.progCel, D = 100;
    // basis in the plane of the sun's path (x-y plane): tangent = (dy,-dx,0) , binormal = z
    let tx = dy, ty = -dx; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const cx = dx * D, cy = dy * D, cz = dz * D, s = size;
    const v = new Float32Array([
      cx - tx * s, cy - ty * s, cz - s, uv[0], uv[3],
      cx + tx * s, cy + ty * s, cz - s, uv[2], uv[3],
      cx + tx * s, cy + ty * s, cz + s, uv[2], uv[1],
      cx - tx * s, cy - ty * s, cz + s, uv[0], uv[1],
    ]);
    if (!this._celVAO) {
      this._celVAO = gl.createVertexArray(); this._celVBO = gl.createBuffer();
      gl.bindVertexArray(this._celVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this._celVBO);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12); gl.enableVertexAttribArray(1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    }
    gl.bindVertexArray(this._celVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this._celVBO);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.tex); gl.uniform1i(cel.u.u_tex, 1);
    gl.uniform4fv(cel.u.u_color, color);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  // ------------------------------------------------------------ clouds (3D "fancy" cells, 12x12x4)
  cloudCell(i, j) {
    if (!this._cloudN) this._cloudN = new SH.Perlin(4242);
    const n = SH.fbm2(this._cloudN, i * 0.11 + 100, j * 0.11 + 50, 3) + 0.15 * SH.fbm2(this._cloudN, i * 0.35, j * 0.35, 2);
    return n > 0.13;
  }
  buildClouds(ix0, iz0, R, y0, h) {
    const verts = [];
    const S = 12;
    const q = (x0, y0_, z0, x1, y1, z1, shade, f) => {
      // f: 0 bottom 1 top 2 north 3 south 4 west 5 east ; local positions
      let p;
      if (f === 1) p = [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]];
      else if (f === 0) p = [[x0, y0_, z1], [x0, y0_, z0], [x1, y0_, z0], [x1, y0_, z1]];
      else if (f === 2) p = [[x1, y1, z0], [x1, y0_, z0], [x0, y0_, z0], [x0, y1, z0]];
      else if (f === 3) p = [[x0, y1, z1], [x0, y0_, z1], [x1, y0_, z1], [x1, y1, z1]];
      else if (f === 4) p = [[x0, y1, z0], [x0, y0_, z0], [x0, y0_, z1], [x0, y1, z1]];
      else p = [[x1, y1, z1], [x1, y0_, z1], [x1, y0_, z0], [x1, y1, z0]];
      for (const v of p) verts.push(v[0], v[1], v[2], shade);
    };
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = ix0 + di, j = iz0 + dj;
      if (!this.cloudCell(i, j)) continue;
      const x0 = i * S, z0 = j * S, x1 = x0 + S, z1 = z0 + S;
      q(x0, y0, z0, x1, y0 + h, z1, 1.0, 1);
      q(x0, y0, z0, x1, y0 + h, z1, 0.7, 0);
      if (!this.cloudCell(i, j - 1)) q(x0, y0, z0, x1, y0 + h, z1, 0.8, 2);
      if (!this.cloudCell(i, j + 1)) q(x0, y0, z0, x1, y0 + h, z1, 0.8, 3);
      if (!this.cloudCell(i - 1, j)) q(x0, y0, z0, x1, y0 + h, z1, 0.9, 4);
      if (!this.cloudCell(i + 1, j)) q(x0, y0, z0, x1, y0 + h, z1, 0.9, 5);
    }
    return new Float32Array(verts);
  }
  drawClouds(scroll, fancy) {
    const gl = this.gl, cam = this.cam, S = 12, R = 22, CY = this.cloudY || 176;   // the Divine Beast world lifts its clouds above the beast
    const ix = Math.floor((cam.x - scroll) / S), iz = Math.floor(cam.z / S);
    const key = ix + ',' + iz + ',' + CY;
    if (this.cloudCache.key !== key) {
      const data = this.buildClouds(ix, iz, R, CY, 4);
      gl.bindVertexArray(this.cloudVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVBO);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0); gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12); gl.enableVertexAttribArray(1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      this.cloudCache = { key, verts: data.length / 4 };
    }
    if (!this.cloudCache.verts) return;
    const pr = this.progCloud; gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.u_view, false, this.view); gl.uniformMatrix4fv(pr.u.u_proj, false, this.proj);
    gl.uniform3f(pr.u.u_off, scroll - cam.x, -cam.y, -cam.z);
    gl.uniform3fv(pr.u.u_color, this.env.cloudColor); gl.uniform3fv(pr.u.u_fogColor, this.fog.color);
    gl.uniform2f(pr.u.u_fog, this.far * 0.45, this.far * 1.6); gl.uniform1f(pr.u.u_alpha, 0.8);
    gl.bindVertexArray(this.cloudVAO);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    // depth pre-pass so overlapping faces do not double-blend
    gl.colorMask(false, false, false, false); gl.depthMask(true);
    gl.drawElements(gl.TRIANGLES, (this.cloudCache.verts >> 2) * 6, gl.UNSIGNED_INT, 0);
    gl.colorMask(true, true, true, true); gl.depthFunc(gl.LEQUAL);
    gl.drawElements(gl.TRIANGLES, (this.cloudCache.verts >> 2) * 6, gl.UNSIGNED_INT, 0);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
  }
}
