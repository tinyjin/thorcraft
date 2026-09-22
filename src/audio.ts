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

  get volume() { return this.vol; }
  set volume(v: number) { this.vol = v; if (this.master) this.master.gain.value = v; }

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
    } catch { this.ctx = null; }
  }

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
