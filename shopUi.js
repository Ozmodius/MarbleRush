import { MARBLES, CHARGES, CHARGE_IDS, TRAP_CHARGE_IDS, AD_REWARDS, LOOKS, EXPLORER, EXPLORER_IDS } from './shopCatalog.js';
import { skinDataUrl } from './skins3d.js';
import { trailCss } from './trail3d.js';
import { adsAvailable, showRewardedAd, adFailureMessage } from './platform.js';
import { sfx } from './sfx.js';
import { worldName } from './worlds.js';
import { POCKET_LEVELS } from './pockets.js';
import { pageText, pageNumber } from './diary.js';

// THE STORE AND PROFILE PAGES. DOM only: every rule (prices, what may be
// bought, what a marble does) lives in shopCatalog.js and progressStore.js,
// and every purchase goes through the progress store, which saves it.
//
//   STORE    power-ups, and each opened planet's trap charge
//   PROFILE  (Gear) the marble's looks, the diary, what you hold, how far
//            you have got. Picking and upgrading the marble is the Crew's
//            (crewUi.js), which borrows this file's little helpers.
//
// initShopUi({ store, getLevels, onChange, tryMarble }) once; menus.js calls renderStore /
// renderProfile when their tab opens. onChange fires after anything that
// changes what the home screen shows (a marble picked, coins spent).

let ctx = null;

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-US');

export function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

export function renderWallets() {
    const w = fmt(ctx.store.get().wallet);
    for (const id of ['mazeWallet', 'storeWallet', 'profileWallet', 'homeWallet', 'crewWallet']) { const e = $(id); if (e) e.textContent = w; }
}
const changed = () => { if (ctx.onChange) ctx.onChange(); };

// A one-line answer to the last tap, in place of a dialog (no browser dialogs:
// CLAUDE.md).
export function say(where, text, good) {
    const e = $(where);
    if (!e) return;
    e.textContent = text;
    e.classList.toggle('is-good', !!good);
    e.classList.toggle('is-bad', !good);
}

const REASONS = { short: 'Not enough coins', owned: 'Already yours', maxed: 'Fully upgraded', 'not-earned': 'Earn it first', bond: 'Needs more bond', 'not-open': 'Open that planet first', 'not-owned': 'Recruit them first' };
export function buyResult(where, res, okText) {
    if (res.ok) { say(where, okText, true); try { sfx.coin(); } catch (_) { /* ignore */ } }
    else say(where, REASONS[res.reason] || 'Could not buy that', false);
    renderWallets();
}

// A buy button: price on it always, disabled (but still showing the price)
// when the wallet cannot cover it, so the player sees what to save up for.
export function buyButton(price, wallet, onTap, label) {
    const b = h('button', 'shop-buy maze-btn');
    b.type = 'button';
    b.innerHTML = '';
    if (label) b.textContent = label;
    else { b.append(h('span', 'coin-dot')); b.append(document.createTextNode(fmt(price))); }
    b.disabled = !label && price > wallet;
    b.addEventListener('click', (e) => { e.preventDefault(); onTap(); });
    return b;
}

function pips(n, of) {
    const wrap = h('span', 'shop-pips');
    wrap.setAttribute('aria-label', `${n} of ${of}`);
    for (let i = 0; i < of; i++) wrap.append(h('span', 'shop-pip' + (i < n ? ' is-on' : '')));
    return wrap;
}

export function row(title, blurb, side, lead) {
    const r = h('div', 'shop-row');
    if (lead) r.append(lead);
    const main = h('div', 'shop-rowmain');
    main.append(h('span', 'shop-rowtitle', title));
    if (blurb) main.append(h('span', 'shop-rowblurb', blurb));
    r.append(main);
    const end = h('div', 'shop-rowside');
    for (const x of side) end.append(x);
    r.append(end);
    return r;
}

function builtWorlds() { return new Set(ctx.getLevels().map(l => l.world)); }

// --- STORE --------------------------------------------------------------
export function renderStore() {
    const p = ctx.store.get();
    const list = $('storeList');
    list.innerHTML = '';

    // FREE COINS for a rewarded ad: first in the store, offered only where an
    // ad can actually pay (CrazyGames), once per AD_REWARDS.coinsCooldownMs.
    if (adsAvailable()) {
        const wait = ctx.store.adCoinsWaitMs();
        const b = h('button', 'shop-buy maze-btn maze-btn-ad');
        b.type = 'button';
        if (wait > 0) {
            const m = Math.ceil(wait / 60000);
            b.textContent = `IN ${m} MIN`;
            b.disabled = true;
        } else {
            b.append(h('span', 'ad-play', '▶'), h('span', 'coin-dot'), document.createTextNode(fmt(AD_REWARDS.coins)));
            b.addEventListener('click', async (e) => {
                e.preventDefault();
                b.disabled = true;
                const ok = await showRewardedAd();
                if (ok && ctx.store.adCoins().ok) { say('storeMsg', `+${fmt(AD_REWARDS.coins)} coins`, true); try { sfx.coin(); } catch (_) { /* ignore */ } }
                else if (!ok) say('storeMsg', adFailureMessage(), false);
                renderWallets();
                renderStore();
                changed();
            });
        }
        list.append(h('p', 'shop-section', 'FREE COINS'));
        list.append(row('Watch a short ad', `${fmt(AD_REWARDS.coins)} coins, every few minutes.`, [b]));
    }

    list.append(h('p', 'shop-section', 'POWER-UPS'));
    for (const id of CHARGE_IDS.filter(k => !CHARGES[k].cover)) {
        const c = CHARGES[id];
        const owned = p.charges[id] || 0;
        list.append(row(c.name, c.blurb, [
            h('span', 'shop-owned', owned ? 'x' + owned : ''),
            buyButton(c.price, p.wallet, () => {
                buyResult('storeMsg', ctx.store.buyCharge(id), `+1 ${c.name}`);
                renderStore();
            })
        ], h('span', 'pu-dot pu-' + id)));
    }

    // PLANET CHARGES: each planet's answer to its own trap (crew.js), on sale
    // once that planet is opened. One is armed per run, spent only when it
    // fires. Planets not built yet are not listed.
    const worlds = builtWorlds();
    const gear = TRAP_CHARGE_IDS.filter(id => worlds.has(CHARGES[id].world));
    if (gear.length) {
        list.append(h('p', 'shop-section', 'PLANET CHARGES'));
        list.append(h('p', 'shop-note', 'One is armed each run and spent only if it saves you.'));
        for (const id of gear) {
            const c = CHARGES[id];
            const open = ctx.store.chargeOpen ? ctx.store.chargeOpen(id) : true;
            const owned = p.charges[id] || 0;
            const side = open
                ? [h('span', 'shop-owned', owned ? 'x' + owned : ''), buyButton(c.price, p.wallet, () => { buyResult('storeMsg', ctx.store.buyCharge(id), `+1 ${c.name}`); renderStore(); })]
                : [h('span', 'shop-locked', `Reach ${worldName(c.world)}`)];
            const r = row(c.name, `${worldName(c.world)}. ${c.blurb}`, side, h('span', 'trap-dot trap-' + id));
            r.dataset.charge = id;
            list.append(r);
        }
    }

    // EXPLORER: kit for walking a level (the Labyrinth). Bought once.
    list.append(h('p', 'shop-section', 'EXPLORER  ·  EXPLORE MODE'));
    for (const id of EXPLORER_IDS) {
        const e = EXPLORER[id];
        const owned = p.explorer.includes(id);
        const side = owned ? [h('span', 'shop-owned', 'OWNED')]
            : [buyButton(e.price, p.wallet, () => { buyResult('storeMsg', ctx.store.buyExplorer(id), `${e.name} bought`); renderStore(); changed(); })];
        const r = row(e.name, e.blurb, side, h('span', 'explorer-badge explorer-' + id));
        r.dataset.explorer = id;
        list.append(r);
    }
    renderWallets();
}

// --- PROFILE ------------------------------------------------------------
// Stat bars are drawn from ballSetup() -- the same numbers buildWorld() uses
// -- scaled across the range the catalog spans, so the bars compare marbles
// rather than claim absolute units.
export const STAT_BARS = [
    { key: 'grip', label: 'Grip', lo: 0.2, hi: 0.65 },
    { key: 'bounce', label: 'Bounce', lo: 0.0, hi: 0.15 },
    { key: 'damping', label: 'Stopping', lo: 0.0, hi: 0.2 },
    { key: 'response', label: 'Response', lo: 0.8, hi: 1.4 }
];

// A marble as a little sphere; with a skin, the skin's drawing wrapped on it
// (half the picture: the side facing you).
export function swatch(id, big, skin) {
    const m = MARBLES[id];
    const s = h('span', 'marble-swatch' + (big ? ' is-big' : ''));
    s.style.setProperty('--m', m.swatch);
    const url = skin ? skinDataUrl(skin) : null;
    if (url) { s.classList.add('is-skin'); s.style.setProperty('--skin', `url(${url})`); }
    return s;
}

// SKINS and TRAILS: a card each -- preview, name, and BUY / WEAR / WORN, or the
// player level that unlocks a reward one.
function renderLooks(kind, gridId) {
    const L = LOOKS[kind];
    const p = ctx.store.get();
    const lvl = ctx.store.playerLevel ? ctx.store.playerLevel().level : 1;
    const grid = $(gridId);
    grid.innerHTML = '';
    for (const [id, item] of Object.entries(L.table)) {
        const owned = p[L.owned].includes(id);
        const worn = p[L.chosen] === id;
        const card = h('div', 'look-card' + (worn ? ' is-selected' : '') + (!owned && !Number.isFinite(item.price) ? ' is-locked' : ''));
        card.dataset.look = kind + ':' + id;
        let prev;
        if (kind === 'skin') prev = swatch(p.marble, false, id);
        else {
            prev = h('span', 'trail-swatch');
            const css = trailCss(id);
            if (css) prev.style.background = css; else prev.classList.add('is-none');
        }
        card.append(prev, h('span', 'look-name', item.name));
        card.title = item.blurb;
        let btn;
        if (worn) { btn = buyButton(0, 0, () => {}, 'WORN'); btn.disabled = true; }
        else if (owned) btn = buyButton(0, 0, () => { ctx.store.selectLook(kind, id); say('profileMsg', `${item.name} on`, true); renderProfile(); changed(); }, 'WEAR');
        else if (!Number.isFinite(item.price)) { btn = buyButton(0, 0, () => {}, 'LEVEL ' + item.level); btn.disabled = true; btn.title = `Unlocks at player level ${item.level} (you are level ${lvl})`; }
        else btn = buyButton(item.price, p.wallet, () => {
            buyResult('profileMsg', ctx.store.buyLook(kind, id), `${item.name} bought and on`);
            renderProfile();
            changed();
        });
        btn.classList.add('look-action');
        card.append(btn);
        grid.append(card);
    }
}

export function renderProfile() {
    const p = ctx.store.get();
    const cur = p.marble;
    $('profileMarble').innerHTML = '';
    $('profileMarble').append(swatch(cur, true, p.skin));
    $('profileMarbleName').textContent = MARBLES[cur].name;

    renderDiary(p);
    renderLooks('skin', 'profileSkins');
    renderLooks('trail', 'profileTrails');

    // How far you have got, and what you are carrying.
    const ids = new Set(ctx.getLevels().map(l => l.id));
    const cleared = Object.keys(p.cleared).filter(id => ids.has(id)).length;
    const coins = Object.values(p.cleared).reduce((n, c) => n + (c.coins || 0), 0);
    const stats = $('profileStats');
    stats.innerHTML = '';
    for (const [label, value] of [
        ['Player level', String(ctx.store.playerLevel ? ctx.store.playerLevel().level : 1)],
        ['Levels cleared', `${cleared} / ${ctx.getLevels().length}`],
        ['Gold medals', String(p.goldClaimed.filter(id => ids.has(id)).length)],
        ['Coins found', fmt(coins)]
    ]) {
        const s = h('div', 'profile-stat');
        s.append(h('span', 'profile-statvalue', value), h('span', 'profile-statlabel', label));
        stats.append(s);
    }

    const inv = $('profileInventory');
    inv.innerHTML = '';
    const items = [
        ...CHARGE_IDS.filter(id => p.charges[id]).map(id => [CHARGES[id].name, 'x' + p.charges[id], CHARGES[id].cover ? 'trap-dot trap-' + id : 'pu-dot pu-' + id])
    ];
    if (!items.length) inv.append(h('p', 'shop-empty', 'Nothing yet. Power-ups and planet gear are in the store.'));
    for (const [name, n, cls] of items) {
        const it = h('div', 'profile-item');
        it.append(h('span', cls), h('span', 'profile-itemname', name), h('span', 'shop-owned', n));
        inv.append(it);
    }
    renderWallets();
}

export function clearShopMessages() { say('storeMsg', '', true); say('profileMsg', '', true); say('crewMsg', '', true); }

export function initShopUi({ store, getLevels, onChange, tryMarble }) {
    ctx = { store, getLevels: getLevels || (() => []), onChange: onChange || null, tryMarble: tryMarble || null };
}
// The Crew page (crewUi.js) shares this page's context.
export const shopContext = () => ctx;

// THE BARON'S DIARY in Gear (diary.js): every page, found ones to read, the
// rest saying which planet hides them.
function renderDiary(p) {
    const box = $('profileDiary');
    if (!box) return;
    box.innerHTML = '';
    for (const id of POCKET_LEVELS) {
        const found = (p.diary || []).includes(id);
        const world = Number((/^w(\d+)_/.exec(id) || [])[1]);
        const row = h('div', 'diary-page' + (found ? ' is-found' : ''));
        row.append(h('p', 'diary-head', `PAGE ${pageNumber(id)}  \u00b7  ${worldName(world).toUpperCase()}`));
        row.append(h('p', 'diary-text', found ? pageText(id) : `Hidden somewhere on ${worldName(world)}.`));
        box.append(row);
    }
}
