#!/usr/bin/env node
// PLANETILT: the progress store's rules (progressStore.js).
//
// With no server, this is the ledger. What it must get right:
//   1. The ladder: a level is playable only once the one before it is cleared.
//   2. The time floor: a "clear" under the level's minMs does not count.
//   3. First-time-only pay: the base payout once, the gold bonus once, each
//      coin once (a replay banks only coins beyond its best).
//   4. Finishing a planet (its last level) gives the next planet's trap
//      charges, once.
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
    const CR = await import('./crew.js');
    const C = await import('./shopCatalog.js');
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
    check(r.result.accepted && r.result.prize === 'iceSkates' && r.progress.prizes.includes('rubberCoat') && r.progress.charges.iceSkates === C.TRAP_GRANT,
        `finishing Sawturn gives ${C.TRAP_GRANT} of Slipstonia's trap charge (Ice Skates): ${JSON.stringify(r.result.prize)} ${JSON.stringify(r.progress.charges)}`);
    p = r.progress;
    r = S.applyClear(p, levels, payouts, 'w1_02', 5000, 0);
    check(r.result.prize === null && p.prizes.length === 1 && r.progress.charges.iceSkates === C.TRAP_GRANT, 'and only once');

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
    // The clear pays 123 and its XP (playerLevel.js) reaches level 2, which pays too.
    const PL = await import('./playerLevel.js');
    const paid = 123 + PL.rewardFor(2).coins;
    check(mem.has(S.SAVE_KEY) && JSON.parse(mem.get(S.SAVE_KEY)).wallet === paid, `an accepted clear is saved at once (${paid}), got ${mem.has(S.SAVE_KEY) && JSON.parse(mem.get(S.SAVE_KEY)).wallet}`);
    const again = S.createProgressStore({ load: async k => mem.get(k) || null, save: () => true }, levels, payouts);
    check((await again.load()).wallet === paid, 'a new session loads what the last one saved');
    check(store.spend(23) && JSON.parse(mem.get(S.SAVE_KEY)).wallet === paid - 23, 'a spend is saved at once');

    // 8. Rewarded ads pay fixed, bounded amounts, and the free coins wait out
    //    their cooldown -- across a save and reload too.

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

    // 9. A free crew step: the next track step, only once bond allows it,
    // only a cheap one, once per cooldown. Bond is never given.
    let u = S.freshProgress();
    const t0 = 5000000;
    check(!S.adUpgrade(u, 'classic', t0).ok, 'no free step before the bond allows one');
    u.bond.classic = 300;   // bond level 3
    let up = S.adUpgrade(u, 'classic', t0);
    check(up.ok && up.progress.crew.classic === 1 && up.progress.wallet === 0 && up.progress.bond.classic === 300, 'a free step adds one track step, costs nothing and gives no bond');
    u = up.progress;
    check(!S.adUpgrade(u, 'classic', t0 + 1000).ok, 'and only one per cooldown');
    check(!S.adUpgrade(S.parseProgress(JSON.stringify(u)), 'classic', t0 + 1000).ok, 'a reload does not reset it');
    const later = t0 + C.AD_REWARDS.upgradeCooldownMs;
    up = S.adUpgrade(u, 'classic', later);
    check(up.ok && up.progress.crew.classic === 2, 'it gives again once the cooldown is over');
    const deep = { ...up.progress, bond: { classic: 1000 } };
    check(S.adUpgrade(deep, 'classic', later + C.AD_REWARDS.upgradeCooldownMs).reason === 'not-eligible', `a dear step (${CR.TRACK[2].price}) is never given away`);
    check(!S.adUpgrade(u, 'jetpack', later).ok && !S.adUpgrade(u, 'steel', later).ok, 'unknown and unowned characters are refused');
    check(CR.TRACK[0].price <= C.AD_REWARDS.upgradeMaxPrice, 'the first step is one an ad can give');

    // 10. The crew: bond from clears, steps bought in order once bond allows.
    let b = S.freshProgress();
    let rb = S.recordBond(b, 'classic', { accepted: true, firstClear: true, goldFirst: true });
    check(rb.ok && rb.gained === CR.BOND_XP.firstClear + CR.BOND_XP.goldFirst && rb.progress.bond.classic === rb.gained, `a first clear at gold earns ${rb.gained} bond`);
    check(S.recordBond(b, 'classic', { accepted: true, firstClear: false }).gained === CR.BOND_XP.replay, 'a replay earns less');
    check(!S.recordBond(b, 'classic', { accepted: false }).ok, 'a clear that did not count earns none');
    check(!S.recordBond(b, 'steel', { accepted: true, firstClear: true }).ok, 'a marble not owned (an ad trial) earns none');
    b = { ...b, wallet: 10000 };
    check(S.buyCrewStep(b, 'classic').reason === 'bond', 'a step waits for its bond level');
    b.bond = { classic: CR.BOND_LEVELS[1] };
    let st = S.buyCrewStep(b, 'classic');
    check(st.ok && st.progress.crew.classic === 1 && st.progress.wallet === 10000 - CR.TRACK[0].price, 'bond level 2 opens step 1, and coins buy it');
    check(S.buyCrewStep(st.progress, 'classic').reason === 'bond', 'step 2 waits for bond level 3');
    let full = { ...st.progress, bond: { classic: 99999 }, wallet: 99999 };
    for (let i = 0; i < 3; i++) full = S.buyCrewStep(full, 'classic').progress;
    check(full.crew.classic === CR.TRACK_MAX && S.buyCrewStep(full, 'classic').reason === 'maxed', 'the track ends at its last step');
    check(S.buyCrewStep({ ...b }, 'rubber').reason === 'not-owned', 'only owned characters advance');
    check(S.parseProgress(JSON.stringify({ ...full, crew: { classic: 99, nobody: 2 } })).crew.classic === CR.TRACK_MAX
        && !('nobody' in S.parseProgress(JSON.stringify({ ...full, crew: { nobody: 2 } })).crew), 'a save cannot hold steps past the track or for a stranger');

    // 11. Trap charges are sold once their planet is opened.
    const tl = [
        { id: 'w1_01', world: 1, index: 1, minMs: 2500, goldMs: 9000, coins: [] },
        { id: 'w2_01', world: 2, index: 2, minMs: 2500, goldMs: 9000, coins: [] }
    ];
    const rich = { ...S.freshProgress(), wallet: 1000 };
    check(S.buyCharge(rich, 'sureFoot', tl).ok, "Sawturn's charge is on sale from the start");
    check(S.buyCharge(rich, 'iceSkates', tl).reason === 'not-open', "Slipstonia's waits until Slipstonia opens");
    const opened = S.applyClear(rich, tl, { goldBonusPct: 0, byWorld: { 1: 1 } }, 'w1_01', 5000, 0).progress;
    check(S.worldOpen(opened, tl, 2) && S.buyCharge(opened, 'iceSkates', tl).ok, 'and is on sale once it is');

    // The rescue (rescue.js): freeing a floor-10 captive gives their marble, once.
    const f0 = S.freshProgress();
    check(Array.isArray(f0.rescued) && f0.rescued.length === 0, 'a new player has rescued no one');
    let rs = S.recordRescue(f0, 2);
    check(rs.ok && rs.marble === 'flurry' && rs.progress.rescued.join() === '2' && rs.progress.marbles.includes('flurry'), `freeing world 2's captive gives Flurry: ${JSON.stringify(rs.progress.rescued)} ${rs.progress.marbles}`);
    check(f0.rescued.length === 0 && !f0.marbles.includes('flurry'), 'recordRescue must not modify its input');
    check(rs.progress.marble === 'classic', 'a freed friend joins but Rolle stays selected');
    const twice = S.recordRescue(rs.progress, 2);
    check(!twice.ok && twice.reason === 'freed' && twice.progress === rs.progress, 'freeing a friend twice changes nothing');
    check(S.recordRescue(f0, 99).reason === 'unknown', 'a world with no captive frees no one');
    rs = S.recordRescue(rs.progress, 1);
    check(rs.progress.rescued.join() === '1,2', 'rescues are kept in world order');
    const junk = S.parseProgress(JSON.stringify({ ...f0, rescued: [4, 4, 'x', 99, 1.5, 3] }));
    check(junk.rescued.join() === '3,4' && junk.marbles.includes('bobble') && junk.marbles.includes('cinder'), `a save's rescues are cleaned, and their marbles owned: ${junk.rescued} ${junk.marbles}`);
    check(S.parseProgress(JSON.stringify({ ...f0, rescued: undefined })).rescued.length === 0, 'a save from before the rescue loads with no one rescued');

    if (failures.length) {
        console.error('FAIL: progress store\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: progress store -- ladder and time floor enforced, base/gold/coins paid once each, prizes granted once, no overspend, saves round-trip and corrupt saves start fresh, every change written through');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
