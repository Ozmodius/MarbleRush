#!/usr/bin/env node
// PLANETILT: the shows between levels (levelShow.js).
// What they must get right:
//   1. The drop starts high, only ever falls until it lands, never goes under
//      the floor, and ends exactly at rest.
//   2. The ship's drop and pickup start off the board, hover over the spot
//      while beaming, and end off the board with the marble at rest (the
//      drop) or in the dome (the pickup); the marble is never under the floor.
//   3. Every show is short: under three seconds, so a NEXT is never a wait
//      (and START ends one at once, in mazeGame.js).
//   4. The right show for the right level: a planet's first level the ship
//      drop, floor 10 the pickup, the rest the drop, walking none.
//
// Negative control: let drop() return y = -0.1 once landed and 1 fails; make
// SHIP_PICKUP.leave 3000 and 3 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const S = await import('./levelShow.js');
    const fs = await import('fs');
    const levels = JSON.parse(fs.readFileSync('./mazeLevels.json', 'utf8')).levels;
    const step = 1000 / 60;

    // 1. the drop
    let prev = S.drop(0), fellOnly = true, under = false, landedAt = null;
    check(prev.y === S.DROP_H && !prev.landed, `the drop starts ${S.DROP_H} up: ${prev.y}`);
    for (let ms = step; ms <= S.DROP_MS + 50; ms += step) {
        const d = S.drop(ms);
        if (d.y < -1e-9) under = true;
        if (!prev.landed && !d.landed && d.y > prev.y + 1e-9) fellOnly = false;
        if (d.landed && landedAt === null) landedAt = ms;
        prev = d;
    }
    check(fellOnly, 'the drop only falls until it lands');
    check(!under, 'the drop never puts the marble under the floor');
    check(landedAt !== null && Math.abs(landedAt - S.DROP_FALL_MS) <= step, `it lands at the end of the fall (${landedAt})`);
    const end = S.drop(S.DROP_MS);
    check(end.done && end.y === 0 && end.squash === 1, `it ends exactly at rest: ${JSON.stringify(end)}`);
    check(S.DROP_LAND_SPEED > 5 && S.DROP_LAND_SPEED < 40, `a landing fast enough to thud: ${S.DROP_LAND_SPEED.toFixed(1)} u/s`);

    // 2 and 3. the ship
    for (const [name, fn, total] of [['shipDrop', S.shipDrop, S.SHIP_DROP_MS], ['shipPickup', S.shipPickup, S.SHIP_PICKUP_MS]]) {
        for (const side of [1, -1]) {
            const a = fn(0, side), z = fn(total, side);
            const off = p => Math.abs(p.x) > 9 || Math.abs(p.z) > 12;
            check(off(a.ship) && a.ship.visible, `${name}: the ship starts off the board (${JSON.stringify(a.ship)})`);
            check(off(fn(total - 1, side).ship), `${name}: and leaves off the board`);
            check(z.done && !z.ship.visible, `${name}: done and gone at ${total} ms`);
            let hovered = false, never = true;
            for (let ms = 0; ms <= total; ms += step) {
                const p = fn(ms, side);
                if (p.ball.y < -1e-9) never = false;
                if (p.beam > 0.5 && Math.hypot(p.ship.x, p.ship.z) < 1e-6 && Math.abs(p.ship.y - S.SHIP_HOVER_Y) < 0.1) hovered = true;
                if (p.beam > 0.5 && Math.hypot(p.ship.x, p.ship.z) > 1e-6) never = false;
            }
            check(hovered, `${name}: it hovers over the spot while it beams`);
            check(never, `${name}: the marble never goes under the floor, and the beam only shines from the hover`);
        }
        check(total < 3000, `${name} is over in under three seconds (${total} ms)`);
    }
    check(S.DROP_MS < 3000, 'so is the drop');
    const dropEnd = S.shipDrop(S.SHIP_DROP_MS);
    check(dropEnd.ball.y === 0 && !dropEnd.ball.inShip && dropEnd.landed, 'the ship leaves the marble at rest on the start');
    check(S.shipDrop(10).ball.inShip, 'and brings it in the dome');
    const up = S.shipPickup(S.SHIP_PICKUP_MS);
    check(up.ball.inShip && up.rise === 1, 'the pickup ends with the marble in the dome');
    check(S.shipPickup(10).ball.y === 0 && !S.shipPickup(10).ball.inShip, 'and starts with it on the exit');
    const across = { x: -3, y: 7, z: -24 };
    const crossEnd = S.shipPickup(S.SHIP_PICKUP_MS - 1, 1, across).ship;
    check(Math.abs(crossEnd.z - across.z) < 0.5 && Math.abs(crossEnd.x - across.x) < 0.5 && S.shipPickup(S.SHIP_PICKUP_MS, 1, across).done, `the pickup leaves where it is sent (${JSON.stringify(crossEnd)})`);

    // 4. which show
    const w1 = levels.filter(l => l.world === 1);
    check(S.openingShow(w1[0]) === 'shipDrop' && levels.filter(l => S.openingShow(l) === 'shipDrop').every(l => l.index % 10 === 1), 'a planet\'s first level opens with the ship');
    check(S.openingShow(w1[4]) === 'drop' && S.openingShow({ id: 'd1_01', world: 1, index: 0 }) === 'drop', 'other levels and the daily maze with the drop');
    check(S.openingShow(w1[4], { walk: true }) === null && S.closingShow(w1[9], { walk: true }) === null, 'walking has no show');
    check(levels.filter(l => S.closingShow(l) === 'shipPickup').map(l => l.id).join() === levels.filter(l => l.index % 10 === 0).map(l => l.id).join(), 'every floor 10, and only those, ends with the pickup');

    if (failures.length) {
        console.log('FAIL: level show');
        for (const f of failures) console.log(' - ' + f);
        process.exitCode = 1;
    } else {
        console.log('PASS: level show -- the drop falls to rest without going under the floor, the ship comes from off the board, beams only from its hover and leaves off it, every show is under three seconds, and each level gets its show');
    }
})();
