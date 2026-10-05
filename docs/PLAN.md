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
- **Ads:** midgame only at natural breaks (level cleared, leaving to the map),
  never during a run; CrazyGames spaces midgame ads about 3 minutes apart.
  Rewarded ads are always the player's tap: revive after a fall (the strongest),
  double coins, try a locked character, a free upgrade step, reveal the route.

## Phasing

| Phase | Size | Contents | Gate to the next |
| --- | --- | --- | --- |
| 0. Spike | Small | Scene host and progress store seams; `index.html` boots level 1 with no server; build script makes a flat CrazyGames zip | A level plays on desktop and phone |
| 1. MVP launch | Large | 60 levels in 6-8 worlds with a theme each; Classic + 3 characters, 4 upgrade tracks, stars, coins, cloud save; midgame + revive/double-coins rewarded; Basic then Full Launch | Basic Launch retention and session length look healthy |
| 2. Retention | Medium | Daily maze and streak, player level, trails and skins, character trials, ball cam | Ball cam gets real play and lifts retention |
| 3. Labyrinth | Large | Walk-through first-person mode on the same generator; joystick + mouse-look; explorer upgrades; comfort settings | |

## Open questions

- Allow a midgame ad after repeated falls? (Ball Smack never shows one there.)
- Keep the maze inside Ball Smack too? (Plan says yes.)
- Any link between the two games' economies? (Plan says not at launch.)
