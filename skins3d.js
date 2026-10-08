import * as THREE from 'three';

// MARBLE SKINS (shopCatalog.js SKINS): each is a pattern painted on a canvas in
// equirectangular layout -- the way THREE.SphereGeometry lays out its UVs, x
// round the equator, y pole to pole -- so one drawing serves the 3D marble
// (as its colour map) and the Gear page's swatch (as a CSS background).
//
// Looks only: a skin replaces the marble's COLOURS and nothing else. The
// material keeps the marble's own roughness and metalness, so a Steel marble
// in Galaxy still shines like steel, and every stat is the marble's.
//
// Patterns are seeded, so a skin looks the same every time it is drawn.

const W = 512, H = 256;

function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Draw a shape at x and again at x +/- W, so anything crossing the seam at the
// back of the marble continues round instead of being cut off.
function wrap(x, fn) { fn(x); fn(x - W); fn(x + W); }

const PAINT = {
    stripe(g) {
        g.fillStyle = '#f4f1ea';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#d8342c';
        g.fillRect(0, H * 0.4, W, H * 0.2);
        g.fillStyle = '#1d3f8f';
        g.fillRect(0, H * 0.36, W, H * 0.025);
        g.fillRect(0, H * 0.615, W, H * 0.025);
    },
    swirl(g) {
        // A clear, faintly blue glass with a twisted ribbon of colour: drawn as
        // sine bands round the equator.
        const bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#d9f1fb'); bg.addColorStop(0.5, '#eefaff'); bg.addColorStop(1, '#cbe8f5');
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
        const bands = [['#e8452c', 0, 0.18], ['#f2b32a', 1.6, 0.13], ['#2d7fd6', 3.3, 0.16], ['#2fa868', 4.7, 0.11]];
        for (const [col, ph, amp] of bands) {
            g.beginPath();
            for (let x = 0; x <= W; x += 4) {
                const y = H * (0.5 + amp * Math.sin((x / W) * Math.PI * 4 + ph));
                if (x === 0) g.moveTo(x, y - 7); else g.lineTo(x, y - 7);
            }
            for (let x = W; x >= 0; x -= 4) g.lineTo(x, H * (0.5 + amp * Math.sin((x / W) * Math.PI * 4 + ph)) + 7);
            g.closePath();
            g.fillStyle = col;
            g.fill();
        }
    },
    checker(g) {
        const nx = 12, ny = 6;
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
            g.fillStyle = (i + j) % 2 ? '#f6e7c8' : '#ea7b22';
            g.fillRect(i * W / nx, j * H / ny, W / nx + 1, H / ny + 1);
        }
    },
    eight(g) {
        g.fillStyle = '#111114';
        g.fillRect(0, 0, W, H);
        const cx = W * 0.5, cy = H * 0.5, r = H * 0.2;
        g.fillStyle = '#f7f5ee';
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111114';
        g.font = `900 ${Math.round(r * 1.45)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('8', cx, cy + r * 0.06);
    },
    earth(g) {
        const rand = rng(7);
        g.fillStyle = '#1d5fae';
        g.fillRect(0, 0, W, H);
        // Continents: clusters of overlapping blobs, kept off the poles.
        for (let c = 0; c < 6; c++) {
            const x0 = rand() * W, y0 = H * (0.25 + rand() * 0.5);
            for (let k = 0; k < 14; k++) {
                const x = x0 + (rand() - 0.5) * 90, y = y0 + (rand() - 0.5) * 50, r = 8 + rand() * 20;
                g.fillStyle = rand() < 0.75 ? '#3f9a45' : '#a98c4e';
                wrap(x, xx => { g.beginPath(); g.arc(xx, y, r, 0, Math.PI * 2); g.fill(); });
            }
        }
        g.fillStyle = '#f2f6f8';
        g.fillRect(0, 0, W, H * 0.09);
        g.fillRect(0, H * 0.91, W, H * 0.09);
    },
    galaxy(g) {
        const rand = rng(11);
        g.fillStyle = '#0d0820';
        g.fillRect(0, 0, W, H);
        for (const [col, n] of [['rgba(176, 64, 214, 0.35)', 6], ['rgba(56, 120, 230, 0.32)', 6], ['rgba(240, 90, 160, 0.25)', 4]]) {
            for (let k = 0; k < n; k++) {
                const x = rand() * W, y = H * (0.2 + rand() * 0.6), r = 40 + rand() * 70;
                wrap(x, xx => {
                    const gr = g.createRadialGradient(xx, y, 0, xx, y, r);
                    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    g.fillStyle = gr;
                    g.fillRect(xx - r, y - r, r * 2, r * 2);
                });
            }
        }
        for (let k = 0; k < 900; k++) {
            const a = rand();
            g.fillStyle = `rgba(255, 255, 255, ${0.35 + a * 0.65})`;
            const s = a > 0.97 ? 2 : 1;
            g.fillRect(rand() * W, rand() * H, s, s);
        }
    },
    prism(g) {
        // Cut glass: rows of triangles, each a pale facet of one hue, the hues
        // sweeping round the marble so every turn shows a new colour; a bright
        // edge where facets meet.
        const rand = rng(31);
        const nx = 16, ny = 6, cw = W / nx, ch = H / ny;
        g.lineWidth = 1.5;
        g.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        g.lineJoin = 'round';
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (const up of [true, false]) {
            const hue = Math.round(((i + (up ? 0 : 0.5)) / nx) * 360 + rand() * 30) % 360;
            g.fillStyle = `hsl(${hue}, 85%, ${Math.round(62 + rand() * 22)}%)`;
            const x = i * cw, y = j * ch;
            const tri = up ? [[x, y + ch], [x + cw / 2, y], [x + cw, y + ch]] : [[x + cw / 2, y], [x + cw * 1.5, y], [x + cw, y + ch]];
            wrap(0, dx => {
                g.beginPath();
                tri.forEach(([px, py], k) => (k ? g.lineTo(px + dx, py) : g.moveTo(px + dx, py)));
                g.closePath();
                g.fill();
                g.stroke();
            });
        }
    },
    ember(g) {
        const rand = rng(23);
        g.fillStyle = '#17110f';
        g.fillRect(0, 0, W, H);
        // Cracks: random walks, drawn wide and dim then narrow and bright.
        const cracks = [];
        for (let c = 0; c < 26; c++) {
            const pts = [[rand() * W, H * (0.08 + rand() * 0.84)]];
            let ang = rand() * Math.PI * 2;
            for (let k = 0; k < 7; k++) {
                ang += (rand() - 0.5) * 1.4;
                const [x, y] = pts[pts.length - 1];
                pts.push([x + Math.cos(ang) * 22, Math.max(4, Math.min(H - 4, y + Math.sin(ang) * 16))]);
            }
            cracks.push(pts);
        }
        for (const [w, col] of [[7, 'rgba(255, 90, 20, 0.35)'], [3, '#ff8a1e'], [1.2, '#ffe08a']]) {
            g.strokeStyle = col;
            g.lineWidth = w;
            g.lineJoin = g.lineCap = 'round';
            for (const pts of cracks) wrap(0, dx => {
                g.beginPath();
                pts.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y) : g.moveTo(x + dx, y)));
                g.stroke();
            });
        }
    }
};

const canvases = new Map();
export function skinCanvas(id) {
    if (!PAINT[id]) return null;
    if (!canvases.has(id)) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        PAINT[id](c.getContext('2d'));
        canvases.set(id, c);
    }
    return canvases.get(id);
}

// For the Gear page: the drawing as a data URL (null for Plain).
const urls = new Map();
export function skinDataUrl(id) {
    const c = skinCanvas(id);
    if (!c) return null;
    if (!urls.has(id)) urls.set(id, c.toDataURL('image/png'));
    return urls.get(id);
}

// Paint `id` onto a marble material. Ember's cracks also glow (emissive map).
// The textures are shared and never disposed: a handful of 512x256 canvases.
const textures = new Map();
function textureFor(id) {
    if (!textures.has(id)) {
        const t = new THREE.CanvasTexture(skinCanvas(id));
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        textures.set(id, t);
    }
    return textures.get(id);
}
export function applySkin(material, id) {
    if (!material || !PAINT[id]) return material;
    const tex = textureFor(id);
    material.map = tex;
    material.color = new THREE.Color('#ffffff');
    if (id === 'ember') {
        material.emissiveMap = tex;
        material.emissive = new THREE.Color('#ff7a1a');
        material.emissiveIntensity = 0.9;
    }
    material.needsUpdate = true;
    return material;
}
