// THE PROGRESS STORE -- the other Phase 0 seam (CLAUDE.md, docs/PLAN.md).
//
// In Ball Smack the server held the maze ledger and paid out; Marble Rush has
// no server (docs/PLAN.md: "No server"), so this module is that ledger. Three
// calls, as planned:
//
//   load()                              read the save (once, at boot)
//   recordClear(levelId, ms, coins)     a run reached the goal; returns what it earned
//   spend(amount)                       pay for something; false if short
//
// The RULES are pure functions (applyClear, spendFrom) over a plain object, so
// test_progress_store.js checks them in Node with no browser and no storage.
// The store wraps them with a save adapter: platform.js's loadSave/writeSave
// in the game (CrazyGames cloud save or localStorage), an in-memory map in the
// test.
//
// WHAT IS STILL ENFORCED with no server to enforce it: the ladder (a level
// unlocks when the one before it is cleared), a time floor (minMs -- a "clear"
// faster than the level's physical minimum is not counted), and first-time-only
// payouts. Nothing is competitive and no real money moves (docs/PLAN.md), so a
// player who edits their own save cheats only themselves; these rules exist so
// the HONEST game behaves -- a replay must not pay a first clear twice.

import { MARBLES, UPGRADES, CHARGES, PRIZES, PRIZE_GRANT, AD_REWARDS } from './shopCatalog.js';

export const SAVE_KEY = 'marbleRush.progress.v1';
export const SAVE_VERSION = 1;

export function freshProgress() {
    return {
        v: SAVE_VERSION, wallet: 0, highestIndex: 0, cleared: {}, goldClaimed: [], prizes: [], charges: {},
        // The shop (shopCatalog.js). Added after the first saves existed, so
        // parseProgress fills them in for a save that predates them.
        marbles: ['classic'], marble: 'classic', upgrades: {}, prizeUses: {},
        // When the store's free-coins ad last paid (AD_REWARDS.coinsCooldownMs).
        adCoinsAt: 0
    };
}

// Read a saved string into a valid progress object. Anything unreadable or
// from an unknown version starts fresh rather than half-loading: a save the
// game misreads is worse than none.
export function parseProgress(text) {
    let raw = null;
    try { raw = text ? JSON.parse(text) : null; } catch (_) { raw = null; }
    if (!raw || typeof raw !== 'object' || raw.v !== SAVE_VERSION) return freshProgress();
    const p = freshProgress();
    p.wallet = Math.max(0, Math.floor(Number(raw.wallet) || 0));
    p.highestIndex = Math.max(0, Math.floor(Number(raw.highestIndex) || 0));
    if (raw.cleared && typeof raw.cleared === 'object') {
        for (const [id, c] of Object.entries(raw.cleared)) {
            if (c && Number.isFinite(c.bestMs)) p.cleared[id] = { bestMs: c.bestMs, coins: Math.max(0, c.coins | 0), at: Number(c.at) || 0 };
        }
    }
    if (Array.isArray(raw.goldClaimed)) p.goldClaimed = raw.goldClaimed.filter(x => typeof x === 'string');
    if (Array.isArray(raw.prizes)) p.prizes = raw.prizes.filter(x => typeof x === 'string');
    const counts = (src, known) => {
        const out = {};
        if (src && typeof src === 'object') {
            for (const [k, n] of Object.entries(src)) if (known[k] && Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
        }
        return out;
    };
    p.charges = counts(raw.charges, CHARGES);
    p.prizeUses = counts(raw.prizeUses, PRIZES);
    p.upgrades = counts(raw.upgrades, UPGRADES);
    for (const [k, n] of Object.entries(p.upgrades)) p.upgrades[k] = Math.min(n, UPGRADES[k].prices.length);
    if (Array.isArray(raw.marbles)) p.marbles = ['classic', ...raw.marbles.filter(id => MARBLES[id] && id !== 'classic')];
    p.marble = p.marbles.includes(raw.marble) ? raw.marble : 'classic';
    p.adCoinsAt = Math.max(0, Number(raw.adCoinsAt) || 0);
    return p;
}

// Gold, silver, bronze by time. The one copy: mazeGame.js draws the level list
// with it and applyClear pays with it, so the medal shown is the medal paid.
export function tierForMs(lv, ms) {
    if (!lv || !Number.isFinite(ms)) return null;
    if (ms <= lv.goldMs) return 'gold';
    if (ms <= lv.goldMs * 1.5) return 'silver';
    if (ms <= lv.goldMs * 2.25) return 'bronze';
    return null;
}

export function isUnlocked(progress, lv) {
    return !!lv && lv.index <= (progress.highestIndex || 0) + 1;
}

// What clearing a level is worth, from the payout table in mazeLevels.json.
export function basePayout(payouts, lv) {
    const v = Number(((payouts && payouts.byWorld) || {})[String(lv && lv.world)]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}
export function goldBonus(payouts, lv) {
    const b = basePayout(payouts, lv) * (Number(payouts && payouts.goldBonusPct) || 0);
    return Number.isFinite(b) && b > 0 ? Math.round(b) : 0;
}

// A clear. Returns { progress, result } with progress a NEW object (the input
// is not modified), or { progress: <unchanged>, result: { accepted: false,
// reason } } when the clear does not count.
//
// Pays, all first-time only:
//   - the world's base payout on a level's first clear;
//   - the gold bonus the first time it is cleared at gold;
//   - each coin once: a replay banks only coins beyond the most this level has
//     ever banked, so replaying for coins is not a farm but going back for the
//     ones you skipped is worth it.
// A coin is banked only by CLEARING -- a run that falls is worth nothing,
// which is what makes a coin down a risky branch a choice.
export function applyClear(progress, levels, payouts, levelId, durationMs, coins, now = Date.now()) {
    const lv = (levels || []).find(l => l.id === levelId);
    const no = reason => ({ progress, result: { accepted: false, levelId, reason } });
    if (!lv) return no('unknown-level');
    if (!isUnlocked(progress, lv)) return no('locked');
    if (!Number.isFinite(durationMs) || durationMs < lv.minMs) return no('too-fast');

    const p = JSON.parse(JSON.stringify(progress));
    const maxCoins = Array.isArray(lv.coins) ? lv.coins.length : 0;
    const got = Math.max(0, Math.min(maxCoins, Math.floor(Number(coins) || 0)));
    const prev = p.cleared[lv.id];
    const firstClear = !prev;
    const tier = tierForMs(lv, durationMs);
    const goldFirst = tier === 'gold' && !p.goldClaimed.includes(lv.id);
    const coinsEarned = Math.max(0, got - (prev ? prev.coins : 0));

    const earned = (firstClear ? basePayout(payouts, lv) : 0) + (goldFirst ? goldBonus(payouts, lv) : 0) + coinsEarned;
    p.wallet += earned;
    p.cleared[lv.id] = {
        bestMs: prev ? Math.min(prev.bestMs, durationMs) : durationMs,
        coins: Math.max(prev ? prev.coins : 0, got),
        at: now
    };
    if (goldFirst) p.goldClaimed.push(lv.id);
    p.highestIndex = Math.max(p.highestIndex, lv.index);
    let prize = null;
    if (lv.prize && !p.prizes.includes(lv.prize)) {
        p.prizes.push(lv.prize);
        p.prizeUses[lv.prize] = (p.prizeUses[lv.prize] || 0) + PRIZE_GRANT;
        prize = lv.prize;
    }

    return {
        progress: p,
        result: {
            accepted: true, levelId: lv.id, firstClear, runMs: durationMs, bestMs: p.cleared[lv.id].bestMs,
            tier, goldFirst, earned, coinsEarned, wallet: p.wallet, highestIndex: p.highestIndex, prize
        }
    };
}

export function spendFrom(progress, amount) {
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n < 0 || n > progress.wallet) return { progress, ok: false };
    const p = JSON.parse(JSON.stringify(progress));
    p.wallet -= n;
    return { progress: p, ok: true };
}

// --- THE SHOP ---------------------------------------------------------------
// Every purchase is one of these: check what it needs, take the price, give the
// thing. Each returns { progress, ok, reason } with progress a new object, or
// the input unchanged when ok is false. Prices come from shopCatalog.js only --
// nothing a caller passes can set one.
function purchase(progress, price, give, reason) {
    if (reason) return { progress, ok: false, reason };
    if (!(price >= 0) || price > progress.wallet) return { progress, ok: false, reason: 'short' };
    const p = JSON.parse(JSON.stringify(progress));
    p.wallet -= price;
    give(p);
    return { progress: p, ok: true };
}

export function buyMarble(progress, id) {
    const m = MARBLES[id];
    return purchase(progress, m ? m.price : NaN, p => { p.marbles.push(id); p.marble = id; },
        !m ? 'unknown' : progress.marbles.includes(id) ? 'owned' : null);
}

// Choosing among marbles already owned is free.
export function selectMarble(progress, id) {
    if (!progress.marbles.includes(id)) return { progress, ok: false, reason: 'not-owned' };
    const p = JSON.parse(JSON.stringify(progress));
    p.marble = id;
    return { progress: p, ok: true };
}

// Upgrades are bought a tier at a time, in order.
export function upgradePrice(progress, id) {
    const u = UPGRADES[id];
    const tier = progress.upgrades[id] || 0;
    return u && tier < u.prices.length ? u.prices[tier] : null;
}
export function buyUpgrade(progress, id) {
    const price = upgradePrice(progress, id);
    return purchase(progress, price === null ? NaN : price, p => { p.upgrades[id] = (p.upgrades[id] || 0) + 1; },
        !UPGRADES[id] ? 'unknown' : price === null ? 'maxed' : null);
}

export function buyCharge(progress, id) {
    const c = CHARGES[id];
    return purchase(progress, c ? c.price : NaN, p => { p.charges[id] = (p.charges[id] || 0) + 1; }, !c ? 'unknown' : null);
}

// Refills of a world prize: only once the world has given it.
export function buyPrizeRefill(progress, id) {
    const z = PRIZES[id];
    return purchase(progress, z ? z.refill.price : NaN, p => { p.prizeUses[id] = (p.prizeUses[id] || 0) + z.refill.uses; },
        !z ? 'unknown' : !progress.prizes.includes(id) ? 'not-earned' : null);
}

// Spend one owned power-up charge or prize use (fired in a run). False if
// there is none to spend.
export function consume(progress, bucket, id) {
    if (!['charges', 'prizeUses'].includes(bucket) || !(progress[bucket][id] > 0)) return { progress, ok: false, reason: 'none' };
    const p = JSON.parse(JSON.stringify(progress));
    p[bucket][id]--;
    if (!p[bucket][id]) delete p[bucket][id];
    return { progress: p, ok: true };
}

// --- REWARDED ADS (shopCatalog.js AD_REWARDS) -------------------------------
// Called only after an ad has run to the end (platform.js resolves true only
// then). Each pays a fixed, bounded amount.
export function adCoins(progress, now = Date.now()) {
    if (now - (progress.adCoinsAt || 0) < AD_REWARDS.coinsCooldownMs) return { progress, ok: false, reason: 'cooldown' };
    const p = JSON.parse(JSON.stringify(progress));
    p.wallet += AD_REWARDS.coins;
    p.adCoinsAt = now;
    return { progress: p, ok: true };
}
// How long until the free-coins ad pays again, in ms (0 = now).
export function adCoinsWaitMs(progress, now = Date.now()) {
    return Math.max(0, (progress.adCoinsAt || 0) + AD_REWARDS.coinsCooldownMs - now);
}
// A clear's pay again: the game offers it once per clear, with `earned` from
// that clear's own result. Capped, and nothing for a clear that paid nothing.
export function adDoubleClear(progress, earned) {
    const n = Math.min(AD_REWARDS.doubleCap, Math.max(0, Math.floor(Number(earned) || 0)));
    if (!n) return { progress, ok: false, reason: 'nothing' };
    const p = JSON.parse(JSON.stringify(progress));
    p.wallet += n;
    return { progress: p, ok: true, amount: n };
}
export function adCharge(progress, id) {
    if (!CHARGES[id]) return { progress, ok: false, reason: 'unknown' };
    const p = JSON.parse(JSON.stringify(progress));
    p.charges[id] = (p.charges[id] || 0) + 1;
    return { progress: p, ok: true };
}

// The store: the rules above plus a save adapter { load(key) -> Promise<string|null>,
// save(key, string) -> boolean }. Every change is written through at once --
// a phone game can be killed at any moment, and a clear must not be lost to it.
export function createProgressStore(adapter, levels = [], payouts = {}) {
    let progress = freshProgress();
    const persist = () => {
        try { adapter.save(SAVE_KEY, JSON.stringify(progress)); } catch (e) { console.warn('[progress] save failed:', e && e.message); }
    };
    const apply = (out) => {
        if (out.ok) { progress = out.progress; persist(); }
        return { ok: out.ok, reason: out.reason || null };
    };
    return {
        async load() {
            let text = null;
            try { text = await adapter.load(SAVE_KEY); } catch (_) { text = null; }
            progress = parseProgress(text);
            return progress;
        },
        get: () => progress,
        setLevels(nextLevels, nextPayouts) { levels = nextLevels || []; payouts = nextPayouts || {}; },
        recordClear(levelId, durationMs, coins) {
            const out = applyClear(progress, levels, payouts, levelId, durationMs, coins);
            if (out.result.accepted) { progress = out.progress; persist(); }
            return out.result;
        },
        spend(amount) {
            const out = spendFrom(progress, amount);
            if (out.ok) { progress = out.progress; persist(); }
            return out.ok;
        },
        // Shop actions: each returns { ok, reason } and saves on success.
        buyMarble: id => apply(buyMarble(progress, id)),
        selectMarble: id => apply(selectMarble(progress, id)),
        buyUpgrade: id => apply(buyUpgrade(progress, id)),
        buyCharge: id => apply(buyCharge(progress, id)),
        buyPrizeRefill: id => apply(buyPrizeRefill(progress, id)),
        useCharge: id => apply(consume(progress, 'charges', id)).ok,
        usePrize: id => apply(consume(progress, 'prizeUses', id)).ok,
        // Rewarded-ad payouts: call only once the ad has finished.
        adCoins: () => apply(adCoins(progress)),
        adCoinsWaitMs: () => adCoinsWaitMs(progress),
        adDoubleClear: earned => { const out = adDoubleClear(progress, earned); apply(out); return { ok: out.ok, amount: out.amount || 0 }; },
        adCharge: id => apply(adCharge(progress, id))
    };
}
