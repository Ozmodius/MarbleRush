import { MARBLES, MARBLE_IDS, ballSetup } from './shopCatalog.js';
import { SIGNATURES, TUNE, TRACK, bondOf, crewStep, nextStep, signatureUses } from './crew.js';
import { adsAvailable, showRewardedAd, adFailureMessage } from './platform.js';
import { worldName } from './worlds.js';
import { sfx } from './sfx.js';
import { h, say, buyButton, buyResult, renderWallets, swatch, STAT_BARS, shopContext } from './shopUi.js';

// THE CREW PAGE (the user's call, 2026-10-10): every marble a character, and
// each one's card -- who they are, their bond, their signature (free once a
// run, twice after the second step), the four-step track, and SELECT / BUY.
// DOM only: every rule is crew.js's and progressStore.js's, and every
// purchase goes through the progress store, which saves it.

const fmt = n => Number(n).toLocaleString('en-US');
const $ = id => document.getElementById(id);

const STEP_LABEL = {
    tune: (id, n) => `More ${TUNE[id] ? TUNE[id].label : 'grip'}${n > 1 ? ' again' : ''}`,
    twice: () => 'Signature twice a run',
    aura: () => 'Aura of their own'
};
function stepLabel(id, i) {
    const t = TRACK[i];
    const n = TRACK.slice(0, i + 1).filter(x => x.kind === t.kind).length;
    return STEP_LABEL[t.kind](id, n);
}

// Whether any crew member owned has a step ready and affordable (the tab's !).
export function crewReady(p) {
    return MARBLE_IDS.some(id => {
        if (!p.marbles.includes(id)) return false;
        const n = nextStep(p, id);
        return n && n.ready && p.wallet >= n.price;
    });
}

function card(id, p, ctx) {
    const m = MARBLES[id], sig = SIGNATURES[id];
    const owned = p.marbles.includes(id), selected = p.marble === id;
    const captive = !owned && !!m.rescue;
    const step = crewStep(p, id), bond = bondOf(p, id), next = nextStep(p, id);
    const c = h('div', 'marble-card crew-card' + (selected ? ' is-selected' : '') + (captive ? ' is-captive' : '') + (owned ? ' is-owned' : ''));
    c.dataset.crew = id;

    // Who: the marble, the name, where they come from.
    const head = h('div', 'marble-cardhead');
    head.append(swatch(id, true, selected ? p.skin : null));
    const who = h('div', 'crew-who');
    who.append(h('span', 'marble-name', m.name), h('span', 'crew-from', m.rescue ? `From ${worldName(m.rescue)}` : id === 'classic' ? 'The hero' : 'Crew for hire'));
    head.append(who);
    c.append(head);
    c.append(h('p', 'marble-blurb', captive ? `Caged by Baron Von Ratchet on ${worldName(m.rescue)}'s floor 10. Roll in and free ${m.name}.` : m.blurb));

    // Bond: the level, and the bar to the next.
    if (owned) {
        const b = h('div', 'crew-bond');
        b.append(h('span', 'crew-bondlvl', `BOND ${bond.level}`));
        const track = h('span', 'crew-bondtrack');
        const fill = h('span', 'crew-bondfill');
        fill.style.width = (bond.max ? 100 : Math.round(100 * (bond.xp - bond.from) / (bond.to - bond.from))) + '%';
        track.append(fill);
        b.append(track, h('span', 'crew-bondxp', bond.max ? 'MAX' : `${fmt(bond.xp)} / ${fmt(bond.to)}`));
        b.title = 'Bond grows with every level you clear as ' + m.name;
        c.append(b);
    }

    // The signature.
    const sg = h('div', 'crew-sig');
    const uses = signatureUses(step);
    sg.append(h('span', 'crew-signame', '✦ ' + sig.name.toUpperCase()), h('span', 'crew-siguses', uses > 1 ? 'TWICE A RUN' : 'ONCE A RUN'));
    sg.append(h('p', 'crew-sigblurb', sig.blurb));
    c.append(sg);

    // The track: four pips, what each brings, and the next step's button.
    if (owned) {
        const tr = h('ol', 'crew-track');
        TRACK.forEach((t, i) => {
            const li = h('li', 'crew-step' + (i < step ? ' is-on' : '') + (next && next.step === t.step ? ' is-next' : ''));
            li.append(h('span', 'crew-steppip'), h('span', 'crew-steplabel', stepLabel(id, i)));
            if (i >= step) li.append(h('span', 'crew-stepneed', `BOND ${t.bond}`));
            tr.append(li);
        });
        c.append(tr);
        const actions = h('div', 'crew-actions');
        if (!next) {
            const done = buyButton(0, 0, () => {}, 'TRACK COMPLETE'); done.disabled = true; done.classList.add('crew-upgrade');
            actions.append(done);
        } else if (!next.ready) {
            const wait = buyButton(0, 0, () => {}, `BOND ${next.bond} TO UNLOCK`); wait.disabled = true; wait.classList.add('crew-upgrade');
            wait.title = `Clear levels as ${m.name} to grow their bond`;
            actions.append(wait);
        } else {
            const up = buyButton(next.price, p.wallet, () => {
                buyResult('crewMsg', ctx.store.buyCrewStep(id), `${m.name}: ${stepLabel(id, next.step - 1).toLowerCase()}`);
                renderCrew();
                if (ctx.onChange) ctx.onChange();
            });
            up.classList.add('crew-upgrade');
            up.prepend(h('span', 'crew-upword', 'UPGRADE '));
            actions.append(up);
            // A FREE STEP for a rewarded ad (CrazyGames): a cheap one, once
            // per cooldown, and only once bond allows it. Bond is never sold.
            if (adsAvailable() && ctx.store.adUpgradeEligible && ctx.store.adUpgradeEligible(id)) {
                const wait = ctx.store.adUpgradeWaitMs();
                const f = h('button', 'shop-buy maze-btn maze-btn-ad shop-free');
                f.type = 'button';
                if (wait > 0) { f.textContent = `FREE IN ${Math.ceil(wait / 60000)} MIN`; f.disabled = true; }
                else {
                    f.append(h('span', 'ad-play', '▶'), document.createTextNode('FREE'));
                    f.setAttribute('aria-label', `Watch an ad for ${m.name}'s next step, free`);
                    f.addEventListener('click', async (e) => {
                        e.preventDefault();
                        f.disabled = true;
                        const ok = await showRewardedAd();
                        if (ok && ctx.store.adUpgrade(id).ok) { say('crewMsg', `${m.name}: next step, free`, true); try { sfx.coin(); } catch (_) { /* ignore */ } }
                        else if (!ok) say('crewMsg', adFailureMessage(), false);
                        renderCrew();
                        if (ctx.onChange) ctx.onChange();
                    });
                }
                actions.append(f);
            }
        }
        c.append(actions);
    }

    // Handling: the bars, with their tuned steps in.
    const b = ballSetup(id, step);
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
    c.append(bars);

    // Roll as them, recruit them, or where to free them.
    let btn;
    if (selected) { btn = buyButton(0, 0, () => {}, 'SELECTED'); btn.disabled = true; }
    else if (captive) { btn = buyButton(0, 0, () => {}, 'RESCUE ON FLOOR 10'); btn.disabled = true; btn.title = `Free ${m.name} on ${worldName(m.rescue)}'s floor 10`; }
    else if (owned) btn = buyButton(0, 0, () => { ctx.store.selectMarble(id); say('crewMsg', `${m.name} rolls next`, true); renderCrew(); if (ctx.onChange) ctx.onChange(); }, 'SELECT');
    else btn = buyButton(m.price, p.wallet, () => {
        buyResult('crewMsg', ctx.store.buyMarble(id), `${m.name} joins the crew`);
        renderCrew();
        if (ctx.onChange) ctx.onChange();
    });
    if (!owned && !captive && !selected) btn.prepend(h('span', 'crew-upword', 'RECRUIT '));
    btn.classList.add('marble-action');
    c.append(btn);
    // TRY IT (rewarded ad): the next level as them, before recruiting.
    if (!owned && !captive && adsAvailable() && ctx.tryMarble) {
        const t = h('button', 'shop-buy maze-btn maze-btn-ad marble-action');
        t.type = 'button';
        t.append(h('span', 'ad-play', '▶'), document.createTextNode('TRY'));
        t.setAttribute('aria-label', `Watch an ad to try ${m.name} for one level`);
        t.addEventListener('click', async (e) => {
            e.preventDefault();
            t.disabled = true;
            const ok = await showRewardedAd();
            if (ok && ctx.tryMarble(id)) return;
            say('crewMsg', ok ? 'No level to try it on' : adFailureMessage(), false);
            t.disabled = false;
        });
        c.append(t);
    }
    return c;
}

export function renderCrew() {
    const ctx = shopContext();
    const list = $('crewList');
    if (!ctx || !list) return;
    const p = ctx.store.get();
    list.innerHTML = '';
    list.append(h('p', 'shop-note crew-note', 'Clear levels as a character to grow their bond. Each bond level opens their next upgrade.'));
    // Owned first (the one rolling next on top), then those to recruit, then
    // friends still caged.
    const rank = id => (p.marble === id ? 0 : p.marbles.includes(id) ? 1 : MARBLES[id].rescue ? 3 : 2);
    const ids = [...MARBLE_IDS].sort((a, b) => rank(a) - rank(b) || MARBLE_IDS.indexOf(a) - MARBLE_IDS.indexOf(b));
    for (const id of ids) list.append(card(id, p, ctx));
    renderWallets();
}

