// What phases let a session see, as its snapshots show it: a phase's own entities reach only its members; a story
// phase's members stay in sight of everyone; inside a bay's volume its members and every other layer's players are hidden
// from each other (the shared world's entities other than players stay in sight); outside the volume it is the shared
// world again.
import { describe, expect, it } from 'vitest';
import { SnapshotClient } from '../../test/snapshotClient.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type EntityInit, type ZoneViewer } from '../zones/zone.ts';
import { PHASE_KINDS } from './kinds.ts';
import type { PhaseLocation } from './manager.ts';

class Viewer implements ZoneViewer {
  readonly client = new SnapshotClient();
  constructor(readonly id: number) {}
  sendBinary(data: Uint8Array): void {
    this.client.receive(data);
  }
  /** what it holds now */
  get sees(): Set<number> {
    return new Set(this.client.latest.keys());
  }
  /** whether any snapshot it was ever sent carried entity `id` */
  everSent(id: number): boolean {
    return this.client.snapshots.some((s) => s.entities.some((e) => e.id === id));
  }
}

function setup() {
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0) });
  const station = zone.stationFrame;
  const init = (pos: [number, number, number], extra: Partial<EntityInit> = {}): EntityInit => ({
    kind: 'player',
    frame: station,
    pos,
    quat: [0, 0, 0, 1],
    vel: [0, 0, 0],
    mode: 'foot',
    ...extra,
  });
  const viewers: Viewer[] = [];
  const player = (pos: [number, number, number] = [0, 0, 0], party: string | null = null) => {
    const viewer = new Viewer(viewers.length + 1);
    viewers.push(viewer);
    return { viewer, entity: zone.join(viewer, init(pos, { party })) };
  };
  const npc = (pos: [number, number, number]) => init(pos, { kind: 'npc', mode: undefined, name: 'Dockhand' });
  const place = (key: string, radius = 200): PhaseLocation => ({ key, frame: station, center: [0, 0, 0], radius });
  let time = 2.3e7;
  /** a tick, every session acknowledging it */
  const step = (dt = 0.05) => {
    zone.step((time += dt));
    for (const v of viewers) zone.ack(v, zone.tick);
  };
  return { zone, phases: zone.phases, player, npc, place, step };
}

describe('phase visibility', () => {
  it('leaves interest sets alone while nothing is in a phase', () => {
    const { phases, player } = setup();
    const a = player();
    expect(phases.visibleTo(a.entity)).toBeNull();
  });

  it('sends a phase’s own entities to its members only; story members still see each other and the shared world', () => {
    const { zone, phases, player, npc, place, step } = setup();
    const a = player([0, 0, 0]);
    const b = player([3, 0, 0]);
    const passerby = player([-3, 0, 0]);
    const dockhand = zone.spawn(npc([5, 0, 0]));
    const pa = phases.phaseFor(a.viewer, 'story', place('site'));
    const pb = phases.phaseFor(b.viewer, 'story', place('site'));
    expect(pa).not.toBe(pb);
    const actorA = phases.spawn(pa.id, npc([10, 0, 0]));
    const actorB = phases.spawn(pb.id, npc([10, 0, 1]));
    for (let i = 0; i < 5; i++) step();

    expect(a.viewer.sees).toEqual(new Set([a.entity, b.entity, passerby.entity, dockhand, actorA]));
    expect(b.viewer.sees).toEqual(new Set([a.entity, b.entity, passerby.entity, dockhand, actorB]));
    expect(passerby.viewer.sees).toEqual(new Set([a.entity, b.entity, passerby.entity, dockhand]));
    expect(a.viewer.everSent(actorB) || b.viewer.everSent(actorA)).toBe(false);
    expect(passerby.viewer.everSent(actorA) || passerby.viewer.everSent(actorB)).toBe(false);
    expect(phases.canSee(a.entity, actorB)).toBe(false);
    expect(phases.canSee(a.entity, actorA)).toBe(true);

    // a goes back to the shared world: its phase closes, and its actor is removed from what it holds
    phases.leave(a.viewer);
    step();
    expect(a.viewer.sees).toEqual(new Set([a.entity, b.entity, passerby.entity, dockhand]));
    expect(a.viewer.client.snapshots.at(-1)!.removed).toContain(actorA);
    // b's actor is still b's alone
    expect(b.viewer.sees.has(actorB)).toBe(true);
  });

  it('shows a party its shared phase’s entities, and not another party’s', () => {
    const { phases, player, npc, place, step } = setup();
    const a = player([0, 0, 0], 'p1');
    const b = player([1, 0, 0], 'p1');
    const c = player([2, 0, 0], 'p2');
    const p = phases.phaseFor(a.viewer, 'story', place('site'));
    expect(phases.phaseFor(b.viewer, 'story', place('site'))).toBe(p);
    const q = phases.phaseFor(c.viewer, 'story', place('site'));
    const boss = phases.spawn(p.id, npc([30, 0, 0]));
    const other = phases.spawn(q.id, npc([30, 0, 0]));
    for (let i = 0; i < 3; i++) step();
    expect(a.viewer.sees.has(boss) && b.viewer.sees.has(boss)).toBe(true);
    expect(a.viewer.sees.has(other) || b.viewer.sees.has(other) || c.viewer.sees.has(boss)).toBe(false);
    expect(c.viewer.sees.has(other)).toBe(true);
  });

  it('hides the players of other layers inside a bay’s volume, both ways, but not the shared world’s other entities', () => {
    const { zone, phases, player, npc, place, step } = setup();
    const hangar = place('hangar', 200);
    // a full first bay, and one player in a second bay at the same spot
    const bay1 = Array.from({ length: PHASE_KINDS.bay.cap.players }, (_, i) => player([i, 0, 0]));
    for (const p of bay1) phases.phaseFor(p.viewer, 'bay', hangar);
    const x = player([5, 0, 1]);
    const second = phases.phaseFor(x.viewer, 'bay', hangar);
    const a = bay1[0]!;
    expect(phases.phaseOf(a.entity)).not.toBe(second.id);
    // a player outside the hangar, in the shared world, and a dockhand inside it, also in the shared world
    const outside = player([0, 0, 1200]);
    const dockhand = zone.spawn(npc([0, 0, 20]));
    const padTech = phases.spawn(second.id, npc([5, 0, 5]));
    for (let i = 0; i < 3; i++) step();

    const bay1Ids = bay1.map((p) => p.entity);
    expect(a.viewer.sees).toEqual(new Set([...bay1Ids, dockhand]));
    expect(x.viewer.sees).toEqual(new Set([x.entity, dockhand, padTech]));
    expect(outside.viewer.sees).toEqual(new Set([outside.entity, dockhand]));
    expect(a.viewer.everSent(x.entity) || x.viewer.everSent(a.entity) || outside.viewer.everSent(a.entity) || outside.viewer.everSent(x.entity)).toBe(false);

    // x flies out of the hangar: outside the volume it is in the shared world's sight again, and sees it, while a,
    // inside its bay, still does not; it keeps its bay's own entities until the grace is up
    zone.patch(x.entity, { pos: [0, 0, 1100] });
    step();
    expect(phases.phaseOf(x.entity)).toBe(second.id);
    expect(x.viewer.sees).toEqual(new Set([x.entity, outside.entity, dockhand, padTech]));
    expect(outside.viewer.sees).toEqual(new Set([outside.entity, x.entity, dockhand]));
    expect(a.viewer.sees.has(x.entity)).toBe(false);
    step(PHASE_KINDS.bay.graceS + 0.1);
    expect(phases.phaseOf(x.entity)).toBeNull();
    expect(second.open).toBe(false);
    expect(zone.entity(padTech)).toBeUndefined();
    expect(x.viewer.sees).toEqual(new Set([x.entity, outside.entity, dockhand]));

    // a player of the shared world who wanders into the hangar unplaced is not seen by a bay's members, nor sees them
    zone.patch(outside.entity, { pos: [0, 0, 50] });
    step();
    expect(outside.viewer.sees.has(a.entity) || a.viewer.sees.has(outside.entity)).toBe(false);
    expect(phases.canSee(outside.entity, x.entity)).toBe(true);
  });

  it('lets the phase rule win over the party rule: a party member sealed in another bay is out of sight', () => {
    const { phases, player, place, step } = setup();
    const hangar = place('hangar', 200);
    const crowd = Array.from({ length: PHASE_KINDS.bay.cap.players - 1 }, () => player());
    for (const p of crowd) phases.phaseFor(p.viewer, 'bay', hangar);
    const a = player([0, 0, 0], 'wing');
    const b = player([0, 0, 0], 'wing');
    const pa = phases.phaseFor(a.viewer, 'bay', hangar);
    // b's party member's bay is full now
    const pb = phases.phaseFor(b.viewer, 'bay', hangar);
    expect(pa).not.toBe(pb);
    for (let i = 0; i < 3; i++) step();
    expect(a.viewer.sees.has(b.entity) || b.viewer.sees.has(a.entity)).toBe(false);
    expect(phases.canSee(a.entity, b.entity)).toBe(false);
    // back in the shared world they see each other again
    phases.leave(a.viewer);
    phases.leave(b.viewer);
    step();
    expect(a.viewer.sees.has(b.entity) && b.viewer.sees.has(a.entity)).toBe(true);
  });
});
