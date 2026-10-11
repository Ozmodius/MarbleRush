// HOW A RUN ENDS, SHOWN (the user's call, 2026-10-11): what the marble does
// when a trap ends a run, instead of dropping through the floor and
// vanishing. Pure: fallPose(cause, ms, ctx) says where the drawn ball is and
// how it looks `ms` into the fall; mazeGame.js draws it (and fallFx3d.js the
// smoke, the ice and the sparks). DRAWING ONLY: the body is held still and
// the run restarts exactly as before.
//
//   hole    rolls on over the rim toward the middle, tips in and sinks -- the
//           floor hides what is below it, so from above it drops into the
//           dark -- shrinking and darkening as it goes
//   burn    glows orange, then chars black under a rising puff of smoke, and
//           sags a little into the floor
//   crush   squashed flat under the press in a blink, a ring of dust out
//   shock   crackles blue-white, jittering, then goes dull and grey
//   ice     frozen pale in a shell of ice that grows round it, then cracks
//
// ctx: { r: ball radius, vx, vz: its velocity when it went, hole: { x, z, r }
// relative to the ball (for `hole`), seed (for the jitter) }.
// Returns { dx, dy, dz, sx, sy, sz, dark (0-1), glow: [r, g, b, k] | null,
// smoke (0-1), shell (0-1), crack (0-1), dust (0-1), spark (0-1) }.

export const FALL_MS = 900;   // every effect is over by then (mazeGame.js FALL_RESTART_MS)
export const CAUSES = ['hole', 'burn', 'crush', 'shock', 'ice'];

const clamp01 = x => Math.max(0, Math.min(1, x));
const ease = t => t * t * (3 - 2 * t);           // smoothstep
const easeIn = t => t * t;

// The cause a knock-out message names (mazeGame.js FALL_CAUSE).
export function causeOf(fallCause) {
    return ({ hole: 'hole', flare: 'burn', molten: 'burn', crush: 'crush', shock: 'shock', icicle: 'ice' })[fallCause] || 'hole';
}

export function fallPose(cause, ms, ctx = {}) {
    const r = ctx.r || 0.2;
    const t = clamp01(ms / FALL_MS);
    const out = { dx: 0, dy: 0, dz: 0, sx: 1, sy: 1, sz: 1, dark: 0, glow: null, smoke: 0, shell: 0, crack: 0, dust: 0, spark: 0 };
    if (cause === 'hole') {
        // Over the rim toward the middle (its own momentum, then the slope of
        // the drop), then down: accelerating, as a fall does.
        const h = ctx.hole || { x: 0, z: 0, r: r * 1.5 };
        const toward = ease(clamp01(ms / 320));
        const carry = Math.min(1, ms / 1000) * 0.12;
        out.dx = h.x * toward + (ctx.vx || 0) * carry * (1 - toward);
        out.dz = h.z * toward + (ctx.vz || 0) * carry * (1 - toward);
        const down = easeIn(clamp01((ms - 120) / 560));
        out.dy = -down * r * 2.6;
        const s = 1 - 0.55 * down;
        out.sx = out.sy = out.sz = s;
        out.dark = clamp01(down * 1.15);
        return out;
    }
    if (cause === 'burn') {
        // Red-hot first (its own colour giving way to the glow), then the
        // glow dies as it chars black.
        const heat = ease(clamp01(ms / 260));
        const char = ease(clamp01((ms - 220) / 380));
        out.glow = [1, 0.32 * (1 - char) + 0.06, 0.03, 0.75 * heat * (1 - char)];
        out.dark = Math.max(0.65 * heat, 0.95 * char);
        out.smoke = clamp01((ms - 180) / 720);
        const sag = ease(clamp01((ms - 300) / 500));
        out.dy = -sag * r * 0.35;
        out.sy = 1 - 0.18 * sag;
        out.sx = out.sz = 1 + 0.06 * sag;
        return out;
    }
    if (cause === 'crush') {
        const flat = ease(clamp01(ms / 110));
        out.sy = 1 - 0.78 * flat;
        out.sx = out.sz = 1 + 0.55 * flat;
        out.dy = -(1 - out.sy) * r;          // the bottom stays on the floor
        out.dust = clamp01((ms - 60) / 600);
        out.dark = 0.25 * flat;
        return out;
    }
    if (cause === 'shock') {
        const live = 1 - ease(clamp01((ms - 380) / 300));
        // A stable crackle: the same seed shakes the same way every time.
        const seed = ctx.seed || 1;
        const k = Math.floor(ms / 33);
        const wob = (n) => Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453 % 1;
        const onset = clamp01(ms / 40);
        out.dx = wob(k) * r * 0.12 * live * onset;
        out.dz = wob(k + 101) * r * 0.12 * live * onset;
        const flash = (k % 3 === 0 ? 1 : 0.45) * live;
        out.glow = [0.55, 0.85, 1, flash];
        out.spark = live;
        out.dark = (1 - live) * 0.55;
        return out;
    }
    if (cause === 'ice') {
        out.shell = ease(clamp01(ms / 180));
        out.crack = ease(clamp01((ms - 520) / 300));
        out.glow = [0.75, 0.92, 1, 0.35 * out.shell];
        out.dark = 0;
        return out;
    }
    return out;
}
