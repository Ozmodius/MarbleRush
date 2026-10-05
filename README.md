# Marble Rush

A tilt-controlled marble maze for CrazyGames: short levels, characters with
their own feel, upgrades, stars and a daily maze. Spun out of
[3dBallSmack](https://github.com/Ozmodius/3dBallSmack)'s Marble Maze side game.

**Status: Phase 0 done.** The game boots and plays on its own, with no server:
home screen, level select, the 12 levels, coins and stars saved on the device
(or in the player's CrazyGames account). Characters, upgrades and more levels
are Phase 1 in [docs/PLAN.md](docs/PLAN.md).

## Commands

```sh
npm install
npm start         # http://localhost:8080 (scripts/serve.js)
npm test          # level verifier, hazards, tilt, progress rules, two browser tests
npm run build     # dist/crazygames/ + dist/marblerush-crazygames-<build>.zip
npm run levels    # regenerate mazeLevels.json (seeded, so it reproduces exactly)
```

The browser tests use the sandbox's Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `style.css`, `main.js` | The page, its styles, and boot (platform, renderer, save, home screen) |
| `mazeGame.js` | Physics, run loop, HUD wiring, level select |
| `sceneHost.js` | The one renderer, scene, camera, lights and render loop |
| `progressStore.js` | Coins, clears, best times and gold; the rules a clear must pass |
| `platform.js` | CrazyGames SDK: loading, gameplay start/stop, ads, save data |
| `mazeHazards.js`, `mazeTilt.js` | Ice and gates; tilt angle math (both pure) |
| `mazeTheme3d.js`, `mazeThemes.js`, `pbrTextures.js` | Level themes and their materials |
| `settings.js`, `uiSfx.js`, `inputTap.js` | Tilt sensitivity, UI sounds, tap handling |
| `mazeLevels.json` | The 12 levels, verified by `test_maze_levels.js` |
| `scripts/` | Dev server, CrazyGames build, level generator |

Copyright Ponotech LLC, all rights reserved. See [LICENSE](LICENSE).
