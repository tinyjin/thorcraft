// Turns any Lottie (or SVG) into geometry for the 3D world.
//
// ThorVG keeps a loaded animation as a retained scene tree. After frame(n) we walk that tree with an Accessor,
// read every Shape's outline, colors and stroke, and flatten it to polygons in composition space. The renderer
// then projects those polygons like any other face (Renderer3D.drawFlat): perspective, depth sorting against
// blocks, lighting and fog all apply to artwork that was authored in 2D.
//
// The public API has no parent links or world transforms, but a Shape's oriented bounding box is its tight local
// box pushed through all ancestor transforms. Fitting an affine map from the local box (computed here, exact for
// cubics) to that OBB recovers the full world transform of each shape without knowing the hierarchy.

import { FlatShape, MAX_POLY_VERTS } from './renderer';

export interface FlatFrame { shapes: FlatShape[]; verts: number }

export class LottieAsset {
  frames: (FlatFrame | null)[] = [];
  ready = 0;
  /** Frame currently loaded in the staging picture, waiting for the next canvas update. */
  pending = -1;
  constructor(public name: string, public w: number, public h: number, public total: number, public fps: number, public step: number, readonly anim: any) {
    this.frames = new Array(Math.ceil(total / step)).fill(null);
  }

  /** Nearest extracted frame for a time in seconds, or null while nothing is ready yet. */
  at(t: number, loop = true): FlatFrame | null {
    const n = this.frames.length;
    let i = Math.floor((t * this.fps) / this.step);
    i = loop ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i));
    for (let d = 0; d < n; d++) { const f = this.frames[(i - d + n) % n]; if (f) return f; }
    return null;
  }
}

const OFF = -6000; // staging pictures sit far off screen
const MAX_FRAMES = 96;

export class Lottie3D {
  readonly stage: any;
  assets = new Map<string, LottieAsset>();
  private M: any;
  private buf = 0;
  private accessor: any;

  /** `pixelRatio` reports the canvas device pixel ratio: bounds come back in device pixels, not canvas units. */
  constructor(private TVG: any, private pixelRatio: () => number = () => 1) {
    this.stage = new TVG.Scene();
    this.M = (globalThis as any).__ThorVGModule;
    this.buf = this.M._malloc(64);
    this.accessor = new TVG.Accessor();
  }

  load(name: string, json: string): LottieAsset {
    const old = this.assets.get(name);
    if (old) return old;
    const anim = new this.TVG.LottieAnimation();
    anim.load(json);
    const info = anim.info(), size = anim.picture.size();
    const total = Math.max(1, Math.round(info?.totalFrames ?? 1));
    // Pinning the picture to its composition size keeps the staging scale at exactly 1.
    anim.picture.size(size.width, size.height).translate(OFF, OFF);
    this.stage.add(anim.picture);
    const asset = new LottieAsset(name, size.width, size.height, total, info?.fps || 30, Math.max(1, Math.ceil(total / MAX_FRAMES)), anim);
    this.assets.set(name, asset);
    return asset;
  }

  /** A static SVG goes through the same pipeline as a single frame. */
  loadSvg(name: string, svg: string): LottieAsset {
    const old = this.assets.get(name);
    if (old) return old;
    const picture = new this.TVG.Picture();
    picture.load(svg, { type: 'svg' });
    const size = picture.size();
    picture.size(size.width, size.height).translate(OFF, OFF);
    this.stage.add(picture);
    const asset = new LottieAsset(name, size.width, size.height, 1, 30, 1, { picture, frame() { /* static */ } });
    this.assets.set(name, asset);
    return asset;
  }

  /**
   * Call once per game frame, before drawing. Harvests the frame each asset staged last time (the canvas update in
   * between made its transforms current) and stages the next missing one.
   */
  tick() {
    for (const a of this.assets.values()) {
      if (a.ready >= a.frames.length) continue;
      if (a.pending >= 0) { a.frames[a.pending] = this.extract(a); a.ready++; a.pending = -1; }
      const next = a.frames.indexOf(null);
      if (next < 0) { a.anim.picture.visible(false); continue; }
      try { a.anim.frame(Math.min(a.total - 1, next * a.step)); } catch { /* already on that frame */ }
      a.pending = next;
    }
  }

  private extract(asset: LottieAsset): FlatFrame {
    const TVG = this.TVG, M = this.M, buf = this.buf;
    const shapes: FlatShape[] = [];
    const dpr = this.pixelRatio() || 1;
    let verts = 0;
    this.accessor.set(asset.anim.picture, (p: any) => {
      if (!(p instanceof TVG.Shape)) return true;
      const path = p.path() as { commands: number[]; points: [number, number][] };
      if (path.commands.length < 2) return true;
      M._tvg_shape_get_fill_color(p.ptr, buf, buf + 1, buf + 2, buf + 3);
      let fr = M.HEAPU8[buf], fg = M.HEAPU8[buf + 1], fb = M.HEAPU8[buf + 2], fa = M.HEAPU8[buf + 3];
      const grad = gradientAverage(M, p.ptr, buf);
      if (grad) { fr = grad[0]; fg = grad[1]; fb = grad[2]; fa = grad[3]; }
      M._tvg_shape_get_stroke_width(p.ptr, buf);
      const sw = M.HEAPF32[buf >> 2];
      M._tvg_shape_get_stroke_color(p.ptr, buf, buf + 1, buf + 2, buf + 3);
      const sr = M.HEAPU8[buf], sg = M.HEAPU8[buf + 1], sb = M.HEAPU8[buf + 2], sa = M.HEAPU8[buf + 3];
      const stroked = sw > 0 && sa > 0;
      M._tvg_paint_get_opacity(p.ptr, buf);
      const opacity = M.HEAPU8[buf] / 255;
      if ((fa === 0 && !stroked) || opacity <= 0) return true;

      // Local tight box -> world OBB gives the accumulated transform.
      const box = tightBounds(path.commands, path.points), e = stroked ? sw / 2 : 0;
      const lw = box[2] - box[0] + 2 * e, lh = box[3] - box[1] + 2 * e;
      if (lw < 1e-4 || lh < 1e-4) return true;
      let obb: { x: number; y: number }[];
      try { obb = (p.bounds({ oriented: true }) as { x: number; y: number }[]).map((q) => ({ x: q.x / dpr, y: q.y / dpr })); } catch { return true; }
      const ax = (obb[1].x - obb[0].x) / lw, ay = (obb[1].y - obb[0].y) / lw, bx = (obb[3].x - obb[0].x) / lh, by = (obb[3].y - obb[0].y) / lh;
      const l0x = box[0] - e, l0y = box[1] - e;
      const ox = obb[0].x - ax * l0x - bx * l0y - OFF, oy = obb[0].y - ay * l0x - by * l0y - OFF;
      const scale = Math.sqrt(Math.abs(ax * by - ay * bx));
      if (!Number.isFinite(scale) || scale < 1e-5) return true;

      const lines = flatten(path.commands, path.points, 1.2 / scale);
      for (const l of lines) for (let i = 0; i < l.pts.length; i += 2) { const x = l.pts[i], y = l.pts[i + 1]; l.pts[i] = ox + ax * x + bx * y; l.pts[i + 1] = oy + ay * x + by * y; }
      // Full-frame backdrops (a common bottom layer in stock animations) would become a wall in the world; drop them.
      let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
      for (const l of lines) for (let i = 0; i < l.pts.length; i += 2) { bx0 = Math.min(bx0, l.pts[i]); bx1 = Math.max(bx1, l.pts[i]); by0 = Math.min(by0, l.pts[i + 1]); by1 = Math.max(by1, l.pts[i + 1]); }
      if (!(bx1 - bx0 > 0.05 || by1 - by0 > 0.05)) return true; // collapsed by a degenerate transform
      const backdrop = bx1 - bx0 > asset.w * 0.9 && by1 - by0 > asset.h * 0.9 && lines.length === 1 && lines[0].pts.length <= 12;
      if (fa > 0 && !backdrop) {
        const polys = lines.filter((l) => l.pts.length >= 6).map((l) => Float32Array.from(decimate(l.pts)));
        if (polys.length) { shapes.push({ r: fr, g: fg, b: fb, a: Math.round(fa * opacity), polys }); for (const q of polys) verts += q.length >> 1; }
      }
      if (stroked) {
        const polys: Float32Array[] = [];
        for (const l of lines) strokeQuads(decimate(l.pts), l.closed, (sw * scale) / 2, polys);
        if (polys.length) { shapes.push({ r: sr, g: sg, b: sb, a: Math.round(sa * opacity), polys, stroke: true }); verts += polys.length * 4; }
      }
      return true;
    });
    return { shapes, verts };
  }
}

function gradientAverage(M: any, shapePtr: number, buf: number): [number, number, number, number] | null {
  M.HEAPU32[(buf + 8) >> 2] = 0;
  M._tvg_shape_get_gradient(shapePtr, buf + 8);
  const g = M.HEAPU32[(buf + 8) >> 2];
  if (!g) return null;
  M._tvg_gradient_get_color_stops(g, buf + 12, buf + 16);
  const stops = M.HEAPU32[(buf + 12) >> 2], n = M.HEAPU32[(buf + 16) >> 2];
  if (!stops || !n) return null;
  let r = 0, gg = 0, b = 0, a = 0;
  for (let i = 0; i < n; i++) { const o = stops + i * 8 + 4; r += M.HEAPU8[o]; gg += M.HEAPU8[o + 1]; b += M.HEAPU8[o + 2]; a += M.HEAPU8[o + 3]; }
  return [r / n, gg / n, b / n, a / n];
}

/** Exact bounds of a path: end points plus the extrema of every cubic. */
function tightBounds(cmds: number[], pts: [number, number][]): [number, number, number, number] {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, pi = 0, cx = 0, cy = 0;
  const add = (x: number, y: number) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  const extrema = (a: number, b: number, c: number, d: number, out: number[]) => {
    // Roots of the derivative of a cubic Bezier in one dimension.
    const qa = -a + 3 * b - 3 * c + d, qb = 2 * (a - 2 * b + c), qc = b - a;
    if (Math.abs(qa) < 1e-9) { if (Math.abs(qb) > 1e-9) out.push(-qc / qb); return; }
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) return;
    const s = Math.sqrt(disc);
    out.push((-qb + s) / (2 * qa), (-qb - s) / (2 * qa));
  };
  for (const c of cmds) {
    if (c === 1 || c === 2) { cx = pts[pi][0]; cy = pts[pi][1]; pi++; add(cx, cy); }
    else if (c === 3) {
      const [p1, p2, p3] = [pts[pi], pts[pi + 1], pts[pi + 2]]; pi += 3;
      const ts: number[] = [];
      extrema(cx, p1[0], p2[0], p3[0], ts); extrema(cy, p1[1], p2[1], p3[1], ts);
      for (const t of ts) if (t > 0 && t < 1) { const m = 1 - t; add(m * m * m * cx + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0], m * m * m * cy + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1]); }
      cx = p3[0]; cy = p3[1]; add(cx, cy);
    }
  }
  return [x0, y0, x1, y1];
}

interface Line { pts: number[]; closed: boolean }

/** Splits a path into polylines; cubics are subdivided so segments stay near `tol` local units. */
function flatten(cmds: number[], pts: [number, number][], tol: number): Line[] {
  const out: Line[] = [];
  let cur: Line | null = null, pi = 0, cx = 0, cy = 0;
  for (const c of cmds) {
    if (c === 1) { cur = { pts: [pts[pi][0], pts[pi][1]], closed: false }; out.push(cur); cx = pts[pi][0]; cy = pts[pi][1]; pi++; }
    else if (c === 2 && cur) { cx = pts[pi][0]; cy = pts[pi][1]; pi++; cur.pts.push(cx, cy); }
    else if (c === 3 && cur) {
      const p1 = pts[pi], p2 = pts[pi + 1], p3 = pts[pi + 2]; pi += 3;
      const len = Math.hypot(p1[0] - cx, p1[1] - cy) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
      const n = Math.min(24, Math.max(2, Math.ceil(Math.sqrt(len / Math.max(tol, 1e-3)) * 0.9)));
      for (let k = 1; k <= n; k++) { const t = k / n, m = 1 - t; cur.pts.push(m * m * m * cx + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0], m * m * m * cy + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1]); }
      cx = p3[0]; cy = p3[1];
    } else if (c === 0 && cur) cur.closed = true;
  }
  return out;
}

/** Keeps outlines under the renderer's per polygon vertex budget. */
function decimate(pts: number[]): number[] {
  const n = pts.length >> 1;
  if (n <= MAX_POLY_VERTS) return pts;
  const out: number[] = [], step = n / MAX_POLY_VERTS;
  for (let i = 0; i < MAX_POLY_VERTS; i++) { const k = Math.floor(i * step); out.push(pts[k * 2], pts[k * 2 + 1]); }
  return out;
}

/** Strokes become one quad per segment (slightly over-long so joints close up). */
function strokeQuads(pts: number[], closed: boolean, hw: number, out: Float32Array[]) {
  const n = pts.length >> 1, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    let dx = pts[j * 2] - pts[i * 2], dy = pts[j * 2 + 1] - pts[i * 2 + 1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    dx /= len; dy /= len;
    const ex = dx * hw * 0.6, ey = dy * hw * 0.6, nx = -dy * hw, ny = dx * hw;
    const ax = pts[i * 2] - ex, ay = pts[i * 2 + 1] - ey, bx = pts[j * 2] + ex, by = pts[j * 2 + 1] + ey;
    out.push(Float32Array.of(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny));
  }
}
