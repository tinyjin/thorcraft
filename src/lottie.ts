// Lottie animations for the HUD, authored in code (no asset files) and played by ThorVG's
// Lottie engine. The game drives them by frame: a heart's state picks a marker range, the
// furnace arrow is scrubbed by smelting progress.

type Vec = number[];
interface Key { t: number; s: Vec; h?: number }

const still = (k: Vec | number) => ({ a: 0, k });
const keyed = (keys: Key[]) => ({
  a: 1,
  k: keys.map((k, i) => (i === keys.length - 1 ? { t: k.t, s: k.s } : { t: k.t, s: k.s, h: k.h, i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } })),
});
const prop = (v: Vec | number | Key[]) => (Array.isArray(v) && typeof v[0] === 'object' ? keyed(v as Key[]) : still(v as Vec | number));

const fill = (c: readonly number[]) => ({ ty: 'fl', c: still([c[0] / 255, c[1] / 255, c[2] / 255, 1]), o: still(100), r: 1 });
const stroke = (c: readonly number[], w: number, cap = 1) => ({ ty: 'st', c: still([c[0] / 255, c[1] / 255, c[2] / 255, 1]), o: still(100), w: still(w), lc: cap, lj: 1, ml: 4 });
const groupTr = { ty: 'tr', p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100) };
const group = (items: object[]) => ({ ty: 'gr', it: [...items, groupTr] });
const rect = (x: number, y: number, w: number, h: number) => ({ ty: 'rc', d: 1, s: still([w, h]), p: still([x + w / 2, y + h / 2]), r: still(0) });

interface LayerOpts { p?: Vec | Key[]; a?: Vec; s?: Vec | Key[]; r?: number | Key[]; o?: number | Key[] }
const layer = (ind: number, op: number, shapes: object[], k: LayerOpts = {}) => ({
  ddd: 0, ind, ty: 4, nm: 'l' + ind, sr: 1, ao: 0, ip: 0, op, st: 0, bm: 0, shapes,
  ks: { o: prop(k.o ?? 100), r: prop(k.r ?? 0), p: prop(k.p ?? [0, 0, 0]), a: still(k.a ?? [0, 0, 0]), s: prop(k.s ?? [100, 100, 100]) },
});
const doc = (w: number, h: number, op: number, layers: object[], markers: [string, number, number][] = []) =>
  JSON.stringify({ v: '5.7.4', fr: 30, ip: 0, op, w, h, nm: 'thorcraft', ddd: 0, assets: [], layers, markers: markers.map(([cm, tm, dr]) => ({ cm, tm, dr })) });

// ---------------------------------------------------------------- heart

const HEART = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
/** Marker ranges of the heart animation: [first frame, length]. */
export const HEART_SEG = { idle: [0, 1], beat: [10, 20], break: [40, 26], gain: [70, 18] } as const;
const HEART_OP = 90;

/** A pixel heart in two halves so it can crack apart. `half` keeps only the left side. */
export function heartLottie(half: boolean): string {
  const px = 8, ox = 12, oy = 14, size = 80, c = size / 2;
  const cells = (from: number, to: number) => {
    const red: object[] = [], hi: object[] = [];
    for (let r = 0; r < HEART.length; r++) for (let col = from; col <= to; col++) {
      if (HEART[r][col] !== '1') continue;
      (r === 1 && col === 1 ? hi : red).push(rect(ox + col * px - 0.3, oy + r * px - 0.3, px + 0.6, px + 0.6));
    }
    return [group([...hi, fill([255, 170, 170])]), group([...red, fill([232, 34, 42])])];
  };
  const B0 = HEART_SEG.beat[0], K0 = HEART_SEG.break[0], G0 = HEART_SEG.gain[0];
  const scale: Key[] = [
    { t: 0, s: [100, 100, 100] }, { t: B0, s: [100, 100, 100] }, { t: B0 + 6, s: [124, 124, 100] }, { t: B0 + 19, s: [100, 100, 100] },
    { t: K0, s: [128, 128, 100] }, { t: K0 + 6, s: [100, 100, 100] }, { t: G0 - 1, s: [100, 100, 100], h: 1 },
    { t: G0, s: [30, 30, 100] }, { t: G0 + 9, s: [126, 126, 100] }, { t: G0 + 17, s: [100, 100, 100] },
  ];
  const opacity: Key[] = [{ t: 0, s: [100] }, { t: K0 + 8, s: [100] }, { t: K0 + 25, s: [0] }, { t: G0 - 1, s: [0], h: 1 }, { t: G0, s: [20] }, { t: G0 + 6, s: [100] }];
  const side = (dir: number): LayerOpts => ({
    a: [c, c, 0], s: scale, o: opacity,
    p: [{ t: 0, s: [c, c, 0] }, { t: K0 + 4, s: [c, c, 0] }, { t: K0 + 25, s: [c + dir * 16, c + 22, 0] }, { t: G0 - 1, s: [c, c, 0], h: 1 }, { t: G0, s: [c, c, 0] }],
    r: [{ t: 0, s: [0] }, { t: K0 + 4, s: [0] }, { t: K0 + 25, s: [dir * 34] }, { t: G0 - 1, s: [0], h: 1 }, { t: G0, s: [0] }],
  });
  const layers = [layer(1, HEART_OP, cells(0, 3), side(-1))];
  if (!half) layers.push(layer(2, HEART_OP, cells(4, 6), side(1)));
  return doc(size, size, HEART_OP, layers, Object.entries(HEART_SEG).map(([k, v]) => [k, v[0], v[1]] as [string, number, number]));
}

// ---------------------------------------------------------------- furnace flame

export const FLAME_FRAMES = 24;

/** Three nested teardrops whose tips sway; loops seamlessly. */
export function flameLottie(): string {
  const tear = (tipX: number, tipY: number, w: number, baseY: number, cx: number) => ({
    c: true,
    v: [[tipX, tipY], [cx + w, baseY - w * 0.9], [cx, baseY], [cx - w, baseY - w * 0.9]],
    i: [[-w * 0.15, w * 0.5], [0, -w * 0.9], [w * 0.75, 0], [0, w * 0.75]],
    o: [[w * 0.15, w * 0.5], [0, w * 0.75], [-w * 0.75, 0], [0, -w * 0.9]],
  });
  const flame = (ind: number, color: number[], w: number, tipY: number, sway: number, phase: number) => {
    const keys = [];
    for (let k = 0; k <= 4; k++) {
      const a = (k / 4) * Math.PI * 2 + phase;
      keys.push({ t: (k * FLAME_FRAMES) / 4, s: [tear(32 + Math.sin(a) * sway, tipY + Math.cos(a * 2) * 2.5, w * (1 + Math.sin(a + 1) * 0.06), 58, 32)], i: { x: 0.5, y: 1 }, o: { x: 0.5, y: 0 } });
    }
    return layer(ind, FLAME_FRAMES, [group([{ ty: 'sh', d: 1, ks: { a: 1, k: keys } }, fill(color)])]);
  };
  // Lottie draws the first layer on top.
  return doc(64, 64, FLAME_FRAMES, [
    flame(1, [255, 246, 190], 6, 36, 2.5, 1.2),
    flame(2, [255, 200, 60], 11, 22, 4, 0.5),
    flame(3, [240, 110, 25], 17, 6, 5.5, 0),
  ]);
}

// ---------------------------------------------------------------- furnace progress arrow

export const ARROW_FRAMES = 100;

/** An arrow drawn by a trim path; frame = smelting progress in percent. */
export function arrowLottie(): string {
  const path = (v: number[][]) => ({ ty: 'sh', d: 1, ks: still({ c: false, v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]) } as never) });
  const shaft = path([[6, 32], [60, 32]]), head = path([[56, 12], [88, 32], [56, 52]]);
  const trim = { ty: 'tm', s: still(0), e: keyed([{ t: 0, s: [0] }, { t: ARROW_FRAMES - 1, s: [100] }]), o: still(0), m: 2 };
  return doc(96, 64, ARROW_FRAMES, [
    layer(1, ARROW_FRAMES, [group([shaft, head, trim, stroke([255, 255, 255], 11, 2)])]),
    layer(2, ARROW_FRAMES, [group([shaft, head, stroke([112, 112, 112], 13, 2)])]),
  ]);
}

// ---------------------------------------------------------------- world billboards

const ellipse = (x: number, y: number, w: number, h: number) => ({ ty: 'el', d: 1, s: still([w, h]), p: still([x, y]) });
const star = (x: number, y: number, outer: number, inner: number) => ({ ty: 'sr', sy: 1, d: 1, pt: still(4), p: still([x, y]), r: still(0), ir: still(inner), is: still(0), or: still(outer), os: still(0) });

export const ALERT_FRAMES = 36;

/** "!" that pops in over a mob that just noticed the player, wobbles, then fades. */
export function alertLottie(): string {
  const mark = [group([rect(26, 8, 12, 30), rect(26, 44, 12, 11), fill([255, 220, 60])]), group([rect(22, 4, 20, 38), rect(22, 40, 20, 19), fill([40, 20, 10])])];
  return doc(64, 64, ALERT_FRAMES, [layer(1, ALERT_FRAMES, mark, {
    a: [32, 58, 0], p: [32, 58, 0],
    s: [{ t: 0, s: [0, 0, 100] }, { t: 7, s: [135, 135, 100] }, { t: 12, s: [100, 100, 100] }, { t: 28, s: [100, 100, 100] }, { t: 35, s: [60, 60, 100] }],
    r: [{ t: 8, s: [0] }, { t: 12, s: [-12] }, { t: 16, s: [10] }, { t: 20, s: [-6] }, { t: 24, s: [0] }],
    o: [{ t: 0, s: [100] }, { t: 28, s: [100] }, { t: 35, s: [0] }],
  })]);
}

export const FUSE_FRAMES = 20;

/** Warning rings pulsing out of a creeper that is about to blow; loops. */
export function fuseLottie(): string {
  const ring = (ind: number, offset: number) => {
    const t0 = offset, mid = FUSE_FRAMES / 2;
    // Two staggered rings; each grows and fades within the loop.
    return layer(ind, FUSE_FRAMES, [group([ellipse(0, 0, 60, 60), stroke(ind === 1 ? [255, 255, 255] : [255, 90, 40], 3.5)])], {
      p: [48, 48, 0],
      s: offset === 0 ? [{ t: 0, s: [20, 20, 100] }, { t: FUSE_FRAMES - 1, s: [150, 150, 100] }] : [{ t: 0, s: [85, 85, 100] }, { t: mid, s: [150, 150, 100], h: 1 }, { t: mid + 1, s: [20, 20, 100] }, { t: FUSE_FRAMES - 1, s: [85, 85, 100] }],
      o: t0 === 0 ? [{ t: 0, s: [100] }, { t: FUSE_FRAMES - 1, s: [0] }] : [{ t: 0, s: [50] }, { t: mid, s: [0], h: 1 }, { t: mid + 1, s: [100] }, { t: FUSE_FRAMES - 1, s: [50] }],
    });
  };
  return doc(96, 96, FUSE_FRAMES, [ring(1, 0), ring(2, 10)]);
}

export const SPARKLE_FRAMES = 48;

/** Four point stars twinkling around a gem; loops. */
export function sparkleLottie(): string {
  const tw = (ind: number, x: number, y: number, size: number, phase: number) => {
    // One pulse per loop, offset by `phase`; zero scale for the rest of the time.
    const sc: Key[] = [{ t: phase, s: [0, 0, 100] }, { t: phase + 8, s: [100, 100, 100] }, { t: phase + 16, s: [0, 0, 100] }, { t: SPARKLE_FRAMES - 1, s: [0, 0, 100] }];
    if (phase > 0) sc.unshift({ t: 0, s: [0, 0, 100] });
    return layer(ind, SPARKLE_FRAMES, [group([star(0, 0, size, size * 0.22), fill([225, 255, 255])])], { p: [x, y, 0], s: sc, r: [{ t: 0, s: [0] }, { t: SPARKLE_FRAMES - 1, s: [90] }] });
  };
  return doc(96, 96, SPARKLE_FRAMES, [tw(1, 22, 26, 16, 0), tw(2, 74, 38, 12, 14), tw(3, 40, 76, 14, 28), tw(4, 70, 80, 9, 6)]);
}
