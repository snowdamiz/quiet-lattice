import { type Ability } from '@astra/shared/abilities';
import { emptySkillState } from '@astra/shared/skills';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, DEFAULT_SHIP, ShipLoadouts } from '../persistence/components.ts';
import { ReputationService } from '../reputation/service.ts';
import { SkillService } from '../skills/service.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { abilityBook, type AbilityEffect } from './book.ts';
import { CastService } from './service.ts';

function world(withRankReader = true) {
  const id = 'ranked';
  const reputation = new ReputationService();
  reputation.open(id, { rep: { reaches: 200 }, titles: [] });
  const ships = new ShipLoadouts();
  ships.set(id, DEFAULT_SHIP);
  const skills = new SkillService({
    inventory: new InventoryService(),
    ships,
    progress: new CharacterProgress(),
    hooks: { meets: (character, req) => reputation.meetsRank(character, req.faction, req.rank) },
  });
  const state = emptySkillState();
  state.unlocked = ['micro_jump'];
  state.bought = ['micro_jump'];
  state.slots.ship[0] = 'micro_jump';
  skills.open(id, state, 'thalune');
  const zone = new Zone({ id: 'eligibility', systemIndex: 0, system: describeZoneSystem(0) });
  const viewer: ZoneViewer = { id: 1, characterId: id, sendBinary() {} };
  zone.join(viewer, { kind: 'player', frame: null, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' });
  const effects: string[] = [];
  let spent = 0;
  let now = 100;
  let seq = 0;
  const casts = new CastService({
    zones: { zoneOf: () => zone, tier: () => 0 },
    skills,
    ...(withRankReader ? { meets: skills.hooks.meets } : {}),
    meters: {
      addHeat: () => ({ ok: true }),
      spendCharge: (_, charge) => {
        spent += charge;
        return { ok: true };
      },
      beamTime: () => 0,
      dumpHeat: () => ({ ok: false, error: 'overheated' }),
    },
    now: () => now,
    book: abilityBook(
      new Map<string, Ability>([['micro_jump', { node: 'micro_jump', target: 'self', toggle: true }]]),
      new Map<string, AbilityEffect>([
        [
          'micro_jump',
          {
            cast: () => {
              effects.push('cast');
            },
            end: () => {
              effects.push('end');
            },
          },
        ],
      ]),
    ),
  });
  const cast = () => casts.cast(viewer, { t: 'cast', seq: ++seq, time: now, node: 'micro_jump', slot: 0, frame: null, aim: [0, 0, -1] });
  return {
    id,
    skills,
    reputation,
    casts,
    effects,
    cast,
    spent: () => spent,
    advance: () => {
      now += 20;
    },
  };
}

describe('live cast eligibility', () => {
  it('refuses a stale gated slot using the latest standing before paying or starting a cooldown', () => {
    const w = world();
    w.reputation.set(w.id, 'reaches', 199); // deliberately no refresh: the old slot still exists
    expect(w.skills.get(w.id)!.slots.ship[0]).toBe('micro_jump');
    expect(w.cast()).toMatchObject({ result: 'refused', reason: 'not_slotted' });
    expect(w.spent()).toBe(0);
    expect(w.effects).toEqual([]);
    expect(w.casts.state(w.id)).toMatchObject({ cooldowns: [], on: [] });
    w.reputation.set(w.id, 'reaches', 200);
    expect(w.cast().result).toBe('cast');
    expect(w.spent()).toBe(25);
  });

  it('fails closed for gated fixture abilities without a requirement reader', () => {
    const w = world(false);
    expect(w.cast()).toMatchObject({ result: 'refused', reason: 'not_slotted' });
    expect(w.spent()).toBe(0);
  });

  it.each(['notification', 'step', 'cast'] as const)('ends an active toggle on rank loss through %s, once, and permits recovery', (trigger) => {
    const w = world();
    let told = 0;
    w.casts.subscribe(() => {
      told++;
    });
    w.skills.subscribe((id) => w.casts.skillsChanged(id));
    expect(w.cast().result).toBe('cast');
    w.reputation.set(w.id, 'reaches', 199);
    if (trigger === 'notification') w.skills.refresh(w.id);
    else if (trigger === 'step') w.casts.step(100);
    else expect(w.cast().result).toBe('refused');
    expect(w.effects).toEqual(['cast', 'end']);
    expect(told).toBe(1);
    expect(w.casts.state(w.id).on).toEqual([]);
    expect(w.skills.owned(w.id)).toEqual(['micro_jump']);
    w.casts.step(100);
    expect(told).toBe(1);
    w.reputation.set(w.id, 'reaches', 200);
    expect(w.skills.request(w.id, 1, { op: 'slot', bar: 'ship', index: 0, node: 'micro_jump' }).error).toBeUndefined();
    w.advance();
    expect(w.cast().result).toBe('cast');
    expect(w.effects).toEqual(['cast', 'end', 'cast']);
    expect(w.spent()).toBe(50);
  });
});
