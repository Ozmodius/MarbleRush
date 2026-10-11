// THE MISSION (the user's call, 2026-10-11: "make sure the main objectives
// are clear"): what a level asks of the player, shown on its ready screen
// (mazeGame.js #mazeMission) before START, in the order they are done.
//
//   cage  on a planet's floor 10 with its friend still caged: free them (the
//         exit stays locked until then)
//   exit  always: reach the exit
//   fuel  on every ladder level: the fuel cell, found in Explore mode only
//         (fuel.js) -- so walking it comes before the exit, and rolling it
//         is the job after (explore it); with what the ship still needs from
//         this planet to fly on (or that it is fueled)
//
// The daily maze is only a race to the exit: no card. Pure, so Node tests it.

import { captiveFor, isRescueLevel } from './rescue.js';
import { fuelSpot, fuelCount, launchNeed } from './fuel.js';
import { worldName } from './worlds.js';

const LADDER = /^w\d+_\d+$/;

// lv: the level; prog: the save; walk: Explore mode; nextBuilt: a planet
// after this one exists. -> { rows: [{ kind, text, note, done }] } or null.
export function missionFor(lv, prog = {}, { walk = false, nextBuilt = false } = {}) {
    if (!lv || !LADDER.test(String(lv.id || '')) || !Number.isInteger(lv.world)) return null;
    const rows = [];
    const cap = captiveFor(lv.world);
    const caged = !walk && cap && isRescueLevel(lv) && !(prog.rescued || []).includes(lv.world);
    if (caged) rows.push({ kind: 'cage', text: `Free ${cap.name} from the cage`, note: '', done: false });
    if (fuelSpot(lv)) {
        const found = (prog.fuel || []).includes(lv.id);
        const need = launchNeed(lv.world + 1), have = fuelCount(prog, lv.world);
        const next = worldName(lv.world + 1);
        // The note is a short tag: what the ship needs from this planet to
        // fly on, or that it is fueled.
        const note = !nextBuilt ? '' : have >= need ? `Ship fueled for ${next}` : `${have} / ${need} to fly to ${next}`;
        const fuel = { kind: 'fuel', text: found ? 'Fuel cell found' : walk ? 'Find the fuel cell' : 'Then explore it for the fuel cell', note, done: found };
        if (walk) rows.push(fuel, { kind: 'exit', text: 'Reach the exit', note: '', done: false });
        else rows.push({ kind: 'exit', text: caged ? 'Then reach the exit' : 'Reach the exit', note: '', done: false }, fuel);
    } else rows.push({ kind: 'exit', text: caged ? 'Then reach the exit' : 'Reach the exit', note: '', done: false });
    return { rows };
}
