// The shipped headless client drives real protocol requests with movement authority enabled throughout. Admin
// placements set up a legal surface/combat fixture; every action after placement is judged by the normal services.
import { creatureSphere } from '@astra/shared/combat';
import { WALKER } from '@astra/shared/data';
import type { Pose, Vec3 } from '@astra/shared/protocol';
import { SHIP_GEAR_HEIGHT } from '@astra/shared/ships';
import { dirToWorld, faunaSpecies, nodeType, type PlanetParams } from '@astra/shared/world';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BotClient, BotRefusal, registerBot, runScript } from '../../tools/src/bots/index.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf } from '../src/world/home.ts';
import { startTestServer, uniqueShard, waitFor } from './helpers.ts';
import { miningWorld, norm } from './resourceWorld.ts';

let server: RunningServer;
const bots = new Set<BotClient>();
const outcome = (action: string, bot: BotClient, result: object) =>
  process.stdout.write(`${JSON.stringify({ event: 'bot.action', action, ...result, stats: bot.stats })}\n`);
beforeAll(async () => {
  server = await startTestServer({}, { shard: uniqueShard() });
});
afterAll(async () => {
  await Promise.all([...bots].map((bot) => bot.close()));
  await server?.close();
});

async function join(timeoutMs?: number): Promise<BotClient> {
  const credentials = await registerBot(server.url);
  const bot = await BotClient.connect({ url: server.url, ...credentials, timeoutMs });
  bots.add(bot);
  await bot.settled();
  return bot;
}

async function place(bot: BotClient, frame: string, pos: Vec3, mode: 'ship' | 'docked' = 'ship'): Promise<void> {
  const before = bot.stats.corrections;
  const zone = server.zones.zone(bot.zone)!;
  const result = await server.admin.run(
    { cmd: 'teleport', character: bot.welcome.character.id, system: zone.systemIndex, frame, pose: pos.join(','), mode },
    { name: 'headless bot fixture', via: 'channel' },
  );
  expect(result).toMatchObject({ moved: 'zone' });
  await waitFor(() => bot.stats.corrections > before, 5000, 'bot applied the fixture placement');
  await bot.settled();
}

describe('the shipped headless bot against real authorities', () => {
  it('flies, walks beside its parked ship, boards and docks with authoritative confirmations', async () => {
    const bot = await join();
    const zone = server.zones.zone(bot.zone)!;
    expect(zone.movement).not.toBeNull();
    const parked: Pose = structuredClone(bot.pose);
    const left = dirToWorld({ position: [0, 0, 0], quaternion: parked.quat }, [-1, 0, 0]);
    const feet: Vec3 = [parked.pos[0] + left[0] * WALKER.exit.station.leftM, WALKER.exit.station.feetY, parked.pos[2] + left[2] * WALKER.exit.station.leftM];
    await runScript(bot, [
      { kind: 'disembark', feet },
      { kind: 'walk', to: { frame: parked.frame, pos: [feet[0], feet[1], feet[2] + 2] } },
    ]);
    const walked = zone.entity(bot.entityId)!.fields;
    expect(walked.mode).toBe('foot');
    expect(Math.hypot(walked.pos[0] - feet[0], walked.pos[1] - feet[1], walked.pos[2] - feet[2] - 2)).toBeLessThan(1e-6);
    await runScript(bot, [
      { kind: 'board', ship: parked },
      { kind: 'fly', to: { frame: parked.frame, pos: [parked.pos[0], 14, parked.pos[2]] }, speed: 5 },
      { kind: 'fly', to: { frame: parked.frame, pos: [parked.pos[0], 14, 110] }, speed: 30 },
      { kind: 'fly', to: { frame: parked.frame, pos: [parked.pos[0], 14, parked.pos[2]] }, speed: 30 },
      { kind: 'fly', to: { frame: parked.frame, pos: parked.pos }, speed: 3 },
      { kind: 'dock' },
    ]);
    expect(zone.entity(bot.entityId)?.fields.mode).toBe('docked');
    expect(bot.stats.corrections).toBe(0);
    expect(bot.stats.maxPoseErrorM).toBeLessThan(0.5);
    expect(bot.stats.snapshots).toBeGreaterThan(20);
    expect(zone.movement!.recent.filter((record) => record.entity === bot.entityId)).toEqual([]);
    outcome('fly/walk/board/dock', bot, { mode: bot.mode, pose: bot.pose });
    await bot.close();
  }, 40_000);

  it('lands, exits, walks and mines a real deposit; combat resolves a real hit and changes health', async () => {
    const bot = await join();
    const zone = server.zones.zone(bot.zone)!;
    const world = miningWorld(homeSystemOf('thalune'), zone.fauna!.tier);
    const deposit = world.findNode({ want: (type) => nodeType(type).kind === 'deposit' });
    const up = norm(deposit.stand);
    const above = (height: number): Vec3 => [deposit.stand[0] + up[0] * height, deposit.stand[1] + up[1] * height, deposit.stand[2] + up[2] * height];
    await place(bot, String(world.body.index), above(SHIP_GEAR_HEIGHT + 2));
    await waitFor(() => zone.fauna!.groundReady(world.body.index), 20_000, 'surface ground planned');
    const setupCorrections = bot.stats.corrections;
    await bot.fly({ frame: world.frame, pos: above(SHIP_GEAR_HEIGHT) }, 1);
    await bot.land();
    expect(zone.entity(bot.entityId)?.fields.mode).toBe('landed');
    const left = dirToWorld({ position: [0, 0, 0], quaternion: bot.pose.quat }, [-1, 0, 0]);
    const forward = dirToWorld({ position: [0, 0, 0], quaternion: bot.pose.quat }, [0, 0, -1]);
    const exitDirection = norm([
      bot.pose.pos[0] + left[0] * 11 + forward[0] * 3,
      bot.pose.pos[1] + left[1] * 11 + forward[1] * 3,
      bot.pose.pos[2] + left[2] * 11 + forward[2] * 3,
    ]);
    const onGround = world.onGround(exitDirection);
    const feet: Vec3 = [onGround[0] + exitDirection[0] * 0.3, onGround[1] + exitDirection[1] * 0.3, onGround[2] + exitDirection[2] * 0.3];
    await bot.disembark(feet);
    await bot.walk({ frame: world.frame, pos: deposit.stand }, 3);
    const hit = await bot.mine({ frame: world.frame, node: deposit.id });
    expect(hit).toMatchObject({ result: 'hit', node: deposit.id });
    expect(hit.hp).toBeLessThan(1);
    expect(bot.stats.corrections).toBe(setupCorrections);

    // A legal hovering setup and a supported creature spawn, followed by the actual ship gun request.
    await place(bot, String(world.body.index), above(40));
    const species = faunaSpecies(world.params as PlanetParams, zone.fauna!.tier).find(
      (entry) => entry.kind !== 'flyer' && entry.temperament === 'docile' && entry.spawn === 'herd',
    );
    if (!species) throw new Error('the bot integration fixture needs a docile ground species');
    const herd = zone.fauna!.spawnHerd({ body: world.body.index, species: species.index, at: deposit.stand, count: 1, level: 3 });
    const id = herd?.creatures[0];
    if (id === undefined) throw new Error('could not spawn the bot combat fixture');
    await waitFor(() => bot.snapshots.latest.has(id), 5000, 'bot sees combat target');
    const creature = zone.fauna!.creature(id);
    if (!creature) throw new Error('combat target disappeared');
    const target = creatureSphere(creature).pos;
    const before = zone.combat.creatureHealth(id)!.hp;
    const shot = await bot.fight([target[0] - bot.pose.pos[0], target[1] - bot.pose.pos[1], target[2] - bot.pose.pos[2]]);
    expect(shot).toMatchObject({ result: 'hit', target: id });
    expect(zone.combat.creatureHealth(id)!.hp).toBeLessThan(before);
    outcome('land/walk/mine/fight', bot, {
      mine: hit,
      fire: shot,
      healthBefore: before,
      healthAfter: zone.combat.creatureHealth(id)!.hp,
      setupCorrections: bot.stats.corrections,
    });
    bot.assertHealthy();
    await bot.close();
  }, 60_000);

  it('accepts an actual server offer and reports quest, combat and movement refusals', async () => {
    const bot = await join();
    // Board generation is a later task: the runtime's normal offer hook supplies this fixture's offer.
    expect(server.quests.offer(bot.welcome.character.id, 'wing_over_rolis_iii')).toBeNull();
    const accepted = await bot.acceptQuest('wing_over_rolis_iii');
    expect(accepted.quests.active.wing_over_rolis_iii?.step).toBe('reach');
    await expect(bot.acceptQuest('the_apothecarys_sodium')).rejects.toMatchObject({ action: 'acceptQuest', reason: 'not_offered' });
    await expect(bot.fight([0, 0, -1])).rejects.toMatchObject({ action: 'fight', reason: 'mode' });
    await expect(bot.land()).rejects.toBeInstanceOf(BotRefusal);
    expect(bot.mode).toBe('docked');
    const world = miningWorld(homeSystemOf('thalune'), 0);
    await expect(bot.mine({ frame: world.frame, node: '0_0_0_ferrite_0' })).rejects.toMatchObject({ action: 'mine', reason: 'mode' });
    outcome('acceptQuest/refusals', bot, {
      accepted: accepted.quests.active.wing_over_rolis_iii,
      quest: bot.latest.get('quests'),
      fire: bot.latest.get('fire'),
      mine: bot.latest.get('mine'),
      mode: bot.mode,
    });
    bot.assertHealthy();
    await bot.close();
  }, 30_000);

  it('crosses a moving frame edge and applies warp identities, sequence fences and new snapshot baselines', async () => {
    const bot = await join();
    const radius = bot.system.station.soi;
    await place(bot, 'station', [0, 14, radius * 1.05 - 10]);
    const corrections = bot.stats.corrections;
    await bot.flyFor({ direction: [0, 0, 1], speed: 100, durationMs: 500 });
    expect(bot.stats.frameChanges, JSON.stringify({ radius, pose: bot.pose, stats: bot.stats })).toBeGreaterThan(0);
    expect(bot.stats.corrections).toBe(corrections);
    const oldZone = bot.zone;
    const oldEntity = bot.entityId;
    await bot.warp(1);
    expect(bot.zone).toBe('sys:1');
    expect(bot.stats.handoffs).toBe(1);
    await bot.settled();
    expect(bot.snapshots.latest.has(bot.entityId)).toBe(true);
    expect(server.zones.zone(oldZone)?.entity(oldEntity)).toBeUndefined();
    await expect(bot.warp(2)).rejects.toMatchObject({ action: 'warp', reason: 'fuel' });
    outcome('frame/warp', bot, { zone: bot.zone, fuelRefusal: bot.latest.get('warp') });
    bot.assertHealthy();
    await bot.close();
  }, 30_000);

  it('continues an accepted flight through the normal system/deep-space zone handoff', async () => {
    const bot = await join();
    await place(bot, 'inertial', [6e9 - 10, 0, 0]);
    const oldZone = bot.zone;
    const oldEntity = bot.entityId;
    const corrections = bot.stats.corrections;
    await bot.flyFor({ direction: [1, 0, 0], speed: 100, durationMs: 500 });
    expect(bot.zone).toBe('deep:0');
    expect(bot.stats.handoffs).toBe(1);
    expect(bot.stats.corrections).toBe(corrections);
    expect(bot.snapshots.latest.has(bot.entityId)).toBe(true);
    expect(server.zones.zone(oldZone)?.entity(oldEntity)).toBeUndefined();
    outcome('flight zone handoff', bot, { zone: bot.zone });
    await bot.close();
  });

  it('recovers a dropped correction from its snapshot and fails a silent snapshot stream', async () => {
    const bot = await join(500);
    const session = server.ws.registry.holding(bot.welcome.character.id)!;
    const send = session.send.bind(session);
    session.send = (message) => {
      if (message.t !== 'correction') send(message);
    };
    await expect(bot.land()).rejects.toBeInstanceOf(BotRefusal);
    expect(bot.mode).toBe('docked');
    expect(bot.stats.corrections).toBe(1);
    session.send = send;
    const sendBinary = session.sendBinary.bind(session);
    session.sendBinary = () => {};
    await expect(bot.wait(800)).rejects.toThrow('snapshot stream timed out');
    outcome('lost correction/silent stream', bot, { mode: bot.mode, healthy: bot.healthy });
    session.sendBinary = sendBinary;
    await bot.close();
  });
});
