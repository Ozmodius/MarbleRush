// World names, from docs/PLAN.md's world table. Display only: what a world
// contains is mazeLevels.json, and its look is the theme each level names.
export const WORLD_NAMES = {
    1: 'Workshop', 2: 'Glacier', 3: 'Magma Works', 4: 'Toy Box', 5: 'Foundry',
    6: 'Swamp', 7: 'Crypt', 8: 'Desert Temple', 9: 'Sky Islands', 10: 'Cosmos'
};
export function worldName(n) { return WORLD_NAMES[n] || ('World ' + n); }
export const LAUNCH_WORLDS = 5;   // docs/PLAN.md: worlds 1-5 ship at launch; the system shows these
