#!/usr/bin/env node
// Mixed reality's numbers (xrMath.js): the board's size and place on the
// table, the rig that scales the player, and grab-and-tilt read in
// mazeTilt.js's own convention. The feel is judged on the user's headset;
// this holds the geometry and the signs, which a wrong guess would flip.
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

(async () => {
    const THREE = await import('three');
    const X = await import('./xrMath.js');
    const T = await import('./mazeTilt.js');
    const levels = require('./mazeLevels.json').levels;

    // --- size: a table board, never past XR_BOARD_LONG_MAX ---------------
    check(near(X.boardScale({ w: 9, d: 14 }), X.XR_BOARD_SCALE), 'a 9 x 14 board is drawn at the table scale');
    for (const lv of levels) {
        const s = X.boardScale(lv.size);
        const long = Math.max(lv.size.w, lv.size.d) * s;
        check(long <= X.XR_BOARD_LONG_MAX + 1e-9, `${lv.id}: its long side is ${long.toFixed(3)} m, over ${X.XR_BOARD_LONG_MAX}`);
        check(lv.ballRadius * 2 * s >= 0.012, `${lv.id}: the marble is ${(lv.ballRadius * 2 * s * 100).toFixed(2)} cm across -- too small to follow`);
    }

    // --- place: ahead of the eyes, under them, facing the same way ---------
    const head = { x: 0.2, y: 1.6, z: 0.1 };
    const ident = { x: 0, y: 0, z: 0, w: 1 };
    const depth = 14 * X.XR_BOARD_SCALE;
    const p = X.placeBoard(head, ident, depth);
    check(near(p.x, 0.2) && near(p.z, 0.1 - (X.XR_NEAR_EDGE_M + depth / 2)) && near(p.y, 1.6 - X.XR_DROP_M) && near(p.yaw, 0),
        `facing -z, the board sits straight ahead, its near edge ${X.XR_NEAR_EDGE_M} m off and its floor ${X.XR_DROP_M} m under the eyes: ${JSON.stringify(p)}`);
    // Looking down at it changes nothing about where it goes.
    const down = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.7, 0, 0));
    const pd = X.placeBoard(head, down, depth);
    check(near(pd.x, p.x, 1e-9) && near(pd.z, p.z, 1e-9) && near(pd.yaw, 0, 1e-9), `the head's pitch does not move the board: ${JSON.stringify(pd)}`);
    // Turned 90 degrees left, the board is to the left (-x), its far edge away.
    const left = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const pl = X.placeBoard(head, left, depth);
    check(pl.x < head.x - 0.3 && near(pl.z, head.z, 1e-9) && near(pl.yaw, Math.PI / 2, 1e-9), `turned left, the board goes left and faces that way: ${JSON.stringify(pl)}`);
    // A seated player or a tall one: the table height stays a table's.
    check(X.placeBoard({ x: 0, y: 0.9, z: 0 }, ident, depth).y === X.XR_TABLE_MIN_M && X.placeBoard({ x: 0, y: 2.2, z: 0 }, ident, depth).y === X.XR_TABLE_MAX_M,
        'the board never goes under a coffee table or over a standing desk');

    // --- rig: the room seen through it puts the level where it was placed --
    const s = X.boardScale({ w: 9, d: 14 });
    const rig = X.rigMatrix(pl, s), board = X.boardMatrix(pl, s);
    const centre = new THREE.Vector3(0, 0, 0).applyMatrix4(board);
    check(near(centre.x, pl.x) && near(centre.y, pl.y) && near(centre.z, pl.z), 'the level\'s centre lands on the placed spot');
    const farEdge = new THREE.Vector3(0, 0, -7).applyMatrix4(board);
    check(farEdge.x < centre.x - 0.2, 'turned left, the level\'s far edge points further left (away from the player)');
    const back = centre.clone().applyMatrix4(rig);
    check(back.length() < 1e-9, 'the rig maps the placed spot back to the level\'s centre');
    const metre = new THREE.Vector3(pl.x, pl.y + 1, pl.z).applyMatrix4(rig);
    check(near(metre.y, 1 / s, 1e-6), `a metre in the room is ${(1 / s).toFixed(1)} level units: the player is scaled, not the board`);

    // --- grab and tilt: mazeTilt's signs ------------------------------------
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.4, 0.2));   // any grip at all
    const turn = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(axis, deg * Math.PI / 180).multiply(q0);
    const X_ = new THREE.Vector3(1, 0, 0), Y_ = new THREE.Vector3(0, 1, 0), Z_ = new THREE.Vector3(0, 0, 1);
    const still = X.grabTilt(q0, q0.clone());
    check(near(still.beta, 0, 1e-6) && near(still.gamma, 0, 1e-6), 'a hand held still leans nothing');
    // Rolling the wrist clockwise (as the player sees it) dips the right edge.
    const right = X.grabTilt(q0, turn(Z_, -20));
    check(near(right.gamma, 20, 1e-6) && near(right.beta, 0, 1e-6), `a clockwise roll is a positive gamma (the ball rolls right): ${JSON.stringify(right)}`);
    check(T.tiltToGravity(right.beta, right.gamma).x > 0, 'and its gravity pulls toward +x');
    // Tipping the hand's front down dips the far edge: the ball rolls away.
    const away = X.grabTilt(q0, turn(X_, -15));
    check(near(away.beta, -15, 1e-6) && near(away.gamma, 0, 1e-6), `the front tipped down is a negative beta: ${JSON.stringify(away)}`);
    check(T.tiltToGravity(away.beta, away.gamma).z < 0, 'and its gravity pulls toward -z, the far edge');
    // Turning the hand about the vertical moves nothing.
    const spin = X.grabTilt(q0, turn(Y_, 70));
    check(near(spin.beta, 0, 1e-6) && near(spin.gamma, 0, 1e-6), `a turn about the vertical leans nothing: ${JSON.stringify(spin)}`);
    // Past the cap it is still capped downstream (mazeTilt clamps).
    const far = X.grabTilt(q0, turn(Z_, -80));
    check(T.computeTilt(far, { beta: 0, gamma: 0 }, null).tilt.gamma === T.MAX_TILT_DEG, 'a wild roll is clamped at MAX_TILT_DEG like any reading');

    // --- feel: knocks from the physics, a hole's thud the strongest ---------
    check(X.pulseFor('hit', 0.3) === null, 'a marble rolling along a wall buzzes nothing');
    const soft = X.pulseFor('hit', 1.2), hard = X.pulseFor('hit', 5), full = X.pulseFor('hit', 40);
    check(soft && hard && soft.intensity < hard.intensity && soft.ms < hard.ms && full.intensity <= 1, `a harder knock is a stronger, longer pulse: ${JSON.stringify([soft, hard, full])}`);
    check(['fall', 'bumper', 'shield', 'coin', 'win'].every(k => X.pulseFor(k)), 'a fall, a bumper, a shield, a coin and the clear are each felt');
    check(X.pulseFor('fall').intensity >= Math.max(full.intensity, X.pulseFor('bumper').intensity), 'nothing is felt harder than going down a hole');
    check(X.pulseFor('coin').intensity < soft.intensity, 'a coin is a tick, softer than any knock');

    // --- the real table ------------------------------------------------------
    check(X.tableHeight([0, 0.74], 1.6) === 0.74, 'under the planned spot: the table, not the floor');
    check(X.tableHeight([0, 0.74, 1.55], 1.6) === 0.74, 'a surface near eye height (a shelf) is not the table');
    check(X.tableHeight([0, 0.1], 1.6) === null && X.tableHeight([], 1.6) === null, 'only floor under it: no table, the head-height rule stands');
    check(X.tableHeight([0.45], 1.2) === 0.45, 'seated at a coffee table: it counts');
    const on = X.placeOnSurface({ x: 0.3, y: 0.72, z: -0.6 }, { x: 0, y: 1.6, z: 0 });
    check(near(on.x, 0.3) && near(on.z, -0.6) && near(on.y, 0.72 + X.XR_TABLE_LIFT_M), `pointed at a surface, the board centres on it, just above: ${JSON.stringify(on)}`);
    const farEdge2 = new THREE.Vector3(0, 0, -7).applyMatrix4(X.boardMatrix(on, X.XR_BOARD_SCALE));
    check(Math.hypot(farEdge2.x, farEdge2.z) > Math.hypot(on.x, on.z), 'and its far edge points away from the player');

    if (failures.length) { console.log('FAIL: xr'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
    console.log('PASS: xr -- the board is table-sized and placed ahead of and under the eyes, facing the player; the rig scales the player, not the level; grab and tilt read in mazeTilt\'s signs; knocks felt from the physics, a hole the hardest; the board finds the real table, not the floor or a shelf');
})().catch(e => { console.error(e); process.exit(1); });
