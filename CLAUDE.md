# CLAUDE.md -- Marble Rush

Guidance for Claude working in this repo. The plan and its decisions are in
`docs/PLAN.md`; read it first.

## Where this code came from

The maze was copied from `Ozmodius/3dBallSmack` @ `eaa3b6d` (its Marble Maze
side game). The two repos now evolve separately. A fix to the shared physics,
hazards, tilt math or generator should be ported to the other repo too; say so
in the PR when one applies.

Phase 0 cut the Ball Smack coupling with two seams, both keeping the function
names `mazeGame.js` already called:

- **`sceneHost.js`** replaces `scene3d.js`: `getScene`, `getCamera`, `onFrame`,
  `setExclusiveMode`, `requestRender`. It draws continuously only while the
  exclusive mode says it is active, so the maze MUST clear it on exit
  (`test_standalone_boot.js` checks the renderer idles on the home screen).
- **`progressStore.js`** replaces the server's maze ledger. `applyClear` is pure
  and keeps the server's rules (ladder, minMs, pay once, gold once);
  `test_progress_store.js` pins them. Saves go through `platform.js`'s
  `readSave`/`writeSave`: the CrazyGames SDK data module there, localStorage on
  the web.

## The bundle and the import map

`index.html`'s import map uses FLAT names (`./three.module.js`,
`./RoomEnvironment.js`, `./cannon-es.js`). `scripts/vendor.js` maps each to its
file in `node_modules`; `scripts/serve.js` serves them in development and
`scripts/build.js` copies them into the bundle. A new third-party module goes
in `vendor.js` and the import map together, or one of the two breaks.
`test_crazygames_build.js` builds the bundle and plays it against a stub SDK.

## Rules that carry over from Ball Smack

- **Levels are never trusted to the eye.** `test_maze_levels.js` BFS-solves
  every level, checks a ball 50% wider still fits, that no carved floor is cut
  off (the exit absorbs), and that every hole, ice patch and gate is reachable
  and meaningful. If the generator and the test disagree, the test is right.
- **The generator is seeded.** Regenerating must reproduce `mazeLevels.json`
  byte for byte; a reshuffle invalidates every tuned `minMs`/`goldMs`.
- **Tilt rotates GRAVITY, never the bodies.** Static walls keep frozen
  quaternions; the board's visible lean is cosmetic and decoupled.
- **Gates are kinematic bodies driven by velocity**, on the run's own clock,
  reset on restart, so every attempt sees the same gate phases.
- **Ice is a material swap on the one floor body**, never extra geometry.
- **No crumbling floor** until someone designs a soundness argument for it.
- **No browser dialogs** (`alert`/`confirm`): they throw CrazyGames players out
  of fullscreen.
- **Frame-rate assertions are ratios, not rates.** This sandbox throttles rAF.
  A browser test waits on frames, never on a wall clock.

## Rules that are new here

- **Upgrades and characters buy control and forgiveness, never top speed or a
  smaller ball.** Ball radius belongs to the world. A character or upgrade that
  changed either would void the verifier's guarantees and every gold time.
- **No server.** Progress is client-side (CrazyGames cloud save, localStorage
  for guests). Do not add a backend without the user's call; a leaderboard or a
  real-money purchase is what would change that.
- **No ad during a run, ever.** Midgame ads only at natural breaks; rewarded
  ads only on a tap the player chose. `platform.js`'s `showMidgameAd` /
  `showRewardedAd` already resolve false on the web and on any SDK failure.
- **The CrazyGames bundle is flat** (no folders): CrazyGames' drag-and-drop
  upload can drop subfolders. Ball Smack's `scripts/buildCrazyGames.js` is the
  model when the build script is written.
- **One codebase, two platforms** if a web build is added: only `platform.js`
  may know which platform it is on.

## Visual changes

For anything judged by eye (colours, camera framing, material look), check in
with the user with a screenshot before iterating further. Tilt feel can only be
judged on a real phone; the sandbox has no accelerometer.
