// Node ground planner workers that misbehave, for resources/ground.test.ts: the planner (NodeGroundPlanner) is pointed at
// this script with a `mode` and a shared count of the workers it has started, so the first can fail and the next behave.
import { parentPort, workerData } from 'node:worker_threads';
import type { PlanetParams } from '@astra/shared/world';
import { planNodeGround } from '../src/resources/ground.ts';

export type NodePlannerWorkerMode = 'exit-first' | 'exit' | 'hang-first' | 'throw';

const { mode, starts } = workerData as { mode: NodePlannerWorkerMode; starts: Int32Array };
/** this worker's place among those started: 0 for the first */
const nth = Atomics.add(starts, 0, 1);

parentPort!.on('message', ({ id, params, tier }: { id: string; params: PlanetParams; tier: number }) => {
  // dies without an error event, as a killed or crashed worker does
  if (mode === 'exit' || (mode === 'exit-first' && nth === 0)) process.exit(3);
  if (mode === 'hang-first' && nth === 0) for (;;);
  if (mode === 'throw') return parentPort!.postMessage({ id, error: 'Error: this world cannot be planned' });
  parentPort!.postMessage({ id, plan: planNodeGround(params, tier) });
});
