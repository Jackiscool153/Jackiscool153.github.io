// World: seeded noise terrain, chunk storage, generation and face-culled meshing with ambient occlusion.
import * as THREE from './vendor/three.module.min.js';
import { AIR, GRASS, DIRT, STONE, SAND, WATER, LOG, LEAVES, SNOW, DEEPSTONE, BLOCKS, KIND, ATLAS_TILES } from './blocks.js';

export const CS = 16, CH = 64, SEA = 24, SNOWLINE = 45;
const idx = (x, y, z) => (y * CS + z) * CS + x;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function makePerlin(seed) {
  const rnd = mulberry32(seed);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const p = new Uint8Array(512); for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t, a, b) => a + t * (b - a);
  const grad = (h, x, y) => { switch (h & 7) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y; case 4: return x; case 5: return -x; case 6: return y; default: return -y; } };
  return (x, y) => {
    const fx = Math.floor(x), fy = Math.floor(y); const X = fx & 255, Y = fy & 255; x -= fx; y -= fy;
    const u = fade(x), v = fade(y); const a = p[X] + Y, b = p[X + 1] + Y;
    return lerp(v, lerp(u, grad(p[a], x, y), grad(p[b], x - 1, y)), lerp(u, grad(p[a + 1], x, y - 1), grad(p[b + 1], x - 1, y - 1)));
  };
}

// Face table (corner order with triangles (0,1,2),(2,1,3))
const FACES = [
  { dir: [-1, 0, 0], c: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], c: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], c: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], c: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], c: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], c: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];
const AO_LEVEL = [0.45, 0.65, 0.82, 1.0];

class Geo {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.ind = []; }
  build() {
    if (!this.ind.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.ind, 1) : new THREE.Uint16BufferAttribute(this.ind, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export class World {
  constructor(scene, materials, seed, opts = {}) {
    this.scene = scene; this.mat = materials;
    this.chunks = new Map();
    this.edits = new Map(); // "x,y,z" -> id
    this.editsByChunk = new Map(); // chunkKey -> Map(localIdx -> id)
    this.name = (opts.name || 'New World').slice(0, 32);
    this.type = opts.type || 'normal'; // normal | flat | amplified | islands
    this.mode = opts.mode || 'survival'; // survival | creative
    this.sea = opts.sea ?? SEA;
    this.treeDensity = opts.treeDensity ?? 0.012;
    this.caves = !!opts.caves;
    this.renderDist = opts.renderDist ?? 5;
    this.startTime = opts.startTime ?? 0.08;
    this.setSeed(seed);
  }
  setSeed(seed) {
    this.seed = seed >>> 0;
    this.n1 = makePerlin(this.seed); this.n2 = makePerlin(this.seed + 101); this.n3 = makePerlin(this.seed + 202);
  }
  key(cx, cz) { return cx + ',' + cz; }
  hash2(x, z, s = 0) {
    let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(this.seed + s, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
  }
  fbm(n, x, z, oct) { let a = 1, f = 1, s = 0, t = 0; for (let i = 0; i < oct; i++) { s += n(x * f, z * f) * a; t += a; a *= 0.5; f *= 2; } return s / t; }
  heightAt(x, z) {
    if (this.type === 'flat') return Math.max(3, Math.min(CH - 12, this.sea + 4));
    const c = this.fbm(this.n1, x / 240, z / 240, 3);
    const hills = this.fbm(this.n2, x / 55, z / 55, 4);
    const ridge = 1 - Math.abs(this.n3(x / 130, z / 130));
    let h;
    if (this.type === 'amplified') {
      h = 22 + c * 28 + hills * 10 + Math.max(0, c) * ridge * ridge * 48;
      h += (this.sea - SEA);
    } else if (this.type === 'islands') {
      const land = c + hills * 0.25;
      if (land < 0.05) h = this.sea - 8 + land * 10;
      else h = this.sea + 2 + (land - 0.05) * 28 + Math.max(0, c) * ridge * ridge * 18;
    } else {
      h = 26 + c * 22 + hills * 6 + Math.max(0, c) * ridge * ridge * 26;
      h += (this.sea - SEA);
    }
    return Math.max(3, Math.min(CH - 12, Math.floor(h)));
  }
  isCave(x, y, z) {
    const n = this.n1(x / 18, z / 18);
    const m = this.n2(x / 14, y / 10);
    const p = this.n3(z / 14, y / 10);
    const v = Math.abs(n) * 0.45 + Math.abs(m) * 0.35 + Math.abs(p) * 0.35;
    return v < 0.22 + (y / CH) * 0.05;
  }
  getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }
  getBlock(x, y, z) {
    if (y < 0) return DEEPSTONE; if (y >= CH) return AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(this.key(cx, cz)); if (!c) return AIR;
    return c.data[idx(x - cx * CS, y, z - cz * CS)];
  }
  isLoaded(x, z) { return this.chunks.has(this.key(Math.floor(x / CS), Math.floor(z / CS))); }

  generate(cx, cz) {
    const data = new Uint8Array(CS * CS * CH);
    const bx = cx * CS, bz = cz * CS;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = bx + x, wz = bz + z; const h = this.heightAt(wx, wz);
      const beach = h <= this.sea + 1, snowy = h >= SNOWLINE;
      const top = Math.max(h, this.sea);
      for (let y = 0; y <= top; y++) {
        let id;
        if (y === 0) id = DEEPSTONE;
        else if (y < h - 3) id = y < 6 && this.hash2(wx, wz, y) < 0.5 ? DEEPSTONE : STONE;
        else if (y < h) id = beach ? SAND : snowy ? STONE : DIRT;
        else if (y === h) id = beach ? (h < this.sea - 4 ? DIRT : SAND) : snowy ? SNOW : GRASS;
        else id = WATER;
        data[idx(x, y, z)] = id;
      }
      if (this.caves && h > this.sea) {
        for (let y = 3; y < h - 2; y++) {
          if (!this.isCave(wx, y, wz)) continue;
          const i = idx(x, y, z);
          const id = data[i];
          if (id === STONE || id === DEEPSTONE || id === DIRT) data[i] = AIR;
        }
      }
    }
    // trees (deterministic per world column, so they span chunk borders seamlessly)
    for (let wz = bz - 2; wz < bz + CS + 2; wz++) for (let wx = bx - 2; wx < bx + CS + 2; wx++) {
      if (this.treeDensity <= 0 || this.hash2(wx, wz, 7) > this.treeDensity) continue;
      const forest = this.n2(wx / 90 + 50, wz / 90 + 50); if (forest < -0.15) continue;
      const h = this.heightAt(wx, wz); if (h <= this.sea + 1 || h >= SNOWLINE - 2) continue;
      const th = 4 + Math.floor(this.hash2(wx, wz, 9) * 3);
      const put = (x, y, z, id, onlyAir) => {
        const lx = x - bx, lz = z - bz; if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y >= CH) return;
        const i = idx(lx, y, lz); if (onlyAir && data[i] !== AIR) return; data[i] = id;
      };
      for (let dy = th - 2; dy <= th + 1; dy++) {
        const r = dy >= th ? 1 : 2;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && (r === 1 ? dy === th + 1 : this.hash2(wx + dx, wz + dz, dy) < 0.5)) continue;
          put(wx + dx, h + dy, wz + dz, LEAVES, true);
        }
      }
      for (let dy = 1; dy <= th; dy++) put(wx, h + dy, wz, LOG, false);
      put(wx, h, wz, DIRT, false);
    }
    const ed = this.editsByChunk.get(this.key(cx, cz));
    if (ed) for (const [i, id] of ed) data[i] = id;
    const chunk = { cx, cz, data, mesh: null, water: null, dirty: true };
    this.chunks.set(this.key(cx, cz), chunk);
    return chunk;
  }

  neighborsReady(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(this.key(cx + dx, cz + dz))) return false;
    return true;
  }

  meshChunk(c) {
    const solid = new Geo(), water = new Geo();
    const d = c.data, bx = c.cx * CS, bz = c.cz * CS;
    const get = (x, y, z) => {
      if (y < 0) return DEEPSTONE; if (y >= CH) return AIR;
      if (x >= 0 && x < CS && z >= 0 && z < CS) return d[idx(x, y, z)];
      return this.getBlock(bx + x, y, bz + z);
    };
    const op = (x, y, z) => (KIND[get(x, y, z)] === 0 ? 1 : 0);
    const ts = 1 / ATLAS_TILES, eps = 0.0008;
    const nb = [0, 0, 0], ao = [0, 0, 0, 0];
    for (let y = 0; y < CH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const b = d[idx(x, y, z)]; if (b === AIR) continue;
      const kind = KIND[b], bd = BLOCKS[b];
      const waterTop = kind === 2 && get(x, y + 1, z) !== WATER;
      for (let f = 0; f < 6; f++) {
        const F = FACES[f], dx = F.dir[0], dy = F.dir[1], dz = F.dir[2];
        const n = get(x + dx, y + dy, z + dz);
        if (n !== AIR) { const nk = KIND[n]; if (nk === 0 || n === b) continue; if (kind === 2 && nk !== 2 && dy !== 1) continue; }
        const geo = kind === 2 ? water : solid;
        const tile = dy === 1 ? bd.top : dy === -1 ? bd.bottom : bd.side;
        const u0 = (tile % ATLAS_TILES) * ts, v0 = 1 - (Math.floor(tile / ATLAS_TILES) + 1) * ts;
        const start = geo.pos.length / 3;
        const na = dx !== 0 ? 0 : dy !== 0 ? 1 : 2, ta = (na + 1) % 3, tb = (na + 2) % 3;
        for (let k = 0; k < 4; k++) {
          const cr = F.c[k];
          let py = y + cr[1];
          if (waterTop && cr[1] === 1) py -= 0.12;
          geo.pos.push(x + cr[0], py, z + cr[2]);
          geo.nor.push(dx, dy, dz);
          geo.uv.push(u0 + (cr[3] ? ts - eps : eps), v0 + (cr[4] ? ts - eps : eps));
          let l = 1;
          if (kind !== 2) {
            nb[0] = x + dx; nb[1] = y + dy; nb[2] = z + dz;
            const sa = cr[ta] ? 1 : -1, sb = cr[tb] ? 1 : -1;
            const p1 = nb.slice(); p1[ta] += sa;
            const p2 = nb.slice(); p2[tb] += sb;
            const p3 = nb.slice(); p3[ta] += sa; p3[tb] += sb;
            const s1 = op(p1[0], p1[1], p1[2]), s2 = op(p2[0], p2[1], p2[2]), s3 = op(p3[0], p3[1], p3[2]);
            const a = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
            ao[k] = a; l = AO_LEVEL[a];
          } else ao[k] = 3;
          geo.col.push(l, l, l);
        }
        if (ao[0] + ao[3] < ao[1] + ao[2]) geo.ind.push(start, start + 1, start + 3, start, start + 3, start + 2);
        else geo.ind.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
      }
    }
    this.disposeMeshes(c);
    const sg = solid.build(), wg = water.build();
    if (sg) { c.mesh = new THREE.Mesh(sg, this.mat.solid); c.mesh.position.set(bx, 0, bz); this.scene.add(c.mesh); }
    if (wg) { c.water = new THREE.Mesh(wg, this.mat.water); c.water.position.set(bx, 0, bz); c.water.renderOrder = 1; this.scene.add(c.water); }
    c.dirty = false;
  }
  disposeMeshes(c) {
    for (const k of ['mesh', 'water']) if (c[k]) { this.scene.remove(c[k]); c[k].geometry.dispose(); c[k] = null; }
  }
  unload(c) { this.disposeMeshes(c); this.chunks.delete(this.key(c.cx, c.cz)); }
  clearAll() { for (const c of [...this.chunks.values()]) this.unload(c); }

  setBlock(x, y, z, id, record = true) {
    if (y < 1 || y >= CH) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.getChunk(cx, cz); if (!c) return false;
    const lx = x - cx * CS, lz = z - cz * CS, i = idx(lx, y, lz);
    c.data[i] = id;
    if (record) {
      this.edits.set(x + ',' + y + ',' + z, id);
      const k = this.key(cx, cz); if (!this.editsByChunk.has(k)) this.editsByChunk.set(k, new Map());
      this.editsByChunk.get(k).set(i, id);
    }
    // remesh this chunk and any neighbour touching the changed block (AO/face culling)
    const touched = new Set();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.getChunk(Math.floor((x + dx) / CS), Math.floor((z + dz) / CS)); if (n) touched.add(n);
    }
    for (const n of touched) if (this.neighborsReady(n.cx, n.cz)) this.meshChunk(n); else n.dirty = true;
    return true;
  }
  loadEdits(list) {
    this.edits.clear(); this.editsByChunk.clear();
    for (const [x, y, z, id] of list) {
      this.edits.set(x + ',' + y + ',' + z, id);
      const cx = Math.floor(x / CS), cz = Math.floor(z / CS), k = this.key(cx, cz);
      if (!this.editsByChunk.has(k)) this.editsByChunk.set(k, new Map());
      this.editsByChunk.get(k).set(idx(x - cx * CS, y, z - cz * CS), id);
    }
  }
  editList() { return [...this.edits].map(([k, id]) => [...k.split(',').map(Number), id]); }

  // Voxel DDA raycast; returns first non-air, non-water block and the face normal hit
  raycast(o, dir, max) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = sx ? Math.abs(1 / dir.x) : Infinity, tdy = sy ? Math.abs(1 / dir.y) : Infinity, tdz = sz ? Math.abs(1 / dir.z) : Infinity;
    let tx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
    let ty = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
    let tz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
    let face = [0, 0, 0], t = 0;
    while (t <= max) {
      const b = this.getBlock(x, y, z);
      if (b !== AIR && b !== WATER) return { x, y, z, face, block: b, dist: t };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; face = [-sx, 0, 0]; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; face = [0, -sy, 0]; }
      else { z += sz; t = tz; tz += tdz; face = [0, 0, -sz]; }
    }
    return null;
  }
}
