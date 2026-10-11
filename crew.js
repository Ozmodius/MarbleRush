// THE CREW (the user's call, 2026-10-10): every marble is a character, and
// each one ADVANCES. Pure numbers and rules; the save fields live in
// progressStore.js, the run's side in mazeGame.js, the page in crewUi.js.
//
// SIGNATURES: each character carries one trick, FREE a set number of times
// per run (once, twice after their second upgrade) -- never a permanent
// bonus. A run is one attempt: every restart gets them back.
//   auto  fires by itself the first time its hazard would hurt or hold the
//         ball (`covers`, the kinds mazeGame.js asks about)
//   tap   a HUD button, used when the player chooses (`power`)
// A friend's signature answers their own planet's trap. Once a planet is
// opened, the same answer is sold in the Store as a TRAP CHARGE any
// character can carry (shopCatalog.js CHARGES with `cover`): one is armed
// per run and spent only when it fires, after the signature's free uses.
//
// BOND: clearing a level AS a character earns that character bond XP (a
// first clear, a replay, a first gold). Each bond level opens the next step
// of their track; coins buy it. Bond is earned, never sold.
//
// THE TRACK, the same four steps for everyone:
//   1 tuned      a little more of the character's own handling
//   2 twice      the signature twice a run
//   3 tuned II   a little more again
//   4 aura       a glow of their own colour under the ball (looks only)
// CLAUDE.md's rule holds: control and forgiveness, never top speed or a
// smaller ball. Tuning only ever adds grip, stopping or tilt response.

export const SIGNATURES = {
    classic: { name: 'Coin Sense', kind: 'tap', power: 'magnet', blurb: 'Tap it during a run: nearby coins roll to Rolle for 8 seconds.' },
    steel: { name: 'Iron Shell', kind: 'auto', covers: ['crush', 'gust'], blurb: 'The first press cannot crush Sterling, and the first gust cannot push him.' },
    rubber: { name: 'Hole Hop', kind: 'auto', covers: ['fall'], blurb: 'Bumper bounces back out of his first fall.' },
    glass: { name: 'Clear Sight', kind: 'tap', power: 'sight', blurb: 'Tap it during a run: for 6 seconds false walls shimmer, and light marks the fuel cell and any diary page.' },
    pip: { name: 'Sure Foot', kind: 'auto', covers: ['belt'], blurb: 'The first conveyor belt cannot carry Pip.' },
    flurry: { name: 'Ice Skates', kind: 'auto', covers: ['ice'], blurb: 'Full grip across the first patch of ice.' },
    cinder: { name: 'Fire Shield', kind: 'auto', covers: ['burn'], blurb: 'The first lava flare or molten gate cannot burn Cinder.' },
    bobble: { name: 'Shrug', kind: 'auto', covers: ['bump'], blurb: 'The first bumper or spring barely moves Bobble.' },
    rivet: { name: 'Demagnetize', kind: 'auto', covers: ['magnet'], blurb: 'The first magnet cannot grab Rivet.' }
};

// How long one use keeps covering once it fires (ms of run time). A burn or
// a crush is a moment: the window stops the same flare burning a frame later.
// Contact traps (ice, a belt, a magnet, a gust) are covered for as long as
// the ball stays in that one and a moment after it leaves.
export const COVER = {
    burn: { windowMs: 1500 }, crush: { windowMs: 1500 }, bump: { windowMs: 600 },
    ice: { lingerMs: 300 }, belt: { lingerMs: 300 }, magnet: { lingerMs: 300 }, gust: { lingerMs: 300 }
};
export const SIGHT_MS = 6000;

// Each character's handling, a little more per tuned step.
export const TUNE = {
    classic: { stat: 'grip', per: 0.02, label: 'grip' },
    steel: { stat: 'damping', per: 0.02, label: 'stopping' },
    rubber: { stat: 'grip', per: 0.03, label: 'grip' },
    glass: { stat: 'response', per: 0.05, label: 'response' },
    pip: { stat: 'grip', per: 0.03, label: 'grip' },
    flurry: { stat: 'response', per: 0.05, label: 'response' },
    cinder: { stat: 'damping', per: 0.02, label: 'stopping' },
    bobble: { stat: 'grip', per: 0.03, label: 'grip' },
    rivet: { stat: 'damping', per: 0.02, label: 'stopping' }
};
export const TUNE_STATS = ['grip', 'damping', 'response'];   // the only stats a step may add to

// Bond levels: the XP each needs (level 1 is where everyone starts).
export const BOND_LEVELS = [0, 100, 300, 600, 1000];
export const BOND_MAX = BOND_LEVELS.length;
export const BOND_XP = { firstClear: 40, replay: 15, goldFirst: 20 };

// The track: what each step needs and costs.
export const TRACK = [
    { step: 1, kind: 'tune', bond: 2, price: 300 },
    { step: 2, kind: 'twice', bond: 3, price: 700 },
    { step: 3, kind: 'tune', bond: 4, price: 1200 },
    { step: 4, kind: 'aura', bond: 5, price: 2000 }
];
export const TRACK_MAX = TRACK.length;

export function bondInfo(xp) {
    const n = Math.max(0, Math.floor(Number(xp) || 0));
    let level = 1;
    for (let i = 0; i < BOND_LEVELS.length; i++) if (n >= BOND_LEVELS[i]) level = i + 1;
    const from = BOND_LEVELS[level - 1], to = level < BOND_MAX ? BOND_LEVELS[level] : null;
    return { level, xp: n, from, to, max: level >= BOND_MAX };
}

// The bond a clear earns: from the store's clear result.
export function bondForClear(result) {
    if (!result || !result.accepted) return 0;
    return (result.firstClear ? BOND_XP.firstClear : BOND_XP.replay) + (result.goldFirst ? BOND_XP.goldFirst : 0);
}

export const crewStep = (progress, id) => Math.max(0, Math.min(TRACK_MAX, ((progress && progress.crew) || {})[id] | 0));
export const bondOf = (progress, id) => bondInfo(((progress && progress.bond) || {})[id]);

// The next step for a character: { step, kind, bond, price, ready } or null
// when the track is done. `ready` is false until the bond level is reached.
export function nextStep(progress, id) {
    const s = crewStep(progress, id);
    if (s >= TRACK_MAX) return null;
    const t = TRACK[s];
    return { ...t, ready: bondOf(progress, id).level >= t.bond };
}

// Free uses of the signature per run, for a character at its track step.
export const signatureUses = (step) => (step >= 2 ? 2 : 1);
export const hasAura = (step) => step >= 4;

// The handling a character's tuned steps add: { grip, damping, response }.
export function tuneFor(id, step) {
    const t = TUNE[id];
    const add = { grip: 0, damping: 0, response: 0 };
    if (!t) return add;
    const n = (step >= 1 ? 1 : 0) + (step >= 3 ? 1 : 0);
    add[t.stat] = n * t.per;
    return add;
}
