import { encode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import { getHull, type HullId } from '../src/data/index.ts';
import { addItem, emptyInventory, layoutFor, type Inventory, type InventoryLoadout } from '../src/inventory/index.ts';
import { emptySkillState, newSkillState, type SkillOp, type SkillView } from '../src/skills/index.ts';
import {
  AuthResponse,
  CharacterCreate,
  CharacterList,
  CharacterSummary,
  ClientMessage,
  PARTY_MAX,
  Credentials,
  GameEvent,
  InvalidMessageError,
  PROTOCOL_VERSION,
  ServerMessage,
  applyEntityDelta,
  decodeClientMessage,
  decodeServerMessage,
  decodeSnapshot,
  diffEntity,
  encodeMessage,
  encodeServerMessage,
  encodeSnapshot,
  peekVersion,
  type EntityState,
  type Pose,
  type Snapshot,
} from '../src/protocol/index.ts';
// (its source, for the version history under PROTOCOL_VERSION: read through Vite's ?raw import, without Node types)
import MESSAGES_SOURCE from '../src/protocol/messages.ts?raw';

const pose: Pose = { frame: '424242:2', pos: [113000.25, -42.5, 7.125], quat: [0, 0.7071068, 0, 0.7071068], vel: [1, 2, 3] };
/** A ship of this hull carrying every pod its bays take (Pack Mule adds a bay), and the skills. */
const at = (hull: HullId | null, skills: string[] = []): InventoryLoadout => ({
  ship: hull && { hull, modules: {}, cargoPods: getHull(hull).cargoPods + (skills.includes('pack_mule') ? 1 : 0), livery: 0 },
  skills,
});
let inventory: Inventory = emptyInventory(layoutFor(at('mule')), 2500);
for (const [item, n] of [
  ['ferrite', 12000],
  ['warp_cell', 1],
  ['pulse_lasers', 1],
] as const) {
  const r = addItem(inventory, item, n);
  if (r.ok) inventory = r.inv;
}
const character = { id: 'c1', name: "Ana Vel'ka", people: 'thalune', look: { palette: 3, pattern: 1, head: 2, suit: 0 }, level: 1, homeSystem: 0 } as const;
/** A thalune at level 16 who owns Pull and Pull Many (slotted), Second Lung and Bond, with gravitic fragments to spare. */
const skills: SkillView = {
  state: {
    ...newSkillState('thalune'),
    granted: 3,
    unlocked: ['second_lung', 'pull', 'pull_many', 'bond', 'well'],
    bought: ['second_lung', 'pull', 'pull_many', 'bond'],
    fragments: { ...emptySkillState().fragments, gravitic: { earned: 7, spent: 4 } },
    slots: { ground: ['pull', null, 'bond', null, null, null], ship: [null, null, null, null, null] },
  },
  level: 16,
  shipSlots: 2,
  met: [{ kind: 'faction_rank', faction: 'reaches', rank: 'deckhand' }],
  maxTier: 2,
};

const clientSamples: ClientMessage[] = [
  { t: 'hello', version: PROTOCOL_VERSION, token: 'jwt' },
  { t: 'join', characterId: 'c1' },
  { t: 'input', seq: 7, time: 12.5, mode: 'ship', pose, buttons: 3, aim: [0, 0, 0, 1] },
  { t: 'cast', seq: 8, slot: 2, aim: [0, 0, -1], target: 12 },
  { t: 'interact', target: 'terminal:3' },
  { t: 'chat', channel: 'system', text: 'hello' },
  { t: 'party', op: { op: 'invite', name: "Ana Vel'ka" } },
  { t: 'ack', tick: 99 },
  { t: 'ping', id: 1, clientTime: 1000.5 },
  { t: 'inventory', seq: 3, op: { op: 'move', from: { c: 'suit', i: 0 }, to: { c: 'pod', p: 2, i: 7 }, count: 40 } },
  { t: 'skills', seq: 4, op: { op: 'buy', node: 'well' } },
  { t: 'cutscene', op: 'request', id: 'test' },
];

/** Every inventory op a client may send (they share the `inventory` request type). */
const inventoryOps = [
  { op: 'split', from: { c: 'pod', p: 0, i: 1 }, count: 5, to: { c: 'suit', i: 15 } },
  { op: 'merge', from: { c: 'suit', i: 2 }, to: { c: 'suit', i: 0 } },
  { op: 'transfer', from: { c: 'suit', i: 1 } },
  { op: 'compact', c: 'cargo' },
] as const;

/** Every skill request a client may send (they share the `skills` request type). */
const skillOps: SkillOp[] = [
  { op: 'unlock', node: 'slam' },
  { op: 'slot', bar: 'ground', index: 5, node: 'pull' },
  { op: 'slot', bar: 'ship', index: 4, node: 'tractor_beam' },
  { op: 'unslot', bar: 'ship', index: 0 },
  { op: 'respec', nodes: ['pull_many', 'pull'] },
];

/** Every party request a client may send (they share the `party` request type). */
const partyOps = [
  { op: 'accept', name: 'ana' },
  { op: 'decline', name: 'Ana' },
  { op: 'leave' },
  { op: 'kick', name: 'Bo Tran' },
  { op: 'promote', name: 'Bo-Tran' },
] as const;

const partyView = {
  leader: 'Bo Tran',
  members: [
    { name: "Ana Vel'ka", online: true, system: 0, health: 10 },
    { name: 'Bo Tran', online: true, system: 59, health: 3 },
    { name: 'Cy', online: false, system: null, health: null },
  ],
};

const events: GameEvent[] = [
  { kind: 'combat', source: 5, target: 9, amount: 18, damageType: 'thermal', ability: 'lance', killed: false },
  { kind: 'quest', questId: 'prologue.first-jobs', step: 2, status: 'step', counters: { carbon: 25 } },
  { kind: 'chat', channel: 'shard', from: 'Ana', text: 'hi', at: 3600 },
  { kind: 'loot', item: 'ferrite', count: 12, from: 9 },
  { kind: 'notice', text: 'Docking permission granted', tone: 'good' },
  { kind: 'party', what: 'invite', name: 'Ana' },
];

const serverSamples: ServerMessage[] = [
  { t: 'welcome', accountId: 'a1', character, entityId: 5, serverTime: 3600.25, zone: { id: 'sys:0', systemSeed: 424242 }, pose, mode: 'docked' },
  { t: 'refused', code: 'version', reason: 'reload the page' },
  { t: 'correction', seq: 7, pose, mode: 'ship' },
  { t: 'zone', zone: { id: 'sys:1', systemSeed: 77 }, pose: { ...pose, frame: null } },
  { t: 'pong', id: 1, clientTime: 1000.5, serverTime: 3600.3 },
  { t: 'world', season: 1, count: 500, edgeX: 2.5e6, tiers: [0, 0, 0, 1, 2], serverTime: 3600 },
  ...events.map((event) => ({ t: 'event' as const, event })),
  { t: 'inventory', seq: 3, inventory },
  { t: 'skills', seq: 4, skills },
  { t: 'party', party: partyView },
  { t: 'denied', of: 'chat', code: 'rate', retryS: 2 },
  { t: 'cutscene', op: 'play', id: 'test', phase: 4 },
];

const http = {
  Credentials: [Credentials, { username: 'ana_v', password: 'correct horse' }],
  AuthResponse: [AuthResponse, { token: 'a.b.c', accountId: 'a1' }],
  CharacterCreate: [CharacterCreate, { name: 'Ana Velka', people: 'ixari', look: { palette: 0, pattern: 15, head: 5, suit: 3 } }],
  CharacterSummary: [CharacterSummary, character],
  CharacterList: [CharacterList, { characters: [character], max: 6 }],
} as const;

describe('protocol: version', () => {
  // 1: the first protocol (P1.E02.T08); 2: inventory (P1.E06.T04); 3: social, chat and parties (P1.E15.T01); 4: creatures'
  // attack field (P1.E08.T01); 5: the skill web (P1.E07.T01); 6: cutscenes (P1.E09.T04). A branch that changes a message
  // bumps the version, adds its line to the history under PROTOCOL_VERSION and updates this.
  it('is version 6, and the history under the constant names each version up to it exactly once', () => {
    expect(PROTOCOL_VERSION).toBe(6);
    const source = MESSAGES_SOURCE;
    const history = [...source.matchAll(/^\/\/ (\d+): .+$/gm)].map((m) => ({ v: Number(m[1]), line: m[0] }));
    for (const { v, line } of history) expect(line, `history line for ${v}`).toMatch(/\(P\d\.E\d{2}\.T\d{2}\)$/);
    // one line per number, 1 to the constant with none missing: two branches that both took a number conflict here
    expect(history.map((h) => h.v)).toEqual(Array.from({ length: PROTOCOL_VERSION }, (_, i) => i + 1));
    expect(Math.max(...history.map((h) => h.v))).toBe(PROTOCOL_VERSION);
  });
});

describe('protocol: control messages', () => {
  it('covers every client message, server message and event kind', () => {
    expect(new Set(clientSamples.map((m) => m.t))).toEqual(new Set(ClientMessage.options.map((o) => o.shape.t.value)));
    expect(new Set(serverSamples.map((m) => m.t))).toEqual(new Set(ServerMessage.options.map((o) => o.shape.t.value)));
    expect(new Set(events.map((e) => e.kind))).toEqual(new Set(GameEvent.options.map((o) => o.shape.kind.value)));
  });

  it.each(clientSamples.map((m) => [m.t, m]))('client %s round-trips', (_, m) => {
    expect(decodeClientMessage(encodeMessage(m))).toEqual(m);
  });

  it.each(serverSamples.map((m) => [m.t === 'event' ? `event:${m.event.kind}` : m.t, m]))('server %s round-trips', (_, m) => {
    expect(decodeServerMessage(encodeMessage(m))).toEqual(m);
  });

  it.each(inventoryOps.map((op) => [op.op, op]))('client inventory %s round-trips', (_, op) => {
    const m = { t: 'inventory' as const, seq: 9, op };
    expect(decodeClientMessage(encodeMessage(m))).toEqual(m);
  });

  it('round-trips inventory state with and without a refusal, and tells the two inventory messages apart', () => {
    for (const m of [
      { t: 'inventory' as const, seq: 0, inventory: emptyInventory(layoutFor(at(null))) },
      { t: 'inventory' as const, seq: 12, inventory, error: 'stack_full' as const },
    ]) {
      const text = encodeMessage(m);
      expect(decodeServerMessage(text)).toEqual(m);
      expect(decodeClientMessage(text)).toBeNull();
    }
    expect(decodeServerMessage(encodeMessage(clientSamples.at(-1)!))).toBeNull();
  });

  it.each(skillOps.map((op) => [`${op.op} ${JSON.stringify(op).slice(0, 40)}`, op]))('client skills %s round-trips', (_, op) => {
    const m = { t: 'skills' as const, seq: 9, op };
    expect(decodeClientMessage(encodeMessage(m))).toEqual(m);
  });

  it('round-trips skill state with and without a refusal, and tells the two skills messages apart', () => {
    for (const m of [
      { t: 'skills' as const, seq: 0, skills: { state: emptySkillState(), level: 1, shipSlots: 0, met: [], maxTier: 4 as const } },
      { t: 'skills' as const, seq: 12, skills, error: 'prerequisite' as const },
    ]) {
      const text = encodeMessage(m);
      expect(decodeServerMessage(text)).toEqual(m);
      expect(decodeClientMessage(text)).toBeNull();
    }
    expect(decodeServerMessage(encodeMessage(clientSamples.find((m) => m.t === 'skills')!))).toBeNull();
  });

  it.each(partyOps.map((op) => [op.op, op]))('client party %s round-trips', (_, op) => {
    const m = { t: 'party' as const, op };
    expect(decodeClientMessage(encodeMessage(m))).toEqual(m);
  });

  it('round-trips party state, party news and refusals in their every form, and tells the two party messages apart', () => {
    const states = [
      { t: 'party' as const, party: null },
      {
        t: 'party' as const,
        party: { leader: 'Ana', members: Array.from({ length: PARTY_MAX }, (_, i) => ({ name: `An${'abcdef'[i]}`, online: true, system: i, health: i })) },
      },
    ];
    for (const m of states) {
      const text = encodeMessage(m);
      expect(decodeServerMessage(text)).toEqual(m);
      expect(decodeClientMessage(text)).toBeNull();
    }
    expect(decodeServerMessage(encodeMessage(clientSamples.find((m) => m.t === 'party')!))).toBeNull();
    for (const what of ['invite', 'invited', 'declined', 'expired', 'joined', 'left', 'kicked', 'leader'] as const) {
      const m = { t: 'event' as const, event: { kind: 'party' as const, what, name: 'Bo Tran' } };
      expect(decodeServerMessage(encodeMessage(m))).toEqual(m);
    }
    const disbanded = { t: 'event' as const, event: { kind: 'party' as const, what: 'disbanded' as const } };
    expect(decodeServerMessage(encodeMessage(disbanded))).toEqual(disbanded);
    for (const m of [
      { t: 'denied' as const, of: 'invite' as const, code: 'not_found' as const, name: 'Nobody' },
      { t: 'denied' as const, of: 'chat' as const, code: 'muted' as const, retryS: 60 },
      { t: 'denied' as const, of: 'leave' as const, code: 'no_party' as const },
    ])
      expect(decodeServerMessage(encodeMessage(m))).toEqual(m);
  });

  it.each(Object.entries(http))('HTTP %s round-trips', (_, [schema, value]) => {
    expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it('drops malformed and unknown messages without throwing', () => {
    const bad = [
      'not json',
      '{"t":"teleport","to":"anywhere"}',
      '{"t":"cast","seq":1,"slot":9,"aim":[0,0,1]}',
      '{"t":"cast","seq":1,"slot":1,"aim":[0,0,0]}',
      '{"t":"interact","target":""}',
      '{"t":"input","seq":1,"time":0,"mode":"ship","pose":{"frame":"../etc","pos":[0,0,0],"quat":[0,0,0,1],"vel":[0,0,0]},"buttons":0}',
      '{"t":"input","seq":1,"time":0,"mode":"ship","pose":{"frame":null,"pos":[0,0,0],"quat":[0,0,0,0],"vel":[0,0,0]},"buttons":0}',
      '{"t":"input","seq":1,"time":0,"mode":"ship","pose":{"frame":null,"pos":[1e300,0,0],"quat":[0,0,0,1],"vel":[0,0,0]},"buttons":0}',
      '{"t":"input","seq":1,"time":0,"mode":"ship","pose":{"frame":"12345678901:1","pos":[0,0,0],"quat":[0,0,0,1],"vel":[0,0,0]},"buttons":0}',
      '{"t":"input","seq":1,"time":0,"mode":"ship","pose":{"frame":null,"pos":[0,0,0],"quat":[0,0,0,1],"vel":[0,0,0]},"buttons":256}',
      `{"t":"join","characterId":"${'x'.repeat(65)}"}`,
      `{"t":"hello","version":1,"token":"${'x'.repeat(5000)}"}`,
      '{"t":"chat","channel":"shard","text":"spoof\\u202eevil"}',
      '{"t":"chat","channel":"shard","text":"zero\\u200bwidth"}',
      '{"t":"chat","channel":"shard","text":"   "}',
      `{"t":"chat","channel":"shard","text":"${'\\ud83d\\ude00'.repeat(141)}"}`,
      '{"t":"interact","target":"term\\u0007inal"}',
      '{"t":"input","seq":1,"time":0,"mode":"ship","pose":{"frame":"9999999999:1","pos":[0,0,0],"quat":[0,0,0,1],"vel":[0,0,0]},"buttons":0}',
      // inventory requests: only the ops a client may ask for, inside the slot and count bounds
      '{"t":"inventory","seq":1,"op":{"op":"add","item":"gold","count":100}}',
      '{"t":"inventory","seq":1,"op":{"op":"move","from":{"c":"suit","i":0},"to":{"c":"suit","i":64}}}',
      '{"t":"inventory","seq":1,"op":{"op":"move","from":{"c":"suit","i":-1},"to":{"c":"suit","i":1}}}',
      '{"t":"inventory","seq":1,"op":{"op":"move","from":{"c":"pod","p":32,"i":0},"to":{"c":"suit","i":1}}}',
      '{"t":"inventory","seq":1,"op":{"op":"move","from":{"c":"suit","i":0},"to":{"c":"suit","i":1},"count":0}}',
      '{"t":"inventory","seq":1,"op":{"op":"split","from":{"c":"suit","i":0},"count":2000000}}',
      '{"t":"inventory","seq":1,"op":{"op":"transfer","from":{"c":"suit","i":0},"units":5}}',
      '{"t":"inventory","seq":0,"op":{"op":"compact","c":"suit"}}',
      '{"t":"inventory","seq":1}',
      '{"t":"inventory","seq":1,"inventory":{"stackMax":9999,"units":0,"suit":[],"pods":[]}}',
      // party requests: a known op, naming a character as names are spelled
      '{"t":"party","op":{"op":"disband"}}',
      '{"t":"party","op":{"op":"invite"}}',
      '{"t":"party","op":{"op":"invite","name":"A"}}',
      '{"t":"party","op":{"op":"invite","name":"Ana  Vel"}}',
      '{"t":"party","op":{"op":"kick","name":"Ana\\u202e"}}',
      `{"t":"party","op":{"op":"promote","name":"${'a'.repeat(21)}"}}`,
      '{"t":"party","party":null}',
      '{"t":"chat","channel":"guild","text":"hi"}',
      // skill requests: a known op, an id-shaped node, a slot inside the bars; points, fragments and unlocks are never asked for
      '{"t":"skills","seq":1,"op":{"op":"grant","points":5}}',
      '{"t":"skills","seq":1,"op":{"op":"buy","node":"Pull"}}',
      `{"t":"skills","seq":1,"op":{"op":"buy","node":"${'a'.repeat(49)}"}}`,
      '{"t":"skills","seq":1,"op":{"op":"buy","node":"pull","free":true}}',
      '{"t":"skills","seq":1,"op":{"op":"slot","bar":"ground","index":6,"node":"pull"}}',
      '{"t":"skills","seq":1,"op":{"op":"slot","bar":"cockpit","index":0,"node":"pull"}}',
      '{"t":"skills","seq":1,"op":{"op":"unslot","bar":"ship","index":-1}}',
      '{"t":"skills","seq":1,"op":{"op":"respec","nodes":[]}}',
      '{"t":"skills","seq":0,"op":{"op":"buy","node":"pull"}}',
      '{"t":"skills","seq":1,"op":{"op":"unlock","node":"pull","via":"trainer"}}',
    ];
    for (const b of bad) expect(decodeClientMessage(b), b.slice(0, 80)).toBeNull();
    expect(decodeServerMessage('{"t":"world","season":1,"count":5000,"edgeX":0,"tiers":[],"serverTime":0}')).toBeNull();
    // party state: two to PARTY_MAX members, a leader among them, coarse health, a system index
    const member = { name: 'Ana', online: true, system: 0, health: 10 };
    for (const party of [
      { leader: 'Ana', members: [member] },
      { leader: 'Cy', members: [member, { ...member, name: 'Bo' }] },
      { leader: 'Ana', members: Array.from({ length: PARTY_MAX + 1 }, (_, i) => ({ ...member, name: `An${'abcdefg'[i]}` })) },
      { leader: 'Ana', members: [member, { ...member, name: 'Bo', health: 11 }] },
      { leader: 'Ana', members: [member, { ...member, name: 'Bo', health: 0.5 }] },
      { leader: 'Ana', members: [member, { ...member, name: 'Bo', system: 1024 }] },
    ])
      expect(decodeServerMessage(JSON.stringify({ t: 'party', party })), JSON.stringify(party).slice(0, 80)).toBeNull();
    expect(decodeServerMessage('{"t":"denied","of":"chat","code":"banned"}')).toBeNull();
    expect(decodeServerMessage('{"t":"denied","of":"chat","code":"rate","retryS":0}')).toBeNull();
    expect(decodeServerMessage('{"t":"event","event":{"kind":"party","what":"invite","name":"x"}}')).toBeNull();
    // inventory state carries only tradeable things: no fragments, no unknown items, no stack over its cap
    for (const bad of [
      { ...inventory, fragments: 4 },
      { ...inventory, suit: [{ item: 'fragment', count: 1 }] },
      { ...inventory, suit: [{ item: 'ferrite', count: 10000 }] },
      { ...inventory, units: -1 },
    ])
      expect(decodeServerMessage(JSON.stringify({ t: 'inventory', seq: 1, inventory: bad }))).toBeNull();
    // skill state: known nodes, owned before slotted and unlocked before owned, on their own bar, ledgers that add up
    const st = skills.state;
    for (const bad of [
      { ...skills, state: { ...st, bought: [...st.bought, 'teleport'] } },
      { ...skills, state: { ...st, bought: [...st.bought, 'slam'] } },
      { ...skills, state: { ...st, slots: { ...st.slots, ground: ['slam', null, null, null, null, null] } } },
      { ...skills, state: { ...st, slots: { ...st.slots, ship: ['pull', null, null, null, null] } } },
      { ...skills, state: { ...st, slots: { ...st.slots, ground: ['pull', 'pull', null, null, null, null] } } },
      { ...skills, state: { ...st, slots: { ...st.slots, ground: ['pull', null, null, null, null] } } },
      { ...skills, state: { ...st, fragments: { ...st.fragments, gravitic: { earned: 1, spent: 4 } } } },
      { ...skills, state: { ...st, fragments: { ...st.fragments, pilot: { earned: 1, spent: 0 } } } },
      { ...skills, state: { ...st, units: 4 } },
      { ...skills, shipSlots: 6 },
      { ...skills, maxTier: 5 },
      { ...skills, maxTier: undefined },
      { ...skills, level: 51 },
    ])
      expect(decodeServerMessage(JSON.stringify({ t: 'skills', seq: 1, skills: bad }))).toBeNull();
  });

  it('refuses to encode invalid messages instead of sending nulls', () => {
    const nan = { t: 'event', event: { kind: 'combat', source: 1, target: 2, amount: NaN, damageType: 'x', killed: false } } as ServerMessage;
    expect(() => encodeServerMessage(nan)).toThrow(InvalidMessageError);
    expect(() => encodeMessage({ t: 'event', event: { kind: 'loot', item: 'ferrite', count: 0, from: null } })).toThrow(InvalidMessageError);
    // a relayed chat line is held to the client's rules: no control characters, a real character name
    expect(() => encodeMessage({ t: 'event', event: { kind: 'chat', channel: 'shard', from: 'Ana', text: 'spoof\u202eevil', at: 1 } })).toThrow(
      InvalidMessageError,
    );
    expect(() => encodeMessage({ t: 'event', event: { kind: 'chat', channel: 'shard', from: 'SYSTEM:', text: 'hi', at: 1 } })).toThrow(InvalidMessageError);
    const overCap = { ...inventory, suit: [{ item: 'ferrite', count: 10000 }, ...inventory.suit.slice(1)] };
    expect(() => encodeMessage({ t: 'inventory', seq: 1, inventory: overCap })).toThrow(InvalidMessageError);
  });

  it('accepts the edges of what it allows', () => {
    const ok = [
      `{"t":"chat","channel":"shard","text":"${'\\ud83d\\ude00'.repeat(140)}"}`,
      '{"t":"chat","channel":"shard","text":"\\ud83d\\udc69\\u200d\\ud83d\\udcbb coding"}',
      '{"t":"input","seq":1,"time":0,"mode":"ship","pose":{"frame":"4294967295:0","pos":[0,0,0],"quat":[0,0,0,1],"vel":[0,0,0]},"buttons":255}',
    ];
    for (const m of ok) expect(decodeClientMessage(m), m.slice(0, 60)).not.toBeNull();
    for (const f of ['01:2', '1:007', '4294967296:1'])
      expect(
        decodeClientMessage(`{"t":"input","seq":1,"time":0,"mode":"ship","pose":{"frame":"${f}","pos":[0,0,0],"quat":[0,0,0,1],"vel":[0,0,0]},"buttons":0}`),
        f,
      ).toBeNull();
    expect(CharacterList.safeParse({ characters: [character] }).success).toBe(false);
    expect(CharacterList.safeParse({ characters: [character, character], max: 1 }).success).toBe(false);
  });

  it('sends only the fields a message defines, never extra keys of a wider object', () => {
    const leaky = {
      t: 'welcome',
      accountId: 'a1',
      character: { ...character, passwordHash: 'SECRET' },
      entityId: 5,
      serverTime: 1,
      zone: { id: 'sys:0', systemSeed: 1 },
      pose,
      mode: 'docked',
    };
    const text = encodeServerMessage(leaky as ServerMessage);
    expect(text).not.toContain('SECRET');
    expect(decodeServerMessage(text)).toEqual({ ...leaky, character });
  });

  it('reads the version of a hello it cannot otherwise parse', () => {
    expect(peekVersion('{"t":"hello","version":7,"token":{"new":"shape"}}')).toBe(7);
    expect(peekVersion('{"t":"join","characterId":"c"}')).toBeNull();
    expect(peekVersion('garbage')).toBeNull();
  });
});

describe('protocol: snapshots', () => {
  const full: Snapshot = {
    tick: 120,
    time: 3600.05,
    ack: 7,
    full: true,
    entities: [
      {
        id: 5,
        kind: 'ship',
        frame: null,
        pos: [1.234567891e9, -2.5e8, 3.000001e7],
        quat: [0, 0, 0, 1],
        vel: [600, 0, 0],
        hull: 'lark',
        name: 'Ana',
        hp: 1,
        shield: 0.5,
      },
      { id: 9, kind: 'mob', frame: '424242:2', pos: [100, 200, 300], quat: [0, 0, 0, 1], vel: [0, 0, 0], species: 3, level: 4, mode: 'idle' },
      { id: 11, kind: 'pod', frame: '424242:2', pos: [5, 5, 5], owner: 5, people: 'ulgani' },
    ],
    removed: [],
  };

  it('round-trips through msgpack with float64 positions intact', () => {
    const bytes = encodeSnapshot(full);
    expect(bytes[0]).toBe(1);
    const back = decodeSnapshot(bytes)!;
    expect(back).toEqual(full);
    expect(back.entities[0].pos![0]).toBe(1.234567891e9);
  });

  it('round-trips a delta with its baseline, cleared fields and removals', () => {
    const delta: Snapshot = {
      tick: 121,
      time: 3600.1,
      ack: 8,
      full: false,
      base: 120,
      entities: [
        { id: 9, pos: [101, 200, 300], mode: 'flee' },
        { id: 11, clear: ['owner'] },
      ],
      removed: [5],
    };
    expect(decodeSnapshot(encodeSnapshot(delta))).toEqual(delta);
  });

  it('requires a baseline on deltas', () => {
    expect(() => encodeSnapshot({ tick: 1, time: 0, ack: 0, full: false, entities: [], removed: [] })).toThrow();
    const raw = new Uint8Array([1, ...encode({ tick: 1, time: 0, ack: 0, full: false, entities: [], removed: [] })]);
    expect(decodeSnapshot(raw)).toBeNull();
  });

  it('rejects frames that are not snapshots', () => {
    expect(decodeSnapshot(new Uint8Array([2, 0x90]))).toBeNull();
    expect(decodeSnapshot(new Uint8Array([1, 0xc1]))).toBeNull();
    expect(decodeSnapshot(new Uint8Array([1]))).toBeNull();
  });

  it('sanitises on encode: clamps unit fields, drops non-finite fields, keeps the rest of the frame', () => {
    const dropped: string[] = [];
    const s: Snapshot = { ...full, entities: [{ id: 5, hp: 1.0000001, shield: -0.01, pos: [NaN, 0, 0], name: 'Ana' }, full.entities[1]] };
    const back = decodeSnapshot(encodeSnapshot(s, dropped))!;
    expect(dropped).toEqual(['5.pos']);
    expect(back.entities[0]).toEqual({ id: 5, hp: 1, shield: 0, name: 'Ana' });
    expect(back.entities[1]).toEqual(full.entities[1]);
  });

  it('carries a creature’s attack phase (0–1, clamped) and clears it when the attack ends', () => {
    const dropped: string[] = [];
    const attacking: EntityState = { id: 9, mode: 'attack', attack: 0.25 };
    expect(decodeSnapshot(encodeSnapshot({ ...full, entities: [attacking] }))!.entities).toEqual([attacking]);
    const over = decodeSnapshot(
      encodeSnapshot(
        {
          ...full,
          entities: [
            { id: 9, attack: 1.0000001 },
            { id: 10, attack: -1e-9 },
          ],
        },
        dropped,
      ),
    )!;
    expect(over.entities).toEqual([
      { id: 9, attack: 1 },
      { id: 10, attack: 0 },
    ]);
    expect(dropped).toEqual([]);
    const done: Snapshot = { tick: 121, time: 3600.1, ack: 8, full: false, base: 120, entities: [{ id: 9, mode: 'return', clear: ['attack'] }], removed: [] };
    expect(decodeSnapshot(encodeSnapshot(done))).toEqual(done);
    expect(applyEntityDelta({ id: 9, mode: 'attack', attack: 0.5 }, done.entities[0])).toEqual({ id: 9, mode: 'return' });
  });

  it('validates every field on encode, so the client never rejects what the server sent', () => {
    const dropped: string[] = [];
    const bad: EntityState = { id: 9, pos: [50, 0, 0], quat: [0, 0, 0, 2], mode: 'return-to-spawn-x', level: 51, species: 1.5, name: 'n'.repeat(40) };
    const leak = { ...bad, secret: 'loot-table' } as EntityState;
    const bytes = encodeSnapshot({ tick: 2, time: 0, ack: 0, full: false, base: 1, entities: [leak], removed: [] }, dropped);
    expect(dropped.sort()).toEqual(['9.level', '9.mode', '9.name', '9.quat', '9.species']);
    const rejected: number[] = [];
    const back = decodeSnapshot(bytes, rejected)!;
    expect(rejected).toEqual([]);
    expect(back.entities).toEqual([{ id: 9, pos: [50, 0, 0] }]);
    expect(String.fromCharCode(...bytes)).not.toContain('loot-table');
  });

  it('refuses to encode an entity with an invalid id or a bad envelope', () => {
    expect(() => encodeSnapshot({ tick: 1, time: 0, ack: 0, full: true, entities: [{ id: 1.5 }], removed: [] })).toThrow();
    expect(() => encodeSnapshot({ tick: 1, time: NaN, ack: 0, full: true, entities: [], removed: [] })).toThrow();
  });

  it('refuses a delta that sets and clears the same field, and deltas for another entity', () => {
    const raw = new Uint8Array([
      1,
      ...encode({ tick: 2, time: 0, ack: 0, full: false, base: 1, entities: [{ id: 3, owner: 4, clear: ['owner'] }], removed: [] }),
    ]);
    const rejected: number[] = [];
    expect(decodeSnapshot(raw, rejected)!.entities).toEqual([]);
    expect(rejected).toEqual([3]);
    expect(() => applyEntityDelta({ id: 1 }, { id: 2, hp: 1 })).toThrow();
  });

  it('drops one malformed entity on decode, not the whole frame', () => {
    const raw = new Uint8Array([1, ...encode({ ...full, entities: [{ id: 5, hp: 7 }, full.entities[1]] })]);
    const rejected: number[] = [];
    const back = decodeSnapshot(raw, rejected)!;
    expect(rejected).toEqual([5]);
    expect(back.entities).toEqual([full.entities[1]]);
  });

  it('diffs and applies entity deltas, including cleared fields', () => {
    const a: EntityState = { id: 11, kind: 'pod', pos: [100, 200, 300], quat: [0, 0, 0, 1], mode: 'idle', hp: 1, owner: 7 };
    const b: EntityState = { id: 11, kind: 'pod', pos: [100.00001, 200, 300], quat: [0, 0, 0, 1], mode: 'flee', hp: 0.5 };
    const d = diffEntity(a, b)!;
    expect(d).toEqual({ id: 11, mode: 'flee', hp: 0.5, clear: ['owner'] });
    expect(diffEntity(a, { ...a })).toBeNull();
    const first = diffEntity(undefined, a)!;
    expect(first).toEqual(a);
    expect(first).not.toBe(a);
    const applied = applyEntityDelta(a, d);
    expect(applied).toEqual({ id: 11, kind: 'pod', pos: [100, 200, 300], quat: [0, 0, 0, 1], mode: 'flee', hp: 0.5 });
    expect(a.owner).toBe(7);
    applied.pos![0] = 0;
    expect(a.pos![0]).toBe(100);
  });
});
