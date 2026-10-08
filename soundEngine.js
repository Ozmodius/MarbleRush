import { ICE_SURFACE, rollMix, rollVoice, impactStrength, impactPartials, marbleVoice, WALLS } from './soundModel.js';

// THE SOUND ENGINE: soundModel.js's numbers made audible with Web Audio.
//
// Built on ANY BaseAudioContext, so the same code plays live (sound.js) and
// renders offline to a file (scripts/soundDemo.html) for listening to a change
// without a phone. Nothing here knows about the maze: the run's own controller
// (mazeAudio.js) decides what happens and when; this decides how it sounds.
//
// Every call takes an optional time `t` (context seconds) so sounds can be
// scheduled exactly; live callers leave it out and get "now".
//
// Synthesis, not samples: noise shaped by filters for surfaces, air and fire,
// decaying sine partials for anything that rings (walls, coins, bells, steel).
// No sound here allocates more than a handful of nodes, and every one stops
// itself, so nothing needs tearing down but the loops.

const TAU = Math.PI * 2;
// The roll's level against everything else (about +3 dB on the first cut,
// which the user heard as a little quiet).
const ROLL_LEVEL = 0.78;

export function createSoundEngine(ctx) {
    const now = (t) => (t === undefined || t === null ? ctx.currentTime : t);
    const rnd = (a, b) => a + Math.random() * (b - a);

    // --- the bus: everything -> dry/verb -> master -> limiter -> out ---------
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 8; limiter.ratio.value = 6;
    limiter.attack.value = 0.003; limiter.release.value = 0.15;
    master.connect(limiter).connect(ctx.destination);
    const dry = ctx.createGain(); dry.connect(master);
    const verb = ctx.createConvolver();
    const wet = ctx.createGain(); wet.gain.value = 0.12;
    verb.connect(wet).connect(master);

    // --- buffers -------------------------------------------------------------
    const SR = ctx.sampleRate;
    function buffer(seconds, fill) {
        const b = ctx.createBuffer(1, Math.max(1, Math.floor(SR * seconds)), SR);
        fill(b.getChannelData(0));
        return b;
    }
    const white = buffer(2, d => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    // Brown noise: integrated white, for rumbles and roars.
    const brown = buffer(3, d => {
        let last = 0;
        for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    });
    // One grain: a few ms of noise with a sharp attack and fast decay.
    const grainBuf = buffer(0.012, d => { for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (SR * 0.0022)); });

    function setRoom(seconds = 0.8, amount = 0.12) {
        // A synthetic room: decaying stereo-less noise, darker as it fades.
        const len = Math.max(0.1, seconds);
        const ir = ctx.createBuffer(2, Math.floor(SR * len), SR);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            let lp = 0;
            for (let i = 0; i < d.length; i++) {
                const k = i / d.length;
                lp += (Math.random() * 2 - 1 - lp) * (0.9 - 0.75 * k);
                d[i] = lp * Math.pow(1 - k, 2.2);
            }
        }
        verb.buffer = ir;
        wet.gain.setTargetAtTime(amount, ctx.currentTime, 0.05);
    }
    setRoom();

    // A positioned output: gain -> pan -> dry (+ a send to the room).
    function out(pan = 0, gain = 1, send = 0.3, t) {
        const g = ctx.createGain();
        g.gain.value = gain;
        let tail = g;
        if (ctx.createStereoPanner) {
            const p = ctx.createStereoPanner();
            p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now(t));
            g.connect(p); tail = p;
        }
        tail.connect(dry);
        if (send > 0) { const s = ctx.createGain(); s.gain.value = send; tail.connect(s).connect(verb); }
        return g;
    }

    // --- voice budget: drop a sound rather than pile up nodes on a phone ----
    let busyUntil = [];
    function budget(t, dur, max = 14) {
        busyUntil = busyUntil.filter(e => e > t);
        if (busyUntil.length >= max) return false;
        busyUntil.push(t + dur);
        return true;
    }

    // --- primitives -------------------------------------------------------------
    // Ringing partials [{ f, decay (s, e-fold), amp }].
    function modal(partials, { pan = 0, gain = 1, t, send = 0.3, attack = 0.0015 } = {}) {
        t = now(t);
        const longest = partials.reduce((m, p) => Math.max(m, p.decay), 0);
        if (!partials.length || !budget(t, longest * 5)) return;
        const o = out(pan, gain, send, t);
        for (const p of partials) {
            if (!(p.f > 20 && p.f < SR / 2) || !(p.amp > 0)) continue;
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.frequency.setValueAtTime(p.f, t);
            if (p.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, p.f * p.glide), t + p.decay * 3);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(p.amp, t + attack);
            g.gain.setTargetAtTime(0, t + attack, p.decay);
            osc.connect(g).connect(o);
            osc.start(t);
            osc.stop(t + attack + p.decay * 6);
        }
    }
    // Filtered noise with an envelope, optionally sweeping its filter.
    function burst({ dur = 0.1, f = 1000, f2, q = 1, type = 'bandpass', gain = 0.5, attack = 0.002, pan = 0, t, send = 0.3, noise = 'white', rate = 1 } = {}) {
        t = now(t);
        if (!budget(t, dur + 0.05)) return;
        const src = ctx.createBufferSource();
        src.buffer = noise === 'brown' ? brown : white;
        src.playbackRate.value = rate;
        const fl = ctx.createBiquadFilter();
        fl.type = type; fl.Q.value = q;
        fl.frequency.setValueAtTime(f, t);
        if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + attack);
        g.gain.setTargetAtTime(0, t + attack, Math.max(0.002, (dur - attack) / 3));
        src.connect(fl).connect(g).connect(out(pan, 1, send, t));
        const off = Math.random() * (src.buffer.duration - dur - 0.1);
        src.start(t, Math.max(0, off));
        src.stop(t + dur + 0.05);
    }
    // A pitched tone gliding f -> f2.
    function tone({ f = 200, f2, dur = 0.2, type = 'sine', gain = 0.3, attack = 0.004, pan = 0, t, send = 0.2 } = {}) {
        t = now(t);
        if (!budget(t, dur + 0.05)) return;
        const osc = ctx.createOscillator(); osc.type = type;
        osc.frequency.setValueAtTime(f, t);
        if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + attack);
        g.gain.setTargetAtTime(0, t + attack, Math.max(0.003, (dur - attack) / 3.5));
        osc.connect(g).connect(out(pan, 1, send, t));
        osc.start(t);
        osc.stop(t + dur + 0.08);
    }
    // One grain through a band, for roll texture and crackles. No budget: a
    // grain is three nodes and a dozen milliseconds.
    function grain({ f = 2000, q = 1, gain = 0.2, pan = 0, t, rate = 1, send = 0 } = {}) {
        t = now(t);
        const src = ctx.createBufferSource();
        src.buffer = grainBuf;
        src.playbackRate.value = rate;
        const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
        const g = ctx.createGain(); g.gain.value = gain;
        src.connect(fl).connect(g).connect(out(pan, 1, send, t));
        src.start(t);
    }

    // --- the marble rolling -------------------------------------------------------
    // One persistent voice: noise through the surface's bands, a wobble, a pan.
    // Grains and tread ticks are scheduled per update.
    const roll = (() => {
        const src = ctx.createBufferSource();
        src.buffer = white; src.loop = true;
        const sum = ctx.createGain();
        const band = (type) => {
            const f = ctx.createBiquadFilter(); f.type = type;
            const g = ctx.createGain(); g.gain.value = 0;
            src.connect(f).connect(g).connect(sum);
            return { f, g };
        };
        const rumble = band('bandpass'), body = band('bandpass'), hiss = band('highpass');
        const rings = [band('bandpass'), band('bandpass'), band('bandpass'), band('bandpass'), band('bandpass')];
        // The low end of a roll is felt as much as heard: a brown-noise rumble
        // under the white, so a heavy marble on a hollow board has weight.
        const bsrc = ctx.createBufferSource(); bsrc.buffer = brown; bsrc.loop = true;
        const blp = ctx.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 160;
        const bg = ctx.createGain(); bg.gain.value = 0;
        bsrc.connect(blp).connect(bg).connect(sum);
        const level = ctx.createGain(); level.gain.value = 0;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        // The marble's top end: a rubber ball damps everything above a few kHz.
        const top = ctx.createBiquadFilter(); top.type = 'lowpass'; top.frequency.value = 12000; top.Q.value = 0.5;
        sum.connect(top).connect(level);
        if (pan) level.connect(pan).connect(dry); else level.connect(dry);
        const send = ctx.createGain(); send.gain.value = 0.15;
        level.connect(send).connect(verb);
        let started = false;
        return { src, bsrc, rumble, body, hiss, rings, bg, top, level, pan, start(t) { if (!started) { started = true; src.start(t); bsrc.start(t); } } };
    })();
    let surface = null, marble = marbleVoice('classic');
    // What THIS marble on the floor and on ice sounds like (soundModel.js
    // rollVoice): the two materials together, remade when either changes.
    let floorVoice = null, iceVoice = null;
    let wobPhase = 0, grainDebt = 0, tickDebt = 0, lastRoll = { gain: 0 };
    let current = null;               // the voice being played (floor or ice)
    function voices() {
        floorVoice = surface ? rollVoice(surface, marble) : null;
        iceVoice = rollVoice(ICE_SURFACE, marble);
        current = null;
    }

    function applySurface(s, t, tc = 0.04) {
        const set = (p, v) => p.setTargetAtTime(v, t, tc);
        set(roll.rumble.f.frequency, s.rumble.f); set(roll.rumble.f.Q, s.rumble.q);
        set(roll.body.f.frequency, s.body.f); set(roll.body.f.Q, s.body.q);
        set(roll.hiss.f.frequency, s.hiss.f);
        set(roll.top.frequency, Math.min(s.cutoff, ctx.sampleRate * 0.45));
        roll.rings.forEach((r, i) => { const ring = s.rings[i]; set(r.f.frequency, ring ? ring.f : 1000); set(r.f.Q, ring ? ring.q : 18); });
        current = s;
    }

    // speed (units/s), radius, onFloor, onIce, pan, dt (s since last update).
    function updateRoll({ speed = 0, radius = 0.3, onFloor = true, onIce = false, pan = 0, dt = 1 / 60, t } = {}) {
        if (!floorVoice) return;
        t = now(t);
        roll.start(t);
        const s = onIce ? iceVoice : floorVoice;
        if (s !== current) applySurface(s, t, 0.03);
        const mix = rollMix(speed, radius, s, marble, onFloor);
        // Out-of-round wobble: a few percent of level, once per revolution.
        wobPhase = (wobPhase + mix.wobbleHz * dt * TAU) % TAU;
        const wob = 1 - 0.14 * (0.5 + 0.5 * Math.sin(wobPhase));
        const g = mix.gain * wob * ROLL_LEVEL;
        const tc = mix.gain > lastRoll.gain ? 0.025 : 0.06;   // speed up fast, die away softly
        roll.level.gain.setTargetAtTime(g, t, tc);
        roll.rumble.g.gain.setTargetAtTime(s.rumble.g, t, 0.05);
        roll.body.g.gain.setTargetAtTime(s.body.g, t, 0.05);
        roll.hiss.g.gain.setTargetAtTime(s.hiss.g * mix.bright, t, 0.05);
        roll.bg.gain.setTargetAtTime(s.weight, t, 0.05);
        roll.rings.forEach((r, i) => r.g.gain.setTargetAtTime(s.rings[i] ? s.rings[i].g * mix.bright : 0, t, 0.05));
        // Brighter as it speeds up: every band rides up a little.
        roll.rumble.f.frequency.setTargetAtTime(s.rumble.f * (0.85 + 0.3 * (mix.bright - 0.8) / 0.6), t, 0.08);
        roll.body.f.frequency.setTargetAtTime(s.body.f * mix.bright, t, 0.08);
        if (roll.pan) roll.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.05);
        lastRoll = mix;

        // Grains: Poisson-ish, spread across the frame they belong to.
        grainDebt += mix.grainRate * dt;
        let n = 0;
        while (grainDebt >= 1 && n < 16) {
            grainDebt -= 1; n++;
            grain({ f: s.grain.f * rnd(0.75, 1.3), q: s.grain.q, gain: s.grain.g * Math.sqrt(mix.gain) * rnd(0.35, 1) * marble.roll * ROLL_LEVEL / 0.55, pan, t: t + 0.02 + Math.random() * dt, rate: rnd(0.8, 1.3) });
        }
        if (grainDebt > 4) grainDebt = 0;
        // Tread plate: a tick per bump crossed, evenly spaced.
        if (mix.tickRate > 0) {
            tickDebt += mix.tickRate * dt;
            let k = 0;
            const count = Math.floor(tickDebt);
            while (tickDebt >= 1 && k < 8) {
                tickDebt -= 1;
                grain({ f: s.tick.f * rnd(0.95, 1.05), q: 2.5, gain: s.tick.g * Math.sqrt(mix.gain) * marble.roll * ROLL_LEVEL / 0.55, pan, t: t + 0.02 + (k / Math.max(1, count)) * dt, rate: 0.7 });
                k++;
            }
        } else tickDebt = 0;
    }
    function silenceRoll(t) {
        t = now(t);
        roll.level.gain.setTargetAtTime(0, t, 0.04);
        grainDebt = 0; tickDebt = 0; lastRoll = { gain: 0 };
    }

    // --- loops: positioned beds a hazard turns up and down ----------------------
    // Each returns { set(gain, pan, param, t), stop(t) }. They start silent.
    function loop(kind) {
        const t = ctx.currentTime;
        const nodes = [];
        const level = ctx.createGain(); level.gain.value = 0;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (pan) level.connect(pan).connect(dry); else level.connect(dry);
        const send = ctx.createGain(); send.gain.value = 0.25; level.connect(send).connect(verb);
        const noiseSrc = (buf = white) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(t, Math.random() * (buf.duration - 0.1)); nodes.push(s); return s; };
        const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); nodes.push(o); return o; };
        const filt = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
        const gainNode = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
        // amplitude modulation of `g` by an LFO
        const am = (g, rate, depth, type = 'sine') => { const l = osc(type, rate); const d = gainNode(depth); l.connect(d).connect(g.gain); return l; };
        let param = () => {};
        switch (kind) {
            case 'fan': {        // a fan: motor hum under moving air
                const n = noiseSrc(); const bp = filt('bandpass', 650, 0.6); const lp = filt('lowpass', 2400);
                const ng = gainNode(0.9); n.connect(bp).connect(lp).connect(ng).connect(level);
                const m = osc('triangle', 96); const mg = gainNode(0.12); m.connect(mg).connect(level);
                const blade = am(ng, 23, 0.25);
                param = (p, tt) => { bp.frequency.setTargetAtTime(380 + 900 * p, tt, 0.1); blade.frequency.setTargetAtTime(14 + 18 * p, tt, 0.2); };
                break;
            }
            case 'belt': {       // a conveyor: motor, rollers, and the clatter of slats
                const m = osc('sawtooth', 58); const lp = filt('lowpass', 260); const mg = gainNode(0.25); m.connect(lp).connect(mg).connect(level);
                const n = noiseSrc(); const bp = filt('bandpass', 1900, 1.4); const ng = gainNode(0.0); n.connect(bp).connect(ng).connect(level);
                const clat = am(ng, 9, 0.5, 'square');
                param = (p, tt) => clat.frequency.setTargetAtTime(4 + 6 * p, tt, 0.2);
                break;
            }
            case 'hum': {        // an electromagnet: mains hum and its buzz
                const a = osc('sawtooth', 60), b = osc('sawtooth', 120.4);
                const lp = filt('lowpass', 700, 0.7); const g1 = gainNode(0.35), g2 = gainNode(0.2);
                a.connect(g1).connect(lp); b.connect(g2).connect(lp); lp.connect(level);
                param = (p, tt) => lp.frequency.setTargetAtTime(400 + 1400 * p, tt, 0.1);
                break;
            }
            case 'buzz': {       // a live rail: arcing buzz
                const a = osc('sawtooth', 120); const bp = filt('bandpass', 1800, 0.8); const g = gainNode(0.5);
                a.connect(bp).connect(g).connect(level);
                const n = noiseSrc(); const hp = filt('highpass', 3500); const ng = gainNode(0.0); n.connect(hp).connect(ng).connect(level);
                am(ng, 31, 0.35, 'square'); am(g, 7, 0.25);
                break;
            }
            case 'sizzle': {     // lava about to flare: a hot hiss that boils up
                const n = noiseSrc(); const hp = filt('highpass', 2800); const lp = filt('lowpass', 9000); const g = gainNode(0.6);
                n.connect(hp).connect(lp).connect(g).connect(level);
                am(g, 11, 0.3); am(g, 3.7, 0.2);
                const r = noiseSrc(brown); const rl = filt('lowpass', 200); const rg = gainNode(0.5); r.connect(rl).connect(rg).connect(level);
                param = (p, tt) => hp.frequency.setTargetAtTime(2000 + 2000 * p, tt, 0.1);
                break;
            }
            case 'gurgle': {     // a geyser building: water churning underground
                const r = noiseSrc(brown); const lp = filt('lowpass', 260, 2); const g = gainNode(0.9);
                r.connect(lp).connect(g).connect(level);
                const w = am(g, 5, 0.5);
                param = (p, tt) => { lp.frequency.setTargetAtTime(180 + 400 * p, tt, 0.1); w.frequency.setTargetAtTime(4 + 8 * p, tt, 0.1); };
                break;
            }
            case 'whir': {       // a spinning arm: the blade swishing past
                const n = noiseSrc(); const bp = filt('bandpass', 520, 1.6); const g = gainNode(0.0);
                n.connect(bp).connect(g).connect(level);
                const sw = am(g, 1, 0.7);
                const m = osc('triangle', 74); const mg = gainNode(0.08); m.connect(mg).connect(level);
                param = (p, tt) => sw.frequency.setTargetAtTime(Math.max(0.2, p), tt, 0.2);
                break;
            }
            case 'slide': {      // a gate sliding in its track
                const r = noiseSrc(); const bp = filt('bandpass', 420, 1.3); const lp = filt('lowpass', 1400); const g = gainNode(1);
                r.connect(bp).connect(lp).connect(g).connect(level);
                am(g, 13, 0.25);
                param = (p, tt) => bp.frequency.setTargetAtTime(p, tt, 0.1);
                break;
            }
            case 'hydraulic': {  // a press building pressure
                const n = noiseSrc(); const bp = filt('bandpass', 1300, 4); const g = gainNode(0.6); n.connect(bp).connect(g).connect(level);
                const o = osc('sawtooth', 90); const lp = filt('lowpass', 400); const og = gainNode(0.25); o.connect(lp).connect(og).connect(level);
                param = (p, tt) => { o.frequency.setTargetAtTime(80 + 90 * p, tt, 0.05); bp.frequency.setTargetAtTime(1000 + 900 * p, tt, 0.05); };
                break;
            }
            // Ambience beds.
            case 'room': {
                const r = noiseSrc(brown); const lp = filt('lowpass', 220); r.connect(lp).connect(level);
                const n = noiseSrc(); const hp = filt('bandpass', 3000, 0.5); const ng = gainNode(0.05); n.connect(hp).connect(ng).connect(level);
                break;
            }
            case 'leaves': {
                const n = noiseSrc(); const bp = filt('bandpass', 2600, 0.6); const g = gainNode(0.6); n.connect(bp).connect(g).connect(level);
                am(g, 0.13, 0.45); am(g, 0.37, 0.2);
                const r = noiseSrc(brown); const lp = filt('lowpass', 300); const rg = gainNode(0.4); r.connect(lp).connect(rg).connect(level);
                break;
            }
            case 'wind': {
                const n = noiseSrc(); const bp = filt('bandpass', 480, 6); const g = gainNode(1.4); n.connect(bp).connect(g).connect(level);
                const sweep = osc('sine', 0.07); const sd = gainNode(180); sweep.connect(sd).connect(bp.frequency);
                am(g, 0.11, 0.6);
                const r = noiseSrc(brown); const lp = filt('lowpass', 240); const rg = gainNode(0.6); r.connect(lp).connect(rg).connect(level);
                break;
            }
            case 'lava': {
                const r = noiseSrc(brown); const lp = filt('lowpass', 140, 0.8); const rg = gainNode(1.2); r.connect(lp).connect(rg).connect(level);
                am(rg, 0.2, 0.3);
                break;
            }
            case 'factory': {
                const a = osc('sawtooth', 50), b = osc('sawtooth', 100.3);
                const lp = filt('lowpass', 240); const ga = gainNode(0.25), gb = gainNode(0.12);
                a.connect(ga).connect(lp); b.connect(gb).connect(lp); lp.connect(level);
                const r = noiseSrc(brown); const rl = filt('lowpass', 400); const rg = gainNode(0.6); r.connect(rl).connect(rg).connect(level);
                break;
            }
            default: break;
        }
        let stopped = false;
        return {
            kind,
            set(gain, p = 0, prm, tt) {
                if (stopped) return;
                tt = now(tt);
                level.gain.setTargetAtTime(Math.max(0, gain), tt, 0.06);
                if (pan) pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)), tt, 0.06);
                if (prm !== undefined) param(prm, tt);
            },
            stop(tt) {
                if (stopped) return;
                stopped = true;
                tt = now(tt);
                level.gain.setTargetAtTime(0, tt, 0.05);
                for (const n of nodes) { try { n.stop(tt + 0.4); } catch (_) { /* already stopped */ } }
            }
        };
    }

    // --- the sounds ---------------------------------------------------------------------
    const api = {
        ctx,
        master,
        setVolume(v, t) { master.gain.setTargetAtTime(v, now(t), 0.03); },
        setRoom,
        // The board this run is on: its floor, its ice, and the marble.
        setSurface(s, t) { surface = s; voices(); if (floorVoice) applySurface(floorVoice, now(t), 0.01); },
        setMarble(id) { marble = marbleVoice(id); voices(); },
        marble: () => marble,
        updateRoll,
        silenceRoll,
        loop,
        rollLevel: () => lastRoll.gain || 0,

        // A hit on a wall of `wallKey` at normal speed v.
        impact(wallKey, v, { pan = 0, gain = 1, radius = 0.3, t } = {}) {
            const s = impactStrength(v);
            if (!s) return 0;
            t = now(t);
            const wall = WALLS[wallKey] || WALLS.wood;
            // Each hit a hair different, as real ones are.
            const jitter = rnd(0.96, 1.04);
            const parts = impactPartials(wallKey, marble, radius, s).map(p => ({ ...p, f: p.f * jitter }));
            modal(parts, { pan, gain: 0.42 * gain, t, send: wall.room });
            burst({ dur: 0.012, f: wall.click.f * marble.bright, q: wall.click.q, gain: 0.5 * s * gain * marble.hit, pan, t, send: wall.room, attack: 0.0006 });
            return s;
        },

        // A coin taken: a small metal disc's inharmonic ring, then it settles.
        coin({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            const f0 = 2380 * rnd(0.97, 1.03);
            const ring = (f, a, tt) => modal([1, 1.505, 2.39, 3.36, 4.62].map((r, i) => ({ f: f * r, decay: [0.32, 0.24, 0.16, 0.11, 0.07][i], amp: [1, 0.62, 0.45, 0.28, 0.18][i] * a })), { pan, gain: 0.24 * gain, t: tt, send: 0.25 });
            ring(f0, 1, t);
            burst({ dur: 0.008, f: 6000, q: 0.8, gain: 0.25 * gain, pan, t, attack: 0.0005, send: 0.1 });
            ring(f0 * 1.06, 0.45, t + 0.075);
        },
        // Coins changing hands (a purchase, a reward): a few clinks.
        coins({ n = 3, gain = 1, t } = {}) {
            t = now(t);
            for (let i = 0; i < n; i++) api.coin({ pan: rnd(-0.3, 0.3), gain: gain * rnd(0.6, 1), t: t + i * rnd(0.05, 0.09) });
        },
        // A power-up taken: two glassy bell notes.
        pickup({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            const bell = (f, tt, a) => modal([1, 2.0, 2.76, 5.4].map((r, i) => ({ f: f * r, decay: [0.5, 0.3, 0.2, 0.1][i], amp: [1, 0.35, 0.3, 0.12][i] * a })), { pan, gain: 0.14 * gain, t: tt, send: 0.4 });
            bell(1046, t, 1); bell(1568, t + 0.09, 0.9);
        },
        // The marble drops into the goal cup: a settle, then a bell.
        goal({ pan = 0, wall = 'wood', t } = {}) {
            t = now(t);
            api.impact(wall, 1.2, { pan, t });
            api.impact(wall, 0.6, { pan, t: t + 0.11 });
            api.impact(wall, 0.35, { pan, t: t + 0.19 });
            modal([1, 2.76, 5.4, 8.93].map((r, i) => ({ f: 1320 * r, decay: [1.1, 0.5, 0.25, 0.12][i], amp: [1, 0.5, 0.3, 0.15][i] })), { pan: 0, gain: 0.2, t: t + 0.28, send: 0.5 });
            modal([1, 2.76, 5.4].map((r, i) => ({ f: 1760 * r, decay: [1.3, 0.55, 0.25][i], amp: [1, 0.45, 0.25][i] })), { pan: 0, gain: 0.16, t: t + 0.42, send: 0.5 });
        },
        // Down a hole: the lip, the drop, the clunk below the board, and the
        // marble rolling away underneath until it is gone.
        holeDrop({ pan = 0, wall = 'wood', speed = 1, t } = {}) {
            t = now(t);
            api.impact(wall, 0.6 + 0.5 * Math.min(1, speed / 3), { pan, t });
            modal([{ f: 118, decay: 0.12, amp: 1 }, { f: 265, decay: 0.08, amp: 0.5 }, { f: 610, decay: 0.04, amp: 0.25 }], { pan, gain: 0.5, t: t + 0.16, send: 0.3 });
            burst({ dur: 0.02, f: 900, q: 0.7, gain: 0.35, pan, t: t + 0.16, send: 0.3 });
            modal([{ f: 124, decay: 0.08, amp: 0.6 }, { f: 280, decay: 0.05, amp: 0.3 }], { pan, gain: 0.35, t: t + 0.31, send: 0.3 });
            burst({ dur: 0.9, f: 260, f2: 120, q: 0.9, type: 'lowpass', gain: 0.35, attack: 0.05, pan: pan * 0.6, t: t + 0.33, noise: 'brown', send: 0.4 });
        },
        // A falling icicle: shards ringing and a burst of breaking ice.
        shatter({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            burst({ dur: 0.07, f: 300, type: 'lowpass', q: 0.8, gain: 0.5 * gain, pan, t, noise: 'brown', send: 0.4 });
            burst({ dur: 0.22, f: 5200, f2: 2600, q: 0.6, type: 'highpass', gain: 0.32 * gain, pan, t, send: 0.4 });
            const shards = 18;
            for (let i = 0; i < shards; i++) {
                const tt = t + Math.pow(Math.random(), 1.8) * 0.32;
                modal([{ f: rnd(2400, 8800), decay: rnd(0.015, 0.07), amp: rnd(0.3, 1) }], { pan: pan + rnd(-0.25, 0.25), gain: 0.12 * gain, t: tt, send: 0.4 });
            }
        },
        // Ice creaking under its own weight, before it falls.
        creak({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            for (let i = 0; i < 3; i++) grain({ f: rnd(3000, 7000), q: 4, gain: 0.25 * gain, pan, t: t + i * rnd(0.01, 0.05), rate: rnd(0.6, 1.4), send: 0.3 });
        },
        // Lava erupting from a seam.
        roar({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            burst({ dur: 0.7, f: 260, f2: 1400, q: 0.7, type: 'lowpass', gain: 0.55 * gain, attack: 0.04, pan, t, noise: 'brown', send: 0.4 });
            burst({ dur: 0.6, f: 2500, f2: 1200, q: 0.5, type: 'bandpass', gain: 0.18 * gain, attack: 0.03, pan, t, send: 0.4 });
            for (let i = 0; i < 10; i++) grain({ f: rnd(1500, 5000), q: 1.5, gain: 0.25 * gain, pan, t: t + Math.random() * 0.6, rate: rnd(0.7, 1.2), send: 0.3 });
        },
        // A bubble of lava popping.
        bubble({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            tone({ f: rnd(90, 160), f2: rnd(260, 420), dur: 0.07, gain: 0.2 * gain, pan, t, send: 0.4 });
            grain({ f: 900, q: 1, gain: 0.2 * gain, pan, t: t + 0.06, send: 0.3 });
        },
        // A geyser blast: a deep whump and a jet of steam.
        steam({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            tone({ f: 95, f2: 42, dur: 0.3, gain: 0.5 * gain, pan, t, send: 0.4 });
            burst({ dur: 0.55, f: 1800, f2: 5200, q: 0.5, type: 'highpass', gain: 0.4 * gain, attack: 0.02, pan, t, send: 0.4 });
            burst({ dur: 0.35, f: 600, q: 0.8, gain: 0.25 * gain, attack: 0.01, pan, t, noise: 'brown', send: 0.3 });
        },
        // A pinball bumper firing: the solenoid's clack and the rubber's thump.
        bumper({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            burst({ dur: 0.02, f: 3200, q: 1.5, gain: 0.7 * gain, pan, t, attack: 0.0005, send: 0.2 });
            tone({ f: 210, f2: 95, dur: 0.14, gain: 0.8 * gain, pan, t, send: 0.25 });
            modal([{ f: 640, decay: 0.05, amp: 0.6 }, { f: 1580, decay: 0.035, amp: 0.35 }], { pan, gain: 0.45 * gain, t, send: 0.2 });
        },
        // A spring pad firing: a catch releasing and the coil ringing.
        spring({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            burst({ dur: 0.015, f: 2600, q: 1.2, gain: 0.45 * gain, pan, t, attack: 0.0005, send: 0.2 });
            tone({ f: 110, f2: 70, dur: 0.12, gain: 0.4 * gain, pan, t, send: 0.2 });
            modal([{ f: 620, decay: 0.22, amp: 0.7, glide: 1.08 }, { f: 1440, decay: 0.16, amp: 0.4, glide: 1.06 }, { f: 2380, decay: 0.1, amp: 0.25 }], { pan, gain: 0.22 * gain, t, send: 0.3 });
        },
        // A spring winding: one click of its ratchet.
        ratchet({ pan = 0, gain = 1, t } = {}) {
            grain({ f: 3400, q: 3, gain: 0.3 * gain, pan, t: now(t), rate: 0.8, send: 0.15 });
        },
        // A press slamming down onto steel.
        slam({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            tone({ f: 72, f2: 36, dur: 0.45, gain: 0.8 * gain, pan, t, send: 0.5 });
            modal(WALLS.steel.modes.map(m => ({ f: m.f * 0.8, decay: m.decay * 1.4, amp: m.amp })), { pan, gain: 0.35 * gain, t, send: 0.6 });
            burst({ dur: 0.15, f: 700, type: 'lowpass', q: 0.7, gain: 0.6 * gain, pan, t, noise: 'brown', send: 0.5 });
            burst({ dur: 0.02, f: 4000, q: 0.8, gain: 0.4 * gain, pan, t, attack: 0.0005, send: 0.4 });
        },
        // Hydraulics releasing as a press rises.
        vent({ pan = 0, gain = 1, t } = {}) {
            burst({ dur: 0.5, f: 3000, f2: 1600, q: 0.7, type: 'bandpass', gain: 0.18 * gain, attack: 0.03, pan, t: now(t), send: 0.3 });
        },
        // Sparks off a rail about to go live.
        spark({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            for (let i = 0; i < 2; i++) grain({ f: rnd(3500, 8000), q: 2, gain: 0.3 * gain, pan, t: t + Math.random() * 0.03, rate: rnd(0.8, 1.6), send: 0.2 });
        },
        // Shocked: a hard electric zap.
        zap({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            tone({ f: 1400, f2: 110, dur: 0.3, type: 'sawtooth', gain: 0.2 * gain, pan, t, send: 0.3 });
            burst({ dur: 0.25, f: 4000, q: 0.6, type: 'highpass', gain: 0.4 * gain, pan, t, send: 0.3 });
            for (let i = 0; i < 12; i++) grain({ f: rnd(2000, 9000), q: 2, gain: 0.45 * gain, pan, t: t + Math.random() * 0.3, rate: rnd(0.8, 1.6), send: 0.2 });
        },
        // Burned: the marble sizzling in lava.
        burn({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            burst({ dur: 0.9, f: 3500, f2: 2000, q: 0.5, type: 'highpass', gain: 0.35 * gain, attack: 0.01, pan, t, send: 0.3 });
            burst({ dur: 0.4, f: 180, type: 'lowpass', q: 0.8, gain: 0.4 * gain, pan, t, noise: 'brown', send: 0.3 });
            for (let i = 0; i < 8; i++) api.bubble({ pan, gain: 0.6 * gain, t: t + 0.1 + Math.random() * 0.6 });
        },
        // Crushed: glass or steel giving way under a press.
        crunch({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            for (let i = 0; i < 14; i++) grain({ f: rnd(1500, 6000), q: 1.2, gain: 0.5 * gain, pan, t: t + Math.random() * 0.12, rate: rnd(0.6, 1.2), send: 0.3 });
        },
        // A shield catching a fall: a soft whoosh and a ring.
        shield({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            burst({ dur: 0.35, f: 400, f2: 2600, q: 1.2, gain: 0.3 * gain, attack: 0.05, pan, t, send: 0.5 });
            modal([1, 2.0, 3.0].map((r, i) => ({ f: 880 * r, decay: [0.6, 0.35, 0.2][i], amp: [1, 0.4, 0.2][i] })), { pan, gain: 0.12 * gain, t: t + 0.15, send: 0.5 });
        },
        // A distant clank in a factory, a bird in the forest: ambience details.
        clank({ pan = 0, gain = 1, t } = {}) {
            modal(WALLS.steel.modes.map(m => ({ f: m.f * rnd(0.7, 1.3), decay: m.decay, amp: m.amp })), { pan, gain: 0.05 * gain, t: now(t), send: 0.9 });
        },
        chirp({ pan = 0, gain = 1, t } = {}) {
            t = now(t);
            const base = rnd(2600, 4200), notes = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < notes; i++) tone({ f: base * rnd(0.9, 1.1), f2: base * rnd(1.15, 1.5), dur: rnd(0.05, 0.09), gain: 0.03 * gain, pan, t: t + i * rnd(0.09, 0.14), send: 0.6 });
        },
        // Interface sounds: a soft tap and a confirm/cancel pair.
        uiGood({ t } = {}) {
            t = now(t);
            modal([1, 2.0, 3.01].map((r, i) => ({ f: 784 * r, decay: [0.25, 0.12, 0.08][i], amp: [1, 0.3, 0.15][i] })), { gain: 0.1, t, send: 0.2 });
            modal([1, 2.0, 3.01].map((r, i) => ({ f: 1175 * r, decay: [0.3, 0.14, 0.08][i], amp: [1, 0.3, 0.15][i] })), { gain: 0.1, t: t + 0.08, send: 0.2 });
        },
        uiBad({ t } = {}) {
            t = now(t);
            modal([{ f: 220, decay: 0.12, amp: 1 }, { f: 330, decay: 0.08, amp: 0.4 }], { gain: 0.12, t, send: 0.1 });
            modal([{ f: 165, decay: 0.16, amp: 1 }, { f: 247, decay: 0.1, amp: 0.4 }], { gain: 0.12, t: t + 0.1, send: 0.1 });
        }
    };
    return api;
}
