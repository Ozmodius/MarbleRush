// cloudSync.js (the game's side) against the real API (app.js, memory store):
// two devices, one player. Clears made on either reach the other, nothing is
// overwritten, scores and old best times reach the boards, a link code joins
// the devices, and with the server down the game carries on.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createMemoryStore } from './db.js';
import { createProgressStore } from '../progressStore.js';
import { createCloudSync, scoresInSave } from '../cloudSync.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'mazeLevels.json'), 'utf8'));
const levels = data.levels, payouts = data.payouts;
const dailyLevels = JSON.parse(fs.readFileSync(path.join(root, 'dailyLevels.json'), 'utf8')).levels;

let failed = 0, passed = 0;
const check = (cond, msg) => { if (cond) passed++; else { failed++; console.error('FAIL', msg); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer(createApp({ store: createMemoryStore(), levels, dailyLevels, rateMax: 10000 }));
await new Promise(r => server.listen(0, r));
const api = `http://127.0.0.1:${server.address().port}`;

function storage() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
async function device(apiUrl = api) {
    const mem = new Map();
    const store = createProgressStore({ load: async k => mem.get(k) || null, save: (k, v) => { mem.set(k, v); return true; } }, levels, payouts);
    await store.load();
    const sync = createCloudSync({ store, api: apiUrl, storage: storage(), debounceMs: 20 });
    return { store, sync, mem };
}
const lv = i => levels[i];
const okMs = i => lv(i).goldMs + 3000;

// No API: off, and every call a no-op.
const off = createCloudSync({ store: (await device()).store, api: null });
check(off.status() === 'off' && (await off.start()) === false && (await off.submitScore('roll:x', 1)) === null, 'no API means off and quiet');

// Device A plays before it ever syncs, then connects: old best times backfill.
const A = await device();
A.store.recordClear(lv(0).id, okMs(0), 0);
A.store.recordClear(lv(1).id, okMs(1), 0);
check(scoresInSave(A.store.get()).length === 2, 'best times are read out of the save');
const statuses = [];
A.sync.onStatus(s => statuses.push(s));
check(await A.sync.start(), 'device A connects');
check(A.sync.status() === 'synced' && /^Guest-/.test(A.sync.player().name), 'A is a synced guest');
check(statuses.join() === 'syncing,synced', 'status goes syncing then synced');
const board0 = await A.sync.leaderboard(`roll:${lv(0).id}`);
check(board0 && board0.you && board0.you.ms === okMs(0), 'A\'s old best time was backfilled onto the board');

// A new clear pushes by itself, and its score posts with a rank.
A.store.recordClear(lv(2).id, okMs(2), 0);
const posted = await A.sync.submitScore(`roll:${lv(2).id}`, okMs(2));
check(posted && posted.rank === 1 && posted.total === 1, 'a score posts and ranks');
await wait(120);
check(A.sync.status() === 'synced', 'the push after a save settles to synced');

// Device B joins A with a link code, and gets A's clears; B's own play merges in.
const B = await device();
B.store.recordClear(lv(0).id, okMs(0) - 500, 0);       // B was faster on level 1
await B.sync.start();
const link = await A.sync.createLink();
check(link && /^[A-Z2-9]{6}$/.test(link.code), 'A makes a link code');
const claimed = await B.sync.claimLink(link.code);
check(claimed.ok && B.sync.player().id === A.sync.player().id, 'B becomes A\'s player');
const bp = B.store.get();
check(bp.cleared[lv(1).id] && bp.cleared[lv(2).id], 'B has A\'s clears');
check(bp.cleared[lv(0).id].bestMs === okMs(0) - 500, 'and kept its own faster time');
check(bp.wallet === A.store.get().wallet && bp.wallet > 0, `B takes A's coins, not its own (${bp.wallet} vs A ${A.store.get().wallet})`);
check(!(await B.sync.claimLink(link.code)).ok, 'a used code fails gently');

// B clears level 4; A picks it up on its next sync and keeps everything.
B.store.recordClear(lv(3).id, okMs(3), 0);
await wait(120);
await A.sync.reconnect();
const ap = A.store.get();
check(ap.cleared[lv(3).id] && ap.cleared[lv(0).id].bestMs === okMs(0) - 500, 'A gets B\'s clear and best time');
check(Object.keys(ap.cleared).length === 4, 'nothing lost on either side');
// A's saved copy is the merged one (what the game reloads next launch).
check(JSON.parse(A.mem.get('marbleRush.progress.v1')).cleared[lv(3).id], 'the merge is written to the device save');

// A walk and a daily post to their own boards.
check(await A.sync.submitScore(`walk:${lv(0).id}`, lv(0).minMs * 5), 'a walk time posts');
const top = await B.sync.leaderboard(`roll:${lv(0).id}`);
check(top.top.length === 1 && top.you.rank === 1, 'one player, one row, however many devices');

// Server down: the game is unaffected, the score waits and posts on reconnect.
const C = await device('http://127.0.0.1:1');
check((await C.sync.start()) === false && C.sync.status() === 'offline', 'no server: offline, not an error');
C.store.recordClear(lv(0).id, okMs(0), 0);
check(C.store.get().cleared[lv(0).id], 'play goes on offline');
check((await C.sync.submitScore(`roll:${lv(0).id}`, okMs(0))) === null, 'an offline score returns null');

server.close();
console.log(`cloud sync: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
