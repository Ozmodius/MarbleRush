# Marble Rush

A tilt-controlled marble maze for CrazyGames: short levels, characters with
their own feel, upgrades, stars and a daily maze. Spun out of
[3dBallSmack](https://github.com/Ozmodius/3dBallSmack)'s Marble Maze side game.

**Status: Phase 0 done.** The game boots on its own with no server: level
select, worlds 1-4 (Workshop to forest, Glacier, Magma Works, Toy Box), ten levels each, coins and power-ups, progress saved on the
device (CrazyGames cloud save when signed in). See [docs/PLAN.md](docs/PLAN.md)
for what comes next.

## Run it

```sh
npm install
python3 -m http.server     # then open http://localhost:8000/
```

Arrow keys / WASD or drag to tilt on desktop; the phone's tilt sensor on a phone.

## Test and build

```sh
npm test                      # levels, hazards, tilt, walls, pickups, progress store, shop, forest
npm run test:browser          # boot to home, use the tabs, play level 1, shop, pick a marble
npm run levels                # regenerate mazeLevels.json (seeded, reproduces exactly)
npm run build:crazygames      # flat bundle + dist/marble-rush-crazygames.zip
npm run test:browser:bundle   # the browser test against that bundle
```

## Files

| File | What it is |
| --- | --- |
| `index.html`, `style.css`, `main.js` | The page and its boot |
| `sceneHost.js` | Renderer, scene, camera, frame loop (Phase 0 seam) |
| `progressStore.js` | Ladder, best times, coins, wallet, prizes; saves via `platform.js` (Phase 0 seam) |
| `mazeGame.js` | Physics, run loop, HUD, level select |
| `mazeHazards.js` | Gates, ice, conveyors, wind fans, icicles, lava seams, molten gates, geysers (pure) |
| `mazePickups.js` | Coins and power-ups (pure) |
| `mazeTilt.js` | Tilt angle math (pure) |
| `mazeWalls3d.js`, `mazeSurface3d.js`, `mazeTheme3d.js`, `mazeThemes.js` | Wall shapes, procedural surfaces, theme materials, theme catalog |
| `mazeProps3d.js` | Belts, coins, pickups as meshes |
| `forestDressing.js` | World 1's forest as numbers: which walls are trees, trunks, roots, leafy canopies, all held to the physics (pure; `test_forest.js`) |
| `forest3d.js`, `levelDressing3d.js` | Forest meshes and the floor's path mask; the shared floor-and-walls builder |
| `shopCatalog.js` | Marbles, upgrades, power-ups, prize refills: prices and effects (pure) |
| `menus.js` | Bottom tab bar (Home, Gear, Worlds, Store) and the home screen's HUD |
| `planet3d.js` | The home screen's planet: the current world as a marble, your marble as its moon |
| `solarSystem3d.js` | The Worlds tab: launch worlds orbiting a sun, tap a planet to pick a world |
| `worlds.js` | World names, and how many worlds the launch shows |
| `shopUi.js` | The store and gear (profile) pages |
| `sfx.js` | Synthesized UI sounds |
| `platform.js` | CrazyGames SDK, ads, save data; the only file that knows the platform. Still carries some Ball Smack-only features (rooms, invites, login) |
| `mazeLevels.json` | The levels, verified by `test_maze_levels.js` |
| `scripts/generateMazeLevels.js` | Seeded level generator |
| `scripts/buildCrazyGames.js` | The flat CrazyGames build |
| `scripts/themePreview.html` | Dev page: any level in any theme |

Copyright Ponotech LLC, all rights reserved. See [LICENSE](LICENSE).
