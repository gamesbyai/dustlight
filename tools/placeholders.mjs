// Writes placeholder assets with the same names and layout the asset pipeline delivers:
//   public/splats/<name>/<name>.spz           the splats (built as a standard 3DGS PLY: Y-up, metres, origin at
//                                              the base centre; shipped as SPZ like the real assets)
//   public/splats/<name>/<name>-collider.glb  simplified collision mesh
//   public/splats/<name>/meta.json            { height, footprint, splats, placeholder: true }
// tools/sync-assets.mjs replaces a placeholder as soon as the real asset is READY.
// Usage: node tools/placeholders.mjs [--force]   (skips folders that already hold a real asset)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plyToSpz, root } from './lib.mjs';

const OUT = join(root, 'public', 'splats');
const force = process.argv.includes('--force');

// ---------- small helpers ----------
let seed = 7;
const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const range = (a, b) => a + (b - a) * rand();
const TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const mixc = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const jitter = (c, j) => c.map((v) => Math.min(1, Math.max(0, v + range(-j, j))));

class Splats {
  constructor() { this.v = []; }
  // A flat splat lying on the surface with normal n (or a round one when n is null).
  add(p, size, color, alpha = 0.95, n = null, flat = 0.3) {
    size *= 0.65; // keep splats a little smaller than their spacing so shapes read crisp
    let q = [1, 0, 0, 0];
    let s = [size, size, size];
    if (n) {
      s = [size, size, size * flat];
      const w = 1 + n[2];
      q = w < 1e-4 ? [0, 1, 0, 0] : [w, -n[1], n[0], 0];
      const l = Math.hypot(...q); q = q.map((x) => x / l);
    }
    this.v.push([...p, ...color, alpha, ...s, ...q]);
  }
  ply() {
    const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${this.v.length}\n${props.map((p) => `property float ${p}`).join('\n')}\nend_header\n`;
    const C0 = 0.28209479177387814;
    const f = new Float32Array(this.v.length * props.length);
    this.v.forEach((s, i) => {
      const [x, y, z, r, g, b, a, sx, sy, sz, qw, qx, qy, qz] = s;
      const al = Math.min(0.999, Math.max(0.001, a));
      f.set([x, y, z, 0, 0, 0, (r - 0.5) / C0, (g - 0.5) / C0, (b - 0.5) / C0, Math.log(al / (1 - al)), Math.log(sx), Math.log(sy), Math.log(sz), qw, qx, qy, qz], i * props.length);
    });
    return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(f.buffer)]);
  }
}

class Collider {
  constructor() { this.pos = []; this.idx = []; }
  tri(a, b, c) { const i = this.pos.length / 3; this.pos.push(...a, ...b, ...c); this.idx.push(i, i + 1, i + 2); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  cylinder(r0, r1, y0, y1, cx = 0, cz = 0, seg = 16) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU, b = ((i + 1) / seg) * TAU;
      const p = (r, y, t) => [cx + Math.cos(t) * r, y, cz + Math.sin(t) * r];
      this.quad(p(r0, y0, a), p(r1, y1, a), p(r1, y1, b), p(r0, y0, b));
      this.tri([cx, y1, cz], p(r1, y1, b), p(r1, y1, a));
    }
  }
  box([x0, y0, z0], [x1, y1, z1]) {
    const c = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
    this.quad(c(0, 0, 0), c(1, 0, 0), c(1, 1, 0), c(0, 1, 0)); this.quad(c(0, 0, 1), c(0, 1, 1), c(1, 1, 1), c(1, 0, 1));
    this.quad(c(0, 0, 0), c(0, 1, 0), c(0, 1, 1), c(0, 0, 1)); this.quad(c(1, 0, 0), c(1, 0, 1), c(1, 1, 1), c(1, 1, 0));
    this.quad(c(0, 1, 0), c(1, 1, 0), c(1, 1, 1), c(0, 1, 1)); this.quad(c(0, 0, 0), c(0, 0, 1), c(1, 0, 1), c(1, 0, 0));
  }
  glb() {
    const pos = new Float32Array(this.pos), idx = new Uint32Array(this.idx);
    const min = [0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k)));
    const max = [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k)));
    const json = {
      asset: { version: '2.0', generator: 'dustlight placeholders' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'collider' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max }, { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 }],
      buffers: [{ byteLength: pos.byteLength + idx.byteLength }],
    };
    let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
    const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
    const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
    const body = Buffer.concat([chunk(0x4e4f534a, js), chunk(0x004e4942, bin)]);
    const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + body.length, 8);
    return Buffer.concat([head, body]);
  }
}

// ---------- shapes ----------
const noise2 = (x, z, s) => Math.sin(x * 0.31 + s) * Math.cos(z * 0.27 - s) + 0.5 * Math.sin(x * 0.71 + z * 0.53 + s * 2);

function island(name, R, depth, opts = {}) {
  const sp = new Splats(), col = new Collider();
  const s = opts.seed ?? 1;
  const edge = (t) => R * (1 + 0.1 * Math.sin(3 * t + s) + 0.06 * Math.sin(5 * t + 2 * s) + 0.03 * Math.sin(9 * t));
  const height = (x, z) => 0.35 * noise2(x, z, s) + (opts.hill ? opts.hill(x, z) : 0);
  const grass = [hex(0x5f8f4e), hex(0x7aa65a), hex(0x93b86a), hex(0x4f7d48)];
  // top surface: polar grid, a layer of grass splats plus little flowers
  const rings = Math.round(R / 0.12);
  for (let i = 0; i <= rings; i++) {
    const rr = i / rings;
    const n = Math.max(6, Math.round(TAU * rr * R / 0.12));
    for (let j = 0; j < n; j++) {
      const t = (j + rand()) / n * TAU, e = edge(t);
      const r = Math.min(1, rr + range(-0.5, 0.5) / rings) * e;
      const x = Math.cos(t) * r, z = Math.sin(t) * r, y = height(x, z) - Math.pow(r / e, 8) * 0.6;
      const path = opts.path ? opts.path(x, z) : 0;
      let c = mixc(grass[Math.floor(rand() * 4)], hex(0xc9b48a), path);
      c = jitter(c, 0.05);
      sp.add([x, y + range(0, 0.06), z], range(0.09, 0.14), c, 0.95, [0, 1, 0], 0.35);
      if (rand() < 0.035 && path < 0.3) sp.add([x, y + range(0.08, 0.2), z], range(0.03, 0.05), rand() < 0.5 ? hex(0xf3a6c8) : hex(0xf6e08a), 0.95);
    }
  }
  // underside: craggy rock cone down to the tip
  const segs = Math.round(TAU * R / 0.22);
  const layers = Math.round(depth / 0.22);
  for (let k = 0; k <= layers; k++) {
    const v = k / layers;
    for (let j = 0; j < segs * (1 - v * 0.8); j++) {
      const t = (j + rand()) / (segs * (1 - v * 0.8)) * TAU;
      const crag = 1 + 0.12 * Math.sin(t * 7 + v * 9 + s) + 0.08 * Math.sin(t * 13 - v * 5);
      const r = edge(t) * Math.pow(1 - v, 0.75) * crag;
      const y = -v * depth - 0.15 + height(Math.cos(t) * edge(t), Math.sin(t) * edge(t)) * (1 - v);
      const nrm = [Math.cos(t), 0.45, Math.sin(t)]; const l = Math.hypot(...nrm);
      const c = jitter(mixc(mixc(hex(0x8a6f5a), hex(0x6f6475), v), hex(0x3b3350), v * v), 0.06);
      sp.add([Math.cos(t) * r, y, Math.sin(t) * r], range(0.13, 0.22), c, 0.97, nrm.map((q) => q / l), 0.4);
    }
  }
  // collider: top as a polar grid, underside as a cone
  const CR = 24, CS = 48;
  const P = (i, j) => { const t = (j / CS) * TAU, r = (i / CR) * edge(t), x = Math.cos(t) * r, z = Math.sin(t) * r; return [x, height(x, z) - Math.pow(i / CR, 8) * 0.6, z]; };
  for (let i = 0; i < CR; i++) for (let j = 0; j < CS; j++) col.quad(P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j));
  for (let j = 0; j < CS; j++) col.tri(P(CR, j), P(CR, j + 1), [0, -depth, 0]);
  return { sp, col, height: depth, footprint: [2 * R, 2 * R] };
}

function lighthouse() {
  const sp = new Splats(), col = new Collider();
  const H = 10.5;
  const radius = (y) => mix(1.7, 1.15, y / H);
  for (let y = 0; y < H; y += 0.12) {
    const r = radius(y), n = Math.round(TAU * r / 0.12);
    const stripe = Math.floor(y / 1.75) % 2 === 1;
    for (let j = 0; j < n; j++) {
      const t = (j + rand()) / n * TAU;
      let c = stripe ? hex(0xb8473f) : hex(0xeee6d8);
      if (y < 0.6) c = hex(0x8c8178);
      const win = Math.abs(((t + 0.6) % (TAU / 3)) - 0.5) < 0.12 && Math.abs((y % 3.2) - 2.2) < 0.35 && y > 2;
      if (win) c = hex(0x3a3550);
      sp.add([Math.cos(t) * r, y + range(0, 0.1), Math.sin(t) * r], 0.085, jitter(c, 0.03), 0.97, [Math.cos(t), 0.1, Math.sin(t)], 0.3);
    }
  }
  // door
  for (let y = 0.2; y < 2.1; y += 0.08) for (let a = -0.25; a < 0.25; a += 0.05) sp.add([Math.sin(a) * 1.72, y, Math.cos(a) * 1.72], 0.06, hex(0x5a3a2a), 0.98, [0, 0, 1]);
  // gallery deck and railing
  for (let r = 0.9; r < 2.0; r += 0.1) for (let t = 0; t < TAU; t += 0.1 / r) sp.add([Math.cos(t) * r, H, Math.sin(t) * r], 0.08, jitter(hex(0x3d3a45), 0.03), 0.98, [0, 1, 0], 0.3);
  for (let t = 0; t < TAU; t += 0.05) { sp.add([Math.cos(t) * 1.95, H + 0.55, Math.sin(t) * 1.95], 0.04, hex(0x2e2b36), 0.98); if (Math.round(t / 0.05) % 6 === 0) for (let y = 0; y < 0.55; y += 0.06) sp.add([Math.cos(t) * 1.95, H + y, Math.sin(t) * 1.95], 0.03, hex(0x2e2b36), 0.98); }
  // lamp room (glass, dark until the lamp ignites) and cap
  for (let y = H; y < H + 1.4; y += 0.1) for (let t = 0; t < TAU; t += 0.08) sp.add([Math.cos(t) * 0.95, y, Math.sin(t) * 0.95], 0.06, jitter(hex(0x9db4c8), 0.05), 0.35, [Math.cos(t), 0, Math.sin(t)]);
  for (let y = 0; y < 1.0; y += 0.07) { const r = 1.15 * (1 - y); for (let t = 0; t < TAU; t += 0.07 / Math.max(r, 0.2)) sp.add([Math.cos(t) * r, H + 1.4 + y, Math.sin(t) * r], 0.07, jitter(hex(0xa8413a), 0.03), 0.98, [Math.cos(t), 0.8, Math.sin(t)]); }
  col.cylinder(1.75, 1.2, 0, H, 0, 0, 16);
  return { sp, col, height: H + 2.4, footprint: [3.5, 3.5] };
}

function cottage() {
  const sp = new Splats(), col = new Collider();
  const W = 2.6, D = 2.0, Hw = 2.4, Hr = 1.7;
  const wall = (p, n) => {
    const win = (Math.abs(p[0]) > 0.9 && Math.abs(p[0]) < 1.7 && p[1] > 1.0 && p[1] < 1.8 && n[2] !== 0) || (Math.abs(p[2]) < 0.5 && p[1] > 1.0 && p[1] < 1.8 && n[0] !== 0);
    const door = n[2] > 0 && Math.abs(p[0]) < 0.45 && p[1] < 1.9;
    const beam = Math.abs(Math.abs(p[0]) - W) < 0.15 || Math.abs(Math.abs(p[2]) - D) < 0.15 || p[1] < 0.3;
    let c = beam ? hex(0x6b4a35) : hex(0xeadfc8);
    if (win) c = hex(0xf2c46b); if (door) c = hex(0x7a4b30);
    sp.add(p, 0.075, jitter(c, 0.03), 0.97, n, 0.3);
  };
  for (let y = 0; y < Hw; y += 0.1) {
    for (let x = -W; x <= W; x += 0.1) { wall([x, y, D], [0, 0, 1]); wall([x, y, -D], [0, 0, -1]); }
    for (let z = -D; z <= D; z += 0.1) { wall([W, y, z], [1, 0, 0]); wall([-W, y, z], [-1, 0, 0]); }
  }
  for (let z = -D; z <= D; z += 0.1) for (let y = Hw; y < Hw + Hr; y += 0.1) { const hw = (1 - (y - Hw) / Hr) * W; if (Math.abs(z) > D - 0.05) for (let x = -hw; x <= hw; x += 0.1) wall([x, y, z], [0, 0, Math.sign(z)]); }
  for (let s of [-1, 1]) for (let u = 0; u <= 1; u += 0.025) for (let z = -D - 0.35; z <= D + 0.35; z += 0.09) {
    const x = s * (W + 0.35) * (1 - u), y = Hw - 0.25 + u * (Hr + 0.25);
    const shingle = Math.floor(u * 14) % 2 ? hex(0x8e3b34) : hex(0x7a302c);
    sp.add([x, y, z], 0.09, jitter(shingle, 0.04), 0.98, [s * Hr, W, 0].map((v) => v / Math.hypot(Hr, W)), 0.3);
  }
  for (let y = Hw + 0.5; y < Hw + Hr + 0.8; y += 0.08) for (let t = 0; t < TAU; t += 0.3) sp.add([1.3 + Math.cos(t) * 0.28, y, -0.9 + Math.sin(t) * 0.28], 0.08, jitter(hex(0x7f7570), 0.05), 0.98);
  col.box([-W, 0, -D], [W, Hw + Hr * 0.6, D]);
  return { sp, col, height: Hw + Hr + 0.8, footprint: [2 * W + 0.7, 2 * D + 0.7] };
}

function blossomTree() {
  const sp = new Splats(), col = new Collider();
  const trunk = (y) => [0.3 * Math.sin(y * 0.6), y, 0.2 * Math.sin(y * 0.4 + 1)];
  for (let y = 0; y < 3.6; y += 0.06) { const r = mix(0.42, 0.22, y / 3.6); const c = trunk(y); for (let t = 0; t < TAU; t += 0.12 / r) sp.add([c[0] + Math.cos(t) * r, y, c[2] + Math.sin(t) * r], 0.06, jitter(hex(0x5b4033), 0.05), 0.98, [Math.cos(t), 0, Math.sin(t)]); }
  const clusters = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + range(-0.3, 0.3), L = range(1.6, 2.6), base = trunk(3.2), tip = [base[0] + Math.cos(a) * L, 3.2 + range(1.0, 2.0), base[2] + Math.sin(a) * L];
    for (let u = 0; u <= 1; u += 0.03) { const p = [mix(base[0], tip[0], u), mix(3.2, tip[1], u), mix(base[2], tip[2], u)]; for (let t = 0; t < TAU; t += 0.6) sp.add([p[0] + Math.cos(t) * 0.1, p[1], p[2] + Math.sin(t) * 0.1], 0.05, hex(0x5b4033), 0.98); }
    clusters.push(tip);
  }
  clusters.push([0, 5.6, 0], [0.8, 5.0, 0.9], [-0.9, 5.2, -0.6]);
  const pinks = [hex(0xf7c6d9), hex(0xf2a7c3), hex(0xfbe0ea), hex(0xe98fb3)];
  for (const c of clusters) {
    const R = range(1.2, 1.7);
    for (let k = 0; k < 4200; k++) {
      const d = [range(-1, 1), range(-1, 1), range(-1, 1)]; const l = Math.hypot(...d); if (l > 1) continue;
      const rr = Math.cbrt(rand()) * R;
      const p = [c[0] + d[0] / l * rr, c[1] + d[1] / l * rr * 0.75, c[2] + d[2] / l * rr];
      const shade = mix(0.75, 1.05, (p[1] - c[1] + R) / (2 * R));
      sp.add(p, range(0.05, 0.09), pinks[Math.floor(rand() * 4)].map((v) => Math.min(1, v * shade)), 0.9);
    }
  }
  for (let k = 0; k < 2500; k++) { const r = Math.sqrt(rand()) * 4.2, t = rand() * TAU; sp.add([Math.cos(t) * r, 0.03, Math.sin(t) * r], 0.04, pinks[Math.floor(rand() * 4)], 0.9, [0, 1, 0], 0.2); }
  col.cylinder(0.45, 0.3, 0, 3.4, 0, 0, 10);
  return { sp, col, height: 7.2, footprint: [6.5, 6.5] };
}

function shrineArch() {
  const sp = new Splats(), col = new Collider();
  const stone = [hex(0x8d8a86), hex(0x77736f), hex(0x9a9690)], moss = [hex(0x5d7f3e), hex(0x6f9346), hex(0x48693a)];
  const block = (x0, x1, y0, y1, z0, z1, mossTop) => {
    const step = 0.08;
    for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) for (const z of [z0, z1]) sp.add([x, y, z], 0.065, jitter(stone[Math.floor(rand() * 3)], 0.04), 0.98, [0, 0, Math.sign(z)]);
    for (let z = z0; z <= z1; z += step) for (let y = y0; y <= y1; y += step) for (const x of [x0, x1]) sp.add([x, y, z], 0.065, jitter(stone[Math.floor(rand() * 3)], 0.04), 0.98, [Math.sign(x), 0, 0]);
    for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) sp.add([x, y1, z], 0.07, mossTop || rand() < 0.4 ? jitter(moss[Math.floor(rand() * 3)], 0.05) : stone[0], 0.98, [0, 1, 0]);
  };
  block(-1.9, -1.3, 0, 3.6, -0.3, 0.3); block(1.3, 1.9, 0, 3.6, -0.3, 0.3);
  block(-2.4, 2.4, 3.6, 4.0, -0.4, 0.4, true); block(-2.0, 2.0, 2.9, 3.15, -0.25, 0.25);
  for (let k = 0; k < 3000; k++) { const x = rand() < 0.5 ? range(-1.95, -1.25) : range(1.25, 1.95); const y = Math.pow(rand(), 2) * 2.2; sp.add([x, y, range(-0.33, 0.33)], range(0.05, 0.09), jitter(moss[Math.floor(rand() * 3)], 0.05), 0.95); }
  col.box([-1.9, 0, -0.3], [-1.3, 3.6, 0.3]); col.box([1.3, 0, -0.3], [1.9, 3.6, 0.3]); col.box([-2.4, 3.6, -0.4], [2.4, 4.0, 0.4]);
  return { sp, col, height: 4.0, footprint: [4.8, 0.8] };
}

function skyWhale() {
  const sp = new Splats(), col = new Collider();
  const L = 16;
  const rad = (u) => 2.1 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.8) + 0.05; // u: 0 = head, 1 = tail
  for (let u = 0; u <= 1; u += 0.006) {
    const r = rad(u), z = L * (0.5 - u), n = Math.max(8, Math.round(TAU * r / 0.1));
    for (let j = 0; j < n; j++) {
      const t = (j + rand()) / n * TAU, cy = Math.sin(t), cx = Math.cos(t);
      const belly = cy < -0.2;
      let c = belly ? hex(0xcfd7e6) : mixc(hex(0x2d4f7c), hex(0x4f7fb0), (cy + 1) / 2);
      if (!belly && rand() < 0.02) c = hex(0xbfe3ff);
      sp.add([cx * r, cy * r * 0.85 + 2.2, z], 0.1, jitter(c, 0.03), 0.97, [cx, cy, 0], 0.3);
    }
  }
  const fin = (side) => { for (let a = 0; a < 1; a += 0.02) for (let b = 0; b < 1; b += 0.05) { const w = 3.6 * a, l = 1.6 * (1 - a) * b; sp.add([side * (1.7 + w), 1.4 - a * 0.8, 3 - a * 1.2 - l], 0.09, hex(0x3b6290), 0.95, [0, 1, 0]); } };
  fin(1); fin(-1);
  for (let a = 0; a < 1; a += 0.015) for (let b = 0; b < 1; b += 0.05) for (const s of [-1, 1]) sp.add([s * 3.2 * a, 2.2 + 0.3 * a, -L / 2 - 0.4 - 1.4 * a * (1 - b) - b * 0.3], 0.09, hex(0x35598a), 0.95, [0, 1, 0]);
  col.box([-2, 0, -L / 2], [2, 4.4, L / 2]);
  return { sp, col, height: 4.4, footprint: [8, L] };
}

function lanternSpirit() {
  const sp = new Splats(), col = new Collider();
  for (let y = 0.12; y < 0.62; y += 0.012) {
    const u = (y - 0.12) / 0.5, r = 0.24 * Math.sin(Math.PI * (0.15 + 0.7 * u));
    for (let t = 0; t < TAU; t += 0.025 / Math.max(r, 0.05)) {
      const rib = Math.abs(((t * 8 / TAU) % 1) - 0.5) < 0.06;
      const c = rib ? hex(0xc4572e) : mixc(hex(0xffc773), hex(0xff9a4a), Math.abs(u - 0.5) * 2);
      sp.add([Math.cos(t) * r, y, Math.sin(t) * r], 0.016, c, 0.9, [Math.cos(t), 0, Math.sin(t)]);
    }
  }
  for (const s of [-1, 1]) for (let k = 0; k < 40; k++) { const a = rand() * TAU, rr = Math.sqrt(rand()) * 0.03; sp.add([s * 0.075 + Math.cos(a) * rr, 0.4 + Math.sin(a) * rr, 0.225], 0.012, hex(0x2a1c22), 0.98); }
  for (let t = 0; t < TAU; t += 0.1) { sp.add([Math.cos(t) * 0.09, 0.1, Math.sin(t) * 0.09], 0.02, hex(0x6b3a2a), 0.98); sp.add([Math.cos(t) * 0.07, 0.64, Math.sin(t) * 0.07], 0.02, hex(0x6b3a2a), 0.98); }
  for (let k = 0; k < 400; k++) { const y = 0.66 + Math.pow(rand(), 1.5) * 0.14; const r = 0.035 * (1 - (y - 0.66) / 0.14); const a = rand() * TAU; sp.add([Math.cos(a) * r, y, Math.sin(a) * r], 0.014, mixc(hex(0xfff2b0), hex(0xffa040), (y - 0.66) / 0.14), 0.85); }
  for (let y = 0; y < 0.1; y += 0.01) sp.add([range(-0.01, 0.01), y, range(-0.01, 0.01)], 0.012, hex(0xd0443a), 0.95);
  col.cylinder(0.25, 0.25, 0, 0.8, 0, 0, 8);
  return { sp, col, height: 0.8, footprint: [0.5, 0.5] };
}

// ---------- write ----------
const pathFn = (x, z) => { const d = Math.abs(Math.sin(Math.atan2(z, x) * 2) * Math.hypot(x, z) * 0.5); return Math.max(0, 1 - d / 0.8) * (Math.hypot(x, z) > 2 ? 1 : 0); };
const assets = {
  island: () => island('island', 18, 14, { seed: 1, path: pathFn, hill: (x, z) => 0.9 * Math.exp(-((x + 12) ** 2 + (z + 3) ** 2) / 40) }),
  'island-small-1': () => island('island-small-1', 5, 6, { seed: 2 }),
  'island-small-2': () => island('island-small-2', 4, 5, { seed: 3 }),
  'island-small-3': () => island('island-small-3', 3.2, 4, { seed: 4 }),
  lighthouse, cottage, 'blossom-tree': blossomTree, 'shrine-arch': shrineArch, 'sky-whale': skyWhale, 'lantern-spirit': lanternSpirit,
};
for (const [name, make] of Object.entries(assets)) {
  const dir = join(OUT, name);
  const metaPath = join(dir, 'meta.json');
  if (!force && existsSync(metaPath) && !JSON.parse(readFileSync(metaPath, 'utf8')).placeholder) { console.log(`skip ${name} (real asset present)`); continue; }
  mkdirSync(dir, { recursive: true });
  const { sp, col, height, footprint } = make();
  writeFileSync(join(dir, `${name}.spz`), await plyToSpz(sp.ply()));
  writeFileSync(join(dir, `${name}-collider.glb`), col.glb());
  writeFileSync(metaPath, JSON.stringify({ name, height, footprint, splats: sp.v.length, placeholder: true }, null, 1) + '\n');
  console.log(`${name}: ${sp.v.length} splats, ${col.idx.length / 3} collider tris`);
}
