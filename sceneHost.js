import * as THREE from 'three';

// THE SCENE HOST -- one of Phase 0's two seams (CLAUDE.md, docs/PLAN.md).
//
// In Ball Smack the maze borrowed that game's renderer, scene and frame loop
// from scene3d.js. Here the maze IS the game, so this module owns them, behind
// the same five calls mazeGame.js already used:
//
//   getScene()            the one THREE.Scene
//   getCamera()           the one PerspectiveCamera (aspect kept current)
//   onFrame(fn)           called once per animation frame, before render
//   setExclusiveMode(m)   a mode that owns the camera: m.isActive(), m.getPose()
//   requestRender()       draw on the next frame even if nothing else asks
//   setCovered(on, why)   something covers the whole scene (the web's landing
//                         site; the Gear, Crew and Store pages): no frame
//                         callbacks, no drawing, until every cover is lifted
//                         -- the last frame stays on screen. The home planet
//                         otherwise spun at full rate behind it, costing a
//                         phone battery and CPU while its owner read a page or
//                         typed a password. `why` names the cover ('landing'
//                         by default), so one lifting never uncovers another.
//
// ONE WebGLRenderer for the page's life: a second live context is the
// documented mobile GPU-OOM hazard, and a lost context is unrecoverable.
//
// RENDERING POLICY. While an exclusive mode is active (a level is on screen)
// every frame is drawn -- the ball, belts and coins all move. Otherwise only
// frames someone asked for are drawn, so a level-select screen left open on a
// phone does not hold the GPU at full rate.

let renderer = null;
let scene = null;
let camera = null;
let exclusive = null;
let dirty = true;
let covered = false;
const covers = new Set();
let coverFrames = 0;   // frames still to draw before a new cover freezes the scene
const frameFns = [];

// The sun. Its shadow frustum is a 20 x 20 box: a whole board up to 9 x 14
// and then some, or -- on a board bigger than the rolling camera's window
// (2026-10-13) -- the part in view, the box following it (setShadowFocus).
// test_maze_levels.js keeps the window inside the box.
const SUN_OFFSET = { x: -4, y: 12, z: 6 };
let sunLight = null;
function addLights(s) {
    s.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3530, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 30 });
    sun.shadow.bias = -0.0005;
    s.add(sun);
    s.add(sun.target);
    sunLight = sun;
}
// Centre the sun's shadow box on the floor at (x, z): the same light, moved
// with what it lights, so shadows reach every part of a big board in view.
export function setShadowFocus(x = 0, z = 0) {
    if (!sunLight) return;
    if (sunLight.target.position.x === x && sunLight.target.position.z === z) return;
    sunLight.target.position.set(x, 0, z);
    sunLight.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
    sunLight.target.updateMatrixWorld();
}

// Match the drawing buffer and the camera to the canvas's real CSS box. The
// maze derives its camera distance from camera.aspect every frame
// (mazeGame.js computeCameraPose), so this is what keeps a phone-shaped
// screen from cropping the side walls.
function resizeToDisplay() {
    const c = renderer.domElement;
    const w = Math.max(1, c.clientWidth), h = Math.max(1, c.clientHeight);
    const pr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * pr) || c.height !== Math.round(h * pr)) {
        renderer.setPixelRatio(pr);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        dirty = true;
    }
}

function frame() {
    if (covered && coverFrames <= 0) return;
    if (covered) { coverFrames--; dirty = true; }
    // In a headset (xrMode.js) the session sizes the drawing and the
    // headset places the camera: no resizing, no mode's pose, every frame drawn.
    const xr = !!(renderer.xr && renderer.xr.isPresenting);
    if (!xr) resizeToDisplay();
    for (const fn of frameFns) {
        try { fn(); } catch (e) { console.error('[sceneHost] frame callback failed:', e); }
    }
    const live = xr || !!(exclusive && exclusive.isActive());
    if (live && !xr) {
        const pose = exclusive.getPose();
        if (pose) {
            camera.position.copy(pose.pos);
            camera.lookAt(pose.lookAt);
        }
    }
    if (live || dirty) {
        renderer.render(scene, camera);
        dirty = false;
    }
}

// Create the renderer on `canvas` and start the frame loop. Idempotent.
// Returns false when WebGL is unavailable, so the page can say so instead of
// showing a black rectangle.
export function initSceneHost(canvas) {
    if (renderer) return true;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
        console.error('[sceneHost] WebGL unavailable:', e);
        return false;
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(48, 768 / 1180, 0.1, 100);
    camera.position.set(0, 20, 3);
    camera.lookAt(0, 0, 0);
    addLights(scene);
    resizeToDisplay();
    renderer.setAnimationLoop(frame);
    return true;
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
export function onFrame(fn) { if (typeof fn === 'function') frameFns.push(fn); }
export function setExclusiveMode(mode) { exclusive = mode || null; dirty = true; }
export function requestRender() { dirty = true; }
export function setCovered(on, why = 'landing') {
    const was = covered;
    if (on) covers.add(why); else covers.delete(why);
    covered = covers.size > 0;
    // Newly covered: draw the scene as it is now, once, so what stays on
    // screen behind the cover is not an older frame.
    if (covered && !was) coverFrames = 1;
    if (!covered) dirty = true;
}
