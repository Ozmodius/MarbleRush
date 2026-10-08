#!/usr/bin/env node
// PLANETILT: player level (playerLevel.js) and how the store pays it.
//   1. Levels come from total XP on a rising curve; the HUD numbers add up.
//   2. Crossing levels pays each one's reward once: coins, power-ups, and the
//      reward skins and trails -- every look with a `level` is given by
//      exactly that level, and nothing else gives one.
//   3. The store earns XP for clears (first, replay, gold), daily claims and
//      missions, and hands each level-up to the UI once.
//   4. A save from before player levels is backfilled from its clears.
//
// Negative control: make addXp pay only the last level crossed and 2's
// multi-level case fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const P = await import('./playerLevel.js');
    const S = await import('./progressStore.js');
    const C = await import('./shopCatalog.js');

    // 1. the curve
    check(P.levelForXp(0) === 1 && P.levelForXp(99) === 1 && P.levelForXp(100) === 2, 'level 2 at 100 XP');
    for (let L = 1; L < 30; L++) {
        check(P.xpForLevel(L + 1) - P.xpForLevel(L) === P.xpStep(L), `level ${L} -> ${L + 1} takes xpStep(${L})`);
        check(P.xpStep(L + 1) > P.xpStep(L), 'each level takes more XP than the last');
        check(P.levelForXp(P.xpForLevel(L)) === L && P.levelForXp(P.xpForLevel(L + 1) - 1) === L, `level ${L} spans its XP exactly`);
    }
    const info = P.levelInfo(P.xpForLevel(5) + 20);
    check(info.level === 5 && info.into === 20 && info.need === P.xpStep(5), `the HUD reads level 5, 20 into it: ${JSON.stringify(info)}`);
    // Harder as you go: the step grows faster than a clear's XP does (later
    // worlds pay +20 XP a world), so a player clearing the ladder in order
    // needs more clears for each level as they climb.
    const ladder = require('./mazeLevels.json').levels;
    let into = 0, lvl = 1, since = 0;
    const per = [];
    for (const lv of ladder) {
        into += C.XP.firstClear + C.XP.perWorld * lv.world + (lv.index % 2 === 0 ? C.XP.goldFirst : 0);
        since++;
        while (into >= P.xpStep(lvl)) { into -= P.xpStep(lvl); lvl++; per.push(since); since = 0; }
    }
    const firstHalf = per.slice(0, 6).reduce((a, b) => a + b, 0) / 6, lastFew = per.slice(-3).reduce((a, b) => a + b, 0) / 3;
    check(lastFew >= 3 * firstHalf && lastFew >= 5, `levels get properly harder: ${per.join(',')} clears a level (early ${firstHalf.toFixed(1)}, late ${lastFew.toFixed(1)})`);
    check(lvl >= 14 && lvl <= 16, `the 50 launch levels (gold on half) end around player level 15: ${lvl}`);

    // 2. rewards
    let p = S.freshProgress();
    let out = P.addXp(p, P.xpForLevel(9));
    check(out.gained.map(g => g.level).join() === '2,3,4,5,6,7,8,9', `crossing many levels reports each: ${out.gained.map(g => g.level)}`);
    const coins = out.gained.reduce((a, g) => a + g.reward.coins, 0);
    check(out.progress.wallet === coins && coins === [2, 3, 4, 5, 6, 7, 8, 9].reduce((a, L) => a + 40 + 10 * L + ((C.LEVEL_REWARDS[L] || {}).coins || 0), 0), 'every level crossed pays its coins');
    check(out.progress.trails.includes('rainbow') && out.progress.skins.includes('galaxy') && out.progress.trail === 'none' && out.progress.skin === 'plain',
        'levels 5 and 8 give Rainbow and Galaxy, owned but not forced on');
    check(out.progress.charges.shield === 1 && out.progress.charges.slowmo === 1 && out.progress.charges.magnet === 1, `levels 3 and 7 give their power-ups: ${JSON.stringify(out.progress.charges)}`);
    check(p.wallet === 0 && p.xp === 0, 'addXp must not modify its input');
    check(P.addXp(out.progress, 0).gained.length === 0, 'no XP, no level');
    // Paid once ever: a save from the old curve keeps its levels' rewards and
    // is not paid them again when it climbs back through them.
    const oldCurve = S.parseProgress(JSON.stringify({ v: 1, wallet: 0, xp: 2700, charges: {} }));
    check(oldCurve.levelPaid === 10 && P.levelForXp(oldCurve.xp) === 9, `an old-curve save at 2,700 XP was paid to level 10, shows level 9 now (${oldCurve.levelPaid}, ${P.levelForXp(oldCurve.xp)})`);
    const back = P.addXp(oldCurve, P.xpForLevel(12) - oldCurve.xp);
    check(back.gained.map(g => g.level).join() === '10,11,12' && back.gained[0].repeat && back.progress.wallet === P.rewardFor(11).coins + P.rewardFor(12).coins,
        `climbing back through level 10 shows it but pays only 11 and 12 (${back.progress.wallet})`);
    check(back.progress.levelPaid === 12, 'and remembers 12 as paid');
    check(S.parseProgress(JSON.stringify({ v: 1, xp: null })).levelPaid === 1 && S.freshProgress().levelPaid === 1, 'a new or pre-level save has nothing paid yet');
    for (const [kind, L] of Object.entries(C.LOOKS)) for (const [id, item] of Object.entries(L.table)) {
        if (!Number.isFinite(item.level)) continue;
        const r = C.LEVEL_REWARDS[item.level];
        check(r && r.look && r.look[0] === kind && r.look[1] === id, `${kind} ${id} is given by level ${item.level}`);
    }
    for (const [L, r] of Object.entries(C.LEVEL_REWARDS)) if (r.look) {
        check(C.LOOKS[r.look[0]].table[r.look[1]].level === Number(L), `level ${L} gives a look marked for level ${L}`);
    }

    // 3. the store
    const levels = [{ id: 'w1_01', world: 1, index: 1, minMs: 2500, goldMs: 9000, coins: [{}] }, { id: 'w2_01', world: 2, index: 2, minMs: 2500, goldMs: 9000, coins: [] }];
    const mem = {};
    const store = S.createProgressStore({ load: async k => mem[k] || null, save: (k, v) => { mem[k] = v; return true; } }, levels, { byWorld: { 1: 120, 2: 180 } });
    await store.load();
    store.setLevels(levels, { byWorld: { 1: 120, 2: 180 } });
    let r = store.recordClear('w1_01', 12000, 1);
    check(r.xp === C.XP.firstClear + C.XP.perWorld, `a first clear in world 1 earns ${C.XP.firstClear + C.XP.perWorld} XP, got ${r.xp}`);
    check(r.levelUps.length === 1 && r.levelUps[0].level === 2, 'and reaches level 2');
    r = store.recordClear('w1_01', 8000, 1);
    check(r.xp === C.XP.replayClear + C.XP.goldFirst, `a replay that wins gold earns replay + gold XP, got ${r.xp}`);
    check(store.takeLevelUps().length === 1 && store.takeLevelUps().length === 0, 'level-ups are handed out once');
    const x0 = store.get().xp;
    store.claimDaily();
    check(store.get().xp === x0 + C.XP.dailyClaim, 'a daily claim earns XP');
    check(JSON.parse(mem[S.SAVE_KEY]).xp === store.get().xp, 'XP is saved');

    // 4. backfill
    const old = JSON.stringify({ v: 1, wallet: 50, highestIndex: 2, cleared: { w1_01: { bestMs: 8000, coins: 1 }, w2_01: { bestMs: 9000, coins: 0 } }, goldClaimed: ['w1_01'] });
    const m2 = { [S.SAVE_KEY]: old };
    const st2 = S.createProgressStore({ load: async k => m2[k] || null, save: (k, v) => { m2[k] = v; return true; } });
    await st2.load();
    check(st2.get().xp === null, 'an old save loads with its XP unknown');
    st2.setLevels(levels, {});
    const want = (C.XP.firstClear + C.XP.perWorld) + C.XP.goldFirst + (C.XP.firstClear + 2 * C.XP.perWorld);
    check(st2.get().xp === want, `it is backfilled from its clears: ${want}, got ${st2.get().xp}`);
    check(st2.takeLevelUps().length === P.levelForXp(want) - 1 && st2.get().wallet > 50, 'and the levels it reaches pay, and are shown');
    const m3 = { [S.SAVE_KEY]: m2[S.SAVE_KEY] };
    const st3 = S.createProgressStore({ load: async k => m3[k] || null, save: () => true });
    await st3.load();
    st3.setLevels(levels, {});
    check(st3.get().xp === want && st3.takeLevelUps().length === 0, 'a backfill happens once');

    if (failures.length) {
        console.error('FAIL: player level\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: player level -- a rising XP curve, every level paid once with its reward looks and power-ups, XP from clears/golds/dailies, level-ups shown once, old saves backfilled once');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
