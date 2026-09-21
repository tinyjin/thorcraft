// Chunked voxel world: procedural generation, edits, block updates, face meshing.

import { B, BLOCKS, CUBE, DIR_U, DIR_V, LIGHT, LIQUID, OPAQUE, REPLACEABLE, SOLID } from './blocks';
import { Noise, clamp, hash3, mulberry32 } from './math';

export const CS = 16; // chunk size (x, z)
export const WH = 96; // world height
export const SEA = 32;
/** Int32 stride of one face record: x, y, z, meta, ao */
export const FACE_STRIDE = 5;
/** Int32 stride of one plant/torch record: x, y, z, meta */
export const PLANT_STRIDE = 4;
const LIGHT_RADIUS = 7;

export const enum Biome { OCEAN, BEACH, PLAINS, FOREST, DESERT, SNOWY, PEAKS }
export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Desert', 'Snowy', 'Peaks'];

export class Chunk {
  blocks = new Uint8Array(CS * CS * WH);
  /** Highest light-blocking block per column, -1 if none. */
  top = new Int8Array(CS * CS);
  faces: Int32Array = new Int32Array(0);
  faceCount = 0;
  plants: Int32Array = new Int32Array(0);
  plantCount = 0;
  dirty = true;
  meshed = false;
  lights: number[] = []; // world coords x, y, z
  minY = 0; maxY = WH;
  /** Highest non-air layer, bounds the meshing loop. */
  height = 0;

  constructor(public cx: number, public cz: number) {}
}

const key = (cx: number, cz: number) => cx + ',' + cz;
const idx = (x: number, y: number, z: number) => (y * CS + z) * CS + x;
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const SPLINE = [[-1, SEA - 22], [-0.45, SEA - 12], [-0.15, SEA - 3], [-0.05, SEA + 2], [0.3, SEA + 8], [1, SEA + 18]];
function spline(c: number) {
  if (c <= SPLINE[0][0]) return SPLINE[0][1];
  for (let i = 1; i < SPLINE.length; i++) {
    if (c <= SPLINE[i][0]) { const a = SPLINE[i - 1], b = SPLINE[i]; return a[1] + ((c - a[0]) / (b[0] - a[0])) * (b[1] - a[1]); }
  }
  return SPLINE[SPLINE.length - 1][1];
}

export interface Terrain { h: number; biome: Biome; temp: number; hum: number }

export class World {
  chunks = new Map<string, Chunk>();
  /** Player edits, kept even when chunks unload: chunkKey -> (index -> block) */
  edits = new Map<string, Map<number, number>>();
  /** Called when an unsupported plant or torch pops off. */
  onPop: ((x: number, y: number, z: number, id: number) => void) | null = null;
  private nC: Noise; private nM: Noise; private nR: Noise; private nD: Noise; private nT: Noise; private nH: Noise;
  private nCave1: Noise; private nCave2: Noise; private nCave3: Noise;
  private lastChunk: Chunk | null = null;
  private updates: number[] = [];
  private updateTimer = 0;
  private tmp: Terrain = { h: 0, biome: 0, temp: 0, hum: 0 };
  private tmp2: Terrain = { h: 0, biome: 0, temp: 0, hum: 0 };

  constructor(public seed: number) {
    this.nC = new Noise(seed + 1); this.nM = new Noise(seed + 2); this.nR = new Noise(seed + 3); this.nD = new Noise(seed + 4);
    this.nT = new Noise(seed + 5); this.nH = new Noise(seed + 6);
    this.nCave1 = new Noise(seed + 7); this.nCave2 = new Noise(seed + 8); this.nCave3 = new Noise(seed + 9);
  }

  // ---------------------------------------------------------------- terrain functions

  terrain(x: number, z: number, out: Terrain): Terrain {
    const c = this.nC.fbm2(x / 420, z / 420, 4) * 2.1;
    let h = spline(c);
    const m = this.nM.fbm2(x / 260, z / 260, 3) * 1.5;
    const mf = smoothstep(0.1, 0.55, m) * smoothstep(-0.1, 0.1, c);
    if (mf > 0) {
      const ridge = 1 - Math.abs(this.nR.fbm2(x / 110, z / 110, 4) * 1.4);
      h += mf * (ridge * ridge * 38 + 5);
    }
    h += this.nD.fbm2(x / 44, z / 44, 4) * 1.5 * (3.5 + mf * 5);
    h = Math.floor(clamp(h, 4, WH - 12));
    const temp = this.nT.fbm2(x / 520, z / 520, 2) * 2.2;
    const hum = this.nH.fbm2(x / 380, z / 380, 2) * 2.2;
    let biome: Biome;
    if (h <= SEA - 2) biome = Biome.OCEAN;
    else if (h <= SEA + 1) biome = Biome.BEACH;
    else if (h > SEA + 34) biome = Biome.PEAKS;
    else if (temp < -0.25) biome = Biome.SNOWY;
    else if (temp > 0.3 && hum < 0.1) biome = Biome.DESERT;
    else if (hum > 0.1) biome = Biome.FOREST;
    else biome = Biome.PLAINS;
    out.h = h; out.biome = biome; out.temp = temp; out.hum = hum;
    return out;
  }

  heightAt(x: number, z: number) { return this.terrain(x, z, this.tmp2).h; }
  biomeAt(x: number, z: number) { return this.terrain(x, z, this.tmp2).biome; }

  private isCave(x: number, y: number, z: number): boolean {
    if (y < 2) return false;
    const a = this.nCave1.n3(x / 34, y / 22, z / 34);
    if (a * a < 0.006) {
      const b = this.nCave2.n3(x / 34 + 31.7, y / 22, z / 34 - 17.3);
      if (a * a + b * b < 0.006) return true;
    }
    return y < SEA - 4 && this.nCave3.n3(x / 48, y / 28, z / 48) > 0.6;
  }

  // ---------------------------------------------------------------- generation

  private generate(c: Chunk) {
    const bl = c.blocks;
    const x0 = c.cx * CS, z0 = c.cz * CS;
    const seed = this.seed;
    const hs = new Int16Array(256), bs = new Uint8Array(256);
    const t = this.tmp;

    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = x0 + x, wz = z0 + z;
      this.terrain(wx, wz, t);
      const h = t.h, biome = t.biome;
      hs[z * CS + x] = h; bs[z * CS + x] = biome;
      let top: number, filler: number;
      switch (biome) {
        case Biome.OCEAN: top = filler = h < SEA - 8 && hash3(wx >> 2, 0, wz >> 2, seed + 40) < 0.4 ? B.GRAVEL : B.SAND; break;
        case Biome.BEACH: case Biome.DESERT: top = filler = B.SAND; break;
        case Biome.SNOWY: top = B.SNOWGRASS; filler = B.DIRT; break;
        case Biome.PEAKS: top = h > SEA + 42 ? B.SNOW : B.STONE; filler = B.STONE; break;
        default: top = B.GRASS; filler = B.DIRT;
      }
      const bed = hash3(wx, 1, wz, seed + 41);
      for (let y = 0; y <= h; y++) {
        let id: number;
        if (y === 0 || (y === 1 && bed < 0.6) || (y === 2 && bed < 0.25)) id = B.BEDROCK;
        else if (y === h) id = top;
        else if (y >= h - 3) id = filler;
        else if (biome === Biome.DESERT && y >= h - 7) id = B.SANDSTONE;
        else id = B.STONE;
        bl[idx(x, y, z)] = id;
      }
      for (let y = h + 1; y <= SEA; y++) bl[idx(x, y, z)] = y === SEA && t.temp < -0.25 ? B.ICE : B.WATER;

      const caveTop = h <= SEA + 1 ? h - 6 : h;
      for (let y = 2; y <= caveTop; y++) {
        const i = idx(x, y, z);
        if (bl[i] === B.BEDROCK) continue;
        if (this.isCave(wx, y, wz)) bl[i] = y <= 6 ? B.LAVA : B.AIR;
      }
    }

    // Ore veins: short random walks through stone.
    const rnd = mulberry32((hash3(c.cx, 2, c.cz, seed + 50) * 4294967296) | 0);
    const vein = (ore: number, count: number, size: number, yMin: number, yMax: number) => {
      for (let n = 0; n < count; n++) {
        let x = Math.floor(rnd() * 16), y = yMin + Math.floor(rnd() * (yMax - yMin)), z = Math.floor(rnd() * 16);
        for (let s = 0; s < size; s++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WH) { const i = idx(x, y, z); if (bl[i] === B.STONE) bl[i] = ore; }
          x += Math.floor(rnd() * 3) - 1; y += Math.floor(rnd() * 3) - 1; z += Math.floor(rnd() * 3) - 1;
        }
      }
    };
    vein(B.COAL_ORE, 12, 9, 5, 80);
    vein(B.IRON_ORE, 9, 7, 5, 44);
    vein(B.GOLD_ORE, 3, 6, 4, 24);
    vein(B.DIAMOND_ORE, 2, 5, 3, 13);
    vein(B.GRAVEL, 3, 18, 8, 50);
    vein(B.DIRT, 3, 18, 14, 56);

    // Ground cover
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const h = hs[z * CS + x], biome = bs[z * CS + x];
      if (h >= WH - 5 || h <= SEA) continue;
      const ground = bl[idx(x, h, z)];
      if (bl[idx(x, h + 1, z)] !== B.AIR) continue;
      const r = hash3(x0 + x, 3, z0 + z, seed + 60);
      if (ground === B.GRASS) {
        const dense = biome === Biome.PLAINS ? 0.1 : 0.045;
        if (r < dense) bl[idx(x, h + 1, z)] = B.TALLGRASS;
        else if (r < dense + 0.012) bl[idx(x, h + 1, z)] = B.FLOWER_RED;
        else if (r < dense + 0.024) bl[idx(x, h + 1, z)] = B.FLOWER_YELLOW;
      } else if (ground === B.SAND && biome === Biome.DESERT) {
        if (r < 0.006) {
          const n = 1 + Math.floor(hash3(x0 + x, 4, z0 + z, seed + 61) * 3);
          for (let k = 1; k <= n; k++) bl[idx(x, h + k, z)] = B.CACTUS;
        } else if (r < 0.016) bl[idx(x, h + 1, z)] = B.DEADBUSH;
      }
    }

    // Trees, including ones rooted in neighboring chunks whose canopy overlaps. One candidate per 4x4 cell.
    const set = (wx: number, y: number, wz: number, id: number, onlyAir: boolean) => {
      const x = wx - x0, z = wz - z0;
      if (x < 0 || x > 15 || z < 0 || z > 15 || y < 1 || y >= WH) return;
      const i = idx(x, y, z);
      if (onlyAir && bl[i] !== B.AIR && bl[i] !== B.TALLGRASS) return;
      bl[i] = id;
    };
    const t2 = this.tmp2;
    for (let ccz = c.cz - 1; ccz <= c.cz + 1; ccz++) for (let ccx = c.cx - 1; ccx <= c.cx + 1; ccx++) {
      for (let gz = 0; gz < 4; gz++) for (let gx = 0; gx < 4; gx++) {
        const cellX = ccx * 4 + gx, cellZ = ccz * 4 + gz;
        const r = hash3(cellX, 5, cellZ, seed + 70);
        if (r >= 0.5) continue;
        const tx = cellX * 4 + Math.floor(hash3(cellX, 6, cellZ, seed + 71) * 4);
        const tz = cellZ * 4 + Math.floor(hash3(cellX, 7, cellZ, seed + 72) * 4);
        if (tx < x0 - 3 || tx > x0 + 18 || tz < z0 - 3 || tz > z0 + 18) continue;
        this.terrain(tx, tz, t2);
        let density = 0;
        if (t2.biome === Biome.FOREST) density = 0.42;
        else if (t2.biome === Biome.PLAINS) density = 0.03;
        else if (t2.biome === Biome.SNOWY) density = t2.hum > 0.05 ? 0.28 : 0.02;
        if (r >= density || t2.h <= SEA + 1 || t2.h > WH - 20) continue;
        const th = t2.h, biome = t2.biome;
        if (this.isCave(tx, th, tz) || this.isCave(tx, th - 1, tz)) continue;
        const trnd = mulberry32((hash3(tx, 8, tz, seed + 73) * 4294967296) | 0);
        let kind = 0; // oak
        if (biome === Biome.SNOWY) kind = 2;
        else if (biome === Biome.FOREST && trnd() < 0.25) kind = 1;
        this.tree(kind, tx, th + 1, tz, trnd, set);
        set(tx, th, tz, B.DIRT, false);
      }
    }

    const e = this.edits.get(key(c.cx, c.cz));
    if (e) for (const [i, id] of e) bl[i] = id;

    c.lights.length = 0;
    let height = 0;
    for (let i = 0; i < bl.length; i++) {
      const id = bl[i];
      if (id === B.AIR) continue;
      const y = (i / (CS * CS)) | 0;
      if (y > height) height = y;
      if (LIGHT[id] && id !== B.LAVA) { const r = i - y * CS * CS, z = (r / CS) | 0; c.lights.push(x0 + r - z * CS, y, z0 + z); }
    }
    c.height = height;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) this.recomputeTop(c, x, z);
  }

  private tree(kind: number, x: number, y: number, z: number, rnd: () => number, set: (x: number, y: number, z: number, id: number, onlyAir: boolean) => void) {
    if (kind === 2) {
      const th = 6 + Math.floor(rnd() * 4);
      for (let i = 0; i < th; i++) set(x, y + i, z, B.SPRUCE_LOG, false);
      set(x, y + th, z, B.SPRUCE_LEAVES, true);
      set(x, y + th + 1, z, B.SPRUCE_LEAVES, true);
      let r = 1;
      for (let ly = y + th - 1; ly >= y + 2; ly--) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if ((dx || dz) && Math.abs(dx) + Math.abs(dz) <= r + (r > 1 ? 1 : 0)) set(x + dx, ly, z + dz, B.SPRUCE_LEAVES, true);
        }
        r = r === 1 ? 2 : r === 2 && y + th - ly > 4 && rnd() < 0.5 ? 3 : 1;
      }
      return;
    }
    const log = kind === 1 ? B.BIRCH_LOG : B.LOG, leaf = kind === 1 ? B.BIRCH_LEAVES : B.LEAVES;
    const th = (kind === 1 ? 5 : 4) + Math.floor(rnd() * 3);
    for (let ly = y + th - 3; ly <= y + th; ly++) {
      const r = ly >= y + th - 1 ? 1 : 2;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (r === 1 ? ly === y + th : rnd() < 0.5)) continue;
        set(x + dx, ly, z + dz, leaf, true);
      }
    }
    for (let i = 0; i < th; i++) set(x, y + i, z, log, false);
  }

  private recomputeTop(c: Chunk, x: number, z: number) {
    let y = Math.min(WH - 1, c.height);
    while (y >= 0 && !OPAQUE[c.blocks[idx(x, y, z)]]) y--;
    c.top[z * CS + x] = y;
  }

  // ---------------------------------------------------------------- access

  chunkAt(cx: number, cz: number): Chunk {
    const last = this.lastChunk;
    if (last && last.cx === cx && last.cz === cz) return last;
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(cx, cz);
      this.generate(c);
      this.chunks.set(k, c);
    }
    this.lastChunk = c;
    return c;
  }

  hasChunk(cx: number, cz: number) { return this.chunks.has(key(cx, cz)); }
  isLoaded(x: number, z: number) { return this.chunks.has(key(Math.floor(x) >> 4, Math.floor(z) >> 4)); }
  isMeshed(x: number, z: number) { const c = this.chunks.get(key(Math.floor(x) >> 4, Math.floor(z) >> 4)); return !!c && c.meshed; }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (y >= WH) return B.AIR;
    const c = this.chunkAt(x >> 4, z >> 4);
    return c.blocks[idx(x & 15, y, z & 15)];
  }

  topAt(x: number, z: number): number {
    return this.chunkAt(x >> 4, z >> 4).top[(z & 15) * CS + (x & 15)];
  }

  /** First free y above the terrain at a column (for spawning things). */
  surfaceY(x: number, z: number): number {
    let y = Math.min(WH - 1, this.chunkAt(x >> 4, z >> 4).height);
    while (y > 0 && !SOLID[this.getBlock(x, y, z)]) y--;
    return y + 1;
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (y < 1 || y >= WH) return false;
    const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15;
    const c = this.chunkAt(cx, cz);
    const i = idx(lx, y, lz);
    const prev = c.blocks[i];
    if (prev === id) return false;
    c.blocks[i] = id;
    if (y > c.height) c.height = y;
    const k = key(cx, cz);
    let e = this.edits.get(k);
    if (!e) this.edits.set(k, (e = new Map()));
    e.set(i, id);
    this.recomputeTop(c, lx, lz);

    const wasLight = LIGHT[prev] && prev !== B.LAVA, isLight = LIGHT[id] && id !== B.LAVA;
    if (wasLight) {
      for (let j = 0; j < c.lights.length; j += 3) {
        if (c.lights[j] === x && c.lights[j + 1] === y && c.lights[j + 2] === z) { c.lights.splice(j, 3); break; }
      }
    }
    if (isLight) c.lights.push(x, y, z);

    // Shadows, ambient occlusion and lights reach across chunk borders, so be generous about what gets remeshed.
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const near = wasLight || isLight || ((dx === 0 || (dx < 0 ? lx <= 1 : lx >= 14)) && (dz === 0 || (dz < 0 ? lz <= 1 : lz >= 14)));
      if (!near) continue;
      const n = this.chunks.get(key(cx + dx, cz + dz));
      if (n) n.dirty = true;
    }
    const u = this.updates;
    u.push(x, y, z, x + 1, y, z, x - 1, y, z, x, y + 1, z, x, y - 1, z, x, y, z + 1, x, y, z - 1);
    return true;
  }

  // ---------------------------------------------------------------- block updates

  /** Falling sand and gravel, spreading water, plants and torches that lost their support. */
  tick(dt: number) {
    this.updateTimer += dt;
    if (this.updateTimer < 0.12 || !this.updates.length) return;
    this.updateTimer = 0;
    const list = this.updates.splice(0, Math.min(this.updates.length, 900));
    for (let i = 0; i < list.length; i += 3) this.updateBlock(list[i], list[i + 1], list[i + 2]);
  }

  private updateBlock(x: number, y: number, z: number) {
    if (!this.isLoaded(x, z)) return;
    const id = this.getBlock(x, y, z);
    if (!id) return;
    const def = BLOCKS[id];
    const below = this.getBlock(x, y - 1, z);
    if (def.gravity) {
      if (y > 1 && REPLACEABLE[below]) {
        let ny = y - 1;
        while (ny > 1 && REPLACEABLE[this.getBlock(x, ny - 1, z)]) ny--;
        this.setBlock(x, y, z, B.AIR);
        this.setBlock(x, ny, z, id);
      }
      return;
    }
    if (def.render === 'cross' || def.render === 'torch' || id === B.CACTUS) {
      let ok: boolean;
      if (def.render === 'torch') ok = SOLID[below] === 1;
      else if (id === B.CACTUS) ok = below === B.SAND || below === B.CACTUS;
      else if (id === B.DEADBUSH) ok = below === B.SAND || below === B.DIRT || below === B.GRASS;
      else ok = below === B.GRASS || below === B.DIRT || below === B.SNOWGRASS;
      if (!ok) { this.setBlock(x, y, z, B.AIR); this.onPop?.(x, y, z, id); }
      return;
    }
    if (id === B.WATER) {
      const canFill = (b: number) => b === B.AIR || (REPLACEABLE[b] === 1 && !LIQUID[b]);
      if (y > 1 && canFill(below)) { this.setBlock(x, y - 1, z, B.WATER); return; }
      if (y <= SEA && (SOLID[below] || below === B.WATER)) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!this.isLoaded(x + dx, z + dz)) continue;
          if (canFill(this.getBlock(x + dx, y, z + dz))) this.setBlock(x + dx, y, z + dz, B.WATER);
        }
      }
    }
  }

  // ---------------------------------------------------------------- meshing

  /** Builds the visible face list of a chunk. Faces between two opaque blocks are dropped here. */
  mesh(c: Chunk) {
    const out: number[] = [], plants: number[] = [];
    const bl = c.blocks;
    const wx0 = c.cx * CS, wz0 = c.cz * CS;
    const get = (x: number, y: number, z: number): number => {
      if (y < 0) return B.BEDROCK;
      if (y >= WH) return B.AIR;
      if (x < 0 || x >= CS || z < 0 || z >= CS) return this.getBlock(wx0 + x, y, wz0 + z);
      return bl[idx(x, y, z)];
    };

    // Lights from this chunk and its neighbors.
    const lights: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = dx === 0 && dz === 0 ? c : this.chunks.get(key(c.cx + dx, c.cz + dz));
      if (n) for (const v of n.lights) lights.push(v);
    }
    const lampAt = (ax: number, ay: number, az: number): number => {
      let best = 1e9;
      for (let j = 0; j < lights.length; j += 3) {
        const ddx = lights[j] - ax, ddy = lights[j + 1] - ay, ddz = lights[j + 2] - az;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 < best) best = d2;
      }
      return best < LIGHT_RADIUS * LIGHT_RADIUS ? (best < 7 ? 3 : best < 22 ? 2 : 1) : 0;
    };
    const skyAt = (nx: number, ny: number, nz: number): number => {
      const top = nx < 0 || nx >= CS || nz < 0 || nz >= CS ? this.topAt(wx0 + nx, wz0 + nz) : c.top[nz * CS + nx];
      return ny > top ? 0 : top - ny <= 6 ? 1 : 2;
    };

    let minY = WH, maxY = 0;
    const yMax = Math.min(WH - 1, c.height);
    for (let y = 0; y <= yMax; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const id = bl[idx(x, y, z)];
      if (id === B.AIR) continue;
      if (!CUBE[id] && !LIQUID[id]) {
        plants.push(wx0 + x, y, wz0 + z, id | (skyAt(x, y, z) << 8) | ((LIGHT[id] ? 3 : lights.length ? lampAt(wx0 + x, y, wz0 + z) : 0) << 10));
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        continue;
      }
      const opaqueSelf = OPAQUE[id] === 1, liquid = LIQUID[id] === 1;
      for (let dir = 0; dir < 6; dir++) {
        const nx = x + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
        const ny = y + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
        const nz = z + (dir === 4 ? 1 : dir === 5 ? -1 : 0);
        if (ny < 0) continue;
        const nid = get(nx, ny, nz);
        if (nid === id && !opaqueSelf) continue; // water next to water, glass next to glass
        if (OPAQUE[nid]) continue;
        if (liquid && dir !== 2 && nid !== B.AIR && CUBE[nid]) continue;

        const sky = skyAt(nx, ny, nz);
        const lamp = LIGHT[id] ? 3 : lights.length ? lampAt(wx0 + nx, ny, wz0 + nz) : 0;

        // Ambient occlusion: which edges of this face touch a block that sticks out in front of it.
        let ao = 0;
        if (opaqueSelf) {
          const u = DIR_U[dir], v = DIR_V[dir];
          if (OPAQUE[get(nx - u[0], ny - u[1], nz - u[2])]) ao |= 1;
          if (OPAQUE[get(nx + u[0], ny + u[1], nz + u[2])]) ao |= 2;
          if (OPAQUE[get(nx - v[0], ny - v[1], nz - v[2])]) ao |= 4;
          if (OPAQUE[get(nx + v[0], ny + v[1], nz + v[2])]) ao |= 8;
        }
        out.push(wx0 + x, y, wz0 + z, dir | (sky << 3) | (lamp << 5) | (id << 8), ao);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    c.faces = Int32Array.from(out);
    c.faceCount = out.length / FACE_STRIDE;
    c.plants = Int32Array.from(plants);
    c.plantCount = plants.length / PLANT_STRIDE;
    c.minY = minY; c.maxY = maxY + 1;
    c.dirty = false;
    c.meshed = true;
  }

  /**
   * Streams chunks around the player. Generates/meshes a bounded amount per call and
   * returns true while there is still work queued.
   */
  stream(px: number, pz: number, radiusBlocks: number, budgetMs: number): boolean {
    const t0 = performance.now();
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    const R = Math.ceil(radiusBlocks / CS) + 1;
    let pending = false;
    // Spiral outwards so the nearest chunks appear first.
    for (let ring = 0; ring <= R; ring++) {
      for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const c = this.chunks.get(key(pcx + dx, pcz + dz));
        if (c && !c.dirty) continue;
        if (performance.now() - t0 > budgetMs) return true;
        this.mesh(c ?? this.chunkAt(pcx + dx, pcz + dz));
        pending = true;
      }
    }
    // Unload far chunks (edits are retained separately).
    if (!pending && this.chunks.size > (2 * R + 5) * (2 * R + 5)) {
      for (const [k, c] of this.chunks) {
        if (Math.abs(c.cx - pcx) > R + 3 || Math.abs(c.cz - pcz) > R + 3) this.chunks.delete(k);
      }
      this.lastChunk = null;
    }
    return pending;
  }

  // ---------------------------------------------------------------- persistence

  serializeEdits(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [k, m] of this.edits) {
      const arr: number[] = [];
      for (const [i, id] of m) arr.push(i, id);
      out[k] = arr;
    }
    return out;
  }

  loadEdits(data: Record<string, number[]>) {
    this.edits.clear();
    for (const k in data) {
      const m = new Map<number, number>();
      const arr = data[k];
      for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
      this.edits.set(k, m);
    }
  }
}
