// Interest management (docs/ARCHITECTURE.md §6): a session sees the entities within its class's radius of the session's
// own entity (ships 50 km, walkers 2 km, mobs 1.5 km, loot 500 m), plus its own entity and its party wherever they are;
// then its phase may hide some of them (docs/ARCHITECTURE.md §6.1, phases/manager.ts).
// The radius belongs to the entity seen, not the viewer: a ship shows from 50 km whoever is looking.
import type { EntityState } from '@astra/shared/protocol';

export type InterestClass = 'ship' | 'walker' | 'mob' | 'loot';

/** Metres within which an entity of each class is in a session's interest set. */
export const INTEREST_RADIUS: Readonly<Record<InterestClass, number>> = { ship: 50_000, walker: 2_000, mob: 1_500, loot: 500 };
export const INTEREST_CLASSES = Object.keys(INTEREST_RADIUS) as InterestClass[];

/**
 * An entity already in view stays in view until it is this factor beyond its radius, so one hovering at the edge does
 * not enter and leave (a full state, then a removal) every tick.
 */
export const INTEREST_HYSTERESIS = 1.05;

type Kind = NonNullable<EntityState['kind']>;

/**
 * The interest class of an entity. A player counts as its ship unless it is on foot (docked and landed players sit in
 * their ships); NPCs and props are walker-sized; loot pods (a lost ship's cargo) count as loot.
 */
export function interestClass(kind: Kind, mode?: string): InterestClass {
  switch (kind) {
    case 'ship':
      return 'ship';
    case 'player':
      return mode === 'foot' ? 'walker' : 'ship';
    case 'mob':
      return 'mob';
    case 'loot':
    case 'pod':
      return 'loot';
    case 'npc':
    case 'prop':
      return 'walker';
  }
}
