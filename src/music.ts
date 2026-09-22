// Background music, composed in code and played by a small WebAudio sequencer (no audio assets).
//
// Like Minecraft, music is occasional: a track plays, then minutes of silence pass before the next one is drawn
// from the pool that fits the moment (title, overworld day, night, rain, the Ember Depths, the Vector Void).
// Changing dimension or leaving the title fades the current track out and starts a fitting one soon after; day
// turning into night never interrupts a track. Every instrument is synthesized: a soft piano, glassy bells, a
// detuned pad, a round bass and a low pulse, all through a generated convolution reverb.

import { Sfx } from './audio';

export type MusicContext = 'none' | 'title' | 'day' | 'night' | 'rain' | 'ember' | 'void';

type Inst = 'piano' | 'bell' | 'pad' | 'bass' | 'pulse';
interface Ev { t: number; inst: Inst; f: number; d: number; g: number; pan: number }

interface Track {
  id: string; name: string; bpm: number;
  /** Chord progression, cycled for the whole track: "Cmaj7 Em7:8 Fmaj7/A". Beats default to 4. */
  chords: string; chordOct: number; bassOct: number;
  /** Melody sections by letter; `form` lists sections in order ("intro"/"outro" carry no melody). */
  melodies: Record<string, string>; form: string[];
  pad: number; arp: 'up' | 'updown' | 'none'; arpDiv: number; arpGain: number; bass: number; melody: 'piano' | 'bell'; melodyGain: number; pulse: number;
}

const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], '5': [0, 7], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], dim: [0, 3, 6], m7b5: [0, 3, 6, 10],
};
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const pitch = (name: string, oct: number) => { const m = /^([A-G])(#|b)?$/.exec(name)!; return (oct + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };

// ---------------------------------------------------------------- the songs
// Melody notation: "E5:2 G5 A5 | -:1" = note:beats (1 beat by default), "-" rests, bars are decoration.

export const TRACKS: Track[] = [
  {
    id: 'dawn', name: 'Vector Dawn', bpm: 70, chordOct: 4, bassOct: 2,
    chords: 'Fmaj7 Am7 Bbmaj7 C6 Dm7 Bbmaj7 Fmaj7 Csus4',
    melodies: {
      A: 'A4 C5 F5:2 | E5:2 C5:2 | D5 F5 A5:2 | G5:4 | F5 E5 C5:2 | D5:2 A4:2 | C5:3 A4 | F4:4',
      B: 'C5 D5 F5 G5 | A5:2 G5:2 | F5:2 D5 C5 | D5:4 | F5 G5 A5 C6 | Bb5:2 A5:2 | G5:2 F5 E5 | F5:4',
    },
    form: ['intro', 'A', 'B', 'A', 'outro'], pad: 0.05, arp: 'up', arpDiv: 2, arpGain: 0.08, bass: 0.13, melody: 'piano', melodyGain: 0.2, pulse: 0,
  },
  {
    id: 'stroke', name: 'Stroke', bpm: 78, chordOct: 4, bassOct: 2,
    chords: 'Cmaj7 Em7 Fmaj7 G6 Am7 Fmaj7 Cmaj7 Gsus4',
    melodies: {
      A: 'E5:2 G5 A5 | G5:3 E5 | F5:2 A5 C6 | B5:2 G5:2 | A5:1.5 G5:.5 E5:2 | F5 E5 D5:2 | E5:3 -:1 | D5:2 -:2',
      B: 'G5:2 A5 B5 | C6:3 B5 | A5:2 G5 E5 | G5:2 F5:2 | E5:1.5 D5:.5 C5:2 | D5 E5 F5:2 | E5:2 D5:2 | C5:3 -:1',
    },
    form: ['intro', 'A', 'B', 'A', 'B', 'outro'], pad: 0.045, arp: 'updown', arpDiv: 2, arpGain: 0.09, bass: 0.12, melody: 'piano', melodyGain: 0.21, pulse: 0,
  },
  {
    id: 'fill', name: 'Fill', bpm: 92, chordOct: 4, bassOct: 2,
    chords: 'Gadd9 Em7 Cmaj7 Am7 Gadd9 Bm7 Cmaj7 D',
    melodies: {
      A: 'B4 D5 G5:2 | F#5 E5 D5:2 | E5 G5 A5:2 | G5:1.5 F#5:.5 D5:2 | B4 D5 G5:2 | A5 B5 A5:2 | G5:1.5 E5:.5 D5:2 | D5:3 -:1',
      B: 'D5 E5 G5 A5 | B5:2 A5 G5 | A5 G5 E5 D5 | E5:3 -:1 | D5 E5 G5 A5 | B5:2 D6:2 | B5:1.5 A5:.5 G5:2 | G5:3 -:1',
    },
    form: ['intro', 'A', 'B', 'A', 'B', 'outro'], pad: 0.035, arp: 'updown', arpDiv: 4, arpGain: 0.07, bass: 0.12, melody: 'piano', melodyGain: 0.2, pulse: 0,
  },
  {
    id: 'wireframe', name: 'Wireframe Night', bpm: 64, chordOct: 4, bassOct: 2,
    chords: 'Am9 Fmaj7 Cmaj7 G6 Am9 Fmaj7 Em7 E7sus4',
    melodies: {
      A: 'E5:3 C5 | D5:2 B4:2 | C5:3 A4 | B4:4 | A4 C5 E5:2 | D5:3 C5 | B4:2 G4:2 | A4:4',
      B: 'G5:3 E5 | F5:2 E5 D5 | E5:3 C5 | D5:4 | C5 D5 E5 G5 | A5:3 G5 | E5:2 D5:2 | C5:4',
    },
    form: ['intro', 'A', 'B', 'A', 'outro'], pad: 0.06, arp: 'none', arpDiv: 2, arpGain: 0, bass: 0.1, melody: 'piano', melodyGain: 0.17, pulse: 0,
  },
  {
    id: 'ember', name: 'Ember Depths', bpm: 56, chordOct: 3, bassOct: 1,
    chords: 'Dm:8 Bbmaj7:8 Gm6:8 A7sus4:4 Adim:4',
    melodies: {
      A: 'D4:3 F4 E4:4 | -:2 A3:2 D4:4 | C4:2 Bb3:2 A3:4 | G3:8 | D4:3 F4 G4:4 | A4:4 G4:2 F4:2 | E4:2 D4:2 C#4:4 | D4:8',
      B: 'A4:6 -:2 | G4:4 F4:4 | E4:2 F4:2 E4:2 D4:2 | C#4:8 | A3:4 D4:4 | F4:4 E4:2 D4:2 | Bb3:4 A3:4 | D4:8',
    },
    form: ['intro', 'A', 'B', 'outro'], pad: 0.075, arp: 'none', arpDiv: 2, arpGain: 0, bass: 0.14, melody: 'bell', melodyGain: 0.13, pulse: 0.5,
  },
  {
    id: 'outline', name: 'The Outline', bpm: 62, chordOct: 4, bassOct: 2,
    chords: 'Emaj7:8 Cmaj7:8 Amaj7:8 Fmaj7:8',
    melodies: {
      A: 'B4 D#5 G#5 B5 | -:2 F#5:2 | G4 B4 E5 G5 | -:2 D5:2 | A4 C#5 E5 A5 | -:2 G#5:2 | F4 A4 C5 E5 | -:4',
      B: 'G#5:3 F#5 | E5:2 B4:2 | G5:3 E5 | D5:2 B4:2 | A5:3 G#5 | E5:2 C#5:2 | E5:3 C5 | A4:4',
    },
    form: ['intro', 'A', 'B', 'A', 'outro'], pad: 0.055, arp: 'up', arpDiv: 2, arpGain: 0.05, bass: 0.08, melody: 'bell', melodyGain: 0.16, pulse: 0,
  },
];

const POOLS: Record<MusicContext, string[]> = {
  none: [], title: ['dawn'], day: ['stroke', 'fill', 'dawn'], night: ['wireframe'], rain: ['wireframe', 'stroke'], ember: ['ember'], void: ['outline'],
};
/** Contexts that stop a running track: everything except a change of daylight or weather. */
const world = (c: MusicContext) => (c === 'day' || c === 'night' || c === 'rain' ? 'overworld' : c);

// ---------------------------------------------------------------- arrangement

/** Expands a track into timed note events (seconds from the start). */
export function arrange(tr: Track, rnd: () => number): { events: Ev[]; length: number } {
  const beat = 60 / tr.bpm, ev: Ev[] = [];
  const chords = tr.chords.split(/\s+/).map((tok) => {
    const [body, beats] = tok.split(':');
    const [chord, slash] = body.split('/');
    const m = /^([A-G][#b]?)(.*)$/.exec(chord)!;
    const root = pitch(m[1], tr.chordOct), tones = (QUALITY[m[2]] ?? QUALITY['']).map((i) => root + i);
    return { tones, bass: slash ? pitch(slash, tr.bassOct) : pitch(m[1], tr.bassOct), beats: beats ? Number(beats) : 4 };
  });
  const loopBeats = chords.reduce((s, c) => s + c.beats, 0);
  /** The chord sounding at beat `b` and how many beats of it remain. */
  const chordAt = (b: number) => { let t = b % loopBeats; for (const c of chords) { if (t < c.beats) return { c, rem: c.beats - t }; t -= c.beats; } return { c: chords[0], rem: chords[0].beats }; };

  let cursor = 0; // beats
  const harmony = (from: number, to: number, withArp: boolean) => {
    // Pad and bass follow the chord changes; the arpeggio walks the chord tones.
    let b = from;
    while (b < to) {
      const { c, rem } = chordAt(b), start = b;
      const len = Math.min(rem, to - b);
      if (tr.pad > 0) for (const m of c.tones) ev.push({ t: start * beat, inst: 'pad', f: midiFreq(m), d: len * beat, g: tr.pad / Math.sqrt(c.tones.length), pan: 0 });
      if (tr.bass > 0) { ev.push({ t: start * beat, inst: 'bass', f: midiFreq(c.bass), d: Math.min(len, 3.5) * beat, g: tr.bass, pan: 0 }); if (len >= 4 && rnd() < 0.5) ev.push({ t: (start + len - 1) * beat, inst: 'bass', f: midiFreq(c.bass + 7), d: 0.9 * beat, g: tr.bass * 0.6, pan: 0 }); }
      if (withArp && tr.arp !== 'none') {
        const seq = tr.arp === 'up' ? c.tones : [...c.tones, ...c.tones.slice(1, -1).reverse()];
        const step = 1 / tr.arpDiv;
        for (let k = 0; k * step < len; k++) {
          const m = seq[k % seq.length] + (k % seq.length === 0 && k > 0 && rnd() < 0.25 ? 12 : 0);
          ev.push({ t: (start + k * step) * beat + (rnd() - 0.5) * 0.008, inst: 'piano', f: midiFreq(m), d: step * beat * 1.4, g: tr.arpGain * (k % tr.arpDiv === 0 ? 1 : 0.7) * (0.9 + rnd() * 0.1), pan: -0.3 });
        }
      }
      if (tr.pulse > 0) for (let k = 0; k < len; k += 2) ev.push({ t: (start + k) * beat, inst: 'pulse', f: 55, d: 0.5, g: tr.pulse * (k % 4 === 0 ? 1 : 0.6), pan: 0 });
      b += len;
    }
  };
  const melody = (src: string, at: number) => {
    let b = at, last = 0;
    for (const tok of src.split(/\s+/)) {
      if (!tok || tok === '|') continue;
      const [note, dur] = tok.split(':'), len = dur ? Number(dur) : 1;
      if (note !== '-') {
        const m = /^([A-G][#b]?)(\d)$/.exec(note)!;
        const midi = pitch(m[1], Number(m[2]));
        ev.push({ t: b * beat + (rnd() - 0.5) * 0.012, inst: tr.melody, f: midiFreq(midi), d: len * beat, g: tr.melodyGain * (0.82 + rnd() * 0.18) * (midi > last ? 1 : 0.93), pan: 0.15 });
        last = midi;
      }
      b += len;
    }
    return b - at;
  };

  for (const sec of tr.form) {
    if (sec === 'intro') { harmony(cursor, cursor + loopBeats, true); cursor += loopBeats; continue; }
    if (sec === 'outro') {
      const { c } = chordAt(0);
      for (const m of c.tones) ev.push({ t: cursor * beat, inst: 'pad', f: midiFreq(m), d: 8 * beat, g: tr.pad * 1.2 / Math.sqrt(c.tones.length), pan: 0 });
      if (tr.bass > 0) ev.push({ t: cursor * beat, inst: 'bass', f: midiFreq(c.bass), d: 6 * beat, g: tr.bass, pan: 0 });
      ev.push({ t: cursor * beat + 0.05, inst: tr.melody, f: midiFreq(c.tones[0] + 12), d: 6 * beat, g: tr.melodyGain * 0.6, pan: 0.15 });
      cursor += 8; continue;
    }
    const len = melody(tr.melodies[sec], cursor);
    harmony(cursor, cursor + len, true);
    cursor += len;
  }
  for (const e of ev) if (e.t < 0) e.t = 0; // humanized timing can nudge the first notes before the start
  ev.sort((a, b) => a.t - b.t);
  return { events: ev, length: cursor * beat + 3 };
}

// ---------------------------------------------------------------- player

const GAP_MIN = 150, GAP_MAX = 420; // silence between tracks, seconds
const LOOKAHEAD = 0.6;

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null; private reverb: ConvolverNode | null = null; private dry: GainNode | null = null;
  private trackGain: GainNode | null = null;
  private track: Track | null = null; private events: Ev[] = []; private next = 0; private startAt = 0; private endAt = 0;
  private context: MusicContext = 'none';
  private nextAt = 0; // audio clock time when a new track may start
  private lastId = '';
  private vol = 0.6;
  private rnd = Math.random;
  /** Called with the track name when one starts. */
  onPlay: ((name: string) => void) | null = null;

  constructor(private sfx: Sfx) {}

  get volume() { return this.vol; }
  set volume(v: number) { this.vol = v; if (this.out && this.ctx) this.out.gain.setTargetAtTime(v * 0.9, this.ctx.currentTime, 0.1); }
  get playing() { return this.track ? this.track.name : ''; }

  private ensure(): boolean {
    if (this.ctx) return true;
    const ctx = this.sfx.context;
    if (!ctx) return false;
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = this.vol * 0.9; this.out.connect(ctx.destination);
    // A hall built from decaying noise: long enough to glue the sparse notes together.
    const len = Math.floor(ctx.sampleRate * 2.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1); }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.42;
    this.reverb.connect(wet).connect(this.out);
    this.dry = ctx.createGain(); this.dry.gain.value = 1; this.dry.connect(this.out);
    return true;
  }

  /** Per frame. Picks, schedules and retires tracks; `ctx` says what music fits right now. */
  update(want: MusicContext) {
    if (!this.ensure()) return;
    const ctx = this.ctx!, now = ctx.currentTime;
    if (want !== this.context) {
      const hard = world(want) !== world(this.context) || want === 'none';
      if (hard && this.track) this.fadeOut(2.5);
      if (hard) this.nextAt = now + (want === 'title' ? 1.5 : want === 'none' ? 1e9 : 6 + this.rnd() * 20);
      else if (!this.track && this.context === 'none') this.nextAt = Math.min(this.nextAt, now + 10 + this.rnd() * 30);
      this.context = want;
    }
    if (this.track) {
      // Schedule everything due within the lookahead window.
      while (this.next < this.events.length && this.startAt + this.events[this.next].t < now + LOOKAHEAD) { this.play(this.events[this.next], this.startAt + this.events[this.next].t); this.next++; }
      if (now > this.endAt) { this.track = null; this.nextAt = now + GAP_MIN + this.rnd() * (GAP_MAX - GAP_MIN); }
      return;
    }
    if (want === 'none' || now < this.nextAt) return;
    const pool = POOLS[want].filter((id) => id !== this.lastId || POOLS[want].length === 1);
    this.start(TRACKS.find((t) => t.id === pool[Math.floor(this.rnd() * pool.length)])!);
  }

  private start(tr: Track) {
    const ctx = this.ctx!;
    const { events, length } = arrange(tr, this.rnd);
    this.track = tr; this.lastId = tr.id; this.events = events; this.next = 0;
    this.startAt = ctx.currentTime + 0.15; this.endAt = this.startAt + length;
    this.trackGain = ctx.createGain(); this.trackGain.gain.value = 1;
    this.trackGain.connect(this.dry!); this.trackGain.connect(this.reverb!);
    this.onPlay?.(tr.name);
  }

  private fadeOut(seconds: number) {
    const g = this.trackGain, ctx = this.ctx;
    if (g && ctx) { g.gain.setTargetAtTime(0, ctx.currentTime, seconds / 4); setTimeout(() => g.disconnect(), seconds * 1000 + 500); }
    this.track = null; this.trackGain = null;
  }

  /** Fades the current track out and waits the usual gap before the next. */
  skip() { if (this.track) this.fadeOut(1.5); if (this.ctx) this.nextAt = this.ctx.currentTime + GAP_MIN + this.rnd() * (GAP_MAX - GAP_MIN); }

  /** Starts a track right away: the named one, or the next from the current pool. Returns false for an unknown id. */
  playNow(id?: string): boolean {
    if (!this.ensure()) return false;
    const tr = id ? TRACKS.find((t) => t.id === id) : TRACKS.find((t) => t.id === (POOLS[this.context].filter((p) => p !== this.lastId)[0] ?? POOLS[this.context][0] ?? 'stroke'));
    if (!tr) return false;
    if (this.track) this.fadeOut(1);
    this.start(tr);
    return true;
  }

  trackIds() { return TRACKS.map((t) => t.id); }

  // ---------------------------------------------------------------- instruments

  private play(e: Ev, t: number) {
    const ctx = this.ctx!, bus = this.trackGain;
    if (!bus) return;
    const pan = ctx.createStereoPanner(); pan.pan.value = e.pan; pan.connect(bus);
    const g = ctx.createGain(); g.connect(pan);
    const osc = (type: OscillatorType, f: number, gain: number, stop: number, detune = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; const og = ctx.createGain(); og.gain.value = gain; o.connect(og).connect(g); o.start(t); o.stop(stop); };
    switch (e.inst) {
      case 'piano': {
        // Hammer-like attack, quick settle, long tail: a triangle with an octave partial through a closing filter.
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.5); lp.Q.value = 0.5;
        g.disconnect(); g.connect(lp).connect(pan);
        const end = t + e.d + 1.2;
        osc('triangle', e.f, 1, end, 2); osc('sine', e.f * 2, 0.28, end, -3); osc('sine', e.f * 3, 0.06, t + 0.4);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(e.g, t + 0.006); g.gain.exponentialRampToValueAtTime(e.g * 0.3, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0008, end);
        break;
      }
      case 'bell': {
        const end = t + Math.max(e.d, 1.2) + 1.6;
        osc('sine', e.f, 1, end); osc('sine', e.f * 2.0, 0.35, end); osc('sine', e.f * 2.76, 0.12, t + 0.6); osc('sine', e.f * 5.4, 0.05, t + 0.25);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(e.g, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, end);
        break;
      }
      case 'pad': {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 760; lp.Q.value = 0.7;
        g.disconnect(); g.connect(lp).connect(pan);
        const end = t + e.d + 2.4;
        osc('sawtooth', e.f, 0.5, end, 7); osc('sawtooth', e.f, 0.5, end, -7); osc('sine', e.f * 0.5, 0.35, end);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(e.g, t + Math.min(1.4, e.d * 0.4)); g.gain.setValueAtTime(e.g, t + e.d - 0.2); g.gain.exponentialRampToValueAtTime(0.0008, end);
        break;
      }
      case 'bass': {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
        g.disconnect(); g.connect(lp).connect(pan);
        const end = t + e.d + 0.4;
        osc('sine', e.f, 1, end); osc('triangle', e.f, 0.45, end); osc('sine', e.f * 2, 0.15, end);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(e.g, t + 0.02); g.gain.setValueAtTime(e.g, t + e.d * 0.6); g.gain.exponentialRampToValueAtTime(0.0008, end);
        break;
      }
      case 'pulse': {
        // A distant drum: a pitch drop and a thump of filtered noise.
        const end = t + 0.5;
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.3);
        o.connect(g); o.start(t); o.stop(end);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(e.g * 0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, end);
        break;
      }
    }
  }
}
