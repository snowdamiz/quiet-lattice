// Developer tooling against the dockerised Postgres and Redis (P1.E03.T07): the dev login bypass, on and off and refused
// in production; the CLI over the admin channel changing characters in play through the live services (teleport within a
// zone and across zones, grant, skill points, mute) and out of play through persistence's load–modify–save, which their
// next join loads; a join during an offline edit waiting for its write, and an edit right after a disconnect waiting for
// the held save; set-quest-step through the quest runtime in play (its client sent `quests`) and on the stored quest log
// out of play; who, zones, metrics, spawn and despawn; the channel's guard; direct mode; and the script itself.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { STATION_LAYOUT } from '@astra/shared/data';
import { addItem, countOf, type Inventory } from '@astra/shared/inventory';
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import { pointsOf } from '@astra/shared/skills';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_HEALTH_PATH, ADMIN_PATH } from '../src/admin/channel.ts';
import { MOVED_CLOSE_CODE } from '../src/admin/service.ts';
import { runCli } from '../src/cli/run.ts';
import { parseConfig } from '../src/config.ts';
import { INVENTORY } from '../src/persistence/components.ts';
import { startServer, type RunningServer } from '../src/server.ts';
import { homeSystemOf, stationFrame } from '../src/world/home.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { api, newAccount, newCharacter, startTestServer, TestSocket, uniqueUsername, waitFor } from './helpers.ts';

const SECRET = 'integration-admin-secret';
const HOME = homeSystemOf('thalune');
const OTHER = HOME === 0 ? 1 : 0;

let server: RunningServer;
const extra = new Set<RunningServer>();

beforeAll(async () => {
  server = await startTestServer({}, { tooling: { ASTRA_DEV_LOGIN: true, ASTRA_ADMIN_SECRET: SECRET, ASTRA_ADMIN_PORT: 0 } });
});

afterAll(async () => {
  await Promise.all([...extra].map((s) => s.close()));
  await server?.close();
});

interface CliRun {
  code: number;
  out: string;
  err: string;
}

async function cli(
  args: string[],
  env: Record<string, string> = { ASTRA_ADMIN_URL: server.adminUrl!, ASTRA_ADMIN_SECRET: SECRET, ASTRA_OPERATOR: 'tester' },
): Promise<CliRun> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, env, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** Runs a command that must succeed and returns the server's result. */
async function run(...args: string[]): Promise<Record<string, unknown>> {
  const r = await cli(['--json', ...args]);
  expect(r.code, r.err).toBe(0);
  return JSON.parse(r.out) as Record<string, unknown>;
}

type InventoryState = Extract<ServerMessage, { t: 'inventory' }>;
type SkillsState = Extract<ServerMessage, { t: 'skills' }>;
type QuestsState = Extract<ServerMessage, { t: 'quests' }>;

async function join(token: string, characterId: string) {
  const s = await TestSocket.open(server.wsUrl);
  s.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  s.send({ t: 'join', characterId });
  const welcome = await s.next('welcome');
  const inventory = await s.next('inventory');
  const skills = await s.next('skills');
  return { s, welcome, inventory, skills };
}

async function player() {
  const acct = await newAccount(server);
  const character = await newCharacter(server, acct.token);
  return { acct, character };
}

const available = (m: SkillsState) => pointsOf(m.skills.state, m.skills.level).available;
/** The step (its id) quest `quest` is at in a `quests` message, if it is on. */
const stepOf = (m: ServerMessage, quest: string) => (m.t === 'quests' ? (m as QuestsState).quests.active[quest]?.step : undefined);

/** Waits until the character's last save is written and it is no longer held. */
async function released(characterId: string): Promise<void> {
  await waitFor(() => server.persistence.status(characterId) === null, 5000, 'the character to be released');
}

describe('dev login', () => {
  it('signs a dev account in without a password, making it and a character on first use', async () => {
    const name = `it${Date.now().toString(36)}`;
    const first = await api<Record<string, unknown>>(server, 'POST', '/auth/dev', { body: { name } });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ created: true, character: { name: expect.stringMatching(/^Dev [A-Z][a-z]+/), people: 'thalune', level: 1 } });
    const token = first.body.token as string;
    const character = first.body.character as { id: string };

    const again = await api<Record<string, unknown>>(server, 'POST', '/auth/dev', { body: { name: name.toUpperCase() } });
    expect(again.body).toMatchObject({ created: false, accountId: first.body.accountId, character: { id: character.id } });
    const list = await api<{ characters: { id: string }[] }>(server, 'GET', '/characters', { token: again.body.token as string });
    expect(list.body.characters.map((c) => c.id)).toEqual([character.id]);

    // the session is a real one: the character enters the world
    const { s, welcome } = await join(token, character.id);
    expect(welcome.character.id).toBe(character.id);
    s.close();

    const ixari = await api<Record<string, unknown>>(server, 'POST', '/auth/dev', { body: { name, people: 'ixari' } });
    expect(ixari.body).toMatchObject({ accountId: first.body.accountId, character: { people: 'ixari' } });
    expect((ixari.body.character as { id: string }).id).not.toBe(character.id);

    expect((await api(server, 'POST', '/auth/dev', { body: { name: 'no spaces' } })).status).toBe(400);
    expect((await api(server, 'POST', '/auth/dev', { body: {} })).status).toBe(400);
    // the account has no password anyone knows
    expect((await api(server, 'POST', '/auth/login', { body: { username: `dev-${name}`, password: 'password1' } })).status).toBe(401);
  });

  it('reaches dev accounts only: registering a dev- username is refused, and a player’s account is never signed into', async () => {
    for (const username of ['dev-mallory', 'DEV-Mallory', 'Dev-x1']) {
      const r = await api<{ error: string; message: string }>(server, 'POST', '/auth/register', { body: { username, password: 'password123' } });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'reserved_username', message: 'Usernames starting with "dev-" are reserved for development.' });
    }
    // a player whose username is a dev login's name: the dev login makes dev-<name>, never touching the player
    const username = `pl${Date.now().toString(36)}`;
    const reg = await api<{ accountId: string; token: string }>(server, 'POST', '/auth/register', { body: { username, password: 'password123' } });
    expect(reg.status).toBe(201);
    const mine = await newCharacter(server, reg.body.token);
    const dev = await api<{ accountId: string; token: string; character: { id: string } }>(server, 'POST', '/auth/dev', { body: { name: username } });
    expect(dev.status).toBe(200);
    expect(dev.body.accountId).not.toBe(reg.body.accountId);
    const listed = await api<{ characters: { id: string }[] }>(server, 'GET', '/characters', { token: dev.body.token });
    expect(listed.body.characters.map((c) => c.id)).not.toContain(mine.id);
    expect(listed.body.characters.map((c) => c.id)).toEqual([dev.body.character.id]);
  });

  it('is not served with the flag off, and refused at start in production', async () => {
    const off = await startTestServer();
    extra.add(off);
    expect(off.tooling.devLogin).toBe(false);
    expect((await api(off, 'POST', '/auth/dev', { body: { name: 'nope' } })).status).toBe(404);

    const production = { NODE_ENV: 'production' as const, JWT_SECRET: 'p'.repeat(40) };
    await expect(startTestServer(production, { tooling: { ASTRA_DEV_LOGIN: true } })).rejects.toThrow(/never allowed in production/);
    await expect(startTestServer(production, { tooling: { ASTRA_ADMIN_SECRET: SECRET } })).rejects.toThrow(/ASTRA_ADMIN_IN_PRODUCTION/);
    // with NODE_ENV unset, only on a loopback host (as the dev JWT secret)
    const config = parseConfig(process.env);
    const unset = { DATABASE_URL: config.DATABASE_URL, REDIS_URL: config.REDIS_URL, JWT_SECRET: 'n'.repeat(40), LOG_LEVEL: 'silent' };
    await expect(startServer({ env: unset, host: '0.0.0.0', port: 0, tooling: { ASTRA_DEV_LOGIN: true } })).rejects.toThrow(/NODE_ENV unset .* loopback HOST/);
    const prod = await startTestServer(production);
    extra.add(prod);
    expect(prod.adminUrl).toBeNull();
    expect((await api(prod, 'POST', '/auth/dev', { body: { name: 'nope' } })).status).toBe(404);
  });
});

describe('the CLI on characters in play', () => {
  it('teleports within the zone by a correction', async () => {
    const { acct, character } = await player();
    const { s, welcome } = await join(acct.token, character.id);
    const near = await run('teleport', character.name, String(HOME), 'station', 'orbit:500');
    expect(near).toMatchObject({ online: true, moved: 'zone', system: HOME, mode: 'ship', pose: { pos: [0, 0, 500] } });
    const correction = await s.next('correction');
    expect(correction).toMatchObject({ pose: { pos: [0, 0, 500] }, mode: 'ship' });
    const zone = server.zones.zone(`sys:${HOME}`)!;
    const session = [...server.ws.registry.sessions].find((x) => x.characterId === character.id)!;
    expect(zone.entity(session.entityId!)!.fields).toMatchObject({ pos: [0, 0, 500], mode: 'ship' });
    const who = await run('who');
    expect(who.online).toContainEqual(expect.objectContaining({ character: character.id, name: character.name, zone: `sys:${HOME}`, mode: 'ship' }));

    // movement authority judges the client's next input from the teleport, not from the pad it left: not refused
    const input = (seq: number, pos: [number, number, number], mode: 'ship' | 'docked', quat = [0, 0, 0, 1]) =>
      s.send({ t: 'input', seq, time: server.world.clock.now(), mode, pose: { frame: stationFrame(HOME), pos, quat, vel: [0, 0, 0] }, buttons: 0 });
    // (an input from its old trajectory, still on its way when the teleport came: refused quietly, no strike)
    input(1, welcome.pose.pos as [number, number, number], 'docked', welcome.pose.quat);
    input(2, [0, 0, 501], 'ship');
    await waitFor(() => zone.entity(session.entityId!)!.fields.pos[2] === 501, 5000, 'the input after the teleport');
    // and docked: on whichever pad is free, where its next input is judged from
    const docked = await run('teleport', character.name, String(HOME), 'station', 'docked');
    expect(docked).toMatchObject({ online: true, moved: 'zone', mode: 'docked' });
    const toPad = await s.next('correction');
    expect(toPad.mode).toBe('docked');
    const pad = toPad.pose;
    expect(STATION_LAYOUT.pads.some((p) => p.x === pad.pos[0] && p.z === pad.pos[2])).toBe(true);
    input(3, pad.pos as [number, number, number], 'docked', pad.quat);
    await waitFor(() => zone.entity(session.entityId!)!.input?.seq === 3, 5000, 'the docked input after the teleport');
    expect(zone.entity(session.entityId!)!.fields.mode).toBe('docked');
    // (no correction but the teleports' own)
    expect(s.received.filter((m) => m.t === 'correction')).toEqual([]);
    expect(zone.movement!.recent.filter((r) => r.entity === session.entityId)).toEqual([]);
    s.close();
  });

  it('moves a character in play to another system by saving it there and closing its socket without a refusal', async () => {
    const { acct, character } = await player();
    const { s } = await join(acct.token, character.id);
    // the client keeps flying in its old system's frames throughout, as a real one would
    let seq = 0;
    const pose = { frame: stationFrame(HOME), pos: [0, 0, 300], quat: [0, 0, 0, 1], vel: [0, 0, 0] };
    const flying = setInterval(() => {
      if (s.ws.readyState === s.ws.OPEN) s.send({ t: 'input', seq: ++seq, time: 0, mode: 'ship', pose, buttons: 0 });
    }, 20);
    try {
      await waitFor(() => seq >= 10, 5000, 'inputs before the teleport');
      const far = await run('teleport', character.id.toUpperCase(), String(OTHER), 'station', 'docked');
      expect(far).toMatchObject({ online: true, moved: 'reconnect', system: OTHER, mode: 'docked', changed: ['pose'] });
      const closed = await s.closed;
      expect(closed.code).toBe(MOVED_CLOSE_CODE);
    } finally {
      clearInterval(flying);
    }
    // no refusal: a client reconnects after a close like this one
    expect(s.received.filter((m) => m.t === 'refused')).toEqual([]);
    // out of its old zone at once
    const old = server.zones.zone(`sys:${HOME}`);
    expect(old ? [...old.entityIds()].map((id) => old.entity(id)!.fields.name) : []).not.toContain(character.name);
    await waitFor(() => ![...server.ws.registry.sessions].some((x) => x.characterId === character.id), 5000, 'the old session to go');

    // the reconnect is welcomed in the new system, docked
    const back = await join(acct.token, character.id);
    expect(back.welcome.zone.id).toBe(`sys:${OTHER}`);
    expect(back.welcome.mode).toBe('docked');
    expect((await run('who')).online).toContainEqual(expect.objectContaining({ character: character.id, zone: `sys:${OTHER}` }));
    back.s.close();
  });

  it('grants items and units and sets skill points through the live services, which push the state', async () => {
    const { acct, character } = await player();
    const { s, inventory, skills } = await join(acct.token, character.id);
    expect(countOf(inventory.inventory, 'ferrite')).toBe(0);

    expect(await run('grant', character.name, 'ferrite', '120')).toMatchObject({ online: true, added: 120, remainder: 0 });
    const pushed: InventoryState = await s.next('inventory');
    expect(countOf(pushed.inventory, 'ferrite')).toBe(120);
    expect(await run('grant', character.name, 'units', '-500')).toMatchObject({ online: true, units: 2000 });
    expect((await s.next('inventory')).inventory.units).toBe(2000);

    const broke = await cli(['grant', character.name, 'units', '-100000']);
    expect(broke.code).toBe(1);
    expect(broke.err).toMatch(/^error \(refused\)/);
    const unknown = await cli(['grant', character.name, 'unobtainium', '1']);
    expect(unknown.err).toMatch(/^error \(invalid\): no item or resource unobtainium/);

    expect(available(skills)).toBe(1);
    expect(await run('set-skill-points', character.name, '9')).toMatchObject({ online: true, available: 9 });
    expect(available(await s.next('skills'))).toBe(9);
    s.close();
  });

  it('sets a quest’s step through the quest runtime, which sends the client its quests', async () => {
    const { acct, character } = await player();
    const { s } = await join(acct.token, character.id);
    // (a new character is given First Jobs on join, at its first step)
    expect(stepOf(await s.next('quests'), 'first_jobs')).toBe('land');
    expect(await run('set-quest-step', character.name, 'first_jobs', '3')).toEqual({
      character: character.id,
      name: character.name,
      quest: 'first_jobs',
      step: 3,
      online: true,
    });
    const pushed = await s.next('quests');
    expect(stepOf(pushed, 'first_jobs')).toBe('analyze');
    expect(server.quests.stateOf(character.id)?.active.first_jobs?.step).toBe('analyze');
    // a quest it is not on starts there
    expect(await run('set-quest-step', character.name, 'wing_over_rolis_iii', '1')).toMatchObject({ online: true, step: 1 });
    expect(stepOf(await s.next('quests'), 'wing_over_rolis_iii')).toBe('wing');

    const past = await cli(['set-quest-step', character.name, 'first_jobs', '99']);
    expect(past.code).toBe(1);
    expect(past.err).toMatch(/^error \(refused\): quest first_jobs has steps 0 to 6/);
    expect((await cli(['set-quest-step', character.name, 'no_such_quest', '0'])).err).toMatch(/^error \(refused\): no quest no_such_quest/);
    expect(server.quests.stateOf(character.id)?.active.first_jobs?.step).toBe('analyze');
    s.close();

    // saved at once, and the next join loads it
    await released(character.id);
    const again = await join(acct.token, character.id);
    expect(stepOf(await again.s.next('quests'), 'first_jobs')).toBe('analyze');
    again.s.close();
  });

  it('mutes and unmutes an account’s chat', async () => {
    const { acct, character } = await player();
    const { s } = await join(acct.token, character.id);
    expect(await run('mute', acct.username, '120')).toMatchObject({ account: acct.accountId, seconds: 120 });
    s.send({ t: 'chat', channel: 'shard', text: 'hello?' });
    expect(await s.next('denied')).toMatchObject({ of: 'chat', code: 'muted', retryS: 120 });
    expect(await run('unmute', acct.accountId)).toMatchObject({ wasMuted: true });
    s.send({ t: 'chat', channel: 'shard', text: 'heard now' });
    await waitFor(() => s.received.some((m) => m.t === 'event' && m.event.kind === 'chat' && m.event.text === 'heard now'), 5000, 'the chat line');
    expect((await cli(['mute', 'no-such-account-here'])).err).toMatch(/^error \(not_found\)/);
    s.close();
  });
});

describe('the CLI on characters out of play', () => {
  it('edits the stored character, and its next join loads what was written', async () => {
    const { acct, character } = await player();
    expect(await run('grant', character.name, 'ferrite', '40')).toEqual(
      expect.objectContaining({ online: false, added: 40, revision: 1, changed: ['inventory'] }),
    );
    expect(await run('teleport', character.name, String(OTHER), 'station', 'docked')).toMatchObject({ online: false, revision: 2, changed: ['pose'] });
    expect(await run('set-skill-points', character.name, '5')).toMatchObject({ online: false, available: 5, revision: 3, changed: ['skills'] });
    const human = await cli(['grant', character.name, 'units', '10']);
    expect(human.out).toBe(`${character.name}: gave 10 units; 2510 units now (offline: saved inventory at revision 4)`);

    const { s, welcome, inventory, skills } = await join(acct.token, character.id);
    expect(welcome.zone.id).toBe(`sys:${OTHER}`);
    expect(countOf(inventory.inventory, 'ferrite')).toBe(40);
    expect(inventory.inventory.units).toBe(2510);
    expect(available(skills)).toBe(5);
    s.close();
  });

  it('holds a join of the character until an edit out of play has written', async () => {
    const { acct, character } = await player();
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const editing = server.persistence.edit(character.id, async (e) => {
      await gate;
      const r = addItem(e.get<Inventory>(INVENTORY), 'ferrite', 7);
      if (!r.ok) return r.error.message;
      e.set(INVENTORY, r.inv);
    });
    const s = await TestSocket.open(server.wsUrl);
    s.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
    s.send({ t: 'join', characterId: character.id });
    await new Promise((r) => setTimeout(r, 300));
    expect(s.received.some((m) => m.t === 'welcome')).toBe(false);
    // while the join waits, its pin keeps other edits off
    expect(await server.persistence.edit(character.id, () => {})).toMatchObject({ ok: false, code: 'held' });

    open();
    expect(await editing).toMatchObject({ ok: true, revision: 1 });
    await s.next('welcome');
    expect(countOf((await s.next('inventory')).inventory, 'ferrite')).toBe(7);
    s.close();
  });

  it('waits for the save of a character that just left, so neither change is lost', async () => {
    const { acct, character } = await player();
    const { s } = await join(acct.token, character.id);
    expect(await run('grant', character.name, 'ferrite', '10')).toMatchObject({ online: true });
    s.close();
    await waitFor(() => server.persistence.status(character.id)?.inPlay !== true, 5000, 'the character to leave');
    expect(await run('grant', character.name, 'ferrite', '5')).toMatchObject({ added: 5 });
    await released(character.id);
    const again = await join(acct.token, character.id);
    expect(countOf(again.inventory.inventory, 'ferrite')).toBe(15);
    again.s.close();
  });

  it('sets a quest’s step in the stored quest log, which its next join loads', async () => {
    const { acct, character } = await player();
    expect(await run('set-quest-step', character.name, 'first_jobs', '2')).toEqual({
      character: character.id,
      name: character.name,
      quest: 'first_jobs',
      step: 2,
      online: false,
      revision: 1,
      changed: ['quests'],
    });
    const human = await cli(['set-quest-step', character.name, 'wing_over_rolis_iii', '1']);
    expect(human.out).toBe(`${character.name}: quest wing_over_rolis_iii at step 1 (offline: saved quests at revision 2)`);
    const past = await cli(['set-quest-step', character.name, 'first_jobs', '7']);
    expect(past.code).toBe(1);
    expect(past.err).toMatch(/quest first_jobs has steps 0 to 6/);

    const { s } = await join(acct.token, character.id);
    const quests = await s.next('quests');
    // (on already, First Jobs is not started again on join)
    expect(stepOf(quests, 'first_jobs')).toBe('site');
    expect(stepOf(quests, 'wing_over_rolis_iii')).toBe('wing');
    s.close();
  });
});

describe('the CLI on the world', () => {
  it('reports who is in play, the zones and the metrics', async () => {
    const { acct, character } = await player();
    const { s } = await join(acct.token, character.id);
    const who = await cli(['who']);
    expect(who.out).toMatch(/^\d+ in play, \d+ sockets?\nNAME/);
    expect(who.out).toContain(character.name);
    const zones = (await run('zones')).zones as { id: string; sessions: number; asleep: boolean }[];
    expect(zones).toContainEqual(expect.objectContaining({ id: `sys:${HOME}`, asleep: false }));
    expect((await cli(['zones'])).out).toMatch(/^ZONE\s+SYSTEM\s+TIER/);
    const metrics = await run('metrics');
    expect(metrics).toMatchObject({ loop: { tickHz: 20, running: true }, persistence: { inPlay: expect.any(Number), edited: expect.any(Number) } });
    expect((await cli(['metrics'])).out).toMatch(/^loop: 20 Hz/);
    s.close();
  });

  it('spawns and despawns entities, and places a herd beside a character on its world', async () => {
    const { acct, character } = await player();
    const { s } = await join(acct.token, character.id);
    const prop = await run('spawn', String(HOME), 'entity', 'kind=prop', 'frame=station', 'at=25,0,0', 'name=Crate');
    const zone = server.zones.zone(`sys:${HOME}`)!;
    expect(zone.entity(prop.entity as number)!.fields).toMatchObject({ kind: 'prop', pos: [25, 0, 0], name: 'Crate' });
    expect(await run('despawn', String(HOME), String(prop.entity))).toMatchObject({ removed: true });
    expect(zone.entity(prop.entity as number)).toBeUndefined();
    expect((await cli(['despawn', String(HOME), String(prop.entity)])).err).toMatch(/^error \(not_found\)/);
    const me = [...server.ws.registry.sessions].find((x) => x.characterId === character.id)!;
    expect((await cli(['despawn', String(HOME), String(me.entityId)])).err).toMatch(/^error \(refused\)/);
    expect((await cli(['spawn', '1000', 'entity', 'kind=npc', 'frame=station', 'at=0,0,0'])).err).toMatch(/^error \(not_found\): zone sys:1000 is not loaded/);

    // on its home world's ground, then a herd of the world's first species beside it
    const home = describeZoneSystem(HOME).home;
    expect(await run('teleport', character.name, String(HOME), String(home), 'surface')).toMatchObject({ online: true, mode: 'foot' });
    const herd = await run('spawn', String(HOME), 'herd', 'species=0', `near=${character.name}`, 'count=3', 'level=2');
    expect(herd).toMatchObject({ zone: `sys:${HOME}`, body: home, species: 0 });
    expect(herd.creatures).toHaveLength(3);
    for (const id of herd.creatures as number[]) expect(zone.entity(id)!.fields).toMatchObject({ kind: 'mob', level: 2 });
    s.close();
  });
});

describe('the admin channel', () => {
  it('refuses a wrong secret, a browser, and anything but a command', async () => {
    const wrong = await cli(['who'], { ASTRA_ADMIN_URL: server.adminUrl!, ASTRA_ADMIN_SECRET: 'not-the-secret-at-all' });
    expect(wrong.code).toBe(1);
    expect(wrong.err).toMatch(/^error \(refused\): Wrong or missing admin secret/);
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` };
    const body = JSON.stringify({ command: { cmd: 'who' } });
    expect((await fetch(server.adminUrl + ADMIN_PATH, { method: 'POST', headers: { ...headers, origin: 'http://evil.example' }, body })).status).toBe(403);
    expect((await fetch(server.adminUrl + ADMIN_PATH, { method: 'GET', headers })).status).toBe(405);
    expect((await fetch(`${server.adminUrl}/admin/other`, { method: 'POST', headers, body })).status).toBe(404);
    const bad = await fetch(server.adminUrl + ADMIN_PATH, { method: 'POST', headers, body: JSON.stringify({ command: { cmd: 'who', drop: true } }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, error: 'usage' });
    expect((await fetch(server.adminUrl + ADMIN_PATH, { method: 'POST', headers, body })).status).toBe(200);
  });
});

describe('the CLI and the secret', () => {
  it('sends the secret only to a loopback address that answers as an astra admin channel', async () => {
    const elsewhere = await cli(['who'], { ASTRA_ADMIN_URL: 'http://example.com:8788', ASTRA_ADMIN_SECRET: SECRET });
    expect(elsewhere.code).toBe(2);
    expect(elsewhere.err).toMatch(/on this machine only .* not http:\/\/example.com:8788: the secret was not sent/);
    expect((await cli(['who'], { ASTRA_ADMIN_URL: 'https://127.0.0.1:8788', ASTRA_ADMIN_SECRET: SECRET })).code).toBe(2);

    // something else on a loopback port: it never sees the secret
    const seen: (string | undefined)[] = [];
    const impostor = createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
    await new Promise<void>((r) => impostor.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(impostor.address() as AddressInfo).port}`;
      const r = await cli(['who'], { ASTRA_ADMIN_URL: url, ASTRA_ADMIN_SECRET: SECRET });
      expect(r.code).toBe(3);
      expect(r.err).toMatch(/something other than an astra admin channel answers .* the secret was not sent/);
      expect(seen).toEqual([undefined]);
    } finally {
      await new Promise<void>((r) => impostor.close(() => r()));
    }
    const health = await fetch(server.adminUrl + ADMIN_HEALTH_PATH);
    expect(await health.json()).toEqual({ service: 'astra-admin', version: 1 });
  });
});

describe('the admin channel port', () => {
  it('leaves the game up without its channel when another server has the port', async () => {
    const port = Number(new URL(server.adminUrl!).port);
    const second = await startTestServer({}, { tooling: { ASTRA_ADMIN_SECRET: SECRET, ASTRA_ADMIN_PORT: port } });
    extra.add(second);
    expect(second.adminUrl).toBeNull();
    expect((await api(second, 'GET', '/health')).status).toBe(200);
  });
});

describe('direct mode', () => {
  const config = parseConfig(process.env);

  it('changes a character in the database with no server running, and is refused while one answers', async () => {
    const { acct, character } = await player();
    const db = { DATABASE_URL: config.DATABASE_URL, REDIS_URL: config.REDIS_URL };
    const busy = await cli(['--direct', 'grant', character.name, 'ferrite', '3'], { ...db, HOST: '127.0.0.1', PORT: String(server.port) });
    expect(busy.code).toBe(1);
    expect(busy.err).toMatch(/a server answers at/);

    const port = await closedPort();
    const direct = await cli(['--direct', '--json', 'grant', character.name, 'ferrite', '3'], { ...db, HOST: '127.0.0.1', PORT: String(port) });
    expect(direct.code, direct.err).toBe(0);
    expect(JSON.parse(direct.out)).toMatchObject({ online: false, added: 3, revision: 1 });
    expect(direct.err).toMatch(/"msg":"admin command"/); // its audit line
    // saved a moment ago (by that edit): a second direct edit is refused, unless forced
    const again = await cli(['--direct', 'grant', character.name, 'ferrite', '2'], { ...db, HOST: '127.0.0.1', PORT: String(port) });
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/^error \(refused\): .* was saved \d+ s ago: a server elsewhere on this database may hold it \(--force/m);
    const forced = await cli(['--direct', '--force', '--json', 'grant', character.name, 'ferrite', '2'], { ...db, HOST: '127.0.0.1', PORT: String(port) });
    expect(forced.code, forced.err).toBe(0);
    expect(JSON.parse(forced.out)).toMatchObject({ added: 2, revision: 2 });
    const quest = await cli(['--direct', '--force', '--json', 'set-quest-step', character.name, 'first_jobs', '2'], {
      ...db,
      HOST: '127.0.0.1',
      PORT: String(port),
    });
    expect(quest.code, quest.err).toBe(0);
    expect(JSON.parse(quest.out)).toMatchObject({ online: false, quest: 'first_jobs', step: 2, revision: 3, changed: ['quests'] });
    const live = await cli(['--direct', 'who'], { ...db, HOST: '127.0.0.1', PORT: String(port) });
    expect(live.err).toMatch(/^error \(needs_server\): who needs the running server/m);

    // the server (which did not hold it) loads what direct mode wrote
    const { s, inventory } = await join(acct.token, character.id);
    expect(countOf(inventory.inventory, 'ferrite')).toBe(5);
    expect(stepOf(await s.next('quests'), 'first_jobs')).toBe('site');
    s.close();
  });
});

describe('the cli script', () => {
  it('runs as `pnpm --filter @astra/server cli -- …` runs it', async () => {
    const tsx = createRequire(import.meta.url).resolve('tsx/cli');
    const cwd = fileURLToPath(new URL('..', import.meta.url));
    const child = spawn(process.execPath, [tsx, 'src/cli/main.ts', '--', '--json', '--operator', uniqueUsername('op'), 'metrics'], {
      cwd,
      env: { ...process.env, ASTRA_ADMIN_URL: server.adminUrl!, ASTRA_ADMIN_SECRET: SECRET },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code, err).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ loop: { tickHz: 20 } });
    // (starting tsx takes seconds alone, and many more on a machine loaded by parallel worktrees)
  }, 120_000);
});

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
