# PlaneTilt — CrazyGames submission kit

Everything here is rendered from the real game by
`scripts/marketing/capture.cjs`, not mocked up. Re-run it after a visual
change so the listing never drifts from what players get.

| File | Use |
| --- | --- |
| `../dist/planetilt-crazygames-v<version>-<commit>.zip` | The game upload. Built by `npm run build:crazygames`: flat (no folders), `index.html` at the root, CrazyGames SDK v3. Not committed (dist/ is build output). |
| `cover-landscape-1920x1080.png` | Landscape cover (16:9) |
| `cover-portrait-800x1200.png` | Portrait cover (2:3) |
| `cover-square-800x800.png` | Square cover (1:1) |
| `video-landscape-1920x1080.mp4` | Landscape preview video, 18.4 s |
| `video-portrait-1080x1620.mp4` | Portrait preview video (2:3), 18.4 s |

All three covers are one scene -- Magma Works level 10, the Ember marble with
the Flame trail -- framed for each shape, so the game is recognised in any
format (CrazyGames asks for consistent covers). Text is the wordmark only.

Each video opens on its cover (0.8 s), then four worlds at level 10 joined
mid-run, each in a different marble and trail: Slipstonia (Prism, Aurora),
Magma Works (Ember, Flame), Bouncelot (Galaxy, Rainbow), Foundry (Eight Ball,
Gold Dust); then the wordmark (1.6 s). No audio, no cursor, no promotional text.

Checked against CrazyGames' docs on 2026-10-08
(docs.crazygames.com/requirements/game-covers): covers 1920×1080, 800×1200,
800×800 with no borders and only the title as text; videos at most 20 s and
50 MB, no audio, landscape 1080p 16:9 and portrait 1080p 2:3, opening on the
cover. Re-check before a new submission; `capture.cjs` takes any size.

## Regenerating

```
npm install
node scripts/marketing/capture.cjs covers            # all three covers
node scripts/marketing/capture.cjs covers portrait   # just one
node scripts/marketing/capture.cjs video             # both videos (slow: renders every frame)
node scripts/marketing/capture.cjs route w4_08       # check a level's autopilot route
node scripts/marketing/capture.cjs landing           # the web landing site's pictures (landing/*.jpg)
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
hand-checked levels across five worlds — then explore them from the inside.

**Description:** Tilt your phone (or use the arrow keys) to roll a marble
through 50 mazes across five worlds: a workshop that grows into a forest, a
glacier, a lava foundry, a toy box and a steel works. Every world brings new
traps — sliding gates, ice, wind, lava flares, bumpers, crushers — and a prize
that helps in the next. Chase gold times, collect coins, unlock marbles,
skins and trails, take on the daily maze, and once a level is beaten, explore it
from inside the maze.

**Controls:** Tilt the device; or arrow keys / WASD / drag. Explore mode: left
side to move, right side to look (or WASD + mouse).
