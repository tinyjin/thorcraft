// Software 3D pipeline on top of a 2D vector engine.
//
// ThorVG has no depth buffer, so visibility is solved with the painter's algorithm. For unit
// cubes on a grid there is an exact ordering: if block A hides block B from the camera, A is
// closer than B along every axis, so its Manhattan cell distance is strictly smaller. Faces
// are therefore bucketed by Manhattan distance and drawn far to near. Faces inside one bucket
// never hide each other, which leaves us free to sort them by color and merge every
// (bucket, color, fog) run into a single multi-subpath Shape.
//
// Textures are vector too: every face is a flat base quad plus the merged texel rectangles of
// a distance dependent level of detail (see textures.ts), followed by translucent ambient
// occlusion strips along edges that touch a protruding block.

import { B, BLOCKS, DIR_O, DIR_SHADE, DIR_U, DIR_V, LAMP_MUL, SKY_MUL, palette } from './blocks';
import { CS, FACE_STRIDE, PLANT_STRIDE, WH, World } from './world';
import { clamp, mulberry32 } from './math';
import { CLOUD_VARIANTS, MOON_PHASES, cloudSvg, moonSvg, sunSvg } from './svg';
import { Tex, TexLod, texture } from './textures';

const MAX_POLYS = 131072;
const MAX_BUCKET = 255;
const NEAR = 0.08;
const FOG_LEVELS = 32;
/** Distance (in blocks) up to which each texture level of detail is used; beyond the last one faces are flat. */
const LOD_DIST = [5, 11, 20, 31];
const AO_DIST = 38;
const PLANT_DIST = 36;
const HAND_ORDER = 1023;
const CLOUD_POOL = 14;
const AO_W = 0.2;

export const enum Layer { TERRAIN = 0, DECAL = 1, AO = 2, ENTITY = 3 }

export class Camera {
  x = 0; y = 0; z = 0; yaw = 0; pitch = 0; fov = 75;
  // Derived per frame
  sinY = 0; cosY = 1; sinP = 0; cosP = 1; focal = 1; cx = 0; cy = 0; w = 0; h = 0;

  setup(w: number, h: number) {
    this.w = w; this.h = h; this.cx = w / 2; this.cy = h / 2;
    this.sinY = Math.sin(this.yaw); this.cosY = Math.cos(this.yaw);
    this.sinP = Math.sin(this.pitch); this.cosP = Math.cos(this.pitch);
    this.focal = h / 2 / Math.tan((this.fov * Math.PI) / 360);
  }

  forward(): [number, number, number] {
    return [-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)];
  }
}

export interface Environment {
  /** RGB multipliers for sky-lit surfaces (0..1 each). */
  sun: [number, number, number];
  fog: [number, number, number];
  zenith: [number, number, number];
  /** Direction to the sun, unit vector. */
  sunDir: [number, number, number];
  night: number; // 0 day .. 1 night
  /** 0 = full moon .. 4 = new moon .. 7 */
  moonPhase: number;
  time: number; // seconds, for animation
  underwater: boolean;
}

export interface RenderStats { polys: number; shapes: number; chunks: number; collectMs: number; emitMs: number }

/** What the first person hand holds: a block id, a flat item sprite, or nothing (bare arm). */
export interface HeldView { block: number; sprite: Tex | null; swing: number; bobX: number; bobY: number; drop: number; sky: number; lamp: number }

type TVGNS = any;
type RGB = readonly [number, number, number];

/** Textures per block face, FACE_TEX[id * 6 + dir]. */
const FACE_TEX: Tex[] = [];
for (let id = 0; id < B.COUNT; id++) for (let d = 0; d < 6; d++) FACE_TEX[id * 6 + d] = texture(BLOCKS[id].faces[d]);
export const blockTextures = (id: number): Tex[] => FACE_TEX.slice(id * 6, id * 6 + 6);

/** Crack stages: cumulative texel lists on a 16x16 grid. */
const CRACKS: number[][] = [];
for (let s = 0; s < 10; s++) {
  const rng = mulberry32(1234), cells = new Set<number>();
  for (let line = 0; line < 2 + s; line++) {
    let x = 8, y = 8;
    const ang = rng() * Math.PI * 2, len = 3 + Math.floor(rng() * (3 + s));
    for (let i = 0; i < len; i++) {
      cells.add(clamp(Math.round(y), 0, 15) * 16 + clamp(Math.round(x), 0, 15));
      x += Math.cos(ang) + (rng() - 0.5) * 1.2; y += Math.sin(ang) + (rng() - 0.5) * 1.2;
    }
  }
  CRACKS.push([...cells]);
}

export class Renderer3D {
  readonly scene: any;
  readonly skyScene: any;
  readonly overlayScene: any;
  renderDistance = 56;
  /** Scales the texture LOD distances; lowered automatically when frames get slow. */
  detail = 1;
  stats: RenderStats = { polys: 0, shapes: 0, chunks: 0, collectMs: 0, emitMs: 0 };

  private TVG: TVGNS;
  private pool: any[] = [];
  private usedLast = 0;
  private skyShape: any; private starShape: any; private sunGlow: any;
  // SVG pictures
  private sunPic: any; private moonPics: any[] = []; private cloudScene: any; private cloudPics: any[][] = []; private cloudKey = '';
  private outline: any;

  // Per-frame polygon store
  private keys = new Float64Array(MAX_POLYS);
  private pStart = new Uint32Array(MAX_POLYS);
  private pN = new Uint8Array(MAX_POLYS);
  private pColor = new Uint16Array(MAX_POLYS);
  private verts = new Float32Array(MAX_POLYS * 9);
  private count = 0;
  private vtop = 0;

  // Scratch
  private cxs = new Float64Array(8); private cys = new Float64Array(8); private czs = new Float64Array(8);
  private tx = new Float64Array(8); private ty = new Float64Array(8); private tz = new Float64Array(8);
  // Camera-space basis of the quad currently being textured: origin, u edge, v edge.
  private q = new Float64Array(9);
  private ptPool: number[][] = [];
  private cmdCache: Uint8Array[] = [];
  private stars: number[] = [];
  private cam!: Camera;
  private camCell = [0, 0, 0];
  private time = 0;
  private aoId = palette.fixedId(0, 0, 0, 50);
  private aoId2 = palette.fixedId(0, 0, 0, 34);
  private crackId = palette.fixedId(12, 12, 14, 200);

  constructor(TVG: TVGNS) {
    this.TVG = TVG;
    this.skyScene = new TVG.Scene();
    this.scene = new TVG.Scene();
    this.overlayScene = new TVG.Scene();
    this.skyShape = new TVG.Shape();
    this.starShape = new TVG.Shape();
    this.sunGlow = new TVG.Shape();
    const svg = (src: string, parent: any) => { const p = new TVG.Picture(); p.load(src, { type: 'svg' }); p.visible(false); parent.add(p); return p; };
    this.skyScene.add(this.skyShape).add(this.starShape).add(this.sunGlow);
    this.sunPic = svg(sunSvg(), this.skyScene);
    for (let i = 0; i < MOON_PHASES; i++) this.moonPics.push(svg(moonSvg(i), this.skyScene));
    // Clouds live in their own scene so a tint effect can recolor them for dusk and night.
    this.cloudScene = new TVG.Scene();
    this.skyScene.add(this.cloudScene);
    for (let v = 0; v < CLOUD_VARIANTS; v++) { const src = cloudSvg(v), pool: any[] = []; for (let i = 0; i < CLOUD_POOL; i++) pool.push(svg(src, this.cloudScene)); this.cloudPics.push(pool); }
    this.outline = new TVG.Shape();
    this.overlayScene.add(this.outline);

    // Fixed star field on the unit sphere.
    let s = 1234567;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
    for (let i = 0; i < 220; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      this.stars.push(r * Math.cos(a), u, r * Math.sin(a), 0.6 + rnd() * 1.4);
    }
  }

  // ------------------------------------------------------------------ frame lifecycle

  begin(cam: Camera, time: number) {
    this.cam = cam;
    this.time = time;
    palette.resetDynamic();
    this.count = 0;
    this.vtop = 0;
    this.camCell[0] = Math.floor(cam.x); this.camCell[1] = Math.floor(cam.y); this.camCell[2] = Math.floor(cam.z);
  }

  /** Transforms n scratch points (tx/ty/tz, world space) to camera space in cxs/cys/czs. */
  private toCamera(n: number) {
    const c = this.cam;
    for (let i = 0; i < n; i++) {
      const dx = this.tx[i] - c.x, dy = this.ty[i] - c.y, dz = this.tz[i] - c.z;
      const zt = -dx * c.sinY - dz * c.cosY;
      this.cxs[i] = dx * c.cosY - dz * c.sinY;
      this.cys[i] = dy * c.cosP - zt * c.sinP;
      this.czs[i] = zt * c.cosP + dy * c.sinP;
    }
  }

  /**
   * Clips the camera-space polygon in the scratch arrays against the near plane, projects it,
   * rejects it if off screen and stores it. `grow` pushes vertices away from the centroid by
   * that many pixels to hide anti-aliasing seams between adjacent faces.
   */
  private pushPoly(n: number, order: number, sub: number, fog: number, color: number, grow: number): boolean {
    if (this.count >= MAX_POLYS || this.vtop + 24 > this.verts.length) return false;
    const c = this.cam, xs = this.cxs, ys = this.cys, zs = this.czs, v = this.verts;
    let behind = 0;
    for (let i = 0; i < n; i++) if (zs[i] < NEAR) behind++;
    if (behind === n) return false;

    const start = this.vtop;
    let o = start, m = 0;
    if (behind === 0) {
      for (let i = 0; i < n; i++) {
        const inv = c.focal / zs[i];
        v[o++] = c.cx + xs[i] * inv;
        v[o++] = c.cy - ys[i] * inv;
      }
      m = n;
    } else {
      // Sutherland-Hodgman against z = NEAR
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const zi = zs[i], zj = zs[j];
        const inI = zi >= NEAR, inJ = zj >= NEAR;
        if (inI) {
          const inv = c.focal / zi;
          v[o++] = c.cx + xs[i] * inv; v[o++] = c.cy - ys[i] * inv; m++;
        }
        if (inI !== inJ) {
          const t = (NEAR - zi) / (zj - zi);
          const inv = c.focal / NEAR;
          v[o++] = c.cx + (xs[i] + (xs[j] - xs[i]) * t) * inv;
          v[o++] = c.cy - (ys[i] + (ys[j] - ys[i]) * t) * inv; m++;
        }
      }
      if (m < 3) return false;
    }

    // Screen rejection + centroid
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, mx = 0, my = 0;
    for (let i = start; i < o; i += 2) {
      const x = v[i], y = v[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      mx += x; my += y;
    }
    if (maxX < 0 || minX > c.w || maxY < 0 || minY > c.h) return false;
    if (maxX - minX < 0.35 && maxY - minY < 0.35) return false;

    if (grow > 0) {
      mx /= m; my /= m;
      for (let i = start; i < o; i += 2) {
        const dx = v[i] - mx, dy = v[i + 1] - my;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1e-3) { const k = grow / len; v[i] += dx * k; v[i + 1] += dy * k; }
      }
    }
    // Keep coordinates in a sane range for the rasterizer.
    for (let i = start; i < o; i++) v[i] = clamp(v[i], -20000, 20000);

    const idx = this.count++;
    this.pStart[idx] = start;
    this.pN[idx] = m;
    this.pColor[idx] = color;
    this.vtop = o;
    this.keys[idx] = ((order * 65536 + sub) * FOG_LEVELS + fog) * MAX_POLYS + idx;
    return true;
  }

  private fogLevel(dist: number): number {
    const R = this.renderDistance;
    const t = clamp((dist - R * 0.58) / (R * 0.42), 0, 1);
    return Math.min(FOG_LEVELS - 1, Math.floor(t * t * FOG_LEVELS));
  }

  /** Remembers the camera-space quad in scratch slots 0 (origin), 1 (origin + u) and 3 (origin + v). */
  private latchQuad() {
    const q = this.q, xs = this.cxs, ys = this.cys, zs = this.czs;
    q[0] = xs[0]; q[1] = ys[0]; q[2] = zs[0];
    q[3] = xs[1] - xs[0]; q[4] = ys[1] - ys[0]; q[5] = zs[1] - zs[0];
    q[6] = xs[3] - xs[0]; q[7] = ys[3] - ys[0]; q[8] = zs[3] - zs[0];
  }

  /** Pushes the sub-rectangle (u0, v0)-(u1, v1) of the latched quad. */
  private pushCell(u0: number, v0: number, u1: number, v1: number, order: number, sub: number, fog: number, color: number, grow: number) {
    const q = this.q, xs = this.cxs, ys = this.cys, zs = this.czs;
    xs[0] = q[0] + q[3] * u0 + q[6] * v0; ys[0] = q[1] + q[4] * u0 + q[7] * v0; zs[0] = q[2] + q[5] * u0 + q[8] * v0;
    xs[1] = q[0] + q[3] * u1 + q[6] * v0; ys[1] = q[1] + q[4] * u1 + q[7] * v0; zs[1] = q[2] + q[5] * u1 + q[8] * v0;
    xs[2] = q[0] + q[3] * u1 + q[6] * v1; ys[2] = q[1] + q[4] * u1 + q[7] * v1; zs[2] = q[2] + q[5] * u1 + q[8] * v1;
    xs[3] = q[0] + q[3] * u0 + q[6] * v1; ys[3] = q[1] + q[4] * u0 + q[7] * v1; zs[3] = q[2] + q[5] * u0 + q[8] * v1;
    this.pushPoly(4, order, sub, fog, color, grow);
  }

  private lodFor(tex: Tex, dist: number): TexLod | null {
    const d = dist / this.detail, skip = 4 - tex.lods.length; // sprites have no 2x2 level
    for (let i = 0; i < tex.lods.length; i++) if (d < LOD_DIST[i + (tex.sprite ? skip : 0)]) return tex.lods[i];
    return null;
  }

  /** Permanent palette id of a texture tone under the given face shade and light levels. */
  private toneId(ids: Uint16Array, rgb: RGB, alpha: number, dir: number, sky: number, lamp: number, emissive: boolean): number {
    const k = (dir * 3 + sky) * 4 + lamp;
    let id = ids[k];
    if (id === 0) {
      const m = emissive ? 1 : DIR_SHADE[dir];
      id = ids[k] = palette.fixedId(rgb[0] * m, rgb[1] * m, rgb[2] * m, alpha, sky, emissive ? 3 : lamp);
    }
    return id;
  }

  // ------------------------------------------------------------------ terrain

  drawWorld(world: World) {
    const t0 = performance.now();
    const cam = this.cam;
    const R = this.renderDistance, R2 = R * R;
    const ccx = Math.floor(cam.x / CS), ccz = Math.floor(cam.z / CS);
    const cr = Math.ceil(R / CS);
    const [ex, ey, ez] = this.camCell;
    const f = cam.forward();
    // Conservative cone test for chunks: half angle covers the screen diagonal.
    const diag = Math.atan(Math.hypot(cam.w, cam.h) / 2 / cam.focal);
    const tx = this.tx, ty = this.ty, tz = this.tz;
    const time = this.time;
    let chunks = 0;

    for (let dcz = -cr; dcz <= cr; dcz++) for (let dcx = -cr; dcx <= cr; dcx++) {
      if (!world.hasChunk(ccx + dcx, ccz + dcz)) continue;
      const ch = world.chunkAt(ccx + dcx, ccz + dcz);
      if (!ch.meshed || (ch.faceCount === 0 && ch.plantCount === 0)) continue;

      // Chunk bounding sphere vs. view cone and render distance.
      const mx = ch.cx * CS + 8, mz = ch.cz * CS + 8, my = (ch.minY + ch.maxY) / 2;
      const rad = Math.hypot(11.4, (ch.maxY - ch.minY) / 2);
      const vx = mx - cam.x, vy = my - cam.y, vz = mz - cam.z;
      const hd = Math.hypot(vx, vz);
      if (hd - 11.4 > R) continue;
      const dist = Math.hypot(vx, vy, vz);
      if (dist > rad) {
        const cosA = (vx * f[0] + vy * f[1] + vz * f[2]) / dist;
        const ang = Math.acos(clamp(cosA, -1, 1));
        if (ang - Math.asin(Math.min(1, rad / dist)) > diag) continue;
      }
      chunks++;

      const faces = ch.faces;
      for (let i = 0, n = ch.faceCount * FACE_STRIDE; i < n; i += FACE_STRIDE) {
        const bx = faces[i], by = faces[i + 1], bz = faces[i + 2], meta = faces[i + 3];
        const dir = meta & 7;
        // Back-face culling straight from the camera position.
        switch (dir) {
          case 0: if (cam.x <= bx + 1) continue; break;
          case 1: if (cam.x >= bx) continue; break;
          case 2: if (cam.y <= by + 1) continue; break;
          case 3: if (cam.y >= by) continue; break;
          case 4: if (cam.z <= bz + 1) continue; break;
          default: if (cam.z >= bz) continue; break;
        }
        const ddx = bx + 0.5 - cam.x, ddy = by + 0.5 - cam.y, ddz = bz + 0.5 - cam.z;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 > R2) continue;
        // Cheap behind-camera rejection.
        if (ddx * f[0] + ddy * f[1] + ddz * f[2] < -1.8) continue;

        const block = meta >> 8, sky = (meta >> 3) & 3, lamp = (meta >> 5) & 3;
        const def = BLOCKS[block];
        const o = DIR_O[dir], u = DIR_U[dir], w = DIR_V[dir];
        const ox = bx + o[0], oz = bz + o[2];
        let oy = by + o[1];
        if (def.liquid && dir === 2) oy -= 0.12;
        tx[0] = ox; ty[0] = oy; tz[0] = oz;
        tx[1] = ox + u[0]; ty[1] = oy + u[1]; tz[1] = oz + u[2];
        tx[2] = ox + u[0] + w[0]; ty[2] = oy + u[1] + w[1]; tz[2] = oz + u[2] + w[2];
        tx[3] = ox + w[0]; ty[3] = oy + w[1]; tz[3] = oz + w[2];
        this.toCamera(4);

        const bucket = Math.min(MAX_BUCKET, Math.abs(bx - ex) + Math.abs(by - ey) + Math.abs(bz - ez));
        const order = (MAX_BUCKET - bucket) * 4;
        const dist2 = Math.sqrt(d2);
        const fog = this.fogLevel(dist2);
        const tex = FACE_TEX[block * 6 + dir];
        const alpha = def.alpha, emissive = def.light > 0;
        const translucent = alpha < 255;
        const lod = translucent && block !== B.GLASS ? null : this.lodFor(tex, dist2);

        let color: number;
        if (def.liquid) {
          // Shimmer: slide between three tones of the liquid with a travelling wave.
          const wv = Math.sin(time * (block === B.LAVA ? 0.6 : 1.4) + bx * 0.9 + bz * 0.6) + Math.sin(time * 0.9 - bz * 0.8 + bx * 0.3);
          const k = wv > 0.7 ? 1.1 : wv < -0.7 ? 0.9 : 1;
          const a = tex.avg;
          color = palette.id(a[0] * k * DIR_SHADE[dir], a[1] * k * DIR_SHADE[dir], a[2] * k * DIR_SHADE[dir], alpha, sky, emissive ? 3 : lamp);
        } else if (lod) color = this.toneId(lod.ids[lod.base], lod.tones[lod.base], alpha, dir, sky, lamp, emissive);
        else color = this.toneId(tex.avgIds, tex.avg, alpha, dir, sky, lamp, emissive);

        const hasDetail = lod !== null && lod.rects.length > 0;
        const ao = faces[i + 4];
        const wantAO = ao !== 0 && dist2 < AO_DIST;
        if (hasDetail || wantAO) this.latchQuad();
        if (!this.pushPoly(4, order + Layer.TERRAIN, color, fog, color, translucent ? 0 : 0.6)) continue;

        if (hasDetail) {
          const rc = lod!.rects, inv = 1 / lod!.n, side = dir !== 2 && dir !== 3, cellAlpha = translucent ? 230 : 255;
          for (let k = 0; k < rc.length; k += 5) {
            const tone = rc[k + 4];
            const id = this.toneId(lod!.ids[tone], lod!.tones[tone], cellAlpha, dir, sky, lamp, emissive);
            // Side faces run their u axis right to left as seen from outside, so mirror the texels.
            const u0 = side ? 1 - rc[k + 2] * inv : rc[k] * inv, u1 = side ? 1 - rc[k] * inv : rc[k + 2] * inv;
            this.pushCell(u0, rc[k + 1] * inv, u1, rc[k + 3] * inv, order + Layer.DECAL, id, fog, id, 0.3);
          }
        }
        if (wantAO) {
          const a1 = this.aoId, a2 = this.aoId2, oa = order + Layer.AO;
          if (ao & 1) { this.pushCell(0, 0, AO_W, 1, oa, a1, fog, a1, 0); this.pushCell(0, 0, AO_W * 0.45, 1, oa, a2, fog, a2, 0); }
          if (ao & 2) { this.pushCell(1 - AO_W, 0, 1, 1, oa, a1, fog, a1, 0); this.pushCell(1 - AO_W * 0.45, 0, 1, 1, oa, a2, fog, a2, 0); }
          if (ao & 4) { this.pushCell(0, 0, 1, AO_W, oa, a1, fog, a1, 0); this.pushCell(0, 0, 1, AO_W * 0.45, oa, a2, fog, a2, 0); }
          if (ao & 8) { this.pushCell(0, 1 - AO_W, 1, 1, oa, a1, fog, a1, 0); this.pushCell(0, 1 - AO_W * 0.45, 1, 1, oa, a2, fog, a2, 0); }
        }
      }

      // Plants and torches
      const pl = ch.plants;
      for (let i = 0, n = ch.plantCount * PLANT_STRIDE; i < n; i += PLANT_STRIDE) {
        const bx = pl[i], by = pl[i + 1], bz = pl[i + 2], meta = pl[i + 3];
        const ddx = bx + 0.5 - cam.x, ddy = by + 0.5 - cam.y, ddz = bz + 0.5 - cam.z;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 > PLANT_DIST * PLANT_DIST || d2 > R2 || ddx * f[0] + ddy * f[1] + ddz * f[2] < -1) continue;
        const id = meta & 255, sky = (meta >> 8) & 3, lamp = (meta >> 10) & 3;
        if (id === B.TORCH) {
          this.drawBox(bx + 0.5, by, bz + 0.5, 0, ZERO, [-0.0625, 0, -0.0625], [0.125, 0.56, 0.125], 0, [132, 96, 52], sky, 3);
          this.drawBox(bx + 0.5, by + 0.56, bz + 0.5, 0, ZERO, [-0.07, 0, -0.07], [0.14, 0.12, 0.14], 0, [255, 214, 90], 0, 3);
          continue;
        }
        const dist2 = Math.sqrt(d2);
        const tex = FACE_TEX[id * 6];
        const lod = this.lodFor(tex, dist2 * 0.8) ?? tex.lods[tex.lods.length - 1];
        const bucket = Math.min(MAX_BUCKET, Math.abs(bx - ex) + Math.abs(by - ey) + Math.abs(bz - ez));
        const order = (MAX_BUCKET - bucket) * 4 + Layer.ENTITY;
        const sub = 65535 - Math.min(65535, Math.floor((dist2 / (R + 2)) * 65535));
        const fog = this.fogLevel(dist2);
        for (let p = 0; p < 2; p++) {
          const a = 0.15, b = 0.85;
          tx[0] = bx + a; tz[0] = bz + (p ? b : a); tx[1] = bx + b; tz[1] = bz + (p ? a : b);
          tx[3] = tx[0]; tz[3] = tz[0];
          ty[0] = ty[1] = by + 1; ty[3] = by;
          tx[2] = tx[1]; ty[2] = by; tz[2] = tz[1];
          this.toCamera(4);
          this.latchQuad();
          this.pushSprite(lod, order, sub, fog, sky, lamp, 1);
        }
      }
    }
    this.stats.chunks = chunks;
    this.stats.collectMs = performance.now() - t0;
  }

  /** Emits the texels of a sprite level onto the latched quad. */
  private pushSprite(lod: TexLod, order: number, sub: number, fog: number, sky: number, lamp: number, shade: number) {
    const rc = lod.rects, inv = 1 / lod.n;
    for (let k = 0; k < rc.length; k += 5) {
      const tone = rc[k + 4], c = lod.tones[tone];
      const id = shade === 1 ? this.toneId(lod.ids[tone], c, 255, 2, sky, lamp, false) : palette.id(c[0] * shade, c[1] * shade, c[2] * shade, 255, sky, lamp);
      this.pushCell(rc[k] * inv, rc[k + 1] * inv, rc[k + 2] * inv, rc[k + 3] * inv, order, sub, fog, id, 0.25);
    }
  }

  /** Break progress overlay on the targeted block. */
  drawCrack(bx: number, by: number, bz: number, progress: number) {
    const stage = CRACKS[clamp(Math.floor(progress * 10), 0, 9)];
    const cam = this.cam, [ex, ey, ez] = this.camCell;
    const bucket = Math.min(MAX_BUCKET, Math.abs(bx - ex) + Math.abs(by - ey) + Math.abs(bz - ez));
    const order = (MAX_BUCKET - bucket) * 4 + Layer.ENTITY;
    const tx = this.tx, ty = this.ty, tz = this.tz, e = 0.003;
    for (let dir = 0; dir < 6; dir++) {
      const vis = dir === 0 ? cam.x > bx + 1 : dir === 1 ? cam.x < bx : dir === 2 ? cam.y > by + 1 : dir === 3 ? cam.y < by : dir === 4 ? cam.z > bz + 1 : cam.z < bz;
      if (!vis) continue;
      const o = DIR_O[dir], u = DIR_U[dir], w = DIR_V[dir];
      const nx = dir === 0 ? e : dir === 1 ? -e : 0, ny = dir === 2 ? e : dir === 3 ? -e : 0, nz = dir === 4 ? e : dir === 5 ? -e : 0;
      const ox = bx + o[0] + nx, oy = by + o[1] + ny, oz = bz + o[2] + nz;
      tx[0] = ox; ty[0] = oy; tz[0] = oz;
      tx[1] = ox + u[0]; ty[1] = oy + u[1]; tz[1] = oz + u[2];
      tx[3] = ox + w[0]; ty[3] = oy + w[1]; tz[3] = oz + w[2];
      tx[2] = tx[1] + w[0]; ty[2] = ty[1] + w[1]; tz[2] = tz[1] + w[2];
      this.toCamera(4);
      this.latchQuad();
      for (const c of stage) { const x = c & 15, y = c >> 4; this.pushCell(x / 16, y / 16, (x + 1) / 16, (y + 1) / 16, order, 65535, 0, this.crackId, 0.2); }
    }
  }

  // ------------------------------------------------------------------ free-form geometry (entities, particles)

  /**
   * Draws an oriented box. The box is defined in part space (min corner `o`, size `s`), rotated
   * around the X axis by `swing` about the part origin, offset by `pivot`, rotated by `yaw`
   * around Y and finally translated to (px, py, pz).
   * `faceDecals` are UV rectangles painted on the front (-Z) face: [u0, v0, u1, v1, r, g, b].
   * `tex` textures the six faces like a block (indexed by block face direction); `rgb` then acts as a tint (255 = neutral).
   */
  drawBox(
    px: number, py: number, pz: number, yaw: number,
    pivot: readonly [number, number, number], o: readonly [number, number, number], s: readonly [number, number, number],
    swing: number, rgb: readonly [number, number, number], sky: number, lampLevel = 0,
    faceDecals?: ReadonlyArray<readonly number[]>, alpha = 255, roll = 0, tex?: Tex[], lodScale = 1,
  ) {
    const cam = this.cam;
    const sy = Math.sin(yaw), cy = Math.cos(yaw), ss = Math.sin(swing), cs = Math.cos(swing), sr = Math.sin(roll), cr = Math.cos(roll);
    // 8 corners in world space
    const wx: number[] = boxWX, wy: number[] = boxWY, wz: number[] = boxWZ;
    for (let i = 0; i < 8; i++) {
      let lx = o[0] + (i & 1 ? s[0] : 0), ly = o[1] + (i & 2 ? s[1] : 0);
      const lz = o[2] + (i & 4 ? s[2] : 0);
      // roll around Z, then swing around X
      const rx = lx * cr - ly * sr, ry = lx * sr + ly * cr; lx = rx; ly = ry;
      const y2 = ly * cs - lz * ss, z2 = ly * ss + lz * cs;
      const ex = lx + pivot[0], ey = y2 + pivot[1], ez = z2 + pivot[2];
      wx[i] = px + ex * cy + ez * sy;
      wy[i] = py + ey;
      wz[i] = pz - ex * sy + ez * cy;
    }
    const mx = (wx[0] + wx[7]) / 2, my = (wy[0] + wy[7]) / 2, mz = (wz[0] + wz[7]) / 2;
    const dist = Math.hypot(mx - cam.x, my - cam.y, mz - cam.z);
    if (dist > this.renderDistance) return;
    const bucket = Math.min(MAX_BUCKET, Math.abs(Math.floor(mx) - this.camCell[0]) + Math.abs(Math.floor(my) - this.camCell[1]) + Math.abs(Math.floor(mz) - this.camCell[2]));
    const order = (MAX_BUCKET - bucket) * 4 + Layer.ENTITY;
    const fog = this.fogLevel(dist);
    const tx = this.tx, ty = this.ty, tz = this.tz;

    for (let fi = 0; fi < 6; fi++) {
      const q = BOX_FACES[fi];
      const a = q[0], b = q[1], c = q[2], d = q[3];
      // Face normal from two edges; cull if facing away.
      const e1x = wx[b] - wx[a], e1y = wy[b] - wy[a], e1z = wz[b] - wz[a];
      const e2x = wx[d] - wx[a], e2y = wy[d] - wy[a], e2z = wz[d] - wz[a];
      let nx = e2y * e1z - e2z * e1y, ny = e2z * e1x - e2x * e1z, nz = e2x * e1y - e2y * e1x;
      const fcx = (wx[a] + wx[c]) / 2, fcy = (wy[a] + wy[c]) / 2, fcz = (wz[a] + wz[c]) / 2;
      if (nx * (cam.x - fcx) + ny * (cam.y - fcy) + nz * (cam.z - fcz) <= 0) continue;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const shade = 0.74 + ny * 0.22 + nz * 0.08 - Math.abs(nx) * 0.1;
      tx[0] = wx[a]; ty[0] = wy[a]; tz[0] = wz[a];
      tx[1] = wx[b]; ty[1] = wy[b]; tz[1] = wz[b];
      tx[2] = wx[c]; ty[2] = wy[c]; tz[2] = wz[c];
      tx[3] = wx[d]; ty[3] = wy[d]; tz[3] = wz[d];
      this.toCamera(4);
      const fd = Math.hypot(fcx - cam.x, fcy - cam.y, fcz - cam.z);
      const sub = 65535 - Math.min(65535, Math.floor((fd / (this.renderDistance + 2)) * 65535));

      if (tex) {
        const t = tex[BOX_DIR[fi]], lod = this.lodFor(t, dist * lodScale);
        const k = shade / 255, kr = rgb[0] * k, kg = rgb[1] * k, kb = rgb[2] * k;
        const base = lod ? lod.tones[lod.base] : t.avg;
        this.latchQuad();
        if (!this.pushPoly(4, order, sub, fog, palette.id(base[0] * kr, base[1] * kg, base[2] * kb, alpha, sky, lampLevel), 0.3)) continue;
        if (lod) {
          const rc = lod.rects, inv = 1 / lod.n;
          for (let r = 0; r < rc.length; r += 5) {
            const tc = lod.tones[rc[r + 4]];
            this.pushCell(rc[r] * inv, rc[r + 1] * inv, rc[r + 2] * inv, rc[r + 3] * inv, order, sub, fog, palette.id(tc[0] * kr, tc[1] * kg, tc[2] * kb, alpha, sky, lampLevel), 0.2);
          }
        }
        continue;
      }

      const color = palette.id(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, alpha, sky, lampLevel);
      if (faceDecals && fi === 0 && dist < 24) this.latchQuad();
      if (!this.pushPoly(4, order, sub, fog, color, 0.3)) continue;
      if (fi === 0 && faceDecals && dist < 24) {
        // Front face: u runs left to right, v top to bottom as seen from the front.
        for (const dc of faceDecals) this.pushCell(dc[0], dc[1], dc[2], dc[3], order, sub, fog, palette.id(dc[4] * shade, dc[5] * shade, dc[6] * shade, 255, sky, lampLevel), 0);
      }
    }
  }

  /** Upright, camera-facing sprite (dropped non-block items). */
  drawSpriteBillboard(x: number, y: number, z: number, size: number, tex: Tex, sky: number, lamp = 0) {
    const cam = this.cam;
    const dist = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    if (dist > this.renderDistance) return;
    const h = size / 2, rx = cam.cosY * h, rz = -cam.sinY * h;
    const tx = this.tx, ty = this.ty, tz = this.tz;
    tx[0] = x - rx; ty[0] = y + size; tz[0] = z - rz;
    tx[1] = x + rx; ty[1] = y + size; tz[1] = z + rz;
    tx[3] = x - rx; ty[3] = y; tz[3] = z - rz;
    tx[2] = x + rx; ty[2] = y; tz[2] = z + rz;
    this.toCamera(4);
    this.latchQuad();
    const bucket = Math.min(MAX_BUCKET, Math.abs(Math.floor(x) - this.camCell[0]) + Math.abs(Math.floor(y) - this.camCell[1]) + Math.abs(Math.floor(z) - this.camCell[2]));
    const sub = 65535 - Math.min(65535, Math.floor((dist / (this.renderDistance + 2)) * 65535));
    const lod = this.lodFor(tex, dist * 2.2) ?? tex.lods[tex.lods.length - 1];
    this.pushSprite(lod, (MAX_BUCKET - bucket) * 4 + Layer.ENTITY, sub, this.fogLevel(dist), sky, lamp, 1);
  }

  /** Camera-facing square, used for particles. */
  drawBillboard(x: number, y: number, z: number, size: number, rgb: readonly number[], sky: number, lampLevel = 0, alpha = 255) {
    const cam = this.cam;
    this.tx[0] = x; this.ty[0] = y; this.tz[0] = z;
    this.toCamera(1);
    const zc = this.czs[0];
    if (zc < NEAR * 2) return;
    const dist = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    if (dist > this.renderDistance) return;
    const xc = this.cxs[0], yc = this.cys[0], h = size / 2;
    this.cxs[0] = xc - h; this.cys[0] = yc + h; this.czs[0] = zc;
    this.cxs[1] = xc + h; this.cys[1] = yc + h; this.czs[1] = zc;
    this.cxs[2] = xc + h; this.cys[2] = yc - h; this.czs[2] = zc;
    this.cxs[3] = xc - h; this.cys[3] = yc - h; this.czs[3] = zc;
    const bucket = Math.min(MAX_BUCKET, Math.abs(Math.floor(x) - this.camCell[0]) + Math.abs(Math.floor(y) - this.camCell[1]) + Math.abs(Math.floor(z) - this.camCell[2]));
    const sub = 65535 - Math.min(65535, Math.floor((dist / (this.renderDistance + 2)) * 65535));
    this.pushPoly(4, (MAX_BUCKET - bucket) * 4 + Layer.ENTITY, sub, this.fogLevel(dist), palette.id(rgb[0], rgb[1], rgb[2], alpha, sky, lampLevel), 0);
  }

  /**
   * First person hand. Geometry is built directly in camera space (x right, y up, z forward)
   * and drawn above everything else.
   */
  drawHeld(hv: HeldView) {
    const sw = Math.sin(hv.swing * Math.PI);
    const ox = 0.62 + hv.bobX - sw * 0.24, oy = -0.5 + hv.bobY - hv.drop * 0.5 + sw * 0.1, oz = 1.05 - sw * 0.1;
    const rotX = -sw * 0.9, xs = this.cxs, ys = this.cys, zs = this.czs;
    const fovK = Math.tan((70 * Math.PI) / 360) / Math.tan((this.cam.fov * Math.PI) / 360); // keep the hand size stable when the FOV changes
    const place = (lx: number, ly: number, lz: number, ry: number, rx: number, i: number) => {
      const c1 = Math.cos(ry), s1 = Math.sin(ry);
      const x1 = lx * c1 + lz * s1, z1 = -lx * s1 + lz * c1;
      const c2 = Math.cos(rx + rotX), s2 = Math.sin(rx + rotX);
      const y2 = ly * c2 - z1 * s2, z2 = ly * s2 + z1 * c2;
      hx[i] = (ox + x1) / fovK; hy[i] = (oy + y2) / fovK; hz[i] = oz + z2;
    };

    if (hv.sprite) {
      // A flat item held upright and slightly turned inwards.
      const s = 0.62, ry = 0.6, rx = -0.12, up = 0.1;
      place(-s / 2, s / 2 + up, 0, ry, rx, 0); place(s / 2, s / 2 + up, 0, ry, rx, 1); place(s / 2, -s / 2 + up, 0, ry, rx, 2); place(-s / 2, -s / 2 + up, 0, ry, rx, 3);
      for (let k = 0; k < 4; k++) { xs[k] = hx[k]; ys[k] = hy[k]; zs[k] = hz[k]; }
      this.latchQuad();
      const lod = hv.sprite.lods[0], rc = lod.rects;
      for (let r = 0; r < rc.length; r += 5) {
        const c = lod.tones[rc[r + 4]];
        const id = palette.id(c[0], c[1], c[2], 255, hv.sky, hv.lamp);
        this.pushCell(rc[r] / 16, rc[r + 1] / 16, rc[r + 2] / 16, rc[r + 3] / 16, HAND_ORDER, 1 + rc[r + 4], 0, id, 0.3);
      }
      return;
    }

    const isBlock = hv.block > 0;
    const sx = isBlock ? 0.4 : 0.2, syy = isBlock ? 0.4 : 0.75, sz = isBlock ? 0.4 : 0.2;
    const ry = isBlock ? 0.7 : 0.35, rx = isBlock ? 0.12 : 1.05;
    for (let i = 0; i < 8; i++) place((i & 1 ? 0.5 : -0.5) * sx, (i & 2 ? 0.5 : -0.5) * syy - (isBlock ? 0 : 0.1), (i & 4 ? 0.5 : -0.5) * sz, ry, rx, i);
    const tex = isBlock ? blockTextures(hv.block) : null;
    for (let fi = 0; fi < 6; fi++) {
      const f = BOX_FACES[fi], a = f[0], b = f[1], c = f[2], d = f[3];
      const e1x = hx[b] - hx[a], e1y = hy[b] - hy[a], e1z = hz[b] - hz[a];
      const e2x = hx[d] - hx[a], e2y = hy[d] - hy[a], e2z = hz[d] - hz[a];
      const nx = e2y * e1z - e2z * e1y, ny = e2z * e1x - e2x * e1z, nz = e2x * e1y - e2y * e1x;
      const fcx = (hx[a] + hx[c]) / 2, fcy = (hy[a] + hy[c]) / 2, fcz = (hz[a] + hz[c]) / 2;
      if (nx * -fcx + ny * -fcy + nz * -fcz <= 0) continue;
      const shade = DIR_SHADE[BOX_DIR[fi]];
      xs[0] = hx[a]; ys[0] = hy[a]; zs[0] = hz[a]; xs[1] = hx[b]; ys[1] = hy[b]; zs[1] = hz[b];
      xs[2] = hx[c]; ys[2] = hy[c]; zs[2] = hz[c]; xs[3] = hx[d]; ys[3] = hy[d]; zs[3] = hz[d];
      this.latchQuad();
      if (tex) {
        const lod = tex[BOX_DIR[fi]].lods[0], base = lod.tones[lod.base];
        const alpha = Math.max(BLOCKS[hv.block].alpha, 170);
        this.pushPoly(4, HAND_ORDER, 0, 0, palette.id(base[0] * shade, base[1] * shade, base[2] * shade, alpha, hv.sky, hv.lamp), 0.4);
        const rc = lod.rects;
        for (let r = 0; r < rc.length; r += 5) {
          const tc = lod.tones[rc[r + 4]];
          this.pushCell(rc[r] / 16, rc[r + 1] / 16, rc[r + 2] / 16, rc[r + 3] / 16, HAND_ORDER, 1 + rc[r + 4] + fi * 8, 0, palette.id(tc[0] * shade, tc[1] * shade, tc[2] * shade, 255, hv.sky, hv.lamp), 0.3);
        }
      } else {
        this.pushPoly(4, HAND_ORDER, 0, 0, palette.id(245 * shade, 205 * shade, 48 * shade, 255, hv.sky, hv.lamp), 0.4);
      }
    }
  }

  // ------------------------------------------------------------------ emit to ThorVG

  private cmdsFor(quads: number): Uint8Array {
    // Fast path: runs made only of quads share cached command arrays.
    let c = this.cmdCache[quads];
    if (!c) {
      c = new Uint8Array(quads * 5);
      for (let i = 0; i < quads; i++) { const o = i * 5; c[o] = 1; c[o + 1] = 2; c[o + 2] = 2; c[o + 3] = 2; c[o + 4] = 0; }
      if (quads < 1024) this.cmdCache[quads] = c;
    }
    return c;
  }

  end(env: Environment) {
    const t0 = performance.now();
    const n = this.count;
    const sorted = this.keys.subarray(0, n);
    sorted.sort();

    const pal = palette;
    const v = this.verts;
    const ptPool = this.ptPool;
    let used = 0;
    let i = 0;
    while (i < n) {
      const k0 = sorted[i];
      const group = Math.floor(k0 / MAX_POLYS);
      const first = k0 - group * MAX_POLYS;
      const color = this.pColor[first];
      // Collect the run sharing (order, sub, fog) and color.
      let j = i, pts = 0, allQuads = true;
      const runStart = i;
      while (j < n) {
        const kj = sorted[j];
        const gj = Math.floor(kj / MAX_POLYS);
        if (gj !== group) break;
        const idx = kj - gj * MAX_POLYS;
        if (this.pColor[idx] !== color) break;
        const m = this.pN[idx];
        if (m !== 4) allQuads = false;
        pts += m;
        j++;
        if (pts > 4000) break;
      }
      i = j;

      while (ptPool.length < pts) ptPool.push([0, 0]);
      let cmds: Uint8Array | number[];
      if (allQuads) cmds = this.cmdsFor(j - runStart);
      else cmds = [];
      let p = 0;
      for (let r = runStart; r < j; r++) {
        const kr = sorted[r];
        const idx = kr - Math.floor(kr / MAX_POLYS) * MAX_POLYS;
        const m = this.pN[idx];
        let o = this.pStart[idx];
        if (!allQuads) { (cmds as number[]).push(1); for (let q = 1; q < m; q++) (cmds as number[]).push(2); (cmds as number[]).push(0); }
        for (let q = 0; q < m; q++) {
          const pt = ptPool[p++];
          pt[0] = v[o++]; pt[1] = v[o++];
        }
      }

      let shape = this.pool[used];
      if (!shape) {
        shape = new this.TVG.Shape();
        this.pool.push(shape);
        this.scene.add(shape);
      }
      used++;
      const ptsArr = pts === ptPool.length ? ptPool : ptPool.slice(0, pts);
      shape.reset().appendPath(cmds, ptsArr);

      // Lighting and fog
      const fog = group % FOG_LEVELS;
      const ft = fog / (FOG_LEVELS - 1);
      const skyL = SKY_MUL[pal.sky[color]], lampL = LAMP_MUL[pal.lamp[color]];
      const lr = Math.max(env.sun[0] * skyL, lampL), lg = Math.max(env.sun[1] * skyL, lampL * 0.93), lb = Math.max(env.sun[2] * skyL, lampL * 0.78);
      let r = pal.r[color] * lr, g = pal.g[color] * lg, b = pal.b[color] * lb;
      r += (env.fog[0] - r) * ft; g += (env.fog[1] - g) * ft; b += (env.fog[2] - b) * ft;
      shape.fill(r | 0, g | 0, b | 0, pal.a[color]);
    }
    for (let k = used; k < this.usedLast; k++) this.pool[k].reset();
    this.usedLast = used;
    this.stats.polys = n;
    this.stats.shapes = used;
    this.stats.emitMs = performance.now() - t0;
  }

  // ------------------------------------------------------------------ sky

  /** Projects a direction (not a position). Returns null when behind the camera. */
  private projectDir(dx: number, dy: number, dz: number): [number, number, number] | null {
    const c = this.cam;
    const zt = -dx * c.sinY - dz * c.cosY;
    const xc = dx * c.cosY - dz * c.sinY, yc = dy * c.cosP - zt * c.sinP, zc = zt * c.cosP + dy * c.sinP;
    if (zc < 0.05) return null;
    return [c.cx + (xc / zc) * c.focal, c.cy - (yc / zc) * c.focal, zc];
  }

  drawSky(env: Environment) {
    const c = this.cam, TVG = this.TVG;
    const horizonY = c.cy + Math.tan(c.pitch) * c.focal;
    const span = c.focal * 1.4;
    const grad = new TVG.LinearGradient(0, horizonY - span, 0, horizonY + span * 0.05);
    const z = env.zenith, f = env.fog;
    grad.addStop(0, [z[0] | 0, z[1] | 0, z[2] | 0, 255]);
    grad.addStop(0.62, [((z[0] + f[0]) / 2) | 0, ((z[1] + f[1]) / 2) | 0, ((z[2] + f[2]) / 2) | 0, 255]);
    grad.addStop(1, [f[0] | 0, f[1] | 0, f[2] | 0, 255]);
    this.skyShape.reset().appendRect(0, 0, c.w, c.h).fill(grad);

    // Stars
    this.starShape.reset();
    if (env.night > 0.25) {
      const rot = env.time * 0.004, sr = Math.sin(rot), cr = Math.cos(rot);
      for (let i = 0; i < this.stars.length; i += 4) {
        const sx = this.stars[i] * cr - this.stars[i + 1] * sr, sy = this.stars[i] * sr + this.stars[i + 1] * cr;
        if (sy < 0.02) continue;
        const p = this.projectDir(sx, sy, this.stars[i + 2]);
        if (!p || p[0] < 0 || p[0] > c.w || p[1] < 0 || p[1] > c.h) continue;
        const s = this.stars[i + 3];
        this.starShape.appendRect(p[0] - s / 2, p[1] - s / 2, s, s);
      }
      this.starShape.fill(255, 255, 240, Math.floor(clamp((env.night - 0.25) * 1.6, 0, 1) * 230));
    }

    // Sun and moon are SVG pictures placed in screen space.
    const sd = env.sunDir;
    const sun = this.projectDir(sd[0], sd[1], sd[2]);
    this.sunGlow.reset();
    const sunUp = !!sun && sd[1] > -0.12;
    if (sunUp) {
      const s = c.focal * 0.2;
      const glow = new TVG.RadialGradient(sun![0], sun![1], s * 1.9);
      glow.addStop(0, [255, 236, 170, 150]).addStop(1, [255, 220, 150, 0]);
      this.sunGlow.appendCircle(sun![0], sun![1], s * 1.9, s * 1.9).fill(glow);
      this.sunPic.size(s, s).translate(sun![0] - s / 2, sun![1] - s / 2);
    }
    this.sunPic.visible(sunUp);
    const moon = this.projectDir(-sd[0], -sd[1], -sd[2]);
    const moonUp = !!moon && -sd[1] > -0.12;
    for (let i = 0; i < MOON_PHASES; i++) this.moonPics[i].visible(moonUp && i === env.moonPhase);
    if (moonUp) { const s = c.focal * 0.17; this.moonPics[env.moonPhase].size(s, s).translate(moon![0] - s / 2, moon![1] - s / 2); }

    // Cloud layer: SVG pictures scattered on a drifting grid high above the world, scaled by depth.
    const CY = WH + 34, cell = 56, reach = 5, maxD = cell * (reach + 0.5);
    const used = [0, 0, 0];
    if (c.y < CY - 2) {
      const drift = env.time * 1.1;
      const bx = Math.floor((c.x - drift) / cell), bz = Math.floor(c.z / cell);
      for (let gz = -reach; gz <= reach; gz++) for (let gx = -reach; gx <= reach; gx++) {
        const ix = bx + gx, iz = bz + gz, hsh = cloudHash(ix, iz);
        if (hsh > 0.42) continue;
        const variant = Math.floor(hsh * 1000) % CLOUD_VARIANTS;
        if (used[variant] >= CLOUD_POOL) continue;
        const wx = (ix + 0.5 + (hsh * 7 % 1 - 0.5) * 0.6) * cell + drift, wz = (iz + 0.5 + (hsh * 13 % 1 - 0.5) * 0.6) * cell;
        const hd = Math.hypot(wx - c.x, wz - c.z);
        if (hd > maxD) continue;
        const p = this.projectDir(wx - c.x, CY - c.y, wz - c.z);
        if (!p || p[2] < 6) continue;
        const w = (c.focal * (52 + hsh * 90)) / p[2], h = w * 0.4;
        if (p[0] + w < 0 || p[0] - w > c.w || p[1] + h < 0 || p[1] - h > c.h) continue;
        const pic = this.cloudPics[variant][used[variant]++];
        pic.visible(true).size(w, h).translate(p[0] - w / 2, p[1] - h / 2).opacity(Math.floor(235 * clamp(1.5 - (hd / maxD) * 1.5, 0, 1)));
      }
    }
    for (let v = 0; v < CLOUD_VARIANTS; v++) for (let i = used[v]; i < CLOUD_POOL; i++) this.cloudPics[v][i].visible(false);
    // Recolor the clouds with a tint effect: warm at dusk, dark blue at night. Only when the (quantized) color changes.
    const q = (x: number) => Math.round(x / 12) * 12;
    const l = 1 - env.night * 0.72;
    const wr = q((255 * 0.7 + env.fog[0] * 0.3) * l), wg = q((255 * 0.7 + env.fog[1] * 0.3) * l), wb = q((255 * 0.72 + env.fog[2] * 0.28) * Math.min(1, l + 0.1));
    const key = wr + ',' + wg + ',' + wb;
    if (key !== this.cloudKey) {
      this.cloudKey = key;
      try { this.cloudScene.resetEffects(); if (wr < 250 || wg < 250 || wb < 250) this.cloudScene.tint(wr * 0.45, wg * 0.5, wb * 0.62, wr, wg, wb, 100); } catch { /* effects unsupported */ }
    }
  }

  // ------------------------------------------------------------------ overlays

  /** Outlines the targeted block. */
  drawSelection(bx: number, by: number, bz: number) {
    this.outline.reset();
    const e = 0.004;
    const tx = this.tx, ty = this.ty, tz = this.tz;
    for (let i = 0; i < 8; i++) {
      tx[i] = bx + (i & 1 ? 1 + e : -e); ty[i] = by + (i & 2 ? 1 + e : -e); tz[i] = bz + (i & 4 ? 1 + e : -e);
    }
    this.toCamera(8);
    for (let i = 0; i < 8; i++) if (this.czs[i] < NEAR) return;
    const c = this.cam;
    const sx: number[] = [], sy: number[] = [];
    for (let i = 0; i < 8; i++) { const inv = c.focal / this.czs[i]; sx[i] = c.cx + this.cxs[i] * inv; sy[i] = c.cy - this.cys[i] * inv; }
    for (const [a, b] of BOX_EDGES) this.outline.moveTo(sx[a], sy[a]).lineTo(sx[b], sy[b]);
    this.outline.stroke({ width: 2, color: [16, 16, 20, 220], cap: 'round', join: 'round' });
  }

  clearSelection() { this.outline.reset(); }
}

const ZERO: readonly [number, number, number] = [0, 0, 0];
const hx = new Float64Array(8), hy = new Float64Array(8), hz = new Float64Array(8);
const boxWX: number[] = new Array(8).fill(0), boxWY: number[] = new Array(8).fill(0), boxWZ: number[] = new Array(8).fill(0);

// Corner index bits: 1 = +x, 2 = +y, 4 = +z. Face 0 is the front (-Z) face, listed
// top-left, top-right, bottom-right, bottom-left as seen from the front; every face is
// wound so that (d - a) x (b - a) points outwards.
const BOX_FACES: ReadonlyArray<readonly number[]> = [
  [3, 2, 0, 1], // -Z front
  [6, 7, 5, 4], // +Z back
  [2, 6, 4, 0], // -X
  [7, 3, 1, 5], // +X
  [6, 2, 3, 7], // +Y top
  [0, 4, 5, 1], // -Y bottom
];
const BOX_DIR = [5, 4, 1, 0, 2, 3];
const BOX_EDGES: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

function cloudHash(x: number, z: number) {
  let h = (Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  // Blend with a coarser cell so clouds clump together.
  let g = (Math.imul(x >> 2, 83492791) ^ Math.imul(z >> 2, 49979687)) | 0;
  g = Math.imul(g ^ (g >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 0.5 + (((g ^ (g >>> 16)) >>> 0) / 4294967296) * 0.5;
}
