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
- **World prizes became planet charges** (2026-10-10, with the Crew). Each
  planet sells one trap charge answering its own trap (Sure Foot, Ice Skates,
  Fire Shield, Shrug, Demagnetize) once that planet is opened; finishing a
  planet gives 3 of the next one's. One is armed per run and spent only when
  it fires. Still never required.
- **Store and profile** (built 2026-10-05; reshaped 2026-10-10). The store
  sells single power-ups and planet charges. The ship upgrades (Grip, Air
  Brake, Power Time, Coin Reach) were removed on the user's call until space
  battles. Picking, recruiting and upgrading marbles is the CREW tab; Gear
  keeps looks, the diary and what you carry. All prices and effects are in
  shopCatalog.js and crew.js; test_shop.js holds the never-faster,
  never-smaller rule.
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
  - rewarded TRY on every unowned marble in CREW (added 2026-10-06; Gear
    until 2026-10-10): the ad starts the next level with that marble, for
    that level and its retries only; leaving or moving on ends it; never
    ownership, never saved, no bond. A clear on a trial points to its price.
  - rewarded FREE crew step in CREW (2026-10-10; a free ship-upgrade tier
    in the Store before): a character's next track step, free, once per 30
    minutes (surviving a reload), only once their bond opens it and only for
    steps priced 700 or less -- the top steps stay things to save for.
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
  marble drives at that floor and slides on when let go; Ice Skates make
  a patch grip like floor. The crew's tuned steps carry in with the stats.
  Power-ups, shields, signatures and planet charges work exactly as rolling
  (the user's call, 2026-10-12: "the moving controls should reflect the
  characters stats, upgrades and shields ... and surface"): every trap asks
  the same `covered(kind)`, Hole Hop and the shield take a fall, Coin Sense
  is a tap here too; only Clear Sight is Explore-only. The floors' themes
  (wood, snow, foam, steel) differ in sound, not grip: only ice and belts
  change how the floor holds, rolling or walking.
- *Which mazes*: the 50 ladder levels, each walkable once rolled (a WALK IT
  button after a clear, and a ROLL | WALK switch on the worlds sheet).
- *The walker is the ball's body* (walkMode.js): the same radius, so every
  verifier guarantee holds unchanged; gravity stays straight down and a
  capped push (12 u/s^2, over twice the strongest trap's) drives it toward
  walking pace (1.8 u/s). Traps are live. The eye sits below the wall tops.
- *Taller walls in Explore* (the user's call, 2026-10-12, 0.95 picked from
  0.8 / 0.95 / 1.1): drawn 0.95 high to hide the maze, bodies still 0.55 --
  nothing leaves the floor, so no route or time changes.
- *The third-person camera* (the user's calls, 2026-10-12): low (0.35 rad),
  never raised by the look; rises to the old starting height (0.79) when a
  wall hides the marble or the floor under it, and -- only if the marble is
  still hidden there -- steeper (0.95 to 1.4), then slides back down.
  Moving it in closer was tried first and measured: it keeps the angle, so a
  wall just behind the marble stays in the way (it cleared no spot of 11,742
  sampled); rising steeper clears every one. The controls hint is one line
  in the device's words (LEFT: MOVE · RIGHT: LOOK on a phone).
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
  by a clear and kept. Found in Explore mode only (the user's call,
  2026-10-11): they are the one thing a world needs explored. The ship needs 3 of Sawturn's to fly to Slipstonia,
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
  Explore mode only (the user's call, 2026-10-11), as are the fuel cells;
  Glint's Clear Sight works while exploring.
  The page text awaits the user's OK (`diary.js`).
- Not doing: the Baron's locks (gates and keys on every run).

## The Crew (decided 2026-10-10)

The user's call: home picks the planet and level now, so the WORLDS tab
became CREW, where each character advances. The Worlds sheet lives on as the
planet page, opened from home's planet name (Roll / Explore and the
planet's log). The game is in alpha: saves are wiped rather than migrated.
- *Signatures, never permanent*: each character carries one trick, free once
  a run (twice after their second step). A friend's is their own planet's
  trap answer (Pip Sure Foot, Flurry Ice Skates, Cinder Fire Shield, Bobble
  Shrug, Rivet Demagnetize); Rolle's Coin Sense and Glint's Clear Sight are
  taps; Sterling's Iron Shell takes a press or a gust; Bumper's Hole Hop his
  first hole. Once a planet is opened, its answer is sold as a planet charge
  any character can carry.
- *Bond* (option B, the user's pick): clearing a level as a character earns
  them bond (40 first clear, 15 replay, +20 first gold); bond levels at 100,
  300, 600 and 1000 open the steps of their track, and coins buy each step.
  Bond is never sold or given by ad; a rewarded ad may give a cheap step.
- *The track*, the same four steps for all: more of their own handling
  (grip, stopping or response), signature twice a run, more handling again,
  an aura of their colour. Never top speed, never a smaller ball.
- *Gold times*: as with the world prizes before, a signature or charge can
  let a run pass a trap it would otherwise wait for. Accepted for now; marking
  leaderboard runs that used one is an option if it matters.

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

## Meta Quest 3 (planned for a future release, the user's call 2026-10-11)

Not started. The plan, cheapest first:
- *Flat, today:* the Quest browser should run planetilt.com in a window,
  steered by drag (the controller's pointer). To check on a headset.
- *Mixed reality, the board on your table:* an ENTER VR button (WebXR; the
  scene host already renders through setAnimationLoop). The headset owns
  the camera, so the board is placed in the room (~60 cm) instead of the
  camera being moved; ball cam and the shows get XR versions or are off.
  Tilt comes from the controllers' or hands' angle (thumbstick as a
  fallback) -- still rotating gravity, the board's lean following the
  hands. The run's UI (START, MISSION, the medal clock, coins, CLEARED /
  NEXT / RETRY / EXIT) rebuilt as panels in the world, since DOM overlays
  do not show in an immersive session; Store, Crew and Gear stay flat.
  Performance for stereo at 72-90 Hz: smaller shadows, a lower resolution,
  foveation.
- *Explore in VR:* later; comfort first (snap turn, the vignette,
  teleport).
- *Distribution:* WebXR on planetilt.com first; a packaged web app in
  Meta's store to be checked against their rules then. CrazyGames stays
  flat.
- Testing: Meta's WebXR emulator here; feel only on the user's headset.

## The harder ladder (2026-10-13)

Oz: "Each level should be harder than the last. The game is too easy." His
picks: harder from level 1, by longer routes with fewer loops and narrower
corridors (not more traps, not tighter gold), saves wiped again
(SAVE_VERSION 3, the server's `harder_2026_10_13` wipe). Then: "bigger levels
but display the same amount of maze, just focus on the marble", and "maybe a
centre out maze for the last one".
- *The curve*: boards 9 x 14 for levels 1-4, then growing every level to
  1.6x the scale (13.5 x 21.5 at the last: each planet's cells keep their size); within each planet the grid finer, the
  loops fewer; trap counts as before. Each level must out-score the one
  before (route in marble widths + 4 per junction), which the generator
  enforces and the verifier checks. Strictly longer routes alone could not
  last fifty levels (routes grow two cells at a time, and Bouncelot's bumpers
  need rooms, capping its grid at 7 x 11 cells per 9 x 14).
- *The view*: rolling shows a 9 x 14 board whole, as before; a bigger one
  through a window following the marble, no opening overview. A phone is
  tall, so the old window already showed ~20 units down: Oz picked a closer
  camera on big boards (option 2 of 2, over 2x boards) -- the window closes
  in as boards widen, to 70% at 13.5 and wider (`viewScale`). Ball cam still
  zooms in closer. Explore is unchanged (it never showed the whole board).
- *The final level* (Gearth floor 10) is centre out: the marble starts in the
  middle and the exit is the edge cell farthest from it by the maze.
- *Performance*: all walls are one physics body; the sun's shadow box follows
  the view.
- *Traps scale with the maze* (2026-10-13, after the bigger boards: "the
  mazes need more traps now that they are bigger"): each slot's trap counts
  are written for 9 x 14 and multiplied by the board's area over that, so
  Gearth's last floors carry ~30 where they had ~14. Coins do not scale.
- *More traps, bigger holes* (2026-10-14: "increase the overall number of
  traps by 20%, increase the size of holes to be a danger, but passable"):
  every scaled trap count times 1.2 (~19% after rounding); holes sized so the
  marble's centre keeps a 0.16 lane past them (it falls only when its centre
  is over one), never smaller than before -- radius 0.20 to 0.36 where it was
  0.16 to 0.19. Geysers may sit 2.3 apart (was 2.6; their reaches still
  never overlap). More traps need longer routes on the last planets: Gearth's
  last gold is ~105 s (was ~74).

