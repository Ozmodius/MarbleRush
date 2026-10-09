#!/usr/bin/env node
// STORE ART for CrazyGames: cover images and gameplay videos, rendered from
// the real game (not mock-ups), so what a player sees in the listing is what
// they get.
//
//   node scripts/marketing/capture.cjs covers   -> marketing/cover-*.png
//   node scripts/marketing/capture.cjs video    -> marketing/video-*.mp4
//   node scripts/marketing/capture.cjs landing  -> landing/*.jpg (the web site)
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
// CAPTURE_SCALE=0.3 renders a short preview of each video segment.
const SCALE = Number(process.env.CAPTURE_SCALE) || 1;

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
    // FROZEN: install() alone lets the page's clock run at real speed, and
    // then the game's own frame loop steps the physics during every slow
    // frame render -- uncontrolled motion that jammed the marble in big
    // captures but not tiny ones. Paused, time moves only by runFor and the
    // autopilot's own steps, so a capture is the same at any size.
    await page.clock.pauseAt(Date.now() + 1000);
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
        skins: ['plain', 'stripe', 'swirl', 'checker', 'eight', 'earth', 'galaxy', 'ember', 'prism'], skin,
        trails: ['none', 'comet', 'mint', 'flame', 'rainbow', 'gold', 'aurora'], trail, ballCam, explorer: ['compass']
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
function makePilot(route, speed = 1.7) {
    // Pure pursuit: aim at a point LOOKAHEAD along the route past the ball's
    // place on it, so corners are taken as smooth curves, not snapped to.
    // Short enough that the aim point is never round a corner behind a wall
    // (a longer one pinned the ball into corners). If the ball stalls anyway,
    // aim right back onto the route for a moment.
    const LOOKAHEAD = 0.5;
    let seg = 0, slow = 0, recover = 0;
    const along = (p) => {
        let best = { d: Infinity, i: seg, t: 0 };
        for (let i = seg; i < Math.min(route.length - 1, seg + 4); i++) {
            const a = route[i], b = route[i + 1];
            const ax = b.x - a.x, az = b.z - a.z, L2 = ax * ax + az * az || 1;
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * ax + (p.z - a.z) * az) / L2));
            const d = Math.hypot(a.x + ax * t - p.x, a.z + az * t - p.z);
            if (d < best.d) best = { d, i, t };
        }
        seg = best.i;
        return best;
    };
    const ahead = (i, t, dist) => {
        let a = route[i], b = route[i + 1];
        let left = Math.hypot(b.x - a.x, b.z - a.z) * (1 - t);
        let x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        while (dist > left && i < route.length - 2) {
            dist -= left; i++; a = route[i]; b = route[i + 1];
            x = a.x; z = a.z; left = Math.hypot(b.x - a.x, b.z - a.z);
        }
        const L = Math.hypot(b.x - x, b.z - z) || 1, k = Math.min(1, dist / L);
        return { x: x + (b.x - x) * k, z: z + (b.z - z) * k };
    };
    return async (dbg, pos, vel) => {
        const pr = along(pos);
        const sp0 = Math.hypot(vel.x, vel.z);
        slow = sp0 < 0.3 ? slow + 1 : 0;
        if (slow > 8) { recover = 20; slow = 0; }
        if (recover > 0) recover--;
        const t = ahead(pr.i, pr.t, recover > 0 ? 0.12 : LOOKAHEAD);
        const goal = route[route.length - 1];
        const toGoal = Math.hypot(goal.x - pos.x, goal.z - pos.z);
        const dx = t.x - pos.x, dz = t.z - pos.z, d = Math.hypot(dx, dz) || 1;
        const sp = Math.min(speed, toGoal * 1.5 + 0.4);
        const vx = dx / d * sp, vz = dz / d * sp;
        const ex = vx - vel.x, ez = vz - vel.z;
        // Gentle tilt: a steady lean, not a twitch.
        const deg = v => Math.max(-18, Math.min(18, v * 6));
        return { gamma: deg(ex), beta: deg(ez), aim: { x: vx, z: vz }, done: toGoal < 0.2, recovering: recover > 0 };
    };
}

// Run a level for `seconds` (or until it is won), calling shoot(i, state) per
// frame. Returns how many frames were written.
async function runLevel(page, dbg, id, seconds, shoot, { blend = 0.25 } = {}) {
    const lv = LEVELS.find(l => l.id === id);
    const route = planRoute(lv);
    await dbg('startLevelForTest', id);
    await page.evaluate(() => document.getElementById('mazeStartBtn').click());
    for (let k = 0; k < 40 && (await dbg('phase')) !== 'running'; k++) await page.clock.runFor(50);
    await dbg('simulate', 0, 0, 2, DT);           // the first reading is the neutral
    const pilot = makePilot(route);
    let pos = await dbg('advanceFrames', 1, DT), last = pos, vel = { x: 0, z: 0 };
    const frames = Math.round(seconds * FPS);
    let i = 0, wonAt = -1, stalled = 0;
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
            // Hold the line firmly against arms, magnets and kicks, and push
            // through harder while recovering from a stall.
            }, [cmd.aim, cmd.recovering ? 0.6 : blend]);
        } else {
            pos = await dbg('advanceFrames', 1, DT);
        }
        vel = { x: (pos.x - last.x) / (DT / 1000), z: (pos.z - last.z) / (DT / 1000) };
        if (ph === 'running' && Math.hypot(vel.x, vel.z) < 0.15) stalled++;
        last = pos;
        await shoot(i, { pos, vel, lv, phase: ph });
        if (wonAt >= 0 && i - wonAt > FPS * 1.2) { i++; break; }
    }
    return { frames: i, lv, won: wonAt >= 0, stalls: stalled };
}

// A follow camera square to the board (it never turns, so it never swings):
// south of the ball and above it, looking down steeply enough that the floor
// fills the frame, centred on the ball and kept over the board.
function makeChaseCam({ back = 2.2, up = 4.2, lv } = {}) {
    let cam = null;
    const mx = lv ? lv.size.w / 2 - 1.1 : 99, mz = lv ? lv.size.d / 2 - 0.5 : 99;
    return (pos) => {
        const x = Math.max(-mx, Math.min(mx, pos.x)), z = Math.max(-mz, Math.min(mz, pos.z));
        const want = { px: x, py: up, pz: z + back, lx: x, ly: 0, lz: z };
        if (!cam) cam = { ...want };
        for (const key of Object.keys(want)) cam[key] += (want[key] - cam[key]) * 0.12;
        return { ...cam };
    };
}

// --- covers -------------------------------------------------------------------------
// A high, raking view across the board toward the ball: walls stand up,
// the floor reads, the trail streams behind.
const raking = (dist, height, side) => (pos, vel) => {
    const sp = Math.hypot(vel.x, vel.z) || 1;
    const dx = vel.x / sp, dz = vel.z / sp;
    return { px: pos.x - dx * dist + dz * side, py: pos.y + height, pz: pos.z - dz * dist - dx * side, lx: pos.x + dx * 0.9, ly: 0, lz: pos.z + dz * 0.9 };
};
// For a wide frame of a long, narrow board: a camera that stays near the
// board's middle (x pulled toward 0 by `k`), `back` behind the ball and
// `height` up, looking down the maze -- the board fills the frame.
const over = (height, back, k, ahead = 1.2) => (pos) => ({
    px: pos.x * k, py: pos.y + height, pz: pos.z - back, lx: pos.x * (k + 1) / 2, ly: 0, lz: pos.z + ahead
});

// A rendered scene, then the PlaneTilt wordmark over it (the same CSS logo as
// the home screen), screenshotted at the exact size.
async function cover(browser, base, { name, width, height, level, skin, trail, at, cam, logo, out }) {
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
    await p2.screenshot(out ? { path: out, type: 'jpeg', quality: 93 } : { path: path.join(OUT, `${name}.png`) });
    await p2.close();
    console.log('wrote', out ? path.relative(ROOT, out) : `marketing/${name}.png`);
}

// The cover scene, per shape: wide frames look down the maze from over the
// board's middle; tall and square ones rake across it toward the ball.
const COVER_SCENE = { level: 'w3_10', skin: 'ember', trail: 'flame', at: 3.0 };
const COVER_SHOT = {
    landscape: { ...COVER_SCENE, at: 4.2, cam: over(3.2, 2.6, 0.3), logo: 'left' },   // 4.2 s: the marble out in the open
    tall: { ...COVER_SCENE, cam: raking(1.6, 5.0, 0.5), logo: 'top' }
};

async function covers(browser, base) {
    const lv = id => LEVELS.find(l => l.id === id);
    void lv;
    const only = process.argv[3];
    // One scene for all three (CrazyGames: covers should look alike so the
    // game is recognised in any format): Magma Works, the ember marble with
    // its flame trail, framed for each shape.
    let jobs = [
        { name: 'cover-landscape-1920x1080', width: 1920, height: 1080, ...COVER_SHOT.landscape },
        { name: 'cover-portrait-800x1200', width: 800, height: 1200, ...COVER_SHOT.tall },
        { name: 'cover-square-800x800', width: 800, height: 800, ...COVER_SHOT.tall }
    ];
    // COVER_JOBS='[{"name":..,"width":..,"height":..,"level":..,"skin":..,"trail":..,"at":..,"rk":[dist,height,side],"logo":..}]'
    // renders candidate framings instead (for choosing a shot).
    if (process.env.COVER_JOBS) jobs = JSON.parse(process.env.COVER_JOBS).map(j => ({ ...j, cam: j.over ? over(...j.over) : raking(...j.rk) }));
    for (const j of jobs) if (!only || j.name.includes(only)) await cover(browser, base, j);
}

// --- the landing site (landing/, index.html's LANDING) ----------------------------------
// The promotional site's pictures: each world at its level 10, a hero, an
// Explore shot from inside a maze, and phone shots of the menus. JPEGs sized
// for the web (the site is the first thing a new player downloads).
const LANDING = path.join(ROOT, 'landing');
async function landingScene(browser, base, { name, width, height, level, skin, trail, at, cam }) {
    const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor({ skin, trail }) });
    let state = null;
    await runLevel(page, dbg, level, at, async (i, s) => { state = s; }, {});
    await dbg('cameraOverride', cam(state.pos, state.vel));
    const url = await dbg('snapshot', 'image/jpeg', 0.82);
    fs.writeFileSync(path.join(LANDING, name + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
    await page.close();
    console.log('wrote', `landing/${name}.jpg`);
}
async function landingExplore(browser, base, { name, width, height, level }) {
    const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor({ skin: 'earth', trail: 'mint' }) });
    await dbg('walkLevel', level);
    await page.evaluate(() => document.getElementById('mazeStartBtn').click());
    for (let k = 0; k < 40 && (await dbg('phase')) !== 'running'; k++) await page.clock.runFor(50);
    await dbg('walkMove', { fwd: 1 });
    await dbg('advanceFrames', 45, DT);
    await dbg('walkMove', null);
    await dbg('advanceFrames', 20, DT);
    const url = await dbg('snapshot', 'image/jpeg', 0.82);
    fs.writeFileSync(path.join(LANDING, name + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
    await page.close();
    console.log('wrote', `landing/${name}.jpg`);
}
// Phone screenshots of the menus, on a real clock (the HTML is what matters).
async function landingPhone(browser, base, { name, setup }) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on('pageerror', e => console.error('[page]', e.message));
    await page.addInitScript((s) => { localStorage.setItem('marbleRush.progress.v1', JSON.stringify(s)); }, saveFor({ skin: 'galaxy', trail: 'rainbow' }));
    await page.goto(base);
    await page.waitForSelector('#homeView', { state: 'visible', timeout: 30000 });
    for (const id of ['#levelOkBtn', '#rewardsCloseBtn']) if (await page.isVisible(id)) await page.tap(id);
    await setup(page);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(LANDING, name + '.jpg'), type: 'jpeg', quality: 80 });
    await page.close();
    console.log('wrote', `landing/${name}.jpg`);
}
async function landing(browser, base) {
    fs.mkdirSync(LANDING, { recursive: true });
    const raking = (dist, height, side) => (pos, vel) => {
        const sp = Math.hypot(vel.x, vel.z) || 1;
        const dx = vel.x / sp, dz = vel.z / sp;
        return { px: pos.x - dx * dist + dz * side, py: pos.y + height, pz: pos.z - dz * dist - dx * side, lx: pos.x + dx * 0.9, ly: 0, lz: pos.z + dz * 0.9 };
    };
    const only = process.argv[3];
    const scenes = [
        { name: 'hero', width: 1600, height: 900, level: 'w3_10', skin: 'ember', trail: 'flame', at: 3.0, cam: raking(2.4, 4.0, 1.4) },
        { name: 'world-1', width: 960, height: 640, level: 'w1_10', skin: 'stripe', trail: 'comet', at: 3.4, cam: raking(2.2, 4.0, 1.0) },
        { name: 'world-2', width: 960, height: 640, level: 'w2_10', skin: 'earth', trail: 'mint', at: 3.4, cam: raking(2.2, 4.0, 1.0) },
        { name: 'world-3', width: 960, height: 640, level: 'w3_10', skin: 'ember', trail: 'flame', at: 4.2, cam: raking(2.2, 4.0, -1.0) },
        { name: 'world-4', width: 960, height: 640, level: 'w4_10', skin: 'galaxy', trail: 'rainbow', at: 3.4, cam: raking(2.2, 4.0, 1.0) },
        { name: 'world-5', width: 960, height: 640, level: 'w5_10', skin: 'checker', trail: 'gold', at: 3.4, cam: raking(2.2, 4.0, 1.0) }
    ];
    for (const j of scenes) if (!only || j.name === only) await landingScene(browser, base, j);
    if (!only || only === 'explore') await landingExplore(browser, base, { name: 'explore', width: 960, height: 640, level: 'w2_04' });
    const phones = [
        { name: 'phone-home', setup: async () => {} },
        { name: 'phone-gear', setup: async (p) => { await p.tap('#tab_gear'); await p.waitForSelector('#profileView', { state: 'visible' }); } },
        { name: 'phone-rewards', setup: async (p) => { await p.tap('#homeRewardsBtn'); await p.tap('#rewardsTab_achievements'); } },
        { name: 'phone-worlds', setup: async (p) => { await p.tap('#tab_worlds'); await p.waitForSelector('#mazeSelect', { state: 'visible' }); } }
    ];
    for (const j of phones) if (!only || j.name === only) await landingPhone(browser, base, j);
}

// --- videos -------------------------------------------------------------------------
async function video(browser, base, { name, width, height, cinematic }) {
    // CAPTURE_TINY=1: render at a fifth of the size, to check motion quickly.
    if (process.env.CAPTURE_TINY) { width = Math.round(width / 5); height = Math.round(height / 5); name += '-tiny'; }
    // CrazyGames' preview video (2026-10-08 spec): at most 20 s, no audio,
    // opening on the static cover, then the most exciting moments. So: the
    // cover (0.8 s), four worlds at their level 10 -- ice, lava, toys,
    // foundry, every trap in play -- joined `skip` seconds in, where the
    // marble is already moving, each in a different marble and trail, then
    // the wordmark (1.6 s). About 18.4 s.
    //
    // Each piece is rendered into its own folder (TMP/<name>/p<k>) and the
    // video is assembled from them, so one clip can be redone alone:
    // CAPTURE_ONLY=2,3 re-renders just those pieces and keeps the rest. The
    // autopilot is not perfectly repeatable from run to run, so every clip's
    // speed is checked and a clip where the marble stops for 0.75 s or more
    // is reported as STALLED -- redo it before using the video.
    let segs = [
        { level: 'w2_10', skip: 1.2, seconds: 4.0, skin: 'prism', trail: 'aurora' },
        { level: 'w3_10', skip: 1.2, seconds: 4.0, skin: 'ember', trail: 'flame' },
        { level: 'w4_10', skip: 1.2, seconds: 4.0, skin: 'galaxy', trail: 'rainbow' },
        { level: 'w5_10', skip: 1.2, seconds: 4.0, skin: 'eight', trail: 'gold' }
    ];
    // VIDEO_SEGS='[{"level":..,"skip":..,"seconds":..,"skin":..,"trail":..}]' tries other clips.
    if (process.env.VIDEO_SEGS) segs = JSON.parse(process.env.VIDEO_SEGS);
    const pieces = ['cover', ...segs, 'end'];
    const only = process.env.CAPTURE_ONLY ? process.env.CAPTURE_ONLY.split(',').map(Number) : null;
    const dir = path.join(TMP, name);
    if (!only) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const dry = !!process.env.CAPTURE_DRY;
    const fresh = (k) => { const d = path.join(dir, 'p' + k); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d; };
    const frameName = (d, n) => path.join(d, `f${String(n).padStart(5, '0')}.jpg`);
    const hold = (d, file, count) => { for (let i = 0; i < count; i++) fs.copyFileSync(file, frameName(d, i)); };
    let stalled = [];

    for (let k = 0; k < pieces.length; k++) {
        if (only && !only.includes(k)) continue;
        const piece = pieces[k];
        const d = fresh(k);
        if (piece === 'cover') {
            const still = path.join(TMP, `${name}-cover.jpg`);
            await cover(browser, base, { name, width, height, ...(width > height ? COVER_SHOT.landscape : COVER_SHOT.tall), out: still });
            hold(d, still, Math.round(FPS * 0.8));
            continue;
        }
        if (piece === 'end') {
            // The wordmark on the solar system (no tagline: CrazyGames wants
            // no promotional text in the video).
            const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor() });
            await page.evaluate(() => document.getElementById('tab_worlds').click());
            await page.clock.runFor(300);
            const bg = path.join(TMP, `${name}-end.png`);
            await frameTo(dbg, bg, 'image/png');
            await page.close();
            const p2 = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
            await p2.goto(`${base}scripts/marketing/cover.html?bg=/__tmp/${path.basename(bg)}&logo=center&w=${width}&h=${height}`);
            await p2.waitForTimeout(400);
            // JPEG, like every other frame: the encoder reads the sequence as JPEG.
            const card = path.join(TMP, `${name}-endcard.jpg`);
            await p2.screenshot({ path: card, type: 'jpeg', quality: 93 });
            await p2.close();
            hold(d, card, Math.round(FPS * 1.6));
            continue;
        }
        const s = piece;
        const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor(s) });
        const lv = LEVELS.find(l => l.id === s.level);
        const chase = makeChaseCam(width > height ? { lv } : { back: 2.2, up: 6.6, lv });
        if (!cinematic) await dbg('cameraOverride', null);
        const skipFrames = Math.round(s.skip * FPS);
        const speeds = [];
        let n = 0;
        const res = await runLevel(page, dbg, s.level, s.skip + s.seconds * SCALE, async (i, st) => {
            if (i < skipFrames) return;
            speeds.push(Math.hypot(st.vel.x, st.vel.z));
            if (cinematic) await dbg('cameraOverride', chase(st.pos));
            if (!dry) await frameTo(dbg, frameName(d, n));
            n++;
        });
        await page.close();
        // The longest run of near-still frames in the clip itself.
        let run = 0, worst = 0;
        for (const v of speeds) { run = v < 0.4 ? run + 1 : 0; worst = Math.max(worst, run); }
        const bad = worst >= FPS * 0.75;
        if (bad) stalled.push(k);
        console.log(`  piece ${k} ${s.level}: ${n} frames${res.won ? ', won' : ''}, longest stop ${(worst / FPS).toFixed(2)} s${bad ? '  STALLED -- redo with CAPTURE_ONLY=' + k : ''}`);
        if (process.env.CAPTURE_SPEEDLOG) console.log('    speed per 0.25s:', speeds.filter((_, i) => i % Math.round(FPS / 4) === 0).map(v => v.toFixed(1)).join(' '));
    }

    if (dry) { console.log('dry run: no video written'); return; }
    // Assemble: every piece's frames, in order, into one numbered sequence.
    const all = path.join(dir, 'all');
    fs.rmSync(all, { recursive: true, force: true });
    fs.mkdirSync(all);
    let total = 0;
    for (let k = 0; k < pieces.length; k++) {
        const d = path.join(dir, 'p' + k);
        if (!fs.existsSync(d)) throw new Error(`piece ${k} was never rendered: run without CAPTURE_ONLY first`);
        for (const f of fs.readdirSync(d).sort()) { fs.linkSync(path.join(d, f), frameName(all, total)); total++; }
    }
    const out = path.join(OUT, `${name}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(all, 'f%05d.jpg'),
        '-vf', `scale=${width}:${height}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-maxrate', '6M', '-bufsize', '12M',
        '-movflags', '+faststart', '-an', out]);
    console.log('wrote', `marketing/${name}.mp4`, `(${(total / FPS).toFixed(1)}s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB)${stalled.length ? '  -- STALLED pieces: ' + stalled.join(',') : ''}`);
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
        if (what === 'landing') await landing(browser, base);
        if (what === 'video' || what === 'video-landscape') await video(browser, base, { name: 'video-landscape-1920x1080', width: 1920, height: 1080, cinematic: true });
        if (what === 'video' || what === 'video-portrait') await video(browser, base, { name: 'video-portrait-1080x1620', width: 1080, height: 1620, cinematic: true });
    } finally {
        await browser.close();
        server.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
