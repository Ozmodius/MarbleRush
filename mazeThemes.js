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
    // WORLD 3, MAGMA WORKS: levels say theme 'cinder', themeTo 'lava' and a
    // blend -- grey ash fields with dull seams cooling the first levels, black
    // basalt split by bright lava by the last. Holes switch to glowing lava
    // pools at the halfway level (mazeTheme3d.js SWITCH).
    'cinder': {
        id: 'cinder',
        name: 'Cinder Fields',
        rarity: 'rare',
        floorColor: '#6b6460', floorColor2: '#3b3532', floorRoughness: 0.95, floorMetalness: 0.0,
        floorPattern: 'lavaCracks', floorGlow: 0.25,
        wallColor: '#56504c', wallColor2: '#2c2826', wallRoughness: 0.9, wallMetalness: 0.0,
        wallStyle: 'rock', wallPattern: 'rock', wallGlow: 0, wallJag: 0.12,
        glowColor: '#c2410c',
        marbleColor: '#eef1f5', marbleRoughness: 0.14, marbleMetalness: 0.1,
        holeColor: '#0b0807',
        goalColor: '#3fd0ff',
        gateColor: '#7d6a5a',
        backdropColor: '#1d1614'
    },
    // WORLD 4, THE TOY BOX: levels say theme 'playroom', themeTo 'toybox'
    // and a blend. Foam play-mat tiles underfoot and walls of plastic bricks
    // with studs on top (toyWalls3d.js), soft pastels in the first levels and
    // bright primaries by the last. The marble is a pale pinball steel -- only
    // half metal, since full chrome mirrors the dark room and reads as a hole. The mat
    // stays light all the way, so dark holes and the hazards' bright plastic
    // always read against it.
    'playroom': {
        id: 'playroom',
        name: 'Playroom',
        rarity: 'rare',
        floorColor: '#f1e9da', floorColor2: '#d9e6ee', floorRoughness: 0.9, floorMetalness: 0.0,
        floorPattern: 'foamMat',
        wallColor: '#e8a3a3', wallRoughness: 0.4, wallMetalness: 0.0,
        wallStyle: 'bricks', brickSat: 0.38,
        marbleColor: '#e8ecf2', marbleRoughness: 0.14, marbleMetalness: 0.35,
        holeColor: '#1b1e2c',
        goalColor: '#16a34a',
        gateColor: '#6d5bd0',
        backdropColor: '#2b2433'
    },
    'toybox': {
        id: 'toybox',
        name: 'The Toy Box',
        rarity: 'epic',
        floorColor: '#f4efe4', floorColor2: '#a9cfe8', floorRoughness: 0.85, floorMetalness: 0.0,
        floorPattern: 'foamMat',
        wallColor: '#e03a3a', wallRoughness: 0.3, wallMetalness: 0.0,
        wallStyle: 'bricks', brickSat: 0.85,
        marbleColor: '#e8ecf2', marbleRoughness: 0.12, marbleMetalness: 0.35,
        holeColor: '#141826',
        goalColor: '#16a34a',
        gateColor: '#6d5bd0',
        backdropColor: '#1d1830'
    },
    // WORLD 5, THE FOUNDRY: levels say theme 'rustworks', themeTo 'foundry'
    // and a blend. Diamond tread plate underfoot and riveted steel walls,
    // rusty in the first levels and clean, working steel with hazard-striped
    // tops by the last (mazeSurface3d.js treadPlate / steelPanels; the rust
    // fades with the blend). The marble is hot orange, the one warm thing on
    // grey steel.
    'rustworks': {
        id: 'rustworks',
        name: 'Rustworks',
        rarity: 'rare',
        floorColor: '#7d7a76', floorColor2: '#8a4a22', floorRoughness: 0.75, floorMetalness: 0.35,
        floorPattern: 'treadPlate',
        wallColor: '#6a6560', wallColor2: '#7b3a18', wallRoughness: 0.6, wallMetalness: 0.4,
        wallPattern: 'steelPanels',
        marbleColor: '#ff6a2a', marbleRoughness: 0.25, marbleMetalness: 0.1,
        holeColor: '#0b0c0e',
        goalColor: '#7dff4f',
        gateColor: '#c99a22',
        backdropColor: '#1d1a17'
    },
    'foundry': {
        id: 'foundry',
        name: 'The Foundry',
        rarity: 'epic',
        floorColor: '#9aa1a8', floorColor2: '#5a6068', floorRoughness: 0.45, floorMetalness: 0.6,
        floorPattern: 'treadPlate',
        wallColor: '#4a5058', wallColor2: '#2c3036', wallRoughness: 0.4, wallMetalness: 0.6,
        wallPattern: 'steelPanels',
        marbleColor: '#ff6a2a', marbleRoughness: 0.25, marbleMetalness: 0.1,
        holeColor: '#08090b',
        goalColor: '#7dff4f',
        gateColor: '#e0b020',
        backdropColor: '#14171b'
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
        // Near black, not a lava orange: world 3 is full of gold coins and orange
        // seams, and a hole must never look like either.
        holeColor: '#120403',
        holeRim: '#ff4d1a',
        goalColor: '#3fd0ff',
        // Ordinary gates here are dull bronze slabs. MOLTEN gates -- the
        // world 3 trap -- always wear the molten pattern (mazeTheme3d.js
        // makeMoltenGateMaterial), so the two can never be confused.
        gateColor: '#8a6a3c',
        backdropColor: '#140604'
    }
};
