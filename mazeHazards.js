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
