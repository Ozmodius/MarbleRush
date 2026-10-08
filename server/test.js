// The PlaneTilt API against the in-memory store: sessions, merged saves,
// leaderboards and their validation, link codes, and CrazyGames sign-in with
// a key made here (the real key cannot be reached from a test).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';
import { createApp, originMatcher } from './app.js';
import { createMemoryStore, createPgStore } from './db.js';
import pg from 'pg';
import { createCrazyVerifier } from './auth.js';
import { freshProgress } from '../progressStore.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(fs.readFileSync(path.join(root, 'mazeLevels.json'), 'utf8')).levels;
const dailyLevels = JSON.parse(fs.readFileSync(path.join(root, 'dailyLevels.json'), 'utf8')).levels;

let failed = 0, passed = 0;
const check = (cond, msg) => { if (cond) passed++; else { failed++; console.error('FAIL', msg); } };

const { publicKey, privateKey } = await generateKeyPair('RS256');
const pem = await exportSPKI(publicKey);
const other = await generateKeyPair('RS256');
const crazyToken = (userId, username, key = privateKey) =>
    new SignJWT({ userId, username, gameId: 'planetilt' }).setProtectedHeader({ alg: 'RS256' }).setIssuedAt().setExpirationTime('1h').sign(key);

// TEST_DATABASE_URL runs the same checks against a real Postgres (its
// PlaneTilt tables are dropped first: point it at a throwaway database).
const pgUrl = process.env.TEST_DATABASE_URL;
if (pgUrl) {
    const c = new pg.Client({ connectionString: pgUrl }); await c.connect();
    await c.query('DROP TABLE IF EXISTS level_stats, links, scores, saves, tokens, players'); await c.end();
}
const store = pgUrl ? await createPgStore(pgUrl) : createMemoryStore();
let clock = Date.parse('2026-10-07T12:00:00Z');
const app = createApp({ store, levels, dailyLevels, verifyCrazy: createCrazyVerifier({ pem }), rateMax: 10000, now: () => clock, adminToken: 'sekret-admin' });
const server = http.createServer(app);
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, p, { token, body, origin } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (origin) headers.Origin = origin;
    const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
};

// --- sessions ---
const h = await call('GET', '/health');
check(h.status === 200 && h.body.ok, 'health answers');
const g1 = await call('POST', '/v1/session', { body: {} });
check(g1.status === 200 && g1.body.token && /^Guest-/.test(g1.body.player.name), 'no token makes a guest');
const again = await call('POST', '/v1/session', { body: { token: g1.body.token } });
check(again.body.player.id === g1.body.player.id && again.body.token === g1.body.token, 'a known token is the same player');
const junk = await call('POST', '/v1/session', { body: { token: 'nope' } });
check(junk.body.player.id !== g1.body.player.id, 'an unknown token makes a new guest');
check((await call('GET', '/v1/save')).status === 401, 'saves need a token');

// --- saves merge, never overwrite ---
const T1 = g1.body.token;
check((await call('GET', '/v1/save', { token: T1 })).body.save === null, 'a new player has no save');
const phone = { ...freshProgress(), wallet: 120, highestIndex: 2, savedAt: 1000,
    cleared: { w1_01: { bestMs: 9000, coins: 2 }, w1_02: { bestMs: 12000, coins: 1 } } };
const tablet = { ...freshProgress(), wallet: 40, highestIndex: 3, savedAt: 2000,
    cleared: { w1_01: { bestMs: 8000, coins: 1 }, w1_03: { bestMs: 15000, coins: 3 } } };
const p1 = await call('PUT', '/v1/save', { token: T1, body: { save: phone } });
check(p1.status === 200 && p1.body.save.wallet === 120, 'first push stores the save');
const p2 = await call('PUT', '/v1/save', { token: T1, body: { save: tablet } });
const m = p2.body.save;
check(m.cleared.w1_01.bestMs === 8000 && m.cleared.w1_01.coins === 2, 'best time and most coins both kept');
check(m.cleared.w1_02 && m.cleared.w1_03, 'clears from both devices kept');
check(m.highestIndex === 3 && m.wallet === 40, 'progress is the max, the wallet comes from the newer save');
const stale = await call('PUT', '/v1/save', { token: T1, body: { save: phone } });
check(stale.body.save.wallet === 40 && stale.body.save.cleared.w1_03, 'a stale device cannot undo a newer one');
check((await call('GET', '/v1/save', { token: T1 })).body.save.cleared.w1_03, 'the merged save is what is stored');
check((await call('PUT', '/v1/save', { token: T1, body: { save: [1] } })).status === 400, 'a non-object save is refused');
// Concurrent pushes from two devices both land.
const a = { ...freshProgress(), savedAt: 3000, cleared: { w1_04: { bestMs: 20000, coins: 0 } } };
const b = { ...freshProgress(), savedAt: 3001, cleared: { w1_05: { bestMs: 21000, coins: 0 } } };
await Promise.all([call('PUT', '/v1/save', { token: T1, body: { save: a } }), call('PUT', '/v1/save', { token: T1, body: { save: b } })]);
const both = (await call('GET', '/v1/save', { token: T1 })).body.save;
check(both.cleared.w1_04 && both.cleared.w1_05 && both.cleared.w1_01, 'simultaneous pushes are both merged');
const big = await fetch(base + '/v1/save', { method: 'PUT', headers: { Authorization: `Bearer ${T1}` }, body: 'x'.repeat(300 * 1024) }).catch(() => ({ status: 413 }));
check(big.status === 413, 'an oversized body is refused');

// --- scores ---
const lv1 = levels[0];
const sc = (token, board, ms) => call('POST', '/v1/scores', { token, body: { board, ms } });
check((await sc(null, `roll:${lv1.id}`, lv1.minMs + 100)).status === 401, 'scores need a token');
const s1 = await sc(T1, `roll:${lv1.id}`, lv1.minMs + 500);
check(s1.status === 200 && s1.body.best === lv1.minMs + 500 && s1.body.rank === 1 && s1.body.total === 1, 'a first score ranks 1 of 1');
const s1b = await sc(T1, `roll:${lv1.id}`, lv1.minMs + 900);
check(s1b.body.best === lv1.minMs + 500, 'a slower run keeps the best');
check((await sc(T1, `roll:${lv1.id}`, lv1.minMs - 1)).body.error === 'too-fast', 'under the physical floor is refused');
check((await sc(T1, `walk:${lv1.id}`, lv1.minMs + 1)).body.error === 'too-fast', 'a walk at rolling speed is refused');
check((await sc(T1, `walk:${lv1.id}`, lv1.minMs * 4)).status === 200, 'a walk time is accepted');
check((await sc(T1, 'roll:nope', 9000)).body.error === 'unknown-level', 'unknown level refused');
check((await sc(T1, 'roll:w1_01; DROP', 9000)).body.error === 'bad-board', 'malformed board refused');
check((await sc(T1, `roll:${lv1.id}`, 5.5)).body.error === 'bad-ms', 'fractional ms refused');
check((await sc(T1, `roll:${lv1.id}`, 3600001)).body.error === 'bad-ms', 'over an hour refused');
const d = dailyLevels[0];
check((await sc(T1, `daily:2026-10-07:${d.id}`, d.minMs + 10)).status === 200, 'today\'s daily accepted');
check((await sc(T1, `daily:2026-10-08:${d.id}`, d.minMs + 10)).status === 200, 'a time zone ahead of UTC is accepted');
check((await sc(T1, `daily:2026-10-01:${d.id}`, d.minMs + 10)).body.error === 'stale-daily', 'an old daily refused');

const G2 = (await call('POST', '/v1/session', { body: {} })).body.token;
const G3 = (await call('POST', '/v1/session', { body: {} })).body.token;
await sc(G2, `roll:${lv1.id}`, lv1.minMs + 200);
await sc(G3, `roll:${lv1.id}`, lv1.minMs + 500);
const lb = await call('GET', `/v1/leaderboard?board=roll:${lv1.id}&limit=10`, { token: T1 });
check(lb.status === 200 && lb.body.top.length === 3, 'the board lists everyone');
check(lb.body.top[0].ms === lv1.minMs + 200 && lb.body.top[0].rank === 1, 'fastest first');
check(lb.body.top[1].rank === 2 && lb.body.top[2].rank === 2, 'a tie shares the rank');
check(lb.body.you && lb.body.you.rank === 2 && lb.body.you.total === 3, 'your own rank comes back');
check(lb.body.top.filter(r => r.you).length === 1, 'your row is marked');
check(!('playerId' in lb.body.top[0]), 'player ids are not published');
const anon = await call('GET', `/v1/leaderboard?board=roll:${lv1.id}`);
check(anon.status === 200 && anon.body.you === null && anon.body.total === 3, 'a board can be read without a token');
check((await call('GET', '/v1/leaderboard?board=x')).status === 400, 'bad board name on read refused');

const batch = await call('POST', '/v1/scores/batch', { token: G3, body: { scores: [
    { board: `roll:${levels[1].id}`, ms: levels[1].minMs + 10 }, { board: `roll:${levels[2].id}`, ms: 1 }, { board: 'junk', ms: 5000 }, null] } });
check(batch.status === 200 && batch.body.accepted === 1, 'a batch keeps the good scores and skips the bad');

// --- link codes ---
const link = await call('POST', '/v1/link', { token: T1 });
check(/^[A-Z2-9]{6}$/.test(link.body.code), 'a link code is six letters');
const G4 = (await call('POST', '/v1/session', { body: {} })).body.token;
await call('PUT', '/v1/save', { token: G4, body: { save: { ...freshProgress(), wallet: 999, savedAt: 5000, cleared: { w1_09: { bestMs: 30000, coins: 1 } } } } });
const t1Wallet = (await call('GET', '/v1/save', { token: T1 })).body.save.wallet;
const claim = await call('POST', '/v1/link/claim', { token: G4, body: { code: link.body.code.toLowerCase() } });
check(claim.status === 200 && claim.body.player.id === g1.body.player.id, 'claiming a code becomes that player');
check(claim.body.save.cleared.w1_09 && claim.body.save.cleared.w1_03, 'the claiming device\'s progress is merged in');
check(claim.body.save.wallet === t1Wallet && t1Wallet !== 999, 'and the joined player keeps its own coins, though the joining save is newer');
check((await call('POST', '/v1/link/claim', { token: G4, body: { code: link.body.code } })).status === 404, 'a code works once');
const late = await call('POST', '/v1/link', { token: T1 });
clock += 11 * 60e3;
check((await call('POST', '/v1/link/claim', { token: G4, body: { code: late.body.code } })).status === 404, 'a code expires');
clock -= 11 * 60e3;

// --- CrazyGames sign-in ---
const G5 = (await call('POST', '/v1/session', { body: {} })).body.token;
await call('PUT', '/v1/save', { token: G5, body: { save: { ...freshProgress(), savedAt: 6000, cleared: { w1_07: { bestMs: 25000, coins: 2 } } } } });
await sc(G5, `roll:${lv1.id}`, lv1.minMs + 50);
const cg = await call('POST', '/v1/session', { body: { token: G5, crazyToken: await crazyToken('cg-42', 'MarbleFan') } });
check(cg.status === 200 && cg.body.player.kind === 'crazygames' && cg.body.player.name === 'MarbleFan', 'a CrazyGames token signs in with the username');
const cgSave = (await call('GET', '/v1/save', { token: cg.body.token })).body.save;
check(cgSave && cgSave.cleared.w1_07, 'the guest\'s save follows into the account');
const lb2 = await call('GET', `/v1/leaderboard?board=roll:${lv1.id}`, { token: cg.body.token });
check(lb2.body.you && lb2.body.you.ms === lv1.minMs + 50 && lb2.body.top[0].name === 'MarbleFan', 'the guest\'s best time follows too');
check(lb2.body.total === anon.body.total + 1, 'the guest\'s time is moved, not copied');
const cg2 = await call('POST', '/v1/session', { body: { crazyToken: await crazyToken('cg-42', 'MarbleFan2') } });
check(cg2.body.player.id === cg.body.player.id && cg2.body.player.name === 'MarbleFan2', 'the same account on another device, renamed');
check((await call('POST', '/v1/session', { body: { crazyToken: await crazyToken('cg-9', 'X', other.privateKey) } })).status === 401, 'a token signed by another key is refused');
check((await call('POST', '/v1/session', { body: { crazyToken: 'a.b.c' } })).status === 401, 'garbage token refused');
// A signed-in account never folds into another account.
const cg3 = await call('POST', '/v1/session', { body: { token: cg.body.token, crazyToken: await crazyToken('cg-77', 'Other') } });
check(cg3.body.player.id !== cg.body.player.id && !(await call('GET', '/v1/save', { token: cg3.body.token })).body.save, 'one account is not merged into another');

// The verifier fetches the key as { publicKey } JSON.
const fetched = createCrazyVerifier({ keyUrl: 'https://key.test/publicKey.json', fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ publicKey: pem }) }) });
check((await fetched(await crazyToken('u1', 'Fetched'))).username === 'Fetched', 'the key is read from the publicKey JSON');

// --- play tracking and the stats page ---
const TE = (await call('POST', '/v1/session', { body: {} })).body.token;
const l2 = levels[1];
const ev = (type, level = l2.id, mode = 'roll', ms) => ({ type, level, mode, ...(ms ? { ms } : {}) });
const sent = await call('POST', '/v1/events', { token: TE, body: { events: [
    ev('start'), ev('fall'), ev('start'), ev('clear', l2.id, 'roll', 20000), ev('start'), ev('clear', l2.id, 'roll', 30000), ev('start'), ev('quit'),
    ev('start', l2.id, 'explore'), ev('start', dailyLevels[0].id, 'daily'),
    ev('start', 'nope'), ev('bogus'), ev('start', l2.id, 'flying'), ev('start', l2.id, 'daily'), null] } });
check(sent.status === 200 && sent.body.accepted === 10, `events count the good and skip the bad (${sent.body.accepted})`);
check((await call('POST', '/v1/events', { body: { events: [ev('start')] } })).status === 401, 'events need a token');
check((await call('GET', '/v1/admin/stats')).status === 404, 'the stats are hidden without the admin token');
check((await call('GET', '/v1/admin/stats', { token: TE })).status === 404, 'a player token does not open them');
// A player who reached level 8 and then went away: they stopped at level 9.
const TS = (await call('POST', '/v1/session', { body: {} })).body.token;
await call('PUT', '/v1/save', { token: TS, body: { save: { ...freshProgress(), highestIndex: 8, xp: 700, savedAt: 1 } } });
clock += 10 * 86400e3;
await call('PUT', '/v1/save', { token: TE, body: { save: { ...freshProgress(), highestIndex: 1, savedAt: 1 } } });   // TE active today
const st = await call('GET', '/v1/admin/stats?days=30&idle=7', { token: 'sekret-admin' });
check(st.status === 200, 'the admin token opens the stats');
const row = st.body.levels.find(l => l.id === l2.id);
check(row.roll.starts === 4 && row.roll.clears === 2 && row.roll.falls === 1 && row.roll.quits === 1 && row.roll.clearRate === 0.5 && row.roll.avgClearMs === 25000,
    `per level: starts, clears, falls, quits, clear rate, mean clear time: ${JSON.stringify(row.roll)}`);
check(row.explore.starts === 1 && st.body.daily.length === 1 && st.body.daily[0].starts === 1, 'explore and the daily maze are counted apart');
const l9 = st.body.levels.find(l => l.index === 9);
check(l9.stopped === 1 && st.body.levels.find(l => l.index === 3).stopped === 0, `a player gone 10 days with 8 levels cleared stopped at level 9 (${l9.stopped})`);
check(st.body.players.total >= 2 && st.body.players.active >= 1 && st.body.playerLevels[5] >= 1, `players and their levels are counted: ${JSON.stringify(st.body.players)} ${JSON.stringify(st.body.playerLevels)}`);
const narrow = await call('GET', '/v1/admin/stats?days=1', { token: 'sekret-admin' });
check(narrow.body.levels.find(l => l.id === l2.id).roll.starts === 0, 'counts outside the chosen days are left out');
clock -= 10 * 86400e3;
const page = await fetch(base + '/admin');
const html = await page.text();
check(page.status === 200 && /text\/html/.test(page.headers.get('content-type')) && html.includes('PlaneTilt Stats') && page.headers.get('x-robots-tag') === 'noindex',
    'the stats page is served, and kept out of search engines');

// --- CORS, routing ---
const opt = await call('OPTIONS', '/v1/save', { origin: 'https://ozmodius.github.io' });
check(opt.status === 204 && opt.headers.get('access-control-allow-origin') === '*', 'preflight answered');
check((await call('GET', '/nope')).status === 404, 'unknown route 404');
const om = originMatcher('https://ozmodius.github.io, https://*.crazygames.com');
check(om('https://ozmodius.github.io') && om('https://games.crazygames.com') && !om('https://evil.com') && !om('https://crazygames.com.evil.com'), 'origin list matches subdomain wildcards only');

// --- rate limit ---
const tiny = createApp({ store: createMemoryStore(), levels, dailyLevels, rateMax: 3 });
const s2 = http.createServer(tiny); await new Promise(r => s2.listen(0, r));
const codes = [];
for (let i = 0; i < 5; i++) codes.push((await fetch(`http://127.0.0.1:${s2.address().port}/health`)).status);
check(codes.join() === '200,200,200,429,429', 'the per-IP limit holds');
s2.close();

server.close();
await store.close();
console.log(`server (${store.kind}): ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
