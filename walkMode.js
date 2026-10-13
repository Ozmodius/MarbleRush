// THE LABYRINTH -- walking a level in first person (docs/PLAN.md phase 3).
//
// The walker IS the ball's physics body: the same radius the level verifier
// proved fits every corridor with room to spare, the same contact with gates,
// the same fall into a hole, the same pushes from belts, wind and magnets.
// Only two things change: gravity stays straight down (no tilt), and the body
// is driven toward a walking velocity from the joystick/keys, with a capped
// acceleration that out-pulls every trap's push (shopCatalog.js WALK). The
// camera sits at eye height inside it, below the wall tops, so the maze is a
// real labyrinth: you cannot see over it.
//
// This file holds the movement math (pure, tested by test_walk.js) and the
// input controller (touch joystick + drag-look, WASD/arrows + mouse-look).
// mazeGame.js owns the run and asks it each frame what to do.

import { WALK, MARBLES } from './shopCatalog.js';
import { contentPoint } from './portraitLock.js';

export const EYE_ABOVE_CENTRE = 0.12;   // eye height over the body's centre (walls are 0.55 tall)
export const PITCH_MAX = 0.9;           // radians: look most of the way down or up
// LOOK SPEED (the user's call, 2026-10-12: "turning a corner and keeping
// the right camera angle is very frustrating"). A drag is scaled to the
// screen: across the whole look side (the right 55% of the page) turns half
// round at sensitivity 1, so a phone turns a corner in one short swipe (a
// fixed 0.0055 rad/px needed ~285 px for 90 degrees, more than a phone's
// look side). Never slower than that on a wide screen. Up and down are
// gentler: a sideways swipe should not tip the view.
export const LOOK_SIDE = 0.55;
export const LOOK_MIN_RAD_PER_PX = 0.0055;
export const LOOK_PITCH_SHARE = 0.5;
export function lookRadPerPx(pageW) {
    const w = Number(pageW) > 0 ? Number(pageW) : 0;
    return w ? Math.max(LOOK_MIN_RAD_PER_PX, Math.PI / (LOOK_SIDE * w)) : LOOK_MIN_RAD_PER_PX;
}
const KEY_TURN_RAD_S = 3.0;             // arrow-key turning, at sensitivity 1 (90 degrees in about half a second)
const STICK_FULL_PX = 55;               // joystick drag for full speed

// Facing: yaw 0 looks toward -z (up the board in the overhead view); yaw grows
// turning LEFT. Forward and right on the floor for a yaw:
export function forwardOf(yaw) { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }
export function rightOf(yaw) { return { x: Math.cos(yaw), z: -Math.sin(yaw) }; }
// The yaw that looks from (ax, az) toward (bx, bz).
export function yawToward(ax, az, bx, bz) { return Math.atan2(-(bx - ax), -(bz - az)); }

// The floor velocity the controls ask for: `move` is { fwd, strafe } in
// -1..1 (clamped to a unit circle, so diagonals are not faster).
export function wantedVelocity(move, yaw, speed = WALK.speed) {
    let f = move.fwd || 0, s = move.strafe || 0;
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const F = forwardOf(yaw), R = rightOf(yaw);
    return { x: (F.x * f + R.x * s) * speed, z: (F.z * f + R.z * s) * speed };
}

// One physics step of walking: the change in floor velocity that moves `v`
// toward `want`, never more than WALK.accel * dt. Added to the body's velocity
// BEFORE the world steps, so a trap's push (added on its own) still acts --
// the walker leans into it rather than ignoring it.
export function walkImpulse(v, want, dt, accel = WALK.accel) {
    const dx = want.x - v.x, dz = want.z - v.z;
    const d = Math.hypot(dx, dz);
    const max = accel * dt;
    if (d <= max || d === 0) return { x: dx, z: dz };
    return { x: dx / d * max, z: dz / d * max };
}

// HANDLING: the marble and its upgrades, carried into Explore. Each stat does
// here what its blurb promises when rolling (shopCatalog.js), and none of it
// touches top speed (WALK.speed, the same for every marble) or the radius:
//   drive     how hard it pushes toward the speed asked for (grip, with the
//             crew's tuned steps): quicker off the mark, tighter turns. Classic is the
//             tuned WALK.accel; never below minDrive, which beats twice the
//             strongest trap push (test_walk.js), on ice too.
//   brake     how hard it stops with nothing held (damping, with tuned
//             stopping). Classic coasts about half a second; Sterling, Cinder
//             and Rivet stop much shorter, up to nearly dead (maxBrake). Braking is
//             only ever with nothing held, so it never decides whether a trap
//             can be walked out of -- drive does.
//   response  stick sensitivity: full speed with a shorter drag (Glass).
// On ice (unless Ice Skates cover the patch: mazeGame.js) every marble drives
// at minDrive and barely brakes:
// let go and it slides on, the way ice reads when rolling.
export const HANDLING = { minDrive: 10, maxDrive: 18, coast: 3.6, brakePerDamping: 240, maxBrake: 30, iceBrake: 1 };
export function walkHandling(spec) {
    const base = MARBLES.classic.stats;
    const grip = spec && Number.isFinite(spec.grip) ? spec.grip : base.grip;
    const damping = spec && Number.isFinite(spec.damping) ? spec.damping : base.damping;
    const response = spec && Number.isFinite(spec.response) ? spec.response : base.response;
    const drive = Math.max(HANDLING.minDrive, Math.min(HANDLING.maxDrive, WALK.accel * grip / base.grip));
    const brake = Math.max(HANDLING.coast, Math.min(HANDLING.maxBrake, HANDLING.coast + (damping - base.damping) * HANDLING.brakePerDamping));
    return { drive, brake, iceDrive: HANDLING.minDrive, iceBrake: HANDLING.iceBrake, response };
}
// The acceleration for this step: driving while the player asks to move,
// braking when they let go.
export function handlingAccel(h, want, onIce) {
    const moving = !!(want && (want.x || want.z));
    if (onIce) return moving ? h.iceDrive : h.iceBrake;
    return moving ? h.drive : h.brake;
}

// Which way to face at the start: the longest clear run along the eight
// compass directions (walls inflated by the walker's radius), so the first
// view is down a corridor rather than into a corner. Ties go to the one most
// toward the goal.
export function openingYaw(lv) {
    const r = lv.ballRadius, walls = lv.walls || [];
    const hw = lv.size.w / 2 - r, hd = lv.size.d / 2 - r;
    const blocked = (x, z) => Math.abs(x) > hw || Math.abs(z) > hd
        || walls.some(wl => Math.abs(x - wl.x) < wl.w / 2 + r && Math.abs(z - wl.z) < wl.d / 2 + r);
    const toGoal = yawToward(lv.start.x, lv.start.z, lv.goal.x, lv.goal.z);
    let best = toGoal, bestLen = -1, bestScore = -Infinity;
    for (let k = 0; k < 8; k++) {
        const yaw = k * Math.PI / 4;
        const f = forwardOf(yaw);
        let len = 0;
        while (len < 20 && !blocked(lv.start.x + f.x * (len + 0.05), lv.start.z + f.z * (len + 0.05))) len += 0.05;
        const score = len + 0.3 * Math.cos(yaw - toGoal);
        if (score > bestScore) { bestScore = score; bestLen = len; best = yaw; }
    }
    return bestLen > 0 ? best : toGoal;
}

// THIRD PERSON: the camera behind the walker and above the wall tops, looking
// down at it and on along its way. Never raised by the look (the user's call,
// 2026-10-12: "the look should not allow a higher camera angle"): it sits LOW
// (`elev`, what was the lowest of the old orbit) and only when a wall stands
// between it and the marble does it rise to the old starting height (`high`),
// then slide back down once the low view is clear ("starting height, when
// walls are in the way, then slide down to where it is now").
export const THIRD = { dist: 2.5, elev: 0.35, high: 0.79, ahead: 1.0, riseMs: 110, fallMs: 650, holdMs: 450 };
export function thirdPersonPose(p, yaw, elev = THIRD.elev) {
    const F = forwardOf(yaw);
    const back = Math.cos(elev) * THIRD.dist, up = Math.sin(elev) * THIRD.dist;
    return {
        eye: { x: p.x - F.x * back, y: p.y + up, z: p.z - F.z * back },
        look: { x: p.x + F.x * THIRD.ahead, y: p.y, z: p.z + F.z * THIRD.ahead }
    };
}

// Whether a wall stands between the camera (at `elev`) and the marble: the
// lines from the eye to the marble's centre and to the floor at its near
// edge (`r`: the marble's radius; a wall hiding the floor it rolls on is in
// the way too), against each wall's box, floor to `top`, a hair fatter
// (`pad`) so a wall skimming a line counts.
export function thirdBlocked(walls, p, yaw, elev, top, r = 0, pad = 0.04) {
    const e = thirdPersonPose(p, yaw, elev).eye, F = forwardOf(yaw);
    const floorY = p.y - r + 0.02;
    return segmentBlocked(walls, e, p, top, pad)
        || segmentBlocked(walls, e, { x: p.x - F.x * r, y: floorY, z: p.z - F.z * r }, top, pad);
}
function segmentBlocked(walls, e, q, top, pad) {
    const d = { x: q.x - e.x, y: q.y - e.y, z: q.z - e.z };
    for (const w of walls || []) {
        let t0 = 0, t1 = 0.97;                 // stop short of the target itself
        const slabs = [[e.x, d.x, w.x - w.w / 2 - pad, w.x + w.w / 2 + pad], [e.y, d.y, -1, top + pad], [e.z, d.z, w.z - w.d / 2 - pad, w.z + w.d / 2 + pad]];
        let hit = true;
        for (const [o, v, lo, hi] of slabs) {
            if (Math.abs(v) < 1e-9) { if (o < lo || o > hi) { hit = false; break; } continue; }
            let a = (lo - o) / v, b = (hi - o) / v;
            if (a > b) [a, b] = [b, a];
            t0 = Math.max(t0, a); t1 = Math.min(t1, b);
            if (t0 > t1) { hit = false; break; }
        }
        if (hit) return true;
    }
    return false;
}

// One frame of the camera's height: up to `high` quickly while the low view
// is blocked, held there a moment once it clears (no bobbing at a wall's
// end), then a slow slide back down. state: { elev, holdMs }.
export function nextThirdElev(state, blockedLow, dtMs) {
    const s = state && Number.isFinite(state.elev) ? state : { elev: THIRD.elev, holdMs: 0 };
    const dt = Math.max(0, Number(dtMs) || 0);
    let hold = blockedLow ? THIRD.holdMs : Math.max(0, s.holdMs - dt);
    const want = blockedLow || hold > 0 ? THIRD.high : THIRD.elev;
    const tau = want > s.elev ? THIRD.riseMs : THIRD.fallMs;
    const elev = s.elev + (want - s.elev) * (1 - Math.exp(-dt / tau));
    return { elev, holdMs: hold };
}

export function clampPitch(p) { return Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p)); }

// The point the camera looks at, from the eye, for a yaw and pitch.
export function lookPoint(eye, yaw, pitch) {
    const F = forwardOf(yaw), c = Math.cos(pitch);
    return { x: eye.x + F.x * c, y: eye.y + Math.sin(pitch), z: eye.z + F.z * c };
}

// --- the input controller -----------------------------------------------------
// One per page. While `active()` says walking, presses on the LEFT 45% of the
// screen are a floating joystick (move), anywhere else drags the view (look);
// both can be held at once with two fingers. Keys: W/S or Up/Down walk, A/D
// strafe, Left/Right or Q/E turn. Buttons keep their taps.
export function createWalkInput({ active, onFirstInput, stickEl, padEl }) {
    const keys = new Set();
    let stick = null;          // { id, x0, y0, x, y }
    let look = null;           // { id, x, y }
    let lookDX = 0, lookDY = 0, lookW = 0;   // lookW: the page's width, for lookRadPerPx
    // Stick drag for full speed: shorter for a more responsive marble.
    let fullPx = STICK_FULL_PX;
    const KEYS = {
        KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
        KeyA: 'left', KeyD: 'right', ArrowLeft: 'turnL', ArrowRight: 'turnR', KeyQ: 'turnL', KeyE: 'turnR'
    };
    // The joystick is always on screen on touch devices (CSS puts it at its
    // home spot); a press on the left jumps it under the thumb, and letting go
    // sends it home. The look pad lights while a look drag is held.
    const showStick = () => {
        if (padEl) padEl.classList.toggle('is-active', !!look);
        if (!stickEl) return;
        stickEl.classList.toggle('is-active', !!stick);
        if (!stick) {
            stickEl.style.left = ''; stickEl.style.top = '';
            stickEl.style.setProperty('--dx', '0px'); stickEl.style.setProperty('--dy', '0px');
            return;
        }
        stickEl.style.left = stick.x0 + 'px';
        stickEl.style.top = stick.y0 + 'px';
        const dx = Math.max(-1, Math.min(1, (stick.x - stick.x0) / fullPx)) * STICK_FULL_PX;
        const dy = Math.max(-1, Math.min(1, (stick.y - stick.y0) / fullPx)) * STICK_FULL_PX;
        stickEl.style.setProperty('--dx', dx + 'px');
        stickEl.style.setProperty('--dy', dy + 'px');
    };
    const isUi = (t) => t && t.closest && t.closest('button, .maze-btn, input, .modal');

    if (typeof window !== 'undefined') {
        window.addEventListener('keydown', (e) => {
            const k = KEYS[e.code];
            if (!k || !active()) return;
            e.preventDefault();
            keys.add(k);
            onFirstInput && onFirstInput();
        });
        window.addEventListener('keyup', (e) => { const k = KEYS[e.code]; if (k) keys.delete(k); });
        window.addEventListener('blur', () => { keys.clear(); stick = null; look = null; showStick(); });
        window.addEventListener('pointerdown', (e) => {
            if (!active() || isUi(e.target)) return;
            const p = contentPoint(e);            // the page's own coordinates (portraitLock.js)
            if (p.x < p.w * 0.45 && !stick) {
                stick = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y };
                showStick();
            } else if (!look) { look = { id: e.pointerId, x: p.x, y: p.y }; showStick(); }
            onFirstInput && onFirstInput();
        });
        window.addEventListener('pointermove', (e) => {
            const p = contentPoint(e);
            if (stick && e.pointerId === stick.id) { stick.x = p.x; stick.y = p.y; showStick(); }
            else if (look && e.pointerId === look.id) {
                lookDX += p.x - look.x; lookDY += p.y - look.y;
                look.x = p.x; look.y = p.y; lookW = p.w;
            }
        });
        const end = (e) => {
            if (stick && e.pointerId === stick.id) { stick = null; showStick(); }
            if (look && e.pointerId === look.id) { look = null; showStick(); }
        };
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    }

    return {
        // What the player asks for this frame: { fwd, strafe } and the yaw /
        // pitch change in radians. `sens` and `invertY` are comfort settings.
        read(dtMs, { sens = 1, invertY = false } = {}) {
            let fwd = (keys.has('fwd') ? 1 : 0) - (keys.has('back') ? 1 : 0);
            let strafe = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
            if (stick) {
                strafe += Math.max(-1, Math.min(1, (stick.x - stick.x0) / fullPx));
                fwd -= Math.max(-1, Math.min(1, (stick.y - stick.y0) / fullPx));
            }
            const turnKeys = (keys.has('turnL') ? 1 : 0) - (keys.has('turnR') ? 1 : 0);
            const k = lookRadPerPx(lookW || (typeof window !== 'undefined' ? window.innerWidth : 0));
            const dYaw = -lookDX * k * sens + turnKeys * KEY_TURN_RAD_S * sens * (dtMs / 1000);
            const dPitch = (invertY ? 1 : -1) * lookDY * k * LOOK_PITCH_SHARE * sens;
            lookDX = 0; lookDY = 0;
            return { move: { fwd, strafe }, dYaw, dPitch, turning: turnKeys !== 0 || !!look };
        },
        // The marble's response (walkHandling): full speed at a shorter drag.
        setResponse(r) { fullPx = STICK_FULL_PX / Math.max(0.5, Math.min(2, Number(r) || 1)); },
        // What a drag of (dx, dy) px from the press asks for (tests).
        stickMove(dx, dy) {
            return { fwd: -Math.max(-1, Math.min(1, dy / fullPx)), strafe: Math.max(-1, Math.min(1, dx / fullPx)) };
        },
        // Test hooks: hold a move, or turn by an amount, as a player would.
        setTestMove(m) { keys.clear(); if (m && m.fwd > 0) keys.add('fwd'); if (m && m.fwd < 0) keys.add('back'); if (m && m.strafe > 0) keys.add('right'); if (m && m.strafe < 0) keys.add('left'); },
        reset() { keys.clear(); stick = null; look = null; lookDX = 0; lookDY = 0; showStick(); }
    };
}
