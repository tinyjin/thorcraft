// Block and item registry, plus the color palette the renderer batches by.

export const enum B {
  AIR = 0, STONE, GRASS, DIRT, COBBLE, PLANKS, SAND, GRAVEL, LOG, LEAVES, GLASS, WATER, BEDROCK,
  COAL_ORE, IRON_ORE, GOLD_ORE, DIAMOND_ORE, SNOWGRASS, SNOW, ICE, CACTUS, BIRCH_LOG, BIRCH_LEAVES,
  SPRUCE_LOG, SPRUCE_LEAVES, SANDSTONE, BRICK, CRAFTING_TABLE, FURNACE, FURNACE_LIT, TORCH, TNT,
  TALLGRASS, FLOWER_RED, FLOWER_YELLOW, GLOWSTONE, LAVA, OBSIDIAN,
  WOOL_WHITE, WOOL_RED, WOOL_BLUE, WOOL_GREEN, WOOL_YELLOW, WOOL_BLACK,
  BOOKSHELF, IRON_BLOCK, GOLD_BLOCK, DIAMOND_BLOCK, STONE_BRICKS, DEADBUSH, BIRCH_PLANKS, SPRUCE_PLANKS,
  // Villages
  PATH, HAY, LANTERN,
  // Ember Depths
  EMBER_ROCK, ASH, MAGMA, GLOW_CRYSTAL, EMBER_ORE, EMBER_BLOCK, EMBER_PORTAL,
  // Vector Void
  VOID_STONE, VOID_BRICKS, PORTAL_FRAME, PORTAL_FRAME_EYE, VOID_PORTAL, ANCHOR_CRYSTAL, TROPHY,
  COUNT,
}

/** Non-block items live above the block id range. */
export const ITEM_BASE = 256;
export const enum I {
  STICK = 256, COAL, IRON_INGOT, GOLD_INGOT, DIAMOND,
  // 16 tools follow: material (wood, stone, iron, diamond) x type (pickaxe, axe, shovel, sword)
  TOOL0 = 261,
  PORK_RAW = 277, PORK_COOKED, BEEF_RAW, BEEF_COOKED, APPLE, GUNPOWDER, ROTTEN_FLESH,
  /** An item whose artwork is a Lottie animation, in the world, in the hand and in the inventory. */
  LOTTIE_STAR,
  IGNITER, EMBER_INGOT, VECTOR_EYE, BREAD, WHEAT,
  // Ember tools: pickaxe, axe, shovel, sword
  EMBER_TOOL0 = 300,
}

export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'sword';
export type Render = 'none' | 'cube' | 'cross' | 'torch' | 'liquid';
export type SoundKind = 'stone' | 'wood' | 'dirt' | 'grass' | 'sand' | 'glass' | 'cloth';
type RGB = readonly [number, number, number];

export interface ToolDef { type: ToolType; tier: number; dur: number; damage: number; mat: string }

export interface ItemDef {
  id: number; name: string; isBlock: boolean; stack: number;
  tool?: ToolDef; food: number; fuel: number; hidden: boolean;
  /** Texture name used for the flat icon (items and cross shaped blocks). */
  icon: string;
  /** Name of a Lottie asset that replaces the pixel icon everywhere. */
  lottie?: string;
}

export interface BlockDef extends ItemDef {
  render: Render;
  /** Texture names per face direction (+X, -X, +Y, -Y, +Z, -Z). */
  faces: string[];
  solid: boolean; opaque: boolean; alpha: number; liquid: boolean;
  /** 0..3, how strongly the block lights its surroundings. */
  light: number;
  /** Seconds-ish to break by hand; negative means unbreakable. */
  hard: number;
  mine: ToolType | null; tier: number;
  /** Item id dropped when harvested, 0 for nothing. */
  drop: number;
  gravity: boolean; replaceable: boolean; sound: SoundKind;
}

export const BLOCKS: BlockDef[] = [];
export const ITEMS = new Map<number, ItemDef>();

interface BlockOpts {
  render?: Render; solid?: boolean; opaque?: boolean; alpha?: number; light?: number; hard?: number; tool?: ToolType; tier?: number;
  drop?: number; gravity?: boolean; replaceable?: boolean; sound?: SoundKind; fuel?: number; hidden?: boolean;
}

function block(id: number, name: string, tiles: string | [string, string, string, string?], o: BlockOpts = {}) {
  const t = typeof tiles === 'string' ? { top: tiles, bottom: tiles, side: tiles, front: tiles } : { top: tiles[0], bottom: tiles[1], side: tiles[2], front: tiles[3] ?? tiles[2] };
  const render = o.render ?? 'cube';
  const opaque = o.opaque ?? render === 'cube';
  const d: BlockDef = {
    id, name, isBlock: true, stack: 64, food: 0, fuel: o.fuel ?? 0, hidden: !!o.hidden, icon: t.side,
    render, faces: [t.side, t.side, t.top, t.bottom, t.side, t.front],
    solid: o.solid ?? render === 'cube', opaque, alpha: o.alpha ?? 255, liquid: render === 'liquid',
    light: o.light ?? 0, hard: o.hard ?? 1, mine: o.tool ?? null, tier: o.tier ?? 0,
    drop: o.drop === undefined ? id : o.drop, gravity: !!o.gravity, replaceable: !!o.replaceable, sound: o.sound ?? 'stone',
  };
  BLOCKS[id] = d;
  ITEMS.set(id, d);
}

const P: ToolType = 'pickaxe', A: ToolType = 'axe', S: ToolType = 'shovel';
block(B.AIR, 'Air', 'stone', { render: 'none', solid: false, opaque: false, hard: 0, replaceable: true, hidden: true, drop: 0 });
block(B.STONE, 'Stone', 'stone', { hard: 1.5, tool: P, tier: 1, drop: B.COBBLE });
block(B.GRASS, 'Grass Block', ['grass_top', 'dirt', 'grass_side'], { hard: 0.6, tool: S, drop: B.DIRT, sound: 'grass' });
block(B.DIRT, 'Dirt', 'dirt', { hard: 0.5, tool: S, sound: 'dirt' });
block(B.COBBLE, 'Cobblestone', 'cobble', { hard: 2, tool: P, tier: 1 });
block(B.PLANKS, 'Oak Planks', 'planks', { hard: 2, tool: A, sound: 'wood', fuel: 15 });
block(B.SAND, 'Sand', 'sand', { hard: 0.5, tool: S, sound: 'sand', gravity: true });
block(B.GRAVEL, 'Gravel', 'gravel', { hard: 0.6, tool: S, sound: 'dirt', gravity: true });
block(B.LOG, 'Oak Log', ['log_top', 'log_top', 'log_side'], { hard: 2, tool: A, sound: 'wood', fuel: 15 });
block(B.LEAVES, 'Oak Leaves', 'leaves', { hard: 0.2, drop: 0, sound: 'grass' });
block(B.GLASS, 'Glass', 'glass', { opaque: false, alpha: 80, hard: 0.3, drop: 0, sound: 'glass' });
block(B.WATER, 'Water', 'water', { render: 'liquid', alpha: 188, hard: -1, drop: 0, replaceable: true, hidden: true });
block(B.BEDROCK, 'Bedrock', 'bedrock', { hard: -1 });
block(B.COAL_ORE, 'Coal Ore', 'coal_ore', { hard: 3, tool: P, tier: 1, drop: I.COAL });
block(B.IRON_ORE, 'Iron Ore', 'iron_ore', { hard: 3, tool: P, tier: 2 });
block(B.GOLD_ORE, 'Gold Ore', 'gold_ore', { hard: 3, tool: P, tier: 3 });
block(B.DIAMOND_ORE, 'Diamond Ore', 'diamond_ore', { hard: 3, tool: P, tier: 3, drop: I.DIAMOND });
block(B.SNOWGRASS, 'Snowy Grass', ['snow', 'dirt', 'snow_side'], { hard: 0.6, tool: S, drop: B.DIRT, sound: 'grass' });
block(B.SNOW, 'Snow Block', 'snow', { hard: 0.3, tool: S, sound: 'sand' });
block(B.ICE, 'Ice', 'ice', { opaque: false, alpha: 200, hard: 0.5, tool: P, drop: 0, sound: 'glass' });
block(B.CACTUS, 'Cactus', ['cactus_top', 'cactus_top', 'cactus_side'], { hard: 0.4, sound: 'grass' });
block(B.BIRCH_LOG, 'Birch Log', ['birch_top', 'birch_top', 'birch_side'], { hard: 2, tool: A, sound: 'wood', fuel: 15 });
block(B.BIRCH_LEAVES, 'Birch Leaves', 'birch_leaves', { hard: 0.2, drop: 0, sound: 'grass' });
block(B.SPRUCE_LOG, 'Spruce Log', ['spruce_top', 'spruce_top', 'spruce_side'], { hard: 2, tool: A, sound: 'wood', fuel: 15 });
block(B.SPRUCE_LEAVES, 'Spruce Leaves', 'spruce_leaves', { hard: 0.2, drop: 0, sound: 'grass' });
block(B.SANDSTONE, 'Sandstone', ['sandstone_top', 'sandstone_top', 'sandstone_side'], { hard: 0.8, tool: P, tier: 1 });
block(B.BRICK, 'Bricks', 'brick', { hard: 2, tool: P, tier: 1 });
block(B.CRAFTING_TABLE, 'Crafting Table', ['table_top', 'planks', 'table_side', 'table_front'], { hard: 2.5, tool: A, sound: 'wood', fuel: 15 });
block(B.FURNACE, 'Furnace', ['furnace_top', 'furnace_top', 'furnace_side', 'furnace_front'], { hard: 3.5, tool: P, tier: 1 });
block(B.FURNACE_LIT, 'Furnace', ['furnace_top', 'furnace_top', 'furnace_side', 'furnace_lit'], { hard: 3.5, tool: P, tier: 1, light: 2, drop: B.FURNACE, hidden: true });
block(B.TORCH, 'Torch', 'torch', { render: 'torch', light: 3, hard: 0, sound: 'wood' });
block(B.TNT, 'TNT', ['tnt_top', 'tnt_bottom', 'tnt_side'], { hard: 0, sound: 'grass' });
block(B.TALLGRASS, 'Grass', 'tallgrass', { render: 'cross', hard: 0, drop: 0, sound: 'grass', replaceable: true });
block(B.FLOWER_RED, 'Poppy', 'flower_red', { render: 'cross', hard: 0, sound: 'grass' });
block(B.FLOWER_YELLOW, 'Dandelion', 'flower_yellow', { render: 'cross', hard: 0, sound: 'grass' });
block(B.GLOWSTONE, 'Glowstone', 'glowstone', { hard: 0.3, light: 3, sound: 'glass' });
block(B.LAVA, 'Lava', 'lava', { render: 'liquid', light: 3, hard: -1, drop: 0, replaceable: true, hidden: true });
block(B.OBSIDIAN, 'Obsidian', 'obsidian', { hard: 50, tool: P, tier: 4 });
block(B.WOOL_WHITE, 'White Wool', 'wool_white', { hard: 0.8, sound: 'cloth' });
block(B.WOOL_RED, 'Red Wool', 'wool_red', { hard: 0.8, sound: 'cloth' });
block(B.WOOL_BLUE, 'Blue Wool', 'wool_blue', { hard: 0.8, sound: 'cloth' });
block(B.WOOL_GREEN, 'Green Wool', 'wool_green', { hard: 0.8, sound: 'cloth' });
block(B.WOOL_YELLOW, 'Yellow Wool', 'wool_yellow', { hard: 0.8, sound: 'cloth' });
block(B.WOOL_BLACK, 'Black Wool', 'wool_black', { hard: 0.8, sound: 'cloth' });
block(B.BOOKSHELF, 'Bookshelf', ['planks', 'planks', 'bookshelf'], { hard: 1.5, tool: A, sound: 'wood', fuel: 15 });
block(B.IRON_BLOCK, 'Block of Iron', 'iron_block', { hard: 5, tool: P, tier: 2 });
block(B.GOLD_BLOCK, 'Block of Gold', 'gold_block', { hard: 3, tool: P, tier: 3 });
block(B.DIAMOND_BLOCK, 'Block of Diamond', 'diamond_block', { hard: 5, tool: P, tier: 3 });
block(B.STONE_BRICKS, 'Stone Bricks', 'stone_bricks', { hard: 1.5, tool: P, tier: 1 });
block(B.DEADBUSH, 'Dead Bush', 'deadbush', { render: 'cross', hard: 0, drop: I.STICK, sound: 'grass', replaceable: true });
block(B.BIRCH_PLANKS, 'Birch Planks', 'birch_planks', { hard: 2, tool: A, sound: 'wood', fuel: 15 });
block(B.SPRUCE_PLANKS, 'Spruce Planks', 'spruce_planks', { hard: 2, tool: A, sound: 'wood', fuel: 15 });
block(B.PATH, 'Path', ['path_top', 'dirt', 'path_side'], { hard: 0.6, tool: S, drop: B.DIRT, sound: 'dirt' });
block(B.HAY, 'Hay Bale', ['hay_top', 'hay_top', 'hay_side'], { hard: 0.5, sound: 'grass', fuel: 8 });
block(B.LANTERN, 'Lantern', 'lantern', { hard: 0.5, light: 3, sound: 'glass' });
block(B.EMBER_ROCK, 'Ember Rock', 'ember_rock', { hard: 0.9, tool: P, tier: 1 });
block(B.ASH, 'Ash', 'ash', { hard: 0.4, tool: S, sound: 'sand', gravity: true });
block(B.MAGMA, 'Magma', 'magma', { hard: 1, tool: P, tier: 1, light: 1 });
block(B.GLOW_CRYSTAL, 'Glow Crystal', 'glow_crystal', { hard: 0.4, light: 3, sound: 'glass' });
block(B.EMBER_ORE, 'Ember Ore', 'ember_ore', { hard: 4, tool: P, tier: 4 });
block(B.EMBER_BLOCK, 'Block of Ember', 'ember_block', { hard: 5, tool: P, tier: 4, light: 1 });
block(B.EMBER_PORTAL, 'Ember Portal', 'ember_portal', { solid: false, opaque: false, alpha: 170, light: 2, hard: -1, drop: 0, hidden: true, sound: 'glass' });
block(B.VOID_STONE, 'Void Stone', 'void_stone', { hard: 2.5, tool: P, tier: 2 });
block(B.VOID_BRICKS, 'Void Bricks', 'void_bricks', { hard: 2.5, tool: P, tier: 2 });
block(B.PORTAL_FRAME, 'Portal Frame', ['frame_top', 'void_stone', 'frame_side'], { hard: -1, hidden: true });
block(B.PORTAL_FRAME_EYE, 'Portal Frame', ['frame_eye', 'void_stone', 'frame_side'], { hard: -1, light: 1, hidden: true });
block(B.VOID_PORTAL, 'Void Portal', 'void_portal', { solid: false, opaque: false, alpha: 215, light: 2, hard: -1, drop: 0, hidden: true });
block(B.ANCHOR_CRYSTAL, 'Anchor Crystal', 'anchor_crystal', { hard: 1.2, light: 3, drop: 0, sound: 'glass', hidden: true });
block(B.TROPHY, 'Outline Trophy', ['trophy_top', 'void_bricks', 'trophy_side'], { hard: 1, light: 2 });

function item(id: number, name: string, icon: string, o: { stack?: number; tool?: ToolDef; food?: number; fuel?: number } = {}) {
  ITEMS.set(id, { id, name, isBlock: false, stack: o.stack ?? 64, tool: o.tool, food: o.food ?? 0, fuel: o.fuel ?? 0, hidden: false, icon });
}

item(I.STICK, 'Stick', 'stick', { fuel: 5 });
item(I.COAL, 'Coal', 'coal', { fuel: 80 });
item(I.IRON_INGOT, 'Iron Ingot', 'iron_ingot');
item(I.GOLD_INGOT, 'Gold Ingot', 'gold_ingot');
item(I.DIAMOND, 'Diamond', 'diamond');
export const TOOL_MATS: ReadonlyArray<readonly [string, string, number, number]> = [['wood', 'Wooden', 1, 60], ['stone', 'Stone', 2, 132], ['iron', 'Iron', 3, 251], ['diamond', 'Diamond', 4, 1562], ['ember', 'Ember', 5, 2600]];
export const TOOL_TYPES: ReadonlyArray<readonly [ToolType, string, number]> = [['pickaxe', 'Pickaxe', 1], ['axe', 'Axe', 2], ['shovel', 'Shovel', 0.5], ['sword', 'Sword', 3]];
export const toolId = (mat: number, type: number) => (mat === 4 ? I.EMBER_TOOL0 : I.TOOL0 + mat * 4) + type;
TOOL_MATS.forEach(([mk, mn, tier, dur], mi) => TOOL_TYPES.forEach(([tk, tn, dmg], ti) => {
  item(toolId(mi, ti), `${mn} ${tn}`, `${mk}_${tk}`, { stack: 1, tool: { type: tk, tier, dur, damage: 1 + dmg + tier, mat: mk }, fuel: mk === 'wood' ? 10 : 0 });
}));
item(I.PORK_RAW, 'Raw Porkchop', 'pork_raw', { food: 3 });
item(I.PORK_COOKED, 'Cooked Porkchop', 'pork_cooked', { food: 8 });
item(I.BEEF_RAW, 'Raw Beef', 'beef_raw', { food: 3 });
item(I.BEEF_COOKED, 'Steak', 'beef_cooked', { food: 8 });
item(I.APPLE, 'Apple', 'apple', { food: 4 });
item(I.GUNPOWDER, 'Gunpowder', 'gunpowder');
item(I.ROTTEN_FLESH, 'Rotten Flesh', 'rotten_flesh', { food: 2 });
item(I.LOTTIE_STAR, 'Lottie Star', 'gold_ingot', { food: 6 });
ITEMS.get(I.LOTTIE_STAR)!.lottie = 'star';
item(I.IGNITER, 'Igniter', 'igniter', { stack: 1 });
item(I.EMBER_INGOT, 'Ember Ingot', 'ember_ingot');
item(I.VECTOR_EYE, 'Vector Eye', 'vector_eye', { stack: 16 });
item(I.BREAD, 'Bread', 'bread', { food: 5 });
item(I.WHEAT, 'Wheat', 'wheat');

export const TOOL_SPEED = [1, 2, 4, 6, 8, 11];

export const SMELT = new Map<number, number>([
  [B.SAND, B.GLASS], [B.COBBLE, B.STONE], [B.IRON_ORE, I.IRON_INGOT], [B.GOLD_ORE, I.GOLD_INGOT],
  [I.PORK_RAW, I.PORK_COOKED], [I.BEEF_RAW, I.BEEF_COOKED], [B.LOG, I.COAL], [B.BIRCH_LOG, I.COAL],
  [B.SPRUCE_LOG, I.COAL], [B.COAL_ORE, I.COAL], [B.DIAMOND_ORE, I.DIAMOND], [B.STONE, B.STONE_BRICKS],
  [B.EMBER_ORE, I.EMBER_INGOT], [B.VOID_STONE, B.VOID_BRICKS],
]);

export const itemName = (id: number) => ITEMS.get(id)?.name ?? '?';
export const maxStack = (id: number) => ITEMS.get(id)?.stack ?? 64;
export const isBlockId = (id: number) => id < ITEM_BASE;

// Flat lookup tables for the hot loops.
export const OPAQUE = new Uint8Array(256), SOLID = new Uint8Array(256), LIQUID = new Uint8Array(256), LIGHT = new Uint8Array(256);
export const REPLACEABLE = new Uint8Array(256), CUBE = new Uint8Array(256);
for (let id = 0; id < B.COUNT; id++) {
  const d = BLOCKS[id];
  OPAQUE[id] = d.opaque ? 1 : 0; SOLID[id] = d.solid ? 1 : 0; LIQUID[id] = d.liquid ? 1 : 0; LIGHT[id] = d.light;
  REPLACEABLE[id] = d.replaceable ? 1 : 0; CUBE[id] = d.render === 'cube' ? 1 : 0;
}
export const isOpaque = (id: number) => OPAQUE[id] === 1;
export const isSolid = (id: number) => SOLID[id] === 1;

// Face directions: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
export const DIR_N: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** Per direction: origin corner, u axis, v axis (side faces have v pointing down). */
export const DIR_O: ReadonlyArray<readonly [number, number, number]> = [[1, 1, 0], [0, 1, 1], [0, 1, 0], [0, 0, 1], [1, 1, 1], [0, 1, 0]];
export const DIR_U: ReadonlyArray<readonly [number, number, number]> = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [1, 0, 0], [-1, 0, 0], [1, 0, 0]];
export const DIR_V: ReadonlyArray<readonly [number, number, number]> = [[0, -1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, -1, 0]];
export const DIR_SHADE = [0.74, 0.74, 1.0, 0.52, 0.87, 0.87];
/** Sky light multiplier per exposure level: open sky, shade, deep underground. */
export const SKY_MUL = [1.0, 0.66, 0.3];
/** Artificial light per lamp level. Final light = max(sky * daylight, lamp). */
export const LAMP_MUL = [0, 0.5, 0.75, 1.0];

/**
 * Palette of base colors plus their light levels. Geometry refers to colors by id so faces can
 * be batched into one ThorVG shape per (depth bucket, color, fog level). Ids below DYNAMIC are
 * permanent (block textures); the rest are recycled every frame (entities, particles).
 */
const DYNAMIC = 52000, PAL_MAX = 65535;
export class Palette {
  r = new Uint8Array(PAL_MAX + 1); g = new Uint8Array(PAL_MAX + 1); b = new Uint8Array(PAL_MAX + 1); a = new Uint8Array(PAL_MAX + 1);
  sky = new Uint8Array(PAL_MAX + 1); lamp = new Uint8Array(PAL_MAX + 1);
  private fixed = new Map<number, number>();
  private dynamic = new Map<number, number>();
  private nFixed = 1; private nDyn = DYNAMIC;

  private static key(r: number, g: number, b: number, a: number, sky: number, lamp: number) { return ((((r * 256 + g) * 256 + b) * 256 + a) * 4 + sky) * 4 + lamp; }

  private put(id: number, r: number, g: number, b: number, a: number, sky: number, lamp: number) {
    this.r[id] = r; this.g[id] = g; this.b[id] = b; this.a[id] = a; this.sky[id] = sky; this.lamp[id] = lamp;
  }

  /** Permanent color. */
  fixedId(r: number, g: number, b: number, a = 255, sky = 0, lamp = 0): number {
    r = r > 255 ? 255 : r < 0 ? 0 : Math.round(r); g = g > 255 ? 255 : g < 0 ? 0 : Math.round(g); b = b > 255 ? 255 : b < 0 ? 0 : Math.round(b);
    const key = Palette.key(r, g, b, a, sky, lamp);
    let id = this.fixed.get(key);
    if (id !== undefined) return id;
    if (this.nFixed >= DYNAMIC) return 0;
    id = this.nFixed++;
    this.put(id, r, g, b, a, sky, lamp);
    this.fixed.set(key, id);
    return id;
  }

  /** Per-frame color. */
  id(r: number, g: number, b: number, a = 255, sky = 0, lamp = 0): number {
    r = r > 255 ? 255 : r < 0 ? 0 : Math.round(r); g = g > 255 ? 255 : g < 0 ? 0 : Math.round(g); b = b > 255 ? 255 : b < 0 ? 0 : Math.round(b);
    const key = Palette.key(r, g, b, a, sky, lamp);
    let id = this.fixed.get(key);
    if (id !== undefined) return id;
    id = this.dynamic.get(key);
    if (id !== undefined) return id;
    if (this.nDyn > PAL_MAX) return 0;
    id = this.nDyn++;
    this.put(id, r, g, b, a, sky, lamp);
    this.dynamic.set(key, id);
    return id;
  }

  resetDynamic() {
    if (this.nDyn === DYNAMIC) return;
    this.nDyn = DYNAMIC;
    this.dynamic.clear();
  }

  get size() { return this.nFixed; }
}

export const palette = new Palette();
