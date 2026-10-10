import { MARBLE_IDS, UPGRADES, DAILY_CALENDAR } from './shopCatalog.js';
import { levelForXp } from './playerLevel.js';

// ACHIEVEMENTS: one-off goals across the whole game, each paying coins once
// when the player claims it (the REWARDS panel, dailyUi.js).
//
// Progress toward each is READ from the save as it already is (clears, golds,
// world prizes, walks, XP, ...), never counted separately: nothing new to keep
// in step, old saves arrive with their achievements already earned, and two
// devices merging their saves merge their achievements for free. The only
// new save field is which ones have been CLAIMED (progress.achievements, a
// list of ids, merged as a union by mergeProgress).
//
// Ids are permanent: renaming one would let it be claimed twice. Pay is kept
// modest -- the whole list totals about what a dozen first clears pay
// (mazeLevels.json pays 120-360 each), so the shop stays earned by playing.

const clears = p => Object.keys(p.cleared || {}).length;
const golds = p => (p.goldClaimed || []).length;
const worlds = p => (p.prizes || []).length;
const explored = p => Object.keys(p.walks || {}).length;
const allCoins = (p, levels) => (levels || []).filter(lv => {
    const c = p.cleared && p.cleared[lv.id];
    const n = Array.isArray(lv.coins) ? lv.coins.length : 0;
    return c && n > 0 && c.coins >= n;
}).length;
const playerLevel = p => levelForXp(p.xp || 0);
const marbles = p => (p.marbles || []).filter(id => MARBLE_IDS.includes(id)).length;
const maxedUpgrade = p => Object.entries(p.upgrades || {}).some(([id, n]) => UPGRADES[id] && n >= UPGRADES[id].prices.length) ? 1 : 0;
const fuelCells = p => (p.fuel || []).length;
const surveyed = p => Object.values(p.survey || {}).filter(n => n >= 90).length;
const friends = p => (p.rescued || []).length;
const fullWeek = p => ((p.daily && p.daily.streak) || 0) >= DAILY_CALENDAR.length ? 1 : 0;

export const ACHIEVEMENTS = [
    { id: 'clear1', name: 'First Roll', text: 'Clear your first level', goal: 1, coins: 25, count: clears },
    { id: 'clear10', name: 'On a Roll', text: 'Clear 10 levels', goal: 10, coins: 75, count: clears },
    { id: 'clear25', name: 'Halfway Home', text: 'Clear 25 levels', goal: 25, coins: 150, count: clears },
    { id: 'clear50', name: 'Ladder Master', text: 'Clear 50 levels', goal: 50, coins: 300, count: clears },
    { id: 'gold1', name: 'Golden Touch', text: 'Win a gold medal', goal: 1, coins: 25, count: golds },
    { id: 'gold10', name: 'Gold Standard', text: 'Win 10 gold medals', goal: 10, coins: 100, count: golds },
    { id: 'gold25', name: 'Gilded', text: 'Win 25 gold medals', goal: 25, coins: 200, count: golds },
    { id: 'gold50', name: 'Solid Gold', text: 'Win gold on 50 levels', goal: 50, coins: 400, count: golds },
    { id: 'world1', name: 'Planet Hopper', text: 'Finish a world', goal: 1, coins: 50, count: worlds },
    { id: 'world3', name: 'Star Sailor', text: 'Finish 3 worlds', goal: 3, coins: 150, count: worlds },
    { id: 'world5', name: 'Solar Champion', text: 'Finish all 5 worlds', goal: 5, coins: 300, count: worlds },
    { id: 'coins5', name: 'Coin Collector', text: 'Take every coin in 5 levels', goal: 5, coins: 50, count: allCoins },
    { id: 'coins20', name: 'Treasure Hunter', text: 'Take every coin in 20 levels', goal: 20, coins: 150, count: allCoins },
    { id: 'explore1', name: 'Explorer', text: 'Explore a level from the inside', goal: 1, coins: 25, count: explored },
    { id: 'explore10', name: 'Pathfinder', text: 'Explore 10 levels', goal: 10, coins: 100, count: explored },
    { id: 'explore25', name: 'Cartographer', text: 'Explore 25 levels', goal: 25, coins: 200, count: explored },
    { id: 'week', name: 'Full Week', text: 'Claim all 7 days of daily rewards in a row', goal: 1, coins: 100, count: fullWeek },
    { id: 'level5', name: 'Rising Star', text: 'Reach player level 5', goal: 5, coins: 50, count: playerLevel },
    { id: 'level10', name: 'Veteran', text: 'Reach player level 10', goal: 10, coins: 150, count: playerLevel },
    { id: 'level15', name: 'Legend', text: 'Reach player level 15', goal: 15, coins: 250, count: playerLevel },
    { id: 'marbles', name: 'Full Set', text: `Own all ${MARBLE_IDS.length} marbles`, goal: MARBLE_IDS.length, coins: 150, count: marbles },
    { id: 'tuned', name: 'Fully Tuned', text: 'Max out an upgrade', goal: 1, coins: 75, count: maxedUpgrade },
    // Exploring (the user's call, 2026-10-10): fuel cells, surveys, friends.
    { id: 'fuel10', name: 'Fuel Run', text: 'Find 10 fuel cells', goal: 10, coins: 50, count: fuelCells },
    { id: 'fuel50', name: 'Full Tank', text: 'Find all 50 fuel cells', goal: 50, coins: 200, count: fuelCells },
    { id: 'survey1', name: 'Surveyor', text: 'Survey a whole level (90% of its floor)', goal: 1, coins: 25, count: surveyed },
    { id: 'survey10', name: 'Mapmaker', text: 'Survey 10 levels', goal: 10, coins: 100, count: surveyed },
    { id: 'rescue5', name: "Baron's Bane", text: 'Free all five of Rolle\'s friends', goal: 5, coins: 150, count: friends }
];
export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map(a => a.id);

// Every achievement with where the player stands: { id, name, text, goal,
// coins, count (capped at goal), done, claimed }. Ready-to-claim first, then
// unfinished by how close, then claimed.
export function achievementList(progress, levels) {
    const claimed = new Set(progress.achievements || []);
    const rows = ACHIEVEMENTS.map(a => {
        const count = Math.min(a.goal, Math.max(0, a.count(progress, levels) || 0));
        return { id: a.id, name: a.name, text: a.text, goal: a.goal, coins: a.coins, count, done: count >= a.goal, claimed: claimed.has(a.id) };
    });
    const rank = r => (r.claimed ? 2 : r.done ? 0 : 1);
    return rows
        .map((r, i) => ({ r, i }))
        .sort((x, y) => rank(x.r) - rank(y.r) || (rank(x.r) === 1 ? y.r.count / y.r.goal - x.r.count / x.r.goal : 0) || x.i - y.i)
        .map(x => x.r);
}

export function achievementsReady(progress, levels) {
    return achievementList(progress, levels).filter(r => r.done && !r.claimed).length;
}

// Claim one: pays its coins once. { ok, progress, coins } or { ok: false, reason }.
export function claimAchievement(progress, levels, id) {
    const row = achievementList(progress, levels).find(r => r.id === id);
    if (!row) return { ok: false, reason: 'unknown' };
    if (row.claimed) return { ok: false, reason: 'claimed' };
    if (!row.done) return { ok: false, reason: 'not-done' };
    const p = { ...progress, wallet: progress.wallet + row.coins, achievements: [...(progress.achievements || []), id] };
    return { ok: true, progress: p, coins: row.coins };
}

export function parseAchievements(raw) {
    return Array.isArray(raw) ? raw.filter((id, i, a) => ACHIEVEMENT_IDS.includes(id) && a.indexOf(id) === i) : [];
}
