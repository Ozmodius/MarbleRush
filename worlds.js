// World names. Display only: what a world contains is mazeLevels.json, and
// its look is the theme each level names.
//
// Every world is a PLANET with a name of its own (the user's call,
// 2026-10-08, once home became a solar system), and every level is a place
// on it, named by the level's own name -- so there is no "World 1" anywhere
// a player looks. WORLD_NAMES is what each world IS, for the docs and the
// admin page; a world with no planet name yet falls back to it.
// Puns, each the best one for its world (the user's pick, 2026-10-08):
// a saw + Saturn, slip + stone, magma + Mars, bounce + Camelot, gear + Earth.
export const PLANET_NAMES = { 1: 'Sawturn', 2: 'Slipstonia', 3: 'Magmars', 4: 'Bouncelot', 5: 'Gearth' };
export const WORLD_NAMES = {
    1: 'Workshop', 2: 'Glacier', 3: 'Magma Works', 4: 'Toy Box', 5: 'Foundry',
    6: 'Swamp', 7: 'Crypt', 8: 'Desert Temple', 9: 'Sky Islands', 10: 'Cosmos'
};
export function worldName(n) { return PLANET_NAMES[n] || WORLD_NAMES[n] || ('World ' + n); }
export const LAUNCH_WORLDS = 5;   // docs/PLAN.md: worlds 1-5 ship at launch; the system shows these
