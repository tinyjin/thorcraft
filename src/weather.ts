// Weather: the overworld's rain, snow and thunderstorms.
//
// The schedule follows Minecraft: two independent countdowns flip "raining" and "thundering" on and off, and a
// thunderstorm is simply rain while both are set. The visible strength eases in and out over several seconds so
// the sky, fog, light and sound all change together. Where it rains depends on the biome under each drop: cold
// biomes and mountain tops get snow, deserts get nothing but the gloom. Precipitation is drawn through the block
// renderer's depth buckets (thin camera facing quads), so roofs, hills and trees hide it like any other geometry.

import { B } from './blocks';
import { clamp } from './math';
import { Camera, Renderer3D } from './renderer';
import { palette } from './blocks';
import { Biome, SEA, Terrain, World } from './world';

export type WeatherKind = 'clear' | 'rain' | 'thunder';
export type Precip = 0 | 1 | 2; // none, rain, snow

export interface WeatherSave { raining: boolean; rainTimer: number; thundering: boolean; thunderTimer: number; strength: number }

export interface WeatherHooks {
  /** Thunder heard `dist` blocks away (the sound is delayed and softened by distance). */
  thunder(dist: number): void;
  /** A screen flash and a camera shake, both 0..1. */
  flash(amount: number): void; shake(amount: number): void;
  /** Lightning hit the ground here: hurt whatever stands within `radius`. */
  strike(x: number, y: number, z: number, radius: number): void;
  /** A rain drop hit the ground (a small splash particle). */
  splash(x: number, y: number, z: number): void;
  /** A drop falling from a roof edge, heard from shelter. */
  drip(): void;
}

// Durations in seconds. A day lasts 720 s; Minecraft's clear spells (0.5 - 7.5 days) are shortened so a session sees weather.
const CLEAR_MIN = 240, CLEAR_MAX = 900;
const RAIN_MIN = 120, RAIN_MAX = 420;
const CALM_MIN = 600, CALM_MAX = 2400;
const STORM_MIN = 90, STORM_MAX = 300;
const FADE_IN = 1 / 9, FADE_OUT = 1 / 14; // strength change per second

const RAIN_SPEED = 16, SNOW_SPEED = 1.5;
const RADIUS = 14, ABOVE = 14, BELOW = 6;

interface Bolt { x: number; y: number; z: number; seed: number; age: number }

export class Weather {
  raining = false; thundering = false;
  rainTimer = CLEAR_MIN + Math.random() * (CLEAR_MAX - CLEAR_MIN);
  thunderTimer = CALM_MIN + Math.random() * (CALM_MAX - CALM_MIN);
  /** Eased precipitation strength 0..1 and thunderstorm level 0..1 (only ever above 0 while it rains). */
  strength = 0; thunder = 0;
  /** Lightning glare, 1 right after a strike, gone in a fraction of a second. */
  flash = 0;
  wind: [number, number] = [0.4, 0];
  private windAngle = Math.random() * 6.28; private gust = 0; private gustTimer = 0;
  bolts: Bolt[] = [];
  private strikeTimer = 5;
  /** What falls at the camera: drives the ambient sound. */
  localPrecip: Precip = 1;
  /** 1 when the camera stands under something (rain is heard through a roof, snow is not seen). */
  sheltered = 0;
  private dripTimer = 0;
  private tickTimer = 0;

  // Drop pool: x, y, z, ground y, phase; precipitation type per drop.
  private readonly max: number;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array; private pg: Float32Array; private pp: Float32Array;
  private pt: Uint8Array;
  private live = 0;
  private precipCache = new Map<number, Precip>();
  private cacheTimer = 0;
  private tmp: Terrain = { h: 0, biome: 0, temp: 0, hum: 0 };

  constructor(maxDrops = 420) {
    this.max = maxDrops;
    this.px = new Float32Array(maxDrops); this.py = new Float32Array(maxDrops); this.pz = new Float32Array(maxDrops);
    this.pg = new Float32Array(maxDrops); this.pp = new Float32Array(maxDrops); this.pt = new Uint8Array(maxDrops);
    for (let i = 0; i < maxDrops; i++) { this.pg[i] = -1e9; this.pp[i] = Math.random() * 6.28; }
  }

  get kind(): WeatherKind { return !this.raining ? 'clear' : this.thundering ? 'thunder' : 'rain'; }
  /** Cloud cover 0..1: thickens a little ahead of the rain and lingers after it. */
  get overcast() { return clamp(this.strength * 1.35, 0, 1); }

  save(): WeatherSave { return { raining: this.raining, rainTimer: this.rainTimer, thundering: this.thundering, thunderTimer: this.thunderTimer, strength: this.strength }; }
  load(s: WeatherSave | undefined) {
    if (!s) return;
    this.raining = !!s.raining; this.rainTimer = s.rainTimer > 0 ? s.rainTimer : 60;
    this.thundering = !!s.thundering; this.thunderTimer = s.thunderTimer > 0 ? s.thunderTimer : 60;
    this.strength = clamp(s.strength ?? (this.raining ? 1 : 0), 0, 1);
    this.thunder = this.raining && this.thundering ? 1 : 0;
  }

  /** Console / command control. `duration` in seconds, or the usual random span. */
  set(kind: WeatherKind, duration?: number) {
    const span = (lo: number, hi: number) => duration ?? lo + Math.random() * (hi - lo);
    if (kind === 'clear') { this.raining = false; this.thundering = false; this.rainTimer = span(CLEAR_MIN, CLEAR_MAX); this.thunderTimer = span(CALM_MIN, CALM_MAX); }
    else { this.raining = true; this.rainTimer = span(RAIN_MIN, RAIN_MAX); this.thundering = kind === 'thunder'; this.thunderTimer = kind === 'thunder' ? span(STORM_MIN, STORM_MAX) : span(CALM_MIN, CALM_MAX); }
  }

  /** What falls on a column: snow in cold biomes and on the peaks, nothing over the desert, rain elsewhere. */
  precipAt(world: World, x: number, z: number): Precip {
    const kx = Math.floor(x) >> 2, kz = Math.floor(z) >> 2, key = kx * 131072 + kz;
    let p = this.precipCache.get(key);
    if (p === undefined) {
      const t = world.terrain(kx * 4 + 2, kz * 4 + 2, this.tmp);
      p = t.biome === Biome.DESERT ? 0 : t.temp < -0.25 || t.biome === Biome.PEAKS ? 2 : 1;
      if (this.precipCache.size > 4000) this.precipCache.clear();
      this.precipCache.set(key, p);
    }
    return p;
  }

  /**
   * Advances the schedule, wind, drops and lightning. `active` is false outside the overworld (the clocks keep
   * running there, as in Minecraft, but nothing falls). The camera position picks where drops live.
   */
  update(dt: number, time: number, world: World, cam: Camera, active: boolean, hooks: WeatherHooks) {
    // Schedule
    this.rainTimer -= dt;
    if (this.rainTimer <= 0) { this.raining = !this.raining; this.rainTimer = this.raining ? RAIN_MIN + Math.random() * (RAIN_MAX - RAIN_MIN) : CLEAR_MIN + Math.random() * (CLEAR_MAX - CLEAR_MIN); }
    this.thunderTimer -= dt;
    if (this.thunderTimer <= 0) { this.thundering = !this.thundering; this.thunderTimer = this.thundering ? STORM_MIN + Math.random() * (STORM_MAX - STORM_MIN) : CALM_MIN + Math.random() * (CALM_MAX - CALM_MIN); }
    const wantRain = this.raining ? 1 : 0, wantThunder = this.raining && this.thundering ? 1 : 0;
    this.strength = clamp(this.strength + (wantRain > this.strength ? FADE_IN : -FADE_OUT) * dt, 0, 1);
    this.thunder = clamp(this.thunder + (wantThunder > this.thunder ? FADE_IN * 1.5 : -FADE_OUT * 1.5) * dt, 0, 1);
    if (this.strength <= 0) this.thunder = 0;
    this.flash = Math.max(0, this.flash - dt * 5);

    // Wind: a slow random walk in direction, stronger in storms, with gusts.
    this.windAngle += (Math.random() - 0.5) * dt * 0.6;
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) { this.gustTimer = 2 + Math.random() * 6; this.gust = Math.random() * (0.5 + this.strength * 1.5); }
    this.gust = Math.max(0, this.gust - dt * 0.35);
    const speed = 0.3 + this.strength * 1.6 + this.thunder * 2.2 + this.gust;
    this.wind[0] += (Math.cos(this.windAngle) * speed - this.wind[0]) * Math.min(1, dt * 0.5);
    this.wind[1] += (Math.sin(this.windAngle) * speed - this.wind[1]) * Math.min(1, dt * 0.5);

    this.cacheTimer -= dt;
    if (this.cacheTimer <= 0) { this.cacheTimer = 3; this.precipCache.clear(); }

    const cx = cam.x, cy = cam.y, cz = cam.z;
    const loaded = world.isLoaded(cx, cz);
    this.localPrecip = active && loaded ? this.precipAt(world, cx, cz) : 0;
    let shelter = 0;
    if (!active || !loaded) shelter = 1;
    else { const top = world.topAt(Math.floor(cx), Math.floor(cz)); shelter = cy < top ? 1 : 0; }
    this.sheltered += (shelter - this.sheltered) * Math.min(1, dt * 3);

    // Drips from the eaves while sheltered from rain.
    if (this.sheltered > 0.5 && this.strength > 0.2 && this.localPrecip === 1) {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) { this.dripTimer = 0.4 + Math.random() * 2.5 / this.strength; hooks.drip(); }
    }

    // Drops
    const want = active && this.strength > 0.02 ? Math.floor(this.max * (0.25 + 0.75 * this.strength)) : 0;
    this.live = want;
    const wx = this.wind[0], wz = this.wind[1];
    for (let i = 0; i < want; i++) {
      if (this.pg[i] < -1e8) { if (!this.spawn(i, world, cx, cy, cz, true)) continue; }
      const snow = this.pt[i] === 2;
      if (snow) {
        const sway = Math.sin(this.pp[i] + time * 1.2) * 0.5;
        this.px[i] += (wx * 0.5 + sway) * dt; this.pz[i] += (wz * 0.5 + Math.cos(this.pp[i] * 1.3 + time * 0.9) * 0.4) * dt;
        this.py[i] -= SNOW_SPEED * (0.8 + 0.4 * Math.sin(this.pp[i])) * dt;
      } else {
        this.px[i] += wx * dt; this.pz[i] += wz * dt;
        this.py[i] -= RAIN_SPEED * dt;
      }
      const dx = this.px[i] - cx, dz = this.pz[i] - cz;
      const out = dx * dx + dz * dz > (RADIUS + 3) * (RADIUS + 3) || this.py[i] > cy + ABOVE + 4 || this.py[i] < cy - BELOW - 4;
      if (this.py[i] <= this.pg[i] || out) {
        if (!out && !snow && this.pg[i] > -1e8 && dx * dx + dz * dz < 100 && Math.random() < 0.35) hooks.splash(this.px[i], this.pg[i], this.pz[i]);
        this.spawn(i, world, cx, cy, cz, false);
      }
    }
    for (let i = want; i < this.max; i++) this.pg[i] = -1e9;

    // Lightning
    for (const b of this.bolts) b.age += dt;
    this.bolts = this.bolts.filter((b) => b.age < 0.6);
    if (active && this.thunder > 0.3 && this.strength > 0.3) {
      this.strikeTimer -= dt;
      if (this.strikeTimer <= 0) {
        this.strikeTimer = 3 + Math.random() * 11;
        this.lightning(world, cx, cz, hooks);
      }
    }

    // Snow cover and ice, a few random ticks per second near the camera.
    if (active && this.strength > 0.5) {
      this.tickTimer -= dt;
      if (this.tickTimer <= 0) { this.tickTimer = 0.5; this.tickWorld(world, cx, cz); }
    }
  }

  /** Places drop `i` in a column that is open to the sky around the camera. Returns false when none was found. */
  private spawn(i: number, world: World, cx: number, cy: number, cz: number, anywhere: boolean): boolean {
    for (let tries = 0; tries < 4; tries++) {
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * RADIUS;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!world.isLoaded(x, z)) continue;
      const type = this.precipAt(world, x, z);
      if (type === 0) continue;
      const fx = Math.floor(x), fz = Math.floor(z);
      let ground = world.topAt(fx, fz) + 1;
      const sea = world.getBlock(fx, SEA, fz);
      if (ground <= SEA && (sea === B.WATER || sea === B.ICE)) ground = SEA + 1;
      const y = anywhere ? cy - BELOW + Math.random() * (ABOVE + BELOW) : cy + ABOVE - Math.random() * 3;
      if (y < ground) continue; // under a roof or inside the hill
      this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.pg[i] = ground; this.pt[i] = type;
      return true;
    }
    this.pg[i] = -1e9;
    return false;
  }

  private lightning(world: World, cx: number, cz: number, hooks: WeatherHooks) {
    // Mostly far off, sometimes uncomfortably close. Strikes prefer whatever stands tall: the surface column found.
    const near = Math.random() < 0.3;
    const a = Math.random() * 6.28, r = near ? 5 + Math.random() * 14 : 18 + Math.random() * 30;
    const x = Math.floor(cx + Math.cos(a) * r), z = Math.floor(cz + Math.sin(a) * r);
    if (!world.isLoaded(x, z)) return;
    if (this.precipAt(world, x, z) === 0) return;
    let y = world.surfaceY(x, z);
    const sea = world.getBlock(x, SEA, z);
    if (y <= SEA && (sea === B.WATER || sea === B.ICE)) y = SEA + 1;
    const dist = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    this.bolts.push({ x: x + 0.5, y, z: z + 0.5, seed: (Math.random() * 1e9) | 0, age: 0 });
    this.flash = 1;
    hooks.flash(clamp(1.1 - dist / 60, 0.25, 0.8));
    hooks.shake(clamp(0.6 - dist / 40, 0, 0.5));
    hooks.thunder(dist);
    hooks.strike(x + 0.5, y, z + 0.5, 3);
  }

  /** Snow settles on grass and open water freezes over where it snows (Minecraft's weather random ticks). */
  private tickWorld(world: World, cx: number, cz: number) {
    for (let n = 0; n < 6; n++) {
      const x = Math.floor(cx + (Math.random() - 0.5) * 48), z = Math.floor(cz + (Math.random() - 0.5) * 48);
      if (!world.isLoaded(x, z) || this.precipAt(world, x, z) !== 2) continue;
      const top = world.topAt(x, z);
      if (top < 0) continue;
      const id = world.getBlock(x, top, z);
      if (id === B.GRASS && world.getBlock(x, top + 1, z) === B.AIR) { world.setBlock(x, top, z, B.SNOWGRASS); continue; }
      if (top < SEA && world.getBlock(x, SEA, z) === B.WATER) {
        // Ice grows from the shore and from existing ice, not in the open sea.
        let edge = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = world.getBlock(x + dx, SEA, z + dz); if (b === B.ICE || (b !== B.WATER && b !== B.AIR)) edge = true; }
        if (edge) world.setBlock(x, SEA, z, B.ICE);
      }
    }
  }

  /** Draws the drops and any lightning through the depth sorted renderer. Call between `begin` and `end`. */
  draw(r: Renderer3D, night: number, detail: number) {
    const n = Math.min(this.live, Math.floor(this.max * clamp(detail, 0.3, 1)));
    if (n > 0) {
      const lit = 1 - night * 0.55;
      const rainColor = palette.id(150 * lit + 40, 175 * lit + 40, 215 * lit + 40, 160, 0, 1);
      // Drops passing close to the camera project tall and wide: keep those thin and see-through.
      const nearColor = palette.id(170 * lit + 40, 190 * lit + 40, 225 * lit + 40, 70, 0, 1);
      const snowColor = palette.id(235 * lit + 20, 240 * lit + 15, 250 * lit + 5, 235, 0, 1);
      const wx = this.wind[0], wz = this.wind[1];
      // The streak points back along the velocity: mostly up, slanted by the wind.
      const len = 0.85, inv = len / Math.hypot(wx, RAIN_SPEED, wz), sx = -wx * inv, sy = RAIN_SPEED * inv, sz = -wz * inv;
      const cx = r.camX, cy = r.camY, cz = r.camZ;
      for (let i = 0; i < n; i++) {
        if (this.pg[i] < -1e8) continue;
        if (this.pt[i] === 2) { r.drawFlake(this.px[i], this.py[i], this.pz[i], 0.09 + 0.05 * Math.sin(this.pp[i] * 3), snowColor); continue; }
        const dx = this.px[i] - cx, dy = this.py[i] - cy, dz = this.pz[i] - cz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 2.2) continue;
        const near = d2 < 20;
        r.drawStreak(this.px[i], this.py[i], this.pz[i], sx, this.py[i] + sy * (near ? 0.6 : 1), sz, near ? 0.018 : 0.035, near ? nearColor : rainColor);
      }
    }
    for (const b of this.bolts) r.drawBolt(b.x, b.y, b.z, b.seed, b.age);
  }

  /** One line for the debug overlay. */
  describe(): string {
    const next = Math.round(this.rainTimer);
    return `weather ${this.kind} ${this.strength.toFixed(2)}${this.thunder > 0 ? ` storm ${this.thunder.toFixed(2)}` : ''}  ${this.raining ? 'clears' : 'rain'} in ${next}s  wind ${Math.hypot(this.wind[0], this.wind[1]).toFixed(1)}  ${['dry', 'rain', 'snow'][this.localPrecip]}${this.sheltered > 0.5 ? ' (sheltered)' : ''}`;
  }
}
