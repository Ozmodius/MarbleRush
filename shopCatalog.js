// THE SHOP CATALOG -- every marble, upgrade, power-up and prize refill, with
// its price and what it does. Pure data plus the arithmetic that turns a
// player's choices into ball numbers, so test_shop.js can check it in Node.
//
// THE RULE (CLAUDE.md, docs/PLAN.md): marbles and upgrades buy CONTROL and
// FORGIVENESS, never top speed and never a smaller ball. Ball radius belongs
// to the world. Concretely, nothing here may:
//   - change the ball's radius (no field for it exists);
//   - raise the tilt ceiling: `response` reaches full tilt with less lean, but
//     mazeTilt.js still clamps at MAX_TILT_DEG, so full tilt is the same pull;
//   - lower damping below the Classic marble's (less damping = higher speed).
// test_shop.js holds all three.

// --- marbles (the plan's "Classic + 3 characters") --------------------------
// Stats are the physics knobs buildWorld() applies:
//   grip        ball-floor/wall friction (Classic 0.28)
//   bounce      restitution off walls (Classic 0.12)
//   damping     linear damping: how fast it coasts down (Classic 0.02)
//   spin        angular damping (Classic 0.22)
//   response    tilt sensitivity multiplier: full tilt with less lean
// `look` is the ball's material. Classic has none: it wears the world theme's
// marble colour, which each theme picks to stand out on its own floor.
export const MARBLES = {
    classic: {
        name: 'Classic', price: 0,
        blurb: 'Rolls the way every level was tuned.',
        stats: { grip: 0.28, bounce: 0.12, damping: 0.02, spin: 0.22, response: 1.0 },
        look: null, swatch: '#f2f2f2'
    },
    steel: {
        name: 'Steel', price: 600,
        blurb: 'Heavy and steady. Sheds speed fast, so it stops where you meant.',
        stats: { grip: 0.3, bounce: 0.05, damping: 0.09, spin: 0.4, response: 0.9 },
        look: { color: '#c3ccd6', metalness: 0.9, roughness: 0.22 }, swatch: '#aeb8c4'
    },
    rubber: {
        name: 'Rubber', price: 900,
        blurb: 'Grips the floor and thuds off walls. Takes corners tight.',
        stats: { grip: 0.48, bounce: 0.03, damping: 0.04, spin: 0.3, response: 1.0 },
        look: { color: '#e0563f', metalness: 0.0, roughness: 0.85 }, swatch: '#e0563f'
    },
    glass: {
        name: 'Glass', price: 1500,
        blurb: 'Answers the smallest lean. For players with a light touch.',
        stats: { grip: 0.26, bounce: 0.12, damping: 0.03, spin: 0.22, response: 1.35 },
        look: { color: '#bfeaff', metalness: 0.1, roughness: 0.04, emissive: '#2a6f8a', emissiveIntensity: 0.25 }, swatch: '#9fdcf5'
    }
};
export const MARBLE_IDS = Object.keys(MARBLES);

// --- upgrades (the plan's "4 upgrade tracks") --------------------------------
// Three tiers each, bought in order. `per` is added per tier.
export const UPGRADES = {
    grip:      { name: 'Grip', blurb: 'More grip on every surface. Tighter turns.', prices: [200, 500, 1000], per: 0.04, unit: 'grip' },
    brakes:    { name: 'Air Brake', blurb: 'The marble coasts to a stop sooner.', prices: [200, 500, 1000], per: 0.03, unit: 'damping' },
    powerTime: { name: 'Power Time', blurb: 'Slow-mo and magnet last 20% longer per tier.', prices: [250, 600, 1200], per: 0.2, unit: 'duration' },
    coinReach: { name: 'Coin Reach', blurb: 'Pick up coins from a little further away.', prices: [150, 400, 800], per: 0.06, unit: 'reach' }
};
export const UPGRADE_IDS = Object.keys(UPGRADES);

// --- power-ups, bought one at a time (mazePickups.js POWERUPS) ---------------
export const CHARGES = {
    shield: { name: 'Shield', blurb: 'Armed at the start of a run. Saves you from one fall.', price: 80 },
    slowmo: { name: 'Slow-mo', blurb: 'Tap during a run: the world slows for 6 seconds.', price: 60 },
    magnet: { name: 'Magnet', blurb: 'Tap during a run: pull in nearby coins for 8 seconds.', price: 60 }
};
export const CHARGE_IDS = Object.keys(CHARGES);

// --- world prizes (docs/PLAN.md's world table) -------------------------------
// Clearing a world's last level grants PRIZE_GRANT uses of its prize. Each use
// lasts one level: it is spent the first time the prize's trap is met in that
// level, and covers every retry of it. Refills are sold only once the prize has
// been earned -- the store never sells a world's reward before the world.
// `trap` names the level field the prize answers; only prizes whose world is
// built so far appear in the store.
export const PRIZE_GRANT = 3;
export const PRIZES = {
    rubberCoat: { name: 'Rubber Coat', world: 1, blurb: 'Full grip on ice.', trap: 'ice', refill: { uses: 3, price: 250 } },
    heatShield: { name: 'Heat Shield', world: 2, blurb: 'Lava flares cannot burn you.', trap: 'flares', refill: { uses: 3, price: 300 } },
    obsidianCore: { name: 'Obsidian Core', world: 3, blurb: 'Bumpers push you half as hard.', trap: 'bumpers', refill: { uses: 3, price: 350 } },
    plasticBall: { name: 'Plastic Ball', world: 4, blurb: 'Magnets cannot grab you.', trap: 'magnets', refill: { uses: 3, price: 400 } },
    chromePolish: { name: 'Chrome Polish', world: 5, blurb: 'Slides through mud.', trap: 'mud', refill: { uses: 3, price: 450 } }
};
export const PRIZE_IDS = Object.keys(PRIZES);

// --- rewarded ads (platform.js; CrazyGames only) -----------------------------
// What a rewarded ad the player CHOSE to watch pays. Never anything that makes
// the ball faster or smaller, never anything a level requires.
//   coins          the store's "free coins" row, at most once per coinsCooldownMs
//   doubleClear    a clear's pay doubled: up to doubleCap extra, once per clear
//   shield         a free Shield charge on the ready screen, once per level visit
//   revive         after a fall: back on the last safe spot, the run's clock
//                  still running (an ad's time counts, so it never buys a
//                  better time). Once per attempt, and only after reviveAfterMs
//                  of run -- a fall in the first seconds costs nothing to retry.
export const AD_REWARDS = { coins: 60, coinsCooldownMs: 3 * 60 * 1000, doubleCap: 500, reviveAfterMs: 8000 };

// The ball a player will roll: their marble plus their upgrades. One function
// so the profile page's stat bars and buildWorld() can never disagree.
export function ballSetup(marbleId, upgrades = {}) {
    const m = MARBLES[marbleId] || MARBLES.classic;
    const tier = id => Math.max(0, Math.min(UPGRADES[id].prices.length, upgrades[id] | 0));
    return {
        id: MARBLES[marbleId] ? marbleId : 'classic',
        look: m.look,
        grip: m.stats.grip + tier('grip') * UPGRADES.grip.per,
        bounce: m.stats.bounce,
        damping: m.stats.damping + tier('brakes') * UPGRADES.brakes.per,
        spin: m.stats.spin,
        response: m.stats.response,
        // mazePickups.js modifiers
        durationScale: 1 + tier('powerTime') * UPGRADES.powerTime.per,
        coinReach: tier('coinReach') * UPGRADES.coinReach.per
    };
}
