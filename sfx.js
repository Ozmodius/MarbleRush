import { isPlatformMuted } from './platform.js';

// Tiny synthesized UI sounds -- no audio files to ship in the flat bundle.
// Replaces Ball Smack's uiSfx.js with the same two calls mazeGame.js used:
//   sfx.open()   something good (a coin, a pickup, a clear)
//   sfx.close()  something bad (a fall)
// plus sfx.coin() for the lighter coin blip.
//
// The AudioContext is made on first use, which is always after a tap (START),
// so browsers' autoplay rules are satisfied. CrazyGames' mute setting is
// honoured through platform.js. Any audio failure is silent: a game must never
// break because a sound could not play.

let ctx = null;
function audio() {
    if (ctx) return ctx;
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ctx = new AC();
    } catch (_) { ctx = null; }
    return ctx;
}

function blip(freqs, dur = 0.09, type = 'sine', gain = 0.08) {
    if (isPlatformMuted()) return;
    const a = audio();
    if (!a) return;
    try {
        if (a.state === 'suspended') a.resume();
        let t = a.currentTime;
        for (const f of freqs) {
            const o = a.createOscillator(), g = a.createGain();
            o.type = type;
            o.frequency.setValueAtTime(f, t);
            g.gain.setValueAtTime(gain, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g).connect(a.destination);
            o.start(t);
            o.stop(t + dur);
            t += dur * 0.7;
        }
    } catch (_) { /* never break the game for a sound */ }
}

export const sfx = {
    open: () => blip([523, 784], 0.1, 'triangle'),
    close: () => blip([330, 196], 0.14, 'sawtooth', 0.05),
    coin: () => blip([1318, 1760], 0.05, 'square', 0.035)
};
