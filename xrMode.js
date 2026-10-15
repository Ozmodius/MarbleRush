// MIXED REALITY ON META QUEST 3 (the user's call, 2026-10-14: the room around
// the board, grab and tilt, the playable loop first; docs/PLAN.md).
//
// ENTER VR on a level's ready screen opens an 'immersive-ar' session: the
// headset's passthrough is the backdrop and the level sits on your table
// (xrMath.js places it ahead of and under your eyes). Nothing about the level
// changes -- it is drawn through a RIG that scales the player instead
// (xrMath.js), so walls, physics, shadows and gold times are the ones every
// other player has.
//
// TILT. Squeeze a controller's grip, or pull its trigger, or pinch with a
// tracked hand, anywhere but on the panel, and the board follows that hand's
// lean from there until you let go (xrMath.js grabTilt). mazeGame.js takes
// the reading (xrReading) through mazeTilt.js like any other: still a
// rotation of GRAVITY, never of the bodies, and the board's visible lean
// follows it in full (a flat screen shows a seventh of it).
//
// THE PANEL MIRRORS THE PAGE. The level's DOM keeps running underneath, so
// the panel (xrPanel.js) is built from it every frame -- its name, coins and
// medal clock, its status lines, whichever of its buttons are showing -- and
// pointing at a button and pulling the trigger (or pinching) clicks the
// page's own. Every result, medal and save goes through the code that already
// does it. PLACE BOARD and EXIT VR are the panel's own. Leaving the level
// (LEVELS, EXIT) ends the session: the menus are flat.
//
// FEEL (2026-10-14): the controller holding the board buzzes with the marble
// -- a wall's knock as hard as the sound's, a bumper, a coin's tick, a shield,
// the clear, and the thud of a hole (xrFeel, from mazeGame.js's own hit and
// event calls; xrMath.js pulseFor). Both controllers when neither holds on.
//
// THE REAL TABLE (2026-10-14). Where the headset knows the room (WebXR
// hit-test, from the Quest's Space Setup), a ray dropped straight down at the
// board's planned spot finds the table under it and the board sits on it
// (xrMath.js tableHeight); PLACE BOARD becomes pointing: an outline of the
// board follows the ray over real surfaces and the trigger sets it down
// there. Without hit-test, both fall back to the head-height rule.
//
// Web only (platform.js features.xr): CrazyGames stays flat. Explore is not
// offered in VR yet (comfort first, docs/PLAN.md).
import * as THREE from 'three';
import { getRenderer, getScene, getCamera, onFrame, requestRender } from './sceneHost.js';
import { features } from './platform.js';
import { boardScale, placeBoard, rigMatrix, grabTilt, pulseFor, tableHeight, placeOnSurface, XR_TABLE_LIFT_M } from './xrMath.js';
import { createXrPanel } from './xrPanel.js';

const MODE = 'immersive-ar';
const RAY_IDLE_M = 0.25;              // a ray's drawn length, pointing at nothing
const DOT_R = 0.12;                   // the ray's dot on the panel, level units
const PLACE_AFTER_FRAMES = 3;         // the headset's pose settles before placing
const TABLE_LOOK_FRAMES = 90;         // how long the dropped ray looks for a table
const HIT_GAP_MS = 30;                // knocks closer than this are one buzz
const ZERO = Object.freeze({ beta: 0, gamma: 0 });
// The page's buttons the panel shows, in its order, when they are showing;
// true is the one bright choice. The ad buttons are left off: no ad on the web.
const MIRROR = [
    ['storyGoBtn', true], ['mazeStartBtn', true], ['mazeRetryBtn', false],
    ['mazeNextBtn', true], ['mazeReplayBtn', false], ['mazeGiftBtn', false],
    ['mazeLevelsBtn', false], ['mazeWinExitBtn', false]
];
export const XR_HINT = 'GRIP OR PINCH, THEN TILT YOUR HAND';
export const XR_PLACE_HINT = 'POINT AT A TABLE, THEN PULL THE TRIGGER';

let supportP = null;
let host = null;          // mazeGame.js: { phase(), level(), onChange(on) }
let session = null;
let starting = false;
let rig = null, panel = null;
let head = null;          // the head pose the board was placed from (room space)
let placeFrames = 0, placedKey = '', placeVer = 0;
let tableY = null;        // the real table's top under the planned spot, if found
let spot = null;          // a place the player pointed at ({ x, y, z, yaw }), if any
let lastPlace = null;     // where the board is now (room space)
let drop = null;          // the dropped ray looking for the table: { source, frames }
let placing = null;       // pointing to place: { h, source, hit, ghost }
let felt = {};            // tests: pulses given, by kind
let lastHitMs = 0;
let saved = null, bgHeld = null;
let canvasHome = null;    // where the canvas sat in the page (an emulator may move it)
// Objects whose frustum culling is off for the session (see xrFrame).
const unculled = new Set();
const hands = [];         // per input index: { ray, grip, line, dot, src, hover }
let grab = null;          // { h, how, q0, settle }
// A grab's level is taken this many frames after the press: closing a pinch
// moves a tracked hand's palm (its grip pose), and that is not a lean.
const GRAB_SETTLE_FRAMES = 2;
let reading = ZERO;
let frameBound = false;
const raycaster = new THREE.Raycaster();
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();

// A phone's browser can do 'immersive-ar' too (Chrome on Android): the board
// would be held up on the screen, with no controllers or hands to grab it.
// Headsets only, then: a phone says "Mobile" (or is an iPhone or iPad); the
// Quest's browser says "VR" -- "Mobile VR" in its mobile mode (Meta's
// browser specs), so VR wins.
function handheld() {
    try {
        const ua = navigator.userAgent || '';
        if (/OculusBrowser|\bVR\b/.test(ua)) return false;
        if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
        return /Mobile|iPhone|iPad/.test(ua);
    } catch (_) { return false; }
}

// Can this device and build go into mixed reality? Asked once.
export function xrAvailable() {
    if (!supportP) supportP = (async () => {
        if (!features.xr || handheld()) return false;
        try { return !!(typeof navigator !== 'undefined' && navigator.xr && await navigator.xr.isSessionSupported(MODE)); }
        catch (_) { return false; }
    })();
    return supportP;
}
export function xrPresenting() { return !!session; }
// The hand's lean while a session runs ({ beta, gamma }, level while nothing
// is held), or null with no session -- then the phone, keys and drag steer.
export function xrReading() { return session ? (grab ? reading : ZERO) : null; }

function el(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }
function shown(e) { return !!e && !e.hidden && e.getClientRects().length > 0; }
// A button's words, without its key hint or icons.
function labelOf(e) {
    let t = '';
    e.childNodes.forEach(n => {
        if (n.nodeType === 3) t += n.textContent;
        else if (n.nodeType === 1 && !n.classList.contains('key-hint') && n.getAttribute('aria-hidden') !== 'true') t += n.textContent;
    });
    return t.replace(/\s+/g, ' ').trim().toUpperCase();
}
const text = id => { const e = el(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };

// What the page is showing, as the panel's model.
function readPage() {
    const phase = host ? host.phase() : 'menu';
    const hover = hands.map(h => h.hover).find(Boolean) || null;
    const story = el('storyPanel');
    if (shown(story)) {
        const lines = Array.from(story.querySelectorAll('#storyLines p')).map(p => p.textContent.trim()).filter(Boolean);
        const buttons = [{ id: 'storyGoBtn', label: labelOf(el('storyGoBtn')) || 'GO', primary: true }, { id: 'storyCloseBtn', label: 'CLOSE', primary: false }];
        return { title: text('storyTitle'), coins: '', clock: '', lines, buttons, hover, strip: false };
    }
    if (placing) {
        return { title: text('mazeLevelName'), coins: '', clock: '', lines: [XR_PLACE_HINT], buttons: [{ id: 'xr:cancel', label: 'CANCEL', primary: false }], hover, strip: false };
    }
    const lines = [text('mazeStatus'), shown(el('mazeNearMiss')) ? text('mazeNearText') : '', text('mazeStatus2')].filter(Boolean);
    if (phase === 'ready') lines.push(XR_HINT);
    const buttons = MIRROR.filter(([id]) => shown(el(id))).map(([id, primary]) => ({ id, label: labelOf(el(id)), primary }));
    if (phase === 'ready' || phase === 'won' || phase === 'offer') {
        buttons.push({ id: 'xr:place', label: 'PLACE BOARD', primary: false }, { id: 'xr:exit', label: 'EXIT VR', primary: false });
    }
    const medal = el('mazeMedal');
    return {
        title: text('mazeLevelName'),
        coins: text('mazeCoins'),
        clock: shown(medal) ? (text('mazeMedalTime') + ' ' + text('mazeMedalPar')).trim() : '',
        lines, buttons, hover,
        strip: !buttons.length
    };
}

function fire(id, h) {
    if (id === 'xr:exit') { exitXR(); return; }
    if (id === 'xr:place') { startPlacing(h); return; }
    if (id === 'xr:cancel') { endPlacing(); return; }
    const b = el(id);
    if (b) b.click();
}

// --- where the board goes --------------------------------------------------
function headNow() { const c = getCamera(); return { pos: c.position.clone(), quat: c.quaternion.clone() }; }
function hitTestOn() {
    const s = session;
    return !!(s && typeof s.requestHitTestSource === 'function' && (!s.enabledFeatures || s.enabledFeatures.includes('hit-test')));
}
// In front of the eyes again (the head-height rule), then look for the table
// under that spot.
function placeFromHead() {
    head = headNow();
    spot = null; tableY = null; placeVer++;
    lookForTable();
}
function lookForTable() {
    if (drop) { try { drop.source.cancel(); } catch (_) { /* gone */ } drop = null; }
    const lv = host && host.level();
    if (!hitTestOn() || !head || !lv || typeof XRRay !== 'function') return;
    const plan = placeBoard(head.pos, head.quat, lv.size.d * boardScale(lv.size));
    const ref = getRenderer().xr.getReferenceSpace();
    const mine = drop = { source: null, frames: 0 };
    session.requestHitTestSource({ space: ref, offsetRay: new XRRay({ x: plan.x, y: head.pos.y, z: plan.z, w: 1 }, { x: 0, y: -1, z: 0, w: 0 }) })
        .then(src => { if (drop === mine && session) mine.source = src; else try { src.cancel(); } catch (_) { /* gone */ } })
        .catch(() => { if (drop === mine) drop = null; });
}
function startPlacing(h) {
    if (!h || !h.src || !hitTestOn()) { placeFromHead(); return; }
    endPlacing();
    const lv = host && host.level();
    const s = lv ? boardScale(lv.size) : 0.033;
    const w = lv ? lv.size.w * s : 0.3, d = lv ? lv.size.d * s : 0.46;
    // The board's outline in the room (metres: a child of the rig), with a
    // faint fill so it reads on a busy real table.
    const ghost = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => new THREE.Vector3(x, 0, z))),
        new THREE.LineBasicMaterial({ color: 0x4fd8ff }));
    ghost.add(new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })));
    ghost.visible = false;
    rig.add(ghost);
    const mine = placing = { h, source: null, hit: null, ghost };
    session.requestHitTestSource({ space: h.src.targetRaySpace })
        .then(src => { if (placing === mine && session) mine.source = src; else try { src.cancel(); } catch (_) { /* gone */ } })
        .catch(() => { if (placing === mine) { endPlacing(); placeFromHead(); } });
}
function endPlacing() {
    if (!placing) return;
    if (placing.source) { try { placing.source.cancel(); } catch (_) { /* gone */ } }
    if (rig) rig.remove(placing.ghost);
    placing.ghost.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    placing = null;
}
// The pointing hand pulled its trigger: on the surface it points at, or --
// pointing at nothing the headset knows -- in front of the eyes as before.
function commitPlacing() {
    const hit = placing && placing.hit;
    endPlacing();
    if (!hit) { placeFromHead(); return; }
    head = headNow();
    spot = placeOnSurface(hit, head.pos);
    placeVer++;
}
function firstHit(frame, source) {
    if (!frame || !source) return null;
    let res = [];
    try { res = frame.getHitTestResults(source); } catch (_) { return null; }
    return res;
}

// --- what the hands feel ---------------------------------------------------
// A pulse on the hand holding the board, or both when neither is: called
// with the game's own hits and moments (mazeGame.js). Silent without a session.
export function xrFeel(kind, v) {
    if (!session) return;
    const p = pulseFor(kind, v);
    if (!p) return;
    if (kind === 'hit') {
        const now = performance.now();
        if (now - lastHitMs < HIT_GAP_MS) return;
        lastHitMs = now;
    }
    const who = grab ? [grab.h] : hands;
    for (const h of who) {
        const gp = h && h.src && !h.src.hand && h.src.gamepad;
        if (!gp) continue;
        const act = (gp.hapticActuators && gp.hapticActuators[0]) || gp.vibrationActuator;
        try {
            if (act && typeof act.pulse === 'function') act.pulse(p.intensity, p.ms);
            else if (act && typeof act.playEffect === 'function') act.playEffect('dual-rumble', { duration: p.ms, strongMagnitude: p.intensity, weakMagnitude: p.intensity });
            else continue;
            felt[kind] = (felt[kind] || 0) + 1;
        } catch (_) { /* a failed buzz is silent */ }
    }
}

function handQuat(h, out) {
    const o = h.grip.visible ? h.grip : h.ray;
    o.updateWorldMatrix(true, false);
    o.matrixWorld.decompose(_p, out, _s);
    return out;
}
function rayHit(h) {
    if (!panel || !h.src) return null;
    h.ray.updateWorldMatrix(true, false);
    raycaster.setFromXRController(h.ray);
    const hit = raycaster.intersectObject(panel.mesh, false)[0];
    return hit || null;
}
function press(h, how) {
    if (!session) return;
    if (how === 'select') {
        const hit = rayHit(h);
        const id = hit ? panel.buttonAt(hit.uv) : null;
        if (id) { fire(id, h); return; }
        if (hit) return;             // the panel's glass, not the board
        if (placing && placing.h === h) { commitPlacing(); return; }
    }
    grab = { h, how, q0: null, settle: GRAB_SETTLE_FRAMES };
    reading = ZERO;
}
function release(h, how) { if (grab && grab.h === h && grab.how === how) { grab = null; reading = ZERO; } }

function setUpHands(renderer) {
    for (let i = 0; i < 2; i++) {
        let h = hands[i];
        if (!h) {
            const ray = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
                new THREE.LineBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.85 }));
            line.scale.z = RAY_IDLE_M;
            line.visible = false;
            ray.add(line);
            const dot = new THREE.Mesh(new THREE.SphereGeometry(DOT_R, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
            dot.visible = false;
            h = { i, ray, grip, line, dot, src: null, hover: null };
            ray.addEventListener('connected', e => { h.src = e.data || null; });
            ray.addEventListener('disconnected', () => { h.src = null; h.hover = null; if (grab && grab.h === h) { grab = null; reading = ZERO; } if (placing && placing.h === h) endPlacing(); });
            ray.addEventListener('selectstart', () => press(h, 'select'));
            ray.addEventListener('selectend', () => release(h, 'select'));
            ray.addEventListener('squeezestart', () => press(h, 'squeeze'));
            ray.addEventListener('squeezeend', () => release(h, 'squeeze'));
            hands[i] = h;
        }
        rig.add(h.ray); rig.add(h.grip); getScene().add(h.dot);
    }
}

// Put the level on the table: where it was pointed to, else from the head
// pose captured once the headset has one, on the real table when one was
// found under it; at this level's scale, the near edge kept put.
function placeNow(lv) {
    const s = boardScale(lv.size);
    let pl = spot;
    if (!pl) {
        const hp = head ? head.pos : new THREE.Vector3(0, 1.3, 0);
        const hq = head ? head.quat : new THREE.Quaternion();
        pl = placeBoard(hp, hq, lv.size.d * s);
        if (tableY !== null) pl = { ...pl, y: tableY + XR_TABLE_LIFT_M };
    }
    lastPlace = pl;
    rig.matrix.copy(rigMatrix(pl, s));
    rig.matrixWorldNeedsUpdate = true;
    if (panel) panel.setLevel(lv);
}

function xrFrame() {
    if (!session || !rig) return;
    const scene = getScene(), camera = getCamera();
    // Passthrough: no sky colour behind the board (a new level sets one).
    if (scene.background) { bgHeld = scene.background; scene.background = null; }
    if (!host || host.phase() === 'menu') { exitXR(); return; }
    const lv = host.level();
    if (placeFrames < PLACE_AFTER_FRAMES && ++placeFrames === PLACE_AFTER_FRAMES && !head) placeFromHead();
    // The dropped ray: the table under the planned spot, once seen.
    const frame = getRenderer().xr.getFrame ? getRenderer().xr.getFrame() : null;
    const ref = getRenderer().xr.getReferenceSpace();
    if (drop && drop.source) {
        const res = firstHit(frame, drop.source);
        if (res) {
            drop.frames++;
            const ys = res.map(r => { const p = r.getPose(ref); return p ? p.transform.position.y : NaN; });
            const y = tableHeight(ys, head ? head.pos.y : 1.6);
            if (y !== null || drop.frames >= TABLE_LOOK_FRAMES) {
                if (y !== null) { tableY = y; placeVer++; }
                try { drop.source.cancel(); } catch (_) { /* gone */ }
                drop = null;
            }
        }
    }
    if (lv) {
        const key = lv.id + '|' + placeVer;
        if (key !== placedKey) { placedKey = key; placeNow(lv); }
    }
    rig.updateMatrixWorld(true);
    // Pointing to place: the board's outline where the ray meets the room.
    if (placing) {
        const res = placing.source ? firstHit(frame, placing.source) : null;
        const pose = res && res[0] ? res[0].getPose(ref) : null;
        placing.hit = pose ? { x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z } : null;
        placing.ghost.visible = !!placing.hit;
        if (placing.hit) {
            const at = placeOnSurface(placing.hit, camera.position);
            placing.ghost.position.set(at.x, at.y, at.z);
            placing.ghost.rotation.set(0, at.yaw, 0);
        }
    }

    // NO FRUSTUM CULLING IN THE HEADSET. three.js culls against one camera
    // spanning both eyes, set back behind them by an offset it measures in
    // WORLD units and given a near plane in METRES: with the player scaled
    // thirty times, that near plane lands past the table and the whole board
    // is culled though each eye would draw it. The board is table-sized and
    // all in view anyway, so drawing everything costs next to nothing.
    scene.traverse(o => { if (o.frustumCulled) { o.frustumCulled = false; unculled.add(o); } });

    // The hands: the lean of the one holding on, and where each ray points.
    if (grab && grab.q0) reading = grabTilt(grab.q0, handQuat(grab.h, _q));
    else if (grab && --grab.settle <= 0) { grab.q0 = handQuat(grab.h, new THREE.Quaternion()); reading = ZERO; }
    const s = lv ? boardScale(lv.size) : 1;
    for (const h of hands) {
        if (!h) continue;
        const hit = rayHit(h);
        h.hover = hit ? panel.buttonAt(hit.uv) : null;
        h.line.visible = !!h.src && !(grab && grab.h === h);
        // Pointing to place, the ray reaches the surface it has found.
        const onSurface = !hit && placing && placing.h === h && placing.hit;
        h.line.scale.z = hit ? hit.distance * s
            : onSurface ? Math.max(RAY_IDLE_M, h.ray.getWorldPosition(_p).applyMatrix4(_m.copy(rig.matrix).invert()).distanceTo(_v.set(placing.hit.x, placing.hit.y, placing.hit.z)))
            : RAY_IDLE_M;
        h.dot.visible = !!hit && h.line.visible;
        if (hit) h.dot.position.copy(hit.point);
    }
    if (panel) panel.update(readPage());
}

// Into the headset: from a tap (ENTER VR), never on its own. Resolves true
// once the session runs.
export async function enterXR(h) {
    if (session || starting) return false;
    if (!(await xrAvailable())) return false;
    host = h || host;
    starting = true;
    let s;
    try {
        s = await navigator.xr.requestSession(MODE, { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking', 'hit-test'] });
    } catch (e) {
        starting = false;
        console.warn('[xr] no session:', e && e.message);
        return false;
    }
    const renderer = getRenderer(), scene = getScene(), camera = getCamera();
    if (!frameBound) { frameBound = true; onFrame(xrFrame); }
    saved = { fov: camera.fov, near: camera.near, far: camera.far };
    const cv = renderer.domElement;
    canvasHome = cv.parentNode ? { parent: cv.parentNode, next: cv.nextSibling } : null;
    bgHeld = scene.background;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    if (typeof renderer.xr.setFoveation === 'function') renderer.xr.setFoveation(1);
    rig = new THREE.Group();
    rig.name = 'xrRig';
    rig.matrixAutoUpdate = false;
    scene.add(rig);
    rig.add(camera);
    setUpHands(renderer);
    panel = createXrPanel();
    scene.add(panel.mesh);
    head = null; placeFrames = 0; placedKey = ''; placeVer = 0;
    tableY = null; spot = null; lastPlace = null; drop = null; placing = null; felt = {};
    grab = null; reading = ZERO;
    session = s;
    starting = false;
    s.addEventListener('end', onEnd, { once: true });
    try {
        await renderer.xr.setSession(s);
    } catch (e) {
        console.warn('[xr] session would not start:', e && e.message);
        try { await s.end(); } catch (_) { /* already over */ }
        return false;
    }
    if (host && host.level()) placeNow(host.level());
    if (host && host.onChange) host.onChange(true);
    requestRender();
    return true;
}

export function exitXR() {
    if (!session) return;
    try { session.end().catch(() => onEnd()); } catch (_) { onEnd(); }
}

function onEnd() {
    if (!rig) { session = null; return; }
    const renderer = getRenderer(), scene = getScene(), camera = getCamera();
    endPlacing();
    if (drop && drop.source) { try { drop.source.cancel(); } catch (_) { /* gone */ } }
    drop = null;
    session = null; grab = null; reading = ZERO;
    for (const h of hands) {
        if (!h) continue;
        rig.remove(h.ray); rig.remove(h.grip); scene.remove(h.dot);
        h.hover = null; h.line.visible = false;
    }
    for (const o of unculled) o.frustumCulled = true;
    unculled.clear();
    rig.remove(camera);
    scene.remove(rig);
    rig = null;
    if (panel) { scene.remove(panel.mesh); panel.dispose(); panel = null; }
    // The flat camera back as it was: three.js left the headset's lens on it.
    camera.scale.set(1, 1, 1);
    camera.quaternion.identity();
    if (saved) { camera.fov = saved.fov; camera.near = saved.near; camera.far = saved.far; }
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (!scene.background && bgHeld) scene.background = bgHeld;
    renderer.xr.enabled = false;
    // Back where it was under the menus and the HUD: an emulator (Meta's
    // IWER) hands the canvas back at the END of the page, over everything.
    const cv = renderer.domElement;
    if (canvasHome && (cv.parentNode !== canvasHome.parent || cv.nextSibling !== canvasHome.next)) {
        try { canvasHome.parent.insertBefore(cv, canvasHome.next && canvasHome.next.parentNode === canvasHome.parent ? canvasHome.next : canvasHome.parent.firstChild); } catch (_) { /* leave it */ }
    }
    canvasHome = null;
    if (host && host.onChange) host.onChange(false);
    requestRender();
}

// Tests: the session, the board's place and the panel's model.
export function xrDebug() {
    return {
        presenting: !!session,
        grabbing: !!grab,
        place: lastPlace ? { ...lastPlace } : null,
        table: tableY,
        pointed: !!spot,
        placing: placing ? { hit: placing.hit ? { ...placing.hit } : null, ghost: placing.ghost.visible } : null,
        felt: { ...felt },
        reading: { ...xrReading() || ZERO },
        rig: rig ? rig.matrix.toArray() : null,
        camera: (() => { const c = getCamera(); c.updateMatrixWorld(true); return c.getWorldPosition(new THREE.Vector3()).toArray(); })(),
        panel: panel ? { model: readPage(), boxes: panel.boxes(), world: panel.mesh.getWorldPosition(new THREE.Vector3()).toArray() } : null,
        hands: hands.filter(Boolean).map(h => ({ connected: !!h.src, hand: !!(h.src && h.src.hand), hover: h.hover })),
        // Where a panel button is in the ROOM (metres), or a level point is.
        aim: (id) => {
            if (!panel || !rig) return null;
            const p = panel.pointOf(id);
            return p ? p.applyMatrix4(rig.matrix.clone().invert()).toArray() : null;
        },
        ndc: (x, y, z) => { const c = getCamera(); c.updateMatrixWorld(true); return new THREE.Vector3(x, y, z).project(c).toArray(); },
        room: (x, y, z) => (rig ? new THREE.Vector3(x, y, z).applyMatrix4(rig.matrix.clone().invert()).toArray() : null)
    };
}
