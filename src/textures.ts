// Procedural 16x16 pixel art, converted to vector form. ThorVG draws flat polygons, so every
// texture is quantized to a handful of tones and its texels are merged into rectangles. Each
// texture carries a chain of levels of detail (16, 8, 4, 2 texels across, then a flat average)
// which the renderer picks by distance, a vector take on mip mapping.

import { TOOL_MATS } from './blocks';
import { mulberry32 } from './math';

type RGB = readonly [number, number, number];
const S = 16;

export interface TexLod {
  n: number;
  tones: RGB[];
  /** Tone that fills the whole face, -1 for sprites (nothing behind the texels). */
  base: number;
  /** Packed rectangles in texel units of this level: x0, y0, x1, y1, tone. */
  rects: number[];
  /** Lazily filled palette ids per tone, see Renderer3D. */
  ids: Uint16Array[];
}

export interface Tex {
  name: string; sprite: boolean; avg: RGB;
  /** Finest first. */
  lods: TexLod[];
  avgIds: Uint16Array;
}

const shade = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];

/** Tiny pixel canvas the painters draw on. */
class T {
  px_ = new Float32Array(S * S * 4);
  constructor(public rng: () => number) {}
  px(x: number, y: number, c: RGB) {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const o = (Math.floor(y) * S + Math.floor(x)) * 4;
    this.px_[o] = c[0]; this.px_[o + 1] = c[1]; this.px_[o + 2] = c[2]; this.px_[o + 3] = 1;
  }
  v(c: RGB, amt: number): RGB { return shade(c, 1 + (this.rng() - 0.5) * amt); }
  rect(x: number, y: number, w: number, h: number, c: RGB, amt = 0) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, amt ? this.v(c, amt) : c); }
  noise(c: RGB, amt = 0.15) { this.rect(0, 0, S, S, c, amt); }
  clear() { this.px_.fill(0); }
  specks(c: RGB, n: number, amt = 0.2) { for (let i = 0; i < n; i++) this.px(Math.floor(this.rng() * S), Math.floor(this.rng() * S), this.v(c, amt)); }
  blob(cx: number, cy: number, r: number, c: RGB, amt = 0.15) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.px(x, y, this.v(c, amt));
    }
  }
  frame(c1: RGB, c2: RGB) { for (let i = 0; i < S; i++) { this.px(i, 0, c1); this.px(0, i, c1); this.px(i, 15, c2); this.px(15, i, c2); } }
}

type Painter = (t: T) => void;

const C = {
  stone: [126, 126, 126] as RGB, dirt: [134, 96, 67] as RGB, grass: [96, 160, 56] as RGB, sand: [220, 208, 164] as RGB, wood: [110, 85, 50] as RGB,
  planks: [170, 136, 82] as RGB, birchPlanks: [208, 194, 140] as RGB, sprucePlanks: [112, 82, 48] as RGB, snow: [242, 247, 252] as RGB,
};

const stone: Painter = (t) => { t.noise(C.stone, 0.12); for (let i = 0; i < 7; i++) t.rect(Math.floor(t.rng() * 13), Math.floor(t.rng() * 16), 2 + Math.floor(t.rng() * 3), 1, shade(C.stone, 0.84), 0.06); };
const dirt: Painter = (t) => { t.noise(C.dirt, 0.22); t.specks(shade(C.dirt, 0.7), 14); t.specks(shade(C.dirt, 1.2), 6); };
const cobble: Painter = (t) => {
  const base: RGB = [118, 118, 118];
  t.noise(shade(base, 0.6), 0.1);
  for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
    const x = gx * 4 + (t.rng() < 0.5 ? 0 : 1), y = gy * 4 + (t.rng() < 0.5 ? 0 : 1);
    t.rect(x, y, 3, 3, shade(base, 0.9 + t.rng() * 0.35), 0.08);
  }
};
const planks = (c: RGB): Painter => (t) => {
  t.noise(c, 0.08);
  for (let r = 0; r < 4; r++) {
    t.rect(0, r * 4 + 3, 16, 1, shade(c, 0.68), 0.05);
    const seam = Math.floor(t.rng() * 14) + 1;
    t.rect(seam, r * 4, 1, 3, shade(c, 0.75));
  }
};
const logSide = (c: RGB, birch = false): Painter => (t) => {
  for (let x = 0; x < 16; x++) { const f = 0.82 + t.rng() * 0.32; for (let y = 0; y < 16; y++) t.px(x, y, t.v(shade(c, f), 0.1)); }
  if (birch) for (let i = 0; i < 9; i++) t.rect(Math.floor(t.rng() * 13), Math.floor(t.rng() * 16), 2 + Math.floor(t.rng() * 3), 1, [40, 40, 40], 0.3);
};
const logTop = (bark: RGB, wood: RGB): Painter => (t) => {
  t.noise(bark, 0.15); t.rect(1, 1, 14, 14, wood, 0.08);
  for (const r of [3, 5]) for (let i = r; i < 16 - r; i++) { t.px(i, r, shade(wood, 0.78)); t.px(i, 15 - r, shade(wood, 0.78)); t.px(r, i, shade(wood, 0.78)); t.px(15 - r, i, shade(wood, 0.78)); }
  t.rect(7, 7, 2, 2, shade(wood, 0.7));
};
const leaves = (c: RGB): Painter => (t) => { t.noise(shade(c, 0.5), 0.2); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (t.rng() < 0.78) t.px(x, y, t.v(c, 0.5)); };
const ore = (c: RGB): Painter => (t) => {
  stone(t);
  for (let i = 0; i < 6; i++) {
    const x = 1 + Math.floor(t.rng() * 13), y = 1 + Math.floor(t.rng() * 13);
    t.px(x, y, c); t.px(x + 1, y, shade(c, 0.8)); if (t.rng() < 0.6) t.px(x, y + 1, shade(c, 1.15)); if (t.rng() < 0.4) t.px(x + 1, y + 1, c);
  }
};
const wool = (c: RGB): Painter => (t) => { t.noise(c, 0.1); for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x++) if (t.rng() < 0.6) t.px(x, y + (x % 4 < 2 ? 0 : 1), shade(c, 0.86)); };
const metal = (c: RGB): Painter => (t) => { t.noise(c, 0.05); t.frame(shade(c, 1.2), shade(c, 0.7)); for (let y = 4; y < 12; y += 3) t.rect(3, y, 10, 1, shade(c, 0.88)); };
const sideOverlay = (base: Painter, top: RGB): Painter => (t) => { base(t); for (let x = 0; x < 16; x++) t.rect(x, 0, 1, 2 + Math.floor(t.rng() * 3), top, 0.18); };
const furnaceSide: Painter = (t) => { t.noise([112, 112, 112], 0.1); t.frame([140, 140, 140], [70, 70, 70]); };
const furnaceFront = (lit: boolean): Painter => (t) => {
  furnaceSide(t);
  t.rect(4, 3, 8, 3, [45, 45, 45], 0.1);
  t.rect(3, 8, 10, 6, [30, 30, 30], 0.1);
  if (lit) { t.rect(4, 10, 8, 4, [235, 120, 25], 0.3); t.rect(5, 12, 6, 2, [255, 215, 70], 0.2); }
};
const table = (mode: 'top' | 'side' | 'front'): Painter => (t) => {
  planks(C.planks)(t);
  const dk = shade(C.planks, 0.6);
  if (mode === 'top') { t.frame(dk, shade(C.planks, 0.5)); for (let i = 2; i < 14; i++) { t.px(i, 5, dk); t.px(i, 10, dk); t.px(5, i, dk); t.px(10, i, dk); } }
  else {
    t.rect(0, 0, 16, 2, dk, 0.1); t.rect(0, 2, 2, 14, shade(C.wood, 0.9), 0.1); t.rect(14, 2, 2, 14, shade(C.wood, 0.9), 0.1);
    if (mode === 'front') { t.rect(4, 5, 1, 7, [90, 90, 95]); t.rect(3, 4, 3, 2, [150, 150, 155]); t.rect(10, 4, 2, 8, [120, 90, 50]); t.rect(9, 4, 4, 1, [160, 160, 165]); }
    else { t.rect(4, 5, 8, 1, [150, 150, 155]); t.rect(7, 6, 1, 6, [120, 90, 50]); t.rect(5, 6, 1, 2, [150, 150, 155]); }
  }
};
const toolHead: Record<string, RGB> = { wood: [150, 115, 65], stone: [135, 135, 135], iron: [225, 225, 230], diamond: [90, 230, 225] };
const tool = (mat: string, type: string): Painter => (t) => {
  t.clear();
  const hc = toolHead[mat], stick: RGB = [120, 85, 45];
  const handle = (from: number, to: number) => { for (let i = from; i <= to; i++) { t.px(2 + i, 13 - i, stick); t.px(3 + i, 13 - i, shade(stick, 0.7)); } };
  if (type === 'pickaxe') {
    handle(0, 9);
    const arc = [[3, 3], [4, 2], [5, 1], [6, 1], [7, 1], [8, 1], [9, 2], [10, 2], [11, 3], [12, 3], [12, 4], [13, 5], [13, 6], [14, 7], [14, 8], [14, 9], [14, 10], [13, 11], [12, 12]];
    for (const [x, y] of arc) { t.px(x, y, hc); t.px(x, y + 1, shade(hc, 0.75)); }
  } else if (type === 'axe') {
    handle(0, 10);
    for (let y = 1; y <= 7; y++) for (let x = 7; x <= 12; x++) if (x - 7 + (7 - y) >= 2 && x - y <= 8 && x + y >= 10 && x + y < 17) t.px(x, y, (x + y) % 3 ? hc : shade(hc, 0.78));
  } else if (type === 'shovel') {
    handle(0, 8);
    for (let y = 1; y <= 5; y++) for (let x = 10; x <= 14; x++) if (!((x === 10 && y === 1) || (x === 14 && y === 5))) t.px(x, y, (x + y) % 2 ? hc : shade(hc, 0.85));
  } else {
    for (let i = 0; i < 9; i++) { t.px(5 + i, 10 - i, hc); t.px(6 + i, 10 - i, shade(hc, 0.8)); t.px(5 + i, 9 - i, shade(hc, 1.1)); }
    for (let i = -2; i <= 2; i++) t.px(5 + i, 10 + i, shade(stick, 0.6));
    t.px(6, 12, shade(stick, 0.6)); t.px(3, 9, shade(stick, 0.6));
    t.px(3, 12, stick); t.px(2, 13, stick); t.px(4, 11, stick); t.px(1, 14, shade(hc, 0.8));
  }
};
const ingot = (c: RGB): Painter => (t) => { t.clear(); for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) t.px(2 + x + Math.floor((5 - y) / 2), 5 + y, shade(c, y < 2 ? 1.15 : y > 4 ? 0.7 : 1)); };
const meat = (c: RGB, edge: RGB): Painter => (t) => { t.clear(); t.blob(8, 8, 5.2, edge, 0.1); t.blob(7.5, 8.5, 3.8, c, 0.15); t.rect(11, 3, 3, 2, [235, 225, 205]); };

const PAINT: Record<string, Painter> = {
  stone, dirt, cobble,
  grass_top: (t) => t.noise(C.grass, 0.22),
  grass_side: sideOverlay(dirt, C.grass),
  snow_side: sideOverlay(dirt, C.snow),
  snow: (t) => t.noise(C.snow, 0.04),
  planks: planks(C.planks), birch_planks: planks(C.birchPlanks), spruce_planks: planks(C.sprucePlanks),
  sand: (t) => t.noise(C.sand, 0.1),
  gravel: (t) => { t.noise([132, 126, 124], 0.3); t.specks([90, 86, 84], 20); },
  log_side: logSide([105, 82, 50]), log_top: logTop([105, 82, 50], [184, 148, 92]),
  birch_side: logSide([222, 222, 214], true), birch_top: logTop([222, 222, 214], [200, 180, 125]),
  spruce_side: logSide([62, 42, 24]), spruce_top: logTop([62, 42, 24], [125, 92, 55]),
  leaves: leaves([58, 130, 40]), birch_leaves: leaves([112, 160, 72]), spruce_leaves: leaves([46, 88, 58]),
  glass: (t) => { t.noise([200, 232, 244], 0); t.frame([235, 248, 252], [215, 236, 244]); for (let i = 0; i < 4; i++) { t.px(3 + i, 6 - i, [245, 252, 255]); t.px(9 + i, 12 - i, [245, 252, 255]); } },
  water: (t) => t.noise([40, 88, 200], 0.12),
  lava: (t) => { t.noise([222, 95, 22], 0.3); t.specks([255, 210, 70], 22, 0.1); },
  bedrock: (t) => t.noise([72, 72, 72], 0.9),
  coal_ore: ore([35, 35, 35]), iron_ore: ore([216, 170, 140]), gold_ore: ore([250, 220, 70]), diamond_ore: ore([95, 235, 228]),
  ice: (t) => { t.noise([160, 198, 250], 0.06); for (let i = 0; i < 5; i++) { const x = Math.floor(t.rng() * 12), y = Math.floor(t.rng() * 14); t.px(x, y + 1, [215, 235, 255]); t.px(x + 1, y, [215, 235, 255]); } },
  cactus_side: (t) => { t.noise([62, 132, 52], 0.12); for (const x of [2, 7, 12]) { t.rect(x, 0, 1, 16, [40, 98, 36], 0.1); for (let y = 1; y < 16; y += 4) t.px(x + 1, y + (x % 3), [215, 225, 180]); } },
  cactus_top: (t) => { t.noise([88, 158, 66], 0.12); t.frame([40, 98, 36], [40, 98, 36]); },
  sandstone_top: (t) => t.noise([218, 204, 156], 0.06),
  sandstone_side: (t) => { t.noise([218, 204, 156], 0.06); t.rect(0, 0, 16, 1, [190, 172, 120], 0.05); t.rect(0, 4, 16, 1, [200, 184, 134], 0.08); t.rect(0, 15, 16, 1, [190, 172, 120], 0.05); },
  brick: (t) => { t.noise([172, 166, 158], 0.06); for (let r = 0; r < 4; r++) for (let bx = -1; bx < 3; bx++) { const x = bx * 8 + (r % 2 ? 4 : 0); t.rect(x, r * 4, 7, 3, [152, 72, 56], 0.18); } },
  table_top: table('top'), table_side: table('side'), table_front: table('front'),
  furnace_top: (t) => { t.noise([104, 104, 104], 0.1); t.frame([135, 135, 135], [70, 70, 70]); },
  furnace_side: furnaceSide, furnace_front: furnaceFront(false), furnace_lit: furnaceFront(true),
  torch: (t) => { t.clear(); t.rect(7, 8, 2, 8, [120, 88, 48], 0.15); t.rect(7, 6, 2, 2, [255, 200, 60], 0.15); t.px(7, 6, [255, 245, 170]); },
  tnt_side: (t) => {
    t.noise([200, 48, 38], 0.1); for (let x = 3; x < 16; x += 4) t.rect(x, 0, 1, 16, [150, 30, 25]); t.rect(0, 5, 16, 6, [235, 235, 230], 0.04);
    for (const [x, y] of [[2, 6], [3, 6], [4, 6], [3, 7], [3, 8], [3, 9], [6, 6], [6, 7], [6, 8], [6, 9], [7, 7], [8, 8], [9, 6], [9, 7], [9, 8], [9, 9], [11, 6], [12, 6], [13, 6], [12, 7], [12, 8], [12, 9]]) t.px(x, y, [25, 25, 25]);
  },
  tnt_top: (t) => { t.noise([200, 48, 38], 0.1); t.blob(7.5, 7.5, 3, [90, 90, 90], 0.1); t.rect(7, 7, 2, 2, [30, 30, 30]); },
  tnt_bottom: (t) => t.noise([180, 42, 34], 0.1),
  tallgrass: (t) => { t.clear(); for (let x = 1; x < 15; x++) if (t.rng() < 0.62) { const h = 4 + Math.floor(t.rng() * 9); for (let y = 0; y < h; y++) t.px(x + (y > h / 2 && t.rng() < 0.3 ? 1 : 0), 15 - y, t.v([86, 150, 50], 0.35)); } },
  flower_red: (t) => { t.clear(); t.rect(7, 8, 1, 8, [60, 130, 45]); t.px(8, 11, [60, 130, 45]); t.px(6, 13, [60, 130, 45]); t.blob(7.5, 5.5, 2.3, [215, 40, 35], 0.2); t.px(7, 5, [40, 20, 20]); },
  flower_yellow: (t) => { t.clear(); t.rect(7, 9, 1, 7, [60, 130, 45]); t.px(8, 12, [60, 130, 45]); t.blob(7.5, 7, 1.9, [250, 215, 50], 0.12); },
  deadbush: (t) => { t.clear(); const c: RGB = [120, 88, 45]; t.rect(7, 9, 1, 7, c, 0.2); for (let i = 1; i < 6; i++) { t.px(7 - i, 12 - i, t.v(c, 0.2)); t.px(8 + i, 11 - i, t.v(c, 0.2)); } for (let i = 0; i < 3; i++) { t.px(4 - i, 5 - i, c); t.px(10 + i, 4 - i, c); t.px(7, 8 - i, c); } },
  glowstone: (t) => { t.noise([205, 160, 75], 0.35); t.specks([255, 240, 170], 40, 0.1); },
  obsidian: (t) => { t.noise([26, 18, 42], 0.35); t.specks([70, 50, 100], 8); },
  wool_white: wool([232, 232, 232]), wool_red: wool([172, 45, 40]), wool_blue: wool([52, 66, 172]),
  wool_green: wool([82, 120, 42]), wool_yellow: wool([232, 190, 50]), wool_black: wool([34, 32, 36]),
  bookshelf: (t) => {
    planks(C.planks)(t);
    const cols: RGB[] = [[170, 45, 40], [50, 80, 160], [60, 130, 60], [200, 170, 60], [120, 60, 140], [150, 90, 50]];
    for (const y0 of [2, 9]) { t.rect(1, y0 - 1, 14, 6, [50, 36, 22]); for (let x = 1; x < 15; x++) { const c = cols[Math.floor(t.rng() * cols.length)]; const h = 4 + Math.floor(t.rng() * 2); t.rect(x, y0 + 5 - h, 1, h, c, 0.1); } }
  },
  iron_block: metal([222, 222, 226]), gold_block: metal([250, 215, 65]), diamond_block: metal([105, 232, 225]),
  stone_bricks: (t) => { t.noise([128, 128, 128], 0.1); for (const y of [7, 15]) t.rect(0, y, 16, 1, [88, 88, 88], 0.08); t.rect(7, 0, 1, 7, [88, 88, 88]); t.rect(15, 0, 1, 7, [88, 88, 88]); t.rect(3, 8, 1, 7, [88, 88, 88]); t.rect(11, 8, 1, 7, [88, 88, 88]); },
  // items
  stick: (t) => { t.clear(); for (let i = 0; i < 11; i++) { t.px(3 + i, 13 - i, [125, 90, 48]); t.px(4 + i, 13 - i, [90, 62, 30]); } },
  coal: (t) => { t.clear(); t.blob(7.5, 8, 4.6, [38, 38, 40], 0.5); },
  iron_ingot: ingot([222, 222, 226]), gold_ingot: ingot([250, 215, 65]),
  diamond: (t) => { t.clear(); for (let y = 0; y < 10; y++) { const w = y < 3 ? 3 + y : 8 - (y - 2); for (let x = -w; x <= w; x++) if (w >= 0) t.px(8 + x, 3 + y, t.v((x + y) % 3 === 0 ? [200, 255, 250] : [95, 228, 220], 0.12)); } },
  pork_raw: meat([240, 150, 150], [250, 200, 195]), pork_cooked: meat([190, 130, 80], [120, 75, 40]),
  beef_raw: meat([205, 60, 55], [235, 175, 170]), beef_cooked: meat([120, 70, 40], [70, 40, 22]),
  apple: (t) => { t.clear(); t.blob(7.5, 9, 4.5, [210, 40, 35], 0.15); t.px(6, 7, [250, 170, 160]); t.rect(8, 2, 1, 3, [100, 70, 35]); t.rect(9, 3, 2, 1, [70, 150, 50]); },
  gunpowder: (t) => { t.clear(); for (let y = 0; y < 6; y++) for (let x = -y - 1; x <= y + 1; x++) if (t.rng() < 0.85) t.px(8 + x, 7 + y, t.v([92, 92, 96], 0.5)); },
  rotten_flesh: meat([150, 95, 60], [96, 120, 60]),
};
for (const [mat] of TOOL_MATS) for (const type of ['pickaxe', 'axe', 'shovel', 'sword']) PAINT[`${mat}_${type}`] = tool(mat, type);

// ---------------------------------------------------------------- vectorization

function hashString(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h | 0; }

/** Box-filters a 16x16 RGBA image down to n x n. A texel is kept when at least half of it is covered. */
function downsample(src: Float32Array, n: number): Float32Array {
  const f = S / n, out = new Float32Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
      const o = ((y * f + j) * S + x * f + i) * 4;
      if (src[o + 3] > 0) { r += src[o]; g += src[o + 1]; b += src[o + 2]; a++; }
    }
    const o = (y * n + x) * 4;
    if (a * 2 >= f * f) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = 1; }
  }
  return out;
}

/** k-means over the opaque texels; returns tone colors and the tone index per texel (-1 = transparent). */
function quantize(img: Float32Array, n: number, k: number): { tones: RGB[]; map: Int8Array } {
  const idx: number[] = [];
  for (let i = 0; i < n * n; i++) if (img[i * 4 + 3] > 0) idx.push(i);
  const map = new Int8Array(n * n).fill(-1);
  if (!idx.length) return { tones: [], map };
  const lum = (i: number) => img[i * 4] * 0.3 + img[i * 4 + 1] * 0.59 + img[i * 4 + 2] * 0.11;
  const sorted = [...idx].sort((a, b) => lum(a) - lum(b));
  k = Math.min(k, sorted.length);
  let cent: number[][] = [];
  for (let c = 0; c < k; c++) { const i = sorted[Math.floor(((c + 0.5) / k) * sorted.length)]; cent.push([img[i * 4], img[i * 4 + 1], img[i * 4 + 2]]); }
  for (let iter = 0; iter < 6; iter++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (const i of idx) {
      let best = 0, bd = 1e18;
      for (let c = 0; c < cent.length; c++) {
        const dr = img[i * 4] - cent[c][0], dg = img[i * 4 + 1] - cent[c][1], db = img[i * 4 + 2] - cent[c][2];
        const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (d < bd) { bd = d; best = c; }
      }
      map[i] = best;
      const s = sum[best]; s[0] += img[i * 4]; s[1] += img[i * 4 + 1]; s[2] += img[i * 4 + 2]; s[3]++;
    }
    cent = cent.map((c, ci) => (sum[ci][3] ? [sum[ci][0] / sum[ci][3], sum[ci][1] / sum[ci][3], sum[ci][2] / sum[ci][3]] : c));
  }
  return { tones: cent.map((c) => [c[0], c[1], c[2]] as RGB), map };
}

/** Greedy rectangle merge of all texels that do not belong to `skip`. */
function mergeRects(map: Int8Array, n: number, skip: number): number[] {
  const used = new Uint8Array(n * n), out: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const t = map[y * n + x];
    if (t < 0 || t === skip || used[y * n + x]) continue;
    let w = 1;
    while (x + w < n && map[y * n + x + w] === t && !used[y * n + x + w]) w++;
    let h = 1;
    outer: for (; y + h < n; h++) for (let i = 0; i < w; i++) if (map[(y + h) * n + x + i] !== t || used[(y + h) * n + x + i]) break outer;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used[(y + j) * n + x + i] = 1;
    out.push(x, y, x + w, y + h, t);
  }
  return out;
}

function build(name: string, paint: Painter): Tex {
  const t = new T(mulberry32(hashString(name)));
  paint(t);
  const img = t.px_;
  let sprite = false, r = 0, g = 0, b = 0, cnt = 0;
  for (let i = 0; i < S * S; i++) { if (img[i * 4 + 3] === 0) sprite = true; else { r += img[i * 4]; g += img[i * 4 + 1]; b += img[i * 4 + 2]; cnt++; } }
  cnt = cnt || 1;
  const lods: TexLod[] = [];
  const levels: [number, number][] = sprite ? [[16, 6], [8, 4], [4, 2]] : [[16, 5], [8, 4], [4, 3], [2, 2]];
  for (const [n, k] of levels) {
    const q = quantize(n === S ? img : downsample(img, n), n, k);
    let base = -1;
    if (!sprite) {
      const count = new Array(q.tones.length).fill(0);
      for (const m of q.map) count[m]++;
      base = count.indexOf(Math.max(...count));
    }
    lods.push({ n, tones: q.tones, base, rects: mergeRects(q.map, n, base), ids: q.tones.map(() => new Uint16Array(72)) });
  }
  return { name, sprite, avg: [r / cnt, g / cnt, b / cnt], lods, avgIds: new Uint16Array(72) };
}

const cache = new Map<string, Tex>();
export function texture(name: string): Tex {
  let t = cache.get(name);
  if (!t) {
    const p = PAINT[name] ?? ((c: T) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) c.px(x, y, (x + y) % 2 ? [255, 0, 255] : [0, 0, 0]); });
    cache.set(name, (t = build(name, p)));
  }
  return t;
}
