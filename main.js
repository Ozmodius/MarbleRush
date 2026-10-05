import { initPlatform, loadingStart, loadingStop, loadSave, writeSave } from './platform.js';
import { initSceneHost } from './sceneHost.js';
import { createProgressStore } from './progressStore.js';
import { enterMaze, initMazeControls, getLevels, refreshLevelSelect } from './mazeGame.js';
import { initShopUi } from './shopUi.js';

// BOOT. Platform first (CrazyGames wants loadingStart as early as possible and
// the save may live in its SDK), then the renderer, then the save, then the
// game. No server anywhere in this chain (docs/PLAN.md).

function bootMessage(text) {
    const el = document.getElementById('bootMsg');
    if (!el) return;
    if (text) { el.textContent = text; el.style.display = ''; }
    else el.style.display = 'none';
}

async function boot() {
    loadingStart();
    await initPlatform();

    if (!initSceneHost(document.getElementById('gameCanvas'))) {
        loadingStop();
        bootMessage('THIS DEVICE CANNOT RUN 3D (WEBGL IS OFF OR UNSUPPORTED)');
        return;
    }

    const store = createProgressStore({ load: loadSave, save: writeSave });
    await store.load();

    initMazeControls();
    const ok = await enterMaze(store);
    if (ok) initShopUi({ store, levels: getLevels(), onBack: refreshLevelSelect });
    loadingStop();
    bootMessage(ok ? '' : 'COULD NOT LOAD THE LEVELS. RELOAD TO TRY AGAIN.');
}

boot().catch((e) => {
    console.error('[boot]', e);
    bootMessage('SOMETHING WENT WRONG. RELOAD TO TRY AGAIN.');
});
