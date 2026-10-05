import * as THREE from 'three';
import { assetUrl, assetCrossOrigin } from './platform.js';

// pbrTextures.js -- shared loader for admin-uploaded PBR maps (the cosmetics
// editor's texture library). Imported ONLY by the three.js subgraph modules
// (marbleMesh.js, diceBox3d.js, boardMesh.js, cosmeticPreview3d.js), never
// given a <script> tag, so the bare `three` specifier stays off the default
// page's module graph (docs/TRUE_3D_PLAN.md Hard Rule 3).
//
// A cosmetic definition stores, per slot, a servable URL string
// ('/textures/<file>.png') -- NOT the library id -- so every client can load
// it at render time (only admins receive the library index). See
// server.js's texture library + validateCosmeticDefinition.

// The PBR slots and whether each is color data (sRGB) or linear data. Only
// the base color map is sRGB; normal/roughness/metalness/displacement/ao all
// encode data and must stay linear (same rule as the CanvasTexture colorSpace
// note in diceBox3d.js -- a color map wrongly read as linear washes out).
const SLOT_SRGB = { map: true, normalMap: false, roughnessMap: false, metalnessMap: false, displacementMap: false, aoMap: false, alphaMap: false };

const _loader = new THREE.TextureLoader();
// THREE.TextureLoader defaults crossOrigin='anonymous', which forces a CORS
// handshake. Our maps are same-origin (relative /cosmetic-textures URLs), so
// clear it -- no CORS needed, and this avoids a CDN-cached missing-ACAO
// response failing the load (see server.js's /cosmetic-textures note).
_loader.setCrossOrigin('');
// A bundle hosted away from server.js (CrazyGames) loads these from the
// server's origin instead, and a cross-origin image must be fetched WITH CORS
// or WebGL refuses it -- platform.js's assetUrl/assetCrossOrigin decide, and
// on the web they leave the URL and the loader above exactly as they were.
const _corsLoader = new THREE.TextureLoader();
_corsLoader.setCrossOrigin('anonymous');
const _cache = new Map(); // url -> THREE.Texture (dedupe: one GPU texture per URL, reused across materials)

// Load (or reuse) a texture for a URL. Content-addressed URLs never change
// bytes, so caching by URL forever is safe and avoids re-decoding the same
// PNG for every material/preview that references it.
export function loadPbrTexture(url, srgb, repeat = 1) {
    if (!url) return null;
    // Cache by (url, colorSpace, repeat): tiling is a texture-sampling param
    // (wrap + repeat), so a given repeat needs its own THREE.Texture. Keyed in
    // here rather than cloned so repeat/wrap are set BEFORE the async image
    // load (cloning a not-yet-loaded texture wouldn't receive the pixels).
    const r = Math.max(1, Math.floor(repeat) || 1);
    const key = url + (srgb ? '|s' : '|l') + '|r' + r;
    if (_cache.has(key)) return _cache.get(key);
    // onError logs instead of failing silently -- a CORS/404 on a map used to
    // leave the surface unchanged with no clue why (see the /cosmetic-textures
    // CORS note in server.js). TextureLoader itself defaults
    // crossOrigin='anonymous', which is exactly why that CORS header matters.
    const src = assetUrl(url);
    const tex = (assetCrossOrigin(url) ? _corsLoader : _loader).load(src, undefined, undefined, () => console.warn('[pbr] texture failed to load:', src));
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = 4;
    if (r > 1) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(r, r); }
    _cache.set(key, tex);
    return tex;
}

// Given a cosmetic's `textures` object ({ map,normalMap,roughnessMap,
// metalnessMap,alphaMap } of URLs, any subset), assign the matching maps onto
// a material and flag it for a recompile. Returns true if any map was applied
// (so callers can skip a needless material.needsUpdate otherwise).
export function applyPbrMaps(material, textures, repeat = 1) {
    if (!material || !textures) return false;
    let any = false;
    for (const slot of Object.keys(SLOT_SRGB)) {
        const url = textures[slot];
        if (!url) continue;
        material[slot] = loadPbrTexture(url, SLOT_SRGB[slot], repeat);
        any = true;
    }
    // alphaMap punches per-pixel transparency into the surface -- THREE only
    // honors it once the material is flagged transparent, otherwise the alpha
    // channel is silently ignored and the surface stays fully opaque.
    if (textures.alphaMap) material.transparent = true;
    if (any) material.needsUpdate = true;
    return any;
}
