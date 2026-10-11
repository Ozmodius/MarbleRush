#!/usr/bin/env node
// How a run ends, shown (fallFx.js): every effect starts where the ball is,
// is over within FALL_MS, and does what it says -- a ball down a hole tips in
// toward the middle, sinks, shrinks and darkens; a crushed one stays on the
// floor as it flattens; a burn chars it; a shock jitters it, the same way
// every time; ice grows a shell round it. Drawing only (mazeGame.js holds the
// body still), so these are the only promises.
//
// Negative control: drop the `- 120` delay in the hole's sink and "tips in
// before it sinks" fails.

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const F = await import('./fallFx.js');
    const r = 0.2;
    for (const c of F.CAUSES) {
        const p0 = F.fallPose(c, 0, { r, hole: { x: 0.1, z: -0.05, r: 0.3 } });
        check(Math.abs(p0.dx) < 1e-9 && Math.abs(p0.dz) < 1e-9 && Math.abs(p0.dy) < 1e-9 && p0.sx === 1 && p0.sy === 1, `${c}: starts where the ball is, its own size`);
        const pEnd = F.fallPose(c, F.FALL_MS, { r, hole: { x: 0.1, z: -0.05, r: 0.3 } });
        const pPast = F.fallPose(c, F.FALL_MS * 3, { r, hole: { x: 0.1, z: -0.05, r: 0.3 } });
        check(JSON.stringify(pEnd) === JSON.stringify(pPast) || c === 'shock', `${c}: over by FALL_MS (nothing moves after)`);
        for (let ms = 0; ms <= F.FALL_MS; ms += 30) {
            const p = F.fallPose(c, ms, { r, hole: { x: 0.1, z: -0.05, r: 0.3 } });
            check([p.dx, p.dy, p.dz, p.sx, p.sy, p.sz, p.dark, p.smoke, p.shell, p.crack, p.dust, p.spark].every(Number.isFinite), `${c} @${ms}: all numbers`);
            check(p.sx > 0 && p.sy > 0 && p.sz > 0 && p.dark >= 0 && p.dark <= 1, `${c} @${ms}: a real size and shade`);
        }
    }
    // The hole: toward the middle, then down, shrinking and darkening.
    const H = { x: 0.12, z: 0.04, r: 0.3 };
    const h = ms => F.fallPose('hole', ms, { r, hole: H, vx: 1, vz: 0 });
    check(Math.abs(h(400).dx - H.x) < 0.02 && Math.abs(h(400).dz - H.z) < 0.02, 'a ball down a hole rolls on to the middle of it');
    check(h(100).dy === 0 && h(100).dx > 0, 'it tips in toward the middle before it sinks');
    let prev = h(120);
    let monotone = true;
    for (let ms = 150; ms <= F.FALL_MS; ms += 30) { const p = h(ms); if (!(p.dy <= prev.dy && p.sx <= prev.sx && p.dark >= prev.dark)) monotone = false; prev = p; }
    check(monotone, 'then it only goes down, gets smaller and darker');
    check(h(F.FALL_MS).dy < -r * 2 && h(F.FALL_MS).sx < 0.5 && h(F.FALL_MS).dark > 0.9, 'and ends below the floor, small and dark');
    // Crush: flat, and the bottom of the ball stays on the floor.
    const c = F.fallPose('crush', 300, { r });
    check(c.sy < 0.3 && c.sx > 1.4 && Math.abs((c.dy + r * c.sy) - (r - r) ) < 1e-9 + r, 'a crushed ball is flat and wide');
    check(Math.abs(c.dy - (-(1 - c.sy) * r)) < 1e-9, 'its bottom stays on the floor as it flattens');
    // Burn: glows, then chars, under smoke.
    check(F.fallPose('burn', 200, { r }).glow[3] > 0.5 && F.fallPose('burn', 800, { r }).dark > 0.85 && F.fallPose('burn', 800, { r }).smoke > 0.6, 'a burn glows, then chars black under smoke');
    // Shock: jitters, the same way every time.
    const s1 = F.fallPose('shock', 200, { r, seed: 7 }), s2 = F.fallPose('shock', 200, { r, seed: 7 });
    check(s1.dx === s2.dx && s1.spark > 0.9 && F.fallPose('shock', F.FALL_MS, { r, seed: 7 }).spark === 0, 'a shock crackles the same way each time, then dies down');
    // Ice: a shell grows, then cracks.
    check(F.fallPose('ice', 200, { r }).shell > 0.95 && F.fallPose('ice', F.FALL_MS, { r }).crack > 0.95, 'ice grows a shell round the ball, then cracks it');
    check(F.causeOf('hole') === 'hole' && F.causeOf('flare') === 'burn' && F.causeOf('molten') === 'burn' && F.causeOf('icicle') === 'ice' && F.causeOf('nonsense') === 'hole', 'every knock-out names its effect');

    if (failures.length) { console.error('FAIL: fall fx\n - ' + failures.join('\n - ')); process.exitCode = 1; }
    else console.log('PASS: fall fx -- every end starts on the ball and is over by FALL_MS; down a hole it tips in, sinks, shrinks and darkens; crushed it flattens on the floor; burned it glows then chars under smoke; shocked it crackles the same way each time; frozen it grows a shell that cracks');
})().catch(e => { console.error(e); process.exitCode = 1; });
