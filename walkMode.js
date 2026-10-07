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

import { WALK } from './shopCatalog.js';

export const EYE_ABOVE_CENTRE = 0.12;   // eye height over the body's centre (walls are 0.55 tall)
export const PITCH_MAX = 0.9;           // radians: look most of the way down or up
const LOOK_RAD_PER_PX = 0.0055;         // at sensitivity 1
const KEY_TURN_RAD_S = 2.2;             // arrow-key turning, at sensitivity 1
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
// down at it and on along its way. Looking up or down raises or lowers the
// camera round the marble (an orbit), rather than tilting the view.
export const THIRD = { dist: 2.5, elevation: 0.72, ahead: 1.0, minElev: 0.35, maxElev: 1.3 };
export function thirdPersonPose(p, yaw, pitch) {
    const elev = Math.max(THIRD.minElev, Math.min(THIRD.maxElev, THIRD.elevation - pitch * 0.9));
    const F = forwardOf(yaw);
    const back = Math.cos(elev) * THIRD.dist, up = Math.sin(elev) * THIRD.dist;
    return {
        eye: { x: p.x - F.x * back, y: p.y + up, z: p.z - F.z * back },
        look: { x: p.x + F.x * THIRD.ahead, y: p.y, z: p.z + F.z * THIRD.ahead }
    };
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
    let lookDX = 0, lookDY = 0;
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
        const dx = Math.max(-1, Math.min(1, (stick.x - stick.x0) / STICK_FULL_PX)) * STICK_FULL_PX;
        const dy = Math.max(-1, Math.min(1, (stick.y - stick.y0) / STICK_FULL_PX)) * STICK_FULL_PX;
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
            if (e.clientX < window.innerWidth * 0.45 && !stick) {
                stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
                showStick();
            } else if (!look) { look = { id: e.pointerId, x: e.clientX, y: e.clientY }; showStick(); }
            onFirstInput && onFirstInput();
        });
        window.addEventListener('pointermove', (e) => {
            if (stick && e.pointerId === stick.id) { stick.x = e.clientX; stick.y = e.clientY; showStick(); }
            else if (look && e.pointerId === look.id) {
                lookDX += e.clientX - look.x; lookDY += e.clientY - look.y;
                look.x = e.clientX; look.y = e.clientY;
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
                strafe += Math.max(-1, Math.min(1, (stick.x - stick.x0) / STICK_FULL_PX));
                fwd -= Math.max(-1, Math.min(1, (stick.y - stick.y0) / STICK_FULL_PX));
            }
            const turnKeys = (keys.has('turnL') ? 1 : 0) - (keys.has('turnR') ? 1 : 0);
            const dYaw = -lookDX * LOOK_RAD_PER_PX * sens + turnKeys * KEY_TURN_RAD_S * sens * (dtMs / 1000);
            const dPitch = (invertY ? 1 : -1) * lookDY * LOOK_RAD_PER_PX * sens;
            lookDX = 0; lookDY = 0;
            return { move: { fwd, strafe }, dYaw, dPitch, turning: turnKeys !== 0 || !!look };
        },
        // Test hooks: hold a move, or turn by an amount, as a player would.
        setTestMove(m) { keys.clear(); if (m && m.fwd > 0) keys.add('fwd'); if (m && m.fwd < 0) keys.add('back'); if (m && m.strafe > 0) keys.add('right'); if (m && m.strafe < 0) keys.add('left'); },
        reset() { keys.clear(); stick = null; look = null; lookDX = 0; lookDY = 0; showStick(); }
    };
}
