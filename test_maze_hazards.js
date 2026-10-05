#!/usr/bin/env node
// MARBLE MAZE: the pure hazard math (mazeHazards.js).
//
// Node-only, no browser, same rationale as test_maze_tilt.js: this is arithmetic
// that decides whether a level is fair, and it should be checkable without a
// GPU or an accelerometer.
//
// The properties that matter are not "the numbers come out right" -- they are
// the ones the VERIFIER leans on when it certifies a level as solvable:
//
//   1. A gate returns to fully open, exactly, every period. The whole soundness
//      argument for "solvable with gates open" is that waiting always works; a
//      gate that only ever reached 97% open would make that a lie.
//   2. The gate is never outside its authored travel. An overshoot would put
//      geometry somewhere BFS never looked.
//   3. Velocity is the true derivative of position, because cannon uses it to
//      push the ball and a wrong sign flings the ball the wrong way.
//   4. gateOpenSpec/gateClosedSpec really are the extremes of the motion.
//   5. The swept spec covers every position the gate ever takes.
//
// Negative control: return a constant from gateVelocity and check 3 fails;
// change gateFraction's phase term and check 1 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

(async () => {
    const H = await import('./mazeHazards.js');

    const gate = { x: -1.5, z: 2.0, w: 2.4, d: 0.3, axis: 'x', travel: 2.2, periodMs: 3000, phase: 0 };

    // --- 1. it really does reopen, exactly, forever -------------------------
    for (let k = 0; k < 6; k++) {
        check(near(H.gateFraction(gate, k * gate.periodMs), 0),
            `at t = ${k} full periods the gate must be exactly open, got ${H.gateFraction(gate, k * gate.periodMs)}`);
        check(near(H.gateFraction(gate, (k + 0.5) * gate.periodMs), 1),
            `at t = ${k}.5 periods the gate must be exactly closed, got ${H.gateFraction(gate, (k + 0.5) * gate.periodMs)}`);
    }

    // --- 2. never outside [0, travel] ---------------------------------------
    let minF = Infinity, maxF = -Infinity;
    for (let t = 0; t <= 12000; t += 7) {          // 7ms: deliberately not a divisor of the period
        const f = H.gateFraction(gate, t);
        minF = Math.min(minF, f); maxF = Math.max(maxF, f);
        const spec = H.gateSpecAt(gate, f);
        check(spec.x >= gate.x - 1e-9 && spec.x <= gate.x + gate.travel + 1e-9,
            `gate left its travel at t=${t}: x=${spec.x}, allowed [${gate.x}, ${gate.x + gate.travel}]`);
        check(near(spec.z, gate.z), `an x-axis gate must not move in z, got ${spec.z} at t=${t}`);
    }
    check(minF < 1e-6 && maxF > 1 - 1e-6,
        `the sampled sweep should reach both extremes, got [${minF}, ${maxF}]`);

    // --- 3. velocity is the derivative of position --------------------------
    // Compared against a central difference of the real position function. A
    // sign error here does not look like a bug in testing -- it looks like the
    // gate shoving the ball the wrong way, occasionally, which is exactly the
    // kind of thing that gets blamed on physics.
    const dt = 0.01;
    for (const t of [10, 250, 700, 1499, 1500, 1501, 2200, 2999]) {
        const numeric = (H.gateOffset(gate, t + dt) - H.gateOffset(gate, t - dt)) / (2 * dt) * 1000;
        const analytic = H.gateVelocity(gate, t);
        check(Math.abs(numeric - analytic) < 1e-3,
            `gateVelocity disagrees with the derivative of gateOffset at t=${t}: analytic ${analytic}, numeric ${numeric}`);
    }
    // At both extremes the gate is momentarily still -- that is what "eases to a
    // stop" means, and it is why it cannot teleport through the ball.
    check(near(H.gateVelocity(gate, 0), 0, 1e-9), 'a gate must be at rest at its open extreme');
    check(near(H.gateVelocity(gate, gate.periodMs / 2), 0, 1e-9), 'a gate must be at rest at its closed extreme');

    // --- 4. the extremes are the authored ones ------------------------------
    const open = H.gateOpenSpec(gate), closed = H.gateClosedSpec(gate);
    check(near(open.x, gate.x) && near(open.z, gate.z),
        `the OPEN spec must be the authored position -- that is what the verifier solves against. Got ${JSON.stringify(open)}`);
    check(near(closed.x, gate.x + gate.travel),
        `the CLOSED spec must be a full travel away, got ${JSON.stringify(closed)}`);

    // A z-axis gate moves in z and not in x.
    const zGate = { x: 0, z: -2, w: 0.3, d: 1.8, axis: 'z', travel: 1.5, periodMs: 2000, phase: 0.25 };
    const zClosed = H.gateClosedSpec(zGate);
    check(near(zClosed.z, zGate.z + zGate.travel) && near(zClosed.x, zGate.x),
        `a z-axis gate must travel in z only, got ${JSON.stringify(zClosed)}`);

    // --- 5. the swept spec contains every position --------------------------
    const swept = H.gateSweptSpec(gate);
    for (let t = 0; t <= 6000; t += 13) {
        const s = H.gateSpecAt(gate, H.gateFraction(gate, t));
        check(s.x - s.w / 2 >= swept.x - swept.w / 2 - 1e-9 && s.x + s.w / 2 <= swept.x + swept.w / 2 + 1e-9,
            `the swept spec must contain the gate at t=${t}`);
    }
    check(near(swept.w, gate.w + gate.travel),
        `an x-axis gate's swept width should be its own width plus its travel, got ${swept.w}`);

    // --- phase actually shifts the cycle ------------------------------------
    // Without this, a level with several gates authored at different phases
    // would have them all moving in lockstep, which reads as one wall.
    const shifted = { ...gate, phase: 0.5 };
    check(near(H.gateFraction(shifted, 0), 1),
        `phase 0.5 must invert the cycle (closed at t=0), got ${H.gateFraction(shifted, 0)}`);

    // --- ice ----------------------------------------------------------------
    const ice = [{ x: 0, z: 0, w: 4, d: 2 }];
    check(H.isOnIce(ice, 0, 0), 'the centre of an ice patch is on ice');
    check(H.isOnIce(ice, 1.99, 0.99), 'just inside the corner is on ice');
    check(!H.isOnIce(ice, 2.01, 0), 'just outside in x is not on ice');
    check(!H.isOnIce(ice, 0, 1.01), 'just outside in z is not on ice');
    check(!H.isOnIce([], 0, 0), 'no ice means never on ice');
    check(!H.isOnIce(undefined, 0, 0), 'a level with no ice field must not throw');

    check(near(H.distanceToRect(ice[0], 0, 0), 0), 'inside the rect is distance 0');
    check(near(H.distanceToRect(ice[0], 3, 0), 1), 'distance is measured to the EDGE, not the centre');
    check(near(H.distanceToRect(ice[0], 5, 4), Math.hypot(3, 3)), 'diagonal distance is to the corner');

    check(H.ICE_FRICTION > 0,
        'ice friction must not be zero -- a frictionless sphere never spins up and slides like a dead weight');
    check(H.ICE_FRICTION < 0.28, 'ice must be slipperier than the ordinary floor');

    // --- conveyors -------------------------------------------------------
    // The soundness argument (mazeHazards.js): a belt is weaker than the
    // player. Full tilt on a ROLLING solid sphere gives g*sin(tilt)*5/7 of
    // acceleration (2/7 of the push goes into spin). GRAVITY is mazeGame.js's;
    // MAX_TILT_DEG is mazeTilt.js's own.
    const T = await import('./mazeTilt.js');
    const GRAVITY = 30;
    const tiltAccel = GRAVITY * Math.sin(T.MAX_TILT_DEG * Math.PI / 180) * 5 / 7;
    check(H.CONVEYOR_MAX_ACCEL <= 0.5 * tiltAccel,
        `a belt (${H.CONVEYOR_MAX_ACCEL}) must be at most half of full tilt (${tiltAccel.toFixed(2)}), or a player driving upstream barely moves and the verifier's reachability stops being honest`);

    const belt = { x: 0, z: 0, w: 1, d: 4, dir: '+z', speed: H.CONVEYOR_MAX_SPEED };
    check(H.conveyorAt([belt], 0.4, 1.9) === belt, 'a point on the belt is on the belt');
    check(H.conveyorAt([belt], 0.6, 0) === null, 'just off the side is not on the belt');
    check(H.conveyorAt(undefined, 0, 0) === null, 'a level with no belts must not throw');

    const still = H.conveyorAccel(belt, 0, 0);
    check(near(still.ax, 0) && near(still.az, H.CONVEYOR_MAX_ACCEL), `a still ball is pushed along +z at the cap, got ${JSON.stringify(still)}`);
    const riding = H.conveyorAccel(belt, 0, H.CONVEYOR_MAX_SPEED);
    check(near(riding.az, 0), 'a ball already at belt speed feels nothing -- a belt never launches the ball past its own speed');
    const across = H.conveyorAccel(belt, 5, 0);
    check(near(across.ax, 0), 'a belt never pushes sideways');
    for (const dir of ['+x', '-x', '+z', '-z']) {
        for (const v of [-9, -1, 0, 1, 9]) {
            const a = H.conveyorAccel({ ...belt, dir }, v, -v);
            check(Math.hypot(a.ax, a.az) <= H.CONVEYOR_MAX_ACCEL + 1e-9, `belt ${dir} at v=${v} exceeds the cap`);
        }
    }
    // Drive the full length upstream at full tilt: the ball must get off the
    // far end, and in a sane time, from a standing start on the belt.
    let z = 1.9, vz = 0, t = 0;
    while (z > -2 && t < 10) {
        const a = H.conveyorAccel(belt, 0, vz).az - tiltAccel;
        vz += a / 60; z += vz / 60; t += 1 / 60;
    }
    check(z <= -2 && t < 2.5, `full tilt against a belt must cross it upstream (4 units) in under 2.5s, took ${t.toFixed(2)}s`);

    // --- wind fans ----------------------------------------------------------
    check(H.WIND_MAX_ACCEL <= 0.5 * tiltAccel,
        `wind (${H.WIND_MAX_ACCEL}) must be at most half of full tilt (${tiltAccel.toFixed(2)}): the conveyor's soundness argument`);
    const fan = { x: 0, z: 0, w: 1, d: 3, dir: '-z', periodMs: 3000, phase: 0.2 };
    let calm = 0, peak = 0, prev = H.windStrength(fan, 0), jump = 0;
    for (let t = 0; t <= 6000; t += 10) {
        const s = H.windStrength(fan, t);
        check(s >= 0 && s <= 1 + 1e-9, `gust strength out of range at ${t}: ${s}`);
        if (s === 0) calm++;
        peak = Math.max(peak, s);
        jump = Math.max(jump, Math.abs(s - prev));
        prev = s;
    }
    check(calm / 601 >= H.WIND_CALM - 0.02, `a fan must be dead calm for ${H.WIND_CALM * 100}% of each period -- the lull a player waits for`);
    check(peak > 0.99, 'a gust reaches full strength');
    check(jump < 0.05, `a gust rises and falls smoothly (largest step ${jump.toFixed(3)} per 10ms)`);
    check(H.windAt([fan], 0.4, 1.4) === fan && H.windAt([fan], 0.6, 0) === null, 'the wind zone is its rect');
    for (let t = 0; t < 3000; t += 37) {
        const a = H.windAccel(fan, t);
        check(Math.abs(a.ax) < 1e-12 && a.az <= 0 && -a.az <= H.WIND_MAX_ACCEL + 1e-9, 'wind blows only along its dir, never past the cap');
    }
    // Full tilt into the strongest gust still crosses a 3-unit zone.
    let wz = -1.5, wv = 0, wt = 0;
    while (wz < 1.5 && wt < 10) {
        wv += (tiltAccel - H.WIND_MAX_ACCEL) / 60; wz += wv / 60; wt += 1 / 60;
    }
    check(wz >= 1.5 && wt < 2.5, `full tilt against the strongest gust crosses a 3-unit zone in under 2.5s (took ${wt.toFixed(2)}s)`);

    // --- falling icicles ----------------------------------------------------
    const ic = { x: 0, z: 0, r: 0.35, periodMs: 3000, phase: 0.1 };
    const seen = new Set();
    let impactMs = 0, shakeMs = 0;
    for (let t = 0; t < 3000; t++) {
        const st = H.icicleState(ic, t);
        seen.add(st.state);
        check(st.k >= -1e-9 && st.k <= 1 + 1e-9, `icicle progress out of range at ${t}`);
        if (st.state === 'impact') impactMs++;
        if (st.state === 'shake') shakeMs++;
    }
    check(['grow', 'hang', 'shake', 'impact'].every(x => seen.has(x)), 'an icicle goes through all four states every period');
    check(Math.abs(impactMs - H.ICICLE_IMPACT_MS) <= 1, `the impact window is ${H.ICICLE_IMPACT_MS}ms, got ${impactMs}`);
    check(Math.abs(shakeMs - H.ICICLE_WARN_MS) <= 1, `the shake telegraph lasts ${H.ICICLE_WARN_MS}ms, got ${shakeMs}`);
    check(H.ICICLE_WARN_MS >= 700 && H.ICICLE_IMPACT_MS <= 400, 'warning long enough to read, impact short enough to dodge');
    // Every impact is preceded by a full shake.
    for (let t = 1; t < 9000; t++) {
        if (H.icicleState(ic, t).state === 'impact' && H.icicleState(ic, t - 1).state !== 'impact') {
            check(H.icicleState(ic, t - H.ICICLE_WARN_MS).state === 'shake' || H.icicleState(ic, t - H.ICICLE_WARN_MS).state === 'hang',
                `the impact at ${t}ms was not telegraphed for ${H.ICICLE_WARN_MS}ms`);
        }
    }
    const fi = H.firstImpactMs(ic);
    check(H.icicleState(ic, fi).state === 'impact' && H.icicleState(ic, fi - 1).state !== 'impact', `firstImpactMs (${fi}) is the first impact`);
    for (let t = 0; t < 3000; t += 7) {
        const hit = H.icicleHits([ic], t, 0.1, 0.1);
        check(!!hit === (H.icicleState(ic, t).state === 'impact'), 'an icicle hits only during its impact window');
    }
    check(!H.icicleHits([ic], fi + 10, 0.5, 0), 'an icicle hits only within its radius');

    // --- world 3: flares, molten gates, geysers ------------------------------
    const flare = { x: 0, z: 0, w: 0.4, d: 1.2, periodMs: 3000, phase: 0.3 };
    let fl = 0, warn = 0, quietRun = 0, longestQuiet = 0;
    for (let t = 0; t < 3000; t++) {
        const st = H.flareState(flare, t).state;
        if (st === 'flare') fl++;
        if (st === 'warn') warn++;
        if (st === 'quiet') { quietRun++; longestQuiet = Math.max(longestQuiet, quietRun); } else quietRun = 0;
    }
    check(Math.abs(fl - H.FLARE_MS) <= 1 && Math.abs(warn - H.FLARE_WARN_MS) <= 1, `a flare warns ${H.FLARE_WARN_MS}ms then burns ${H.FLARE_MS}ms (got ${warn}/${fl})`);
    check(H.FLARE_MIN_PERIOD - H.FLARE_WARN_MS - H.FLARE_MS >= 1000, 'a seam is quiet for at least a second each cycle -- the window to cross');
    const ff = H.firstFlareMs(flare);
    check(H.flareState(flare, ff).state === 'flare' && H.flareState(flare, ff - 1).state !== 'flare', `firstFlareMs (${ff}) is the first flare`);
    check(!!H.flareHits([flare], ff + 5, 0, 0.5, 0.3) && !H.flareHits([flare], ff + 5, 0.5, 0, 0.3) && !H.flareHits([flare], ff - 50, 0, 0, 0.3),
        'a flare burns a ball on the band, only while flaring');

    const mg = { x: 0, z: 0, w: 0.3, d: 1, axis: 'z', travel: 1, periodMs: 2000, phase: 0, molten: true };
    let burning = 0;
    for (let t = 0; t < 2000; t++) if (H.gateBurning(mg, t)) burning++;
    check(Math.abs(burning - 1000) <= 2, `a molten gate burns for the closing half of its cycle (${burning}ms of 2000)`);
    check(H.gateBurning(mg, 400) && !H.gateBurning(mg, 1400), 'burning while it closes, crusted while it opens');
    check(!H.gateBurning({ ...mg, molten: false }, 400), 'an ordinary gate never burns');
    const atClose = H.gateSpecAt(mg, H.gateFraction(mg, 400));
    check(!!H.moltenGateHits([mg], 400, atClose.x + 0.3, atClose.z, 0.28) && !H.moltenGateHits([mg], 1400, atClose.x + 0.3, atClose.z, 0.28),
        'touching a closing molten gate burns; touching it as it opens does not');

    const gy = { x: 0, z: 0, r: 0.3, reach: 1.0, periodMs: 3400, phase: 0.5 };
    const fb = H.firstBlastMs(gy);
    check(H.geyserState(gy, fb).state === 'blast' && H.geyserState(gy, fb - 1).state === 'warn', `a blast is preceded by its warning (first at ${fb}ms)`);
    const push = H.geyserAccel([gy], fb + 10, 0.3, 0);
    check(push.ax > 0 && Math.abs(push.az) < 1e-9, 'a blast pushes straight away from the vent');
    check(Math.hypot(push.ax, push.az) <= H.GEYSER_ACCEL + 1e-9, 'never harder than GEYSER_ACCEL');
    const far = H.geyserAccel([gy], fb + 10, 1.2, 0), gyCalm = H.geyserAccel([gy], fb - 200, 0.3, 0);
    check(far.ax === 0 && gyCalm.ax === 0, 'nothing beyond its reach, nothing outside the blast');
    check(H.GEYSER_ACCEL * H.GEYSER_BLAST_MS / 1000 <= 3.5, 'the most speed a blast can add stays in the range a tilt corrects within a cell');

    // --- world 4: bumpers, spring pads, spinning arms -------------------------
    const bp = { x: 0, z: 0, r: 0.16 }, BR = 0.26;
    const k1 = H.bumperKick(bp, 0.42, 0, -2, 0, BR);
    check(k1 && Math.abs(k1.vx - H.BUMPER_KICK) < 1e-9 && Math.abs(k1.vz) < 1e-9, 'a ball rolling into a bumper is kicked straight back at BUMPER_KICK');
    const k2 = H.bumperKick(bp, 0.42, 0, -8, 1, BR);
    check(k2 && Math.abs(k2.vx - 8 * H.BUMPER_BOUNCE) < 1e-9 && k2.vz === 1, 'a fast ball bounces back at BUMPER_BOUNCE of its speed, sideways speed kept');
    check(!H.bumperKick(bp, 0.6, 0, -2, 0, BR), 'no kick without touching');
    check(!H.bumperKick(bp, 0.42, 0, 4, 0, BR), 'no kick for a ball already leaving faster than one');
    const k3 = H.bumperKick(bp, 0.42, 0, -2, 0, BR, 0.5);
    check(k3 && Math.abs(k3.vx - H.BUMPER_KICK / 2) < 1e-9, 'the Obsidian Core halves the kick');
    for (const [vx, vz] of [[-1, 0], [-3, 2], [-6, -1], [0.5, 3]]) {
        const k = H.bumperKick(bp, 0.3, 0.3, vx, vz, BR);
        if (k) check(Math.hypot(k.vx, k.vz) <= Math.hypot(vx, vz) + H.BUMPER_KICK + 1e-9, 'a kick adds at most BUMPER_KICK to the speed it arrived with');
    }
    check(H.BUMPER_KICK <= 3.5, 'a kick stays in the range a tilt corrects within a cell');
    const posts = H.postSpecs({ bumpers: [bp], arms: [{ x: 1, z: 2, len: 0.9 }] });
    check(posts.length === 2 && H.inPost(posts, 0.4, 0, BR) && !H.inPost(posts, 0.3, 0.33, BR) && H.inPost(posts, 1, 2.3, BR), 'bumpers and arm hubs are solid circles to every search');

    const sp = { x: 0, z: 0, w: 0.5, d: 0.5, dir: '+z', periodMs: 3000, phase: 0.4 };
    let fire = 0, wind = 0;
    for (let t = 0; t < 3000; t++) { const st = H.springState(sp, t).state; if (st === 'fire') fire++; if (st === 'wind') wind++; }
    check(Math.abs(fire - H.SPRING_FIRE_MS) <= 1 && Math.abs(wind - H.SPRING_WARN_MS) <= 1, `a spring winds ${H.SPRING_WARN_MS}ms then fires ${H.SPRING_FIRE_MS}ms (got ${wind}/${fire})`);
    check(H.SPRING_MIN_PERIOD - H.SPRING_WARN_MS - H.SPRING_FIRE_MS >= 1500, 'a pad rests at least 1.5s each cycle -- the window to cross');
    const sf = H.firstFireMs(sp);
    check(H.springState(sp, sf).state === 'fire' && H.springState(sp, sf - 1).state === 'wind', `firstFireMs (${sf}) is the first shot, after its wind-up`);
    check(H.springShot(sp, sf) !== H.springShot(sp, sf + 3000) && H.springShot(sp, sf) === H.springShot(sp, sf + H.SPRING_FIRE_MS - 1), 'one shot number per shot');
    check(!!H.springUnder([sp], sf + 5, 0.1, 0.1, BR) && !H.springUnder([sp], sf + 5, 0.6, 0, BR) && !H.springUnder([sp], sf - 100, 0, 0, BR), 'a pad launches only a ball on it, only while firing');
    const ln = H.springLaunch(sp, 1, -2);
    check(ln.vz === H.SPRING_SPEED && ln.vx === 0.5, 'a launch sets SPRING_SPEED along dir and halves the sideways speed');
    check(H.SPRING_SPEED <= 3.5, 'a launch stays in the range a tilt corrects within a cell');

    const arm = { x: 0, z: 0, len: 0.9, periodMs: 4800, phase: 0, dir: 1 };
    check(Math.abs(H.armAngle(arm, 1200) - Math.PI / 2) < 1e-9 && Math.abs(H.armAngle({ ...arm, dir: -1 }, 1200) + Math.PI / 2) < 1e-9, 'an arm turns a quarter in a quarter period, either way');
    check(Math.abs(H.armSpin(arm) * 4.8 - 2 * Math.PI) < 1e-9, 'armSpin is the true rate of armAngle');
    check(H.armTouches(arm, 0, 0.7, 0.2, BR) && !H.armTouches(arm, 1200, 0.7, 0.2, BR) && !H.armTouches(arm, 0, 1.3, 0, BR), 'a blade touches what is beside it, not what it has turned away from or what is past its tip');
    const box = h => [{ x: 0, z: h + 0.15, w: 4, d: 0.3 }, { x: 0, z: -h - 0.15, w: 4, d: 0.3 }, { x: h + 0.15, z: 0, w: 0.3, d: 4 }, { x: -h - 0.15, z: 0, w: 0.3, d: 4 }];
    check(!H.armRoomProblem(arm, box(1.15), null, BR), 'a 0.9 arm fits a room 2.3 across');
    check(/cut through/.test(H.armRoomProblem({ ...arm, len: 1.1 }, box(1.15), null, BR) || ''), 'a blade longer than the room is refused (negative control)');
    check(/crush/.test(H.armRoomProblem({ ...arm, len: 0.3 }, box(0.55), null, BR) || ''), 'a room too tight for the ball beside the blade is refused (negative control)');

    // --- world 5: magnets, crushers, electric rails ------------------------
    check(H.MAGNET_MAX_ACCEL <= 0.5 * tiltAccel, `a magnet (${H.MAGNET_MAX_ACCEL}) must be at most half of full tilt (${tiltAccel.toFixed(2)})`);
    const mg5 = { x: 0, z: 0, nx: 0, nz: 1, reach: 1 };
    const pull = H.magnetAccel([mg5], 0, 0.4);
    check(pull.az < 0 && Math.abs(pull.ax) < 1e-12, 'a magnet pulls the ball toward itself');
    check(Math.hypot(pull.ax, pull.az) < Math.hypot(...Object.values(H.magnetAccel([mg5], 0, 0.25))), 'harder the closer you are');
    check(H.magnetAccel([mg5], 0, 1.05).az === 0, 'nothing beyond its reach');
    const two = H.magnetAccel([mg5, { ...mg5, x: 0.01 }], 0, 0.25);
    check(Math.hypot(two.ax, two.az) <= H.MAGNET_MAX_ACCEL + 1e-9, 'two overlapping fields still never pass the cap');
    // Full tilt pulls a ball off a magnet from right against it.
    let mz = 0.24, mv = 0, mt = 0;
    while (mz < 1 && mt < 5) { mv += (tiltAccel + H.magnetAccel([mg5], 0, mz).az) / 60; mz += mv / 60; mt += 1 / 60; }
    check(mz >= 1 && mt < 1.5, `full tilt pulls the ball clear of a magnet in under 1.5s (took ${mt.toFixed(2)}s)`);

    const cr = { x: 0, z: 0, w: 1, d: 0.6, periodMs: 3600, phase: 0.3 };
    const crSeen = {};
    let upRun = 0, longestUp = 0, lastB = H.crusherBottom(cr, 0), bigJump = 0;
    for (let t = 0; t < 3600; t++) {
        const st = H.crusherState(cr, t).state;
        crSeen[st] = (crSeen[st] || 0) + 1;
        if (H.crusherBottom(cr, t) >= 0.5) { upRun++; longestUp = Math.max(longestUp, upRun); } else upRun = 0;
        const b = H.crusherBottom(cr, t);
        bigJump = Math.max(bigJump, Math.abs(b - lastB)); lastB = b;
    }
    check(['up', 'warn', 'slam', 'down', 'rise'].every(k => crSeen[k] > 0), `a crusher goes up, warns, slams, sits, rises: ${JSON.stringify(crSeen)}`);
    check(Math.abs(crSeen.warn - H.CRUSH_WARN_MS) <= 1, 'it warns for CRUSH_WARN_MS before every slam');
    check(H.CRUSH_MIN_PERIOD - H.CRUSH_WARN_MS - H.CRUSH_SLAM_MS - H.CRUSH_DOWN_MS - H.CRUSH_RISE_MS >= 1000, 'a press stays up at least a second each cycle');
    check(bigJump < 0.02, `the press moves, it never teleports (largest step ${bigJump.toFixed(3)} per ms)`);
    for (let t = 0; t < 3600; t += 7) {
        const v = H.crusherVelocity(cr, t), num = (H.crusherBottom(cr, t + 0.5) - H.crusherBottom(cr, t - 0.5)) * 1000;
        const st = H.crusherState(cr, t), edge = H.crusherState(cr, t - 1).state !== st.state || H.crusherState(cr, t + 1).state !== st.state;
        if (!edge) check(Math.abs(v - num) < 0.05, `crusherVelocity is the true rate at ${t}ms (${v.toFixed(3)} vs ${num.toFixed(3)})`);
    }
    const fs = H.firstSlamMs(cr);
    check(H.crusherState(cr, fs).state === 'slam' && H.crusherState(cr, fs - 1).state === 'warn', `firstSlamMs (${fs}) is a slam, after its warning`);
    check(!H.crusherHits([cr], fs + 10, 0, 0, 0.24), 'not crushed while the press is still above the ball');
    check(!!H.crusherHits([cr], fs + 140, 0.2, 0.1, 0.24), 'crushed under it as it lands');
    check(!H.crusherHits([cr], fs + 140, 0.9, 0, 0.24), 'not crushed beside it');
    check(!H.crusherHits([cr], fs - 300, 0, 0, 0.24), 'never while up');

    const rl = { x: 0, z: 0, w: 1, d: 0.04, nx: 0, nz: 1, periodMs: 2600, phase: 0.2 };
    let live = 0, rWarn = 0;
    for (let t = 0; t < 2600; t++) { const st = H.railState(rl, t).state; if (st === 'live') live++; if (st === 'warn') rWarn++; }
    check(Math.abs(live - H.RAIL_LIVE_MS) <= 1 && Math.abs(rWarn - H.RAIL_WARN_MS) <= 1, `a rail sparks ${H.RAIL_WARN_MS}ms then is live ${H.RAIL_LIVE_MS}ms (got ${rWarn}/${live})`);
    const fl5 = H.firstLiveMs(rl);
    check(H.railState(rl, fl5).state === 'live' && H.railState(rl, fl5 - 1).state === 'warn', 'every live spell is preceded by sparks');
    check(!!H.railHits([rl], fl5 + 5, 0.3, 0.02 + 0.24 + 0.02, 0.24) && !H.railHits([rl], fl5 + 5, 0.3, 0.02 + 0.24 + 0.1, 0.24), 'a live rail shocks a ball touching its wall, not one a little off it');
    check(!H.railHits([rl], fl5 - 100, 0.3, 0.27, 0.24), 'a dead rail is just wall');
    check(!!H.inRailZone([rl], 0.3, 0.29, 0.24), 'the zone the verifier solves around is the touching band');

    if (failures.length) {
        console.error('FAIL: maze hazard math\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: maze hazard math -- gates reopen exactly every period, never leave their authored travel, carry a velocity that is the true derivative of their motion (so cannon pushes the ball rather than ejecting it), ice is a control change with no effect on reachability, conveyors and wind are always weaker than the player, icicles always telegraph and only strike briefly, toy box kicks, launches and blades are bounded, telegraphed and never pinch, and foundry magnets are weaker than the player while presses and rails always warn');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
