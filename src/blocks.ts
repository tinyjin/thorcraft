// Block registry, baked color palette and vector "textures" (decals).

export const enum B {
  AIR = 0, GRASS, DIRT, STONE, SAND, WATER, LOG, LEAVES, PLANKS, COBBLE, BRICK, GLASS, SNOW,
  COAL_ORE, GOLD_ORE, DIAMOND_ORE, BEDROCK, TNT, LAMP, CACTUS, SANDSTONE, BIRCH_LOG, BIRCH_LEAVES,
  WOOL_RED, WOOL_BLUE, WOOL_YELLOW, WOOL_WHITE, ICE,
  COUNT,
}

/** Non-block inventory items live above the block id range. */
export const enum Item {
  PORK = 100, GEM = 101,
}

type RGB = readonly [number, number, number];

/** A decal is a rectangle in face UV space (v = 0 is the top edge on side faces). */
interface DecalDef { rect: readonly [number, number, number, number]; color: RGB }

interface BlockDef {
  name: string;
  top: RGB; side: RGB; bottom: RGB;
  alpha?: number;
  /** Opaque blocks hide the faces of their neighbors. */
  opaque?: boolean;
  solid?: boolean;
  liquid?: boolean;
  emissive?: boolean;
  /** Seconds to break by hand in survival. */
  hardness: number;
  /** What the block drops (defaults to itself). 0 drops nothing. */
  drop?: number;
  decalsTop?: DecalDef[]; decalsSide?: DecalDef[];
}

const d = (u0: number, v0: number, u1: number, v1: number, color: RGB): DecalDef => ({ rect: [u0, v0, u1, v1], color });

const oreSpecks = (c: RGB): DecalDef[] => [
  d(0.12, 0.15, 0.34, 0.3, c), d(0.58, 0.1, 0.8, 0.26, c), d(0.3, 0.5, 0.52, 0.66, c), d(0.68, 0.62, 0.88, 0.8, c), d(0.1, 0.74, 0.28, 0.88, c),
];
const stoneCracks: DecalDef[] = [d(0.1, 0.3, 0.5, 0.36, [108, 108, 112]), d(0.55, 0.62, 0.92, 0.68, [108, 108, 112]), d(0.2, 0.8, 0.45, 0.85, [140, 140, 146])];
const plankLines: DecalDef[] = [d(0, 0.23, 1, 0.27, [120, 88, 48]), d(0, 0.48, 1, 0.52, [120, 88, 48]), d(0, 0.73, 1, 0.77, [120, 88, 48]), d(0.3, 0, 0.34, 0.25, [120, 88, 48]), d(0.7, 0.5, 0.74, 0.75, [120, 88, 48])];
const brickLines: DecalDef[] = [
  d(0, 0.22, 1, 0.28, [196, 186, 172]), d(0, 0.47, 1, 0.53, [196, 186, 172]), d(0, 0.72, 1, 0.78, [196, 186, 172]),
  d(0.47, 0, 0.53, 0.25, [196, 186, 172]), d(0.22, 0.25, 0.28, 0.5, [196, 186, 172]), d(0.72, 0.25, 0.78, 0.5, [196, 186, 172]),
  d(0.47, 0.5, 0.53, 0.75, [196, 186, 172]), d(0.22, 0.75, 0.28, 1, [196, 186, 172]), d(0.72, 0.75, 0.78, 1, [196, 186, 172]),
];
const barkLines = (c: RGB): DecalDef[] => [d(0.18, 0, 0.26, 1, c), d(0.48, 0, 0.54, 1, c), d(0.76, 0, 0.84, 1, c)];
const rings = (a: RGB, b: RGB): DecalDef[] => [d(0.15, 0.15, 0.85, 0.85, a), d(0.3, 0.3, 0.7, 0.7, b), d(0.42, 0.42, 0.58, 0.58, a)];
const leafDots = (c: RGB, c2: RGB): DecalDef[] => [d(0.1, 0.1, 0.35, 0.35, c), d(0.55, 0.2, 0.85, 0.45, c2), d(0.25, 0.55, 0.5, 0.85, c2), d(0.65, 0.65, 0.9, 0.9, c)];

export const BLOCKS: BlockDef[] = [];
const def = (id: number, b: BlockDef) => { BLOCKS[id] = { opaque: true, solid: true, ...b }; };

def(B.AIR, { name: 'Air', top: [0, 0, 0], side: [0, 0, 0], bottom: [0, 0, 0], opaque: false, solid: false, hardness: 0 });
def(B.GRASS, { name: 'Grass', top: [106, 170, 64], side: [134, 96, 67], bottom: [134, 96, 67], hardness: 0.6, drop: B.DIRT,
  decalsSide: [d(0, 0, 1, 0.22, [106, 170, 64]), d(0.1, 0.22, 0.25, 0.34, [106, 170, 64]), d(0.5, 0.22, 0.7, 0.3, [106, 170, 64]), d(0.82, 0.22, 0.95, 0.38, [106, 170, 64])],
  decalsTop: [d(0.15, 0.2, 0.3, 0.35, [122, 186, 76]), d(0.6, 0.55, 0.78, 0.72, [92, 154, 54]), d(0.7, 0.12, 0.82, 0.24, [122, 186, 76])] });
def(B.DIRT, { name: 'Dirt', top: [134, 96, 67], side: [134, 96, 67], bottom: [134, 96, 67], hardness: 0.5,
  decalsSide: [d(0.2, 0.3, 0.36, 0.42, [112, 78, 52]), d(0.62, 0.64, 0.8, 0.76, [150, 110, 78])] });
def(B.STONE, { name: 'Stone', top: [128, 128, 132], side: [128, 128, 132], bottom: [128, 128, 132], hardness: 1.5, drop: B.COBBLE, decalsSide: stoneCracks, decalsTop: stoneCracks });
def(B.SAND, { name: 'Sand', top: [222, 208, 156], side: [222, 208, 156], bottom: [222, 208, 156], hardness: 0.5,
  decalsTop: [d(0.2, 0.25, 0.3, 0.33, [200, 186, 134]), d(0.66, 0.6, 0.78, 0.7, [236, 224, 176])] });
def(B.WATER, { name: 'Water', top: [52, 110, 220], side: [44, 96, 200], bottom: [44, 96, 200], alpha: 150, opaque: false, solid: false, liquid: true, hardness: 0 });
def(B.LOG, { name: 'Oak Log', top: [176, 142, 88], side: [104, 80, 48], bottom: [176, 142, 88], hardness: 1.2, decalsSide: barkLines([84, 62, 36]), decalsTop: rings([148, 116, 68], [176, 142, 88]) });
def(B.LEAVES, { name: 'Leaves', top: [60, 134, 48], side: [54, 124, 44], bottom: [46, 108, 38], hardness: 0.2, decalsSide: leafDots([76, 156, 60], [42, 104, 36]), decalsTop: leafDots([76, 156, 60], [42, 104, 36]) });
def(B.PLANKS, { name: 'Planks', top: [170, 132, 78], side: [170, 132, 78], bottom: [170, 132, 78], hardness: 1.0, decalsSide: plankLines, decalsTop: plankLines });
def(B.COBBLE, { name: 'Cobblestone', top: [112, 112, 116], side: [112, 112, 116], bottom: [112, 112, 116], hardness: 1.8,
  decalsSide: [d(0.06, 0.08, 0.42, 0.4, [136, 136, 140]), d(0.54, 0.12, 0.92, 0.46, [96, 96, 100]), d(0.14, 0.54, 0.5, 0.9, [96, 96, 100]), d(0.6, 0.58, 0.9, 0.88, [136, 136, 140])],
  decalsTop: [d(0.06, 0.08, 0.42, 0.4, [136, 136, 140]), d(0.54, 0.12, 0.92, 0.46, [96, 96, 100]), d(0.14, 0.54, 0.5, 0.9, [96, 96, 100]), d(0.6, 0.58, 0.9, 0.88, [136, 136, 140])] });
def(B.BRICK, { name: 'Bricks', top: [160, 78, 62], side: [160, 78, 62], bottom: [160, 78, 62], hardness: 2.0, decalsSide: brickLines, decalsTop: brickLines });
def(B.GLASS, { name: 'Glass', top: [200, 232, 244], side: [200, 232, 244], bottom: [200, 232, 244], alpha: 70, opaque: false, hardness: 0.3, drop: 0,
  decalsSide: [d(0, 0, 1, 0.06, [235, 248, 252]), d(0, 0.94, 1, 1, [235, 248, 252]), d(0, 0, 0.06, 1, [235, 248, 252]), d(0.94, 0, 1, 1, [235, 248, 252])],
  decalsTop: [d(0, 0, 1, 0.06, [235, 248, 252]), d(0, 0.94, 1, 1, [235, 248, 252]), d(0, 0, 0.06, 1, [235, 248, 252]), d(0.94, 0, 1, 1, [235, 248, 252])] });
def(B.SNOW, { name: 'Snow', top: [242, 246, 250], side: [226, 232, 240], bottom: [226, 232, 240], hardness: 0.3 });
def(B.COAL_ORE, { name: 'Coal Ore', top: [128, 128, 132], side: [128, 128, 132], bottom: [128, 128, 132], hardness: 2.2, decalsSide: oreSpecks([40, 40, 44]), decalsTop: oreSpecks([40, 40, 44]) });
def(B.GOLD_ORE, { name: 'Gold Ore', top: [128, 128, 132], side: [128, 128, 132], bottom: [128, 128, 132], hardness: 2.6, decalsSide: oreSpecks([246, 208, 62]), decalsTop: oreSpecks([246, 208, 62]) });
def(B.DIAMOND_ORE, { name: 'Diamond Ore', top: [128, 128, 132], side: [128, 128, 132], bottom: [128, 128, 132], hardness: 3.2, decalsSide: oreSpecks([92, 226, 232]), decalsTop: oreSpecks([92, 226, 232]) });
def(B.BEDROCK, { name: 'Bedrock', top: [52, 52, 56], side: [52, 52, 56], bottom: [52, 52, 56], hardness: Infinity,
  decalsSide: [d(0.1, 0.1, 0.4, 0.35, [30, 30, 34]), d(0.5, 0.5, 0.9, 0.85, [72, 72, 78])] });
def(B.TNT, { name: 'TNT', top: [200, 60, 48], side: [200, 60, 48], bottom: [200, 60, 48], hardness: 0.1,
  decalsSide: [d(0, 0.34, 1, 0.66, [240, 240, 236]), d(0.12, 0.42, 0.18, 0.58, [30, 30, 30]), d(0.18, 0.42, 0.3, 0.47, [30, 30, 30]), d(0.4, 0.42, 0.46, 0.58, [30, 30, 30]), d(0.54, 0.42, 0.6, 0.58, [30, 30, 30]), d(0.46, 0.42, 0.54, 0.47, [30, 30, 30]), d(0.7, 0.42, 0.88, 0.47, [30, 30, 30]), d(0.76, 0.42, 0.82, 0.58, [30, 30, 30])],
  decalsTop: [d(0.38, 0.38, 0.62, 0.62, [60, 60, 60])] });
def(B.LAMP, { name: 'Lamp', top: [255, 232, 150], side: [255, 222, 128], bottom: [255, 222, 128], emissive: true, hardness: 0.4,
  decalsSide: [d(0.2, 0.2, 0.8, 0.8, [255, 250, 214])], decalsTop: [d(0.2, 0.2, 0.8, 0.8, [255, 250, 214])] });
def(B.CACTUS, { name: 'Cactus', top: [64, 140, 58], side: [56, 126, 50], bottom: [56, 126, 50], hardness: 0.4, decalsSide: barkLines([40, 98, 38]) });
def(B.SANDSTONE, { name: 'Sandstone', top: [214, 198, 146], side: [206, 190, 138], bottom: [206, 190, 138], hardness: 1.2,
  decalsSide: [d(0, 0.16, 1, 0.22, [184, 168, 118]), d(0, 0.62, 1, 0.68, [184, 168, 118])] });
def(B.BIRCH_LOG, { name: 'Birch Log', top: [200, 184, 134], side: [222, 222, 214], bottom: [200, 184, 134], hardness: 1.2,
  decalsSide: [d(0.1, 0.12, 0.4, 0.18, [50, 50, 46]), d(0.6, 0.4, 0.95, 0.46, [50, 50, 46]), d(0.2, 0.7, 0.55, 0.76, [50, 50, 46])], decalsTop: rings([176, 160, 110], [200, 184, 134]) });
def(B.BIRCH_LEAVES, { name: 'Birch Leaves', top: [128, 170, 72], side: [118, 160, 66], bottom: [104, 144, 58], hardness: 0.2, decalsSide: leafDots([150, 190, 90], [98, 138, 54]), decalsTop: leafDots([150, 190, 90], [98, 138, 54]) });
def(B.WOOL_RED, { name: 'Red Wool', top: [200, 56, 56], side: [200, 56, 56], bottom: [200, 56, 56], hardness: 0.4 });
def(B.WOOL_BLUE, { name: 'Blue Wool', top: [56, 96, 204], side: [56, 96, 204], bottom: [56, 96, 204], hardness: 0.4 });
def(B.WOOL_YELLOW, { name: 'Yellow Wool', top: [240, 200, 56], side: [240, 200, 56], bottom: [240, 200, 56], hardness: 0.4 });
def(B.WOOL_WHITE, { name: 'White Wool', top: [236, 236, 236], side: [236, 236, 236], bottom: [236, 236, 236], hardness: 0.4 });
def(B.ICE, { name: 'Ice', top: [160, 200, 250], side: [150, 190, 244], bottom: [150, 190, 244], alpha: 190, opaque: false, hardness: 0.4, drop: 0 });

export const ITEM_NAMES: Record<number, string> = { [Item.PORK]: 'Pork Chop', [Item.GEM]: 'Gem' };
export const itemName = (id: number) => (id < 100 ? BLOCKS[id]?.name ?? '?' : ITEM_NAMES[id] ?? '?');

export const isOpaque = (id: number) => BLOCKS[id].opaque === true;
export const isSolid = (id: number) => BLOCKS[id].solid === true;

// Face directions: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
export const DIR_N: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** Per direction: origin corner, u axis, v axis (side faces have v pointing down). */
export const DIR_O: ReadonlyArray<readonly [number, number, number]> = [[1, 1, 0], [0, 1, 1], [0, 1, 0], [0, 0, 1], [1, 1, 1], [0, 1, 0]];
export const DIR_U: ReadonlyArray<readonly [number, number, number]> = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [1, 0, 0], [-1, 0, 0], [1, 0, 0]];
export const DIR_V: ReadonlyArray<readonly [number, number, number]> = [[0, -1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, -1, 0]];
export const DIR_SHADE = [0.72, 0.72, 1.0, 0.5, 0.86, 0.86];
/** Sky light multiplier per exposure level: open sky, shade, deep underground. */
export const SKY_MUL = [1.0, 0.68, 0.34];
/** Artificial light per lamp level. Final light = max(sky * daylight, lamp). */
export const LAMP_MUL = [0, 0.5, 0.75, 1.0];

/**
 * Palette of base colors plus their light levels. Geometry refers to colors by id so faces can
 * be batched into one ThorVG shape per (depth bucket, color, fog level).
 */
export class Palette {
  r: number[] = []; g: number[] = []; b: number[] = []; a: number[] = []; sky: number[] = []; lamp: number[] = [];
  private lookup = new Map<number, number>();
  private dynamic = new Map<number, number>();
  private staticCount = -1;

  id(r: number, g: number, b: number, a = 255, sky = 0, lamp = 0): number {
    r = r > 255 ? 255 : r < 0 ? 0 : Math.round(r); g = g > 255 ? 255 : g < 0 ? 0 : Math.round(g); b = b > 255 ? 255 : b < 0 ? 0 : Math.round(b);
    const key = ((((r * 256 + g) * 256 + b) * 256 + a) * 4 + sky) * 4 + lamp;
    let id = this.lookup.get(key);
    if (id !== undefined) return id;
    const frozen = this.staticCount >= 0;
    if (frozen) {
      id = this.dynamic.get(key);
      if (id !== undefined) return id;
    }
    id = this.r.length;
    if (id >= 65000) return 0;
    this.r.push(r); this.g.push(g); this.b.push(b); this.a.push(a); this.sky.push(sky); this.lamp.push(lamp);
    (frozen ? this.dynamic : this.lookup).set(key, id);
    return id;
  }

  /** Everything registered so far (block faces, decals) becomes permanent. */
  freeze() { this.staticCount = this.r.length; }

  /** Drops the per-frame colors registered by entities and particles. */
  resetDynamic() {
    if (this.staticCount < 0 || this.r.length === this.staticCount) return;
    const n = this.staticCount;
    this.r.length = n; this.g.length = n; this.b.length = n; this.a.length = n; this.sky.length = n; this.lamp.length = n;
    this.dynamic.clear();
  }

  get size() { return this.r.length; }
}

export const palette = new Palette();

export interface BakedDecal { u0: number; v0: number; u1: number; v1: number; ids: number[] /* [sky * 4 + lamp] */ }

/** decals[block][dir] */
export const decals: BakedDecal[][][] = [];
const VARIANT = [1.0, 0.955];
// faceColor[(((block * 6 + dir) * 3 + sky) * 4 + lamp) * 2 + variant]
const faceColor: number[] = [];

export const faceColorId = (block: number, dir: number, sky: number, lamp: number, variant: number) =>
  faceColor[(((block * 6 + dir) * 3 + sky) * 4 + lamp) * 2 + variant];

for (let id = 0; id < B.COUNT; id++) {
  const bd = BLOCKS[id];
  decals[id] = [];
  for (let dir = 0; dir < 6; dir++) {
    const base = dir === 2 ? bd.top : dir === 3 ? bd.bottom : bd.side;
    const alpha = bd.alpha ?? 255;
    const m = bd.emissive ? 1 : DIR_SHADE[dir];
    for (let s = 0; s < 3; s++) for (let l = 0; l < 4; l++) for (let v = 0; v < 2; v++) {
      const k = VARIANT[v] * m;
      faceColor[(((id * 6 + dir) * 3 + s) * 4 + l) * 2 + v] = palette.id(base[0] * k, base[1] * k, base[2] * k, alpha, s, bd.emissive ? 3 : l);
    }
    const defs = dir === 2 || dir === 3 ? bd.decalsTop : bd.decalsSide;
    decals[id][dir] = (defs ?? []).map((dd) => {
      const ids: number[] = [];
      for (let s = 0; s < 3; s++) for (let l = 0; l < 4; l++) ids[s * 4 + l] = palette.id(dd.color[0] * m, dd.color[1] * m, dd.color[2] * m, 255, s, bd.emissive ? 3 : l);
      return { u0: dd.rect[0], v0: dd.rect[1], u1: dd.rect[2], v1: dd.rect[3], ids };
    });
  }
}

palette.freeze();

/** Flat icon color for HUD and the minimap. */
export const iconColor = (id: number): RGB => {
  if (id === Item.PORK) return [236, 132, 140];
  if (id === Item.GEM) return [92, 226, 232];
  return BLOCKS[id]?.top ?? [255, 0, 255];
};
