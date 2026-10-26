// Who is online in each zone, for system chat: a line reaches its star system without a scan of the whole shard. Kept as
// characters join, move (a handoff) and leave; checked against the zones as it is read (an entry whose session is in
// another zone now, or in none, or no longer holds its character, is moved or dropped there and then); and rebuilt from
// the roster once a refresh, which catches a session that changed zone without the service hearing of it.
import type { Zone } from '../zones/zone.ts';
import type { SocialZones } from './context.ts';
import type { Online, Roster } from './roster.ts';

export class ZoneIndex {
  private readonly byZone = new Map<Zone, Set<Online>>();
  /** each indexed character's entry and the zone it is under */
  private readonly where = new Map<string, { readonly o: Online; readonly zone: Zone }>();

  constructor(
    private readonly roster: Roster,
    private readonly zones: SocialZones,
  ) {}

  /** Indexes the character under the zone its session's entity is in now (or nowhere). */
  place(o: Online): void {
    this.unplace(o.characterId);
    const zone = this.zones.zoneOf(o.session);
    if (!zone) return;
    let set = this.byZone.get(zone);
    if (!set) this.byZone.set(zone, (set = new Set()));
    set.add(o);
    this.where.set(o.characterId, { o, zone });
  }

  /** Forgets the entry, when it is still the character's. */
  remove(o: Online): void {
    if (this.where.get(o.characterId)?.o === o) this.unplace(o.characterId);
  }

  /** Everyone online in `zone`. */
  *in(zone: Zone): Generator<Online> {
    const set = this.byZone.get(zone);
    if (!set) return;
    // (an entry moved or dropped here leaves this set, which iteration allows)
    for (const o of set) {
      if (this.roster.get(o.characterId) !== o) this.remove(o);
      else if (this.zones.zoneOf(o.session) !== zone) this.place(o);
      else yield o;
    }
  }

  /** Indexes everyone online afresh. */
  rebuild(): void {
    this.byZone.clear();
    this.where.clear();
    for (const o of this.roster.values()) this.place(o);
  }

  /** Characters indexed. */
  get size(): number {
    return this.where.size;
  }

  private unplace(characterId: string): void {
    const w = this.where.get(characterId);
    if (!w) return;
    this.where.delete(characterId);
    const set = this.byZone.get(w.zone);
    set?.delete(w.o);
    if (set?.size === 0) this.byZone.delete(w.zone);
  }
}
