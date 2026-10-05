import * as THREE from 'three';
import { applySurface } from './mazeSurface3d.js';

// FOREST MESHES for a level, from the numbers forestDressing.js placed (and
// test_forest.js checked against the physics). Trunks, roots and branch
// limbs share one bark material and one geometry each; every canopy is its
// own mesh with its own material, so each can fade on its own while the
// marble is underneath it.
//
// Geometry is built in level space (local = level, like the walls), so the
// procedural bark and leaves (mazeSurface3d.js) stay put as the board leans.

function barkMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    return applySurface(m, { pattern: 'bark', bump: 2.2, grit: 0 });
}
function leafMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, transparent: true });
    return applySurface(m, { pattern: 'leaves', bump: 1.5, grit: 0 });
}

// A trunk: an elliptical column (long axis along its wall), tapering a
// little and leaning slightly, closed by a rounded, uneven crown of bark.
// Taper and crown only ever go INWARD of the base ellipse, which is what
// test_forest.js holds against the wall's box.
function addTrunk(t, pos, idx) {
    const SEG = 10, RINGS = 4;
    const a = t.along, b = t.across, h = t.height;
    const base = pos.length / 3;
    const ring = (y, scale) => {
        for (let i = 0; i < SEG; i++) {
            const th = i / SEG * Math.PI * 2;
            const ca = Math.cos(th) * a * scale, cb = Math.sin(th) * b * scale;
            const lean = t.lean * y;
            // The lean is ALONG the wall, never across it: across, a lean
            // would carry bark out over the corridor.
            pos.push(t.x + (t.alongX ? ca + lean : cb), y, t.z + (t.alongX ? cb : ca + lean));
        }
    };
    for (let k = 0; k <= RINGS; k++) ring(h * k / RINGS, 1 - 0.12 * k / RINGS);
    ring(h + b * 0.35, 0.62);
    ring(h + b * 0.6, 0.25);
    const total = RINGS + 3;
    for (let k = 0; k < total - 1; k++) {
        for (let i = 0; i < SEG; i++) {
            const p = base + k * SEG + i, q = base + k * SEG + (i + 1) % SEG;
            idx.push(p, q, p + SEG, q, q + SEG, p + SEG);
        }
    }
    const top = pos.length / 3;
    pos.push(t.x + (t.alongX ? t.lean * h : 0), h + b * 0.72, t.z + (t.alongX ? 0 : t.lean * h));
    const last = base + (total - 1) * SEG;
    for (let i = 0; i < SEG; i++) idx.push(last + i, last + (i + 1) % SEG, top);
}

// A tube through points [{ x, y, z, r }]: roots and branch limbs.
function addTube(pts, pos, idx, SEG = 6) {
    const base = pos.length / 3;
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3();
    pts.forEach((p, k) => {
        const n = pts[Math.min(k + 1, pts.length - 1)], m = pts[Math.max(k - 1, 0)];
        dir.set(n.x - m.x, n.y - m.y, n.z - m.z).normalize();
        u.crossVectors(dir, Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
        v.crossVectors(dir, u).normalize();
        for (let i = 0; i < SEG; i++) {
            const th = i / SEG * Math.PI * 2;
            pos.push(p.x + (u.x * Math.cos(th) + v.x * Math.sin(th)) * p.r,
                     p.y + (u.y * Math.cos(th) + v.y * Math.sin(th)) * p.r,
                     p.z + (u.z * Math.cos(th) + v.z * Math.sin(th)) * p.r);
        }
    });
    for (let k = 0; k < pts.length - 1; k++) {
        for (let i = 0; i < SEG; i++) {
            const p = base + k * SEG + i, q = base + k * SEG + (i + 1) % SEG;
            idx.push(p, p + SEG, q, q, p + SEG, q + SEG);
        }
    }
}

function geometryOf(pos, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

// A canopy: a cluster of leafy blobs round its centre, baked into one
// geometry. Seeded from its own position so it is the same every time.
function canopyGeometry(c) {
    let s = Math.floor((c.x * 73.1 + c.z * 191.7) * 1000) >>> 0;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const parts = [];
    const n = 9 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
        const r = c.radius * (0.3 + rnd() * 0.22);
        const ang = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * c.radius * 0.68;
        const g = new THREE.IcosahedronGeometry(r, 1);
        g.translate(c.x + Math.cos(ang) * dist, c.y + (rnd() - 0.5) * 0.18, c.z + Math.sin(ang) * dist);
        parts.push(g);
    }
    const pos = [], idx = [];
    for (const g of parts) {
        const off = pos.length / 3;
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
        const gi = g.index ? g.index.array : [...Array(p.count).keys()];
        for (const k of gi) idx.push(off + k);
        g.dispose();
    }
    return geometryOf(pos, idx);
}

// The whole forest for a level. `forest` is forestDressing.js's forestFor().
// tick(ballX, ballZ, dt) fades any canopy the marble is under.
export function buildForest(lv, forest, tracked = []) {
    const group = new THREE.Group();
    const R = lv.ballRadius;

    const tPos = [], tIdx = [];
    forest.rows.forEach(row => row.forEach(t => addTrunk(t, tPos, tIdx)));
    forest.roots.forEach(perWall => perWall.forEach(perTrunk => perTrunk.forEach(root =>
        addTube(root.map(p => ({ x: p.x, y: p.h, z: p.z, r: p.r })), tPos, tIdx, 5)
    )));
    // Branch limbs: from high on the trunk out to each canopy, sagging a
    // little in the middle.
    for (const c of forest.canopies) {
        const f = c.from;
        const mid = { x: (f.x + c.x) / 2, y: Math.max(f.y, c.y) - 0.02, z: (f.z + c.z) / 2, r: 0.045 };
        addTube([{ x: f.x, y: f.y - 0.12, z: f.z, r: 0.07 }, mid, { x: c.x, y: c.y - 0.1, z: c.z, r: 0.03 }], tPos, tIdx, 6);
    }
    const bark = barkMaterial();
    tracked.push(bark);
    if (tIdx.length) {
        const geo = geometryOf(tPos, tIdx);
        tracked.push(geo);
        const mesh = new THREE.Mesh(geo, bark);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
    }

    const canopies = forest.canopies.map(c => {
        const geo = canopyGeometry(c);
        const mat = leafMaterial();
        tracked.push(geo, mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        group.add(mesh);
        return { c, mat, opacity: 1 };
    });

    return {
        group,
        canopyCount: canopies.length,
        // Opacity of each canopy right now (for tests).
        canopyOpacities: () => canopies.map(k => k.opacity),
        canopyCentres: () => canopies.map(k => ({ x: k.c.x, z: k.c.z })),
        tick(ballX, ballZ, dtMs) {
            const k = 1 - Math.exp(-(dtMs || 16) / 120);
            for (const cn of canopies) {
                const under = ballX !== null && Math.hypot(ballX - cn.c.x, ballZ - cn.c.z) < cn.c.radius + R + 0.25;
                cn.opacity += ((under ? 0.15 : 1) - cn.opacity) * k;
                cn.mat.opacity = cn.opacity;
                cn.mat.depthWrite = cn.opacity > 0.95;
            }
        }
    };
}

// The floor's path mask (mazeSurface3d.js woodToDirt): for each texel of the
// board, how far it is from the nearest wall, 0 at a wall's foot rising to 1
// at PATH_WIDTH out. The floor grows moss along the walls and packs the dirt
// down the middle from it.
const PATH_WIDTH = 0.6;
export function buildPathMask(lv, walls) {
    const W = 128, D = Math.round(128 * lv.size.d / lv.size.w);
    const data = new Uint8Array(W * D * 4);
    for (let j = 0; j < D; j++) {
        for (let i = 0; i < W; i++) {
            const x = ((i + 0.5) / W - 0.5) * lv.size.w, z = ((j + 0.5) / D - 0.5) * lv.size.d;
            let d = Infinity;
            for (const w of walls) {
                const dx = Math.max(Math.abs(x - w.x) - w.w / 2, 0), dz = Math.max(Math.abs(z - w.z) - w.d / 2, 0);
                const dd = dx * dx + dz * dz;
                if (dd < d) d = dd;
            }
            const v = Math.round(255 * Math.min(1, Math.sqrt(d) / PATH_WIDTH));
            const o = (j * W + i) * 4;
            data[o] = data[o + 1] = data[o + 2] = v;
            data[o + 3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, W, D);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}
