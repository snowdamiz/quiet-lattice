// The resource service (P1.E13.T01) on a real zone of system 0, its home world's drawn ground planned on this thread, and
// a hand-driven clock: mining hits measured by beam time and checked cheapest first; a node shared by two miners, broken
// once and split by damage; growing back and healing; common flora; and the per-cell state each player is sent.
import { decodeServerMessage, type ServerMessage } from '@astra/shared/protocol';
import { FLORA_HARVEST, nodeType, type NodeGround } from '@astra/shared/world';
import { beforeAll, describe, expect, it } from 'vitest';
import { miningWorld, norm, type NodeSpot, type Vec3 } from '../../test/resourceWorld.ts';
import { InventoryService } from '../inventory/service.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { HEAL_S, RESPAWN_S } from './nodes.ts';
import {
  FLORA_PATCH_S,
  FLORA_HP_PER_PATCH,
  FLORA_PATCH_M,
  HIT_BURST,
  HIT_CREDIT_MAX_S,
  MULTITOOL_POWER,
  NODE_FORGET_M,
  ResourceService,
  questMineEvent,
  splitByDamage,
  type MinedEvent,
  type ResourceServiceOptions,
} from './service.ts';

let world: ReturnType<typeof miningWorld>;
let deposit: NodeSpot;

beforeAll(() => {
  world = miningWorld(0, 0);
  deposit = world.findNode({ want: (t) => nodeType(t).kind === 'deposit' });
});

class Viewer implements ZoneViewer {
  readonly got: ServerMessage[] = [];
  constructor(
    readonly id: number,
    readonly characterId: string,
  ) {}
  sendBinary(): void {}
  send(m: ServerMessage): void {
    this.got.push(m);
  }
  /** the `nodes` messages it was sent, taken */
  nodes() {
    const out = this.got.filter((m) => m.t === 'nodes');
    this.got.length = 0;
    return out;
  }
}

/** A zone of system 0 with the service over it, players standing where the test puts them and a clock it moves. */
function setup(opts: Partial<ResourceServiceOptions> = {}) {
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: world.system, fauna: false });
  const inventory = new InventoryService();
  const clock = { t: 1000 };
  const grounds = { ground: (): NodeGround | null => world.ground };
  const service = new ResourceService({
    zones: { zones: [zone], zoneOf: (v) => (zone.has(v) ? zone : undefined), tier: () => 0 },
    inventory,
    now: () => clock.t,
    grounds,
    seed: 7,
    ...opts,
  });
  let ids = 0;
  const seqs = new Map<Viewer, number>();
  const player = (pos: Readonly<Vec3>, mode = 'foot') => {
    const v = new Viewer(++ids, `char-${ids}`);
    inventory.open(v.characterId);
    zone.join(v, {
      kind: 'player',
      frame: world.frame,
      pos: [...pos],
      quat: [0, 0, 0, 1],
      vel: [0, 0, 0],
      mode,
      name: `Miner ${ids}`,
      people: 'thalune',
      level: 5,
    });
    seqs.set(v, 0);
    return v;
  };
  const move = (v: Viewer, pos: Readonly<Vec3>, mode = 'foot', frame = world.frame) => {
    zone.patch(zone.entityOf(v)!, { pos: [...pos], frame, mode });
  };
  const hit = (v: Viewer, node: string, extra: Record<string, unknown> = {}) => {
    const seq = seqs.get(v)! + 1;
    seqs.set(v, seq);
    return service.mine(v, { t: 'mine', seq, frame: world.frame, node, tool: 'multitool', time: clock.t, ...extra });
  };
  const flora = (v: Viewer, kind: keyof typeof FLORA_HARVEST, ref: string, at: Readonly<Vec3>) => {
    const seq = seqs.get(v)! + 1;
    seqs.set(v, seq);
    return service.mine(v, { t: 'mine', seq, frame: world.frame, flora: { kind, ref, at: [...at] }, tool: 'multitool', time: clock.t });
  };
  const held = (v: Viewer, item: string) => {
    const inv = inventory.get(v.characterId)!;
    return [...inv.suit, ...inv.pods.flat()].reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
  };
  /**
   * Hits `node` until it breaks, `who(i)` hitting at step i (the clock moves a quarter second a step). Returns the damage
   * each character did (what each hit took off the node, read from it as the hits land), who broke it, its answer, and
   * each character's share as listeners heard it.
   */
  const breakNode = (node: string, who: (i: number) => readonly Viewer[]) => {
    const damage = new Map<string, number>();
    const shares = new Map<string, number>();
    const off = service.subscribe((e) => shares.set(e.characterId, e.count));
    try {
      for (let i = 0; i < 400; i++) {
        for (const v of who(i)) {
          const hp = service.nodeState(world.frame, node)?.hp ?? nodeType(node.split('_').slice(3, -1).join('_')).hp;
          const r = hit(v, node);
          const after = r.result === 'depleted' ? 0 : service.nodeState(world.frame, node)!.hp;
          if (r.result !== 'hit' && r.result !== 'depleted') throw new Error(`hit refused: ${r.reason}`);
          if (hp > after) damage.set(v.characterId, (damage.get(v.characterId) ?? 0) + hp - after);
          if (r.result === 'depleted') return { damage, breaker: v, answer: r, shares };
        }
        clock.t += 0.25;
      }
    } finally {
      off();
    }
    throw new Error('the node never broke');
  };
  return { zone, inventory, clock, service, grounds, player, move, hit, flora, held, breakNode };
}

describe('mining hits', () => {
  it('are worth the beam time since the last, at most half a second, at the multitool’s power', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    const hp = nodeType(deposit.node.type).hp;
    // a first hit is worth one hit interval of beam
    const r1 = s.hit(a, deposit.id);
    expect(r1).toMatchObject({ result: 'hit', node: deposit.id, seq: 1 });
    expect(r1.hp).toBeCloseTo(1 - (0.25 * MULTITOOL_POWER) / hp, 9);
    s.clock.t += 0.25;
    expect(s.hit(a, deposit.id).hp).toBeCloseTo(1 - (0.5 * MULTITOOL_POWER) / hp, 9);
    // a pause is worth no more than HIT_CREDIT_MAX_S
    s.clock.t += 5;
    expect(s.hit(a, deposit.id).hp).toBeCloseTo(1 - ((0.5 + HIT_CREDIT_MAX_S) * MULTITOOL_POWER) / hp, 9);
    // hits sent faster are worth nothing more
    for (let i = 0; i < 3; i++) expect(s.hit(a, deposit.id).hp).toBeCloseTo(1 - ((0.5 + HIT_CREDIT_MAX_S) * MULTITOOL_POWER) / hp, 9);
    expect(s.service.nodeState(world.frame, deposit.id)!.by.get(a.characterId)).toBeCloseTo((0.5 + HIT_CREDIT_MAX_S) * MULTITOOL_POWER, 9);
  });

  it('past the burst, a flood is refused `rate` before anything else', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    const r = Array.from({ length: HIT_BURST + 4 }, () => s.hit(a, deposit.id));
    expect(r.slice(0, HIT_BURST).every((x) => x.result === 'hit')).toBe(true);
    expect(r.slice(HIT_BURST).map((x) => x.reason)).toEqual(Array(4).fill('rate'));
    // it refills
    s.clock.t += 1;
    expect(s.hit(a, deposit.id).result).toBe('hit');
  });

  it('a node broken by one miner: its whole yield, then `harvested` until it grows back', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    const type = nodeType(deposit.node.type);
    const events: MinedEvent[] = [];
    s.service.subscribe((e) => events.push(e));
    let r;
    for (let i = 0; i < 40; i++) {
      r = s.hit(a, deposit.id);
      if (r.result !== 'hit') break;
      s.clock.t += 0.25;
    }
    expect(r).toMatchObject({ result: 'depleted', item: type.resource });
    expect(r!.count).toBeGreaterThanOrEqual(type.yield[0]);
    expect(r!.count).toBeLessThanOrEqual(type.yield[1]);
    expect(r!.added).toBe(r!.count);
    expect(s.held(a, type.resource)).toBe(r!.count);
    expect(events).toEqual([
      {
        characterId: a.characterId,
        zone: 'sys:0',
        frame: world.frame,
        node: deposit.id,
        what: type.id,
        resource: type.resource,
        count: r!.count,
        added: r!.count,
        broke: true,
      },
    ]);
    s.clock.t += 1;
    expect(s.hit(a, deposit.id).reason).toBe('harvested');
    expect(s.service.nodeState(world.frame, deposit.id)!.respawnAt).toBeCloseTo(s.clock.t - 1 + RESPAWN_S[type.kind], 6);
  });

  it('two miners share one node: damage adds up, it breaks once, its yield is split by damage', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    const b = s.player(deposit.stand);
    const type = nodeType(deposit.node.type);
    // a beams twice as long as b (b hits once a second, each hit worth at most half a second)
    const { damage, breaker, answer: last } = s.breakNode(deposit.id, (i) => (i % 4 ? [a] : [a, b]));
    const share = (v: Viewer) => s.held(v, type.resource);
    const total = share(a) + share(b);
    expect(total).toBeGreaterThanOrEqual(type.yield[0]);
    expect(total).toBeLessThanOrEqual(type.yield[1]);
    // exactly the yield split by the damage each did
    expect(damage.get(a.characterId)! + damage.get(b.characterId)!).toBeCloseTo(type.hp, 9);
    expect(damage.get(a.characterId)!).toBeGreaterThan(1.5 * damage.get(b.characterId)!);
    const want = splitByDamage(total, [...damage]);
    expect(new Map([a, b].map((v) => [v.characterId, share(v)]))).toEqual(want);
    expect(share(a)).toBeGreaterThan(share(b));
    expect(share(b)).toBeGreaterThan(0);
    expect(last).toMatchObject({ count: share(breaker), added: share(breaker) });
    // the one whose hit did not break it hears its share as an unasked answer
    const other = breaker === a ? b : a;
    expect(other.got.filter((m) => m.t === 'mine')).toEqual([
      { t: 'mine', seq: 0, frame: world.frame, node: deposit.id, result: 'depleted', item: type.resource, count: share(other), added: share(other) },
    ]);
    expect(s.hit(a, deposit.id).reason).toBe('harvested');
    expect(s.hit(b, deposit.id).reason).toBe('harvested');
  });

  it('every miner’s damage counts: a ninth gets its share, and token taggers only theirs, however many', () => {
    const type = nodeType(deposit.node.type);
    {
      const s = setup();
      const nine = Array.from({ length: 9 }, () => s.player(deposit.stand));
      const { damage, shares } = s.breakNode(deposit.id, () => nine);
      expect(damage.size).toBe(9);
      const total = [...shares.values()].reduce((x, y) => x + y, 0);
      expect(shares).toEqual(splitByDamage(total, [...damage]));
      const ninth = nine[8]!.characterId;
      expect(shares.get(ninth)).toBeGreaterThan(0);
      expect(s.held(nine[8]!, type.resource)).toBe(shares.get(ninth));
    }
    {
      // eight characters each prime their beam on a rock, then tag the node a millisecond later; one does the work
      const s = setup();
      const taggers = Array.from({ length: 8 }, () => s.player(deposit.stand));
      const worker = s.player(deposit.stand);
      const rock = world.onGround(norm(deposit.stand), 3, 3);
      taggers.forEach((t, i) => s.flora(t, 'rock', `prime${i}`, rock));
      s.clock.t += 0.001;
      for (const t of taggers) expect(s.hit(t, deposit.id).result).toBe('hit');
      const tagged = [...s.service.nodeState(world.frame, deposit.id)!.by.values()].reduce((x, y) => x + y, 0);
      expect(tagged).toBeLessThan(0.02);
      s.clock.t += 0.25;
      const { damage, shares } = s.breakNode(deposit.id, () => [worker]);
      const all = new Map([...taggers.map((t) => [t.characterId, 0.001 * MULTITOOL_POWER] as const), [worker.characterId, damage.get(worker.characterId)!]]);
      const total = [...shares.values()].reduce((x, y) => x + y, 0);
      expect(total).toBeGreaterThanOrEqual(type.yield[0]);
      expect(new Map([...taggers, worker].map((v) => [v.characterId, s.held(v, type.resource)]))).toEqual(splitByDamage(total, [...all]));
      // their few thousandths of the node are worth nothing; the worker takes the yield
      for (const t of taggers) expect(s.held(t, type.resource)).toBe(0);
      expect(s.held(worker, type.resource)).toBe(total);
    }
  });

  it('a share that does not fit is reported, not kept', () => {
    const s = setup({
      inventory: { grant: (_c, _i, count) => ({ ok: true, inv: undefined as never, added: Math.min(5, count), remainder: Math.max(0, count - 5) }) },
    });
    const a = s.player(deposit.stand);
    let r;
    for (let i = 0; i < 40 && (r = s.hit(a, deposit.id)).result === 'hit'; i++) s.clock.t += 0.25;
    expect(r!.result).toBe('depleted');
    expect(r!.added).toBe(5);
    expect(r!.count).toBeGreaterThan(5);
  });

  it('a broken node grows back after its respawn time; a damaged one heals when left alone', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    const type = nodeType(deposit.node.type);
    s.hit(a, deposit.id);
    s.clock.t += HEAL_S - 1;
    s.service.sweep();
    expect(s.service.nodeState(world.frame, deposit.id)!.hp).toBeLessThan(type.hp);
    s.clock.t += 2;
    s.service.sweep();
    expect(s.service.nodeState(world.frame, deposit.id)).toBeUndefined();
    while (s.hit(a, deposit.id).result === 'hit') s.clock.t += 0.25;
    const broke = s.clock.t;
    s.clock.t = broke + RESPAWN_S[type.kind] - 1;
    s.service.sweep();
    expect(s.hit(a, deposit.id).reason).toBe('harvested');
    s.clock.t = broke + RESPAWN_S[type.kind] + 0.1;
    s.service.sweep();
    expect(s.service.nodeState(world.frame, deposit.id)).toBeUndefined();
    expect(s.hit(a, deposit.id).result).toBe('hit');
    // a shorter respawn (tests, the dev CLI)
    s.service.respawnSeconds = () => 2;
    while (s.hit(a, deposit.id).result === 'hit') s.clock.t += 0.25;
    s.clock.t += 2.1;
    s.service.sweep();
    expect(s.service.nodeState(world.frame, deposit.id)).toBeUndefined();
    expect(s.service.store.size).toBe(0);
  });

  it('are refused cheapest first: number, rate, clock, place, mode, world, id, reach (before the scatter), ground, node', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    expect(s.service.mine(a, { t: 'mine', seq: 5, frame: world.frame, node: deposit.id, tool: 'multitool', time: s.clock.t }).result).toBe('hit');
    expect(s.service.mine(a, { t: 'mine', seq: 5, frame: world.frame, node: deposit.id, tool: 'multitool', time: s.clock.t }).reason).toBe('stale_seq');
    s.hit(a, deposit.id); // (seq 1, behind)
    const seq = { n: 10 };
    const at = (v: Viewer, extra: Record<string, unknown>) =>
      s.service.mine(v, { t: 'mine', seq: ++seq.n, frame: world.frame, node: deposit.id, tool: 'multitool', time: s.clock.t, ...extra });
    expect(at(a, { time: s.clock.t - 10 }).reason).toBe('stale');
    s.clock.t += 1;
    // not on foot; another frame; the Waystation's frame
    s.move(a, deposit.stand, 'ship');
    expect(at(a, {}).reason).toBe('mode');
    s.move(a, deposit.stand);
    expect(at(a, { frame: s.zone.stationFrame.replace('station', '0') }).reason).toBe('world');
    s.clock.t += 1;
    // a node id this world cannot have: a type it lacks, a cell off its grid
    expect(at(a, { node: deposit.id.replace(deposit.node.type, 'frostglass') }).reason).toBe('unknown');
    expect(at(a, { node: `0_${2 ** world.level}_0_${deposit.node.type}_0` }).reason).toBe('unknown');
    // a candidate the scatter did not keep
    expect(at(a, { node: deposit.id.replace(/_\d+$/, '_999') }).reason).toBe('unknown');
    s.clock.t += 1;
    // too far: refused before any cell is scattered or any ground sampled
    const before = s.service.stats();
    s.move(a, world.onGround(norm(deposit.stand), 400, 0));
    for (let i = 0; i < 5; i++) expect(at(a, {}).reason).toBe('range');
    const after = s.service.stats();
    expect(after.scattered).toBe(before.scattered);
    expect(after.losSamples).toBe(before.losSamples);
    // in the cell's reach but not the beam's
    s.clock.t += 1;
    s.move(a, world.onGround(norm(deposit.stand), 0, 45));
    expect(at(a, {}).reason).toBe('range');
    // the ground not planned yet
    s.move(a, deposit.stand);
    s.grounds.ground = () => null;
    expect(at(a, {}).reason).toBe('busy');
  });

  it('with Heat’s meters, mine only while they say the beam is firing (held, out of the lockout)', () => {
    let firing = false;
    const asked: [string, number][] = [];
    const s = setup({ meters: { beamActive: (id, now) => (asked.push([id, now]), firing) } });
    const a = s.player(deposit.stand);
    // the beam button not held: nothing
    expect(s.hit(a, deposit.id).reason).toBe('heat');
    expect(asked).toEqual([[a.characterId, s.clock.t]]);
    expect(s.service.nodeState(world.frame, deposit.id)).toBeUndefined();
    firing = true;
    s.clock.t += 0.25;
    expect(s.hit(a, deposit.id).result).toBe('hit');
    // overheated (the lockout): nothing again
    firing = false;
    s.clock.t += 0.25;
    const hp = s.service.nodeState(world.frame, deposit.id)!.hp;
    expect(s.hit(a, deposit.id).reason).toBe('heat');
    expect(s.service.nodeState(world.frame, deposit.id)!.hp).toBe(hp);
    // a character the meters do not hold is not firing
    const t = setup({
      meters: {
        beamActive: () => {
          throw new Error('not held');
        },
      },
    });
    expect(t.hit(t.player(deposit.stand), deposit.id).reason).toBe('heat');
  });

  it('are refused `los` with the ground in the way, and `heat` when the multitool may not fire', () => {
    const blocked = world.findNode({ blocked: true });
    const s = setup();
    const a = s.player(blocked.stand);
    expect(s.hit(a, blocked.id).reason).toBe('los');
    expect(s.service.nodeState(world.frame, blocked.id)).toBeUndefined();
    const b = s.player(deposit.stand);
    const asked: [string, number][] = [];
    s.service.beam = (id, seconds) => (asked.push([id, seconds]), false);
    expect(s.hit(b, deposit.id).reason).toBe('heat');
    expect(asked).toEqual([[b.characterId, 0.25]]);
  });

  it('yield and breaking speed follow the skill web (Optical Drill, Hot Hands)', () => {
    const owned = new Map<string, string[]>();
    const s = setup({ skills: { owned: (id) => owned.get(id) ?? [] } });
    const a = s.player(deposit.stand);
    owned.set(a.characterId, ['hot_hands', 'optical_drill']);
    const type = nodeType(deposit.node.type);
    expect(s.hit(a, deposit.id).hp).toBeCloseTo(1 - (0.25 * MULTITOOL_POWER * 1.5) / type.hp, 9);
    let r;
    while ((r = s.hit(a, deposit.id)).result === 'hit') s.clock.t += 0.25;
    // each ×1.5: 2.25 times a roll within the node's yield
    expect(r.count).toBeGreaterThanOrEqual(Math.round(type.yield[0] * 2.25));
    expect(r.count).toBeLessThanOrEqual(Math.round(type.yield[1] * 2.25));
  });
});

describe('common flora', () => {
  it('breaks on the same beam time, gives its yield once per plant, and must be a kind the world grows, on its ground, in reach', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    const up = norm(deposit.stand);
    const tree = world.onGround(up, 4, 3);
    const spec = FLORA_HARVEST.tree;
    let r;
    let hits = 0;
    while ((r = s.flora(a, 'tree', 'tree:1', tree)).result === 'hit') {
      hits++;
      s.clock.t += 0.25;
    }
    expect(hits).toBe(Math.ceil(spec.hp / (0.25 * MULTITOOL_POWER)) - 1);
    expect(r).toMatchObject({ result: 'depleted', item: 'carbon', flora: 'tree:1' });
    expect(r.count).toBeGreaterThanOrEqual(spec.yield[0]);
    expect(r.count).toBeLessThanOrEqual(spec.yield[1]);
    expect(s.held(a, 'carbon')).toBe(r.count);
    expect(s.flora(a, 'tree', 'tree:1', tree).reason).toBe('harvested');
    // a lush world grows trees, not a bare world's crystal growths
    expect(s.flora(a, 'crystal', 'c:1', tree).reason).toBe('unknown');
    // a plant must stand on the ground, and in reach
    const air = norm(tree).map((x, i) => tree[i]! + x * 15) as Vec3;
    expect(s.flora(a, 'rock', 'r:1', air).reason).toBe('unknown');
    expect(s.flora(a, 'rock', 'r:2', world.onGround(up, 60, 0)).reason).toBe('range');
    // flora and nodes share one beam: a plant and a node in the same instant are worth one interval between them
    s.clock.t += 1;
    s.flora(a, 'rock', 'r:3', tree);
    expect(s.hit(a, deposit.id).hp).toBe(1);
  });

  it('a patch of ground gives a character at most FLORA_HP_PER_PATCH hp of flora an hour, however it names it', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    const up = norm(deposit.stand);
    /** breaks one plant of `kind` with a fresh key at `at`: its last answer */
    let n = 0;
    const one = (kind: keyof typeof FLORA_HARVEST, at: Readonly<Vec3>) => {
      const ref = `p${n++}`;
      for (;;) {
        s.clock.t += 0.5;
        const r = s.flora(a, kind, ref, at);
        if (r.result !== 'hit') return r;
      }
    };
    const here = world.onGround(up, 3, 3);
    // rocks are 1 hp: FLORA_HP_PER_PATCH of them; then nothing, not even a rock
    const rocks = Array.from({ length: FLORA_HP_PER_PATCH + 2 }, () => one('rock', here));
    expect(rocks.filter((r) => r.result === 'depleted').length).toBe(FLORA_HP_PER_PATCH);
    expect(rocks.slice(FLORA_HP_PER_PATCH).map((r) => r.reason)).toEqual(['harvested', 'harvested']);
    // giant growths are 6 hp: a fresh patch gives FLORA_HP_PER_PATCH / 6 of them
    const there = world.onGround(up, -12, -14);
    const giants = Array.from({ length: FLORA_HP_PER_PATCH / FLORA_HARVEST.giant.hp + 2 }, () => one('giant', there));
    expect(giants.filter((r) => r.result === 'depleted').length).toBe(FLORA_HP_PER_PATCH / FLORA_HARVEST.giant.hp);
    // an hour on, the first patch gives again
    s.clock.t += FLORA_PATCH_S;
    expect(one('rock', here).result).toBe('depleted');
  });

  it('standing still and naming flora that is not there is held to the patches in reach, the same for rocks, boulders and giants', () => {
    const up = norm(deposit.stand);
    // every point on the ground within reach of the stand, 5 m apart, that the beam can see
    const spots: Vec3[] = [];
    for (let e = -30; e <= 30; e += 5) {
      for (let nn = -30; nn <= 30; nn += 5) {
        const at = world.onGround(up, e, nn);
        if (Math.hypot(at[0] - deposit.stand[0], at[1] - deposit.stand[1], at[2] - deposit.stand[2]) > 33) continue;
        const u = norm(at);
        if (world.clear(deposit.stand, [at[0] + u[0], at[1] + u[1], at[2] + u[2]])) spots.push(at);
      }
    }
    const patches = new Set(spots.map((at) => at.map((x) => Math.floor(x / FLORA_PATCH_M)).join(':'))).size;
    expect(patches).toBeGreaterThan(20);
    const got: Record<string, number> = {};
    for (const kind of ['rock', 'boulder', 'giant'] as const) {
      const s = setup();
      const a = s.player(deposit.stand);
      const t0 = s.clock.t;
      // an hour of the beam held on, a fresh key each break, round the spots in reach
      for (let k = 0; s.clock.t - t0 < FLORA_PATCH_S; k++) {
        const ref = `${kind}${k}`;
        const at = spots[k % spots.length]!;
        for (;;) {
          s.clock.t += 0.5;
          if (s.flora(a, kind, ref, at).result !== 'hit') break;
        }
      }
      got[kind] = s.held(a, FLORA_HARVEST[kind].resource);
    }
    // every kind gives 5–10 units an hp, so the hour is worth at most the patches' hp at 10 units an hp, and about the
    // same whatever is named (the break-count budget gave giants six times what rocks gave)
    for (const kind of ['rock', 'boulder', 'giant']) expect(got[kind]).toBeLessThanOrEqual(patches * FLORA_HP_PER_PATCH * 10);
    const most = Math.max(...Object.values(got));
    const least = Math.min(...Object.values(got));
    expect(most / least).toBeLessThan(1.4);
    // and far below an honest beam on rocks for the hour (1.6 hp a second, 7.5 units an hp, before any overheating)
    expect(most).toBeLessThan(MULTITOOL_POWER * FLORA_PATCH_S * 7.5 * 0.4);
  });
});

describe('what players are sent', () => {
  it('a reset as they arrive on a world, then the touched cells round them as they change, and nothing far away', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    const b = s.player(deposit.stand);
    const far = s.player(world.onGround(norm(deposit.stand), 2000, 0));
    s.service.sweep();
    for (const v of [a, b, far]) expect(v.nodes()).toEqual([{ t: 'nodes', frame: world.frame, reset: true, cells: [] }]);
    s.service.sweep();
    expect(a.nodes()).toEqual([]);
    const cell = deposit.id.split('_').slice(0, 3).join('_');
    const sub = deposit.id.split('_').slice(3).join('_');
    // a's hits show on b's side in tenths of the node
    for (let i = 0; i < 3; i++) {
      s.hit(a, deposit.id);
      s.clock.t += 0.25;
    }
    s.service.sweep();
    const left = s.service.nodeState(world.frame, deposit.id)!.hp / nodeType(deposit.node.type).hp;
    const shown = Math.ceil(left * 10) / 10;
    for (const v of [a, b]) expect(v.nodes()).toEqual([{ t: 'nodes', frame: world.frame, cells: [{ cell, gone: [], hurt: [[sub, shown]] }] }]);
    expect(far.nodes()).toEqual([]);
    // broken: gone for everyone near
    while (s.hit(b, deposit.id).result === 'hit') s.clock.t += 0.25;
    s.service.sweep();
    for (const v of [a, b]) expect(v.nodes()).toEqual([{ t: 'nodes', frame: world.frame, cells: [{ cell, gone: [sub], hurt: [] }] }]);
    // someone arriving later is sent it as it arrives
    const late = s.player(deposit.stand);
    s.service.sweep();
    expect(late.nodes()).toEqual([{ t: 'nodes', frame: world.frame, reset: true, cells: [{ cell, gone: [sub], hurt: [] }] }]);
    // walking away: the cell is forgotten past NODE_FORGET_M, and sent again on the way back
    s.move(a, world.onGround(norm(deposit.stand), NODE_FORGET_M + 100, 0));
    s.service.sweep();
    expect(a.nodes()).toEqual([{ t: 'nodes', frame: world.frame, cells: [{ cell, gone: [], hurt: [] }] }]);
    s.move(a, deposit.stand);
    s.service.sweep();
    expect(a.nodes()).toEqual([{ t: 'nodes', frame: world.frame, cells: [{ cell, gone: [sub], hurt: [] }] }]);
    // grown back: an empty cell, and nothing more
    s.clock.t += RESPAWN_S[nodeType(deposit.node.type).kind] + 1;
    s.service.sweep();
    for (const v of [a, b, late]) expect(v.nodes()).toEqual([{ t: 'nodes', frame: world.frame, cells: [{ cell, gone: [], hurt: [] }] }]);
    s.service.sweep();
    expect(a.nodes()).toEqual([]);
    // leaving the world and coming back starts it over
    s.move(a, [0, 0, 0], 'docked', s.zone.stationFrame);
    s.service.sweep();
    s.move(a, deposit.stand);
    s.service.sweep();
    expect(a.nodes()).toEqual([{ t: 'nodes', frame: world.frame, reset: true, cells: [] }]);
  });

  it('a player crossing straight from one world’s frame to another’s starts over on the new one', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    const b = s.player(deposit.stand);
    while (s.hit(b, deposit.id).result === 'hit') s.clock.t += 0.25;
    s.service.sweep();
    const cell = deposit.id.split('_').slice(0, 3).join('_');
    expect(a.nodes()).toEqual([{ t: 'nodes', frame: world.frame, reset: true, cells: [{ cell, gone: [deposit.id.slice(cell.length + 1)], hurt: [] }] }]);
    // another rocky body of the system (a moon in its planet's sphere, say): no stop in between
    const other = world.system.bodies.find((x) => x.type !== 'gas' && x.index !== world.body.index)!;
    const there = `${world.system.seed}:${other.index}`;
    s.move(a, [other.radius + 2, 0, 0], 'foot', there);
    s.service.sweep();
    expect(a.nodes()).toEqual([{ t: 'nodes', frame: there, reset: true, cells: [] }]);
    s.move(a, deposit.stand);
    s.service.sweep();
    expect(a.nodes()).toEqual([{ t: 'nodes', frame: world.frame, reset: true, cells: [{ cell, gone: [deposit.id.slice(cell.length + 1)], hurt: [] }] }]);
  });

  it('to a session, as text put together from cells encoded once: the same message, decodable as sent', () => {
    const s = setup();
    class TextViewer extends Viewer {
      readonly texts: string[] = [];
      sendText(text: string): void {
        this.texts.push(text);
      }
    }
    const a = new TextViewer(90, 'char-text');
    s.inventory.open(a.characterId);
    s.zone.join(a, {
      kind: 'player',
      frame: world.frame,
      pos: [...deposit.stand],
      quat: [0, 0, 0, 1],
      vel: [0, 0, 0],
      mode: 'foot',
      name: 'Texter',
      people: 'thalune',
      level: 5,
    });
    const b = s.player(deposit.stand);
    s.service.sweep();
    expect(a.texts.map((t) => decodeServerMessage(t))).toEqual([{ t: 'nodes', frame: world.frame, reset: true, cells: [] }]);
    expect(a.got).toEqual([]);
    while (s.hit(b, deposit.id).result === 'hit') s.clock.t += 0.25;
    a.texts.length = 0;
    s.service.sweep();
    const cell = deposit.id.split('_').slice(0, 3).join('_');
    expect(a.texts.map((t) => decodeServerMessage(t))).toEqual([
      { t: 'nodes', frame: world.frame, cells: [{ cell, gone: [deposit.id.slice(cell.length + 1)], hurt: [] }] },
    ]);
    expect(JSON.parse(a.texts[0]!)).toEqual(decodeServerMessage(a.texts[0]!));
  });
});

describe('questMineEvent', () => {
  it('a node share is a `mine` event of its type, the node on its world the distinct thing; flora and empty shares are none', () => {
    const s = setup();
    const a = s.player(deposit.stand);
    const events: MinedEvent[] = [];
    s.service.subscribe((e) => events.push(e));
    s.breakNode(deposit.id, () => [a]);
    do s.clock.t += 0.5;
    while (s.flora(a, 'rock', 'q:1', world.onGround(norm(deposit.stand), 3, 3)).result === 'hit');
    expect(events.map((e) => e.node)).toEqual([deposit.id, null]);
    expect(events.map(questMineEvent)).toEqual([{ type: 'mine', node: deposit.node.type, id: `${world.frame}/${deposit.id}` }, null]);
    expect(questMineEvent({ ...events[0]!, count: 0, added: 0 })).toBeNull();
  });
});

describe('splitByDamage', () => {
  it('splits a yield in whole units by damage, largest remainders first, ties in order', () => {
    expect([
      ...splitByDamage(10, [
        ['a', 2],
        ['b', 1],
      ]),
    ]).toEqual([
      ['a', 7],
      ['b', 3],
    ]);
    expect([
      ...splitByDamage(9, [
        ['a', 1],
        ['b', 1],
        ['c', 1],
      ]),
    ]).toEqual([
      ['a', 3],
      ['b', 3],
      ['c', 3],
    ]);
    expect([
      ...splitByDamage(10, [
        ['a', 1],
        ['b', 1],
        ['c', 1],
      ]),
    ]).toEqual([
      ['a', 4],
      ['b', 3],
      ['c', 3],
    ]);
    expect([
      ...splitByDamage(7, [
        ['a', 1],
        ['b', 0],
      ]),
    ]).toEqual([['a', 7]]);
    expect(splitByDamage(7, []).size).toBe(0);
    // float noise in summed damage never decides a tie: 2.8 : 1.2 of 15 is 10.5 : 4.5, and the first named gets the unit
    for (const parts of [
      [
        ['a', 2.8],
        ['b', 1.2],
      ],
      [
        ['a', 2.4 + 0.4000000000000005],
        ['b', 1.2000000000000002],
      ],
      [
        ['a', 0.1 * 28],
        ['b', 0.1 * 12],
      ],
    ] as [string, number][][]) {
      expect([...splitByDamage(15, parts)]).toEqual([
        ['a', 11],
        ['b', 4],
      ]);
    }
    for (let n = 0; n < 50; n++) {
      const parts: [string, number][] = Array.from({ length: 1 + (n % 7) }, (_, i) => [`c${i}`, ((n * 7 + i * 13) % 11) + 0.37]);
      const total = 3 + (n % 40);
      expect([...splitByDamage(total, parts).values()].reduce((x, y) => x + y, 0)).toBe(total);
    }
  });
});
