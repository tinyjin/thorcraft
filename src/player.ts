// First/third person player controller.

import { B, BLOCKS } from './blocks';
import { Input } from './input';
import { Body, stepBody } from './physics';
import { World } from './world';
import { clamp } from './math';

export const EYE = 1.62;
const WALK = 4.4, SPRINT = 6.6, FLY = 11, JUMP = 8.4, GRAVITY = 27;

export class Player implements Body {
  x = 0; y = 40; z = 0; vx = 0; vy = 0; vz = 0;
  hw = 0.3; h = 1.8;
  onGround = false; inWater = false; hitWall = false;
  yaw = 0; pitch = 0;
  flying = false;
  creative = false;
  health = 20; air = 10;
  hurtTimer = 0; // red flash
  invuln = 0;
  dead = false;
  walkPhase = 0; // drives limb swing and view bob
  bob = 0;
  swing = 0; // arm swing on click, 1 -> 0
  headInWater = false;
  private stepAcc = 0;
  private cactusTimer = 0;
  private drownTimer = 0;
  private lastSpace = -1;

  onStep: (() => void) | null = null;
  onHurt: ((amount: number) => void) | null = null;
  onSplash: (() => void) | null = null;

  look(input: Input, sens: number) {
    this.yaw -= input.mouseDX * sens;
    this.pitch = clamp(this.pitch - input.mouseDY * sens, -1.55, 1.55);
  }

  damage(amount: number, ignoreInvuln = false) {
    if (this.creative || this.dead || amount <= 0) return;
    if (this.invuln > 0 && !ignoreInvuln) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = 0.35;
    this.invuln = 0.5;
    this.onHurt?.(amount);
    if (this.health <= 0) this.dead = true;
  }

  update(world: World, input: Input, dt: number, now: number, controllable: boolean) {
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.swing = Math.max(0, this.swing - dt * 4);
    if (this.dead) { this.vx = this.vz = 0; stepBody(world, this, dt, GRAVITY); return; }

    let mx = 0, mz = 0;
    if (controllable) {
      if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) mz += 1;
      if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) mz -= 1;
      if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) mx += 1;
      if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) mx -= 1;
      if (this.creative && input.pressed.has('Space')) {
        if (now - this.lastSpace < 0.3) { this.flying = !this.flying; this.vy = 0; this.lastSpace = -1; }
        else this.lastSpace = now;
      }
      if (this.creative && input.pressed.has('KeyF')) { this.flying = !this.flying; this.vy = 0; }
    }
    if (!this.creative) this.flying = false;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;
    const sprint = controllable && (input.keys.has('ShiftLeft') || input.keys.has('ControlLeft'));
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const wx = -sin * mz + cos * mx, wz = -cos * mz - sin * mx;

    const wasInWater = this.inWater;
    if (this.flying) {
      const sp = FLY * (sprint ? 2.2 : 1);
      const k = 1 - Math.pow(0.0005, dt);
      let up = 0;
      if (controllable && input.keys.has('Space')) up += 1;
      if (controllable && (input.keys.has('KeyC') || input.keys.has('KeyQ'))) up -= 1;
      this.vx += (wx * sp - this.vx) * k; this.vz += (wz * sp - this.vz) * k; this.vy += (up * sp * 0.8 - this.vy) * k;
      stepBody(world, this, dt, 0);
      if (this.onGround) this.flying = false;
    } else {
      const sp = (sprint ? SPRINT : WALK) * (this.inWater ? 0.6 : 1);
      const k = 1 - Math.pow(this.onGround ? 0.00002 : 0.02, dt);
      this.vx += (wx * sp - this.vx) * k; this.vz += (wz * sp - this.vz) * k;
      if (controllable && input.keys.has('Space')) {
        if (this.inWater) this.vy = Math.min(this.vy + 30 * dt, 3.6);
        else if (this.onGround) this.vy = JUMP;
      }
      const fallSpeed = stepBody(world, this, dt, GRAVITY);
      // Hop out of water onto a ledge.
      if (this.inWater && this.hitWall && controllable && input.keys.has('Space')) this.vy = Math.max(this.vy, 5.4);
      if (fallSpeed > 13.5 && !this.inWater) this.damage(Math.floor((fallSpeed - 12) * 0.9), true);
    }
    if (this.inWater && !wasInWater && this.vy < -4) this.onSplash?.();

    // Footsteps, view bobbing
    const hs = Math.hypot(this.vx, this.vz);
    if (this.onGround && hs > 0.5) {
      this.walkPhase += hs * dt * 1.9;
      this.stepAcc += hs * dt;
      if (this.stepAcc > 2.3) { this.stepAcc = 0; this.onStep?.(); }
    }
    const targetBob = this.onGround && hs > 0.5 ? 1 : 0;
    this.bob += (targetBob - this.bob) * Math.min(1, dt * 8);

    // Environment hazards
    const head = world.getBlock(Math.floor(this.x), Math.floor(this.y + EYE), Math.floor(this.z));
    this.headInWater = head === B.WATER;
    if (this.headInWater && !this.creative) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) { this.drownTimer += dt; if (this.drownTimer > 1) { this.drownTimer = 0; this.damage(2, true); } }
    } else { this.air = Math.min(10, this.air + dt * 4); this.drownTimer = 0; }

    this.cactusTimer -= dt;
    if (this.cactusTimer <= 0 && this.touches(world, B.CACTUS)) { this.cactusTimer = 0.6; this.damage(1, true); }
    if (this.y < -20) this.damage(4, true);
  }

  private touches(world: World, id: number): boolean {
    const m = 0.08;
    const x0 = Math.floor(this.x - this.hw - m), x1 = Math.floor(this.x + this.hw + m);
    const y0 = Math.floor(this.y - m), y1 = Math.floor(this.y + this.h + m);
    const z0 = Math.floor(this.z - this.hw - m), z1 = Math.floor(this.z + this.hw + m);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (world.getBlock(x, y, z) === id) return true;
    return false;
  }

  /** Would a block placed at this cell intersect the player? */
  intersectsCell(bx: number, by: number, bz: number): boolean {
    return bx + 1 > this.x - this.hw && bx < this.x + this.hw && by + 1 > this.y && by < this.y + this.h && bz + 1 > this.z - this.hw && bz < this.z + this.hw;
  }

  spawnAt(world: World, x: number, z: number) {
    // Walk outwards until a dry column is found.
    let bx = x, bz = z;
    for (let r = 0; r < 200; r += 4) {
      let found = false;
      for (let a = 0; a < 8 && !found; a++) {
        const tx = Math.floor(x + Math.cos(a * 0.785) * r), tz = Math.floor(z + Math.sin(a * 0.785) * r);
        const sy = world.surfaceY(tx, tz);
        const ground = world.getBlock(tx, sy - 1, tz);
        if (BLOCKS[ground].solid && world.getBlock(tx, sy, tz) === B.AIR && ground !== B.CACTUS && ground !== B.LEAVES) { bx = tx; bz = tz; found = true; }
      }
      if (found) break;
    }
    this.x = bx + 0.5; this.z = bz + 0.5; this.y = world.surfaceY(bx, bz) + 0.01;
    this.vx = this.vy = this.vz = 0;
    this.health = 20; this.air = 10; this.dead = false; this.flying = false;
  }
}
