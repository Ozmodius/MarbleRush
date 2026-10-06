import { tierForMs, isUnlocked } from './progressStore.js';
import { worldName } from './worlds.js';
import { PRIZES } from './shopCatalog.js';
import { renderStore, renderProfile, clearShopMessages } from './shopUi.js';
import { onFrame, getRenderer } from './sceneHost.js';
import { showBanner } from './platform.js';

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
    if (tab === 'home') renderHome();
    // Banners only on these two: pages players read for a while, never play.
    else if (tab === 'gear') { clearShopMessages(); renderProfile(); showBanner('profileBanner'); }
    else if (tab === 'store') { clearShopMessages(); renderStore(); showBanner('storeBanner'); }
    else if (tab === 'worlds') renderWorlds();
    renderWallets();
}

function renderWallets() {
    const w = fmt(ctx.store.get().wallet);
    for (const id of ['mazeWallet', 'storeWallet', 'profileWallet', 'homeWallet']) { const e = $(id); if (e) e.textContent = w; }
}

// The home screen's top HUD: the level PLAY will start, its world and how far
// through it the player is, their medals, and their coins.
function renderHome() {
    const p = ctx.store.get();
    const levels = ctx.game.getLevels();
    const lv = ctx.game.nextLevel();
    if (!lv) return;
    const inWorld = levels.filter(l => l.world === lv.world);
    const slot = inWorld.findIndex(l => l.id === lv.id) + 1;
    const doneInWorld = inWorld.filter(l => p.cleared[l.id]).length;
    const allDone = levels.every(l => p.cleared[l.id]);

    $('homeLevelNum').textContent = 'LEVEL ' + lv.index;
    $('homeLevelName').textContent = lv.name;
    $('homeWorld').textContent = `World ${lv.world}  ·  ${worldName(lv.world)}  ·  ${slot} of ${inWorld.length}`;
    $('homeWorldBar').style.width = (100 * doneInWorld / Math.max(1, inWorld.length)).toFixed(0) + '%';
    $('homeWorldDone').textContent = `${doneInWorld} / ${inWorld.length} cleared`;

    // Medals by best time, across every level (progressStore.js tierForMs).
    const medals = { gold: 0, silver: 0, bronze: 0 };
    for (const l of levels) {
        const c = p.cleared[l.id];
        const t = c ? tierForMs(l, c.bestMs) : null;
        if (t) medals[t]++;
    }
    for (const t of Object.keys(medals)) $('homeMedal_' + t).textContent = String(medals[t]);

    const best = p.cleared[lv.id];
    $('homeGoal').textContent = best
        ? `Best ${(best.bestMs / 1000).toFixed(1)}s  ·  gold under ${(lv.goldMs / 1000).toFixed(1)}s`
        : `Gold under ${(lv.goldMs / 1000).toFixed(1)}s  ·  ${(lv.coins || []).length} coins to find`;
    $('homePlayBtn').textContent = allDone ? 'PLAY AGAIN' : 'PLAY';
    renderWallets();
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
    $('worldSheetNum').textContent = 'WORLD ' + w.n;
    $('worldSheetName').textContent = w.name;
    const grid = $('mazeSelectList');
    grid.innerHTML = '';
    const done = w.levels.filter(l => p.cleared[l.id]).length;
    $('worldSheetDone').textContent = w.levels.length ? `${done} / ${w.levels.length} cleared` : '';

    const nextIdx = (p.highestIndex || 0) + 1;
    const next = w.levels.find(l => l.index === nextIdx);
    if (w.state === 'coming') $('worldSheetNote').textContent = 'Coming in an update. Its levels are still being built.';
    else if (w.state === 'locked') $('worldSheetNote').textContent = `Clear World ${w.n - 1} to land here.`;
    else if (next) $('worldSheetNote').textContent = `Next: ${next.name}  ·  gold under ${(next.goldMs / 1000).toFixed(1)}s`;
    else $('worldSheetNote').textContent = 'Every level cleared. Replay any for a better medal.';

    for (const lv of w.levels) {
        const c = p.cleared[lv.id];
        const tier = c ? tierForMs(lv, c.bestMs) : null;
        const open = isUnlocked(p, lv);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'level-node' + (c ? ' is-cleared' : '') + (open ? '' : ' is-locked') + (lv.index === nextIdx ? ' is-next' : '');
        if (tier) b.dataset.tier = tier;
        b.disabled = !open;
        b.textContent = String(w.levels.indexOf(lv) + 1);
        b.setAttribute('aria-label', `${lv.name}${c ? ', cleared' + (tier ? ', ' + tier : '') : ''}${open ? '' : ', locked'}`);
        b.title = lv.name;
        b.addEventListener('click', (e) => { e.preventDefault(); if (open) ctx.game.playLevel(lv.id); });
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
    game.setMenuHandler((tab) => show(tab));
    for (const t of Object.keys(TABS)) {
        const b = $('tab_' + t);
        if (b) b.addEventListener('click', (e) => { e.preventDefault(); if (current !== t) game.showMenus(t); });
    }
    const play = $('homePlayBtn');
    if (play) play.addEventListener('click', (e) => { e.preventDefault(); game.playLevel(); });
    onFrame(placeLabels);
    // On the canvas while WORLDS is up: a drag sideways spins the solar
    // system (and coasts when let go); a tap picks the planet under it. A
    // drag past DRAG_PX is never also a tap.
    const canvas = getRenderer() && getRenderer().domElement;
    if (canvas) {
        const DRAG_PX = 8, RAD_PER_PX = 0.008;
        let drag = null;
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
