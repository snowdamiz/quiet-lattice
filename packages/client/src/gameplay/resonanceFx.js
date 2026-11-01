// What the client does when it sees Resonance's casts (DESIGN 9.4; P1.E07.T06). The server decides every cast and everything it
// does to the world (stuns, calms, bursts, jams); the client does the parts that are its own: the scan's reveal, which the Pulse
// is, the sites a Deep Sweep shows, and dropping out of the pulse drive when a Jammer holds it. Drawing the casts is P1.E07.T14.
import { RESONANCE_NUMBERS } from '@astra/shared/abilities';
import { registerAbilityFx } from '../net/abilities.js';

/** Whether the cast event is this player's own cast. */
const mine = (e, game) => e.caster !== undefined && e.caster === game.net?.entityId;

// The Pulse is the scan plus the stun: this player's, and a party member's within Choir's range (the server marks it `shared`).
registerAbilityFx('pulse', {
  cast(e, game) {
    if (mine(e, game) || e.shared) game.revealScan();
  },
});

registerAbilityFx('deep_sweep', {
  cast(e, game) {
    if (mine(e, game)) game.revealSites(e.frame);
  },
});

// The Jammer names the ship it holds: if that is this player's, the drive is out and stays so for the lockout.
registerAbilityFx('jammer', {
  cast(e, game) {
    if (e.target !== undefined && e.target === game.net?.entityId) game.ship.jam(RESONANCE_NUMBERS.jammer.lockoutS);
  },
});
