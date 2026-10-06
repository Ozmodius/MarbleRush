#!/usr/bin/env node
// PLANETILT: daily rewards, daily missions and the near-miss line (daily.js,
// progressStore.js nearMiss). What they must get right:
//   1. One daily claim per LOCAL day; a claim the next day continues the
//      streak, a missed day starts it over, day 7 loops back to day 1.
//   2. The ×2 ad pays today's coins once, and only after claiming.
//   3. A day's missions are the same on every reload (drawn by date), never a
//      mission the player cannot do yet, and a new day brings a new set.
//   4. Clears and spent power-ups count; a mission pays once, only when done,
//      and the claim that completes the set pays the bonus once.
//   5. The store counts missions from recordClear and useCharge by itself.
//   6. The near miss names the next medal above the player's best, and how far.
//   7. All of it survives a save round-trip; junk in the save is dropped.
//
// Negative control: make dailyStatus continue from any earlier day and 1's
// missed-day case fails; drop the claimed check in claimMission and 4 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const S = await import('./progressStore.js');
    const D = await import('./daily.js');
    const C = await import('./shopCatalog.js');
    // Noon local time on consecutive days, so no test sits on a midnight.
    const day = n => new Date(2026, 9, 1 + n, 12, 0, 0).getTime();

    // 1. the calendar
    let p = S.freshProgress();
    let st = D.dailyStatus(p, day(0));
    check(st.canClaim && st.day === 1, `a new player can claim day 1, got ${JSON.stringify(st)}`);
    let r = D.claimDaily(p, day(0));
    check(r.ok && r.progress.wallet === C.DAILY_CALENDAR[0].coins, 'claiming day 1 pays its coins');
    check(p.wallet === 0, 'claimDaily must not modify its input');
    p = r.progress;
    check(!D.claimDaily(p, day(0) + 3600e3).ok, 'only one claim a day');
    check(D.claimDaily(p, new Date(2026, 9, 2, 0, 1).getTime()).ok, 'a new local day starts at local midnight');
    for (let n = 1; n < 7; n++) { r = D.claimDaily(p, day(n)); check(r.ok && r.day === n + 1, `day ${n + 1} follows day ${n}, got day ${r.day}`); p = r.progress; }
    check(p.charges.shield === 2 && p.charges.slowmo === 2 && p.charges.magnet === 2, `a full week grants its power-ups, got ${JSON.stringify(p.charges)}`);
    const weekCoins = C.DAILY_CALENDAR.reduce((a, x) => a + (x.coins || 0), 0);
    check(p.wallet === weekCoins, `a full week pays ${weekCoins}, got ${p.wallet}`);
    r = D.claimDaily(p, day(7));
    check(r.ok && r.day === 1, 'after day 7 the week loops to day 1');
    st = D.dailyStatus(p, day(9));
    check(st.day === 1 && st.restarted, 'a missed day starts the week over, and says so');
    let mid = D.claimDaily(D.claimDaily(S.freshProgress(), day(0)).progress, day(1)).progress;
    check(D.dailyStatus(mid, day(2)).day === 3 && D.dailyStatus(mid, day(3)).day === 1, 'missing a day mid-week starts over at day 1, not day 3');
    check(D.dailyStatus(p, day(3)).day === 1, 'a clock that went backwards starts over rather than double-paying a day');

    // 2. ×2 ad
    let q = S.freshProgress();
    check(!D.adDoubleDaily(q, day(0)).ok, 'nothing to double before claiming');
    q = D.claimDaily(q, day(0)).progress;
    let dd = D.adDoubleDaily(q, day(0));
    check(dd.ok && dd.amount === C.DAILY_CALENDAR[0].coins && dd.progress.wallet === 2 * C.DAILY_CALENDAR[0].coins, 'the ad pays today\'s coins again');
    check(!D.adDoubleDaily(dd.progress, day(0)).ok, 'and only once');

    // 3. the draw
    let m = S.freshProgress();
    const a = D.drawMissions(m, '2026-10-06'), b = D.drawMissions(m, '2026-10-06');
    check(a.length === C.MISSIONS_PER_DAY && new Set(a).size === a.length, `three distinct missions, got ${a}`);
    check(a.join() === b.join(), 'the same date draws the same missions');
    check(!a.includes('best') && !a.includes('powerup'), 'a new player draws nothing they cannot do yet');
    let days = new Set();
    for (let n = 0; n < 30; n++) {
        const ids = D.drawMissions(m, D.dayKey(day(n)));
        days.add(ids.join());
        check(!ids.includes('best') && !ids.includes('powerup'), 'never an impossible mission, on any day');
    }
    check(days.size > 5, `the set changes from day to day (${days.size} sets in 30 days)`);
    const vet = { ...S.freshProgress(), cleared: { w1_01: { bestMs: 9000, coins: 0, at: 0 } }, charges: { shield: 3 } };
    const seen = new Set();
    for (let n = 0; n < 60; n++) D.drawMissions(vet, D.dayKey(day(n))).forEach(id => seen.add(id));
    check(Object.keys(C.MISSIONS).every(id => seen.has(id)), `a player who can do everything sees every mission over time, saw ${[...seen]}`);

    // 4. counting and claiming
    m = D.missionsToday(S.freshProgress(), day(0)).progress;
    const [m1, m2, m3] = m.missions.ids;
    check(!D.claimMission(m, m1, day(0)).ok, 'an unfinished mission cannot be claimed');
    let t = D.trackMissions(m, { [m1]: 999 }, day(0));
    check(t.done.length === 1 && t.done[0] === m1 && t.progress.missions.counts[m1] === C.MISSIONS[m1].goal, 'a mission caps at its goal and is reported done once');
    check(D.trackMissions(t.progress, { [m1]: 1 }, day(0)).done.length === 0, 'a finished mission is not reported again');
    m = t.progress;
    let c1 = D.claimMission(m, m1, day(0));
    check(c1.ok && c1.reward === C.MISSIONS[m1].reward && c1.bonus === 0 && c1.progress.wallet === m.wallet + C.MISSIONS[m1].reward, 'a done mission pays its reward');
    check(!D.claimMission(c1.progress, m1, day(0)).ok, 'and only once');
    m = D.trackMissions(c1.progress, { [m2]: 999, [m3]: 999 }, day(0)).progress;
    m = D.claimMission(m, m2, day(0)).progress;
    const c3 = D.claimMission(m, m3, day(0));
    check(c3.ok && c3.bonus === C.MISSIONS_BONUS, 'the claim that completes the set pays the bonus');
    const tomorrow = D.missionList(c3.progress, day(1));
    check(tomorrow.every(x => x.count === 0 && !x.claimed), 'a new day brings a fresh set');
    check(D.missionsReady(D.trackMissions(c3.progress, { clears: 99, coins: 99, silver: 99, gold: 99, sweep: 99 }, day(1)).progress, day(1)) >= 1, 'the badge counts finished, unclaimed missions');
    const lv = { coins: [{}, {}, {}] };
    const ev = D.clearEvents(lv, { tier: 'gold', runMs: 8000 }, 3, 9000);
    check(ev.clears === 1 && ev.coins === 3 && ev.gold === 1 && ev.silver === 1 && ev.sweep === 1 && ev.best === 1, `a gold sweep that beat its best counts for all of those, got ${JSON.stringify(ev)}`);
    const ev2 = D.clearEvents(lv, { tier: 'bronze', runMs: 8000 }, 2, undefined);
    check(!ev2.gold && !ev2.silver && !ev2.sweep && !ev2.best, 'a bronze first clear with a coin missed counts only as a clear and its coins');

    // 5. the store counts by itself
    const levels = [{ id: 'w1_01', world: 1, index: 1, minMs: 2500, goldMs: 9000, coins: [{}, {}] }];
    const mem = {};
    const store = S.createProgressStore({ load: async k => mem[k] || null, save: (k, v) => { mem[k] = v; return true; } }, levels, { byWorld: { 1: 120 } });
    await store.load();
    store.setClock(() => day(0));
    store.missions();
    const forced = JSON.parse(mem[S.SAVE_KEY]);
    check(forced.missions && forced.missions.date === D.dayKey(day(0)), 'the day\'s set is saved when first drawn, so a reload keeps it');
    const before = store.missions();
    const res = store.recordClear('w1_01', 8000, 2);
    const after = store.missions();
    const counted = after.find(x => x.id === 'clears' || x.id === 'coins' || x.id === 'gold' || x.id === 'sweep' || x.id === 'silver');
    check(res.accepted && Array.isArray(res.missionsDone), 'recordClear reports the missions it finished');
    check(!counted || counted.count > before.find(x => x.id === counted.id).count, `a clear counts toward the day's missions: ${JSON.stringify(after)}`);
    check(store.claimDaily().ok && !store.claimDaily().ok && store.dailyStatus().claimed, 'the store claims once a day');
    store.setClock(() => day(1));
    check(store.dailyStatus().canClaim && store.dailyStatus().day === 2, 'and the store\'s clock moves the day');

    // 6. near miss
    const L = { goldMs: 10000 };
    let nm = S.nearMiss(L, 10400, undefined);
    check(nm && nm.tier === 'gold' && nm.gapMs === 400 && nm.close, `0.4s over gold is a close miss for gold, got ${JSON.stringify(nm)}`);
    nm = S.nearMiss(L, 14000, undefined);
    check(nm && nm.tier === 'gold' && nm.gapMs === 4000 && !nm.close, 'a silver run chases gold, not close at 4s');
    nm = S.nearMiss(L, 30000, undefined);
    check(nm && nm.tier === 'bronze' && nm.gapMs === 7500, `no medal chases bronze, got ${JSON.stringify(nm)}`);
    check(S.nearMiss(L, 14000, 9000) === null, 'a level already gold has nothing to chase, even after a slow run');
    nm = S.nearMiss(L, 20000, 14000);
    check(nm && nm.tier === 'gold' && nm.gapMs === 10000, 'the target is above the player\'s BEST, measured from this run');

    // 7. save round-trip
    const saved = S.parseProgress(JSON.stringify(c3.progress));
    check(saved.missions && saved.missions.claimed.length === 3 && saved.missions.bonus && saved.daily.streak === 0, 'missions round-trip');
    const pd = S.parseProgress(JSON.stringify(p));
    check(pd.daily.streak === p.daily.streak && pd.daily.last === p.daily.last, 'the daily streak round-trips');
    const junk = S.parseProgress(JSON.stringify({ ...S.freshProgress(), daily: { streak: 99, last: 'tuesday' }, missions: { date: '2026-10-06', ids: ['clears', 'fly'], counts: { clears: 999 }, claimed: ['fly'] } }));
    check(junk.daily.streak === 0 && junk.daily.last === '' && junk.missions.ids.join() === 'clears' && junk.missions.counts.clears === 3 && junk.missions.claimed.length === 0,
        `junk in the save is dropped, got ${JSON.stringify([junk.daily, junk.missions])}`);
    check(S.parseProgress(JSON.stringify({ v: 1, wallet: 5 })).missions === null, 'an old save with no missions loads');

    if (failures.length) {
        console.error('FAIL: daily\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: daily -- one claim a local day, streaks continue and restart, ×2 once, missions drawn by date and never impossible, counted from clears and power-ups, paid once with a set bonus, near misses name the next medal, all round-trip');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
