// ===== g_render2.js : dynamic batches, item/block meshes, icons, hand, lines =====
// Dynamic vertex = 12 floats: pos(3) uv(2) tile(1) rgba(4) sky,blk(2)
const DV = 12;
class DynBatch {
  constructor(gl, maxVerts) {
    this.gl = gl; this.max = maxVerts; this.data = new Float32Array(maxVerts * DV); this.n = 0;
    this.vao = gl.createVertexArray(); this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    DynBatch.attribs(gl);
  }
  static attribs(gl) {
    const s = DV * 4;
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, s, 0); gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, s, 12); gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, s, 20); gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, s, 24); gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, s, 40); gl.enableVertexAttribArray(4);
  }
  v(x, y, z, u, v, tile, r, g, b, a, sky, blk) {
    if (this.n >= this.max) return;
    const d = this.data, o = this.n * DV;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = u; d[o + 4] = v; d[o + 5] = tile; d[o + 6] = r; d[o + 7] = g; d[o + 8] = b; d[o + 9] = a; d[o + 10] = sky; d[o + 11] = blk;
    this.n++;
  }
  clear() { this.n = 0; }
  // billboard quad centred at (x,y,z) (camera-relative) with right/up vectors, uv rect within a tile
  billboard(x, y, z, rx, ry, rz, ux, uy, uz, tile, u0, v0, u1, v1, r, g, b, a, sky, blk) {
    this.v(x - rx + ux, y - ry + uy, z - rz + uz, u0, v0, tile, r, g, b, a, sky, blk);
    this.v(x - rx - ux, y - ry - uy, z - rz - uz, u0, v1, tile, r, g, b, a, sky, blk);
    this.v(x + rx - ux, y + ry - uy, z + rz - uz, u1, v1, tile, r, g, b, a, sky, blk);
    this.v(x + rx + ux, y + ry + uy, z + rz + uz, u1, v0, tile, r, g, b, a, sky, blk);
  }
}

// face tables shared by the mesh builders (same conventions as shared_mesh.js)
const BFACE_POS = [
  (b) => [[b.x0, b.y0, b.z1], [b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y0, b.z1]],
  (b) => [[b.x0, b.y1, b.z0], [b.x0, b.y1, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0]],
  (b) => [[b.x1, b.y1, b.z0], [b.x1, b.y0, b.z0], [b.x0, b.y0, b.z0], [b.x0, b.y1, b.z0]],
  (b) => [[b.x0, b.y1, b.z1], [b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1]],
  (b) => [[b.x0, b.y1, b.z0], [b.x0, b.y0, b.z0], [b.x0, b.y0, b.z1], [b.x0, b.y1, b.z1]],
  (b) => [[b.x1, b.y1, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0]],
];
const FACE_SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];
function boxFaceUV(f, b, ov) {
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

Object.assign(Renderer.prototype, {
  initExtras() {
    const gl = this.gl;
    this.bTile = new DynBatch(gl, 60000);
    this.bSkin = new DynBatch(gl, 40000);
    this.bAlpha = new DynBatch(gl, 40000);          // translucent things (particles, rain and snow streaks etc.)
    this.bSkinT = new DynBatch(gl, 6000);           // translucent skin-mapped parts (slime gel)
    this.meshCache = new Map();
    this.iconCache = new Map();
    this.iconFBO = null;
    // flat NDC line/overlay buffer
    this.flatVAO = gl.createVertexArray(); this.flatVBO = gl.createBuffer();
    gl.bindVertexArray(this.flatVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.flatVBO);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8); gl.enableVertexAttribArray(1);
    this.flatData = new Float32Array(6 * 4096);
  },

  // ---------------- static meshes (float verts) : upload / draw
  makeMesh(arr) {
    const gl = this.gl, m = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), n: arr.length / DV };
    gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    DynBatch.attribs(gl);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    return m;
  },
  drawMesh(m, mv, proj, sky, blk, alphaTest) {
    const gl = this.gl, pr = this.progDyn;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.u_mv, false, mv); gl.uniformMatrix4fv(pr.u.u_proj, false, proj);
    gl.uniform2f(pr.u.u_lightMul, sky, blk);
    this.setCommonUniforms(pr, alphaTest === undefined ? 0.1 : alphaTest);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray); gl.uniform1i(pr.u.u_tex, 0);
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, (m.n >> 2) * 6, gl.UNSIGNED_INT, 0);
  },

  // extruded sprite mesh for a flat item tile (unit size, thickness 1/16, centred on the origin)
  spriteVerts(tileName, tint) {
    const idx = this.TILE[tileName]; if (idx === undefined) return new Float32Array(0);
    const d = this.tileData[tileName], out = [];
    const t = 1 / 16, hz = t / 2;
    const tr = tint ? tint[0] / 255 : 1, tg = tint ? tint[1] / 255 : 1, tb = tint ? tint[2] / 255 : 1;
    const push = (x, y, z, u, v, sh) => out.push(x, y, z, u, v, idx, tr * sh, tg * sh, tb * sh, 1, 1, 1);
    // front/back
    push(-0.5, 0.5, hz, 0, 0, 1); push(-0.5, -0.5, hz, 0, 1, 1); push(0.5, -0.5, hz, 1, 1, 1); push(0.5, 0.5, hz, 1, 0, 1);
    push(0.5, 0.5, -hz, 0, 0, 0.9); push(0.5, -0.5, -hz, 0, 1, 0.9); push(-0.5, -0.5, -hz, 1, 1, 0.9); push(-0.5, 0.5, -hz, 1, 0, 0.9);
    const A = (x, y) => (x < 0 || y < 0 || x > 15 || y > 15) ? 0 : d[(y * 16 + x) * 4 + 3];
    for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
      if (A(px, py) < 26) continue;
      const x0 = px / 16 - 0.5, x1 = (px + 1) / 16 - 0.5, y1 = 0.5 - py / 16, y0 = 0.5 - (py + 1) / 16;
      const u = (px + 0.5) / 16, v = (py + 0.5) / 16;
      if (A(px - 1, py) < 26) { push(x0, y1, -hz, u, v, 0.75); push(x0, y0, -hz, u, v, 0.75); push(x0, y0, hz, u, v, 0.75); push(x0, y1, hz, u, v, 0.75); }
      if (A(px + 1, py) < 26) { push(x1, y1, hz, u, v, 0.75); push(x1, y0, hz, u, v, 0.75); push(x1, y0, -hz, u, v, 0.75); push(x1, y1, -hz, u, v, 0.75); }
      if (A(px, py - 1) < 26) { push(x0, y1, -hz, u, v, 0.95); push(x0, y1, hz, u, v, 0.95); push(x1, y1, hz, u, v, 0.95); push(x1, y1, -hz, u, v, 0.95); }
      if (A(px, py + 1) < 26) { push(x0, y0, hz, u, v, 0.6); push(x0, y0, -hz, u, v, 0.6); push(x1, y0, -hz, u, v, 0.6); push(x1, y0, hz, u, v, 0.6); }
    }
    return new Float32Array(out);
  },
  // full block model verts (unit cube centred at origin) for icons, held/dropped blocks
  blockVerts(id, meta, scale) {
    const d = BLOCKS[id], out = [];
    const idxOf = n => { const v = this.TILE[n]; return v === undefined ? 0 : v; };
    const tint = (kind) => kind === 'grass' ? [0x91, 0xbd, 0x59] : kind === 'foliage' ? [0x77, 0xab, 0x2f] : kind === 'spruce' ? [0x61, 0x99, 0x61] : kind === 'birch' ? [0x80, 0xa7, 0x55] : kind === 'water' ? [0x3f, 0x76, 0xe4] : kind === 'lily' ? [0x20, 0x80, 0x30] : [255, 255, 255];
    const emit = (f, b, tile, uv, rot, tn, lightBoost) => {
      const pos = BFACE_POS[f](b), uvs = boxFaceUV(f, b, uv), sh = FACE_SHADE[f];
      for (let k = 0; k < 4; k++) {
        const p = pos[k], q = uvs[(k + (rot | 0)) & 3];
        out.push((p[0] / 16 - 0.5), (p[1] / 16 - 0.5), (p[2] / 16 - 0.5), q[0] / 16, q[1] / 16, tile, tn[0] / 255 * sh, tn[1] / 255 * sh, tn[2] / 255 * sh, 1, 1, 1);
      }
    };
    if (d.model === M_BOX) {
      let m = meta | 0; if (d.fence) m = 12; if (d.name === 'chest') m = 3;
      const boxes = SH.getBoxes(id, m);
      for (const b of boxes) for (let f = 0; f < 6; f++) emit(f, b, idxOf(b.t[f]), b.uv ? b.uv[f] : null, b.rot ? b.rot[f] : 0, tint(d.tint));
    } else {
      const b = { x0: 0, y0: 0, z0: 0, x1: 16, y1: 16, z1: 16 };
      for (let f = 0; f < 6; f++) {
        let tile = idxOf(d.faceNames ? d.faceNames[f] : d.name), tn = [255, 255, 255];
        if (d.orient) { const front = meta >= 2 && meta <= 5 ? meta : 3; if (f === front && d.tiles.front) tile = idxOf(d.tiles.front); }
        if (d.tint && (!d.tintTopOnly || f === 1)) tn = tint(d.tint);
        emit(f, b, tile, null, 0, tn);
        if (f >= 2 && d.overlay) emit(f, b, idxOf(d.overlay), null, 0, tint(d.tint));
      }
    }
    return new Float32Array(out);
  },
  itemMesh(itemId, kind) {
    const key = itemId + (kind || '');
    let m = this.meshCache.get(key); if (m) return m;
    const it = ITEMS[itemId];
    let arr;
    if (!it) arr = new Float32Array(0);
    else if (it.flat || !it.blk || it.blk < 0 || it.tile) arr = this.spriteVerts(it.tile, it.iconTint);
    else arr = this.blockVerts(it.blk, 0);
    m = this.makeMesh(arr); m.sprite = !!(it && (it.flat || it.tile || it.blk < 0));
    this.meshCache.set(key, m);
    return m;
  },

  // ---------------- item icons rendered with GL into canvases (block items are isometric 3D like MC)
  iconCanvas(itemId, size) {
    const key = itemId + ':' + size;
    let c = this.iconCache.get(key); if (c) return c;
    const it = ITEMS[itemId]; if (!it) return null;
    const gl = this.gl;
    if (!this.iconFBO || this.iconFBO.size !== size) {
      if (this.iconFBO) { gl.deleteFramebuffer(this.iconFBO.fb); gl.deleteTexture(this.iconFBO.tex); gl.deleteRenderbuffer(this.iconFBO.rb); }
      const fb = gl.createFramebuffer(), tex = gl.createTexture(), rb = gl.createRenderbuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      this.iconFBO = { fb, tex, rb, size };
    }
    const F = this.iconFBO;
    const mesh = this.itemMesh(itemId);
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.fb); gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    const proj = m4Ortho(m4(), -0.78, 0.78, -0.78, 0.78, -5, 5), mv = m4(), t1 = m4(), t2 = m4();
    if (mesh.sprite) { m4Identity(mv); }
    else { m4Mul(t1, m4RotX(t2, 30 * DEG), m4RotY(m4(), -45 * DEG)); mv.set(t1); }
    const saved = { st: this.fog.start, en: this.fog.end };
    this.fog.start = 1e6; this.fog.end = 2e6;
    const e = this.env, sv = [e.skyLight, e.skyTint, e.gamma]; e.skyLight = 1; e.skyTint = [1, 1, 1]; e.gamma = 0;
    this.drawMesh(mesh, mv, proj, 1, 0, 0.1);
    this.fog.start = saved.st; this.fog.end = saved.en; e.skyLight = sv[0]; e.skyTint = sv[1]; e.gamma = sv[2];
    const px = new Uint8Array(size * size * 4); gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.width, this.height);
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const cg = cv.getContext('2d'), id = cg.createImageData(size, size);
    for (let y = 0; y < size; y++) { const src = (size - 1 - y) * size * 4; id.data.set(px.subarray(src, src + size * 4), y * size * 4); }
    cg.putImageData(id, 0, 0);
    this.iconCache.set(key, cv);
    return cv;
  },
  clearIcons() { this.iconCache.clear(); },

  // ---------------- flat NDC triangles (thick lines, overlays)
  drawFlat(verts, n, mode) {
    const gl = this.gl, pr = this.progFlat;
    gl.useProgram(pr.p); gl.bindVertexArray(this.flatVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.flatVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, n * 6), gl.DYNAMIC_DRAW);
    gl.drawArrays(mode || gl.TRIANGLES, 0, n);
  },
  // project world point (camera-relative already) to NDC ; returns null when behind camera
  projectRel(x, y, z, out) {
    const m = this.vp, w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w < 0.05) return null;
    out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w; out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w; return out;
  },
  // thick 3D line list (camera-relative endpoints), width in pixels
  drawLines3D(segs, widthPx, r, g, b, a) {
    const gl = this.gl, arr = this.flatData; let n = 0;
    const p0 = [0, 0], p1 = [0, 0], W = this.width, H = this.height;
    for (let i = 0; i < segs.length; i += 6) {
      let ax = segs[i], ay = segs[i + 1], az = segs[i + 2], bx = segs[i + 3], by = segs[i + 4], bz = segs[i + 5];
      // clip against the near plane in view space
      const va = this.viewDepth(ax, ay, az), vb = this.viewDepth(bx, by, bz);
      if (va < 0.06 && vb < 0.06) continue;
      if (va < 0.06) { const t = (0.06 - va) / (vb - va); ax += (bx - ax) * t; ay += (by - ay) * t; az += (bz - az) * t; }
      else if (vb < 0.06) { const t = (0.06 - vb) / (va - vb); bx += (ax - bx) * t; by += (ay - by) * t; bz += (az - bz) * t; }
      if (!this.projectRel(ax, ay, az, p0) || !this.projectRel(bx, by, bz, p1)) continue;
      let dx = (p1[0] - p0[0]) * W, dy = (p1[1] - p0[1]) * H; const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l * widthPx / W, ny = dx / l * widthPx / H;   // half-width in NDC
      const put = (x, y) => { arr[n * 6] = x; arr[n * 6 + 1] = y; arr[n * 6 + 2] = r; arr[n * 6 + 3] = g; arr[n * 6 + 4] = b; arr[n * 6 + 5] = a; n++; };
      put(p0[0] + nx, p0[1] + ny); put(p0[0] - nx, p0[1] - ny); put(p1[0] - nx, p1[1] - ny);
      put(p0[0] + nx, p0[1] + ny); put(p1[0] - nx, p1[1] - ny); put(p1[0] + nx, p1[1] + ny);
      if (n > 4000) break;
    }
    if (!n) return;
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.drawFlat(arr, n);
    gl.enable(gl.DEPTH_TEST);
  },
  viewDepth(x, y, z) { const v = this.view; return -(v[2] * x + v[6] * y + v[10] * z); },

  // ---------------- dynamic batch flushing
  flushBatch(b, skin, opts) {
    if (!b.n) return;
    const gl = this.gl, pr = skin ? this.progSkin : this.progDyn;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.u_mv, false, opts && opts.mv || this.view); gl.uniformMatrix4fv(pr.u.u_proj, false, opts && opts.proj || this.proj);
    gl.uniform2f(pr.u.u_lightMul, 1, 1);
    this.setCommonUniforms(pr, opts && opts.alphaTest !== undefined ? opts.alphaTest : 0.1);
    gl.activeTexture(gl.TEXTURE0);
    if (skin) { gl.bindTexture(gl.TEXTURE_2D, opts && opts.tex || this.skinTex); gl.uniform1i(pr.u.u_skin, 0); }
    else { gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray); gl.uniform1i(pr.u.u_tex, 0); }
    gl.bindVertexArray(b.vao); gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.data.subarray(0, b.n * DV));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    let left = b.n >> 2, off = 0;
    gl.drawElements(gl.TRIANGLES, left * 6, gl.UNSIGNED_INT, 0);
    this.stats.draws++;
    b.n = 0;
  },
});
