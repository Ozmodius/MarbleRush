// The game boots and plays on its own: no server, no Ball Smack.
//
// Serves the repo with scripts/serve.js, opens it in Chromium and plays by real
// taps and keys: home -> PLAY -> level select -> level 1 -> START -> steer ->
// clear -> coins and the next level unlocked -> survives a reload. Also pins the
// rules progressStore.js took over from Ball Smack's server (a clear faster
// than the level's minMs counts for nothing) and the render gate (the loop stops
// drawing once the player is back on the home screen).
//
// The clear itself uses __mazeDebug.warpToGoal(): headless Chromium has no
// tilt sensor and nobody to steer, so the ball is put on the goal and the
// ORDINARY frame path notices. Nothing after that is faked.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright-core');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 8093;
const URL = `http://localhost:${PORT}/`;

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Wait on FRAMES, never on a wall clock: this sandbox can serve no rAF at all
// across a few hundred ms, and polling is what nudges an idle page into
// scheduling them.
async function waitFrames(page, n, timeoutMs = 15000) {
    const start = await page.evaluate(() => window.__r3dDebug.renderFrames());
    const t0 = Date.now();
    let now = start;
    while (now - start < n && Date.now() - t0 < timeoutMs) {
        await sleep(30);
        now = await page.evaluate(() => window.__r3dDebug.renderFrames());
    }
    return now - start;
}

async function run() {
    const server = spawn(process.execPath, [path.join(__dirname, 'scripts', 'serve.js'), String(PORT)], { stdio: 'ignore' });
    let browser;
    try {
        await sleep(600);
        browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
        const context = await browser.newContext({ viewport: { width: 412, height: 860 } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

        await page.goto(URL);
        await page.waitForFunction(() => window.__marbleRushReady === true, null, { timeout: 15000 });
        check(await page.isVisible('#home'), 'the home screen must show after boot');
        check((await page.textContent('#homeCoins')).includes('0 COINS'), 'a fresh save starts with 0 coins');

        // --- PLAY -> level select ------------------------------------------
        await page.click('#playBtn');
        await page.waitForSelector('#mazeSelect', { state: 'visible', timeout: 10000 });
        check(!(await page.isVisible('#home')), 'home must step aside for the level select');
        const rows = await page.$$eval('.maze-levelrow', els => els.map(e => ({ locked: e.classList.contains('is-locked'), next: e.classList.contains('is-next') })));
        check(rows.length === 12, `expected 12 level rows, got ${rows.length}`);
        check(rows[0] && !rows[0].locked && rows[0].next, 'level 1 must be open and marked as next');
        check(rows[1] && rows[1].locked, 'level 2 must be locked on a fresh save');

        // --- level 1: START, steer, clear -----------------------------------
        await page.click('.maze-levelrow >> nth=0');
        await page.waitForSelector('#mazeHud', { state: 'visible', timeout: 10000 });
        check(await page.evaluate(() => window.__mazeDebug.phase()) === 'ready', 'a level opens on its ready screen');
        await page.click('#mazeStartBtn');
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 5000 });

        const drawn = await waitFrames(page, 10);
        check(drawn >= 10, `a running level must keep drawing; only ${drawn} frames in the wait`);

        // A real key, then the ordinary frame path: UP is screen-up, which is -z.
        const before = await page.evaluate(() => window.__mazeDebug.ballPos());
        await page.keyboard.down('ArrowUp');
        const after = await page.evaluate(() => window.__mazeDebug.advanceFrames(40));
        await page.keyboard.up('ArrowUp');
        check(after && after.z < before.z - 0.05, `ArrowUp must roll the ball up the screen (z ${before.z} -> ${after && after.z})`);

        // Wait out level 1's minMs (2500), which the ledger enforces.
        await sleep(2700);
        check(await page.evaluate(() => window.__mazeDebug.warpToGoal()), 'warping onto the goal must win the run');
        const status = await page.textContent('#mazeStatus');
        // 120 for a first world-1 clear plus the 20% gold bonus: 3.7 s is well under
        // level 1's 12 s gold time.
        check(/CLEARED/.test(status) && /\+144 COINS/.test(status), `a first gold clear of a world-1 level pays 120 + 24 coins, status was "${status}"`);
        check(await page.isVisible('#mazeNextBtn'), 'NEXT MAZE must be offered after level 1');
        const save = await page.evaluate(() => JSON.parse(localStorage.getItem('marblerush_save')));
        check(save && save.coins === 144 && save.maze.cleared.w1_01 && save.maze.highestIndex === 1,
            `the clear must be saved, got ${JSON.stringify(save)}`);

        // --- level 2 too fast: the ledger refuses it -------------------------
        await page.click('#mazeNextBtn');
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'ready', null, { timeout: 5000 });
        await page.click('#mazeStartBtn');
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 5000 });
        await page.evaluate(() => window.__mazeDebug.warpToGoal());
        const fastStatus = await page.textContent('#mazeStatus');
        check(/could not be counted/.test(fastStatus), `a clear under minMs must not count, status was "${fastStatus}"`);
        const save2 = await page.evaluate(() => JSON.parse(localStorage.getItem('marblerush_save')));
        check(save2.coins === 144 && !save2.maze.cleared.w1_02, 'a refused clear must change nothing in the save');

        // --- back home: the render loop goes idle ----------------------------
        await page.click('#mazeWinExitBtn');
        await page.waitForSelector('#home', { state: 'visible', timeout: 5000 });
        check((await page.textContent('#homeCoins')).includes('144 COINS'), 'home must show the coins just earned');
        await sleep(300);
        const idleStart = await page.evaluate(() => window.__r3dDebug.renderFrames());
        await sleep(800);
        const idleEnd = await page.evaluate(() => window.__r3dDebug.renderFrames());
        check(idleEnd - idleStart <= 2, `the renderer must idle on the home screen, drew ${idleEnd - idleStart} frames`);

        // --- reload: progress survives ---------------------------------------
        await page.reload();
        await page.waitForFunction(() => window.__marbleRushReady === true, null, { timeout: 15000 });
        check((await page.textContent('#homeCoins')).includes('144 COINS'), 'coins must survive a reload');
        await page.click('#playBtn');
        await page.waitForSelector('#mazeSelect', { state: 'visible', timeout: 10000 });
        const rows2 = await page.$$eval('.maze-levelrow', els => els.map(e => ({ locked: e.classList.contains('is-locked'), cleared: e.classList.contains('is-cleared') })));
        check(rows2[0].cleared && !rows2[1].locked && rows2[2].locked, 'after a reload level 1 shows cleared and level 2 is open');

        // --- landscape, the shape most CrazyGames players have ---------------
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.click('.maze-levelrow >> nth=1');
        await page.waitForSelector('#mazeHud', { state: 'visible', timeout: 10000 });
        const fit = await page.evaluate(() => window.__mazeDebug.ballPos() !== null);
        check(fit, 'a level must build in a landscape window');

        check(errors.length === 0, 'no page errors, got:\n   ' + errors.join('\n   '));
    } finally {
        if (browser) await browser.close();
        server.kill();
    }

    if (failures.length) {
        console.error('FAIL: standalone boot\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: standalone boot -- home, level select, a steered and cleared level paying coins, a too-fast clear refused, an idle renderer on the home screen, progress surviving a reload, and a landscape build, with no page errors and no server');
    }
}

run().catch(e => { console.error(e); process.exitCode = 1; });
