import { tierForMs } from './progressStore.js';
import { worldName } from './worlds.js';
import { renderStore, renderProfile, clearShopMessages } from './shopUi.js';

// THE MENUS: a bottom tab bar (HOME, GEAR, WORLDS, STORE) over the spinning
// board mazeGame.js keeps as the backdrop, plus the home screen's top HUD.
//
// mazeGame.js decides WHEN the menus are up (leaving a level, boot) and calls
// the handler registered here with the tab to show, or null when a level
// starts. This module only decides what is on screen.
//
// initMenus({ store, game }) once; `game` is mazeGame's
// { setMenuHandler, showMenus, playLevel, nextLevel, getLevels,
//   refreshLevelSelect, refreshShowcase }.

const TABS = {
    home: 'homeView',
    gear: 'profileView',
    worlds: 'mazeSelect',
    store: 'storeView'
};

let ctx = null;
let current = null;
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
    else if (tab === 'gear') { clearShopMessages(); renderProfile(); }
    else if (tab === 'store') { clearShopMessages(); renderStore(); }
    else if (tab === 'worlds') ctx.game.refreshLevelSelect();
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

export function initMenus({ store, game }) {
    ctx = { store, game };
    game.setMenuHandler((tab) => show(tab));
    for (const t of Object.keys(TABS)) {
        const b = $('tab_' + t);
        if (b) b.addEventListener('click', (e) => { e.preventDefault(); if (current !== t) game.showMenus(t); });
    }
    const play = $('homePlayBtn');
    if (play) play.addEventListener('click', (e) => { e.preventDefault(); game.playLevel(); });
}

// After the marble changed: rebuild the backdrop so it shows the new one.
export function marbleChanged() {
    if (!ctx) return;
    ctx.game.refreshShowcase();
    renderWallets();
}
