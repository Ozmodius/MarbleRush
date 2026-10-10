import * as THREE from 'three';
import { makePlanetMaterial } from './planet3d.js';

// EACH WORLD'S SKY (the user's call, 2026-10-10): the maze hangs high over its
// planet, and what shows round the board is that planet far below -- its own
// surface (the material home's planet wears, so Sawturn is forest and sea,
// Magmars basalt and lava) seen through its weather:
//
//   1 Sawturn     clouds drifting under the board
//   2 Slipstonia  snow blowing across
//   3 Magmars     embers rising, a smoke haze
//   4 Bouncelot   bubbles and confetti floating up
//   5 Gearth      sparks and steam
//
// Cheap on purpose (a low-end phone runs the level too): one ground plane,
// one haze plane, one point cloud per layer, no shadows, positions moved on
// the CPU for a couple of hundred points. Drawing only; nothing here is near
// the board's physics. buildBackdrop(world, theme, tracked) -> { group, tick(seconds) }

// Each world's baked ground, kept for the session (one 512px texture a
// world, five at most): later levels of a world reuse it, so the planet
// shader is compiled and run once a world, not once a level.
const bakedGround = new Map();
const GROUND_Y = -42;            // the planet's surface, far below the board (y 0)
const SPAN_X = 15, SPAN_Z = 26;  // where weather drifts: wider than any phone sees

function softSprite(stops) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (const [at, col] of stops) grad.addColorStop(at, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
const PUFF = [[0, 'rgba(255,255,255,0.9)'], [0.45, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']];
const SPARK = [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']];

// Seeded, so a level's sky starts the same way every visit.
function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// One layer of weather: `count` points in a box between y0 and y1, each
// moving at its own speed `vel(i)` (units/s), wrapping round the box.
function layer({ count, y0, y1, size, color, colors, opacity, additive, sprite, vel, seed, tracked }) {
    const r = rng(seed);
    const pos = new Float32Array(count * 3);
    const base = [];
    for (let i = 0; i < count; i++) {
        const p = [(r() * 2 - 1) * SPAN_X, y0 + r() * (y1 - y0), (r() * 2 - 1) * SPAN_Z];
        base.push({ p, v: vel(r), ph: r() * Math.PI * 2 });
        pos.set(p, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (colors) {
        const col = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) { const c = new THREE.Color(colors[Math.floor(r() * colors.length)]); col.set([c.r, c.g, c.b], i * 3); }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const tex = softSprite(sprite);
    const mat = new THREE.PointsMaterial({
        size, map: tex, color: colors ? 0xffffff : new THREE.Color(color), vertexColors: !!colors,
        transparent: true, opacity, depthWrite: false, sizeAttenuation: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    tracked.push(geo, mat, tex);
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    const wrap = (v, lo, hi) => { const w = hi - lo; return lo + ((((v - lo) % w) + w) % w); };
    return {
        points,
        tick(t) {
            for (let i = 0; i < count; i++) {
                const b = base[i];
                pos[i * 3] = wrap(b.p[0] + b.v[0] * t + Math.sin(t * 0.7 + b.ph) * b.v[3], -SPAN_X, SPAN_X);
                pos[i * 3 + 1] = wrap(b.p[1] + b.v[1] * t, y0, y1);
                pos[i * 3 + 2] = wrap(b.p[2] + b.v[2] * t, -SPAN_Z, SPAN_Z);
            }
            geo.attributes.position.needsUpdate = true;
        }
    };
}

// Each world's weather, as layers.
function weather(world, tracked) {
    const L = (o) => layer({ tracked, ...o });
    switch (world) {
    case 1: return [  // clouds drifting under the board, two decks
        L({ count: 10, y0: -30, y1: -20, size: 10, color: '#ffffff', opacity: 0.38, sprite: PUFF, seed: 11, vel: r => [0.5 + r() * 0.3, 0, 0.1, 0.4] }),
        L({ count: 7, y0: -16, y1: -9, size: 7, color: '#ffffff', opacity: 0.24, sprite: PUFF, seed: 12, vel: r => [0.8 + r() * 0.4, 0, 0.15, 0.3] })
    ];
    case 2: return [  // snow blowing across, a low cloud deck
        L({ count: 9, y0: -32, y1: -22, size: 9, color: '#eef5ff', opacity: 0.3, sprite: PUFF, seed: 21, vel: r => [0.4, 0, 0, 0.3] }),
        L({ count: 220, y0: -20, y1: -3, size: 0.35, color: '#ffffff', opacity: 0.85, sprite: SPARK, seed: 22, vel: r => [1.6 + r() * 1.2, -0.8 - r() * 0.6, 0.6, 0.6] })
    ];
    case 3: return [  // a smoke haze, embers rising
        L({ count: 10, y0: -34, y1: -18, size: 11, color: '#2b1d18', opacity: 0.45, sprite: PUFF, seed: 31, vel: r => [0.25, 0.3, 0.05, 0.3] }),
        L({ count: 140, y0: -36, y1: -4, size: 0.42, color: '#ff8a2e', opacity: 0.95, additive: true, sprite: SPARK, seed: 32, vel: r => [0.2, 1.4 + r() * 1.6, 0, 0.5] })
    ];
    case 4: return [  // bubbles and confetti floating up
        L({ count: 70, y0: -34, y1: -6, size: 0.9, colors: ['#ff5d8f', '#ffd166', '#06d6a0', '#5fa8ff', '#b388ff'], opacity: 0.8, sprite: SPARK, seed: 41, vel: r => [0.3, 1.0 + r() * 0.8, 0, 0.8] }),
        L({ count: 26, y0: -30, y1: -10, size: 2.4, color: '#ffffff', opacity: 0.2, sprite: PUFF, seed: 42, vel: r => [0.1, 0.7 + r() * 0.4, 0, 0.5] })
    ];
    case 5: return [  // steam, and sparks off the works below
        L({ count: 9, y0: -34, y1: -16, size: 9, color: '#9aa3ad', opacity: 0.3, sprite: PUFF, seed: 51, vel: r => [0.3, 0.6, 0, 0.3] }),
        L({ count: 120, y0: -38, y1: -8, size: 0.32, color: '#ffd36b', opacity: 0.95, additive: true, sprite: SPARK, seed: 52, vel: r => [(r() - 0.5) * 2, 2 + r() * 2, (r() - 0.5) * 2, 0.2] })
    ];
    default: return [];
    }
}

export function buildBackdrop(world, theme, tracked = []) {
    const group = new THREE.Group();
    // The planet's surface far below: home's planet material on a big plane,
    // its pattern scaled so continents are a few board-widths across.
    // It is the top of a sphere, not a plane: the planet patterns are drawn
    // round a sphere's centre (planet3d.js), and a cap of a big one is how a
    // surface far below looks anyway. Only the cap is built.
    const R = 140;
    // The cap is cut round the sphere's EQUATOR (+z in its own frame) and
    // turned to face up: the patterns snow over the poles.
    const groundGeo = new THREE.SphereGeometry(R, 72, 18, 0, Math.PI * 2, 0, 0.75).rotateX(Math.PI / 2);
    // The pattern made ~4x finer than a whole planet's, so the continents are
    // a few board-widths across.
    const groundMat = makePlanetMaterial(theme, R / 4.5);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y - R;
    ground.receiveShadow = false;
    group.add(ground);
    // A haze of the world's own sky colour over it, so it reads as far away
    // and never competes with the board.
    const hazeGeo = new THREE.PlaneGeometry(220, 220).rotateX(-Math.PI / 2);
    const hazeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.backdropColor), transparent: true, opacity: 0.35, depthWrite: false });
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    haze.position.y = GROUND_Y + 4;
    group.add(haze);
    tracked.push(groundGeo, groundMat, hazeGeo, hazeMat);
    const layers = weather(world, tracked);
    let baked = false;
    for (const l of layers) group.add(l.points);
    return {
        group,
        // The ground never moves, but its shader is the planet's -- several
        // octaves of noise a pixel, over half the screen, every frame. Drawn
        // once instead, into a texture on a plain plane (call with the page's
        // renderer once the level is built). Without a renderer, or on any
        // failure, the live ground stays: slower, never wrong.
        bake(renderer) {
            if (!renderer || !ground.parent) return false;
            const S = 64, RES = 512;     // far off and hazed: 512 is plenty, and a quarter of the work
            const key = `${world}:${theme.floorPattern}`;
            const flatOf = (tex) => {
                group.remove(ground);
                const flatGeo = new THREE.PlaneGeometry(2 * S, 2 * S).rotateX(-Math.PI / 2);
                const flatMat = new THREE.MeshBasicMaterial({ map: tex });
                const flat = new THREE.Mesh(flatGeo, flatMat);
                flat.position.y = GROUND_Y;
                group.add(flat);
                // Not the texture: it is kept for the world's next level.
                tracked.push(flatGeo, flatMat);
                baked = true;
                return true;
            };
            if (bakedGround.has(key)) return flatOf(bakedGround.get(key).texture);
            try {
                const rt = new THREE.WebGLRenderTarget(RES, RES);
                rt.texture.colorSpace = THREE.SRGBColorSpace;
                const sc = new THREE.Scene();
                sc.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
                const sun = new THREE.DirectionalLight(0xffffff, 1.7);
                sun.position.set(0.4, 1, 0.3);
                sc.add(sun);
                group.remove(ground);
                sc.add(ground);
                const cam = new THREE.OrthographicCamera(-S, S, S, -S, 1, 400);
                cam.up.set(0, 0, -1);
                cam.position.set(0, GROUND_Y + 150, 0);
                cam.lookAt(0, GROUND_Y, 0);
                const was = renderer.getRenderTarget();
                renderer.setRenderTarget(rt);
                renderer.render(sc, cam);
                renderer.setRenderTarget(was);
                sc.remove(ground);
                bakedGround.set(key, rt);
                if (bakedGround.size > 5) { const [k, old] = bakedGround.entries().next().value; bakedGround.delete(k); old.dispose(); }
                group.add(ground);       // flatOf swaps it out
                return flatOf(rt.texture);
            } catch (e) {
                if (!ground.parent) group.add(ground);
                return false;
            }
        },
        get baked() { return baked; },
        tick(seconds) { for (const l of layers) l.tick(seconds); }
    };
}
