// THE SURVEY (the user's call, 2026-10-10): how much of a level's floor a run
// has covered. The board is cut into squares (S units); a square counts if a
// ball can get to it (the shared grid, levelSpots.js: reachable from the
// start, round the holes), and is covered once the ball passes within SIGHT
// of its middle. A level is SURVEYED at 90% -- some slack for corners a
// careful player may not bother with, never a pixel hunt. The best a clear
// has reached is kept (`survey` in the save, by level id, merged by max).
//
// Pure: the squares, and a run's coverage state. test_survey.js checks every
// level has squares, the shortest route alone never surveys a level, and a
// sweep of the floor does.

import { levelGrid } from './levelSpots.js';

export const S = 0.5;              // a survey square's side
export const SIGHT = 0.55;         // how near the ball must pass a square's middle
export const SURVEYED = 90;        // percent

// A level's squares: { cols, rows, x0, z0, reach (1 where a ball can get to),
// total } (cached by level id).
const maps = new Map();
export function surveyMap(lv) {
    if (maps.has(lv.id)) return maps.get(lv.id);
    const g = levelGrid(lv);
    const W = lv.size.w, D = lv.size.d;
    const cols = Math.ceil(W / S), rows = Math.ceil(D / S);
    const x0 = -W / 2, z0 = -D / 2;
    const reach = new Uint8Array(cols * rows);
    let total = 0;
    // A square counts if any reachable grid cell lies within SIGHT of its
    // middle -- the same test a passing ball meets.
    for (let k = 0; k < g.pass.length; k++) {
        if (!g.pass[k] || !Number.isFinite(g.fromStart[k])) continue;
        const { x, z } = g.at(k);
        const c0 = Math.max(0, Math.floor((x - SIGHT - x0) / S)), c1 = Math.min(cols - 1, Math.floor((x + SIGHT - x0) / S));
        const r0 = Math.max(0, Math.floor((z - SIGHT - z0) / S)), r1 = Math.min(rows - 1, Math.floor((z + SIGHT - z0) / S));
        for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
            const i = c + r * cols;
            if (reach[i]) continue;
            const mx = x0 + (c + 0.5) * S, mz = z0 + (r + 0.5) * S;
            if ((x - mx) * (x - mx) + (z - mz) * (z - mz) <= SIGHT * SIGHT) { reach[i] = 1; total++; }
        }
    }
    const map = { cols, rows, x0, z0, reach, total };
    maps.set(lv.id, map);
    return map;
}

// A run's coverage: start one per attempt, mark the ball each frame.
export function createSurvey(lv) {
    const m = surveyMap(lv);
    const seen = new Uint8Array(m.cols * m.rows);
    let covered = 0;
    return {
        mark(x, z) {
            const c0 = Math.max(0, Math.floor((x - SIGHT - m.x0) / S)), c1 = Math.min(m.cols - 1, Math.floor((x + SIGHT - m.x0) / S));
            const r0 = Math.max(0, Math.floor((z - SIGHT - m.z0) / S)), r1 = Math.min(m.rows - 1, Math.floor((z + SIGHT - m.z0) / S));
            for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
                const i = c + r * m.cols;
                if (seen[i] || !m.reach[i]) continue;
                const mx = m.x0 + (c + 0.5) * S, mz = m.z0 + (r + 0.5) * S;
                if ((x - mx) * (x - mx) + (z - mz) * (z - mz) <= SIGHT * SIGHT) { seen[i] = 1; covered++; }
            }
        },
        // Whole percent, rounded down: 89.9 is not surveyed.
        get pct() { return m.total ? Math.min(100, Math.floor(100 * covered / m.total)) : 0; },
        get covered() { return covered; },
        total: m.total,
        seen
    };
}

// The best a save holds for a level, and whether that is a survey.
export const surveyOf = (progress, id) => Math.max(0, Math.min(100, Number(((progress && progress.survey) || {})[id]) || 0));
export const isSurveyed = (progress, id) => surveyOf(progress, id) >= SURVEYED;
