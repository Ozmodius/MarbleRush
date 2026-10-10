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
- **Physics runs on real time at any refresh rate** (2026-10-08). The frame
  loop steps whole FIXED_STEPs and CARRIES the remainder (`simCarryMs`); the
  ball is drawn between its last two steps. Never round a frame up to a step:
  that ran the marble 2.4x fast at 144 Hz (a CrazyGames QA check, and unfair
  gold times). `test_maze_boot.js` checks 30/60/120/144/165 Hz agree, in ONE
  page.evaluate (the page's own rAF must not slip frames in between).

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
- **A new player is one tap from playing** (2026-10-08, CrazyGames' Full
  Launch rule): with no clears, boot opens level 1's ready screen
  (`isNewPlayer`, main.js) -- except behind the web's sign-in front door
  (`features.requireLogin` with a server). The daily calendar never pops up
  before the first clear. Keys start a run on a computer (Space, Enter, an
  arrow), and the ready line speaks keys or tilt by the device.
- **Between levels, NEXT is the one bright choice** (2026-10-09). The CLEARED
  line (time, medal, pay) stays up; what else a clear brought -- level up,
  mission, prize, the daily maze unlocked -- goes on the line under it
  (`#mazeStatus2`), never over it. Space/Enter on the CLEARED panel is NEXT
  (REPLAY when there is none). EXPLORE IT dresses as a secondary button there.
- **Today's daily reward can be claimed from the CLEARED panel** (the DAY n
  GIFT button, 2026-10-09): new players boot into level 1 and may never see
  home, so without it they never claimed day 1 or started a streak. Every
  claim -- there or in the calendar -- names tomorrow's reward
  (`daily.tomorrowDaily`, `rewardText`); the calendar marks tomorrow's tile.
- **The first three levels forgive a first fall** (the beginner's shield,
  2026-10-09): until levels 1-3 are each first cleared, every attempt at
  them starts shielded, free (a bought shield is left unspent; no ad shield
  is offered there). Their shortest routes run along a hole's edge, and the
  levels are seeded and verified, so forgiveness is added rather than
  editing them. With no tilt sensor steering, the hint is in the device's
  words (`manualHintText`: a phone is told to drag).
- **A failed first connect retries in 3 s, then 10 s, then every 30 s**
  (`cloudSync.js` RETRY_STEPS_MS): a busy phone at boot can miss the 10 s
  request timeout, and a 30 s wait left a new player unsaved.
- **Nothing renders behind the landing site** (`sceneHost.setCovered`): the
  spinning home planet cost a visitor's CPU and battery while they read it.
- **The privacy policy lives in the game** (`privacy.js`, an in-game panel
  from Gear, the landing footer and a new player's line under START when a
  server is on). It must stay TRUE to `server/`: change it with anything the
  server starts keeping.
- **No ad during a run, ever.** Midgame ads only at natural breaks; rewarded
  ads only on a tap the player chose. Leaving a level is a break only if a
  run was played on that visit (`ranThisVisit`). `platform.js`'s `showMidgameAd` /
  `showRewardedAd` already resolve false on the web and on any SDK failure.
- **The CrazyGames bundle is flat** (no folders): CrazyGames' drag-and-drop
  upload can drop subfolders. Ball Smack's `scripts/buildCrazyGames.js` is the
  model when the build script is written.
- **One codebase, two platforms**: only `platform.js` may know which platform
  it is on (it also holds the API URL, `apiBase()`).
- **The rescue** (`rescue.js`, the user's call, 2026-10-09; docs/PLAN.md):
  each world's floor 10 holds a friend of Rolle's (the classic marble) in a
  cage, and the exit stays locked until the ball rolls into it. The cage's
  spot is COMPUTED from the level (`captiveSpot`), never written into
  `mazeLevels.json`; `test_rescue.js` proves each one safe, reachable (also
  50% wider) and off the route -- if it disagrees with rescue.js, the test is
  right. The freed friend is drawing only (`captive3d.js`: no body, follows
  the ball's own path). A rescued friend's marble obeys the marble rule
  above and is never sold or tried by ad. Display names are the cast
  (Rolle, Sterling, Bumper, Glint, Pip, Flurry, Cinder, Bobble, Rivet); ids
  never change.
- **Between levels, a short show, never a wait** (`levelShow.js`, the
  user's call, 2026-10-09): every level opens on the marble dropping onto
  the start, a planet's first level on Rolle's ship (`ship3d.js`) beaming it
  down, and a cleared floor 10 ends on the ship beaming it up and flying off
  over the board. All drawing: the ball's body is on the start (or the exit)
  throughout, START ends a show at once, and every show is under three
  seconds (`test_level_show.js`). Timed by frame time, never the wall clock.
- **Home's planet is the level select** (`homeSites.js`, the user's call,
  2026-10-09): its ten levels are landing sites on a trail up the planet's
  face, floor 10 at the summit, a button on each (menus.js, placed where
  mazeGame.js projects them). Every site faces the camera and sits a finger
  apart (`test_home_sites.js`), so the ground holds still (a slow sway) and
  only the clouds drift. Tapping an open site makes it what PLAY starts
  (memory only; back from a level, PLAY offers what is next again). A swipe
  that starts on a site is still a swipe. Rolle's ship (`ship3d.js`) circles
  the planet with the player's marble in its dome.
- **Each world's sky is its planet far below** (`backdrop3d.js`, the user's
  call, 2026-10-10): round the board, the planet's own surface (home's
  planet material, on a sphere cap faced at the equator -- the patterns snow
  over the poles) under that world's weather (clouds, snow, embers, bubbles,
  sparks). The ground's shader is the planet's and costly, so it is drawn
  ONCE per level into a texture (`bake`); only a couple of hundred weather
  points move per frame. Rolling only; walking keeps the plain sky.
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
