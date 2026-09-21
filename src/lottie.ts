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

// ---------------------------------------------------------------- 2D characters for the 3D world (see lottie3d.ts)

const shapePath = (v: number[][], i: number[][], o: number[][], closed = true) => ({ c: closed, v, i, o });
const pathItem = (ks: object) => ({ ty: 'sh', d: 1, ks });

/** A hopping slime: squash and stretch on the layer, a stroked smile, soft shadow. 30 frame loop. */
export function slimeLottie(): string {
  const N = 30, c = 32, floor = 58;
  const body = pathItem(still(shapePath([[8, floor], [10, 34], [32, 20], [54, 34], [56, floor]], [[0, 0], [-4, 10], [-14, 0], [0, -10], [0, 0]], [[0, 0], [0, -10], [14, 0], [4, 10], [0, 0]]) as never));
  const smile = pathItem(still(shapePath([[24, 44], [32, 48], [40, 44]], [[0, 0], [-4, 0], [0, 0]], [[0, 0], [4, 0], [0, 0]], false) as never));
  const hop: Key[] = [{ t: 0, s: [c, floor, 0] }, { t: 6, s: [c, floor, 0] }, { t: 14, s: [c, floor - 18, 0] }, { t: 22, s: [c, floor, 0] }, { t: N - 1, s: [c, floor, 0] }];
  const squash: Key[] = [{ t: 0, s: [100, 100, 100] }, { t: 6, s: [122, 78, 100] }, { t: 11, s: [86, 120, 100] }, { t: 18, s: [92, 110, 100] }, { t: 23, s: [124, 76, 100] }, { t: N - 1, s: [100, 100, 100] }];
  const shadow: Key[] = [{ t: 0, s: [100, 100, 100] }, { t: 6, s: [112, 100, 100] }, { t: 14, s: [62, 62, 100] }, { t: 23, s: [114, 100, 100] }, { t: N - 1, s: [100, 100, 100] }];
  return doc(64, 64, N, [
    layer(1, N, [
      group([ellipse(24, 38, 5, 6), ellipse(40, 38, 5, 6), fill([24, 40, 24])]),
      group([ellipse(23, 37, 9, 11), ellipse(41, 37, 9, 11), fill([255, 255, 255])]),
      group([smile, stroke([24, 60, 30], 2.4, 2)]),
      group([ellipse(20, 29, 8, 5), fill([200, 250, 190])]),
      group([body, fill([96, 200, 96])]),
    ], { a: [c, floor, 0], p: hop, s: squash }),
    layer(2, N, [group([ellipse(c, floor + 1, 44, 8), fill([20, 30, 20])])], { a: [c, floor + 1, 0], p: [c, floor + 1, 0], s: shadow, o: 45 }),
  ]);
}

/** A floating ghost whose hem is a morphing path (vertex keyframes), with swaying arms. 40 frame loop. */
export function ghostLottie(): string {
  const N = 40, top = 10, hem = 66;
  const bodyAt = (ph: number) => {
    const w = (k: number) => hem + Math.sin(ph + k * 2.1) * 5;
    return shapePath([[12, 34], [32, top], [52, 34], [52, w(0)], [42, w(1) - 7], [32, w(2)], [22, w(3) - 7], [12, w(4)]],
      [[0, 12], [-12, 0], [0, -12], [0, 0], [4, 0], [4, 0], [4, 0], [4, 0]], [[0, -12], [12, 0], [0, 12], [-4, 0], [-4, 0], [-4, 0], [-4, 0], [0, 0]]);
  };
  const keys = [];
  for (let k = 0; k <= 4; k++) keys.push({ t: Math.min(N - 1, (k * N) / 4), s: [bodyAt((k / 4) * Math.PI * 2)], i: { x: 0.5, y: 1 }, o: { x: 0.5, y: 0 } });
  const float: Key[] = [{ t: 0, s: [32, 40, 0] }, { t: N / 2, s: [32, 34, 0] }, { t: N - 1, s: [32, 40, 0] }];
  const arm = (x: number, dir: number): object => layer(dir > 0 ? 2 : 3, N, [group([ellipse(0, 8, 9, 18), fill([226, 232, 250])])], {
    p: [{ t: 0, s: [x, 38, 0] }, { t: N / 2, s: [x, 32, 0] }, { t: N - 1, s: [x, 38, 0] }],
    r: [{ t: 0, s: [dir * 24] }, { t: N / 2, s: [dir * 52] }, { t: N - 1, s: [dir * 24] }],
  });
  return doc(64, 80, N, [
    layer(1, N, [
      group([ellipse(25, 30, 6, 9), ellipse(39, 30, 6, 9), fill([30, 30, 60])]),
      group([ellipse(32, 44, 8, 6), fill([60, 50, 90])]),
      group([pathItem({ a: 1, k: keys }), fill([240, 244, 255])]),
    ], { a: [32, 40, 0], p: float }),
    arm(10, 1), arm(54, -1),
  ]);
}

/** A spinning, pulsing star used as an item. 36 frame loop. */
export function starItemLottie(): string {
  const N = 36, st5 = (outer: number, inner: number, c: number[]) => group([{ ty: 'sr', sy: 1, d: 1, pt: still(5), p: still([0, 0]), r: still(0), ir: still(inner), is: still(0), or: still(outer), os: still(0) }, fill(c)]);
  return doc(64, 64, N, [layer(1, N, [st5(10, 4.5, [255, 250, 200]), st5(19, 8.5, [255, 214, 70]), st5(24, 10.5, [200, 130, 20])], {
    p: [32, 34, 0], r: [{ t: 0, s: [-14] }, { t: N / 2, s: [14] }, { t: N - 1, s: [-14] }],
    s: [{ t: 0, s: [92, 92, 100] }, { t: N / 2, s: [110, 110, 100] }, { t: N - 1, s: [92, 92, 100] }],
  })]);
}

// ---------------------------------------------------------------- villagers and the creatures of the other dimensions

const poly = (n: number, x: number, y: number, outer: number, inner = 0, rot = 0) => ({ ty: 'sr', sy: inner ? 1 : 2, d: 1, pt: still(n), p: still([x, y]), r: still(rot), ir: still(inner), is: still(0), or: still(outer), os: still(0) });
const closed = (v: number[][]) => pathItem(still(shapePath(v, v.map(() => [0, 0]), v.map(() => [0, 0])) as never));

/** Robed villager seen from the front; the job picks robe, hat and prop. 40 frame idle loop (bob, nod, blink). */
export function villagerLottie(job: 'farmer' | 'smith' | 'librarian'): string {
  const N = 40, skin = [214, 164, 120], robe = job === 'farmer' ? [150, 110, 60] : job === 'smith' ? [70, 70, 78] : [120, 70, 160];
  const trim = job === 'farmer' ? [90, 150, 70] : job === 'smith' ? [200, 120, 50] : [240, 220, 140];
  const bob: Key[] = [{ t: 0, s: [32, 96, 0] }, { t: N / 2, s: [32, 94.5, 0] }, { t: N - 1, s: [32, 96, 0] }];
  const nod: Key[] = [{ t: 0, s: [0] }, { t: 10, s: [4] }, { t: 22, s: [-3] }, { t: N - 1, s: [0] }];
  const blink: Key[] = [{ t: 0, s: [100, 100, 100] }, { t: 28, s: [100, 100, 100] }, { t: 30, s: [100, 10, 100] }, { t: 33, s: [100, 100, 100] }, { t: N - 1, s: [100, 100, 100] }];
  const hat = job === 'farmer'
    ? [group([rect(12, 14, 40, 5), rect(21, 5, 22, 10), fill([226, 196, 90])])]
    : job === 'smith' ? [group([rect(18, 10, 28, 7), fill([60, 60, 66])])]
      : [group([closed([[18, 16], [32, -4], [46, 16]]), fill([120, 70, 160])]), group([rect(16, 14, 32, 4), fill(trim)])];
  return doc(64, 96, N, [
    layer(1, N, [group([ellipse(25, 27, 5, 6), ellipse(39, 27, 5, 6), fill([40, 30, 30])])], { a: [32, 27, 0], p: [32, 27, 0], s: blink }),
    layer(2, N, [
      ...hat,
      group([rect(29, 28, 6, 12), fill([190, 138, 100])]),
      group([ellipse(32, 26, 28, 30), fill(skin)]),
    ], { a: [32, 40, 0], p: [32, 40, 0], r: nod }),
    layer(3, N, [
      group([rect(14, 56, 36, 9), fill(skin)]),
      group([rect(28, 44, 8, 50), fill(trim)]),
      group([closed([[16, 42], [48, 42], [54, 94], [10, 94]]), fill(robe)]),
      group([rect(18, 90, 10, 6), rect(36, 90, 10, 6), fill([60, 44, 36])]),
    ], { a: [32, 96, 0], p: bob }),
  ]);
}

/** Cinder: a floating fireball with a face, flames morphing around it. 24 frame loop. */
export function cinderLottie(): string {
  const N = 24;
  const flameAt = (ph: number, r: number) => {
    const v: number[][] = [], n = 9;
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, rr = r * (k % 2 ? 0.74 : 1.0 + Math.sin(ph + k * 1.9) * 0.2); v.push([32 + Math.cos(a) * rr, 34 + Math.sin(a) * rr * (Math.sin(a) < 0 ? 1.25 : 1)]); }
    return shapePath(v, v.map(() => [0, 0]), v.map(() => [0, 0]));
  };
  const ring = (r: number, c: number[], off: number) => {
    const keys = [];
    for (let k = 0; k <= 4; k++) keys.push({ t: Math.min(N - 1, (k * N) / 4), s: [flameAt((k / 4) * Math.PI * 2 + off, r)], i: { x: 0.5, y: 1 }, o: { x: 0.5, y: 0 } });
    return group([pathItem({ a: 1, k: keys }), fill(c)]);
  };
  return doc(64, 64, N, [layer(1, N, [
    group([ellipse(25, 32, 5, 8), ellipse(39, 32, 5, 8), fill([60, 16, 8])]),
    group([rect(26, 42, 12, 4), fill([60, 16, 8])]),
    group([ellipse(32, 35, 26, 26), fill([255, 236, 150])]),
    ring(19, [255, 170, 40], 1.3), ring(26, [235, 80, 20], 0),
  ], { p: [{ t: 0, s: [0, 0, 0] }, { t: N / 2, s: [0, -3, 0] }, { t: N - 1, s: [0, 0, 0] }] })]);
}

/** Glitch: a tall dark figure cut into slices that jump sideways (hold keyframes), with bright eyes. 30 frame loop. */
export function glitchLottie(): string {
  const N = 30, layers: object[] = [];
  layers.push(layer(1, N, [group([rect(14, 12, 7, 3), rect(27, 12, 7, 3), fill([120, 255, 240])])], { p: [{ t: 0, s: [0, 0, 0], h: 1 }, { t: 11, s: [3, 0, 0], h: 1 }, { t: 13, s: [0, 0, 0], h: 1 }, { t: N - 1, s: [0, 0, 0] }] }));
  const slices: [number, number, number, number][] = [[10, 4, 28, 20], [16, 24, 16, 14], [8, 38, 32, 26], [6, 40, 5, 44], [37, 40, 5, 44], [14, 64, 8, 46], [26, 64, 8, 46]];
  slices.forEach(([x, y, w, h], i) => {
    const t0 = (i * 7) % 24, dx = i % 2 ? 5 : -4;
    layers.push(layer(i + 2, N, [group([rect(x, y, w, h), fill(i === 2 ? [26, 20, 44] : [16, 12, 30])]), group([rect(x - 1, y - 1, w + 2, h + 2), fill([90, 110, 230])])], {
      p: [{ t: 0, s: [0, 0, 0], h: 1 }, { t: t0, s: [dx, 0, 0], h: 1 }, { t: t0 + 2, s: [-dx * 0.5, 0, 0], h: 1 }, { t: t0 + 4, s: [0, 0, 0], h: 1 }, { t: N - 1, s: [0, 0, 0] }],
    }));
  });
  return doc(48, 112, N, layers);
}

/** The Outline: nested polygons turning against each other around an eye. 60 frame loop. */
export function outlineBossLottie(): string {
  const N = 60, c = 80;
  const ringLayer = (ind: number, sides: number, r: number, color: number[], turns: number) => layer(ind, N, [
    group([poly(sides, 0, 0, r - 7), fill([10, 8, 28])]), group([poly(sides, 0, 0, r), fill(color)]),
  ], { p: [c, c, 0], r: [{ t: 0, s: [0] }, { t: N - 1, s: [turns * (360 / sides)] }] });
  return doc(160, 160, N, [
    layer(1, N, [group([ellipse(0, 0, 14, 22), fill([10, 8, 28])]), group([ellipse(0, 0, 40, 28), fill([120, 255, 240])])], {
      p: [c, c, 0], s: [{ t: 0, s: [100, 100, 100] }, { t: 40, s: [100, 100, 100] }, { t: 44, s: [100, 8, 100] }, { t: 48, s: [100, 100, 100] }, { t: N - 1, s: [100, 100, 100] }],
    }),
    ringLayer(2, 3, 34, [255, 214, 90], 1), ringLayer(3, 4, 52, [200, 140, 255], -1), ringLayer(4, 6, 68, [96, 120, 255], 1), ringLayer(5, 8, 78, [60, 230, 210], -1),
  ]);
}
