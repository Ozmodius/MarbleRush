#!/usr/bin/env node
// The sound model (soundModel.js): every level has a surface, walls, a floor
// and a space to sound like; the roll follows speed; hits follow force; the
// marble changes the voice; stereo puts things on the right side.
//
// Whether it sounds GOOD is a question for ears on a phone (CLAUDE.md, visual
// changes); scripts/soundDemo.html renders the sounds to a file for that. This
// pins what can be pinned: nothing silent that should be heard, nothing heard
// that should be silent, and nothing pointing the wrong way.

const fs = require('fs');
const path = require('path');

const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };

(async () => {
    const M = await import('./soundModel.js');
    const levels = JSON.parse(fs.readFileSync(path.join(__dirname, 'mazeLevels.json'), 'utf8')).levels;
    const daily = JSON.parse(fs.readFileSync(path.join(__dirname, 'dailyLevels.json'), 'utf8'));
    const all = levels.concat(daily.levels || daily);

    // Every theme a level uses is fully voiced.
    const themes = new Set();
    for (const lv of all) { if (lv.theme) themes.add(lv.theme); if (lv.themeTo) themes.add(lv.themeTo); }
    for (const t of themes) {
        check(M.SURFACES[t], `theme ${t} has a rolling surface`);
        check(M.WALLS[M.THEME_WALL[t]], `theme ${t} has a wall material`);
        check(M.WALLS[M.THEME_FLOOR[t]], `theme ${t} has a floor material`);
        check(M.AMBIENCE[t] && M.ROOMS[t], `theme ${t} has an ambience and a room`);
    }
    const finite = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'NaN' : v)).indexOf('NaN') < 0;
    for (const lv of all) {
        const s = M.surfaceForLevel(lv);
        check(finite(s) && s.rumble.f > 20 && s.hiss.f < 20000, `${lv.id}: a sane blended surface`);
        check(M.WALLS[M.wallForLevel(lv)] && M.WALLS[M.floorForLevel(lv)], `${lv.id}: walls and floor resolve`);
    }

    // Blending sits between its ends, on a log scale for pitch.
    const a = M.SURFACES.workshop, b = M.SURFACES.forest;
    const mid = M.blendSurface(a, b, 0.5);
    check(Math.abs(mid.rumble.f - Math.sqrt(a.rumble.f * b.rumble.f)) < 1e-6, 'pitches blend geometrically');
    check(M.blendSurface(a, b, 0).body.f === a.body.f && Math.abs(M.blendSurface(a, b, 1).body.f - b.body.f) < 1e-9, 'blend 0 and 1 are the two ends');

    // The roll: silent at rest and in the air, louder and brighter with speed.
    const classic = M.marbleVoice('classic');
    check(M.rollMix(0, 0.3, a, classic).gain === 0, 'a marble at rest is silent');
    check(M.rollMix(3, 0.3, a, classic, false).gain === 0, 'a marble in the air makes no rolling sound');
    let last = -1, ok = true, brightOk = true, lastB = 0;
    for (let v = 0.1; v <= 6; v += 0.1) {
        const m = M.rollMix(v, 0.3, a, classic);
        if (m.gain < last - 1e-12) ok = false;
        if (m.bright < lastB - 1e-12) brightOk = false;
        last = m.gain; lastB = m.bright;
    }
    check(ok, 'the roll never gets quieter as the marble speeds up');
    check(brightOk, 'the roll never gets duller as the marble speeds up');
    check(M.rollMix(0.1, 0.3, a, classic).gain > 0, 'a creeping marble is still just audible');
    check(M.rollMix(20, 0.3, a, classic).gain <= 1, 'the roll never goes past full');
    // Turns per second follow radius: a smaller ball turns faster.
    check(M.rollMix(2, 0.24, a, classic).wobbleHz > M.rollMix(2, 0.32, a, classic).wobbleHz, 'a smaller marble wobbles faster');
    // Rough ground clicks more than smooth.
    check(M.rollMix(2, 0.3, M.SURFACES.forest, classic).grainRate > M.rollMix(2, 0.3, M.ICE_SURFACE, classic).grainRate * 10, 'gravel crackles; ice does not');
    check(M.rollMix(2, 0.3, M.SURFACES.foundry, classic).tickRate > 0 && M.rollMix(2, 0.3, a, classic).tickRate === 0, 'only tread plate ticks');
    check(M.ICE_SURFACE.hiss.g > a.hiss.g, 'ice hisses more than wood');

    // Marbles.
    const rubber = M.marbleVoice('rubber'), steel = M.marbleVoice('steel');
    check(M.rollMix(2, 0.3, a, rubber).gain < M.rollMix(2, 0.3, a, classic).gain, 'rubber rolls quieter');
    check(M.rollMix(2, 0.3, a, steel).gain > M.rollMix(2, 0.3, a, classic).gain, 'steel rolls louder');
    check(rubber.ping.length === 0 && classic.ping.length > 0, 'rubber has no ping');
    check(M.marbleVoice('nonsense') === classic, 'an unknown marble sounds like Classic');

    // The roll is the two materials meeting (rollVoice).
    const V = (surf, id) => M.rollVoice(surf, M.marbleVoice(id));
    const ringSum = (v) => v.rings.reduce((n, r) => n + r.g, 0);
    for (const [name, surf] of Object.entries(M.SURFACES).concat([['ice', M.ICE_SURFACE]])) {
        check(surf.hard >= 0 && surf.hard <= 1, `${name} has a hardness`);
        for (const id of Object.keys(M.MARBLE_VOICES)) {
            const v = V(surf, id);
            check(finite(v) && v.cutoff > 500 && v.cutoff < 20000 && v.rings.every(r => r.f > 100 && r.g >= 0), `${id} on ${name}: a sane voice`);
            check(V(surf, 'rubber').cutoff < V(surf, 'steel').cutoff, `on ${name}, rubber is duller than steel`);
            check(V(surf, 'rubber').hiss.g < V(surf, 'glass').hiss.g, `on ${name}, rubber hisses less than glass`);
            check(V(surf, 'rubber').grain.f < V(surf, 'steel').grain.f, `on ${name}, rubber's grit crunches lower than steel's clicks`);
        }
    }
    // The floor matters as much as the marble.
    check(V(M.ICE_SURFACE, 'glass').hiss.g > V(M.SURFACES.snowfield, 'glass').hiss.g * 3, 'glass on ice hisses; glass on snow does not');
    check(V(M.SURFACES.snowfield, 'steel').cutoff < V(M.SURFACES.foundry, 'steel').cutoff, 'a soft floor muffles even steel');
    check(ringSum(V(M.SURFACES.foundry, 'steel')) > ringSum(V(M.SURFACES.snowfield, 'steel')) * 3, 'steel sings on steel, not on snow');
    check(V(M.SURFACES.foundry, 'rubber').rings.length === M.SURFACES.foundry.ring.length, 'rubber adds no ring of its own');
    check(ringSum(V(M.SURFACES.foundry, 'rubber')) < ringSum(V(M.SURFACES.foundry, 'steel')) * 0.3, 'rubber barely excites a steel plate');
    check(V(M.SURFACES.workshop, 'steel').weight > V(M.SURFACES.workshop, 'glass').weight, 'steel is heavier underfoot than glass');
    // Every board stays recognisable under every marble: its own resonance
    // keeps its place among the boards.
    for (const id of Object.keys(M.MARBLE_VOICES)) {
        check(V(M.SURFACES.playroom, id).body.f < V(M.SURFACES.toybox, id).body.f, `${id}: a foam mat stays duller than plastic`);
    }

    // Impacts.
    check(M.impactStrength(0.05) === 0 && M.impactStrength(M.IMPACT_MIN_SPEED - 0.01) === 0, 'a resting touch is silent');
    check(M.impactStrength(1) > M.impactStrength(0.5) && M.impactStrength(10) <= 1, 'harder hits are louder, to a ceiling');
    const sum = (ps) => ps.reduce((s, p) => s + p.amp * p.decay, 0);
    check(sum(M.impactPartials('wood', rubber, 0.3, 1)) < sum(M.impactPartials('wood', classic, 0.3, 1)), 'a rubber hit rings less');
    check(sum(M.impactPartials('steel', classic, 0.3, 1)) > sum(M.impactPartials('foam', classic, 0.3, 1)) * 3, 'steel rings, foam does not');
    const ping = (r) => M.impactPartials('wood', classic, r, 1).slice(-1)[0].f;
    check(ping(0.24) > ping(0.32), 'a smaller marble pings higher');

    // Stereo. Top-down: right of the board is right. Walking: right of the way
    // you face is right, whichever way that is.
    check(M.spatial({ x: 4, z: 0 }, { x: 0, z: 0 }, { width: 9 }).pan > 0.3, 'top-down: a sound on the right pans right');
    check(M.spatial({ x: -4, z: 0 }, { x: 0, z: 0 }, { width: 9 }).pan < -0.3, 'top-down: a sound on the left pans left');
    const near = M.spatial({ x: 0.5, z: 0 }, { x: 0, z: 0 }, {}).gain, far = M.spatial({ x: 0, z: 8 }, { x: 0, z: 0 }, {}).gain;
    check(near > far && far > 0, 'top-down: nearer the ball is louder, nothing goes silent');
    // yaw 0 faces -z (walkMode.js forwardOf), so +x is to the right.
    check(M.spatial({ x: 2, z: 0 }, { x: 0, z: 0 }, { walk: true, yaw: 0 }).pan > 0.5, 'walking: right of you pans right');
    // Turned to face +x (yaw -PI/2), a source at +z is on the right.
    check(M.spatial({ x: 0, z: 2 }, { x: 0, z: 0 }, { walk: true, yaw: -Math.PI / 2 }).pan > 0.5, 'walking: turning turns the world');
    check(M.spatial({ x: 0, z: 6 }, { x: 0, z: 0 }, { walk: true, yaw: 0 }).gain < M.spatial({ x: 0, z: 6 }, { x: 0, z: 0 }, {}).gain, 'walking: distance costs more than from above');

    // The model is pure: no imports, so the engine and Node share it.
    const src = fs.readFileSync(path.join(__dirname, 'soundModel.js'), 'utf8');
    check(!/^\s*import\s/m.test(src), 'soundModel.js imports nothing');
    const game = fs.readFileSync(path.join(__dirname, 'mazeGame.js'), 'utf8');
    check(/addEventListener\('collide'/.test(game), 'the ball reports its hits');

    if (failures.length) {
        console.error('FAIL: sound model\n  - ' + failures.join('\n  - '));
        process.exit(1);
    }
    console.log(`PASS: sound model -- ${themes.size} themes voiced, the roll follows speed, hits follow force, marbles change the voice, and stereo points the right way`);
})().catch(e => { console.error(e); process.exit(1); });
