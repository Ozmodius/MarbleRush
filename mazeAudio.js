import { sound, applyMute, isSilent, count } from './sound.js';
import { surfaceForLevel, wallForLevel, spaceForLevel, spatial } from './soundModel.js';
import { icicleState, flareState, geyserState, springState, crusherState, railState, windStrength,
         gateVelocity, gateSpecAt, gateFraction, gateBurning, distanceToRect, armSpin } from './mazeHazards.js';

// THE RUN'S SOUND: what the maze is doing, made into sound every frame.
//
// mazeGame.js hands this the ball's state each frame and tells it about the
// moments only it sees (a hit, a coin, a fall, the goal). Everything a hazard
// does is read here from the RUN CLOCK through mazeHazards.js -- the same
// functions that move and judge them -- so an icicle is heard shaking and
// shattering exactly when it shakes and shatters, and a press slams on the
// frame it lands. Nothing here changes the game.
//
// The engine may not exist yet when a level is built (no tap yet on a fresh
// page); this binds to it on the first frame it does.

export function createMazeAudio(level, { marble = 'classic' } = {}) {
    const surface = surfaceForLevel(level);
    const wall = wallForLevel(level);
    const space = spaceForLevel(level);
    const width = (level.size && level.size.w) || 9;
    let eng = null;
    let loops = {};
    const prev = {};                       // last state per hazard, by kind
    const lastHit = new Map();             // body -> context time of its last hit sound
    let detailIn = 2 + Math.random() * 3;  // seconds to the next ambience detail
    let sparkDebt = 0, ratchetDebt = 0;
    let disposed = false;
    let listener = { x: 0, z: 0, walk: false, yaw: 0 };

    function bind() {
        if (eng || disposed) return eng;
        eng = sound();
        if (!eng) return null;
        try {
            eng.setSurface(surface);
            eng.setMarble(marble);
            eng.setRoom(space.room.seconds, space.room.wet);
            const L = level;
            const want = { ambience: space.ambience.kind };
            if (L.fans && L.fans.length) want.fan = 'fan';
            if (L.conveyors && L.conveyors.length) want.belt = 'belt';
            if (L.magnets && L.magnets.length) want.hum = 'hum';
            if (L.rails && L.rails.length) want.buzz = 'buzz';
            if ((L.flares && L.flares.length) || (L.gates || []).some(g => g.molten)) want.sizzle = 'sizzle';
            if (L.geysers && L.geysers.length) want.gurgle = 'gurgle';
            if (L.arms && L.arms.length) want.whir = 'whir';
            if (L.gates && L.gates.length) want.slide = 'slide';
            if (L.crushers && L.crushers.length) want.hydraulic = 'hydraulic';
            for (const [k, kind] of Object.entries(want)) loops[k] = eng.loop(kind);
        } catch (_) { eng = null; }
        return eng;
    }

    const where = (x, z) => spatial({ x, z }, listener, { walk: listener.walk, yaw: listener.yaw, width });
    const at = (x, z, extra = 1) => { const s = where(x, z); return { pan: s.pan, gain: s.gain * extra }; };
    // A rect hazard is heard from its nearest point to the ball.
    const nearRect = (r) => {
        const d = distanceToRect(r, listener.x, listener.z);
        const s = where(r.x, r.z);
        return { pan: s.pan, gain: 1 / (1 + Math.pow(d / 1.4, 2)) };
    };
    function fire(name, opts) {
        count(name);
        if (!eng || isSilent()) return;
        try { eng[name](opts); } catch (_) { /* ignore */ }
    }
    // Did hazard i of `kind` just enter state `s`?
    function entered(kind, i, s) {
        const p = (prev[kind] || (prev[kind] = []));
        const was = p[i];
        p[i] = s;
        return { now: s, was, into: (x) => s === x && was !== undefined && was !== x };
    }

    // Per frame. ball: { x, y, z, vx, vy, vz }; radius; onFloor; onIce;
    // tMs (run clock); running (the run clock advanced this frame); walk/yaw;
    // dt (seconds); gates; magnetsOff.
    function frame(f) {
        if (disposed) return;
        applyMute();
        if (!bind()) return;
        const b = f.ball;
        listener = { x: b.x, z: b.z, walk: !!f.walk, yaw: f.yaw || 0 };
        const speed = Math.hypot(b.vx, b.vz);
        // Top-down, the roll sits where the ball is on the board; walking, it
        // is under you.
        const rollPan = f.walk ? 0 : Math.max(-1, Math.min(1, (b.x / (width / 2)) * 0.6));
        try {
            eng.updateRoll({ speed, radius: f.radius, onFloor: f.onFloor, onIce: f.onIce, pan: rollPan, dt: f.dt });
            hazards(f);
            ambience(f.dt);
        } catch (_) { /* never break the run for a sound */ }
    }

    function setLoop(k, gain, pan, param) { if (loops[k]) loops[k].set(gain, pan, param); }

    function hazards(f) {
        const L = level, t = f.tMs;
        // Fans: air moving, louder the harder they blow and the nearer you are.
        if (loops.fan) {
            let g = 0, pan = 0, p = 0;
            for (const fan of L.fans) { const s = windStrength(fan, t); const n = nearRect(fan); const v = s * n.gain; if (v > g) { g = v; pan = n.pan; p = s; } }
            setLoop('fan', 0.22 * g, pan, p);
        }
        if (loops.belt) {
            let g = 0, pan = 0, sp = 0;
            for (const c of L.conveyors) { const n = nearRect(c); if (n.gain > g) { g = n.gain; pan = n.pan; sp = Math.min(1, (c.speed || 2) / 3); } }
            setLoop('belt', 0.12 * g, pan, sp);
        }
        if (loops.hum) {
            let g = 0, pan = 0;
            for (const m of L.magnets) { const d = Math.hypot(m.x - listener.x, m.z - listener.z); const v = 1 / (1 + Math.pow(d / Math.max(0.5, m.reach), 2)); if (v > g) { g = v; pan = where(m.x, m.z).pan; } }
            setLoop('hum', f.magnetsOff ? 0 : 0.1 * g, pan, g);
        }
        if (loops.whir) {
            let g = 0, pan = 0, rate = 1;
            for (const a of L.arms) { const s = where(a.x, a.z); if (s.gain > g) { g = s.gain; pan = s.pan; rate = Math.abs(armSpin(a)) / Math.PI; } }
            setLoop('whir', 0.16 * g * g, pan, rate);
        }
        if (loops.slide) {
            let g = 0, pan = 0;
            for (const spec of L.gates) {
                const v = Math.abs(gateVelocity(spec, t));
                const at0 = gateSpecAt(spec, gateFraction(spec, t));
                const s = where(at0.x, at0.z);
                const k = Math.min(1, v / 1.5) * s.gain;
                if (k > g) { g = k; pan = s.pan; }
            }
            setLoop('slide', 0.2 * g, pan, 300 + 300 * g);
        }

        // Icicles: creak while they shake, shatter when they land.
        (L.icicles || []).forEach((ic, i) => {
            const s = icicleState(ic, t).state;
            const e = entered('icicle', i, s);
            if (!f.running) return;
            const p = at(ic.x, ic.z);
            if (s === 'shake' && Math.random() < f.dt * 7) fire('creak', p);
            if (e.into('impact')) fire('shatter', p);
        });
        // Flares (and molten gates): a sizzle that boils up, then a roar.
        if (loops.sizzle) {
            let g = 0, pan = 0, k = 0;
            (L.flares || []).forEach((fl, i) => {
                const s = flareState(fl, t);
                const e = entered('flare', i, s.state);
                const n = nearRect(fl);
                const v = s.state === 'warn' ? 0.25 + 0.75 * s.k : s.state === 'flare' ? 0.6 : 0.08;
                if (v * n.gain > g) { g = v * n.gain; pan = n.pan; k = s.state === 'warn' ? s.k : 0; }
                if (f.running && e.into('flare')) fire('roar', { pan: n.pan, gain: n.gain });
            });
            (L.gates || []).forEach(spec => {
                if (!spec.molten || !gateBurning(spec, t)) return;
                const a = gateSpecAt(spec, gateFraction(spec, t)); const s = where(a.x, a.z);
                if (0.5 * s.gain > g) { g = 0.5 * s.gain; pan = s.pan; }
            });
            setLoop('sizzle', 0.2 * g, pan, k);
        }
        // Geysers: churning below, then the blast.
        if (loops.gurgle) {
            let g = 0, pan = 0, k = 0;
            L.geysers.forEach((gy, i) => {
                const s = geyserState(gy, t);
                const e = entered('geyser', i, s.state);
                const p = where(gy.x, gy.z);
                const v = s.state === 'warn' ? 0.2 + 0.8 * s.k : 0.06;
                if (v * p.gain > g) { g = v * p.gain; pan = p.pan; k = s.state === 'warn' ? s.k : 0; }
                if (f.running && e.into('blast')) fire('steam', p);
            });
            setLoop('gurgle', 0.3 * g, pan, k);
        }
        // Springs: the ratchet winding, then the release.
        (L.springs || []).forEach((sp, i) => {
            const s = springState(sp, t).state;
            const e = entered('spring', i, s);
            if (!f.running) return;
            const p = nearRect(sp);
            if (s === 'wind') {
                ratchetDebt += 11 * f.dt;
                while (ratchetDebt >= 1) { ratchetDebt -= 1; fire('ratchet', { pan: p.pan, gain: 0.6 * p.gain }); }
            }
            if (e.into('fire')) fire('spring', p);
        });
        // Presses: pressure building, the slam, the hiss as they rise.
        if (loops.hydraulic) {
            let g = 0, pan = 0, k = 0;
            L.crushers.forEach((c, i) => {
                const s = crusherState(c, t);
                const e = entered('crusher', i, s.state);
                const p = nearRect(c);
                const v = s.state === 'warn' ? 0.3 + 0.7 * s.k : 0;
                if (v * p.gain > g) { g = v * p.gain; pan = p.pan; k = s.k; }
                if (!f.running) return;
                if (e.into('down')) fire('slam', p);
                if (e.into('rise')) fire('vent', { pan: p.pan, gain: 0.7 * p.gain });
            });
            setLoop('hydraulic', 0.12 * g, pan, k);
        }
        // Rails: sparks as they warm up, a buzz while live.
        if (loops.buzz) {
            let g = 0, pan = 0, warm = 0;
            L.rails.forEach((r, i) => {
                const s = railState(r, t).state;
                entered('rail', i, s);
                const p = nearRect(r);
                if (s === 'live' && p.gain > g) { g = p.gain; pan = p.pan; }
                if (s === 'warn') warm = Math.max(warm, p.gain);
                if (s === 'warn' && f.running) {
                    sparkDebt += 9 * f.dt * p.gain;
                    while (sparkDebt >= 1) { sparkDebt -= 1; fire('spark', { pan: p.pan, gain: p.gain }); }
                }
            });
            setLoop('buzz', 0.1 * g, pan);
        }
    }

    function ambience(dt) {
        if (loops.ambience) loops.ambience.set(space.ambience.level, 0);
        detailIn -= dt;
        if (detailIn > 0) return;
        const kind = space.ambience.kind;
        const pan = Math.random() * 1.6 - 0.8;
        if (kind === 'lava') { fire('bubble', { pan, gain: 0.35 }); detailIn = 0.6 + Math.random() * 2.2; }
        else if (kind === 'leaves') { fire('chirp', { pan }); detailIn = 4 + Math.random() * 9; }
        else if (kind === 'factory') { fire('clank', { pan }); detailIn = 3 + Math.random() * 7; }
        else detailIn = 5 + Math.random() * 5;
    }

    // A contact the physics reported: `material` is what was hit, v the speed
    // along the contact normal, (x, z) where.
    function hit(body, material, v, x, z) {
        if (disposed || !bind()) return;
        const tNow = eng.ctx.currentTime;
        const last = lastHit.get(body) || -1;
        if (tNow - last < 0.045) return;     // one contact, one sound
        lastHit.set(body, tNow);
        if (isSilent()) return;
        const p = at(x, z);
        try { if (eng.impact(material || wall, v, { pan: p.pan, gain: p.gain, radius: level.ballRadius })) count('impact'); } catch (_) { /* ignore */ }
    }

    // Moments mazeGame.js sees: coin, pickup, bumper, shield, fall, win.
    function event(name, opts = {}) {
        if (disposed) return;
        bind();
        const x = opts.x !== undefined ? opts.x : listener.x, z = opts.z !== undefined ? opts.z : listener.z;
        const p = at(x, z);
        switch (name) {
            case 'coin': fire('coin', p); break;
            case 'pickup': fire('pickup', p); break;
            case 'bumper': fire('bumper', p); break;
            case 'shield': fire('shield', p); break;
            case 'win': if (eng) eng.silenceRoll(); fire('goal', { pan: p.pan, wall }); break;
            case 'fall': {
                if (eng) eng.silenceRoll();
                const c = opts.cause;
                if (c === 'hole') fire('holeDrop', { pan: p.pan, wall, speed: opts.speed || 1 });
                else if (c === 'flare' || c === 'molten') fire('burn', p);
                else if (c === 'shock') fire('zap', p);
                else if (c === 'crush') fire('crunch', p);
                else if (c === 'icicle') fire('crunch', { pan: p.pan, gain: 0.6 });
                else fire('holeDrop', { pan: p.pan, wall });
                break;
            }
            default: break;
        }
    }

    // Off the run (menus, a level torn down): every loop stops for good.
    function dispose() {
        if (disposed) return;
        disposed = true;
        if (!eng) return;
        try { eng.silenceRoll(); } catch (_) { /* ignore */ }
        for (const l of Object.values(loops)) { try { l.stop(); } catch (_) { /* ignore */ } }
        loops = {};
    }

    return { frame, hit, event, dispose, wall };
}
