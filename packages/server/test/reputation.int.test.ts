// Reputation against the dockerised Postgres and Redis (P2.E18.T01, ARCHITECTURE §24): a quest's reputation reaches the
// reputation service and a rank-up, which the client hears (its rank and title events, then its state), and so does a
// quest's title; standing is held to 0 and 1000; an act against an opposed faction moves it too (DESIGN 14.4); the admin
// CLI's set-rep works in play and out of it; everything survives a rejoin; and owed reputation a save from before
// reputation holds is settled on join exactly once, across a crash before its save and a restart after it.
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import type { QuestLog } from '@astra/shared/quests';
import type { Reputation, ReputationView } from '@astra/shared/reputation';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Operator } from '../src/admin/service.ts';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { characters } from '../src/db/schema.ts';
import { QUESTS } from '../src/persistence/components.ts';
import type { RunningServer } from '../src/server.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, uniqueShard, waitFor } from './helpers.ts';

type Rep = Extract<ServerMessage, { t: 'reputation' }>;
type Event = Extract<ServerMessage, { t: 'event' }>['event'];

const config = parseConfig(process.env);
const OPERATOR: Operator = { name: 'tester', via: 'channel' };
let database: Database;
const running = new Set<RunningServer>();

beforeAll(() => {
  database = createDatabase(config.DATABASE_URL, { max: 2 });
});

afterAll(async () => {
  await Promise.all([...running].map((s) => s.close()));
  await database?.close();
});

async function start(shard: string, intervalMs?: number): Promise<RunningServer> {
  const server = await startTestServer({}, { shard, movement: false, ...(intervalMs ? { persistence: { intervalMs } } : {}) });
  running.add(server);
  return server;
}

async function stop(server: RunningServer): Promise<void> {
  await server.close();
  running.delete(server);
}

async function row(id: string) {
  const [r] = await database.db.select().from(characters).where(eq(characters.id, id));
  return r!;
}

/** A client of the character, joined: every message it was sent, in order. */
async function join(server: RunningServer, token: string, characterId: string) {
  const s = await TestSocket.open(server.wsUrl);
  s.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  s.send({ t: 'join', characterId });
  await s.next('welcome', 10_000);
  const all = () => s.received.filter((m): m is Rep => m.t === 'reputation');
  return {
    s,
    /** the latest reputation it was sent, once one satisfies `pred` */
    async reputation(pred: (v: ReputationView) => boolean = () => true, what = 'its reputation'): Promise<ReputationView> {
      await waitFor(() => all().length > 0 && pred(all().at(-1)!.reputation), 5000, what);
      return all().at(-1)!.reputation;
    },
    /** the rank and title events it was sent */
    news: (): Event[] => s.received.flatMap((m) => (m.t === 'event' && (m.event.kind === 'rank' || m.event.kind === 'title') ? [m.event] : [])),
    /** the kinds of the reputation messages and events, in order */
    order: () =>
      s.received.flatMap((m) =>
        m.t === 'reputation' ? ['state'] : m.t === 'event' && (m.event.kind === 'rank' || m.event.kind === 'title') ? [m.event.kind] : [],
      ),
  };
}

const rep = (v: ReputationView, faction: string) => v.factions.find((f) => f.faction === faction)!;

/** Waits until the character's last save is written and it is no longer held. */
async function released(server: RunningServer, characterId: string): Promise<void> {
  await waitFor(() => server.persistence.status(characterId) === null, 5000, 'the character to be released');
}

describe('reputation over the wire', () => {
  it('a quest grants reputation and a rank-up the client hears, a quest’s title too, and all of it survives a rejoin', async () => {
    const server = await start(uniqueShard());
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const a = await join(server, acct.token, character.id);
    // after the recipes on join: every faction of the table, none with standing
    const first = await a.reputation();
    expect(first.factions).toHaveLength(6);
    expect(first.factions.every((f) => f.rep === 0 && f.rank === null)).toBe(true);
    expect(first.titles).toEqual([]);

    expect(await server.admin.run({ cmd: 'set-rep', character: character.id, faction: 'compact', value: 150 }, OPERATOR)).toMatchObject({
      online: true,
      from: 0,
      rep: 150,
      rank: null,
    });
    await a.reputation((v) => rep(v, 'compact').rep === 150, 'compact at 150');

    // Wing over Rolis III, at its report: the Quartermaster hears it, and the Compact pays its 60 (DESIGN 14.8)
    expect(server.quests.setStep(character.id, 'wing_over_rolis_iii', 3)).toBeNull();
    a.s.received.length = 0;
    expect(server.quests.event(character.id, { type: 'interact', target: 'npc:quartermaster' })).toBe(true);
    const ranked = await a.reputation((v) => rep(v, 'compact').rep === 210, 'compact at 210');
    expect(rep(ranked, 'compact')).toEqual({ faction: 'compact', rep: 210, rank: 'hand' });
    expect(ranked.titles).toEqual([{ title: 'Hand', faction: 'compact' }]);
    expect(a.news()).toEqual([
      { kind: 'rank', faction: 'compact', rank: 'hand', from: null },
      { kind: 'title', title: { title: 'Hand', faction: 'compact' } },
    ]);
    expect(a.order()).toEqual(['rank', 'title', 'state']);
    // nothing owed: it went straight to the reputation
    expect(server.quests.stateOf(character.id)!.owed).toEqual([]);

    // Forty Names, at its last step: its title (DESIGN 14.8: "Unlisted")
    expect(server.quests.setStep(character.id, 'forty_names', 5)).toBeNull();
    server.quests.event(character.id, { type: 'cutscene_end', cutscene: 'forty_names_wiped_log' });
    const titled = await a.reputation((v) => v.titles.length === 2, 'the quest’s title');
    expect(titled.titles).toEqual([
      { title: 'Hand', faction: 'compact' },
      { title: 'Unlisted', quest: 'forty_names' },
    ]);
    expect(a.news().at(-1)).toEqual({ kind: 'title', title: { title: 'Unlisted', quest: 'forty_names' } });

    // a rejoin loads it as it was
    a.s.close();
    await released(server, character.id);
    expect((await row(character.id)).state.reputation).toEqual({ v: 1, data: { rep: { compact: 210 }, titles: titled.titles } });
    const b = await join(server, acct.token, character.id);
    expect(await b.reputation()).toEqual(titled);
    expect(server.ws.reputation.rankOf(character.id, 'compact')).toBe('hand');
    b.s.close();
  });

  it('holds standing to 0 and 1000, moves the opposed faction with an act, and sets standing in play and out of it', async () => {
    const server = await start(uniqueShard());
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token);
    const a = await join(server, acct.token, character.id);
    await a.reputation();
    await server.admin.run({ cmd: 'set-rep', character: character.id, faction: 'compact', value: 990 }, OPERATOR);
    await server.admin.run({ cmd: 'set-rep', character: character.id, faction: 'reaches', value: 10 }, OPERATOR);
    // a quest's 60 at 990: held at 1000
    expect(server.quests.setStep(character.id, 'wing_over_rolis_iii', 3)).toBeNull();
    server.quests.event(character.id, { type: 'interact', target: 'npc:quartermaster' });
    await a.reputation((v) => rep(v, 'compact').rep === 1000, 'compact held at 1000');

    // a convoy escorted (P2.E21.T05 will report it): the Compact gains (held at 1000), the opposed Reaches lose (held at 0)
    const escorted = server.ws.reputation.act(character.id, 'convoy_escorted')!;
    expect(escorted.map((c) => [c.faction, c.from, c.to])).toEqual([
      ['compact', 1000, 1000],
      ['reaches', 10, 0],
    ]);
    const after = await a.reputation((v) => rep(v, 'reaches').rep === 0, 'reaches held at 0');
    expect(rep(after, 'compact').rep).toBe(1000);
    // raided: the Reaches gain, the opposed Compact loses
    server.ws.reputation.act(character.id, 'convoy_raided');
    const raided = await a.reputation((v) => rep(v, 'reaches').rep === 50, 'the raid');
    expect(rep(raided, 'compact')).toEqual({ faction: 'compact', rep: 975, rank: 'lanewarden' });

    // out of play: the stored value, as its next join loads it
    a.s.close();
    await released(server, character.id);
    expect(await server.admin.run({ cmd: 'set-rep', character: character.name, faction: 'chorus', value: 800 }, OPERATOR)).toMatchObject({
      online: false,
      rep: 800,
      rank: 'voice',
      titles: ['Listener', 'Reader', 'Voice'],
      changed: ['reputation'],
    });
    const b = await join(server, acct.token, character.id);
    const loaded = await b.reputation();
    expect([rep(loaded, 'compact').rep, rep(loaded, 'reaches').rep, rep(loaded, 'chorus').rank]).toEqual([975, 50, 'voice']);
    expect(loaded.titles.map((t) => t.title)).toEqual(['Hand', 'Factor', 'Lanewarden', 'Listener', 'Reader', 'Voice']);
    b.s.close();
  });

  it('settles owed reputation from a save made before reputation existed exactly once, across a crash and a restart', async () => {
    const shard = uniqueShard();
    // (no periodic save while the test runs: the crash below must find the settle unsaved)
    const first = await start(shard, 3_600_000);
    const acct = await newAccount(first);
    const character = await newCharacter(first, acct.token);
    // the save as P1.E09.T01 left it: reputation and titles owed in the quest log, no reputation entry
    const owed: QuestLog['owed'] = [
      { kind: 'rep', quest: 'the_apothecarys_sodium', faction: 'belost', amount: 30 },
      { kind: 'rep', quest: 'wing_over_rolis_iii', faction: 'compact', amount: 180 },
      { kind: 'rep', quest: 'wing_over_rolis_iii', faction: 'compact', amount: 60 },
      { kind: 'title', quest: 'forty_names', title: 'Unlisted' },
    ];
    const edited = await first.persistence.edit(character.id, (e) => {
      const log = e.get<QuestLog>(QUESTS);
      log.owed = owed;
      e.set(QUESTS, log);
    });
    expect(edited).toMatchObject({ ok: true, changed: [QUESTS] });
    expect((await row(character.id)).state.reputation).toBeUndefined();
    const settled = (v: ReputationView) => rep(v, 'belost').rep === 30;
    const expected = { belost: 30, compact: 240 };

    // joined: settled, a rank reached on the way (Hand), the client told
    const a = await join(first, acct.token, character.id);
    const v1 = await a.reputation(settled, 'the owed reputation');
    expect([rep(v1, 'belost').rep, rep(v1, 'compact').rep, rep(v1, 'compact').rank]).toEqual([30, 240, 'hand']);
    expect(v1.titles).toEqual([
      { title: 'Hand', faction: 'compact' },
      { title: 'Unlisted', quest: 'forty_names' },
    ]);
    expect(a.news()).toContainEqual({ kind: 'rank', faction: 'compact', rank: 'hand', from: null });
    expect(first.quests.stateOf(character.id)!.owed).toEqual([]);

    // a crash before any save: the row still holds the owed list, and no standing
    first.persistence.abandon();
    a.s.close();
    await stop(first);
    const crashed = await row(character.id);
    expect((crashed.state.quests!.data as QuestLog).owed).toEqual(owed);
    expect(crashed.state.reputation).toBeUndefined();

    // restarted: settled again from the row, once in all
    const second = await start(shard, 3_600_000);
    const b = await join(second, acct.token, character.id);
    const v2 = await b.reputation(settled, 'the owed reputation again');
    expect(v2).toEqual(v1);
    b.s.close();
    await released(second, character.id);
    const saved = await row(character.id);
    expect((saved.state.quests!.data as QuestLog).owed).toEqual([]);
    expect((saved.state.reputation!.data as Reputation).rep).toEqual(expected);

    // after that save, a restart and a rejoin settle nothing more
    await stop(second);
    const third = await start(shard, 3_600_000);
    const c = await join(third, acct.token, character.id);
    expect(await c.reputation()).toEqual(v1);
    await new Promise((r) => setTimeout(r, 200));
    expect(c.s.received.filter((m) => m.t === 'reputation')).toHaveLength(1);
    expect(c.news()).toEqual([]);
    expect(third.ws.reputation.get(character.id)!.rep).toEqual(expected);
    c.s.close();
  });
});
