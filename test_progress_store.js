// progressStore.js's rules -- the ones Ball Smack's server used to apply to a
// maze clear, now kept on the device. Pure Node, no browser.
'use strict';
const DATA = require('./mazeLevels.json');

async function run() {
    const S = await import('./progressStore.js');
    const failures = [];
    const check = (cond, msg) => { if (!cond) failures.push(msg); };
    const L = (id) => DATA.levels.find(l => l.id === id);
    const pay = DATA.payouts;
    const p = S.emptyProgress();

    // Ladder: level 2 before level 1 is refused, and changes nothing.
    let r = S.applyClear(p, L('w1_02'), 5000, pay, 1);
    check(!r.ok && p.coins === 0 && p.maze.highestIndex === 0, 'a level past the ladder must be refused');

    // Duration floor and ceiling.
    r = S.applyClear(p, L('w1_01'), L('w1_01').minMs - 1, pay, 1);
    check(!r.ok && p.coins === 0, 'a clear under minMs must be refused');
    r = S.applyClear(p, L('w1_01'), S.MAX_RUN_MS + 1, pay, 1);
    check(!r.ok, 'a clear over MAX_RUN_MS must be refused');

    // First clear, silver: pays the world's base only.
    const silverMs = Math.round(L('w1_01').goldMs * 1.2);
    r = S.applyClear(p, L('w1_01'), silverMs, pay, 1);
    check(r.ok && r.firstClear && r.tier === 'silver' && r.earned === 120 && p.coins === 120 && p.maze.highestIndex === 1,
        `a first silver clear pays the base only, got ${JSON.stringify(r)}`);

    // Replay, slower: pays nothing, best unchanged.
    r = S.applyClear(p, L('w1_01'), silverMs + 500, pay, 2);
    check(r.ok && !r.firstClear && r.earned === 0 && r.bestMs === silverMs, 'a slower replay pays nothing and keeps the best');

    // Replay at gold: the gold bonus once, best improves.
    r = S.applyClear(p, L('w1_01'), 4000, pay, 3);
    check(r.ok && r.goldFirst && r.earned === 24 && r.bestMs === 4000 && p.coins === 144, `a first gold pays the bonus once, got ${JSON.stringify(r)}`);
    r = S.applyClear(p, L('w1_01'), 3900, pay, 4);
    check(r.ok && !r.goldFirst && r.earned === 0 && p.coins === 144, 'a second gold pays nothing');

    // normalizeProgress repairs a bad save field by field.
    const n = S.normalizeProgress({ coins: -5, maze: { cleared: { a: { bestMs: 'x' }, b: { bestMs: 100.4, at: 3 } }, goldClaimed: ['b', 7], highestIndex: 'z' } });
    check(n.coins === 0 && !n.maze.cleared.a && n.maze.cleared.b.bestMs === 100 && n.maze.goldClaimed.length === 1 && n.maze.highestIndex === 0,
        `a damaged save must be repaired field by field, got ${JSON.stringify(n)}`);
    check(S.normalizeProgress('garbage').coins === 0, 'an unreadable save starts fresh');

    if (failures.length) { console.error('FAIL: progress store\n - ' + failures.join('\n - ')); process.exitCode = 1; }
    else console.log('PASS: progress store -- ladder, minMs/max duration, pay on first clear only, gold bonus once, best-time replays, and save repair');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
