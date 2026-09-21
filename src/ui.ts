// Immediate-mode drawing helper over pooled ThorVG paints. Shapes are drawn below texts
// inside one layer; stack several layers when text has to be covered.

type RGBA = readonly [number, number, number, number?];

interface PooledText { paint: any; str: string; size: number; color: string }

export class UILayer {
  readonly scene: any;
  private shapes: any[] = [];
  private texts: PooledText[] = [];
  private si = 0; private ti = 0; private lastS = 0; private lastT = 0;
  private shapeScene: any; private textScene: any;

  constructor(private TVG: any, private fontName: string) {
    this.scene = new TVG.Scene();
    this.shapeScene = new TVG.Scene();
    this.textScene = new TVG.Scene();
    this.scene.add(this.shapeScene).add(this.textScene);
  }

  begin() { this.si = 0; this.ti = 0; }

  /** Returns a cleared shape that draws above everything requested before it. */
  shape(): any {
    let s = this.shapes[this.si];
    if (!s) { s = new this.TVG.Shape(); this.shapes.push(s); this.shapeScene.add(s); }
    this.si++;
    s.reset().stroke(0).opacity(255).visible(true);
    return s;
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
    this.lastS = this.si; this.lastT = this.ti;
  }
}

/** Isometric block icon made of three quads. */
export function isoCube(ui: UILayer, cx: number, cy: number, r: number, top: readonly number[], side: readonly number[], alpha = 255) {
  const hx = r * 0.92, hy = r * 0.46;
  ui.poly([cx, cy - r, cx + hx, cy - r + hy, cx, cy - r + 2 * hy, cx - hx, cy - r + hy], [top[0], top[1], top[2], alpha]);
  ui.poly([cx - hx, cy - r + hy, cx, cy - r + 2 * hy, cx, cy + r, cx - hx, cy + r - hy], [side[0] * 0.8, side[1] * 0.8, side[2] * 0.8, alpha]);
  ui.poly([cx + hx, cy - r + hy, cx, cy - r + 2 * hy, cx, cy + r, cx + hx, cy + r - hy], [side[0] * 0.6, side[1] * 0.6, side[2] * 0.6, alpha]);
}
