#!/usr/bin/env node
// MIXED REALITY in the page (xrMode.js), on Meta's own WebXR emulator (IWER,
// a Quest 3 with its controllers), against a BUILT bundle (MAZE_ROOT, like
// test_maze_boot.js). The web build: ENTER VR on level 1's ready screen
// opens a passthrough session with the board on the table under the eyes;
// the panel mirrors the page, and a controller's trigger on its START starts
// the run; a squeeze and a roll of the wrist leans the board and rolls the
// marble that way; letting go levels it; leaving the level ends the session,
// and the flat view comes back as it was. The CrazyGames build never offers
// it. Feel is judged on the user's headset; this holds the wiring.
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = process.env.MAZE_ROOT ? path.resolve(__dirname, process.env.MAZE_ROOT) : __dirname;
const CRAZY = /crazygames/.test(ROOT);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const IWER = fs.readFileSync(require.resolve('iwer/build/iwer.min.js'), 'utf8');
// A room for the emulator's hit tests (its Synthetic Environment Module seam):
// a table top TABLE_Y high in front of the player, the floor everywhere.
const TABLE_Y = 0.74, TABLE = { x0: -0.6, x1: 0.6, z0: -1.3, z1: -0.15 };
const ROOM = `
class FakeRoom {
    constructor() { this.c = document.createElement('canvas'); this.planes = new Set(); this.meshes = new Set(); }
    render() {}
    loadEnvironment() {} loadDefaultEnvironment() {}
    get environmentCanvas() { return this.c; }
    get trackedPlanes() { return this.planes; }
    get trackedMeshes() { return this.meshes; }
    deleteAll() {}
    computeDepthBuffer() { return null; }
    computeHitTestResults(m) {
        const o = [m[12], m[13], m[14]], d = [-m[8], -m[9], -m[10]];
        const out = [];
        const at = (y, inside) => {
            if (d[1] >= -1e-6) return;
            const t = (y - o[1]) / d[1];
            if (t <= 0) return;
            const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
            if (inside && !(x >= ${TABLE.x0} && x <= ${TABLE.x1} && z >= ${TABLE.z0} && z <= ${TABLE.z1})) return;
            const r = new Float32Array(16); r[0] = r[5] = r[10] = r[15] = 1; r[12] = x; r[13] = y; r[14] = z;
            out.push([t, r]);
        };
        at(${TABLE_Y}, true); at(0, false);
        return out.sort((a, b) => a[0] - b[0]).map(e => e[1]);
    }
}`;
const QUEST = IWER + ';\n' + ROOM + ';\nwindow.__xrDevice = new IWER.XRDevice(IWER.metaQuest3); window.__xrDevice.installSEM(FakeRoom); window.__xrDevice.installRuntime({ forceInstall: true });';

function serve() {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const file = path.join(ROOT, url === '/' ? 'index.html' : url);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const THREE = await import('three');
    const server = await serve();
    const base = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const foreign = t => /crazygames|sdk\./i.test(t);
    const errors = [];
    try {
        const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
        page.on('pageerror', e => { if (!foreign(e.message + (e.stack || ''))) errors.push(e.message); });
        page.on('console', m => { if (m.type() === 'error' && !foreign(m.text() + JSON.stringify(m.location()))) errors.push(m.text()); });
        // A Quest 3 where Chromium's own (device-less) WebXR would be.
        await page.addInitScript(QUEST);
        const dbg = (fn, ...args) => page.evaluate(([f, a]) => window.__mazeDebug[f](...a), [fn, args]);
        const xr = () => dbg('xr');
        const frames = (n) => page.evaluate((k) => new Promise(r => { let i = k; const f = () => (--i ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); setTimeout(r, 8000); }), n);

        // A phone with AR (Chrome on Android) has no hands in the game to
        // grab with: headsets only.
        if (!CRAZY) {
            const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' })).newPage();
            // Phone AR, as Chrome on Android has it (not IWER: it would pose
            // as a Quest, user agent and all).
            await phone.addInitScript(() => { Object.defineProperty(navigator, 'xr', { configurable: true, value: { isSessionSupported: async (m) => m === 'immersive-ar', requestSession: async () => { throw new Error('no'); } } }); });
            await phone.goto(base);
            await phone.waitForSelector('#mazeStartBtn', { state: 'visible', timeout: 30000 });
            await phone.evaluate(() => new Promise(r => setTimeout(r, 600)));
            check(await phone.isHidden('#mazeVrBtn'), 'a phone that can do AR is not offered ENTER VR');
            await phone.close();
        }
        await page.goto(base);
        await page.waitForSelector('#mazeStartBtn', { state: 'visible', timeout: 30000 });
        await frames(10);
        if (CRAZY) {
            check(await page.isHidden('#mazeVrBtn'), 'the CrazyGames build never offers ENTER VR, headset or not');
            throw 'done';
        }
        check(await page.isVisible('#mazeVrBtn'), 'with a headset, level 1\'s ready screen offers ENTER VR');

        // --- in: the board on the table, under and ahead of the eyes --------
        await page.click('#mazeVrBtn');
        await page.waitForFunction(() => window.__mazeDebug.xr().presenting, null, { timeout: 15000 });
        await frames(8);
        let d = await xr();
        const head = await page.evaluate(() => { const p = window.__xrDevice.position; return [p.x, p.y, p.z]; });
        await page.waitForFunction(() => window.__mazeDebug.xr().table !== null, null, { timeout: 8000 }).catch(() => {});
        await frames(3);
        d = await xr();
        let centre = await page.evaluate(() => window.__mazeDebug.xr().room(0, 0, 0));
        const ahead = head[2] - centre[2];
        check(d.table !== null && Math.abs(d.table - 0.74) < 1e-3 && Math.abs(centre[1] - (0.74 + 0.02)) < 1e-3,
            `the board finds the real table under it and sits just on it: table ${d.table}, board floor ${centre[1] && centre[1].toFixed(3)}`);
        check(ahead > 0.35 && ahead < 0.7 && Math.abs(centre[0] - head[0]) < 0.05,
            `ahead of the eyes, straight on: head ${head.map(v => v.toFixed(2))}, board ${centre.map(v => v.toFixed(2))}`);
        check(d.hands.filter(h => h.connected).length === 2, `both controllers are in the session: ${JSON.stringify(d.hands)}`);
        const sky = await dbg('sky');
        check(!sky.shown && !sky.background, `passthrough: no sky and no backdrop colour behind the board: ${JSON.stringify(sky)}`);
        const levelName = (await page.textContent('#mazeLevelName')).trim();
        const m = d.panel && d.panel.model;
        check(m && m.title === levelName && m.buttons.map(b => b.id).join() === 'mazeStartBtn,xr:place,xr:exit' && m.lines.includes('PRESS START') && m.lines.some(l => /GRIP OR PINCH/.test(l)) && !m.strip,
            `the panel mirrors the ready screen -- its name, START, then PLACE BOARD and EXIT VR, and how to tilt: ${JSON.stringify(m)}`);

        // --- PLACE BOARD: point at the table, see the outline, pull to set it -
        const point = async (hand, target, from) => {
            const eye = new THREE.Vector3(...from);
            const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, new THREE.Vector3(...target), new THREE.Vector3(0, 1, 0)));
            await page.evaluate(([h, p, r]) => { const c = window.__xrDevice.controllers[h]; c.position.set(...p); c.quaternion.set(...r); }, [hand, eye.toArray(), [q.x, q.y, q.z, q.w]]);
            await frames(4);
        };
        const pull = async (hand) => {
            await page.evaluate((h) => window.__xrDevice.controllers[h].updateButtonValue('trigger', 1), hand); await frames(4);
            await page.evaluate((h) => window.__xrDevice.controllers[h].updateButtonValue('trigger', 0), hand); await frames(4);
        };
        const hand0 = [head[0] + 0.18, head[1] - 0.3, head[2] - 0.15];
        await point('right', await page.evaluate(() => window.__mazeDebug.xr().aim('xr:place')), hand0);
        await pull('right');
        d = await xr();
        check(d.placing && d.panel.model.lines[0] === 'POINT AT A TABLE, THEN PULL THE TRIGGER' && d.panel.model.buttons.map(b => b.id).join() === 'xr:cancel',
            `PLACE BOARD asks to point at a table, with CANCEL: ${JSON.stringify(d.placing)} ${JSON.stringify(d.panel.model)}`);
        const target = [0.3, 0.74, -0.95];
        await point('right', target, hand0);
        await frames(4);
        d = await xr();
        check(d.placing && d.placing.ghost && d.placing.hit && Math.abs(d.placing.hit.x - target[0]) < 0.01 && Math.abs(d.placing.hit.y - target[1]) < 0.01 && Math.abs(d.placing.hit.z - target[2]) < 0.01,
            `pointed at the table, the board's outline sits where the ray meets it: ${JSON.stringify(d.placing)}`);
        await pull('right');
        d = await xr();
        centre = await page.evaluate(() => window.__mazeDebug.xr().room(0, 0, 0));
        check(!d.placing && d.pointed && Math.abs(centre[0] - target[0]) < 0.01 && Math.abs(centre[2] - target[2]) < 0.01 && Math.abs(centre[1] - (target[1] + 0.02)) < 0.002,
            `the trigger sets the board there, just on the table: ${centre.map(v => v.toFixed(3))}`);
        const farPt = await page.evaluate(() => window.__mazeDebug.xr().room(0, 0, -7));
        check(Math.hypot(farPt[0] - head[0], farPt[2] - head[2]) > Math.hypot(centre[0] - head[0], centre[2] - head[2]), 'facing the player: its far edge points away');
        check(d.panel.model.buttons[0] && d.panel.model.buttons[0].id === 'mazeStartBtn', 'and the ready screen is back on the panel');

        // --- START by pointing the right controller and pulling its trigger -
        const aimAt = async (hand, id) => {
            const target = await page.evaluate((i) => window.__mazeDebug.xr().aim(i), id);
            const eye = new THREE.Vector3(head[0] + (hand === 'right' ? 0.18 : -0.18), head[1] - 0.3, head[2] - 0.15);
            const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, new THREE.Vector3(...target), new THREE.Vector3(0, 1, 0)));
            await page.evaluate(([h, p, r]) => { const c = window.__xrDevice.controllers[h]; c.position.set(...p); c.quaternion.set(...r); }, [hand, eye.toArray(), [q.x, q.y, q.z, q.w]]);
            await frames(4);
        };
        const button = async (hand, name, v) => { await page.evaluate(([h, n, val]) => window.__xrDevice.controllers[h].updateButtonValue(n, val), [hand, name, v]); await frames(4); };
        await aimAt('right', 'mazeStartBtn');
        d = await xr();
        check(d.hands.some(h => h.hover === 'mazeStartBtn'), `a ray on START hovers it: ${JSON.stringify(d.hands)}`);
        await button('right', 'trigger', 1);
        await button('right', 'trigger', 0);
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 8000 }).catch(() => {});
        check(await dbg('phase') === 'running', `the trigger on the panel's START clicks the page's own: phase ${await dbg('phase')}`);
        await frames(4);
        d = await xr();
        check(d.panel.model.strip && !d.panel.model.buttons.length, `running, the panel is a strip (name, coins, the clock): ${JSON.stringify(d.panel.model)}`);

        // --- grab and tilt: squeeze, roll the wrist right, the ball goes right
        await page.evaluate(() => { const c = window.__xrDevice.controllers.left; c.position.set(-0.25, 1.1, -0.2); c.quaternion.set(0, 0, 0, 1); });
        await frames(3);
        const start = await dbg('ballPos');
        await button('left', 'squeeze', 1);
        check((await xr()).grabbing, 'a squeeze grabs the board');
        // About the BOARD's axes: it was turned to face the player, and a
        // player rolls the wrist toward what they face.
        const yaw = (await xr()).place.yaw;
        const boardAxis = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        const roll = new THREE.Quaternion().setFromAxisAngle(boardAxis(0, 0, 1), -20 * Math.PI / 180);
        await page.evaluate((r) => window.__xrDevice.controllers.left.quaternion.set(...r), [roll.x, roll.y, roll.z, roll.w]);
        await frames(30);
        d = await xr();
        const g = await dbg('gravity'), lean = await dbg('lean'), now = await dbg('ballPos');
        check(d.reading.gamma > 18 && d.reading.gamma < 22 && Math.abs(d.reading.beta) < 1.5, `a 20-degree roll of the wrist reads as 20 degrees of gamma: ${JSON.stringify(d.reading)}`);
        check(g.x > 5, `and pulls the marble right: gravity ${JSON.stringify(g)}`);
        check(lean.z < -0.2, `the board leans as far as gravity does, its right edge down (a flat screen shows a seventh): ${JSON.stringify(lean)}`);
        check(now.x > start.x + 0.05, `the marble rolled right: ${start.x.toFixed(3)} -> ${now.x.toFixed(3)}`);
        // Rolled right into the maze's walls, the holding hand feels the knocks.
        await page.waitForFunction(() => (window.__mazeDebug.xr().felt.hit || 0) > 0, null, { timeout: 6000 }).catch(() => {});
        check(((await xr()).felt.hit || 0) > 0, `a knock on a wall is felt in the hand holding the board: ${JSON.stringify((await xr()).felt)}`);
        await button('left', 'squeeze', 0);
        await frames(40);
        d = await xr();
        check(!d.grabbing && d.reading.gamma === 0 && d.reading.beta === 0, `letting go levels the reading: ${JSON.stringify(d.reading)}`);
        check(Math.abs((await dbg('gravity')).x) < 0.5, 'and the board settles level');

        // --- felt: a fall buzzes the controllers (none holding: both) -------
        const before = (await xr()).felt.fall || 0;
        await dbg('fallForTest', 'hole', 0);
        await frames(3);
        check(((await xr()).felt.fall || 0) >= before + 1, `going down a hole is felt in the controllers: ${JSON.stringify((await xr()).felt)}`);
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 10000 }).catch(() => {});

        // --- a clear: the CLEARED panel in the room, and NEXT by trigger ----
        await dbg('ageRun', 25000);
        check(await dbg('warpToGoal'), 'reaching the goal wins the run in a headset as anywhere');
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'won', null, { timeout: 5000 }).catch(() => {});
        await frames(6);
        d = await xr();
        const won = d.panel.model;
        check(!won.strip && /CLEARED/.test(won.lines[0] || '') && won.buttons[0] && won.buttons[0].id === 'mazeNextBtn' && won.buttons[0].primary
            && won.buttons.some(b => b.id === 'mazeLevelsBtn') && won.buttons.slice(-2).map(b => b.id).join() === 'xr:place,xr:exit',
            `the CLEARED panel: the result first, NEXT the bright choice, LEVELS, then PLACE BOARD and EXIT VR: ${JSON.stringify(won)}`);
        check(!won.buttons.some(b => /x2|×2|CONTINUE|SHIELD|BEACON/i.test(b.label)), 'no ad button is offered in the room (none on the web)');
        await aimAt('right', 'mazeNextBtn');
        await button('right', 'trigger', 1);
        await button('right', 'trigger', 0);
        check(((await xr()).felt.win || 0) >= 1, 'the clear is felt too');
        await page.waitForFunction((n) => window.__mazeDebug.phase() === 'ready' && document.getElementById('mazeLevelName').textContent.trim() !== n, levelName, { timeout: 8000 }).catch(() => {});
        await frames(8);
        d = await xr();
        const name2 = (await page.textContent('#mazeLevelName')).trim();
        check(d.presenting && await dbg('phase') === 'ready' && name2 !== levelName && d.panel.model.title === name2,
            `NEXT on the panel starts the next level, still in the headset, the panel following: ${name2}, ${JSON.stringify(d.panel.model.title)}`);
        const centre2 = await page.evaluate(() => window.__mazeDebug.xr().room(0, 0, 0));
        check(Math.abs(centre2[1] - centre[1]) < 1e-6 && Math.abs(centre2[0] - centre[0]) < 1e-6 && Math.abs(centre2[2] - centre[2]) < 1e-6, `the next board sits where the last was put: ${centre2.map(v => v.toFixed(3))}`);

        // --- hands: a pinch grabs and tilts, like a squeeze ------------------
        await page.evaluate(() => { window.__xrDevice.primaryInputMode = 'hand'; });
        await frames(10);
        d = await xr();
        check(d.hands.filter(h => h.connected && h.hand).length === 2, `with hand tracking both hands are inputs: ${JSON.stringify(d.hands)}`);
        await page.evaluate(() => document.getElementById('mazeStartBtn').click());
        await page.waitForFunction(() => window.__mazeDebug.phase() === 'running', null, { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => { const h = window.__xrDevice.hands.right; h.position.set(0.25, 1.0, -0.2); h.quaternion.set(0, 0, 0, 1); });
        await frames(4);
        await page.evaluate(() => window.__xrDevice.hands.right.updatePinchValue(1));
        await frames(4);
        check((await xr()).grabbing, 'a pinch away from the panel grabs the board');
        const tip = new THREE.Quaternion().setFromAxisAngle(boardAxis(1, 0, 0), -15 * Math.PI / 180);
        await page.evaluate((r) => window.__xrDevice.hands.right.quaternion.set(...r), [tip.x, tip.y, tip.z, tip.w]);
        await frames(20);
        d = await xr();
        check(d.reading.beta < -12 && d.reading.beta > -18 && Math.abs(d.reading.gamma) < 1.5 && (await dbg('gravity')).z < -3,
            `a hand tipped forward 15 degrees leans the far edge down, the marble rolling away: ${JSON.stringify(d.reading)}`);
        await page.evaluate(() => window.__xrDevice.hands.right.updatePinchValue(0));
        await frames(4);
        check(!(await xr()).grabbing, 'opening the pinch lets go');

        // --- out: leaving the level ends the session; the flat view is back -
        await page.evaluate(() => document.getElementById('mazeExitBtn').click());   // the emulator's canvas covers the page
        await page.waitForFunction(() => !window.__mazeDebug.xr().presenting, null, { timeout: 10000 }).catch(() => {});
        d = await xr();
        check(!d.presenting, 'leaving the level for the (flat) menus ends the session');
        const cam = await dbg('camera');
        check(cam.fov === 48 && cam.scale.every(v => v === 1) && cam.parent === null, `the flat camera gets its lens back and leaves the rig: ${JSON.stringify(cam)}`);
        // Back into a level: flat, with its sky, and ENTER VR offered again.
        await page.waitForSelector('#homePlayBtn', { state: 'visible', timeout: 10000 });
        await frames(12);
        // The first clear's level-up card waits at home (playerLevel.js).
        if (await page.isVisible('#levelPanel')) await page.click('#levelOkBtn');
        if (await page.isVisible('#rewardsPanel')) await page.click('#rewardsCloseBtn');
        await page.click('#homePlayBtn');
        await page.waitForSelector('#mazeStartBtn', { state: 'visible', timeout: 10000 });
        await frames(10);
        const sky2 = await dbg('sky');
        check(sky2.shown && sky2.background, `flat again, the level has its sky: ${JSON.stringify(sky2)}`);
        check(await page.isVisible('#mazeVrBtn'), 'and ENTER VR is offered again');
    } catch (e) {
        if (e !== 'done') failures.push('threw: ' + (e && e.stack || e));
    } finally {
        await browser.close();
        server.close();
    }
    check(!errors.length, 'no page errors: ' + errors.join(' | '));
    const label = CRAZY ? 'the CrazyGames build stays flat (no ENTER VR)' : 'ENTER VR puts level 1 on the table under the eyes, with no sky; the panel mirrors the ready screen and its START works by trigger; it finds the real table and PLACE BOARD sets it where you point; a squeeze and a wrist roll lean the board and roll the marble; letting go levels it; a fall and the clear are felt; the CLEARED panel\'s NEXT goes on in the headset; a pinch tilts like a squeeze; leaving the level ends the session and the flat view comes back';
    if (failures.length) { console.log('FAIL: xr browser'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
    console.log('PASS: xr browser -- ' + label);
})();
