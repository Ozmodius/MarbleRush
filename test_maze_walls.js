#!/usr/bin/env node
// MARBLE MAZE: the drawn walls agree with the walls the marble hits.
//
// Physics collides with boxes; a theme may draw rock instead (mazeWalls3d.js).
// The verifier certifies levels against the boxes, so a rock wall cannot make
// a level unfair -- but it can make one LOOK unfair, and that is checked here
// the same way levels are: by measurement, not by eye.
//
//   1. No vertex of any wall, rail or gate leaves its collider's footprint.
//      Rock poking into a corridor would show the marble rolling through stone.
//   2. Below the marble's reach (its radius), every vertex sits within
//      SIDE_INSET of a collider face -- plus the geometric give of a rounded
//      upright corner. Deeper and the marble visibly stops short of the rock.
//   3. The foot of every wall is on the floor (no floating rock, no gap).
//   4. 'box' still draws exactly the box it always did.
//   5. Building twice gives identical geometry: a level's rock is seeded, not
//      rerolled per load.
//   6. Every theme names a style and patterns the renderer knows.
//
// Run over every level, with the rock settings pushed to the largest bevel and
// jag any theme uses, so a theme cannot be tuned past what was checked.
//
// Negative control: drop the `- nx * sink` sign to `+` in mazeWalls3d.js and
// check 1 fails; multiply SIDE_INSET's use in the sink by 5 and check 2 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
const DATA = require('./mazeLevels.json');
const WALL_HEIGHT = 0.55; // mazeGame.js
const EPS = 1e-4;

(async () => {
    const W = await import('./mazeWalls3d.js');
    const { MAZE_THEMES } = await import('./mazeThemes.js');
    const S = await import('./mazeSurface3d.js');
    const levels = Array.isArray(DATA) ? DATA : DATA.levels;

    // --- 6. theme vocabulary -------------------------------------------------
    for (const t of Object.values(MAZE_THEMES)) {
        if (t.wallStyle !== undefined) check(W.WALL_STYLES.includes(t.wallStyle), `theme ${t.id}: unknown wallStyle '${t.wallStyle}'`);
        if (t.floorPattern !== undefined) check(S.FLOOR_PATTERNS.includes(t.floorPattern), `theme ${t.id}: unknown floorPattern '${t.floorPattern}'`);
        if (t.wallPattern !== undefined) check(S.WALL_PATTERNS.includes(t.wallPattern), `theme ${t.id}: unknown wallPattern '${t.wallPattern}'`);
    }
    const rockThemes = Object.values(MAZE_THEMES).filter(t => t.wallStyle === 'rock');
    const bevel = Math.max(0.07, ...rockThemes.map(t => t.wallBevel || 0));
    const jag = Math.max(0.06, ...rockThemes.map(t => t.wallJag || 0));

    function railsFor(lv) {
        const hw = lv.size.w / 2, hd = lv.size.d / 2, t = 0.4; // mazeGame.js boundaryRails
        return [
            { x: 0, z: -hd - t / 2, w: lv.size.w + t * 2, d: t },
            { x: 0, z: hd + t / 2, w: lv.size.w + t * 2, d: t },
            { x: -hw - t / 2, z: 0, w: t, d: lv.size.d },
            { x: hw + t / 2, z: 0, w: t, d: lv.size.d }
        ];
    }

    // Measure one wall drawn on its own, so a failure names the wall.
    function measure(spec, opts, tag) {
        const geo = W.buildWallGeometry([spec], opts);
        const p = geo.getAttribute('position').array;
        const hx = spec.w / 2, hz = spec.d / 2;
        const r = Math.min(bevel, spec.w * 0.45, spec.d * 0.45);
        const cornerGive = r * (1 - Math.SQRT1_2);
        let worstOut = 0, worstSink = 0, minY = Infinity, onFloor = 0;
        for (let i = 0; i < p.length; i += 3) {
            const lx = p[i] - spec.x, y = p[i + 1], lz = p[i + 2] - spec.z;
            worstOut = Math.max(worstOut, Math.abs(lx) - hx, Math.abs(lz) - hz);
            minY = Math.min(minY, y);
            if (y < EPS) onFloor++;
            if (y <= opts.reach) {
                const sink = Math.min(hx - Math.abs(lx), hz - Math.abs(lz));
                worstSink = Math.max(worstSink, sink);
            }
        }
        check(worstOut <= EPS, `${tag}: drawn rock pokes ${worstOut.toFixed(4)} past its collider`);
        if (opts.style === 'rock') {
            check(worstSink <= W.SIDE_INSET + cornerGive + EPS,
                `${tag}: below the marble's reach a face sinks ${worstSink.toFixed(4)} inside its collider (limit ${(W.SIDE_INSET + cornerGive).toFixed(4)})`);
        } else {
            check(worstSink <= EPS, `${tag}: a 'box' wall must sit exactly on its collider, sinks ${worstSink.toFixed(4)}`);
        }
        check(Math.abs(minY) <= EPS && onFloor >= 4, `${tag}: the wall's foot must stand on the floor (lowest y ${minY.toFixed(4)})`);
        return p;
    }

    let walls = 0;
    for (const lv of levels) {
        const specs = lv.walls.concat(railsFor(lv));
        const gateSpecs = (lv.gates || []).map(g => ({ x: 0, z: 0, w: g.w, d: g.d }));
        for (const style of ['box', 'rock']) {
            const opts = { height: WALL_HEIGHT, reach: lv.ballRadius, style, bevel, jag };
            specs.forEach((s, i) => { measure(s, opts, `${lv.id} ${style} wall ${i}`); walls++; });
            gateSpecs.forEach((s, i) => measure(s, { ...opts, seed: i + 1 }, `${lv.id} ${style} gate ${i}`));
        }
        // 5. determinism over the whole merged level
        const a = W.buildWallGeometry(specs, { height: WALL_HEIGHT, reach: lv.ballRadius, style: 'rock' });
        const b = W.buildWallGeometry(specs, { height: WALL_HEIGHT, reach: lv.ballRadius, style: 'rock' });
        const pa = a.getAttribute('position').array, pb = b.getAttribute('position').array;
        check(pa.length === pb.length && pa.every((v, i) => v === pb[i]), `${lv.id}: rock walls differ between two builds`);
    }

    // 4. 'box' is the box: four corners at floor and top on each face, nothing else.
    const box = W.buildWallGeometry([{ x: 1, z: 2, w: 3, d: 0.4 }], { height: WALL_HEIGHT, style: 'box' });
    check(box.getAttribute('position').count === 20, `'box' should be 5 quads (no bottom), got ${box.getAttribute('position').count} vertices`);

    if (failures.length) {
        console.error('FAIL: maze wall geometry\n - ' + failures.slice(0, 40).join('\n - ')
            + (failures.length > 40 ? `\n ... and ${failures.length - 40} more` : ''));
        process.exitCode = 1;
    } else {
        console.log(`PASS: maze wall geometry -- ${walls} walls across ${levels.length} levels, box and rock: no drawn rock leaves its collider, faces hold within ${W.SIDE_INSET} of it below the marble's reach, every foot is on the floor, and rock is seeded`);
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
