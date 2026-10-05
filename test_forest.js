#!/usr/bin/env node
// MARBLE RUSH: the forest dressing keeps faith with the physics
// (forestDressing.js). Walls still collide as boxes; this checks what is DRAWN
// in their place, on every level, at no forest, half forest and full forest.
//
//   1. Every trunk sits inside its wall's footprint, touching both faces.
//   2. Between neighbouring trunks the bark dips at most TRUNK_INSET inside
//      the face: the marble never visibly stops short of a tree.
//   3. Every root point stays under rootClearance of its distance to the wall
//      box: no marble, wherever it rolls, passes through a root.
//   4. No canopy hangs over a hole, the start, the goal, a gate's sweep or a
//      belt (canopyConflict, plus perspective margin); never more than
//      MAX_CANOPIES; none at blend 0.
//   5. Converting is monotone: a wall that is a tree at some blend is a tree
//      at every higher blend, so the forest only ever grows through a world.
//   6. Deterministic: the same level grows the same forest twice.
//
// Negative control: set the spacing factor in trunksFor to 0.9 and 2 fails;
// remove the `room` clamp in rootsFor and raise the root height term from
// 0.035 to 0.4, and 3 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
const DATA = require('./mazeLevels.json');

function railsFor(lv) {
    const hw = lv.size.w / 2, hd = lv.size.d / 2, t = 0.4;   // mazeGame.js boundaryRails
    return [
        { x: 0, z: -hd - t / 2, w: lv.size.w + t * 2, d: t }, { x: 0, z: hd + t / 2, w: lv.size.w + t * 2, d: t },
        { x: -hw - t / 2, z: 0, w: t, d: lv.size.d }, { x: hw + t / 2, z: 0, w: t, d: lv.size.d }
    ];
}

(async () => {
    const F = await import('./forestDressing.js');
    let trunks = 0, roots = 0, canopies = 0;
    for (const lv of DATA.levels) {
        const walls = lv.walls.concat(railsFor(lv));
        const R = lv.ballRadius;
        for (const blend of [0, 0.5, 1]) {
            const f = F.forestFor(lv, walls, blend);
            const tag = `${lv.id} @${blend}`;
            if (blend === 0) check(f.rows.every(r => !r.length) && !f.canopies.length, `${tag}: no forest at blend 0`);

            f.rows.forEach((row, i) => {
                const w = walls[i];
                const alongX = w.w >= w.d, L = alongX ? w.w : w.d, T = alongX ? w.d : w.w;
                for (const t of row) {
                    trunks++;
                    const off = alongX ? t.x - w.x : t.z - w.z;
                    const side = alongX ? t.z - w.z : t.x - w.x;
                    check(Math.abs(side) < 1e-9 && Math.abs(t.across - T / 2) < 1e-9, `${tag} wall ${i}: trunk must sit on the wall's axis and touch both faces`);
                    check(Math.abs(off) + t.along <= L / 2 + 1e-9, `${tag} wall ${i}: trunk reaches past the wall's end`);
                }
                if (row.length > 1) check(F.trunkDip(row) <= F.TRUNK_INSET + 1e-9, `${tag} wall ${i}: bark dips ${F.trunkDip(row).toFixed(3)} between trunks (limit ${F.TRUNK_INSET})`);
                f.roots[i].forEach(perTrunk => perTrunk.forEach(root => {
                    roots++;
                    for (const p of root) {
                        const d = F.distToBox(w, p.x, p.z);
                        check(p.h + p.r <= F.rootClearance(d, R) + 1e-9,
                            `${tag} wall ${i}: a root at ${d.toFixed(3)} from the wall stands ${(p.h + p.r).toFixed(3)} high, above the marble's underside there (${F.rootClearance(d, R).toFixed(3)})`);
                        check(p.h >= -1e-9, `${tag} wall ${i}: a root's centre is below the floor (roots may sit half sunk, not buried)`);
                    }
                }));
            });

            const sweeps = (lv.gates || []).map(g => {
                const a = g.x, b = g.x + (g.axis === 'x' ? g.travel : 0), c = g.z, e = g.z + (g.axis === 'z' ? g.travel : 0);
                return { x: (a + b) / 2, z: (c + e) / 2, w: Math.abs(b - a) + g.w, d: Math.abs(e - c) + g.d };
            });
            check(f.canopies.length <= F.MAX_CANOPIES, `${tag}: ${f.canopies.length} canopies, more than ${F.MAX_CANOPIES}`);
            for (const c of f.canopies) {
                canopies++;
                const why = F.canopyConflict(lv, c, sweeps, R);
                check(!why, `${tag}: a canopy at (${c.x.toFixed(2)},${c.z.toFixed(2)}) hangs over the ${why}`);
            }

            const again = F.forestFor(lv, walls, blend);
            check(JSON.stringify(again) === JSON.stringify(f), `${tag}: the forest differs between two builds`);
        }
        const k1 = F.wallKinds(lv.id, walls, 0.3), k2 = F.wallKinds(lv.id, walls, 0.7);
        check(k1.every((k, i) => k === 'plank' || k2[i] === 'trunk'), `${lv.id}: a tree at blend 0.3 must still be a tree at 0.7`);
    }
    // The clearance curve itself.
    check(F.rootClearance(0.001, 0.3) > 0.27 && F.rootClearance(0.3, 0.3) === 0, 'rootClearance: full height at the face, none from one radius out');

    if (failures.length) {
        console.error('FAIL: forest dressing\n - ' + failures.slice(0, 30).join('\n - ') + (failures.length > 30 ? `\n ... and ${failures.length - 30} more` : ''));
        process.exitCode = 1;
    } else {
        console.log(`PASS: forest dressing -- ${trunks} trunks inside their walls with dips under ${F.TRUNK_INSET}, ${roots} roots all under the marble, ${canopies} canopies clear of every hazard, monotone and seeded`);
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
