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

export const SAVE_KEY = 'marbleRush.progress.v1';
export const SAVE_VERSION = 1;

export function freshProgress() {
    return { v: SAVE_VERSION, wallet: 0, highestIndex: 0, cleared: {}, goldClaimed: [], prizes: [], charges: {} };
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
    if (raw.charges && typeof raw.charges === 'object') {
        for (const [k, n] of Object.entries(raw.charges)) if (Number.isFinite(n) && n > 0) p.charges[k] = Math.floor(n);
    }
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
    if (lv.prize && !p.prizes.includes(lv.prize)) { p.prizes.push(lv.prize); prize = lv.prize; }

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

// The store: the rules above plus a save adapter { load(key) -> Promise<string|null>,
// save(key, string) -> boolean }. Every change is written through at once --
// a phone game can be killed at any moment, and a clear must not be lost to it.
export function createProgressStore(adapter, levels = [], payouts = {}) {
    let progress = freshProgress();
    const persist = () => {
        try { adapter.save(SAVE_KEY, JSON.stringify(progress)); } catch (e) { console.warn('[progress] save failed:', e && e.message); }
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
        }
    };
}
