// THE SCENE HOST -- the one renderer, scene and camera Marble Rush draws with.
//
// In Ball Smack the maze borrowed the match's renderer through scene3d.js and
// had to save and restore that scene around itself. Here the maze owns the
// page, so this file is the small subset of scene3d.js it actually used:
//
//   getScene / getCamera  -- the live objects
//   onFrame(fn)           -- a per-frame callback (append-only, like scene3d's)
//   setExclusiveMode(m)   -- { isActive(), getPose() } drives the render loop
//                            and the camera while a mode is up; null clears it
//   requestRender()       -- draw one frame now (menus, level builds)
//
// The function names are scene3d.js's own, so mazeGame.js's calls into it did
// not change. Lighting is Ball Smack's (scene3d.js + environment.js), minus
// everything that belonged to the match board.
//
// RENDER GATE. The loop draws continuously only while an exclusive mode says it
// is active; otherwise the page idles and draws on request. That is the same
// battery rule Ball Smack follows, and why a mode MUST clear itself on exit.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

let renderer = null;
let scene = null;
let camera = null;
let canvasEl = null;
let exclusive = null;
const frameFns = [];
let rafId = 0;
let renderFrames = 0;
let lastW = 0, lastH = 0;

// The maze's whole level must sit inside this (test_maze_levels.js caps a
// level's half-extent at 10 world units for the same reason).
const SHADOW_HALF = 12;

export function initSceneHost(canvas) {
    if (renderer) return true;
    canvasEl = canvas;
    try {
        renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
    } catch (e) {
        console.error('[sceneHost] WebGL unavailable:', e && e.message);
        return false;
    }
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x241a10);
    camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    camera.position.set(0, 20, 4);
    camera.lookAt(0, 0, 0);

    // Image-based light at Ball Smack's strength: enough for the metal-ish
    // themes (Cold Storage's ball) to read as metal, not enough to wash colours.
    try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = 0.3;
        pmrem.dispose();
    } catch (e) { /* plain lights still work */ }

    scene.add(new THREE.HemisphereLight(0xfff6e6, 0x3a2f22, 0.22));
    const sun = new THREE.DirectionalLight(0xffffff, 0.77);
    sun.position.set(8, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 5, far: 50 });
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.2);
    fill.position.set(-6, 20, -12);
    scene.add(fill);

    window.addEventListener('resize', () => requestRender());
    window.__r3dDebug = { renderFrames: () => renderFrames, sceneReady: true };
    requestRender();
    return true;
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
export function onFrame(fn) { if (typeof fn === 'function') frameFns.push(fn); }

export function setExclusiveMode(mode) {
    exclusive = mode || null;
    requestRender();
}

function fitToDisplay() {
    const w = Math.max(1, canvasEl.clientWidth), h = Math.max(1, canvasEl.clientHeight);
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}

function drawFrame() {
    rafId = 0;
    if (!renderer) return;
    fitToDisplay();
    for (const fn of frameFns) { try { fn(); } catch (e) { console.error('[sceneHost] frame callback failed:', e); } }
    const live = !!(exclusive && exclusive.isActive());
    if (live) {
        const pose = exclusive.getPose();
        if (pose) { camera.position.copy(pose.pos); camera.lookAt(pose.lookAt); }
    }
    renderer.render(scene, camera);
    renderFrames++;
    if (live) rafId = requestAnimationFrame(drawFrame);
}

export function requestRender() {
    if (!renderer || rafId) return;
    rafId = requestAnimationFrame(drawFrame);
}
