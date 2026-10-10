#!/usr/bin/env node
// PLANETILT: the rescue (rescue.js) -- the captive on each planet's floor 10.
// What it must get right:
//   1. Every world with a captive has one floor-10 level, and only that
//      level is a rescue level.
//   2. Each cage spot is clear of every trap (the shield's own safe-spot
//      rule), away from the start, the exit, coins and power-ups.
//   3. It is reachable: an independent search (finer grid, its own
//      clearances) finds a way from the start to the cage and on to the exit
//      at the real ball size (round the holes), and for a ball 50% wider
//      through the walls, as every level is checked (test_maze_levels.js).
//   4. It is hidden: getting it is a real detour, off the start-to-exit way,
//      but never more than the route itself.
//   5. It is deterministic, and the story's words name the right friend.
//
// Negative control: return the start as the spot and 2 and 4 fail; drop the
// isSafeSpot test from rescue.js's grid and 2 fails on the trap worlds.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const fs = await import('fs');
    const R = await import('./rescue.js');
    const P = await import('./mazePickups.js');
    const C = await import('./shopCatalog.js');
    const levels = JSON.parse(fs.readFileSync('./mazeLevels.json', 'utf8')).levels;
    const worlds = [...new Set(levels.map(l => l.world))];

    // An independent passability search: 0.05 grid, ball centre clear of walls
    // by the ball radius and of every hole's edge.
    // At 1.5x the ball, as test_maze_levels.js's fit check: walls only.
    function reach(lv, from, to, scale) {
        const r = lv.ballRadius * scale, W = lv.size.w, D = lv.size.d, G = 0.05;
        const nx = Math.ceil(W / G), nz = Math.ceil(D / G);
        const cx = i => -W / 2 + (i + 0.5) * G, cz = j => -D / 2 + (j + 0.5) * G;
        const ok = (x, z) => Math.abs(x) <= W / 2 - r && Math.abs(z) <= D / 2 - r
            && !lv.walls.some(w => Math.abs(x - w.x) < w.w / 2 + r && Math.abs(z - w.z) < w.d / 2 + r)
            && (scale > 1 || (lv.holes || []).every(h => Math.hypot(x - h.x, z - h.z) > h.r));
        const idx = (x, z) => Math.max(0, Math.min(nx - 1, Math.floor((x + W / 2) / G))) + Math.max(0, Math.min(nz - 1, Math.floor((z + D / 2) / G))) * nx;
        const pass = new Uint8Array(nx * nz);
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) pass[i + j * nx] = ok(cx(i), cz(j)) ? 1 : 0;
        const s = idx(from.x, from.z), t = idx(to.x, to.z);
        pass[s] = 1; pass[t] = 1;
        const dist = new Int32Array(nx * nz).fill(-1);
        dist[s] = 0;
        const q = [s];
        for (let k = 0; k < q.length; k++) {
            const c = q[k], i = c % nx, j = (c / nx) | 0;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const a = i + di, b = j + dj;
                if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
                const n = a + b * nx;
                if (!pass[n] || dist[n] >= 0) continue;
                dist[n] = dist[c] + 1; q.push(n);
            }
        }
        return dist[t] >= 0 ? dist[t] * G : Infinity;
    }

    // 1. which levels
    const rescueLevels = levels.filter(l => R.isRescueLevel(l));
    for (const w of worlds) {
        const cap = R.captiveFor(w);
        const here = rescueLevels.filter(l => l.world === w);
        if (cap) check(here.length === 1 && here[0].index === (w - 1) * 10 + 10, `world ${w}: one rescue level, its floor 10 (got ${here.map(l => l.id)})`);
        else check(here.length === 0, `world ${w} has no captive, so no rescue level`);
    }
    check(R.captiveSpot(levels[0]) === null && R.captiveSpot(levels.find(l => l.index === 9)) === null, 'a level that is not a floor 10 has no cage');
    // Every friend is held somewhere, and every held friend is a rescue-only marble.
    const friends = C.MARBLE_IDS.filter(id => C.MARBLES[id].rescue);
    check(friends.length === 5 && friends.every(id => R.captiveFor(C.MARBLES[id].rescue).id === id && !(C.MARBLES[id].price > 0)),
        `five friends, one per world, none for sale: ${friends}`);

    for (const lv of rescueLevels) {
        const s = R.captiveSpot(lv);
        const name = `${lv.id} (${R.captiveFor(lv.world).name})`;
        check(!!s, `${name}: a cage spot exists`);
        if (!s) continue;
        // 2. safe and apart
        check(P.isSafeSpot(lv, s.x, s.z, lv.ballRadius), `${name}: the cage is clear of every trap at (${s.x}, ${s.z})`);
        check(Math.hypot(s.x - lv.start.x, s.z - lv.start.z) >= 2 && Math.hypot(s.x - lv.goal.x, s.z - lv.goal.z) >= 2, `${name}: away from the start and the exit`);
        check((lv.coins || []).every(c => Math.hypot(s.x - c.x, s.z - c.z) >= 0.5) && (lv.pickups || []).every(p => Math.hypot(s.x - p.x, s.z - p.z) >= 0.6), `${name}: not on a coin or power-up`);
        // 3. reachable, at the real size and 50% wider
        for (const scale of [1, 1.5]) {
            const there = reach(lv, lv.start, s, scale), back = reach(lv, s, lv.goal, scale);
            check(Number.isFinite(there) && Number.isFinite(back), `${name}: a ball ${scale === 1 ? '' : '50% wider '}can reach the cage and then the exit (${there}, ${back})`);
        }
        // 4. hidden: a real detour, never more than the route
        const route = reach(lv, lv.start, lv.goal, 1);
        const via = reach(lv, lv.start, s, 1) + reach(lv, s, lv.goal, 1);
        check(via - route >= route * 0.1 && via - route <= route * 1.0, `${name}: the cage is a detour (route ${route.toFixed(1)}, via the cage ${via.toFixed(1)})`);
        // 5. deterministic
        const again = R.captiveSpot(JSON.parse(JSON.stringify(lv)));
        check(again && again.x === s.x && again.z === s.z, `${name}: the same spot every time`);
        // The words
        const card = R.storyCard(lv.world, true);
        const cap = R.captiveFor(lv.world).name;
        check(card && card.lines.some(l => l.includes(cap)) && card.lines.some(l => l.includes(R.VILLAIN)) && card.go.includes(cap.toUpperCase()), `${name}: the story names ${cap} and the Baron`);
        check(R.readyLine(lv.world).includes(cap.toUpperCase()) && R.lockedLine(lv.world).includes(cap.toUpperCase()), `${name}: the ready and locked lines name ${cap}`);
    }

    // The voices: the Baron on planets 2-5, each friend naming the next planet
    // (or, the last, that all are free), floor 9 naming the friend ahead.
    const W = await import('./worlds.js');
    check(R.baronLine(1) === '' && [2, 3, 4, 5].every(w => R.baronLine(w).startsWith('BARON: ')), 'the Baron taunts on planets 2 to 5, not on a new player\'s first screen');
    for (const w of [1, 2, 3, 4]) {
        const next = R.captiveFor(w + 1);
        const line = R.friendLine(w);
        check(line.startsWith(R.captiveFor(w).name.toUpperCase() + ': ') && (line.includes(W.worldName(w + 1).toUpperCase()) || line.includes(next.name.toUpperCase())), `world ${w}'s friend points the way on: ${line}`);
    }
    check(/ALL FREE/.test(R.friendLine(5)), `the last friend says they are all free: ${R.friendLine(5)}`);
    check([1, 2, 3, 4, 5].every(w => R.nearLine(w).includes(R.captiveFor(w).name.toUpperCase())), 'floor 9 names the friend ahead');

    if (failures.length) {
        console.log('FAIL: rescue');
        for (const f of failures) console.log(' - ' + f);
        process.exitCode = 1;
    } else {
        console.log('PASS: rescue -- one captive per world on its floor 10, each cage clear of every trap and of the start, exit, coins and power-ups, reachable at the real size and 50% wider, a real detour off the route, the same every time, and named right in the story');
    }
})();
