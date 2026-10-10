import * as THREE from 'three';
import { makeFloorMaterial, makeBallMaterial } from './mazeTheme3d.js';
import { applySurface } from './mazeSurface3d.js';
import { applySkin } from './skins3d.js';
import { buildShip } from './ship3d.js';
import { siteAngles, sitePoint, trailArc } from './homeSites.js';

// THE HOME SCREEN'S PLANET: the current world as a big marble in space, with
// Rolle's ship (ship3d.js) circling it -- the player's chosen marble riding
// in its dome -- and the system's sun burning in the distance behind it.
//
// Its face carries the world's ten levels as landing sites on a trail
// (homeSites.js), floor 10 at the summit; menus.js puts a button on each.
// So the sites stay where the buttons are, the ground holds still (a slow
// sway) while the clouds drift over it.
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
const MOON_ORBIT = 4.7;          // the ship's orbit
const SITE_LIFT = 0.1;           // sites and trail sit just over the clouds
const SHIP_SCALE = 0.62;

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
const PLANET_PATTERN = { plain: 'rock', rock: 'rock', lavaCracks: 'lavaPlanet', woodToDirt: 'forestPlanet', snow: 'icePlanet', foamMat: 'beachBall', treadPlate: 'steelPlanet' };
// Weather by planet surface: cloud colour and how much sky it covers (0..1).
const CLOUDS = {
    forestPlanet: { color: '#ffffff', cover: 0.42 },
    icePlanet: { color: '#f4f8ff', cover: 0.34 },
    lavaPlanet: { color: '#2a2220', cover: 0.3 }
};
export function makePlanetMaterial(theme, r) {
    const surfaceTheme = { ...theme, floorPattern: PLANET_PATTERN[theme.floorPattern] || 'rock', floorTextures: null };
    const mat = makeFloorMaterial(surfaceTheme, 10);
    // A shiny metal floor makes a planet a mirror ball with one blown
    // highlight; a world seen from orbit is mostly matte.
    mat.metalness = Math.min(mat.metalness, 0.3);
    mat.roughness = Math.max(mat.roughness, 0.55);
    const su = mat.userData.surfaceUniforms;
    if (su) { su.mrScale.value = (theme.patternScale || 1) * 0.55 * (PLANET_R / r); su.mrGritAmt.value = 0; }
    return mat;
}

// The glow colour round a world: its lava glow if it has one, else a pale
// tint of its floor.
// Worlds with skies get a sky-coloured edge, whatever their floor colour.
const SKY_GLOW = { woodToDirt: '#8fcaff', snow: '#cfe8ff' };
export function planetGlow(theme) {
    if (SKY_GLOW[theme.floorPattern]) return SKY_GLOW[theme.floorPattern];
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
export function buildPlanet(theme, look, tracked = [], skin = 'plain', { sites: siteCount = 10 } = {}) {
    const group = new THREE.Group();
    // The planet and its moon ride in their own group, so a swipe to the
    // next world can slide them in while the sun and the stars stay put.
    const world = new THREE.Group();
    group.add(world);

    const planetMat = makePlanetMaterial(theme, PLANET_R);
    const planetGeo = new THREE.SphereGeometry(PLANET_R, 128, 96);
    const planet = new THREE.Mesh(planetGeo, planetMat);
    const spinner = new THREE.Group();  // an axial tilt; the planet spins inside it
    spinner.rotation.z = 0.35;
    spinner.add(planet);
    world.add(spinner);

    // Atmosphere: the world's glow if it has one (lava), else a pale tint of
    // its floor, so even the Workshop has a soft edge against space.
    const glowColor = planetGlow(theme);
    const atmoGeo = new THREE.SphereGeometry(PLANET_R * 1.08, 64, 48);
    const atmoMat = atmosphere(glowColor);
    world.add(new THREE.Mesh(atmoGeo, atmoMat));


    // CLOUDS over the worlds that have weather: a thin shell drifting a
    // little faster than the ground turns. White over forest and ice, dark
    // smoke over lava; none on the toy and steel worlds.
    const cloud = CLOUDS[PLANET_PATTERN[theme.floorPattern]];
    let clouds = null;
    if (cloud) {
        const cloudGeo = new THREE.SphereGeometry(PLANET_R * 1.025, 96, 64);
        const cloudMat = applySurface(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false }),
            { pattern: 'clouds', color2: new THREE.Color(cloud.color), blend: cloud.cover, bump: 0.6, grit: 0 });
        clouds = new THREE.Mesh(cloudGeo, cloudMat);
        spinner.add(clouds);
        tracked.push(cloudGeo, cloudMat);
    }

    // Rolle's ship on its orbit, the marble the player will roll next in the
    // dome (scaled so the marble is the size it always was beside the planet).
    const shipTracked = [];
    const ship = buildShip(shipTracked);
    tracked.push(...shipTracked);
    const moonGeo = new THREE.SphereGeometry(0.3, 40, 28);
    const moonMat = applySkin(makeBallMaterial(theme, look), skin);
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.position.y = 0.3;
    ship.group.add(moon);
    ship.setPose({ x: 0, y: 0, z: 0, visible: true });
    ship.setBeam(0);
    const shipHolder = new THREE.Group();
    shipHolder.scale.setScalar(SHIP_SCALE * 1.25);
    shipHolder.add(ship.group);
    const orbit = new THREE.Group();
    orbit.rotation.set(0.28, 0, 0.12);
    orbit.add(shipHolder);
    world.add(orbit);

    // THE LANDING SITES: a pad at each level's place, a dashed trail joining
    // them, and a beacon over the one PLAY lands on (select).
    const angles = siteAngles(siteCount);
    const sitesGroup = new THREE.Group();
    world.add(sitesGroup);
    const sitePos = angles.map(a => { const q = sitePoint(a, PLANET_R, SITE_LIFT); return new THREE.Vector3(q.x, q.y, q.z); });
    const trailPts = [];
    for (let i = 1; i < angles.length; i++) {
        const arc = trailArc(angles[i - 1], angles[i], PLANET_R, SITE_LIFT, 14);
        for (const q of (i === 1 ? arc : arc.slice(1))) trailPts.push(new THREE.Vector3(q.x, q.y, q.z));
    }
    // The trail as beads (a WebGL line is one pixel wide): every other arc
    // point, skipping the ones under a site's button.
    const beads = trailPts.filter((p, k) => k % 2 === 1 && sitePos.every(q => q.distanceTo(p) > 0.3));
    const trailGeo = new THREE.SphereGeometry(0.045, 8, 6);
    const trailMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.85 });
    const trail = new THREE.InstancedMesh(trailGeo, trailMat, Math.max(1, beads.length));
    const _m4 = new THREE.Matrix4();
    beads.forEach((p, k) => trail.setMatrixAt(k, _m4.makeTranslation(p.x, p.y, p.z)));
    trail.count = beads.length;
    trail.instanceMatrix.needsUpdate = true;
    sitesGroup.add(trail);
    const padGeo = new THREE.CircleGeometry(0.17, 24);
    const padMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.55, depthWrite: false });
    const _n = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
    for (const p of sitePos) {
        const pad = new THREE.Mesh(padGeo, padMat);
        pad.position.copy(p);
        pad.quaternion.setFromUnitVectors(_z, _n.copy(p).normalize());
        sitesGroup.add(pad);
    }
    // The beacon: a ring of light round the chosen site, pulsing outward.
    const beaconGeo = new THREE.RingGeometry(0.22, 0.3, 32);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffd66e, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.visible = false;
    sitesGroup.add(beacon);
    tracked.push(trailGeo, trailMat, padGeo, padMat, beaconGeo, beaconMat);
    let chosen = -1;

    const starGeo = starfield(500, 1337);
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.8 });
    group.add(new THREE.Points(starGeo, starMat));

    tracked.push(planetGeo, planetMat, atmoGeo, atmoMat, moonGeo, moonMat, starGeo, starMat);

    const sun = buildDistantSun(tracked);
    group.add(sun.group);

    return {
        group,
        world,
        sun: sun.group,
        radius: MOON_ORBIT + 0.6,
        ship,
        // The sites, in the world group's frame (it slides on a swipe):
        // world-space points for projecting the buttons onto (sitesWorld).
        siteCount: sitePos.length,
        siteWorld(i, out) { return sitesGroup.localToWorld(out.copy(sitePos[i])); },
        // The site PLAY lands on: the beacon stands over it (-1: none).
        select(i) {
            chosen = Number.isInteger(i) && i >= 0 && i < sitePos.length ? i : -1;
            beacon.visible = chosen >= 0;
            if (chosen >= 0) {
                beacon.position.copy(sitePos[chosen]);
                beacon.quaternion.setFromUnitVectors(_z, _n.copy(sitePos[chosen]).normalize());
            }
        },
        tick(seconds) {
            // The ground holds still under the sites (a slow sway); the
            // clouds drift on.
            planet.rotation.y = 0.9 + Math.sin(seconds * 0.25) * 0.05;
            if (clouds) clouds.rotation.y = seconds * 0.05;
            // The ship's orbit: round the planet, banked into the turn.
            const a = seconds * 0.35;
            shipHolder.position.set(Math.cos(a) * MOON_ORBIT, Math.sin(seconds * 0.9) * 0.08, Math.sin(a) * MOON_ORBIT);
            shipHolder.rotation.set(0, -a, 0.22);
            ship.tick(seconds);
            moon.rotation.y = seconds * 1.4;
            const pulse = (seconds * 0.9) % 1;
            beacon.scale.setScalar(1 + pulse * 1.6);
            beaconMat.opacity = 0.75 * (1 - pulse);
            trailMat.opacity = 0.75 + 0.12 * Math.sin(seconds * 1.3);
            sun.tick(seconds);
        }
    };
}

// THE SUN, far off behind the planet and up to one side: so the home screen
// reads as one world of a solar system (the WORLDS tab's sun, seen from out
// here). A small white-hot disc in two soft glows, a faint shimmer, and a
// warm light from its side that rims the planet's edge.
export const SUN_AT = new THREE.Vector3(3.8, 6.9, -26);
function glowTexture(stops) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, col] of stops) grad.addColorStop(at, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
function buildDistantSun(tracked) {
    const group = new THREE.Group();
    group.position.copy(SUN_AT);
    const coreGeo = new THREE.SphereGeometry(0.7, 32, 24);
    // Not tone-mapped: the renderer's filmic curve would dull it to a pale ball.
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0, toneMapped: false });
    group.add(new THREE.Mesh(coreGeo, coreMat));
    const sprite = (tex, scale, opacity) => {
        const m = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
        const sp = new THREE.Sprite(m);
        sp.scale.setScalar(scale);
        group.add(sp);
        tracked.push(m);
        return sp;
    };
    const innerTex = glowTexture([[0, 'rgba(255,250,230,1)'], [0.18, 'rgba(255,226,150,0.9)'], [0.45, 'rgba(255,170,60,0.35)'], [1, 'rgba(255,140,40,0)']]);
    const outerTex = glowTexture([[0, 'rgba(255,200,120,0.55)'], [0.35, 'rgba(255,150,60,0.18)'], [1, 'rgba(255,120,40,0)']]);
    const inner = sprite(innerTex, 5.2, 1);
    const outer = sprite(outerTex, 17, 0.8);
    // The rim light: from the sun's side, warm, on top of the scene's own.
    const light = new THREE.DirectionalLight(0xffc98a, 1.4);
    light.position.set(0, 0, 0);
    light.target.position.copy(SUN_AT).multiplyScalar(-1);   // toward the planet at the origin
    group.add(light, light.target);
    tracked.push(coreGeo, coreMat, innerTex, outerTex);
    return {
        group,
        tick(t) {
            inner.scale.setScalar(5.2 * (1 + 0.025 * Math.sin(t * 1.7)));
            outer.material.opacity = 0.75 + 0.08 * Math.sin(t * 0.9 + 1);
        }
    };
}
