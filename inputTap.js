// Shared tap binding. Fires the handler on pointer-UP (after the tap's gesture
// has fully resolved), not pointer-DOWN, and cancels if the pointer moved past
// a small threshold first. This fixes two long-standing input bugs at once:
//
//  1. "Ghost tap": a pointerdown handler that opens/reveals a new interactive
//     element could hand that same still-down finger's gesture straight to the
//     newly-revealed element underneath. Acting on up means the originating
//     tap is already over before anything new appears. (This generalizes the
//     old bindButtonUp workaround that main.js had for the Settings opener.)
//  2. Scroll-vs-tap on item-select lists: binding equip/action on pointerdown
//     fired the action the instant a finger touched a card, so a swipe meant to
//     scroll the list still triggered the card. Tracking movement and bailing
//     once it exceeds the threshold lets a scroll gesture cancel the tap.
//
// pointerdown/move stay passive so the browser's native scroll is never
// blocked; only the terminating pointerup calls preventDefault.
export function bindTap(target, fn, opts = {}) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;
    const moveThreshold = opts.moveThreshold ?? 10;

    let tracking = false;
    let moved = false;
    let pid = null;
    let startX = 0;
    let startY = 0;

    el.addEventListener('pointerdown', (e) => {
        tracking = true;
        moved = false;
        pid = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
    }, { passive: true });

    el.addEventListener('pointermove', (e) => {
        if (!tracking || e.pointerId !== pid) return;
        if (Math.abs(e.clientX - startX) > moveThreshold ||
            Math.abs(e.clientY - startY) > moveThreshold) {
            moved = true;
        }
    }, { passive: true });

    el.addEventListener('pointerup', (e) => {
        if (!tracking || e.pointerId !== pid) return;
        tracking = false;
        if (moved) return;
        if (el.disabled) return;
        e.preventDefault();
        if (opts.stop) e.stopPropagation();
        fn(e);
    }, { passive: false });

    el.addEventListener('pointercancel', (e) => {
        if (e.pointerId === pid) tracking = false;
    });
}

// Ghost-tap settle guard for a just-opened overlay/sheet. On short viewports a
// sheet's own content can slide up to occupy the exact same screen position
// the opener button sat at (confirmed e.g. on a 360x640 viewport: the Settings
// overlay's "Ask Before Friendly Fire" toggle row lands directly under where
// the More menu's Settings button was) -- some mobile browsers can then
// deliver a stray click/pointerup from that same physical tap to whatever's
// now underneath, silently flipping a toggle the user never touched. This
// swallows every click/pointerdown/pointerup landing inside `overlayEl` for a
// brief settle window right after it opens (matching the .34s bsSheetUp slide
// animation), at the capture phase so it never reaches a checkbox/button
// descendant. Call right after setting the overlay's display to visible.
export function guardOverlayOpenGhostTap(overlayEl, ms = 400) {
    if (!overlayEl) return;
    const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
    const events = ['pointerdown', 'pointerup', 'click'];
    events.forEach(type => overlayEl.addEventListener(type, swallow, { capture: true }));
    setTimeout(() => {
        events.forEach(type => overlayEl.removeEventListener(type, swallow, { capture: true }));
    }, ms);
}
