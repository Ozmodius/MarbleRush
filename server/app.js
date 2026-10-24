// THE PLANETILT API: cloud saves and leaderboards. Plain node:http, no
// framework; every route is a few lines over the store (db.js).
//
//   GET  /health                      -> { ok, store }
//   POST /v1/session  {token?, crazyToken?}
//        -> { token, player: { id, name, kind } }
//        A known token is the same player again; none makes a guest. A
//        CrazyGames token signs into that account, and the guest the device
//        was before is folded into it (saves merged, best times kept).
//   GET  /v1/save                     -> { save | null }
//   PUT  /v1/save     {save}          -> { save }   the MERGE of both sides
//        Never an overwrite: the server runs the game's own mergeProgress
//        (progressStore.js), so a stale device cannot undo a newer one.
//   POST /v1/scores   {board, ms}     -> { best, rank, total }
//   POST /v1/scores/batch {scores: [{board, ms}]} -> { accepted }
//   GET  /v1/leaderboard?board=&limit= -> { board, top: [{rank,name,ms,you}], you }
//   POST /v1/events   {events}        -> { accepted }   play tracking
//   GET  /v1/admin/stats?days=&idle=&platform=  -> per-level stats (ADMIN_TOKEN only)
//   GET  /v1/admin/players?q=&platform=&kind=&sort=&limit=&offset= -> { total, players }
//   GET  /v1/admin/player?id=         -> { player, save, scores }
//   POST /v1/admin/player/rename   {id, name}
//   POST /v1/admin/player/signout  {id}           every session ended
//   POST /v1/admin/player/scores   {id}           off every leaderboard
//   POST /v1/admin/player/delete   {id, confirm}  gone; `confirm` is its name
//   GET  /admin                       the admin page (asks for the token)
// platform: 'web' | 'crazygames' (or none for all). Sessions and events say
// which the game is on; the player keeps the last one.
//   POST /v1/offline/checkout          -> { url }   a Square checkout for
//        offline play (offlineUnlock.js); accounts only, never CrazyGames
//   POST /v1/offline/check            -> { owned }  back from checkout: asks
//        Square at once rather than waiting on its webhook
//   POST /webhooks/square             Square's signed payment notifications
//   POST /v1/admin/player/offline  {id, on}       grant or take away offline play
//   POST /v1/link                     -> { code, expiresAt }
//   POST /v1/link/claim {code}        -> { token, player, save }
//        Another device's player, by its 6-letter code: this device becomes
//        that player, and what it had is merged in.
//
// Boards: roll:<levelId>, walk:<levelId>, daily:<YYYY-MM-DD>:<dailyId>. A
// time below the level's minMs (the generator's physical floor) is refused.

import { mergeProgress } from '../progressStore.js';
import { levelForXp } from '../playerLevel.js';
import { ADMIN_PAGE } from './adminPage.js';
import { platformOf } from './db.js';
import { hashPassword, verifyPassword, newCode, hashCode, usernameProblem, emailProblem, passwordProblem, codeEmail, CODE_TTL_MS, CODE_TRIES } from './accounts.js';
import { createOfflineUnlock } from './offlineUnlock.js';
import { hashToken, newToken, newId, newLinkCode, cleanLinkCode, guestName, cleanName } from './auth.js';

const MAX_BODY = 256 * 1024;
const MAX_MS = 60 * 60 * 1000;
const LINK_MS = 10 * 60 * 1000;
// Walking is about five times slower than rolling (WALK.speed 1.8 against the
// generator's 9 u/s); a walk under 3x the roll floor is not a walk.
const WALK_FLOOR = 3;

class HttpError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
}

// Origins: '*' (default; tokens ride in a header, never a cookie, so any page
// may call), or a comma list where a '*' in a host matches any subdomain
// part, e.g. "https://ozmodius.github.io,https://*.crazygames.com".
export function originMatcher(spec) {
    const list = String(spec || '*').split(',').map(s => s.trim()).filter(Boolean);
    if (!list.length || list.includes('*')) return () => '*';
    const res = list.map(p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+') + '$'));
    return origin => (origin && res.some(r => r.test(origin)) ? origin : null);
}

// A simple per-IP limit: `max` requests per rolling minute.
function rateLimiter(max) {
    const hits = new Map();
    let sweep = 0;
    return (ip, now) => {
        if (now - sweep > 60e3) { for (const [k, v] of hits) if (now - v.t > 60e3) hits.delete(k); sweep = now; }
        let h = hits.get(ip);
        if (!h || now - h.t > 60e3) { h = { t: now, n: 0 }; hits.set(ip, h); }
        return ++h.n <= max;
    };
}

// UTC date keys for yesterday..tomorrow: the client dates the daily maze in
// its own time zone, which is never more than a day off UTC.
function nearDays(now) {
    const out = new Set();
    for (const d of [-1, 0, 1]) out.add(new Date(now + d * 86400e3).toISOString().slice(0, 10));
    return out;
}

// Play tracking (POST /v1/events): what the game reports, and what each
// counts as. Anonymous: only daily totals per level and mode are kept.
const EVENT_METRIC = { start: 'starts', clear: 'clears', fall: 'falls', quit: 'quits', revive: 'revives', shield: 'shields' };
const TIERS = new Set(['gold', 'silver', 'bronze']);
const CAUSES = new Set(['hole', 'icicle', 'flare', 'molten', 'shock', 'crush', 'other']);
const ACT_NAME = /^[a-z0-9:_.-]{1,48}$/;
// The funnel's steps: levels cleared.
const FUNNEL = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50];
const MODES = new Set(['roll', 'explore', 'daily']);
const dayOf = t => new Date(t).toISOString().slice(0, 10);

export function createApp({ store, levels = [], dailyLevels = [], verifyCrazy = null, origins = '*', rateMax = 240, now = () => Date.now(), adminToken = null, mailer = { enabled: false, async send() { throw new Error('email is not set up'); } }, unlock = null }) {
    // Offline play's sale (offlineUnlock.js): not for sale unless Square is set up.
    const offline = unlock || createOfflineUnlock({ store, now });
    const ladder = new Map(levels.map(l => [l.id, l]));
    const dailies = new Map(dailyLevels.map(l => [l.id, l]));
    const allowOrigin = originMatcher(origins);
    const allow = rateLimiter(rateMax);

    // One save write at a time per player: read, merge, write must not
    // interleave or a merge could be lost. (One process; Render runs one.)
    const locks = new Map();
    const withLock = async (id, fn) => {
        const prev = locks.get(id) || Promise.resolve();
        let release;
        const mine = new Promise(r => { release = r; });
        const chain = prev.then(() => mine);
        locks.set(id, chain);
        await prev;
        try { return await fn(); } finally {
            release();
            if (locks.get(id) === chain) locks.delete(id);
        }
    };

    // Merge `incoming` into the player's stored save; returns the result.
    const mergeInto = (playerId, incoming) => withLock(playerId, async () => {
        const cur = await store.getSave(playerId);
        const merged = mergeProgress(cur ? cur.data : null, incoming);
        await store.putSave(playerId, merged, merged.savedAt || 0);
        return merged;
    });

    const issue = async (player) => {
        const token = newToken();
        await store.addToken(player.id, hashToken(token));
        return { token, player: { id: player.id, name: player.name, kind: player.kind } };
    };

    const authed = async (req, required = true) => {
        const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
        const p = m ? await store.playerByToken(hashToken(m[1])) : null;
        if (!p && required) throw new HttpError(401, 'unauthorized');
        return p;
    };

    // Joining: `from`'s save merged into `target`'s as the OLDER side, so
    // everything earned on both is kept but the coins and charges are the
    // target's -- a fresh phone joining an account must not replace its
    // wallet with the phone's 0. (A target with no save yet takes it all.)
    const mergeJoining = (targetId, data) => mergeInto(targetId, { ...data, savedAt: 0 });

    // A guest's things move to `target`: its save merged in as above, its
    // best times moved (so the same runs are not on a board twice). The guest
    // player itself stays, empty of scores (its old tokens still name it).
    const fold = async (from, target) => {
        if (!from || from.id === target.id) return;
        const s = await store.getSave(from.id);
        if (s) await mergeJoining(target.id, s.data);
        for (const { board, ms } of await store.scoresOf(from.id)) await store.upsertScore(target.id, board, ms);
        await store.deleteScores(from.id);
    };

    // --- account helpers ---
    const pub = p => ({ id: p.id, name: p.name, kind: p.kind });
    // A hash to check against when there is no account, so a wrong username
    // takes as long to refuse as a wrong password.
    const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');
    // Login guesses: 10 failures per IP and login per 15 minutes.
    const tries = new Map();
    const limitKey = (req, key) => (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?') + '|' + key;
    const tryAllowed = k => { const t = tries.get(k); return !t || now() - t.at > 15 * 60e3 || t.n < 10; };
    const tryFailed = k => { const t = tries.get(k); if (!t || now() - t.at > 15 * 60e3) tries.set(k, { n: 1, at: now() }); else t.n++; };
    const tryCleared = k => tries.delete(k);

    // A code check: right, unexpired, within its tries. Spends the code.
    const checkCode = async (emailKey, purpose, code) => {
        const c = await store.getCode(emailKey, purpose);
        if (!c || c.expiresAt < now()) throw new HttpError(400, 'code-expired');
        if (c.tries >= CODE_TRIES) { await store.deleteCode(emailKey, purpose); throw new HttpError(400, 'code-tries'); }
        if (hashCode(String(code || '').trim()) !== c.codeHash) { await store.bumpCode(emailKey, purpose); throw new HttpError(400, 'code-wrong'); }
        await store.deleteCode(emailKey, purpose);
        return c;
    };

    const sessionFor = async (player) => {
        const out = await issue(player);
        const s = await store.getSave(player.id);
        const a = await store.accountOf(player.id);
        return { ...out, save: s ? s.data : null, account: a ? { username: a.username, email: a.email, verified: a.verified } : null };
    };

    // The device's guest becomes the account (same player); otherwise a
    // fresh player is made for it.
    const makeAccount = async (me, { username, email, passwordHash, verified }) => {
        let player;
        if (me && me.kind === 'guest') player = me;
        else player = await store.createPlayer({ id: newId(), kind: 'account', name: username });
        await store.createAccount({ playerId: player.id, username, email, passwordHash, verified });
        return { ...(await sessionFor(await store.playerById(player.id))), created: true };
    };

    // Signing in to an existing account from this device: its guest folds in.
    const signInTo = async (req, playerId) => {
        const target = await store.playerById(playerId);
        const me = await authed(req, false);
        if (me && me.kind === 'guest' && me.id !== target.id) await fold(me, target);
        return { ...(await sessionFor(target)), joined: !me || me.id !== target.id };
    };

    const checkScore = (board, ms) => {
        if (!Number.isInteger(ms) || ms <= 0 || ms > MAX_MS) throw new HttpError(400, 'bad-ms');
        const m = /^(roll|walk):([\w-]{1,40})$/.exec(board) || /^(daily):(\d{4}-\d{2}-\d{2}):([\w-]{1,40})$/.exec(board);
        if (!m) throw new HttpError(400, 'bad-board');
        if (m[1] === 'daily') {
            const lv = dailies.get(m[3]);
            if (!lv) throw new HttpError(400, 'unknown-level');
            if (!nearDays(now()).has(m[2])) throw new HttpError(400, 'stale-daily');
            if (ms < lv.minMs) throw new HttpError(400, 'too-fast');
            return;
        }
        const lv = ladder.get(m[2]);
        if (!lv) throw new HttpError(400, 'unknown-level');
        if (ms < lv.minMs * (m[1] === 'walk' ? WALK_FLOOR : 1)) throw new HttpError(400, 'too-fast');
    };

    const openSession = async (req, body) => {
        const platform = platformOf(body.platform);
        const m = typeof body.token === 'string' ? await store.playerByToken(hashToken(body.token)) : null;
        if (body.crazyToken) {
            if (!verifyCrazy) throw new HttpError(501, 'crazygames-off');
            let who;
            try { who = await verifyCrazy(body.crazyToken); } catch (_) { throw new HttpError(401, 'bad-crazy-token'); }
            let p = await store.playerByExternal('crazygames', who.userId);
            const name = cleanName(who.username, 'Player');
            if (!p) p = await store.createPlayer({ id: newId(), kind: 'crazygames', externalId: who.userId, name, platform: 'crazygames' });
            else if (who.username && p.name !== name) { await store.renamePlayer(p.id, name); p.name = name; }
            // The device's guest (never another account) folds in.
            if (m && m.kind === 'guest') await fold(m, p);
            if (m && m.id === p.id) return { token: body.token, player: { id: p.id, name: p.name, kind: p.kind } };
            return issue(p);
        }
        if (m) return { token: body.token, player: { id: m.id, name: m.name, kind: m.kind } };
        const p = await store.createPlayer({ id: newId(), kind: 'guest', name: guestName(), platform });
        return issue(p);
    };

    // The admin token (ADMIN_TOKEN): anything else is a 404, so the admin
    // routes do not show they exist.
    const adminOnly = (req) => {
        const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
        if (!adminToken || !m || hashToken(m[1]) !== hashToken(adminToken)) throw new HttpError(404, 'not-found');
    };
    const adminTarget = async (body) => {
        const p = typeof body.id === 'string' ? await store.playerById(body.id) : null;
        if (!p) throw new HttpError(404, 'no-player');
        return p;
    };
    // What a save says, for the admin page (never the whole save).
    const saveSummary = (d) => !d ? null : {
        version: d.v ?? null, wallet: d.wallet ?? 0, xp: d.xp ?? 0, playerLevel: levelForXp(d.xp || 0), highestIndex: d.highestIndex || 0,
        cleared: Object.keys(d.cleared || {}).length, golds: (d.goldClaimed || []).length, explored: Object.keys(d.walks || {}).length,
        rescued: d.rescued || [], fuel: (d.fuel || []).length, diary: (d.diary || []).length,
        marbles: d.marbles || [], marble: d.marble || null, crew: d.crew || {}, bond: d.bond || {}, charges: d.charges || {},
        streak: d.daily ? d.daily.streak || 0 : 0, achievements: (d.achievements || []).length, savedAt: d.savedAt || 0
    };


    const routes = {
        'GET /health': async () => ({ ok: true, store: store.kind }),

        // Any session counts the player as active today (retention).
        'POST /v1/session': async (req, body) => {
            const out = await openSession(req, body);
            const platform = out.player.kind === 'crazygames' ? 'crazygames' : platformOf(body.platform);
            await store.touchPlayer(out.player.id, { lastSeen: now(), day: dayOf(now()), platform });
            return out;
        },

        'GET /v1/save': async (req) => {
            const p = await authed(req);
            const s = await store.getSave(p.id);
            return { save: s ? s.data : null };
        },

        'PUT /v1/save': async (req, body) => {
            const p = await authed(req);
            if (!body.save || typeof body.save !== 'object' || Array.isArray(body.save)) throw new HttpError(400, 'bad-save');
            const save = await mergeInto(p.id, body.save);
            // Where this player has got to, for the stats page.
            await store.touchPlayer(p.id, { lastSeen: now(), furthest: save.highestIndex || 0, playerLevel: levelForXp(save.xp || 0), day: dayOf(now()) });
            return { save };
        },

        // Play tracking, up to 100 events a call; anything malformed is
        // skipped. A run's { type: start|clear|fall|quit|revive|shield,
        // level, mode, ms?, tier?, coins?, coinsOf?, cause?, hole? }; an
        // { type: 'act', name }; a { type: 'session', ms }.
        'POST /v1/events': async (req, body) => {
            const p = await authed(req);
            const list = Array.isArray(body.events) ? body.events.slice(0, 100) : [];
            const sums = new Map(), acts = new Map();
            const add = (level, mode, metric, n) => { const k = level + '|' + mode + '|' + metric; sums.set(k, (sums.get(k) || 0) + n); };
            const count = (name, n = 1) => acts.set(name, (acts.get(name) || 0) + n);
            const int = (v, max) => Number.isInteger(v) && v >= 0 && v <= max ? v : null;
            let accepted = 0;
            for (const e of list) {
                if (!e || typeof e !== 'object') continue;
                if (e.type === 'act') { if (typeof e.name === 'string' && ACT_NAME.test(e.name)) { count(e.name); accepted++; } continue; }
                if (e.type === 'session') { const ms = int(e.ms, 3 * 3600e3); if (ms !== null) { count('sessions'); count('session_ms', ms); accepted++; } continue; }
                if (!EVENT_METRIC[e.type] || !MODES.has(e.mode)) continue;
                const lv = e.mode === 'daily' ? dailies.get(e.level) : ladder.get(e.level);
                if (!lv) continue;
                add(e.level, e.mode, EVENT_METRIC[e.type], 1);
                if (e.type === 'clear') {
                    const ms = int(e.ms, MAX_MS);
                    if (ms) add(e.level, e.mode, 'clear_ms', ms);
                    if (TIERS.has(e.tier)) add(e.level, e.mode, 'tier_' + e.tier, 1);
                    const of = int(e.coinsOf, 50), got = int(e.coins, 50);
                    if (of !== null && got !== null && got <= of) { add(e.level, e.mode, 'coins_taken', got); add(e.level, e.mode, 'coins_possible', of); }
                }
                if (e.type === 'fall') {
                    if (CAUSES.has(e.cause)) add(e.level, e.mode, 'fall_' + e.cause, 1);
                    const hole = int(e.hole, (lv.holes || []).length - 1);
                    if (e.cause === 'hole' && hole !== null) add(e.level, e.mode, 'hole_' + hole, 1);
                }
                accepted++;
            }
            const day = dayOf(now());
            // Counted for the platform the game says it is on (else the
            // player's last one).
            const said = platformOf(body.platform);
            const platform = said || p.platform || 'unknown';
            if (sums.size) await store.addStats(day, [...sums].map(([k, n]) => { const [level, mode, metric] = k.split('|'); return { level, mode, metric, n }; }), platform);
            if (acts.size) await store.addEvents(day, [...acts].map(([name, n]) => ({ name, n })), platform);
            await store.touchPlayer(p.id, { lastSeen: now(), day, platform: said });
            return { accepted };
        },

        // The stats page's data (ADMIN_TOKEN only): per level and mode, the
        // counts over the last `days`, clear rate and mean clear time; how
        // many players stopped there (furthest level, not seen for `idle`
        // days); and how player levels are spread.
        'GET /v1/admin/stats': async (req, body, url) => {
            adminOnly(req);
            const platform = platformOf(url.searchParams.get('platform'));
            const days = Math.max(1, Math.min(365, Math.floor(Number(url.searchParams.get('days')) || 30)));
            const idle = Math.max(1, Math.min(90, Math.floor(Number(url.searchParams.get('idle')) || 7)));
            const rows = await store.statsSince(dayOf(now() - (days - 1) * 86400e3), platform);
            const by = new Map();
            for (const r of rows) {
                const k = r.level + '|' + r.mode;
                if (!by.has(k)) by.set(k, { level: r.level, mode: r.mode, starts: 0, clears: 0, falls: 0, quits: 0, clear_ms: 0 });
                by.get(k)[r.metric] = (by.get(k)[r.metric] || 0) + r.n;
            }
            const positions = await store.playerPositions(platform);
            const cutoff = now() - idle * 86400e3;
            const stoppedAt = new Map();
            for (const pos of positions) if (pos.lastSeen < cutoff) stoppedAt.set(pos.furthest, (stoppedAt.get(pos.furthest) || 0) + 1);
            const describe = (lv, mode) => {
                const s = by.get(lv.id + '|' + mode) || { starts: 0, clears: 0, falls: 0, quits: 0, clear_ms: 0 };
                const medals = s.clears ? { gold: (s.tier_gold || 0) / s.clears, silver: (s.tier_silver || 0) / s.clears, bronze: (s.tier_bronze || 0) / s.clears } : null;
                const causes = {};
                for (const c of CAUSES) if (s['fall_' + c]) causes[c] = s['fall_' + c];
                let worstHole = null;
                for (let h = 0; h < (lv.holes || []).length; h++) {
                    const n = s['hole_' + h] || 0;
                    if (n && (!worstHole || n > worstHole.n)) worstHole = { index: h, n, share: s.fall_hole ? n / s.fall_hole : null, x: lv.holes[h].x, z: lv.holes[h].z };
                }
                return { starts: s.starts, clears: s.clears, falls: s.falls, quits: s.quits, revives: s.revives || 0, shields: s.shields || 0,
                    clearRate: s.starts ? s.clears / s.starts : null, avgClearMs: s.clears ? Math.round(s.clear_ms / s.clears) : null,
                    medals, coinsFound: s.coins_possible ? (s.coins_taken || 0) / s.coins_possible : null, causes, worstHole };
            };
            const levelsOut = levels.map(lv => ({
                id: lv.id, name: lv.name, world: lv.world, index: lv.index, goldMs: lv.goldMs,
                roll: describe(lv, 'roll'), explore: describe(lv, 'explore'),
                // Stopped HERE: their furthest clear is the level before this one.
                stopped: stoppedAt.get(lv.index - 1) || 0
            }));
            const daily = dailyLevels.map(lv => ({ id: lv.id, world: lv.world, ...describe(lv, 'daily') })).filter(d => d.starts);
            const playerLevels = {};
            for (const pos of positions) playerLevels[pos.playerLevel] = (playerLevels[pos.playerLevel] || 0) + 1;
            // Retention and sessions, day by day.
            const fromDay = dayOf(now() - (days - 1) * 86400e3), today = dayOf(now());
            const dayList = [];
            for (let t = Date.parse(fromDay + 'T00:00:00Z'); dayOf(t) <= today; t += 86400e3) dayList.push(dayOf(t));
            const active = new Map((await store.activeByDay(fromDay, platform)).map(r => [r.day, r.n]));
            const evRows = await store.eventsSince(fromDay, platform);
            const evDay = new Map();
            const actions = new Map();
            for (const r of evRows) {
                const d = evDay.get(r.day) || {}; d[r.name] = (d[r.name] || 0) + r.n; evDay.set(r.day, d);
                if (r.name !== 'sessions' && r.name !== 'session_ms') actions.set(r.name, (actions.get(r.name) || 0) + r.n);
            }
            const cohortRows = await store.cohorts(dayOf(now() - (days + 30) * 86400e3), platform);
            const cohortMap = new Map();
            for (const r of cohortRows) { const c = cohortMap.get(r.firstDay) || new Map(); c.set(r.day, r.n); cohortMap.set(r.firstDay, c); }
            const plus = (day, k) => dayOf(Date.parse(day + 'T00:00:00Z') + k * 86400e3);
            const cohorts = [...cohortMap.keys()].filter(d => d >= fromDay).sort().map(d => {
                const c = cohortMap.get(d), size = c.get(d) || 0;
                const back = k => (plus(d, k) > today || !size ? null : (c.get(plus(d, k)) || 0) / size);
                return { day: d, size, d1: back(1), d7: back(7), d30: back(30) };
            });
            const weighted = key => {
                const ok = cohorts.filter(c => c[key] !== null && c.size);
                const n = ok.reduce((a, c) => a + c.size, 0);
                return n ? ok.reduce((a, c) => a + c[key] * c.size, 0) / n : null;
            };
            const byDay = dayList.map(d => {
                const e = evDay.get(d) || {}, dau = active.get(d) || 0;
                return { day: d, dau, new: (cohortMap.get(d) && cohortMap.get(d).get(d)) || 0, sessions: e.sessions || 0,
                    avgSessionMs: e.sessions ? Math.round((e.session_ms || 0) / e.sessions) : null, playMsPerDau: dau ? Math.round((e.session_ms || 0) / dau) : null };
            });
            const totalSessions = byDay.reduce((a, d) => a + d.sessions, 0);
            const totalSessionMs = evRows.filter(r => r.name === 'session_ms').reduce((a, r) => a + r.n, 0);
            // The funnel: of everyone with a position, how many cleared k levels.
            const funnel = FUNNEL.filter(k => k <= levels.length).map(k => {
                const n = positions.filter(pp => pp.furthest >= k).length;
                return { cleared: k, n, share: positions.length ? n / positions.length : null };
            });
            // Everyone, by platform and kind (unfiltered: the split itself).
            const counts = await store.playerCounts();
            const split = {};
            for (const c of counts) { const s0 = split[c.platform] || (split[c.platform] = { total: 0 }); s0.total += c.n; s0[c.kind] = (s0[c.kind] || 0) + c.n; }
            return { days, idle, platform: platform || 'all', split,
                players: { total: positions.length, active: positions.filter(pp => pp.lastSeen >= cutoff).length, finished: stoppedAt.get(levels.length) || 0 },
                retention: { d1: weighted('d1'), d7: weighted('d7'), d30: weighted('d30'), cohorts },
                activity: { byDay, sessions: totalSessions, avgSessionMs: totalSessions ? Math.round(totalSessionMs / totalSessions) : null },
                funnel, levels: levelsOut, daily, playerLevels,
                actions: [...actions].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n) };
        },
        'GET /admin': () => ({ html: ADMIN_PAGE }),

        // --- the admin page's players (ADMIN_TOKEN only) ----------------------
        'GET /v1/admin/players': async (req, body, url) => {
            adminOnly(req);
            const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
            const kind = ['guest', 'account', 'crazygames'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : null;
            const sort = ['seen', 'created', 'furthest', 'name'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'seen';
            const limit = Math.max(1, Math.min(200, Math.floor(Number(url.searchParams.get('limit')) || 50)));
            const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
            return store.adminPlayers({ q, platform: platformOf(url.searchParams.get('platform')), kind, sort, limit, offset });
        },
        'GET /v1/admin/player': async (req, body, url) => {
            adminOnly(req);
            const id = String(url.searchParams.get('id') || '');
            const player = id ? await store.adminPlayer(id) : null;
            if (!player) throw new HttpError(404, 'no-player');
            const s = await store.getSave(id);
            const scores = (await store.scoresOf(id)).sort((a, b) => (a.board < b.board ? -1 : 1));
            return { player, save: saveSummary(s && s.data), scores };
        },
        'POST /v1/admin/player/rename': async (req, body) => {
            adminOnly(req);
            const p = await adminTarget(body);
            const name = cleanName(String(body.name || ''), '');
            if (!name) throw new HttpError(400, 'bad-name');
            await store.renamePlayer(p.id, name);
            console.log('[admin] rename', p.id, JSON.stringify(p.name), '->', JSON.stringify(name));
            return { ok: true, name };
        },
        'POST /v1/admin/player/signout': async (req, body) => {
            adminOnly(req);
            const p = await adminTarget(body);
            await store.revokeTokens(p.id);
            console.log('[admin] sign out everywhere', p.id);
            return { ok: true };
        },
        // Offline play by hand: { on: true } grants it ('admin'), false takes
        // it away (a refund made in Square's dashboard, say).
        'POST /v1/admin/player/offline': async (req, body) => {
            adminOnly(req);
            const p = await adminTarget(body);
            const was = await store.offlinePlayOf(p.id);
            await store.setOfflinePlay(p.id, body.on ? (was || { at: now(), source: 'admin' }) : null);
            console.log('[admin] offline play', body.on ? 'granted' : 'taken away', p.id, was ? JSON.stringify(was) : '');
            return { ok: true, offlinePlay: body.on ? (was || { source: 'admin' }) : null };
        },
        'POST /v1/admin/player/scores': async (req, body) => {
            adminOnly(req);
            const p = await adminTarget(body);
            await store.deleteScores(p.id);
            console.log('[admin] removed from the leaderboards', p.id);
            return { ok: true };
        },
        // Gone for good, like the player's own delete: account, save, times,
        // sessions. `confirm` must be the player's name, typed.
        'POST /v1/admin/player/delete': async (req, body) => {
            adminOnly(req);
            const p = await adminTarget(body);
            if (String(body.confirm || '') !== p.name) throw new HttpError(400, 'confirm-name');
            await store.deletePlayer(p.id);
            console.log('[admin] deleted player', p.id, JSON.stringify(p.name), p.kind);
            return { ok: true };
        },

        'POST /v1/scores': async (req, body) => {
            const p = await authed(req);
            const board = String(body.board || ''), ms = Number(body.ms);
            checkScore(board, ms);
            const best = await store.upsertScore(p.id, board, ms);
            const r = await store.rank(board, best);
            return { best, rank: r.rank, total: r.total };
        },

        // Best times already in a save (cloudSync uploads them once per
        // player): each checked like a single score, the bad ones skipped.
        'POST /v1/scores/batch': async (req, body) => {
            const p = await authed(req);
            const list = Array.isArray(body.scores) ? body.scores.slice(0, 300) : [];
            let accepted = 0;
            for (const s of list) {
                const board = String((s && s.board) || ''), ms = Number(s && s.ms);
                try { checkScore(board, ms); } catch (_) { continue; }
                await store.upsertScore(p.id, board, ms);
                accepted++;
            }
            return { accepted };
        },

        'GET /v1/leaderboard': async (req, body, url) => {
            const p = await authed(req, false);
            const board = String(url.searchParams.get('board') || '');
            if (!/^(roll|walk):[\w-]{1,40}$|^daily:\d{4}-\d{2}-\d{2}:[\w-]{1,40}$/.test(board)) throw new HttpError(400, 'bad-board');
            const limit = Math.max(1, Math.min(50, Math.floor(Number(url.searchParams.get('limit')) || 10)));
            const rows = await store.top(board, limit);
            // Ties share a rank (1 + how many are strictly faster).
            const top = [];
            rows.forEach((r, i) => {
                const rank = i > 0 && rows[i - 1].ms === r.ms ? top[i - 1].rank : i + 1;
                top.push({ rank, name: r.name, ms: r.ms, you: !!(p && r.playerId === p.id) });
            });
            let you = null;
            if (p) {
                const ms = await store.scoreOf(p.id, board);
                if (ms !== null) you = { ms, ...(await store.rank(board, ms)) };
            }
            const total = you ? you.total : (await store.rank(board, 2147483647)).total;
            return { board, top, you, total };
        },

        // --- accounts (accounts.js) ---------------------------------------
        // Who this token is, and its account if it has one.
        'GET /v1/account': async (req) => {
            const p = await authed(req);
            const a = await store.accountOf(p.id);
            // A checkout that came back while the webhook was late or off is
            // settled here too (throttled per player; never waited on).
            if (a) offline.reconcile(p.id, 'account').catch(err => console.error('[offline] lookup failed:', err && err.message));
            return { player: pub(p), account: a ? { username: a.username, email: a.email, verified: a.verified } : null, email: mailer.enabled, offline: await offline.statusFor(p) };
        },

        // --- offline play (offlineUnlock.js) -----------------------------
        'POST /v1/offline/checkout': async (req) => {
            const p = await authed(req);
            let out;
            try { out = await offline.checkout(p, req.headers.origin || ''); }
            catch (err) { console.error('[offline] checkout failed:', err && err.message); throw new HttpError(502, 'checkout-failed'); }
            if (out.error) throw new HttpError(out.status, out.error);
            return out;
        },
        'POST /v1/offline/check': async (req) => {
            const p = await authed(req);
            try { await offline.reconcile(p.id, 'return', { force: true }); }
            catch (err) { console.error('[offline] lookup failed:', err && err.message); }
            return offline.statusFor(p);
        },
        'POST /webhooks/square': async (req, body, url, raw) => ({ status: await offline.webhook(raw, req.headers['x-square-hmacsha256-signature']) }),

        // A new account: the device's guest BECOMES it (same player, so its
        // save and times are already there); from a signed-in device, a new
        // player. With email set up, a 6-digit code is sent first and the
        // account is made at /verify; without, it is made now.
        'POST /v1/account/register': async (req, body) => {
            const username = String(body.username || '').trim(), email = String(body.email || '').trim(), password = String(body.password || '');
            const problem = usernameProblem(username) || emailProblem(email) || passwordProblem(password);
            if (problem) throw new HttpError(400, problem);
            if (await store.usernameTaken(username.toLowerCase())) throw new HttpError(409, 'username-taken');
            if (await store.emailTaken(email.toLowerCase())) throw new HttpError(409, 'email-taken');
            const passwordHash = await hashPassword(password);
            const me = await authed(req, false);
            if (!mailer.enabled) return makeAccount(me, { username, email, passwordHash, verified: false });
            const code = newCode();
            await store.putCode(email.toLowerCase(), 'verify', { codeHash: hashCode(code), expiresAt: now() + CODE_TTL_MS, payload: { username, email, passwordHash } });
            try { await mailer.send({ to: email, ...codeEmail(code, 'verify') }); }
            catch (e) { console.error('[mail]', e && e.message); throw new HttpError(502, 'email-failed'); }
            return { verify: true, email };
        },

        'POST /v1/account/verify': async (req, body) => {
            const email = String(body.email || '').trim();
            const pending = await checkCode(email.toLowerCase(), 'verify', body.code);
            const { username, passwordHash } = pending.payload || {};
            if (!username || !passwordHash) throw new HttpError(400, 'code-expired');
            if (await store.usernameTaken(username.toLowerCase())) throw new HttpError(409, 'username-taken');
            if (await store.emailTaken(email.toLowerCase())) throw new HttpError(409, 'email-taken');
            return makeAccount(await authed(req, false), { username, email: pending.payload.email || email, passwordHash, verified: true });
        },

        // Username or email + password. The device's guest folds into the
        // account (its clears and times kept, the account's coins kept).
        'POST /v1/account/login': async (req, body) => {
            const key = String(body.login || '').trim().toLowerCase();
            const tries = limitKey(req, key);
            if (!tryAllowed(tries)) throw new HttpError(429, 'too-many-tries');
            const a = key ? await store.accountByKey(key) : null;
            const ok = a ? await verifyPassword(String(body.password || ''), a.passwordHash) : (await verifyPassword('x', DUMMY_HASH), false);
            if (!ok) { tryFailed(tries); throw new HttpError(401, 'login-wrong'); }
            tryCleared(tries);
            return signInTo(req, a.playerId);
        },

        // Ends this device's session on the server too.
        'POST /v1/account/logout': async (req) => {
            await authed(req);
            const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
            await store.deleteToken(hashToken(m[1]));
            return { ok: true };
        },

        // A reset code to the account's email. Always answers ok, so nobody
        // can use it to learn which emails have accounts.
        'POST /v1/account/forgot': async (req, body) => {
            if (!mailer.enabled) throw new HttpError(501, 'email-off');
            const key = String(body.login || body.email || '').trim().toLowerCase();
            const tries = limitKey(req, 'forgot:' + key);
            if (!tryAllowed(tries)) throw new HttpError(429, 'too-many-tries');
            tryFailed(tries);
            const a = key ? await store.accountByKey(key) : null;
            if (a) {
                const code = newCode();
                await store.putCode(a.email.toLowerCase(), 'reset', { codeHash: hashCode(code), expiresAt: now() + CODE_TTL_MS });
                try { await mailer.send({ to: a.email, ...codeEmail(code, 'reset') }); } catch (e) { console.error('[mail]', e && e.message); }
            }
            return { ok: true };
        },

        // The code and a new password: every other session of the account
        // ends, and this device is signed in.
        'POST /v1/account/reset': async (req, body) => {
            const key = String(body.login || body.email || '').trim().toLowerCase();
            const a = key ? await store.accountByKey(key) : null;
            if (!a) throw new HttpError(400, 'code-wrong');
            const problem = passwordProblem(body.password);
            if (problem) throw new HttpError(400, problem);
            await checkCode(a.email.toLowerCase(), 'reset', body.code);
            await store.setPassword(a.playerId, await hashPassword(String(body.password)));
            await store.revokeTokens(a.playerId);
            return signInTo(req, a.playerId);
        },

        // Gone for good: the account, its save, its times, every session.
        'POST /v1/account/delete': async (req, body) => {
            const p = await authed(req);
            const a = await store.accountOf(p.id);
            if (!a) throw new HttpError(400, 'no-account');
            if (!(await verifyPassword(String(body.password || ''), a.passwordHash))) throw new HttpError(401, 'login-wrong');
            await store.deletePlayer(p.id);
            return { ok: true };
        },

        'POST /v1/link': async (req) => {
            const p = await authed(req);
            const code = newLinkCode(), expiresAt = now() + LINK_MS;
            await store.createLink(code, p.id, expiresAt);
            return { code, expiresAt };
        },

        'POST /v1/link/claim': async (req, body) => {
            const me = await authed(req);
            const targetId = await store.claimLink(cleanLinkCode(body.code), now());
            if (!targetId) throw new HttpError(404, 'bad-code');
            const target = await store.playerById(targetId);
            if (!target) throw new HttpError(404, 'bad-code');
            // Only a guest is folded away; an account keeps what is its own.
            if (me.kind === 'guest') await fold(me, target);
            else { const s = await store.getSave(me.id); if (s && me.id !== target.id) await mergeJoining(target.id, s.data); }
            const out = await issue(target);
            const s = await store.getSave(target.id);
            return { ...out, save: s ? s.data : null };
        }
    };

    const readBody = (req) => new Promise((resolve, reject) => {
        let size = 0; const chunks = [];
        req.on('data', c => {
            size += c.length;
            if (size > MAX_BODY) { reject(new HttpError(413, 'too-large')); req.destroy(); return; }
            chunks.push(c);
        });
        // { body, raw }: the raw text too, for a signed webhook.
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!chunks.length) return resolve({ body: {}, raw });
            try {
                const v = JSON.parse(raw);
                resolve({ body: v && typeof v === 'object' ? v : {}, raw });
            } catch (_) { reject(new HttpError(400, 'bad-json')); }
        });
        req.on('error', reject);
    });

    return async function handle(req, res) {
        const origin = allowOrigin(req.headers.origin);
        const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
        if (origin) {
            headers['Access-Control-Allow-Origin'] = origin;
            headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
            headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS';
            headers['Access-Control-Max-Age'] = '86400';
            if (origin !== '*') headers.Vary = 'Origin';
        }
        const send = (status, obj) => { res.writeHead(status, headers); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
        if (req.method === 'OPTIONS') return send(204);
        try {
            const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
            if (!allow(ip, now())) throw new HttpError(429, 'slow-down');
            const url = new URL(req.url, 'http://x');
            const route = routes[`${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`];
            if (!route) throw new HttpError(404, 'not-found');
            const { body, raw } = req.method === 'GET' ? { body: {}, raw: '' } : await readBody(req);
            const out = await route(req, body, url, raw);
            if (out && out.status && Object.keys(out).length === 1) { res.writeHead(out.status, { 'Cache-Control': 'no-store' }); res.end(); return; }
            if (out && out.html) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
                res.end(out.html);
                return;
            }
            send(200, out);
        } catch (e) {
            if (e instanceof HttpError) return send(e.status, { error: e.code });
            console.error('[api]', e);
            send(500, { error: 'server' });
        }
    };
}
