# PlaneTilt

A tilt-controlled marble maze for CrazyGames: short levels, characters with
their own feel, upgrades, stars and a daily maze. Spun out of
[3dBallSmack](https://github.com/Ozmodius/3dBallSmack)'s Marble Maze side game.

**Status: Phase 0 done.** The game boots on its own with no server: level
select, all five launch worlds (Workshop to forest, Glacier, Magma Works, Toy Box, Foundry), ten levels each, coins and power-ups, progress saved on the
device (CrazyGames cloud save when signed in). See [docs/PLAN.md](docs/PLAN.md)
for what comes next.

## Run it

```sh
npm install
python3 -m http.server     # then open http://localhost:8000/
```

Arrow keys / WASD or drag to tilt on desktop; the phone's tilt sensor on a phone.

## Play it on your phone

Phones only hand the tilt sensor to pages served over **HTTPS**, so there are
two ways, depending on whether you want tilt.

**With tilt (HTTPS through a free tunnel).** On your computer, in the repo:

```sh
npm install
npm run build:crazygames                         # one flat bundle in dist/crazygames
python3 -m http.server 8000 -d dist/crazygames   # leave this running
npx cloudflared tunnel --url http://localhost:8000   # second terminal; no account needed
```

`cloudflared` prints an address like `https://some-words.trycloudflare.com`.
Open it on the phone (any network), tap a world, tap **PLAY**, then
**START**. iPhone asks to allow motion: allow it. Hold the phone how you want
"level" to be when you tap START; that pose is the zero. Lock the screen to
portrait so it doesn't rotate when you lean.

**Without tilt (same Wi-Fi, plain HTTP).** Faster to set up, and you steer by
dragging a finger on the board instead:

```sh
npm install
python3 -m http.server 8000 --bind 0.0.0.0
```

Find your computer's address on the network (macOS: `ipconfig getifaddr en0`;
Windows: `ipconfig`, the IPv4 address; Linux: `hostname -I`) and open
`http://<that address>:8000/` on the phone, on the same Wi-Fi.

Progress is saved in the phone's browser per address, so a new tunnel address
starts a new save. After changing code, rebuild (`npm run build:crazygames`)
and reload the page.

## Test and build

```sh
npm test                      # levels, hazards, tilt, walls, pickups, progress store, shop, forest
npm run test:browser          # boot to home, use the tabs, play level 1, shop, pick a marble
npm run levels                # regenerate mazeLevels.json (seeded, reproduces exactly)
npm run build:crazygames      # flat bundle + dist/planetilt-crazygames.zip
npm run test:browser:bundle   # the browser test against that bundle
```

## Files

| File | What it is |
| --- | --- |
| `index.html`, `style.css`, `main.js` | The page and its boot |
| `sceneHost.js` | Renderer, scene, camera, frame loop (Phase 0 seam) |
| `progressStore.js` | Ladder, best times, coins, wallet, prizes; saves via `platform.js` (Phase 0 seam) |
| `mazeGame.js` | Physics, run loop, HUD, level select |
| `mazeHazards.js` | Gates, ice, conveyors, wind fans, icicles, lava seams, molten gates, geysers, bumpers, spring pads, spinning arms, magnets, crushers, electric rails (pure) |
| `mazePickups.js` | Coins and power-ups (pure) |
| `mazeTilt.js` | Tilt angle math (pure) |
| `mazeWalls3d.js`, `mazeSurface3d.js`, `mazeTheme3d.js`, `mazeThemes.js` | Wall shapes, procedural surfaces, theme materials, theme catalog |
| `mazeProps3d.js`, `toyProps3d.js`, `foundryProps3d.js` | Belts, coins, pickups and every trap as meshes |
| `toyWalls3d.js` | World 4's plastic brick walls |
| `forestDressing.js` | World 1's forest as numbers: which walls are trees, trunks, roots, leafy canopies, all held to the physics (pure; `test_forest.js`) |
| `forest3d.js`, `levelDressing3d.js` | Forest meshes and the floor's path mask; the shared floor-and-walls builder |
| `shopCatalog.js` | Marbles, upgrades, power-ups, prize refills: prices and effects (pure) |
| `menus.js` | Bottom tab bar (Home, Gear, Worlds, Store) and the home screen's HUD |
| `planet3d.js` | The home screen's planet: the current world as a marble, your marble as its moon |
| `solarSystem3d.js` | The Worlds tab: launch worlds orbiting a sun; drag to spin it, tap a planet to pick a world |
| `worlds.js` | World names, and how many worlds the launch shows |
| `shopUi.js` | The store and gear (profile) pages |
| `sfx.js` | Synthesized UI sounds |
| `platform.js` | CrazyGames SDK, ads, save data; the only file that knows the platform. Still carries some Ball Smack-only features (rooms, invites, login) |
| `mazeLevels.json` | The levels, verified by `test_maze_levels.js` |
| `scripts/generateMazeLevels.js` | Seeded level generator |
| `scripts/buildCrazyGames.js` | The flat CrazyGames build |
| `scripts/themePreview.html` | Dev page: any level in any theme |

Copyright Ponotech LLC, all rights reserved. See [LICENSE](LICENSE).
