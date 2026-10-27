// The ground planner's worker thread (terrain.ts, GroundPlanner): plans worlds' surfaces off the zones' tick loop and
// sends back the pads that level their ground with the sites' clearance the resource nodes keep off, or a world's dens.
import { parentPort } from 'node:worker_threads';
import { answer, type PlanRequest } from './terrain.ts';

parentPort!.on('message', (request: PlanRequest) => parentPort!.postMessage(answer(request)));
