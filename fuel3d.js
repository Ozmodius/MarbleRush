import * as THREE from 'three';
import { FUEL_REACH } from './fuel.js';

// A FUEL CELL, drawn (fuel.js says where): a glowing canister of the ship's
// fuel, standing in a level's deepest dead end -- brass caps, a bright cyan
// core, a ring on the floor, turning and bobbing so it catches the eye once
// the player rounds the corner. Rolled into, it zips up and away.
//
// A cell already found shows as a pale ghost of itself: the spot is still
// worth knowing, but there is nothing to take.
//
// DRAWING ONLY: mazeGame.js decides when it is reached.
// buildFuelCell({ x, z }, ballRadius, found, tracked) -> { group, tick(seconds), take(), reset() }

export function buildFuelCell(spot, ballRadius, found, tracked = []) {
    const r = ballRadius;
    const group = new THREE.Group();
    group.position.set(spot.x, 0, spot.z);
    const H = r * 2.3, R = r * 0.62;

    const ringGeo = new THREE.RingGeometry(FUEL_REACH * 0.75, FUEL_REACH * 1.15, 36).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: found ? 0.15 : 0.45, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.02;
    group.add(ring);

    // It lies on its side, turning: the camera looks down, and a canister
    // standing up shows only its brass lid.
    const spin = new THREE.Group();
    const cell = new THREE.Group();
    cell.rotation.z = Math.PI / 2;
    spin.add(cell);
    const coreGeo = new THREE.CylinderGeometry(R * 0.82, R * 0.82, H * 0.72, 20);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x9ff6ff, emissive: 0x2fd8ff, emissiveIntensity: found ? 0.2 : 1.1, roughness: 0.25, metalness: 0, transparent: true, opacity: found ? 0.3 : 0.92 });
    const capGeo = new THREE.CylinderGeometry(R, R, H * 0.16, 20);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xd9a548, metalness: 0.75, roughness: 0.3, emissive: 0x3a2400, emissiveIntensity: 0.4, transparent: found, opacity: found ? 0.35 : 1 });
    const bandGeo = new THREE.TorusGeometry(R * 0.86, r * 0.05, 6, 24).rotateX(Math.PI / 2);
    const core = new THREE.Mesh(coreGeo, coreMat);
    const top = new THREE.Mesh(capGeo, capMat); top.position.y = H * 0.44;
    const bottom = new THREE.Mesh(capGeo, capMat); bottom.position.y = -H * 0.44;
    const band = new THREE.Mesh(bandGeo, capMat);
    cell.add(core, top, bottom, band);
    cell.children.forEach(m => { m.castShadow = !found; });
    group.add(spin);
    tracked.push(ringGeo, ringMat, coreGeo, coreMat, capGeo, capMat, bandGeo);

    const restY = R + r * 0.35;
    let takenAt = -1, last = 0;
    const api = {
        group,
        tick(seconds) {
            last = seconds;
            if (takenAt < 0) {
                spin.position.y = restY + Math.sin(seconds * 2.4) * r * 0.18;
                spin.rotation.y = seconds * 1.2;
                cell.rotation.x = seconds * 2.2;     // rolling on its own axis
                if (!found) { coreMat.emissiveIntensity = 0.9 + 0.35 * Math.sin(seconds * 5); ringMat.opacity = 0.3 + 0.2 * (0.5 + 0.5 * Math.sin(seconds * 3)); }
                return;
            }
            // Taken: up and away, spinning faster, fading.
            const t = Math.min(1, (seconds - takenAt) / 0.6);
            spin.position.y = restY + t * t * r * 14;
            spin.rotation.y += 0.4;
            spin.scale.setScalar(1 - 0.6 * t);
            coreMat.opacity = 0.92 * (1 - t);
            ringMat.opacity = 0.45 * (1 - t);
            if (t >= 1) group.visible = false;
        },
        take() { if (takenAt < 0) takenAt = last; },
        reset() {
            takenAt = -1;
            group.visible = true;
            spin.scale.setScalar(1);
            coreMat.opacity = found ? 0.3 : 0.92;
            ringMat.opacity = found ? 0.15 : 0.45;
        }
    };
    api.tick(0);
    return api;
}
