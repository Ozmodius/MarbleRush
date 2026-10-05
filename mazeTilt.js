// TILT INPUT MATH for the marble maze -- pure, no DOM, no three, no cannon.
//
// Imports nothing on purpose, for the same reason world.js and botRules.js do:
// everything here is the part of tilt control that is easy to get wrong and
// impossible to eyeball in a headless sandbox (this machine has no
// accelerometer), so it has to be testable in plain Node. mazeGame.js owns the
// DeviceOrientationEvent listener and the permission prompt; this file owns
// what those raw numbers MEAN.
//
// ---------------------------------------------------------------------------
// THE AXES, once, so nothing downstream has to guess
// ---------------------------------------------------------------------------
// DeviceOrientationEvent gives Tait-Bryan angles in degrees:
//   beta  -- front-to-back tilt. 0 = flat on its back, +90 = stood upright
//            facing you, range [-180, 180].
//   gamma -- left-to-right tilt. 0 = flat, +90 = rolled onto its left edge,
//            range [-90, 90].
// We never use alpha (compass heading): a labyrinth cares which way the board
// is leaning, not which way the player is facing. Spinning on an office chair
// must not move the ball.
//
// Board convention (matches three.js/cannon world axes in mazeGame.js):
//   +x = screen right, +z = screen DOWN (toward the player), -y = down.
// So a positive gamma (right edge dipping) rolls the ball +x, and a positive
// beta (top edge lifting toward you) rolls the ball +z. That is the mapping
// tiltToGravity implements.

// Neutral is captured from the player's real pose, so these bounds describe how
// far they must lean FROM THERE -- not an absolute device attitude.
export const MAX_TILT_DEG = 25;      // full deflection; beyond this adds nothing
export const DEADZONE_DEG = 1.2;     // hand tremor / bus vibration, not intent
export const SMOOTHING = 0.18;       // low-pass alpha per frame, see smoothTilt

// Sensitivity multiplier bounds. 1.0 means MAX_TILT_DEG of lean gives full
// deflection; 2.0 means half that lean does. Clamped identically on read and
// write in settings.js, same discipline as getDefaultAfkGraceSeconds.
export const MIN_SENSITIVITY = 0.5;
export const MAX_SENSITIVITY = 2.0;
export const DEFAULT_SENSITIVITY = 1.0;

export function clampSensitivity(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_SENSITIVITY;
    return Math.max(MIN_SENSITIVITY, Math.min(MAX_SENSITIVITY, n));
}

// Shortest signed angular distance from `from` to `to`, in degrees, result in
// (-180, 180].
//
// Plain subtraction is wrong here and the failure is not hypothetical: beta
// wraps at ±180, so a player holding the phone near-vertical can have neutral
// captured at 179 and read to -179 a moment later. Subtracting gives -358 --
// a full-tilt lurch in the wrong direction from a 2-degree real movement.
export function angleDelta(from, to) {
    let d = (to - from) % 360;
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
}

// Capture the player's current pose as "flat". Everything downstream is
// measured as a delta from this, which is what lets the maze be played lying
// down, at a desk, or on a bus without any of it feeling different.
export function captureNeutral(beta, gamma) {
    return {
        beta: Number.isFinite(beta) ? beta : 0,
        gamma: Number.isFinite(gamma) ? gamma : 0
    };
}

// Screen-orientation correction.
//
// beta/gamma are reported in the DEVICE's frame, which does not rotate with the
// screen. If the device reports landscape while the player is still looking at
// a portrait-locked layout (or the lock fails, or they are on a tablet), the
// raw axes are rotated relative to what they see -- so "lean right" would send
// the ball up. This rotates the axis pair to match `screen.orientation.angle`.
//
// Returns {beta, gamma} already expressed in SCREEN space.
export function orientToScreen(beta, gamma, screenAngle) {
    const a = ((Number(screenAngle) || 0) % 360 + 360) % 360;
    switch (a) {
        case 90:  return { beta: -gamma, gamma: beta };
        case 180: return { beta: -beta, gamma: -gamma };
        case 270: return { beta: gamma, gamma: -beta };
        default:  return { beta, gamma };   // 0 and anything unexpected
    }
}

// Deadzone + clamp, applied to one axis' delta in degrees.
//
// The deadzone is SUBTRACTED rather than zeroed below the threshold: zeroing
// leaves a step discontinuity at the edge, where the ball snaps from stationary
// to moving at deadzone speed. Subtracting means output rises from zero
// continuously, so a slow deliberate lean starts the ball slowly -- which is
// the whole feel of a labyrinth.
export function applyDeadzoneAndClamp(deltaDeg, sensitivity = DEFAULT_SENSITIVITY) {
    if (!Number.isFinite(deltaDeg)) return 0;
    const sign = deltaDeg < 0 ? -1 : 1;
    const mag = Math.abs(deltaDeg);
    if (mag <= DEADZONE_DEG) return 0;
    const scaled = (mag - DEADZONE_DEG) * clampSensitivity(sensitivity);
    return sign * Math.min(scaled, MAX_TILT_DEG);
}

// One-pole low-pass toward `target`. Phone accelerometers are noisy enough that
// feeding raw deltas to gravity makes the ball buzz while the phone is
// perfectly still on a table.
//
// Deliberately frame-rate independent: at a fixed alpha, a device running 120Hz
// would smooth twice as fast as one at 60Hz and the two would not feel like the
// same game. dtMs normalizes to the 1/60 step the physics runs at.
export function smoothTilt(current, target, dtMs = 1000 / 60) {
    if (!Number.isFinite(current)) return target;
    if (!Number.isFinite(target)) return current;
    const steps = Math.max(0, Math.min(dtMs / (1000 / 60), 8));
    const alpha = 1 - Math.pow(1 - SMOOTHING, steps);
    return current + (target - current) * alpha;
}

// Tilt (already deadzoned/clamped/smoothed, in degrees) -> a gravity vector.
//
// Modelled as gravity rotated off vertical, NOT as a horizontal force bolted
// onto constant downward gravity. That distinction is what makes the ball
// behave like a ball on a slope: total gravity magnitude stays `g` at every
// tilt, so leaning harder trades downforce for sideforce exactly as a real
// tilted plane does. A bolted-on horizontal force would let the ball accelerate
// sideways without ever pressing less firmly into the floor, which reads as
// wind rather than gravity, and would break the friction model with it.
//
// Returns {x, y, z} for CANNON.World.gravity.set(...). y is always negative.
export function tiltToGravity(betaDeg, gammaDeg, g = 30) {
    const b = (Number.isFinite(betaDeg) ? betaDeg : 0) * Math.PI / 180;
    const gm = (Number.isFinite(gammaDeg) ? gammaDeg : 0) * Math.PI / 180;
    // Down-vector of a plane pitched by beta and rolled by gamma.
    const x = Math.sin(gm);
    const z = Math.sin(b);
    // Whatever is left over after the two horizontal components -- keeps the
    // vector's length exactly g. Guarded because at extreme combined tilt the
    // radicand can go slightly negative through float error.
    const yMagSq = 1 - x * x - z * z;
    const y = -Math.sqrt(Math.max(0, yMagSq));
    return { x: x * g, y: y * g, z: z * g };
}

// The whole per-frame pipeline in one call, so mazeGame.js's frame callback
// stays readable and every step is exercised together by the tests.
//
// `prev` is the previous frame's smoothed {beta, gamma} (pass null on the first
// frame after a capture/recenter). Returns the new smoothed tilt AND the
// gravity vector derived from it.
export function computeTilt(raw, neutral, prev, opts = {}) {
    const {
        screenAngle = 0,
        sensitivity = DEFAULT_SENSITIVITY,
        dtMs = 1000 / 60,
        g = 30
    } = opts;

    // Screen-correct BOTH the live reading and the neutral before differencing.
    // Correcting only one of them would inject the whole screen rotation as a
    // permanent phantom lean.
    const s = orientToScreen(raw.beta, raw.gamma, screenAngle);
    const n = orientToScreen(neutral.beta, neutral.gamma, screenAngle);

    const rawBeta = applyDeadzoneAndClamp(angleDelta(n.beta, s.beta), sensitivity);
    const rawGamma = applyDeadzoneAndClamp(angleDelta(n.gamma, s.gamma), sensitivity);

    const beta = prev ? smoothTilt(prev.beta, rawBeta, dtMs) : rawBeta;
    const gamma = prev ? smoothTilt(prev.gamma, rawGamma, dtMs) : rawGamma;

    return { tilt: { beta, gamma }, gravity: tiltToGravity(beta, gamma, g) };
}
