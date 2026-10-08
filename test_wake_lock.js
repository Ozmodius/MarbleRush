#!/usr/bin/env node
// Keeping the screen on (wakeLock.js), in a real browser: the wake lock when
// there is one, the looping video when there is not or it is refused (an
// iframe, an old iPhone), both let go on keepAwake(false), and the lock taken
// again after the browser drops it on a trip to the background.
//
// Each case gets its own page with navigator.wakeLock replaced by a stub, so
// the case is the stub's and not this sandbox's (headless Chromium's own
// answer depends on flags nobody plays with).

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = __dirname;
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

// A stub wake lock: 'grant' hands out sentinels the test can release from
// outside (as the browser does on hide); 'refuse' rejects like an iframe
// without permission; 'none' removes the API.
const STUB = (kind) => `
(() => {
    window.__locks = [];
    if (${JSON.stringify(kind)} === 'none') { try { delete Navigator.prototype.wakeLock; } catch (_) {} Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true }); return; }
    const api = {
        request: (type) => {
            if (${JSON.stringify(kind)} === 'refuse') return Promise.reject(new DOMException('not allowed', 'NotAllowedError'));
            const s = new EventTarget();
            s.type = type; s.released = false;
            s.release = () => { if (!s.released) { s.released = true; s.dispatchEvent(new Event('release')); } return Promise.resolve(); };
            window.__locks.push(s);
            return Promise.resolve(s);
        }
    };
    Object.defineProperty(navigator, 'wakeLock', { value: api, configurable: true });
})();`;

const PAGE = `<!doctype html><html><body><script type="module">
import { keepAwake } from './wakeLock.js';
window.keepAwake = keepAwake;
window.__ready = true;
</script></body></html>`;

(async () => {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        if (url === '/wake.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
        const file = path.join(ROOT, url);
        if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/wake.html`;
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const open = async (kind) => {
        const page = await browser.newPage();
        page.on('pageerror', e => failures.push(`${kind}: page error ${e.message}`));
        await page.addInitScript(STUB(kind));
        await page.goto(base);
        await page.waitForFunction(() => window.__ready === true);
        return page;
    };
    const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).then(() => true, () => false);
    try {
        // 1. A browser with the wake lock: it is used, and nothing else.
        {
            const page = await open('grant');
            check(await page.evaluate(() => window.__wakeDebug.mode()) === 'none', 'nothing is held before a level');
            await page.evaluate(() => keepAwake(true));
            check(await until(page, () => window.__wakeDebug.mode() === 'lock'), 'with a wake lock, the lock holds the screen');
            check(await page.evaluate(() => window.__locks.length === 1 && window.__locks[0].type === 'screen'), 'one screen lock is asked for');
            check(await page.evaluate(() => !document.querySelector('video')), 'and no video is made');
            await page.evaluate(() => keepAwake(true));
            check(await page.evaluate(() => window.__locks.length) === 1, 'asking twice takes no second lock');
            // The browser drops it when the page is hidden; on return it is taken again.
            await page.evaluate(() => window.__locks[0].release());
            check(await page.evaluate(() => window.__wakeDebug.mode()) === 'none', 'a lock the browser dropped is known to be gone');
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            check(await until(page, () => window.__wakeDebug.mode() === 'lock' && window.__locks.length === 2), 'back on screen, the lock is taken again');
            await page.evaluate(() => keepAwake(false));
            check(await page.evaluate(() => window.__wakeDebug.mode() === 'none' && window.__locks[1].released), 'leaving the level lets the lock go');
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            await page.waitForTimeout(100);
            check(await page.evaluate(() => window.__locks.length) === 2, 'and coming back to the menus takes no lock');
            await page.close();
        }
        // 2. No wake lock at all (older iPhones): the video.
        for (const kind of ['none', 'refuse']) {
            const page = await open(kind);
            await page.evaluate(() => keepAwake(true));
            const what = kind === 'none' ? 'with no wake lock' : 'with the lock refused (an iframe)';
            check(await until(page, () => window.__wakeDebug.mode() === 'video'), `${what}, the video holds the screen`);
            check(await until(page, () => window.__wakeDebug.videoPlaying()), `${what}, the video actually plays`);
            const v = await page.evaluate(() => { const v = document.querySelector('video'); if (!v) return {}; const r = v.getBoundingClientRect(); return { muted: v.muted, inline: v.hasAttribute('playsinline'), loop: v.loop, w: r.width, op: getComputedStyle(v).opacity, srcs: [...v.querySelectorAll('source')].map(s => s.type) }; });
            check(v.muted && v.inline && v.loop && v.w <= 1 && v.op === '0', `${what}, the video is muted, inline, looping and invisible: ${JSON.stringify(v)}`);
            check(v.srcs && v.srcs.includes('video/mp4') && v.srcs.includes('video/webm'), 'the clip comes as MP4 (iPhone) and WebM');
            await page.evaluate(() => keepAwake(false));
            check(await page.evaluate(() => window.__wakeDebug.mode() === 'none' && !window.__wakeDebug.videoPlaying()), `${what}, leaving the level stops the video`);
            await page.evaluate(() => keepAwake(true));
            check(await until(page, () => window.__wakeDebug.videoPlaying()) && await page.evaluate(() => document.querySelectorAll('video').length) === 1, `${what}, the next level reuses the one video`);
            await page.close();
        }
        // 3. The clips are real video: the browser can decode the WebM one.
        {
            const page = await open('none');
            await page.evaluate(() => keepAwake(true));
            check(await until(page, () => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.videoWidth === 16; }), 'the inlined clip decodes (16 px, frames ready)');
            await page.close();
        }
    } finally {
        await browser.close();
        server.close();
    }
    if (failures.length) {
        console.error('FAIL: wake lock\n  - ' + failures.join('\n  - '));
        process.exit(1);
    }
    console.log('PASS: wake lock -- the screen lock is used where it exists and taken again after a trip to the background, the muted invisible looping video stands in where it is missing or refused, and leaving a level lets both go');
})().catch(e => { console.error(e); process.exit(1); });
