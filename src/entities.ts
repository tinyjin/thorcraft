// Mobs, item drops, primed TNT, gems and particles.

import { B, BLOCKS, Item, iconColor } from './blocks';
import { Body, rayBox, stepBody } from './physics';
import { Player } from './player';
import { Renderer3D } from './renderer';
import { CS, SEA, World } from './world';
import { hash3 } from './math';

type V3 = readonly [number, number, number];
type RGB = readonly [number, number, number];

interface Part {
  pivot: V3; o: V3; s: V3; rgb: RGB;
  /** Which animation channel drives the X rotation of this part. */
  anim?: 'legA' | 'legB' | 'armA' | 'armB' | 'head';
  face?: ReadonlyArray<readonly number[]>;
}

const DARK = [28, 28, 32] as const;
const smile = [[0.18, 0.32, 0.36, 0.56, ...DARK], [0.64, 0.32, 0.82, 0.56, ...DARK], [0.28, 0.7, 0.72, 0.8, ...DARK], [0.2, 0.62, 0.3, 0.72, ...DARK], [0.7, 0.62, 0.8, 0.72, ...DARK]];
const zombieFace = [[0.16, 0.34, 0.4, 0.52, 10, 10, 10], [0.6, 0.34, 0.84, 0.52, 10, 10, 10], [0.36, 0.7, 0.64, 0.86, 30, 60, 30]];
const pigFace = [[0.08, 0.2, 0.26, 0.4, ...DARK], [0.74, 0.2, 0.92, 0.4, ...DARK]];
const sheepFace = [[0.1, 0.25, 0.3, 0.45, ...DARK], [0.7, 0.25, 0.9, 0.45, ...DARK], [0.38, 0.62, 0.62, 0.78, 230, 150, 150]];

function humanoid(head: RGB, torso: RGB, arms: RGB, legs: RGB, face: ReadonlyArray<readonly number[]>): Part[] {
  return [
    { pivot: [-0.125, 0.7, 0], o: [-0.12, -0.7, -0.12], s: [0.24, 0.7, 0.24], rgb: legs, anim: 'legA' },
    { pivot: [0.125, 0.7, 0], o: [-0.12, -0.7, -0.12], s: [0.24, 0.7, 0.24], rgb: legs, anim: 'legB' },
    { pivot: [0, 0.7, 0], o: [-0.25, 0, -0.125], s: [0.5, 0.68, 0.25], rgb: torso },
    { pivot: [-0.365, 1.36, 0], o: [-0.11, -0.66, -0.11], s: [0.22, 0.68, 0.22], rgb: arms, anim: 'armA' },
    { pivot: [0.365, 1.36, 0], o: [-0.11, -0.66, -0.11], s: [0.22, 0.68, 0.22], rgb: arms, anim: 'armB' },
    { pivot: [0, 1.38, 0], o: [-0.22, 0, -0.22], s: [0.44, 0.44, 0.44], rgb: head, anim: 'head', face },
  ];
}

function quadruped(body: RGB, headC: RGB, leg: RGB, face: ReadonlyArray<readonly number[]>, fat: number): Part[] {
  const w = 0.27 + fat, parts: Part[] = [
    { pivot: [0, 0.3, 0], o: [-w, 0, -0.45], s: [w * 2, 0.45 + fat, 0.9], rgb: body },
    { pivot: [0, 0.44, -0.45], o: [-0.2, 0, -0.34], s: [0.4, 0.4, 0.36], rgb: headC, anim: 'head', face },
  ];
  const lx = 0.17, lz = 0.3;
  parts.push({ pivot: [-lx, 0.3, -lz], o: [-0.09, -0.3, -0.09], s: [0.18, 0.3, 0.18], rgb: leg, anim: 'legA' });
  parts.push({ pivot: [lx, 0.3, -lz], o: [-0.09, -0.3, -0.09], s: [0.18, 0.3, 0.18], rgb: leg, anim: 'legB' });
  parts.push({ pivot: [-lx, 0.3, lz], o: [-0.09, -0.3, -0.09], s: [0.18, 0.3, 0.18], rgb: leg, anim: 'legB' });
  parts.push({ pivot: [lx, 0.3, lz], o: [-0.09, -0.3, -0.09], s: [0.18, 0.3, 0.18], rgb: leg, anim: 'legA' });
  return parts;
}

export type MobKind = 'pig' | 'sheep' | 'zombie';

export const MODELS = {
  avatar: humanoid([245, 205, 48], [13, 105, 172], [245, 205, 48], [75, 151, 75], smile),
  zombie: humanoid([86, 140, 72], [42, 120, 128], [86, 140, 72], [64, 58, 130], zombieFace),
  pig: quadruped([236, 150, 160], [240, 160, 170], [216, 128, 140], pigFace, 0),
  sheep: quadruped([238, 238, 232], [196, 176, 156], [180, 160, 140], sheepFace, 0.06),
};

const MOB_INFO: Record<MobKind, { hw: number; h: number; hp: number; speed: number; hostile: boolean }> = {
  pig: { hw: 0.4, h: 0.85, hp: 8, speed: 1.4, hostile: false },
  sheep: { hw: 0.42, h: 0.95, hp: 8, speed: 1.3, hostile: false },
  zombie: { hw: 0.3, h: 1.8, hp: 16, speed: 2.5, hostile: true },
};

export class Mob implements Body {
  vx = 0; vy = 0; vz = 0; hw: number; h: number;
  onGround = false; inWater = false; hitWall = false;
  yaw = Math.random() * 6.28; hp: number; hurt = 0; phase = 0;
  private heading = Math.random() * 6.28; private moveTimer = 0; private moving = false; private attackTimer = 0; burnTimer = 0;
  dead = false;

  constructor(public kind: MobKind, public x: number, public y: number, public z: number) {
    const info = MOB_INFO[kind];
    this.hw = info.hw; this.h = info.h; this.hp = info.hp;
  }

  update(world: World, player: Player, dt: number, night: number, em: EntityManager) {
    const info = MOB_INFO[this.kind];
    this.hurt = Math.max(0, this.hurt - dt);
    this.attackTimer -= dt;
    let speed = info.speed;
    const dx = player.x - this.x, dz = player.z - this.z, dy = player.y - this.y;
    const dist = Math.hypot(dx, dz);

    if (info.hostile && !player.creative && !player.dead && dist < 24 && Math.abs(dy) < 8) {
      this.heading = Math.atan2(-dx, -dz);
      this.moving = dist > 0.9;
      if (dist < 1.3 && Math.abs(dy) < 1.6 && this.attackTimer <= 0) {
        this.attackTimer = 1;
        player.damage(3);
        const k = 7 / (dist || 1);
        player.vx += dx * k; player.vz += dz * k; player.vy = Math.max(player.vy, 4.5);
      }
    } else if (!info.hostile && this.hurt > 0) {
      // Panic: run away from the player.
      this.heading = Math.atan2(dx, dz); this.moving = true; speed *= 2.4; this.moveTimer = 2;
    } else {
      this.moveTimer -= dt;
      if (this.moveTimer <= 0) {
        this.moveTimer = 1.5 + Math.random() * 4;
        this.moving = Math.random() < 0.6;
        this.heading = Math.random() * 6.28;
      }
    }

    // Zombies burn under the open daytime sky.
    if (info.hostile && night < 0.3 && this.y + this.h > world.topAt(Math.floor(this.x), Math.floor(this.z)) && !this.inWater) {
      this.burnTimer += dt;
      if (Math.random() < dt * 14) em.particle(this.x + (Math.random() - 0.5) * 0.5, this.y + Math.random() * 1.8, this.z + (Math.random() - 0.5) * 0.5, 0, 1.5, 0, [255, 150 + Math.random() * 80, 40], 0.5, 0.12, true);
      if (this.burnTimer > 1) { this.burnTimer = 0; this.damage(3, 0, 0, em); }
    }

    const tvx = this.moving ? -Math.sin(this.heading) * speed : 0, tvz = this.moving ? -Math.cos(this.heading) * speed : 0;
    const k = 1 - Math.pow(0.001, dt);
    this.vx += (tvx - this.vx) * k; this.vz += (tvz - this.vz) * k;
    if (this.moving) {
      // Turn smoothly toward the heading.
      let d = this.heading - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 7);
    }
    if (this.inWater) this.vy = Math.min(this.vy + 28 * dt, 2.5);
    stepBody(world, this, dt, 27);
    if (this.hitWall && this.onGround && this.moving) this.vy = 8;
    this.phase += Math.hypot(this.vx, this.vz) * dt * 2.4;
    if (this.y < -10) this.dead = true;
  }

  damage(amount: number, kx: number, kz: number, em: EntityManager) {
    this.hp -= amount;
    this.hurt = 0.4;
    this.vx += kx * 7; this.vz += kz * 7; this.vy = Math.max(this.vy, 5);
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      const c = MODELS[this.kind][0].rgb;
      for (let i = 0; i < 14; i++) em.particle(this.x, this.y + this.h * 0.5, this.z, (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, c, 0.8, 0.14);
      if (this.kind === 'pig') em.drop(Item.PORK, 1 + Math.floor(Math.random() * 2), this.x, this.y + 0.4, this.z);
      else if (this.kind === 'sheep') em.drop(B.WOOL_WHITE, 1, this.x, this.y + 0.4, this.z);
      else if (Math.random() < 0.35) em.drop(Item.GEM, 1, this.x, this.y + 0.4, this.z);
    }
  }
}

class ItemDrop implements Body {
  vx: number; vy: number; vz: number; hw = 0.125; h = 0.25;
  onGround = false; inWater = false; hitWall = false; age = 0; dead = false;
  constructor(public id: number, public count: number, public x: number, public y: number, public z: number) {
    this.vx = (Math.random() - 0.5) * 2.4; this.vy = 3 + Math.random() * 1.5; this.vz = (Math.random() - 0.5) * 2.4;
  }
}

class PrimedTNT implements Body {
  vx = 0; vy = 4; vz = 0; hw = 0.49; h = 0.98; onGround = false; inWater = false; hitWall = false; dead = false;
  constructor(public x: number, public y: number, public z: number, public fuse: number) {}
}

interface Gem { x: number; y: number; z: number; key: string }
interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; rgb: RGB; glow: boolean }

export interface EntityHooks {
  pickup(id: number, count: number): number; // returns how many could not be taken
  sound(name: 'pop' | 'gem' | 'explode' | 'fuse' | 'hit'): void;
  shake(amount: number): void;
  gemCollected(): void;
}

export class EntityManager {
  mobs: Mob[] = [];
  drops: ItemDrop[] = [];
  tnts: PrimedTNT[] = [];
  particles: Particle[] = [];
  gems = new Map<string, Gem>();
  collectedGems = new Set<string>();
  private spawnTimer = 2;
  private gemScan = 0;

  constructor(private world: World, private hooks: EntityHooks) {}

  particle(x: number, y: number, z: number, vx: number, vy: number, vz: number, rgb: RGB, life: number, size: number, glow = false) {
    if (this.particles.length > 600) return;
    this.particles.push({ x, y, z, vx, vy, vz, life, max: life, size, rgb, glow });
  }

  blockBurst(bx: number, by: number, bz: number, id: number, n = 14) {
    const c = BLOCKS[id].side, t = BLOCKS[id].top;
    for (let i = 0; i < n; i++) {
      this.particle(bx + Math.random(), by + Math.random(), bz + Math.random(), (Math.random() - 0.5) * 3, Math.random() * 3.5, (Math.random() - 0.5) * 3, Math.random() < 0.5 ? c : t, 0.5 + Math.random() * 0.5, 0.1 + Math.random() * 0.08);
    }
  }

  drop(id: number, count: number, x: number, y: number, z: number) {
    if (id === 0 || this.drops.length > 150) return;
    this.drops.push(new ItemDrop(id, count, x, y, z));
  }

  prime(bx: number, by: number, bz: number, fuse = 3) {
    this.world.setBlock(bx, by, bz, B.AIR);
    this.tnts.push(new PrimedTNT(bx + 0.5, by, bz + 0.5, fuse));
    this.hooks.sound('fuse');
  }

  explode(x: number, y: number, z: number, power: number, player: Player) {
    const w = this.world;
    const r = Math.ceil(power);
    let dropped = 0;
    for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
      const d = Math.hypot(dx, dy, dz);
      if (d > power + (hash3(bx, by, bz, 99) - 0.5) * 1.2) continue;
      const id = w.getBlock(bx, by, bz);
      if (id === B.AIR || id === B.BEDROCK || id === B.WATER) continue;
      if (id === B.TNT) { this.prime(bx, by, bz, 0.25 + Math.random() * 0.5); continue; }
      w.setBlock(bx, by, bz, B.AIR);
      if (dropped < 10 && Math.random() < 0.18) { dropped++; this.drop(BLOCKS[id].drop ?? id, 1, bx + 0.5, by + 0.3, bz + 0.5); }
    }
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * 6.28, e = Math.random() * 3.14 - 1.57, s = 3 + Math.random() * 9;
      const hot = Math.random();
      this.particle(x, y + 0.5, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s,
        hot < 0.4 ? [255, 200, 60] : hot < 0.7 ? [255, 120, 30] : [90, 90, 90], 0.5 + Math.random() * 0.9, 0.2 + Math.random() * 0.3, hot < 0.7);
    }
    const hurtBody = (b: { x: number; y: number; z: number; vx: number; vy: number; vz: number }, apply: (dmg: number) => void) => {
      const ddx = b.x - x, ddy = b.y + 0.8 - y, ddz = b.z - z, d = Math.hypot(ddx, ddy, ddz);
      if (d > power * 2) return;
      const f = 1 - d / (power * 2);
      const k = (f * 16) / (d || 1);
      b.vx += ddx * k; b.vy += ddy * k + f * 5; b.vz += ddz * k;
      apply(Math.floor(f * 17));
    };
    hurtBody(player, (dmg) => player.damage(dmg, true));
    for (const m of this.mobs) hurtBody(m, (dmg) => m.damage(dmg, 0, 0, this));
    const pd = Math.hypot(player.x - x, player.y - y, player.z - z);
    this.hooks.shake(Math.max(0, 1 - pd / 30));
    this.hooks.sound('explode');
  }

  /** Nearest mob hit by a ray, within maxDist. */
  pick(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): { mob: Mob; dist: number } | null {
    let best: { mob: Mob; dist: number } | null = null;
    for (const m of this.mobs) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, m.x - m.hw - 0.1, m.y, m.z - m.hw - 0.1, m.x + m.hw + 0.1, m.y + m.h, m.z + m.hw + 0.1);
      if (t >= 0 && t <= maxDist && (!best || t < best.dist)) best = { mob: m, dist: t };
    }
    return best;
  }

  private trySpawn(player: Player, night: number) {
    const w = this.world;
    const hostile = night > 0.6 && Math.random() < 0.7;
    const cap = hostile ? 8 : 10;
    const count = this.mobs.filter((m) => (m.kind === 'zombie') === hostile).length;
    if (count >= cap) return;
    const a = Math.random() * 6.28, r = 18 + Math.random() * 22;
    const x = Math.floor(player.x + Math.cos(a) * r), z = Math.floor(player.z + Math.sin(a) * r);
    if (!w.hasChunk(x >> 4, z >> 4)) return;
    const y = w.surfaceY(x, z);
    const ground = w.getBlock(x, y - 1, z);
    if (y <= SEA || w.getBlock(x, y, z) !== B.AIR) return;
    if (hostile) {
      if (!BLOCKS[ground].solid || ground === B.LEAVES || ground === B.BIRCH_LEAVES) return;
      this.mobs.push(new Mob('zombie', x + 0.5, y, z + 0.5));
    } else {
      if (ground !== B.GRASS && ground !== B.SNOW) return;
      const kind: MobKind = Math.random() < 0.5 ? 'pig' : 'sheep';
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const ox = x + Math.floor(Math.random() * 5) - 2, oz = z + Math.floor(Math.random() * 5) - 2;
        this.mobs.push(new Mob(kind, ox + 0.5, w.surfaceY(ox, oz), oz + 0.5));
      }
    }
  }

  /** Gems are placed deterministically: at most one per chunk. */
  private scanGems(player: Player) {
    const pcx = Math.floor(player.x / CS), pcz = Math.floor(player.z / CS);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const cx = pcx + dx, cz = pcz + dz, key = cx + ',' + cz;
      if (this.gems.has(key) || this.collectedGems.has(key) || !this.world.hasChunk(cx, cz)) continue;
      if (hash3(cx, 3, cz, this.world.seed) > 0.4) continue;
      const x = cx * CS + Math.floor(hash3(cx, 4, cz, this.world.seed) * CS), z = cz * CS + Math.floor(hash3(cx, 5, cz, this.world.seed) * CS);
      const y = Math.max(this.world.surfaceY(x, z), SEA + 1) + 1.2;
      this.gems.set(key, { x: x + 0.5, y, z: z + 0.5, key });
    }
    for (const [k, g] of this.gems) if (Math.hypot(g.x - player.x, g.z - player.z) > 90) this.gems.delete(k);
  }

  update(dt: number, player: Player, night: number) {
    const w = this.world;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 1.2; this.trySpawn(player, night); }
    this.gemScan -= dt;
    if (this.gemScan <= 0) { this.gemScan = 1; this.scanGems(player); }

    for (const m of this.mobs) {
      const d = Math.hypot(m.x - player.x, m.z - player.z);
      if (d > 72 || !w.hasChunk(Math.floor(m.x) >> 4, Math.floor(m.z) >> 4)) { m.dead = true; continue; }
      m.update(w, player, dt, night, this);
    }
    this.mobs = this.mobs.filter((m) => !m.dead);

    for (const it of this.drops) {
      it.age += dt;
      const dx = player.x - it.x, dy = player.y + 0.8 - it.y, dz = player.z - it.z, d = Math.hypot(dx, dy, dz);
      if (it.age > 0.6 && d < 2.2 && !player.dead) {
        // Magnet toward the player
        it.vx += (dx / d) * 40 * dt; it.vy += (dy / d) * 40 * dt; it.vz += (dz / d) * 40 * dt;
        if (d < 0.9) {
          const left = this.hooks.pickup(it.id, it.count);
          if (left < it.count) this.hooks.sound('pop');
          it.count = left;
          if (left === 0) it.dead = true;
        }
      }
      if (it.onGround) { it.vx *= Math.pow(0.002, dt); it.vz *= Math.pow(0.002, dt); }
      stepBody(w, it, dt, 22);
      if (it.age > 180 || it.y < -10) it.dead = true;
    }
    this.drops = this.drops.filter((d) => !d.dead);

    for (const t of this.tnts) {
      t.fuse -= dt;
      if (t.onGround) { t.vx *= Math.pow(0.001, dt); t.vz *= Math.pow(0.001, dt); }
      stepBody(w, t, dt, 27);
      if (Math.random() < dt * 20) this.particle(t.x, t.y + 1.05, t.z, (Math.random() - 0.5) * 0.4, 1.2, (Math.random() - 0.5) * 0.4, [230, 230, 230], 0.6, 0.09);
      if (t.fuse <= 0) { t.dead = true; this.explode(t.x, t.y + 0.5, t.z, 4.2, player); }
    }
    this.tnts = this.tnts.filter((t) => !t.dead);

    for (const [k, g] of this.gems) {
      if (Math.hypot(g.x - player.x, g.y - (player.y + 0.9), g.z - player.z) < 1.3 && !player.dead) {
        this.gems.delete(k);
        this.collectedGems.add(k);
        this.hooks.gemCollected();
        this.hooks.sound('gem');
        for (let i = 0; i < 20; i++) this.particle(g.x, g.y, g.z, (Math.random() - 0.5) * 5, Math.random() * 5, (Math.random() - 0.5) * 5, [120, 240, 250], 0.7, 0.12, true);
      }
    }

    for (const p of this.particles) {
      p.life -= dt;
      p.vy -= (p.glow ? 3 : 16) * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (BLOCKS[w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))].solid) { p.vx *= 0.3; p.vz *= 0.3; p.vy = 0; }
      else { p.x = nx; p.y = ny; p.z = nz; }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private skyAt(x: number, y: number, z: number): number {
    const fx = Math.floor(x), fz = Math.floor(z);
    if (!this.world.hasChunk(fx >> 4, fz >> 4)) return 0;
    const top = this.world.topAt(fx, fz);
    return y >= top ? 0 : top - y <= 6 ? 1 : 2;
  }

  drawModel(r: Renderer3D, parts: Part[], x: number, y: number, z: number, yaw: number, phase: number, amp: number, headPitch: number, armPose: number, flash: number, armSwing = 0) {
    const sky = this.skyAt(x, y + 0.5, z);
    const sw = Math.sin(phase) * amp;
    for (const p of parts) {
      let swing = 0;
      if (p.anim === 'legA') swing = sw; else if (p.anim === 'legB') swing = -sw;
      else if (p.anim === 'armA') swing = armPose + -sw * 0.8; else if (p.anim === 'armB') swing = armPose + sw * 0.8 + armSwing;
      else if (p.anim === 'head') swing = headPitch;
      const c = flash > 0 ? ([Math.min(255, p.rgb[0] + 140), p.rgb[1] * 0.45, p.rgb[2] * 0.45] as const) : p.rgb;
      r.drawBox(x, y, z, yaw, p.pivot, p.o, p.s, swing, c, sky, 0, p.face);
    }
  }

  draw(r: Renderer3D, time: number) {
    for (const m of this.mobs) {
      const amp = Math.min(0.9, Math.hypot(m.vx, m.vz) * 0.35);
      this.drawModel(r, MODELS[m.kind], m.x, m.y, m.z, m.yaw, m.phase, amp, 0, m.kind === 'zombie' ? 1.45 : 0, m.hurt);
    }
    for (const it of this.drops) {
      const c = iconColor(it.id);
      const bobY = it.y + 0.12 + Math.sin(it.age * 3) * 0.06;
      r.drawBox(it.x, bobY, it.z, it.age * 1.8, [0, 0, 0], [-0.13, 0, -0.13], [0.26, 0.26, 0.26], 0, c, this.skyAt(it.x, it.y, it.z), it.id === Item.GEM ? 3 : 0);
    }
    for (const t of this.tnts) {
      const blink = Math.floor(t.fuse * 5) % 2 === 0;
      const s = 0.98 + (t.fuse < 0.4 ? (0.4 - t.fuse) * 0.6 : 0);
      r.drawBox(t.x, t.y, t.z, 0, [0, 0, 0], [-s / 2, 0, -s / 2], [s, s, s], 0, blink ? [255, 255, 255] : [200, 60, 48], 0, blink ? 3 : 0);
    }
    for (const g of this.gems.values()) {
      const y = g.y + Math.sin(time * 2 + g.x) * 0.15;
      r.drawBox(g.x, y, g.z, time * 1.6, [0, 0.3, 0], [-0.2, -0.2, -0.2], [0.4, 0.4, 0.4], 0.785, [92, 226, 232], 0, 3, undefined, 235, 0.615);
      r.drawBox(g.x, y, g.z, -time * 1.1, [0, 0.3, 0], [-0.11, -0.11, -0.11], [0.22, 0.22, 0.22], 0.4, [230, 255, 255], 0, 3);
    }
    for (const p of this.particles) {
      const a = Math.min(1, (p.life / p.max) * 2.5);
      r.drawBillboard(p.x, p.y, p.z, p.size, p.rgb, this.skyAt(p.x, p.y, p.z), p.glow ? 3 : 0, Math.floor(a * 255));
    }
  }
}
