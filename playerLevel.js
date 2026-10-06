// PLAYER LEVEL -- a long arc over the whole game: XP for clears, golds,
// missions and daily claims (shopCatalog.js XP), levels from total XP, and a
// reward at each new level (LEVEL_REWARDS). Pure rules over the progress
// object, like daily.js; progressStore.js calls addXp wherever XP is earned.
//
// Rewards are LOOKS, coins and power-ups only (CLAUDE.md: nothing that makes
// the ball faster or smaller).

import { XP, LEVEL_REWARDS, LOOKS } from './shopCatalog.js';

const copy = p => JSON.parse(JSON.stringify(p));

// XP to go from level k to k+1, and the total XP that level L starts at.
export function xpStep(k) { return 100 + 50 * (k - 1); }
export function xpForLevel(L) { return L <= 1 ? 0 : 100 * (L - 1) + 25 * (L - 1) * (L - 2); }

export function levelForXp(xp) {
    let L = 1;
    while (xp >= xpForLevel(L + 1)) L++;
    return L;
}

// What the HUD shows: the level, XP into it, and XP the level needs.
export function levelInfo(xp) {
    const n = Math.max(0, Math.floor(Number(xp) || 0));
    const level = levelForXp(n);
    return { level, xp: n, into: n - xpForLevel(level), need: xpStep(level) };
}

// What reaching level L pays: coins always, plus that level's extras.
export function rewardFor(L) {
    const extra = LEVEL_REWARDS[L] || {};
    return { coins: 40 + 10 * L + (extra.coins || 0), charges: extra.charges || null, look: extra.look || null };
}

// The XP a clear earns, from progressStore.applyClear's result.
export function clearXp(lv, result) {
    if (!result || !result.accepted) return 0;
    return (result.firstClear ? XP.firstClear + XP.perWorld * (lv.world || 1) : XP.replayClear) + (result.goldFirst ? XP.goldFirst : 0);
}

// Add XP and pay every level it crosses. Returns { progress, gained: [{ level,
// reward }] } with progress a new object.
export function addXp(progress, amount) {
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    if (!n) return { progress, gained: [] };
    const p = copy(progress);
    const before = levelForXp(p.xp || 0);
    p.xp = (p.xp || 0) + n;
    const after = levelForXp(p.xp);
    const gained = [];
    for (let L = before + 1; L <= after; L++) {
        const r = rewardFor(L);
        p.wallet += r.coins;
        for (const [id, k] of Object.entries(r.charges || {})) p.charges[id] = (p.charges[id] || 0) + k;
        if (r.look) {
            const [kind, id] = r.look;
            const owned = LOOKS[kind].owned;
            if (!p[owned].includes(id)) p[owned].push(id);
        }
        gained.push({ level: L, reward: r });
    }
    return { progress: p, gained };
}
