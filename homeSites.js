// HOME'S LEVEL SELECT (the user's call, 2026-10-09): a planet's ten levels
// are ten landing sites on its face, joined by a trail that winds up from
// the southern edge to the north -- level 1 low on the left, floor 10 near
// the top. The trail stays on the side facing the camera, so every site is
// in view and tappable at once (menus.js draws a button over each one where
// mazeGame.js projects it).
//
// Pure: angles on the sphere, and points in the planet's frame (+z toward
// the camera, +y up). test_home_sites.js checks every site faces the camera
// and the sites sit far enough apart, seen face-on, to tap one at a time.

// Where each site sits seen face-on, in planet radii: a snake of three
// switchbacks, left to right, right to left, left to right, and floor 10 --
// where the Baron holds a friend -- at the summit. Placed by hand so every
// pair is at least 0.4 radii apart (about 45 px on a phone).
const FACE = [
    [-0.5, -0.66], [-0.05, -0.78], [0.45, -0.62],
    [0.62, -0.22], [0.15, -0.12], [-0.4, -0.05],
    [-0.62, 0.32], [-0.15, 0.45], [0.35, 0.42],
    [0.08, 0.8]
];
// lat/lon in radians. lon 0 faces the camera; lat 0 is the equator.
export function siteAngles(count = 10) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const f = FACE[Math.round(i * (FACE.length - 1) / Math.max(1, count - 1))];
        const lat = Math.asin(f[1]);
        out.push({ lat, lon: Math.asin(Math.max(-1, Math.min(1, f[0] / Math.cos(lat)))) });
    }
    return out;
}

// A point on (or `lift` above) a sphere of radius r.
export function sitePoint(a, r, lift = 0) {
    const R = r + lift;
    return { x: R * Math.cos(a.lat) * Math.sin(a.lon), y: R * Math.sin(a.lat), z: R * Math.cos(a.lat) * Math.cos(a.lon) };
}

// Points along the great-circle arc from a to b (for the trail), `steps`
// of them, `lift` above the surface.
export function trailArc(a, b, r, lift, steps = 12) {
    const p = sitePoint(a, 1), q = sitePoint(b, 1);
    const dot = Math.max(-1, Math.min(1, p.x * q.x + p.y * q.y + p.z * q.z));
    const w = Math.acos(dot);
    const out = [];
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const A = w < 1e-6 ? 1 - t : Math.sin((1 - t) * w) / Math.sin(w), B = w < 1e-6 ? t : Math.sin(t * w) / Math.sin(w);
        const R = r + lift;
        out.push({ x: (A * p.x + B * q.x) * R, y: (A * p.y + B * q.y) * R, z: (A * p.z + B * q.z) * R });
    }
    return out;
}
