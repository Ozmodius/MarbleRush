// SECRET POCKETS (the user's call, 2026-10-10): on two floors of each planet a
// dead end is hidden behind a wall that only LOOKS solid -- drawn like every
// other wall, with no collider -- and at its far end lies a page of Baron Von
// Ratchet's diary. Roll through the wall to find it; a page is banked by a
// clear (like coins) and kept (`diary` in the save, merged by union).
//
// The physics never changes: the false wall has no body, so every route,
// every verifier guarantee and every gold time stand as they were. What it
// hides is worked out from the level itself (levelSpots.js), never stored in
// mazeLevels.json:
//   - a page spot deep in a dead end, off the way to the exit, clear of
//     every trap, reachable at the real size and 50% wider;
//   - a corridor on the way to it, between two walls, where a wall across
//     it would cut the dead end off -- and nothing but the dead end: never
//     the start, the exit, the fuel cell or a cage;
//   - the false wall itself, an axis-aligned box spanning that corridor
//     wall face to wall face, as thick as the level's walls.
// test_pockets.js checks all of that with its own search.
//
// pocketFor(lv) -> { wall: { x, z, w, d }, page: { x, z }, cells } or null.

import { levelGrid, G } from './levelSpots.js';
import { fuelSpot } from './fuel.js';
import { captiveSpot, isRescueLevel } from './rescue.js';
import { isSafeSpot } from './mazePickups.js';

export const PAGE_REACH = 0.42;
// Which floors of a planet hold a pocket: tried in order, the first two that
// have one (a level with no fit dead end is skipped for the next).
const FLOOR_ORDER = [3, 7, 4, 6, 8, 2, 5, 9];

function boundary(lv) {
    const hw = lv.size.w / 2, hd = lv.size.d / 2, t = 0.4;
    return [
        { x: 0, z: -hd - t / 2, w: lv.size.w + t * 2, d: t },
        { x: 0, z: hd + t / 2, w: lv.size.w + t * 2, d: t },
        { x: -hw - t / 2, z: 0, w: t, d: lv.size.d },
        { x: hw + t / 2, z: 0, w: t, d: lv.size.d }
    ];
}
const inRect = (x, z, w, m = 0) => Math.abs(x - w.x) <= w.w / 2 + m && Math.abs(z - w.z) <= w.d / 2 + m;

// From (x, z), the distance along (dx, dz) to the first wall face (or Infinity).
function rayToWall(walls, x, z, dx, dz, max = 3) {
    for (let t = 0; t <= max; t += 0.02) if (walls.some(w => inRect(x + dx * t, z + dz * t, w))) return t;
    return Infinity;
}

// The cells a ball's centre could not cross if `box` were solid.
function blockedBy(g, box, r) {
    const out = new Set();
    const i0 = g.ci(box.x - box.w / 2 - r), i1 = g.ci(box.x + box.w / 2 + r);
    const j0 = g.cj(box.z - box.d / 2 - r), j1 = g.cj(box.z + box.d / 2 + r);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const x = g.cx(i), z = g.cz(j);
        if (Math.abs(x - box.x) < box.w / 2 + r && Math.abs(z - box.z) < box.d / 2 + r) out.add(i + j * g.nx);
    }
    return out;
}

// What lies behind `box`: the cells reachable from the start now, but not
// with the box solid.
function behind(g, box, r) {
    const block = blockedBy(g, box, r);
    const seen = new Uint8Array(g.pass.length);
    const q = [g.s];
    seen[g.s] = 1;
    for (let k = 0; k < q.length; k++) {
        const c = q[k], i = c % g.nx, j = (c / g.nx) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const a = i + di, b = j + dj;
            if (a < 0 || b < 0 || a >= g.nx || b >= g.nz) continue;
            const n = a + b * g.nx;
            if (seen[n] || !g.pass[n] || block.has(n)) continue;
            seen[n] = 1; q.push(n);
        }
    }
    const region = [];
    for (let k = 0; k < g.pass.length; k++) if (g.pass[k] && Number.isFinite(g.fromStart[k]) && !seen[k] && !block.has(k)) region.push(k);
    return { region, seen };
}

function findPocket(lv) {
    const g = levelGrid(lv);
    if (!Number.isFinite(g.route)) return null;
    const r = lv.ballRadius;
    const walls = (lv.walls || []).concat(boundary(lv));
    const thick = Math.min(0.3, Math.max(0.25, ...(lv.walls || []).map(w => Math.min(w.w, w.d))));
    const fuel = fuelSpot(lv), cage = isRescueLevel(lv) ? captiveSpot(lv) : null;
    const keep = [lv.start, lv.goal, ...(fuel ? [fuel] : []), ...(cage ? [cage] : [])];
    let reachable = 0;
    for (let k = 0; k < g.pass.length; k++) if (g.pass[k] && Number.isFinite(g.fromStart[k])) reachable++;
    // Page candidates: deep dead-end cells, deepest first.
    const cands = [];
    for (let k = 0; k < g.sit.length; k++) {
        if (!g.sit[k] || !Number.isFinite(g.fromStart[k]) || !Number.isFinite(g.wideStart[k]) || !Number.isFinite(g.wideGoal[k])) continue;
        const detour = g.fromStart[k] + g.fromGoal[k] - g.route;
        if (detour < g.route * 0.2) continue;
        const p = g.at(k);
        if (keep.some(q => Math.hypot(p.x - q.x, p.z - q.z) < 2)) continue;
        if ((lv.coins || []).some(c => Math.hypot(p.x - c.x, p.z - c.z) < 0.5) || (lv.pickups || []).some(c => Math.hypot(p.x - c.x, p.z - c.z) < 0.6)) continue;
        cands.push({ k, detour });
    }
    cands.sort((a, b) => b.detour - a.detour || a.k - b.k);
    const tried = new Set();
    for (const { k: pk } of cands.slice(0, 400)) {
        // The way from the page back to the start, cell by cell.
        const path = [pk];
        let k = pk, guard = 0;
        while (k !== g.s && guard++ < 20000) {
            const i = k % g.nx, j = (k / g.nx) | 0;
            let best = k;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const a = i + di, b = j + dj;
                if (a < 0 || b < 0 || a >= g.nx || b >= g.nz) continue;
                const q = a + b * g.nx;
                if (g.pass[q] && g.fromStart[q] < g.fromStart[best]) best = q;
            }
            if (best === k) break;
            path.push(best);
            k = best;
        }
        const P = g.at(pk);
        // Mouths: from the far side (nearest the route) inward, every 0.1.
        for (let t = path.length - 1; t >= 2; t--) {
            const m = path[t];
            if (tried.has(m)) continue;
            tried.add(m);
            const M = g.at(m);
            if (Math.hypot(M.x - P.x, M.z - P.z) < 1.2) break;           // the pocket must have depth
            const a = g.at(path[t - 2]), b = g.at(path[Math.min(path.length - 1, t + 2)]);
            const along = Math.abs(a.x - b.x) >= Math.abs(a.z - b.z) ? 'x' : 'z';
            // Across the corridor (perpendicular to travel): wall face to wall face.
            const [px, pz] = along === 'x' ? [0, 1] : [1, 0];
            const s1 = rayToWall(walls, M.x, M.z, px, pz), s2 = rayToWall(walls, M.x, M.z, -px, -pz);
            if (!Number.isFinite(s1) || !Number.isFinite(s2)) continue;
            const width = s1 + s2;
            if (width < 2 * r + 0.1 || width > 1.8) continue;
            const cAcross = (s1 - s2) / 2;
            const box = along === 'x'
                ? { x: +M.x.toFixed(3), z: +(M.z + cAcross).toFixed(3), w: thick, d: +width.toFixed(3) }
                : { x: +(M.x + cAcross).toFixed(3), z: +M.z.toFixed(3), w: +width.toFixed(3), d: thick };
            // Its ends must sit flush against walls along their whole
            // thickness (a wall ending at a corner would show daylight).
            // (Travelling along x, the wall spans z, and the reverse.)
            const flush = (along === 'x'
                ? [box.z - box.d / 2 - 0.05, box.z + box.d / 2 + 0.05].flatMap(z => [-0.45, 0, 0.45].map(f => [box.x + f * box.w, z]))
                : [box.x - box.w / 2 - 0.05, box.x + box.w / 2 + 0.05].flatMap(x => [-0.45, 0, 0.45].map(f => [x, box.z + f * box.d])))
                .every(([x, z]) => walls.some(w => inRect(x, z, w)));
            if (!flush) continue;
            // Nothing that matters under the false wall.
            const nearBox = (q, m2) => inRect(q.x, q.z, box, m2);
            if ([...keep].some(q => nearBox(q, 1.0))) continue;
            if ((lv.holes || []).some(h => nearBox(h, h.r + 0.1)) || (lv.coins || []).some(c => nearBox(c, 0.3)) || (lv.pickups || []).some(c => nearBox(c, 0.4))) continue;
            if (!isSafeSpot(lv, box.x, box.z, r)) continue;
            const { region, seen } = behind(g, box, r);
            if (!region.length || region.length > reachable * 0.15 || region.length * G * G < 1.0) continue;
            // The page is behind it; the start, exit, fuel and cage are not.
            const inRegion = new Set(region);
            if (!inRegion.has(pk)) continue;
            if (!seen[g.e] || keep.some(q => inRegion.has(g.cell(q.x, q.z)))) continue;
            return { wall: box, page: { x: +P.x.toFixed(2), z: +P.z.toFixed(2) }, cells: region.length };
        }
    }
    return null;
}

// Which levels hold a pocket: by floor order, the first two of each planet
// that fit. Worked out from the levels (pocketLevels below), and written down
// here only so a level start need not search a planet's floors to know --
// test_pockets.js recomputes it and fails if this ever disagrees.
export const POCKET_LEVELS = ['w1_07', 'w1_08', 'w2_04', 'w2_06', 'w3_03', 'w3_07', 'w4_03', 'w4_07', 'w5_07', 'w5_06'];
export const isPocketLevel = (lv) => !!lv && POCKET_LEVELS.includes(lv.id);

const byLevel = new Map();
// The pocket on a pocket level (null on any other).
export function pocketOn(lv) { return isPocketLevel(lv) ? pocketFor(lv) : null; }
export function pocketFor(lv) {
    if (!lv || !/^w\d+_\d+$/.test(String(lv.id))) return null;
    if (byLevel.has(lv.id)) return byLevel.get(lv.id);
    const out = findPocket(lv);
    byLevel.set(lv.id, out);
    return out;
}
export function pocketLevels(levels, world) {
    const lvls = levels.filter(l => l.world === world);
    const out = [];
    for (const f of FLOOR_ORDER) {
        const lv = lvls.find(l => l.index === (world - 1) * 10 + f);
        if (lv && pocketFor(lv)) out.push(lv.id);
        if (out.length === 2) break;
    }
    return out;
}
