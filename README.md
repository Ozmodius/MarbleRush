# Marble Rush

A tilt-controlled marble maze for CrazyGames: short levels, characters with
their own feel, upgrades, stars and a daily maze. Spun out of
[3dBallSmack](https://github.com/Ozmodius/3dBallSmack)'s Marble Maze side game.

**Status: seed.** The maze code is copied over and its pure modules and tests
work; the game does not boot on its own yet. That is Phase 0 in
[docs/PLAN.md](docs/PLAN.md).

## What works today

```sh
npm install
npm test          # level verifier, hazard math, tilt math
npm run levels    # regenerate mazeLevels.json (seeded, so it reproduces exactly)
```

## Files

| File | What it is | State |
| --- | --- | --- |
| `mazeGame.js` | Physics, run loop, HUD wiring, level select | Still imports Ball Smack modules; Phase 0 cuts them |
| `mazeHazards.js` | Ice and moving gates | Pure, works |
| `mazeTilt.js` | Tilt angle math | Pure, works |
| `mazeTheme3d.js` | Theme to three.js materials | Works with `mazeThemes.js` |
| `mazeThemes.js` | Theme catalog (was Ball Smack's `cosmetics.js` mazeTheme block) | Works |
| `pbrTextures.js` | Texture loader for themes | Works |
| `platform.js` | CrazyGames SDK, ads, gameplay start/stop | Copied as-is; still carries Ball Smack-only features |
| `mazeLevels.json` | The 12 levels | Verified by `test_maze_levels.js` |
| `scripts/generateMazeLevels.js` | Seeded level generator | Works |

Copyright Ponotech LLC, all rights reserved. See [LICENSE](LICENSE).
