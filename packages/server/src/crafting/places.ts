// The fabricator terminals the server knows (DESIGN 15.7; P2.E20.T01): every zone's Waystation has one (the trade deck's),
// and the places that come later register theirs: a capital's (P1.E10.T02), a Chorus sanctuary's, the Scrapyard's
// (P1.E11.T05) each add a `FabricatorPlace` for the zones it is in, and the crafting service holds the player to it. The
// rules (which fabricator makes what, the tier band) are the shared ones; a place adds only where its terminal is.
import { fabricatorPlace, waystationPlace, type FabricatorPlace } from '@astra/shared/crafting';
import type { CraftingZone } from './service.ts';

/** The zone's own facts a place can be matched by. */
export type PlaceZone = Pick<CraftingZone, 'id' | 'systemIndex' | 'system'>;

export class FabricatorPlaces {
  private readonly extra: { place: FabricatorPlace; where: (zone: PlaceZone) => boolean }[] = [];

  /** Registers a place's terminal for the zones `where` accepts (a capital's home system, the Scrapyard's instance zone).
   * Throws for a place id of no place kind, one that is the Waystation's (every zone has it), or one registered twice for
   * the same zone's fabricator. */
  register(place: FabricatorPlace, where: (zone: PlaceZone) => boolean): void {
    const checked = fabricatorPlace(place.id, place);
    if (checked.id === 'waystation') throw new RangeError("a Waystation fabricator is every zone's own; it is not registered");
    if (this.extra.some((e) => e.place.id === checked.id && e.where === where)) throw new RangeError(`${checked.id} is registered already`);
    this.extra.push({ place: checked, where });
  }

  /** The terminals in a zone: its Waystation's, then the registered ones. */
  in(zone: PlaceZone): FabricatorPlace[] {
    return [waystationPlace(zone.system.seed), ...this.extra.filter((e) => e.where(zone)).map((e) => e.place)];
  }
}
