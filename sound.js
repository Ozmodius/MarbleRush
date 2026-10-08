import { isPlatformMuted, isAdPlaying } from './platform.js';
import { createSoundEngine } from './soundEngine.js';

// THE LIVE SOUND: one AudioContext for the page, and whether it may be heard.
//
// The context is made on the first tap or key (browsers refuse audio before
// one) and the engine (soundEngine.js) is built on it. Silent when the player
// has switched sound off (a device preference in localStorage, never in the
// save: it is about this phone, not this player), when the platform mutes
// (CrazyGames' own switch), while an ad plays (their rule), and while the tab
// is hidden. Any failure is silent: a game must never break for a sound.

const PREF_KEY = 'planetilt.sound';
let engine = null;
let failed = false;
let userOn = readPref();
let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
const listeners = new Set();

function readPref() {
    try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch (_) { return true; }
}

// The engine, or null before the first gesture (or with no Web Audio).
export function sound() {
    if (engine || failed) return engine;
    return null;
}

function create() {
    if (engine || failed || typeof window === 'undefined') return engine;
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { failed = true; return null; }
        engine = createSoundEngine(new AC({ latencyHint: 'interactive' }));
        applyMute();
        listeners.forEach(fn => { try { fn(engine); } catch (_) { /* ignore */ } });
    } catch (e) {
        failed = true;
        engine = null;
    }
    return engine;
}

// Call from a user gesture: makes the context, or wakes a suspended one
// (iOS suspends it whenever the page goes to the background).
export function unlockSound() {
    const e = create();
    if (e && e.ctx.state !== 'running') { try { e.ctx.resume(); } catch (_) { /* ignore */ } }
    return e;
}

// Run fn(engine) once the engine exists (now, or on the first gesture).
export function onSoundReady(fn) {
    if (engine) { try { fn(engine); } catch (_) { /* ignore */ } } else listeners.add(fn);
}

export function isSoundOn() { return userOn; }
export function setSoundOn(on) {
    userOn = !!on;
    try { localStorage.setItem(PREF_KEY, userOn ? 'on' : 'off'); } catch (_) { /* ignore */ }
    applyMute();
}
export function isSilent() { return !userOn || hidden || isPlatformMuted() || isAdPlaying(); }

// Re-read every mute source; cheap, so the run calls it each frame.
export function applyMute() {
    if (!engine) return;
    try { engine.setVolume(isSilent() ? 0 : 0.9); } catch (_) { /* ignore */ }
}

if (typeof window !== 'undefined') {
    const gesture = () => unlockSound();
    window.addEventListener('pointerdown', gesture, true);
    window.addEventListener('keydown', gesture, true);
    window.addEventListener('touchend', gesture, true);
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            hidden = document.visibilityState === 'hidden';
            applyMute();
            if (!hidden && engine && engine.ctx.state !== 'running') { try { engine.ctx.resume(); } catch (_) { /* ignore */ } }
        });
    }
    // Test seam: what the sound is doing, without anyone having to listen.
    window.__soundDebug = {
        ready: () => !!engine,
        state: () => engine ? engine.ctx.state : 'none',
        silent: () => isSilent(),
        rollLevel: () => engine ? engine.rollLevel() : 0,
        counts: () => ({ ...counts })
    };
}

// What has played, by name, for the browser test.
export const counts = {};
export function count(name) { counts[name] = (counts[name] || 0) + 1; }

// Play one engine sound by name, if there is an engine and it is audible.
export function play(name, opts) {
    count(name);
    const e = engine;
    if (!e || isSilent()) return;
    try { e[name](opts || {}); } catch (_) { /* never break the game for a sound */ }
}
