// THE STATS PAGE (GET /admin): one self-contained page, no outside files. It
// asks for the ADMIN_TOKEN (kept in this tab's sessionStorage only), reads
// /v1/admin/stats from the same server, and draws:
//   - retention: day-1/7/30 return rates, by the day players started;
//   - activity: players a day, new players, sessions and their length;
//   - the funnel: how many players clear 1, 3, 5, 10 ... levels;
//   - per maze level: starts, clear rate, falls per attempt, quits, mean
//     clear time against gold, the medal split, coins found, what ends runs
//     (and the deadliest hole), revives, and how many players STOPPED there;
//   - actions: purchases, power-ups, rewards claimed, ads, level-ups;
//   - the spread of player levels.
// The level players stop at most, with a low clear rate, is the wall.

export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>PlaneTilt Stats</title>
<style>
:root { --bg: #15100c; --card: #221a14; --ink: #f4ead9; --dim: #b8a88f; --gold: #ffd66e; --bad: #e8634c; --good: #4fd18b; --line: rgba(255,255,255,0.08); }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 20px 16px 48px; }
h1 { margin: 0 0 4px; font-size: 1.5rem; letter-spacing: 0.06em; color: var(--gold); }
h2 { margin: 28px 0 10px; font-size: 1rem; letter-spacing: 0.12em; color: var(--dim); text-transform: uppercase; }
.sub { color: var(--dim); margin: 0 0 16px; }
form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
input, select, button { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
button { background: var(--gold); color: #2a1a08; font-weight: 800; border: 0; cursor: pointer; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.tile { background: var(--card); border-radius: 12px; padding: 12px 14px; }
.tile b { display: block; font-size: 1.6rem; font-variant-numeric: tabular-nums; }
.tile span { color: var(--dim); font-size: 0.8rem; }
.scroll { overflow-x: auto; background: var(--card); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { color: var(--dim); font-weight: 600; font-size: 0.78rem; position: sticky; top: 0; background: var(--card); }
td:first-child, th:first-child, td:nth-child(2), th:nth-child(2) { text-align: left; }
tr.world td { background: rgba(255, 214, 110, 0.08); color: var(--gold); font-weight: 800; text-align: left; }
.bar { display: inline-block; height: 8px; border-radius: 4px; background: var(--good); vertical-align: middle; margin-right: 6px; }
.low { color: var(--bad); font-weight: 800; }
.wall { background: rgba(232, 99, 76, 0.18); }
.muted { color: var(--dim); }
.err { color: var(--bad); }
.lv { display: grid; grid-template-columns: 5.5em 1fr 3em; gap: 6px; align-items: center; margin: 3px 0; }
.lv i { display: block; height: 10px; border-radius: 5px; background: #8c6cf0; }
.chart { display: flex; align-items: flex-end; gap: 3px; height: 120px; padding: 10px 12px 0; background: var(--card); border-radius: 12px 12px 0 0; }
.chart div { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; min-width: 4px; height: 100%; }
.chart b { display: block; background: #4fa3e8; border-radius: 3px 3px 0 0; }
.chart b.new { background: var(--gold); border-radius: 0; }
.chart-x { display: flex; justify-content: space-between; padding: 4px 12px 10px; background: var(--card); border-radius: 0 0 12px 12px; color: var(--dim); font-size: 0.75rem; }
.key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px 0 12px; vertical-align: middle; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
.medal { display: inline-flex; height: 8px; width: 60px; border-radius: 4px; overflow: hidden; vertical-align: middle; background: rgba(255,255,255,0.08); }
.medal i { display: block; height: 100%; }
td.left { text-align: left; }
</style>
</head>
<body>
<main>
<h1>PlaneTilt Stats</h1>
<p class="sub">Anonymous play counts from the game, and where players stop.</p>
<form id="f">
  <input id="key" type="password" placeholder="Admin token" autocomplete="off" size="28">
  <select id="days"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select>
  <select id="idle"><option value="3">Gone 3+ days</option><option value="7" selected>Gone 7+ days</option><option value="14">Gone 14+ days</option></select>
  <button type="submit">Load</button>
  <span id="msg" class="muted"></span>
</form>
<div id="out"></div>
</main>
<script>
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => x === null ? '–' : Math.round(x * 100) + '%';
const sec = ms => ms === null ? '–' : (ms / 1000).toFixed(1) + 's';
try { $('key').value = sessionStorage.getItem('planetilt.admin') || ''; } catch (e) {}
async function load(ev) {
  if (ev) ev.preventDefault();
  const key = $('key').value.trim();
  if (!key) { $('msg').textContent = 'Enter the ADMIN_TOKEN set on the server.'; return; }
  try { sessionStorage.setItem('planetilt.admin', key); } catch (e) {}
  $('msg').textContent = 'Loading…';
  let r;
  try {
    const res = await fetch('/v1/admin/stats?days=' + $('days').value + '&idle=' + $('idle').value, { headers: { Authorization: 'Bearer ' + key } });
    if (!res.ok) { $('msg').innerHTML = '<span class="err">' + (res.status === 404 ? 'Wrong token, or no ADMIN_TOKEN on the server.' : 'Error ' + res.status) + '</span>'; return; }
    r = await res.json();
  } catch (e) { $('msg').innerHTML = '<span class="err">Could not reach the server.</span>'; return; }
  $('msg').textContent = '';
  render(r);
}
const pctOr = (x, dash = '–') => x === null || x === undefined ? dash : Math.round(x * 100) + '%';
const mins = ms => ms === null ? '–' : ms >= 60000 ? (ms / 60000).toFixed(1) + ' min' : Math.round(ms / 1000) + 's';
const CAUSE = { hole: 'Holes', icicle: 'Icicles', flare: 'Flares', molten: 'Molten gates', shock: 'Rails', crush: 'Crushers', other: 'Other' };
const GROUPS = [['buy:', 'Purchases'], ['use:', 'Power-ups and prizes used'], ['claim:', 'Rewards claimed'], ['ad:', 'Rewarded ads watched'], ['levelup:', 'Player level-ups'], ['account:', 'Accounts'], ['landing:', 'Front door (landing site: shown, create, sign in, guest)'], ['', 'Other']];
function render(r) {
  const maxStop = Math.max(1, ...r.levels.map(l => l.stopped));
  const ret = r.retention || {}, act = r.activity || { byDay: [] };
  const today = act.byDay.length ? act.byDay[act.byDay.length - 1] : { dau: 0, new: 0 };
  let h = '<div class="tiles">'
    + '<div class="tile"><b>' + today.dau + '</b><span>players today (' + today.new + ' new)</span></div>'
    + '<div class="tile"><b>' + pctOr(ret.d1) + '</b><span>come back the next day</span></div>'
    + '<div class="tile"><b>' + pctOr(ret.d7) + '</b><span>come back after a week</span></div>'
    + '<div class="tile"><b>' + pctOr(ret.d30) + '</b><span>come back after a month</span></div>'
    + '<div class="tile"><b>' + mins(act.avgSessionMs) + '</b><span>average session (' + act.sessions + ' sessions)</span></div>'
    + '<div class="tile"><b>' + r.players.total + '</b><span>players in all; ' + (r.players.total - r.players.active) + ' gone ' + r.idle + '+ days</span></div>'
    + '</div>';
  // Activity chart: players a day, the new ones on top.
  const maxDau = Math.max(1, ...act.byDay.map(d => d.dau));
  h += '<h2>Players a day<span class="key" style="background:#4fa3e8"></span>returning<span class="key" style="background:var(--gold)"></span>new</h2><div class="chart">'
    + act.byDay.map(d => '<div title="' + d.day + ': ' + d.dau + ' players, ' + d.new + ' new, ' + d.sessions + ' sessions, ' + mins(d.playMsPerDau) + ' a player"><b class="new" style="height:' + (d.new / maxDau * 100) + '%"></b><b style="height:' + (Math.max(0, d.dau - d.new) / maxDau * 100) + '%"></b></div>').join('')
    + '</div><div class="chart-x"><span>' + (act.byDay[0] ? act.byDay[0].day : '') + '</span><span>' + (act.byDay.length ? act.byDay[act.byDay.length - 1].day : '') + '</span></div>';
  // Retention by start day, and the funnel.
  h += '<div class="grid2"><div><h2>Return rate by start day</h2><div class="scroll"><table><thead><tr><th>Started</th><th>Players</th><th>Day 1</th><th>Day 7</th><th>Day 30</th></tr></thead><tbody>'
    + (ret.cohorts && ret.cohorts.length ? ret.cohorts.slice().reverse().map(c => '<tr><td>' + c.day + '</td><td>' + c.size + '</td><td>' + pctOr(c.d1, '…') + '</td><td>' + pctOr(c.d7, '…') + '</td><td>' + pctOr(c.d30, '…') + '</td></tr>').join('') : '<tr><td colspan="5" class="muted left">No new players yet.</td></tr>')
    + '</tbody></table></div><p class="sub">… = not that many days ago yet.</p></div>';
  h += '<div><h2>Funnel: players who cleared</h2><div class="tile">' + (r.funnel || []).map(f => '<div class="lv"><span>' + f.cleared + (f.cleared === 1 ? ' level' : ' levels') + '</span><i style="width:' + Math.max(1, Math.round((f.share || 0) * 100)) + '%;background:#4fd18b"></i><span>' + pctOr(f.share) + '</span></div>').join('') + '</div></div></div>';
  // Levels.
  h += '<h2>Levels, last ' + r.days + ' days</h2><div class="scroll"><table><thead><tr>'
    + '<th>Level</th><th>Name</th><th>Starts</th><th>Clear rate</th><th>Falls / start</th><th>Quits</th><th>Mean clear</th><th>Gold</th><th>Medals G/S/B</th><th>Coins found</th><th>What ends runs</th><th>Deadliest hole</th><th>Revives</th><th>Stopped here</th><th>Explore starts</th><th>Explore clears</th>'
    + '</tr></thead><tbody>';
  let world = 0;
  for (const l of r.levels) {
    if (l.world !== world) { world = l.world; h += '<tr class="world"><td colspan="16">World ' + world + '</td></tr>'; }
    const R = l.roll, rate = R.clearRate;
    const fallsPer = R.starts ? (R.falls / R.starts).toFixed(2) : '–';
    const wall = l.stopped >= 3 && l.stopped === maxStop;
    const m = R.medals;
    const medals = m ? '<span class="medal" title="gold ' + pctOr(m.gold) + ', silver ' + pctOr(m.silver) + ', bronze ' + pctOr(m.bronze) + '"><i style="width:' + m.gold * 100 + '%;background:#f2c94c"></i><i style="width:' + m.silver * 100 + '%;background:#c9d1d9"></i><i style="width:' + m.bronze * 100 + '%;background:#c47f45"></i></span> ' + pctOr(m.gold) : '–';
    const causes = Object.entries(R.causes || {}).sort((a, b) => b[1] - a[1]);
    const totalFalls = causes.reduce((a, c) => a + c[1], 0);
    const killer = causes.length ? esc(CAUSE[causes[0][0]] || causes[0][0]) + ' ' + pctOr(causes[0][1] / totalFalls) : '–';
    const hole = R.worstHole ? '#' + (R.worstHole.index + 1) + ' (' + pctOr(R.worstHole.share) + ')' : '–';
    h += '<tr' + (wall ? ' class="wall"' : '') + '><td>' + esc(l.id) + '</td><td>' + esc(l.name) + '</td>'
      + '<td>' + R.starts + '</td>'
      + '<td>' + (rate === null ? '–' : '<span class="bar" style="width:' + Math.round(rate * 60) + 'px"></span><span' + (rate < 0.3 ? ' class="low"' : '') + '>' + pct(rate) + '</span>') + '</td>'
      + '<td>' + fallsPer + '</td><td>' + R.quits + '</td>'
      + '<td>' + sec(R.avgClearMs) + '</td><td class="muted">' + sec(l.goldMs) + '</td>'
      + '<td>' + medals + '</td><td>' + pctOr(R.coinsFound) + '</td>'
      + '<td>' + killer + '</td><td>' + hole + '</td><td>' + (R.revives || 0) + '</td>'
      + '<td' + (wall ? ' class="low"' : '') + '>' + l.stopped + '</td>'
      + '<td>' + l.explore.starts + '</td><td>' + l.explore.clears + '</td></tr>';
  }
  h += '</tbody></table></div>';
  h += '<p class="sub">Medals: the split of clears into gold, silver and bronze; few golds means the gold time may be too tight. What ends runs: the most common cause, with its share of falls. Deadliest hole: the hole that takes the most balls, numbered as in the level file.</p>';
  if (r.daily.length) {
    h += '<h2>Daily mazes played</h2><div class="scroll"><table><thead><tr><th>Maze</th><th>World</th><th>Starts</th><th>Clear rate</th><th>Falls</th><th>Mean clear</th></tr></thead><tbody>';
    for (const d of r.daily) h += '<tr><td>' + esc(d.id) + '</td><td>' + d.world + '</td><td>' + d.starts + '</td><td>' + pct(d.clearRate) + '</td><td>' + d.falls + '</td><td>' + sec(d.avgClearMs) + '</td></tr>';
    h += '</tbody></table></div>';
  }
  // Actions, grouped.
  const acts = r.actions || [];
  h += '<h2>What players do, last ' + r.days + ' days</h2>';
  if (!acts.length) h += '<p class="muted">Nothing yet.</p>';
  else {
    h += '<div class="grid2">';
    const used = new Set();
    for (const [prefix, title] of GROUPS) {
      const rows = acts.filter(a => !used.has(a.name) && a.name.startsWith(prefix));
      rows.forEach(a => used.add(a.name));
      if (!rows.length) continue;
      h += '<div><div class="scroll"><table><thead><tr><th>' + title + '</th><th></th></tr></thead><tbody>'
        + rows.slice(0, 25).map(a => '<tr><td>' + esc(a.name.slice(prefix.length)) + '</td><td>' + a.n + '</td></tr>').join('')
        + '</tbody></table></div></div>';
    }
    h += '</div>';
  }
  const lv = Object.entries(r.playerLevels).map(([k, n]) => [Number(k), n]).sort((a, b) => a[0] - b[0]);
  const maxN = Math.max(1, ...lv.map(x => x[1]));
  h += '<h2>Player levels</h2><div class="tile">' + (lv.length ? lv.map(([k, n]) => '<div class="lv"><span>Lv ' + k + '</span><i style="width:' + Math.max(2, Math.round(n / maxN * 100)) + '%"></i><span>' + n + '</span></div>').join('') : '<span class="muted">No players yet.</span>') + '</div>';
  h += '<p class="sub" style="margin-top:16px">"Stopped here": players whose furthest clear is the level before this one and who have not played for the chosen time. The highlighted row is where most stop.</p>';
  $('out').innerHTML = h;
}
$('f').addEventListener('submit', load);
if ($('key').value) load();
</script>
</body>
</html>`;
