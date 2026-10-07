#!/usr/bin/env node
// PLANETILT: the Labyrinth (walkMode.js; progressStore.js walk rules).
//   1. Facing and moving: forward/right/yaw agree, diagonals are not faster.
//   2. Walking out-pulls every trap: the walker's acceleration beats the
//      strongest push a trap is allowed (half of full tilt), so it can always
//      walk against one -- the soundness argument the traps were built on.
//      Every marble and upgrade keeps that, on ice too, and none walks
//      faster: they change how hard it drives and stops, never top speed.
//   3. The walker is the ball: no walk setting touches the ball's radius.
//   4. Walks are paid once (half the first-clear pay + coins, then the gold
//      bonus), only for levels already rolled, never under minMs; medals use
//      the walk par.
//   5. Explorer kit is bought once; comfort settings stay in range; all of it
//      round-trips.
//
// Negative control: drop WALK.accel below the half-tilt push and 2 fails;
// drop HANDLING.minDrive to 8 and the weakest-drive check fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

(async () => {
    const W = await import('./walkMode.js');
    const S = await import('./progressStore.js');
    const C = await import('./shopCatalog.js');
    const T = await import('./mazeTilt.js');

    // 1. facing
    check(near(W.forwardOf(0).x, 0) && near(W.forwardOf(0).z, -1), 'yaw 0 faces -z (up the board)');
    check(near(W.rightOf(0).x, 1) && near(W.rightOf(0).z, 0), 'right of yaw 0 is +x');
    check(near(W.forwardOf(Math.PI / 2).x, -1), 'a positive yaw turns left');
    for (const [bx, bz] of [[3, 0], [-2, 5], [0, -4], [1, 1]]) {
        const f = W.forwardOf(W.yawToward(0, 0, bx, bz)), l = Math.hypot(bx, bz);
        check(near(f.x, bx / l, 1e-9) && near(f.z, bz / l, 1e-9), `yawToward faces (${bx},${bz})`);
    }
    const diag = W.wantedVelocity({ fwd: 1, strafe: 1 }, 0.7);
    check(near(Math.hypot(diag.x, diag.z), C.WALK.speed, 1e-9), 'a diagonal walks no faster than straight');
    const still = W.wantedVelocity({ fwd: 0, strafe: 0 }, 1.3);
    check(still.x === 0 && still.z === 0, 'no input, no walking');

    // 2. out-pulling the traps
    const tiltAccel = 30 * Math.sin(T.MAX_TILT_DEG * Math.PI / 180) * 5 / 7;
    check(C.WALK.accel > tiltAccel / 2 * 2, `walk accel ${C.WALK.accel} beats twice the strongest trap push (${(tiltAccel / 2).toFixed(2)})`);
    // Walking straight into a push of half tilt from standstill still makes headway.
    let v = { x: 0, z: 0 };
    const dt = 1 / 120, push = tiltAccel / 2;
    for (let i = 0; i < 240; i++) {
        const want = W.wantedVelocity({ fwd: 1, strafe: 0 }, 0);   // toward -z
        const imp = W.walkImpulse(v, want, dt);
        v = { x: v.x + imp.x, z: v.z + imp.z + push * dt };         // the push shoves +z
    }
    check(v.z < -C.WALK.speed * 0.5, `walking into the strongest push still moves forward (vz ${v.z.toFixed(2)})`);
    const imp = W.walkImpulse({ x: 0, z: 0 }, { x: 100, z: 0 }, 0.1);
    check(near(Math.hypot(imp.x, imp.z), C.WALK.accel * 0.1, 1e-9), 'one step never changes velocity by more than accel x dt');
    // 2b. The marble's handling (walkHandling): every marble and every upgrade
    // still out-pulls the strongest trap -- on ice too -- and none walks
    // faster. Classic drives at the tuned WALK.accel.
    const H = W.walkHandling, MAXPUSH = tiltAccel / 2;
    check(H(C.ballSetup('classic', {})).drive === C.WALK.accel && H(C.ballSetup('classic', {})).brake === C.WALK.accel && H(null).drive === C.WALK.accel,
        'Classic walks exactly as Explore was tuned');
    let weakest = Infinity;
    for (const id of C.MARBLE_IDS) for (let g = 0; g <= 3; g++) for (let b = 0; b <= 3; b++) {
        const h = H(C.ballSetup(id, { grip: g, brakes: b }));
        for (const ice of [false, true]) weakest = Math.min(weakest, W.handlingAccel(h, { x: 1, z: 0 }, ice));
        check(h.drive <= W.HANDLING.maxDrive && h.brake <= W.HANDLING.maxBrake, `${id} g${g} b${b}: handling stays in range`);
    }
    check(weakest > 2 * MAXPUSH, `the weakest drive anywhere (${weakest.toFixed(1)}) still beats twice the strongest trap push (${(2 * MAXPUSH).toFixed(2)})`);
    // Top speed is the same for every marble: drive only says how fast it gets there.
    for (const id of C.MARBLE_IDS) {
        const h = H(C.ballSetup(id, { grip: 3, brakes: 3 }));
        let u = { x: 0, z: 0 };
        for (let i = 0; i < 600; i++) { const want = W.wantedVelocity({ fwd: 1, strafe: 0 }, 0); const st = W.walkImpulse(u, want, 1 / 120, W.handlingAccel(h, want, false)); u = { x: u.x + st.x, z: u.z + st.z }; }
        check(Math.hypot(u.x, u.z) <= C.WALK.speed + 1e-9, `${id} with every upgrade tops out at walking pace (${Math.hypot(u.x, u.z).toFixed(3)})`);
    }
    const drive = (id, up = {}) => H(C.ballSetup(id, up)).drive, brake = (id, up = {}) => H(C.ballSetup(id, up)).brake;
    check(drive('rubber') > drive('classic') && drive('classic', { grip: 2 }) > drive('classic') && drive('classic', { grip: 3 }) > drive('classic', { grip: 1 }),
        'Rubber and the Grip upgrade drive harder (tighter turns)');
    check(brake('steel') > brake('classic') && brake('classic', { brakes: 1 }) > brake('classic') && brake('steel', { brakes: 3 }) > brake('steel'),
        'Steel and the Air Brake stop sooner');
    check(H(C.ballSetup('glass')).response > 1 && H(C.ballSetup('steel')).response < 1, 'Glass answers a shorter stick drag, Steel a longer one');
    const hc = H(C.ballSetup('classic'));
    check(W.handlingAccel(hc, { x: 0, z: 0 }, true) < W.handlingAccel(hc, { x: 0, z: 0 }, false) / 4, 'on ice, letting go slides on');
    check(W.handlingAccel(H(C.ballSetup('rubber', { grip: 3 })), { x: 1, z: 0 }, true) === W.HANDLING.minDrive, 'on ice no marble grips better than any other');
    // The stick: a Glass marble reaches full speed with a shorter drag.
    const inp = W.createWalkInput({ active: () => false });
    const half = inp.stickMove(40, 0).strafe;
    inp.setResponse(1.35);
    check(inp.stickMove(40, 0).strafe > half && inp.stickMove(500, 0).strafe === 1, 'response shortens the drag for full speed, never past full');
    check(W.clampPitch(5) === W.PITCH_MAX && W.clampPitch(-5) === -W.PITCH_MAX, 'pitch is clamped');
    const lp = W.lookPoint({ x: 1, y: 0.4, z: 2 }, 0, 0);
    check(near(lp.x, 1) && near(lp.y, 0.4) && near(lp.z, 1), 'looking level at yaw 0 looks one unit up the board');

    // Every level starts facing open floor at least a corridor's width long.
    const ALL = require('./mazeLevels.json').levels;
    for (const lv of ALL) {
        const y = W.openingYaw(lv), f = W.forwardOf(y);
        const step = lv.ballRadius * 1.5;
        const x = lv.start.x + f.x * step, z = lv.start.z + f.z * step;
        const inWall = (lv.walls || []).some(wl => Math.abs(x - wl.x) < wl.w / 2 + lv.ballRadius && Math.abs(z - wl.z) < wl.d / 2 + lv.ballRadius);
        check(!inWall && Math.abs(x) < lv.size.w / 2 && Math.abs(z) < lv.size.d / 2, `${lv.id}: the walk starts facing open floor`);
    }

    // Third person: behind the walker and above the wall tops, looking at it.
    for (const yaw of [0, 1, 2.5, -2]) {
        const tp = W.thirdPersonPose({ x: 1, y: 0.3, z: 2 }, yaw, 0);
        const F = W.forwardOf(yaw);
        const back = (1 - tp.eye.x) * F.x + (2 - tp.eye.z) * F.z;
        check(back > 1 && tp.eye.y > 0.55 + 0.3, `third person sits behind (${back.toFixed(2)}) and above the walls (${tp.eye.y.toFixed(2)}) at yaw ${yaw}`);
        check((tp.look.x - 1) * F.x + (tp.look.z - 2) * F.z > 0, 'and looks on past the walker');
    }
    const low = W.thirdPersonPose({ x: 0, y: 0.3, z: 0 }, 0, 0.9), high = W.thirdPersonPose({ x: 0, y: 0.3, z: 0 }, 0, -0.9);
    check(high.eye.y > low.eye.y && low.eye.y > 0.55, 'looking down raises the camera, looking up lowers it -- never below the walls');

    // 3. the walker is the ball
    check(!('radius' in C.WALK) && !('ball' in C.WALK), 'walking never changes the ball radius');
    check(W.EYE_ABOVE_CENTRE + 0.32 < 0.55, 'the eye sits below the wall tops on the biggest ball (0.32): no seeing over walls');

    // 4. walk pay
    const levels = [{ id: 'w1_01', world: 1, index: 1, minMs: 2500, goldMs: 10000, coins: [{}, {}, {}] }];
    const payouts = { goldBonusPct: 0.2, byWorld: { 1: 120 } };
    let p = S.freshProgress();
    check(S.applyWalkClear(p, levels, payouts, 'w1_01', 20000, 0).result.reason === 'not-rolled', 'only a level cleared by rolling can be walked');
    p = S.applyClear(p, levels, payouts, 'w1_01', 12000, 0).progress;
    const w0 = p.wallet;
    check(S.applyWalkClear(p, levels, payouts, 'w1_01', 1000, 0).result.reason === 'too-fast', 'no walk under minMs');
    check(S.walkGoldMs(levels[0]) === 11000, `the walk par is ${C.WALK.parShare} x gold`);
    let r = S.applyWalkClear(p, levels, payouts, 'w1_01', 14000, 2);
    check(r.result.accepted && r.result.firstClear && r.result.tier === 'silver' && r.result.earned === 60 + 2, `the first walk pays half the first-clear pay plus coins: ${JSON.stringify(r.result)}`);
    check(r.progress.wallet === w0 + 62 && r.progress.walks.w1_01.bestMs === 14000 && p.walks.w1_01 === undefined, 'saved as a walk, input untouched');
    check(r.progress.cleared.w1_01.bestMs === 12000, 'a walk never touches the rolling best');
    p = r.progress;
    r = S.applyWalkClear(p, levels, payouts, 'w1_01', 10900, 3);
    check(r.result.tier === 'gold' && r.result.goldFirst && r.result.earned === 24 + 1, `a walk gold pays the gold bonus and the new coin: ${r.result.earned}`);
    p = r.progress;
    r = S.applyWalkClear(p, levels, payouts, 'w1_01', 10800, 3);
    check(r.result.earned === 0 && r.result.bestMs === 10800, 'a replay pays nothing more but keeps a better time');
    const nm = S.nearMiss(levels[0], 11400, 11400, S.walkGoldMs(levels[0]));
    check(nm && nm.tier === 'gold' && nm.gapMs === 400, 'the near miss measures a walk against the walk par');

    // 5. explorer and comfort
    let e = { ...S.freshProgress(), wallet: 1000 };
    const b1 = S.buyExplorer(e, 'compass');
    check(b1.ok && b1.progress.explorer.includes('compass') && b1.progress.wallet === 1000 - C.EXPLORER.compass.price, 'the compass is bought');
    check(S.buyExplorer(b1.progress, 'compass').reason === 'owned' && S.buyExplorer(b1.progress, 'map').reason === 'short', 'once, and only if affordable');
    const cf = S.setComfort(e, { fov: 500, sens: -3, invertY: 'yes', bob: true, junk: 1 }).progress.comfort;
    check(cf.fov === C.COMFORT.fov.max && cf.sens === C.COMFORT.sens.min && cf.invertY === false && cf.bob === true && !('junk' in cf), `comfort settings are kept in range: ${JSON.stringify(cf)}`);
    const back = S.parseProgress(JSON.stringify({ ...b1.progress, walks: { w1_01: { bestMs: 9000, coins: 2, gold: true }, bad: { bestMs: 'x' } }, explorer: ['compass', 'compass', 'jetpack'], comfort: { fov: 80 } }));
    check(back.comfort.thirdPerson === true && S.cleanComfort({ thirdPerson: false }).thirdPerson === false, 'third person is the default view, and first person is kept');
    check(back.walks.w1_01.bestMs === 9000 && !back.walks.bad && back.explorer.join() === 'compass' && back.comfort.fov === 80 && back.comfort.vignette === true,
        `walks, kit and comfort round-trip, junk dropped: ${JSON.stringify([back.walks, back.explorer, back.comfort])}`);

    if (failures.length) {
        console.error('FAIL: walk\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: walk -- facing and moving agree, the walker out-pulls every trap, the eye stays below the walls, walks pay once against their own par for rolled levels only, explorer kit and comfort settings behave and round-trip');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
