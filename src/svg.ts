// SVG artwork for the sky, authored in code and loaded through ThorVG's SVG loader. Unlike the
// block world these are real vector pictures: gradients, rounded shapes, clip paths.

import { mulberry32 } from './math';

/** Blocky sun: gradient core with chunky rays. */
export function sunSvg(): string {
  let rays = '';
  for (let i = 0; i < 8; i++) rays += `<rect x="-7" y="-62" width="14" height="20" rx="2" fill="#ffe38a" transform="rotate(${i * 45})"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128" width="128" height="128">
<defs><radialGradient id="g" cx="0" cy="0" r="40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fffbe0"/><stop offset="0.6" stop-color="#ffe680"/><stop offset="1" stop-color="#ffb84a"/></radialGradient></defs>
${rays}<rect x="-34" y="-34" width="68" height="68" rx="6" fill="url(#g)"/><rect x="-26" y="-26" width="20" height="12" rx="3" fill="#ffffff" opacity="0.55"/></svg>`;
}

export const MOON_PHASES = 8;

/** Square moon with craters; the shadow slides across it with the phase (0 = full, 4 = new). */
export function moonSvg(phase: number): string {
  // Lit fraction and which side the shadow sits on.
  const f = phase <= 4 ? phase / 4 : (8 - phase) / 4, w = 72 * f;
  const x = phase <= 4 ? 36 - w : -36;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-48 -48 96 96" width="96" height="96">
<defs><linearGradient id="m" x1="0" y1="-36" x2="0" y2="36" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f4f7ff"/><stop offset="1" stop-color="#c3cbe0"/></linearGradient>
<clipPath id="c"><rect x="-36" y="-36" width="72" height="72" rx="7"/></clipPath></defs>
<rect x="-36" y="-36" width="72" height="72" rx="7" fill="url(#m)"/>
<g fill="#a9b3cc"><rect x="-24" y="-22" width="16" height="12" rx="3"/><rect x="6" y="-6" width="20" height="16" rx="4"/><rect x="-20" y="12" width="12" height="10" rx="3"/><rect x="14" y="-28" width="8" height="8" rx="2"/></g>
<rect x="${x}" y="-36" width="${w}" height="72" fill="#0a0e24" opacity="0.88" clip-path="url(#c)"/></svg>`;
}

export const CLOUD_VARIANTS = 3;

/** Puffy cloud built from overlapping rounded blocks, lit from above. */
export function cloudSvg(variant: number): string {
  const rnd = mulberry32(977 + variant * 131);
  let top = '', bottom = '';
  const n = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const w = 60 + rnd() * 70, h = 26 + rnd() * 26, x = 10 + (i / (n - 1)) * (300 - w - 20) + (rnd() - 0.5) * 20, y = 96 - h - rnd() * 14;
    top += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="12"/>`;
    bottom += `<rect x="${(x + 6).toFixed(1)}" y="${(y + h - 10).toFixed(1)}" width="${(w - 12).toFixed(1)}" height="16" rx="8"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" width="300" height="120">
<defs><linearGradient id="c" x1="0" y1="30" x2="0" y2="110" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe9fb"/></linearGradient></defs>
<g fill="#b9c8e6" opacity="0.9">${bottom}</g><g fill="url(#c)">${top}</g></svg>`;
}
