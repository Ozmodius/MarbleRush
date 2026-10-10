import * as THREE from 'three';
import { makeBallMaterial } from './mazeTheme3d.js';
import { CAPTIVE_REACH } from './rescue.js';

// THE CAPTIVE'S CAGE (rescue.js), drawn: a friend of Rolle's shut in one of
// Baron Von Ratchet's clockwork cages on a world's floor 10, a glow on the
// floor around it so it can be spotted from across the board once in view.
// Roll into it (within CAPTIVE_REACH, decided in mazeGame.js) and the bars
// fly off, the friend hops out and rolls along behind the ball, on the path
// the ball itself took -- so it never cuts through a wall -- to the exit.
//
// DRAWING ONLY: the friend has no body, nothing here touches the physics,
// and mazeGame.js decides when the cage is reached. Imports `three` and the
// two pure-ish modules, never the game scene, so the theme preview can draw
// it too.
//
// buildCage({ x, z }, look, ballRadius, tracked) -> {
//   group, tick(seconds), free(), track(x, z, running), reset(), freed }

const IRON = 0x3a3d45, BRASS = 0xc8973a;
const BARS = 9;
const OPEN_S = 0.7;       // how long the bars take to fly off
const LAG = 2.6;          // the friend rolls this many ball radii behind
const JUMP = 0.6;         // a step longer than this is a teleport (a shield)

// A clockwork cog, the Baron's mark: a disc with square teeth.
function cogGeometry(r, teeth, depth) {
    const shape = new THREE.Shape();
    const inner = r * 0.78;
    for (let i = 0; i < teeth; i++) {
        const a0 = (i / teeth) * Math.PI * 2, a1 = a0 + Math.PI / teeth * 0.45, a2 = a0 + Math.PI / teeth, a3 = a2 + Math.PI / teeth * 0.55;
        const p = (a, rr) => [Math.cos(a) * rr, Math.sin(a) * rr];
        if (i === 0) shape.moveTo(...p(a0, r));
        else shape.lineTo(...p(a0, r));
        shape.lineTo(...p(a1, r));
        shape.lineTo(...p(a2, inner));
        shape.lineTo(...p(a3, inner));
    }
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, r * 0.28, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -depth / 2, 0);
    return geo;
}

export function buildCage(spot, look, ballRadius, tracked = []) {
    const r = ballRadius;
    const group = new THREE.Group();
    group.position.set(spot.x, 0, spot.z);

    // The glow on the floor: the friend's own colour, breathing.
    const glowColor = new THREE.Color((look && (look.emissive || look.color)) || '#ffffff');
    const glowGeo = new THREE.RingGeometry(CAPTIVE_REACH * 0.9, CAPTIVE_REACH * 1.45, 40).rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = 0.018;
    group.add(glow);

    // The cage: iron bars on a ring, a base ring and a top ring, a brass cog
    // on the lid that ticks round like the Baron's planets.
    const R = r * 1.28, H = r * 2.5;
    const cage = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: IRON, metalness: 0.75, roughness: 0.38, transparent: true, opacity: 1 });
    const brass = new THREE.MeshStandardMaterial({ color: BRASS, metalness: 0.85, roughness: 0.3, emissive: 0x3a2400, emissiveIntensity: 0.4, transparent: true, opacity: 1 });
    const barGeo = new THREE.CylinderGeometry(r * 0.075, r * 0.075, H, 6);
    const ringGeo = new THREE.TorusGeometry(R, r * 0.11, 6, 28).rotateX(Math.PI / 2);
    const cogGeo = cogGeometry(R * 0.42, 8, r * 0.2);
    const strapGeo = new THREE.BoxGeometry(R * 2, r * 0.09, r * 0.09);
    const knobGeo = new THREE.SphereGeometry(r * 0.16, 10, 8);
    tracked.push(glowGeo, glowMat, iron, brass, barGeo, ringGeo, cogGeo, knobGeo, strapGeo);
    const bars = [];
    for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2;
        const b = new THREE.Mesh(barGeo, iron);
        b.position.set(Math.cos(a) * R, H / 2, Math.sin(a) * R);
        b.castShadow = true;
        b.userData.home = b.position.clone();
        b.userData.out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        cage.add(b);
        bars.push(b);
    }
    const base = new THREE.Mesh(ringGeo, iron);
    base.position.y = r * 0.1;
    const top = new THREE.Mesh(ringGeo, iron);
    top.position.y = H;
    const cog = new THREE.Mesh(cogGeo, brass);
    cog.position.y = H + r * 0.1;
    cog.castShadow = true;
    const knob = new THREE.Mesh(knobGeo, brass);
    knob.position.y = H + r * 0.24;
    // Two straps across the lid, so from above it reads as a cage with the
    // friend visible inside, the Baron's little cog where they cross.
    const straps = [0, Math.PI / 2].map(a => { const m = new THREE.Mesh(strapGeo, iron); m.rotation.y = a + Math.PI / 4; m.position.y = H; return m; });
    cage.add(base, top, ...straps, cog, knob);
    group.add(cage);

    // The friend: their own marble, a touch smaller than Rolle.
    const fr = r * 0.82;
    const friendGeo = new THREE.SphereGeometry(fr, 24, 18);
    const friendMat = makeBallMaterial(null, look);
    tracked.push(friendGeo, friendMat);
    const friend = new THREE.Mesh(friendGeo, friendMat);
    friend.castShadow = true;
    // Two little eyes, so a marble reads as a someone.
    const eyeGeo = new THREE.SphereGeometry(fr * 0.13, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x15161a });
    tracked.push(eyeGeo, eyeMat);
    const face = new THREE.Group();
    for (const s of [-1, 1]) {
        const e = new THREE.Mesh(eyeGeo, eyeMat);
        e.position.set(s * fr * 0.3, fr * 0.72, fr * 0.6);   // up front: the camera looks down
        face.add(e);
    }
    const friendHolder = new THREE.Group();   // position + facing
    friendHolder.add(friend, face);
    group.add(friendHolder);

    // Where the friend follows: points of the ball's own path (world x/z,
    // spaced), newest last; and the friend's state.
    let path = [];
    let freedAt = -1;            // seconds (the page clock) the bars flew; -1 caged
    let lastSeconds = 0;
    let followX = spot.x, followZ = spot.z, facing = 0, rolled = 0;
    let beamK = 0, beamTo = null;     // riding the ship's beam: how far up, to where

    function home() {
        friendHolder.position.set(0, fr, 0);
        friendHolder.rotation.set(0, 0, 0);
        friend.rotation.set(0, 0, 0);
        followX = spot.x; followZ = spot.z; facing = 0; rolled = 0;
    }
    home();

    function reset() {
        freedAt = -1;
        path = [];
        cage.visible = true;
        glow.visible = true;
        iron.opacity = 1; brass.opacity = 1;
        for (const b of bars) { b.position.copy(b.userData.home); b.rotation.set(0, 0, 0); }
        top.position.y = H; for (const m of straps) m.position.y = H; cog.position.y = H + r * 0.1; knob.position.y = H + r * 0.24;
        home();
        beamK = 0; beamTo = null;
        friendHolder.visible = true;
        api.freed = false;
    }

    // The point on the path LAG*r behind its newest end (null if too short).
    function behind(dist) {
        let left = dist;
        for (let i = path.length - 1; i > 0; i--) {
            const a = path[i], b = path[i - 1];
            const d = Math.hypot(a.x - b.x, a.z - b.z);
            if (d >= left) { const t = left / d; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }; }
            left -= d;
        }
        return null;
    }

    const api = {
        group,
        freed: false,
        tick(seconds) {
            const dt = Math.min(0.1, Math.max(0, seconds - lastSeconds));
            lastSeconds = seconds;
            if (freedAt < 0) {
                // Caged: the glow breathes, the cog ticks round in steps, the
                // friend rattles at the bars.
                glowMat.opacity = 0.32 + 0.22 * (0.5 + 0.5 * Math.sin(seconds * 3.2));
                const tickStep = Math.floor(seconds * 2) + Math.min(1, (seconds * 2 % 1) * 4);
                cog.rotation.y = tickStep * (Math.PI * 2 / 10);
                const hop = Math.max(0, Math.sin(seconds * 5.5));
                friendHolder.position.set(Math.sin(seconds * 2.1) * r * 0.12, fr + hop * hop * r * 0.35, Math.cos(seconds * 1.7) * r * 0.08);
                friendHolder.rotation.y = Math.sin(seconds * 0.9) * 0.9;
                return;
            }
            const t = seconds - freedAt;
            // The bars fly outward and up, spinning, and fade; the lid pops.
            if (t < OPEN_S) {
                const k = t / OPEN_S, e = 1 - (1 - k) * (1 - k);
                for (const b of bars) {
                    b.position.copy(b.userData.home).addScaledVector(b.userData.out, e * r * 4).setY(b.userData.home.y + e * r * 3);
                    b.rotation.set(b.userData.out.z * e * 2.4, 0, -b.userData.out.x * e * 2.4);
                }
                top.position.y = H + e * r * 5; for (const m of straps) m.position.y = H + e * r * 5.2; cog.position.y = H + r * 0.1 + e * r * 5.4; knob.position.y = H + r * 0.24 + e * r * 5.6;
                cog.rotation.y += dt * 14;
                iron.opacity = brass.opacity = 1 - e;
                glowMat.opacity = 0.6 * (1 - e);
            } else if (cage.visible) {
                cage.visible = false;
                glow.visible = false;
            }
            // The friend: a happy hop out, then rolls along behind the ball.
            const target = behind(LAG * r);
            let tx = followX, tz = followZ;
            if (target) { tx = target.x; tz = target.z; }
            const k = 1 - Math.exp(-dt * 9);
            const nx = followX + (tx - followX) * k, nz = followZ + (tz - followZ) * k;
            const moved = Math.hypot(nx - followX, nz - followZ);
            if (moved > 1e-5) {
                const want = Math.atan2(nx - followX, nz - followZ);
                let d = want - facing;
                while (d > Math.PI) d -= Math.PI * 2;
                while (d < -Math.PI) d += Math.PI * 2;
                facing += d * Math.min(1, dt * 10);
            }
            rolled += moved / fr;
            followX = nx; followZ = nz;
            const hop = t < 0.55 ? Math.sin((t / 0.55) * Math.PI) * r * 1.4 : 0;
            friendHolder.position.set(followX - spot.x, fr + hop, followZ - spot.z);
            friendHolder.rotation.y = facing;
            friend.rotation.x = rolled;
            // Up Rolle's ship's beam (levelShow.js), beside him into the dome.
            if (beamK > 0 && beamTo) {
                const k = beamK;
                friendHolder.position.set(
                    friendHolder.position.x + (beamTo.x - spot.x - friendHolder.position.x) * k,
                    friendHolder.position.y + (beamTo.y - friendHolder.position.y) * k,
                    friendHolder.position.z + (beamTo.z - spot.z - friendHolder.position.z) * k);
            }
        },
        // The cage is reached: open it.
        free() {
            if (freedAt >= 0) return;
            freedAt = lastSeconds;
            api.freed = true;
        },
        // The ball's drawn position, each frame. Only a running ball lays
        // path (not a falling one), and a jump (a shield putting the ball
        // back) starts the path again where it landed.
        track(x, z, running) {
            if (freedAt < 0 || !running) return;
            const last = path[path.length - 1];
            if (last && Math.hypot(x - last.x, z - last.z) > JUMP) {
                path = [{ x, z }];
                followX = x; followZ = z;
                return;
            }
            if (!last || Math.hypot(x - last.x, z - last.z) >= 0.03) {
                path.push({ x, z });
                if (path.length > 400) path.splice(0, path.length - 400);
            }
        },
        // k 0..1 up the ship's beam toward (x, y, z) in the board's frame.
        beam(k, x, y, z) { beamK = k > 0 ? Math.min(1, k) : 0; beamTo = beamK ? { x, y, z } : null; },
        // Gone with the ship.
        hide() { friendHolder.visible = false; },
        reset
    };
    // The friend starts on the cage's spot: the first stretch of path begins
    // there, so they roll out of the cage toward the ball.
    const _free = api.free;
    api.free = () => { _free(); path = [{ x: spot.x, z: spot.z }]; };
    return api;
}
