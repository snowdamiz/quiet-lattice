// Phase placement: caps per kind, reuse of a player's own and a party member's phase, overflow into a new phase, and
// closing (when the last member leaves, goes elsewhere, leaves the zone or stays outside past the grace, or on demand).
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type EntityInit, type ZoneLog, type ZoneViewer } from '../zones/zone.ts';
import { PHASE_KINDS, PHASE_VOLUME_HYSTERESIS } from './kinds.ts';
import type { PhaseLocation } from './manager.ts';

class Viewer implements ZoneViewer {
  constructor(readonly id: number) {}
  sendBinary(): void {}
}

function setup() {
  const logged: { level: string; msg: string; obj: Record<string, unknown> }[] = [];
  const log: ZoneLog = {
    info: (obj, msg) => logged.push({ level: 'info', msg, obj: obj as Record<string, unknown> }),
    warn: (obj, msg) => logged.push({ level: 'warn', msg, obj: obj as Record<string, unknown> }),
    debug: (obj, msg) => logged.push({ level: 'debug', msg, obj: obj as Record<string, unknown> }),
  };
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0), log });
  const station = zone.stationFrame;
  const init = (pos: [number, number, number] = [0, 0, 0], extra: Partial<EntityInit> = {}): EntityInit => ({
    kind: 'player',
    frame: station,
    pos,
    quat: [0, 0, 0, 1],
    vel: [0, 0, 0],
    mode: 'foot',
    ...extra,
  });
  let nextViewer = 1;
  /** a session joined at `pos` in the Waystation's frame, in `party` */
  const player = (pos: [number, number, number] = [0, 0, 0], party: string | null = null) => {
    const viewer = new Viewer(nextViewer++);
    const entity = zone.join(viewer, init(pos, { party }));
    return { viewer, entity };
  };
  const place = (key: string, radius = 200): PhaseLocation => ({ key, frame: station, center: [0, 0, 0], radius });
  let time = 2.3e7;
  const step = (dt = 0.05) => zone.step((time += dt));
  return { zone, phases: zone.phases, station, init, player, place, step, logged };
}

describe('phase kinds', () => {
  it('has DESIGN 17’s caps: one party for a story phase, 24 in a bay, 12 in an event or a raid', () => {
    expect(PHASE_KINDS.story.cap).toEqual({ parties: 1 });
    expect(PHASE_KINDS.bay.cap).toEqual({ players: 24 });
    expect(PHASE_KINDS.event.cap).toEqual({ players: 12 });
    expect(PHASE_KINDS.raid.cap).toEqual({ players: 12 });
    expect(PHASE_KINDS.story.isolates).toBe(false);
    expect([PHASE_KINDS.bay, PHASE_KINDS.event, PHASE_KINDS.raid].every((k) => k.isolates)).toBe(true);
  });
});

describe('phase placement', () => {
  it('opens a phase, keeps a player in it on asking again, and closes it (logged) when its last member leaves', () => {
    const { phases, player, place, logged } = setup();
    const a = player();
    expect(phases.phaseOf(a.entity)).toBeNull();
    const p = phases.phaseFor(a.viewer, 'story', place('site'));
    expect(p).toMatchObject({ kind: 'story', open: true, location: { key: 'site', radius: 200 } });
    expect([...p.members]).toEqual([a.entity]);
    expect(phases.phaseOf(a.entity)).toBe(p.id);
    expect(phases.phaseFor(a.viewer, 'story', place('site'))).toBe(p);
    expect(phases.count).toBe(1);
    expect(logged.find((l) => l.msg === 'phase opened')?.obj).toMatchObject({ phase: p.id, kind: 'story', location: 'site', cap: { parties: 1 } });

    expect(phases.leave(a.viewer)).toBe(true);
    expect(phases.leave(a.viewer)).toBe(false);
    expect(p.open).toBe(false);
    expect(phases.count).toBe(0);
    expect(phases.phaseOf(a.entity)).toBeNull();
    expect(logged.find((l) => l.msg === 'phase closed')?.obj).toMatchObject({ phase: p.id, kind: 'story', reason: 'empty', members: 0 });
    // a later placement opens a new phase with a new id
    expect(phases.phaseFor(a.viewer, 'story', place('site')).id).toBeGreaterThan(p.id);
  });

  it('puts a party in one story phase, and a player in no party or in another party in a phase of its own', () => {
    const { zone, phases, player, place } = setup();
    const a = player([0, 0, 0], 'p1');
    const b = player([5, 0, 0], 'p1');
    const solo1 = player();
    const solo2 = player();
    const other = player([0, 0, 5], 'p2');
    const pa = phases.phaseFor(a.viewer, 'story', place('site'));
    expect(phases.phaseFor(b.viewer, 'story', place('site'))).toBe(pa);
    const ps1 = phases.phaseFor(solo1.viewer, 'story', place('site'));
    const ps2 = phases.phaseFor(solo2.viewer, 'story', place('site'));
    const po = phases.phaseFor(other.viewer, 'story', place('site'));
    expect(new Set([pa.id, ps1.id, ps2.id, po.id]).size).toBe(4);
    expect([...pa.members].sort()).toEqual([a.entity, b.entity].sort());
    // the party given overrides the entity's tag
    const c = player();
    expect(phases.phaseFor(c.viewer, 'story', place('site'), 'p1')).toBe(pa);
    // a party member who has left the party no longer lets its party in, and a phase it shares is no one party's
    const d = player([0, 0, 0], 'p3');
    const pd = phases.phaseFor(d.viewer, 'story', place('site'));
    zone.setParty(d.entity, 'p4');
    const e = player([0, 0, 0], 'p3');
    expect(phases.phaseFor(e.viewer, 'story', place('site'))).not.toBe(pd);
    // another place is another phase, party or not
    expect(phases.phaseFor(b.viewer, 'story', place('elsewhere'))).not.toBe(pa);
    expect([...pa.members]).toEqual([a.entity, c.entity]);
  });

  it('fills a bay up to 24, opens another for the 25th, and fills the fullest bay with room first', () => {
    const { phases, player, place } = setup();
    const hangar = place('hangar');
    const crowd = Array.from({ length: 24 }, () => player());
    const first = phases.phaseFor(crowd[0]!.viewer, 'bay', hangar);
    for (const p of crowd) expect(phases.phaseFor(p.viewer, 'bay', hangar)).toBe(first);
    expect(first.members.size).toBe(24);
    const late = player();
    const second = phases.phaseFor(late.viewer, 'bay', hangar);
    expect(second).not.toBe(first);
    expect(phases.phaseFor(player().viewer, 'bay', hangar)).toBe(second);
    expect(second.members.size).toBe(2);
    // a place in the first bay frees up: the next arrival takes it, the fuller bay
    phases.leave(crowd[3]!.viewer);
    expect(phases.phaseFor(player().viewer, 'bay', hangar)).toBe(first);
    expect(first.members.size).toBe(24);
    expect(phases.count).toBe(2);
  });

  it('puts a player in a party member’s bay while it has room, ahead of a fuller one, and elsewhere once it is full', () => {
    const { phases, player, place } = setup();
    const hangar = place('hangar');
    const crowd = Array.from({ length: 24 }, () => player());
    const first = phases.phaseFor(crowd[0]!.viewer, 'bay', hangar);
    for (const p of crowd) phases.phaseFor(p.viewer, 'bay', hangar);
    const friend = player([0, 0, 0], 'wing');
    const second = phases.phaseFor(friend.viewer, 'bay', hangar);
    phases.leave(crowd[0]!.viewer);
    phases.leave(crowd[1]!.viewer);
    // the first bay now has 22 and room; a wingmate still goes to its friend's bay
    expect(phases.phaseFor(player([0, 0, 0], 'wing').viewer, 'bay', hangar)).toBe(second);
    expect(second.members.size).toBe(2);
    // both bays fill (the fuller first); once one has room again, a wingmate goes there, its friend's bay being full
    for (let i = 0; i < 24; i++) phases.phaseFor(player([0, 0, 0], `x${i}`).viewer, 'bay', hangar);
    expect([first.members.size, second.members.size]).toEqual([24, 24]);
    phases.leave(crowd[2]!.viewer);
    expect(phases.phaseFor(player([0, 0, 0], 'wing').viewer, 'bay', hangar)).toBe(first);
    expect(phases.count).toBe(2);
  });

  it('caps an event and a raid at 12, then opens another', () => {
    const { phases, player, place } = setup();
    for (const kind of ['event', 'raid'] as const) {
      const site = place(`${kind}-site`);
      const ids = Array.from({ length: 13 }, () => phases.phaseFor(player().viewer, kind, site).id);
      expect(ids.slice(0, 12).every((id) => id === ids[0])).toBe(true);
      expect(ids[12]).not.toBe(ids[0]);
    }
    expect(phases.count).toBe(4);
  });

  it('takes a player out of its old phase when it goes to another; the old one closes and its own entities go', () => {
    const { zone, phases, player, place, init } = setup();
    const a = player();
    const story = phases.phaseFor(a.viewer, 'story', place('site'));
    const actor = phases.spawn(story.id, init([20, 0, 0], { kind: 'npc', mode: undefined, name: 'Warden' }));
    expect(phases.phaseOf(actor)).toBe(story.id);
    expect([...story.entities]).toEqual([actor]);
    const bay = phases.phaseFor(a.viewer, 'bay', place('hangar'));
    expect(phases.phaseOf(a.entity)).toBe(bay.id);
    expect(story.open).toBe(false);
    expect(zone.entity(actor)).toBeUndefined();
    expect(phases.phaseOf(actor)).toBeNull();
    expect(() => phases.spawn(story.id, init())).toThrow(/no open phase/);
  });

  it('takes a member out at once when its entity leaves the zone', () => {
    const { zone, phases, player, place, init } = setup();
    const a = player([0, 0, 0], 'p');
    const b = player([0, 0, 0], 'p');
    const p = phases.phaseFor(a.viewer, 'story', place('site'));
    phases.phaseFor(b.viewer, 'story', place('site'));
    const actor = phases.spawn(p.id, init([3, 0, 0], { kind: 'mob', mode: 'idle' }));
    zone.leave(a.viewer);
    expect([...p.members]).toEqual([b.entity]);
    expect(p.open).toBe(true);
    zone.despawn(b.entity);
    expect(p.open).toBe(false);
    expect(zone.entity(actor)).toBeUndefined();
    // a phase's own entity despawned by someone else is simply forgotten
    const c = player();
    const q = phases.phaseFor(c.viewer, 'story', place('site'));
    const gone = phases.spawn(q.id, init([3, 0, 0], { kind: 'loot', mode: undefined }));
    zone.despawn(gone);
    expect(q.entities.size).toBe(0);
    expect(q.open).toBe(true);
  });

  it('closes a phase on demand: its members go back to the shared world and its own entities go', () => {
    const { zone, phases, player, place, init } = setup();
    const a = player();
    const p = phases.phaseFor(a.viewer, 'event', place('site'));
    const actors = [phases.spawn(p.id, init([1, 0, 0], { kind: 'mob', mode: 'idle' })), phases.spawn(p.id, init([2, 0, 0], { kind: 'mob', mode: 'idle' }))];
    expect(phases.close(p.id)).toBe(true);
    expect(phases.close(p.id)).toBe(false);
    expect(phases.phaseOf(a.entity)).toBeNull();
    expect(zone.entity(a.entity)).toBeDefined();
    expect(actors.map((id) => zone.entity(id))).toEqual([undefined, undefined]);
    expect(p.members.size + p.entities.size).toBe(0);
  });

  it('sends a member outside the volume back to the shared world after the grace, and keeps it if it returns in time', () => {
    const { zone, phases, player, place, step } = setup();
    const grace = PHASE_KINDS.story.graceS;
    const a = player([0, 0, 0], 'p');
    const b = player([0, 0, 0], 'p');
    const p = phases.phaseFor(a.viewer, 'story', place('site', 100));
    phases.phaseFor(b.viewer, 'story', place('site', 100));
    step();
    // out, and back before the grace is up
    zone.patch(a.entity, { pos: [400, 0, 0] });
    step(1);
    for (let t = 1; t < grace - 1; t++) step(1);
    expect(phases.phaseOf(a.entity)).toBe(p.id);
    zone.patch(a.entity, { pos: [50, 0, 0] });
    step(1);
    step(grace);
    expect(phases.phaseOf(a.entity)).toBe(p.id);
    // just beyond the radius, within the margin, counts as inside
    zone.patch(a.entity, { pos: [100 * (1 + (PHASE_VOLUME_HYSTERESIS - 1) / 2), 0, 0] });
    step(1);
    step(grace);
    expect(phases.phaseOf(a.entity)).toBe(p.id);
    // out for the whole grace
    zone.patch(a.entity, { pos: [0, 0, -400] });
    step(1);
    step(grace - 0.5);
    expect(phases.phaseOf(a.entity)).toBe(p.id);
    step(0.6);
    expect(phases.phaseOf(a.entity)).toBeNull();
    expect([...p.members]).toEqual([b.entity]);
    // the last member walking away closes it
    zone.patch(b.entity, { pos: [0, 300, 0] });
    step(1);
    step(grace);
    expect(p.open).toBe(false);
    expect(phases.count).toBe(0);
  });

  it('follows its location’s frame: the volume moves with the Waystation', () => {
    const { zone, phases, player, step } = setup();
    // the Waystation orbits its world, so the inertial position of its origin changes tick to tick; a member that stays
    // at the Waystation stays inside a volume set in its frame
    const a = player([10, 0, 0]);
    const p = phases.phaseFor(a.viewer, 'story', { key: 'dock', frame: zone.stationFrame, center: [0, 0, 0], radius: 50 });
    const w0 = zone.toWorld(zone.stationFrame, [0, 0, 0]);
    for (let i = 0; i < 40; i++) step(1);
    const w1 = zone.toWorld(zone.stationFrame, [0, 0, 0]);
    expect(Math.hypot(w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2])).toBeGreaterThan(1000);
    expect(phases.phaseOf(a.entity)).toBe(p.id);
  });

  it('refuses unknown kinds, bad locations and sessions not in the zone', () => {
    const { phases, player, place, station } = setup();
    const a = player();
    expect(() => phases.phaseFor(a.viewer, 'dungeon' as 'story', place('x'))).toThrow(/unknown phase kind/);
    expect(() => phases.phaseFor(a.viewer, 'story', { ...place('x'), key: '' })).toThrow(RangeError);
    expect(() => phases.phaseFor(a.viewer, 'story', { ...place('x'), key: 'k'.repeat(129) })).toThrow(RangeError);
    expect(() => phases.phaseFor(a.viewer, 'story', { ...place('x'), frame: '1:0' })).toThrow(/frame/);
    expect(() => phases.phaseFor(a.viewer, 'story', { key: 'x', frame: station, center: [0, NaN, 0], radius: 5 })).toThrow(/centre/);
    expect(() => phases.phaseFor(a.viewer, 'story', { ...place('x'), radius: 0 })).toThrow(/radius/);
    expect(() => phases.phaseFor(a.viewer, 'story', { ...place('x'), radius: Infinity })).toThrow(/radius/);
    expect(() => phases.phaseFor(new Viewer(99), 'story', place('x'))).toThrow(/not in zone/);
    expect(phases.leave(new Viewer(99))).toBe(false);
    expect(phases.count).toBe(0);
  });

  it('keeps its own copy of the location', () => {
    const { phases, player, place } = setup();
    const loc = place('site');
    const p = phases.phaseFor(player().viewer, 'story', loc);
    loc.center[0] = 999;
    loc.radius = 1;
    expect(p.location).toMatchObject({ center: [0, 0, 0], radius: 200 });
    expect(Object.isFrozen(p.location)).toBe(true);
  });
});
