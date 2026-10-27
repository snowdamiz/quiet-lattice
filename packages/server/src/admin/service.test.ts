// The admin service out of play, with the store under the test's control: a command for a character whose last save is
// still being written waits for it (rather than refuse), and edits what that save left; with no wait it is refused. In
// direct mode a character saved moments ago is refused unless forced.
import { countOf, type Inventory } from '@astra/shared/inventory';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, coreRegistry, INVENTORY, ShipLoadouts } from '../persistence/components.ts';
import type { StoredState } from '../persistence/registry.ts';
import { CharacterPersistence, type StoredCharacterRow } from '../persistence/service.ts';
import type { CharacterStore, SaveRow } from '../persistence/store.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { AdminError } from './commands.ts';
import { AdminService, type AdminDirectory } from './service.ts';

/** The characters table in memory with the store's revision guard, whose writes the test can hold. */
class Rows implements CharacterStore {
  readonly rows = new Map<string, StoredCharacterRow>();
  private gate: Promise<void> | null = null;

  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise((r) => (release = r));
    return () => {
      this.gate = null;
      release();
    };
  }

  async read(id: string): Promise<StoredCharacterRow | null> {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async write(batch: readonly SaveRow[]): Promise<Set<string>> {
    if (this.gate) await this.gate;
    const written = new Set<string>();
    for (const s of batch) {
      const r = this.rows.get(s.id);
      if (!r || s.revision <= r.revision) continue;
      this.rows.set(s.id, { ...r, ...s.columns, state: { ...r.state, ...structuredClone(s.state) }, revision: s.revision });
      written.add(s.id);
    }
    return written;
  }
}

const CHARACTER = 'c0ffee00-abcd-4000-8000-0000000000aa';

function setup(opts: { heldWaitMs?: number; recentSaveMs?: number; savedAt?: Date | null } = {}) {
  const store = new Rows();
  const row: StoredCharacterRow = { id: CHARACTER, name: 'Ves', people: 'thalune', homeSystem: 0, level: 1, xp: 0, state: {} as StoredState, revision: 0 };
  store.rows.set(CHARACTER, row);
  const inventory = new InventoryService();
  const registry = coreRegistry({ zones: { zoneOf: () => undefined }, inventory, ships: new ShipLoadouts(), progress: new CharacterProgress() });
  const persistence = new CharacterPersistence({ store, registry, flushTimeoutMs: 2000 });
  const directory: AdminDirectory = {
    character: async (ref) => (ref.toLowerCase() === 'ves' ? { id: CHARACTER, name: 'Ves', accountId: 'a1', savedAt: opts.savedAt ?? null } : null),
    account: async () => null,
  };
  const admin = new AdminService({ directory, persistence, heldWaitMs: opts.heldWaitMs, recentSaveMs: opts.recentSaveMs });
  return { store, inventory, persistence, admin, row };
}

const who = { name: 'tester', via: 'direct' as const };
const viewer: ZoneViewer = { id: 1, characterId: CHARACTER, sendBinary: () => {} };

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AdminError) return err.code;
    throw err;
  }
  return 'ok';
}

describe('the admin service out of play', () => {
  it('waits for the save of a character that just left, then edits what it left', async () => {
    const { store, inventory, persistence, admin, row } = setup();
    persistence.join(viewer, row);
    expect(inventory.grant(CHARACTER, 'ferrite', 5).ok).toBe(true);
    const release = store.hold();
    persistence.leave(viewer);
    expect(persistence.status(CHARACTER)).toMatchObject({ inPlay: false, pending: true });

    const granting = admin.run({ cmd: 'grant', character: 'Ves', what: 'ferrite', count: 3 }, who);
    await new Promise((r) => setTimeout(r, 200));
    release();
    expect(await granting).toMatchObject({ online: false, added: 3, revision: 2, changed: ['inventory'] });
    expect(countOf(store.rows.get(CHARACTER)!.state[INVENTORY]!.data as Inventory, 'ferrite')).toBe(8);
  });

  it('is refused while that save is unwritten when it may not wait', async () => {
    const { store, inventory, persistence, admin, row } = setup({ heldWaitMs: 0 });
    persistence.join(viewer, row);
    inventory.grant(CHARACTER, 'ferrite', 5);
    const release = store.hold();
    persistence.leave(viewer);
    expect(await codeOf(admin.run({ cmd: 'grant', character: 'Ves', what: 'ferrite', count: 3 }, who))).toBe('held');
    release();
    await persistence.flush();
    expect(countOf(store.rows.get(CHARACTER)!.state[INVENTORY]!.data as Inventory, 'ferrite')).toBe(5);
  });

  it('refuses a character saved moments ago when told to (direct mode), and edits one saved earlier', async () => {
    const recent = setup({ recentSaveMs: 60_000, savedAt: new Date(Date.now() - 10_000) });
    await expect(recent.admin.run({ cmd: 'set-skill-points', character: 'ves', points: 4 }, who)).rejects.toThrow(/saved 10 s ago.*--force/);
    expect(recent.store.rows.get(CHARACTER)!.revision).toBe(0);
    const earlier = setup({ recentSaveMs: 60_000, savedAt: new Date(Date.now() - 120_000) });
    expect(await earlier.admin.run({ cmd: 'set-skill-points', character: 'ves', points: 4 }, who)).toMatchObject({ online: false, available: 4 });
    const forced = setup({ recentSaveMs: 0, savedAt: new Date() });
    expect(await forced.admin.run({ cmd: 'set-skill-points', character: 'ves', points: 4 }, who)).toMatchObject({ available: 4 });
  });

  it('needs the server for what only a live server holds', async () => {
    const { admin } = setup();
    for (const cmd of [{ cmd: 'who' }, { cmd: 'metrics' }, { cmd: 'mute', account: 'x' }, { cmd: 'despawn', system: 0, entity: 1 }] as const) {
      expect(await codeOf(admin.run(cmd, who))).toBe('needs_server');
    }
    expect(await codeOf(admin.run({ cmd: 'grant', character: 'nobody', what: 'ferrite', count: 1 }, who))).toBe('not_found');
    expect(await codeOf(admin.run({ cmd: 'set-quest-step', character: 'ves', quest: 'q', step: 1 }, who))).toBe('unavailable');
  });
});
