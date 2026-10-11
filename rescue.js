// THE RESCUE (the user's call, 2026-10-09): the story that ties the planets
// together, and where on each planet's floor 10 the captive is hidden.
//
// Rolle, a marble from MarbleTopia, sets out after Baron Von Ratchet. The
// Baron wound up five planets like clocks, and to keep them ticking he
// kidnapped Rolle's friends and set them rolling his maze-engines forever.
// Each friend is caged deep in the labyrinth on a planet's floor 10. Roll
// through the cage to free them -- the exit stays locked until then -- and
// escape. A friend freed joins the player as a marble (shopCatalog.js MARBLES
// with `rescue: <world>`).
//
// WHERE THE CAGE GOES is worked out from the level itself, never stored in
// mazeLevels.json: the levels are seeded and byte-for-byte reproducible, and
// every gold time is tuned to them. captiveSpot() is pure and deterministic;
// test_rescue.js checks every floor 10's spot is clear of every trap, off the
// main route, and reachable from the start and back to the exit.

import { MARBLES } from './shopCatalog.js';
import { pickSpot, offRoute } from './levelSpots.js';
import { worldName } from './worlds.js';

export const VILLAIN = 'Baron Von Ratchet';
export const HERO = 'classic';             // Rolle
export const RESCUE_FLOOR = 10;            // the floor of each world the captive is on

// The friend held on each world: the marble whose `rescue` is that world.
export function captiveFor(world) {
    const id = Object.keys(MARBLES).find(k => MARBLES[k].rescue === world);
    return id ? { id, name: MARBLES[id].name, look: MARBLES[id].look, swatch: MARBLES[id].swatch } : null;
}

// A level a captive is held on: a world's floor 10 (a ladder level).
export function isRescueLevel(lv) {
    return !!(lv && Number.isInteger(lv.world) && Number.isInteger(lv.index) && lv.index === (lv.world - 1) * 10 + RESCUE_FLOOR
        && captiveFor(lv.world));
}

// The words, kept together so the story reads the same everywhere.
export function storyCard(world, firstEver) {
    const c = captiveFor(world);
    if (!c) return null;
    const planet = worldName(world);
    return {
        title: firstEver ? 'ROLLE TO THE RESCUE' : `${c.name.toUpperCase()} IS HERE`,
        lines: [
            ...(firstEver ? [`${VILLAIN} wound up five planets like clocks. To keep them ticking, he kidnapped Rolle's friends from MarbleTopia and set them rolling his maze-engines.`] : []),
            `${c.name} is caged somewhere in this maze on ${planet}.`,
            `Roll through the cage to free ${c.name}. The exit stays locked until you do.`
        ],
        go: `FREE ${c.name.toUpperCase()}!`
    };
}
export const readyLine = (world) => { const c = captiveFor(world); return c ? `FIND ${c.name.toUpperCase()}'S CAGE, THEN ESCAPE` : ''; };
export const lockedLine = (world) => { const c = captiveFor(world); return c ? `FREE ${c.name.toUpperCase()} FIRST!` : ''; };
export const freedLine = (world) => { const c = captiveFor(world); return c ? `${c.name.toUpperCase()} IS FREE!  NOW ESCAPE` : ''; };
export const joinedLine = (world) => { const c = captiveFor(world); return c ? `${c.name.toUpperCase()} JOINS YOU!  ROLL AS ${c.name.toUpperCase()} FROM GEAR` : ''; };

// THE STORY'S VOICES (the user's call, 2026-10-10): the Baron taunts Rolle
// on each planet's first level (not Sawturn's: a new player's first screen
// keeps its how-to line), a freed friend points to the next planet, and
// floor 9 warns that the cage is near.
const TAUNTS = {
    2: "SLIPSTONIA'S ICE WILL STOP YOU COLD, ROLLE!",
    3: 'NO MARBLE SURVIVES THE MAGMA WORKS!',
    4: 'MY TOYS WILL BOUNCE YOU RIGHT OUT!',
    5: "WELCOME TO MY FOUNDRY. YOU'LL NEVER LEAVE."
};
const FRIEND_SAYS = {
    1: 'THE BARON FLED TO SLIPSTONIA!',
    2: 'HE DRAGGED CINDER OFF TO MAGMARS!',
    3: "BOBBLE'S TRAPPED ON BOUNCELOT!",
    4: "RIVET'S IN HIS FOUNDRY ON GEARTH!",
    5: "THE BARON GOT AWAY\u2026 BUT WE'RE ALL FREE!"
};
export const baronLine = (world) => (TAUNTS[world] ? 'BARON: ' + TAUNTS[world] : '');
export const friendLine = (world) => { const c = captiveFor(world); return c && FRIEND_SAYS[world] ? `${c.name.toUpperCase()}: ${FRIEND_SAYS[world]}` : ''; };
export const nearLine = (world) => { const c = captiveFor(world); return c ? `${c.name.toUpperCase()}'S CAGE IS ON THE NEXT FLOOR. HANG ON, ${c.name.toUpperCase()}!` : ''; };

// How close the ball must come to free the captive (centre to centre).
export const CAPTIVE_REACH = 0.42;

// --- where the cage goes --------------------------------------------------------
// The cage's spot on a rescue level: { x, z, detour, route }, or null if none
// fits (levelSpots.js does the finding). Hidden means OFF the way to the
// exit -- a detour the player has to go looking for -- but not the far end
// of the board: the detour is kept to between a quarter (else an eighth) and
// three fifths of the start-to-exit route, and among those the spot farthest
// from the route wins (a side branch, not a bulge).
const cache = new Map();
export function captiveSpot(lv) {
    if (!isRescueLevel(lv)) return null;
    if (cache.has(lv.id)) return cache.get(lv.id);
    const out = pickSpot(lv, { bands: [[0.25, 0.6], [0.12, 0.6]], score: ({ x, z, g }) => offRoute(g, x, z) });
    cache.set(lv.id, out);
    return out;
}
