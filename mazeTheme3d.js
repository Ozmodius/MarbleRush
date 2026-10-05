import * as THREE from 'three';
import { MAZE_THEMES } from './mazeThemes.js';
import { applyPbrMaps } from './pbrTextures.js';
import { applySurface } from './mazeSurface3d.js';
import { buildWallGeometry } from './mazeWalls3d.js';

// MAZE THEME -> THREE.js MATERIALS. The single place a mazeTheme cosmetic turns
// into something renderable.
//
// It exists as its own module because TWO very different callers need the exact
// same answer:
//   - mazeGame.js, building the real level a player rolls through;
//   - cosmeticPreview3d.js, showing an admin what the theme they are typing
//     looks like, before it is saved.
// If each built its own materials the preview would drift from the game, and a
// preview that lies is worse than no preview -- an author would tune colours
// against a render nobody else ever sees.
//
// It imports `three` and `pbrTextures.js` but deliberately NOT `scene3d.js` or
// `mazeGame.js`. The admin console reaches this through cosmeticPreview3d.js,
// and pulling the game scene (and cannon-es with it) into the admin bundle to
// draw a preview would be absurd. Hard Rule 3 still applies: bare `three`
// specifier, so this file must never get a <script> tag.

export const THEME_FALLBACK_ID = 'workshop';

// Hard defaults, used when neither the chosen theme nor the fallback theme has
// a value. They match the built-in 'workshop' theme, so a theme authored with
// only the three required colours still renders as a coherent maze rather than
// as black plastic.
const HARD_DEFAULTS = {
    floorColor: '#d8b483', floorRoughness: 0.95, floorMetalness: 0.0, floorTextureTile: 4,
    wallColor: '#8a6a44', wallRoughness: 0.82, wallMetalness: 0.05, wallTextureTile: 4,
    marbleColor: '#f2f2f2', marbleRoughness: 0.18, marbleMetalness: 0.0,
    holeColor: '#120c07', goalColor: '#2a9d5f', backdropColor: '#241a10',
    // HAZARDS. Both default to something legible against the workshop theme so
    // a level can use ice or a gate before anyone has authored colours for them.
    // Ice is deliberately a separate colour from the floor rather than a
    // lightened version of it: a patch the player cannot SEE is not a hazard,
    // it is an unexplained loss of control, and an author tuning a dark floor
    // would otherwise have to discover that for themselves.
    iceColor: '#bfe6f5',
    gateColor: '#b5542f',
    // SHAPE AND SURFACE. Every default is the original look -- sharp boxes,
    // flat colour -- so a theme opts in to rock rather than discovering it.
    //   wallStyle      'box' | 'rock' (mazeWalls3d.js): rounded, jagged crests
    //   wallBevel      crest rounding radius for 'rock', world units
    //   wallJag        how far a 'rock' crest heaves up and down
    //   floorPattern   'plain' | 'rock' | 'lavaCracks' (mazeSurface3d.js)
    //   wallPattern    'plain' | 'rock' | 'emberRock'
    //   floorColor2,
    //   wallColor2     the second colour a pattern mixes toward; '' derives a
    //                  darker shade of the main colour
    //   glowColor      what the hot parts of a pattern glow
    //   floorGlow,
    //   wallGlow       glow strength; 0 turns it off
    //   patternScale   rock features per world unit (bigger = finer)
    wallStyle: 'box', wallBevel: 0.07, wallJag: 0.06,
    floorPattern: 'plain', wallPattern: 'plain',
    floorColor2: '', wallColor2: '',
    glowColor: '#ff5a14', floorGlow: 0, wallGlow: 0,
    patternScale: 1
};

// Accepts either a theme ID (the game: a level names its theme) or a raw
// definition object (the admin preview: the draft being typed isn't in the
// catalog yet, and may never be saved).
export function resolveMazeTheme(source) {
    const themes = MAZE_THEMES;
    const chosen = (typeof source === 'string')
        ? (themes[source] || themes[THEME_FALLBACK_ID] || {})
        : (source && typeof source === 'object' ? source : (themes[THEME_FALLBACK_ID] || {}));
    const base = themes[THEME_FALLBACK_ID] || {};

    const out = {};
    for (const key of Object.keys(HARD_DEFAULTS)) {
        out[key] = chosen[key] !== undefined ? chosen[key]
            : (base[key] !== undefined ? base[key] : HARD_DEFAULTS[key]);
    }
    // PBR bundles are NOT inherited from the fallback theme, unlike every
    // scalar above. Quietly dressing a new theme in the default theme's
    // textures reads as a bug rather than a default -- an author who set no
    // maps meant flat colour, and should see flat colour.
    out.floorTextures = (chosen.floorTextures && typeof chosen.floorTextures === 'object') ? chosen.floorTextures : null;
    out.wallTextures = (chosen.wallTextures && typeof chosen.wallTextures === 'object') ? chosen.wallTextures : null;
    return out;
}

// Tiling is authored "per 10 world units" so one number reads the same on a
// small level and a large one. An absolute repeat count would stretch on a big
// floor and pack on a small one, forcing a level author to re-tune the theme
// every time they resized their maze.
export function tileRepeat(perTenUnits, extentUnits) {
    const n = (Number.isFinite(perTenUnits) ? perTenUnits : 4) * (extentUnits / 10);
    return Math.max(0.25, n);
}

// three MULTIPLIES the scalar roughness/metalness by the corresponding map, so
// a theme with a roughness map and roughness 0.95 renders at 0.95x the map's
// values -- subtly wrong, and invisible in the editor. Once a map is supplied it
// is the authority and the scalar goes to 1. diceBox3d.js applies the same
// correction for the same reason.
function forceMapScalars(material, textures) {
    if (!textures) return;
    if (textures.roughnessMap) material.roughness = 1.0;
    if (textures.metalnessMap) material.metalness = 1.0;
}

// The second colour a pattern mixes toward. Unset means "a darker shade of the
// main colour", so a theme can turn on rock with one field and still look like
// itself.
function secondColor(main, second) {
    return second ? new THREE.Color(second) : new THREE.Color(main).multiplyScalar(0.55);
}

export function makeFloorMaterial(theme, extentUnits = 10) {
    const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.floorColor),
        roughness: theme.floorRoughness,
        metalness: theme.floorMetalness
    });
    if (theme.floorTextures) {
        applyPbrMaps(mat, theme.floorTextures, tileRepeat(theme.floorTextureTile, extentUnits));
        forceMapScalars(mat, theme.floorTextures);
    }
    return applySurface(mat, {
        pattern: theme.floorPattern, color2: secondColor(theme.floorColor, theme.floorColor2),
        glowColor: theme.glowColor, glow: theme.floorGlow, scale: theme.patternScale, bump: 1
    });
}

// Wall geometry carries its own texture coordinates, laid out per world unit
// (mazeWalls3d.js), so a wall texture keeps its scale on a short stub and a
// long run alike. The repeat therefore lives in the geometry, and the maps
// here are sampled at 1.
export function makeWallMaterial(theme, color = theme.wallColor) {
    const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: theme.wallRoughness,
        metalness: theme.wallMetalness
    });
    if (theme.wallTextures) {
        applyPbrMaps(mat, theme.wallTextures, 1);
        forceMapScalars(mat, theme.wallTextures);
    }
    return applySurface(mat, {
        pattern: theme.wallPattern, color2: secondColor(color, theme.wallColor2 && color === theme.wallColor ? theme.wallColor2 : ''),
        glowColor: theme.glowColor, glow: theme.wallGlow, scale: theme.patternScale, bump: 1.4
    });
}

// Wall geometry in the theme's style, for a list of { x, z, w, d } rects.
// `reach` is the tallest point the marble can touch (its radius): the builder
// keeps every face true to its collider below it.
export function makeWallGeometry(theme, specs, { height, floorY = 0, reach, seed = 0 } = {}) {
    return buildWallGeometry(specs, {
        height, floorY, reach, seed,
        style: theme.wallStyle, bevel: theme.wallBevel, jag: theme.wallJag,
        uvPerUnit: (Number.isFinite(theme.wallTextureTile) ? theme.wallTextureTile : 4) / 10
    });
}

export function makeBallMaterial(theme) {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.marbleColor),
        roughness: theme.marbleRoughness,
        metalness: theme.marbleMetalness
    });
}

export function makeHoleMaterial(theme) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.holeColor) });
}

export function makeGoalMaterial(theme) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.goalColor), side: THREE.DoubleSide });
}

// Ice reads as a glaze ON the floor rather than as a slab of its own: partly
// transparent so the floor's own texture shows through, and smooth//reflective
// enough that it is obviously a different surface at a glance. Drawn as a flat
// quad a hair above the floor, so `depthWrite: false` keeps it from z-fighting
// with the floor it is lying on.
export function makeIceMaterial(theme) {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.iceColor),
        roughness: 0.06,
        metalness: 0.0,
        transparent: true,
        opacity: 0.72,
        depthWrite: false
    });
}

// A gate is a wall that moves, so it is built from the wall's own PBR settings
// -- an author who dressed their walls in stone gets stone gates -- but tinted
// with gateColor so the player can tell at a glance which walls are about to
// move. Getting that wrong is not a cosmetic problem: a gate that looks exactly
// like a wall reads as the level cheating when it shifts.
export function makeGateMaterial(theme) {
    return makeWallMaterial(theme, theme.gateColor);
}

// A miniature maze for the admin cosmetics editor: floor, a couple of walls, a
// hole, the goal ring and the ball, built from the SAME material makers the
// real game uses.
//
// Deliberately a tiny hand-made fragment rather than a real level. The author
// is judging materials -- how the floor reads under the walls' shadow, whether
// the ball stands out against it, whether the goal ring is visible -- and a
// full 14-unit level shrunk into a preview thumbnail shows none of that. It is
// sized to the ~5-unit framing the other preview categories use.
export function buildPreviewMaze(def) {
    const theme = resolveMazeTheme(def);
    const group = new THREE.Group();
    const W = 5, D = 5, WALL_H = 0.42, T = 0.3;

    // Rotation baked into the geometry, not the mesh: a floor pattern is drawn
    // in the mesh's local space, which must be level space (mazeSurface3d.js).
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), makeFloorMaterial(theme, Math.max(W, D)));
    floor.receiveShadow = true;
    group.add(floor);

    // Two interior walls plus the four boundary rails, so the author sees both
    // a lit face and a shadowed one.
    const wallMat = makeWallMaterial(theme);
    const walls = [
        { x: -0.7, z: -1.1, w: 3.4, d: T },
        { x: 0.9, z: 0.7, w: 3.0, d: T },
        { x: 0, z: -D / 2 - T / 2, w: W + T * 2, d: T },
        { x: 0, z: D / 2 + T / 2, w: W + T * 2, d: T },
        { x: -W / 2 - T / 2, z: 0, w: T, d: D },
        { x: W / 2 + T / 2, z: 0, w: T, d: D }
    ];
    const wallMesh = new THREE.Mesh(makeWallGeometry(theme, walls, { height: WALL_H, reach: 0.34 }), wallMat);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    group.add(wallMesh);

    // An ice patch and a gate bar. Both are here for one reason: the editor
    // exposes iceColor and gateColor, and a field whose effect the preview does
    // not show is a field the author is tuning blind. Same y-order the real
    // level uses -- ice under the hole disc, never over it.
    const ice = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), makeIceMaterial(theme));
    ice.rotation.x = -Math.PI / 2;
    ice.position.set(0.9, 0.006, -0.2);
    group.add(ice);

    // Drawn at its OPEN extreme, tucked against the wall it slides out of --
    // the same position the verifier solves levels against, so an author's
    // mental model of "where a gate rests" matches the one the checker uses.
    const gate = new THREE.Mesh(makeWallGeometry(theme, [{ x: 0, z: 0, w: 1.4, d: T }], { height: WALL_H, reach: 0.34 }), makeGateMaterial(theme));
    gate.position.set(1.3, 0, -1.1);
    gate.castShadow = true;
    gate.receiveShadow = true;
    group.add(gate);

    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), makeHoleMaterial(theme));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(-1.5, 0.012, 0.9);
    group.add(hole);

    const goal = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.55, 28), makeGoalMaterial(theme));
    goal.rotation.x = -Math.PI / 2;
    goal.position.set(1.7, 0.015, 1.8);
    group.add(goal);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 20), makeBallMaterial(theme));
    ball.position.set(-1.6, 0.34, -1.9);
    ball.castShadow = true;
    group.add(ball);

    return group;
}
