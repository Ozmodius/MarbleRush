// THE BOARD ON YOUR TABLE -- the numbers behind mixed reality (xrMode.js), pure
// and tested in Node (test_xr.js). The user's call, 2026-10-14: Quest 3, the
// room around the board (passthrough), grab and tilt.
//
// THE PLAYER IS SCALED, NOT THE BOARD. The headset owns the camera, and the
// level stays in its own units -- walls, physics, lights, shadows, every
// verified distance untouched. The camera rides a RIG whose transform maps
// the room (metres, the 'local-floor' space) onto the level: the inverse of
// "the board sits here on the table, this big". three.js multiplies every XR
// view by the camera's parent (WebXRManager updateCamera), so the whole level
// is drawn table-sized and in stereo, and the controllers, children of the
// same rig, arrive in level units.
//
// TILT IS THE HAND'S, RELATIVE TO THE GRAB. Squeeze (or pinch) and the hand's
// orientation then is the board's level; how far the hand has turned since is
// the lean. Read as where the board's UP would point if it turned with the
// hand: leaning toward +x is the right edge down (a positive gamma), toward +z
// the near edge down (a positive beta) -- mazeTilt.js's own convention, so the
// reading goes through the same deadzone, cap, smoothing and gravity as a
// phone's. Turning the hand about the vertical moves nothing, as spinning on
// an office chair moves nothing on a phone.
import * as THREE from 'three';

export const XR_BOARD_SCALE = 0.033;     // metres per level unit: 9 x 14 is 30 x 46 cm
export const XR_BOARD_LONG_MAX = 0.65;   // and no board's long side over 65 cm
export const XR_NEAR_EDGE_M = 0.25;      // the board's near edge, ahead of the eyes
export const XR_DROP_M = 0.45;           // the board's floor, under the eyes
export const XR_TABLE_MIN_M = 0.55;      // never lower than a coffee table...
export const XR_TABLE_MAX_M = 1.3;       // ...nor higher than a standing desk

// Metres per level unit for a board of `size` ({ w, d }).
export function boardScale(size) {
    const long = Math.max(size.w, size.d);
    return Math.min(XR_BOARD_SCALE, XR_BOARD_LONG_MAX / long);
}

// Where the board's centre goes in the room, and which way it faces, from the
// head's pose then: straight ahead on the floor's plane (whatever the head's
// pitch), its near edge XR_NEAR_EDGE_M away, its floor XR_DROP_M under the
// eyes. `depthM` is the board's depth in metres. yaw turns the level's -z (its
// far edge, the top of a phone's screen) to face the way the head faced.
export function placeBoard(headPos, headQuat, depthM) {
    const q = new THREE.Quaternion(headQuat.x, headQuat.y, headQuat.z, headQuat.w);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) {
        // Looking straight down: the head's up says where it faces.
        fwd.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(q)); fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    }
    fwd.normalize();
    const ahead = XR_NEAR_EDGE_M + depthM / 2;
    const y = Math.min(XR_TABLE_MAX_M, Math.max(XR_TABLE_MIN_M, headPos.y - XR_DROP_M));
    return {
        x: headPos.x + fwd.x * ahead,
        y,
        z: headPos.z + fwd.z * ahead,
        yaw: Math.atan2(-fwd.x, -fwd.z)
    };
}

// The board's transform (level -> room) and the rig's (room -> level), its
// inverse: the camera's parent while a session runs.
export function boardMatrix(place, scale) {
    const m = new THREE.Matrix4();
    m.compose(
        new THREE.Vector3(place.x, place.y, place.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), place.yaw),
        new THREE.Vector3(scale, scale, scale));
    return m;
}
export function rigMatrix(place, scale) { return boardMatrix(place, scale).invert(); }

const RAD = 180 / Math.PI;
const _d = new THREE.Quaternion(), _inv = new THREE.Quaternion(), _up = new THREE.Vector3();
// The lean, in degrees ({ beta, gamma }), of a hand at orientation `q` that
// grabbed at `q0` -- both in level space. The turn since the grab is q * q0^-1
// (a rotation in level space); the board's up, turned by it, says the lean.
export function grabTilt(q0, q) {
    _inv.copy(q0).invert();
    _d.copy(q).multiply(_inv);
    _up.set(0, 1, 0).applyQuaternion(_d);
    const c = v => Math.max(-1, Math.min(1, v));
    return { beta: Math.asin(c(_up.z)) * RAD, gamma: Math.asin(c(_up.x)) * RAD };
}

// ---------------------------------------------------------------------------
// FEEL (the user's call, 2026-10-14): the controller holding the board buzzes
// with what the marble does -- from the SAME physics the sound hears
// (soundModel.js impactStrength: a wall hit's speed along its normal), so a
// clack you hear is a knock you feel. { intensity 0..1, ms } or null.
// ---------------------------------------------------------------------------
export const HAPTIC_MIN_SPEED = 0.6;      // gentler than this is a roll, not a knock
export const HAPTIC_FULL_SPEED = 6.0;
export function pulseFor(kind, v = 0) {
    if (kind === 'hit') {
        const s = Math.abs(Number(v) || 0);
        if (s < HAPTIC_MIN_SPEED) return null;
        const k = Math.min(1, (s - HAPTIC_MIN_SPEED) / (HAPTIC_FULL_SPEED - HAPTIC_MIN_SPEED));
        return { intensity: 0.12 + 0.68 * k, ms: Math.round(14 + 26 * k) };
    }
    return ({
        fall: { intensity: 1.0, ms: 160 },      // down a hole: the thud
        bumper: { intensity: 0.75, ms: 45 },
        shield: { intensity: 0.6, ms: 90 },
        coin: { intensity: 0.15, ms: 14 },
        win: { intensity: 0.5, ms: 110 }
    })[kind] || null;
}

// ---------------------------------------------------------------------------
// THE REAL TABLE (the user's call, 2026-10-14). The headset knows the room's
// surfaces (WebXR hit-test, from the Quest's Space Setup): a ray dropped
// straight down where the board is planned finds what is under it, and the
// board sits on the highest surface there that is a table's height -- not the
// floor, not a shelf over the eyes. Pointing (PLACE BOARD) puts it on any
// surface the ray meets, facing you.
// ---------------------------------------------------------------------------
export const XR_TABLE_LIFT_M = 0.02;      // the board's floor, just above the real top
export const XR_TABLE_FIND_MIN_M = 0.4;   // a low coffee table counts...
export const XR_TABLE_EYE_GAP_M = 0.2;    // ...a surface near eye height does not
// From the heights (metres, room space) a dropped ray met, the table's, or null.
export function tableHeight(heights, eyeY) {
    const top = Math.min(XR_TABLE_MAX_M + 0.1, eyeY - XR_TABLE_EYE_GAP_M);
    const ok = (heights || []).filter(y => Number.isFinite(y) && y >= XR_TABLE_FIND_MIN_M && y <= top);
    return ok.length ? Math.max(...ok) : null;
}
// The board's place on a surface the player pointed at: centred on the point,
// its floor just above it, its far edge away from the head.
export function placeOnSurface(point, headPos) {
    const dx = point.x - headPos.x, dz = point.z - headPos.z;
    const yaw = Math.hypot(dx, dz) < 1e-6 ? 0 : Math.atan2(-dx, -dz);
    return { x: point.x, y: point.y + XR_TABLE_LIFT_M, z: point.z, yaw };
}
