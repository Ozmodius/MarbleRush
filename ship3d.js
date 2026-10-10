import * as THREE from 'three';

// ROLLE'S SHIP: a little saucer from MarbleTopia, drawn. It flies the marble
// between planets (levelShow.js says where it is, mazeGame.js moves it), and
// will circle home's planet too. Drawing only -- no body, no physics.
//
// Sized to the marble: the glass dome holds Rolle (and a freed friend) with
// room to spare, so a marble riding in it is seen through the glass.
//
// buildShip(tracked) -> { group, beam, setBeam(k), tick(seconds), setPose(pose) }

const HULL = 0xd9dee6, TRIM = 0xf2b544, GLOW = 0x7fe8ff;

export function buildShip(tracked = []) {
    const group = new THREE.Group();
    const body = new THREE.Group();          // banks; the beam stays upright
    const spin = new THREE.Group();          // turns slowly inside the bank
    body.add(spin);
    group.add(body);

    // The hull: a lathed saucer, wider than it is tall, a lip round the rim.
    const R = 0.95;
    const profile = [
        [0.0, -0.16], [0.38, -0.2], [0.72, -0.12], [R, -0.02], [R * 1.02, 0.02],
        [0.82, 0.1], [0.5, 0.16], [0.0, 0.17]
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const hullGeo = new THREE.LatheGeometry(profile, 40);
    // A soft metal: a weak environment turns full metal black (see the win star).
    const hullMat = new THREE.MeshStandardMaterial({ color: HULL, metalness: 0.45, roughness: 0.32, emissive: 0x1a2230, emissiveIntensity: 0.4 });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    spin.add(hull);

    // A gold band round the middle: Rolle's colours.
    const bandGeo = new THREE.TorusGeometry(R * 0.99, 0.035, 8, 48).rotateX(Math.PI / 2);
    const bandMat = new THREE.MeshStandardMaterial({ color: TRIM, metalness: 0.7, roughness: 0.3, emissive: 0x5a3a00, emissiveIntensity: 0.5 });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.y = 0.0;
    spin.add(band);

    // Rim lights that chase round.
    const LIGHTS = 10;
    const lightGeo = new THREE.SphereGeometry(0.055, 10, 8);
    const lightMats = [0xffd66e, 0x7fe8ff].map(c => new THREE.MeshBasicMaterial({ color: c }));
    const lights = [];
    for (let i = 0; i < LIGHTS; i++) {
        const a = (i / LIGHTS) * Math.PI * 2;
        const m = new THREE.Mesh(lightGeo, lightMats[i % 2]);
        m.position.set(Math.cos(a) * R * 0.88, 0.06, Math.sin(a) * R * 0.88);
        spin.add(m);
        lights.push(m);
    }

    // The dome: clear glass over a seat the marble rides on.
    const domeGeo = new THREE.SphereGeometry(0.48, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshStandardMaterial({ color: 0xbfefff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false, emissive: 0x2a6f8a, emissiveIntensity: 0.25 });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.y = 0.14;
    dome.renderOrder = 2;
    spin.add(dome);
    const ringGeo = new THREE.TorusGeometry(0.49, 0.04, 8, 32).rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, bandMat);
    ring.position.y = 0.15;
    spin.add(ring);

    // Underneath: the beam emitter, and the beam itself (a soft cone).
    const padGeo = new THREE.CircleGeometry(0.34, 28).rotateX(Math.PI / 2);
    const padMat = new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = -0.205;
    spin.add(pad);
    const beamH = 1;                         // scaled to the hover height
    const beamGeo = new THREE.CylinderGeometry(0.3, 0.55, beamH, 28, 1, true).translate(0, -beamH / 2, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = -0.2;
    beam.renderOrder = 3;
    group.add(beam);

    tracked.push(hullGeo, hullMat, bandGeo, bandMat, lightGeo, ...lightMats, domeGeo, domeMat, ringGeo, padGeo, padMat, beamGeo, beamMat);

    let beamOn = 0;
    return {
        group,
        // k 0..1; the beam reaches from the ship's belly down to height `toY`
        // under it (the floor, in the ship's parent frame).
        setBeam(k, length) {
            beamOn = Math.max(0, Math.min(1, k));
            beam.visible = beamOn > 0.01;
            if (Number.isFinite(length) && length > 0.05) beam.scale.set(1, length - 0.2, 1);
        },
        tick(seconds) {
            const chase = Math.floor(seconds * 12) % LIGHTS;
            lights.forEach((m, i) => { m.scale.setScalar(i === chase || i === (chase + 5) % LIGHTS ? 1.5 : 1); });
            spin.rotation.y = seconds * 0.6;
            beamMat.opacity = beamOn * (0.26 + 0.08 * Math.sin(seconds * 18));
            padMat.opacity = 0.55 + 0.4 * beamOn;
        },
        // pose: { x, y, z, bank, visible }
        setPose(p) {
            group.visible = !!p.visible;
            group.position.set(p.x, p.y, p.z);
            body.rotation.z = p.bank || 0;
        }
    };
}
