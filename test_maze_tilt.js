#!/usr/bin/env node
// MARBLE MAZE: unit tests for the tilt math (mazeTilt.js).
//
// This exists because the tilt pipeline is the one part of the maze that
// CANNOT be verified where it runs. The sandbox has no accelerometer, headless
// Chromium never fires deviceorientation, and "does leaning left move the ball
// left" is not something a screenshot can answer. So every decision that turns
// two raw Euler angles into a gravity vector lives in a module that imports
// nothing and is checked here, in plain Node.
//
// The cases below are the ones that bite in the field rather than a
// line-coverage sweep:
//   - the ±180 wrap on beta, which turns a 2-degree movement into a full-tilt
//     lurch the wrong way if you subtract naively;
//   - the deadzone edge, where zeroing instead of subtracting makes the ball
//     jump from stationary to moving;
//   - screen rotation, which silently inverts the controls;
//   - gravity magnitude, which must not change with tilt or the friction model
//     stops behaving like a ball on a slope;
//   - frame-rate independence of the smoothing, so a 120Hz phone and a 60Hz
//     phone play the same game.
//
// Negative control: revert angleDelta to `to - from` and the wrap tests fail;
// make applyDeadzoneAndClamp zero-below-threshold and the continuity test fails.

const fs = require('fs');
const path = require('path');

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

async function run() {
    const T = await import(require('url').pathToFileURL(path.join(__dirname, 'mazeTilt.js')).href);

    // --- angleDelta: the ±180 wrap --------------------------------------------
    check(near(T.angleDelta(10, 15), 5), `angleDelta(10,15) should be 5, got ${T.angleDelta(10, 15)}`);
    check(near(T.angleDelta(15, 10), -5), `angleDelta(15,10) should be -5, got ${T.angleDelta(15, 10)}`);
    // Neutral captured at 179, device now reads -179: a 2-degree real movement.
    // Naive subtraction gives -358 -- a full-deflection lurch the wrong way.
    check(near(T.angleDelta(179, -179), 2),
        `angleDelta(179,-179) must take the short way round (2), got ${T.angleDelta(179, -179)} -- naive subtraction gives -358`);
    check(near(T.angleDelta(-179, 179), -2),
        `angleDelta(-179,179) should be -2, got ${T.angleDelta(-179, 179)}`);
    check(Math.abs(T.angleDelta(0, 180)) === 180, 'angleDelta(0,180) should be exactly ±180');

    // --- captureNeutral -------------------------------------------------------
    const n0 = T.captureNeutral(12.5, -3.25);
    check(n0.beta === 12.5 && n0.gamma === -3.25, 'captureNeutral should store the reading verbatim');
    const nBad = T.captureNeutral(undefined, NaN);
    check(nBad.beta === 0 && nBad.gamma === 0, 'captureNeutral must coerce non-finite readings to 0, not propagate NaN into gravity');

    // --- orientToScreen -------------------------------------------------------
    let s = T.orientToScreen(10, 4, 0);
    check(s.beta === 10 && s.gamma === 4, 'screenAngle 0 must pass axes through unchanged');
    s = T.orientToScreen(10, 4, 90);
    check(s.beta === -4 && s.gamma === 10, `screenAngle 90 should rotate the axis pair, got ${JSON.stringify(s)}`);
    s = T.orientToScreen(10, 4, 180);
    check(s.beta === -10 && s.gamma === -4, `screenAngle 180 should invert both, got ${JSON.stringify(s)}`);
    s = T.orientToScreen(10, 4, 270);
    check(s.beta === 4 && s.gamma === -10, `screenAngle 270 should rotate the other way, got ${JSON.stringify(s)}`);
    s = T.orientToScreen(10, 4, 45);   // never emitted by real hardware
    check(s.beta === 10 && s.gamma === 4, 'an unexpected screen angle must fall back to pass-through, not garbage');

    // --- deadzone + clamp -----------------------------------------------------
    check(T.applyDeadzoneAndClamp(0) === 0, 'zero tilt is zero');
    check(T.applyDeadzoneAndClamp(T.DEADZONE_DEG * 0.5) === 0, 'inside the deadzone must produce no output');
    check(T.applyDeadzoneAndClamp(-T.DEADZONE_DEG * 0.5) === 0, 'the deadzone is symmetric');
    // Continuity: just past the deadzone must be near zero, NOT a jump to
    // deadzone-sized output. This is the difference between a marble that eases
    // into motion and one that snaps.
    const justPast = T.applyDeadzoneAndClamp(T.DEADZONE_DEG + 0.01);
    check(justPast > 0 && justPast < 0.05,
        `output just past the deadzone should rise from ~0 (got ${justPast}) -- a jump here means the deadzone zeroes instead of subtracting`);
    check(T.applyDeadzoneAndClamp(1000) === T.MAX_TILT_DEG, 'huge tilt clamps to MAX_TILT_DEG');
    check(T.applyDeadzoneAndClamp(-1000) === -T.MAX_TILT_DEG, 'clamping is symmetric');
    check(T.applyDeadzoneAndClamp(NaN) === 0, 'a NaN reading must not reach the physics');
    // Sensitivity scales the response and is itself clamped.
    const at1 = T.applyDeadzoneAndClamp(6, 1.0);
    const at2 = T.applyDeadzoneAndClamp(6, 2.0);
    check(at2 > at1, 'higher sensitivity must produce more deflection for the same lean');
    check(T.applyDeadzoneAndClamp(6, 99) === T.applyDeadzoneAndClamp(6, T.MAX_SENSITIVITY),
        'an out-of-range sensitivity must clamp, not scale without limit');

    // --- smoothing ------------------------------------------------------------
    let v = 0;
    for (let i = 0; i < 200; i++) v = T.smoothTilt(v, 10);
    check(near(v, 10, 1e-3), `smoothTilt must converge on its target, got ${v}`);
    check(T.smoothTilt(undefined, 7) === 7, 'a missing previous value should snap to the target, not produce NaN');
    // Frame-rate independence: the same elapsed wall time must produce the same
    // result whether it arrived as one long frame or several short ones.
    let a = 0; a = T.smoothTilt(a, 10, 1000 / 15);            // one 66ms frame
    let b = 0; for (let i = 0; i < 4; i++) b = T.smoothTilt(b, 10, 1000 / 60);  // four 16ms frames
    check(Math.abs(a - b) < 0.35,
        `smoothing must be frame-rate independent: 1x66ms gave ${a.toFixed(3)}, 4x16ms gave ${b.toFixed(3)}`);

    // --- tilt -> gravity ------------------------------------------------------
    const G = 30;
    let g = T.tiltToGravity(0, 0, G);
    check(near(g.x, 0) && near(g.z, 0) && near(g.y, -G), `flat should be straight down, got ${JSON.stringify(g)}`);
    // Magnitude is preserved at every tilt -- gravity ROTATES, it is not a
    // horizontal force added to a constant downward one. Without this the ball
    // accelerates sideways without pressing less into the floor, which reads as
    // wind and breaks the friction model.
    for (const [beta, gamma] of [[0, 0], [10, 0], [0, 10], [25, 25], [-25, 25], [25, -25]]) {
        const v2 = T.tiltToGravity(beta, gamma, G);
        const mag = Math.hypot(v2.x, v2.y, v2.z);
        check(near(mag, G, 1e-6), `gravity magnitude must stay ${G} at tilt (${beta},${gamma}), got ${mag}`);
        check(v2.y <= 0, `gravity must never point upward, got y=${v2.y} at (${beta},${gamma})`);
    }
    // Direction: +gamma (right edge dips) rolls +x; +beta rolls +z (toward the
    // player). These signs are the contract mazeGame.js's board axes rely on.
    g = T.tiltToGravity(0, 10, G);
    check(g.x > 0 && near(g.z, 0), `+gamma must push +x, got ${JSON.stringify(g)}`);
    g = T.tiltToGravity(10, 0, G);
    check(g.z > 0 && near(g.x, 0), `+beta must push +z, got ${JSON.stringify(g)}`);
    g = T.tiltToGravity(-10, -10, G);
    check(g.x < 0 && g.z < 0, `negative tilt must push negative on both axes, got ${JSON.stringify(g)}`);

    // --- full pipeline --------------------------------------------------------
    const neutral = T.captureNeutral(40, -12);   // phone held at a comfortable angle
    // Holding perfectly still at the captured pose must produce NO movement,
    // whatever that pose was. This is the whole point of calibration.
    const still = T.computeTilt({ beta: 40, gamma: -12 }, neutral, null, { g: G });
    check(near(still.gravity.x, 0) && near(still.gravity.z, 0),
        `holding still at the neutral pose must produce flat gravity, got ${JSON.stringify(still.gravity)}`);
    check(near(still.gravity.y, -G), 'flat gravity should be full magnitude downward');
    // Leaning right from that same pose moves +x.
    const lean = T.computeTilt({ beta: 40, gamma: 2 }, neutral, null, { g: G });
    check(lean.gravity.x > 0, `leaning right of neutral must push +x, got ${lean.gravity.x}`);
    // A rotated screen must not inject a phantom lean: neutral and reading are
    // both corrected, so identical readings still mean "no movement".
    const rotStill = T.computeTilt({ beta: 40, gamma: -12 }, neutral, null, { screenAngle: 90, g: G });
    check(near(rotStill.gravity.x, 0) && near(rotStill.gravity.z, 0),
        `a rotated screen must not create movement from a still device, got ${JSON.stringify(rotStill.gravity)}`);

    // The sensitivity slider's clamp (Ball Smack's settings.js) is not part of
    // Planetilt yet; when the game gets its own settings module, pin its
    // clamp to T.MIN_SENSITIVITY / T.MAX_SENSITIVITY here.

    if (failures.length) {
        console.error('FAIL: maze tilt math\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: maze tilt math -- angle wrap, deadzone continuity, screen-rotation correction, clamping, frame-rate-independent smoothing, and gravity that rotates at constant magnitude');
    }
}

run().catch(e => { console.error(e); process.exitCode = 1; });
