#!/usr/bin/env node
// MARBLE MAZE: every level must be well-formed AND actually finishable.
//
// This test exists because the first draft of level w1_01 was UNSOLVABLE and
// looked completely fine. Two vertical walls turned the right-hand channel into
// a sealed pocket: the ball could enter it through a gap and then had no way
// out, because the wall below it and the wall beside it overlapped once both
// were inflated by the ball's radius. Nothing about the numbers looked wrong,
// and a screenshot of the level showed a perfectly plausible maze.
//
// So levels are not trusted to an author's eye. Each one is BFS-solved on a
// grid in BALL-CENTRE space -- walls and the boundary inflated by the ball
// radius, holes treated as fatal -- and must have a path from start to goal.
//
// It also checks the things that make a level unplayable rather than
// unsolvable: geometry outside its own bounds, a start or goal sitting inside
// a wall or over a hole, and a ball too fat for a gap.
//
// Negative control: delete a wall's gap (widen it to the full board) and the
// solvability check fails; move a hole onto the start and the placement check
// fails.

const path = require('path');
const DATA = require('./mazeLevels.json');
// The theme catalog is mazeThemes.js (an ES module, loaded in run()).
let THEMES = {};

const GRID = 0.05;   // fine enough to find a channel a ball can actually use

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

// HOW MUCH SLACK THE FORCED ROUTE MUST HAVE, in ball radii, per side.
//
// The BFS below proves a ball CENTRE can reach the goal. A slot a hundredth of
// a unit wider than the marble satisfies that, and nobody threads a slot like
// that under tilt control -- so "solvable" and "passable" are different claims
// and only the first was being made.
//
// Two shipped levels showed the difference. A gate retracts along its own axis
// into the cell next door; when that is the same corridor the bar stands in,
// the bar never leaves the corridor's cross-section. Glass Floor's gate sat in
// its corridor at the OPEN extreme leaving a 0.04-wide slot beside it for a
// 0.56 marble, from the first frame -- and closing it took away no floor that
// anything else was not already taking, so the inert-gate check below did not
// fire and waiting never helped the player either.
//
// The measured margin either side of this number is wide, which is what makes
// it a guard rather than a tuning knob: every healthy shipped level cleared
// 0.96 radii, the two bad ones managed 0.25 and 0.09.
const FIT_MARGIN_R = 0.5;

// Can a ball grown by FIT_MARGIN_R still get from start to goal? Deliberately
// the SAME search as the solvability check, with one number changed -- a
// separate clearance metric would be a second model of the level's geometry,
// free to disagree with the one that decides whether a level ships.
//
// Gates sit at their OPEN extreme, the most permissive state they ever reach,
// so a bar that fails here fails at every phase.
//
// HOLES ARE IGNORED, and that is the line this check draws: it asks whether the
// ball FITS. A hole is not a gap to fit through, it is a hazard to steer around,
// and steering past one at speed is the mode's skill expression -- shipped
// levels leave under a third of a radius between route and hole rim on purpose.
// Whether a route past the holes exists at all stays the job of `reachable`.
function fitsWithMargin(lv, H) {
    const R = lv.ballRadius * (1 + FIT_MARGIN_R);
    const hw = lv.size.w / 2, hd = lv.size.d / 2;
    const solids = lv.walls.concat((Array.isArray(lv.gates) ? lv.gates : []).map(g => H.gateOpenSpec(g)));
    const blocked = (x, z) =>
        Math.abs(x) > hw - R || Math.abs(z) > hd - R
        || solids.some(w => Math.abs(x - w.x) <= w.w / 2 + R && Math.abs(z - w.z) <= w.d / 2 + R);

    const nx = Math.round(lv.size.w / GRID), nz = Math.round(lv.size.d / GRID);
    const px = i => -hw + i * GRID, pz = j => -hd + j * GRID;
    const si = Math.round((lv.start.x + hw) / GRID), sj = Math.round((lv.start.z + hd) / GRID);
    const gi = Math.round((lv.goal.x + hw) / GRID), gj = Math.round((lv.goal.z + hd) / GRID);
    if (blocked(px(si), pz(sj)) || blocked(px(gi), pz(gj))) return false;

    const seen = new Set([si + '_' + sj]);
    let q = [[si, sj]];
    while (q.length) {
        const nq = [];
        for (const [i, j] of q) {
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const a = i + di, b = j + dj;
                if (a < 0 || b < 0 || a > nx || b > nz) continue;
                const k = a + '_' + b;
                if (seen.has(k) || blocked(px(a), pz(b))) continue;
                if (a === gi && b === gj) return true;
                seen.add(k);
                nq.push([a, b]);
            }
        }
        q = nq;
    }
    return false;
}

// The floor a player can actually roll to, plus how much free floor exists at
// all. Walls and `gateSpecs` are solid; a hole is fatal, so floor inside one is
// neither somewhere to stand nor somewhere to cross.
function reachableFloor(lv, gateSpecs) {
    const R = lv.ballRadius;
    const hw = lv.size.w / 2, hd = lv.size.d / 2;
    const solids = lv.walls.concat(gateSpecs);
    const solid = (x, z) => Math.abs(x) > hw - R || Math.abs(z) > hd - R
        || solids.some(w => Math.abs(x - w.x) <= w.w / 2 + R && Math.abs(z - w.z) <= w.d / 2 + R);
    const holed = (x, z) => (lv.holes || []).some(h => Math.hypot(x - h.x, z - h.z) <= h.r);
    // THE EXIT ABSORBS. mazeGame.js's checkOutcomes wins the run the moment the
    // ball centre enters the goal disc, so the ball never comes out the far side
    // of it. Floor whose only way in leads through the goal is floor nobody will
    // ever stand on, and a false route that opens only past the exit is one
    // nobody can be tempted down. Counting the goal as ordinary floor calls both
    // reachable and misses it: two levels had over half their maze back there,
    // one with seven of its thirteen holes.
    const won = (x, z) => Math.hypot(x - lv.goal.x, z - lv.goal.z) <= lv.goal.r;

    const nx = Math.round(lv.size.w / GRID), nz = Math.round(lv.size.d / GRID);
    const px = i => -hw + i * GRID, pz = j => -hd + j * GRID;
    const free = new Set();
    for (let i = 0; i <= nx; i++) {
        for (let j = 0; j <= nz; j++) {
            const x = px(i), z = pz(j);
            if (!solid(x, z) && !holed(x, z) && !won(x, z)) free.add(i + '_' + j);
        }
    }
    const si = Math.round((lv.start.x + hw) / GRID), sj = Math.round((lv.start.z + hd) / GRID);
    const seen = new Set();
    if (free.has(si + '_' + sj)) {
        seen.add(si + '_' + sj);
        let q = [[si, sj]];
        while (q.length) {
            const nq = [];
            for (const [i, j] of q) {
                for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const a = i + di, b = j + dj, k = a + '_' + b;
                    if (seen.has(k) || !free.has(k)) continue;
                    seen.add(k);
                    nq.push([a, b]);
                }
            }
            q = nq;
        }
    }
    return { seen, free, px, pz, area: n => n * GRID * GRID };
}

// A sliver of centre-space pinched off behind a hole against a wall is rounding,
// not a place. One ball's own footprint is the smallest thing worth calling one.
const ORPHAN_TOL = 0.35;

function openSpecsOf(lv, H) {
    return (Array.isArray(lv.gates) ? lv.gates : []).map(g => H.gateOpenSpec(g));
}

function analyse(lv, H) {
    const R = lv.ballRadius;
    const hw = lv.size.w / 2, hd = lv.size.d / 2;

    // GATES ARE SOLVED AT THEIR OPEN EXTREME, and that is a deliberate, load-
    // bearing choice rather than a convenience.
    //
    // A gate never stops and never ends its cycle closed, so a ball can wait
    // beside one for as long as it likes and the open state always comes round.
    // "Solvable with every gate open" is therefore a true statement about the
    // moving level, and it needs no simulation of time to establish -- which
    // matters, because a time-expanded search would need a speed model for the
    // ball, and this file has no business asserting how fast a marble rolls.
    //
    // The alternative -- ignoring gates entirely -- would be unsound in the
    // direction that actually ships broken levels: a gate authored with its
    // OPEN position already overlapping the corridor blocks the route at every
    // phase, and deleting it before solving would certify a level nobody can
    // finish. Including it at its open extreme catches exactly that.
    //
    // Note what this check does NOT catch, because it is easy to assume it
    // does: a gate whose TRAVEL is too short to reach across its gap passes
    // here untouched, since travel only moves the closed extreme. That gate is
    // not unsolvable, it is inert -- it never blocks anything and the author
    // gets a hazard that isn't one. `inertGates` below is what catches that.
    const gateSpecs = (Array.isArray(lv.gates) ? lv.gates : []).map(g => H.gateOpenSpec(g));
    const solids = lv.walls.concat(gateSpecs);

    // A ball CENTRE may not be inside a wall inflated by R, nor outside the
    // boundary inset by R. Holes are not obstacles -- they are fatal -- so for
    // pathing purposes a centre over a hole is simply not a place a run can
    // continue from.
    //
    // ICE is deliberately absent from this test. It changes how hard the ball is
    // to control, never where it can go, so it cannot affect reachability and
    // must not affect the solver. What ice CAN do -- carry a player into a hole
    // they meant to stop short of -- is not a property any static search can
    // decide, and is handled as an authoring rule further down instead.
    const inWall = (x, z) => solids.some(w =>
        Math.abs(x - w.x) <= w.w / 2 + R && Math.abs(z - w.z) <= w.d / 2 + R);
    const outside = (x, z) => Math.abs(x) > hw - R || Math.abs(z) > hd - R;
    const inHole = (x, z) => lv.holes.some(h => Math.hypot(x - h.x, z - h.z) <= h.r);
    const free = (x, z) => !outside(x, z) && !inWall(x, z) && !inHole(x, z);

    const nx = Math.round(lv.size.w / GRID), nz = Math.round(lv.size.d / GRID);
    const px = i => -hw + i * GRID, pz = j => -hd + j * GRID;
    const si = Math.round((lv.start.x + hw) / GRID), sj = Math.round((lv.start.z + hd) / GRID);
    const gi = Math.round((lv.goal.x + hw) / GRID), gj = Math.round((lv.goal.z + hd) / GRID);

    const startFree = free(px(si), pz(sj));
    const goalFree = free(px(gi), pz(gj));

    let reachable = false;
    if (startFree && goalFree) {
        const seen = new Set([si + '_' + sj]);
        let q = [[si, sj]];
        while (q.length && !reachable) {
            const nq = [];
            for (const [i, j] of q) {
                for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const a = i + di, b = j + dj;
                    if (a < 0 || b < 0 || a > nx || b > nz) continue;
                    const k = a + '_' + b;
                    if (seen.has(k) || !free(px(a), pz(b))) continue;
                    seen.add(k);
                    if (a === gi && b === gj) { reachable = true; break; }
                    nq.push([a, b]);
                }
                if (reachable) break;
            }
            q = nq;
        }
    }
    // Which gates never obstruct anything AT ALL -- a bar that closes into
    // solid wall, or that has nowhere to close into. It still slides, still
    // draws, and still reads to the player as a threat, but the level plays
    // exactly as if it were not there. Nothing else in this file would notice,
    // because an inert gate makes a level EASIER and every other check is
    // hunting for impossible.
    //
    // Note the line this deliberately draws. A gate that closes only PART of
    // the way across its gap is not inert and is not flagged: narrowing a
    // passage without sealing it is a legitimate hazard, and an author who
    // wants a bar that pinches rather than blocks should be able to have one.
    // The check fires only when closing takes away no floor whatsoever.
    //
    // Measured as occupancy rather than reachability on purpose. "Closing this
    // gate changes which cells the ball may occupy" is exactly the claim a gate
    // makes; asking instead whether it changes solvability would flag a gate
    // that seals a corridor the shortest route never uses, which is fine design.
    const inertGates = [];
    (Array.isArray(lv.gates) ? lv.gates : []).forEach((g, gi) => {
        const open = H.gateOpenSpec(g), closed = H.gateClosedSpec(g);
        const occupies = (spec, x, z) =>
            Math.abs(x - spec.x) <= spec.w / 2 + R && Math.abs(z - spec.z) <= spec.d / 2 + R;
        const otherSolids = solids.filter((_, k) => k !== lv.walls.length + gi);
        let denied = 0;
        for (let i = 0; i <= nx && !denied; i++) {
            for (let j = 0; j <= nz; j++) {
                const x = px(i), z = pz(j);
                if (outside(x, z) || inHole(x, z)) continue;
                // A cell only counts if the gate is the ONLY thing denying it --
                // a bar that closes into solid wall has taken nothing away.
                if (!occupies(closed, x, z) || occupies(open, x, z)) continue;
                if (otherSolids.some(w => Math.abs(x - w.x) <= w.w / 2 + R && Math.abs(z - w.z) <= w.d / 2 + R)) continue;
                denied++;
                break;
            }
        }
        if (!denied) inertGates.push(gi);
    });

    return { startFree, goalFree, reachable, inWall, inHole, outside, hw, hd, R, inertGates };
}

// Conveyors, coins and pickups. Separate from the main loop only to keep that
// loop readable; same analysis, same reachable floor.
function checkExtras(lv, H, P) {
    const tag = `level ${lv.id}`;
    const a = analyse(lv, H);
    const openSpecs = openSpecsOf(lv, H);
    const rf = reachableFloor(lv, openSpecs);
    const sweeps = (lv.gates || []).map(g => H.gateSweptSpec(g));
    const overlap = (p, q, pad = 0) => Math.abs(p.x - q.x) < (p.w + q.w) / 2 + pad && Math.abs(p.z - q.z) < (p.d + q.d) / 2 + pad;

    // CONVEYORS -- a pushing trap. Reachability is untouched because a belt is
    // weaker than full tilt (test_maze_hazards.js holds that), so what is left
    // to check is placement: what a belt must never do to a ball that cannot
    // yet have reacted.
    (Array.isArray(lv.conveyors) ? lv.conveyors : []).forEach((c, n) => {
        const ctag = `${tag}: conveyor ${n} at (${c.x},${c.z})`;
        check(Number.isFinite(c.w) && c.w > 0 && Number.isFinite(c.d) && c.d > 0, `${ctag} needs positive w and d`);
        check(!!H.conveyorDir(c), `${ctag} needs dir '+x', '-x', '+z' or '-z', got ${JSON.stringify(c.dir)}`);
        check(Number.isFinite(c.speed) && c.speed > 0 && c.speed <= H.CONVEYOR_MAX_SPEED,
            `${ctag} needs a speed in (0, ${H.CONVEYOR_MAX_SPEED}], got ${c.speed}`);
        check(Math.abs(c.x) + c.w / 2 <= a.hw + 1e-6 && Math.abs(c.z) + c.d / 2 <= a.hd + 1e-6, `${ctag} extends outside the level bounds`);
        check(H.distanceToRect(c, lv.start.x, lv.start.z) > a.R, `${ctag} covers the START -- a run must not begin already moving`);
        check(H.distanceToRect(c, lv.goal.x, lv.goal.z) > lv.goal.r, `${ctag} touches the GOAL -- a belt must not decide the win`);
        for (const h of lv.holes) {
            check(H.distanceToRect(c, h.x, h.z) > a.R,
                `${ctag} has the hole at (${h.x},${h.z}) on it -- a ball being carried over a hole cannot avoid it. A belt may lead TO a hole, never carry over one.`);
        }
        sweeps.forEach(sw => check(!overlap(c, sw, a.R), `${ctag} lies under a gate's sweep -- the ball would be shoved by the bar and the belt at once`));
        (lv.ice || []).forEach(r => check(!overlap(c, r), `${ctag} overlaps ice`));
        // Two belts touching would hand the ball from one push to another with
        // no plain floor between to react on -- and overlapping, the first
        // in the list silently wins (conveyorAt), so what is drawn lies.
        lv.conveyors.slice(0, n).forEach((o, k) => check(!overlap(c, o, a.R), `${ctag} touches conveyor ${k} -- belts need plain floor between them`));
        const live = [...rf.seen].some(k => {
            const [i, j] = k.split('_').map(Number);
            return H.conveyorAt([c], rf.px(i), rf.pz(j)) === c;
        });
        check(live, `${ctag} is UNREACHABLE -- decoration, not a trap`);
    });

    // COINS AND PICKUPS. Every one must be collectible by a ball standing on
    // reachable floor, without that ball being over a hole, and must not sit
    // where a gate sweeps (a coin you can only take by being crushed is a
    // trap pretending to be a reward). Start and goal stay clear: a coin on
    // the goal would be collected by winning, which is no decision at all.
    const reachableAt = (x, z, reach) => {
        const ci = Math.round((x + a.hw) / GRID), cj = Math.round((z + a.hd) / GRID);
        const span = Math.ceil(reach / GRID);
        for (let i = ci - span; i <= ci + span; i++) {
            for (let j = cj - span; j <= cj + span; j++) {
                if (rf.seen.has(i + '_' + j) && Math.hypot(rf.px(i) - x, rf.pz(j) - z) <= reach) return true;
            }
        }
        return false;
    };
    const items = [
        ...(lv.coins || []).map((c, n) => ({ ...c, what: `coin ${n}`, reach: a.R + P.COIN_RADIUS })),
        ...(lv.pickups || []).map((p, n) => ({ ...p, what: `pickup ${n} (${p.kind})`, reach: a.R + P.PICKUP_RADIUS }))
    ];
    check(Array.isArray(lv.coins), `${tag}: needs a coins array (empty is allowed)`);
    for (const it of items) {
        const itag = `${tag}: ${it.what} at (${it.x},${it.z})`;
        check(Math.abs(it.x) <= a.hw && Math.abs(it.z) <= a.hd, `${itag} is outside the level`);
        check(reachableAt(it.x, it.z, it.reach), `${itag} is UNREACHABLE -- no floor the ball can stand on is within reach of it`);
        for (const h of lv.holes) {
            check(Math.hypot(it.x - h.x, it.z - h.z) >= h.r + a.R,
                `${itag} is over or at the lip of the hole at (${h.x},${h.z}) -- taking it would mean falling in`);
        }
        sweeps.forEach(sw => check(H.distanceToRect(sw, it.x, it.z) > a.R, `${itag} lies in a gate's sweep`));
        check(Math.hypot(it.x - lv.goal.x, it.z - lv.goal.z) > lv.goal.r + it.reach, `${itag} is on the GOAL`);
        check(Math.hypot(it.x - lv.start.x, it.z - lv.start.z) > a.R + it.reach, `${itag} is on the START -- collected before the run begins`);
    }
    (lv.pickups || []).forEach((p, n) => check(P.POWERUP_KINDS.includes(p.kind), `${tag}: pickup ${n} has unknown kind '${p.kind}' (have: ${P.POWERUP_KINDS.join(', ')})`));
}

async function run() {
    // The hazard geometry comes from the GAME's own module, not from a copy
    // reimplemented here. A verifier that modelled gates even slightly
    // differently from the thing that draws them would certify levels the game
    // then makes impossible -- the precise failure this file exists to prevent.
    const H = await import('./mazeHazards.js');
    THEMES = (await import('./mazeThemes.js')).MAZE_THEMES;
    const P = await import('./mazePickups.js');

    check(DATA.schemaVersion === 1, `unexpected schemaVersion ${DATA.schemaVersion}`);
    check(Array.isArray(DATA.levels) && DATA.levels.length > 0, 'mazeLevels.json must contain at least one level');

    const ids = new Set();
    for (const lv of DATA.levels) {
        const tag = `level ${lv.id}`;

        // --- schema ---------------------------------------------------------
        check(typeof lv.id === 'string' && lv.id, `${tag}: needs a string id`);
        check(!ids.has(lv.id), `${tag}: duplicate id`);
        ids.add(lv.id);
        check(Number.isFinite(lv.ballRadius) && lv.ballRadius > 0, `${tag}: ballRadius must be a positive number`);
        check(lv.size && lv.size.w > 0 && lv.size.d > 0, `${tag}: size must have positive w and d`);
        check(Array.isArray(lv.walls), `${tag}: walls must be an array`);
        check(Array.isArray(lv.holes), `${tag}: holes must be an array`);
        check(lv.start && Number.isFinite(lv.start.x) && Number.isFinite(lv.start.z), `${tag}: needs a start`);
        check(lv.goal && Number.isFinite(lv.goal.x) && Number.isFinite(lv.goal.z) && lv.goal.r > 0, `${tag}: needs a goal with a radius`);
        // Phase 3's server validation reads these; a level shipped without them
        // would have no floor to reject an impossible time against.
        check(Number.isFinite(lv.minMs) && lv.minMs > 0, `${tag}: minMs must be a positive number`);
        check(Number.isFinite(lv.goldMs) && lv.goldMs > lv.minMs, `${tag}: goldMs must exceed minMs`);

        // The theme decides how the level LOOKS, and it is authored separately
        // from the level (admin console) -- so a typo or a renamed theme is
        // easy to make and invisible until someone plays the level and finds it
        // wearing the fallback. mazeGame.js falls back deliberately rather than
        // crashing; this makes sure nobody SHIPS relying on that fallback.
        // Checked against the generated rarity map because that is derived from
        // cosmetics.js and cannot drift from the real catalog.
        check(typeof lv.theme === 'string' && lv.theme, `${tag}: needs a theme id`);
        check(!!(THEMES[lv.theme]),
            `${tag}: theme '${lv.theme}' is not in mazeThemes.js (have: ${Object.keys(THEMES).join(', ')}). It would silently render with the fallback theme.`);

        // A level blending into a second theme (world 1: workshop -> forest)
        // names one that exists and how far along it is.
        if (lv.themeTo !== undefined) {
            check(!!THEMES[lv.themeTo], `${tag}: themeTo '${lv.themeTo}' is not in mazeThemes.js`);
            check(Number.isFinite(lv.blend) && lv.blend >= 0 && lv.blend <= 1, `${tag}: blend must be 0..1, got ${lv.blend}`);
        }

        if (!lv.size || !lv.walls || !lv.holes || !lv.start || !lv.goal) continue;

        const a = analyse(lv, H);

        // --- geometry stays inside its own bounds ----------------------------
        for (const w of lv.walls) {
            check(Math.abs(w.x) + w.w / 2 <= a.hw + 1e-6 && Math.abs(w.z) + w.d / 2 <= a.hd + 1e-6,
                `${tag}: wall at (${w.x},${w.z}) extends outside the level bounds`);
        }
        for (const h of lv.holes) {
            check(Math.abs(h.x) + h.r <= a.hw && Math.abs(h.z) + h.r <= a.hd,
                `${tag}: hole at (${h.x},${h.z}) extends outside the level bounds`);
        }

        // The whole level must sit inside the scene's sun-shadow frustum, or it
        // renders unlit-looking with no shadows and no obvious cause.
        check(Math.max(a.hw, a.hd) <= 10,
            `${tag}: half-extent ${Math.max(a.hw, a.hd)} exceeds 10 world units -- outside the shadow frustum`);

        // --- placement --------------------------------------------------------
        check(a.startFree, `${tag}: the START is inside a wall, over a hole, or outside the bounds -- the run would be unplayable from frame one`);
        check(a.goalFree, `${tag}: the GOAL is inside a wall, over a hole, or outside the bounds`);

        // --- the real check ---------------------------------------------------
        check(a.reachable,
            `${tag}: NO PATH from start to goal for a ball of radius ${a.R}. The level is unsolvable -- some gap is narrower than the ball once walls are inflated, or a corridor is sealed.`);

        // --- ACCESSIBILITY -----------------------------------------------------
        // Reachable is not the same as solvable either. solvable() asks only
        // whether START reaches GOAL, and a hole dropped across a corridor
        // leaves that perfectly intact while deleting everything beyond it:
        // carved maze nobody can visit, with whatever hazards were placed out
        // there now unable to threaten anyone. Six of twelve levels shipped
        // that way, one of them missing nearly a third of its floor with four
        // of its thirteen holes stranded inside.
        const openSpecs = openSpecsOf(lv, H);
        const rf = reachableFloor(lv, openSpecs);
        const orphan = rf.area(rf.free.size - rf.seen.size);
        check(orphan <= ORPHAN_TOL,
            `${tag}: ${orphan.toFixed(2)} square units of carved floor are CUT OFF -- the player can never get there, so that corridor and anything placed in it is not part of the level. Causes, in rough order of likelihood: a region whose only way in is through the GOAL (the run ends on arrival, so nothing past it is ever explorable), a hole sitting across a passage, or a gate that does not clear its own corridor when open.`);

        // Every hazard has to be somewhere the player can actually meet it.
        (Array.isArray(lv.ice) ? lv.ice : []).forEach((r, n) => {
            const live = [...rf.seen].some(k => {
                const [i, j] = k.split('_').map(Number);
                return H.isOnIce([r], rf.px(i), rf.pz(j));
            });
            check(live, `${tag}: ice patch ${n} is UNREACHABLE -- no floor the player can get to lies on it, so it is decoration.`);
        });
        lv.holes.forEach((h, n) => {
            const live = [...rf.seen].some(k => {
                const [i, j] = k.split('_').map(Number);
                return Math.hypot(rf.px(i) - h.x, rf.pz(j) - h.z) <= h.r + a.R + GRID * 2;
            });
            check(live, `${tag}: hole ${n} at (${h.x},${h.z}) is UNREACHABLE -- nothing can ever fall into it.`);
        });

        // A gate has to get out of its own way. Asked as reachability, not
        // doorway by doorway: a bar lying along a corridor can leave the cell
        // faces at either end passable while blocking the middle between them,
        // so every doorway reads open and the ball still cannot get through.
        (Array.isArray(lv.gates) ? lv.gates : []).forEach((g, n) => {
            const without = openSpecs.filter((_, k) => k !== n);
            const bare = reachableFloor(lv, without);
            let cut = 0;
            for (const k of rf.free) if (bare.seen.has(k) && !rf.seen.has(k)) cut++;
            check(rf.area(cut) <= ORPHAN_TOL,
                `${tag}: the gate at (${g.x},${g.z}) still costs the level ${rf.area(cut).toFixed(2)} square units of reachable floor at its OPEN extreme -- it never fully retracts, so that is floor the player can never reach however long they wait. A gate is a doorway that is sometimes there and sometimes not; this one is a wall that happens to slide.`);
        });

        // Solvable is not the same as passable -- see FIT_MARGIN_R.
        check(fitsWithMargin(lv, H),
            `${tag}: the route only just FITS. A ball ${FIT_MARGIN_R * 100}% wider than this level's (${a.R}) cannot get through, so somewhere the player is asked to thread a gap barely wider than their marble -- which a BFS on a ${GRID} grid will happily call solvable and no tilt player will ever manage. Usual cause: a gate whose open position is parked in its own corridor, leaving only a sliver between the bar and a wall or the boundary rail.`);

        // --- HAZARDS ----------------------------------------------------------
        // Each rule here closes a way to author a hazard that is not hard but
        // simply unfair -- the difference being whether the player could have
        // done anything about it.
        for (const gi of a.inertGates) {
            const g = lv.gates[gi];
            check(false,
                `${tag}: the gate at (${g.x},${g.z}) is INERT -- closing it takes no floor away from the ball at all, so it slides back and forth threatening nothing and the level plays as if it were absent. Its travel (${g.travel}) most likely carries it into a wall rather than across a gap; check its sign.`);
        }

        for (const g of (Array.isArray(lv.gates) ? lv.gates : [])) {
            const gtag = `${tag}: gate at (${g.x},${g.z})`;
            check(g.axis === 'x' || g.axis === 'z', `${gtag} needs axis 'x' or 'z', got ${JSON.stringify(g.axis)}`);
            // Travel is SIGNED: it is a displacement from the open position, so
            // a gate that seals a left-hand gap travels negative. Requiring it
            // positive would force authors to describe those by moving the
            // authored point and flipping the meaning of "open", which is the
            // one thing about a gate that must stay unambiguous.
            check(Number.isFinite(g.travel) && g.travel !== 0, `${gtag} needs a non-zero travel`);
            check(Number.isFinite(g.periodMs) && g.periodMs >= 800,
                `${gtag} needs a periodMs of at least 800 -- faster than that is a flicker the player cannot read, let alone time`);
            check(Number.isFinite(g.w) && g.w > 0 && Number.isFinite(g.d) && g.d > 0, `${gtag} needs positive w and d`);

            const swept = H.gateSweptSpec(g);
            check(Math.abs(swept.x) + swept.w / 2 <= a.hw + 1e-6 && Math.abs(swept.z) + swept.d / 2 <= a.hd + 1e-6,
                `${gtag} sweeps outside the level bounds -- part of its travel would be through the boundary rail`);

            // A gate must never sweep over the start, the goal or a hole.
            // Start: the ball would be shoved off its spawn before the player
            // has touched anything. Goal: a clear would depend on the gate's
            // phase, so the same route would sometimes win and sometimes not.
            // Hole: the gate would push the ball in, which is a death with no
            // input the player could have given differently.
            const sweptCovers = (x, z, pad = 0) =>
                Math.abs(x - swept.x) <= swept.w / 2 + pad && Math.abs(z - swept.z) <= swept.d / 2 + pad;
            check(!sweptCovers(lv.start.x, lv.start.z, a.R),
                `${gtag} sweeps over the START -- the ball would be pushed before the run begins`);
            check(!sweptCovers(lv.goal.x, lv.goal.z, lv.goal.r),
                `${gtag} sweeps over the GOAL -- whether a clear counts would depend on the gate's phase`);
            for (const h of lv.holes) {
                check(!sweptCovers(h.x, h.z, h.r),
                    `${gtag} sweeps over the hole at (${h.x},${h.z}) -- it would shove the ball in with no input that could avoid it`);
            }
        }

        for (const r of (Array.isArray(lv.ice) ? lv.ice : [])) {
            const itag = `${tag}: ice at (${r.x},${r.z})`;
            check(Number.isFinite(r.w) && r.w > 0 && Number.isFinite(r.d) && r.d > 0, `${itag} needs positive w and d`);
            check(Math.abs(r.x) + r.w / 2 <= a.hw + 1e-6 && Math.abs(r.z) + r.d / 2 <= a.hd + 1e-6,
                `${itag} extends outside the level bounds`);

            // The start must be on solid ground. Spawning on ice means the run
            // opens with no grip, before the player has any read on which way
            // the board is leaning -- unrecoverable through no fault of theirs.
            check(H.distanceToRect(r, lv.start.x, lv.start.z) > a.R,
                `${itag} covers the START -- a run must not begin with no grip`);

            // A HOLE MAY NOT SIT INSIDE AN ICE PATCH -- but it is very much
            // allowed to sit just past one.
            //
            // This rule was originally a full ball-diameter of run-off between
            // any ice and any hole, on the reasoning that a player who cannot
            // brake has been robbed. That was wrong, and it made ice
            // decorative: combined with placing patches in corridors chosen for
            // having no holes, it produced slippery straights with nothing to
            // hit, which cost the player nothing and taught them nothing.
            //
            // The thing that rule missed is that the player controls their
            // ENTRY SPEED. Ice ending a little short of a hole is a genuine
            // test -- come in slow and you can still steer, come in fast and
            // you are committed -- which is skill, not a coin flip. What is
            // NOT recoverable is being on ice while already over the hole,
            // because then no amount of care helps. So that, and only that, is
            // what this forbids.
            for (const h of lv.holes) {
                check(H.distanceToRect(r, h.x, h.z) > a.R,
                    `${itag} has the hole at (${h.x},${h.z}) inside or under it -- a ball on ice above a hole cannot avoid it however carefully it was driven. Ice may lead TO a hole, but must not cover one.`);
            }
        }
    }

    // (per-level trap, coin and pickup checks run in checkExtras below)
    for (const lv of DATA.levels) {
        if (lv.size && lv.walls && lv.holes && lv.start && lv.goal) checkExtras(lv, H, P);
    }

    // --- LADDER INTEGRITY ----------------------------------------------------
    // The server gates a clear on `index <= highestCleared + 1`, so the index
    // sequence IS the progression rule. A duplicate index would let one clear
    // credit another level; a gap would wall players off from everything past
    // it, permanently, with no error anywhere.
    const indices = DATA.levels.map(l => l.index);
    const sorted = [...indices].sort((a, b) => a - b);
    check(new Set(indices).size === indices.length,
        `level indices must be unique, got ${JSON.stringify(indices)}`);
    check(sorted.every((n, i) => n === i + 1),
        `level indices must run 1..${DATA.levels.length} with no gaps, got ${JSON.stringify(sorted)} -- a gap makes every later level unreachable`);
    check(indices.every((n, i) => i === 0 || n > indices[i - 1]),
        `levels must be listed in ascending index order (the client renders them in file order), got ${JSON.stringify(indices)}`);

    // A world's levels must be contiguous in the ladder, or "world 2" would be
    // interleaved with world 1 and the level-select grouping would misread.
    const worldRanges = {};
    for (const lv of DATA.levels) {
        const w = lv.world;
        check(Number.isFinite(w) && w >= 1, `${lv.id}: needs a world number`);
        if (!worldRanges[w]) worldRanges[w] = [];
        worldRanges[w].push(lv.index);
    }
    for (const [w, idxs] of Object.entries(worldRanges)) {
        const lo = Math.min(...idxs), hi = Math.max(...idxs);
        check(hi - lo + 1 === idxs.length,
            `world ${w}'s levels must be contiguous in the ladder, got indices ${JSON.stringify(idxs)}`);
    }

    // Difficulty has to actually go one way. The ball never gets BIGGER as you
    // climb -- that is the ladder's main difficulty axis, and a level that
    // reverses it would read as a bug to a player rather than as variety.
    for (let i = 1; i < DATA.levels.length; i++) {
        check(DATA.levels[i].ballRadius <= DATA.levels[i - 1].ballRadius,
            `${DATA.levels[i].id}: ball radius ${DATA.levels[i].ballRadius} is LARGER than the previous level's ${DATA.levels[i - 1].ballRadius} -- difficulty must not go backwards`);
    }

    // A world's blend never goes backwards: the forest only grows.
    for (let i = 1; i < DATA.levels.length; i++) {
        const a = DATA.levels[i - 1], b = DATA.levels[i];
        if (a.world === b.world && a.themeTo && b.themeTo) {
            check(b.blend >= a.blend, `${b.id}: blend ${b.blend} is below ${a.id}'s ${a.blend} -- the world must not turn back`);
        }
    }

    // --- WORLDS ----------------------------------------------------------
    // Ten levels a world at most, ids w<world>_<slot>, and a world introduces
    // a new trap kind only on its levels 1, 4 and 10 (docs/PLAN.md). A trap
    // first met on level 6 is a trap nobody taught.
    const INTRO_SLOTS = [1, 4, 10];
    const TRAP_KINDS = { holes: l => l.holes.length, gates: l => (l.gates || []).length,
        ice: l => (l.ice || []).length, conveyors: l => (l.conveyors || []).length };
    for (const w of Object.keys(worldRanges)) {
        const lvls = DATA.levels.filter(l => String(l.world) === w);
        check(lvls.length <= 10, `world ${w} has ${lvls.length} levels; a world is at most 10`);
        const known = new Set();
        lvls.forEach((lv, n) => {
            const slot = n + 1;
            check(lv.id === `w${w}_${String(slot).padStart(2, '0')}`, `${lv.id}: id should be w${w}_${String(slot).padStart(2, '0')} (world ${w}, level ${slot})`);
            for (const [kind, count] of Object.entries(TRAP_KINDS)) {
                if (count(lv) > 0 && !known.has(kind)) {
                    check(INTRO_SLOTS.includes(slot),
                        `${lv.id}: introduces ${kind} on level ${slot} of its world -- new traps arrive only on levels ${INTRO_SLOTS.join(', ')}`);
                    known.add(kind);
                }
            }
        });
        const last = lvls[lvls.length - 1];
        if (lvls.length === 10) check(typeof last.prize === 'string' && last.prize, `world ${w}: its 10th level must carry the world's prize`);
        lvls.slice(0, -1).forEach(l => check(!l.prize, `${l.id}: only a world's last level carries a prize`));
    }

    if (failures.length) {
        console.error('FAIL: maze level validation\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        const gateCount = DATA.levels.reduce((n, l) => n + ((l.gates || []).length), 0);
        const iceCount = DATA.levels.reduce((n, l) => n + ((l.ice || []).length), 0);
        const beltCount = DATA.levels.reduce((n, l) => n + ((l.conveyors || []).length), 0);
        const coinCount = DATA.levels.reduce((n, l) => n + ((l.coins || []).length), 0);
        const pickupCount = DATA.levels.reduce((n, l) => n + ((l.pickups || []).length), 0);
        console.log(`PASS: ${beltCount} conveyor(s) stay off holes, start, goal and gate sweeps; ${coinCount} coin(s) and ${pickupCount} pickup(s) are all reachable and clear of holes; traps arrive only on levels 1/4/10 of their world`);
        console.log(`PASS: all ${DATA.levels.length} maze level(s) are well-formed, in bounds, inside the shadow frustum, BFS-solvable at the real ball radius AND passable by a ball ${FIT_MARGIN_R * 100}% wider, leave no carved floor cut off, put every hole and all ${iceCount} ice patch(es) somewhere reachable, retract all ${gateCount} gate(s) clear of the floor when open, and form a gap-free ladder with non-increasing ball size`);
    }
}

run().catch(e => { console.error(e); process.exitCode = 1; });
