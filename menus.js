import { tierForMs, isUnlocked, walkTierForMs, walkGoldMs } from './progressStore.js';
import { PRIZES, CHARGE_IDS, AD_REWARDS } from './shopCatalog.js';
import { renderStore, renderProfile, clearShopMessages } from './shopUi.js';
import { onFrame, getRenderer } from './sceneHost.js';
import { showBanner, adsAvailable, showRewardedAd, adFailureMessage } from './platform.js';
import { sfx } from './sfx.js';
import { worldName, placeName, LAUNCH_WORLDS } from './worlds.js';
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
        $('homeGoal').textContent = `Finish ${worldName(home.world - 1)} to unlock`;
        $('homePlayLabel').textContent = 'LOCKED';
        $('homePlayLevel').textContent = 'WORLD ' + home.world;
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
    $('homeWorldPlace').textContent = `WORLD ${n}  ·  ${placeName(n).toUpperCase()}`;
    name.classList.toggle('is-locked-name', home.locked);
    const dots = $('homeWorldDots');
    dots.innerHTML = '';
    for (const w of worlds) {
        const d = document.createElement('i');
        if (w.n === n) d.className = 'is-on';
        else if (w.state !== 'open') d.className = 'is-locked';
        dots.append(d);
    }
    $('homePrevWorld').disabled = n <= 1;
    $('homeNextWorld').disabled = n >= LAUNCH_WORLDS;
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
        b.textContent = w.n + '  ' + w.name.toUpperCase();
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
    $('worldSheetNum').textContent = 'WORLD ' + w.n;
    $('worldSheetName').textContent = w.name;
    $('worldSheetPlace').textContent = placeName(w.n);
    const grid = $('mazeSelectList');
    grid.innerHTML = '';
    const done = w.levels.filter(l => (walk ? p.walks[l.id] : p.cleared[l.id])).length;
    $('worldSheetDone').textContent = w.levels.length ? `${done} / ${w.levels.length} ${walk ? 'explored' : 'cleared'}` : '';

    const nextIdx = (p.highestIndex || 0) + 1;
    const next = w.levels.find(l => l.index === nextIdx);
    if (w.state === 'coming') $('worldSheetNote').textContent = 'Coming in an update. Its levels are still being built.';
    else if (w.state === 'locked') $('worldSheetNote').textContent = `Clear World ${w.n - 1} to land here.`;
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
    });
    // The HUD chips go where their thing is: more gold and power-ups in the
    // store, medals on the worlds map.
    const go = (id, tab) => { const b = $(id); if (b) b.addEventListener('click', (e) => { e.preventDefault(); game.showMenus(tab); }); };
    go('homeGoldChip', 'store');
    go('homeChargeChip', 'store');
    go('homeMedalChip', 'worlds');
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
        const swipeEnd = (e) => {
            if (!swipe || e.pointerId !== swipe.id) return;
            const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
            swipe = null;
            if (current !== 'home' || Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return;
            stepHomeWorld(dx < 0 ? 1 : -1);
        };
        canvas.addEventListener('pointerup', swipeEnd);
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
