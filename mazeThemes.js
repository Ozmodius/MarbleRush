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
        backdropColor: '#241a10',
        // Boards and planks, drawn procedurally (mazeSurface3d.js). The floor
        // pattern is world 1's: boards that give way to a dirt path as a
        // level's blend toward 'forest' rises.
        floorPattern: 'woodToDirt', wallPattern: 'planks'
    },
    // World 1's destination. A level never uses this alone: world 1's levels
    // say theme 'workshop', themeTo 'forest' and a blend, and the colours here
    // are mixed in by that blend (mazeTheme3d.js resolveLevelTheme), while
    // walls turn into tree trunks one by one (forestDressing.js).
    'forest': {
        id: 'forest',
        name: 'The Forest',
        rarity: 'rare',
        floorColor: '#6b4a2e', floorRoughness: 1.0, floorMetalness: 0.0,
        wallColor: '#5a4128', wallRoughness: 0.9, wallMetalness: 0.0,
        marbleColor: '#f4f1ea', marbleRoughness: 0.2, marbleMetalness: 0.0,
        holeColor: '#0a0704',
        // Gold, not green: a green ring would vanish into the moss.
        goalColor: '#f2c14e',
        gateColor: '#8a5a32',
        backdropColor: '#0e1a0d',
        floorPattern: 'woodToDirt', wallPattern: 'planks'
    },
    // WORLD 2, THE GLACIER: levels say theme 'snowfield', themeTo 'glacier'
    // and a blend, so snowy rock at the treeline turns to clear blue ice as
    // the world goes on (mazeTheme3d.js resolveLevelTheme). The floor is snow
    // throughout, so an ICE patch -- the hazard -- always reads as different
    // ground: glassy, blue and dark against white.
    'snowfield': {
        id: 'snowfield',
        name: 'Snowfield',
        rarity: 'rare',
        floorColor: '#e9eef4', floorColor2: '#c5d3e2', floorRoughness: 0.85, floorMetalness: 0.0,
        wallColor: '#6f7882', wallColor2: '#3d444d', wallRoughness: 0.85, wallMetalness: 0.0,
        wallStyle: 'rock', wallJag: 0.1,
        floorPattern: 'snow', wallPattern: 'iceRock',
        marbleColor: '#2b3a55', marbleRoughness: 0.2, marbleMetalness: 0.2,
        holeColor: '#0b1622',
        goalColor: '#ff6a3d',
        iceColor: '#5fb6e6',
        gateColor: '#b8572f',
        backdropColor: '#1c2733'
    },
    'glacier': {
        id: 'glacier',
        name: 'The Glacier',
        rarity: 'epic',
        floorColor: '#eaf2fa', floorColor2: '#bcd2e8', floorRoughness: 0.75, floorMetalness: 0.0,
        wallColor: '#7fc4ec', wallColor2: '#2f6f9e', wallRoughness: 0.25, wallMetalness: 0.05,
        wallStyle: 'rock', wallJag: 0.12,
        floorPattern: 'snow', wallPattern: 'iceRock',
        marbleColor: '#2b3a55', marbleRoughness: 0.2, marbleMetalness: 0.2,
        holeColor: '#06101a',
        goalColor: '#ff6a3d',
        iceColor: '#4aa6dc',
        gateColor: '#b8572f',
        backdropColor: '#0d1824'
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
    },
    // The first theme built on shape and surface rather than colour alone:
    // craggy black rock walls (mazeWalls3d.js) and procedural basalt with lava
    // seams (mazeSurface3d.js). Holes are lava pools, so the brightest thing on the
    // board is the thing that ends your run; the seams glow far dimmer so they
    // never read as a hazard. The goal is cold blue, the one cool colour here.
    'lava': {
        id: 'lava',
        name: 'Magma Works',
        rarity: 'epic',
        floorColor: '#4a3730', floorColor2: '#1a1311', floorRoughness: 0.9, floorMetalness: 0.0,
        floorPattern: 'lavaCracks', floorGlow: 0.9,
        // Cooled lava: near-black basalt, no glow. A little sheen (roughness
        // under 1) so the crags' facets catch the light -- matte black would
        // read as a hole in the screen rather than as rock.
        wallColor: '#1a1817', wallColor2: '#070606', wallRoughness: 0.7, wallMetalness: 0.0,
        wallStyle: 'rock', wallPattern: 'rock', wallGlow: 0, wallJag: 0.14,
        glowColor: '#e0340a',
        marbleColor: '#eef1f5', marbleRoughness: 0.14, marbleMetalness: 0.1,
        holeColor: '#ff7a1f',
        goalColor: '#3fd0ff',
        // Gates are lava that has not set yet: molten, crusted, glowing. A wall
        // that is about to move must look different from one that never will,
        // and on a board of black rock nothing reads more "not solid" than this.
        gateColor: '#3a1a10', gatePattern: 'molten', gateGlow: 2.2,
        backdropColor: '#140604'
    }
};
