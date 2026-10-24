#!/usr/bin/env node
// PLAY ANYWHERE in a real browser (offlinePlay.js, sw.js, server/offlineUnlock.js;
// the user's calls, 2026-10-22: an installable app with an offline mode, and
// offline play SOLD, "Gate").
//
// Against the BUILT web game (dist/web, `npm run build:web` first), with a
// real PlaneTilt API in this process and a stand-in for Square:
//   - a guest: the app is offered (Get the app, the install sheet, Chrome's
//     own dialog in one tap); offline play is offered at its price behind a
//     free account; NO copy of the game is kept, so a reload with no
//     connection shows sw.js's "needs the internet" page, not the game;
//   - an account: UNLOCK goes to Square's checkout and back, the payment is
//     seen at once (no webhook), the whole game is cached, and with the
//     connection cut a reload BOOTS THE GAME and a level is played and banked;
//   - signing out drops the offline copy;
//   - the iPhone gets Safari's steps and the note about the app's own save;
//   - the CrazyGames bundle (dist/crazygames, when built) carries none of it.
//
// Run: npm run build:web && node test_offline_boot.js

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const WEB = path.join(__dirname, 'dist', 'web');
const CG = path.join(__dirname, 'dist', 'crazygames');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const failures = [];
// SHOTS=<dir>: screenshots of each screen, for judging by eye.
const shot = async (pg, name, sel) => { if (!process.env.SHOTS) return; try { await pg.waitForTimeout(500); const el = sel ? await pg.$(sel) : null; await (el || pg).screenshot({ path: path.join(process.env.SHOTS, name + '.png') }); } catch (_) { /* best effort */ } };
const check = (c, m) => { if (!c) failures.push(m); else process.stdout.write('.'); };

// Square, standing in: a payment link is a page on the game's own test
// server that "pays" and sends the buyer back, as Square's checkout does.
const sq = { orders: new Map(), payments: new Map(), n: 0, gameBase: '' };
function squareServer() {
    return http.createServer((req, res) => {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => {
            const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
            if (req.method === 'POST' && req.url === '/v2/online-checkout/payment-links') {
                const b = JSON.parse(raw);
                const id = 'order-' + (++sq.n);
                sq.orders.set(id, { tenders: [], redirect: b.checkout_options && b.checkout_options.redirect_url, amount: b.order.line_items[0].base_price_money.amount });
                return send(200, { payment_link: { url: sq.gameBase + '__square/pay?order=' + id, order_id: id } });
            }
            let m = /^\/v2\/orders\/(.+)$/.exec(req.url);
            if (m) { const o = sq.orders.get(m[1]); return o ? send(200, { order: { tenders: o.tenders } }) : send(404, {}); }
            m = /^\/v2\/payments\/(.+)$/.exec(req.url);
            if (m) { const p = sq.payments.get(m[1]); return p ? send(200, { payment: p }) : send(404, {}); }
            send(404, {});
        });
    });
}

function gameServer(root, api) {
    return http.createServer(cut((req, res) => {
        const u = new URL(req.url, 'http://x');
        if (u.pathname === '/__square/pay') {
            const id = u.searchParams.get('order'), o = sq.orders.get(id);
            sq.payments.set('pay-' + id, { id: 'pay-' + id, order_id: id, status: 'COMPLETED', location_id: 'LOC1', amount_money: { amount: o.amount, currency: 'USD' } });
            o.tenders = [{ id: 't', payment_id: 'pay-' + id }];
            res.writeHead(302, { Location: o.redirect });
            res.end();
            return;
        }
        const rel = decodeURIComponent(u.pathname) === '/' ? 'index.html' : decodeURIComponent(u.pathname).slice(1);
        const file = path.join(root, rel);
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        // The API this test runs (the build was made without one).
        if (rel === 'index.html' && api) res.end(fs.readFileSync(file, 'utf8').replace('<!-- BUILD', `<script>window.__PLANETILT_API__ = ${JSON.stringify(api)};</script>\n<!-- BUILD`).replace('<script src="game.js">', `<script>window.__PLANETILT_API__ = ${JSON.stringify(api)};</script><script src="game.js">`));
        else fs.createReadStream(file).pipe(res);
    }));
}
// No connection, for real: Playwright's setOffline does not reach a service
// worker's own fetches, so the servers themselves cut every request.
let down = false;
const cut = h => (req, res) => { if (down) { req.socket.destroy(); return; } h(req, res); };
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}/`)));

(async () => {
    if (!fs.existsSync(path.join(WEB, 'sw.js'))) { console.error('Build the web game first: npm run build:web'); process.exit(1); }
    const { createApp } = await import('./server/app.js');
    const { createMemoryStore } = await import('./server/db.js');
    const { createOfflineUnlock } = await import('./server/offlineUnlock.js');
    const levels = JSON.parse(fs.readFileSync(path.join(__dirname, 'mazeLevels.json'), 'utf8')).levels;
    const dailyLevels = JSON.parse(fs.readFileSync(path.join(__dirname, 'dailyLevels.json'), 'utf8')).levels;
    const square = squareServer();
    const squareBase = (await listen(square)).replace(/\/$/, '');
    const store = createMemoryStore();
    const unlock = createOfflineUnlock({ store, env: { SQUARE_ACCESS_TOKEN: 't', SQUARE_LOCATION_ID: 'LOC1', SQUARE_API_BASE: squareBase }, log: { log() {}, error: console.error } });
    const api = http.createServer(cut(createApp({ store, levels, dailyLevels, rateMax: 100000, adminToken: 'adm', unlock })));
    const apiBase = (await listen(api)).replace(/\/$/, '');
    const web = gameServer(WEB, apiBase);
    const base = await listen(web);
    sq.gameBase = base;

    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const errors = [];
    const offlineCaches = pg => pg.evaluate(async () => {
        const out = [];
        for (const k of await caches.keys()) if (k.startsWith('planetilt-offline-')) out.push({ k, complete: !!(await (await caches.open(k)).match('/__planetilt_offline_complete__')) });
        return out;
    });
    const booted = pg => pg.waitForFunction(() => window.__cloudSync !== undefined && window.__offlinePlay !== undefined, null, { timeout: 60000 });
    const gear = async (pg) => {
        if (await pg.isVisible('#storyPanel')) await pg.tap('#storyCloseBtn');
        if (await pg.isVisible('#mazeExitBtn')) await pg.tap('#mazeExitBtn').catch(() => {});
        await pg.waitForSelector('#tabBar', { state: 'visible', timeout: 30000 });
        for (const id of ['#levelPanel', '#rewardsPanel']) if (await pg.isVisible(id)) await pg.tap(id === '#levelPanel' ? '#levelOkBtn' : '#rewardsCloseBtn');
        await pg.tap('#tab_gear');
        await pg.waitForSelector('#appSection', { state: 'visible', timeout: 10000 });
    };
    try {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
            userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' });
        const page = await ctx.newPage();
        page.on('pageerror', e => errors.push(String(e)));

        // --- a guest -----------------------------------------------------------
        await page.goto(base);
        await booted(page);
        check(await page.isVisible('#landing'), 'the web opens on its front door');
        check(await page.isVisible('#landing [data-install]'), 'the landing site offers Get the app');
        check((await page.evaluate(() => [...document.querySelectorAll('link[rel="manifest"]')].length)) === 1, 'the page carries the app manifest');
        const mf = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
        check(mf.display === 'standalone' && mf.start_url === '/' && mf.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable') && mf.icons.some(i => i.sizes === '192x192') && !mf.orientation,
            'the manifest: standalone, from /, 192 and 512 icons (one maskable), no orientation lock');
        for (const i of mf.icons) check((await page.evaluate(async src => (await fetch(src)).ok, i.src)), 'icon ' + i.src + ' is there');
        await page.tap('#landing .lp-foot [data-install]');
        await page.waitForSelector('#installPanel', { state: 'visible' });
        check((await page.evaluate(() => window.__offlinePlay.mode())) === 'android' && (await page.$$('#installSteps .ig-step')).length === 3, 'Get the app shows this phone\'s steps');
        await shot(page, '1-android-install-sheet');
        await page.tap('#installCloseBtn');
        await page.tap('#landing .lp-hero [data-lp="guest"]');
        await page.waitForFunction(() => navigator.serviceWorker.controller || null, null, { timeout: 30000 }).catch(() => {});
        await page.evaluate(() => navigator.serviceWorker.ready);
        await gear(page);
        check(/\$4\.99/.test(await page.textContent('#appOfflineBadge')) && (await page.textContent('#appOfflineBtn')).trim() === 'CREATE FREE ACCOUNT',
            `a guest is offered offline play at $4.99 behind a free account: "${await page.textContent('#appOfflineBadge')}" / "${await page.textContent('#appOfflineBtn')}"`);
        await page.evaluate(() => document.getElementById('appSection').scrollIntoView({ block: 'center' }));
        await shot(page, '2-gear-guest');
        check((await page.textContent('#appInstallBtn')).trim() === 'HOW TO INSTALL', 'with no install dialog on offer, the button opens the steps');
        // Chrome's own dialog, when it offers one: one tap.
        await page.evaluate(() => window.__offlinePlay.fakePrompt({ prompt: async () => { window.__prompted = (window.__prompted || 0) + 1; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) }));
        check((await page.textContent('#appInstallBtn')).trim() === 'INSTALL THE APP', 'with Chrome\'s dialog on offer, the button says INSTALL THE APP');
        await page.tap('#appInstallBtn');
        await page.waitForFunction(() => window.__prompted === 1, null, { timeout: 5000 }).catch(() => {});
        check(await page.evaluate(() => window.__prompted === 1), 'and one tap brings up Chrome\'s own install dialog');
        check((await offlineCaches(page)).length === 0, 'a guest keeps no copy of the game');
        // No connection, no copy: sw.js's page, not the browser's error.
        await page.reload();
        await booted(page);
        down = true; await ctx.setOffline(true);
        await page.reload().catch(() => {});
        await page.waitForSelector('text=No connection', { timeout: 15000 }).catch(() => {});
        const offTxt = await page.textContent('body').catch(() => '');
        await shot(page, '3-guest-no-connection');
        check(/No connection/.test(offTxt) && /OFFLINE PLAY/.test(offTxt) && !(await page.$('#gameCanvas')), 'a guest opening it with no connection gets the "needs the internet" page naming OFFLINE PLAY');
        down = false; await ctx.setOffline(false);

        // --- an account buys it -----------------------------------------------
        await page.goto(base);
        await booted(page);
        await gear(page);
        await page.tap('#appOfflineBtn');
        await page.waitForSelector('#acctView_register', { state: 'visible' });
        await page.fill('#regUsername', 'Flyer');
        await page.fill('#regEmail', 'flyer@x.test');
        await page.fill('#regPassword', 'long enough');
        await page.click('#acctView_register button[type="submit"]');
        await page.waitForSelector('#accountPanel', { state: 'hidden', timeout: 15000 });
        await page.waitForFunction(() => document.getElementById('appOfflineBtn').textContent.trim() === 'UNLOCK $4.99', null, { timeout: 15000 }).catch(() => {});
        check((await page.textContent('#appOfflineBtn')).trim() === 'UNLOCK $4.99' && /Square/.test(await page.textContent('#appOfflineLine')), `an account is offered UNLOCK $4.99, paid through Square: "${await page.textContent('#appOfflineBtn')}"`);
        await page.evaluate(() => document.getElementById('appSection').scrollIntoView({ block: 'center' }));
        await shot(page, '4-gear-account');
        await Promise.all([page.waitForURL(/offline_unlock=done|\/$/, { timeout: 30000 }), page.tap('#appOfflineBtn')]);
        await booted(page);
        check(!/offline_unlock/.test(page.url()), 'back from checkout, the marker leaves the address');
        await page.waitForFunction(() => /yours/.test(document.getElementById('offlinePanelMsg').textContent), null, { timeout: 30000 }).catch(() => {});
        check(await page.isVisible('#offlinePanel') && /Offline play is yours/.test(await page.textContent('#offlinePanelMsg')), `back from checkout, paid, it unlocks at once: "${await page.textContent('#offlinePanelMsg')}"`);
        const me = await page.evaluate(() => window.__cloudSync.player());
        check(!!(await store.offlinePlayOf(me.id)), 'the server holds the unlock on the account');
        await shot(page, '5-unlocked');
        await page.tap('#offlineOkBtn');
        await page.waitForFunction(() => window.__offlinePlay.copy() === 'ready', null, { timeout: 60000 }).catch(() => {});
        const cs = await offlineCaches(page);
        check(cs.length === 1 && cs[0].complete, `the whole game is kept on the device: ${JSON.stringify(cs)}`);
        await gear(page);
        await page.evaluate(() => document.getElementById('appSection').scrollIntoView({ block: 'center' }));
        await shot(page, '6-gear-owned');
        check((await page.textContent('#appOfflineBadge')).trim() === 'YOURS' && /Ready/.test(await page.textContent('#appOfflineLine')) && await page.isHidden('#appOfflineBtn'),
            `Gear says it is yours and ready: "${await page.textContent('#appOfflineLine')}"`);

        // --- no connection: the game boots and plays ---------------------------
        down = true; await ctx.setOffline(true);
        await page.reload();
        await booted(page);
        check(await page.isHidden('#landing') && await page.isHidden('#bootMsg'), 'with no connection the game boots from the device, signed in, no front door');
        const lv1 = levels[0];
        const dbg = (fn, ...args) => page.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);
        check(await dbg('startLevelForTest', lv1.id), 'a level starts offline');
        await page.waitForSelector('#mazeStartBtn', { state: 'visible', timeout: 15000 });
        if (await page.isVisible('#storyPanel')) await page.tap('#storyCloseBtn');
        await page.tap('#mazeStartBtn');
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 15000 });
        await dbg('ageRun', lv1.goldMs + 5000);
        check(await dbg('warpToGoal'), 'and is cleared offline');
        check(!!(await dbg('progress')).cleared[lv1.id], 'the offline clear is banked on the device');
        check(errors.length === 0, 'no page errors offline: ' + errors.join(' | '));
        down = false; await ctx.setOffline(false);
        // Back online the clear goes up to the account.
        await page.evaluate(() => window.__cloudSync.reconnect());
        await page.waitForFunction(() => window.__cloudSync.status() === 'synced', null, { timeout: 30000 }).catch(() => {});
        const srv = await store.getSave(me.id);
        check(srv && srv.data.cleared && srv.data.cleared[lv1.id], 'back online, the offline clear reaches the account');

        // --- signing out drops the copy ----------------------------------------
        await page.reload();
        await booted(page);
        await gear(page);
        // Signing out reloads the page: wait for the NEW page, not the old one.
        await page.evaluate(() => { window.__beforeSignOut = 1; });
        await page.tap('#acctSignOutBtn');
        for (let t = 0; t < 60; t++) {
            const fresh = await page.evaluate(() => !window.__beforeSignOut && window.__offlinePlay !== undefined).catch(() => false);
            if (fresh) break;
            await new Promise(r => setTimeout(r, 500));
        }
        await page.waitForFunction(async () => { for (const k of await caches.keys()) if (k.startsWith('planetilt-offline-') && await (await caches.open(k)).match('/__planetilt_offline_complete__')) return false; return true; }, null, { timeout: 30000 }).catch(() => {});
        // A request in flight as the copy is dropped can leave an empty,
        // incomplete cache behind for a moment; it is never read (sw.js reads
        // only a complete one) and the next load clears it.
        const left = (await offlineCaches(page)).filter(c => c.complete);
        check(left.length === 0 && await page.isVisible('#landing'), 'signing out drops the offline copy (back at the front door)');
        await ctx.close();

        // --- an iPhone ---------------------------------------------------------
        const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
        const ip = await ios.newPage();
        await ip.goto(base);
        await booted(ip);
        await ip.tap('#landing .lp-foot [data-install]');
        await ip.waitForSelector('#installPanel', { state: 'visible' });
        await shot(ip, '7-iphone-install-sheet');
        const steps = await ip.textContent('#installSteps');
        check((await ip.evaluate(() => window.__offlinePlay.mode())) === 'ios-safari' && /Share/.test(steps) && /Add to Home Screen/.test(steps) && await ip.isHidden('#installGoBtn'),
            'an iPhone gets Safari\'s Share, Add to Home Screen steps');
        check(await ip.isVisible('#installNote') && /own save/.test(await ip.textContent('#installNote')), 'and is told the Home Screen app keeps its own save');
        check(await ip.isHidden('#lpAppWelcome'), 'Safari (not the app) gets no app welcome');
        await ios.close();

        // --- CrazyGames: none of it --------------------------------------------
        if (fs.existsSync(path.join(CG, 'index.html'))) {
            const cg = gameServer(CG, null);
            const cgBase = await listen(cg);
            const cctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
            const cp = await cctx.newPage();
            await cp.route(/sdk\.crazygames\.com/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
            await cp.goto(cgBase);
            await cp.waitForFunction(() => window.__cloudSync !== undefined, null, { timeout: 60000 });
            await cp.evaluate(() => new Promise(r => setTimeout(r, 1000)));
            check((await cp.evaluate(() => !!document.querySelector('link[rel="manifest"]'))) === false, 'the CrazyGames page has no app manifest');
            check((await cp.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)) === 0, 'and registers no service worker');
            check(await cp.evaluate(() => document.getElementById('appSection').hidden), 'and shows no PLAY ANYWHERE card');
            check((await cp.evaluate(async () => (await fetch('sw.js')).status)) === 404, 'and has no sw.js');
            await cctx.close();
            cg.close();
        }
    } catch (e) {
        failures.push('threw: ' + (e && e.stack || e));
    } finally {
        await browser.close();
        web.close(); api.close(); square.close();
    }
    console.log('');
    if (failures.length) { console.error(failures.map(f => 'FAIL ' + f).join('\n')); process.exit(1); }
    console.log('offline boot: all passed');
    process.exit(0);
})();
