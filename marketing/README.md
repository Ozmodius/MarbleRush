# PlaneTilt — CrazyGames submission kit

Everything here is rendered from the real game by
`scripts/marketing/capture.cjs`, not mocked up. Re-run it after a visual
change so the listing never drifts from what players get.

| File | Use |
| --- | --- |
| `../dist/planetilt-crazygames.zip` | The game upload. Built by `npm run build:crazygames`: flat (no folders), `index.html` at the root, CrazyGames SDK v3. Not committed (dist/ is build output). |
| `cover-landscape-1920x1080.png` | Landscape cover (16:9): Toy Box, level 10 |
| `cover-portrait-800x1200.png` | Portrait cover (2:3): Magma Works, level 10 |
| `cover-square-800x800.png` | Square cover (1:1): the Workshop grown to forest, level 10 |
| `video-landscape-1920x1080.mp4` | Landscape gameplay video: level 10 of all five worlds with a chase camera, a first-person walk, then the logo |
| `video-portrait-1080x1920.mp4` | Portrait gameplay video: the same runs from the game's own overhead camera |

Sizes follow CrazyGames' usual asks (covers 1920×1080, 800×1200, 800×800;
gameplay videos ~20 s, H.264 MP4, no audio). Their developer docs could not
be reached from the build machine, so check the current requirements on the
submission page before uploading; `capture.cjs` takes any size.

## Regenerating

```
npm install
node scripts/marketing/capture.cjs covers            # all three covers
node scripts/marketing/capture.cjs covers portrait   # just one
node scripts/marketing/capture.cjs video             # both videos (slow: renders every frame)
node scripts/marketing/capture.cjs route w4_08       # check a level's autopilot route
npm run build:crazygames                             # the zip
```

Every shot uses a world's level 10, where its look has fully arrived and all
three of its traps are in play. The game runs on a frozen clock and is stepped one 30 fps frame at a time, so
the videos are smooth however slowly the machine renders. An autopilot follows
a planned route by tilting (the board leans as it would in a player's hands);
the cinematic shots use a debug-only camera override (`__mazeDebug.cameraOverride`),
and `__mazeDebug.captureNoKnockOut` stops a trap the autopilot cannot time
from ending a capture run. Both are debug-surface only, never set in play.

## Suggested listing text

**Title:** PlaneTilt

**Short description:** Tilt the board, roll the marble, escape the maze. 50
hand-checked levels across five worlds — then walk them in first person.

**Description:** Tilt your phone (or use the arrow keys) to roll a marble
through 50 mazes across five worlds: a workshop that grows into a forest, a
glacier, a lava foundry, a toy box and a steel works. Every world brings new
traps — sliding gates, ice, wind, lava flares, bumpers, crushers — and a prize
that helps in the next. Chase gold times, collect coins, unlock marbles,
skins and trails, take on the daily maze, and once a level is beaten, walk it
yourself in first person.

**Controls:** Tilt the device; or arrow keys / WASD / drag. Walk mode: left
side to move, right side to look (or WASD + mouse).
