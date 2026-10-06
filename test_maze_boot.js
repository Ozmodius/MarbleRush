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
        check((await page.textContent('#worldSheetName')).trim() === 'Glacier' && await page.locator('.level-node').count() === levels.filter(l => l.world === 2).length
            && /Clear World 1/.test(await page.textContent('#worldSheetNote')), 'a built but locked world shows its levels, locked, and says what opens it');
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
        // A tap on the planet itself (just above its label) picks it too.
        const anchor = (await page.evaluate(() => window.__mazeDebug.worldAnchors())).find(x => x.n === 4);
        await page.mouse.click(anchor.x, anchor.y - 30);
        check((await page.textContent('#worldSheetName')).trim() === 'Toy Box', 'tapping a planet on the canvas selects its world');
        // A drag sideways spins the system; it is not a tap.
        const spin0 = await dbg('solarSpin');
        await page.mouse.move(80, 250);
        await page.mouse.down();
        for (let k = 1; k <= 10; k++) await page.mouse.move(80 + k * 20, 250);
        await page.mouse.up();
        const spin1 = await dbg('solarSpin');
        check(spin1 < spin0 - 1, `dragging right spins the solar system (spin ${spin0.toFixed(2)} -> ${spin1.toFixed(2)})`);
        check((await page.textContent('#worldSheetName')).trim() === 'Toy Box', 'a drag does not pick a world');
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
            localStorage.setItem('marbleRush.progress.v1', JSON.stringify({ v: 1, wallet: 2000, highestIndex: 0, cleared: {}, goldClaimed: [], prizes: ['rubberCoat', 'heatShield'], prizeUses: { rubberCoat: 3, heatShield: 2 }, charges: { slowmo: 1 } }));
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
        await shop.waitForSelector('#homeView', { state: 'visible', timeout: 30000 });
        check((await sdbg('progress')).marble === 'rubber', 'the marble choice survives a reload');
        await shopCtx.close();

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
        await ad.waitForSelector('#homeView', { state: 'visible', timeout: 30000 });

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
        check(await ad.isHidden('#adShield'), 'the ad shield is down once the ad is over');
        await ad.tap('#tab_gear');
        check((await adLog()).includes('banner:profileBanner'), 'the gear page asks for a banner');
        await ad.tap('#tab_store');
        check((await adLog()).filter(x => x === 'banner:storeBanner').length === 1, 'coming back within a minute keeps the banner (no refresh under 60s)');

        // Level 1: FREE SHIELD is offered on the ready screen; leave it for now.
        await ad.tap('#tab_home');
        await ad.tap('#homePlayBtn');
        await ad.waitForSelector('#mazeStartBtn', { state: 'visible' });
        check(await ad.isVisible('#mazeAdShieldBtn'), 'the ready screen offers a free shield for an ad');
        await ad.tap('#mazeStartBtn');
        await ad.waitForFunction(() => window.__mazeDebug.phase() === 'running');
        check(await ad.isHidden('#mazeAdShieldBtn'), 'and stops offering it once the run starts');
        const lvOne = levels[0];
        // A fall in the first seconds: no CONTINUE, straight back to the start.
        await adbg('placeBall', lvOne.holes[0].x, lvOne.holes[0].z);
        await ad.waitForTimeout(900);
        await adbg('advanceFrames', 2);
        check(await adbg('phase') === 'running' && await ad.isHidden('#mazeFallPanel'), 'an early fall just retries -- nothing to continue');
        // A fall after a while: CONTINUE is offered; taking it puts the ball back.
        await adbg('ageRun', 9000);
        await adbg('placeBall', lvOne.holes[0].x, lvOne.holes[0].z);
        await ad.waitForTimeout(900);
        await adbg('advanceFrames', 2);
        check(await adbg('phase') === 'offer' && await ad.isVisible('#mazeFallPanel'), `a later fall offers CONTINUE (phase ${await adbg('phase')})`);
        const nAds = (await adLog()).filter(x => x === 'ad:rewarded').length;
        await ad.tap('#mazeReviveBtn');
        await ad.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 5000 }).catch(() => {});
        check(await adbg('phase') === 'running' && (await adLog()).filter(x => x === 'ad:rewarded').length === nAds + 1, 'CONTINUE plays an ad and puts the ball back in the run');
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
        // Level 2's ready screen: take the free shield.
        await ad.tap('#mazeAdShieldBtn');
        await ad.waitForFunction(() => (window.__mazeDebug.progress().charges.shield || 0) > 0, null, { timeout: 5000 }).catch(() => {});
        check(((await adbg('progress')).charges.shield || 0) === 1 && await ad.isHidden('#mazeAdShieldBtn'), 'a free shield is a Shield charge, offered once');
        // Leaving a level is a break: one break ad, never during the run.
        const log0 = await adLog();
        check(!log0.some((x, i) => x.startsWith('ad:') && log0.slice(0, i).lastIndexOf('play') > log0.slice(0, i).lastIndexOf('stop')), 'no ad ever starts while gameplay is reported running');
        await ad.tap('#mazeExitBtn');
        await ad.waitForSelector('#homeView', { state: 'visible', timeout: 10000 });
        check((await adLog()).filter(x => x === 'ad:midgame').length === mid0 + 1, 'leaving a level shows a break ad');

        // TRY A MARBLE: Gear offers TRY on each marble not owned; the ad starts
        // the next level with it, for that level only, and grants nothing.
        await ad.tap('#tab_gear');
        await ad.waitForSelector('#profileView', { state: 'visible' });
        const tryBtns = ad.locator('.marble-card .maze-btn-ad');
        check(await tryBtns.count() === 3, `every marble not owned offers TRY (got ${await tryBtns.count()})`);
        const steelTry = ad.locator('.marble-card', { has: ad.locator('.marble-name', { hasText: /^Steel$/ }) }).locator('.maze-btn-ad');
        await steelTry.tap();
        await ad.waitForSelector('#mazeStartBtn', { state: 'visible', timeout: 10000 });
        let tr = await adbg('trial');
        check(tr.ball === 'steel' && tr.trial && tr.trial.id === 'steel', `TRY starts the next level with that marble: ${JSON.stringify(tr)}`);
        check(/TRYING STEEL/.test(await ad.textContent('#mazeStatus')), 'and says so');
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
        console.log('PASS: maze boot -- the page boots to home with level 1 offered, the tab bar switches screens, a run steers the right way on keys, collects coins, falls and restarts, conveyors carry the ball, a clear is banked by the progress store, the store and profile buy and select, bought power-ups and the marble reach the run, and it all survives a reload');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
