// Offline play's sale (offlineUnlock.js, the /v1/offline routes, the Square
// webhook): not for sale without Square settings; accounts only; never from
// CrazyGames; a checkout makes one pending order; the unlock is granted only
// when Square says a payment for OUR order completed (by lookup or a signed
// webhook), once, never underpaid, never at another location; the admin page
// can give and take it.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from './app.js';
import { createMemoryStore, createPgStore } from './db.js';
import { createOfflineUnlock } from './offlineUnlock.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(fs.readFileSync(path.join(root, 'mazeLevels.json'), 'utf8')).levels;
let failed = 0, passed = 0;
const check = (cond, msg) => { if (cond) passed++; else { failed++; console.error('FAIL', msg); } };
const quiet = { log() {}, error() {} };
let clock = Date.parse('2026-10-22T12:00:00Z');

// A Square stand-in: payment links make orders; a test marks one paid.
const sq = { orders: new Map(), payments: new Map(), links: 0, lookups: 0 };
const square = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
        const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
        if (req.headers.authorization !== 'Bearer sq-token') return send(401, { errors: [{ code: 'UNAUTHORIZED', detail: 'token' }] });
        if (req.method === 'POST' && req.url === '/v2/online-checkout/payment-links') {
            const b = JSON.parse(raw);
            const id = 'order-' + (++sq.links);
            sq.orders.set(id, { id, body: b, tenders: [] });
            return send(200, { payment_link: { url: 'https://square.test/pay/' + id, order_id: id } });
        }
        let m = /^\/v2\/orders\/(.+)$/.exec(req.url);
        if (m) { sq.lookups++; const o = sq.orders.get(decodeURIComponent(m[1])); return o ? send(200, { order: { id: o.id, tenders: o.tenders } }) : send(404, { errors: [{ code: 'NOT_FOUND', detail: 'order' }] }); }
        m = /^\/v2\/payments\/(.+)$/.exec(req.url);
        if (m) { const p = sq.payments.get(decodeURIComponent(m[1])); return p ? send(200, { payment: p }) : send(404, { errors: [{ code: 'NOT_FOUND', detail: 'payment' }] }); }
        send(404, {});
    });
});
await new Promise(r => square.listen(0, r));
const SQ_BASE = `http://127.0.0.1:${square.address().port}`;
const pay = (orderId, { amount = 499, location = 'LOC1', status = 'COMPLETED', tenderHasId = false } = {}) => {
    const id = 'pay-' + orderId;
    const p = { id, order_id: orderId, status, location_id: location, amount_money: { amount, currency: 'USD' } };
    sq.payments.set(id, p);
    sq.orders.get(orderId).tenders = [tenderHasId ? { id, payment_id: '' } : { id: 'tender-x', payment_id: id }];
    return p;
};

const pgUrl = process.env.TEST_DATABASE_URL;
async function freshStore() {
    if (!pgUrl) return createMemoryStore();
    const c = new pg.Client({ connectionString: pgUrl }); await c.connect();
    await c.query('DROP TABLE IF EXISTS unlock_orders, event_stats, player_days, codes, accounts, level_stats, links, scores, saves, tokens, players'); await c.end();
    return createPgStore(pgUrl);
}
const stores = [], servers = [];
const ENV = { SQUARE_ACCESS_TOKEN: 'sq-token ', SQUARE_LOCATION_ID: 'LOC1', SQUARE_API_BASE: SQ_BASE, SQUARE_WEBHOOK_SIGNATURE_KEY: 'whkey', SQUARE_WEBHOOK_URL: 'https://api.test/webhooks/square' };
async function serve(env) {
    const store = await freshStore();
    stores.push(store);
    const unlock = createOfflineUnlock({ store, env, now: () => clock, log: quiet });
    const server = http.createServer(createApp({ store, levels, rateMax: 10000, now: () => clock, adminToken: 'adm', unlock }));
    servers.push(server);
    await new Promise(r => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, p, { token, body, headers = {}, raw } = {}) => {
        const h = { 'Content-Type': 'application/json', ...headers };
        if (token) h.Authorization = `Bearer ${token}`;
        const res = await fetch(base + p, { method, headers: h, body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined });
        return { status: res.status, body: await res.json().catch(() => null) };
    };
    return { call, store };
}
const account = async (call, name) => {
    const g = (await call('POST', '/v1/session', { body: {} })).body;
    const r = await call('POST', '/v1/account/register', { token: g.token, body: { username: name, email: name + '@x.test', password: 'long enough' } });
    return { token: r.body.token, id: r.body.player.id };
};
const sign = (raw, url = ENV.SQUARE_WEBHOOK_URL, key = 'whkey') => crypto.createHmac('sha256', key).update(url + raw).digest('base64');
const hook = (call, payment, sig) => {
    const raw = JSON.stringify({ type: 'payment.updated', data: { object: { payment } } });
    return call('POST', '/webhooks/square', { raw, headers: { 'x-square-hmacsha256-signature': sig === undefined ? sign(raw) : sig } });
};

// --- not configured: not for sale ---
{
    const { call } = await serve({});
    const a = await account(call, 'nosale');
    const me = (await call('GET', '/v1/account', { token: a.token })).body;
    check(me.offline && me.offline.owned === false && me.offline.priceCents === null, 'no Square settings: not for sale (priceCents null)');
    check((await call('POST', '/v1/offline/checkout', { token: a.token })).status === 501, 'no Square settings: no checkout');
    check((await call('POST', '/webhooks/square', { raw: '{}' })).status === 404, 'no Square settings: the webhook does not exist');
}

// --- configured ---
{
    const { call, store } = await serve(ENV);
    const guest = (await call('POST', '/v1/session', { body: {} })).body;
    const gMe = (await call('GET', '/v1/account', { token: guest.token })).body;
    check(gMe.offline.priceCents === 499 && gMe.offline.owned === false, 'for sale at $4.99 (the default), shown to a guest too');
    const gc = await call('POST', '/v1/offline/checkout', { token: guest.token });
    check(gc.status === 403 && gc.body.error === 'account-needed', 'a guest must make an account to buy');

    const a = await account(call, 'buyer');
    const crazy = await call('POST', '/v1/offline/checkout', { token: a.token, headers: { Origin: 'https://www.crazygames.com' } });
    check(crazy.status === 403 && crazy.body.error === 'not-here', 'never sold from a CrazyGames page');
    const co = await call('POST', '/v1/offline/checkout', { token: a.token, headers: { Origin: 'https://planetilt.com' } });
    check(co.status === 200 && /^https:\/\/square\.test\/pay\/order-\d+$/.test(co.body.url), 'an account gets a Square checkout link');
    const orderId = co.body.url.split('/').pop();
    const sent = sq.orders.get(orderId).body;
    check(sent.order.location_id === 'LOC1' && sent.order.line_items[0].base_price_money.amount === 499 && sent.order.line_items[0].name === 'PlaneTilt - Offline Play', 'the order is $4.99 of PlaneTilt offline play at the location');
    check(sent.checkout_options && sent.checkout_options.redirect_url === 'https://planetilt.com/?offline_unlock=done', 'checkout sends the buyer back to the page they bought from');
    const again = await call('POST', '/v1/offline/checkout', { token: a.token, headers: { Origin: 'https://planetilt.com' } });
    check(again.body.url === co.body.url && sq.links === 1, 'a double tap makes one order, not two');
    check((await store.unlockOrdersOf(a.id)).length === 1, 'one pending order is kept');

    // Back from checkout before paying: still not owned.
    let back = await call('POST', '/v1/offline/check', { token: a.token });
    check(back.status === 200 && back.body.owned === false, 'not paid yet: not owned');
    // Paid, but short: refused.
    pay(orderId, { amount: 100 });
    back = await call('POST', '/v1/offline/check', { token: a.token });
    check(back.body.owned === false, 'an underpaid order does not unlock');
    pay(orderId, { amount: 499, status: 'APPROVED' });
    back = await call('POST', '/v1/offline/check', { token: a.token });
    check(back.body.owned === false, 'a payment not yet COMPLETED does not unlock');
    // Paid in full (a tender whose own id is the payment id).
    pay(orderId, { amount: 499, tenderHasId: true });
    back = await call('POST', '/v1/offline/check', { token: a.token });
    check(back.body.owned === true, 'back from checkout, paid: owned at once (no webhook needed)');
    check((await store.unlockOrdersOf(a.id)).length === 0, 'the order is consumed by the unlock');
    const own = await store.offlinePlayOf(a.id);
    check(own && own.source === 'square' && own.orderId === orderId && own.amount === 499, 'the unlock records the order and payment');
    const owned = await call('POST', '/v1/offline/checkout', { token: a.token });
    check(owned.status === 409 && owned.body.error === 'owned', 'an owner is not sold it twice');
    const me = (await call('GET', '/v1/account', { token: a.token })).body;
    check(me.offline.owned === true, 'GET /v1/account says owned');
    // A late webhook for the same payment changes nothing.
    check((await hook(call, sq.payments.get('pay-' + orderId))).status === 200, 'a late webhook for a settled order is acknowledged');

    // The webhook path.
    const b = await account(call, 'hooked');
    clock += 20e3;
    const co2 = await call('POST', '/v1/offline/checkout', { token: b.token, headers: { Origin: 'https://planetilt.com' } });
    const order2 = co2.body.url.split('/').pop();
    const p2 = pay(order2);
    check((await hook(call, p2, 'bad-signature')).status === 401 && !(await store.offlinePlayOf(b.id)), 'a webhook with a wrong signature is refused');
    check((await hook(call, { ...p2, location_id: 'ELSEWHERE' })).status === 200 && !(await store.offlinePlayOf(b.id)), 'a payment at another location never unlocks');
    check((await hook(call, { ...p2, order_id: 'someone-elses-sale' })).status === 200 && !(await store.offlinePlayOf(b.id)), 'other sales on the account are acknowledged and ignored');
    check((await hook(call, p2)).status === 200 && (await store.offlinePlayOf(b.id)) && (await store.offlinePlayOf(b.id)).source === 'square', 'a signed webhook for our order unlocks');

    // GET /v1/account settles a paid order in the background (throttled).
    const c = await account(call, 'later');
    clock += 20e3;
    const order3 = (await call('POST', '/v1/offline/checkout', { token: c.token })).body.url.split('/').pop();
    pay(order3);
    await call('GET', '/v1/account', { token: c.token });
    await new Promise(r => setTimeout(r, 100));
    check(!!(await store.offlinePlayOf(c.id)), 'signing in again settles a payment whose webhook never came');
    const before = sq.lookups;
    for (let i = 0; i < 3; i++) await call('GET', '/v1/account', { token: c.token });
    check(sq.lookups === before, 'an owner is never looked up again');

    // Admin: give and take.
    const d = await account(call, 'gifted');
    check((await call('POST', '/v1/admin/player/offline', { token: 'adm', body: { id: d.id, on: true } })).status === 200 && (await store.offlinePlayOf(d.id)).source === 'admin', 'the admin page can give offline play');
    const row = (await call('GET', '/v1/admin/player?id=' + d.id, { token: 'adm' })).body.player;
    check(row.offlinePlay && row.offlinePlay.source === 'admin', "the admin page shows who owns it");
    check((await call('POST', '/v1/admin/player/offline', { token: 'adm', body: { id: d.id, on: false } })).status === 200 && !(await store.offlinePlayOf(d.id)), 'and take it away (a refund)');
    check((await call('POST', '/v1/admin/player/offline', { token: a.token, body: { id: d.id, on: true } })).status === 404, 'only with the admin token');

    // A CrazyGames player is never offered it.
    const crazyP = await store.createPlayer({ id: 'cg1', kind: 'crazygames', externalId: 'u1', name: 'Cg' });
    const st = await createOfflineUnlock({ store, env: ENV, log: quiet }).statusFor(crazyP);
    check(st.priceCents === null, 'a CrazyGames player is not offered it');
}

for (const s of stores) await s.close();
for (const s of servers) s.close();
square.close();
console.log(`offline sale: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
