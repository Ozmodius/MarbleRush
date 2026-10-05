#!/usr/bin/env node
// OFFLINE generator for the maze levels in mazeLevels.json (dev-only tool; NOT
// an app runtime file and NOT synced to production, same as
// generateCosmeticRarities.js and trainBots.js). The JSON it emits DOES ship.
//
// WHY THIS EXISTS. The first twelve levels were hand-authored variations on one
// five-wall serpentine: a single corridor that zig-zags up the board with the
// holes shuffled between drafts. That is a slalom, not a maze. There are no
// junctions, so there are no decisions; no dead ends, so a wrong turn costs
// nothing; and because every level shared the skeleton, twelve levels played as
// one level four times over.
//
// A real maze needs branching, and branching by hand does not scale past a few
// levels -- which is exactly when it stops being possible to keep them all
// solvable by eye. So the layouts are GENERATED (seeded, therefore
// reproducible) and then verified by test_maze_levels.js, which remains the
// authority on whether a level ships.
//
// DENSITY IS THE DIFFICULTY AXIS, and it is what the shrinking marble is for.
// A smaller ball fits a tighter corridor, so each world can carve the same
// 9x14 board into a finer grid: 4x6 cells in world 1, 7x10 by world 4. The
// marble does not shrink for its own sake -- it shrinks to buy maze.
//
// Run:    node scripts/generateMazeLevels.js
// Writes: ../mazeLevels.json  (levels array only; the _readme and payouts
//         blocks in that file are preserved verbatim)

const fs = require('fs');
// Wind and icicle timing rules live in the GAME's module; the generator reads
// them rather than keeping a copy (loaded in main()).
let H = null;
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'mazeLevels.json');
const BOARD_W = 9.0, BOARD_D = 14.0;

// HOW MUCH SLACK THE FORCED ROUTE MUST HAVE, in ball radii, per side.
//
// `solvable()` below asks whether a ball CENTRE can get from start to goal. A
// slot a hundredth of a unit wider than the marble satisfies that, and no
// player threads a slot like that under tilt control -- so "solvable" and
// "passable" are not the same claim, and only the first was ever being
// checked.
//
// That is not hypothetical. A gate retracts along its own axis into the cell
// next door, and in a carved maze that cell is frequently open corridor; when
// it is the SAME corridor the gate stands in, the bar never leaves the
// cross-section at all. Two shipped levels were built that way. Glass Floor's
// bar sat in its corridor at the OPEN extreme with a 0.04-wide slot beside it
// for a 0.56 marble -- present from the first frame, and closing the gate took
// away nothing further, so waiting never helped either.
//
// So a level must survive the same search run with a FATTER BALL. Expressed in
// radii rather than world units because the marble shrinks by world and a
// gap's difficulty is relative to what has to fit through it. 0.5 means the
// forced route admits a ball half again as wide as the real one.
//
// Holes are deliberately NOT obstacles in this test -- see fits().
const FIT_MARGIN_R = 0.5;

// The grid every reachability search here runs on: THE VERIFIER'S. These
// searches are filters and the verifier is the authority, so a coarser grid
// here only means accepting placements the verifier then rejects -- which is
// what happened: at 0.06 a sample point landed in the sliver exactly between a
// goal disc and the boundary rail, the generator thought the floor past the
// exit was reachable, and the 0.05 verifier (rightly) said it was not.
const SEARCH_GRID = 0.05;

// Deterministic RNG. Levels must regenerate identically -- a level file that
// reshuffled itself on every run would make every diff unreadable and would
// silently invalidate the minMs/goldMs tuned against the previous layout.
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Maze carving
// ---------------------------------------------------------------------------

// Randomised depth-first carve. Produces a PERFECT maze -- every cell reachable,
// exactly one route between any two -- which is what gives dead ends their
// meaning: a wrong turn is a real cost, not a detour.
//
// Iterative rather than recursive: world 4 is 70 cells now but the grid is the
// difficulty knob and a deeper one should not risk a stack.
function carve(cols, rows, rand) {
    // open[j][i] = { N, S, E, W } true where a passage exists
    const open = [];
    for (let j = 0; j < rows; j++) {
        open.push([]);
        for (let i = 0; i < cols; i++) open[j].push({ N: false, S: false, E: false, W: false });
    }
    const seen = new Set();
    const key = (i, j) => i + ',' + j;
    const stack = [[0, 0]];
    seen.add(key(0, 0));

    const DIRS = [
        { d: 'N', di: 0, dj: -1, opp: 'S' },
        { d: 'S', di: 0, dj: 1, opp: 'N' },
        { d: 'E', di: 1, dj: 0, opp: 'W' },
        { d: 'W', di: -1, dj: 0, opp: 'E' }
    ];

    while (stack.length) {
        const [i, j] = stack[stack.length - 1];
        const options = DIRS.filter(({ di, dj }) => {
            const a = i + di, b = j + dj;
            return a >= 0 && b >= 0 && a < cols && b < rows && !seen.has(key(a, b));
        });
        if (!options.length) { stack.pop(); continue; }
        const pick = options[Math.floor(rand() * options.length)];
        const a = i + pick.di, b = j + pick.dj;
        open[j][i][pick.d] = true;
        open[b][a][pick.opp] = true;
        seen.add(key(a, b));
        stack.push([a, b]);
    }
    return open;
}

// Remove a fraction of dead ends by punching one extra wall, turning the tree
// into a graph with loops.
//
// A PERFECT maze has exactly one route, so a player who takes a wrong branch has
// no option but to retrace -- which in a tilt game means slowly steering all the
// way back, and reads as tedium rather than difficulty. A few loops mean a wrong
// choice usually costs time instead of the whole journey back, and they give the
// route-finding something to be clever about.
function braid(open, cols, rows, rand, fraction) {
    const DIRS = [
        { d: 'N', di: 0, dj: -1, opp: 'S' },
        { d: 'S', di: 0, dj: 1, opp: 'N' },
        { d: 'E', di: 1, dj: 0, opp: 'W' },
        { d: 'W', di: -1, dj: 0, opp: 'E' }
    ];
    const deadEnds = [];
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const n = DIRS.filter(x => open[j][i][x.d]).length;
            if (n === 1) deadEnds.push([i, j]);
        }
    }
    for (const [i, j] of deadEnds) {
        if (rand() > fraction) continue;
        const closed = DIRS.filter(({ d, di, dj }) => {
            const a = i + di, b = j + dj;
            return !open[j][i][d] && a >= 0 && b >= 0 && a < cols && b < rows;
        });
        if (!closed.length) continue;
        const pick = closed[Math.floor(rand() * closed.length)];
        open[j][i][pick.d] = true;
        open[j + pick.dj][i + pick.di][pick.opp] = true;
    }
}

// ---------------------------------------------------------------------------
// Cell graph helpers (used for HAZARD PLACEMENT, not for the shipping
// solvability guarantee -- that stays with test_maze_levels.js, which solves
// the real geometry at the real ball radius rather than this idealised grid.)
// ---------------------------------------------------------------------------

function neighbours(open, cols, rows, i, j) {
    const out = [];
    if (open[j][i].N && j > 0) out.push([i, j - 1]);
    if (open[j][i].S && j < rows - 1) out.push([i, j + 1]);
    if (open[j][i].W && i > 0) out.push([i - 1, j]);
    if (open[j][i].E && i < cols - 1) out.push([i + 1, j]);
    return out;
}

function shortestPath(open, cols, rows, from, to) {
    const key = (i, j) => i + ',' + j;
    const prev = new Map([[key(...from), null]]);
    let q = [from];
    while (q.length) {
        const nq = [];
        for (const [i, j] of q) {
            if (i === to[0] && j === to[1]) {
                const path = [];
                let cur = key(i, j);
                while (cur) { const [a, b] = cur.split(',').map(Number); path.unshift([a, b]); cur = prev.get(cur); }
                return path;
            }
            for (const [a, b] of neighbours(open, cols, rows, i, j)) {
                if (prev.has(key(a, b))) continue;
                prev.set(key(a, b), key(i, j));
                nq.push([a, b]);
            }
        }
        q = nq;
    }
    return [];
}

module.exports = { mulberry32, carve, braid, neighbours, shortestPath, OUT_PATH, BOARD_W, BOARD_D };

// ---------------------------------------------------------------------------
// Grid -> world geometry
// ---------------------------------------------------------------------------

function geometry(cfg) {
    const px = BOARD_W / cfg.cols, pz = BOARD_D / cfg.rows;
    return {
        px, pz, t: cfg.wall,
        cx: i => -BOARD_W / 2 + (i + 0.5) * px,
        cz: j => -BOARD_D / 2 + (j + 0.5) * pz
    };
}

// Interior walls only -- the renderer builds the outer boundary from `size`, so
// no level can be left open at an edge. One rect per closed cell face, emitted
// once (east/south faces only) so a shared wall is not written twice.
function wallsFor(open, cfg, g) {
    const out = [];
    for (let j = 0; j < cfg.rows; j++) {
        for (let i = 0; i < cfg.cols; i++) {
            if (i < cfg.cols - 1 && !open[j][i].E) {
                out.push(clip({ x: g.cx(i) + g.px / 2, z: g.cz(j), w: g.t, d: g.pz + g.t }));
            }
            if (j < cfg.rows - 1 && !open[j][i].S) {
                out.push(clip({ x: g.cx(i), z: g.cz(j) + g.pz / 2, w: g.px + g.t, d: g.t }));
            }
        }
    }
    return out;
}

// Wall segments are grown by one thickness so corners MEET -- without it every
// junction has a square notch the ball can catch in. That overhang runs past the
// board at the outer rows and columns, so each rect is clipped back to the
// board. The renderer builds the boundary rails from `size` and would otherwise
// have interior walls poking through them.
function clip(rect) {
    const hw = BOARD_W / 2, hd = BOARD_D / 2;
    // Round the EDGES inward, then derive centre and size from them. Rounding
    // centre and size independently lets 2dp rounding push a clipped wall back
    // outside by half a hundredth -- which is invisible, harmless in play, and
    // fails the bounds check on the very walls clipping was meant to fix.
    const inward = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
    const x0 = inward(Math.max(-hw, rect.x - rect.w / 2), -hw, hw);
    const x1 = inward(Math.min(hw, rect.x + rect.w / 2), -hw, hw);
    const z0 = inward(Math.max(-hd, rect.z - rect.d / 2), -hd, hd);
    const z1 = inward(Math.min(hd, rect.z + rect.d / 2), -hd, hd);
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: r2(x1 - x0), d: r2(z1 - z0) };
}

// A geometric solvability check on the real layout at the real ball radius.
//
// This DUPLICATES what test_maze_levels.js does, and that is deliberate and
// bounded: here it is a FILTER, used to throw away a generated placement and
// try another. The shipping guarantee stays entirely with the test -- if these
// two ever disagree, the test is right and the generator has a bug.
function solvable(lv) {
    const R = lv.ballRadius, GRID = SEARCH_GRID;
    const hw = lv.size.w / 2, hd = lv.size.d / 2;
    const solids = lv.walls.concat((lv.gates || []).map(g => ({ x: g.x, z: g.z, w: g.w, d: g.d })));
    const posts = H.postSpecs(lv);
    const blocked = (x, z) =>
        Math.abs(x) > hw - R || Math.abs(z) > hd - R
        || solids.some(w => Math.abs(x - w.x) <= w.w / 2 + R && Math.abs(z - w.z) <= w.d / 2 + R)
        || H.inPost(posts, x, z, R)
        || (lv.holes || []).some(h => Math.hypot(x - h.x, z - h.z) <= h.r);

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

const r2 = v => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// HAZARD PLACEMENT
// ---------------------------------------------------------------------------

// A hole must never SEAL a corridor -- the ball has to be able to thread past
// it, or the maze has a wall pretending to be a hazard. Sized from the corridor
// the ball actually has, then pushed off-centre so there is a definite line
// rather than two equal slivers.
// THE PASSING SIDE MUST BE A REAL LANE. A hole sits off to one side of its
// corridor, and the side the ball passes on has to admit the ball with
// HOLE_PASS_MARGIN to spare. The first version sized the hole as if it sat
// centred and then pushed it off-centre anyway, which left a lane only a
// hundredth wider than the ball: the generator's old 0.06 grid found it, the
// verifier's finer 0.05 grid did not, and the level shipped with floor cut off
// behind a hole (world 1 got lucky; world 2's corridors did not).
const HOLE_PASS_MARGIN = 0.18;
const HOLE_WALL_GAP = 0.02;
function holeRadiusFor(cfg, g) {
    const free = Math.min(g.px, g.pz) - g.t;      // corridor width
    return Math.max(0.16, r2((free - HOLE_WALL_GAP - 2 * cfg.ball - HOLE_PASS_MARGIN) / 2));
}
// How far off the corridor's centre a hole of radius r sits: against one
// wall, leaving the other side as the lane.
function holeOffsetFor(cfg, g, r) {
    const free = Math.min(g.px, g.pz) - g.t;
    return Math.max(0, free / 2 - HOLE_WALL_GAP - r);
}

// Holes go where a WRONG DECISION is punished: on the branches leading off the
// solution path, and in dead ends. A hole in the middle of the one corridor
// everyone must take is just a toll; a hole down the tempting-looking fork is
// the maze asking whether you were sure.
function placeHoles(open, cfg, g, path, rand, count, gates = [], ice = []) {
    const onPath = new Set(path.map(([i, j]) => i + ',' + j));
    const start = path[0], goal = path[path.length - 1];
    const banned = new Set([start[0] + ',' + start[1], goal[0] + ',' + goal[1]]);
    // Never immediately beside the start or the goal either: a hole a ball can
    // roll into before the player has read the board is not a decision.
    for (const [i, j] of [...neighbours(open, cfg.cols, cfg.rows, ...start),
                          ...neighbours(open, cfg.cols, cfg.rows, ...goal)]) banned.add(i + ',' + j);

    const offPath = [];
    for (let j = 0; j < cfg.rows; j++) {
        for (let i = 0; i < cfg.cols; i++) {
            const k = i + ',' + j;
            if (banned.has(k) || onPath.has(k)) continue;
            offPath.push([i, j]);
        }
    }
    // Some on-path holes too, or the solution route is a free ride.
    const pathMid = path.slice(2, -2).filter(([i, j]) => !banned.has(i + ',' + j));

    shuffle(offPath, rand);
    shuffle(pathMid, rand);
    // Interleave off-path and on-path candidates rather than concatenating, so
    // that a prefix of the result still holds both kinds. The caller takes
    // holes in order and stops at its quota, so anything appended late is
    // effectively never used.
    const pool = [];
    const wantOff = Math.ceil(count * 0.6);
    for (let n = 0; n < Math.max(offPath.length, pathMid.length); n++) {
        if (n < wantOff && n < offPath.length) pool.push(offPath[n]);
        if (n < pathMid.length) pool.push(pathMid[n]);
    }
    // DISPERSE. Uniform-random selection over cells clumps -- that is what
    // random does, and it left clusters of holes in one corner with whole
    // quadrants empty. This is a greedy minimum-separation pass (Poisson-disk
    // by rejection): walk the shuffled pool and accept a cell only if it is far
    // enough from everything already accepted.
    //
    // The separation relaxes if the quota cannot be met, but only down to a HARD
    // FLOOR -- it does not chase the quota all the way down. Letting it do so
    // was the first attempt and it defeated the point: on world 4's grid the
    // requested count could only be met by dropping to two-thirds of a cell,
    // which put holes in adjacent cells and reproduced exactly the clumping
    // this pass exists to remove. Spacing wins; the count is what gives.
    const chosen = [];
    const cellSize = Math.min(g.px, g.pz);
    for (let sep = cellSize * 1.9; chosen.length < count && sep >= cellSize * 1.15; sep *= 0.9) {
        for (const cand of pool) {
            if (chosen.length >= count) break;
            if (chosen.some(c => c[0] === cand[0] && c[1] === cand[1])) continue;
            const far = chosen.every(c =>
                Math.hypot(g.cx(c[0]) - g.cx(cand[0]), g.cz(c[1]) - g.cz(cand[1])) >= sep);
            if (far) chosen.push(cand);
        }
    }

    const r = holeRadiusFor(cfg, g);
    // Anything a gate can reach is off limits, padded by the hole's own radius
    // and the ball's, matching the rule test_maze_levels.js enforces.
    const sweeps = gates.map(gt => {
        const a = gt.x, b = gt.x + (gt.axis === 'x' ? gt.travel : 0);
        const c = gt.z, e = gt.z + (gt.axis === 'z' ? gt.travel : 0);
        return {
            x: (Math.min(a, b) + Math.max(a, b)) / 2, z: (Math.min(c, e) + Math.max(c, e)) / 2,
            w: Math.abs(b - a) + gt.w, d: Math.abs(e - c) + gt.d
        };
    });
    const clearOfGates = (x, z) => sweeps.every(s2 =>
        Math.abs(x - s2.x) > s2.w / 2 + r + cfg.ball || Math.abs(z - s2.z) > s2.d / 2 + r + cfg.ball);
    // Clear of ice by more than the ball radius, matching the verifier's rule:
    // ice may lead TO a hole, but must never cover one.
    const clearOfIce = (x, z) => ice.every(ir => {
        const dx = Math.max(Math.abs(x - ir.x) - ir.w / 2, 0);
        const dz = Math.max(Math.abs(z - ir.z) - ir.d / 2, 0);
        return Math.hypot(dx, dz) > cfg.ball * 1.35;
    });
    // Offset within the cell so the ball has a side to pass on, alternating so a
    // player cannot learn one lane and hold it.
    return chosen.map(([i, j], n) => {
        const off = (n % 2 === 0 ? 1 : -1) * holeOffsetFor(cfg, g, r);
        return { x: r2(g.cx(i) + off), z: r2(g.cz(j)), r: r };
    }).filter(h => clearOfGates(h.x, h.z) && clearOfIce(h.x, h.z));
}

// Is the level passable with ROOM TO SPARE -- the same search as solvable(),
// run with the ball grown by FIT_MARGIN_R (see its note). Reusing the solver
// with one number changed is the whole point: a separate clearance metric
// would be a second model of the level's geometry, free to disagree with the
// one that decides solvability.
//
// Two deliberate differences from solvable():
//
//   - GATES AT THEIR OPEN EXTREME (the authored {x,z}, exactly as solvable()
//     reads them). Open is the most permissive state a gate ever reaches, so a
//     bar that fails here fails at every phase and the passage beside it is
//     never available, however long the player waits.
//
//   - HOLES ARE IGNORED. This asks whether the ball FITS, and a hole is not a
//     gap to fit through -- it is a hazard to steer around, and steering around
//     one at speed is the mode's whole skill expression. The shipped levels
//     routinely leave under a third of a radius between the route and a hole
//     rim on purpose; folding that into this check would condemn the good
//     levels along with the bad. Reachability past holes stays solvable()'s
//     job.
function fits(lv) {
    const R = lv.ballRadius * (1 + FIT_MARGIN_R), GRID = SEARCH_GRID;
    const hw = lv.size.w / 2, hd = lv.size.d / 2;
    const solids = lv.walls.concat((lv.gates || []).map(g => ({ x: g.x, z: g.z, w: g.w, d: g.d })));
    const posts = H.postSpecs(lv);
    const blocked = (x, z) =>
        Math.abs(x) > hw - R || Math.abs(z) > hd - R
        || solids.some(w => Math.abs(x - w.x) <= w.w / 2 + R && Math.abs(z - w.z) <= w.d / 2 + R)
        || H.inPost(posts, x, z, R);

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

// WHICH of the carve's own doorways does this bar SHUT, end to end? Returns
// their keys, so callers can both count them and tell two bars apart that shut
// the same opening from different sides.
//
// Used for the CLOSED side of a gate: a door has to shut a way through, and
// that is a statement about a cell face, not about area. It lives in the
// generator rather than the verifier because it needs the CARVE -- which faces
// were cut -- and the verifier deliberately knows nothing about the cell grid,
// only walls. Same split the rest of the hazard placement runs on.
//
// A doorway is passable if some point along the shared face admits a ball
// centre, clear of the walls flanking it as well as of the bar. Testing the bar
// alone gets the answer backwards: the ends of a face run into the wall stubs
// either side, so a point the bar misses can still be one no ball could occupy.
// Faces already pinched shut WITHOUT the bar are not counted -- wall segments
// are grown a thickness so their corners meet, and that overhang can close a cut
// face on its own, which is not this gate's doing.
function facesShutBy(bar, open, cfg, g, ball, walls) {
    const clearOf = (rect, x, z) =>
        Math.abs(x - rect.x) > rect.w / 2 + ball || Math.abs(z - rect.z) > rect.d / 2 + ball;
    // A doorway is passable if SOME point along the shared face admits a ball
    // centre -- clear of the walls flanking it as well as of the bar. Testing
    // the bar alone is not enough and gets the answer backwards: the ends of a
    // face run into the wall stubs on either side, so a point the bar misses
    // can still be one no ball could occupy, and the doorway reads as open
    // when it is shut.
    const SAMPLES = 24;
    const usable = (withBar, x, z) =>
        walls.every(w => clearOf(w, x, z)) && (!withBar || clearOf(bar, x, z));
    // Compared against the doorway WITHOUT the bar rather than against the
    // carve: the wall segments are grown a thickness so their corners meet, and
    // that overhang can already pinch a cut face down to nothing. Such a face is
    // not this gate's doing and must not condemn it.
    const faceOpen = (withBar, horizontal, i, j) => {
        for (let k = 0; k <= SAMPLES; k++) {
            const t = k / SAMPLES;
            const x = horizontal ? g.cx(i) + g.px / 2 : g.cx(i) - g.px / 2 + g.px * t;
            const z = horizontal ? g.cz(j) - g.pz / 2 + g.pz * t : g.cz(j) + g.pz / 2;
            if (usable(withBar, x, z)) return true;
        }
        return false;
    };
    const shut = [];
    for (let j = 0; j < cfg.rows; j++) {
        for (let i = 0; i < cfg.cols; i++) {
            for (const [cut, horizontal] of [[open[j][i].E && i < cfg.cols - 1, true],
                                             [open[j][i].S && j < cfg.rows - 1, false]]) {
                if (!cut) continue;
                if (!faceOpen(false, horizontal, i, j)) continue;   // already pinched shut; not ours
                if (!faceOpen(true, horizontal, i, j)) shut.push(`${i},${j}${horizontal ? 'E' : 'S'}`);
            }
        }
    }
    return shut;
}

// The floor a player can actually roll to, as a Set of grid keys, plus how much
// FREE floor there is in total. Walls and the gates named in `gateSpecs` are
// solid; holes are fatal, so floor inside one is not floor you can stand on but
// also not something you can cross.
//
// Shared by the two rules below because they are the same question asked twice:
// a gate is only a doorway if closing it takes reachable floor away, and a hole
// is only fair if it does not take any away permanently.
function reachable(lv, gateSpecs) {
    const R = lv.ballRadius, GRID = SEARCH_GRID;
    const hw = lv.size.w / 2, hd = lv.size.d / 2;
    const solids = lv.walls.concat(gateSpecs);
    const posts = H.postSpecs(lv);
    const solid = (x, z) => Math.abs(x) > hw - R || Math.abs(z) > hd - R
        || solids.some(w => Math.abs(x - w.x) <= w.w / 2 + R && Math.abs(z - w.z) <= w.d / 2 + R)
        || H.inPost(posts, x, z, R);
    const holed = (x, z) => (lv.holes || []).some(h => Math.hypot(x - h.x, z - h.z) <= h.r);
    // THE EXIT ABSORBS. checkOutcomes() wins the run the moment the ball centre
    // enters the goal disc, so the ball can never come out the far side of it:
    // floor whose only way in leads through the goal is floor no player will
    // ever stand on, and a false route that only opens past the exit is one
    // nobody can be tempted down. Treating the goal as ordinary floor counts
    // both as reachable and misses it entirely -- two levels had over half
    // their maze back there, Cold Open with seven of its thirteen holes.
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
    return { seen, free, cellArea: GRID * GRID };
}

// How much carved floor the player can never get to. A hole does not only
// threaten the cell it sits in -- drop one across a corridor and everything
// beyond it is gone from the level: corridor nobody visits, and any hole or ice
// out there can never be met, which makes it scenery rather than a hazard.
//
// solvable() cannot see this. It asks only whether START still reaches GOAL, and
// a branch sealed off the route leaves that perfectly intact -- which is how six
// of the twelve shipped levels came to have orphaned floor, one of them nearly a
// third of its maze with four of its thirteen holes stranded inside.
function orphanArea(lv, gateSpecs) {
    const { seen, free, cellArea } = reachable(lv, gateSpecs);
    return (free.size - seen.size) * cellArea;
}

// A sliver of centre-space pinched off behind a hole against a wall is not a
// "path nobody can reach", it is rounding. One ball's own footprint is the
// smallest thing worth calling a place.
const ORPHAN_TOL = 0.35;

// THE TWO HALVES OF BEING A DOORWAY. A sliding gate is a way through that is
// sometimes there and sometimes not, so it owes the player both halves:
//
//   opensClear   -- open, it costs the level nothing at all
//   sealsDoorway -- closed, it shuts a way through
//
// A bar that fails the first is a wall that happens to slide. One that fails the
// second is an obstacle in a corridor wide enough to pass either side of, which
// the player simply walks around.

// Open, the bar must get COMPLETELY out of the way.
//
// Asked as REACHABILITY, not doorway-by-doorway, and the difference is the whole
// bug: a bar lying along a corridor can leave the cell faces at either end
// technically passable while blocking the middle between them. Every face reads
// open; the ball still cannot get through. Gates parked that way orphaned up to
// 19 square units of carved corridor on one level -- a third of its maze -- with
// the holes out there stranded where nothing could ever fall into them.
function opensClear(lv, gateIdx) {
    const specs = (lv.gates || []).map(g => ({ x: g.x, z: g.z, w: g.w, d: g.d }));
    const without = specs.filter((_, k) => k !== gateIdx);
    const a = reachable(lv, without), b = reachable(lv, specs);
    let cut = 0;
    for (const k of b.free) if (a.seen.has(k) && !b.seen.has(k)) cut++;
    return cut * b.cellArea <= ORPHAN_TOL;
}

// Closed, the bar must shut a way through -- span one of the carve's doorways
// end to end, leaving no edge to slip past.
//
// Deliberately NOT "does closing cut floor off": these mazes are BRAIDED, so a
// door on a loop leaves everything behind it reachable the long way round and
// cuts nothing off at all. It is still a door, and forcing the detour is the
// hazard doing its job.
function sealsDoorway(gate, open, cfg, g, ball, walls) {
    return facesShutBy(closedSpecOf(gate), open, cfg, g, ball, walls);
}

function closedSpecOf(g) {
    return {
        x: g.x + (g.axis === 'x' ? g.travel : 0),
        z: g.z + (g.axis === 'z' ? g.travel : 0),
        w: g.w, d: g.d
    };
}

function sweepInBounds(gt) {
    const hw = BOARD_W / 2, hd = BOARD_D / 2;
    const x0 = Math.min(gt.x, gt.x + (gt.axis === 'x' ? gt.travel : 0)) - gt.w / 2;
    const x1 = Math.max(gt.x, gt.x + (gt.axis === 'x' ? gt.travel : 0)) + gt.w / 2;
    const z0 = Math.min(gt.z, gt.z + (gt.axis === 'z' ? gt.travel : 0)) - gt.d / 2;
    const z1 = Math.max(gt.z, gt.z + (gt.axis === 'z' ? gt.travel : 0)) + gt.d / 2;
    return x0 >= -hw && x1 <= hw && z0 >= -hd && z1 <= hd;
}

function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// ICE GOES WHERE BRAKING MATTERS, which is the whole point and is what the
// first attempt got wrong. That version laid full-width ice across corridors
// chosen precisely because they held no holes -- a slippery straight with
// nothing to hit, so it cost the player nothing and taught them nothing.
//
// Ice is only a hazard where the ball has to CHANGE DIRECTION or STOP. So a
// patch is laid on a straight run of cells that ends in a turn or a junction:
// the ball builds speed with no grip, and arrives at the decision carrying it.
// Overshoot the turn and you are in the wall, or down the wrong branch, or in
// whatever the maze put past it.
function placeIce(open, cfg, g, path, rand, count) {
    const runs = [];
    // Walk the solution path looking for two-or-more cells in a straight line
    // that end in a DECISION -- the approaches worth glazing.
    //
    // A turn is one kind of decision; a JUNCTION is the other, and it was named
    // in this comment long before it was detected. A straight run delivering
    // into a cell with a branch off it is exactly the case ice is for: speed
    // built with no grip, arriving somewhere the player has to choose. Only
    // turns were being found, which on a lightly-braided route is the smaller
    // half -- three levels went short of their ice quota for want of the other.
    for (let n = 1; n < path.length - 1; n++) {
        const [pi, pj] = path[n - 1], [i, j] = path[n], [ni, nj] = path[n + 1];
        const inDir = (i - pi) + ',' + (j - pj);
        const outDir = (ni - i) + ',' + (nj - j);
        const turns = inDir !== outDir;
        const junction = neighbours(open, cfg.cols, cfg.rows, i, j).length >= 3;
        if (!turns && !junction) continue;        // still just corridor -- keep going
        // n is a decision. Walk BACK to find the straight leading into it.
        let len = 0, k = n - 1;
        while (k > 0) {
            const a = path[k - 1], b = path[k], c = path[k + 1];
            if (((b[0] - a[0]) + ',' + (b[1] - a[1])) !== ((c[0] - b[0]) + ',' + (c[1] - b[1]))) break;
            len++; k--;
        }
        if (len >= 1) runs.push({ from: k, to: n, len });
    }
    // Two decisions can share a run-up; glazing it twice writes overlapping
    // patches on the same floor. Keep the nearer decision, which is the one the
    // player actually arrives at carrying the speed.
    const claimed = new Set();
    for (let n = runs.length - 1; n >= 0; n--) {
        if (claimed.has(runs[n].from)) runs.splice(n, 1);
        else claimed.add(runs[n].from);
    }
    shuffle(runs, rand);

    const out = [];
    for (const run of runs) {
        // Take until the quota is met rather than slicing to it up front: the
        // rejections below (an empty run, one covering the spawn) used to eat
        // into the slice instead of being skipped over, so a level quietly
        // shipped short of its ice however many good runs were left behind it.
        if (out.length >= count) break;
        // Cover the run-up but NOT the turn cell itself. Leaving the corner on
        // ordinary floor is what keeps this a test of entry speed rather than a
        // coin flip: the player who came in slow can still make the corner.
        const cells = [];
        for (let n = run.from; n < run.to; n++) cells.push(path[n]);
        if (!cells.length) continue;
        // Never the spawn cell: a run must not open with no grip, before the
        // player has any read on which way the board is leaning.
        if (cells.some(([i, j]) => i === path[0][0] && j === path[0][1])) continue;
        const xs = cells.map(([i]) => g.cx(i)), zs = cells.map(([, j]) => g.cz(j));
        const pad = (Math.min(g.px, g.pz) - g.t) / 2;
        out.push({
            x: r2((Math.min(...xs) + Math.max(...xs)) / 2),
            z: r2((Math.min(...zs) + Math.max(...zs)) / 2),
            w: r2(Math.max(...xs) - Math.min(...xs) + pad * 2),
            d: r2(Math.max(...zs) - Math.min(...zs) + pad * 2)
        });
    }
    return out;
}

// CONVEYORS GO ON STRAIGHTS THE ROUTE RUNS ALONG -- the same run-ups ice
// uses, for a related reason: a belt only matters where the ball has to travel
// with it or against it. Laid along the corridor's axis, never across it, and
// the direction alternates: a belt that helps tempts the player to carry speed
// into the next decision, a belt that opposes makes them commit tilt to climb
// it. Either is skill; neither can close the corridor, because a belt is held
// weaker than full tilt (mazeHazards.js CONVEYOR_MAX_ACCEL).
function placeConveyors(open, cfg, g, path, rand, count) {
    const runs = [];
    let n = 1;
    while (n < path.length - 2) {
        const dir = (path[n + 1][0] - path[n][0]) + ',' + (path[n + 1][1] - path[n][1]);
        let m = n + 1;
        while (m < path.length - 2
            && ((path[m + 1][0] - path[m][0]) + ',' + (path[m + 1][1] - path[m][1])) === dir) m++;
        // Cells n..m are in a straight line; m is where it turns, and the turn
        // cell stays plain floor, like ice's corner -- otherwise the next
        // run's belt starts in the same cell and two belts overlap pulling
        // different ways. So n..m-1, two cells at least. Never the start or
        // goal cell either (never spawn on a belt; never let one decide the win).
        if (m - n >= 2) runs.push({ from: n, to: m - 1, dir });
        n = m;
    }
    shuffle(runs, rand);
    const out = [];
    for (const run of runs) {
        if (out.length >= count) break;
        const cells = path.slice(run.from, run.to + 1);
        const xs = cells.map(([i]) => g.cx(i)), zs = cells.map(([, j]) => g.cz(j));
        const corridor = Math.min(g.px, g.pz) - g.t;
        const alongX = run.dir.split(',')[0] !== '0';
        const sign = Number(alongX ? run.dir.split(',')[0] : run.dir.split(',')[1]);
        const forward = out.length % 2 === 0;
        out.push({
            x: r2((Math.min(...xs) + Math.max(...xs)) / 2),
            z: r2((Math.min(...zs) + Math.max(...zs)) / 2),
            // Centre to centre of the end cells, plus a quarter cell each end,
            // so a two-cell belt is a cell and a half long and stops well clear
            // of the turn.
            w: r2(alongX ? Math.max(...xs) - Math.min(...xs) + g.px * 0.5 : corridor * 0.8),
            d: r2(alongX ? corridor * 0.8 : Math.max(...zs) - Math.min(...zs) + g.pz * 0.5),
            dir: (forward ? (sign > 0 ? '+' : '-') : (sign > 0 ? '-' : '+')) + (alongX ? 'x' : 'z'),
            speed: 2.2
        });
    }
    return out;
}

// COINS: some on the route (a trail that reads as "this way"), more in dead
// ends and off-route branches, which is the point -- a coin is the reason to
// take the branch the maze is daring you down. PICKUPS go in dead ends first:
// a power-up should cost a detour. Every one sits at a cell centre where the
// ball can actually stand, clear of holes and gate sweeps; the verifier checks
// the same rules.
function placeCollectibles(open, cfg, g, path, rand, lv, coinCount, pickupKinds) {
    const onPath = new Set(path.map(([i, j]) => i + ',' + j));
    const start = path[0], goal = path[path.length - 1];
    const deadEnds = [], offPath = [], route = [];
    for (let j = 0; j < cfg.rows; j++) {
        for (let i = 0; i < cfg.cols; i++) {
            if ((i === start[0] && j === start[1]) || (i === goal[0] && j === goal[1])) continue;
            const k = i + ',' + j;
            if (onPath.has(k)) route.push([i, j]);
            else if (neighbours(open, cfg.cols, cfg.rows, i, j).length === 1) deadEnds.push([i, j]);
            else offPath.push([i, j]);
        }
    }
    shuffle(deadEnds, rand); shuffle(offPath, rand); shuffle(route, rand);
    const R = lv.ballRadius;
    const { seen } = reachable(lv, (lv.gates || []).map(gt => ({ x: gt.x, z: gt.z, w: gt.w, d: gt.d })));
    const standable = (x, z) => seen.has(Math.round((x + lv.size.w / 2) / SEARCH_GRID) + '_' + Math.round((z + lv.size.d / 2) / SEARCH_GRID));
    const sweeps = (lv.gates || []).map(gt => {
        const a = gt.x, b = gt.x + (gt.axis === 'x' ? gt.travel : 0);
        const c = gt.z, e = gt.z + (gt.axis === 'z' ? gt.travel : 0);
        return { x: (a + b) / 2, z: (c + e) / 2, w: Math.abs(b - a) + gt.w, d: Math.abs(e - c) + gt.d };
    });
    const ok = (x, z) => standable(x, z)
        && (lv.holes || []).every(h => Math.hypot(x - h.x, z - h.z) >= h.r + R + 0.15)
        && (lv.bumpers || []).every(b => Math.hypot(x - b.x, z - b.z) >= b.r + R + 0.15)
        && (lv.springs || []).every(p => Math.max(Math.abs(x - p.x) - p.w / 2, Math.abs(z - p.z) - p.d / 2) >= R)
        && sweeps.every(sw => Math.abs(x - sw.x) > sw.w / 2 + R || Math.abs(z - sw.z) > sw.d / 2 + R);
    const used = new Set();
    const take = (pool) => {
        for (const [i, j] of pool) {
            const k = i + ',' + j;
            if (used.has(k)) continue;
            const x = r2(g.cx(i)), z = r2(g.cz(j));
            if (!ok(x, z)) continue;
            used.add(k);
            return { x, z };
        }
        return null;
    };
    const pickups = [];
    for (const kind of pickupKinds) {
        const at = take(deadEnds) || take(offPath);
        if (at) pickups.push({ ...at, kind });
    }
    const coins = [];
    // Roughly a third on the route, the rest off it.
    const pools = [deadEnds, offPath, route];
    for (let n = 0; coins.length < coinCount && n < coinCount * 4; n++) {
        const at = take(pools[n % 3]) || take(deadEnds) || take(offPath) || take(route);
        if (!at) break;
        coins.push(at);
    }
    return { coins, pickups };
}

// WIND FANS blow ACROSS a corridor the route runs along: a crosswind that
// shoves the ball toward one side while the player is trying to go straight.
// The fan sits on the wall it blows away from, so only cells whose upwind side
// is a real wall qualify. The zone is the cell's floor. Strength is capped
// below full tilt (mazeHazards.js), so a fan never closes a corridor.
function placeFans(open, cfg, g, path, rand, count) {
    const cands = [];
    for (let n = 2; n < path.length - 2; n++) {
        const [pi, pj] = path[n - 1], [i, j] = path[n], [ni, nj] = path[n + 1];
        const din = (i - pi) + ',' + (j - pj), dout = (ni - i) + ',' + (nj - j);
        if (din !== dout) continue;                       // straight cells only
        const alongX = i !== pi;
        // Crosswind: blows along the other axis, away from a closed face.
        const faces = alongX ? [['N', '+z'], ['S', '-z']] : [['W', '+x'], ['E', '-x']];
        for (const [face, dir] of faces) if (!open[j][i][face]) cands.push({ i, j, dir });
    }
    shuffle(cands, rand);
    const out = [], used = new Set();
    for (const c of cands) {
        if (out.length >= count) break;
        if (used.has(c.i + ',' + c.j)) continue;
        used.add(c.i + ',' + c.j);
        out.push({
            x: r2(g.cx(c.i)), z: r2(g.cz(c.j)),
            w: r2(g.px - g.t), d: r2(g.pz - g.t),
            dir: c.dir,
            periodMs: 2800 + Math.round(rand() * 8) * 100,
            phase: r2(rand())
        });
    }
    return out;
}

// ICICLES hang over cells the route crosses -- they are timed, so the player
// can always wait one out, and a timing test is only a test where you must
// pass. Never next to the start or the goal, and each one's first fall comes
// late enough into a run that the player has read the board first.
function placeIcicles(open, cfg, g, path, rand, count) {
    const cells = path.slice(3, -2);
    shuffle(cells, rand);
    const out = [];
    const r = r2(Math.min(0.42, (Math.min(g.px, g.pz) - g.t) * 0.34));
    for (const [i, j] of cells) {
        if (out.length >= count) break;
        if (out.some(o => Math.hypot(o.x - g.cx(i), o.z - g.cz(j)) < Math.min(g.px, g.pz) * 1.5)) continue;
        const ic = { x: r2(g.cx(i)), z: r2(g.cz(j)), r, periodMs: 2600 + Math.round(rand() * 8) * 100, phase: r2(rand()) };
        for (let k = 0; k < 20 && H.firstImpactMs(ic) < 1800; k++) ic.phase = r2((ic.phase + 0.13) % 1);
        if (H.firstImpactMs(ic) < 1800) continue;
        out.push(ic);
    }
    return out;
}

// FLARING SEAMS lie ACROSS the corridor on straight route cells: a band the
// player must cross, and can, in the quiet between flares. Each one's first
// flare comes late enough into a run that the player has read the board.
function placeFlares(open, cfg, g, path, rand, count) {
    const out = [];
    const cells = [];
    for (let n = 3; n < path.length - 2; n++) {
        const [pi, pj] = path[n - 1], [i, j] = path[n], [ni, nj] = path[n + 1];
        if ((i - pi) + ',' + (j - pj) !== (ni - i) + ',' + (nj - j)) continue;
        cells.push({ i, j, alongX: i !== pi });
    }
    shuffle(cells, rand);
    for (const c of cells) {
        if (out.length >= count) break;
        if (out.some(o => Math.hypot(o.x - g.cx(c.i), o.z - g.cz(c.j)) < Math.min(g.px, g.pz) * 1.4)) continue;
        const band = 0.42;
        const f = {
            x: r2(g.cx(c.i)), z: r2(g.cz(c.j)),
            w: r2(c.alongX ? band : g.px - g.t), d: r2(c.alongX ? g.pz - g.t : band),
            periodMs: 2800 + Math.round(rand() * 8) * 100, phase: r2(rand())
        };
        for (let k = 0; k < 20 && H.firstFlareMs(f) < 1800; k++) f.phase = r2((f.phase + 0.13) % 1);
        if (H.firstFlareMs(f) < 1800) continue;
        out.push(f);
    }
    return out;
}

// GEYSERS sit in route cells, well away from the start and the goal and from
// each other; holes are then kept GEYSER_HOLE_CLEAR away (see buildLevel).
function placeGeysers(open, cfg, g, path, rand, count) {
    const cells = path.slice(3, -3);
    shuffle(cells, rand);
    const out = [];
    for (const [i, j] of cells) {
        if (out.length >= count) break;
        if (out.some(o => Math.hypot(o.x - g.cx(i), o.z - g.cz(j)) < 2.6)) continue;
        const gy = { x: r2(g.cx(i)), z: r2(g.cz(j)), r: 0.24, reach: r2(Math.min(1.1, Math.min(g.px, g.pz) * 0.85)),
            periodMs: 3200 + Math.round(rand() * 8) * 100, phase: r2(rand()) };
        for (let k = 0; k < 20 && H.firstBlastMs(gy) < 2000; k++) gy.phase = r2((gy.phase + 0.13) % 1);
        if (H.firstBlastMs(gy) < 2000) continue;
        out.push(gy);
    }
    return out;
}

// WORLD 4. SPINNING ARMS need a ROOM: a rotor in a one-cell corridor would
// leave no way past its hub. So the generator opens a 2x2 block of cells the
// route crosses into one room (its four inner faces knocked through) and
// stands the arm at the room's middle, where those faces met. Rooms are only
// ever ADDED floor, so the maze stays solvable; the caller recomputes the
// route through them. Returns the arms; mutates `open`.
function openRooms(open, cfg, g, path, rand, count) {
    const near = new Set([path[0], path[1], path[path.length - 1], path[path.length - 2]].map(([i, j]) => i + ',' + j));
    const cands = [];
    for (let n = 2; n < path.length - 3; n++) {
        const [i, j] = path[n], [ni, nj] = path[n + 1];
        const bi0 = Math.min(i, ni), bj0 = Math.min(j, nj);
        const blocks = i !== ni ? [[bi0, j], [bi0, j - 1]] : [[i, bj0], [i - 1, bj0]];
        for (const [bi, bj] of blocks) {
            if (bi < 0 || bj < 0 || bi + 1 >= cfg.cols || bj + 1 >= cfg.rows) continue;
            const cells = [[bi, bj], [bi + 1, bj], [bi, bj + 1], [bi + 1, bj + 1]];
            if (cells.some(([a, b]) => near.has(a + ',' + b))) continue;
            cands.push([bi, bj]);
        }
    }
    shuffle(cands, rand);
    const rooms = [];
    for (const [bi, bj] of cands) {
        if (rooms.length >= count) break;
        if (rooms.some(([a, b]) => Math.abs(a - bi) < 4 && Math.abs(b - bj) < 4)) continue;
        rooms.push([bi, bj]);
    }
    const D = Math.min(g.px, g.pz) - g.t / 2;
    return rooms.map(([bi, bj], n) => {
        open[bj][bi].E = open[bj][bi + 1].W = true;
        open[bj + 1][bi].E = open[bj + 1][bi + 1].W = true;
        open[bj][bi].S = open[bj + 1][bi].N = true;
        open[bj][bi + 1].S = open[bj + 1][bi + 1].N = true;
        return {
            x: r2(g.cx(bi) + g.px / 2), z: r2(g.cz(bj) + g.pz / 2),
            len: r2(D - H.ARM_HALF_T - H.ARM_WALL_GAP - 0.1),
            periodMs: 4400 + Math.round(rand() * 8) * 100, phase: r2(rand()), dir: n % 2 ? -1 : 1,
            _cells: [[bi, bj], [bi + 1, bj], [bi, bj + 1], [bi + 1, bj + 1]]
        };
    });
}

// BUMPERS stand in the OUTER corner of a turn the route takes: roll into the
// turn wide and the bumper kicks you back; cut the corner and you never touch
// it. Snug in the corner (a hair off both walls): any further out and the
// test ball half again as wide could not get round the turn. Candidates only
// -- buildLevel keeps each one the level still fits with.
const BUMPER_R = 0.18;
function placeBumpers(open, cfg, g, path, rand, count) {
    const out = [];
    const fx = (g.px - g.t) / 2, fz = (g.pz - g.t) / 2;
    for (let n = 2; n < path.length - 2; n++) {
        const [pi, pj] = path[n - 1], [i, j] = path[n], [ni, nj] = path[n + 1];
        if (pi === ni || pj === nj) continue;                     // straight, not a turn
        if (neighbours(open, cfg.cols, cfg.rows, i, j).length !== 2) continue;
        const sx = -((pi - i) + (ni - i)), sz = -((pj - j) + (nj - j));
        out.push({ x: r2(g.cx(i) + sx * (fx - BUMPER_R - 0.01)), z: r2(g.cz(j) + sz * (fz - BUMPER_R - 0.01)), r: BUMPER_R, _cell: i + ',' + j });
    }
    shuffle(out, rand);
    return out.slice(0, count);
}

// SPRING PADS lie on straight route cells and fire ALONG the corridor, with
// the route or against it. Each comes with its LAUNCH LANE -- the cells from
// the pad to the first wall that way -- which holes keep out of.
function placeSprings(open, cfg, g, path, rand, count, taken) {
    const out = [];
    const cells = [];
    for (let n = 3; n < path.length - 2; n++) {
        const [pi, pj] = path[n - 1], [i, j] = path[n], [ni, nj] = path[n + 1];
        if ((i - pi) + ',' + (j - pj) !== (ni - i) + ',' + (nj - j)) continue;
        if (taken.has(i + ',' + j)) continue;
        cells.push({ i, j, di: ni - i, dj: nj - j });
    }
    shuffle(cells, rand);
    const FACE = { '1,0': 'E', '-1,0': 'W', '0,1': 'S', '0,-1': 'N' };
    for (const c of cells) {
        if (out.length >= count) break;
        if (out.some(o => Math.hypot(o.pad.x - g.cx(c.i), o.pad.z - g.cz(c.j)) < Math.min(g.px, g.pz) * 2)) continue;
        const back = rand() < 0.5 ? -1 : 1;
        const di = c.di * back, dj = c.dj * back;
        let ei = c.i, ej = c.j;
        while (open[ej][ei][FACE[di + ',' + dj]] && ei + di >= 0 && ej + dj >= 0 && ei + di < cfg.cols && ej + dj < cfg.rows) { ei += di; ej += dj; }
        const x0 = Math.min(g.cx(c.i), g.cx(ei)) - g.px / 2, x1 = Math.max(g.cx(c.i), g.cx(ei)) + g.px / 2;
        const z0 = Math.min(g.cz(c.j), g.cz(ej)) - g.pz / 2, z1 = Math.max(g.cz(c.j), g.cz(ej)) + g.pz / 2;
        const pad = {
            x: r2(g.cx(c.i)), z: r2(g.cz(c.j)), w: 0.5, d: 0.5,
            dir: (di ? (di > 0 ? '+x' : '-x') : (dj > 0 ? '+z' : '-z')),
            periodMs: 2800 + Math.round(rand() * 8) * 100, phase: r2(rand())
        };
        for (let k = 0; k < 20 && H.firstFireMs(pad) < 1800; k++) pad.phase = r2((pad.phase + 0.13) % 1);
        if (H.firstFireMs(pad) < 1800) continue;
        out.push({ pad, lane: { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 }, cell: c.i + ',' + c.j });
    }
    return out;
}

// Gates go on a DOORWAY the solution path crosses -- the boundary between two
// cells the player has to pass between, not a bar standing in the middle of a
// corridor. A gate on a branch nobody takes is scenery; a bar in a corridor wide
// enough to pass either side of is scenery that moves.
//
// THE BAR SITS ON THE FACE AND RETRACTS ALONG IT, which is what a sliding door
// does: closed it fills the opening, open it has withdrawn into the wall line
// beside it. The first version instead laid the bar ALONG the corridor and slid
// it lengthwise by its own length, so opening simply moved it into the next cell
// -- where it stood in the way just as much. That is how gates came to orphan up
// to a third of a level's carved floor, and why so few placements could ever
// satisfy "open costs the level nothing": the retract target was another piece
// of the same corridor. Retracting along the face puts it over the wall stub
// flanking the doorway instead, which is solid ground to hide in.
//
// Both retract directions are proposed and the caller's filters choose; see
// buildLevel. Which side is free depends on what the carve put next to the
// doorway, and that is not something this function can know cheaply.
function placeGates(open, cfg, g, path, rand, count) {
    const candidates = [];
    for (let n = 2; n < path.length - 2; n++) {
        const [i, j] = path[n];
        // A corridor cell, not a junction the player can route around.
        if (neighbours(open, cfg.cols, cfg.rows, i, j).length !== 2) continue;
        const [ni, nj] = path[n + 1];
        // The doorway the route actually crosses on its way out of this cell.
        const vertical = (j === nj);                 // travelling in x -> an E/W face
        candidates.push({
            i, j, vertical,
            fx: vertical ? g.cx(i) + (ni - i) * g.px / 2 : g.cx(i),
            fz: vertical ? g.cz(j) : g.cz(j) + (nj - j) * g.pz / 2
        });
    }
    shuffle(candidates, rand);

    const out = [];
    let used = 0;
    for (const c of candidates) {
        if (used >= count) break;
        // The opening is the corridor width; the bar fills it exactly and
        // withdraws by its own length along the face.
        const corridor = Math.min(g.px, g.pz) - g.t;
        const len = r2(corridor);
        for (const dir of [1, -1]) {
            if (used >= count) break;
            // AUTHORED POSITION IS THE OPEN ONE (mazeHazards.js's whole
            // soundness argument rests on that), so the bar is written where it
            // has retracted TO and `travel` carries it back onto the face.
            const gate = c.vertical
                ? { x: r2(c.fx), z: r2(c.fz + dir * len), w: g.t, d: len,
                    axis: 'z', travel: r2(-dir * len), periodMs: 2600 + used * 500, phase: r2(used * 0.31) }
                : { x: r2(c.fx + dir * len), z: r2(c.fz), w: len, d: g.t,
                    axis: 'x', travel: r2(-dir * len), periodMs: 2600 + used * 500, phase: r2(used * 0.31) };
            // Retracting a full corridor length near an edge would carry the bar
            // through the boundary rail. Reject rather than clamp: a shortened
            // travel would leave it unable to clear its own doorway, which is the
            // inert-gate failure the verifier flags separately.
            if (!sweepInBounds(gate)) continue;
            out.push(gate);
            used++;
        }
    }
    return out;
}

module.exports.geometry = geometry;
module.exports.wallsFor = wallsFor;
module.exports.placeHoles = placeHoles;
module.exports.placeIce = placeIce;
module.exports.placeGates = placeGates;
module.exports.holeRadiusFor = holeRadiusFor;

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------
//
// Each world tightens the grid AND introduces something new. The ball shrinks
// only as much as the finer corridor requires -- that is the whole relationship
// between the two, and why "smaller marble" and "bigger maze" are one decision
// rather than two.
// TEN LEVELS PER WORLD, and a world introduces its three traps on levels 1, 4
// and 10 (docs/PLAN.md); the levels between practise what was introduced.
// test_maze_levels.js holds the introduction slots.
//
// The ball is fixed for the world -- radius belongs to the world -- and the
// grid grows within it as far as that ball fits, so density still climbs
// level by level. `route` is how much of the grid the solution path should
// cover; it climbs too.
//
// Worlds 1-4 are built; world 5 (Foundry) follows as its traps are built.
const PICKUP_ROTATION = ['shield', 'magnet', 'slowmo'];
const WORLDS = [
    {
        // Starts in the Workshop and grows into a forest, level by level: each
        // level's blend runs 0 -> 1 (forestDressing.js, mazeTheme3d.js).
        world: 1, theme: 'workshop', themeTo: 'forest', ball: 0.32, wall: 0.33, braid: 0.3,
        names: ['First Roll', 'Threading', 'The Long Way', 'Sliding Door', 'Clockwork',
                'Metronome', 'Shift Work', 'Dovetail', 'Sawdust', 'Assembly Line'],
        teaches: ['HOLES, and the tilt mapping itself.', 'Holes off the route.', 'A longer route.',
                  'MOVING GATES: bars that slide across a doorway and withdraw, forever.', 'Gates.', 'Gates.',
                  'Gates and holes together.', 'A finer grid.', 'The finest grid this ball fits.',
                  'CONVEYOR BELTS: floor that carries the ball, with you or against you.'],
        // grid, holes, gates, conveyors, coins, route fraction
        levels: [
            { cols: 4, rows: 6, holes: 2, gates: 0, conveyors: 0, coins: 5,  route: 0.35 },
            { cols: 4, rows: 6, holes: 3, gates: 0, conveyors: 0, coins: 6,  route: 0.4 },
            { cols: 4, rows: 6, holes: 4, gates: 0, conveyors: 0, coins: 7,  route: 0.5 },
            { cols: 4, rows: 7, holes: 3, gates: 1, conveyors: 0, coins: 7,  route: 0.35 },
            { cols: 4, rows: 7, holes: 4, gates: 1, conveyors: 0, coins: 8,  route: 0.45 },
            { cols: 5, rows: 7, holes: 4, gates: 1, conveyors: 0, coins: 8,  route: 0.45 },
            { cols: 5, rows: 7, holes: 5, gates: 2, conveyors: 0, coins: 9,  route: 0.5 },
            { cols: 5, rows: 8, holes: 5, gates: 2, conveyors: 0, coins: 10, route: 0.45 },
            { cols: 5, rows: 8, holes: 6, gates: 2, conveyors: 0, coins: 10, route: 0.55 },
            { cols: 5, rows: 8, holes: 5, gates: 1, conveyors: 2, coins: 12, route: 0.5 }
        ],
        prize: 'rubberCoat'
    },
    {
        // THE GLACIER. Snowy rock at the treeline turning to clear blue ice as
        // the world goes on (blend snowfield -> glacier). New here: ICE (L1),
        // WIND FANS (L4), FALLING ICICLES (L10). Holes and gates come back as
        // review -- the player already knows them from world 1.
        world: 2, theme: 'snowfield', themeTo: 'glacier', ball: 0.3, wall: 0.32, braid: 0.28,
        names: ['First Frost', 'Black Ice', 'Slip Road', 'Crosswind', 'Whiteout',
                'Gale Force', 'Snow Blind', 'Deep Freeze', 'Avalanche Run', 'Icicle Hall'],
        teaches: ['ICE: no grip, so speed carried in is speed you cannot shed.', 'More ice.', 'Ice and a gate.',
                  'WIND FANS: gusts that shove you sideways, then fall calm.', 'Wind and ice.', 'Two fans.',
                  'Wind, ice and a gate.', 'A finer grid.', 'The finest grid this ball fits.',
                  'FALLING ICICLES: watch the shadow grow, then go -- or wait.'],
        levels: [
            { cols: 5, rows: 8, holes: 3, gates: 0, conveyors: 0, ice: 1, fans: 0, icicles: 0, coins: 6,  route: 0.35 },
            { cols: 5, rows: 8, holes: 4, gates: 0, conveyors: 0, ice: 2, fans: 0, icicles: 0, coins: 7,  route: 0.45 },
            { cols: 5, rows: 8, holes: 4, gates: 1, conveyors: 0, ice: 2, fans: 0, icicles: 0, coins: 8,  route: 0.5 },
            { cols: 5, rows: 8, holes: 4, gates: 0, conveyors: 0, ice: 1, fans: 1, icicles: 0, coins: 8,  route: 0.4 },
            { cols: 6, rows: 8, holes: 5, gates: 1, conveyors: 0, ice: 2, fans: 1, icicles: 0, coins: 9,  route: 0.45 },
            { cols: 6, rows: 9, holes: 5, gates: 0, conveyors: 0, ice: 2, fans: 2, icicles: 0, coins: 9,  route: 0.45 },
            { cols: 6, rows: 9, holes: 6, gates: 1, conveyors: 0, ice: 2, fans: 2, icicles: 0, coins: 10, route: 0.5 },
            { cols: 6, rows: 9, holes: 6, gates: 0, conveyors: 0, ice: 3, fans: 2, icicles: 0, coins: 10, route: 0.5 },
            { cols: 6, rows: 9, holes: 7, gates: 1, conveyors: 0, ice: 3, fans: 2, icicles: 0, coins: 11, route: 0.55 },
            { cols: 6, rows: 9, holes: 5, gates: 0, conveyors: 0, ice: 2, fans: 1, icicles: 3, coins: 12, route: 0.5 }
        ],
        prize: 'heatShield'
    },
    {
        // MAGMA WORKS. Grey cinder fields turning to black basalt split by
        // lava (blend cinder -> lava). New here: FLARING SEAMS (L1), MOLTEN
        // GATES (L4), GEYSERS (L10). Holes and gates return as review.
        world: 3, theme: 'cinder', themeTo: 'lava', ball: 0.28, wall: 0.3, braid: 0.25,
        names: ['Ash Road', 'Hot Ground', 'Cinder Path', 'Forge Door', 'Slag Run',
                'Firewall', 'Crucible', 'Caldera', 'Smelter', 'Geyser Field'],
        teaches: ['FLARING SEAMS: bands of lava that glow, then flare. Cross in the quiet.', 'More seams.', 'Seams and a gate.',
                  'MOLTEN GATES: they burn while they close. Wait, then follow them out.', 'Seams and a molten gate.', 'Two molten gates.',
                  'Seams and molten gates.', 'A finer grid.', 'The finest grid this ball fits.',
                  'GEYSERS: they bubble, then blast you away from them.'],
        levels: [
            { cols: 6, rows: 9,  holes: 4, gates: 0, molten: 0, conveyors: 0, flares: 2, geysers: 0, coins: 7,  route: 0.35 },
            { cols: 6, rows: 9,  holes: 5, gates: 0, molten: 0, conveyors: 0, flares: 3, geysers: 0, coins: 8,  route: 0.45 },
            { cols: 6, rows: 9,  holes: 5, gates: 1, molten: 0, conveyors: 0, flares: 3, geysers: 0, coins: 8,  route: 0.5 },
            { cols: 6, rows: 9,  holes: 5, gates: 0, molten: 1, conveyors: 0, flares: 2, geysers: 0, coins: 9,  route: 0.4 },
            { cols: 6, rows: 10, holes: 6, gates: 0, molten: 1, conveyors: 0, flares: 3, geysers: 0, coins: 9,  route: 0.45 },
            { cols: 7, rows: 10, holes: 6, gates: 0, molten: 2, conveyors: 0, flares: 3, geysers: 0, coins: 10, route: 0.45 },
            { cols: 7, rows: 10, holes: 7, gates: 0, molten: 2, conveyors: 0, flares: 3, geysers: 0, coins: 10, route: 0.5 },
            { cols: 7, rows: 10, holes: 7, gates: 0, molten: 2, conveyors: 0, flares: 4, geysers: 0, coins: 11, route: 0.5 },
            { cols: 7, rows: 10, holes: 8, gates: 0, molten: 2, conveyors: 0, flares: 4, geysers: 0, coins: 11, route: 0.55 },
            { cols: 7, rows: 10, holes: 6, gates: 0, molten: 1, conveyors: 0, flares: 3, geysers: 3, coins: 12, route: 0.5 }
        ],
        prize: 'obsidianCore'
    },
    {
        // THE TOY BOX. A playroom floor of foam tiles and walls of plastic
        // bricks, pastel at first and bright by the end (blend playroom ->
        // toybox). New here: BUMPERS (L1), SPRING PADS (L4), SPINNING ARMS
        // (L10). Holes and gates return as review.
        world: 4, theme: 'playroom', themeTo: 'toybox', ball: 0.26, wall: 0.28, braid: 0.25,
        names: ['Pinball', 'Ricochet', 'Rebound', 'Jack in the Box', 'Boing',
                'Pogo', 'Wind-Up', 'Bounce House', 'Toy Soldier', 'Merry-Go-Round'],
        teaches: ['BUMPERS: posts in the corners that kick you back. Cut the corner.', 'More bumpers.', 'Bumpers and a gate.',
                  'SPRING PADS: they wind down, then launch you along the corridor. Cross while they rest.', 'Springs and bumpers.', 'Springs and a gate.',
                  'More springs.', 'A finer grid.', 'The finest grid this ball fits.',
                  'SPINNING ARMS: rotors in open rooms. Slip through behind a blade.'],
        levels: [
            { cols: 7, rows: 10, holes: 4, gates: 0, conveyors: 0, bumpers: 3, springs: 0, arms: 0, coins: 7,  route: 0.35 },
            { cols: 7, rows: 10, holes: 5, gates: 0, conveyors: 0, bumpers: 4, springs: 0, arms: 0, coins: 8,  route: 0.45 },
            { cols: 7, rows: 10, holes: 5, gates: 1, conveyors: 0, bumpers: 4, springs: 0, arms: 0, coins: 8,  route: 0.5 },
            { cols: 7, rows: 10, holes: 5, gates: 0, conveyors: 0, bumpers: 2, springs: 2, arms: 0, coins: 9,  route: 0.4 },
            { cols: 7, rows: 10, holes: 6, gates: 0, conveyors: 0, bumpers: 3, springs: 2, arms: 0, coins: 9,  route: 0.45 },
            { cols: 7, rows: 11, holes: 6, gates: 1, conveyors: 0, bumpers: 3, springs: 2, arms: 0, coins: 10, route: 0.45 },
            { cols: 7, rows: 11, holes: 6, gates: 0, conveyors: 0, bumpers: 4, springs: 3, arms: 0, coins: 10, route: 0.5 },
            { cols: 7, rows: 11, holes: 7, gates: 0, conveyors: 0, bumpers: 4, springs: 3, arms: 0, coins: 11, route: 0.5 },
            { cols: 7, rows: 11, holes: 7, gates: 1, conveyors: 0, bumpers: 4, springs: 3, arms: 0, coins: 11, route: 0.55 },
            { cols: 7, rows: 10, holes: 5, gates: 0, conveyors: 0, bumpers: 2, springs: 1, arms: 2, coins: 12, route: 0.5 }
        ],
        prize: 'plasticBall'
    }
];

function buildLevel(cfg, n, index, seed) {
    // cfg is the world merged with this level's slot (see buildAll).
    const rand = mulberry32(seed);
    const open = carve(cfg.cols, cfg.rows, rand);
    braid(open, cfg.cols, cfg.rows, rand, cfg.braid);
    const g = geometry(cfg);

    // Start and goal at opposite ends of the board so the route crosses it.
    const from = [0, 0], to = [cfg.cols - 1, cfg.rows - 1];
    let path = shortestPath(open, cfg.cols, cfg.rows, from, to);
    // World 4: rooms for the spinning arms, then the route through them.
    const arms = cfg.arms ? openRooms(open, cfg, g, path, rand, cfg.arms) : [];
    if (arms.length) path = shortestPath(open, cfg.cols, cfg.rows, from, to);

    // GATES FIRST, then holes around them. A gate that sweeps over a hole would
    // shove the ball in with no input the player could have given differently,
    // so the two placements cannot be made independently -- and the verifier
    // rejects that combination outright, which is how the ordering bug showed up.
    //
    // Every hazard is then added ONE AT A TIME and kept only if the level is
    // still solvable with it. That is not belt-and-braces: a gate retracts into
    // whichever cell is next door, and in a carved maze that is frequently open
    // corridor rather than wall -- so a gate at rest can permanently seal the
    // route. Rather than trying to predict which placements are safe, the
    // generator proposes and the geometry decides.
    const walls = wallsFor(open, cfg, g);
    const base = {
        size: { w: BOARD_W, d: BOARD_D }, ballRadius: cfg.ball, walls,
        start: { x: r2(g.cx(from[0])), z: r2(g.cz(from[1])) },
        goal: { x: r2(g.cx(to[0])), z: r2(g.cz(to[1])), r: r2(Math.min(g.px, g.pz) * 0.3) },
        holes: [], gates: [],
        arms: arms.map(({ _cells, ...a }) => a), bumpers: []
    };
    // An arm whose room came out tighter than planned is dropped.
    base.arms = base.arms.filter(a => !H.armRoomProblem(a, walls, base.size, cfg.ball));
    if (!solvable(base)) return null;      // the carve itself is too tight for this ball
    if (!fits(base)) return null;          // ...or fits only by a hair; see FIT_MARGIN_R
    // ...or strands part of itself behind the exit. The goal sits in a corner
    // cell, and if the carve runs a region's only way in through that cell, the
    // run ends before the player can ever go there. Rejected at the SEED, not
    // patched: sealing the goal's spare exit to force a dead end would orphan
    // whatever it led to, which is the same bug wearing a different hat.
    if (orphanArea(base, []) > ORPHAN_TOL) return null;

    // WHAT IT TAKES TO BE A DOORWAY, checked in cost order. solvable() is the
    // weakest of these and on its own accepts every failure the others exist to
    // catch: a bar in a corridor the ball passes either side of, a bar that
    // leaves a sliver nobody can thread, a bar that retracts into another
    // doorway.
    const gates = [];
    const gatedFaces = new Set();
    // Molten gates (world 3) are gates too, placed by the same rules; the last
    // cfg.molten of them are marked molten once placed.
    const gateQuota = cfg.gates + (cfg.molten || 0);
    for (const gt of (gateQuota ? placeGates(open, cfg, g, path, rand, gateQuota * 12) : [])) {
        if (gates.length >= gateQuota) break;
        // Closed, it shuts a way through.
        const shuts = sealsDoorway(gt, open, cfg, g, cfg.ball, walls);
        if (!shuts.length) continue;
        // ONE DOOR PER DOORWAY. Both retract directions are proposed for each
        // candidate face, and neighbouring faces can reach the same opening, so
        // without this a level hangs two bars on one doorway and slides them
        // over each other from either side. Compared by what they SHUT rather
        // than by where they sit, which is what catches the second case.
        if (shuts.some(f => gatedFaces.has(f))) continue;
        // Nor anywhere a spinning arm reaches (world 4): a bar and a blade
        // would shove the ball from two sides at once.
        if (base.arms.some(a => {
            const k = H.armReach(a) + cfg.ball;
            const x0 = Math.min(gt.x, gt.x + (gt.axis === 'x' ? gt.travel : 0)) - gt.w / 2, x1 = Math.max(gt.x, gt.x + (gt.axis === 'x' ? gt.travel : 0)) + gt.w / 2;
            const z0 = Math.min(gt.z, gt.z + (gt.axis === 'z' ? gt.travel : 0)) - gt.d / 2, z1 = Math.max(gt.z, gt.z + (gt.axis === 'z' ? gt.travel : 0)) + gt.d / 2;
            return Math.hypot(Math.max(x0 - a.x, 0, a.x - x1), Math.max(z0 - a.z, 0, a.z - z1)) < k;
        })) continue;
        // Open, it is not standing in some OTHER doorway. Reachability alone
        // misses this: in a braided maze there is usually another way round, so
        // a retracted bar can sit across a cut passage without orphaning a
        // thing -- the maze quietly loses a route and nothing notices.
        if (facesShutBy({ x: gt.x, z: gt.z, w: gt.w, d: gt.d }, open, cfg, g, cfg.ball, walls).length) continue;
        base.gates.push(gt);
        // ...and open, it costs the level no floor at all (the corridor-middle
        // case faces cannot see), it still fits, and the route still exists.
        if (solvable(base) && fits(base) && opensClear(base, base.gates.length - 1)) {
            gates.push(gt);
            shuts.forEach(f => gatedFaces.add(f));
        } else {
            base.gates.pop();
        }
    }

    // Ice BEFORE holes, for the same reason gates come before both: a hole
    // underneath an ice patch cannot be avoided however carefully the ball was
    // driven, so the two placements cannot be made independently. Ice needs no
    // solvability filter of its own -- it changes how hard the ball is to
    // control, never where it can go.
    const ice = cfg.ice ? placeIce(open, cfg, g, path, rand, cfg.ice) : [];
    // Wind before holes for the reason belts are: a hole inside a gust zone
    // would be one the wind can blow you into with no floor to recover on.
    const fanRects = r => ({ x: r.x, z: r.z, w: r.w, d: r.d });
    const fans = (cfg.fans ? placeFans(open, cfg, g, path, rand, cfg.fans * 3) : [])
        .filter(f => ice.every(r => Math.abs(f.x - r.x) >= (f.w + r.w) / 2 || Math.abs(f.z - r.z) >= (f.d + r.d) / 2))
        .slice(0, cfg.fans || 0);
    const icicles = cfg.icicles ? placeIcicles(open, cfg, g, path, rand, cfg.icicles) : [];
    // World 3. Molten gates: the last cfg.molten gates placed.
    if (cfg.molten) gates.slice(-cfg.molten).forEach(gt => { gt.molten = true; });
    const sweepRects = gates.map(gt => {
        const a = gt.x, b = gt.x + (gt.axis === 'x' ? gt.travel : 0), c = gt.z, e = gt.z + (gt.axis === 'z' ? gt.travel : 0);
        return { x: (a + b) / 2, z: (c + e) / 2, w: Math.abs(b - a) + gt.w, d: Math.abs(e - c) + gt.d };
    });
    const apart = (p, q, pad) => Math.abs(p.x - q.x) >= (p.w + q.w) / 2 + pad || Math.abs(p.z - q.z) >= (p.d + q.d) / 2 + pad;
    const flares = (cfg.flares ? placeFlares(open, cfg, g, path, rand, cfg.flares * 3) : [])
        .filter(f => sweepRects.every(sw => apart(f, sw, cfg.ball)))
        .slice(0, cfg.flares || 0);
    const geysers = (cfg.geysers ? placeGeysers(open, cfg, g, path, rand, cfg.geysers * 3) : [])
        .filter(gy => sweepRects.every(sw => apart({ x: gy.x, z: gy.z, w: gy.reach * 2, d: gy.reach * 2 }, sw, 0)))
        .filter(gy => flares.every(f => apart({ x: gy.x, z: gy.z, w: gy.reach * 2, d: gy.reach * 2 }, f, 0)))
        .slice(0, cfg.geysers || 0);
    // Holes stay off flares, and well clear of geysers (a blast can throw
    // the ball; mazeHazards.js GEYSER_HOLE_CLEAR).
    const world3Keepouts = flares.map(f => ({ x: f.x, z: f.z, w: f.w, d: f.d }))
        .concat(geysers.map(gy => ({ x: gy.x, z: gy.z, w: H.GEYSER_HOLE_CLEAR * 2, d: H.GEYSER_HOLE_CLEAR * 2 })));
    const icicleRects = icicles.map(ic => ({ x: ic.x, z: ic.z, w: ic.r * 2, d: ic.r * 2 }));

    // Belts after gates (a bar must not slide across a belt -- the ball would
    // be shoved by both at once) and before holes (a hole must not sit on a
    // belt, the same reason one must not sit under ice).
    const sweptOf = gt => {
        const a = gt.x, b = gt.x + (gt.axis === 'x' ? gt.travel : 0);
        const c = gt.z, e = gt.z + (gt.axis === 'z' ? gt.travel : 0);
        return { x: (a + b) / 2, z: (c + e) / 2, w: Math.abs(b - a) + gt.w, d: Math.abs(e - c) + gt.d };
    };
    const overlaps = (p, q, pad) => Math.abs(p.x - q.x) < (p.w + q.w) / 2 + pad && Math.abs(p.z - q.z) < (p.d + q.d) / 2 + pad;
    const conveyors = (cfg.conveyors ? placeConveyors(open, cfg, g, path, rand, cfg.conveyors * 4) : [])
        .filter(c => gates.every(gt => !overlaps(c, sweptOf(gt), cfg.ball)))
        .filter(c => ice.every(r => !overlaps(c, r, 0)))
        .filter((c, n, all) => all.slice(0, n).every(o => !overlaps(c, o, cfg.ball)))
        .slice(0, cfg.conveyors);

    // World 4. Bumpers one at a time, kept only while the level still fits
    // round them (they are posts: solid to every search); then spring pads.
    const armCells = new Set(arms.flatMap(a => a._cells.map(([i, j]) => i + ',' + j)));
    const bumperCells = new Set();
    for (const b of (cfg.bumpers ? placeBumpers(open, cfg, g, path, rand, cfg.bumpers * 4) : [])) {
        if (base.bumpers.length >= cfg.bumpers) break;
        if (armCells.has(b._cell)) continue;
        if (sweepRects.some(sw => !apart({ x: b.x, z: b.z, w: b.r * 2, d: b.r * 2 }, sw, cfg.ball))) continue;
        if (base.bumpers.some(o => Math.hypot(o.x - b.x, o.z - b.z) < 1.6)) continue;
        const { _cell, ...bumper } = b;
        base.bumpers.push(bumper);
        if (solvable(base) && fits(base)) bumperCells.add(_cell);
        else base.bumpers.pop();
    }
    const springs = (cfg.springs ? placeSprings(open, cfg, g, path, rand, cfg.springs * 3, new Set([...armCells, ...bumperCells])) : [])
        .filter(s => sweepRects.every(sw => apart(s.pad, sw, cfg.ball)))
        .slice(0, cfg.springs || 0);
    const holeClear = cfg.ball * 1.35;
    const world4Keepouts = base.bumpers.map(b => ({ x: b.x, z: b.z, w: 2 * (H.BUMPER_HOLE_CLEAR - holeClear), d: 2 * (H.BUMPER_HOLE_CLEAR - holeClear) }))
        .concat(springs.map(s => s.lane))
        .concat(base.arms.map(a => { const k = 2 * (H.armReach(a) + cfg.ball + 0.5 - holeClear); return { x: a.x, z: a.z, w: k, d: k }; }));

    const holes = [];
    const openSpecs = base.gates.map(gt => ({ x: gt.x, z: gt.z, w: gt.w, d: gt.d }));
    for (const h of placeHoles(open, cfg, g, path, rand, cfg.holes * 3, gates, ice.concat(conveyors, fans.map(fanRects), icicleRects, world3Keepouts, world4Keepouts), cfg)) {
        if (holes.length >= cfg.holes) break;
        base.holes.push(h);
        // Solvable is not enough -- see orphanArea(). A hole that seals a branch
        // leaves start->goal untouched and quietly deletes part of the level.
        if (solvable(base) && orphanArea(base, openSpecs) <= ORPHAN_TOL) holes.push(h);
        else base.holes.pop();
    }

    // Timings from the real route length. minMs stays a FLOOR derived from an
    // implausible speed -- a false rejection of an honest clear costs more than
    // an accepted cheat in a mode that only pays cosmetics -- while goldMs is
    // the number a player actually chases.
    const steps = Math.max(1, path.length - 1);
    const dist = steps * Math.min(g.px, g.pz);
    const minMs = Math.max(2500, Math.round(dist / 9 * 1000));
    const goldMs = Math.round(dist / 1.5 * 1000);

    // Collectibles last: they go where the finished level leaves room.
    const placed = { ...base, holes, gates, springs: springs.map(s => s.pad) };
    const pickupKinds = n === 0 ? [] : [PICKUP_ROTATION[(n - 1) % PICKUP_ROTATION.length]];
    const { coins, pickups } = placeCollectibles(open, cfg, g, path, rand, placed, cfg.coins || 0, pickupKinds);

    const lv = {
        id: `w${cfg.world}_${String(n + 1).padStart(2, '0')}`,
        world: cfg.world,
        index,
        name: cfg.names[n],
        theme: cfg.theme,
        ...(cfg.themeTo ? { themeTo: cfg.themeTo, blend: r2(n / Math.max(1, cfg.levels.length - 1)) } : {}),
        ballRadius: cfg.ball,
        size: { w: BOARD_W, d: BOARD_D },
        start: base.start,
        goal: base.goal,
        minMs, goldMs,
        _shape: `${cfg.cols}x${cfg.rows} carved maze, ${path.length}-cell route, ${holes.length} holes, ball ${cfg.ball}. ${cfg.teaches[n]}`,
        walls,
        holes
    };
    if (ice.length) lv.ice = ice;
    if (gates.length) lv.gates = gates;
    if (conveyors.length) lv.conveyors = conveyors;
    if (fans.length) lv.fans = fans;
    if (icicles.length) lv.icicles = icicles;
    if (flares.length) lv.flares = flares;
    if (geysers.length) lv.geysers = geysers;
    if (base.bumpers.length) lv.bumpers = base.bumpers;
    if (springs.length) lv.springs = springs.map(s => s.pad);
    if (base.arms.length) lv.arms = base.arms;
    lv.coins = coins;
    if (pickups.length) lv.pickups = pickups;
    return lv;
}

// HOW LONG A LEVEL'S ROUTE SHOULD BE is each level slot's `route`: a fraction
// of its grid's cells. The carve is random, and a corner-to-corner route
// through one runs anywhere from a quarter of the cells to four fifths
// depending on the seed, so taking the first seed that passed every filter set
// each level's length by accident (one world once got SHORTER as the player
// advanced). Seeds are ranked by closeness to the target instead. A fraction
// of the grid rather than a count, because the grid grows level to level.
//
// Each trap's introduction level dips back to a shorter route: it wants room
// to teach before it asks for endurance too. That dip is the point.

function buildAll() {
    const levels = [];
    let index = 1;
    for (const world of WORLDS) {
        for (let n = 0; n < world.levels.length; n++) {
            const cfg = { ...world, ...world.levels[n], ice: world.levels[n].ice || 0 };
            const target = cfg.route * cfg.cols * cfg.rows;
            // Rank the candidate seeds by how close their route lands to the
            // target BEFORE building any of them. Route length is a property of
            // the carve alone -- carve, braid, shortest path, nothing else -- so
            // it can be read off cheaply, and the expensive hazard placement
            // then runs in preference order instead of in seed order.
            const ranked = [];
            for (let attempt = 0; attempt < 40; attempt++) {
                const seed = cfg.world * 1000 + n * 17 + 7 + attempt * 101 + cfg.cols * 7919 + cfg.rows * 104729;
                const rand = mulberry32(seed);
                const open = carve(cfg.cols, cfg.rows, rand);
                braid(open, cfg.cols, cfg.rows, rand, cfg.braid);
                const route = shortestPath(open, cfg.cols, cfg.rows, [0, 0], [cfg.cols - 1, cfg.rows - 1]);
                ranked.push({ seed, attempt, len: route ? route.length : Infinity });
            }
            // Ties broken by attempt order, so the choice stays reproducible.
            ranked.sort((a, b) => Math.abs(a.len - target) - Math.abs(b.len - target) || a.attempt - b.attempt);

            // Walk them in preference order and take the first that survives
            // every filter AND carries its world's full hazard quota.
            //
            // The quota is not guaranteed by the carve: hazards need somewhere
            // legal to go, and a route with few straight run-ups into a decision
            // simply has nowhere to put a third ice patch. Settling for the
            // first seed that merely BUILDS ships that level a hazard short for
            // no reason, when a seed a cell or two further from the target would
            // have carried all three.
            //
            // Bounded rather than exhaustive: past the first dozen candidates
            // the route has drifted far enough from the band that the length
            // ramp is the bigger loss. Whatever built first is kept as the
            // fallback, so a world that cannot fill its quota anywhere still
            // ships its best-fitting level rather than nothing.
            const SCAN = 12;
            let lv = null, fallback = null;
            for (const cand of ranked.slice(0, SCAN)) {
                const built = buildLevel(cfg, n, index, cand.seed);
                if (!built) continue;
                if (!fallback) fallback = built;
                if (built.holes.length === cfg.holes
                    && (built.gates || []).length === cfg.gates + (cfg.molten || 0)
                    && (built.flares || []).length === (cfg.flares || 0)
                    && (built.geysers || []).length === (cfg.geysers || 0)
                    && (built.ice || []).length === cfg.ice
                    && (built.conveyors || []).length === cfg.conveyors
                    && (built.fans || []).length === (cfg.fans || 0)
                    && (built.icicles || []).length === (cfg.icicles || 0)
                    && (built.bumpers || []).length === (cfg.bumpers || 0)
                    && (built.springs || []).length === (cfg.springs || 0)
                    && (built.arms || []).length === (cfg.arms || 0)
                    && built.coins.length === cfg.coins) { lv = built; break; }
            }
            if (!lv) lv = fallback;
            if (!lv) {
                for (const cand of ranked.slice(SCAN)) {
                    lv = buildLevel(cfg, n, index, cand.seed);
                    if (lv) break;
                }
            }
            if (!lv) throw new Error(`could not generate a solvable level for world ${cfg.world} slot ${n}`);
            levels.push(lv);
            index++;
        }
    }
    // Each world's last level carries its prize (docs/PLAN.md): the thing that
    // helps -- never is required -- against a trap in the next world.
    for (const world of WORLDS) {
        const last = levels.filter(l => l.world === world.world).pop();
        if (last && world.prize) last.prize = world.prize;
    }
    return levels;
}

module.exports.buildAll = buildAll;
module.exports.WORLDS = WORLDS;

if (require.main === module) (async () => {
    H = await import('../mazeHazards.js');
    const levels = buildAll();
    const src = fs.readFileSync(OUT_PATH, 'utf8');
    const head = src.slice(0, src.indexOf('  "levels": ['));
    const body = levels.map(renderLevel).join(',\n');
    fs.writeFileSync(OUT_PATH, head + '  "levels": [\n' + body + '\n  ]\n}\n');
    const cells = levels.reduce((n, l) => n + l.walls.length, 0);
    console.log(`Wrote ${levels.length} levels (${cells} wall segments). Now run: node test_maze_levels.js`);
})().catch(e => { console.error(e); process.exit(1); });

// Formatting matches the file's own rule: one wall/hole/gate per line. A
// JSON.stringify round-trip turns one level into 150 lines and makes the diff
// unreadable, which matters on a file heading for 50 levels.
function renderLevel(lv) {
    const num = v => (Number.isInteger(v) ? v : v);
    const obj = (o, keys) => '{ ' + keys.filter(k => o[k] !== undefined)
        .map(k => `"${k}": ${typeof o[k] === 'string' ? JSON.stringify(o[k]) : num(o[k])}`).join(', ') + ' }';
    const list = (arr, keys) => arr.map(o => '        ' + obj(o, keys)).join(',\n');
    const L = [];
    L.push('    {');
    L.push(`      "id": ${JSON.stringify(lv.id)},`);
    L.push(`      "world": ${lv.world},`);
    L.push(`      "index": ${lv.index},`);
    L.push(`      "name": ${JSON.stringify(lv.name)},`);
    L.push(`      "theme": ${JSON.stringify(lv.theme)},`);
    if (lv.themeTo) L.push(`      "themeTo": ${JSON.stringify(lv.themeTo)},`);
    if (lv.themeTo) L.push(`      "blend": ${lv.blend},`);
    L.push(`      "ballRadius": ${lv.ballRadius},`);
    L.push(`      "size": { "w": ${lv.size.w}, "d": ${lv.size.d} },`);
    L.push(`      "start": ${obj(lv.start, ['x', 'z'])},`);
    L.push(`      "goal": ${obj(lv.goal, ['x', 'z', 'r'])},`);
    L.push(`      "minMs": ${lv.minMs},`);
    L.push(`      "goldMs": ${lv.goldMs},`);
    if (lv.prize) L.push(`      "prize": ${JSON.stringify(lv.prize)},`);
    L.push(`      "_shape": ${JSON.stringify(lv._shape)},`);
    L.push('      "walls": [');
    L.push(list(lv.walls, ['x', 'z', 'w', 'd']));
    L.push('      ],');
    // Optional arrays, each written only when present, commas between them.
    const blocks = [
        ['holes', lv.holes, ['x', 'z', 'r']],
        ['ice', lv.ice, ['x', 'z', 'w', 'd']],
        ['gates', lv.gates, ['x', 'z', 'w', 'd', 'axis', 'travel', 'periodMs', 'phase', 'molten']],
        ['flares', lv.flares, ['x', 'z', 'w', 'd', 'periodMs', 'phase']],
        ['geysers', lv.geysers, ['x', 'z', 'r', 'reach', 'periodMs', 'phase']],
        ['conveyors', lv.conveyors, ['x', 'z', 'w', 'd', 'dir', 'speed']],
        ['fans', lv.fans, ['x', 'z', 'w', 'd', 'dir', 'periodMs', 'phase']],
        ['icicles', lv.icicles, ['x', 'z', 'r', 'periodMs', 'phase']],
        ['bumpers', lv.bumpers, ['x', 'z', 'r']],
        ['springs', lv.springs, ['x', 'z', 'w', 'd', 'dir', 'periodMs', 'phase']],
        ['arms', lv.arms, ['x', 'z', 'len', 'periodMs', 'phase', 'dir']],
        ['coins', lv.coins, ['x', 'z']],
        ['pickups', lv.pickups, ['x', 'z', 'kind']]
    ].filter(([, arr]) => arr);
    blocks.forEach(([key, arr, keys], n) => {
        L.push(`      "${key}": [`);
        if (arr.length) L.push(list(arr, keys));
        L.push(n === blocks.length - 1 ? '      ]' : '      ],');
    });
    L.push('    }');
    return L.join('\n');
}
