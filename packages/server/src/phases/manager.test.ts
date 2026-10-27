// Phase placement: caps per kind, reuse of a player's own and a party member's phase (the party it was placed under, or
// its tag), overflow into a new phase, a disconnected member's kept place, closing (when the last member leaves, goes
// elsewhere, leaves the zone, stays outside or away past the grace, or on demand), and entering one phase by name under
// the same caps and party rule (a call for aid's answer).
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type EntityInit, type ZoneLog, type ZoneViewer } from '../zones/zone.ts';
import { PHASE_KINDS, PHASE_VOLUME_HYSTERESIS } from './kinds.ts';
import type { PhaseLocation } from './manager.ts';

class Viewer implements ZoneViewer {
  constructor(
    readonly id: number,
    readonly characterId: string | null = null,
  ) {}
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
  /** a session joined at `pos` in the Waystation's frame, in `party`, playing `character` */
  const player = (pos: [number, number, number] = [0, 0, 0], party: string | null = null, character: string | null = null) => {
    const viewer = new Viewer(nextViewer++, character);
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
    // and the party's own members still get in alongside the player placed under its party
    const f = player([0, 0, 0], 'p1');
    expect(phases.phaseFor(f.viewer, 'story', place('site'))).toBe(pa);
  });

  it('keeps the party a player was placed under: players placed under one party share its story phase with its members', () => {
    const { phases, player, place } = setup();
    // two players with no party tag, placed under one party (a quest's), then a member tagged with it
    const u1 = player();
    const u2 = player();
    const p = phases.phaseFor(u1.viewer, 'story', place('step'), 'questParty');
    expect(phases.phaseFor(u2.viewer, 'story', place('step'), 'questParty')).toBe(p);
    const tagged = player([0, 0, 0], 'questParty');
    expect(phases.phaseFor(tagged.viewer, 'story', place('step'))).toBe(p);
    expect(p.members.size).toBe(3);
    // asking again with no party keeps the party it was placed under; a player of no party still gets a phase of its own
    expect(phases.phaseFor(u1.viewer, 'story', place('step'))).toBe(p);
    expect(phases.phaseFor(player().viewer, 'story', place('step'))).not.toBe(p);
    expect(phases.phaseFor(player([0, 0, 0], 'questParty').viewer, 'story', place('step'))).toBe(p);
    // a tagged player placed under another party goes by that party
    const elsewhere = phases.phaseFor(player([0, 0, 0], 'questParty').viewer, 'story', place('step'), 'otherParty');
    expect(elsewhere).not.toBe(p);
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
    // the newer bay fuller than the older: arrivals go to the newer
    for (let i = 0; i < 5; i++) phases.phaseFor(player().viewer, 'bay', hangar);
    for (const p of crowd.slice(4)) phases.leave(p.viewer);
    expect([first.members.size, second.members.size]).toEqual([4, 7]);
    expect(phases.phaseFor(player().viewer, 'bay', hangar)).toBe(second);
    expect(second.members.size).toBe(8);
  });

  it('never places anyone in a closed phase', () => {
    const { phases, player, place } = setup();
    const x = player();
    const bay = phases.phaseFor(x.viewer, 'bay', place('hangar'));
    phases.close(bay.id);
    const nextBay = phases.phaseFor(player().viewer, 'bay', place('hangar'));
    expect(nextBay).not.toBe(bay);
    expect(nextBay.open).toBe(true);
    expect(bay.members.size).toBe(0);
    // a story phase emptied by its party's last member: the party's next member gets a new one
    const m1 = player([0, 0, 0], 'P');
    const story = phases.phaseFor(m1.viewer, 'story', place('site'));
    phases.leave(m1.viewer);
    expect(story.open).toBe(false);
    const again = phases.phaseFor(player([0, 0, 0], 'P').viewer, 'story', place('site'));
    expect(again).not.toBe(story);
    expect(again.open).toBe(true);
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

describe('a dropped connection', () => {
  it('keeps the member’s place for the grace, and its character finds it again through phaseFor', () => {
    const { zone, phases, player, place, init, step } = setup();
    const a = player([0, 0, 0], null, 'char-a');
    const p = phases.phaseFor(a.viewer, 'story', place('site'));
    const actor = phases.spawn(p.id, init([10, 0, 0], { kind: 'npc', mode: undefined, name: 'Echo' }));
    step();
    expect(zone.leave(a.viewer, 'disconnected')).toBe(true);
    expect(zone.entity(a.entity)).toBeUndefined();
    expect(p.open).toBe(true);
    expect([...p.members]).toEqual([]);
    expect([...p.held]).toEqual(['char-a']);
    expect(zone.entity(actor)).toBeDefined();
    step(PHASE_KINDS.story.graceS - 1);
    expect(p.open).toBe(true);

    // the character reconnects as a new session with a new entity
    const back = player([0, 0, 0], null, 'char-a');
    expect(phases.phaseFor(back.viewer, 'story', place('site'))).toBe(p);
    expect([...p.members]).toEqual([back.entity]);
    expect(p.held.size).toBe(0);
    step(PHASE_KINDS.story.graceS);
    expect(p.open && phases.phaseOf(back.entity) === p.id && zone.entity(actor) !== undefined).toBe(true);
  });

  it('gives the place up once the grace runs out, closing the phase if nothing else keeps it open', () => {
    const { zone, phases, player, place, init, step } = setup();
    const grace = PHASE_KINDS.raid.graceS;
    const a = player([0, 0, 0], null, 'char-a');
    const b = player([0, 0, 0], null, 'char-b');
    const p = phases.phaseFor(a.viewer, 'raid', place('vault'));
    phases.phaseFor(b.viewer, 'raid', place('vault'));
    const boss = phases.spawn(p.id, init([10, 0, 0], { kind: 'mob', mode: 'idle' }));
    step();
    zone.leave(a.viewer, 'disconnected');
    step(1);
    step(grace - 1.5);
    expect(p.held.has('char-a')).toBe(true);
    step(0.6);
    expect(p.held.size).toBe(0);
    expect(p.open).toBe(true);
    // the last member drops too; nobody comes back
    zone.leave(b.viewer, 'disconnected');
    step(1);
    expect(p.open).toBe(true);
    step(grace);
    expect(p.open).toBe(false);
    expect(zone.entity(boss)).toBeUndefined();
    // a character coming back after that gets a new phase
    const late = player([0, 0, 0], null, 'char-b');
    expect(phases.phaseFor(late.viewer, 'raid', place('vault'))).not.toBe(p);
  });

  it('counts a kept place towards the cap and the party', () => {
    const { zone, phases, player, place } = setup();
    const hangar = place('hangar');
    const crowd = Array.from({ length: 24 }, (_, i) => player([0, 0, 0], null, `c${i}`));
    for (const p of crowd) phases.phaseFor(p.viewer, 'bay', hangar);
    const first = phases.phase(phases.phaseOf(crowd[0]!.entity)!)!;
    zone.leave(crowd[0]!.viewer, 'disconnected');
    expect([first.members.size, first.held.size]).toEqual([23, 1]);
    expect(phases.phaseFor(player().viewer, 'bay', hangar)).not.toBe(first);

    // a story phase whose only member dropped is still its party's
    const m = player([0, 0, 0], 'P', 'char-m');
    const story = phases.phaseFor(m.viewer, 'story', place('site'));
    zone.leave(m.viewer, 'disconnected');
    expect(phases.phaseFor(player([0, 0, 0], 'Q').viewer, 'story', place('site'))).not.toBe(story);
    const mate = player([0, 0, 0], 'P');
    expect(phases.phaseFor(mate.viewer, 'story', place('site'))).toBe(story);
    // back under its party (the party service tags its new entity as it joins), it takes its place again
    const back = player([0, 0, 0], 'P', 'char-m');
    expect(phases.phaseFor(back.viewer, 'story', place('site'))).toBe(story);
    expect(phases.phaseFor(player([0, 0, 0], 'P').viewer, 'story', place('site'))).toBe(story);
    expect(story.members.size).toBe(3);
  });

  it('gives a kept place up when its character comes back in no party, or in another', () => {
    const { zone, phases, player, place } = setup();
    const site = place('site');
    const m = player([0, 0, 0], 'P', 'char-m');
    const mate = player([0, 0, 0], 'P');
    const story = phases.phaseFor(m.viewer, 'story', site);
    expect(phases.phaseFor(mate.viewer, 'story', site)).toBe(story);
    // it dropped, and left (or was kicked from) the party meanwhile: back with no tag, it is placed afresh
    zone.leave(m.viewer, 'disconnected');
    expect(story.held.has('char-m')).toBe(true);
    const alone = player([0, 0, 0], null, 'char-m');
    const fresh = phases.phaseFor(alone.viewer, 'story', site);
    expect(fresh).not.toBe(story);
    expect([story.held.size, [...story.members]]).toEqual([0, [mate.entity]]);
    // in another party, likewise; and under an explicit partyId that is not the kept one
    zone.leave(alone.viewer, 'disconnected');
    expect(phases.phaseFor(player([0, 0, 0], 'Q', 'char-m').viewer, 'story', site)).not.toBe(fresh);
    const r = player([0, 0, 0], 'P', 'char-r');
    const kept = phases.phaseFor(r.viewer, 'raid', place('vault'));
    zone.leave(r.viewer, 'disconnected');
    expect(phases.phaseFor(player([0, 0, 0], 'P', 'char-r').viewer, 'raid', place('vault'), 'Q')).not.toBe(kept);
  });

  it('is the only way out that keeps a place: leaving otherwise, or with no character, goes at once', () => {
    const { zone, phases, player, place, init } = setup();
    // a handoff or a logout
    const a = player([0, 0, 0], null, 'char-a');
    const pa = phases.phaseFor(a.viewer, 'story', place('site'));
    const actor = phases.spawn(pa.id, init([5, 0, 0], { kind: 'npc', mode: undefined }));
    zone.leave(a.viewer);
    expect(pa.open).toBe(false);
    expect(zone.entity(actor)).toBeUndefined();
    // its entity despawned
    const b = player([0, 0, 0], null, 'char-b');
    const pb = phases.phaseFor(b.viewer, 'story', place('site'));
    zone.despawn(b.entity);
    expect(pb.open).toBe(false);
    // a session with no character
    const c = player();
    const pc = phases.phaseFor(c.viewer, 'story', place('site'));
    zone.leave(c.viewer, 'disconnected');
    expect(pc.open).toBe(false);
    // a session in no phase
    const d = player([0, 0, 0], null, 'char-d');
    zone.leave(d.viewer, 'disconnected');
    expect(phases.count).toBe(0);
  });

  it('gives a kept place up when its character is placed elsewhere or leaves', () => {
    const { zone, phases, player, place } = setup();
    const a = player([0, 0, 0], null, 'char-a');
    const story = phases.phaseFor(a.viewer, 'story', place('site'));
    zone.leave(a.viewer, 'disconnected');
    const back = player([0, 0, 0], null, 'char-a');
    const bay = phases.phaseFor(back.viewer, 'bay', place('hangar'));
    expect(story.open).toBe(false);
    expect(phases.phaseOf(back.entity)).toBe(bay.id);

    const b = player([0, 0, 0], null, 'char-b');
    const event = phases.phaseFor(b.viewer, 'event', place('site'));
    zone.leave(b.viewer, 'disconnected');
    const bBack = player([0, 0, 0], null, 'char-b');
    expect(phases.leave(bBack.viewer)).toBe(true);
    expect(event.open).toBe(false);
    expect(phases.leave(bBack.viewer)).toBe(false);
  });

  it('never extends the grace: six drop, reconnect and re-place cycles outside a bay still end it 15 s after leaving', () => {
    const { zone, phases, player, place, step } = setup();
    const grace = PHASE_KINDS.bay.graceS;
    const hangar = place('hangar');
    // 3 km out of a 200 m hangar, and staying there
    let a = player([3000, 0, 0], null, 'char-a');
    const bay = phases.phaseFor(a.viewer, 'bay', hangar);
    step();
    const leftAt = zone.time;
    let closedAt: number | null = null;
    for (let s = 1; s <= 90; s++) {
      step(1);
      if (closedAt === null && !bay.open) closedAt = zone.time;
      // a cycle every 15 s, inside the grace: the connection drops, the character comes back, and is placed again
      if (s % 15 === 14) {
        zone.leave(a.viewer, 'disconnected');
        a = player([3000, 0, 0], null, 'char-a');
        phases.phaseFor(a.viewer, 'bay', hangar);
      }
    }
    expect(closedAt).not.toBeNull();
    expect(closedAt! - leftAt).toBeLessThanOrEqual(grace + 1);
  });

  it('keeps the place of a member outside the volume only for what is left of its grace', () => {
    const { zone, phases, player, place, step } = setup();
    const grace = PHASE_KINDS.story.graceS;
    const a = player([0, 0, 0], null, 'char-a');
    const p = phases.phaseFor(a.viewer, 'story', place('site'));
    step();
    zone.patch(a.entity, { pos: [0, 900, 0] });
    // first seen outside at this tick; 10 s later its connection drops: 5 s of its grace are left, not 15
    step(1);
    step(10);
    zone.leave(a.viewer, 'disconnected');
    step(grace - 10.5);
    expect(p.held.has('char-a')).toBe(true);
    step(0.6);
    expect(p.open).toBe(false);
  });

  it('never lets a story phase hold two parties, whether re-asked under a new party or coming back under one', () => {
    const { zone, phases, player, place } = setup();
    const a = player([0, 0, 0], 'P', 'char-a');
    const b = player([0, 0, 0], 'P', 'char-b');
    const p = phases.phaseFor(a.viewer, 'story', place('site'));
    expect(phases.phaseFor(b.viewer, 'story', place('site'))).toBe(p);
    // re-asked under another party, b goes to a phase of its own
    const q = phases.phaseFor(b.viewer, 'story', place('site'), 'Q');
    expect(q).not.toBe(p);
    expect([...p.members]).toEqual([a.entity]);
    // alone in its phase, it may change party there
    expect(phases.phaseFor(b.viewer, 'story', place('site'), 'R')).toBe(q);
    expect(phases.phaseFor(player([0, 0, 0], 'R').viewer, 'story', place('site'))).toBe(q);

    // c, of P, drops from p; it comes back tagged Q: not into p, whose others are P, and its kept place there goes
    const c = player([0, 0, 0], 'P', 'char-c');
    expect(phases.phaseFor(c.viewer, 'story', place('site'))).toBe(p);
    zone.leave(c.viewer, 'disconnected');
    expect(p.held.has('char-c')).toBe(true);
    const back = player([0, 0, 0], 'Q', 'char-c');
    expect(phases.phaseFor(back.viewer, 'story', place('site'))).not.toBe(p);
    expect(p.held.size).toBe(0);
    expect([...p.members]).toEqual([a.entity]);
    // under its old party, it would have gone back
    zone.leave(a.viewer, 'disconnected');
    const aBack = player([0, 0, 0], null, 'char-a');
    expect(phases.phaseFor(aBack.viewer, 'story', place('site'), 'P')).toBe(p);
  });
});

describe('entering a phase by name (a call for aid’s answer)', () => {
  it('puts a player in that phase rather than the one phaseFor would pick, and refuses it at the cap or once closed', () => {
    const { phases, player, place, step } = setup();
    const wreck = place('wreck');
    const crowd = Array.from({ length: 13 }, () => player());
    const instances = crowd.map((p) => phases.phaseFor(p.viewer, 'event', wreck));
    const first = instances[0]!;
    const second = instances[12]!;
    expect([first.members.size, second.members.size]).toEqual([12, 1]);
    const a = player();
    expect(phases.enter(a.viewer, first.id)).toBe('full');
    expect(phases.phaseOf(a.entity)).toBeNull();
    // two leave the first: phaseFor would put a newcomer there (the fullest with room); entering names the second
    phases.leave(crowd[0]!.viewer);
    phases.leave(crowd[1]!.viewer);
    expect(phases.enter(a.viewer, second.id)).toBe(second);
    expect([...second.members]).toEqual([crowd[12]!.entity, a.entity]);
    // its entity has not moved: still inside the volume, and in the phase, after the next tick
    step();
    expect(phases.phaseOf(a.entity)).toBe(second.id);
    phases.close(second.id);
    expect(phases.enter(a.viewer, second.id)).toBe('closed');
    expect(phases.enter(a.viewer, 999)).toBe('closed');
    expect(phases.phaseOf(a.entity)).toBeNull();
    expect(() => phases.enter(new Viewer(99), first.id)).toThrow(/not in zone/);
  });

  it('keeps a story phase to one party: another party, or none, is refused; its party enters under it', () => {
    const { phases, player, place } = setup();
    const a = player([0, 0, 0], 'P');
    const story = phases.phaseFor(a.viewer, 'story', place('site'));
    expect(phases.enter(player([0, 0, 0], 'Q').viewer, story.id)).toBe('full');
    expect(phases.enter(player().viewer, story.id)).toBe('full');
    const b = player([0, 0, 0], 'P');
    expect(phases.enter(b.viewer, story.id)).toBe(story);
    // placed under a party given, which it keeps
    const u = player();
    expect(phases.enter(u.viewer, story.id, 'P')).toBe(story);
    expect([...story.members]).toEqual([a.entity, b.entity, u.entity]);
    expect(phases.phaseFor(player([0, 0, 0], 'P').viewer, 'story', place('site'))).toBe(story);
  });

  it('re-places a member under a party when the phase’s others are all of it, and refuses (changing nothing) when not', () => {
    const { phases, player, place } = setup();
    const a = player();
    // a party of one, as the quest runtime places a player in no party
    const story = phases.phaseFor(a.viewer, 'story', place('site'), null);
    expect(phases.enter(player([0, 0, 0], 'P').viewer, story.id)).toBe('full');
    expect(phases.enter(a.viewer, story.id, 'P')).toBe(story);
    const b = player([0, 0, 0], 'P');
    expect(phases.enter(b.viewer, story.id)).toBe(story);
    expect(phases.enter(b.viewer, story.id, 'Q')).toBe('full');
    expect(phases.phaseOf(b.entity)).toBe(story.id);
    expect(phases.enter(b.viewer, story.id)).toBe(story);
    expect(phases.enter(player([0, 0, 0], 'P').viewer, story.id)).toBe(story);
    expect(story.members.size).toBe(3);
  });

  it('takes a player out of its old phase, gives up a place kept elsewhere, and takes back one kept in that phase', () => {
    const { zone, phases, player, place } = setup();
    const event = phases.phaseFor(player().viewer, 'event', place('wreck'));
    const a = player();
    const old = phases.phaseFor(a.viewer, 'story', place('site'));
    expect(phases.enter(a.viewer, event.id)).toBe(event);
    expect(old.open).toBe(false);

    const c = player([0, 0, 0], null, 'char-c');
    const raid = phases.phaseFor(c.viewer, 'raid', place('vault'));
    zone.leave(c.viewer, 'disconnected');
    expect(raid.held.has('char-c')).toBe(true);
    expect(phases.enter(player([0, 0, 0], null, 'char-c').viewer, event.id)).toBe(event);
    expect(raid.open).toBe(false);

    // the event full with a place kept for d: d, back, takes its place (it counts towards the cap already)
    const d = player([0, 0, 0], null, 'char-d');
    expect(phases.enter(d.viewer, event.id)).toBe(event);
    while (event.members.size < 12) phases.phaseFor(player().viewer, 'event', place('wreck'));
    zone.leave(d.viewer, 'disconnected');
    expect([event.members.size, event.held.size]).toEqual([11, 1]);
    expect(phases.enter(player().viewer, event.id)).toBe('full');
    const dBack = player([0, 0, 0], null, 'char-d');
    expect(phases.enter(dBack.viewer, event.id)).toBe(event);
    expect([event.members.size, event.held.size]).toEqual([12, 0]);

    // a story place kept under one party, come back to under another, is given up as phaseFor gives it up
    const m = player([0, 0, 0], 'P', 'char-m');
    const story = phases.phaseFor(m.viewer, 'story', place('chapter'));
    phases.phaseFor(player([0, 0, 0], 'P').viewer, 'story', place('chapter'));
    zone.leave(m.viewer, 'disconnected');
    expect(phases.enter(player([0, 0, 0], 'Q', 'char-m').viewer, story.id)).toBe('full');
    expect(story.held.size).toBe(0);
  });
});
