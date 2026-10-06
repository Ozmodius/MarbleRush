const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const out = process.argv[2];
  const levels = JSON.parse(fs.readFileSync('mazeLevels.json', 'utf8')).levels;
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // A returning player on day 3 of a streak: claimed yesterday.
  await p.addInitScript(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('marbleRush.progress.v1', JSON.stringify({ v: 1, wallet: 1240, highestIndex: 3, cleared: {}, goldClaimed: [], prizes: [], charges: { shield: 2, slowmo: 1, magnet: 3 }, daily: { streak: 2, last: key } }));
    }
  });
  const dbg = (fn, ...a) => p.evaluate(([f, x]) => window.__mazeDebug[f](...x), [fn, a]);
  await p.goto('http://localhost:8766/');
  await p.waitForSelector('#dailyPanel:not([hidden])', { timeout: 30000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: out + '-daily.png' });
  await p.click('#dailyClaimBtn'); await p.waitForTimeout(400);
  await p.screenshot({ path: out + '-daily-claimed.png' });
  await p.click('#dailyCloseBtn');
  // Play level 1 to a near miss: 0.4s over gold.
  const lv = levels[0];
  await p.click('#homePlayBtn');
  await p.waitForSelector('#mazeStartBtn', { state: 'visible' });
  await p.click('#mazeStartBtn');
  await p.waitForFunction(() => window.__mazeDebug.phase() === 'running');
  for (const c of lv.coins) { await dbg('placeBall', c.x, c.z); await dbg('advanceFrames', 1); }
  await dbg('ageRun', lv.goldMs + 400);
  await dbg('warpToGoal');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: out + '-nearmiss.png' });
  await p.click('#mazeLevelsBtn');
  await p.click('#tab_home');
  await p.waitForTimeout(800);
  await p.screenshot({ path: out + '-home.png' });
  await p.click('#homeMissionsBtn'); await p.waitForTimeout(2000);
  await p.screenshot({ path: out + '-missions.png' });
  console.log('errors', errs, await dbg('progress').then(x => JSON.stringify(x.missions)));
  await b.close();
})();
