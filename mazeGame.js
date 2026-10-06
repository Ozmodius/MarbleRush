import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { getScene, getCamera, getRenderer, onFrame, setExclusiveMode, requestRender } from './sceneHost.js';
import { gateFraction, gateVelocity, gateSpecAt, isOnIce, ICE_FRICTION } from './mazeHazards.js';
import { makeIceMaterial, makeGateMaterial, makeMoltenGateMaterial } from './mazeTheme3d.js';
import { buildFloorAndWalls } from './levelDressing3d.js';
import { buildHoleMeshes } from './mazeTheme3d.js';
import { resolveMazeTheme, resolveLevelTheme, makeWallGeometry, makeBallMaterial,
         makeHoleMaterial, makeGoalMaterial } from './mazeTheme3d.js';
import { tickSurfaces } from './mazeSurface3d.js';
import { conveyorAt, conveyorAccel, windAt, windAccel, icicleHits, icicleState, windStrength,
         flareHits, flareState, gateBurning, moltenGateHits, geyserAccel, geyserState,
         bumperKick, springUnder, springLaunch, springShot, springState, armAngle, armSpin, ARM_HUB_R, ARM_HALF_T,
         magnetAccel, crusherState, crusherBottom, crusherVelocity, crusherHits, railHits, railState } from './mazeHazards.js';
import { CRUSH_HEAD_H } from './foundryProps3d.js';
import { ARM_Y0, ARM_Y1 } from './toyProps3d.js';
import { createRunPickups, stepPickups, absorbFall, timeScale, useCharge } from './mazePickups.js';
import { buildLevelProps } from './mazeProps3d.js';
import { sfx as uiSfx } from './sfx.js';
import { computeTilt, captureNeutral, MAX_TILT_DEG, DEADZONE_DEG, DEFAULT_SENSITIVITY } from './mazeTilt.js';
import { ballSetup, PRIZES, AD_REWARDS, MARBLES } from './shopCatalog.js';
const marbleName = id => (MARBLES[id] ? MARBLES[id].name.toUpperCase() : String(id));
import { worldName, LAUNCH_WORLDS } from './worlds.js';
import { buildPlanet } from './planet3d.js';
import { buildSolarSystem } from './solarSystem3d.js';
import { isUnlocked } from './progressStore.js';
import { setGameplayActive, features, showMidgameAd, showRewardedAd, adsAvailable, adFailureMessage, happytime, reportGameCompleted } from './platform.js';

// MARBLE RUSH -- the maze itself: level select, building a level, the run.
//
// Copied from 3dBallSmack's Marble Maze side game (CLAUDE.md) and cut loose
// from it in Phase 0. What it used to borrow from Ball Smack now comes through
// two seams:
//   - sceneHost.js   the renderer, scene, camera and frame loop (this module
//                    builds a GROUP per level into that scene);
//   - the PROGRESS STORE (progressStore.js), handed in by main.js through
//                    enterMaze(store): the ladder, best times, coins and the
//                    wallet, all client-side -- there is no server.
//
// RENDERER. There is exactly one WebGLRenderer (sceneHost.js) -- a second live
// context is the documented mobile GPU-OOM hazard.
//
// TILT. The gravity VECTOR rotates; the maze geometry never does. That keeps
// every static body's quaternion frozen (cheap, and how this codebase likes
// static geometry) and keeps the maze square and readable on screen. The board
// does tilt visually, by a small clamped amount, purely so the controls feel
// connected -- that rotation is decoupled from the simulation entirely.
// The angle math lives in mazeTilt.js, which imports nothing and is unit-tested
// in Node, because this sandbox has no accelerometer to test against.

// Relative for the same reason as main.js's copy.json fetch: the CrazyGames
// bundle is not served from '/'.
const LEVELS_URL = 'mazeLevels.json';

// Physics tuning. Gravity is the vector's LENGTH; mazeTilt.tiltToGravity
// rotates it off vertical and preserves this magnitude at every tilt.
const GRAVITY = 30;
const WALL_HEIGHT = 0.55;
const FLOOR_Y = 0;
const FIXED_STEP = 1 / 60;
const MAX_CATCHUP_STEPS = 150;   // ~2.5s of sim in one frame, same cap diceBox3d uses

// How far the board leans on screen at full tilt. Feedback only -- deliberately
// far less than the ~25 degrees of real lean that produces it, because a board
// that rotated as much as the phone would swing its own corners out of frame.
const VISUAL_TILT_MAX_RAD = 7 * Math.PI / 180;

// Camera. Steep enough to read as a top-down labyrinth, angled enough that the
// walls have visible height. The distance frames a 14-deep level inside the
// fixed 48-degree vertical FOV with margin to spare, so a phone whose CSS
// aspect differs from the 768x1180 backing store still sees the whole level.
// Only ~10 degrees off straight-down. A steeper angle gave the walls more
// visible height but keystoned the board hard -- the far end rendered
// noticeably narrower than the near end, which on a fairness-critical layout
// means the top row of holes reads smaller than the identical bottom row.
const CAM_TILT_RAD = 10 * Math.PI / 180;
const CAM_LOOKAT = new THREE.Vector3(0, 0, 0.2);
// Slack around the level so the boundary rails and the visual board lean never
// touch the edge of the screen.
const CAM_MARGIN = 1.1;

const _camPos = new THREE.Vector3();

// The camera distance is DERIVED from the live aspect ratio every frame, not
// hardcoded, and that is not a nicety -- it is the difference between the maze
// fitting and the maze being cropped.
//
// The canvas backing store is a fixed 768x1180 (aspect 0.65) but resizeToDisplay
// sets camera.aspect from the canvas's real CSS box, which on a phone is more
// like 0.46. A distance tuned to the backing store therefore looked right in a
// desktop-shaped window and cut both side walls off on an actual phone, which
// is the shape that matters. Fitting whichever axis binds means it is correct
// on every device, in either orientation, with no per-device tuning.
function computeCameraPose() {
    const camera = getCamera();
    const fov = ((camera && camera.fov) || 48) * Math.PI / 180;
    const aspect = (camera && camera.aspect) || (768 / 1180);
    const halfV = Math.tan(fov / 2);
    const halfH = halfV * aspect;

    const needHalfW = level.size.w / 2 + CAM_MARGIN;
    const needHalfD = level.size.d / 2 + CAM_MARGIN;
    const dist = Math.max(needHalfW / halfH, needHalfD / halfV);

    _camPos.set(
        CAM_LOOKAT.x,
        CAM_LOOKAT.y + Math.cos(CAM_TILT_RAD) * dist,
        CAM_LOOKAT.z + Math.sin(CAM_TILT_RAD) * dist
    );
    return { pos: _camPos, lookAt: CAM_LOOKAT };
}

const FALL_RESTART_MS = 750;     // let the player watch the ball drop before the reset
// REWARDED ADS in a level (CrazyGames only; platform.js, shopCatalog.js
// AD_REWARDS). Never during a run: each is offered at a stop -- the ready
// screen, a fall, a clear -- and only on the player's tap.
const REVIVE_WINDOW_MS = 4000;   // how long CONTINUE is offered before the retry
let revivedThisAttempt = false;  // one continue per attempt
let offerAt = 0;                 // when the CONTINUE offer went up
let offerAdPending = false;      // the offer's countdown waits while its ad runs
let freeShieldTaken = false;     // one free shield per level visit
let lastClear = null;            // the clear the x2 COINS button would double
let rewardedThisBreak = false;   // a rewarded ad on this panel stands in for the break ad
// TRY A MARBLE (rewarded, from the Gear page): an unowned marble for one level
// -- every retry of it -- and never ownership. Memory only, never saved.
// { id, levelId } -- levelId is null until the trial's level is started.
let trialMarble = null;

// The win star floats above the board centre, well clear of the 0.55-high walls
// so it reads as hanging over the maze rather than sitting in it.
// The camera is near-vertical, so height mostly buys apparent SIZE rather than
// separation -- raising the star is what makes it dominate the frame instead of
// sitting among the walls like another piece of level furniture.
const WIN_STAR_Y = 4.6;
const WIN_STAR_SPIN = 1.5;       // radians/sec
const WIN_STAR_POP_MS = 420;     // scale-in, overshooting slightly before settling

let levelsPromise = null;
let scene = null;
let mazeGroup = null;
let ballMesh = null;
let ballBody = null;
let world = null;
let level = null;
let disposables = [];

// HAZARDS. Gates are the only thing in the maze that moves under its own steam,
// so each one keeps its authored spec next to the body and mesh it drives --
// advance() walks this list and needs all three together. Cleared by
// teardownLevel with everything else.
let gates = [];                  // [{ spec, body, mesh }]
let winStar = null;
let winStarMs = 0;               // time since the star appeared, drives pop + spin
let iceRects = [];
// World 4: the arms' kinematic blades, which shot each spring last fired
// at the ball, and when each bumper last kicked (for its flash and sound).
let armBodies = [];
// World 5: the presses' kinematic heads.
let crusherBodies = [];
let springShots = [];
let bumperKicks = 0;
let props = null;                // belts, coins, pickups (mazeProps3d.js)
let pickupState = null;          // this attempt's coins and power-ups (mazePickups.js)
// The ball this level is played with: the selected marble plus upgrades
// (shopCatalog.js ballSetup), read from the progress store when the level is
// built. Bought power-ups live in the store's inventory and are spent there.
let ballSpec = ballSetup('classic', {});
// The world prize answering a trap in this level (shopCatalog.js PRIZES), and
// whether one use of it has been spent on this level visit. A use covers every
// retry of the level, so it is reset when a level is built, not on restart.
let prizeOn = {};
let floorBody = null;            // material swapped per frame when the ball is on ice
let solidMaterial = null;
let iceMaterial = null;
// Gate motion is driven by the RUN's own clock, not performance.now(), so every
// attempt at a level presents the same gate phases at the same points in the
// run. Tying it to wall-clock time would mean a level's timing puzzle depended
// on what second the player happened to press START, which is unfair in a mode
// that pays for gold times.
let runClockMs = 0;

let active = false;
let phase = 'idle';              // idle | ready | running | falling | won
let frameHookInstalled = false;
let lastStepTime = 0;
let fallStartedAt = 0;
let runStartedAt = 0;

// Tilt state
let neutral = { beta: 0, gamma: 0 };
let smoothed = null;
let latestReading = { beta: 0, gamma: 0 };
let orientationBound = false;

// MANUAL CONTROL -- arrow keys / WASD and drag, for everything without a tilt
// sensor: every desktop (which is most of CrazyGames' audience), a phone that
// refused motion access, and an iframe that never forwards sensor events. It
// used to be a dead end ("THIS DEVICE HAS NO TILT SENSOR"). It produces a
// synthetic READING in the same degrees a sensor would, so everything after
// it -- deadzone, sensitivity, smoothing, gravity, the visual lean -- is the
// tilt path unchanged. Screen up is -z (the camera sits on the +z side), so UP
// is a negative beta, and RIGHT a positive gamma (test_maze_boot.js pins the
// latter for real tilt).
//
// Which one drives a frame: manual input while any is HELD (a key down or a
// drag in progress), otherwise the sensor once one has actually reported, and
// level otherwise. A sensor reading never switches manual off for good, and a
// stray touch never switches the sensor off -- each only wins while in use.
const MANUAL_FULL_DEG = MAX_TILT_DEG + DEADZONE_DEG;   // full deflection at sensitivity 1
const DRAG_FULL_PX = 110;                              // drag distance for full deflection
const KEY_DIRS = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right'
};   // e.code is the PHYSICAL key, so AZERTY's ZQSD land here too
const keysHeld = new Set();
let drag = null;                 // { x0, y0, x, y } while a drag is in progress
let sensorSeen = false;          // a real deviceorientation reading has arrived
let manualHintShown = false;
let sensorCheckTimer = null;
const MANUAL_HINT = 'ARROW KEYS, WASD OR DRAG TO TILT';

function manualReading() {
    if (drag) {
        const c = (v) => Math.max(-1, Math.min(1, v));
        return { beta: c((drag.y - drag.y0) / DRAG_FULL_PX) * MANUAL_FULL_DEG,
                 gamma: c((drag.x - drag.x0) / DRAG_FULL_PX) * MANUAL_FULL_DEG };
    }
    const dir = (d) => (keysHeld.has(d) ? 1 : 0);
    return { beta: (dir('down') - dir('up')) * MANUAL_FULL_DEG,
             gamma: (dir('right') - dir('left')) * MANUAL_FULL_DEG };
}
function manualActive() { return keysHeld.size > 0 || !!drag; }
function clearManual() { keysHeld.clear(); drag = null; }
function noteManualInput() {
    // The hint has done its job once the player is steering.
    if (manualHintShown) { manualHintShown = false; if (phase === 'running') setStatus(''); }
}
function showManualHint() {
    if (!active || phase !== 'running' || sensorSeen) return;
    manualHintShown = true;
    setStatus(MANUAL_HINT);
}
function inRun() { return active && phase === 'running'; }

if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        const d = KEY_DIRS[e.code];
        if (!d || !inRun()) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();      // arrows would otherwise scroll the page
        keysHeld.add(d);
        noteManualInput();
    });
    window.addEventListener('keyup', (e) => { const d = KEY_DIRS[e.code]; if (d) keysHeld.delete(d); });
    window.addEventListener('blur', clearManual);   // a key released in another window never sends keyup here
    window.addEventListener('pointerdown', (e) => {
        if (!inRun() || drag) return;
        // Buttons (EXIT, RECENTER, ...) keep their taps.
        if (e.target && e.target.closest && e.target.closest('button, .maze-btn, input')) return;
        drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, id: e.pointerId };
        noteManualInput();
    });
    window.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag.x = e.clientX; drag.y = e.clientY;
    });
    const endDrag = (e) => { if (drag && (!e || e.pointerId === drag.id)) drag = null; };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
}
let recenterPending = false;


// ---------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------

function loadLevels() {
    if (!levelsPromise) {
        levelsPromise = fetch(LEVELS_URL)
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .catch(e => {
                levelsPromise = null;   // let a later attempt retry rather than caching the failure
                reportDiag('maze_levels_load_failed', { message: String(e && e.message || e), file: 'mazeGame.js' });
                throw e;
            });
    }
    return levelsPromise;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

// The maze's own replacements for Ball Smack's diagnostics and input helpers.
function reportDiag(event, info) { console.warn('[maze]', event, info || ''); }
// A tap on a button: click covers mouse, touch and keyboard activation alike.
function bindTap(target, fn) {
    const node = typeof target === 'string' ? document.getElementById(target) : target;
    if (node) node.addEventListener('click', (e) => { e.preventDefault(); fn(e); });
}
// Tilt sensitivity. A settings screen is later work; until then, the default.
function getMazeSensitivity() { return DEFAULT_SENSITIVITY; }

function track(obj) { disposables.push(obj); return obj; }

// Full-traversal disposer, same shape as cosmeticPreview3d.js's disposeObject.
// The maze is rebuilt per level, so anything it makes has to be given back --
// unlike the game board, which is built once and lives for the page's lifetime.
function disposeAll() {
    for (const o of disposables) {
        try {
            if (o.isTexture) { o.dispose(); continue; }
            if (o.isMaterial) { o.dispose(); continue; }
            if (o.isBufferGeometry) { o.dispose(); continue; }
            o.traverse && o.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                const mats = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
                for (const m of mats) {
                    for (const slot of ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) {
                        if (m[slot]) m[slot].dispose();
                    }
                    m.dispose();
                }
            });
        } catch (e) { /* disposal must never break teardown */ }
    }
    disposables = [];
}

// Theme resolution and every material the maze wears live in mazeTheme3d.js,
// shared verbatim with the admin console's live preview (cosmeticPreview3d.js).
// Building them here instead would mean an author tuning a theme against a
// render only they ever see -- a preview that lies is worse than no preview.
//
// Floor and walls (levelDressing3d.js, shared with the theme preview): every
// plank wall in ONE mesh at its real size -- a maze meshed one box at a time
// would blow past the draw-call budget (test_r3d_environment.js caps the game
// scene at 100), and this is a phone -- and, in world 1 as it turns to
// forest, the tree-trunk walls, roots and canopies in a few more.
let forest = null;
function buildWalls(lv, group, theme) {
    const all = lv.walls.concat(boundaryRails(lv));
    const tracked = [];
    const built = buildFloorAndWalls(lv, all, theme, { height: WALL_HEIGHT, floorY: FLOOR_Y }, tracked);
    tracked.forEach(track);
    group.add(built.group);
    forest = built.forest;
    return all;
}

// The outer boundary is derived from `size` rather than authored, so a level
// can never be accidentally left open at an edge.
function boundaryRails(lv) {
    const hw = lv.size.w / 2, hd = lv.size.d / 2, t = 0.4;
    return [
        { x: 0, z: -hd - t / 2, w: lv.size.w + t * 2, d: t },
        { x: 0, z: hd + t / 2, w: lv.size.w + t * 2, d: t },
        { x: -hw - t / 2, z: 0, w: t, d: lv.size.d },
        { x: hw + t / 2, z: 0, w: t, d: lv.size.d }
    ];
}

function buildHoles(lv, group, theme) {
    const tracked = [];
    group.add(buildHoleMeshes(lv, theme, FLOOR_Y + 0.012, tracked));
    tracked.forEach(track);
}

// Ice patches, drawn as flat quads just above the floor. Instanced from one
// unit plane for the same reason the walls are: a maze can carry a lot of these
// and the scene is held to a draw-call budget.
function buildIce(lv, group, theme) {
    const rects = Array.isArray(lv.ice) ? lv.ice : [];
    if (!rects.length) return rects;
    const geo = track(new THREE.PlaneGeometry(1, 1));
    const mat = track(makeIceMaterial(theme));
    const mesh = new THREE.InstancedMesh(geo, mat, rects.length);
    // Above the floor but BELOW the hole discs (0.012) and the goal ring
    // (0.015): a hole covered by an ice quad would look filled in, and the one
    // thing a player must never misread is which circles are fatal.
    const y = FLOOR_Y + 0.006;
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const m = new THREE.Matrix4();
    rects.forEach((r, i) => {
        m.compose(new THREE.Vector3(r.x, y, r.z), flat, new THREE.Vector3(r.w, r.d, 1));
        mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return rects;
}

// Gates get one mesh each, NOT an InstancedMesh. They move independently, and
// rewriting per-instance matrices every frame would mean re-uploading the whole
// instance buffer for a handful of boxes -- more work than the draw calls it
// saves. Levels carry a few gates, not dozens.
function buildGates(lv, group, theme) {
    const specs = Array.isArray(lv.gates) ? lv.gates : [];
    if (!specs.length) return [];
    const mat = track(makeGateMaterial(theme));
    return specs.map((spec, i) => {
        // A molten gate gets its own material, so its glow can follow its own
        // closing and opening (updateGates).
        const own = spec.molten ? track(makeMoltenGateMaterial(theme)) : null;
        // Built around its own origin with its foot at y=0, so the mesh's
        // position is the gate's centre on the floor. The seed keeps two gates
        // from wearing identical rock.
        const geo = track(makeWallGeometry(theme, [{ x: 0, z: 0, w: spec.w, d: spec.d }],
            { height: WALL_HEIGHT, reach: lv.ballRadius, seed: i + 1 }));
        const mesh = new THREE.Mesh(geo, own || mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Placed at its open extreme, matching what the verifier solved.
        const at = gateSpecAt(spec, 0);
        mesh.position.set(at.x, FLOOR_Y, at.z);
        group.add(mesh);
        return { spec, mesh, body: null, glow: own ? own.userData.surfaceUniforms.mrGlow : null, heat: 0 };
    });
}

// ---------------------------------------------------------------------------
// WIN CELEBRATION
// ---------------------------------------------------------------------------

// A real extruded five-pointed star, not a sprite. It is the payoff for a run
// that can take several minutes of careful tilting, and a flat billboard would
// read as a UI icon rather than as an object in the same world the marble just
// rolled through. Extruded with a bevel so the edges catch the scene's lights
// as it turns -- that turn is what sells it as solid.
function makeStarShape(outer, inner, points = 5) {
    const shape = new THREE.Shape();
    for (let i = 0; i < points * 2; i++) {
        const r = (i % 2 === 0) ? outer : inner;
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
}

function buildWinStar(group) {
    const geo = track(new THREE.ExtrudeGeometry(makeStarShape(1.5, 0.62), {
        depth: 0.34, bevelEnabled: true, bevelThickness: 0.11, bevelSize: 0.11, bevelSegments: 3, curveSegments: 2
    }));
    geo.center();
    // Gold that reads as gold WITHOUT depending on the scene's environment map.
    // The maze inherits whatever envmap the game scene had, and a pure
    // metalness-1 material with a weak or absent environment renders near-black
    // -- the same trap marbleMesh.js's chrome skin documents. A little emissive
    // guarantees it is bright on its own, and the metalness on top is what makes
    // it glint rather than look like flat yellow plastic.
    const mat = track(new THREE.MeshStandardMaterial({
        color: 0xffc42e, metalness: 0.85, roughness: 0.22,
        emissive: 0xff9b00, emissiveIntensity: 0.35
    }));
    const mesh = new THREE.Mesh(geo, mat);
    // No shadow: the sun's frustum is sized for the board, and a star floating
    // several units above it would drop a hard slab across the level the player
    // is still looking at.
    mesh.castShadow = false;

    // A PIVOT that faces the camera, with the star spinning INSIDE it.
    //
    // The star is authored in the XY plane, so lying the pivot down (-90 about
    // x) points it at a near-straight-down camera, and easing back by the
    // camera's own tilt squares it up with the real one. The spin then happens
    // in the star's LOCAL frame, which is what makes it read correctly:
    //
    //   - local Z is the axis pointing at the camera, so rolling about it spins
    //     the star in the screen plane -- the classic celebratory spin, and one
    //     that never presents an edge.
    //   - a small wobble about local Y tips it just far enough to show the
    //     extruded thickness and catch the light on the bevel.
    //
    // Spinning about world Y instead (the obvious first attempt) turns a flat
    // star edge-on twice a revolution, where it collapses to a sliver and reads
    // as broken geometry rather than as a spinning star.
    const pivot = new THREE.Group();
    pivot.rotation.x = -Math.PI / 2 + CAM_TILT_RAD;
    pivot.position.set(CAM_LOOKAT.x, WIN_STAR_Y, CAM_LOOKAT.z);
    pivot.add(mesh);
    pivot.visible = false;
    pivot.scale.setScalar(0.01);
    group.add(pivot);
    return { pivot, mesh };
}

function buildLevelMeshes(lv, theme) {
    const group = new THREE.Group();

    // The floor comes with the walls (buildWalls), since world 1's floor
    // follows where the walls are.
    // Ice first, so the hole discs and goal ring paint on top of it.
    iceRects = buildIce(lv, group, theme);

    buildHoles(lv, group, theme);

    const goalGeo = track(new THREE.RingGeometry(lv.goal.r * 0.62, lv.goal.r, 28));
    const goalMat = track(makeGoalMaterial(theme));
    const goal = new THREE.Mesh(goalGeo, goalMat);
    goal.rotation.x = -Math.PI / 2;
    goal.position.set(lv.goal.x, FLOOR_Y + 0.015, lv.goal.z);
    group.add(goal);

    // Belts, coins and pickups. Their geometries, materials and textures go on
    // the disposables list like everything else built here.
    const tracked = [];
    props = buildLevelProps(lv, tracked);
    tracked.forEach(track);
    group.add(props.group);

    const wallSpecs = buildWalls(lv, group, theme);
    gates = buildGates(lv, group, theme);
    // Built up front and hidden, not created on the win. Building an extruded
    // mesh at the exact moment the player clears would hitch the frame the
    // celebration starts on -- the one frame in the run where a stutter is most
    // visible.
    winStar = buildWinStar(group);

    // The ball is the THEME's ball, not the player's equipped marble skin.
    //
    // It used to be the equipped skin -- "what you bought in the Shop is what
    // you roll" -- and that was deliberately reversed: the maze is its own
    // place with its own look, authored per level, and a ball that changed
    // colour with whatever the player happened to be wearing in Ball Smack
    // undercut every theme the moment it shipped. It also means a level author
    // can rely on the ball reading against their own floor, instead of hoping
    // it does against 4+ marble skins they have never seen together.
    const ballGeo = track(new THREE.SphereGeometry(lv.ballRadius, 28, 20));
    const ballMat = track(makeBallMaterial(theme, ballSpec.look));
    ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true;
    group.add(ballMesh);

    track(group);
    return { group, wallSpecs };
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

function buildWorld(lv, wallSpecs) {
    const w = new CANNON.World();
    w.gravity.set(0, -GRAVITY, 0);

    const ballMat = new CANNON.Material();
    const solidMat = new CANNON.Material();
    const iceMat = new CANNON.Material();
    // Low restitution: a marble in a wooden labyrinth thuds, it does not bounce.
    // Modest friction so it rolls rather than skids, which is what makes small
    // corrective tilts feel like they do something.
    // Grip and bounce are the marble's (shopCatalog.js); Classic's are the
    // 0.28 / 0.12 every level was tuned on. Ice stays ice whatever the marble:
    // only the Rubber Coat prize changes that (updateFloorSurface).
    w.addContactMaterial(new CANNON.ContactMaterial(solidMat, ballMat, { friction: ballSpec.grip, restitution: ballSpec.bounce }));
    w.addContactMaterial(new CANNON.ContactMaterial(iceMat, ballMat, { friction: ICE_FRICTION, restitution: ballSpec.bounce }));

    // ICE IS A MATERIAL SWAP ON THE ONE FLOOR BODY, not extra geometry.
    //
    // The obvious implementation -- a thin slab per ice patch with its own
    // material -- puts a lip at every patch edge for the ball to catch on, and
    // makes the physics floor disagree with the visual floor by whatever the
    // slab's thickness is. Instead the floor stays a single infinite plane and
    // advance() points floorBody.material at iceMat whenever the ball is over a
    // patch. cannon looks the contact pair up per contact, so the swap takes
    // effect on the next step with no bodies added, removed or overlapping.
    const floor = new CANNON.Body({ mass: 0, material: solidMat });
    floor.addShape(new CANNON.Plane());
    floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    floor.position.set(0, FLOOR_Y, 0);
    w.addBody(floor);
    floorBody = floor;
    solidMaterial = solidMat;
    iceMaterial = iceMat;

    for (const spec of wallSpecs) {
        const body = new CANNON.Body({ mass: 0, material: solidMat });
        body.addShape(new CANNON.Box(new CANNON.Vec3(spec.w / 2, WALL_HEIGHT / 2, spec.d / 2)));
        body.position.set(spec.x, FLOOR_Y + WALL_HEIGHT / 2, spec.z);
        w.addBody(body);
    }

    // Gates are KINEMATIC, not static-bodies-we-move. A mass-0 static body whose
    // position is reassigned each frame has no velocity as far as the solver is
    // concerned, so a ball it has moved into reads as a deep penetration to be
    // resolved -- and cannon resolves those by ejecting the ball hard. Kinematic
    // bodies are integrated from their velocity, which is exactly the "this wall
    // is moving at this speed" information the contact needs to push instead.
    for (const g of gates) {
        const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: solidMat });
        body.addShape(new CANNON.Box(new CANNON.Vec3(g.spec.w / 2, WALL_HEIGHT / 2, g.spec.d / 2)));
        const at = gateSpecAt(g.spec, 0);
        body.position.set(at.x, FLOOR_Y + WALL_HEIGHT / 2, at.z);
        w.addBody(body);
        g.body = body;
    }

    // World 4. Bumpers and arm hubs are static posts; a blade is kinematic,
    // like a gate, turned by updateGates from the run clock with its true spin
    // set so a hit is a push rather than an ejection. A bumper's kick is not
    // the contact's: applyToys() sets it outright (mazeHazards.js bumperKick).
    const post = (x, z, r) => {
        const body = new CANNON.Body({ mass: 0, material: solidMat });
        body.addShape(new CANNON.Cylinder(r, r, WALL_HEIGHT, 16));
        body.position.set(x, FLOOR_Y + WALL_HEIGHT / 2, z);
        w.addBody(body);
    };
    (lv.bumpers || []).forEach(b => post(b.x, b.z, b.r));
    armBodies = (lv.arms || []).map(a => {
        post(a.x, a.z, ARM_HUB_R);
        const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: solidMat });
        body.addShape(new CANNON.Box(new CANNON.Vec3(a.len, (ARM_Y1 - ARM_Y0) / 2, ARM_HALF_T)));
        body.position.set(a.x, FLOOR_Y + (ARM_Y0 + ARM_Y1) / 2, a.z);
        w.addBody(body);
        return { a, body };
    });

    // World 5. A press head is kinematic, like a gate, moved up and down by
    // updateGates with its true speed. Up, it hangs above the walls and the
    // ball passes under; down, it is a wall.
    crusherBodies = (lv.crushers || []).map(c => {
        const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: solidMat });
        body.addShape(new CANNON.Box(new CANNON.Vec3(c.w / 2, CRUSH_HEAD_H / 2, c.d / 2)));
        body.position.set(c.x, FLOOR_Y + crusherBottom(c, 0) + CRUSH_HEAD_H / 2, c.z);
        w.addBody(body);
        return { c, body };
    });

    const ball = new CANNON.Body({ mass: 1, material: ballMat });
    ball.addShape(new CANNON.Sphere(lv.ballRadius));
    // Angular damping keeps the marble from spinning up into an unstoppable
    // top on a long straight; linear damping is near-zero so it still coasts.
    // Both from the marble; never below Classic's (test_shop.js), which is
    // what keeps a bought marble from being a faster one.
    ball.linearDamping = ballSpec.damping;
    ball.angularDamping = ballSpec.spin;
    w.addBody(ball);

    world = w;
    ballBody = ball;
}

function placeBallAtStart() {
    ballBody.position.set(level.start.x, FLOOR_Y + level.ballRadius + 0.02, level.start.z);
    ballBody.velocity.setZero();
    ballBody.angularVelocity.setZero();
    ballBody.quaternion.set(0, 0, 0, 1);
    ballBody.collisionResponse = true;
    ballBody.wakeUp();
}

// ---------------------------------------------------------------------------
// Tilt input
// ---------------------------------------------------------------------------

function onOrientation(e) {
    if (e.beta === null && e.gamma === null) return;
    sensorSeen = true;
    latestReading = { beta: e.beta || 0, gamma: e.gamma || 0 };
    if (recenterPending) {
        neutral = captureNeutral(latestReading.beta, latestReading.gamma);
        smoothed = null;
        recenterPending = false;
    }
}

// iOS 13+ gates the sensor behind an explicit grant that MUST be requested from
// a user gesture -- hence this is only ever called from the START button's tap
// handler, never on entry. Everything is feature-detected and try/caught in the
// style of uiSfx.js's navigator.vibrate use.
async function requestTiltPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return 'unsupported';
    if (typeof DOE.requestPermission !== 'function') return 'granted';   // Android / desktop
    try {
        const res = await DOE.requestPermission();
        return res === 'granted' ? 'granted' : 'denied';
    } catch (e) {
        return 'denied';
    }
}

function bindOrientation() {
    if (orientationBound) return;
    window.addEventListener('deviceorientation', onOrientation, true);
    orientationBound = true;
}

function unbindOrientation() {
    if (!orientationBound) return;
    window.removeEventListener('deviceorientation', onOrientation, true);
    orientationBound = false;
}

function screenAngle() {
    try {
        if (window.screen && window.screen.orientation && Number.isFinite(window.screen.orientation.angle)) {
            return window.screen.orientation.angle;
        }
    } catch (e) { /* ignore */ }
    return 0;
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function step() {
    // onFrame is append-only -- there is no offFrame -- so this callback lives
    // for the life of the page and MUST bail whenever the maze isn't up.
    if (active && phase === 'menu' && (planet || solar)) {
        const t = performance.now() / 1000;
        tickSurfaces(t);
        (planet || solar).tick(t);
        return;
    }
    if (!active || !world || !ballBody) return;

    const now = performance.now();
    const elapsedMs = lastStepTime ? (now - lastStepTime) : (1000 / 60);
    lastStepTime = now;
    // Lava pulses on the page clock, not the run clock: it is scenery, and it
    // should keep breathing on the ready screen and after a fall.
    tickSurfaces(now / 1000);
    if (props) props.tick(now / 1000);
    advance(elapsedMs);
}

// One frame of maze, given how long it represents.
//
// Split out from step() so the clock is a PARAMETER rather than
// performance.now(). step() drives it from real elapsed time; the test hook
// drives it from a fixed dt. That matters because everything here is otherwise
// reachable only through requestAnimationFrame, and this sandbox starves rAF
// unpredictably under load -- the same throttling that makes
// test_r3d_environment.js flaky. A tilt assertion clocked by a starved rAF
// tests the sandbox's scheduler, not the maze.
let lastFrameMs = 0;              // real ms of the frame being advanced, for pickup timers
function advance(elapsedMs) {
    lastFrameMs = elapsedMs;
    if (phase === 'running') {
        // Manual input is already in screen terms and needs no calibration.
        const manual = manualActive() || !sensorSeen;
        const { tilt, gravity } = computeTilt(manual ? manualReading() : latestReading,
            manual ? { beta: 0, gamma: 0 } : neutral, smoothed, {
            screenAngle: manual ? 0 : screenAngle(),
            // A marble's response reaches full tilt with less lean; mazeTilt
            // still clamps at MAX_TILT_DEG, so full tilt pulls no harder.
            sensitivity: getMazeSensitivity() * ballSpec.response,
            dtMs: elapsedMs,
            g: GRAVITY
        });
        smoothed = tilt;
        world.gravity.set(gravity.x, gravity.y, gravity.z);

        // Visual lean only. The simulation never sees this rotation -- physics
        // runs in the group's LOCAL frame, so tilting the group moves the board
        // and the ball together and changes nothing about the sim.
        //
        // Scaled against mazeTilt's own MAX_TILT_DEG rather than a local copy of
        // that number, so retuning how far a player must lean can't leave the
        // board's visible lean calibrated to the old value.
        mazeGroup.rotation.z = -clamp(tilt.gamma / MAX_TILT_DEG, -1, 1) * VISUAL_TILT_MAX_RAD;
        mazeGroup.rotation.x = clamp(tilt.beta / MAX_TILT_DEG, -1, 1) * VISUAL_TILT_MAX_RAD;

        // The gate clock only advances while the run is RUNNING. Paused on the
        // ready screen, frozen during the fall animation and after a win: gates
        // that kept sliding behind a "DOWN THE HOLE" banner would have moved on
        // by the time the ball is replaced, so the restart the player sees would
        // not be the level they just started.
        // Slow-mo slows the WORLD -- ball, gates, belts -- not the run timer,
        // which reads the wall clock (win()). So it is a steadier hand, never a
        // faster time.
        runClockMs += elapsedMs * timeScale(pickupState);
        updateGates();
        updateFloorSurface();
        if (props) props.tickRun(runClockMs);
    } else if (phase === 'won') {
        winStarMs += elapsedMs;
        updateWinStar();
    }

    // Fixed timestep with a hand-rolled catch-up, exactly as diceBox3d.js does
    // and for the same reason: cannon's own accumulator bails out of substep
    // catch-up under CPU contention and leaves the sim permanently behind.
    const simMs = phase === 'running' ? elapsedMs * timeScale(pickupState) : elapsedMs;
    const steps = Math.min(Math.max(1, Math.round((simMs / 1000) / FIXED_STEP)), MAX_CATCHUP_STEPS);
    for (let i = 0; i < steps; i++) {
        if (phase === 'running') { applyConveyor(FIXED_STEP); applyWind(FIXED_STEP); applyGeysers(FIXED_STEP); applyToys(); applyFoundry(FIXED_STEP); }
        world.step(FIXED_STEP);
    }

    ballMesh.position.copy(ballBody.position);
    ballMesh.quaternion.copy(ballBody.quaternion);
    // Leafy branches fade while the marble is under them (forest3d.js).
    if (forest) forest.tick(ballBody.position.x, ballBody.position.z, elapsedMs);

    if (phase === 'running') checkOutcomes();
    else if (phase === 'falling' && performance.now() - fallStartedAt > FALL_RESTART_MS) {
        if (reviveOffered()) openFallOffer(); else restart();
    } else if (phase === 'offer') tickFallOffer();
}

// Move every gate to where the run clock says it should be, and tell the solver
// how fast it is going. Position is set directly rather than integrated so the
// gate can never drift off its authored travel over a long run; the velocity is
// set alongside purely so contacts resolve as a push (see mazeHazards.js's
// gateVelocity comment).
function updateGates() {
    for (const { c, body } of crusherBodies) {
        body.position.set(c.x, FLOOR_Y + crusherBottom(c, runClockMs) + CRUSH_HEAD_H / 2, c.z);
        body.velocity.set(0, crusherVelocity(c, runClockMs) * timeScale(pickupState), 0);
    }
    for (const { a, body } of armBodies) {
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -armAngle(a, runClockMs));
        body.angularVelocity.set(0, -armSpin(a) * timeScale(pickupState), 0);
    }
    if (!gates.length) return;
    for (const g of gates) {
        const at = gateSpecAt(g.spec, gateFraction(g.spec, runClockMs));
        const v = gateVelocity(g.spec, runClockMs);
        const alongX = g.spec.axis !== 'z';
        if (g.body) {
            g.body.position.set(at.x, FLOOR_Y + WALL_HEIGHT / 2, at.z);
            g.body.velocity.set(alongX ? v : 0, 0, alongX ? 0 : v);
        }
        if (g.mesh) g.mesh.position.set(at.x, FLOOR_Y, at.z);
        // A molten gate glows hot while it closes (when it burns) and dulls to
        // crust while it opens -- easing between, so the change reads.
        if (g.glow) {
            g.heat += ((gateBurning(g.spec, runClockMs) ? 1 : 0) - g.heat) * 0.2;
            g.glow.value = 0.25 + 2.6 * g.heat;
        }
    }
}

// Ice underfoot swaps the floor's contact material for the ball's next step.
// Tested against the ball's CENTRE rather than its silhouette: a patch edge is
// then the line the middle of the marble crosses, which is what a player reads
// off the screen, and it avoids a half-on-half-off state that would have to
// blend two friction values with nothing sensible to blend them to.
function updateFloorSurface() {
    if (!floorBody || !solidMaterial) return;
    let onIce = !!(iceRects.length && isOnIce(iceRects, ballBody.position.x, ballBody.position.z));
    if (onIce && usePrizeFor('ice')) onIce = false;   // Rubber Coat: ice grips like floor
    const want = onIce ? iceMaterial : solidMaterial;
    if (floorBody.material !== want) floorBody.material = want;
}

// A world prize answering `trap`, if the player has one: spends one use the
// first time the trap is met on this level visit (status line says so), and
// answers true for the rest of it. The prize HELPS, never is required
// (docs/PLAN.md) -- without one, this answers false and the trap is the trap.
function usePrizeFor(trap) {
    const id = Object.keys(PRIZES).find(k => PRIZES[k].trap === trap);
    if (!id) return false;
    if (prizeOn[id]) return true;
    if (!store || !store.usePrize(id)) return false;
    prizeOn[id] = true;
    setStatus(PRIZES[id].name.toUpperCase());
    return true;
}

// A belt under the ball's centre drags it toward the belt's speed, once per
// physics substep. The acceleration is capped below full tilt
// (mazeHazards.js), which is what lets the verifier ignore belts entirely.
// Applied as a velocity change rather than a force so it is independent of the
// ball's mass -- a heavier character is not a belt-proof one.
function applyConveyor(dt) {
    if (!level || !level.conveyors || !ballBody) return;
    const p = ballBody.position, v = ballBody.velocity;
    const belt = conveyorAt(level.conveyors, p.x, p.z);
    if (!belt) return;
    const a = conveyorAccel(belt, v.x, v.z);
    v.x += a.ax * dt;
    v.z += a.az * dt;
}

// A gust over the ball's centre pushes it along the fan's direction, once per
// substep, on the run clock -- the same gust every attempt. Capped below full
// tilt (mazeHazards.js), like a belt, so the verifier can ignore it.
function applyWind(dt) {
    if (!level || !level.fans || !ballBody) return;
    const p = ballBody.position;
    const fan = windAt(level.fans, p.x, p.z);
    if (!fan) return;
    const a = windAccel(fan, runClockMs);
    ballBody.velocity.x += a.ax * dt;
    ballBody.velocity.z += a.az * dt;
}

// A geyser's blast throws the ball straight away from its vent (mazeHazards.js).
function applyGeysers(dt) {
    if (!level || !level.geysers || !ballBody) return;
    const p = ballBody.position;
    const a = geyserAccel(level.geysers, runClockMs, p.x, p.z);
    ballBody.velocity.x += a.ax * dt;
    ballBody.velocity.z += a.az * dt;
}

// World 4, once per substep. A bumper the ball touches kicks it off
// (halved by the Obsidian Core prize, spent the first time a bumper kicks on
// this level); a spring firing under the ball launches it, once per shot.
function applyToys() {
    if (!level || !ballBody) return;
    const p = ballBody.position, v = ballBody.velocity, R = level.ballRadius;
    // A kick or launch sets the ball ROLLING at its new speed, spin and all: a
    // ball set sliding gives a third of its speed to friction spinning up.
    const roll = () => ballBody.angularVelocity.set(v.z / R, 0, -v.x / R);
    (level.bumpers || []).forEach((b, i) => {
        if (!bumperKick(b, p.x, p.z, v.x, v.z, R)) return;
        const k = bumperKick(b, p.x, p.z, v.x, v.z, R, usePrizeFor('bumpers') ? 0.5 : 1);
        if (!k) return;
        v.x = k.vx; v.z = k.vz;
        roll();
        bumperKicks++;
        if (props) props.hitBumper(i);
        try { uiSfx.open(); } catch (e) { /* ignore */ }
    });
    if (level.springs) {
        const pad = springUnder(level.springs, runClockMs, p.x, p.z, R);
        if (pad) {
            const n = level.springs.indexOf(pad), shot = springShot(pad, runClockMs);
            if (springShots[n] !== shot) {
                springShots[n] = shot;
                const out = springLaunch(pad, v.x, v.z);
                v.x = out.vx; v.z = out.vz;
                roll();
                try { uiSfx.open(); } catch (e) { /* ignore */ }
            }
        }
    }
}

// World 5, once per substep. A magnet pulls the ball toward its wall
// (unless world 4's Plastic Ball is spent on this level, spent the first
// time a field takes hold); a press coming down on the ball crushes it --
// checked here, before the step, so the press never shoves the ball out
// from under itself first.
function applyFoundry(dt) {
    if (!level || !ballBody || phase !== 'running') return;
    const p = ballBody.position;
    if (level.magnets) {
        const a = magnetAccel(level.magnets, p.x, p.z);
        if ((a.ax || a.az) && usePrizeFor('magnets')) {
            if (props) props.magnetsOff(true);            // the fields go grey
        } else if (a.ax || a.az) {
            ballBody.velocity.x += a.ax * dt;
            ballBody.velocity.z += a.az * dt;
        }
    }
    if (level.crushers && crusherHits(level.crushers, runClockMs, p.x, p.z, level.ballRadius)) knockOut('CRUSHED');
}

// Spin the star, and pop it in on arrival. The pop overshoots past full size
// before settling, because a scale that eases straight to 1.0 reads as the
// object fading in rather than as it landing.
function updateWinStar() {
    if (!winStar) return;
    const t = Math.min(1, winStarMs / WIN_STAR_POP_MS);
    // Back-ease: overshoots to ~1.1 around t=0.75, home by t=1.
    const s = t >= 1 ? 1 : (1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2));
    winStar.pivot.scale.setScalar(Math.max(0.01, s));
    // In-plane spin (never edge-on) plus a wobble that shows the thickness.
    winStar.mesh.rotation.z = (winStarMs / 1000) * WIN_STAR_SPIN;
    winStar.mesh.rotation.y = Math.sin(winStarMs / 700) * 0.45;
    // A slow bob, so the star is never completely still even once the pop has
    // settled and the player is reading the buttons under it.
    winStar.pivot.position.y = WIN_STAR_Y + Math.sin(winStarMs / 620) * 0.14;
}

function showWinStar(show) {
    if (!winStar) return;
    winStar.pivot.visible = !!show;
    if (show) {
        winStarMs = 0;
        winStar.pivot.scale.setScalar(0.01);
        updateWinStar();
    }
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function checkOutcomes() {
    const p = ballBody.position;

    for (const h of level.holes) {
        const dx = p.x - h.x, dz = p.z - h.z;
        if (dx * dx + dz * dz <= h.r * h.r) { knockOut('DOWN THE HOLE'); return; }
    }
    // An icicle striking the spot the ball is on ends the run like a hole does.
    if (level.icicles && icicleHits(level.icicles, runClockMs, p.x, p.z)) { knockOut('HIT BY AN ICICLE'); return; }
    // World 3. A flare burns unless world 2's Heat Shield is spent on this
    // level; a molten gate burns while it closes.
    if (level.flares && flareHits(level.flares, runClockMs, p.x, p.z, level.ballRadius) && !usePrizeFor('flares')) { knockOut('BURNED'); return; }
    if (level.gates && moltenGateHits(level.gates, runClockMs, p.x, p.z, level.ballRadius)) { knockOut('BURNED BY A MOLTEN GATE'); return; }
    // World 5: a live rail shocks a ball touching its wall.
    if (level.rails && railHits(level.rails, runClockMs, p.x, p.z, level.ballRadius)) { knockOut('SHOCKED'); return; }
    if (level.crushers && crusherHits(level.crushers, runClockMs, p.x, p.z, level.ballRadius)) { knockOut('CRUSHED'); return; }

    // Coins and pickups, after the hole check so a ball going down a hole
    // does not also bank the coin on its lip.
    if (pickupState) {
        const events = stepPickups(pickupState, level, { x: p.x, z: p.z, r: level.ballRadius }, lastFrameMs);
        for (const e of events) {
            if (e.type === 'coin') { props.takeCoin(e.index); uiSfx.coin(); }
            else { props.takePickup(e.index); setStatus(e.kind.toUpperCase()); uiSfx.open(); }
        }
        if (events.length) renderCoins();
        renderPowerups();
    }

    const gdx = p.x - level.goal.x, gdz = p.z - level.goal.z;
    if (gdx * gdx + gdz * gdz <= level.goal.r * level.goal.r) { win(); return; }

    // Safety net. Nothing should escape the boundary rails, but a physics
    // tunnel-through at high speed would otherwise strand the run forever.
    if (p.y < -25) restart();
}

// Something just ended the run -- a hole, an icicle. A shield spends itself
// instead of the run: the ball is put back, stopped, on the last safe spot it
// rolled over (mazePickups.js). Otherwise it falls.
function knockOut(message) {
    const back = absorbFall(pickupState);
    if (back) {
        // A bought shield is spent from the purchase, so a restart does not
        // re-arm it; a shield picked up in the maze comes back with the maze.
        if (pickupState.boughtShield && store) { store.useCharge('shield'); pickupState.boughtShield = false; }
        ballBody.position.set(back.x, FLOOR_Y + level.ballRadius + 0.02, back.z);
        ballBody.velocity.setZero();
        ballBody.angularVelocity.setZero();
        setStatus('SHIELD SAVED YOU');
        renderPowerups();
        return;
    }
    fall(message);
}

function fall(message) {
    phase = 'falling';
    fallStartedAt = performance.now();
    // Drop through the floor rather than teleporting: the player needs to see
    // WHY the run ended. collisionResponse=false keeps the body in the sim (so
    // gravity still applies) while it stops colliding with anything.
    ballBody.collisionResponse = false;
    renderPowerups();   // the run is over: hide the tap-to-fire buttons
    try { uiSfx.close(); } catch (e) { /* ignore */ }
    setStatus(message || 'DOWN THE HOLE');
}

// CONTINUE after a fall: offered when an ad can pay, once per attempt, and
// only once the run has gone on long enough that a retry would cost something.
function reviveOffered() {
    return adsAvailable() && !revivedThisAttempt && !!(pickupState && pickupState.safe)
        && performance.now() - runStartedAt >= AD_REWARDS.reviveAfterMs;
}
function openFallOffer() {
    phase = 'offer';
    offerAt = performance.now();
    offerAdPending = false;
    setGameplayActive(false);
    showEl('mazeFallPanel', true);
}
function closeFallOffer() { showEl('mazeFallPanel', false); }
function tickFallOffer() {
    if (offerAdPending) return;
    const left = 1 - (performance.now() - offerAt) / REVIVE_WINDOW_MS;
    const bar = el('mazeFallBar');
    if (bar) bar.style.transform = `scaleX(${Math.max(0, left)})`;
    if (left <= 0) { closeFallOffer(); restart(); }
}
async function reviveFromAd() {
    if (phase !== 'offer' || offerAdPending) return;
    offerAdPending = true;
    const ok = await showRewardedAd();
    offerAdPending = false;
    if (phase !== 'offer') return;
    closeFallOffer();
    if (!ok) { restart(); setStatus(adFailureMessage()); return; }
    // Back on the last safe spot, stopped, the run's clocks where they were:
    // the wall clock never stopped, so the ad's time is in the run's time.
    const back = pickupState.safe;
    revivedThisAttempt = true;
    ballBody.collisionResponse = true;
    ballBody.position.set(back.x, FLOOR_Y + level.ballRadius + 0.02, back.z);
    ballBody.velocity.setZero();
    ballBody.angularVelocity.setZero();
    smoothed = null;
    recenterPending = true;
    phase = 'running';
    setGameplayActive(true);
    renderPowerups();
    setStatus('BACK IN');
}

// x2 COINS on a clear: the clear's own pay again (capped), once.
async function doubleClearFromAd() {
    if (phase !== 'won' || !lastClear) return;
    const ok = await showRewardedAd();
    if (!ok) { setStatus(adFailureMessage()); return; }
    const res = store ? store.adDoubleClear(lastClear.earned) : { ok: false };
    lastClear = null;
    rewardedThisBreak = true;
    showEl('mazeDoubleBtn', false);
    if (res.ok) { setStatus('+' + formatBearings(res.amount) + '  DOUBLED'); try { uiSfx.coin(); } catch (e) { /* ignore */ } }
}

// FREE SHIELD on the ready screen: a Shield charge, armed when the run starts.
function offerFreeShield() {
    const owned = store ? (store.get().charges.shield || 0) : 0;
    showEl('mazeAdShieldBtn', phase === 'ready' && adsAvailable() && !freeShieldTaken && !owned);
}
async function freeShieldFromAd() {
    if (phase !== 'ready' || freeShieldTaken) return;
    const ok = await showRewardedAd();
    if (!ok) { setStatus(adFailureMessage()); return; }
    freeShieldTaken = true;
    if (store) store.adCharge('shield');
    offerFreeShield();
    setStatus('SHIELD READY  —  IT ARMS WHEN YOU START');
}

function win() {
    phase = 'won';
    renderPowerups();
    setGameplayActive(false);
    const ms = Math.round(performance.now() - runStartedAt);
    // The progress store decides what this clear is worth (progressStore.js):
    // the ladder, the time floor, and first-time-only pay. Coins bank only
    // here, on a clear -- a run that falls is worth nothing, which is what
    // makes a coin down a risky branch a choice.
    const result = store ? store.recordClear(level.id, ms, pickupState ? pickupState.coins : 0) : null;
    // Level gravity back to straight down. Tilt is only sampled while the phase
    // is 'running', so without this the world keeps the exact lean the player
    // happened to be holding at the moment they won, and the ball wanders back
    // out of the goal it just reached while the CLEARED banner is still up.
    world.gravity.set(0, -GRAVITY, 0);
    mazeGroup.rotation.set(0, 0, 0);
    try { uiSfx.open(); } catch (e) { /* ignore */ }
    showClearResult(result, ms);
    lastClear = result && result.accepted && result.earned > 0 ? result : null;
    rewardedThisBreak = false;
    const dbl = el('mazeDoubleText');
    if (dbl && lastClear) dbl.textContent = '×2 COINS  +' + formatBearings(Math.min(AD_REWARDS.doubleCap, lastClear.earned));
    showEl('mazeDoubleBtn', !!lastClear && adsAvailable());
    // A trial that cleared: say where the marble can be had for keeps.
    if (trialMarble) {
        const m = MARBLES[trialMarble.id];
        setTimeout(() => { if (phase === 'won' && trialMarble) setStatus('KEEP ' + m.name.toUpperCase() + '?  GEAR  ' + formatBearings(m.price)); }, 2200);
    }
    showWinStar(true);
    showEl('mazeWinPanel', true);
    showEl('mazeReplayBtn', true);
    showEl('mazeLevelsBtn', true);
    // NEXT MAZE only exists when there IS one. On the final level the panel
    // collapses to EXIT, rather than offering a button that would do nothing.
    showEl('mazeNextBtn', !!nextLevelAfter(level));
}

function restart() {
    // A run is gameplay; the level select, the CLEARED panel and the menu are
    // breaks (platform.js -- no-op on the web).
    setGameplayActive(true);
    revivedThisAttempt = false;
    closeFallOffer();
    showEl('mazeDoubleBtn', false);
    showEl('mazeAdShieldBtn', false);
    placeBallAtStart();
    smoothed = null;
    recenterPending = true;      // re-zero to however they're holding it now
    runStartedAt = performance.now();
    // Rewind the gates with the ball. Every attempt at a level then presents
    // the same gate phases at the same moments, so a player learning a timing
    // is learning the level rather than re-rolling it -- and two runs of the
    // same route take the same time, which matters when gold pays.
    runClockMs = 0;
    springShots = [];
    updateGates();
    // Every attempt starts with every coin and pickup back in place, and any
    // bought charges still unspent.
    const owned = store ? store.get().charges : {};
    pickupState = createRunPickups(level, owned, ballSpec);
    if (props) props.tickRun(0);
    pickupState.boughtShield = pickupState.shield;
    if (props) props.reset();
    renderCoins();
    renderPowerups();
    phase = 'running';
    setStatus('');
    showWinStar(false);
    showEl('mazeWinPanel', false);
    showEl('mazeReplayBtn', false);
}

function formatTime(ms) {
    const s = ms / 1000;
    return s.toFixed(1) + 's';
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function el(id) { return document.getElementById(id); }
function showEl(id, show) { const e = el(id); if (e) e.style.display = show ? '' : 'none'; }
function setStatus(text) { const e = el('mazeStatus'); if (e) e.textContent = text || ''; }
function renderCoins() {
    const e = el('mazeCoins');
    if (e) e.textContent = pickupState ? `${pickupState.coins} / ${(level && level.coins || []).length}` : '';
}
// Which power-ups are live, and how many bought charges are left to fire.
function renderPowerups() {
    const e = el('mazePowerups');
    if (!e || !pickupState) return;
    const live = [];
    if (pickupState.shield) live.push('SHIELD');
    if (pickupState.slowmoMs > 0) live.push(`SLOW ${Math.ceil(pickupState.slowmoMs / 1000)}`);
    if (pickupState.magnetMs > 0) live.push(`MAGNET ${Math.ceil(pickupState.magnetMs / 1000)}`);
    e.textContent = live.join('  ');
    // One tap button per bought power-up still held, with its count.
    for (const kind of ['slowmo', 'magnet']) {
        const b = el('mazeUse_' + kind);
        if (!b) continue;
        const n = pickupState.held[kind] || 0;
        b.style.display = n > 0 && phase === 'running' ? '' : 'none';
        const c = b.querySelector('.count');
        if (c) c.textContent = String(n);
    }
}

// Fire a bought power-up mid-run (a HUD tap). Spent from the store's
// inventory at once, so a restart does not refund it.
export function useRunCharge(kind) {
    if (phase !== 'running' || !pickupState || !useCharge(pickupState, kind)) return false;
    if (store) store.useCharge(kind);
    renderPowerups();
    return true;
}

// ---------------------------------------------------------------------------
// Enter / exit
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Level select
// ---------------------------------------------------------------------------

// The progress store (progressStore.js), handed in by enterMaze. Everything
// the level list shows is read from it; nothing here keeps a second copy.
let store = null;
let allLevels = [];
let payouts = { goldBonusPct: 0, byWorld: {} };
function progressNow() { return store ? store.get() : { cleared: {}, goldClaimed: [], highestIndex: 0, wallet: 0, prizes: [] }; }

// Thousands separators, matching marbleWorks.js's formatBearings. Duplicated
// rather than imported on purpose: importing it would pull the entire shop UI
// into the maze's lazily-loaded chunk to format a number.
function formatBearings(n) {
    return Number(n).toLocaleString('en-US');
}

function tierIcon(tier) {
    return tier === 'gold' ? '\u{1F947}' : tier === 'silver' ? '\u{1F948}' : tier === 'bronze' ? '\u{1F949}' : '';
}

// THE MENUS' BACKDROP. Outside a run the screen shows one of two scenes:
//   'planet'  the world of the player's NEXT level as a planet, their marble
//             orbiting it as a moon (planet3d.js) -- home, gear, store;
//   'system'  every launch world orbiting a sun (solarSystem3d.js) -- the
//             WORLDS tab, where a planet is tapped to pick a world.
// The menu screens themselves are DOM drawn over it by menus.js.
let menuHandler = null;
let planet = null;
let solar = null;
let backdrop = null;

// The level the home screen offers: the first one not yet cleared, or the
// last level once everything is.
export function nextLevel() {
    if (!allLevels.length) return null;
    const idx = (progressNow().highestIndex || 0) + 1;
    return allLevels.find(l => l.index === idx) || allLevels[allLevels.length - 1];
}

let planetThemeOverride = null;   // test seam: __mazeDebug.planetTheme

// What each launch world looks like and whether it can be entered, for the
// solar system: a built world wears its first level's theme; one not built
// yet has none.
export function worldsInfo() {
    const prog = progressNow();
    const out = [];
    for (let n = 1; n <= LAUNCH_WORLDS; n++) {
        const lvls = allLevels.filter(l => l.world === n);
        out.push({
            n, name: worldName(n), levels: lvls,
            theme: lvls.length ? resolveMazeTheme(lvls[0].theme) : null,
            state: !lvls.length ? 'coming' : isUnlocked(prog, lvls[0]) ? 'open' : 'locked'
        });
    }
    return out;
}

// How far the player has spun the solar system: kept here, not in the
// system, so it survives the backdrop being rebuilt (a marble change, a trip
// to another tab and back).
let systemSpin = 0;
function buildShowcase(kind) {
    if (solar) systemSpin = solar.spin();
    teardownLevel();
    if (!scene) return;
    backdrop = kind;
    const tracked = [];
    if (kind === 'system') {
        scene.background = new THREE.Color('#07060a');
        solar = buildSolarSystem(worldsInfo(), tracked);
        solar.setSpin(systemSpin);
        mazeGroup = solar.group;
    } else {
        const lv = nextLevel();
        if (!lv) return;
        const prog = progressNow();
        ballSpec = ballSetup(prog.marble, prog.upgrades);
        const theme = resolveMazeTheme(planetThemeOverride || lv.theme);
        // Space, tinted by the world: its backdrop colour, much darker.
        scene.background = new THREE.Color(theme.backdropColor).multiplyScalar(0.45);
        planet = buildPlanet(theme, ballSpec.look, tracked);
        mazeGroup = planet.group;
    }
    tracked.forEach(track);
    scene.add(mazeGroup);
    (planet || solar).tick(performance.now() / 1000);
}

// Leave whatever is on screen for the menus, and show `tab` (menus.js).
// Leaving a level ends a marble trial.
function enterMenus(tab) {
    trialMarble = null;
    const want = tab === 'worlds' ? 'system' : 'planet';
    if (phase !== 'menu' || backdrop !== want) {
        buildShowcase(want);
        phase = 'menu';
        showEl('mazeHud', false);
    }
    if (menuHandler) menuHandler(tab || 'home');
    requestRender();
}

// Rebuild the backdrop after the marble or progress changed (menus.js).
export function refreshShowcase() {
    if (phase !== 'menu') return;
    buildShowcase(backdrop || 'planet');
    requestRender();
}

// The camera for the planet: square on, slightly above its equator, far
// enough that the moon's whole orbit stays on screen on a phone-shaped
// display (fitted to whichever axis binds).
function computeMenuPose() {
    const camera = getCamera();
    const fov = ((camera && camera.fov) || 48) * Math.PI / 180;
    const aspect = (camera && camera.aspect) || (768 / 1180);
    if (solar) {
        // From high above and in front, so the orbits read as wide ellipses,
        // aimed below the sun so the system sits in the top of the screen and
        // the world sheet (menus.js) has the bottom.
        const r = solar.radius;
        // The sheet is a short strip (one row of levels), so the system
        // gets most of the screen: close in, and only a little above centre.
        const dist = Math.max(r / (Math.tan(fov / 2) * aspect), r * 0.7 / Math.tan(fov / 2)) * 0.9;
        const el = 68 * Math.PI / 180;
        const shift = r * 0.36;
        _camPos.set(0, Math.sin(el) * dist, Math.cos(el) * dist + shift);
        SYSTEM_LOOKAT.set(0, 0, shift);
        return { pos: _camPos, lookAt: SYSTEM_LOOKAT };
    }
    const r = planet ? planet.radius : 5.3;
    const dist = Math.max(r / (Math.tan(fov / 2) * aspect), r / Math.tan(fov / 2));
    _camPos.set(0, dist * 0.18, dist);
    return { pos: _camPos, lookAt: MENU_LOOKAT };
}
const MENU_LOOKAT = new THREE.Vector3(0, -0.2, 0);
const SYSTEM_LOOKAT = new THREE.Vector3();

// THE SYSTEM'S TAPS AND LABELS (menus.js). Screen points are CSS pixels.
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _proj = new THREE.Vector3();
export function pickWorld(clientX, clientY) {
    const r = getRenderer(), camera = getCamera();
    if (!solar || !r || !camera) return null;
    const rect = r.domElement.getBoundingClientRect();
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    _ray.setFromCamera(_ndc, camera);
    return solar.pick(_ray);
}
// Turn the solar system by a drag (menus.js), and let it coast on release.
export function spinWorlds(d) { if (solar) { solar.spinBy(d); requestRender(); } }
export function releaseWorlds(v) { if (solar) solar.release(v); }
// After the try-a-marble ad (shopUi.js): play the next level with `id`.
export function startMarbleTrial(id) {
    if (!MARBLES[id]) return false;
    const lv = nextLevel();
    if (!lv) return false;
    trialMarble = { id, levelId: null };
    startLevel(lv.id);
    return true;
}
export function marbleTrial() { return trialMarble ? { ...trialMarble } : null; }
export function selectWorld(n) { if (solar) solar.select(n); requestRender(); }
export function worldAnchors() {
    const r = getRenderer(), camera = getCamera();
    if (!solar || !r || !camera) return [];
    const rect = r.domElement.getBoundingClientRect();
    camera.updateMatrixWorld();
    return solar.anchors().map(a => {
        _proj.copy(a.pos).add(new THREE.Vector3(0, -a.r * 1.1, 0)).project(camera);
        return { n: a.n, x: rect.left + (_proj.x + 1) / 2 * rect.width, y: rect.top + (1 - _proj.y) / 2 * rect.height + 6 };
    });
}

// The menus ask mazeGame for screens through these.
export function setMenuHandler(fn) { menuHandler = fn; }
export function showMenus(tab) { enterMenus(tab); }
export function playLevel(id) { startLevel(id || (nextLevel() && nextLevel().id)); }

function showLevelSelect() { enterMenus('worlds'); }

// Build and enter one level. Everything from the previous level is disposed
// first -- levels are rebuilt per run, unlike the game board which is built
// once for the page's lifetime.
function startLevel(levelId) {
    const lv = allLevels.find(l => l.id === levelId);
    if (!lv || !scene) return;
    teardownLevel();

    level = lv;
    const prog = progressNow();
    // A trial binds to the first level started after it, and ends on any other.
    if (trialMarble && trialMarble.levelId === null) trialMarble.levelId = lv.id;
    if (trialMarble && trialMarble.levelId !== lv.id) trialMarble = null;
    ballSpec = ballSetup(trialMarble ? trialMarble.id : prog.marble, prog.upgrades);
    prizeOn = {};
    // Out of the menus: their screens come down and the HUD goes up.
    if (menuHandler) menuHandler(null);
    const theme = resolveLevelTheme(lv);
    scene.background = new THREE.Color(theme.backdropColor);

    const built = buildLevelMeshes(lv, theme);
    mazeGroup = built.group;
    scene.add(mazeGroup);
    buildWorld(lv, built.wallSpecs);
    placeBallAtStart();

    showEl('mazeSelect', false);
    showEl('mazeHud', true);
    showEl('mazeWinPanel', false);
    showEl('mazeReplayBtn', false);
    showEl('mazeNextBtn', false);
    showEl('mazeLevelsBtn', false);
    showEl('mazeStartBtn', true);
    const nameEl = el('mazeLevelName');
    if (nameEl) nameEl.textContent = lv.name;

    phase = 'ready';
    lastStepTime = 0;
    smoothed = null;
    setStatus(trialMarble ? 'TRYING ' + marbleName(trialMarble.id) + '  —  THIS LEVEL' : 'TAP START, THEN TILT');
    freeShieldTaken = false;
    rewardedThisBreak = false;   // that break is over; this level's are its own
    closeFallOffer();
    offerFreeShield();
    requestRender();
}

// Drop the current level's scene + physics without leaving the maze.
function teardownLevel() {
    setGameplayActive(false);
    if (mazeGroup && scene) scene.remove(mazeGroup);
    disposeAll();
    mazeGroup = null;
    ballMesh = null;
    ballBody = null;
    world = null;
    level = null;
    // Hazard state is per LEVEL, and every one of these holds a reference into
    // the world or the group that was just disposed. Leaving gates populated in
    // particular would have updateGates writing into freed bodies on the next
    // frame -- the stale-callback class of bug docs/KNOWN_ISSUES.md already
    // records once.
    gates = [];
    armBodies = [];
    crusherBodies = [];
    springShots = [];
    iceRects = [];
    winStar = null;
    winStarMs = 0;
    props = null;
    forest = null;
    planet = null;
    solar = null;
    backdrop = null;
    pickupState = null;
    floorBody = null;
    solidMaterial = null;
    iceMaterial = null;
    runClockMs = 0;
}

function nextLevelAfter(lv) {
    if (!lv) return null;
    return allLevels.find(l => l.index === lv.index + 1) || null;
}

const exclusive = {
    isActive: () => active,
    getPose: () => (!active ? null : phase === 'menu' ? computeMenuPose() : (level ? computeCameraPose() : null))
};

export function isMazeActive() { return active; }

// Test/debug surface, mirroring scene3d.js's window.__r3dDebug.
//
// It exists for one reason worth stating: this sandbox has no accelerometer and
// headless Chromium never FIRES deviceorientation -- but it can CONSTRUCT one,
// so a test can dispatch a synthetic lean and then ask where the ball went.
// That closes the loop on the only part of the maze that is otherwise
// unverifiable off-device: raw Euler angles -> mazeTilt -> gravity -> cannon ->
// the ball actually moving, and moving in the right direction.
window.__mazeDebug = {
    active: () => active,
    phase: () => phase,
    ballPos: () => (ballBody ? { x: ballBody.position.x, y: ballBody.position.y, z: ballBody.position.z } : null),
    gravity: () => (world ? { x: world.gravity.x, y: world.gravity.y, z: world.gravity.z } : null),
    // The last orientation reading the module actually received. Lets a test
    // dispatch a real DeviceOrientationEvent and confirm the LISTENER is wired,
    // separately from whether the physics then had any frames to run in.
    reading: () => ({ beta: latestReading.beta, gamma: latestReading.gamma }),
    // MANUAL CONTROL: whether a frame right now would be steered by keys/drag,
    // and the reading it would use. advanceFrames runs the ordinary frame path
    // without a sensor reading, so a test can press a real key and check the
    // ball went that way.
    manual: () => ({ active: manualActive(), sensorSeen, reading: manualReading(), hint: manualHintShown }),
    advanceFrames: (frames, dtMs) => {
        if (!active || !world) return null;
        for (let i = 0; i < (frames || 1); i++) advance(dtMs || (1000 / 60));
        return { x: ballBody.position.x, y: ballBody.position.y, z: ballBody.position.z };
    },
    // The theme the current level resolved to, and the colour the ball is
    // ACTUALLY wearing. Two values rather than one so a test can tell "the
    // theme resolved" apart from "the theme reached the material" -- the ball
    // used to take the player's equipped marble skin, and the whole point of
    // the change is that it no longer does.
    theme: () => (level ? resolveLevelTheme(level) : null),
    // World 1's forest on this level: canopies and their opacity right now.
    forest: () => (forest ? { canopies: forest.canopyCount, opacities: forest.canopyOpacities(), centres: forest.canopyCentres() } : null),
    // Run the canopy fade as if the marble sat at (x, z) for `ms`.
    canopyFadeAt: (x, z, ms) => (forest ? (forest.tick(x, z, ms || 600), forest.canopyOpacities()) : null),
    ballColor: () => (ballMesh && ballMesh.material && ballMesh.material.color
        ? '#' + ballMesh.material.color.getHexString() : null),
    // Advance the maze deterministically, without waiting on rAF. Feeds the
    // reading through the same handler a real sensor event would, then runs the
    // same per-frame path -- so this exercises the whole chain (calibration ->
    // tilt math -> gravity -> cannon -> ball) and skips only the browser's
    // frame scheduler, which is precisely the unreliable part in this sandbox.
    simulate: (beta, gamma, frames, dtMs) => {
        if (!active || !world) return null;
        onOrientation({ beta, gamma });
        for (let i = 0; i < (frames || 1); i++) advance(dtMs || (1000 / 60));
        return { x: ballBody.position.x, y: ballBody.position.y, z: ballBody.position.z };
    },
    // Put the ball on the goal and let the ORDINARY frame path notice. Nothing
    // downstream is faked: checkOutcomes -> win -> the progress store's
    // recordClear -> the status line all run exactly as they do for a player.
    // Only the several minutes of tilting are skipped, which is the one part a
    // headless browser has no way to perform. Deliberately does NOT touch
    // runStartedAt, so a test that warps too early gets the store's real
    // sub-floor rejection rather than a convenient pass.
    // The win celebration, so a test can tell "the star exists" apart from "the
    // star is on screen and turning" -- it is built hidden at level load, so
    // merely finding it in the scene proves nothing about the payoff firing.
    winStar: () => (winStar ? {
        visible: winStar.pivot.visible,
        scale: winStar.pivot.scale.x,
        spinY: winStar.mesh.rotation.z,
        y: winStar.pivot.position.y
    } : null),
    // Hazard state, so a browser test can confirm the gates are actually moving
    // and that ice is reaching the physics rather than only being drawn.
    hazards: () => ({
        gateCount: gates.length,
        gatePositions: gates.map(g => ({ x: g.body ? g.body.position.x : null, z: g.body ? g.body.position.z : null })),
        iceCount: iceRects.length,
        onIce: !!(ballBody && iceRects.length && isOnIce(iceRects, ballBody.position.x, ballBody.position.z)),
        // Which contact material the floor is presenting RIGHT NOW. The visual
        // and the physics are separate code paths, and a test that only checked
        // the ice quad rendered would pass on a maze where ice does nothing.
        floorIsIce: !!(floorBody && iceMaterial && floorBody.material === iceMaterial),
        clockMs: runClockMs
    }),
    // Build and enter any level by id, bypassing the level-select ladder, and
    // put the ball anywhere on it. Purely a test seam for the hazards: an ice
    // patch or a gate sits deep in the ladder, and walking a browser test
    // through six real clears to reach one would take a minute of wall-clock
    // per assertion.
    //
    // It grants nothing: the progress store refuses a clear of any level more
    // than one step past the furthest cleared, whichever level was built, so
    // the worst this does is let someone look at a level early.
    startLevelForTest: (levelId) => {
        const lv = allLevels.find(l => l.id === levelId);
        if (!active || !lv) return false;
        startLevel(levelId);
        return !!level && level.id === levelId;
    },
    placeBall: (x, z) => {
        if (!ballBody || !level) return null;
        ballBody.position.set(x, FLOOR_Y + level.ballRadius + 0.02, z);
        ballBody.velocity.setZero();
        ballBody.angularVelocity.setZero();
        // One frame so the per-frame hazard coupling (updateFloorSurface) sees
        // the new position -- placing the ball without stepping would report the
        // surface under wherever it used to be.
        const wasPhase = phase;
        phase = 'running';
        advance(1000 / 60);
        phase = wasPhase;
        return { x: ballBody.position.x, z: ballBody.position.z };
    },
    // Age the current run by `ms` of wall clock. The run timer reads the real
    // clock (it is what a player's time IS), and a test that waited out a
    // level's minMs would be a test clocked on a throttled sandbox's rAF.
    // Grants nothing the store does not still check.
    ageRun: (ms) => { if (phase === 'running') runStartedAt -= ms; return phase === 'running'; },
    // World 2's timed hazards, for a test: jump the run clock, and read the
    // wind and icicles where the ball is.
    setRunClock: (ms) => { runClockMs = ms; updateGates(); if (props) props.tickRun(ms); return runClockMs; },
    world3: () => (level ? {
        flares: (level.flares || []).map(f => flareState(f, runClockMs).state),
        moltenBurning: (level.gates || []).filter(g => g.molten).map(g => gateBurning(g, runClockMs)),
        moltenGlow: gates.filter(g => g.glow).map(g => g.glow.value),
        geysers: (level.geysers || []).map(g => geyserState(g, runClockMs).state)
    } : null),
    // Roll the ball: set its velocity (units/s) without moving it.
    setBallVelocity: (vx, vz) => { if (!ballBody) return false; ballBody.velocity.set(vx, 0, vz); return true; },
    trial: () => ({ trial: marbleTrial(), ball: ballSpec.id }),
    world5: () => (level ? {
        magnets: (level.magnets || []).length,
        pull: ballBody && level.magnets ? magnetAccel(level.magnets, ballBody.position.x, ballBody.position.z) : null,
        crushers: (level.crushers || []).map(c => crusherState(c, runClockMs).state),
        crusherBodyY: crusherBodies.map(({ body }) => body.position.y),
        rails: (level.rails || []).map(r => railState(r, runClockMs).state),
        prizeOn: Object.keys(prizeOn).filter(k => prizeOn[k])
    } : null),
    world4: () => (level ? {
        bumpers: (level.bumpers || []).length,
        kicks: bumperKicks,
        springs: (level.springs || []).map(sp => springState(sp, runClockMs).state),
        arms: armBodies.map(({ a, body }) => {
            const q = body.quaternion, ang = -2 * Math.atan2(q.y, q.w);
            return { want: armAngle(a, runClockMs), body: ang };
        }),
        prizeOn: Object.keys(prizeOn).filter(k => prizeOn[k])
    } : null),
    world2: () => (level ? {
        fans: (level.fans || []).length,
        icicles: (level.icicles || []).length,
        windHere: ballBody && level.fans ? (() => { const f = windAt(level.fans, ballBody.position.x, ballBody.position.z); return f ? windStrength(f, runClockMs) : null; })() : null,
        icicleStates: (level.icicles || []).map(ic => icicleState(ic, runClockMs).state)
    } : null),
    // Show the home planet in another theme (screenshots of worlds not built
    // yet). Display only.
    planetTheme: (id) => { planetThemeOverride = id || null; refreshShowcase(); return phase === 'menu'; },
    menuPhase: () => phase === 'menu' && !!(planet || solar),
    backdrop: () => (phase === 'menu' ? backdrop : null),
    worldAnchors: () => worldAnchors(),
    solarSpin: () => (solar ? solar.spin() : null),
    // The progress the store holds now -- what a clear actually banked.
    progress: () => (store ? JSON.parse(JSON.stringify(store.get())) : null),
    coinsTaken: () => (pickupState ? pickupState.coins : null),
    warpToGoal: () => {
        if (!active || !world || !level || phase !== 'running') return false;
        ballBody.velocity.set(0, 0, 0);
        ballBody.angularVelocity.set(0, 0, 0);
        ballBody.position.set(level.goal.x, ballBody.position.y, level.goal.z);
        advance(1000 / 60);
        return phase === 'won';
    }
};

// Take the screen: load the levels, hook the frame loop, show level select.
// `progressStore` is the loaded store from main.js. Resolves false (with the
// reason on the status line) if the levels cannot be loaded.
export async function enterMaze(progressStore) {
    if (active) return true;
    store = progressStore || null;

    scene = getScene();
    const camera = getCamera();
    if (!scene || !camera) return false;

    let data;
    try { data = await loadLevels(); }
    catch (e) { setStatus('COULD NOT LOAD THE LEVELS. RELOAD TO TRY AGAIN.'); return false; }

    allLevels = Array.isArray(data.levels) ? data.levels : [];
    if (!allLevels.length) return false;
    payouts = (data.payouts && typeof data.payouts === 'object') ? data.payouts : { goldBonusPct: 0, byWorld: {} };
    if (store && store.setLevels) store.setLevels(allLevels, payouts);

    active = true;
    phase = 'idle';
    lastStepTime = 0;
    smoothed = null;

    if (!frameHookInstalled) { onFrame(step); frameHookInstalled = true; }
    setExclusiveMode(exclusive);

    // Entering lands on LEVEL SELECT, never straight into a run: which level
    // you are playing should always be something you chose.
    reportMazeCompletion();
    enterMenus('home');
    requestRender();
    return true;
}

async function startRun() {
    // No level built means nothing to start. The button is hidden on the level
    // select, but hidden is not disabled -- bindTap fires on any element it is
    // bound to, and placeBallAtStart would dereference a null body. Cheap guard
    // against a real crash rather than a theoretical one.
    if (!level || !ballBody) return;
    const perm = await requestTiltPermission();
    const tiltOk = !(perm === 'denied' || perm === 'unsupported');
    if (tiltOk) bindOrientation();
    else {
        // No longer a dead end: the run goes ahead on keys / drag (MANUAL
        // CONTROL above). Still reported, so the Health tab shows how often.
        reportDiag('maze_tilt_unavailable', {
            message: perm, file: 'mazeGame.js',
            details: JSON.stringify({ api: 'DeviceOrientationEvent', result: perm, fallback: 'manual' })
        });
    }
    clearManual();
    showEl('mazeStartBtn', false);
    showEl('mazeAdShieldBtn', false);
    recenterPending = true;      // first reading becomes neutral
    neutral = captureNeutral(latestReading.beta, latestReading.gamma);
    restart();
    // A desktop browser has the API and grants it, then never sends a reading.
    // Give a real sensor a moment to speak before telling the player how else
    // to steer (manual input works from the first frame either way).
    if (sensorCheckTimer) clearTimeout(sensorCheckTimer);
    if (!tiltOk) showManualHint();
    else sensorCheckTimer = setTimeout(() => { sensorCheckTimer = null; showManualHint(); }, 900);
}

// The ladder is the game's only finite content, so its cleared share is what
// platform.js reports as completion.
function reportMazeCompletion() {
    if (!allLevels.length) return;
    const ids = new Set(allLevels.map(l => l.id));
    const done = Object.keys(progressNow().cleared || {}).filter(id => ids.has(id)).length;
    reportGameCompleted(100 * done / allLevels.length);
}

// What a clear earned, on the status line. The tier and the pay come from the
// progress store's answer -- one place decides them -- and the time shown is
// THIS run's, with the old best beside it when that was faster.
function showClearResult(res, ms) {
    if (!res || !res.accepted) {
        // Not counted (too fast for the level's floor, or out of ladder order):
        // say the time, claim nothing.
        setStatus('CLEARED  ' + formatTime(ms));
        return;
    }
    // PLATFORM (no-ops on the web): a FIRST clear is a big moment.
    if (res.firstClear) happytime();
    reportMazeCompletion();
    const icon = tierIcon(res.tier);
    const beaten = Number.isFinite(res.bestMs) && res.bestMs < res.runMs ? '   Best ' + formatTime(res.bestMs) : '';
    // A replay that paid nothing says nothing about pay: a "+0" on every
    // re-run would read as the game being broken.
    const paid = res.earned > 0 ? '   +' + formatBearings(res.earned) : '';
    setStatus('CLEARED  ' + formatTime(res.runMs) + (icon ? '  ' + icon : '') + beaten + paid);
    if (res.prize) {
        // Its own line, after a beat, so it is not lost in the time and pay.
        setTimeout(() => { if (phase === 'won') setStatus('PRIZE  ' + prizeName(res.prize)); }, 1400);
        try { uiSfx.open(); } catch (e) { /* ignore */ }
    }
}

// Display names for world prizes (docs/PLAN.md's world table). Falls back to
// the id: a banner with no name in it is worse than an ugly one.
const PRIZE_NAMES = { rubberCoat: 'RUBBER COAT  —  grip on ice' };
function prizeName(id) { return PRIZE_NAMES[id] || id; }

// For the store and profile pages (shopUi.js): the levels, and a way to
// redraw the level list after something was bought.
export function getLevels() { return allLevels.slice(); }

export function initMazeControls() {
    bindTap('mazeStartBtn', () => { startRun(); });
    // EXIT from a level goes back to the level list; there is no other screen
    // to leave to yet.

    // CrazyGames: moving on from a CLEARED level is a natural break, so it may
    // carry a break ad first (platform.js throttles it; on the web it resolves
    // false at once). Never after a fall: that is mid-attempt, not a break.
    const afterBreak = async (go) => {
        if (features.ads && phase === 'won' && !rewardedThisBreak) await showMidgameAd();
        go();
    };
    // Leaving a level for the menus is a natural break too (platform.js
    // spaces break ads at least three minutes apart).
    const leave = async () => {
        if (phase === 'running' || phase === 'falling' || phase === 'offer') { closeFallOffer(); phase = 'idle'; setGameplayActive(false); }
        if (features.ads && !rewardedThisBreak) await showMidgameAd();
        enterMenus('home');
    };
    bindTap('mazeReviveBtn', () => { reviveFromAd(); });
    bindTap('mazeRetryBtn', () => { if (phase === 'offer' && !offerAdPending) { closeFallOffer(); restart(); } });
    bindTap('mazeDoubleBtn', () => { doubleClearFromAd(); });
    bindTap('mazeAdShieldBtn', () => { freeShieldFromAd(); });
    bindTap('mazeExitBtn', () => { leave(); });
    bindTap('mazeWinExitBtn', () => { leave(); });
    bindTap('mazeLevelsBtn', () => { afterBreak(() => showLevelSelect()); });
    bindTap('mazeNextBtn', () => {
        afterBreak(() => {
            const next = nextLevelAfter(level);
            if (next) startLevel(next.id);
        });
    });
    bindTap('mazeReplayBtn', () => { afterBreak(() => restart()); });
    bindTap('mazeUse_slowmo', () => { useRunCharge('slowmo'); });
    bindTap('mazeUse_magnet', () => { useRunCharge('magnet'); });
    bindTap('mazeRecenterBtn', () => {
        recenterPending = true;
        setStatus('RECENTERED');
        setTimeout(() => { if (active && phase === 'running') setStatus(''); }, 900);
    });
}
