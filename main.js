import { features, initPlatform, loadingStart, loadingStop, loadSave, writeSave, onAdBusy, apiBase, getPlatformUserToken, onPlatformAuthChange, isPlatformLoginAvailable, showPlatformLogin } from './platform.js';
import { initSceneHost, setCovered } from './sceneHost.js';
import { createProgressStore } from './progressStore.js';
import * as game from './mazeGame.js';
import { initShopUi } from './shopUi.js';
import { initMenus, marbleChanged, progressChanged } from './menus.js';
import { createCloudSync } from './cloudSync.js';
import { initCloudUi } from './leaderboardUi.js';
import { initPrivacy } from './privacy.js';

// BOOT. Platform first (CrazyGames wants loadingStart as early as possible and
// the save may live in its SDK), then the renderer, then the save, then the
// game. The cloud save starts last and in the background: the game never
// waits on the network (cloudSync.js).

function bootMessage(text) {
    const el = document.getElementById('bootMsg');
    if (!el) return;
    if (text) { el.textContent = text; el.style.display = ''; }
    else el.style.display = 'none';
}

async function boot() {
    loadingStart();
    await initPlatform();
    // While an ad is being fetched or played, nothing under it takes a tap.
    onAdBusy((busy) => {
        const shield = document.getElementById('adShield');
        if (shield) shield.style.display = busy ? '' : 'none';
    });

    if (!initSceneHost(document.getElementById('gameCanvas'))) {
        loadingStop();
        bootMessage('THIS DEVICE CANNOT RUN 3D (WEBGL IS OFF OR UNSUPPORTED)');
        return;
    }

    const store = createProgressStore({ load: loadSave, save: writeSave });
    await store.load();

    game.initMazeControls();
    initShopUi({ store, getLevels: game.getLevels, onChange: marbleChanged, tryMarble: game.startMarbleTrial });
    initMenus({ store, game });
    const ok = await game.enterMaze(store);
    // A first visit opens on level 1, START away from playing (CrazyGames'
    // Full Launch rule: at most one click to gameplay); home and the daily
    // calendar come after. Not behind the web's sign-in front door
    // (features.requireLogin with a server), where someone signing in may
    // be a returning player and the landing site is the first screen anyway.
    if (ok && game.isNewPlayer() && !(features.requireLogin && apiBase())) game.playLevel();
    loadingStop();
    bootMessage(ok ? '' : 'COULD NOT LOAD THE LEVELS. RELOAD TO TRY AGAIN.');

    const sync = createCloudSync({ store, api: apiBase(), getCrazyToken: getPlatformUserToken, onRemoteChange: progressChanged });
    const privacy = initPrivacy({ online: !!sync.enabled, isNew: game.isNewPlayer });
    game.setClearListener(initCloudUi({ sync, login: { available: isPlatformLoginAvailable, show: showPlatformLogin }, cover: setCovered }));
    game.setRunListener((ev) => { if (ev && ev.type === 'start') privacy.runStarted(); sync.track(ev); });
    store.onAction(name => sync.track({ type: 'act', name }));
    onPlatformAuthChange(() => sync.reconnect());
    sync.start();
    if (typeof window !== 'undefined') window.__cloudSync = sync;   // tests look at it
}

boot().catch((e) => {
    console.error('[boot]', e);
    bootMessage('SOMETHING WENT WRONG. RELOAD TO TRY AGAIN.');
});
