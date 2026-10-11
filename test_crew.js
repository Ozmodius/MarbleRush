#!/usr/bin/env node
// PLANETILT: the crew (crew.js) -- signatures, bond and the track.
//
//   1. Every marble has a signature: an `auto` one names only cover kinds the
//      game asks about (COVER), a `tap` one a power the run can fire.
//   2. Signatures are per run: one free use, two after the second step --
//      never a permanent bonus.
//   3. Bond levels rise with XP in order, and the track opens step by step:
//      a step needs its bond level, in order, and ends at the last.
//   4. Tuning adds only to one of grip, stopping or response, and only on the
//      tuned steps (1 and 3).
//
// Negative control: make signatureUses(0) return Infinity and 2 fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const CR = await import('./crew.js');
    const C = await import('./shopCatalog.js');

    // 1. signatures
    for (const id of C.MARBLE_IDS) {
        const s = CR.SIGNATURES[id];
        check(s && s.name && s.blurb, `${id}: has a named signature`);
        if (!s) continue;
        if (s.kind === 'auto') check(s.covers.length && s.covers.every(k => k === 'fall' || CR.COVER[k]), `${id}: covers only kinds the game asks about (${s.covers})`);
        else check(s.kind === 'tap' && ['magnet', 'sight'].includes(s.power), `${id}: a tap signature fires a known power`);
    }
    for (const [k, c] of Object.entries(CR.COVER)) check((c.windowMs > 0) !== (c.lingerMs > 0), `${k}: covers for a window or while in contact, one or the other`);

    // 2. per run
    check(CR.signatureUses(0) === 1 && CR.signatureUses(1) === 1 && CR.signatureUses(2) === 2 && CR.signatureUses(4) === 2, 'one free use a run, two from the second step');
    check(!CR.hasAura(3) && CR.hasAura(4), 'the aura comes with the last step');

    // 3. bond and the track
    check(CR.bondInfo(0).level === 1 && CR.bondInfo(99).level === 1 && CR.bondInfo(100).level === 2 && CR.bondInfo(1e6).level === CR.BOND_MAX && CR.bondInfo(1e6).max, 'bond levels follow BOND_LEVELS');
    const bi = CR.bondInfo(150);
    check(bi.from === 100 && bi.to === 300, `the bar runs from this level to the next (${bi.from}-${bi.to})`);
    check(CR.bondForClear({ accepted: true, firstClear: true }) === CR.BOND_XP.firstClear && CR.bondForClear({ accepted: true }) === CR.BOND_XP.replay && CR.bondForClear(null) === 0, 'a clear earns bond, a refused one none');
    let p = { bond: {}, crew: {} };
    check(CR.nextStep(p, 'pip').step === 1 && !CR.nextStep(p, 'pip').ready, 'a new friend sees step 1, not yet ready');
    p = { bond: { pip: 100 }, crew: {} };
    check(CR.nextStep(p, 'pip').ready, 'bond level 2 readies step 1');
    p = { bond: { pip: 100 }, crew: { pip: 1 } };
    check(CR.nextStep(p, 'pip').step === 2 && !CR.nextStep(p, 'pip').ready, 'step 2 waits for bond level 3');
    check(CR.nextStep({ bond: { pip: 1e6 }, crew: { pip: 4 } }, 'pip') === null, 'the track ends at step 4');
    check(CR.crewStep({ crew: { pip: 99 } }, 'pip') === CR.TRACK_MAX, 'a step count is capped');

    // 4. tuning
    for (const id of C.MARBLE_IDS) {
        const t = CR.TUNE[id];
        const at = st => CR.tuneFor(id, st);
        check(at(0)[t.stat] === 0 && at(1)[t.stat] === t.per && at(2)[t.stat] === t.per && at(3)[t.stat] === 2 * t.per && at(4)[t.stat] === 2 * t.per, `${id}: tuned on steps 1 and 3 only`);
        check(Object.entries(at(4)).every(([k, v]) => k === t.stat || v === 0), `${id}: only its own stat is tuned`);
    }

    if (failures.length) { console.error('FAIL: crew\n - ' + failures.join('\n - ')); process.exitCode = 1; }
    else console.log('PASS: crew -- every marble carries a signature the game can fire, once a run (twice after the second step), bond opens the track step by step in order, and tuning adds only its own stat on steps 1 and 3');
})().catch(e => { console.error(e); process.exitCode = 1; });
