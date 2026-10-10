// THE RESCUE (the user's call, 2026-10-09): the story that ties the planets
// together, and where on each planet's floor 10 the captive is hidden.
//
// Rolle, a marble from MarbleTopia, sets out after Baron Von Ratchet. The
// Baron wound up five planets like clocks, and to keep them ticking he
// kidnapped Rolle's friends and set them rolling his maze-engines forever.
// Each friend is caged deep in the labyrinth on a planet's floor 10. Roll
// through the cage to free them -- the exit stays locked until then -- and
// escape. A friend freed joins the player as a marble (shopCatalog.js MARBLES
// with `rescue: <world>`).
//
// WHERE THE CAGE GOES is worked out from the level itself, never stored in
// mazeLevels.json: the levels are seeded and byte-for-byte reproducible, and
// every gold time is tuned to them. captiveSpot() is pure and deterministic;
// test_rescue.js checks every floor 10's spot is clear of every trap, off the
// main route, and reachable from the start and back to the exit.

import { MARBLES } from './shopCatalog.js';
import { isSafeSpot } from './mazePickups.js';
import { worldName } from './worlds.js';

export const VILLAIN = 'Baron Von Ratchet';
export const HERO = 'classic';             // Rolle
export const RESCUE_FLOOR = 10;            // the floor of each world the captive is on

// The friend held on each world: the marble whose `rescue` is that world.
export function captiveFor(world) {
    const id = Object.keys(MARBLES).find(k => MARBLES[k].rescue === world);
    return id ? { id, name: MARBLES[id].name, look: MARBLES[id].look, swatch: MARBLES[id].swatch } : null;
}

// A level a captive is held on: a world's floor 10 (a ladder level).
export function isRescueLevel(lv) {
    return !!(lv && Number.isInteger(lv.world) && Number.isInteger(lv.index) && lv.index === (lv.world - 1) * 10 + RESCUE_FLOOR
        && captiveFor(lv.world));
}

// The words, kept together so the story reads the same everywhere.
export function storyCard(world, firstEver) {
    const c = captiveFor(world);
    if (!c) return null;
    const planet = worldName(world);
    return {
        title: firstEver ? 'ROLLE TO THE RESCUE' : `${c.name.toUpperCase()} IS HERE`,
        lines: [
            ...(firstEver ? [`${VILLAIN} wound up five planets like clocks. To keep them ticking, he kidnapped Rolle's friends from MarbleTopia and set them rolling his maze-engines.`] : []),
            `${c.name} is caged somewhere in this maze on ${planet}.`,
            `Roll through the cage to free ${c.name}. The exit stays locked until you do.`
        ],
        go: `FREE ${c.name.toUpperCase()}!`
    };
}
export const readyLine = (world) => { const c = captiveFor(world); return c ? `FIND ${c.name.toUpperCase()}'S CAGE, THEN ESCAPE` : ''; };
export const lockedLine = (world) => { const c = captiveFor(world); return c ? `FREE ${c.name.toUpperCase()} FIRST!` : ''; };
export const freedLine = (world) => { const c = captiveFor(world); return c ? `${c.name.toUpperCase()} IS FREE!  NOW ESCAPE` : ''; };
export const joinedLine = (world) => { const c = captiveFor(world); return c ? `${c.name.toUpperCase()} JOINS YOU!  ROLL AS ${c.name.toUpperCase()} FROM GEAR` : ''; };

// THE STORY'S VOICES (the user's call, 2026-10-10): the Baron taunts Rolle
// on each planet's first level (not Sawturn's: a new player's first screen
// keeps its how-to line), a freed friend points to the next planet, and
// floor 9 warns that the cage is near.
const TAUNTS = {
    2: "SLIPSTONIA'S ICE WILL STOP YOU COLD, ROLLE!",
    3: 'NO MARBLE SURVIVES THE MAGMA WORKS!',
    4: 'MY TOYS WILL BOUNCE YOU RIGHT OUT!',
    5: "WELCOME TO MY FOUNDRY. YOU'LL NEVER LEAVE."
};
const FRIEND_SAYS = {
    1: 'THE BARON FLED TO SLIPSTONIA!',
    2: 'HE DRAGGED CINDER OFF TO MAGMARS!',
    3: "BOBBLE'S TRAPPED ON BOUNCELOT!",
    4: "RIVET'S IN HIS FOUNDRY ON GEARTH!",
    5: "THE BARON GOT AWAY\u2026 BUT WE'RE ALL FREE!"
};
export const baronLine = (world) => (TAUNTS[world] ? 'BARON: ' + TAUNTS[world] : '');
export const friendLine = (world) => { const c = captiveFor(world); return c && FRIEND_SAYS[world] ? `${c.name.toUpperCase()}: ${FRIEND_SAYS[world]}` : ''; };
export const nearLine = (world) => { const c = captiveFor(world); return c ? `${c.name.toUpperCase()}'S CAGE IS ON THE NEXT FLOOR. HANG ON, ${c.name.toUpperCase()}!` : ''; };

// How close the ball must come to free the captive (centre to centre).
export const CAPTIVE_REACH = 0.42;

// --- where the cage goes --------------------------------------------------------
const G = 0.1;   // grid step

function grid(lv) {
    const r = lv.ballRadius, W = lv.size.w, D = lv.size.d;
    const nx = Math.ceil(W / G), nz = Math.ceil(D / G);
    const cx = i => -W / 2 + (i + 0.5) * G, cz = j => -D / 2 + (j + 0.5) * G;
    const inWall = (x, z, m) => (lv.walls || []).some(w => Math.abs(x - w.x) < w.w / 2 + r * m && Math.abs(z - w.z) < w.d / 2 + r * m);
    const inBounds = (x, z, m) => Math.abs(x) <= W / 2 - r * m && Math.abs(z) <= D / 2 - r * m;
    // Where a ball can BE (and so travel): clear of walls and holes. Traps
    // are crossable -- that is what the level asks of the player.
    const pass = new Uint8Array(nx * nz);
    const wide = new Uint8Array(nx * nz);
    // Where the cage can SIT: roomier, and safe by the same rule the shield
    // uses to put a ball back (clear of holes, gates, belts, gusts, icicles,
    // seams, geysers, bumpers, springs, arms, magnets, presses and rails).
    const sit = new Uint8Array(nx * nz);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = cx(i), z = cz(j), k = i + j * nx;
        const holeFree = (lv.holes || []).every(h => Math.hypot(x - h.x, z - h.z) > h.r);
        pass[k] = inBounds(x, z, 1.05) && !inWall(x, z, 1.02) && holeFree ? 1 : 0;
        // A ball 50% wider must fit through the walls to it too, the
        // standard every level meets (test_maze_levels.js fitsWithMargin,
        // which counts walls, not holes): never a cage behind a squeeze.
        wide[k] = inBounds(x, z, 1.5) && !inWall(x, z, 1.5) ? 1 : 0;
        sit[k] = pass[k] && inBounds(x, z, 1.6) && !inWall(x, z, 1.6) && isSafeSpot(lv, x, z, r) ? 1 : 0;
    }
    return { nx, nz, cx, cz, pass, wide, sit, ci: x => Math.max(0, Math.min(nx - 1, Math.floor((x + W / 2) / G))), cj: z => Math.max(0, Math.min(nz - 1, Math.floor((z + D / 2) / G))) };
}

// Path lengths (in grid steps, diagonals ~1.41) from one cell over passable
// cells (`pass`, or another mask: the wide ball's).
function distances(g, from, pass = g.pass) {
    const { nx, nz } = g;
    const dist = new Float64Array(nx * nz).fill(Infinity);
    dist[from] = 0;
    // A small Dijkstra with a binary heap: 8-neighbour, no corner cutting.
    const heap = [[0, from]];
    const push = (d, k) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
        const [d, k] = pop();
        if (d > dist[k]) continue;
        const i = k % nx, j = (k / nx) | 0;
        for (const [di, dj, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]) {
            const a = i + di, b = j + dj;
            if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
            const n = a + b * nx;
            if (!pass[n]) continue;
            if (di && dj && (!pass[a + j * nx] || !pass[i + b * nx])) continue;
            const nd = d + w;
            if (nd < dist[n]) { dist[n] = nd; push(nd, n); }
        }
    }
    return dist;
}

// The cage's spot on a rescue level: { x, z }, or null if none fits.
// Hidden means OFF the way to the exit -- a detour the player has to go
// looking for -- but not the far end of the board: the detour is kept to
// between a quarter and three fifths of the start-to-exit route, and among
// those the spot farthest from the route wins (a side branch, not a bulge).
// Kept away from the start, the exit, coins and power-ups.
const cache = new Map();
export function captiveSpot(lv) {
    if (!isRescueLevel(lv)) return null;
    if (cache.has(lv.id)) return cache.get(lv.id);
    const g = grid(lv);
    const s = g.ci(lv.start.x) + g.cj(lv.start.z) * g.nx;
    const e = g.ci(lv.goal.x) + g.cj(lv.goal.z) * g.nx;
    g.pass[s] = 1; g.pass[e] = 1; g.wide[s] = 1; g.wide[e] = 1;
    const fromStart = distances(g, s), fromGoal = distances(g, e);
    const wideStart = distances(g, s, g.wide), wideGoal = distances(g, e, g.wide);
    const route = fromStart[e];
    let best = null;
    if (Number.isFinite(route)) {
        // On-route cells: within a hair of the shortest path.
        const onRoute = [];
        for (let k = 0; k < g.pass.length; k++) if (fromStart[k] + fromGoal[k] <= route + 0.5) onRoute.push(k);
        const near = (x, z, list, d) => (list || []).some(p => Math.hypot(x - p.x, z - p.z) < d);
        for (const lo of [0.25, 0.12]) {
            for (let k = 0; k < g.sit.length; k++) {
                if (!g.sit[k] || !Number.isFinite(fromStart[k]) || !Number.isFinite(fromGoal[k])) continue;
                if (!Number.isFinite(wideStart[k]) || !Number.isFinite(wideGoal[k])) continue;
                const detour = fromStart[k] + fromGoal[k] - route;
                if (detour < route * lo || detour > route * 0.6) continue;
                const x = g.cx(k % g.nx), z = g.cz((k / g.nx) | 0);
                if (Math.hypot(x - lv.start.x, z - lv.start.z) < 2 || Math.hypot(x - lv.goal.x, z - lv.goal.z) < 2) continue;
                if (near(x, z, lv.coins, 0.5) || near(x, z, lv.pickups, 0.6)) continue;
                // Distance from the route: the nearest on-route cell (sampled).
                let off = Infinity;
                for (let t = 0; t < onRoute.length; t += 3) {
                    const q = onRoute[t];
                    const d = Math.hypot(x - g.cx(q % g.nx), z - g.cz((q / g.nx) | 0));
                    if (d < off) off = d;
                }
                // Deterministic: farther off the route wins, then the longer
                // detour, then the cell order.
                if (!best || off > best.off + 1e-9 || (Math.abs(off - best.off) <= 1e-9 && detour > best.detour + 1e-9)) best = { x: +x.toFixed(2), z: +z.toFixed(2), off, detour };
            }
            if (best) break;
        }
    }
    const out = best ? { x: best.x, z: best.z, detour: best.detour * G, route: route * G } : null;
    cache.set(lv.id, out);
    return out;
}
