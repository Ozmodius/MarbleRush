#!/usr/bin/env node
// PLANETILT: fuel cells (fuel.js) -- one hidden in every ladder level, and the
// ship needing a planet's cells to fly on.
//   1. Every ladder level has a cell, clear of every trap and of the start,
//      exit, coins, power-ups and a floor 10's cage.
//   2. It is reachable: an independent search (finer grid, its own
//      clearances) finds a way from the start to the cell and on to the exit,
//      at the real ball size round the holes, and 50% wider through the walls.
//   3. It is a real detour (a dead end off the route), deterministic.
//   4. The launch gate: 3 of Sawturn's cells for Slipstonia, 5 of
//      Slipstonia's for Magmars, 7 for every planet after; only a planet's
//      first level is gated, a planet already played on stays open, and the
//      progress store's unlock rule (isUnlocked) honours it.
//
// Negative control: return the start as the spot and 1 and 3 fail; make
// launchNeed(2) 2 and 4 fails.
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
(async () => {
    const fs = await import('fs');
    const F = await import('./fuel.js');
    const R = await import('./rescue.js');
    const P = await import('./mazePickups.js');
    const S = await import('./progressStore.js');
    const levels = JSON.parse(fs.readFileSync('./mazeLevels.json', 'utf8')).levels;
    const daily = JSON.parse(fs.readFileSync('./dailyLevels.json', 'utf8')).levels;

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

    let total = 0, minRatio = Infinity;
    for (const lv of levels) {
        const s = F.fuelSpot(lv);
        check(!!s, `${lv.id}: a fuel cell spot exists`);
        if (!s) continue;
        total++;
        check(P.isSafeSpot(lv, s.x, s.z, lv.ballRadius), `${lv.id}: the cell is clear of every trap (${s.x}, ${s.z})`);
        check(Math.hypot(s.x - lv.start.x, s.z - lv.start.z) >= 2 && Math.hypot(s.x - lv.goal.x, s.z - lv.goal.z) >= 2, `${lv.id}: away from the start and the exit`);
        check((lv.coins || []).every(c => Math.hypot(s.x - c.x, s.z - c.z) >= 0.5) && (lv.pickups || []).every(p => Math.hypot(s.x - p.x, s.z - p.z) >= 0.6), `${lv.id}: not on a coin or power-up`);
        const cage = R.captiveSpot(lv);
        if (cage) check(Math.hypot(s.x - cage.x, s.z - cage.z) >= 1.6, `${lv.id}: away from the cage`);
        for (const scale of [1, 1.5]) {
            const there = reach(lv, lv.start, s, scale), back = reach(lv, s, lv.goal, scale);
            check(Number.isFinite(there) && Number.isFinite(back), `${lv.id}: a ball ${scale === 1 ? '' : '50% wider '}reaches the cell and then the exit`);
        }
        const route = reach(lv, lv.start, lv.goal, 1);
        const via = reach(lv, lv.start, s, 1) + reach(lv, s, lv.goal, 1);
        minRatio = Math.min(minRatio, (via - route) / route);
        check(via - route >= route * 0.04, `${lv.id}: the cell is a real detour (route ${route.toFixed(1)}, via ${via.toFixed(1)})`);
        const again = F.fuelSpot(JSON.parse(JSON.stringify(lv)));
        check(again && again.x === s.x && again.z === s.z, `${lv.id}: the same spot every time`);
    }
    check(total === levels.length, `every ladder level has a cell (${total} of ${levels.length})`);
    check(daily.every(d => F.fuelSpot(d) === null), 'the daily mazes have no cells');

    // 4. the launch gate
    check(F.launchNeed(1) === 0 && F.launchNeed(2) === 3 && F.launchNeed(3) === 5 && F.launchNeed(4) === 7 && F.launchNeed(5) === 7 && F.launchNeed(6) === 7, 'the ship needs 3, 5, then 7');
    const w = (n, i) => levels.find(l => l.world === n && l.index === (n - 1) * 10 + i);
    const cleared = {}; for (let i = 1; i <= 10; i++) cleared[w(1, i).id] = { bestMs: 99000, coins: 0 };
    const base = { ...S.freshProgress(), highestIndex: 10, cleared };
    const two = { ...base, fuel: [w(1, 1).id, w(1, 2).id] };
    const three = { ...base, fuel: [w(1, 1).id, w(1, 2).id, w(1, 3).id] };
    const g2 = F.fuelGate(two, w(2, 1));
    check(g2 && g2.need === 3 && g2.have === 2 && g2.from === 1 && !S.isUnlocked(two, w(2, 1)), `two of Sawturn's cells do not fly to Slipstonia: ${JSON.stringify(g2)}`);
    check(F.fuelGate(three, w(2, 1)) === null && S.isUnlocked(three, w(2, 1)), 'three do');
    check(F.fuelGate(two, w(2, 2)) === null && F.fuelGate(two, w(1, 5)) === null, 'only a planet\'s first level is gated');
    const old = { ...base, highestIndex: 14, cleared: { ...cleared, [w(2, 1).id]: { bestMs: 99000, coins: 0 } } };
    check(F.fuelGate(old, w(2, 1)) === null && S.isUnlocked(old, w(2, 1)), 'a planet already played on stays open, fuel or not');
    const parsed = S.parseProgress(JSON.stringify({ ...three, fuel: [...three.fuel, 'w1_01', 'd1_01', 'nonsense', 7] }));
    check(parsed.fuel.join() === three.fuel.slice().sort().join(), `a save's fuel is cleaned: ${parsed.fuel}`);
    let rf = S.recordFuel(S.freshProgress(), w(1, 4).id);
    check(rf.ok && rf.progress.fuel.join() === w(1, 4).id, 'a cell is banked');
    check(!S.recordFuel(rf.progress, w(1, 4).id).ok && S.recordFuel(rf.progress, w(1, 4).id).reason === 'found', 'and once found, found');
    check(!S.recordFuel(rf.progress, 'd1_01').ok, 'a daily maze banks no cell');

    if (failures.length) { console.log('FAIL: fuel'); for (const f of failures) console.log(' - ' + f); process.exitCode = 1; }
    else console.log(`PASS: fuel -- all ${total} ladder levels hide a cell clear of every trap, reachable at the real size and 50% wider, at least a ${(minRatio * 100).toFixed(0)}% detour, the same every time; the ship needs 3, 5, then 7, only at a planet's first level, never shutting out a planet already played`);
})();
