// ThorCraft: a voxel sandbox where every pixel is drawn by @thorvg/webcanvas.

import ThorVG from '@thorvg/webcanvas';
import wasmUrl from '../node_modules/@thorvg/webcanvas/dist/thorvg.wasm?url';
import { Sfx } from './audio';
import { B, BLOCKS, CUBE, I, ITEMS, REPLACEABLE, SOLID, TOOL_SPEED, isBlockId } from './blocks';
import { Ending, RunStats, newStats } from './ending';
import { EntityManager, MODELS, Mob, MobKind } from './entities';
import { Fx } from './fx';
import { Hud, HudInfo, Settings, WindowKind } from './hud';
import { Input } from './input';
import { cinderLottie, ghostLottie, glitchLottie, outlineBossLottie, slimeLottie, starItemLottie, villagerLottie } from './lottie';
import { TRADES, Trade } from './trades';
import { VOID_ARRIVAL } from './structures';
import { Lottie3D } from './lottie3d';
import { setFlatArtProvider } from './ui';
import { Furnace, HOTBAR, Inventory, Stack, WindowState, makeStack, tickFurnace } from './inventory';
import { clamp, lerp, smooth } from './math';
import { RayHit, raycast } from './physics';
import { EYE, Player } from './player';
import { installCheats } from './cheats';
import { Camera, Environment, HeldView, Renderer3D } from './renderer';
import { texture } from './textures';
import { BIOME_NAMES, Biome, Dim, SEA, WH, World } from './world';

type State = 'title' | 'loading' | 'playing' | 'paused' | 'window' | 'dead' | 'ending';
type RendererName = 'gl' | 'wg' | 'sw';

const SAVE_KEY = 'thorcraft.save.v2', SETTINGS_KEY = 'thorcraft.settings';
const DAY_LENGTH = 720; // seconds

interface SaveData {
  seedText: string; edits: Record<string, number[]>; creative: boolean; time: number; gems: number; collected: string[];
  spawn: [number, number]; days?: number;
  // Dimensions (optional so older saves keep loading)
  dim?: Dim; editsEmber?: Record<string, number[]>; editsVoid?: Record<string, number[]>; links?: PortalLink[]; boss?: boolean; adv?: string[]; lost?: string[]; stats?: RunStats;
  player: { x: number; y: number; z: number; yaw: number; pitch: number; health: number };
  inv: (Stack | null)[]; selected: number; furnaces: Furnace[];
}

/** An Ember portal pair: `a` stands in the overworld, `b` in the Ember Depths. */
interface PortalLink { a: [number, number, number]; b: [number, number, number] }

/** Advancement titles by id; the credits count them. */
const ADV: Record<string, string> = {
  village: 'Craftstead', trade: 'What a Deal', raid: 'Hero of the Village', portal: 'We Need to Go Deeper', ember: 'Into the Ember Depths',
  voidportal: 'The Vectors Align', void: 'The Vector Void', boss: 'Free the Outline (+25 gems)', home: 'Home Is Where the Chunks Load',
};

function hashString(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h | 0; }

function pickRenderer(): RendererName {
  const q = new URLSearchParams(location.search).get('renderer');
  let r: RendererName = q === 'wg' || q === 'sw' || q === 'gl' ? q : 'gl';
  if (r === 'wg' && !('gpu' in navigator)) r = 'gl';
  if (r === 'gl') {
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2')) r = 'sw';
  }
  return r;
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const rendererName = pickRenderer();
  const TVG: any = await ThorVG.init({ locateFile: () => wasmUrl, renderer: rendererName });

  const fontData = new Uint8Array(await (await fetch('/font.ttf')).arrayBuffer());
  TVG.Font.load('ui', fontData, { type: 'ttf' });
  // The same font is registered with the browser so the HUD can measure text exactly.
  try { const face = new FontFace('thorcraft-ui', fontData.buffer.slice(0) as ArrayBuffer); await face.load(); document.fonts.add(face); } catch { /* falls back to an estimate */ }

  let W = window.innerWidth, H = window.innerHeight;
  // The software rasterizer pays per pixel, so keep it at 1x.
  const canvas = new TVG.Canvas('#game', { width: W, height: H, enableDevicePixelRatio: rendererName !== 'sw' });
  const el = document.querySelector<HTMLCanvasElement>('#game')!;
  document.getElementById('boot')?.remove();

  const settings: Settings = { renderDist: rendererName === 'sw' ? 2 : 4, fov: 75, sens: 10, vol: 5, auto: true };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* ignore */ }
  const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

  const input = new Input(el);
  const sfx = new Sfx();
  sfx.volume = settings.vol / 10;
  const r3d = new Renderer3D(TVG);
  const hud = new Hud(TVG, input, 'ui');
  // Sky, terrain and overlays share one scene so post effects (blur, tint) cover the whole 3D view.
  const worldScene = new TVG.Scene();
  worldScene.add(r3d.skyScene).add(r3d.scene).add(r3d.overlayScene);
  const fx = new Fx(TVG, worldScene);
  if (params.has('nofx')) fx.enabled = false;
  // 2D Lottie artwork that gets projected into the 3D world (mobs, items).
  const l3d = new Lottie3D(TVG, () => canvas.dpr);
  l3d.load('slime', slimeLottie()); l3d.load('ghost', ghostLottie()); l3d.load('star', starItemLottie());
  for (const job of ['farmer', 'smith', 'librarian'] as const) l3d.load('villager_' + job, villagerLottie(job));
  l3d.load('cinder', cinderLottie()); l3d.load('glitch', glitchLottie()); l3d.load('outline', outlineBossLottie());
  setFlatArtProvider((name) => { const a = l3d.assets.get(name), f = a?.frames[0]; return a && f ? { shapes: f.shapes, w: a.w, h: a.h } : null; });
  canvas.add(l3d.stage);
  const ending = new Ending(TVG, 'ui', sfx);
  canvas.add(worldScene).add(fx.billboardScene).add(fx.scene).add(hud.scene).add(ending.scene);

  const cam = new Camera();
  const player = new Player();
  let inv = new Inventory();
  const win = new WindowState();
  let winKind: WindowKind = 'inventory';
  let openFurnace: Furnace | null = null;
  let furnaces = new Map<string, Furnace>();
  let world = new World(1337);
  let dim: Dim = 'overworld';
  let worlds: Partial<Record<Dim, World>> = {};
  let pendingEdits: Partial<Record<Dim, Record<string, number[]>>> = {};
  let links: PortalLink[] = [];
  let bossDefeated = false;
  let stats = newStats();
  const advancements = new Set<string>(), collectedGems = new Set<string>(), lostVillagers = new Set<string>();
  let portalTime = 0, portalCooldown = 0;
  let arrive: (() => void) | null = null;
  let tradeMob: Mob | null = null;
  let raid: { key: string; night: number } | null = null, raidDoneNight = -1;
  let entities!: EntityManager;
  let state: State = 'title';
  let creative = false;
  let seedText = '';
  let spawn: [number, number] = [8, 8];
  let dayTime = 0.08; // 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
  let dayCount = 0; // full days survived, picks the moon phase
  let gems = 0;
  let clock = 0;
  let cameraMode = 0; // 0 first person, 1 behind, 2 front
  let debug = params.has('debug');
  let showMap = true;
  let shake = 0;
  let toast = '', toastTimer = 0, nameTimer = 0;
  let target: RayHit | null = null;
  const mining = { x: 0, y: 0, z: 0, progress: 0, soundT: 0, active: false };
  let breakCd = 0, useCd = 0, attackCd = 0;
  let frameAvg = 16, qualityTimer = 0;
  let saveTimer = 0, pausedAt = 0;
  let escArmed = false; // Escape went down while paused; resume when it comes back up
  const pause = () => { state = 'paused'; pausedAt = clock; escArmed = false; input.unlock(); writeSave(); };
  let loadFrames = 0;
  let fps = 60, fpsAcc = 0, fpsFrames = 0;
  let heldId = -1, handDrop = 0;
  const fixedDist = params.has('dist');
  r3d.renderDistance = fixedDist ? clamp(Number(params.get('dist')) || 56, 16, 96) : settings.renderDist * 16;
  if (fixedDist) settings.auto = false;

  const say = (msg: string) => { toast = msg; toastTimer = 3; };
  const fkey = (x: number, y: number, z: number) => `${dim}:${x},${y},${z}`;
  const advance = (id: string) => { if (advancements.has(id)) return; advancements.add(id); say(`Advancement: ${ADV[id]}`); sfx.gem(); };

  const hooks = {
    pickup: (id: number, count: number, dur?: number) => inv.add(id, count, dur),
    canPickup: (id: number) => inv.canAdd(id, 1),
    sound: (n: 'pop' | 'gem' | 'explode' | 'fuse' | 'hit' | 'mob') => sfx[n](),
    shake: (a: number) => { shake = Math.max(shake, a); fx.burst(a); },
    gemCollected: () => { gems++; say(`Gem found! (${gems})`); },
    blockDestroyed: (x: number, y: number, z: number, id: number) => { if (id === B.FURNACE || id === B.FURNACE_LIT) spillFurnace(x, y, z); },
    bossDefeated: (x: number, y: number, z: number) => onBossDefeated(x, y, z),
  };
  player.onStep = () => sfx.step(player.groundBlock);
  player.onHurt = () => { sfx.hurt(); shake = Math.max(shake, 0.35); };
  player.onSplash = () => sfx.splash();

  // ------------------------------------------------------------------ save / load

  const readSave = (): SaveData | null => {
    try { const s = localStorage.getItem(SAVE_KEY); return s ? (JSON.parse(s) as SaveData) : null; } catch { return null; }
  };

  const writeSave = () => {
    if (!entities || state === 'title' || state === 'loading') return;
    const data: SaveData = {
      seedText, edits: (worlds.overworld ?? world).serializeEdits(), creative, time: dayTime, days: dayCount, gems, collected: [...collectedGems], spawn,
      dim, editsEmber: worlds.ember?.serializeEdits() ?? pendingEdits.ember, editsVoid: worlds.void?.serializeEdits() ?? pendingEdits.void, links, boss: bossDefeated, adv: [...advancements], lost: [...lostVillagers], stats,
      player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, health: player.dead ? 20 : player.health },
      inv: inv.slots, selected: inv.selected, furnaces: [...furnaces.values()],
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* quota, ignore */ }
  };

  /** Spirals outwards over the terrain function until it finds dry land, without generating chunks. */
  const findSpawn = (w: World): [number, number] => {
    const t = { h: 0, biome: 0, temp: 0, hum: 0 };
    for (let r = 0; r < 300; r++) {
      const a = r * 2.4, d = r * 10;
      const x = Math.round(Math.cos(a) * d), z = Math.round(Math.sin(a) * d);
      w.terrain(x, z, t);
      if (t.h > SEA + 1 && t.h < SEA + 26 && t.biome !== Biome.OCEAN) return [x, z];
    }
    return [0, 0];
  };

  const bindWorld = (w: World) => {
    w.onPop = (x, y, z, id) => { const d = BLOCKS[id].drop; if (d) entities.drop(d, 1, x + 0.5, y + 0.4, z + 0.5); };
  };

  /** Worlds are created on first visit; all three share the seed and keep their own edits. */
  const getWorld = (d: Dim): World => {
    let w = worlds[d];
    if (!w) {
      w = worlds[d] = new World(hashString(seedText), d);
      const e = pendingEdits[d];
      if (e) w.loadEdits(e);
      bindWorld(w);
    }
    return w;
  };

  const newEntities = () => {
    entities = new EntityManager(world, hooks);
    entities.lottie = l3d;
    entities.collectedGems = collectedGems;
    entities.lostVillagers = lostVillagers;
    entities.bossDefeated = bossDefeated;
  };

  const startWorld = (save: SaveData | null, newCreative = false, newSeed = '') => {
    seedText = save ? save.seedText : newSeed || (params.get('seed') ?? String(Math.floor(Math.random() * 1e9)));
    worlds = {};
    pendingEdits = save ? { overworld: save.edits, ember: save.editsEmber, void: save.editsVoid } : {};
    links = save?.links ?? []; bossDefeated = !!save?.boss;
    stats = { ...newStats(), ...(save?.stats ?? {}) };
    advancements.clear(); collectedGems.clear(); lostVillagers.clear();
    for (const a of save?.adv ?? []) advancements.add(a);
    for (const a of save?.collected ?? []) collectedGems.add(a);
    for (const a of save?.lost ?? []) lostVillagers.add(a);
    dim = save?.dim ?? 'overworld';
    world = getWorld(dim);
    newEntities();
    inv = new Inventory();
    furnaces = new Map();
    if (save) {
      creative = save.creative; dayTime = save.time; dayCount = save.days ?? 0; gems = save.gems; spawn = save.spawn ?? [8, 8];
      inv.load(save.inv, save.selected);
      for (const f of save.furnaces ?? []) furnaces.set(`${f.dim ?? 'overworld'}:${f.x},${f.y},${f.z}`, f);
      Object.assign(player, { x: save.player.x, y: save.player.y, z: save.player.z, yaw: save.player.yaw, pitch: save.player.pitch });
      player.vx = player.vy = player.vz = 0;
      player.health = save.player.health > 0 ? save.player.health : 20;
      player.dead = false;
    } else {
      creative = newCreative; dayTime = 0.08; dayCount = 0; gems = 0;
      if (creative) [B.GRASS, B.STONE, B.PLANKS, B.LOG, B.GLASS, B.BRICK, B.TORCH, B.TNT, B.GLOWSTONE].forEach((id, i) => (inv.slots[i] = makeStack(id, 64)));
      spawn = findSpawn(world);
      player.spawnAt(world, spawn[0], spawn[1]);
      player.yaw = 0.6; player.pitch = -0.1;
    }
    player.creative = creative;
    cameraMode = 0;
    state = 'loading';
    loadFrames = 0;
  };

  // A world to look at behind the title screen.
  const existing = readSave();
  if (existing) { world = new World(hashString(existing.seedText)); world.loadEdits(existing.edits); }
  bindWorld(world);
  newEntities();
  const titleCenter: [number, number] = existing ? [existing.player.x, existing.player.z] : findSpawn(world);

  // ------------------------------------------------------------------ environment

  const env: Environment = { sun: [1, 1, 1], fog: [176, 208, 245], zenith: [70, 130, 230], sunDir: [0, 1, 0], night: 0, moonPhase: 0, skyKind: 'normal', time: 0, underwater: false };

  const updateEnv = () => {
    const a = dayTime * Math.PI * 2;
    const sx = Math.cos(a), sy = Math.sin(a), sz = 0.3;
    const n = Math.hypot(sx, sy, sz);
    env.sunDir = [sx / n, sy / n, sz / n];
    const el2 = env.sunDir[1];
    const day = smooth(clamp((el2 + 0.14) / 0.4, 0, 1));
    env.night = 1 - day;
    const dusk = clamp(1 - Math.abs(el2 - 0.02) / 0.26, 0, 1) * clamp((el2 + 0.2) * 5, 0, 1);
    env.zenith = [lerp(6, 72, day), lerp(8, 134, day), lerp(24, 232, day)];
    env.fog = [lerp(lerp(14, 182, day), 250, dusk * 0.75), lerp(lerp(18, 212, day), 150, dusk * 0.7), lerp(lerp(38, 246, day), 96, dusk * 0.7)];
    env.sun = [lerp(0.2, 1, day) + dusk * 0.06, lerp(0.22, 1, day) - dusk * 0.06, lerp(0.36, 1, day) - dusk * 0.16];
    env.skyKind = state === 'title' || dim === 'overworld' ? 'normal' : dim;
    if (env.skyKind === 'ember') {
      // No sky at all: a dim red ambient, everything else comes from lava, magma and crystals.
      env.night = 1; env.zenith = [40, 10, 6]; env.fog = [96, 30, 14]; env.sun = [2.7, 1.55, 1.2];
    } else if (env.skyKind === 'void') {
      env.night = 1; env.zenith = [4, 3, 14]; env.fog = [16, 12, 40]; env.sun = [0.74, 0.72, 1.0];
    }
    env.underwater = player.headInWater && state !== 'title';
    if (env.underwater) {
      env.fog = [env.fog[0] * 0.2 + 8, env.fog[1] * 0.4 + 24, env.fog[2] * 0.6 + 60];
      env.zenith = env.fog;
    }
    env.time = clock;
    env.moonPhase = dayCount % 8;
  };

  // ------------------------------------------------------------------ interaction

  const lookDir = (): [number, number, number] => [-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch)];

  const breakTime = (id: number, held: Stack | null): number => {
    const d = BLOCKS[id];
    if (d.hard < 0) return Infinity;
    if (creative || d.hard === 0) return 0;
    const tool = held ? ITEMS.get(held.id)?.tool : undefined;
    const match = !!tool && tool.type === d.mine;
    const tier = match ? tool!.tier : 0;
    return !d.tier || tier >= d.tier ? (d.hard * 1.5) / (match ? TOOL_SPEED[tier] : 1) : d.hard * 5;
  };

  const canHarvest = (id: number, held: Stack | null): boolean => {
    const d = BLOCKS[id];
    if (!d.tier) return true;
    const tool = held ? ITEMS.get(held.id)?.tool : undefined;
    return !!tool && tool.type === d.mine && tool.tier >= d.tier;
  };

  const spawnDrops = (id: number, x: number, y: number, z: number) => {
    const d = BLOCKS[id];
    if (d.drop) entities.drop(d.drop, 1, x + 0.5, y + 0.4, z + 0.5);
    else if ((id === B.LEAVES || id === B.BIRCH_LEAVES) && Math.random() < 0.07) entities.drop(I.APPLE, 1, x + 0.5, y + 0.4, z + 0.5);
    else if (id === B.SPRUCE_LEAVES && Math.random() < 0.05) entities.drop(I.STICK, 1, x + 0.5, y + 0.4, z + 0.5);
  };

  function spillFurnace(x: number, y: number, z: number) {
    const k = fkey(x, y, z), f = furnaces.get(k);
    if (!f) return;
    for (const s of f.slots) if (s) entities.drop(s.id, s.count, x + 0.5, y + 0.5, z + 0.5, s.dur);
    furnaces.delete(k);
  }

  const destroyBlock = (x: number, y: number, z: number, drop: boolean) => {
    const id = world.getBlock(x, y, z);
    if (!id) return;
    if (id === B.FURNACE || id === B.FURNACE_LIT) spillFurnace(x, y, z);
    world.setBlock(x, y, z, B.AIR);
    stats.mined++;
    sfx.breakBlock(id);
    entities.blockBurst(x, y, z, id, 16);
    if (drop) spawnDrops(id, x, y, z);
    if (id === B.OBSIDIAN || id === B.EMBER_PORTAL) collapsePortal(x, y, z);
  };

  // ------------------------------------------------------------------ portals and dimensions

  /** Removes the portal film touching a broken frame block. */
  const collapsePortal = (x: number, y: number, z: number) => {
    const stack = [[x, y, z]];
    let n = 0;
    while (stack.length && n < 80) {
      const [cx, cy, cz] = stack.pop()!;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        if (world.getBlock(cx + dx, cy + dy, cz + dz) !== B.EMBER_PORTAL) continue;
        world.setBlock(cx + dx, cy + dy, cz + dz, B.AIR); n++;
        stack.push([cx + dx, cy + dy, cz + dz]);
      }
    }
  };

  /** Lights an obsidian frame: the air next to the struck block must be a closed region of a vertical plane. */
  const ignitePortal = (t: RayHit): boolean => {
    if (dim === 'void' || t.block !== B.OBSIDIAN) return false;
    const sx = t.x + t.nx, sy = t.y + t.ny, sz = t.z + t.nz;
    for (const alongX of [true, false]) {
      const cells: number[][] = [], seen = new Set<string>(), stack = [[sx, sy, sz]];
      let ok = true;
      while (stack.length && ok) {
        const [x, y, z] = stack.pop()!, k = x + ',' + y + ',' + z;
        if (seen.has(k)) continue;
        seen.add(k);
        const id = world.getBlock(x, y, z);
        if (id === B.OBSIDIAN) continue;
        if (id !== B.AIR || cells.length >= 21) { ok = false; break; }
        cells.push([x, y, z]);
        stack.push([x, y + 1, z], [x, y - 1, z], alongX ? [x + 1, y, z] : [x, y, z + 1], alongX ? [x - 1, y, z] : [x, y, z - 1]);
      }
      if (ok && cells.length >= 6) {
        for (const [x, y, z] of cells) world.setBlock(x, y, z, B.EMBER_PORTAL);
        sfx.explode(); fx.burst(0.5);
        advance('portal');
        return true;
      }
    }
    say('The frame is not closed (obsidian, at least 2 x 3 inside)');
    return false;
  };

  /** A Vector Eye fills a portal frame, or points the way to the stronghold. */
  const useEye = (t: RayHit | null) => {
    if (t && t.block === B.PORTAL_FRAME && dim === 'overworld') {
      world.setBlock(t.x, t.y, t.z, B.PORTAL_FRAME_EYE);
      if (!creative) inv.consumeHeld();
      sfx.gem();
      const s = world.stronghold;
      if (s.frames.every(([x, y, z]) => world.getBlock(x, y, z) === B.PORTAL_FRAME_EYE)) {
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.setBlock(s.portal[0] + dx, s.portal[1], s.portal[2] + dz, B.VOID_PORTAL);
        sfx.explode(); fx.burst(0.8);
        advance('voidportal');
      }
      return;
    }
    if (dim !== 'overworld') { say('The eye lies still here'); return; }
    const [ex, , ez] = world.strongholdEntrance(), dx = ex - player.x, dz = ez - player.z, dist = Math.hypot(dx, dz);
    const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const ang = Math.atan2(dx, -dz), dirName = names[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
    say(dist < 12 ? 'The eye trembles: the entrance is right here' : `The eye pulls ${dirName}, about ${Math.round(dist / 10) * 10} blocks away`);
    for (let i = 0; i < 14; i++) entities.particle(player.x + (dx / dist) * i * 0.5, player.y + EYE + i * 0.12, player.z + (dz / dist) * i * 0.5, 0, 0.4, 0, [90, 240, 220], 0.9, 0.12, true);
  };

  /** Swaps the active world. `place` runs once the area around (x, z) has been generated. */
  const travel = (to: Dim, x: number, y: number, z: number, place: () => void) => {
    writeSave();
    dim = to;
    if (!stats.dims.includes(to)) stats.dims.push(to);
    world = getWorld(to);
    newEntities();
    target = null; mining.active = false; portalTime = 0; portalCooldown = 4;
    player.x = x; player.y = y; player.z = z; player.vx = player.vy = player.vz = 0;
    arrive = place;
    state = 'loading'; loadFrames = 0;
  };

  /** Builds a lit obsidian portal with its base at (x, y, z), facing along Z, and clears standing room around it. */
  const buildPortal = (x: number, y: number, z: number) => {
    const floor = dim === 'ember' ? B.EMBER_ROCK : B.COBBLE;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) {
      world.setBlock(x + dx, y - 1, z + dz, dz === 0 ? B.OBSIDIAN : floor);
      for (let dy = 0; dy <= 3; dy++) world.setBlock(x + dx, y + dy, z + dz, B.AIR);
    }
    for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 2; dx++) {
      const frame = dx === -1 || dx === 2 || dy === -1 || dy === 3;
      world.setBlock(x + dx, y + dy, z, frame ? B.OBSIDIAN : B.EMBER_PORTAL);
    }
  };

  const enterEmberPortal = () => {
    const px = Math.floor(player.x), py = Math.floor(player.y), pz = Math.floor(player.z);
    const here = dim === 'overworld' ? 'a' : 'b', there = dim === 'overworld' ? 'b' : 'a';
    const to: Dim = dim === 'overworld' ? 'ember' : 'overworld';
    let link = links.find((l) => Math.hypot(l[here][0] - px, l[here][2] - pz) < 14 && Math.abs(l[here][1] - py) < 12);
    travel(to, link ? link[there][0] + 0.5 : px + 0.5, link ? link[there][1] : 40, link ? link[there][2] + 1.5 : pz + 0.5, () => {
      if (!link) {
        // First trip from here: find standing room near the same coordinates and raise the other end.
        let spot: [number, number, number] | null = null;
        for (let r = 0; r < 20 && !spot; r++) for (let a = 0; a < 8 && !spot; a++) {
          const x = px + Math.round(Math.cos(a * 0.785) * r * 2), z = pz + Math.round(Math.sin(a * 0.785) * r * 2);
          const y = to === 'ember' ? world.floorAt(x, 44, z, 30) : world.surfaceY(x, z);
          if (y > 2 && (to !== 'ember' || y > 24)) spot = [x, y, z];
        }
        spot ??= [px, 46, pz];
        buildPortal(spot[0], spot[1], spot[2]);
        link = to === 'ember' ? { a: [px, py, pz], b: spot } : { a: spot, b: [px, py, pz] };
        links.push(link);
      }
      const end = link[there];
      player.x = end[0] + 0.5; player.y = end[1] + 0.01; player.z = end[2] + 1.5;
      player.yaw = Math.PI; player.pitch = 0; // step out facing away from the film
      if (to === 'ember') advance('ember');
    });
  };

  const enterVoidPortal = () => {
    if (dim === 'overworld') {
      travel('void', VOID_ARRIVAL[0] + 0.5, 60, VOID_ARRIVAL[2] + 0.5, () => {
        player.y = world.surfaceY(VOID_ARRIVAL[0], VOID_ARRIVAL[2]) + 0.01;
        player.yaw = Math.PI / 2;
        advance('void');
      });
    } else {
      travel('overworld', spawn[0] + 0.5, 60, spawn[1] + 0.5, () => player.spawnAt(world, spawn[0], spawn[1]));
    }
  };

  function onBossDefeated(x: number, y: number, z: number) {
    bossDefeated = true; entities.bossDefeated = true;
    gems += 25;
    for (let i = 0; i < 80; i++) entities.particle(x, y + 2, z, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, i % 2 ? [120, 255, 240] : [255, 214, 90], 1.6, 0.22, true);
    sfx.explode(); fx.burst(1); shake = 1;
    // The way home opens in the middle of the island, and the spoils rain down next to it.
    const top = world.surfaceY(1, 1) - 1;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.setBlock(dx, top + 1, dz, B.VOID_PORTAL);
    entities.drop(B.TROPHY, 1, 4.5, top + 3, 0.5); entities.drop(I.DIAMOND, 6, 4.5, top + 3, 1.5); entities.drop(I.EMBER_INGOT, 4, 4.5, top + 3, -0.5); entities.drop(I.LOTTIE_STAR, 5, 5.5, top + 3, 0.5);
    advance('boss');
  }

  /** The way home out of the Void: the world melts, the poem and credits play, then the overworld. */
  const startEnding = () => {
    state = 'ending'; input.unlock(); cameraMode = 0;
    target = null; mining.active = false; portalTime = 0; portalCooldown = 4;
    writeSave();
    ending.start({ seed: seedText, creative, renderer: rendererName, days: dayCount, gems, stats, advancements: [...advancements].map((a) => ADV[a]).filter(Boolean), advTotal: Object.keys(ADV).length });
  };

  const goHome = () => {
    ending.stop();
    const hp = player.health; // spawnAt heals; the trip home is not a respawn
    travel('overworld', spawn[0] + 0.5, 60, spawn[1] + 0.5, () => { player.spawnAt(world, spawn[0], spawn[1]); player.health = hp; player.pitch = -0.1; advance('home'); });
  };

  // ------------------------------------------------------------------ villagers

  const openTrade = (m: Mob) => { tradeMob = m; winKind = 'trade'; state = 'window'; input.unlock(); sfx.click(); advance('trade'); };

  const doTrade = (t: Trade) => {
    if (t.gems > 0) {
      if (gems < t.gems) { say('Not enough gems'); return; }
      if (!inv.canAdd(t.id, t.count)) { say('Inventory full'); return; }
      gems -= t.gems; inv.add(t.id, t.count); sfx.pop();
    } else {
      if (!inv.remove(t.id, t.count)) { say('You do not have enough of that'); return; }
      gems -= t.gems; sfx.gem();
    }
  };

  /** Once per night, a village the player is standing in may be attacked; holding out until the raiders fall pays gems. */
  const updateRaid = () => {
    if (dim !== 'overworld' || creative) return;
    if (raid) {
      const left = entities.mobs.filter((m) => m.tag === 'raid').length;
      if (left === 0 || env.night < 0.3) {
        if (left === 0) { gems += 6; say('Raid repelled! The village rewards you with 6 gems'); sfx.gem(); advance('raid'); }
        raid = null;
      }
      return;
    }
    if (env.night < 0.8 || raidDoneNight === dayCount || Math.random() > 0.004) return;
    const v = world.villagesNear(player.x, player.z, 30)[0];
    if (!v) return;
    raid = { key: v.key, night: dayCount }; raidDoneNight = dayCount;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.28, x = Math.floor(v.cx + Math.cos(a) * 34), z = Math.floor(v.cz + Math.sin(a) * 34);
      if (!world.isLoaded(x, z)) continue;
      const m = new Mob(i % 3 === 2 ? 'creeper' : 'zombie', x + 0.5, world.surfaceY(x, z), z + 0.5);
      m.tag = 'raid';
      entities.mobs.push(m);
    }
    say('A raid! Zombies are closing in on the village');
    sfx.mob(); shake = 0.4;
  };


  const dropStack = (s: Stack) => {
    const d = lookDir();
    const e = entities.drop(s.id, s.count, player.x + d[0] * 0.4, player.y + EYE - 0.3, player.z + d[2] * 0.4, s.dur);
    if (e) { e.vx = d[0] * 6; e.vy = d[1] * 6 + 1.5; e.vz = d[2] * 6; e.delay = 1.5; }
  };

  const openWindow = (kind: WindowKind, furnace: Furnace | null = null) => {
    winKind = kind; openFurnace = furnace;
    win.craftSize = kind === 'crafting' ? 3 : 2;
    win.refresh();
    state = 'window';
    input.unlock();
    sfx.click();
  };

  const closeWindow = () => {
    tradeMob = null;
    win.close(inv, dropStack);
    openFurnace = null;
    state = 'playing';
    input.lock();
  };

  const use = (t: RayHit | null, held: Stack | null) => {
    const sneak = input.keys.has('ShiftLeft');
    if (t && !sneak) {
      if (t.block === B.CRAFTING_TABLE) { openWindow('crafting'); return; }
      if (t.block === B.FURNACE || t.block === B.FURNACE_LIT) {
        const k = fkey(t.x, t.y, t.z);
        if (!furnaces.has(k)) furnaces.set(k, { dim, x: t.x, y: t.y, z: t.z, slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 });
        openWindow('furnace', furnaces.get(k)!);
        return;
      }
      if (t.block === B.TNT) { entities.prime(t.x, t.y, t.z, 4); player.swing = 1; return; }
    }
    if (!held) return;
    if (held.id === I.IGNITER) { useCd = 0.4; player.swing = 1; if (t && ignitePortal(t)) { if (!creative && inv.damageHeld()) sfx.toolBreak(); } return; }
    if (held.id === I.VECTOR_EYE) { useCd = 0.5; player.swing = 1; useEye(t); return; }
    const def = ITEMS.get(held.id)!;
    if (def.food) {
      if (player.health < 20 || creative) { player.health = Math.min(20, player.health + def.food); if (!creative) inv.consumeHeld(); sfx.eat(); useCd = 0.8; }
      return;
    }
    if (!isBlockId(held.id) || !t) return;
    let x = t.x, y = t.y, z = t.z;
    if (!REPLACEABLE[t.block]) { x += t.nx; y += t.ny; z += t.nz; }
    if (y < 1 || y >= WH || !REPLACEABLE[world.getBlock(x, y, z)]) return;
    const id = held.id, below = world.getBlock(x, y - 1, z), bd = BLOCKS[id];
    if (bd.render === 'torch' && !SOLID[below]) return;
    if (id === B.CACTUS && below !== B.SAND && below !== B.CACTUS) return;
    if (bd.render === 'cross') {
      const ok = id === B.DEADBUSH ? below === B.SAND || below === B.DIRT || below === B.GRASS : below === B.GRASS || below === B.DIRT || below === B.SNOWGRASS;
      if (!ok) return;
    }
    if (SOLID[id] && (player.intersectsCell(x, y, z) || entities.blockOccupied(x, y, z))) return;
    world.setBlock(x, y, z, id);
    stats.placed++;
    sfx.place(id); player.swing = 1;
    if (!creative) inv.consumeHeld();
  };

  const interact = (dt: number) => {
    breakCd -= dt; useCd -= dt; attackCd -= dt;
    const d = lookDir();
    const ex = player.x, ey = player.y + EYE, ez = player.z;
    const reach = creative ? 6 : 4.5;
    const hit = raycast(world, ex, ey, ez, d[0], d[1], d[2], reach);
    const mobHit = entities.pick(ex, ey, ez, d[0], d[1], d[2], Math.min(3.6, hit ? hit.dist : reach));
    target = mobHit ? null : hit;
    const held = inv.held, tool = held ? ITEMS.get(held.id)?.tool : undefined;

    // Left button: attack or mine
    const m = mining;
    m.active = false;
    if (mobHit && input.clicked[0] && attackCd <= 0) {
      attackCd = 0.3; player.swing = 1;
      const hl = Math.hypot(d[0], d[2]) || 1;
      mobHit.mob.damage(creative ? 30 : tool ? tool.damage : 1, d[0] / hl, d[2] / hl, entities);
      if (mobHit.mob.dead) stats.slain++;
      sfx.hit();
      if (tool && !creative && inv.damageHeld()) sfx.toolBreak();
    } else if (input.buttons[0] && target && breakCd <= 0) {
      const t = target;
      if (m.x !== t.x || m.y !== t.y || m.z !== t.z) { m.x = t.x; m.y = t.y; m.z = t.z; m.progress = 0; }
      const bt = breakTime(t.block, held);
      if (bt !== Infinity) {
        m.active = true;
        m.progress += bt === 0 ? 1 : dt / bt;
        m.soundT -= dt;
        if (player.swing <= 0.2) player.swing = 1;
        if (m.soundT <= 0 && bt > 0) { m.soundT = 0.22; sfx.dig(t.block); entities.blockBurst(t.x, t.y, t.z, t.block, 2); }
        if (m.progress >= 1) {
          destroyBlock(t.x, t.y, t.z, !creative && canHarvest(t.block, held));
          if (tool && !creative && BLOCKS[t.block].hard > 0 && inv.damageHeld()) sfx.toolBreak();
          m.progress = 0; m.active = false;
          breakCd = creative ? 0.18 : bt === 0 ? 0.12 : 0.05;
        }
      }
    }
    if (!m.active && !(input.buttons[0] && target)) m.progress = 0;

    // Middle button: pick block (creative)
    if (input.clicked[1] && target && creative) {
      const id = target.block === B.FURNACE_LIT ? B.FURNACE : target.block;
      const at = inv.slots.findIndex((s, i) => i < HOTBAR && s && s.id === id);
      if (at >= 0) inv.selected = at; else inv.slots[inv.selected] = makeStack(id, 64);
      nameTimer = 2;
    }

    // Right button: talk to a villager, or use / place
    if (input.clicked[2] && mobHit && mobHit.mob.kind === 'villager') { openTrade(mobHit.mob); return; }
    if (input.buttons[2] && useCd <= 0) { useCd = 0.24; use(target, held); }
  };

  const tickFurnaces = (dt: number) => {
    for (const f of furnaces.values()) {
      const lit = tickFurnace(f, dt);
      if (lit !== !!f.lit && (f.dim ?? 'overworld') === dim && world.isLoaded(f.x, f.z)) {
        const cur = world.getBlock(f.x, f.y, f.z);
        if (cur === B.FURNACE || cur === B.FURNACE_LIT) { world.setBlock(f.x, f.y, f.z, lit ? B.FURNACE_LIT : B.FURNACE); f.lit = lit; }
      }
    }
  };

  // ------------------------------------------------------------------ camera

  const placeCamera = (dt: number) => {
    const ex = player.x, ey = player.y + EYE - (player.sneaking ? 0.12 : 0), ez = player.z;
    const bobY = Math.abs(Math.sin(player.walkPhase)) * 0.07 * player.bob;
    cam.fov += ((player.sprinting ? settings.fov + 9 : settings.fov) - cam.fov) * Math.min(1, dt * 8);
    shake = Math.max(0, shake - dt * 1.4);
    const sh = shake * shake;
    const jx = (Math.random() - 0.5) * sh * 0.8, jy = (Math.random() - 0.5) * sh * 0.8;

    if (cameraMode === 0) {
      cam.x = ex + jx; cam.y = ey + bobY + jy; cam.z = ez;
      cam.yaw = player.yaw; cam.pitch = player.pitch;
    } else {
      const front = cameraMode === 2;
      const yaw = player.yaw + (front ? Math.PI : 0), pitch = front ? -player.pitch : player.pitch;
      const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
      // Pull the camera in until nothing solid sits between it and the head.
      let dist = 0;
      for (; dist < 4.5; dist += 0.15) {
        if (SOLID[world.getBlock(Math.floor(ex - fx * (dist + 0.3)), Math.floor(ey - fy * (dist + 0.3)), Math.floor(ez - fz * (dist + 0.3)))]) break;
      }
      cam.x = ex - fx * dist + jx; cam.y = ey - fy * dist + jy; cam.z = ez - fz * dist;
      cam.yaw = yaw; cam.pitch = pitch;
    }
  };

  const heldView: HeldView = { flat: null, block: 0, sprite: null, swing: 0, bobX: 0, bobY: 0, drop: 0, sky: 0, lamp: 0 };
  const updateHeld = (dt: number) => {
    const held = inv.held, id = held ? held.id : 0;
    if (id !== heldId) { heldId = id; handDrop = 1; }
    handDrop = Math.max(0, handDrop - dt * 5);
    const hs = Math.min(1, Math.hypot(player.vx, player.vz) / 4.3) * (player.onGround ? 1 : 0.2);
    const la = id ? ITEMS.get(id)!.lottie : undefined, lAsset = la ? l3d.assets.get(la) : undefined, lf = lAsset?.at(clock);
    heldView.flat = lAsset && lf ? { shapes: lf.shapes, w: lAsset.w, h: lAsset.h } : null;
    heldView.block = id && isBlockId(id) && CUBE[id] ? id : 0;
    heldView.sprite = id && !heldView.block ? texture(ITEMS.get(id)!.icon) : null;
    heldView.swing = player.swing;
    heldView.bobX = Math.sin(player.walkPhase) * 0.025 * hs;
    heldView.bobY = -Math.abs(Math.cos(player.walkPhase)) * 0.03 * hs;
    heldView.drop = handDrop;
    const fx = Math.floor(player.x), fz = Math.floor(player.z);
    const top = world.isLoaded(fx, fz) ? world.topAt(fx, fz) : 0;
    heldView.sky = player.y + EYE >= top ? 0 : top - player.y <= 8 ? 1 : 2;
    heldView.lamp = held && isBlockId(held.id) && BLOCKS[held.id].light ? 3 : heldView.sky === 2 ? 1 : 0;
  };

  // ------------------------------------------------------------------ frame

  let last = performance.now();

  const frame = (nowMs: number) => {
    const rawDt = (nowMs - last) / 1000;
    last = nowMs;
    const dt = Math.min(rawDt, 1 / 20);
    clock += dt;
    fpsAcc += rawDt; fpsFrames++;
    if (fpsAcc >= 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
    frameAvg += (rawDt * 1000 - frameAvg) * 0.05;

    if (window.innerWidth !== W || window.innerHeight !== H) {
      W = window.innerWidth; H = window.innerHeight;
      canvas.resize(W, H);
    }

    const playing = state === 'playing';
    l3d.tick();
    hud.begin(W, H);

    // --- global keys
    if (input.pressed.has('F3')) debug = !debug;
    if (state === 'window') {
      if (input.pressed.has('KeyE') || input.pressed.has('Escape')) closeWindow();
    } else if (playing) {
      if (input.pressed.has('KeyE')) openWindow('inventory');
      if (input.pressed.has('KeyQ') && inv.held) { dropStack({ ...inv.held, count: 1 }); inv.consumeHeld(); }
      if (input.pressed.has('F5') || input.pressed.has('KeyV')) cameraMode = (cameraMode + 1) % 3;
      if (input.pressed.has('KeyM')) showMap = !showMap;
      if (input.pressed.has('KeyT') && (creative || debug)) { dayTime = (dayTime + 0.125) % 1; say('Time skipped'); }
      if (input.pressed.has('KeyP') || (input.pressed.has('Escape') && !input.locked)) pause();
      for (let i = 0; i < HOTBAR; i++) if (input.pressed.has('Digit' + (i + 1))) { inv.selected = i; nameTimer = 2; }
      if (input.wheel) { inv.selected = (inv.selected + Math.sign(input.wheel) + HOTBAR) % HOTBAR; nameTimer = 2; }
      if (input.clicked[0] && !input.locked && !params.has('autoplay')) { input.lock(); input.clicked[0] = false; }
    }

    // --- simulation
    if (state === 'loading') {
      const pending = world.stream(player.x, player.z, 44, 14);
      loadFrames++;
      if (!pending) {
        if (arrive) { arrive(); arrive = null; state = 'playing'; input.lock(); }
        else {
          if (dim === 'overworld' && (!readSave() || player.y < 1)) player.spawnAt(world, Math.floor(player.x), Math.floor(player.z));
          state = 'playing'; input.lock();
          say(creative ? 'Creative mode: double tap Space to fly' : 'Survival: punch a tree, craft tools, survive the night');
        }
      }
    } else if (state === 'title') {
      world.stream(titleCenter[0], titleCenter[1], r3d.renderDistance, 6);
    } else {
      world.stream(player.x, player.z, r3d.renderDistance, 5);
    }

    const sim = playing || state === 'window' || state === 'dead';
    if (sim) {
      dayTime += dt / DAY_LENGTH;
      if (dayTime >= 1) { dayTime -= 1; dayCount++; }
      if (playing && input.locked) player.look(input, settings.sens * 0.00024);
      player.update(world, input, dt, clock, playing);
      if (playing) interact(dt); else { mining.active = false; target = null; }
      if (playing) { stats.played += dt; stats.walked += Math.hypot(player.vx, player.vz) * dt; }
      entities.update(dt, player, env.night);
      world.tick(dt);
      tickFurnaces(dt);
      updateRaid();
      // Standing inside a portal film charges the jump; stepping out lets it fade.
      portalCooldown = Math.max(0, portalCooldown - dt);
      const pb = world.getBlock(Math.floor(player.x), Math.floor(player.y + 0.4), Math.floor(player.z));
      const inPortal = (pb === B.EMBER_PORTAL || pb === B.VOID_PORTAL) && portalCooldown <= 0 && !player.dead;
      portalTime = inPortal ? portalTime + dt : Math.max(0, portalTime - dt * 2);
      if (inPortal && portalTime > (creative ? 0.5 : 2.2)) { if (pb === B.EMBER_PORTAL) enterEmberPortal(); else if (dim === 'void') startEnding(); else enterVoidPortal(); }
      if (dim === 'overworld' && !advancements.has('village') && world.villagesNear(player.x, player.z, 36).length) advance('village');
      if (player.dead && state !== 'dead') {
        if (state === 'window') win.close(inv, dropStack);
        state = 'dead'; input.unlock(); cameraMode = 1; stats.deaths++;
      }
      saveTimer += dt;
      if (saveTimer > 15) { saveTimer = 0; writeSave(); }
    }

    // --- camera
    if (state === 'title') {
      const a = clock * 0.06;
      const cx = titleCenter[0], cz = titleCenter[1];
      cam.x = cx + Math.cos(a) * 26; cam.z = cz + Math.sin(a) * 26;
      const ground = world.isLoaded(cam.x, cam.z) ? world.surfaceY(Math.floor(cam.x), Math.floor(cam.z)) : SEA + 8;
      const center = world.isLoaded(cx, cz) ? world.surfaceY(Math.floor(cx), Math.floor(cz)) : SEA + 8;
      const wantY = Math.max(ground, center, SEA) + 14;
      cam.y += (wantY - cam.y) * Math.min(1, dt * 1.5);
      cam.yaw = Math.atan2(cam.x - cx, cam.z - cz); cam.pitch = -0.38; cam.fov = 75;
      dayTime = (dayTime + dt / 120) % 1;
    } else {
      if (state === 'ending') { player.pitch += (0.5 - player.pitch) * Math.min(1, dt * 0.6); player.yaw += dt * 0.04; }
      placeCamera(dt);
      if (state === 'ending') cam.y += ending.lift;
    }
    cam.setup(W, H);
    updateEnv();

    // --- 3D scene (the credits cover it completely, so it rests while they roll)
    const covered = state === 'ending' && ending.opaque;
    worldScene.visible(!covered);
    if (state !== 'loading' && !covered) {
      r3d.begin(cam, clock);
      r3d.drawSky(env);
      r3d.drawWorld(world);
      entities.draw(r3d, clock);
      if (state !== 'title') {
        if (cameraMode !== 0) {
          const amp = Math.min(0.9, Math.hypot(player.vx, player.vz) * 0.2) * (player.onGround ? 1 : 0.4);
          entities.drawModel(r3d, MODELS.avatar, player.x, player.y, player.z, player.yaw, player.walkPhase, amp, player.pitch, 0, player.hurtTimer, Math.sin(player.swing * Math.PI) * 1.4);
        } else if (!player.dead) { updateHeld(dt); r3d.drawHeld(heldView); }
      }
      if (playing && mining.active && mining.progress > 0.02) r3d.drawCrack(mining.x, mining.y, mining.z, mining.progress);
      r3d.end(env);
      if (playing && target) r3d.drawSelection(target.x, target.y, target.z, target.block);
      else r3d.clearSelection();
    }
    // Lottie billboards in the world: alerts over hunting mobs, creeper fuse rings, gem sparkles.
    fx.beginBillboards();
    if (state !== 'loading' && !covered && fx.enabled) {
      for (const m of entities.mobs) {
        if (m.fuse > 0) fx.billboard('fuse', world, cam, m.x, m.y + m.h * 0.55, m.z, clock, 1.9);
        else if (m.alert >= 0 && m.alert < 1.2) fx.billboard('alert', world, cam, m.x, m.y + m.h + 0.45, m.z, m.alert, 0.7);
      }
      for (const g of entities.gems.values()) fx.billboard('sparkle', world, cam, g.x, g.y + 0.3 + Math.sin(clock * 2 + g.x) * 0.15, g.z, clock + g.x * 0.37, 1.3);
    }
    fx.endBillboards();
    fx.lights(world, cam, env, dt, state !== 'loading' && !covered);
    fx.post({ menuOpen: state === 'paused' || state === 'window' || state === 'dead', underwater: env.underwater, inLava: player.inLava && state !== 'title', hurt: state === 'title' ? 0 : player.hurtTimer, night: env.night, dim: state === 'title' ? 'overworld' : dim, portal: state === 'ending' ? 1 : Math.min(1, portalTime / 2.2) }, dt);

    // --- HUD and menus
    toastTimer = Math.max(0, toastTimer - dt);
    nameTimer = Math.max(0, nameTimer - dt);
    const inGame = state === 'playing' || state === 'window' || state === 'paused' || state === 'dead';
    let debugLines: string[] = [];
    if (debug && inGame) {
      const t = world.terrain(Math.floor(player.x), Math.floor(player.z), { h: 0, biome: 0, temp: 0, hum: 0 });
      debugLines = [
        `ThorCraft | ${rendererName.toUpperCase()} | ${fps.toFixed(0)} fps (${frameAvg.toFixed(1)} ms) [${creative ? 'creative' : 'survival'}]`,
        `polys ${r3d.stats.polys}  shapes ${r3d.stats.shapes}  chunks ${r3d.stats.chunks}`,
        `collect ${r3d.stats.collectMs.toFixed(1)} ms  emit ${r3d.stats.emitMs.toFixed(1)} ms  detail ${r3d.detail.toFixed(2)}`,
        `xyz ${player.x.toFixed(1)} ${player.y.toFixed(1)} ${player.z.toFixed(1)}  view ${r3d.renderDistance}  ${dim === 'overworld' ? 'biome ' + BIOME_NAMES[t.biome] : dim}`,
        `mobs ${entities.mobs.length}  drops ${entities.drops.length}  particles ${entities.particles.length}`,
        `canvas ${W}x${H} @${canvas.dpr.toFixed(2)}  seed ${seedText}`,
        target ? `target ${BLOCKS[target.block].name} (${target.x}, ${target.y}, ${target.z})` : '',
      ];
    }
    const info: HudInfo = {
      fps, debug: debug && inGame, debugLines, gems, toast, toastAlpha: Math.min(1, toastTimer), nameAlpha: Math.min(1, nameTimer * 2),
      timeOfDay: dayTime, inLava: player.inLava, breakProgress: playing && mining.active ? mining.progress : 0, fxOn: fx.enabled,
    };

    hud.setMinimapVisible(inGame && showMap && dim !== 'ember'); // a cave world has no map from above
    if (inGame) {
      hud.drawGame(player, inv, info, clock);
      if (dim === 'void' && entities.bossAlive) hud.drawBossBar('The Outline', entities.bossHp / 160, entities.anchors);
      if (showMap && dim !== 'ember') hud.drawMinimap(world, player, dt);
    }
    if (state === 'title') {
      const act = hud.drawTitle(!!readSave(), rendererName, clock);
      if (act) { sfx.unlock(); sfx.click(); }
      if (act === 'continue') startWorld(readSave());
      else if (act === 'survival' || act === 'creative') {
        if (!readSave() || confirm('This overwrites the existing world. Continue?')) { localStorage.removeItem(SAVE_KEY); startWorld(null, act === 'creative', hud.seedText.trim()); }
      } else if (act === 'renderer') {
        const next = rendererName === 'gl' ? 'wg' : rendererName === 'wg' ? 'sw' : 'gl';
        const u = new URL(location.href); u.searchParams.set('renderer', next); location.href = u.toString();
      }
    } else if (state === 'loading') {
      hud.drawLoading(clamp(loadFrames / 60, 0, 0.98));
    } else if (state === 'paused') {
      const act = hud.drawPause(settings, creative);
      if (act && act !== 'settings') sfx.click();
      if (act === 'resume') { state = 'playing'; input.lock(); }
      else if (act === 'settings') { sfx.volume = settings.vol / 10; if (!fixedDist) r3d.renderDistance = settings.renderDist * 16; saveSettings(); }
      else if (act === 'auto') { settings.auto = !settings.auto; saveSettings(); }
      else if (act === 'mode') { creative = !creative; player.creative = creative; if (!creative) player.flying = false; }
      else if (act === 'quit') { writeSave(); location.reload(); }
      // Ignore the very Escape press that released the pointer lock, and resume on Escape *release*:
      // re-requesting the lock while the key is still held lets the browser's own Escape
      // handling (key repeat / hold) drop the lock again, which would bounce us back to pause.
      if (clock - pausedAt > 0.3 && input.pressed.has('Escape')) escArmed = true;
      if ((escArmed && input.released.has('Escape')) || input.pressed.has('KeyP')) { state = 'playing'; escArmed = false; input.lock(); }
    } else if (state === 'window') {
      if (winKind === 'trade') {
        const job = (tradeMob?.job || 'farmer') as keyof typeof TRADES;
        const picked = hud.drawTrade(job, TRADES[job], gems, inv);
        if (picked >= 0) doTrade(TRADES[job][picked]);
        if (!tradeMob || tradeMob.dead || Math.hypot(tradeMob.x - player.x, tradeMob.z - player.z) > 6) closeWindow();
      } else if (hud.drawWindow(winKind, inv, win, creative, openFurnace)) sfx.click();
    } else if (state === 'ending') {
      if (ending.draw(input, W, H, dt, clock)) goHome();
    } else if (state === 'dead') {
      if (hud.drawDead(gems) === 'respawn') {
        if (!creative) for (const s of inv.slots) if (s) entities.drop(s.id, s.count, player.x, player.y + 1, player.z, s.dur);
        if (!creative) inv.slots.fill(null);
        cameraMode = 0;
        if (dim !== 'overworld') travel('overworld', spawn[0] + 0.5, 60, spawn[1] + 0.5, () => player.spawnAt(world, spawn[0], spawn[1]));
        else { player.spawnAt(world, spawn[0], spawn[1]); state = 'playing'; input.lock(); }
      }
    }
    el.style.cursor = input.locked ? 'none' : hud.hot ? 'pointer' : 'default';
    hud.end();

    // --- adaptive quality: texture detail first, then view distance
    if (settings.auto && playing && !fixedDist) {
      qualityTimer += dt;
      if (qualityTimer > 1.5) {
        qualityTimer = 0;
        const maxDist = settings.renderDist * 16;
        if (frameAvg > 24) { if (r3d.detail > 0.55) r3d.detail -= 0.15; else if (r3d.renderDistance > 32) r3d.renderDistance -= 4; }
        else if (frameAvg < 17.5) { if (r3d.renderDistance < maxDist) r3d.renderDistance += 2; else if (r3d.detail < 1) r3d.detail = Math.min(1, r3d.detail + 0.05); }
      }
    }

    canvas.update().render();
    input.endFrame();
    requestAnimationFrame(frame);
  };

  input.onLockChange = (locked) => {
    if (!locked && state === 'playing' && !params.has('autoplay')) pause();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) writeSave(); });
  window.addEventListener('beforeunload', () => writeSave());
  el.addEventListener('mousedown', () => sfx.unlock());

  if (params.has('autoplay')) startWorld(params.has('fresh') ? null : readSave(), params.get('autoplay') === 'creative');

  // Debug handles and console cheats exist in development only; production builds strip this block.
  if (import.meta.env.DEV) {
    (window as any).__game = {
      get state() { return state; }, player, get inv() { return inv; }, r3d, cam, settings, input, get world() { return world; }, get entities() { return entities; },
      setTime: (t: number) => { dayTime = t; }, setDay: (d: number) => { dayCount = d; }, setState: (s: State) => { state = s; }, open: (k: WindowKind) => openWindow(k),
      give: (id: number, n = 1) => inv.add(id, n), win, furnaces: () => furnaces,
      spawn: (kind: MobKind, dx: number, dz: number) => { const x = Math.floor(player.x + dx), z = Math.floor(player.z + dz); entities.mobs.push(new Mob(kind, x + 0.5, world.surfaceY(x, z), z + 0.5)); },
      setCamera: (m: number) => { cameraMode = m; }, fx, l3d, worldScene, TVG, canvas, ending, stats: () => ({ fps, frameAvg, ...r3d.stats }),
    };
    installCheats({
      player, world: () => world, entities: () => entities, inv: () => inv,
      getTime: () => dayTime, setTime: (t) => { dayTime = t; }, addDays: (n) => { dayCount += n; },
      setCreative: (on) => { creative = on; player.creative = on; if (!on) player.flying = false; }, isCreative: () => creative,
      seed: () => seedText, say, lottie: l3d, addGems: (n) => { gems = Math.max(0, gems + n); },
      gotoDim: (d) => {
        if (d === dim) return;
        if (d === 'void') { dim = 'overworld'; enterVoidPortal(); }
        else if (d === 'overworld') travel('overworld', spawn[0] + 0.5, 60, spawn[1] + 0.5, () => player.spawnAt(world, spawn[0], spawn[1]));
        else { const x = Math.floor(player.x), z = Math.floor(player.z); travel('ember', x + 0.5, 44, z + 0.5, () => { for (let r = 0; r < 24; r++) { const y = world.floorAt(x + r, 44, z, 30); if (y > 24) { player.x = x + r + 0.5; player.y = y + 0.01; return; } } }); }
      }, setFlatMode: (m) => { r3d.flatMode = m; },
      playEnding: () => { if (state === 'playing') startEnding(); },
    });
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Failed to start: ' + (err?.message ?? err);
});
