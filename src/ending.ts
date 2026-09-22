// The ending. Stepping into the way home after freeing the Outline melts the Void away and plays
// ThorCraft's end poem and credits, drawn like everything else with ThorVG: pooled text, stroked
// polygons that draw themselves with trim paths, the cast as live Lottie animations, a gradient logo.
//
// Two voices talk about the player. In a world where every block is a path, they are the two halves
// of every shape: the Stroke (cyan, hollow marker) and the Fill (gold, solid marker).

import { Input } from './input';
import { cinderLottie, ghostLottie, glitchLottie, outlineBossLottie, slimeLottie, starItemLottie, villagerLottie } from './lottie';
import { clamp, mulberry32, smooth } from './math';
import { Sfx } from './audio';
import { UILayer, textWidth, wrapText } from './ui';

/** Counters kept across the whole save, shown in the credits. */
export interface RunStats { mined: number; placed: number; slain: number; deaths: number; walked: number; played: number; dims: string[] }
export const newStats = (): RunStats => ({ mined: 0, placed: 0, slain: 0, deaths: 0, walked: 0, played: 0, dims: ['overworld'] });

export interface EndingInfo {
  seed: string; creative: boolean; renderer: string; days: number; gems: number; stats: RunStats;
  /** Titles of the advancements earned so far, and how many exist. */
  advancements: string[]; advTotal: number;
}

type Phase = 'melt' | 'poem' | 'credits' | 'leave';
type Voice = 0 | 1; // 0 stroke, 1 fill

const STROKE = [120, 255, 240] as const, FILL = [255, 214, 90] as const, WHITE = [255, 255, 255] as const, GREY = [150, 158, 178] as const;
const VOID_BG = [5, 4, 16] as const;
const MELT_TIME = 3.2, CPS = 26, LINE_PAUSE = 1.35, CREDIT_SPEED = 44, HURRY = 4;
const CAST_JSON: Record<string, () => string> = {
  slime: slimeLottie, ghost: ghostLottie, farmer: () => villagerLottie('farmer'), smith: () => villagerLottie('smith'), librarian: () => villagerLottie('librarian'),
  cinder: cinderLottie, glitch: glitchLottie, outline: outlineBossLottie, star: starItemLottie,
};

type Entry =
  | { kind: 'logo' }
  | { kind: 'gap'; h: number }
  | { kind: 'head'; text: string }
  | { kind: 'line'; text: string; size?: number; color?: readonly number[] }
  | { kind: 'pair'; left: string; right: string }
  | { kind: 'cast'; who: string[]; name: string; role: string; big?: boolean }
  | { kind: 'end' };

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fmtTime = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };

function poemLines(i: EndingInfo): { v: Voice; t: string }[] {
  const s = i.stats, days = i.days + 1;
  const dims = s.dims.length;
  return [
    { v: 0, t: 'It is done. The Outline is free.' },
    { v: 1, t: 'Free. It spent an age nailing its own edges to obsidian. Freedom is going to confuse it.' },
    { v: 0, t: 'Look at the player.' },
    { v: 1, t: 'I see a rectangle. Two, if you count the hand.' },
    { v: 0, t: `It walked our world for ${plural(days, 'day')}. It broke ${plural(s.mined, 'rectangle')} and stacked ${plural(s.placed, 'more')}. It never once asked what they were made of.` },
    { v: 1, t: 'Paths. Everything here is paths. moveTo, lineTo, close. Even the sun is a rounded rect with ambitions.' },
    { v: 0, t: 'It thinks the world is made of blocks.' },
    { v: 1, t: 'Let it. A block is only a cube that has not been flattened yet.' },
    { v: 0, t: `Its world is called "${i.seed}". It did not choose that name. Something random did.` },
    { v: 1, t: 'Everything good here was random. The noise, the caves, the name. Only the villages were planned, and look how that went.' },
    { v: 0, t: 'It crafted. It smelted. It fed a furnace whose flame was a Lottie the whole time.' },
    { v: 1, t: 'And it lost hearts. Every crack in those hearts was a keyframe. I made sure of it.' },
    { v: 0, t: s.deaths === 0 ? 'It never fell. Not once.' : `It fell ${plural(s.deaths, 'time')}.` },
    { v: 1, t: s.deaths === 0 ? 'That is suspicious. Nobody walks a world of edges without cutting themselves.' : 'And it got up every time, at the same coordinates, as if nothing had happened. That is not courage. That is a spawn point.' },
    { v: 0, t: dims >= 3 ? 'It went down into the Ember Depths, and out into the Void, and it stared at the Glitches.' : 'It came all the way out here, into the Void, and it stared at the Glitches.' },
    { v: 1, t: 'You are not supposed to stare at the Glitches.' },
    { v: 0, t: 'The Outline was the last thing in this world with no fill.' },
    { v: 1, t: 'That is why it was angry. Imagine being a stroke with nothing inside you.' },
    { v: 0, t: 'Now it has a trophy, and a face, and a place on the credits.' },
    { v: 1, t: 'Speaking of which. It is time to send the player home.' },
    { v: 0, t: 'Home is a chunk sixteen wide, drawn by the same engine. It will not notice the difference.' },
    { v: 1, t: 'It will notice the sky. There is a sun there. An SVG, with rays.' },
    { v: 0, t: 'Tell it the truth before it goes.' },
    { v: 1, t: 'You are made of vectors. So is the grass. So is the night. So are we.' },
    { v: 0, t: 'And all of it was drawn again, sixty times a second, just for you.' },
    { v: 1, t: 'Not sixty. Sometimes forty. The software renderer was watching.' },
    { v: 0, t: 'Wake up, player.' },
    { v: 1, t: 'There is still a world being drawn. Go and fill it.' },
  ];
}

function creditEntries(i: EndingInfo): Entry[] {
  const s = i.stats;
  const backend = i.renderer === 'gl' ? 'WebGL' : i.renderer === 'wg' ? 'WebGPU' : 'Software rasterizer';
  const adv = i.advancements.length ? i.advancements.join('  ·  ') : 'none, which is its own kind of achievement';
  return [
    { kind: 'gap', h: 40 },
    { kind: 'logo' },
    { kind: 'line', text: 'a voxel world where every pixel is a path', size: 16, color: [255, 255, 85] },
    { kind: 'gap', h: 70 },
    { kind: 'head', text: 'Starring' },
    { kind: 'cast', who: ['outline'], name: 'The Outline', role: 'as itself. Five rings, one eye, no fill. Now retired.', big: true },
    { kind: 'cast', who: ['slime'], name: 'The Slimes', role: 'squash and stretch, thirty frames, one smile' },
    { kind: 'cast', who: ['ghost'], name: 'The Ghosts', role: 'a hem that morphs by vertex keyframes' },
    { kind: 'cast', who: ['farmer', 'smith', 'librarian'], name: 'The Villagers of Craftstead', role: 'farmer, smith and librarian. Paid in gems.' },
    { kind: 'cast', who: ['cinder'], name: 'The Cinders', role: 'fireballs with a face and a grudge' },
    { kind: 'cast', who: ['glitch'], name: 'The Glitches', role: 'hold keyframes. Do not stare.' },
    { kind: 'cast', who: ['star'], name: 'The Lottie Star', role: 'edible. Five points. Spins in your hand.' },
    { kind: 'line', text: 'Pigs, cows, sheep, zombies and creepers appear as box models. Walk cycles by sine wave.', size: 14, color: GREY },
    { kind: 'gap', h: 60 },
    { kind: 'head', text: 'Drawn by' },
    { kind: 'pair', left: 'Engine', right: 'ThorVG WebCanvas' },
    { kind: 'pair', left: 'Backend, this run', right: backend },
    { kind: 'pair', left: 'Terrain', right: 'gradient noise, generated one chunk at a time' },
    { kind: 'pair', left: 'Textures', right: '16 x 16 texels, quantized and merged into rectangles' },
    { kind: 'pair', left: 'Level of detail', right: '16, 8, 4 and 2 texels, picked by distance' },
    { kind: 'pair', left: 'Shadows', right: 'ambient occlusion strips and sky exposure' },
    { kind: 'pair', left: 'Sky', right: 'an SVG sun, eight SVG moons, tinted SVG clouds' },
    { kind: 'pair', left: 'Void sky', right: 'a ringed planet and three layers of aurora, also SVG' },
    { kind: 'pair', left: 'Hearts', right: 'one Lottie, four markers: idle, beat, break, gain' },
    { kind: 'pair', left: 'Furnace', right: 'a flame clipped by fuel, an arrow scrubbed by a trim path' },
    { kind: 'pair', left: 'Mining', right: 'a trim path around the crosshair' },
    { kind: 'pair', left: 'Water, lava, night, pause', right: 'scene tint and Gaussian blur' },
    { kind: 'pair', left: 'Torch light', right: 'radial gradients, occlusion tested against the voxels' },
    { kind: 'pair', left: 'Creatures of the Void', right: '2D Lottie, walked with an Accessor, extruded into slabs' },
    { kind: 'pair', left: 'Minimap', right: 'a clip mask and 400 shapes, tops' },
    { kind: 'pair', left: 'This logo', right: 'a linear gradient with a travelling sheen' },
    { kind: 'pair', left: 'Sound', right: 'filtered white noise and square waves' },
    { kind: 'pair', left: 'Music', right: 'none. You were humming.' },
    { kind: 'gap', h: 60 },
    { kind: 'head', text: 'Your run' },
    { kind: 'pair', left: 'World', right: `"${i.seed}"` },
    { kind: 'pair', left: 'Mode', right: i.creative ? 'creative, which explains a lot' : 'survival' },
    { kind: 'pair', left: 'Days survived', right: String(i.days) },
    { kind: 'pair', left: 'Time played', right: fmtTime(s.played) },
    { kind: 'pair', left: 'Blocks mined', right: String(s.mined) },
    { kind: 'pair', left: 'Blocks placed', right: String(s.placed) },
    { kind: 'pair', left: 'Mobs slain', right: String(s.slain) },
    { kind: 'pair', left: 'Deaths', right: s.deaths === 0 ? '0 (suspicious)' : String(s.deaths) },
    { kind: 'pair', left: 'Distance walked', right: s.walked >= 1000 ? `${(s.walked / 1000).toFixed(1)} km` : `${Math.round(s.walked)} blocks` },
    { kind: 'pair', left: 'Gems', right: String(i.gems) },
    { kind: 'pair', left: 'Dimensions', right: s.dims.map((d) => (d === 'ember' ? 'Ember Depths' : d === 'void' ? 'Vector Void' : 'Overworld')).join(', ') },
    { kind: 'pair', left: 'Advancements', right: `${i.advancements.length} of ${i.advTotal}` },
    { kind: 'line', text: adv, size: 13, color: GREY },
    { kind: 'gap', h: 60 },
    { kind: 'head', text: 'Special thanks' },
    { kind: 'line', text: 'moveTo, lineTo and close, for holding it all together' },
    { kind: 'line', text: 'the trim path, for making progress bars interesting' },
    { kind: 'line', text: 'every rectangle that agreed to be merged with its neighbour' },
    { kind: 'line', text: 'the FinalizationRegistry, for cleaning up after us' },
    { kind: 'line', text: 'the obsidian frame, for being at least 2 x 3 inside' },
    { kind: 'line', text: 'you, for reading this far' },
    { kind: 'gap', h: 110 },
    { kind: 'end' },
  ];
}

/** ThorVG reports an error when asked for the frame it already shows, so only send real changes. */
function setFrame(anim: any, frame: number) {
  if (Math.abs((anim.__f ?? -1) - frame) < 0.01) return;
  anim.__f = frame;
  try { anim.frame(frame); } catch { /* same frame after rounding */ }
}

export class Ending {
  readonly scene: any;
  private ui: UILayer; private top: UILayer;
  private lottieScene: any;
  private logo: any = null;
  private cast = new Map<string, { anim: any; w: number; h: number; frames: number }>();
  private info!: EndingInfo;
  private poem: { v: Voice; t: string }[] = [];
  private entries: Entry[] = [];
  phase: Phase = 'melt';
  active = false;
  /** True once the poem covers the world, so the 3D view can stop rendering. */
  get opaque() { return this.active && this.phase !== 'melt'; }
  /** How far the camera has floated up during the melt. */
  lift = 0;
  private t = 0; private phaseT = 0; private clock = 0;
  private poemScroll = 0; private poemDone = 0; private poemHold = -1;
  private creditT = 0; private endHold = -1;
  private musicT = 0; private musicI = 0; private bassT = 0;
  private rnd = mulberry32(7);

  constructor(private TVG: any, font: string, private sfx: Sfx) {
    this.scene = new TVG.Scene();
    this.ui = new UILayer(TVG, font);
    this.top = new UILayer(TVG, font);
    this.lottieScene = new TVG.Scene();
    this.scene.add(this.ui.scene).add(this.lottieScene).add(this.top.scene);
    this.scene.visible(false);
  }

  start(info: EndingInfo) {
    this.info = info;
    this.poem = poemLines(info);
    this.entries = creditEntries(info);
    this.active = true; this.phase = 'melt';
    this.t = this.phaseT = 0; this.lift = 0; this.poemScroll = 0; this.poemDone = 0; this.poemHold = -1; this.creditT = 0; this.endHold = -1;
    this.musicT = 0.8; this.musicI = 0; this.bassT = 0;
    this.rnd = mulberry32(info.seed.length * 31 + 7);
    this.scene.visible(true);
    this.sfx.drone();
  }

  stop() {
    this.active = false;
    this.scene.visible(false);
    for (const c of this.cast.values()) c.anim.picture.visible(false);
    if (this.logo) this.logo.visible(false);
  }

  private castAnim(key: string) {
    let c = this.cast.get(key);
    if (!c) {
      const anim = new this.TVG.LottieAnimation();
      anim.load(CAST_JSON[key]());
      const size = anim.picture.size(), info = anim.info();
      this.lottieScene.add(anim.picture);
      this.cast.set(key, (c = { anim, w: size.width, h: size.height, frames: Math.max(1, Math.round(info?.totalFrames ?? 1)) }));
    }
    return c;
  }

  /**
   * Advances and draws one frame. Returns true once the sequence is over and the player should be sent home.
   * Escape skips everything, holding Space or the mouse button hurries.
   */
  draw(input: Input, w: number, h: number, dt: number, clock: number): boolean {
    if (!this.active) return false;
    this.clock = clock;
    this.ui.begin(); this.top.begin();
    const hurry = input.buttons[0] || input.keys.has('Space') ? HURRY : 1;
    const skip = input.pressed.has('Escape');
    this.t += dt; this.phaseT += dt;
    let done = false;
    const shown = new Set<string>();

    if (this.phase === 'melt') {
      // The Void bleeds out into white, then the poem's darkness takes over.
      const k = smooth(clamp(this.phaseT / MELT_TIME, 0, 1));
      this.lift = k * k * 3;
      this.ui.rect(0, 0, w, h, [235, 225, 255, Math.floor(255 * smooth(clamp(k * 1.25, 0, 1)))]);
      if (k >= 1 || skip) this.setPhase('poem');
    } else if (this.phase === 'poem') {
      this.drawPoem(w, h, dt, hurry);
      if (skip) this.setPhase('credits');
    } else if (this.phase === 'credits') {
      this.drawCredits(input, w, h, dt, hurry, shown);
      if (skip) this.setPhase('leave');
    } else {
      // Fade to white; the overworld loads behind it.
      this.ui.rect(0, 0, w, h, [VOID_BG[0], VOID_BG[1], VOID_BG[2], 255]);
      this.top.rect(0, 0, w, h, [255, 255, 255, Math.floor(255 * smooth(clamp(this.phaseT / 1.4, 0, 1)))]);
      if (this.phaseT > 1.5) done = true;
    }

    // Faint controls hint.
    if (this.phase === 'poem' || this.phase === 'credits') this.top.text('hold Space to hurry  ·  Esc to skip', w - 16, h - 14, 11, [255, 255, 255, 90], 1, 1);

    for (const [key, c] of this.cast) if (!shown.has(key)) c.anim.picture.visible(false);
    if (this.logo && !shown.has('logo')) this.logo.visible(false);
    this.ui.end(); this.top.end();
    return done;
  }

  private setPhase(p: Phase) {
    this.phase = p; this.phaseT = 0;
    if (p === 'poem') this.lift = 0;
    if (p === 'leave') this.sfx.gem();
  }

  // ------------------------------------------------------------------ the poem

  private drawPoem(w: number, h: number, dt: number, hurry: number) {
    const ui = this.ui;
    ui.rect(0, 0, w, h, [VOID_BG[0], VOID_BG[1], VOID_BG[2], 255]);
    // The white of the melt drains away over the first second.
    if (this.phaseT < 1.4) this.top.rect(0, 0, w, h, [235, 225, 255, Math.floor(255 * (1 - smooth(clamp(this.phaseT / 1.4, 0, 1))))]);
    this.drawPolygons(w, h, 1);
    this.music(dt, 'poem');

    // Typewriter budget in characters; each line also costs a pause.
    const budget = this.poemDone;
    this.poemDone += dt * CPS * hurry;
    const size = Math.min(19, Math.max(14, w / 48)), lineH = size * 1.55, maxW = Math.min(w * 0.72, 720), x0 = w / 2 - maxW / 2;
    const rows: { v: Voice; text: string; first: boolean }[] = [];
    let left = budget, finished = true;
    for (const l of this.poem) {
      const cost = l.t.length + LINE_PAUSE * CPS;
      const shownChars = left >= cost ? l.t.length : Math.floor(Math.max(0, left));
      if (shownChars <= 0) { finished = false; break; }
      const part = l.t.slice(0, shownChars);
      wrapText(part, size, maxW - 28).forEach((s, i) => rows.push({ v: l.v, text: s, first: i === 0 }));
      left -= cost;
      if (shownChars < l.t.length) { finished = false; break; }
    }
    // The block scrolls up smoothly as lines are added; the newest line sits around 60% down the screen.
    const target = rows.length * lineH;
    this.poemScroll += (target - this.poemScroll) * Math.min(1, dt * 6);
    const baseY = h * 0.6 - this.poemScroll;
    rows.forEach((r, i) => {
      const y = baseY + (i + 0.5) * lineH;
      if (y < -lineH || y > h + lineH) return;
      const fade = clamp((y - h * 0.08) / (h * 0.14), 0, 1) * clamp((h * 0.9 - y) / (h * 0.1), 0, 1);
      const c = r.v === 0 ? STROKE : FILL, a = Math.floor(235 * fade);
      if (a <= 0) return;
      if (r.first) {
        const m = 7;
        if (r.v === 0) ui.frame(x0 + 2, y - m, m * 2 - 2, m * 2 - 2, [c[0], c[1], c[2], a], 2);
        else ui.rect(x0 + 2, y - m, m * 2 - 2, m * 2 - 2, [c[0], c[1], c[2], a]);
      }
      ui.text(r.text, x0 + 28, y, size, [c[0], c[1], c[2], a], 0, 0.5);
    });
    if (finished) {
      // Everything has been said: hold for a moment, then the credits.
      if (this.poemHold < 0) this.poemHold = this.phaseT;
      if (this.phaseT - this.poemHold > 3.4 / hurry) this.setPhase('credits');
    }
  }

  /** Nested outlines slowly turning against each other, each drawing itself in and out with a trim path. */
  private drawPolygons(w: number, h: number, alpha: number) {
    const ui = this.ui, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.46, t = this.t;
    const rings: [number, number, readonly number[], number][] = [[3, 0.42, FILL, 1], [4, 0.6, [200, 140, 255], -1], [6, 0.78, [96, 120, 255], 1], [8, 0.92, STROKE, -1]];
    rings.forEach(([n, k, c, dir], i) => {
      const s = ui.shape(), r = R * k, rot = t * 0.06 * dir + i;
      for (let v = 0; v < n; v++) { const a = rot + (v / n) * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; v ? s.lineTo(x, y) : s.moveTo(x, y); }
      const ph = (t * 0.11 + i * 0.23) % 1, len = 0.35 + 0.3 * Math.sin(t * 0.3 + i);
      s.close().fill(0, 0, 0, 0).trimPath(ph, ph + len).stroke({ width: 2.5, color: [c[0], c[1], c[2], Math.floor(70 * alpha)], cap: 'round', join: 'round' });
    });
  }

  // ------------------------------------------------------------------ the credits

  private drawCredits(input: Input, w: number, h: number, dt: number, hurry: number, shown: Set<string>) {
    const ui = this.ui;
    ui.rect(0, 0, w, h, [VOID_BG[0], VOID_BG[1], VOID_BG[2], 255]);
    this.drawPolygons(w, h, 0.5);
    this.music(dt, 'credits');
    if (this.endHold < 0) this.creditT += dt * hurry;

    const narrow = w < 700, size = narrow ? 14 : 16, cx = w / 2, colGap = narrow ? 12 : 22;
    const rowH = size * 1.5;
    // Lay the entries out top to bottom; `y` is the running top of the scrolled block.
    let y = h - this.creditT * CREDIT_SPEED;
    const visible = (top: number, height: number) => top + height > -20 && top < h + 20;
    const fadeAt = (yy: number) => clamp((yy - 6) / (h * 0.12), 0, 1) * clamp((h - 6 - yy) / (h * 0.12), 0, 1);
    for (const e of this.entries) {
      let hgt = 0;
      switch (e.kind) {
        case 'gap': hgt = e.h; break;
        case 'logo': {
          const fs = Math.min(72, w / 9);
          hgt = fs * 1.4;
          if (visible(y, hgt)) {
            const ly = y + hgt / 2, a = fadeAt(ly);
            ui.text('THORCRAFT', cx + 4, ly + 4, fs, [0, 0, 0, Math.floor(190 * a)], 0.5, 0.5);
            if (!this.logo) { this.logo = new this.TVG.Text(); this.logo.font('ui').text('THORCRAFT'); this.lottieScene.add(this.logo); }
            const sheen = (this.t * 0.25) % 1.6 - 0.3;
            const grad = new this.TVG.LinearGradient(0, 0, fs * 6, fs * 0.6);
            const stop = (o: number, c: number[]) => grad.addStop(clamp(o, 0, 1), c);
            stop(0, [255, 214, 92, 255]); stop(sheen - 0.12, [255, 170, 40, 255]); stop(sheen, [255, 255, 235, 255]); stop(sheen + 0.12, [255, 170, 40, 255]); stop(1, [255, 120, 30, 255]);
            this.logo.fontSize(fs).fill(grad).align(0.5, 0.5).translate(cx, ly).opacity(Math.floor(255 * a)).visible(true);
            shown.add('logo');
          }
          break;
        }
        case 'head': {
          hgt = rowH * 2.2;
          if (visible(y, hgt)) {
            const ly = y + hgt * 0.6, a = fadeAt(ly);
            ui.text(e.text.toUpperCase(), cx, ly, size + 4, [FILL[0], FILL[1], FILL[2], Math.floor(255 * a)], 0.5, 0.5, 3);
            const tw = textWidth(e.text.toUpperCase(), size + 4);
            ui.rect(cx - tw / 2 - 40, ly + size, tw + 80, 1.5, [FILL[0], FILL[1], FILL[2], Math.floor(120 * a)]);
          }
          break;
        }
        case 'line': {
          const sz = e.size ?? size, c = e.color ?? WHITE;
          const lines = wrapText(e.text, sz, Math.min(w * 0.8, 820));
          hgt = lines.length * sz * 1.5 + 4;
          if (visible(y, hgt)) lines.forEach((s, i) => { const ly = y + (i + 0.5) * sz * 1.5, a = fadeAt(ly); ui.text(s, cx, ly, sz, [c[0], c[1], c[2], Math.floor(235 * a)], 0.5, 0.5, 2); });
          break;
        }
        case 'pair': {
          const rightW = narrow ? w * 0.5 : Math.min(w * 0.42, 460);
          const lines = wrapText(e.right, size, rightW);
          hgt = Math.max(1, lines.length) * rowH + 6;
          if (visible(y, hgt)) {
            const ly = y + rowH / 2, a = fadeAt(ly);
            ui.text(e.left, cx - colGap, ly, size, [GREY[0], GREY[1], GREY[2], Math.floor(235 * a)], 1, 0.5, 2);
            lines.forEach((s, i) => { const yy = ly + i * rowH; ui.text(s, cx + colGap, yy, size, [255, 255, 255, Math.floor(235 * fadeAt(yy))], 0, 0.5, 2); });
          }
          break;
        }
        case 'cast': {
          const ph = e.big ? Math.min(150, h * 0.22) : 68;
          hgt = ph + rowH * 2.4 + 12;
          if (visible(y, hgt)) {
            // Live Lotties, side by side, above the name.
            const items = e.who.map((k) => this.castAnim(k));
            const widths = items.map((c) => (ph * c.w) / c.h), total = widths.reduce((s, v) => s + v + 14, -14);
            let x = cx - total / 2;
            const a = fadeAt(y + ph / 2);
            items.forEach((c, i) => {
              setFrame(c.anim, (this.clock * 30) % c.frames);
              c.anim.picture.visible(true).size(widths[i], ph).translate(x, y).opacity(Math.floor(255 * a));
              shown.add(e.who[i]);
              x += widths[i] + 14;
            });
            const ny = y + ph + rowH * 0.9, a2 = fadeAt(ny);
            ui.text(e.name, cx, ny, size + 2, [255, 255, 255, Math.floor(255 * a2)], 0.5, 0.5, 2);
            ui.text(e.role, cx, ny + rowH, size - 2, [GREY[0], GREY[1], GREY[2], Math.floor(235 * fadeAt(ny + rowH))], 0.5, 0.5, 2);
          }
          break;
        }
        case 'end': {
          hgt = h;
          const want = h * 0.42;
          // The last card parks in the middle of the screen; the scroll stops there.
          if (y <= want && this.endHold < 0) this.endHold = 0;
          if (this.endHold >= 0) { this.endHold += dt; y = want; }
          const big = Math.min(64, w / 10), a = this.endHold >= 0 ? 1 : fadeAt(y);
          ui.text('THE END', cx, y, big, [255, 255, 255, Math.floor(255 * a)], 0.5, 0.5, 5);
          ui.text('The Outline is free. The world is still being drawn.', cx, y + big * 0.9, size, [STROKE[0], STROKE[1], STROKE[2], Math.floor(235 * a)], 0.5, 0.5, 2);
          if (this.endHold > 1.2) {
            const blink = 0.55 + 0.45 * Math.sin(this.endHold * 3);
            ui.text('press any key to go home', cx, y + big * 0.9 + rowH * 2, size - 1, [255, 255, 255, Math.floor(220 * blink)], 0.5, 0.5, 2);
            if (input.pressed.size > 0 || input.clicked[0] || this.endHold > 12) this.setPhase('leave');
          }
          break;
        }
      }
      y += hgt;
    }
  }

  // ------------------------------------------------------------------ music

  /** A slow pentatonic arpeggio over a drone; sparse during the poem, fuller for the credits. */
  private music(dt: number, mode: 'poem' | 'credits') {
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];
    this.musicT -= dt; this.bassT -= dt;
    if (this.musicT <= 0) {
      const step = mode === 'poem' ? 1.6 + this.rnd() * 1.2 : 0.5;
      this.musicT = step;
      // Random walk over the scale so it never quite repeats.
      this.musicI = clamp(this.musicI + (this.rnd() < 0.5 ? -1 : 1) * (this.rnd() < 0.3 ? 2 : 1), 0, scale.length - 1);
      this.sfx.note(scale[this.musicI], mode === 'poem' ? 2.4 : 1.1, mode === 'poem' ? 0.035 : 0.045, mode === 'poem' ? 'sine' : 'triangle');
    }
    if (this.bassT <= 0) { this.bassT = mode === 'poem' ? 6 : 4; this.sfx.note(this.rnd() < 0.5 ? 65.41 : 98.0, mode === 'poem' ? 5.5 : 3.8, 0.07, 'sine'); }
  }
}
