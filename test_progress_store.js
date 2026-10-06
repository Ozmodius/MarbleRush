#!/usr/bin/env node
// PLANETILT: the progress store's rules (progressStore.js).
//
// With no server, this is the ledger. What it must get right:
//   1. The ladder: a level is playable only once the one before it is cleared.
//   2. The time floor: a "clear" under the level's minMs does not count.
//   3. First-time-only pay: the base payout once, the gold bonus once, each
//      coin once (a replay banks only coins beyond its best).
//   4. A world's prize is granted once, by its last level.
//   5. Spending cannot go below zero.
//   6. A save round-trips; a corrupt or unknown-version save starts fresh
//      instead of half-loading.
//   7. The store writes every accepted change through to its adapter.
//
// Negative control: drop the minMs check in applyClear and 2 fails; drop the
// prev.coins subtraction and 3's replay case fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const S = await import('./progressStore.js');
    const levels = [
        { id: 'w1_01', world: 1, index: 1, minMs: 2500, goldMs: 9000, coins: [{}, {}, {}] },
        { id: 'w1_02', world: 1, index: 2, minMs: 2500, goldMs: 9000, coins: [{}, {}], prize: 'rubberCoat' }
    ];
    const payouts = { goldBonusPct: 0.2, byWorld: { 1: 120 } };
    let p = S.freshProgress();

    // 1. ladder
    let r = S.applyClear(p, levels, payouts, 'w1_02', 5000, 0);
    check(!r.result.accepted && r.result.reason === 'locked', 'level 2 is locked until level 1 is cleared');

    // 2. time floor
    r = S.applyClear(p, levels, payouts, 'w1_01', 1000, 0);
    check(!r.result.accepted && r.result.reason === 'too-fast', 'a clear under minMs does not count');
    check(r.progress === p, 'a rejected clear changes nothing');

    // 3. pay: first clear (silver), 2 of 3 coins
    r = S.applyClear(p, levels, payouts, 'w1_01', 12000, 2);
    check(r.result.accepted && r.result.firstClear && r.result.tier === 'silver', `first clear accepted at silver, got ${JSON.stringify(r.result)}`);
    check(r.result.earned === 120 + 2, `first clear pays base + coins (122), got ${r.result.earned}`);
    check(p.wallet === 0, 'applyClear must not modify its input');
    p = r.progress;
    // replay at gold with the same 2 coins: gold bonus only
    r = S.applyClear(p, levels, payouts, 'w1_01', 8000, 2);
    check(r.result.earned === 24 && r.result.goldFirst, `gold replay pays the gold bonus (24) and no repeat coins, got ${r.result.earned}`);
    p = r.progress;
    // replay at gold with all 3 coins: just the new coin
    r = S.applyClear(p, levels, payouts, 'w1_01', 8500, 3);
    check(r.result.earned === 1 && !r.result.goldFirst, `a replay banks only the coin not banked before, got ${r.result.earned}`);
    check(r.result.bestMs === 8000, 'best time is kept, not overwritten by a slower run');
    p = r.progress;
    r = S.applyClear(p, levels, payouts, 'w1_01', 8500, 99);
    check(r.result.earned === 0, `coins are capped at the level's count, got ${r.result.earned}`);
    check(p.wallet === 122 + 24 + 1, `wallet adds up to 147, got ${p.wallet}`);

    // 4. prize
    r = S.applyClear(p, levels, payouts, 'w1_02', 5000, 0);
    check(r.result.accepted && r.result.prize === 'rubberCoat' && r.progress.prizes.includes('rubberCoat'), 'the world\'s last level grants its prize');
    p = r.progress;
    r = S.applyClear(p, levels, payouts, 'w1_02', 5000, 0);
    check(r.result.prize === null && p.prizes.length === 1, 'a prize is granted once');

    // 5. spend
    let sp = S.spendFrom(p, p.wallet + 1);
    check(!sp.ok && sp.progress === p, 'cannot spend more than the wallet holds');
    sp = S.spendFrom(p, 100);
    check(sp.ok && sp.progress.wallet === p.wallet - 100, 'spending takes from the wallet');
    check(!S.spendFrom(p, -5).ok, 'a negative spend is refused');

    // 6. save round-trip and corruption
    const back = S.parseProgress(JSON.stringify(p));
    check(JSON.stringify(back) === JSON.stringify(p), 'a save round-trips exactly');
    for (const bad of [null, '', '{nope', '{"v":99,"wallet":5}', '[]']) {
        check(JSON.stringify(S.parseProgress(bad)) === JSON.stringify(S.freshProgress()), `a bad save (${JSON.stringify(bad)}) starts fresh`);
    }
    check(S.parseProgress('{"v":1,"wallet":-50}').wallet === 0, 'a negative wallet is not loaded');

    // 7. the store writes through
    const mem = new Map();
    const store = S.createProgressStore({ load: async k => mem.get(k) || null, save: (k, v) => { mem.set(k, v); return true; } }, levels, payouts);
    await store.load();
    store.recordClear('w1_01', 1000, 0);
    check(!mem.has(S.SAVE_KEY), 'a rejected clear writes nothing');
    store.recordClear('w1_01', 12000, 3);
    check(mem.has(S.SAVE_KEY) && JSON.parse(mem.get(S.SAVE_KEY)).wallet === 123, 'an accepted clear is saved at once');
    const again = S.createProgressStore({ load: async k => mem.get(k) || null, save: () => true }, levels, payouts);
    check((await again.load()).wallet === 123, 'a new session loads what the last one saved');
    check(store.spend(23) && JSON.parse(mem.get(S.SAVE_KEY)).wallet === 100, 'a spend is saved at once');

    // 8. Rewarded ads pay fixed, bounded amounts, and the free coins wait out
    //    their cooldown -- across a save and reload too.
    const C = await import('./shopCatalog.js');
    let q = S.freshProgress();
    let ad = S.adCoins(q, 1000000);
    check(ad.ok && ad.progress.wallet === C.AD_REWARDS.coins, 'a free-coins ad pays AD_REWARDS.coins');
    q = ad.progress;
    check(!S.adCoins(q, 1000000 + 1000).ok, 'and not again inside its cooldown');
    check(S.adCoinsWaitMs(q, 1000000 + 1000) === C.AD_REWARDS.coinsCooldownMs - 1000, 'the wait is what is left of the cooldown');
    check(!S.adCoins(S.parseProgress(JSON.stringify(q)), 1000000 + 1000).ok, 'a reload does not reset the cooldown');
    check(S.adCoins(q, 1000000 + C.AD_REWARDS.coinsCooldownMs).ok, 'it pays again once the cooldown is over');
    const dbl = S.adDoubleClear(q, 120);
    check(dbl.ok && dbl.amount === 120 && dbl.progress.wallet === q.wallet + 120, 'doubling a clear pays its pay again');
    check(S.adDoubleClear(q, 99999).amount === C.AD_REWARDS.doubleCap, 'capped at AD_REWARDS.doubleCap');
    check(!S.adDoubleClear(q, 0).ok && !S.adDoubleClear(q, -5).ok, 'nothing to double for a clear that paid nothing');
    const ch = S.adCharge(q, 'shield');
    check(ch.ok && ch.progress.charges.shield === 1 && !S.adCharge(q, 'rocket').ok, 'an ad charge adds one known power-up');

    // 9. A free upgrade step: the next tier, only a cheap one, once per cooldown.
    let u = S.freshProgress();
    const t0 = 5000000;
    let up = S.adUpgrade(u, 'grip', t0);
    check(up.ok && up.progress.upgrades.grip === 1 && up.progress.wallet === 0, 'a free upgrade step adds one tier and costs nothing');
    u = up.progress;
    check(!S.adUpgrade(u, 'brakes', t0 + 1000).ok, 'and only one per cooldown, across upgrades');
    check(!S.adUpgrade(S.parseProgress(JSON.stringify(u)), 'brakes', t0 + 1000).ok, 'a reload does not reset it');
    const later = t0 + C.AD_REWARDS.upgradeCooldownMs;
    up = S.adUpgrade(u, 'grip', later);
    check(up.ok && up.progress.upgrades.grip === 2, 'it gives again once the cooldown is over');
    check(S.adUpgrade(up.progress, 'grip', later + C.AD_REWARDS.upgradeCooldownMs).reason === 'too-dear', `a top tier (${C.UPGRADES.grip.prices[2]}) is never given away`);
    check(!S.adUpgrade(u, 'jetpack', later).ok, 'unknown upgrades are refused');
    check(C.UPGRADE_IDS.every(id => C.UPGRADES[id].prices[0] <= C.AD_REWARDS.upgradeMaxPrice), 'every upgrade has a first step an ad can give');

    if (failures.length) {
        console.error('FAIL: progress store\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: progress store -- ladder and time floor enforced, base/gold/coins paid once each, prizes granted once, no overspend, saves round-trip and corrupt saves start fresh, every change written through');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
