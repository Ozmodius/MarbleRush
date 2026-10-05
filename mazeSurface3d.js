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

export const FLOOR_PATTERNS = ['plain', 'rock', 'lavaCracks', 'woodToDirt'];
export const WALL_PATTERNS = ['plain', 'rock', 'emberRock', 'molten', 'planks', 'bark', 'leaves'];

// A 1x1 stand-in for patterns given no path mask (see woodToDirt).
const NO_MASK = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
NO_MASK.needsUpdate = true;

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
uniform float mrBlend;
uniform sampler2D mrMask;
uniform vec2 mrBoard;

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
    // WORKSHOP WALLS: horizontal planks, each its own tone, with grain and a
    // dark seam between rows. Owns its palette (writes diffuseColor itself).
    planks: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 1.5);
        float mrRowF = mrP.y * 9.0;
        float mrRow = floor(mrRowF);
        float mrRh = fract(sin(mrRow * 91.7 + 3.1) * 4375.5);
        float mrAlong = mrP.x + mrP.z;
        float mrGrain = mrFbm(vec3(mrAlong * 1.2 + mrRh * 7.0, mrRowF * 4.0, mrRh * 3.0));
        float mrRings = sin((mrGrain * 6.0 + mrAlong * 2.0) * 3.14159) * 0.5 + 0.5;
        float mrSeam = 1.0 - smoothstep(0.0, 0.07, min(fract(mrRowF), 1.0 - fract(mrRowF)));
        vec3 mrWood = mix(vec3(0.50, 0.33, 0.18), vec3(0.70, 0.50, 0.29), mrRings * 0.55 + mrRh * 0.45);
        // The material's colour tints the wood, so a gate (gateColor) is still
        // plainly a different, painted plank.
        vec3 mrTint = diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 0.001));
        diffuseColor.rgb = mrWood * mix(vec3(1.0), mrTint, 0.55) * mix(1.0, 0.42, mrSeam);
        float mrTone = 0.0;
        float mrH = mrRings * 0.3 - mrSeam * 0.9 + mrGrain * 0.2;
        float mrHot = 0.0;
    `,
    // TREE BARK: deep vertical ridges, moss creeping up from the roots.
    bark: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 3.0);
        float mrRidge = mrFbm(vec3(mrP.x * 15.0, mrP.y * 1.7, mrP.z * 15.0));
        float mrGroove = smoothstep(0.42, 0.62, mrRidge);
        float mrMoss = smoothstep(0.38, 0.0, vMrPos.y) * smoothstep(0.35, 0.65, mrFbm(mrP * 4.0 + 3.0));
        vec3 mrBark = mix(vec3(0.17, 0.12, 0.09), vec3(0.37, 0.28, 0.20), mrGroove);
        mrBark = mix(mrBark, vec3(0.24, 0.38, 0.14), mrMoss * 0.85);
        // Moss on whatever faces up -- the crowns of the trunks, which is most
        // of what the near-overhead camera sees of a tree wall.
        vec3 mrUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float mrTop = smoothstep(0.45, 0.85, dot(normalize(vNormal), mrUpV));
        vec3 mrCrown = mix(vec3(0.16, 0.26, 0.09), vec3(0.30, 0.40, 0.15), mrFbm(mrP * 9.0));
        mrBark = mix(mrBark, mrCrown, mrTop * 0.8);
        diffuseColor.rgb = mrBark * (0.85 + 0.3 * mrN);
        float mrTone = 0.0;
        float mrH = mrGroove * (1.0 - mrTop) + mrN * 0.3;
        float mrHot = 0.0;
    `,
    // LEAVES: clumped greens with ragged gaps cut right through, so a canopy
    // reads as foliage with light between the leaves, not a green ball.
    leaves: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 5.0);
        float mrClump = mrFbm(mrP * 12.0 + 2.0);
        if (mrClump < 0.42) discard;
        vec3 mrLeaf = mix(vec3(0.13, 0.27, 0.08), vec3(0.42, 0.63, 0.21), smoothstep(0.3, 0.8, mrN));
        diffuseColor.rgb = mrLeaf * (0.8 + 0.4 * mrClump);
        float mrTone = 0.0;
        float mrH = mrClump;
        float mrHot = 0.0;
    `,
    // WORLD 1's FLOOR: workshop boards giving way to a forest dirt path.
    // mrBlend (0..1) is how far along the world the level is: dirt breaks
    // through the boards in patches that grow until, at 1, there are no boards
    // left. mrMask is a path mask over the board (forest3d.js: 0 at a wall's
    // foot, 1 a corridor's width away), so moss and grass grow along the walls
    // and the middle of each corridor is packed, darker dirt -- the path.
    woodToDirt: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 1.2);
        float mrBz = mrP.z * 2.6;
        float mrBoardN = floor(mrBz);
        float mrBh = fract(sin(mrBoardN * 127.1) * 43758.5);
        float mrSeamB = 1.0 - smoothstep(0.0, 0.05, min(fract(mrBz), 1.0 - fract(mrBz)));
        float mrG = mrFbm(vec3(mrP.x * 0.9 + mrBh * 9.0, mrBz * 6.0, mrBh));
        float mrRing = sin((mrG * 7.0 + mrP.x * 0.8) * 3.14159) * 0.5 + 0.5;
        vec3 mrWoodC = mix(vec3(0.62, 0.45, 0.28), vec3(0.80, 0.62, 0.40), mrRing * 0.5 + mrBh * 0.5) * (1.0 - 0.55 * mrSeamB);
        float mrWoodH = mrRing * 0.25 - mrSeamB;

        float mrMaskV = texture(mrMask, vMrPos.xz / mrBoard + 0.5).r;
        float mrEdge = 1.0 - smoothstep(0.0, 0.5, mrMaskV);
        float mrDirtN = mrFbm(mrP * 3.0);
        vec3 mrDirtC = mix(vec3(0.27, 0.18, 0.11), vec3(0.46, 0.33, 0.21), mrDirtN);
        mrDirtC *= mix(0.78, 1.0, 1.0 - smoothstep(0.55, 1.0, mrMaskV));
        vec2 mrPc = mrP.xz * 7.0;
        vec2 mrPi = floor(mrPc);
        vec2 mrO = mrHash2(mrPi);
        float mrPd = length(fract(mrPc) - (mrO * 0.6 + 0.2));
        float mrStone = step(0.88, fract(mrO.x * 13.1)) * (1.0 - smoothstep(0.13, 0.2, mrPd));
        vec3 mrStoneC = vec3(0.36, 0.34, 0.30) * (0.75 + 0.4 * mrO.y);
        float mrGrassN = mrFbm(mrP * 9.0);
        vec3 mrGrassC = mix(vec3(0.12, 0.20, 0.07), vec3(0.25, 0.36, 0.12), mrGrassN);
        float mrGrass = mrEdge * smoothstep(0.25, 0.6, mrFbm(mrP * 2.5 + 7.0) + 0.25);
        // Depth: dry-mud cracks and clods in the dirt, sunk in the height
        // field so the light finds them.
        float mrCr = mrCrack(mrP.xz * 3.4 + mrDirtN * 1.5);
        // Faded out where a crack would be finer than a pixel (the full-board
        // camera), where it only speckles.
        float mrCrkFade = 1.0 - smoothstep(0.012, 0.03, length(fwidth(mrP.xz)));
        float mrCrk = (1.0 - smoothstep(0.0, 0.045, mrCr)) * (1.0 - mrGrass) * mrCrkFade;
        float mrClod = mrFbm(mrP * 14.0);
        mrDirtC *= (0.78 + 0.44 * mrClod) * (1.0 - 0.5 * mrCrk);
        vec3 mrGround = mix(mix(mrDirtC, mrStoneC, mrStone), mrGrassC, mrGrass);
        float mrGroundH = mrFbm(mrP * 6.0) * 0.6 + mrClod * 0.5 - mrCrk * 0.9 + mrStone * (0.9 - mrPd * 3.0) + mrGrass * mrGrassN * 0.6;

        float mrDirt = smoothstep(-0.05, 0.05, mrBlend * 1.3 - 0.12 - mrFbm(mrP * 0.45) * 0.95);
        diffuseColor.rgb = mix(mrWoodC, mrGround, mrDirt);
        float mrTone = 0.0;
        float mrH = mix(mrWoodH, mrGroundH, mrDirt);
        float mrHot = 0.0;
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
        mrGritAmt: { value: Number.isFinite(opts.grit) ? opts.grit : 1 },
        // woodToDirt: how far toward the forest, the path mask, and the board
        // size the mask spans.
        mrBlend: { value: Number.isFinite(opts.blend) ? opts.blend : 0 },
        mrMask: { value: opts.mask || NO_MASK },
        mrBoard: { value: new THREE.Vector2(opts.board ? opts.board.w : 9, opts.board ? opts.board.d : 14) }
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
