#!/usr/bin/env node
// PLANETILT: secret pockets (pockets.js) -- a dead end behind a wall that only
// looks solid, a page of the Baron's diary at its end.
//   1. Two pocket levels a planet, and the written-down table matches what
//      the levels give (pocketLevels).
//   2. Each false wall spans its corridor wall face to wall face (it looks
//      like a wall), and covers no hole, coin, power-up, fuel cell, cage,
//      start or exit.
//   3. It hides only the dead end: an independent search (finer grid, its
//      own clearances) with the wall made solid still finds the exit by the
//      same route length and still reaches the fuel cell, but not the page.
//   4. With the wall as it is -- no collider -- the page is reachable at the
//      real size and 50% wider.
//
// Negative control: give a pocket the exit-side corridor (skip the
// !seen[g.e] test in pockets.js) and 3 fails; move a wall 0.3 off its
// corridor and 2 fails.
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
(async () => {
    const fs = await import('fs');
    const K = await import('./pockets.js');
    const F = await import('./fuel.js');
    const R = await import('./rescue.js');
    const levels = JSON.parse(fs.readFileSync('./mazeLevels.json', 'utf8')).levels;
    const boundary = lv => { const hw = lv.size.w / 2, hd = lv.size.d / 2, t = 0.4; return [{ x: 0, z: -hd - t / 2, w: lv.size.w + t * 2, d: t }, { x: 0, z: hd + t / 2, w: lv.size.w + t * 2, d: t }, { x: -hw - t / 2, z: 0, w: t, d: lv.size.d }, { x: hw + t / 2, z: 0, w: t, d: lv.size.d }]; };
    const inRect = (x, z, w, m = 0) => Math.abs(x - w.x) <= w.w / 2 + m && Math.abs(z - w.z) <= w.d / 2 + m;

    function reach(lv, from, to, scale, extraWalls = []) {
        const r = lv.ballRadius * scale, W = lv.size.w, D = lv.size.d, G = 0.05;
        const walls = lv.walls.concat(extraWalls);
        const nx = Math.ceil(W / G), nz = Math.ceil(D / G);
        const cx = i => -W / 2 + (i + 0.5) * G, cz = j => -D / 2 + (j + 0.5) * G;
        const ok = (x, z) => Math.abs(x) <= W / 2 - r && Math.abs(z) <= D / 2 - r
            && !walls.some(w => Math.abs(x - w.x) < w.w / 2 + r && Math.abs(z - w.z) < w.d / 2 + r)
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

    // 1. the table
    const computed = [1, 2, 3, 4, 5].flatMap(w => K.pocketLevels(levels, w));
    check(computed.join() === K.POCKET_LEVELS.join(), `the pocket table matches the levels: ${computed}`);
    for (const w of [1, 2, 3, 4, 5]) check(K.POCKET_LEVELS.filter(id => id.startsWith(`w${w}_`)).length === 2, `planet ${w} has two pockets`);

    for (const id of K.POCKET_LEVELS) {
        const lv = levels.find(l => l.id === id);
        const pk = K.pocketOn(lv);
        check(!!pk, `${id}: has its pocket`);
        if (!pk) continue;
        const wl = pk.wall, walls = lv.walls.concat(boundary(lv));
        // 2. it spans its corridor, face to face
        const alongX = wl.w > wl.d;          // a wall lying along x spans x
        const ends = alongX ? [wl.x - wl.w / 2 - 0.04, wl.x + wl.w / 2 + 0.04].flatMap(x => [-0.45, 0, 0.45].map(f => [x, wl.z + f * wl.d]))
            : [wl.z - wl.d / 2 - 0.04, wl.z + wl.d / 2 + 0.04].flatMap(z => [-0.45, 0, 0.45].map(f => [wl.x + f * wl.w, z]));
        check(ends.every(([x, z]) => walls.some(w => inRect(x, z, w))), `${id}: the false wall meets a wall at both ends (${JSON.stringify(wl)})`);
        const fuel = F.fuelSpot(lv), cage = R.captiveSpot(lv);
        const things = [lv.start, lv.goal, ...(fuel ? [fuel] : []), ...(cage ? [cage] : [])];
        check(things.every(q => !inRect(q.x, q.z, wl, 0.9)) && (lv.holes || []).every(h => !inRect(h.x, h.z, wl, h.r)) && (lv.coins || []).every(c => !inRect(c.x, c.z, wl, 0.25)) && (lv.pickups || []).every(c => !inRect(c.x, c.z, wl, 0.35)),
            `${id}: nothing that matters under the false wall`);
        // 3. made solid, it hides only the pocket
        const route = reach(lv, lv.start, lv.goal, 1), routeSolid = reach(lv, lv.start, lv.goal, 1, [wl]);
        check(Math.abs(routeSolid - route) < 0.15, `${id}: the wall is off the way to the exit (route ${route.toFixed(2)}, with the wall ${routeSolid.toFixed(2)})`);
        check(!Number.isFinite(reach(lv, lv.start, pk.page, 1, [wl])), `${id}: solid, it would cut the page off`);
        if (fuel) check(Number.isFinite(reach(lv, lv.start, fuel, 1, [wl])), `${id}: the fuel cell is not behind it`);
        // 4. as it is, the page is reachable
        for (const scale of [1, 1.5]) check(Number.isFinite(reach(lv, lv.start, pk.page, scale)) && Number.isFinite(reach(lv, pk.page, lv.goal, scale)), `${id}: a ball ${scale === 1 ? '' : '50% wider '}reaches the page and the exit`);
    }
    check(levels.filter(l => !K.isPocketLevel(l)).every(l => K.pocketOn(l) === null), 'no pocket anywhere else');

    // The pages and the save.
    const D = await import('./diary.js');
    const S = await import('./progressStore.js');
    check(K.POCKET_LEVELS.every((id, i) => D.pageText(id).length > 20 && D.pageNumber(id) === i + 1) && Object.keys(D.PAGES).length === K.POCKET_LEVELS.length, 'every pocket has its page, numbered in planet order');
    let rp = S.recordPage(S.freshProgress(), 'w1_07');
    check(rp.ok && rp.progress.diary.join() === 'w1_07' && !S.recordPage(rp.progress, 'w1_07').ok, 'a page is banked once');
    check(S.parseProgress(JSON.stringify({ ...S.freshProgress(), diary: ['w1_07', 'x', 3, 'w1_07'] })).diary.join() === 'w1_07', 'a save\'s pages are cleaned');
    if (failures.length) { console.log('FAIL: pockets'); for (const f of failures) console.log(' - ' + f); process.exitCode = 1; }
    else console.log(`PASS: pockets -- ${K.POCKET_LEVELS.length} pockets, two a planet, each false wall face to face across its corridor, over nothing that matters, off the way to the exit, hiding only its page, which a ball (also 50% wider) can reach through it`);
})();
