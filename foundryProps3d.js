import * as THREE from 'three';
import { crusherState, crusherBottom, CRUSH_UP_H, railState } from './mazeHazards.js';

// WORLD 5's TRAPS as meshes: magnets, crushers and electric rails. Drawing
// only -- what each does is mazeHazards.js -- and drawn where those rules act:
// a magnet's field ring is its reach, a press's footprint is what it crushes,
// a rail's glowing strip is the stretch of wall that shocks.

const WALL_TOP = 0.55;     // mazeGame.js WALL_HEIGHT

// MAGNETS: a red horseshoe magnet lying on top of the wall, its silver poles
// hanging over the corridor's edge, and a faint pulsing ring on the floor
// marking how far it pulls. tick(seconds) pulses the field.
export function buildMagnets(magnets, tracked = []) {
    const group = new THREE.Group();
    const shoeGeo = new THREE.TorusGeometry(0.12, 0.045, 10, 20, Math.PI).rotateX(Math.PI / 2);
    const armGeo = new THREE.BoxGeometry(0.09, 0.09, 0.14);
    const poleGeo = new THREE.BoxGeometry(0.092, 0.092, 0.05);
    const ringGeo = new THREE.RingGeometry(0.97, 1, 64, 1, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
    const arcGeo = new THREE.RingGeometry(0.5, 0.52, 48, 1, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
    const red = new THREE.MeshStandardMaterial({ color: 0xd42a2a, roughness: 0.35, metalness: 0.2 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.25, metalness: 0.9 });
    tracked.push(shoeGeo, armGeo, poleGeo, ringGeo, arcGeo, red, steel);
    const units = (magnets || []).map((m, i) => {
        const u = new THREE.Group();
        u.position.set(m.x, 0, m.z);
        // Local +x points into the corridor (along the face normal).
        u.rotation.y = -Math.atan2(m.nz, m.nx);
        const shoe = new THREE.Group();
        shoe.position.set(-0.24, WALL_TOP + 0.08, 0);
        shoe.scale.setScalar(1.7);
        const bend = new THREE.Mesh(shoeGeo, red);
        bend.rotation.y = Math.PI / 2;           // the bend away from the corridor
        shoe.add(bend);
        for (const sz of [-1, 1]) {
            const arm = new THREE.Mesh(armGeo, red); arm.rotation.y = Math.PI / 2;
            arm.position.set(0.07, 0, sz * 0.12); shoe.add(arm);
            const pole = new THREE.Mesh(poleGeo, steel); pole.rotation.y = Math.PI / 2;
            pole.position.set(0.16, 0, sz * 0.12); shoe.add(pole);
        }
        shoe.children.forEach(c => { c.castShadow = true; });
        u.add(shoe);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.3, depthWrite: false });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.scale.setScalar(m.reach);
        ring.position.y = 0.011;
        u.add(ring);
        // Field lines drawn in toward the poles, over and over.
        const arcs = [0, 1, 2].map(k => {
            const mat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0, depthWrite: false });
            const a = new THREE.Mesh(arcGeo, mat);
            a.position.y = 0.012;
            u.add(a); tracked.push(mat);
            return { a, mat, k };
        });
        tracked.push(ringMat);
        group.add(u);
        return { m, ringMat, arcs, seed: i * 0.37 };
    });
    let off = false;
    return {
        group,
        // The Plastic Ball switches the fields off: the rings go grey.
        setOff(v) { off = !!v; },
        tick(seconds) {
            for (const u of units) {
                u.ringMat.opacity = off ? 0.1 : 0.22 + 0.1 * Math.sin(seconds * 3 + u.seed * 10);
                u.ringMat.color.setHex(off ? 0x777777 : 0x5ab8ff);
                for (const { a, mat, k } of u.arcs) {
                    const f = ((seconds * 0.6 + k / 3 + u.seed) % 1);       // 0 at the rim -> 1 at the magnet
                    a.scale.setScalar(u.m.reach * 2 * (1 - f) + 0.05);
                    mat.opacity = off ? 0 : 0.45 * Math.sin(f * Math.PI);
                }
            }
        }
    };
}

// A yellow-and-black hazard band, shared by every press.
let _haz = null;
function hazardTexture() {
    if (_haz) return _haz;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#f2b51d'; g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#151515';
    for (let x = -16; x < 64; x += 16) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 8, 16); g.lineTo(x + 16, 0); g.lineTo(x + 8, 0); g.closePath(); g.fill(); }
    _haz = new THREE.CanvasTexture(c);
    _haz.wrapS = THREE.RepeatWrapping;
    _haz.colorSpace = THREE.SRGBColorSpace;
    return _haz;
}

// CRUSHERS: a heavy steel press head on a piston, a hazard band round its
// foot and an amber lamp on top that spins during the warning. Its footprint
// is marked on the floor in hazard stripes. tickRun(runMs) moves it.
export const CRUSH_HEAD_H = 0.42;
export function buildCrushers(crushers, tracked = []) {
    const group = new THREE.Group();
    const headGeo = new THREE.BoxGeometry(1, CRUSH_HEAD_H, 1).translate(0, CRUSH_HEAD_H / 2, 0);
    const bandGeo = new THREE.BoxGeometry(1.01, 0.08, 1.01).translate(0, 0.04, 0);
    const rodGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 12).translate(0, 0.25, 0);
    const capGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.12, 14).translate(0, 0.06, 0);
    const lampGeo = new THREE.SphereGeometry(0.06, 12, 8);
    const markGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x3d434b, roughness: 0.45, metalness: 0.7 });
    const bandMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.5 });
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.2, metalness: 0.95 });
    tracked.push(headGeo, bandGeo, rodGeo, capGeo, lampGeo, markGeo, headMat, bandMat, rodMat);
    const units = (crushers || []).map(c => {
        const u = new THREE.Group();
        u.position.set(c.x, 0, c.z);
        const press = new THREE.Group();
        const head = new THREE.Mesh(headGeo, headMat); head.scale.set(c.w, 1, c.d); head.castShadow = true;
        const band = new THREE.Mesh(bandGeo, bandMat); band.scale.set(c.w, 1, c.d);
        const rod = new THREE.Mesh(rodGeo, rodMat); rod.position.y = CRUSH_HEAD_H;
        const lampMat = new THREE.MeshBasicMaterial({ color: 0x553300 });
        const lamp = new THREE.Mesh(lampGeo, lampMat); lamp.position.set(c.w * 0.3, CRUSH_HEAD_H + 0.06, 0);
        const cyl = new THREE.Mesh(capGeo, headMat); cyl.position.y = CRUSH_HEAD_H + 0.5;
        press.add(head, band, rod, cyl, lamp);
        u.add(press);
        const markMat = new THREE.MeshBasicMaterial({ map: hazardTexture(), transparent: true, opacity: 0.35, depthWrite: false });
        const mark = new THREE.Mesh(markGeo, markMat); mark.scale.set(c.w, 1, c.d); mark.position.y = 0.005;
        u.add(mark);
        tracked.push(lampMat, markMat);
        group.add(u);
        return { c, press, lampMat, markMat };
    });
    return {
        group,
        tickRun(runMs) {
            for (const k of units) {
                const st = crusherState(k.c, runMs);
                let y = crusherBottom(k.c, runMs);
                let jitter = 0;
                if (st.state === 'warn') jitter = 0.012 * Math.sin(runMs * 0.09) * (0.4 + st.k);
                k.press.position.set(jitter, y + (st.state === 'warn' ? 0.03 * st.k : 0), 0);
                const warnOn = st.state === 'warn' && Math.sin(runMs * 0.025) > 0;
                const danger = st.state === 'slam' || st.state === 'down';
                k.lampMat.color.setHex(warnOn || danger ? 0xffa21a : 0x553300);
                k.markMat.opacity = danger ? 0.8 : st.state === 'warn' ? 0.35 + 0.4 * st.k : 0.3;
            }
        }
    };
}

// ELECTRIC RAILS: a copper bar set into the wall face on insulators. Dead it
// is dull; sparking it flickers; live it glows blue-white with crackling
// arcs along it. tickRun(runMs).
export function buildRails(rails, tracked = []) {
    const group = new THREE.Group();
    const barGeo = new THREE.BoxGeometry(1, 0.05, 1);
    const insGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 8);
    const insMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.4 });
    const arcGeo = new THREE.PlaneGeometry(1, 0.12);
    tracked.push(barGeo, insGeo, insMat, arcGeo);
    const units = (rails || []).map((r, i) => {
        const u = new THREE.Group();
        const alongX = r.w >= r.d;
        const len = alongX ? r.w : r.d, thick = alongX ? r.d : r.w;
        u.position.set(r.x, 0, r.z);
        const barMat = new THREE.MeshStandardMaterial({ color: 0xb8733a, roughness: 0.3, metalness: 0.8, emissive: 0x7fd4ff, emissiveIntensity: 0 });
        // Two bars at the marble's height band, flush with the face.
        const bars = [0.16, 0.3].map(y => {
            const b = new THREE.Mesh(barGeo, barMat);
            b.scale.set(alongX ? len : thick, 1, alongX ? thick : len);
            // A hair proud of the wall face (it is set into the wall, so its
            // face would otherwise sit exactly on the wall's and flicker).
            b.position.set(r.nx * 0.004, y, r.nz * 0.004);
            u.add(b);
            return b;
        });
        for (const f of [-0.42, 0, 0.42]) {
            const ins = new THREE.Mesh(insGeo, insMat);
            ins.scale.y = 0.2;
            ins.position.set((alongX ? f * len : 0) + r.nx * 0.004, 0.23, (alongX ? 0 : f * len) + r.nz * 0.004);
            u.add(ins);
        }
        // The danger band on the floor beside the wall: where a ball would be
        // touching it. Dark while dead, blue-white while live.
        const stripMat = new THREE.MeshBasicMaterial({ color: 0x1a2a33, transparent: true, opacity: 0.6, depthWrite: false });
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), stripMat);
        const band = 0.09;
        strip.scale.set(alongX ? len : band, 1, alongX ? band : len);
        strip.position.set(r.nx * (thick / 2 + band / 2), 0.006, r.nz * (thick / 2 + band / 2));
        u.add(strip);
        tracked.push(stripMat, strip.geometry);
        const arcMat = new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        const arc = new THREE.Mesh(arcGeo, arcMat);
        arc.scale.x = len;
        arc.position.set(r.nx * 0.03, 0.23, r.nz * 0.03);
        if (!alongX) arc.rotation.y = Math.PI / 2;
        u.add(arc);
        tracked.push(barMat, arcMat);
        group.add(u);
        return { r, barMat, arcMat, arc, stripMat, seed: i * 1.7 };
    });
    return {
        group,
        tickRun(runMs) {
            for (const k of units) {
                const st = railState(k.r, runMs);
                const flick = Math.sin(runMs * 0.11 + k.seed) * Math.sin(runMs * 0.037 + k.seed * 3);
                let glow = 0, arc = 0;
                if (st.state === 'warn') { glow = flick > 0.3 ? 0.8 * st.k + 0.2 : 0; arc = flick > 0.6 ? 0.5 : 0; }
                else if (st.state === 'live') { glow = 1.6 + 0.4 * flick; arc = 0.55 + 0.35 * flick; }
                k.barMat.emissiveIntensity = glow;
                k.stripMat.color.setHex(st.state === 'live' ? 0x9fe6ff : (st.state === 'warn' && flick > 0.3) ? 0x4fa8d8 : 0x1a2a33);
                k.stripMat.opacity = st.state === 'live' ? 0.85 : 0.6;
                k.arcMat.opacity = arc;
                k.arc.scale.y = 0.6 + 0.6 * Math.abs(flick);
            }
        }
    };
}
