// Tiny synthesized sound effects (no assets).

import { BLOCKS, SoundKind } from './blocks';

const MATERIAL: Record<SoundKind, { f: number; q: number; d: number }> = {
  stone: { f: 900, q: 1.2, d: 0.09 }, wood: { f: 500, q: 2.5, d: 0.11 }, dirt: { f: 320, q: 0.8, d: 0.1 },
  grass: { f: 1600, q: 0.6, d: 0.1 }, sand: { f: 2400, q: 0.5, d: 0.13 }, glass: { f: 3800, q: 5, d: 0.16 }, cloth: { f: 260, q: 0.6, d: 0.1 },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private vol = 0.5;
  // Weather ambience: looping noise through filters whose gain follows the rain and wind strength.
  private rainGain: GainNode | null = null; private rainFilter: BiquadFilterNode | null = null; private rainHigh: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null; private windFilter: BiquadFilterNode | null = null; private windLfo: OscillatorNode | null = null;

  get volume() { return this.vol; }
  set volume(v: number) { this.vol = v; if (this.master) this.master.gain.value = v; }
  /** The shared AudioContext, null until the first user gesture unlocked it. The music player builds its own bus on it. */
  get context() { return this.ctx; }

  /** Must be called from a user gesture at least once. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.vol;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.buildAmbience();
    } catch { this.ctx = null; }
  }

  /** Two endless noise beds: rain (broadband, lowpassed when heard through a roof) and wind (a wandering bandpass). */
  private buildAmbience() {
    const ctx = this.ctx!;
    const loop = () => { const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true; src.start(0, Math.random() * 0.5); return src; };
    this.rainHigh = ctx.createBiquadFilter(); this.rainHigh.type = 'highpass'; this.rainHigh.frequency.value = 400;
    this.rainFilter = ctx.createBiquadFilter(); this.rainFilter.type = 'lowpass'; this.rainFilter.frequency.value = 2200; this.rainFilter.Q.value = 0.4;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    loop().connect(this.rainHigh).connect(this.rainFilter).connect(this.rainGain).connect(this.master!);
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 380; this.windFilter.Q.value = 0.9;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    loop().connect(this.windFilter).connect(this.windGain).connect(this.master!);
    // The wind's pitch wanders slowly, which is what makes noise sound like weather instead of static.
    this.windLfo = ctx.createOscillator(); this.windLfo.type = 'sine'; this.windLfo.frequency.value = 0.09;
    const depth = ctx.createGain(); depth.gain.value = 160;
    this.windLfo.connect(depth).connect(this.windFilter.frequency); this.windLfo.start();
  }

  /**
   * Sets the weather beds. `rain` and `wind` are 0..1 strengths, `shelter` 0..1 muffles the rain (under a roof,
   * underwater) and `snow` swaps the patter for a hiss of wind. Smoothed inside the audio thread.
   */
  ambience(rain: number, wind: number, shelter: number, snow: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.rainGain || !this.windGain || !this.rainFilter || !this.windFilter) return;
    const t = ctx.currentTime, k = 0.4;
    const patter = snow ? 0 : rain;
    this.rainGain.gain.setTargetAtTime(patter * (0.16 - shelter * 0.1), t, k);
    this.rainFilter.frequency.setTargetAtTime(2200 - shelter * 1750, t, k);
    this.windGain.gain.setTargetAtTime(wind * (snow ? 0.13 : 0.09) * (1 - shelter * 0.55), t, k);
    this.windFilter.frequency.setTargetAtTime(snow ? 520 : 380, t, 1.5);
  }

  /** Thunder heard `dist` blocks away: a crack when close, then a rumble that arrives late and lasts longer the further off it is. */
  thunder(dist: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const near = Math.max(0, 1 - dist / 22), loud = Math.max(0.15, 1 - dist / 70);
    const delay = Math.min(2.8, dist / 45) * 1000;
    if (near > 0) { this.burst(0.18, 1800, 0.6, 1.1 * near, 'highpass'); this.burst(0.3, 500, 0.5, 0.9 * near); }
    setTimeout(() => {
      this.burst(2.2 + dist / 40, 90 + near * 60, 0.6, 1.5 * loud, 'lowpass');
      this.tone(60 + near * 30, 22, 1.8 + dist / 60, 0.55 * loud, 'sine');
      setTimeout(() => this.burst(1.6 + dist / 60, 70, 0.5, 0.7 * loud, 'lowpass'), 500 + Math.random() * 600);
    }, delay);
  }

  /** A single drop from the eaves. */
  drip() { this.tone(2200 + Math.random() * 1400, 900, 0.06, 0.05, 'sine'); }

  private burst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(0, Math.random() * 0.5); src.stop(ctx.currentTime + dur + 0.02);
  }

  private tone(freq: number, to: number, dur: number, gain: number, type: OscillatorType = 'square') {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }

  private mat(block: number) { return MATERIAL[BLOCKS[block]?.sound ?? 'stone']; }

  // Material aware block sounds
  step(block: number, vol = 0.4) { if (!block) return; const m = this.mat(block); this.burst(m.d, m.f * (0.85 + Math.random() * 0.3), m.q, 0.25 * vol); }
  dig(block: number) { const m = this.mat(block); this.burst(m.d * 0.8, m.f * (0.9 + Math.random() * 0.2), m.q, 0.22); }
  breakBlock(block: number) { const m = this.mat(block); this.burst(m.d * 2.2, m.f * 0.8, m.q, 0.6); this.burst(m.d * 1.2, m.f * 1.4, m.q, 0.35); }
  place(block: number) { const m = this.mat(block); this.burst(m.d * 1.3, m.f * 0.6, m.q + 1, 0.55); }

  hurt() { this.tone(320, 110, 0.22, 0.3, 'sawtooth'); }
  hit() { this.burst(0.12, 700, 1, 0.5); this.tone(200, 90, 0.12, 0.2); }
  pop() { this.tone(500 + Math.random() * 300, 1200, 0.09, 0.18, 'sine'); }
  gem() { this.tone(880, 1760, 0.12, 0.1, 'sine'); setTimeout(() => this.tone(1320, 2640, 0.18, 0.1, 'sine'), 90); }
  fuse() { this.burst(0.9, 5000, 0.7, 0.25, 'highpass'); }
  explode() { this.burst(1.4, 140, 0.5, 1.6, 'lowpass'); this.burst(0.5, 600, 0.4, 0.7); this.tone(90, 25, 0.9, 0.7, 'sine'); }
  splash() { this.burst(0.3, 1200, 0.5, 0.25); }
  click() { this.tone(900, 700, 0.04, 0.12); }
  eat() { for (let i = 0; i < 3; i++) setTimeout(() => this.burst(0.08, 900, 2, 0.4), i * 110); }
  toolBreak() { this.tone(900, 200, 0.2, 0.2); }
  mob() { this.tone(180 + Math.random() * 80, 120, 0.25, 0.1, 'sawtooth'); }
  /** A soft held note for the ending credits (frequency in Hz). */
  note(freq: number, dur = 1.2, gain = 0.05, type: OscillatorType = 'sine') { this.tone(freq, freq * 0.995, dur, gain, type); }
  /** Deep hum of the portal taking hold. */
  drone() { this.tone(55, 38, 3.5, 0.25, 'sine'); this.tone(110, 82, 2.5, 0.08, 'triangle'); }
}
