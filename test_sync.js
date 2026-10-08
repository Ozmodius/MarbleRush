#!/usr/bin/env node
// PLANETILT: merging two saves of one player (progressStore.js mergeProgress),
// which cloud sync uses on both ends. What must hold:
//   1. Nothing earned is ever lost: levels, best times, coins found, golds,
//      prizes, things owned, upgrade tiers, XP and walks combine to the best
//      of both, whichever save is newer.
//   2. Nothing spendable is minted: the wallet, power-ups and prize uses come
//      from the newer save, never summed.
//   3. Daily things: the later day wins; the same day combines.
//   4. A fresh (empty) save never wipes a real one, in either order; merging
//      is order-independent for what is earned; the result is a clean save.
//
// Negative control: sum the wallets in mergeProgress and 2 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const S = await import('./progressStore.js');
    const base = () => ({ ...S.freshProgress(), v: 1 });
    const a = { ...base(), savedAt: 1000, wallet: 500, highestIndex: 4, xp: 600,
        cleared: { w1_01: { bestMs: 9000, coins: 2, at: 1 }, w1_02: { bestMs: 8000, coins: 1, at: 1 } },
        goldClaimed: ['w1_01'], marbles: ['classic', 'steel'], upgrades: { grip: 2 }, charges: { shield: 3 },
        skins: ['plain', 'stripe'], walks: { w1_01: { bestMs: 12000, coins: 1, gold: false } },
        daily: { streak: 2, last: '2026-10-05', doubled: '' }, achievements: ['clear1'] };
    const b = { ...base(), savedAt: 2000, wallet: 120, highestIndex: 2, xp: 300,
        cleared: { w1_01: { bestMs: 8500, coins: 3, at: 2 } },
        goldClaimed: [], marbles: ['classic', 'rubber'], upgrades: { grip: 1, brakes: 1 }, charges: { slowmo: 1 },
        skins: ['plain', 'galaxy'], walks: { w1_01: { bestMs: 11000, coins: 0, gold: true } },
        daily: { streak: 3, last: '2026-10-06', doubled: '2026-10-06' }, achievements: ['gold1', 'nonsense'] };

    // 1. earned things combine
    const m = S.mergeProgress(a, b);
    check(m.highestIndex === 4, 'the further ladder position is kept');
    check(m.cleared.w1_01.bestMs === 8500 && m.cleared.w1_01.coins === 3 && m.cleared.w1_02, `best times and coins found combine: ${JSON.stringify(m.cleared)}`);
    check(m.goldClaimed.includes('w1_01'), 'a gold earned anywhere is kept');
    check(['classic', 'steel', 'rubber'].every(x => m.marbles.includes(x)) && m.skins.includes('stripe') && m.skins.includes('galaxy'), 'things owned on either side are owned');
    check(m.upgrades.grip === 2 && m.upgrades.brakes === 1, 'upgrade tiers take the higher');
    check(m.xp === 600, 'XP takes the higher');
    check(m.achievements.length === 2 && m.achievements.includes('clear1') && m.achievements.includes('gold1'), `achievements claimed on either side stay claimed (never paid twice): ${m.achievements}`);
    check(m.walks.w1_01.bestMs === 11000 && m.walks.w1_01.coins === 1 && m.walks.w1_01.gold, 'walk records combine');

    // 2. spendables from the newer save
    check(m.wallet === 120 && m.charges.slowmo === 1 && !m.charges.shield, `wallet and power-ups come from the newer save, never summed: ${m.wallet} ${JSON.stringify(m.charges)}`);
    const m2 = S.mergeProgress(b, a);
    check(m2.wallet === 120, 'whichever order they meet in');
    check(JSON.stringify({ ...m, savedAt: 0 }) === JSON.stringify({ ...m2, savedAt: 0 }), 'merging is order-independent');

    // 3. daily
    check(m.daily.last === '2026-10-06' && m.daily.streak === 3, 'the later daily claim wins');
    const ma = S.mergeProgress({ ...a, missions: { date: '2026-10-06', ids: ['clears', 'coins', 'gold'], counts: { clears: 2 }, claimed: [], bonus: false } },
        { ...b, missions: { date: '2026-10-06', ids: ['clears', 'coins', 'gold'], counts: { clears: 1, coins: 9 }, claimed: ['gold'], bonus: false } });
    check(ma.missions.counts.clears === 2 && ma.missions.counts.coins === 9 && ma.missions.claimed.includes('gold'), `the same day's missions combine: ${JSON.stringify(ma.missions)}`);

    // 4. fresh never wipes; result is clean
    const fresh = S.freshProgress();
    check(S.mergeProgress(fresh, a).wallet === 500 && S.mergeProgress(a, fresh).cleared.w1_02, 'a fresh save never wipes a real one, in either order');
    check(S.mergeProgress(null, a).highestIndex === 4 && S.mergeProgress(a, undefined).highestIndex === 4, 'a missing save is no save');
    const junk = S.mergeProgress(a, { v: 1, savedAt: 9e12, wallet: -5, marbles: ['classic', 'unicorn'], cleared: { x: { bestMs: 'fast' } } });
    check(junk.wallet === 0 && !junk.marbles.includes('unicorn') && !junk.cleared.x && junk.cleared.w1_01, 'junk from the other side is cleaned, and real progress kept');
    check(S.mergeProgress({ ...a, xp: undefined }, { ...b, xp: undefined }).xp === null, 'an unknown XP stays unknown (so the store backfills it)');

    // the store adopts a remote save by merging, and saves the result
    const mem = {};
    const store = S.createProgressStore({ load: async k => mem[k] || null, save: (k, v) => { mem[k] = v; return true; } });
    await store.load();
    let pushed = 0;
    store.onSave(() => { pushed++; });
    check(store.adopt(a) && store.get().highestIndex === 4 && JSON.parse(mem[S.SAVE_KEY]).highestIndex === 4 && pushed === 1, 'adopting a remote save merges, saves and tells listeners');
    check(!store.adopt(a) && pushed === 1, 'adopting the same save again changes nothing and saves nothing');

    if (failures.length) {
        console.error('FAIL: sync\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: sync -- earned progress combines to the best of both, spendables come from the newer save, daily things by day, fresh saves never wipe real ones, merges are order-independent and clean');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
