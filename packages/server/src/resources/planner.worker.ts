// The node ground planner's worker thread (ground.ts, NodeGroundPlanner): plans worlds' drawn ground off the zones' tick
// loop and sends back its pads and its sites' clearance.
import { parentPort } from 'node:worker_threads';
import type { PlanetParams } from '@astra/shared/world';
import { planNodeGround } from './ground.ts';

parentPort!.on('message', ({ id, params, tier }: { id: string; params: PlanetParams; tier: number }) => {
  try {
    parentPort!.postMessage({ id, plan: planNodeGround(params, tier) });
  } catch (err) {
    parentPort!.postMessage({ id, error: String(err) });
  }
});
