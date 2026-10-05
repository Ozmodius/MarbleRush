// THE PROGRESS STORE -- what Ball Smack's server did for the maze, on the device.
//
// In Ball Smack the maze reported a clear over the socket and the SERVER kept the
// ledger, because Bearings there are a shared economy. Marble Rush has no server
// (docs/PLAN.md, "No server"): nothing is competitive and no money changes hands,
// so a player who edits their save only cheats themselves. The ledger therefore
// lives here, with the server's own rules kept intact, because they are still
// what makes the economy computable:
//
//   1. the level exists;
//   2. LADDER -- level.index <= highestIndex + 1;
//   3. DURATION -- within [level.minMs, MAX_RUN_MS] (keeps nonsense out of the
//      best-time table; not anti-cheat any more);
//   4. IDEMPOTENT -- only a first clear pays; a replay can only improve bestMs;
//      the gold bonus pays once ever.
//
// `applyClear` is PURE (no storage, no clock it doesn't get passed) so the rules
// are testable in Node -- test_progress_store.js. The rest of the file is the
// load/save plumbing around it.

import { readSave, writeSave } from './platform.js';

export const SAVE_KEY = 'marblerush_save';
export const SAVE_VERSION = 1;
export const MAX_RUN_MS = 10 * 60 * 1000;

export function emptyProgress() {
    return { v: SAVE_VERSION, coins: 0, maze: { cleared: {}, goldClaimed: [], highestIndex: 0 } };
}

// Repair anything a hand-edited or half-written save could hold, field by field,
// rather than throwing the whole save away over one bad value.
export function normalizeProgress(raw) {
    const p = emptyProgress();
    if (!raw || typeof raw !== 'object') return p;
    if (Number.isFinite(raw.coins) && raw.coins >= 0) p.coins = Math.floor(raw.coins);
    const m = raw.maze && typeof raw.maze === 'object' ? raw.maze : {};
    if (m.cleared && typeof m.cleared === 'object') {
        for (const [id, e] of Object.entries(m.cleared)) {
            if (e && Number.isFinite(e.bestMs)) p.maze.cleared[id] = { at: Number(e.at) || 0, bestMs: Math.round(e.bestMs) };
        }
    }
    if (Array.isArray(m.goldClaimed)) p.maze.goldClaimed = m.goldClaimed.filter(x => typeof x === 'string');
    if (Number.isFinite(m.highestIndex) && m.highestIndex >= 0) p.maze.highestIndex = Math.floor(m.highestIndex);
    return p;
}

export function tierFor(level, ms) {
    if (!level || !Number.isFinite(ms)) return null;
    if (ms <= level.goldMs) return 'gold';
    if (ms <= level.goldMs * 1.5) return 'silver';
    if (ms <= level.goldMs * 2.25) return 'bronze';
    return null;
}

export function basePayout(payouts, level) {
    const v = Number(((payouts && payouts.byWorld) || {})[String(level && level.world)]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export function goldBonus(payouts, level) {
    const b = basePayout(payouts, level) * (Number(payouts && payouts.goldBonusPct) || 0);
    return Number.isFinite(b) && b > 0 ? Math.round(b) : 0;
}

// Apply one reported clear to `progress` IN PLACE. Returns either
// { ok: false, error } with progress untouched, or the same result shape Ball
// Smack's mazeClearAccepted carried, so mazeGame.js's banner code is unchanged.
export function applyClear(progress, level, durationMs, payouts, now) {
    if (!level) return { ok: false, error: 'Unknown maze level.' };
    const maze = progress.maze;
    if (level.index > maze.highestIndex + 1) return { ok: false, error: 'Finish the earlier levels first.' };
    if (!Number.isFinite(durationMs) || durationMs < level.minMs || durationMs > MAX_RUN_MS) {
        return { ok: false, error: 'That run time could not be counted.' };
    }

    const runMs = Math.round(durationMs);
    const tier = tierFor(level, runMs);
    const prior = maze.cleared[level.id];
    const firstClear = !prior;
    let earned = 0;
    if (firstClear) {
        maze.cleared[level.id] = { at: now, bestMs: runMs };
        maze.highestIndex = Math.max(maze.highestIndex, level.index);
        earned += basePayout(payouts, level);
    } else if (runMs < prior.bestMs) {
        prior.bestMs = runMs;
    }
    let goldFirst = false;
    if (tier === 'gold' && !maze.goldClaimed.includes(level.id)) {
        maze.goldClaimed.push(level.id);
        goldFirst = true;
        earned += goldBonus(payouts, level);
    }
    progress.coins += earned;

    return {
        ok: true, levelId: level.id, runMs, bestMs: maze.cleared[level.id].bestMs,
        highestIndex: maze.highestIndex, tier, firstClear, goldFirst, earned, wallet: progress.coins
    };
}

// ---------------------------------------------------------------------------
// The live store
// ---------------------------------------------------------------------------

let progress = emptyProgress();
let loaded = false;

export async function loadProgress() {
    let raw = null;
    try { const text = await readSave(SAVE_KEY); raw = text ? JSON.parse(text) : null; }
    catch (e) { console.warn('[progress] save unreadable, starting fresh:', e && e.message); }
    progress = normalizeProgress(raw);
    loaded = true;
    return progress;
}

export function getProgress() { return progress; }
export function isProgressLoaded() { return loaded; }

function persist() {
    try { writeSave(SAVE_KEY, JSON.stringify(progress)); }
    catch (e) { console.warn('[progress] save failed:', e && e.message); }
}

// Record a clear and save it. The ledger write and the save happen together, so
// a reload can never show a payout without the clear that earned it.
export function recordClear(level, durationMs, payouts) {
    const res = applyClear(progress, level, durationMs, payouts, Date.now());
    if (res.ok) persist();
    return res;
}
