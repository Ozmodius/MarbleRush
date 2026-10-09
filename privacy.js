// THE PRIVACY POLICY, as an in-game panel (#privacyPanel): no page to leave
// for, so the CrazyGames build links nowhere outside the game. Opened by any
// [data-privacy] button -- Gear's footer, the landing site's footer, and the
// first-run line under START (#privacyNote).
//
// THE FIRST-RUN LINE (CrazyGames: a game that keeps personal data beyond SDK
// events shows new players a simple, non-blocking notice): a new player's
// ready screen says, under START, that progress and best times are saved
// online, with a link here. Only when a server is configured (with none,
// nothing leaves the device). Gone once their first run starts.
//
// Keep the policy TRUE to server/: change it when what the server keeps does.

const OPERATOR = 'Ponotech LLC';
const CONTACT = 'ballsmack@ponotechhi.com';
const UPDATED = '8 October 2026';

const SECTIONS = [
    ['Who we are', `PlaneTilt is made by ${OPERATOR}. Questions or requests about your data: ${CONTACT}.`],
    ['On your device', 'Your progress (levels, medals, coins, marbles, settings) is saved on your device, or in your CrazyGames account when you play on CrazyGames.'],
    ['Online, when you play with an internet connection', 'A copy of your progress is kept on our server so it follows you between devices. With it we keep: the name you play under (a guest name like Guest-1234, your CrazyGames username, or your PlaneTilt username); your best time on each maze, shown on its public leaderboard with that name; which days you played and how far you have got; and daily totals of play (how often each level is started, cleared or failed), which are anonymous.'],
    ['PlaneTilt accounts (planetilt.com)', 'If you make an account we also keep your email address, used only to send you sign-in and password-reset codes and never shown to anyone, and your password, stored only as a salted scrypt hash. Delete your account in Gear and your account, save and leaderboard times are removed.'],
    ['What we do not do', 'We do not sell your data, show our own ads or track you across other sites. Your IP address is used only for a moment to stop abuse and is not stored. Ads and sign-in on CrazyGames are run by CrazyGames under its own privacy policy.'],
    ['Where it is kept', 'Our server and database are hosted by Render in the United States.'],
    ['Your choices', `To have your PlaneTilt data deleted, delete your account in Gear, or email ${CONTACT} with the name you play under.`],
    ['Children', 'PlaneTilt is made for players aged 13 and over.']
];

const $ = id => document.getElementById(id);

function render() {
    const body = $('privacyBody');
    if (!body || body.childElementCount) return;
    const upd = document.createElement('p');
    upd.className = 'privacy-updated';
    upd.textContent = 'Last updated ' + UPDATED;
    body.appendChild(upd);
    for (const [h, t] of SECTIONS) {
        const hh = document.createElement('h3');
        hh.textContent = h;
        const p = document.createElement('p');
        p.textContent = t;
        body.append(hh, p);
    }
}

export function openPrivacy() {
    const panel = $('privacyPanel');
    if (!panel) return;
    render();
    panel.hidden = false;
    const card = panel.querySelector('.modal-card');
    if (card) card.scrollTop = 0;
}
function closePrivacy() { const p = $('privacyPanel'); if (p) p.hidden = true; }

// initPrivacy({ online }) -> { runStarted() }
//   online: a server is configured (the first-run line is about it).
//   isNew: () => true for a player who has never played a level.
export function initPrivacy({ online, isNew }) {
    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('[data-privacy]');
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        openPrivacy();
    }, true);
    const close = $('privacyCloseBtn');
    if (close) close.addEventListener('click', (e) => { e.preventDefault(); closePrivacy(); });
    const panel = $('privacyPanel');
    if (panel) panel.addEventListener('click', (e) => { if (e.target === panel) closePrivacy(); });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && panel && !panel.hidden) closePrivacy(); });
    const note = $('privacyNote');
    if (note) note.hidden = !(online && isNew && isNew());
    return { runStarted() { if (note) note.hidden = true; } };
}
