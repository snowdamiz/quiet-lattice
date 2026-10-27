// A zone's combat (P1.E06.T02) on a real zone of system 0 with its fauna, stepped by hand: creatures' health from their
// mob stats, the one damage path (the shared pipeline, level scaling only for creatures' attacks, threat to fauna), a
// kill (out of its herd at once, a corpse for the death beat, its den's timer started, the shares heard), players' health
// on foot and aboard and going down, and the combat events sent to whoever sees them, summed and bounded per tick.
import { atLevel, mobStats } from '@astra/shared/combat';
import { decodeServerMessage, type GameEvent } from '@astra/shared/protocol';
import type { FaunaSpecies } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { faunaWorld } from '../../test/faunaWorld.ts';
import type { Vec3 } from '../fauna/cells.ts';
import { DEN_RESPAWN_S } from '../fauna/dens.ts';
import { tangents } from '../fauna/herds.ts';
import { nextTime } from '../fauna/sky.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { DEATH_BEAT_S, EVENTS_PER_SESSION, type CombatHooks, type DownedReport, type KillReport } from './zone.ts';

type Want = (s: readonly FaunaSpecies[]) => boolean;
const docile = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'docile' && x.kind !== 'flyer');
const predator = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'predator' && x.kind !== 'flyer');
const both: Want = (s) => !!docile(s) && !!predator(s);

class TextViewer implements ZoneViewer {
  readonly texts: string[] = [];
  constructor(
    readonly id: number,
    readonly characterId: string | null,
  ) {}
  sendBinary(): void {}
  sendText(text: string): void {
    this.texts.push(text);
  }
  /** the combat events it was sent, taken */
  events(): Extract<GameEvent, { kind: 'combat' }>[] {
    const out = this.texts.map((t) => decodeServerMessage(t)).map((m) => (m?.t === 'event' && m.event.kind === 'combat' ? m.event : null));
    this.texts.length = 0;
    return out.filter((e) => e !== null);
  }
}

/** A world with hooks that record what they hear, and players joined at points over its ground. */
function combatWorld(want: Want = both, fauna: { dens?: boolean } = {}) {
  const heard = { killed: [] as KillReport[], downed: [] as DownedReport[], engaged: [] as string[] };
  const hooks: CombatHooks = {
    killed: (r) => heard.killed.push(r),
    downed: (r) => heard.downed.push(r),
    engaged: (id) => heard.engaged.push(id),
  };
  const w = faunaWorld({ tier: 3, want, combat: () => hooks, fauna });
  let nextId = 10;
  const up = (p: Readonly<Vec3>, h: number): Vec3 => {
    const l = Math.hypot(...p);
    return [(p[0] / l) * (l + h), (p[1] / l) * (l + h), (p[2] / l) * (l + h)];
  };
  return {
    w,
    heard,
    up,
    /** a player of character `id` at `pos` in `mode`, with its viewer */
    join(id: string | null, pos: Readonly<Vec3>, mode = 'ship', skills: string[] = []) {
      const viewer = new TextViewer(nextId++, id);
      const entity = w.zone.join(
        viewer,
        { kind: 'player', frame: w.frame, pos: [...pos], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode },
        {
          profile: { characterId: id ?? undefined, ship: { hull: 'lark', modules: { s1: 'pulse_lasers' }, cargoPods: 1, livery: 0 }, skills },
          now: w.time,
        },
      );
      return { viewer, entity };
    },
    herd(species: FaunaSpecies, at: Readonly<Vec3>, count = 1, level = 5) {
      return w.spawn({ body: w.body.index, species: species.index, at, count, level }).creatures;
    },
  };
}

const weapon = (base: number) => ({ base, kind: 'weapon' as const, what: 'pulse_lasers', source: { weapon: 'pulse_lasers' as const } });

describe('health', () => {
  it("is a creature's mob stats at its herd's level, full until it is hurt", () => {
    const { w, herd } = combatWorld();
    const sp = docile(w.species)!;
    const [id] = herd(sp, w.at(30, 0), 1, 7);
    const max = mobStats({ kind: 'fauna', bodyPlan: sp.bodyPlan, temperament: sp.temperament }, 7).health!;
    expect(w.zone.combat.creatureHealth(id!)).toEqual({ hp: max, max, dead: false });
    expect(w.zone.entity(id!)!.fields.hp).toBe(1);
  });

  it("is a player's suit (with its nodes) on foot, its ship's shield and hull aboard", () => {
    const { w, join, up } = combatWorld();
    const a = join('a', up(w.at(0, 0), 40));
    const b = join('b', w.at(5, 0), 'foot', ['second_skin']);
    expect(w.zone.combat.playerHealth(a.entity)).toMatchObject({ suit: 100, hull: 100, shield: 100, down: null });
    expect(w.zone.combat.playerHealth(b.entity)!.suitMax).toBe(150);
  });
});

describe('the damage path', () => {
  it('takes a hit through the shared pipeline onto the creature and its entity, and tells the hooks who fought', () => {
    const { w, herd, join, up, heard } = combatWorld();
    const [id] = herd(docile(w.species)!, w.at(30, 0));
    const a = join('a', up(w.at(0, 0), 40));
    const max = w.zone.combat.creatureHealth(id!)!.max;
    const out = w.zone.combat.applyDamage(a.entity, id!, weapon(11))!;
    expect(out).toEqual({ amount: 11, hp: (max - 11) / max, killed: false });
    expect(w.zone.combat.creatureHealth(id!)!.hp).toBeCloseTo(max - 11, 9);
    expect(w.zone.entity(id!)!.fields.hp).toBeCloseTo((max - 11) / max, 9);
    expect(heard.engaged).toEqual(['a']);
    // the attacker's power applies (its modifiers are the caller's to give)
    const strong = w.zone.combat.applyDamage(a.entity, id!, { ...weapon(10), attackerMods: [{ stat: 'ability.power', op: 'mul', value: 1.5 }] })!;
    expect(strong.amount).toBeCloseTo(15, 9);
  });

  it("scales only a creature's attacks with its level; a player's are flat", () => {
    const { w, herd, join, up } = combatWorld();
    const [hunter] = herd(predator(w.species)!, w.at(40, 0), 1, 12);
    const [grazer] = herd(docile(w.species)!, w.at(-40, 0), 1, 12);
    const a = join('a', up(w.at(0, 0), 40));
    // a creature's bite on a ship: its shield first
    const bite = w.zone.combat.applyDamage(hunter!, a.entity, { base: 10, kind: 'attack', what: 'bite_swarm' })!;
    expect(bite.amount).toBeCloseTo(atLevel(10, 12), 9);
    expect(w.zone.combat.playerHealth(a.entity)).toMatchObject({ shield: 100 - atLevel(10, 12), hull: 100 });
    expect(w.zone.entity(a.entity)!.fields).toMatchObject({ hp: 1, shield: (100 - atLevel(10, 12)) / 100 });
    expect(w.zone.combat.applyDamage(a.entity, grazer!, weapon(10))!.amount).toBe(10);
  });

  it('feeds the threat table: a hunter turns on whoever hurts it, a grazer bolts', () => {
    const { w, herd } = combatWorld();
    const [hunter] = herd(predator(w.species)!, w.at(25, 0));
    const [grazer] = herd(docile(w.species)!, w.at(-25, 0));
    w.run(0.2);
    w.zone.combat.applyDamage(w.player, hunter!, weapon(5));
    w.zone.combat.applyDamage(w.player, grazer!, weapon(5));
    w.run(0.2);
    const info = (id: number) => w.zone.fauna!.creatures().find((c) => c.id === id)!;
    expect(info(hunter!).target).toBe(w.player);
    expect(info(grazer!).state).toBe('flee');
  });
});

describe('a kill', () => {
  it('takes the creature out of its herd at once, leaves a corpse for the death beat, and reports the shares', () => {
    const { w, herd, join, up, heard } = combatWorld();
    const sp = docile(w.species)!;
    const [id, other] = herd(sp, w.at(30, 0), 2, 6);
    const a = join('a', up(w.at(0, 0), 40));
    const b = join('b', up(w.at(10, 0), 40));
    const max = w.zone.combat.creatureHealth(id!)!.max;
    w.zone.combat.applyDamage(a.entity, id!, weapon(max * 0.3));
    const out = w.zone.combat.applyDamage(b.entity, id!, weapon(max))!;
    expect(out).toMatchObject({ amount: max, hp: 0, killed: true });
    expect(heard.killed).toHaveLength(1);
    const r = heard.killed[0]!;
    expect(r).toMatchObject({ entity: id, frame: w.frame, level: 6, killer: 'b', ref: { kind: 'fauna', bodyPlan: sp.bodyPlan, temperament: 'docile' } });
    // what each did, the overkill not counted
    expect([...r.by]).toEqual([
      ['a', max * 0.3],
      ['b', max * 0.7],
    ]);
    // out of its herd and the AI at once; its entity a corpse
    expect(w.zone.fauna!.creatures().map((c) => c.id)).toEqual([other]);
    expect(w.zone.entity(id!)!.fields).toMatchObject({ hp: 0, mode: 'dead', vel: [0, 0, 0] });
    expect(w.zone.combat.applyDamage(a.entity, id!, weapon(5))).toBeNull();
    w.run(DEATH_BEAT_S - 0.2);
    expect(w.zone.entity(id!)?.fields.mode).toBe('dead');
    w.run(0.4);
    expect(w.zone.entity(id!)).toBeUndefined();
    expect(w.zone.combat.creatureHealth(id!)).toBeNull();
    expect(w.zone.entity(other!)).toBeDefined();
    expect(w.zone.combat.stats()).toMatchObject({ kills: 1, corpses: 0 });
  });

  it("starts its den's respawn timer when its pack is killed, not when the corpses go", () => {
    const { w } = combatWorld((s) => !!predator(s), { dens: true });
    const info = w.zone.fauna!.dens(w.body.index).find((d) => d.den.role === 'predator' && d.species?.kind !== 'flyer')!;
    // by day, from a ship nearby: the den's pack comes out and stays home
    w.time = nextTime(w.zone.system, w.body.index, info.den.dir, w.ground.radius, false, w.time, { margin: 900 })!;
    const [t] = tangents(info.den.dir);
    const r = w.ground.radius;
    const d = info.den.dir;
    w.movePlayer(w.onGround([d[0] * r + t[0] * 120, d[1] * r + t[1] * 120, d[2] * r + t[2] * 120]), 'ship');
    w.run(2);
    const den = () => w.zone.fauna!.dens(w.body.index)[info.index]!;
    const pack = den().pack;
    expect(pack.length).toBeGreaterThan(0);
    for (const id of pack) w.zone.combat.applyDamage(w.player, id, weapon(1e5));
    const died = w.time;
    w.run(1);
    expect(den().pack).toEqual([]);
    expect(Math.abs(den().respawnAt - (died + DEN_RESPAWN_S))).toBeLessThan(1.5);
    // (the corpses are still there)
    for (const id of pack) expect(w.zone.entity(id)?.fields.mode).toBe('dead');
  });
});

describe('players', () => {
  it('go down at 0 (the hull aboard, the suit on foot), take no more damage, and the hooks hear it', () => {
    const { w, herd, join, up, heard } = combatWorld();
    const [hunter] = herd(predator(w.species)!, w.at(40, 0), 1, 3);
    const a = join('a', up(w.at(0, 0), 40));
    const b = join('b', w.at(5, 0), 'foot');
    expect(w.zone.combat.applyDamage(hunter!, a.entity, { base: 1e4, kind: 'attack' })).toMatchObject({ hp: 0, killed: true });
    expect(w.zone.combat.playerHealth(a.entity)).toMatchObject({ shield: 0, hull: 0, down: 'ship' });
    expect(w.zone.combat.applyDamage(hunter!, b.entity, { base: 1e4, kind: 'attack' })).toMatchObject({ hp: 0, killed: true });
    expect(w.zone.combat.playerHealth(b.entity)).toMatchObject({ suit: 0, hull: 100, down: 'suit' });
    expect(heard.downed.map((d) => [d.characterId, d.cause, d.source])).toEqual([
      ['a', 'ship', hunter],
      ['b', 'suit', hunter],
    ]);
    expect(w.zone.combat.isDown(a.entity)).toBe(true);
    expect(w.zone.combat.applyDamage(hunter!, a.entity, { base: 1, kind: 'attack' })).toBeNull();
    expect(w.zone.entity(b.entity)!.fields.hp).toBe(0);
  });

  it('show the pool in use as their mode changes: the suit on foot, the hull and shield aboard', () => {
    const { w, herd, join } = combatWorld();
    const [hunter] = herd(predator(w.species)!, w.at(40, 0), 1, 1);
    const b = join('b', w.at(5, 0), 'foot');
    w.zone.combat.applyDamage(hunter!, b.entity, { base: 50 / atLevel(1, 1), kind: 'attack' });
    expect(w.zone.entity(b.entity)!.fields.hp).toBeCloseTo(0.5, 9);
    w.zone.patch(b.entity, { mode: 'landed' });
    w.run(0.05);
    expect(w.zone.entity(b.entity)!.fields).toMatchObject({ hp: 1, shield: 1 });
    w.zone.patch(b.entity, { mode: 'foot' });
    w.run(0.05);
    expect(w.zone.entity(b.entity)!.fields.hp).toBeCloseTo(0.5, 9);
    expect(w.zone.entity(b.entity)!.fields.shield).toBeUndefined();
  });
});

describe('combat events', () => {
  it('go after the tick to those who see the target or the source, several hits of one source on one target summed', () => {
    const { w, herd, join, up } = combatWorld();
    const [id] = herd(docile(w.species)!, w.at(30, 0));
    const a = join('a', up(w.at(0, 0), 40));
    const near = join('near', w.at(-10, 0), 'foot');
    // far away, on the Waystation: nothing of this reaches it
    const farViewer = new TextViewer(99, 'far');
    w.zone.join(farViewer, { kind: 'player', frame: w.zone.stationFrame, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'docked' });
    w.run(0.05);
    for (let i = 0; i < 3; i++) w.zone.combat.applyDamage(a.entity, id!, weapon(4));
    expect(a.viewer.events()).toEqual([]);
    w.run(0.05);
    const max = w.zone.combat.creatureHealth(id!)!.max;
    const expected = {
      kind: 'combat',
      source: a.entity,
      target: id,
      amount: 12,
      damageType: 'weapon',
      ability: 'pulse_lasers',
      killed: false,
      hp: (max - 12) / max,
    };
    expect(a.viewer.events()).toEqual([expected]);
    expect(near.viewer.events()).toEqual([expected]);
    expect(farViewer.events()).toEqual([]);
    // the killing blow says so
    w.zone.combat.applyDamage(a.entity, id!, weapon(1e5));
    w.run(0.05);
    expect(near.viewer.events()).toMatchObject([{ target: id, killed: true, hp: 0 }]);
  });

  it(`are at most ${EVENTS_PER_SESSION} a session a tick, its own entity's first`, () => {
    const { w, herd, join, up } = combatWorld();
    const many = herd(docile(w.species)!, w.at(30, 0), EVENTS_PER_SESSION + 8);
    const [hunter] = herd(predator(w.species)!, w.at(-30, 0));
    const a = join('a', up(w.at(0, 0), 40));
    const near = join('near', w.at(-10, 0), 'foot');
    w.run(0.05);
    for (const id of many) w.zone.combat.applyDamage(a.entity, id, weapon(1));
    w.zone.combat.applyDamage(hunter!, near.entity, { base: 1, kind: 'attack', what: 'leap' });
    w.run(0.05);
    const got = near.viewer.events();
    expect(got).toHaveLength(EVENTS_PER_SESSION);
    expect(got[0]).toMatchObject({ source: hunter, target: near.entity, damageType: 'attack', ability: 'leap' });
    expect(a.viewer.events()).toHaveLength(EVENTS_PER_SESSION);
    expect(w.zone.combat.stats().eventsDropped).toBeGreaterThan(0);
  });
});
