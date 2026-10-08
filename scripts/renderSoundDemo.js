#!/usr/bin/env node
// Renders scripts/soundDemo.html's tour of the game's sounds to a WAV, in
// headless Chromium (OfflineAudioContext), so a sound change can be heard
// without a phone. Dev-only, like the other scripts.
//
//   node scripts/renderSoundDemo.js [out.wav]

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'sound-demo.wav'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

(async () => {
    const server = http.createServer((req, res) => {
        const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        page.on('pageerror', e => console.error('page error:', e.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/scripts/soundDemo.html`);
        await page.waitForFunction(() => typeof window.__soundDemo === 'function');
        const r = await page.evaluate(() => window.__soundDemo());
        fs.writeFileSync(OUT, Buffer.from(r.b64, 'base64'));
        console.log(`wrote ${OUT}: ${r.seconds.toFixed(1)} s, peak ${r.peak.toFixed(2)}`);
        r.titles.forEach((t, i) => console.log(`  ${fmt(r.starts[i])}  ${t}`));
    } finally {
        await browser.close();
        server.close();
    }
})().catch(e => { console.error(e); process.exit(1); });

function fmt(s) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
