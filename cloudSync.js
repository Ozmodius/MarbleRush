// CLOUD SAVE AND LEADERBOARDS: the client half of server/ (the PlaneTilt API).
//
// LOCAL FIRST. The game never waits on the network: the save on the device
// (platform.js) is the one the game plays from, and this module keeps a copy
// of it on the server in the background. Both sides MERGE (progressStore.js
// mergeProgress) -- the server merges what we push into what it has, and we
// adopt what comes back -- so neither ever overwrites the other, and a phone
// and a laptop playing the same player both keep every clear.
//
// No API configured (window.__PLANETILT_API__, put there by the build from
// PLANETILT_API_URL) means status 'off' and every call a quiet no-op: the
// game is exactly what it was without a server.
//
// createCloudSync({ store, api, ... }) -> {
//   start(), status(), onStatus(fn), player(),
//   submitScore(board, ms) -> { best, rank, total } | null,
//   leaderboard(board, limit) -> { top, you, total } | null,
//   createLink() -> { code, expiresAt } | null,
//   claimLink(code) -> { ok, error? },
//   reconnect()  (the platform account changed)
// }
// Boards: roll:<levelId>, walk:<levelId>, daily:<YYYY-MM-DD>:<dailyId>.

export const CLOUD_KEY = 'planetilt.cloud.v1';
const RETRY_MS = 30e3;
const TIMEOUT_MS = 10e3;
// How long signing in (or making an account) waits for the save to go up
// before it reports done; the push finishes in the background after that.
// A slow upload used to hold the sign-in form open for up to TIMEOUT_MS
// after the server had already said yes.
const SIGNIN_PUSH_WAIT_MS = 2500;

function memoryStorage() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

// Every best time a save already holds, as leaderboard entries.
export function scoresInSave(p) {
    const out = [];
    for (const [id, c] of Object.entries((p && p.cleared) || {})) if (c && Number.isFinite(c.bestMs)) out.push({ board: `roll:${id}`, ms: Math.round(c.bestMs) });
    for (const [id, w] of Object.entries((p && p.walks) || {})) if (w && Number.isFinite(w.bestMs)) out.push({ board: `walk:${id}`, ms: Math.round(w.bestMs) });
    const d = p && p.dailyMaze;
    if (d && d.id && d.date && Number.isFinite(d.best)) out.push({ board: `daily:${d.date}:${d.id}`, ms: Math.round(d.best) });
    return out;
}

export function createCloudSync({
    store, api, fetchImpl = globalThis.fetch && globalThis.fetch.bind(globalThis), storage = null,
    getCrazyToken = async () => null, onRemoteChange = null, debounceMs = 1500,
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id)
}) {
    const base = api ? String(api).replace(/\/+$/, '') : null;
    let ls = storage;
    if (!ls) { try { ls = globalThis.localStorage || memoryStorage(); } catch (_) { ls = memoryStorage(); } }
    const read = () => { try { return JSON.parse(ls.getItem(CLOUD_KEY) || 'null') || {}; } catch (_) { return {}; } };
    const write = (v) => { try { ls.setItem(CLOUD_KEY, JSON.stringify(v)); } catch (_) { /* in memory only */ } };

    let saved = read();
    let token = saved.token || null, me = saved.player || null;
    let status = base ? 'idle' : 'off';
    let acct = null, mailOn = false;       // the account, if signed in to one
    const listeners = new Set();
    let adopting = false, pushTimer = null, retryTimer = null, connecting = null;
    const pending = [];          // scores that could not be sent yet

    const setStatus = (s) => {
        if (s === status) return;
        status = s;
        for (const fn of listeners) { try { fn(s, me); } catch (_) { /* ignore */ } }
    };
    const remember = (t, p) => { token = t; me = p; saved = { ...saved, token: t, player: p }; write(saved); };

    async function req(method, path, body) {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await fetchImpl(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { const e = new Error(data.error || `http ${res.status}`); e.status = res.status; throw e; }
            return data;
        } finally { if (timer) clearTimeout(timer); }
    }

    // Take in a save from the server without that counting as a new local
    // change to push back.
    // `joined`: this device just became a player it was not before (a link
    // code, a platform sign-in). The server's coins and charges then win over
    // the device's, whatever the clocks say -- everything earned on either
    // side is still kept. (The server merged the device's old player in the
    // same way.)
    const adopt = (remote, joined = false) => {
        if (!remote) return;
        if (joined) remote = { ...remote, savedAt: Math.max(Date.now(), store.get().savedAt || 0) + 1 };
        adopting = true;
        let changed = false;
        try { changed = store.adopt(remote); } finally { adopting = false; }
        // Another device's progress arrived: the menus redraw.
        if (changed && onRemoteChange) { try { onRemoteChange(); } catch (_) { /* ignore */ } }
    };

    async function session() {
        let crazyToken = null;
        try { crazyToken = await getCrazyToken(); } catch (_) { crazyToken = null; }
        let r;
        try { r = await req('POST', '/v1/session', { token, crazyToken }); }
        catch (e) {
            // A CrazyGames token the server cannot check: carry on as the guest.
            if (!crazyToken || e.status !== 401 && e.status !== 501) throw e;
            r = await req('POST', '/v1/session', { token });
        }
        const joined = !me || me.id !== r.player.id;
        remember(r.token, r.player);
        return joined;
    }

    async function pushNow() {
        const r = await req('PUT', '/v1/save', { save: store.get() });
        adopt(r.save);
    }

    // Best times from before this player had a server (or from another
    // device's guest): sent once per player.
    async function backfill() {
        const key = `scores:${me && me.id}`;
        if (!me || saved[key]) return;
        const scores = scoresInSave(store.get());
        if (scores.length) await req('POST', '/v1/scores/batch', { scores });
        saved = { ...saved, [key]: 1 }; write(saved);
    }

    async function flushScores() {
        while (pending.length) {
            const s = pending[0];
            try { await req('POST', '/v1/scores', s); }
            catch (e) { if (!e.status || e.status >= 500 || e.status === 401 || e.status === 429) throw e; }
            pending.shift();
        }
    }

    const scheduleRetry = () => {
        if (retryTimer || !base) return;
        retryTimer = setTimer(() => { retryTimer = null; connect(); }, RETRY_MS);
    };

    // Session, pull, push, catch-up. One at a time; a call while one runs
    // waits for it.
    function connect() {
        if (!base) return Promise.resolve(false);
        if (connecting) return connecting;
        connecting = (async () => {
            setStatus('syncing');
            try {
                const joined = await session();
                try { const a = await req('GET', '/v1/account'); acct = a.account; mailOn = !!a.email; } catch (_) { /* an older server */ }
                const r = await req('GET', '/v1/save');
                adopt(r.save, joined);
                await pushNow();
                await backfill();
                await flushScores();
                setStatus('synced');
                return true;
            } catch (e) {
                if (e.status === 401) remember(null, null);
                setStatus('offline');
                scheduleRetry();
                return false;
            } finally { connecting = null; }
        })();
        return connecting;
    }

    async function push() {
        pushTimer = null;
        // A save made while connecting may have missed that push: push again.
        if (connecting) await connecting;
        if (!token || status === 'offline') return connect();
        setStatus('syncing');
        try { await pushNow(); setStatus(pushTimer ? 'syncing' : 'synced'); }
        catch (e) {
            if (e.status === 401) { remember(null, null); return connect(); }
            setStatus('offline'); scheduleRetry();
        }
    }
    function schedulePush() {
        if (pushTimer) clearTimer(pushTimer);
        pushTimer = setTimer(push, debounceMs);
    }

    if (base) store.onSave(() => { if (!adopting) schedulePush(); });

    // An account call that may sign this device in: a session in the answer
    // becomes ours, and its save is adopted (as JOINED if it is a player
    // this device was not -- the account's coins win, see adopt).
    async function accountCall(path, body) {
        if (!base) return { ok: false, error: 'off' };
        if (!token && !(await connect())) return { ok: false, error: 'offline' };
        let r;
        try { r = await req('POST', path, body); }
        catch (e) { return { ok: false, error: e.status ? (e.message || 'server') : 'offline' }; }
        if (r.token && r.player) {
            const joined = !me || me.id !== r.player.id;
            remember(r.token, r.player);
            acct = r.account || null;
            adopt(r.save, joined);
            const pushed = pushNow().catch(() => { /* it goes up with the next save */ }).then(() => {
                status = 'synced';
                for (const fn of listeners) { try { fn(status, me); } catch (_) { /* ignore */ } }
            });
            let waited = null;
            await Promise.race([pushed, new Promise((res) => { waited = setTimer(res, SIGNIN_PUSH_WAIT_MS); })]);
            if (waited) clearTimer(waited);
        }
        return { ok: true, ...r };
    }
    // Signed out or deleted: no token, no account, a fresh local save.
    function forgetDevice() {
        remember(null, null);
        acct = null;
        saved = {}; write(saved);
        adopting = true;
        try { store.wipe(); } finally { adopting = false; }
    }

    // Play tracking: events queue here and go up in batches -- every 30s,
    // at 20 waiting, and when the page is hidden (sent with keepalive so a
    // closing tab still delivers). Kept in memory only, at most 200; a
    // failed send keeps them for the next try.
    const events = [];
    let eventTimer = null;
    async function flushEvents(keepalive = false) {
        if (eventTimer) { clearTimer(eventTimer); eventTimer = null; }
        if (!base || !token || !events.length) return;
        const batch = events.splice(0, 100);
        try {
            if (keepalive) {
                await fetchImpl(base + '/v1/events', { method: 'POST', keepalive: true,
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ events: batch }) });
            } else await req('POST', '/v1/events', { events: batch });
        } catch (_) { events.unshift(...batch.slice(0, 200 - events.length)); }
        if (events.length && !eventTimer) eventTimer = setTimer(() => { eventTimer = null; flushEvents(); }, 30e3);
    }
    // Sessions: each stretch with the game on screen is one, reported with
    // its length when the page is hidden (2 seconds or more; at most 3 hours).
    let shownAt = Date.now();
    const endSession = () => {
        const ms = Date.now() - shownAt;
        if (ms >= 2000) events.push({ type: 'session', ms: Math.min(ms, 3 * 3600e3) });
    };
    if (base && typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') { endSession(); flushEvents(true); }
            else shownAt = Date.now();
        });
    }

    return {
        enabled: !!base,
        start() {
            if (!base) return Promise.resolve(false);
            if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', () => connect());
            return connect();
        },
        reconnect: () => connect(),
        status: () => status,
        player: () => me,
        onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },

        // One play event: a run's { type: start|clear|fall|quit|revive|shield,
        // level, mode, ms?, tier?, coins?, coinsOf?, cause?, hole? }, an
        // { type: 'act', name } (bought, claimed, ...), or a { type:
        // 'session', ms } (sent by this module itself).
        track(ev) {
            if (!base || !ev || typeof ev.type !== 'string') return;
            const e = { type: ev.type };
            for (const k of ['level', 'mode', 'tier', 'cause', 'name']) if (typeof ev[k] === 'string') e[k] = ev[k];
            for (const k of ['ms', 'coins', 'coinsOf', 'hole']) if (Number.isFinite(ev[k])) e[k] = Math.round(ev[k]);
            events.push(e);
            if (events.length > 200) events.splice(0, events.length - 200);
            if (events.length >= 20) flushEvents();
            else if (!eventTimer) eventTimer = setTimer(() => { eventTimer = null; flushEvents(); }, 30e3);
        },
        flushEvents: () => flushEvents(),
        async submitScore(board, ms) {
            if (!base) return null;
            const s = { board, ms: Math.round(ms) };
            if (!token || status === 'offline') { pending.push(s); return null; }
            try { return await req('POST', '/v1/scores', s); }
            catch (e) {
                if (!e.status || e.status >= 500 || e.status === 429) pending.push(s);
                return null;
            }
        },
        async leaderboard(board, limit = 10) {
            if (!base) return null;
            try { return await req('GET', `/v1/leaderboard?board=${encodeURIComponent(board)}&limit=${limit}`); }
            catch (_) { return null; }
        },
        // --- accounts (server/accounts.js) ---------------------------------
        // Each resolves { ok, error?, ... }; error is the server's code
        // (username-taken, login-wrong, code-wrong, ...) or 'offline'.
        account: () => acct,
        emailOn: () => mailOn,
        register: (f) => accountCall('/v1/account/register', { username: f.username, email: f.email, password: f.password }),
        verifyEmail: (f) => accountCall('/v1/account/verify', { email: f.email, code: f.code }),
        login: (f) => accountCall('/v1/account/login', { login: f.login, password: f.password }),
        forgot: (f) => accountCall('/v1/account/forgot', { login: f.login }),
        resetPassword: (f) => accountCall('/v1/account/reset', { login: f.login, code: f.code, password: f.password }),
        // Signing out: the latest progress goes up first (refused if it
        // cannot), the session ends on the server, and this device starts
        // over as a new guest. The caller reloads the page.
        async logout() {
            if (!token) return { ok: false, error: 'offline' };
            try { await pushNow(); await req('POST', '/v1/account/logout'); }
            catch (e) { return { ok: false, error: e.status ? (e.message || 'server') : 'offline' }; }
            forgetDevice();
            return { ok: true };
        },
        async deleteAccount(password) {
            try { await req('POST', '/v1/account/delete', { password }); }
            catch (e) { return { ok: false, error: e.status ? e.message : 'offline' }; }
            forgetDevice();
            return { ok: true };
        },
        async createLink() {
            if (!base) return null;
            if (!token && !(await connect())) return null;
            try { return await req('POST', '/v1/link'); } catch (_) { return null; }
        },
        // This device becomes the player behind `code`; what it had is merged
        // into that player (the server does it, and we adopt the result).
        async claimLink(code) {
            if (!base) return { ok: false, error: 'off' };
            if (!token && !(await connect())) return { ok: false, error: 'offline' };
            try {
                const r = await req('POST', '/v1/link/claim', { code });
                remember(r.token, r.player);
                adopt(r.save, true);
                await pushNow();
                for (const fn of listeners) { try { fn(status, me); } catch (_) { /* ignore */ } }
                return { ok: true };
            } catch (e) { return { ok: false, error: e.status === 404 ? 'bad-code' : 'offline' }; }
        }
    };
}
