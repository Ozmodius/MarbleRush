import { forwardOf } from './walkMode.js';

// THE WALK HUD's explorer kit (shopCatalog.js EXPLORER), each shown only if
// owned:
//   COMPASS  an arrow toward the exit, turned by where the walker faces, and
//            how far it is in a straight line;
//   MAP      the maze drawn from above, but only what the walker has been
//            near: a fog that lifts as you walk, so it remembers the way
//            without giving the maze away.
// Plain 2D canvas over the 3D view; mazeGame.js builds one per walk.
//
// createWalkHud({ level, compass, map }) -> { update(x, z, yaw), dispose() }

const REVEAL_R = 1.3;        // board units of floor uncovered round the walker
const MAP_EVERY_MS = 90;     // the map redraws about 11 times a second

export function createWalkHud({ level, compass, map }) {
    const compassEl = document.getElementById('walkCompass');
    const mapEl = document.getElementById('walkMap');
    if (compassEl) compassEl.hidden = !compass;
    if (mapEl) mapEl.hidden = !map;

    let draw = null;
    if (map && mapEl) {
        const cssW = 104, cssH = Math.round(cssW * level.size.d / level.size.w);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        mapEl.width = cssW * dpr; mapEl.height = cssH * dpr;
        mapEl.style.width = cssW + 'px'; mapEl.style.height = cssH + 'px';
        const s = mapEl.width / level.size.w;
        const px = x => (x + level.size.w / 2) * s, pz = z => (z + level.size.d / 2) * s;
        // The maze, drawn once: floor, holes, walls, the exit.
        const base = document.createElement('canvas');
        base.width = mapEl.width; base.height = mapEl.height;
        const b = base.getContext('2d');
        b.fillStyle = 'rgba(244, 234, 217, 0.92)';
        b.fillRect(0, 0, base.width, base.height);
        b.fillStyle = '#1a120c';
        for (const h of level.holes || []) { b.beginPath(); b.arc(px(h.x), pz(h.z), (h.r || 0.4) * s, 0, Math.PI * 2); b.fill(); }
        b.fillStyle = '#6b4a2e';
        for (const w of level.walls || []) b.fillRect(px(w.x - w.w / 2), pz(w.z - w.d / 2), w.w * s, w.d * s);
        b.strokeStyle = '#2f9e5a';
        b.lineWidth = 2.5 * dpr;
        b.beginPath(); b.arc(px(level.goal.x), pz(level.goal.z), Math.max(4 * dpr, (level.goal.r || 0.4) * s), 0, Math.PI * 2); b.stroke();
        // The fog: opaque until walked near.
        const fog = document.createElement('canvas');
        fog.width = mapEl.width; fog.height = mapEl.height;
        const f = fog.getContext('2d');
        f.fillStyle = '#0c0806';
        f.fillRect(0, 0, fog.width, fog.height);
        const g = mapEl.getContext('2d');
        let since = MAP_EVERY_MS;
        draw = (x, z, yaw, dtMs) => {
            // Lift the fog every frame (cheap), redraw the map now and then.
            f.globalCompositeOperation = 'destination-out';
            const grad = f.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), REVEAL_R * s);
            grad.addColorStop(0.6, 'rgba(0, 0, 0, 1)'); grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            f.fillStyle = grad;
            f.beginPath(); f.arc(px(x), pz(z), REVEAL_R * s, 0, Math.PI * 2); f.fill();
            f.globalCompositeOperation = 'source-over';
            since += dtMs;
            if (since < MAP_EVERY_MS) return;
            since = 0;
            g.clearRect(0, 0, mapEl.width, mapEl.height);
            g.drawImage(base, 0, 0);
            g.drawImage(fog, 0, 0);
            // You: a dot with a nose pointing where you face.
            const F = forwardOf(yaw);
            g.fillStyle = '#e8413c';
            g.beginPath();
            g.moveTo(px(x) + F.x * 7 * dpr, pz(z) + F.z * 7 * dpr);
            g.lineTo(px(x) - F.z * 4 * dpr - F.x * 3 * dpr, pz(z) + F.x * 4 * dpr - F.z * 3 * dpr);
            g.lineTo(px(x) + F.z * 4 * dpr - F.x * 3 * dpr, pz(z) - F.x * 4 * dpr - F.z * 3 * dpr);
            g.closePath(); g.fill();
        };
    }

    const arrow = compassEl && compassEl.querySelector('.compass-arrow');
    const dist = compassEl && compassEl.querySelector('.compass-dist');
    return {
        update(x, z, yaw, dtMs = 16) {
            if (compass && arrow) {
                // Bearing to the exit, relative to facing: 0 = straight ahead.
                const dx = level.goal.x - x, dz = level.goal.z - z;
                const toGoal = Math.atan2(-dx, -dz);
                const rel = toGoal - yaw;
                arrow.style.transform = `rotate(${(-rel * 180 / Math.PI).toFixed(1)}deg)`;
                dist.textContent = Math.hypot(dx, dz).toFixed(1) + ' m';
            }
            if (draw) draw(x, z, yaw, dtMs);
        },
        // Off while the result panel is up (it sits where the compass does).
        show(on) {
            if (compassEl) compassEl.hidden = !(on && compass);
            if (mapEl) mapEl.hidden = !(on && map);
        },
        dispose() {
            if (compassEl) compassEl.hidden = true;
            if (mapEl) mapEl.hidden = true;
        }
    };
}
