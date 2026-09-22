// Mobs, item drops, primed TNT, gems and particles.

import { B, BLOCKS, CUBE, I, ITEMS, LIQUID, isBlockId } from './blocks';
import { Body, rayBox, stepBody } from './physics';
import { Player } from './player';
import { Renderer3D, blockTextures } from './renderer';
import { texture } from './textures';
import { VOID_PILLARS } from './structures';
import { CS, SEA, WH, World } from './world';
import { hash3 } from './math';
import { Lottie3D } from './lottie3d';

type V3 = readonly [number, number, number];
const ZERO: V3 = [0, 0, 0], WHITE: V3 = [255, 255, 255];
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
const cowFace = [[0.1, 0.22, 0.26, 0.46, ...DARK], [0.74, 0.22, 0.9, 0.46, ...DARK], [0.25, 0.6, 0.75, 0.95, 222, 222, 222], [0.34, 0.74, 0.44, 0.86, 60, 60, 60], [0.56, 0.74, 0.66, 0.86, 60, 60, 60], [0.38, 0, 0.62, 0.3, 238, 238, 238]];
const creeperFace = [[0.14, 0.24, 0.4, 0.5, 10, 10, 10], [0.6, 0.24, 0.86, 0.5, 10, 10, 10], [0.4, 0.5, 0.6, 0.86, 10, 10, 10], [0.28, 0.62, 0.4, 0.98, 10, 10, 10], [0.6, 0.62, 0.72, 0.98, 10, 10, 10]];
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

function quadruped(body: RGB, headC: RGB, leg: RGB, face: ReadonlyArray<readonly number[]>, fat: number, legH = 0.3, patch?: RGB): Part[] {
  const w = 0.27 + fat, parts: Part[] = [
    { pivot: [0, legH, 0], o: [-w, 0, -0.45], s: [w * 2, 0.45 + fat, 0.9], rgb: body },
    { pivot: [0, legH + 0.14, -0.45], o: [-0.2, 0, -0.34], s: [0.4, 0.4, 0.36], rgb: headC, anim: 'head', face },
  ];
  if (patch) parts.push({ pivot: [0, legH, 0], o: [-w - 0.01, 0.2, -0.2], s: [w * 2 + 0.02, 0.27 + fat, 0.36], rgb: patch });
  const lx = 0.17, lz = 0.3;
  parts.push({ pivot: [-lx, legH, -lz], o: [-0.09, -legH, -0.09], s: [0.18, legH, 0.18], rgb: leg, anim: 'legA' });
  parts.push({ pivot: [lx, legH, -lz], o: [-0.09, -legH, -0.09], s: [0.18, legH, 0.18], rgb: leg, anim: 'legB' });
  parts.push({ pivot: [-lx, legH, lz], o: [-0.09, -legH, -0.09], s: [0.18, legH, 0.18], rgb: leg, anim: 'legB' });
  parts.push({ pivot: [lx, legH, lz], o: [-0.09, -legH, -0.09], s: [0.18, legH, 0.18], rgb: leg, anim: 'legA' });
  return parts;
}

function creeperModel(): Part[] {
  const g: RGB = [95, 176, 79], parts: Part[] = [
    { pivot: [0, 0.4, 0], o: [-0.25, 0, -0.15], s: [0.5, 0.8, 0.3], rgb: g },
    { pivot: [0, 1.2, 0], o: [-0.25, 0, -0.25], s: [0.5, 0.5, 0.5], rgb: [108, 190, 90], anim: 'head', face: creeperFace },
  ];
  for (const [x, z, a] of [[-0.13, -0.22, 'legA'], [0.13, -0.22, 'legB'], [-0.13, 0.22, 'legB'], [0.13, 0.22, 'legA']] as [number, number, 'legA' | 'legB'][]) {
    parts.push({ pivot: [x, 0.4, z], o: [-0.12, -0.4, -0.12], s: [0.24, 0.4, 0.24], rgb: [80, 156, 68], anim: a });
  }
  return parts;
}

export type MobKind = 'pig' | 'sheep' | 'cow' | 'zombie' | 'creeper' | 'slime' | 'ghost' | 'lottie' | 'villager' | 'cinder' | 'ashling' | 'glitch' | 'outline';
/** Kinds drawn from a 2D Lottie projected into the world instead of a box model: kind -> [asset, height in blocks]. */
export const LOTTIE_MOBS: Partial<Record<MobKind, [string, number]>> = {
  slime: ['slime', 1.1], ghost: ['ghost', 1.9], lottie: ['', 1.6],
  villager: ['villager_farmer', 1.95], cinder: ['cinder', 1.5], glitch: ['glitch', 2.9], outline: ['outline', 8],
};
/** Mobs that ignore gravity and steer in three dimensions. */
const FLYING = new Set<MobKind>(['cinder', 'outline']);

export const MODELS: Record<string, Part[]> = {
  avatar: humanoid([245, 205, 48], [13, 105, 172], [245, 205, 48], [75, 151, 75], smile),
  zombie: humanoid([86, 140, 72], [42, 120, 128], [86, 140, 72], [64, 58, 130], zombieFace),
  pig: quadruped([236, 150, 160], [240, 160, 170], [216, 128, 140], pigFace, 0),
  sheep: quadruped([238, 238, 232], [196, 176, 156], [180, 160, 140], sheepFace, 0.06, 0.42),
  cow: quadruped([78, 56, 40], [78, 56, 40], [60, 44, 32], cowFace, 0.07, 0.5, [236, 236, 232]),
  creeper: creeperModel(),
  // A small figure of packed ash with glowing eyes: the box style suits it, it is a block creature.
  ashling: humanoid([96, 92, 94], [70, 66, 68], [96, 92, 94], [58, 54, 56], [[0.16, 0.36, 0.4, 0.56, 255, 150, 40], [0.6, 0.36, 0.84, 0.56, 255, 150, 40]]).map((p) => ({
    ...p, pivot: [p.pivot[0] * 0.58, p.pivot[1] * 0.58, p.pivot[2] * 0.58] as const, o: [p.o[0] * 0.58, p.o[1] * 0.58, p.o[2] * 0.58] as const, s: [p.s[0] * 0.58, p.s[1] * 0.58, p.s[2] * 0.58] as const,
  })),
};

const MOB_INFO: Record<MobKind, { hw: number; h: number; hp: number; speed: number; hostile: boolean; drops: [number, number, number][] }> = {
  pig: { hw: 0.4, h: 0.85, hp: 10, speed: 1.4, hostile: false, drops: [[I.PORK_RAW, 1, 3]] },
  sheep: { hw: 0.42, h: 1.1, hp: 8, speed: 1.3, hostile: false, drops: [[B.WOOL_WHITE, 1, 2]] },
  cow: { hw: 0.42, h: 1.3, hp: 10, speed: 1.1, hostile: false, drops: [[I.BEEF_RAW, 1, 3]] },
  zombie: { hw: 0.3, h: 1.8, hp: 20, speed: 2.5, hostile: true, drops: [[I.ROTTEN_FLESH, 0, 2]] },
  creeper: { hw: 0.3, h: 1.7, hp: 20, speed: 2.3, hostile: true, drops: [[I.GUNPOWDER, 1, 2]] },
  slime: { hw: 0.4, h: 0.9, hp: 8, speed: 1.6, hostile: false, drops: [[I.LOTTIE_STAR, 0, 1]] },
  ghost: { hw: 0.35, h: 1.7, hp: 14, speed: 2.1, hostile: true, drops: [[I.LOTTIE_STAR, 1, 1]] },
  lottie: { hw: 0.4, h: 1.5, hp: 10, speed: 1.2, hostile: false, drops: [] },
  villager: { hw: 0.3, h: 1.85, hp: 20, speed: 1.1, hostile: false, drops: [] },
  cinder: { hw: 0.45, h: 1.1, hp: 12, speed: 2.4, hostile: true, drops: [[B.GLOW_CRYSTAL, 0, 1], [I.GUNPOWDER, 0, 2]] },
  ashling: { hw: 0.2, h: 1.05, hp: 8, speed: 3.3, hostile: true, drops: [[B.ASH, 0, 2], [I.COAL, 0, 1]] },
  glitch: { hw: 0.3, h: 2.7, hp: 30, speed: 3.6, hostile: true, drops: [[I.DIAMOND, 0, 1], [I.VECTOR_EYE, 0, 1]] },
  outline: { hw: 2.2, h: 5, hp: 160, speed: 6, hostile: true, drops: [] },
};

export class Mob implements Body {
  vx = 0; vy = 0; vz = 0; hw: number; h: number;
  onGround = false; inWater = false; hitWall = false;
  yaw = Math.random() * 6.28; hp: number; hurt = 0; phase = 0;
  private heading = Math.random() * 6.28; private moveTimer = 0; private moving = false; private attackTimer = 0; burnTimer = 0;
  /** Asset name and height for the generic 'lottie' kind (any file summoned at runtime). */
  asset = ''; spriteH = 0;
  /** Animation clock of Lottie drawn mobs. */
  animT = Math.random() * 3;
  /** Villagers: trade profession, unique tag (village + house) and the door they belong to. */
  job = ''; tag = ''; homeX = 0; homeZ = 0;
  /** Glitch: set once the player has stared at it or hit it. */
  angry = false;
  private tpTimer = 2 + Math.random() * 4; private shootTimer = 1 + Math.random() * 2; private orbit = Math.random() * 6.28;
  /** Creeper countdown, explodes at 1.5 s. */
  fuse = 0;
  /** Seconds since a hostile mob noticed the player; drives the "!" billboard. -1 when idle. */
  alert = -1;
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

    if (FLYING.has(this.kind)) { this.updateFlying(world, player, dt, em); return; }
    // Villagers head indoors at night and when it rains.
    if (this.kind === 'villager') speed = this.villagerBrain(player, Math.max(night, em.rain * 0.75), dist, speed);
    if (this.kind === 'glitch') this.glitchBrain(world, player, dt, dist, em);

    const hunting = info.hostile && !player.creative && !player.dead && dist < 24 && Math.abs(dy) < 8 && (this.kind !== 'glitch' || this.angry);
    this.alert = hunting ? (this.alert < 0 ? 0 : this.alert + dt) : -1;
    if (hunting) {
      this.heading = Math.atan2(-dx, -dz);
      this.moving = dist > 0.9;
      if (this.kind === 'creeper') {
        if (dist < 2.8 && Math.abs(dy) < 2.5) { if (this.fuse === 0) em.hooks.sound('fuse'); this.fuse += dt; this.moving = false; }
        else if (this.fuse > 0) this.fuse = dist > 5 ? Math.max(0, this.fuse - dt) : this.fuse + dt;
        if (this.fuse >= 1.5) { this.dead = true; em.explode(this.x, this.y + 0.8, this.z, 3, player); return; }
      } else if (dist < 1.3 && Math.abs(dy) < 1.6 && this.attackTimer <= 0) {
        this.attackTimer = 1;
        player.damage(this.kind === 'glitch' ? 5 : this.kind === 'ashling' ? 2 : 3);
        const k = 7 / (dist || 1);
        player.vx += dx * k; player.vz += dz * k; player.vy = Math.max(player.vy, 4.5);
      }
    } else if (!info.hostile && this.hurt > 0 && this.kind !== 'villager') {
      // Panic: run away from the player.
      this.heading = Math.atan2(dx, dz); this.moving = true; speed *= 2.4; this.moveTimer = 2;
    } else if (this.kind === 'villager' && this.moveTimer > 50) {
      this.moveTimer = 51; // the brain is steering (going home, looking at the player)
    } else {
      this.fuse = Math.max(0, this.fuse - dt);
      this.moveTimer -= dt;
      if (this.moveTimer <= 0) {
        if (Math.random() < 0.06 && dist < 20) em.hooks.sound('mob');
        this.moveTimer = 1.5 + Math.random() * 4;
        this.moving = Math.random() < 0.6;
        this.heading = Math.random() * 6.28;
      }
    }

    // Zombies burn under the open daytime sky, unless rain clouds cover it.
    if (info.hostile && night < 0.3 && em.rain < 0.5 && this.y + this.h > world.topAt(Math.floor(this.x), Math.floor(this.z)) && !this.inWater) {
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
    // Lottie mobs animate faster while moving, and idle slowly.
    this.animT += dt * (0.45 + Math.min(1.2, Math.hypot(this.vx, this.vz) * 0.5));
    if (this.y < -10) this.dead = true;
  }

  /** Villagers stay near their door, face a nearby player, and go home at night. Returns the speed to use. */
  private villagerBrain(player: Player, night: number, dist: number, speed: number): number {
    const hx = this.homeX - this.x, hz = this.homeZ - this.z, hd = Math.hypot(hx, hz);
    if (dist < 3.2 && !player.dead) {
      this.heading = Math.atan2(-(player.x - this.x), -(player.z - this.z));
      this.yaw += Math.atan2(Math.sin(this.heading - this.yaw), Math.cos(this.heading - this.yaw)) * 0.2;
      this.moving = false; this.moveTimer = 51;
    } else if ((night > 0.6 && hd > 1.5) || hd > 16) {
      this.heading = Math.atan2(-hx, -hz); this.moving = true; this.moveTimer = 51;
      return speed * (hd > 16 ? 1.8 : 1.3);
    } else if (this.moveTimer > 50) { this.moveTimer = night > 0.6 ? 51 : 0; this.moving = false; }
    return speed;
  }

  /** Neutral until stared at; then it hunts and blinks around the player. */
  private glitchBrain(world: World, player: Player, dt: number, dist: number, em: EntityManager) {
    if (!this.angry && !player.creative && dist < 26) {
      const ex = this.x - player.x, ey = this.y + this.h * 0.8 - (player.y + 1.62), ez = this.z - player.z, el = Math.hypot(ex, ey, ez) || 1;
      const lx = -Math.sin(player.yaw) * Math.cos(player.pitch), ly = Math.sin(player.pitch), lz = -Math.cos(player.yaw) * Math.cos(player.pitch);
      if ((ex * lx + ey * ly + ez * lz) / el > 0.988) { this.angry = true; em.hooks.sound('mob'); }
    }
    this.tpTimer -= dt;
    if (this.tpTimer > 0) return;
    this.tpTimer = this.angry ? 2.5 + Math.random() * 2.5 : 6 + Math.random() * 8;
    if (this.angry && dist < 3) return;
    const a = Math.random() * 6.28, r = this.angry ? 3 + Math.random() * 4 : 4 + Math.random() * 10;
    const cx = this.angry ? player.x : this.x, cz = this.angry ? player.z : this.z;
    const nx = Math.floor(cx + Math.cos(a) * r), nz = Math.floor(cz + Math.sin(a) * r);
    if (!world.isLoaded(nx, nz)) return;
    const ny = world.floorAt(nx, Math.floor(this.angry ? player.y : this.y), nz, 8);
    if (ny < 0 || world.getBlock(nx, ny + 2, nz) !== B.AIR) return;
    for (let i = 0; i < 12; i++) em.particle(this.x, this.y + Math.random() * 2.6, this.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, [120, 255, 240], 0.5, 0.1, true);
    this.x = nx + 0.5; this.y = ny; this.z = nz + 0.5; this.vx = this.vz = 0;
    for (let i = 0; i < 12; i++) em.particle(this.x, this.y + Math.random() * 2.6, this.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, [150, 120, 255], 0.5, 0.1, true);
  }

  /** Cinders hover near the player and spit fire; the Outline circles its arena and fires volleys. */
  private updateFlying(world: World, player: Player, dt: number, em: EntityManager) {
    const info = MOB_INFO[this.kind], boss = this.kind === 'outline';
    const dx = player.x - this.x, dz = player.z - this.z, dist = Math.hypot(dx, dz);
    const active = !player.creative && !player.dead && dist < (boss ? 90 : 26);
    this.alert = active && !boss ? (this.alert < 0 ? 0 : this.alert + dt) : -1;
    let tx = this.x, ty = this.y, tz = this.z;
    if (boss) {
      const rage = this.hp < MOB_INFO.outline.hp / 2 ? 1.6 : 1;
      this.orbit += dt * 0.35 * rage;
      tx = Math.cos(this.orbit) * 24; tz = Math.sin(this.orbit) * 24; ty = em.arenaY + 12 + Math.sin(this.orbit * 2.3) * 5;
    } else if (active) {
      const want = 8, k = (dist - want) / (dist || 1);
      tx = this.x + dx * k; tz = this.z + dz * k; ty = player.y + 3 + Math.sin(this.animT * 1.7) * 0.8;
    } else { this.moveTimer -= dt; if (this.moveTimer <= 0) { this.moveTimer = 3; this.heading = Math.random() * 6.28; } tx += -Math.sin(this.heading) * 3; tz += -Math.cos(this.heading) * 3; }
    const sp = info.speed, ax = tx - this.x, ay = ty - this.y, az = tz - this.z, al = Math.hypot(ax, ay, az) || 1, k2 = 1 - Math.pow(0.02, dt), v = Math.min(sp, al * 2);
    this.vx += ((ax / al) * v - this.vx) * k2; this.vy += ((ay / al) * v - this.vy) * k2; this.vz += ((az / al) * v - this.vz) * k2;
    stepBody(world, this, dt, 0);
    if (active) this.yaw += Math.atan2(Math.sin(Math.atan2(-dx, -dz) - this.yaw), Math.cos(Math.atan2(-dx, -dz) - this.yaw)) * Math.min(1, dt * 6);
    this.animT += dt;
    this.shootTimer -= dt;
    if (active && this.shootTimer <= 0 && dist < (boss ? 70 : 20)) {
      this.shootTimer = boss ? (this.hp < MOB_INFO.outline.hp / 2 ? 1.1 : 1.9) : 2.4 + Math.random();
      const sx = this.x, sy = this.y + this.h * 0.5, sz = this.z, n = boss ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const px = player.x + (i - (n - 1) / 2) * 2.5 * (dz / (dist || 1)), pz = player.z - (i - (n - 1) / 2) * 2.5 * (dx / (dist || 1));
        const vx = px - sx, vy = player.y + 1 - sy, vz = pz - sz, l = Math.hypot(vx, vy, vz) || 1, s = boss ? 13 : 10;
        em.shoot(sx, sy, sz, (vx / l) * s, (vy / l) * s, (vz / l) * s, boss ? 5 : 4, boss ? [120, 255, 240] : [255, 150, 40]);
      }
      em.hooks.sound('fuse');
    }
    if (this.y < -30) this.dead = true;
  }

  damage(amount: number, kx: number, kz: number, em: EntityManager) {
    if (this.kind === 'outline' && em.anchors > 0) {
      // Shielded while anchor crystals stand.
      for (let i = 0; i < 6; i++) em.particle(this.x, this.y + 2.5, this.z, (Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6, [120, 255, 240], 0.5, 0.14, true);
      em.hooks.sound('hit');
      return;
    }
    if (this.kind === 'glitch') this.angry = true;
    this.hp -= amount;
    this.hurt = 0.4;
    this.vx += kx * 7; this.vz += kz * 7; this.vy = Math.max(this.vy, 5);
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      if (this.kind === 'villager') em.lostVillagers.add(this.tag);
      if (this.kind === 'outline') em.hooks.bossDefeated(this.x, this.y, this.z);
      const c = MODELS[this.kind]?.[0].rgb ?? ([200, 230, 200] as const);
      for (let i = 0; i < 14; i++) em.particle(this.x, this.y + this.h * 0.5, this.z, (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, c, 0.8, 0.14);
      for (const [id, lo, hi] of MOB_INFO[this.kind].drops) {
        const n = lo + Math.floor(Math.random() * (hi - lo + 1));
        if (n > 0) em.drop(id, n, this.x, this.y + 0.4, this.z);
      }
    }
  }
}

class ItemDrop implements Body {
  vx: number; vy: number; vz: number; hw = 0.125; h = 0.25;
  onGround = false; inWater = false; hitWall = false; age = 0; dead = false;
  /** Seconds before the player can pick it up again (thrown items). */
  delay = 0.6;
  constructor(public id: number, public count: number, public x: number, public y: number, public z: number, public dur?: number) {
    this.vx = (Math.random() - 0.5) * 2.4; this.vy = 3 + Math.random() * 1.5; this.vz = (Math.random() - 0.5) * 2.4;
  }
}

class PrimedTNT implements Body {
  vx = 0; vy = 4; vz = 0; hw = 0.49; h = 0.98; onGround = false; inWater = false; hitWall = false; dead = false;
  constructor(public x: number, public y: number, public z: number, public fuse: number) {}
}

interface Shot { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; dmg: number; rgb: RGB }
interface Gem { x: number; y: number; z: number; key: string }
interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; rgb: RGB; glow: boolean }

export interface EntityHooks {
  pickup(id: number, count: number, dur?: number): number; // returns how many could not be taken
  canPickup(id: number): boolean;
  sound(name: 'pop' | 'gem' | 'explode' | 'fuse' | 'hit' | 'mob'): void;
  /** A block was blown up; lets the game clean up furnaces and the like. */
  blockDestroyed(x: number, y: number, z: number, id: number): void;
  shake(amount: number): void;
  gemCollected(): void;
  bossDefeated(x: number, y: number, z: number): void;
}

export class EntityManager {
  mobs: Mob[] = [];
  drops: ItemDrop[] = [];
  tnts: PrimedTNT[] = [];
  particles: Particle[] = [];
  shots: Shot[] = [];
  /** Villagers killed this session do not come back. */
  lostVillagers = new Set<string>();
  /** Standing anchor crystals in the Void arena; the boss cannot be hurt while any remain. */
  anchors = 0;
  arenaY = 52;
  bossAlive = false; bossHp = 0;
  /** Set by the game: whether the Outline has been defeated in this save. */
  bossDefeated = false;
  private scanTimer = 0;
  gems = new Map<string, Gem>();
  collectedGems = new Set<string>();
  /** Set by the game; turns Lottie assets into world geometry. */
  lottie: Lottie3D | null = null;
  private spawnTimer = 2;
  private gemScan = 0;
  /** Set by the game each frame: rain strength and thunderstorm level 0..1 (overworld). */
  rain = 0; thunder = 0;

  constructor(private world: World, readonly hooks: EntityHooks) {}

  particle(x: number, y: number, z: number, vx: number, vy: number, vz: number, rgb: RGB, life: number, size: number, glow = false) {
    if (this.particles.length > 600) return;
    this.particles.push({ x, y, z, vx, vy, vz, life, max: life, size, rgb, glow });
  }

  blockBurst(bx: number, by: number, bz: number, id: number, n = 14) {
    const f = BLOCKS[id].faces, c = texture(f[0]).avg, t = texture(f[2]).avg;
    for (let i = 0; i < n; i++) {
      this.particle(bx + Math.random(), by + Math.random(), bz + Math.random(), (Math.random() - 0.5) * 3, Math.random() * 3.5, (Math.random() - 0.5) * 3, Math.random() < 0.5 ? c : t, 0.5 + Math.random() * 0.5, 0.1 + Math.random() * 0.08);
    }
  }

  drop(id: number, count: number, x: number, y: number, z: number, dur?: number): ItemDrop | null {
    if (id === 0 || !ITEMS.has(id) || this.drops.length > 150) return null;
    const d = new ItemDrop(id, count, x, y, z, dur);
    this.drops.push(d);
    return d;
  }

  /** Does a block-sized box at this cell overlap any mob? */
  blockOccupied(x: number, y: number, z: number): boolean {
    for (const m of this.mobs) if (m.x + m.hw > x && m.x - m.hw < x + 1 && m.z + m.hw > z && m.z - m.hw < z + 1 && m.y + m.h > y && m.y < y + 1) return true;
    return false;
  }

  prime(bx: number, by: number, bz: number, fuse = 3) {
    this.world.setBlock(bx, by, bz, B.AIR);
    this.tnts.push(new PrimedTNT(bx + 0.5, by, bz + 0.5, fuse));
    this.hooks.sound('fuse');
  }

  shoot(x: number, y: number, z: number, vx: number, vy: number, vz: number, dmg: number, rgb: RGB) {
    if (this.shots.length < 40) this.shots.push({ x, y, z, vx, vy, vz, life: 6, dmg, rgb });
  }

  /** Primed TNT at an arbitrary position (not tied to a block). */
  primeAt(x: number, y: number, z: number, fuse: number) {
    this.tnts.push(new PrimedTNT(x, y, z, fuse));
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
      if (id === B.AIR || LIQUID[id] || BLOCKS[id].hard < 0 || id === B.OBSIDIAN) continue;
      if (id === B.TNT) { this.prime(bx, by, bz, 0.4 + Math.random() * 0.8); continue; }
      w.setBlock(bx, by, bz, B.AIR);
      this.hooks.blockDestroyed(bx, by, bz, id);
      if (dropped < 12 && Math.random() < 0.25) { dropped++; this.drop(BLOCKS[id].drop, 1, bx + 0.5, by + 0.3, bz + 0.5); }
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

  /** The Ember Depths have no sky to stand under: spawn on cave floors near the player's level. */
  private spawnEmber(player: Player) {
    const w = this.world;
    if (player.creative || this.mobs.length >= 10) return;
    const a = Math.random() * 6.28, r = 9 + Math.random() * 16;
    const x = Math.floor(player.x + Math.cos(a) * r), z = Math.floor(player.z + Math.sin(a) * r);
    if (!w.isLoaded(x, z)) return;
    const y = w.floorAt(x, Math.floor(player.y), z, 12);
    if (y < 0) return;
    if (Math.random() < 0.6) { const n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) this.mobs.push(new Mob('ashling', x + 0.5 + (Math.random() - 0.5), y, z + 0.5 + (Math.random() - 0.5))); }
    else if (w.getBlock(x, y + 3, z) === B.AIR) this.mobs.push(new Mob('cinder', x + 0.5, y + 2, z + 0.5));
  }

  private spawnVoid(player: Player) {
    const w = this.world;
    // The Outline appears once the player reaches the central island.
    const boss = this.mobs.find((m) => m.kind === 'outline');
    this.bossAlive = !!boss; this.bossHp = boss ? boss.hp : 0;
    if (!boss && !this.bossDefeated && Math.hypot(player.x, player.z) < 75 && w.isLoaded(0, 0)) this.mobs.push(new Mob('outline', 0.5, this.arenaY + 16, 24.5));
    if (player.creative || this.mobs.filter((m) => m.kind === 'glitch').length >= 5) return;
    const a = Math.random() * 6.28, r = 12 + Math.random() * 20;
    const x = Math.floor(player.x + Math.cos(a) * r), z = Math.floor(player.z + Math.sin(a) * r);
    if (!w.isLoaded(x, z)) return;
    const y = w.surfaceY(x, z);
    if (y > 2 && w.getBlock(x, y - 1, z) === B.VOID_STONE && w.getBlock(x, y + 2, z) === B.AIR) this.mobs.push(new Mob('glitch', x + 0.5, y, z + 0.5));
  }

  /** Counts the anchor crystals still standing on the Void pillars (they sit right above the obsidian). */
  private scanArena() {
    const w = this.world;
    if (!w.isLoaded(0, 0)) return;
    this.arenaY = w.surfaceY(6, 6) - 1;
    let n = 0;
    for (const [px, pz] of VOID_PILLARS) { if (!w.isLoaded(px, pz)) { n++; continue; } for (let y = WH - 2; y > 20; y--) { const id = w.getBlock(px, y, pz); if (id === B.ANCHOR_CRYSTAL) { n++; break; } if (id !== B.AIR) break; } }
    this.anchors = n;
  }

  /** Every house of a nearby village keeps one villager around its door. */
  private scanVillages(player: Player) {
    const w = this.world;
    for (const v of w.villagesNear(player.x, player.z, 60)) {
      v.buildings.forEach((b, i) => {
        if (!b.job) return;
        const tag = v.key + ':' + i;
        if (this.lostVillagers.has(tag) || this.mobs.some((m) => m.tag === tag)) return;
        if (!w.isLoaded(b.door[0], b.door[2]) || Math.hypot(b.door[0] - player.x, b.door[2] - player.z) > 56) return;
        // Stand just outside the door.
        const mx = b.x + (b.w - 1) / 2, mz = b.z + (b.d - 1) / 2;
        let x = b.door[0], z = b.door[2];
        if (Math.abs(x - mx) / b.w > Math.abs(z - mz) / b.d) x += Math.sign(x - mx) * 2; else z += Math.sign(z - mz) * 2;
        const y = w.floorAt(Math.floor(x), b.y + 1, Math.floor(z), 6);
        if (y < 0) return;
        const m = new Mob('villager', x + 0.5, y, z + 0.5);
        m.job = b.job; m.tag = tag; m.asset = 'villager_' + b.job; m.homeX = x + 0.5; m.homeZ = z + 0.5;
        this.mobs.push(m);
      });
    }
  }

  private trySpawn(player: Player, night: number) {
    const w = this.world;
    if (w.dim === 'ember') { this.spawnEmber(player); return; }
    if (w.dim === 'void') { this.spawnVoid(player); return; }
    // A thunderstorm darkens the sky enough for hostile mobs to come out in daytime.
    const dark = night > 0.6 || (this.thunder > 0.5 && this.rain > 0.5);
    const hostile = dark && !player.creative && Math.random() < 0.65;
    const cap = hostile ? 10 : 12;
    const count = this.mobs.filter((m) => MOB_INFO[m.kind].hostile === hostile && m.kind !== 'villager').length;
    if (count >= cap) return;
    const a = Math.random() * 6.28, r = 18 + Math.random() * 22;
    const x = Math.floor(player.x + Math.cos(a) * r), z = Math.floor(player.z + Math.sin(a) * r);
    if (!w.hasChunk(x >> 4, z >> 4)) return;
    const y = w.surfaceY(x, z);
    const ground = w.getBlock(x, y - 1, z);
    if (y <= SEA || w.getBlock(x, y, z) !== B.AIR || w.getBlock(x, y + 1, z) !== B.AIR) return;
    // Villages are lit and guarded by design: nothing hostile appears inside one.
    if (hostile && w.villagesNear(x, z, 34).length) return;
    if (hostile) {
      if (!BLOCKS[ground].solid || ground === B.LEAVES || ground === B.BIRCH_LEAVES || ground === B.SPRUCE_LEAVES) return;
      const r = Math.random();
      this.mobs.push(new Mob(r < 0.5 ? 'zombie' : r < 0.8 ? 'creeper' : 'ghost', x + 0.5, y, z + 0.5));
    } else {
      if (ground !== B.GRASS && ground !== B.SNOWGRASS) return;
      const kind: MobKind = (['pig', 'cow', 'sheep', 'slime'] as const)[Math.floor(Math.random() * 4)];
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
    if (this.gemScan <= 0) { this.gemScan = 1; if (w.dim === 'overworld') this.scanGems(player); }
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) { this.scanTimer = 1.5; if (w.dim === 'overworld') this.scanVillages(player); else if (w.dim === 'void') this.scanArena(); }

    // Projectiles
    for (const sh of this.shots) {
      sh.life -= dt;
      sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.z += sh.vz * dt;
      if (Math.random() < dt * 30) this.particle(sh.x, sh.y, sh.z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, sh.rgb, 0.35, 0.1, true);
      const hitPlayer = Math.abs(sh.x - player.x) < 0.55 && Math.abs(sh.z - player.z) < 0.55 && sh.y > player.y - 0.2 && sh.y < player.y + 1.9;
      const hitBlock = w.isLoaded(sh.x, sh.z) && BLOCKS[w.getBlock(Math.floor(sh.x), Math.floor(sh.y), Math.floor(sh.z))].solid;
      if (hitPlayer && !player.dead) { player.damage(sh.dmg); const l = Math.hypot(sh.vx, sh.vz) || 1; player.vx += (sh.vx / l) * 5; player.vz += (sh.vz / l) * 5; }
      if (hitPlayer || hitBlock || sh.life <= 0) {
        sh.life = 0;
        for (let i = 0; i < 10; i++) this.particle(sh.x, sh.y, sh.z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, sh.rgb, 0.5, 0.12, true);
      }
    }
    this.shots = this.shots.filter((sh) => sh.life > 0);

    for (const m of this.mobs) {
      const d = Math.hypot(m.x - player.x, m.z - player.z);
      if ((d > 72 && m.kind !== 'outline') || !w.hasChunk(Math.floor(m.x) >> 4, Math.floor(m.z) >> 4)) { m.dead = true; continue; }
      m.update(w, player, dt, night, this);
    }
    this.mobs = this.mobs.filter((m) => !m.dead);

    for (const it of this.drops) {
      it.age += dt;
      const dx = player.x - it.x, dy = player.y + 0.8 - it.y, dz = player.z - it.z, d = Math.hypot(dx, dy, dz);
      if (it.age > it.delay && d < 2.2 && !player.dead && this.hooks.canPickup(it.id)) {
        // Magnet toward the player
        it.vx += (dx / d) * 40 * dt; it.vy += (dy / d) * 40 * dt; it.vz += (dz / d) * 40 * dt;
        if (d < 0.9) {
          const left = this.hooks.pickup(it.id, it.count, it.dur);
          if (left < it.count) this.hooks.sound('pop');
          it.count = left;
          if (left === 0) it.dead = true;
        }
      }
      if (it.onGround) { it.vx *= Math.pow(0.002, dt); it.vz *= Math.pow(0.002, dt); }
      stepBody(w, it, dt, 22);
      if (it.age > 300 || it.y < -10) it.dead = true;
    }
    this.drops = this.drops.filter((d) => !d.dead);

    for (const t of this.tnts) {
      t.fuse -= dt;
      if (t.onGround) { t.vx *= Math.pow(0.001, dt); t.vz *= Math.pow(0.001, dt); }
      stepBody(w, t, dt, 27);
      if (Math.random() < dt * 20) this.particle(t.x, t.y + 1.05, t.z, (Math.random() - 0.5) * 0.4, 1.2, (Math.random() - 0.5) * 0.4, [230, 230, 230], 0.6, 0.09);
      if (t.fuse <= 0) { t.dead = true; this.explode(t.x, t.y + 0.5, t.z, 4, player); }
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
      if (!w.isLoaded(nx, nz)) { p.life = 0; continue; }
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

  drawModel(r: Renderer3D, parts: Part[], x: number, y: number, z: number, yaw: number, phase: number, amp: number, headPitch: number, armPose: number, flash: number, armSwing = 0, white = false) {
    const sky = this.skyAt(x, y + 0.5, z);
    const sw = Math.sin(phase) * amp;
    for (const p of parts) {
      let swing = 0;
      if (p.anim === 'legA') swing = sw; else if (p.anim === 'legB') swing = -sw;
      else if (p.anim === 'armA') swing = armPose + -sw * 0.8; else if (p.anim === 'armB') swing = armPose + sw * 0.8 + armSwing;
      else if (p.anim === 'head') swing = headPitch;
      const c = flash <= 0 ? p.rgb : white ? ([235, 235, 235] as const) : ([Math.min(255, p.rgb[0] + 140), p.rgb[1] * 0.45, p.rgb[2] * 0.45] as const);
      r.drawBox(x, y, z, yaw, p.pivot, p.o, p.s, swing, c, sky, 0, p.face);
    }
  }

  draw(r: Renderer3D, time: number) {
    for (const m of this.mobs) {
      const lm = LOTTIE_MOBS[m.kind];
      if (lm) {
        const asset = this.lottie?.assets.get(m.asset || lm[0]), fr = asset?.at(m.animT);
        if (asset && fr) {
          // Mirror the card so the character looks the way it walks, as seen from the camera.
          const side = Math.sin(m.yaw - r.viewYaw);
          const h = m.spriteH || lm[1], sky = this.skyAt(m.x, m.y + 0.5, m.z), lamp = m.kind === 'ghost' ? 1 : 0;
          if (r.flatMode === 'extrude') r.drawExtruded(fr.shapes, asset.w, asset.h, m.x, m.y, m.z, h, m.yaw, sky, lamp, m.hurt);
          else r.drawFlat(fr.shapes, asset.w, asset.h, m.x, m.y, m.z, h, side > 0.15, sky, lamp, m.hurt, m.kind === 'ghost' ? 0.88 : 1);
        }
        continue;
      }
      const amp = Math.min(0.9, Math.hypot(m.vx, m.vz) * 0.35);
      // A creeper about to blow flashes white.
      const flash = m.fuse > 0 && Math.sin(m.fuse * 22) > 0 ? 1 : m.hurt;
      this.drawModel(r, MODELS[m.kind], m.x, m.y, m.z, m.yaw, m.phase, amp, 0, m.kind === 'zombie' ? 1.45 : 0, flash, 0, m.fuse > 0 && m.hurt <= 0);
    }
    for (const it of this.drops) {
      const bobY = it.y + 0.12 + Math.sin(it.age * 3) * 0.06, sky = this.skyAt(it.x, it.y, it.z);
      const la = ITEMS.get(it.id)?.lottie, lAsset = la ? this.lottie?.assets.get(la) : undefined, lf = lAsset?.at(it.age);
      if (lAsset && lf) { if (r.flatMode === 'extrude') r.drawExtruded(lf.shapes, lAsset.w, lAsset.h, it.x, bobY - 0.05, it.z, 0.5, it.age * 1.8, sky, 2); else r.drawFlat(lf.shapes, lAsset.w, lAsset.h, it.x, bobY - 0.05, it.z, 0.5, false, sky, 2); }
      else if (la) { /* still extracting */ }
      else if (isBlockId(it.id) && CUBE[it.id]) r.drawBox(it.x, bobY, it.z, it.age * 1.8, ZERO, [-0.13, 0, -0.13], [0.26, 0.26, 0.26], 0, WHITE, sky, BLOCKS[it.id].light ? 3 : 0, undefined, 255, 0, blockTextures(it.id), 3);
      else r.drawSpriteBillboard(it.x, bobY - 0.05, it.z, 0.42, texture(ITEMS.get(it.id)!.icon), sky);
    }
    for (const t of this.tnts) {
      const blink = Math.sin(t.fuse * 14) > 0;
      const s = 0.98 + (t.fuse < 0.4 ? (0.4 - t.fuse) * 0.6 : 0);
      if (blink) r.drawBox(t.x, t.y, t.z, 0, ZERO, [-s / 2, 0, -s / 2], [s, s, s], 0, [255, 255, 255], 0, 3);
      else r.drawBox(t.x, t.y, t.z, 0, ZERO, [-s / 2, 0, -s / 2], [s, s, s], 0, WHITE, this.skyAt(t.x, t.y, t.z), 0, undefined, 255, 0, blockTextures(B.TNT));
    }
    for (const sh of this.shots) r.drawBox(sh.x, sh.y - 0.15, sh.z, time * 5, ZERO, [-0.15, 0, -0.15], [0.3, 0.3, 0.3], time * 3, sh.rgb, 0, 3);
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
