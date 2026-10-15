// THE RUN'S PANEL IN THE ROOM (xrMode.js). DOM overlays do not show in an
// immersive session, so the level's own HUD -- name, coins, the medal clock,
// the status lines and the buttons -- is drawn here, onto a canvas texture
// standing past the board's far edge, facing the player. It draws a MODEL
// (xrMode.js builds it from the live DOM, so it says exactly what the page
// would) and reports which button a ray points at. Two shapes: the full card
// while there are buttons (ready, CLEARED, a fall's RETRY), a strip of the
// header and status line during a run.
//
// The interface is a spacecraft's (CLAUDE.md): deep navy glass with a cyan
// edge, gold kept for the one bright choice.
import * as THREE from 'three';

const W = 1024, H = 640, STRIP = 176;
const PANEL_W = 10;                  // level units (about 33 cm on a 9 x 14 board)
const NAVY = 'rgba(8, 18, 38, 0.92)', CYAN = '#4fd8ff', GOLD = '#f2b84b', INK = '#e8f4ff', SOFT = '#bcd8f2';

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
// Words onto lines no wider than `w`.
function wrap(ctx, text, w) {
    const out = [];
    let line = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
        const t = line ? line + ' ' + word : word;
        if (ctx.measureText(t).width <= w || !line) line = t;
        else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out;
}
function fit(ctx, text, w) {
    if (ctx.measureText(text).width <= w) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1);
    return t + '…';
}

export function createXrPanel() {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(PANEL_W, PANEL_W * H / W);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'xrPanel';
    mesh.renderOrder = 10;
    let font = 'system-ui, sans-serif';
    try { font = getComputedStyle(document.body).fontFamily || font; } catch (_) { /* default */ }
    let sig = '', boxes = [], strip = false, levelD = 14;

    function draw(m) {
        ctx.clearRect(0, 0, W, H);
        const hh = m.strip ? STRIP : H;
        roundRect(ctx, 6, 6, W - 12, hh - 12, 30);
        ctx.fillStyle = NAVY; ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = CYAN; ctx.stroke();

        // Header: the level's name, then coins and the medal clock.
        ctx.textBaseline = 'middle';
        let right = W - 44;
        ctx.font = `700 46px ${font}`;
        if (m.clock) {
            ctx.textAlign = 'right'; ctx.fillStyle = INK;
            ctx.fillText(m.clock, right, 62);
            right -= ctx.measureText(m.clock).width + 36;
        }
        if (m.coins !== '') {
            ctx.textAlign = 'right'; ctx.fillStyle = INK;
            ctx.fillText(m.coins, right, 62);
            right -= ctx.measureText(m.coins).width + 14;
            ctx.beginPath(); ctx.arc(right - 15, 62, 15, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill();
            right -= 30 + 30;
        }
        ctx.textAlign = 'left'; ctx.fillStyle = INK;
        ctx.font = `700 48px ${font}`;
        ctx.fillText(fit(ctx, m.title || '', Math.max(80, right - 44)), 44, 62);

        // The buttons, up to three a row, along the bottom.
        const bs = m.strip ? [] : m.buttons;
        const rows = Math.ceil(bs.length / 3), bh = 96, gap = 20;
        const buttonsTop = rows ? H - 40 - rows * bh - (rows - 1) * gap : hh;

        // The status lines: the first in gold (the run's news), the rest soft,
        // as many as fit above the buttons.
        let y = 132;
        const lines = m.strip ? m.lines.slice(0, 1) : m.lines;
        lines.forEach((text, n) => {
            ctx.font = n === 0 ? `700 42px ${font}` : `600 36px ${font}`;
            ctx.fillStyle = n === 0 ? GOLD : SOFT;
            for (const l of wrap(ctx, text, W - 88).slice(0, m.strip ? 1 : 3)) {
                if (y + 22 > buttonsTop - 12) return;
                ctx.fillText(m.strip ? fit(ctx, l, W - 88) : l, 44, y);
                y += n === 0 ? 52 : 46;
            }
        });

        boxes = [];
        if (bs.length) {
            let top = buttonsTop;
            for (let r = 0; r < rows; r++) {
                const row = bs.slice(r * 3, r * 3 + 3);
                const bw = (W - 80 - gap * (row.length - 1)) / row.length;
                row.forEach((b, k) => {
                    const x = 40 + k * (bw + gap), hot = m.hover === b.id;
                    roundRect(ctx, x, top, bw, bh, 22);
                    ctx.fillStyle = b.primary ? (hot ? '#ffd27a' : GOLD) : (hot ? 'rgba(40, 80, 120, 0.98)' : 'rgba(18, 38, 66, 0.96)');
                    ctx.fill();
                    ctx.lineWidth = hot ? 6 : 3; ctx.strokeStyle = b.primary ? (hot ? '#fff3cf' : '#ffe2a0') : (hot ? '#ffffff' : CYAN); ctx.stroke();
                    ctx.font = `800 ${b.label.length > 12 ? 34 : 40}px ${font}`;
                    ctx.textAlign = 'center'; ctx.fillStyle = b.primary ? '#1a1206' : INK;
                    ctx.fillText(fit(ctx, b.label, bw - 24), x + bw / 2, top + bh / 2 + 2);
                    ctx.textAlign = 'left';
                    boxes.push({ id: b.id, x, y: top, w: bw, h: bh });
                });
                top += bh + gap;
            }
        }
    }

    // Where it stands: past the far edge, leaning back to face the player;
    // lower as a strip, so the run's clock sits just over the board.
    function place() {
        const k = strip ? STRIP / H : 1;
        mesh.scale.set(1, k, 1);
        tex.repeat.set(1, k);
        tex.offset.set(0, 1 - k);
        mesh.position.set(0, strip ? 1.7 : 3.9, -levelD / 2 - 0.9);
        mesh.rotation.set(-0.35, 0, 0);
    }

    return {
        mesh,
        // Draw `model` ({ title, coins, clock, lines, buttons: [{ id, label,
        // primary }], hover, strip }); a model like the last draws nothing.
        update(model) {
            const s = JSON.stringify(model);
            if (s === sig) return false;
            sig = s;
            if (strip !== !!model.strip) { strip = !!model.strip; place(); }
            draw(model);
            tex.needsUpdate = true;
            return true;
        },
        // Stand it at this level's far edge.
        setLevel(lv) { levelD = lv ? lv.size.d : 14; place(); },
        // The button under a ray's hit (its uv on the plane), or null.
        buttonAt(uv) {
            if (!uv) return null;
            const k = strip ? STRIP / H : 1;
            const px = uv.x * W, py = (1 - (uv.y * k + (1 - k))) * H;
            const b = boxes.find(o => px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h);
            return b ? b.id : null;
        },
        boxes: () => boxes.map(b => ({ ...b })),
        // A button's centre in level space (tests aim a controller at it).
        pointOf(id) {
            const b = boxes.find(o => o.id === id);
            if (!b) return null;
            const k = strip ? STRIP / H : 1;
            const u = (b.x + b.w / 2) / W, v = ((1 - (b.y + b.h / 2) / H) - (1 - k)) / k;
            const p = new THREE.Vector3((u - 0.5) * PANEL_W, (v - 0.5) * PANEL_W * H / W, 0);
            mesh.updateWorldMatrix(true, false);
            return mesh.localToWorld(p);
        },
        dispose() { geo.dispose(); mat.dispose(); tex.dispose(); }
    };
}
