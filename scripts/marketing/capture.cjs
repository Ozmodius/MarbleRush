#!/usr/bin/env node
// STORE ART for CrazyGames: cover images and gameplay videos, rendered from
// the real game (not mock-ups), so what a player sees in the listing is what
// they get.
//
//   node scripts/marketing/capture.cjs covers   -> marketing/cover-*.png
//   node scripts/marketing/capture.cjs video    -> marketing/video-*.mp4
//
// How it works: the game runs in headless Chromium on a FROZEN clock (the
// page's own frame loop never fires), and this script advances the
// simulation one 30 fps frame at a time through the debug surface, rendering
// each frame with __mazeDebug.snapshot(). That keeps the motion smooth however
// slowly this machine renders. A route through each level is planned here
// (grid search clear of walls, holes and posts) and an autopilot follows it by
// TILTING -- the real steering path, so the board leans as it would in a
// player's hands -- with a little velocity blending to stay on the line.
// Cinematic shots use the debug camera override; the portrait video uses the
// game's own camera.
//
// Needs: npm install (three, cannon-es), Playwright with Chromium, ffmpeg.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'marketing');
const TMP = process.env.CAPTURE_TMP || path.join(require('os').tmpdir(), 'planetilt-capture');
const LEVELS = JSON.parse(fs.readFileSync(path.join(ROOT, 'mazeLevels.json'), 'utf8')).levels;
const FPS = 30, DT = 1000 / FPS;

// --- a static server for the repo ---------------------------------------------
function serve() {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
    return new Promise(res => {
        const s = http.createServer((req, rsp) => {
            const u = decodeURIComponent(req.url.split('?')[0]);
            let f = path.join(ROOT, u === '/' ? 'index.html' : u);
            if (u.startsWith('/__tmp/')) f = path.join(TMP, u.slice(7));
            if (!f.startsWith(ROOT) && !f.startsWith(TMP)) { rsp.writeHead(403); rsp.end(); return; }
            fs.readFile(f, (err, buf) => {
                if (err) { rsp.writeHead(404); rsp.end(); return; }
                rsp.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
                rsp.end(buf);
            });
        }).listen(0, '127.0.0.1', () => res(s));
    });
}

// --- route planning -------------------------------------------------------------
// A grid over the board; a cell is free if a ball (with margin) fits there,
// clear of walls, holes and posts. Breadth-first from start to goal, then
// pulled tight to straight runs between corners.
function planRoute(lv) {
    // Generous margins first; tighter levels get tighter ones.
    for (const [wm, hm, pm, grid] of [[1.2, 0.9, 1.15, 0.06], [1.08, 0.6, 1.02, 0.06], [1.02, 0.35, 1.0, 0.04], [1.0, 0.2, 1.0, 0.025]]) {
        try { return planRouteWith(lv, wm, hm, pm, grid); } catch (_) { /* try tighter */ }
    }
    throw new Error(`no route found for ${lv.id}`);
}
function planRouteWith(lv, wallM, holeM, postM, G) {
    const r = lv.ballRadius;
    const W = lv.size.w, D = lv.size.d;
    const nx = Math.ceil(W / G), nz = Math.ceil(D / G);
    const posts = (lv.bumpers || []).map(b => ({ x: b.x, z: b.z, r: (b.r || 0.18) + r * postM }));
    const free = (x, z) => {
        if (Math.abs(x) > W / 2 - r * 1.1 || Math.abs(z) > D / 2 - r * 1.1) return false;
        for (const w of lv.walls) if (Math.abs(x - w.x) < w.w / 2 + r * wallM && Math.abs(z - w.z) < w.d / 2 + r * wallM) return false;
        for (const h of lv.holes) if (Math.hypot(x - h.x, z - h.z) < h.r + r * holeM) return false;
        for (const p of posts) if (Math.hypot(x - p.x, z - p.z) < p.r) return false;
        return true;
    };
    const cx = i => -W / 2 + (i + 0.5) * G, cz = j => -D / 2 + (j + 0.5) * G;
    const ci = x => Math.max(0, Math.min(nx - 1, Math.floor((x + W / 2) / G)));
    const cj = z => Math.max(0, Math.min(nz - 1, Math.floor((z + D / 2) / G)));
    const ok = new Uint8Array(nx * nz);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) ok[i + j * nx] = free(cx(i), cz(j)) ? 1 : 0;
    const s = ci(lv.start.x) + cj(lv.start.z) * nx, g = ci(lv.goal.x) + cj(lv.goal.z) * nx;
    ok[s] = 1; ok[g] = 1;
    const prev = new Int32Array(nx * nz).fill(-1);
    prev[s] = s;
    const q = [s];
    for (let k = 0; k < q.length && prev[g] < 0; k++) {
        const c = q[k], i = c % nx, j = (c / nx) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const a = i + di, b = j + dj;
            if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
            const n = a + b * nx;
            if (!ok[n] || prev[n] >= 0) continue;
            if (di && dj && (!ok[a + j * nx] || !ok[i + b * nx])) continue;
            prev[n] = c; q.push(n);
        }
    }
    if (prev[g] < 0) throw new Error(`no route found for ${lv.id}`);
    const cells = [];
    for (let c = g; c !== s; c = prev[c]) cells.push(c);
    cells.push(s); cells.reverse();
    const pts = cells.map(c => ({ x: cx(c % nx), z: cz((c / nx) | 0) }));
    pts[0] = { x: lv.start.x, z: lv.start.z }; pts[pts.length - 1] = { x: lv.goal.x, z: lv.goal.z };
    // Pull tight: keep a point only when the straight line past it would leave free floor.
    const clear = (a, b) => {
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (G / 2));
        for (let k = 1; k < n; k++) { const t = k / n; if (!free(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; }
        return true;
    };
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
        let j = pts.length - 1;
        while (j > i + 1 && !clear(pts[i], pts[j])) j--;
        out.push(pts[j]); i = j;
    }
    return out;
}

// --- the page ---------------------------------------------------------------------
async function openGame(browser, base, { width, height, save }) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('pageerror', e => console.error('[page]', e.message));
    await page.addInitScript((s) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('marbleRush.progress.v1', JSON.stringify(s));
    }, save);
    await page.clock.install();
    await page.goto(base);
    for (let k = 0; k < 600 && !(await page.isVisible('#homeView')); k++) await page.clock.runFor(50);
    await page.clock.runFor(200);
    const dbg = (fn, ...a) => page.evaluate(([f, x]) => window.__mazeDebug[f](...x), [fn, a]);
    // The autopilot plans round walls, holes and posts but cannot time a
    // flare, icicle, crusher or rail, so captures are not ended by one.
    await dbg('captureNoKnockOut', true);
    return { page, dbg };
}

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A player well into the game: every level rolled, looks owned, the calendar
// and level-ups already seen (so no card covers the view), Heat Shield uses for
// the lava runs (flares cannot burn), and the given skin/trail on.
function saveFor({ skin = 'galaxy', trail = 'rainbow', ballCam = false } = {}) {
    const cleared = {};
    for (const l of LEVELS) cleared[l.id] = { bestMs: l.goldMs * 2, coins: 0 };
    return {
        v: 1, wallet: 2500, xp: 3000, highestIndex: LEVELS.length, cleared, goldClaimed: [], prizes: ['rubberCoat', 'heatShield'],
        prizeUses: { heatShield: 99, rubberCoat: 99 }, charges: {}, daily: { streak: 3, last: today() },
        skins: ['plain', 'stripe', 'swirl', 'checker', 'eight', 'earth', 'galaxy', 'ember'], skin,
        trails: ['none', 'comet', 'mint', 'flame', 'rainbow', 'gold'], trail, ballCam, explorer: ['compass']
    };
}

async function frameTo(dbg, file, type = 'image/jpeg') {
    const url = await dbg('snapshot', type, 0.93);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
}

// --- the autopilot ------------------------------------------------------------------
// Each frame: aim for the next waypoint at `speed`, tilt toward the velocity
// error (the real tilt path, so the board leans), and blend the ball's velocity
// a little toward the aim so the line holds through ice, fans and kicks.
function makePilot(route, speed = 2.6) {
    let k = 1;
    return async (dbg, pos, vel) => {
        while (k < route.length - 1 && Math.hypot(route[k].x - pos.x, route[k].z - pos.z) < 0.35) k++;
        const t = route[k];
        const dx = t.x - pos.x, dz = t.z - pos.z, d = Math.hypot(dx, dz) || 1;
        const sp = k === route.length - 1 ? Math.min(speed, d * 2.5 + 0.6) : speed;
        const vx = dx / d * sp, vz = dz / d * sp;
        const ex = vx - vel.x, ez = vz - vel.z;
        const deg = v => Math.max(-27, Math.min(27, v * 9));
        return { gamma: deg(ex), beta: deg(ez), aim: { x: vx, z: vz }, done: k >= route.length - 1 && d < 0.2 };
    };
}

// Run a level for `seconds` (or until it is won), calling shoot(i, state) per
// frame. Returns how many frames were written.
async function runLevel(page, dbg, id, seconds, shoot, { blend = 0.18 } = {}) {
    const lv = LEVELS.find(l => l.id === id);
    const route = planRoute(lv);
    await dbg('startLevelForTest', id);
    await page.evaluate(() => document.getElementById('mazeStartBtn').click());
    for (let k = 0; k < 40 && (await dbg('phase')) !== 'running'; k++) await page.clock.runFor(50);
    await dbg('simulate', 0, 0, 2, DT);           // the first reading is the neutral
    const pilot = makePilot(route);
    let pos = await dbg('advanceFrames', 1, DT), last = pos, vel = { x: 0, z: 0 };
    const frames = Math.round(seconds * FPS);
    let i = 0, wonAt = -1;
    for (; i < frames; i++) {
        const ph = await dbg('phase');
        if (ph === 'won' && wonAt < 0) wonAt = i;
        if (ph === 'running') {
            const cmd = await pilot(dbg, pos, vel);
            pos = await dbg('simulate', cmd.beta, cmd.gamma, 1, DT);
            await page.evaluate(([a, b]) => {
                const d = window.__mazeDebug;
                // blend toward the aim (no-op once the run has ended)
                return d.setBallVelocityBlend ? d.setBallVelocityBlend(a.x, a.z, b) : null;
            }, [cmd.aim, blend]);
        } else {
            pos = await dbg('advanceFrames', 1, DT);
        }
        vel = { x: (pos.x - last.x) / (DT / 1000), z: (pos.z - last.z) / (DT / 1000) };
        last = pos;
        await shoot(i, { pos, vel, lv, phase: ph });
        if (wonAt >= 0 && i - wonAt > FPS * 1.2) { i++; break; }
    }
    return { frames: i, lv, won: wonAt >= 0 };
}

// A chase camera: behind and above the ball, looking ahead along its way,
// eased so it glides.
function makeChaseCam({ back = 2.4, up = 2.6, ahead = 1.4 } = {}) {
    let cam = null, dir = { x: 0, z: 1 };
    return (pos, vel) => {
        const sp = Math.hypot(vel.x, vel.z);
        if (sp > 0.4) { const k = 0.06; dir = { x: dir.x + (vel.x / sp - dir.x) * k, z: dir.z + (vel.z / sp - dir.z) * k }; const n = Math.hypot(dir.x, dir.z) || 1; dir = { x: dir.x / n, z: dir.z / n }; }
        const want = { px: pos.x - dir.x * back, py: pos.y + up, pz: pos.z - dir.z * back, lx: pos.x + dir.x * ahead, ly: pos.y, lz: pos.z + dir.z * ahead };
        if (!cam) cam = want;
        for (const key of Object.keys(want)) cam[key] += (want[key] - cam[key]) * 0.12;
        return { ...cam };
    };
}

// --- covers -------------------------------------------------------------------------
// A rendered scene, then the PlaneTilt wordmark over it (the same CSS logo as
// the home screen), screenshotted at the exact size.
async function cover(browser, base, { name, width, height, level, skin, trail, at, cam, logo }) {
    const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor({ skin, trail }) });
    // Roll partway along the route so the trail is laid, then frame the shot.
    let state = null;
    const stopAt = Math.round(at * FPS);
    await runLevel(page, dbg, level, at, async (i, s) => { state = s; }, {});
    void stopAt;
    await dbg('cameraOverride', cam(state.pos, state.vel));
    const shot = path.join(TMP, `${name}-scene.png`);
    await frameTo(dbg, shot, 'image/png');
    await page.close();
    const p2 = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await p2.goto(`${base}scripts/marketing/cover.html?bg=/__tmp/${path.basename(shot)}&logo=${logo}&w=${width}&h=${height}`);
    await p2.waitForTimeout(400);
    await p2.screenshot({ path: path.join(OUT, `${name}.png`) });
    await p2.close();
    console.log('wrote', `marketing/${name}.png`);
}

async function covers(browser, base) {
    const lv = id => LEVELS.find(l => l.id === id);
    // A high, raking view across the board toward the ball: walls stand up,
    // the floor reads, the trail streams behind.
    const raking = (dist, height, side) => (pos, vel) => {
        const sp = Math.hypot(vel.x, vel.z) || 1;
        const dx = vel.x / sp, dz = vel.z / sp;
        return { px: pos.x - dx * dist + dz * side, py: pos.y + height, pz: pos.z - dz * dist - dx * side, lx: pos.x + dx * 0.9, ly: 0, lz: pos.z + dz * 0.9 };
    };
    void lv;
    const only = process.argv[3];
    const jobs = [
        { name: 'cover-landscape-1920x1080', width: 1920, height: 1080, level: 'w4_10', skin: 'galaxy', trail: 'rainbow', at: 3.4, cam: raking(2.6, 4.2, 1.6), logo: 'left' },
        { name: 'cover-portrait-800x1200', width: 800, height: 1200, level: 'w3_10', skin: 'ember', trail: 'flame', at: 3.0, cam: raking(1.6, 5.0, 0.5), logo: 'top' },
        { name: 'cover-square-800x800', width: 800, height: 800, level: 'w1_10', skin: 'stripe', trail: 'comet', at: 3.4, cam: raking(2.2, 4.4, 1.0), logo: 'top' }
    ];
    for (const j of jobs) if (!only || j.name.includes(only)) await cover(browser, base, j);
}

// --- videos -------------------------------------------------------------------------
async function video(browser, base, { name, width, height, cinematic }) {
    const dir = path.join(TMP, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    const put = async (dbg) => { await frameTo(dbg, path.join(dir, `f${String(n).padStart(5, '0')}.jpg`)); n++; };

    // Every world's level 10: where its blend has fully arrived and all three
    // of its traps are in play.
    const segs = [
        { level: 'w4_10', seconds: 4.0, skin: 'galaxy', trail: 'rainbow' },
        { level: 'w3_10', seconds: 3.5, skin: 'ember', trail: 'flame' },
        { level: 'w2_10', seconds: 3.5, skin: 'stripe', trail: 'comet' },
        { level: 'w5_10', seconds: 3.5, skin: 'eight', trail: 'gold' },
        { level: 'w1_10', seconds: 3.0, skin: 'earth', trail: 'mint' }
    ];
    for (const s of segs) {
        const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor(s) });
        const chase = makeChaseCam(width > height ? {} : { back: 1.6, up: 3.4, ahead: 1.0 });
        if (!cinematic) await dbg('cameraOverride', null);
        const res = await runLevel(page, dbg, s.level, s.seconds, async (i, st) => {
            if (cinematic) await dbg('cameraOverride', chase(st.pos, st.vel));
            await put(dbg);
        });
        console.log(`  ${s.level}: ${res.frames} frames${res.won ? ', won' : ''}`);
        await page.close();
    }

    // First person: walk the forest-blended workshop toward the exit.
    {
        const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor() });
        const lv = LEVELS.find(l => l.id === 'w1_10');
        const route = planRoute(lv);
        await dbg('walkLevel', lv.id);
        await page.evaluate(() => document.getElementById('mazeStartBtn').click());
        for (let k = 0; k < 40 && (await dbg('phase')) !== 'running'; k++) await page.clock.runFor(50);
        let k = 1;
        for (let i = 0; i < FPS * 3; i++) {
            const w = await dbg('walk');
            const p = { x: w.eye.x, z: w.eye.z };
            while (k < route.length - 1 && Math.hypot(route[k].x - p.x, route[k].z - p.z) < 0.4) k++;
            const t = route[k];
            const want = Math.atan2(-(t.x - p.x), -(t.z - p.z));
            let d = want - w.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
            await dbg('walkTurn', d * 0.12);
            await dbg('walkMove', Math.abs(d) < 0.9 ? { fwd: 1 } : null);
            await dbg('advanceFrames', 1, DT);
            await put(dbg);
        }
        await page.close();
    }

    // End card: the wordmark on the solar system, held for two seconds.
    {
        const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor() });
        await page.evaluate(() => document.getElementById('tab_worlds').click());
        await page.clock.runFor(300);
        const bg = path.join(TMP, `${name}-end.png`);
        await frameTo(dbg, bg, 'image/png');
        await page.close();
        const p2 = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        await p2.goto(`${base}scripts/marketing/cover.html?bg=/__tmp/${path.basename(bg)}&logo=center&tag=1&w=${width}&h=${height}`);
        await p2.waitForTimeout(400);
        const card = path.join(dir, 'endcard.png');
        await p2.screenshot({ path: card });
        await p2.close();
        for (let i = 0; i < FPS * 2.2; i++) { fs.copyFileSync(card, path.join(dir, `f${String(n).padStart(5, '0')}.jpg`)); n++; }
    }

    const out = path.join(OUT, `${name}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%05d.jpg'),
        '-vf', `scale=${width}:${height}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
        '-movflags', '+faststart', '-an', out]);
    console.log('wrote', `marketing/${name}.mp4`, `(${(n / FPS).toFixed(1)}s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
}

(async () => {
    const what = process.argv[2] || 'covers';
    if (what === 'route') {
        for (const id of process.argv.slice(3)) {
            try { const rt = planRoute(LEVELS.find(l => l.id === id)); console.log(id, rt.length, 'points'); } catch (e) { console.log(id, e.message); }
        }
        return;
    }
    fs.mkdirSync(OUT, { recursive: true });
    fs.mkdirSync(TMP, { recursive: true });
    const server = await serve();
    const base = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        if (what === 'covers') await covers(browser, base);
        if (what === 'video' || what === 'video-landscape') await video(browser, base, { name: 'video-landscape-1920x1080', width: 1920, height: 1080, cinematic: true });
        if (what === 'video' || what === 'video-portrait') await video(browser, base, { name: 'video-portrait-1080x1920', width: 1080, height: 1920, cinematic: false });
    } finally {
        await browser.close();
        server.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
