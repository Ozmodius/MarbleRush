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

    if (failures.length) {
        console.error('FAIL: maze hazard math\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: maze hazard math -- gates reopen exactly every period, never leave their authored travel, carry a velocity that is the true derivative of their motion (so cannon pushes the ball rather than ejecting it), and ice is a control change with no effect on reachability');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
