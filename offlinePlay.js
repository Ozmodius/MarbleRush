// PLAY ANYWHERE: the installable app and OFFLINE PLAY, on the web only
// (platform.js features.offlineInstall / sellsOfflinePlay; the user's call,
// 2026-10-22: "make planetilt have an offline mode and installable from
// safari/chrome", then "Gate" -- offline play is SOLD, like 3dBallSmack's).
//
//   - THE APP is free for everyone: the build gives the page a manifest and
//     icons (scripts/buildCrazyGames.js --web). Chrome and Edge offer their
//     own install dialog (beforeinstallprompt), and INSTALL THE APP opens it
//     in one tap; Safari has none, so the install sheet shows THIS phone's and
//     browser's steps, each with the icon to look for, drawn. (Ported from
//     3dBallSmack's installGuide.js.)
//   - OFFLINE PLAY is the whole game kept on the device so it STARTS with no
//     connection. sw.js is registered for every web player, but keeps a copy
//     only for an account that owns offline play (server/offlineUnlock.js,
//     $4.99 through Square, kept on the account on every device). A guest is
//     asked to make an account first; signing out (or a refund) drops the
//     copy on the next load. Without it, an installed app opened with no
//     connection gets sw.js's small "needs the internet" page, which names
//     OFFLINE PLAY. Losing signal MID-GAME was never sold: the game is local
//     first and always kept playing (cloudSync.js catches up).
//   - THE IPHONE'S HOME SCREEN APP has its own storage, apart from Safari's:
//     it opens signed out, with its own (empty) offline copy. The install
//     sheet says so, and the landing site greets that first open.
//
// Checkout is Square's page: a full navigation away, back to
// /?offline_unlock=done. The server asks Square at once on the way back
// (cloudSync offlineCheck), and a checkout left open is checked again when
// the game comes back to the front, so a webhook that is late or off never
// leaves a paid player locked out.
//
// initOfflinePlay({ sync, openAccount }) -- after initCloudUi (main.js).

import { features } from './platform.js';

const $ = id => document.getElementById(id);
const PENDING_KEY = 'planetilt.offlineCheckout';   // when a checkout was opened (device only)
const PENDING_MS = 2 * 3600e3;
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* this visit only */ } };

// ---------------------------------------------------------------------------
// Which phone, which browser
// ---------------------------------------------------------------------------
const UA = () => (navigator.userAgent || '');
export function isHomeScreenApp() {
    try { return navigator.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches); }
    catch (_) { return false; }
}
const isIPad = () => /iPad/.test(UA()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isIOS = () => /iPhone|iPod/.test(UA()) || isIPad();
const isAndroid = () => /Android/i.test(UA());
// A browser inside another app; these cannot install anything.
const isInApp = () => /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|TikTok|musical_ly|BytedanceWebview|Snapchat|Twitter|LinkedInApp|Pinterest|; wv\)/i.test(UA());
const isMacSafari = () => /Macintosh/.test(UA()) && /Safari\//.test(UA()) && !/Chrome|Chromium|Edg\//.test(UA()) && !isIPad();

// Chrome's own dialog, held until asked for (one prompt() per event).
let deferred = null;
let installed = false;

// 'prompt' | 'ios-safari' | 'ios-other' | 'samsung' | 'android' | 'inapp'
// | 'mac-safari' | 'desktop'
export function installMode() {
    if (isInApp()) return 'inapp';
    if (deferred) return 'prompt';
    if (isIOS()) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(UA()) ? 'ios-other' : 'ios-safari';
    if (isAndroid()) return /SamsungBrowser/i.test(UA()) ? 'samsung' : 'android';
    if (isMacSafari()) return 'mac-safari';
    return 'desktop';
}

const ICONS = {
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2"/><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/></svg>',
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    kebab: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 7v6M9 10l3 3 3-3"/><path d="M8 21h8"/></svg>',
    app: '<img src="icons/icon-192.png" alt="">'
};

export function stepsFor(mode) {
    const open = { icon: 'app', html: 'Open <b>PlaneTilt</b> from your home screen.' };
    switch (mode) {
    case 'prompt':
        return [{ icon: 'install', html: 'Tap <b>INSTALL</b> below, then <b>Install</b>.' }, open];
    case 'ios-safari':
        return [
            { icon: 'share', html: isIPad()
                ? 'Tap the <b>Share</b> button at the <b>top right</b>.'
                : 'Tap the <b>Share</b> button in the bar at the <b>bottom</b> of the screen (on the newest iPhones it may be inside the <b>&#8943;</b> button).' },
            { icon: 'add', html: 'Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.' },
            open
        ];
    case 'ios-other':
        return [
            { icon: 'share', html: 'Tap the <b>Share</b> button next to the address bar. Not there? Open planetilt.com in <b>Safari</b> instead.' },
            { icon: 'add', html: 'Tap <b>Add to Home Screen</b>, then <b>Add</b>.' },
            open
        ];
    case 'samsung':
        return [
            { icon: 'menu', html: 'Tap <b>&#9776;</b> at the <b>bottom right</b>.' },
            { icon: 'add', html: 'Tap <b>Add page to</b>, then <b>Home screen</b>.' },
            open
        ];
    case 'android':
        return [
            { icon: 'kebab', html: 'Tap <b>&#8942;</b> at the <b>top right</b>.' },
            { icon: 'add', html: 'Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.' },
            open
        ];
    case 'inapp':
        return [
            { icon: 'dots', html: 'You are inside another app, which cannot install games. Tap <b>&#8943;</b> and choose <b>' + (isIOS() ? 'Open in Safari' : 'Open in browser') + '</b>.' },
            { icon: 'app', html: 'Then tap <b>Get the app</b> again there.' }
        ];
    case 'mac-safari':
        return [
            { icon: 'share', html: 'In Safari\'s menu bar, choose <b>File</b>, then <b>Add to Dock</b>.' },
            { icon: 'app', html: 'Open <b>PlaneTilt</b> from your Dock.' }
        ];
    default:
        return [
            { icon: 'install', html: 'In <b>Chrome</b> or <b>Edge</b>, click the <b>install</b> icon at the right of the address bar (or the menu, then <b>Install PlaneTilt</b>).' },
            { icon: 'app', html: 'On a phone? Open <b>planetilt.com</b> there and tap <b>Get the app</b>.' }
        ];
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let sync = null, openAccount = () => {};
let swReg = null;
let copy = 'none';            // the offline copy on this device: 'none' | 'busy' | 'ready' | 'failed'
let lastFull = null;          // what sw.js was last told
const online = () => navigator.onLine !== false;
const money = c => '$' + (c / 100).toFixed(2);

function offline() {
    if (!features.sellsOfflinePlay || !sync || !sync.enabled) return { owned: false, priceCents: null };
    return sync.offline();
}
const isAccount = () => { const me = sync && sync.player(); return !!(me && me.kind === 'account'); };

// ---------------------------------------------------------------------------
// The service worker
// ---------------------------------------------------------------------------
const swAllowed = () => features.offlineInstall && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    // The page carries a manifest only in the web build: the dev page and
    // any other copy never register a worker.
    && !!document.querySelector('link[rel="manifest"]');

// Tell sw.js what to keep: the whole game for an owner, nothing otherwise.
// Offline, nothing is told (the copy stays as it is).
function tellWorker(force = false) {
    if (!swReg || !online()) return;
    const full = offline().owned;
    if (!force && full === lastFull) return;
    const w = swReg.active || swReg.waiting || swReg.installing;
    if (!w) return;
    lastFull = full;
    if (full && copy !== 'ready') copy = 'busy';
    w.postMessage({ type: 'refresh', full });
    render();
}

async function readCopy() {
    try {
        for (const k of await caches.keys()) {
            if (!k.startsWith('planetilt-offline-')) continue;
            if (await (await caches.open(k)).match('/__planetilt_offline_complete__')) return true;
        }
    } catch (_) { /* no caches here */ }
    return false;
}

function startWorker() {
    if (!swAllowed()) return;
    navigator.serviceWorker.addEventListener('message', (e) => {
        const d = e.data || {};
        if (d.type !== 'offline-state') return;
        copy = d.ready ? 'ready' : d.busy ? 'busy' : d.failed ? 'failed' : 'none';
        render();
    });
    readCopy().then((ready) => { if (ready && copy !== 'busy') { copy = 'ready'; render(); } });
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
        swReg = reg;
        tellWorker(true);
    }).catch((e) => console.warn('[offline] service worker:', e && e.message));
    window.addEventListener('online', () => tellWorker(true));
}

// ---------------------------------------------------------------------------
// The Gear card
// ---------------------------------------------------------------------------
function render() {
    const sec = $('appSection');
    if (!sec || !features.offlineInstall) return;
    sec.hidden = false;
    const icon = $('appIcon');
    if (icon && !icon.firstChild) icon.innerHTML = ICONS.app;
    const app = isHomeScreenApp();
    $('appInstallLine').textContent = app
        ? 'You are playing in the PlaneTilt app.'
        : 'Put PlaneTilt on your home screen: full screen, one tap away.';
    const ib = $('appInstallBtn');
    ib.hidden = app || installed;
    ib.textContent = installMode() === 'prompt' ? 'INSTALL THE APP' : 'HOW TO INSTALL';

    const o = offline();
    const box = $('appOffline');
    box.hidden = !(o.owned || o.priceCents !== null);
    if (box.hidden) return;
    const btn = $('appOfflineBtn'), line = $('appOfflineLine'), badge = $('appOfflineBadge');
    btn.disabled = false;
    if (o.owned) {
        badge.textContent = 'YOURS';
        badge.className = 'app-badge is-owned';
        btn.hidden = true;
        line.textContent = copy === 'ready'
            ? 'Ready: PlaneTilt starts on this device with no connection.' + (isIOS() && !app ? ' On iPhone, keep it on your home screen so Safari does not clear it.' : '')
            : copy === 'failed'
                ? 'The download stopped. It will try again next time you open PlaneTilt online.'
                : online() ? 'Getting this device ready to play with no connection…' : 'Connect once to get this device ready.';
        return;
    }
    badge.textContent = money(o.priceCents);
    badge.className = 'app-badge';
    btn.hidden = false;
    if (!isAccount()) {
        line.textContent = `Keep the whole game on your devices and start it anywhere: on a plane, underground, out of signal. Make a free account, then unlock it once for ${money(o.priceCents)}.`;
        btn.textContent = 'CREATE FREE ACCOUNT';
        return;
    }
    line.textContent = `Keep the whole game on your devices and start it anywhere: on a plane, underground, out of signal. One payment of ${money(o.priceCents)}, kept on your account on every device. Paid securely through Square.`;
    btn.textContent = 'UNLOCK ' + money(o.priceCents);
}

const CHECKOUT_ERRORS = {
    'account-needed': 'Make a free account first.',
    owned: 'Offline play is already yours.',
    'not-for-sale': 'Offline play is not on sale right now.',
    'not-here': 'Offline play is sold on planetilt.com.',
    offline: 'Could not reach the server. Try again in a moment.'
};

async function onOfflineBtn() {
    const msg = $('appOfflineMsg');
    msg.textContent = '';
    if (!isAccount()) { openAccount(); return; }
    const btn = $('appOfflineBtn');
    btn.disabled = true;
    msg.textContent = 'Opening checkout…';
    sync.track({ type: 'act', name: 'offline:checkout' });
    const r = await sync.offlineCheckout();
    if (!r.ok || !r.url) {
        btn.disabled = false;
        msg.textContent = CHECKOUT_ERRORS[r.error] || 'Could not open checkout. Try again in a moment.';
        if (r.error === 'owned') sync.offlineCheck().then(render);
        return;
    }
    lsSet(PENDING_KEY, String(Date.now()));
    location.href = r.url;
}

// ---------------------------------------------------------------------------
// Back from checkout
// ---------------------------------------------------------------------------
function panel(text, show = true) {
    const p = $('offlinePanel');
    if (!p) return;
    $('offlinePanelMsg').textContent = text;
    if (show) p.hidden = false;
}

let checking = false;
// Asks the server (which asks Square). With `tell`, the player watches.
async function checkPending(tell) {
    const at = Number(lsGet(PENDING_KEY));
    if (!at || checking) return;
    if (Date.now() - at > PENDING_MS) { lsSet(PENDING_KEY, null); return; }
    checking = true;
    try {
        for (const wait of tell ? [0, 3e3, 8e3, 15e3] : [0]) {
            if (wait) await new Promise(r => setTimeout(r, wait));
            // Already owned (Square's webhook got here first) needs no lookup.
            const r = offline().owned ? { ok: true, owned: true } : await sync.offlineCheck();
            if (r.ok && r.owned) {
                lsSet(PENDING_KEY, null);
                sync.track({ type: 'act', name: 'offline:unlocked' });
                if (tell) panel('Offline play is yours! This device is getting the whole game now; it is on your account for every device you sign in on.', true);
                tellWorker(true);
                render();
                return;
            }
        }
        if (tell) panel('We have not seen the payment yet. If you paid, it unlocks by itself in a minute or two: watch PLAY ANYWHERE in Gear.', true);
    } finally { checking = false; }
}

// ---------------------------------------------------------------------------
// The install sheet
// ---------------------------------------------------------------------------
export function openInstall() {
    const p = $('installPanel');
    if (!p) return;
    const mode = installMode();
    p.dataset.mode = mode;
    $('installSteps').innerHTML = stepsFor(mode).map((s, i) =>
        `<li class="ig-step"><span class="ig-num">${i + 1}</span><span class="ig-icon">${ICONS[s.icon]}</span><span class="ig-text">${s.html}</span></li>`).join('');
    const note = $('installNote');
    const iosLike = mode === 'ios-safari' || mode === 'ios-other';
    note.hidden = !iosLike;
    if (iosLike) {
        note.textContent = isAccount()
            ? 'The app starts signed out on iPhone and iPad: sign in once there and everything is waiting for you.'
            : 'On iPhone and iPad the app keeps its own save. To take your progress there, make a free account first, then sign in inside the app.';
    }
    $('installGoBtn').hidden = mode !== 'prompt';
    p.hidden = false;
    sync && sync.track && sync.track({ type: 'act', name: 'install:open:' + mode });
}
const closeInstall = () => { $('installPanel').hidden = true; };

async function runPrompt() {
    if (!deferred) { openInstall(); return; }
    const ev = deferred;
    deferred = null;   // one prompt per event
    try {
        await ev.prompt();
        const choice = await ev.userChoice;
        sync && sync.track && sync.track({ type: 'act', name: 'install:' + (choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed') });
    } catch (_) { /* could not show: the sheet still can */ }
    closeInstall();
    render();
}

// ---------------------------------------------------------------------------
export function initOfflinePlay(opts = {}) {
    if (!features.offlineInstall) return;
    sync = opts.sync || null;
    if (typeof opts.openAccount === 'function') openAccount = opts.openAccount;

    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; render(); });
    window.addEventListener('appinstalled', () => { deferred = null; installed = true; render(); });

    $('appInstallBtn').addEventListener('click', (e) => { e.preventDefault(); if (installMode() === 'prompt') runPrompt(); else openInstall(); });
    $('appOfflineBtn').addEventListener('click', (e) => { e.preventDefault(); onOfflineBtn(); });
    $('installCloseBtn').addEventListener('click', (e) => { e.preventDefault(); closeInstall(); });
    $('installPanel').addEventListener('click', (e) => { if (e.target.id === 'installPanel') closeInstall(); });
    $('installGoBtn').addEventListener('click', (e) => { e.preventDefault(); runPrompt(); });
    const closeOff = () => { $('offlinePanel').hidden = true; };
    $('offlineCloseBtn').addEventListener('click', (e) => { e.preventDefault(); closeOff(); });
    $('offlineOkBtn').addEventListener('click', (e) => { e.preventDefault(); closeOff(); });
    for (const b of document.querySelectorAll('[data-install]')) {
        if (!isHomeScreenApp()) b.hidden = false;
        if (b.tagName === 'BUTTON') b.addEventListener('click', (e) => { e.preventDefault(); openInstall(); });
    }
    const welcome = $('lpAppWelcome');
    if (welcome) welcome.hidden = !(isHomeScreenApp() && isIOS());

    // Back from Square: drop the marker from the address, then check.
    let back = false;
    try {
        const u = new URL(location.href);
        if (u.searchParams.get('offline_unlock') === 'done') {
            back = true;
            if (!lsGet(PENDING_KEY)) lsSet(PENDING_KEY, String(Date.now()));
            u.searchParams.delete('offline_unlock');
            history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
        }
    } catch (_) { /* ignore */ }
    if (back) panel('Checking your payment…', true);

    if (sync) {
        let first = true;
        sync.onStatus((st) => {
            render();
            tellWorker();
            if (st === 'synced' && first) { first = false; checkPending(back); }
        });
    }
    // A checkout left open (Safari's sheet over the iPhone app, another tab):
    // look again whenever the game comes back to the front.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkPending(false).then(render); });
    window.addEventListener('online', render);
    window.addEventListener('offline', render);

    startWorker();
    render();
    window.__offlinePlay = { mode: installMode, steps: stepsFor, copy: () => copy, fakePrompt(ev) { deferred = ev; render(); }, render };
}
