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
//
// THE CARD OPENS A PLANET (the user's call, 2026-10-15: "move the rescue card
// from the last floor on a world to the first floor of each world"): on its
// floor 1, it says who the Baron has caged up on floor 10 and what freeing
// them takes, so the planet's ten floors are a climb toward them. Its button
// starts the run: a new player whose first screen it is stays one tap from
// playing, and `howTo` (in the device's words) says how to steer.
export function storyCard(world, firstEver, howTo = '') {
    const c = captiveFor(world);
    if (!c) return null;
    const planet = worldName(world);
    return {
        title: firstEver ? 'ROLLE TO THE RESCUE' : `${c.name.toUpperCase()} IS ON ${planet.toUpperCase()}`,
        lines: [
            ...(firstEver ? [`${VILLAIN} wound up five planets like clocks. To keep them ticking, he kidnapped Rolle's friends from MarbleTopia and set them rolling his maze-engines.`] : []),
            `The Baron has caged ${c.name} at the top of ${planet}, on floor ${RESCUE_FLOOR}.`,
            `Climb the floors, then roll through the cage to free ${c.name}. That floor's exit stays locked until you do.`,
            ...(firstEver ? ['And grab the fuel cell hidden in every maze: Rolle\'s ship needs them to fly on to the next planet.'] : []),
            ...(firstEver && howTo ? [howTo] : [])
        ],
        go: `GO GET ${c.name.toUpperCase()}!`
    };
}
export const readyLine = (world) => { const c = captiveFor(world); return c ? `FIND ${c.name.toUpperCase()}'S CAGE, THEN ESCAPE` : ''; };
export const lockedLine = (world) => { const c = captiveFor(world); return c ? `FREE ${c.name.toUpperCase()} FIRST!` : ''; };
export const freedLine = (world) => { const c = captiveFor(world); return c ? `${c.name.toUpperCase()} IS FREE!  NOW ESCAPE` : ''; };
export const joinedLine = (world) => { const c = captiveFor(world); return c ? `${c.name.toUpperCase()} JOINS YOU!  ROLL AS ${c.name.toUpperCase()} FROM CREW` : ''; };

// THE STORY'S VOICES (the user's call, 2026-10-10): the Baron taunts Rolle
// on each planet's first level (not Sawturn's: a new player's first screen
// keeps its how-to line) and a freed friend points to the next planet. And
// on floors 3, 6 and 9 of every
// planet (the user's call, 2026-10-15: "you can't get past my next trap!")
// the Baron brags about what is ahead -- his own traps, by name -- floor 9's
// naming the cage one floor up while the friend is still in it.
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
export const BARON_FLOORS = [3, 6, 9];
const BRAGS = {
    1: ["YOU CAN'T GET PAST MY NEXT TRAP, ROLLE!",
        'MY MILL GRINDS MARBLES TO SAWDUST. TURN BACK!',
        'SPLINTERWOOD WILL BE YOUR LAST ROLL!'],
    2: ["ICE AHEAD! YOU'LL SLIDE RIGHT INTO MY NEXT TRAP!",
        'FEEL THAT WIND? IT BLOWS TOWARD MY HOLES!',
        'MY AVALANCHE IS COMING FOR YOU, ROLLE!'],
    3: ['HOT ENOUGH? MY NEXT TRAP BURNS HOTTER!',
        'MY FLARES ONLY GET FASTER FROM HERE!',
        'NOTHING ROLLS OUT OF MY SMELTER!'],
    4: ['BOING! MY NEXT TRAP BOUNCES YOU INTO A HOLE!',
        "MY SPRINGS ARE WOUND TIGHT. ENJOY THE FLIGHT!",
        'MY TOY SOLDIERS NEVER LET A MARBLE PASS!'],
    5: ['MY MAGNETS WILL DRAG YOU RIGHT OFF COURSE!',
        'MY PRESSES DROP ON THE BEAT. KEEP UP IF YOU CAN!',
        'THE NIGHT SHIFT NEVER SLEEPS, AND NEITHER DO MY TRAPS!']
};
// The Baron on floor 3, 6 or 9 of `world` ('' on any other floor). `caged`:
// the world's friend is still in the cage on floor 10.
export function baronFloorLine(world, floor, caged) {
    const k = BARON_FLOORS.indexOf(floor);
    if (k < 0 || !BRAGS[world]) return '';
    const c = captiveFor(world);
    if (floor === RESCUE_FLOOR - 1 && caged && c) return `BARON: ${c.name.toUpperCase()}'S CAGE IS ONE FLOOR UP. YOU'LL NEVER GET PAST MY NEXT TRAP!`;
    return 'BARON: ' + BRAGS[world][k];
}
export const friendLine = (world) => { const c = captiveFor(world); return c && FRIEND_SAYS[world] ? `${c.name.toUpperCase()}: ${FRIEND_SAYS[world]}` : ''; };

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
// The generator (scripts/generateMazeLevels.js) tries candidates under one id.
export function forgetCaptiveSpot(id) { cache.delete(id); }
export function captiveSpot(lv) {
    if (!isRescueLevel(lv)) return null;
    if (cache.has(lv.id)) return cache.get(lv.id);
    const out = pickSpot(lv, { bands: [[0.25, 0.6], [0.12, 0.6]], score: ({ x, z, g }) => offRoute(g, x, z) });
    cache.set(lv.id, out);
    return out;
}
