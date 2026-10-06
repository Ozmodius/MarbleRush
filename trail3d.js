import * as THREE from 'three';

// BALL TRAILS (shopCatalog.js TRAILS): a glowing ribbon over the floor along
// the ball's recent path. Looks only -- it is drawn, never simulated.
//
// The ribbon is the last LIFE_MS (0.75s) of ball positions, kept flat at the ball's
// centre height and widest at the ball, tapering and fading toward its tail.
// It shrinks away when the ball stops, and a jump bigger than a ball could
// roll in one frame (restart, revive, a debug move) starts it afresh rather
// than streaking across the board.
//
// createTrail(kind, ballRadius) -> { object, update(pos, dtMs), reset(), dispose() }
// or null for 'none'.

const MAX_POINTS = 64;
const LIFE_MS = 750;
const MIN_STEP = 0.015;       // board units between samples

// Each trail's colour at t (0 = at the ball, 1 = the tail end), and its glow.
// `time` lets a trail shimmer.
const STYLES = {
    comet:   { color: (t) => new THREE.Color().setHSL(0.55 + 0.08 * t, 0.95, 0.62 - 0.2 * t), alpha: 0.9 },
    mint:    { color: (t) => new THREE.Color().setHSL(0.42 + 0.06 * t, 0.8, 0.55 - 0.15 * t), alpha: 0.9 },
    flame:   { color: (t) => new THREE.Color().setHSL(0.13 - 0.12 * t, 1, 0.56 - 0.1 * t), alpha: 0.95 },
    rainbow: { color: (t, time) => new THREE.Color().setHSL((t * 0.9 + time * 0.0004) % 1, 0.95, 0.55), alpha: 0.9 },
    gold:    { color: (t, time, i) => new THREE.Color().setHSL(0.12, 0.9, 0.55 + 0.25 * (0.5 + 0.5 * Math.sin(i * 2.7 + time * 0.03))), alpha: 0.9 }
};

export const TRAIL_STYLE_IDS = Object.keys(STYLES);

export function createTrail(kind, ballRadius) {
    const style = STYLES[kind];
    if (!style) return null;
    const pts = [];           // { x, y, z, age }
    let clock = 0;

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_POINTS * 2 * 3);
    const col = new Float32Array(MAX_POINTS * 2 * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
        // Normal blending, not additive: an additive glow vanishes on the pale
        // floors (wood, snow), and a trail has to read on every world.
        vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;

    function rebuild() {
        const n = pts.length;
        geo.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
        if (n < 2) return;
        for (let i = 0; i < n; i++) {
            const p = pts[i];
            // Direction along the path here, and the flat perpendicular to it.
            const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
            let dx = b.x - a.x, dz = b.z - a.z;
            const len = Math.hypot(dx, dz) || 1;
            dx /= len; dz /= len;
            const t = i / (n - 1);              // 0 = newest
            const life = Math.max(0, 1 - p.age / LIFE_MS);
            const w = ballRadius * 0.95 * (1 - t * 0.8) * (0.5 + 0.5 * life);
            const o = i * 6;
            pos[o] = p.x - dz * w; pos[o + 1] = p.y; pos[o + 2] = p.z + dx * w;
            pos[o + 3] = p.x + dz * w; pos[o + 4] = p.y; pos[o + 5] = p.z - dx * w;
            const c = style.color(t, clock, i);
            const al = style.alpha * Math.pow(1 - t, 0.6) * Math.pow(life, 0.7);
            for (const k of [0, 4]) {
                col[i * 8 + k] = c.r; col[i * 8 + k + 1] = c.g; col[i * 8 + k + 2] = c.b; col[i * 8 + k + 3] = al;
            }
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
    }

    return {
        object: mesh,
        update(p, dtMs) {
            clock += dtMs;
            for (const q of pts) q.age += dtMs;
            while (pts.length && pts[pts.length - 1].age > LIFE_MS) pts.pop();
            const head = pts[0];
            // A jump no roll could make in a frame: start over from here.
            if (head && Math.hypot(p.x - head.x, p.z - head.z) > ballRadius * 4) pts.length = 0;
            if (!pts.length || Math.hypot(p.x - pts[0].x, p.z - pts[0].z) > MIN_STEP) {
                pts.unshift({ x: p.x, y: p.y, z: p.z, age: 0 });
                if (pts.length > MAX_POINTS) pts.pop();
            } else {
                // Not moving far: keep the head pinned to the ball.
                pts[0].x = p.x; pts[0].y = p.y; pts[0].z = p.z; pts[0].age = 0;
            }
            rebuild();
        },
        reset() { pts.length = 0; rebuild(); },
        // For the debug hooks: how much ribbon there is right now.
        info() { return { points: pts.length, drawn: geo.drawRange.count, inScene: !!mesh.parent, p0: Array.from(pos.slice(0, 6)), c0: Array.from(col.slice(0, 8)), c5: Array.from(col.slice(40, 48)) }; },
        dispose() { geo.dispose(); mat.dispose(); }
    };
}

// A CSS gradient for the Gear page's trail swatch: the same colours, head to tail.
export function trailCss(kind) {
    const style = STYLES[kind];
    if (!style) return null;
    const stops = [0, 0.25, 0.5, 0.75, 1].map(t => `#${style.color(t, 0, t * 10).getHexString()} ${Math.round(t * 100)}%`);
    return `linear-gradient(90deg, ${stops.join(', ')})`;
}
