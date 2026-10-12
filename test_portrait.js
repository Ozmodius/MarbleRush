#!/usr/bin/env node
// A phone held portrait (portraitLock.js):
//   1. turnFor turns only a phone's landscape view (coarse pointer, a
//      phone's short side), never a tablet, a computer or the landing site,
//      and by the screen's own angle (90 unless it says 270).
//   2. toContent maps a viewport point into the turned page exactly as
//      style.css rotates it (the page's corners land on the phone's).
//   3. Every phone-width rule in style.css has its html.is-turned twin, so a
//      turned page lays out as the phone it is.
//
// Negative control: swap the 90 and 270 maps in toContent and 2 fails.

const fs = require('fs');
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const P = await import('./portraitLock.js');
    // 1.
    const phone = { coarse: true, screenShort: 390, width: 844, height: 390 };
    check(P.turnFor({ ...phone, angle: 90 }) === 90 && P.turnFor({ ...phone, angle: 270 }) === 270 && P.turnFor({ ...phone, angle: -90 }) === 270, 'a phone turned landscape is turned back by its own angle');
    check(P.turnFor({ ...phone }) === 90, 'with no angle reported, the usual way round');
    check(P.turnFor({ ...phone, width: 390, height: 844 }) === 0, 'a phone held upright is left alone');
    check(P.turnFor({ ...phone, coarse: false }) === 0, 'a computer is never turned');
    check(P.turnFor({ coarse: true, screenShort: 820, width: 1180, height: 820, angle: 90 }) === 0, 'a tablet turns freely');
    check(P.turnFor({ ...phone, angle: 90, landing: true }) === 0, 'never over the landing site');
    // 2. The page is W x H turned: its box H wide, W tall, rotated about the
    // viewport's centre (-90deg for 90, +90deg for 270, CSS y-down).
    const W = 844, H = 390;
    const rot = (deg, x, y) => { const r = deg * Math.PI / 180; return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) }; };
    for (const [turn, deg] of [[90, -90], [270, 90]]) {
        for (const [cx, cy] of [[0, 0], [H, 0], [0, W], [H, W], [120, 600]]) {
            // where the page's point (cx, cy) lands in the viewport
            const v = rot(deg, cx - H / 2, cy - W / 2);
            const vx = v.x + W / 2, vy = v.y + H / 2;
            const back = P.toContent(turn, vx, vy, W, H);
            check(Math.abs(back.x - cx) < 1e-6 && Math.abs(back.y - cy) < 1e-6, `turn ${turn}: the page's (${cx}, ${cy}) at viewport (${vx.toFixed(0)}, ${vy.toFixed(0)}) maps back (${back.x.toFixed(1)}, ${back.y.toFixed(1)})`);
        }
    }
    // A drag along the phone's own "down" is +y on the page whichever way it is turned.
    check(P.toContent(90, 500, 200, W, H).y > P.toContent(90, 400, 200, W, H).y, 'turned 90, the phone\'s down (viewport right) is the page\'s down');
    check(P.toContent(0, 10, 20, W, H).x === 10, 'upright, points pass through');
    // 3.
    const css = fs.readFileSync('style.css', 'utf8');
    const blocks = (q) => {
        const out = [];
        const re = new RegExp('@media \\(' + q.replace(/[()]/g, '\\$&') + '\\)\\s*\\{', 'g');
        let m;
        while ((m = re.exec(css))) {
            let i = re.lastIndex, d = 1, j = i;
            while (d) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
            out.push(css.slice(i, j - 1));
        }
        return out;
    };
    const twins = (q, pre) => blocks(q).flatMap(b => [...b.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, decl]) =>
        sel.split(',').map(x => pre + x.trim()).join(', ') + ' { ' + decl.trim() + ' }'));
    const want = [...twins('max-width: 560px', ':where(html.is-turned) '), ...twins('max-width: 400px', ':where(html.is-turned-narrow) ')];
    const missing = want.filter(t => !css.includes(t));
    check(want.length > 10 && !missing.length, `every phone-width rule has its turned twin (missing: ${missing.join(' | ')})`);
    check(/html\.is-turned body \{[^}]*rotate\(-90deg\)/.test(css) && /html\.is-turned\.turn-270 body \{[^}]*rotate\(90deg\)/.test(css), 'style.css turns the page the way toContent maps it');

    if (failures.length) { console.error('FAIL: portrait\n - ' + failures.join('\n - ')); process.exitCode = 1; }
    else console.log(`PASS: portrait -- a phone's landscape view is turned back by its own angle (never a tablet, a computer or the landing site), pointers map into the turned page exactly as it is rotated, and all ${want.length} phone-width rules have their turned twins`);
})().catch(e => { console.error(e); process.exitCode = 1; });
