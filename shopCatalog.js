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

// --- skins and trails (docs/PLAN.md phase 2) ---------------------------------
// LOOKS ONLY (CLAUDE.md: what a player buys is control and forgiveness, never
// speed or a smaller ball -- and these buy neither). A skin paints a pattern on
// whichever marble is rolling, keeping that marble's shine and every stat; a
// trail draws behind the ball in a run. Each is bought with coins (`price`) or
// is a player-level reward (`level`, playerLevel.js), never both: a reward
// cannot be bought early. Patterns are drawn in skins3d.js and trail3d.js.
export const SKINS = {
    plain:   { name: 'Plain', price: 0, blurb: 'The marble as it comes.' },
    stripe:  { name: 'Racing Stripe', price: 300, blurb: 'A red band round the middle. Watch it spin.' },
    swirl:   { name: "Cat's Eye", price: 450, blurb: 'The schoolyard classic: a twist of colour inside.' },
    checker: { name: 'Checker', price: 600, blurb: 'Orange and cream squares.' },
    eight:   { name: 'Eight Ball', price: 800, blurb: 'Black, with the number on the side.' },
    earth:   { name: 'Little Earth', price: 1000, blurb: 'Oceans, land and ice caps.' },
    galaxy:  { name: 'Galaxy', level: 8, blurb: 'Nebulae and a thousand stars.' },
    ember:   { name: 'Ember', level: 15, blurb: 'Black rock with fire in the cracks.' }
};
export const SKIN_IDS = Object.keys(SKINS);
export const TRAILS = {
    none:    { name: 'None', price: 0, blurb: 'Nothing behind you.' },
    comet:   { name: 'Comet', price: 400, blurb: 'A cool blue streak.' },
    mint:    { name: 'Mint', price: 400, blurb: 'Fresh green, fading to teal.' },
    flame:   { name: 'Flame', price: 750, blurb: 'Yellow to red, like you are on fire.' },
    rainbow: { name: 'Rainbow', level: 5, blurb: 'Every colour, always moving.' },
    gold:    { name: 'Gold Dust', level: 12, blurb: 'A glittering wake of gold.' }
};
export const TRAIL_IDS = Object.keys(TRAILS);
// The catalogs by save field: progress[owned] lists what is owned,
// progress[chosen] what is worn.
export const LOOKS = {
    skin:  { table: SKINS, owned: 'skins', chosen: 'skin', base: 'plain' },
    trail: { table: TRAILS, owned: 'trails', chosen: 'trail', base: 'none' }
};

// --- player level (playerLevel.js) -------------------------------------------
// XP for what a player does; levels from total XP. Going from level k to k+1
// takes 100 + 50(k-1) XP, so level 5 is 700 XP, level 10 is 2,700 and level
// 15 is 5,950 -- a player who clears all 50 launch levels, with some golds
// and a few weeks of missions, lands in the high teens.
export const XP = {
    firstClear: 100,      // + perWorld * world: later worlds are worth more
    perWorld: 20,
    replayClear: 20,
    goldFirst: 50,
    mission: 40,
    missionsBonus: 50,
    dailyClaim: 20,
    dailyMaze: 150,
    walkFirst: 60,        // walking a level (Labyrinth mode) for the first time
    walkReplay: 10
};
// Every level-up pays coins (40 + 10 x the new level); some also give a
// power-up or unlock a reward skin or trail (SKINS / TRAILS with `level`).
export const LEVEL_REWARDS = {
    3: { charges: { shield: 1 } },
    5: { look: ['trail', 'rainbow'] },
    7: { charges: { slowmo: 1, magnet: 1 } },
    8: { look: ['skin', 'galaxy'] },
    10: { charges: { shield: 1, slowmo: 1, magnet: 1 }, coins: 300 },
    12: { look: ['trail', 'gold'] },
    15: { look: ['skin', 'ember'] },
    20: { coins: 1000 }
};

// --- the Labyrinth: walking a level (walkMode.js, docs/PLAN.md phase 3) -----
// Any level cleared by rolling can be WALKED in first person, traps and all.
// The walker is the ball's own body (the same radius the verifier proved
// fits) driven at a walking pace instead of by tilt. `accel` is how hard it
// can push toward that pace: well above every trap's push (each is held under
// half of full tilt, about 4.5 u/s^2), so a walker can always walk out of
// one. Walk medals use their own par: `parShare` x the level's gold time. The
// first walk of a level pays `payShare` of its first-clear pay plus the coins
// taken; the first walk gold pays the level's gold bonus.
export const WALK = { speed: 1.8, accel: 12, parShare: 1.1, payShare: 0.5 };
// Explorer upgrades: bought once, used only when walking. Control and
// forgiveness (CLAUDE.md) -- they show the way, they never speed you up.
export const EXPLORER = {
    compass: { name: 'Compass', price: 400, blurb: 'Walk mode: an arrow to the exit, and how far it is.' },
    map: { name: 'Explorer Map', price: 900, blurb: 'Walk mode: draws the maze as you walk it -- only what you have seen.' }
};
export const EXPLORER_IDS = Object.keys(EXPLORER);
// Comfort settings for walking (the comfort card): defaults, and the range
// each may take.
export const COMFORT = {
    fov: { def: 75, min: 60, max: 95 },
    sens: { def: 1, min: 0.4, max: 2 },
    invertY: { def: false },
    bob: { def: false },        // head bob: off by default, it upsets some stomachs
    vignette: { def: true }     // darkens the edges while moving or turning
};

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
//   try a marble   (Gear page) an unowned marble for the next level, every
//                  retry of it, then gone -- never ownership, never saved.
//   upgrade step   (Store) the next tier of an upgrade, free, once per
//                  upgradeCooldownMs, and only for tiers priced at most
//                  upgradeMaxPrice -- the top tiers stay something to save for.
export const AD_REWARDS = { coins: 60, coinsCooldownMs: 3 * 60 * 1000, doubleCap: 500, reviveAfterMs: 8000,
    upgradeCooldownMs: 30 * 60 * 1000, upgradeMaxPrice: 600 };

// --- daily rewards and missions (daily.js) ----------------------------------
// A 7-day calendar: one claim per local calendar day, rising through the week.
// Miss a day and the week starts again at day 1; after day 7 it loops. Totals
// about 840 coins and 6 power-ups a week -- worth a few levels, never more than
// playing (mazeLevels.json pays 120-360 a first clear).
export const DAILY_CALENDAR = [
    { coins: 50 },
    { coins: 80 },
    { coins: 50, charges: { shield: 1 } },
    { coins: 120 },
    { coins: 80, charges: { slowmo: 1, magnet: 1 } },
    { coins: 160 },
    { coins: 300, charges: { shield: 1, slowmo: 1, magnet: 1 } }
];

// Three missions a day, drawn from this pool by the date. `needs` keeps a
// mission out of a day's draw when the player cannot do it yet (no level
// cleared to beat, no power-ups to use). Counted by progressStore.js from
// clears and spent charges -- the run itself reports nothing new.
export const MISSIONS = {
    clears:  { text: 'Clear 3 levels', goal: 3, reward: 60 },
    coins:   { text: 'Collect 25 coins', goal: 25, reward: 50 },
    silver:  { text: 'Earn silver or better twice', goal: 2, reward: 60 },
    gold:    { text: 'Win a gold medal', goal: 1, reward: 80 },
    sweep:   { text: 'Collect every coin in a level', goal: 1, reward: 60 },
    best:    { text: 'Beat your best time on a level', goal: 1, reward: 70, needs: 'cleared' },
    powerup: { text: 'Use 2 power-ups', goal: 2, reward: 50, needs: 'charges' }
};
export const MISSIONS_PER_DAY = 3;
// Paid with the claim that completes the day's set.
export const MISSIONS_BONUS = 100;

// The daily maze (daily.js, dailyLevels.json): one verified maze a day from
// the worlds the player has reached, open once `unlockAfter` ladder levels
// are cleared. The day's first clear pays `reward` plus the coins taken; the
// day's first gold adds `goldBonus`. Replays chase the day's best time.
export const DAILY_MAZE = { unlockAfter: 3, reward: 150, goldBonus: 100 };

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
