// FOREST DRESSING -- where the trees, roots and leafy branches go in a level,
// as plain numbers. No three.js, so test_forest.js checks every rule in Node;
// forest3d.js turns the result into meshes.
//
// World 1 starts in the Workshop and grows into a forest (docs/PLAN.md): each
// level carries a `blend` from 0 (workshop) to 1 (forest), and the higher it
// is, the more of its walls are rows of tree trunks instead of planks and the
// more leafy branches hang over the maze.
//
// THE PHYSICS IS UNTOUCHED: every wall still collides as its box. So, like the
// rock walls (mazeWalls3d.js), what is DRAWN is held to the box:
//   - a trunk's cross-section is an ellipse inside the wall's footprint, its
//     long axis along the wall, touching both faces; neighbouring trunks
//     overlap enough that the dip between them is at most TRUNK_INSET -- the
//     marble never visibly stops short of the bark;
//   - a ROOT may run out across the floor, but only LOW: at every point, no
//     higher than the underside of a marble pressed against the wall
//     (rootClearance), so the marble can never look like it rolls through one;
//   - a CANOPY (leafy branch) never hangs over a hole, the start, the goal or
//     any gate's sweep, with a margin for perspective (the camera is above the
//     middle of the board, so anything high appears shifted outward). It may
//     hide plain floor and coins -- the forest is meant to keep a few secrets
//     -- and it fades while the marble is under it (forest3d.js).
//
// Deterministic: the same level always grows the same forest.

export const TRUNK_INSET = 0.03;      // deepest dip between neighbouring trunks
export const CANOPY_Y = [1.15, 1.5];  // canopy centre heights
export const CANOPY_MARGIN = 0.35;    // perspective slack around a canopy disc
export const MAX_CANOPIES = 9;        // at full forest

function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// How high something may stand at `p` units out from a wall face and never
// meet the marble. The marble's centre can come no nearer the face than R (the
// collider stops it), so over a point p < R out, the LOWEST the marble's
// underside ever gets is with the marble pressed against the face: there it is
// R - sqrt(R^2 - (R - p)^2). Anywhere from R out, the marble can roll right
// over the point, so nothing may stand there at all.
export function rootClearance(p, R) {
    if (p <= 0) return Infinity;
    if (p >= R) return 0;
    return R - Math.sqrt(Math.max(0, R * R - (R - p) * (R - p)));
}

// Which walls are trees. A wall becomes a trunk row when its own hash falls
// under the level's blend, so walls convert one by one as the world goes on,
// and the same wall stays a tree in every later level that shares it... no
// two levels share walls, but the rule is stable per level and per wall.
export function wallKinds(levelId, walls, blend) {
    return walls.map((w, i) => (rng(hash(levelId + ':w' + i))() < blend ? 'trunk' : 'plank'));
}

// Trunks along one wall: ellipse centres, semi-axes and heights.
//   along = semi-axis along the wall, across = semi-axis across it (half the
//   wall's thickness, so each trunk touches both faces).
export function trunksFor(w, seed) {
    const alongX = w.w >= w.d;
    const L = alongX ? w.w : w.d, T = alongX ? w.d : w.w;
    const across = T / 2;
    const s = T * 0.62;                        // spacing between centres
    let along = s * 1.1;                       // overlap so the dip is shallow
    if (L < 2 * along) along = L / 2;
    const n = Math.max(1, Math.ceil((L - 2 * along) / s) + 1);
    const step = n > 1 ? (L - 2 * along) / (n - 1) : 0;
    const r = rng(seed);
    const out = [];
    for (let k = 0; k < n; k++) {
        const t = -L / 2 + along + k * step;
        out.push({
            x: alongX ? w.x + t : w.x, z: alongX ? w.z : w.z + t,
            along, across, alongX,
            height: 0.62 + r() * 0.5,
            lean: (r() - 0.5) * 0.08
        });
        // Trunks lean along their wall (forest3d.js); the end ones lean
        // inward, so no bark leans out past the wall's end.
        const t0 = out[out.length - 1];
        if (n === 1) t0.lean = 0;
        else if (k === 0) t0.lean = Math.abs(t0.lean);
        else if (k === n - 1) t0.lean = -Math.abs(t0.lean);
    }
    return out;
}

// The dip between two trunks, measured at the wall face: how far inside the
// face the bark surface is at the worst point along the wall.
export function trunkDip(trunks) {
    let worst = 0;
    for (let k = 0; k < trunks.length - 1; k++) {
        const a = trunks[k], b = trunks[k + 1];
        const gap = Math.hypot(b.x - a.x, b.z - a.z);
        const half = gap / 2;
        const f = Math.max(0, 1 - (half / a.along) ** 2);
        worst = Math.max(worst, a.across - a.across * Math.sqrt(f));
    }
    return worst;
}

// Distance in the floor plane from (x, z) to a wall's box (0 inside it).
export function distToBox(w, x, z) {
    const dx = Math.max(Math.abs(x - w.x) - w.w / 2, 0), dz = Math.max(Math.abs(z - w.z) - w.d / 2, 0);
    return Math.hypot(dx, dz);
}

// Roots off one trunk into the corridors either side of its wall. Each root is
// a short run of points { x, z, h, r } (h = height of the centre, r = radius),
// each held under rootClearance of its REAL distance to the wall's box -- not
// just its distance out from the face, because near a wall's end the marble
// can come round the end.
export function rootsFor(trunk, wall, R, seed) {
    const r = rng(seed);
    const out = [];
    for (const side of [-1, 1]) {
        const count = r() < 0.4 ? 1 : (r() < 0.15 ? 2 : 0);
        for (let c = 0; c < count; c++) {
            const reach = 0.05 + r() * 0.06;
            const slant = (r() - 0.5) * 1.1;
            const along = (r() - 0.5) * trunk.along;
            // Out from the face, turned by the slant.
            const nx = trunk.alongX ? 0 : side, nz = trunk.alongX ? side : 0;
            const tx = trunk.alongX ? 1 : 0, tz = trunk.alongX ? 0 : 1;
            const dx = nx * Math.cos(slant) + tx * Math.sin(slant), dz = nz * Math.cos(slant) + tz * Math.sin(slant);
            // A buttress: it leaves the trunk well up its side (inside the
            // wall's footprint, where nothing constrains it), curves down to
            // the ground at the face, and runs out low, half sunk in the dirt.
            const x0 = trunk.x + tx * along + nx * trunk.across * 0.45;
            const z0 = trunk.z + tz * along + nz * trunk.across * 0.45;
            const span = reach + trunk.across * 0.55;
            const pts = [];
            for (let i = 0; i <= 6; i++) {
                const f = i / 6;
                const x = x0 + dx * span * f;
                const z = z0 + dz * span * f;
                const room = rootClearance(distToBox(wall, x, z), R) - 0.004;   // top of root must stay under this
                let rad = 0.06 * (1 - f) + 0.014 * f;
                let h = rad * 0.55 + 0.16 * Math.max(0, 1 - f * 2.2) ** 2;
                if (h + rad > room) { rad = Math.min(rad, room / 2); h = Math.max(0, room - rad); }
                if (rad < 0.004) break;                                       // no room left: the root ends here
                pts.push({ x, z, h, r: rad });
            }
            if (pts.length >= 2) out.push(pts);
        }
    }
    return out;
}

// Leafy branches: discs over the board at canopy height, each grown from a
// trunk and reaching out over a corridor. Kept clear of every hazard the
// player must be able to see.
export function canopiesFor(lv, trunkRows, blend, R) {
    const want = Math.round(blend * MAX_CANOPIES);
    if (!want) return [];
    const r = rng(hash(lv.id + ':canopy'));
    const trunks = trunkRows.flat();
    const sweeps = (lv.gates || []).map(g => {
        const a = g.x, b = g.x + (g.axis === 'x' ? g.travel : 0);
        const c = g.z, e = g.z + (g.axis === 'z' ? g.travel : 0);
        return { x: (a + b) / 2, z: (c + e) / 2, w: Math.abs(b - a) + g.w, d: Math.abs(e - c) + g.d };
    });
    const out = [];
    for (let tries = 0; tries < want * 30 && out.length < want && trunks.length; tries++) {
        const t = trunks[Math.floor(r() * trunks.length)];
        const reach = 0.25 + r() * 0.45;
        const side = r() < 0.5 ? -1 : 1;
        const x = t.alongX ? t.x + (r() - 0.5) * 0.3 : t.x + side * reach;
        const z = t.alongX ? t.z + side * reach : t.z + (r() - 0.5) * 0.3;
        const radius = 0.55 + r() * 0.35;
        const c = { x, z, y: CANOPY_Y[0] + r() * (CANOPY_Y[1] - CANOPY_Y[0]), radius, from: { x: t.x, z: t.z, y: t.height } };
        if (canopyConflict(lv, c, sweeps, R)) continue;
        if (out.some(o => Math.hypot(o.x - c.x, o.z - c.z) < (o.radius + c.radius) * 0.9)) continue;
        out.push(c);
    }
    return out;
}

// Why a canopy may not go here, or null. Shared with test_forest.js.
export function canopyConflict(lv, c, sweeps, R) {
    const reach = c.radius + CANOPY_MARGIN;
    for (const h of lv.holes || []) if (Math.hypot(c.x - h.x, c.z - h.z) < reach + h.r + R) return 'hole';
    if (Math.hypot(c.x - lv.goal.x, c.z - lv.goal.z) < reach + lv.goal.r) return 'goal';
    if (Math.hypot(c.x - lv.start.x, c.z - lv.start.z) < reach + R) return 'start';
    for (const s of sweeps) {
        const dx = Math.max(Math.abs(c.x - s.x) - s.w / 2, 0), dz = Math.max(Math.abs(c.z - s.z) - s.d / 2, 0);
        if (Math.hypot(dx, dz) < reach) return 'gate';
    }
    for (const b of lv.conveyors || []) {
        const dx = Math.max(Math.abs(c.x - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(c.z - b.z) - b.d / 2, 0);
        if (Math.hypot(dx, dz) < reach) return 'conveyor';
    }
    return null;
}

// Everything for a level: `walls` is every wall the renderer draws (the
// level's own plus the boundary rails), `blend` 0..1.
export function forestFor(lv, walls, blend) {
    const b = Math.max(0, Math.min(1, Number(blend) || 0));
    const kinds = wallKinds(lv.id, walls, b);
    const rows = walls.map((w, i) => (kinds[i] === 'trunk' ? trunksFor(w, hash(lv.id + ':t' + i)) : []));
    const roots = rows.map((row, i) => row.map((t, k) => rootsFor(t, walls[i], lv.ballRadius, hash(lv.id + ':r' + i + ':' + k))));
    const canopies = canopiesFor(lv, rows, b, lv.ballRadius);
    return { blend: b, kinds, rows, roots, canopies };
}
