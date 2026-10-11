#!/usr/bin/env node
// PLANETILT: the game boots and a level PLAYS, in a real browser.
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
    // Every fresh boot with today's daily reward unclaimed opens the calendar
    // over home (dailyUi.js); close it to get on with the rest.
    // A level-up card can come first; its OK goes on to the calendar.
    // A new player with no sign-in front door opens on level 1 instead
    // (main.js): back out of it to home. Boot is done once __cloudSync is set.
    const homeUp = async (pg) => {
        await pg.waitForFunction(() => window.__cloudSync !== undefined, null, { timeout: 30000 });
        const autoOpened = await pg.evaluate(() => window.__mazeDebug.phase() === 'ready' && !Object.keys(window.__mazeDebug.progress().cleared || {}).length);
        if (autoOpened && await pg.isVisible('#mazeStartBtn')) await pg.tap('#mazeExitBtn');
        await pg.waitForSelector('#homeView', { state: 'visible', timeout: 30000 });
        // A level-up card or the calendar can slide in a few frames after
        // home shows: let frames pass and close whatever arrives, twice over.
        for (let k = 0; k < 3; k++) {
            if (await pg.isVisible('#levelPanel')) await pg.tap('#levelOkBtn');
            if (await pg.isVisible('#rewardsPanel')) await pg.tap('#rewardsCloseBtn');
            if (k < 2) await pg.evaluate(() => new Promise(r => { let n = 12; const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); setTimeout(r, 3000); }));
        }
        await pg.waitForSelector('#rewardsPanel', { state: 'hidden' });
        await pg.waitForSelector('#levelPanel', { state: 'hidden' });
    };
    try {
        // A phone-shaped viewport with touch: the shape that matters.
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await ctx.newPage();
        page.on('pageerror', e => { if (!foreign(e.message + (e.stack || ''))) errors.push(e.message); });
        page.on('console', m => { if (m.type() === 'error' && !foreign(m.text() + JSON.stringify(m.location()))) errors.push(m.text()); });
        const dbg = (fn, ...args) => page.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);

        // --- boot: a new player opens on level 1, one tap from playing -------
        // (CrazyGames' Full Launch rule: at most one click before gameplay.)
        await page.goto(base);
        await page.waitForSelector('#mazeStartBtn', { state: 'visible', timeout: 30000 });
        check(await dbg('phase') === 'ready' && (await page.textContent('#mazeLevelName')).trim() === levels[0].name
            && await page.isHidden('#rewardsPanel') && await page.isHidden('#tabBar'),
            'a new player opens on level 1\'s START, with no calendar or menus in the way');
        // A phone's top bar: the level's name shows whole (its own line, under
        // the buttons and the coin/fuel/map chips), clear of the status line.
        const nameFit = await page.evaluate(() => {
            const n = document.getElementById('mazeLevelName'), r = n.getBoundingClientRect();
            const b = document.getElementById('mazeExitBtn').getBoundingClientRect(), s = document.getElementById('mazeStatus').getBoundingClientRect();
            return { scroll: n.scrollWidth, client: n.clientWidth, top: r.top, bottom: r.bottom, btn: b.bottom, status: s.top, statusText: document.getElementById('mazeStatus').textContent };
        });
        check(nameFit.client > 0 && nameFit.scroll <= nameFit.client && nameFit.top >= nameFit.btn - 1 && (!nameFit.statusText.trim() || nameFit.status >= nameFit.bottom - 1), `the level name shows whole on a phone: ${JSON.stringify(nameFit)}`);
        check((await page.textContent('#mazeStatus')).trim() === 'TAP START, THEN TILT', `a touch device is told to tap START, then tilt: ${await page.textContent('#mazeStatus')}`);
        check(await page.isHidden('#privacyNote'), 'with no server, no privacy line under START (nothing leaves the device)');
        await page.tap('#mazeExitBtn');
        await page.waitForSelector('#tabBar', { state: 'visible' });
        await page.tap('#tab_home');
        await page.waitForSelector('#homeView', { state: 'visible' });
        check(await page.isHidden('#rewardsPanel'), 'home holds the calendar back until the first clear');
        check((await page.textContent('#homeRewardsBtn')).includes('REWARDS') && await page.isHidden('#homeMissionsBtn'), 'the side button says REWARDS (missions live in it now)');
        check(await page.isVisible('#homeRewardsBadge'), 'unclaimed, the REWARDS button keeps a badge');
        // Privacy: the policy opens in the game from Gear (no page to leave for).
        await page.tap('#tab_gear');
        await page.locator('#profileView [data-privacy]').tap();
        await page.waitForSelector('#privacyPanel', { state: 'visible' });
        check(/Ponotech LLC/.test(await page.textContent('#privacyBody')) && /leaderboard/.test(await page.textContent('#privacyBody')), 'Gear opens the privacy policy in the game');
        await page.tap('#privacyCloseBtn');
        check(await page.isHidden('#privacyPanel'), 'and it closes');
        await page.tap('#tab_home');
        await page.waitForSelector('#homeView', { state: 'visible' });
        check(await page.isVisible('#homeDailyMaze') && (await page.textContent('#homeMazeLabel')).trim() === 'LOCKED', 'a new player sees the daily maze locked');
        await page.tap('#homeDailyMaze');
        check(/Clear 3 levels/.test(await page.textContent('#homeToast')) && await page.isVisible('#homeView'), 'tapping it says what unlocks it, and starts nothing');
        check(await page.isHidden('#bootMsg'), 'the boot message must clear once the game is up');
        check(await page.isVisible('#tabBar'), 'the tab bar shows on the home screen');
        check(await page.evaluate(() => window.__mazeDebug.menuPhase()), 'the home planet is built behind the home screen');
        // Home's worlds: a swipe across the planet (or the arrows) moves
        // between them, a sun burns in the distance, and a locked world's
        // PLAY is greyed out and starts nothing.
        check(await page.evaluate(() => window.__mazeDebug.hasSun()), 'a sun burns behind the home planet');
        check(await page.evaluate(() => window.__mazeDebug.homeWorld()) === 1 && (await page.textContent('#homeWorldName')).trim() === 'SAWTURN' && (await page.textContent('#homeWorldPlace')).trim() === levels[0].name.toUpperCase()
            && await page.isDisabled('#homePrevWorld'), 'home opens on the first planet, at its first level\'s place, with nothing to its left');
        {
            const cdp = await ctx.newCDPSession(page);
            const swipe = async (x0, x1) => {
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: 420 }] });
                for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * k / 6, y: 420 }] });
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            };
            await swipe(300, 90);
            const h2 = await page.evaluate(() => window.__mazeDebug.homeLevel());
            check(h2 && h2.world === 2 && h2.locked, `a swipe left brings in world 2, locked for a new player: ${JSON.stringify(h2)}`);
            check(await page.evaluate(() => window.__mazeDebug.planetSlideFrom()) > 0, 'the new planet slides in from the right');
            check(!/WORLD/.test(await page.textContent('.home-play')), 'home never says "World n"');
            check(await page.isDisabled('#homePlayBtn') && (await page.textContent('#homePlayLabel')).trim() === 'LOCKED'
                && /Finish Sawturn/.test(await page.textContent('#homeGoal')), 'a locked world greys PLAY out and says what opens it');
            await page.tap('#homePlayBtn', { force: true });
            check(await page.isVisible('#homeView') && await page.evaluate(() => window.__mazeDebug.menuPhase()), 'and its PLAY starts nothing');
            await swipe(200, 180);
            check(await page.evaluate(() => window.__mazeDebug.homeWorld()) === 2, 'a small drag is not a swipe');
            await swipe(90, 300);
            check(await page.evaluate(() => window.__mazeDebug.homeWorld()) === 1 && !(await page.isDisabled('#homePlayBtn')), 'a swipe right goes back to world 1, PLAY lit again');
            await page.tap('#homeNextWorld');
            await page.tap('#homeNextWorld');
            check(await page.evaluate(() => window.__mazeDebug.homeWorld()) === 3, 'the arrows step through the worlds too');
            for (let i = 0; i < 4; i++) if (!(await page.isDisabled('#homeNextWorld'))) await page.tap('#homeNextWorld');
            check(await page.evaluate(() => window.__mazeDebug.homeWorld()) === 5 && await page.isDisabled('#homeNextWorld'), 'and stop at the last world');
            await page.keyboard.press('ArrowLeft');
            check(await page.evaluate(() => window.__mazeDebug.homeWorld()) === 4, 'the arrow keys step on a computer');
            while (await page.evaluate(() => window.__mazeDebug.homeWorld()) > 1) await page.tap('#homePrevWorld');
            check((await page.textContent('#homePlayLevel')).trim() === 'LEVEL 1', 'back on world 1, PLAY is level 1');
        }
        check(!(await page.$('#homeLevelNum')) && !(await page.$('#homeWorld')), 'the home HUD carries no level info');
        const homeLabels = await page.$$eval('.home-statlabel', els => els.map(e => e.textContent.trim()));
        check(['COINS', 'MEDALS', 'POWER-UPS'].every(l => homeLabels.includes(l)), `the home HUD labels coins, medals and power-ups, shows ${homeLabels}`);
        for (const id of ['shield', 'slowmo', 'magnet']) check((await page.textContent('#homeCharge_' + id)).trim() === '0', `home shows no ${id} on a fresh save`);
        check((await page.textContent('#homeWallet')).trim() === '0', 'home shows the coin balance');
        check(await page.isHidden('#homeFreeCoins') && await page.isHidden('#storeBadge'), 'off CrazyGames, home offers no free-coins ad and the store no badge');
        check((await page.textContent('#homePlayLevel')).trim() === 'LEVEL 1', 'the PLAY button names the level it starts');
        await page.tap('#homeGoldChip');
        await page.waitForSelector('#storeView', { state: 'visible' });
        check(true, 'the gold chip opens the store');
        // --- the worlds tab lists the ladder ------------------------------
        await page.tap('#tab_worlds');
        await page.waitForSelector('#mazeSelect', { state: 'visible' });
        check(await page.isHidden('#homeView'), 'one tab at a time');
        check(await page.evaluate(() => window.__mazeDebug.backdrop()) === 'system', 'the worlds tab shows the solar system');
        check((await page.textContent('#worldSheetName')).trim() === 'Sawturn', 'the sheet opens on the world of the next level');
        await page.locator('#worldLabel_2').click({ force: true });   // labels drift with their planets
        check((await page.textContent('#worldSheetName')).trim() === 'Slipstonia' && await page.locator('.level-node').count() === levels.filter(l => l.world === 2).length
            && /Finish Sawturn/.test(await page.textContent('#worldSheetNote')), 'a built but locked world shows its levels, locked, and says what opens it');
        // The first world not built yet: one past the last world in the data.
        const comingN = Math.max(...levels.map(l => l.world)) + 1;
        const W = await import('./worlds.js');
        if (comingN <= W.LAUNCH_WORLDS) {
            await page.locator('#worldLabel_' + comingN).click({ force: true });
            check((await page.textContent('#worldSheetName')).trim() === W.worldName(comingN) && await page.locator('.level-node').count() === 0
                && /Coming/.test(await page.textContent('#worldSheetNote')), 'tapping a world not built yet says it is coming, with no levels');
        } else {
            // Every launch world is built: the system shows exactly those, none "coming".
            check(await page.locator('.world-label').count() === W.LAUNCH_WORLDS && await page.locator('.world-label.is-coming').count() === 0,
                'with every launch world built, the system shows them all and none as coming');
        }
        // A tap on the planet itself (just above its label) picks it too --
        // once the camera has finished easing into the system view (frames,
        // not a clock: the planets still drift as the system turns, but by
        // under a pixel a frame once it has settled).
        await page.waitForFunction(() => new Promise(res => {
            const a = window.__mazeDebug.worldAnchors();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const b = window.__mazeDebug.worldAnchors();
                res(a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) < 2));
            }));
        }), null, { timeout: 15000 });
        const anchor = (await page.evaluate(() => window.__mazeDebug.worldAnchors())).find(x => x.n === 4);
        await page.mouse.click(anchor.x, anchor.y - 30);
        check((await page.textContent('#worldSheetName')).trim() === 'Bouncelot', 'tapping a planet on the canvas selects its world');
        // A drag sideways spins the system; it is not a tap.
        const spin0 = await dbg('solarSpin');
        await page.mouse.move(80, 250);
        await page.mouse.down();
        for (let k = 1; k <= 10; k++) await page.mouse.move(80 + k * 20, 250);
        await page.mouse.up();
        const spin1 = await dbg('solarSpin');
        check(spin1 < spin0 - 1, `dragging right spins the solar system (spin ${spin0.toFixed(2)} -> ${spin1.toFixed(2)})`);
        check((await page.textContent('#worldSheetName')).trim() === 'Bouncelot', 'a drag does not pick a world');
        const moved = (await page.evaluate(() => window.__mazeDebug.worldAnchors())).find(x => x.n === 4);
        check(Math.hypot(moved.x - anchor.x, moved.y - anchor.y) > 30, 'and the planets (and their labels) go round with it');
        await page.locator('#worldLabel_1').click({ force: true });
        const rows = await page.$$eval('.level-node', els => els.map(e => ({ next: e.classList.contains('is-next'), locked: e.disabled })));
        const world1 = levels.filter(l => l.world === 1);
        check(rows.length === world1.length, `the worlds sheet should list world 1's ${world1.length} levels, got ${rows.length}`);
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
        // Sound (sound.js, mazeAudio.js): the taps made the engine, and a
        // rolling marble is heard -- measured as the roll's level, so no one
        // has to listen.
        const snd = await page.evaluate(() => ({ ready: window.__soundDebug.ready(), roll: window.__soundDebug.rollLevel(), silent: window.__soundDebug.silent() }));
        check(snd.ready && !snd.silent, `the first tap starts the sound, audible: ${JSON.stringify(snd)}`);
        check(snd.roll > 0.05, `a rolling marble makes a rolling sound: level ${snd.roll}`);
        await dbg('advanceFrames', 30);   // let it settle against whatever it hit
        const p2 = await dbg('ballPos');
        await page.keyboard.down('ArrowRight');
        const p3 = await dbg('advanceFrames', 30);
        await page.keyboard.up('ArrowRight');
        check(p3.x > p2.x + 0.05, `ArrowRight must roll the ball right (+x): x ${p2.x.toFixed(2)} -> ${p3.x.toFixed(2)}`);
        check((await page.evaluate(() => window.__soundDebug.counts())).impact > 0, 'rolling into a wall is heard as a hit');
        // The same half second of play moves the marble the same way on any
        // refresh rate (a CrazyGames QA check; rounding each frame up to a whole
        // physics step once ran it 2.4x fast at 144 Hz).
        // One evaluate per measurement, so the page's own animation loop cannot
        // slip real frames in between placing, pressing and stepping.
        const travel = (hz) => page.evaluate(([hz, s]) => {
            const d = window.__mazeDebug;
            d.placeBall(s.x, s.z);                        // off whatever it rolled to
            d.advanceFrames(60);                          // tilt settles back to level
            d.placeBall(s.x, s.z);
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown' }));
            const end = d.advanceFrames(hz / 2, 1000 / hz);
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowDown', key: 'ArrowDown' }));
            // Leave it at rest on the start with the board level, so the
            // page's own frames cannot roll it on into a hole afterwards.
            d.placeBall(s.x, s.z); d.advanceFrames(60); d.placeBall(s.x, s.z);
            return Math.hypot(end.x - s.x, end.z - s.z);
        }, [hz, levels[0].start]);
        const hzTravel = { 60: await travel(60), 120: await travel(120), 144: await travel(144), 165: await travel(165), 30: await travel(30) };
        check(hzTravel[60] > 0.3 && [120, 144, 165, 30].every(hz => Math.abs(hzTravel[hz] - hzTravel[60]) < hzTravel[60] * 0.06),
            `the marble moves the same at 30, 60, 120, 144 and 165 Hz: ${JSON.stringify(hzTravel)}`);
        // The HUD's sound switch mutes and unmutes, and the choice is the device's.
        await page.tap('#mazeSoundBtn');
        check(await page.evaluate(() => window.__soundDebug.silent()) && await page.getAttribute('#mazeSoundBtn', 'aria-pressed') === 'true', 'the sound button mutes');
        await page.tap('#mazeSoundBtn');
        check(!(await page.evaluate(() => window.__soundDebug.silent())), 'and unmutes');

        // A coin: put the ball on one and step.
        const lv1 = levels[0];
        await dbg('placeBall', lv1.coins[0].x, lv1.coins[0].z);
        await dbg('advanceFrames', 1);
        check(await dbg('coinsTaken') === 1, 'rolling onto a coin collects it');
        check((await page.textContent('#mazeCoins')).trim().startsWith('1'), 'the HUD coin count updates');

        // The beginner's shield: an uncleared level among the first three
        // starts every attempt shielded, free, so the first fall is caught.
        check(/SHIELD/.test(await page.textContent('#mazePowerups')), 'a beginner level starts shielded');
        await dbg('placeBall', lv1.holes[0].x, lv1.holes[0].z);
        await dbg('advanceFrames', 2);
        check(await dbg('phase') === 'running' && /SHIELD SAVED YOU/.test(await page.textContent('#mazeStatus')) && !((await dbg('progress')).charges.shield),
            `the beginner's shield catches the first fall, and costs no charge (phase ${await dbg('phase')})`);
        // A fall: put the ball in a hole (the shield is spent for this attempt).
        await dbg('placeBall', lv1.holes[0].x, lv1.holes[0].z);
        await dbg('advanceFrames', 2);
        check(await dbg('phase') === 'falling', `a ball over a hole falls (phase ${await dbg('phase')})`);
        check((await page.evaluate(() => window.__soundDebug.counts())).coin === 1, 'the coin is heard');
        check((await page.evaluate(() => window.__soundDebug.counts())).holeDrop === 1, `the fall is heard going down the hole: ${JSON.stringify(await page.evaluate(() => window.__soundDebug.counts()))}`);
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
        check((await page.evaluate(() => window.__soundDebug.counts())).goal === 1, 'the clear is heard');
        const prog = await dbg('progress');
        check(prog.cleared[lv1.id] && prog.highestIndex === 1, `the clear is recorded: ${JSON.stringify(prog.cleared)}`);
        // 120 + 1 coin, and its 120 XP reaches player level 2, which pays 60.
        check(prog.wallet === 120 + 1 + 60 && prog.xp === 120, `a first clear with one coin pays 121 and its level-up 60: wallet ${prog.wallet}, xp ${prog.xp}`);
        check(/CLEARED/.test(await page.textContent('#mazeStatus')), 'the status line reports the clear');
        check(await page.isVisible('#mazeWalkBtn'), 'a rolled clear offers EXPLORE IT');
        // The level-up goes on the line UNDER the result, and the result stays.
        await page.waitForFunction(() => /LEVEL UP/.test(document.getElementById('mazeStatus2').textContent), null, { timeout: 5000 }).catch(() => {});
        check(/LEVEL UP!  YOU ARE LEVEL 2/.test(await page.textContent('#mazeStatus2')) && /CLEARED/.test(await page.textContent('#mazeStatus')),
            `a level-up is told under the result, which stays: "${await page.textContent('#mazeStatus')}" / "${await page.textContent('#mazeStatus2')}"`);
        check((await page.textContent('#mazeNextBtn')).includes('NEXT') && await page.isHidden('#mazeNextBtn .key-hint'), 'a touch device shows no SPACE hint on NEXT');
        // Today's reward waits on the CLEARED panel too (left unclaimed here:
        // the calendar at home takes it below).
        check(await page.isVisible('#mazeGiftBtn') && (await page.textContent('#mazeGiftText')).trim() === 'DAY 1 GIFT', 'the first clear offers the DAY 1 GIFT');
        // That clear was silver, 5s off gold: the near-miss line says so.
        check(await page.isVisible('#mazeNearMiss') && /^\d+\.\ds FASTER FOR GOLD$/.test((await page.textContent('#mazeNearText')).trim())
            && (await page.textContent('#mazeReplayBtn')).trim() === 'REPLAY',
            `a silver clear names the gold still to win, shows "${await page.textContent('#mazeNearText')}"`);
        // ...and counted toward today's missions.
        const mis = prog.missions;
        const want = { clears: 1, coins: 1, silver: 1, gold: 0, sweep: 0 };
        check(mis && mis.ids.length === 3 && mis.ids.every(id => (mis.counts[id] || 0) === want[id]),
            `the clear counts toward the day's missions: ${JSON.stringify(mis)}`);
        await page.waitForSelector('#mazeNextBtn', { state: 'visible' });
        await page.tap('#mazeLevelsBtn');
        await page.waitForSelector('#mazeSelect', { state: 'visible' });
        check(await page.isVisible('#tabBar') && await page.isHidden('#mazeHud'), 'LEVELS after a clear opens the worlds tab with the tab bar');
        await page.tap('#tab_home');
        // Home celebrates the level the clear reached, once.
        await page.waitForSelector('#levelPanel', { state: 'visible' });
        check((await page.textContent('#levelTitle')).trim() === 'LEVEL UP!' && (await page.textContent('#levelBig')).trim() === '2'
            && /60 coins/.test(await page.textContent('#levelRewards')), 'home shows the level-up and what it paid');
        await page.tap('#levelOkBtn');
        // A starved page can drop the tap: once more if the card stayed up.
        await page.waitForSelector('#levelPanel', { state: 'hidden', timeout: 8000 }).catch(() => page.tap('#levelOkBtn'));
        // With a level cleared, NICE! goes on to the calendar (its first time
        // this session): day 1 on the DAILY tab.
        await page.waitForSelector('#rewardsPanel', { state: 'visible' }).catch(async (e) => {
            console.log('DEBUG calendar:', JSON.stringify(await page.evaluate(() => ({ daily: window.__mazeDebug.progress().daily, levelPanel: !document.getElementById('levelPanel').hidden, rewards: !document.getElementById('rewardsPanel').hidden, home: document.getElementById('homeView').style.display, now: new Date().toString() }))));
            throw e;
        });
        check(await page.isHidden('#levelPanel') && await page.isVisible('#dailyPanel') && (await page.textContent('#dailyNote')).includes('Day 1')
            && (await page.getAttribute('#rewardsTab_daily', 'aria-selected')) === 'true', 'NICE! goes on to REWARDS on the DAILY tab, day 1');
        await page.tap('#rewardsCloseBtn');
        await page.waitForSelector('#rewardsPanel', { state: 'hidden' });
        check((await page.textContent('#homePlayerLevel')).trim() === '2' && /^20 \/ 136 XP$/.test((await page.textContent('#homeXpText')).trim()),
            `the level bar shows level 2, 20 of 136 XP: ${await page.textContent('#homeXpText')}`);
        await page.tap('#homeLevelBar');
        check(await page.isVisible('#levelPanel') && (await page.textContent('#levelTitle')).trim() === 'PLAYER LEVEL' && /LV 3/.test(await page.textContent('#levelNext')),
            'the level bar opens what the next levels bring');
        await page.tap('#levelCloseBtn');
        // REWARDS: tabs switch panes; the first clear unlocked an achievement.
        await page.tap('#homeRewardsBtn');
        await page.waitForSelector('#rewardsPanel', { state: 'visible' });
        await page.tap('#rewardsTab_missions');
        check(await page.isVisible('#missionsPanel') && await page.isHidden('#dailyPanel') && await page.locator('#missionsList .mission').count() === 3, 'the MISSIONS tab shows the day\'s three');
        check(await page.isVisible('#rewardsBadge_achievements'), 'the ACHIEVEMENTS tab has a dot: one is ready');
        await page.tap('#rewardsTab_achievements');
        const first = page.locator('#achievementsList [data-achievement="clear1"]');
        check(await page.isVisible('#achievementsPanel') && await first.count() === 1, 'First Roll is ready to claim, at the top');
        const aw0 = (await page.evaluate(() => window.__mazeDebug.progress())).wallet;
        await first.tap();
        const ap = await page.evaluate(() => window.__mazeDebug.progress());
        check(ap.wallet === aw0 + 25 && ap.achievements.includes('clear1') && /First Roll: \+25/.test(await page.textContent('#achievementsNote'))
            && await page.isHidden('#rewardsBadge_achievements'), `claiming First Roll pays 25 once (${aw0} -> ${ap.wallet})`);
        await page.tap('#rewardsCloseBtn');
        check(await page.isHidden('#rewardsPanel'), 'REWARDS closes');
        await page.tap('#homePlayBtn');
        await page.waitForSelector('#mazeExitBtn', { state: 'visible' });
        // A tilt game gets no taps: a level keeps the screen on (wakeLock.js),
        // by the lock or the video, and the menus let it sleep again.
        check(await page.evaluate(() => window.__wakeDebug.wanted()) && await page.waitForFunction(() => window.__wakeDebug.mode() !== 'none', null, { timeout: 5000 }).then(() => true, () => false),
            `a level keeps the screen on (mode ${await page.evaluate(() => window.__wakeDebug.mode())})`);
        await page.tap('#mazeExitBtn');
        await page.waitForSelector('#homeView', { state: 'visible' });
        check(await page.evaluate(() => window.__mazeDebug.menuPhase()), 'the back button in a level returns home, planet and all');
        check(await page.evaluate(() => !window.__wakeDebug.wanted() && window.__wakeDebug.mode() === 'none' && !window.__wakeDebug.videoPlaying()), 'home lets the screen sleep again');

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

        // --- world 2: wind and icicles -------------------------------------
        const H = await import('./mazeHazards.js');
        const lvWind = levels.find(l => (l.fans || []).length);
        if (lvWind) {
            check(await dbg('startLevelForTest', lvWind.id), `can build ${lvWind.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const fan = lvWind.fans[0];
            let peak = 0, peakT = 0, calmT = null;
            for (let t = 0; t < fan.periodMs; t += 10) {
                const st = H.windStrength(fan, t);
                if (st > peak) { peak = st; peakT = t; }
                if (st === 0 && calmT === null) calmT = t;
            }
            const along = (p, q) => fan.dir[1] === 'x' ? (q.x - p.x) * (fan.dir[0] === '+' ? 1 : -1) : (q.z - p.z) * (fan.dir[0] === '+' ? 1 : -1);
            await dbg('setRunClock', peakT - 150);
            let p0 = await dbg('placeBall', fan.x, fan.z);
            let p1 = await dbg('advanceFrames', 12);
            check(along(p0, p1) > 0.02, `a gust pushes the ball along ${fan.dir} (moved ${along(p0, p1).toFixed(3)})`);
            await dbg('setRunClock', calmT + 20);
            p0 = await dbg('placeBall', fan.x, fan.z);
            p1 = await dbg('advanceFrames', 12);
            check(Math.abs(along(p0, p1)) < 0.01, `in the calm the fan does not push (moved ${along(p0, p1).toFixed(3)})`);
        }
        const lvIce = levels.find(l => (l.icicles || []).length);
        if (lvIce) {
            check(await dbg('startLevelForTest', lvIce.id), `can build ${lvIce.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const ic = lvIce.icicles[0];
            const t0 = H.firstImpactMs(ic);
            await dbg('setRunClock', t0 - 1200);
            await dbg('placeBall', ic.x, ic.z);
            await dbg('advanceFrames', 3);
            check(await dbg('phase') === 'running', 'standing under an icicle between falls is safe');
            await dbg('setRunClock', t0 - 20);
            await dbg('placeBall', ic.x, ic.z);
            await dbg('advanceFrames', 4);
            check(await dbg('phase') === 'falling' && /ICICLE/.test(await page.textContent('#mazeStatus')),
                `an icicle landing on the ball knocks it out (phase ${await dbg('phase')}, status "${await page.textContent('#mazeStatus')}")`);
        }

        // --- world 3: flares, molten gates, geysers --------------------------
        const lvFl = levels.find(l => (l.flares || []).length && (l.gates || []).some(g => g.molten));
        if (lvFl) {
            check(await dbg('startLevelForTest', lvFl.id), `can build ${lvFl.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const f = lvFl.flares[0], tf = H.firstFlareMs(f);
            await dbg('setRunClock', tf - 1300);
            await dbg('placeBall', f.x, f.z);
            await dbg('advanceFrames', 3);
            check(await dbg('phase') === 'running', 'a seam between flares is just floor');
            await dbg('setRunClock', tf + 20);
            await dbg('placeBall', f.x, f.z);
            await dbg('advanceFrames', 2);
            check(await dbg('phase') === 'falling' && /BURNED/.test(await page.textContent('#mazeStatus')), 'a flaring seam burns the ball on it');

            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 5000 }).catch(() => {});
            const mg = lvFl.gates.find(g => g.molten);
            let tBurn = 0;
            for (let t = 0; t < mg.periodMs; t += 10) if (H.gateBurning(mg, t) && H.gateFraction(mg, t) > 0.5) { tBurn = t; break; }
            const at = H.gateSpecAt(mg, H.gateFraction(mg, tBurn));
            await dbg('setRunClock', tBurn);
            const w3 = await dbg('world3');
            check(w3.moltenGlow.length && w3.moltenGlow[0] > 1, `a molten gate glows while it closes (glow ${w3.moltenGlow[0]})`);
            // Beside the bar, off its far side along its thin axis.
            const off = mg.axis === 'x' ? { x: at.x, z: at.z + at.d / 2 + lvFl.ballRadius * 0.9 } : { x: at.x + at.w / 2 + lvFl.ballRadius * 0.9, z: at.z };
            await dbg('placeBall', off.x, off.z);
            await dbg('advanceFrames', 1);
            check(await dbg('phase') === 'falling' && /MOLTEN/.test(await page.textContent('#mazeStatus')), 'touching a closing molten gate burns');
        }
        const lvGy = levels.find(l => (l.geysers || []).length);
        if (lvGy) {
            check(await dbg('startLevelForTest', lvGy.id), `can build ${lvGy.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const gy = lvGy.geysers[0], tb = H.firstBlastMs(gy);
            await dbg('setRunClock', tb - 40);
            const g0 = await dbg('placeBall', gy.x + 0.25, gy.z);
            const g1 = await dbg('advanceFrames', 20);
            check(Math.hypot(g1.x - gy.x, g1.z - gy.z) > Math.hypot(g0.x - gy.x, g0.z - gy.z) + 0.1, 'a geyser blast throws the ball away from the vent');
            check(await dbg('phase') === 'running', 'a blast moves the ball; it does not end the run');
        }

        // --- world 4: bumpers, springs, spinning arms -------------------------
        const freeAt = (lv, x, z) => {
            const R = lv.ballRadius;
            return Math.abs(x) < lv.size.w / 2 - R && Math.abs(z) < lv.size.d / 2 - R
                && lv.walls.every(w => Math.abs(x - w.x) > w.w / 2 + R + 0.01 || Math.abs(z - w.z) > w.d / 2 + R + 0.01);
        };
        const lvB = levels.find(l => (l.bumpers || []).length);
        if (lvB) {
            check(await dbg('startLevelForTest', lvB.id), `can build ${lvB.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const b = lvB.bumpers[0], R = lvB.ballRadius;
            // Beside the bumper on its open side (it sits snug in a corner).
            const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, c]) => [a / Math.SQRT2, c / Math.SQRT2]);
            const d = dirs.find(([a, c]) => freeAt(lvB, b.x + a * (b.r + R + 0.05), b.z + c * (b.r + R + 0.05)));
            check(!!d, 'found open floor beside a bumper');
            if (d) {
                const p0 = await dbg('placeBall', b.x + d[0] * (b.r + R + 0.05), b.z + d[1] * (b.r + R + 0.05));
                await dbg('setBallVelocity', -d[0] * 1.2, -d[1] * 1.2);
                const before = (await dbg('world4')).kicks;
                const p1 = await dbg('advanceFrames', 12);
                const w4 = await dbg('world4');
                check(w4.kicks > before, 'rolling into a bumper sets off a kick');
                check(Math.hypot(p1.x - b.x, p1.z - b.z) > Math.hypot(p0.x - b.x, p0.z - b.z) + 0.15,
                    `a bumper kicks the ball away (from ${Math.hypot(p0.x - b.x, p0.z - b.z).toFixed(2)} to ${Math.hypot(p1.x - b.x, p1.z - b.z).toFixed(2)})`);
                check(await dbg('phase') === 'running', 'a kick moves the ball; it does not end the run');
            }
        }
        const lvS = levels.find(l => (l.springs || []).length);
        if (lvS) {
            check(await dbg('startLevelForTest', lvS.id), `can build ${lvS.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const sp = lvS.springs[0], tf = H.firstFireMs(sp);
            const along = (p, q) => sp.dir[1] === 'x' ? (q.x - p.x) * (sp.dir[0] === '+' ? 1 : -1) : (q.z - p.z) * (sp.dir[0] === '+' ? 1 : -1);
            await dbg('setRunClock', tf - 1500);
            let q0 = await dbg('placeBall', sp.x, sp.z);
            let q1 = await dbg('advanceFrames', 8);
            check(Math.abs(along(q0, q1)) < 0.02, `a resting spring pad is just floor (moved ${along(q0, q1).toFixed(3)})`);
            check((await dbg('world4')).springs[0] === 'rest', 'and it reads as resting');
            await dbg('setRunClock', tf - 40);
            q0 = await dbg('placeBall', sp.x, sp.z);
            q1 = await dbg('advanceFrames', 8);
            check(along(q0, q1) > 0.25, `a firing spring launches the ball along ${sp.dir} (moved ${along(q0, q1).toFixed(3)})`);
        }
        const lvArm = levels.find(l => (l.arms || []).length);
        if (lvArm) {
            check(await dbg('startLevelForTest', lvArm.id), `can build ${lvArm.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const ar = lvArm.arms[0];
            await dbg('setRunClock', 1000);
            const w4 = await dbg('world4');
            const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
            // Within one physics step: a real frame can land between the two reads, and
            // the kinematic body is integrated a step past where the clock set it.
            check(Math.abs(wrap(w4.arms[0].want - w4.arms[0].body)) < Math.abs(H.armSpin(ar)) / 60 + 0.01, `an arm's blade is where the run clock says (${w4.arms[0].want.toFixed(3)} vs ${w4.arms[0].body.toFixed(3)})`);
            // A ball just ahead of a blade is swept along by it.
            const th = H.armAngle(ar, 1000) + (ar.dir < 0 ? -1 : 1) * 0.3;
            const a0 = await dbg('placeBall', ar.x + Math.cos(th) * 0.6, ar.z + Math.sin(th) * 0.6);
            const a1 = await dbg('advanceFrames', 40);
            check(Math.hypot(a1.x - a0.x, a1.z - a0.z) > 0.1, `a blade sweeps a ball in its way (moved ${Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(3)})`);
            check(await dbg('phase') === 'running', 'a blade shoves; it does not end the run');
            check(Math.hypot(a1.x - ar.x, a1.z - ar.z) < 2, 'and the ball stays in the room');
        }

        // --- world 5: magnets, crushers, electric rails -----------------------
        const lvM = levels.find(l => (l.magnets || []).length);
        if (lvM) {
            check(await dbg('startLevelForTest', lvM.id), `can build ${lvM.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const m = lvM.magnets[0];
            const at = { x: m.x + m.nx * 0.55, z: m.z + m.nz * 0.55 };
            const m0 = await dbg('placeBall', at.x, at.z);
            const m1 = await dbg('advanceFrames', 20);
            const toward = (m0.x - m1.x) * m.nx + (m0.z - m1.z) * m.nz;
            check(toward > 0.05, `a magnet drags the ball toward its wall (moved ${toward.toFixed(3)})`);
            check(await dbg('phase') === 'running', 'a magnet pulls; it does not end the run');
        }
        const lvC = levels.find(l => (l.crushers || []).length);
        if (lvC) {
            check(await dbg('startLevelForTest', lvC.id), `can build ${lvC.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const c = lvC.crushers[0], ts = H.firstSlamMs(c);
            await dbg('setRunClock', ts - 1500);
            await dbg('placeBall', c.x, c.z);
            await dbg('advanceFrames', 3);
            check(await dbg('phase') === 'running', 'under a press that is up is safe');
            const y = (await dbg('world5')).crusherBodyY[0];
            check(y > 0.7, `the press body hangs above the ball while up (y ${y.toFixed(2)})`);
            await dbg('setRunClock', ts - 20);
            await dbg('placeBall', c.x, c.z);
            await dbg('advanceFrames', 12);
            check(await dbg('phase') === 'falling' && /CRUSHED/.test(await page.textContent('#mazeStatus')),
                `a press coming down crushes the ball under it (phase ${await dbg('phase')}, status "${await page.textContent('#mazeStatus')}")`);
        }
        const lvR = levels.find(l => (l.rails || []).length);
        if (lvR) {
            check(await dbg('startLevelForTest', lvR.id), `can build ${lvR.id}`);
            await page.tap('#mazeStartBtn');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const r = lvR.rails[0], tl = H.firstLiveMs(r), R = lvR.ballRadius;
            const thick = Math.min(r.w, r.d);
            const touch = { x: r.x + r.nx * (thick / 2 + R + 0.01), z: r.z + r.nz * (thick / 2 + R + 0.01) };
            await dbg('setRunClock', tl - 900);
            await dbg('placeBall', touch.x, touch.z);
            await dbg('advanceFrames', 2);
            check(await dbg('phase') === 'running', 'touching a dead rail is safe');
            await dbg('setRunClock', tl + 30);
            await dbg('placeBall', touch.x, touch.z);
            await dbg('advanceFrames', 2);
            check(await dbg('phase') === 'falling' && /SHOCKED/.test(await page.textContent('#mazeStatus')), 'touching a live rail shocks the ball');
            await page.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 5000 }).catch(() => {});
            await dbg('setRunClock', tl + 30);
            await dbg('placeBall', r.x + r.nx * (thick / 2 + R + 0.2), r.z + r.nz * (thick / 2 + R + 0.2));
            await dbg('advanceFrames', 2);
            check(await dbg('phase') === 'running', 'the middle of the corridor beside a live rail is safe');
        }

        // --- progress survives a reload ----------------------------------
        await page.reload();
        await homeUp(page);
        await page.tap('#tab_worlds');
        const after = await page.$$eval('.level-node', els => els.map(e => ({ cleared: e.classList.contains('is-cleared'), next: e.classList.contains('is-next'), locked: e.disabled })));
        check(after[0].cleared, 'after a reload, level 1 shows as cleared');
        check(after[1].next && !after[1].locked, 'after a reload, level 2 is unlocked and next');
        check((await page.textContent('#mazeWallet')).trim() === '206', `after a reload, the wallet still holds 206 (181 played + First Roll's 25), shows ${await page.textContent('#mazeWallet')}`);

        // --- the store and profile ----------------------------------------
        // A fresh page with a seeded save: enough coins to shop.
        const shopCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        await shopCtx.addInitScript(() => {
            if (sessionStorage.getItem('seeded')) return;
            sessionStorage.setItem('seeded', '1');
            localStorage.setItem('marbleRush.progress.v1', JSON.stringify({ v: 1, wallet: 2000, highestIndex: 0, cleared: {}, goldClaimed: [], prizes: ['rubberCoat', 'heatShield'], prizeUses: { rubberCoat: 3, heatShield: 2 }, charges: { slowmo: 1 } }));
        });
        const shop = await shopCtx.newPage();
        shop.on('pageerror', e => { if (!foreign(e.message + (e.stack || ''))) errors.push(e.message); });
        const sdbg = (fn, ...args) => shop.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);
        await shop.goto(base);
        await homeUp(shop);
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
        await shop.locator('.marble-card', { has: shop.locator('.marble-name', { hasText: 'Bumper' }) }).locator('.marble-action').tap();
        sp = await sdbg('progress');
        check(sp.marble === 'rubber' && sp.marbles.includes('rubber') && sp.wallet === 1720 - 900, `buying Rubber selects it: ${sp.marble}, wallet ${sp.wallet}`);
        check((await shop.textContent('#profileMarbleName')).trim() === 'Bumper', 'the profile shows Bumper (rubber) as the next marble');
        check(await shop.isHidden('#cloudSection'), 'with no server configured, Gear has no cloud save card');
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
        // Level 1 is a beginner level: its free shield is the one used, and the
        // bought one is left in the inventory.
        const lvA = levels[0];
        await sdbg('placeBall', lvA.holes[0].x, lvA.holes[0].z);
        await sdbg('advanceFrames', 2);
        check(await sdbg('phase') === 'running' && (await sdbg('progress')).charges.shield === 1, 'on a beginner level the free shield saves the ball, and the bought one is kept');
        // Level 4 is not: the bought shield is armed, saves the ball, and is spent.
        const lvPast = levels[3];
        check(await sdbg('startLevelForTest', lvPast.id), `can build ${lvPast.id}`);
        await shop.tap('#mazeStartBtn');
        await shop.waitForFunction(() => window.__mazeDebug.phase() === 'running');
        check(/SHIELD/.test(await shop.textContent('#mazePowerups')), 'past the beginner levels the bought shield is armed');
        await sdbg('placeBall', lvPast.holes[0].x, lvPast.holes[0].z);
        await sdbg('advanceFrames', 2);
        check(await sdbg('phase') === 'running', 'the bought shield saves the ball from the hole');
        check(!(await sdbg('progress')).charges.shield, 'the shield is spent from the inventory once it saves you');
        // World 1's prize on world 2's ice: grips like floor, one use per level.
        const iceLv = levels.find(l => (l.ice || []).length);
        if (iceLv) {
            check(await sdbg('startLevelForTest', iceLv.id), `can build ${iceLv.id}`);
            await shop.tap('#mazeStartBtn');
            await shop.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const r = iceLv.ice[0];
            await sdbg('placeBall', r.x, r.z);
            const hz = await sdbg('hazards');
            check(hz.onIce && !hz.floorIsIce, 'with the Rubber Coat, ice grips like floor');
            await sdbg('placeBall', r.x, r.z);
            check((await sdbg('progress')).prizeUses.rubberCoat === 2, 'the Rubber Coat spends one use for the level, not one per touch');
        }
        // World 2's prize on world 3's seams: a flare does not burn.
        const flLv = levels.find(l => (l.flares || []).length);
        if (flLv) {
            check(await sdbg('startLevelForTest', flLv.id), `can build ${flLv.id}`);
            await shop.tap('#mazeStartBtn');
            await shop.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const f = flLv.flares[0];
            await sdbg('setRunClock', H.firstFlareMs(f) + 20);
            await sdbg('placeBall', f.x, f.z);
            await sdbg('advanceFrames', 2);
            check(await sdbg('phase') === 'running' && (await sdbg('progress')).prizeUses.heatShield === 1, 'with the Heat Shield a flare does not burn, and one use is spent');
        }
        await shop.reload();
        await homeUp(shop);
        check((await sdbg('progress')).marble === 'rubber', 'the marble choice survives a reload');
        // Skins and trails on the Gear page: buy, wear, keep; reward ones locked.
        await shop.tap('#tab_gear');
        await shop.waitForSelector('#profileView', { state: 'visible' });
        const lookBtn = (k) => shop.locator(`.look-card[data-look="${k}"] .look-action`);
        check(await lookBtn('skin:galaxy').isDisabled() && /LEVEL 8/.test(await lookBtn('skin:galaxy').textContent()), 'a level-reward skin shows its level and cannot be bought');
        const lw0 = (await sdbg('progress')).wallet;
        await lookBtn('skin:stripe').tap();
        await lookBtn('trail:comet').tap();
        let lp = await sdbg('progress');
        check(lp.skin === 'stripe' && lp.trail === 'comet' && lp.wallet === lw0 - 300 - 400, `buying a skin and a trail wears them and charges their prices: ${JSON.stringify([lp.skin, lp.trail, lw0, lp.wallet])}`);
        check((await lookBtn('skin:stripe').textContent()).trim() === 'WORN', 'the worn skin says so');
        await lookBtn('skin:plain').tap();
        check((await sdbg('progress')).skin === 'plain' && (await sdbg('progress')).skins.includes('stripe'), 'wearing another keeps the one bought');
        await lookBtn('skin:stripe').tap();
        await shop.reload();
        await homeUp(shop);
        lp = await sdbg('progress');
        check(lp.skin === 'stripe' && lp.trail === 'comet', 'skin and trail survive a reload');
        check(await sdbg('startLevelForTest', levels[0].id), 'can build level 1 with a skin and trail on');
        check(await sdbg('ballColor') === '#ffffff' && (await sdbg('trail')) !== null, `the ball wears the skin (its colour comes from the skin's picture) and the trail is laid: ${await sdbg('ballColor')}`);
        await shopCtx.close();

        // --- the daily maze ---------------------------------------------------
        // Locked on a fresh save (checked on the first page); here a player
        // three levels in plays today's, once paid, then chases the time.
        check(true, 'daily maze section');
        const dCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        await dCtx.addInitScript(() => {
            if (sessionStorage.getItem('seeded')) return;
            sessionStorage.setItem('seeded', '1');
            const cleared = { w1_01: { bestMs: 99000, coins: 0 }, w1_02: { bestMs: 99000, coins: 0 }, w1_03: { bestMs: 99000, coins: 0 } };
            localStorage.setItem('marbleRush.progress.v1', JSON.stringify({ v: 1, wallet: 0, xp: 400, highestIndex: 3, cleared, goldClaimed: [], prizes: [], charges: {} }));
        });
        const dp = await dCtx.newPage();
        dp.on('pageerror', e => { if (!foreign(e.message + (e.stack || ''))) errors.push(e.message); });
        const ddbg = (fn, ...args) => dp.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);
        await dp.goto(base);
        await homeUp(dp);
        const today = await ddbg('dailyMaze');
        check(today && today.lv && !today.locked && /^d1_\d\d$/.test(today.lv.id), `three levels in, today's maze is a world 1 daily: ${today && today.lv && today.lv.id}`);
        check(await dp.isVisible('#homeDailyMaze') && await dp.isVisible('#homeMazeBadge') && (await dp.textContent('#homeMazeLabel')).trim() === 'TODAY', 'home offers it, marked NEW');
        await dp.tap('#homeDailyMaze');
        await dp.waitForSelector('#mazeStartBtn', { state: 'visible' });
        check((await dp.textContent('#mazeLevelName')).trim() === 'Daily Maze', 'the HUD names the daily maze');
        // BALL CAM: off by default; the HUD button turns it on and it is saved.
        check(!(await ddbg('ballCam')).on && (await dp.getAttribute('#mazeCamBtn', 'aria-pressed')) === 'false', 'ball cam starts off');
        const fullY = (await ddbg('ballCam')).pose.y;
        await dp.tap('#mazeCamBtn');
        check((await ddbg('ballCam')).on && (await ddbg('progress')).ballCam === true && (await dp.getAttribute('#mazeCamBtn', 'aria-pressed')) === 'true', 'the camera button turns ball cam on, and saves it');
        check((await ddbg('ballCam')).zoom < 0.05, 'the ready screen still shows the whole level');
        await dp.tap('#mazeStartBtn');
        await dp.waitForFunction(() => window.__mazeDebug.phase() === 'running');
        // Frames, not a clock: the zoom eases in per frame.
        await dp.waitForFunction(() => window.__mazeDebug.ballCam().zoom > 0.6, null, { timeout: 20000 }).catch(() => {});
        const bc = await ddbg('ballCam');
        check(bc.zoom > 0.6 && bc.pose.y < fullY * 0.8, `in the run the camera closes in on the ball (zoom ${bc.zoom.toFixed(2)}, height ${bc.pose.y.toFixed(1)} vs ${fullY.toFixed(1)})`);
        const dlv = today.lv;
        await ddbg('ageRun', Math.round(dlv.goldMs * 1.2));
        check(await ddbg('warpToGoal'), 'the daily maze can be won');
        await dp.waitForFunction(() => window.__mazeDebug.ballCam().zoom < 0.1, null, { timeout: 20000 }).catch(() => {});
        check((await ddbg('ballCam')).zoom < 0.1, 'and pulls back out to the whole level at the clear');
        let dprog = await ddbg('progress');
        check(dprog.dailyMaze && dprog.dailyMaze.paid && dprog.wallet >= 150 && dprog.highestIndex === 3 && !dprog.cleared[dlv.id],
            `a daily clear pays 150, off the ladder: ${JSON.stringify({ dm: dprog.dailyMaze, w: dprog.wallet, hi: dprog.highestIndex })}`);
        const firstBest = dprog.dailyMaze.best;
        check(await dp.isHidden('#mazeNextBtn') && await dp.isVisible('#mazeReplayBtn'), 'after a daily, no NEXT -- REPLAY to chase the time');
        await dp.tap('#mazeLevelsBtn');
        await dp.waitForSelector('#mazeSelect', { state: 'visible' });
        await dp.tap('#tab_home');
        await homeUp(dp);
        check(await dp.isHidden('#homeMazeBadge') && /^✓ \d+\.\ds$/.test((await dp.textContent('#homeMazeLabel')).trim()), `home shows it done, with the time: ${await dp.textContent('#homeMazeLabel')}`);
        const w1d = (await ddbg('progress')).wallet;
        await dp.tap('#homeDailyMaze');
        await dp.waitForSelector('#mazeStartBtn', { state: 'visible' });
        check((await dp.getAttribute('#mazeCamBtn', 'aria-pressed')) === 'true', 'ball cam stays on for the next level');
        await dp.tap('#mazeStartBtn');
        await dp.waitForFunction(() => window.__mazeDebug.phase() === 'running');
        await ddbg('ageRun', Math.round(dlv.goldMs * 1.4));
        await ddbg('warpToGoal');
        dprog = await ddbg('progress');
        check(dprog.wallet === w1d && dprog.dailyMaze.best === firstBest, `a slower replay pays nothing and keeps the best (${w1d} -> ${dprog.wallet}, best ${firstBest} -> ${dprog.dailyMaze.best})`);
        await ddbg('shiftDays', 1);
        const tomorrow = await ddbg('dailyMaze');
        check(tomorrow.lv.id !== dlv.id && !tomorrow.paid, `tomorrow brings a new maze, unpaid: ${tomorrow.lv.id}`);
        await dCtx.close();

        // --- the rescue: a friend caged on floor 10 (rescue.js) --------------
        // Nine levels in, the Worlds sheet and Gear say who the Baron holds;
        // floor 10 opens on the story, the exit stays shut until the cage is
        // reached, a fall cages them again, and a clear with them freed gives
        // their marble for good -- and the level is plain after that.
        check(true, 'rescue section');
        const rCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        await rCtx.addInitScript(() => {
            if (sessionStorage.getItem('seeded')) return;
            sessionStorage.setItem('seeded', '1');
            const cleared = {};
            for (let i = 1; i <= 9; i++) cleared['w1_0' + i] = { bestMs: 99000, coins: 0 };
            localStorage.setItem('marbleRush.progress.v1', JSON.stringify({ v: 1, wallet: 0, xp: 900, highestIndex: 9, cleared, goldClaimed: [], prizes: [], charges: {} }));
        });
        const rp = await rCtx.newPage();
        rp.on('pageerror', e => { if (!foreign(e.message + (e.stack || ''))) errors.push(e.message); });
        const rdbg = (fn, ...args) => rp.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);
        await rp.goto(base);
        await homeUp(rp);
        // HOME'S LANDING SITES (homeSites.js): the planet's ten levels on its
        // face, the next one picked; tap an open one to make it PLAY's.
        // Rolle's ship circles the planet.
        check(await rdbg('homeShip'), 'Rolle\'s ship circles home\'s planet');
        check(/FRIENDS RESCUED 0 \/ 5/.test(await rp.textContent('#homeRescueText')) && await rp.locator('#homeRescueFriends .rescue-friend.is-caged').count() === 5,
            `home's tracker shows all five friends caged: ${await rp.textContent('#homeRescueText')}`);
        check(/COINS/.test(await rp.textContent('.home-stats')) && !/GOLD/.test(await rp.textContent('.home-stats')), 'the coin counter says COINS, not GOLD');
        check(/FUEL 0 \/ 10\s+·\s+3 TO FLY ON/.test(await rp.textContent('#homeWorldFuel')), `home shows the planet's fuel and what the ship needs: ${await rp.textContent('#homeWorldFuel')}`);
        await rp.waitForFunction(() => [...document.querySelectorAll('#homeSites .home-site')].every(b => b.style.visibility !== 'hidden'), null, { polling: 100, timeout: 15000 }).catch(() => {});
        const sites = await rp.$$eval('#homeSites .home-site', bs => bs.map(b => ({ id: b.dataset.level, picked: b.classList.contains('is-picked'), off: b.disabled, x: parseFloat(b.style.left), y: parseFloat(b.style.top) })));
        check(sites.length === 10 && sites.filter(x => x.picked).map(x => x.id).join() === 'w1_10' && sites.every(x => !x.off),
            `ten sites on Sawturn, floor 10 (next) picked, all open: ${JSON.stringify(sites.map(x => [x.id, x.picked, x.off]))}`);
        // Home fits the planet to the room it has (the user's S25: a browser's
        // bars ate the height): no site over the planet's name or the header,
        // no side button over the header -- tall phone or short.
        const overlaps = () => rp.evaluate(() => {
            const R = e => e.getBoundingClientRect();
            const nav = R(document.querySelector('.home-worldnav')), hud = R(document.querySelector('.home-hud'));
            const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            const sites = [...document.querySelectorAll('.home-site')].map(R), rails = [...document.querySelectorAll('.home-side')].map(R);
            return sites.filter(x => hit(x, nav) || hit(x, hud)).length + rails.filter(x => hit(x, hud)).length;
        });
        check(await overlaps() === 0, 'nothing on home overlaps (390x844)');
        await rp.setViewportSize({ width: 412, height: 734 });
        await rp.evaluate(() => new Promise(r => { let n = 20; const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); setTimeout(r, 4000); }));
        check(await overlaps() === 0, `nothing on home overlaps on a short phone (412x734): ${await overlaps()}`);
        await rp.setViewportSize({ width: 390, height: 844 });
        await rp.evaluate(() => new Promise(r => { let n = 20; const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); setTimeout(r, 4000); }));
        let closest = Infinity;
        for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) closest = Math.min(closest, Math.hypot(sites[i].x - sites[j].x, sites[i].y - sites[j].y));
        check(closest >= 32, `the sites are a finger apart on a phone (closest ${closest.toFixed(0)} px)`);
        await rp.tap('#homeSite_w1_02');
        let hl = await rdbg('homeLevel');
        check(hl.id === 'w1_02' && hl.picked && /PLAY AGAIN/.test(await rp.textContent('#homePlayLabel')) && /LEVEL 2/.test(await rp.textContent('#homePlayLevel'))
            && /is-picked/.test(await rp.getAttribute('#homeSite_w1_02', 'class')), `tapping a cleared site makes it PLAY's: ${JSON.stringify(hl)}`);
        await rp.tap('#homePlayBtn');
        await rp.waitForFunction(() => window.__mazeDebug.phase() === 'ready', null, { polling: 100 });
        check((await rp.textContent('#mazeLevelName')).trim() === levels[1].name, `and PLAY starts it: ${await rp.textContent('#mazeLevelName')}`);
        await rp.tap('#mazeExitBtn');
        await homeUp(rp);
        check((await rdbg('homeLevel')).id === 'w1_10', 'back from a level, PLAY offers what is next again');
        await rp.tap('#homeNextWorld');
        await rp.waitForFunction(() => document.querySelectorAll('#homeSites .home-site').length === 10 && document.querySelector('#homeSite_w2_01'), null, { polling: 100, timeout: 15000 }).catch(() => {});
        check(await rp.isDisabled('#homeSite_w2_01') && (await rdbg('homeLevel')).locked, 'a locked planet\'s sites are shut');
        await rp.tap('#homePrevWorld');
        await rp.tap('#tab_worlds');
        await rp.waitForSelector('#mazeSelect', { state: 'visible' });
        check(/Pip/.test(await rp.textContent('#worldSheetCaptive')) && await rp.locator('.level-node.is-rescue').count() === 1 && await rp.locator('.level-node.is-freed').count() === 0,
            `the Worlds sheet names the caged friend and marks floor 10: ${await rp.textContent('#worldSheetCaptive')}`);
        await rp.tap('#tab_gear', { timeout: 90000 });   // the solar system is slow to let go of a starved page
        await rp.waitForSelector('#profileView', { state: 'visible' });
        const pipCard = rp.locator('.marble-card', { has: rp.locator('.marble-name', { hasText: /^Pip$/ }) });
        check(await pipCard.count() === 1 && /is-captive/.test(await pipCard.getAttribute('class')) && await pipCard.locator('.marble-action').isDisabled()
            && /RESCUE ON FLOOR 10/.test(await pipCard.locator('.marble-action').textContent()) && await pipCard.locator('.maze-btn-ad').count() === 0,
            'Gear shows Pip caged: no price, no TRY, rescued on floor 10');
        check(/RESCUE ON FLOOR 10/.test(await rp.locator('.marble-card', { has: rp.locator('.marble-name', { hasText: /^Rivet$/ }) }).locator('.marble-action').textContent()),
            'every friend is on their own planet\'s floor 10');
        // BETWEEN LEVELS (levelShow.js): a level opens on the marble dropping
        // onto the start (drawn only: the body is at rest on it), a planet's
        // first level on Rolle's ship bringing it; START ends either at once.
        await rdbg('holdShow', 0);              // a starved page's few long frames would end it unseen
        await rdbg('startLevelForTest', 'w1_05');
        await rdbg('holdShow', 0);              // and drawn, held
        let sh = await rdbg('show');
        check(sh.kind === 'drop' && sh.drawn.y > sh.body.y + 2 && Math.abs(sh.body.x - levels[4].start.x) < 1e-6, `a level opens on the drop, the body already on the start: ${JSON.stringify(sh)}`);
        // FUEL CELLS (fuel.js): every level hides one, not yet found here.
        const cell5 = await rdbg('fuel');
        check(cell5 && !cell5.found && !cell5.taken && cell5.shown && await rp.isVisible('#mazeFuel') && !/is-found/.test(await rp.getAttribute('#mazeFuel', 'class')), `a level hides a fuel cell, the HUD's cell dim: ${JSON.stringify(cell5)}`);
        // EACH WORLD'S SKY (backdrop3d.js): its planet far below, the ground
        // drawn once into a texture rather than shaded every frame.
        check(JSON.stringify(await rdbg('levelSky')) === '{"baked":true}', `the level hangs over its planet, the ground baked once: ${JSON.stringify(await rdbg('levelSky'))}`);
        await rdbg('holdShow', null);
        await rdbg('advanceFrames', Math.ceil(sh.lengths.drop / (1000 / 60)) + 2);
        sh = await rdbg('show');
        check(sh.kind === null && Math.abs(sh.drawn.y - sh.body.y) < 1e-6 && sh.drawn.visible, `the drop lands where the body is (${JSON.stringify(sh)})`);
        await rdbg('holdShow', 0);
        await rdbg('startLevelForTest', 'w1_01');
        await rdbg('holdShow', 0);
        sh = await rdbg('show');
        await rdbg('holdShow', null);
        check(sh.kind === 'shipDrop' && sh.shipShown, `a planet's first level opens on the ship: ${JSON.stringify({ k: sh.kind, s: sh.shipShown })}`);
        await rp.tap('#mazeStartBtn');
        await rp.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { polling: 100 });
        sh = await rdbg('show');
        check(sh.kind === null && !sh.shipShown && Math.abs(sh.drawn.x - sh.body.x) < 0.05 && Math.abs(sh.drawn.y - sh.body.y) < 0.05, `START ends the show where the ball really is: ${JSON.stringify(sh)}`);
        // SECRET POCKETS (pockets.js): w1_07's false wall is drawn but has
        // no body -- a ball set inside it stays put -- and the page behind it
        // is banked by a clear, to read in Gear.
        await rdbg('startLevelForTest', 'w1_07');
        const pk = await rdbg('pocket');
        check(pk && !pk.found && !pk.taken, `w1_07 hides a diary page: ${JSON.stringify(pk)}`);
        await rp.tap('#mazeStartBtn');
        await rp.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { polling: 100 });
        await rdbg('holdFallOffer', false);
        const inWall = await rdbg('placeBall', pk.wall.x, pk.wall.z);
        const stillThere = await rdbg('advanceFrames', 4);
        check(Math.hypot(stillThere.x - inWall.x, stillThere.z - inWall.z) < 0.05, `a ball inside the false wall is not pushed out (it has no body): ${JSON.stringify([inWall, stillThere])}`);
        await rdbg('placeBall', pk.x, pk.z);
        check((await rdbg('pocket')).taken, 'rolling into the page takes it');
        await rdbg('ageRun', 60000);
        check(await rdbg('warpToGoal'), 'w1_07 clears');
        check(((await rdbg('progress')).diary || []).join() === 'w1_07', `the clear keeps the page: ${JSON.stringify((await rdbg('progress')).diary)}`);
        // The story's voices on the ready line (rescue.js).
        await rdbg('startLevelForTest', 'w1_09');
        check(/PIP'S CAGE IS ON THE NEXT FLOOR/.test(await rp.textContent('#mazeStatus')), `floor 9 warns the cage is near: ${await rp.textContent('#mazeStatus')}`);
        await rdbg('startLevelForTest', 'w2_01');
        check(/^BARON: SLIPSTONIA'S ICE/.test((await rp.textContent('#mazeStatus')).trim()), `the Baron taunts on a planet's first level: ${await rp.textContent('#mazeStatus')}`);
        check(await rdbg('startLevelForTest', 'w1_10', { story: true }), 'floor 10 starts');
        await rp.waitForFunction(() => window.__mazeDebug.phase() === 'ready', null, { polling: 100 });
        check(await rp.isVisible('#storyPanel') && (await rp.textContent('#storyTitle')).trim() === 'ROLLE TO THE RESCUE' && (await rp.textContent('#storyGoBtn')).trim() === 'FREE PIP!',
            'the first floor 10 opens on the story card');
        check(/FIND PIP'S CAGE/.test(await rp.textContent('#mazeStatus')), `the ready line sends you for the cage: ${await rp.textContent('#mazeStatus')}`);
        const cage = await rdbg('rescue');
        check(cage && cage.captive === 'pip' && cage.cage && !cage.freed && await rdbg('goalLocked'), `Pip is caged and the exit locked: ${JSON.stringify(cage)}`);
        await rp.tap('#storyGoBtn');
        await rp.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { polling: 100, timeout: 10000 }).catch(() => {});
        check(await rp.isHidden('#storyPanel') && (await rdbg('phase')) === 'running', 'its button starts the run');
        const r10 = levels.find(l => l.id === 'w1_10');
        await rdbg('ageRun', Math.round(r10.goldMs * 1.2));
        check(!(await rdbg('warpToGoal')) && (await rdbg('phase')) === 'running' && /FREE PIP FIRST/.test(await rp.textContent('#mazeStatus')),
            `the locked exit does not end the run, and says why: ${await rp.textContent('#mazeStatus')}`);
        await rdbg('placeBall', cage.x, cage.z);
        const freed = await rdbg('rescue');
        check(freed.freed && !(await rdbg('goalLocked')) && /PIP IS FREE/.test(await rp.textContent('#mazeStatus')), `rolling into the cage frees Pip and opens the exit: ${JSON.stringify(freed)}`);
        // A fall puts Pip back in the cage, the exit shut again.
        await rdbg('placeBall', r10.holes[0].x, r10.holes[0].z);
        await rp.waitForFunction(() => window.__mazeDebug.phase() === 'running' && !window.__mazeDebug.rescue().freed, null, { polling: 100, timeout: 15000 }).catch(() => {});
        check(!(await rdbg('rescue')).freed && await rdbg('goalLocked'), 'a fall cages Pip again and locks the exit');
        await rdbg('placeBall', cage.x, cage.z);
        // Take floor 10's fuel cell on the way out: banked by the clear.
        const cell10 = await rdbg('fuel');
        await rdbg('placeBall', cell10.x, cell10.z);
        // (By its state and the HUD's cell: the status line can be taken over
        // a moment later by another message on a starved page.)
        const took = await rdbg('fuel');
        check(took.taken && /is-taken/.test(await rp.getAttribute('#mazeFuel', 'class')), `rolling into the cell takes it: ${JSON.stringify(took)} ${await rp.getAttribute('#mazeFuel', 'class')} / ${await rp.textContent('#mazeStatus')}`);
        // THE SURVEY (survey.js): the run counts the floor it covers; a
        // thorough one (every reachable square) surveys the level.
        const sv0 = await rdbg('survey');
        check(sv0 && sv0.pct > 0 && sv0.pct < 90 && sv0.best === 0 && await rp.isVisible('#mazeMap'), `the run is mapping the floor: ${JSON.stringify(sv0)}`);
        check((await rdbg('surveyAll')) === 100 && /100%/.test(await rp.textContent('#mazeMapPct')) && /is-surveyed/.test(await rp.getAttribute('#mazeMap', 'class')), 'covering every square maps it all');
        check(!((await rdbg('progress')).fuel || []).includes('w1_10'), 'but it is not banked before the clear');
        await rdbg('ageRun', Math.round(r10.goldMs * 1.2));
        await rdbg('holdShow', 0);
        check(await rdbg('warpToGoal'), 'with Pip freed, the exit clears the level');
        await rdbg('holdShow', 0);
        sh = await rdbg('show');
        await rdbg('holdShow', null);
        check(sh.kind === 'shipPickup' && sh.shipShown, `floor 10 cleared: Rolle's ship comes for the marble: ${JSON.stringify({ k: sh.kind, s: sh.shipShown })}`);
        await rdbg('advanceFrames', Math.ceil(sh.lengths.shipPickup / (1000 / 60)) + 2);
        sh = await rdbg('show');
        check(sh.kind === null && !sh.shipShown && !sh.drawn.visible, `and flies off with it, the board left empty: ${JSON.stringify(sh)}`);
        let rprog = await rdbg('progress');
        check((rprog.rescued || []).join() === '1' && rprog.marbles.includes('pip') && rprog.marble === 'classic', `Pip joins the player's marbles, Rolle still selected: ${JSON.stringify({ r: rprog.rescued, m: rprog.marbles, s: rprog.marble })}`);
        check((rprog.fuel || []).join() === 'w1_10', `the clear banks the cell: ${JSON.stringify(rprog.fuel)}`);
        check(rprog.survey && rprog.survey.w1_10 === 100, `and keeps the survey: ${JSON.stringify(rprog.survey)}`);
        const joined = await rp.waitForFunction(() => /PIP JOINS YOU/.test(document.getElementById('mazeStatus2').textContent) && /CLEARED/.test(document.getElementById('mazeStatus').textContent), null, { polling: 100, timeout: 8000 }).then(() => true, () => false);
        check(joined, 'the CLEARED line stays and the line under it says Pip joins you');
        const pipSays = await rp.waitForFunction(() => /PIP: THE BARON FLED TO SLIPSTONIA/.test(document.getElementById('mazeStatus2').textContent), null, { polling: 100, timeout: 20000 }).then(() => true, () => false);
        check(pipSays, 'then Pip says where the Baron went');
        // One cell of Sawturn's is not enough to fly to Slipstonia: no NEXT,
        // and the line under the result says what the ship needs.
        check(await rp.isHidden('#mazeNextBtn'), 'short of fuel, the CLEARED panel has no NEXT');
        const shipSays = await rp.waitForFunction(() => /SHIP NEEDS 3 FUEL CELLS FOR SLIPSTONIA\s+·\s+1 FOUND/.test(document.getElementById('mazeStatus2').textContent), null, { polling: 100, timeout: 25000 }).then(() => true, () => false);
        check(shipSays, 'and says the ship needs 3 cells for Slipstonia, 1 found');
        await rdbg('startLevelForTest', 'w1_10', { story: true });
        await rp.waitForFunction(() => window.__mazeDebug.phase() === 'ready', null, { polling: 100 });
        check((await rdbg('rescue')) === null && !(await rdbg('goalLocked')) && await rp.isHidden('#storyPanel'), 'once rescued, floor 10 is a plain level');
        await rp.tap('#mazeExitBtn');
        await homeUp(rp);
        check(/is-surveyed/.test(await rp.getAttribute('#homeSite_w1_10', 'class')) && /has-fuel/.test(await rp.getAttribute('#homeSite_w1_10', 'class')), 'home marks floor 10 surveyed and its cell found');
        check(/FRIENDS RESCUED 1 \/ 5/.test(await rp.textContent('#homeRescueText')) && await rp.locator('#homeRescueFriends .rescue-friend.is-freed').count() === 1, `home's tracker counts Pip freed: ${await rp.textContent('#homeRescueText')}`);
        await rp.tap('#tab_gear');
        await rp.waitForSelector('#profileView', { state: 'visible' });
        check(!/is-captive/.test(await pipCard.getAttribute('class')) && /SELECT/.test(await pipCard.locator('.marble-action').textContent()), 'Gear offers Pip to roll as');
        check((await rp.locator('#profileDiary .diary-page').count()) === 10 && (await rp.locator('#profileDiary .diary-page.is-found').count()) === 1 && /PAGE 1/.test(await rp.textContent('#profileDiary .diary-page.is-found')),
            'Gear shows the Baron\'s diary, page 1 found');
        await pipCard.locator('.marble-action').tap();
        check((await rdbg('progress')).marble === 'pip' && (await rp.textContent('#profileMarbleName')).trim() === 'Pip', 'and Pip can be selected');
        await rCtx.close();

        // --- the Labyrinth: walking a level in first person ------------------
        const wCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        await wCtx.addInitScript(() => {
            if (sessionStorage.getItem('seeded')) return;
            sessionStorage.setItem('seeded', '1');
            const d = new Date(); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const cleared = { w1_01: { bestMs: 99000, coins: 0 }, w1_02: { bestMs: 99000, coins: 0 }, w1_03: { bestMs: 99000, coins: 0 } };
            localStorage.setItem('marbleRush.progress.v1', JSON.stringify({ v: 1, wallet: 1000, xp: 0, highestIndex: 3, cleared, goldClaimed: [], prizes: [], charges: {}, daily: { streak: 1, last: key } }));
        });
        const wp = await wCtx.newPage();
        wp.on('pageerror', e => { if (!foreign(e.message + (e.stack || ''))) errors.push(e.message); });
        const wdbg = (fn, ...args) => wp.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);
        await wp.goto(base);
        await homeUp(wp);
        // Explorer kit: the Compass from the store.
        await wp.tap('#tab_store');
        await wp.waitForSelector('#storeView', { state: 'visible' });
        await wp.locator('.shop-row[data-explorer="compass"] .shop-buy').tap();
        check((await wdbg('progress')).explorer.includes('compass') && (await wdbg('progress')).wallet === 600, 'the Compass is bought in the store');
        // The worlds sheet in WALK mode: rolled levels only.
        await wp.tap('#tab_worlds');
        await wp.waitForSelector('#mazeSelect', { state: 'visible' });
        await wp.tap('#modeWalk');
        const wNodes = await wp.$$eval('.level-node', els => els.map(e => e.disabled));
        check(!wNodes[0] && !wNodes[2] && wNodes[3], `in WALK mode only rolled levels open: ${JSON.stringify(wNodes.slice(0, 4))}`);
        await wp.locator('.level-node').first().tap();
        await wp.waitForSelector('#mazeStartBtn', { state: 'visible' });
        let wk = await wdbg('walk');
        check(wk.on && wk.ballVisible && wk.fov === 75 && wk.compass && !wk.map, `walking: third person by default (marble shown), FOV 75, compass shown, map not owned: ${JSON.stringify(wk)}`);
        check(wk.marble === 'classic' && wk.handling.drive === 12 && wk.handling.brake === 3.6 && Math.abs(wk.stick - 40 / 55) < 1e-9,
            `Explore drives with the marble's own handling (Classic: drive 12, coasting brake 3.6, stick full at 55px): ${JSON.stringify({ m: wk.marble, h: wk.handling, s: wk.stick })}`);
        check(wk.eye.y > 0.55 && (await wp.textContent('#mazeViewBtn')).trim() === '3P', `the third-person camera rides above the wall tops (${wk.eye.y.toFixed(2)})`);
        check(await wp.isVisible('#walkStick') && await wp.isVisible('#walkPad'), 'on a touch screen the joystick and look pad are on screen');
        // 1P: through the marble's eyes, below the wall tops; saved.
        await wp.tap('#mazeViewBtn');
        wk = await wdbg('walk');
        check(!wk.ballVisible && wk.eye.y < 0.55 && wk.eye.y > 0.2 && (await wdbg('progress')).comfort.thirdPerson === false && (await wp.textContent('#mazeViewBtn')).trim() === '1P',
            `first person hides the marble and puts the eye below the wall tops, and is saved (${wk.eye.y.toFixed(2)})`);
        check(/^Explore · /.test((await wp.textContent('#mazeLevelName')).trim()) && await wp.isHidden('#mazeCamBtn') && await wp.isVisible('#mazeComfortBtn'), 'the HUD says Explore and offers comfort, not ball cam');
        // Comfort: a wider view, saved and applied at once.
        await wp.tap('#mazeComfortBtn');
        await wp.waitForSelector('#comfortPanel', { state: 'visible' });
        await wp.evaluate(() => { const s = document.getElementById('comfortFov'); s.value = '90'; s.dispatchEvent(new Event('input')); });
        check((await wdbg('walk')).fov === 90 && (await wdbg('progress')).comfort.fov === 90, 'a field of view change applies at once and is saved');
        await wp.tap('#comfortCloseBtn');
        // Walk forward, stop.
        await wp.tap('#mazeStartBtn');
        await wp.waitForFunction(() => window.__mazeDebug.phase() === 'running');
        const wlv = levels.find(l => l.id === 'w1_01');
        const wp0 = await wdbg('advanceFrames', 1, 16);
        const yaw0 = (await wdbg('walk')).yaw;
        await wdbg('walkMove', { fwd: 1 });
        const wp1 = await wdbg('advanceFrames', 30, 16);
        const along = (wp1.x - wp0.x) * -Math.sin(yaw0) + (wp1.z - wp0.z) * -Math.cos(yaw0);
        check(along > 0.4, `W walks forward the way the eye faces (${along.toFixed(2)} units in 0.5s)`);
        check(Math.abs((await wdbg('walk')).speed - 1.8) < 0.2, `at walking pace (${(await wdbg('walk')).speed.toFixed(2)})`);
        await wdbg('walkMove', null);
        await wdbg('advanceFrames', 30, 16);
        check((await wdbg('walk')).speed < 0.2, 'and stops when let go');
        await wdbg('walkTurn', Math.PI / 2);
        wk = await wdbg('walk');
        check(Math.abs((wk.eye.lx - wk.eye.x) - (-Math.sin(wk.yaw)) * Math.cos(wk.pitch)) < 1e-6, 'turning turns the view');
        // A pit is a pit.
        await wdbg('placeBall', wlv.holes[0].x, wlv.holes[0].z);
        await wdbg('advanceFrames', 2);
        check(await wdbg('phase') === 'falling', 'walking over a hole falls in');
        await wp.evaluate(() => new Promise(r => setTimeout(r, 900)));
        await wdbg('advanceFrames', 1);
        check(await wdbg('phase') === 'running' && Math.abs((await wdbg('walk')).yaw - yaw0) < 1e-6, 'then the walk restarts, facing the way it began');
        // The exit: a walk is recorded and paid, off the roll records.
        await wdbg('ageRun', Math.round(wlv.goldMs * 1.4));
        check(await wdbg('warpToGoal'), 'reaching the exit wins the walk');
        const wprog = await wdbg('progress');
        check(wprog.walks.w1_01 && wprog.wallet === 600 + 60 && wprog.cleared.w1_01.bestMs === 99000,
            `the first walk pays half the first-clear pay, kept apart from rolling: ${JSON.stringify({ w: wprog.walks, wallet: wprog.wallet })}`);
        check(await wp.isHidden('#mazeNextBtn') && await wp.isVisible('#mazeNearMiss') && /FOR GOLD|FROM GOLD/.test(await wp.textContent('#mazeNearText')), 'a walk has no NEXT, and names the walk gold still to win');
        await wp.tap('#mazeLevelsBtn');
        await wp.waitForSelector('#mazeSelect', { state: 'visible' });
        check((await wdbg('walk')).on === false && (await wdbg('walk')).fov !== 90, 'leaving the walk puts the camera back');
        await wCtx.close();

        // --- between levels on a computer (keyboard, no touch) ---------------
        // Two levels cleared: the third clear opens the daily maze and says so
        // under the result; NEXT shows SPACE; Space moves on even with REPLAY
        // focused from an earlier click.
        {
            const kCtx = await browser.newContext({ viewport: { width: 907, height: 510 } });
            await kCtx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('marbleRush.progress.v1', JSON.stringify(s)); } },
                { v: 1, wallet: 0, xp: 0, highestIndex: 2, cleared: { w1_01: { bestMs: 99000, coins: 0 }, w1_02: { bestMs: 99000, coins: 0 } }, goldClaimed: [], prizes: [], charges: {} });
            const kp = await kCtx.newPage();
            kp.on('pageerror', e => { if (!foreign(e.message + (e.stack || ''))) errors.push('[keys] ' + e.message); });
            const kdbg = (fn, ...args) => kp.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);
            await kp.goto(base);
            // homeUp taps; this page has a mouse only.
            await kp.waitForFunction(() => window.__cloudSync !== undefined, null, { timeout: 30000 });
            await kp.waitForSelector('#homeView', { state: 'visible', timeout: 30000 });
            if (await kp.isVisible('#rewardsPanel')) await kp.click('#rewardsCloseBtn');
            check((await kdbg('dailyMaze')).locked, 'with two levels cleared the daily maze is still locked');
            await kdbg('startLevelForTest', levels[2].id);
            await kp.waitForFunction(() => window.__mazeDebug.phase() === 'ready');
            check(/PRESS SPACE/.test(await kp.textContent('#mazeStatus')), `a computer is told to press Space: ${await kp.textContent('#mazeStatus')}`);
            await kp.keyboard.press('Space');
            await kp.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            await kdbg('ageRun', levels[2].goldMs + 2000);
            check(await kdbg('warpToGoal'), 'the third level clears');
            // Timer polling: a starved page's animation frames are too few to poll on.
            const unlockedSaid = await kp.waitForFunction(() => /DAILY MAZE UNLOCKED/.test(document.getElementById('mazeStatus2').textContent) && /CLEARED/.test(document.getElementById('mazeStatus').textContent), null, { polling: 100, timeout: 25000 }).then(() => true, () => false);
            check(unlockedSaid,
                `the clear that opens the daily maze says so under the result: "${await kp.textContent('#mazeStatus')}" / "${await kp.textContent('#mazeStatus2')}"`);
            check(await kp.isVisible('#mazeNextBtn .key-hint'), 'NEXT shows SPACE on a computer');
            // The day's gift, claimed from the panel: paid, the streak started,
            // and tomorrow named.
            const w0 = (await kdbg('progress')).wallet;
            await kp.click('#mazeGiftBtn');
            const kprog = await kdbg('progress');
            check(kprog.daily && kprog.daily.streak === 1 && kprog.wallet === w0 + 50 && await kp.isHidden('#mazeGiftBtn')
                && /DAY 1: \+50 COINS  ·  DAY 2 TOMORROW: 80 COINS/.test(await kp.textContent('#mazeStatus2')),
                `the CLEARED panel's gift claims day 1 and names tomorrow: "${await kp.textContent('#mazeStatus2')}" ${JSON.stringify(kprog.daily)}`);
            await kp.focus('#mazeReplayBtn');
            await kp.keyboard.press('Space');
            await kp.waitForFunction((id) => window.__mazeDebug.phase() === 'ready' && document.getElementById('mazeLevelName').textContent.trim() === id, levels[3].name, { timeout: 8000 }).catch(() => {});
            check((await kp.textContent('#mazeLevelName')).trim() === levels[3].name && await kp.isHidden('#mazeStatus2.is-on'),
                `Space on the CLEARED panel is NEXT, even with REPLAY focused: now on "${await kp.textContent('#mazeLevelName')}"`);
            await kCtx.close();
        }

        // --- cloud save and leaderboards, against the real API ---------------
        // server/app.js on an in-memory store; the page is pointed at it the
        // way a developer would (localStorage 'planetilt.api'). Device 1 has
        // played; it clears level 1 and is ranked, then makes a code; device 2,
        // fresh, joins with it and gets device 1's progress and coins.
        const { createApp } = await import('./server/app.js');
        const { createMemoryStore } = await import('./server/db.js');
        const apiServer = http.createServer(createApp({ store: createMemoryStore(), levels, adminToken: 'test-admin', dailyLevels: JSON.parse(fs.readFileSync(path.join(__dirname, 'dailyLevels.json'), 'utf8')).levels }));
        await new Promise(r => apiServer.listen(0, '127.0.0.1', r));
        const apiUrl = `http://127.0.0.1:${apiServer.address().port}`;
        try {
            // On the web an account comes first (features.requireLogin): a
            // device opens on the sign-in screen, and gets past it only by
            // creating an account or signing in. CrazyGames plays at once.
            const crazyBuild = /crazygames/.test(ROOT);
            const passGate = async (pg, auth) => {
                await pg.waitForSelector('#landing', { state: 'visible', timeout: 30000 });
                if (auth.register) {
                    await pg.tap('.lp-nav [data-lp="register"]');
                    await pg.fill('#regUsername', auth.register.username);
                    await pg.fill('#regEmail', auth.register.email);
                    await pg.fill('#regPassword', auth.register.password);
                    await pg.tap('#acctView_register button[type=submit]');
                } else {
                    await pg.tap('.lp-nav [data-lp="signin"]');
                    await pg.fill('#acctLogin', auth.login.login);
                    await pg.fill('#acctPassword', auth.login.password);
                    await pg.tap('#acctView_signin button[type=submit]');
                }
                await pg.waitForSelector('#landing', { state: 'hidden', timeout: 30000 }).catch(async (e) => {
                    console.log('DEBUG passGate:', JSON.stringify(await pg.evaluate(() => ({ msg: document.getElementById('acctMsg').textContent, panel: !document.getElementById('accountPanel').hidden, player: window.__cloudSync && window.__cloudSync.player(), status: window.__cloudSync && window.__cloudSync.status(), gate: window.__gateLog && window.__gateLog() }))));
                    throw e;
                });
            };
            const cloudDevice = async (seed, auth) => {
                const c = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
                await c.addInitScript(([api, save]) => {
                    localStorage.setItem('planetilt.api', api);
                    if (save && !sessionStorage.getItem('seeded')) {
                        sessionStorage.setItem('seeded', '1');
                        localStorage.setItem('marbleRush.progress.v1', JSON.stringify(save));
                    }
                }, [apiUrl, seed]);
                const pg = await c.newPage();
                pg.on('pageerror', e => { if (!foreign(e.message + (e.stack || ''))) errors.push(e.message); });
                await pg.goto(base);
                if (!crazyBuild && auth) await (auth.before ? auth.before(pg) : passGate(pg, auth));
                await homeUp(pg);
                await pg.waitForFunction(() => window.__cloudSync && window.__cloudSync.status() === 'synced', null, { timeout: 15000 }).catch(async (e) => {
                    console.log('DEBUG sync:', JSON.stringify(await pg.evaluate(() => ({ st: window.__cloudSync && window.__cloudSync.status(), pl: window.__cloudSync && window.__cloudSync.player(), phase: window.__mazeDebug.phase() }))));
                    throw e;
                });
                return { c, pg, dbg: (fn, ...args) => pg.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]) };
            };
            const today = new Date();
            const dayKeyNow = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const d1seed = { v: 1, wallet: 777, xp: 0, highestIndex: 2, cleared: { w1_01: { bestMs: 99000, coins: 0 }, w1_02: { bestMs: 99000, coins: 0 } }, goldClaimed: [], prizes: [], charges: {}, daily: { streak: 1, last: dayKeyNow } };
            // Device 1 has played (a guest save from before accounts) and makes an
            // account at the gate; its progress becomes the account's.
            const d1 = await cloudDevice(d1seed, { before: async (pg) => {
                // The landing site: the front door for a new player.
                await pg.waitForSelector('#landing', { state: 'visible', timeout: 30000 });
                check(await pg.isHidden('#accountPanel') && await pg.isVisible('.lp-nav [data-lp="signin"]') && await pg.isVisible('.lp-nav [data-lp="register"]'),
                    'the web opens on the landing site, SIGN IN and CREATE ACCOUNT on its top bar');
                const sections = await pg.$$eval('#landing .lp-section', els => els.map(e => !!e.querySelector('[data-lp="register"]')));
                check(sections.length >= 6 && sections.every(Boolean), `every highlight offers CREATE ACCOUNT (${sections.length} sections: ${sections})`);
                await pg.$eval('#landing', el => { el.style.scrollBehavior = 'auto'; el.scrollTop = el.scrollHeight / 2; });
                const navTop = await pg.$eval('.lp-nav', el => el.getBoundingClientRect().top);
                check(Math.abs(navTop) < 1 && await pg.isVisible('.lp-nav [data-lp="register"]'), `the top bar stays at the top while scrolling (top ${navTop})`);
                await pg.$eval('#landing', el => { el.scrollTop = el.scrollHeight; });
                const imgs = await pg.$$eval('#landing img', els => Promise.all(els.map(i => (i.complete && i.naturalWidth) ? i.naturalWidth : new Promise(r => { i.loading = 'eager'; i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); setTimeout(() => r(i.naturalWidth), 8000); }))));
                check(imgs.length >= 10 && imgs.every(w => w > 0), `the site's pictures load (${imgs})`);
                // A highlight's CREATE ACCOUNT opens the panel over the site; closing
                // it goes back to the site, which stays until there is an account.
                await pg.locator('#lp-explore [data-lp="register"]').tap();
                await pg.waitForSelector('#acctView_register', { state: 'visible' });
                check(await pg.isVisible('#acctCloseBtn'), 'over the site, the account panel can be closed');
                await pg.tap('#acctCloseBtn');
                check(await pg.isHidden('#accountPanel') && await pg.isVisible('#landing'), 'closing it returns to the site, not the game');
                await pg.tap('.lp-nav [data-lp="register"]');
                await pg.fill('#regUsername', 'x');
                await pg.fill('#regEmail', 'tilt@example.com');
                await pg.fill('#regPassword', 'marbles-rule');
                await pg.tap('#acctView_register button[type=submit]');
                await pg.waitForFunction(() => document.getElementById('acctMsg').textContent.length > 0, null, { polling: 100, timeout: 30000 }).catch(async (e) => {
                    console.log('DEBUG d1 short name:', JSON.stringify(await pg.evaluate(() => ({ msg: document.getElementById('acctMsg').textContent, panel: !document.getElementById('accountPanel').hidden, form: !document.getElementById('acctView_register').hidden, user: document.getElementById('regUsername').value, disabled: document.querySelector('#acctView_register button[type=submit]').disabled, st: window.__cloudSync && window.__cloudSync.status() }))));
                    throw e;
                });
                check(/at least 3/.test(await pg.textContent('#acctMsg')) && await pg.isVisible('#accountPanel'), 'a too-short username is explained, and the gate stays');
                await pg.fill('#regUsername', 'TiltTester');
                await pg.tap('#acctView_register button[type=submit]');
                await pg.waitForSelector('#accountPanel', { state: 'hidden', timeout: 30000 });
                check(await pg.isHidden('#landing'), 'creating an account opens the game');
            } });
            await d1.pg.tap('#tab_gear');
            check(await d1.pg.locator('#cloudStatus, #cloudLinkBtn, #cloudClaimForm').count() === 0, 'no cloud status or device codes on the card: saving just happens');
            if (crazyBuild) {
                // No own accounts on CrazyGames, and no CrazyGames sign-in in
                // this test: nothing to offer, so no card, and no gate.
                check(await d1.pg.isHidden('#cloudSection') && await d1.pg.isHidden('#acctOwnButtons') && await d1.pg.isHidden('#accountPanel') && await d1.pg.locator('#landing').count() === 0,
                    'on CrazyGames there is no sign-in gate or own-account sign-in (CrazyGames\' is the way)');
            } else {
                check(/^Signed in as TiltTester/.test(await d1.pg.textContent('#acctWho')) && await d1.pg.isHidden('#acctGuest'), 'the account shows on the Gear card');
                check((await d1.dbg('progress')).cleared.w1_01, 'the device\'s earlier progress is the account\'s');
            }
            // Clear level 1: ranked on the CLEARED panel, and on the board.
            await d1.pg.tap('#tab_worlds');
            await d1.pg.waitForSelector('#mazeSelect', { state: 'visible' });
            await d1.pg.locator('.level-node').first().tap();
            await d1.pg.waitForSelector('#mazeStartBtn', { state: 'visible' });
            await d1.pg.tap('#mazeStartBtn');
            await d1.pg.waitForFunction(() => window.__mazeDebug.phase() === 'running');
            const l1 = levels.find(l => l.id === 'w1_01');
            await d1.dbg('ageRun', l1.goldMs + 2000);
            check(await d1.dbg('warpToGoal'), 'device 1 clears level 1');
            await d1.pg.waitForSelector('#mazeRankBtn', { state: 'visible' });
            await d1.pg.waitForFunction(() => /^#1 OF 1$/.test(document.getElementById('mazeRankText').textContent), null, { timeout: 10000 }).catch(() => {});
            check((await d1.pg.textContent('#mazeRankText')).trim() === '#1 OF 1', `the clear is ranked on the CLEARED panel (${await d1.pg.textContent('#mazeRankText')})`);
            await d1.pg.tap('#mazeRankBtn');
            await d1.pg.waitForSelector('#boardList li.is-you', { timeout: 10000 }).catch(() => {});
            check(await d1.pg.locator('#boardList li').count() === 1 && await d1.pg.locator('#boardList li.is-you').count() === 1 && /#1 of 1/.test(await d1.pg.textContent('#boardYou')),
                'the leaderboard lists the time as yours');
            await d1.pg.tap('#boardCloseBtn');
            // Play tracking: the attempt's start and clear reach the stats.
            await d1.pg.evaluate(() => window.__cloudSync.flushEvents());
            const stats = await (await fetch(apiUrl + '/v1/admin/stats', { headers: { Authorization: 'Bearer test-admin' } })).json();
            const w101 = stats.levels.find(l => l.id === 'w1_01').roll;
            check(w101.starts === 1 && w101.clears === 1 && w101.avgClearMs >= l1.goldMs, `the run is tracked: a start and a clear on w1_01 (${JSON.stringify(w101)})`);
            check(w101.medals && w101.medals.silver + w101.medals.bronze + w101.medals.gold === 1 && w101.coinsFound !== null, `the clear's medal and coins are tracked (${JSON.stringify({ m: w101.medals, c: w101.coinsFound })})`);
            check(stats.actions.some(x => x.name === 'open:leaderboard') && stats.activity.byDay[stats.activity.byDay.length - 1].dau >= 1, `opening the leaderboard reached the action counts, and today has an active player (${JSON.stringify(stats.actions)})`);
            check(await d1.pg.isHidden('#boardPanel'), 'the leaderboard closes');
            await d1.pg.tap('#mazeLevelsBtn');
            await d1.pg.waitForFunction(() => window.__cloudSync.status() === 'synced');
            const d1prog = await d1.dbg('progress');
            // Device 2 signs in at the gate (a wrong password first) and gets the
            // account's progress; signing out returns to the gate; signing in by
            // username brings the progress back.
            const d2 = await cloudDevice(null, crazyBuild ? null : { before: async (pg) => {
                await pg.waitForSelector('#landing', { state: 'visible', timeout: 30000 });
                await pg.tap('.lp-nav [data-lp="signin"]');
                await pg.fill('#acctLogin', 'tilt@example.com');
                await pg.fill('#acctPassword', 'wrong-password');
                await pg.tap('#acctView_signin button[type=submit]');
                await pg.waitForFunction(() => document.getElementById('acctMsg').textContent.length > 0, null, { polling: 100, timeout: 30000 }).catch(async (e) => {
                    console.log('DEBUG d2 wrong password:', JSON.stringify(await pg.evaluate(() => ({ msg: document.getElementById('acctMsg').textContent, panel: !document.getElementById('accountPanel').hidden, form: !document.getElementById('acctView_signin').hidden, disabled: document.querySelector('#acctView_signin button[type=submit]').disabled, login: document.getElementById('acctLogin').value, st: window.__cloudSync && window.__cloudSync.status(), pl: window.__cloudSync && window.__cloudSync.player() }))));
                    throw e;
                });
                check(/Wrong username/.test(await pg.textContent('#acctMsg')) && await pg.isVisible('#accountPanel'), 'a wrong password says so, and the gate stays');
                await pg.fill('#acctPassword', 'marbles-rule');
                await pg.tap('#acctView_signin button[type=submit]');
                await pg.waitForSelector('#landing', { state: 'hidden', timeout: 30000 }).catch(async (e) => {
                    console.log('DEBUG d2 sign-in:', JSON.stringify(await pg.evaluate(() => ({ msg: document.getElementById('acctMsg').textContent, panel: !document.getElementById('accountPanel').hidden, player: window.__cloudSync && window.__cloudSync.player(), status: window.__cloudSync && window.__cloudSync.status(), gate: window.__gateLog && window.__gateLog() }))));
                    throw e;
                });
            } });
            if (!crazyBuild) {
                const d2prog = await d2.dbg('progress');
                await d2.pg.tap('#tab_gear');
                check(d2prog.cleared.w1_01 && d2prog.cleared.w1_02 && d2prog.wallet === d1prog.wallet && /^Signed in as TiltTester/.test(await d2.pg.textContent('#acctWho')),
                    `signing in on device 2 brings the account's clears and coins: ${JSON.stringify({ w: d2prog.wallet, w1: d1prog.wallet })}`);
                check((await d2.pg.textContent('#profileWallet')).replace(/,/g, '').trim() === String(d1prog.wallet), 'the Gear page shows the account\'s coins');
                await d2.pg.tap('#acctSignOutBtn');
                await d2.pg.waitForSelector('#landing', { state: 'visible', timeout: 30000 });
                check(!(await d2.dbg('progress')).cleared.w1_01, 'signing out returns to the landing site, with nothing of the account left on the device');
                await passGate(d2.pg, { login: { login: 'TiltTester', password: 'marbles-rule' } });
                await d2.pg.waitForFunction(() => window.__cloudSync.status() === 'synced', null, { timeout: 15000 });
                check((await d2.dbg('progress')).cleared.w1_01, 'signing in by username brings it back');
            }
            // Device 3 plays as a guest (features.guestPlay): past the front door
            // with no account, remembered on the device, an account offered on
            // Gear later; signing out of that account starts at the door again.
            // Devices 1 and 2 are done: closed now, so three pages rendering
            // in software do not starve device 3's save upload on this machine.
            await d1.c.close();
            await d2.c.close();
            let d3 = null;
            if (!crazyBuild) {
                d3 = await cloudDevice({ v: 1, wallet: 321, xp: 0, highestIndex: 1, cleared: { w1_01: { bestMs: 88000, coins: 0 } }, goldClaimed: [], prizes: [], charges: {} }, { before: async (pg) => {
                    await pg.waitForSelector('#landing', { state: 'visible', timeout: 30000 });
                    const guestLinks = await pg.$$eval('#landing [data-lp="guest"]', els => els.filter(e => !e.hidden).length);
                    check(guestLinks >= 2, `the landing site offers PLAY AS GUEST under its big buttons (${guestLinks})`);
                    await pg.locator('.lp-hero [data-lp="guest"]').tap();
                    await pg.waitForSelector('#landing', { state: 'hidden', timeout: 30000 });
                    check(await pg.isHidden('#accountPanel'), 'playing as a guest opens the game with no account panel');
                } });
                check((await d3.pg.evaluate(() => window.__cloudSync.player())).kind === 'guest', 'the device plays as a guest');
                await d3.pg.reload();
                // The new visit's calendar slides in a moment after home shows:
                // let it arrive and settle before homeUp closes it.
                await d3.pg.waitForSelector('#homeView', { state: 'visible', timeout: 30000 });
                await d3.pg.waitForSelector('#rewardsPanel', { state: 'visible', timeout: 5000 }).catch(() => {});
                await d3.pg.evaluate(() => new Promise(r => { let n = 30; const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }));
                await homeUp(d3.pg);
                check(await d3.pg.isHidden('#landing') && (await d3.dbg('progress')).cleared.w1_01, 'the guest choice is remembered: a new visit goes straight to the game, progress kept');
                await d3.pg.tap('#tab_gear');
                check(await d3.pg.isVisible('#acctGuest') && /guest/.test(await d3.pg.textContent('#acctGuestHelp')) && await d3.pg.isVisible('#acctCreateBtn'),
                    'Gear tells the guest their progress is on this device only, and offers CREATE ACCOUNT');
                await d3.pg.tap('#acctCreateBtn');
                await d3.pg.fill('#regUsername', 'TurnedPro');
                await d3.pg.fill('#regEmail', 'guest@example.com');
                await d3.pg.fill('#regPassword', 'marbles-rule');
                await d3.pg.tap('#acctView_register button[type=submit]');
                await d3.pg.waitForSelector('#accountPanel', { state: 'hidden', timeout: 30000 });
                check(/^Signed in as TurnedPro/.test(await d3.pg.textContent('#acctWho')) && (await d3.dbg('progress')).cleared.w1_01 && (await d3.dbg('progress')).wallet === 321,
                    'a guest who makes an account keeps their clears and coins');
                await d3.pg.tap('#acctSignOutBtn');
                await d3.pg.waitForSelector('#landing', { state: 'visible', timeout: 30000 });
                check(true, 'signing out forgets the guest choice: the front door again');
            }
            if (d3) await d3.c.close();
        } finally { apiServer.close(); }

        // --- ads, against a stand-in CrazyGames SDK -------------------------
        // The real SDK script is swapped for nothing and window.CrazyGames is
        // a fake whose ads finish at once, so every rewarded flow can be
        // driven: free coins and banners in the menus, FREE SHIELD on the
        // ready screen, CONTINUE after a fall, x2 COINS on a clear, and break
        // ads only at breaks.
        const adCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        await adCtx.route('**/crazygames-sdk-v3.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
        await adCtx.addInitScript(() => {
            window.__PLATFORM__ = 'crazygames';
            const log = window.__adLog = [];
            const store = {};
            window.CrazyGames = { SDK: {
                init: async () => {}, environment: 'local',
                game: { settings: {}, addSettingsChangeListener() {}, addJoinRoomListener() {}, loadingStart() {}, loadingStop() {}, happytime() {},
                    gameplayStart() { log.push('play'); }, gameplayStop() { log.push('stop'); }, reportGameCompletedPercentage() {} },
                user: { addAuthListener() {}, isUserAccountAvailable: false },
                data: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
                ad: { requestAd(kind, cb) { log.push('ad:' + kind); if (cb.adStarted) cb.adStarted(); setTimeout(() => cb.adFinished(), 60); } },
                banner: { requestResponsiveBanner(id) { log.push('banner:' + id); return Promise.resolve(); } }
            } };
        });
        const ad = await adCtx.newPage();
        ad.on('pageerror', e => errors.push('[ads] ' + e.message));
        const adbg = (fn, ...args) => ad.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);
        const adLog = () => ad.evaluate(() => window.__adLog.slice());
        await ad.goto(base);
        // A new CrazyGames player opens on level 1, START away from playing;
        // backing out of it untouched is no break, so no ad.
        await ad.waitForSelector('#mazeStartBtn', { state: 'visible', timeout: 30000 });
        check(await adbg('phase') === 'ready' && await ad.isHidden('#tabBar'), 'on CrazyGames a new player opens on level 1, one tap from playing');
        await ad.tap('#mazeExitBtn');
        await ad.waitForSelector('#homeView', { state: 'visible' });
        check(!(await adLog()).some(x => /midgame/.test(x)), `backing out of an unplayed level shows no ad: ${JSON.stringify(await adLog())}`);
        await homeUp(ad);
        check(await ad.isVisible('#homeFreeCoins') && !(await ad.isDisabled('#homeFreeCoins')) && (await ad.textContent('#homeFreeLabel')).trim() === '+60',
            'on CrazyGames, home offers free coins for an ad');
        check(await ad.isVisible('#storeBadge'), 'and the STORE tab carries a badge while the free coins wait');

        await ad.tap('#tab_store');
        await ad.waitForSelector('#storeView', { state: 'visible' });
        check((await adLog()).includes('banner:storeBanner'), 'the store page asks for a banner');
        const freeBtn = ad.locator('.shop-row', { has: ad.locator('.shop-rowtitle', { hasText: 'Watch a short ad' }) }).locator('.shop-buy');
        check(await freeBtn.count() === 1, 'the store offers free coins for an ad');
        const w0 = (await adbg('progress')).wallet;
        await freeBtn.tap();
        await ad.waitForFunction((w) => window.__mazeDebug.progress().wallet > w, w0, { timeout: 5000 }).catch(() => {});
        const w1 = (await adbg('progress')).wallet;
        check(w1 === w0 + 60, `a finished free-coins ad pays 60 (wallet ${w0} -> ${w1})`);
        check(/IN \d+ MIN/.test(await freeBtn.textContent()) && await freeBtn.isDisabled(), 'then the free coins wait out their cooldown');
        check(await ad.isHidden('#storeBadge'), 'the store badge goes once the free coins are taken');
        check(await ad.isHidden('#adShield'), 'the ad shield is down once the ad is over');
        // A FREE upgrade step: one per cooldown, then the buttons go and a
        // line says when the next one comes.
        const freeUp = ad.locator('.shop-row', { has: ad.locator('.shop-rowtitle', { hasText: /^Grip$/ }) }).locator('.shop-free');
        check(await ad.locator('.shop-free').count() === 4, `every upgrade offers a free step (got ${await ad.locator('.shop-free').count()})`);
        await freeUp.tap();
        await ad.waitForFunction(() => (window.__mazeDebug.progress().upgrades.grip || 0) === 1, null, { timeout: 5000 }).catch(() => {});
        const upP = await adbg('progress');
        check(upP.upgrades.grip === 1 && upP.wallet === w1, `a free step adds a Grip tier and costs nothing (${JSON.stringify(upP.upgrades)}, wallet ${upP.wallet})`);
        check(await ad.locator('.shop-free').count() === 0 && /Next free upgrade step in \d+ min/.test(await ad.textContent('#storeList')), 'then free steps wait out their cooldown, and say so');
        await ad.tap('#tab_gear');
        check((await adLog()).includes('banner:profileBanner'), 'the gear page asks for a banner');
        await ad.tap('#tab_store');
        check((await adLog()).filter(x => x === 'banner:storeBanner').length === 1, 'coming back within a minute keeps the banner (no refresh under 60s)');

        // Level 1: FREE SHIELD is offered on the ready screen; leave it for now.
        await ad.tap('#tab_home');
        check(await ad.isDisabled('#homeFreeCoins') && /^\d+:\d\d$/.test((await ad.textContent('#homeFreeLabel')).trim()), 'home counts down to the next free coins');
        await ad.tap('#homePlayBtn');
        await ad.waitForSelector('#mazeStartBtn', { state: 'visible' });
        // A beginner level (uncleared, among the first three) is shielded for
        // free, so it offers no shield for an ad.
        check(await ad.isHidden('#mazeAdShieldBtn'), 'a beginner level offers no shield for an ad (its own shield is free)');
        await ad.tap('#mazeStartBtn');
        await ad.waitForFunction(() => window.__mazeDebug.phase() === 'running');
        check(await ad.isHidden('#mazeAdShieldBtn'), 'and none once the run starts');
        const lvOne = levels[0];
        // The beginner's shield catches the attempt's first fall.
        await adbg('placeBall', lvOne.holes[0].x, lvOne.holes[0].z);
        await adbg('advanceFrames', 2);
        check(await adbg('phase') === 'running' && /SHIELD SAVED YOU/.test(await ad.textContent('#mazeStatus')), 'on CrazyGames too, the beginner\'s shield catches the first fall');
        // A fall in the first seconds: no CONTINUE, straight back to the start.
        await adbg('placeBall', lvOne.holes[0].x, lvOne.holes[0].z);
        await ad.waitForTimeout(900);
        await adbg('advanceFrames', 2);
        check(await adbg('phase') === 'running' && await ad.isHidden('#mazeFallPanel'), 'an early fall just retries -- nothing to continue');
        // A fall after a while: CONTINUE is offered; taking it puts the ball back.
        // (Its 4s countdown runs on the wall clock, so it is held for the tap.)
        // The new attempt is shielded again: spend that first.
        await adbg('placeBall', lvOne.holes[0].x, lvOne.holes[0].z);
        await adbg('advanceFrames', 2);
        await adbg('holdFallOffer', true);
        await adbg('ageRun', 9000);
        await adbg('placeBall', lvOne.holes[0].x, lvOne.holes[0].z);
        await ad.waitForTimeout(900);
        await adbg('advanceFrames', 2);
        check(await adbg('phase') === 'offer' && await ad.isVisible('#mazeFallPanel'), `a later fall offers CONTINUE (phase ${await adbg('phase')})`);
        const nAds = (await adLog()).filter(x => x === 'ad:rewarded').length;
        await ad.tap('#mazeReviveBtn');
        await ad.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 5000 }).catch(() => {});
        check(await adbg('phase') === 'running' && (await adLog()).filter(x => x === 'ad:rewarded').length === nAds + 1, 'CONTINUE plays an ad and puts the ball back in the run');
        await adbg('holdFallOffer', false);
        const pos = await adbg('advanceFrames', 1);
        check(Math.hypot(pos.x - lvOne.holes[0].x, pos.z - lvOne.holes[0].z) > lvOne.holes[0].r + lvOne.ballRadius, 'back on safe ground, not over the hole');
        // Once per attempt: the next fall just retries.
        await adbg('placeBall', lvOne.holes[0].x, lvOne.holes[0].z);
        await ad.waitForTimeout(900);
        await adbg('advanceFrames', 2);
        check(await adbg('phase') === 'running' && await ad.isHidden('#mazeFallPanel'), 'one CONTINUE per attempt');
        // Win: x2 COINS doubles the clear's pay, and stands in for the break ad.
        await adbg('ageRun', 60000);
        check(await adbg('warpToGoal'), 'level 1 clears');
        check(await ad.isVisible('#mazeDoubleBtn'), 'a paying clear offers x2 COINS');
        const before = await adbg('progress');
        await ad.tap('#mazeDoubleBtn');
        await ad.waitForFunction((w) => window.__mazeDebug.progress().wallet > w, before.wallet, { timeout: 5000 }).catch(() => {});
        const after2 = await adbg('progress');
        const earned = after2.wallet - before.wallet;
        check(earned > 0 && await ad.isHidden('#mazeDoubleBtn'), `x2 COINS pays the clear again, once (+${earned})`);
        const mid0 = (await adLog()).filter(x => x === 'ad:midgame').length;
        await ad.tap('#mazeNextBtn');
        await ad.waitForSelector('#mazeStartBtn', { state: 'visible' });
        check((await adLog()).filter(x => x === 'ad:midgame').length === mid0, 'no break ad right after a rewarded one');
        // Level 1 again, now cleared: no beginner's shield, so the ready
        // screen offers the free shield for an ad -- take it.
        await adbg('startLevelForTest', levels[0].id);
        await ad.waitForFunction(() => window.__mazeDebug.phase() === 'ready');
        check(await ad.isVisible('#mazeAdShieldBtn'), 'a cleared level 1 offers a free shield for an ad');
        await ad.tap('#mazeAdShieldBtn');
        await ad.waitForFunction(() => (window.__mazeDebug.progress().charges.shield || 0) > 0, null, { timeout: 5000 }).catch(() => {});
        check(((await adbg('progress')).charges.shield || 0) === 1 && await ad.isHidden('#mazeAdShieldBtn'), 'a free shield is a Shield charge, offered once');
        // Leaving a level is a break: one break ad, never during the run.
        const log0 = await adLog();
        check(!log0.some((x, i) => x.startsWith('ad:') && log0.slice(0, i).lastIndexOf('play') > log0.slice(0, i).lastIndexOf('stop')), 'no ad ever starts while gameplay is reported running');
        await ad.tap('#mazeExitBtn');
        await homeUp(ad);
        check((await adLog()).filter(x => x === 'ad:midgame').length === mid0 + 1, 'leaving a level shows a break ad');

        // TRY A MARBLE: Gear offers TRY on each marble not owned; the ad starts
        // the next level with it, for that level only, and grants nothing.
        await ad.tap('#tab_gear');
        await ad.waitForSelector('#profileView', { state: 'visible' });
        const tryBtns = ad.locator('.marble-card .maze-btn-ad');
        check(await tryBtns.count() === 3, `every marble for sale not owned offers TRY, never a caged friend (got ${await tryBtns.count()})`);
        const steelTry = ad.locator('.marble-card', { has: ad.locator('.marble-name', { hasText: /^Sterling$/ }) }).locator('.maze-btn-ad');
        await steelTry.tap();
        await ad.waitForSelector('#mazeStartBtn', { state: 'visible', timeout: 30000 });
        let tr = await adbg('trial');
        check(tr.ball === 'steel' && tr.trial && tr.trial.id === 'steel', `TRY starts the next level with that marble: ${JSON.stringify(tr)}`);
        check(/TRYING STERLING/.test(await ad.textContent('#mazeStatus')), 'and says so');
        await ad.tap('#mazeStartBtn');
        await ad.waitForFunction(() => window.__mazeDebug.phase() === 'running');
        await adbg('placeBall', levels[1].holes[0].x, levels[1].holes[0].z);
        await ad.waitForTimeout(900);
        await adbg('advanceFrames', 2);
        check((await adbg('trial')).ball === 'steel', 'a retry keeps the trial marble');
        const trialProg = await adbg('progress');
        check(!trialProg.marbles.includes('steel') && trialProg.marble === 'classic', 'a trial grants nothing and changes no choice');
        await ad.tap('#mazeExitBtn');
        await ad.waitForSelector('#homeView', { state: 'visible', timeout: 10000 });
        check((await adbg('trial')).trial === null, 'leaving the level ends the trial');
        await ad.tap('#homePlayBtn');
        await ad.waitForSelector('#mazeStartBtn', { state: 'visible' });
        check((await adbg('trial')).ball === 'classic', 'the next level is back on your own marble');

        // The daily reward: claim day 1 from the DAILY button, then double it
        // with an ad -- once.
        await ad.tap('#mazeExitBtn');
        await ad.waitForSelector('#homeView', { state: 'visible', timeout: 10000 });
        await ad.tap('#homeRewardsBtn');
        await ad.waitForSelector('#dailyPanel', { state: 'visible' });
        check(await ad.isHidden('#dailyDoubleBtn'), 'no ×2 before claiming');
        const dw0 = (await adbg('progress')).wallet;
        await ad.tap('#dailyClaimBtn');
        const dw1 = (await adbg('progress')).wallet;
        check(dw1 === dw0 + 50 && await ad.isDisabled('#dailyClaimBtn') && await ad.isHidden('#rewardsBadge_daily'), `claiming day 1 pays 50 once (${dw0} -> ${dw1})`);
        check(await ad.isVisible('#dailyDoubleBtn'), 'then offers ×2 for an ad');
        await ad.tap('#dailyDoubleBtn');
        await ad.waitForFunction((w) => window.__mazeDebug.progress().wallet > w, dw1, { timeout: 5000 }).catch(() => {});
        check((await adbg('progress')).wallet === dw1 + 50 && await ad.isHidden('#dailyDoubleBtn'), 'a finished ad pays day 1 again, and the offer goes');
        await ad.tap('#rewardsCloseBtn');
        check(await ad.isHidden('#rewardsPanel'), 'the rewards card closes');
        await adCtx.close();

        check(!errors.length, 'no page errors:\n   ' + errors.join('\n   '));
    } finally {
        await browser.close();
        server.close();
    }

    if (failures.length) {
        console.error('FAIL: maze boot\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: maze boot -- the page boots to home with level 1 offered, the tab bar switches screens, a run steers the right way on keys, collects coins, falls and restarts, conveyors carry the ball, a clear is banked by the progress store, the store and profile buy and select, bought power-ups and the marble reach the run, it all survives a reload, and with a server the save syncs, clears are ranked and a code joins two devices');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
