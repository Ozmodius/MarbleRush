// DAILY REWARDS AND MISSIONS -- the reasons to come back tomorrow.
//
// Pure rules over the progress object (progressStore.js), like the shop's:
// each takes the progress and a clock, and returns { progress, ok, ... } with
// a NEW progress object, or the input unchanged when ok is false. The store
// wraps them and saves; test_progress_store.js checks them in Node.
//
// "A day" is the player's LOCAL calendar day: a reward that turned over at
// midnight UTC would turn over mid-afternoon for half the world. With no
// server, a player who winds their clock forward only cheats themselves
// (docs/PLAN.md: nothing is competitive); the rules just keep the HONEST game
// from double-paying.

import { DAILY_CALENDAR, MISSIONS, MISSIONS_PER_DAY, MISSIONS_BONUS, DAILY_MAZE, CHARGES } from './shopCatalog.js';

const copy = p => JSON.parse(JSON.stringify(p));

// 'YYYY-MM-DD' for the local day `now` falls in, and for the day before it.
// The day before is stepped by calendar date, not by 24 hours, so a daylight
// saving change cannot skip or repeat a day.
export function dayKey(now) {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function previousDayKey(now) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return dayKey(d.getTime());
}
// Milliseconds until the next local midnight: when a new day's reward and
// missions arrive.
export function msUntilTomorrow(now) {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    return Math.max(0, d.getTime() - now);
}

// A count of local calendar days: consecutive days differ by exactly 1,
// whatever daylight saving does to the hours between them.
export function dayNumber(now) {
    const d = new Date(now);
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

// --- the daily maze -------------------------------------------------------------
// Today's maze for this player: from the worlds they have reached (the world
// of their next ladder level and every one before it), taking turns by day,
// and within a world working through its pool. `pool` is dailyLevels.json's
// levels, `ladder` mazeLevels.json's.
export function dailyMazeFor(progress, pool, ladder, now) {
    const cleared = progress.highestIndex || 0;
    const locked = cleared < DAILY_MAZE.unlockAfter;
    const next = (ladder || []).find(l => l.index === cleared + 1) || (ladder || [])[ladder.length - 1];
    const reach = next ? next.world : 1;
    const worlds = [...new Set((pool || []).map(l => l.world))].filter(w => w <= reach).sort((a, b) => a - b);
    if (!worlds.length) return { lv: null, locked, date: dayKey(now) };
    const n = dayNumber(now);
    const w = worlds[n % worlds.length];
    const inWorld = pool.filter(l => l.world === w);
    const lv = inWorld[Math.floor(n / worlds.length) % inWorld.length];
    const date = dayKey(now);
    const dm = progress.dailyMaze && progress.dailyMaze.date === date && progress.dailyMaze.id === lv.id ? progress.dailyMaze : null;
    return { lv, locked, date, best: dm ? dm.best : null, paid: !!(dm && dm.paid), gold: !!(dm && dm.gold) };
}

export function parseDailyMaze(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.date !== 'string' || typeof raw.id !== 'string') return null;
    return { date: raw.date, id: raw.id, best: Number.isFinite(raw.best) ? raw.best : null, paid: !!raw.paid, gold: !!raw.gold };
}

// --- the 7-day calendar ------------------------------------------------------
// progress.daily = { streak: day last claimed (1..7, 0 = never),
//                    last: dayKey of that claim, doubled: dayKey of the last ×2 }
export function dailyStatus(progress, now) {
    const d = progress.daily || {};
    const today = dayKey(now);
    const claimed = d.last === today;
    const continues = d.last === previousDayKey(now);
    // The day to claim today (or the one claimed today). A streak continues only
    // from yesterday; anything else -- a missed day, a first visit, a clock
    // that went backwards -- starts the week over.
    const day = claimed ? d.streak : continues ? (d.streak % DAILY_CALENDAR.length) + 1 : 1;
    return {
        day,
        claimed,
        canClaim: !claimed,
        canDouble: claimed && d.doubled !== today && (DAILY_CALENDAR[day - 1].coins || 0) > 0,
        reward: DAILY_CALENDAR[day - 1],
        // A streak that was running and is about to restart: worth saying.
        restarted: !claimed && !continues && (d.streak || 0) > 0
    };
}

// What tomorrow brings, for saying so (2026-10-09): the calendar day after
// today's -- once today is claimed, the streak goes on to it; before then it
// is the day after today's claim. After day 7 the week starts again.
export function tomorrowDaily(progress, now) {
    const s = dailyStatus(progress, now);
    const day = (s.day % DAILY_CALENDAR.length) + 1;
    return { day, reward: DAILY_CALENDAR[day - 1], big: day === DAILY_CALENDAR.length };
}

// A reward in words: "80 coins", "50 coins + Shield", "300 coins + 3 power-ups".
export function rewardText(reward) {
    const parts = [];
    if (reward && reward.coins) parts.push(`${reward.coins} coins`);
    const charges = Object.entries((reward && reward.charges) || {});
    const n = charges.reduce((t, [, k]) => t + k, 0);
    if (n === 1) parts.push(CHARGES[charges[0][0]] ? CHARGES[charges[0][0]].name : charges[0][0]);
    else if (n > 1) parts.push(`${n} power-ups`);
    return parts.join(' + ');
}

export function claimDaily(progress, now) {
    const s = dailyStatus(progress, now);
    if (!s.canClaim) return { progress, ok: false, reason: 'claimed' };
    const p = copy(progress);
    p.wallet += s.reward.coins || 0;
    for (const [id, n] of Object.entries(s.reward.charges || {})) p.charges[id] = (p.charges[id] || 0) + n;
    p.daily = { ...(p.daily || {}), streak: s.day, last: dayKey(now) };
    return { progress: p, ok: true, day: s.day, reward: s.reward };
}

// Today's coins again, for a rewarded ad watched after claiming. Once a day.
export function adDoubleDaily(progress, now) {
    const s = dailyStatus(progress, now);
    if (!s.canDouble) return { progress, ok: false, reason: s.claimed ? 'doubled' : 'unclaimed' };
    const p = copy(progress);
    const amount = s.reward.coins || 0;
    p.wallet += amount;
    p.daily = { ...p.daily, doubled: dayKey(now) };
    return { progress: p, ok: true, amount };
}

// --- daily missions ------------------------------------------------------------
// progress.missions = { date: dayKey, ids: [3 mission ids], counts: { id: n },
//                       claimed: [ids], bonus: true once the set's bonus paid }

// A small string hash, so the same date always draws the same missions (a
// reload cannot re-roll a day's set).
function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

function eligible(progress, id) {
    const need = MISSIONS[id].needs;
    if (need === 'cleared') return Object.keys(progress.cleared || {}).length > 0;
    if (need === 'charges') return Object.values(progress.charges || {}).reduce((a, n) => a + n, 0) >= MISSIONS[id].goal;
    return true;
}

export function drawMissions(progress, date) {
    const pool = Object.keys(MISSIONS).filter(id => eligible(progress, id));
    const picked = [];
    let seed = hash(date);
    while (picked.length < MISSIONS_PER_DAY && pool.length) {
        seed = Math.imul(seed ^ (seed >>> 15), 2246822519) >>> 0;
        picked.push(pool.splice(seed % pool.length, 1)[0]);
    }
    return picked;
}

// Today's set: the saved one if it is today's, else a fresh draw. Returns
// { progress, rolled } -- rolled is true when a new day replaced the set, so
// the store knows to save.
export function missionsToday(progress, now) {
    const date = dayKey(now);
    const m = progress.missions;
    if (m && m.date === date && Array.isArray(m.ids)) return { progress, rolled: false };
    const p = copy(progress);
    p.missions = { date, ids: drawMissions(progress, date), counts: {}, claimed: [], bonus: false };
    return { progress: p, rolled: true };
}

// Each mission as the UI shows it.
export function missionList(progress, now) {
    const { progress: p } = missionsToday(progress, now);
    const m = p.missions;
    return m.ids.map(id => {
        const def = MISSIONS[id];
        const count = Math.min(def.goal, m.counts[id] || 0);
        const claimed = m.claimed.includes(id);
        return { id, text: def.text, goal: def.goal, reward: def.reward, count, done: count >= def.goal, claimed };
    });
}

// How many finished missions wait to be claimed: the HOME badge.
export function missionsReady(progress, now) {
    return missionList(progress, now).filter(x => x.done && !x.claimed).length;
}

// Count what just happened toward today's missions. `events` is
// { clears, coins, silver, gold, sweep, best, powerup } -- any subset, each a
// count. Returns { progress, done: [ids this pushed over their goal] }.
export function trackMissions(progress, events, now) {
    const { progress: base } = missionsToday(progress, now);
    const p = copy(base);
    const m = p.missions;
    const done = [];
    for (const id of m.ids) {
        const n = Math.floor(Number(events[id]) || 0);
        if (n <= 0) continue;
        const before = m.counts[id] || 0;
        m.counts[id] = Math.min(MISSIONS[id].goal, before + n);
        if (before < MISSIONS[id].goal && m.counts[id] >= MISSIONS[id].goal) done.push(id);
    }
    return { progress: p, done };
}

// The events one accepted clear counts for. `prevBestMs` is the level's best
// BEFORE this run (undefined on a first clear).
export function clearEvents(lv, result, coinsGot, prevBestMs) {
    const maxCoins = Array.isArray(lv && lv.coins) ? lv.coins.length : 0;
    return {
        clears: 1,
        coins: coinsGot,
        silver: result.tier === 'gold' || result.tier === 'silver' ? 1 : 0,
        gold: result.tier === 'gold' ? 1 : 0,
        sweep: maxCoins > 0 && coinsGot >= maxCoins ? 1 : 0,
        best: Number.isFinite(prevBestMs) && result.runMs < prevBestMs ? 1 : 0
    };
}

export function claimMission(progress, id, now) {
    const { progress: base } = missionsToday(progress, now);
    const m = base.missions;
    if (!m.ids.includes(id)) return { progress, ok: false, reason: 'unknown' };
    if (m.claimed.includes(id)) return { progress, ok: false, reason: 'claimed' };
    if ((m.counts[id] || 0) < MISSIONS[id].goal) return { progress, ok: false, reason: 'unfinished' };
    const p = copy(base);
    p.missions.claimed.push(id);
    let reward = MISSIONS[id].reward;
    let bonus = 0;
    if (!p.missions.bonus && p.missions.ids.every(x => p.missions.claimed.includes(x))) {
        bonus = MISSIONS_BONUS;
        p.missions.bonus = true;
    }
    p.wallet += reward + bonus;
    return { progress: p, ok: true, reward, bonus };
}

// Read a saved daily/missions block back, keeping only what makes sense.
export function parseDaily(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const key = v => (typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) ? v : '');
    const streak = Math.floor(Number(d.streak) || 0);
    return { streak: streak >= 1 && streak <= DAILY_CALENDAR.length ? streak : 0, last: key(d.last), doubled: key(d.doubled) };
}
export function parseMissions(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.date !== 'string' || !Array.isArray(raw.ids)) return null;
    const ids = raw.ids.filter(id => MISSIONS[id]).slice(0, MISSIONS_PER_DAY);
    const counts = {};
    for (const id of ids) {
        const n = Math.floor(Number(raw.counts && raw.counts[id]) || 0);
        if (n > 0) counts[id] = Math.min(MISSIONS[id].goal, n);
    }
    const claimed = Array.isArray(raw.claimed) ? raw.claimed.filter(id => ids.includes(id)) : [];
    return { date: raw.date, ids, counts, claimed, bonus: !!raw.bonus };
}
