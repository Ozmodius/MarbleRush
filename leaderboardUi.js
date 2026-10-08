import { features } from './platform.js';

// THE ACCOUNT CARD (Gear: the player's account, cloud save, device codes),
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
const STATUS = { idle: 'CONNECTING…', syncing: 'SYNCING…', synced: 'SAVED TO THE CLOUD', offline: 'OFFLINE — SAVED ON THIS DEVICE' };

let sync = null, login = null, current = null;

function renderStatus() {
    const s = sync.status(), me = sync.player(), a = sync.account();
    $('cloudStatus').textContent = STATUS[s] || s.toUpperCase();
    $('cloudDot').className = 'cloud-dot is-' + s;
    const signedIn = !!(a && me && me.kind === 'account');
    $('cloudName').textContent = me && !signedIn ? `Playing as ${me.name}` : '';
    $('acctGuest').hidden = signedIn || (me && me.kind === 'crazygames');
    $('acctOwnButtons').hidden = !features.externalLogin;
    $('acctSigned').hidden = !signedIn;
    if (signedIn) {
        const who = $('acctWho');
        who.textContent = `Signed in as ${a.username}`;
        const small = document.createElement('small');
        small.textContent = a.email + (a.verified ? '' : ' (not confirmed)');
        who.appendChild(small);
    }
    $('cloudLoginBtn').hidden = !(login && login.available() && (!me || me.kind !== 'crazygames'));
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
const closeAcct = () => { $('accountPanel').hidden = true; $('acctMsg').textContent = ''; };
const val = id => $(id).value.trim();

// While a call is out, its form's buttons wait.
async function busy(form, fn) {
    const btns = [...form.querySelectorAll('button')];
    btns.forEach(b => { b.disabled = true; });
    try { return await fn(); } finally { btns.forEach(b => { b.disabled = false; }); updateDeleteBtn(); }
}

function signedInDone(r, words) {
    renderStatus();
    closeAcct();
    $('cloudMsg').textContent = words || (r && r.player ? `Signed in as ${r.player.name}.` : '');
}

function updateDeleteBtn() { $('deleteGoBtn').disabled = $('deleteConfirm').value.trim().toUpperCase() !== 'DELETE'; }

function wireAccountPanel(reload) {
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
        signedInDone(r, `Welcome, ${r.player.name}! Your progress is saved to your account.`);
    }));
    on('acctView_verify', form => busy(form, async () => {
        const r = await sync.verifyEmail({ email: pendingEmail, code: val('acctCode') });
        if (!r.ok) { $('acctMsg').textContent = errorText(r.error); return; }
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
        const r = await sync.logout();
        btn.disabled = false;
        if (!r.ok) { $('cloudMsg').textContent = r.error === 'offline' ? 'Could not reach the server, so you are still signed in (nothing is lost).' : errorText(r.error); return; }
        reload();
    });
}

async function makeCode() {
    const btn = $('cloudLinkBtn'), out = $('cloudCode');
    btn.disabled = true;
    const r = await sync.createLink();
    btn.disabled = false;
    if (!r) { $('cloudMsg').textContent = 'Could not reach the server. Try again in a moment.'; return; }
    out.textContent = r.code;
    const note = document.createElement('small');
    note.textContent = 'enter it on your other device within 10 minutes';
    out.appendChild(note);
    out.hidden = false;
    $('cloudMsg').textContent = '';
}

async function claim(e) {
    e.preventDefault();
    const input = $('cloudCodeInput'), code = input.value.trim().toUpperCase();
    if (code.length !== 6) { $('cloudMsg').textContent = 'A code is six letters and numbers.'; return; }
    $('cloudMsg').textContent = 'Joining…';
    const r = await sync.claimLink(code);
    $('cloudMsg').textContent = r.ok ? 'Joined! Your progress from both devices is combined.'
        : r.error === 'bad-code' ? 'That code is wrong or has run out. Make a new one.'
        : 'Could not reach the server. Try again in a moment.';
    if (r.ok) input.value = '';
    renderStatus();
}

// --- the leaderboard modal ------------------------------------------------------
async function openBoard(info) {
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
    if (!sync || !sync.enabled) return onClear;
    $('cloudSection').hidden = false;
    wireAccountPanel(opts.reload || (() => { try { location.reload(); } catch (_) { /* ignore */ } }));
    sync.onStatus(renderStatus);
    renderStatus();
    $('cloudLinkBtn').addEventListener('click', (e) => { e.preventDefault(); makeCode(); });
    $('cloudClaimForm').addEventListener('submit', claim);
    $('cloudLoginBtn').addEventListener('click', async (e) => { e.preventDefault(); if (login && await login.show()) sync.reconnect(); });
    $('mazeRankBtn').addEventListener('click', (e) => { e.preventDefault(); if (current) openBoard(current); });
    $('boardCloseBtn').addEventListener('click', (e) => { e.preventDefault(); closeBoard(); });
    $('boardPanel').addEventListener('click', (e) => { if (e.target.id === 'boardPanel') closeBoard(); });
    return onClear;
}
