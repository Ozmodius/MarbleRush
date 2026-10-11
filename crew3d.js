import * as THREE from 'three';

// THE CREW, DRAWN (crew.js decides; mazeGame.js places). Drawing only: no
// body, nothing the physics sees.
//
// buildSight({ walls, beacons }, wallHeight, tracked) -> { group, set(on, seconds) }
//   Glint's Clear Sight: a false wall (pockets.js) shimmers cyan, and a pillar
//   of light rises over each beacon (the fuel cell, a diary page) so they
//   can be found from across the board. Hidden until set(true).
// buildAura(color, ballRadius, tracked) -> { group, place(x, z, seconds) }
//   The last step of a character's track: a soft ring of their own colour on
//   the floor under the ball.

export function buildSight({ walls = [], beacons = [] }, wallHeight, tracked = []) {
    const group = new THREE.Group();
    group.visible = false;
    const shimmerMat = new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    tracked.push(shimmerMat);
    for (const w of walls) {
        const geo = new THREE.BoxGeometry(w.w + 0.04, wallHeight + 0.04, w.d + 0.04);
        tracked.push(geo);
        const m = new THREE.Mesh(geo, shimmerMat);
        m.position.set(w.x, wallHeight / 2, w.z);
        group.add(m);
    }
    const pillarGeo = new THREE.CylinderGeometry(0.12, 0.2, 6, 16, 1, true);
    const pillarMat = new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    tracked.push(pillarGeo, pillarMat);
    const pillars = beacons.map(b => {
        const m = new THREE.Mesh(pillarGeo, pillarMat);
        m.position.set(b.x, 3, b.z);
        group.add(m);
        return { m, b };
    });
    return {
        group,
        set(on, seconds = 0) {
            group.visible = !!on;
            if (!on) return;
            const pulse = 0.5 + 0.5 * Math.sin(seconds * 6);
            shimmerMat.opacity = 0.25 + 0.35 * pulse;
            pillarMat.opacity = 0.22 + 0.2 * pulse;
            for (const p of pillars) p.m.visible = !p.b.gone || !p.b.gone();
        }
    };
}

export function buildAura(color, ballRadius, tracked = []) {
    const r = ballRadius;
    const geo = new THREE.RingGeometry(r * 1.05, r * 1.9, 40).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color || '#ffffff'), transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    tracked.push(geo, mat);
    const ring = new THREE.Mesh(geo, mat);
    const group = new THREE.Group();
    group.add(ring);
    return {
        group,
        place(x, z, seconds = 0) {
            group.position.set(x, 0.015, z);
            ring.rotation.y = seconds * 0.8;
            mat.opacity = 0.32 + 0.14 * Math.sin(seconds * 3);
        }
    };
}
