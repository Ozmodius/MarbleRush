// UI SOUND + HAPTICS -- procedural blips on the Web Audio API, no audio files.
//
// Ball Smack's version shared the match's AudioContext through state.js. Marble
// Rush owns its own, created on the first user gesture (browsers refuse to start
// audio before one) and resumed on every later tap while suspended, which is
// what CrazyGames asks for after iOS interruptions. Muted while the platform
// says so (an ad playing, or the player's CrazyGames mute setting).
import { isPlatformMuted, isAdPlaying } from './platform.js';

const MUTE_KEY = 'marblerush_muted';
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
let ctx = null;

export function isUiMuted() { return muted; }
export function setUiMuted(m) {
    muted = !!m;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
}

function unlock() {
    try {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) ctx = new AC();
        }
        if (ctx && ctx.state === 'suspended') ctx.resume();
    } catch (e) { /* no audio on this device */ }
}
if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('touchend', unlock, true);
    window.addEventListener('keydown', unlock, true);
}

function silent() { return muted || isPlatformMuted() || isAdPlaying(); }

function blip(freq, dur, type, gain, slideTo) {
    if (silent() || !ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.06, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
}

function buzz(ms) {
    if (silent()) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
}

export const uiSfx = {
    tap()      { blip(430, 0.05, 'triangle', 0.05); buzz(8); },
    nav()      { blip(320, 0.05, 'sine', 0.055, 480); buzz(10); },
    open()     { blip(360, 0.09, 'sine', 0.06, 560); buzz(12); },
    close()    { blip(440, 0.08, 'sine', 0.05, 240); buzz(9); },
    toggle(on) { blip(on ? 620 : 340, 0.06, 'square', 0.045); buzz(on ? 14 : 8); },
};
