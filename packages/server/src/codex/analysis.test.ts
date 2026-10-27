// Analysis on the server (P1.E08.T04, ARCHITECTURE §22), on a real zone of system 0 with a world's fauna and its drawn
// ground planned on this thread: a creature in range and in sight is analyzed, its species recorded in the codex with its
// XP the first time and known after (no XP); the quest runtime's listener hears each analysis; and every check refuses as
// it should: out of range, the ground in the way, from a ship, a dead creature, one on another world, no creature at
// all, too fast, a stale stamp or number, a ground still planning, a codex full.
import { CODEX_LIMITS, codexEntryFor, emptyCodex, SPECIES_XP, speciesKey, type Codex } from '@astra/shared/codex';
import { totalXpFor } from '@astra/shared/combat';
import type { ServerMessage } from '@astra/shared/protocol';
import type { FaunaSpecies } from '@astra/shared/world';
import { beforeEach, describe, expect, it } from 'vitest';
import { dist, faunaWorld, along, type FaunaWorld } from '../../test/faunaWorld.ts';
import type { Vec3 } from '../fauna/cells.ts';
import { tangents } from '../fauna/herds.ts';
import { CharacterProgress } from '../persistence/components.ts';
import { lineOfSight } from '../resources/los.ts';
import { EYE_M } from '../resources/service.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { ANALYZE_BURST, ANALYZE_RANGE_M, ANALYZE_SLACK_M, AnalysisService, hitRadius, type AnalysisZone, type AnalyzedEvent } from './analysis.ts';
import { CodexService } from './service.ts';

type Answer = Extract<ServerMessage, { t: 'analyze' }>;

const w: FaunaWorld = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.kind !== 'flyer') });
const walker: FaunaSpecies = w.species.find((s) => s.kind !== 'flyer')!;
const viewer = Object.assign(w.viewer, { characterId: 'c1' }) as ZoneViewer;
const g = w.ground;

const lift = (p: Readonly<Vec3>, by: number): Vec3 => {
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] + (p[0] / l) * by, p[1] + (p[1] / l) * by, p[2] + (p[2] / l) * by];
};
const unit = (p: Readonly<Vec3>): Vec3 => {
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / l, p[1] / l, p[2] / l];
};
/** Where the service measures from and to: the player's eye, and a walker's middle. */
const eyeOf = (stand: Readonly<Vec3>) => lift(stand, EYE_M);
const middleOf = (feet: Readonly<Vec3>, sp: FaunaSpecies = walker) => lift(feet, sp.kind === 'flyer' ? 0 : hitRadius(sp) * 0.8);
const sight = (stand: Readonly<Vec3>, feet: Readonly<Vec3>) =>
  lineOfSight({ R: g.radius, height: (x, y, z) => g.sample([x, y, z]) }, eyeOf(stand), middleOf(feet));

/** A creature's spot and a stand `dist` metres off with the ground in the way (or, `clear`, out of the way), on dry land. */
function spotAndStand(opts: { clear: boolean; dists: number[] }): { feet: Vec3; stand: Vec3 } {
  for (let i = 0; i < 6000; i++) {
    const y = 1 - (2 * (i + 0.5)) / 6000;
    const a = i * 2.399963229728653;
    const rr = Math.sqrt(1 - y * y);
    const d: Vec3 = [Math.cos(a) * rr, y, Math.sin(a) * rr];
    if (g.sample(d) < 5) continue;
    const feet = w.onGround(d);
    const [t, b] = tangents(d);
    for (const dd of opts.dists) {
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        const sd = along(d, t, b, Math.cos(ang) * dd, Math.sin(ang) * dd, g.radius);
        if (g.sample(sd) < 3) continue;
        const stand = w.onGround(sd);
        if (dist(eyeOf(stand), middleOf(feet)) > ANALYZE_RANGE_M - 10) continue;
        // (with a margin: a little higher or lower at the creature's end changes nothing)
        if (opts.clear ? sight(stand, feet) && sight(stand, lift(feet, -1)) : !sight(stand, feet) && !sight(stand, lift(feet, 3))) return { feet, stand };
      }
    }
  }
  throw new Error('no spot found');
}

const open = spotAndStand({ clear: true, dists: [25] });
const hill = spotAndStand({ clear: false, dists: [35, 45, 55] });

let progress: CharacterProgress;
let codex: CodexService;
let analysis: AnalysisService;
let heard: AnalyzedEvent[];
let t: number;
let seq: number;

function service(zone: AnalysisZone = w.zone) {
  return new AnalysisService({ zones: { zoneOf: (v) => (v === viewer ? zone : undefined), tier: () => 0 }, codex, now: () => t });
}

beforeEach(() => {
  progress = new CharacterProgress();
  progress.set('c1', { level: 1, xp: 0, homeSystem: 0 });
  codex = new CodexService({ progress });
  codex.open('c1');
  analysis = service();
  heard = [];
  analysis.subscribe((e) => heard.push(e));
  t = 5000;
  seq = 0;
  w.zone.patch(w.player, { frame: w.frame, mode: 'foot', level: 1 });
});

/** A creature of `sp` standing at `feet` (the herd's first animal stands at its centre). */
function creature(feet: Readonly<Vec3>, sp: FaunaSpecies = walker): number {
  const id = w.spawn({ body: w.body.index, species: sp.index, at: feet, count: 1 }).creatures[0]!;
  expect(dist(w.zone.entity(id)!.fields.pos, feet)).toBeLessThan(0.5);
  return id;
}

/** Asks to analyze `target` a second and a bit after the last ask (within the rate). */
function ask(target: number, opts: { time?: number; seq?: number; svc?: AnalysisService } = {}): Answer {
  t += 1.1;
  return (opts.svc ?? analysis).analyze(viewer, { t: 'analyze', seq: opts.seq ?? ++seq, time: opts.time ?? t, target });
}

describe('analyzing a creature', () => {
  it('records its species in the codex with its XP the first time, and as known after, earning nothing', () => {
    const id = creature(open.feet);
    w.movePlayer(open.stand);
    const first = ask(id);
    const entry = codexEntryFor(walker, t);
    expect(first).toEqual({
      t: 'analyze',
      seq: 1,
      target: id,
      result: 'new',
      xp: SPECIES_XP,
      species: { ...entry, key: speciesKey(w.frame, walker.index), world: w.frame, index: walker.index, name: walker.name },
    });
    expect(progress.get('c1')!.xp).toBe(SPECIES_XP);
    expect(codex.get('c1')).toEqual({ worlds: { [w.frame]: { system: 0, species: { [walker.index]: entry } } } });
    const again = ask(id);
    expect(again).toMatchObject({ seq: 2, result: 'known', species: { at: entry.at } });
    expect(again.xp).toBeUndefined();
    expect(progress.get('c1')!.xp).toBe(SPECIES_XP);
    // another animal of the species is the same species: known
    const other = creature(open.feet);
    expect(ask(other).result).toBe('known');
    expect(heard).toEqual([
      { characterId: 'c1', zone: w.zone.id, world: w.frame, index: walker.index, key: speciesKey(w.frame, walker.index), first: true },
      { characterId: 'c1', zone: w.zone.id, world: w.frame, index: walker.index, key: speciesKey(w.frame, walker.index), first: false },
      { characterId: 'c1', zone: w.zone.id, world: w.frame, index: walker.index, key: speciesKey(w.frame, walker.index), first: false },
    ]);
    expect(analysis.stats()).toMatchObject({ asked: 3, made: 3, first: 1, refused: {} });
  });

  it('puts the level the XP gained on the player’s entity', () => {
    progress.set('c1', { level: 1, xp: totalXpFor(2) - 1, homeSystem: 0 });
    w.movePlayer(open.stand);
    expect(ask(creature(open.feet)).result).toBe('new');
    expect(progress.get('c1')!.level).toBe(2);
    expect(w.zone.entity(w.player)!.fields.level).toBe(2);
  });

  it('refuses a creature out of range, measured from the eye to its middle, and takes one just within', () => {
    const id = creature(open.feet);
    const middle = middleOf(open.feet);
    const reach = ANALYZE_RANGE_M + hitRadius(walker) + ANALYZE_SLACK_M;
    // an eye `d` metres from its middle, up a slope the ground does not block
    const [tt] = tangents(unit(middle));
    const up = unit(middle);
    const eyeAt = (d: number): Vec3 => {
      const dir = [tt[0] * 0.8 + up[0] * 0.6, tt[1] * 0.8 + up[1] * 0.6, tt[2] * 0.8 + up[2] * 0.6];
      const eye: Vec3 = [middle[0] + dir[0]! * d, middle[1] + dir[1]! * d, middle[2] + dir[2]! * d];
      return lift(eye, -EYE_M);
    };
    w.movePlayer(eyeAt(reach + 0.5));
    expect(ask(id)).toMatchObject({ result: 'refused', reason: 'range' });
    w.movePlayer(eyeAt(reach - 0.5));
    expect(ask(id).result).toBe('new');
    w.movePlayer(w.onGround(along(unit(open.feet), ...tangents(unit(open.feet)), 400, 0, g.radius)));
    expect(ask(id)).toMatchObject({ result: 'refused', reason: 'range' });
    expect(analysis.stats().refused.range).toBe(2);
  });

  it('refuses a creature with the ground in the way', () => {
    const id = creature(hill.feet);
    w.movePlayer(hill.stand);
    expect(dist(eyeOf(hill.stand), middleOf(hill.feet))).toBeLessThan(ANALYZE_RANGE_M);
    expect(ask(id)).toMatchObject({ result: 'refused', reason: 'los' });
    expect(codex.get('c1')).toEqual(emptyCodex());
    expect(progress.get('c1')!.xp).toBe(0);
    expect(heard).toEqual([]);
    // from high enough over the stand (a jetpack's climb), in sight and still in range
    const reach = ANALYZE_RANGE_M + hitRadius(walker) + ANALYZE_SLACK_M;
    const over = [10, 20, 30, 40, 50].map((h) => lift(hill.stand, h)).find((p) => sight(p, hill.feet) && dist(eyeOf(p), middleOf(hill.feet)) < reach - 1);
    if (over) {
      w.movePlayer(over);
      expect(ask(id).result).toBe('new');
    }
  });

  it('analyzes only on foot, a live creature of the zone, on the player’s own world', () => {
    const id = creature(open.feet);
    w.movePlayer(open.stand);
    w.zone.patch(w.player, { mode: 'ship' });
    expect(ask(id)).toMatchObject({ result: 'refused', reason: 'mode' });
    w.zone.patch(w.player, { mode: 'foot' });
    const pose = { frame: w.frame, pos: open.feet, quat: [0, 0, 0, 1] as [number, number, number, number], vel: [0, 0, 0] as Vec3 };
    for (const target of [
      999_999,
      w.player,
      w.zone.spawn({ kind: 'prop', ...pose }),
      // (an entity that is not a creature, whatever species it carries)
      w.zone.spawn({ kind: 'npc', ...pose, species: walker.index, hp: 1 }),
    ])
      expect(ask(target), String(target)).toMatchObject({ result: 'refused', reason: 'unknown' });
    const ghost = creature(open.feet);
    w.zone.patch(ghost, { species: CODEX_LIMITS.perWorld - 1 });
    expect(ask(ghost)).toMatchObject({ result: 'refused', reason: 'unknown' });
    w.zone.patch(id, { hp: 0 });
    expect(ask(id)).toMatchObject({ result: 'refused', reason: 'dead' });
    w.zone.patch(id, { hp: 0.5 });
    w.zone.patch(w.player, { frame: `${w.zone.system.seed}:station`, pos: [0, 2, 0] });
    expect(ask(id)).toMatchObject({ result: 'refused', reason: 'world' });
    w.zone.patch(w.player, { frame: w.frame, pos: open.stand });
    expect(ask(id).result).toBe('new');
  });

  it('refuses a creature its phase hides from the player (a phase’s own) as none, before telling anything else of it', () => {
    const zone = w.zone;
    const pose = { frame: w.frame, pos: open.feet, quat: [0, 0, 0, 1] as [number, number, number, number], vel: [0, 0, 0] as Vec3 };
    const mob = { kind: 'mob' as const, ...pose, species: walker.index, level: 1, hp: 1, mode: 'idle' };
    // another player's story phase here, and a creature of its own: none to this player, dead or alive
    const other = { id: 2, characterId: 'c2', sendBinary: () => {} } as ZoneViewer;
    zone.join(other, { kind: 'player', frame: w.frame, pos: open.stand, quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    const theirs = zone.phases.phaseFor(other, 'story', { key: 'test:theirs', frame: w.frame, center: open.feet, radius: 100 });
    const hidden = zone.phases.spawn(theirs.id, mob);
    w.movePlayer(open.stand);
    expect(zone.phases.canSee(zone.entityOf(other)!, hidden)).toBe(true);
    expect(ask(hidden)).toMatchObject({ result: 'refused', reason: 'unknown' });
    zone.patch(hidden, { hp: 0 });
    expect(ask(hidden)).toMatchObject({ result: 'refused', reason: 'unknown' });
    // its own phase's creature, a player sees and analyzes
    const mine = zone.phases.phaseFor(viewer, 'story', { key: 'test:mine', frame: w.frame, center: open.feet, radius: 100 });
    expect(ask(zone.phases.spawn(mine.id, mob)).result).toBe('new');
    expect(ask(hidden)).toMatchObject({ result: 'refused', reason: 'unknown' });
    zone.phases.leave(viewer);
    zone.phases.close(mine.id);
    zone.phases.close(theirs.id);
    zone.leave(other);
    expect(zone.entity(hidden)).toBeUndefined();
  });

  it('refuses a stale number or stamp, a character out of play, and asks faster than its rate', () => {
    const id = creature(open.feet);
    w.movePlayer(open.stand);
    expect(ask(id, { time: t + 1.1 + 3.5 })).toMatchObject({ result: 'refused', reason: 'stale' });
    expect(ask(id, { seq: 1 })).toMatchObject({ result: 'refused', reason: 'stale_seq' });
    // at once, ANALYZE_BURST asks and no more
    const at = t + 1.1;
    const burst = Array.from({ length: ANALYZE_BURST + 1 }, () => analysis.analyze(viewer, { t: 'analyze', seq: ++seq, time: at, target: 999_999 }));
    expect(burst.map((a) => a.reason)).toEqual([...Array.from({ length: ANALYZE_BURST }, () => 'unknown'), 'rate']);
    expect(ask(id).result).toBe('new');
    codex.close('c1');
    expect(ask(id)).toMatchObject({ result: 'refused', reason: 'zone' });
    const stranger = { id: 99, sendBinary: () => {} } as ZoneViewer;
    expect(analysis.analyze(stranger, { t: 'analyze', seq: 1, time: t, target: id })).toMatchObject({ result: 'refused', reason: 'zone' });
  });

  it('waits for a world’s ground still being planned, and records nothing past the codex’s bounds', () => {
    const id = creature(open.feet);
    w.movePlayer(open.stand);
    const zone = w.zone;
    const planning: AnalysisZone = {
      id: zone.id,
      systemIndex: zone.systemIndex,
      system: zone.system,
      entityOf: (v) => zone.entityOf(v),
      entity: (e) => zone.entity(e),
      patch: (e, set, clear) => zone.patch(e, set, clear),
      fauna: { tier: 0, grounds: { ground: () => null } },
      phases: zone.phases,
    };
    expect(ask(id, { svc: service(planning) })).toMatchObject({ result: 'refused', reason: 'busy' });
    const full: Codex = emptyCodex();
    for (let i = 0; i < CODEX_LIMITS.species; i++)
      (full.worlds[`1:${Math.floor(i / CODEX_LIMITS.perWorld)}`] ??= { system: 0, species: {} }).species[i % CODEX_LIMITS.perWorld] = codexEntryFor(walker, 1);
    codex.open('c1', full);
    expect(ask(id)).toMatchObject({ result: 'refused', reason: 'full' });
    expect(progress.get('c1')!.xp).toBe(0);
    expect(heard).toEqual([]);
  });

  it('reaches a creature by its size: a flyer’s body, a big walker’s middle', () => {
    expect(hitRadius({ size: 2, kind: 'quad' })).toBeCloseTo(2 * 1.15 * 0.9);
    expect(hitRadius({ size: 2, kind: 'flyer' })).toBeCloseTo(2 * 1.15 * 0.6);
  });
});
