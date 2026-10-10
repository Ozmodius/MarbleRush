import * as THREE from 'three';
import { PAGE_REACH } from './pockets.js';

// A PAGE OF THE BARON'S DIARY, drawn (pockets.js says where): a rolled sheet
// of parchment sealed with his red cog, floating at the back of a secret
// pocket with a faint gold glow. Rolled into, it lifts and fades.
// DRAWING ONLY. buildPage({ x, z }, ballRadius, tracked) -> { group, tick(seconds), take(), reset() }
export function buildPage(spot, ballRadius, tracked = []) {
    const r = ballRadius;
    const group = new THREE.Group();
    group.position.set(spot.x, 0, spot.z);
    const glowGeo = new THREE.CircleGeometry(PAGE_REACH * 1.1, 28).rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd66e, transparent: true, opacity: 0.22, depthWrite: false });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = 0.02;
    group.add(glow);
    const scroll = new THREE.Group();
    const paperGeo = new THREE.CylinderGeometry(r * 0.36, r * 0.36, r * 1.9, 18).rotateZ(Math.PI / 2);
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xf1e2b8, roughness: 0.85, emissive: 0x4a3a10, emissiveIntensity: 0.35, transparent: true, opacity: 1 });
    const endGeo = new THREE.CylinderGeometry(r * 0.42, r * 0.42, r * 0.12, 18).rotateZ(Math.PI / 2);
    const endMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.6, transparent: true, opacity: 1 });
    const sealGeo = new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 0.08, 10);
    const sealMat = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.4, emissive: 0x3a0806, emissiveIntensity: 0.5, transparent: true, opacity: 1 });
    const paper = new THREE.Mesh(paperGeo, paperMat);
    const e1 = new THREE.Mesh(endGeo, endMat); e1.position.x = r * 1.0;
    const e2 = new THREE.Mesh(endGeo, endMat); e2.position.x = -r * 1.0;
    const seal = new THREE.Mesh(sealGeo, sealMat); seal.position.y = r * 0.38;
    scroll.add(paper, e1, e2, seal);
    scroll.children.forEach(m => { m.castShadow = true; });
    group.add(scroll);
    tracked.push(glowGeo, glowMat, paperGeo, paperMat, endGeo, endMat, sealGeo, sealMat);
    const restY = r * 0.75;
    let takenAt = -1, last = 0;
    const mats = [paperMat, endMat, sealMat];
    return {
        group,
        tick(seconds) {
            last = seconds;
            if (takenAt < 0) {
                scroll.position.y = restY + Math.sin(seconds * 1.8) * r * 0.15;
                scroll.rotation.y = Math.sin(seconds * 0.7) * 0.6;
                glowMat.opacity = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(seconds * 2.6));
                return;
            }
            const t = Math.min(1, (seconds - takenAt) / 0.7);
            scroll.position.y = restY + t * r * 6;
            scroll.rotation.y += 0.3;
            mats.forEach(m => { m.opacity = 1 - t; });
            glowMat.opacity = 0.22 * (1 - t);
            if (t >= 1) group.visible = false;
        },
        take() { if (takenAt < 0) takenAt = last; },
        reset() { takenAt = -1; group.visible = true; mats.forEach(m => { m.opacity = 1; }); glowMat.opacity = 0.22; }
    };
}
