// COINS AND POWER-UPS -- the pure rules, with no three.js and no cannon, so
// they are checked in Node (test_maze_pickups.js) like the tilt and hazard
// math. mazeGame.js owns the meshes and the ball; this owns what counts.
//
// Level data (placed by scripts/generateMazeLevels.js, checked reachable and
// clear of holes by test_maze_levels.js):
//   coins:   [{ x, z }]
//   pickups: [{ x, z, kind }]   kind is a POWERUPS key
//
// POWER-UPS ARE CONTROL AND FORGIVENESS, never a way through the maze
// (docs/PLAN.md). None of them moves a wall, shrinks the ball or raises its
// top speed, so the verifier's guarantees and every gold time hold with or
// without them. Gold times are set without power-ups.
//
// A power-up arrives two ways: touched in the maze (it fires at once), or
// bought before the level (a CHARGE the player fires with a tap; a bought
// shield is simply armed from the start).

import { gateSweptSpec, distanceToRect, conveyorAt, windAt } from './mazeHazards.js';

export const COIN_RADIUS = 0.15;
export const PICKUP_RADIUS = 0.22;

export const POWERUPS = {
    // One free fall: instead of dropping, the ball is put back on the last
    // safe spot it rolled over. Lasts until used.
    shield: { durationMs: Infinity },
    // The whole world -- ball, gates, belts -- runs slower. The run timer does
    // not, so slow-mo is a steadier hand, not a faster time.
    slowmo: { durationMs: 6000, timeScale: 0.55 },
    // Coins within reach are collected from further away.
    magnet: { durationMs: 8000, reach: 1.6 }
};
export const POWERUP_KINDS = Object.keys(POWERUPS);

// A spot counts as SAFE for the shield to return the ball to when it is this
// many ball radii clear of every hole's rim. Returned there with no speed, the
// ball must not just roll back in.
const SAFE_CLEARANCE_R = 1.5;

// Fresh state for one attempt. `charges` are bought power-ups still unspent
// ({ slowmo: 1, ... }); a bought shield is armed immediately instead. `mods`
// are the player's upgrades (shopCatalog.js ballSetup): durationScale
// lengthens slow-mo and magnet, coinReach widens every coin pickup.
export function createRunPickups(level, charges = {}, mods = {}) {
    const held = {};
    for (const k of POWERUP_KINDS) if (k !== 'shield' && charges[k] > 0) held[k] = charges[k] | 0;
    return {
        coinsTaken: new Set(),
        pickupsTaken: new Set(),
        coins: 0,
        shield: charges.shield > 0,
        slowmoMs: 0,
        magnetMs: 0,
        held,
        durationScale: Number.isFinite(mods.durationScale) && mods.durationScale >= 1 ? mods.durationScale : 1,
        coinReach: Number.isFinite(mods.coinReach) && mods.coinReach >= 0 ? mods.coinReach : 0,
        safe: level && level.start ? { x: level.start.x, z: level.start.z } : { x: 0, z: 0 }
    };
}

export function activate(state, kind) {
    if (kind === 'shield') state.shield = true;
    else if (kind === 'slowmo') state.slowmoMs = POWERUPS.slowmo.durationMs * (state.durationScale || 1);
    else if (kind === 'magnet') state.magnetMs = POWERUPS.magnet.durationMs * (state.durationScale || 1);
}

// Fire a bought charge. Returns false if there is none left.
export function useCharge(state, kind) {
    if (!(state.held[kind] > 0)) return false;
    state.held[kind]--;
    activate(state, kind);
    return true;
}

// How fast the simulation should run this frame.
export function timeScale(state) {
    return state && state.slowmoMs > 0 ? POWERUPS.slowmo.timeScale : 1;
}

// One frame. `ball` is { x, z, r }; `dtMs` is REAL time (durations tick in
// real time, so slow-mo cannot stretch itself). Returns what happened, in
// order, for the renderer and the HUD:
//   { type: 'coin', index }  { type: 'pickup', index, kind }
export function stepPickups(state, level, ball, dtMs) {
    const events = [];
    state.slowmoMs = Math.max(0, state.slowmoMs - dtMs);
    state.magnetMs = Math.max(0, state.magnetMs - dtMs);

    // Pickups first, so a magnet works on the frame it is touched.
    (level.pickups || []).forEach((p, i) => {
        if (state.pickupsTaken.has(i) || !POWERUPS[p.kind]) return;
        if (Math.hypot(ball.x - p.x, ball.z - p.z) <= ball.r + PICKUP_RADIUS) {
            state.pickupsTaken.add(i);
            activate(state, p.kind);
            events.push({ type: 'pickup', index: i, kind: p.kind });
        }
    });

    const base = ball.r + COIN_RADIUS + (state.coinReach || 0);
    const coinReach = state.magnetMs > 0 ? Math.max(POWERUPS.magnet.reach, base) : base;
    (level.coins || []).forEach((c, i) => {
        if (state.coinsTaken.has(i)) return;
        if (Math.hypot(ball.x - c.x, ball.z - c.z) <= coinReach) {
            state.coinsTaken.add(i);
            state.coins++;
            events.push({ type: 'coin', index: i });
        }
    });
    if (isSafeSpot(level, ball.x, ball.z, ball.r)) state.safe = { x: ball.x, z: ball.z };
    return events;
}

// Safe to be put back on: clear of every hole by SAFE_CLEARANCE_R radii, not
// anywhere a gate can sweep (the ball would be dropped inside a closing bar),
// and not on a belt (it would carry the ball off before the player reacts).
export function isSafeSpot(level, x, z, r) {
    if (!(level.holes || []).every(h => Math.hypot(x - h.x, z - h.z) >= h.r + r * SAFE_CLEARANCE_R)) return false;
    if ((level.gates || []).some(g => distanceToRect(gateSweptSpec(g), x, z) < r * 1.1)) return false;
    if (conveyorAt(level.conveyors, x, z)) return false;
    // Nor in a gust, nor under an icicle: back on that spot, the next gust or
    // fall would undo the save before the player could act.
    if (windAt(level.fans, x, z)) return false;
    if ((level.icicles || []).some(ic => Math.hypot(x - ic.x, z - ic.z) < ic.r + r)) return false;
    // Nor on a lava seam, nor within a geyser's blast.
    if ((level.flares || []).some(f => distanceToRect(f, x, z) < r)) return false;
    if ((level.geysers || []).some(g => Math.hypot(x - g.x, z - g.z) < g.reach + r)) return false;
    return true;
}

// The ball has just gone over a hole. If a shield is armed, spend it and
// return where to put the ball back; otherwise null (the fall goes ahead).
export function absorbFall(state) {
    if (!state || !state.shield) return null;
    state.shield = false;
    return { x: state.safe.x, z: state.safe.z };
}
