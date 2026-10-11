#!/usr/bin/env node
// PLANETILT: the shop -- catalog rules and purchases (shopCatalog.js,
// progressStore.js).
//
//   1. THE RULE (CLAUDE.md): nothing bought makes the ball faster or smaller.
//      No marble or crew step has a radius; no step leaves a marble with less
//      damping or grip than it had, or adds to any stat but grip, stopping and
//      response; response never lifts the tilt ceiling (mazeTilt.js clamps).
//   2. Prices come from the catalog, are positive, and track steps rise.
//   3. Purchases: refused when short, refused twice for a marble; each takes
//      exactly its price and gives exactly its thing.
//   4. Selecting a marble needs owning it; Classic is always owned.
//   5. Finishing a planet grants TRAP_GRANT of the next one's trap charge;
//      consume spends one at a time.
//   6. Old saves (from before the shop) load with Classic owned and selected.
//
// Negative control: give Glass `damping: 0.01` and 1 fails; give a TUNE entry
// `stat: 'bounce'` and 1 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const C = await import('./shopCatalog.js');
    const S = await import('./progressStore.js');
    const T = await import('./mazeTilt.js');

    // 1. never faster, never smaller
    const CR = await import('./crew.js');
    const classic = C.ballSetup('classic');
    for (const id of C.MARBLE_IDS) {
        const m = C.MARBLES[id];
        check(!('radius' in m) && !('radius' in m.stats), `${id}: a marble must not carry a radius -- radius belongs to the world`);
        const base = C.ballSetup(id, 0);
        for (let st = 0; st <= CR.TRACK_MAX; st++) {
            const b = C.ballSetup(id, st);
            check(b.damping >= classic.damping - 1e-9, `${id} step ${st}: damping ${b.damping} is below Classic's ${classic.damping} -- that is a faster ball`);
            check(b.damping >= base.damping - 1e-9 && b.grip >= base.grip - 1e-9 && b.bounce === base.bounce && b.spin === base.spin, `${id} step ${st}: a step only ever adds grip, stopping or response`);
            check(b.response <= 1.5 + 1e-9, `${id} step ${st}: response ${b.response} past 1.5`);
            check(!('radius' in b), `${id}: ballSetup must not produce a radius`);
        }
        check(m.stats.response > 0 && m.stats.response <= 1.5, `${id}: response ${m.stats.response} out of range`);
        check(CR.TUNE[id] && CR.TUNE_STATS.includes(CR.TUNE[id].stat) && CR.TUNE[id].per > 0, `${id}: tuned on grip, stopping or response only`);
        check(CR.SIGNATURES[id] && CR.SIGNATURES[id].name, `${id}: every marble carries a signature`);
    }
    // Response reaches full tilt with less lean; full tilt is still the same pull.
    for (const r of [1, 1.35, 1.5]) {
        const t = T.applyDeadzoneAndClamp(80, r);
        check(Math.abs(t) <= T.MAX_TILT_DEG + 1e-9, `a response of ${r} must not lift tilt past MAX_TILT_DEG (got ${t})`);
    }

    // 2. prices
    for (const id of C.MARBLE_IDS) check(id === 'classic' ? C.MARBLES[id].price === 0 : C.MARBLES[id].rescue ? !(C.MARBLES[id].price > 0) : C.MARBLES[id].price > 0, `${id}: bad price`);
    const ps = CR.TRACK.map(t => t.price);
    check(ps.every((v, i) => v > 0 && (i === 0 || v > ps[i - 1])) && CR.TRACK.every((t, i) => t.bond >= 2 && (i === 0 || t.bond > CR.TRACK[i - 1].bond)),
        `track steps must rise in price and bond, got ${ps}`);
    for (const id of C.CHARGE_IDS) check(C.CHARGES[id].price > 0, `${id}: bad charge price`);
    const P = await import('./mazePickups.js');
    check(C.CHARGE_IDS.filter(id => !C.CHARGES[id].cover).every(id => P.POWERUP_KINDS.includes(id)), 'every power-up sold must be one the game can fire');
    check(C.TRAP_CHARGE_IDS.length === 5 && C.TRAP_CHARGE_IDS.every(id => CR.COVER[C.CHARGES[id].cover] && C.CHARGES[id].world >= 1), 'each planet sells one trap charge, answering a kind the game covers');
    for (const id of C.MARBLE_IDS.filter(k => C.MARBLES[k].rescue)) {
        const sig = CR.SIGNATURES[id], ch = C.planetCharge(C.MARBLES[id].rescue);
        check(sig.kind === 'auto' && ch && sig.covers.includes(C.CHARGES[ch].cover) && sig.name === C.CHARGES[ch].name, `${id}: a friend's signature is their planet's trap charge (${sig.name} / ${ch})`);
    }

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

    r = S.buyCharge(p, 'shield');
    check(r.ok && r.progress.charges.shield === 1 && r.progress.wallet === p.wallet - C.CHARGES.shield.price, 'buying a power-up adds one charge');
    p = r.progress;

    // 5. a planet's trap charges via a clear, then consume
    const levels = [{ id: 'w1_10', world: 1, index: 1, minMs: 1000, goldMs: 5000, coins: [], prize: 'rubberCoat' }];
    const clr = S.applyClear(p, levels, { byWorld: {} }, 'w1_10', 6000, 0);
    p = clr.progress;
    check(p.charges.iceSkates === C.TRAP_GRANT, `finishing Sawturn grants ${C.TRAP_GRANT} Ice Skates, got ${p.charges.iceSkates}`);
    let n = 0;
    while (S.consume(p, 'charges', 'iceSkates').ok) { p = S.consume(p, 'charges', 'iceSkates').progress; n++; }
    check(n === C.TRAP_GRANT && !p.charges.iceSkates, `consume spends them one at a time down to none (spent ${n})`);
    check(!S.consume(p, 'charges', 'magnet').ok, 'cannot spend a charge you do not have');

    // 4. selection
    check(S.selectMarble(p, 'classic').ok, 'Classic is always owned and selectable');
    check(!S.selectMarble(p, 'glass').ok, 'cannot select a marble you do not own');

    // 6. old saves
    const old = S.parseProgress(JSON.stringify({ v: 2, wallet: 10, highestIndex: 2, cleared: {}, goldClaimed: [], prizes: [], charges: {} }));
    check(old.marble === 'classic' && old.marbles.join() === 'classic' && old.wallet === 10, 'a pre-shop save loads with Classic owned and selected');
    const tamper = S.parseProgress(JSON.stringify({ v: 2, marbles: ['glass', 'nonsense'], marble: 'nonsense', crew: { glass: 99, bogus: 2 } }));
    check(tamper.marble === 'classic' && !tamper.marbles.includes('nonsense'), 'unknown marbles in a save are dropped');
    check(tamper.crew.glass === CR.TRACK_MAX && !('bogus' in tamper.crew), 'track steps in a save are capped and strangers dropped');

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
    check(C.ballSetup('steel').grip === C.ballSetup('steel', 0).grip, 'ballSetup takes no look at all');

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
        console.log('PASS: shop -- nothing bought makes the ball faster or smaller, crew steps only add grip, stopping or response, prices are sane, purchases take exactly their price and refuse what they should, a finished planet grants the next one\'s trap charges, and old saves load cleanly');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
