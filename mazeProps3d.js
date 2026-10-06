import * as THREE from 'three';
import { conveyorDir, windStrength, icicleState, ICICLE_IMPACT_MS, flareState, geyserState } from './mazeHazards.js';
import { applySurface } from './mazeSurface3d.js';
import { COIN_RADIUS, PICKUP_RADIUS } from './mazePickups.js';
import { buildBumpers, buildSprings, buildArms } from './toyProps3d.js';
import { buildMagnets, buildCrushers, buildRails } from './foundryProps3d.js';

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
// A MINTED COIN, drawn once and shared: the face (colour and a matching bump
// map) and the reeded edge. Canvas-made, so the flat bundle ships no images.
let _coinTex = null;
function coinTextures() {
    if (_coinTex) return _coinTex;
    const N = 128, c = N / 2;
    const face = document.createElement('canvas'), bump = document.createElement('canvas');
    face.width = face.height = bump.width = bump.height = N;
    const f = face.getContext('2d'), b = bump.getContext('2d');
    // A five-pointed star path, centred.
    const star = (g, r) => {
        g.beginPath();
        for (let k = 0; k < 10; k++) {
            const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r;
            g.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
        }
        g.closePath();
    };
    // Colour: a warm gold field, brighter raised parts, darker recesses.
    const field = f.createRadialGradient(c - 14, c - 18, 6, c, c, c);
    field.addColorStop(0, '#f4c24a'); field.addColorStop(0.7, '#d99a1c'); field.addColorStop(1, '#a86d0c');
    f.fillStyle = field; f.fillRect(0, 0, N, N);
    f.lineWidth = 9; f.strokeStyle = '#ffe07a'; f.beginPath(); f.arc(c, c, c - 5, 0, Math.PI * 2); f.stroke();       // rim
    f.lineWidth = 2; f.strokeStyle = '#b07610'; f.beginPath(); f.arc(c, c, c - 11, 0, Math.PI * 2); f.stroke();      // rim's inner edge
    f.fillStyle = '#ffe48f';
    for (let k = 0; k < 28; k++) {                                                                                     // bead ring
        const a = k / 28 * Math.PI * 2;
        f.beginPath(); f.arc(c + Math.cos(a) * (c - 18), c + Math.sin(a) * (c - 18), 2.2, 0, Math.PI * 2); f.fill();
    }
    star(f, 32); f.fillStyle = '#7a4c06'; f.save(); f.translate(2.5, 3.5); f.fill(); f.restore();                   // emboss shadow
    star(f, 32); f.fillStyle = '#fff0a8'; f.fill();
    f.lineWidth = 2; f.strokeStyle = '#8a5a08'; f.stroke();
    // Height: the same shapes in grey, raised parts light.
    b.fillStyle = '#5a5a5a'; b.fillRect(0, 0, N, N);
    b.lineWidth = 9; b.strokeStyle = '#ffffff'; b.beginPath(); b.arc(c, c, c - 5, 0, Math.PI * 2); b.stroke();
    b.fillStyle = '#d0d0d0';
    for (let k = 0; k < 28; k++) {
        const a = k / 28 * Math.PI * 2;
        b.beginPath(); b.arc(c + Math.cos(a) * (c - 18), c + Math.sin(a) * (c - 18), 2.2, 0, Math.PI * 2); b.fill();
    }
    star(b, 32); b.fillStyle = '#f0f0f0'; b.fill();
    // The edge: fine vertical ridges (reeding), repeated round the rim.
    const edge = document.createElement('canvas');
    edge.width = 64; edge.height = 8;
    const e = edge.getContext('2d');
    for (let x = 0; x < 64; x++) { const v = 150 + 90 * Math.sin(x / 64 * Math.PI * 2 * 8); e.fillStyle = `rgb(${v},${v},${v})`; e.fillRect(x, 0, 1, 8); }
    const tex = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    const edgeBump = tex(edge, false);
    edgeBump.wrapS = THREE.RepeatWrapping; edgeBump.repeat.set(3, 1);
    _coinTex = { face: tex(face, true), bump: tex(bump, false), edgeBump };
    return _coinTex;
}

export function buildCoins(coins, tracked = []) {
    const list = coins || [];
    const geo = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_RADIUS * 0.28, 32).rotateX(Math.PI / 2);
    // Gold that reads without an environment map, the same trap the win star
    // documents: a little emissive keeps it bright under any theme's lights --
    // through the face texture, so the emblem shows even in the glow. The
    // cylinder's groups are [edge, top, bottom]: a reeded edge, minted faces.
    const T = coinTextures();
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.face, bumpMap: T.bump, bumpScale: 2.2,
        metalness: 0.45, roughness: 0.32, emissive: 0xffffff, emissiveMap: T.face, emissiveIntensity: 0.45 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe8a826, bumpMap: T.edgeBump, bumpScale: 1.5,
        metalness: 0.45, roughness: 0.35, emissive: 0xa86e00, emissiveIntensity: 0.45 });
    tracked.push(geo, faceMat, edgeMat);
    const mesh = new THREE.InstancedMesh(geo, [edgeMat, faceMat, faceMat], Math.max(1, list.length));
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

// WIND FANS (world 2): a fan housing on the wall the wind blows away from,
// blades spinning with the gust, and snow streaks blowing across the zone.
// Driven by the RUN clock (tickRun), so what you see is the gust that is
// pushing you -- calm when it is calm.
export function buildFans(fans, tracked = []) {
    const group = new THREE.Group();
    const housingGeo = new THREE.CylinderGeometry(0.3, 0.34, 0.2, 24, 1, true);
    const frameGeo = new THREE.TorusGeometry(0.33, 0.045, 8, 28).rotateX(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.22, 12);
    const bladeGeo = new THREE.BoxGeometry(0.04, 0.5, 0.08);
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xff8a2b, metalness: 0.2, roughness: 0.5, emissive: 0x6a2a00, emissiveIntensity: 0.4 });
    tracked.push(frameGeo, frameMat);
    const blade = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.4, roughness: 0.4 });
    tracked.push(housingGeo, hubGeo, bladeGeo, metal, blade);
    const STREAKS = 26;
    const units = (fans || []).map((f) => {
        const d = conveyorDir(f);
        if (!d) return null;
        const alongX = d[0] !== 0;
        const len = alongX ? f.w : f.d, span = alongX ? f.d : f.w;
        // The housing sits at the upwind edge, its axis along the wind.
        const unit = new THREE.Group();
        unit.position.set(f.x - d[0] * len / 2, 0.36, f.z - d[1] * len / 2);
        unit.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
        unit.add(new THREE.Mesh(housingGeo, metal));
        unit.add(new THREE.Mesh(frameGeo, frameMat));
        const rotor = new THREE.Group();
        rotor.add(new THREE.Mesh(hubGeo, metal));
        for (let k = 0; k < 4; k++) {
            const b = new THREE.Mesh(bladeGeo, blade);
            b.rotation.y = k * Math.PI / 2;
            b.position.set(Math.cos(k * Math.PI / 2) * 0.14, 0, Math.sin(k * Math.PI / 2) * 0.14);
            rotor.add(b);
        }
        unit.add(rotor);
        group.add(unit);
        // Snow streaks: points that ride the wind across the zone and wrap.
        const pos = new Float32Array(STREAKS * 3);
        const seeds = [];
        for (let i = 0; i < STREAKS; i++) seeds.push({ u: Math.random(), v: Math.random() - 0.5, y: 0.08 + Math.random() * 0.4 });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0, depthWrite: false });
        tracked.push(geo, mat);
        group.add(new THREE.Points(geo, mat));
        return { f, d, alongX, len, span, rotor, seeds, pos, geo, mat, spin: 0, lastMs: null };
    }).filter(Boolean);
    return {
        group,
        tickRun(runMs) {
            for (const u of units) {
                const s = windStrength(u.f, runMs);
                const dt = u.lastMs === null ? 0 : Math.max(0, Math.min(100, runMs - u.lastMs)) / 1000;
                u.lastMs = runMs;
                u.spin += dt * (2 + 26 * s);
                u.rotor.rotation.y = u.spin;
                u.mat.opacity = 0.85 * s;
                u.seeds.forEach((sd, i) => {
                    sd.u = (sd.u + dt * (0.4 + 2.6 * s) / u.len) % 1;
                    const a = (sd.u - 0.5) * u.len, b = sd.v * u.span * 0.9;
                    u.pos[i * 3] = u.f.x + (u.alongX ? a * u.d[0] : b);
                    u.pos[i * 3 + 1] = sd.y;
                    u.pos[i * 3 + 2] = u.f.z + (u.alongX ? b : a * u.d[1]);
                });
                u.geo.attributes.position.needsUpdate = true;
            }
        },
        reset() { for (const u of units) u.lastMs = null; }
    };
}

// ICICLES (world 2): a cluster of ice spikes hanging high over their spot,
// regrowing, shaking while their shadow darkens on the floor (the telegraph),
// falling to strike just as the impact window opens, then bursting into
// shards. Driven by the run clock, so the fall you see is the fall that hits.
const ICICLE_HANG_Y = 2.4;
const FALL_MS = 260;
export function buildIcicles(icicles, tracked = []) {
    const group = new THREE.Group();
    const coneGeo = new THREE.ConeGeometry(0.12, 0.75, 8).rotateX(Math.PI);   // point down
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xbfe7ff, transparent: true, opacity: 0.55, depthWrite: false });
    tracked.push(ringGeo, ringMat);
    const shardGeo = new THREE.TetrahedronGeometry(0.05);
    const shadowGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
    const ice = new THREE.MeshStandardMaterial({ color: 0xd9f1ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.92, emissive: 0x3a6c8c, emissiveIntensity: 0.25 });
    tracked.push(coneGeo, shardGeo, shadowGeo, ice);
    const units = (icicles || []).map((ic, n) => {
        const spikes = new THREE.Group();
        const k = 4 + (n % 2);
        for (let i = 0; i < k; i++) {
            const m = new THREE.Mesh(coneGeo, ice);
            const a = i / k * Math.PI * 2 + n;
            const rr = i === 0 ? 0 : ic.r * 0.35;
            m.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
            m.scale.set(1, 0.7 + ((i * 37 + n * 11) % 10) / 20, 1);
            m.castShadow = false;
            spikes.add(m);
        }
        spikes.position.set(ic.x, ICICLE_HANG_Y, ic.z);
        group.add(spikes);
        // The telegraph: the spot lights up FROSTY BLUE as the fall nears --
        // never dark. A darkening disc read as a hole, and a player must never
        // mistake one hazard for another.
        const shMat = new THREE.MeshBasicMaterial({ color: 0x6fc3ff, transparent: true, opacity: 0, depthWrite: false });
        const shadow = new THREE.Mesh(shadowGeo, shMat);
        shadow.position.set(ic.x, 0.011, ic.z);
        shadow.scale.setScalar(ic.r);
        group.add(shadow);
        // The danger spot, marked always: a frosty ring where it lands. A
        // trap the player can only learn by being hit is not a fair one.
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(ic.x, 0.012, ic.z);
        ring.scale.setScalar(ic.r);
        group.add(ring);
        const shards = [];
        for (let i = 0; i < 10; i++) {
            const m = new THREE.Mesh(shardGeo, ice);
            m.visible = false;
            group.add(m);
            const a = i / 10 * Math.PI * 2;
            shards.push({ m, vx: Math.cos(a) * (0.6 + (i % 3) * 0.3), vz: Math.sin(a) * (0.6 + (i % 3) * 0.3), vy: 0.8 + (i % 4) * 0.25 });
        }
        tracked.push(shMat);
        return { ic, spikes, shadow, shMat, shards };
    });
    return {
        group,
        tickRun(runMs) {
            for (const u of units) {
                const st = icicleState(u.ic, runMs);
                // Where the next impact is in time, to start the visible fall
                // FALL_MS before the impact window opens.
                const ahead = icicleState(u.ic, runMs + FALL_MS);
                const falling = st.state === 'shake' && ahead.state === 'impact';
                let y = ICICLE_HANG_Y, scaleY = 1, jx = 0, jz = 0, show = true;
                if (st.state === 'grow') scaleY = Math.max(0.05, st.k);
                else if (st.state === 'shake') {
                    const amp = 0.025 * st.k;
                    jx = Math.sin(runMs * 0.09) * amp; jz = Math.cos(runMs * 0.11) * amp;
                }
                if (falling) {
                    // Time left until the impact window opens, as 0..1 of the fall.
                    const untilImpact = FALL_MS - ahead.k * ICICLE_IMPACT_MS;
                    const fall = Math.max(0, Math.min(1, 1 - untilImpact / FALL_MS));
                    y = ICICLE_HANG_Y + (0.25 - ICICLE_HANG_Y) * fall * fall;   // accelerating drop
                }
                if (st.state === 'impact') show = false;
                u.spikes.visible = show;
                u.spikes.position.set(u.ic.x + jx, y, u.ic.z + jz);
                u.spikes.scale.set(1, scaleY, 1);
                // Faint while it hangs; through the shake it brightens and
                // pulses faster and faster; it flashes on impact.
                u.shMat.opacity = st.state === 'shake'
                    ? 0.2 + 0.35 * st.k + 0.15 * Math.sin(runMs * (0.012 + 0.03 * st.k))
                    : st.state === 'impact' ? 0.7 * (1 - st.k) : st.state === 'hang' ? 0.1 : 0.04;
                // Shards fly out during the impact window.
                const t = st.state === 'impact' ? st.k * ICICLE_IMPACT_MS / 1000 * 2.2 : -1;
                for (const sh of u.shards) {
                    sh.m.visible = t >= 0;
                    if (t >= 0) sh.m.position.set(u.ic.x + sh.vx * t * 0.5, Math.max(0.03, 0.1 + sh.vy * t - 4 * t * t), u.ic.z + sh.vz * t * 0.5);
                }
            }
        }
    };
}

// A soft vertical flame/steam texture, shared: bright at the base, gone at
// the top, feathered at the sides.
let _plume = null;
function plumeTexture() {
    if (_plume) return _plume;
    const c = document.createElement('canvas');
    c.width = 32; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, 'rgba(255,240,180,1)');
    grad.addColorStop(0.25, 'rgba(255,150,40,0.9)');
    grad.addColorStop(0.7, 'rgba(220,60,10,0.35)');
    grad.addColorStop(1, 'rgba(120,20,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 64);
    const side = g.createLinearGradient(0, 0, 32, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.3, 'rgba(0,0,0,0)');
    side.addColorStop(0.7, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = side;
    g.fillRect(0, 0, 32, 64);
    _plume = new THREE.CanvasTexture(c);
    _plume.colorSpace = THREE.SRGBColorSpace;
    return _plume;
}

// FLARING SEAMS (world 3): a crusted fissure across the corridor whose veins
// glow dull, brighten and flicker through the warning, then blaze with a
// curtain of flame for the flare. Run clock, like every timed trap.
export function buildFlares(flares, tracked = []) {
    const group = new THREE.Group();
    const flameMat = new THREE.MeshBasicMaterial({ map: plumeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const lipMat = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 1 });
    tracked.push(flameMat, lipMat);
    const units = (flares || []).map((f) => {
        const geo = new THREE.PlaneGeometry(f.w, f.d).rotateX(-Math.PI / 2).translate(f.x, 0.008, f.z);
        const mat = applySurface(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), {
            pattern: 'fissure', glowColor: '#ff5a14', glow: 0.4, bump: 2, grit: 0
        });
        tracked.push(geo, mat);
        const band = new THREE.Mesh(geo, mat);
        band.receiveShadow = true;
        group.add(band);
        // A crusted lip round the band, so it reads as a fissure in the floor
        // and not a sticker on it. Low (0.018): far under the marble's reach.
        const lip = 0.05, lipH = 0.018;
        for (const [w, d, x, z] of [[f.w + lip * 2, lip, f.x, f.z - f.d / 2 - lip / 2], [f.w + lip * 2, lip, f.x, f.z + f.d / 2 + lip / 2],
                                     [lip, f.d, f.x - f.w / 2 - lip / 2, f.z], [lip, f.d, f.x + f.w / 2 + lip / 2, f.z]]) {
            const g = new THREE.BoxGeometry(w, lipH, d).translate(x, lipH / 2, z);
            tracked.push(g);
            group.add(new THREE.Mesh(g, lipMat));
        }
        // The flame curtain: crossed planes along the band's long axis.
        const alongX = f.w >= f.d, len = Math.max(f.w, f.d);
        const curtain = new THREE.Group();
        curtain.position.set(f.x, 0, f.z);
        const n = Math.max(2, Math.round(len / 0.3));
        for (let i = 0; i < n; i++) {
            const t = ((i + 0.5) / n - 0.5) * len;
            for (const rot of [0, Math.PI / 2]) {
                const q = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 1).translate(0, 0.5, 0), flameMat);
                tracked.push(q.geometry);
                q.position.set(alongX ? t : 0, 0, alongX ? 0 : t);
                q.rotation.y = rot + (alongX ? 0 : Math.PI / 2);
                curtain.add(q);
            }
        }
        curtain.scale.y = 0.001;
        group.add(curtain);
        return { f, glow: mat.userData.surfaceUniforms.mrGlow, curtain };
    });
    return {
        group,
        tickRun(runMs) {
            for (const u of units) {
                const st = flareState(u.f, runMs);
                let glow = 0.22, h = 0.001;
                if (st.state === 'warn') glow = 0.5 + 1.9 * st.k + 0.4 * Math.sin(runMs * (0.015 + 0.03 * st.k));
                // Flames shoot up over the first 15% of the flare, die over the last 15%.
                if (st.state === 'flare') { glow = 3.2; h = 0.75 * Math.min(1, st.k / 0.15) * Math.min(1, (1 - st.k) / 0.15); }
                u.glow.value = glow;
                u.curtain.scale.y = Math.max(0.001, h);
                u.curtain.children.forEach((c, i) => { c.scale.x = 0.8 + 0.3 * Math.sin(runMs * 0.02 + i); });
            }
        }
    };
}

// GEYSERS (world 3): a rocky vent with a glowing throat that bubbles and
// brightens through the warning, then a plume blasts up for the blast while
// spray flies outward. Run clock.
export function buildGeysers(geysers, tracked = []) {
    const group = new THREE.Group();
    const rimGeo = new THREE.TorusGeometry(1, 0.32, 10, 28).rotateX(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.95 });
    const throatGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
    const bubbleGeo = new THREE.SphereGeometry(0.05, 10, 8);
    const plumeGeo = new THREE.CylinderGeometry(0.22, 0.42, 1, 18, 1, true).translate(0, 0.5, 0);
    const plumeMat = new THREE.MeshBasicMaterial({ map: plumeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const reachGeo = new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2);
    tracked.push(rimGeo, rimMat, throatGeo, bubbleGeo, plumeGeo, plumeMat, reachGeo);
    const units = (geysers || []).map((gy) => {
        const vent = new THREE.Group();
        vent.position.set(gy.x, 0, gy.z);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.scale.set(gy.r, gy.r * 0.6, gy.r);
        rim.position.y = 0.02;
        rim.castShadow = true;
        vent.add(rim);
        const throatMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a });
        const throat = new THREE.Mesh(throatGeo, throatMat);
        throat.scale.setScalar(gy.r * 0.8);
        throat.position.y = 0.012;
        vent.add(throat);
        // How far a blast reaches, marked faintly on the ground always.
        const reachMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.25, depthWrite: false });
        const reachRing = new THREE.Mesh(reachGeo, reachMat);
        reachRing.scale.setScalar(gy.reach);
        reachRing.position.y = 0.011;
        vent.add(reachRing);
        const bubbles = [];
        for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(bubbleGeo, throatMat); vent.add(b); bubbles.push(b); }
        const plume = new THREE.Mesh(plumeGeo, plumeMat);
        plume.scale.set(1, 0.001, 1);
        vent.add(plume);
        tracked.push(throatMat, reachMat);
        group.add(vent);
        return { gy, throatMat, reachMat, bubbles, plume };
    });
    return {
        group,
        tickRun(runMs) {
            for (const u of units) {
                const st = geyserState(u.gy, runMs);
                const heat = st.state === 'blast' ? 1 : st.state === 'warn' ? 0.35 + 0.65 * st.k : 0.2;
                u.throatMat.color.setRGB(0.5 + 0.5 * heat, 0.15 + 0.45 * heat, 0.05 + 0.2 * heat);
                u.reachMat.opacity = st.state === 'warn' ? 0.25 + 0.35 * st.k : st.state === 'blast' ? 0.7 : 0.18;
                u.bubbles.forEach((b, i) => {
                    const live = st.state !== 'quiet' || i < 2;
                    b.visible = live;
                    const a = i * 1.7 + runMs * 0.002;
                    const bob = ((runMs * (0.002 + 0.004 * heat) + i * 0.37) % 1);
                    b.position.set(Math.cos(a) * u.gy.r * 0.45, 0.02 + bob * 0.18 * (0.3 + heat), Math.sin(a) * u.gy.r * 0.45);
                    b.scale.setScalar(0.6 + heat);
                });
                const h = st.state === 'blast' ? 1.6 * Math.sin(Math.min(1, st.k * 2.5) * Math.PI * 0.5) * (st.k > 0.7 ? (1 - st.k) / 0.3 : 1) : 0.001;
                u.plume.scale.set(1 + 0.6 * (st.state === 'blast' ? st.k : 0), Math.max(0.001, h), 1 + 0.6 * (st.state === 'blast' ? st.k : 0));
            }
        }
    };
}

// All of them at once, for a level. tick(seconds) runs on the page clock
// (coins spin, belts scroll); tickRun(runMs) on the run clock (fans, icicles).
export function buildLevelProps(lv, tracked = []) {
    const belts = buildConveyors(lv.conveyors, tracked);
    const coins = buildCoins(lv.coins, tracked);
    const pickups = buildPickups(lv.pickups, tracked);
    const fans = buildFans(lv.fans, tracked);
    const icicles = buildIcicles(lv.icicles, tracked);
    const flares = buildFlares(lv.flares, tracked);
    const geysers = buildGeysers(lv.geysers, tracked);
    const bumpers = buildBumpers(lv.bumpers, tracked);
    const springs = buildSprings(lv.springs, tracked);
    const arms = buildArms(lv.arms, tracked);
    const magnets = buildMagnets(lv.magnets, tracked);
    const crushers = buildCrushers(lv.crushers, tracked);
    const rails = buildRails(lv.rails, tracked);
    const group = new THREE.Group();
    group.add(belts.group, coins.group, pickups.group, fans.group, icicles.group, flares.group, geysers.group,
        bumpers.group, springs.group, arms.group, magnets.group, crushers.group, rails.group);
    return {
        group,
        tick(seconds) { belts.tick(seconds); coins.tick(seconds); pickups.tick(seconds); bumpers.tick(seconds); magnets.tick(seconds); },
        tickRun(runMs) {
            fans.tickRun(runMs); icicles.tickRun(runMs); flares.tickRun(runMs); geysers.tickRun(runMs);
            springs.tickRun(runMs); arms.tickRun(runMs); crushers.tickRun(runMs); rails.tickRun(runMs);
        },
        takeCoin: i => coins.take(i),
        takePickup: i => pickups.take(i),
        hitBumper: i => bumpers.hit(i),
        magnetsOff: v => magnets.setOff(v),
        reset() { coins.reset(); pickups.reset(); bumpers.reset(); }
    };
}
