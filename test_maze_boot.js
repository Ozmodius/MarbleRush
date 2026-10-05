#!/usr/bin/env node
// MARBLE RUSH: the game boots and a level PLAYS, in a real browser.
//
// Phase 0's gate (docs/PLAN.md) is "a level plays on desktop and phone". The
// Node tests prove the rules; this proves the page: index.html -> main.js ->
// sceneHost + progress store -> level select -> a run -> a clear that is
// banked and survives a reload. It drives the real DOM (taps, keys) and steps
// the game through window.__mazeDebug, because this sandbox throttles rAF and
// a browser test waits on frames, never on a wall clock (CLAUDE.md).
//
// Run:  npm run test:browser   (needs Playwright; Chromium is preinstalled here)
//
// Negative control: break the ArrowDown mapping in mazeGame.js's KEY_DIRS and
// the steering check fails; skip store.recordClear in win() and the banking
// and reload checks fail.

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

// MAZE_ROOT=dist/crazygames runs the same checks against the BUILT bundle.
const ROOT = process.env.MAZE_ROOT ? path.resolve(__dirname, process.env.MAZE_ROOT) : __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const file = path.join(ROOT, url === '/' ? 'index.html' : url);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const server = await serve();
    const base = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const levels = JSON.parse(fs.readFileSync(path.join(ROOT, 'mazeLevels.json'), 'utf8')).levels;
    // The CrazyGames SDK is a third-party script; off their site it may fail
    // to load or to init, which platform.js tolerates by design. Its noise is
    // not this game's error.
    const foreign = t => /crazygames|sdk\./i.test(t);
    const errors = [];
    try {
        // A phone-shaped viewport with touch: the shape that matters.
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await ctx.newPage();
        page.on('pageerror', e => { if (!foreign(e.message + (e.stack || ''))) errors.push(e.message); });
        page.on('console', m => { if (m.type() === 'error' && !foreign(m.text() + JSON.stringify(m.location()))) errors.push(m.text()); });
        const dbg = (fn, ...args) => page.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);

        // --- boot -> home ------------------------------------------------
        await page.goto(base);
        await page.waitForSelector('#homeView', { state: 'visible', timeout: 30000 });
        check(await page.isHidden('#bootMsg'), 'the boot message must clear once the game is up');
        check(await page.isVisible('#tabBar'), 'the tab bar shows on the home screen');
        check(await page.evaluate(() => window.__mazeDebug.menuPhase()), 'the home planet is built behind the home screen');
        check((await page.textContent('#homeLevelNum')).trim() === 'LEVEL 1' && (await page.textContent('#homeLevelName')).trim() === levels[0].name,
            `home offers level 1 on a fresh save, shows "${await page.textContent('#homeLevelNum')} ${await page.textContent('#homeLevelName')}"`);
        check((await page.textContent('#homeWallet')).trim() === '0', 'home shows the coin balance');
        // --- the worlds tab lists the ladder ------------------------------
        await page.tap('#tab_worlds');
        await page.waitForSelector('#mazeSelect', { state: 'visible' });
        check(await page.isHidden('#homeView'), 'one tab at a time');
        check(await page.evaluate(() => window.__mazeDebug.backdrop()) === 'system', 'the worlds tab shows the solar system');
        check((await page.textContent('#worldSheetName')).trim() === 'Workshop', 'the sheet opens on the world of the next level');
        await page.locator('#worldLabel_2').click({ force: true });   // labels drift with their planets
        check((await page.textContent('#worldSheetName')).trim() === 'Glacier' && await page.locator('.level-node').count() === 0
            && /Coming/.test(await page.textContent('#worldSheetNote')), 'tapping a world not built yet says it is coming, with no levels');
        // A tap on the planet itself (just above its label) picks it too.
        const anchor = (await page.evaluate(() => window.__mazeDebug.worldAnchors())).find(x => x.n === 4);
        await page.mouse.click(anchor.x, anchor.y - 30);
        check((await page.textContent('#worldSheetName')).trim() === 'Toy Box', 'tapping a planet on the canvas selects its world');
        await page.locator('#worldLabel_1').click({ force: true });
        const rows = await page.$$eval('.level-node', els => els.map(e => ({ next: e.classList.contains('is-next'), locked: e.disabled })));
        check(rows.length === levels.length, `level select should list all ${levels.length} levels, got ${rows.length}`);
        check(rows[0] && rows[0].next && !rows[0].locked, 'on a fresh save, level 1 is the highlighted next level');
        check(rows.slice(1).every(r => r.locked), 'on a fresh save, every other level is locked');

        // --- a run: back home, tap PLAY, tap START -------------------------
        await page.tap('#tab_home');
        await page.tap('#homePlayBtn');
        check(await page.isHidden('#tabBar'), 'the tab bar hides during a level');
        await page.waitForSelector('#mazeStartBtn', { state: 'visible' });
        await page.tap('#mazeStartBtn');
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');

        // Steering: keys tilt the board the way they say (screen down is +z,
        // screen right is +x).
        const p0 = await dbg('ballPos');
        await page.keyboard.down('ArrowDown');
        const p1 = await dbg('advanceFrames', 30);
        await page.keyboard.up('ArrowDown');
        check(p1.z > p0.z + 0.2, `ArrowDown must roll the ball down the screen (+z): z ${p0.z.toFixed(2)} -> ${p1.z.toFixed(2)}`);
        await dbg('advanceFrames', 30);   // let it settle against whatever it hit
        const p2 = await dbg('ballPos');
        await page.keyboard.down('ArrowRight');
        const p3 = await dbg('advanceFrames', 30);
        await page.keyboard.up('ArrowRight');
        check(p3.x > p2.x + 0.05, `ArrowRight must roll the ball right (+x): x ${p2.x.toFixed(2)} -> ${p3.x.toFixed(2)}`);

        // A coin: put the ball on one and step.
        const lv1 = levels[0];
        await dbg('placeBall', lv1.coins[0].x, lv1.coins[0].z);
        await dbg('advanceFrames', 1);
        check(await dbg('coinsTaken') === 1, 'rolling onto a coin collects it');
        check((await page.textContent('#mazeCoins')).trim().startsWith('1'), 'the HUD coin count updates');

        // A fall: put the ball in a hole.
        await dbg('placeBall', lv1.holes[0].x, lv1.holes[0].z);
        await dbg('advanceFrames', 2);
        check(await dbg('phase') === 'falling', `a ball over a hole falls (phase ${await dbg('phase')})`);
        await dbg('advanceFrames', 3);
        await page.evaluate(() => new Promise(r => setTimeout(r, 900)));   // FALL_RESTART_MS is wall clock
        await dbg('advanceFrames', 1);
        check(await dbg('phase') === 'running' && await dbg('coinsTaken') === 0,
            'after a fall the run restarts with every coin back in place');

        // A clear: take a coin, age the run past the level's floor, warp to
        // the goal. The store banks it: base payout + 1 coin.
        await dbg('placeBall', lv1.coins[0].x, lv1.coins[0].z);
        await dbg('advanceFrames', 1);
        await dbg('ageRun', lv1.goldMs + 5000);   // a silver time, comfortably over minMs
        check(await dbg('warpToGoal'), 'reaching the goal wins the run');
        const prog = await dbg('progress');
        check(prog.cleared[lv1.id] && prog.highestIndex === 1, `the clear is recorded: ${JSON.stringify(prog.cleared)}`);
        check(prog.wallet === 120 + 1, `a first clear with one coin pays 121, wallet is ${prog.wallet}`);
        check(/CLEARED/.test(await page.textContent('#mazeStatus')), 'the status line reports the clear');
        await page.waitForSelector('#mazeNextBtn', { state: 'visible' });
        await page.tap('#mazeLevelsBtn');
        await page.waitForSelector('#mazeSelect', { state: 'visible' });
        check(await page.isVisible('#tabBar') && await page.isHidden('#mazeHud'), 'LEVELS after a clear opens the worlds tab with the tab bar');
        await page.tap('#tab_home');
        await page.tap('#homePlayBtn');
        await page.waitForSelector('#mazeExitBtn', { state: 'visible' });
        await page.tap('#mazeExitBtn');
        await page.waitForSelector('#homeView', { state: 'visible' });
        check(await page.evaluate(() => window.__mazeDebug.menuPhase()), 'the back button in a level returns home, planet and all');

        // --- conveyors move the ball on their own -------------------------
        const lv10 = levels.find(l => (l.conveyors || []).length);
        if (lv10) {
            check(await dbg('startLevelForTest', lv10.id), `can build ${lv10.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const belt = lv10.conveyors[0];
            const axis = belt.dir[1], sign = belt.dir[0] === '+' ? 1 : -1;
            const start = await dbg('placeBall', belt.x, belt.z);
            const end = await dbg('advanceFrames', 12);
            const moved = (end[axis] - start[axis]) * sign;
            check(moved > 0.05, `a ball left on a belt is carried along ${belt.dir} (moved ${moved.toFixed(3)})`);

            // World 1's last level is full forest: leafy canopies, and one
            // fades when the marble is under it, the others stay.
            const fo = await dbg('forest');
            check(fo && fo.canopies > 0, `${lv10.id} grows leafy canopies`);
            if (fo && fo.canopies) {
                const c = fo.centres[0];
                const op = await dbg('canopyFadeAt', c.x, c.z, 800);
                check(op[0] < 0.4, `a canopy fades over the marble (opacity ${op[0].toFixed(2)})`);
                const far = await dbg('canopyFadeAt', 99, 99, 2000);
                check(far.every(o => o > 0.95), 'with the marble away, every canopy is back to solid');
            }
        }

        // --- progress survives a reload ----------------------------------
        await page.reload();
        await page.waitForSelector('#homeView', { state: 'visible', timeout: 30000 });
        check((await page.textContent('#homeLevelNum')).trim() === 'LEVEL 2', 'after a clear and a reload, home offers level 2');
        await page.tap('#tab_worlds');
        const after = await page.$$eval('.level-node', els => els.map(e => ({ cleared: e.classList.contains('is-cleared'), next: e.classList.contains('is-next'), locked: e.disabled })));
        check(after[0].cleared, 'after a reload, level 1 shows as cleared');
        check(after[1].next && !after[1].locked, 'after a reload, level 2 is unlocked and next');
        check((await page.textContent('#mazeWallet')).trim() === '121', `after a reload, the wallet still holds 121, shows ${await page.textContent('#mazeWallet')}`);

        // --- the store and profile ----------------------------------------
        // A fresh page with a seeded save: enough coins to shop.
        const shopCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        await shopCtx.addInitScript(() => {
            if (sessionStorage.getItem('seeded')) return;
            sessionStorage.setItem('seeded', '1');
            localStorage.setItem('marbleRush.progress.v1', JSON.stringify({ v: 1, wallet: 2000, highestIndex: 0, cleared: {}, goldClaimed: [], prizes: [], charges: { slowmo: 1 } }));
        });
        const shop = await shopCtx.newPage();
        shop.on('pageerror', e => { if (!foreign(e.message + (e.stack || ''))) errors.push(e.message); });
        const sdbg = (fn, ...args) => shop.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);
        await shop.goto(base);
        await shop.waitForSelector('#homeView', { state: 'visible', timeout: 30000 });
        await shop.tap('#tab_store');
        await shop.waitForSelector('#storeView', { state: 'visible' });
        const rowBuy = (title) => shop.locator('.shop-row', { has: shop.locator('.shop-rowtitle', { hasText: new RegExp('^' + title + '$') }) }).locator('.shop-buy');
        await rowBuy('Air Brake').tap();
        await rowBuy('Shield').tap();
        let sp = await sdbg('progress');
        check(sp.upgrades.brakes === 1 && sp.charges.shield === 1 && sp.wallet === 2000 - 200 - 80,
            `buying Air Brake and a Shield is saved and charged: ${JSON.stringify({ u: sp.upgrades, c: sp.charges, w: sp.wallet })}`);
        check((await shop.textContent('#storeWallet')).trim() === '1,720', 'the store wallet updates after buying');
        await shop.tap('#tab_gear');
        await shop.waitForSelector('#profileView', { state: 'visible' });
        await shop.locator('.marble-card', { has: shop.locator('.marble-name', { hasText: 'Rubber' }) }).locator('.marble-action').tap();
        sp = await sdbg('progress');
        check(sp.marble === 'rubber' && sp.marbles.includes('rubber') && sp.wallet === 1720 - 900, `buying Rubber selects it: ${sp.marble}, wallet ${sp.wallet}`);
        check((await shop.textContent('#profileMarbleName')).trim() === 'Rubber', 'the profile shows Rubber as the next marble');
        await shop.tap('#tab_home');

        // The next game uses it all.
        await shop.tap('#homePlayBtn');
        await shop.tap('#mazeStartBtn');
        await shop.waitForFunction(() => window.__mazeDebug.phase() === 'running');
        await sdbg('advanceFrames', 1);
        check(await sdbg('ballColor') === '#e0563f', `the ball wears the Rubber marble, got ${await sdbg('ballColor')}`);
        check(/SHIELD/.test(await shop.textContent('#mazePowerups')), 'a bought shield is armed at the start of the run');
        check(await shop.isVisible('#mazeUse_slowmo'), 'a held slow-mo shows its tap button');
        await shop.tap('#mazeUse_slowmo');
        await sdbg('advanceFrames', 1);
        check(/SLOW/.test(await shop.textContent('#mazePowerups')) && !(await sdbg('progress')).charges.slowmo,
            'tapping slow-mo fires it and spends it from the inventory');
        const lvA = levels[0];
        await sdbg('placeBall', lvA.holes[0].x, lvA.holes[0].z);
        await sdbg('advanceFrames', 2);
        check(await sdbg('phase') === 'running', 'the bought shield saves the ball from the hole');
        check(!(await sdbg('progress')).charges.shield, 'the shield is spent from the inventory once it saves you');
        await shop.reload();
        await shop.waitForSelector('#homeView', { state: 'visible', timeout: 30000 });
        check((await sdbg('progress')).marble === 'rubber', 'the marble choice survives a reload');
        await shopCtx.close();

        check(!errors.length, 'no page errors:\n   ' + errors.join('\n   '));
    } finally {
        await browser.close();
        server.close();
    }

    if (failures.length) {
        console.error('FAIL: maze boot\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: maze boot -- the page boots to home with level 1 offered, the tab bar switches screens, a run steers the right way on keys, collects coins, falls and restarts, conveyors carry the ball, a clear is banked by the progress store, the store and profile buy and select, bought power-ups and the marble reach the run, and it all survives a reload');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
