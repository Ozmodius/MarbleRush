// SPOTS IN A LEVEL, worked out from the level itself (never stored in
// mazeLevels.json: the levels are seeded and byte-for-byte reproducible, and
// every gold time is tuned to them). Shared by everything the game places in
// a level after the fact: the rescue's cage (rescue.js), the fuel cells
// (fuel.js), the Baron's locks and the survey.
//
// One grid per level (G units a cell), cached by level id:
//   pass  where a ball can BE: in bounds, clear of walls and of holes. Traps
//         are crossable -- that is what the level asks of the player.
//   wide  where a ball 50% wider fits through the walls (the standard every
//         level meets: test_maze_levels.js fitsWithMargin counts walls, not
//         holes) -- never a spot behind a squeeze.
//   sit   where a thing can SIT: roomier, and safe by the shield's own rule
//         (mazePickups.js isSafeSpot: clear of holes, gates, belts, gusts,
//         icicles, seams, geysers, bumpers, springs, arms, magnets, presses
//         and rails).
// and the path lengths from the start and from the exit over pass and wide.

import { isSafeSpot } from './mazePickups.js';

export const G = 0.1;   // grid step

function build(lv) {
    const r = lv.ballRadius, W = lv.size.w, D = lv.size.d;
    const nx = Math.ceil(W / G), nz = Math.ceil(D / G);
    const cx = i => -W / 2 + (i + 0.5) * G, cz = j => -D / 2 + (j + 0.5) * G;
    const inWall = (x, z, m) => (lv.walls || []).some(w => Math.abs(x - w.x) < w.w / 2 + r * m && Math.abs(z - w.z) < w.d / 2 + r * m);
    const inBounds = (x, z, m) => Math.abs(x) <= W / 2 - r * m && Math.abs(z) <= D / 2 - r * m;
    const pass = new Uint8Array(nx * nz);
    const wide = new Uint8Array(nx * nz);
    const sit = new Uint8Array(nx * nz);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = cx(i), z = cz(j), k = i + j * nx;
        const holeFree = (lv.holes || []).every(h => Math.hypot(x - h.x, z - h.z) > h.r);
        pass[k] = inBounds(x, z, 1.05) && !inWall(x, z, 1.02) && holeFree ? 1 : 0;
        wide[k] = inBounds(x, z, 1.5) && !inWall(x, z, 1.5) ? 1 : 0;
        sit[k] = pass[k] && inBounds(x, z, 1.6) && !inWall(x, z, 1.6) && isSafeSpot(lv, x, z, r) ? 1 : 0;
    }
    const ci = x => Math.max(0, Math.min(nx - 1, Math.floor((x + W / 2) / G)));
    const cj = z => Math.max(0, Math.min(nz - 1, Math.floor((z + D / 2) / G)));
    const s = ci(lv.start.x) + cj(lv.start.z) * nx;
    const e = ci(lv.goal.x) + cj(lv.goal.z) * nx;
    pass[s] = 1; pass[e] = 1; wide[s] = 1; wide[e] = 1;
    const g = { nx, nz, cx, cz, ci, cj, pass, wide, sit, s, e };
    g.cell = (x, z) => ci(x) + cj(z) * nx;
    g.at = k => ({ x: cx(k % nx), z: cz((k / nx) | 0) });
    g.fromStart = distances(g, s);
    g.fromGoal = distances(g, e);
    g.wideStart = distances(g, s, wide);
    g.wideGoal = distances(g, e, wide);
    g.route = g.fromStart[e];
    // On-route cells: within a hair of the shortest path, start to exit.
    g.onRoute = [];
    if (Number.isFinite(g.route)) for (let k = 0; k < pass.length; k++) if (g.fromStart[k] + g.fromGoal[k] <= g.route + 0.5) g.onRoute.push(k);
    return g;
}

// Path lengths (in grid steps, diagonals ~1.41) from one cell over passable
// cells (`mask`: pass by default). 8-neighbour, no corner cutting.
export function distances(g, from, mask = g.pass) {
    const { nx, nz } = g;
    const dist = new Float64Array(nx * nz).fill(Infinity);
    dist[from] = 0;
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
            if (!mask[n]) continue;
            if (di && dj && (!mask[a + j * nx] || !mask[i + b * nx])) continue;
            const nd = d + w;
            if (nd < dist[n]) { dist[n] = nd; push(nd, n); }
        }
    }
    return dist;
}

const grids = new Map();
export function levelGrid(lv) {
    if (!grids.has(lv.id)) grids.set(lv.id, build(lv));
    return grids.get(lv.id);
}

// Distance (units) from a point to the start-to-exit route (sampled).
export function offRoute(g, x, z) {
    let off = Infinity;
    for (let t = 0; t < g.onRoute.length; t += 3) {
        const q = g.onRoute[t];
        const d = Math.hypot(x - g.cx(q % g.nx), z - g.cz((q / g.nx) | 0));
        if (d < off) off = d;
    }
    return off;
}

// A spot where something can sit, picked from the grid:
//   bands  [lo, hi] fractions of the route the detour to the spot may be;
//          tried in order until one finds a spot
//   score  (spot) -> number, higher wins; ties go to the longer detour,
//          then the cell order (so it is deterministic)
//   away   [{ x, z, d }] points the spot keeps at least d from (besides the
//          start and exit, 2; coins 0.5; power-ups 0.6)
// Returns { x, z, detour, route } in units, or null.
export function pickSpot(lv, { bands = [[0.25, 0.6]], score, away = [] } = {}) {
    const g = levelGrid(lv);
    if (!Number.isFinite(g.route)) return null;
    const near = (x, z, list, d) => (list || []).some(p => Math.hypot(x - p.x, z - p.z) < (p.d !== undefined ? p.d : d));
    let best = null;
    for (const [lo, hi] of bands) {
        for (let k = 0; k < g.sit.length; k++) {
            if (!g.sit[k] || !Number.isFinite(g.fromStart[k]) || !Number.isFinite(g.fromGoal[k])) continue;
            if (!Number.isFinite(g.wideStart[k]) || !Number.isFinite(g.wideGoal[k])) continue;
            const detour = g.fromStart[k] + g.fromGoal[k] - g.route;
            if (detour < g.route * lo || detour > g.route * hi) continue;
            const x = g.cx(k % g.nx), z = g.cz((k / g.nx) | 0);
            if (Math.hypot(x - lv.start.x, z - lv.start.z) < 2 || Math.hypot(x - lv.goal.x, z - lv.goal.z) < 2) continue;
            if (near(x, z, lv.coins, 0.5) || near(x, z, lv.pickups, 0.6) || near(x, z, away, 1)) continue;
            const sc = score({ x, z, k, detour, g });
            if (!best || sc > best.sc + 1e-9 || (Math.abs(sc - best.sc) <= 1e-9 && detour > best.detour + 1e-9)) best = { x: +x.toFixed(2), z: +z.toFixed(2), sc, detour };
        }
        if (best) break;
    }
    return best ? { x: best.x, z: best.z, detour: best.detour * G, route: g.route * G } : null;
}
