// Generated structures: villages, the stronghold that holds the Void portal, and the set pieces of the Void.
// Everything is a pure function of the seed, planned per region and stamped into chunks as they generate, so a
// building that straddles chunk borders comes out identical no matter which chunk is generated first.

import { B } from './blocks';
import { hash3 } from './math';

/** Blocks of a structure in local coordinates: x, y, z, id quadruples. y = 0 is the floor layer. */
export interface Template { w: number; d: number; h: number; blocks: number[]; door: [number, number]; kind: BuildingKind }
export type BuildingKind = 'house' | 'bighouse' | 'smithy' | 'library' | 'farm' | 'well' | 'lamp';
export const JOBS = ['farmer', 'smith', 'librarian'] as const;
export type Job = (typeof JOBS)[number];

export interface Placed { x: number; y: number; z: number; w: number; d: number; h: number; kind: BuildingKind; blocks: number[]; door: [number, number, number]; job: Job | null }
export interface VillagePlan { key: string; cx: number; cy: number; cz: number; buildings: Placed[]; paths: number[] /* x, z pairs */; desert: boolean }

interface Palette { wall: number; corner: number; roof: number; floor: number; trim: number }
const WOOD: Palette = { wall: B.PLANKS, corner: B.LOG, roof: B.SPRUCE_PLANKS, floor: B.PLANKS, trim: B.COBBLE };
const SAND: Palette = { wall: B.SANDSTONE, corner: B.SANDSTONE, roof: B.BIRCH_PLANKS, floor: B.SANDSTONE, trim: B.STONE_BRICKS };

class Builder {
  blocks: number[] = [];
  constructor(public w: number, public d: number) {}
  set(x: number, y: number, z: number, id: number) { this.blocks.push(x, y, z, id); }
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id); }
  /** Hollow box: walls with corner posts, floor, and a stepped roof on top. */
  shell(p: Palette, wallH: number) {
    const { w, d } = this;
    this.fill(0, 0, 0, w - 1, 0, d - 1, p.floor);
    for (let y = 1; y <= wallH; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      const edgeX = x === 0 || x === w - 1, edgeZ = z === 0 || z === d - 1;
      if (edgeX || edgeZ) this.set(x, y, z, edgeX && edgeZ ? p.corner : p.wall); else this.set(x, y, z, B.AIR);
    }
    // Stepped roof, overhanging by one block, shrinking until it closes.
    for (let k = 0; ; k++) {
      const x0 = -1 + k, x1 = w - k, z0 = -1 + k, z1 = d - k;
      if (x0 > x1 || z0 > z1) break;
      this.fill(x0, wallH + 1 + k, z0, x1, wallH + 1 + k, z1, p.roof);
    }
  }
  door(x: number) { this.set(x, 1, 0, B.AIR); this.set(x, 2, 0, B.AIR); }
  window(x: number, z: number) { this.set(x, 2, z, B.GLASS); }
}

function makeTemplate(kind: BuildingKind, p: Palette, variant: number): Template {
  let b: Builder, h = 8, door: [number, number] = [2, 0];
  switch (kind) {
    case 'house': {
      b = new Builder(5, 5); b.shell(p, 3); b.door(2); door = [2, 0];
      b.window(0, 2); b.window(4, 2); b.window(2, 4);
      b.set(2, 3, 2, B.LANTERN); b.set(1, 1, 3, variant ? B.CRAFTING_TABLE : B.BOOKSHELF); b.set(3, 1, 3, B.WOOL_RED); b.set(3, 1, 2, B.WOOL_WHITE);
      break;
    }
    case 'bighouse': {
      b = new Builder(7, 6); b.shell(p, 4); b.door(3); door = [3, 0];
      for (const x of [1, 5]) { b.window(x, 0); b.window(x, 5); }
      b.window(0, 3); b.window(6, 3);
      b.set(3, 4, 3, B.LANTERN); b.set(1, 1, 4, B.CRAFTING_TABLE); b.set(2, 1, 4, B.FURNACE); b.set(5, 1, 4, B.WOOL_BLUE); b.set(5, 1, 3, B.WOOL_WHITE); b.set(4, 1, 4, B.BOOKSHELF);
      break;
    }
    case 'smithy': {
      const stone: Palette = { ...p, wall: B.COBBLE, corner: B.STONE_BRICKS, floor: B.STONE_BRICKS };
      b = new Builder(7, 6); b.shell(stone, 3); b.door(2); door = [2, 0];
      // Open forge porch on the right half of the front.
      b.fill(4, 1, 0, 5, 3, 0, B.AIR);
      b.set(5, 1, 4, B.FURNACE); b.set(4, 1, 4, B.FURNACE); b.set(5, 1, 2, B.IRON_BLOCK); b.set(1, 1, 4, B.CRAFTING_TABLE);
      b.set(3, 3, 3, B.LANTERN); b.window(0, 3); b.set(3, 1, 4, B.MAGMA);
      break;
    }
    case 'library': {
      const stone: Palette = { ...p, wall: B.STONE_BRICKS, corner: p.corner, floor: p.floor };
      b = new Builder(6, 7); b.shell(stone, 4); b.door(2); door = [2, 0];
      for (let z = 2; z <= 5; z++) { b.set(1, 1, z, B.BOOKSHELF); b.set(1, 2, z, B.BOOKSHELF); b.set(4, 1, z, B.BOOKSHELF); b.set(4, 2, z, B.BOOKSHELF); }
      b.window(0, 1); b.window(5, 1); b.window(3, 6); b.set(2, 4, 3, B.LANTERN); b.set(3, 1, 5, B.CRAFTING_TABLE);
      break;
    }
    case 'farm': {
      b = new Builder(7, 9); h = 3; door = [3, 0];
      b.fill(0, 0, 0, 6, 0, 8, B.DIRT);
      for (let z = 0; z < 9; z++) for (let x = 0; x < 7; x++) if (x === 0 || x === 6 || z === 0 || z === 8) b.set(x, 0, z, p.corner);
      b.fill(3, 0, 1, 3, 0, 7, B.WATER);
      for (let z = 1; z < 8; z++) for (const x of [1, 2, 4, 5]) b.set(x, 1, z, (x + z + variant) % 3 === 0 ? B.HAY : B.TALLGRASS);
      b.set(3, 0, 0, B.PATH);
      // The plot is open: clear what may be above it.
      b.fill(1, 2, 1, 5, 2, 7, B.AIR);
      break;
    }
    case 'well': {
      b = new Builder(4, 4); h = 5; door = [1, 0];
      b.fill(0, 0, 0, 3, 0, 3, p.trim); b.fill(0, 1, 0, 3, 1, 3, p.trim); b.fill(1, 0, 1, 2, 1, 2, B.WATER);
      b.fill(1, -2, 1, 2, -1, 2, B.WATER);
      for (const [x, z] of [[0, 0], [3, 0], [0, 3], [3, 3]]) { b.set(x, 2, z, p.corner); b.set(x, 3, z, p.corner); }
      b.fill(0, 4, 0, 3, 4, 3, p.roof); b.set(1, 3, 1, B.LANTERN);
      break;
    }
    default: {
      b = new Builder(1, 1); h = 4; door = [0, 0];
      b.set(0, 0, 0, p.trim); b.set(0, 1, 0, p.corner); b.set(0, 2, 0, p.corner); b.set(0, 3, 0, B.LANTERN);
    }
  }
  return { w: b.w, d: b.d, h, blocks: b.blocks, door, kind };
}

/** Rotates a template by quarter turns so its door can face the village center. */
function rotate(t: Template, turns: number): Template {
  let cur = t;
  for (let i = 0; i < (turns & 3); i++) {
    const out: number[] = [];
    for (let k = 0; k < cur.blocks.length; k += 4) out.push(cur.d - 1 - cur.blocks[k + 2], cur.blocks[k + 1], cur.blocks[k], cur.blocks[k + 3]);
    cur = { ...cur, w: cur.d, d: cur.w, blocks: out, door: [cur.d - 1 - cur.door[1], cur.door[0]] };
  }
  return cur;
}

export const VILLAGE_REGION = 288;
/** Regions are centered on multiples of the region size, so the home region surrounds the world origin (and the spawn). */
export const villageRegion = (v: number) => Math.floor((v + VILLAGE_REGION / 2) / VILLAGE_REGION);

/**
 * Plans the village of one region, or returns null when the region has none. `height` and `buildable` are the
 * world's pure terrain functions, so planning never needs generated chunks.
 */
export function planVillage(seed: number, rx: number, rz: number, height: (x: number, z: number) => number, buildable: (x: number, z: number) => 0 | 1 | 2): VillagePlan | null {
  // The home region always gets a village so a new player finds one without a long trek.
  const home = rx === 0 && rz === 0;
  if (!home && hash3(rx, 31, rz, seed) > 0.5) return null;
  let cx = 0, cz = 0, kind: 0 | 1 | 2 = 0;
  for (let attempt = 0; attempt < (home ? 80 : 6) && !kind; attempt++) {
    // The home village stays within a short walk of the origin.
    const span = home ? 200 : VILLAGE_REGION - 100;
    cx = rx * VILLAGE_REGION + Math.floor((hash3(rx, 32 + attempt, rz, seed) - 0.5) * span);
    cz = rz * VILLAGE_REGION + Math.floor((hash3(rx, 72 + attempt, rz, seed) - 0.5) * span);
    kind = buildable(cx, cz);
    // Reject slopes: sample the area.
    if (kind) { const h0 = height(cx, cz); for (const [dx, dz] of [[14, 0], [-14, 0], [0, 14], [0, -14]]) if (Math.abs(height(cx + dx, cz + dz) - h0) > 4 || !buildable(cx + dx, cz + dz)) kind = 0; }
  }
  if (!kind) return null;
  const desert = kind === 2, pal = desert ? SAND : WOOD;
  const cy = height(cx, cz);
  const plan: VillagePlan = { key: rx + ',' + rz, cx, cy, cz, buildings: [], paths: [], desert };

  const place = (t: Template, x: number, z: number, job: Job | null): boolean => {
    const mx = x + (t.w >> 1), mz = z + (t.d >> 1);
    const y = height(mx, mz);
    if (!buildable(mx, mz) || Math.abs(y - cy) > 5) return false;
    for (const o of plan.buildings) if (x < o.x + o.w + 3 && x + t.w + 3 > o.x && z < o.z + o.d + 3 && z + t.d + 3 > o.z) return false;
    plan.buildings.push({ x, y, z, w: t.w, d: t.d, h: t.h, kind: t.kind, blocks: t.blocks, door: [x + t.door[0], y, z + t.door[1]], job });
    return true;
  };

  const well = makeTemplate('well', pal, 0);
  place(well, cx - 2, cz - 2, null);
  const kinds: BuildingKind[] = ['smithy', 'library', 'farm', 'house', 'bighouse', 'house', 'farm', 'house', 'bighouse'];
  const count = 5 + Math.floor(hash3(rx, 33, rz, seed) * 4);
  for (let i = 0, placed = 0; i < 40 && placed < count; i++) {
    const k = kinds[placed % kinds.length];
    const ang = hash3(rx + i, 34, rz, seed) * Math.PI * 2, rad = 10 + hash3(rx, 35, rz + i, seed) * 22;
    const px = cx + Math.cos(ang) * rad, pz = cz + Math.sin(ang) * rad;
    // Face the door toward the center: the template's door is on its -Z side.
    const turns = Math.abs(px - cx) > Math.abs(pz - cz) ? (px > cx ? 1 : 3) : pz > cz ? 0 : 2;
    const t = rotate(makeTemplate(k, pal, i & 1), turns);
    const job: Job | null = k === 'smithy' ? 'smith' : k === 'library' ? 'librarian' : k === 'farm' ? 'farmer' : JOBS[Math.floor(hash3(rx, 36 + i, rz, seed) * 3)];
    if (place(t, Math.round(px) - (t.w >> 1), Math.round(pz) - (t.d >> 1), job)) placed++;
  }
  for (let i = 0; i < 5; i++) {
    const ang = hash3(rx, 40 + i, rz, seed) * Math.PI * 2, rad = 7 + hash3(rx, 50 + i, rz, seed) * 16;
    place(makeTemplate('lamp', pal, 0), Math.round(cx + Math.cos(ang) * rad), Math.round(cz + Math.sin(ang) * rad), null);
  }

  // Paths: walk from just outside every door toward the well.
  const seen = new Set<string>();
  for (const b of plan.buildings) {
    if (b.kind === 'well' || b.kind === 'lamp') continue;
    let x = b.door[0], z = b.door[2];
    // Step out of the doorway first: the door sits on the wall that faces away from the building's middle.
    const mx = b.x + (b.w - 1) / 2, mz = b.z + (b.d - 1) / 2;
    if (Math.abs(x - mx) / b.w > Math.abs(z - mz) / b.d) x += Math.sign(x - mx); else z += Math.sign(z - mz);
    for (let n = 0; n < 80 && (Math.abs(x - cx) > 3 || Math.abs(z - cz) > 3); n++) {
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) { const k2 = (x + dx) + ',' + (z + dz); if (!seen.has(k2)) { seen.add(k2); plan.paths.push(x + dx, z + dz); } }
      if (Math.abs(x - cx) > Math.abs(z - cz)) x += Math.sign(cx - x); else z += Math.sign(cz - z);
    }
  }
  return plan;
}

// ---------------------------------------------------------------- stronghold

export interface Stronghold { x: number; z: number; roomY: number; portal: [number, number, number]; frames: [number, number, number][] }

/** One per world, a few hundred blocks out. The room sits deep underground; a stair tunnel leads up to a marker ruin. */
export function planStronghold(seed: number): Stronghold {
  const ang = hash3(11, 12, 13, seed) * Math.PI * 2, dist = 240 + hash3(14, 15, 16, seed) * 160;
  const x = Math.round(Math.cos(ang) * dist), z = Math.round(Math.sin(ang) * dist), roomY = 12;
  const frames: [number, number, number][] = [];
  for (let i = -1; i <= 1; i++) frames.push([x + i, roomY + 1, z - 2], [x + i, roomY + 1, z + 2], [x - 2, roomY + 1, z + i], [x + 2, roomY + 1, z + i]);
  return { x, z, roomY, portal: [x, roomY + 1, z], frames };
}

/** Block of the stronghold at a world position, or -1 when the position is outside of it. `surface` is the terrain height at the stair exit. */
export function strongholdBlock(s: Stronghold, wx: number, wy: number, wz: number, surface: number): number {
  const dx = wx - s.x, dz = wz - s.z, y = wy - s.roomY;
  if (Math.abs(dx) <= 7 && Math.abs(dz) <= 7 && y >= 0 && y <= 7) {
    const wall = Math.abs(dx) === 7 || Math.abs(dz) === 7 || y === 0 || y === 7;
    // Doorway to the stairs on the +X wall.
    if (dx === 7 && Math.abs(dz) <= 1 && y >= 1 && y <= 3) return B.AIR;
    if (wall) return (wx * 7 + wy * 13 + wz * 3) % 5 === 0 ? B.VOID_BRICKS : B.STONE_BRICKS;
    if (y === 1 && Math.max(Math.abs(dx), Math.abs(dz)) === 2 && Math.min(Math.abs(dx), Math.abs(dz)) <= 1) return B.PORTAL_FRAME;
    if (y === 1 && Math.abs(dx) <= 1 && Math.abs(dz) <= 1) return B.AIR;
    if (y === 6 && Math.abs(dx) === 4 && Math.abs(dz) === 4) return B.LANTERN;
    if (y === 1 && Math.abs(dx) === 6 && Math.abs(dz) === 6) return B.BOOKSHELF;
    return B.AIR;
  }
  // Stairs: one step up per block along +X, a 3 wide, 4 high tunnel.
  const t = dx - 8;
  if (t >= 0 && Math.abs(dz) <= 1) {
    const stepY = s.roomY + 1 + t;
    if (stepY > surface + 1) return -1;
    if (wy === stepY - 1) return B.STONE_BRICKS;
    if (wy >= stepY && wy <= stepY + 3) return wy === stepY + 3 && t % 6 === 0 && dz === 0 ? B.LANTERN : B.AIR;
  }
  // Marker ruin around the stair exit.
  const ex = s.x + 8 + (surface - s.roomY), rdx = wx - ex, ry = wy - surface;
  if (Math.abs(rdx) <= 3 && Math.abs(dz) <= 3 && ry >= 1 && ry <= 4 && Math.abs(rdx) === 3 && Math.abs(dz) === 3) return ry === 4 ? B.LANTERN : B.VOID_BRICKS;
  return -1;
}

// ---------------------------------------------------------------- Vector Void

export const VOID_PILLARS: ReadonlyArray<readonly [number, number, number]> = [0, 1, 2, 3, 4, 5].map((i) => [Math.round(Math.cos((i / 6) * Math.PI * 2) * 30), Math.round(Math.sin((i / 6) * Math.PI * 2) * 30), 14 + ((i * 5) % 9)] as const);
export const VOID_ARRIVAL: readonly [number, number, number] = [48, 0, 0];
