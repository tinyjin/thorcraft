// ThorCraft: a voxel sandbox where every pixel is drawn by @thorvg/webcanvas.

import ThorVG from '@thorvg/webcanvas';
import wasmUrl from '../node_modules/@thorvg/webcanvas/dist/thorvg.wasm?url';
import { Sfx } from './audio';
import { B, BLOCKS, Item } from './blocks';
import { EntityManager, MODELS, Mob, MobKind } from './entities';
import { Hud, HudInfo } from './hud';
import { Input } from './input';
import { HOTBAR, Inventory } from './inventory';
import { clamp, lerp, smooth } from './math';
import { RayHit, raycast } from './physics';
import { EYE, Player } from './player';
import { Camera, Environment, Renderer3D } from './renderer';
import { World } from './world';

type State = 'title' | 'loading' | 'playing' | 'paused' | 'inventory' | 'dead';
type RendererName = 'gl' | 'wg' | 'sw';

const SAVE_KEY = 'thorcraft.save.v1';
const DAY_LENGTH = 600; // seconds
const REACH = 5.5;

interface SaveData {
  seed: number; edits: Record<string, number[]>; creative: boolean; time: number; gems: number; collected: string[];
  player: { x: number; y: number; z: number; yaw: number; pitch: number; health: number };
  inv: ({ id: number; count: number } | null)[]; selected: number;
}

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

  let W = window.innerWidth, H = window.innerHeight;
  // The software rasterizer pays per pixel, so keep it at 1x.
  const canvas = new TVG.Canvas('#game', { width: W, height: H, enableDevicePixelRatio: rendererName !== 'sw' });
  const el = document.querySelector<HTMLCanvasElement>('#game')!;
  document.getElementById('boot')?.remove();

  const input = new Input(el);
  const sfx = new Sfx();
  const r3d = new Renderer3D(TVG);
  const hud = new Hud(TVG, input, 'ui');
  canvas.add(r3d.skyScene).add(r3d.scene).add(r3d.overlayScene).add(hud.scene);

  const cam = new Camera();
  const player = new Player();
  let inv = new Inventory();
  let world = new World(1337);
  let entities!: EntityManager;
  let state: State = 'title';
  let creative = false;
  let dayTime = 0.08; // 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
  let gems = 0;
  let clock = 0;
  let cameraMode = 0; // 0 first person, 1 behind, 2 front
  let debug = params.has('debug');
  let showMap = true;
  let shake = 0;
  let toast = '', toastTimer = 0;
  let target: RayHit | null = null;
  let breaking: { x: number; y: number; z: number; t: number } | null = null;
  let actionCooldown = 0, placeCooldown = 0, digSoundTimer = 0;
  let autoQuality = true, maxDistance = 64, frameAvg = 16, qualityTimer = 0;
  let saveTimer = 0, pausedAt = 0;
  let loadingTotal = 1;
  let fps = 60, fpsAcc = 0, fpsFrames = 0;
  r3d.renderDistance = rendererName === 'sw' ? 36 : 56;
  if (params.has('dist')) { r3d.renderDistance = clamp(Number(params.get('dist')) || 56, 16, 80); autoQuality = false; }

  const say = (msg: string) => { toast = msg; toastTimer = 3; };

  const hooks = {
    pickup: (id: number, count: number) => (creative ? 0 : inv.add(id, count)),
    sound: (n: 'pop' | 'gem' | 'explode' | 'fuse' | 'hit') => sfx[n](),
    shake: (a: number) => { shake = Math.max(shake, a); },
    gemCollected: () => { gems++; say(`Gem found! (${gems})`); },
  };
  player.onStep = () => sfx.step();
  player.onHurt = () => sfx.hurt();
  player.onSplash = () => sfx.splash();

  // ------------------------------------------------------------------ save / load

  const readSave = (): SaveData | null => {
    try { const s = localStorage.getItem(SAVE_KEY); return s ? (JSON.parse(s) as SaveData) : null; } catch { return null; }
  };

  const writeSave = () => {
    if (!entities) return;
    const data: SaveData = {
      seed: world.seed, edits: world.serializeEdits(), creative, time: dayTime, gems, collected: [...entities.collectedGems],
      player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, health: player.health },
      inv: inv.slots, selected: inv.selected,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* quota, ignore */ }
  };

  const starterKit = () => {
    inv = new Inventory();
    if (creative) {
      [B.GRASS, B.STONE, B.PLANKS, B.BRICK, B.GLASS, B.LAMP, B.TNT, B.LOG, B.WOOL_RED].forEach((id, i) => (inv.slots[i] = { id, count: 64 }));
    } else {
      inv.add(B.PLANKS, 16); inv.add(B.LAMP, 4); inv.add(B.TNT, 3); inv.add(Item.PORK, 2);
    }
  };

  const startWorld = (save: SaveData | null) => {
    const seed = save ? save.seed : params.has('seed') ? Number(params.get('seed')) | 0 : (Math.random() * 2 ** 31) | 0;
    world = new World(seed);
    entities = new EntityManager(world, hooks);
    if (save) {
      world.loadEdits(save.edits);
      creative = save.creative; dayTime = save.time; gems = save.gems;
      entities.collectedGems = new Set(save.collected);
      inv = new Inventory();
      inv.slots = save.inv.map((s) => (s ? { ...s } : null));
      inv.selected = save.selected;
      Object.assign(player, { x: save.player.x, y: save.player.y, z: save.player.z, yaw: save.player.yaw, pitch: save.player.pitch });
      player.vx = player.vy = player.vz = 0;
      player.health = save.player.health > 0 ? save.player.health : 20;
      player.dead = false;
    } else {
      dayTime = 0.08; gems = 0;
      starterKit();
      player.spawnAt(world, 8, 8);
      player.yaw = 0.6; player.pitch = -0.1;
    }
    player.creative = creative;
    state = 'loading';
    loadingTotal = 0;
  };

  // A world to look at behind the title screen.
  entities = new EntityManager(world, hooks);
  const existing = readSave();
  if (existing) { world = new World(existing.seed); world.loadEdits(existing.edits); entities = new EntityManager(world, hooks); }
  const titleCenter = existing ? [existing.player.x, existing.player.z] : [8, 8];

  // ------------------------------------------------------------------ environment

  const env: Environment = { sun: [1, 1, 1], fog: [176, 208, 245], zenith: [70, 130, 230], sunDir: [0, 1, 0], night: 0, time: 0, underwater: false };

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
    if (player.headInWater && state !== 'title') {
      env.fog = [env.fog[0] * 0.2 + 8, env.fog[1] * 0.4 + 24, env.fog[2] * 0.6 + 60];
      env.zenith = env.fog;
    }
    env.time = clock;
  };

  // ------------------------------------------------------------------ interaction

  const lookDir = (): [number, number, number] => [-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch)];

  const breakBlock = (h: RayHit) => {
    const id = h.block;
    world.setBlock(h.x, h.y, h.z, B.AIR);
    entities.blockBurst(h.x, h.y, h.z, id);
    sfx.breakBlock();
    if (!creative) {
      const drop = BLOCKS[id].drop ?? id;
      if (drop) entities.drop(drop, 1, h.x + 0.5, h.y + 0.3, h.z + 0.5);
    }
  };

  const interact = (dt: number) => {
    actionCooldown -= dt; placeCooldown -= dt; digSoundTimer -= dt;
    const d = lookDir();
    const ex = player.x, ey = player.y + EYE, ez = player.z;
    target = raycast(world, ex, ey, ez, d[0], d[1], d[2], REACH);
    const mobHit = entities.pick(ex, ey, ez, d[0], d[1], d[2], Math.min(3.6, target ? target.dist : 99));

    // Attack
    if (input.clicked[0] && mobHit) {
      player.swing = 1;
      mobHit.mob.damage(creative ? 100 : 4, d[0], d[2], entities);
      sfx.hit();
      breaking = null;
      return;
    }

    // Break
    if (input.buttons[0] && target && !mobHit) {
      if (creative) {
        if (actionCooldown <= 0) { actionCooldown = 0.16; player.swing = 1; breakBlock(target); }
        breaking = null;
      } else {
        if (!breaking || breaking.x !== target.x || breaking.y !== target.y || breaking.z !== target.z) breaking = { x: target.x, y: target.y, z: target.z, t: 0 };
        breaking.t += dt;
        if (player.swing <= 0.05) player.swing = 1;
        if (digSoundTimer <= 0) { digSoundTimer = 0.22; sfx.dig(); if (Math.random() < 0.6) entities.blockBurst(target.x, target.y, target.z, target.block, 2); }
        const hardness = BLOCKS[target.block].hardness;
        if (breaking.t >= hardness) { breakBlock(target); breaking = null; }
      }
    } else breaking = null;

    // Pick block
    if (input.clicked[1] && target && creative) inv.slots[inv.selected] = { id: target.block, count: 64 };

    // Place / use
    if (input.buttons[2] && placeCooldown <= 0) {
      const held = inv.held;
      if (input.clicked[2] && target && target.block === B.TNT) {
        placeCooldown = 0.25; player.swing = 1;
        entities.prime(target.x, target.y, target.z);
      } else if (held && held.id === Item.PORK) {
        if (input.clicked[2] && player.health < 20) { player.health = Math.min(20, player.health + 6); inv.consumeSelected(); sfx.eat(); placeCooldown = 0.3; }
      } else if (held && held.id < 100 && target) {
        const px = target.x + target.nx, py = target.y + target.ny, pz = target.z + target.nz;
        const there = world.getBlock(px, py, pz);
        const solid = BLOCKS[held.id].solid;
        if ((there === B.AIR || there === B.WATER) && py > 0 && py < 64 && !(solid && player.intersectsCell(px, py, pz))) {
          world.setBlock(px, py, pz, held.id);
          if (!creative) inv.consumeSelected();
          sfx.place();
          player.swing = 1;
          placeCooldown = 0.2;
        }
      }
    }
  };

  // ------------------------------------------------------------------ camera

  const placeCamera = (dt: number) => {
    const ex = player.x, ey = player.y + EYE, ez = player.z;
    const bobY = Math.abs(Math.sin(player.walkPhase)) * 0.07 * player.bob;
    const sprinting = Math.hypot(player.vx, player.vz) > 5.5;
    cam.fov += ((sprinting ? 84 : 75) - cam.fov) * Math.min(1, dt * 8);
    shake = Math.max(0, shake - dt * 1.4);
    const sh = shake * shake;
    const jx = (Math.random() - 0.5) * sh * 0.8, jy = (Math.random() - 0.5) * sh * 0.8;

    if (cameraMode === 0) {
      cam.x = ex + jx; cam.y = ey + (cameraMode === 0 ? bobY : 0) + jy; cam.z = ez;
      cam.yaw = player.yaw; cam.pitch = player.pitch;
    } else {
      const front = cameraMode === 2;
      const yaw = player.yaw + (front ? Math.PI : 0), pitch = front ? -player.pitch : player.pitch;
      const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
      const hit = raycast(world, ex, ey, ez, -fx, -fy, -fz, 4.5);
      const dist = Math.max(0.4, (hit ? hit.dist : 4.5) - 0.3);
      cam.x = ex - fx * dist + jx; cam.y = ey - fy * dist + jy; cam.z = ez - fz * dist;
      cam.yaw = yaw; cam.pitch = pitch;
    }
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
    if (playing || state === 'inventory') {
      if (input.pressed.has('KeyE')) {
        if (state === 'inventory') { inv.stashCursor(); state = 'playing'; input.lock(); }
        else { state = 'inventory'; input.unlock(); }
        sfx.click();
      } else if (input.pressed.has('Escape') && state === 'inventory') { inv.stashCursor(); state = 'playing'; input.lock(); }
    }
    if (playing) {
      if (input.pressed.has('F5') || input.pressed.has('KeyV')) cameraMode = (cameraMode + 1) % 3;
      if (input.pressed.has('KeyM')) showMap = !showMap;
      if (input.pressed.has('KeyT')) { dayTime = (dayTime + 0.125) % 1; say('Time skipped'); }
      if (input.pressed.has('KeyP') || (input.pressed.has('Escape') && !input.locked)) { state = 'paused'; pausedAt = clock; input.unlock(); writeSave(); }
      for (let i = 0; i < HOTBAR; i++) if (input.pressed.has('Digit' + (i + 1))) inv.selected = i;
      if (input.wheel) inv.selected = (inv.selected + Math.sign(input.wheel) + HOTBAR) % HOTBAR;
      if (input.clicked[0] && !input.locked) input.lock();
    }

    // --- simulation
    if (state === 'loading') {
      const pending = world.stream(player.x, player.z, 40, 12);
      loadingTotal++;
      if (!pending) { state = 'playing'; input.lock(); say(creative ? 'Creative mode: double tap Space to fly' : 'Survival mode: gather, craft, find gems'); }
    } else if (state === 'title') {
      world.stream(titleCenter[0], titleCenter[1], r3d.renderDistance, 6);
    } else {
      world.stream(player.x, player.z, r3d.renderDistance, 5);
    }

    if (playing || state === 'inventory' || state === 'dead') {
      dayTime = (dayTime + dt / DAY_LENGTH) % 1;
      if (playing && input.locked) player.look(input, 0.0024);
      player.update(world, input, dt, clock, playing);
      if (playing) interact(dt); else breaking = null;
      entities.update(dt, player, env.night);
      if (player.dead && state !== 'dead') { state = 'dead'; input.unlock(); cameraMode = 1; }
      saveTimer += dt;
      if (saveTimer > 15) { saveTimer = 0; writeSave(); }
    }

    // --- camera
    if (state === 'title') {
      const a = clock * 0.06;
      const cx = titleCenter[0], cz = titleCenter[1];
      cam.x = cx + Math.cos(a) * 26; cam.z = cz + Math.sin(a) * 26;
      const ground = world.hasChunk(Math.floor(cam.x) >> 4, Math.floor(cam.z) >> 4) ? world.topAt(Math.floor(cam.x), Math.floor(cam.z)) : 30;
      const wantY = Math.max(ground, world.hasChunk(Math.floor(cx) >> 4, Math.floor(cz) >> 4) ? world.topAt(Math.floor(cx), Math.floor(cz)) : 30) + 14;
      cam.y += (wantY - cam.y) * Math.min(1, dt * 1.5);
      cam.yaw = Math.atan2(cam.x - cx, cam.z - cz); cam.pitch = -0.38; cam.fov = 75;
      dayTime = (dayTime + dt / 120) % 1;
    } else placeCamera(dt);
    cam.setup(W, H);
    updateEnv();

    // --- 3D scene
    if (state !== 'loading') {
      r3d.begin(cam);
      r3d.drawSky(env);
      r3d.drawWorld(world);
      entities.draw(r3d, clock);
      if (cameraMode !== 0 && state !== 'title') {
        const amp = Math.min(0.9, Math.hypot(player.vx, player.vz) * 0.2) * (player.onGround ? 1 : 0.4);
        entities.drawModel(r3d, MODELS.avatar, player.x, player.y, player.z, player.yaw, player.walkPhase, amp, player.pitch, 0, player.hurtTimer, Math.sin(player.swing * Math.PI) * 1.4);
      }
      r3d.end(env);
      if (playing && target) r3d.drawSelection(target.x, target.y, target.z, breaking ? clamp(breaking.t / BLOCKS[target.block].hardness, 0, 1) : 0);
      else r3d.clearSelection();
    }

    // --- HUD and menus
    toastTimer = Math.max(0, toastTimer - dt);
    const info: HudInfo = {
      fps, debug, gems, toast, toastAlpha: Math.min(1, toastTimer), renderer: rendererName, thirdPerson: cameraMode !== 0, timeOfDay: dayTime,
      breakProgress: breaking && target ? clamp(breaking.t / BLOCKS[target.block].hardness, 0, 1) : 0,
      debugLines: debug ? [
        `ThorCraft | ${rendererName.toUpperCase()} | ${fps.toFixed(0)} fps (${frameAvg.toFixed(1)} ms)`,
        `polys ${r3d.stats.polys}  shapes ${r3d.stats.shapes}  chunks ${r3d.stats.chunks}`,
        `collect ${r3d.stats.collectMs.toFixed(1)} ms  emit ${r3d.stats.emitMs.toFixed(1)} ms`,
        `xyz ${player.x.toFixed(1)} ${player.y.toFixed(1)} ${player.z.toFixed(1)}  view ${r3d.renderDistance}`,
        `mobs ${entities.mobs.length}  drops ${entities.drops.length}  particles ${entities.particles.length}`,
        `canvas ${W}x${H} @${canvas.dpr.toFixed(2)}  seed ${world.seed}`,
      ] : [],
    };

    const inGame = state === 'playing' || state === 'inventory' || state === 'paused' || state === 'dead';
    hud.setMinimapVisible(inGame && showMap);
    if (inGame) {
      hud.drawGame(player, inv, info, clock);
      if (showMap) hud.drawMinimap(world, player, dt);
    }
    if (state === 'title') {
      const act = hud.drawTitle(!!readSave(), creative, rendererName, clock);
      if (act) { sfx.unlock(); sfx.click(); }
      if (act === 'play') startWorld(readSave());
      else if (act === 'new') { localStorage.removeItem(SAVE_KEY); startWorld(null); }
      else if (act === 'mode') creative = !creative;
      else if (act === 'renderer') {
        const next = rendererName === 'gl' ? 'wg' : rendererName === 'wg' ? 'sw' : 'gl';
        const u = new URL(location.href); u.searchParams.set('renderer', next); location.href = u.toString();
      }
    } else if (state === 'loading') {
      hud.drawLoading(clamp(loadingTotal / 40, 0, 0.98));
    } else if (state === 'paused') {
      const act = hud.drawPause(r3d.renderDistance, autoQuality);
      if (act) sfx.click();
      if (act === 'resume') { state = 'playing'; input.lock(); }
      else if (act === 'dist-') { autoQuality = false; r3d.renderDistance = Math.max(16, r3d.renderDistance - 8); }
      else if (act === 'dist+') { autoQuality = false; r3d.renderDistance = Math.min(96, r3d.renderDistance + 8); }
      else if (act === 'auto') autoQuality = !autoQuality;
      else if (act === 'quit') { writeSave(); location.reload(); }
      // Ignore the very Escape press that released the pointer lock.
      if (clock - pausedAt > 0.3 && (input.pressed.has('Escape') || input.pressed.has('KeyP'))) { state = 'playing'; input.lock(); }
    } else if (state === 'inventory') {
      if (hud.drawInventory(inv, creative)) sfx.click();
    } else if (state === 'dead') {
      if (hud.drawDead(gems) === 'respawn') {
        if (!creative) for (const s of inv.slots) if (s) entities.drop(s.id, s.count, player.x, player.y + 1, player.z);
        if (!creative) inv.slots.fill(null);
        player.spawnAt(world, 8, 8);
        cameraMode = 0;
        state = 'playing'; input.lock();
      }
    }
    el.style.cursor = input.locked ? 'none' : hud.hot ? 'pointer' : 'default';
    hud.end();

    // --- adaptive view distance
    if (autoQuality && playing) {
      qualityTimer += dt;
      if (qualityTimer > 1.5) {
        qualityTimer = 0;
        if (frameAvg > 22 && r3d.renderDistance > 24) r3d.renderDistance -= 4;
        else if (frameAvg < 14 && r3d.renderDistance < maxDistance) r3d.renderDistance += 2;
      }
    }

    canvas.update().render();
    input.endFrame();
    requestAnimationFrame(frame);
  };

  input.onLockChange = (locked) => {
    if (!locked && state === 'playing') { state = 'paused'; pausedAt = clock; writeSave(); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && state !== 'title') writeSave(); });
  el.addEventListener('mousedown', () => sfx.unlock());

  if (params.has('autoplay')) { creative = params.get('autoplay') === 'creative'; startWorld(params.has('fresh') ? null : readSave()); }
  if (params.has('max')) maxDistance = Number(params.get('max')) || 64;

  (window as any).__game = {
    get state() { return state; }, player, inv, r3d, cam, get world() { return world; }, get entities() { return entities; },
    setTime: (t: number) => { dayTime = t; }, setState: (s: State) => { state = s; },
    spawn: (kind: MobKind, dx: number, dz: number) => { const x = Math.floor(player.x + dx), z = Math.floor(player.z + dz); entities.mobs.push(new Mob(kind, x + 0.5, world.surfaceY(x, z), z + 0.5)); },
 setCamera: (m: number) => { cameraMode = m; }, stats: () => ({ fps, frameAvg, ...r3d.stats }),
  };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Failed to start: ' + (err?.message ?? err);
});
