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
  `mazeGame.js`, `main.js`, `index.html` or the seams -- against the two
  builds players get ONLY (the user's call, 2026-10-10): `MAZE_ROOT=dist/web`
  and `MAZE_ROOT=dist/crazygames`, built first with
  `node scripts/buildCrazyGames.js` (`--web`). Not the unbundled source.
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
- **Every level is harder than the last** (the user's call, 2026-10-13: "the
  game is too easy"). Across all fifty, in order: the board only grows, the
  grid only gets finer (as each planet's marble and traps allow), the loops
  thin (`braid` 0.22 to none), and each level SCORES above the one before --
  its route in marble widths plus 4 per junction on it, the route never under
  92% of the last's (`pickLevel` in the generator; `test_maze_levels.js` reads
  the score back from the walls). The generator fails loudly rather than ship
  a level that does not climb.
- **Boards grow past the screen** (the user's call, 2026-10-13: "bigger levels
  but display the same amount of maze, just focus on the marble"): 9 x 14 for
  the first floors, up to 13.5 x 21.5 on the last; the last level is centre
  out (start in the middle, exit on the edge). Rolling, a board up to 9 x 14
  is seen whole as always; a bigger one through a window that follows the
  marble and closes in as boards widen -- today's view up to 9 wide, 70% of
  it at 13.5 and wider (`viewScale`, the user's pick, 2026-10-13) --
  (`computeCameraPose`); the lean pivots under the view (`pivotLean`); the
  sun's shadow box follows it (`sceneHost.setShadowFocus`); every wall is ONE
  static physics body (a body per wall cost ~3 ms a step at 450 walls).
  Traps scale with the board (the user's call, 2026-10-13): a slot's trap
  counts are for 9 x 14, multiplied by the board's area over that and by
  1.44 (`TRAP_MORE`, 2026-10-14: 20% more everywhere, then 20% more again,
  holes included) (`slotConfig` in the
  generator); coins do not scale. Holes are as big as their corridor allows
  with a lane left for the marble's CENTRE (`HOLE_CENTRE_LANE`, the ball
  falls only when its centre is over one: "a danger, but passable"), set
  ACROSS their corridor against a closed face, and never on a wall (the
  user's call, 2026-10-14): at least `HOLE_WALL_CLEAR` (0.06) of floor shows
  between every hole and every wall and the board's edge (`holeWallGap` in
  mazeHazards.js; the generator places to it, the verifier holds it).
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
  personal data beyond an account's email) needs the user's call. The
  `/admin` page (ADMIN_TOKEN; the user's call, 2026-10-11) is PLAYERS and
  METRICS, both filtered by PLATFORM (web | crazygames): the build says
  which in every session and event (cloudSync's `platform`, from
  platform.js via main.js); a player keeps the last, the counts carry it
  ('unknown' before). Its player actions -- rename, sign out everywhere,
  off the leaderboards, delete (the name typed to confirm) -- are logged
  `[admin]` in the server's log.
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
- **Nothing renders behind the landing site, Gear, Crew or Store**
  (`sceneHost.setCovered(on, why)`): the spinning home planet cost a
  visitor's CPU and battery while they read a page over it. A new cover
  draws one last frame, then the scene holds still until every cover lifts.
- **The privacy policy lives in the game** (`privacy.js`, an in-game panel
  from Gear, the landing footer and a new player's line under START when a
  server is on). It must stay TRUE to `server/`: change it with anything the
  server starts keeping.
- **No ad during a run, ever.** Midgame ads only at natural breaks; rewarded
  ads only on a tap the player chose. Leaving a level is a break only if a
  run was played on that visit (`ranThisVisit`). `platform.js`'s `showMidgameAd` /
  `showRewardedAd` already resolve false on the web and on any SDK failure.
  The ad map (reviewed 2026-10-11 for CrazyGames): BREAK ads on moving on
  from CLEARED and on leaving a level after a run; REWARDED for CONTINUE
  after a fall, FREE SHIELD and -- exploring a maze whose cell is still
  hidden -- FUEL BEACON (a beam over the cell for that visit, a hint only)
  on a ready screen, x2 COINS on CLEARED, the daily double, free coins
  (home, store), a free crew step and TRY a marble; BANNERS on Store, Crew
  and Gear. Never sell or rent progress: no ad ever grants a fuel cell, a
  diary page or a friend.
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
- **The interface is a spacecraft's** (the user's call, 2026-10-10): deep
  navy glass panels with a cyan edge, gold kept for buttons and highlights,
  every card a raised plate (`--bevel` in style.css). Home carries the rescue
  tracker (the five friends, caged or freed); the coin counter says COINS
  (GOLD is a medal). The story speaks in rescue.js's lines: the Baron on a
  planet's first level (never Sawturn's -- a new player's first screen keeps
  its how-to) and bragging about his traps ahead on floors 3, 6 and 9 of
  every planet (the user's call, 2026-10-15; floor 9's names the friend's
  cage one floor up while it holds them: `baronFloorLine`), a freed friend
  pointing to the next planet. The RESCUE CARD opens a planet (the user's
  call, 2026-10-15): on its floor 1, rolling, once a device, while the
  friend is still caged on floor 10 -- never on floor 10 itself. Its GO
  starts the run, so a new player whose first screen it is stays one tap
  from playing; the first card ever ends on how to steer (device words).
- **Fuel cells fly the ship** (`fuel.js`, the user's call, 2026-10-10): one
  in every ladder level's deepest dead end, found in EXPLORE MODE ONLY (the
  user's call, 2026-10-11: the one thing a world needs explored -- a rolling
  run never shows or takes one; Explore opens on a rolled clear), found by the shared spot finder
  (`levelSpots.js`, which the rescue's cage uses too -- never written into
  `mazeLevels.json`; `test_fuel.js` proves each safe, reachable also 50%
  wider, a real detour). Banked by a clear (like coins), kept for good
  (`fuel` in the save, merged by union). A planet's first level needs the
  planet before's cells: 3 for Slipstonia, 5 for Magmars, 7 after
  (`fuelGate`, inside `isUnlocked`). A planet already played on is never
  shut, fuel or not. Gold times are untouched: a gold run need not fetch it.
- **The survey counts the floor a run covers** (`survey.js`, the user's
  call, 2026-10-10): half-unit squares a ball can reach (the shared grid),
  each covered when the ball passes near its middle; a clear keeps its best
  (`survey` in the save, merged by max), SURVEYED at 90%. `test_survey.js`
  proves the shortest route alone never surveys a level and a sweep does.
  It only counts: nothing in a run changes for it.
- **Secret pockets hide the Baron's diary** (`pockets.js`, the user's call,
  2026-10-10), in EXPLORE MODE ONLY (the user's call, 2026-10-11, like the
  fuel cells: rolling, the dead end is a plain dead end, no wall, no page;
  Glint's Clear Sight is an Explore power for the same reason): on two
  floors a planet (`POCKET_LEVELS`), a false wall --
  drawn like the others, with NO body -- closes off a dead end with a
  diary page (`diary.js`) at its far end. No physics changes, so every
  route, verifier guarantee and gold time stands. The wall and page are
  COMPUTED from the level (never in `mazeLevels.json`); `test_pockets.js`
  proves each wall spans its corridor face to face, covers nothing that
  matters, hides only the dead end (never the start, exit, fuel cell or a
  cage), and recomputes `POCKET_LEVELS`. Banked by a clear (`diary` in the
  save, merged by union), read in Gear.
- **Lines under CLEARED come in order, the last one stays**: the survey,
  then a fuel cell, then a diary page, then a freed friend's word, then a
  bond level, then a planet's gift and level-ups. A find outranks a
  percentage. A fuel gate (or, rolled, a cell still hidden: EXPLORE IT TO
  FIND IT) is the last word.
- **The Crew** (`crew.js`, the user's call, 2026-10-10; docs/PLAN.md): the
  CREW tab (crewUi.js) replaced WORLDS; the Worlds sheet is the planet page,
  opened from home's planet name. Every marble carries a SIGNATURE, free a
  set number of times PER RUN (once; twice from track step 2) -- never a
  permanent bonus. Clears AS a character earn its bond (`bond` in the save,
  merged by max); bond levels open the four track steps, bought with coins
  (`crew`, merged by max). Tuned steps add only grip, stopping or response
  (test_shop.js, test_crew.js). Each planet sells its trap answer as a
  PLANET CHARGE (shopCatalog.js CHARGES with `cover`) once opened; one is
  armed per run, spent only when it fires, after the signature's free uses.
  Every hazard asks `covered(kind)` in mazeGame.js, rolling AND exploring
  (the user's call, 2026-10-12: Explore's controls reflect the marble -- its
  stats and tuned steps through `walkHandling`, its signature, charges and
  shields through the same hazards); a new trap that hurts or holds the
  ball needs a cover kind there. No ship upgrades until space
  battles (the user's call). Alpha: saves are wiped, not migrated -- done
  2026-10-11 by SAVE_VERSION 2 (any other version loads fresh, on a device
  and on the server, so nothing old can merge back up) plus the server's
  one-time `alpha_2026_10_11` wipe (server/db.js WIPES).
- **A one-time change to the server's data is a WIPES entry** (server/db.js):
  it runs once at start, in one transaction, is recorded in `wipes` so no
  restart repeats it, and copies what it deletes into backup tables named
  after it. Never delete accounts or the play stats without the user's say.
- **A level's jobs are on its ready screen** (`mission.js`, the user's
  call, 2026-10-11: "make sure the main objectives are clear"): MISSION
  lists, in the order they are done -- rolling: a floor 10's caged friend,
  the exit, then exploring it for the fuel cell; exploring: the fuel cell,
  then the exit -- the fuel row with what the ship still needs from this
  planet to fly on, ticked once found. A rolled clear with the cell still
  hidden ends on EXPLORE IT TO FIND IT, a fuel gate on EXPLORE TO FIND THEM.
  The card sits under the top bar on a phone, beside the board
  on a wide screen, clear of the ready line and START, gone once the run
  starts. The daily maze is a race and gets none. A new main objective
  belongs in `missionFor` (`test_mission.js`).
- **A rolled level can be explored from its ready screen** (the user's
  call, 2026-10-11): EXPLORE beside START once the level is cleared (not
  the daily maze, not a marble trial), as well as EXPLORE IT on CLEARED.
- **Medal times are in the level, not over PLAY** (the user's call,
  2026-10-11): home's line over PLAY is gone (it still says what opens a
  locked planet). The MISSION card ends on the gold, silver and bronze times
  (and the best), and the HUD's medal clock runs the time against the medal
  still in reach (gold, then silver, then bronze, then grey), an explored
  maze against its walk par. On a phone the clock takes the level name's row
  once the run starts (the top bar has no room).
- **A run's end is shown, never a vanishing** (`fallFx.js`, the user's
  call, 2026-10-11): rolling, the body is held where it went and the DRAWN
  ball tips over a hole's rim and sinks shrinking into the dark, chars under
  smoke, flattens under a press, crackles on a rail or freezes in ice
  (fallFx3d.js), all within FALL_MS, the restart's wait. Walking keeps the
  body's drop (the eye is the body). A new trap that ends a run needs a
  cause in `causeOf` and a look in `fallPose`; `test_fall_fx.js` holds them.
- **Safe areas come from `--safe-top` / `--safe-bottom` only** (style.css),
  and `safeArea.js` decides whether to trust the browser's insets: an
  Android tab, not fullscreen or installed, gets zero and no
  `viewport-fit=cover` (2026-10-10: the user's S25 Ultra browser reported
  the status and nav bars as insets, leaving ~38px and ~54px empty). Never
  read `env(safe-area-inset-*)` anywhere else.
- **A phone stays portrait** (`portraitLock.js`, the user's call,
  2026-10-12: a steep tilt tripped auto-rotate mid-run).
  `screen.orientation.lock('portrait')` where allowed (Android fullscreen, an
  installed app); everywhere else, a phone's landscape view turns the page
  back (`html.is-turned`, the body rotated a quarter turn), never a tablet,
  a computer or the landing site. Turned, tilt reads as portrait, pointers
  come through `contentPoint(e)` and boxes through `pageRect(el)` -- never
  raw clientX / getBoundingClientRect / innerWidth for layout or input.
  Media queries still see a wide viewport, so every `(max-width: 560px)` and
  `(max-width: 400px)` rule has a `:where(html.is-turned)` twin at the end of
  style.css (`test_portrait.js` holds them in step), and vw/vh sizes get a
  turned version in `--turn-w` / `--turn-h`.
- **Power-up and ability buttons are icons, off the board where they can
  be** (the user's call, 2026-10-14): round icons with a count, solid beside
  the board (a wide screen) or under it (a phone); where the board fills the
  screen under them (a big board, Explore), as see-through as they can be
  (`placeCharges` in mazeGame.js, from the board's corners projected with the
  live camera each frame of a run).
- **Mixed reality on Meta Quest 3** (`xrMode.js`, the user's call,
  2026-10-14: the room around the board, grab and tilt, the playable loop
  first). ENTER VR on a rolling level's ready screen, web only
  (`features.xr`) and headsets only (a phone's AR has no hands to grab
  with). An `immersive-ar` session: passthrough behind the board (no sky, no
  backdrop colour), the level on your table (`xrMath.js` placeBoard: ahead
  of and under the eyes, PLACE BOARD to move it). THE PLAYER IS SCALED, NEVER
  THE LEVEL: the camera rides a rig that maps the room onto level units, so
  walls, physics, shadows and gold times are everyone's. That breaks
  three.js's frustum culling (its both-eyes camera mixes world units and
  metres), so culling is off while presenting. Tilt is a grab -- squeeze,
  trigger or pinch anywhere but the panel -- read as the hand's lean since
  (two frames after the press: a closing pinch moves the palm), through
  mazeTilt.js like any reading; the board leans as far as gravity does. The
  run's panel (`xrPanel.js`) MIRRORS THE PAGE: built every frame from the
  level's own DOM (name, coins, medal clock, status lines, whichever of
  START / RETRY / NEXT / REPLAY / gift / LEVELS / EXIT are showing, a
  floor 10's story card) and pressing one clicks the page's button -- never
  a second copy of the game's logic. No ad buttons in the room. Leaving the
  level ends the session (the menus are flat). Explore is not offered in VR.
  FEEL (2026-10-14): the controller holding the board (both when neither
  does) pulses from the same calls the sound gets -- every wall hit's speed
  along its normal, and the fall, bumper, coin, shield and win moments
  (`cue()` in mazeGame.js, `xrFeel`, `pulseFor`); a hole's thud is the
  strongest. THE REAL TABLE (2026-10-14): with WebXR hit-test (the Quest's
  Space Setup) a ray dropped straight down at the planned spot puts the
  board's floor 2 cm over the table under it (`tableHeight`: a table's
  height, never the floor or a shelf near the eyes); PLACE BOARD is pointing
  -- an outline follows the ray over real surfaces, the trigger sets the
  board there facing you (`placeOnSurface`), pointing at nothing re-places
  it in front of you. No hit-test: the head-height rule, as before. Tilt is
  read on the board's own axes (it turns to face you), so a wrist rolled
  toward the board rolls it.
  `test_xr.js` holds the numbers; `test_xr_browser.js` runs Meta's emulator
  (IWER, a dev dependency, which also poses as a Quest's user agent; a fake
  room with a 74 cm table through its environment seam) on both builds. Feel is judged on the user's headset.
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
