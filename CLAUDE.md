# CLAUDE.md -- Marble Rush

Guidance for Claude working in this repo. The plan and its decisions are in
`docs/PLAN.md`; read it first.

## Where this code came from

The maze was copied from `Ozmodius/3dBallSmack` @ `eaa3b6d` (its Marble Maze
side game). The two repos now evolve separately. A fix to the shared physics,
hazards, tilt math or generator should be ported to the other repo too; say so
in the PR when one applies.

Still coupled to Ball Smack, and Phase 0's job to cut: `mazeGame.js` imports
`state.js`, `socket.js`, `scene3d.js`, `cosmetics.js`, `inputTap.js`,
`uiSfx.js`, `diagnostics.js` and `settings.js`, none of which exist here. The
plan replaces them with two seams: a **scene host** (`getScene`, `getCamera`,
`onFrame`, `setExclusiveMode`, `requestRender`, owning its own renderer) and a
**progress store** (`load`, `recordClear`, `spend`).

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
