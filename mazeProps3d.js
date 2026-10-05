import * as THREE from 'three';
import { conveyorDir } from './mazeHazards.js';
import { COIN_RADIUS, PICKUP_RADIUS } from './mazePickups.js';

// LEVEL PROPS -- conveyor belts, coins and power-up pickups as meshes. Shared
// by mazeGame.js and scripts/themePreview.html, so the preview shows what the
// game draws (the same reason mazeTheme3d.js exists).
//
// Everything here is DRAWING. What a belt does to the ball is mazeHazards.js;
// when a coin counts as taken is mazePickups.js. A prop is drawn at the reach
// those modules use, so what the player sees touch is what counts.
//
// Imports `three` only (plus the two pure modules), never the game scene.

// Heights above the floor, in the same stack mazeGame.js uses: belts under
// ice (0.006) under holes (0.012) under the goal ring (0.015).
const BELT_Y = 0.004;

// One chevron tile, drawn once and shared by every belt: arrows pointing +v.
let _chevron = null;
function chevronImage() {
    if (_chevron) return _chevron;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2622';
    g.fillRect(0, 0, 64, 64);
    // Rubber ribs, so a belt reads as a belt even where its arrows are faint.
    g.fillStyle = '#211d1a';
    for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 64, 3);
    g.strokeStyle = '#f0b23a';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    // A '^' on the canvas: canvas y runs down and the texture is flipped on
    // upload, so canvas-up is +v.
    g.moveTo(14, 44); g.lineTo(32, 26); g.lineTo(50, 44);
    g.stroke();
    _chevron = c;
    return c;
}

// Belts. Each gets its own material because each needs its own repeat (one
// arrow per corridor width along its length); a level carries two or three, so
// that is two or three draw calls. tick(seconds) scrolls every belt at its
// authored speed, so the arrows move as fast as the belt pushes.
export function buildConveyors(belts, tracked = []) {
    const group = new THREE.Group();
    const scrolling = [];
    for (const b of belts || []) {
        const d = conveyorDir(b);
        if (!d) continue;
        const alongX = d[0] !== 0;
        const across = alongX ? b.d : b.w, length = alongX ? b.w : b.d;
        const tex = new THREE.CanvasTexture(chevronImage());
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        const tiles = Math.max(1, length / across);
        tex.repeat.set(1, tiles);
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.0 });
        // Plane's +v is its local +y; lying it flat points +v at -z. Rotate
        // about y so +v points along the belt's direction.
        const geo = new THREE.PlaneGeometry(across, length).rotateX(-Math.PI / 2);
        const yaw = Math.atan2(-d[0], -d[1]);
        geo.rotateY(yaw);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(b.x, BELT_Y, b.z);
        mesh.receiveShadow = true;
        group.add(mesh);
        tracked.push(geo, mat, tex);
        scrolling.push({ tex, perSecond: (Number(b.speed) || 0) / across });
    }
    return {
        group,
        tick(seconds) { for (const s of scrolling) s.tex.offset.y = -(seconds * s.perSecond) % 1; }
    };
}

// Coins: every coin of a level in one InstancedMesh, spinning on the spot. A
// taken coin is scaled to nothing rather than removed, so the instance count
// never changes mid-run; reset() brings them all back for the next attempt.
export function buildCoins(coins, tracked = []) {
    const list = coins || [];
    const geo = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_RADIUS * 0.28, 24).rotateX(Math.PI / 2);
    // Gold that reads without an environment map, the same trap the win star
    // documents: a little emissive keeps it bright under any theme's lights.
    const mat = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.35, roughness: 0.3, emissive: 0xc88400, emissiveIntensity: 0.6 });
    tracked.push(geo, mat);
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    mesh.count = list.length;
    mesh.castShadow = true;
    const taken = new Set();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(1, 0, 0), lean = new THREE.Quaternion();
    // Leaning back toward the camera rather than standing upright: the camera
    // is nearly straight down, and an upright spinning coin is a sliver from
    // there half the time. Tipped like this it reads as a coin face, and the
    // spin about the vertical makes it wobble and catch the light.
    lean.setFromAxisAngle(side, -1.15);
    function place(seconds) {
        list.forEach((c, i) => {
            const spin = seconds * 2.4 + i * 0.7;
            q.setFromAxisAngle(up, spin).multiply(lean);
            p.set(c.x, COIN_RADIUS + 0.06 + Math.sin(seconds * 2 + i) * 0.03, c.z);
            s.setScalar(taken.has(i) ? 0.0001 : 1);
            m.compose(p, q, s);
            mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
    }
    place(0);
    return {
        group: mesh,
        tick: place,
        take(i) { taken.add(i); },
        reset() { taken.clear(); }
    };
}

// Pickups: one mesh each, a distinct shape AND colour per kind so they can be
// told apart by colour-blind players and on a small screen.
const PICKUP_LOOK = {
    shield: { color: 0x48d6ff, geo: () => new THREE.IcosahedronGeometry(PICKUP_RADIUS * 0.85, 0) },
    magnet: { color: 0xff4d5e, geo: () => new THREE.TorusGeometry(PICKUP_RADIUS * 0.6, PICKUP_RADIUS * 0.22, 10, 20, Math.PI * 1.3) },
    slowmo: { color: 0xb57bff, geo: () => new THREE.OctahedronGeometry(PICKUP_RADIUS * 0.9, 0) }
};

export function buildPickups(pickups, tracked = []) {
    const group = new THREE.Group();
    const meshes = (pickups || []).map((pk) => {
        const look = PICKUP_LOOK[pk.kind];
        if (!look) return null;
        const geo = look.geo();
        const mat = new THREE.MeshStandardMaterial({ color: look.color, emissive: look.color, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.1 });
        tracked.push(geo, mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(pk.x, PICKUP_RADIUS + 0.12, pk.z);
        mesh.castShadow = true;
        group.add(mesh);
        return mesh;
    });
    return {
        group,
        tick(seconds) {
            meshes.forEach((m, i) => {
                if (!m) return;
                m.rotation.y = seconds * 1.6 + i;
                m.rotation.x = Math.sin(seconds * 1.1 + i) * 0.4;
                m.position.y = PICKUP_RADIUS + 0.12 + Math.sin(seconds * 2.2 + i) * 0.05;
            });
        },
        take(i) { if (meshes[i]) meshes[i].visible = false; },
        reset() { meshes.forEach(m => { if (m) m.visible = true; }); }
    };
}

// All three at once, for a level. One tick, one reset.
export function buildLevelProps(lv, tracked = []) {
    const belts = buildConveyors(lv.conveyors, tracked);
    const coins = buildCoins(lv.coins, tracked);
    const pickups = buildPickups(lv.pickups, tracked);
    const group = new THREE.Group();
    group.add(belts.group, coins.group, pickups.group);
    return {
        group,
        tick(seconds) { belts.tick(seconds); coins.tick(seconds); pickups.tick(seconds); },
        takeCoin: i => coins.take(i),
        takePickup: i => pickups.take(i),
        reset() { coins.reset(); pickups.reset(); }
    };
}
