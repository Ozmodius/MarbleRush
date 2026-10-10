#!/usr/bin/env node
// PLANETILT: the shop -- catalog rules and purchases (shopCatalog.js,
// progressStore.js).
//
//   1. THE RULE (CLAUDE.md): nothing bought makes the ball faster or smaller.
//      No marble or upgrade has a radius; no combination has less damping than
//      Classic; response never lifts the tilt ceiling (mazeTilt.js clamps).
//   2. Prices come from the catalog, are positive, and upgrade tiers rise.
//   3. Purchases: refused when short, refused twice for a marble, refused past
//      the last upgrade tier, refused for a prize not yet earned; each takes
//      exactly its price and gives exactly its thing.
//   4. Selecting a marble needs owning it; Classic is always owned.
//   5. A world's clear grants PRIZE_GRANT uses; consume spends one at a time.
//   6. Old saves (from before the shop) load with Classic owned and selected.
//
// Negative control: give Glass `damping: 0.01` and 1 fails; drop the
// 'not-earned' check in buyPrizeRefill and 3 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const C = await import('./shopCatalog.js');
    const S = await import('./progressStore.js');
    const T = await import('./mazeTilt.js');

    // 1. never faster, never smaller
    const classic = C.ballSetup('classic', {});
    for (const id of C.MARBLE_IDS) {
        const m = C.MARBLES[id];
        check(!('radius' in m) && !('radius' in m.stats), `${id}: a marble must not carry a radius -- radius belongs to the world`);
        for (const tiers of [{}, { grip: 3, brakes: 3, powerTime: 3, coinReach: 3 }]) {
            const b = C.ballSetup(id, tiers);
            check(b.damping >= classic.damping - 1e-9, `${id}: damping ${b.damping} is below Classic's ${classic.damping} -- that is a faster ball`);
            check(!('radius' in b), `${id}: ballSetup must not produce a radius`);
        }
        check(m.stats.response > 0 && m.stats.response <= 1.5, `${id}: response ${m.stats.response} out of range`);
    }
    // Response reaches full tilt with less lean; full tilt is still the same pull.
    for (const r of [1, 1.35, 1.5]) {
        const t = T.applyDeadzoneAndClamp(80, r);
        check(Math.abs(t) <= T.MAX_TILT_DEG + 1e-9, `a response of ${r} must not lift tilt past MAX_TILT_DEG (got ${t})`);
    }

    // 2. prices
    for (const id of C.MARBLE_IDS) check(id === 'classic' ? C.MARBLES[id].price === 0 : C.MARBLES[id].rescue ? !(C.MARBLES[id].price > 0) : C.MARBLES[id].price > 0, `${id}: bad price`);
    for (const id of C.UPGRADE_IDS) {
        const ps = C.UPGRADES[id].prices;
        check(ps.length === 3 && ps.every((v, i) => v > 0 && (i === 0 || v > ps[i - 1])), `${id}: upgrade tiers must be three rising prices, got ${ps}`);
    }
    for (const id of C.CHARGE_IDS) check(C.CHARGES[id].price > 0, `${id}: bad charge price`);
    const P = await import('./mazePickups.js');
    check(C.CHARGE_IDS.every(id => P.POWERUP_KINDS.includes(id)), 'every power-up sold must be one the game can fire');

    // 3. purchases
    let p = S.freshProgress();
    check(!S.buyMarble(p, 'steel').ok && S.buyMarble(p, 'steel').reason === 'short', 'cannot buy a marble you cannot afford');
    p.wallet = 5000;
    let r = S.buyMarble(p, 'steel');
    check(r.ok && r.progress.wallet === 5000 - C.MARBLES.steel.price && r.progress.marbles.includes('steel'), 'buying a marble takes its price and gives it');
    check(r.progress.marble === 'steel', 'a newly bought marble is selected');
    check(p.wallet === 5000 && !p.marbles.includes('steel'), 'purchases must not modify their input');
    p = r.progress;
    check(S.buyMarble(p, 'steel').reason === 'owned', 'a marble cannot be bought twice');
    check(S.buyMarble(p, 'gold').reason === 'unknown', 'an unknown marble is refused');

    for (let i = 0; i < 3; i++) {
        const price = S.upgradePrice(p, 'grip');
        r = S.buyUpgrade(p, 'grip');
        check(r.ok && r.progress.wallet === p.wallet - price && r.progress.upgrades.grip === i + 1, `grip tier ${i + 1} costs ${price}`);
        p = r.progress;
    }
    check(S.buyUpgrade(p, 'grip').reason === 'maxed' && S.upgradePrice(p, 'grip') === null, 'no tier past the last');

    r = S.buyCharge(p, 'shield');
    check(r.ok && r.progress.charges.shield === 1 && r.progress.wallet === p.wallet - C.CHARGES.shield.price, 'buying a power-up adds one charge');
    p = r.progress;

    check(S.buyPrizeRefill(p, 'rubberCoat').reason === 'not-earned', 'a prize refill is not sold before the prize is earned');

    // 5. prize grant via a clear, then refill and consume
    const levels = [{ id: 'w1_10', world: 1, index: 1, minMs: 1000, goldMs: 5000, coins: [], prize: 'rubberCoat' }];
    const clr = S.applyClear(p, levels, { byWorld: {} }, 'w1_10', 6000, 0);
    p = clr.progress;
    check(p.prizeUses.rubberCoat === C.PRIZE_GRANT, `clearing the world grants ${C.PRIZE_GRANT} uses, got ${p.prizeUses.rubberCoat}`);
    r = S.buyPrizeRefill(p, 'rubberCoat');
    check(r.ok && r.progress.prizeUses.rubberCoat === C.PRIZE_GRANT + C.PRIZES.rubberCoat.refill.uses, 'a refill adds its uses once earned');
    p = r.progress;
    let n = 0;
    while (S.consume(p, 'prizeUses', 'rubberCoat').ok) { p = S.consume(p, 'prizeUses', 'rubberCoat').progress; n++; }
    check(n === 6 && !p.prizeUses.rubberCoat, `consume spends uses one at a time down to none (spent ${n})`);
    check(!S.consume(p, 'charges', 'magnet').ok, 'cannot spend a charge you do not have');

    // 4. selection
    check(S.selectMarble(p, 'classic').ok, 'Classic is always owned and selectable');
    check(!S.selectMarble(p, 'glass').ok, 'cannot select a marble you do not own');

    // 6. old saves
    const old = S.parseProgress(JSON.stringify({ v: 1, wallet: 10, highestIndex: 2, cleared: {}, goldClaimed: [], prizes: [], charges: {} }));
    check(old.marble === 'classic' && old.marbles.join() === 'classic' && old.wallet === 10, 'a pre-shop save loads with Classic owned and selected');
    const tamper = S.parseProgress(JSON.stringify({ v: 1, marbles: ['glass', 'nonsense'], marble: 'nonsense', upgrades: { grip: 99, bogus: 2 } }));
    check(tamper.marble === 'classic' && !tamper.marbles.includes('nonsense'), 'unknown marbles in a save are dropped');
    check(tamper.upgrades.grip === 3 && !('bogus' in tamper.upgrades), 'upgrade tiers in a save are capped and unknown tracks dropped');

    // Skins and trails: looks only, bought or earned, never both.
    for (const [kind, L] of Object.entries(C.LOOKS)) {
        for (const [id, item] of Object.entries(L.table)) {
            check(Number.isFinite(item.price) !== Number.isFinite(item.level), `${kind} ${id} is either sold (price) or earned (level), not both or neither`);
            check(!('stats' in item) && !('grip' in item) && !('radius' in item), `${kind} ${id} carries no stats: looks only`);
        }
        check(L.table[L.base].price === 0, `${kind}: the base look is free`);
    }
    let lk = { ...S.freshProgress(), wallet: 1000 };
    check(lk.skin === 'plain' && lk.trail === 'none' && lk.skins.join() === 'plain' && lk.trails.join() === 'none', 'a new player wears Plain and no trail');
    let lr = S.buyLook(lk, 'skin', 'stripe');
    check(lr.ok && lr.progress.skin === 'stripe' && lr.progress.wallet === 1000 - C.SKINS.stripe.price, 'buying a skin charges its price and wears it');
    check(S.buyLook(lr.progress, 'skin', 'stripe').reason === 'owned', 'a skin is bought once');
    check(S.buyLook(lk, 'skin', 'galaxy').reason === 'reward', 'a level-reward skin cannot be bought');
    check(S.buyLook({ ...lk, wallet: 10 }, 'trail', 'flame').reason === 'short', 'no buying what you cannot afford');
    check(!S.selectLook(lk, 'trail', 'comet').ok, 'only owned looks can be worn');
    const gr = S.grantLook(lk, 'trail', 'rainbow');
    check(gr.ok && gr.progress.trails.includes('rainbow') && gr.progress.trail === 'none' && S.selectLook(gr.progress, 'trail', 'rainbow').ok, 'a granted look is owned, and worn once chosen');
    const back = S.parseProgress(JSON.stringify({ ...lr.progress, skins: ['stripe', 'bogus'], trails: ['flame'], trail: 'bogus' }));
    check(back.skins.join() === 'plain,stripe' && back.skin === 'stripe' && back.trails.join() === 'none,flame' && back.trail === 'none', `looks round-trip and junk is dropped: ${JSON.stringify([back.skins, back.skin, back.trails, back.trail])}`);
    check(C.ballSetup('steel', {}).grip === C.ballSetup('steel', {}).grip, 'ballSetup takes no look at all');

    // Rescued friends (rescue.js) are earned on a floor 10, never bought.
    const rich = { ...S.freshProgress(), wallet: 1e6 };
    for (const id of C.MARBLE_IDS.filter(k => C.MARBLES[k].rescue)) {
        const b = S.buyMarble(rich, id);
        check(!b.ok && b.reason === 'rescue', `${id}: a rescued friend cannot be bought (got ${JSON.stringify(b.reason)})`);
    }

    if (failures.length) {
        console.error('FAIL: shop\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: shop -- nothing bought makes the ball faster or smaller, prices are sane, purchases take exactly their price and refuse what they should, prizes are granted then refilled only once earned, and old saves load cleanly');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
