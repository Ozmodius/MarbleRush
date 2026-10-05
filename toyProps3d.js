import * as THREE from 'three';
import { conveyorDir, springState, armAngle, ARM_HUB_R, ARM_HALF_T } from './mazeHazards.js';

// WORLD 4's TRAPS as meshes: pinball bumpers, spring pads and spinning arms.
// Drawing only -- what each does to the ball is mazeHazards.js. Drawn at the
// sizes those rules use, so what the player sees touch is what counts.

// Heights. A blade spans the marble's middle, so a hit is a shove sideways,
// never a scoop from under it.
export const ARM_Y0 = 0.08, ARM_Y1 = 0.36;
const PAD_REST = 0.03, PAD_DOWN = 0.008, PAD_UP = 0.12;

// BUMPERS: a white skirt with a red rubber ring at the marble's height, and
// a tall blue body with a lit dome that stands well above the walls -- a
// bumper sits snug in a corner, and anything wall-height there is hidden from
// the camera. The dome flashes when hit: hit(i) starts a flash, tick(seconds)
// fades it. Everything within the collider's radius below the marble's reach.
export function buildBumpers(bumpers, tracked = []) {
    const group = new THREE.Group();
    const skirtGeo = new THREE.CylinderGeometry(0.95, 1, 0.2, 24).translate(0, 0.1, 0);
    const ringGeo = new THREE.TorusGeometry(0.84, 0.16, 10, 28).rotateX(Math.PI / 2);
    const bodyGeo = new THREE.CylinderGeometry(0.72, 0.8, 0.42, 24).translate(0, 0.21, 0);
    const domeGeo = new THREE.SphereGeometry(0.74, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const starGeo = new THREE.CircleGeometry(0.42, 5).rotateX(-Math.PI / 2);
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.35 });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd8262b, roughness: 0.6 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.3 });
    tracked.push(skirtGeo, ringGeo, bodyGeo, domeGeo, starGeo, skirtMat, ringMat, bodyMat);
    const units = (bumpers || []).map(b => {
        // Radii scale with the bumper; heights are real units.
        const u = new THREE.Group();
        u.position.set(b.x, 0, b.z);
        const flat = m => { m.scale.set(b.r, 1, b.r); m.castShadow = true; u.add(m); return m; };
        flat(new THREE.Mesh(skirtGeo, skirtMat));
        const ring = flat(new THREE.Mesh(ringGeo, ringMat));
        ring.position.y = 0.26;
        const body = flat(new THREE.Mesh(bodyGeo, bodyMat));
        body.position.y = 0.3;
        // Blue, not gold: a gold top read as a coin from the full-board view.
        const domeMat = new THREE.MeshStandardMaterial({ color: 0x9fd0ff, roughness: 0.2, emissive: 0x3aa0ff, emissiveIntensity: 0.2 });
        const dome = new THREE.Mesh(domeGeo, domeMat);
        dome.scale.set(b.r, b.r * 0.6, b.r);
        dome.position.y = 0.72;
        u.add(dome);
        const star = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        star.scale.set(b.r, 1, b.r);
        star.position.y = 0.72 + b.r * 0.6 + 0.002;
        tracked.push(domeMat, star.material);
        u.add(star);
        group.add(u);
        return { domeMat, ring, b, flash: 0 };
    });
    let last = 0;
    return {
        group,
        hit(i) { if (units[i]) units[i].flash = 1; },
        tick(seconds) {
            const dt = last ? Math.min(0.1, seconds - last) : 0;
            last = seconds;
            for (const k of units) {
                k.flash = Math.max(0, k.flash - dt * 4);
                k.domeMat.emissiveIntensity = 0.2 + 1.8 * k.flash;
                const s = k.b.r * (1 + 0.1 * k.flash);
                k.ring.scale.set(s, 1, s);
            }
        },
        reset() { units.forEach(k => { k.flash = 0; }); }
    };
}

// The arrow painted on a spring plate, pointing +x in texture space.
let _arrow = null;
function arrowTexture() {
    if (_arrow) return _arrow;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1f2a44';
    for (const x0 of [10, 30]) {
        g.beginPath(); g.moveTo(x0, 14); g.lineTo(x0 + 18, 32); g.lineTo(x0, 50); g.lineTo(x0 + 8, 50); g.lineTo(x0 + 26, 32); g.lineTo(x0 + 8, 14); g.closePath(); g.fill();
    }
    _arrow = new THREE.CanvasTexture(c);
    _arrow.colorSpace = THREE.SRGBColorSpace;
    return _arrow;
}

// SPRING PADS: a dark tray, a coiled spring and a plate painted with arrows
// along its launch direction. Through the wind-up the plate sinks into the
// tray and its lights blink faster; on the shot it pops up and settles.
export function buildSprings(springs, tracked = []) {
    const group = new THREE.Group();
    const trayGeo = new THREE.BoxGeometry(1, 0.02, 1).translate(0, 0.01, 0);
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7 });
    const helix = new THREE.Curve();
    helix.getPoint = (t, out = new THREE.Vector3()) => out.set(Math.cos(t * Math.PI * 10) * 0.28, t, Math.sin(t * Math.PI * 10) * 0.28);
    const coilGeo = new THREE.TubeGeometry(helix, 80, 0.035, 5, false);
    const coilMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.85, roughness: 0.3 });
    const plateGeo = new THREE.BoxGeometry(0.92, 0.03, 0.92);
    const lampGeo = new THREE.SphereGeometry(0.06, 8, 6);
    tracked.push(trayGeo, trayMat, coilGeo, coilMat, plateGeo, lampGeo);
    const units = (springs || []).map(p => {
        const u = new THREE.Group();
        u.position.set(p.x, 0, p.z);
        const d = conveyorDir(p) || [1, 0];
        u.rotation.y = -Math.atan2(d[1], d[0]);   // local +x along the launch
        u.scale.set(p.w, 1, p.d);
        const tray = new THREE.Mesh(trayGeo, trayMat);
        u.add(tray);
        const coil = new THREE.Mesh(coilGeo, coilMat);
        u.add(coil);
        const plateMat = [
            new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.35 }),
            new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.35 }),
            new THREE.MeshStandardMaterial({ color: 0xffd23a, map: arrowTexture(), roughness: 0.35, emissive: 0xff8a00, emissiveIntensity: 0 }),
            new THREE.MeshStandardMaterial({ color: 0xff7a1a }),
            new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.35 }),
            new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.35 })
        ];
        const plate = new THREE.Mesh(plateGeo, plateMat);
        plate.castShadow = true;
        u.add(plate);
        const lampMat = new THREE.MeshBasicMaterial({ color: 0x552200 });
        const lamps = [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].map(([lx, lz]) => {
            const l = new THREE.Mesh(lampGeo, lampMat); l.position.set(lx, 0.03, lz); l.scale.set(1 / p.w * 0.5, 0.5, 1 / p.d * 0.5); u.add(l); return l;
        });
        tracked.push(...plateMat, lampMat);
        group.add(u);
        return { p, plate, coil, top: plateMat[2], lampMat, lamps };
    });
    return {
        group,
        tickRun(runMs) {
            for (const k of units) {
                const st = springState(k.p, runMs);
                let y = PAD_REST, glow = 0, lamp = 0.15;
                if (st.state === 'wind') {
                    y = PAD_REST + (PAD_DOWN - PAD_REST) * Math.min(1, st.k * 1.3);
                    // Blinks faster as the shot nears.
                    lamp = Math.sin(runMs * (0.01 + 0.03 * st.k)) > 0 ? 1 : 0.2;
                    glow = 0.25 * st.k;
                } else if (st.state === 'fire') {
                    y = PAD_DOWN + (PAD_UP - PAD_DOWN) * Math.sin(Math.min(1, st.k * 1.5) * Math.PI * 0.5);
                    lamp = 1; glow = 0.9;
                } else {
                    // Settling back after a shot: a little bounce.
                    const after = st.k * 2400;
                    y = PAD_REST + (after < 400 ? 0.05 * Math.exp(-after / 120) * Math.cos(after / 40) : 0);
                }
                k.plate.position.y = y;
                k.coil.scale.y = Math.max(0.005, y - 0.015);
                k.coil.position.y = 0.01;
                k.top.emissiveIntensity = glow;
                k.lampMat.color.setRGB(0.33 + 0.67 * lamp, 0.13 + 0.6 * lamp, 0.0 + 0.1 * lamp);
            }
        }
    };
}

// SPINNING ARMS: a striped hub post and a candy-striped blade either side,
// with rounded ends. Turned to armAngle on the run clock.
export function buildArms(arms, tracked = []) {
    const group = new THREE.Group();
    const hubGeo = new THREE.CylinderGeometry(ARM_HUB_R, ARM_HUB_R * 1.15, ARM_Y1 + 0.08, 18).translate(0, (ARM_Y1 + 0.08) / 2, 0);
    const capGeo = new THREE.SphereGeometry(ARM_HUB_R * 1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x6d5bd0, roughness: 0.35 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.3 });
    const red = new THREE.MeshStandardMaterial({ color: 0xe03a3a, roughness: 0.32 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 0.32 });
    const endGeo = new THREE.CylinderGeometry(ARM_HALF_T * 1.4, ARM_HALF_T * 1.4, ARM_Y1 - ARM_Y0, 14).translate(0, (ARM_Y0 + ARM_Y1) / 2, 0);
    tracked.push(hubGeo, capGeo, hubMat, capMat, red, white, endGeo);
    const units = (arms || []).map(a => {
        const u = new THREE.Group();
        u.position.set(a.x, 0, a.z);
        const hub = new THREE.Mesh(hubGeo, hubMat);
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.y = ARM_Y1 + 0.08;
        hub.castShadow = true;
        u.add(hub, cap);
        const blade = new THREE.Group();
        // Stripes: short boxes alternating red and white from tip to tip.
        const n = Math.max(4, Math.round(a.len * 2 / 0.22));
        const segGeo = new THREE.BoxGeometry(a.len * 2 / n, ARM_Y1 - ARM_Y0, ARM_HALF_T * 2).translate(0, (ARM_Y0 + ARM_Y1) / 2, 0);
        tracked.push(segGeo);
        for (let i = 0; i < n; i++) {
            const s = new THREE.Mesh(segGeo, i % 2 ? white : red);
            s.position.x = -a.len + a.len * 2 * (i + 0.5) / n;
            s.castShadow = true;
            blade.add(s);
        }
        for (const sx of [-1, 1]) {
            const e = new THREE.Mesh(endGeo, red);
            e.position.x = sx * (a.len - ARM_HALF_T * 0.4);
            blade.add(e);
        }
        u.add(blade);
        group.add(u);
        return { a, blade };
    });
    return {
        group,
        tickRun(runMs) { for (const k of units) k.blade.rotation.y = -armAngle(k.a, runMs); }
    };
}
