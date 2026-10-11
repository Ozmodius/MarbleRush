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

All three covers are one scene -- Magmars floor 10, the Ember marble with
the Flame trail -- framed for each shape, so the game is recognised in any
format (CrazyGames asks for consistent covers). Text is the wordmark only.

Each video opens on its cover (0.8 s), then four planets at floor 10 joined
mid-run (the Baron's cages on three of them), each in a different marble and
trail: Slipstonia (Prism, Aurora), Magmars (Ember, Flame), Bouncelot (Galaxy,
Rainbow), Gearth (Eight Ball, Gold Dust); then the wordmark on the home
planet (1.6 s). No audio, no cursor, no promotional text.

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

**Short description:** Tilt the board and roll to the rescue: 50 mazes on
five planets, a friend caged on every tenth floor, and secrets you only find
by exploring the mazes from the inside.

**Description:** Baron Von Ratchet has caged Rolle's friends deep in the
mazes of five planets. Tilt your phone (or use the arrow keys) to roll Rolle
through 50 mazes: a workbench that grows into a forest, snowy peaks and slick
ice, black rock over lava, a box of toy bricks, and the Baron's own steel
foundry. Every planet brings three new traps -- sliding gates, ice, wind,
lava flares, bumpers, crushers, live rails -- and holds a friend in a cage on
its tenth floor: free them and they join your crew, each with a trick of
their own. Beat a maze, then shrink down and explore it from the inside to
find the fuel cells that fly Rolle's ship to the next planet, and the pages of
the Baron's diary hidden behind walls that aren't walls. Race the medal clock
for gold, take on the daily maze, and grow each character's bond to upgrade
them.

**Controls:** Tilt the device; or arrow keys / WASD / drag. Explore mode: left
side to move, right side to look (or WASD + mouse).

**Ads (for the review):** break ads only when moving on from a cleared level
or leaving a level after a run, at most one every 3 minutes; rewarded ads only
on a button the player taps (continue after a fall, a free shield, a fuel
beacon while exploring, double coins, double daily reward, free coins, a free
crew upgrade, try a marble); banners on the Store, Crew and Gear pages only.
Never during a run.
