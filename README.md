# ThorCraft

A voxel sandbox where world is drawn by [`@thorvg/webcanvas`](../thorvg.web/packages/webcanvas), a light-weight engine.

```bash
npm install
npm run dev        # http://localhost:5188
```

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows, Space, Shift, Ctrl or double W | move, jump / swim up, sneak (no falling off edges), sprint |
| Mouse, LMB, RMB, MMB | look, mine / attack, place / use / eat / ignite TNT, pick block (creative) |
| 1-9, wheel, Q | hotbar, drop one item |
| E | inventory with 2x2 crafting (survival) or the full item palette (creative) |
| RMB on a crafting table / furnace | 3x3 crafting, smelting |
| F5 or V | first person, third person back, third person front |
| Double Space or F | toggle flying (creative), Shift / C to descend |
| M, F3, Esc / P | minimap, debug overlay, pause (view distance, FOV, sensitivity, volume, game mode) |

In the item windows: LMB picks up / puts down / swaps, RMB splits a stack or places one item, Shift + click moves a stack.

URL parameters: `renderer=gl|wg|sw`, `seed=abc`, `dist=64` (fixed view distance),
`autoplay=creative|survival`, `fresh` (ignore the save), `debug`.

## What is in the game

- Infinite chunked terrain: oceans, beaches, plains, forests, deserts, snowy taiga, mountain ridges, caves with lava,
  ore veins, oak / birch / spruce trees, tall grass, flowers, cacti
- Vector pixel art: every 16x16 procedural texture is quantized and merged into rectangles, with 16 / 8 / 4 / 2 texel
  levels of detail picked by distance, plus ambient occlusion strips, sky exposure shadows and torch light
- Survival: mining times by tool type and tier, tool durability, drops, shaped crafting (40+ recipes), furnace smelting
  with fuel, food, health regeneration, fall / drowning / lava damage
- Mobs with box models and walk cycles: pigs, cows, sheep, zombies that burn at dawn, creepers that blow up
- Block physics: falling sand and gravel, spreading water, plants and torches popping off, TNT chain reactions
- Day/night cycle with gradient sky, sun, moon, stars, clouds, sunset tint and distance fog
- First person hand with the held block or item, third person avatar, particles, item drops, collectible gems,
  minimap, synthesized per-material sound
- World edits, inventory, furnaces and player state persist in `localStorage`
