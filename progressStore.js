// THE PROGRESS STORE -- the other Phase 0 seam (CLAUDE.md, docs/PLAN.md).
//
// In Ball Smack the server held the maze ledger and paid out; PlaneTilt has
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

import { MARBLES, UPGRADES, CHARGES, PRIZES, PRIZE_GRANT, AD_REWARDS, LOOKS, DAILY_MAZE, WALK, EXPLORER, COMFORT } from './shopCatalog.js';
import { achievementList, achievementsReady, claimAchievement, parseAchievements } from './achievements.js';
import * as daily from './daily.js';
import * as levelUp from './playerLevel.js';
import { XP } from './shopCatalog.js';

// The game was called Marble Rush when saves began; the key keeps that name
// on purpose -- renaming it would wipe every player's progress.
export const SAVE_KEY = 'marbleRush.progress.v1';
export const SAVE_VERSION = 1;

export function defaultComfort() {
    const c = {};
    for (const [k, v] of Object.entries(COMFORT)) c[k] = v.def;
    return c;
}
// A comfort block with every value known and inside its range.
export function cleanComfort(raw) {
    const c = defaultComfort();
    if (!raw || typeof raw !== 'object') return c;
    for (const [k, v] of Object.entries(COMFORT)) {
        if (typeof v.def === 'boolean') { if (typeof raw[k] === 'boolean') c[k] = raw[k]; }
        else if (Number.isFinite(raw[k])) c[k] = Math.max(v.min, Math.min(v.max, raw[k]));
    }
    return c;
}

export function freshProgress() {
    return {
        v: SAVE_VERSION, wallet: 0, highestIndex: 0, cleared: {}, goldClaimed: [], prizes: [], charges: {},
        // The shop (shopCatalog.js). Added after the first saves existed, so
        // parseProgress fills them in for a save that predates them.
        marbles: ['classic'], marble: 'classic', upgrades: {}, prizeUses: {},
        // When the store's free-coins ad last paid (AD_REWARDS.coinsCooldownMs),
        // and when the last free upgrade step was given (upgradeCooldownMs).
        adCoinsAt: 0, adUpgradeAt: 0,
        // The 7-day calendar and today's missions (daily.js).
        daily: { streak: 0, last: '', doubled: '' }, missions: null,
        // Skins and trails (shopCatalog.js LOOKS): owned, and worn.
        skins: ['plain'], skin: 'plain', trails: ['none'], trail: 'none',
        // Player level (playerLevel.js): total XP, and the highest level
        // whose reward has been paid (so no level pays twice).
        xp: 0, levelPaid: 1,
        // Today's daily maze: { date, id, best, paid, gold } (daily.js).
        dailyMaze: null,
        // Ball cam (mazeGame.js): the closer camera that follows the ball.
        ballCam: false,
        // The Labyrinth (walkMode.js): best walk per level, explorer kit
        // owned, and the comfort settings.
        walks: {}, explorer: [], comfort: defaultComfort(),
        // Achievements claimed (achievements.js): ids. Their progress is read
        // from the rest of the save, never stored.
        achievements: [],
        // When this save was last written (ms): cloud sync's tie-breaker.
        savedAt: 0
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
    p.adUpgradeAt = Math.max(0, Number(raw.adUpgradeAt) || 0);
    for (const L of Object.values(LOOKS)) {
        if (Array.isArray(raw[L.owned])) p[L.owned] = [L.base, ...raw[L.owned].filter(id => L.table[id] && id !== L.base)];
        p[L.chosen] = p[L.owned].includes(raw[L.chosen]) ? raw[L.chosen] : L.base;
    }
    // A save from before player levels has no xp at all: null marks it, and
    // the store works it out from what was already cleared (backfillXp).
    p.xp = raw.xp === undefined || raw.xp === null ? null : Math.max(0, Math.floor(Number(raw.xp) || 0));
    // A save from before levelPaid was paid up to its level on the old curve.
    p.levelPaid = Number.isFinite(raw.levelPaid) ? Math.max(1, Math.floor(raw.levelPaid))
        : p.xp === null ? 1 : levelUp.legacyLevelForXp(p.xp);
    p.daily = daily.parseDaily(raw.daily);
    p.dailyMaze = daily.parseDailyMaze(raw.dailyMaze);
    p.ballCam = raw.ballCam === true;
    p.savedAt = Math.max(0, Number(raw.savedAt) || 0);
    if (raw.walks && typeof raw.walks === 'object') {
        for (const [id, w] of Object.entries(raw.walks)) {
            if (w && Number.isFinite(w.bestMs)) p.walks[id] = { bestMs: w.bestMs, coins: Math.max(0, w.coins | 0), gold: !!w.gold };
        }
    }
    if (Array.isArray(raw.explorer)) p.explorer = raw.explorer.filter((id, i, a) => EXPLORER[id] && a.indexOf(id) === i);
    p.comfort = cleanComfort(raw.comfort);
    p.missions = daily.parseMissions(raw.missions);
    p.achievements = parseAchievements(raw.achievements);
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

// The medal thresholds tierForMs uses, slowest last.
export function tierLimits(lv) {
    return { gold: lv.goldMs, silver: lv.goldMs * 1.5, bronze: lv.goldMs * 2.25 };
}

// The near miss after a clear: the next medal above the player's BEST on this
// level, and how much faster this run needed to be for it. `close` marks a
// miss worth a big RETRY (within a second, or 15% of that medal's time).
// Null once the level is gold -- nothing left to chase.
// `goldMs` is the par to measure against: the level's own, or a walk par.
export function nearMiss(lv, runMs, bestMs, goldMs = lv && lv.goldMs) {
    if (!lv || !Number.isFinite(runMs)) return null;
    lv = { goldMs };
    const best = Number.isFinite(bestMs) ? Math.min(bestMs, runMs) : runMs;
    const have = tierForMs(lv, best);
    const order = ['bronze', 'silver', 'gold'];
    const target = order[order.indexOf(have) + 1];
    if (!target) return null;
    const limit = tierLimits(lv)[target];
    const gapMs = Math.max(1, Math.ceil(runMs - limit));
    return { tier: target, gapMs, close: gapMs <= Math.max(1000, 0.15 * limit) };
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

// A clear of the daily maze. `today` is daily.dailyMazeFor's answer; only its
// maze counts, only while it is unlocked, and not under the level's minMs. The
// day's first clear pays DAILY_MAZE.reward plus the coins taken; its first
// gold pays goldBonus; replays only chase the best time. Off the ladder: no
// level is unlocked and nothing in `cleared` changes.
export function applyDailyClear(progress, today, durationMs, coins, now = Date.now()) {
    const lv = today && today.lv;
    const no = reason => ({ progress, result: { accepted: false, levelId: lv && lv.id, reason, daily: true } });
    if (!lv) return no('none');
    if (today.locked) return no('locked');
    if (!Number.isFinite(durationMs) || durationMs < lv.minMs) return no('too-fast');
    const p = JSON.parse(JSON.stringify(progress));
    const got = Math.max(0, Math.min(Array.isArray(lv.coins) ? lv.coins.length : 0, Math.floor(Number(coins) || 0)));
    const prev = today.paid ? today : null;
    const tier = tierForMs(lv, durationMs);
    const firstClear = !today.paid;
    const goldFirst = tier === 'gold' && !today.gold;
    const earned = (firstClear ? DAILY_MAZE.reward + got : 0) + (goldFirst ? DAILY_MAZE.goldBonus : 0);
    p.wallet += earned;
    const bestMs = prev && Number.isFinite(prev.best) ? Math.min(prev.best, durationMs) : durationMs;
    p.dailyMaze = { date: today.date, id: lv.id, best: bestMs, paid: true, gold: today.gold || tier === 'gold' };
    return {
        progress: p,
        result: {
            accepted: true, daily: true, levelId: lv.id, firstClear, runMs: durationMs, bestMs, prevBestMs: prev ? prev.best : undefined,
            tier, goldFirst, earned, coinsEarned: firstClear ? got : 0, wallet: p.wallet, highestIndex: p.highestIndex, prize: null
        }
    };
}

// --- THE LABYRINTH (walking a level) ----------------------------------------
// A walk's medals measure against walkGoldMs, not the rolling gold time.
export function walkGoldMs(lv) { return Math.round(lv.goldMs * WALK.parShare); }
export function walkTierForMs(lv, ms) { return tierForMs({ goldMs: walkGoldMs(lv) }, ms); }

// A walk to the goal. Only a level already CLEARED by rolling can be walked,
// and not under its minMs (no walk is faster than the fastest roll). Pays once
// each: payShare of the first-clear pay plus the coins taken on the first walk,
// and the level's gold bonus on the first walk gold. Replays chase the time.
export function applyWalkClear(progress, levels, payouts, levelId, durationMs, coins) {
    const lv = (levels || []).find(l => l.id === levelId);
    const no = reason => ({ progress, result: { accepted: false, levelId, reason, walk: true } });
    if (!lv) return no('unknown-level');
    if (!progress.cleared[lv.id]) return no('not-rolled');
    if (!Number.isFinite(durationMs) || durationMs < lv.minMs) return no('too-fast');
    const p = JSON.parse(JSON.stringify(progress));
    const got = Math.max(0, Math.min(Array.isArray(lv.coins) ? lv.coins.length : 0, Math.floor(Number(coins) || 0)));
    const prev = p.walks[lv.id];
    const firstClear = !prev;
    const tier = walkTierForMs(lv, durationMs);
    const goldFirst = tier === 'gold' && !(prev && prev.gold);
    const coinsEarned = Math.max(0, got - (prev ? prev.coins : 0));
    const earned = (firstClear ? Math.round(basePayout(payouts, lv) * WALK.payShare) : 0) + coinsEarned + (goldFirst ? goldBonus(payouts, lv) : 0);
    p.wallet += earned;
    p.walks[lv.id] = { bestMs: prev ? Math.min(prev.bestMs, durationMs) : durationMs, coins: Math.max(prev ? prev.coins : 0, got), gold: !!(prev && prev.gold) || tier === 'gold' };
    return {
        progress: p,
        result: {
            accepted: true, walk: true, levelId: lv.id, firstClear, runMs: durationMs, bestMs: p.walks[lv.id].bestMs, prevBestMs: prev ? prev.bestMs : undefined,
            tier, goldFirst, earned, coinsEarned, wallet: p.wallet, highestIndex: p.highestIndex, prize: null, parMs: walkGoldMs(lv)
        }
    };
}

export function buyExplorer(progress, id) {
    const e = EXPLORER[id];
    return purchase(progress, e ? e.price : NaN, q => { q.explorer.push(id); },
        !e ? 'unknown' : progress.explorer.includes(id) ? 'owned' : null);
}

export function setComfort(progress, patch) {
    const p = JSON.parse(JSON.stringify(progress));
    p.comfort = cleanComfort({ ...progress.comfort, ...(patch || {}) });
    return { progress: p, ok: true };
}

// --- CLOUD SYNC: merging two saves of one player ------------------------------
// The same player's progress from two places (this device and the server, or
// two devices) becomes one, and NEVER by simply overwriting: what only grows --
// levels cleared, best times, things owned, XP, walks -- combines to the best
// of both; what is SPENT -- the coin wallet, power-ups, prize uses -- comes from
// the newer save (by savedAt), since adding two wallets would mint coins.
// Settings come from the newer save too. The server merges with this same
// function (server/), so both ends agree. Returns a clean, parsed progress.
export function mergeProgress(a, b) {
    const A = parseProgress(JSON.stringify(a || {})), B = parseProgress(JSON.stringify(b || {}));
    const aFresh = !(a && a.v), bFresh = !(b && b.v);
    if (aFresh) return B;
    if (bFresh) return A;
    const newer = (A.savedAt || 0) >= (B.savedAt || 0) ? A : B, older = newer === A ? B : A;
    const p = JSON.parse(JSON.stringify(newer));
    const union = (x, y) => [...x, ...y.filter(v => !x.includes(v))];
    p.highestIndex = Math.max(A.highestIndex, B.highestIndex);
    for (const [id, c] of Object.entries(older.cleared)) {
        const n = p.cleared[id];
        p.cleared[id] = n ? { bestMs: Math.min(n.bestMs, c.bestMs), coins: Math.max(n.coins, c.coins), at: Math.max(n.at || 0, c.at || 0) } : c;
    }
    for (const [id, w] of Object.entries(older.walks)) {
        const n = p.walks[id];
        p.walks[id] = n ? { bestMs: Math.min(n.bestMs, w.bestMs), coins: Math.max(n.coins, w.coins), gold: n.gold || w.gold } : w;
    }
    for (const key of ['goldClaimed', 'prizes', 'marbles', 'skins', 'trails', 'explorer', 'achievements']) p[key] = union(p[key], older[key]);
    for (const [id, n] of Object.entries(older.upgrades)) p.upgrades[id] = Math.max(p.upgrades[id] || 0, n);
    // A prize only the older save has earned brings its uses with it.
    for (const id of older.prizes) if (!newer.prizes.includes(id) && older.prizeUses[id]) p.prizeUses[id] = older.prizeUses[id];
    p.xp = A.xp === null && B.xp === null ? null : Math.max(A.xp || 0, B.xp || 0);
    p.levelPaid = Math.max(A.levelPaid, B.levelPaid);
    p.adCoinsAt = Math.max(A.adCoinsAt, B.adCoinsAt);
    p.adUpgradeAt = Math.max(A.adUpgradeAt, B.adUpgradeAt);
    // Daily things: the later day wins; the same day combines.
    if ((older.daily.last || '') > (p.daily.last || '')) p.daily = older.daily;
    else if (older.daily.last === p.daily.last && older.daily.doubled > p.daily.doubled) p.daily.doubled = older.daily.doubled;
    if (older.missions && (!p.missions || older.missions.date > p.missions.date)) p.missions = older.missions;
    else if (older.missions && p.missions && older.missions.date === p.missions.date && older.missions.ids.join() === p.missions.ids.join()) {
        for (const [id, n] of Object.entries(older.missions.counts)) p.missions.counts[id] = Math.max(p.missions.counts[id] || 0, n);
        p.missions.claimed = union(p.missions.claimed, older.missions.claimed);
        p.missions.bonus = p.missions.bonus || older.missions.bonus;
    }
    const od = older.dailyMaze, nd = p.dailyMaze;
    if (od && (!nd || od.date > nd.date)) p.dailyMaze = od;
    else if (od && nd && od.date === nd.date && od.id === nd.id) {
        p.dailyMaze = { ...nd, best: Math.min(nd.best ?? Infinity, od.best ?? Infinity), paid: nd.paid || od.paid, gold: nd.gold || od.gold };
        if (!Number.isFinite(p.dailyMaze.best)) p.dailyMaze.best = null;
    }
    p.savedAt = Math.max(A.savedAt || 0, B.savedAt || 0);
    return parseProgress(JSON.stringify(p));
}

// XP for clears made before player levels existed: what each would have
// earned (first clear, plus gold where gold was claimed). Paid through addXp,
// so the levels it crosses pay their rewards too.
export function backfillXp(progress, levels) {
    let xp = 0;
    for (const lv of levels || []) {
        if (!progress.cleared[lv.id]) continue;
        xp += XP.firstClear + XP.perWorld * (lv.world || 1);
        if (progress.goldClaimed.includes(lv.id)) xp += XP.goldFirst;
    }
    return levelUp.addXp({ ...progress, xp: 0 }, xp);
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
// Skins and trails: bought with coins, or given as a player-level reward
// (grantLook) -- a reward is never for sale. Buying one wears it.
export function buyLook(progress, kind, id) {
    const L = LOOKS[kind];
    const item = L && L.table[id];
    return purchase(progress, item && Number.isFinite(item.price) ? item.price : NaN,
        p => { p[L.owned].push(id); p[L.chosen] = id; },
        !item ? 'unknown' : progress[L.owned].includes(id) ? 'owned' : !Number.isFinite(item.price) ? 'reward' : null);
}
export function grantLook(progress, kind, id) {
    const L = LOOKS[kind];
    if (!L || !L.table[id] || progress[L.owned].includes(id)) return { progress, ok: false, reason: !L || !L.table[id] ? 'unknown' : 'owned' };
    const p = JSON.parse(JSON.stringify(progress));
    p[L.owned].push(id);
    return { progress: p, ok: true };
}
export function selectLook(progress, kind, id) {
    const L = LOOKS[kind];
    if (!L || !progress[L.owned].includes(id)) return { progress, ok: false, reason: 'not-owned' };
    const p = JSON.parse(JSON.stringify(progress));
    p[L.chosen] = id;
    return { progress: p, ok: true };
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
// A free upgrade step: the next tier of `id`, if it is cheap enough to be
// given away (AD_REWARDS.upgradeMaxPrice) and the cooldown is over.
export function adUpgradeEligible(progress, id) {
    const price = upgradePrice(progress, id);
    return price !== null && price <= AD_REWARDS.upgradeMaxPrice;
}
export function adUpgradeWaitMs(progress, now = Date.now()) {
    return Math.max(0, (progress.adUpgradeAt || 0) + AD_REWARDS.upgradeCooldownMs - now);
}
export function adUpgrade(progress, id, now = Date.now()) {
    if (!UPGRADES[id]) return { progress, ok: false, reason: 'unknown' };
    if (upgradePrice(progress, id) === null) return { progress, ok: false, reason: 'maxed' };
    if (!adUpgradeEligible(progress, id)) return { progress, ok: false, reason: 'too-dear' };
    if (adUpgradeWaitMs(progress, now) > 0) return { progress, ok: false, reason: 'cooldown' };
    const p = JSON.parse(JSON.stringify(progress));
    p.upgrades[id] = (p.upgrades[id] || 0) + 1;
    p.adUpgradeAt = now;
    return { progress: p, ok: true };
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
    // The clock the daily rules read; tests and the debug hooks move it.
    let clock = () => Date.now();
    // Levels gained and not yet shown: the home screen celebrates them.
    let levelUps = [];
    let dailyPool = [];
    const earn = (amount) => {
        const out = levelUp.addXp(progress, amount);
        progress = out.progress;
        levelUps.push(...out.gained);
        return out.gained;
    };
    // Listeners told after every save (cloud sync pushes from here).
    const saved = new Set();
    const persist = () => {
        progress = { ...progress, savedAt: Date.now() };
        try { adapter.save(SAVE_KEY, JSON.stringify(progress)); } catch (e) { console.warn('[progress] save failed:', e && e.message); }
        for (const fn of saved) { try { fn(progress); } catch (_) { /* a listener's problem is its own */ } }
    };
    const rollMissions = () => {
        const out = daily.missionsToday(progress, clock());
        if (out.rolled) { progress = out.progress; persist(); }
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
        // Cloud sync (cloudSync.js): be told of every save, and take in a save
        // from elsewhere -- merged, never overwritten (mergeProgress).
        onSave(fn) { saved.add(fn); return () => saved.delete(fn); },
        // Signed out or deleted (cloudSync.js): this device starts fresh. The
        // progress lives on in the account, not here.
        wipe() { progress = freshProgress(); levelUps = []; persist(); },
        adopt(remote) {
            const before = JSON.stringify(progress);
            const merged = mergeProgress(progress, remote);
            const xpUnknown = merged.xp === null;
            progress = merged;
            if (xpUnknown && levels.length) {
                const out = backfillXp(progress, levels);
                progress = out.progress;
                levelUps.push(...out.gained);
            }
            const changed = JSON.stringify(progress) !== before;
            if (changed) persist();
            return changed;
        },
        setLevels(nextLevels, nextPayouts) {
            levels = nextLevels || []; payouts = nextPayouts || {};
            if (progress.xp === null && levels.length) {
                const out = backfillXp(progress, levels);
                progress = out.progress;
                levelUps.push(...out.gained);
                persist();
            }
        },
        recordClear(levelId, durationMs, coins) {
            const prev = progress.cleared[levelId];
            const out = applyClear(progress, levels, payouts, levelId, durationMs, coins, clock());
            if (!out.result.accepted) return out.result;
            // Count the clear toward today's missions, and say which it finished.
            const lv = levels.find(l => l.id === levelId);
            const got = Math.max(0, Math.min(Array.isArray(lv.coins) ? lv.coins.length : 0, Math.floor(Number(coins) || 0)));
            const m = daily.trackMissions(out.progress, daily.clearEvents(lv, out.result, got, prev && prev.bestMs), clock());
            progress = m.progress;
            const xp = levelUp.clearXp(lv, out.result);
            const gained = earn(xp);
            persist();
            return { ...out.result, missionsDone: m.done, xp, levelUps: gained, wallet: progress.wallet };
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
        buyLook: (kind, id) => apply(buyLook(progress, kind, id)),
        selectLook: (kind, id) => apply(selectLook(progress, kind, id)),
        buyCharge: id => apply(buyCharge(progress, id)),
        buyPrizeRefill: id => apply(buyPrizeRefill(progress, id)),
        // A spent power-up also counts toward a "use power-ups" mission.
        useCharge: id => {
            const out = consume(progress, 'charges', id);
            if (out.ok) out.progress = daily.trackMissions(out.progress, { powerup: 1 }, clock()).progress;
            return apply(out).ok;
        },
        usePrize: id => apply(consume(progress, 'prizeUses', id)).ok,
        // Rewarded-ad payouts: call only once the ad has finished.
        adCoins: () => apply(adCoins(progress)),
        adCoinsWaitMs: () => adCoinsWaitMs(progress),
        adDoubleClear: earned => { const out = adDoubleClear(progress, earned); apply(out); return { ok: out.ok, amount: out.amount || 0 }; },
        adCharge: id => apply(adCharge(progress, id)),
        adUpgrade: id => apply(adUpgrade(progress, id)),
        adUpgradeEligible: id => adUpgradeEligible(progress, id),
        adUpgradeWaitMs: () => adUpgradeWaitMs(progress),
        // Daily rewards and missions (daily.js).
        dailyStatus: () => daily.dailyStatus(progress, clock()),
        claimDaily: () => {
            const out = daily.claimDaily(progress, clock());
            apply(out);
            if (out.ok) { earn(XP.dailyClaim); persist(); }
            return { ok: out.ok, day: out.day, reward: out.reward };
        },
        adDoubleDaily: () => { const out = daily.adDoubleDaily(progress, clock()); apply(out); return { ok: out.ok, amount: out.amount || 0 }; },
        // The day's set is saved the first time anything reads it, so what the
        // player is shown cannot change later in the day.
        missions: () => { rollMissions(); return daily.missionList(progress, clock()); },
        missionsReady: () => { rollMissions(); return daily.missionsReady(progress, clock()); },
        // The daily maze: the pool (dailyLevels.json), today's maze, a clear of it.
        setDailyLevels(pool) { dailyPool = Array.isArray(pool) ? pool : []; },
        dailyMaze: () => ({ ...daily.dailyMazeFor(progress, dailyPool, levels, clock()), unlockAfter: DAILY_MAZE.unlockAfter }),
        recordDailyClear(levelId, durationMs, coins) {
            const today = daily.dailyMazeFor(progress, dailyPool, levels, clock());
            if (!today.lv || today.lv.id !== levelId) return { accepted: false, levelId, reason: 'not-today', daily: true };
            const out = applyDailyClear(progress, today, durationMs, coins, clock());
            if (!out.result.accepted) return out.result;
            const r = out.result;
            const got = Math.max(0, Math.min(today.lv.coins ? today.lv.coins.length : 0, Math.floor(Number(coins) || 0)));
            const m = daily.trackMissions(out.progress, daily.clearEvents(today.lv, r, got, r.prevBestMs), clock());
            progress = m.progress;
            const xp = (r.firstClear ? XP.dailyMaze : XP.replayClear) + (r.goldFirst ? XP.goldFirst : 0);
            const gained = earn(xp);
            persist();
            return { ...r, missionsDone: m.done, xp, levelUps: gained, wallet: progress.wallet };
        },
        // Achievements (achievements.js): the list with progress, how many
        // wait to be claimed, and claiming one (pays its coins once).
        achievements: () => achievementList(progress, levels),
        achievementsReady: () => achievementsReady(progress, levels),
        claimAchievement: id => {
            const out = claimAchievement(progress, levels, id);
            if (out.ok) { progress = out.progress; persist(); }
            return { ok: out.ok, reason: out.reason || null, coins: out.coins || 0, wallet: progress.wallet };
        },
        claimMission: id => {
            const out = daily.claimMission(progress, id, clock());
            apply(out);
            if (out.ok) { earn(XP.mission + (out.bonus ? XP.missionsBonus : 0)); persist(); }
            return { ok: out.ok, reward: out.reward || 0, bonus: out.bonus || 0 };
        },
        msUntilTomorrow: () => daily.msUntilTomorrow(clock()),
        playerLevel: () => levelUp.levelInfo(progress.xp || 0),
        // The Labyrinth.
        recordWalkClear(levelId, durationMs, coins) {
            const out = applyWalkClear(progress, levels, payouts, levelId, durationMs, coins);
            if (!out.result.accepted) return out.result;
            const r = out.result;
            const lv = levels.find(l => l.id === levelId);
            const got = Math.max(0, Math.min(lv.coins ? lv.coins.length : 0, Math.floor(Number(coins) || 0)));
            const m = daily.trackMissions(out.progress, daily.clearEvents(lv, r, got, r.prevBestMs), clock());
            progress = m.progress;
            const xp = (r.firstClear ? XP.walkFirst : XP.walkReplay) + (r.goldFirst ? XP.goldFirst : 0);
            const gained = earn(xp);
            persist();
            return { ...r, missionsDone: m.done, xp, levelUps: gained, wallet: progress.wallet };
        },
        buyExplorer: id => apply(buyExplorer(progress, id)),
        setComfort: patch => { apply(setComfort(progress, patch)); return progress.comfort; },
        setBallCam(on) { progress = { ...progress, ballCam: !!on }; persist(); return progress.ballCam; },
        // Levels gained since the last call (each { level, reward }); the
        // caller shows them, so they are handed out once.
        takeLevelUps: () => { const out = levelUps; levelUps = []; return out; },
        setClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }
    };
}
