import * as THREE from 'three';

// HOW A RUN ENDS, DRAWN (fallFx.js says when and how much; mazeGame.js
// places it on the ball and tints the ball itself). Drawing only.
//
// buildFallFx(ballRadius, tracked) -> { group, show(pose, x, y, z, ms), hide() }
//   smoke  a few grey puffs rising and spreading from a burn
//   shell  a pale, faceted shell of ice round a frozen ball, that cracks
//   dust   a ring of dust pushed out from under a press
//   spark  blue-white sparks crackling round a shocked ball

export function buildFallFx(ballRadius, tracked = []) {
    const r = ballRadius;
    const group = new THREE.Group();
    group.visible = false;

    // Smoke: five puffs, each on its own drift.
    const puffGeo = new THREE.SphereGeometry(r * 0.55, 10, 8);
    const puffMat = new THREE.MeshBasicMaterial({ color: 0x5a5550, transparent: true, opacity: 0, depthWrite: false });
    tracked.push(puffGeo, puffMat);
    const puffs = [];
    for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(puffGeo, puffMat);
        const a = i * 1.257;
        puffs.push({ m, ax: Math.cos(a), az: Math.sin(a), lag: i * 0.12 });
        group.add(m);
    }

    // Ice: a faceted shell, and a second one a hair larger for the crack's
    // white lines (its wireframe).
    const shellGeo = new THREE.IcosahedronGeometry(r * 1.35, 1);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xcdeeff, roughness: 0.15, metalness: 0, transparent: true, opacity: 0, flatShading: true, depthWrite: false });
    const crackMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0, depthWrite: false });
    tracked.push(shellGeo, shellMat, crackMat);
    const shell = new THREE.Mesh(shellGeo, shellMat);
    const crack = new THREE.Mesh(shellGeo, crackMat);
    crack.scale.setScalar(1.01);
    group.add(shell, crack);

    // Dust: a flat ring on the floor, spreading.
    const dustGeo = new THREE.RingGeometry(r * 0.9, r * 1.5, 32).rotateX(-Math.PI / 2);
    const dustMat = new THREE.MeshBasicMaterial({ color: 0xb8a58a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    tracked.push(dustGeo, dustMat);
    const dust = new THREE.Mesh(dustGeo, dustMat);
    group.add(dust);

    // Sparks: short bright strokes round the ball.
    const sparkGeo = new THREE.BoxGeometry(r * 0.06, r * 0.06, r * 0.5);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    tracked.push(sparkGeo, sparkMat);
    const sparks = [];
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(sparkGeo, sparkMat); sparks.push(m); group.add(m); }

    return {
        group,
        show(p, x, y, z, ms) {
            group.visible = true;
            group.position.set(x, 0, z);
            // Smoke rises from the ball and spreads, fading.
            puffs.forEach(q => {
                const s = Math.max(0, Math.min(1, p.smoke - q.lag));
                q.m.visible = s > 0;
                q.m.position.set(q.ax * r * 0.6 * s, y + r * 0.4 + s * r * 4, q.az * r * 0.6 * s);
                q.m.scale.setScalar(0.4 + s * 1.4);
            });
            puffMat.opacity = p.smoke > 0 ? 0.55 * (1 - p.smoke * 0.7) : 0;
            // Ice shell grows round the ball; the crack shows its lines and
            // the shell clouds over.
            shell.visible = crack.visible = p.shell > 0;
            shell.position.set(0, y, 0); crack.position.set(0, y, 0);
            shell.scale.setScalar(Math.max(0.01, p.shell));
            crack.scale.setScalar(Math.max(0.01, p.shell) * 1.01);
            shellMat.opacity = 0.55 * p.shell * (1 - 0.3 * p.crack);
            crackMat.opacity = 0.8 * p.crack;
            // Dust spreads out on the floor and settles.
            dust.visible = p.dust > 0;
            dust.position.set(0, 0.02, 0);
            dust.scale.setScalar(1 + p.dust * 1.6);
            dustMat.opacity = 0.6 * (1 - p.dust);
            // Sparks dance round the ball while it is live.
            sparks.forEach((m, i) => {
                m.visible = p.spark > 0;
                const a = i * 0.785 + ms * 0.031 * (i % 2 ? 1 : -1);
                const d = r * (1.15 + 0.25 * Math.sin(ms * 0.07 + i));
                m.position.set(Math.cos(a) * d, y + Math.sin(ms * 0.05 + i * 2) * r * 0.6, Math.sin(a) * d);
                m.lookAt(group.position.x, y, group.position.z);
            });
            sparkMat.opacity = p.spark * (0.5 + 0.5 * Math.abs(Math.sin(ms * 0.09)));
        },
        hide() { group.visible = false; }
    };
}
