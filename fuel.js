// FUEL CELLS (the user's call, 2026-10-10): Rolle's ship runs on them. Every
// ladder level hides one in its deepest dead end -- the spot that asks the
// biggest detour off the way to the exit -- found from the level itself
// (levelSpots.js), never stored in mazeLevels.json. A cell is banked when the
// level is cleared with it (like coins: a run that falls is worth nothing),
// and stays found.
//
// The ship needs a planet's cells to fly on: 3 of Sawturn's to reach
// Slipstonia, 5 of Slipstonia's for Magmars, 7 for every planet after. A
// planet the player has already played on stays open whatever their fuel
// (nobody who got there before fuel existed is locked out).
//
// Pure, so the progress store (and Node tests) can use it.

import { pickSpot } from './levelSpots.js';
import { isRescueLevel, captiveSpot } from './rescue.js';

export const FUEL_REACH = 0.42;              // centre to centre, as the cage
const NEED = { 2: 3, 3: 5 };
export const launchNeed = (world) => (world > 1 ? (NEED[world] || 7) : 0);

const LADDER = /^w(\d+)_(\d+)$/;
export const isLadderId = (id) => LADDER.test(String(id || ''));
const worldOfId = (id) => { const m = LADDER.exec(String(id || '')); return m ? +m[1] : 0; };

// How many of a planet's cells the save holds.
export function fuelCount(progress, world) {
    return ((progress && progress.fuel) || []).filter(id => worldOfId(id) === world).length;
}

// The fuel gate on a planet's first level: { need, have, from } when the
// ship cannot fly there yet, else null. A planet already played on is open.
export function fuelGate(progress, lv) {
    if (!lv || !Number.isInteger(lv.world) || lv.world < 2 || lv.index !== (lv.world - 1) * 10 + 1) return null;
    const played = Object.keys((progress && progress.cleared) || {}).some(id => worldOfId(id) === lv.world);
    if (played) return null;
    const need = launchNeed(lv.world), have = fuelCount(progress, lv.world - 1);
    return have >= need ? null : { need, have, from: lv.world - 1 };
}

// Where a level's cell sits: { x, z, detour, route }, or null.
const cache = new Map();
export function fuelSpot(lv) {
    if (!lv || !isLadderId(lv.id)) return null;
    if (cache.has(lv.id)) return cache.get(lv.id);
    const cage = isRescueLevel(lv) ? captiveSpot(lv) : null;
    const away = cage ? [{ x: cage.x, z: cage.z, d: 1.6 }] : [];
    // The deepest dead end: the longest detour, up to the route's own length.
    const out = pickSpot(lv, { bands: [[0.15, 1.0], [0.05, 1.0]], score: ({ detour }) => detour, away });
    cache.set(lv.id, out);
    return out;
}
