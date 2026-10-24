// OFFLINE PLAY UNLOCK -- the web build's paid feature, sold through Square
// (the user's call, 2026-10-22: "Gate", like 3dBallSmack's).
//
// What is sold: STARTING THE GAME WITH NO CONNECTION. The service worker
// (sw.js) keeps a whole copy of the game on the device only for a player who
// owns this; everyone else can still install the app (free) and play online,
// and a phone that loses signal mid-game keeps playing as it always did (the
// game is local-first; cloudSync.js catches up later).
//
// Rules, as in 3dBallSmack's server/offlineUnlock.js, which this is ported from:
//   - ACCOUNTS ONLY. The purchase belongs to an account so it follows the
//     player to every device (a guest is asked to make one first).
//   - THE SERVER DECIDES WHAT WAS PAID. The client only asks for a checkout
//     link. The unlock is written when SQUARE says a payment against an order
//     WE created completed: a signed webhook, or a lookup we make ourselves
//     when the player comes back from checkout or next asks who they are (the
//     fallback for a webhook that is late, lost, or not set up). Either path
//     is idempotent: settling deletes the pending order in the same statement
//     that grants (db.js settleUnlockOrder).
//   - NEVER ON CRAZYGAMES. That build has its own monetisation and never
//     shows the offer (platform.js features.sellsOfflinePlay); a checkout
//     asked for by a CrazyGames player or from a CrazyGames page is refused.
//   - NO FOUNDERS. PlaneTilt is in alpha and nobody had offline play before,
//     so nobody is grandfathered; the admin page can grant it by hand.
//
// Not configured (no token or location) means NOT FOR SALE: statusFor()
// reports priceCents null and the game offers no offline play at all.
//
// Environment (Render > the API service > Environment):
//   SQUARE_ACCESS_TOKEN            sandbox or production access token
//   SQUARE_LOCATION_ID             the location payments are taken at
//   SQUARE_ENVIRONMENT             'production' to take real money; anything
//                                  else is the sandbox
//   SQUARE_WEBHOOK_SIGNATURE_KEY   } optional, together: a webhook subscription
//   SQUARE_WEBHOOK_URL             } to this API's /webhooks/square. Without
//                                  them, payments settle by lookup only.
//   OFFLINE_UNLOCK_PRICE_CENTS     optional; default 499 ($4.99, Ball Smack's)
//   SQUARE_RETURN_URL              optional; where checkout sends the buyer
//                                  back (default: the page they bought from)
//   SQUARE_API_BASE                test seam only (a mock Square)

import crypto from 'node:crypto';

export const DEFAULT_PRICE_CENTS = 499;
const PENDING_TTL_MS = 14 * 24 * 3600e3;
// A player's own pending orders are looked up at most this often (GET
// /v1/account runs on every connect).
const LOOKUP_EVERY_MS = 60e3;
const CRAZY_ORIGIN = /^https?:\/\/([^/]*\.)?crazygames\.[a-z.]+(:\d+)?$/i;

export function createOfflineUnlock({ store, env = {}, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
    // Trimmed: a value pasted into the host's env editor on a phone easily
    // picks up a trailing space or line break, invisible there.
    const e = k => String(env[k] || '').trim();
    const priceCents = (() => { const n = parseInt(env.OFFLINE_UNLOCK_PRICE_CENTS, 10); return Number.isFinite(n) && n >= 100 ? n : DEFAULT_PRICE_CENTS; })();
    const SQ = {
        token: e('SQUARE_ACCESS_TOKEN'),
        locationId: e('SQUARE_LOCATION_ID'),
        signatureKey: e('SQUARE_WEBHOOK_SIGNATURE_KEY'),
        webhookUrl: e('SQUARE_WEBHOOK_URL'),
        returnUrl: e('SQUARE_RETURN_URL').replace(/\/+$/, ''),
        apiBase: (e('SQUARE_API_BASE') || (e('SQUARE_ENVIRONMENT') === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com')).replace(/\/+$/, ''),
        // Pinned (as Ball Smack's) so a Square-side change cannot alter a
        // response shape under us.
        version: '2026-09-16'
    };
    const configured = () => !!(SQ.token && SQ.locationId);
    const webhookOn = () => !!(SQ.signatureKey && SQ.webhookUrl);

    async function squareApi(method, pathname, body) {
        const res = await fetchImpl(SQ.apiBase + pathname, {
            method,
            headers: { Authorization: 'Bearer ' + SQ.token, 'Square-Version': SQ.version, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        let json = null;
        try { json = await res.json(); } catch (_) { /* empty body */ }
        if (!res.ok) {
            const d = json && json.errors && json.errors[0] ? json.errors[0].code + ': ' + json.errors[0].detail : 'HTTP ' + res.status;
            throw new Error('Square ' + pathname + ' failed -- ' + d);
        }
        return json || {};
    }

    // What the game is told: { owned, priceCents } (priceCents null = not
    // for sale here, so no offer is shown).
    async function statusFor(player) {
        if (!player) return { owned: false, priceCents: null };
        const owned = !!(await store.offlinePlayOf(player.id));
        const forSale = configured() && player.kind !== 'crazygames';
        return { owned, priceCents: forSale ? priceCents : null };
    }

    // The ONE place a payment grants the unlock. `payment` is a Square
    // Payment object, from the webhook or from our own lookup.
    async function settle(payment, via) {
        if (!payment || payment.status !== 'COMPLETED' || !payment.order_id) return false;
        if (payment.location_id && payment.location_id !== SQ.locationId) return false;
        const paid = Number(payment.amount_money && payment.amount_money.amount);
        if (!(paid > 0)) return false;
        const rec = await store.settleUnlockOrder(payment.order_id, paid, { at: now(), source: 'square', orderId: payment.order_id, paymentId: payment.id, amount: paid });
        if (!rec) return false;        // not ours, already settled, or underpaid
        log.log(`[offline] unlocked ${rec.playerId} (order ${payment.order_id}, payment ${payment.id}, ${paid}c, via ${via})`);
        return true;
    }

    // Ask Square about this player's own pending orders (newest 3) and settle
    // any that were paid. A tender's payment_id is sometimes empty, in which
    // case the tender's own id IS the payment id (as Ball Smack found).
    const lastLookup = new Map(), inFlight = new Set();
    async function reconcile(playerId, via, { force = false } = {}) {
        if (!configured() || inFlight.has(playerId)) return false;
        if (!force && now() - (lastLookup.get(playerId) || 0) < LOOKUP_EVERY_MS) return false;
        if (await store.offlinePlayOf(playerId)) return false;
        const mine = await store.unlockOrdersOf(playerId, now() - PENDING_TTL_MS);
        if (!mine.length) return false;
        inFlight.add(playerId);
        lastLookup.set(playerId, now());
        try {
            for (const o of mine.slice(0, 3)) {
                const { order } = await squareApi('GET', '/v2/orders/' + encodeURIComponent(o.orderId));
                for (const t of (order && order.tenders) || []) {
                    const id = t.payment_id || t.id;
                    if (!id) continue;
                    const { payment } = await squareApi('GET', '/v2/payments/' + encodeURIComponent(id));
                    if (await settle(payment, via)) return true;
                }
            }
            return false;
        } finally { inFlight.delete(playerId); }
    }

    // A Square payment link for one player, and the pending order it settles.
    const recent = new Map();
    async function checkout(player, origin) {
        if (!configured()) return { error: 'not-for-sale', status: 501 };
        if (!player || player.kind !== 'account') return { error: 'account-needed', status: 403 };
        if (origin && CRAZY_ORIGIN.test(origin)) return { error: 'not-here', status: 403 };
        if (await store.offlinePlayOf(player.id)) return { error: 'owned', status: 409 };
        // A double tap makes one order, not two.
        const r = recent.get(player.id);
        if (r && now() - r.at < 10e3) return r.out;
        let base = SQ.returnUrl;
        if (!base && origin) { try { const u = new URL(origin); if (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') base = u.origin; } catch (_) { /* no return */ } }
        const unlockId = crypto.randomBytes(12).toString('hex');
        const body = {
            idempotency_key: unlockId,
            order: {
                location_id: SQ.locationId,
                reference_id: unlockId,
                line_items: [{ name: 'PlaneTilt - Offline Play', quantity: '1', base_price_money: { amount: priceCents, currency: 'USD' } }]
            },
            payment_note: 'PlaneTilt offline play (' + unlockId + ')'
        };
        if (base) body.checkout_options = { redirect_url: base + '/?offline_unlock=done' };
        const out = await squareApi('POST', '/v2/online-checkout/payment-links', body);
        const link = out.payment_link;
        if (!link || !link.url || !link.order_id) throw new Error('Square returned no payment link');
        await store.addUnlockOrder({ orderId: link.order_id, playerId: player.id, unlockId, amount: priceCents, createdAt: now() });
        await store.pruneUnlockOrders(now() - PENDING_TTL_MS);
        log.log(`[offline] checkout for ${player.id} (order ${link.order_id}, ${priceCents}c)`);
        const res = { url: link.url };
        recent.set(player.id, { at: now(), out: res });
        return res;
    }

    // POST /webhooks/square. Square signs the notification URL it called
    // plus the raw body. -> an HTTP status.
    async function webhook(raw, signature) {
        if (!configured() || !webhookOn()) return 404;
        const given = Buffer.from(String(signature || ''));
        const expected = Buffer.from(crypto.createHmac('sha256', SQ.signatureKey).update(SQ.webhookUrl + raw).digest('base64'));
        if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
            log.error('[offline] Square webhook refused: signature mismatch (check SQUARE_WEBHOOK_URL is exactly the subscription URL, and the key)');
            return 401;
        }
        let evt;
        try { evt = JSON.parse(raw); } catch (_) { return 400; }
        const payment = evt && (evt.type === 'payment.updated' || evt.type === 'payment.created') && evt.data && evt.data.object && evt.data.object.payment;
        // The subscription hears EVERY payment on the merchant account (the
        // user's other sales included); only one against an order of ours goes
        // further, the rest are acknowledged quietly.
        if (payment) {
            try { await settle(payment, 'webhook'); }
            catch (err) { log.error('[offline] webhook settle failed:', err); return 500; }   // Square retries a 5xx
        }
        return 200;
    }

    return { priceCents, configured, webhookOn, statusFor, settle, reconcile, checkout, webhook };
}
