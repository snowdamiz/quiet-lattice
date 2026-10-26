// Cutscenes always play in a story phase: the player who asks is placed in one at its place, the cutscene's actors are
// spawned into it once (a party member asking there shares it), only its members see them, and the last one out closes
// it with its actors. Unknown cutscenes, a second one while one plays, and sessions in no zone are refused.
import { encodeServerMessage, type FrameId } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { CUTSCENES, type CutsceneEntry } from './catalog.ts';
import { CutsceneService, rotate } from './service.ts';

class Viewer implements ZoneViewer {
  constructor(readonly id: number) {}
  sendBinary(): void {}
}

function setup(catalog: Record<string, CutsceneEntry> = { ...CUTSCENES }) {
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0) });
  const viewers = new Map<ZoneViewer, Zone>();
  const service = new CutsceneService({ zoneOf: (v) => viewers.get(v) }, catalog);
  let next = 1;
  let time = 2.3e7;
  const step = () => zone.step((time += 0.05));
  /** a player at `pos` in the Waystation's frame, facing `quat` */
  const player = (pos: [number, number, number] = [30, 45, 480], party: string | null = null, quat: [number, number, number, number] = [0, 0, 0, 1]) => {
    const viewer = new Viewer(next++);
    const frame: FrameId = zone.stationFrame;
    const entity = zone.join(viewer, { kind: 'player', frame, pos, quat, vel: [0, 0, 0], mode: 'ship', party });
    viewers.set(viewer, zone);
    return { viewer, entity };
  };
  const actors = (phase: number) => [...(zone.phases.phase(phase)?.entities ?? [])];
  return { zone, service, player, actors, step };
}

describe('rotate', () => {
  it('turns a vector by a unit quaternion', () => {
    const s = Math.SQRT1_2;
    // a quarter turn about +y takes -z (ahead) to -x
    const v = rotate([0, s, 0, s], [0, 0, -1]);
    expect(v[0]).toBeCloseTo(-1, 12);
    expect(v[1]).toBeCloseTo(0, 12);
    expect(v[2]).toBeCloseTo(0, 12);
    expect(rotate([0, 0, 0, 1], [1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('cutscene service', () => {
  it('plays a cutscene in a story phase at the player, with its actors seen only by the phase', () => {
    const { zone, service, player, actors, step } = setup();
    const a = player();
    const b = player([34, 45, 482]);
    const r = service.start(a.viewer, 'test');
    expect(r).toMatchObject({ t: 'cutscene', op: 'play', id: 'test' });
    expect(() => encodeServerMessage(r)).not.toThrow();
    const phase = zone.phases.phase(r.phase!)!;
    expect(phase).toMatchObject({
      kind: 'story',
      location: { key: 'cutscene:test', frame: zone.stationFrame, center: [30, 45, 480], radius: CUTSCENES.test!.radius },
    });
    expect(zone.phases.phaseOf(a.entity)).toBe(r.phase);
    expect(zone.phases.phaseOf(b.entity)).toBeNull();
    expect(service.playingOf(a.viewer)).toEqual({ id: 'test', phase: r.phase });

    // its actor, placed relative to the player and turned with it, seen by the phase alone
    const [tug] = actors(r.phase!);
    expect(tug).toBeDefined();
    const fields = zone.entity(tug!)!.fields;
    expect(fields).toMatchObject({ kind: 'ship', name: 'Waystation tug', hull: 'mule', frame: zone.stationFrame });
    const offset = CUTSCENES.test!.actors[0]!.offset;
    expect(fields.pos).toEqual([30 + offset[0], 45 + offset[1], 480 + offset[2]]);
    step();
    expect(zone.interestOf(a.viewer).has(tug!)).toBe(true);
    expect(zone.interestOf(b.viewer).has(tug!)).toBe(false);
    // a story phase hides only its actors: the two players still see each other
    expect(zone.interestOf(b.viewer).has(a.entity) && zone.interestOf(a.viewer).has(b.entity)).toBe(true);

    // asked again, the same phase; ended, the player is back in the shared world and the phase closes with its actor
    expect(service.start(a.viewer, 'test')).toEqual(r);
    expect(actors(r.phase!)).toEqual([tug]);
    expect(service.end(a.viewer, 'test')).toEqual({ t: 'cutscene', op: 'ended', id: 'test', phase: r.phase });
    expect(zone.phases.phaseOf(a.entity)).toBeNull();
    expect(phase.open).toBe(false);
    expect(zone.entity(tug!)).toBeUndefined();
    expect(service.playingOf(a.viewer)).toBeNull();
    // (an end for nothing playing changes nothing)
    expect(service.end(a.viewer, 'test')).toEqual({ t: 'cutscene', op: 'ended', id: 'test', phase: null });
  });

  it('turns its actors with the player who started it', () => {
    const { zone, service, player, actors } = setup();
    const s = Math.SQRT1_2;
    // facing -x: a quarter turn about +y
    const a = player([0, 0, 0], null, [0, s, 0, s]);
    const r = service.start(a.viewer, 'test');
    const [tug] = actors(r.phase!);
    const [ox, oy, oz] = CUTSCENES.test!.actors[0]!.offset;
    const pos = zone.entity(tug!)!.fields.pos;
    // ahead (-z) becomes -x, right (+x) becomes -z
    expect(pos[0]).toBeCloseTo(oz, 9);
    expect(pos[1]).toBeCloseTo(oy, 9);
    expect(pos[2]).toBeCloseTo(-ox, 9);
  });

  it('shares one phase, and one set of actors, with a party member watching it there; others get their own', () => {
    const { zone, service, player, actors } = setup();
    const a = player(undefined, 'crew');
    const c = player([31, 45, 480], 'crew');
    const d = player([32, 45, 480]);
    const ra = service.start(a.viewer, 'test');
    const rc = service.start(c.viewer, 'test');
    const rd = service.start(d.viewer, 'test');
    expect(rc.phase).toBe(ra.phase);
    expect(rd.phase).not.toBe(ra.phase);
    expect(actors(ra.phase!)).toHaveLength(CUTSCENES.test!.actors.length);
    expect(actors(rd.phase!)).toHaveLength(CUTSCENES.test!.actors.length);
    // the first to finish leaves; the phase stays for the other until it finishes too
    service.end(a.viewer, 'test');
    expect(zone.phases.phase(ra.phase!)?.open).toBe(true);
    const tug = actors(ra.phase!)[0]!;
    service.end(c.viewer, 'test');
    expect(zone.phases.phase(ra.phase!)).toBeUndefined();
    expect(zone.entity(tug)).toBeUndefined();
  });

  it('refuses an unknown cutscene, a second one while one plays, and a session in no zone; answers messages', () => {
    const { service, player } = setup({ ...CUTSCENES, other: { radius: 100, actors: [] } });
    const a = player();
    expect(service.start(a.viewer, 'nope')).toEqual({ t: 'cutscene', op: 'refused', id: 'nope', phase: null, reason: 'unknown' });
    // (an id that is a property of every object is still unknown)
    expect(service.start(a.viewer, 'constructor')).toMatchObject({ op: 'refused', reason: 'unknown' });
    expect(service.start(new Viewer(99), 'test')).toMatchObject({ op: 'refused', reason: 'zone' });

    const play = service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' });
    expect(play.op).toBe('play');
    const busy = service.start(a.viewer, 'other');
    expect(busy).toMatchObject({ op: 'refused', reason: 'busy' });
    for (const m of [play, busy]) expect(() => encodeServerMessage(m)).not.toThrow();
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'done', id: 'test', skipped: true })).toMatchObject({ op: 'ended', phase: play.phase });
    // over, another may play
    expect(service.start(a.viewer, 'other').op).toBe('play');
  });

  it('forgets a session that left its zone', () => {
    const { service, player } = setup();
    const a = player();
    service.start(a.viewer, 'test');
    service.forget(a.viewer);
    expect(service.playingOf(a.viewer)).toBeNull();
  });
});
