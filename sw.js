// sw.js -- the service worker of the web build (planetilt.com) ONLY: it lets
// the game START with no connection, for a player who owns OFFLINE PLAY
// (server/offlineUnlock.js; the user's call, 2026-10-22: sold, not free).
// scripts/buildCrazyGames.js --web copies it in; the CrazyGames bundle never
// carries it (platform.js features.offlineInstall), and offlinePlay.js is
// what registers it and tells it what to keep.
//
// Ported from 3dBallSmack's sw.js, and the same rules hold:
//
// NETWORK FIRST, ALWAYS. Online, every request goes to the network exactly as
// it did before this file existed; the cache is read only when the network
// FAILS. Cache-first would serve an old deploy from a cache no deploy can
// reach, and a "slow network, use the cache" timeout could hand the page a
// mix of two deploys' files. A slow connection waits; that is the price.
//
// TWO STATES, set by the page on every online load ({ type: 'refresh', full }):
//   full  -- the player owns offline play: the whole game (offline-manifest.json,
//            written by the build, versioned by its files' hash) is fetched
//            into a NEW cache, and the old one is dropped only once the new
//            one is COMPLETE, so the offline copy is always one deploy.
//   lean  -- everyone else: no copy of the game is kept (any old one is
//            deleted -- signed out, or a refund). Opened with no connection,
//            the installed app shows a small page saying it needs one and what
//            OFFLINE PLAY is, instead of the browser's own error.
//
// A deploy does not change these bytes, so the browser never reinstalls this
// worker for one; the page's 'refresh' on each load is what keeps the copy
// current. Never cached: this file, the offline manifest, other origins (the
// API), anything but a plain 200.

const PREFIX = 'planetilt-offline-';
const COMPLETE = '/__planetilt_offline_complete__';

async function completeCache() {
    const keys = (await caches.keys()).filter(k => k.startsWith(PREFIX));
    for (let i = keys.length - 1; i >= 0; i--) {
        const c = await caches.open(keys[i]);
        if (await c.match(COMPLETE)) return keys[i];
    }
    return null;
}

async function dropAll(except) {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== except) await caches.delete(k);
}

// The whole game into a fresh cache, then the old ones go. addAll is
// all-or-nothing, so a dropped connection leaves the previous copy in place.
async function precache() {
    const res = await fetch('offline-manifest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('offline manifest ' + res.status);
    const m = await res.json();
    const name = PREFIX + m.version;
    if ((await completeCache()) === name) return name;
    const cache = await caches.open(name);
    try {
        await cache.addAll(m.files.map(f => new Request(f, { cache: 'no-cache' })));
        await cache.put(COMPLETE, new Response(m.version));
    } catch (e) {
        await caches.delete(name);
        throw e;
    }
    await dropAll(name);
    return name;
}

async function tell(msg) {
    const list = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const c of list) c.postMessage(msg);
}

self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

let refreshing = Promise.resolve();
self.addEventListener('message', (event) => {
    const d = event.data || {};
    if (d.type !== 'refresh') return;
    // One at a time: a second load's refresh waits for the first.
    refreshing = refreshing.then(async () => {
        if (!d.full) { await dropAll(null); await tell({ type: 'offline-state', ready: false }); return; }
        await tell({ type: 'offline-state', ready: false, busy: true });
        try { await precache(); await tell({ type: 'offline-state', ready: true }); }
        catch (e) { await tell({ type: 'offline-state', ready: !!(await completeCache()), failed: true }); }
    });
    event.waitUntil(refreshing);
});

function cacheable(url) {
    if (url.origin !== self.location.origin) return false;
    return !['/sw.js', '/offline-manifest.json'].includes(url.pathname);
}

// No connection and no copy of the game: say so in the game's own colours.
function offlinePage() {
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#070a17"><title>PlaneTilt</title>'
        + '<style>html,body{margin:0;height:100%;background:#070a17;color:#e8f1ff;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}'
        + 'main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}'
        + '.card{max-width:340px;padding:24px 22px;border-radius:18px;background:rgba(12,16,34,.92);border:1px solid rgba(110,220,255,.45);box-shadow:0 10px 30px rgba(0,0,0,.4)}'
        + 'h1{margin:0 0 6px;font-size:1.6rem;letter-spacing:.04em}h1 b{color:#ffc94a}p{margin:10px 0;color:#b9cbe6}'
        + 'button{margin-top:12px;padding:12px 26px;border:0;border-radius:999px;background:#ffc94a;color:#2a1a00;font-weight:900;letter-spacing:.08em;font-size:1rem}</style></head>'
        + '<body><main><div class="card"><h1>Plane<b>Tilt</b></h1><p><b style="color:#e8f1ff">No connection.</b> PlaneTilt needs the internet to start.</p>'
        + '<p>With <b style="color:#ffc94a">OFFLINE PLAY</b> (in Gear, with a free account) the whole game stays on this device, so it starts anywhere.</p>'
        + '<button onclick="location.reload()">TRY AGAIN</button></div></main></body></html>';
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (!cacheable(url)) return;
    const page = req.mode === 'navigate';
    event.respondWith((async () => {
        try {
            const res = await fetch(req);
            if (res.ok && res.type === 'basic') {
                const name = await completeCache();
                // Only an owner's copy is kept current; the page lives under
                // '/' whatever its query (?offline_unlock=done).
                if (name) { const copy = res.clone(); event.waitUntil(caches.open(name).then(c => c.put(page ? '/' : req, copy)).catch(() => {})); }
            }
            return res;
        } catch (err) {
            const name = await completeCache();
            const cache = name ? await caches.open(name) : null;
            const hit = !cache ? null : page ? await cache.match('/') : (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
            if (hit) return hit;
            if (page) return offlinePage();
            throw err;
        }
    })());
});
