// Phase kinds (DESIGN 17 "Phases are first class", 14.1, 16.6): story chapters, hangar bays, event instances and raid
// instances are all phases, a private layer at a shared place with a cap. DESIGN 17 gives one party, 24 in a bay and 12
// in an event; a raid's 12 is DESIGN 16.6's "scale 1–12". Whether a kind hides its players from other layers, and the
// grace period, are this table's.
//
// A story phase (an instanced quest step, a chapter, a cutscene) is a private set of actors: its members still see, and
// are seen by, everyone else at that place, as 14.1 has it ("everyone else sees the ordinary world there"). Bays, events
// and raids exist to split a crowd, so inside their volume a member sees only its own phase's players, and no one else
// sees it (16.6: "the exterior is shared, the hangar interior is a phase").

export type PhaseKind = 'story' | 'bay' | 'event' | 'raid';

export interface PhaseKindDef {
  /** What one phase holds: a single party (a player in none is a party of one), or a number of players. */
  readonly cap: { readonly parties: 1 } | { readonly players: number };
  /** Inside the phase's volume, its members and the players of every other layer (the shared world too) are hidden from each other. */
  readonly isolates: boolean;
  /** Seconds a member may spend outside the phase's volume before it goes back to the shared world. */
  readonly graceS: number;
}

export const PHASE_KINDS = Object.freeze({
  story: { cap: { parties: 1 }, isolates: false, graceS: 15 },
  bay: { cap: { players: 24 }, isolates: true, graceS: 15 },
  event: { cap: { players: 12 }, isolates: true, graceS: 15 },
  raid: { cap: { players: 12 }, isolates: true, graceS: 15 },
} as const satisfies Record<PhaseKind, PhaseKindDef>);

/**
 * A member inside a phase's volume counts as outside only once it is this factor beyond the radius, so one at the edge
 * does not flicker in and out of sight of the other layers every tick.
 */
export const PHASE_VOLUME_HYSTERESIS = 1.05;
