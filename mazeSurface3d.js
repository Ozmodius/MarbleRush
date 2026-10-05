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

export const FLOOR_PATTERNS = ['plain', 'rock', 'lavaCracks', 'woodToDirt', 'snow', 'foamMat', 'treadPlate'];
export const WALL_PATTERNS = ['plain', 'rock', 'emberRock', 'molten', 'planks', 'bark', 'leaves', 'iceRock', 'steelPanels'];
// Not chosen by themes: the ice HAZARD patches always wear this (mazeTheme3d.js).
export const ICE_PATTERN = 'iceSheet';

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
// WORLD 4's foam mat, tiles one unit square. Every edge between two tiles
// has a jigsaw tab: a disc of radius FOAM_TAB_R centred FOAM_TAB_OFF past the
// edge's middle, belonging to the tile on one side (hashed from the edge, so
// both tiles agree) and poking into the other.
const float FOAM_TAB_R = 0.15;
const float FOAM_TAB_OFF = 0.1;
vec2 mrFoamDir(int e) { return e == 0 ? vec2(1.0, 0.0) : e == 1 ? vec2(-1.0, 0.0) : e == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0); }
// The tab on edge e of the cell: xy its centre, z +1 if cell owns it.
vec3 mrFoamTab(vec2 cell, int e) {
    vec2 dir = mrFoamDir(e), lo = min(cell, cell + dir), ax = abs(dir);
    float lowOwns = step(0.5, fract(sin(dot(lo, vec2(12.9898, 78.233)) + ax.y * 31.7) * 43758.5453));
    bool mine = (lowOwns > 0.5) == (dot(cell - lo, vec2(1.0)) < 0.5);
    vec2 mid = cell + 0.5 + dir * 0.5;
    return vec3(mid + dir * (mine ? FOAM_TAB_OFF : -FOAM_TAB_OFF), mine ? 1.0 : -1.0);
}
// x: owning tile's checker parity; y: distance to the nearest joint.
vec2 mrFoam(vec2 t) {
    vec2 cell = floor(t), f = t - cell;
    vec2 owner = cell;
    float joint = 8.0;
    float half_ = sqrt(FOAM_TAB_R * FOAM_TAB_R - FOAM_TAB_OFF * FOAM_TAB_OFF);
    for (int e = 0; e < 4; e++) {
        vec2 dir = mrFoamDir(e), side = vec2(dir.y, dir.x);
        vec3 tab = mrFoamTab(cell, e);
        vec2 mid = cell + 0.5 + dir * 0.5;
        float d = length(t - tab.xy);
        if (tab.z < 0.0 && d < FOAM_TAB_R) owner = cell + dir;
        // The straight edge, except where a tab crosses it...
        float along = abs(dot(t - mid, side)), across = abs(dot(t - mid, dir));
        joint = min(joint, along > half_ ? across : length(vec2(along - half_, across)));
        // ...and the tab's outline on the side it pokes into.
        float into = dot(t - mid, dir) * (tab.z > 0.0 ? 1.0 : -1.0);
        if (into > 0.0) joint = min(joint, abs(d - FOAM_TAB_R));
    }
    return vec2(mod(owner.x + owner.y, 2.0), joint);
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
    // WORLD 2's FLOOR: packed snow carved into ripples by the wind (sastrugi),
    // blue in the hollows, with a few glints. Uses the theme's two floor
    // colours (white, and the blue of snow in shadow).
    snow: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 1.4);
        float mrRip = sin(dot(mrP.xz, vec2(0.8, 0.6)) * 7.0 + mrFbm(mrP * 0.9) * 7.0) * 0.5 + 0.5;
        float mrDrift = mrFbm(mrP * 0.5);
        float mrTone = clamp((1.0 - mrRip) * 0.45 + (1.0 - mrDrift) * 0.5 - 0.15, 0.0, 1.0);
        float mrH = mrRip * 0.5 + mrN * 0.5 + mrFbm(mrP * 9.0) * 0.25;
        // Glints: rare cells, only up close (sub-pixel ones would just flicker).
        vec2 mrSc = mrP.xz * 22.0;
        vec2 mrSo = mrHash2(floor(mrSc));
        float mrSpark = step(0.93, mrSo.x) * (1.0 - smoothstep(0.05, 0.12, length(fract(mrSc) - mrSo)))
                      * (1.0 - smoothstep(0.02, 0.05, length(fwidth(mrP.xz))));
        diffuseColor.rgb += vec3(0.5, 0.55, 0.6) * mrSpark;
        float mrHot = 0.0;
    `,
    // WORLD 2's WALLS: craggy rock under snow turning, as mrBlend rises, into
    // glacier ice -- blue (the theme colours shift with the blend), glossy
    // (so does the roughness), crossed by pale fracture lines. Whatever faces
    // up is capped with snow, more of it at the treeline than deep in the ice.
    iceRock: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 2.2);
        vec2 mrG = mrGrit(mrP);
        float mrRockness = 1.0 - mrBlend;
        float mrTone = clamp(smoothstep(0.25, 0.8, mrN) + mrG.y * mrRockness, 0.0, 1.0);
        float mrH = mrN + 0.35 * mrFbm(mrP * 7.0) + mrG.x * mrRockness;
        vec3 mrBase = mix(diffuseColor.rgb, mrColor2, mrTone);
        float mrFr = 1.0 - smoothstep(0.0, 0.05, mrCrack(vec2(mrP.x + mrP.z, mrP.y * 1.7) * 3.2 + mrN));
        mrBase += vec3(0.55, 0.75, 0.95) * mrFr * 0.45 * mrBlend;
        vec3 mrUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float mrUp = dot(normalize(vNormal), mrUpV);
        float mrSnowCap = smoothstep(0.35, 0.7, mrUp + (mrFbm(mrP * 5.0) - 0.5) * 0.4) * mix(1.0, 0.55, mrBlend);
        diffuseColor.rgb = mix(mrBase, vec3(0.93, 0.96, 1.0), mrSnowCap);
        mrH = mix(mrH, mrFbm(mrP * 6.0) * 0.4, mrSnowCap);
        mrTone = 0.0;
        float mrHot = 0.0;
    `,
    // THE ICE HAZARD: a glassy sheet in the theme's iceColor, deeper blue in
    // the depths, scored with pale skid lines and a few white cracks, so on
    // any floor it reads at a glance as THE SLIPPERY BIT.
    iceSheet: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 1.8);
        float mrDeep = smoothstep(0.35, 0.75, mrFbm(mrP * 0.9 + 2.0));
        float mrSkid = smoothstep(0.92, 1.0, sin(dot(mrP.xz, vec2(0.97, 0.26)) * 34.0 + mrFbm(mrP * 3.0) * 9.0)) * smoothstep(0.4, 0.7, mrFbm(mrP * 1.3 + 5.0));
        float mrCrk = 1.0 - smoothstep(0.0, 0.035, mrCrack(mrP.xz * 2.4 + mrN));
        vec3 mrIce = diffuseColor.rgb * mix(1.15, 0.6, mrDeep);
        mrIce = mix(mrIce, vec3(0.92, 0.97, 1.0), mrSkid * 0.5 + mrCrk * 0.65);
        diffuseColor.rgb = mrIce;
        float mrTone = 0.0;
        float mrH = mrN * 0.3 - mrCrk * 0.4;
        float mrHot = 0.0;
    `,
    // WORLD 4's FLOOR: interlocking foam play-mat tiles, a checker of the
    // theme's two floor colours. Every edge between two tiles has a jigsaw
    // tab -- a disc over the edge's middle that belongs to the tile on one
    // side, which side hashed from the edge so both tiles agree. Grooves run
    // along every joint, and the foam has a fine pebbled texture up close.
    foamMat: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 1.3);
        vec2 mrT = mrP.xz / 1.1;
        vec2 mrFo = mrFoam(mrT);
        // The groove keeps a line's width on screen: never thinner than
        // about a pixel, so it does not shimmer at the full-board distance.
        float mrPx = length(fwidth(mrT));
        float mrGroove = 1.0 - smoothstep(0.008 + mrPx * 0.5, 0.016 + mrPx * 1.2, mrFo.y);
        float mrTone = mrFo.x;
        float mrFade = 1.0 - smoothstep(0.02, 0.06, length(fwidth(mrP.xz)));
        float mrPeb = mrNoise(mrP * 60.0) * mrFade;
        diffuseColor.rgb *= (1.0 - 0.06 * mrN) * (1.0 - 0.3 * mrGroove);
        float mrH = -mrGroove * 1.2 + mrPeb * 0.18;
        float mrHot = 0.0;
    `,
    // WORLD 5's FLOOR: diamond tread plate -- raised lozenges in a
    // two-way weave on big welded plates -- with rust eating in from noisy
    // patches. The rust (mrColor2) fades as mrBlend rises: a scrap yard at
    // the start of the world, a clean working floor at the end.
    treadPlate: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 1.1);
        vec2 mrQ = mrP.xz / 0.17;
        vec2 mrCellT = floor(mrQ), mrF = fract(mrQ) - 0.5;
        float mrFlip = mod(mrCellT.x + mrCellT.y, 2.0) * 2.0 - 1.0;
        vec2 mrRq = vec2(mrF.x + mrFlip * mrF.y, mrF.y - mrFlip * mrF.x) * 0.7071;
        float mrLz = length(vec2(mrRq.x / 0.36, mrRq.y / 0.075));
        float mrFade = 1.0 - smoothstep(0.008, 0.03, length(fwidth(mrQ)) * 0.17);
        float mrBossy = (1.0 - smoothstep(0.75, 1.0, mrLz)) * mrFade;
        // Weld seams between plates.
        vec2 mrPl = mrP.xz / 1.8;
        float mrSeam = 1.0 - smoothstep(0.0, 0.012, min(min(fract(mrPl.x), 1.0 - fract(mrPl.x)), min(fract(mrPl.y), 1.0 - fract(mrPl.y))));
        float mrRust = smoothstep(0.42, 0.7, mrFbm(mrP * 0.7 + 3.0) + mrN * 0.15) * (1.0 - 0.9 * mrBlend);
        float mrSpeck = smoothstep(0.55, 0.8, mrFbm(mrP * 9.0));
        float mrTone = clamp(mrRust * (0.75 + 0.25 * mrSpeck), 0.0, 1.0);
        diffuseColor.rgb *= (0.9 + 0.2 * mrBossy) * (1.0 - 0.45 * mrSeam) * (0.92 + 0.12 * mrN);
        float mrH = mrBossy * (1.0 - mrTone * 0.6) - mrSeam + mrSpeck * mrTone * 0.4;
        float mrHot = 0.0;
    `,
    // WORLD 5's WALLS: riveted steel panels with seams, rust streaks running
    // down from the top (fading with mrBlend), and yellow-and-black hazard
    // stripes painted on top once the foundry is cleaned up (none on the rust).
    steelPanels: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 2.0);
        float mrAlong = mrP.x + mrP.z;
        float mrPu = mrAlong / 0.62;
        float mrVs = min(fract(mrPu), 1.0 - fract(mrPu)) * 0.62;
        float mrHs = abs(mrP.y - 0.28);
        float mrSeamS = 1.0 - smoothstep(0.0, 0.01, min(mrVs, mrHs));
        // Rivets in a row beside each seam.
        vec2 mrRv = vec2(mrVs - 0.04, mod(mrP.y + 0.045, 0.09) - 0.045);
        float mrRiv = 1.0 - smoothstep(0.011, 0.016, length(mrRv));
        vec2 mrRh = vec2(mod(mrAlong + 0.045, 0.09) - 0.045, mrHs - 0.04);
        mrRiv = max(mrRiv, 1.0 - smoothstep(0.011, 0.016, length(mrRh)));
        float mrStreak = smoothstep(0.5, 0.75, mrFbm(vec3(mrAlong * 9.0, mrP.y * 0.9, 1.0))) * smoothstep(0.0, 0.5, mrP.y);
        vec3 mrUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float mrTop = smoothstep(0.6, 0.9, dot(normalize(vNormal), mrUpV));
        // Streaks run DOWN the faces; on top, rust is patches only.
        float mrRust = clamp(mrStreak * (1.0 - mrTop) + smoothstep(0.55, 0.75, mrFbm(mrP * 3.0)) * 0.6, 0.0, 1.0) * (1.0 - 0.9 * mrBlend);
        float mrTone = mrRust;
        float mrStripe = step(0.5, fract((mrP.x - mrP.z) * 3.2));
        vec3 mrHaz = mix(vec3(0.07), vec3(0.95, 0.72, 0.08), mrStripe);
        diffuseColor.rgb *= (1.0 - 0.5 * mrSeamS) * (1.0 + 0.35 * mrRiv) * (0.9 + 0.15 * mrN);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, mrHaz, 0.85 * smoothstep(0.2, 0.8, mrBlend)), mrTop);
        mrTone *= 1.0 - mrTop * mrBlend;
        float mrH = -mrSeamS + mrRiv * 0.8 + mrN * 0.2;
        float mrHot = 0.0;
    `,
    // WORLD 5's PLANET (planet3d.js): a riveted steel sphere -- plates on a
    // latitude/longitude grid, rust patches, and a hazard-striped band round
    // the equator. Owns its palette.
    steelPlanet: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 2.5);
        vec3 mrU = normalize(vMrPos);
        float mrLon = atan(mrU.z, mrU.x) / 6.28318 * 18.0, mrLat = asin(clamp(mrU.y, -1.0, 1.0)) / 3.14159 * 9.0;
        float mrSq = sqrt(max(0.0, 1.0 - mrU.y * mrU.y));
        float mrSeamP = 1.0 - smoothstep(0.0, 0.03, min(min(fract(mrLon), 1.0 - fract(mrLon)) * mrSq, min(fract(mrLat), 1.0 - fract(mrLat))));
        vec2 mrRv = vec2(fract(mrLon * 4.0) - 0.5, (min(fract(mrLat), 1.0 - fract(mrLat)) - 0.08) * 4.0);
        float mrRiv = (1.0 - smoothstep(0.12, 0.2, length(mrRv))) * mrSq;
        float mrRust = smoothstep(0.5, 0.72, mrFbm(mrP * 1.6 + 2.0));
        float mrBand = 1.0 - smoothstep(0.1, 0.12, abs(mrU.y));
        float mrStripe = step(0.5, fract(mrLon * 1.5 + mrU.y * 6.0));
        vec3 mrSteel = vec3(0.42, 0.45, 0.49) * (0.85 + 0.25 * mrN);
        mrSteel = mix(mrSteel, vec3(0.45, 0.22, 0.09) * (0.8 + 0.4 * mrN), mrRust * 0.8);
        mrSteel = mix(mrSteel, mix(vec3(0.07), vec3(0.95, 0.72, 0.08), mrStripe), mrBand);
        diffuseColor.rgb = mrSteel * (1.0 - 0.5 * mrSeamP) * (1.0 + 0.4 * mrRiv);
        float mrTone = 0.0;
        float mrH = -mrSeamP + mrRiv;
        float mrHot = 0.0;
    `,
    // WORLD 4's PLANET (planet3d.js): a beach ball -- six bright panels
    // meeting at white caps on the poles, with seams between them. Owns its
    // palette.
    beachBall: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 3.0);
        vec3 mrU = normalize(vMrPos);
        float mrA = atan(mrU.z, mrU.x) / 6.28318 + 0.5;
        float mrPanel = floor(mrA * 6.0);
        float mrEdge = min(fract(mrA * 6.0), 1.0 - fract(mrA * 6.0)) * sqrt(max(0.0, 1.0 - mrU.y * mrU.y));
        vec3 mrPal = mrPanel < 1.0 ? vec3(0.88, 0.23, 0.23) : mrPanel < 2.0 ? vec3(0.97, 0.97, 0.93)
                   : mrPanel < 3.0 ? vec3(0.18, 0.44, 0.84) : mrPanel < 4.0 ? vec3(0.95, 0.71, 0.11)
                   : mrPanel < 5.0 ? vec3(0.18, 0.66, 0.31) : vec3(1.0, 0.48, 0.10);
        float mrCap = smoothstep(0.86, 0.88, abs(mrU.y));
        float mrSeamB = (1.0 - smoothstep(0.0, 0.012, mrEdge)) * (1.0 - mrCap);
        diffuseColor.rgb = mix(mix(mrPal, vec3(0.97, 0.97, 0.93), mrCap), vec3(0.75, 0.73, 0.70), mrSeamB);
        float mrTone = 0.0;
        float mrH = -mrSeamB + mrN * 0.05;
        float mrHot = 0.0;
    `,
    // A FLARING SEAM's band (world 3): a crusted fissure with molten veins
    // creeping along it. Its glow (mrGlow, per seam) is driven by the seam's
    // state in mazeProps3d.js -- dull, brightening, then blazing.
    fissure: /* glsl */`
        vec3 mrP = vMrPos * mrScale;
        float mrN = mrFbm(mrP * 3.0);
        float mrVein = smoothstep(0.32, 0.7, mrFbm(mrP * 5.0 + vec3(0.0, mrTime * 0.5, mrTime * 0.2)));
        diffuseColor.rgb = mix(vec3(0.07, 0.045, 0.035), vec3(0.32, 0.07, 0.02), mrVein);
        float mrTone = 0.0;
        float mrH = (1.0 - mrVein) * 0.9 + mrN * 0.3;
        float mrHot = 0.35 + 0.65 * mrVein;
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
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                // Instanced meshes (ice patches): the instance's own transform
                // takes the unit quad to where it lies in the level.
                #ifdef USE_INSTANCING
                    vMrPos = (instanceMatrix * vec4(position, 1.0)).xyz;
                #else
                    vMrPos = position;
                #endif`);
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
