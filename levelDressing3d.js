import * as THREE from 'three';
import { makeFloorMaterial, makeWallMaterial, makeWallGeometry } from './mazeTheme3d.js';
import { forestFor } from './forestDressing.js';
import { buildForest, buildPathMask } from './forest3d.js';
import { buildBrickWallGeometry, makeBrickMaterial } from './toyWalls3d.js';

// A level's FLOOR and WALLS as meshes: the one place they are built, shared
// by mazeGame.js and scripts/themePreview.html so the preview cannot drift
// from the game.
//
// `walls` is every wall drawn (the level's own plus its boundary rails).
// `theme` is resolved for the level (mazeTheme3d.js resolveLevelTheme): when
// it blends toward 'forest', some walls are drawn as rows of tree trunks with
// roots and leafy branches (forestDressing.js / forest3d.js) and the rest as
// planks; the floor gets the path mask its dirt and moss follow.
//
// Returns { group, forest } -- forest is null when the level has none, else
// buildForest()'s object, whose tick() fades canopies over the marble.
export function buildFloorAndWalls(lv, walls, theme, { height, floorY = 0 }, tracked = []) {
    const group = new THREE.Group();
    const keep = x => { tracked.push(x); return x; };

    const extras = theme.floorPattern === 'woodToDirt'
        ? { mask: keep(buildPathMask(lv, walls)), board: lv.size }
        : {};
    // Flat in the geometry, not by rotating the mesh: patterns are drawn in
    // local space, which has to be level space (mazeSurface3d.js).
    const floorGeo = keep(new THREE.PlaneGeometry(lv.size.w, lv.size.d).rotateX(-Math.PI / 2));
    const floor = new THREE.Mesh(floorGeo, keep(makeFloorMaterial(theme, Math.max(lv.size.w, lv.size.d), extras)));
    floor.position.y = floorY;
    floor.receiveShadow = true;
    group.add(floor);

    const dressing = theme.themeTo === 'forest' && theme.blend > 0 ? forestFor(lv, walls, theme.blend) : null;
    const planks = dressing ? walls.filter((w, i) => dressing.kinds[i] === 'plank') : walls;
    if (planks.length) {
        // World 4's walls are toy bricks (toyWalls3d.js); every other theme's
        // come from the wall builder in its style.
        const bricks = theme.wallStyle === 'bricks';
        const mesh = new THREE.Mesh(
            keep(bricks ? buildBrickWallGeometry(planks, { height, floorY, sat: theme.brickSat })
                : makeWallGeometry(theme, planks, { height, floorY, reach: lv.ballRadius })),
            keep(bricks ? makeBrickMaterial(theme) : makeWallMaterial(theme)));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
    }
    let forest = null;
    if (dressing) {
        forest = buildForest(lv, dressing, tracked);
        forest.group.position.y = floorY;
        group.add(forest.group);
    }
    return { group, forest };
}
