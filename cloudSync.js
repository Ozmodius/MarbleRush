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
