// THE BARON'S DIARY (the user's call, 2026-10-10): ten pages, one hidden in
// each secret pocket (pockets.js), two a planet. Found pages read in Gear;
// the rest say where they are hidden. Together they tell why Baron Von
// Ratchet winds the planets -- and that he may not be quite what he seems.
//
// Pages are keyed by the level they hide on (pockets.js POCKET_LEVELS, in
// planet order), so a page is always the same page.

import { POCKET_LEVELS } from './pockets.js';

export const PAGES = {
    w1_07: 'Sawturn is wound tight at last. The little marbles spin my engines beautifully: round, tireless, perfect.',
    w1_08: 'That white marble, Rolle, followed my ship all the way here. Persistent. Irritating. Admirably round.',
    w2_04: 'Ice slows a planet’s spring. I need a marble that never stops sliding. Flurry will do nicely.',
    w2_06: 'Note to self: lock the cages twice. Rolle freed the little one. How does he keep finding them?',
    w3_03: 'Magmars runs hot, and heat keeps the gears loose. Cinder complains about the heat. Odd, for a cinder.',
    w3_07: 'I built my first clock when I was six. It stopped. Everything stops, in the end. Not my planets. Not while I can help it.',
    w4_03: 'Bouncelot’s springs keep their bounce only while something rolls. Bobble rolls. So Bobble stays.',
    w4_07: 'Rolle has come through four of my mazes. I left the last door open. I cannot think why.',
    w5_07: 'The Foundry is my home. I cut every gear here myself. Rivet keeps polishing them. Nobody asked him to.',
    w5_06: 'If every marble goes home, the planets wind down. If they stop, perhaps I will finally hear the quiet. Perhaps that is what I wanted all along.'
};

// Page numbers run in planet order.
export const pageNumber = (levelId) => POCKET_LEVELS.indexOf(levelId) + 1;
export const pageText = (levelId) => PAGES[levelId] || '';
