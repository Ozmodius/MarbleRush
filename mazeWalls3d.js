import * as THREE from 'three';

// WALL GEOMETRY -- what a wall LOOKS like, built from the rects the physics
// collides with. The single place a wall spec ({ x, z, w, d }) becomes triangles.
//
// THE RULE: the collider is always the box. A theme may round, roughen and
// crack the wall it draws, but only INWARD from the collider's faces, so:
//   - nothing drawn ever pokes into a corridor (the marble would appear to roll
//     through rock), which test_maze_walls.js checks vertex by vertex;
//   - below the height the marble can touch, a face sits at most SIDE_INSET
//     inside its collider, so the marble never visibly stops short of the wall;
//   - above that height (the rounded, jagged crest) anything inward goes,
//     because nothing ever touches it.
// The verifier (test_maze_levels.js) certifies levels against the boxes, so
// none of this can make a level unfair -- it can only make it LOOK unfair, and
// the two bounds above are what stop that.
//
// All walls of a level go into ONE geometry, so a rock maze costs the same
// single draw call the instanced box maze did. The geometry is built from each
// wall's REAL size rather than a stretched unit box: a stretched box stretches
// its bevels and its texture with it, which is why themes could not have either.
//
// Imports only `three`, so the Node test can build and measure it.

// How far a wall face may sit inside its collider, below the marble's reach.
// A fairness bound, not a theme knob: it is ~8% of the smallest ball radius,
// small enough that the gap between marble and rock never reads as a bounce
// off thin air. test_maze_walls.js holds the builder to it.
export const SIDE_INSET = 0.02;

// Styles a theme can ask for. 'box' is the original sharp-edged wall.
export const WALL_STYLES = ['box', 'rock', 'bricks'];

// Rock defaults, used when a theme names the style but not the numbers.
const ROCK = { bevel: 0.05, jag: 0.14, step: 0.11, roundSteps: 2 };

// Deterministic value noise on a world position. The wall a player sees on
// level 7 must be the same rock every time they load it, and the same rock on
// every device -- Math.random() would reshuffle it each restart.
function hash3(ix, iy, iz, seed) {
    let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}

function valueNoise(x, y, z, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    const n = (a, b, c) => hash3(ix + a, iy + b, iz + c, seed);
    const lerp = (a, b, t) => a + (b - a) * t;
    return lerp(
        lerp(lerp(n(0, 0, 0), n(1, 0, 0), sx), lerp(n(0, 1, 0), n(1, 1, 0), sx), sy),
        lerp(lerp(n(0, 0, 1), n(1, 0, 1), sx), lerp(n(0, 1, 1), n(1, 1, 1), sx), sy),
        sz);
}

// Two octaves, in [0, 1]. Rock wants a big lump and some grit, not more.
function rockNoise(x, y, z, seed) {
    return (valueNoise(x * 4.1, y * 4.1, z * 4.1, seed) * 0.66
        + valueNoise(x * 11.3, y * 11.3, z * 11.3, seed + 17) * 0.34);
}

// Ridged noise, in [0, 1]: sharp peaks where smooth noise crosses its middle.
// This is what makes a crest read as broken rock rather than as rolling hills.
function cragNoise(x, z, seed) {
    const a = 1 - Math.abs(valueNoise(x * 3.3, 0, z * 3.3, seed) * 2 - 1);
    const b = 1 - Math.abs(valueNoise(x * 8.7, 0, z * 8.7, seed + 31) * 2 - 1);
    return Math.min(1, a * a * 0.7 + b * b * 0.45);
}

function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

// Sample positions across [-len/2, len/2]: dense inside the rounded band at
// each end, coarse in the middle. Uniform dense sampling would spend most of
// its vertices on flat face, and this is a phone.
function axisSamples(len, round, roundSteps, step) {
    const h = len / 2;
    if (round <= 0) {
        const n = Math.max(1, Math.ceil(len / step));
        return Array.from({ length: n + 1 }, (_, i) => -h + (len * i) / n);
    }
    const out = [];
    for (let i = 0; i < roundSteps; i++) out.push(-h + (round * i) / roundSteps);
    const mid = len - 2 * round;
    const n = Math.max(1, Math.ceil(mid / step));
    for (let i = 0; i <= n; i++) out.push(-h + round + (mid * i) / n);
    for (let i = roundSteps - 1; i >= 0; i--) out.push(h - (round * i) / roundSteps);
    return out;
}

// Same idea for height, which is only rounded at the TOP: the foot of a wall
// stands on the floor and must meet it.
function heightSamples(height, round, roundSteps, step) {
    const out = [];
    const flat = height - round;
    const n = Math.max(1, Math.ceil(flat / step));
    for (let i = 0; i <= n; i++) out.push((flat * i) / n);
    for (let i = roundSteps - 1; i >= 0; i--) out.push(height - (round * i) / roundSteps);
    return out;
}

// Resolve the numbers a style builds with. Clamped against the thinnest wall
// so a bevel can never be wider than half the wall it rounds.
export function wallShape(opts = {}) {
    // 'bricks' (world 4) is built by toyWalls3d.js for the level's walls; a
    // single block like a gate is drawn as the plain box it is.
    const style = WALL_STYLES.includes(opts.style) && opts.style !== 'bricks' ? opts.style : 'box';
    if (style === 'box') return { style, bevel: 0, jag: 0, inset: 0, step: Infinity, roundSteps: 0 };
    const num = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
    return {
        style,
        bevel: num(opts.bevel, ROCK.bevel),
        jag: num(opts.jag, ROCK.jag),
        inset: SIDE_INSET,
        step: ROCK.step,
        roundSteps: ROCK.roundSteps
    };
}

// Build one geometry for a list of wall rects.
//
//   specs      [{ x, z, w, d }] in level space (or gate-local space)
//   height     wall height; the foot sits on floorY
//   reach      the highest point the marble can touch (its largest radius);
//              below it the face holds to SIDE_INSET, above it the crest is free
//   style...   see wallShape()
//   seed       offsets the noise, so two gates in the same place differ
//   uvPerUnit  texture coordinates per world unit (box-projected, so a texture
//              keeps its scale on every wall instead of stretching with it)
export function buildWallGeometry(specs, opts = {}) {
    const height = opts.height;
    const floorY = opts.floorY || 0;
    const reach = Number.isFinite(opts.reach) ? opts.reach : height * 0.75;
    const seed = opts.seed | 0;
    const uvPerUnit = Number.isFinite(opts.uvPerUnit) ? opts.uvPerUnit : 0.4;
    const shape = wallShape(opts);

    const positions = [], uvs = [], indices = [];

    specs.forEach((s, wi) => {
        // Never round more than the wall can hold, nor into the band the
        // marble touches: the crest starts above `reach`.
        const r = Math.min(shape.bevel, s.w * 0.45, s.d * 0.45, Math.max(0, height - reach - 0.02));
        const xs = axisSamples(s.w, r, shape.roundSteps, shape.step);
        const zs = axisSamples(s.d, r, shape.roundSteps, shape.step);
        const ys = shape.style === 'box' ? [0, height] : heightSamples(height, r, shape.roundSteps, shape.step);
        // A hair of per-wall lift: walls overlap at every corner the generator
        // grew to meet, and two coplanar crests drawn over each other flicker.
        const lift = shape.style === 'box' ? 0 : (wi % 7) * 0.0004;
        const hx = s.w / 2, hz = s.d / 2;

        // Place one vertex from its position on the undeformed box.
        const vert = (lx, ly, lz) => {
            let px = lx, py = ly, pz = lz;
            let nx = 0, ny = 0, nz = 0;
            if (shape.style !== 'box') {
                // Round the crest and the upright corners: clamp into the box
                // shrunk by r, then push back out by r along the offset.
                const cx = Math.max(-hx + r, Math.min(hx - r, lx));
                const cz = Math.max(-hz + r, Math.min(hz - r, lz));
                const cy = Math.min(ly, height - r);
                let dx = lx - cx, dy = ly - cy, dz = lz - cz;
                const len = Math.hypot(dx, dy, dz);
                if (len > 1e-9 && r > 0) {
                    dx /= len; dy /= len; dz /= len;
                    px = cx + dx * r; py = cy + dy * r; pz = cz + dz * r;
                    nx = dx; ny = dy; nz = dz;
                } else if (len > 1e-9) {
                    nx = dx / len; ny = dy / len; nz = dz / len;
                }
                // Roughen, inward only. Below `reach` the face may sink at most
                // SIDE_INSET; above it the crest may drop by up to `jag` more.
                const wx = s.x + px, wy = floorY + py, wz = s.z + pz;
                const crest = smoothstep(reach + 0.02, height, py);
                const sink = rockNoise(wx, wy, wz, seed) * (shape.inset + crest * shape.jag * 0.9);
                px -= nx * sink; py -= ny * sink; pz -= nz * sink;
                // The crest heaves into crags: a jagged skyline is what stops
                // a rock wall reading as a rounded plank. Mostly UP -- there is
                // no ceiling -- and never down past `reach`, or the marble
                // would look taller than the wall it is held by.
                py += crest * shape.jag * (cragNoise(wx, wz, seed + 5) * 1.35 - 0.35);
                // ...and shears sideways along its faces, so peaks lean and
                // overhang rather than all standing straight up. Clamped back
                // into the footprint: crags never reach into a corridor.
                px += crest * shape.jag * 0.6 * (valueNoise(wx * 9.1, wy * 9.1, wz * 9.1, seed + 11) - 0.5);
                pz += crest * shape.jag * 0.6 * (valueNoise(wx * 9.1, wy * 9.1, wz * 9.1, seed + 13) - 0.5);
                px = Math.max(-hx, Math.min(hx, px));
                pz = Math.max(-hz, Math.min(hz, pz));
                if (crest > 0) py = Math.max(py, reach + 0.02);
                py += lift * crest;
            }
            const x = s.x + px, y = floorY + py, z = s.z + pz;
            positions.push(x, y, z);
            // Box projection by the undeformed face, so each face keeps
            // square texels whatever its length.
            const ax = Math.abs(lx) >= hx - 1e-9, az = Math.abs(lz) >= hz - 1e-9;
            if (ly >= height - 1e-9 && !ax && !az) uvs.push(x * uvPerUnit, z * uvPerUnit);
            else if (ax) uvs.push(z * uvPerUnit, y * uvPerUnit);
            else uvs.push(x * uvPerUnit, y * uvPerUnit);
        };

        // One grid per face. `a` and `b` are the face's two in-plane axes,
        // `fix` places a grid point; winding is chosen so the face points out.
        const face = (as, bs, fix, flip) => {
            const base = positions.length / 3;
            for (const b of bs) for (const a of as) vert(...fix(a, b));
            const na = as.length;
            for (let j = 0; j < bs.length - 1; j++) {
                for (let i = 0; i < na - 1; i++) {
                    const p = base + j * na + i, q = p + 1, t = p + na, u = t + 1;
                    if (flip) indices.push(p, q, t, q, u, t);
                    else indices.push(p, t, q, q, t, u);
                }
            }
        };
        face(zs, ys, (z, y) => [hx, y, z], false);   // +x
        face(zs, ys, (z, y) => [-hx, y, z], true);   // -x
        face(xs, ys, (x, y) => [x, y, hz], true);    // +z
        face(xs, ys, (x, y) => [x, y, -hz], false);  // -z
        face(xs, zs, (x, z) => [x, height, z], false); // top
        // No bottom face: it stands on the floor and nobody sees under a maze.
    });

    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    if (shape.style !== 'box') {
        // Un-index for FLAT normals: each facet lit on its own is what reads
        // as broken, cooled rock; smooth normals over the same shape read as
        // moulded clay. Neighbouring faces were built from the same positions,
        // so their shared edges deformed identically -- no cracks. UVs are
        // re-derived per facet, since a crag's facets face every which way.
        geo = geo.toNonIndexed();
        geo.computeVertexNormals();
        fillPlanarUvs(geo, uvPerUnit);
    }
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
}

// Re-derive UVs from position by each facet's dominant normal axis. Not
// seamless at the crest, but a texture on a rock wall would rather have a seam
// than stretch.
function fillPlanarUvs(geo, k) {
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (ay >= ax && ay >= az) uv.setXY(i, x * k, z * k);
        else if (ax >= az) uv.setXY(i, z * k, y * k);
        else uv.setXY(i, x * k, y * k);
    }
}
