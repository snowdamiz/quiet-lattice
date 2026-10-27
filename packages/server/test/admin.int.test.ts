// Developer tooling against the dockerised Postgres and Redis (P1.E03.T07): the dev login bypass, on and off and refused
// in production; the CLI over the admin channel changing characters in play through the live services (teleport within a
// zone and across zones, grant, skill points, mute) and out of play through persistence's load–modify–save, which their
// next join loads; a join during an offline edit waiting for its write, and an edit right after a disconnect waiting for
// the held save; who, zones, metrics, spawn and despawn; the channel's guard; direct mode; and the script itself.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { addItem, countOf, type Inventory } from '@astra/shared/inventory';
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import { pointsOf } from '@astra/shared/skills';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_PATH } from '../src/admin/channel.ts';
import { runCli } from '../src/cli/run.ts';
import { parseConfig } from '../src/config.ts';
import { INVENTORY } from '../src/persistence/components.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf } from '../src/world/home.ts';
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

  it('is not served with the flag off, and refused at start in production', async () => {
    const off = await startTestServer();
    extra.add(off);
    expect(off.tooling.devLogin).toBe(false);
    expect((await api(off, 'POST', '/auth/dev', { body: { name: 'nope' } })).status).toBe(404);

    const production = { NODE_ENV: 'production' as const, JWT_SECRET: 'p'.repeat(40) };
    await expect(startTestServer(production, { tooling: { ASTRA_DEV_LOGIN: true } })).rejects.toThrow(/never allowed in production/);
    await expect(startTestServer(production, { tooling: { ASTRA_ADMIN_SECRET: SECRET } })).rejects.toThrow(/ASTRA_ADMIN_IN_PRODUCTION/);
    const prod = await startTestServer(production);
    extra.add(prod);
    expect(prod.adminUrl).toBeNull();
    expect((await api(prod, 'POST', '/auth/dev', { body: { name: 'nope' } })).status).toBe(404);
  });
});

describe('the CLI on characters in play', () => {
  it('teleports within the zone by a correction and to another system by a handoff', async () => {
    const { acct, character } = await player();
    const { s } = await join(acct.token, character.id);

    const near = await run('teleport', character.name, String(HOME), 'station', 'orbit:500');
    expect(near).toMatchObject({ online: true, handoff: false, system: HOME, mode: 'ship', pose: { pos: [0, 0, 500] } });
    const correction = await s.next('correction');
    expect(correction).toMatchObject({ pose: { pos: [0, 0, 500] }, mode: 'ship' });
    const zone = server.zones.zone(`sys:${HOME}`)!;
    const session = [...server.ws.registry.sessions].find((x) => x.characterId === character.id)!;
    expect(zone.entity(session.entityId!)!.fields).toMatchObject({ pos: [0, 0, 500], mode: 'ship' });

    const far = await run('teleport', character.id.toUpperCase(), String(OTHER), 'station', 'docked');
    expect(far).toMatchObject({ online: true, handoff: true, system: OTHER, mode: 'docked' });
    const handoff = await s.next('zone');
    expect(handoff.zone.id).toBe(`sys:${OTHER}`);
    expect(session.zoneId).toBe(`sys:${OTHER}`);
    const who = await run('who');
    expect(who.online).toContainEqual(expect.objectContaining({ character: character.id, name: character.name, zone: `sys:${OTHER}`, mode: 'docked' }));

    // it was saved where it went: the next join puts it there
    s.close();
    await released(character.id);
    const back = await join(acct.token, character.id);
    expect(back.welcome.zone.id).toBe(`sys:${OTHER}`);
    expect(back.welcome.mode).toBe('docked');
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

  it('says quests are unavailable until the quest runtime lands', async () => {
    const { character } = await player();
    const r = await cli(['set-quest-step', character.name, 'first_light', '1']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^error \(unavailable\): quests unavailable/);
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
    const live = await cli(['--direct', 'who'], { ...db, HOST: '127.0.0.1', PORT: String(port) });
    expect(live.err).toMatch(/^error \(needs_server\): who needs the running server/m);

    // the server (which did not hold it) loads what direct mode wrote
    const { s, inventory } = await join(acct.token, character.id);
    expect(countOf(inventory.inventory, 'ferrite')).toBe(3);
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
  });
});

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
