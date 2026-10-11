#!/usr/bin/env node
// The mission (mission.js): every ladder level's ready screen names what it
// asks, in the order it is done. Rolling: a caged friend first (on a floor
// 10 still holding one), then the exit, then exploring it for the fuel cell
// (found in Explore mode only). Exploring: the fuel cell, then the exit. The
// fuel row says what the ship needs from this planet. The daily maze gets
// no card.
//
// Negative control: drop the `caged` row and "floor 10 asks for the friend
// first" fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const fs = require('fs');
    const M = await import('./mission.js');
    const F = await import('./fuel.js');
    const R = await import('./rescue.js');
    const levels = JSON.parse(fs.readFileSync('mazeLevels.json', 'utf8')).levels;
    const daily = JSON.parse(fs.readFileSync('dailyLevels.json', 'utf8'));
    const kinds = m => m.rows.map(r => r.kind).join(',');
    const fresh = { rescued: [], fuel: [] };

    for (const lv of levels) {
        const m = M.missionFor(lv, fresh, { nextBuilt: levels.some(l => l.world === lv.world + 1) });
        check(m && m.rows.length >= 2 && m.rows.some(r => r.kind === 'exit'), `${lv.id}: a mission that names the exit`);
        if (!m) continue;
        check(m.rows.some(r => r.kind === 'fuel' && /explore it/i.test(r.text) && !r.done) === !!F.fuelSpot(lv), `${lv.id}: rolling, sends the player to explore it for the fuel cell`);
        const w = M.missionFor(lv, fresh, { walk: true, nextBuilt: true });
        check(kinds(w) === 'fuel,exit' && w.rows[0].text === 'Find the fuel cell', `${lv.id}: exploring, the fuel cell then the exit (${kinds(w)})`);
        check(m.rows.every(r => r.text && !r.text.includes('undefined') && !(r.note || '').includes('undefined')), `${lv.id}: every row reads`);
        if (R.isRescueLevel(lv)) {
            const name = R.captiveFor(lv.world).name;
            check(kinds(m) === 'cage,exit,fuel' && m.rows[0].text.includes(name), `${lv.id}: floor 10 asks for the friend first (${kinds(m)})`);
            check(kinds(M.missionFor(lv, { rescued: [lv.world], fuel: [] })) === 'exit,fuel', `${lv.id}: no cage once ${name} is free`);
            check(kinds(M.missionFor(lv, fresh, { walk: true })) === 'fuel,exit', `${lv.id}: no cage when walking`);
        } else check(kinds(m) === 'exit,fuel', `${lv.id}: the exit, then explore it for fuel (${kinds(m)})`);
    }
    // The ship's need, named, and marked done once found.
    const w1 = levels.find(l => l.id === 'w1_04');
    const n0 = M.missionFor(w1, { fuel: ['w1_01'] }, { nextBuilt: true }).rows.find(r => r.kind === 'fuel');
    check(n0.note === '1 / 3 to fly to Slipstonia', `the fuel row names what the ship needs (${n0.note})`);
    const n1 = M.missionFor(w1, { fuel: ['w1_01', 'w1_02', 'w1_04'] }, { nextBuilt: true }).rows.find(r => r.kind === 'fuel');
    check(n1.done && n1.text === 'Fuel cell found' && n1.note.includes('fueled'), `a found cell is ticked, and a fueled ship says so (${n1.note})`);
    const last = levels.filter(l => l.world === Math.max(...levels.map(x => x.world)))[0];
    check(M.missionFor(last, fresh, { nextBuilt: false }).rows.find(r => r.kind === 'fuel').note === '', 'the last planet names no next planet');
    // The daily maze: just a race.
    const d = (daily.levels || daily)[0];
    check(M.missionFor(d, fresh) === null, 'the daily maze has no mission card');
    check(M.missionFor(null) === null, 'no level, no card');

    if (failures.length) { console.error('FAIL: mission\n - ' + failures.slice(0, 20).join('\n - ')); process.exitCode = 1; }
    else console.log(`PASS: mission -- all ${levels.length} ladder levels name the exit and the fuel cell (rolling: explore it after; exploring: find it first), every floor 10 the caged friend first (not once free, not walking), the fuel row says what the ship needs and ticks once found, and the daily maze gets no card`);
})().catch(e => { console.error(e); process.exitCode = 1; });
