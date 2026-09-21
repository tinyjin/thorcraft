// Chunked voxel world: procedural generation, edits, face meshing.

import { B, BLOCKS, faceColorId, isOpaque } from './blocks';
import { Noise, clamp, hash3, smooth } from './math';

export const CS = 16; // chunk size (x, z)
export const WH = 64; // world height
export const SEA = 20;
/** Int32 stride of one face record: x, y, z, meta, colorId */
export const FACE_STRIDE = 5;
const LAMP_RADIUS = 7;

export const enum Biome { PLAINS, FOREST, DESERT, SNOW, MOUNTAIN }

export class Chunk {
  blocks = new Uint8Array(CS * CS * WH);
  /** Highest light-blocking block per column, -1 if none. */
  top = new Int8Array(CS * CS);
  faces: Int32Array = new Int32Array(0);
  faceCount = 0;
  dirty = true;
  meshed = false;
  lamps: number[] = []; // packed world coords x, y, z
  minY = 0; maxY = WH;

  constructor(public cx: number, public cz: number) {}
}

const key = (cx: number, cz: number) => cx + ',' + cz;
const idx = (x: number, y: number, z: number) => (y * CS + z) * CS + x;

export class World {
  chunks = new Map<string, Chunk>();
  /** Player edits, kept even when chunks unload: chunkKey -> (index -> block) */
  edits = new Map<string, Map<number, number>>();
  private nHeight: Noise; private nDetail: Noise; private nBiome: Noise; private nCave: Noise; private nCave2: Noise;
  private lastChunk: Chunk | null = null;

  constructor(public seed: number) {
    this.nHeight = new Noise(seed);
    this.nDetail = new Noise(seed + 101);
    this.nBiome = new Noise(seed + 202);
    this.nCave = new Noise(seed + 303);
    this.nCave2 = new Noise(seed + 404);
  }

  // ---------------------------------------------------------------- terrain functions

  biomeAt(x: number, z: number): Biome {
    const t = this.nBiome.fbm2(x / 320 + 40, z / 320 - 17, 2);
    const m = this.nBiome.fbm2(x / 260 - 90, z / 260 + 55, 2);
    if (this.mountainAt(x, z) > 0.55) return Biome.MOUNTAIN;
    if (t > 0.18) return Biome.DESERT;
    if (t < -0.2) return Biome.SNOW;
    return m > 0.02 ? Biome.FOREST : Biome.PLAINS;
  }

  private mountainAt(x: number, z: number) {
    return smooth(clamp((this.nHeight.fbm2(x / 380 + 300, z / 380 + 300, 2) - 0.08) * 3.2, 0, 1));
  }

  heightAt(x: number, z: number): number {
    const cont = this.nHeight.fbm2(x / 240, z / 240, 4);
    const hills = this.nDetail.fbm2(x / 56, z / 56, 4);
    const mt = this.mountainAt(x, z);
    const ridge = 1 - Math.abs(this.nDetail.fbm2(x / 90 + 500, z / 90 + 500, 3));
    let h = SEA + 3 + cont * 20 + hills * (5 + mt * 6) + mt * ridge * ridge * 30;
    // Flatten shorelines a bit so beaches appear.
    if (h > SEA - 2 && h < SEA + 3) h = SEA + (h - SEA) * 0.5 + 0.5;
    return clamp(Math.floor(h), 3, WH - 8);
  }

  private caveMouth(x: number, z: number) {
    return this.nCave2.n2(x / 70 + 900, z / 70 - 900);
  }

  /** Deterministic tree descriptor for a column, or null. Pure function of the seed. */
  treeAt(x: number, z: number): { h: number; birch: boolean; base: number } | null {
    const r = hash3(x, 7, z, this.seed);
    if (r > 0.03) return null;
    const biome = this.biomeAt(x, z);
    const density = biome === Biome.FOREST ? 0.03 : biome === Biome.PLAINS ? 0.0035 : biome === Biome.SNOW ? 0.004 : 0;
    if (r > density) return null;
    const base = this.heightAt(x, z);
    if (base <= SEA + 1 || base > 46) return null;
    if (this.caveMouth(x, z) > 0.33) return null;
    // Keep trunks apart.
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dz) && hash3(x + dx, 7, z + dz, this.seed) < r) return null;
    }
    const birch = hash3(x, 11, z, this.seed) < (biome === Biome.FOREST ? 0.3 : 0.1);
    return { h: 4 + Math.floor(hash3(x, 13, z, this.seed) * 3), birch, base };
  }

  // ---------------------------------------------------------------- generation

  private generate(c: Chunk) {
    const bl = c.blocks;
    const wx0 = c.cx * CS, wz0 = c.cz * CS;
    const seed = this.seed;

    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = wx0 + x, wz = wz0 + z;
      const h = this.heightAt(wx, wz);
      const biome = this.biomeAt(wx, wz);
      const mouth = this.caveMouth(wx, wz) > 0.4;
      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id: number = B.AIR;
        if (y === 0) id = B.BEDROCK;
        else if (y <= h) {
          const depth = h - y;
          if (biome === Biome.DESERT) id = depth < 3 ? B.SAND : depth < 7 ? B.SANDSTONE : B.STONE;
          else if (biome === Biome.MOUNTAIN && h > 40) id = depth === 0 && h > 48 ? B.SNOW : B.STONE;
          else if (h <= SEA + 1) id = depth < 3 ? B.SAND : B.STONE;
          else if (depth === 0) id = biome === Biome.SNOW ? B.SNOW : B.GRASS;
          else if (depth < 4) id = B.DIRT;
          else id = B.STONE;

          if (id === B.STONE) {
            const cluster = hash3(wx >> 1, y >> 1, wz >> 1, seed + 5);
            const speck = hash3(wx, y, wz, seed + 6);
            if (y < 12 && cluster < 0.012 && speck < 0.7) id = B.DIAMOND_ORE;
            else if (y < 26 && cluster > 0.012 && cluster < 0.035 && speck < 0.7) id = B.GOLD_ORE;
            else if (cluster > 0.95 && speck < 0.75) id = B.COAL_ORE;
          }

          // Caves: two thin noise sheets intersecting make tunnels, plus a few big rooms.
          if (y > 1 && (depth > 3 || mouth) && h > SEA + 1) {
            const a = this.nCave.n3(wx / 26, y / 17, wz / 26);
            const b2 = this.nCave2.n3(wx / 26 + 31, y / 17 + 31, wz / 26 + 31);
            if ((Math.abs(a) < 0.085 && Math.abs(b2) < 0.085) || a > 0.62) id = B.AIR;
          }
        } else if (y <= SEA) {
          id = y === SEA && biome === Biome.SNOW ? B.ICE : B.WATER;
        }
        bl[idx(x, y, z)] = id;
      }
    }

    // Trees and cacti, including ones rooted in neighboring chunks.
    for (let z = -3; z < CS + 3; z++) for (let x = -3; x < CS + 3; x++) {
      const wx = wx0 + x, wz = wz0 + z;
      const t = this.treeAt(wx, wz);
      if (t) {
        const log = t.birch ? B.BIRCH_LOG : B.LOG, leaf = t.birch ? B.BIRCH_LEAVES : B.LEAVES;
        const topY = t.base + t.h;
        for (let dy = -2; dy <= 1; dy++) {
          const rad = dy >= 0 ? 1 : 2;
          for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
            if (Math.abs(dx) === rad && Math.abs(dz) === rad && (dy === 1 || hash3(wx + dx, topY + dy, wz + dz, seed) < 0.5)) continue;
            this.genSet(c, x + dx, topY + dy, z + dz, leaf, false);
          }
        }
        for (let y = t.base + 1; y <= topY - 1; y++) this.genSet(c, x, y, z, log, true);
      } else if (x >= 0 && x < CS && z >= 0 && z < CS && hash3(wx, 17, wz, seed) < 0.006 && this.biomeAt(wx, wz) === Biome.DESERT) {
        const base = this.heightAt(wx, wz);
        if (base > SEA + 1 && bl[idx(x, base, z)] === B.SAND) {
          const ch = 2 + Math.floor(hash3(wx, 19, wz, seed) * 2);
          for (let y = base + 1; y <= base + ch; y++) this.genSet(c, x, y, z, B.CACTUS, true);
        }
      }
    }

    const e = this.edits.get(key(c.cx, c.cz));
    if (e) for (const [i, id] of e) bl[i] = id;

    c.lamps.length = 0;
    for (let i = 0; i < bl.length; i++) {
      if (bl[i] === B.LAMP) {
        const y = Math.floor(i / (CS * CS)), r = i - y * CS * CS, z = Math.floor(r / CS), x = r - z * CS;
        c.lamps.push(wx0 + x, y, wz0 + z);
      }
    }
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) this.recomputeTop(c, x, z);
  }

  private genSet(c: Chunk, x: number, y: number, z: number, id: number, force: boolean) {
    if (x < 0 || x >= CS || z < 0 || z >= CS || y < 0 || y >= WH) return;
    const i = idx(x, y, z);
    if (force || c.blocks[i] === B.AIR) c.blocks[i] = id;
  }

  private recomputeTop(c: Chunk, x: number, z: number) {
    let y = WH - 1;
    while (y >= 0 && !isOpaque(c.blocks[idx(x, y, z)])) y--;
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
    let y = WH - 1;
    while (y > 0 && !BLOCKS[this.getBlock(x, y, z)].solid) y--;
    return y + 1;
  }

  setBlock(x: number, y: number, z: number, id: number) {
    if (y < 1 || y >= WH) return;
    const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15;
    const c = this.chunkAt(cx, cz);
    const i = idx(lx, y, lz);
    const prev = c.blocks[i];
    if (prev === id) return;
    c.blocks[i] = id;
    const k = key(cx, cz);
    let e = this.edits.get(k);
    if (!e) this.edits.set(k, (e = new Map()));
    e.set(i, id);
    this.recomputeTop(c, lx, lz);

    const lampChange = prev === B.LAMP || id === B.LAMP;
    if (prev === B.LAMP) {
      for (let j = 0; j < c.lamps.length; j += 3) {
        if (c.lamps[j] === x && c.lamps[j + 1] === y && c.lamps[j + 2] === z) { c.lamps.splice(j, 3); break; }
      }
    }
    if (id === B.LAMP) c.lamps.push(x, y, z);

    // Shadows can reach across a chunk border, so be generous about what gets remeshed.
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const near = lampChange || ((dx === 0 || (dx < 0 ? lx <= 1 : lx >= 14)) && (dz === 0 || (dz < 0 ? lz <= 1 : lz >= 14)));
      if (!near) continue;
      const n = this.chunks.get(key(cx + dx, cz + dz));
      if (n) n.dirty = true;
    }
  }

  // ---------------------------------------------------------------- meshing

  /** Builds the visible face list of a chunk. Faces between two opaque blocks are dropped here. */
  mesh(c: Chunk) {
    const out: number[] = [];
    const bl = c.blocks;
    const wx0 = c.cx * CS, wz0 = c.cz * CS;
    const seed = this.seed;

    // Lamps from this chunk and its neighbors.
    const lamps: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = dx === 0 && dz === 0 ? c : this.chunks.get(key(c.cx + dx, c.cz + dz));
      if (n) for (const v of n.lamps) lamps.push(v);
    }

    let minY = WH, maxY = 0;
    for (let y = 0; y < WH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const id = bl[idx(x, y, z)];
      if (id === B.AIR) continue;
      const wx = wx0 + x, wz = wz0 + z;
      const self = BLOCKS[id];
      for (let dir = 0; dir < 6; dir++) {
        const nx = x + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
        const ny = y + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
        const nz = z + (dir === 4 ? 1 : dir === 5 ? -1 : 0);
        let nid: number;
        if (ny < 0) continue;
        if (ny >= WH) nid = B.AIR;
        else if (nx < 0 || nx >= CS || nz < 0 || nz >= CS) nid = this.getBlock(wx0 + nx, ny, wz0 + nz);
        else nid = bl[idx(nx, ny, nz)];
        if (nid === id && !self.opaque) continue; // water next to water, glass next to glass
        if (isOpaque(nid)) continue;
        if (self.liquid && dir !== 2 && nid !== B.AIR) continue;

        // Sky exposure of the cell this face looks into.
        const top = nx < 0 || nx >= CS || nz < 0 || nz >= CS ? this.topAt(wx0 + nx, wz0 + nz) : c.top[nz * CS + nx];
        const sky = ny > top ? 0 : top - ny <= 6 ? 1 : 2;

        let lamp = 0;
        if (self.emissive) lamp = 3;
        else if (lamps.length) {
          const ax = wx0 + nx, az = wz0 + nz;
          let best = 1e9;
          for (let j = 0; j < lamps.length; j += 3) {
            const ddx = lamps[j] - ax, ddy = lamps[j + 1] - ny, ddz = lamps[j + 2] - az;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 < best) best = d2;
          }
          if (best < LAMP_RADIUS * LAMP_RADIUS) lamp = best < 6 ? 3 : best < 20 ? 2 : 1;
        }

        const variant = hash3(wx, y, wz, seed + 77) < 0.5 ? 0 : 1;
        out.push(wx, y, wz, dir | (sky << 3) | (lamp << 5) | (id << 8), faceColorId(id, dir, sky, lamp, variant));
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    c.faces = Int32Array.from(out);
    c.faceCount = out.length / FACE_STRIDE;
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
