// Inventory container, shaped crafting recipes and the furnace simulation.

import { B, BLOCKS, I, ITEMS, SMELT, TOOL_MATS, maxStack, toolId } from './blocks';

export interface Stack { id: number; count: number; dur?: number }
export const HOTBAR = 9;
export const SLOTS = 36;

export const makeStack = (id: number, count = 1): Stack => {
  const def = ITEMS.get(id);
  const s: Stack = { id, count };
  if (def?.tool) s.dur = def.tool.dur;
  return s;
};

export class Inventory {
  slots: (Stack | null)[] = new Array(SLOTS).fill(null);
  selected = 0;

  get held(): Stack | null { return this.slots[this.selected]; }

  /** Adds items, returns the amount that did not fit. */
  add(id: number, count: number, dur?: number): number {
    const max = maxStack(id);
    if (max > 1) for (const s of this.slots) {
      if (count <= 0) break;
      if (s && s.id === id && s.count < max) { const n = Math.min(count, max - s.count); s.count += n; count -= n; }
    }
    for (let i = 0; i < SLOTS && count > 0; i++) {
      if (!this.slots[i]) { const n = Math.min(count, max); const s = makeStack(id, n); if (dur !== undefined) s.dur = dur; this.slots[i] = s; count -= n; }
    }
    return count;
  }

  canAdd(id: number, count: number): boolean {
    const max = maxStack(id);
    let room = 0;
    for (const s of this.slots) { if (!s) room += max; else if (s.id === id && max > 1) room += max - s.count; }
    return room >= count;
  }

  consumeHeld(n = 1) {
    const s = this.held;
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
  }

  /** Wears the held tool down by one use; returns true if it broke. */
  damageHeld(): boolean {
    const s = this.held;
    if (!s || s.dur === undefined) return false;
    if (--s.dur <= 0) { this.slots[this.selected] = null; return true; }
    return false;
  }

  load(slots: (Stack | null)[], selected: number) {
    this.slots = new Array(SLOTS).fill(null);
    slots.forEach((s, i) => { if (i < SLOTS && s && ITEMS.has(s.id)) this.slots[i] = { ...s }; });
    this.selected = selected || 0;
  }
}

// ---------------------------------------------------------------- recipes

interface Recipe { w: number; h: number; cells: (number[] | null)[]; out: number; count: number }
const R: Recipe[] = [];
const add = (pattern: string[], keyMap: Record<string, number | number[]>, out: number, count = 1) => {
  R.push({ w: pattern[0].length, h: pattern.length, cells: pattern.join('').split('').map((ch) => (ch === ' ' ? null : ([] as number[]).concat(keyMap[ch]))), out, count });
};
const PLANKS = [B.PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS];
add(['#'], { '#': B.LOG }, B.PLANKS, 4);
add(['#'], { '#': B.BIRCH_LOG }, B.BIRCH_PLANKS, 4);
add(['#'], { '#': B.SPRUCE_LOG }, B.SPRUCE_PLANKS, 4);
add(['#', '#'], { '#': PLANKS }, I.STICK, 4);
add(['##', '##'], { '#': PLANKS }, B.CRAFTING_TABLE);
add(['###', '# #', '###'], { '#': B.COBBLE }, B.FURNACE);
add(['c', 's'], { c: I.COAL, s: I.STICK }, B.TORCH, 4);
add(['##', '##'], { '#': B.SAND }, B.SANDSTONE);
add(['##', '##'], { '#': B.STONE }, B.STONE_BRICKS, 4);
add(['##', '##'], { '#': B.STONE_BRICKS }, B.BRICK, 4);
add(['##', '##'], { '#': B.SNOW }, B.ICE);
add(['gsg', 'sgs', 'gsg'], { g: I.GUNPOWDER, s: B.SAND }, B.TNT);
add(['###', 'bbb', '###'], { '#': PLANKS, b: I.COAL }, B.BOOKSHELF);
add(['ggg', 'gcg', 'ggg'], { g: I.GOLD_INGOT, c: I.COAL }, B.GLOWSTONE, 4);
for (const [blk, it] of [[B.IRON_BLOCK, I.IRON_INGOT], [B.GOLD_BLOCK, I.GOLD_INGOT], [B.DIAMOND_BLOCK, I.DIAMOND]] as [number, number][]) {
  add(['###', '###', '###'], { '#': it }, blk);
  add(['#'], { '#': blk }, it, 9);
}
const MAT_ITEM: (number | number[])[] = [PLANKS, B.COBBLE, I.IRON_INGOT, I.DIAMOND];
TOOL_MATS.forEach((_, mi) => {
  const k = { m: MAT_ITEM[mi], s: I.STICK };
  add(['mmm', ' s ', ' s '], k, toolId(mi, 0));
  add(['mm', 'ms', ' s'], k, toolId(mi, 1));
  add(['m', 's', 's'], k, toolId(mi, 2));
  add(['m', 'm', 's'], k, toolId(mi, 3));
});
export const RECIPES = R;

/** Matches a size x size crafting grid against all recipes (anywhere in the grid, mirrored too). */
export function matchRecipe(grid: (Stack | null)[], size: number): Stack | null {
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (grid[y * size + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  for (const r of R) {
    if (r.w !== w || r.h !== h) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < h && ok; y++) for (let x = 0; x < w; x++) {
        const need = r.cells[y * w + (mirror ? w - 1 - x : x)];
        const have = grid[(y0 + y) * size + x0 + x];
        if (need ? !(have && need.includes(have.id)) : !!have) { ok = false; break; }
      }
      if (ok) return makeStack(r.out, r.count);
    }
  }
  return null;
}

// ---------------------------------------------------------------- furnace

export interface Furnace { x: number; y: number; z: number; slots: (Stack | null)[]; burn: number; burnMax: number; cook: number; lit?: boolean }
export const COOK_TIME = 8;

/** Advances one furnace; returns whether it is burning. Slots: input, fuel, output. */
export function tickFurnace(f: Furnace, dt: number): boolean {
  const [inp, fuel, out] = f.slots;
  const res = inp ? SMELT.get(inp.id) : undefined;
  const canCook = res !== undefined && (!out || (out.id === res && out.count < maxStack(res)));
  if (f.burn <= 0 && canCook && fuel && ITEMS.get(fuel.id)!.fuel) {
    f.burn = f.burnMax = ITEMS.get(fuel.id)!.fuel;
    if (--fuel.count <= 0) f.slots[1] = null;
  }
  if (f.burn > 0) {
    f.burn -= dt;
    if (canCook) {
      f.cook += dt;
      if (f.cook >= COOK_TIME) {
        f.cook = 0;
        if (--inp!.count <= 0) f.slots[0] = null;
        if (out) out.count++; else f.slots[2] = makeStack(res!, 1);
      }
    } else f.cook = 0;
  } else f.cook = 0;
  return f.burn > 0;
}

/** Everything offered on the creative palette. */
export const CREATIVE_ITEMS: number[] = [...ITEMS.values()].filter((d) => !d.hidden).map((d) => d.id);

/**
 * The slot-click rules shared by every window (inventory, crafting grid, furnace, palette).
 * `cursor` is the stack attached to the mouse.
 */
export type SlotKind = 'normal' | 'craft' | 'craftout' | 'fuel' | 'output' | 'palette';
export interface SlotRef { arr: (Stack | null)[]; i: number; kind: SlotKind }

export class WindowState {
  cursor: Stack | null = null;
  craft: (Stack | null)[] = new Array(9).fill(null);
  craftSize = 2;
  craftOut: (Stack | null)[] = [null];

  refresh() { this.craftOut[0] = matchRecipe(this.craft.slice(0, this.craftSize * this.craftSize), this.craftSize); }

  private consumeCraft() {
    for (let i = 0; i < this.craftSize * this.craftSize; i++) { const s = this.craft[i]; if (s && --s.count <= 0) this.craft[i] = null; }
    this.refresh();
  }

  click(ref: SlotRef, button: number, shift: boolean, inv: Inventory) {
    const { arr, i, kind } = ref;
    const s = arr[i], c = this.cursor;
    if (kind === 'palette') {
      if (c) this.cursor = null;
      else if (s) this.cursor = makeStack(s.id, button === 2 || maxStack(s.id) === 1 ? 1 : maxStack(s.id));
    } else if (kind === 'craftout' || kind === 'output') {
      if (s) {
        if (shift) {
          const id = s.id;
          for (let n = 0; n < 64 && arr[i] && arr[i]!.id === id && inv.canAdd(id, arr[i]!.count); n++) {
            inv.add(id, arr[i]!.count, arr[i]!.dur);
            if (kind === 'craftout') this.consumeCraft(); else arr[i] = null;
          }
        } else if (!c) { this.cursor = s; arr[i] = null; if (kind === 'craftout') this.consumeCraft(); }
        else if (c.id === s.id && c.count + s.count <= maxStack(s.id) && maxStack(s.id) > 1) { c.count += s.count; arr[i] = null; if (kind === 'craftout') this.consumeCraft(); }
      }
    } else if (shift && s) {
      if (arr === inv.slots) {
        const [from, to] = i < 9 ? [9, 36] : [0, 9];
        arr[i] = null;
        let left = s.count;
        const max = maxStack(s.id);
        for (let k = from; k < to && left && max > 1; k++) { const t = arr[k]; if (t && t.id === s.id && t.count < max) { const n = Math.min(left, max - t.count); t.count += n; left -= n; } }
        for (let k = from; k < to && left; k++) if (!arr[k]) { arr[k] = { ...s, count: left }; left = 0; }
        if (left) arr[i] = { ...s, count: left };
      } else { arr[i] = null; const left = inv.add(s.id, s.count, s.dur); if (left) arr[i] = { ...s, count: left }; }
    } else if (button === 0) {
      if (!c) { this.cursor = s; arr[i] = null; }
      else if (!s) { arr[i] = c; this.cursor = null; }
      else if (s.id === c.id && maxStack(s.id) > 1) { const n = Math.min(c.count, maxStack(s.id) - s.count); s.count += n; c.count -= n; if (!c.count) this.cursor = null; }
      else { arr[i] = c; this.cursor = s; }
    } else if (button === 2) {
      if (!c && s) { const n = Math.ceil(s.count / 2); this.cursor = { ...s, count: n }; s.count -= n; if (!s.count) arr[i] = null; }
      else if (c && (!s || (s.id === c.id && s.count < maxStack(s.id) && maxStack(s.id) > 1))) {
        if (s) s.count++; else arr[i] = { ...c, count: 1 };
        if (--c.count <= 0) this.cursor = null;
      }
    }
    this.refresh();
  }

  /** Returns everything parked in the crafting grid and on the cursor; leftovers are handed to `spill`. */
  close(inv: Inventory, spill: (s: Stack) => void) {
    const giveBack = (s: Stack | null) => { if (!s) return; const left = inv.add(s.id, s.count, s.dur); if (left) spill({ ...s, count: left }); };
    for (let i = 0; i < 9; i++) { giveBack(this.craft[i]); this.craft[i] = null; }
    giveBack(this.cursor); this.cursor = null;
    this.craftOut[0] = null;
  }
}

export const blockName = (id: number) => BLOCKS[id]?.name ?? '?';
