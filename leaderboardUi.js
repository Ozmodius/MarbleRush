import { features } from './platform.js';

// THE ACCOUNT CARD (Gear: make an account, sign in or out -- saving to the
// server just happens, so the card shows nothing about it),
// THE ACCOUNT PANEL (sign in, create, confirm the email, reset, delete), and
// THE LEADERBOARDS (the CLEARED panel's
// trophy button and its modal). Everything here talks to cloudSync.js; with
// no server configured the card stays hidden, the trophy never shows, and
// none of this does anything.
//
// Own accounts (username or email + password, server/accounts.js) are
// offered where the platform allows them (features.externalLogin: the web);
// on CrazyGames the platform's own sign-in is the way, as in 3dBallSmack.
//
// initCloudUi({ sync, login, reload }) -> onClear({ board, ms, levelName, walk, daily } | null)
//   login: { available(), show() } -- the platform's own sign-in (CrazyGames),
//   offered to a guest so their progress follows their account.

const $ = id => document.getElementById(id);
const fmtMs = ms => (ms / 1000).toFixed(2) + 's';

let sync = null, login = null, current = null;
let cover = () => {};   // sceneHost's setCovered, from main.js

function renderStatus() {
    const me = sync.player(), a = sync.account();
    const signedIn = !!(a && me && me.kind === 'account');
    const crazySignedIn = !!(me && me.kind === 'crazygames');
    const platformOffer = !!(login && login.available() && !crazySignedIn);
    $('acctGuest').hidden = signedIn || crazySignedIn;
    $('acctGuestHelp').textContent = features.requireLogin
        ? 'You are playing as a guest, so your progress is kept on this device only. Make a free account to keep it safe and pick it up on any device.'
        : 'Make an account to keep your progress safe and pick it up on any device.';
    $('acctOwnButtons').hidden = !features.externalLogin;
    // Nothing to offer (signed in with CrazyGames, or no way to sign in
    // here): no card at all.
    $('cloudSection').hidden = !(signedIn || features.externalLogin || platformOffer);
    $('acctSigned').hidden = !signedIn;
    if (signedIn) {
        const who = $('acctWho');
        who.textContent = `Signed in as ${a.username}`;
        const small = document.createElement('small');
        small.textContent = a.email + (a.verified ? '' : ' (not confirmed)');
        who.appendChild(small);
    }
    $('cloudLoginBtn').hidden = !platformOffer;
    // Signed out, or the session lost: back to the sign-in screen.
    if (needsAccount()) openGate();
}

// --- the account panel ---------------------------------------------------------
const ERRORS = {
    'username-short': 'Usernames need at least 3 characters.',
    'username-long': 'Usernames can be at most 16 characters.',
    'username-chars': 'Use letters, numbers, _ . or - in a username.',
    'username-reserved': 'That name is kept for guests. Pick another.',
    'username-rude': 'Please pick a different username.',
    'username-taken': 'That username is taken.',
    'email-bad': 'That email does not look right.',
    'email-taken': 'That email already has an account. Sign in instead?',
    'email-failed': 'We could not send the email. Check the address and try again.',
    'email-off': 'Password reset by email is not available yet.',
    'password-short': 'Passwords need at least 8 characters.',
    'password-long': 'That password is too long.',
    'login-wrong': 'Wrong username, email or password.',
    'too-many-tries': 'Too many tries. Wait 15 minutes and try again.',
    'code-wrong': 'That code is not right. Check the email and try again.',
    'code-expired': 'That code has run out. Ask for a new one.',
    'code-tries': 'Too many wrong codes. Ask for a new one.',
    offline: 'Could not reach the server. Try again in a moment.'
};
const errorText = e => ERRORS[e] || 'Something went wrong. Try again.';
let pendingEmail = '', resetLogin = '';

function acctView(view, message, ok) {
    for (const f of document.querySelectorAll('#accountPanel .acct-form')) f.hidden = f.id !== 'acctView_' + view;
    const form = $('acctView_' + view);
    $('acctTitle').textContent = form.dataset.title;
    const msg = $('acctMsg');
    msg.textContent = message || '';
    msg.classList.toggle('is-ok', !!ok);
    $('accountPanel').hidden = false;
    const first = form.querySelector('input');
    if (first && !first.value) setTimeout(() => { try { first.focus(); } catch (_) { /* ignore */ } }, 50);
}
// THE SIGN-IN GATE (features.requireLogin, the web). Its front door is the
// landing site (index.html's LANDING): what the game is, with CREATE ACCOUNT
// after every highlight and SIGN IN / CREATE ACCOUNT on its top bar, each
// opening this panel OVER the site -- closable, back to the site. Without the
// site (a build that strips it) the panel itself is the gate, unclosable but
// for its own PLAY AS GUEST.
//
// PLAY AS GUEST (features.guestPlay, the user's call, 2026-10-08) is the other
// way past: the device plays as the guest it already is (its own save, synced
// as a guest), and the choice is remembered on the device (localStorage, a
// device preference like the sound button, never the save), so the site does
// not come back on every visit. Gear's ACCOUNT card still offers CREATE
// ACCOUNT, and the guest's progress becomes the account's. Signing out or
// deleting an account forgets the choice: the device is a new guest and
// starts at the front door again.
const GUEST_KEY = 'planetilt.guestPlay';
const guestChosen = () => {
    if (!features.guestPlay) return false;
    try { return localStorage.getItem(GUEST_KEY) === '1'; } catch (_) { return false; }
};
const setGuestChosen = (on) => {
    try { if (on) localStorage.setItem(GUEST_KEY, '1'); else localStorage.removeItem(GUEST_KEY); } catch (_) { /* storage blocked: the gate asks again next visit */ }
};
let guestThisVisit = false;   // chose guest though storage refused to keep it
let gate = false;
const landing = () => $('landing');
const needsAccount = () => {
    const me = sync && sync.player();
    if (features.guestPlay && (guestThisVisit || guestChosen())) return false;
    return !!(features.requireLogin && sync && sync.enabled && !(me && me.kind === 'account'));
};
function playAsGuest() {
    if (!features.guestPlay) return;
    guestThisVisit = true;
    setGuestChosen(true);
    sync.track({ type: 'act', name: 'landing:guest' });
    $('accountPanel').hidden = true;
    $('acctMsg').textContent = '';
    closeGate();
    renderStatus();
}
function openGate() {
    if (gate) return;
    gate = true;
    if (landing()) {
        landing().hidden = false;
        landing().scrollTop = 0;
        cover(true);
        $('accountPanel').classList.add('over-landing');
        $('accountPanel').hidden = true;
        sync.track({ type: 'act', name: 'landing:shown' });
        return;
    }
    $('accountPanel').classList.add('is-gate');
    $('acctGateNote').hidden = false;
    acctView('register');
}
function closeGate() {
    gate = false;
    if (landing()) landing().hidden = true;
    cover(false);
    $('accountPanel').classList.remove('is-gate', 'over-landing');
    $('acctGateNote').hidden = true;
}
// Over the landing site the panel closes back to the site; as the bare gate
// it does not close at all.
const closeAcct = () => {
    if (gate && !landing()) return;
    $('accountPanel').hidden = true;
    $('acctMsg').textContent = '';
};
const val = id => $(id).value.trim();

// While a call is out, its form's buttons wait.
async function busy(form, fn) {
    const btns = [...form.querySelectorAll('button')];
    btns.forEach(b => { b.disabled = true; });
    try { return await fn(); } finally { btns.forEach(b => { b.disabled = false; }); updateDeleteBtn(); }
}

function signedInDone(r, words) {
    closeGate();
    renderStatus();
    closeAcct();
    $('cloudMsg').textContent = words || (r && r.player ? `Signed in as ${r.player.name}.` : '');
}

function updateDeleteBtn() { $('deleteGoBtn').disabled = $('deleteConfirm').value.trim().toUpperCase() !== 'DELETE'; }

function wireLanding() {
    $('acctGateGuestBtn').hidden = !features.guestPlay;
    $('acctGateGuestBtn').addEventListener('click', (e) => { e.preventDefault(); playAsGuest(); });
    const site = landing();
    if (!site) return;
    for (const b of site.querySelectorAll('[data-lp="guest"]')) b.hidden = !features.guestPlay;
    // Every CREATE ACCOUNT and SIGN IN on the site, the top bar's included.
    site.addEventListener('click', (e) => {
        const b = e.target.closest('[data-lp]');
        if (!b) return;
        e.preventDefault();
        if (b.dataset.lp === 'guest') { playAsGuest(); return; }
        sync.track({ type: 'act', name: 'landing:' + b.dataset.lp });
        acctView(b.dataset.lp);
    });
    // The section links scroll the site, not the page behind it.
    for (const a of site.querySelectorAll('a[href^="#lp-"]')) a.addEventListener('click', (e) => {
        const t = document.getElementById(a.getAttribute('href').slice(1));
        if (!t) return;
        e.preventDefault();
        site.scrollTo({ top: a.getAttribute('href') === '#lp-top' ? 0 : t.offsetTop - 64, behavior: 'smooth' });
    });
}

function wireAccountPanel(reload) {
    wireLanding();
    const on = (id, fn) => $(id).addEventListener('submit', (e) => { e.preventDefault(); fn(e.currentTarget); });
    for (const b of document.querySelectorAll('#accountPanel [data-go]')) b.addEventListener('click', (e) => { e.preventDefault(); acctView(b.dataset.go); });
    $('acctCloseBtn').addEventListener('click', (e) => { e.preventDefault(); closeAcct(); });
    $('accountPanel').addEventListener('click', (e) => { if (e.target.id === 'accountPanel') closeAcct(); });
    $('acctCreateBtn').addEventListener('click', (e) => { e.preventDefault(); acctView('register'); });
    $('acctSignInBtn').addEventListener('click', (e) => { e.preventDefault(); acctView('signin'); });

    on('acctView_signin', form => busy(form, async () => {
        const r = await sync.login({ login: val('acctLogin'), password: $('acctPassword').value });
        if (!r.ok) { $('acctMsg').textContent = errorText(r.error); return; }
        $('acctPassword').value = '';
        sync.track({ type: 'act', name: 'account:signin' });
        signedInDone(r, `Signed in as ${r.player.name}. Your progress from this device was added.`);
    }));
    on('acctView_register', form => busy(form, async () => {
        const r = await sync.register({ username: val('regUsername'), email: val('regEmail'), password: $('regPassword').value });
        if (!r.ok) { $('acctMsg').textContent = errorText(r.error); return; }
        if (r.verify) {
            pendingEmail = r.email;
            $('acctVerifyNote').textContent = `We sent a 6-digit code to ${r.email}. Enter it here to finish. (Check spam if it's not there.)`;
            $('acctCode').value = '';
            acctView('verify');
            return;
        }
        $('regPassword').value = '';
        sync.track({ type: 'act', name: 'account:create' });
        signedInDone(r, `Welcome, ${r.player.name}! Your progress is saved to your account.`);
    }));
    on('acctView_verify', form => busy(form, async () => {
        const r = await sync.verifyEmail({ email: pendingEmail, code: val('acctCode') });
        if (!r.ok) { $('acctMsg').textContent = errorText(r.error); return; }
        sync.track({ type: 'act', name: 'account:create' });
        $('regPassword').value = '';
        signedInDone(r, `Welcome, ${r.player.name}! Your progress is saved to your account.`);
    }));
    on('acctView_forgot', form => busy(form, async () => {
        resetLogin = val('forgotLogin');
        const r = await sync.forgot({ login: resetLogin });
        if (!r.ok) { $('acctMsg').textContent = errorText(r.error); return; }
        $('resetCode').value = ''; $('resetPassword').value = '';
        acctView('reset');
    }));
    on('acctView_reset', form => busy(form, async () => {
        const r = await sync.resetPassword({ login: resetLogin, code: val('resetCode'), password: $('resetPassword').value });
        if (!r.ok) { $('acctMsg').textContent = errorText(r.error); return; }
        signedInDone(r, `Password changed. Signed in as ${r.player.name}.`);
    }));
    $('deleteConfirm').addEventListener('input', updateDeleteBtn);
    on('acctView_delete', form => busy(form, async () => {
        if ($('deleteConfirm').value.trim().toUpperCase() !== 'DELETE') return;
        const r = await sync.deleteAccount($('deletePassword').value);
        if (!r.ok) { $('acctMsg').textContent = errorText(r.error); return; }
        setGuestChosen(false);
        reload();
    }));
    $('acctDeleteLink').addEventListener('click', (e) => {
        e.preventDefault();
        $('deletePassword').value = ''; $('deleteConfirm').value = ''; updateDeleteBtn();
        acctView('delete');
    });
    $('acctSignOutBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        const btn = $('acctSignOutBtn');
        btn.disabled = true;
        sync.track({ type: 'act', name: 'account:signout' });
        await sync.flushEvents();
        const r = await sync.logout();
        btn.disabled = false;
        if (!r.ok) { $('cloudMsg').textContent = r.error === 'offline' ? 'Could not reach the server, so you are still signed in (nothing is lost).' : errorText(r.error); return; }
        setGuestChosen(false);
        reload();
    });
}

// --- the leaderboard modal ------------------------------------------------------
async function openBoard(info) {
    sync.track && sync.track({ type: 'act', name: 'open:leaderboard' });
    const panel = $('boardPanel'), list = $('boardList');
    $('boardTitle').textContent = info.daily ? 'DAILY MAZE' : 'LEADERBOARD';
    $('boardNote').textContent = (info.levelName || '') + (info.walk ? ' — EXPLORED' : '');
    list.textContent = '';
    $('boardYou').textContent = 'Loading…';
    panel.hidden = false;
    const r = await sync.leaderboard(info.board, 10);
    if (panel.hidden || current !== info) return;
    if (!r) { $('boardYou').textContent = 'Could not reach the server.'; return; }
    if (!r.top.length) {
        const li = document.createElement('li');
        li.className = 'board-empty';
        li.textContent = 'No times yet.';
        list.appendChild(li);
    }
    for (const row of r.top) {
        const li = document.createElement('li');
        if (row.you) li.className = 'is-you';
        const rank = document.createElement('span'); rank.className = 'board-rank'; rank.textContent = '#' + row.rank;
        const name = document.createElement('span'); name.className = 'board-name'; name.textContent = row.you ? `${row.name} (you)` : row.name;
        const ms = document.createElement('span'); ms.className = 'board-ms'; ms.textContent = fmtMs(row.ms);
        li.append(rank, name, ms);
        list.appendChild(li);
    }
    const you = r.you;
    $('boardYou').textContent = you ? `Your best ${fmtMs(you.ms)} — #${you.rank} of ${you.total}` : `${r.total} player${r.total === 1 ? '' : 's'}`;
}
const closeBoard = () => { $('boardPanel').hidden = true; };

// A counted clear: post it, and put the rank on the CLEARED panel.
function onClear(info) {
    const btn = $('mazeRankBtn');
    current = info;
    if (!sync || !sync.enabled || !btn) return;
    if (!info) { btn.hidden = true; return; }
    $('mazeRankText').textContent = 'LEADERBOARD';
    btn.hidden = false;
    sync.submitScore(info.board, info.ms).then((r) => {
        if (!r || current !== info) return;
        $('mazeRankText').textContent = `#${r.rank} OF ${r.total}`;
    });
}

export function initCloudUi(opts) {
    sync = opts.sync; login = opts.login || null;
    if (typeof opts.cover === 'function') cover = opts.cover;
    if (!sync || !sync.enabled) return onClear;
    $('cloudSection').hidden = false;
    wireAccountPanel(opts.reload || (() => { try { location.reload(); } catch (_) { /* ignore */ } }));
    sync.onStatus(renderStatus);
    renderStatus();
    $('cloudLoginBtn').addEventListener('click', async (e) => { e.preventDefault(); if (login && await login.show()) sync.reconnect(); });
    $('mazeRankBtn').addEventListener('click', (e) => { e.preventDefault(); if (current) openBoard(current); });
    $('boardCloseBtn').addEventListener('click', (e) => { e.preventDefault(); closeBoard(); });
    $('boardPanel').addEventListener('click', (e) => { if (e.target.id === 'boardPanel') closeBoard(); });
    return onClear;
}
