// Cabo Lume — from-scratch WebGL1 renderer. No library, no download: a tiny flat-shaded
// low-poly pipeline written in this session. Static city in one buffer, dynamic props
// (cars, player, heli, particles, beacons) rebuilt each frame, painter-free because the
// depth buffer does the sorting. Golden-hour sun + fog + day-cycle sky.
'use strict';

// ---- minimal mat4 (column-major, like WebGL expects) ----
function mat4Identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mat4Multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return [f / aspect,0,0,0, 0,f,0,0, 0,0,(far + near) * nf,-1, 0,0,2 * far * near * nf,0];
}
function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0, -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
}
function mat4YawPitch(yaw, pitch, tx, ty, tz) {
  // Rotation Y (yaw) then X (pitch), then translate. Used for car/player meshes.
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [
    cy, 0, -sy, 0,
    sy * sp, cp, cy * sp, 0,
    sy * cp, -sp, cy * cp, 0,
    tx, ty, tz, 1,
  ];
}
function mat4TransformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
function hexRgb(h) { return [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255]; }
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// ---- day-cycle sky: keyframes over minutes of day ----
const SKY_KEYS = [
  { t: 0,    top: 0x0b1026, hor: 0x1c2447, sun: 0xffd9a0, amb: 0.36, sunE: -0.10, sunA: 0.30 },
  { t: 340,  top: 0x5a6a9a, hor: 0xff8fa3, sun: 0xffb37a, amb: 0.52, sunE: 0.10, sunA: 0.42 },
  { t: 420,  top: 0x6fb1e8, hor: 0xcfe8f5, sun: 0xfff2cc, amb: 0.75, sunE: 0.55, sunA: 0.60 },
  { t: 1020, top: 0x4a6ea8, hor: 0xffd9a0, sun: 0xffc46b, amb: 0.66, sunE: 0.42, sunA: 0.78 },
  { t: 1040, top: 0x35507e, hor: 0xff9a3c, sun: 0xffb347, amb: 0.60, sunE: 0.16, sunA: 0.82 },
  { t: 1120, top: 0x2b2a55, hor: 0xe2607a, sun: 0xff7a5c, amb: 0.46, sunE: 0.03, sunA: 0.86 },
  { t: 1200, top: 0x0b1026, hor: 0x1c2447, sun: 0x9fb4ff, amb: 0.36, sunE: -0.10, sunA: 0.90 },
  { t: 1440, top: 0x0b1026, hor: 0x1c2447, sun: 0xffd9a0, amb: 0.36, sunE: -0.10, sunA: 0.30 },
];
function skyFor(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (m >= SKY_KEYS[i].t && m <= SKY_KEYS[i + 1].t) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  }
  const t = b.t === a.t ? 0 : (m - a.t) / (b.t - a.t);
  const s = (k) => a[k] + (b[k] - a[k]) * t;
  const top = mix3(hexRgb(a.top), hexRgb(b.top), t);
  const hor = mix3(hexRgb(a.hor), hexRgb(b.hor), t);
  const sun = mix3(hexRgb(a.sun), hexRgb(b.sun), t);
  const el = s('sunE'), az = s('sunA') * Math.PI * 2;
  const sunDir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  return {
    top, hor, sun, fog: hor, ambient: s('amb'), sunDir,
    lamps: m >= 1120 || m < 360, night: m >= 1180 || m < 330,
    sunPos: [sunDir[0] * 800, Math.max(40, sunDir[1] * 800), sunDir[2] * 800],
  };
}

// ---- mesh builder: non-indexed triangles, per-face normals, vertex colours ----
function MeshBuilder() {
  this.pos = []; this.col = []; this.nrm = [];
}
MeshBuilder.prototype.tri = function (a, b, c, color) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
  const col = typeof color === 'number' ? hexRgb(color) : color;
  for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(col[0], col[1], col[2]); this.nrm.push(n[0], n[1], n[2]); }
  return this;
};
MeshBuilder.prototype.quad = function (a, b, c, d, color) {
  return this.tri(a, b, c, color).tri(a, c, d, color);
};
MeshBuilder.prototype.box = function (cx, cy, cz, sx, sy, sz, color, topColor) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  const top = topColor === undefined ? color : topColor;
  this.quad([x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1], top);
  this.quad([x0,y0,z1],[x1,y0,z1],[x1,y0,z0],[x0,y0,z0], color);
  this.quad([x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0], color);
  this.quad([x1,y0,z1],[x0,y0,z1],[x0,y1,z1],[x1,y1,z1], color);
  this.quad([x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1], color);
  this.quad([x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0], color);
  return this;
};
MeshBuilder.prototype.prismRoof = function (cx, cy, cz, sx, sy, sz, color) {
  // Pitched roof: ridge along z.
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy, y1 = cy + sy, z0 = cz - sz / 2, z1 = cz + sz / 2;
  this.quad([x0,y0,z0],[cx,y1,z0],[cx,y1,z1],[x0,y0,z1], color);
  this.quad([cx,y1,z0],[x1,y0,z0],[x1,y0,z1],[cx,y1,z1], color);
  this.tri([x0,y0,z1],[cx,y1,z1],[x1,y0,z1], color);
  this.tri([x1,y0,z0],[cx,y1,z0],[x0,y0,z0], color);
  return this;
};
MeshBuilder.prototype.cylinder = function (cx, cy, cz, r, h, color, sides, topColor) {
  sides = sides || 10;
  const top = topColor === undefined ? color : topColor;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r];
    const p1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
    const q0 = [p0[0], cy + h, p0[2]], q1 = [p1[0], cy + h, p1[2]];
    this.quad(p0, p1, q1, q0, color);
    this.tri([cx, cy + h, cz], q0, q1, top);
    this.tri([cx, cy, cz], p1, p0, color);
  }
  return this;
};
MeshBuilder.prototype.cone = function (cx, cy, cz, r, h, color, sides) {
  sides = sides || 12;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r];
    const p1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
    this.tri(p0, p1, [cx, cy + h, cz], color);
  }
  return this;
};
MeshBuilder.prototype.verts = function () { return this.pos.length / 3; };
MeshBuilder.prototype.toArrays = function () {
  return { pos: new Float32Array(this.pos), col: new Float32Array(this.col), nrm: new Float32Array(this.nrm) };
};

// ---- the renderer ----
function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  const vs = `attribute vec3 aPos; attribute vec3 aCol; attribute vec3 aNrm;
    uniform mat4 uMVP; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uAmb;
    uniform vec3 uFogCol; uniform float uFogNear; uniform float uFogFar; uniform float uFogOn; uniform float uFlat;
    varying vec3 vCol; varying float vFog;
    void main(){
      vec4 wp = uMVP * vec4(aPos, 1.0);
      gl_Position = wp;
      float diff = max(dot(normalize(aNrm), normalize(uSunDir)), 0.0);
      float lit = mix(uAmb + (1.0 - uAmb) * diff, 1.0, uFlat);
      vCol = aCol * lit * uSunCol;
      float dist = -wp.z;
      float f = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
      vFog = f * uFogOn;
    }`;
  const fs = `precision mediump float;
    uniform vec3 uFogCol; varying vec3 vCol; varying float vFog;
    void main(){ gl_FragColor = vec4(mix(vCol, uFogCol, vFog), 1.0); }`;
  const vsA = `attribute vec3 aPos; attribute vec3 aCol;
    uniform mat4 uMVP; varying vec3 vCol; varying float vA;
    void main(){ gl_Position = uMVP * vec4(aPos, 1.0); vCol = aCol; vA = 1.0; }`;
  const fsA = `precision mediump float; varying vec3 vCol; varying float vA;
    uniform float uAlpha; void main(){ gl_FragColor = vec4(vCol, uAlpha); }`;
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  }
  function program(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  const prog = program(vs, fs);
  const progA = program(vsA, fsA);
  const bufPos = gl.createBuffer(), bufCol = gl.createBuffer(), bufNrm = gl.createBuffer();
  const bufPosA = gl.createBuffer(), bufColA = gl.createBuffer();
  let staticCount = 0, vp = mat4Identity();
  let stPos = null, stCol = null, stNrm = null; // dedicated static-city buffers

  function upload(buf, arr, size) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
  }
  function bindAttribs(p, withNormal) {
    const aPos = gl.getAttribLocation(p, 'aPos');
    const aCol = gl.getAttribLocation(p, 'aCol');
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCol);
    gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 0, 0);
    if (withNormal) {
      const aNrm = gl.getAttribLocation(p, 'aNrm');
      gl.bindBuffer(gl.ARRAY_BUFFER, bufNrm);
      gl.enableVertexAttribArray(aNrm); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
    }
  }
  function setCommon(p, sky, flat) {
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uMVP'), false, new Float32Array(vp));
    gl.uniform3fv(gl.getUniformLocation(p, 'uSunDir'), new Float32Array(sky.sunDir));
    gl.uniform3fv(gl.getUniformLocation(p, 'uSunCol'), new Float32Array(sky.sun));
    gl.uniform1f(gl.getUniformLocation(p, 'uAmb'), sky.ambient);
    gl.uniform3fv(gl.getUniformLocation(p, 'uFogCol'), new Float32Array(sky.fog));
    gl.uniform1f(gl.getUniformLocation(p, 'uFogNear'), 120);
    gl.uniform1f(gl.getUniformLocation(p, 'uFogFar'), 620);
    gl.uniform1f(gl.getUniformLocation(p, 'uFogOn'), 1);
    gl.uniform1f(gl.getUniformLocation(p, 'uFlat'), flat ? 1 : 0);
  }

  return {
    gl,
    setCamera(eye, target) {
      const proj = mat4Perspective(62 * Math.PI / 180, canvas.width / canvas.height, 0.5, 1600);
      vp = mat4Multiply(proj, mat4LookAt(eye, target, [0, 1, 0]));
    },
    buildStatic(city) {
      const b = new MeshBuilder();
      // Ground: land slab + sand strip + sea + roads (dark asphalt strips with pale dashes).
      b.box(0, -0.55, 0, 720, 1, 720, 0x9c8a6e, 0xa89a7c); // base earth under everything
      b.box(0, -0.45, 0, 690, 0.9, 690, 0x8a7d63, 0x9a8c74);
      // Streets: asphalt ribbons.
      for (const s of streetLines()) {
        b.box(s, -0.32, 0, 13, 0.5, 690, 0x3a3a40, 0x46464d);
        b.box(0, -0.32, s, 690, 0.5, 13, 0x3a3a40, 0x46464d);
      }
      // Beach + sea.
      b.box(336, -0.3, 0, 30, 0.6, 700, 0xe0c98f, 0xe8d5a3);
      b.box(520, -0.5, 0, 340, 0.8, 720, 0x2e6f8e, 0x3a86a8);
      // Plaza paving.
      b.box(0, -0.28, 0, 58, 0.5, 58, 0xb8a88a, 0xc4b498);
      // Buildings.
      for (const bd of city.buildings) {
        b.box(bd.x, bd.h / 2, bd.z, bd.w, bd.h, bd.d, bd.color, bd.color);
        b.prismRoof(bd.x, bd.h, bd.z, bd.w + 1, bd.roofH + 1.2, bd.d + 1, bd.roof);
        // Window band: thin dark boxes on the sun-facing sides.
        const rows = Math.max(1, Math.floor(bd.h / 7));
        for (let r = 0; r < rows; r++) {
          const y = 3 + r * 7;
          if (y > bd.h - 2) break;
          b.box(bd.x, y, bd.z + bd.d / 2 + 0.06, bd.w * 0.7, 1.6, 0.12, bd.glass);
          b.box(bd.x, y, bd.z - bd.d / 2 - 0.06, bd.w * 0.7, 1.6, 0.12, bd.glass);
        }
        if (bd.tank) b.cylinder(bd.x + bd.w / 4, bd.h + bd.roofH, bd.z, 1.2, 2.2, 0x8a6f4d, 8);
      }
      // Palms: trunk + 5 fronds (thin boxes angled out).
      for (const p of city.palms) {
        b.cylinder(p.x, 0, p.z, 0.35, p.h, 0x7a5c38, 6);
        for (let f = 0; f < 5; f++) {
          const a = (f / 5) * Math.PI * 2 + p.lean;
          const dx = Math.cos(a) * 2.2, dz = Math.sin(a) * 2.2;
          b.box(p.x + dx, p.h + 0.4, p.z + dz, 3.4, 0.25, 1.1, 0x3f7a3a);
        }
      }
      // Lamps: pole + head (emissive handled by flat colour at night via dynamic glow quads).
      for (const l of city.lamps) {
        b.cylinder(l.x, 0, l.z, 0.12, 6, 0x2b2b2b, 6);
        b.box(l.x, 6.1, l.z, 1.4, 0.3, 0.5, 0xffd9a0);
      }
      // Props.
      for (const pr of city.props) {
        if (pr.kind === 'crates') {
          for (let i = 0; i < pr.n; i++) b.box(pr.x + (i % 2) * 2.2, 1, pr.z + Math.floor(i / 2) * 2.2, 2, 2, 2, 0x8a6f4d);
        } else if (pr.kind === 'container') {
          b.box(pr.x, pr.h / 2, pr.z, pr.w, pr.h, pr.d, pr.color);
        } else if (pr.kind === 'boat') {
          b.box(pr.x, 0.6, pr.z, pr.w, 1.2, pr.d, pr.color);
          b.box(pr.x, 2, pr.z, 1.2, 2.4, 1.2, 0xf2ead8);
        } else if (pr.kind === 'pier') {
          b.box(pr.x, pr.h / 2, pr.z, pr.w, pr.h, pr.d, pr.color);
        } else if (pr.kind === 'fountain') {
          b.cylinder(pr.x, 0, pr.z, pr.r, 1.2, 0x9a8c74, 14);
          b.cylinder(pr.x, 0.8, pr.z, pr.r - 1.5, 0.8, 0x7fb3c8, 14);
        } else if (pr.kind === 'kiosk' || pr.kind === 'garage' || pr.kind === 'stand') {
          b.box(pr.x, pr.h / 2, pr.z, pr.w, pr.h, pr.d, pr.color);
          b.box(pr.x, pr.h + 0.3, pr.z, pr.w + 1, 0.6, pr.d + 1, 0x5f6e52);
        } else if (pr.kind === 'pitch') {
          b.box(pr.x, 0.05, pr.z, pr.w, 0.3, pr.d, pr.color);
        } else if (pr.kind === 'lighthouse') {
          b.cylinder(pr.x, 0, pr.z, 4.5, pr.h, pr.color, 12, 0x8c2f2f);
          b.cylinder(pr.x, pr.h, pr.z, 3.2, 3, 0x2b2b2b, 10);
          b.box(pr.x, pr.h + 4, pr.z, 2.4, 1.6, 2.4, 0xffd9a0);
        }
      }
      // Parked cars (static).
      for (const c of city.parked) {
        const m = mat4YawPitch(c.yaw, 0, c.x, 0, c.z);
        const local = new MeshBuilder();
        carMesh(local, c.color, 0);
        const a = local.toArrays();
        for (let i = 0; i < a.pos.length; i += 3) {
          const p = mat4TransformPoint(m, [a.pos[i], a.pos[i + 1], a.pos[i + 2]]);
          b.pos.push(p[0], p[1], p[2]);
          b.col.push(a.col[i], a.col[i + 1], a.col[i + 2]);
          // Rotate normals by yaw only.
          const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
          const nx = a.nrm[i], nz = a.nrm[i + 2];
          b.nrm.push(nx * cy + nz * sy, a.nrm[i + 1], -nx * sy + nz * cy);
        }
      }
      const arrays = b.toArrays();
      stPos = gl.createBuffer(); stCol = gl.createBuffer(); stNrm = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, stPos); gl.bufferData(gl.ARRAY_BUFFER, arrays.pos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, stCol); gl.bufferData(gl.ARRAY_BUFFER, arrays.col, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, stNrm); gl.bufferData(gl.ARRAY_BUFFER, arrays.nrm, gl.STATIC_DRAW);
      staticCount = b.verts();
    },
    draw(sky, dynamic, alphaMeshes) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(sky.top[0], sky.top[1], sky.top[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      // Sky dome: big gradient shell (flat colours, no fog).
      gl.useProgram(prog);
      bindAttribs(prog, true);
      setCommon(prog, sky, true);
      gl.uniform1f(gl.getUniformLocation(prog, 'uFogOn'), 0);
      const dome = skyDomeMesh(sky);
      upload(bufPos, dome.pos); upload(bufCol, dome.col); upload(bufNrm, dome.nrm);
      gl.drawArrays(gl.TRIANGLES, 0, dome.pos.length / 3);
      // Static city.
      this._drawStaticBuffer(sky);
      // Dynamic.
      if (dynamic && dynamic.pos.length) {
        gl.useProgram(prog);
        bindAttribs(prog, true);
        setCommon(prog, sky, false);
        upload(bufPos, dynamic.pos); upload(bufCol, dynamic.col); upload(bufNrm, dynamic.nrm);
        gl.drawArrays(gl.TRIANGLES, 0, dynamic.pos.length / 3);
      }
      // Translucent: spotlight cone, beacon beams, water shimmer.
      if (alphaMeshes && alphaMeshes.pos.length) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.useProgram(progA);
        gl.uniformMatrix4fv(gl.getUniformLocation(progA, 'uMVP'), false, new Float32Array(vp));
        gl.bindBuffer(gl.ARRAY_BUFFER, bufPosA);
        gl.bufferData(gl.ARRAY_BUFFER, alphaMeshes.pos, gl.STREAM_DRAW);
        const aPos = gl.getAttribLocation(progA, 'aPos');
        gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufColA);
        gl.bufferData(gl.ARRAY_BUFFER, alphaMeshes.col, gl.STREAM_DRAW);
        const aCol = gl.getAttribLocation(progA, 'aCol');
        gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 0, 0);
        gl.uniform1f(gl.getUniformLocation(progA, 'uAlpha'), alphaMeshes.alpha);
        gl.drawArrays(gl.TRIANGLES, 0, alphaMeshes.pos.length / 3);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    },
    _drawStaticBuffer(sky) {
      // Bind the dedicated static buffers (dynamic draws reuse bufPos/bufCol/bufNrm).
      if (!stPos) return;
      gl.useProgram(prog);
      setCommon(prog, sky, false);
      gl.uniform1f(gl.getUniformLocation(prog, 'uFogOn'), 1);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      const aCol = gl.getAttribLocation(prog, 'aCol');
      const aNrm = gl.getAttribLocation(prog, 'aNrm');
      gl.bindBuffer(gl.ARRAY_BUFFER, stPos);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, stCol);
      gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, stNrm);
      gl.enableVertexAttribArray(aNrm); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, staticCount);
    },
  };
}

// Sky dome: 12-segment shell, horizon colour low, top colour high, sun disc as a bright quad.
// Per-vertex colours are pushed explicitly (bottom ring = horizon, top ring = sky top).
function skyDomeMesh(sky) {
  const b = new MeshBuilder();
  const R = 1400, segs = 12;
  function triC(p, c) {
    // p: [[x,y,z]x3], c: [[r,g,b]x3] — push one triangle with explicit colours + up normals.
    for (let i = 0; i < 3; i++) {
      b.pos.push(p[i][0], p[i][1], p[i][2]);
      b.col.push(c[i][0], c[i][1], c[i][2]);
      b.nrm.push(0, 1, 0);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const p0 = [Math.cos(a0) * R, -20, Math.sin(a0) * R];
    const p1 = [Math.cos(a1) * R, -20, Math.sin(a1) * R];
    const q0 = [Math.cos(a0) * R * 0.55, 620, Math.sin(a0) * R * 0.55];
    const q1 = [Math.cos(a1) * R * 0.55, 620, Math.sin(a1) * R * 0.55];
    triC([p0, p1, q1], [sky.hor, sky.hor, sky.top]);
    triC([p0, q1, q0], [sky.hor, sky.top, sky.top]);
  }
  // Sun: a small warm octahedron (two 4-sided cones base to base) along the sun
  // direction — reads as a low-poly sun from any camera angle, unlike a flat quad.
  const s = sky.sunPos;
  const c = [s[0], Math.max(90, s[1]), s[2]];
  const sc = [2.0, 1.25, 0.55];
  b.cone(c[0], c[1] - 26, c[2], 42, 52, sc, 4);
  // Inverted cone below to close the octahedron.
  const inv = new MeshBuilder();
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4, a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
    const p0 = [c[0] + Math.cos(a0) * 42, c[1] - 26, c[2] + Math.sin(a0) * 42];
    const p1 = [c[0] + Math.cos(a1) * 42, c[1] - 26, c[2] + Math.sin(a1) * 42];
    inv.tri(p0, [c[0], c[1] - 78, c[2]], p1, sc);
  }
  const ia = inv.toArrays();
  for (let i = 0; i < ia.pos.length; i++) { b.pos.push(ia.pos[i]); b.col.push(ia.col[i]); b.nrm.push(ia.nrm[i]); }
  return b.toArrays();
}

// Low-poly car (local space, facing +z, ~2 wide, 4.4 long, 1.5 tall). colour = body.
function carMesh(b, color, kind) {
  const dark = 0x1c1c22, glass = 0x2b3a44;
  b.box(0, 0.55, 0, 2.0, 0.7, 4.4, color);                 // body
  b.box(0, 1.15, -0.3, 1.7, 0.55, 2.2, glass, color);      // cabin + roof tint
  b.box(0, 0.35, 2.15, 1.9, 0.3, 0.25, 0xd8d8d8);          // front bumper
  b.box(0, 0.35, -2.15, 1.9, 0.3, 0.25, 0xd8d8d8);         // rear bumper
  b.box(-0.7, 0.75, 2.2, 0.45, 0.25, 0.1, 0xffe9a8);       // headlights
  b.box(0.7, 0.75, 2.2, 0.45, 0.25, 0.1, 0xffe9a8);
  b.box(-0.7, 0.75, -2.2, 0.45, 0.25, 0.1, 0xff3b30);      // taillights
  b.box(0.7, 0.75, -2.2, 0.45, 0.25, 0.1, 0xff3b30);
  for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
    b.cylinder(wx, 0.35, wz, 0.38, 0.3, dark, 8);
  }
  if (kind === 1) { // police: light bar + livery stripe
    b.box(0, 1.55, -0.3, 1.2, 0.22, 0.5, 0xff3b30);
    b.box(0, 1.55, -0.3, 0.5, 0.24, 0.52, 0x2f6df6);
    b.box(0, 0.62, 0, 2.02, 0.18, 4.0, 0xf2ead8);
  }
  if (kind === 2) { // helicopter body handled elsewhere; unused here
  }
  return b;
}

// Low-poly person (local space, facing +z): jacket, head, legs, cap.
function personMesh(b, jacket, pants, skin) {
  b.box(0, 1.05, 0, 0.62, 0.7, 0.36, jacket);      // torso
  b.box(0, 1.62, 0, 0.42, 0.42, 0.4, skin);        // head
  b.box(0, 1.86, 0, 0.46, 0.12, 0.44, 0x1c1c22);   // cap
  b.box(-0.16, 0.35, 0, 0.24, 0.7, 0.28, pants);   // legs
  b.box(0.16, 0.35, 0, 0.24, 0.7, 0.28, pants);
  b.box(-0.36, 1.05, 0, 0.14, 0.6, 0.2, jacket);   // arms
  b.box(0.36, 1.05, 0, 0.14, 0.6, 0.2, jacket);
  return b;
}

// Low-poly helicopter (local space, facing +z).
function heliMesh(b, body) {
  b.box(0, 0, 0, 2.2, 1.6, 5.2, body);
  b.box(0, 0.4, 1.6, 1.6, 1.1, 1.8, 0x2b3a44);     // cockpit glass
  b.box(0, 0.2, -3.4, 0.5, 0.5, 2.6, body);        // tail boom
  b.box(0, 0.9, -4.4, 0.3, 1.4, 0.9, 0x8c2f2f);    // tail fin
  b.box(-3.4, 1.05, 0, 6.8, 0.08, 0.5, 0x1c1c22);  // main rotor
  b.box(0, 1.0, 0, 0.5, 0.08, 6.8, 0x1c1c22);      // rotor cross
  b.box(0, -1.0, 0, 0.4, 0.5, 0.4, 0xffe9a8);      // searchlight housing
  return b;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mat4Identity, mat4Multiply, mat4Perspective, mat4LookAt, mat4YawPitch, mat4TransformPoint, hexRgb, mix3, skyFor, MeshBuilder, createRenderer, skyDomeMesh, carMesh, personMesh, heliMesh };
}
