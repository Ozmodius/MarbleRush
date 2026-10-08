// THE STATS PAGE (GET /admin): one self-contained page, no outside files. It
// asks for the ADMIN_TOKEN (kept in this tab's sessionStorage only), reads
// /v1/admin/stats from the same server, and draws:
//   - players: how many synced, active lately, finished all levels;
//   - per maze level: starts, clear rate, falls per attempt, quits, mean
//     clear time against gold, and how many players STOPPED there (their
//     furthest level is the one before, and they have not been back);
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
.lv { display: grid; grid-template-columns: 4em 1fr 3em; gap: 6px; align-items: center; margin: 3px 0; }
.lv i { display: block; height: 10px; border-radius: 5px; background: #8c6cf0; }
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
function render(r) {
  const maxStop = Math.max(1, ...r.levels.map(l => l.stopped));
  let h = '<div class="tiles">'
    + '<div class="tile"><b>' + r.players.total + '</b><span>players synced</span></div>'
    + '<div class="tile"><b>' + r.players.active + '</b><span>seen in the last ' + r.idle + ' days</span></div>'
    + '<div class="tile"><b>' + (r.players.total - r.players.active) + '</b><span>gone ' + r.idle + '+ days</span></div>'
    + '<div class="tile"><b>' + r.players.finished + '</b><span>of those, cleared every level</span></div>'
    + '</div>';
  h += '<h2>Levels, last ' + r.days + ' days</h2><div class="scroll"><table><thead><tr>'
    + '<th>Level</th><th>Name</th><th>Starts</th><th>Clear rate</th><th>Falls / start</th><th>Quits</th><th>Mean clear</th><th>Gold</th><th>Stopped here</th><th>Explore starts</th><th>Explore clears</th>'
    + '</tr></thead><tbody>';
  let world = 0;
  for (const l of r.levels) {
    if (l.world !== world) { world = l.world; h += '<tr class="world"><td colspan="11">World ' + world + '</td></tr>'; }
    const rate = l.roll.clearRate;
    const fallsPer = l.roll.starts ? (l.roll.falls / l.roll.starts).toFixed(2) : '–';
    const wall = l.stopped >= 3 && l.stopped === maxStop;
    h += '<tr' + (wall ? ' class="wall"' : '') + '><td>' + esc(l.id) + '</td><td>' + esc(l.name) + '</td>'
      + '<td>' + l.roll.starts + '</td>'
      + '<td>' + (rate === null ? '–' : '<span class="bar" style="width:' + Math.round(rate * 60) + 'px"></span><span' + (rate < 0.3 ? ' class="low"' : '') + '>' + pct(rate) + '</span>') + '</td>'
      + '<td>' + fallsPer + '</td><td>' + l.roll.quits + '</td>'
      + '<td>' + sec(l.roll.avgClearMs) + '</td><td class="muted">' + sec(l.goldMs) + '</td>'
      + '<td' + (wall ? ' class="low"' : '') + '>' + l.stopped + '</td>'
      + '<td>' + l.explore.starts + '</td><td>' + l.explore.clears + '</td></tr>';
  }
  h += '</tbody></table></div>';
  if (r.daily.length) {
    h += '<h2>Daily mazes played</h2><div class="scroll"><table><thead><tr><th>Maze</th><th>World</th><th>Starts</th><th>Clear rate</th><th>Falls</th><th>Mean clear</th></tr></thead><tbody>';
    for (const d of r.daily) h += '<tr><td>' + esc(d.id) + '</td><td>' + d.world + '</td><td>' + d.starts + '</td><td>' + pct(d.clearRate) + '</td><td>' + d.falls + '</td><td>' + sec(d.avgClearMs) + '</td></tr>';
    h += '</tbody></table></div>';
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
