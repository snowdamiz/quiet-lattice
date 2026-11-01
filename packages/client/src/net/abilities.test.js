// The client's side of abilities (P1.E07.T03): the bars from the skills view, the server's cooldowns and toggles, the
// casts a key sends and what the HUD draws of them, the target an `entity` cast names, and the effects registered for
// the casts seen. Nothing here decides a cooldown.
import { describe, expect, it } from 'vitest';
import { Abilities, ANSWER_WAIT_MS, pickTarget, playAbilityFx, REFUSAL_SHOWN_MS, registerAbilityFx } from './abilities.js';

/** A stand-in for Net: its listeners, what was sent, and a store of entities. */
function fakeNet() {
  const handlers = new Map();
  const net = {
    sent: [],
    entityId: 1,
    store: { entities: new Map() },
    on(type, fn) {
      (handlers.get(type) ?? handlers.set(type, []).get(type)).push(fn);
      return () => handlers.get(type).splice(handlers.get(type).indexOf(fn), 1);
    },
    emit: (type, m) => (handlers.get(type) ?? []).forEach((fn) => fn(m)),
    send(m) {
      net.sent.push(m);
      return true;
    },
  };
  return net;
}

const view = (ground, ship = [], shipSlots = 2) => ({
  state: { slots: { ground: [...ground, ...Array(6 - ground.length).fill(null)], ship: [...ship, ...Array(5 - ship.length).fill(null)] } },
  shipSlots,
});
const intent = { time: 1000, frame: '1:2', aim: [0, 0, -1] };

function setup() {
  const net = fakeNet();
  let now = 0;
  const a = new Abilities({ now: () => now });
  a.link(net);
  net.emit('skills', { skills: view(['pulse', null, 'well'], ['tractor_beam', 'deep_sweep', 'jammer'], 2) });
  return { net, a, tick: (ms) => (now += ms) };
}

describe('the client’s abilities', () => {
  it('casts what the server says is in a slot, numbered from 1, and nothing from an empty slot or past the hull’s', () => {
    const { net, a } = setup();
    expect(a.cast('ground', 0, intent)).toEqual({ t: 'cast', seq: 1, time: 1000, node: 'pulse', slot: 0, frame: '1:2', aim: [0, 0, -1] });
    expect(a.cast('ground', 1, intent)).toBeNull();
    expect(a.cast('ship', 1, intent)).toMatchObject({ seq: 2, node: 'deep_sweep', slot: 1 });
    // the Lark works two ship slots: Jammer in the third is not cast
    expect(a.cast('ship', 2, intent)).toBeNull();
    expect(a.cast('ground', 0, null)).toBeNull();
    expect(net.sent.map((m) => m.node)).toEqual(['pulse', 'deep_sweep']);
  });

  it('shows the server’s cooldowns on the clock they run on, its toggles, a cast on its way and a refusal for a while', () => {
    const { net, a, tick } = setup();
    a.cast('ground', 0, intent);
    expect(a.slots('ground', 1000)[0]).toMatchObject({ key: 1, node: 'pulse', name: 'Pulse', left: 0, sending: true });
    net.emit('abilities', { t: 'abilities', cooldowns: [{ node: 'pulse', readyAt: 1006 }], on: ['well'] });
    net.emit('cast', { t: 'cast', seq: 1, node: 'pulse', slot: 0, result: 'cast', readyAt: 1006 });
    const [pulse, empty, well] = a.slots('ground', 1001.5);
    expect(pulse).toMatchObject({ left: 4.5, length: 6, sending: false, refused: null, castAt: 0 });
    expect(empty).toMatchObject({ key: 2, node: null, left: 0 });
    expect(well).toMatchObject({ key: 3, node: 'well', on: true });
    expect(a.slots('ground', 1007)[0].left).toBe(0);
    // a refusal: its reason on the slot until REFUSAL_SHOWN_MS has gone, and a cooldown's end as the server says
    a.cast('ground', 2, intent);
    net.emit('cast', { t: 'cast', seq: 2, node: 'well', slot: 2, result: 'refused', reason: 'cooldown', readyAt: 1020 });
    expect(a.slots('ground', 1010)[2]).toMatchObject({ refused: 'cooldown', left: 10 });
    tick(REFUSAL_SHOWN_MS);
    expect(a.slots('ground', 1010)[2].refused).toBeNull();
    // an answer that never came stops showing as sent
    a.cast('ground', 0, intent);
    tick(ANSWER_WAIT_MS + 1);
    expect(a.slots('ground', 1010)[0].sending).toBe(false);
  });

  it('starts over on a welcome: no bars, cooldowns or numbering carried into the new session', () => {
    const { net, a } = setup();
    a.cast('ground', 0, intent);
    net.emit('abilities', { t: 'abilities', cooldowns: [{ node: 'pulse', readyAt: 1006 }], on: [] });
    net.emit('welcome', {});
    expect(a.slots('ground', 1000)[0]).toMatchObject({ node: null, left: 0 });
    net.emit('skills', { skills: view(['pulse']) });
    expect(a.cast('ground', 0, intent).seq).toBe(1);
  });

  it('plays the effect registered for a cast seen, its end for a toggle going off, and nothing for a node without one', () => {
    const { net, a } = setup();
    const seen = [];
    const game = {};
    a.listen((e) => playAbilityFx(game, e));
    const off = registerAbilityFx('pulse', { cast: (e, g) => seen.push(['cast', e.caster, g]), end: (e) => seen.push(['end', e.caster]) });
    expect(() => registerAbilityFx('pulse', { cast() {} })).toThrow(/already/);
    net.emit('event', { event: { kind: 'cast', caster: 7, node: 'pulse', phase: 'cast', at: 1, frame: null, aim: [0, 0, 1] } });
    net.emit('event', { event: { kind: 'cast', caster: 7, node: 'pulse', phase: 'end', at: 2, frame: null, aim: [0, 0, 1] } });
    net.emit('event', { event: { kind: 'cast', caster: 7, node: 'well', phase: 'cast', at: 3, frame: null, aim: [0, 0, 1] } });
    net.emit('event', { event: { kind: 'combat', source: 7, target: 8, amount: 1, damageType: 'ability', killed: false } });
    expect(seen).toEqual([
      ['cast', 7, game],
      ['end', 7],
    ]);
    off();
  });
});

describe('the target an entity cast names', () => {
  const ability = { node: 'pull', target: 'entity', on: ['mob'] };
  const node = { params: { rangeM: 25 } };
  it('is the living entity of a kind it takes, in its frame and reach, nearest the aim', () => {
    const net = fakeNet();
    const put = (id, e) => net.store.entities.set(id, { frame: '1:2', kind: 'mob', mode: 'idle', hp: 1, ...e });
    put(1, { kind: 'player', pos: [0, 0, -5] });
    put(2, { pos: [1.2, 0, -10] });
    put(3, { pos: [0.4, 0, -12] });
    put(4, { pos: [0, 0, -8], mode: 'dead', hp: 0 });
    put(5, { pos: [0, 0, -9], frame: '1:3' });
    put(6, { pos: [0, 0, -40] });
    put(7, { pos: [0, 0, -6], kind: 'player' });
    const eye = { x: 0, y: 0, z: 0 };
    const aim = { x: 0, y: 0, z: -1, length: () => 1 };
    expect(pickTarget(net, '1:2', eye, aim, ability, node)).toBe(3);
    net.store.entities.delete(3);
    expect(pickTarget(net, '1:2', eye, aim, ability, node)).toBe(2);
    net.store.entities.delete(2);
    expect(pickTarget(net, '1:2', eye, aim, ability, node)).toBeNull();
    expect(pickTarget(net, '1:2', eye, aim, { ...ability, on: ['player'] }, node)).toBe(7);
  });
});
