import type { Pose, Vec3 } from '@astra/shared/protocol';
import { frameIdOf } from '@astra/shared/world';
import { BotClient, type Destination } from './client.ts';

export type BotAction =
  | { kind: 'fly'; to: Destination; speed?: number; timeoutMs?: number }
  | { kind: 'flyFor'; direction: Vec3; speed: number; durationMs: number }
  | { kind: 'walk'; to: Destination; speed?: number; timeoutMs?: number }
  | { kind: 'land' }
  | { kind: 'dock' }
  | { kind: 'disembark'; feet: Vec3 }
  | { kind: 'board'; ship: Pose }
  | { kind: 'mine'; target: Parameters<BotClient['mine']>[0]; beamMs?: number }
  | { kind: 'fight'; aim: Vec3 }
  | { kind: 'acceptQuest'; quest: string }
  | { kind: 'warp'; system: number }
  | { kind: 'wait'; ms: number };

/** Runs a finite script in order. Refusals reject the script, carrying the action and the server's reason. */
export async function runScript(bot: BotClient, actions: readonly BotAction[]): Promise<void> {
  for (const action of actions) {
    switch (action.kind) {
      case 'fly':
        await bot.fly(action.to, action.speed, action.timeoutMs);
        break;
      case 'walk':
        await bot.walk(action.to, action.speed, action.timeoutMs);
        break;
      case 'flyFor':
        await bot.flyFor(action);
        break;
      case 'land':
        await bot.land();
        break;
      case 'dock':
        await bot.dock();
        break;
      case 'disembark':
        await bot.disembark(action.feet);
        break;
      case 'board':
        await bot.board(action.ship);
        break;
      case 'mine':
        await bot.mine(action.target, action.beamMs);
        break;
      case 'fight':
        await bot.fight(action.aim);
        break;
      case 'acceptQuest':
        await bot.acceptQuest(action.quest);
        break;
      case 'warp':
        await bot.warp(action.system);
        break;
      case 'wait':
        await bot.wait(action.ms);
        break;
      default: {
        const exhaustive: never = action;
        throw new Error(`unknown bot action ${String(exhaustive)}`);
      }
    }
  }
}

/** A bounded engine patrol through the open hangar mouth, with genuine 20 Hz input and snapshot traffic. */
export async function patrol(bot: BotClient, durationMs: number, system?: number): Promise<void> {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('patrol duration must be positive and finite');
  const frame = frameIdOf(bot.system.seed, 'station');
  const corrections = bot.stats.corrections;
  if (bot.pose.frame !== frame) throw new Error('the default patrol needs a fresh character in its Waystation');
  const x = bot.pose.pos[0];
  await bot.fly({ frame, pos: [x, 14, bot.pose.pos[2]] }, 5);
  await bot.fly({ frame, pos: [x, 14, 150] }, 30);
  if (system !== undefined && bot.zone !== `sys:${system}`) {
    await bot.flyFor({ direction: [0, 0, 1], speed: 500, durationMs: ((bot.system.station.soi * 1.07) / 500) * 1000 });
    await bot.warp(system);
  }
  const patrolFrame = bot.pose.frame;
  const start: Vec3 = [...bot.pose.pos];
  const end: Vec3 = [start[0], start[1], start[2] + 300];
  const deadline = performance.now() + durationMs;
  let outward = true;
  while (performance.now() < deadline) {
    const remaining = deadline - performance.now();
    if (remaining < 10_500) {
      await bot.wait(remaining);
      break;
    }
    await bot.fly({ frame: patrolFrame, pos: outward ? end : start }, 30, 15_000);
    outward = !outward;
    await bot.syncClock();
  }
  await bot.settled();
  if (bot.stats.corrections !== corrections) throw new Error('the patrol received an authoritative correction');
}
