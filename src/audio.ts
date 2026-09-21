// Tiny synthesized sound effects (no assets).

export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Must be called from a user gesture at least once. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  private burst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx;
    if (!ctx || !this.noise || this.muted) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(0, Math.random() * 0.2, dur);
  }

  private tone(freq: number, to: number, dur: number, gain: number, type: OscillatorType = 'square') {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  }

  dig() { this.burst(0.07, 900 + Math.random() * 500, 1.2, 0.25); }
  breakBlock() { this.burst(0.16, 500 + Math.random() * 200, 0.8, 0.5); }
  place() { this.burst(0.09, 320, 1.5, 0.5); this.tone(180, 90, 0.08, 0.12, 'sine'); }
  step() { this.burst(0.05, 380 + Math.random() * 160, 1, 0.12); }
  hurt() { this.tone(320, 120, 0.22, 0.16, 'sawtooth'); }
  hit() { this.burst(0.08, 1400, 2, 0.3); this.tone(220, 110, 0.1, 0.1); }
  pop() { this.tone(520, 1040, 0.09, 0.1, 'sine'); }
  gem() { this.tone(880, 1760, 0.12, 0.1, 'sine'); setTimeout(() => this.tone(1320, 2640, 0.18, 0.1, 'sine'), 90); }
  fuse() { this.burst(0.5, 3000, 0.6, 0.12, 'highpass'); }
  explode() { this.burst(0.9, 140, 0.4, 1.0, 'lowpass'); this.tone(90, 28, 0.7, 0.5, 'sine'); }
  splash() { this.burst(0.3, 1200, 0.5, 0.25); }
  click() { this.tone(660, 440, 0.05, 0.08); }
  eat() { this.burst(0.08, 700, 2, 0.3); setTimeout(() => this.burst(0.08, 600, 2, 0.3), 120); }
}
