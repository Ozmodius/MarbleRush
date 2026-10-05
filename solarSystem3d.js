import * as THREE from 'three';
import { makePlanetMaterial, planetGlow, atmosphere, starfield } from './planet3d.js';

// THE WORLD SELECT AS A SOLAR SYSTEM. The worlds orbit a sun, innermost
// first, each a small planet wearing its world's surface (planet3d.js). A
// world not yet unlocked keeps its look but is dimmed; a world not built yet
// is a dark silhouette. The selected world carries a ring.
//
// Display only: what is unlocked, and what tapping does, is menus.js reading
// the progress store. This module draws and answers "which planet is here?".
//
// worlds: [{ n, theme (resolved) | null, state: 'open' | 'locked' | 'coming' }]

const SUN_R = 1.1;
const ORBIT0 = 2.4, ORBIT_STEP = 1.2;
const SIZES = [0.72, 0.66, 0.84, 0.72, 0.8, 0.68, 0.74, 0.82, 0.7, 0.86];
// Where each world sits on its orbit (radians; 0 = screen right, +pi/2 =
// toward the viewer). Chosen so no two planets, nor their name labels, ever
// line up on screen: the planets drift a little about these rather than
// orbiting all the way, which also keeps them still enough to tap.
const PLACES = [1.05, 2.6, 4.65, 5.75, 3.5, 0.2, 2.0, 4.9, 3.1, 5.9];
const DRIFT = 0.12;

export function buildSolarSystem(worlds, tracked = []) {
    const group = new THREE.Group();
    const keep = (...xs) => { tracked.push(...xs); return xs[0]; };

    // The sun: unlit, with a wide warm halo, and a light so the planets have
    // a lit side facing it.
    const sunGeo = keep(new THREE.SphereGeometry(SUN_R, 48, 32));
    const sunMat = keep(new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    group.add(new THREE.Mesh(sunGeo, sunMat));
    const haloGeo = keep(new THREE.SphereGeometry(SUN_R * 1.9, 48, 32));
    const haloMat = keep(atmosphere('#ff9a2e'));
    haloMat.side = THREE.BackSide;
    group.add(new THREE.Mesh(haloGeo, haloMat));
    const sunLight = new THREE.PointLight(0xffd9a0, 60, 0, 2);
    group.add(sunLight);

    const orbitMat = keep(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14 }));
    const ringGeo = keep(new THREE.TorusGeometry(1, 0.035, 8, 64).rotateX(Math.PI / 2));
    const ringMat = keep(new THREE.MeshBasicMaterial({ color: 0xf0b23a }));
    const pickMat = keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));

    const planets = worlds.map((w, i) => {
        const orbit = ORBIT0 + i * ORBIT_STEP;
        const r = SIZES[i % SIZES.length];

        // The orbit line.
        const pts = [];
        for (let k = 0; k <= 128; k++) { const a = k / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * orbit, 0, Math.sin(a) * orbit)); }
        const lineGeo = keep(new THREE.BufferGeometry().setFromPoints(pts));
        group.add(new THREE.Line(lineGeo, orbitMat));

        const holder = new THREE.Group();   // moves round the orbit
        group.add(holder);
        const geo = keep(new THREE.SphereGeometry(r, 64, 48));
        let mat;
        if (w.theme) {
            mat = keep(makePlanetMaterial(w.theme, r));
            if (w.state === 'locked') mat.color.multiplyScalar(0.4);
            const atmoGeo = keep(new THREE.SphereGeometry(r * 1.12, 32, 24));
            const atmoMat = keep(atmosphere(w.state === 'locked' ? '#555049' : planetGlow(w.theme)));
            holder.add(new THREE.Mesh(atmoGeo, atmoMat));
        } else {
            mat = keep(new THREE.MeshStandardMaterial({ color: 0x2a2421, roughness: 1, metalness: 0 }));
        }
        const mesh = new THREE.Mesh(geo, mat);
        holder.add(mesh);
        // A generous invisible target, so a small planet is easy to tap.
        const pick = new THREE.Mesh(keep(new THREE.SphereGeometry(Math.max(0.9, r * 1.8), 12, 8)), pickMat);
        pick.userData.world = w.n;
        holder.add(pick);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.scale.setScalar(r * 1.55);
        ring.visible = false;
        holder.add(ring);
        return { n: w.n, holder, mesh, pick, ring, orbit, r, place: PLACES[i % PLACES.length], speed: 0.25 / Math.sqrt(orbit) };
    });

    const starGeo = keep(starfield(500, 4242));
    const starMat = keep(new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.8 }));
    group.add(new THREE.Points(starGeo, starMat));

    const outer = ORBIT0 + (worlds.length - 1) * ORBIT_STEP + SIZES[0] * 2;

    // SPINNING. The player can turn the whole system about the sun by
    // dragging (menus.js): every planet moves round its orbit by the same
    // angle, so their spacing -- and their labels' -- never changes. Let go
    // mid-drag and it coasts to a stop.
    let spin = 0, spinV = 0, held = false, lastT = null;

    return {
        group,
        radius: outer,
        tick(seconds) {
            const dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, seconds - lastT));
            lastT = seconds;
            if (!held && spinV) {
                spin += spinV * dt;
                spinV *= Math.exp(-dt * 2.5);
                if (Math.abs(spinV) < 0.01) spinV = 0;
            }
            for (const p of planets) {
                const a = p.place + spin + Math.sin(seconds * p.speed) * DRIFT;
                p.holder.position.set(Math.cos(a) * p.orbit, 0, Math.sin(a) * p.orbit);
                p.mesh.rotation.y = seconds * 0.3;
            }
        },
        // Drag: turn by `d` radians now. Release: coast at `v` radians/s.
        spinBy(d) { held = true; spinV = 0; spin += d; },
        release(v) { held = false; spinV = Math.max(-4, Math.min(4, v || 0)); },
        spin: () => spin,
        select(n) { for (const p of planets) p.ring.visible = p.n === n; },
        // Which world's planet a ray hits, or null.
        pick(raycaster) {
            const hit = raycaster.intersectObjects(planets.map(p => p.pick), false)[0];
            return hit ? hit.object.userData.world : null;
        },
        // Where each planet is, for the name labels menus.js draws under them.
        anchors() { return planets.map(p => ({ n: p.n, pos: p.holder.getWorldPosition(new THREE.Vector3()), r: p.r })); }
    };
}
