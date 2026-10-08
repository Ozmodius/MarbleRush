#!/usr/bin/env node
// PLANETILT: achievements (achievements.js, through the progress store).
//   1. Progress is read from the save itself: an old save arrives with what
//      it already earned, and nothing is counted twice.
//   2. Each pays its coins once, only when done; ids are unique and stable.
//   3. The list puts ready-to-claim first and claimed last; the ready count
//      matches.
//   4. Pay stays modest: the whole list is worth no more than about 15
//      first clears.
//   5. Claims survive a reload and junk ids are dropped.
//
// Negative control: drop the `claimed` check in claimAchievement and 2 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const A = await import('./achievements.js');
    const S = await import('./progressStore.js');
    const data = require('./mazeLevels.json');
    const levels = data.levels;

    // 2 (shape). Unique ids, positive goals and pay.
    check(new Set(A.ACHIEVEMENT_IDS).size === A.ACHIEVEMENT_IDS.length, 'achievement ids are unique');
    check(A.ACHIEVEMENTS.every(a => a.goal > 0 && a.coins > 0 && a.name && a.text), 'every achievement has a goal, a name and pay');
    // 4. Pay is modest.
    const total = A.ACHIEVEMENTS.reduce((s, a) => s + a.coins, 0);
    const meanFirst = levels.reduce((s, lv) => s + S.basePayout(data.payouts, lv), 0) / levels.length;
    check(total <= 15 * meanFirst, `all achievements pay ${total}, no more than 15 first clears (${Math.round(15 * meanFirst)})`);

    // 1. Read from the save: a player with history has earned things already.
    const cleared = {};
    for (const lv of levels.slice(0, 12)) cleared[lv.id] = { bestMs: lv.goldMs, coins: lv.coins.length, at: 1 };
    const veteran = S.parseProgress(JSON.stringify({ v: 1, wallet: 0, xp: 800, highestIndex: 12, cleared,
        goldClaimed: levels.slice(0, 10).map(l => l.id), prizes: ['rubberCoat'], walks: { w1_01: { bestMs: 9e4, coins: 0 } },
        upgrades: { grip: 3 }, daily: { streak: 7, last: '2026-10-06' } }));
    const byId = Object.fromEntries(A.achievementList(veteran, levels).map(r => [r.id, r]));
    for (const id of ['clear1', 'clear10', 'gold1', 'gold10', 'world1', 'coins5', 'explore1', 'week', 'level5', 'tuned'])
        check(byId[id] && byId[id].done && !byId[id].claimed, `${id} is already earned by what the save holds`);
    check(!byId.clear25.done && byId.clear25.count === 12, `clear25 shows 12 / 25 (${byId.clear25.count})`);
    check(!byId.world3.done && !byId.marbles.done, 'what is not earned is not done');

    // 3. Order and count.
    const list = A.achievementList(veteran, levels);
    const firstNotReady = list.findIndex(r => !(r.done && !r.claimed));
    check(list.slice(firstNotReady).every(r => !(r.done && !r.claimed)), 'ready ones come first');
    check(A.achievementsReady(veteran, levels) === list.filter(r => r.done && !r.claimed).length, 'the ready count matches the list');

    // 2 + 5. Through the store: pays once, saves, survives a reload.
    const mem = {};
    const adapter = { load: async k => mem[k] || null, save: (k, v) => { mem[k] = v; return true; } };
    mem[S.SAVE_KEY] = JSON.stringify(veteran);
    const store = S.createProgressStore(adapter, levels, data.payouts);
    await store.load();
    const w0 = store.get().wallet, ready0 = store.achievementsReady();
    const c1 = store.claimAchievement('clear10');
    check(c1.ok && c1.coins === 75 && store.get().wallet === w0 + 75, `claiming pays its coins (${w0} -> ${store.get().wallet})`);
    check(!store.claimAchievement('clear10').ok && store.get().wallet === w0 + 75, 'a second claim pays nothing');
    check(!store.claimAchievement('clear50').ok && store.claimAchievement('clear50').reason === 'not-done', 'an unfinished one cannot be claimed');
    check(!store.claimAchievement('nope').ok, 'an unknown one cannot be claimed');
    check(store.achievementsReady() === ready0 - 1, 'the ready count drops by one');
    const again = S.createProgressStore(adapter, levels, data.payouts);
    await again.load();
    check(again.get().achievements.includes('clear10') && !again.claimAchievement('clear10').ok, 'a claim survives a reload, and still pays only once');
    check(S.parseProgress(JSON.stringify({ v: 1, achievements: ['clear1', 'clear1', 'bogus', 7] })).achievements.join() === 'clear1', 'junk and repeated ids are dropped');
    check(S.freshProgress().achievements.length === 0 && A.achievementsReady(S.freshProgress(), levels) === 0, 'a new player has nothing to claim yet');

    if (failures.length) {
        console.error('FAIL: achievements\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: achievements -- read from the save so old players arrive with what they earned, each pays once only when done, ready ones listed first, modest pay, claims survive reloads and merges');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
