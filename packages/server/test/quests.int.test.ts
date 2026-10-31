// Quests over the wire, against the dockerised Postgres and Redis (P1.E09.T01): a new character is given First Jobs;
// DESIGN 14.8's "The Apothecary's Sodium" is played end to end by bot clients and the events the systems that do not
// exist yet will send (a board's offer, mining's sodium, the NPC framework's interaction): accepted by request, collected
// from the inventory, delivered in the apothecary's shop, an instanced step in Belost's market whose apothecary only the party on it sees
// (a player on it alone has its own; a passer-by sees neither), answered in dialogue, rewarded (Belost's reputation
// included, P2.E18.T01); and a character's quests as it left them after the server restarts, mid-quest and finished.
import { countOf } from '@astra/shared/inventory';
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import { BELOST_SYSTEM, getQuest, resolvePlace, type Place, type QuestOp } from '@astra/shared/quests';
import { afterAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';
import { SnapshotClient } from './snapshotClient.ts';

const running = new Set<RunningServer>();

afterAll(async () => {
  await Promise.all([...running].map((s) => s.close()));
});

async function start(): Promise<RunningServer> {
  // (its bots are put on a world with raw poses, straight from the Waystation: no movement authority here)
  const server = await startTestServer({}, { movement: false });
  running.add(server);
  return server;
}

async function stop(server: RunningServer): Promise<void> {
  await server.close();
  running.delete(server);
}

type Quests = Extract<ServerMessage, { t: 'quests' }>;
const APOTHECARY = 'the_apothecarys_sodium';
/** Her stall in Belost's market, where her steps are instanced. */
const SHOP = getQuest(APOTHECARY)!.steps.find((s) => s.id === 'deliver')!.phase!.at as Place;

/** An Ulgani bot in the world (Belost's system): signed in, joined, applying and acknowledging every snapshot. */
async function bot(server: RunningServer, existing?: { token: string; characterId: string }) {
  const token = existing?.token ?? (await newAccount(server)).token;
  const characterId = existing?.characterId ?? (await newCharacter(server, token, { people: 'ulgani' })).id;
  const sock = await TestSocket.open(server.wsUrl);
  const client = new SnapshotClient();
  sock.ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const snap = client.receive(new Uint8Array(data as Buffer));
    sock.send({ t: 'ack', tick: snap.tick });
  });
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  const first = await sock.next('quests');
  const zone = server.zones.zone(welcome.zone.id)!;
  let seq = 0;
  const b = {
    token,
    characterId,
    name: welcome.character.name,
    sock,
    client,
    zone,
    entityId: welcome.entityId,
    first,
    /** the latest quest state it was sent, waiting for one that satisfies `pred` */
    async quests(pred: (m: Quests) => boolean, what: string): Promise<Quests> {
      const latest = () => sock.received.filter((m): m is Quests => m.t === 'quests').at(-1);
      await waitFor(() => !!latest() && pred(latest()!), 5000, `${b.name}: quests ${what}`);
      return latest()!;
    },
    /** sends a quest request and waits for its answer */
    async ask(op: QuestOp): Promise<Quests> {
      const n = ++seq;
      sock.send({ t: 'quest', seq: n, op });
      return b.quests((m) => m.seq === n, `answer ${n}`);
    },
    /** stands it at the apothecary's stall in Belost's market (the travel itself is movement's, not under test here) */
    toShop(): void {
      const r = resolvePlace(SHOP, { index: zone.systemIndex, description: zone.system }, zone.systemIndex)!;
      zone.patch(b.entityId, { frame: r.frame, pos: r.center, vel: [0, 0, 0], mode: 'foot' });
    },
    phase: () => zone.phases.phaseOf(b.entityId),
    sees: (id: number) => client.latest.has(id),
  };
  return b;
}

type Bot = Awaited<ReturnType<typeof bot>>;

/** Waits until `n` more ticks have reached every bot. */
async function ticks(bots: Bot[], n: number): Promise<void> {
  const target = bots[0]!.zone.tick + n;
  await waitFor(() => bots.every((b) => (b.client.latestTick ?? 0) >= target), 5000, `${n} ticks`);
}

async function party(a: Bot, b: Bot): Promise<void> {
  a.sock.send({ t: 'party', op: { op: 'invite', name: b.name } });
  await waitFor(() => b.sock.received.some((m) => m.t === 'event' && m.event.kind === 'party' && m.event.what === 'invite'), 5000, 'the invite');
  b.sock.send({ t: 'party', op: { op: 'accept', name: a.name } });
  await waitFor(() => [a, b].every((x) => x.sock.received.some((m) => m.t === 'party' && m.party?.members.length === 2)), 5000, 'the party');
}

describe('quests over the wire', () => {
  it('plays the apothecary’s quest end to end, its shop a phase the party on it shares, and keeps quests across a restart', async () => {
    let server = await start();
    const [a, b, c, d] = [await bot(server), await bot(server), await bot(server), await bot(server)];
    expect(a.zone.systemIndex).toBe(BELOST_SYSTEM);
    // a new character is given First Jobs
    expect(a.first).toMatchObject({ seq: 0, quests: { active: { first_jobs: { step: 'land' } }, done: {}, offered: [] } });
    await party(a, b);

    // a board offers the job (P1.E09.T06 will); three take it, the fourth only passes by
    for (const x of [a, b, c]) {
      expect(server.quests.offer(x.characterId, APOTHECARY)).toBeNull();
      await x.quests((m) => m.quests.offered.includes(APOTHECARY), 'the offer');
      expect((await x.ask({ op: 'accept', quest: APOTHECARY })).quests.active[APOTHECARY]).toMatchObject({ step: 'sodium' });
    }
    expect((await d.ask({ op: 'accept', quest: APOTHECARY })).error).toBe('not_offered');

    // mining puts the sodium in their suits (P1.E13.T01 will): the collect step reads it
    for (const x of [a, b, c]) {
      server.ws.inventory.grant(x.characterId, 'sodium', 40);
      await x.quests((m) => m.quests.active[APOTHECARY]?.step === 'deliver', 'the deliver step');
    }

    // at her stall in Belost's market: the party in one phase with one apothecary, the third alone with its own
    for (const x of [a, b, c, d]) x.toShop();
    await waitFor(() => [a, b, c].every((x) => x.phase() !== null), 5000, 'the shop phases');
    expect(b.phase()).toBe(a.phase());
    expect(c.phase()).not.toBe(a.phase());
    expect(d.phase()).toBeNull();
    const shop = (x: Bot) => [...a.zone.phases.phase(x.phase()!)!.entities];
    expect(shop(a)).toHaveLength(1);
    const [theirs] = shop(a);
    const [its] = shop(c);
    await waitFor(() => a.sees(theirs!) && b.sees(theirs!) && c.sees(its!), 5000, 'each to see its apothecary');
    await ticks([a, b, c, d], 10);
    expect(a.client.latest.get(theirs!)).toMatchObject({ kind: 'npc', name: 'Apothecary' });
    expect(a.sees(its!) || b.sees(its!) || c.sees(theirs!) || d.sees(theirs!) || d.sees(its!)).toBe(false);
    for (const x of [a, b, c, d]) expect(x.client.snapshots.some((s) => s.entities.some((e) => e.id === (x === c ? theirs : its)))).toBe(false);
    // (players stay in sight of each other: a story phase hides only its actors)
    expect([b, c].every((x) => d.sees(x.entityId) && a.sees(x.entityId))).toBe(true);

    // the NPC framework reports the talk (P1.E09.T05 will): she takes the forty
    const units = server.ws.inventory.get(a.characterId)!.units;
    for (const x of [a, b]) {
      expect(server.quests.event(x.characterId, { type: 'interact', target: 'npc:apothecary' })).toBe(true);
      await x.quests((m) => m.quests.active[APOTHECARY]?.step === 'lake', 'the talk');
      expect(countOf(server.ws.inventory.get(x.characterId)!, 'sodium')).toBe(0);
    }
    expect(a.phase()).toBe(b.phase());

    // a answers: done, rewarded, and out of the shop, which stays open for b
    const done = await a.ask({ op: 'choose', quest: APOTHECARY, step: 'lake', choice: 'heard' });
    expect(done.error).toBeUndefined();
    expect(done.quests.done).toEqual({ [APOTHECARY]: 1 });
    expect(done.quests.flags).toEqual(['heard_the_lake_stone']);
    expect(a.sock.received).toContainEqual({ t: 'event', event: { kind: 'quest', questId: APOTHECARY, step: 2, status: 'completed' } });
    await waitFor(() => a.sock.received.some((m) => m.t === 'inventory' && m.inventory.units === units + 600), 5000, 'the units');
    // Hazard Weave's unlock reaches the skill service through the quest's route, Belost's 30 the reputation (P2.E18.T01)
    expect(server.ws.skills.get(a.characterId)!.unlocked).toContain('hazard_weave');
    expect(server.quests.stateOf(a.characterId)!.owed).toEqual([]);
    expect(server.ws.reputation.standing(a.characterId, 'belost')).toBe(30);
    await waitFor(
      () => a.sock.received.some((m) => m.t === 'reputation' && m.reputation.factions.some((f) => f.faction === 'belost' && f.rep === 30)),
      5000,
      'the reputation',
    );
    expect(a.phase()).toBeNull();
    expect(a.zone.entity(theirs!)).toBeDefined();
    expect((await b.ask({ op: 'choose', quest: APOTHECARY, step: 'lake', choice: 'nothing' })).quests.flags).toEqual([]);
    expect(a.zone.entity(theirs!)).toBeUndefined();

    // the server restarts with c mid-quest (in its shop, holding the sodium) and a finished
    for (const x of [a, b, c, d]) x.sock.close();
    await Promise.all([a, b, c, d].map((x) => x.sock.closed));
    await stop(server);
    server = await start();

    const c2 = await bot(server, c);
    expect(c2.first.quests.active[APOTHECARY]).toMatchObject({ step: 'deliver' });
    expect(countOf(server.ws.inventory.get(c.characterId)!, 'sodium')).toBe(40);
    // back where it was saved, it is put in a shop of its own again
    await waitFor(() => c2.phase() !== null, 5000, 'c back in a shop');
    const [again] = [...c2.zone.phases.phase(c2.phase()!)!.entities];
    await waitFor(() => c2.sees(again!), 5000, 'c to see the apothecary');
    server.quests.event(c.characterId, { type: 'interact', target: 'npc:apothecary' });
    await c2.quests((m) => m.quests.active[APOTHECARY]?.step === 'lake', 'the talk');
    expect((await c2.ask({ op: 'choose', quest: APOTHECARY, step: 'lake', choice: 'nothing' })).quests.done[APOTHECARY]).toBe(1);

    const a2 = await bot(server, a);
    // (First Jobs moved on as well: it stood on its home world holding forty sodium, so it landed and gathered)
    expect(a2.first.quests).toMatchObject({ done: { [APOTHECARY]: 1 }, flags: ['heard_the_lake_stone'], active: { first_jobs: { step: 'site' } } });
    expect(server.ws.skills.get(a.characterId)!.unlocked).toContain('hazard_weave');
    expect(server.ws.inventory.get(a.characterId)!.units).toBe(units + 600);
    expect(server.quests.stateOf(a.characterId)!.owed).toEqual([]);
    expect(server.ws.reputation.standing(a.characterId, 'belost')).toBe(30);
    // finished once, it is not on offer again
    expect(server.quests.offer(a.characterId, APOTHECARY)).toBe('done');
    c2.sock.close();
    a2.sock.close();
  });

  it('moves First Jobs from where the character’s entity is, and refuses quest requests out of place', async () => {
    const server = await start();
    const x = await bot(server);
    expect(x.first.quests.active.first_jobs?.step).toBe('land');
    x.toShop();
    x.zone.patch(x.entityId, { mode: 'landed' });
    const landed = await x.quests((m) => m.quests.active.first_jobs?.step === 'gather', 'the gather step');
    expect(landed.seq).toBe(0);
    expect(x.sock.received).toContainEqual({ t: 'event', event: { kind: 'quest', questId: 'first_jobs', step: 1, status: 'step' } });
    expect((await x.ask({ op: 'abandon', quest: 'first_jobs' })).error).toBe('cannot_abandon');
    x.sock.send({ t: 'quest', seq: 1, op: { op: 'accept', quest: APOTHECARY } });
    expect((await x.quests((m) => m.error === 'stale_seq', 'a stale request')).seq).toBe(1);
    x.sock.close();
  });
});
