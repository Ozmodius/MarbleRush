// KEEP THE SCREEN ON while a level is up.
//
// A tilt game gets no taps, so a phone sees an idle screen and locks it
// mid-run. Two ways to stop that, tried in order:
//
//  1. The SCREEN WAKE LOCK (navigator.wakeLock): the browser keeps the
//     screen on until we let go. Chrome/Android, Safari from iOS 16.4 (a
//     Home Screen app from about iOS 18.4), desktop browsers. The browser
//     drops it whenever the page is hidden, so it is taken again on return.
//  2. A VIDEO: a 2-second black clip, muted, inline, 16 px and invisible,
//     looping. A phone does not sleep while a video plays. For browsers
//     without the wake lock (older iPhones), and for pages that may not use
//     it -- inside CrazyGames' iframe the lock is refused unless their page
//     allows it. Costs a little battery, so it runs only when the lock fails.
//
// Held only in a level (ready screen, run, falls, the cleared screen); the
// menus let the phone sleep as usual. Any failure is silent: the game plays
// exactly as before, the screen just locks on its own timer.
//
// The clip is inlined (base64, ~2 KB each) because the CrazyGames bundle is
// flat and a media file is one more thing an upload can drop. Made with:
//   ffmpeg -f lavfi -i color=c=black:s=16x16:r=1 -f lavfi -i anullsrc=r=8000:cl=mono -t 2
//     -c:v libx264 -profile:v baseline -pix_fmt yuv420p -c:a aac -b:a 8k -movflags +faststart awake.mp4
//   (and -c:v libvpx -c:a libopus for awake.webm)

const MP4 = 'data:video/mp4;base64,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b21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTIgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAADmWIhAW///8PRQABT3+AARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcAAAAGQZo4CvqAARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAc=';
const WEBM = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAeFEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggGETbuMU6uEHFO7a1Osggdv7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECfYAAAAAAAFlSua0CmrgEAAAAAAAA414EBc8WInsA8YFGl0iGcgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4Q7msoA4ImwgRC6gRCagQKuAQAAAAAAAFzXgQJzxYiYj5RRjkT2RJyBACK1nIN1bmSIgQCGhkFfT1BVU1aqg2MuoFa7hATEtACDgQLhkZ+BAbWIQL9AAAAAAABiZIEQY6KTT3B1c0hlYWQBATgBQB8AAAAAABJUw2dA1nNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjAuMTYuMTAwc3PWY8CLY8WInsA8YFGl0iFnyKFFo4dFTkNPREVSRIeUTGF2YzYwLjMxLjEwMiBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwMDAwMDAwMABzc9djwItjxYiYj5RRjkT2RGfIokWjh0VOQ09ERVJEh5VMYXZjNjAuMzEuMTAyIGxpYm9wdXNnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwODAwMDAwMAAfQ7Z1RQnngQCji4IAAIAIC+Y7I6tgo6OBAACAEAIAnQEqEAAQAABHCIWFiJmEiAICAAwNYAD+/6tQgKOKggAVgAgIrLMOxqOKggApgAgIrLMOxqOKggA9gAgIrLMOxqOKggBRgAgIrLMOxqOKggBlgAgIrLMOxqOKggB5gAgIrLMOxqOKggCNgAgIrLMOxqOKggChgAgIrLMOxqOKggC1gAgIrLMOxqOKggDJgAgIrLMOxqOKggDdgAgIrLMOxqOKggDxgAgIrLMOxqOKggEFgAgIrLMOxqOKggEZgAgIrLMOxqOKggEtgAgIrLMOxqOKggFBgAgIrLMOxqOKggFVgAgIrLMOxqOKggFpgAgIrLMOxqOKggF9gAgIrLMOxqOKggGRgAgIrLMOxqOKggGlgAgIrLMOxqOKggG5gAgIrLMOxqOKggHNgAgIrLMOxqOKggHhgAgIrLMOxqOKggH1gAgIrLMOxqOKggIJgAgIrLMOxqOKggIdgAgIrLMOxqOKggIxgAgIrLMOxqOKggJFgAgIrLMOxqOKggJZgAgIrLMOxqOKggJtgAgIrLMOxqOKggKBgAgIrLMOxqOKggKVgAgIrLMOxqOKggKpgAgIrLMOxqOKggK9gAgIrLMOxqOKggLRgAgIrLMOxqOKggLlgAgIrLMOxqOKggL5gAgIrLMOxqOKggMNgAgIrLMOxqOKggMhgAgIrLMOxqOKggM1gAgIrLMOxqOKggNJgAgIrLMOxqOKggNdgAgIrLMOxqOKggNxgAgIrLMOxqOKggOFgAgIrLMOxqOKggOZgAgIrLMOxqOKggOtgAgIrLMOxqOKggPBgAgIrLMOxqOKggPVgAgIrLMOxqOKggPpgAgIrLMOxqOZgQPoALEBAAEQEAAYADA/9AwAAAD+/6tQgKOKggP9gAgIrLMOxqOKggQRgAgIrLMOxqOKggQlgAgIrLMOxqOKggQ5gAgIrLMOxqOKggRNgAgIrLMOxqOKggRhgAgIrLMOxqOKggR1gAgIrLMOxqOKggSJgAgIrLMOxqOKggSdgAgIrLMOxqOKggSxgAgIrLMOxqOKggTFgAgIrLMOxqOKggTZgAgIrLMOxqOKggTtgAgIrLMOxqOKggUBgAgIrLMOxqOKggUVgAgIrLMOxqOKggUpgAgIrLMOxqOKggU9gAgIrLMOxqOKggVRgAgIrLMOxqOKggVlgAgIrLMOxqOKggV5gAgIrLMOxqOKggWNgAgIrLMOxqOKggWhgAgIrLMOxqOKggW1gAgIrLMOxqOKggXJgAgIrLMOxqOKggXdgAgIrLMOxqOKggXxgAgIrLMOxqOKggYFgAgIrLMOxqOKggYZgAgIrLMOxqOKggYtgAgIrLMOxqOKggZBgAgIrLMOxqOKggZVgAgIrLMOxqOKggZpgAgIrLMOxqOKggZ9gAgIrLMOxqOKggaRgAgIrLMOxqOKggalgAgIrLMOxqOKgga5gAgIrLMOxqOKggbNgAgIrLMOxqOKggbhgAgIrLMOxqOKggb1gAgIrLMOxqOKggcJgAgIrLMOxqOKggcdgAgIrLMOxqOKggcxgAgIrLMOxqOKggdFgAgIrLMOxqOKggdZgAgIrLMOxqOKggdtgAgIrLMOxqOKggeBgAgIrLMOxqOKggeVgAgIrLMOxqOKggepgAgIrLMOxqOKgge9gAgIrLMOxqCToYqCB9EACAissw7GdaKEAM3+YBxTu2uRu4+zgQC3iveBAfGCAmDwgRA=';

let wanted = false;
let lock = null;           // the WakeLockSentinel while we hold one
let video = null;          // the fallback element, made on first need
let mode = 'none';         // 'lock' | 'video' | 'none', for the test seam
let requesting = false;

function hasDoc() { return typeof document !== 'undefined' && typeof window !== 'undefined'; }

// Ask for the screen to stay on (true) or let it sleep again (false).
export function keepAwake(on) {
    on = !!on;
    if (on === wanted) { if (on) acquire(); return; }
    wanted = on;
    if (on) acquire(); else releaseAll();
}
export function wakeMode() { return mode; }

async function acquire() {
    if (!wanted || !hasDoc() || document.visibilityState === 'hidden') return;
    if (lock || mode === 'video' || requesting) return;
    const wl = typeof navigator !== 'undefined' && navigator.wakeLock;
    if (wl && typeof wl.request === 'function') {
        requesting = true;
        try {
            const l = await wl.request('screen');
            requesting = false;
            if (!wanted) { try { await l.release(); } catch (_) { /* ignore */ } return; }
            lock = l;
            mode = 'lock';
            l.addEventListener('release', () => {
                // Released by the browser (page hidden) or by us. Either way
                // it is gone; visibilitychange takes it again if still wanted.
                if (lock === l) { lock = null; if (mode === 'lock') mode = 'none'; }
            });
            return;
        } catch (_) {
            requesting = false;    // refused (an iframe, a power saver): the video instead
        }
    }
    playVideo();
}

function makeVideo() {
    if (video) return video;
    const v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('muted', '');
    v.setAttribute('aria-hidden', 'true');
    v.setAttribute('tabindex', '-1');
    v.muted = true;
    v.loop = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.setAttribute('title', '');
    Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', zIndex: '-1' });
    for (const [src, type] of [[WEBM, 'video/webm'], [MP4, 'video/mp4']]) {
        const s = document.createElement('source');
        s.src = src; s.type = type;
        v.appendChild(s);
    }
    // Some iPhones stop a looped clip at its end; jump back before it gets there.
    v.addEventListener('timeupdate', () => { if (v.currentTime > 1.5) v.currentTime = 0.1; });
    document.body.appendChild(v);
    video = v;
    return v;
}

function playVideo() {
    if (!wanted || !hasDoc() || !document.body) return;
    const v = makeVideo();
    mode = 'video';
    let p;
    try { p = v.play(); } catch (_) { p = null; }
    if (p && typeof p.catch === 'function') {
        // Refused without a tap: try again on the next one.
        p.catch(() => { if (wanted && mode === 'video') waitForTap(); });
    }
}

let tapArmed = false;
function waitForTap() {
    if (tapArmed || !hasDoc()) return;
    tapArmed = true;
    const go = () => {
        tapArmed = false;
        window.removeEventListener('pointerdown', go, true);
        window.removeEventListener('keydown', go, true);
        if (wanted && mode === 'video' && video && video.paused) { try { video.play().catch(() => {}); } catch (_) { /* ignore */ } }
    };
    window.addEventListener('pointerdown', go, true);
    window.addEventListener('keydown', go, true);
}

function releaseAll() {
    const l = lock;
    lock = null;
    if (l) { try { l.release().catch(() => {}); } catch (_) { /* ignore */ } }
    if (video) { try { video.pause(); } catch (_) { /* ignore */ } }
    mode = 'none';
}

if (hasDoc()) {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (!wanted) return;
        if (mode === 'video') playVideo(); else acquire();
    });
    // Test seam: is the screen being held, and how.
    window.__wakeDebug = { mode: () => mode, wanted: () => wanted, videoPlaying: () => !!(video && !video.paused) };
}
