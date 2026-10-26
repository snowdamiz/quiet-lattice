// The ground planner's worker thread (terrain.ts, GroundPlanner): plans worlds' surfaces off the zones' tick loop and
// sends back the pads that level their ground.
import { parentPort } from 'node:worker_threads';
import type { PlanetParams } from '@astra/shared/world';
import { planPads } from './terrain.ts';

parentPort!.on('message', ({ id, params }: { id: string; params: PlanetParams }) => {
  try {
    parentPort!.postMessage({ id, pads: planPads(params) });
  } catch (err) {
    parentPort!.postMessage({ id, error: String(err) });
  }
});
