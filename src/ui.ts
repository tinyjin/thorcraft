// Immediate-mode drawing helper over pooled ThorVG paints. Shapes are drawn below texts
// inside one layer; stack several layers when text has to be covered.

import { BLOCKS, CUBE, ITEMS, isBlockId } from './blocks';
import { Tex, texture } from './textures';

type RGBA = readonly [number, number, number, number?];

/** Supplies flattened Lottie artwork for items that have one (see lottie3d.ts); set by the game. */
type FlatArt = { shapes: { r: number; g: number; b: number; a: number; polys: Float32Array[] }[]; w: number; h: number } | null;
let flatArt: (asset: string) => FlatArt = () => null;
export const setFlatArtProvider = (fn: (asset: string) => FlatArt) => { flatArt = fn; };

interface PooledText { paint: any; str: string; size: number; color: string }

export class UILayer {
  readonly scene: any;
  private shapes: any[] = [];
  private texts: PooledText[] = [];
  private si = 0; private ti = 0; private lastS = 0; private lastT = 0;
  private shapeScene: any; private textScene: any; private iconScene: any; private overScene: any;
  private overs: any[] = []; private oi = 0; private lastO = 0;
  private icons = new Map<number, { scenes: any[]; used: number }>();

  constructor(private TVG: any, private fontName: string) {
    this.scene = new TVG.Scene();
    this.shapeScene = new TVG.Scene();
    this.textScene = new TVG.Scene();
    this.iconScene = new TVG.Scene();
    this.overScene = new TVG.Scene();
    this.scene.add(this.shapeScene).add(this.iconScene).add(this.overScene).add(this.textScene);
  }

  private temps: any[] = [];

  begin() { for (const t of this.temps) this.iconScene.remove(t); this.temps.length = 0; this.si = 0; this.ti = 0; this.oi = 0; for (const e of this.icons.values()) e.used = 0; }

  /** Returns a cleared shape that draws above everything requested before it. */
  shape(): any {
    let s = this.shapes[this.si];
    if (!s) { s = new this.TVG.Shape(); this.shapes.push(s); this.shapeScene.add(s); }
    this.si++;
    s.reset().stroke(0).opacity(255).visible(true);
    return s;
  }

  /** Like rect(), but drawn above the item icons of this layer. */
  overRect(x: number, y: number, w: number, h: number, c: RGBA): any {
    let s = this.overs[this.oi];
    if (!s) { s = new this.TVG.Shape(); this.overs.push(s); this.overScene.add(s); }
    this.oi++;
    return s.reset().visible(true).appendRect(x, y, w, h).fill(c[0], c[1], c[2], c[3] ?? 255);
  }

  /** Item icon centered at (cx, cy); `r` is the half height of a block cube. Instances are pooled per item. */
  icon(id: number, cx: number, cy: number, r: number) {
    let e = this.icons.get(id);
    if (!e) this.icons.set(id, (e = { scenes: [], used: 0 }));
    let sc = e.scenes[e.used];
    if (!sc) {
      const built = buildIcon(this.TVG, id);
      sc = built.scene;
      this.iconScene.add(sc);
      // Placeholder icons (Lottie art not extracted yet) are not pooled, so they get rebuilt later.
      if (built.final) e.scenes.push(sc); else { this.temps.push(sc); e.used--; }
    }
    e.used++;
    sc.visible(true).scale(r).translate(cx, cy);
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA, radius = 0): any {
    return this.shape().appendRect(x, y, w, h, { rx: radius, ry: radius }).fill(c[0], c[1], c[2], c[3] ?? 255);
  }

  frame(x: number, y: number, w: number, h: number, c: RGBA, width: number, radius = 0): any {
    return this.shape().appendRect(x, y, w, h, { rx: radius, ry: radius }).fill(0, 0, 0, 0).stroke({ width, color: [c[0], c[1], c[2], c[3] ?? 255], join: 'round' });
  }

  poly(pts: readonly number[], c: RGBA): any {
    const s = this.shape();
    s.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], pts[i + 1]);
    return s.close().fill(c[0], c[1], c[2], c[3] ?? 255);
  }

  /** `shadow` > 0 draws a dark copy underneath, offset by that many pixels. */
  text(str: string, x: number, y: number, size: number, c: RGBA, ax = 0, ay = 0, shadow = 0): any {
    if (shadow > 0) this.rawText(str, x + shadow * 0.6, y + shadow * 0.6, size, [0, 0, 0, Math.floor((c[3] ?? 255) * 0.75)], ax, ay);
    return this.rawText(str, x, y, size, c, ax, ay);
  }

  private rawText(str: string, x: number, y: number, size: number, c: RGBA, ax: number, ay: number): any {
    let t = this.texts[this.ti];
    if (!t) {
      t = { paint: new this.TVG.Text(), str: '', size: 0, color: '' };
      t.paint.font(this.fontName);
      this.texts.push(t);
      this.textScene.add(t.paint);
    }
    this.ti++;
    if (t.str !== str) { t.paint.text(str); t.str = str; }
    if (t.size !== size) { t.paint.fontSize(size); t.size = size; }
    const ck = c[0] + ',' + c[1] + ',' + c[2];
    if (t.color !== ck) { t.paint.fill(c[0], c[1], c[2]); t.color = ck; }
    t.paint.align(ax, ay).translate(x, y).opacity(c[3] ?? 255).visible(true);
    return t.paint;
  }

  end() {
    for (let i = this.si; i < this.lastS; i++) this.shapes[i].reset().visible(false);
    for (let i = this.ti; i < this.lastT; i++) this.texts[i].paint.visible(false);
    for (let i = this.oi; i < this.lastO; i++) this.overs[i].reset().visible(false);
    for (const e of this.icons.values()) for (let i = e.used; i < e.scenes.length; i++) e.scenes[i].visible(false);
    this.lastS = this.si; this.lastT = this.ti; this.lastO = this.oi;
  }
}

/** Isometric block icon made of three quads. */
export function isoCube(ui: UILayer, cx: number, cy: number, r: number, top: readonly number[], side: readonly number[], alpha = 255) {
  const hx = r * 0.92, hy = r * 0.46;
  ui.poly([cx, cy - r, cx + hx, cy - r + hy, cx, cy - r + 2 * hy, cx - hx, cy - r + hy], [top[0], top[1], top[2], alpha]);
  ui.poly([cx - hx, cy - r + hy, cx, cy - r + 2 * hy, cx, cy + r, cx - hx, cy + r - hy], [side[0] * 0.8, side[1] * 0.8, side[2] * 0.8, alpha]);
  ui.poly([cx + hx, cy - r + hy, cx, cy - r + 2 * hy, cx, cy + r, cx + hx, cy + r - hy], [side[0] * 0.6, side[1] * 0.6, side[2] * 0.6, alpha]);
}

/**
 * Builds a unit-sized icon scene: an isometric cube with 8x8 vector texels for blocks, a flat
 * 16x16 sprite for everything else. Polygons are merged into one shape per color.
 */
function buildIcon(TVG: any, id: number): { scene: any; final: boolean } {
  const scene = new TVG.Scene();
  const shapes = new Map<number, any>();
  const poly = (pts: number[], r: number, g: number, b: number, a: number) => {
    r = Math.min(255, Math.round(r)); g = Math.min(255, Math.round(g)); b = Math.min(255, Math.round(b));
    const key = ((r * 256 + g) * 256 + b) * 256 + a;
    let s = shapes.get(key);
    if (!s) { s = new TVG.Shape(); s.fill(r, g, b, a); shapes.set(key, s); scene.add(s); }
    s.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], pts[i + 1]);
    s.close();
  };
  // Lottie outlines keep their artwork order, so each one gets its own shape instead of merging by color.
  const poly2 = (p: Float32Array, k: number, w: number, h: number, c: { r: number; g: number; b: number; a: number }) => {
    const s = new TVG.Shape();
    s.moveTo((p[0] - w / 2) * k, (p[1] - h / 2) * k);
    for (let i = 2; i < p.length; i += 2) s.lineTo((p[i] - w / 2) * k, (p[i + 1] - h / 2) * k);
    s.close().fill(Math.round(c.r), Math.round(c.g), Math.round(c.b), c.a);
    scene.add(s);
  };
  // Draws a texture onto the parallelogram origin + u * U + v * V.
  const face = (tex: Tex, ox: number, oy: number, ux: number, uy: number, vx: number, vy: number, shade: number, alpha: number, lodIndex: number) => {
    const lod = tex.lods[Math.min(lodIndex, tex.lods.length - 1)];
    const quad = (u0: number, v0: number, u1: number, v1: number, c: readonly number[], a: number) => poly([
      ox + ux * u0 + vx * v0, oy + uy * u0 + vy * v0, ox + ux * u1 + vx * v0, oy + uy * u1 + vy * v0,
      ox + ux * u1 + vx * v1, oy + uy * u1 + vy * v1, ox + ux * u0 + vx * v1, oy + uy * u0 + vy * v1], c[0] * shade, c[1] * shade, c[2] * shade, a);
    if (lod.base >= 0) quad(0, 0, 1, 1, lod.tones[lod.base], alpha);
    const rc = lod.rects, e = 0.004;
    for (let k = 0; k < rc.length; k += 5) quad(rc[k] / lod.n - e, rc[k + 1] / lod.n - e, rc[k + 2] / lod.n + e, rc[k + 3] / lod.n + e, lod.tones[rc[k + 4]], 255);
  };
  const def = ITEMS.get(id);
  if (def?.lottie) {
    // The icon is frame 0 of the item's Lottie, rebuilt from the same outlines the 3D world uses.
    const art = flatArt(def.lottie);
    if (art) {
      const k = 2.5 / Math.max(art.w, art.h);
      for (const sh of art.shapes) for (const poly of sh.polys) poly.length >= 6 && poly2(poly, k, art.w, art.h, sh);
      return { scene, final: true };
    }
    face(texture(def.icon), -1.25, -1.25, 2.5, 0, 0, 2.5, 1, 255, 0);
    return { scene, final: false };
  }
  if (def && isBlockId(id) && CUBE[id]) {
    const f = BLOCKS[id].faces, hx = 0.92, hy = 0.46, sh = 2 - 2 * hy, a = Math.max(BLOCKS[id].alpha, 150);
    face(texture(f[2]), 0, -1, hx, hy, -hx, hy, 1, a, 1);
    face(texture(f[5]), -hx, -1 + hy, hx, hy, 0, sh, 0.8, a, 1);
    face(texture(f[0]), 0, -1 + 2 * hy, hx, -hy, 0, sh, 0.6, a, 1);
  } else if (def) {
    face(texture(def.icon), -1.25, -1.25, 2.5, 0, 0, 2.5, 1, 255, 0);
  }
  return { scene, final: true };
}
