import { DAILY_CALENDAR, CHARGES, MISSIONS_BONUS, LOOKS, LEVEL_REWARDS } from './shopCatalog.js';
import { rewardFor } from './playerLevel.js';
import { adsAvailable, showRewardedAd, adFailureMessage } from './platform.js';
import { sfx } from './sfx.js';
import { rewardText } from './daily.js';

// THE HOME PANELS: REWARDS -- one card from the side rail with a tab each for
// the 7-day calendar, the day's three missions and the achievements -- and
// the player level card (a level-up, or what the next levels bring).
// The rules are daily.js's, reached through the progress store; this module
// only draws them and turns taps into store calls.
//
// initDailyUi({ store, onChange }) once; onChange() after anything that moved
// the wallet or the charges, so the HUD redraws.

let ctx = null;
// The calendar opens by itself once per session while a reward waits: the
// first thing a returning player sees is what coming back earned them.
let autoShown = false;
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-US');

function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function untilTomorrow() {
    const m = Math.ceil(ctx.store.msUntilTomorrow() / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// One reward as icons and numbers: a coin and its amount, then a gem per
// power-up (the colours the maze's pickups use).
function rewardBits(reward) {
    const wrap = h('span', 'reward-bits');
    if (reward.coins) wrap.append(h('span', 'coin-icon reward-coin'), h('span', 'reward-amt', fmt(reward.coins)));
    for (const [id, n] of Object.entries(reward.charges || {})) {
        const g = h('span', 'reward-gem');
        g.title = CHARGES[id] ? CHARGES[id].name : id;
        g.append(h('span', 'pu-dot pu-' + id));
        if (n > 1) g.append(h('span', 'reward-amt', '×' + n));
        wrap.append(g);
    }
    return wrap;
}

function rewardWords(reward) {
    const parts = [];
    if (reward.coins) parts.push(`+${fmt(reward.coins)} coins`);
    for (const [id, n] of Object.entries(reward.charges || {})) parts.push(`+${n} ${CHARGES[id] ? CHARGES[id].name : id}`);
    return parts.join(', ');
}

// --- the calendar -----------------------------------------------------------
function renderDaily(message) {
    const s = ctx.store.dailyStatus();
    // Claimed today: tomorrow's tile is marked (after day 7, a new week's
    // day 1 -- the tiles are all done, so no tile is marked).
    const t = s.claimed ? ctx.store.tomorrowDaily() : null;
    const grid = $('dailyGrid');
    grid.innerHTML = '';
    DAILY_CALENDAR.forEach((reward, i) => {
        const n = i + 1;
        const done = n < s.day || (n === s.day && s.claimed);
        const today = n === s.day;
        const tomorrow = !!(t && n === t.day && t.day > s.day);
        const tile = h('div', 'daily-tile' + (done ? ' is-claimed' : '') + (today && !s.claimed ? ' is-today' : '') + (tomorrow ? ' is-tomorrow' : '') + (n === DAILY_CALENDAR.length ? ' is-big' : ''));
        tile.append(h('span', 'daily-day', 'DAY ' + n), rewardBits(reward));
        if (done) tile.append(h('span', 'daily-check', '✓'));
        if (tomorrow) tile.append(h('span', 'daily-tomorrow', 'TOMORROW'));
        grid.append(tile);
    });
    const claim = $('dailyClaimBtn');
    claim.disabled = !s.canClaim;
    claim.textContent = s.canClaim ? 'CLAIM' : 'CLAIMED';
    const dbl = $('dailyDoubleBtn');
    dbl.hidden = !(s.canDouble && adsAvailable());
    $('dailyDoubleText').textContent = '×2 COINS  +' + fmt(s.reward.coins || 0);
    $('dailyNote').textContent = message || dailyNoteText(s, t);
}

// The calendar's line: what today is, what the streak is worth keeping for,
// and -- once claimed -- exactly what tomorrow brings and when.
function dailyNoteText(s, t) {
    const last = DAILY_CALENDAR.length;
    const big = rewardText(DAILY_CALENDAR[last - 1]);
    if (!s.canClaim) return `Day ${t.day} tomorrow: ${rewardText(t.reward)}, in ${untilTomorrow()}.`;
    if (s.restarted) return `Your streak started over. Every day in a row to day ${last}: ${big}!`;
    if (s.day === last) return `Day ${last}! The big one: ${big}.`;
    if (s.day > 1) return `Day ${s.day} in a row! Keep going to day ${last}: ${big}.`;
    return `Day 1 of ${last}. Come back every day: day ${last} pays ${big}.`;
}

function claimDaily() {
    const out = ctx.store.claimDaily();
    if (!out.ok) return;
    try { sfx.coin(); } catch (_) { /* ignore */ }
    const t = ctx.store.tomorrowDaily();
    renderDaily(`Day ${out.day}: ${rewardWords(out.reward)}! Tomorrow, day ${t.day}: ${rewardText(t.reward)}.`);
    renderTabBadges();
    ctx.onChange();
}

async function doubleDaily() {
    const btn = $('dailyDoubleBtn');
    btn.disabled = true;
    const ok = await showRewardedAd();
    btn.disabled = false;
    if (ok) {
        const out = ctx.store.adDoubleDaily();
        if (out.ok) { try { sfx.coin(); } catch (_) { /* ignore */ } renderDaily(`Doubled: +${fmt(out.amount)} coins!`); ctx.onChange(); return; }
    }
    renderDaily(ok ? null : adFailureMessage());
}

// --- missions -----------------------------------------------------------------
function renderMissions(message) {
    const list = ctx.store.missions();
    const box = $('missionsList');
    box.innerHTML = '';
    for (const m of list) {
        const row = h('div', 'mission' + (m.claimed ? ' is-claimed' : m.done ? ' is-done' : ''));
        const body = h('div', 'mission-body');
        body.append(h('p', 'mission-text', m.text));
        const bar = h('div', 'mission-track');
        const fill = h('span', 'mission-fill');
        fill.style.width = (100 * m.count / m.goal).toFixed(0) + '%';
        bar.append(fill);
        body.append(bar, h('p', 'mission-count', `${fmt(m.count)} / ${fmt(m.goal)}`));
        row.append(body);
        let side;
        if (m.claimed) side = h('span', 'mission-check', '✓');
        else if (m.done) {
            side = h('button', 'maze-btn maze-btn-big mission-claim');
            side.type = 'button';
            side.dataset.mission = m.id;
            side.append(h('span', 'coin-icon reward-coin'), document.createTextNode(fmt(m.reward)));
            side.addEventListener('click', (e) => { e.preventDefault(); claimMission(m.id); });
        } else {
            side = h('span', 'mission-reward');
            side.append(h('span', 'coin-icon reward-coin'), document.createTextNode(fmt(m.reward)));
        }
        row.append(side);
        box.append(row);
    }
    const all = list.length > 0 && list.every(m => m.claimed);
    $('missionsBonus').textContent = all ? `All done! +${fmt(MISSIONS_BONUS)} bonus collected.` : `Finish all ${list.length}: +${fmt(MISSIONS_BONUS)} bonus`;
    $('missionsBonus').classList.toggle('is-won', all);
    $('missionsNote').textContent = message || `New missions in ${untilTomorrow()}`;
}

function claimMission(id) {
    const out = ctx.store.claimMission(id);
    if (!out.ok) return;
    try { sfx.coin(); } catch (_) { /* ignore */ }
    renderMissions(out.bonus ? `+${fmt(out.reward)} coins, and +${fmt(out.bonus)} for finishing them all!` : `+${fmt(out.reward)} coins!`);
    renderTabBadges();
    ctx.onChange();
}

// --- achievements (achievements.js) ----------------------------------------------
function renderAchievements(message) {
    const list = ctx.store.achievements();
    const box = $('achievementsList');
    box.innerHTML = '';
    for (const a of list) {
        const row = h('div', 'mission achievement' + (a.claimed ? ' is-claimed' : a.done ? ' is-done' : ''));
        const body = h('div', 'mission-body');
        body.append(h('p', 'achievement-name', a.name), h('p', 'mission-text', a.text));
        if (a.goal > 1) {
            const bar = h('div', 'mission-track');
            const fill = h('span', 'mission-fill');
            fill.style.width = (100 * a.count / a.goal).toFixed(0) + '%';
            bar.append(fill);
            body.append(bar, h('p', 'mission-count', `${fmt(a.count)} / ${fmt(a.goal)}`));
        }
        row.append(body);
        let side;
        if (a.claimed) side = h('span', 'mission-check', '✓');
        else if (a.done) {
            side = h('button', 'maze-btn maze-btn-big mission-claim');
            side.type = 'button';
            side.dataset.achievement = a.id;
            side.append(h('span', 'coin-icon reward-coin'), document.createTextNode(fmt(a.coins)));
            side.addEventListener('click', (e) => { e.preventDefault(); claimAchievementRow(a.id); });
        } else {
            side = h('span', 'mission-reward');
            side.append(h('span', 'coin-icon reward-coin'), document.createTextNode(fmt(a.coins)));
        }
        row.append(side);
        box.append(row);
    }
    const got = list.filter(a => a.claimed).length;
    $('achievementsNote').textContent = message || `${got} of ${list.length} unlocked`;
}

function claimAchievementRow(id) {
    const out = ctx.store.claimAchievement(id);
    if (!out.ok) return;
    try { sfx.coin(); } catch (_) { /* ignore */ }
    const a = ctx.store.achievements().find(x => x.id === id);
    renderAchievements(`${a ? a.name : 'Achievement'}: +${fmt(out.coins)} coins!`);
    renderTabBadges();
    ctx.onChange();
}

// --- player level -------------------------------------------------------------
function lookName(look) {
    const [kind, id] = look;
    return `${LOOKS[kind].table[id].name} ${kind}`;
}
// One line per thing a level gives.
function rewardLines(r) {
    const out = [];
    if (r.look) out.push({ cls: 'is-look', text: lookName(r.look) });
    for (const [id, n] of Object.entries(r.charges || {})) out.push({ cls: 'pu-dot pu-' + id, text: `${n} ${CHARGES[id] ? CHARGES[id].name : id}` });
    out.push({ cls: 'coin-icon reward-coin', text: `${fmt(r.coins)} coins` });
    return out;
}

// gained: [{ level, reward }] from the store, or [] to just show the level.
function renderLevel(gained) {
    const info = ctx.store.playerLevel();
    const up = gained.length > 0;
    $('levelTitle').textContent = up ? 'LEVEL UP!' : 'PLAYER LEVEL';
    $('levelBig').textContent = String(info.level);
    $('levelPanel').classList.toggle('is-up', up);
    $('levelNote').textContent = up
        ? (gained.length > 1 ? `You climbed ${gained.length} levels!` : `Welcome to level ${info.level}.`)
        : `${fmt(info.need - info.into)} XP to level ${info.level + 1}. Clears, golds and missions all count.`;
    const box = $('levelRewards');
    box.innerHTML = '';
    box.hidden = !up;
    // Everything the climb paid: the looks and power-ups, then the coins as
    // one total (a row per level's coins would bury the good stuff).
    const lines = [];
    let coins = 0;
    for (const g of gained) {
        coins += g.reward.coins;
        lines.push(...rewardLines({ ...g.reward, coins: 0 }).filter(x => !/^0 coins$/.test(x.text)));
    }
    if (coins) lines.push({ cls: 'coin-icon reward-coin', text: `${fmt(coins)} coins` });
    for (const line of lines) {
        const row = h('div', 'level-reward');
        row.append(h('span', line.cls === 'is-look' ? 'level-lookicon' : line.cls), h('span', '', line.text));
        box.append(row);
    }
    // The next three levels with something more than coins.
    const next = $('levelNext');
    next.innerHTML = '';
    const ahead = Object.keys(LEVEL_REWARDS).map(Number).filter(L => L > info.level).slice(0, 3);
    for (const L of ahead) {
        const r = rewardFor(L);
        const row = h('div', 'level-nextrow');
        row.append(h('span', 'level-nextnum', 'LV ' + L), h('span', 'level-nexttext', rewardLines(r).map(x => x.text).join(' · ')));
        next.append(row);
    }
    if (!ahead.length) next.append(h('p', 'level-nexttext', 'Every reward is yours. Levels still pay coins.'));
}

// Shows any level-ups the store is holding; true if it opened.
export function showLevelUps() {
    if (!ctx) return false;
    const gained = ctx.store.takeLevelUps();
    if (!gained.length) return false;
    open('levelPanel', gained);
    try { sfx.open(); } catch (_) { /* ignore */ }
    return true;
}

// --- open, close, badges --------------------------------------------------------
const PANELS = ['rewardsPanel', 'levelPanel'];
const TABS = {
    daily: { pane: 'dailyPanel', render: () => renderDaily(), ready: () => (ctx.store.dailyStatus().canClaim ? 1 : 0) },
    missions: { pane: 'missionsPanel', render: () => renderMissions(), ready: () => ctx.store.missionsReady() },
    achievements: { pane: 'achievementsPanel', render: () => renderAchievements(), ready: () => ctx.store.achievementsReady() }
};
let tabNow = 'daily';

function showTab(tab) {
    tabNow = TABS[tab] ? tab : 'daily';
    for (const [t, def] of Object.entries(TABS)) {
        const on = t === tabNow;
        const b = $('rewardsTab_' + t);
        if (b) { b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
        $(def.pane).hidden = !on;
    }
    TABS[tabNow].render();
    renderTabBadges();
}

// The rewards card opens on `tab`, or else on the first tab with something
// to claim (the calendar when nothing waits).
function openRewards(tab) {
    closeDailyPanels();
    const pick = tab || Object.keys(TABS).find(t => TABS[t].ready() > 0) || 'daily';
    $('rewardsPanel').hidden = false;
    showTab(pick);
}

function open(id, gained = []) {
    if (id === 'rewardsPanel') { openRewards('daily'); return; }
    closeDailyPanels();
    renderLevel(gained);
    $(id).hidden = false;
}
export function closeDailyPanels() {
    for (const id of PANELS) { const e = $(id); if (e) e.hidden = true; }
    renderDailyButtons();
}

// A dot on each tab with something to claim.
function renderTabBadges() {
    for (const [t, def] of Object.entries(TABS)) {
        const d = $('rewardsBadge_' + t);
        if (d) d.hidden = def.ready() === 0;
    }
}

// The side rail's badge: everything waiting to be claimed, across the tabs.
export function renderDailyButtons() {
    if (!ctx) return;
    // The level bar under the HUD chips.
    const info = ctx.store.playerLevel();
    const lv = $('homePlayerLevel');
    if (lv) {
        lv.textContent = String(info.level);
        $('homeXpFill').style.width = (100 * info.into / info.need).toFixed(1) + '%';
        $('homeXpText').textContent = `${fmt(info.into)} / ${fmt(info.need)} XP`;
    }
    const b = $('homeRewardsBadge');
    if (b) {
        const n = Object.values(TABS).reduce((sum, def) => sum + def.ready(), 0);
        b.hidden = n === 0;
        b.textContent = String(n);
    }
}

// On arriving home: the calendar opens by itself, once a session, when today's
// reward has not been claimed.
// Never for a player who has not cleared a level yet: their first minutes are
// for the game, and the calendar is still on the REWARDS button.
export function maybeAutoOpenDaily() {
    if (!ctx || autoShown) return;
    const p = ctx.store.get();
    if (!Object.keys((p && p.cleared) || {}).length) return;
    autoShown = true;
    if (ctx.store.dailyStatus().canClaim) openRewards('daily');
}

export function initDailyUi({ store, onChange }) {
    ctx = { store, onChange: onChange || (() => {}) };
    const tap = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', (e) => { e.preventDefault(); fn(); }); };
    tap('homeRewardsBtn', () => openRewards());
    for (const t of Object.keys(TABS)) tap('rewardsTab_' + t, () => showTab(t));
    tap('dailyClaimBtn', claimDaily);
    tap('dailyDoubleBtn', doubleDaily);
    tap('rewardsCloseBtn', closeDailyPanels);
    tap('homeLevelBar', () => open('levelPanel'));
    // Closing a level-up goes on to the day's calendar if it is still waiting.
    const closeLevel = () => { closeDailyPanels(); maybeAutoOpenDaily(); };
    tap('levelCloseBtn', closeLevel);
    tap('levelOkBtn', closeLevel);
    // A tap on the dimmed backdrop (not the card) closes too -- the level-up
    // card exactly as its OK does, so the calendar still follows it (it used
    // to be skipped when the card was dismissed by a tap beside it).
    for (const id of PANELS) {
        const e = $(id);
        if (e) e.addEventListener('click', (ev) => { if (ev.target === e) { if (id === 'levelPanel') closeLevel(); else closeDailyPanels(); } });
    }
    renderDailyButtons();
}
