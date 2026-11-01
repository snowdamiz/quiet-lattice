// Statuses on entities (ARCHITECTURE §28): what an ability leaves on its target for a while, like a burn. A status belongs to
// the character that put it there, so two players' burns on one creature each run their own clock and their own power;
// `active` asks whether anyone's holds (Cauterize, Brand). They expire on the world clock and are kept per zone. The effect
// that ticks a status (a burn) is told of its end by `get`, which still answers for GRACE_S past `until`, so its last tick,
// a step late, deals the end of the interval.

/** How long past its end a status is still the one its effect is ticking, s. */
export const GRACE_S = 1;

export interface Status {
  /** world time it ends, s */
  until: number;
  /** how hard it acts (a burn's damage per second); a later application keeps the greater */
  power: number;
  /** which application began it: kept by a later one that extends it, new when the status began over (removed or ended).
   * The effect that ticks it ends when it reads another, so no two ticking loops ever serve one status. */
  gen: number;
}

export class Statuses {
  private readonly zones = new Map<string, Map<number, Map<string, Map<string, Status>>>>();
  private lastPrune = -Infinity;
  private lastGen = 0;

  constructor(private readonly now: () => number) {}

  /** Puts `id` on `target` for `durationS` from the character: a fresh status, or the character's own running one made to
   * last until the later of the two ends and act at the greater power. True when it was fresh (none of the character's
   * was running or just ended: its effect ticks it still). */
  apply(zone: string, characterId: string, target: number, id: string, durationS: number, power = 1): boolean {
    const now = this.now();
    this.prune(now);
    let byEntity = this.zones.get(zone);
    if (!byEntity) this.zones.set(zone, (byEntity = new Map()));
    let byId = byEntity.get(target);
    if (!byId) byEntity.set(target, (byId = new Map()));
    let byCharacter = byId.get(id);
    if (!byCharacter) byId.set(id, (byCharacter = new Map()));
    const running = byCharacter.get(characterId);
    const held = !!running && running.until + GRACE_S > now;
    const live = !!running && running.until > now;
    byCharacter.set(characterId, {
      until: Math.max(live ? running.until : 0, now + durationS),
      power: live ? Math.max(running.power, power) : power,
      gen: running && held ? running.gen : ++this.lastGen,
    });
    return !held;
  }

  /** The character's own `id` on `target` while it runs and for GRACE_S after, or null. */
  get(zone: string, characterId: string, target: number, id: string): Status | null {
    const s = this.zones.get(zone)?.get(target)?.get(id)?.get(characterId);
    return s && s.until + GRACE_S > this.now() ? s : null;
  }

  /** Whether anyone's `id` runs on `target`. */
  active(zone: string, target: number, id: string): boolean {
    const now = this.now();
    for (const s of this.zones.get(zone)?.get(target)?.get(id)?.values() ?? []) if (s.until > now) return true;
    return false;
  }

  /** Ends the character's `id` on `target`. */
  remove(zone: string, characterId: string, target: number, id: string): void {
    const byCharacter = this.zones.get(zone)?.get(target)?.get(id);
    byCharacter?.delete(characterId);
  }

  /** Ends every status the character put anywhere (it left play: nothing ticks them any more). */
  dropCaster(characterId: string): void {
    for (const [zone, byEntity] of this.zones) {
      for (const [entity, byId] of byEntity) {
        for (const [id, byCharacter] of byId) {
          byCharacter.delete(characterId);
          if (!byCharacter.size) byId.delete(id);
        }
        if (!byId.size) byEntity.delete(entity);
      }
      if (!byEntity.size) this.zones.delete(zone);
    }
  }

  /** Forgets the statuses that have ended (and the entities, ids and zones left with none), at most once a second. */
  private prune(now: number): void {
    if (now - this.lastPrune < 1) return;
    this.lastPrune = now;
    for (const [zone, byEntity] of this.zones) {
      for (const [entity, byId] of byEntity) {
        for (const [id, byCharacter] of byId) {
          for (const [c, s] of byCharacter) if (s.until + GRACE_S <= now) byCharacter.delete(c);
          if (!byCharacter.size) byId.delete(id);
        }
        if (!byId.size) byEntity.delete(entity);
      }
      if (!byEntity.size) this.zones.delete(zone);
    }
  }

  /** How many entities carry a status, for tests and metrics. */
  get size(): number {
    let n = 0;
    for (const byEntity of this.zones.values()) n += byEntity.size;
    return n;
  }
}
