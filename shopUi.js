import { MARBLES, MARBLE_IDS, UPGRADES, UPGRADE_IDS, CHARGES, CHARGE_IDS, PRIZES, PRIZE_IDS, ballSetup, AD_REWARDS } from './shopCatalog.js';
import { adsAvailable, showRewardedAd, adFailureMessage } from './platform.js';
import { upgradePrice } from './progressStore.js';
import { sfx } from './sfx.js';

// THE STORE AND PROFILE PAGES. DOM only: every rule (prices, what may be
// bought, what a marble does) lives in shopCatalog.js and progressStore.js,
// and every purchase goes through the progress store, which saves it.
//
//   STORE    upgrades, power-ups, refills of world prizes already earned
//   PROFILE  pick the marble for the next game (buy the ones not owned),
//            what you hold, how far you have got
//
// initShopUi({ store, getLevels, onChange }) once; menus.js calls renderStore /
// renderProfile when their tab opens. onChange fires after anything that
// changes what the home screen shows (a marble picked, coins spent).

let ctx = null;

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-US');

function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function renderWallets() {
    const w = fmt(ctx.store.get().wallet);
    for (const id of ['mazeWallet', 'storeWallet', 'profileWallet', 'homeWallet']) { const e = $(id); if (e) e.textContent = w; }
}
const changed = () => { if (ctx.onChange) ctx.onChange(); };

// A one-line answer to the last tap, in place of a dialog (no browser dialogs:
// CLAUDE.md).
function say(where, text, good) {
    const e = $(where);
    if (!e) return;
    e.textContent = text;
    e.classList.toggle('is-good', !!good);
    e.classList.toggle('is-bad', !good);
}

const REASONS = { short: 'Not enough coins', owned: 'Already yours', maxed: 'Fully upgraded', 'not-earned': 'Earn it first' };
function buyResult(where, res, okText) {
    if (res.ok) { say(where, okText, true); try { sfx.coin(); } catch (_) { /* ignore */ } }
    else say(where, REASONS[res.reason] || 'Could not buy that', false);
    renderWallets();
}

// A buy button: price on it always, disabled (but still showing the price)
// when the wallet cannot cover it, so the player sees what to save up for.
function buyButton(price, wallet, onTap, label) {
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

function row(title, blurb, side, lead) {
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

    list.append(h('p', 'shop-section', 'UPGRADES'));
    for (const id of UPGRADE_IDS) {
        const u = UPGRADES[id];
        const tier = p.upgrades[id] || 0;
        const price = upgradePrice(p, id);
        const btn = price === null
            ? buyButton(0, 0, () => {}, 'MAXED')
            : buyButton(price, p.wallet, () => {
                buyResult('storeMsg', ctx.store.buyUpgrade(id), `${u.name} upgraded to tier ${tier + 1}`);
                renderStore();
            });
        if (price === null) btn.disabled = true;
        list.append(row(u.name, u.blurb, [pips(tier, u.prices.length), btn]));
    }

    list.append(h('p', 'shop-section', 'POWER-UPS'));
    for (const id of CHARGE_IDS) {
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

    // Only prizes from worlds that exist; a refill only once the prize is
    // earned (progressStore.js buyPrizeRefill enforces it too).
    const worlds = builtWorlds();
    const prizes = PRIZE_IDS.filter(id => worlds.has(PRIZES[id].world));
    if (prizes.length) {
        list.append(h('p', 'shop-section', 'WORLD PRIZES'));
        for (const id of prizes) {
            const z = PRIZES[id];
            const earned = p.prizes.includes(id);
            const uses = p.prizeUses[id] || 0;
            const side = earned
                ? [h('span', 'shop-owned', uses ? uses + ' uses' : 'none left'),
                   buyButton(z.refill.price, p.wallet, () => {
                       buyResult('storeMsg', ctx.store.buyPrizeRefill(id), `+${z.refill.uses} ${z.name} uses`);
                       renderStore();
                   })]
                : [h('span', 'shop-locked', `Clear World ${z.world}`)];
            list.append(row(z.name, z.blurb + (earned ? ` ${z.refill.uses} uses per refill; one use covers one level.` : ''), side, h('span', 'prize-badge')));
        }
    }
    renderWallets();
}

// --- PROFILE ------------------------------------------------------------
// Stat bars are drawn from ballSetup() -- the same numbers buildWorld() uses
// -- scaled across the range the catalog spans, so the bars compare marbles
// rather than claim absolute units.
const STAT_BARS = [
    { key: 'grip', label: 'Grip', lo: 0.2, hi: 0.65 },
    { key: 'bounce', label: 'Bounce', lo: 0.0, hi: 0.15 },
    { key: 'damping', label: 'Stopping', lo: 0.0, hi: 0.2 },
    { key: 'response', label: 'Response', lo: 0.8, hi: 1.4 }
];

function swatch(id, big) {
    const m = MARBLES[id];
    const s = h('span', 'marble-swatch' + (big ? ' is-big' : ''));
    s.style.setProperty('--m', m.swatch);
    return s;
}

export function renderProfile() {
    const p = ctx.store.get();
    const cur = p.marble;
    $('profileMarble').innerHTML = '';
    $('profileMarble').append(swatch(cur, true));
    $('profileMarbleName').textContent = MARBLES[cur].name;

    const grid = $('profileMarbles');
    grid.innerHTML = '';
    for (const id of MARBLE_IDS) {
        const m = MARBLES[id];
        const owned = p.marbles.includes(id);
        const selected = id === cur;
        const card = h('div', 'marble-card' + (selected ? ' is-selected' : ''));
        const head = h('div', 'marble-cardhead');
        head.append(swatch(id), h('span', 'marble-name', m.name));
        card.append(head);
        card.append(h('p', 'marble-blurb', m.blurb + (id === 'classic' ? ' Wears each world\'s own colour.' : '')));
        const b = ballSetup(id, p.upgrades);
        const bars = h('div', 'marble-bars');
        for (const s of STAT_BARS) {
            const f = Math.max(0.04, Math.min(1, (b[s.key] - s.lo) / (s.hi - s.lo)));
            const bar = h('div', 'marble-bar');
            bar.append(h('span', 'marble-barlabel', s.label));
            const track = h('span', 'marble-bartrack');
            const fill = h('span', 'marble-barfill');
            fill.style.width = (f * 100).toFixed(0) + '%';
            track.append(fill);
            bar.append(track);
            bars.append(bar);
        }
        card.append(bars);
        let btn;
        if (selected) { btn = buyButton(0, 0, () => {}, 'SELECTED'); btn.disabled = true; }
        else if (owned) btn = buyButton(0, 0, () => { ctx.store.selectMarble(id); say('profileMsg', `${m.name} is ready for the next game`, true); renderProfile(); changed(); }, 'SELECT');
        else btn = buyButton(m.price, p.wallet, () => {
            buyResult('profileMsg', ctx.store.buyMarble(id), `${m.name} bought and selected`);
            renderProfile();
            changed();
        });
        btn.classList.add('marble-action');
        card.append(btn);
        grid.append(card);
    }

    // How far you have got, and what you are carrying.
    const ids = new Set(ctx.getLevels().map(l => l.id));
    const cleared = Object.keys(p.cleared).filter(id => ids.has(id)).length;
    const coins = Object.values(p.cleared).reduce((n, c) => n + (c.coins || 0), 0);
    const stats = $('profileStats');
    stats.innerHTML = '';
    for (const [label, value] of [
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
        ...CHARGE_IDS.filter(id => p.charges[id]).map(id => [CHARGES[id].name, 'x' + p.charges[id], 'pu-dot pu-' + id]),
        ...PRIZE_IDS.filter(id => p.prizes.includes(id)).map(id => [PRIZES[id].name, (p.prizeUses[id] || 0) + ' uses', 'prize-badge'])
    ];
    if (!items.length) inv.append(h('p', 'shop-empty', 'Nothing yet. Power-ups are in the store; each world\'s prize is yours when you clear it.'));
    for (const [name, n, cls] of items) {
        const it = h('div', 'profile-item');
        it.append(h('span', cls), h('span', 'profile-itemname', name), h('span', 'shop-owned', n));
        inv.append(it);
    }
    renderWallets();
}

export function clearShopMessages() { say('storeMsg', '', true); say('profileMsg', '', true); }

export function initShopUi({ store, getLevels, onChange }) {
    ctx = { store, getLevels: getLevels || (() => []), onChange: onChange || null };
}
