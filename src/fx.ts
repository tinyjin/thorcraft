// Effects that lean on what a vector engine offers beyond filling polygons: scene post effects
// (blur, tint) and radial gradients. Additive blending of gradient fills trips a shader error in
// the WebGL backend, so the halos use regular alpha blending.

import { B } from './blocks';
import { ALERT_FRAMES, FUSE_FRAMES, SPARKLE_FRAMES, alertLottie, fuseLottie, sparkleLottie } from './lottie';
import { clamp } from './math';
import { raycast } from './physics';
import { Camera, Environment } from './renderer';
import { CS, World } from './world';

const MAX_GLOWS = 28;
const GLOW_DIST = 34;

export interface PostState { menuOpen: boolean; underwater: boolean; inLava: boolean; hurt: number; night: number; dim: 'overworld' | 'ember' | 'void'; /** 0..1 while standing in a portal: the view melts before the jump. */ portal: number }

export type BillboardKind = 'alert' | 'fuse' | 'sparkle';
const BILLBOARDS: Record<BillboardKind, { json: () => string; frames: number; loop: boolean; pool: number }> = {
  alert: { json: alertLottie, frames: ALERT_FRAMES, loop: false, pool: 8 },
  fuse: { json: fuseLottie, frames: FUSE_FRAMES, loop: true, pool: 6 },
  sparkle: { json: sparkleLottie, frames: SPARKLE_FRAMES, loop: true, pool: 12 },
};

export class Fx {
  /** Lottie animations anchored to world positions (above mobs, around gems). */
  readonly billboardScene: any;
  private boards = new Map<BillboardKind, { anims: any[]; used: number; last: number[] }>();

  /** Light halo layer, sits between the world and the HUD. */
  readonly scene: any;
  private glows: any[] = [];
  private sunBloom: any; private flashShape: any;
  private flash = 0;
  private blur = 0;
  private postKey = '';
  private candidates: number[] = [];
  enabled = true;

  constructor(private TVG: any, private worldScene: any) {
    this.scene = new TVG.Scene();
    this.billboardScene = new TVG.Scene();
    for (const kind of Object.keys(BILLBOARDS) as BillboardKind[]) {
      const def = BILLBOARDS[kind], json = def.json(), anims: any[] = [];
      for (let i = 0; i < def.pool; i++) {
        const a = new TVG.LottieAnimation();
        a.load(json);
        a.picture.visible(false);
        this.billboardScene.add(a.picture);
        anims.push(a);
      }
      this.boards.set(kind, { anims, used: 0, last: new Array(def.pool).fill(-1) });
    }
    this.sunBloom = this.makeGlow([255, 236, 190]);
    this.flashShape = new TVG.Shape();
    this.scene.add(this.flashShape);
  }

  /** A unit radial gradient disc; placed each frame with translate + scale, faded with opacity. */
  private makeGlow(rgb: readonly number[]): any {
    const s = new this.TVG.Shape();
    const g = new this.TVG.RadialGradient(0, 0, 1);
    g.addStop(0, [rgb[0], rgb[1], rgb[2], 200]).addStop(0.3, [rgb[0], rgb[1] * 0.85, rgb[2] * 0.7, 95]).addStop(1, [rgb[0], rgb[1] * 0.7, rgb[2] * 0.5, 0]);
    s.appendCircle(0, 0, 1, 1).fill(g).visible(false);
    this.scene.add(s);
    return s;
  }

  beginBillboards() { for (const b of this.boards.values()) b.used = 0; }

  /**
   * Shows a Lottie at a world position. `t` is the animation time in seconds (looped or clamped per kind),
   * `size` the height in blocks. Hidden when a block is in the way, since there is no depth buffer.
   */
  billboard(kind: BillboardKind, world: World, cam: Camera, x: number, y: number, z: number, t: number, size: number) {
    const b = this.boards.get(kind)!, def = BILLBOARDS[kind];
    if (b.used >= b.anims.length) return;
    const p = project(cam, x, y, z);
    if (!p || p[2] > 40) return;
    const px = (cam.focal * size) / p[2];
    if (p[0] < -px || p[0] > cam.w + px || p[1] < -px || p[1] > cam.h + px) return;
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, dist = Math.hypot(dx, dy, dz);
    if (dist > 1 && raycast(world, cam.x, cam.y, cam.z, dx / dist, dy / dist, dz / dist, dist - 0.3)) return;
    const i = b.used++, a = b.anims[i];
    let f = t * 30;
    f = def.loop ? f % def.frames : Math.min(def.frames - 1, f);
    if (Math.abs(b.last[i] - f) > 0.01) { b.last[i] = f; try { a.frame(f); } catch { /* unchanged frame */ } }
    a.picture.visible(true).size(px, px).translate(p[0] - px / 2, p[1] - px / 2);
  }

  endBillboards() { for (const b of this.boards.values()) for (let i = b.used; i < b.anims.length; i++) b.anims[i].picture.visible(false); }

  /** White flash, e.g. for explosions (0..1). */
  burst(amount: number) { this.flash = Math.max(this.flash, amount); }

  /** Blur and color grading of the whole 3D view. Only touches the scene when something changed. */
  post(st: PostState, dt: number) {
    if (!this.enabled) return;
    const want = st.menuOpen ? 7 : Math.max(st.underwater ? 1.6 : 0, st.portal * 9);
    this.blur += (want - this.blur) * Math.min(1, dt * 10);
    const sigma = Math.round(this.blur * 2) / 2;
    const hurt = Math.round(clamp(st.hurt * 190, 0, 60) / 6) * 6;
    const night = Math.round((st.night * 22) / 4) * 4;
    const portal = Math.round(st.portal * 10) * 8;
    const key = `${sigma}|${st.underwater}|${st.inLava}|${hurt}|${night}|${st.dim}|${portal}`;
    if (key === this.postKey) return;
    this.postKey = key;
    const s = this.worldScene;
    try {
      s.resetEffects();
      if (st.inLava) s.tint(70, 10, 0, 255, 170, 60, 70);
      else if (st.underwater) s.tint(0, 18, 60, 130, 200, 255, 55);
      else if (st.dim === 'ember') s.tint(40, 4, 0, 255, 196, 150, 38); // everything glows like coals
      else if (st.dim === 'void') s.tint(10, 4, 40, 214, 226, 255, 30);
      else if (night > 0) s.tint(4, 6, 30, 205, 215, 255, night); // moonlit blue grade
      if (portal > 0) s.tint(60, 10, 110, 235, 190, 255, portal);
      if (hurt > 0) s.tint(50, 0, 0, 255, 110, 110, hurt);
      if (sigma > 0) s.gaussianBlur(sigma, 0, 0, 50);
    } catch { this.enabled = false; }
  }

  /** Soft halos around visible torches, glowstone and lit furnaces, a sun bloom and the explosion flash. */
  lights(world: World, cam: Camera, env: Environment, dt: number, active: boolean) {
    let used = 0;
    const strength = 0.3 + 0.7 * env.night;
    if (env.skyKind !== 'normal') env = { ...env, sunDir: [0, -1, 0] }; // no sun bloom without a sun
    if (active && this.enabled) {
      const ccx = Math.floor(cam.x / CS), ccz = Math.floor(cam.z / CS), cand = this.candidates;
      cand.length = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (!world.hasChunk(ccx + dx, ccz + dz)) continue;
        const l = world.chunkAt(ccx + dx, ccz + dz).lights;
        for (let i = 0; i < l.length; i += 3) {
          const d2 = (l[i] + 0.5 - cam.x) ** 2 + (l[i + 1] + 0.5 - cam.y) ** 2 + (l[i + 2] + 0.5 - cam.z) ** 2;
          if (d2 < GLOW_DIST * GLOW_DIST) cand.push(d2, l[i], l[i + 1], l[i + 2]);
        }
      }
      // Nearest first when there are too many.
      if (cand.length / 4 > MAX_GLOWS) {
        const order = Array.from({ length: cand.length / 4 }, (_, i) => i).sort((a, b) => cand[a * 4] - cand[b * 4]).slice(0, MAX_GLOWS);
        const keep: number[] = [];
        for (const i of order) keep.push(cand[i * 4], cand[i * 4 + 1], cand[i * 4 + 2], cand[i * 4 + 3]);
        cand.length = 0; cand.push(...keep);
      }
      for (let i = 0; i < cand.length; i += 4) {
        const bx = cand[i + 1], by = cand[i + 2], bz = cand[i + 3];
        const id = world.getBlock(bx, by, bz);
        if (id === B.EMBER_PORTAL || id === B.VOID_PORTAL || id === B.MAGMA || id === B.EMBER_BLOCK || id === B.PORTAL_FRAME_EYE) continue; // large glowing surfaces need no halo
        const lx = bx + 0.5, ly = by + (id === B.TORCH ? 0.62 : 0.5), lz = bz + 0.5;
        const p = project(cam, lx, ly, lz);
        if (!p) continue;
        const dist = Math.sqrt(cand[i]);
        // No depth buffer: ask the voxel grid whether the light is actually in view.
        if (dist > 0.8) {
          const dx = (lx - cam.x) / dist, dy = (ly - cam.y) / dist, dz = (lz - cam.z) / dist;
          const hit = raycast(world, cam.x, cam.y, cam.z, dx, dy, dz, dist);
          if (hit && !(hit.x === bx && hit.y === by && hit.z === bz)) continue;
        }
        const r = (cam.focal * (id === B.TORCH ? 1.5 : 2.1)) / Math.max(p[2], 0.6);
        if (p[0] < -r || p[0] > cam.w + r || p[1] < -r || p[1] > cam.h + r) continue;
        let g = this.glows[used];
        if (!g) this.glows.push((g = this.makeGlow([255, 196, 96])));
        used++;
        const flicker = 0.9 + 0.1 * Math.sin(env.time * 9 + bx * 1.7 + bz * 2.3) * Math.sin(env.time * 5.3 + by);
        const fade = clamp(1.3 - dist / GLOW_DIST * 1.3, 0, 1);
        g.visible(true).scale(r).translate(p[0], p[1]).opacity(Math.floor(255 * strength * flicker * fade));
      }
    }
    for (let i = used; i < this.glows.length; i++) this.glows[i].visible(false);

    // Sun bloom in front of the terrain, unless something blocks the view of the sun.
    const sd = env.sunDir;
    let bloom = false;
    if (active && this.enabled && sd[1] > -0.05 && !env.underwater) {
      const p = project(cam, cam.x + sd[0] * 100, cam.y + sd[1] * 100, cam.z + sd[2] * 100);
      if (p && p[0] > -200 && p[0] < cam.w + 200 && p[1] > -200 && p[1] < cam.h + 200 && !raycast(world, cam.x, cam.y, cam.z, sd[0], sd[1], sd[2], 48)) {
        const low = clamp(1 - sd[1] * 2.2, 0, 1); // stronger near the horizon
        this.sunBloom.visible(true).scale(cam.focal * (0.45 + low * 0.35)).translate(p[0], p[1]).opacity(Math.floor(110 + low * 110));
        bloom = true;
      }
    }
    if (!bloom) this.sunBloom.visible(false);

    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.flashShape.reset();
    if (this.flash > 0.01) this.flashShape.appendRect(0, 0, cam.w, cam.h).fill(255, 236, 200, Math.floor(clamp(this.flash, 0, 1) * 200));
  }
}

/** World position to screen; null when behind the camera. Returns [x, y, depth]. */
function project(c: Camera, x: number, y: number, z: number): [number, number, number] | null {
  const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  const zt = -dx * c.sinY - dz * c.cosY;
  const xc = dx * c.cosY - dz * c.sinY, yc = dy * c.cosP - zt * c.sinP, zc = zt * c.cosP + dy * c.sinP;
  if (zc < 0.15) return null;
  return [c.cx + (xc / zc) * c.focal, c.cy - (yc / zc) * c.focal, zc];
}
