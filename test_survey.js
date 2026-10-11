#!/usr/bin/env node
// PLANETILT: the survey (survey.js) -- how much of a level's floor a run covers.
//   1. Every level (ladder and daily) has survey squares, only where a ball
//      can get to.
//   2. Rolling the shortest route alone never surveys a level (it is a
//      reason to explore), and on average covers well under half.
//   3. A sweep of the whole reachable floor covers 100%: SURVEYED (90%) is
//      always within reach.
//   4. Marking is idempotent and capped; the save's best is read safely.
//
// Negative control: make surveyMap count every square (walls and holes too)
// and 3 fails; set SURVEYED to 10 and 2 fails.
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
(async () => {
    const fs = await import('fs');
    const V = await import('./survey.js');
    const L = await import('./levelSpots.js');
    const levels = JSON.parse(fs.readFileSync('./mazeLevels.json', 'utf8')).levels;
    const daily = JSON.parse(fs.readFileSync('./dailyLevels.json', 'utf8')).levels;
    let routeSum = 0, routeMax = 0, n = 0;
    for (const lv of [...levels, ...daily.slice(0, 12)]) {
        const m = V.surveyMap(lv);
        check(m.total > 20, `${lv.id}: has survey squares (${m.total})`);
        const g = L.levelGrid(lv);
        // The shortest route, cell by cell from the exit back to the start.
        const run = V.createSurvey(lv);
        let k = g.e, guard = 0;
        while (k !== g.s && guard++ < 1e5) {
            const p = g.at(k);
            run.mark(p.x, p.z);
            const i = k % g.nx, j = (k / g.nx) | 0;
            let best = k;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                const a = i + di, b = j + dj;
                if (a < 0 || b < 0 || a >= g.nx || b >= g.nz) continue;
                const q = a + b * g.nx;
                if (g.fromStart[q] < g.fromStart[best]) best = q;
            }
            if (best === k) break;
            k = best;
        }
        run.mark(lv.start.x, lv.start.z);
        check(run.pct < V.SURVEYED, `${lv.id}: the shortest route alone does not survey it (${run.pct}%)`);
        routeSum += run.pct; routeMax = Math.max(routeMax, run.pct); n++;
        // A sweep of every reachable cell.
        const sweep = V.createSurvey(lv);
        for (let q = 0; q < g.pass.length; q++) if (g.pass[q] && Number.isFinite(g.fromStart[q])) { const p = g.at(q); sweep.mark(p.x, p.z); }
        check(sweep.pct === 100, `${lv.id}: sweeping the floor surveys it all (${sweep.pct}%)`);
        const before = sweep.covered;
        sweep.mark(lv.start.x, lv.start.z);
        check(sweep.covered === before, `${lv.id}: marking twice counts once`);
    }
    check(routeSum / n < 50, `the shortest route covers well under half on average (${(routeSum / n).toFixed(0)}%)`);
    check(V.surveyOf({ survey: { w1_01: 140 } }, 'w1_01') === 100 && V.surveyOf({}, 'w1_01') === 0 && V.surveyOf({ survey: { w1_01: 'x' } }, 'w1_01') === 0, 'the save\'s best is read safely');
    check(V.isSurveyed({ survey: { w1_01: 90 } }, 'w1_01') && !V.isSurveyed({ survey: { w1_01: 89 } }, 'w1_01'), 'surveyed at 90%');
    // The save: the best kept, never lowered, junk dropped.
    const P = await import('./progressStore.js');
    let rs = P.recordSurvey(P.freshProgress(), 'w1_03', 64.7);
    check(rs.ok && rs.progress.survey.w1_03 === 64 && rs.before === 0, 'a survey is kept in whole percent');
    check(!P.recordSurvey(rs.progress, 'w1_03', 50).ok && P.recordSurvey(rs.progress, 'w1_03', 50).best === 64, 'a worse one changes nothing');
    check(P.recordSurvey(rs.progress, 'w1_03', 91).progress.survey.w1_03 === 91, 'a better one replaces it');
    check(!P.recordSurvey(rs.progress, 'd1_01', 99).ok, 'the daily maze is not surveyed');
    const junk = P.parseProgress(JSON.stringify({ ...P.freshProgress(), survey: { w1_01: 140, w1_02: -3, d1_01: 50, bad: 9, w1_04: 'x', w1_05: 77.9 } }));
    check(JSON.stringify(junk.survey) === '{"w1_01":100,"w1_05":77}', `a save's surveys are cleaned: ${JSON.stringify(junk.survey)}`);
    if (failures.length) { console.log('FAIL: survey'); for (const f of failures) console.log(' - ' + f); process.exitCode = 1; }
    else console.log(`PASS: survey -- every level has squares where a ball can go, the shortest route alone covers ${(routeSum / n).toFixed(0)}% on average (at most ${routeMax}%, never a survey), and a sweep of the floor covers it all`);
})();
