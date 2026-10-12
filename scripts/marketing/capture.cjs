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
function planRoute(lv) { return planLeg(lv, lv.start, lv.goal); }
// One leg, from a point to a point: generous margins first; tighter places
// get tighter ones.
function planLeg(lv, from, to) {
    for (const [wm, hm, pm, grid] of [[1.2, 0.9, 1.15, 0.06], [1.08, 0.6, 1.02, 0.06], [1.02, 0.35, 1.0, 0.04], [1.0, 0.2, 1.0, 0.025]]) {
        try { return planRouteWith(lv, wm, hm, pm, grid, from, to); } catch (_) { /* try tighter */ }
    }
    throw new Error(`no route found for ${lv.id}`);
}
const legLength = pts => pts.reduce((a, p, i) => i ? a + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0, 0);
// The way a player plays it: from the start to the nearest coin by the
// path (not as the crow flies), then the nearest from there, `coins` of
// them, then on to the exit -- so the marble picks coins up on camera.
function planPlayRoute(lv, coins = 6) {
    let at = { x: lv.start.x, z: lv.start.z };
    const left = (lv.coins || []).map(c => ({ x: c.x, z: c.z }));
    const route = [at];
    for (let n = 0; n < coins && left.length; n++) {
        let best = null;
        for (let i = 0; i < left.length; i++) {
            let leg = null;
            try { leg = planLeg(lv, at, left[i]); } catch (_) { continue; }
            const len = legLength(leg);
            if (!best || len < best.len) best = { i, leg, len };
        }
        if (!best) break;
        route.push(...best.leg.slice(1));
        at = left[best.i];
        left.splice(best.i, 1);
    }
    route.push(...planLeg(lv, at, lv.goal).slice(1));
    return route;
}
// A clip's worth of play: the stretch of the level where a few seconds of
// rolling picks up the most coins. Each coin is tried as the first; from it
// the nearest-by-path coins follow; the run joins `lead` units before that
// first coin (on its way from the start) so the marble is already rolling.
// -> { from, route } with `route` from `from` through the coins to the exit.
function planClip(lv, { window: win = [1.2, 9], lead = 2.0 } = {}) {
    const coins = (lv.coins || []).map(c => ({ x: c.x, z: c.z }));
    let best = null;
    for (let k = 0; k < coins.length; k++) {
        let toFirst;
        try { toFirst = planLeg(lv, lv.start, coins[k]); } catch (_) { continue; }
        // `lead` back along the way in.
        const pts = toFirst.slice().reverse();
        // (Walked back along the path's own corners, so the way in never
        // cuts through a wall.)
        let back = lead, from = pts[0], cut = 0;
        for (let i = 1; i < pts.length; i++) {
            const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
            cut = i;
            if (d >= back) { const t = back / d; from = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t }; back = 0; break; }
            back -= d; from = pts[i];
        }
        const route = [from, ...pts.slice(0, cut).reverse()];
        const stops = [{ ...coins[k], at: route.length - 1 }];
        // `got`: the coins whose distance along the way falls in the clip's
        // window (the skip, then four seconds at about 2 u/s).
        let at = coins[k], len = lead, got = lead >= win[0] && lead <= win[1] ? 1 : 0;
        const left = coins.filter((_, i) => i !== k);
        while (left.length) {
            let nb = null;
            for (let i = 0; i < left.length; i++) {
                let leg = null;
                try { leg = planLeg(lv, at, left[i]); } catch (_) { continue; }
                const l2 = legLength(leg);
                if (!nb || l2 < nb.len) nb = { i, leg, len: l2 };
            }
            if (!nb) break;
            route.push(...nb.leg.slice(1));
            len += nb.len;
            at = left[nb.i];
            stops.push({ ...at, at: route.length - 1 });
            left.splice(nb.i, 1);
            if (len >= win[0] && len <= win[1]) got++;
            if (len > win[1] * 1.5) break;
        }
        try { route.push(...planLeg(lv, at, lv.goal).slice(1)); } catch (_) { /* the clip ends long before */ }
        if (!best || got > best.got) best = { got, from, route, stops };
    }
    return best;
}
function planRouteWith(lv, wallM, holeM, postM, G, from = lv.start, to = lv.goal) {
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
    const s = ci(from.x) + cj(from.z) * nx, g = ci(to.x) + cj(to.z) * nx;
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
    pts[0] = { x: from.x, z: from.z }; pts[pts.length - 1] = { x: to.x, z: to.z };
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
// and level-ups already seen (so no card covers the view), the first friends
// freed (`rescued`: worlds; the rest still caged, so floor 10 shows a cage),
// fuel, survey and diary partway, and the given marble, skin and trail on.
// (Knock-outs are switched off by captureNoKnockOut, so no charge is needed.)
function saveFor({ skin = 'galaxy', trail = 'rainbow', ballCam = false, marble = 'classic', rescued = [1, 2] } = {}) {
    const cleared = {}, survey = {};
    for (const l of LEVELS) { cleared[l.id] = { bestMs: l.goldMs * 2, coins: 0 }; survey[l.id] = 74; }
    const friends = { 1: 'pip', 2: 'flurry', 3: 'cinder', 4: 'bobble', 5: 'rivet' };
    return {
        v: 2, wallet: 2500, xp: 3000, levelPaid: 99, highestIndex: LEVELS.length, cleared, goldClaimed: [], prizes: [], charges: { fireShield: 2, iceSkates: 1 },
        daily: { streak: 3, last: today(), doubled: '' },
        marbles: ['classic', 'steel', 'rubber', 'glass', ...rescued.map(w => friends[w])], marble,
        bond: { classic: 420, glass: 160 }, crew: { classic: 2, glass: 1 },
        skins: ['plain', 'stripe', 'swirl', 'checker', 'eight', 'earth', 'galaxy', 'ember', 'prism'], skin,
        trails: ['none', 'comet', 'mint', 'flame', 'rainbow', 'gold', 'aurora'], trail, ballCam, explorer: ['compass'],
        rescued, fuel: LEVELS.filter(l => /^w[12]_/.test(l.id)).map(l => l.id), survey, diary: ['w1_07', 'w2_04']
    };
}

// Is (x, z) clear floor for a ball of radius r (with room to spare)?
function clearAt(lv, x, z, m = 1.3) {
    const r = lv.ballRadius;
    if (Math.abs(x) > lv.size.w / 2 - r * m || Math.abs(z) > lv.size.d / 2 - r * m) return false;
    for (const w of lv.walls) if (Math.abs(x - w.x) < w.w / 2 + r * m && Math.abs(z - w.z) < w.d / 2 + r * m) return false;
    for (const h of lv.holes) if (Math.hypot(x - h.x, z - h.z) < h.r + r * m) return false;
    for (const b of lv.bumpers || []) if (Math.hypot(x - b.x, z - b.z) < (b.r || 0.18) + r * m) return false;
    return true;
}
// A clear spot `d` from (x, z) whose line to it is clear too, or null.
function besideOf(lv, x, z, dists = [0.75, 0.6, 0.9, 0.5, 1.1]) {
    for (const d of dists) for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        let ok = clearAt(lv, px, pz);
        for (let t = 0.2; ok && t < 0.6; t += 0.1) ok = clearAt(lv, px + (x - px) * t, pz + (z - pz) * t, 1.0);
        if (ok) return { x: px, z: pz };
    }
    return null;
}

// The capture's own clock (ms): the frozen page never runs its frame loop,
// so each frame steps the scenery (coins spin, a taken coin vanishes, lava
// pulses) by this before it is drawn.
let sceneryMs = 0;
async function frameTo(dbg, file, type = 'image/jpeg') {
    sceneryMs += DT;
    await dbg('tickScenery', sceneryMs);
    const url = await dbg('snapshot', type, 0.93);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
}

// --- the autopilot ------------------------------------------------------------------
// Each frame: aim for the next waypoint at `speed`, tilt toward the velocity
// error (the real tilt path, so the board leans), and blend the ball's velocity
// a little toward the aim so the line holds through ice, fans and kicks.
function makePilot(route, speed = 1.7, stops = []) {
    // Pure pursuit: aim at a point LOOKAHEAD along the route past the ball's
    // place on it, so corners are taken as smooth curves, not snapped to.
    // Short enough that the aim point is never round a corner behind a wall
    // (a longer one pinned the ball into corners). If the ball stalls anyway,
    // aim right back onto the route for a moment.
    const LOOKAHEAD = 0.5;
    let seg = 0, slow = 0, recover = 0;
    const along = (p) => {
        let best = { d: Infinity, i: seg, t: 0 };
        // Never past the next coin still to take: a way that doubles back
        // out of a dead end must not be skipped ahead along.
        const cap = stops.length && Number.isInteger(stops[0].at) ? stops[0].at : route.length - 1;
        for (let i = seg; i < Math.min(route.length - 1, seg + 4, Math.max(seg + 1, cap)); i++) {
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
        let t = ahead(pr.i, pr.t, recover > 0 ? 0.12 : LOOKAHEAD);
        // A coin on the way is gone over, not cut past: within reach of the
        // next one, aim straight at it until the marble is on it.
        while (stops.length && Math.hypot(stops[0].x - pos.x, stops[0].z - pos.z) < 0.12) stops.shift();
        if (stops.length && Math.hypot(stops[0].x - pos.x, stops[0].z - pos.z) < 0.9) t = stops[0];
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
async function runLevel(page, dbg, id, seconds, shoot, { blend = 0.25, coins = 6, clip = false } = {}) {
    const lv = LEVELS.find(l => l.id === id);
    // Coins on the way, as a player takes them (coins: 0 goes straight out);
    // a clip joins the run where a few seconds pick up the most coins.
    const plan = clip ? planClip(lv) : null;
    const route = plan ? plan.route : coins ? planPlayRoute(lv, coins) : planRoute(lv);
    await dbg('startLevelForTest', id);
    await page.evaluate(() => document.getElementById('mazeStartBtn').click());
    for (let k = 0; k < 40 && (await dbg('phase')) !== 'running'; k++) await page.clock.runFor(50);
    if (plan) await dbg('placeBall', plan.from.x, plan.from.z);
    await dbg('simulate', 0, 0, 2, DT);           // the first reading is the neutral
    const pilot = makePilot(route, clip ? 2.3 : 1.7, plan ? plan.stops.slice() : []);   // a clip rolls like a player in a hurry
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
// A camera in front of and above a spot (the start), looking up at the
// ship over it: `side` across, `back` toward the viewer, `up` high, aimed
// at height `look` over the spot.
const shipCam = (side, back, up, look) => (p) => ({ px: p.x + side, py: up, pz: p.z + back, lx: p.x, ly: look, lz: p.z });
// For a wide frame of a long, narrow board: a camera that stays near the
// board's middle (x pulled toward 0 by `k`), `back` behind the ball and
// `height` up, looking down the maze -- the board fills the frame.
const over = (height, back, k, ahead = 1.2) => (pos) => ({
    px: pos.x * k, py: pos.y + height, pz: pos.z - back, lx: pos.x * (k + 1) / 2, ly: 0, lz: pos.z + ahead
});

// A rendered scene, then the PlaneTilt wordmark over it (the same CSS logo as
// the home screen), screenshotted at the exact size.
async function cover(browser, base, { name, width, height, level, skin, trail, at, cam, logo, out, ship }) {
    const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor({ skin, trail }) });
    if (ship) {
        // Rolle's ship beaming the marble down onto a planet's first maze,
        // the show held at `ship.ms` (levelShow.js shipDrop).
        await dbg('startLevelForTest', level);
        await dbg('holdShow', ship.ms);
        await dbg('advanceFrames', 1, DT);
        const st = LEVELS.find(l => l.id === level).start;
        await dbg('cameraOverride', cam({ x: st.x, y: 0, z: st.z }));
    } else {
        // Roll partway along the route so the trail is laid, then frame the shot.
        let state = null;
        await runLevel(page, dbg, level, at, async (i, s) => { state = s; }, {});
        await dbg('cameraOverride', cam(state.pos, state.vel));
    }
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
const COVER_SCENE = { level: 'w4_10', skin: 'galaxy', trail: 'rainbow', at: 3.0 };
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
    if (process.env.COVER_JOBS) jobs = JSON.parse(process.env.COVER_JOBS).map(j => ({ ...j, cam: j.shipCam ? shipCam(...j.shipCam) : j.over ? over(...j.over) : raking(...j.rk) }));
    for (const j of jobs) if (!only || j.name.includes(only)) await cover(browser, base, j);
}

// --- the landing site (landing/, index.html's LANDING) ----------------------------------
// The promotional site's pictures: each world at its level 10, a hero, a
// friend's cage, Clear Sight on a secret pocket, an Explore shot from inside
// a maze, and phone shots of home, the Crew and the rewards. JPEGs sized
// for the web (the site is the first thing a new player downloads).
const LANDING = path.join(ROOT, 'landing');
async function landingScene(browser, base, { name, width, height, level, skin, trail, marble, at, cam }) {
    const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor({ skin, trail, marble }) });
    let state = null;
    await runLevel(page, dbg, level, at, async (i, s) => { state = s; }, {});
    await dbg('cameraOverride', cam(state.pos, state.vel));
    sceneryMs += DT; await dbg('tickScenery', sceneryMs);
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
    sceneryMs += DT; await dbg('tickScenery', sceneryMs);
    const url = await dbg('snapshot', 'image/jpeg', 0.82);
    fs.writeFileSync(path.join(LANDING, name + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
    await page.close();
    console.log('wrote', `landing/${name}.jpg`);
}
// Start a level and hold it still on its first running frame.
async function startStill(page, dbg, id) {
    await dbg('startLevelForTest', id);
    await page.evaluate(() => document.getElementById('mazeStartBtn').click());
    for (let k = 0; k < 40 && (await dbg('phase')) !== 'running'; k++) await page.clock.runFor(50);
    await dbg('advanceFrames', 2, DT);
}
// A camera behind `from`, looking past it at `at`.
function lookPast(from, at, { back = 1.5, up = 2.3, side = 0.5 } = {}) {
    const dx = at.x - from.x, dz = at.z - from.z, L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L;
    return { px: from.x - ux * back + uz * side, py: up, pz: from.z - uz * back - ux * side, lx: (from.x + at.x) / 2 + ux * 0.2, ly: 0, lz: (from.z + at.z) / 2 + uz * 0.2 };
}
// The rescue: Rolle rolling up to a friend's cage on a floor 10.
async function landingRescue(browser, base, { name, width, height, level }) {
    const lv = LEVELS.find(l => l.id === level);
    const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor({ skin: 'plain', trail: 'comet', rescued: [1, 2] }) });
    await startStill(page, dbg, level);
    const cage = await dbg('rescue');
    if (!cage) throw new Error(`${level}: no cage`);
    const at = besideOf(lv, cage.x, cage.z, [0.95, 0.8, 1.1, 0.65]);
    if (!at) throw new Error(`${level}: no clear spot by the cage`);
    await dbg('placeBall', at.x, at.z);
    await dbg('advanceFrames', 3, DT);
    await dbg('cameraOverride', lookPast(at, cage, { back: 2.0, up: 3.2, side: 1.1 }));
    sceneryMs += DT; await dbg('tickScenery', sceneryMs);
    const url = await dbg('snapshot', 'image/jpeg', 0.82);
    fs.writeFileSync(path.join(LANDING, name + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
    await page.close();
    console.log('wrote', `landing/${name}.jpg`);
}
// The mission: the marble rolling up to one of a level's objectives -- the
// exit, the fuel cell (in its dead end) or a friend's cage.
async function landingNear(browser, base, { name, width, height, level, target, skin = 'plain', trail = 'comet', marble = 'classic', dists, cam = {} }) {
    const lv = LEVELS.find(l => l.id === level);
    const save = { ...saveFor({ skin, trail, marble }), fuel: [] };
    const { page, dbg } = await openGame(browser, base, { width, height, save });
    await startStill(page, dbg, level);
    const t = target === 'exit' ? lv.goal : await dbg(target === 'cage' ? 'rescue' : 'fuel');
    if (!t) throw new Error(`${level}: no ${target}`);
    const at = besideOf(lv, t.x, t.z, dists);
    if (!at) throw new Error(`${level}: no clear spot by the ${target}`);
    await dbg('placeBall', at.x, at.z);
    await dbg('advanceFrames', 3, DT);
    await dbg('cameraOverride', lookPast(at, t, { back: 2.0, up: 3.2, side: 1.1, ...cam }));
    sceneryMs += DT; await dbg('tickScenery', sceneryMs);
    const url = await dbg('snapshot', 'image/jpeg', 0.82);
    fs.writeFileSync(path.join(LANDING, name + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
    await page.close();
    console.log('wrote', `landing/${name}.jpg`);
}
// Exploring: turn the view from `at` toward `to` (the yaw's sign is
// measured, not assumed).
async function faceToward(dbg, at, to) {
    const heading = (e) => Math.atan2(e.lx - e.x, e.lz - e.z);
    const want = Math.atan2(to.x - at.x, to.z - at.z);
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    for (let k = 0; k < 3; k++) {
        const e = (await dbg('walk')).eye;
        const d = wrap(want - heading(e));
        if (Math.abs(d) < 0.03) break;
        await dbg('walkTurn', d);
        await dbg('advanceFrames', 1, DT);
        const e2 = (await dbg('walk')).eye;
        if (Math.abs(wrap(want - heading(e2))) > Math.abs(d)) { await dbg('walkTurn', -2 * d); await dbg('advanceFrames', 1, DT); }
    }
}
// A fuel cell, found the only way there is: exploring the maze from inside
// (Explore mode), the marble turned to face it down its dead end.
async function landingExploreFuel(browser, base, { name, width, height, level, marble = 'pip', dists = [1.2, 1.0, 1.4, 0.8] }) {
    const lv = LEVELS.find(l => l.id === level);
    const { page, dbg } = await openGame(browser, base, { width, height, save: { ...saveFor({ skin: 'plain', trail: 'mint', marble }), fuel: [] } });
    await dbg('walkLevel', level);
    await page.evaluate(() => document.getElementById('mazeStartBtn').click());
    for (let k = 0; k < 40 && (await dbg('phase')) !== 'running'; k++) await page.clock.runFor(50);
    const cell = await dbg('fuel');
    if (!cell) throw new Error(`${level}: no fuel cell when exploring`);
    const at = besideOf(lv, cell.x, cell.z, dists);
    if (!at) throw new Error(`${level}: no clear spot by the cell`);
    await dbg('placeBall', at.x, at.z);
    await dbg('advanceFrames', 2, DT);
    await faceToward(dbg, at, cell);
    await dbg('advanceFrames', 20, DT);
    sceneryMs += DT; await dbg('tickScenery', sceneryMs);
    const url = await dbg('snapshot', 'image/jpeg', 0.82);
    fs.writeFileSync(path.join(LANDING, name + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
    await page.close();
    console.log('wrote', `landing/${name}.jpg`);
}
// The ship: Rolle's ship beaming the marble down onto a planet's first maze.
async function landingShip(browser, base, { name, width, height, level, at = 1300, cam = {} }) {
    const lv = LEVELS.find(l => l.id === level);
    const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor({ skin: 'plain', trail: 'comet' }) });
    await dbg('startLevelForTest', level);
    await dbg('holdShow', at);
    await dbg('advanceFrames', 1, DT);
    console.log('  show', JSON.stringify(await dbg('show')).slice(0, 300));
    const s = lv.start;
    const c = { back: 4.2, up: 4.6, side: 1.8, ...cam };
    await dbg('cameraOverride', { px: s.x + c.side, py: c.up, pz: s.z + c.back, lx: s.x, ly: 1.2, lz: s.z });
    sceneryMs += DT; await dbg('tickScenery', sceneryMs);
    const url = await dbg('snapshot', 'image/jpeg', 0.82);
    fs.writeFileSync(path.join(LANDING, name + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
    await page.close();
    console.log('wrote', `landing/${name}.jpg`);
}
// The secrets: exploring as Glint, Clear Sight showing a false wall, the
// diary page glowing in the pocket behind it (pockets are Explore-only).
async function landingSecrets(browser, base, { name, width, height, level }) {
    const lv = LEVELS.find(l => l.id === level);
    const { page, dbg } = await openGame(browser, base, { width, height, save: { ...saveFor({ skin: 'prism', trail: 'aurora', marble: 'glass' }), diary: [] } });
    await dbg('walkLevel', level);
    await page.evaluate(() => document.getElementById('mazeStartBtn').click());
    for (let k = 0; k < 40 && (await dbg('phase')) !== 'running'; k++) await page.clock.runFor(50);
    const pk = await dbg('pocket');
    if (!pk) throw new Error(`${level}: no pocket`);
    const w = pk.wall;
    // Stand on the open side of the false wall, away from the page.
    const away = { x: w.x + (w.x - pk.x), z: w.z + (w.z - pk.z) };
    const L = Math.hypot(away.x - w.x, away.z - w.z) || 1;
    let at = null;
    for (const d of [0.7, 0.55, 0.9, 0.45]) {
        const p = { x: w.x + (away.x - w.x) / L * d, z: w.z + (away.z - w.z) / L * d };
        if (clearAt(lv, p.x, p.z, 1.05)) { at = p; break; }
    }
    if (!at) at = besideOf(lv, w.x, w.z) || { x: lv.start.x, z: lv.start.z };
    // Back off further, facing the wall and the page beyond it.
    const L2 = Math.hypot(at.x - w.x, at.z - w.z) || 1;
    for (const d of [1.3, 1.1, 0.9]) { const p = { x: w.x + (at.x - w.x) / L2 * d, z: w.z + (at.z - w.z) / L2 * d }; if (clearAt(lv, p.x, p.z, 1.05)) { at = p; break; } }
    await dbg('placeBall', at.x, at.z);
    await dbg('advanceFrames', 2, DT);
    await faceToward(dbg, at, { x: pk.x, z: pk.z });
    await dbg('useSignature');
    await dbg('advanceFrames', 20, DT);
    sceneryMs += DT; await dbg('tickScenery', sceneryMs);
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
        { name: 'hero', width: 1600, height: 900, level: 'w3_10', skin: 'plain', trail: 'flame', at: 3.0, cam: raking(2.4, 4.0, 1.4) },
        { name: 'world-1', width: 960, height: 640, level: 'w1_10', skin: 'plain', trail: 'comet', at: 3.4, cam: raking(2.2, 4.0, 1.0) },
        { name: 'world-2', width: 960, height: 640, level: 'w2_10', skin: 'plain', trail: 'mint', marble: 'pip', at: 3.4, cam: raking(2.2, 4.0, 1.0) },
        { name: 'world-3', width: 960, height: 640, level: 'w3_10', skin: 'plain', trail: 'flame', marble: 'flurry', at: 4.2, cam: raking(2.2, 4.0, -1.0) },
        { name: 'world-4', width: 960, height: 640, level: 'w4_10', skin: 'plain', trail: 'rainbow', marble: 'steel', at: 3.4, cam: raking(2.2, 4.0, 1.0) },
        { name: 'world-5', width: 960, height: 640, level: 'w5_10', skin: 'plain', trail: 'gold', marble: 'glass', at: 3.4, cam: raking(2.2, 4.0, 1.0) }
    ];
    for (const j of scenes) if (!only || j.name === only) await landingScene(browser, base, j);
    if (!only || only === 'exit') await landingNear(browser, base, { name: 'exit', width: 960, height: 640, level: 'w1_06', target: 'exit', trail: 'comet', dists: [1.3, 1.1, 1.5, 0.9], cam: { back: 2.4, up: 3.6, side: 1.3 } });
    if (!only || only === 'fuel') await landingExploreFuel(browser, base, { name: 'fuel', width: 960, height: 640, level: 'w2_05' });
    if (!only || only === 'ship') await landingShip(browser, base, { name: 'ship', width: 960, height: 640, level: 'w2_01' });
    if (!only || only === 'rescue') await landingRescue(browser, base, { name: 'rescue', width: 960, height: 640, level: 'w3_10' });
    if (!only || only === 'secrets') await landingSecrets(browser, base, { name: 'secrets', width: 960, height: 640, level: 'w1_07' });
    if (!only || only === 'explore') await landingExplore(browser, base, { name: 'explore', width: 960, height: 640, level: 'w2_04' });
    const phones = [
        // Home on Sawturn, the first planet (a green world reads best).
        { name: 'phone-home', setup: async (p) => { for (let k = 0; k < 4; k++) { await p.tap('#homePrevWorld'); await p.waitForTimeout(700); } } },
        { name: 'phone-crew', setup: async (p) => { await p.tap('#tab_crew'); await p.waitForSelector('#crewView', { state: 'visible' }); } },
        { name: 'phone-rewards', setup: async (p) => { await p.tap('#homeRewardsBtn'); await p.tap('#rewardsTab_achievements'); } }
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
        { level: 'w2_10', skip: 0.5, seconds: 4.0, skin: 'prism', trail: 'aurora' },
        { level: 'w3_10', skip: 0.5, seconds: 4.0, skin: 'ember', trail: 'flame' },
        { level: 'w4_10', skip: 0.5, seconds: 4.0, skin: 'galaxy', trail: 'rainbow' },
        { level: 'w5_10', skip: 0.5, seconds: 4.0, skin: 'eight', trail: 'gold' }
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
            // The wordmark on the home planet (no tagline: CrazyGames wants
            // no promotional text in the video).
            const { page, dbg } = await openGame(browser, base, { width, height, save: saveFor() });
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
        let coinsAtSkip = null;
        const res = await runLevel(page, dbg, s.level, s.skip + s.seconds * SCALE, async (i, st) => {
            if (i < skipFrames) return;
            if (coinsAtSkip === null) coinsAtSkip = await dbg('coinsTaken');
            if (process.env.CAPTURE_DEBUG && i % 6 === 0) { const nc = Math.min(...(lv.coins || []).map(c => Math.hypot(c.x - st.pos.x, c.z - st.pos.z))); console.log(`    f${i} (${st.pos.x.toFixed(2)}, ${st.pos.z.toFixed(2)}) coins ${await dbg('coinsTaken')} nearest ${nc.toFixed(2)} phase ${st.phase}`); }
            speeds.push(Math.hypot(st.vel.x, st.vel.z));
            if (cinematic) await dbg('cameraOverride', chase(st.pos));
            if (!dry) await frameTo(dbg, frameName(d, n));
            n++;
        }, { clip: true });
        const coinsInClip = (await dbg('coinsTaken')) - (coinsAtSkip || 0);
        await page.close();
        // The longest run of near-still frames in the clip itself.
        let run = 0, worst = 0;
        for (const v of speeds) { run = v < 0.4 ? run + 1 : 0; worst = Math.max(worst, run); }
        const bad = worst >= FPS * 0.75;
        if (bad) stalled.push(k);
        console.log(`  piece ${k} ${s.level}: ${n} frames${res.won ? ', won' : ''}, longest stop ${(worst / FPS).toFixed(2)} s, ${coinsInClip} coins picked up on camera${bad ? '  STALLED -- redo with CAPTURE_ONLY=' + k : ''}`);
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
    if (what === 'clip') {
        for (const id of process.argv.slice(3)) { const lv = LEVELS.find(l => l.id === id); const c = planClip(lv); console.log(id, c ? `${c.got} coins in reach from (${c.from.x.toFixed(2)}, ${c.from.z.toFixed(2)})` : 'no clip'); }
        return;
    }
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
