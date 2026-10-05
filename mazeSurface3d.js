import * as THREE from 'three';

// PROCEDURAL SURFACES -- rock, basalt and lava cracks drawn by the shader
// rather than by texture files.
//
// Why procedural: a texture has to ship in the CrazyGames bundle, cost
// download and GPU memory on a phone, and tile visibly across a 9x14 board.
// Noise evaluated on the surface's own position has none of those problems,
// never repeats, and lines up across every wall corner because adjacent walls
// sample the same field.
//
// The pattern is evaluated in the mesh's LOCAL space, not world space. The
// board leans on screen as the player tilts (mazeGame.js), and a world-space
// pattern would swim across the rock with every lean. Level meshes are built
// with their geometry already in level space (the floor's rotation is baked
// in), so local space IS level space; a gate's pattern rides along with it.
//
// Only shading changes here. Shape -- rounded crests, jagged tops -- is real
// geometry from mazeWalls3d.js, so shadows and silhouettes agree with it.

export const FLOOR_PATTERNS = ['plain', 'rock', 'lavaCracks'];
export const WALL_PATTERNS = ['plain', 'rock', 'emberRock', 'molten'];

// One clock for every glowing surface, so all the lava pulses together. Only
// ever advanced by tickSurfaces(); a level that is not rendering does not pulse.
const SHARED_TIME = { value: 0 };
export function tickSurfaces(seconds) { SHARED_TIME.value = seconds; }

const NOISE_GLSL = /* glsl */`
varying vec3 vMrPos;
uniform float mrTime;
uniform vec3 mrColor2;
uniform vec3 mrGlowColor;
uniform float mrGlow;
uniform float mrScale;
uniform float mrBump;
uniform float mrGritAmt;

float mrHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float mrNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(mrHash(i), mrHash(i + vec3(1,0,0)), f.x),
                   mix(mrHash(i + vec3(0,1,0)), mrHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(mrHash(i + vec3(0,0,1)), mrHash(i + vec3(1,0,1)), f.x),
                   mix(mrHash(i + vec3(0,1,1)), mrHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Four octaves, roughly [0, 1].
float mrFbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * mrNoise(p);
        p = p * 2.03 + vec3(1.7, 9.2, 3.1);
        a *= 0.5;
    }
    return v / 0.9375;
}
vec2 mrHash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}
// Distance to the nearest edge between Voronoi cells (F2 - F1): zero on a
// crack, growing toward a plate's middle. 3x3 search -- a phone fragment
// budget, not a film one; the domain warp hides the approximation.
float mrCrack(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 r = g + mrHash2(i + g) - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    return sqrt(d2) - sqrt(d1);
}
// Fine grain for close-up rock: a gritty high octave plus scattered gas
// pockets (vesicles, the pits real basalt is full of). Returns x = height
// detail, y = how much to darken (pits are dark). Faded out by screen-space
// footprint: at the full-board distance this detail is finer than a pixel and
// would only shimmer as the board leans, so it is drawn only where it reads.
vec2 mrGrit(vec3 p) {
    float fade = (1.0 - smoothstep(0.035, 0.09, length(fwidth(p)))) * mrGritAmt;
    if (fade <= 0.0) return vec2(0.0);
    float g = mrFbm(p * 26.0);
    float pit = smoothstep(0.66, 0.78, mrNoise(p * 38.0 + 7.1));
    return vec2((g - 0.5) * 0.5 - pit * 0.6, pit * 0.55) * fade;
}
`;

// Each pattern sets three things from the surface position:
//   mrTone  0..1 mix from the theme's main colour to its second colour
//   mrH     a height field, turned into lighting detail by a bump
//   mrHot   0..1 how much this point glows
const PATTERN_GLSL = {
    rock: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 2.2);
        vec2 mrG = mrGrit(mrP);
        float mrTone = clamp(smoothstep(0.25, 0.8, mrN) + mrG.y, 0.0, 1.0);
        float mrH = mrN + 0.35 * mrFbm(mrP * 7.0) + mrG.x;
        float mrHot = 0.0;
    `,
    // Dark basalt plates split by glowing seams. The plates are lighter at the
    // middle and the seams are sunk in the height field, so the lighting reads
    // the cracks as gaps even before the glow lands.
    lavaCracks: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 2.0);
        vec2 mrQ = mrP.xz * 1.05 + (vec2(mrN, mrFbm(mrP * 2.0 + 4.3)) - 0.5) * 1.1;
        float mrE = mrCrack(mrQ);
        float mrSeam = 1.0 - smoothstep(0.0, 0.06, mrE);
        float mrTone = clamp(smoothstep(0.0, 0.5, mrE) * 0.7 + mrN * 0.5, 0.0, 1.0);
        float mrH = smoothstep(0.0, 0.25, mrE) * 0.6 + mrFbm(mrP * 8.0) * 0.4;
        float mrHot = mrSeam * (0.65 + 0.35 * mrN);
    `,
    // The same seams wrapped round a SPHERE (planet3d.js, the home screen).
    // The floor version reads the ground plane (x, z) only, which on a sphere
    // streaks into stripes at the equator; this projects the cracks from all
    // three axes and blends by which way the surface faces.
    lavaPlanet: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 2.0);
        vec2 mrWarp = (vec2(mrN, mrFbm(mrP * 2.0 + 4.3)) - 0.5) * 1.1;
        vec3 mrW = pow(abs(normalize(vMrPos)), vec3(4.0));
        mrW /= dot(mrW, vec3(1.0));
        float mrE = mrW.x * mrCrack(mrP.yz * 1.05 + mrWarp) + mrW.y * mrCrack(mrP.xz * 1.05 + mrWarp) + mrW.z * mrCrack(mrP.xy * 1.05 + mrWarp);
        float mrSeam = 1.0 - smoothstep(0.0, 0.06, mrE);
        float mrTone = clamp(smoothstep(0.0, 0.5, mrE) * 0.7 + mrN * 0.5, 0.0, 1.0);
        float mrH = smoothstep(0.0, 0.25, mrE) * 0.6 + mrFbm(mrP * 8.0) * 0.4;
        float mrHot = mrSeam * (0.65 + 0.35 * mrN);
    `,
    // Rock whose deepest crevices and foot smoulder. Glow lives low on the wall
    // and in the noise troughs only, so the crest the eye reads as the wall's
    // edge stays dark and crisp against the floor.
    emberRock: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 2.2);
        vec2 mrG = mrGrit(mrP);
        float mrTone = clamp(smoothstep(0.25, 0.8, mrN) + mrG.y, 0.0, 1.0);
        float mrH = mrN + 0.35 * mrFbm(mrP * 7.0) + mrG.x;
        float mrFoot = 1.0 - smoothstep(0.0, 0.22, vMrPos.y);
        float mrHot = smoothstep(0.42, 0.18, mrN) * (0.35 + 0.65 * mrFoot);
    `,
    // Rock still molten: glowing everywhere except where a thin dark crust has
    // floated on top. The inverse of lavaCracks, and in 3D rather than on the
    // ground plane, so it wraps an upright surface without streaking. Made for
    // gates: a wall that is about to move should look like it is not set yet.
    molten: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 2.6 + vec3(0.0, mrTime * 0.05, 0.0));
        float mrCrust = smoothstep(0.6, 0.7, mrFbm(mrP * 4.5));
        vec2 mrG = mrGrit(mrP);
        float mrTone = mrCrust;
        float mrH = mrCrust * 0.8 + mrN * 0.3 + mrG.x * mrCrust;
        float mrHot = (1.0 - mrCrust) * (0.6 + 0.4 * mrN);
    `
};

// Add a procedural pattern to a MeshStandardMaterial. `opts`:
//   pattern     one of the keys above ('plain' leaves the material untouched)
//   color2      the second rock colour mrTone mixes toward
//   glowColor   emissive colour of the hot parts
//   glow        glow strength (0 = no glow at all)
//   scale       pattern features per world unit (bigger = finer rock)
//   bump        strength of the lighting detail
export function applySurface(mat, opts) {
    const body = PATTERN_GLSL[opts && opts.pattern];
    if (!body) return mat;
    const uniforms = {
        mrTime: SHARED_TIME,
        mrColor2: { value: new THREE.Color(opts.color2) },
        mrGlowColor: { value: new THREE.Color(opts.glowColor) },
        mrGlow: { value: Number.isFinite(opts.glow) ? opts.glow : 0 },
        mrScale: { value: Number.isFinite(opts.scale) ? opts.scale : 1 },
        mrBump: { value: Number.isFinite(opts.bump) ? opts.bump : 1 },
        // Fine grit (mrGrit) on or off: on for level walls seen up close, off
        // for the home planet, where it is finer than a pixel and only speckles.
        mrGritAmt: { value: Number.isFinite(opts.grit) ? opts.grit : 1 }
    };
    mat.userData.surfaceUniforms = uniforms;
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vMrPos;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMrPos = position;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
            .replace('#include <color_fragment>', `#include <color_fragment>
                ${body}
                diffuseColor.rgb = mix(diffuseColor.rgb, mrColor2, mrTone);
                // A hot seam is not lit rock: darken it so the glow, not the
                // diffuse, is what colours it.
                diffuseColor.rgb *= 1.0 - 0.85 * mrHot * step(0.001, mrGlow);`)
            // Bump from the height field by screen-space derivatives -- three's
            // own perturbNormalArb, inlined because it only exists when a bump
            // MAP is bound, and this bump has no map.
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                {
                    vec2 mrD = vec2(dFdx(mrH), dFdy(mrH)) * mrBump * 0.02;
                    vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
                    vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
                    float det = dot(sx, r1) * faceDirection;
                    vec3 grad = sign(det) * (mrD.x * r1 + mrD.y * r2);
                    normal = normalize(abs(det) * normal - grad);
                }`)
            // A slow, uneven pulse: each patch of lava breathes on its own phase
            // so the floor shimmers rather than blinking as one.
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                float mrPulse = 0.82 + 0.18 * sin(mrTime * 1.7 + mrN * 12.0);
                totalEmissiveRadiance += mrGlowColor * (mrGlow * mrHot * mrPulse);`);
    };
    mat.customProgramCacheKey = () => 'mr-surface-' + opts.pattern;
    return mat;
}
