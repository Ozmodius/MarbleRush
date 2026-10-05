import * as THREE from 'three';

// WORLD 4's WALLS: plastic toy bricks, two staggered courses high, with a row
// of studs along the top. Built from the same wall rects the physics collides
// with, and never outside them: every brick face lies ON its collider's face
// (only the seams between bricks are cut in, a hair deep), so the marble never
// visibly stops short of plastic. test_maze_walls.js holds that.
//
// Walls overlap where they meet (the generator grows each by its thickness so
// corners close), and two bricks in the same spot would flicker. So walls are
// first MERGED along their line and the walls running along z are CUT where an
// x wall already covers them; what is left tiles the outline exactly once.
//
// Colours are per brick, from a toy palette, with `sat` (0..1) running from
// pastel to full primaries -- world 4's blend. Seeded by position, so a level
// wears the same bricks every time.
//
// Imports only `three`, so the Node test can build and measure it.

export const STUD_PITCH = 0.28;
export const STUD_R = 0.085;
export const STUD_H = 0.06;
const SEAM = 0.006;          // gap between bricks: the dark line that makes them bricks
const TARGET_BRICK = 0.56;   // two studs

const PALETTE = ['#e03a3a', '#f2b51d', '#2f6fd6', '#2fa84f', '#f7f4ec', '#ff7a1a'];

function hash(a, b, c) {
    let h = (Math.round(a * 100) * 374761393 + Math.round(b * 100) * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// The wall outline as non-overlapping runs: { alongX, x0, x1 (or z0, z1), c (the
// fixed coordinate), t (thickness) }.
export function brickRuns(walls) {
    const xs = [], zs = [];
    for (const w of walls) {
        if (w.w >= w.d) xs.push({ lo: w.x - w.w / 2, hi: w.x + w.w / 2, c: w.z, t: w.d });
        else zs.push({ lo: w.z - w.d / 2, hi: w.z + w.d / 2, c: w.x, t: w.w });
    }
    const merge = list => {
        const out = [];
        list.sort((a, b) => a.c - b.c || a.t - b.t || a.lo - b.lo);
        for (const r of list) {
            const last = out[out.length - 1];
            if (last && Math.abs(last.c - r.c) < 1e-6 && Math.abs(last.t - r.t) < 1e-6 && r.lo <= last.hi + 1e-6) last.hi = Math.max(last.hi, r.hi);
            else out.push({ ...r });
        }
        return out;
    };
    const X = merge(xs), Z = merge(zs);
    // Cut each z run where an x run's footprint covers it.
    const cutZ = [];
    for (const z of Z) {
        let pieces = [[z.lo, z.hi]];
        for (const x of X) {
            if (z.c + z.t / 2 <= x.lo + 1e-6 || z.c - z.t / 2 >= x.hi - 1e-6) continue;   // not across it
            const a = x.c - x.t / 2, b = x.c + x.t / 2;
            pieces = pieces.flatMap(([lo, hi]) => {
                if (b <= lo + 1e-6 || a >= hi - 1e-6) return [[lo, hi]];
                const out = [];
                if (a > lo + 1e-6) out.push([lo, a]);
                if (b < hi - 1e-6) out.push([b, hi]);
                return out;
            });
        }
        for (const [lo, hi] of pieces) if (hi - lo > 0.02) cutZ.push({ ...z, lo, hi });
    }
    return X.map(r => ({ ...r, alongX: true })).concat(cutZ.map(r => ({ ...r, alongX: false })));
}

// One geometry (vertex coloured) for every wall: bricks plus studs.
export function buildBrickWallGeometry(walls, { height, floorY = 0, sat = 1 } = {}) {
    const pos = [], nor = [], col = [], idx = [];
    const color = new THREE.Color(), white = new THREE.Color('#ffffff');
    const tint = (k) => { color.set(PALETTE[Math.floor(k * PALETTE.length) % PALETTE.length]); color.lerp(white, (1 - sat) * 0.55); return color; };
    // An axis-aligned box from (x0,y0,z0) to (x1,y1,z1), one colour, all six faces.
    const box = (x0, y0, z0, x1, y1, z1, c) => {
        const F = [
            [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
            [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
            [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
            [[0, -1, 0], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]],
            [[0, 0, 1], [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]]],
            [[0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]]
        ];
        for (const [n, q] of F) {
            const b = pos.length / 3;
            for (const v of q) { pos.push(...v); nor.push(...n); col.push(c.r, c.g, c.b); }
            idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
    };
    const stud = (x, y, z, c) => {
        const SEG = 12, b = pos.length / 3;
        for (let i = 0; i < SEG; i++) {
            const a = i / SEG * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
            pos.push(x + nx * STUD_R, y, z + nz * STUD_R, x + nx * STUD_R, y + STUD_H, z + nz * STUD_R);
            nor.push(nx, 0, nz, nx, 0, nz);
            col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
        for (let i = 0; i < SEG; i++) {
            const p = b + i * 2, q = b + ((i + 1) % SEG) * 2;
            idx.push(p, p + 1, q, q, p + 1, q + 1);
        }
        const top = pos.length / 3;
        for (let i = 0; i < SEG; i++) {
            const a = i / SEG * Math.PI * 2;
            pos.push(x + Math.cos(a) * STUD_R, y + STUD_H, z + Math.sin(a) * STUD_R);
            nor.push(0, 1, 0); col.push(c.r, c.g, c.b);
        }
        pos.push(x, y + STUD_H, z); nor.push(0, 1, 0); col.push(c.r, c.g, c.b);
        for (let i = 0; i < SEG; i++) idx.push(top + SEG, top + (i + 1) % SEG, top + i);
    };

    const COURSES = 2, ch = height / COURSES;
    for (const r of brickRuns(walls)) {
        const L = r.hi - r.lo;
        const n = Math.max(1, Math.round(L / TARGET_BRICK)), bl = L / n;
        for (let k = 0; k < COURSES; k++) {
            // Running bond: the upper course starts half a brick in.
            const cuts = [r.lo];
            for (let m = 1; m < n + (k % 2); m++) cuts.push(r.lo + bl * (m - (k % 2) * 0.5));
            cuts.push(r.hi);
            const y0 = floorY + k * ch, y1 = floorY + (k + 1) * ch - (k < COURSES - 1 ? SEAM / 2 : 0);
            for (let m = 0; m < cuts.length - 1; m++) {
                const a = cuts[m] + (m > 0 ? SEAM / 2 : 0), b = cuts[m + 1] - (m < cuts.length - 2 ? SEAM / 2 : 0);
                if (b - a < 0.02) continue;
                const c = tint(hash(r.c + (r.alongX ? 0 : 50), (a + b) / 2, k + (r.alongX ? 0 : 7)));
                if (r.alongX) box(a, y0, r.c - r.t / 2, b, y1, r.c + r.t / 2, c);
                else box(r.c - r.t / 2, y0, a, r.c + r.t / 2, y1, b, c);
                // Studs on the top course, along the wall's middle line.
                if (k === COURSES - 1) {
                    const ns = Math.max(1, Math.floor((b - a) / STUD_PITCH + 0.01));
                    for (let s = 0; s < ns; s++) {
                        const u = a + (b - a) * (s + 0.5) / ns;
                        if (r.alongX) stud(u, y1, r.c, c); else stud(r.c, y1, u, c);
                    }
                }
            }
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
}

export function makeBrickMaterial(theme) {
    return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: theme.wallRoughness, metalness: 0 });
}
