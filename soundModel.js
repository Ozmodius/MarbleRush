// THE SOUND MODEL: what a marble on this board should sound like, as numbers.
//
// Pure (imports nothing), so Node can test it and the engine (sound.js) only
// has to turn these numbers into Web Audio nodes. Everything is synthesised
// from the physics the run already has -- the ball's speed, its impacts, the
// surface under it -- because a recorded loop cannot follow a marble that
// speeds up, skids onto ice and clacks off a wall in the same second, and
// because the CrazyGames bundle stays free of audio files.
//
// How a real marble sounds, and so how this is built:
//  - ROLLING is broadband noise from surface roughness, coloured by the
//    board's own resonances (a wooden labyrinth booms hollow under the ball).
//    It gets louder AND brighter with speed, and carries a faint wobble once
//    per turn of the ball (no marble is perfectly round). Rough surfaces
//    (gravel, snow, ash) add GRAINS: tiny clicks, more of them the faster the
//    ball covers ground. Tread plate adds a tick per raised bump.
//  - IMPACTS are modal: the wall rings at its own frequencies (wood thunks,
//    stone clicks, steel rings) and the marble adds its own short ping. How
//    hard is the speed along the contact normal.
//  - The MARBLE changes all of it: steel is heavy and bright, rubber is a
//    damped thud with almost no roll noise, glass pings.
//
// Units: speeds in world units per second (a unit is ~3 cm of real maze, a
// 0.3 radius ball a ~1 cm marble), frequencies in Hz, times in seconds.

// --- rolling surfaces, one per theme -----------------------------------------
// rumble: the board's low body resonance; body: its mid colour; hiss: the
// high texture noise (a highpass cutoff); grain: clicks per unit of distance
// rolled, and their colour; tread: spacing of raised bumps (units), 0 = none;
// ring: metal plate resonances excited by the roll; loud: overall level;
// hard: how hard the floor is, 0 (snow, a foam mat) to 1 (steel, ice) --
// half of what decides how bright the contact is (rollVoice).
export const SURFACES = {
    workshop:  { rumble: { f: 170, q: 1.4, g: 1.0 }, body: { f: 520, q: 1.6, g: 0.55 }, hiss: { f: 2600, g: 0.12 }, grain: { perUnit: 5, f: 1800, q: 1.2, g: 0.18 }, tread: 0, ring: [], loud: 1.0, hard: 0.65 },
    forest:    { rumble: { f: 120, q: 1.0, g: 0.6 }, body: { f: 380, q: 1.0, g: 0.35 }, hiss: { f: 1800, g: 0.10 }, grain: { perUnit: 26, f: 1300, q: 0.9, g: 0.42 }, tread: 0, ring: [], loud: 0.85, hard: 0.2 },
    snowfield: { rumble: { f: 140, q: 0.9, g: 0.45 }, body: { f: 650, q: 1.0, g: 0.30 }, hiss: { f: 3200, g: 0.08 }, grain: { perUnit: 22, f: 2400, q: 1.6, g: 0.36 }, tread: 0, ring: [], loud: 0.75, hard: 0.15 },
    glacier:   { rumble: { f: 230, q: 2.0, g: 0.55 }, body: { f: 1400, q: 2.4, g: 0.40 }, hiss: { f: 4200, g: 0.30 }, grain: { perUnit: 1.5, f: 3600, q: 3.0, g: 0.15 }, tread: 0, ring: [], loud: 0.9, hard: 0.9 },
    cinder:    { rumble: { f: 150, q: 1.2, g: 0.7 }, body: { f: 700, q: 1.3, g: 0.40 }, hiss: { f: 2300, g: 0.16 }, grain: { perUnit: 30, f: 2000, q: 1.1, g: 0.40 }, tread: 0, ring: [], loud: 0.95, hard: 0.55 },
    lava:      { rumble: { f: 130, q: 1.4, g: 0.85 }, body: { f: 820, q: 1.6, g: 0.45 }, hiss: { f: 2800, g: 0.18 }, grain: { perUnit: 18, f: 2600, q: 1.4, g: 0.32 }, tread: 0, ring: [], loud: 1.0, hard: 0.75 },
    playroom:  { rumble: { f: 110, q: 0.8, g: 0.55 }, body: { f: 300, q: 0.8, g: 0.25 }, hiss: { f: 1500, g: 0.05 }, grain: { perUnit: 3, f: 900, q: 0.8, g: 0.10 }, tread: 0, ring: [], loud: 0.6, hard: 0.2 },
    toybox:    { rumble: { f: 210, q: 1.8, g: 0.7 }, body: { f: 950, q: 2.2, g: 0.55 }, hiss: { f: 3000, g: 0.12 }, grain: { perUnit: 4, f: 2200, q: 2.0, g: 0.16 }, tread: 0, ring: [], loud: 0.95, hard: 0.8 },
    rustworks: { rumble: { f: 160, q: 1.6, g: 0.75 }, body: { f: 900, q: 1.8, g: 0.45 }, hiss: { f: 3000, g: 0.20 }, grain: { perUnit: 14, f: 2800, q: 1.5, g: 0.30 }, tread: 0, ring: [1180, 2650], loud: 1.0, hard: 0.85 },
    foundry:   { rumble: { f: 190, q: 2.2, g: 0.8 }, body: { f: 1100, q: 2.6, g: 0.50 }, hiss: { f: 3600, g: 0.22 }, grain: { perUnit: 2, f: 3200, q: 2.0, g: 0.12 }, tread: 0.38, ring: [1240, 2890, 4710], loud: 1.05, hard: 1.0 }
};

// Ice is its own surface wherever it is: a hard, glassy hiss with almost no
// grain, so the player HEARS the grip go before they feel it.
export const ICE_SURFACE = { rumble: { f: 260, q: 2.4, g: 0.35 }, body: { f: 1700, q: 3.0, g: 0.35 }, hiss: { f: 5200, g: 0.42 }, grain: { perUnit: 0.6, f: 4200, q: 4.0, g: 0.10 }, tread: 0, ring: [], loud: 0.8, hard: 1.0 };

// --- walls: what an impact rings at ------------------------------------------
// modes: the wall's resonances { f, decay (s), amp }; click: the colour of
// the contact transient; room: how much of the hit reaches the reverb.
export const WALLS = {
    wood:    { modes: [{ f: 190, decay: 0.09, amp: 1.0 }, { f: 470, decay: 0.06, amp: 0.55 }, { f: 1120, decay: 0.035, amp: 0.3 }], click: { f: 2400, q: 0.9 }, room: 0.18 },
    log:     { modes: [{ f: 150, decay: 0.07, amp: 1.0 }, { f: 380, decay: 0.05, amp: 0.4 }, { f: 900, decay: 0.03, amp: 0.2 }], click: { f: 1600, q: 0.8 }, room: 0.12 },
    stone:   { modes: [{ f: 620, decay: 0.03, amp: 0.7 }, { f: 1500, decay: 0.022, amp: 0.6 }, { f: 3300, decay: 0.015, amp: 0.4 }], click: { f: 3800, q: 1.0 }, room: 0.2 },
    ice:     { modes: [{ f: 880, decay: 0.05, amp: 0.6 }, { f: 2150, decay: 0.04, amp: 0.55 }, { f: 4700, decay: 0.03, amp: 0.4 }], click: { f: 5200, q: 1.4 }, room: 0.25 },
    rock:    { modes: [{ f: 420, decay: 0.035, amp: 0.8 }, { f: 1050, decay: 0.025, amp: 0.5 }, { f: 2600, decay: 0.018, amp: 0.3 }], click: { f: 3000, q: 0.9 }, room: 0.22 },
    foam:    { modes: [{ f: 140, decay: 0.05, amp: 0.8 }, { f: 330, decay: 0.03, amp: 0.25 }], click: { f: 900, q: 0.7 }, room: 0.05 },
    plastic: { modes: [{ f: 540, decay: 0.05, amp: 0.9 }, { f: 1320, decay: 0.04, amp: 0.6 }, { f: 2750, decay: 0.025, amp: 0.3 }], click: { f: 3200, q: 1.2 }, room: 0.12 },
    steel:   { modes: [{ f: 410, decay: 0.32, amp: 0.6 }, { f: 1090, decay: 0.26, amp: 0.55 }, { f: 2040, decay: 0.2, amp: 0.4 }, { f: 3310, decay: 0.15, amp: 0.25 }], click: { f: 4200, q: 1.2 }, room: 0.35 },
    rust:    { modes: [{ f: 330, decay: 0.16, amp: 0.7 }, { f: 870, decay: 0.12, amp: 0.45 }, { f: 1760, decay: 0.08, amp: 0.3 }], click: { f: 3000, q: 1.0 }, room: 0.3 }
};
// Each theme's walls, as built by mazeTheme3d / the props.
export const THEME_WALL = {
    workshop: 'wood', forest: 'log', snowfield: 'stone', glacier: 'ice', cinder: 'rock', lava: 'rock',
    playroom: 'foam', toybox: 'plastic', rustworks: 'rust', foundry: 'steel'
};

// --- the marble ---------------------------------------------------------------
// ping: the marble's own ring on a hit; bright: scales the contact click;
// damp: scales how long the wall rings (rubber kills it); weight: scales the
// low end; roll: scales the rolling noise; hit: overall impact level;
// hard: the marble's half of the contact (rubber 0.1 .. steel 1); rollRing:
// the marble's own faint ring while it rolls on something hard enough to
// excite it (a steel ball on steel sings; rubber never does).
export const MARBLE_VOICES = {
    classic: { ping: [{ f: 4300, decay: 0.03, amp: 0.35 }, { f: 8100, decay: 0.018, amp: 0.2 }], bright: 1.0, damp: 1.0, weight: 1.0, roll: 1.0, hit: 1.0,
               hard: 0.85, rollRing: [{ f: 5200, g: 0.05 }] },
    glass:   { ping: [{ f: 4700, decay: 0.05, amp: 0.5 }, { f: 9300, decay: 0.03, amp: 0.3 }], bright: 1.25, damp: 1.0, weight: 0.9, roll: 0.95, hit: 1.0,
               hard: 0.92, rollRing: [{ f: 5900, g: 0.09 }, { f: 8700, g: 0.05 }] },
    steel:   { ping: [{ f: 6100, decay: 0.06, amp: 0.4 }, { f: 11200, decay: 0.035, amp: 0.2 }], bright: 1.15, damp: 1.1, weight: 1.5, roll: 1.25, hit: 1.3,
               hard: 1.0, rollRing: [{ f: 3400, g: 0.12 }, { f: 6300, g: 0.07 }] },
    rubber:  { ping: [], bright: 0.35, damp: 0.4, weight: 1.1, roll: 0.75, hit: 0.7,
               hard: 0.1, rollRing: [] }
};
// The rescued friends speak with the voice of what they are made of.
const VOICE_OF = { pip: 'classic', flurry: 'glass', cinder: 'classic', bobble: 'rubber', rivet: 'steel' };
export function marbleVoice(id) { return MARBLE_VOICES[id] || MARBLE_VOICES[VOICE_OF[id]] || MARBLE_VOICES.classic; }

// --- blending: a level fades from its theme to its themeTo -------------------
const lerp = (a, b, t) => a + (b - a) * t;
const glerp = (a, b, t) => Math.exp(lerp(Math.log(a), Math.log(b), t));   // frequencies blend on a log scale
function blendBand(a, b, t) { return { f: glerp(a.f, b.f, t), q: lerp(a.q, b.q, t), g: lerp(a.g, b.g, t) }; }
export function blendSurface(a, b, t) {
    t = Math.max(0, Math.min(1, Number(t) || 0));
    return {
        rumble: blendBand(a.rumble, b.rumble, t),
        body: blendBand(a.body, b.body, t),
        hiss: { f: glerp(a.hiss.f, b.hiss.f, t), g: lerp(a.hiss.g, b.hiss.g, t) },
        grain: { perUnit: lerp(a.grain.perUnit, b.grain.perUnit, t), f: glerp(a.grain.f, b.grain.f, t), q: lerp(a.grain.q, b.grain.q, t), g: lerp(a.grain.g, b.grain.g, t) },
        // Bumps and plate rings belong to one surface or the other, not a mix.
        tread: t < 0.5 ? a.tread : b.tread,
        ring: t < 0.5 ? a.ring : b.ring,
        loud: lerp(a.loud, b.loud, t),
        hard: lerp(a.hard, b.hard, t)
    };
}
// The rolling surface of a level (its theme blended toward themeTo).
export function surfaceForLevel(lv) {
    const a = SURFACES[lv && lv.theme] || SURFACES.workshop;
    const b = SURFACES[lv && lv.themeTo] || a;
    return blendSurface(a, b, lv && lv.blend);
}
// What the FLOOR rings like when the marble lands on it (a drop, a launch).
export const THEME_FLOOR = {
    workshop: 'wood', forest: 'foam', snowfield: 'foam', glacier: 'ice', cinder: 'rock', lava: 'rock',
    playroom: 'foam', toybox: 'plastic', rustworks: 'rust', foundry: 'steel'
};
// The theme a level is closer to (its themeTo past halfway).
function nearTheme(lv) { return lv && (Number(lv.blend) >= 0.5 && lv.themeTo ? lv.themeTo : lv.theme); }
// The wall material of a level.
export function wallForLevel(lv) {
    const key = nearTheme(lv);
    return WALLS[THEME_WALL[key]] ? THEME_WALL[key] : 'wood';
}
export function floorForLevel(lv) {
    const key = nearTheme(lv);
    return WALLS[THEME_FLOOR[key]] ? THEME_FLOOR[key] : 'wood';
}

// --- rolling ------------------------------------------------------------------
// WHAT THIS MARBLE ON THIS FLOOR SOUNDS LIKE. A roll is the two materials
// meeting, so neither decides it alone:
//  - CONTACT (the two hardnesses multiplied) sets how bright and hissy the
//    roll is and how much any plate rings: glass on ice is all sheen, glass
//    on snow is a muffled crunch, rubber on anything is a soft rumble.
//  - The MARBLE alone sets the top end (a rubber ball damps everything
//    above a few kHz, whatever it rolls on), the colour of the grit it
//    kicks up (a hard ball clicks, a soft one crunches), and the weight.
//  - The FLOOR alone sets its resonances (a hollow board booms, a play mat
//    does not), so the board is recognisable under any marble.
//  - A hard marble on a hard floor adds its OWN ring: steel on steel sings.
// The result has the surface's shape, plus cutoff (Hz, a lowpass on the
// whole roll), weight (the sub rumble), tick (tread plate's click) and rings
// [{ f, q, g }] (floor plate rings and the marble's own).
export function rollVoice(surface, marble) {
    const sh = surface.hard === undefined ? 0.6 : surface.hard;
    const mh = marble.hard === undefined ? 0.85 : marble.hard;
    const c = sh * mh;
    const lerpT = (a, b, t) => a + (b - a) * t;
    return {
        // A soft marble's energy goes into the low end rather than the hiss.
        rumble: { f: surface.rumble.f * lerpT(0.85, 1.05, mh), q: surface.rumble.q, g: surface.rumble.g * marble.weight * lerpT(2.2, 1, mh) },
        body: { f: surface.body.f * lerpT(0.75, 1.1, mh), q: surface.body.q, g: surface.body.g * lerpT(0.55, 1.15, c) },
        hiss: { f: surface.hiss.f * lerpT(0.7, 1.15, mh), g: surface.hiss.g * lerpT(0.15, 1.3, c) },
        grain: {
            perUnit: surface.grain.perUnit,
            f: surface.grain.f * lerpT(0.45, 1.15, mh),
            q: surface.grain.q,
            g: surface.grain.g * lerpT(0.5, 1.1, mh)
        },
        tread: surface.tread,
        tick: { f: 2600 * lerpT(0.5, 1.1, mh), g: 0.22 * lerpT(0.35, 1.2, mh) },
        rings: surface.ring.map(f => ({ f, q: 18, g: 0.25 * c }))
            .concat((marble.rollRing || []).map(r => ({ f: r.f, q: 24, g: r.g * Math.pow(sh, 1.5) }))),
        cutoff: lerpT(1600, 15000, mh) * lerpT(0.55, 1, sh),
        weight: 0.5 * surface.rumble.g * marble.weight * lerpT(1.2, 0.9, sh) * lerpT(1.8, 1, mh),
        loud: surface.loud * lerpT(0.85, 1.1, c),
        hard: sh
    };
}

export const ROLL_FULL_SPEED = 6;          // speed at which the roll is at full level (full tilt reaches ~7 down a long straight)
// The roll's mix at this speed: { gain, bright (filter multiplier), wobbleHz,
// grainRate (clicks/s), tickRate (bumps/s) }. Silent off the floor.
export function rollMix(speed, radius, surface, marble, onFloor = true) {
    const s = Math.max(0, Number(speed) || 0);
    if (!onFloor || s < 0.02) return { gain: 0, bright: 1, wobbleHz: 0, grainRate: 0, tickRate: 0 };
    const k = Math.min(1, s / ROLL_FULL_SPEED);
    // Loudness grows faster than speed (energy into the surface), with a soft
    // knee so a creeping marble is still just audible.
    const gain = Math.min(1, Math.pow(k, 1.35) * 0.95 + k * 0.05) * surface.loud * marble.roll;
    const r = Math.max(0.05, Number(radius) || 0.3);
    return {
        gain,
        bright: 0.8 + 0.6 * k,
        wobbleHz: s / (2 * Math.PI * r),
        grainRate: s * surface.grain.perUnit,
        tickRate: surface.tread > 0 ? s / surface.tread : 0
    };
}

// --- impacts ------------------------------------------------------------------
export const IMPACT_MIN_SPEED = 0.18;      // below this a touch is silent (resting, rolling along a wall)
export const IMPACT_FULL_SPEED = 6.0;
// How loud a hit at this normal speed is, 0..1.
export function impactStrength(normalSpeed) {
    const v = Math.abs(Number(normalSpeed) || 0);
    if (v < IMPACT_MIN_SPEED) return 0;
    return Math.min(1, Math.pow((v - IMPACT_MIN_SPEED) / (IMPACT_FULL_SPEED - IMPACT_MIN_SPEED), 1.2) + 0.04);
}
// The partials of one hit: the wall's modes (shortened by a damped marble) and
// the marble's ping (raised in pitch as the ball shrinks world by world).
export function impactPartials(wallKey, marble, radius, strength) {
    const wall = WALLS[wallKey] || WALLS.wood;
    const r = Math.max(0.05, Number(radius) || 0.3);
    const out = wall.modes.map(m => ({ f: m.f, decay: m.decay * marble.damp, amp: m.amp * strength * marble.hit * (m.f < 400 ? marble.weight : 1) }));
    for (const p of marble.ping) out.push({ f: p.f * (0.3 / r), decay: p.decay, amp: p.amp * strength * marble.hit });
    return out;
}

// --- space ------------------------------------------------------------------------
// Where a sound sits in stereo and how loud it arrives. Top-down, the listener
// is over the board: pan follows the source across the board, and level
// falls off gently with distance from the BALL (which is where the player is
// looking). Walking, the listener IS the ball, facing yaw: pan follows the
// source's bearing and level falls off faster.
export function spatial(src, ball, opts = {}) {
    const dx = src.x - ball.x, dz = src.z - ball.z;
    const d = Math.hypot(dx, dz);
    if (opts.walk) {
        const fx = -Math.sin(opts.yaw || 0), fz = -Math.cos(opts.yaw || 0);   // walkMode.js forwardOf
        const rx = Math.cos(opts.yaw || 0), rz = -Math.sin(opts.yaw || 0);    // rightOf
        const side = d > 1e-6 ? (dx * rx + dz * rz) / d : 0;
        const ahead = d > 1e-6 ? (dx * fx + dz * fz) / d : 1;
        // Behind you is a little duller as well as quieter.
        return { pan: clampPan(side * 0.85), gain: 1 / (1 + Math.pow(d / 1.6, 2)) * (ahead < 0 ? 0.8 : 1) };
    }
    const halfW = Math.max(1, (opts.width || 9) / 2);
    return { pan: clampPan((src.x / halfW) * 0.7), gain: 0.3 + 0.7 / (1 + Math.pow(d / 2.6, 2)) };
}
function clampPan(p) { return Math.max(-1, Math.min(1, p)); }

// --- ambience -----------------------------------------------------------------------
// The bed under each theme, all quiet: a room, wind in leaves, a glacier
// wind, a lava roar with bubbles, a factory hum. kind picks the engine's
// recipe; level is its gain.
export const AMBIENCE = {
    workshop: { kind: 'room', level: 0.035 },
    forest: { kind: 'leaves', level: 0.05 },
    snowfield: { kind: 'wind', level: 0.05 },
    glacier: { kind: 'wind', level: 0.07 },
    cinder: { kind: 'lava', level: 0.045 },
    lava: { kind: 'lava', level: 0.07 },
    playroom: { kind: 'room', level: 0.03 },
    toybox: { kind: 'room', level: 0.03 },
    rustworks: { kind: 'factory', level: 0.045 },
    foundry: { kind: 'factory', level: 0.06 }
};
// How much reverb each theme's space has: { seconds, wet }.
export const ROOMS = {
    workshop: { seconds: 0.7, wet: 0.14 }, forest: { seconds: 0.5, wet: 0.06 },
    snowfield: { seconds: 0.4, wet: 0.04 }, glacier: { seconds: 1.1, wet: 0.12 },
    cinder: { seconds: 0.9, wet: 0.1 }, lava: { seconds: 1.3, wet: 0.14 },
    playroom: { seconds: 0.5, wet: 0.08 }, toybox: { seconds: 0.6, wet: 0.1 },
    rustworks: { seconds: 1.4, wet: 0.16 }, foundry: { seconds: 1.9, wet: 0.2 }
};
// A level's ambience and room: those of the theme it is closer to.
export function spaceForLevel(lv) {
    const key = nearTheme(lv);
    const k = AMBIENCE[key] ? key : 'workshop';
    return { theme: k, ambience: AMBIENCE[k], room: ROOMS[k] };
}
