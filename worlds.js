// World names. Display only: what a world contains is mazeLevels.json, and
// its look is the theme each level names.
//
// Every world is a PLANET with a name of its own (the user's call,
// 2026-10-08, once home became a solar system), and a PLACE -- what you find
// there, docs/PLAN.md's world table -- shown beside it: "Timbera · the
// Workshop". worldName is the planet's; a world with no planet name yet
// falls back to its place.
export const PLANET_NAMES = { 1: 'Timbera', 2: 'Frostara', 3: 'Pyros', 4: 'Jumbly', 5: 'Ferron' };
export const WORLD_NAMES = {
    1: 'Workshop', 2: 'Glacier', 3: 'Magma Works', 4: 'Toy Box', 5: 'Foundry',
    6: 'Swamp', 7: 'Crypt', 8: 'Desert Temple', 9: 'Sky Islands', 10: 'Cosmos'
};
// Places read as "the Workshop", except a proper name ("Magma Works").
const NO_ARTICLE = new Set([3]);
export function placeName(n) {
    const p = WORLD_NAMES[n];
    if (!p) return 'World ' + n;
    return NO_ARTICLE.has(n) ? p : 'the ' + p;
}
export function worldName(n) { return PLANET_NAMES[n] || WORLD_NAMES[n] || ('World ' + n); }
// "Timbera · the Workshop"; just the place for a world with no planet name.
export function worldTitle(n) { return PLANET_NAMES[n] ? `${PLANET_NAMES[n]} · ${placeName(n)}` : worldName(n); }
export const LAUNCH_WORLDS = 5;   // docs/PLAN.md: worlds 1-5 ship at launch; the system shows these
