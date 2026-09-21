# ThorCraft

A voxel sandbox where world is drawn by [`@thorvg/webcanvas`](../thorvg.web/packages/webcanvas), a light-weight engine.

```bash
npm install
npm run dev        # http://localhost:5188
```

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows, Space, Shift | move, jump / swim up, sprint |
| Mouse, LMB, RMB, MMB | look, break / attack, place / use / ignite TNT, pick block (creative) |
| 1-9, wheel | hotbar |
| E | inventory, crafting (survival) or block palette (creative) |
| F5 or V | first person, third person back, third person front |
| Double Space or F | toggle flying (creative), C / Q to descend |
| T, M, F3, Esc / P | skip time, minimap, debug overlay, pause |

URL parameters: `renderer=gl|wg|sw`, `seed=123`, `dist=64` (fixed view distance),
`autoplay=creative|survival`, `fresh` (ignore the save), `debug`.

## What is in the game

- Infinite chunked terrain: plains, forests, deserts, snow, mountains, oceans, caves, ores, trees
- Survival (health, fall damage, drowning, mining times, drops, crafting, food) and creative modes
- Day/night cycle with gradient sky, sun, moon, stars, clouds, sunset tint and distance fog
- Sky exposure shadows and lamp lighting baked into the chunk meshes
- Mobs with box models and walk cycles: pigs, sheep, zombies that hunt at night and burn at dawn
- TNT with chain reactions, particles, item drops, collectible gems, minimap, synthesized sound
- World edits, inventory and player state persist in `localStorage`

