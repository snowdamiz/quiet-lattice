// The season awards' persistence component (P2.E22.T03, ARCHITECTURE §8, §27): written with the reputation, which holds
// the titles its awards earn, so a capture that cannot take one of the two writes neither, and an award never reaches
// the row without its title.
import { seasonAward, type SeasonAward } from '@astra/shared/seasons';
import type { Reputation } from '@astra/shared/reputation';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, coreRegistry, REPUTATION, SEASON_AWARDS, ShipLoadouts } from '../persistence/components.ts';
import type { PersistenceLog } from '../persistence/registry.ts';
import { CharacterPersistence, type StoredCharacterRow } from '../persistence/service.ts';
import type { CharacterStore, SaveRow } from '../persistence/store.ts';
import { ReputationService } from '../reputation/service.ts';
import { homeSystemOf } from '../world/home.ts';
import { ZoneManager } from '../zones/manager.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { SeasonAwards } from './awards.ts';

const HOME = homeSystemOf('thalune');
const AWARD: SeasonAward = seasonAward(1, 'held');
const OTHER: SeasonAward = seasonAward(2, 'fed');

const viewer: ZoneViewer = { id: 1, characterId: 'c1', sendBinary() {} };

class Rows implements CharacterStore {
  readonly row: StoredCharacterRow = { id: 'c1', name: 'Ves', people: 'thalune', homeSystem: HOME, level: 1, xp: 0, revision: 0, state: {} };
  readonly writes: SaveRow[] = [];

  async read(): Promise<StoredCharacterRow | null> {
    return structuredClone(this.row);
  }

  async write(batch: readonly SaveRow[]): Promise<Set<string>> {
    for (const s of batch) {
      this.writes.push(structuredClone(s));
      Object.assign(this.row, s.columns, { state: { ...this.row.state, ...structuredClone(s.state) }, revision: s.revision });
    }
    return new Set(batch.map((s) => s.id));
  }
}

/** One server process with the gateway's wiring: each award a character is given earns its title in the reputation. */
function joined() {
  const lines: { level: string; obj: Record<string, unknown> }[] = [];
  const at = (level: string) => (obj: object) => lines.push({ level, obj: obj as Record<string, unknown> });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  const clock = { now: () => 1000 };
  const zones = new ZoneManager({ clock });
  const reputation = new ReputationService({ log });
  const awards = new SeasonAwards();
  awards.subscribe((id, added) => {
    for (const a of added) reputation.earnTitle(id, a.title);
  });
  const registry = coreRegistry({
    zones,
    clock,
    inventory: new InventoryService(),
    ships: new ShipLoadouts(),
    progress: new CharacterProgress(),
    reputation,
    awards,
    log,
  });
  const store = new Rows();
  const persistence = new CharacterPersistence({ store, registry, log });
  persistence.join(viewer, store.row);
  zones.join(viewer, { id: 'c1', name: 'Ves', people: 'thalune', level: 1, homeSystem: HOME });
  const written = (from: number) => store.writes.slice(from).flatMap((w) => Object.keys(w.state));
  return { registry, awards, reputation, persistence, store, lines, written };
}

describe('the season awards component', () => {
  it('is written with the reputation', () => {
    const { registry, persistence } = joined();
    expect(registry.get(SEASON_AWARDS)!.writtenWith).toEqual([REPUTATION]);
    persistence.abandon();
  });

  it('writes an award and the title it earned in one save', async () => {
    const { awards, persistence, store, written } = joined();
    awards.grant('c1', [AWARD]);
    persistence.saveNow('c1');
    expect(await persistence.flush()).toBe(true);
    expect(written(0)).toEqual(expect.arrayContaining([SEASON_AWARDS, REPUTATION]));
    expect(store.row.state.seasonAwards!.data).toEqual({ awards: [AWARD] });
    expect((store.row.state.reputation!.data as Reputation).titles).toEqual([{ title: AWARD.title }]);
    persistence.abandon();
  });

  it('holds the title back from a save that cannot write the awards', async () => {
    const { awards, persistence, store, lines, written } = joined();
    awards.grant('c1', [AWARD]);
    // an award that fails its schema (a bug): the awards cannot be captured, and the title they earned waits with them
    (awards.get('c1') as SeasonAward[]).push({ ...OTHER, season: 0 });
    persistence.saveNow('c1');
    await persistence.flush();
    expect(written(0)).not.toContain(REPUTATION);
    expect(written(0)).not.toContain(SEASON_AWARDS);
    expect(store.row.state.reputation).toBeUndefined();
    expect(lines).toContainEqual({ level: 'error', obj: expect.objectContaining({ component: REPUTATION, with: [SEASON_AWARDS] }) });
    (awards.get('c1') as SeasonAward[]).pop();
    const before = store.writes.length;
    persistence.saveNow('c1');
    await persistence.flush();
    expect(written(before)).toEqual(expect.arrayContaining([SEASON_AWARDS, REPUTATION]));
    persistence.abandon();
  });

  it('holds the awards back from a save that cannot write the reputation', async () => {
    const { awards, reputation, persistence, store, lines, written } = joined();
    awards.grant('c1', [AWARD]);
    (reputation.get('c1') as Reputation).rep.compact = 5000;
    persistence.saveNow('c1');
    await persistence.flush();
    expect(written(0)).not.toContain(SEASON_AWARDS);
    expect(written(0)).not.toContain(REPUTATION);
    expect(store.row.state.seasonAwards).toBeUndefined();
    expect(lines).toContainEqual({ level: 'error', obj: expect.objectContaining({ component: SEASON_AWARDS, with: [REPUTATION] }) });
    (reputation.get('c1') as Reputation).rep.compact = 240;
    const before = store.writes.length;
    persistence.saveNow('c1');
    await persistence.flush();
    expect(written(before)).toEqual(expect.arrayContaining([SEASON_AWARDS, REPUTATION]));
    expect(store.row.state.seasonAwards!.data).toEqual({ awards: [AWARD] });
    persistence.abandon();
  });
});
