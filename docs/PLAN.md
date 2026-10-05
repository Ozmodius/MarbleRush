# Marble Rush plan (summary)

The full plan, with the reasoning, lives in the shared doc
[Marble Rush plan](https://claude.ai/code/artifact/249070c4-ac34-4651-93d8-2500aa092808).
This file records the decisions so they travel with the code.

## Decisions

- **Its own repo** (decided 2026-10-05). The plan first suggested a second build
  target inside 3dBallSmack; Oz chose a separate repo instead. The maze code was
  copied from 3dBallSmack @ `eaa3b6d`, so fixes to the shared physics, hazards or
  generator must now be ported by hand in whichever direction they land.
- **No server.** Progress (coins, stars, best times, characters, upgrades, daily
  streak) is one versioned JSON blob in CrazyGames' cloud save for signed-in
  players and localStorage for guests, same shape, so a guest who signs in
  keeps their progress. Acceptable because nothing is competitive and no real
  money changes hands; revisit the day a leaderboard or a purchase arrives.
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
- **Coins and power-ups in every maze; power-ups also bought before a level**
  (decided 2026-10-05). Coins and pickups are placed by the seeded generator,
  and the verifier checks every one is reachable and clear of holes. Power-ups
  are control and forgiveness for one run (shield: one free fall; slow-mo; coin
  magnet), never a way through walls. Gold times assume no power-ups.
- **Ads:** midgame only at natural breaks (level cleared, leaving to the map),
  never during a run; CrazyGames spaces midgame ads about 3 minutes apart.
  Rewarded ads are always the player's tap: revive after a fall (the strongest),
  double coins, try a locked character, a free upgrade step, reveal the route.

## Phasing

| Phase | Size | Contents | Gate to the next |
| --- | --- | --- | --- |
| 0. Spike | Small | Scene host and progress store seams; `index.html` boots level 1 with no server; build script makes a flat CrazyGames zip | A level plays on desktop and phone |
| 1. MVP launch | Large | 50 levels in worlds 1-5 (below), each with its theme, three traps and a prize; coins and power-ups (in-maze and pre-bought); Classic + 3 characters, 4 upgrade tracks, stars, coins, cloud save; midgame + revive/double-coins rewarded; Basic then Full Launch | Basic Launch retention and session length look healthy |
| 2. Retention | Medium | Daily maze and streak, player level, trails and skins, character trials, ball cam | Ball cam gets real play and lifts retention |
| 3. Labyrinth | Large | Walk-through first-person mode on the same generator; joystick + mouse-look; explorer upgrades; comfort settings | |

## Worlds

Prize = the reward for clearing the world; it helps against the trap named in
the next world. Worlds 1-5 ship at launch.

| # | World | Trap on L1 | Trap on L4 | Trap on L10 | Prize |
| --- | --- | --- | --- | --- | --- |
| 1 | Workshop (wood) | holes | moving gates | conveyor belts | Rubber Coat: grips on ice |
| 2 | Glacier | ice | wind fans | falling icicles | Heat Shield: survives one lava flare |
| 3 | Magma Works (`lava` theme) | flaring lava seams | molten gates | geysers | Obsidian Core: bumpers push half as hard |
| 4 | Toy Box (plastic) | bumpers | spring pads | spinning arms | Plastic Ball: ignores magnets |
| 5 | Foundry (metal) | magnets | crushers | electric rails | Chrome Polish: slides through mud |
| 6 | Swamp | mud | fog | gas vents | Firefly Lantern: lights the dark |
| 7 | Crypt | darkness | ghost walls | portals | Spirit Compass: shows where portals lead |
| 8 | Desert Temple | sand slides | dart traps | sandstorm | Gyro Core: wind pushes less |
| 9 | Sky Islands | gusts | bounce clouds | lightning | Anchor: resists gravity wells |
| 10 | Cosmos | gravity wells | low-gravity zones | black holes | Final crown (cosmetic) |

No crumbling or sinking floor in any world (see CLAUDE.md).

## Open questions

- Allow a midgame ad after repeated falls? (Ball Smack never shows one there.)
- Keep the maze inside Ball Smack too? (Plan says yes.)
- Any link between the two games' economies? (Plan says not at launch.)
