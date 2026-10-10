// BETWEEN LEVELS (the user's call, 2026-10-09): the short shows around a
// level, as pure timelines. mazeGame.js draws them; nothing here touches the
// physics, and none of them holds up play -- START during one ends it on the
// spot (the ball is already where the physics has it).
//
//   drop        every level's ready screen: the marble falls out of the sky
//               onto the start, lands with a bounce and a thud.
//   shipDrop    a planet's first level: Rolle's ship flies in over the start,
//               beams the marble down, and flies off.
//   shipPickup  a planet's floor 10, once cleared: the ship comes down over
//               the exit, beams the marble (and a freed friend) up into its
//               dome, and flies off to the next planet.
//
// Each takes the show's own age in ms (summed from frame times, never the
// wall clock: tests step frames) and returns a pose. `y` values are heights
// of the marble's centre ABOVE where it rests on the floor. Ship poses are
// world units relative to the spot the show is about (the start, the exit).
// test_level_show.js checks every show starts where it should, never puts
// the marble under the floor, ends exactly at rest (or off the board), and
// is over in under three seconds.

export const DROP_H = 5.5;           // the marble starts this far above the floor
export const DROP_FALL_MS = 560;     // the fall, under a steady pull
export const DROP_BOUNCE_MS = 200;   // one small bounce
export const DROP_BOUNCE_H = 0.22;
export const DROP_MS = DROP_FALL_MS + DROP_BOUNCE_MS;
// How fast it is falling when it lands (units/s), for the thud.
export const DROP_LAND_SPEED = 2 * DROP_H / (DROP_FALL_MS / 1000);

// Squash: a little flattening at each touchdown, back by the bounce's top.
function squashAt(ms) {
    const near = (t, w) => Math.max(0, 1 - Math.abs(ms - t) / w);
    return 1 - 0.22 * near(DROP_FALL_MS, 70) - 0.1 * near(DROP_MS, 60);
}

// A plain drop: { y, squash, landed (has touched down once), done }.
export function drop(ms) {
    if (!(ms > 0)) return { y: DROP_H, squash: 1, landed: false, done: false };
    if (ms < DROP_FALL_MS) {
        const k = ms / DROP_FALL_MS;
        return { y: DROP_H * (1 - k * k), squash: squashAt(ms), landed: false, done: false };
    }
    if (ms < DROP_MS) {
        const k = (ms - DROP_FALL_MS) / DROP_BOUNCE_MS;
        return { y: DROP_BOUNCE_H * 4 * k * (1 - k), squash: squashAt(ms), landed: true, done: false };
    }
    return { y: 0, squash: 1, landed: true, done: true };
}

// --- the ship ------------------------------------------------------------------
export const SHIP_HOVER_Y = 2.6;     // over the spot, while beaming
const ease = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const easeIn = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k);
const lerp = (a, b, k) => a + (b - a) * k;

// The ship flies in from beyond the top of the board, low and level, and
// leaves to the side, climbing. `side` (+1/-1) picks which way it leaves.
const IN_FROM = { x: -2, y: 7, z: -16 };
const OUT_TO = side => ({ x: 15 * side, y: 8, z: -5 });

// A planet's first level. The marble rides in the dome, is beamed down to
// the start, and the ship leaves.
//   0 .. ARRIVE          fly in, slowing to a hover over the start
//   ARRIVE .. +BEAM      the beam: the marble sinks from the dome to the floor
//   .. +LEAVE            the ship climbs away
export const SHIP_DROP = { arrive: 850, beam: 650, leave: 750 };
export const SHIP_DROP_MS = SHIP_DROP.arrive + SHIP_DROP.beam + SHIP_DROP.leave;
// shipDrop(ms) -> { ship: { x, y, z, bank, visible }, ball: { y, inShip, scale }, beam (0..1), landed, done }
export function shipDrop(ms, side = 1) {
    const t = Math.max(0, ms || 0);
    const A = SHIP_DROP.arrive, B = A + SHIP_DROP.beam, C = B + SHIP_DROP.leave;
    const out = OUT_TO(side);
    let ship, bank = 0;
    if (t < A) {
        const k = ease(t / A);
        ship = { x: lerp(IN_FROM.x, 0, k), y: lerp(IN_FROM.y, SHIP_HOVER_Y, k), z: lerp(IN_FROM.z, 0, k) };
        bank = (1 - k) * 0.35;
    } else if (t < B) {
        ship = { x: 0, y: SHIP_HOVER_Y + Math.sin((t - A) / 140) * 0.04, z: 0 };
    } else {
        const k = easeIn((t - B) / SHIP_DROP.leave);
        ship = { x: lerp(0, out.x, k), y: lerp(SHIP_HOVER_Y, out.y, k), z: lerp(0, out.z, k) };
        bank = -side * k * 0.6;
    }
    // The marble: in the dome until the beam, then down it to the floor.
    const inDome = SHIP_HOVER_Y + SHIP_DOME_Y;
    let ball;
    if (t < A) ball = { y: ship.y + SHIP_DOME_Y, inShip: true, scale: 1 };
    else if (t < B) {
        const k = ease((t - A) / SHIP_DROP.beam);
        ball = { y: lerp(inDome, 0, k), inShip: false, scale: 1 };
    } else ball = { y: 0, inShip: false, scale: 1 };
    // The beam shines only from the hover: up over 120 ms, down by its end.
    const beam = t < A || t >= B ? 0 : Math.min(1, (t - A) / 120, (B - t) / 120);
    return {
        ship: { ...ship, bank, visible: t < C },
        ball, beam: Math.max(0, Math.min(1, beam)),
        landed: t >= B, done: t >= C
    };
}

// A planet's floor 10, cleared. The ship comes down over the exit, beams the
// marble up into the dome, and leaves with it.
export const SHIP_PICKUP = { arrive: 800, beam: 700, leave: 1200 };
export const SHIP_PICKUP_MS = SHIP_PICKUP.arrive + SHIP_PICKUP.beam + SHIP_PICKUP.leave;
// Where the marble sits in the dome, above the hull's centre.
export const SHIP_DOME_Y = 0.32;
// It leaves for the next planet ACROSS the board and away over its top
// (`out`, relative to the exit: mazeGame.js passes the board's far edge), so
// the dome with Rolle in it is seen going, above the CLEARED panel.
// shipPickup(ms, side, out) -> { ship, ball: { y, inShip, scale }, rise (0..1: up the beam), beam, done }
export function shipPickup(ms, side = 1, out = OUT_TO(side)) {
    const t = Math.max(0, ms || 0);
    const A = SHIP_PICKUP.arrive, B = A + SHIP_PICKUP.beam, C = B + SHIP_PICKUP.leave;
    let ship, bank = 0;
    if (t < A) {
        const k = ease(t / A);
        ship = { x: lerp(IN_FROM.x, 0, k), y: lerp(IN_FROM.y, SHIP_HOVER_Y, k), z: lerp(IN_FROM.z, 0, k) };
        bank = (1 - k) * 0.35;
    } else if (t < B) {
        ship = { x: 0, y: SHIP_HOVER_Y + Math.sin((t - A) / 140) * 0.04, z: 0 };
    } else {
        const k = easeIn((t - B) / SHIP_PICKUP.leave);
        ship = { x: lerp(0, out.x, k), y: lerp(SHIP_HOVER_Y, out.y, k), z: lerp(0, out.z, k) };
        bank = -side * k * 0.6;
    }
    const rise = t < A ? 0 : t < B ? ease((t - A) / SHIP_PICKUP.beam) : 1;
    const ball = rise < 1
        ? { y: lerp(0, SHIP_HOVER_Y + SHIP_DOME_Y, rise), inShip: false, scale: 1 }
        : { y: ship.y + SHIP_DOME_Y, inShip: true, scale: 1 };
    // The beam shines only from the hover: up over 120 ms, down by its end.
    const beam = t < A || t >= B ? 0 : Math.min(1, (t - A) / 120, (B - t) / 120);
    return {
        ship: { ...ship, bank, visible: t < C },
        ball, rise, beam: Math.max(0, Math.min(1, beam)),
        done: t >= C
    };
}

// Which show a level opens with: a planet's first level gets the ship,
// every other ladder level and the daily maze the plain drop; walking gets
// none (the camera is the marble).
export function openingShow(lv, { walk = false } = {}) {
    if (walk || !lv) return null;
    if (Number.isInteger(lv.world) && Number.isInteger(lv.index) && lv.index === (lv.world - 1) * 10 + 1) return 'shipDrop';
    return 'drop';
}
// And which one a clear ends with: a planet's floor 10 (rolled) gets the ship.
export function closingShow(lv, { walk = false } = {}) {
    if (walk || !lv) return null;
    return Number.isInteger(lv.world) && Number.isInteger(lv.index) && lv.index === (lv.world - 1) * 10 + 10 ? 'shipPickup' : null;
}
