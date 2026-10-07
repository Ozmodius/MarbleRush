// THE CLOUD SAVE CARD (Gear) and THE LEADERBOARDS (the CLEARED panel's
// trophy button and its modal). Everything here talks to cloudSync.js; with
// no server configured the card stays hidden, the trophy never shows, and
// none of this does anything.
//
// initCloudUi({ sync, login }) -> onClear({ board, ms, levelName, walk, daily } | null)
//   login: { available(), show() } -- the platform's own sign-in (CrazyGames),
//   offered to a guest so their progress follows their account.

const $ = id => document.getElementById(id);
const fmtMs = ms => (ms / 1000).toFixed(2) + 's';
const STATUS = { idle: 'CONNECTING…', syncing: 'SYNCING…', synced: 'SAVED TO THE CLOUD', offline: 'OFFLINE — SAVED ON THIS DEVICE' };

let sync = null, login = null, current = null;

function renderStatus() {
    const s = sync.status(), me = sync.player();
    $('cloudStatus').textContent = STATUS[s] || s.toUpperCase();
    $('cloudDot').className = 'cloud-dot is-' + s;
    $('cloudName').textContent = me ? `Playing as ${me.name}` : '';
    $('cloudLoginBtn').hidden = !(login && login.available() && (!me || me.kind !== 'crazygames'));
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
