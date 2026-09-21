// In-game HUD and menus, drawn with ThorVG like everything else.

import { B, BLOCKS, Item, iconColor, itemName } from './blocks';
import { Input } from './input';
import { CREATIVE_ITEMS, HOTBAR, Inventory, RECIPES, Stack } from './inventory';
import { Player } from './player';
import { UILayer, isoCube } from './ui';
import { SEA, World } from './world';

const HEART = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
const WHITE = [255, 255, 255, 255] as const;

export interface HudInfo {
  fps: number; debug: boolean; debugLines: string[]; gems: number; toast: string; toastAlpha: number;
  breakProgress: number; renderer: string; thirdPerson: boolean; timeOfDay: number;
}

export class Hud {
  readonly scene: any;
  private mapScene: any;
  private mapShapes = new Map<number, any>();
  private mapKey = '';
  private mapTimer = 0;
  private hud: UILayer; private menu: UILayer; private top: UILayer;
  w = 0; h = 0;
  /** Set by buttons each frame. */
  hot = false;

  constructor(private TVG: any, private input: Input, font: string) {
    this.scene = new TVG.Scene();
    this.mapScene = new TVG.Scene();
    this.hud = new UILayer(TVG, font);
    this.menu = new UILayer(TVG, font);
    this.top = new UILayer(TVG, font);
    this.scene.add(this.hud.scene).add(this.mapScene).add(this.menu.scene).add(this.top.scene);
  }

  begin(w: number, h: number) {
    this.w = w; this.h = h; this.hot = false;
    this.hud.begin(); this.menu.begin(); this.top.begin();
  }

  end() { this.hud.end(); this.menu.end(); this.top.end(); }

  // ------------------------------------------------------------------ widgets

  private icon(ui: UILayer, id: number, cx: number, cy: number, r: number) {
    if (id === Item.PORK) {
      ui.rect(cx - r * 0.8, cy - r * 0.5, r * 1.6, r, [236, 132, 140], r * 0.4);
      ui.rect(cx - r * 0.5, cy - r * 0.25, r * 0.6, r * 0.5, [250, 190, 190], r * 0.2);
    } else if (id === Item.GEM) {
      ui.poly([cx, cy - r, cx + r * 0.8, cy - r * 0.2, cx, cy + r, cx - r * 0.8, cy - r * 0.2], [92, 226, 232]);
      ui.poly([cx, cy - r, cx + r * 0.8, cy - r * 0.2, cx - r * 0.8, cy - r * 0.2], [190, 250, 252]);
    } else {
      const bd = BLOCKS[id];
      isoCube(ui, cx, cy, r, bd.top, bd.side, Math.max(bd.alpha ?? 255, 140));
    }
  }

  private slot(ui: UILayer, x: number, y: number, size: number, stack: Stack | null, selected: boolean, hover = false) {
    ui.rect(x, y, size, size, hover ? [70, 76, 92, 230] : [24, 26, 34, 190], 6);
    if (selected) ui.frame(x - 1, y - 1, size + 2, size + 2, [255, 255, 255, 255], 3, 7);
    else ui.frame(x, y, size, size, [120, 126, 140, 160], 1.5, 6);
    if (stack) {
      this.icon(ui, stack.id, x + size / 2, y + size / 2, size * 0.3);
      if (stack.count > 1) ui.text(String(stack.count), x + size - 5, y + size - 3, size * 0.3, WHITE, 1, 1, 2);
    }
  }

  button(label: string, x: number, y: number, w: number, h: number, enabled = true): boolean {
    const ui = this.menu, inp = this.input;
    const over = enabled && inp.mouseX >= x && inp.mouseX <= x + w && inp.mouseY >= y && inp.mouseY <= y + h;
    if (over) this.hot = true;
    ui.rect(x, y + 3, w, h, [0, 0, 0, 120], 8);
    ui.rect(x, y, w, h, !enabled ? [60, 62, 70, 220] : over ? [88, 150, 86, 255] : [58, 62, 78, 240], 8);
    ui.frame(x, y, w, h, over ? [210, 255, 200, 255] : [150, 156, 176, 200], 2, 8);
    ui.text(label, x + w / 2, y + h / 2, Math.min(20, h * 0.42), enabled ? WHITE : [150, 150, 150, 255], 0.5, 0.5);
    return over && inp.clicked[0];
  }

  // ------------------------------------------------------------------ gameplay HUD

  drawGame(player: Player, inv: Inventory, info: HudInfo, time: number) {
    const ui = this.hud, w = this.w, h = this.h;

    if (player.headInWater) ui.rect(0, 0, w, h, [20, 60, 160, 90]);
    if (player.hurtTimer > 0) ui.rect(0, 0, w, h, [220, 20, 20, Math.floor(player.hurtTimer * 320)]);
    // Vignette at night makes the scene feel darker without hiding geometry.

    if (!info.thirdPerson) this.drawHand(ui, player, inv, time);

    // Crosshair
    const cx = w / 2, cy = h / 2;
    ui.rect(cx - 10, cy - 1.5, 20, 3, [0, 0, 0, 120]);
    ui.rect(cx - 1.5, cy - 10, 3, 20, [0, 0, 0, 120]);
    ui.rect(cx - 9, cy - 0.75, 18, 1.5, [255, 255, 255, 230]);
    ui.rect(cx - 0.75, cy - 9, 1.5, 18, [255, 255, 255, 230]);
    if (info.breakProgress > 0) {
      ui.rect(cx - 24, cy + 20, 48, 6, [0, 0, 0, 150], 3);
      ui.rect(cx - 23, cy + 21, 46 * info.breakProgress, 4, [255, 255, 255, 230], 2);
    }

    // Hotbar
    const size = Math.min(52, (w - 40) / HOTBAR), gap = 4;
    const total = HOTBAR * size + (HOTBAR - 1) * gap;
    const x0 = (w - total) / 2, y0 = h - size - 14;
    for (let i = 0; i < HOTBAR; i++) this.slot(ui, x0 + i * (size + gap), y0, size, inv.slots[i], i === inv.selected);
    const held = inv.held;
    if (held) ui.text(itemName(held.id), w / 2, y0 - (player.creative ? 12 : 40), 15, WHITE, 0.5, 1, 2);

    // Hearts and air
    if (!player.creative) {
      const px = 2.6, hy = y0 - 26;
      const full = ui.shape(), empty = ui.shape();
      for (let i = 0; i < 10; i++) {
        const hp = player.health - i * 2;
        const hx = x0 + i * (px * 8);
        const shake = player.health <= 6 ? Math.sin(time * 18 + i) * 1.2 : 0;
        for (let r = 0; r < HEART.length; r++) for (let c = 0; c < 7; c++) {
          if (HEART[r][c] !== '1') continue;
          const filled = hp >= 2 || (hp === 1 && c < 4);
          (filled ? full : empty).appendRect(hx + c * px, hy + r * px + shake, px + 0.3, px + 0.3);
        }
      }
      empty.fill(40, 16, 20, 200);
      full.fill(232, 48, 60, 255);
      if (player.air < 10) {
        const bub = ui.shape();
        const n = Math.ceil(player.air);
        for (let i = 0; i < n; i++) bub.appendCircle(x0 + total - 8 - i * 18, hy + 8, 6.5, 6.5);
        bub.fill(150, 210, 255, 220).stroke({ width: 1.5, color: [235, 250, 255, 255] });
      }
    }

    // Gems + clock
    ui.rect(12, 12, 150, 34, [18, 20, 28, 170], 8);
    this.icon(ui, Item.GEM, 32, 29, 10);
    ui.text(String(info.gems), 50, 29, 18, WHITE, 0, 0.5);
    const hr = Math.floor(((info.timeOfDay * 24 + 6) % 24));
    const mn = Math.floor((((info.timeOfDay * 24 + 6) % 24) - hr) * 60);
    ui.text(`${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}`, 150, 29, 15, [200, 210, 230, 255], 1, 0.5);
    ui.text(player.creative ? 'CREATIVE' : 'SURVIVAL', 14, 58, 11, [200, 210, 230, 200], 0, 0.5, 2);

    if (info.toastAlpha > 0) ui.text(info.toast, w / 2, h * 0.24, 20, [255, 255, 255, Math.floor(info.toastAlpha * 255)], 0.5, 0.5, 3);

    if (info.debug) {
      ui.rect(8, 76, 330, 18 * info.debugLines.length + 12, [0, 0, 0, 130], 6);
      for (let i = 0; i < info.debugLines.length; i++) ui.text(info.debugLines[i], 16, 84 + i * 18, 13, [220, 255, 220, 255], 0, 0);
    }
  }

  /** First-person arm with the held block. */
  private drawHand(ui: UILayer, player: Player, inv: Inventory, time: number) {
    const w = this.w, h = this.h, s = Math.min(w, h);
    const sw = Math.sin(player.swing * Math.PI);
    const bobX = Math.cos(player.walkPhase) * 8 * player.bob, bobY = Math.abs(Math.sin(player.walkPhase)) * 10 * player.bob;
    const bx = w - s * 0.2 + bobX - sw * s * 0.12, by = h - s * 0.13 + bobY + sw * s * 0.08 + Math.sin(time * 1.4) * 2;
    const held = inv.held;
    // Arm
    ui.poly([bx + s * 0.02, by + s * 0.02, bx + s * 0.13, by - s * 0.03, bx + s * 0.3, h + 40, bx + s * 0.12, h + 40], [222, 184, 40]);
    ui.poly([bx + s * 0.13, by - s * 0.03, bx + s * 0.17, by + s * 0.01, bx + s * 0.36, h + 40, bx + s * 0.3, h + 40], [180, 146, 30]);
    if (held) {
      if (held.id < 100) { const bd = BLOCKS[held.id]; isoCube(ui, bx + s * 0.02, by - s * 0.03, s * 0.12, bd.top, bd.side, Math.max(bd.alpha ?? 255, 150)); }
      else this.icon(ui, held.id, bx + s * 0.03, by - s * 0.02, s * 0.08);
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
          const base = iconColor(id);
          const k = Math.min(1.15, 0.62 + Math.max(top, SEA) / 90 + ((top & 1) ? 0.03 : 0));
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
    const ui = this.hud;
    ui.rect(ox - 4, oy - 4, size + 8, size + 8, [18, 20, 28, 200], 6);
    // Player arrow (drawn in the top layer so it sits above the map scene)
    const t = this.top;
    const cx = ox + size / 2, cy = oy + size / 2, a = player.yaw;
    const fx = -Math.sin(a), fz = -Math.cos(a);
    t.poly([cx + fx * 8, cy + fz * 8, cx - fx * 5 - fz * 5, cy - fz * 5 + fx * 5, cx - fx * 2, cy - fz * 2, cx - fx * 5 + fz * 5, cy - fz * 5 - fx * 5], [255, 255, 255, 255])
      .stroke({ width: 1.5, color: [0, 0, 0, 255], join: 'round' });
    t.text('N', cx, oy + 2, 11, [255, 255, 255, 220], 0.5, 0, 2);
  }

  setMinimapVisible(v: boolean) { this.mapScene.visible(v); }

  // ------------------------------------------------------------------ screens

  private dim(alpha: number) { this.menu.rect(0, 0, this.w, this.h, [8, 10, 18, alpha]); }

  drawTitle(hasSave: boolean, creative: boolean, renderer: string, time: number): string | null {
    const ui = this.menu, w = this.w, h = this.h;
    ui.rect(0, 0, w, h, [8, 10, 18, 90]);
    const ty = h * 0.24;
    // Block logo
    const bs = Math.min(34, w / 24);
    const cols: number[] = [B.GRASS, B.LOG, B.STONE, B.BRICK, B.DIAMOND_ORE, B.PLANKS, B.SAND, B.LAMP, B.TNT];
    for (let i = 0; i < cols.length; i++) {
      const bd = BLOCKS[cols[i]];
      isoCube(ui, w / 2 + (i - 4) * bs * 2.1, ty - 84 + Math.sin(time * 2 + i * 0.7) * 6, bs, bd.top, bd.side);
    }
    ui.text('THORCRAFT', w / 2, ty, Math.min(84, w / 8), [255, 255, 255, 255], 0.5, 0.5, 8);
    ui.text('a voxel sandbox drawn with a 2D vector engine', w / 2, ty + 58, 18, [225, 235, 250, 255], 0.5, 0.5, 3);

    const bw = 300, bh = 50, bx = w / 2 - bw / 2;
    let by = h * 0.5;
    let action: string | null = null;
    if (this.button(hasSave ? 'Continue' : 'Play', bx, by, bw, bh)) action = 'play';
    by += bh + 12;
    if (this.button('New World', bx, by, bw, bh)) action = 'new';
    by += bh + 12;
    if (this.button(`Mode: ${creative ? 'Creative' : 'Survival'}`, bx, by, bw, bh)) action = 'mode';
    by += bh + 12;
    if (this.button(`Renderer: ${renderer === 'gl' ? 'WebGL' : renderer === 'wg' ? 'WebGPU' : 'Software'}`, bx, by, bw, bh)) action = 'renderer';
    ui.text('WASD move  |  Space jump  |  Mouse look  |  LMB break  |  RMB place/use  |  E inventory  |  1-9 hotbar', w / 2, h - 46, 13, [225, 235, 250, 230], 0.5, 0.5, 2);
    ui.text('F5 camera  |  F3 debug  |  T skip time  |  M map  |  double Space fly (creative)  |  Esc pause', w / 2, h - 26, 13, [225, 235, 250, 230], 0.5, 0.5, 2);
    return action;
  }

  drawPause(renderDistance: number, auto: boolean): string | null {
    this.dim(150);
    const w = this.w, h = this.h, bw = 300, bh = 50, bx = w / 2 - bw / 2;
    this.menu.text('Paused', w / 2, h * 0.24, 46, WHITE, 0.5, 0.5, 5);
    let by = h * 0.36, action: string | null = null;
    if (this.button('Resume', bx, by, bw, bh)) action = 'resume';
    by += bh + 12;
    if (this.button('-', bx, by, 60, bh)) action = 'dist-';
    this.menu.rect(bx + 68, by, bw - 136, bh, [30, 32, 42, 230], 8);
    this.menu.text(`View distance: ${renderDistance}${auto ? ' (auto)' : ''}`, w / 2, by + bh / 2, 16, WHITE, 0.5, 0.5);
    if (this.button('+', bx + bw - 60, by, 60, bh)) action = 'dist+';
    by += bh + 12;
    if (this.button(`Auto quality: ${auto ? 'On' : 'Off'}`, bx, by, bw, bh)) action = 'auto';
    by += bh + 12;
    if (this.button('Save & Quit to Title', bx, by, bw, bh)) action = 'quit';
    return action;
  }

  drawDead(gems: number): string | null {
    this.menu.rect(0, 0, this.w, this.h, [120, 10, 10, 130]);
    this.menu.text('You died!', this.w / 2, this.h * 0.32, 56, WHITE, 0.5, 0.5, 6);
    this.menu.text(`Gems collected: ${gems}`, this.w / 2, this.h * 0.32 + 56, 18, WHITE, 0.5, 0.5, 3);
    if (this.button('Respawn', this.w / 2 - 150, this.h * 0.5, 300, 50)) return 'respawn';
    return null;
  }

  /** Inventory, crafting (survival) or block palette (creative). Returns true if a UI sound should play. */
  drawInventory(inv: Inventory, creative: boolean): boolean {
    this.dim(140);
    const ui = this.menu, inp = this.input, w = this.w, h = this.h;
    const size = 48, gap = 5, cols = 9;
    const gridW = cols * size + (cols - 1) * gap;
    const sideW = creative ? 0 : 300;
    const panelW = gridW + 48 + sideW, panelH = creative ? 480 : 360;
    const px = (w - panelW) / 2, py = (h - panelH) / 2;
    ui.rect(px, py + 5, panelW, panelH, [0, 0, 0, 120], 14);
    ui.rect(px, py, panelW, panelH, [44, 48, 62, 245], 14);
    ui.frame(px, py, panelW, panelH, [150, 156, 176, 220], 2, 14);
    let clicked = false;
    let tip = '';
    const gx = px + 24;
    let gy = py + 50;

    if (creative) {
      ui.text('Blocks (click to put in the selected hotbar slot)', gx, py + 26, 16, WHITE, 0, 0.5);
      for (let i = 0; i < CREATIVE_ITEMS.length; i++) {
        const x = gx + (i % cols) * (size + gap), y = gy + Math.floor(i / cols) * (size + gap);
        const over = inp.mouseX >= x && inp.mouseX < x + size && inp.mouseY >= y && inp.mouseY < y + size;
        this.slot(ui, x, y, size, { id: CREATIVE_ITEMS[i], count: 1 }, false, over);
        if (over) { tip = itemName(CREATIVE_ITEMS[i]); if (inp.clicked[0]) { inv.slots[inv.selected] = { id: CREATIVE_ITEMS[i], count: 64 }; clicked = true; } }
      }
      gy += 3 * (size + gap) + 34;
      ui.text('Inventory', gx, gy - 16, 16, WHITE, 0, 0.5);
    } else {
      ui.text('Inventory', gx, py + 26, 16, WHITE, 0, 0.5);
    }

    // Main inventory rows (slots 9..35), then the hotbar.
    for (let i = 0; i < 36; i++) {
      const slotIndex = i < 27 ? i + 9 : i - 27;
      const row = Math.floor(i / cols);
      const x = gx + (i % cols) * (size + gap), y = gy + row * (size + gap) + (row === 3 ? 14 : 0);
      const over = inp.mouseX >= x && inp.mouseX < x + size && inp.mouseY >= y && inp.mouseY < y + size;
      this.slot(ui, x, y, size, inv.slots[slotIndex], slotIndex === inv.selected, over);
      if (over) {
        const s = inv.slots[slotIndex];
        if (s) tip = itemName(s.id);
        if (inp.clicked[0]) { inv.clickSlot(slotIndex); clicked = true; }
        if (inp.clicked[2] && creative) { inv.slots[slotIndex] = null; clicked = true; }
      }
    }

    if (!creative) {
      const rx = gx + gridW + 24;
      ui.text('Crafting', rx, py + 26, 16, WHITE, 0, 0.5);
      for (let i = 0; i < RECIPES.length; i++) {
        const r = RECIPES[i], y = py + 46 + i * 27, can = inv.canCraft(r);
        const over = inp.mouseX >= rx && inp.mouseX < rx + sideW - 24 && inp.mouseY >= y && inp.mouseY < y + 25;
        ui.rect(rx, y, sideW - 24, 25, over && can ? [88, 150, 86, 255] : can ? [58, 66, 84, 255] : [36, 38, 48, 255], 5);
        this.icon(ui, r.out.id, rx + 15, y + 12.5, 8);
        const need = r.in.map((s) => `${s.count} ${itemName(s.id)}`).join(' + ');
        ui.text(`${r.out.count}x  <=  ${need}`, rx + 32, y + 12.5, 11.5, can ? WHITE : [140, 144, 156, 255], 0, 0.5);
        if (over && can && inp.clicked[0]) { inv.craft(r); clicked = true; }
      }
    }

    ui.text('E or Esc to close', px + panelW / 2, py + panelH - 16, 12, [190, 196, 214, 255], 0.5, 0.5);

    // Cursor stack and tooltip float above everything.
    const t = this.top;
    if (inv.cursor) {
      this.icon(t, inv.cursor.id, inp.mouseX, inp.mouseY, size * 0.3);
      if (inv.cursor.count > 1) t.text(String(inv.cursor.count), inp.mouseX + 16, inp.mouseY + 18, 14, WHITE, 1, 1, 2);
    } else if (tip) {
      t.rect(inp.mouseX + 12, inp.mouseY - 30, tip.length * 8 + 20, 24, [12, 12, 20, 235], 5);
      t.text(tip, inp.mouseX + 22, inp.mouseY - 18, 13, WHITE, 0, 0.5);
    }
    return clicked;
  }

  drawLoading(progress: number) {
    const ui = this.menu, w = this.w, h = this.h;
    ui.rect(0, 0, w, h, [12, 14, 22, 255]);
    ui.text('Generating world...', w / 2, h / 2 - 30, 22, WHITE, 0.5, 0.5);
    ui.rect(w / 2 - 160, h / 2, 320, 14, [40, 44, 58, 255], 7);
    ui.rect(w / 2 - 158, h / 2 + 2, 316 * progress, 10, [106, 170, 64, 255], 5);
  }
}
