import { COMFORT } from './shopCatalog.js';

// THE COMFORT CARD for walking (the Labyrinth): field of view, look speed,
// invert look, head bob, and the vignette that darkens the edges while moving.
// First person upsets some players' stomachs; these are the usual remedies.
// Every change is saved at once (progressStore.js setComfort, which keeps each
// value in range) and applied live through onChange.
//
// openComfort(store, onChange) shows it; it closes on its own button.

const $ = id => document.getElementById(id);
let wired = false;

function render(store) {
    const c = store.get().comfort;
    $('comfortFov').value = String(c.fov);
    $('comfortFovVal').textContent = c.fov + '°';
    $('comfortSens').value = String(c.sens);
    $('comfortSensVal').textContent = c.sens.toFixed(1) + '×';
    $('comfortInvert').checked = c.invertY;
    $('comfortBob').checked = c.bob;
    $('comfortVignette').checked = c.vignette;
}

export function openComfort(store, onChange) {
    if (!wired) {
        wired = true;
        const set = (patch) => { store.setComfort(patch); render(store); onChange && onChange(store.get().comfort); };
        const fov = $('comfortFov'), sens = $('comfortSens');
        fov.min = COMFORT.fov.min; fov.max = COMFORT.fov.max;
        sens.min = COMFORT.sens.min; sens.max = COMFORT.sens.max;
        fov.addEventListener('input', () => set({ fov: Number(fov.value) }));
        sens.addEventListener('input', () => set({ sens: Number(sens.value) }));
        $('comfortInvert').addEventListener('change', (e) => set({ invertY: e.target.checked }));
        $('comfortBob').addEventListener('change', (e) => set({ bob: e.target.checked }));
        $('comfortVignette').addEventListener('change', (e) => set({ vignette: e.target.checked }));
        $('comfortCloseBtn').addEventListener('click', (e) => { e.preventDefault(); $('comfortPanel').hidden = true; });
        $('comfortPanel').addEventListener('click', (e) => { if (e.target.id === 'comfortPanel') $('comfortPanel').hidden = true; });
    }
    render(store);
    $('comfortPanel').hidden = false;
}

export function closeComfort() { const p = $('comfortPanel'); if (p) p.hidden = true; }
