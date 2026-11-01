// Resonance's Tier I–II actives on the server (DESIGN 9.4, ARCHITECTURE §28; P1.E07.T06): Pulse, Harmonic, Shatter, Veil, and
// the ship forms Deep Sweep and Jammer. Every number is the node's (`@astra/shared/data`) or `RESONANCE_NUMBERS`'s. They act
// through the context only: creatures are stunned and calmed by `control` (which refuses what a creature's resistances
// shrug off), damage goes through `ctx.damage` and the safe zones and phase rule it applies, deposits through `deposits`. The
// branch's passives and augment are not cast: Long Ear's ranges are the scan's (`scanRanges`), Choir is read by Pulse, and
// Echo by Pulse too.
import { RESONANCE_NUMBERS } from '@astra/shared/abilities';
import { hitTest } from '@astra/shared/combat';
import { getSkillNode } from '@astra/shared/data';
import type { AbilityEffect, CastContext } from './book.ts';

const N = RESONANCE_NUMBERS;

type Vec3 = [number, number, number];

/** The status a Deep Sweep leaves on its ship: pirates read on the radar at its power, m, until it ends. */
export const DEEP_SWEEP = 'deep_sweep';

/** An area cast is refused `busy` while the ground its line of sight reads is still being planned. */
const groundPlanned = (ctx: CastContext): 'busy' | null => (ctx.groundReady() ? null : 'busy');

/** Stuns every creature within `radius` of `at` for `seconds`. */
function stunAround(ctx: CastContext, at: Readonly<Vec3>, radius: number, seconds: number): void {
  for (const h of hitTest({ kind: 'sphere', radius }, { origin: at }, ctx.creatures(radius, at))) ctx.control.stun(h.target.id, seconds);
}

export const RESONANCE_EFFECTS: ReadonlyMap<string, AbilityEffect> = new Map<string, AbilityEffect>([
  [
    // The scan's voice: every creature within 15 m stands still for 2 s. With Choir the party within 50 m shares it: the stun
    // goes off round each of them too, and their clients are told the Pulse is theirs (the scan's reveal is the client's). With
    // Echo it sounds again 2 s later, round where the caster and its party stand then.
    'pulse',
    {
      cast(ctx) {
        const { radiusM, stunS } = ctx.node.params;
        const choir = ctx.owns('choir');
        const sound = (first: boolean): void => {
          const pose = ctx.pose();
          if (!pose) return;
          stunAround(ctx, pose.origin, radiusM!, stunS!);
          if (!choir) return;
          const members = ctx.party(getSkillNode('choir').params.radiusM!);
          for (const m of members) stunAround(ctx, m.pos, radiusM!, stunS!);
          if (first) ctx.share(members.map((m) => m.id));
        };
        sound(true);
        if (ctx.owns('echo')) ctx.after(getSkillNode('echo').params.delayS!, () => sound(false));
      },
    },
  ],
  [
    // Skittish creatures stop fleeing and hostile ones go passive, for 20 s or until they are hurt; the stone-touched are
    // immune (their resistances), as the context decides.
    'harmonic',
    {
      cast(ctx) {
        const { radiusM, durationS } = ctx.node.params;
        for (const h of hitTest({ kind: 'sphere', radius: radiusM! }, { origin: ctx.origin }, ctx.creatures(radiusM!))) ctx.control.calm(h.target.id, durationS!);
      },
    },
  ],
  [
    // A burst that only crystal creatures (weak to it) and mineral deposits answer; the rest of the wild is untouched.
    'shatter',
    {
      check: groundPlanned,
      cast(ctx) {
        const r = N.shatter.radiusM;
        for (const h of hitTest({ kind: 'sphere', radius: r }, { origin: ctx.origin }, ctx.creatures(r))) {
          if (ctx.resistance(h.target.id)?.effect !== 'weak' || ctx.sight(h.target.pos) !== true) continue;
          ctx.damage(h.target.id, N.shatter.creatureDamage);
        }
        ctx.deposits.burst(r, N.shatter.depositHp, N.shatter.depositsMax);
      },
    },
  ],
  [
    'veil',
    {
      cast(ctx) {
        ctx.conceal(ctx.node.params.durationS!);
      },
    },
  ],
  [
    // The cast event is what reveals the sites below (the client knows them); the server keeps the radar window for pirates
    // (P1.E08.T05) to read.
    'deep_sweep',
    {
      cast(ctx) {
        ctx.status.apply(ctx.caster, DEEP_SWEEP, N.deepSweep.radarS, ctx.node.params.radarRangeM);
      },
    },
  ],
  [
    'jammer',
    {
      check: (ctx) => (ctx.target !== null && ctx.canHarm(ctx.target) && ctx.ships.pulsing(ctx.target) ? null : 'target'),
      cast(ctx) {
        ctx.ships.jam(ctx.target!, N.jammer.lockoutS);
      },
    },
  ],
]);
