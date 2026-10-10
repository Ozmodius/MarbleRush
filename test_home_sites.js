#!/usr/bin/env node
// PLANETILT: home's level select (homeSites.js) -- a planet's ten levels as
// landing sites on its face.
//   1. Every site faces the camera (well round the front, not on the rim),
//      so all ten are in view and tappable at once.
//   2. Seen face-on, every pair is at least 0.4 planet radii apart: on a
//      phone that is about 45 px, room for a finger on each.
//   3. The trail runs level to level, each hop shortish (no line across the
//      whole face), and floor 10 is the highest site, at the summit.
//   4. Trail arcs stay above the surface and end on their sites.
//
// Negative control: move a site to x 0.95 and 1 fails; put two at the same
// spot and 2 fails.
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
(async () => {
    const S = await import('./homeSites.js');
    const a = S.siteAngles(10);
    const p = a.map(x => S.sitePoint(x, 1));
    check(a.length === 10, 'ten sites');
    p.forEach((q, i) => check(q.z >= 0.5, `site ${i + 1} faces the camera (z ${q.z.toFixed(2)})`));
    let min = Infinity, pair = '';
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
        const d = Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y);
        if (d < min) { min = d; pair = `${i + 1}-${j + 1}`; }
    }
    check(min >= 0.4, `every pair at least 0.4 radii apart face-on (closest ${pair}: ${min.toFixed(2)})`);
    for (let i = 1; i < p.length; i++) {
        const d = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
        check(d <= 0.65, `the trail hop ${i} to ${i + 1} is short (${d.toFixed(2)})`);
    }
    check(p.every((q, i) => i === 9 || q.y < p[9].y), 'floor 10 is the summit');
    for (let i = 1; i < a.length; i++) {
        const arc = S.trailArc(a[i - 1], a[i], 1, 0.02, 10);
        const ends = Math.hypot(arc[0].x - p[i - 1].x * 1.02, arc[0].y - p[i - 1].y * 1.02, arc[0].z - p[i - 1].z * 1.02) < 1e-9
            && Math.hypot(arc[10].x - p[i].x * 1.02, arc[10].y - p[i].y * 1.02, arc[10].z - p[i].z * 1.02) < 1e-9;
        check(ends && arc.every(q => Math.hypot(q.x, q.y, q.z) >= 1.0199), `trail ${i}: ends on its sites and stays above the ground`);
    }
    if (failures.length) { console.log('FAIL: home sites'); for (const f of failures) console.log(' - ' + f); process.exitCode = 1; }
    else console.log(`PASS: home sites -- ten landing sites all facing the camera, at least ${min.toFixed(2)} radii apart, a trail of short hops to floor 10 at the summit, never under the ground`);
})();
