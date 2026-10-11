// SAFE AREAS (2026-10-10, from the user's S25 Ultra): the page keeps its top
// and bottom bars clear of a phone's notch, status bar and home indicator
// through `--safe-top` / `--safe-bottom` (style.css), read from the browser's
// env(safe-area-inset-*) -- which needs `viewport-fit=cover`.
//
// Some Android browsers (in-app WebViews, DuckDuckGo here) report the
// system's status bar and nav bar as insets even though the page is drawn
// BETWEEN them, under the browser's own toolbar: home then sat ~38px below
// its top and ~54px above its bottom with nothing there. A page in an
// Android browser tab is never under the status bar, and Chrome only draws
// it under the nav bar when asked to (viewport-fit=cover). So in an Android
// tab, not fullscreen and not installed, the page drops viewport-fit=cover
// and its insets are zero. iPhones keep theirs: Safari's are real (the home
// indicator, the notch in landscape).
//
// trustInsets() is pure (test_safe_area.js); fitSafeArea() applies it and
// follows fullscreen and display-mode changes.

const COVER = 'viewport-fit=cover';

export function trustInsets({ userAgent = '', fullscreen = false, standalone = false } = {}) {
    if (!/Android/i.test(userAgent)) return true;
    return !!(fullscreen || standalone);
}

function viewportWith(content, cover) {
    const parts = String(content || '').split(',').map(s => s.trim()).filter(s => s && !/^viewport-fit\s*=/.test(s));
    if (cover) parts.push(COVER);
    return parts.join(', ');
}

let applied = null;
export function fitSafeArea(win = typeof window !== 'undefined' ? window : null) {
    if (!win || !win.document) return null;
    const doc = win.document;
    const apply = () => {
        let standalone = false;
        try { standalone = !!(win.matchMedia && win.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches); } catch (e) { /* none */ }
        const trust = trustInsets({ userAgent: (win.navigator && win.navigator.userAgent) || '', fullscreen: !!doc.fullscreenElement, standalone });
        if (trust === applied) return trust;
        applied = trust;
        const meta = doc.querySelector('meta[name="viewport"]');
        if (meta) meta.setAttribute('content', viewportWith(meta.getAttribute('content'), trust));
        const root = doc.documentElement.style;
        if (trust) { root.removeProperty('--safe-top'); root.removeProperty('--safe-bottom'); }
        else { root.setProperty('--safe-top', '0px'); root.setProperty('--safe-bottom', '0px'); }
        doc.documentElement.dataset.insets = trust ? 'device' : 'none';
        return trust;
    };
    const out = apply();
    try { doc.addEventListener('fullscreenchange', apply); } catch (e) { /* none */ }
    try { win.addEventListener('resize', apply); } catch (e) { /* none */ }
    return out;
}

export const _viewportWith = viewportWith;   // test seam
