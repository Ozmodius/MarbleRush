// PORTRAIT ON A PHONE (the user's call, 2026-10-12: "when tilting on a phone
// the game can switch to landscape mid game"). Tilting a phone steeply trips
// its auto-rotate, and a web page cannot always stop that:
//
//   1. Where the browser allows it (Android in fullscreen, an installed web
//      app), screen.orientation.lock('portrait') holds the screen still.
//   2. Everywhere else (iPhones, a browser tab, CrazyGames' iframe), when a
//      phone's view turns landscape the page turns itself back: the body is
//      rotated a quarter turn so the game stays upright to the phone's own
//      top, as if nothing had happened. The game then reads tilt as portrait
//      (screenAngle 0), pointers through contentPoint(), and the phone's
//      layout rules through `html.is-turned` (style.css).
//
// Phones only: a coarse pointer and a short side of a phone's (tablets turn
// freely). Never over the landing site (a page to scroll and read).
//
// turnFor() and toContent() are pure (test_portrait.js); holdPortrait()
// applies them and follows rotation; contentPoint() and pageRect() are what
// pointer and layout code read in place of clientX and getBoundingClientRect.

export const PHONE_SHORT_SIDE = 520;     // CSS px: wider than any phone, narrower than tablets
export const NARROW_SIDE = 400;          // style.css's (max-width: 400px) rules

// The quarter turn to undo: 0 (upright), 90 or 270 -- the screen's own
// angle when a phone's view has gone landscape.
export function turnFor({ coarse = false, screenShort = 0, width = 0, height = 0, angle = 0, landing = false } = {}) {
    if (!coarse || landing || !(screenShort > 0) || screenShort > PHONE_SHORT_SIDE) return 0;
    if (!(width > height)) return 0;
    const a = ((Math.round(Number(angle) || 0) % 360) + 360) % 360;
    return a === 270 ? 270 : 90;                 // landscape with no angle reported: the usual way round
}

// A pointer's viewport point (clientX, clientY) in the turned page's own
// coordinates, its box `height` wide and `width` tall (the viewport's
// width x height swapped). turn 90: the page is rotated -90deg about the
// viewport's centre, so its top lies along the viewport's left edge.
export function toContent(turn, x, y, width, height) {
    if (turn === 90) return { x: height - y, y: x };
    if (turn === 270) return { x: y, y: width - x };
    return { x, y };
}

let turn = 0;
// The current turn (0 when the page is upright).
export function currentTurn() { return turn; }
// An event's (or a point's) position in page coordinates, and the page's
// size: what pointer code reads instead of clientX / innerWidth.
export function contentPoint(e) {
    const W = typeof window !== 'undefined' ? window.innerWidth : 0, H = typeof window !== 'undefined' ? window.innerHeight : 0;
    const p = toContent(turn, e.clientX, e.clientY, W, H);
    return { x: p.x, y: p.y, w: turn ? H : W, h: turn ? W : H };
}

// An element's box in page coordinates: what layout code reads instead of
// getBoundingClientRect(), which gives a turned element's box in the
// viewport's. A quarter turn keeps a box a box: map two corners.
export function pageRect(el) {
    const r = el.getBoundingClientRect();
    if (!turn) return r;
    const W = window.innerWidth, H = window.innerHeight;
    const a = toContent(turn, r.left, r.top, W, H), b = toContent(turn, r.right, r.bottom, W, H);
    const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y), right = Math.max(a.x, b.x), bottom = Math.max(a.y, b.y);
    return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top };
}

export function holdPortrait(win = typeof window !== 'undefined' ? window : null) {
    if (!win || !win.document) return;
    const doc = win.document, root = doc.documentElement;
    const coarse = () => { try { return !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches) || (win.navigator && win.navigator.maxTouchPoints > 0); } catch (_) { return false; } };
    const screenShort = () => { try { return Math.min(win.screen.width, win.screen.height); } catch (_) { return 0; } };
    const angle = () => {
        try { if (win.screen && win.screen.orientation && Number.isFinite(win.screen.orientation.angle)) return win.screen.orientation.angle; } catch (_) { /* none */ }
        const o = Number(win.orientation);
        return Number.isFinite(o) ? (o < 0 ? 360 + o : o) : 0;
    };
    const landingOpen = () => { const l = doc.getElementById('landing'); return !!(l && !l.hidden); };
    const tryLock = () => {
        if (!coarse() || screenShort() > PHONE_SHORT_SIDE) return;
        try {
            const p = win.screen && win.screen.orientation && win.screen.orientation.lock && win.screen.orientation.lock('portrait');
            if (p && p.catch) p.catch(() => { /* not allowed here (a tab, an iframe): the turn below covers it */ });
        } catch (_) { /* none */ }
    };
    const apply = () => {
        const t = turnFor({ coarse: coarse(), screenShort: screenShort(), width: win.innerWidth, height: win.innerHeight, angle: angle(), landing: landingOpen() });
        if (t !== turn) {
            turn = t;
            root.classList.toggle('is-turned', !!t);
            root.classList.toggle('turn-90', t === 90);
            root.classList.toggle('turn-270', t === 270);
        }
        root.classList.toggle('is-turned-narrow', !!t && screenShort() <= NARROW_SIDE);
        if (t) {
            root.style.setProperty('--turn-w', win.innerHeight + 'px');
            root.style.setProperty('--turn-h', win.innerWidth + 'px');
        }
    };
    apply();
    tryLock();
    try { win.addEventListener('resize', apply); } catch (_) { /* none */ }
    try { win.addEventListener('orientationchange', () => { apply(); setTimeout(apply, 250); }); } catch (_) { /* none */ }
    try { if (win.screen && win.screen.orientation) win.screen.orientation.addEventListener('change', apply); } catch (_) { /* none */ }
    try { doc.addEventListener('fullscreenchange', tryLock); } catch (_) { /* none */ }
    // The landing site opens and closes: no turn over it.
    try { const l = doc.getElementById('landing'); if (l && win.MutationObserver) new win.MutationObserver(apply).observe(l, { attributes: true, attributeFilter: ['hidden'] }); } catch (_) { /* none */ }
}
