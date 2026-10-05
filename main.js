// BOOT -- the one entry point. Brings up the platform, the renderer and the save,
// then shows the home screen. PLAY opens the level select (mazeGame.js).
import { initPlatform, loadingStart, loadingStop } from './platform.js';
import { initSceneHost } from './sceneHost.js';
import { loadProgress, getProgress } from './progressStore.js';
import { bindTap } from './inputTap.js';
import { enterMaze, initMazeControls } from './mazeGame.js';

function el(id) { return document.getElementById(id); }

// A short message over the game, for failures the player should know about.
// Never a browser dialog: alert()/confirm() throw a CrazyGames player out of
// fullscreen.
window.showCrashToast = (text) => {
    const t = el('toast');
    if (!t) return;
    t.textContent = text;
    t.style.display = '';
    clearTimeout(window.showCrashToast._timer);
    window.showCrashToast._timer = setTimeout(() => { t.style.display = 'none'; }, 4000);
};

function renderHome() {
    const coins = el('homeCoins');
    if (coins) coins.textContent = Number(getProgress().coins || 0).toLocaleString('en-US') + ' COINS';
}

async function boot() {
    loadingStart();
    await initPlatform();
    if (!initSceneHost(el('gameCanvas'))) {
        window.showCrashToast('This browser cannot run 3D graphics.');
        loadingStop();
        return;
    }
    await loadProgress();
    initMazeControls();

    const stamp = el('buildStamp');
    if (stamp) stamp.textContent = window.__BUILD_VERSION__ || 'dev';

    bindTap('playBtn', async () => {
        const ok = await enterMaze();
        if (!ok) window.showCrashToast('Could not load the levels. Check your connection and try again.');
    });
    // The home screen is shown again by mazeGame.js's exitMaze; refresh the
    // coin count whenever it reappears.
    new MutationObserver(renderHome).observe(el('home'), { attributes: true, attributeFilter: ['style'] });

    renderHome();
    el('home').style.display = '';
    loadingStop();
    window.__marbleRushReady = true;
}

boot().catch((e) => {
    console.error('[boot] failed:', e);
    window.showCrashToast('Something went wrong starting the game.');
});
