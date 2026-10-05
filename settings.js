// Player settings, kept on the device. Imports nothing.
//
// Tilt sensitivity's clamp must match mazeTilt.js's MIN_SENSITIVITY /
// MAX_SENSITIVITY (test_maze_tilt.js pins the pair), or a slider could offer a
// value the physics then silently ignores.

const MAZE_SENSITIVITY_KEY = 'marblerush_tilt_sensitivity';

export function getMazeSensitivity() {
    try {
        const raw = localStorage.getItem(MAZE_SENSITIVITY_KEY);
        if (raw === null) return 1.0;
        const n = parseFloat(raw);
        return Number.isFinite(n) ? Math.max(0.5, Math.min(2.0, n)) : 1.0;
    } catch (e) { return 1.0; }
}

export function setMazeSensitivity(v) {
    const n = Math.max(0.5, Math.min(2.0, Number(v) || 1));
    try { localStorage.setItem(MAZE_SENSITIVITY_KEY, String(n)); } catch (e) { /* private mode */ }
    return n;
}
