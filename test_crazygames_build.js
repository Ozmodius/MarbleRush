// The CrazyGames bundle builds flat, boots with the SDK, and saves through it.
//
// Runs scripts/build.js, then serves dist/crazygames/ from a fake origin with a
// STUB CrazyGames SDK in place of the real one (this sandbox cannot reach it).
// The stub records what the game asks of it, so the test can check the calls
// CrazyGames' QA looks for (loading start/stop, gameplay start/stop) and that
// progress goes to the SDK's data module rather than straight to localStorage.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright-core');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.join(__dirname, 'dist', 'crazygames');
const ORIGIN = 'https://marblerush.cg.test';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const STUB_SDK = `
window.__cgCalls = [];
window.__cgData = {};
const log = (n) => window.__cgCalls.push(n);
window.CrazyGames = { SDK: {
    environment: 'crazygames',
    init: async () => { log('init'); },
    game: {
        settings: { muteAudio: false, disableChat: false },
        loadingStart: () => log('loadingStart'), loadingStop: () => log('loadingStop'),
        gameplayStart: () => log('gameplayStart'), gameplayStop: () => log('gameplayStop'),
        happytime: () => log('happytime'),
        reportGameCompletedPercentage: (p) => log('completed:' + p),
        addSettingsChangeListener: () => {}, addJoinRoomListener: () => {},
    },
    ad: { requestAd: (type, cb) => { log('ad:' + type); cb && cb.adError && cb.adError({ code: 'unfilled' }); } },
    user: { addAuthListener: () => {} },
    data: {
        getItem: (k) => (k in window.__cgData ? window.__cgData[k] : null),
        setItem: (k, v) => { log('data.setItem:' + k); window.__cgData[k] = String(v); },
        removeItem: (k) => { delete window.__cgData[k]; },
    },
} };`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

async function run() {
    const failures = [];
    const check = (cond, msg) => { if (!cond) failures.push(msg); };

    execSync('node scripts/build.js', { cwd: __dirname, stdio: 'ignore' });
    const files = fs.readdirSync(OUT);
    check(files.every(f => fs.statSync(path.join(OUT, f)).isFile()), 'the bundle must be flat: no folders');
    for (const f of ['index.html', 'three.module.js', 'three.core.js', 'RoomEnvironment.js', 'cannon-es.js', 'mazeLevels.json']) {
        check(files.includes(f), `the bundle must ship ${f}`);
    }
    check(!files.some(f => /^test_/.test(f)), 'tests must not ship');
    const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
    check(html.includes('window.__PLATFORM__ = "crazygames"'), 'index.html must switch on CrazyGames mode');

    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        const errors = [];
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
        await page.route('https://sdk.crazygames.com/**', r => r.fulfill({ contentType: 'text/javascript', body: STUB_SDK }));
        await page.route(ORIGIN + '/**', r => {
            const name = new URL(r.request().url()).pathname.replace(/^\/+/, '') || 'index.html';
            const file = path.join(OUT, name);
            if (name.includes('/') || !fs.existsSync(file)) return r.fulfill({ status: 404, body: 'missing ' + name });
            r.fulfill({ contentType: TYPES[path.extname(name)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });

        await page.goto(ORIGIN + '/');
        await page.waitForFunction(() => window.__marbleRushReady === true, null, { timeout: 15000 });
        const boot = await page.evaluate(() => window.__cgCalls.slice());
        check(boot[0] === 'init' && boot.includes('loadingStart') && boot.includes('loadingStop'),
            `boot must init the SDK and report loading start/stop, got ${JSON.stringify(boot)}`);
        check((await page.textContent('#buildStamp')).endsWith('-cg'), 'the build stamp must carry the build label');

        await page.click('#playBtn');
        await page.waitForSelector('#mazeSelect', { state: 'visible', timeout: 10000 });
        await page.click('.maze-levelrow >> nth=0');
        await page.click('#mazeStartBtn');
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 5000 });
        await sleep(2700);
        check(await page.evaluate(() => window.__mazeDebug.warpToGoal()), 'a level must clear in the CrazyGames build');

        const calls = await page.evaluate(() => window.__cgCalls.slice());
        check(calls.includes('gameplayStart') && calls.includes('gameplayStop'), 'a run must report gameplay start and stop');
        check(calls.includes('happytime'), 'a first clear must call happytime');
        check(calls.some(c => c.startsWith('completed:')), 'a clear must report completion');
        check(calls.includes('data.setItem:marblerush_save'), 'progress must be saved through the SDK data module');
        const saved = await page.evaluate(() => JSON.parse(window.__cgData.marblerush_save || 'null'));
        check(saved && saved.maze && saved.maze.cleared.w1_01, 'the SDK save must hold the clear');
        check(await page.evaluate(() => localStorage.getItem('marblerush_save')) === null,
            'with the data module present, progress must not ALSO go to localStorage');

        // NEXT MAZE is a natural break: it may ask for a midgame ad (the stub
        // reports no fill, which must not stop the next level loading).
        await page.click('#mazeNextBtn');
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'ready', null, { timeout: 5000 });

        check(errors.length === 0, 'no page errors, got:\n   ' + errors.join('\n   '));
    } finally {
        await browser.close();
    }

    if (failures.length) {
        console.error('FAIL: CrazyGames build\n - ' + failures.join('\n - '));
        process.exitCode = 1;
    } else {
        console.log('PASS: CrazyGames build -- flat bundle, SDK init and loading/gameplay reports, happytime and completion on a first clear, progress saved through the SDK data module, and NEXT MAZE surviving an unfilled ad');
    }
}

run().catch(e => { console.error(e); process.exitCode = 1; });
