// Software 3D pipeline on top of a 2D vector engine.
//
// ThorVG has no depth buffer, so visibility is solved with the painter's algorithm. For unit
// cubes on a grid there is an exact ordering: if block A hides block B from the camera, A is
// closer than B along every axis, so its Manhattan cell distance is strictly smaller. Faces
// are therefore bucketed by Manhattan distance and drawn far to near. Faces inside one bucket
// never hide each other, which leaves us free to sort them by color and merge every
// (bucket, color, fog) run into a single multi-subpath Shape.

import { DIR_O, DIR_U, DIR_V, LAMP_MUL, SKY_MUL, decals, palette } from './blocks';
import { CS, FACE_STRIDE, WH, World } from './world';
import { clamp } from './math';

const MAX_POLYS = 65536;
const MAX_BUCKET = 255;
const NEAR = 0.08;
const FOG_LEVELS = 32;
const DECAL_DIST = 9;

export const enum Layer { TERRAIN = 0, DECAL = 1, ENTITY = 2 }

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
  time: number; // seconds, for animation
  underwater: boolean;
}

export interface RenderStats { polys: number; shapes: number; chunks: number; collectMs: number; emitMs: number }

type TVGNS = any;

export class Renderer3D {
  readonly scene: any;
  readonly skyScene: any;
  readonly overlayScene: any;
  renderDistance = 56;
  stats: RenderStats = { polys: 0, shapes: 0, chunks: 0, collectMs: 0, emitMs: 0 };

  private TVG: TVGNS;
  private pool: any[] = [];
  private usedLast = 0;
  private skyShape: any; private sunShape: any; private moonShape: any; private starShape: any; private cloudShape: any; private sunGlow: any;
  private outline: any; private crack: any;

  // Per-frame polygon store
  private keys = new Float64Array(MAX_POLYS);
  private pStart = new Uint32Array(MAX_POLYS);
  private pN = new Uint8Array(MAX_POLYS);
  private pColor = new Uint16Array(MAX_POLYS);
  private verts = new Float32Array(MAX_POLYS * 12);
  private count = 0;
  private vtop = 0;

  // Scratch
  private cxs = new Float64Array(8); private cys = new Float64Array(8); private czs = new Float64Array(8);
  private tx = new Float64Array(8); private ty = new Float64Array(8); private tz = new Float64Array(8);
  private ptPool: number[][] = [];
  private cmdCache: number[][] = [];
  private stars: number[] = [];
  private cam!: Camera;
  private camCell = [0, 0, 0];

  constructor(TVG: TVGNS) {
    this.TVG = TVG;
    this.skyScene = new TVG.Scene();
    this.scene = new TVG.Scene();
    this.overlayScene = new TVG.Scene();
    this.skyShape = new TVG.Shape();
    this.starShape = new TVG.Shape();
    this.sunGlow = new TVG.Shape();
    this.sunShape = new TVG.Shape();
    this.moonShape = new TVG.Shape();
    this.cloudShape = new TVG.Shape();
    this.skyScene.add(this.skyShape).add(this.starShape).add(this.sunGlow).add(this.sunShape).add(this.moonShape).add(this.cloudShape);
    this.outline = new TVG.Shape();
    this.crack = new TVG.Shape();
    this.overlayScene.add(this.crack).add(this.outline);

    // Fixed star field on the unit sphere.
    let s = 1234567;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
    for (let i = 0; i < 220; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      this.stars.push(r * Math.cos(a), u, r * Math.sin(a), 0.6 + rnd() * 1.4);
    }
  }

  // ------------------------------------------------------------------ frame lifecycle

  begin(cam: Camera) {
    this.cam = cam;
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
    if (this.count >= MAX_POLYS) return false;
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
    this.keys[idx] = ((order * 4096 + sub) * FOG_LEVELS + fog) * MAX_POLYS + idx;
    return true;
  }

  private fogLevel(dist: number): number {
    const R = this.renderDistance;
    const t = clamp((dist - R * 0.45) / (R * 0.55), 0, 1);
    return Math.min(FOG_LEVELS - 1, Math.floor(t * t * FOG_LEVELS));
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
    let chunks = 0;

    for (let dcz = -cr; dcz <= cr; dcz++) for (let dcx = -cr; dcx <= cr; dcx++) {
      if (!world.hasChunk(ccx + dcx, ccz + dcz)) continue;
      const ch = world.chunkAt(ccx + dcx, ccz + dcz);
      if (!ch.meshed || ch.faceCount === 0) continue;

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

        const block = meta >> 8;
        const o = DIR_O[dir], u = DIR_U[dir], w = DIR_V[dir];
        const ox = bx + o[0], oz = bz + o[2];
        let oy = by + o[1];
        const liquidTop = block === 5 /* WATER */ && dir === 2;
        if (liquidTop) oy -= 0.12;
        tx[0] = ox; ty[0] = oy; tz[0] = oz;
        tx[1] = ox + u[0]; ty[1] = oy + u[1]; tz[1] = oz + u[2];
        tx[2] = ox + u[0] + w[0]; ty[2] = oy + u[1] + w[1]; tz[2] = oz + u[2] + w[2];
        tx[3] = ox + w[0]; ty[3] = oy + w[1]; tz[3] = oz + w[2];
        this.toCamera(4);

        const bucket = Math.min(MAX_BUCKET, Math.abs(bx - ex) + Math.abs(by - ey) + Math.abs(bz - ez));
        const order = (MAX_BUCKET - bucket) * 4;
        const dist2 = Math.sqrt(d2);
        const fog = this.fogLevel(dist2);
        const color = faces[i + 4];
        const translucent = palette.a[color] < 255;
        if (!this.pushPoly(4, order + Layer.TERRAIN, color & 4095, fog, color, translucent ? 0 : 0.6)) continue;

        // Vector "textures" for nearby faces.
        if (dist2 < DECAL_DIST) {
          const list = decals[block][dir];
          if (list.length) {
            const li = ((meta >> 3) & 3) * 4 + ((meta >> 5) & 3);
            for (let k = 0; k < list.length; k++) {
              const dc = list[k];
              this.faceRect(ox, oy, oz, u, w, dc.u0, dc.v0, dc.u1, dc.v1);
              this.toCamera(4);
              this.pushPoly(4, order + Layer.DECAL, dc.ids[li] & 4095, fog, dc.ids[li], 0);
            }
          }
        }
      }
    }
    this.stats.chunks = chunks;
    this.stats.collectMs = performance.now() - t0;
  }

  private faceRect(ox: number, oy: number, oz: number, u: readonly number[], w: readonly number[], u0: number, v0: number, u1: number, v1: number) {
    const tx = this.tx, ty = this.ty, tz = this.tz;
    tx[0] = ox + u[0] * u0 + w[0] * v0; ty[0] = oy + u[1] * u0 + w[1] * v0; tz[0] = oz + u[2] * u0 + w[2] * v0;
    tx[1] = ox + u[0] * u1 + w[0] * v0; ty[1] = oy + u[1] * u1 + w[1] * v0; tz[1] = oz + u[2] * u1 + w[2] * v0;
    tx[2] = ox + u[0] * u1 + w[0] * v1; ty[2] = oy + u[1] * u1 + w[1] * v1; tz[2] = oz + u[2] * u1 + w[2] * v1;
    tx[3] = ox + u[0] * u0 + w[0] * v1; ty[3] = oy + u[1] * u0 + w[1] * v1; tz[3] = oz + u[2] * u0 + w[2] * v1;
  }

  // ------------------------------------------------------------------ free-form geometry (entities, particles)

  /**
   * Draws an oriented box. The box is defined in part space (min corner `o`, size `s`), rotated
   * around the X axis by `swing` about the part origin, offset by `pivot`, rotated by `yaw`
   * around Y and finally translated to (px, py, pz).
   * `faceDecals` are UV rectangles painted on the front (-Z) face: [u0, v0, u1, v1, r, g, b].
   */
  drawBox(
    px: number, py: number, pz: number, yaw: number,
    pivot: readonly [number, number, number], o: readonly [number, number, number], s: readonly [number, number, number],
    swing: number, rgb: readonly [number, number, number], sky: number, lampLevel = 0,
    faceDecals?: ReadonlyArray<readonly number[]>, alpha = 255, roll = 0,
  ) {
    const cam = this.cam;
    const sy = Math.sin(yaw), cy = Math.cos(yaw), ss = Math.sin(swing), cs = Math.cos(swing), sr = Math.sin(roll), cr = Math.cos(roll);
    // 8 corners in world space
    const wx: number[] = boxWX, wy: number[] = boxWY, wz: number[] = boxWZ;
    for (let i = 0; i < 8; i++) {
      let lx = o[0] + (i & 1 ? s[0] : 0), ly = o[1] + (i & 2 ? s[1] : 0), lz = o[2] + (i & 4 ? s[2] : 0);
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
      const sub = 4095 - Math.min(4095, Math.floor((fd / (this.renderDistance + 2)) * 4095));
      const color = palette.id(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, alpha, sky, lampLevel);
      if (!this.pushPoly(4, order, sub, fog, color, 0.3)) continue;

      if (fi === 0 && faceDecals && dist < 24) {
        // Front face corners: a = top-left, b = top-right, c = bottom-right, d = bottom-left (seen from the front)
        for (const dc of faceDecals) {
          for (let k = 0; k < 4; k++) {
            const uu = k === 0 || k === 3 ? dc[0] : dc[2], vv = k < 2 ? dc[1] : dc[3];
            tx[k] = wx[a] + (wx[b] - wx[a]) * uu + (wx[d] - wx[a]) * vv;
            ty[k] = wy[a] + (wy[b] - wy[a]) * uu + (wy[d] - wy[a]) * vv;
            tz[k] = wz[a] + (wz[b] - wz[a]) * uu + (wz[d] - wz[a]) * vv;
          }
          this.toCamera(4);
          const dcol = palette.id(dc[4] * shade, dc[5] * shade, dc[6] * shade, 255, sky, lampLevel);
          this.pushPoly(4, order, sub, fog, dcol, 0);
        }
      }
    }
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
    const sub = 4095 - Math.min(4095, Math.floor((dist / (this.renderDistance + 2)) * 4095));
    this.pushPoly(4, (MAX_BUCKET - bucket) * 4 + Layer.ENTITY, sub, this.fogLevel(dist), palette.id(rgb[0], rgb[1], rgb[2], alpha, sky, lampLevel), 0);
  }

  // ------------------------------------------------------------------ emit to ThorVG

  private cmdsFor(n: number, quads: number): number[] {
    // Fast path: runs made only of quads share cached command arrays.
    let c = this.cmdCache[quads];
    if (!c) {
      c = [];
      for (let i = 0; i < quads; i++) c.push(1, 2, 2, 2, 0);
      if (quads < 512) this.cmdCache[quads] = c;
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
      let cmds: number[];
      if (allQuads) cmds = this.cmdsFor(pts, j - runStart);
      else cmds = [];
      let p = 0;
      for (let r = runStart; r < j; r++) {
        const kr = sorted[r];
        const idx = kr - Math.floor(kr / MAX_POLYS) * MAX_POLYS;
        const m = this.pN[idx];
        let o = this.pStart[idx];
        if (!allQuads) { cmds.push(1); for (let q = 1; q < m; q++) cmds.push(2); cmds.push(0); }
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

    // Sun and moon are screen-space squares, Minecraft style.
    const sd = env.sunDir;
    const sun = this.projectDir(sd[0], sd[1], sd[2]);
    this.sunShape.reset(); this.sunGlow.reset();
    if (sun && sd[1] > -0.12) {
      const s = c.focal * 0.11;
      const glow = new TVG.RadialGradient(sun[0], sun[1], s * 3.2);
      glow.addStop(0, [255, 236, 170, 150]).addStop(1, [255, 220, 150, 0]);
      this.sunGlow.appendCircle(sun[0], sun[1], s * 3.2, s * 3.2).fill(glow);
      this.sunShape.appendRect(sun[0] - s / 2, sun[1] - s / 2, s, s).fill(255, 244, 200, 255);
    }
    const moon = this.projectDir(-sd[0], -sd[1], -sd[2]);
    this.moonShape.reset();
    if (moon && -sd[1] > -0.12) {
      const s = c.focal * 0.085;
      this.moonShape.appendRect(moon[0] - s / 2, moon[1] - s / 2, s, s).fill(226, 232, 245, 255);
    }

    // Cloud layer: a drifting grid of flat slabs high above the world, drawn behind terrain.
    this.cloudShape.reset();
    const CY = WH + 26, cell = 12, reach = 16;
    if (c.y < CY - 1) {
      const drift = env.time * 0.9;
      const bx = Math.floor((c.x - drift) / cell), bz = Math.floor(c.z / cell);
      let any = false;
      for (let gz = -reach; gz <= reach; gz++) for (let gx = -reach; gx <= reach; gx++) {
        const ix = bx + gx, iz = bz + gz;
        if (cloudHash(ix, iz) > 0.34) continue;
        const x0 = ix * cell + drift, z0 = iz * cell;
        this.tx[0] = x0; this.tz[0] = z0; this.tx[1] = x0 + cell; this.tz[1] = z0;
        this.tx[2] = x0 + cell; this.tz[2] = z0 + cell; this.tx[3] = x0; this.tz[3] = z0 + cell;
        this.ty[0] = this.ty[1] = this.ty[2] = this.ty[3] = CY;
        this.toCamera(4);
        let ok = true;
        for (let k = 0; k < 4; k++) if (this.czs[k] < 1) { ok = false; break; }
        if (!ok) continue;
        for (let k = 0; k < 4; k++) {
          const inv = c.focal / this.czs[k];
          const sx = c.cx + this.cxs[k] * inv, sy = c.cy - this.cys[k] * inv;
          if (k === 0) this.cloudShape.moveTo(sx, sy); else this.cloudShape.lineTo(sx, sy);
        }
        this.cloudShape.close();
        any = true;
      }
      if (any) {
        const l = 0.35 + 0.65 * (1 - env.night);
        this.cloudShape.fill((250 * l) | 0, (250 * l) | 0, (255 * l) | 0, 205);
      }
    }
  }

  // ------------------------------------------------------------------ overlays

  /** Outlines a block (and optionally shows break progress on it). */
  drawSelection(bx: number, by: number, bz: number, progress: number) {
    this.outline.reset(); this.crack.reset();
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

    if (progress > 0) {
      for (let fi = 0; fi < 6; fi++) {
        const q = BOX_FACES_AXIS[fi];
        this.crack.moveTo(sx[q[0]], sy[q[0]]).lineTo(sx[q[1]], sy[q[1]]).lineTo(sx[q[2]], sy[q[2]]).lineTo(sx[q[3]], sy[q[3]]).close();
      }
      this.crack.fill(0, 0, 0, Math.floor(40 + progress * 130));
    }
  }

  clearSelection() { this.outline.reset(); this.crack.reset(); }
}

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
const BOX_FACES_AXIS = BOX_FACES;
const BOX_EDGES: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

function cloudHash(x: number, z: number) {
  let h = (Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  // Blend with a coarser cell so clouds clump together.
  let g = (Math.imul(x >> 2, 83492791) ^ Math.imul(z >> 2, 49979687)) | 0;
  g = Math.imul(g ^ (g >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 0.5 + (((g ^ (g >>> 16)) >>> 0) / 4294967296) * 0.5;
}
