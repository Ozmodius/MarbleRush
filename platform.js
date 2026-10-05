// platform.js -- the ONE place the game asks "where am I running?"
//
// 3D Ball Smack ships from one codebase to more than one place:
//   - 'web'         -- 3dballsmack.com, served by server.js (the default);
//   - 'crazygames'  -- the static bundle scripts/buildCrazyGames.js produces
//                      for CrazyGames, which talks to the same server.js
//                      cross-origin (window.__SERVER_URL__).
//
// The rule that keeps those from drifting into two games: every behaviour
// that differs by platform goes through this module, and no other file reads
// window.__PLATFORM__ or window.CrazyGames itself. Game code asks a QUESTION
// ("may I offer the install card?", "the match just started") and this file
// answers it for whichever platform it is. The web answers are always the
// behaviour the game had before this module existed, so a web build that
// imports it behaves exactly as it did without it.
//
// The build injects the platform before any module runs:
//   <script>window.__PLATFORM__ = 'crazygames'; window.__SERVER_URL__ = '...';</script>
//   <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
// Nothing else turns CrazyGames mode on. If the SDK script is missing
// (an ad blocker, a test page) every SDK call below degrades to a no-op:
// the platform is still 'crazygames' for UI decisions, it just has no SDK
// to report to. A missing SDK must never stop the game from running.
//
// Imports nothing -- loaded by main.js, network.js, auth.js, mazeGame.js,
// installGuide.js and the texture loaders, so it has to sit below all of them
// in the module graph (and it must never import `three`: see Hard Rule 3).

const g = (typeof window !== 'undefined') ? window : {};

export const PLATFORM = g.__PLATFORM__ === 'crazygames' ? 'crazygames' : 'web';
export const isCrazyGames = PLATFORM === 'crazygames';

// Mark the document so CSS can hide whole groups of controls without each one
// needing a JS toggle: html[data-platform="crazygames"] .web-only { display:none }.
try { if (typeof document !== 'undefined') document.documentElement.setAttribute('data-platform', PLATFORM); } catch (_) { /* no DOM */ }

// What this platform permits. Read these instead of testing the platform name,
// so adding a third platform is a new row here rather than a hunt for every
// `if (isCrazyGames)` in the codebase.
//   offlineInstall -- service worker, "play with no signal" card, install guide.
//                     CrazyGames forbids sending players to a copy of the game
//                     outside it, and a worker on their host would cache our
//                     old builds across their updates.
//   externalLogin  -- Google sign-in. CrazyGames allows only its own login.
//   guestPlay      -- a PLAY NOW on the sign-in screen that starts a bot match
//                     with no account. CrazyGames requires new players to reach
//                     gameplay in one click. The web keeps its registered-only
//                     rule (CLAUDE.md, "Offline play is for REGISTERED players").
//   sellsOfflinePlay -- offline play is a one-time purchase (server.js's
//                     OFFLINE PLAY UNLOCK, paid through Square). Web only: a
//                     build carries one way of making money, and CrazyGames'
//                     is its own. Whether it is actually ON SALE is the
//                     server's call (it sends no price when it isn't).
//   platformLogin  -- the platform's own account is how players sign in
//                     ("Log in with CrazyGames"; server.js's crazyGamesLogin).
//                     Username/password, Register, Sign Out and editing your
//                     name or picture are hidden (.web-only): CrazyGames
//                     allows no other login and owns the name and picture.
export const features = Object.freeze(isCrazyGames
    ? { offlineInstall: false, externalLogin: false, guestPlay: true, sellsOfflinePlay: false, platformLogin: true, ownLoader: true, ads: true, sdkInvites: true }
    : { offlineInstall: true, externalLogin: true, guestPlay: false, sellsOfflinePlay: true, platformLogin: false, ownLoader: false, ads: false, sdkInvites: false });

// ---------------------------------------------------------------------------
// SDK plumbing
// ---------------------------------------------------------------------------

let sdk = null;                 // window.CrazyGames.SDK once init() resolves
let initPromise = null;
let settings = { muteAudio: false, disableChat: false };
const settingsListeners = new Set();

function call(fn) {
    if (!sdk) return undefined;
    try { return fn(sdk); } catch (e) { console.warn('[platform] SDK call failed:', e && e.message); return undefined; }
}

// Idempotent; every caller may await it. Resolves (never rejects) once the SDK
// is usable or known to be absent.
export function initPlatform() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        if (!isCrazyGames) return;
        const S = g.CrazyGames && g.CrazyGames.SDK;
        if (!S) { console.warn('[platform] CrazyGames SDK not present; running without it.'); return; }
        try {
            await S.init();
            sdk = S;
        } catch (e) {
            console.warn('[platform] CrazyGames SDK init failed:', e && e.message);
            return;
        }
        if (pendingLoading !== null) { const v = pendingLoading; pendingLoading = null; setLoading(v); }
        readSettings();
        call(s => s.game.addSettingsChangeListener((next) => { readSettings(next); }));
        call(s => s.user && typeof s.user.addAuthListener === 'function' && s.user.addAuthListener((user) => {
            authListeners.forEach(fn => { try { fn(user || null); } catch (_) {} });
        }));
        call(s => s.game.addJoinRoomListener((params) => {
            const roomId = params && params.roomId;
            if (roomId) joinRoomListeners.forEach(fn => { try { fn(String(roomId)); } catch (_) {} });
        }));
        // gameplayStart may have been requested before the SDK was ready (a
        // match restored on boot); report the state we are actually in.
        if (gameplayActive) call(s => s.game.gameplayStart());
    })();
    return initPromise;
}

function readSettings(next) {
    const src = next || call(s => s.game.settings) || {};
    const fresh = { muteAudio: !!src.muteAudio, disableChat: !!src.disableChat };
    const changed = fresh.muteAudio !== settings.muteAudio || fresh.disableChat !== settings.disableChat;
    settings = fresh;
    try { if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-chat-disabled', settings.disableChat); } catch (_) {}
    if (changed) settingsListeners.forEach(fn => { try { fn({ ...settings }); } catch (_) {} });
}

// ---------------------------------------------------------------------------
// Lifecycle: loading and gameplay
// ---------------------------------------------------------------------------

// Loading start/stop may be asked for before init() finishes (boot IS the
// loading phase), so the request is remembered and replayed.
let pendingLoading = null;
let loadingActive = false;
function setLoading(on) {
    if (!sdk) { pendingLoading = on; return; }
    if (on === loadingActive) return;
    loadingActive = on;
    call(s => on ? s.game.loadingStart() : s.game.loadingStop());
}
export function loadingStart() { if (isCrazyGames) setLoading(true); }
export function loadingStop() { if (isCrazyGames) setLoading(false); }

// gameplayStart/Stop are EDGE events to CrazyGames (it uses them to decide
// when an ad may show), but the game's natural signal is a LEVEL -- "a match
// is in play" arrives on every syncState. So callers report the level and
// this dedupes it into edges.
let gameplayActive = false;
export function setGameplayActive(active) {
    active = !!active;
    if (active === gameplayActive) return;
    gameplayActive = active;
    if (!isCrazyGames) return;
    call(s => active ? s.game.gameplayStart() : s.game.gameplayStop());
}
export function isGameplayActive() { return gameplayActive; }

// A big moment (a match won, a maze level cleared for the first time).
// CrazyGames rate-limits it on its side.
export function happytime() {
    if (isCrazyGames) call(s => s.game.happytime());
}

// How much of the game's FINITE content this player has finished, 0-100
// (SDK: game.reportGameCompletedPercentage). The match itself is endless, so
// the only thing with an end is the Marble Maze ladder: the share of its
// levels cleared. Reported on every read of the server's ledger, so a drop
// that adds levels lowers it again, as CrazyGames asks. Deduped, and never
// sent before the SDK is up (the maze is only reachable well after init).
let lastCompletion = null;
export function reportGameCompleted(percent) {
    if (!isCrazyGames || !Number.isFinite(percent)) return;
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    if (pct === lastCompletion) return;
    call(s => {
        if (typeof s.game.reportGameCompletedPercentage !== 'function') return;
        s.game.reportGameCompletedPercentage(pct);
        lastCompletion = pct;
    });
}

// ---------------------------------------------------------------------------
// Ads (CrazyGames only; the web build never shows one and every call here
// resolves false at once there)
// ---------------------------------------------------------------------------
//
// Two kinds, and the game decides WHERE, never mid-turn:
//   - midgame: at a natural break (leaving a finished match, between maze
//     runs). Self-throttled to one per MIDGAME_MIN_GAP_MS on top of the SDK's
//     own cooldown, so a player bouncing between menus is not shown one each
//     time.
//   - rewarded: only ever on a tap the player chose, for a reward the SERVER
//     grants (server.js's AD REWARDS) -- this resolves true only when the ad
//     ran to the end.
// While an ad plays the game must be silent and paused: listeners registered
// with onAdPlaying hear true/false (main.js suspends the audio context), and
// a gameplay that was running is reported stopped for the ad's duration.
// Errors (no fill, adblock, cooldown, ads off during Basic Launch) resolve
// false and are otherwise harmless: the break simply has no ad.
const MIDGAME_MIN_GAP_MS = 3 * 60 * 1000;
const AD_GIVE_UP_MS = 120 * 1000;     // an SDK that never calls back must not hang the caller
let adBusy = false;
let adPlaying = false;
let lastMidgameAt = 0;
// Why the last ad request came back without a finished ad, so a tap the
// player chose can say WHY rather than one catch-all line. One of: 'nosdk',
// 'busy', 'timeout', or the SDK's own adError code ('unfilled',
// 'adblock', 'adCooldown', 'adsDisabledBasicLaunch', 'other', ...).
let lastAdFailure = null;
const adListeners = new Set();
export function onAdPlaying(fn) { adListeners.add(fn); return () => adListeners.delete(fn); }
export function isAdPlaying() { return adPlaying; }
function setAdPlaying(on) {
    if (on === adPlaying) return;
    adPlaying = on;
    adListeners.forEach(fn => { try { fn(on); } catch (_) {} });
}
function requestAd(kind) {
    return new Promise((resolve) => {
        if (!features.ads) return resolve(false);
        if (adBusy) { lastAdFailure = 'busy'; return resolve(false); }
        if (!sdk || !sdk.ad || typeof sdk.ad.requestAd !== 'function') { lastAdFailure = 'nosdk'; return resolve(false); }
        adBusy = true;
        lastAdFailure = null;
        const resumeGameplay = gameplayActive;
        if (resumeGameplay) call(s => s.game.gameplayStop());
        let done = false;
        const finish = (ok, why) => {
            if (done) return;
            done = true;
            lastAdFailure = ok ? null : (why || 'other');
            clearTimeout(giveUp);
            adBusy = false;
            setAdPlaying(false);
            if (resumeGameplay && gameplayActive) call(s => s.game.gameplayStart());
            resolve(ok);
        };
        const giveUp = setTimeout(() => finish(false, 'timeout'), AD_GIVE_UP_MS);
        try {
            sdk.ad.requestAd(kind, {
                adStarted: () => setAdPlaying(true),
                adFinished: () => finish(true),
                adError: (e) => {
                    const code = e && e.code ? String(e.code) : 'other';
                    console.info('[platform] ' + kind + ' ad: ' + code + (e && e.message ? ' (' + e.message + ')' : ''));
                    finish(false, code);
                }
            });
        } catch (e) {
            finish(false, 'other');
        }
    });
}
export function showMidgameAd() {
    if (!features.ads) return Promise.resolve(false);
    const now = Date.now();
    if (now - lastMidgameAt < MIDGAME_MIN_GAP_MS) return Promise.resolve(false);
    lastMidgameAt = now;
    return requestAd('midgame');
}
export function showRewardedAd() {
    if (!features.ads) return Promise.resolve(false);
    return requestAd('rewarded');
}

// What to tell the player when showRewardedAd() resolved false. Codes are
// matched loosely (case, and the SDK's spellings have varied between
// versions), and anything unrecognised still names its code so a report
// from a player says what CrazyGames actually answered.
export function adFailureMessage() {
    const why = lastAdFailure || 'other';
    const k = why.toLowerCase();
    if (k === 'busy') return 'An ad is already playing. Wait for it to finish.';
    if (k === 'nosdk') return "Ads couldn't load. Reload the game and try again.";
    if (k === 'timeout') return 'The ad took too long to load. Try again.';
    if (k.includes('adblock') || k.includes('blocked')) return 'An ad blocker is stopping the ad. Turn it off for this site to get the reward.';
    if (k.includes('cooldown') || k.includes('toofrequent') || k.includes('frequency')) return 'You just watched an ad. Try again in a minute or two.';
    if (k.includes('basiclaunch') || k.includes('disabled')) return "Ads aren't switched on for this game yet, so there's no reward to watch for.";
    if (k.includes('unfilled') || k.includes('nofill') || k.includes('notfilled')) return 'No ad is available right now. Try again in a few minutes.';
    if (k.includes('closed') || k.includes('skip') || k.includes('cancel')) return 'The ad was closed before the end, so no reward this time.';
    return "The ad couldn't play (" + why + '). Try again later.';
}

// ---------------------------------------------------------------------------
// Settings the platform owns (CrazyGames: mute and chat switches in its UI)
// ---------------------------------------------------------------------------

export function isPlatformMuted() { return settings.muteAudio; }
export function isChatDisabled() { return settings.disableChat; }
export function onPlatformSettingsChange(fn) { settingsListeners.add(fn); return () => settingsListeners.delete(fn); }

// ---------------------------------------------------------------------------
// Rooms and invites
// ---------------------------------------------------------------------------

const joinRoomListeners = new Set();
// Fired when the player accepts an invite while the game is already open.
export function onInviteAccepted(fn) { joinRoomListeners.add(fn); return () => joinRoomListeners.delete(fn); }

// The room this launch was invited into, if any. Web: ?room=ABCD on the page
// URL, exactly as network.js always read it. CrazyGames: the invite params it
// hands the game (the iframe's own URL does not carry them).
export function inviteRoomId() {
    if (isCrazyGames) {
        const v = call(s => s.game.getInviteParam('roomId'));
        return v ? String(v) : null;
    }
    try { return new URLSearchParams(g.location.search).get('room'); } catch (_) { return null; }
}

// CrazyGames' "play with friends" launch (its own UI, not an invite link):
// the game must go straight into a multiplayer room the player's friends can
// join. Read defensively -- a property in the v3 SDK, but a function would be
// honoured too. Web: never.
export function isInstantMultiplayer() {
    if (!isCrazyGames) return false;
    const v = call(s => s.game.isInstantMultiplayer);
    if (typeof v === 'function') return !!call(s => v.call(s.game));
    return !!v;
}

// A shareable link into `roomId`. `webLink` is what the web build would show,
// and is the answer everywhere but CrazyGames (and on CrazyGames if the SDK is
// absent, where a link is still better than none).
export function inviteLinkFor(roomId, webLink) {
    if (isCrazyGames) {
        const v = call(s => s.game.inviteLink({ roomId: String(roomId) }));
        if (v) return String(v);
    }
    return webLink;
}

// Tell CrazyGames which room the player is in and whether friends can still
// join it, so its own "join friend" UI works. Diffed, because callers report
// on every syncState.
let lastRoomKey = null;
export function reportRoom(roomId, isJoinable) {
    if (!isCrazyGames) return;
    const key = roomId ? roomId + '|' + (isJoinable ? 1 : 0) : null;
    if (key === lastRoomKey) return;
    const wasInRoom = lastRoomKey !== null;
    lastRoomKey = key;
    if (!roomId) { if (wasInRoom) call(s => s.game.leftRoom()); return; }
    call(s => s.game.updateRoom({ roomId: String(roomId), isJoinable: !!isJoinable, inviteParams: { roomId: String(roomId) } }));
}

// ---------------------------------------------------------------------------
// Server-hosted assets
// ---------------------------------------------------------------------------

// Admin-uploaded cosmetic textures are served by server.js at
// /cosmetic-textures/<file>, and the catalog hands out exactly that
// root-relative URL. On the web the page IS on that server, so it resolves
// as-is. A bundle hosted elsewhere has to point it back at the server -- and a
// cross-origin image must be requested with CORS or it taints the canvas and
// WebGL refuses it (server.js already sends Access-Control-Allow-Origin: *
// on that route).
const SERVER_URL = (typeof g.__SERVER_URL__ === 'string' && g.__SERVER_URL__) ? g.__SERVER_URL__.replace(/\/+$/, '') : null;

// Uploaded avatars (/avatar/<id>, server.js's PROFILE SYNC) are the same story.
const SERVER_HOSTED = ['/cosmetic-textures/', '/avatar/'];
export function assetUrl(url) {
    if (SERVER_URL && typeof url === 'string' && SERVER_HOSTED.some(p => url.startsWith(p))) return SERVER_URL + url;
    return url;
}

// The crossOrigin value an <img>/TextureLoader needs for assetUrl(url), or
// null to leave it unset (the web build's behaviour, kept on purpose -- see
// pbrTextures.js on why same-origin loads skip the CORS handshake).
export function assetCrossOrigin(url) {
    return assetUrl(url) !== url ? 'anonymous' : null;
}

// ---------------------------------------------------------------------------
// Platform accounts (features.platformLogin -- CrazyGames)
// ---------------------------------------------------------------------------
// The server verifies the token; nothing here is trusted on its own.

const authListeners = new Set();
// Fired when the player logs in or out in the PLATFORM's UI (null = out).
export function onPlatformAuthChange(fn) { authListeners.add(fn); return () => authListeners.delete(fn); }

// Whether this host offers platform accounts at all (some CrazyGames partner
// sites do not). False until initPlatform() has resolved.
export function isPlatformLoginAvailable() {
    return isCrazyGames && !!call(s => s.user && s.user.isUserAccountAvailable);
}

// The signed-in platform user's JWT for server.js to verify, or null when
// nobody is signed in (or there is no SDK). CrazyGames asks for this on every
// launch, so callers do not cache it.
export async function getPlatformUserToken() {
    if (!isCrazyGames) return null;
    await initPlatform();
    if (!sdk || !sdk.user) return null;
    try {
        const user = await sdk.user.getUser();
        if (!user) return null;
        const token = await sdk.user.getUserToken();
        return typeof token === 'string' && token ? token : null;
    } catch (e) {
        console.warn('[platform] could not get a user token:', e && e.message);
        return null;
    }
}

// The platform's own sign-in dialog. Resolves true if a user is signed in
// afterwards; the auth listener fires as well.
export async function showPlatformLogin() {
    if (!isCrazyGames) return false;
    await initPlatform();
    if (!sdk || !sdk.user) return false;
    try { return !!(await sdk.user.showAuthPrompt()); }
    catch (_) { return false; }   // cancelled, or a prompt already open
}

// ---------------------------------------------------------------------------
// Save data (Marble Rush's progress store, progressStore.js)
// ---------------------------------------------------------------------------
// One string per key. On CrazyGames this is the SDK's data module, which keeps
// a guest's save on the device and syncs a signed-in player's to the cloud --
// the same calls either way, so a guest who signs in keeps their progress. On
// the web (and on CrazyGames with no SDK) it is localStorage. Either can be
// unavailable (private mode, blocked storage); reads then return null and
// writes report false, and the game plays on with progress kept in memory.
export async function loadSave(key) {
    await initPlatform();
    if (sdk && sdk.data) {
        const v = call(s => s.data.getItem(key));
        return typeof v === 'string' ? v : null;
    }
    try { return g.localStorage ? g.localStorage.getItem(key) : null; } catch (_) { return null; }
}

export function writeSave(key, value) {
    if (sdk && sdk.data) {
        return call(s => { s.data.setItem(key, value); return true; }) === true;
    }
    try { if (!g.localStorage) return false; g.localStorage.setItem(key, value); return true; } catch (_) { return false; }
}
