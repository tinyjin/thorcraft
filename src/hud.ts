// In-game HUD, menus and item windows, drawn with ThorVG like everything else.

import { B, BLOCKS, ITEMS, itemName } from './blocks';
import { Input } from './input';
import { COOK_TIME, CREATIVE_ITEMS, Furnace, HOTBAR, Inventory, SlotKind, SlotRef, Stack, WindowState, makeStack } from './inventory';
import { ARROW_FRAMES, FLAME_FRAMES, HEART_SEG, arrowLottie, flameLottie, heartLottie } from './lottie';
import { Player } from './player';
import { texture } from './textures';
import { UILayer } from './ui';
import { SEA, World } from './world';

const HEART = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
const WHITE = [255, 255, 255, 255] as const;
const PANEL = [198, 198, 198, 250] as const, PANEL_TEXT = [58, 58, 62, 255] as const;

export interface HudInfo {
  fps: number; debug: boolean; debugLines: string[]; gems: number; toast: string; toastAlpha: number;
  nameAlpha: number; timeOfDay: number; inLava: boolean; breakProgress: number; fxOn: boolean;
}

type HeartAnim = keyof typeof HEART_SEG;
interface HeartSlot { full: any; half: any; level: number; anim: HeartAnim; variant: number; t: number }

export interface Settings { renderDist: number; fov: number; sens: number; vol: number; auto: boolean }
export type WindowKind = 'inventory' | 'crafting' | 'furnace';

const mapColorCache = new Map<number, readonly [number, number, number]>();
const mapColor = (id: number) => {
  let c = mapColorCache.get(id);
  if (!c) mapColorCache.set(id, (c = texture(BLOCKS[id].faces[2]).avg));
  return c;
};

/** ThorVG reports an error when asked for the frame it already shows, so only send real changes. */
function setFrame(anim: any, frame: number) {
  if (Math.abs((anim.__f ?? -1) - frame) < 0.01) return;
  anim.__f = frame;
  try { anim.frame(frame); } catch { /* same frame after rounding */ }
}

export class Hud {
  readonly scene: any;
  private mapScene: any;
  private mapShapes = new Map<number, any>();
  private mapKey = '';
  private mapTimer = 0;
  private hud: UILayer; private menu: UILayer; private top: UILayer;
  private dragging = '';
  w = 0; h = 0;
  /** Set by buttons each frame. */
  hot = false;
  seedText = '';
  private seedFocus = false;
  // Lottie driven widgets
  private lottieHud: any; private lottieMenu: any;
  private hearts: HeartSlot[] = [];
  private heartsDrawn = false; private furnaceDrawn = false; private titleDrawn = false;
  private flame: any; private arrow: any; private flameClip: any;
  private titleText: any = null;
  private mapClip: any;
  private lastTime = 0;
  private tipWidths = new Map<string, number>();
  private measureCtx: CanvasRenderingContext2D | null = null;

  /** Text width in canvas pixels, measured with the same font file through a 2D context. ThorVG sizes are points (4/3 px). */
  private textWidth(str: string, size: number): number {
    const key = size + '|' + str;
    let w = this.tipWidths.get(key);
    if (w === undefined) {
      this.measureCtx ??= document.createElement('canvas').getContext('2d');
      if (!this.measureCtx || !document.fonts.check(`${size}px thorcraft-ui`)) return str.length * size * 0.62;
      this.measureCtx.font = `${(size * 4) / 3}px thorcraft-ui`;
      this.tipWidths.set(key, (w = this.measureCtx.measureText(str).width));
    }
    return w;
  }

  constructor(private TVG: any, private input: Input, font: string) {
    this.scene = new TVG.Scene();
    this.mapScene = new TVG.Scene();
    this.hud = new UILayer(TVG, font);
    this.menu = new UILayer(TVG, font);
    this.top = new UILayer(TVG, font);
    this.lottieHud = new TVG.Scene();
    this.lottieMenu = new TVG.Scene();
    this.scene.add(this.hud.scene).add(this.lottieHud).add(this.mapScene).add(this.menu.scene).add(this.lottieMenu).add(this.top.scene);

    const load = (json: string, parent: any) => {
      const a = new TVG.LottieAnimation();
      a.load(json);
      a.picture.visible(false);
      parent.add(a.picture);
      return a;
    };
    const fullJson = heartLottie(false), halfJson = heartLottie(true);
    for (let i = 0; i < 10; i++) this.hearts.push({ full: load(fullJson, this.lottieHud), half: load(halfJson, this.lottieHud), level: 2, anim: 'idle', variant: 2, t: 0 });
    this.flame = load(flameLottie(), this.lottieMenu);
    this.arrow = load(arrowLottie(), this.lottieMenu);
    this.flameClip = new TVG.Shape();
    this.flame.picture.clip(this.flameClip);
    // The minimap is clipped to a disc.
    this.mapClip = new TVG.Shape();
    this.mapScene.clip(this.mapClip);
  }

  begin(w: number, h: number) {
    this.w = w; this.h = h; this.hot = false;
    this.hud.begin(); this.menu.begin(); this.top.begin();
    if (!this.input.buttons[0]) this.dragging = '';
    this.heartsDrawn = this.furnaceDrawn = this.titleDrawn = false;
  }

  end() {
    this.hud.end(); this.menu.end(); this.top.end();
    if (!this.heartsDrawn) for (const h of this.hearts) { h.full.picture.visible(false); h.half.picture.visible(false); }
    if (!this.furnaceDrawn) { this.flame.picture.visible(false); this.arrow.picture.visible(false); }
    if (!this.titleDrawn && this.titleText) this.titleText.visible(false);
  }

  /** Lottie hearts: each slot plays the marker range that matches what just happened to it. */
  private drawHearts(player: Player, x0: number, hy: number, px: number, time: number) {
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.heartsDrawn = true;
    const hpInt = Math.ceil(player.health), low = player.health <= 6 && !player.dead;
    const size = (7 * px * 80) / 56;
    for (let i = 0; i < 10; i++) {
      const h = this.hearts[i], hp = hpInt - i * 2;
      const target = hp >= 2 ? 2 : hp === 1 ? 1 : 0;
      if (target < h.level) { h.anim = 'break'; h.variant = h.level; h.t = 0; h.level = target; }
      else if (target > h.level) { h.anim = 'gain'; h.variant = target; h.t = 0; h.level = target; }
      h.t += dt;
      const seg = HEART_SEG[h.anim];
      if (h.t * 30 >= seg[1]) {
        // Finished: fall back to idle, or keep beating while health is critical.
        h.variant = h.level;
        if (low && h.level > 0) { h.anim = 'beat'; h.t = h.anim === 'beat' ? 0 : 0; }
        else { h.anim = 'idle'; h.t = 0; }
      } else if (h.anim === 'idle' && low && h.level > 0) { h.anim = 'beat'; h.t = -i * 0.05; }
      const s2 = HEART_SEG[h.anim];
      const frame = s2[0] + Math.min(s2[1] - 1, Math.max(0, h.t * 30));
      const show = h.variant === 2 ? h.full : h.variant === 1 ? h.half : null;
      const hide = show === h.full ? h.half : h.full;
      hide.picture.visible(false);
      if (!show) { h.full.picture.visible(false); continue; }
      const hx = x0 + 2 + i * (px * 8);
      setFrame(show, frame);
      show.picture.visible(true).size(size, size).translate(hx - (12 / 80) * size, hy - (14 / 80) * size);
    }
  }

  // ------------------------------------------------------------------ widgets

  private over(x: number, y: number, w: number, h: number) {
    const i = this.input;
    return i.mouseX >= x && i.mouseX < x + w && i.mouseY >= y && i.mouseY < y + h;
  }

  private stack(ui: UILayer, s: Stack, x: number, y: number, size: number) {
    ui.icon(s.id, x + size / 2, y + size / 2, size * 0.3);
    if (s.count > 1) ui.text(String(s.count), x + size - 4, y + size - 2, size * 0.3, WHITE, 1, 1, 2);
    const tool = ITEMS.get(s.id)?.tool;
    if (tool && s.dur !== undefined && s.dur < tool.dur) {
      const f = s.dur / tool.dur;
      ui.overRect(x + 5, y + size - 8, size - 10, 3.5, [0, 0, 0, 255]);
      ui.overRect(x + 5, y + size - 8, (size - 10) * f, 3.5, [Math.floor(255 * Math.min(1, 2 - 2 * f)), Math.floor(230 * Math.min(1, 2 * f)), 40, 255]);
    }
  }

  /** Minecraft style beveled slot on a light panel. */
  private slot(ui: UILayer, x: number, y: number, size: number, s: Stack | null, hover: boolean, selected = false) {
    ui.rect(x, y, size, size, [55, 55, 55, 255]);
    ui.rect(x + 2, y + 2, size - 2, size - 2, [255, 255, 255, 255]);
    ui.rect(x + 2, y + 2, size - 4, size - 4, hover ? [176, 180, 196, 255] : [139, 139, 139, 255]);
    if (selected) ui.frame(x + 1, y + 1, size - 2, size - 2, [255, 255, 255, 255], 2);
    if (s) this.stack(ui, s, x, y, size);
  }

  button(label: string, x: number, y: number, w: number, h: number, enabled = true): boolean {
    const ui = this.menu, inp = this.input;
    const over = enabled && this.over(x, y, w, h);
    if (over) this.hot = true;
    ui.rect(x - 2, y - 2, w + 4, h + 4, [0, 0, 0, 255]);
    ui.rect(x, y, w, h, [170, 170, 170, 255]);
    ui.rect(x + 2, y + 2, w - 2, h - 2, [52, 52, 52, 255]);
    ui.rect(x + 2, y + 2, w - 4, h - 4, !enabled ? [70, 70, 70, 255] : over ? [123, 134, 201, 255] : [110, 110, 110, 255]);
    ui.text(label, x + w / 2, y + h / 2, Math.min(18, h * 0.4), enabled ? WHITE : [160, 160, 160, 255], 0.5, 0.5, 2);
    return over && inp.clicked[0];
  }

  /** Horizontal slider; returns the (possibly changed) value. */
  private slider(name: string, label: string, x: number, y: number, w: number, h: number, value: number, min: number, max: number): number {
    const ui = this.menu, inp = this.input;
    const over = this.over(x, y, w, h);
    if (over) this.hot = true;
    if (over && inp.clicked[0]) this.dragging = name;
    if (this.dragging === name) value = Math.round(min + Math.min(1, Math.max(0, (inp.mouseX - x - 8) / (w - 16))) * (max - min));
    ui.rect(x - 2, y - 2, w + 4, h + 4, [0, 0, 0, 255]);
    ui.rect(x, y, w, h, [42, 42, 42, 255]);
    const kx = x + 2 + ((value - min) / (max - min)) * (w - 20);
    ui.rect(kx, y + 2, 16, h - 4, this.dragging === name || over ? [123, 134, 201, 255] : [150, 150, 150, 255]);
    ui.frame(kx, y + 2, 16, h - 4, [230, 230, 230, 255], 1.5);
    ui.text(label, x + w / 2, y + h / 2, 15, WHITE, 0.5, 0.5, 2);
    return value;
  }

  // ------------------------------------------------------------------ gameplay HUD

  drawGame(player: Player, inv: Inventory, info: HudInfo, time: number) {
    const ui = this.hud, w = this.w, h = this.h;

    // Underwater, lava and night grading are scene effects (see fx.ts); `fxOn` false falls back to overlays.
    if (!info.fxOn && info.inLava) ui.rect(0, 0, w, h, [230, 80, 10, 140]);
    else if (!info.fxOn && player.headInWater) ui.rect(0, 0, w, h, [20, 60, 170, 95]);
    if (player.hurtTimer > 0) {
      const a = Math.floor(player.hurtTimer * 420), e = Math.min(w, h) * 0.16;
      ui.rect(0, 0, w, e, [200, 0, 0, a]); ui.rect(0, h - e, w, e, [200, 0, 0, a]);
      ui.rect(0, e, e, h - 2 * e, [200, 0, 0, a]); ui.rect(w - e, e, e, h - 2 * e, [200, 0, 0, a]);
      ui.rect(0, 0, w, h, [200, 0, 0, a >> 2]);
    }

    // Crosshair
    const cx = w / 2, cy = h / 2;
    ui.rect(cx - 11, cy - 2, 22, 4, [0, 0, 0, 110]);
    ui.rect(cx - 2, cy - 11, 4, 22, [0, 0, 0, 110]);
    ui.rect(cx - 10, cy - 1, 20, 2, [255, 255, 255, 235]);
    ui.rect(cx - 1, cy - 10, 2, 20, [255, 255, 255, 235]);

    // Mining progress: a ring around the crosshair, drawn with a trimmed stroke.
    if (info.breakProgress > 0) {
      ui.shape().appendCircle(cx, cy, 17, 17).fill(0, 0, 0, 0).stroke({ width: 5, color: [0, 0, 0, 90] });
      ui.shape().appendCircle(cx, cy, 17, 17).fill(0, 0, 0, 0).trimPath(0, Math.min(1, info.breakProgress)).stroke({ width: 3, color: [255, 255, 255, 240], cap: 'round' });
    }

    // Hotbar
    const size = Math.min(50, (w - 40) / HOTBAR);
    const total = HOTBAR * size;
    const x0 = (w - total) / 2, y0 = h - size - 12;
    ui.rect(x0 - 3, y0 - 3, total + 6, size + 6, [0, 0, 0, 120]);
    for (let i = 0; i < HOTBAR; i++) {
      const x = x0 + i * size;
      ui.rect(x + 1, y0 + 1, size - 2, size - 2, [60, 60, 60, 130]);
      ui.frame(x + 1, y0 + 1, size - 2, size - 2, [90, 90, 90, 220], 2);
      const s = inv.slots[i];
      if (s) this.stack(ui, s, x, y0, size);
    }
    const sx = x0 + inv.selected * size;
    ui.frame(sx - 1, y0 - 1, size + 2, size + 2, [0, 0, 0, 255], 5);
    ui.frame(sx - 1, y0 - 1, size + 2, size + 2, [255, 255, 255, 255], 3);
    const held = inv.held;
    if (held && info.nameAlpha > 0) ui.text(itemName(held.id), w / 2, y0 - (player.creative ? 12 : 40), 16, [255, 255, 255, Math.floor(info.nameAlpha * 255)], 0.5, 1, 2);

    // Hearts and air
    if (!player.creative) {
      const px = 2.6, hy = y0 - 26;
      const empty = ui.shape();
      for (let i = 0; i < 10; i++) {
        const hx = x0 + 2 + i * (px * 8);
        for (let r = 0; r < HEART.length; r++) for (let c = 0; c < 7; c++) if (HEART[r][c] === '1') empty.appendRect(hx + c * px, hy + r * px, px + 0.3, px + 0.3);
      }
      empty.fill(40, 16, 20, 210);
      this.drawHearts(player, x0, hy, px, time);
      if (player.air < 10) {
        const bub = ui.shape();
        const n = Math.ceil(player.air);
        for (let i = 0; i < n; i++) bub.appendCircle(x0 + total - 8 - i * 18, hy + 8, 6.5, 6.5);
        bub.fill(124, 198, 255, 220).stroke({ width: 1.5, color: [235, 250, 255, 255] });
      }
    }

    // Gems + clock
    ui.rect(12, 12, 150, 34, [0, 0, 0, 115]);
    ui.poly([32, 19, 40, 27, 32, 39, 24, 27], [92, 226, 232]);
    ui.poly([32, 19, 40, 27, 24, 27], [190, 250, 252]);
    ui.text(String(info.gems), 50, 29, 18, WHITE, 0, 0.5);
    const hr = Math.floor(((info.timeOfDay * 24 + 6) % 24));
    const mn = Math.floor((((info.timeOfDay * 24 + 6) % 24) - hr) * 60);
    ui.text(`${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}`, 150, 29, 15, [210, 218, 235, 255], 1, 0.5);
    ui.text(player.creative ? 'CREATIVE' : 'SURVIVAL', 14, 58, 11, [225, 230, 240, 220], 0, 0.5, 2);

    if (info.toastAlpha > 0) ui.text(info.toast, w / 2, h * 0.24, 20, [255, 255, 255, Math.floor(info.toastAlpha * 255)], 0.5, 0.5, 3);

    if (info.debug) {
      ui.rect(8, 76, 380, 18 * info.debugLines.length + 12, [0, 0, 0, 120]);
      for (let i = 0; i < info.debugLines.length; i++) ui.text(info.debugLines[i], 16, 84 + i * 18, 13, [225, 255, 225, 255], 0, 0);
    }
  }

  // ------------------------------------------------------------------ minimap

  drawMinimap(world: World, player: Player, dt: number) {
    const N = 20, cell = 3, size = (N * 2 + 1) * cell;
    const ox = this.w - size - 14, oy = 14;
    this.mapTimer -= dt;
    const key = Math.floor(player.x) + ',' + Math.floor(player.z) + ',' + this.w;
    if (key !== this.mapKey && this.mapTimer <= 0) {
      this.mapKey = key; this.mapTimer = 0.25;
      const groups = new Map<number, number[]>();
      const px = Math.floor(player.x), pz = Math.floor(player.z);
      for (let dz = -N; dz <= N; dz++) for (let dx = -N; dx <= N; dx++) {
        const x = px + dx, z = pz + dz;
        let c = 0x101418;
        if (world.hasChunk(x >> 4, z >> 4)) {
          const top = world.topAt(x, z);
          let id = top >= 0 ? world.getBlock(x, top, z) : B.AIR;
          if (top < SEA) { const above = world.getBlock(x, SEA, z); if (above === B.WATER || above === B.ICE) id = above; }
          const base = mapColor(id);
          const k = Math.min(1.15, 0.55 + Math.max(top, SEA) / 110 + ((top & 1) ? 0.03 : 0));
          c = (Math.min(255, base[0] * k) << 16) | (Math.min(255, base[1] * k) << 8) | Math.min(255, base[2] * k) | 0;
          c &= 0xf8f8f8; // quantize so columns batch into few shapes
        }
        let g = groups.get(c);
        if (!g) groups.set(c, (g = []));
        g.push(dx + N, dz + N);
      }
      for (const s of this.mapShapes.values()) s.reset();
      for (const [c, cells] of groups) {
        let s = this.mapShapes.get(c);
        if (!s) {
          if (this.mapShapes.size > 400) continue;
          s = new this.TVG.Shape(); this.mapShapes.set(c, s); this.mapScene.add(s);
        }
        for (let i = 0; i < cells.length; i += 2) s.appendRect(cells[i] * cell, cells[i + 1] * cell, cell + 0.4, cell + 0.4);
        s.fill((c >> 16) & 255, (c >> 8) & 255, c & 255, 255);
      }
    }
    this.mapScene.translate(ox, oy);
    this.mapClip.reset().appendCircle(ox + size / 2, oy + size / 2, size / 2, size / 2);
    const ui = this.hud;
    ui.shape().appendCircle(ox + size / 2, oy + size / 2, size / 2 + 4, size / 2 + 4).fill(0, 0, 0, 150);
    this.top.shape().appendCircle(ox + size / 2, oy + size / 2, size / 2 + 1, size / 2 + 1).fill(0, 0, 0, 0).stroke({ width: 3, color: [235, 235, 235, 230] });
    // Player arrow (drawn in the top layer so it sits above the map scene)
    const t = this.top;
    const cx = ox + size / 2, cy = oy + size / 2, a = player.yaw;
    const fx = -Math.sin(a), fz = -Math.cos(a);
    t.poly([cx + fx * 8, cy + fz * 8, cx - fx * 5 - fz * 5, cy - fz * 5 + fx * 5, cx - fx * 2, cy - fz * 2, cx - fx * 5 + fz * 5, cy - fz * 5 - fx * 5], [255, 255, 255, 255])
      .stroke({ width: 1.5, color: [0, 0, 0, 255], join: 'round' });
    t.text('N', cx, oy + 4, 11, [255, 255, 255, 235], 0.5, 0, 2);
  }

  setMinimapVisible(v: boolean) { this.mapScene.visible(v); }

  // ------------------------------------------------------------------ screens

  private dim(alpha: number) { this.menu.rect(0, 0, this.w, this.h, [0, 0, 0, alpha]); }

  drawTitle(hasSave: boolean, renderer: string, time: number): string | null {
    const ui = this.menu, inp = this.input, w = this.w, h = this.h;
    ui.rect(0, 0, w, h, [8, 10, 18, 70]);
    const ty = h * 0.2;
    const bs = Math.min(30, w / 28);
    const cols: number[] = [B.GRASS, B.LOG, B.STONE, B.BRICK, B.DIAMOND_ORE, B.PLANKS, B.CRAFTING_TABLE, B.GLOWSTONE, B.TNT];
    for (let i = 0; i < cols.length; i++) ui.icon(cols[i], w / 2 + (i - 4) * bs * 2.1, ty - 78 + Math.sin(time * 2 + i * 0.7) * 6, bs);
    const fs = Math.min(84, w / 8);
    ui.text('THORCRAFT', w / 2 + 5, ty + 5, fs, [0, 0, 0, 190], 0.5, 0.5);
    if (!this.titleText) {
      this.titleText = new this.TVG.Text();
      this.titleText.font('ui').text('THORCRAFT');
      this.lottieMenu.add(this.titleText);
    }
    // A gradient filled logo with a slowly travelling sheen.
    const sheen = (time * 0.25) % 1.6 - 0.3;
    const grad = new this.TVG.LinearGradient(0, 0, fs * 6, fs * 0.6);
    const stop = (o: number, c: number[]) => grad.addStop(Math.min(1, Math.max(0, o)), c);
    stop(0, [255, 214, 92, 255]); stop(sheen - 0.12, [255, 170, 40, 255]); stop(sheen, [255, 255, 235, 255]); stop(sheen + 0.12, [255, 170, 40, 255]); stop(1, [255, 120, 30, 255]);
    this.titleText.fontSize(fs).fill(grad).align(0.5, 0.5).translate(w / 2, ty).visible(true);
    this.titleDrawn = true;
    ui.text('an infinite voxel world drawn by ThorVG WebCanvas!', w / 2, ty + 56, 17, [255, 255, 85, 255], 0.5, 0.5, 2);

    const bw = 380, bh = 44, bx = w / 2 - bw / 2, gap = 10;
    let by = h * 0.4;
    let action: string | null = null;
    if (hasSave) { if (this.button('Continue', bx, by, bw, bh)) action = 'continue'; by += bh + gap; }
    if (this.button('New World - Survival', bx, by, bw, bh)) action = 'survival';
    by += bh + gap;
    if (this.button('New World - Creative', bx, by, bw, bh)) action = 'creative';
    by += bh + gap;

    // Seed text field
    const overSeed = this.over(bx, by, bw, bh);
    if (inp.clicked[0]) this.seedFocus = overSeed;
    if (this.seedFocus) {
      for (const ch of inp.typed) {
        if (ch === '\b') this.seedText = this.seedText.slice(0, -1);
        else if (this.seedText.length < 24) this.seedText += ch;
      }
    }
    ui.rect(bx - 2, by - 2, bw + 4, bh + 4, this.seedFocus ? [255, 255, 255, 255] : [160, 160, 160, 255]);
    ui.rect(bx, by, bw, bh, [0, 0, 0, 255]);
    const caret = this.seedFocus && Math.floor(time * 2) % 2 === 0 ? '_' : '';
    if (this.seedText || this.seedFocus) ui.text(this.seedText + caret, w / 2, by + bh / 2, 17, WHITE, 0.5, 0.5);
    else ui.text('Seed (leave empty for random)', w / 2, by + bh / 2, 15, [130, 130, 130, 255], 0.5, 0.5);
    by += bh + gap;
    if (this.button(`Renderer: ${renderer === 'gl' ? 'WebGL' : renderer === 'wg' ? 'WebGPU' : 'Software'}`, bx, by, bw, bh)) action = 'renderer';

    const keys = [
      'WASD move  |  Space jump / swim  |  Shift sneak  |  Ctrl or double W sprint',
      'LMB mine / attack  |  RMB place / use / eat  |  wheel, 1-9 hotbar  |  Q drop  |  E inventory + crafting',
      'F5 / V camera  |  F3 debug  |  M map  |  creative: double Space fly, MMB pick block',
    ];
    keys.forEach((k, i) => ui.text(k, w / 2, h - 64 + i * 19, 12.5, [238, 238, 238, 235], 0.5, 0.5, 2));
    return action;
  }

  drawPause(st: Settings, creative: boolean): string | null {
    this.dim(150);
    const w = this.w, h = this.h, bw = 380, bh = 40, bx = w / 2 - bw / 2, gap = 10;
    this.menu.text('Game Paused', w / 2, h * 0.16, 40, WHITE, 0.5, 0.5, 4);
    let by = h * 0.26, action: string | null = null;
    if (this.button('Back to Game', bx, by, bw, bh)) action = 'resume';
    by += bh + gap;
    const rd = this.slider('rd', `View distance: ${st.renderDist} chunks${st.auto ? ' (auto)' : ''}`, bx, by, bw, bh, st.renderDist, 2, 8);
    if (rd !== st.renderDist) { st.renderDist = rd; st.auto = false; action = 'settings'; }
    by += bh + gap;
    const fov = this.slider('fov', `FOV: ${st.fov}`, bx, by, bw, bh, st.fov, 50, 110);
    const sens = this.slider('sens', `Mouse sensitivity: ${st.sens}`, bx, by + bh + gap, bw, bh, st.sens, 2, 30);
    const vol = this.slider('vol', `Volume: ${st.vol}`, bx, by + 2 * (bh + gap), bw, bh, st.vol, 0, 10);
    if (fov !== st.fov || sens !== st.sens || vol !== st.vol) { st.fov = fov; st.sens = sens; st.vol = vol; action = 'settings'; }
    by += 3 * (bh + gap);
    if (this.button(`Auto quality: ${st.auto ? 'On' : 'Off'}`, bx, by, bw, bh)) action = 'auto';
    by += bh + gap;
    if (this.button(`Game mode: ${creative ? 'Creative' : 'Survival'} (click to switch)`, bx, by, bw, bh)) action = 'mode';
    by += bh + gap;
    if (this.button('Save and Quit to Title', bx, by, bw, bh)) action = 'quit';
    return action;
  }

  drawDead(gems: number): string | null {
    this.menu.rect(0, 0, this.w, this.h, [120, 0, 0, 140]);
    this.menu.text('You died!', this.w / 2, this.h * 0.32, 56, WHITE, 0.5, 0.5, 6);
    this.menu.text(`Gems collected: ${gems}`, this.w / 2, this.h * 0.32 + 56, 18, WHITE, 0.5, 0.5, 3);
    if (this.button('Respawn', this.w / 2 - 190, this.h * 0.5, 380, 46)) return 'respawn';
    return null;
  }

  /**
   * Inventory with 2x2 crafting, crafting table (3x3), furnace, or the creative palette.
   * Returns true if a slot was clicked (for the UI sound).
   */
  drawWindow(kind: WindowKind, inv: Inventory, ws: WindowState, creative: boolean, furnace: Furnace | null): boolean {
    this.dim(140);
    const ui = this.menu, inp = this.input, w = this.w, h = this.h;
    const palette = kind === 'inventory' && creative;
    const palRows = Math.ceil(CREATIVE_ITEMS.length / 9);
    const topRows = palette ? palRows : 3.4;
    const size = Math.floor(Math.min(46, (h - 110) / (topRows + 5.2)));
    const gridW = 9 * size, pad = 16;
    const topH = topRows * size;
    const panelW = gridW + pad * 2, panelH = topH + 4 * size + 78;
    const px = Math.floor((w - panelW) / 2), py = Math.floor((h - panelH) / 2);
    ui.rect(px - 2, py - 2, panelW + 4, panelH + 4, [0, 0, 0, 255]);
    ui.rect(px, py, panelW, panelH, [255, 255, 255, 255]);
    ui.rect(px + 3, py + 3, panelW - 3, panelH - 3, [85, 85, 85, 255]);
    ui.rect(px + 3, py + 3, panelW - 6, panelH - 6, PANEL);

    let clicked = false, tip = '';
    const shift = inp.keys.has('ShiftLeft') || inp.keys.has('ShiftRight');
    const cell = (arr: (Stack | null)[], i: number, k: SlotKind, x: number, y: number, sz = size) => {
      const over = this.over(x, y, sz, sz);
      this.slot(ui, x, y, sz, arr[i], over);
      if (!over) return;
      const s = arr[i];
      if (s) tip = itemName(s.id);
      const ref: SlotRef = { arr, i, kind: k };
      if (inp.clicked[0]) { ws.click(ref, 0, shift, inv); clicked = true; }
      else if (inp.clicked[2]) { ws.click(ref, 2, shift, inv); clicked = true; }
    };

    const gx = px + pad;
    let gy = py + 30;
    if (palette) {
      ui.text('Creative - every block and item', gx, py + 17, 14, PANEL_TEXT, 0, 0.5);
      const stacks = CREATIVE_ITEMS.map((id) => makeStack(id, 1));
      for (let i = 0; i < stacks.length; i++) cell(stacks, i, 'palette', gx + (i % 9) * size, gy + Math.floor(i / 9) * size);
    } else if (kind === 'furnace' && furnace) {
      ui.text('Furnace', gx, py + 17, 14, PANEL_TEXT, 0, 0.5);
      const fx = px + panelW / 2 - size * 2.2, fy = gy + 4;
      cell(furnace.slots, 0, 'normal', fx, fy);
      cell(furnace.slots, 1, 'fuel', fx, fy + size * 2.1);
      // Flame: a looping Lottie, clipped from the top as the fuel burns down.
      const bf = furnace.burnMax ? Math.max(0, furnace.burn / furnace.burnMax) : 0;
      const fs = size * 0.95, flx = fx + (size - fs) / 2, fly = fy + size * 1.07;
      ui.rect(flx + fs * 0.12, fly + fs * 0.05, fs * 0.76, fs * 0.9, [150, 150, 150, 255], 6);
      this.furnaceDrawn = true;
      setFrame(this.flame, (this.lastTime * 30) % FLAME_FRAMES);
      this.flame.picture.visible(bf > 0).size(fs, fs).translate(flx, fly);
      this.flameClip.reset().appendRect(flx, fly + fs * (1 - bf) * 0.9, fs, fs);
      // Progress arrow: the Lottie's trim path is scrubbed by the smelting progress.
      const ah = size * 0.9, aw = ah * 1.5, ax = fx + size * 1.45, ay = fy + size * 1.05;
      setFrame(this.arrow, Math.min(ARROW_FRAMES - 1, (furnace.cook / COOK_TIME) * (ARROW_FRAMES - 1)));
      this.arrow.picture.visible(true).size(aw, ah).translate(ax, ay);
      cell(furnace.slots, 2, 'output', fx + size * 3.3, fy + size * 0.9, size * 1.2);
    } else {
      ui.text(kind === 'crafting' ? 'Crafting Table' : 'Crafting', gx, py + 17, 14, PANEL_TEXT, 0, 0.5);
      const n = ws.craftSize;
      const cx0 = px + panelW / 2 - size * (n === 3 ? 2.9 : 2.4), cy0 = gy + (3.4 - n) * size * 0.5 - 4;
      for (let i = 0; i < n * n; i++) cell(ws.craft, i, 'craft', cx0 + (i % n) * size, cy0 + Math.floor(i / n) * size);
      const ax = cx0 + n * size + size * 0.5, ay = cy0 + (n * size) / 2;
      ui.rect(ax, ay - 4, size * 0.7, 8, [120, 120, 120, 255]);
      ui.poly([ax + size * 0.7, ay - 12, ax + size * 1.05, ay, ax + size * 0.7, ay + 12], [120, 120, 120, 255]);
      cell(ws.craftOut, 0, 'craftout', ax + size * 1.4, ay - size * 0.6, size * 1.2);
    }

    gy = py + 30 + topH + 22;
    ui.text('Inventory', gx, gy - 11, 14, PANEL_TEXT, 0, 0.5);
    for (let i = 9; i < 36; i++) cell(inv.slots, i, 'normal', gx + ((i - 9) % 9) * size, gy + Math.floor((i - 9) / 9) * size);
    for (let i = 0; i < 9; i++) cell(inv.slots, i, 'normal', gx + i * size, gy + 3 * size + 8);

    // Cursor stack and tooltip float above everything.
    const t = this.top;
    if (ws.cursor) this.stack(t, ws.cursor, inp.mouseX - size / 2, inp.mouseY - size / 2, size);
    else if (tip) {
      // Size the box from real font metrics. (ThorVG's bounds() lags a frame behind on pooled text paints, which
      // made the box keep the previous item's width.)
      t.text(tip, inp.mouseX + 22, inp.mouseY - 19, 13, WHITE, 0, 0.5);
      const tw = this.textWidth(tip, 13);
      t.rect(inp.mouseX + 12, inp.mouseY - 32, tw + 20, 26, [42, 10, 90, 255]);
      t.rect(inp.mouseX + 14, inp.mouseY - 30, tw + 16, 22, [16, 0, 32, 245]);
    }
    return clicked;
  }

  drawLoading(progress: number) {
    const ui = this.menu, w = this.w, h = this.h;
    ui.rect(0, 0, w, h, [27, 19, 12, 255]);
    ui.text('Generating world...', w / 2, h / 2 - 30, 22, WHITE, 0.5, 0.5);
    ui.rect(w / 2 - 152, h / 2 - 2, 304, 14, [255, 255, 255, 255]);
    ui.rect(w / 2 - 150, h / 2, 300, 10, [27, 19, 12, 255]);
    ui.rect(w / 2 - 150, h / 2, 300 * progress, 10, [102, 204, 68, 255]);
  }
}
