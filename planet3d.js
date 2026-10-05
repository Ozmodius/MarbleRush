import * as THREE from 'three';
import { makeFloorMaterial, makeBallMaterial } from './mazeTheme3d.js';
import { applySurface } from './mazeSurface3d.js';

// THE HOME SCREEN'S PLANET: the current world as a big marble, turning slowly
// in space, with the player's chosen marble orbiting it as a moon.
//
// The planet wears the world's own floor surface (mazeTheme3d.js), so Magma
// Works is basalt split by glowing lava seams and the Workshop is warm wood-
// coloured rock -- the same materials the levels use, seen from orbit. A
// theme whose floor is plain colour gets the 'rock' pattern here, because a
// flat-coloured sphere reads as a ball, not a world.
//
// Patterns are drawn in the mesh's LOCAL space (mazeSurface3d.js), so the
// surface turns with the planet instead of swimming over it.

const PLANET_R = 3;
const MOON_ORBIT = 4.7;

// Seeded so the stars sit in the same places every visit.
export function starfield(count, seed) {
    let s = seed >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        // On a big shell behind the planet, so none sit between it and the camera.
        const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = 40 + rnd() * 20;
        const k = Math.sqrt(1 - u * u);
        pos.set([Math.cos(a) * k * r, u * r, Math.sin(a) * k * r - 10], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
}

// A world's surface for a sphere of radius `r`: its own floor material, with
// plain floors given rock so the sphere has terrain, lava seams projected
// from three axes (lavaPlanet), and the pattern scaled to the sphere so every
// planet, big or small, shows about the same number of continents. Shared
// with the solar system (solarSystem3d.js).
const PLANET_PATTERN = { plain: 'rock', rock: 'rock', lavaCracks: 'lavaPlanet', woodToDirt: 'rock' };
export function makePlanetMaterial(theme, r) {
    const surfaceTheme = { ...theme, floorPattern: PLANET_PATTERN[theme.floorPattern] || 'rock', floorTextures: null };
    const mat = makeFloorMaterial(surfaceTheme, 10);
    const su = mat.userData.surfaceUniforms;
    if (su) { su.mrScale.value = (theme.patternScale || 1) * 0.55 * (PLANET_R / r); su.mrGritAmt.value = 0; }
    return mat;
}

// The glow colour round a world: its lava glow if it has one, else a pale
// tint of its floor.
export function planetGlow(theme) {
    return (theme.floorGlow > 0 || theme.wallGlow > 0)
        ? theme.glowColor
        : '#' + new THREE.Color(theme.floorColor).lerp(new THREE.Color('#ffffff'), 0.45).getHexString();
}

// A thin halo just outside the planet: brightest at the rim, nothing face-on.
export function atmosphere(color) {
    return new THREE.ShaderMaterial({
        uniforms: { glow: { value: new THREE.Color(color) } },
        vertexShader: `varying vec3 vN; varying vec3 vV;
            void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 glow; varying vec3 vN; varying vec3 vV;
            void main() { float rim = pow(1.0 - abs(dot(vN, vV)), 3.0);
                gl_FragColor = vec4(glow, rim * 0.85); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide
    });
}

// Build the planet for `theme` (a resolved theme) with the marble `look`
// (shopCatalog.js; null = Classic, wearing the theme's marble colour).
// Everything allocated is pushed onto `tracked` for disposal.
export function buildPlanet(theme, look, tracked = []) {
    const group = new THREE.Group();

    const planetMat = makePlanetMaterial(theme, PLANET_R);
    const planetGeo = new THREE.SphereGeometry(PLANET_R, 128, 96);
    const planet = new THREE.Mesh(planetGeo, planetMat);
    const spinner = new THREE.Group();  // an axial tilt; the planet spins inside it
    spinner.rotation.z = 0.35;
    spinner.add(planet);
    group.add(spinner);

    // Atmosphere: the world's glow if it has one (lava), else a pale tint of
    // its floor, so even the Workshop has a soft edge against space.
    const glowColor = planetGlow(theme);
    const atmoGeo = new THREE.SphereGeometry(PLANET_R * 1.08, 64, 48);
    const atmoMat = atmosphere(glowColor);
    group.add(new THREE.Mesh(atmoGeo, atmoMat));


    // The moon: the marble the player will roll next.
    const moonGeo = new THREE.SphereGeometry(0.5, 48, 32);
    const moonMat = makeBallMaterial(theme, look);
    const moon = new THREE.Mesh(moonGeo, moonMat);
    const orbit = new THREE.Group();
    orbit.rotation.set(0.28, 0, 0.12);
    orbit.add(moon);
    group.add(orbit);

    const starGeo = starfield(500, 1337);
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.8 });
    group.add(new THREE.Points(starGeo, starMat));

    tracked.push(planetGeo, planetMat, atmoGeo, atmoMat, moonGeo, moonMat, starGeo, starMat);

    return {
        group,
        radius: MOON_ORBIT + 0.6,
        tick(seconds) {
            planet.rotation.y = seconds * 0.12;
            const a = seconds * 0.35;
            moon.position.set(Math.cos(a) * MOON_ORBIT, 0, Math.sin(a) * MOON_ORBIT);
            moon.rotation.y = seconds * 1.4;
        }
    };
}
