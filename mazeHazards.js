// MARBLE MAZE: hazard geometry and motion, as pure functions.
//
// Imports NOTHING, for the same reason mazeTilt.js does not: this is the maze's
// second body of "numbers that decide whether a level is fair", and it has to be
// runnable in Node. mazeGame.js drives the real thing with it, and
// test_maze_levels.js verifies every authored level with it -- from THIS file,
// not from a second copy of the arithmetic. A verifier that models gates
// slightly differently from the game is a verifier that certifies levels the
// game then makes impossible, which is exactly the failure the BFS solver was
// written to prevent in the first place.
//
// Gets no <script> tag in index.html (nothing to run on its own; mazeGame.js
// imports it).

// ---------------------------------------------------------------------------
// MOVING GATES
// ---------------------------------------------------------------------------
//
// A gate is a wall that slides back and forth along one axis, forever, on a
// fixed period. Authored as its OPEN position plus how far it travels to close:
//
//   { x, z, w, d, axis: 'x' | 'z', travel, periodMs, phase }
//
// `travel` is SIGNED -- a displacement from the open position, not a distance --
// so a bar that seals a gap on its left travels negative. That keeps "the
// authored position is the open one" true for every gate regardless of which
// way it slides, which is the property the verifier's soundness rests on.
//
// The authored {x, z} is deliberately the OPEN extreme rather than the centre of
// the sweep. Two reasons, and both matter to whoever authors a level:
//
//   1. It makes the level's guarantee legible. "Is this solvable?" is answered
//      by looking at the gate where it is authored -- the open state -- rather
//      than by mentally reconstructing a midpoint and half-travel.
//   2. It is what lets the verifier be sound without simulating time (see
//      gateOpenSpec's comment).
//
// Motion is a raised cosine rather than a triangle wave: the gate eases to a
// stop at each extreme instead of reversing instantly. A triangle wave reverses
// with infinite acceleration, which in a rigid-body sim means the gate can
// teleport through the ball's radius in a single step and either miss the
// collision entirely or launch the ball across the board.

// Where a gate sits along its travel at time t, as a fraction in [0, 1].
// 0 = fully open (the authored position), 1 = fully closed.
export function gateFraction(gate, tMs) {
    const period = Math.max(1, Number(gate.periodMs) || 3000);
    const phase = Number(gate.phase) || 0;
    const theta = 2 * Math.PI * (tMs / period + phase);
    return (1 - Math.cos(theta)) / 2;
}

// The gate's displacement from its authored position, in world units.
export function gateOffset(gate, tMs) {
    return (Number(gate.travel) || 0) * gateFraction(gate, tMs);
}

// Displacement RATE, in world units per second. Handed to the physics body as a
// kinematic velocity: cannon resolves a moving obstacle against a dynamic body
// through the obstacle's velocity, so a body whose position is teleported each
// frame while its velocity stays zero reads to the solver as a static wall the
// ball is suddenly overlapping -- which it "fixes" by ejecting the ball at
// speed. Setting the true velocity is what makes a gate nudge the ball instead
// of firing it.
export function gateVelocity(gate, tMs) {
    const period = Math.max(1, Number(gate.periodMs) || 3000);
    const phase = Number(gate.phase) || 0;
    const travel = Number(gate.travel) || 0;
    const theta = 2 * Math.PI * (tMs / period + phase);
    // d/dt of travel * (1 - cos(2π(t/T + φ)))/2, with t in ms -> per-second.
    return travel * Math.PI * Math.sin(theta) / period * 1000;
}

// A gate's position at a given fraction along its travel, as a plain
// {x, z, w, d} wall spec -- the same shape lv.walls uses, so every consumer
// (mesh builder, physics body, BFS occupancy test) treats a gate as just
// another wall that happens to have moved.
export function gateSpecAt(gate, fraction) {
    const travel = (Number(gate.travel) || 0) * fraction;
    const alongX = gate.axis !== 'z';
    return {
        x: gate.x + (alongX ? travel : 0),
        z: gate.z + (alongX ? 0 : travel),
        w: gate.w,
        d: gate.d
    };
}

// THE VERIFIER'S VIEW OF A GATE, and the reason level solvability survives
// hazards at all.
//
// A gate is periodic and never stops, so it is guaranteed to return to open
// however long the ball waits beside it. A player can therefore always take the
// open state -- there is no timing window that can be missed permanently, and no
// state the level can get stuck in. That makes "solvable with every gate open"
// a SOUND statement about the real, moving level, provable without simulating
// time at all.
//
// It is not vacuous either, which is the other half of what makes it the right
// check: a gate whose open extreme still blocks its corridor (the classic
// authoring slip -- travel too short for the gap) fails it, because BFS then
// finds no path. Deleting gates before solving would pass that level and ship
// something nobody can finish.
export function gateOpenSpec(gate) { return gateSpecAt(gate, 0); }
export function gateClosedSpec(gate) { return gateSpecAt(gate, 1); }

// Every cell the gate can ever occupy: the union of its extremes. Used to keep
// authors from parking a start, a goal or a hole inside a gate's path.
export function gateSweptSpec(gate) {
    const open = gateOpenSpec(gate);
    const closed = gateClosedSpec(gate);
    const minX = Math.min(open.x - open.w / 2, closed.x - closed.w / 2);
    const maxX = Math.max(open.x + open.w / 2, closed.x + closed.w / 2);
    const minZ = Math.min(open.z - open.d / 2, closed.z - closed.d / 2);
    const maxZ = Math.max(open.z + open.d / 2, closed.z + closed.d / 2);
    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
}

// ---------------------------------------------------------------------------
// ICE
// ---------------------------------------------------------------------------
//
// An ice patch is an axis-aligned floor rectangle the ball skids across:
// { x, z, w, d }. It changes CONTROL, never reachability -- everywhere the ball
// could go on wood it can still go on ice -- which is precisely why the static
// BFS solver stays valid with ice on the board and needs no extension for it.
//
// What ice does change is whether the player can STOP, and that is not a
// property any static solver can check. It is handled as an authoring rule
// instead (test_maze_levels.js enforces a buffer between ice and holes, and
// keeps the start off ice so a run never begins with no grip).

export function isOnIce(iceRects, x, z) {
    if (!iceRects || !iceRects.length) return false;
    for (const r of iceRects) {
        if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2) return true;
    }
    return false;
}

// Shortest distance from a point to a rectangle's edge, 0 if inside. Used by the
// ice-near-hole buffer check; exported so the game and the verifier agree on
// what "near" means.
export function distanceToRect(rect, x, z) {
    const dx = Math.max(Math.abs(x - rect.x) - rect.w / 2, 0);
    const dz = Math.max(Math.abs(z - rect.z) - rect.d / 2, 0);
    return Math.hypot(dx, dz);
}

// How slippery ice is, as a cannon friction coefficient, against the ordinary
// floor's 0.28. Low enough that the ball genuinely carries momentum across a
// patch, but deliberately not zero: a frictionless sphere never spins up, so it
// would slide as a dead weight and look like a bug rather than like ice.
export const ICE_FRICTION = 0.02;

// ---------------------------------------------------------------------------
// CONVEYORS -- a PUSHING trap (docs/PLAN.md), and the template for every other.
// ---------------------------------------------------------------------------
//
// A conveyor is a floor rect { x, z, w, d, dir, speed } that drags the ball
// toward `speed` along `dir` ('+x' | '-x' | '+z' | '-z') while its centre is
// on the belt. Tested against the centre, like ice, for the same reason: the
// patch edge is then the line the middle of the marble crosses.
//
// THE SOUNDNESS ARGUMENT. The verifier proves levels by reachability, and a
// push cannot be BFS'd. So a push is held strictly weaker than the player:
// the most a belt can accelerate the ball, CONVEYOR_MAX_ACCEL, is well under
// what full tilt gives a rolling ball. Whatever the belt does, the player can
// still drive against it, so every place reachable without the belt is still
// reachable with it, and the verifier's answer stands unchanged. A belt makes
// a corridor harder, never closed. test_maze_hazards.js holds the ratio.
//
// The drag acts only along the belt's axis and only toward the belt's speed:
// a ball already moving with the belt at its speed feels nothing, so a belt
// never launches the ball faster than it runs.
export const CONVEYOR_MAX_ACCEL = 3.6;      // world units / s^2
export const CONVEYOR_GRIP = 6;             // how hard the belt chases its speed, 1/s
export const CONVEYOR_MAX_SPEED = 3;        // the fastest a level may author a belt

const DIRS = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };

export function conveyorDir(belt) { return DIRS[belt && belt.dir] || null; }

// The belt under the ball's centre, or null. If belts touch, the first wins;
// the generator never lays overlapping belts.
export function conveyorAt(belts, x, z) {
    if (!belts || !belts.length) return null;
    for (const b of belts) {
        if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) return b;
    }
    return null;
}

// Acceleration the belt applies this instant, given the ball's velocity.
// Returns { ax, az } in world units / s^2, never longer than CONVEYOR_MAX_ACCEL.
export function conveyorAccel(belt, vx, vz) {
    const d = conveyorDir(belt);
    if (!d) return { ax: 0, az: 0 };
    const speed = Math.min(CONVEYOR_MAX_SPEED, Math.max(0, Number(belt.speed) || 0));
    const along = vx * d[0] + vz * d[1];
    const a = Math.max(-CONVEYOR_MAX_ACCEL, Math.min(CONVEYOR_MAX_ACCEL, (speed - along) * CONVEYOR_GRIP));
    return { ax: a * d[0], az: a * d[1] };
}

// ---------------------------------------------------------------------------
// WIND FANS -- world 2. A PUSHING trap, held to the conveyor's soundness
// argument: never stronger than half of full tilt (test_maze_hazards.js), so
// the player can always drive against it and reachability is unchanged.
// ---------------------------------------------------------------------------
//
// A fan is a zone { x, z, w, d, dir, periodMs, phase } blowing along `dir`
// ('+x' | '-x' | '+z' | '-z'). It blows in GUSTS on the run clock: a calm,
// a swell to full strength, and back -- the same every attempt, like a gate.
// While the ball's centre is in the zone it is pushed along dir with an
// acceleration of WIND_MAX_ACCEL x the gust strength, whatever its speed:
// wind does not care how fast you are already going, which is what makes it
// feel different from a belt.
export const WIND_MAX_ACCEL = 4.0;          // world units / s^2
export const WIND_CALM = 0.3;               // fraction of each period that is dead calm

// Gust strength 0..1 at run time tMs. Smooth rise and fall, then calm.
export function windStrength(fan, tMs) {
    const period = Math.max(1, Number(fan.periodMs) || 3000);
    const u = ((tMs / period + (Number(fan.phase) || 0)) % 1 + 1) % 1;
    const live = 1 - WIND_CALM;
    if (u >= live) return 0;
    return Math.sin(Math.PI * u / live) ** 2;
}

export function windAt(fans, x, z) {
    if (!fans || !fans.length) return null;
    for (const f of fans) if (Math.abs(x - f.x) <= f.w / 2 && Math.abs(z - f.z) <= f.d / 2) return f;
    return null;
}

export function windAccel(fan, tMs) {
    const d = conveyorDir(fan);
    if (!d) return { ax: 0, az: 0 };
    const a = WIND_MAX_ACCEL * windStrength(fan, tMs);
    return { ax: a * d[0], az: a * d[1] };
}

// ---------------------------------------------------------------------------
// FALLING ICICLES -- world 2. A TIMED trap, held to the gate's soundness
// argument: dangerous only in a short window each period, so waiting always
// gets you through and the verifier can solve with the floor clear.
// ---------------------------------------------------------------------------
//
// An icicle { x, z, r, periodMs, phase } hangs over a spot of floor. Each
// period it regrows, hangs, SHAKES for ICICLE_WARN_MS (its shadow growing on
// the floor -- the telegraph), then falls; for ICICLE_IMPACT_MS a ball whose
// centre is within r of the spot is knocked out, like a fall. Then it is
// shards, and it regrows.
export const ICICLE_WARN_MS = 900;
export const ICICLE_IMPACT_MS = 280;
export const ICICLE_MIN_PERIOD = 2400;

// Where in its cycle an icicle is: { state, k } with state one of
// 'grow' | 'hang' | 'shake' | 'impact' and k its 0..1 progress through it.
export function icicleState(ic, tMs) {
    const P = Math.max(ICICLE_MIN_PERIOD, Number(ic.periodMs) || ICICLE_MIN_PERIOD);
    const local = (((tMs / P + (Number(ic.phase) || 0)) % 1 + 1) % 1) * P;
    const fall = P - ICICLE_IMPACT_MS, warn = fall - ICICLE_WARN_MS, grown = warn * 0.45;
    if (local >= fall) return { state: 'impact', k: (local - fall) / ICICLE_IMPACT_MS };
    if (local >= warn) return { state: 'shake', k: (local - warn) / ICICLE_WARN_MS };
    if (local >= grown) return { state: 'hang', k: (local - grown) / (warn - grown) };
    return { state: 'grow', k: local / grown };
}

// Run time of an icicle's first impact.
export function firstImpactMs(ic) {
    const P = Math.max(ICICLE_MIN_PERIOD, Number(ic.periodMs) || ICICLE_MIN_PERIOD);
    const local0 = (((Number(ic.phase) || 0) % 1) + 1) % 1 * P;
    const fall = P - ICICLE_IMPACT_MS;
    // Rounded up to the whole millisecond so floating point cannot put the
    // answer a hair before the window opens.
    return Math.ceil((local0 <= fall ? fall - local0 : P - local0 + fall) - 1e-6);
}

// Is the ball (centre x, z) being struck right now?
export function icicleHits(icicles, tMs, x, z) {
    for (const ic of icicles || []) {
        if (icicleState(ic, tMs).state === 'impact' && Math.hypot(x - ic.x, z - ic.z) <= ic.r) return ic;
    }
    return null;
}

// ---------------------------------------------------------------------------
// WORLD 3, MAGMA WORKS. Three traps, each held to an argument already made:
// flares and geysers are TIMED (like icicles: waiting always works), molten
// gates are GATES (the level is solved with them open).
// ---------------------------------------------------------------------------

// A timed hazard's cycle: quiet, then `warn` ms of warning, then `live` ms of
// danger, then quiet again. Shared by flares and geysers.
function cycle(h, tMs, minPeriod, warn, live) {
    const P = Math.max(minPeriod, Number(h.periodMs) || minPeriod);
    const local = (((tMs / P + (Number(h.phase) || 0)) % 1 + 1) % 1) * P;
    const liveAt = P - live, warnAt = liveAt - warn;
    if (local >= liveAt) return { state: 'live', k: (local - liveAt) / live };
    if (local >= warnAt) return { state: 'warn', k: (local - warnAt) / warn };
    return { state: 'quiet', k: local / warnAt };
}
function firstLive(h, minPeriod, warn, live) {
    const P = Math.max(minPeriod, Number(h.periodMs) || minPeriod);
    const local0 = (((Number(h.phase) || 0) % 1) + 1) % 1 * P;
    const liveAt = P - live;
    let t = Math.ceil((local0 <= liveAt ? liveAt - local0 : P - local0 + liveAt) - 1e-6);
    // Floating point can put the exact boundary a hair on the warning side;
    // step to the first whole millisecond that really is live.
    while (cycle(h, t, minPeriod, warn, live).state !== 'live') t++;
    return t;
}

// FLARING SEAMS: a band of floor { x, z, w, d, periodMs, phase } across a
// corridor. It glows brighter for FLARE_WARN_MS, then FLARES for FLARE_MS: a
// ball on it then is burned (knocked out, like a hole). Between flares it is
// just floor -- FLARE_MIN_PERIOD leaves over a second of quiet to cross in.
export const FLARE_WARN_MS = 900;
export const FLARE_MS = 600;
export const FLARE_MIN_PERIOD = 2700;
export function flareState(f, tMs) {
    const c = cycle(f, tMs, FLARE_MIN_PERIOD, FLARE_WARN_MS, FLARE_MS);
    return { state: c.state === 'live' ? 'flare' : c.state, k: c.k };
}
export function firstFlareMs(f) { return firstLive(f, FLARE_MIN_PERIOD, FLARE_WARN_MS, FLARE_MS); }
// Burned if the ball's centre is on the band, or within half a radius of it:
// a ball mostly over the fire is in it.
export function flareHits(flares, tMs, x, z, R) {
    for (const f of flares || []) {
        if (flareState(f, tMs).state === 'flare' && distanceToRect(f, x, z) <= R * 0.5) return f;
    }
    return null;
}

// MOLTEN GATES: an ordinary gate (gateFraction et al.) marked `molten`. It
// burns while it is CLOSING -- its lava edge advancing, glowing -- and is a
// crusted, harmless wall while it opens. A player watches it close, waits,
// and goes through while it withdraws.
export function gateBurning(g, tMs) {
    if (!g || !g.molten) return false;
    const v = gateVelocity(g, tMs);
    return Math.abs(v) > 1e-6 && Math.sign(v) === Math.sign(Number(g.travel) || 0);
}
export function moltenGateHits(gates, tMs, x, z, R) {
    for (const g of gates || []) {
        if (!gateBurning(g, tMs)) continue;
        const at = gateSpecAt(g, gateFraction(g, tMs));
        if (distanceToRect(at, x, z) <= R + 0.02) return g;
    }
    return null;
}

// GEYSERS: a vent { x, z, r, reach, periodMs, phase }. It bubbles for
// GEYSER_WARN_MS, then BLASTS for GEYSER_BLAST_MS, pushing anything within
// `reach` straight away from the vent -- hardest at the vent, nothing at the
// edge of its reach. A blast can throw the ball a long way, so no hole may lie
// within GEYSER_HOLE_CLEAR of a vent (test_maze_levels.js): a geyser costs you
// position, never the run.
export const GEYSER_WARN_MS = 1000;
export const GEYSER_BLAST_MS = 320;
export const GEYSER_MIN_PERIOD = 3000;
export const GEYSER_ACCEL = 9;
export const GEYSER_HOLE_CLEAR = 2.2;
export function geyserState(g, tMs) {
    const c = cycle(g, tMs, GEYSER_MIN_PERIOD, GEYSER_WARN_MS, GEYSER_BLAST_MS);
    return { state: c.state === 'live' ? 'blast' : c.state, k: c.k };
}
export function firstBlastMs(g) { return firstLive(g, GEYSER_MIN_PERIOD, GEYSER_WARN_MS, GEYSER_BLAST_MS); }
export function geyserAccel(geysers, tMs, x, z) {
    let ax = 0, az = 0;
    for (const g of geysers || []) {
        if (geyserState(g, tMs).state !== 'blast') continue;
        const dx = x - g.x, dz = z - g.z, d = Math.hypot(dx, dz);
        if (d >= g.reach) continue;
        const a = GEYSER_ACCEL * (1 - d / g.reach);
        // Dead centre has no "away": throw it along +z, toward the player.
        const ux = d > 1e-6 ? dx / d : 0, uz = d > 1e-6 ? dz / d : 1;
        ax += ux * a; az += uz * a;
    }
    return { ax, az };
}

// ---------------------------------------------------------------------------
// WORLD 4, THE TOY BOX. Bumpers are BLOCKING (posts, solved as solid) with a
// bounded kick; spring pads are TIMED (they wind up, then fire -- cross in the
// quiet); spinning arms are TIMED too (a blade passes, the floor is clear
// again) and stand in rooms opened for them, never in a corridor.
// ---------------------------------------------------------------------------

// Every round post a level stands up -- bumpers and arm hubs -- as circles
// { x, z, r }. Solid to every search (the generator's and the verifier's):
// a ball centre within r + R of one is inside it.
export function postSpecs(lv) {
    return (lv.bumpers || []).map(b => ({ x: b.x, z: b.z, r: b.r }))
        .concat((lv.arms || []).map(a => ({ x: a.x, z: a.z, r: ARM_HUB_R })));
}
export function inPost(posts, x, z, R) {
    for (const p of posts) if (Math.hypot(x - p.x, z - p.z) <= p.r + R) return true;
    return false;
}

// BUMPERS: a pinball post { x, z, r }. Touching one kicks the ball straight
// off it at BUMPER_KICK (or bounces it back at BUMPER_BOUNCE of the speed it
// came in with, if that is more). So a kick never returns the ball faster
// than it arrived plus BUMPER_KICK, and no hole lies within BUMPER_HOLE_CLEAR
// of a bumper (test_maze_levels.js): a kick costs position, never the run.
// The Obsidian Core prize passes scale 0.5.
export const BUMPER_KICK = 3.0;
export const BUMPER_BOUNCE = 0.6;
export const BUMPER_HOLE_CLEAR = 1.5;
export const BUMPER_TOUCH = 0.03;          // contact slop: how close counts as touching

// The ball's velocity after touching bumper b, or null if it is not touching
// it (or is already leaving faster than a kick).
export function bumperKick(b, x, z, vx, vz, R, scale = 1) {
    const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz);
    if (d > b.r + R + BUMPER_TOUCH) return null;
    const nx = d > 1e-6 ? dx / d : 0, nz = d > 1e-6 ? dz / d : 1;
    const vn = vx * nx + vz * nz;
    const kick = BUMPER_KICK * scale;
    if (vn >= kick) return null;
    const out = Math.max(kick, -vn * BUMPER_BOUNCE);
    return { vx: vx + (out - vn) * nx, vz: vz + (out - vn) * nz };
}

// SPRING PADS: a floor plate { x, z, w, d, dir, periodMs, phase } that winds
// down for SPRING_WARN_MS (the telegraph), then FIRES for SPRING_FIRE_MS: a
// ball on it then is launched along dir at SPRING_SPEED. Between shots it is
// floor. Its launch lane -- from the pad along dir to the first wall -- is
// kept clear of holes (test_maze_levels.js), so a launch costs position (or
// gains it), never the run.
export const SPRING_WARN_MS = 900;
export const SPRING_FIRE_MS = 140;
export const SPRING_MIN_PERIOD = 2600;
export const SPRING_SPEED = 3.4;
export const SPRING_LANE_CLEAR = 0.3;      // extra room between a launch lane and a hole
export function springState(p, tMs) {
    const c = cycle(p, tMs, SPRING_MIN_PERIOD, SPRING_WARN_MS, SPRING_FIRE_MS);
    return { state: c.state === 'live' ? 'fire' : c.state === 'warn' ? 'wind' : 'rest', k: c.k };
}
export function firstFireMs(p) { return firstLive(p, SPRING_MIN_PERIOD, SPRING_WARN_MS, SPRING_FIRE_MS); }
// Which shot this is (an integer that changes once per period), so the game
// launches the ball once per shot however many physics steps the shot spans.
export function springShot(p, tMs) {
    const P = Math.max(SPRING_MIN_PERIOD, Number(p.periodMs) || SPRING_MIN_PERIOD);
    return Math.floor(tMs / P + (Number(p.phase) || 0));
}
// The pad firing under the ball's centre (or within half a radius of it).
export function springUnder(pads, tMs, x, z, R) {
    for (const p of pads || []) {
        if (springState(p, tMs).state === 'fire' && distanceToRect(p, x, z) <= R * 0.5) return p;
    }
    return null;
}
// The ball's velocity after a launch: SPRING_SPEED along dir, whatever it was
// doing along that axis; half its sideways speed kept.
export function springLaunch(p, vx, vz) {
    const d = conveyorDir(p);
    if (!d) return { vx, vz };
    return d[0] ? { vx: d[0] * SPRING_SPEED, vz: vz * 0.5 } : { vx: vx * 0.5, vz: d[1] * SPRING_SPEED };
}

// SPINNING ARMS: a rotor { x, z, len, periodMs, phase, dir } -- a hub post
// with a blade either side, len from the hub to each tip, turning one full
// turn per periodMs (dir +1 or -1). Angle 0 lies along +x; the angle grows
// from +x toward +z. A blade shoves the ball (a kinematic body, like a gate),
// it never kills: the arm's whole sweep stays clear of walls, holes, start
// and goal, and a ball it pushes always has somewhere to go (no pinch,
// armEscapes) -- checked by test_maze_levels.js.
export const ARM_HUB_R = 0.12;
export const ARM_HALF_T = 0.05;            // half the blade's thickness
export const ARM_MIN_PERIOD = 4000;
export function armAngle(a, tMs) {
    const P = Math.max(ARM_MIN_PERIOD, Number(a.periodMs) || ARM_MIN_PERIOD);
    return (a.dir < 0 ? -1 : 1) * 2 * Math.PI * (tMs / P + (Number(a.phase) || 0));
}
// Radians per second, signed like armAngle.
export function armSpin(a) {
    const P = Math.max(ARM_MIN_PERIOD, Number(a.periodMs) || ARM_MIN_PERIOD);
    return (a.dir < 0 ? -1 : 1) * 2 * Math.PI * 1000 / P;
}
// How far from the hub anything of the arm reaches.
export function armReach(a) { return a.len + ARM_HALF_T; }
// Is a ball (centre x, z, radius R) touching a blade at time t?
export function armTouches(a, tMs, x, z, R) {
    const th = armAngle(a, tMs), ux = Math.cos(th), uz = Math.sin(th);
    const dx = x - a.x, dz = z - a.z;
    const along = Math.max(-a.len, Math.min(a.len, dx * ux + dz * uz));
    return Math.hypot(dx - along * ux, dz - along * uz) <= R + ARM_HALF_T;
}
// THE ROOM RULES, held by test_maze_levels.js. D is the distance from the hub
// to the nearest wall (or the board's edge):
//   - the blade never reaches a wall (reach <= D - ARM_WALL_GAP), so it never
//     cuts through one;
//   - lying alongside a wall, a blade leaves the ball room to sit between
//     (D - ARM_HALF_T >= 2R + ARM_WALL_GAP), so it never crushes the ball.
// The rooms are rectangles, and a ball the blade carries into a square corner
// slides out along one wall (the push there runs along the other diagonal) --
// so a ball is carried round the room, never wedged.
export const ARM_WALL_GAP = 0.04;
export function armWallDistance(a, walls, size) {
    let D = size ? Math.min(size.w / 2 - Math.abs(a.x), size.d / 2 - Math.abs(a.z)) : Infinity;
    for (const w of walls || []) D = Math.min(D, distanceToRect(w, a.x, a.z));
    return D;
}
export function armRoomProblem(a, walls, size, R) {
    const D = armWallDistance(a, walls, size);
    if (armReach(a) > D - ARM_WALL_GAP) return `its blade reaches ${armReach(a).toFixed(2)} but a wall is ${D.toFixed(2)} away -- it would cut through it`;
    if (D - ARM_HALF_T < 2 * R + ARM_WALL_GAP) return `a blade alongside the nearest wall leaves ${(D - ARM_HALF_T).toFixed(2)}, too little for the ball -- it would crush it`;
    return null;
}

// ---------------------------------------------------------------------------
// WORLD 5, THE FOUNDRY. Magnets are PUSHING (held under half of full tilt,
// like wind, so the player can always pull away); crushers are TIMED (a press
// that is up most of its cycle and always warns before it drops); electric
// rails are FATAL ZONES the verifier solves around as if always live, like
// holes -- and they are only live part of the time on top of that.
// ---------------------------------------------------------------------------

// MAGNETS: mounted on a wall, pulling the ball toward the point (x, z) on the
// wall's face while it is within `reach`: hardest close in, nothing at the
// edge. { x, z, nx, nz, reach } -- (nx, nz) is the face's normal, pointing
// into the corridor. Never more than MAGNET_MAX_ACCEL (test_maze_hazards.js
// holds it under half of full tilt). The Plastic Ball prize switches them off.
export const MAGNET_MAX_ACCEL = 3.8;
export function magnetAccel(magnets, x, z) {
    let ax = 0, az = 0;
    for (const m of magnets || []) {
        const dx = m.x - x, dz = m.z - z, d = Math.hypot(dx, dz);
        if (d >= m.reach || d < 1e-6) continue;
        const a = MAGNET_MAX_ACCEL * (1 - d / m.reach);
        ax += dx / d * a; az += dz / d * a;
    }
    // Two fields overlapping could add up past the cap; the generator keeps
    // them apart, and this keeps the promise regardless.
    const n = Math.hypot(ax, az);
    if (n > MAGNET_MAX_ACCEL) { ax *= MAGNET_MAX_ACCEL / n; az *= MAGNET_MAX_ACCEL / n; }
    return { ax, az };
}

// CRUSHERS: a press { x, z, w, d, periodMs, phase } over a stretch of floor.
// Up (high above the walls) most of its cycle; then it shudders for
// CRUSH_WARN_MS, slams down in CRUSH_SLAM_MS, sits on the floor for
// CRUSH_DOWN_MS -- a wall while it does -- and rises over CRUSH_RISE_MS. A
// ball under it as it comes down is crushed. CRUSH_MIN_PERIOD leaves over a
// second up to pass under in.
export const CRUSH_UP_H = 0.75;
export const CRUSH_WARN_MS = 800;
export const CRUSH_SLAM_MS = 150;
export const CRUSH_DOWN_MS = 450;
export const CRUSH_RISE_MS = 700;
export const CRUSH_MIN_PERIOD = 3400;
export function crusherState(c, tMs) {
    const P = Math.max(CRUSH_MIN_PERIOD, Number(c.periodMs) || CRUSH_MIN_PERIOD);
    const local = (((tMs / P + (Number(c.phase) || 0)) % 1 + 1) % 1) * P;
    const riseAt = P - CRUSH_RISE_MS, downAt = riseAt - CRUSH_DOWN_MS, slamAt = downAt - CRUSH_SLAM_MS, warnAt = slamAt - CRUSH_WARN_MS;
    if (local >= riseAt) return { state: 'rise', k: (local - riseAt) / CRUSH_RISE_MS };
    if (local >= downAt) return { state: 'down', k: (local - downAt) / CRUSH_DOWN_MS };
    if (local >= slamAt) return { state: 'slam', k: (local - slamAt) / CRUSH_SLAM_MS };
    if (local >= warnAt) return { state: 'warn', k: (local - warnAt) / CRUSH_WARN_MS };
    return { state: 'up', k: local / warnAt };
}
// How high the press's underside is, and how fast it is moving (units/s).
export function crusherBottom(c, tMs) {
    const s = crusherState(c, tMs);
    if (s.state === 'slam') return CRUSH_UP_H * (1 - s.k * s.k);
    if (s.state === 'down') return 0;
    if (s.state === 'rise') return CRUSH_UP_H * s.k;
    return CRUSH_UP_H;
}
export function crusherVelocity(c, tMs) {
    const s = crusherState(c, tMs);
    if (s.state === 'slam') return -CRUSH_UP_H * 2 * s.k / (CRUSH_SLAM_MS / 1000);
    if (s.state === 'rise') return CRUSH_UP_H / (CRUSH_RISE_MS / 1000);
    return 0;
}
// Run time of a crusher's first slam.
export function firstSlamMs(c) {
    let t = 0;
    while (crusherState(c, t).state === 'slam') t += 5;          // starting mid-slam: go round
    while (crusherState(c, t).state !== 'slam' && t < 60000) t++;
    return t;
}
// Crushed: the press is coming down or down, and is lower than the ball is
// tall, and the ball is under it (centre within 0.9 radius of its footprint).
export function crusherHits(crushers, tMs, x, z, R) {
    for (const c of crushers || []) {
        const st = crusherState(c, tMs).state;
        if (st !== 'slam' && st !== 'down') continue;
        if (crusherBottom(c, tMs) >= 2 * R) continue;
        if (distanceToRect(c, x, z) < R * 0.9) return c;
    }
    return null;
}

// ELECTRIC RAILS: a live strip { x, z, w, d, nx, nz, periodMs, phase } set
// into a wall's face, (nx, nz) pointing into the corridor. Dead, it warns
// for RAIL_WARN_MS (sparks), then it is LIVE for RAIL_LIVE_MS: a ball touching
// that stretch of wall (centre within R + RAIL_TOUCH of the strip) is
// shocked. The verifier treats every rail as always live, like a hole -- the
// middle of the corridor must still be a way through -- so the timing is
// only ever a mercy.
export const RAIL_WARN_MS = 600;
export const RAIL_LIVE_MS = 1100;
export const RAIL_MIN_PERIOD = 2400;
export const RAIL_TOUCH = 0.04;
export function railState(r, tMs) {
    const c = cycle(r, tMs, RAIL_MIN_PERIOD, RAIL_WARN_MS, RAIL_LIVE_MS);
    return { state: c.state === 'live' ? 'live' : c.state === 'warn' ? 'warn' : 'dead', k: c.k };
}
export function firstLiveMs(r) { return firstLive(r, RAIL_MIN_PERIOD, RAIL_WARN_MS, RAIL_LIVE_MS); }
// The zone a ball centre must stay out of near a rail (live or not).
export function inRailZone(rails, x, z, R) {
    for (const r of rails || []) if (distanceToRect(r, x, z) <= R + RAIL_TOUCH) return r;
    return null;
}
export function railHits(rails, tMs, x, z, R) {
    for (const r of rails || []) {
        if (railState(r, tMs).state === 'live' && distanceToRect(r, x, z) <= R + RAIL_TOUCH) return r;
    }
    return null;
}
