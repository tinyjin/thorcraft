// Small math toolbox: hashing, seeded RNG, gradient noise.

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** Integer hash of up to three coordinates plus a seed, returns 0..1. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Classic Perlin gradient noise (2D and 3D) with a seeded permutation table. */
export class Noise {
  private p = new Uint8Array(512);

  constructor(seed: number) {
    const rnd = mulberry32(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }

  private static grad2(h: number, x: number, y: number) {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }

  private static grad3(h: number, x: number, y: number, z: number) {
    const hh = h & 15;
    const u = hh < 8 ? x : y;
    const v = hh < 4 ? y : hh === 12 || hh === 14 ? x : z;
    return ((hh & 1) === 0 ? u : -u) + ((hh & 2) === 0 ? v : -v);
  }

  n2(x: number, y: number): number {
    const p = this.p;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(Noise.grad2(aa, xf, yf), Noise.grad2(ba, xf - 1, yf), u);
    const x2 = lerp(Noise.grad2(ab, xf, yf - 1), Noise.grad2(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v); // roughly -1..1
  }

  n3(x: number, y: number, z: number): number {
    const p = this.p;
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(
      lerp(
        lerp(Noise.grad3(p[AA], xf, yf, zf), Noise.grad3(p[BA], xf - 1, yf, zf), u),
        lerp(Noise.grad3(p[AB], xf, yf - 1, zf), Noise.grad3(p[BB], xf - 1, yf - 1, zf), u), v),
      lerp(
        lerp(Noise.grad3(p[AA + 1], xf, yf, zf - 1), Noise.grad3(p[BA + 1], xf - 1, yf, zf - 1), u),
        lerp(Noise.grad3(p[AB + 1], xf, yf - 1, zf - 1), Noise.grad3(p[BB + 1], xf - 1, yf - 1, zf - 1), u), v),
      w);
  }

  /** Fractal 2D noise, normalized to about -1..1. */
  fbm2(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.n2(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
