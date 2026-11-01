// What the client does when it sees Gravitic's casts (DESIGN 9.2; P1.E07.T04). The server decides every cast and everything it does
// to the world (a creature carried to the caster's feet, a bubble that slows, the knockdown where a slam lands, a ship held); the
// client does the parts that are its own: the jetpack cut for a Slam's fall, an Inertial Brake's stop and its steadiness in gusts, the
// rocks a Tractor Beam draws, and a held ship's thrusters. Drawing the casts is P1.E07.T14.
import { GRAVITIC_NUMBERS } from '@astra/shared/abilities';
import { getSkillNode } from '@astra/shared/data';
import { registerAbilityFx } from '../net/abilities.js';

/** Whether the cast event is this player's own cast. */
const mine = (e, game) => e.caster !== undefined && e.caster === game.net?.entityId;

registerAbilityFx('slam', {
  cast(e, game) {
    if (mine(e, game)) game.player.slam();
  },
});

registerAbilityFx('inertial_brake', {
  cast(e, game) {
    if (mine(e, game)) game.ship.brake(getSkillNode('inertial_brake').params.durationS);
  },
});

registerAbilityFx('tractor_beam', {
  cast(e, game) {
    const holdS = getSkillNode('tractor_beam').params.holdS;
    if (mine(e, game)) game.asteroids.tractor(game.ship, GRAVITIC_NUMBERS.tractor.rangeM, holdS);
    if (e.target !== undefined && e.target === game.net?.entityId) game.ship.hold(holdS);
  },
});
