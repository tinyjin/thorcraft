// ThorCraft: a voxel sandbox where every pixel is drawn by @thorvg/webcanvas.

import ThorVG from '@thorvg/webcanvas';
import wasmUrl from '../node_modules/@thorvg/webcanvas/dist/thorvg.wasm?url';
import { Sfx } from './audio';
import { B, BLOCKS, CUBE, I, ITEMS, REPLACEABLE, SOLID, TOOL_SPEED, isBlockId } from './blocks';
import { EntityManager, MODELS, Mob, MobKind } from './entities';
import { Fx } from './fx';
import { Hud, HudInfo, Settings, WindowKind } from './hud';
import { Input } from './input';
import { Furnace, HOTBAR, Inventory, Stack, WindowState, makeStack, tickFurnace } from './inventory';
import { clamp, lerp, smooth } from './math';
import { RayHit, raycast } from './physics';
import { EYE, Player } from './player';
import { installCheats } from './cheats';
import { Camera, Environment, HeldView, Renderer3D } from './renderer';
import { texture } from './textures';
import { BIOME_NAMES, Biome, SEA, WH, World } from './world';

type State = 'title' | 'loading' | 'playing' | 'paused' | 'window' | 'dead';
type RendererName = 'gl' | 'wg' | 'sw';

const SAVE_KEY = 'thorcraft.save.v2', SETTINGS_KEY = 'thorcraft.settings';
const DAY_LENGTH = 720; // seconds

interface SaveData {
  seedText: string; edits: Record<string, number[]>; creative: boolean; time: number; gems: number; collected: string[];
  spawn: [number, number]; days?: number;
  player: { x: number; y: number; z: number; yaw: number; pitch: number; health: number };
  inv: (Stack | null)[]; selected: number; furnaces: Furnace[];
}

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
  canvas.add(worldScene).add(fx.billboardScene).add(fx.scene).add(hud.scene);

  const cam = new Camera();
  const player = new Player();
  let inv = new Inventory();
  const win = new WindowState();
  let winKind: WindowKind = 'inventory';
  let openFurnace: Furnace | null = null;
  let furnaces = new Map<string, Furnace>();
  let world = new World(1337);
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
  let loadFrames = 0;
  let fps = 60, fpsAcc = 0, fpsFrames = 0;
  let heldId = -1, handDrop = 0;
  const fixedDist = params.has('dist');
  r3d.renderDistance = fixedDist ? clamp(Number(params.get('dist')) || 56, 16, 96) : settings.renderDist * 16;
  if (fixedDist) settings.auto = false;

  const say = (msg: string) => { toast = msg; toastTimer = 3; };
  const fkey = (x: number, y: number, z: number) => `${x},${y},${z}`;

  const hooks = {
    pickup: (id: number, count: number, dur?: number) => inv.add(id, count, dur),
    canPickup: (id: number) => inv.canAdd(id, 1),
    sound: (n: 'pop' | 'gem' | 'explode' | 'fuse' | 'hit' | 'mob') => sfx[n](),
    shake: (a: number) => { shake = Math.max(shake, a); fx.burst(a); },
    gemCollected: () => { gems++; say(`Gem found! (${gems})`); },
    blockDestroyed: (x: number, y: number, z: number, id: number) => { if (id === B.FURNACE || id === B.FURNACE_LIT) spillFurnace(x, y, z); },
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
      seedText, edits: world.serializeEdits(), creative, time: dayTime, days: dayCount, gems, collected: [...entities.collectedGems], spawn,
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

  const startWorld = (save: SaveData | null, newCreative = false, newSeed = '') => {
    seedText = save ? save.seedText : newSeed || (params.get('seed') ?? String(Math.floor(Math.random() * 1e9)));
    world = new World(hashString(seedText));
    bindWorld(world);
    entities = new EntityManager(world, hooks);
    inv = new Inventory();
    furnaces = new Map();
    if (save) {
      world.loadEdits(save.edits);
      creative = save.creative; dayTime = save.time; dayCount = save.days ?? 0; gems = save.gems; spawn = save.spawn ?? [8, 8];
      entities.collectedGems = new Set(save.collected);
      inv.load(save.inv, save.selected);
      for (const f of save.furnaces ?? []) furnaces.set(fkey(f.x, f.y, f.z), f);
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
  entities = new EntityManager(world, hooks);
  const titleCenter: [number, number] = existing ? [existing.player.x, existing.player.z] : findSpawn(world);

  // ------------------------------------------------------------------ environment

  const env: Environment = { sun: [1, 1, 1], fog: [176, 208, 245], zenith: [70, 130, 230], sunDir: [0, 1, 0], night: 0, moonPhase: 0, time: 0, underwater: false };

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
    sfx.breakBlock(id);
    entities.blockBurst(x, y, z, id, 16);
    if (drop) spawnDrops(id, x, y, z);
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
        if (!furnaces.has(k)) furnaces.set(k, { x: t.x, y: t.y, z: t.z, slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 });
        openWindow('furnace', furnaces.get(k)!);
        return;
      }
      if (t.block === B.TNT) { entities.prime(t.x, t.y, t.z, 4); player.swing = 1; return; }
    }
    if (!held) return;
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

    // Right button: use or place
    if (input.buttons[2] && useCd <= 0) { useCd = 0.24; use(target, held); }
  };

  const tickFurnaces = (dt: number) => {
    for (const f of furnaces.values()) {
      const lit = tickFurnace(f, dt);
      if (lit !== !!f.lit && world.isLoaded(f.x, f.z)) {
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

  const heldView: HeldView = { block: 0, sprite: null, swing: 0, bobX: 0, bobY: 0, drop: 0, sky: 0, lamp: 0 };
  const updateHeld = (dt: number) => {
    const held = inv.held, id = held ? held.id : 0;
    if (id !== heldId) { heldId = id; handDrop = 1; }
    handDrop = Math.max(0, handDrop - dt * 5);
    const hs = Math.min(1, Math.hypot(player.vx, player.vz) / 4.3) * (player.onGround ? 1 : 0.2);
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
      if (input.pressed.has('KeyP') || (input.pressed.has('Escape') && !input.locked)) { state = 'paused'; pausedAt = clock; input.unlock(); writeSave(); }
      for (let i = 0; i < HOTBAR; i++) if (input.pressed.has('Digit' + (i + 1))) { inv.selected = i; nameTimer = 2; }
      if (input.wheel) { inv.selected = (inv.selected + Math.sign(input.wheel) + HOTBAR) % HOTBAR; nameTimer = 2; }
      if (input.clicked[0] && !input.locked && !params.has('autoplay')) { input.lock(); input.clicked[0] = false; }
    }

    // --- simulation
    if (state === 'loading') {
      const pending = world.stream(player.x, player.z, 44, 14);
      loadFrames++;
      if (!pending) {
        if (!readSave() || player.y < 1) player.spawnAt(world, Math.floor(player.x), Math.floor(player.z));
        state = 'playing'; input.lock();
        say(creative ? 'Creative mode: double tap Space to fly' : 'Survival: punch a tree, craft tools, survive the night');
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
      entities.update(dt, player, env.night);
      world.tick(dt);
      tickFurnaces(dt);
      if (player.dead && state !== 'dead') {
        if (state === 'window') win.close(inv, dropStack);
        state = 'dead'; input.unlock(); cameraMode = 1;
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
    } else placeCamera(dt);
    cam.setup(W, H);
    updateEnv();

    // --- 3D scene
    if (state !== 'loading') {
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
      if (playing && target) r3d.drawSelection(target.x, target.y, target.z);
      else r3d.clearSelection();
    }
    // Lottie billboards in the world: alerts over hunting mobs, creeper fuse rings, gem sparkles.
    fx.beginBillboards();
    if (state !== 'loading' && fx.enabled) {
      for (const m of entities.mobs) {
        if (m.fuse > 0) fx.billboard('fuse', world, cam, m.x, m.y + m.h * 0.55, m.z, clock, 1.9);
        else if (m.alert >= 0 && m.alert < 1.2) fx.billboard('alert', world, cam, m.x, m.y + m.h + 0.45, m.z, m.alert, 0.7);
      }
      for (const g of entities.gems.values()) fx.billboard('sparkle', world, cam, g.x, g.y + 0.3 + Math.sin(clock * 2 + g.x) * 0.15, g.z, clock + g.x * 0.37, 1.3);
    }
    fx.endBillboards();
    fx.lights(world, cam, env, dt, state !== 'loading');
    fx.post({ menuOpen: state === 'paused' || state === 'window' || state === 'dead', underwater: env.underwater, inLava: player.inLava && state !== 'title', hurt: state === 'title' ? 0 : player.hurtTimer, night: env.night }, dt);

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
        `xyz ${player.x.toFixed(1)} ${player.y.toFixed(1)} ${player.z.toFixed(1)}  view ${r3d.renderDistance}  biome ${BIOME_NAMES[t.biome]}`,
        `mobs ${entities.mobs.length}  drops ${entities.drops.length}  particles ${entities.particles.length}`,
        `canvas ${W}x${H} @${canvas.dpr.toFixed(2)}  seed ${seedText}`,
        target ? `target ${BLOCKS[target.block].name} (${target.x}, ${target.y}, ${target.z})` : '',
      ];
    }
    const info: HudInfo = {
      fps, debug: debug && inGame, debugLines, gems, toast, toastAlpha: Math.min(1, toastTimer), nameAlpha: Math.min(1, nameTimer * 2),
      timeOfDay: dayTime, inLava: player.inLava, breakProgress: playing && mining.active ? mining.progress : 0, fxOn: fx.enabled,
    };

    hud.setMinimapVisible(inGame && showMap);
    if (inGame) {
      hud.drawGame(player, inv, info, clock);
      if (showMap) hud.drawMinimap(world, player, dt);
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
      // Ignore the very Escape press that released the pointer lock.
      if (clock - pausedAt > 0.3 && (input.pressed.has('Escape') || input.pressed.has('KeyP'))) { state = 'playing'; input.lock(); }
    } else if (state === 'window') {
      if (hud.drawWindow(winKind, inv, win, creative, openFurnace)) sfx.click();
    } else if (state === 'dead') {
      if (hud.drawDead(gems) === 'respawn') {
        if (!creative) for (const s of inv.slots) if (s) entities.drop(s.id, s.count, player.x, player.y + 1, player.z, s.dur);
        if (!creative) inv.slots.fill(null);
        player.spawnAt(world, spawn[0], spawn[1]);
        cameraMode = 0;
        state = 'playing'; input.lock();
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
    if (!locked && state === 'playing' && !params.has('autoplay')) { state = 'paused'; pausedAt = clock; writeSave(); }
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
      setCamera: (m: number) => { cameraMode = m; }, fx, worldScene, TVG, canvas, stats: () => ({ fps, frameAvg, ...r3d.stats }),
    };
    installCheats({
      player, world: () => world, entities: () => entities, inv: () => inv,
      getTime: () => dayTime, setTime: (t) => { dayTime = t; }, addDays: (n) => { dayCount += n; },
      setCreative: (on) => { creative = on; player.creative = on; if (!on) player.flying = false; }, isCreative: () => creative,
      seed: () => seedText, say,
    });
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Failed to start: ' + (err?.message ?? err);
});
