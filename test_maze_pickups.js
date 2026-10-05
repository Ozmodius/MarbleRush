#!/usr/bin/env node
// MARBLE MAZE: coins and power-ups (mazePickups.js).
//
// Node-only, like the tilt and hazard tests. What matters:
//   1. A coin or pickup is taken once, at the reach the renderer shows.
//   2. Magnet widens the reach for its duration, then stops.
//   3. Slow-mo slows the world and its duration ticks in REAL time, so it
//      cannot stretch itself.
//   4. A shield absorbs exactly one fall and returns the ball somewhere safe:
//      clear of holes, out of every gate's sweep, off every belt.
//   5. A bought charge fires once per unit bought; a bought shield is armed.
//   6. None of it touches the ball's radius or the level -- the verifier's
//      guarantees do not depend on power-ups (docs/PLAN.md).
//
// Negative control: drop the coinsTaken check and 1 fails (double count);
// make isSafeSpot return true and 4 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const P = await import('./mazePickups.js');
    const level = {
        start: { x: 0, z: 0 },
        holes: [{ x: 3, z: 0, r: 0.3 }],
        gates: [{ x: -3, z: 0, w: 0.3, d: 1, axis: 'z', travel: 1, periodMs: 2000, phase: 0 }],
        conveyors: [{ x: 0, z: 4, w: 1, d: 2, dir: '+z', speed: 2 }],
        coins: [{ x: 1, z: 0 }, { x: 0, z: -2 }],
        pickups: [{ x: -1, z: -1, kind: 'magnet' }, { x: 1, z: -3, kind: 'slowmo' }, { x: 0, z: -5, kind: 'nonsense' }]
    };
    const frozen = JSON.stringify(level);
    const R = 0.3;

    // 1. coins
    let s = P.createRunPickups(level);
    let ev = P.stepPickups(s, level, { x: 1 - (R + P.COIN_RADIUS) - 0.01, z: 0, r: R }, 16);
    check(!ev.length, 'a coin just out of reach is not taken');
    ev = P.stepPickups(s, level, { x: 1 - (R + P.COIN_RADIUS) + 0.01, z: 0, r: R }, 16);
    check(ev.length === 1 && ev[0].type === 'coin' && s.coins === 1, 'a coin just in reach is taken');
    ev = P.stepPickups(s, level, { x: 1, z: 0, r: R }, 16);
    check(!ev.length && s.coins === 1, 'a coin is taken once');

    // 2. magnet
    ev = P.stepPickups(s, level, { x: -1, z: -1, r: R }, 16);
    check(ev.some(e => e.type === 'pickup' && e.kind === 'magnet'), 'touching a magnet pickup fires it');
    check(s.coins === 2, `magnet should reach the coin at (0,-2) from (-1,-1), coins=${s.coins}`);
    s = P.createRunPickups(level);
    P.activate(s, 'magnet');
    P.stepPickups(s, level, { x: 0, z: 0, r: R }, P.POWERUPS.magnet.durationMs + 1);
    check(s.magnetMs === 0, 'magnet runs out');
    ev = P.stepPickups(s, level, { x: 0, z: -2 + P.POWERUPS.magnet.reach - 0.1, r: R }, 16);
    check(!ev.some(e => e.type === 'coin' && e.index === 1), 'after it runs out, reach is back to normal');

    // 3. slow-mo
    s = P.createRunPickups(level);
    check(P.timeScale(s) === 1, 'normal speed without slow-mo');
    P.activate(s, 'slowmo');
    check(P.timeScale(s) < 1, 'slow-mo slows the world');
    P.stepPickups(s, level, { x: 0, z: 0, r: R }, P.POWERUPS.slowmo.durationMs - 1);
    check(P.timeScale(s) < 1, 'still slow just before it ends');
    P.stepPickups(s, level, { x: 0, z: 0, r: R }, 2);
    check(P.timeScale(s) === 1, 'slow-mo ends after its duration in real time');
    ev = P.stepPickups(P.createRunPickups(level), level, { x: 0, z: -5, r: R }, 16);
    check(!ev.length, 'an unknown pickup kind is ignored, not fired');

    // 4. shield
    s = P.createRunPickups(level);
    check(P.absorbFall(s) === null, 'no shield, no rescue');
    P.activate(s, 'shield');
    P.stepPickups(s, level, { x: 2.5, z: 0, r: R }, 16);   // too close to the hole: not safe
    P.stepPickups(s, level, { x: -3, z: 0.5, r: R }, 16);  // in the gate's sweep: not safe
    P.stepPickups(s, level, { x: 0, z: 4, r: R }, 16);     // on the belt: not safe
    const back = P.absorbFall(s);
    check(back && back.x === 0 && back.z === 0, `the shield returns the ball to the last SAFE spot (the start here), got ${JSON.stringify(back)}`);
    check(P.absorbFall(s) === null, 'a shield absorbs one fall, not two');
    for (const [x, z] of [[2.5, 0], [-3, 0.5], [0, 4]]) check(!P.isSafeSpot(level, x, z, R), `(${x},${z}) must not count as safe`);
    check(P.isSafeSpot(level, 0, 0, R), 'open floor away from everything is safe');

    // 5. bought charges
    s = P.createRunPickups(level, { shield: 1, slowmo: 2 });
    check(s.shield, 'a bought shield is armed from the start');
    check(P.useCharge(s, 'slowmo') && P.useCharge(s, 'slowmo') && !P.useCharge(s, 'slowmo'), 'two bought slow-mos fire twice, then no more');
    check(!P.useCharge(s, 'magnet'), 'cannot fire a charge that was not bought');

    // 7. upgrades: Power Time and Coin Reach
    s = P.createRunPickups(level, {}, { durationScale: 1.6, coinReach: 0.2 });
    P.activate(s, 'slowmo');
    check(Math.abs(s.slowmoMs - P.POWERUPS.slowmo.durationMs * 1.6) < 1e-6, 'Power Time lengthens slow-mo');
    ev = P.stepPickups(s, level, { x: 1 - (R + P.COIN_RADIUS) - 0.15, z: 0, r: R }, 16);
    check(ev.some(e => e.type === 'coin'), 'Coin Reach collects from further away');
    s = P.createRunPickups(level, {}, { durationScale: 0.2, coinReach: -1 });
    check(s.durationScale === 1 && s.coinReach === 0, 'mods can only help: a bad scale or reach is ignored');

    // 6. nothing touched the level
    check(JSON.stringify(level) === frozen, 'pickups must never modify the level');

    if (failures.length) {
        console.error('FAIL: maze pickups\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: maze pickups -- coins and power-ups are taken once at the drawn reach, magnet and slow-mo run for their real-time durations, a shield absorbs one fall and returns the ball somewhere safe, bought charges fire once each, and nothing alters the level');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
