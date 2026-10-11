# PlaneTilt plan (summary)

The full plan, with the reasoning, lives in the shared doc
[PlaneTilt plan](https://claude.ai/code/artifact/249070c4-ac34-4651-93d8-2500aa092808).
This file records the decisions so they travel with the code.

## Decisions

- **Name: PlaneTilt** (decided 2026-10-06; written with a capital T). Was Marble Rush, which is a
  registered VTech toy trademark and already the name of two games. PlaneTilt
  turned up no game or product in a web search; it still needs a proper
  trademark search (USPTO classes 9, 28, 41) before it is registered or
  launched. The save key keeps the old name (progressStore.js).

- **Its own repo** (decided 2026-10-05). The plan first suggested a second build
  target inside 3dBallSmack; Oz chose a separate repo instead. The maze code was
  copied from 3dBallSmack @ `eaa3b6d`, so fixes to the shared physics, hazards or
  generator must now be ported by hand in whichever direction they land.
- **No server** (2026-10-05) -- **until leaderboards and cross-device saves
  (2026-10-07, Oz's call).** Progress (coins, stars, best times, characters,
  upgrades, daily streak) is one versioned JSON blob in CrazyGames' cloud save
  for signed-in players and localStorage for guests, same shape, so a guest
  who signs in keeps their progress. That stays the save the game plays from.
  Since 2026-10-07 a small API (`server/`, Node + Postgres on Render) adds:
  - *Cloud save across platforms and devices*, local first: the device save
    is copied up in the background and the two are MERGED both ways
    (`mergeProgress`): earned things combine to the best of both, coins and
    charges come from the newer save, except that a device JOINING a player
    (a link code, a CrazyGames sign-in) takes that player's coins. Never an
    overwrite, so a stale device cannot undo a newer one.
  - *Leaderboards*: best time per level for rolling, walking and each day's
    daily maze; a rank on the CLEARED panel and a top-10 modal. Times under
    the level's `minMs` floor (3x for walks) are refused.
  - *Players*: guests (a random device token, "Guest-XXXX"), CrazyGames
    accounts (their signed user token, verified with CrazyGames' public key;
    a guest's save and times fold into the account on sign-in), and 6-letter
    link codes to play as the same player on another device.
  With no API URL in the build the game is exactly what it was. Times are
  checked only against the physical floor; if cheating shows up, the next
  step is to have the server replay-check clears, not to trust the client
  more.
- **Upgrades buy control and forgiveness, never speed or size.** Ball radius
  belongs to the world (the shrinking marble is what buys tighter mazes), and
  the verifier and gold times assume it. Characters vary mass, grip and response.
- **First person in two steps:** a behind-the-ball camera on the existing levels
  first; a walk-through Labyrinth mode only if the ball cam lifts retention.
- **100 levels in 10 themed worlds; 5 worlds (50 levels) at launch**, the rest
  as content updates (decided 2026-10-05). Each world introduces three traps of
  its own, on its levels 1, 4 and 10; the levels between practise them. The
  verifier checks that a world only introduces a new trap kind on those slots.
- **Every trap is verifier-checkable.** Each one is modelled as one of: blocking
  (treated as a wall, a safe way round must exist), timed (solvable by waiting,
  like gates), slowing (cannot change reachability, only time), or pushing
  (weaker than full tilt, so the player can always drive against it; the
  conveyor cap in mazeHazards.js is the template).
- **A prize at the end of each world helps against a trap in the next one, and
  is never required** (decided 2026-10-05). Every level is verified solvable
  without it. Prizes change how the ball reacts to one trap kind, never its
  radius or top speed (the plastic ball keeps its size; it just ignores magnets).
- **World prizes are uses, and the store sells refills** (decided 2026-10-05).
  Clearing a world grants 3 uses of its prize; one use covers one level (spent
  the first time its trap is met there, good for every retry). The store sells
  refills only once the prize is earned. Still never required.
- **Store and profile** (built 2026-10-05). The store sells the four upgrade
  tracks (Grip, Air Brake, Power Time, Coin Reach; three tiers each), single
  power-ups, and prize refills. The profile picks the marble for the next game
  (Classic, Steel, Rubber, Glass; the last three bought there) and shows
  progress and what you carry. All prices and effects are in shopCatalog.js;
  test_shop.js holds the never-faster, never-smaller rule.
- **Coins and power-ups in every maze; power-ups also bought before a level**
  (decided 2026-10-05). Coins and pickups are placed by the seeded generator,
  and the verifier checks every one is reachable and clear of holes. Power-ups
  are control and forgiveness for one run (shield: one free fall; slow-mo; coin
  magnet), never a way through walls. Gold times assume no power-ups.
- **Ads:** midgame only at natural breaks (level cleared, leaving to the map),
  never during a run; CrazyGames spaces midgame ads about 3 minutes apart.
  Rewarded ads are always the player's tap: revive after a fall (the strongest),
  double coins, try a locked character, a free upgrade step, reveal the route.
- **Ad revenue pass** (built 2026-10-06). All CrazyGames-only, all offered only
  while an ad can actually pay (platform.js `adsAvailable`), amounts in
  shopCatalog.js `AD_REWARDS`:
  - rewarded CONTINUE after a fall (back on the last safe spot, clock still
    running; once per attempt, only after 8s of run, a 4s offer then retry);
  - rewarded x2 COINS on a paying clear (capped at 500), which stands in for
    that break's midgame ad;
  - rewarded FREE SHIELD on the ready screen (once per level visit, only when
    no shield is held);
  - rewarded FREE COINS in the store (60, once per 3 minutes, survives reload);
  - midgame ads now also on leaving a level (back button, EXIT), still
    self-throttled to 3 minutes;
  - responsive banners at the foot of the Store and Gear pages only (pages
    read for a while; never in a level), refreshed at most once a minute;
  - an input shield while any ad is requested or playing, and UI sounds
    silent while one plays.
  - rewarded TRY on every unowned marble in Gear (added 2026-10-06): the ad
    starts the next level with that marble, for that level and its retries
    only; leaving or moving on ends it; never ownership, never saved. A clear
    on a trial points to its price in Gear.
  - rewarded FREE upgrade step in the Store (added 2026-10-06): the next
    tier of any upgrade, free, once per 30 minutes (surviving a reload), and
    only for tiers priced 600 or less -- the top tier of each stays a thing
    to save for.
  Not built yet from the list above: reveal the route. Watch which rewarded buttons get tapped before
  adding more.

- **Retention pass** (decided 2026-10-06). Three client-side features, rules in
  `daily.js` (tested by `test_daily.js`), tables in `shopCatalog.js`:
  - *Daily reward*: a 7-day calendar, one claim per LOCAL calendar day,
    ~840 coins and 6 power-ups a week; missing a day restarts at day 1, day 7
    loops. Opens by itself once a session while unclaimed. A rewarded ad
    doubles the day's coins once (CrazyGames only).
  - *Daily missions*: three a day drawn from a pool by the date (a reload
    cannot re-roll them), never one the player cannot do yet (beat-your-best
    needs a clear; use-power-ups needs the charges). Counted by the progress
    store from clears and spent charges -- the run reports nothing new.
    Finishing all three pays a +100 bonus.
  - *Near miss*: after a clear, the next medal above the player's best and
    how far off the run was; within 1s (or 15% of that medal's time) RETRY
    becomes the big button.
  These pay coins outside levels, so they count against the shop ratio in
  `mazeLevels.json`'s notes: about a level's pay a day for a daily player.

## Phasing

| Phase | Size | Contents | Gate to the next |
| --- | --- | --- | --- |
| 0. Spike (done 2026-10-05) | Small | Scene host and progress store seams; `index.html` boots level 1 with no server; build script makes a flat CrazyGames zip | A level plays on desktop and phone |
| 1. MVP launch | Large | 50 levels in worlds 1-5 (below), each with its theme, three traps and a prize; coins and power-ups (in-maze and pre-bought); Classic + 3 characters, 4 upgrade tracks, stars, coins, cloud save; midgame + revive/double-coins rewarded; Basic then Full Launch | Basic Launch retention and session length look healthy |
| 2. Retention (built 2026-10-06, ahead of Basic Launch data) | Medium | Daily maze and streak, player level, trails and skins, character trials, ball cam | Ball cam gets real play and lifts retention |
| 3. Labyrinth (built 2026-10-06, ahead of the ball-cam gate) | Large | Walk-through first-person mode on the same generator; joystick + mouse-look; explorer upgrades; comfort settings | |

Phase 2 as built (2026-10-06), on Oz's call to go ahead before Basic Launch:
- *Streak* is the 7-day calendar and *character trials* the TRY-a-marble ad
  (both earlier). *Daily maze*: a verified pool of 60 (`dailyLevels.json`,
  12 a world), one a day by date from the worlds the player has reached,
  unlocked after 3 clears; first clear 150 + coins, first gold +100.
- *Player level*: XP from clears, golds, missions and dailies; every level
  pays coins, and levels 5/8/12/15 are the only way to the reward looks.
- *Trails and skins*: looks only, sold for coins or earned by level.
- *Ball cam*: a closer, board-aligned follow camera (tilt directions
  unchanged), eased in on START and out at the clear; a HUD toggle, saved.
  Its gate ("gets real play") needs usage numbers this build cannot see
  -- CrazyGames' dashboard or an analytics call would be the way to judge it.

Accounts and play tracking (2026-10-08, Oz's call):
- *Accounts* like 3dBallSmack's, without Google: username or email +
  password, a 6-digit emailed code to confirm (when SMTP is set), sign out,
  delete (type DELETE), and -- which Ball Smack lacks -- password reset by
  email, an 8-character minimum, limits on wrong passwords and codes,
  expiring codes, and a server-side sign-out. Web build only; CrazyGames
  players use CrazyGames' sign-in.
- *An account is required to play on the web* (Oz's call, same day): the web
  opens on CREATE ACCOUNT / SIGN IN with no way past but in
  (`features.requireLogin`); a device signed in before plays offline as
  usual. Never on CrazyGames, whose rules require one-click play with no
  account (3dBallSmack's PLAY NOW exists for the same reason). Expect it to
  cost first-session players on the web: the funnel's first step on /admin
  is where that shows.
- *Guest play on the web* (Oz's call, later the same day): the landing
  site's hero and closing section offer "or play as a guest" under CREATE
  ACCOUNT / SIGN IN (`features.guestPlay`), a quiet link so an account stays
  the obvious choice. A guest plays on the device's save, synced as a guest
  (the server always made one per device), and is not shown the site again
  on that device (`planetilt.guestPlay`, a device preference). Gear tells a
  guest their progress lives on this device only and offers CREATE ACCOUNT;
  the guest becomes the account, keeping everything. Signing out or deleting
  the account forgets the choice. /admin counts `landing:guest` beside
  `landing:register` and `landing:signin` (its "Front door" group).
- *A landing site is the web's front door* (Oz's call, same day): a new
  player first sees a scrolling page about the game -- the hero, the five
  worlds and their traps, how tilting plays, Explore mode, marbles and looks,
  daily rewards and achievements, medals and leaderboards, progress on every
  device -- with SIGN IN and CREATE ACCOUNT on a top bar that never scrolls
  away and CREATE ACCOUNT after every highlight. The account panel opens over
  it and closes back to it. Pictures are real renders
  (`capture.cjs landing` -> `landing/`); the CrazyGames build strips it all.
  /admin counts `landing:shown`, `landing:register` and `landing:signin`. A guest who creates an account becomes
  it; signing in elsewhere adds that device's progress to the account.
- *Play tracking*: per level and mode, daily counts of starts, clears (and
  their times), falls and quits, plus each player's furthest level from
  their save. `/admin` (ADMIN_TOKEN) shows clear rates and the level players
  stop at -- the data for tuning difficulty and the XP curve.

A steeper player level (2026-10-08, Oz's call): each level's XP step is
100 + 30(k-1) + 6(k-1)^2 (was 100 + 50(k-1)), so levels keep getting harder
even though later worlds pay more XP -- 1-2 clears a level at first, 5-7 by
level 15, which is about where the 50 launch levels end (was 18). A level's
reward is paid once ever (`levelPaid`, merged as a max): saves from the old
curve show a lower level now but are not paid again climbing back.
Levels 16-19 each bring more than coins now, since the climb past 15 is
long: 16 a Shield and Slow-mo, 17 the Aurora trail, 18 one of each power-up
and 300 coins, 19 the Prism skin (both new, reward-only looks).

REWARDS and achievements (2026-10-07, Oz's call):
- The home rail's DAILY and MISSIONS buttons became one REWARDS button; its
  card has DAILY (the 7-day calendar), MISSIONS (the day's three) and
  ACHIEVEMENTS tabs, a dot on each with something to claim, and the rail
  badge counts them all. It opens on the first tab with something waiting.
- *Achievements* (achievements.js): 22 one-off goals -- levels cleared,
  golds, worlds finished, every coin taken, levels explored, a full daily
  week, player level, all marbles, a maxed upgrade -- each paying coins once
  on a tap. Progress is read from the save as it is, so existing players
  arrive with what they have already earned; only the claimed ids are saved
  (`achievements`, merged as a union). The whole list pays about 3,000
  coins, roughly a dozen first clears.

Phase 3 as built (2026-10-06), on Oz's call and choices:
- *Named EXPLORE for players* (2026-10-07; it was WALK): EXPLORE IT after a
  clear, a ROLL | EXPLORE switch, "Explore ·" in the HUD. Code, the save
  field (`walks`) and leaderboard keys (`walk:`) keep the old name, so no
  save or board is reset.
- *The marble handles the same in Explore* (2026-10-07): grip and the Grip
  upgrade set how hard it drives (quicker off the mark, tighter turns),
  damping and the Air Brake how hard it stops when let go (Classic coasts
  about half a second; Air Brake 3 or Steel stop nearly dead), response how
  short a stick drag reaches full speed. Top speed is the same for every
  marble, and the weakest drive anywhere -- ice included -- still beats
  twice the strongest trap push (`walkHandling`, test_walk.js). On ice every
  marble drives at that floor and slides on when let go; Rubber Coat makes
  ice grip like floor. Power Time, Coin Reach, power-ups and world prizes
  already applied (they run through the same pickups and hazards).
- *Which mazes*: the 50 ladder levels, each walkable once rolled (a WALK IT
  button after a clear, and a ROLL | WALK switch on the worlds sheet).
- *The walker is the ball's body* (walkMode.js): the same radius, so every
  verifier guarantee holds unchanged; gravity stays straight down and a
  capped push (12 u/s^2, over twice the strongest trap's) drives it toward
  walking pace (1.8 u/s). Traps are live. The eye sits below the wall tops.
- *Medals and pay*: walk par = 1.1 x the level's gold time; the first walk
  pays half the level's first-clear pay plus coins, a walk gold its gold
  bonus; walk records are kept apart from rolling ones.
- *Explorer upgrades* (Store): Compass (an arrow to the exit) and Explorer
  Map (draws only floor already walked near). Neither speeds a walker.
- *Comfort*: field of view, look speed, invert, head bob (off by default),
  edge darkening while moving (on by default).
- Open: no comfort or feel testing on a phone yet; a sky for the walk view.

## Worlds

Prize = the reward for clearing the world; it helps against the trap named in
the next world. Worlds 1-5 ship at launch.

Each world is a planet with its own name, and each level is a place on it,
named by the level's own name; players never see "World 1" (the user's call,
2026-10-08; `worlds.js`): Sawturn (the Workshop), Slipstonia (the Glacier),
Magmars (Magma Works), Bouncelot (the Toy Box), Gearth (the Foundry).
Worlds 6-10 get planet names when they are built.

| # | World | Trap on L1 | Trap on L4 | Trap on L10 | Prize |
| --- | --- | --- | --- | --- | --- |
| 1 | Sawturn: Workshop (wood) growing into a forest, level by level | holes | moving gates | conveyor belts | Rubber Coat: grips on ice |
| 2 | Slipstonia: Glacier (snowy rock at the treeline turning to blue ice) | ice | wind fans | falling icicles | Heat Shield: survives one lava flare |
| 3 | Magmars: Magma Works (`lava` theme) | flaring lava seams | molten gates | geysers | Obsidian Core: bumpers push half as hard |
| 4 | Bouncelot: Toy Box (foam play mat, plastic brick walls; pastel turning bright) | bumpers | spring pads | spinning arms | Plastic Ball: ignores magnets |
| 5 | Gearth: Foundry (rusty tread plate and riveted steel, cleaned up level by level) | magnets | crushers | electric rails | Chrome Polish: slides through mud |
| 6 | Swamp | mud | fog | gas vents | Firefly Lantern: lights the dark |
| 7 | Crypt | darkness | ghost walls | portals | Spirit Compass: shows where portals lead |
| 8 | Desert Temple | sand slides | dart traps | sandstorm | Gyro Core: wind pushes less |
| 9 | Sky Islands | gusts | bounce clouds | lightning | Anchor: resists gravity wells |
| 10 | Cosmos | gravity wells | low-gravity zones | black holes | Final crown (cosmetic) |

How world 4's traps keep the verifier's guarantees (built 2026-10-05):
bumpers are posts, solid to every search, whose kick adds at most 3 u/s and
never fires toward a hole within 1.5; spring pads are timed (they wind up
for 0.9s, fire, then rest at least 1.5s) and their launch lane to the next
wall stays clear of holes; spinning arms stand in 2x2 rooms the generator
opens for them, never reach a wall, leave the ball room beside a blade lying
along a wall, and keep their sweep clear of holes, start and goal.

How world 5's traps keep the verifier's guarantees (built 2026-10-05; with
it all five launch worlds are built): magnets pull toward their wall at no
more than 3.8 u/s^2 (under half of full tilt, like wind) and reach no hole
and no rail; crushers are timed presses (0.8s warning, then slam, sit and
rise; at least a second up each cycle) never over a hole, start, goal or
gate sweep; electric rails are set into walls and solved as if always live
-- the band where a ball would touch one is fatal to the search, like a
hole -- so the middle of every railed corridor is a proven way through.

No crumbling or sinking floor in any world (see CLAUDE.md).

## The rescue (the story; decided 2026-10-09)

The user's call: tie the planets together with a story, and make each
world's floor 10 count.

- *The cast* (`shopCatalog.js` names; ids unchanged): Rolle (classic) is the
  hero, a marble from MarbleTopia. The shop marbles are Sterling (steel),
  Bumper (rubber) and Glint (glass). Baron Von Ratchet wound the five planets
  up like clocks and, to keep them ticking, kidnapped Rolle's friends: Pip
  (Sawturn), Flurry (Slipstonia), Cinder (Magmars), Bobble (Bouncelot) and
  Rivet (Gearth).
- *Floor 10*: until its friend is freed, a cage sits in the maze and the exit
  is locked (grey; rolling over it says FREE <NAME> FIRST!). Rolling into the
  cage frees them -- the bars fly off and the friend rolls along behind the
  ball, on the ball's own path, to the exit. A fall cages them again. The
  first floor 10 a device sees opens on the whole story, each later one on
  its friend (a device preference, `planetilt.storySeen`).
- *Where the cage goes* is computed from the level (`rescue.js`
  `captiveSpot`), never stored in `mazeLevels.json`: a side branch off the
  start-to-exit route, a detour of a quarter to three fifths of it, clear of
  every trap by the shield's safe-spot rule, and reachable by a ball 50%
  wider. `test_rescue.js` checks every floor 10 with its own search.
- *The prize*: the friend joins as a playable marble, never sold or tried by
  ad, and bound by the same rule as every marble (control and forgiveness,
  never top speed or size). Saved as `rescued` (worlds), merged by union.
- *Between levels* (built 2026-10-09, `levelShow.js`): each level opens on
  the marble dropping onto its start (a bounce, a thud from the floor's own
  impact sound); a planet's first level on Rolle's ship, a little saucer
  with a glass dome, beaming him down; a cleared floor 10 on the ship
  beaming him (and a freed friend) up and flying off over the board.
- *Home* (built 2026-10-09): Rolle's ship circles the planet, the player's
  marble in its dome. The planet's face is the level select: ten landing
  sites on a beaded trail winding up to floor 10 at the summit (where the
  friend is caged), each ringed in its medal; tap one to pick what PLAY
  starts, a ring of light pulsing round it. Up/Down keys walk the sites.
- *World skies* (built 2026-10-10): each level hangs high over its planet --
  the planet's surface far below (forest and sea, ice, lava, a toy panel,
  steel plate) under its weather: clouds over Sawturn, snow over
  Slipstonia, embers and smoke over Magmars, bubbles and confetti over
  Bouncelot, sparks and steam over Gearth.

## Exploring (decided 2026-10-10)

The user's call: exploring should be required and rewarding.
- *Fuel cells* (built): one per ladder level in its deepest dead end, banked
  by a clear and kept. The ship needs 3 of Sawturn's to fly to Slipstonia,
  5 of Slipstonia's for Magmars, 7 for each planet after; a planet already
  played on stays open. Home, the Worlds sheet and the HUD show the count.
- *Survey* (built): how much of a level's floor a run covered, in half-unit
  squares a ball can reach, the best a clear reached kept; SURVEYED at 90%.
  The shortest route alone covers about a quarter (never more than 43%).
  The HUD's map chip counts it; home and the Worlds sheet mark surveyed
  floors; achievements for the first and for ten.
- *Secret pockets* (built): on two floors of each planet, a dead end hidden
  behind a wall that only looks solid (drawn, no collider), holding a page
  of the Baron's diary; ten pages in all, banked by a clear, read in Gear.
  The page text awaits the user's OK (`diary.js`).
- Not doing: the Baron's locks (gates and keys on every run).

## Open questions

- Allow a midgame ad after repeated falls? (Ball Smack never shows one there.)
- Keep the maze inside Ball Smack too? (Plan says yes.)
- Any link between the two games' economies? (Plan says not at launch.)

CrazyGames review fixes (2026-10-08, Oz's go-ahead after a review against
CrazyGames' requirements):
- *Refresh rate*: physics carried a remainder instead of rounding each frame
  up to a step, so 120/144/165 Hz play at real speed (it ran 2-2.75x fast).
- *One tap to play*: a new player opens on level 1's START; the calendar
  waits for the first clear; keys start a run on a computer.
- *Privacy*: an in-game policy (Ponotech LLC) and, with a server, a one-line
  notice under a new player's START (CrazyGames asks for one when a game
  keeps data beyond SDK events: here, names on leaderboards).
- *No ad for backing out of an unplayed level.*
- *Sign-in no longer waits on a slow save upload* (at most 2.5 s, then the
  upload finishes in the background).

Between levels (2026-10-09, Oz's go-ahead, item 2 of the CrazyGames
growth list -- session length):
- Measured first: a clear to the next level's START is two taps with no
  popups, a fall restarts by itself in ~1.5 s, levels build in under 0.75 s.
  What was wrong was on the CLEARED screen.
- *The result stays*: a level-up, mission, prize or trial-marble line used to
  replace "CLEARED 11.3s 🥇 +144" after 1.4 s, so the first three clears of a
  new player (all level-ups) barely showed their time or pay. They now go on
  a second line under it, one after another.
- *The daily maze is announced* on the clear that unlocks it: NEXT-to-NEXT
  players never pass home, where it lives.
- *NEXT is the one bright button*: EXPLORE IT is secondary-styled there.
  Space/Enter is NEXT on a computer, with a SPACE chip on the button.
- *Dismissing the level-up card by tapping beside it* now goes on to the
  calendar like its OK does (it skipped it).
- *The 3D scene pauses under the web's landing site*, and a failed save upload
  after sign-in is retried instead of being called synced.

Come back tomorrow (2026-10-09, Oz's go-ahead, item 3 of the CrazyGames
growth list -- day-1 retention):
- *Found first*: a new player boots straight into level 1 (the one-tap rule)
  and, going NEXT to NEXT, never passed home -- 5 clears in, the daily reward
  was never claimed and the streak never started.
- *DAY n GIFT on the CLEARED panel* while today's reward waits: one tap
  claims it there and says "DAY 1: +50 COINS · DAY 2 TOMORROW: 80 COINS".
- *The calendar sells tomorrow*: a TOMORROW tag on tomorrow's tile once
  today is claimed, and its line says what tomorrow pays and when, how many
  days in a row the streak has run, and what day 7 is worth.
- *The daily maze's clear says a new one comes tomorrow.*

The first minute (2026-10-09, Oz's go-ahead, item 4 of the CrazyGames
growth list -- conversion):
- *Measured first*: real play data is too thin to show where players stop
  (28 players, almost no runs), so the levels were measured: level 1's
  shortest route runs along a hole's edge, and levels 2-3 alike. Medals are
  generous (bronze under 2.25x gold: 27 s on level 1).
- *The beginner's shield*: until levels 1-3 are each first cleared, every
  attempt starts shielded, free. The seeded levels and their gold times are
  untouched; a bought shield is kept; the ad shield is not offered there.
- *The no-sensor hint speaks the device*: "DRAG ON THE SCREEN TO TILT" on a
  phone whose motion was refused or never arrives (it said "ARROW KEYS, WASD
  OR DRAG"), keys first on a computer.
- *Quick first retries*: a first connect that fails retries in 3 s, then
  10 s, then every 30 s (it waited 30 s) -- a busy phone compiling the scene
  at boot can miss the request timeout.
