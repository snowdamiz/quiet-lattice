// Cutscenes always play in a story phase, and the server decides when: a client's request needs `may` (the quest
// engine's rule; by default only a dev cutscene on a dev server) and is held to a cooldown. The phase is the
// cutscene's place: its frame's origin for one anchored there (the player must be inside the radius), or where the
// player is for one anchored on the player (a party member within the radius shares it, one far away does not). Its
// actors spawn once, at their exported poses in the cutscene's frame, seen only by the phase; the last one out closes
// it with them. A player in another phase is refused, never pulled out; one watching is out of play.
import { encodeServerMessage, type FrameId } from '@astra/shared/protocol';
import { frameId } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { CUTSCENES, loadPlacement, type CutsceneEntry, type CutscenePlacement } from './catalog.ts';
import { COOLDOWN_S, CutsceneService, EXIT_S, multiply, rotate, WATCH_MARGIN_S } from './service.ts';

class Viewer implements ZoneViewer {
  /** the control messages the server pushed it */
  readonly pushed: unknown[] = [];
  readonly characterId: string;
  constructor(readonly id: number) {
    this.characterId = `character-${id}`;
  }
  sendBinary(): void {}
  send(m: unknown): void {
    this.pushed.push(m);
  }
}

type V3 = [number, number, number];
type Q = [number, number, number, number];

/** A player-anchored cutscene in the player's own frame, with one actor 10 m ahead and 2 m up. */
const AROUND: CutscenePlacement = {
  format: 'astra.cutscene.place',
  version: 1,
  id: 'around',
  source: 'test',
  space: { frame: 'player', anchor: 'player' },
  duration: 8,
  radius: 500,
  actors: [{ id: 'echo', kind: 'npc', name: 'Echo', pos: [0, 2, -10], quat: [0, 0, 0, 1] }],
};

function setup({ dev = true, catalog = { ...CUTSCENES } as Record<string, CutsceneEntry> } = {}) {
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0) });
  const viewers = new Map<ZoneViewer, Zone>();
  let clock = 1000;
  const service = new CutsceneService({ zones: { zoneOf: (v) => viewers.get(v) }, catalog, dev, now: () => clock });
  let next = 1;
  let time = 2.3e7;
  const step = (dt = 0.05) => zone.step((time += dt));
  const station = zone.stationFrame;
  /** a player at `pos` in `frame` (the Waystation's by default), in `party`, facing `quat`; stepped so the zone knows
   * where it is */
  const player = (pos: V3 = [30, 45, 480], party: string | null = null, quat: Q = [0, 0, 0, 1], frame: FrameId = station) => {
    const viewer = new Viewer(next++);
    const entity = zone.join(viewer, { kind: 'player', frame, pos, quat, vel: [0, 0, 0], mode: 'ship', party });
    viewers.set(viewer, zone);
    step();
    return { viewer, entity };
  };
  const actors = (phase: number) => [...(zone.phases.phase(phase)?.entities ?? [])];
  const advance = (s: number) => (clock += s);
  return { zone, service, player, actors, step, station, advance };
}

describe('quaternions', () => {
  it('turn a vector, and compose', () => {
    const s = Math.SQRT1_2;
    // a quarter turn about +y takes -z (ahead) to -x
    const v = rotate([0, s, 0, s], [0, 0, -1]);
    expect(v[0]).toBeCloseTo(-1, 12);
    expect(v[2]).toBeCloseTo(0, 12);
    expect(rotate([0, 0, 0, 1], [1, 2, 3])).toEqual([1, 2, 3]);
    const half = multiply([0, s, 0, s], [0, s, 0, s]);
    expect(half[1]).toBeCloseTo(1, 12);
    expect(rotate(half, [1, 0, 0])[0]).toBeCloseTo(-1, 12);
  });
});

describe('cutscene service', () => {
  it('plays at its place on a dev server: the Waystation’s origin, its actors at their exported poses, seen by the phase alone', () => {
    const { zone, service, player, actors, step, station } = setup();
    const a = player();
    const b = player([34, 45, 482]);
    const r = service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' });
    expect(r).toMatchObject({ t: 'cutscene', op: 'play', id: 'test' });
    expect(() => encodeServerMessage(r)).not.toThrow();
    const phase = zone.phases.phase(r.phase!)!;
    const placement = loadPlacement('test');
    expect(phase).toMatchObject({ kind: 'story', location: { key: `cutscene:test@${station}`, frame: station, center: [0, 0, 0], radius: placement.radius } });
    expect(zone.phases.phaseOf(a.entity)).toBe(r.phase);
    expect(zone.phases.phaseOf(b.entity)).toBeNull();
    expect(service.playingOf(a.viewer)).toEqual({ id: 'test', phase: r.phase });
    expect(service.watching(zone.id, a.entity)).toBe(true);
    expect(service.watching(zone.id, b.entity)).toBe(false);

    // the actor exported from the .blend, in the Waystation's frame where the .blend put it (not relative to the player)
    const [tug] = actors(r.phase!);
    const fields = zone.entity(tug!)!.fields;
    expect(fields).toMatchObject({
      kind: 'ship',
      name: 'Waystation tug',
      hull: 'mule',
      frame: station,
      pos: placement.actors[0]!.pos,
      quat: placement.actors[0]!.quat,
    });
    step();
    expect(zone.interestOf(a.viewer).has(tug!)).toBe(true);
    expect(zone.interestOf(b.viewer).has(tug!)).toBe(false);
    // a story phase hides only its actors: the two players still see each other
    expect(zone.interestOf(b.viewer).has(a.entity) && zone.interestOf(a.viewer).has(b.entity)).toBe(true);

    // asked again, the same phase; ended, the player is back in the shared world and the phase closes with its actor
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' })).toEqual(r);
    expect(actors(r.phase!)).toEqual([tug]);
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'done', id: 'test', skipped: true })).toEqual({
      t: 'cutscene',
      op: 'ended',
      id: 'test',
      phase: r.phase,
    });
    expect(zone.phases.phaseOf(a.entity)).toBeNull();
    expect(phase.open).toBe(false);
    expect(zone.entity(tug!)).toBeUndefined();
    expect(service.playingOf(a.viewer)).toBeNull();
    expect(service.watching(zone.id, a.entity)).toBe(false);
    // (an end for nothing playing changes nothing)
    expect(service.end(a.viewer, 'test')).toEqual({ t: 'cutscene', op: 'ended', id: 'test', phase: null });
  });

  it('lets no client start one on a production server, until the quest engine’s rule allows it', () => {
    const { service, player, zone } = setup({ dev: false });
    const a = player();
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' })).toEqual({
      t: 'cutscene',
      op: 'refused',
      id: 'test',
      phase: null,
      reason: 'denied',
    });
    expect(zone.phases.count).toBe(0);
    // the quest engine fills the hook: this character is on that cutscene step
    service.may = (viewer, id) => viewer === a.viewer && id === 'test';
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' }).op).toBe('play');
    // a dev server allows only what the catalog marks dev
    const dev = setup({ catalog: { ...CUTSCENES, around: { placement: AROUND } } });
    const b = dev.player();
    expect(dev.service.handle(b.viewer, { t: 'cutscene', op: 'request', id: 'around' })).toMatchObject({ op: 'refused', reason: 'denied' });
  });

  it('holds each session to a cooldown between requests', () => {
    const { service, player, advance } = setup();
    const a = player();
    const b = player([31, 45, 480]);
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' }).op).toBe('play');
    service.handle(a.viewer, { t: 'cutscene', op: 'done', id: 'test' });
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' })).toMatchObject({ op: 'refused', reason: 'cooldown' });
    // (another session has its own)
    expect(service.handle(b.viewer, { t: 'cutscene', op: 'request', id: 'test' }).op).toBe('play');
    advance(COOLDOWN_S - 0.5);
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' })).toMatchObject({ reason: 'cooldown' });
    advance(1);
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' }).op).toBe('play');
  });

  it('refuses a player in another phase rather than pulling it out, and one away from the cutscene’s place', () => {
    const { zone, service, player, step } = setup();
    const a = player();
    const bay = zone.phases.phaseFor(a.viewer, 'bay', { key: 'hangar', frame: zone.stationFrame, center: [0, 0, 0], radius: 600 });
    step();
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' })).toMatchObject({ op: 'refused', reason: 'phase' });
    expect(zone.phases.phaseOf(a.entity)).toBe(bay.id);
    expect(bay.open).toBe(true);
    // 4 km from the Waystation, outside the test cutscene's 3 km
    const far = player([0, 0, 4000]);
    expect(service.handle(far.viewer, { t: 'cutscene', op: 'request', id: 'test' })).toMatchObject({ op: 'refused', reason: 'place' });
    // on a world, nowhere near it
    const away = player([0, 0, 1e6], null, [0, 0, 0, 1], frameId(zone.system.seed, 0));
    expect(service.handle(away.viewer, { t: 'cutscene', op: 'request', id: 'test' })).toMatchObject({ op: 'refused', reason: 'place' });
  });

  it('shares one phase, and one set of actors, with a party member at the place; others get their own', () => {
    const { zone, service, player, actors } = setup();
    const a = player(undefined, 'crew');
    const c = player([31, 45, 480], 'crew');
    const d = player([32, 45, 480]);
    const ra = service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' });
    const rc = service.handle(c.viewer, { t: 'cutscene', op: 'request', id: 'test' });
    const rd = service.handle(d.viewer, { t: 'cutscene', op: 'request', id: 'test' });
    expect(rc.phase).toBe(ra.phase);
    expect(rd.phase).not.toBe(ra.phase);
    expect(actors(ra.phase!)).toHaveLength(1);
    expect(actors(rd.phase!)).toHaveLength(1);
    // the first to finish leaves; the phase stays for the other until it finishes too
    service.end(a.viewer, 'test');
    expect(zone.phases.phase(ra.phase!)?.open).toBe(true);
    const tug = actors(ra.phase!)[0]!;
    service.end(c.viewer, 'test');
    expect(zone.phases.phase(ra.phase!)).toBeUndefined();
    expect(zone.entity(tug)).toBeUndefined();
  });

  it('plays one anchored on the player where the player is: a party member near shares it, one far away does not', () => {
    const s = Math.SQRT1_2;
    const { zone, service, player, actors } = setup({ catalog: { around: { placement: AROUND, dev: true } } });
    // facing -x (a quarter turn about +y)
    const a = player([100, 20, -40], 'crew', [0, s, 0, s]);
    const near = player([150, 20, -40], 'crew');
    const far = player([100, 20, 20_000], 'crew');
    const ra = service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'around' });
    const loc = zone.phases.phase(ra.phase!)!.location;
    expect(loc).toMatchObject({ frame: zone.stationFrame, center: [100, 20, -40], radius: 500 });
    expect(loc.key).toMatch(new RegExp(`^cutscene:around@${zone.stationFrame}#`));
    // its actor 10 m ahead of the player as it then faced (-x), 2 m up
    const [echo] = actors(ra.phase!);
    const pos = zone.entity(echo!)!.fields.pos;
    expect(pos[0]).toBeCloseTo(90, 9);
    expect(pos[1]).toBeCloseTo(22, 9);
    expect(pos[2]).toBeCloseTo(-40, 9);
    expect(service.handle(near.viewer, { t: 'cutscene', op: 'request', id: 'around' }).phase).toBe(ra.phase);
    const rf = service.handle(far.viewer, { t: 'cutscene', op: 'request', id: 'around' });
    expect(rf.op).toBe('play');
    expect(rf.phase).not.toBe(ra.phase);
    expect(zone.phases.phase(rf.phase!)!.location.key).not.toBe(loc.key);
    expect(actors(ra.phase!)).toHaveLength(1);
  });

  it('plays a quest step’s cutscene in the step’s own phase', () => {
    const { zone, service, player } = setup({ dev: false });
    const a = player();
    const at = { key: 'quest:prologue:cold_open', frame: zone.stationFrame, center: [30, 45, 480] as V3, radius: 800 };
    const step = zone.phases.phaseFor(a.viewer, 'story', at);
    const r = service.start(a.viewer, 'test', at);
    expect(r).toEqual({ t: 'cutscene', op: 'play', id: 'test', phase: step.id });
    expect(zone.phases.phaseOf(a.entity)).toBe(step.id);
  });

  it('says which phases it plays cutscenes in, whatever their key, while they are open', () => {
    const { zone, service, player } = setup({ dev: false });
    const a = player();
    const b = player();
    const at = { key: 'quest:prologue:cold_open', frame: zone.stationFrame, center: [30, 45, 480] as V3, radius: 800 };
    const scene = zone.phases.phaseFor(a.viewer, 'story', at);
    const other = zone.phases.phaseFor(b.viewer, 'story', { ...at, key: 'quest:prologue:dock' });
    expect(service.plays(zone, scene.id)).toBe(false);
    service.start(a.viewer, 'test', at);
    expect([service.plays(zone, scene.id), service.plays(zone, other.id)]).toEqual([true, false]);
    // another zone's phase of the same number is not it
    const elsewhere = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0) });
    expect(service.plays(elsewhere, scene.id)).toBe(false);
    service.end(a.viewer, 'test', 'finished');
    expect(scene.open).toBe(false);
    expect(service.plays(zone, scene.id)).toBe(false);
  });

  it('refuses an unknown cutscene, a second one while one plays, and a session in no zone', () => {
    const { service, player } = setup({ catalog: { ...CUTSCENES, other: { placement: { ...loadPlacement('test'), id: 'other' }, dev: true } } });
    const a = player();
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'nope' })).toEqual({
      t: 'cutscene',
      op: 'refused',
      id: 'nope',
      phase: null,
      reason: 'unknown',
    });
    // (an id that is a property of every object is still unknown)
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'constructor' })).toMatchObject({ op: 'refused', reason: 'unknown' });
    expect(service.start(new Viewer(99), 'test')).toMatchObject({ op: 'refused', reason: 'zone' });
    const play = service.start(a.viewer, 'test');
    const busy = service.start(a.viewer, 'other');
    expect(busy).toMatchObject({ op: 'refused', reason: 'busy' });
    for (const m of [play, busy]) expect(() => encodeServerMessage(m)).not.toThrow();
    service.end(a.viewer, 'test');
    expect(service.start(a.viewer, 'other').op).toBe('play');
  });

  it('forgets a session that left its zone, which is then no longer watching', () => {
    const { zone, service, player } = setup();
    const a = player();
    service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' });
    service.forget(a.viewer);
    expect(service.playingOf(a.viewer)).toBeNull();
    expect(service.watching(zone.id, a.entity)).toBe(false);
  });
});

describe('the server’s bounds', () => {
  it('sends a re-ask after the phase closed through may and the cooldown again, so a step’s cutscene cannot be replayed', () => {
    const { zone, service, player, advance } = setup({ dev: false });
    const a = player();
    // the quest engine allows it while the character is on its step, which ends once it has played
    let onStep = true;
    service.may = (_v, id) => onStep && id === 'test';
    const play = service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' });
    expect(play.op).toBe('play');
    onStep = false;
    // while it is going, asking again answers with its phase (no may, no cooldown)
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' })).toEqual(play);
    // the phase closes (the grace ran out, the server closed it): a re-ask is a new request
    zone.phases.close(play.phase!);
    advance(COOLDOWN_S + 1);
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' })).toMatchObject({ op: 'refused', reason: 'denied' });
    expect(zone.phases.count).toBe(0);
    // and still allowed by may, it waits out the cooldown like any request
    onStep = true;
    const again = service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' });
    expect(again.op).toBe('play');
    zone.phases.close(again.phase!);
    expect(service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' })).toMatchObject({ op: 'refused', reason: 'cooldown' });
  });

  it('stops counting a player as watching past the cutscene’s length, exit and margin, ends it and tells the client', () => {
    const { zone, service, player, advance } = setup();
    const a = player();
    const play = service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' });
    const bound = loadPlacement('test').duration + EXIT_S + WATCH_MARGIN_S;
    advance(bound - 0.5);
    service.sweep();
    expect(service.watching(zone.id, a.entity)).toBe(true);
    expect(a.viewer.pushed).toEqual([]);
    advance(1);
    // past the bound it is no longer watching, even before the sweep comes round
    expect(service.watching(zone.id, a.entity)).toBe(false);
    service.sweep();
    expect(a.viewer.pushed).toEqual([{ t: 'cutscene', op: 'ended', id: 'test', phase: play.phase }]);
    expect(zone.phases.phaseOf(a.entity)).toBeNull();
    expect(service.playingOf(a.viewer)).toBeNull();
  });

  it('stops counting a player as watching once it is no longer in the cutscene’s phase, and tells the client', () => {
    const { zone, service, player } = setup();
    const a = player();
    const play = service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'test' });
    // the phase manager put it back in the shared world (here: it left the phase; the grace does the same)
    zone.phases.leave(a.viewer);
    expect(service.watching(zone.id, a.entity)).toBe(false);
    service.sweep();
    expect(a.viewer.pushed).toEqual([{ t: 'cutscene', op: 'ended', id: 'test', phase: play.phase }]);
    // its done afterwards changes nothing
    expect(service.end(a.viewer, 'test')).toEqual({ t: 'cutscene', op: 'ended', id: 'test', phase: null });
  });

  it('forgets the anchor of a phase that closed through an expired disconnect hold', () => {
    const { zone, service, player, step } = setup({ catalog: { around: { placement: AROUND, dev: true } } });
    const anchors = () => (service as unknown as { anchors: Map<string, unknown> }).anchors.size;
    const a = player([100, 20, -40], 'crew');
    const play = service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'around' });
    expect(anchors()).toBe(1);
    // its connection drops: the phase keeps its place for the grace, then closes
    service.forget(a.viewer);
    zone.leave(a.viewer, 'disconnected');
    expect(zone.phases.phase(play.phase!)?.open).toBe(true);
    for (let i = 0; i < 20; i++) step(1);
    expect(zone.phases.phase(play.phase!)).toBeUndefined();
    service.sweep();
    expect(anchors()).toBe(0);
  });

  it('keeps a party member far away in the same frame out of a player-anchored phase', () => {
    const { zone, service, player } = setup({ catalog: { around: { placement: AROUND, dev: true } } });
    const a = player([100, 20, -40], 'crew');
    // 1.5 km away, still in the Waystation's frame (its sphere is 4.5 km), beyond the cutscene's 500 m
    const far = player([100, 20, -1540], 'crew');
    const near = player([100, 20, -440], 'crew');
    expect(zone.entity(far.entity)!.fields.frame).toBe(zone.stationFrame);
    const ra = service.handle(a.viewer, { t: 'cutscene', op: 'request', id: 'around' });
    const rf = service.handle(far.viewer, { t: 'cutscene', op: 'request', id: 'around' });
    const rn = service.handle(near.viewer, { t: 'cutscene', op: 'request', id: 'around' });
    expect(rf.phase).not.toBe(ra.phase);
    expect(rn.phase).toBe(ra.phase);
    expect(zone.phases.phase(rf.phase!)!.location.center).toEqual([100, 20, -1540]);
  });
});

describe('catalog', () => {
  it('reads each placement from its export, and refuses a broken one', () => {
    expect(CUTSCENES.test!.dev).toBe(true);
    expect(CUTSCENES.test!.placement.actors.map((a) => a.id)).toEqual(['tug']);
    expect(() => loadPlacement('../x')).toThrow(/no cutscene/);
  });
});
