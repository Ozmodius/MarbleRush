import { tierForMs, isUnlocked, walkTierForMs, walkGoldMs } from './progressStore.js';
import { PRIZES, CHARGE_IDS, AD_REWARDS } from './shopCatalog.js';
import { renderStore, renderProfile, clearShopMessages } from './shopUi.js';
import { onFrame, getRenderer } from './sceneHost.js';
import { showBanner, adsAvailable, showRewardedAd, adFailureMessage } from './platform.js';
import { sfx } from './sfx.js';
import { worldName, LAUNCH_WORLDS } from './worlds.js';
import { captiveFor, isRescueLevel, VILLAIN } from './rescue.js';
import { fuelGate, fuelCount, launchNeed } from './fuel.js';
import { isSurveyed } from './survey.js';
import { POCKET_LEVELS } from './pockets.js';
import { initDailyUi, renderDailyButtons, maybeAutoOpenDaily, closeDailyPanels, showLevelUps } from './dailyUi.js';

// THE MENUS: a bottom tab bar (HOME, GEAR, WORLDS, STORE) over the spinning
// board mazeGame.js keeps as the backdrop, plus the home screen's top HUD.
//
// mazeGame.js decides WHEN the menus are up (leaving a level, boot) and calls
// the handler registered here with the tab to show, or null when a level
// starts. This module only decides what is on screen.
//
// initMenus({ store, game }) once; `game` is mazeGame's module (showMenus,
// playLevel, nextLevel, getLevels, worldsInfo, pickWorld, selectWorld,
// worldAnchors, refreshShowcase, setMenuHandler).

const TABS = {
    home: 'homeView',
    gear: 'profileView',
    worlds: 'mazeSelect',
    store: 'storeView'
};

let ctx = null;
let current = null;
let selectedWorld = null;
// The worlds sheet's mode: 'roll' plays a level, 'walk' walks one already
// rolled (the Labyrinth, walkMode.js).
let sheetMode = 'roll';
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-US');

function show(tab) {
    current = tab;
    for (const [t, id] of Object.entries(TABS)) {
        const e = $(id);
        if (e) e.style.display = t === tab ? '' : 'none';
    }
    const bar = $('tabBar');
    if (bar) bar.style.display = tab ? '' : 'none';
    for (const t of Object.keys(TABS)) {
        const b = $('tab_' + t);
        if (b) { b.classList.toggle('is-active', t === tab); b.setAttribute('aria-current', t === tab ? 'page' : 'false'); }
    }
    if (tab !== 'home') closeDailyPanels();
    // Arriving home: a level-up first (its OK goes on to the calendar), else
    // the calendar if today's reward waits.
    if (tab === 'home') { renderHome(); if (!showLevelUps()) maybeAutoOpenDaily(); }
    // Banners only on these two: pages players read for a while, never play.
    else if (tab === 'gear') { clearShopMessages(); renderProfile(); showBanner('profileBanner'); }
    else if (tab === 'store') { clearShopMessages(); renderStore(); showBanner('storeBanner'); }
    else if (tab === 'worlds') renderWorlds();
    renderWallets();
    renderBadges();
}

let shownWallet = null;
function renderWallets() {
    const n = ctx.store.get().wallet;
    const w = fmt(n);
    for (const id of ['mazeWallet', 'storeWallet', 'profileWallet', 'homeWallet']) { const e = $(id); if (e) e.textContent = w; }
    // The gold chip bumps when the balance goes up while it is on screen.
    if (shownWallet !== null && n > shownWallet && current === 'home') bump('homeGoldChip');
    shownWallet = n;
}

function bump(id) {
    const e = $(id);
    if (!e) return;
    e.classList.remove('is-bump');
    void e.offsetWidth; // restart the animation
    e.classList.add('is-bump');
}

// The red ! on STORE: a free reward is waiting there right now.
function renderBadges() {
    const b = $('storeBadge');
    if (b) b.hidden = !(adsAvailable() && ctx.store.adCoinsWaitMs() <= 0);
}

// The side rail's FREE button: the store's free-coins ad, one tap from home.
// Shown only where an ad can pay; while it cools down it counts down.
function renderFreeCoins() {
    const btn = $('homeFreeCoins');
    if (!btn) return;
    if (!adsAvailable()) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    if (btn.dataset.busy) return;
    const wait = ctx.store.adCoinsWaitMs();
    btn.disabled = wait > 0;
    if (wait > 0) {
        const s = Math.ceil(wait / 1000);
        $('homeFreeLabel').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    } else {
        $('homeFreeLabel').textContent = '+' + fmt(AD_REWARDS.coins);
    }
}

// The right rail's daily maze: NEW until today's is cleared, then the day's
// best; locked until DAILY_MAZE.unlockAfter ladder levels are cleared.
function renderDailyMaze() {
    const btn = $('homeDailyMaze');
    if (!btn) return;
    const d = ctx.store.dailyMaze ? ctx.store.dailyMaze() : null;
    btn.style.display = d && d.lv ? '' : 'none';
    if (!d || !d.lv) return;
    btn.classList.toggle('is-locked', d.locked);
    btn.classList.toggle('is-done', d.paid);
    $('homeMazeBadge').hidden = d.locked || d.paid;
    $('homeMazeLabel').textContent = d.locked ? 'LOCKED' : d.paid ? '✓ ' + (d.best / 1000).toFixed(1) + 's' : 'TODAY';
    btn.setAttribute('aria-label', d.locked ? `Daily maze: clear ${d.unlockAfter} levels to unlock` : d.paid ? 'Daily maze: done today, play again to beat your time' : "Play today's daily maze");
}

let toastTimer = 0;
function toast(text, good) {
    const t = $('homeToast');
    if (!t) return;
    t.textContent = text;
    t.classList.toggle('is-good', !!good);
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 1800);
}

async function freeCoinsFromAd() {
    const btn = $('homeFreeCoins');
    if (!btn || btn.disabled || btn.dataset.busy) return;
    btn.dataset.busy = '1';
    btn.disabled = true;
    const ok = await showRewardedAd();
    delete btn.dataset.busy;
    if (ok && ctx.store.adCoins().ok) {
        toast('+' + fmt(AD_REWARDS.coins), true);
        try { sfx.coin(); } catch (_) { /* ignore */ }
    } else if (!ok) toast(adFailureMessage(), false);
    if (current === 'home') renderHome();
    renderWallets();
    renderBadges();
}

// The home screen's top HUD: the player's gold (coins), medals and power-ups,
// each labeled. The level PLAY will start shows under the logo, by the button.
function renderHome() {
    const p = ctx.store.get();
    const levels = ctx.game.getLevels();
    // The world on screen (swiped to, or where the ladder is) and the level
    // PLAY starts there (mazeGame.js homeLevel).
    const home = ctx.game.homeLevel();
    if (!home) return;
    const lv = home.level;
    renderWorldNav(home);
    renderSites(home);
    renderRescue();

    // Medals by best time, across every level (progressStore.js tierForMs).
    const medals = { gold: 0, silver: 0, bronze: 0 };
    for (const l of levels) {
        const c = p.cleared[l.id];
        const t = c ? tierForMs(l, c.bestMs) : null;
        if (t) medals[t]++;
    }
    for (const t of Object.keys(medals)) $('homeMedal_' + t).textContent = String(medals[t]);
    for (const id of CHARGE_IDS) $('homeCharge_' + id).textContent = String(p.charges?.[id] || 0);

    const best = p.cleared[lv.id];
    const play = $('homePlayBtn');
    play.disabled = home.locked;
    play.classList.toggle('is-locked', home.locked);
    play.setAttribute('aria-disabled', String(home.locked));
    if (home.locked) {
        // Locked: say what opens it -- the world before, finished.
        // Short of fuel, or still to finish the planet before (fuel.js).
        const gate = fuelGate(p, levels.find(l => l.world === home.world && l.index === (home.world - 1) * 10 + 1));
        $('homeGoal').textContent = gate && (p.highestIndex || 0) + 1 >= (home.world - 1) * 10 + 1
            ? `The ship needs ${gate.need} fuel cells from ${worldName(gate.from)}  ·  ${gate.have} found`
            : `Finish ${worldName(home.world - 1)} to unlock`;
        $('homePlayLabel').textContent = 'LOCKED';
        $('homePlayLevel').textContent = '';
    } else {
        $('homeGoal').textContent = best
            ? `Best ${(best.bestMs / 1000).toFixed(1)}s  ·  gold under ${(lv.goldMs / 1000).toFixed(1)}s`
            : `Gold under ${(lv.goldMs / 1000).toFixed(1)}s  ·  ${(lv.coins || []).length} coins to find`;
        $('homePlayLabel').textContent = home.done ? 'PLAY AGAIN' : 'PLAY';
        $('homePlayLevel').textContent = 'LEVEL ' + lv.index;
    }
    renderFreeCoins();
    renderDailyMaze();
    renderDailyButtons();
    renderWallets();
}

// Home's world picker: the shown world's name, a dot per world (lit for the
// shown one, dim for locked ones), and arrows that stop at the ends.
function renderWorldNav(home) {
    const worlds = ctx.game.worldsInfo();
    const n = home.world;
    const name = $('homeWorldName');
    name.textContent = worldName(n).toUpperCase();
    // Each level is a place on its planet: the one PLAY lands on, by name.
    $('homeWorldPlace').textContent = home.locked ? '' : home.level.name.toUpperCase();
    name.classList.toggle('is-locked-name', home.locked);
    const dots = $('homeWorldDots');
    dots.innerHTML = '';
    for (const w of worlds) {
        const d = document.createElement('i');
        if (w.n === n) d.className = 'is-on';
        else if (w.state !== 'open') d.className = 'is-locked';
        dots.append(d);
    }
    // The shown planet's fuel cells, and what the ship needs from them.
    const fuelEl = $('homeWorldFuel');
    if (fuelEl) {
        const lvls = ctx.game.getLevels().filter(l => l.world === n);
        const have = fuelCount(ctx.store.get(), n), need = launchNeed(n + 1);
        const nextBuilt = ctx.game.getLevels().some(l => l.world === n + 1);
        fuelEl.innerHTML = '';
        if (lvls.length && !home.locked) {
            const ic = document.createElement('span'); ic.className = 'fuel-icon';
            fuelEl.append(ic, document.createTextNode(`FUEL ${have} / ${lvls.length}` + (nextBuilt && have < need ? `  ·  ${need} TO FLY ON` : '')));
        }
        fuelEl.classList.toggle('is-short', nextBuilt && have < need);
    }
    $('homePrevWorld').disabled = n <= 1;
    $('homeNextWorld').disabled = n >= LAUNCH_WORLDS;
}

// THE LANDING SITES: a button over each level's place on the planet
// (homeSites.js; mazeGame.js projects them), ringed in its medal like the
// Worlds sheet's nodes, the next level glowing, locked ones dim, floor 10
// with its caged (or freed) friend. Tapping an open one makes it what PLAY
// starts; the beacon on the planet moves there.
let sitesWorld = null;
let swipedAt = -1e9;             // a swipe that began on a site is not a tap on it
function renderSites(home) {
    const box = $('homeSites');
    if (!box) return;
    const p = ctx.store.get();
    const lvls = ctx.game.getLevels().filter(l => l.world === home.world);
    const nextIdx = (p.highestIndex || 0) + 1;
    if (sitesWorld !== home.world || box.childElementCount !== lvls.length) {
        sitesWorld = home.world;
        box.innerHTML = '';
        lvls.forEach((lv, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.id = 'homeSite_' + lv.id;
            b.dataset.level = lv.id;
            b.textContent = String(i + 1);
            b.style.visibility = 'hidden';     // placed on the next frame
            b.addEventListener('click', (e) => {
                e.preventDefault();
                if (b.disabled || performance.now() - swipedAt < 400) return;
                if (ctx.game.pickHomeLevel(lv.id)) renderHome();
            });
            box.append(b);
        });
    }
    lvls.forEach((lv, i) => {
        const b = $('homeSite_' + lv.id);
        if (!b) return;
        const c = p.cleared[lv.id];
        const tier = c ? tierForMs(lv, c.bestMs) : null;
        const open = isUnlocked(p, lv);
        b.className = 'home-site' + (c ? ' is-cleared' : '') + (open ? '' : ' is-locked')
            + (lv.index === nextIdx ? ' is-next' : '') + (lv.id === home.level.id && !home.locked ? ' is-picked' : '');
        if (tier) b.dataset.tier = tier; else delete b.dataset.tier;
        if ((p.fuel || []).includes(lv.id)) b.classList.add('has-fuel');
        if (isSurveyed(p, lv.id)) b.classList.add('is-surveyed');
        const cap = isRescueLevel(lv) ? captiveFor(lv.world) : null;
        if (cap) {
            b.classList.add('is-rescue');
            if ((p.rescued || []).includes(lv.world)) b.classList.add('is-freed');
            b.style.setProperty('--m', cap.swatch);
        }
        b.disabled = !open;
        b.setAttribute('aria-pressed', String(lv.id === home.level.id && !home.locked));
        b.setAttribute('aria-label', `Level ${i + 1}, ${lv.name}${c ? ', cleared' + (tier ? ', ' + tier : '') : ''}${open ? '' : ', locked'}${cap && !(p.rescued || []).includes(lv.world) ? ', ' + cap.name + ' is caged here' : ''}`);
    });
}
// THE RESCUE TRACKER under the logo: Rolle's five friends (rescue.js),
// behind bars until freed, and the count. Tapping it opens the Worlds map,
// where each planet's sheet says who is held there.
function renderRescue() {
    const box = $('homeRescueFriends'), text = $('homeRescueText');
    if (!box || !text) return;
    const p = ctx.store.get();
    const worlds = [];
    for (let w = 1; w <= LAUNCH_WORLDS; w++) { const c = captiveFor(w); if (c) worlds.push([w, c]); }
    const freed = worlds.filter(([w]) => (p.rescued || []).includes(w)).length;
    box.innerHTML = '';
    for (const [w, c] of worlds) {
        const d = document.createElement('i');
        const isFree = (p.rescued || []).includes(w);
        d.className = 'rescue-friend ' + (isFree ? 'is-freed' : 'is-caged');
        d.style.setProperty('--m', c.swatch);
        d.title = isFree ? `${c.name}, freed` : `${c.name}, held on ${worldName(w)}`;
        box.append(d);
    }
    text.textContent = freed === worlds.length ? 'ALL FRIENDS RESCUED!' : `FRIENDS RESCUED ${freed} / ${worlds.length}`;
    $('homeRescue').classList.toggle('is-all', freed === worlds.length);
    $('homeRescue').setAttribute('aria-label', `${freed} of ${worlds.length} friends rescued from ${VILLAIN}. Open the worlds map.`);
}

// HOME'S LAYOUT: the header (stats, level bar, logo, rescue tracker) and the
// play block (planet name, goal, PLAY) are whatever height the screen makes
// them; the planet gets the band between, and the side buttons sit just
// under the header, never over the tracker.
function layoutHome() {
    const view = $('homeView');
    const hud = view && view.querySelector('.home-hud'), nav = view && view.querySelector('.home-worldnav');
    if (!hud || !nav) return;
    const top = hud.getBoundingClientRect().bottom, bottom = nav.getBoundingClientRect().top;
    const vr = view.getBoundingClientRect();
    view.style.setProperty('--home-top', Math.round(top - vr.top + 10) + 'px');
    ctx.game.setHomeBand(top + 4, bottom - 8);
}
// Each frame on home: the buttons ride their sites (the planet slides in on
// a swipe).
function placeSites() {
    if (current !== 'home') return;
    layoutHome();
    for (const s of ctx.game.homeSites()) {
        const b = $('homeSite_' + s.id);
        if (!b) continue;
        b.style.left = s.x + 'px';
        b.style.top = s.y + 'px';
        b.style.visibility = '';
    }
}

// Move home to the next (+1) or previous (-1) world, sliding the new planet
// in from that side.
function stepHomeWorld(d) {
    if (current !== 'home') return;
    const n = ctx.game.homeWorld() + d;
    if (n < 1 || n > LAUNCH_WORLDS) return;
    if (ctx.game.setHomeWorld(n, d)) renderHome();
}

// --- WORLDS ------------------------------------------------------------------
// The solar system is mazeGame's backdrop; this draws the name labels that
// follow the planets, and the sheet for the selected world: its ten levels as
// tappable nodes, each ringed in the medal its best time earned.

function renderWorlds() {
    const worlds = ctx.game.worldsInfo();
    if (selectedWorld === null) {
        const nl = ctx.game.nextLevel();
        selectedWorld = nl ? nl.world : 1;
    }
    const labels = $('worldLabels');
    labels.innerHTML = '';
    for (const w of worlds) {
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'worldLabel_' + w.n;
        b.className = 'world-label' + (w.n === selectedWorld ? ' is-selected' : '') + (w.state === 'coming' ? ' is-coming' : '');
        b.textContent = w.name.toUpperCase();
        b.style.visibility = 'hidden';   // placed on the next frame
        b.addEventListener('click', (e) => { e.preventDefault(); pickWorld(w.n); });
        labels.append(b);
    }
    renderSheet(worlds.find(w => w.n === selectedWorld) || worlds[0]);
    ctx.game.selectWorld(selectedWorld);
    placeLabels();
}

function pickWorld(n) {
    if (n === null || n === undefined) return;
    selectedWorld = n;
    for (const b of document.querySelectorAll('.world-label')) b.classList.toggle('is-selected', b.id === 'worldLabel_' + n);
    ctx.game.selectWorld(n);
    renderSheet(ctx.game.worldsInfo().find(w => w.n === n));
}

function renderSheet(w) {
    const p = ctx.store.get();
    const walk = sheetMode === 'walk';
    for (const [id, on] of [['modeRoll', !walk], ['modeWalk', walk]]) {
        const b = $(id);
        if (b) { b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    }
    $('worldSheetName').textContent = w.name;
    const grid = $('mazeSelectList');
    grid.innerHTML = '';
    const done = w.levels.filter(l => (walk ? p.walks[l.id] : p.cleared[l.id])).length;
    $('worldSheetDone').textContent = w.levels.length ? `${done} / ${w.levels.length} ${walk ? 'explored' : 'cleared'}` : '';

    const nextIdx = (p.highestIndex || 0) + 1;
    const next = w.levels.find(l => l.index === nextIdx);
    if (w.state === 'coming') $('worldSheetNote').textContent = 'Coming in an update. Its levels are still being built.';
    else if (w.state === 'locked') {
        const gate = fuelGate(p, w.levels[0]);
        $('worldSheetNote').textContent = gate && (p.highestIndex || 0) + 1 >= w.levels[0].index
            ? `The ship needs ${gate.need} fuel cells from ${worldName(gate.from)} to land here (${gate.have} found).`
            : `Finish ${worldName(w.n - 1)} to land here.`;
    }
    else if (walk) $('worldSheetNote').textContent = 'Explore any level you have rolled, from inside the maze. Find the exit; the traps are real.';
    else if (next) $('worldSheetNote').textContent = `Next: ${next.name}  ·  gold under ${(next.goldMs / 1000).toFixed(1)}s`;
    else $('worldSheetNote').textContent = 'Every level cleared. Replay any for a better medal.';

    for (const lv of w.levels) {
        const rolled = p.cleared[lv.id];
        const c = walk ? p.walks[lv.id] : rolled;
        const tier = c ? (walk ? walkTierForMs(lv, c.bestMs) : tierForMs(lv, c.bestMs)) : null;
        const open = walk ? !!rolled : isUnlocked(p, lv);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'level-node' + (c ? ' is-cleared' : '') + (open ? '' : ' is-locked') + (!walk && lv.index === nextIdx ? ' is-next' : '');
        if (tier) b.dataset.tier = tier;
        if (!walk && (p.fuel || []).includes(lv.id)) b.classList.add('has-fuel');
        if (!walk && isSurveyed(p, lv.id)) b.classList.add('is-surveyed');
        // Floor 10 holds a friend (rescue.js): a caged dot, or a free one.
        const cap = !walk && isRescueLevel(lv) ? captiveFor(lv.world) : null;
        if (cap) {
            b.classList.add('is-rescue');
            if ((p.rescued || []).includes(lv.world)) b.classList.add('is-freed');
            b.style.setProperty('--m', cap.swatch);
        }
        b.disabled = !open;
        b.textContent = String(w.levels.indexOf(lv) + 1);
        b.setAttribute('aria-label', `${walk ? 'Explore ' : ''}${lv.name}${c ? (walk ? ', explored' : ', cleared') + (tier ? ', ' + tier : '') : ''}${open ? '' : walk ? ', roll it first' : ', locked'}`);
        b.title = walk ? `${lv.name} — explore gold under ${(walkGoldMs(lv) / 1000).toFixed(1)}s` : lv.name;
        b.addEventListener('click', (e) => {
            e.preventDefault();
            if (!open) return;
            if (walk) ctx.game.walkLevel(lv.id); else ctx.game.playLevel(lv.id);
        });
        grid.append(b);
    }

    // Who the Baron holds here, and whether they are free yet.
    const capEl = $('worldSheetCaptive');
    if (capEl) {
        capEl.innerHTML = '';
        const cap = !walk && w.levels.some(isRescueLevel) ? captiveFor(w.n) : null;
        if (cap) {
            const freed = (p.rescued || []).includes(w.n);
            const dot = document.createElement('span');
            dot.className = 'captive-dot' + (freed ? ' is-freed' : '');
            dot.style.setProperty('--m', cap.swatch);
            capEl.append(dot, document.createTextNode(freed ? `${cap.name} is free, and rolls with you (Gear).` : `${VILLAIN} has caged ${cap.name} on floor 10. Find the cage before the exit.`));
        }
    }

    const fuelEl = $('worldSheetFuel');
    if (fuelEl) {
        fuelEl.innerHTML = '';
        if (!walk && w.levels.length && w.state !== 'coming') {
            const have = fuelCount(p, w.n), need = launchNeed(w.n + 1), next = ctx.game.worldsInfo().find(x => x.n === w.n + 1);
            const ic = document.createElement('span'); ic.className = 'fuel-icon';
            const surveyedN = w.levels.filter(l => isSurveyed(p, l.id)).length;
            const pages = POCKET_LEVELS.filter(id => id.startsWith(`w${w.n}_`));
            fuelEl.append(ic, document.createTextNode(`Fuel cells ${have} / ${w.levels.length}, one hidden in each maze's deepest dead end.` + (next && next.levels.length ? ` ${worldName(w.n + 1)} needs ${need}.` : '') + `  Surveyed ${surveyedN} / ${w.levels.length}.` + (pages.length ? `  Diary pages ${pages.filter(id => (p.diary || []).includes(id)).length} / ${pages.length}.` : '')));
        }
    }

    const prizeId = (w.levels[w.levels.length - 1] || {}).prize;
    const prizeEl = $('worldSheetPrize');
    prizeEl.innerHTML = '';
    if (prizeId && PRIZES[prizeId]) {
        const z = PRIZES[prizeId];
        const badge = document.createElement('span');
        badge.className = 'prize-badge';
        prizeEl.append(badge, document.createTextNode(`Prize for level ${w.levels.length}: ${z.name}. ${z.blurb}${p.prizes.includes(prizeId) ? ' (earned)' : ''}`));
    }
}

// Labels ride under their planets: re-placed every frame while WORLDS is up.
function placeLabels() {
    if (current !== 'worlds') return;
    for (const a of ctx.game.worldAnchors()) {
        const b = $('worldLabel_' + a.n);
        if (!b) continue;
        // Kept whole on screen: an outer planet near the edge would cut its
        // name in half.
        const half = b.offsetWidth / 2 + 6, W = b.parentElement ? b.parentElement.clientWidth : window.innerWidth;
        b.style.left = Math.max(half, Math.min(W - half, a.x)) + 'px';
        b.style.top = a.y + 'px';
        b.style.visibility = '';
    }
}

export function initMenus({ store, game }) {
    ctx = { store, game };
    initDailyUi({ store, onChange: () => { if (current === 'home') renderHome(); renderWallets(); renderBadges(); } });
    game.setMenuHandler((tab) => show(tab));
    for (const t of Object.keys(TABS)) {
        const b = $('tab_' + t);
        if (b) b.addEventListener('click', (e) => { e.preventDefault(); if (current !== t) game.showMenus(t); });
    }
    const play = $('homePlayBtn');
    if (play) play.addEventListener('click', (e) => { e.preventDefault(); if (!play.disabled) game.playLevel(); });
    for (const [id, d] of [['homePrevWorld', -1], ['homeNextWorld', 1]]) {
        const b = $(id);
        if (b) b.addEventListener('click', (e) => { e.preventDefault(); stepHomeWorld(d); });
    }
    // The arrow keys do the same on a computer.
    window.addEventListener('keydown', (e) => {
        if (current !== 'home' || e.repeat || e.target.closest?.('input, textarea, select, [role="dialog"]')) return;
        if (document.querySelector('.modal.is-up')) return;
        if (e.code === 'ArrowLeft') stepHomeWorld(-1);
        else if (e.code === 'ArrowRight') stepHomeWorld(1);
        // Up and down walk the landing sites (open ones only).
        else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
            const home = ctx.game.homeLevel();
            if (!home || home.locked) return;
            const lvls = ctx.game.getLevels().filter(l => l.world === home.world);
            const d = e.code === 'ArrowUp' ? 1 : -1;
            for (let i = lvls.indexOf(home.level) + d; i >= 0 && i < lvls.length; i += d) {
                if (ctx.game.pickHomeLevel(lvls[i].id)) { e.preventDefault(); renderHome(); break; }
            }
        }
    });
    // The HUD chips go where their thing is: more gold and power-ups in the
    // store, medals on the worlds map.
    const go = (id, tab) => { const b = $(id); if (b) b.addEventListener('click', (e) => { e.preventDefault(); game.showMenus(tab); }); };
    go('homeGoldChip', 'store');
    go('homeChargeChip', 'store');
    go('homeMedalChip', 'worlds');
    go('homeRescue', 'worlds');
    for (const [id, mode] of [['modeRoll', 'roll'], ['modeWalk', 'walk']]) {
        const b = $(id);
        if (b) b.addEventListener('click', (e) => {
            e.preventDefault();
            sheetMode = mode;
            renderSheet(ctx.game.worldsInfo().find(w => w.n === selectedWorld) || ctx.game.worldsInfo()[0]);
        });
    }
    const maze = $('homeDailyMaze');
    if (maze) maze.addEventListener('click', (e) => {
        e.preventDefault();
        const d = ctx.store.dailyMaze();
        if (d.locked) { toast(`Clear ${d.unlockAfter} levels to unlock the daily maze`, false); return; }
        game.playDaily();
    });
    const free = $('homeFreeCoins');
    if (free) free.addEventListener('click', (e) => { e.preventDefault(); freeCoinsFromAd(); });
    // The FREE countdown and the store badge tick while the menus are up.
    setInterval(() => { if (current === 'home') renderFreeCoins(); if (current) renderBadges(); }, 1000);
    onFrame(placeLabels);
    onFrame(placeSites);
    // On the canvas while WORLDS is up: a drag sideways spins the solar
    // system (and coasts when let go); a tap picks the planet under it. A
    // drag past DRAG_PX is never also a tap.
    const canvas = getRenderer() && getRenderer().domElement;
    if (canvas) {
        const DRAG_PX = 8, RAD_PER_PX = 0.008;
        let drag = null;
        // HOME: a swipe across the planet moves to the next world -- left
        // brings in the one on the right, as a page turns.
        const SWIPE_PX = 45;
        let swipe = null;
        canvas.addEventListener('pointerdown', (e) => {
            if (current === 'home') swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
        });
        // A swipe can start on a landing site's button too (they cover the
        // planet), and then it is a swipe, not a tap on that site.
        const sitesBox = $('homeSites');
        if (sitesBox) sitesBox.addEventListener('pointerdown', (e) => {
            if (current === 'home') swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
        });
        const swipeEnd = (e) => {
            if (!swipe || e.pointerId !== swipe.id) return;
            const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
            swipe = null;
            if (current !== 'home' || Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return;
            swipedAt = performance.now();
            stepHomeWorld(dx < 0 ? 1 : -1);
        };
        window.addEventListener('pointerup', swipeEnd);
        canvas.addEventListener('pointercancel', () => { swipe = null; });
        canvas.addEventListener('pointerdown', (e) => {
            if (current !== 'worlds') return;
            drag = { id: e.pointerId, x0: e.clientX, x: e.clientX, t: performance.now(), v: 0, moved: false };
        });
        canvas.addEventListener('pointermove', (e) => {
            // A mouse moving with no button held is hovering, not dragging --
            // whatever drag was left over (a pointerup that never arrived)
            // is over.
            if (drag && !drag.ended && e.pointerType === 'mouse' && !(e.buttons & 1)) { end(e); return; }
            if (!drag || drag.ended || e.pointerId !== drag.id || current !== 'worlds') return;
            if (!drag.moved && Math.abs(e.clientX - drag.x0) < DRAG_PX) return;
            if (!drag.moved) { drag.moved = true; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
            const now = performance.now(), dx = e.clientX - drag.x;
            // Dragging right carries the near planets right: the angle runs
            // from screen right toward the viewer, so it goes down.
            game.spinWorlds(-dx * RAD_PER_PX);
            const dt = Math.max(1, now - drag.t) / 1000;
            drag.v = drag.v * 0.6 + (-dx * RAD_PER_PX / dt) * 0.4;
            drag.x = e.clientX; drag.t = now;
        });
        // The ended drag stays put until the next press replaces it, so the
        // click that follows its pointerup can still see it was a drag. (A
        // timer clearing it once let a slow device wipe out the NEXT drag.)
        const end = (e) => {
            if (!drag || drag.ended || e.pointerId !== drag.id) return;
            // A pause before letting go means no fling.
            if (drag.moved) game.releaseWorlds(performance.now() - drag.t > 120 ? 0 : drag.v);
            drag.ended = true;
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('click', (e) => {
            if (current !== 'worlds' || (drag && drag.moved)) return;
            pickWorld(game.pickWorld(e.clientX, e.clientY));
        });
    }
}

// After the marble changed: rebuild the backdrop so it shows the new one.
export function marbleChanged() {
    if (!ctx) return;
    ctx.game.refreshShowcase();
    renderWallets();
}

// After progress arrived from another device (cloudSync.js): redraw whatever
// is up, without the arrival side effects show() has (the calendar popping).
export function progressChanged() {
    if (!ctx || !current) return;
    if (current === 'home') renderHome();
    else if (current === 'gear') renderProfile();
    else if (current === 'store') renderStore();
    else if (current === 'worlds') renderWorlds();
    renderWallets();
    renderBadges();
    ctx.game.refreshShowcase();
}
