import { play } from './sound.js';

// Interface sounds, kept to the three calls the menus have always made:
//   sfx.open()   something good (a reward, a level-up)
//   sfx.close()  something bad
//   sfx.coin()   coins changing hands (a purchase, a claim)
// They play through the one sound engine (sound.js), so the player's sound
// switch, CrazyGames' mute and the ad rule all apply. The run itself no longer
// uses these: its sounds come from the physics (mazeAudio.js).
export const sfx = {
    open: () => play('uiGood'),
    close: () => play('uiBad'),
    coin: () => play('coins', { n: 3 })
};
