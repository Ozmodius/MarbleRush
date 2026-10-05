// The maze THEMES -- the whole look of one maze (floor, walls, ball, holes,
// goal ring, backdrop), bound to a level by mazeLevels.json's `theme` field.
//
// Lifted verbatim from 3dBallSmack's cosmetics.js `mazeTheme` block when
// Marble Rush was split out. In Ball Smack a theme is an admin-authored
// cosmetic; here there is no cosmetics catalog, so this file IS the catalog.
// Imports nothing, so the Node verifier (test_maze_levels.js) can read it.
export const MAZE_THEMES = {
    'workshop': {
        id: 'workshop',
        name: 'The Workshop',
        rarity: 'common',
        floorColor: '#d8b483', floorRoughness: 0.95, floorMetalness: 0.0,
        wallColor: '#8a6a44', wallRoughness: 0.82, wallMetalness: 0.05,
        marbleColor: '#f2f2f2', marbleRoughness: 0.18, marbleMetalness: 0.0,
        holeColor: '#120c07',
        goalColor: '#2a9d5f',
        backdropColor: '#241a10'
    },
    'slate': {
        id: 'slate',
        name: 'Cold Storage',
        rarity: 'rare',
        floorColor: '#8f949b', floorRoughness: 0.88, floorMetalness: 0.08,
        wallColor: '#4d545c', wallRoughness: 0.7, wallMetalness: 0.18,
        marbleColor: '#e8eef5', marbleRoughness: 0.12, marbleMetalness: 0.35,
        holeColor: '#0a0c0f',
        goalColor: '#4fb3d9',
        backdropColor: '#161a1f'
    },
    'neon': {
        id: 'neon',
        name: 'After Hours',
        rarity: 'epic',
        floorColor: '#241b33', floorRoughness: 0.55, floorMetalness: 0.2,
        wallColor: '#4c2f6b', wallRoughness: 0.4, wallMetalness: 0.45,
        marbleColor: '#ffe9a8', marbleRoughness: 0.08, marbleMetalness: 0.15,
        holeColor: '#07050c',
        goalColor: '#ff5fc8',
        backdropColor: '#0d0916'
    }
};
