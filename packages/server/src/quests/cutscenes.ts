// Quest steps and the cutscene service (P1.E09.T04, docs/ARCHITECTURE.md §15, §17): a cutscene step plays its cutscene
// through the service's `start(session, id, at)` at the step's place, and the `play` it answers is pushed to the client
// unrequested; a client may ask for a cutscene itself only while a live step plays it (the service's `may`, which keeps
// its development rule); and a cutscene that ends, by the client's `done` (the gateway) or by the service (its sweep's
// `ended`), ends the step (`QuestRuntime.cutsceneEnded`).
import type { ServerMessage } from '@astra/shared/protocol';
import type { CutscenePermit, CutsceneService } from '../cutscenes/service.ts';
import type { PhaseLocation } from '../phases/manager.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import type { QuestCutscenes, QuestRuntime } from './runtime.ts';

type CutsceneState = Extract<ServerMessage, { t: 'cutscene' }>;

/** Sends a session a message the server starts (a Session's send; a test's stand-in may have none). */
export function sendToSession(viewer: ZoneViewer, msg: CutsceneState): void {
  (viewer as { send?: (m: CutsceneState) => void }).send?.(msg);
}

/** The runtime's cutscene hook over the service: plays a step's cutscene and pushes its `play` to the client (not again
 * for the one it is watching: the service answers that with the same phase), and says which one the session watches. */
export function questCutscenes(
  service: () => CutsceneService | undefined,
  send: (viewer: ZoneViewer, msg: CutsceneState) => void = sendToSession,
): QuestCutscenes {
  return {
    start: (viewer: ZoneViewer, id: string, at?: PhaseLocation) => {
      const s = service();
      const watching = s?.playingOf(viewer)?.id === id;
      const r = s?.start(viewer, id, at);
      if (r?.op === 'play' && !watching) send(viewer, r);
      return r;
    },
    playingOf: (viewer: ZoneViewer) => service()?.playingOf(viewer) ?? null,
  };
}

/** The service's `may`: a quest's cutscene while a live step plays it, or whatever the service already allowed (a
 * development server's dev cutscenes). */
export function questCutscenePermit(quests: Pick<QuestRuntime, 'mayPlay'>, otherwise: CutscenePermit): CutscenePermit {
  return (viewer, id, entry) => quests.mayPlay(viewer, id) || otherwise(viewer, id, entry);
}

/** Whether a client's `done` (answered `reply` by the service) ends the quest step that played its cutscene: one played
 * to its end or skipped does; one given back unplayed (`returned`) does not, and the runtime plays it again once it can. */
export function doneEndsQuestStep(msg: { op: string; reason?: string }, reply: CutsceneState): boolean {
  return msg.op === 'done' && msg.reason !== 'returned' && reply.op === 'ended' && reply.phase !== null;
}

/** The service's `notify` for what it starts itself: sent to the client, and an `ended` ends the quest step too. */
export function questCutsceneNotify(quests: () => Pick<QuestRuntime, 'cutsceneEnded'>, send: (viewer: ZoneViewer, msg: CutsceneState) => void = sendToSession) {
  return (viewer: ZoneViewer, msg: CutsceneState): void => {
    send(viewer, msg);
    if (msg.op === 'ended') quests().cutsceneEnded(viewer, msg.id);
  };
}
