# Marble Rush

A tilt-controlled marble maze for CrazyGames: short levels, characters with
their own feel, upgrades, stars and a daily maze. Spun out of
[3dBallSmack](https://github.com/Ozmodius/3dBallSmack)'s Marble Maze side game.

**Status: Phase 0 done.** The game boots on its own with no server: level
select, ten levels of world 1, coins and power-ups, progress saved on the
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
npm test                      # levels, hazards, tilt, walls, pickups, progress store
npm run test:browser          # boot the page in Chromium and play level 1
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
| `mazeHazards.js` | Gates, ice, conveyors (pure) |
| `mazePickups.js` | Coins and power-ups (pure) |
| `mazeTilt.js` | Tilt angle math (pure) |
| `mazeWalls3d.js`, `mazeSurface3d.js`, `mazeTheme3d.js`, `mazeThemes.js` | Wall shapes, procedural surfaces, theme materials, theme catalog |
| `mazeProps3d.js` | Belts, coins, pickups as meshes |
| `sfx.js` | Synthesized UI sounds |
| `platform.js` | CrazyGames SDK, ads, save data; the only file that knows the platform. Still carries some Ball Smack-only features (rooms, invites, login) |
| `mazeLevels.json` | The levels, verified by `test_maze_levels.js` |
| `scripts/generateMazeLevels.js` | Seeded level generator |
| `scripts/buildCrazyGames.js` | The flat CrazyGames build |
| `scripts/themePreview.html` | Dev page: any level in any theme |

Copyright Ponotech LLC, all rights reserved. See [LICENSE](LICENSE).
