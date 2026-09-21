// Minecraft style cheat commands for the browser console. Development builds only (see main.ts):
//   cmd('/time set night')   cmd('/summon zombie ~ ~ ~5 3')   cmd('/give diamond_pickaxe')   cmd('/help')

import { B, BLOCKS, ITEMS, isBlockId } from './blocks';
import { EntityManager, Mob, MobKind } from './entities';
import { Inventory } from './inventory';
import { Player } from './player';
import { WH, World } from './world';

export interface CheatApi {
  player: Player;
  world(): World; entities(): EntityManager; inv(): Inventory;
  getTime(): number; setTime(t: number): void; addDays(n: number): void;
  setCreative(on: boolean): void; isCreative(): boolean;
  seed(): string; say(msg: string): void;
}

const MOBS: MobKind[] = ['pig', 'cow', 'sheep', 'zombie', 'creeper'];
const HOSTILE = new Set<MobKind>(['zombie', 'creeper']);
const TIMES: Record<string, number> = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };

/** Item lookup by Minecraft-like key ("oak_planks", "diamond_pickaxe") or numeric id. */
const itemKeys = new Map<string, number>();
for (const d of ITEMS.values()) { const k = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'); if (d.id !== B.AIR && !itemKeys.has(k)) itemKeys.set(k, d.id); }
itemKeys.set('water', B.WATER); itemKeys.set('lava', B.LAVA); itemKeys.set('air', B.AIR);

const HELP = `Cheat commands (dev only) - run with cmd('/...'):
  /time set <day|noon|sunset|night|midnight|sunrise|0-24000>    /time add <ticks>    /time query
  /summon <${MOBS.join('|')}> [x y z] [count]                   (coordinates accept ~ and ~offset)
  /give <item> [count]        /clear                            /items [filter]  lists item names
  /gamemode <survival|creative>                                 /fly
  /tp <x y z>                 /spawnpoint                       /seed
  /kill [mobs|hostile|drops|all|@s]                             /heal    /health <0-20>
  /setblock <x y z> <block>   /fill <x1 y1 z1> <x2 y2 z2> <block>
  /tnt [count]                /explode [power]`;

export function installCheats(api: CheatApi) {
  const out = (msg: string, ok = true) => { console.log(`%c${msg}`, `color:${ok ? '#6c4' : '#e55'};font-weight:bold`); if (ok) api.say(msg); return msg; };
  const fail = (msg: string) => out(msg, false);
  const p = api.player;

  /** Parses "12", "~" or "~-3" against a base value. */
  const coord = (tok: string | undefined, base: number): number => {
    if (tok === undefined || tok === '~') return base;
    if (tok.startsWith('~')) return base + Number(tok.slice(1));
    return Number(tok);
  };
  const coords = (a: string[], i: number): [number, number, number] | null => {
    const v: [number, number, number] = [coord(a[i], p.x), coord(a[i + 1], p.y), coord(a[i + 2], p.z)];
    return v.some(Number.isNaN) ? null : v;
  };
  const findItem = (tok: string): number | undefined => {
    const k = tok.toLowerCase().replace(/^minecraft:/, '');
    if (/^\d+$/.test(k)) return ITEMS.has(Number(k)) ? Number(k) : undefined;
    return itemKeys.get(k);
  };

  const run = (line: string): string => {
    const a = String(line).trim().replace(/^\//, '').split(/\s+/);
    const name = (a.shift() ?? '').toLowerCase();
    const world = api.world(), ents = api.entities(), inv = api.inv();
    switch (name) {
      case 'help': case '?': console.log(HELP); return HELP;

      case 'time': {
        if (a[0] === 'query') return out(`Time is ${Math.round(api.getTime() * 24000)} ticks`);
        const v = a[1] !== undefined && a[1] in TIMES ? TIMES[a[1]] : Number(a[1]);
        if (Number.isNaN(v)) return fail('Usage: /time set <day|night|...|ticks> | /time add <ticks> | /time query');
        if (a[0] === 'set') api.setTime((((v % 24000) + 24000) % 24000) / 24000);
        else if (a[0] === 'add') { const t = api.getTime() + v / 24000; api.addDays(Math.floor(t)); api.setTime(t - Math.floor(t)); }
        else return fail('Usage: /time <set|add|query> ...');
        return out(`Set the time to ${Math.round(api.getTime() * 24000)}`);
      }

      case 'summon': {
        const kind = (a[0] ?? '').toLowerCase().replace(/^minecraft:/, '') as MobKind;
        if (!MOBS.includes(kind)) return fail(`Unknown entity. Try: ${MOBS.join(', ')}`);
        // Without coordinates the mob appears a few blocks in front of the player.
        const pos = a.length >= 4 ? coords(a, 1) : ([p.x - Math.sin(p.yaw) * 4, NaN, p.z - Math.cos(p.yaw) * 4] as [number, number, number]);
        if (!pos) return fail('Bad coordinates');
        const count = Math.min(50, Math.max(1, Number(a[a.length >= 5 ? 4 : a.length === 2 ? 1 : 99]) || 1));
        for (let i = 0; i < count; i++) {
          const x = pos[0] + (i ? (Math.random() - 0.5) * 3 : 0), z = pos[2] + (i ? (Math.random() - 0.5) * 3 : 0);
          const y = Number.isNaN(pos[1]) ? world.surfaceY(Math.floor(x), Math.floor(z)) : pos[1];
          ents.mobs.push(new Mob(kind, x, y, z));
        }
        return out(`Summoned ${count} ${kind}${count > 1 ? 's' : ''}`);
      }

      case 'give': {
        // Accept both "/give diamond 3" and the vanilla "/give @s diamond 3".
        if (a[0]?.startsWith('@')) a.shift();
        const id = a[0] ? findItem(a[0]) : undefined;
        if (id === undefined || id === B.AIR) return fail(`Unknown item "${a[0] ?? ''}". Use /items to list names`);
        const count = Math.min(2304, Math.max(1, Number(a[1]) || 1));
        const left = inv.add(id, count);
        return out(`Gave ${count - left} ${ITEMS.get(id)!.name}${left ? ` (${left} did not fit)` : ''}`);
      }

      case 'items': {
        const list = [...itemKeys.keys()].filter((k) => !a[0] || k.includes(a[0].toLowerCase())).sort();
        console.log(list.join('  '));
        return list.join(' ');
      }

      case 'clear': inv.slots.fill(null); return out('Cleared the inventory');

      case 'gamemode': {
        const m = (a[0] ?? '').toLowerCase();
        if (!['survival', 'creative', 's', 'c', '0', '1'].includes(m)) return fail('Usage: /gamemode <survival|creative>');
        const on = m === 'creative' || m === 'c' || m === '1';
        api.setCreative(on);
        return out(`Set own game mode to ${on ? 'Creative' : 'Survival'} Mode`);
      }

      case 'fly': {
        if (!api.isCreative()) api.setCreative(true);
        p.flying = !p.flying; p.vy = 0;
        return out(`Flying ${p.flying ? 'on' : 'off'}`);
      }

      case 'tp': case 'teleport': {
        if (a[0]?.startsWith('@')) a.shift();
        const v = coords(a, 0);
        if (!v || a.length < 3) return fail('Usage: /tp <x y z>');
        p.x = v[0]; p.y = Math.min(WH + 40, v[1]); p.z = v[2]; p.vx = p.vy = p.vz = 0;
        return out(`Teleported to ${v.map((n) => n.toFixed(1)).join(', ')}`);
      }

      case 'spawnpoint': p.spawnAt(world, Math.floor(p.x), Math.floor(p.z)); return out('Moved to the nearest safe spot');
      case 'seed': return out(`Seed: [${api.seed()}]`);

      case 'kill': {
        const t = (a[0] ?? 'mobs').toLowerCase();
        if (t === '@s' || t === 'me') { p.damage(1000, true); return out('Killed yourself'); }
        let n = 0;
        if (t === 'mobs' || t === 'all' || t === 'hostile' || t === '@e') for (const m of ents.mobs) if (t !== 'hostile' || HOSTILE.has(m.kind)) { m.dead = true; n++; }
        if (t === 'drops' || t === 'all' || t === '@e') for (const d of ents.drops) { d.dead = true; n++; }
        return out(`Killed ${n} entities`);
      }

      case 'heal': p.health = 20; p.air = 10; return out('Healed');
      case 'health': { const v = Number(a[0]); if (Number.isNaN(v)) return fail('Usage: /health <0-20>'); p.health = Math.min(20, Math.max(0, v)); if (p.health <= 0) p.dead = true; return out(`Health set to ${p.health}`); }

      case 'setblock': case 'fill': {
        const from = coords(a, 0), to = name === 'fill' ? coords(a, 3) : from;
        const id = findItem(a[name === 'fill' ? 6 : 3] ?? '');
        if (!from || !to || id === undefined || !isBlockId(id)) return fail(name === 'fill' ? 'Usage: /fill <x1 y1 z1> <x2 y2 z2> <block>' : 'Usage: /setblock <x y z> <block>');
        const lo = from.map((v, i) => Math.floor(Math.min(v, to[i]))), hi = from.map((v, i) => Math.floor(Math.max(v, to[i])));
        if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 32768) return fail('Too many blocks (max 32768)');
        let n = 0;
        for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) if (world.setBlock(x, y, z, id)) n++;
        return out(`Changed ${n} block${n === 1 ? '' : 's'} to ${BLOCKS[id].name}`);
      }

      case 'tnt': {
        const n = Math.min(30, Math.max(1, Number(a[0]) || 1));
        for (let i = 0; i < n; i++) ents.primeAt(p.x - Math.sin(p.yaw) * 4 + (Math.random() - 0.5) * 2, p.y + 3 + i * 0.5, p.z - Math.cos(p.yaw) * 4 + (Math.random() - 0.5) * 2, 3 + Math.random());
        return out(`Primed ${n} TNT`);
      }

      case 'explode': ents.explode(p.x - Math.sin(p.yaw) * 6, p.y + 1, p.z - Math.cos(p.yaw) * 6, Math.min(8, Number(a[0]) || 4), p); return out('Boom');

      default: return fail(`Unknown command "${name}". Try cmd('/help')`);
    }
  };

  const w = window as any;
  w.cmd = (line: string) => { try { return run(line); } catch (e) { return fail(String(e)); } };
  console.log('%cThorCraft dev cheats enabled - type cmd(\'/help\')', 'color:#fc5;font-weight:bold');
}
