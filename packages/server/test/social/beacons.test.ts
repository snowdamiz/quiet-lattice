// Call-for-aid beacons (P1.E15.T02): a player in an event, a raid or a quest step's story phase with open slots raises a
// beacon the whole shard can watch; it comes down when the instance fills, closes or is left by its caller, when it is
// lowered and when it lapses. Answering one puts the answering player in that instance through the phase manager, the
// server checking again at that moment that the beacon is up, the player in its system, in no instance, at its place,
// and a slot open (a story instance's slot is a place in the caller's party, which answering joins). Raising is
// rate-limited per account, one beacon per character and per instance.
import type { BeaconView, ServerMessage } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import type { PhaseLocation } from '../../src/phases/manager.ts';
import type { SocialLimits } from '../../src/social/limits.ts';
import { denials, harness, partyStates, type Player } from './harness.ts';

type Harness = ReturnType<typeof harness>;
type News = Extract<ServerMessage, { t: 'beacon' }>;
type Listing = Extract<ServerMessage, { t: 'beacons' }>;

/** A place at the players' home Waystation (where they all dock), as an event or a quest step opens one. */
const site = (p: Player, key: string): PhaseLocation => ({ key, frame: p.zone.stationFrame, center: [0, 0, 0], radius: 300 });

const newsOf = (ms: ServerMessage[]): News[] => ms.flatMap((m) => (m.t === 'beacon' ? [m] : []));
const listsOf = (ms: ServerMessage[]): Listing[] => ms.flatMap((m) => (m.t === 'beacons' ? [m] : []));

/** Players named `names` at their home Waystation in system 0, their entities placed by one zone tick. */
function setup(names: string[], limits: Partial<SocialLimits> = {}) {
  const h = harness(limits);
  const players = names.map((n) => h.player(n));
  h.tick();
  return { h, players, phases: players[0]!.zone.phases };
}

/** `p` raises a beacon; returns its id (the `raised` news), and forgets what `p` was sent. */
function raise(p: Player): number {
  p.beacon({ op: 'raise' });
  const ms = p.take();
  const news = newsOf(ms);
  expect(news, JSON.stringify(denials(ms))).toHaveLength(1);
  expect(news[0]!.op).toBe('raised');
  return news[0]!.id;
}

/** `n` more players placed in `location`'s event through the phase manager, as the event system places arrivals. */
function arrivals(h: Harness, n: number, location: PhaseLocation, prefix: string): Player[] {
  const out = Array.from({ length: n }, (_, i) => h.player(`${prefix}${'abcdefghijklmnop'[i]}`));
  for (const p of out) p.zone.phases.phaseFor(p.session, 'event', location);
  return out;
}

describe('raising a beacon', () => {
  it('lists an event with open slots to every watcher, and the whole list to a new one, encoded once for them all', () => {
    const { h, players } = setup(['Ana', 'Bex', 'Cor', 'Dax']);
    const [ana, bex, cor, dax] = players as [Player, Player, Player, Player];
    bex.beacon({ op: 'watch' });
    cor.beacon({ op: 'watch' });
    expect(listsOf(bex.take())).toEqual([{ t: 'beacons', reset: true, beacons: [], gone: [] }]);
    cor.take();

    const event = ana.zone.phases.phaseFor(ana.session, 'event', site(ana, 'wreck of the Ilse'));
    const encodes = h.encodes.n;
    const id = raise(ana);
    const at = h.clock.now();
    const listed: BeaconView = {
      id,
      kind: 'event',
      system: 0,
      frame: ana.zone.stationFrame,
      center: [0, 0, 0],
      radius: 300,
      place: 'wreck of the Ilse',
      from: 'Ana',
      open: 11,
      cap: 12,
      at,
      until: at + 600,
    };
    for (const w of [bex, cor]) expect(listsOf(w.take())).toEqual([{ t: 'beacons', beacons: [listed], gone: [] }]);
    // one encoding for both watchers (the caller's own news is its own message)
    expect(h.encodes.n - encodes).toBe(1);
    expect(dax.take()).toEqual([]);
    expect(h.social.beacons.of('char-Ana')).toEqual(listed);

    dax.beacon({ op: 'watch' });
    expect(listsOf(dax.take())).toEqual([{ t: 'beacons', reset: true, beacons: [listed], gone: [] }]);
    expect(h.lines.find((l) => l.msg === 'beacon raised')?.obj).toMatchObject({ beacon: id, character: 'char-Ana', kind: 'event', phase: event.id, open: 11 });
  });

  it('refuses outside an instance, in a bay or a cutscene’s phase, with no slot open, or past the shard’s limit', () => {
    const { players, phases } = setup(['Ana', 'Bex', 'Cor', 'Dax', 'Eli'], { partyMax: 2, beaconMax: 1 });
    const [ana, bex, cor, dax, eli] = players as [Player, Player, Player, Player, Player];
    ana.beacon({ op: 'raise' });
    expect(denials(ana.take())).toEqual(['raise:no_phase']);
    phases.phaseFor(ana.session, 'bay', site(ana, 'hangar'));
    ana.beacon({ op: 'raise' });
    phases.phaseFor(bex.session, 'story', site(bex, 'cutscene:test@1:station'));
    bex.beacon({ op: 'raise' });
    expect([...denials(ana.take()), ...denials(bex.take())]).toEqual(['raise:kind', 'raise:kind']);

    // a quest step's story phase calls aid into the party: a full party has no slot
    cor.party({ op: 'invite', name: 'Dax' });
    dax.party({ op: 'accept', name: 'Cor' });
    phases.phaseFor(cor.session, 'story', site(cor, 'quest:first_jobs:gather'), cor.zone.entity(cor.entityId)!.party);
    cor.take();
    cor.beacon({ op: 'raise' });
    expect(denials(cor.take())).toEqual(['raise:full']);

    // the shard's limit (one here)
    phases.phaseFor(dax.session, 'raid', site(dax, 'vault'));
    raise(dax);
    phases.phaseFor(eli.session, 'event', site(eli, 'convoy'));
    eli.beacon({ op: 'raise' });
    expect(denials(eli.take())).toEqual(['raise:busy']);
  });

  it('allows one beacon per character and per instance, and rate-limits raising per account', () => {
    const h = harness();
    const ana = h.player('Ana');
    const bex = h.player('Bex');
    const alt = h.player('Alt', { account: 'acct-Ana' });
    h.tick();
    const event = site(ana, 'convoy');
    for (const p of [ana, bex]) p.zone.phases.phaseFor(p.session, 'event', event);
    raise(ana);
    ana.beacon({ op: 'raise' });
    bex.beacon({ op: 'raise' });
    expect([...denials(ana.take()), ...denials(bex.take())]).toEqual(['raise:raised', 'raise:raised']);

    // three at once per account, then one each 30 s; the account's other character shares the allowance
    const lower = (p: Player) => {
      p.beacon({ op: 'lower' });
      expect(newsOf(p.take())).toMatchObject([{ op: 'ended', why: 'lowered' }]);
    };
    lower(ana);
    raise(ana);
    lower(ana);
    alt.zone.phases.phaseFor(alt.session, 'raid', site(alt, 'vault'));
    raise(alt);
    lower(alt);
    ana.beacon({ op: 'raise' });
    const refused = ana.take().filter((m) => m.t === 'denied');
    expect(refused).toEqual([{ t: 'denied', of: 'raise', code: 'rate', retryS: 30 }]);
    h.advance(29_000);
    ana.beacon({ op: 'raise' });
    expect(denials(ana.take())).toEqual(['raise:rate']);
    h.advance(1_500);
    raise(ana);
    expect(h.social.beacons.count).toBe(1);
  });

  it('names the place by its location’s key, or by the kind when the key is not plain text, and lists nothing it cannot send', () => {
    const { h, players, phases } = setup(['Ana', 'Bex', 'Cor']);
    const [ana, bex, cor] = players as [Player, Player, Player];
    phases.phaseFor(ana.session, 'raid', site(ana, `  ${'Vault '.repeat(20)}`));
    phases.phaseFor(bex.session, 'event', site(bex, 'convoy‮hijack'));
    raise(ana);
    raise(bex);
    expect(h.social.beacons.list().map((b) => b.place)).toEqual(['Vault '.repeat(20).trim().slice(0, 64), 'Event']);
    // an instance whose place no beacon can carry (a radius past any position's bound) is not listed, and is logged
    phases.phaseFor(cor.session, 'event', { ...site(cor, 'void'), radius: 1e19 });
    cor.beacon({ op: 'raise' });
    expect(denials(cor.take())).toEqual(['raise:kind']);
    expect(h.lines.find((l) => l.msg === 'beacon not raised: its instance cannot be listed')?.level).toBe('error');
    expect(h.social.beacons.count).toBe(2);
  });
});

describe('answering a beacon', () => {
  it('puts the player in the instance through the phase manager, and tells the caller and the watchers', () => {
    const { h, players, phases } = setup(['Ana', 'Bex', 'Cor']);
    const [ana, bex, cor] = players as [Player, Player, Player];
    const event = phases.phaseFor(ana.session, 'event', site(ana, 'wreck'));
    const id = raise(ana);
    cor.beacon({ op: 'watch' });
    cor.take();

    bex.beacon({ op: 'answer', id });
    expect(newsOf(bex.take())).toEqual([{ t: 'beacon', op: 'joined', id, phase: event.id }]);
    expect(newsOf(ana.take())).toEqual([{ t: 'beacon', op: 'answered', id, name: 'Bex' }]);
    expect([...event.members]).toEqual([ana.entityId, bex.entityId]);
    expect(phases.phaseOf(bex.entityId)).toBe(event.id);
    expect(listsOf(cor.take())).toEqual([{ t: 'beacons', beacons: [expect.objectContaining({ id, open: 10 })], gone: [] }]);
    expect(h.lines.find((l) => l.msg === 'beacon answered')?.obj).toMatchObject({
      beacon: id,
      character: 'char-Bex',
      caller: 'char-Ana',
      phase: event.id,
      members: 2,
    });

    // it stays there through the zone's ticks: inside the volume, sealed with its instance
    h.tick();
    expect(phases.phaseOf(bex.entityId)).toBe(event.id);
    expect(ana.zone.phases.canSee(bex.entityId, ana.entityId) && !ana.zone.phases.canSee(bex.entityId, cor.entityId)).toBe(true);
  });

  it('refuses an unknown beacon, its own, and a player elsewhere, in an instance already, or away from its place', () => {
    const h = harness();
    const [ana, bex, cor, dax] = ['Ana', 'Bex', 'Cor', 'Dax'].map((n) => h.player(n)) as [Player, Player, Player, Player];
    const far = h.player('Fay', { system: 1 });
    h.tick();
    const { phases } = ana.zone;
    phases.phaseFor(ana.session, 'event', site(ana, 'wreck'));
    const id = raise(ana);
    phases.phaseFor(cor.session, 'story', site(cor, 'quest:first_jobs:gather'), null);
    ana.zone.patch(dax.entityId, { pos: [0, 0, 400] });
    h.tick();

    bex.beacon({ op: 'answer', id: id + 1 });
    ana.beacon({ op: 'answer', id });
    far.beacon({ op: 'answer', id });
    cor.beacon({ op: 'answer', id });
    dax.beacon({ op: 'answer', id });
    expect([bex, ana, far, cor, dax].flatMap((p) => denials(p.take()))).toEqual([
      'answer:unknown',
      'answer:self',
      'answer:elsewhere',
      'answer:in_phase',
      'answer:far',
    ]);
    // nothing changed: the beacon is up with all its slots
    expect(h.social.beacons.of('char-Ana')).toMatchObject({ open: 11 });
    expect([cor, dax, far].map((p) => p.zone.phases.phaseOf(p.entityId))).toEqual([phases.phaseOf(cor.entityId), null, null]);
    // within the volume's hysteresis it may (as a member there counts as inside)
    ana.zone.patch(dax.entityId, { pos: [0, 0, 310] });
    h.tick();
    dax.beacon({ op: 'answer', id });
    expect(newsOf(dax.take())).toMatchObject([{ op: 'joined' }]);
  });

  it('refuses an answer once the instance is full, even before the beacon comes down, and then takes it down', () => {
    const { h, players, phases } = setup(['Ana', 'Bex', 'Cor']);
    const [ana, bex, cor] = players as [Player, Player, Player];
    const wreck = site(ana, 'wreck');
    const event = phases.phaseFor(ana.session, 'event', wreck);
    const id = raise(ana);
    cor.beacon({ op: 'watch' });
    cor.take();
    // eleven more arrive and are placed in it by the phase manager; the beacon is not swept yet
    arrivals(h, 11, wreck, 'Arr');
    h.tick();
    expect(event.members.size).toBe(12);

    bex.beacon({ op: 'answer', id });
    expect(denials(bex.take())).toEqual(['answer:full']);
    expect(phases.phaseOf(bex.entityId)).toBeNull();
    expect(event.members.size).toBe(12);

    // the sweep takes it down: the watchers hear it is gone, the caller why
    h.advance(100);
    expect(listsOf(cor.take())).toEqual([{ t: 'beacons', beacons: [], gone: [id] }]);
    expect(newsOf(ana.take())).toEqual([{ t: 'beacon', op: 'ended', id, why: 'full' }]);
    expect(h.social.beacons.count).toBe(0);
    bex.beacon({ op: 'answer', id });
    expect(denials(bex.take())).toEqual(['answer:unknown']);
  });

  it('takes a beacon down as answers fill the instance', () => {
    const { h, players, phases } = setup(['Ana', 'Bex', 'Cor', 'Dax']);
    const [ana, bex, cor, dax] = players as [Player, Player, Player, Player];
    const wreck = site(ana, 'wreck');
    const event = phases.phaseFor(ana.session, 'event', wreck);
    arrivals(h, 9, wreck, 'Arr');
    h.tick();
    const id = raise(ana);
    dax.beacon({ op: 'watch' });
    expect(listsOf(dax.take())[0]!.beacons).toMatchObject([{ id, open: 2 }]);
    bex.beacon({ op: 'answer', id });
    expect(listsOf(dax.take())).toEqual([{ t: 'beacons', beacons: [expect.objectContaining({ id, open: 1 })], gone: [] }]);
    cor.beacon({ op: 'answer', id });
    expect(event.members.size).toBe(12);
    // the last slot taken, it comes down at once
    expect(listsOf(dax.take())).toEqual([{ t: 'beacons', beacons: [], gone: [id] }]);
    expect(newsOf(ana.take())).toEqual([
      { t: 'beacon', op: 'answered', id, name: 'Bex' },
      { t: 'beacon', op: 'answered', id, name: 'Cor' },
      { t: 'beacon', op: 'ended', id, why: 'full' },
    ]);
    expect(h.social.beacons.count).toBe(0);
  });
});

describe('a beacon’s end', () => {
  it('comes when its caller lowers it, leaves its instance, or the instance closes', () => {
    const { h, players, phases } = setup(['Ana', 'Bex', 'Cor']);
    const [ana, bex, cor] = players as [Player, Player, Player];
    cor.beacon({ op: 'watch' });
    cor.take();
    const event = phases.phaseFor(ana.session, 'event', site(ana, 'wreck'));
    const lowered = raise(ana);
    ana.beacon({ op: 'lower' });
    ana.beacon({ op: 'lower' });
    const ms = ana.take();
    expect(newsOf(ms)).toEqual([{ t: 'beacon', op: 'ended', id: lowered, why: 'lowered' }]);
    expect(denials(ms)).toEqual(['lower:unknown']);

    // the caller goes elsewhere (another instance) while another player holds the first
    const left = raise(ana);
    bex.beacon({ op: 'answer', id: left });
    phases.phaseFor(ana.session, 'raid', site(ana, 'vault'));
    h.advance(100);
    expect(newsOf(ana.take()).at(-1)).toEqual({ t: 'beacon', op: 'ended', id: left, why: 'left' });
    expect(event.open).toBe(true);

    // its instance closes
    const raid = phases.phase(phases.phaseOf(ana.entityId)!)!;
    const closed = raise(ana);
    phases.close(raid.id);
    h.advance(100);
    expect(newsOf(ana.take())).toEqual([{ t: 'beacon', op: 'ended', id: closed, why: 'closed' }]);
    expect(listsOf(cor.take()).flatMap((l) => l.gone)).toEqual([lowered, left, closed]);
    expect(h.lines.filter((l) => l.msg === 'beacon ended').map((l) => l.obj.why)).toEqual(['lowered', 'left', 'closed']);
  });

  it('comes when it lapses, ten minutes after it was raised', () => {
    const { h, players, phases } = setup(['Ana']);
    const [ana] = players as [Player];
    phases.phaseFor(ana.session, 'event', site(ana, 'wreck'));
    const id = raise(ana);
    h.advance(599_000);
    expect(h.social.beacons.count).toBe(1);
    h.advance(1_000);
    expect(newsOf(ana.take())).toEqual([{ t: 'beacon', op: 'ended', id, why: 'expired' }]);
    expect(h.social.beacons.count).toBe(0);
  });

  it('stays up while the caller’s dropped connection keeps its place, and comes down when the place lapses', () => {
    const { h, players, phases } = setup(['Ana', 'Bex', 'Cor']);
    const [ana, bex, cor] = players as [Player, Player, Player];
    const event = phases.phaseFor(ana.session, 'event', site(ana, 'wreck'));
    const id = raise(ana);
    bex.beacon({ op: 'answer', id });
    cor.beacon({ op: 'watch' });
    cor.take();
    h.drop(ana);
    h.advance(1_000);
    expect(event.held.has('char-Ana')).toBe(true);
    expect(h.social.beacons.of('char-Ana')).toMatchObject({ id, open: 10 });
    // a watcher whose connection drops is forgotten
    expect(h.social.beacons.watching).toBe(1);
    h.drop(cor);
    expect(h.social.beacons.watching).toBe(0);

    // past the grace the zone gives the place up, and the beacon comes down (its caller is not there to hear)
    h.advance(15_000);
    h.tick();
    expect(event.held.size).toBe(0);
    h.advance(100);
    expect(h.social.beacons.count).toBe(0);
    expect(h.lines.find((l) => l.msg === 'beacon ended')?.obj).toMatchObject({ beacon: id, why: 'left' });
  });
});

describe('a caller entering again', () => {
  it('hears its beacon is still up, and takes its place back through the phase manager', () => {
    const { h, players, phases } = setup(['Ana']);
    const [ana] = players as [Player];
    const wreck = site(ana, 'wreck');
    const event = phases.phaseFor(ana.session, 'event', wreck);
    const id = raise(ana);
    h.drop(ana);
    h.reconnect(ana);
    expect(newsOf(ana.take())).toEqual([{ t: 'beacon', op: 'raised', id, beacon: expect.objectContaining({ id, open: 11 }) }]);
    expect(phases.phaseFor(ana.session, 'event', wreck)).toBe(event);
    h.advance(100);
    expect(h.social.beacons.of('char-Ana')).toMatchObject({ id, open: 11 });
    expect(ana.take()).toEqual([]);
  });
});

describe('a story beacon', () => {
  it('names its quest, and answering joins the caller’s party as a helper without the quest, in the caller’s phase', () => {
    const { h, players, phases } = setup(['Ana', 'Bex', 'Cor']);
    const [ana, bex, cor] = players as [Player, Player, Player];
    // as the quest runtime places a player in no party at an instanced step
    const step = site(ana, 'quest:first_jobs:gather');
    const chapter = phases.phaseFor(ana.session, 'story', step, null);
    const id = raise(ana);
    expect(h.social.beacons.of('char-Ana')).toMatchObject({ kind: 'story', place: 'First Jobs', quest: 'first_jobs', open: 5, cap: 6 });

    bex.beacon({ op: 'answer', id });
    const party = h.social.partyIdOf('char-Ana');
    expect(party).not.toBeNull();
    expect(h.social.partyIdOf('char-Bex')).toBe(party);
    expect(h.social.parties.of('char-Ana')).toMatchObject({ leader: 'char-Ana', members: ['char-Ana', 'char-Bex'] });
    const bexSaw = bex.take();
    expect(newsOf(bexSaw)).toEqual([{ t: 'beacon', op: 'joined', id, phase: chapter.id }]);
    expect(partyStates(bexSaw).at(-1)).toMatchObject({ leader: 'Ana', members: [{ name: 'Ana' }, { name: 'Bex' }] });
    expect([...chapter.members]).toEqual([ana.entityId, bex.entityId]);
    expect(h.social.beacons.of('char-Ana')).toMatchObject({ open: 4 });
    // the phase is the party's now: another member placed at that step joins it, the caller having been re-placed under it
    ana.party({ op: 'invite', name: 'Cor' });
    cor.party({ op: 'accept', name: 'Ana' });
    expect(phases.phaseFor(cor.session, 'story', step, h.social.partyIdOf('char-Cor'))).toBe(chapter);
    h.advance(100);
    expect(h.social.beacons.of('char-Ana')).toMatchObject({ open: 3 });
  });

  it('re-places a caller placed before it had a party under the party it has, so the answerer shares its phase', () => {
    const { h, players, phases } = setup(['Ana', 'Bex', 'Cor']);
    const [ana, bex, cor] = players as [Player, Player, Player];
    const step = site(ana, 'quest:first_jobs:gather');
    const chapter = phases.phaseFor(ana.session, 'story', step, null);
    // a party formed afterwards, its other member elsewhere
    ana.party({ op: 'invite', name: 'Cor' });
    cor.party({ op: 'accept', name: 'Ana' });
    const id = raise(ana);
    expect(h.social.beacons.of('char-Ana')).toMatchObject({ open: 4 });
    bex.beacon({ op: 'answer', id });
    expect(newsOf(bex.take())).toEqual([{ t: 'beacon', op: 'joined', id, phase: chapter.id }]);
    expect(h.social.parties.of('char-Ana')?.members).toEqual(['char-Ana', 'char-Cor', 'char-Bex']);
    expect(phases.phaseFor(cor.session, 'story', step, h.social.partyIdOf('char-Cor'))).toBe(chapter);
    expect([...chapter.members].sort()).toEqual([ana.entityId, bex.entityId, cor.entityId].sort());
  });

  it('refuses a player in another party, an answer while the caller is away, and a full party before the beacon comes down', () => {
    const { h, players, phases } = setup(['Ana', 'Bex', 'Cor', 'Dax', 'Eli'], { partyMax: 2 });
    const [ana, bex, cor, dax, eli] = players as [Player, Player, Player, Player, Player];
    const chapter = phases.phaseFor(ana.session, 'story', site(ana, 'quest:first_jobs:gather'), null);
    const id = raise(ana);
    expect(h.social.beacons.of('char-Ana')).toMatchObject({ open: 1, cap: 2 });
    bex.party({ op: 'invite', name: 'Cor' });
    cor.party({ op: 'accept', name: 'Bex' });
    bex.take();
    bex.beacon({ op: 'answer', id });
    expect(denials(bex.take())).toEqual(['answer:in_party']);

    // the party fills by invite (Dax accepts); before the sweep, Eli's answer finds no place in it
    ana.party({ op: 'invite', name: 'Dax' });
    dax.party({ op: 'accept', name: 'Ana' });
    eli.beacon({ op: 'answer', id });
    expect(denials(eli.take())).toEqual(['answer:full']);
    expect([h.social.partyIdOf('char-Eli'), phases.phaseOf(eli.entityId)]).toEqual([null, null]);
    expect([...chapter.members]).toEqual([ana.entityId]);
    h.advance(100);
    expect(newsOf(ana.take()).at(-1)).toEqual({ t: 'beacon', op: 'ended', id, why: 'full' });

    // a caller whose connection dropped (its place kept) cannot take anyone into its party
    dax.party({ op: 'leave' });
    const again = raise(ana);
    h.drop(ana);
    eli.beacon({ op: 'answer', id: again });
    expect(denials(eli.take())).toEqual(['answer:gone']);
    expect(h.social.partyIdOf('char-Eli')).toBeNull();
  });
});

describe('watching', () => {
  it('stops at unwatch, and starts over with the whole list on watching again', () => {
    const { players, phases } = setup(['Ana', 'Bex']);
    const [ana, bex] = players as [Player, Player];
    bex.beacon({ op: 'watch' });
    bex.beacon({ op: 'unwatch' });
    bex.take();
    phases.phaseFor(ana.session, 'event', site(ana, 'wreck'));
    const id = raise(ana);
    expect(bex.take()).toEqual([]);
    bex.beacon({ op: 'watch' });
    expect(listsOf(bex.take())).toEqual([{ t: 'beacons', reset: true, beacons: [expect.objectContaining({ id, open: 11 })], gone: [] }]);
  });
});
