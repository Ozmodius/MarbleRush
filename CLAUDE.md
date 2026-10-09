# CLAUDE.md -- PlaneTilt

The game was called Marble Rush until 2026-10-06 (renamed: "Marble Rush" is a
registered VTech toy brand). The repo and the save key
(`marbleRush.progress.v1`) keep the old name; never change the save key, or
every player's progress is lost.

Guidance for Claude working in this repo. The plan and its decisions are in
`docs/PLAN.md`; read it first.

## Where this code came from

The maze was copied from `Ozmodius/3dBallSmack` @ `eaa3b6d` (its Marble Maze
side game). The two repos now evolve separately. A fix to the shared physics,
hazards, tilt math or generator should be ported to the other repo too; say so
in the PR when one applies.

Phase 0 cut the Ball Smack imports. What `mazeGame.js` borrowed now comes
through two seams: the **scene host** (`sceneHost.js`: `getScene`,
`getCamera`, `onFrame`, `setExclusiveMode`, `requestRender`, owning the one
renderer) and the **progress store** (`progressStore.js`: `load`,
`recordClear`, `spend`, saving through `platform.js`). `main.js` boots them.

## Running and testing

- `python3 -m http.server` in the repo root, open `/` (the importmap uses
  `node_modules`, so `npm install` first).
- `npm test` is the Node suite. `npm run test:browser` boots the page in
  Chromium and plays level 1; `npm run test:browser:bundle` does the same
  against the built CrazyGames bundle. Run the browser test for any change to
  `mazeGame.js`, `main.js`, `index.html` or the seams.
- `scripts/themePreview.html?level=w1_10&theme=lava` renders any level in any
  theme, for screenshots of visual changes.

## Rules that carry over from Ball Smack

- **Levels are never trusted to the eye.** `test_maze_levels.js` BFS-solves
  every level, checks a ball 50% wider still fits, that no carved floor is cut
  off (the exit absorbs), and that every hole, ice patch and gate is reachable
  and meaningful. If the generator and the test disagree, the test is right.
- **The generator is seeded.** Regenerating must reproduce `mazeLevels.json`
  byte for byte; a reshuffle invalidates every tuned `minMs`/`goldMs`. The
  daily maze pool (`dailyLevels.json`, `node scripts/generateMazeLevels.js
  --daily`) has its own seed range and must reproduce byte for byte too; the
  verifier checks every daily maze exactly like a ladder level.
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
- **The server is optional and local-first** (`server/`, added 2026-10-07 on
  the user's call, for cross-device saves and leaderboards). The device save
  (CrazyGames cloud save, localStorage for guests) is still the one the game
  plays from; `cloudSync.js` copies it up in the background and MERGES, never
  overwrites (`mergeProgress` in `progressStore.js`, which the server imports
  too -- change it in one place). Nothing in a run may wait on the network,
  and with no `PLANETILT_API_URL` the game must play exactly as before. A new
  save field needs a merge rule in `mergeProgress` and a case in
  `test_sync.js`. The server does saves, leaderboards, anonymous play
  tracking (per-level counts for the `/admin` stats page, 2026-10-08) and
  player accounts (2026-10-08); anything further (real-money purchases,
  personal data beyond an account's email) needs the user's call.
  `npm test` runs `server/` tests too (`npm ci --prefix server` first);
  `TEST_DATABASE_URL` runs them against a real Postgres.
- **The web build opens on its front door** (`features.requireLogin`, the
  user's call, 2026-10-08): the landing site, with CREATE ACCOUNT, SIGN IN
  and -- also the user's call, same day -- PLAY AS GUEST
  (`features.guestPlay`). A guest plays on the device's own save, synced as a
  guest; the choice is remembered on the device (`planetilt.guestPlay` in
  localStorage, never the save) and forgotten on sign-out or account delete.
  The CrazyGames build must never require an account (their rules: one click
  to gameplay, no account). All are platform.js flags -- never test the
  platform anywhere else to decide this.
- **No ad during a run, ever.** Midgame ads only at natural breaks; rewarded
  ads only on a tap the player chose. `platform.js`'s `showMidgameAd` /
  `showRewardedAd` already resolve false on the web and on any SDK failure.
- **The CrazyGames bundle is flat** (no folders): CrazyGames' drag-and-drop
  upload can drop subfolders. Ball Smack's `scripts/buildCrazyGames.js` is the
  model when the build script is written.
- **One codebase, two platforms**: only `platform.js` may know which platform
  it is on (it also holds the API URL, `apiBase()`).
- **A level keeps the screen on** (`wakeLock.js`, the user's call,
  2026-10-08): a tilt game gets no taps, so a phone would lock mid-run. The
  Screen Wake Lock first; where it is missing (older iPhones) or refused
  (CrazyGames' iframe may not allow it), a muted, invisible, looping 2-second
  clip, inlined as base64 because the bundle is flat. Held from entering a
  level to returning to the menus, never in the menus. `test_wake_lock.js`
  covers both paths with a stubbed `navigator.wakeLock`.

## Visual changes

For anything judged by eye (colours, camera framing, material look), check in
with the user with a screenshot before iterating further. Tilt feel can only be
judged on a real phone; the sandbox has no accelerometer.

## Sound

Every sound is **synthesised from the physics**, never a recorded file: the
roll follows the ball's speed and the surface under it, hits follow the speed
along the contact normal, hazards are heard from the same run clock that moves
them. That keeps the CrazyGames bundle free of audio files, and a marble that
speeds up, hits ice and clacks off a wall in one second sounds like it.

- `soundModel.js` is the numbers (surfaces, wall materials, marble voices,
  stereo), pure and tested in Node (`test_sound.js`). `soundEngine.js` makes
  them audible on ANY AudioContext. `sound.js` owns the page's one live
  context and every mute: the HUD's sound button (a device preference in
  localStorage, never the save), CrazyGames' mute, ads, a hidden tab.
  `mazeAudio.js` is the run's controller; `sfx.js` is the menus'.
- **Sound never changes the game** and never waits on anything. A failure is
  silent.
- **Sound is judged by ear**, like visuals by eye: `node scripts/renderSoundDemo.js`
  renders a tour of every sound to a WAV, and the user hears it before tuning
  goes further. The sandbox has no speakers; numbers (levels, counts) only
  prove nothing is silent or clipping.
