import { B, Item } from './blocks';

export interface Stack { id: number; count: number }
export const HOTBAR = 9;
export const SLOTS = 36;
const MAX_STACK = 64;

export interface Recipe { out: Stack; in: Stack[] }

export const RECIPES: Recipe[] = [
  { out: { id: B.PLANKS, count: 4 }, in: [{ id: B.LOG, count: 1 }] },
  { out: { id: B.PLANKS, count: 4 }, in: [{ id: B.BIRCH_LOG, count: 1 }] },
  { out: { id: B.SANDSTONE, count: 4 }, in: [{ id: B.SAND, count: 4 }] },
  { out: { id: B.GLASS, count: 4 }, in: [{ id: B.SAND, count: 4 }, { id: B.COAL_ORE, count: 1 }] },
  { out: { id: B.BRICK, count: 4 }, in: [{ id: B.COBBLE, count: 4 }, { id: B.DIRT, count: 1 }] },
  { out: { id: B.LAMP, count: 2 }, in: [{ id: B.GOLD_ORE, count: 1 }, { id: B.GLASS, count: 1 }] },
  { out: { id: B.TNT, count: 2 }, in: [{ id: B.SAND, count: 3 }, { id: B.COAL_ORE, count: 2 }] },
  { out: { id: B.WOOL_RED, count: 1 }, in: [{ id: B.WOOL_WHITE, count: 1 }, { id: B.BRICK, count: 1 }] },
  { out: { id: B.WOOL_YELLOW, count: 1 }, in: [{ id: B.WOOL_WHITE, count: 1 }, { id: B.SAND, count: 1 }] },
  { out: { id: B.WOOL_BLUE, count: 1 }, in: [{ id: B.WOOL_WHITE, count: 1 }, { id: B.ICE, count: 1 }] },
  { out: { id: Item.GEM, count: 3 }, in: [{ id: B.DIAMOND_ORE, count: 1 }] },
];

/** Everything offered on the creative palette. */
export const CREATIVE_ITEMS: number[] = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.SANDSTONE, B.SNOW, B.ICE, B.LOG, B.BIRCH_LOG, B.LEAVES, B.BIRCH_LEAVES,
  B.PLANKS, B.BRICK, B.GLASS, B.LAMP, B.TNT, B.CACTUS, B.WOOL_WHITE, B.WOOL_RED, B.WOOL_BLUE, B.WOOL_YELLOW,
  B.COAL_ORE, B.GOLD_ORE, B.DIAMOND_ORE, B.WATER, B.BEDROCK,
];

export class Inventory {
  slots: (Stack | null)[] = new Array(SLOTS).fill(null);
  selected = 0;
  /** Stack held by the cursor on the inventory screen. */
  cursor: Stack | null = null;

  get held(): Stack | null { return this.slots[this.selected]; }

  count(id: number): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Adds items, returns the amount that did not fit. */
  add(id: number, count: number): number {
    for (const s of this.slots) {
      if (count <= 0) break;
      if (s && s.id === id && s.count < MAX_STACK) { const n = Math.min(count, MAX_STACK - s.count); s.count += n; count -= n; }
    }
    for (let i = 0; i < SLOTS && count > 0; i++) {
      if (!this.slots[i]) { const n = Math.min(count, MAX_STACK); this.slots[i] = { id, count: n }; count -= n; }
    }
    return count;
  }

  remove(id: number, count: number): boolean {
    if (this.count(id) < count) return false;
    for (let i = SLOTS - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const n = Math.min(count, s.count);
      s.count -= n; count -= n;
      if (s.count === 0) this.slots[i] = null;
    }
    return true;
  }

  consumeSelected() {
    const s = this.slots[this.selected];
    if (s && --s.count <= 0) this.slots[this.selected] = null;
  }

  canCraft(r: Recipe) { return r.in.every((i) => this.count(i.id) >= i.count); }

  craft(r: Recipe): boolean {
    if (!this.canCraft(r)) return false;
    for (const i of r.in) this.remove(i.id, i.count);
    this.add(r.out.id, r.out.count);
    return true;
  }

  /** Click behavior on the inventory screen: pick up, put down, merge or swap. */
  clickSlot(i: number) {
    const s = this.slots[i], c = this.cursor;
    if (c && s && s.id === c.id) {
      const n = Math.min(c.count, MAX_STACK - s.count);
      s.count += n; c.count -= n;
      if (c.count === 0) this.cursor = null;
    } else { this.slots[i] = c; this.cursor = s; }
  }

  stashCursor() { if (this.cursor) { this.add(this.cursor.id, this.cursor.count); this.cursor = null; } }
}
