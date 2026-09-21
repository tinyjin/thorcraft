// AABB vs. voxel grid collision, shared by the player and mobs.

import { B, BLOCKS } from './blocks';
import { World } from './world';

export interface Body {
  x: number; y: number; z: number; // feet center
  vx: number; vy: number; vz: number;
  hw: number; // half width
  h: number; // height
  onGround: boolean;
  inWater: boolean;
  hitWall: boolean;
}

const EPS = 1e-4;

function overlapsSolid(world: World, b: Body): boolean {
  const x0 = Math.floor(b.x - b.hw), x1 = Math.floor(b.x + b.hw - EPS);
  const y0 = Math.floor(b.y), y1 = Math.floor(b.y + b.h - EPS);
  const z0 = Math.floor(b.z - b.hw), z1 = Math.floor(b.z + b.hw - EPS);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (BLOCKS[world.getBlock(x, y, z)].solid) return true;
  }
  return false;
}

function moveAxis(world: World, b: Body, axis: 0 | 1 | 2, delta: number): boolean {
  if (delta === 0) return false;
  // Sub-step so fast bodies cannot tunnel through a block.
  const steps = Math.ceil(Math.abs(delta) / 0.4);
  const step = delta / steps;
  for (let i = 0; i < steps; i++) {
    if (axis === 0) b.x += step; else if (axis === 1) b.y += step; else b.z += step;
    if (!overlapsSolid(world, b)) continue;
    // Snap back to the face of the blocking cell.
    if (axis === 0) b.x = step > 0 ? Math.floor(b.x + b.hw) - b.hw - EPS : Math.floor(b.x - b.hw) + 1 + b.hw + EPS;
    else if (axis === 1) b.y = step > 0 ? Math.floor(b.y + b.h) - b.h - EPS : Math.floor(b.y) + 1 + EPS;
    else b.z = step > 0 ? Math.floor(b.z + b.hw) - b.hw - EPS : Math.floor(b.z - b.hw) + 1 + b.hw + EPS;
    return true;
  }
  return false;
}

/** Integrates one step. Returns the downward speed at the moment of landing (0 if none). */
export function stepBody(world: World, b: Body, dt: number, gravity: number): number {
  const feet = world.getBlock(Math.floor(b.x), Math.floor(b.y + 0.1), Math.floor(b.z));
  const waist = world.getBlock(Math.floor(b.x), Math.floor(b.y + b.h * 0.5), Math.floor(b.z));
  b.inWater = feet === B.WATER || waist === B.WATER;

  if (b.inWater) {
    b.vy -= gravity * 0.25 * dt;
    const drag = Math.pow(0.08, dt);
    b.vx *= drag; b.vz *= drag; b.vy *= Math.pow(0.12, dt);
  } else {
    b.vy -= gravity * dt;
  }
  if (b.vy < -55) b.vy = -55;

  b.hitWall = false;
  if (moveAxis(world, b, 0, b.vx * dt)) { b.vx = 0; b.hitWall = true; }
  if (moveAxis(world, b, 2, b.vz * dt)) { b.vz = 0; b.hitWall = true; }
  let impact = 0;
  const wasFalling = b.vy < 0;
  b.onGround = false;
  if (moveAxis(world, b, 1, b.vy * dt)) {
    if (wasFalling) { b.onGround = true; impact = -b.vy; }
    b.vy = 0;
  }
  return impact;
}

export interface RayHit { x: number; y: number; z: number; nx: number; ny: number; nz: number; dist: number; block: number }

/** Voxel traversal (Amanatides & Woo). Liquids are ignored. */
export function raycast(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): RayHit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tx = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
  let ty = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
  let tz = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 256; i++) {
    const id = world.getBlock(x, y, z);
    if (id !== B.AIR && !BLOCKS[id].liquid) return { x, y, z, nx, ny, nz, dist: t, block: id };
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
    if (t > maxDist) return null;
  }
  return null;
}

/** Ray vs. axis-aligned box, returns entry distance or -1. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  let t0 = 0, t1 = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [minX, minY, minZ], mx = [maxX, maxY, maxZ];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) return -1; continue; }
    let ta = (mn[a] - o[a]) / d[a], tb = (mx[a] - o[a]) / d[a];
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  return t0;
}
